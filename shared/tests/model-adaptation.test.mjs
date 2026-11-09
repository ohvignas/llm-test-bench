import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOpenRouterModel,resolveModelSettings,generationFeedback} from '../services/model-capabilities.js';
const api=(extra={})=>normalizeOpenRouterModel({id:'vendor/model',context_length:1000000,top_provider:{max_completion_tokens:128000},architecture:{output_modalities:['text']},supported_parameters:['max_tokens','reasoning','reasoning_effort'],reasoning:{mandatory:true,supported_efforts:['max','high','low']},...extra},1000);
test('API capabilities survive normalization, including mandatory reasoning and maximum output',()=>{
 const m=api();assert.equal(m.capabilities.maxOutputTokens,128000);assert.equal(m.capabilities.reasoning.mandatory,true);assert.deepEqual(m.capabilities.reasoning.supported_efforts,['max','high','low']);
});
test('maximum profile uses the highest advertised effort and output limit regardless of vendor name',()=>{
 const result=resolveModelSettings({model:api(),profile:'maximum'});
 assert.equal(result.params.max_tokens,128000);assert.deepEqual(result.params.reasoning,{effort:'max'});assert.equal(result.params.provider.require_parameters,true);
});
test('code profile and manual limits adapt to the same real model capabilities',()=>{
 assert.deepEqual(resolveModelSettings({model:api(),profile:'code'}).params.reasoning,{effort:'low'});
 assert.equal(resolveModelSettings({model:api({top_provider:{max_completion_tokens:8192}}),profile:'manual',budget:{totalTokens:24000}}).params.max_tokens,8192);
 assert.throws(()=>resolveModelSettings({model:api(),profile:'manual',budget:{totalTokens:10000,reasoningEffort:'none'}}),/obligatoire/i);
 assert.throws(()=>resolveModelSettings({model:api(),profile:'manual',budget:{totalTokens:10000,reasoningEffort:'medium'}}),/accepté/i);
});
test('unsupported sampling parameters and reasoning are removed from non-reasoning models',()=>{
 const result=resolveModelSettings({model:api({supported_parameters:['max_tokens','temperature'],reasoning:null}),params:{temperature:.7,top_p:.5,reasoning:{effort:'max'}},profile:'maximum'});
 assert.equal(result.params.temperature,.7);assert.equal(result.params.top_p,undefined);assert.equal(result.params.reasoning,undefined);assert.ok(result.adjustments.length>=2);
});
test('missing limits and non-text models cannot launch a claimed maximum profile',()=>{
 assert.throws(()=>resolveModelSettings({model:api({top_provider:{},context_length:null}),profile:'maximum'}),/limite/i);
 assert.throws(()=>resolveModelSettings({model:api({architecture:{output_modalities:['image']}}),profile:'maximum'}),/texte/i);
});
test('token-budget reasoning is only sent when expressly supported and leaves space for code',()=>{
 const m=api({reasoning:{supports_max_tokens:true},supported_parameters:['max_tokens','reasoning']});
 const result=resolveModelSettings({model:m,profile:'code'});
 assert.equal(result.params.reasoning.max_tokens,4096);assert.ok(result.params.reasoning.max_tokens<result.params.max_tokens);
});
test('an output limit change cannot increase a reviewed per-call ceiling',()=>{
 assert.equal(resolveModelSettings({model:api(),profile:'maximum',reviewedMaxTokens:64000}).params.max_tokens,64000);
});
test('real usage distinguishes a thinking-only failure from truncated visible output',()=>{
 assert.match(generationFeedback({finishReason:'length',completionTokens:32768,reasoningTokens:32768}).message,/raisonnement/i);
 assert.match(generationFeedback({finishReason:'length',completionTokens:32768,reasoningTokens:1000}).message,/incompl/i);
});
