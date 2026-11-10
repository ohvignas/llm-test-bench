import copy
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from server.app import create_app
from server.control import main
from server.jobs import Store, plan, execute, run_call, policies, settings, reconcile, safe_gallery
from server.storage import db


def model(name):
    return {'id':name,'name':name,'supported_parameters':['reasoning','max_tokens'],
            'top_provider':{'context_length':200000,'max_completion_tokens':128000},
            'reasoning':{'mandatory':True,'supported_efforts':['high','medium','low']},
            'pricing':{'prompt':'0.000001','completion':'0.000002'}}
HTML='<!DOCTYPE html><HTML><body><button>Bonjour</button></body></HTML>'


def reply(text=HTML,cost=.001,code=None):
    return {'text':text,'usage':{} if cost is None else {'cost':cost},'error':str(code) if code else None,'code':code,'finish_reason':'length' if code=='OUTPUT_TOKEN_LIMIT' else 'stop','request_id':'gen-test123'}


class JobsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'data'
        self.app=create_app({'TESTING':True,'DATA_DIR':self.root,'SECRETS_DIR':Path(self.temp.name)/'secrets','SERVER_NAME':'127.0.0.1:8085'})
        self.ctx=self.app.app_context();self.ctx.push();self.addCleanup(self.ctx.pop)
        self.store=Store(self.root)
        self.models={'model/a':model('model/a'),'model/b':model('model/b')}
        patcher=patch('server.jobs.catalogue',return_value=self.models);patcher.start();self.addCleanup(patcher.stop)
    def job(self,models=None,**kwargs):
        return plan(self.app,models or ['model/a'],[],kwargs.pop('budget',1),custom={'id':'custom','title':'Démo','prompt':'Crée un bouton interactif','set':'custom'},**kwargs)['id']
    def key(self):
        db().execute('INSERT OR REPLACE INTO settings VALUES (?,?)',('openrouter_key',self.app.extensions['vault'].encrypt(b'fake-secret-test')));db().commit()
    def test_planning_never_calls_provider_and_has_price_ceiling(self):
        with patch('server.proxy.requests.request') as paid:
            job=self.job(models=['model/a','model/b'],max_output=4096)
            result=self.store.summary(job)
            self.assertEqual(len(result['items']),2);paid.assert_not_called()
            self.assertEqual(result['items'][0]['params']['provider']['max_price']['request'],0)
            self.assertNotIn('prompt',result['items'][0])
    def test_insufficient_budget_and_invalid_cap_rejected_before_job(self):
        for options in ({'budget':.00001},{'max_output':256000},{'max_output':0}):
            with self.assertRaises(ValueError):self.job(**options)
    def test_learning_uses_low_after_reasoning_exhaustion(self):
        directory=self.root/'files/_telemetry/generations';directory.mkdir(parents=True)
        (directory/'1.jsonl').write_text(json.dumps({'modelId':'model/a','finishReason':'length','responseChars':0})+'\n')
        job=self.job(max_output=4096)
        self.assertEqual(self.store.read(job)['items'][0]['params']['reasoning'],{'effort':'low'})
        self.assertNotIn('max_tokens',self.store.read(job)['items'][0]['params']['reasoning'])
    def test_model_failure_does_not_cancel_other_lane_and_resume_skips_saved(self):
        count={};barrier=threading.Barrier(2)
        def call(_app,payload,*_):
            name=payload['model'];count[name]=count.get(name,0)+1
            if count[name]==1:barrier.wait(timeout=3)
            return reply(code=400,text='') if name=='model/a' else reply()
        job=self.job(models=['model/a','model/b'],max_output=4096)
        result=execute(self.app,job,call)
        self.assertEqual([i['state'] for i in result['items']],['blocked','saved'])
        execute(self.app,job,call)
        self.assertEqual(count,{'model/a':1,'model/b':1})
        self.assertAlmostEqual(result['confirmed_usd'],.002)
    def test_budget_is_reserved_under_concurrent_workers(self):
        def call(_app,payload,*_):return reply(text='<html><body>Partial',cost=.007,code='OUTPUT_TOKEN_LIMIT')
        job=self.job(models=['model/a','model/b'],max_output=1024,budget=.012)
        result=execute(self.app,job,call)
        self.assertLessEqual(sum(len(i['attempts']) for i in result['items']),2)
        # Simulated costs can exceed reservations; a provider overrun must block all future calls.
        self.assertTrue(any(i['state']=='budget-blocked' for i in result['items']))
    def test_unknown_cost_is_retained_and_no_second_call(self):
        job=self.job(max_output=4096)
        call=Mock(return_value=reply(text='',cost=None,code=503))
        result=execute(self.app,job,call)
        self.assertEqual(result['items'][0]['state'],'cost-unknown');call.assert_called_once()
        execute(self.app,job,call);call.assert_called_once()
        self.assertEqual(result['items'][0]['attempts'][0]['request_id'],'gen-test123')
    def test_partial_is_saved_before_completion_and_costs_all_attempts(self):
        calls=[]
        def call(_app,payload,*_):
            calls.append(payload)
            if len(calls)==1:return reply(text='<html><body>Preserve this',code='OUTPUT_TOKEN_LIMIT')
            self.assertTrue(list((self.root/'files/prompt-gallery').rglob('*.html')))
            self.assertIn('Preserve this',payload['messages'][1]['content'])
            return reply()
        result=execute(self.app,self.job(max_output=4096),call)
        self.assertEqual(result['state'],'completed');self.assertEqual(len(calls),2)
        self.assertEqual(calls[1]['reasoning']['effort'],'medium')
        self.assertAlmostEqual(result['confirmed_usd'],.002)
    def test_low_effort_exhaustion_never_repeats_identically(self):
        call=Mock(return_value=reply(text='',code='OUTPUT_TOKEN_LIMIT'))
        job=self.job(effort='low',max_output=4096)
        result=execute(self.app,job,call)
        self.assertEqual(result['items'][0]['state'],'reasoning-exhausted')
        execute(self.app,job,call);call.assert_called_once()
    def test_three_calls_max(self):
        call=Mock(return_value=reply(text='<html><body>partial',code='OUTPUT_TOKEN_LIMIT'))
        job=self.job(max_output=4096)
        execute(self.app,job,call);execute(self.app,job,call)
        self.assertEqual(call.call_count,3)
    def test_duplicate_worker_does_not_launch_again(self):
        import fcntl
        job=self.job(max_output=4096)
        with (self.store.path(job)/'runner.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            with self.assertRaises(ValueError):execute(self.app,job,Mock())
            with patch('server.control.create_app',return_value=self.app),patch('server.control.subprocess.Popen') as popen,patch('sys.stdout',new_callable=io.StringIO):
                main(['resume',job,'--execute','--json'])
                popen.assert_not_called()
    def test_job_and_gallery_paths_cannot_escape(self):
        for name in ('../outside','/tmp','bad/name'):
            with self.assertRaises(ValueError):safe_gallery(self.root,name)
        root=self.root/'files/prompt-gallery';root.mkdir(parents=True)
        (root/'link').symlink_to(self.temp.name)
        with self.assertRaises(ValueError):safe_gallery(self.root,'link')
        with self.assertRaises(ValueError):self.store.path('../../secrets')
    def test_real_relay_parser_keeps_usage_last_line_and_uppercase_html(self):
        self.key();upstream=Mock(status_code=200)
        payload={'model':'model/a','messages':[],'stream':True,'max_tokens':4096}
        events=[{'id':'gen-test123','choices':[{'delta':{'reasoning':'PRIVATE REASONING'}}]},
                {'id':'gen-test123','choices':[{'delta':{'content':HTML},'finish_reason':'stop'}]},
                {'usage':{'cost':.004,'completion_tokens':45}}]
        wire=b'\n\n'.join(b'data: '+json.dumps(e).encode() for e in events)
        upstream.iter_content.return_value=[wire[:13],wire[13:]]
        log=[]
        with patch('server.proxy.requests.request',return_value=upstream) as request:
            result=run_call(self.app,payload,{'id':'a'*32,'limit':3},log.append,lambda _:True)
        self.assertIsNone(result['error']);self.assertEqual(result['usage']['cost'],.004)
        self.assertEqual(result['text'],HTML);self.assertNotIn('PRIVATE REASONING',json.dumps(log))
        request.assert_called_once();self.assertEqual(request.call_args.kwargs['headers']['Authorization'],'Bearer fake-secret-test')
        upstream.close.assert_called_once()
    def test_real_proxy_blocks_fresh_automatic_run_after_low_effort_exhaustion(self):
        self.key();upstream=Mock(status_code=200)
        upstream.iter_content.return_value=[b'data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"cost":0.01}}\n\n']
        payload={'model':'model/a','messages':[],'stream':True,'max_tokens':4096,'reasoning':{'effort':'low'}}
        with patch('server.proxy.requests.request',return_value=upstream) as request:
            first=run_call(self.app,payload,{'id':'a'*32,'limit':3},lambda _:None,lambda _:True)
            second=run_call(self.app,payload,{'id':'b'*32,'limit':3},lambda _:None,lambda _:True)
        self.assertEqual(first['code'],'OUTPUT_TOKEN_LIMIT')
        self.assertEqual(second['code'],409);self.assertFalse(second['request_sent'])
        request.assert_called_once()

    def test_cost_reconciliation_does_not_generate(self):
        self.key();job=self.job(max_output=4096)
        execute(self.app,job,Mock(return_value=reply(cost=None)))
        response=Mock(status_code=200);response.json.return_value={'data':{'total_cost':.012,'finish_reason':'stop'}}
        with patch('server.jobs.requests.get',return_value=response),patch('server.proxy.requests.request') as paid:
            result=reconcile(self.app,job)
            paid.assert_not_called()
        self.assertEqual(result['state'],'completed');self.assertAlmostEqual(result['confirmed_usd'],.012)
    def test_cli_requires_explicit_execute(self):
        with patch('sys.stderr',new_callable=io.StringIO),self.assertRaises(SystemExit):main(['run','a'*32])

if __name__=='__main__':unittest.main()
