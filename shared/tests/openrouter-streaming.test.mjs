import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = Object.assign(new EventTarget(), {location:{origin:'http://127.0.0.1:8085'}});
globalThis.document = {documentElement:{dataset:{secureVault:'on'}},cookie:'',addEventListener(){}};
globalThis.localStorage = {getItem(){return null;},setItem(){},removeItem(){},length:0};
globalThis.fetch = async () => Response.json({authenticated:true,apiKeyConfigured:true,csrfToken:'test-csrf'});
const {configureTelemetry} = await import('../services/generation-telemetry.js');
configureTelemetry({enabled:false});
const raw = await import('../services/openrouter.js');
const adapter = await import('../services/providers-openrouter.js');
const {sessionStatus} = await import('../services/secure-session.js');
await sessionStatus({refresh:true});
const args = {modelId:'dummy/model',systemPrompt:'test',userPrompt:'test',onChunk(){},telemetry:null};
const encoder = new TextEncoder();
const bounded = promise => Promise.race([promise, new Promise(resolve=>setTimeout(()=>resolve('still waiting'),100))]);

test('Stop reaches the OpenRouter transport while waiting for response headers', async () => {
  let requested, release;
  const entered = new Promise(resolve=>{requested=resolve;});
  globalThis.fetch = async (_url, options) => {
    requested();
    return new Promise((resolve,reject)=>{
      release=()=>resolve(new Response('data: [DONE]\n\n'));
      options.signal?.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError')),{once:true});
    });
  };
  const controller = new AbortController();
  const pending = adapter.streamChat({...args,signal:controller.signal}).then(()=> 'finished',error=>error.name);
  await entered;
  controller.abort();
  const result = await bounded(pending);
  release();
  await pending;
  assert.equal(result,'AbortError','Stopping must abort the network request, not just detach the UI');
});

test('DONE finishes and releases an SSE reader even when the connection stays open', async () => {
  let close, cancelled=false;
  const body = new ReadableStream({
    start(controller){close=()=>controller.close();controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"<html>ok</html>"}}]}\n\ndata: [DONE]\n\n'));},
    cancel(){cancelled=true;},
  });
  globalThis.fetch=async()=>new Response(body);
  const pending=raw.streamChat(args);
  const result=await bounded(pending);
  if(!cancelled)close();
  await pending;
  assert.equal(result,'<html>ok</html>','The end marker must not wait for the TCP connection to close');
  assert.equal(cancelled,true);
});

test('an error delivered inside a successful SSE response rejects the generation', async () => {
  globalThis.fetch=async()=>new Response('data: {"error":{"message":"Provider unavailable","code":503}}\n\ndata: [DONE]\n\n');
  await assert.rejects(raw.streamChat(args),/Provider unavailable/);
});

test('reasoning is observed before HTML without inserting private reasoning into the preview', async () => {
  let controller;
  const marks=[], chunks=[];
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){controller=c;}}));
  const pending=raw.streamChat({...args,onChunk:text=>chunks.push(text),telemetry:{mark:phase=>marks.push(phase)}});
  while(!controller)await new Promise(resolve=>setImmediate(resolve));
  controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning":"private reasoning"}}]}\n\n'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(marks.includes('firstThought'));
  assert.deepEqual(chunks,[]);
  controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"<html>ok</html>"}}]}\n\ndata: [DONE]\n\n'));
  controller.close();
  assert.equal(await pending,'<html>ok</html>');
  assert.deepEqual(chunks,['<html>ok</html>']);
});

test('a reasoning-only exhausted stream reports the token budget and disables automatic retry',async()=>{
  globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"completion_tokens":65536,"completion_tokens_details":{"reasoning_tokens":65536}}}\n\ndata: [DONE]\n\n');
  await assert.rejects(raw.streamChat(args),error=>error.code==='OUTPUT_TOKEN_LIMIT'&&error.retryable===false&&error.message.includes('65536'));
});

test('a non-streamed exhausted answer reports the same failure instead of returning an empty success',async()=>{
  globalThis.fetch=async()=>Response.json({choices:[{message:{content:''},finish_reason:'length'}],usage:{completion_tokens:65536,completion_tokens_details:{reasoning_tokens:65536}}});
  await assert.rejects(raw.streamChat({...args,onChunk:null}),error=>error.code==='OUTPUT_TOKEN_LIMIT'&&error.retryable===false);
});
