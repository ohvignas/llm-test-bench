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

test('public summary streams before code and survives final usage without exposing raw reasoning', async () => {
  let controller;
  const updates=[],chunks=[];
  globalThis.fetch=async()=>new Response(new ReadableStream({start(c){controller=c;}}));
  const pending=raw.streamChat({...args,onChunk:text=>chunks.push(text),onStats:stats=>updates.push(stats)});
  while(!controller)await new Promise(resolve=>setImmediate(resolve));
  const event=value=>controller.enqueue(encoder.encode('data: '+JSON.stringify(value)+'\n\n'));
  event({choices:[{delta:{reasoning:'PRIVATE RAW',reasoning_details:[
    {type:'reasoning.text',text:'PRIVATE DETAIL'}, {type:'reasoning.encrypted',data:'ENCRYPTED DATA'},
    {type:'reasoning.summary',id:'public',summary:'Préparation du décor.'},
  ]}}]});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(updates.at(-1).reasoningSummary.text,'Préparation du décor.');
  assert.deepEqual(chunks,[]);
  event({choices:[{delta:{reasoning_details:[{type:'reasoning.summary',id:'public',summary:' Animation prévue.'}]}}]});
  event({choices:[{delta:{content:'<html>game</html>'},finish_reason:'stop'}],usage:{cost:.05}});
  controller.enqueue(encoder.encode('data: [DONE]\n\n'));controller.close();
  assert.equal(await pending,'<html>game</html>');
  assert.equal(updates.at(-1).reasoningSummary.text,'Préparation du décor. Animation prévue.');
  assert.equal(updates.at(-1).cost,.05);assert.equal(updates.at(-1).reasoningSignals,2);
  assert.doesNotMatch(JSON.stringify({updates,chunks}),/PRIVATE|ENCRYPTED/);
});

test('a failed summary-only stream keeps its public summary and billed usage',async()=>{
 let finalStats;
 globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.summary","summary":"Plan de la scène"}]},"finish_reason":"length"}],"usage":{"completion_tokens":50,"completion_tokens_details":{"reasoning_tokens":50},"cost":0.01}}\n\ndata: [DONE]\n\n');
 await assert.rejects(raw.streamChat({...args,onStats:stats=>{finalStats=stats;}}),error=>error.code==='OUTPUT_TOKEN_LIMIT');
 assert.equal(finalStats.reasoningSummary.text,'Plan de la scène');assert.equal(finalStats.cost,.01);
});

test('a local proxy preflight block is identified as unsent while upstream failures remain unknown', async () => {
  globalThis.fetch = async () => Response.json({error:'Request blocked before upstream',requestSent:false}, {status:409});
  await assert.rejects(raw.streamChat(args), error => error.requestSent === false && error.status === 409);
  globalThis.fetch = async () => Response.json({error:{message:'Provider unavailable'}}, {status:503});
  await assert.rejects(raw.streamChat(args), error => error.requestSent !== false && error.status === 503);
});

test('an empty prompt is rejected before any completion is sent', async () => {
  let calls = 0;
  globalThis.fetch = async () => {calls++;throw new Error('Unexpected request');};
  await assert.rejects(raw.streamChat({...args,userPrompt:''}), error => error.requestSent === false);
  assert.equal(calls,0);
});

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
test('empty output at the minimum advertised effort suggests stages without increasing the billable budget',async()=>{
 let finalStats;
 globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"completion_tokens":32768,"completion_tokens_details":{"reasoning_tokens":32767},"cost":0.65934}}\n\ndata: [DONE]\n\n');
 const settings={profile:'code',params:{reasoning:{effort:'low'}},supportedEfforts:['max','low']};
 await assert.rejects(raw.streamChat({...args,settings,onStats:value=>{finalStats=value;}}),error=>{
  assert.equal(error.code,'OUTPUT_TOKEN_LIMIT');
  assert.equal(error.feedback.kind,'reasoning-exhausted');
  assert.match(error.message,/minimum annoncé/);
  assert.match(error.message,/construction par étapes/);
  assert.doesNotMatch(error.message,/augmentez|passez au profil|réduisez le raisonnement/i);
  assert.equal(error.stats.cost,.65934);
  return true;
 });
 assert.equal(finalStats.responseChars,0);
});

test('a non-streamed exhausted answer reports the same failure instead of returning an empty success',async()=>{
  globalThis.fetch=async()=>Response.json({choices:[{message:{content:''},finish_reason:'length'}],usage:{completion_tokens:65536,completion_tokens_details:{reasoning_tokens:65536}}});
  await assert.rejects(raw.streamChat({...args,onChunk:null}),error=>error.code==='OUTPUT_TOKEN_LIMIT'&&error.retryable===false);
});

test('reasoning-details and streamed traffic update live diagnostics without exposing reasoning text',async()=>{
  const activity=[],marks=[],chunks=[];
  globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"reasoning_details":[{"text":"PRIVATE INTERNAL CONTENT"}]}}]}\n\ndata: {"choices":[{"delta":{"content":"<html>ok</html>"}}]}\n\ndata: [DONE]\n\n');
  await raw.streamChat({...args,onChunk:value=>chunks.push(value),telemetry:{activity:kind=>activity.push(kind),mark:phase=>marks.push(phase)}});
  assert.ok(activity.includes('stream'));
  assert.ok(activity.includes('reasoning'));
  assert.ok(marks.includes('firstThought'));
  assert.deepEqual(chunks,['<html>ok</html>']);
  assert.doesNotMatch(JSON.stringify({activity,marks,chunks}),/PRIVATE INTERNAL CONTENT/);
});

test('final usage after finish_reason reaches the caller exactly, even for a paid empty answer',async()=>{
 let stats;
 globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: {"choices":[],"usage":{"completion_tokens":32768,"completion_tokens_details":{"reasoning_tokens":32768},"cost":0.674272}}\n\ndata: [DONE]\n\n');
 await assert.rejects(raw.streamChat({...args,onStats:value=>{stats=value;}}),error=>error.code==='OUTPUT_TOKEN_LIMIT');
 assert.equal(stats.cost,.674272);
 assert.equal(stats.reasoningTokens,32768);
});

test('a streamed provider error still reports any charge sent with that error',async()=>{
 let stats;
 globalThis.fetch=async()=>new Response('data: {"error":{"message":"Provider failed"},"usage":{"cost":0.04}}\n\n');
 await assert.rejects(raw.streamChat({...args,onStats:value=>{stats=value;}}),/Provider failed/);
 assert.equal(stats?.cost,.04);
});

test('a content-filtered stream reports the provider stop and preserves the exact billed usage',async()=>{
 let stats;
 globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: {"choices":[],"usage":{"completion_tokens":37113,"completion_tokens_details":{"reasoning_tokens":37113},"cost":0.74624}}\n\ndata: [DONE]\n\n');
 await assert.rejects(raw.streamChat({...args,onStats:value=>{stats=value;}}),error=>error.code==='CONTENT_FILTERED'&&error.retryable===false&&error.stats.finishReason==='content_filter');
 assert.equal(stats.cost,.74624);assert.equal(stats.reasoningTokens,37113);
});
test('a content filter cannot turn a partial or complete-looking document into a successful generation',async()=>{
 globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"<!doctype html><html><body>partial</body></html>"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n');
 await assert.rejects(raw.streamChat(args),error=>error.code==='CONTENT_FILTERED'&&error.retryable===false);
});
test('a non-streamed provider content filter has the same explicit non-retryable result',async()=>{
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:''},finish_reason:'content_filter'}],usage:{cost:.74624}});
 await assert.rejects(raw.streamChat({...args,onChunk:null}),error=>error.code==='CONTENT_FILTERED'&&error.stats.cost===.74624);
});
