import test from 'node:test';
import assert from 'node:assert/strict';
import {htmlGenerationParams} from '../../prompt-gallery/services/generationBudget.js';
import {normalizeOpenRouterModel} from '../services/model-capabilities.js';
test('HTML generation uses API limits rather than guessed limits from a Claude version',()=>{
 const model=normalizeOpenRouterModel({id:'anthropic/claude-future',top_provider:{max_completion_tokens:8192},supported_parameters:['max_tokens','reasoning'],reasoning:{mandatory:true,supported_efforts:['high','low']}});
 const p=htmlGenerationParams({providerType:'openrouter',model,profile:'maximum'});
 assert.equal(p.max_tokens,8192);assert.deepEqual(p.reasoning,{effort:'high'});
});
test('unknown API capabilities fail before a completion can be prepared',()=>{
 assert.throws(()=>htmlGenerationParams({providerType:'openrouter',modelId:'anthropic/claude-opus-5.5'}),/capacités/i);
});
test('local provider settings are left with their own provider contract',()=>{
 assert.deepEqual(htmlGenerationParams({providerType:'lmstudio',params:{seed:42}}),{seed:42});
});
