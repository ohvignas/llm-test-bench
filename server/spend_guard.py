"""Persistent request reservation; store only hashes, never prompts or keys."""
import hashlib
import json
import os
from pathlib import Path
import time
from .storage import db


def fingerprint(payload):
    value = {'model': payload['model'], 'messages': payload['messages']}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode()).hexdigest()


def reserve(payload):
    identity = fingerprint(payload)
    connection = db()
    inserted = connection.execute('INSERT OR IGNORE INTO generation_guard VALUES (?, ?, ?)',
                                  (identity, f'pending:{os.getpid()}:{Path("/proc/self/stat").read_text().split()[21]}', int(time.time()))).rowcount
    connection.commit()
    return identity if inserted else None


def finish(identity, successful):
    connection = db()
    if successful:
        connection.execute('DELETE FROM generation_guard WHERE fingerprint=?', (identity,))
    else:
        connection.execute("UPDATE generation_guard SET state='failed' WHERE fingerprint=?", (identity,))
    connection.commit()


def clear_failed():
    connection = db()
    for row in connection.execute('SELECT fingerprint, state FROM generation_guard').fetchall():
        try:
            _, pid, born = row['state'].split(':')
            active = Path('/proc/' + str(int(pid)) + '/stat').read_text().split()[21] == born
        except (ValueError, OSError):
            active = False
        if not active:
            connection.execute('DELETE FROM generation_guard WHERE fingerprint=?', (row['fingerprint'],))
    connection.commit()
