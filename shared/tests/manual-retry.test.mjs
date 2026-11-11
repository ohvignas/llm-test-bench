import test from 'node:test';
import assert from 'node:assert/strict';
import {retryProposal, manualRetryModel, createRetryQueue, applyRetrySummaries} from '../../prompt-gallery/services/manualRetry.js';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';
const nonce='a'.repeat(32);
test('credit suggestion is optional and never changes maximum reasoning or the prompt',async()=>{
 const proposal=retryProposal('You requested up to 128000 tokens, but can only afford 116356.',128000);
 assert.equal(proposal.maximum,128000);assert.equal(proposal.recommended,110538);
 for(const cap of [proposal.maximum,proposal.recommended]){
  const model=manualRetryModel({modelId:'model',generationOptions:{profile:'automatic',automatic:{id:'old',limit:3}}},cap,128000,nonce);
  let count=0;
  const result=await runBatch({prompts:[{id:'p',prompt:'full original prompt'}],model,options:{mode:'comparison',apiRetries:3},deps:{
   generate:async(prompt,{model})=>{count++;assert.equal(prompt,'full original prompt');assert.equal(model.generationOptions.profile,'maximum');assert.equal(model.generationOptions.reviewedMaxTokens,cap);assert.equal(model.generationOptions.explicitRetry,nonce);assert.equal(model.generationOptions.automatic,undefined);return '<html>ok</html>';},save:async()=>({id:'new'})}});
  assert.equal(count,1);assert.equal(result.saved,1);
 }
 assert.throws(()=>manualRetryModel({},128001,128000,nonce));
});
test('one retry can finish while a peer is running; duplicate clicks do not duplicate calls',async()=>{
 const queue=createRetryQueue();let release,paid=0,peerFinished=false;
 const peer=new Promise(resolve=>release=()=>{peerFinished=true;resolve();});
 const retry=queue.run(0,async()=>{paid++;await peer;return 'saved';});
 assert.equal(queue.size,1);
 assert.equal(await queue.run(0,async()=>{paid++;}),undefined);
 assert.equal(await queue.run(1,async()=>'independent'),'independent');
 assert.equal(peerFinished,false);assert.equal(paid,1);
 release();assert.equal(await retry,'saved');assert.equal(queue.size,0);
});
test('manual failure is a single call and preserves retry accounting without inflating prompt totals',async()=>{
 let calls=0;
 const result=await runBatch({prompts:[{id:'p',prompt:'p'}],model:manualRetryModel({},128000,128000,nonce),options:{mode:'comparison',apiRetries:3},deps:{generate:async()=>{calls++;throw new Error('402');}}});
 assert.equal(calls,1);assert.equal(result.failed,1);
 const before={total:6,lanes:2,failed:1,saved:1,generated:1};
 const final=applyRetrySummaries(before,[{result,wasError:true},{result:{failed:0,saved:1,generated:1},wasError:true}]);
 assert.equal(final.failed,0);assert.equal(final.saved,2);assert.equal(final.total,6);assert.equal(before.failed,1);
});
