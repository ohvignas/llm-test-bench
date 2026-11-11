import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from server.app import create_app
from server.operator_socket import launch_batch, send_plan, start_operator
from server.storage import db


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.app=create_app({'TESTING':True,'DATA_DIR':root/'data','SECRETS_DIR':root/'secrets',
                             'MASTRA_URL':'http://mastra:8090','AGENT_CONTROL_DIR':root/'control'})
        self.plan={'budgetUsd':.5,'executions':[
            {'id':letter*32,'request':{'model':'test/'+letter,'messages':[{'role':'user','content':'Build a counter'}],
             'stream':True,'max_tokens':2048,'reasoning':{'effort':'low'}},
             'context':{'engine':'mastra','groupId':'operator-test','agentLimits':{'maxSteps':4,'budgetUsd':.25}}}
            for letter in ('a','b')]}

    def test_full_plan_validated_before_first_enqueue(self):
        self.plan['executions'][1]['context']['agentLimits']['budgetUsd']=.3
        with patch('server.executions.POOL.submit') as submit:
            with self.assertRaises(ValueError):launch_batch(self.app,self.plan)
        submit.assert_not_called()
        with self.app.app_context():self.assertEqual(db().execute('SELECT COUNT(*) FROM browser_executions').fetchone()[0],0)

    def test_same_reviewed_plan_is_idempotent_and_runs_in_server(self):
        with patch('server.executions.POOL.submit') as submit:
            self.assertEqual(len(launch_batch(self.app,self.plan)['executions']),2)
            launch_batch(self.app,self.plan)
        self.assertEqual(submit.call_count,2)
        self.assertIs(submit.call_args.args[1],self.app)
        with self.app.app_context():
            contexts=[json.loads(r[0]) for r in db().execute('SELECT context FROM browser_executions')]
        self.assertTrue(all(c['engine']=='mastra' for c in contexts))

    def test_socket_is_private_and_launches_no_duplicate_provider_call(self):
        path=str(Path(self.temp.name)/'operator.sock')
        server=start_operator(self.app,path)
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        self.assertEqual(os.stat(path).st_mode & 0o777,0o600)
        with patch('server.executions.POOL.submit') as submit:
            result=send_plan(self.plan,path)
            self.assertTrue(result['ok']);send_plan(self.plan,path)
        self.assertEqual(submit.call_count,2)

    def test_no_http_operator_route_or_credential_bypass(self):
        response=self.app.test_client().post('/operator-local',json=self.plan)
        self.assertEqual(response.status_code,403)
        self.plan['executions'][1]['request']['messages'][0]['role']='tool'
        with patch('server.executions.POOL.submit') as submit:
            with self.assertRaises(ValueError):launch_batch(self.app,self.plan)
        submit.assert_not_called()
