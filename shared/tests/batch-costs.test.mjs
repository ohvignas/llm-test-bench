import test from 'node:test';
import assert from 'node:assert/strict';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';
const prompt={id:'test',title:'Test',prompt:'Create a page',tags:[]};
const model={providerId:'test',modelId:'model'};
async function run(deps,options={}) {
 const events=[],saved=[];
 await runBatch({prompts:[prompt],model,options,deps:{save:async a=>{saved.push(a);return{id:'test'};},...deps},onEvent:e=>events.push(e)});
 return {calls:[...new Map(events.filter(e=>e.type==='cost').map(e=>[e.call.id,e.call])).values()],events,saved};
}
test('real cumulative API usage replaces each call amount, including zero, and persists with the generation',async()=>{
 const {calls,saved,events}=await run({generate:async(_,{onStats})=>{onStats({cost:.1});onStats({cost:.1});return '<html>ok</html>';}});
 assert.equal(calls.length,1);assert.equal(calls[0].usd,.1);assert.equal(calls[0].status,'done');
 assert.equal(events.find(e=>e.type==='cost').call.usd,null);
 assert.equal(saved[0].billing.confirmedUsd,.1);
 const free=await run({generate:async(_,{onStats})=>{onStats({cost:0});return '<html>free</html>';}});
 assert.equal(free.calls[0].usd,0);assert.equal(free.saved[0].billing.missingCosts,0);
});
test('reasoning-only paid failures retain their exact cost without an automatic retry',async()=>{
 const {calls}=await run({generate:async(_,{onStats})=>{onStats({cost:.674272});throw Object.assign(new Error('Empty'),{retryable:false});}},{apiRetries:2});
 assert.equal(calls.length,1);assert.equal(calls[0].usd,.674272);assert.equal(calls[0].status,'error');
});
test('unknown or cancelled costs stay unknown rather than becoming zero',async()=>{
 const {calls}=await run({generate:async()=>{throw new DOMException('Stopped','AbortError');}});
 assert.equal(calls.length,1);assert.equal(calls[0].usd,null);assert.equal(calls[0].status,'cancelled');
});
test('repair calls are charged separately and summed once per prompt',async()=>{
 let checks=0;
 const {calls,saved}=await run({generate:async(_,{onStats})=>{onStats({cost:.2});return '<html>original</html>';},runSandbox:async()=>({errors:checks++?[]:['bad']}),heal:async({onStats})=>{onStats({cost:.3});return '<html>fixed</html>';}},{mode:'runtime-heal'});
 assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.role),['generate','heal']);
 assert.equal(saved.at(-1).billing.confirmedUsd,.5);
});
test('audits are included even when their structured response is invalid',async()=>{
 const {calls,saved}=await run({generate:async(_,{onStats})=>{onStats({cost:.2});return '<!doctype html><html><body>ok</body></html>';},runSandbox:async()=>({ok:true,errors:[],warnings:[]}),audit:async({onStats})=>{onStats({cost:.04});return 'invalid JSON';}},{mode:'verified',maxRepairRounds:0});
 assert.deepEqual(calls.map(c=>c.role),['generate','audit']);
 assert.equal(calls[1].usd,.04);
 assert.equal(saved[0].billing.calls.length,2);
});
test('different model lanes and prompts retain separate call identities',async()=>{
 const events=[];
 await Promise.all(['A','B'].map(modelId=>runBatch({prompts:[prompt,{...prompt,id:'second'}],model:{...model,modelId},deps:{generate:async(_,{onStats})=>{onStats({cost:.1});return '<html>ok</html>';},save:async()=>({id:'saved'})},onEvent:e=>events.push({...e,modelId})})));
 const calls=[...new Map(events.filter(e=>e.type==='cost').map(e=>[e.call.id,e])).values()];
 assert.equal(calls.length,4);
 assert.deepEqual(calls.map(c=>`${c.modelId}:${c.index}`).sort(),['A:0','A:1','B:0','B:1']);
});
