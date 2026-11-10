import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock,patch

from server.app import create_app
from server.storage import db
from server.agents import agent_record,save_sources,run_agent_execution


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);root=Path(self.temp.name)
        self.app=create_app({'TESTING':True,'DATA_DIR':root/'data','SECRETS_DIR':root/'secrets',
            'MASTRA_URL':'http://mastra:8090','AGENT_CONTROL_DIR':root/'control','SERVER_NAME':'127.0.0.1:8085'})
        self.client=self.app.test_client();self.headers={'Origin':'http://127.0.0.1:8085'}
        result=self.client.post('/api/auth/setup',headers=self.headers,json={'username':'test','password':'dummy-long-password'})
        self.headers['X-CSRF-Token']=result.json['csrfToken']
        self.client.put('/api/settings/key',headers=self.headers,json={'key':'dummy-private-key'})
        self.id='a'*32

    def start(self,steps=3,budget=1):
        body={'id':self.id,'context':{'promptId':'p','title':'Projet','engine':'mastra','agentLimits':{'maxSteps':steps,'budgetUsd':budget}},
              'request':{'model':'test/model','messages':[{'role':'user','content':'Build'}],'stream':True,'max_tokens':1000,'reasoning':{'effort':'high'}}}
        with patch('server.executions.POOL.submit') as submit:
            response=self.client.post('/api/executions',headers=self.headers,json=body)
        return response,submit

    def session(self,steps=3,budget=1):
        response,submit=self.start(steps,budget);self.assertEqual(response.status_code,202)
        from server.agents import run_agent_execution
        self.assertIs(submit.call_args.args[0],run_agent_execution)
        session={'token':'ephemeral-test-token','payload':{'model':'test/model','max_tokens':1000,'reasoning':{'effort':'high'}},
                 'limits':{'maxSteps':steps,'budgetUsd':budget},'calls':0,'spent':0,'prices':(.000001,.000002,0),'lock':threading.Lock()}
        self.app.extensions['agent_sessions'][self.id]=session
        with self.app.app_context():
            db().execute('INSERT INTO agent_runs(execution_id,limits) VALUES (?,?)',(self.id,json.dumps(session['limits'])));db().commit()
        return session

    def provider(self,model='test/model',token='ephemeral-test-token'):
        return self.client.post('/api/agent-provider/'+self.id+'/v1/chat/completions',
            headers={'Authorization':'Bearer '+token,'Host':'bench:8080'},json={'model':model,'messages':[{'role':'user','content':'Build'}],'stream':True,'max_tokens':999999})

    def mock_upstream(self,cost=.01):
        result=Mock(status_code=200)
        usage={} if cost is None else {'cost':cost,'prompt_tokens':10,'completion_tokens':20,'total_tokens':30}
        data={'choices':[{'delta':{'content':'ok'},'finish_reason':'stop'}],'usage':usage}
        result.iter_content.return_value=[('data: '+json.dumps(data)+'\n\ndata: [DONE]\n\n').encode()]
        return result

    def test_internal_token_is_scoped_and_cannot_access_the_file_api(self):
        self.session()
        with patch('server.proxy.requests.request') as api:
            self.assertEqual(self.provider(token='wrong').status_code,401)
            self.assertEqual(self.provider(model='other/model').status_code,400)
            self.assertEqual(self.app.test_client().get('/api/executions',headers={'Authorization':'Bearer ephemeral-test-token'}).status_code,401)
            api.assert_not_called()

    def test_each_step_uses_reviewed_parameters_and_records_real_provider_cost_once(self):
        session=self.session(steps=1)
        with patch('server.proxy.requests.request',return_value=self.mock_upstream()) as api:
            response=self.provider();self.assertEqual(response.status_code,200);response.get_data();response.close()
            sent=api.call_args.kwargs
            self.assertEqual(sent['headers']['Authorization'],'Bearer dummy-private-key')
            self.assertEqual(sent['json']['max_tokens'],1000)
            self.assertEqual(sent['json']['reasoning'],{'effort':'high'})
            self.assertEqual(session['spent'],.01)
            with self.app.app_context():self.assertEqual(agent_record(self.id)['confirmed_usd'],.01)
            self.assertEqual(self.provider().status_code,409);self.assertEqual(api.call_count,1)

    def test_budget_and_missing_invoice_block_further_calls_before_the_provider(self):
        self.session(budget=.00001)
        with patch('server.proxy.requests.request') as api:
            self.assertEqual(self.provider().status_code,409);api.assert_not_called()
        self.app.extensions['agent_sessions'][self.id]['limits']['budgetUsd']=1
        with patch('server.proxy.requests.request',return_value=self.mock_upstream(None)) as api:
            result=self.provider();result.get_data();result.close()
            self.assertEqual(self.provider().status_code,409);self.assertEqual(api.call_count,1)

    def test_source_checkpoints_are_encrypted_and_preview_replacement_resets_the_reader(self):
        self.session()
        with self.app.app_context():
            save_sources(self.id,{'src/main.ts':'private saved source'})
            row=db().execute('SELECT sources FROM agent_runs').fetchone();self.assertNotIn(b'private saved source',row[0])
            db().execute("UPDATE browser_executions SET output='<!doctype html><html>new</html>',output_revision=2 WHERE id=?",(self.id,));db().commit()
        value=self.client.get('/api/executions/'+self.id+'?offset=100000&revision=1').json
        self.assertTrue(value['output_reset']);self.assertIn('new',value['delta'])
        self.assertNotIn('private saved source',json.dumps(value))

    def test_mastra_worker_preserves_sources_and_compiled_output_without_a_paid_call(self):
        self.start()
        events=[{'type':'files','files':{'src/main.ts':'saved code'}},{'type':'preview','html':'<!doctype html><html>Built</html>'},
                {'type':'activity','tool':'build_project','message':'Build complete'},{'type':'done','message':'Done'}]
        response=Mock(status_code=200);response.iter_lines.return_value=[json.dumps(e).encode() for e in events]
        model={'id':'test/model','supported_parameters':['tools'],'pricing':{'prompt':'.000001','completion':'.000002'}}
        with patch('server.jobs.catalogue',return_value={'test/model':model}),patch('server.agents.requests.post',return_value=response) as runner:
            run_agent_execution(self.app,self.id,{'model':'test/model','messages':[{'role':'user','content':'Build'}],'max_tokens':1000},{})
            body=runner.call_args.kwargs['json'];self.assertNotIn('dummy-private-key',json.dumps(body))
        result=self.client.get('/api/executions/'+self.id).json
        self.assertEqual(result['state'],'ok');self.assertIn('Built',result['output']);self.assertTrue(result['agent']['has_sources'])
        self.assertEqual(result['agent']['steps'],[])

    def test_explicit_stop_signals_only_its_agent_and_no_new_provider_call(self):
        self.session()
        with patch('server.agents.requests.post') as stop,patch('server.proxy.requests.request') as api:
            response=self.client.post('/api/executions/'+self.id+'/stop',headers=self.headers)
            self.assertEqual(response.status_code,200);self.assertIn(self.id+'/stop',stop.call_args.args[0]);api.assert_not_called()

    def test_invalid_limits_fail_before_enqueue(self):
        response,submit=self.start(steps=100,budget=1);self.assertEqual(response.status_code,400);submit.assert_not_called()

    def test_agent_remains_visible_to_operator_between_provider_steps(self):
        self.session()
        from server.diagnostics import status
        with self.app.app_context():
            report=status(self.app.config['DATA_DIR'])
        self.assertEqual(report['active_calls'],1)
        self.assertEqual(report['active_agents'][0]['id'],self.id)

    def test_sources_without_html_can_be_resumed_with_the_same_limits(self):
        self.session()
        with self.app.app_context():
            save_sources(self.id,{'src/main.ts':'saved TypeScript'})
            db().execute("UPDATE browser_executions SET state='error' WHERE id=?",(self.id,));db().commit()
        plan=self.client.post('/api/executions/'+self.id+'/recovery-plan',headers=self.headers,json={}).json
        self.assertTrue(plan['has_sources']);self.assertEqual(plan['mode'],'continue');self.assertEqual(plan['engine'],'mastra')
        new_id='b'*32
        with patch('server.executions.POOL.submit') as submit:
            result=self.client.post('/api/executions/'+self.id+'/recover',headers=self.headers,json={'id':new_id,'confirmed':True})
        self.assertEqual(result.status_code,202)
        args=submit.call_args.args
        response=Mock(status_code=200);response.iter_lines.return_value=[json.dumps({'type':'done','message':'test'}).encode()]
        model={'id':'test/model','supported_parameters':['tools'],'pricing':{'prompt':'.000001','completion':'.000002'}}
        with patch('server.jobs.catalogue',return_value={'test/model':model}),patch('server.agents.requests.post',return_value=response) as runner:
            run_agent_execution(*args[1:])
            config=runner.call_args.kwargs['json'];self.assertEqual(config['files'],{'src/main.ts':'saved TypeScript'});self.assertEqual(config['maxSteps'],3)

    def test_source_zip_requires_user_authentication(self):
        self.session()
        with self.app.app_context():save_sources(self.id,{'src/main.ts':'export const value = 1;'})
        self.assertEqual(self.app.test_client().get('/api/executions/'+self.id+'/sources.zip').status_code,401)
        result=self.client.get('/api/executions/'+self.id+'/sources.zip')
        self.assertEqual(result.status_code,200);self.assertIn('attachment',result.headers['Content-Disposition'])
