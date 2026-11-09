"""Local Docker administration. Passwords are read interactively, never as argv."""
import argparse
import getpass

from werkzeug.security import generate_password_hash

from .app import create_app
from .storage import db


def reset_password(app, password):
    if not isinstance(password, str) or not 12 <= len(password) <= 1024:
        raise ValueError('Choisir un mot de passe de 12 à 1024 caractères.')
    with app.app_context():
        connection = db()
        account = connection.execute('SELECT username FROM admin WHERE id=1').fetchone()
        if account is None:
            raise ValueError('Aucun compte : créer le premier compte dans l’interface.')
        connection.execute('UPDATE admin SET password_hash=? WHERE id=1',
                           (generate_password_hash(password, method='scrypt'),))
        connection.execute('DELETE FROM sessions')
        connection.execute('DELETE FROM login_attempts')
        connection.commit()
        return account['username']


def main():
    parser = argparse.ArgumentParser(description='Administration locale de LLM Test Bench')
    parser.add_argument('command', choices=['reset-password'])
    parser.parse_args()
    try:
        password = getpass.getpass('Nouveau mot de passe / New password (12+ caractères): ')
        confirmation = getpass.getpass('Confirmation: ')
        if password != confirmation:
            raise ValueError('Les mots de passe ne correspondent pas / Passwords do not match.')
        username = reset_password(create_app(), password)
        print('Mot de passe modifié / Password changed. Identifiant / Username:', username)
        print('Toutes les sessions ont été fermées. Projets et clé API conservés.')
    except (ValueError, EOFError, KeyboardInterrupt) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
