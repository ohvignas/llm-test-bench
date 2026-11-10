"""Application factory for the local, authenticated LLM Test Bench."""
import os
from pathlib import Path
import re
import secrets
from urllib.parse import urlsplit

from flask import Flask, abort, g, jsonify, redirect, render_template, request, send_file
from werkzeug.exceptions import HTTPException

from .auth import auth
from .data import data
from .proxy import proxy
from .storage import current_session, initialize

PUBLIC_PATHS = {'/healthz', '/login', '/api/auth/status', '/api/auth/setup', '/api/auth/login'}
STATIC_EXTENSIONS = {'.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg',
                     '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.txt',
                     '.csv', '.xml', '.wasm', '.mp3', '.wav', '.mp4', '.webm', '.glb', '.gltf',
                     '.obj', '.mtl', '.pdf', '.md', '.ipynb', '.map', '.avif'}
STATIC_EXCLUDED = {'server', 'work', 'data', 'secrets', 'outputs', 'docs', 'node_modules',
                   'tests', 'scripts', '_suite', 'specs'}


def create_app(config=None):
    app = Flask(__name__, static_folder=None)
    app.config.update(DATA_DIR=os.environ.get('DATA_DIR', '/data'),
                      SECRETS_DIR=os.environ.get('SECRETS_DIR', '/secrets'),
                      PUBLIC_ORIGIN=os.environ.get('PUBLIC_ORIGIN', 'http://127.0.0.1:8085').rstrip('/'),
                      SITE_ROOT=Path(__file__).resolve().parent.parent,
                      AUTH_COOKIE_NAME='llm_bench_session', SESSION_SECONDS=7 * 24 * 60 * 60,
                      MAX_CONTENT_LENGTH=32 * 1024 * 1024, MAX_FORM_MEMORY_SIZE=1024,
                      MAX_FORM_PARTS=10, DEBUG=False)
    if config:
        app.config.update(config)
    origin = urlsplit(app.config['PUBLIC_ORIGIN'])
    if origin.scheme not in ('http', 'https') or not origin.hostname or origin.path or origin.query or origin.fragment:
        raise ValueError('PUBLIC_ORIGIN doit être une origine HTTP(S), sans chemin.')
    trusted_hosts = {'127.0.0.1', 'localhost', origin.hostname}
    app.config['TRUSTED_HOSTS'] = sorted(trusted_hosts)
    initialize(app)
    (Path(app.config['DATA_DIR']) / 'files').mkdir(exist_ok=True, mode=0o700)

    @app.before_request
    def security_boundary():
        # Explicit check also supports Flask versions predating TRUSTED_HOSTS.
        if urlsplit('//' + request.host).hostname not in trusted_hosts:
            abort(400, description='Hôte non autorisé.')
        if (request.method in ('GET', 'HEAD') and request.path != '/healthz'
                and request.host.lower() != origin.netloc.lower()):
            return redirect(app.config['PUBLIC_ORIGIN'] + request.full_path.rstrip('?'), code=308)
        g.auth_session = current_session()
        write = request.method not in ('GET', 'HEAD', 'OPTIONS')
        if write and request.headers.get('Origin') != app.config['PUBLIC_ORIGIN']:
            abort(403, description='Origine de la requête non autorisée.')
        if request.path not in PUBLIC_PATHS:
            if g.auth_session is None:
                if request.path.startswith(('/api/', '/__data', '/__telemetry')):
                    abort(401, description='Connexion requise.')
                return redirect('/login')
            if write:
                token = request.headers.get('X-CSRF-Token', '')
                if len(token) > 256 or not secrets.compare_digest(token.encode(), g.auth_session['csrf_token'].encode()):
                    abort(403, description='Jeton de sécurité manquant ou invalide.')

    @app.after_request
    def response_security(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['Cache-Control'] = 'no-store'
        response.headers.setdefault('Content-Security-Policy',
                                    "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'")
        response.headers['Permissions-Policy'] = 'camera=(self), microphone=(self), display-capture=(self)'
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify({'error': error.description}), error.code

    @app.errorhandler(OSError)
    def filesystem_error(_error):
        return jsonify({'error': 'Opération impossible sur ce fichier ou dossier.'}), 400

    @app.get('/healthz')
    def health():
        return jsonify({'ok': True})

    @app.get('/login')
    def login_page():
        if g.auth_session is not None:
            return redirect('/prompt-gallery/')
        return render_template('login.html')

    @app.get('/account')
    def account_page():
        return render_template('account.html')

    @app.get('/')
    def home():
        return redirect('/prompt-gallery/')

    @app.get('/<path:name>')
    def site_file(name):
        parts = name.split('/')
        if (any(part in ('.', '..') or part.startswith('.') for part in parts)
                or parts[0] in STATIC_EXCLUDED or any('api-keys' in part.lower() for part in parts)
                or name.upper().startswith(('README', 'SECURITY', 'LICENSE', 'DOCKER', 'COMPOSE', 'REQUIREMENTS'))):
            abort(404)
        root = Path(app.config['SITE_ROOT']).resolve()
        path = root
        for part in parts:
            path = path / part
            if path.is_symlink():
                abort(404)
        if path.is_dir():
            if not request.path.endswith('/'):
                return redirect(request.path + '/')
            path = path / 'index.html'
        if (not path.resolve().is_relative_to(root) or not path.is_file()
                or path.suffix.lower() not in STATIC_EXTENSIONS):
            abort(404)
        if path.suffix.lower() in ('.html', '.htm'):
            html = path.read_text(encoding='utf-8')
            if name.startswith('_showcase/'):
                response = app.response_class(html, mimetype='text/html')
                response.headers['Content-Security-Policy'] = (
                    "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'")
                return response
            html = re.sub(r'<script\b[^>]*\bsrc=[\"\'][^\"\']*cloudflareinsights[^\"\']*[\"\'][^>]*>.*?</script\s*>',
                          '', html, flags=re.IGNORECASE | re.DOTALL)
            html = re.sub(r'<html\b', '<html data-secure-vault="on"', html, count=1, flags=re.IGNORECASE)
            script = '<script type="module" src="/shared/services/secure-ui.js"></script>'
            if re.search(r'</body\s*>', html, re.IGNORECASE):
                html = re.sub(r'</body\s*>', lambda match: script + match.group(), html, count=1, flags=re.IGNORECASE)
            else:
                html += script
            return app.response_class(html, mimetype='text/html')
        return send_file(path)

    app.register_blueprint(auth)
    app.register_blueprint(data)
    app.register_blueprint(proxy)
    from .executions import executions
    app.register_blueprint(executions)
    return app
