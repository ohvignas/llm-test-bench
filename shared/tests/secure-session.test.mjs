import test from 'node:test';
import assert from 'node:assert/strict';
import { secureMode, sessionStatus, secureFetch, saveVaultKey, keyConfigured } from '../services/secure-session.js';

test('secure client sends CSRF with same-origin writes and never stores a key', async () => {
  globalThis.document = { documentElement: { dataset: { secureVault: 'on' } } };
  globalThis.window = new EventTarget();
  globalThis.localStorage = { setItem() { throw new Error('A key must not enter localStorage'); } };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url, options});
    if (url === '/api/auth/status') return Response.json({authenticated:true,csrfToken:'csrf-test',apiKeyConfigured:false});
    return Response.json({configured:true});
  };
  assert.equal(secureMode(), true);
  await sessionStatus({refresh:true});
  await saveVaultKey('fake-api-key');
  const call = calls.find(c=>c.url === '/api/settings/key');
  assert.equal(call.options.method, 'PUT');
  assert.equal(new Headers(call.options.headers).get('X-CSRF-Token'), 'csrf-test');
  assert.equal(new Headers(call.options.headers).has('Authorization'), false);
  assert.equal(keyConfigured(), true);
});

test('secureFetch rejects external destinations before sending CSRF', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({}); };
  await assert.rejects(secureFetch('https://example.invalid/steal', {method:'POST'}), /relative|origine|origin/i);
  assert.equal(called, false);
});

test('an existing tab refreshes a stale CSRF token once after login in another tab', async () => {
  let phase = 'old', writes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/auth/status') return Response.json({authenticated:true,csrfToken:phase,apiKeyConfigured:true});
    writes++;
    const token = new Headers(options.headers).get('X-CSRF-Token');
    return token === 'new' ? Response.json({ok:true}) : Response.json({error:'Jeton de sécurité manquant ou invalide.'},{status:403});
  };
  await sessionStatus({refresh:true});
  phase = 'new';
  const response = await secureFetch('/__data/dir?path=demo',{method:'POST'});
  assert.equal(response.status,200);
  assert.equal(writes,2);
});
