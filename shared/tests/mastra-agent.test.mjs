import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BATCH_MODE,batchGenerationOptions} from '../../prompt-gallery/services/batchMode.js';
import {agentLimits} from '../../prompt-gallery/services/agentSettings.js';
import {costTotals,updateCostCall} from '../../prompt-gallery/services/batchCosts.js';
import {executionBatchSnapshot} from '../../prompt-gallery/services/executions.js';
import {durableGeneration} from '../services/durable-generation.js';
import {createBatchJournal} from '../../prompt-gallery/services/batchGenerationLog.js';

test('Mastra is the default for every prompt; explicit single-call comparison remains available',()=>{
  assert.equal(DEFAULT_BATCH_MODE,'agent');
  const config=batchGenerationOptions({mode:DEFAULT_BATCH_MODE,profile:'maximum'});
  assert.equal(config.engine,'mastra');assert.equal(config.profile,'maximum');
  assert.equal(batchGenerationOptions({mode:'comparison'}).engine,'completion');
  assert.deepEqual(agentLimits({maxSteps:99,budgetUsd:Infinity}),{maxSteps:8,budgetUsd:10});
});

test('agent sessions expand into actual provider invoices without double counting their total',()=>{
  const agentSteps=[{id:'step1',started:1,updated:2,state:'ok',usage:{cost:.01}},{id:'step2',started:3,updated:4,state:'error',usage:{}}];
  const call=updateCostCall({id:'session',usd:.01},{cost:.01,agentSteps});
  const total=costTotals([call]);assert.equal(total.requestCount,2);assert.equal(total.confirmedUsd,.01);assert.equal(total.missingCosts,1);
  assert.equal(costTotals([updateCostCall(call,{agentSteps:[]})]).requestCount,0);
});

test('persisted comparisons keep tool events, per-step bills and source recovery before any preview exists',()=>{
  const snapshot=executionBatchSnapshot([{id:'agent',model:'test/model',context:{promptId:'p',title:'Projet'},state:'error',started:1,updated:4,output:'',output_chars:0,usage:{cost:.01},
    agent:{has_sources:true,events:[{at:2000,message:'Outil write_file · src/main.ts'}],steps:[{id:'step1',started:1,updated:2,state:'ok',usage:{cost:.01}}]}}]);
  assert.equal(snapshot.items[0].hasSources,true);assert.equal(snapshot.currentCostCalls.length,1);
  assert.equal(snapshot.costCalls[0].id,'step1');assert.ok(snapshot.entries.some(e=>e.message.includes('write_file')));
});

test('durable streaming signals complete preview replacement and sends tool events only once',async()=>{
  let polls=0;
  const events=[{id:'tool-1',at:1,message:'Outil build_project'}];
  const fetcher=async(url,init)=>{
    if(init?.method==='POST')return Response.json({id:'test'});
    polls++;
    return Response.json({state:polls===1?'running':'ok',output_reset:true,output_revision:polls,output_chars:polls===1?20:10,
      delta:polls===1?'<html>previous</html>':'<html>new</html>',finish_reason:polls===1?null:'stop',
      agent:{events,steps:[]}});
  };
  const response=await durableGeneration({body:{},context:{},fetcher,interval:1});const text=await response.text();
  assert.equal((text.match(/bench_output_reset/g)||[]).length,2);
  assert.equal((text.match(/Outil build_project/g)||[]).length,1);
});

test('the live journal shows actual tool activity from server streaming',()=>{
  const journal=createBatchJournal();journal.event({type:'stats',stats:{agentEvents:[{at:1234,message:'Outil test_project terminé'}],agentSteps:[]}});
  assert.equal(journal.entries()[0].stage,'outil');assert.equal(journal.entries()[0].message,'Outil test_project terminé');
});
