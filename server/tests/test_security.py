from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

from server.app import create_app


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.site = self.root / 'site'
        self.site.mkdir()
        (self.site / 'prompt-gallery').mkdir()
        (self.site / 'prompt-gallery' / 'index.html').write_text('<html><body>Bonjour<script src="https://static.cloudflareinsights.com/beacon.min.js"></script></body></html>')
        self.config = {'TESTING': True, 'DATA_DIR': self.root / 'data',
                       'SECRETS_DIR': self.root / 'secrets', 'SITE_ROOT': self.site,
                       'SERVER_NAME': '127.0.0.1:8085',
                       'PUBLIC_ORIGIN': 'http://127.0.0.1:8085'}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.headers = {'Origin': self.config['PUBLIC_ORIGIN']}

    def setup(self):
        response = self.client.post('/api/auth/setup', headers=self.headers,
                                    json={'username': 'admin', 'password': 'un-mot-de-passe-solide'})
        self.assertEqual(response.status_code, 201)
        self.headers['X-CSRF-Token'] = response.json['csrfToken']
        return response

    def test_public_health_and_locked_static(self):
        self.assertEqual(self.client.get('/healthz').status_code, 200)
        self.assertEqual(self.client.get('/prompt-gallery/').status_code, 302)
        self.assertEqual(self.client.get('/api/settings/key').status_code, 401)
        self.assertEqual(self.client.get('/__data/status').status_code, 401)
        self.assertEqual(self.client.get('/api/auth/status').json,
                         {'needs_setup': True, 'authenticated': False})

    def test_setup_single_admin_hashed_password_cookie(self):
        response = self.setup()
        self.assertIn('HttpOnly', response.headers['Set-Cookie'])
        self.assertIn('SameSite=Strict', response.headers['Set-Cookie'])
        self.assertEqual(self.client.post('/api/auth/setup', headers=self.headers,
            json={'username': 'other', 'password': 'long-password-again'}).status_code, 409)
        with sqlite3.connect(self.root / 'data' / 'app.sqlite3') as db:
            row = db.execute('SELECT password_hash FROM admin').fetchone()
            self.assertTrue(row[0].startswith('scrypt:'))
            self.assertNotIn('un-mot-de-passe-solide', row[0])
            token_hash = db.execute('SELECT token_hash FROM sessions').fetchone()[0]
            self.assertNotIn(token_hash, response.headers['Set-Cookie'])

    def test_setup_password_policy_and_origin(self):
        for origin in (None, 'null', 'http://evil.test'):
            headers = {} if origin is None else {'Origin': origin}
            self.assertEqual(self.client.post('/api/auth/setup', headers=headers,
                json={'username': 'admin', 'password': '123456789012'}).status_code, 403)
        self.assertEqual(self.client.post('/api/auth/setup', headers=self.headers,
            json={'username': 'admin', 'password': 'court'}).status_code, 400)

    def test_concurrent_setup_creates_exactly_one_admin(self):
        def signup(number):
            with self.app.test_client() as client:
                return client.post('/api/auth/setup', headers=self.headers,
                    json={'username': 'admin' + str(number), 'password': 'a-long-password-123'}).status_code
        with ThreadPoolExecutor(max_workers=4) as workers:
            statuses = list(workers.map(signup, range(4)))
        self.assertEqual(sorted(statuses), [201, 409, 409, 409])
        with sqlite3.connect(self.root / 'data' / 'app.sqlite3') as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM admin').fetchone()[0], 1)

    def test_csrf_and_foreign_origin(self):
        self.setup()
        for headers in ({'Origin': self.headers['Origin']},
                        {**self.headers, 'Origin': 'null'},
                        {**self.headers, 'Origin': 'http://evil.test'}):
            self.assertEqual(self.client.put('/api/settings/key', headers=headers,
                                             json={'key': 'dummy-key'}).status_code, 403)
        self.assertEqual(self.client.put('/api/settings/key', headers=self.headers,
                                         json={'key': 'dummy-key'}).status_code, 200)

    def test_encrypted_key_persists_and_never_returns(self):
        self.setup()
        key = 'sk-or-dummy-test-key-do-not-use'
        response = self.client.put('/api/settings/key', headers=self.headers, json={'key': key})
        self.assertEqual(response.json, {'configured': True})
        self.assertNotIn(key.encode(), (self.root / 'data' / 'app.sqlite3').read_bytes())
        self.assertEqual((self.root / 'secrets' / 'vault.key').stat().st_mode & 0o777, 0o600)
        self.assertNotIn(key, self.client.get('/api/auth/status').get_data(as_text=True))
        again = create_app(self.config).test_client()
        again.post('/api/auth/login', headers=self.headers,
                   json={'username': 'admin', 'password': 'un-mot-de-passe-solide'})
        self.assertEqual(again.get('/api/settings/key').json, {'configured': True})
        self.assertEqual(self.client.delete('/api/settings/key', headers=self.headers).json,
                         {'configured': False})

    def test_logout_invalidates_and_login_limits(self):
        self.setup()
        self.assertEqual(self.client.post('/api/auth/logout', headers=self.headers).status_code, 200)
        self.assertEqual(self.client.get('/api/settings/key').status_code, 401)
        for _ in range(5):
            self.assertEqual(self.client.post('/api/auth/login', headers=self.headers,
                json={'username': 'admin', 'password': 'wrong'}).status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login', headers=self.headers,
            json={'username': 'admin', 'password': 'un-mot-de-passe-solide'}).status_code, 429)

    def test_data_roundtrip_listing_and_download_sandbox(self):
        self.setup()
        self.assertEqual(self.client.post('/__data/dir?path=gallery', headers=self.headers).status_code, 200)
        self.assertEqual(self.client.put('/__data/file?path=gallery/page.html', headers=self.headers,
            data='<script>danger()</script>').status_code, 200)
        response = self.client.get('/__data/file?path=gallery/page.html')
        self.assertEqual(response.mimetype, 'application/octet-stream')
        self.assertIn('sandbox', response.headers['Content-Security-Policy'])
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
        response.close()
        self.assertEqual(self.client.get('/__data/tree?depth=3').json['entries'], [
            {'name': 'gallery', 'path': 'gallery', 'kind': 'directory'},
            {'name': 'page.html', 'path': 'gallery/page.html', 'kind': 'file'}])

    def test_data_rejects_traversal_secrets_symlinks(self):
        self.setup()
        paths = ['../app.sqlite3', '/etc/passwd', '_suite/api-keys.json',
                 '_suite/api-keys.json.bak', 'a/../../secret', 'a\\..\\secret', '.env']
        for path in paths:
            response = self.client.get('/__data/file', query_string={'path': path})
            self.assertIn(response.status_code, (400, 403), path)
        (self.root / 'data' / 'files' / 'link').symlink_to(self.root / 'secrets', target_is_directory=True)
        self.assertEqual(self.client.get('/__data/file?path=link/vault.key').status_code, 403)

    def test_static_injection_and_source_exclusions(self):
        self.setup()
        response = self.client.get('/prompt-gallery/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'data-secure-vault="on"', response.data)
        self.assertIn(b'/shared/services/secure-ui.js', response.data)
        self.assertNotIn(b'cloudflareinsights', response.data)
        for path in ('/.git/config', '/server/app.py', '/requirements.txt', '/.env', '/serve.py', '/README.md'):
            self.assertEqual(self.client.get(path).status_code, 404, path)

    def test_untrusted_host(self):
        self.assertEqual(self.client.get('/healthz', headers={'Host': 'evil.test'}).status_code, 400)

    def test_canonical_origin_redirects_localhost_and_internal_ports(self):
        for method in ('GET', 'HEAD'):
            for host in ('localhost:8085', '127.0.0.1:8080', 'localhost'):
                response = self.client.open('/prompt-gallery/?view=saved', method=method,
                                            base_url='http://' + host)
                self.assertEqual(response.status_code, 308)
                self.assertEqual(response.headers['Location'],
                                 'http://127.0.0.1:8085/prompt-gallery/?view=saved')
        self.assertEqual(self.client.get('/login', base_url='http://localhost:8085').status_code, 308)
        self.assertEqual(self.client.get('/api/auth/status').status_code, 200)
        self.assertEqual(self.client.get('/healthz', base_url='http://127.0.0.1:8080').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/setup', base_url='http://localhost:8085',
            headers={'Origin': 'http://localhost:8085'},
            json={'username': 'admin', 'password': 'un-mot-de-passe-solide'}).status_code, 403)

    def test_vault_rejects_unsafe_key_characters_without_logging(self):
        self.setup()
        keys = [' dummy-secret', 'dummy-secret ', 'dummy secret', 'dummy\tsecret',
                'dummy\nsecret', 'dummy-secreté', 'dummy"secret', "dummy'secret", 'dummy\\secret']
        with self.assertNoLogs(self.app.logger):
            for key in keys:
                response = self.client.put('/api/settings/key', headers=self.headers, json={'key': key})
                self.assertEqual(response.status_code, 400, repr(key))
                self.assertNotIn(key, response.get_data(as_text=True))
        self.assertEqual(self.client.get('/api/settings/key').json, {'configured': False})
        self.assertEqual(self.client.put('/api/settings/key', headers=self.headers,
            json={'key': 'sk-or-v1-dummy_ASCII.token-123'}).status_code, 200)

    def test_session_expiry_and_logout_cookie_replay(self):
        self.setup()
        cookie = self.client.get_cookie('llm_bench_session', domain='127.0.0.1').value
        self.client.post('/api/auth/logout', headers=self.headers)
        self.client.set_cookie('llm_bench_session', cookie, domain='127.0.0.1')
        self.assertEqual(self.client.get('/api/settings/key').status_code, 401)
        self.client.post('/api/auth/login', headers=self.headers,
            json={'username': 'admin', 'password': 'un-mot-de-passe-solide'})
        with sqlite3.connect(self.root / 'data' / 'app.sqlite3') as db:
            db.execute('UPDATE sessions SET expires_at=0')
        self.assertEqual(self.client.get('/api/settings/key').status_code, 401)

    def test_showcase_sandbox_no_privileged_script(self):
        self.setup()
        folder = self.site / '_showcase'
        folder.mkdir()
        (folder / 'generated.html').write_text('<html><body><script>evil()</script></body></html>')
        response = self.client.get('/_showcase/generated.html')
        self.assertIn("sandbox; default-src 'none'", response.headers['Content-Security-Policy'])
        self.assertNotIn(b'secure-ui.js', response.data)

    @patch('server.proxy.requests.request')
    def test_proxy_fixed_upstream_server_key(self, upstream):
        self.setup()
        self.client.put('/api/settings/key', headers=self.headers, json={'key': 'dummy-secret'})
        upstream.return_value = Mock(status_code=200)
        upstream.return_value.json.return_value = {'data': [{'id': 'dummy-model'}]}
        response = self.client.get('/api/openrouter/models?url=http://evil.test')
        self.assertEqual(response.json, {'data': [{'id': 'dummy-model'}]})
        call = upstream.call_args
        self.assertEqual(call.args[1], 'https://openrouter.ai/api/v1/models')
        self.assertEqual(call.kwargs['headers']['Authorization'], 'Bearer dummy-secret')
        self.assertFalse(call.kwargs['allow_redirects'])
        self.assertNotIn(b'dummy-secret', response.data)
        upstream.return_value.status_code = 401
        upstream.return_value.text = 'dummy-secret should never be returned'
        self.assertNotIn(b'dummy-secret', self.client.get('/api/openrouter/models').data)

    @patch('server.proxy.requests.request')
    def test_provider_parameter_error_is_actionable_and_redacted(self, upstream):
        self.setup()
        self.client.put('/api/settings/key', headers=self.headers, json={'key': 'dummy-secret'})
        upstream.return_value = Mock(status_code=400)
        upstream.return_value.json.return_value = {'error': {'code': 400, 'message': 'reasoning effort invalid dummy-secret sk-or-test-secret Bearer another-secret', 'metadata': {'raw': 'do not expose'}}}
        response = self.client.post('/api/openrouter/chat/completions', headers=self.headers,
                                    json={'model': 'vendor/model', 'messages': [], 'stream': True})
        self.assertEqual(response.status_code, 400)
        self.assertIn('reasoning effort invalid', response.json['error']['message'])
        for secret in (b'dummy-secret', b'sk-or-test-secret', b'another-secret', b'do not expose'):
            self.assertNotIn(secret, response.data)
        self.assertEqual(response.json['upstreamStatus'], 400)

    @patch('server.proxy.requests.request')
    def test_chat_stream_and_sanitized_telemetry(self, upstream):
        self.setup()
        self.client.put('/api/settings/key', headers=self.headers, json={'key': 'dummy-secret'})
        upstream.return_value = Mock(status_code=200)
        upstream.return_value.iter_content.return_value = [b'data: {"choices":[]}\n\n', b'data: [DONE]\n\n']
        response = self.client.post('/api/openrouter/chat/completions', headers=self.headers,
            json={'model': 'dummy-model', 'messages': [], 'stream': True})
        self.assertEqual(response.mimetype, 'text/event-stream')
        self.assertIn(b'[DONE]', response.data)
        response = self.client.post('/__telemetry/generation', headers=self.headers,
            json={'model': 'dummy-model', 'durationMs': 123, 'apiKey': 'dummy-secret', 'prompt': 'private'})
        self.assertEqual(response.status_code, 200)
        metric = next((self.root / 'data' / 'files' / '_telemetry').rglob('*.jsonl')).read_text()
        self.assertNotIn('dummy-secret', metric)
        self.assertNotIn('private', metric)

    def test_real_telemetry_record_preserves_metrics_and_drops_secrets(self):
        self.setup()
        record = {'schema': 1, 'id': 'test-123', 'at': '2026-11-09T09:00:00Z',
                  'app': 'prompt-gallery', 'modelId': 'dummy/model', 'outcome': 'ok',
                  'provider': {'id': 'openrouter', 'type': 'openrouter', 'name': 'OpenRouter', 'key': 'private'},
                  'phases': {'queued': 0, 'firstToken': 120, 'done': 1000, 'key': 'private'},
                  'durations': {'totalMs': 1000, 'writeMs': 880, 'thinkMs': None, 'tokensPerSecond': float('inf')},
                  'usage': {'promptTokens': 4, 'completionTokens': 12, 'cost': .01, 'headers': 'private'},
                  'cost': {'usd': .01, 'source': 'provider-usage', 'key': 'private'},
                  'error': 'private-key', 'params': {'apiKey': 'private-key'}, 'promptChars': 999}
        response = self.client.post('/__telemetry/generation', headers=self.headers,
            json={'record': record, 'body': {'prompt': 'private-prompt', 'response': 'private-output'}})
        self.assertEqual(response.status_code, 200)
        stored = json.loads(next((self.root / 'data' / 'files' / '_telemetry').rglob('*.jsonl')).read_text())
        self.assertEqual(stored['durations']['totalMs'], 1000)
        self.assertEqual(stored['usage']['completionTokens'], 12)
        self.assertEqual(stored['cost'], {'usd': .01})
        self.assertNotIn('tokensPerSecond', stored['durations'])
        self.assertNotIn('private', json.dumps(stored))
        typical = self.client.get('/__telemetry/typical?provider=openrouter&model=dummy/model').json
        self.assertEqual(typical['total']['p50'], 1000)
        self.assertEqual(typical['costUsd']['p50'], .01)


if __name__ == '__main__':
    unittest.main()
