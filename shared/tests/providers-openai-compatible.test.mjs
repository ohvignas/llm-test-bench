import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HUB_PROXY_PREFIX,
  encodeProxyTarget,
  endpointUrl,
  usesProxy,
  streamChat,
} from '../services/providers-openai-compatible.js';

const provider = { baseUrl: 'http://127.0.0.1:8080/', useProxy: true };

function documentWith(dataset = {}) {
  return { documentElement: { dataset } };
}

function withGlobalDocument(doc, fn) {
  const had = 'document' in globalThis;
  const previous = globalThis.document;
  globalThis.document = doc;
  try { return fn(); }
  finally {
    if (had) globalThis.document = previous;
    else delete globalThis.document;
  }
}

test('the private hub routes through the serve.py proxy by default', () => {
  assert.equal(usesProxy({ baseUrl: 'http://x' }, documentWith()), true);
  assert.equal(usesProxy({ useProxy: false }, documentWith()), false);
  assert.equal(
    endpointUrl(provider, '/v1/models'),
    `${HUB_PROXY_PREFIX}/${encodeProxyTarget('http://127.0.0.1:8080')}/v1/models`,
  );
});

test('the public static build never uses the /__llm proxy it does not have', () => {
  const doc = documentWith({ distribution: 'public' });
  assert.equal(usesProxy(provider, doc), false);
  withGlobalDocument(doc, () => {
    assert.equal(endpointUrl(provider, '/v1/models'), 'http://127.0.0.1:8080/v1/models');
  });
});

test('authenticated Docker calls a configured endpoint directly even when its saved proxy flag is enabled', () => {
  const doc = documentWith({ secureVault: 'on' });
  assert.equal(usesProxy(provider, doc), false);
  assert.equal(usesProxy({baseUrl:provider.baseUrl}, doc), false);
  withGlobalDocument(doc, () => {
    assert.equal(endpointUrl(provider, '/v1/models'), 'http://127.0.0.1:8080/v1/models');
    assert.equal(endpointUrl(provider, '/v1/chat/completions'), 'http://127.0.0.1:8080/v1/chat/completions');
  });
});

test('stopping a standard generation aborts the actual compatible-provider request', async () => {
  const previousFetch = globalThis.fetch;
  const controller = new AbortController();
  let ready;
  const entered = new Promise(resolve => {ready=resolve;});
  let transportSignal;
  globalThis.fetch = async (_url, init) => {
    transportSignal = init.signal;
    ready();
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {once:true}));
  };
  try {
    const call = streamChat({provider:{...provider,useProxy:false},modelId:'fixture',systemPrompt:'Test',userPrompt:'Test',onChunk(){},signal:controller.signal});
    const rejected = assert.rejects(call, {name:'AbortError'});
    await entered;
    controller.abort();
    await rejected;
    assert.equal(transportSignal.aborted, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
