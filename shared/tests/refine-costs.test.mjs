import test from 'node:test';
import assert from 'node:assert/strict';

test('refine suggestions, healing and improvements expose provider-reported charges through the real facade', async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousTimeout = globalThis.setTimeout;
  const previousIdb = globalThis.indexedDB;
  globalThis.document = {documentElement:{dataset:{}},cookie:'',addEventListener(){}};
  globalThis.window = new EventTarget();
  const fixtureProvider = {id:'fixture-refine',name:'Fixture',type:'openai-compatible',enabled:true,baseUrl:'http://127.0.0.1:9999',useProxy:false};
  const storage = new Map([['devtools-hub-model-providers', JSON.stringify([fixtureProvider])]]);
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{getItem:key => storage.get(key) ?? null,setItem:(key,value) => storage.set(key,String(value)),removeItem:key => storage.delete(key),length:0}});
  // No cookie-backup timer is needed in this isolated non-browser fixture.
  globalThis.setTimeout = (fn, delay, ...args) => delay === 3000 ? undefined : previousTimeout(fn, delay, ...args);
  const emptyRequest = result => {
    const request = {result};
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  globalThis.indexedDB = {open:() => emptyRequest({transaction:() => ({objectStore:() => ({get:() => emptyRequest(null)})})})};
  const calls = [];
  const html = '<!doctype html><html><body>Test</body></html>';
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('/__data/')) return new Response('', {status:404});
    assert.equal(url, 'http://127.0.0.1:9999/v1/chat/completions');
    const body = JSON.parse(init.body);
    calls.push(body);
    const content = body.messages[0].content.includes('reviewing') ? '1. Add a reset button.' : html;
    return new Response([
      `data: ${JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})}\n\n`,
      `data: ${JSON.stringify({choices:[],usage:{prompt_tokens:50,completion_tokens:20,cost:0.12345}})}\n\n`,
      'data: [DONE]\n\n',
    ].join(''), {headers:{'Content-Type':'text/event-stream'}});
  };
  try {
    const telemetry = await import('../services/generation-telemetry.js');
    telemetry.configureTelemetry({enabled:false});
    await import('../services/model-providers.js');
    const refine = await import('../../prompt-gallery/services/refine.js');
    await new Promise(resolve => setImmediate(resolve));
    const options = {providerId:'fixture-refine',modelId:'fixture',prompt:'Create a test page',html,onChunk:() => {}};
    for (const operation of [
      onStats => refine.suggestImprovements({...options,onStats}),
      onStats => refine.applyImprovements({...options,instructions:'Add a reset button',onStats}),
      onStats => refine.healHtml({...options,errors:['Missing reset button'],onStats}),
    ]) {
      const reported = [];
      const result = await operation(stats => reported.push(stats));
      assert.ok(result.length > 0);
      assert.equal(reported.at(-1).cost, 0.12345);
      assert.equal(reported.at(-1).completionTokens, 20);
    }
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    if (previousStorageDescriptor) Object.defineProperty(globalThis, 'localStorage', previousStorageDescriptor);
    else delete globalThis.localStorage;
    globalThis.setTimeout = previousTimeout;
    globalThis.indexedDB = previousIdb;
  }
});
