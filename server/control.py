"""Operator CLI. All billable execution requires an explicit reviewed job id."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import requests

from .app import create_app
from .diagnostics import main as diagnostic_main, redact, redact_json
from .jobs import Store, catalogue, prompts, plan, execute, reconcile, safe_gallery, ROOT
from .model_policy import policies, settings, EFFORTS
from .storage import db


def parser():
    p=argparse.ArgumentParser(description='Piloter LLM Test Bench localement : catalogue, réglages, lots, reprise, coûts et journaux.', epilog='Aussi : status, doctor, history, journal FICHIER, cancel ID_APPEL. Prompt personnalisé : plan --prompt-file FICHIER via ./benchctl. Aucune génération avant run --execute.')
    sub=p.add_subparsers(dest='command',required=True)
    for name in ('models','prompts'):
        s=sub.add_parser(name);s.add_argument('--query',default='');s.add_argument('--id');s.add_argument('--json',action='store_true')
    s=sub.add_parser('settings');s.add_argument('--model');s.add_argument('--effort',choices=EFFORTS);s.add_argument('--max-output',type=int);s.add_argument('--reset',action='store_true');s.add_argument('--json',action='store_true')
    for name in ('plan','repair'):
        s=sub.add_parser(name);s.add_argument('--model',action='append',default=[]);s.add_argument('--prompt',action='append',default=[])
        s.add_argument('--budget-usd',type=float,required=True);s.add_argument('--max-output',type=int);s.add_argument('--attempts',type=int,default=3)
        s.add_argument('--parallel',type=int,default=3);s.add_argument('--effort',choices=EFFORTS);s.add_argument('--json',action='store_true')
        s.add_argument('--input-json',action='store_true',help='Prompt personnalisé fourni sur stdin (utilisé par le lanceur local)')
        if name=='repair':s.add_argument('--generation',required=True);s.add_argument('--instructions',required=True)
    for name in ('run','resume'):
        s=sub.add_parser(name);s.add_argument('job');s.add_argument('--execute',action='store_true',required=True,help='Exécuter les appels payants dans le budget du plan')
        s.add_argument('--foreground',action='store_true');s.add_argument('--json',action='store_true')
    for name in ('show','pause','stop','reconcile'):
        s=sub.add_parser(name);s.add_argument('job');s.add_argument('--json',action='store_true')
    s=sub.add_parser('logs');s.add_argument('job');s.add_argument('--limit',type=int,default=30);s.add_argument('--follow',action='store_true');s.add_argument('--seconds',type=int,default=60);s.add_argument('--json',action='store_true')
    s=sub.add_parser('result');s.add_argument('job');s.add_argument('--item',required=True)
    s=sub.add_parser('jobs');s.add_argument('--json',action='store_true')
    for name in ('agent-show','agent-stop'):
        s=sub.add_parser(name);s.add_argument('execution');s.add_argument('--json',action='store_true')
    s=sub.add_parser('agent-start');s.add_argument('--execute',action='store_true',required=True)
    s.add_argument('--input-json',action='store_true',required=True);s.add_argument('--json',action='store_true')
    sub.add_parser('self-test')
    return p


def main(argv=None):
    argslist=sys.argv[1:] if argv is None else argv
    if argslist and argslist[0] in ('status','doctor','history','journal','cancel'):
        return diagnostic_main(argslist)
    p=parser();args=p.parse_args(argslist)
    if args.command=='self-test':
        raise SystemExit(subprocess.call([sys.executable,'-m','unittest','discover','-s','server/tests','-v'],cwd=ROOT))
    if args.command=='agent-start':
        from .operator_socket import send_plan
        try:
            result=send_plan(json.loads(sys.stdin.read(1024*1024+1)))
        except (ValueError,OSError) as error:p.exit(1,redact(error)+'\n')
        print(redact_json(result,limit=None));return
    app=create_app();store=Store(app.config['DATA_DIR'])
    try:
        with app.app_context():
            command=args.command
            if command in ('agent-show','agent-stop'):
                from .agents import agent_record,stop_agent
                if len(args.execution)!=32 or any(c not in 'abcdef0123456789' for c in args.execution):raise ValueError('Identifiant d’exécution invalide.')
                row=db().execute('SELECT * FROM browser_executions WHERE id=?',(args.execution,)).fetchone()
                if not row:raise ValueError('Exécution introuvable.')
                if command=='agent-stop':
                    db().execute('UPDATE browser_executions SET cancel_requested=1 WHERE id=?',(args.execution,))
                    db().execute('UPDATE generation_activity SET cancel_requested=1 WHERE id IN (SELECT activity_id FROM agent_steps WHERE execution_id=?)',(args.execution,));db().commit();stop_agent(args.execution)
                result={'id':args.execution,'context':json.loads(row['context']),'state':row['state'],'agent':agent_record(args.execution)}
            elif command=='models':
                models=catalogue();learned=policies()
                result=[{k:m.get(k) for k in ('id','name','reasoning','top_provider','pricing')}|{'bench_policy':learned.get(m['id'])}
                        for m in models.values() if (not args.id or m['id']==args.id) and args.query.lower() in (m['id']+' '+m.get('name','')).lower()]
            elif command=='prompts':
                result=[row if args.id else {k:row.get(k) for k in ('id','title','description','set','category')}
                        for row in prompts(app.config['DATA_DIR']) if (not args.id or row['id']==args.id) and args.query.casefold() in json.dumps(row,ensure_ascii=False).casefold()]
            elif command=='settings':
                if args.reset or args.effort or args.max_output is not None:
                    if not args.model:raise ValueError('--model est requis pour modifier les réglages.')
                    models=catalogue()
                    if args.model not in models:raise ValueError('Modèle absent du catalogue API.')
                    if args.reset:db().execute('DELETE FROM model_policies WHERE model=?',(args.model,))
                    else:
                        old=db().execute('SELECT effort,max_tokens FROM model_policies WHERE model=?',(args.model,)).fetchone()
                        effort=args.effort or (old['effort'] if old else None);maximum=args.max_output if args.max_output is not None else (old['max_tokens'] if old else None)
                        settings(models[args.model],max_tokens=maximum,effort=effort)
                        db().execute('INSERT OR REPLACE INTO model_policies VALUES (?,?,?)',(args.model,effort,maximum))
                    db().commit()
                learned=policies();result={args.model:learned.get(args.model,{})} if args.model else learned
            elif command in ('plan','repair'):
                custom=json.loads(sys.stdin.read(2*1024*1024)) if args.input_json else None
                if custom and (not isinstance(custom,dict) or not isinstance(custom.get('prompt'),str) or not custom['prompt'].strip()):raise ValueError('Prompt personnalisé invalide.')
                if custom:custom={'id':'custom-'+__import__('uuid').uuid4().hex,'title':custom.get('title') or 'Prompt CLI','prompt':custom['prompt'],'set':'custom'}
                if command=='repair':
                    parts=args.generation.split('/')
                    if len(parts)!=2 or any(not __import__('re').fullmatch(r'[a-zA-Z0-9_-]+',s) for s in parts):raise ValueError('Identifiant de génération invalide.')
                    folder=safe_gallery(app.config['DATA_DIR'],parts[0])
                    if any((folder/(parts[1]+extension)).is_symlink() for extension in ('.html','.json')) or (folder/'prompt.md').is_symlink():raise ValueError('Lien symbolique interdit.')
                    document=(folder/(parts[1]+'.html')).read_text()
                    metadata=json.loads((folder/(parts[1]+'.json')).read_text())
                    custom={'id':'repair-'+__import__('uuid').uuid4().hex,'title':'Reprise '+parts[0],'set':'custom',
                            'prompt':(folder/'prompt.md').read_text()+'\n\nCorrige le document conservé selon ces erreurs ou consignes : '+args.instructions+'\nRenvoie tout le document HTML, sans perdre les fonctionnalités.\n<document>\n'+document+'\n</document>'}
                    if not args.model:args.model=[metadata['modelId']]
                result=plan(app,args.model,args.prompt,args.budget_usd,args.max_output,args.attempts,args.parallel,args.effort,custom)
            elif command in ('run','resume'):
                store.path(args.job) # Validate before subprocess; no shell used.
                if store.running(args.job):
                    if command!='resume':raise ValueError('Ce lot est déjà exécuté ; utiliser show/logs.')
                    with store.edit(args.job) as data:data['control']='run'
                    result={'job':args.job,'message':'Pause levée pour le worker existant.'}
                elif args.foreground:result=execute(app,args.job)
                else:
                    # The worker's file lock prevents double billing from duplicate launches.
                    with (store.path(args.job)/'worker.log').open('a') as log:
                        worker=subprocess.Popen([sys.executable,'-m','server.control','run',args.job,'--execute','--foreground','--json'],
                            cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
                    result={'job':args.job,'worker_pid':worker.pid,'message':'Lot démarré. Consulter show/logs ; fermer le terminal ne coupe pas les appels.'}
            elif command=='reconcile':result=reconcile(app,args.job)
            elif command=='show':result=store.summary(args.job)
            elif command in ('pause','stop'):
                with store.edit(args.job) as data:data['control']=command
                store.event(args.job,'control',action=command)
                result={'job':args.job,'control':command,'message':'Pause après les appels en cours.' if command=='pause' else 'Arrêt au prochain fragment reçu ; sorties partielles conservées.'}
            elif command=='jobs':
                result=[{k:d.get(k) for k in ('id','created_at','state','budget_usd','confirmed_usd')} for path in sorted(store.root.glob('*/job.json'),key=lambda p:p.stat().st_mtime,reverse=True) for d in [json.loads(path.read_text())]][:100]
            elif command=='logs':
                if not 1<=args.limit<=1000 or not 1<=args.seconds<=3600:raise ValueError('Limit 1–1000 et seconds 1–3600 requis.')
                path=store.path(args.job)/'events.jsonl';end=time.monotonic()+args.seconds;seen=0
                while True:
                    lines=path.read_text().splitlines() if path.exists() else []
                    for line in lines[max(seen,len(lines)-args.limit):]:print(line,flush=True)
                    seen=len(lines)
                    if not args.follow or time.monotonic()>=end:break
                    time.sleep(1)
                return
            elif command=='result':
                data=store.read(args.job);item=next((i for i in data['items'] if i['id']==args.item),None)
                if not item or not item.get('result'):raise ValueError('Aucun résultat enregistré pour cet élément.')
                print((Path(app.config['DATA_DIR'])/'files/prompt-gallery'/(item['result']+'.html')).read_text());return
            print(redact_json(result,limit=None) if getattr(args,'json',False) else json.dumps(json.loads(redact_json(result,limit=None)),ensure_ascii=False,indent=2))
    except requests.RequestException as error:
        p.exit(1,'API momentanément inaccessible ('+type(error).__name__+'). Aucun secret affiché.\n')
    except (ValueError,OSError,KeyError,TypeError) as error:
        p.exit(1,redact(error)+'\n')


if __name__=='__main__':main()
