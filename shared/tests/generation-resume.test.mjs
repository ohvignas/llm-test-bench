import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGenerationResume} from '../../prompt-gallery/services/resumeGeneration.js';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';
import {runVerifiedGeneration} from '../../prompt-gallery/services/verifiedGeneration.js';

const original='<!doctype html><html><body>Saved original</body></html>';
const repaired='<!doctype html><html><body>Repaired version</body></html>';
const generation={id:'page/original',folderId:'page',variantKey:'original',response:original,prompt:'Build a page',metadata:{providerId:'mock',modelId:'A',model:'Model A'}};
const healthy={ok:true,errors:[],warnings:[],timedOut:false};
const audit=(checklist,status)=>({checks:checklist.checks.map(c=>({id:c.id,status,evidence:'Fixture check'})),repairTasks:status==='fail'?['Fix missing feature']:[]});

test('resume loads the saved prompt, code and model even if the library prompt has changed',()=>{
  const seed=prepareGenerationResume(generation,[{id:'page',prompt:'New brief',title:'Changed'}]);
  assert.equal(seed.prompt.prompt,'Build a page');assert.equal(seed.html,original);assert.equal(seed.model.modelId,'A');
  assert.throws(()=>prepareGenerationResume({...generation,response:''}),/Aucun code/);
});

test('resume audits and repairs the saved HTML without invoking generation or repeating its cost',async()=>{
  const seed=prepareGenerationResume(generation),calls=[],saves=[];
  const totals=await runBatch({prompts:[seed.prompt],model:seed.model,options:{mode:'verified',resumeFrom:seed,maxRepairRounds:1},deps:{
    generate:async()=>{throw new Error('Must not regenerate saved code');},
    runSandbox:async()=>healthy,
    audit:async({checklist,html,onStats})=>{calls.push('audit');onStats({cost:.02});return audit(checklist,html===original?'fail':'pass');},
    repair:async({html,onStats})=>{calls.push('repair');assert.equal(html,original);onStats({cost:.03});return repaired;},
    save:async data=>{saves.push(data);return{id:`resumed-${saves.length}`,variantKey:`resumed-${saves.length}`};},
  }});
  assert.deepEqual(calls,['audit','repair','audit']);assert.equal(totals.generated,0);assert.equal(totals.resumed,1);assert.equal(totals.verifiedPassed,1);
  assert.deepEqual(saves.map(s=>s.response),[original,repaired]);assert.equal(saves[0].derivedFrom,'original');
  assert.equal(saves[1].derivedFrom,'resumed-1');assert.equal(saves[0].verification.resumedFrom,generation.id);
  assert.equal(saves[1].billing.requestCount,3);assert.ok(Math.abs(saves[1].billing.confirmedUsd-.07)<1e-9);
  assert.equal(generation.response,original);
});

test('a failed resume keeps the original saved file and reports the paid audit failure',async()=>{
  const seed=prepareGenerationResume(generation),saves=[];
  const result=await runVerifiedGeneration({promptItem:seed.prompt,model:seed.model,initialCandidate:seed,deps:{
    sandbox:async()=>healthy,
    audit:async()=>{throw Object.assign(new Error('Audit failed'),{retryable:false});},
    save:async data=>{saves.push(data);return{id:'audit-failed-version'};},
  }});
  assert.equal(result.status,'audit_error');assert.equal(saves[0].response,original);assert.equal(generation.response,original);
});

test('a provider error arriving after Stop is not mislabeled as cancellation',async()=>{
  let stop=false;
  const result=await runVerifiedGeneration({promptItem:{prompt:'Build a page'},model:{},shouldStop:()=>stop,deps:{
    generate:async()=>{stop=true;throw Object.assign(new Error('Budget exhausted'),{retryable:false});},
  }});
  assert.equal(result.status,'generation_error');assert.match(result.error.message,/Budget exhausted/);
});
