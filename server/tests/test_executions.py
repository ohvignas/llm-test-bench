import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

from server.app import create_app
from server.activity import Activity
from server.executions import run_execution
from server.storage import db


class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.app = create_app({'TESTING':True,'DATA_DIR':root/'data','SECRETS_DIR':root/'secrets',
                              'SERVER_NAME':'127.0.0.1:8085'})
        self.client = self.app.test_client()
        self.headers = {'Origin':'http://127.0.0.1:8085'}
        result = self.client.post('/api/auth/setup', headers=self.headers,
                                 json={'username':'test','password':'dummy-long-password'})
        self.headers['X-CSRF-Token'] = result.json['csrfToken']
        self.client.put('/api/settings/key',headers=self.headers,json={'key':'dummy-private-key'})

    def body(self, i=1):
        return {'id':f'{i:032x}','context':{'title':f'Projet {(i-1)%3+1}', 'promptId':f'p{(i-1)%3}', 'groupId':'lot', 'modelLabel':f'Modèle {(i-1)//3}'},
                'request':{'model':f'model/{(i-1)//3}', 'messages':[{'role':'user','content':f'prompt {(i-1)%3}'}],
                           'stream':True,'max_tokens':128000,'reasoning':{'effort':'max'}}}

    def start(self, body):
        return self.client.post('/api/executions',headers=self.headers,json=body)

    def test_six_calls_survive_reader_disconnect_and_remain_grouped_after_reload(self):
        entered = threading.Barrier(7)
        release = threading.Event()
        def upstream(*args, **kwargs):
            response = Mock(status_code=200)
            def chunks(**unused):
                yield b'data: {"choices":[{"delta":{"reasoning":"PRIVATE INTERNAL REASONING"}}]}\n\n'
                entered.wait(timeout=10)
                release.wait(timeout=10)
                yield 'data: {"choices":[{"delta":{"content":"<!DOCTYPE html><html>✅</html>"},"finish_reason":"stop"}],"usage":{"cost":0.01}}\n\n'.encode()
                yield b'data: [DONE]\n\n'
            response.iter_content.side_effect=chunks
            return response
        with ThreadPoolExecutor(max_workers=6) as pool, patch('server.executions.POOL',pool), patch('server.proxy.requests.request',side_effect=upstream) as api:
            try:
                for i in range(1,7): self.assertEqual(self.start(self.body(i)).status_code,202)
                entered.wait(timeout=10)
                # No reader stays connected. Six workers proceed, while ordinary
                # page requests and a newly loaded Runs view remain responsive.
                self.assertEqual(self.client.get('/healthz').status_code,200)
                rows = self.client.get('/api/executions').json['calls']
                self.assertEqual(len(rows),6)
                self.assertEqual(len({r['context']['promptId'] for r in rows}),3)
                self.assertEqual({r['state'] for r in rows},{'reasoning'})
                self.assertNotIn('PRIVATE',json.dumps(rows))
            finally: release.set()
        self.assertEqual(api.call_count,6)
        rows = self.client.get('/api/executions').json['calls']
        self.assertEqual({r['state'] for r in rows},{'ok'})
        for row in rows:
            result=self.client.get('/api/executions/'+row['id']).json
            self.assertIn('✅',result['output'])
            self.assertEqual(result['usage']['cost'],.01)
            self.assertEqual(result['settings']['reasoning_effort'],'max')
        # Same launch ID is idempotent and never calls the provider again.
        with patch('server.executions.POOL.submit') as submit:
            self.assertEqual(self.start(self.body(1)).status_code,200)
            changed=self.body(1);changed['request']['messages']=[]
            self.assertEqual(self.start(changed).status_code,409)
            submit.assert_not_called()

    def test_auth_csrf_and_legacy_history_are_preserved(self):
        self.assertEqual(self.app.test_client().get('/api/executions').status_code,401)
        self.assertEqual(self.client.post('/api/executions',json=self.body()).status_code,403)
        with self.app.app_context():
            a=Activity({'model':'legacy/model'});a.observe({'choices':[{'delta':{'content':'old code'}}]});a.finish('cancelled')
        row=self.client.get('/api/executions').json['calls'][0]
        self.assertFalse(row['durable']);self.assertEqual(row['context'],{})
        self.assertFalse(row['has_output']);self.assertEqual(row['output_chars'],8)

    def test_cancel_queued_call_does_not_start_a_paid_request(self):
        with patch('server.executions.POOL.submit'):
            self.start(self.body())
        self.assertEqual(self.client.post('/api/executions/'+self.body()['id']+'/stop',headers=self.headers).status_code,200)
        with patch('server.proxy.requests.request') as api:
            run_execution(self.app,self.body()['id'],self.body()['request'],{})
            api.assert_not_called()
        self.assertEqual(self.client.get('/api/executions').json['calls'][0]['state'],'cancelled')

    def test_failed_cost_and_partial_code_survive_and_dead_worker_is_interrupted(self):
        body=self.body()
        with patch('server.executions.POOL.submit'):
            self.start(body)
        upstream=Mock(status_code=200)
        upstream.iter_content.return_value=[b'data: {"choices":[{"delta":{"content":"<html>partial"},"finish_reason":"length"}],"usage":{"cost":0.2}}\n\n',b'data: [DONE]\n\n']
        with patch('server.proxy.requests.request',return_value=upstream):
            run_execution(self.app,body['id'],body['request'],{})
        result=self.client.get('/api/executions/'+body['id']).json
        self.assertEqual(result['state'],'error');self.assertEqual(result['output'],'<html>partial')
        self.assertEqual(result['usage']['cost'],.2)
        with self.app.app_context():
            db().execute("UPDATE browser_executions SET state='running',worker='pending:999999:missing'");db().commit()
        result=self.client.get('/api/executions/'+body['id']).json
        self.assertEqual(result['state'],'interrupted');self.assertEqual(result['output'],'<html>partial')

    def test_unterminated_final_event_and_typed_summary_are_preserved(self):
        body=self.body()
        with patch('server.executions.POOL.submit'): self.start(body)
        upstream=Mock(status_code=200)
        upstream.iter_content.return_value=[b'data: {"choices":[{"delta":{"reasoning":"PRIVATE", "reasoning_details":[{"type":"reasoning.summary","summary":"Synthese publique"}]}}]}\n\n',
            b'data: {"choices":[{"delta":{"content":"<html>ok</html>"},"finish_reason":"stop"}],"usage":{"cost":0.01}}']
        with patch('server.proxy.requests.request',return_value=upstream):run_execution(self.app,body['id'],body['request'],{})
        result=self.client.get('/api/executions/'+body['id']).json
        self.assertEqual(result['output'],'<html>ok</html>');self.assertEqual(result['state'],'ok')
        self.assertEqual(result['summary'],'Synthese publique');self.assertNotIn('PRIVATE',json.dumps(result))

    def test_stopping_one_running_call_preserves_its_partial_and_the_peer(self):
        entered=threading.Barrier(3);release=threading.Event()
        def upstream(*args,**kwargs):
            response=Mock(status_code=200)
            def chunks(**unused):
                yield b'data: {"choices":[{"delta":{"content":"<html>partial"}}]}\n\n'
                entered.wait(timeout=10);release.wait(timeout=10)
                yield b'data: {"choices":[{"delta":{"content":"</html>"},"finish_reason":"stop"}]}\n\n'
            response.iter_content.side_effect=chunks
            return response
        with ThreadPoolExecutor(max_workers=2) as pool,patch('server.executions.POOL',pool),patch('server.proxy.requests.request',side_effect=upstream):
            try:
                self.start(self.body(1));self.start(self.body(2));entered.wait(timeout=10)
                self.client.post('/api/executions/'+self.body(1)['id']+'/stop',headers=self.headers)
                time.sleep(2.1) # The existing proxy reads cancellation at most once every 2 seconds.
            finally:release.set()
        first=self.client.get('/api/executions/'+self.body(1)['id']).json
        second=self.client.get('/api/executions/'+self.body(2)['id']).json
        self.assertEqual(first['state'],'cancelled');self.assertEqual(first['output'],'<html>partial')
        self.assertEqual(second['state'],'ok');self.assertEqual(second['output'],'<html>partial</html>')


if __name__ == '__main__': unittest.main()
