"""Persistent authentication and encrypted credentials, outside the file API."""
import fcntl
import hashlib
import os
from pathlib import Path
import secrets
import sqlite3
import time

from cryptography.fernet import Fernet
from flask import current_app, g, request


def db():
    if 'db' not in g:
        g.db = sqlite3.connect(current_app.config['DB_PATH'], timeout=20)
        g.db.row_factory = sqlite3.Row
    return g.db


def initialize(app):
    data = Path(app.config['DATA_DIR'])
    secret_dir = Path(app.config['SECRETS_DIR'])
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    secret_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    key_path = secret_dir / 'vault.key'
    # Multiple WSGI workers must never race to replace the encryption key.
    lock = os.open(secret_dir / 'vault.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock, 'a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        if not key_path.exists():
            descriptor = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(descriptor, 'wb') as key_file:
                key_file.write(Fernet.generate_key())
                key_file.flush()
                os.fsync(key_file.fileno())
        if key_path.is_symlink():
            raise RuntimeError('Le fichier du coffre ne doit pas être un lien symbolique.')
        key_path.chmod(0o600)
        app.extensions['vault'] = Fernet(key_path.read_bytes())
    database = data / 'app.sqlite3'
    app.config['DB_PATH'] = database
    with sqlite3.connect(database) as connection:
        connection.executescript('''
            CREATE TABLE IF NOT EXISTS admin (
                id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL,
                password_hash TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL,
                expires_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (
                name TEXT PRIMARY KEY, value BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS generation_guard (
                fingerprint TEXT PRIMARY KEY, state TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS automatic_runs (
                id TEXT PRIMARY KEY, model_hash TEXT NOT NULL, calls INTEGER NOT NULL,
                pending TEXT, created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS manual_retries (
                id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS generation_activity (
                id TEXT PRIMARY KEY, model TEXT NOT NULL, worker TEXT NOT NULL,
                started REAL NOT NULL, updated REAL NOT NULL, state TEXT NOT NULL,
                output_chars INTEGER NOT NULL DEFAULT 0, reasoning_events INTEGER NOT NULL DEFAULT 0,
                finish_reason TEXT, usage TEXT NOT NULL DEFAULT '{}', settings TEXT NOT NULL DEFAULT '{}',
                cancel_requested INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS browser_executions (
                id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, model TEXT NOT NULL,
                created REAL NOT NULL, updated REAL NOT NULL, worker TEXT NOT NULL,
                state TEXT NOT NULL, context TEXT NOT NULL, activity_id TEXT,
                output TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
                error TEXT NOT NULL DEFAULT '{}', cancel_requested INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS model_policies (
                model TEXT PRIMARY KEY, effort TEXT, max_tokens INTEGER);
            CREATE TABLE IF NOT EXISTS login_attempts (
                address TEXT NOT NULL, attempted_at INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS login_attempt_time ON login_attempts(attempted_at);
        ''')
        if 'error' not in {row[1] for row in connection.execute('PRAGMA table_info(generation_activity)')}:
            connection.execute("ALTER TABLE generation_activity ADD COLUMN error TEXT NOT NULL DEFAULT '{}'")
    database.chmod(0o600)
    @app.teardown_appcontext
    def close_connection(_error):
        connection = g.pop('db', None)
        if connection is not None:
            connection.close()


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def current_session():
    token = request.cookies.get(current_app.config['AUTH_COOKIE_NAME'], '')
    if not token or len(token) > 256:
        return None
    return db().execute('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',
                        (token_digest(token), int(time.time()))).fetchone()


def new_session():
    token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    expires = int(time.time()) + current_app.config['SESSION_SECONDS']
    old = request.cookies.get(current_app.config['AUTH_COOKIE_NAME'], '')
    db().execute('DELETE FROM sessions WHERE expires_at<? OR token_hash=?',
                 (int(time.time()), token_digest(old)))
    db().execute('INSERT INTO sessions VALUES (?, ?, ?)', (token_digest(token), csrf, expires))
    db().commit()
    return token, csrf


def configured():
    return db().execute("SELECT 1 FROM settings WHERE name='openrouter_key'").fetchone() is not None


def api_key():
    row = db().execute("SELECT value FROM settings WHERE name='openrouter_key'").fetchone()
    return current_app.extensions['vault'].decrypt(row['value']).decode() if row else None
