import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window=Object.assign(new EventTarget(),{location:{origin:'http://127.0.0.1:8085'}});
globalThis.document={documentElement:{dataset:{secureVault:'on'}},cookie:'',addEventListener(){}};
const stored=new Map();
globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k),length:0};
// No previously picked directory in this isolated browser-storage fixture.
globalThis.indexedDB={open(){const request={result:{transaction(){return {objectStore(){return {get(){const read={result:null};queueMicrotask(()=>read.onsuccess?.());return read;}};}};}}};queueMicrotask(()=>request.onsuccess?.());return request;}};
const apiModel={id:'vendor/model',name:'Model',context_length:1000000,top_provider:{max_completion_tokens:128000},supported_parameters:['max_tokens','reasoning'],reasoning:{mandatory:true,supported_efforts:['max','low']},architecture:{output_modalities:['text']}};
let fetchCount=0,requests=[];
globalThis.fetch=async(url,init={})=>{
 if(url==='/api/auth/status')return Response.json({authenticated:true,apiKeyConfigured:true,csrfToken:'test-csrf'});
 if(url==='/api/openrouter/models'){fetchCount++;return Response.json({data:[apiModel]});}
 if(url==='/api/openrouter/chat/completions'){requests.push(JSON.parse(init.body));return Response.json({choices:[{message:{content:'<html>ok</html>'},finish_reason:'stop'}],usage:{cost:.012}});}
 throw new Error('Unexpected test URL '+url);
};
const {configureTelemetry}=await import('../services/generation-telemetry.js');configureTelemetry({enabled:false});
const raw=await import('../services/openrouter.js');
const adapter=await import('../services/providers-openrouter.js');
test('catalogue refresh preserves real capabilities and bypasses both stale data and manual name guesses',async()=>{
 const a=await raw.fetchModels({refresh:true,strict:true});
 assert.equal(a[0].capabilities.maxOutputTokens,128000);
 apiModel.top_provider.max_completion_tokens=64000;
 const b=await raw.fetchModels({refresh:true,strict:true});
 assert.equal(b[0].capabilities.maxOutputTokens,64000);assert.ok(fetchCount>=2);
});
test('actual Prompt Gallery requests send API-adapted settings and report both settings and exact billed cost',async()=>{
 let final;
 await adapter.streamChat({modelId:'vendor/model',appTitle:'Prompt Gallery',systemPrompt:'HTML only',userPrompt:'page',generationOptions:{profile:'maximum'},onStats:stats=>{final=stats;}});
 assert.equal(requests.at(-1).max_tokens,64000);assert.deepEqual(requests.at(-1).reasoning,{effort:'max'});
 assert.equal(requests.at(-1).provider.require_parameters,true);
 assert.equal(final.cost,.012);assert.equal(final.settings.modelId,'vendor/model');
});
test('a missing model blocks the paid completion endpoint',async()=>{
 const before=requests.length;
 await assert.rejects(adapter.streamChat({modelId:'vendor/missing',appTitle:'Prompt Gallery',userPrompt:'page'}),e=>e.retryable===false);
 assert.equal(requests.length,before);
});
test('parameter refusal remains non-retryable and carries an actionable API message',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,init)=>url==='/api/openrouter/chat/completions'?Response.json({error:{message:'reasoning effort invalid',code:400}},{status:400}):previous(url,init);
 try { await assert.rejects(adapter.streamChat({modelId:'vendor/model',appTitle:'Prompt Gallery',userPrompt:'page'}),e=>e.status===400&&e.retryable===false&&e.message.includes('actualisez')); }
 finally {globalThis.fetch=previous;}
});
test('the shared provider facade forwards each lane profile to the real request builder',async()=>{
 const providers=await import('../services/model-providers.js');
 await providers.streamChat({providerId:'openrouter',modelId:'vendor/model',appTitle:'Prompt Gallery',userPrompt:'page',generationOptions:{profile:'manual',budget:{totalTokens:12000,reasoningEffort:'low'}}});
 assert.equal(requests.at(-1).max_tokens,12000);assert.equal(requests.at(-1).reasoning.effort,'low');
});
test('real adapter blocks a filtered relaunch before POST and retains the first charge',async()=>{
 const previous=globalThis.fetch;let posts=0,stats;
 globalThis.fetch=async(url,init)=>{
  if(url==='/api/openrouter/chat/completions'){posts++;return Response.json({choices:[{message:{content:''},finish_reason:'content_filter'}],usage:{cost:.74624,completion_tokens:37113,completion_tokens_details:{reasoning_tokens:37113}}});}
  return previous(url,init);
 };
 const args={modelId:'vendor/model',appTitle:'Prompt Gallery',userPrompt:'unique-filter-regression',onStats:s=>{stats=s;}};
 try {
  await assert.rejects(adapter.streamChat(args),e=>e.code==='CONTENT_FILTERED');
  assert.equal(stats.cost,.74624);
  await assert.rejects(adapter.streamChat(args),e=>e.code==='PAID_RETRY_BLOCKED');
  assert.equal(posts,1);
 }finally{globalThis.fetch=previous;}
});
test('invalid final HTML is inside the guard and cannot be automatically billed twice',async()=>{
 const {requireHtmlDocument}=await import('../../prompt-gallery/services/htmlOutput.js');
 const previous=globalThis.fetch;let posts=0;
 globalThis.fetch=async(url,init)=>{
  if(url==='/api/openrouter/chat/completions'){posts++;return Response.json({choices:[{message:{content:'<html><body>unfinished'},finish_reason:'stop'}],usage:{cost:.02}});}
  return previous(url,init);
 };
 const args={modelId:'vendor/model',appTitle:'Prompt Gallery',userPrompt:'unique-incomplete-regression',generationOptions:{validateResult:requireHtmlDocument}};
 try {
  await assert.rejects(adapter.streamChat(args),e=>e.code==='INCOMPLETE_HTML');
  await assert.rejects(adapter.streamChat(args),e=>e.code==='PAID_RETRY_BLOCKED');
  assert.equal(posts,1);
 }finally{globalThis.fetch=previous;}
});
