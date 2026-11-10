"""Offline end-to-end fixture. Never imports a real API key or calls OpenRouter.

Run only in a disposable test container with a separate DATA_DIR and control
volume. The real Mastra controller and Docker tools connect to this fake model.
"""
import json
from unittest.mock import Mock

from server.app import create_app
import server.jobs
import server.proxy


def create_smoke_app():
    app=create_app()
    model={'id':'fixture/coding-agent','supported_parameters':['tools','max_tokens','reasoning'],
           'pricing':{'prompt':'.000001','completion':'.000002'},'top_provider':{'max_completion_tokens':2000}}
    server.jobs.catalogue=lambda:{model['id']:model}

    def fake_provider(method,url,**kwargs):
        if url!='https://openrouter.ai/api/v1/chat/completions':raise AssertionError('Unexpected external destination')
        body=kwargs['json'];assert body['model']==model['id']
        count=sum(message.get('role')=='tool' for message in body['messages'])
        repair='[repair-test]' in json.dumps(body['messages'])
        if repair and count==0:name,args='write_file',{'path':'src/main.ts','content':'const broken: = ;'}
        elif repair and count==1:name,args='build_project',{}
        elif count==(2 if repair else 0):
            name,args='write_file',{'path':'src/main.ts','content':"document.title='Test Mastra';document.getElementById('app')!.innerHTML='<h1>Chaîne Mastra vérifiée</h1><button id=add>Ajouter</button><p id=count>0</p>';let n=0;document.getElementById('add')!.onclick=()=>document.getElementById('count')!.textContent=String(++n);"}
        elif count==(3 if repair else 1):name,args='build_project',{}
        elif count==(4 if repair else 2):name,args='test_project',{}
        else:name,args=None,None
        delta={'tool_calls':[{'index':0,'id':'fixture-'+str(count),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]} if name else {'content':'Projet construit et test de démarrage effectué.'}
        base={'id':'fixture-response-'+str(count),'model':model['id'],'object':'chat.completion.chunk','created':1}
        chunks=[{'choices':[{'index':0,'delta':delta,'finish_reason':None}]},
                {'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if name else 'stop'}],
                 'usage':{'prompt_tokens':100,'completion_tokens':200,'total_tokens':300,'cost':.001}}]
        response=Mock(status_code=200)
        response.iter_content.return_value=[('data: '+json.dumps({**base,**chunk})+'\n\n').encode() for chunk in chunks]+[b'data: [DONE]\n\n']
        return response
    server.proxy.requests.request=fake_provider
    return app
