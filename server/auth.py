"""Single-account setup, bounded server-side sessions, and an encrypted vault."""
import secrets
import re
import sqlite3
import time

from flask import Blueprint, abort, current_app, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from .storage import configured, db, new_session

auth = Blueprint('auth', __name__)


def json_object():
    if not request.is_json:
        abort(415, description='Un objet JSON est requis.')
    value = request.get_json()
    if not isinstance(value, dict):
        abort(400, description='Un objet JSON est requis.')
    return value


def status_payload(csrf=None):
    admin = db().execute('SELECT username FROM admin WHERE id=1').fetchone()
    authenticated = bool(getattr(g, 'auth_session', None) or csrf)
    payload = {'needs_setup': admin is None, 'authenticated': authenticated}
    if authenticated:
        payload.update(username=admin['username'],
                       csrfToken=csrf or g.auth_session['csrf_token'], apiKeyConfigured=configured())
    return payload


def logged_in_response(code=200):
    token, csrf = new_session()
    response = jsonify(status_payload(csrf))
    response.status_code = code
    response.set_cookie(current_app.config['AUTH_COOKIE_NAME'], token,
                        max_age=current_app.config['SESSION_SECONDS'], httponly=True,
                        secure=current_app.config['PUBLIC_ORIGIN'].startswith('https://'),
                        samesite='Strict', path='/')
    return response


@auth.get('/api/auth/status')
def status():
    return jsonify(status_payload())


@auth.post('/api/auth/setup')
def setup():
    payload = json_object()
    if db().execute('SELECT 1 FROM admin WHERE id=1').fetchone():
        abort(409, description='Le compte administrateur existe déjà.')
    username, password = payload.get('username'), payload.get('password')
    if (not isinstance(username, str) or not 1 <= len(username.strip()) <= 80
            or not isinstance(password, str) or not 12 <= len(password) <= 1024):
        abort(400, description='Identifiant requis et mot de passe de 12 à 1024 caractères.')
    password_hash = generate_password_hash(password, method='scrypt')
    try:
        # The primary key and transaction make simultaneous first-run requests safe.
        db().execute('INSERT INTO admin VALUES (1, ?, ?)', (username.strip(), password_hash))
        db().commit()
    except sqlite3.IntegrityError:
        db().rollback()
        abort(409, description='Le compte administrateur existe déjà.')
    return logged_in_response(201)


@auth.post('/api/auth/login')
def login():
    payload = json_object()
    address, now = request.remote_addr or 'local', int(time.time())
    # Serialize the check and insert across workers so parallel failures cannot
    # all slip beneath the same rate-limit counter.
    db().execute('BEGIN IMMEDIATE')
    db().execute('DELETE FROM login_attempts WHERE attempted_at<?', (now - 900,))
    recent = db().execute('SELECT COUNT(*) FROM login_attempts WHERE address=?', (address,)).fetchone()[0]
    if recent >= 5:
        db().commit()
        abort(429, description='Trop de tentatives. Réessayez dans 15 minutes.')
    row = db().execute('SELECT * FROM admin WHERE id=1').fetchone()
    password = payload.get('password')
    valid_password = isinstance(password, str) and len(password) <= 1024
    matched = bool(row and valid_password and check_password_hash(row['password_hash'], password))
    username = payload.get('username')
    if not (matched and isinstance(username, str) and secrets.compare_digest(row['username'].encode(), username.encode())):
        db().execute('INSERT INTO login_attempts VALUES (?, ?)', (address, now))
        db().commit()
        abort(401, description='Identifiants incorrects.')
    db().execute('DELETE FROM login_attempts WHERE address=?', (address,))
    db().commit()
    return logged_in_response()


@auth.post('/api/auth/logout')
def logout():
    db().execute('DELETE FROM sessions WHERE token_hash=?', (g.auth_session['token_hash'],))
    db().commit()
    response = jsonify({'authenticated': False})
    response.delete_cookie(current_app.config['AUTH_COOKIE_NAME'], path='/', samesite='Strict')
    return response


@auth.route('/api/settings/key', methods=['GET', 'PUT', 'DELETE'])
def vault():
    if request.method == 'PUT':
        key = json_object().get('key')
        if (not isinstance(key, str) or not 1 <= len(key) <= 4096
                or re.fullmatch(r'[A-Za-z0-9_.-]+', key, flags=re.ASCII) is None):
            abort(400, description='Clé API invalide.')
        ciphertext = current_app.extensions['vault'].encrypt(key.encode())
        db().execute("INSERT OR REPLACE INTO settings VALUES ('openrouter_key', ?)", (ciphertext,))
        db().commit()
    elif request.method == 'DELETE':
        db().execute("DELETE FROM settings WHERE name='openrouter_key'")
        db().commit()
    return jsonify({'configured': configured()})
