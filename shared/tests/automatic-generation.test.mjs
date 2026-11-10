import test from 'node:test';
import assert from 'node:assert/strict';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';
import {runAutomaticGeneration,recoveryFor} from '../../prompt-gallery/services/automaticGeneration.js';
import {resolveModelSettings,normalizeOpenRouterModel} from '../services/model-capabilities.js';
const prompt={id:'any-prompt',title:'Mon site',prompt:'Créer un site interactif',tags:[]};
const model={providerId:'openrouter',modelId:'fixture',label:'Fixture',generationOptions:{profile:'automatic',reviewedMaxTokens:128000}};
const html=n=>`<!doctype html><html><body>Version ${n}</body></html>`;
const healthy=()=>({errors:[],timedOut:false});
const fail=(code,status)=>Object.assign(new Error(code),{code,status});

test('automatic recovery is capability-based, keeps maximum output and steps down only on recovery',()=>{
 const api=normalizeOpenRouterModel({id:'fixture',supported_parameters:['max_tokens','reasoning'],top_provider:{max_completion_tokens:128000},reasoning:{mandatory:true,supported_efforts:['xhigh','high','medium','low']}});
 for(const [recoveryLevel,effort] of [[0,'xhigh'],[1,'medium'],[2,'low']]) {
  const result=resolveModelSettings({model:api,profile:'automatic',recoveryLevel});
  assert.equal(result.params.max_tokens,128000);assert.equal(result.params.reasoning.effort,effort);
 }
 const fixed=normalizeOpenRouterModel({id:'budget',supported_parameters:['max_tokens','reasoning'],top_provider:{max_completion_tokens:64000},reasoning:{mandatory:true,supports_max_tokens:true}});
 assert.equal(resolveModelSettings({model:fixed,profile:'automatic'}).params.reasoning.max_tokens,16384);
});

test('reasoning exhaustion then runtime error consumes exactly three calls and preserves every complete candidate and cost',async()=>{
 const requests=[],saved=[],events=[];let generated=0,checks=0;
 const result=await runBatch({prompts:[prompt],model,options:{mode:'automatic'},onEvent:e=>events.push(e),deps:{
  generate:async(_,options)=>{requests.push(options.model.generationOptions);options.onStats({cost:.1});if(++generated===1)throw fail('OUTPUT_TOKEN_LIMIT');return html(1);},
  heal:async options=>{requests.push(options.model.generationOptions);assert.equal(options.html,html(1));options.onStats({cost:.2});return html(2);},
  runSandbox:async()=>++checks===1?{errors:['ReferenceError: player is undefined'],timedOut:false}:healthy(),
  save:async data=>{saved.push(data);return{id:`saved-${saved.length}`};},
 }});
 assert.equal(requests.length,3);assert.equal(result.failed,0);assert.equal(result.saved,2);assert.equal(result.healed,1);
 assert.deepEqual(requests.map(r=>r.recoveryLevel),[0,1,1]);assert.equal(new Set(requests.map(r=>r.automatic.id)).size,1);
 assert.equal(saved[0].response,html(1));assert.equal(saved[1].derivedFrom,'saved-1');
 assert.equal(saved[1].billing.requestCount,3);assert.equal(saved[1].billing.confirmedUsd,.4);
 assert.ok(events.some(e=>e.type==='log'&&e.message.includes('réduire le raisonnement')));
});

test('incomplete HTML is saved before its targeted completion, without paying to restart from nothing',async()=>{
 const saved=[],requests=[];let calls=0;
 const result=await runAutomaticGeneration({prompt,model,deps:{
  generate:async(text,{onChunk})=>{requests.push(text);if(++calls===1){onChunk('<html><body>Conserver ce travail');throw fail('INCOMPLETE_HTML');}assert.equal(saved.length,1);return html('final');},
  runSandbox:async()=>healthy(),save:async data=>{saved.push(data);return{id:`s${saved.length}`};},
 }});
 assert.equal(result.status,'saved');assert.equal(calls,2);assert.match(requests[1],/Conserver ce travail/);
 assert.equal(saved[0].automatic.complete,false);assert.equal(saved[1].automatic.complete,true);
});

test('three exhausted outputs stop and cannot trigger a fourth call',async()=>{
 let calls=0;
 const result=await runAutomaticGeneration({prompt,model,deps:{generate:async()=>{calls++;throw fail('OUTPUT_TOKEN_LIMIT');}}});
 assert.equal(calls,3);assert.equal(result.status,'error');assert.deepEqual(result.savedIds,[]);
});

for(const error of [fail('CONTENT_FILTERED'),fail('unauthorized',401),fail('credit',402),fail('forbidden',403),fail('bad settings',400),fail('blocked',409)]) {
 test(`non-recoverable ${error.code}/${error.status} stops without another call`,async()=>{
  let calls=0;
  const result=await runAutomaticGeneration({prompt,model,deps:{generate:async()=>{calls++;throw error;}}});
  assert.equal(calls,1);assert.equal(result.status,'error');
 });
}

test('Retry-After is respected and Stop during wait prevents a new paid request',async()=>{
 const error=Object.assign(fail('busy',429),{headers:{'retry-after':'30'}});
 assert.equal(recoveryFor(error).delay,30000);
 assert.equal(recoveryFor({...error,headers:{'retry-after':'900'}}),null);
 let calls=0,stopped=false;
 const result=await runAutomaticGeneration({prompt,model,shouldStop:()=>stopped,wait:async ms=>{assert.equal(ms,30000);stopped=true;},deps:{generate:async()=>{calls++;throw error;}}});
 assert.equal(calls,1);assert.equal(result.status,'stopped');
});

test('Stop after streamed code preserves the checkpoint and never retries',async()=>{
 let stopped=false,calls=0;const saved=[];
 const result=await runAutomaticGeneration({prompt,model,shouldStop:()=>stopped,deps:{
  generate:async(_,o)=>{calls++;o.onChunk('<html><body>Travail reçu');stopped=true;throw new DOMException('Stopped','AbortError');},
  save:async data=>{saved.push(data);return{id:'interrupted'};},
 }});
 assert.equal(result.status,'stopped');assert.equal(calls,1);assert.equal(saved[0].response,'<html><body>Travail reçu');
});

test('sandbox that did not execute cannot report success or trigger a paid repair',async()=>{
 let calls=0,saved=0;
 const result=await runAutomaticGeneration({prompt,model,deps:{generate:async()=>{calls++;return html(1);},
  runSandbox:async()=>({executed:false,errors:[],timedOut:false}),save:async()=>({id:`s${++saved}`}),heal:async()=>assert.fail('No paid repair without observations')}});
 assert.equal(result.status,'error');assert.equal(calls,1);assert.equal(saved,1);assert.equal(result.html,html(1));
});

test('failed checkpoint save prevents every later paid call',async()=>{
 let calls=0;
 const result=await runAutomaticGeneration({prompt,model,deps:{generate:async()=>{calls++;return html(1);},
  runSandbox:async()=>({errors:['broken'],timedOut:false}),save:async()=>{throw new Error('Disk full');},heal:async()=>{calls++;return html(2);}}});
 assert.equal(result.status,'error');assert.equal(calls,1);assert.equal(result.html,html(1));
});

test('automatic resume of complete saved code validates and repairs without generator call',async()=>{
 let calls=0,checks=0;const saved=[];
 const result=await runAutomaticGeneration({prompt,model,initialCandidate:{id:'original',html:html(0)},deps:{
  generate:async()=>{assert.fail('Must not regenerate');},
  runSandbox:async()=>++checks===1?{errors:['broken'],timedOut:false}:healthy(),
  heal:async args=>{calls++;assert.equal(args.html,html(0));return html(1);},
  save:async data=>{saved.push(data);return{id:`s${saved.length}`};},
 }});
 assert.equal(result.status,'saved');assert.equal(calls,1);assert.equal(saved[0].derivedFrom,'original');
});

test('automatic resume of incomplete code completes it before sandbox execution',async()=>{
 let calls=0;
 const result=await runAutomaticGeneration({prompt,model,initialCandidate:{id:'partial',html:'<html><body>Saved'},deps:{
  generate:async text=>{calls++;assert.match(text,/Saved/);return html(1);},runSandbox:async text=>{assert.equal(text,html(1));return healthy();},save:async()=>({id:'completed'}),
 }});
 assert.equal(result.status,'saved');assert.equal(calls,1);
});
