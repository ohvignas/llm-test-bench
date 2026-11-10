import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual,createHash} from 'node:crypto';
import {DockerWorkspace} from './docker.mjs';
import {runAgent} from './agent.mjs';

const active=new Map();
let ready=false;
let namespace;
const controlNamespace=token=>createHash('sha256').update(token).digest('hex').slice(0,16);
async function authorized(req){
  try{const expected=(await readFile('/agent-control/token','utf8')).trim(),got=req.headers.authorization?.replace(/^Bearer /,'')||'';
    namespace=controlNamespace(expected);
    return expected.length>32&&got.length===expected.length&&timingSafeEqual(Buffer.from(got),Buffer.from(expected));}catch{return false;}
}
export const server=http.createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/healthz'){res.writeHead(ready?200:503);res.end(JSON.stringify({ok:ready}));return;}
  if(!await authorized(req)){res.writeHead(401);res.end();return;}
  const stop=req.url?.match(/^\/runs\/([a-f0-9]{32})\/stop$/);
  if(stop&&req.method==='POST'){active.get(stop[1])?.abort();res.end('{}');return;}
  if(req.method!=='POST'||req.url!=='/run'){res.writeHead(404);res.end();return;}
  let data='';
  try{
    for await(const chunk of req){data+=chunk;if(data.length>12*1024*1024)throw Error('Projet trop volumineux');}
    const config=JSON.parse(data);
    if(!/^[a-f0-9]{32}$/.test(config.id)||!Number.isInteger(config.maxSteps)||config.maxSteps<1||config.maxSteps>16||active.has(config.id))throw Error('Session invalide ou déjà active');
    if(active.size>=32){res.writeHead(429);res.end('{"error":"32 agents sont déjà actifs"}');return;}
    // The provider destination is controlled by this service, never by a prompt.
    config.providerURL='http://bench:8080/api/agent-provider/'+config.id+'/v1';
    const controller=new AbortController();active.set(config.id,controller);
    res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
    const emit=async value=>{if(!res.destroyed)res.write(JSON.stringify(value)+'\n');};
    const timer=setTimeout(()=>controller.abort(),45*60*1000);
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try{await runAgent({config,workspace:new DockerWorkspace(config.id,{signal:controller.signal,namespace}),emit,signal:controller.signal});}
    catch(error){await emit({type:'error',message:controller.signal.aborted?'Agent arrêté ; sources conservées.':error.message.slice(0,1500)});}
    finally{clearTimeout(timer);active.delete(config.id);res.end();}
  }catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.message.slice(0,500)}));}
});
// Reap only our labelled orphan containers after a controller restart. No
// generated command, host path or arbitrary Docker object enters this cleanup.
try{
  const docker=new DockerWorkspace('0'.repeat(32));
  await docker.request('GET','/version');
  const token=await readFile('/agent-control/token','utf8').catch(()=>'');
  if(token)namespace=controlNamespace(token.trim());
  const rows=namespace?await docker.request('GET','/containers/json?all=1&filters='+encodeURIComponent(JSON.stringify({label:['llm-bench.controller='+namespace]}))):[];
  for(const row of rows)if(/^[a-f0-9]{32}$/.test(row.Labels?.['llm-bench.agent']||''))await docker.request('DELETE','/containers/'+row.Id+'?force=true&v=true');
  ready=true;
}catch(error){console.error('Docker indisponible : '+error.message.slice(0,200));}
server.listen(8090,'0.0.0.0');
