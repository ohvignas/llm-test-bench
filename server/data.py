"""Constrained persistent filesystem API matching server-data-root.js."""
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import shutil
import statistics
import tempfile

from flask import Blueprint, abort, current_app, jsonify, request, send_file

from .auth import json_object

data = Blueprint('data', __name__)


def files_root():
    root = Path(current_app.config['DATA_DIR']) / 'files'
    if root.is_symlink():
        abort(403, description='Les liens symboliques sont interdits.')
    return root


def safe_path(value, *, allow_root=True):
    if not isinstance(value, str) or '\\' in value or '\x00' in value or value.startswith('/'):
        abort(400, description='Chemin invalide.')
    parts = value.split('/') if value else []
    if any(part in ('', '.', '..') or part.startswith('.') for part in parts):
        abort(400, description='Chemin invalide.')
    if any('api-keys' in part.lower() or part.lower() in ('vault.key', 'app.sqlite3') for part in parts):
        abort(403, description='Ce chemin privé est réservé au serveur.')
    if not parts and not allow_root:
        abort(400, description='Un nom de fichier est requis.')
    path = files_root()
    for part in parts:
        path = path / part
        if path.is_symlink():
            abort(403, description='Les liens symboliques sont interdits.')
    if not path.resolve().is_relative_to(files_root().resolve()):
        abort(403)
    return path


def entry(path):
    return {'name': path.name, 'path': path.relative_to(files_root()).as_posix(),
            'kind': 'directory' if path.is_dir() else 'file'}


def visible_children(path):
    for child in sorted(path.iterdir(), key=lambda p: p.name):
        if (child.is_symlink() or child.name.startswith('.') or 'api-keys' in child.name.lower()
                or child.name.lower() in ('vault.key', 'app.sqlite3')):
            continue
        if child.is_dir() or child.is_file():
            yield child


@data.get('/__data/status')
def status():
    return jsonify({'features': ['write'], 'root': 'Données locales Docker'})


@data.get('/__data/stat')
def stat():
    path = safe_path(request.args.get('path', ''))
    if not path.exists():
        return jsonify({'exists': False, 'path': request.args.get('path', ''), 'name': path.name})
    return jsonify({'exists': True, **entry(path)})


@data.post('/__data/dir')
def mkdir():
    path = safe_path(request.args.get('path', ''), allow_root=False)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return jsonify({'ok': True, **entry(path)})


@data.route('/__data/file', methods=['GET', 'PUT', 'DELETE'])
def file():
    path = safe_path(request.args.get('path', ''), allow_root=False)
    if request.method == 'PUT':
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, temporary = tempfile.mkstemp(prefix='.upload-', dir=path.parent)
        try:
            with os.fdopen(descriptor, 'wb') as stream:
                stream.write(request.get_data())
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return jsonify({'ok': True})
    if not path.exists():
        abort(404, description='Fichier introuvable.')
    if request.method == 'DELETE':
        if path.is_dir():
            if request.args.get('recursive') == '1':
                shutil.rmtree(path)
            else:
                path.rmdir()
        else:
            path.unlink()
        return jsonify({'ok': True})
    if not path.is_file():
        abort(400, description='Ce chemin est un dossier.')
    response = send_file(path, mimetype='application/octet-stream', as_attachment=True,
                         download_name=path.name, conditional=False, etag=False)
    response.headers['Content-Security-Policy'] = "sandbox; default-src 'none'"
    response.headers['X-Last-Modified-Ms'] = str(int(path.stat().st_mtime * 1000))
    return response


@data.get('/__data/list')
@data.get('/__data/tree')
def listing():
    path = safe_path(request.args.get('path', ''))
    if not path.is_dir():
        abort(404, description='Dossier introuvable.')
    try:
        depth = int(request.args.get('depth', '3')) if request.path.endswith('/tree') else 1
    except ValueError:
        abort(400, description='Profondeur invalide.')
    depth = min(32, depth) if depth > 0 else 32
    entries, truncated = [], False

    def visit(directory, level):
        nonlocal truncated
        for child in visible_children(directory):
            if len(entries) >= 20000:
                truncated = True
                return
            entries.append(entry(child))
            if child.is_dir() and level < depth:
                visit(child, level + 1)
    visit(path, 1)
    return jsonify({'entries': entries, 'truncated': truncated})


# Metrics follow generation-telemetry.js; arbitrary body/error/params text is dropped.
NUMBER_FIELDS = {'schema', 'durationMs', 'elapsedMs', 'inputTokens', 'outputTokens',
                 'totalTokens', 'ttftMs', 'tokensPerSecond', 'promptTokens', 'completionTokens',
                 'tokens', 'ms', 'latencyMs', 'generationMs', 'thinkingTokens', 'promptChars',
                 'responseChars', 'toolCalls'}
STRING_FIELDS = {'id', 'at', 'app', 'entry', 'model', 'modelId', 'agentId', 'timestamp'}
PHASE_FIELDS = {'queued', 'dispatched', 'spawned', 'firstOutput', 'sessionReady',
                'firstThought', 'firstToken', 'firstTool', 'done'}
NESTED_NUMBERS = {
    'phases': PHASE_FIELDS,
    'durations': {'startupMs', 'thinkMs', 'waitFirstWordMs', 'writeMs', 'totalMs', 'tokensPerSecond'},
    'usage': {'promptTokens', 'completionTokens', 'totalTokens', 'reasoningTokens', 'cachedTokens',
              'inputTokens', 'outputTokens', 'cost'},
    'cost': {'usd'},
}


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def sanitize_metric(payload):
    record = payload.get('record', payload)
    if not isinstance(record, dict):
        abort(400, description='Mesure invalide.')
    clean = {key: value for key, value in record.items() if key in NUMBER_FIELDS
             and (finite_number(value) or value is None)}
    clean.update({key: value for key, value in record.items() if key in STRING_FIELDS
                  and isinstance(value, str) and len(value) <= 200})
    for key in ('streamed', 'success'):
        if isinstance(record.get(key), bool):
            clean[key] = record[key]
    if record.get('outcome') in ('ok', 'error', 'cancelled', 'timeout', 'empty'):
        clean['outcome'] = record['outcome']
    if record.get('finishReason') in ('stop', 'length', 'tool_calls', 'content_filter', 'error'):
        clean['finishReason'] = record['finishReason']
    if isinstance(record.get('provider'), dict):
        clean['provider'] = {key: value for key, value in record['provider'].items()
                             if key in ('id', 'type', 'name') and isinstance(value, str) and len(value) <= 100}
    for key, allowed in NESTED_NUMBERS.items():
        if isinstance(record.get(key), dict):
            clean[key] = {field: value for field, value in record[key].items()
                          if field in allowed and (finite_number(value) or value is None)}
    if isinstance(record.get('observed'), list):
        clean['observed'] = [phase for phase in record['observed'] if isinstance(phase, str) and phase in PHASE_FIELDS]
    if isinstance(record.get('thinkingTokensSeries'), list):
        clean['thinkingTokensSeries'] = [pair for pair in record['thinkingTokensSeries'][:200]
                                         if isinstance(pair, list) and len(pair) == 2
                                         and all(finite_number(value) for value in pair)]
    return clean


@data.post('/__telemetry/generation')
def generation():
    payload = json_object()
    clean = sanitize_metric(payload)
    clean['recordedAt'] = datetime.now(timezone.utc).isoformat()
    folder = safe_path('_telemetry/generations')
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    month = datetime.now(timezone.utc).strftime('%Y-%m')
    path = safe_path('_telemetry/generations/' + month + '.jsonl')
    encoded = (json.dumps(clean, ensure_ascii=False, allow_nan=False) + '\n').encode()
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'ab') as handle:
        handle.write(encoded)
    return jsonify({'ok': True})


@data.get('/__telemetry/typical')
def typical():
    # A bounded recent history is enough for the UI's typical-cost/time hints.
    folder = safe_path('_telemetry/generations')
    records = []
    if folder.is_dir():
        for path in sorted(visible_children(folder), reverse=True)[:3]:
            if not path.is_file() or path.suffix != '.jsonl':
                continue
            with path.open(encoding='utf-8') as handle:
                for line in handle:
                    try:
                        record = json.loads(line)
                    except (ValueError, TypeError):
                        continue
                    if (record.get('modelId') == request.args.get('model')
                            and record.get('provider', {}).get('id') == request.args.get('provider')
                            and record.get('outcome') == 'ok'):
                        records.append(record)
                    if len(records) >= 1000:
                        break
            if len(records) >= 1000:
                break
    def summary(values):
        values = sorted(value for value in values if finite_number(value))
        if not values:
            return None
        return {'p50': statistics.median(values), 'p75': values[min(len(values) - 1, int(len(values) * .75))]}
    result = {'n': len(records), 'samples': len(records)}
    for name, field in (('think', 'thinkMs'), ('total', 'totalMs'), ('waitFirstWord', 'waitFirstWordMs')):
        result[name] = summary(record.get('durations', {}).get(field) for record in records)
    result['costUsd'] = summary(record.get('cost', {}).get('usd') for record in records)
    return jsonify(result)
