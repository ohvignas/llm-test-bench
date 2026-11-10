import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpendGuard} from '../services/generation-spend-guard.js';
const storage=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};};
const input={modelId:'vendor/model',systemPrompt:'HTML',userPrompt:'private prompt',params:{max_tokens:32768,reasoning:{effort:'low'}}};
const automatic={id:'auto-test-1234567890',limit:3};
test('automatic launch can recover a failed fingerprint but cannot send a fourth call across guard instances',async()=>{
 const store=storage();let sent=0;
 for(let i=0;i<3;i++)await assert.rejects(createSpendGuard(store).run({...input,automatic},async()=>{sent++;throw new Error('network');}));
 await assert.rejects(createSpendGuard(store).run({...input,automatic},async()=>{sent++;}),e=>e.code==='AUTOMATIC_LIMIT'&&e.requestSent===false);
 assert.equal(sent,3);
});
test('automatic launch never clears filtered or in-flight requests, including across a reload',async()=>{
 const store=storage(),guard=createSpendGuard(store);let release;
 const first=guard.run({...input,automatic},async()=>{await new Promise(r=>release=r);return 'ok';});
 while(!release)await new Promise(r=>setTimeout(r,1));
 await assert.rejects(createSpendGuard(store).run({...input,automatic:{...automatic,id:'another-auto-123456789'}},async()=>assert.fail('duplicate')),e=>e.code==='PAID_RETRY_BLOCKED');
 release();await first;
 await assert.rejects(guard.run(input,async()=>{throw Object.assign(new Error('filter'),{code:'CONTENT_FILTERED'});}));
 await assert.rejects(guard.run({...input,automatic},async()=>assert.fail('filtered retry')),e=>e.code==='PAID_RETRY_BLOCKED');
});
test('automatic allowance includes changed repair prompts and is bound to one model',async()=>{
 const guard=createSpendGuard(storage());
 for(let i=0;i<3;i++)await guard.run({...input,userPrompt:'repair '+i,automatic},async()=>'ok');
 await assert.rejects(guard.run({...input,userPrompt:'another repair',automatic},async()=>assert.fail('fourth call')),e=>e.code==='AUTOMATIC_LIMIT');
 await assert.rejects(guard.run({...input,modelId:'other/model',automatic},async()=>assert.fail('model changed')),e=>e.code==='AUTOMATIC_LIMIT');
});
test('paid failure blocks an identical manual restart across guard instances without storing prompts',async()=>{
 const store=storage();let paid=0;
 await assert.rejects(createSpendGuard(store).run(input,async()=>{paid++;throw Object.assign(new Error('empty'),{code:'OUTPUT_TOKEN_LIMIT'});}));
 await assert.rejects(createSpendGuard(store).run(input,async()=>{paid++;}),e=>e.code==='PAID_RETRY_BLOCKED'&&e.retryable===false&&e.requestSent===false);
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
 await assert.rejects(guard.run(input,async()=>{paid++;}),e=>e.code==='GENERATION_IN_FLIGHT'&&e.requestSent===false);
 release();await first;assert.equal(paid,1);
});
test('a page reload cannot send a second copy of a still-running or interrupted request',async()=>{
 const store=storage();const guard=createSpendGuard(store);let release;
 const first=guard.run(input,async()=>{await new Promise(r=>release=r);return 'ok';});
 while(!release)await new Promise(r=>setTimeout(r,1));
 await assert.rejects(createSpendGuard(store).run(input,async()=>'duplicate'),e=>e.code==='PAID_RETRY_BLOCKED');
 release();await first;
});

test('unavailable protection storage is marked unsent only before the provider operation',async()=>{
 let sent=0;
 const unreadable={getItem(){throw new Error('Read denied');}};
 await assert.rejects(createSpendGuard(unreadable).run(input,async()=>{sent++;}),e=>e.code==='SPEND_GUARD_UNAVAILABLE'&&e.requestSent===false);
 assert.equal(sent,0);
 const store=storage();
 const guard=createSpendGuard(store);
 await assert.rejects(guard.run(input,async()=>{sent++;store.getItem=()=>{throw new Error('Read denied');};return 'paid result';}),e=>e.code==='SPEND_GUARD_UNAVAILABLE'&&e.requestSent!==false);
 assert.equal(sent,1);
});

test('an unsent server rejection does not create a second persistent browser block',async()=>{
 const store=storage(),guard=createSpendGuard(store);let sent=0;
 await assert.rejects(guard.run(input,async()=>{throw Object.assign(new Error('Server preflight blocked'),{requestSent:false,status:409});}));
 assert.equal(await createSpendGuard(store).run(input,async()=>{sent++;return 'html';}),'html');
 assert.equal(sent,1);
});

test('an explicit server reset releases stale failures in another browser once, preserving subsequent failures',async()=>{
 const browserA=createSpendGuard(storage()),browserB=createSpendGuard(storage());
 for(const guard of [browserA,browserB])await assert.rejects(guard.run(input,async()=>{throw new Error('old failure');}));
 const revision='1234567890abcdef1234567890abcdef';
 browserA.syncReset(revision);browserB.syncReset(revision);
 assert.equal(await browserB.run(input,async()=>'after reset'),'after reset');
 await assert.rejects(browserB.run(input,async()=>{throw new Error('new paid failure');}));
 browserB.syncReset(revision);
 await assert.rejects(browserB.run(input,async()=>assert.fail('new failure must remain protected')),e=>e.code==='PAID_RETRY_BLOCKED');
});

test('a reset cannot release an in-memory call which is still running',async()=>{
 const guard=createSpendGuard(storage());let release;
 const first=guard.run(input,async()=>{await new Promise(r=>release=r);return 'ok';});
 while(!release)await new Promise(r=>setTimeout(r,1));
 guard.syncReset('1234567890abcdef1234567890abcdef');
 await assert.rejects(guard.run(input,async()=>assert.fail('duplicate')),e=>e.code==='GENERATION_IN_FLIGHT');
 release();await first;
});

test('an unsent automatic retry preserves an earlier paid failure',async()=>{
 const guard=createSpendGuard(storage());
 await assert.rejects(guard.run(input,async()=>{throw new Error('paid failure');}));
 await assert.rejects(guard.run({...input,automatic},async()=>{throw Object.assign(new Error('preflight'),{requestSent:false});}));
 await assert.rejects(guard.run(input,async()=>assert.fail('paid failure erased')),e=>e.code==='PAID_RETRY_BLOCKED');
});

test('manual retry is scoped to the chosen request and never releases a peer or filtered request',async()=>{
 const guard=createSpendGuard(storage()),explicitRetry='a'.repeat(32);let release;
 await assert.rejects(guard.run(input,async()=>{throw new Error('credit');}));
 const other={...input,modelId:'other/model'};
 await assert.rejects(guard.run(other,async()=>{throw new Error('other paid failure');}));
 const retry=guard.run({...input,explicitRetry},async()=>{await new Promise(r=>release=r);return 'ok';});
 while(!release)await new Promise(r=>setTimeout(r,1));
 await assert.rejects(guard.run({...input,explicitRetry},async()=>assert.fail('duplicate')),e=>e.requestSent===false);
 await assert.rejects(guard.run(other,async()=>assert.fail('other unlocked')),e=>e.code==='PAID_RETRY_BLOCKED');
 release();await retry;
 await assert.rejects(guard.run(input,async()=>{throw Object.assign(new Error('filter'),{code:'CONTENT_FILTERED'});}));
 await assert.rejects(guard.run({...input,explicitRetry},async()=>assert.fail('filter bypass')),e=>e.code==='PAID_RETRY_BLOCKED');
});
