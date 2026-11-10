"""Browser-independent calls. Keep output checkpoints, never private reasoning or keys.

The authenticated POST starts exactly one guarded provider call. Short GETs follow
it; disconnecting a page does not own or cancel the worker. A process restart is
reported as interrupted, never retried automatically.
"""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
import re
import sqlite3
import time

from flask import Blueprint, abort, current_app, g, jsonify, request
from werkzeug.exceptions import HTTPException

from .auth import json_object
from .diagnostics import ACTIVE, redact
from .proxy import relay
from .spend_guard import active_worker, process_marker, fingerprint
from .storage import db

executions = Blueprint('executions', __name__)
POOL = ThreadPoolExecutor(max_workers=32, thread_name_prefix='generation')
MAX_OUTPUT = 8 * 1024 * 1024
LIVE = (*ACTIVE, 'queued', 'running')


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{32}', value):
        abort(400, description='Identifiant d’exécution invalide.')
    return value


def context_of(value):
    if not isinstance(value, dict):
        abort(400, description='Contexte de génération invalide.')
    return {key: redact(value[key], limit) for key, limit in
            [('promptId', 160), ('title', 240), ('groupId', 160), ('runId', 160), ('modelLabel', 240)]
            if isinstance(value.get(key), str)}


def update(call_id, **fields):
    fields['updated'] = time.time()
    db().execute('UPDATE browser_executions SET ' + ','.join(k+'=?' for k in fields) + ' WHERE id=?',
                 (*fields.values(), call_id))
    db().commit()


def record(row, include_output=False):
    row = dict(row)
    activity = db().execute('SELECT * FROM generation_activity WHERE id=?', (row['activity_id'],)).fetchone()
    state = row['state']
    if state in LIVE:
        state = (activity['state'] if activity and activity['state'] in ACTIVE else state) if active_worker(row['worker']) else 'interrupted'
    started = activity['started'] if activity else row['created']
    updated = activity['updated'] if activity else row['updated']
    result = dict(id=row['id'], model=row['model'], context=json.loads(row['context']),
                  started=started, updated=updated, state=state, durable=True,
                  activity_id=row['activity_id'], output_chars=len(row['output']),
                  parent_id=row.get('parent_id'), request_saved=bool(row.get('request_payload')),
                  has_output=bool(row['output']), summary=row['summary'],
                  reasoning_events=activity['reasoning_events'] if activity else 0,
                  finish_reason=activity['finish_reason'] if activity else None,
                  settings=json.loads(activity['settings']) if activity else {},
                  usage=json.loads(activity['usage']) if activity else {}, error=json.loads(row['error']),
                  duration_seconds=max(0, (time.time() if state in LIVE else updated)-started),
                  last_signal_seconds=max(0, time.time()-updated))
    if include_output:
        result['output'] = row['output']
    return result


@executions.get('/api/executions')
def list_executions():
    # Pagination bounds apply to each source; linked activity rows are excluded
    # so a call never appears twice. Older numeric-only history remains visible.
    try:
        limit = min(500, max(1, int(request.args.get('limit', 200))))
    except ValueError:
        abort(400, description='Limite invalide.')
    rows = db().execute('SELECT * FROM browser_executions ORDER BY created DESC LIMIT ?', (limit,)).fetchall()
    result = [record(row) for row in rows]
    legacy = db().execute('''SELECT * FROM generation_activity WHERE id NOT IN
        (SELECT activity_id FROM browser_executions WHERE activity_id IS NOT NULL)
        ORDER BY started DESC LIMIT ?''', (limit,)).fetchall()
    for row in legacy:
        state = row['state']
        if state in ACTIVE and not active_worker(row['worker']):
            state = 'interrupted'
        result.append(dict(id=row['id'], model=redact(row['model']), context={}, state=state, durable=False,
                           started=row['started'], updated=row['updated'], output_chars=row['output_chars'], has_output=False,
                           reasoning_events=row['reasoning_events'], finish_reason=row['finish_reason'],
                           settings=json.loads(row['settings']), usage=json.loads(row['usage']), error=json.loads(row['error']),
                           duration_seconds=max(0, (time.time() if state in ACTIVE else row['updated'])-row['started']),
                           last_signal_seconds=max(0, time.time()-row['updated'])))
    result.sort(key=lambda row: row['started'], reverse=True)
    return jsonify({'calls': result[:limit], 'limit': limit})


@executions.get('/api/executions/<call_id>')
def get_execution(call_id):
    row = db().execute('SELECT * FROM browser_executions WHERE id=?', (identifier(call_id),)).fetchone()
    if row is None:
        abort(404, description='Exécution introuvable.')
    result = record(row, include_output=True)
    # Streaming clients request only the new suffix. Comparison viewers obtain
    # a complete bounded checkpoint, always as JSON rather than executable HTML.
    if 'offset' in request.args:
        try:
            offset = int(request.args['offset'])
            if offset < 0 or offset > len(result['output']):
                raise ValueError()
        except ValueError:
            abort(400, description='Position de lecture invalide.')
        result['delta'] = result.pop('output')[offset:]
    return jsonify(result)


@executions.post('/api/executions/<call_id>/stop')
def stop_execution(call_id):
    row = db().execute('SELECT * FROM browser_executions WHERE id=?', (identifier(call_id),)).fetchone()
    if row is None:
        abort(404, description='Exécution introuvable.')
    if row['state'] in LIVE:
        update(call_id, cancel_requested=1)
        if row['activity_id']:
            db().execute('UPDATE generation_activity SET cancel_requested=1 WHERE id=?', (row['activity_id'],))
            db().commit()
    return jsonify({'ok': True})


@executions.post('/api/executions')
def start_execution():
    body = json_object()
    call_id = identifier(body.get('id'))
    payload = body.get('request')
    if (not isinstance(payload, dict) or not isinstance(payload.get('model'), str)
            or not isinstance(payload.get('messages'), list) or payload.get('stream') is not True):
        abort(400, description='Un modèle, des messages et une réponse en flux sont requis.')
    context = context_of(body.get('context', {}))
    headers = {}
    if body.get('automatic') is not None:
        headers['X-Bench-Automatic'] = json.dumps(body['automatic'])
    if body.get('explicitRetry') is not None:
        headers['X-Bench-Retry'] = str(body['explicitRetry'])
    return enqueue(call_id, payload, context, headers)


def enqueue(call_id, payload, context, headers, seed='', parent_id=None, original_request=None):
    digest = hashlib.sha256(json.dumps([payload, context, headers, seed, parent_id], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    con = db()
    con.execute('BEGIN IMMEDIATE')
    existing = con.execute('SELECT * FROM browser_executions WHERE id=?', (call_id,)).fetchone()
    if existing:
        con.rollback()
        if existing['request_hash'] != digest:
            return jsonify({'error': 'Identifiant déjà utilisé pour une autre requête.', 'requestSent': False}), 409
        return jsonify({'id': call_id}), 200
    now = time.time()
    encrypted = current_app.extensions['vault'].encrypt(json.dumps(original_request or payload, ensure_ascii=False).encode())
    try:
        con.execute('''INSERT INTO browser_executions
            (id,request_hash,model,created,updated,worker,state,context,output,request_payload,parent_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (call_id, digest, redact(payload['model'], 240), now, now,
            f'pending:{os.getpid()}:{process_marker(os.getpid())}', 'queued', json.dumps(context), seed, encrypted, parent_id))
    except sqlite3.IntegrityError:
        con.rollback()
        return jsonify({'error':'Une reprise existe déjà pour cet appel. Retrouvez-la dans Comparer.', 'requestSent':False}), 409
    con.commit()
    app = current_app._get_current_object()
    POOL.submit(run_execution, app, call_id, payload, headers)
    return jsonify({'id': call_id}), 202


def recovery_source(call_id, fallback=None):
    row = db().execute('SELECT * FROM browser_executions WHERE id=?', (identifier(call_id),)).fetchone()
    if row is None:
        abort(404, description='Cet ancien appel ne contient pas de point de reprise.')
    info = record(row)
    if info['state'] in LIVE or info['state'] == 'ok':
        abort(409, description='Seul un appel interrompu ou en échec peut être repris.')
    if info['finish_reason'] == 'content_filter' or info['error'].get('status') == 403:
        abort(409, description='Appel filtré par le fournisseur : modifiez la consigne avant un nouvel essai.')
    if db().execute('SELECT 1 FROM browser_executions WHERE parent_id=?', (call_id,)).fetchone():
        abort(409, description='Une reprise existe déjà. Ouvrez la dernière tentative de ce modèle.')
    payload = json.loads(current_app.extensions['vault'].decrypt(row['request_payload'])) if row['request_payload'] else fallback
    if (not isinstance(payload, dict) or payload.get('model') != row['model']
            or not isinstance(payload.get('messages'), list) or not payload['messages']):
        abort(409, description='Consigne d’origine non conservée. Retrouvez ce prompt dans la bibliothèque pour préparer un nouvel essai.')
    guard = db().execute('SELECT state FROM generation_guard WHERE fingerprint=?', (fingerprint(payload),)).fetchone()
    if guard and guard['state'] == 'filtered':
        abort(409, description='Appel filtré par le fournisseur : modifiez la consigne avant un nouvel essai.')
    if len(row['output']) >= MAX_OUTPUT:
        abort(409, description='Le code conservé atteint la limite de taille. Exportez-le avant de le modifier.')
    return row, info, payload


@executions.post('/api/executions/<call_id>/recovery-plan')
def recovery_plan(call_id):
    row, info, payload = recovery_source(call_id, json_object().get('fallback'))
    return jsonify({'source_id':call_id, 'mode':'continue' if row['output'] else 'retry',
                    'title':info['context'].get('title', 'Création'), 'model':row['model'],
                    'model_label':info['context'].get('modelLabel',row['model']),
                    'output_chars':len(row['output']), 'request_saved':bool(row['request_payload']),
                    'max_tokens':payload.get('max_tokens') or payload.get('max_completion_tokens'),
                    'reasoning_effort':(payload.get('reasoning') or {}).get('effort') or payload.get('reasoning_effort'),
                    'previous_cost':info['usage'].get('cost')})


@executions.post('/api/executions/<call_id>/recover')
def recover_execution(call_id):
    body = json_object()
    if body.get('confirmed') is not True:
        abort(400, description='Confirmez le nouvel appel payant dans la fenêtre de reprise.')
    new_id = identifier(body.get('id'))
    # An identical confirmed click is idempotent, including after a lost reply.
    existing = db().execute('SELECT parent_id FROM browser_executions WHERE id=?', (new_id,)).fetchone()
    if existing:
        if existing['parent_id'] == call_id:
            return jsonify({'id':new_id}), 200
        abort(409, description='Identifiant déjà utilisé.')
    row, info, original = recovery_source(call_id, body.get('fallback'))
    payload = {**original, 'stream':True}
    seed = row['output']
    if seed:
        continuation = {'role':'system','content':('RECOVERY MODE: this request continues an interrupted HTML answer. '
            'Exception to the initial full-document formatting rule: return ONLY the suffix missing after the '
            'provided assistant prefix. Do not start a new document, repeat existing code or add Markdown fences. '
            'The application prepends the exact saved prefix to your output.')}
        payload['messages'] = [*[m for m in original['messages'] if m.get('role') == 'system'], continuation,
            *[m for m in original['messages'] if m.get('role') != 'system'], {'role':'assistant','content':seed},
            {'role':'user','content':('Continue the interrupted HTML document immediately after its last character. '
                'Keep the existing code unchanged. Return ONLY the missing suffix, without repeating the document, '
                'without Markdown fences and without explanations. Complete the original requested functionality '
                'and close the document. The application already has the exact prefix shown above.')}]
    # Only a confirmed recovery may release its own dead process reservation.
    # Never clear another active request or any content-filter block.
    identity = fingerprint(payload)
    guard = db().execute('SELECT state FROM generation_guard WHERE fingerprint=?', (identity,)).fetchone()
    if guard and guard['state'].startswith('pending:') and not active_worker(guard['state']):
        db().execute("UPDATE generation_guard SET state='failed' WHERE fingerprint=?", (identity,))
        db().commit()
    return enqueue(new_id, payload, info['context'], {'X-Bench-Retry':new_id}, seed=seed, parent_id=call_id, original_request=original)


def run_execution(app, call_id, payload, headers):
    # The HTTP boundary already authenticated the launch. Reuse the exact
    # existing proxy, reservation, parameter and spend checks inside the worker.
    with app.test_request_context('/api/openrouter/chat/completions', method='POST', json=payload, headers=headers):
        response = None
        output = db().execute('SELECT output FROM browser_executions WHERE id=?', (call_id,)).fetchone()[0]
        summary = ''
        last_flush = 0
        failure = None
        try:
            if db().execute('SELECT cancel_requested FROM browser_executions WHERE id=?', (call_id,)).fetchone()[0]:
                update(call_id, state='cancelled', error=json.dumps({'requestSent':False, 'message':'Arrêté avant tout appel au fournisseur.'}))
                return
            update(call_id, state='running')
            request.environ['bench.execution_id'] = call_id
            response = app.make_response(relay())
            activity_id = getattr(g, 'bench_activity_id', None)
            update(call_id, activity_id=activity_id)
            if response.status_code >= 400:
                body = response.get_json(silent=True) or {}
                detail = body.get('error', 'Appel refusé.')
                message = detail.get('message', 'Appel refusé.') if isinstance(detail, dict) else detail
                update(call_id, state='error', error=json.dumps({'message': redact(message), 'status':response.status_code,
                                                               'requestSent':body.get('requestSent')}))
                return
            if db().execute('SELECT cancel_requested FROM browser_executions WHERE id=?', (call_id,)).fetchone()[0]:
                db().execute('UPDATE generation_activity SET cancel_requested=1 WHERE id=?', (activity_id,))
                db().commit()
            buffer = b''
            def consume(line):
                nonlocal output, summary, failure
                if not line.startswith(b'data:') or line[5:].strip() == b'[DONE]':
                    return
                event = json.loads(line[5:])
                detail = event.get('error')
                if detail:
                    failure = {'message': redact(detail.get('message', 'Génération interrompue.') if isinstance(detail, dict) else detail)}
                    if isinstance(detail, dict) and isinstance(detail.get('code'), (str, int)):
                        failure['code'] = redact(detail['code'], 80)
                for choice in event.get('choices') or []:
                    delta = choice.get('delta') or {}
                    if isinstance(delta.get('content'), str):
                        output += delta['content']
                    for part in delta.get('reasoning_details') or []:
                        if isinstance(part, dict) and part.get('type') == 'reasoning.summary' and isinstance(part.get('summary'), str):
                            summary = redact(summary + part['summary'], 8000)
                if len(output) > MAX_OUTPUT:
                    raise ValueError('Résultat supérieur à la limite de conservation de 8 Mio.')
            for chunk in response.response:
                buffer += chunk.encode() if isinstance(chunk, str) else chunk
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    consume(line)
                if time.time() - last_flush >= 1:
                    update(call_id, output=output, summary=summary)
                    last_flush = time.time()
            if buffer.strip():
                consume(buffer)
            activity = db().execute('SELECT state,finish_reason FROM generation_activity WHERE id=?', (activity_id,)).fetchone()
            state = activity['state'] if activity else 'error'
            if state in LIVE:
                state = 'error'
            if state == 'error' and not failure:
                failure = {'message': 'Budget de sortie épuisé.' if activity and activity['finish_reason'] == 'length' else 'Appel terminé sans résultat complet.'}
            update(call_id, state=state, output=output, summary=summary, error=json.dumps(failure or {}))
        except Exception as error:
            # Avoid retaining arbitrary exception text containing request data.
            message = error.description if isinstance(error, HTTPException) else 'Le suivi serveur a été interrompu. Le code déjà reçu est conservé.'
            update(call_id, state='error', output=output[:MAX_OUTPUT], summary=summary,
                   error=json.dumps({'message':redact(message), 'status':getattr(error, 'code', 502)}))
        finally:
            if response is not None:
                response.close()
