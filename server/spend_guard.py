"""Persistent request reservation; store only hashes, never prompts or keys."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import time
from .storage import db

_PROCESS_MARKER = secrets.token_hex(16)


def process_marker(pid):
    """Linux start time prevents PID reuse; other hosts retain a live PID safely."""
    try:
        # The command name inside parentheses can itself contain spaces.
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
    except (OSError, IndexError):
        return _PROCESS_MARKER if pid == os.getpid() else None


def active_worker(state):
    try:
        kind, pid_text, born = state.split(':')
        pid = int(pid_text)
        if kind != 'pending' or pid <= 0:
            return False
        marker = process_marker(pid)
        if marker is not None:
            return marker == born
        # Without /proc, never unlock another live worker just because its
        # start time is unavailable. A stopped worker can still be recovered.
        os.kill(pid, 0)
        return True
    except PermissionError:
        return True
    except (ValueError, OSError):
        return False


def fingerprint(payload):
    value = {'model': payload['model'], 'messages': payload['messages']}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(',', ':')).encode()).hexdigest()


def reserve(payload):
    identity = fingerprint(payload)
    connection = db()
    inserted = connection.execute('INSERT OR IGNORE INTO generation_guard VALUES (?, ?, ?)',
                                  (identity, f'pending:{os.getpid()}:{process_marker(os.getpid())}', int(time.time()))).rowcount
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
        if not active_worker(row['state']):
            connection.execute('DELETE FROM generation_guard WHERE fingerprint=?', (row['fingerprint'],))
    connection.commit()
