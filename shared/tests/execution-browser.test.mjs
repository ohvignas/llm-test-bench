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
