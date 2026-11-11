import test from 'node:test';
import assert from 'node:assert/strict';
import {createReasoningSummary,providerSummaryParts, REASONING_SUMMARY_LIMIT} from '../services/reasoning-summary.js';
import {batchActivity} from '../../prompt-gallery/services/batchActivity.js';
import {logModelKey} from '../../prompt-gallery/services/batchGenerationLog.js';
import {updateCostCall, finishCostCall} from '../../prompt-gallery/services/batchCosts.js';

test('only explicit summaries are collected, bounded and redacted across chunk boundaries', () => {
  const summary = createReasoningSummary();
  assert.equal(summary.add([{type:'reasoning.text',text:'PRIVATE'}, {type:'reasoning.encrypted',data:'SECRET'}, {text:'UNKNOWN'}]), false);
  assert.equal(summary.snapshot(), null);
  summary.add([{type:'reasoning.summary',id:'one',summary:'Préparation du décor. sk-or-'}]);
  summary.add([{type:'reasoning.summary',id:'one',summary:'v1-secretxyz'}]);
  assert.equal(summary.snapshot().text, 'Préparation du décor. [clé masquée]');
  summary.add([{type:'reasoning.summary',id:'two',summary:'Animation du personnage.'}]);
  assert.match(summary.snapshot().text, /\n\nAnimation/);
  summary.add([{type:'reasoning.summary',id:'two',summary:'x'.repeat(10000)}]);
  assert.equal(summary.snapshot().truncated, true);
  assert.ok(summary.snapshot().text.length <= REASONING_SUMMARY_LIMIT + 20);
  assert.doesNotMatch(JSON.stringify(summary.snapshot()), /PRIVATE|SECRET|UNKNOWN|secretxyz/);
});

test('a summary and counters remain attached to their exact call on completion or error', () => {
  let call={id:'cost',usd:null,status:'pending'};
  call=updateCostCall(call,{reasoningSummary:{text:'Résumé public',source:'provider-summary',truncated:false},reasoningSignals:10});
  call=updateCostCall(call,{cost:.2});
  call=finishCostCall(call,new Error('Provider failure'));
  assert.equal(call.reasoningSummary.text,'Résumé public');
  assert.equal(call.reasoningSignals,10);assert.equal(call.usd,.2);assert.equal(call.status,'error');
});

test('modern Claude compatibility summaries are recognized without exposing unknown or encrypted reasoning',()=>{
  const delta={reasoning_details:[{type:'reasoning.text',format:'anthropic-claude-v1',text:'Résumé public du fournisseur.'}]};
  assert.equal(providerSummaryParts(delta,'anthropic/claude-opus-5.5')[0].summary,'Résumé public du fournisseur.');
  assert.deepEqual(providerSummaryParts(delta,'other/model'),[]);
  assert.deepEqual(providerSummaryParts({reasoning_details:[{...delta.reasoning_details[0],format:'unknown'}]},'anthropic/claude-opus-5.5'),[]);
  assert.deepEqual(providerSummaryParts({reasoning_details:[{type:'reasoning.encrypted',data:'OPAQUE'}],reasoning:'UNKNOWN'},'anthropic/claude-opus-5.5'),[]);
  assert.equal(providerSummaryParts({reasoning:'Résumé public.'},'anthropic/claude-fable-5.2')[0].summary,'Résumé public.');
  assert.deepEqual(providerSummaryParts({reasoning:'PRIVATE'},'other/model'),[]);
});

test('the panel never borrows activity or summaries from another project of the same model', () => {
  const model={providerId:'openrouter',modelId:'model'}, now=1000;
  const summary={source:'provider-summary',text:'Résumé du jeu'};
  const calls=[{id:'cost-game',telemetryId:'game',startedAt:now,reasoningSummary:summary}];
  const liveCalls=[{...model,id:'site',app:'prompt-gallery',reasoningChunks:999}, {...model,id:'game',app:'prompt-gallery',reasoningChunks:7}];
  const entries=[{id:1,modelKey:logModelKey(model),promptIndex:0,message:'Jeu'}, {id:2,modelKey:logModelKey(model),promptIndex:1,message:'Site'}];
  const result=batchActivity({model,index:0,calls,liveCalls,entries});
  assert.equal(result.live.id,'game');assert.equal(result.signals,7);assert.equal(result.text,'Résumé du jeu');
  assert.deepEqual(result.entries.map(e=>e.message),['Jeu']);
  const next=batchActivity({model,index:0,calls:[...calls,{id:'repair',startedAt:now+1}],liveCalls,entries});
  assert.equal(next.live,null);assert.equal(next.text,'', 'New call must not display a previous call summary as current');
  assert.equal(batchActivity({model,index:1,liveCalls,entries}).signals,null);
});
