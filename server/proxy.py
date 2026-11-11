"""A deliberately fixed OpenRouter boundary; browser credentials are ignored."""
import json
import re

from flask import Blueprint, Response, abort, g, jsonify, request, stream_with_context
import requests
from werkzeug.exceptions import HTTPException

from .auth import json_object
from .storage import api_key, db
from .spend_guard import reserve, finish, clear_failed, reset_revision
from .activity import Activity
from .model_policy import policies

proxy = Blueprint('proxy', __name__)
UPSTREAM = 'https://openrouter.ai/api/v1'


def unsent_error(status, message):
    # This marker is local evidence, only emitted before requests.request().
    return jsonify({'error': message, 'requestSent': False}), status


@proxy.get('/api/openrouter/models')
@proxy.post('/api/openrouter/chat/completions')
def relay():
    key = api_key()
    chat = request.method == 'POST'
    if chat and not key:
        return unsent_error(409, 'Enregistrez votre clé OpenRouter dans Mon compte.')
    try:
        payload = json_object() if chat else None
    except HTTPException as error:
        return unsent_error(error.code, error.description)
    if chat and (not isinstance(payload.get('model'), str) or not isinstance(payload.get('messages'), list)):
        return unsent_error(400, 'Un modèle et une liste de messages sont requis.')
    automatic = None
    if chat and request.headers.get('X-Bench-Automatic'):
        try:
            automatic = json.loads(request.headers['X-Bench-Automatic'])
            if (not isinstance(automatic, dict) or automatic.get('limit') != 3
                    or not isinstance(automatic.get('id'), str)
                    or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', automatic['id'])):
                raise ValueError('Invalid automatic run')
        except (ValueError, TypeError):
            return unsent_error(400, 'Configuration automatique invalide.')
    explicit_retry = request.headers.get('X-Bench-Retry') if chat else None
    if explicit_retry is not None and (automatic or not re.fullmatch(r'[a-f0-9]{32}', explicit_retry)):
        return unsent_error(400, 'Identifiant de relance manuelle invalide.')
    identity = reserve(payload, automatic, explicit_retry) if chat else None
    if chat and identity is None:
        return unsent_error(409, 'Appel bloqué : ce prompt et ce modèle sont déjà en cours ou ont échoué. Aucun nouvel appel envoyé. Modifiez le prompt, ou autorisez volontairement les relances dans les options du lot.')
    activity = Activity(payload, automatic) if chat else None
    if activity:
        g.bench_activity_id = activity.id
        execution_id = request.environ.get('bench.execution_id') or request.environ.get('bench.agent_execution_id')
        if execution_id:
            db().execute('UPDATE browser_executions SET activity_id=? WHERE id=?', (activity.id, execution_id))
            db().commit()
    stream = bool(chat and payload.get('stream'))
    headers = {'Accept': 'text/event-stream' if stream else 'application/json',
               'Content-Type': 'application/json'}
    if key:
        headers['Authorization'] = 'Bearer ' + key
    suffix = '/chat/completions' if chat else '/models'
    try:
        upstream = requests.request('POST' if chat else 'GET', UPSTREAM + suffix,
                                    headers=headers, json=payload, stream=stream,
                                    timeout=(10, 180), allow_redirects=False)
    except requests.RequestException:
        if identity:
            finish(identity, False)
            activity.finish('error')
        abort(502, description='OpenRouter est injoignable. Réessayez plus tard.')
    if not 200 <= upstream.status_code < 300:
        if identity:
            finish(identity, False, filtered=upstream.status_code == 403)
        status = upstream.status_code
        try:
            error_body = upstream.json()
            detail = error_body.get('error', {}) if isinstance(error_body, dict) else {}
            message = detail.get('message') if isinstance(detail, dict) else detail
            if not isinstance(message, str):
                message = 'OpenRouter a refusé la requête. Vérifiez votre clé, votre crédit et le modèle.'
            if key:
                message = message.replace(key, '[clé masquée]')
            message = re.sub(r'(?i)\bsk-[a-z0-9_-]+', '[clé masquée]', message)
            message = re.sub(r'(?i)\bBearer\s+[^\s,;"\']+', 'Bearer [masqué]', message)
            message = re.sub(r"(?i)(api[_-]?key|authorization|access[_-]?token|secret)\s*[:=]\s*[^\s,;]+", r'\1=[masqué]', message)
        except (ValueError, TypeError):
            message = 'OpenRouter a renvoyé une erreur illisible.'
        finally:
            upstream.close()
        if activity:
            activity.reject(status, message)
        response = jsonify({'error': {'message': message[:2000], 'code': status}, 'upstreamStatus': status})
        response.status_code = status if 400 <= status < 600 else 502
        retry_after = upstream.headers.get('Retry-After', '')
        if isinstance(retry_after, str) and retry_after and len(retry_after) <= 128:
            response.headers['Retry-After'] = retry_after
        return response
    if stream:
        def chunks():
            received = False
            stop_reason = None
            failed = False
            filtered = False
            completed = False
            cancelled = False
            def observe(line):
                nonlocal received, stop_reason, failed, filtered
                if not line.startswith(b'data:'):
                    return
                try:
                    event = json.loads(line[5:])
                except (ValueError, TypeError):
                    return
                if not isinstance(event, dict):
                    raise ValueError('Invalid event')
                failed = failed or bool(event.get('error'))
                error = event.get('error')
                if isinstance(error, dict):
                    filtered = filtered or str(error.get('code')) in ('403', 'content_filter', 'content_policy_violation')
                choices = event.get('choices', [])
                if not isinstance(choices, list):
                    raise ValueError('Invalid choices')
                for choice in choices:
                    if not isinstance(choice, dict):
                        raise ValueError('Invalid choice')
                    delta = choice.get('delta')
                    if delta is not None and not isinstance(delta, dict):
                        raise ValueError('Invalid choice')
                    received = received or bool((delta or {}).get('content'))
                    stop_reason = choice.get('finish_reason') or stop_reason
                activity.observe(event)
            try:
                # Reassemble lines before redaction so credentials split across chunks
                # cannot leak through a malicious or broken upstream error response.
                buffer = b''
                for chunk in upstream.iter_content(chunk_size=None):
                    if activity.cancelled():
                        cancelled = True
                        yield b'data: {"error":{"code":"CANCELLED_BY_OPERATOR","message":"Appel arrete depuis la CLI locale."}}\n\n'
                        return
                    buffer += chunk
                    while b'\n' in buffer:
                        line, buffer = buffer.split(b'\n', 1)
                        observe(line)
                        yield (line.replace(key.encode(), b'[redacted]') if key else line) + b'\n'
                    if len(buffer) > 4 * 1024 * 1024:
                        failed = True
                        yield b'data: {"error":"Flux OpenRouter trop volumineux."}\n\n'
                        return
                if buffer:
                    observe(buffer)
                    yield buffer.replace(key.encode(), b'[redacted]') if key else buffer
                completed = True
            except requests.RequestException:
                failed = True
                yield b'data: {"error":"Connexion OpenRouter interrompue."}\n\n'
            except (ValueError, TypeError):
                failed = True
                yield b'data: {"error":"Flux OpenRouter illisible."}\n\n'
            finally:
                upstream.close()
                successful = completed and not failed and ((received and stop_reason == 'stop') or stop_reason == 'tool_calls')
                effort=(payload.get('reasoning') or {}).get('effort') or payload.get('reasoning_effort')
                exhausted=completed and not received and stop_reason=='length' and effort in ('low','minimal','none')
                finish(identity, successful, filtered=filtered or stop_reason == 'content_filter', exhausted=exhausted)
                activity.finish('ok' if successful else 'cancelled' if cancelled or not completed and not failed else 'error')
        return Response(stream_with_context(chunks()), mimetype='text/event-stream',
                        headers={'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store', 'X-Bench-Call-Id': activity.id})
    try:
        result = upstream.json()
        if not chat and isinstance(result, dict) and isinstance(result.get('data'), list):
            learned = policies()
            for model in result['data']:
                if isinstance(model, dict) and model.get('id') in learned:
                    model['bench_policy'] = learned[model['id']]
        # Normally the service never echoes credentials; enforce this at our boundary.
        if identity:
            activity.observe(result)
            choices = result.get('choices', []) if isinstance(result, dict) else []
            if (not isinstance(choices, list) or not choices
                    or any(not isinstance(choice, dict)
                           or not isinstance(choice.get('message'), dict) for choice in choices)):
                raise ValueError('Invalid completion')
            successful = bool(choices) and all(choice.get('finish_reason') in ('stop', 'tool_calls') and
                bool((choice.get('message') or {}).get('content') or (choice.get('message') or {}).get('tool_calls')) for choice in choices)
            finish(identity, successful, filtered=any(choice.get('finish_reason') == 'content_filter' for choice in choices))
            activity.finish('ok' if successful else 'error')
        encoded = json.dumps(result, ensure_ascii=False)
        if key:
            encoded = encoded.replace(key, '[redacted]')
        return Response(encoded, mimetype='application/json')
    except (ValueError, TypeError):
        if identity:
            finish(identity, False)
            activity.finish('error')
        abort(502, description='Réponse OpenRouter illisible.')
    finally:
        upstream.close()


@proxy.delete('/api/openrouter/retry-blocks')
def clear_retry_blocks():
    # The application boundary enforces authentication, Origin and CSRF.
    return jsonify({'ok': True, 'resetRevision': clear_failed()})


@proxy.get('/api/openrouter/retry-blocks')
def retry_blocks_status():
    # Only the reset marker, never fingerprints, prompts, or credentials.
    return jsonify({'resetRevision': reset_revision()})
