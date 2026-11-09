import test from 'node:test';
import assert from 'node:assert/strict';

test('server vault never exposes the saved credential or sends browser Authorization', async () => {
  const target = new EventTarget();
  target.location = {origin:'http://127.0.0.1:8085'};
  globalThis.window = target;
  globalThis.document = {documentElement:{dataset:{secureVault:'on',distribution:'public'}},cookie:'',addEventListener(){}};
  globalThis.localStorage = {getItem(){return null;},removeItem(){},setItem(key){if(key.includes('openrouter-key'))throw new Error('Secret persisted in browser');},length:0};
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({url,init});
    if (url === '/api/auth/status') return Response.json({authenticated:true,apiKeyConfigured:true,csrfToken:'csrf'});
    if (url === '/api/openrouter/chat/completions') return Response.json({choices:[{message:{content:'<html>test</html>'}}]});
    return Response.json({error:'Unexpected URL'}, {status:404});
  };
  const telemetry = await import('../services/generation-telemetry.js');
  telemetry.configureTelemetry({enabled:false});
  const provider = await import('../services/openrouter.js');
  await provider.streamChat({modelId:'dummy/test',systemPrompt:'test',userPrompt:'test'});
  assert.equal(provider.getApiKey(), '');
  assert.equal(provider.hasApiKey(), true);
  const request = calls.find(c=>c.url === '/api/openrouter/chat/completions');
  assert.ok(request, 'Must call the authenticated local proxy');
  assert.equal(new Headers(request.init.headers).has('Authorization'), false);
  assert.equal(new Headers(request.init.headers).get('X-CSRF-Token'), 'csrf');
  assert.equal(calls.some(c=>String(c.url).startsWith('https://openrouter.ai')), false);
});
