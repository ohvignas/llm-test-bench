"""Mastra control and per-step provider authorization. The API key stays here.

The Node controller cannot change the selected model or the reviewed parameters.
Generated commands run in separate offline containers without either control token.
"""
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import secrets
import threading
import time
import uuid
import zipfile

from flask import Blueprint, Response, abort, current_app, g, jsonify, request, stream_with_context,send_file
import requests

from .auth import json_object
from .diagnostics import redact
from .storage import db

agents = Blueprint('agents', __name__)
TOOL_NAMES = {'write_file','read_file','list_files','execute_command','build_project','test_project'}
MAX_SOURCES = 8*1024*1024


def agent_limits(value=None):
    value = {} if value is None else value
    if not isinstance(value,dict):abort(400,description='Limites de l’agent invalides.')
    steps, budget = value.get('maxSteps',8), value.get('budgetUsd',10)
    if (type(steps) is not int or not 1<=steps<=16 or type(budget) not in (int,float)
            or not math.isfinite(budget) or not 0<budget<=100):
        abort(400,description='Agent : entre 1 et 16 appels, et un budget entre 0 et 100 $US sont requis.')
    return {'maxSteps':steps,'budgetUsd':budget}


def initialize_agent_control(app):
    app.extensions['agent_sessions'] = {}
    app.extensions['agent_sessions_lock'] = threading.Lock()
    if not app.config['MASTRA_URL']:
        return
    root=Path(app.config['AGENT_CONTROL_DIR']);root.mkdir(exist_ok=True,parents=True,mode=0o700)
    path=root/'token'
    try:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd,'w') as handle: handle.write(secrets.token_hex(32))
    if path.is_symlink():raise RuntimeError('Jeton de contrôle : lien symbolique interdit.')
    app.extensions['agent_control_token']=path.read_text().strip()


def internal_agent_request():
    match=re.fullmatch(r'/api/agent-provider/([a-f0-9]{32})/v1/chat/completions',request.path)
    if not match:return False
    session=current_app.extensions['agent_sessions'].get(match[1])
    supplied=request.headers.get('Authorization','').removeprefix('Bearer ')
    if request.method!='POST' or not session or not secrets.compare_digest(supplied,session['token']):
        abort(401,description='Session agent non autorisée.')
    g.agent_session=session
    return True


def agent_record(call_id):
    row=db().execute('SELECT * FROM agent_runs WHERE execution_id=?',(call_id,)).fetchone()
    if not row:return None
    steps=[]
    for item in db().execute('''SELECT a.* FROM generation_activity a JOIN agent_steps s
            ON s.activity_id=a.id WHERE s.execution_id=? ORDER BY s.step''',(call_id,)):
        steps.append({k:item[k] for k in ('id','started','updated','state','finish_reason','reasoning_events')}|{'usage':json.loads(item['usage'])})
    known=[s['usage']['cost'] for s in steps if isinstance(s['usage'].get('cost'),(int,float))]
    return {'engine':'mastra','limits':json.loads(row['limits']),'events':json.loads(row['events']),
            'steps':steps,'has_sources':bool(row['sources']),'missing_costs':len(steps)-len(known),
            'confirmed_usd':sum(known) if known else None}


def log_agent(call_id,message,tool=None):
    row=db().execute('SELECT events FROM agent_runs WHERE execution_id=?',(call_id,)).fetchone()
    if not row:return
    events=json.loads(row['events']);events.append({'id':uuid.uuid4().hex,'at':time.time()*1000,'message':redact(message,2000),**({'tool':tool} if tool in TOOL_NAMES else {})})
    events=events[-400:]
    size=sum(len(e['message'].encode()) for e in events)
    while size>64000 and len(events)>1:size-=len(events.pop(0)['message'].encode())
    db().execute('UPDATE agent_runs SET events=? WHERE execution_id=?',(json.dumps(events,ensure_ascii=False),call_id));db().commit()
    db().execute('UPDATE browser_executions SET updated=? WHERE id=?',(time.time(),call_id));db().commit()


def sources_of(call_id):
    row=db().execute('SELECT sources FROM agent_runs WHERE execution_id=?',(call_id,)).fetchone()
    return json.loads(current_app.extensions['vault'].decrypt(row['sources'])) if row and row['sources'] else {}


def save_sources(call_id,files):
    if (not isinstance(files,dict) or len(files)>100 or len(json.dumps(files).encode())>MAX_SOURCES
            or any(not isinstance(k,str) or not isinstance(v,str) or k.startswith('/') or '\\' in k
                   or any(not p or p.startswith('.') or p=='node_modules' for p in k.split('/')) for k,v in files.items())):
        raise ValueError('Sources hors des limites du projet.')
    encrypted=current_app.extensions['vault'].encrypt(json.dumps(files,ensure_ascii=False).encode())
    db().execute('UPDATE agent_runs SET sources=? WHERE execution_id=?',(encrypted,call_id));db().commit()


@agents.get('/api/executions/<call_id>/sources.zip')
def source_archive(call_id):
    if not re.fullmatch('[a-f0-9]{32}',call_id):abort(404)
    files=sources_of(call_id)
    if not files:abort(404,description='Aucune source conservée pour cet agent.')
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
        for path,content in files.items():archive.writestr(path,content)
    stream.seek(0)
    return send_file(stream,mimetype='application/zip',as_attachment=True,download_name='projet-'+call_id[:8]+'.zip')


@agents.post('/api/agent-provider/<call_id>/v1/chat/completions')
def agent_provider(call_id):
    session=g.agent_session
    body=json_object()
    if body.get('model')!=session['payload']['model'] or not isinstance(body.get('messages'),list):
        abort(400,description='Modèle ou messages de la session invalides.')
    tools=body.get('tools',[])
    if not isinstance(tools,list) or any(not isinstance(t,dict) or not isinstance(t.get('function'),dict) or t['function'].get('name') not in TOOL_NAMES for t in tools):
        abort(400,description='Outil non autorisé.')
    if not session['lock'].acquire(blocking=False):abort(409,description='Une étape de cet agent est déjà en cours.')
    try:
        row=db().execute('SELECT cancel_requested FROM browser_executions WHERE id=?',(call_id,)).fetchone()
        if row is None or row[0]:abort(409,description='Agent arrêté.')
        if session['calls']>=session['limits']['maxSteps']:abort(409,description='Limite d’appels de cet agent atteinte.')
        if session.get('unknown_cost'):abort(409,description='Coût du dernier appel inconnu : aucun nouvel appel automatique.')
        # Parameters from the reviewed browser request win over SDK defaults.
        payload={k:v for k,v in session['payload'].items() if k not in ('messages','tools','tool_choice','stream')}
        payload.update({'messages':body['messages'],'stream':True})
        if body.get('tools'):payload['tools']=body['tools']
        if body.get('tool_choice') is not None:payload['tool_choice']=body['tool_choice']
        output=payload.get('max_tokens',payload.get('max_completion_tokens'))
        if type(output) is not int or output<=0:abort(400,description='Plafond de sortie requis pour l’agent.')
        # UTF-8 byte count bounds text token count conservatively; this is a
        # spending reservation, never the displayed or reported invoice.
        input_bound=len(json.dumps({'messages':payload['messages'],'tools':payload.get('tools',[])},ensure_ascii=False).encode())+1024
        reserve=input_bound*session['prices'][0]+output*session['prices'][1]+session['prices'][2]
        if session['spent']+reserve>session['limits']['budgetUsd']:
            abort(409,description='Budget de l’agent insuffisant pour le plafond demandé. Sources conservées ; aucun nouvel appel envoyé.')
        session['calls']+=1
        payload['provider']={**payload.get('provider',{}),'require_parameters':True,
            'max_price':{'prompt':session['prices'][0]*1_000_000,'completion':session['prices'][1]*1_000_000,'request':session['prices'][2]}}
        payload.pop('plugins',None)
        payload.pop('n',None)
        from .proxy import relay
        with current_app.test_request_context('/api/openrouter/chat/completions',method='POST',json=payload,
                                             headers={'X-Bench-Retry':uuid.uuid4().hex}):
            request.environ['bench.agent_execution_id']=call_id
            response=current_app.make_response(relay())
            activity_id=getattr(g,'bench_activity_id',None)
        if activity_id:
            db().execute('INSERT INTO agent_steps VALUES (?,?,?)',(call_id,session['calls'],activity_id));db().commit()
        log_agent(call_id,f'Appel API {session["calls"]}/{session["limits"]["maxSteps"]} envoyé au modèle.' if activity_id else 'Étape bloquée avant connexion au fournisseur.')
    except BaseException:
        session['lock'].release()
        raise

    def billed():
        try:
            yield from response.response
        finally:
            response.close()
            if activity_id:
                row=db().execute('SELECT usage FROM generation_activity WHERE id=?',(activity_id,)).fetchone()
                usage=json.loads(row[0]) if row else {}
                cost=usage.get('cost')
                if type(cost) in (int,float) and math.isfinite(cost) and cost>=0:session['spent']+=cost
                else:session['unknown_cost']=True
            session['lock'].release()
    return Response(stream_with_context(billed()),status=response.status_code,content_type=response.content_type)


def run_agent_execution(app,call_id,payload,headers):
    from .executions import update
    with app.app_context():
        context=json.loads(db().execute('SELECT context FROM browser_executions WHERE id=?',(call_id,)).fetchone()[0])
        limits=agent_limits(context.get('agentLimits'))
        db().execute('INSERT OR IGNORE INTO agent_runs(execution_id,limits) VALUES (?,?)',(call_id,json.dumps(limits)));db().commit()
        response=None
        try:
            from .jobs import catalogue,prices
            model=catalogue().get(payload['model'])
            if not model or 'tools' not in model.get('supported_parameters',[]):
                raise ValueError('Ce modèle n’annonce pas de prise en charge des outils. Aucun appel envoyé.')
            pricing=tuple(float(p) for p in prices(model))+(float((model.get('pricing') or {}).get('request',0)),)
            if any(not math.isfinite(p) or p<0 for p in pricing):raise ValueError('Tarif fournisseur invalide.')
            # prices() returns conservative catalogue rates, not an invoice.
            session={'token':secrets.token_hex(32),'payload':payload,'limits':limits,'calls':0,'spent':0,
                     'prices':pricing,'lock':threading.Lock()}
            app.extensions['agent_sessions'][call_id]=session
            parent=db().execute('SELECT parent_id,output,cancel_requested FROM browser_executions WHERE id=?',(call_id,)).fetchone()
            if parent['cancel_requested']:
                update(call_id,state='cancelled');return
            files=sources_of(parent['parent_id']) if parent['parent_id'] and not context.get('agentRestart') else {}
            if not files and parent['output']:files={'index.html':parent['output'],'src/main.ts':''}
            request_body={'id':call_id,'model':payload['model'],'messages':payload['messages'],'maxSteps':limits['maxSteps'],
                          'maxTokens':payload.get('max_tokens',payload.get('max_completion_tokens')),'files':files,
                          'providerToken':session['token']}
            update(call_id,state='running');log_agent(call_id,'Préparation de l’agent Mastra et de son projet isolé.')
            response=requests.post(app.config['MASTRA_URL']+'/run',json=request_body,stream=True,timeout=(10,2800),
                                   headers={'Authorization':'Bearer '+app.extensions['agent_control_token']},allow_redirects=False)
            if response.status_code!=200:raise ValueError('Le service Mastra refuse la session ('+str(response.status_code)+'). Aucun repli vers un appel simple.')
            done=False
            for line in response.iter_lines(chunk_size=1):
                if not line:continue
                if len(line)>12*1024*1024:raise ValueError('Événement agent trop volumineux.')
                event=json.loads(line);kind=event.get('type')
                if kind=='activity':log_agent(call_id,event.get('message',''),event.get('tool'))
                elif kind=='files':save_sources(call_id,event.get('files'))
                elif kind=='preview':
                    html=event.get('html')
                    if not isinstance(html,str) or len(html)>8*1024*1024:raise ValueError('Aperçu invalide.')
                    db().execute('UPDATE browser_executions SET output_revision=output_revision+1 WHERE id=?',(call_id,));db().commit()
                    update(call_id,output=html)
                elif kind=='error':raise ValueError(event.get('message','Échec de l’agent'))
                elif kind=='done':done=True;log_agent(call_id,event.get('message') or 'Projet construit.');update(call_id,state='ok')
            if not done:raise ValueError('Connexion Mastra interrompue ; sources et appels conservés.')
        except Exception as error:
            cancelled=db().execute('SELECT cancel_requested FROM browser_executions WHERE id=?',(call_id,)).fetchone()[0]
            update(call_id,state='cancelled' if cancelled else 'error',error=json.dumps({'message':redact(error),
                'requestSent':bool(db().execute('SELECT 1 FROM agent_steps WHERE execution_id=?',(call_id,)).fetchone())},ensure_ascii=False))
            log_agent(call_id,str(error))
        finally:
            if response:response.close()
            app.extensions['agent_sessions'].pop(call_id,None)


def stop_agent(call_id):
    if current_app.config['MASTRA_URL']:
        try:requests.post(current_app.config['MASTRA_URL']+'/runs/'+call_id+'/stop',timeout=3,
                          headers={'Authorization':'Bearer '+current_app.extensions['agent_control_token']})
        except requests.RequestException:pass
