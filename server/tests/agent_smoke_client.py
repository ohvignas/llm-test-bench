"""Run inside the disposable smoke bench, never the real user installation."""
import http.cookiejar
import io
import json
import time
import urllib.request
import uuid
import zipfile

BASE='http://127.0.0.1:8080'
ORIGIN='http://127.0.0.1:18085'
client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
csrf=''


def call(path,data=None,method=None):
    req=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,method=method,
        headers={'Content-Type':'application/json','Origin':ORIGIN,'Host':'127.0.0.1:18085',**({'X-CSRF-Token':csrf} if csrf else {})})
    with client.open(req,timeout=20) as response:return json.load(response)


if __name__=='__main__':
    route='setup' if call('/api/auth/status')['needs_setup'] else 'login'
    csrf=call('/api/auth/'+route,{'username':'smoke','password':'fixture-password-not-real'})['csrfToken']
    call('/api/settings/key',{'key':'fixture-only-key-not-real'},'PUT')
    sessions=[]
    for repair in (False,True):
        run_id=uuid.uuid4().hex
        call('/api/executions',{'id':run_id,'context':{'promptId':'fixture-'+str(repair),'title':'Mastra offline '+str(repair),'groupId':'smoke','engine':'mastra','agentLimits':{'maxSteps':8,'budgetUsd':1}},
            'request':{'model':'fixture/coding-agent','messages':[{'role':'user','content':'Créer une page interactive'+(' [repair-test]' if repair else '')}],'stream':True,'max_tokens':2000,'reasoning':{'effort':'high'}}})
        sessions.append((run_id,repair))
    listing=call('/api/executions')['calls']
    assert all(any(c['id']==run_id for c in listing) for run_id,_ in sessions)
    # Fresh independent GETs are the same protocol a reloaded comparison uses.
    for run_id,repair in sessions:
        for _ in range(150):
            result=call('/api/executions/'+run_id)
            if result['state'] not in ('queued','running','connecting','waiting','reasoning','writing'):break
            time.sleep(.4)
        expected=6 if repair else 4
        assert result['state']=='ok',result['error']
        assert len(result['agent']['steps'])==expected,result['agent']['steps']
        assert abs(result['usage']['cost']-.001*expected)<1e-9
        assert 'Chaîne Mastra' in result['output']
        if repair:assert any('Erreur de construction' in e['message'] for e in result['agent']['events'])
        req=urllib.request.Request(BASE+'/api/executions/'+run_id+'/sources.zip',headers={'Host':'127.0.0.1:18085'})
        with client.open(req) as response:
            archive=zipfile.ZipFile(io.BytesIO(response.read()));assert 'src/main.ts' in archive.namelist()
        print(json.dumps({'scenario':'repair' if repair else 'success','state':result['state'],'api_calls':expected,'simulated_usd':result['usage']['cost'],'html_chars':result['output_chars'],'sources_zip':True}),flush=True)
    print('PASS: two parallel Mastra agents, real Docker tools, compiler-error recovery, Chromium, durable checkpoints and separate simulated invoices. Actual OpenRouter spend: zero.')
