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


def reserve(payload, automatic=None):
    identity = fingerprint(payload)
    connection = db()
    if automatic:
        # A new explicit UI launch grants at most three calls for this model.
        # Failed fingerprints are released only inside this bounded run, never globally.
        connection.execute('BEGIN IMMEDIATE')
        try:
            run_id = automatic['id']
            model_hash = hashlib.sha256(payload['model'].encode()).hexdigest()
            run = connection.execute('SELECT * FROM automatic_runs WHERE id=?', (run_id,)).fetchone()
            record = connection.execute('SELECT state FROM generation_guard WHERE fingerprint=?', (identity,)).fetchone()
            if (run and (run['model_hash'] != model_hash or run['calls'] >= 3 or run['pending'])) or (record and record['state'] != 'failed'):
                connection.rollback()
                return None
            connection.execute('INSERT OR REPLACE INTO automatic_runs VALUES (?, ?, ?, ?, ?)',
                (run_id, model_hash, (run['calls'] if run else 0) + 1, identity, int(time.time())))
            connection.execute('INSERT OR REPLACE INTO generation_guard VALUES (?, ?, ?)',
                (identity, f'pending:{os.getpid()}:{process_marker(os.getpid())}', int(time.time())))
            connection.commit()
            return identity
        except Exception:
            connection.rollback()
            raise
    inserted = connection.execute('INSERT OR IGNORE INTO generation_guard VALUES (?, ?, ?)',
                                  (identity, f'pending:{os.getpid()}:{process_marker(os.getpid())}', int(time.time()))).rowcount
    connection.commit()
    return identity if inserted else None


def finish(identity, successful, filtered=False, exhausted=False):
    connection = db()
    if successful:
        connection.execute('DELETE FROM generation_guard WHERE fingerprint=?', (identity,))
    else:
        connection.execute('UPDATE generation_guard SET state=? WHERE fingerprint=?', ('filtered' if filtered else 'exhausted' if exhausted else 'failed', identity))
    connection.execute('UPDATE automatic_runs SET pending=NULL WHERE pending=?', (identity,))
    connection.commit()


def reset_revision():
    row = db().execute("SELECT value FROM settings WHERE name='retry_blocks_revision'").fetchone()
    return row['value'] if row else ''


def clear_failed():
    connection = db()
    connection.execute('BEGIN IMMEDIATE')
    for row in connection.execute('SELECT fingerprint, state FROM generation_guard').fetchall():
        if not active_worker(row['state']):
            connection.execute('DELETE FROM generation_guard WHERE fingerprint=?', (row['fingerprint'],))
    revision = secrets.token_hex(16)
    connection.execute("INSERT OR REPLACE INTO settings(name,value) VALUES ('retry_blocks_revision',?)", (revision,))
    connection.commit()
    return revision
