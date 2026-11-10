import http from 'node:http';

export function containerSpec(id,image='llm-bench-agent-sandbox:latest',namespace='default'){
  if(!/^[a-f0-9]{32}$/.test(id))throw Error('Identifiant invalide');
  if(!/^[a-z0-9-]{1,32}$/.test(namespace))throw Error('Espace de contrôle invalide');
  return {Image:image,User:'1000:1000',Cmd:['sleep','infinity'],WorkingDir:'/workspace',
    Labels:{'llm-bench.agent':id,'llm-bench.controller':namespace},Env:['PATH=/usr/local/bin:/usr/bin:/bin','HOME=/tmp','PLAYWRIGHT_BROWSERS_PATH=/opt/browsers'],
    HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],
      PidsLimit:256,Memory:1024*1024*1024,NanoCpus:1_000_000_000,
      Tmpfs:{'/workspace':'rw,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=0700','/tmp':'rw,nosuid,nodev,size=128m,mode=1777'},
      AutoRemove:false}};
}
export function validFile(name){
  return typeof name==='string'&&name.length<200&&!name.startsWith('/')&&!name.includes('\\')&&
    !name.split('/').some(p=>!p||p==='..'||p.startsWith('.')||p==='node_modules');
}
function demux(data){
  const parts=[];let offset=0;
  while(offset+8<=data.length){const length=data.readUInt32BE(offset+4);if(offset+8+length>data.length)break;parts.push(data.subarray(offset+8,offset+8+length));offset+=8+length;}
  return Buffer.concat(parts).toString('utf8');
}
export class DockerWorkspace{
  constructor(id,{socket='/var/run/docker.sock',image,signal,namespace='default'}={}){this.id=id;this.socket=socket;this.image=image;this.signal=signal;this.namespace=namespace;}
  async request(method,path,body,{raw=false,timeout=60000}={}){
    return new Promise((resolve,reject)=>{
      const data=body===undefined?null:Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
      const req=http.request({socketPath:this.socket,path:'/v1.45'+path,method,signal:this.signal,headers:data?{'Content-Type':Buffer.isBuffer(body)?'application/x-tar':'application/json','Content-Length':data.length}:{}},res=>{
        const chunks=[];let size=0;
        res.on('data',chunk=>{size+=chunk.length;if(size>16*1024*1024){req.destroy(Error('Sortie de commande trop volumineuse'));return;}chunks.push(chunk);});
        res.on('end',()=>{const value=Buffer.concat(chunks);if(res.statusCode>=300)return reject(Error('Docker '+res.statusCode+': '+value.toString().slice(0,400)));try{resolve(raw?value:value.length?JSON.parse(value):{});}catch(e){reject(e);}});
      });req.setTimeout(timeout,()=>req.destroy(Error('Délai de commande dépassé')));req.on('error',reject);req.end(data);
    });
  }
  async start(){
    const result=await this.request('POST','/containers/create?name=llm-bench-agent-'+this.namespace+'-'+this.id,containerSpec(this.id,this.image,this.namespace));this.container=result.Id;
    await this.request('POST',`/containers/${this.container}/start`);
    await this.exec('ln -s /opt/deps/node_modules /workspace/node_modules');
  }
  async argv(command,timeout=50,limit=24000){
    const {Id}=await this.request('POST',`/containers/${this.container}/exec`,{Cmd:['timeout',String(timeout),...command],AttachStdout:true,AttachStderr:true,User:'1000:1000',WorkingDir:'/workspace'});
    const output=await this.request('POST',`/exec/${Id}/start`,{Detach:false,Tty:false},{raw:true,timeout:(timeout+5)*1000});
    const info=await this.request('GET',`/exec/${Id}/json`);
    return {exitCode:info.ExitCode,output:demux(output).slice(-limit)};
  }
  exec(command){return this.argv(['/bin/sh','-lc',command]);}
  async files(request){
    if(request.path&&!validFile(request.path))throw Error('Chemin hors du projet interdit');
    if(request.op==='write'){
      const bytes=Buffer.from(request.content);if(bytes.length>1024*1024)throw Error('Fichier supérieur à 1 Mio');
      for(let i=0;i<Math.max(1,bytes.length);i+=32000){
        const part={op:'write',path:request.path,data:bytes.subarray(i,i+32000).toString('base64'),append:i>0};
        const result=await this.argv(['node','/opt/bench/files.mjs',Buffer.from(JSON.stringify(part)).toString('base64')]);
        if(result.exitCode!==0)throw Error(result.output.slice(0,500));
      }
      return {written:request.path};
    }
    const result=await this.argv(['node','/opt/bench/files.mjs',Buffer.from(JSON.stringify(request)).toString('base64')],50,12*1024*1024);
    if(result.exitCode!==0)throw Error(result.output.slice(0,500));
    return JSON.parse(result.output);
  }
  async destroy(){
    // Cancellation of the model must not prevent removal of its container.
    const signal=this.signal;this.signal=undefined;
    try{if(this.container)await this.request('DELETE',`/containers/${this.container}?force=true&v=true`);}finally{this.signal=signal;}
  }
}
