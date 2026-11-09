// The persisted OpenRouter secret is write-only from the browser's perspective.
let status = null;
let pending = null;

export function secureMode() {
  return globalThis.document?.documentElement?.dataset?.secureVault === 'on';
}

function notify() {
  globalThis.window?.dispatchEvent(new Event('vault-key-changed'));
}

export async function sessionStatus({ refresh = false } = {}) {
  if (!refresh && status) return status;
  if (!refresh && pending) return pending;
  pending = (async () => {
    const response = await fetch('/api/auth/status', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Impossible de vérifier la session.');
    status = await response.json();
    notify();
    return status;
  })();
  try { return await pending; } finally { pending = null; }
}

export function keyConfigured() {
  return Boolean(status?.apiKeyConfigured);
}

export async function secureFetch(path, options = {}) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('Une URL relative de même origine est obligatoire.');
  }
  const headers = new Headers(options.headers);
  const method = (options.method || 'GET').toUpperCase();
  const writes = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (writes) {
    const session = await sessionStatus();
    if (!session.authenticated || !session.csrfToken) throw new Error('Connecte-toi pour continuer.');
    headers.set('X-CSRF-Token', session.csrfToken);
  }
  let response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 403 && writes) {
    const detail = await response.clone().json().catch(() => ({}));
    // Retry only the server's pre-operation CSRF rejection, once. A login in
    // another tab rotates the shared cookie while this tab still has its token.
    if (detail.error === 'Jeton de sécurité manquant ou invalide.') {
      const previous = headers.get('X-CSRF-Token');
      const session = await sessionStatus({ refresh: true });
      if (session.authenticated && session.csrfToken && session.csrfToken !== previous) {
        headers.set('X-CSRF-Token', session.csrfToken);
        response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
      }
    }
  }
  if (response.status === 401) {
    status = null;
    globalThis.window?.location?.assign('/login');
  }
  return response;
}

export async function saveVaultKey(key) {
  const value = String(key || '').trim();
  const response = await secureFetch('/api/settings/key', {
    method: value ? 'PUT' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    ...(value ? { body: JSON.stringify({ key: value }) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Impossible de modifier la clé API.');
  status = { ...status, apiKeyConfigured: Boolean(result.configured) };
  notify();
  return result;
}
