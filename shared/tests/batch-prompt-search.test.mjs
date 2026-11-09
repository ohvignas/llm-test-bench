import test from 'node:test';
import assert from 'node:assert/strict';
import {batchPromptChoices} from '../../prompt-gallery/services/batchPromptSearch.js';
const prompts=[
 {id:'gta',set:'core',title:'GTA 6 — jeu urbain en monde ouvert',originalTitle:'GTA 6 Game',description:'Une ville et ses véhicules',aliases:['GTA VI','Grand Theft Auto']},
 {id:'advanced-gta',set:'advanced',title:'GTA 6 — version avancée',originalTitle:'GTA 6 Game (Advanced)'},
 {id:'airport',set:'flagship',title:'Opérations aéroportuaires',description:'Coordonner avions et pistes',tags:['aéroport']},
 {id:'shop',set:'web',title:'Boutique',description:'Panier et commandes'},
];
const selectedIds=new Set(prompts.map(p=>p.id));

test('search finds French accents, original names and aliases without case sensitivity',()=>{
 assert.deepEqual(batchPromptChoices({prompts,setId:'flagship',query:'AEROPORT',selectedIds}).visible.map(p=>p.id),['airport']);
 assert.deepEqual(batchPromptChoices({prompts,setId:'core',query:'gta 6 game',selectedIds}).visible.map(p=>p.id),['gta']);
 assert.deepEqual(batchPromptChoices({prompts,setId:'core',query:'Grand Theft Auto',selectedIds}).visible.map(p=>p.id),['gta']);
});
test('a search in the wrong series points to the other series instead of losing the prompt',()=>{
 const result=batchPromptChoices({prompts,setId:'flagship',query:'gta',selectedIds});
 assert.equal(result.visible.length,0);
 assert.deepEqual(result.matchingSets,{core:1,advanced:1});
 assert.equal(result.selected.length,0);
});
test('launching a filtered selection cannot include checked but hidden paid prompts',()=>{
 const result=batchPromptChoices({prompts,setId:'core',query:'gta',selectedIds});
 assert.deepEqual(result.selected.map(p=>p.id),['gta']);
 assert.deepEqual([...selectedIds],prompts.map(p=>p.id),'Search must preserve existing checkboxes');
 assert.equal(batchPromptChoices({prompts,setId:'core',query:'missing',selectedIds}).selected.length,0);
});
test('clearing search restores the current series and respects unchecked choices',()=>{
 const result=batchPromptChoices({prompts,setId:'core',query:'  ',selectedIds:new Set()});
 assert.equal(result.visible.length,1);
 assert.equal(result.selected.length,0);
});
