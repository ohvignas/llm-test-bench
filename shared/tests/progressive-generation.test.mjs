import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';
import {progressivePlan, progressiveModel, progressivePrompt, runProgressiveGeneration} from '../../prompt-gallery/services/progressiveGeneration.js';
import {costTotals} from '../../prompt-gallery/services/batchCosts.js';

const seed=JSON.parse(await readFile(new URL('../../prompt-gallery/data/library.json',import.meta.url),'utf8'));
const advanced=seed.prompts.find(prompt=>prompt.id==='games-gta-vi');
const ordinary={id:'ordinary',title:'Page simple',prompt:'Créer une page simple.',tags:[]};
const model={providerId:'test',modelId:'fixture',generationOptions:{profile:'maximum',budget:{totalTokens:128000},reviewedMaxTokens:128000}};
const documentFor=stage=>`<!doctype html><html><body>Version ${stage}</body></html>`;
const healthy=()=>({errors:[],warnings:[],timedOut:false});
const callsFrom=events=>[...new Map(events.filter(event=>event.type==='cost').map(event=>[event.call.id,event.call])).values()];

test('the single native JavaScript GTA brief has six compatible stages and edits keep their own instructions',()=>{
 assert.ok(advanced,'The test must exercise the actual shipped prompt');
 assert.equal(progressivePlan(advanced).length,6);
 assert.deepEqual(progressivePlan({...advanced,prompt:advanced.prompt+'\nPersonnalisation utilisateur.'}),[]);
 assert.deepEqual(progressivePlan(ordinary),[]);
 for(const stage of progressivePlan(advanced)) {
  const request=progressivePrompt(stage);
  assert.match(request,/Sans Three\.js/);
  assert.match(request,/JavaScript déjà compilé/);
  assert.doesNotMatch(request,/cdn\.jsdelivr|THREE\./);
 }
});

test('stages honor comparison and manual settings; only economy keeps the small stage cap',()=>{
 for (const step of progressivePlan(advanced)) {
  for (const profile of ['benchmark','maximum','manual']) {
   const selected={...model,generationOptions:{...model.generationOptions,profile,budget:{totalTokens:128000,reasoningEffort:'xhigh'}}};
   const prepared=progressiveModel(selected,step);
   assert.deepEqual(prepared.generationOptions,selected.generationOptions);
   assert.notEqual(prepared.generationOptions,selected.generationOptions);
  }
  const economical=progressiveModel({...model,generationOptions:{...model.generationOptions,profile:'code'}},step);
  assert.equal(economical.generationOptions.profile,'code');
  assert.equal(economical.generationOptions.budget.totalTokens,12288);
  const reviewed=progressiveModel({...model,generationOptions:{profile:'code',reviewedMaxTokens:6000,budget:{totalTokens:5000}}},step);
  assert.equal(reviewed.generationOptions.reviewedMaxTokens,5000);
 }
 assert.equal(model.generationOptions.budget.totalTokens,128000);
});

test('six successful stages each verify and save before the next call, carrying the last saved HTML',async()=>{
 const history=[],requests=[],saved=[],events=[];
 const summary=await runBatch({prompts:[advanced],model,onEvent:event=>events.push(event),deps:{
  generate:async(request,{model:sent,stage,onStats})=>{
   const index=requests.length+1;
   assert.equal(stage.index,index);assert.equal(stage.total,6);
   assert.equal(sent.generationOptions.profile,'maximum');
   assert.equal(sent.generationOptions.reviewedMaxTokens,128000);
   assert.equal(saved.length,index-1,'A new paid stage must await the previous save');
   if(index>1)assert.ok(request.includes(documentFor(index-1)),'The previous checkpoint must be the next call input');
   else assert.doesNotMatch(request,/<previous_document>/);
   assert.notEqual(request,advanced.prompt,'The full advanced brief must not be resubmitted in each stage');
   requests.push(request);history.push(`generate-${index}`);
   onStats({cost:.01*index});
   return documentFor(index);
  },
  runSandbox:async html=>{history.push(`verify-${html.match(/Version (\d+)/)[1]}`);return healthy();},
  save:async data=>{const index=saved.length+1;history.push(`save-${index}`);saved.push(data);return{id:`checkpoint-${index}`};},
 }});
 assert.equal(requests.length,6);assert.equal(saved.length,6);
 assert.deepEqual(history,Array.from({length:6},(_,i)=>[`generate-${i+1}`,`verify-${i+1}`,`save-${i+1}`]).flat());
 assert.equal(summary.saved,6);assert.equal(summary.generated,1);assert.equal(summary.failed,0);assert.equal(summary.stopped,false);
 assert.deepEqual(saved.map(item=>item.progressive.complete),[false,false,false,false,false,true]);
 assert.ok(saved.every(item=>item.kind==='progressive'&&item.promptText===advanced.prompt));
 assert.equal(events.filter(event=>event.type==='preview').at(-1).html,documentFor(6));
 const calls=callsFrom(events);
 assert.equal(calls.length,6);assert.deepEqual(calls.map(call=>call.stage.index),[1,2,3,4,5,6]);
 assert.ok(calls.every(call=>call.status==='done'));
 assert.equal(saved.at(-1).billing.calls.length,6);
 assert.ok(Math.abs(saved.at(-1).billing.confirmedUsd-.21)<1e-12);
});

test('an unresolved save prevents the next generation until its checkpoint is confirmed',async()=>{
 let releaseSave,saveEntered,generated=0,stop=false;
 const entered=new Promise(resolve=>{saveEntered=resolve;});
 const pending=runProgressiveGeneration({prompt:advanced,model,shouldStop:()=>stop,deps:{
  generate:async()=>{generated++;return documentFor(generated);},runSandbox:async()=>healthy(),
  save:async()=>{saveEntered();return new Promise(resolve=>{releaseSave=resolve;});},
 }});
 await entered;
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(generated,1);
 stop=true;releaseSave({id:'confirmed'});
 const result=await pending;
 assert.equal(generated,1);assert.equal(result.status,'stopped');
 assert.deepEqual(result.savedIds,['confirmed']);assert.equal(result.html,documentFor(1));
});

for(const failure of ['network','budget','invalid-html','sandbox-error','sandbox-throws','sandbox-timeout','save-throws','save-unconfirmed']) {
 test(`a ${failure} failure stops stages and queued prompts even with retries and protection disabled`,async()=>{
  let generated=0,verified=0,saveAttempts=0;
  const events=[],saved=[];
  const summary=await runBatch({prompts:[advanced,ordinary],model,
   options:{apiRetries:3,stopOnFailure:false},onEvent:event=>events.push(event),deps:{
    generate:async(_,{onChunk,onStats})=>{
     generated++;
     onStats({cost:generated===1?.02:.07});
     if(generated===2) {
      onChunk('<html><body>Étape incomplète');
      if(failure==='network')throw new Error('Connection reset');
      if(failure==='budget')throw Object.assign(new Error('Budget épuisé'),{code:'OUTPUT_TOKEN_LIMIT',retryable:false});
      if(failure==='invalid-html')return '<html><body>Pas de document fermé';
     }
     return documentFor(generated);
    },
    runSandbox:async()=>{
     verified++;
     if(verified===2&&failure==='sandbox-throws')throw new Error('Sandbox indisponible');
     if(verified===2&&failure==='sandbox-error')return{...healthy(),errors:['ReferenceError: missing']};
     if(verified===2&&failure==='sandbox-timeout')return{...healthy(),timedOut:true};
     return healthy();
    },
    save:async data=>{
     saveAttempts++;
     if(saveAttempts===2&&failure==='save-throws')throw new Error('Disque plein');
     if(saveAttempts===2&&failure==='save-unconfirmed')return{};
     saved.push(data);return{id:`saved-${saved.length}`};
    },
   }});
  assert.equal(generated,2,'No retry, next stage or next prompt may issue another call');
  assert.equal(summary.failed,1);assert.equal(summary.stopped,true);
  assert.equal(events.some(event=>event.type==='item'&&event.index===1),false);
  assert.equal(events.filter(event=>event.type==='preview').at(-1).html,documentFor(1),'The prior good preview must survive failed streamed output');
  const sandboxFailure=failure.startsWith('sandbox-');
  assert.equal(saved.length,sandboxFailure?2:1);
  assert.equal(summary.saved,saved.length);
  if(sandboxFailure)assert.equal(saved.at(-1).progressive.status,'runtime-error','Broken output is retained explicitly for inspection');
  const calls=callsFrom(events);
  assert.equal(calls.length,2);
  assert.equal(calls[1].usd,.07,'Any supplier-reported charge remains in the journal despite failure');
  assert.equal(costTotals(calls).missingCosts,0);
  assert.ok(Math.abs(costTotals(calls).confirmedUsd-.09)<1e-12);
  if(['network','budget'].includes(failure))assert.equal(calls[1].status,'error');
 });
}

test('an unknown charge on a failed stage stays unknown and retains the successful checkpoint',async()=>{
 let generated=0;const events=[];
 const result=await runBatch({prompts:[advanced],model,onEvent:event=>events.push(event),deps:{
  generate:async(_,{onStats})=>{if(++generated===2)throw new Error('Connection closed before usage');onStats({cost:.03});return documentFor(1);},
  runSandbox:async()=>healthy(),save:async()=>({id:'checkpoint'}),
 }});
 assert.equal(result.saved,1);assert.equal(result.failed,1);
 const totals=costTotals(callsFrom(events));
 assert.equal(totals.confirmedUsd,.03);assert.equal(totals.missingCosts,1);
 assert.equal(totals.calls[1].usd,null);
});

for(const verification of ['absent','undefined','malformed']) {
 test(`an ${verification} sandbox verification saves the candidate as failed and prevents further paid work`,async()=>{
  let generated=0;const saved=[];
  const deps={generate:async()=>{generated++;return documentFor(generated);},
   save:async data=>{saved.push(data);return{id:'unverified-checkpoint'};}};
  if(verification==='undefined')deps.runSandbox=async()=>undefined;
  if(verification==='malformed')deps.runSandbox=async()=>({errors:[]});
  const summary=await runBatch({prompts:[advanced,ordinary],model,options:{apiRetries:3,stopOnFailure:false},deps});
  assert.equal(generated,1);assert.equal(summary.failed,1);assert.equal(summary.stopped,true);assert.equal(summary.saved,1);
  assert.equal(saved.length,1);assert.equal(saved[0].response,documentFor(1));
  assert.equal(saved[0].progressive.status,'runtime-error');assert.equal(saved[0].progressive.complete,false);
  assert.match(saved[0].runStatus.errors.join(' '),/indisponible/);
 });
}

test('a saved last-stage variant with runtime errors is still partial and keeps the previous good preview',async()=>{
 let generated=0,verified=0;const saved=[],events=[];
 const summary=await runBatch({prompts:[advanced],model,onEvent:event=>events.push(event),deps:{
  generate:async()=>documentFor(++generated),
  runSandbox:async()=>++verified===6?{...healthy(),errors:['Final stage failed']} : healthy(),
  save:async data=>{saved.push(data);return{id:`checkpoint-${saved.length}`};},
 }});
 assert.equal(generated,6);assert.equal(summary.saved,6);assert.equal(summary.failed,1);
 assert.ok(saved.every(item=>item.progressive.complete===false),'No failed or intermediate variant may be mistaken for a finished plan');
 assert.equal(saved.at(-1).progressive.index,6);assert.equal(saved.at(-1).progressive.status,'runtime-error');
 assert.equal(events.filter(event=>event.type==='preview').at(-1).html,documentFor(5));
});

for(const variant of ['edited','original-mode']) {
 test(`${variant} sends the user brief intact as one generation`,async()=>{
  const prompt=variant==='edited'?{...advanced,prompt:advanced.prompt+'\nMa modification.'}:advanced;
  let sent,generated=0,saved;
  const summary=await runBatch({prompts:[prompt],model,options:{progressive:variant!=='original-mode'},deps:{
   generate:async(request,options)=>{generated++;sent={request,options};return documentFor(1);},
   runSandbox:async()=>{throw new Error('Quick original generation must not invoke progressive verification');},
   save:async data=>{saved=data;return{id:'original'};},
  }});
  assert.equal(generated,1);assert.equal(sent.request,prompt.prompt);
  assert.equal(sent.options.stage,undefined);assert.equal(sent.options.model.generationOptions.profile,'maximum');
  assert.equal(saved.kind,'original');assert.equal(saved.progressive,undefined);assert.equal(summary.saved,1);
 });
}

test('Stop after a returned complete document preserves it and does not start the next stage',async()=>{
 let stop=false,generated=0;
 const result=await runProgressiveGeneration({prompt:advanced,model,shouldStop:()=>stop,deps:{
  generate:async()=>{generated++;stop=true;return documentFor(1);},
  runSandbox:async()=>healthy(),save:async()=>({id:'last-arrival'}),
 }});
 assert.equal(generated,1);assert.equal(result.status,'stopped');
 assert.deepEqual(result.savedIds,['last-arrival']);assert.equal(result.completed,1);assert.equal(result.html,documentFor(1));
});
