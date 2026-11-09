import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window=Object.assign(new EventTarget(),{location:{origin:'http://127.0.0.1:8085'}});
globalThis.document={documentElement:{dataset:{secureVault:'on'}},cookie:'',addEventListener(){}};
globalThis.localStorage={getItem(){return null;},setItem(){},removeItem(){},length:0};
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
