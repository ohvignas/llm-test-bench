import test from 'node:test';
import assert from 'node:assert/strict';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';

const prompt={id:'page',title:'Page',prompt:'Create a small page',tags:[]};
const original='<!doctype html><html><body>Original</body></html>';
const corrected='<!doctype html><html><body>Corrected</body></html>';
const healthy=()=>({errors:[],warnings:[],timedOut:false});

test('Stop before the batch starts performs no provider call or save',async()=>{
 const summary=await runBatch({prompts:[prompt],model:{},shouldStop:()=>true,deps:{
  generate:async()=>{throw new Error('Must not call provider');},save:async()=>{throw new Error('Must not save');},
 }});
 assert.equal(summary.generated,0);assert.equal(summary.saved,0);assert.equal(summary.stopped,true);
});

test('Stop as a complete generation arrives saves the paid result without starting another prompt',async()=>{
 let stop=false,calls=0;const saved=[],events=[];
 const summary=await runBatch({prompts:[prompt,{...prompt,id:'next'}],model:{},shouldStop:()=>stop,onEvent:event=>events.push(event),deps:{
  generate:async(_,{onStats})=>{calls++;onStats({cost:.25});stop=true;return original;},
  save:async value=>{saved.push(value);return{id:'arrived-before-stop'};},
 }});
 assert.equal(calls,1);assert.equal(summary.generated,1);assert.equal(summary.saved,1);assert.equal(summary.stopped,true);
 assert.equal(saved[0].response,original);assert.equal(saved[0].billing.confirmedUsd,.25);
 assert.equal(events.filter(event=>event.type==='preview').at(-1).html,original);
});

test('Stop during sandbox verification keeps the completed output and skips paid healing',async()=>{
 let stop=false,heals=0;const saved=[];
 const summary=await runBatch({prompts:[prompt],model:{},options:{mode:'runtime-heal'},shouldStop:()=>stop,deps:{
  generate:async()=>original,
  runSandbox:async()=>{stop=true;return{...healthy(),errors:['Runtime error']};},
  heal:async()=>{heals++;return corrected;},
  save:async value=>{saved.push(value);return{id:'original'};},
 }});
 assert.equal(heals,0);assert.equal(summary.saved,1);assert.equal(summary.stopped,true);
 assert.equal(saved[0].response,original);assert.deepEqual(saved[0].runStatus.errors,['Runtime error']);
});

test('Stop as a completed repair arrives keeps both original and corrected outputs',async()=>{
 let stop=false,checks=0;const saved=[];
 const summary=await runBatch({prompts:[prompt],model:{},options:{mode:'runtime-heal',saveBothOnHeal:true},shouldStop:()=>stop,deps:{
  generate:async()=>original,
  runSandbox:async()=>checks++?healthy():{...healthy(),errors:['Needs repair']},
  heal:async()=>{stop=true;return corrected;},
  save:async value=>{saved.push(value);return{id:`variant-${saved.length}`};},
 }});
 assert.equal(summary.saved,2);assert.equal(summary.stopped,true);
 assert.deepEqual(saved.map(item=>item.response),[original,corrected]);
});

test('a failed repair save still reports the already saved original and stops subsequent prompts',async()=>{
 let calls=0,saves=0,checks=0;const events=[];
 const summary=await runBatch({prompts:[prompt,{...prompt,id:'next'}],model:{},options:{mode:'runtime-heal',saveBothOnHeal:true},onEvent:event=>events.push(event),deps:{
  generate:async()=>{calls++;return original;},
  runSandbox:async()=>checks++?healthy():{...healthy(),errors:['Needs repair']},
  heal:async()=>corrected,
  save:async()=>{if(++saves===2)throw new Error('Disk full');return{id:'original-on-disk'};},
 }});
 assert.equal(calls,1);assert.equal(summary.saved,1);assert.equal(summary.failed,1);assert.equal(summary.stopped,true);
 const failure=events.find(event=>event.type==='item'&&event.status==='error');
 assert.deepEqual(failure.savedIds,['original-on-disk']);assert.match(failure.message,/Disk full/);
 assert.equal(events.filter(event=>event.type==='preview').at(-1).html,corrected,'Unsaved complete code remains available to copy');
});

test('an unconfirmed save is an error rather than a successful saved generation',async()=>{
 let calls=0;const events=[];
 const summary=await runBatch({prompts:[prompt,{...prompt,id:'next'}],model:{},onEvent:event=>events.push(event),deps:{
  generate:async()=>{calls++;return original;},save:async()=>({}),
 }});
 assert.equal(calls,1);assert.equal(summary.saved,0);assert.equal(summary.failed,1);assert.equal(summary.stopped,true);
 assert.equal(events.some(event=>event.type==='item'&&event.status==='saved'),false);
 assert.match(events.find(event=>event.type==='item'&&event.status==='error').message,/confirmée/);
});
