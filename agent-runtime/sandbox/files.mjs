// Runs only inside an untrusted per-session container, never in the controller.
import fs from 'node:fs/promises';
import path from 'node:path';
let raw=process.argv[2]?Buffer.from(process.argv[2],'base64').toString():'';
if(!raw)for await(const chunk of process.stdin)raw+=chunk;
const request=JSON.parse(raw),root='/workspace';
function file(name){
  if(typeof name!=='string'||!name||name.startsWith('/')||name.split(/[\\/]/).some(p=>p==='..'||p.startsWith('.'))||name.includes('node_modules'))throw Error('Chemin interdit');
  return path.join(root,name);
}
const files=[];
async function list(dir='',depth=0){
  if(depth>8)return;
  for(const item of await fs.readdir(path.join(root,dir),{withFileTypes:true})){
    if(item.name.startsWith('.')||['node_modules','dist'].includes(item.name)||item.isSymbolicLink())continue;
    const name=path.posix.join(dir,item.name);
    if(item.isDirectory())await list(name,depth+1);
    else if(item.isFile()&&files.length<100){const stat=await fs.stat(file(name));if(stat.size<=1024*1024)files.push([name,await fs.readFile(file(name),'utf8')]);}
  }
}
try{
  let result;
  if(request.op==='write'){const dest=file(request.path);await fs.mkdir(path.dirname(dest),{recursive:true});const value=request.data?Buffer.from(request.data,'base64'):request.content||'';if(request.append)await fs.appendFile(dest,value);else await fs.writeFile(dest,value);result={written:request.path};}
  else if(request.op==='read')result={content:(await fs.readFile(file(request.path),'utf8')).slice(0,100000)};
  else if(request.op==='snapshot'){await list();result={files:Object.fromEntries(files)};}
  else if(request.op==='artifact')result={html:(await fs.readFile('/workspace/dist/index.html','utf8')).slice(0,8*1024*1024)};
  else if(request.op==='test'){
    const {chromium}=await import('/opt/deps/node_modules/playwright/index.mjs');
    const browser=await chromium.launch({headless:true,executablePath:undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],env:{PATH:process.env.PATH,PLAYWRIGHT_BROWSERS_PATH:'/opt/browsers'}});
    try{
      const page=await browser.newPage(),errors=[],warnings=[];
      page.on('pageerror',error=>{if(errors.length<20)errors.push(error.message.slice(0,1000));});
      page.on('console',message=>{if(message.type()==='error'&&errors.length<20)errors.push(message.text().slice(0,1000));});
      page.on('requestfailed',request=>{if(warnings.length<10)warnings.push('Ressource inaccessible dans le test hors ligne : '+request.url().slice(0,160));});
      await page.goto('file:///workspace/dist/index.html',{waitUntil:'load',timeout:15000});await page.waitForTimeout(750);
      result={errors,warnings,...await page.evaluate(()=>({title:document.title,text:document.body.innerText.slice(0,500),canvases:document.querySelectorAll('canvas').length}))};
    }finally{await browser.close();}
  }
  else throw Error('Opération inconnue');
  process.stdout.write(JSON.stringify(result));
}catch(error){process.stdout.write(JSON.stringify({error:error.message}));process.exitCode=1;}
