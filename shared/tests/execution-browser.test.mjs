import test from 'node:test';
import assert from 'node:assert/strict';
import { executionProjects,executionCost,executionStatus } from '../../prompt-gallery/services/executions.js';
import { durableGeneration } from '../services/durable-generation.js';

test('three prompts form three cards, each containing both models, including errors and pending calls',()=>{
  const calls=Array.from({length:6},(_,i)=>({id:String(i),model:'model'+Math.floor(i/3),started:100,
    context:{groupId:'batch',promptId:'prompt'+i%3,title:'Projet '+i%3},state:i===0?'error':'reasoning'}));
  const projects=executionProjects([...calls,{id:'old',model:'old',context:{}}]);
  assert.equal(projects.length,3);
  for(const p of projects)assert.equal(new Set(p.calls.map(c=>c.model)).size,2);
  assert.equal(executionProjects([...calls,{...calls[0],context:{...calls[0].context,groupId:'other'}}]).length,4);
});
test('unknown and blocked costs never become zero dollars or paid calls',()=>{
  assert.deepEqual(executionCost([{usage:{}}]),{count:1,unknown:1,label:'Coût non communiqué'});
  assert.equal(executionCost([{error:{requestSent:false}}]).count,0);
  assert.equal(executionCost([{usage:{cost:.2}},{usage:{}}]).label,'0,2 $US + coûts en attente');
  assert.match(executionStatus({finish_reason:'length',output_chars:0}),/sans code/);
});
test('durable transport submits once and reads output with unicode-safe server offsets',async()=>{
  const calls=[];
  let polls=0;
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url==='/api/executions')return Response.json({id:'test'},{status:202});
    return Response.json(++polls===1
      ? {state:'writing',delta:'✅',output_chars:1,reasoning_events:10,usage:{}}
      : {state:'ok',delta:'<html></html>',output_chars:14,finish_reason:'stop',reasoning_events:10,usage:{cost:.1}});
  };
  const response=await durableGeneration({body:{},context:{},fetcher,interval:1});
  const text=await response.text();
  assert.match(text,/✅/);assert.match(text,/\[DONE\]/);assert.match(text,/"cost":0.1/);
  assert.ok(calls[2].url.endsWith('?offset=1'));
  assert.equal(calls.filter(c=>c.options?.method==='POST').length,1);
});
test('explicit Stop cancels the server call but merely disconnecting the reader does not',async()=>{
  for(const manual of [false,true]) {
    const requests=[];const control=new AbortController();let poll;
    const fetcher=async(url,options)=>{
      requests.push({url,options});
      if(options?.method==='POST')return Response.json({});
      return new Promise(resolve=>{poll=()=>resolve(Response.json({state:'reasoning',delta:'',output_chars:0,reasoning_events:1,usage:{}}));});
    };
    const response=await durableGeneration({body:{},context:{},fetcher,interval:1,signal:control.signal});
    const reader=response.body.getReader();
    if(manual)control.abort();else await reader.cancel();
    poll();await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(requests.some(r=>r.url.endsWith('/stop')),manual);
    if(manual)await assert.rejects(reader.read(),e=>e.name==='AbortError');
  }
});

test('restored batch view includes all six zero-output calls before a single page exists',async()=>{
  const {executionBatchSnapshot}=await import('../../prompt-gallery/services/executions.js');
  const {liveComparisonCards}=await import('../../prompt-gallery/services/batchLiveComparison.js');
  const {batchActivity}=await import('../../prompt-gallery/services/batchActivity.js');
  const calls=Array.from({length:6},(_,i)=>({id:'call'+i,model:'model'+Math.floor(i/3),started:100,updated:105,
    context:{groupId:'batch',promptId:'prompt'+i%3,title:'Projet '+i%3},
    state:i===0?'queued':'reasoning',output_chars:0,reasoning_events:i+10,usage:{},error:{}}));
  const snapshot=executionBatchSnapshot(calls,106000);
  assert.equal(snapshot.models.length,2);assert.equal(snapshot.runList.length,6);
  assert.equal(snapshot.done,false);assert.equal(snapshot.outputs.join(''),'');
  assert.equal(snapshot.costCalls.length,6);assert.equal(snapshot.liveCalls.length,6);
  for(const project of executionProjects(calls)){
    const cards=liveComparisonCards({...snapshot,calls:snapshot.costCalls,promptId:project.key});
    assert.equal(cards.length,2);
    for(const card of cards){
      assert.equal(card.prompt.title,project.title);assert.equal(card.calls.length,1);
      const activity=batchActivity({...card,liveCalls:snapshot.liveCalls,entries:snapshot.entries});
      assert.equal(activity.live.id,card.calls[0].id);
      assert.equal(activity.signals,calls.find(c=>c.id===activity.live.id).reasoning_events);
    }
  }
});
test('a partial failure, its cost and successful peer stay available in the original batch panes',async()=>{
  const {executionBatchSnapshot}=await import('../../prompt-gallery/services/executions.js');
  const context={groupId:'lot',promptId:'p',title:'Mon projet'};
  const snapshot=executionBatchSnapshot([
    {id:'failed',model:'a',context,state:'error',started:100,updated:120,output:'<html>partiel',error:{message:'Limite atteinte'},usage:{cost:2}},
    {id:'peer',model:'b',context,state:'ok',started:100,updated:130,output:'<html>complet</html>',error:{},usage:{cost:1}},
  ]);
  assert.equal(snapshot.done,true);assert.deepEqual(snapshot.items.map(i=>i.status),['error','saved']);
  assert.equal(snapshot.outputs[0],'<html>partiel');assert.equal(snapshot.items[0].message,'Limite atteinte');
  assert.equal(snapshot.costCalls.reduce((total,c)=>total+c.usd,0),3);
});

test('retry duration excludes older attempts and idle time while retaining their billed costs',async()=>{
  const {executionBatchSnapshot}=await import('../../prompt-gallery/services/executions.js');
  const {executionMetrics}=await import('../../prompt-gallery/services/executionMetrics.js');
  const {liveComparisonCards}=await import('../../prompt-gallery/services/batchLiveComparison.js');
  const context={groupId:'lot',promptId:'p',title:'Mon projet'};
  const snapshot=executionBatchSnapshot([
    {id:'old-a',model:'a',context,state:'error',started:100,updated:130,usage:{cost:2}},
    {id:'old-b',model:'b',context,state:'cancelled',started:100,updated:140,usage:{cost:1}},
    {id:'new-a',model:'a',context,state:'reasoning',started:3700,updated:3760,usage:{}},
    {id:'new-b',model:'b',context,state:'writing',started:3701,updated:3760,usage:{}},
  ],3770000);
  assert.deepEqual(snapshot.currentCostCalls.map(c=>c.id),['new-a','new-b']);
  assert.equal(executionMetrics(snapshot.currentCostCalls,{now:snapshot.now,done:snapshot.done}).elapsedMs,70000);
  assert.equal(snapshot.costCalls.length,4);
  assert.equal(snapshot.costCalls.reduce((sum,c)=>sum+(c.usd||0),0),3);
  const cards=liveComparisonCards({...snapshot,calls:snapshot.costCalls,promptId:JSON.stringify(['lot','p'])});
  assert.deepEqual(cards.map(c=>c.currentCalls.map(call=>call.id)),[['new-a'],['new-b']]);
  assert.deepEqual(cards.map(c=>c.calls.length),[2,2]);
});

test('a single project retry does not inherit time or costs from the other projects in its batch',async()=>{
  const {executionBatchSnapshot,executionComparisonScope}=await import('../../prompt-gallery/services/executions.js');
  const {executionMetrics}=await import('../../prompt-gallery/services/executionMetrics.js');
  const context={groupId:'lot',promptId:'p',title:'Projet relancé'};
  const snapshot=executionBatchSnapshot([
    {id:'unrelated',model:'a',context:{...context,promptId:'other'},state:'ok',started:100,updated:150,usage:{cost:9}},
    {id:'old',model:'a',context,state:'error',started:200,updated:250,usage:{cost:2}},
    {id:'new',model:'a',context,state:'reasoning',started:3700,updated:3760,usage:{}},
  ],3770000);
  const scope=executionComparisonScope(snapshot,JSON.stringify(['lot','p']));
  assert.deepEqual(scope.calls.map(c=>c.id),['new','old']);
  assert.deepEqual(scope.currentCalls.map(c=>c.id),['new']);
  assert.equal(scope.done,false);
  assert.equal(executionMetrics(scope.currentCalls,{now:snapshot.now,done:scope.done}).elapsedMs,70000);
  assert.equal(scope.calls.reduce((sum,c)=>sum+(c.usd||0),0),2);
});

test('recovery only targets the latest failed model attempt and preserves successful peers',async()=>{
  const {recoveryCandidates,recoveryFallback}=await import('../../prompt-gallery/services/executionRecovery.js');
  const calls=[{id:'old',model:'a',state:'error',durable:true,started:1},{id:'new',model:'a',state:'reasoning',durable:true,started:2},
    {id:'done',model:'b',state:'ok',durable:true,started:1},{id:'stop',model:'c',state:'cancelled',durable:true,started:1}];
  assert.deepEqual(recoveryCandidates(calls).map(c=>c.id),['stop']);
  const call={model:'c',context:{promptId:'p'},settings:{max_tokens:128000,reasoning_effort:'max'}};
  const fallback=recoveryFallback(call,[{id:'p',prompt:'Original exact prompt'}]);
  assert.equal(fallback.messages[1].content,'Original exact prompt');
  assert.equal(fallback.max_tokens,128000);assert.deepEqual(fallback.reasoning,{effort:'max'});
  assert.equal(recoveryFallback({...call,request_saved:true},[]),undefined);
  assert.equal(recoveryFallback(call,[]),undefined);
});

test('retrying a complete prompt comparison includes every latest model, successful or failed, once',async()=>{
  const {comparisonRetryCandidates,recoveryCandidates}=await import('../../prompt-gallery/services/executionRecovery.js');
  const calls=[{id:'old',model:'a',state:'error',durable:true,started:1},
    {id:'success',model:'a',state:'ok',durable:true,started:2},
    {id:'failure',model:'b',state:'error',durable:true,started:2}];
  assert.deepEqual(comparisonRetryCandidates(calls).map(c=>c.id),['success','failure']);
  assert.deepEqual(recoveryCandidates(calls).map(c=>c.id),['failure']);
  assert.deepEqual(comparisonRetryCandidates([...calls,{id:'active',model:'c',state:'reasoning',durable:true,started:3}]),[]);
});
