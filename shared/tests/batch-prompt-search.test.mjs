import test from 'node:test';
import assert from 'node:assert/strict';
import {batchPromptChoices, setVisibleSelection} from '../../prompt-gallery/services/batchPromptSearch.js';
const prompts=[
 {id:'gta',set:'core',title:'GTA 6 — jeu urbain en monde ouvert',originalTitle:'GTA 6 Game',description:'Une ville et ses véhicules',aliases:['GTA VI','Grand Theft Auto']},
 {id:'advanced-gta',set:'advanced',title:'GTA 6 — version avancée',originalTitle:'GTA 6 Game (Advanced)'},
 {id:'airport',set:'flagship',title:'Opérations aéroportuaires',description:'Coordonner avions et pistes',tags:['aéroport']},
 {id:'shop',set:'web',title:'Boutique',description:'Panier et commandes'},
];
const selectedIds=new Set(prompts.map(p=>p.id));

test('search finds French accents, original names and aliases without case sensitivity',()=>{
 assert.deepEqual(batchPromptChoices({prompts,setId:'flagship',query:'AEROPORT',selectedIds}).visible.map(p=>p.id),['airport']);
 assert.deepEqual(batchPromptChoices({prompts,setId:'core',query:'gta 6 game',selectedIds}).visible.map(p=>p.id),['gta','advanced-gta']);
 assert.deepEqual(batchPromptChoices({prompts,setId:'core',query:'Grand Theft Auto',selectedIds}).visible.map(p=>p.id),['gta']);
});
test('a search from any series directly finds prompts across the complete library',()=>{
 const result=batchPromptChoices({prompts,setId:'flagship',query:'gta',selectedIds});
 assert.deepEqual(result.visible.map(p=>p.id),['gta','advanced-gta']);
 assert.equal(result.effectiveSet,'all');
 assert.deepEqual(result.matchingSets,{core:1,advanced:1});
 assert.equal(result.selected.length,4,'Changing category must keep the complete explicit selection');
});
test('all prompts are available by default, including personal and unfamiliar imported sets',()=>{
 const complete=[...prompts,{id:'personal',title:'Mon prompt'},{id:'imported',set:'my-import',title:'Mon import'}];
 for(const setId of [undefined,'all']) {
   const result=batchPromptChoices({prompts:complete,setId});
   assert.deepEqual(result.visible,complete);
   assert.equal(result.selected.length,0,'Listing everything must never select or launch everything');
 }
 const result=batchPromptChoices({prompts:complete,setId:'advanced',query:'mon'});
 assert.deepEqual(result.visible.map(p=>p.id),['gta','personal','imported']);
});
test('the launch contains explicit choices from Base and Advanced even after category or search changes',()=>{
 const chosen=new Set(['gta','advanced-gta']);
 for(const [setId,query] of [['core','gta'],['advanced',''],['web','missing']]) {
   const result=batchPromptChoices({prompts,setId,query,selectedIds:chosen});
   assert.deepEqual(result.selected.map(p=>p.id),['gta','advanced-gta']);
   assert.deepEqual(result.selectedBySet,{core:1,advanced:1});
 }
});
test('bulk selection changes displayed results only and never selects an unvisited category',()=>{
 const base=batchPromptChoices({prompts,setId:'core'});
 let chosen=setVisibleSelection(new Set(),base.visible,true);
 assert.deepEqual([...chosen],['gta']);
 const advanced=batchPromptChoices({prompts,setId:'advanced'});
 chosen=setVisibleSelection(chosen,advanced.visible,true);
 assert.deepEqual(batchPromptChoices({prompts,setId:'web',selectedIds:chosen}).selected.map(p=>p.id),['gta','advanced-gta']);
 chosen=setVisibleSelection(chosen,base.visible,false);
 assert.deepEqual([...chosen],['advanced-gta']);
 assert.equal(base.selected.length,0,'No prompt may be implicitly selected');
});
test('clearing search restores the current series and respects unchecked choices',()=>{
 const result=batchPromptChoices({prompts,setId:'core',query:'  ',selectedIds:new Set()});
 assert.equal(result.visible.length,1);
 assert.equal(result.selected.length,0);
});
