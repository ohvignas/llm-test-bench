import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const dataUrl=new URL('../../prompt-gallery/data/',import.meta.url);
globalThis.fetch=async path=>{
  try{return Response.json(JSON.parse(await readFile(new URL(String(path).replace('./data/',''),dataUrl),'utf8')));}
  catch{return new Response('',{status:404});}
};
const lib=await import('../../prompt-gallery/services/library.js');

test('all shipped prompts have French display information and 24 website tasks load separately',async()=>{
  const seeds=await lib.loadSeeds();
  assert.equal(seeds.length,163);
  const web=seeds.filter(p=>lib.promptSetOf(p)==='web');
  assert.equal(web.length,24);
  assert.equal(new Set(seeds.map(p=>p.id)).size,seeds.length);
  for(const p of seeds){assert.ok(p.title?.trim(),p.id);assert.ok(p.description?.trim(),p.id);}
  const gta=seeds.filter(p=>/gta/i.test(p.title));
  assert.equal(gta.length,1,'Only one GTA brief is offered across all categories and sets');
  assert.equal(gta[0].category,'games-graphics');
  assert.equal(gta[0].id,'games-gta-vi');
  assert.equal(lib.promptSetOf(gta[0]),'core');
  assert.match(gta[0].prompt,/Sans Three\.js/);
  assert.match(gta[0].prompt,/JavaScript déjà compilé et exécutable/);
  assert.equal(seeds.find(p=>p.id==='flag-airport-operations').title,'Simulateur des opérations aéroportuaires');
  for(const p of web){assert.match(p.prompt,/document HTML/i);assert.match(p.notes,/Vérifier/);}
});
test('translation preserves the original model instructions and existing generation folders',async()=>{
  const seeds=await lib.loadSeeds();
  for(const file of ['library.json','library-advanced.json','library-flagship.json']){
    const original=JSON.parse(await readFile(new URL(file,dataUrl),'utf8'));
    for(const p of original.prompts){
      const displayed=seeds.find(s=>s.id===p.id);
      assert.equal(displayed.prompt,p.prompt,p.id);
      assert.equal(displayed.notes,p.notes,p.id);
      assert.equal(lib.promptFolderId(displayed),lib.slugify(p.title),p.id);
    }
  }
  const airport=seeds.find(p=>p.id==='flag-airport-operations');
  const stats=lib.statsForPrompt([{folderId:'airport-operations-simulator',metadata:{model:'test',createdAt:'2026-11-09'}}],airport);
  assert.equal(stats.runs,1);
  assert.equal(lib.promptFolderId({title:'Mon site personnel'}),'mon-site-personnel');
});
test('personal titles and descriptions override the translated seed without changing its folder',async()=>{
  const overrides={seedOverrides:{'flag-airport-operations':{title:'Mon aéroport',description:'Ma description personnalisée'}},prompts:[]};
  const root={async getDirectoryHandle(){return{async getFileHandle(){return{async getFile(){return{text:async()=>JSON.stringify(overrides)}}}}}}};
  const airport=(await lib.getLibrary(root)).find(p=>p.id==='flag-airport-operations');
  assert.equal(airport.title,'Mon aéroport');
  assert.equal(airport.description,'Ma description personnalisée');
  assert.equal(lib.promptFolderId(airport),'airport-operations-simulator');
});
