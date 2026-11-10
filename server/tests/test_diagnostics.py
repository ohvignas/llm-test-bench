import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from server.app import create_app
from server.activity import Activity
from server.diagnostics import cancel, diagnose, journal, status
from server.spend_guard import reserve
from server.storage import db


class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'data'
        self.app = create_app({'TESTING': True, 'DATA_DIR': self.root,
                              'SECRETS_DIR': Path(self.temp.name)/'secrets',
                              'SERVER_NAME':'127.0.0.1:8085'})

    def test_live_activity_retains_only_metrics_and_effective_settings(self):
        with self.app.app_context():
            payload = {'model':'test/model','messages':[{'role':'user','content':'PRIVATE PROMPT'}],
                       'max_tokens':128000,'reasoning':{'effort':'high'},'api_key':'PRIVATE KEY'}
            reserve(payload)
            tracker = Activity(payload)
            tracker.observe({'choices':[{'delta':{'reasoning':'PRIVATE REASONING'}}]})
            tracker.observe({'choices':[{'delta':{'content':'<html>PRIVATE CODE</html>'}}],
                             'usage':{'cost':.125, 'completion_tokens_details':{'reasoning_tokens':42},'secret':'PRIVATE KEY'}})
            tracker.flush(force=True)
            report = status(self.root)
            self.assertEqual(report['active_calls'],1)
            self.assertEqual(report['calls'][0]['reasoning_events'],1)
            self.assertEqual(report['calls'][0]['output_chars'],25)
            self.assertEqual(report['calls'][0]['usage']['cost'],.125)
            self.assertNotIn('PRIVATE',json.dumps(report))
            tracker.finish('ok')
            self.assertEqual(status(self.root)['calls'][0]['state'],'ok')

    def test_cancel_is_exact_and_only_affects_requested_call(self):
        with self.app.app_context():
            first, second = Activity({'model':'A'}), Activity({'model':'B'})
            with self.assertRaises(ValueError): cancel(self.root,first.id[:8])
            cancel(self.root,first.id)
            self.assertTrue(first.cancelled())
            self.assertFalse(second.cancelled())
            first.finish('cancelled')
            with self.assertRaises(ValueError): cancel(self.root,first.id)

    def test_proxy_cancel_closes_only_the_target_stream_and_no_paid_retry(self):
        client = self.app.test_client()
        headers={'Origin':'http://127.0.0.1:8085'}
        setup=client.post('/api/auth/setup',headers=headers,json={'username':'tester','password':'a-long-test-password'})
        headers['X-CSRF-Token']=setup.json['csrfToken']
        client.put('/api/settings/key',headers=headers,json={'key':'dummy-private-key'})
        upstream=Mock(status_code=200)
        def chunks(_):
            row=db().execute('SELECT id FROM generation_activity').fetchone()
            cancel(self.root,row['id'])
            yield b': keepalive\n\n'
        upstream.iter_content.side_effect=lambda **kwargs: chunks(None)
        with patch('server.proxy.requests.request',return_value=upstream) as request:
            result=client.post('/api/openrouter/chat/completions',headers=headers,
                json={'model':'test/model','messages':[],'stream':True},buffered=True)
        self.assertIn(b'CANCELLED_BY_OPERATOR',result.data)
        request.assert_called_once()
        upstream.close.assert_called_once()
        report=status(self.root)
        self.assertEqual(report['active_calls'],0)
        self.assertEqual(report['calls'][0]['state'],'cancelled')

    def test_imported_journal_redacts_secrets_and_reports_last_signal(self):
        result=journal(io.StringIO(json.dumps({'costCalls':[{'settings':{'api_key':'private-value'},'usd':None}],
            'entries':[{'modelKey':'a','stage':'progress','message':'0 caractères · 10 signaux'},
                       {'modelKey':'a','stage':'progress','message':'0 caractères · 20 signaux'},
                       {'level':'error','message':'Authorization=secret sk-test-123'}]})))
        self.assertNotIn('private-value',json.dumps(result))
        self.assertNotIn('sk-test-123',json.dumps(result))
        self.assertEqual(len(result['latest_signals']),1)
        self.assertIn('20',result['latest_signals'][0]['message'])
        self.assertIsNone(result['calls'][0]['usd'])

    def test_doctor_distinguishes_reasoning_only_from_truncated_code(self):
        snapshot={'calls':[],'legacy_active_calls':0}
        records=[{'modelId':'test/model','finishReason':'length','responseChars':0,'usage':{'reasoningTokens':128000}},
                 {'modelId':'test/other','finishReason':'length','responseChars':1000}]
        findings=diagnose(snapshot,records)
        self.assertEqual(len(findings),1)
        self.assertIn('128000',findings[0])


if __name__=='__main__': unittest.main()
