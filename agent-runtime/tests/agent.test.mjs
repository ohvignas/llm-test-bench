import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../src/agent.mjs';
import {containerSpec,DockerWorkspace,validFile} from '../src/docker.mjs';

function fixtureResponse(delta,reason='stop'){
  const chunk={id:'fixture',model:'test/model',created:1,object:'chat.completion.chunk'};
  return new Response('data: '+JSON.stringify({...chunk,choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+
    JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:reason}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30,cost:.001}})+'\n\ndata: [DONE]\n\n',
    {headers:{'Content-Type':'text/event-stream'}});
}
const tool=(id,name,args)=>({tool_calls:[{index:0,id,type:'function',function:{name,arguments:JSON.stringify(args)}}]});

test('real Mastra agent writes code, receives tool results, builds and streams a preview',async()=>{
  let calls=0,started=false,destroyed=false;const files={},events=[],requests=[];
  const workspace={async start(){started=true;},async destroy(){destroyed=true;},
    async exec(){return {exitCode:0,output:'Build complete'};},
    async files(input){if(input.op==='write'){files[input.path]=input.content;return{written:input.path};}
      if(input.op==='artifact')return{html:files['index.html']};if(input.op==='snapshot')return{files:{...files}};return{content:files[input.path]};}};
  await runAgent({config:{id:'a'.repeat(32),model:'test/model',maxSteps:4,maxTokens:2000,files:{},providerToken:'fake-only',providerURL:'http://fake/v1',
    messages:[{role:'user',content:'Build a page'}]},workspace,emit:async e=>events.push(e),fetcher:async(_url,init)=>{
      requests.push(JSON.parse(init.body));calls++;
      if(calls===1)return fixtureResponse(tool('t1','write_file',{path:'index.html',content:'<!doctype html><html><body>Vrai outil exécuté</body></html>'}),'tool_calls');
      if(calls===2)return fixtureResponse(tool('t2','build_project',{}),'tool_calls');
      return fixtureResponse({content:'Projet construit.'});
    }});
  assert.equal(calls,3);assert.ok(started&&destroyed);assert.ok(requests[1].messages.some(m=>m.role==='tool'));
  assert.ok(events.some(e=>e.tool==='write_file'));assert.ok(events.some(e=>e.type==='preview'&&e.html.includes('Vrai outil')));
  assert.ok(events.some(e=>e.type==='done'));assert.ok(!JSON.stringify(events).includes('fake-only'));
});

test('agent containers have no host paths, network, keys, or Docker socket',()=>{
  const spec=containerSpec('b'.repeat(32));assert.equal(spec.HostConfig.NetworkMode,'none');
  assert.equal(spec.HostConfig.ReadonlyRootfs,true);assert.deepEqual(spec.HostConfig.CapDrop,['ALL']);
  assert.equal(spec.User,'1000:1000');assert.ok(!spec.HostConfig.Binds&&!spec.HostConfig.Mounts);
  assert.ok(!JSON.stringify(spec).includes('token'));assert.throws(()=>containerSpec('../../etc'));
});

test('tool file transport accepts large Unicode source without oversized OS arguments and rejects traversal',async()=>{
  assert.ok(validFile('src/main.ts'));for(const p of ['/etc/passwd','../foo','.env','src/../../key','node_modules/a','a\\b'])assert.equal(validFile(p),false);
  const workspace=new DockerWorkspace('d'.repeat(32)),parts=[];
  workspace.argv=async args=>{assert.ok(Buffer.byteLength(args[2])<64000);const part=JSON.parse(Buffer.from(args[2],'base64'));parts.push(Buffer.from(part.data,'base64'));return{exitCode:0,output:'{}'};};
  const source='é✅'.repeat(80000);await workspace.files({op:'write',path:'src/main.ts',content:source});
  assert.equal(Buffer.concat(parts).toString(),source);await assert.rejects(()=>workspace.files({op:'write',path:'../key',content:'secret'}));
});

test('provider output exhaustion retains checkpoints and does not retry automatically',async()=>{
  let calls=0,destroyed=false;const events=[];
  const workspace={async start(){},async files(r){return r.op==='snapshot'?{files:{'index.html':'saved'}}:{};},async destroy(){destroyed=true;}};
  await assert.rejects(()=>runAgent({config:{id:'c'.repeat(32),model:'test/model',maxSteps:4,maxTokens:2000,files:{},providerToken:'fake',providerURL:'http://fake/v1',messages:[{role:'user',content:'Build'}]},
    workspace,emit:async e=>events.push(e),fetcher:async()=>{calls++;return fixtureResponse({},'length');}}),/Budget de sortie/);
  assert.equal(calls,1);assert.ok(destroyed);assert.ok(events.some(e=>e.type==='files'));
});

test('provider rate errors never cause hidden SDK retries',async()=>{
  let calls=0,destroyed=false;const files={};
  const workspace={async start(){},async destroy(){destroyed=true;},async files(input){if(input.op==='write')files[input.path]=input.content;return {files:{...files}};}};
  await assert.rejects(()=>runAgent({config:{id:'e'.repeat(32),model:'test/model',maxSteps:8,maxTokens:2000,files:{},providerToken:'fake',providerURL:'http://fake/v1',messages:[{role:'user',content:'Build'}]},
    workspace,emit:async()=>{},fetcher:async()=>{calls++;return Response.json({error:{message:'Rate limit',code:429}},{status:429});}}));
  assert.equal(calls,1);assert.ok(destroyed);
});

test('a chat claim without source changes never turns an empty scaffold into a successful project',async()=>{
  const files={},events=[];
  const workspace={async start(){},async destroy(){},async files(input){if(input.op==='write')files[input.path]=input.content;return {files:{...files}};}};
  await assert.rejects(()=>runAgent({config:{id:'f'.repeat(32),model:'test/model',maxSteps:3,maxTokens:2000,files:{},providerToken:'fake',providerURL:'http://fake/v1',messages:[{role:'user',content:'Build'}]},
    workspace,emit:async e=>events.push(e),fetcher:async()=>fixtureResponse({content:'Done without using any tools.'})}),/aucun fichier/);
  assert.ok(!events.some(e=>e.type==='done'));
});
