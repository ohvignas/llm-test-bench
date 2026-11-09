import { secureMode, sessionStatus, secureFetch } from './secure-session.js';

if (secureMode()) {
  const bar = document.createElement('nav');
  bar.setAttribute('aria-label', 'Compte utilisateur');
  bar.style.cssText = 'position:fixed;bottom:10px;left:10px;z-index:2000;display:flex;gap:12px;align-items:center;padding:8px 14px;border:1px solid #536078;border-radius:12px;background:#171e2bf5;color:#ecf0f8;font:12px system-ui;box-shadow:0 4px 20px #0005';
  const account = document.createElement('a');
  account.href = '/account';
  account.textContent = 'Mon compte et ma clé API';
  account.style.color = '#a7bdff';
  const logout = document.createElement('button');
  logout.textContent = 'Se déconnecter';
  logout.style.cssText = 'border:0;background:transparent;color:inherit;font:inherit;cursor:pointer';
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      const response = await secureFetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Déconnexion impossible.');
      location.assign('/login');
    } catch (error) {
      logout.textContent = error.message;
      logout.disabled = false;
    }
  });
  bar.append(account, logout);
  document.body.append(bar);
  sessionStatus().catch(() => {});
}
