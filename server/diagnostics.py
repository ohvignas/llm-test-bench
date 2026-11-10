"""Local operator diagnostics; no HTTP admin endpoint and no credential access."""
import argparse
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

ACTIVE = ('connecting', 'waiting', 'reasoning', 'writing')


def redact(value, limit=2000):
    text = str(value or '')[:limit]
    text = re.sub(r'(?i)\bsk-[a-z0-9_-]+', '[clé masquée]', text)
    text = re.sub(r'(?i)Bearer\s+[^\s,;]+', 'Bearer [masqué]', text)
    return re.sub(r'(?i)(api[_-]?key|authorization|access[_-]?token|secret)\s*[:=]\s*[^\s,;]+', r'\1=[masqué]', text)


def connection(root, write=False):
    path = (Path(root) / 'app.sqlite3').resolve()
    con = sqlite3.connect(path.as_uri() + ('?mode=rw' if write else '?mode=ro'), uri=True, timeout=5)
    con.row_factory = sqlite3.Row
    return con


def status(root):
    from .spend_guard import active_worker
    now = time.time()
    with connection(root) as con:
        guards = con.execute('SELECT state,created_at FROM generation_guard').fetchall()
        active = [r for r in guards if active_worker(r['state'])]
        has_activity = con.execute("SELECT 1 FROM sqlite_master WHERE name='generation_activity'").fetchone()
        calls = []
        if has_activity:
            for row in con.execute('SELECT * FROM generation_activity ORDER BY started DESC LIMIT 100'):
                item = {k: row[k] for k in ('id', 'model', 'started', 'updated', 'state', 'output_chars', 'reasoning_events', 'finish_reason', 'cancel_requested')}
                item['model'] = redact(item['model'])
                if item['state'] in ACTIVE and not active_worker(row['worker']):
                    item['state'] = 'interrupted'
                item['duration_seconds'] = round((now if item['state'] in ACTIVE else row['updated']) - row['started'], 1)
                item['last_signal_seconds'] = round(max(0, now-row['updated']), 1)
                item['settings'], item['usage'] = json.loads(row['settings']), json.loads(row['usage'])
                calls.append(item)
        https = 0
        for name in ('/proc/net/tcp', '/proc/net/tcp6'):
            try:
                for line in Path(name).read_text().splitlines()[1:]:
                    parts = line.split()
                    https += parts[3] == '01' and parts[2].endswith(':01BB')
            except OSError:
                pass
        return {'active_calls': len(active), 'https_connections': https, 'calls': calls,
                'legacy_active_calls': max(0, len(active)-sum(c['state'] in ACTIVE for c in calls)),
                'failed_blocks': sum(r['state'] in ('failed', 'filtered', 'exhausted') for r in guards),
                'live_tracking_available': bool(has_activity)}


def history(root, limit):
    records = []
    for path in sorted((Path(root)/'files/_telemetry/generations').glob('*.jsonl'), reverse=True):
        for line in reversed(path.read_text().splitlines()):
            try:
                item = json.loads(line)
            except ValueError:
                continue
            if not isinstance(item, dict):
                continue
            records.append({k: item.get(k) for k in ('at', 'modelId', 'outcome', 'finishReason', 'responseChars', 'durations', 'usage', 'params')})
            if len(records) >= limit:
                return records
    return records


def diagnose(snapshot, records):
    findings = []
    if snapshot['legacy_active_calls']:
        findings.append('Des appels ont commencé avant le suivi serveur : leur journal navigateur reste nécessaire pour les détails en direct.')
    for call in snapshot['calls']:
        if call['state'] == 'reasoning' and not call['output_chars'] and call['duration_seconds'] > 180:
            findings.append(f"{call['model']} : raisonnement reçu, aucun code après {int(call['duration_seconds'])} s. Effort : {call['settings'].get('reasoning_effort')}. Automatique : {call['settings'].get('automatic')}.")
    for item in records:
        usage = item.get('usage') or {}
        if item.get('finishReason') == 'length' and item.get('responseChars') == 0:
            findings.append(f"{redact(item.get('modelId'))} : sortie épuisée sans code ; {usage.get('reasoningTokens', '?')} tokens de raisonnement. Réduire l’effort à la reprise, conserver le plafond total.")
    if not findings:
        findings.append('Aucune anomalie détectée dans les données disponibles ; cela ne valide pas le fonctionnement des pages générées.')
    return list(dict.fromkeys(findings))


def journal(source):
    content = source.read(8*1024*1024+1)
    if len(content) > 8*1024*1024:
        raise ValueError('Journal trop volumineux (8 Mio maximum).')
    data = json.loads(content)
    calls = data.get('costCalls', [])
    entries = data.get('entries', [])
    if not isinstance(calls, list) or not isinstance(entries, list):
        raise ValueError('Format de journal invalide.')
    result = {'exportedAt': data.get('exportedAt'), 'calls': [], 'latest_signals': [], 'errors': []}
    for call in calls:
        if isinstance(call, dict):
            result['calls'].append({k: call.get(k) for k in ('modelLabel', 'status', 'usd', 'settings', 'startedAt')})
    seen = set()
    for event in reversed(entries):
        if not isinstance(event, dict):
            continue
        key = event.get('modelKey')
        record = {k: event.get(k) for k in ('at', 'modelLabel', 'stage', 'message')}
        if key not in seen and event.get('stage') == 'progress':
            result['latest_signals'].append(record)
            seen.add(key)
        if event.get('level') == 'error' and len(result['errors']) < 10:
            result['errors'].append(record)
    # Imported logs are untrusted text, not commands. Mask common secret formats.
    return json.loads(redact_json(result))


def redact_json(value, limit=2000):
    if isinstance(value, dict):
        return json.dumps({k: '[masqué]' if re.search(r'(?i)api.?key|authorization|secret|password|access.?token', k)
                           else json.loads(redact_json(v, limit)) for k,v in value.items()}, ensure_ascii=False)
    if isinstance(value, list):
        return json.dumps([json.loads(redact_json(v, limit)) for v in value], ensure_ascii=False)
    return json.dumps(redact(value, limit) if isinstance(value, str) else value, ensure_ascii=False)


def cancel(root, call_id):
    if not re.fullmatch(r'[a-f0-9]{32}', call_id):
        raise ValueError('Identifiant exact de 32 caractères requis ; consulter status.')
    with connection(root, write=True) as con:
        changed = con.execute('UPDATE generation_activity SET cancel_requested=1 WHERE id=? AND state IN (?,?,?,?)', (call_id, *ACTIVE)).rowcount
        con.commit()
    if not changed:
        raise ValueError('Appel introuvable ou déjà terminé.')
    return {'id': call_id, 'cancel_requested': True,
            'message': 'Arrêt demandé pour cet appel uniquement, au prochain fragment du fournisseur. Les tokens déjà traités peuvent être facturés.'}


def main(argv=None):
    parser = argparse.ArgumentParser(description='Diagnostics locaux de LLM Test Bench (aucun appel payant).')
    parser.add_argument('command', choices=['status', 'doctor', 'history', 'journal', 'cancel'])
    parser.add_argument('target', nargs='?')
    parser.add_argument('--json', action='store_true', help='Sortie JSON pour les agents et scripts')
    parser.add_argument('--limit', type=int, default=10)
    parser.add_argument('--data-dir', default=os.environ.get('DATA_DIR', '/data'))
    args = parser.parse_args(argv)
    try:
        if not 1 <= args.limit <= 100:
            raise ValueError('Limit doit être compris entre 1 et 100.')
        if args.command == 'journal':
            if not args.target:
                raise ValueError('Indiquer le fichier JSON du journal.')
            with Path(args.target).open() as handle:
                result = journal(handle)
        elif args.command == 'history':
            result = history(args.data_dir, args.limit)
        elif args.command == 'cancel':
            result = cancel(args.data_dir, args.target or '')
        else:
            result = status(args.data_dir)
            if args.command == 'doctor':
                result['diagnostic'] = diagnose(result, history(args.data_dir, args.limit))
        print(redact_json(result) if args.json else json.dumps(json.loads(redact_json(result)), ensure_ascii=False, indent=2))
    except (OSError, sqlite3.Error, ValueError, TypeError) as error:
        parser.exit(1, redact(error) + '\n')


if __name__ == '__main__':
    main()
