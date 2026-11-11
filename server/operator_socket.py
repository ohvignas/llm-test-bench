"""Docker-local operator access. No HTTP endpoint or browser credential bypass.

The socket is owned by the server user, mode 0600, inside its private /tmp.
Generated projects have neither this mount nor access to the bench container.
"""
import json
import os
from pathlib import Path
import socket
import socketserver
import stat
import threading

from werkzeug.exceptions import HTTPException

from .diagnostics import redact

SOCKET = '/tmp/llm-bench-operator.sock'
MAX_MESSAGE = 1024 * 1024


def launch_batch(app, plan):
    from .agents import agent_limits
    from .executions import context_of, enqueue, identifier
    if not isinstance(plan, dict) or set(plan) != {'executions', 'budgetUsd'}:
        raise ValueError('Plan agent invalide.')
    rows, budget = plan['executions'], plan['budgetUsd']
    if type(budget) not in (int, float) or not 0 < budget <= 100:
        raise ValueError('Budget total invalide.')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 32:
        raise ValueError('Entre 1 et 32 agents sont requis.')
    prepared, ids, total = [], set(), 0
    # Validate the entire reviewed plan before starting any provider work.
    with app.test_request_context('/operator-local', method='POST'):
        for row in rows:
            if not isinstance(row, dict) or set(row) != {'id', 'request', 'context'}:
                raise ValueError('Exécution agent invalide.')
            call_id = identifier(row['id'])
            if call_id in ids:
                raise ValueError('Identifiant dupliqué dans le lot.')
            ids.add(call_id)
            context = context_of(row['context'])
            if context.get('engine') != 'mastra':
                raise ValueError('Le lancement opérateur est réservé aux agents Mastra.')
            total += agent_limits(context['agentLimits'])['budgetUsd']
            payload = row['request']
            if (not isinstance(payload, dict) or not isinstance(payload.get('model'), str)
                    or not isinstance(payload.get('messages'), list) or not payload['messages']
                    or payload.get('stream') is not True
                    or type(payload.get('max_tokens')) is not int
                    or not 256 <= payload['max_tokens'] <= 128000):
                raise ValueError('Requête de génération invalide.')
            if any(not isinstance(m, dict) or m.get('role') not in ('user', 'assistant', 'system')
                   or not isinstance(m.get('content'), str) for m in payload['messages']):
                raise ValueError('Messages invalides.')
            prepared.append((call_id, payload, context))
        if total > budget + 1e-9:
            raise ValueError('Les budgets individuels dépassent le budget total du plan.')
        results = []
        for call_id, payload, context in prepared:
            response, code = enqueue(call_id, payload, context, {})
            if code not in (200, 202):
                raise ValueError('Identifiant déjà utilisé pour un autre plan ; aucun renvoi automatique.')
            results.append({'id':call_id, 'status':code, 'model':payload['model']})
        return {'executions':results, 'budgetUsd':budget}


def start_operator(app, path=SOCKET):
    target = Path(path)
    if target.exists() or target.is_symlink():
        info = target.lstat()
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
            raise RuntimeError('Chemin du socket opérateur non sûr.')
        target.unlink()

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            self.request.settimeout(5)
            try:
                raw = self.rfile.readline(MAX_MESSAGE + 1)
                if len(raw) > MAX_MESSAGE or not raw.endswith(b'\n'):
                    raise ValueError('Plan opérateur trop volumineux ou incomplet.')
                result = {'ok':True, **launch_batch(app, json.loads(raw))}
            except (ValueError, TypeError, KeyError, HTTPException) as error:
                result = {'ok':False, 'error':redact(getattr(error, 'description', str(error)))}
            self.wfile.write(json.dumps(result, ensure_ascii=False).encode() + b'\n')

    class Server(socketserver.ThreadingUnixStreamServer):
        daemon_threads = True

    old_mask = os.umask(0o077)
    try:
        server = Server(path, Handler)
    finally:
        os.umask(old_mask)
    target.chmod(0o600)
    threading.Thread(target=server.serve_forever, daemon=True, name='local-operator').start()
    return server


def send_plan(plan, path=SOCKET):
    raw = json.dumps(plan, ensure_ascii=False).encode() + b'\n'
    if len(raw) > MAX_MESSAGE:
        raise ValueError('Plan opérateur trop volumineux.')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(10)
        client.connect(path)
        client.sendall(raw)
        with client.makefile('rb') as reply:
            result = json.loads(reply.readline(MAX_MESSAGE))
    if not result.get('ok'):
        raise ValueError(result.get('error', 'Lancement agent refusé.'))
    return result
