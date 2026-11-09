import sqlite3
import tempfile
import unittest
from pathlib import Path

from server.app import create_app
from server.manage import reset_password


class PasswordRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.app = create_app({'TESTING': True, 'DATA_DIR': root / 'data',
            'SECRETS_DIR': root / 'secrets', 'SERVER_NAME': '127.0.0.1:8085'})
        self.client = self.app.test_client()
        self.origin = {'Origin': 'http://127.0.0.1:8085'}

    def test_recovery_revokes_sessions_and_preserves_encrypted_key(self):
        response = self.client.post('/api/auth/setup', headers=self.origin,
            json={'username': 'owner', 'password': 'old-dummy-password'})
        self.client.put('/api/settings/key', json={'key': 'dummy-test-key'},
            headers={**self.origin, 'X-CSRF-Token': response.json['csrfToken']})
        with sqlite3.connect(self.app.config['DB_PATH']) as connection:
            previous_key = connection.execute('SELECT value FROM settings').fetchone()[0]
        self.assertEqual(reset_password(self.app, 'replacement-dummy-password'), 'owner')
        self.assertFalse(self.client.get('/api/auth/status').json['authenticated'])
        self.assertEqual(self.client.post('/api/auth/login', headers=self.origin,
            json={'username': 'owner', 'password': 'old-dummy-password'}).status_code, 401)
        self.assertEqual(self.client.post('/api/auth/login', headers=self.origin,
            json={'username': 'owner', 'password': 'replacement-dummy-password'}).status_code, 200)
        with sqlite3.connect(self.app.config['DB_PATH']) as connection:
            self.assertEqual(connection.execute('SELECT value FROM settings').fetchone()[0], previous_key)

    def test_recovery_requires_existing_account_and_strong_password(self):
        with self.assertRaises(ValueError):
            reset_password(self.app, 'a-long-dummy-password')
        self.client.post('/api/auth/setup', headers=self.origin,
            json={'username': 'owner', 'password': 'old-dummy-password'})
        with self.assertRaises(ValueError):
            reset_password(self.app, 'short')
