"""Isolated integration checks: temporary storage and mocked provider traffic."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

import requests

from server.app import create_app


class LocalIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = {'TESTING': True, 'DATA_DIR': self.root / 'data',
                       'SECRETS_DIR': self.root / 'secrets',
                       'SERVER_NAME': '127.0.0.1:8085',
                       'PUBLIC_ORIGIN': 'http://127.0.0.1:8085'}
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.headers = {'Origin': self.config['PUBLIC_ORIGIN']}
        response = self.client.post('/api/auth/setup', headers=self.headers,
            json={'username': 'owner', 'password': 'dummy-password-for-tests'})
        self.headers['X-CSRF-Token'] = response.json['csrfToken']
        self.client.put('/api/settings/key', headers=self.headers,
                        json={'key': 'dummy-private-key'})

    def chat(self, **overrides):
        return {'model': 'dummy/model', 'messages': [{'role': 'user', 'content': 'test'}],
                **overrides}

    def post_chat(self, payload, **options):
        return self.client.post('/api/openrouter/chat/completions',
                                headers=self.headers, json=payload, **options)

    def test_automatic_recovery_is_scoped_and_capped_and_preserves_retry_after(self):
        headers = {**self.headers, 'X-Bench-Automatic': json.dumps({'id':'auto-run-1234567890', 'limit':3})}
        upstream = Mock(status_code=429, headers={'Retry-After':'15'})
        upstream.json.return_value = {'error': {'message':'Busy', 'code':429}}
        with patch('server.proxy.requests.request', return_value=upstream) as call:
            for _ in range(3):
                response = self.client.post('/api/openrouter/chat/completions', headers=headers, json=self.chat())
                self.assertEqual(response.status_code,429)
                self.assertEqual(response.headers['Retry-After'],'15')
            blocked = self.client.post('/api/openrouter/chat/completions', headers=headers, json=self.chat())
            self.assertEqual(blocked.status_code,409)
            self.assertFalse(blocked.json['requestSent'])
            self.assertEqual(call.call_count,3)
            self.assertNotIn('X-Bench-Automatic',call.call_args.kwargs['headers'])

    def test_automatic_allowance_covers_repairs_and_cannot_switch_models(self):
        from server.spend_guard import reserve,finish
        run={'id':'auto-run-1234567890','limit':3}
        with self.app.app_context():
            for i in range(3):
                payload=self.chat(messages=[{'role':'user','content':f'new repair {i}'}])
                identity=reserve(payload,run)
                self.assertIsNotNone(identity)
                self.assertIsNone(reserve(self.chat(messages=[]),run),'No concurrent request in same allowance')
                finish(identity,True)
            self.assertIsNone(reserve(self.chat(),run))
            self.assertIsNone(reserve(self.chat(model='another/model'),run))
            self.assertIsNotNone(reserve(self.chat(model='another/model'),{'id':'second-model-run-12345','limit':3}))

    def test_automatic_cannot_release_filtered_or_running_fingerprint(self):
        from server.spend_guard import reserve,finish
        with self.app.app_context():
            identity=reserve(self.chat())
            self.assertIsNone(reserve(self.chat(),{'id':'auto-run-1234567890','limit':3}))
            finish(identity,False,filtered=True)
            self.assertIsNone(reserve(self.chat(),{'id':'auto-run-1234567890','limit':3}))

    def test_stream_filter_error_stays_blocked_for_new_automatic_runs(self):
        upstream = Mock(status_code=200)
        upstream.iter_content.return_value = [b'data: {"error":{"code":"content_filter","message":"Filtered"}}\n\n']
        with patch('server.proxy.requests.request', return_value=upstream) as call:
            response = self.post_chat(self.chat(stream=True), buffered=True)
            self.assertIn(b'content_filter', response.data)
            retry = self.client.post('/api/openrouter/chat/completions',
                headers={**self.headers,'X-Bench-Automatic':json.dumps({'id':'new-automatic-run-12345','limit':3})},
                json=self.chat(stream=True))
            self.assertEqual(retry.status_code,409)
            self.assertFalse(retry.json['requestSent'])
            self.assertEqual(call.call_count,1)

    def test_invalid_automatic_policy_is_unsent(self):
        with patch('server.proxy.requests.request') as call:
            for value in ['invalid',json.dumps({'id':'auto-run-1234567890','limit':100})]:
                response=self.client.post('/api/openrouter/chat/completions',headers={**self.headers,'X-Bench-Automatic':value},json=self.chat())
                self.assertEqual(response.status_code,400)
                self.assertFalse(response.json['requestSent'])
            call.assert_not_called()

    def test_project_bytes_and_vault_survive_restart_and_backup_restore(self):
        contents = {
            'prompt-gallery/projects/échantillon/site.html': b'<html>local project</html>',
            'prompt-gallery/projects/échantillon/metadata.json': b'{"rating": 4}',
            'prompt-gallery/exports/archive.zip': b'PK\x03\x04\x00\xffbinary-export',
        }
        for path, content in contents.items():
            response = self.client.put('/__data/file', query_string={'path': path},
                                        headers=self.headers, data=content)
            self.assertEqual(response.status_code, 200)
        backup = self.root / 'backup'
        shutil.copytree(self.root / 'data', backup / 'data')
        shutil.copytree(self.root / 'secrets', backup / 'secrets')
        restored = create_app({**self.config, 'DATA_DIR': backup / 'data',
                                'SECRETS_DIR': backup / 'secrets'}).test_client()
        login = restored.post('/api/auth/login', headers=self.headers,
            json={'username': 'owner', 'password': 'dummy-password-for-tests'})
        self.assertEqual(login.status_code, 200)
        restored_headers = {**self.headers, 'X-CSRF-Token': login.json['csrfToken']}
        for path, content in contents.items():
            response = restored.get('/__data/file', query_string={'path': path})
            self.assertEqual(response.data, content)
            self.assertIn('attachment', response.headers['Content-Disposition'])
            response.close()
        upstream = Mock(status_code=200)
        upstream.json.return_value = {'data': []}
        with patch('server.proxy.requests.request', return_value=upstream) as call:
            self.assertEqual(restored.get('/api/openrouter/models').status_code, 200)
            self.assertEqual(call.call_args.kwargs['headers']['Authorization'],
                             'Bearer dummy-private-key')
        self.assertEqual(restored.delete('/__data/file',
            query_string={'path': 'prompt-gallery/projects', 'recursive': '1'},
            headers=restored_headers).status_code, 200)
        self.assertEqual(restored.get('/__data/file', query_string={
            'path': 'prompt-gallery/projects/échantillon/site.html'}).status_code, 404)
        # Restoring and deleting in the backup must not touch the original.
        self.assertEqual(self.client.get('/__data/stat', query_string={
            'path': 'prompt-gallery/projects/échantillon/site.html'}).json['exists'], True)

    def test_missing_proc_does_not_break_generations_or_unlock_active_workers(self):
        from server.spend_guard import reserve, clear_failed
        with self.app.app_context(), patch('server.spend_guard.Path.read_text',
                                           side_effect=FileNotFoundError):
            self.assertIsNotNone(reserve(self.chat()))
            clear_failed()
            self.assertIsNone(reserve(self.chat()))

    def test_concurrent_reservations_only_allow_one_provider_call(self):
        from server.spend_guard import reserve
        payload = self.chat()
        def reserve_one(_):
            with self.app.app_context():
                return reserve(payload)
        with ThreadPoolExecutor(max_workers=8) as workers:
            results = list(workers.map(reserve_one, range(8)))
        self.assertEqual(sum(identity is not None for identity in results), 1)

    def test_stream_final_null_delta_releases_successful_retry_block(self):
        upstream = Mock(status_code=200)
        upstream.iter_content.return_value = [
            b'data: {"choices":[{"delta":{"content":"complete"}}]}\n\n',
            b'data: {"choices":[{"delta":null,"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        ]
        with patch('server.proxy.requests.request', return_value=upstream) as call:
            for _ in range(2):
                response = self.post_chat(self.chat(stream=True))
                self.assertIn(b'[DONE]', response.data)
                self.assertNotIn(b'error', response.data)
                response.close()
            self.assertEqual(call.call_count, 2)

    def test_oversized_project_update_is_json_error_and_preserves_existing_bytes(self):
        path = '/__data/file?path=prompt-gallery/projects/site.html'
        self.assertEqual(self.client.put(path, data=b'original', headers=self.headers).status_code, 200)
        self.app.config['MAX_CONTENT_LENGTH'] = 16
        response = self.client.put(path, data=b'x' * 17, headers=self.headers)
        self.assertEqual(response.status_code, 413)
        self.assertIsInstance(response.json['error'], str)
        response = self.client.get(path)
        self.assertEqual(response.data, b'original')
        response.close()

    def test_invalid_json_and_unauthenticated_writes_never_call_provider(self):
        with patch('server.proxy.requests.request') as call:
            response = self.client.post('/api/openrouter/chat/completions',
                headers={**self.headers, 'Content-Type': 'application/json'}, data='{broken')
            self.assertEqual(response.status_code, 400)
            self.assertIsInstance(response.json['error'], str)
            anonymous = self.app.test_client()
            for path in ('/api/settings/key', '/__data/file?path=project.json',
                         '/api/openrouter/retry-blocks'):
                response = anonymous.delete(path, headers=self.headers)
                self.assertEqual(response.status_code, 401)
                self.assertNotIn(b'dummy-private-key', response.data)
            call.assert_not_called()

    def test_proxy_preflight_rejections_explicitly_report_unsent(self):
        from server.spend_guard import reserve
        with patch('server.proxy.requests.request') as call:
            for payload in ({'messages': []}, {'model': 'dummy/model', 'messages': None}, []):
                response = self.post_chat(payload)
                self.assertEqual(response.status_code, 400)
                self.assertIs(response.json.get('requestSent'), False)
            response = self.client.post('/api/openrouter/chat/completions',
                headers={**self.headers, 'Content-Type': 'application/json'}, data='{broken')
            self.assertEqual(response.status_code, 400)
            self.assertIs(response.json.get('requestSent'), False)
            response = self.client.post('/api/openrouter/chat/completions',
                headers={**self.headers, 'Content-Type': 'text/plain'}, data='not json')
            self.assertEqual(response.status_code, 415)
            self.assertIs(response.json.get('requestSent'), False)
            with self.app.app_context():
                reserve(self.chat())
            response = self.post_chat(self.chat())
            self.assertEqual(response.status_code, 409)
            self.assertIs(response.json.get('requestSent'), False)
            self.client.delete('/api/settings/key', headers=self.headers)
            response = self.post_chat(self.chat())
            self.assertEqual(response.status_code, 409)
            self.assertIs(response.json.get('requestSent'), False)
            call.assert_not_called()

    def test_provider_and_transport_errors_never_report_unsent(self):
        upstream = Mock(status_code=400)
        upstream.json.return_value = {'error': {'message': 'Invalid provider parameter',
                                                'requestSent': False}}
        with patch('server.proxy.requests.request', return_value=upstream) as call:
            response = self.post_chat(self.chat())
            self.assertEqual(response.status_code, 400)
            self.assertNotIn('requestSent', response.json)
            self.assertNotIn('requestSent', response.json['error'])
            call.assert_called_once()
        with patch('server.proxy.requests.request', side_effect=requests.Timeout) as call:
            response = self.post_chat(self.chat(messages=[{'role': 'user', 'content': 'timeout'}]))
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('requestSent', response.json)
            call.assert_called_once()

    def test_malformed_completion_is_json_error_and_keeps_retry_block(self):
        for number, result in enumerate(({'choices': [None]}, {'choices': None}, [])):
            upstream = Mock(status_code=200)
            upstream.json.return_value = result
            payload = self.chat(messages=[{'role': 'user', 'content': str(number)}])
            with patch('server.proxy.requests.request', return_value=upstream) as call:
                response = self.post_chat(payload)
                self.assertEqual(response.status_code, 502)
                self.assertIsInstance(response.json['error'], str)
                self.assertEqual(self.post_chat(payload).status_code, 409)
                self.assertEqual(call.call_count, 1)
                upstream.close.assert_called_once()

    def test_malformed_stream_closes_provider_and_blocks_automatic_retry(self):
        upstream = Mock(status_code=200)
        upstream.iter_content.return_value = [b'data: {"choices":[null]}\n\n']
        payload = self.chat(stream=True)
        with patch('server.proxy.requests.request', return_value=upstream):
            response = self.post_chat(payload)
            self.assertIn(b'error', response.data)
            response.close()
            upstream.close.assert_called_once()
            self.assertEqual(self.post_chat(payload).status_code, 409)

    def test_stream_cancellation_closes_provider_and_blocks_automatic_retry(self):
        upstream = Mock(status_code=200)
        upstream.iter_content.return_value = iter([
            b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        ])
        payload = self.chat(stream=True)
        with patch('server.proxy.requests.request', return_value=upstream) as call:
            response = self.post_chat(payload, buffered=False)
            self.assertIn(b'partial', next(response.response))
            response.close()
            upstream.close.assert_called_once()
            self.assertEqual(self.post_chat(payload).status_code, 409)
            self.assertEqual(call.call_count, 1)

    def test_provider_timeout_is_redacted_and_blocks_automatic_retry(self):
        with patch('server.proxy.requests.request', side_effect=requests.Timeout(
                'private details dummy-private-key')) as call:
            response = self.post_chat(self.chat())
            self.assertEqual(response.status_code, 502)
            self.assertNotIn(b'dummy-private-key', response.data)
            self.assertEqual(self.post_chat(self.chat()).status_code, 409)
            self.assertEqual(call.call_count, 1)

    def test_typical_metrics_tolerate_malformed_imported_records(self):
        folder = self.root / 'data' / 'files' / '_telemetry' / 'generations'
        folder.mkdir(parents=True)
        rows = [None, [], {'modelId': 'dummy/model', 'provider': None},
                {'modelId': 'dummy/model', 'provider': {'id': 'openrouter'},
                 'outcome': 'ok', 'durations': None, 'cost': []}]
        (folder / '2026-11.jsonl').write_text('\n'.join(map(json.dumps, rows)))
        response = self.client.get('/__telemetry/typical?model=dummy/model&provider=openrouter')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json['total'])

    def test_unrepresentable_metric_number_does_not_crash(self):
        response = self.client.post('/__telemetry/generation', headers=self.headers,
            json={'record': {'durationMs': 10 ** 400, 'modelId': 'dummy/model'}})
        self.assertEqual(response.status_code, 200)
        stored = json.loads(next((self.root / 'data' / 'files').rglob('*.jsonl')).read_text())
        self.assertNotIn('durationMs', stored)
