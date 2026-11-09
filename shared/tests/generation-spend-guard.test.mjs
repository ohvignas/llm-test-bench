import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpendGuard} from '../services/generation-spend-guard.js';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};};
const input={modelId:'vendor/model',systemPrompt:'HTML',userPrompt:'private prompt',params:{max_tokens:32768,reasoning:{effort:'low'}}};
test('paid failure blocks an identical manual restart across guard instances without storing prompts',async()=>{
 const store=storage();let paid=0;
 await assert.rejects(createSpendGuard(store).run(input,async()=>{paid++;throw Object.assign(new Error('empty'),{code:'OUTPUT_TOKEN_LIMIT'});}));
 await assert.rejects(createSpendGuard(store).run(input,async()=>{paid++;}),e=>e.code==='PAID_RETRY_BLOCKED'&&e.retryable===false);
 assert.equal(paid,1);assert.ok(!JSON.stringify([...store.data]).includes('private prompt'));
});
test('filter failure cannot be retried merely by increasing tokens or effort',async()=>{
 const guard=createSpendGuard(storage());let paid=0;
 await assert.rejects(guard.run(input,async()=>{paid++;throw Object.assign(new Error('filter'),{code:'CONTENT_FILTERED'});}));
 await assert.rejects(guard.run({...input,params:{max_tokens:128000}},async()=>{paid++;}),e=>e.code==='PAID_RETRY_BLOCKED');
 assert.equal(paid,1);
});
test('successful requests are allowed again; an explicit reset permits a failed request',async()=>{
 const guard=createSpendGuard(storage());
 assert.equal(await guard.run(input,async()=>'html'),'html');
 assert.equal(await guard.run(input,async()=>'html'),'html');
 await assert.rejects(guard.run(input,async()=>{throw new Error('network');}));
 guard.clear();assert.equal(await guard.run(input,async()=>'ok'),'ok');
});
test('concurrent duplicate launch is blocked before a second paid operation',async()=>{
 const guard=createSpendGuard(storage());let release;let paid=0;
 const first=guard.run(input,async()=>{paid++;await new Promise(r=>release=r);return 'ok';});
 while(!release)await new Promise(r=>setTimeout(r,1));
 await assert.rejects(guard.run(input,async()=>{paid++;}),e=>e.code==='GENERATION_IN_FLIGHT');
 release();await first;assert.equal(paid,1);
});
test('a page reload cannot send a second copy of a still-running or interrupted request',async()=>{
 const store=storage();const guard=createSpendGuard(store);let release;
 const first=guard.run(input,async()=>{await new Promise(r=>release=r);return 'ok';});
 while(!release)await new Promise(r=>setTimeout(r,1));
 await assert.rejects(createSpendGuard(store).run(input,async()=>'duplicate'),e=>e.code==='PAID_RETRY_BLOCKED');
 release();await first;
});
