import test from 'node:test';
import assert from 'node:assert/strict';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';
import {runVerifiedGeneration} from '../../prompt-gallery/services/verifiedGeneration.js';

const prompt={id:'test',title:'test',prompt:'Create an HTML page',tags:[]};
test('a token budget failure is not retried even when API retries were enabled',async()=>{
  let calls=0;
  const error=Object.assign(new Error('Budget de tokens épuisé sans HTML'),{retryable:false,code:'OUTPUT_TOKEN_LIMIT'});
  const summary=await runBatch({prompts:[prompt],model:{},options:{apiRetries:1},deps:{generate:async()=>{calls++;throw error;}}});
  assert.equal(calls,1);
  assert.equal(summary.failed,1);
});
test('a completed empty answer is not sent back to the same model automatically',async()=>{
  let calls=0;
  const summary=await runBatch({prompts:[prompt],model:{},options:{apiRetries:1},deps:{generate:async()=>{calls++;return '';}}});
  assert.equal(calls,1);
  assert.equal(summary.failed,1);
});
test('verified generation also stops after a non-retryable budget failure',async()=>{
  let calls=0;
  const result=await runVerifiedGeneration({promptItem:prompt,model:{},options:{apiRetries:1},deps:{generate:async()=>{calls++;throw Object.assign(new Error('Budget épuisé'),{retryable:false});}}});
  assert.equal(calls,1);
  assert.equal(result.status,'generation_error');
});
test('a user-enabled retry still handles a transient transport failure',async()=>{
  let calls=0;
  const summary=await runBatch({prompts:[prompt],model:{},options:{apiRetries:1,stopOnFailure:false},deps:{generate:async()=>{if(++calls===1)throw new Error('Transport failed');return '<html>ok</html>';},save:async()=>({id:'test'})}});
  assert.equal(calls,2);
  assert.equal(summary.saved,1);
});
test('spending protection stops the whole prompt queue after a paid failure',async()=>{
 let calls=0;
 const summary=await runBatch({prompts:[prompt,{...prompt,id:'second'}],model:{},deps:{generate:async()=>{calls++;throw Object.assign(new Error('filtered'),{code:'CONTENT_FILTERED',retryable:false});}}});
 assert.equal(calls,1);assert.equal(summary.failed,1);assert.equal(summary.stopped,true);
});
test('spending protection disables even transport retries when enabled',async()=>{
 let calls=0;
 await runBatch({prompts:[prompt],model:{},options:{apiRetries:3,stopOnFailure:true},deps:{generate:async()=>{calls++;throw new Error('network');}}});
 assert.equal(calls,1);
});
