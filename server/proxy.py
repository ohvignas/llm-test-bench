"""A deliberately fixed OpenRouter boundary; browser credentials are ignored."""
import json

from flask import Blueprint, Response, abort, jsonify, request, stream_with_context
import requests

from .auth import json_object
from .storage import api_key

proxy = Blueprint('proxy', __name__)
UPSTREAM = 'https://openrouter.ai/api/v1'


@proxy.get('/api/openrouter/models')
@proxy.post('/api/openrouter/chat/completions')
def relay():
    key = api_key()
    chat = request.method == 'POST'
    if chat and not key:
        abort(409, description='Enregistrez votre clé OpenRouter dans Mon compte.')
    payload = json_object() if chat else None
    if chat and (not isinstance(payload.get('model'), str) or not isinstance(payload.get('messages'), list)):
        abort(400, description='Un modèle et une liste de messages sont requis.')
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
        abort(502, description='OpenRouter est injoignable. Réessayez plus tard.')
    if not 200 <= upstream.status_code < 300:
        status = upstream.status_code
        upstream.close()
        response = jsonify({'error': 'OpenRouter a refusé la requête. Vérifiez votre clé, votre crédit et le modèle.',
                            'upstreamStatus': status})
        response.status_code = 502
        return response
    if stream:
        def chunks():
            try:
                # Reassemble lines before redaction so credentials split across chunks
                # cannot leak through a malicious or broken upstream error response.
                buffer = b''
                for chunk in upstream.iter_content(chunk_size=None):
                    buffer += chunk
                    while b'\n' in buffer:
                        line, buffer = buffer.split(b'\n', 1)
                        yield (line.replace(key.encode(), b'[redacted]') if key else line) + b'\n'
                    if len(buffer) > 4 * 1024 * 1024:
                        yield b'data: {"error":"Flux OpenRouter trop volumineux."}\n\n'
                        return
                if buffer:
                    yield buffer.replace(key.encode(), b'[redacted]') if key else buffer
            except requests.RequestException:
                yield b'data: {"error":"Connexion OpenRouter interrompue."}\n\n'
            finally:
                upstream.close()
        return Response(stream_with_context(chunks()), mimetype='text/event-stream',
                        headers={'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store'})
    try:
        result = upstream.json()
        # Normally the service never echoes credentials; enforce this at our boundary.
        encoded = json.dumps(result, ensure_ascii=False)
        if key:
            encoded = encoded.replace(key, '[redacted]')
        return Response(encoded, mimetype='application/json')
    except (ValueError, TypeError):
        abort(502, description='Réponse OpenRouter illisible.')
    finally:
        upstream.close()
