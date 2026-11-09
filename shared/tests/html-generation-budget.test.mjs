import test from 'node:test';
import assert from 'node:assert/strict';
import {htmlGenerationParams} from '../../prompt-gallery/services/generationBudget.js';

test('adaptive Claude receives effort instead of an ignored thinking budget',()=>{
  const p=htmlGenerationParams({providerType:'openrouter',modelId:'anthropic/claude-opus-5.5'});
  assert.equal(p.max_tokens,32768);
  assert.deepEqual(p.reasoning,{effort:'low'});
});
test('the batch token controls are forwarded without changing other generation parameters',()=>{
  const p=htmlGenerationParams({providerType:'openrouter',modelId:'anthropic/claude-sonnet-4.5',params:{temperature:.3},budget:{totalTokens:24000,reasoningTokens:2048}});
  assert.deepEqual(p,{temperature:.3,max_tokens:24000,reasoning:{max_tokens:2048}});
});
test('reasoning cannot consume the entire requested total budget',()=>{
  assert.throws(()=>htmlGenerationParams({providerType:'openrouter',modelId:'anthropic/test',budget:{totalTokens:4096,reasoningTokens:4096}}),/raisonnement|budget/i);
});
test('non-Claude requests are bounded without adding an Anthropic reasoning block',()=>{
  assert.deepEqual(htmlGenerationParams({providerType:'openrouter',modelId:'openai/gpt-6-astra'}),{max_tokens:32768});
});
test('explicit reasoning choices survive and local providers keep their own settings',()=>{
  const params={reasoning:{enabled:false},max_tokens:16000};
  assert.deepEqual(htmlGenerationParams({providerType:'openrouter',modelId:'anthropic/test',params}),params);
  assert.deepEqual(htmlGenerationParams({providerType:'lmstudio',modelId:'local',params:{seed:42}}),{seed:42});
});

test('adaptive effort remains configurable without claiming a fixed reasoning cap',()=>{
  for(const modelId of ['anthropic/claude-fable-5.2','anthropic/claude-sonnet-4.7','~anthropic/claude-opus-latest']) {
    const p=htmlGenerationParams({providerType:'openrouter',modelId,budget:{reasoningTokens:4096,reasoningEffort:'medium'}});
    assert.deepEqual(p.reasoning,{effort:'medium'});
  }
  assert.throws(()=>htmlGenerationParams({providerType:'openrouter',modelId:'anthropic/claude-opus-5.5',params:{reasoning:{max_tokens:4096}}}),/adaptatif/i);
});
