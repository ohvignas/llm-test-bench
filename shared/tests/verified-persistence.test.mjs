import test from 'node:test';
import assert from 'node:assert/strict';
import {runVerifiedGeneration} from '../../prompt-gallery/services/verifiedGeneration.js';

const promptItem={id:'page',title:'Page',prompt:'Create an interactive page',tags:[]};
const original='<!doctype html><html><body>Original</body></html>';
const repaired='<!doctype html><html><body>Repair</body></html>';
const healthy=()=>({ok:true,errors:[],warnings:[],timedOut:false});
const verdict=(checklist,status='pass')=>({checks:checklist.checks.map(check=>({id:check.id,status,evidence:'Fixture evidence'}))});

for(const phase of ['generation','sandbox','audit','repair']) {
 test(`verified Stop during ${phase} saves the latest completed HTML without further model calls`,async()=>{
  let stopped=false;const calls=[],saved=[];
  const result=await runVerifiedGeneration({promptItem,model:{},shouldStop:()=>stopped,deps:{
   generate:async({onStats})=>{calls.push('generate');onStats({cost:.1});if(phase==='generation')stopped=true;return original;},
   sandbox:async()=>{calls.push('sandbox');if(phase==='sandbox')stopped=true;return healthy();},
   audit:async({checklist,onStats})=>{calls.push('audit');onStats({cost:.02});if(phase==='audit')stopped=true;return verdict(checklist,phase==='repair'?'fail':'pass');},
   repair:async({onStats})=>{calls.push('repair');onStats({cost:.03});stopped=true;return repaired;},
   save:async data=>{saved.push(data);return{id:`saved-${saved.length}`};},
  }});
  assert.equal(result.status,'stopped');
  assert.equal(saved.length,phase==='repair'?2:1);
  assert.equal(saved.at(-1).response,phase==='repair'?repaired:original);
  assert.equal(saved.at(-1).verification.status,'stopped');
  assert.equal(saved.at(-1).verification.stopReason,'stopped');
  assert.equal(saved.at(-1).verification.sandbox.executed,false);
  assert.ok(saved.at(-1).verification.audit.checks.every(check=>check.status==='unknown'),'Interrupted verification must not invent successful checks');
  assert.deepEqual(calls,phase==='generation'?['generate']:phase==='sandbox'?['generate','sandbox']:phase==='audit'?['generate','sandbox','audit']:['generate','sandbox','audit','repair']);
  assert.equal(result.candidates.at(-1).html,phase==='repair'?repaired:original);
 });
}

test('verified Stop before generation does not invoke a provider or create a candidate',async()=>{
 const result=await runVerifiedGeneration({promptItem,model:{},shouldStop:()=>true,deps:{
  generate:async()=>{throw new Error('Must not call provider');},save:async()=>{throw new Error('Must not save an absent candidate');},
 }});
 assert.equal(result.status,'stopped');assert.deepEqual(result.savedIds,[]);assert.deepEqual(result.candidates,[]);
});

test('verified mode rejects an unconfirmed save and retains the candidate for inspection',async()=>{
 const result=await runVerifiedGeneration({promptItem,model:{},deps:{
  generate:async()=>original,sandbox:async()=>healthy(),audit:async({checklist})=>verdict(checklist),save:async()=>({}),
 }});
 assert.equal(result.status,'save_error');assert.match(result.error.message,/confirmée/);
 assert.equal(result.savedIds.length,0);assert.equal(result.candidates.at(-1).html,original);
});

test('a thrown verified save retains the completed document and its error instead of losing the preview',async()=>{
 const result=await runVerifiedGeneration({promptItem,model:{},deps:{
  generate:async()=>original,sandbox:async()=>healthy(),audit:async({checklist})=>verdict(checklist),save:async()=>{throw new Error('Disk full');},
 }});
 assert.equal(result.status,'save_error');assert.match(result.error.message,/Disk full/);
 assert.equal(result.candidates.at(-1).html,original);
});

test('verified telemetry retains supplier-reported usage when a paid audit fails',async()=>{
 const result=await runVerifiedGeneration({promptItem,model:{},deps:{
  generate:async({onStats})=>{onStats({cost:.1});return original;},sandbox:async()=>healthy(),
  audit:async({onStats})=>{onStats({cost:.04,promptTokens:120,completionTokens:50});throw Object.assign(new Error('Paid failure'),{retryable:false});},
  save:async()=>({id:'audit-failure'}),
 }});
 assert.equal(result.status,'audit_error');
 const call=result.telemetry.calls.find(item=>item.role==='auditor');
 assert.equal(call.usage.estimatedCost,.04);assert.equal(call.usage.promptTokens,120);assert.equal(call.usage.responseTokens,50);
 assert.ok(Math.abs(result.telemetry.estimatedCost-.14)<1e-12);
});
