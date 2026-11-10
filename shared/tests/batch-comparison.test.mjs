import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_BATCH_MODE, batchGenerationOptions} from '../../prompt-gallery/services/batchMode.js';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';
import {planBatchLanes, runLanes} from '../../prompt-gallery/services/batchPlan.js';
import {normalizeOpenRouterModel, resolveModelSettings} from '../services/model-capabilities.js';

const prompts = ['website', 'game'].map(id => ({id, title:id, prompt:`Full original ${id} specification`, tags:[]}));
const html = '<!doctype html><html><body>Original model output</body></html>';

test('default comparison runs the full prompts on three models at their own maximum despite learned and saved low settings', async () => {
  const models = ['max', 'xhigh', 'high'].map((effort, i) => {
    const api = normalizeOpenRouterModel({id:`fixture/${i}`, context_length:200000,
      top_provider:{max_completion_tokens:64000 + i * 16000},
      supported_parameters:['max_tokens', 'reasoning'],
      reasoning:{mandatory:true, supported_efforts:['low', effort]},
      bench_policy:{recovery_level:2, effort:'low', max_tokens:2048},
    });
    const generationOptions = batchGenerationOptions({mode:DEFAULT_BATCH_MODE,
      profile:'code', override:{profile:'manual', totalTokens:2048, reasoningEffort:'low'},
      budget:{totalTokens:2048, reasoningTokens:1024}});
    return {providerId:'openrouter', modelId:api.id, api, expectedEffort:effort, generationOptions};
  });
  const calls=[], saved=[];
  const {lanes} = planBatchLanes({prompts, models, runId:'comparison'});
  await runLanes({lanes, mode:'parallel', runOne:lane => runBatch({
    prompts:lane.prompts, model:lane.model,
    options:{mode:DEFAULT_BATCH_MODE, progressive:true, heal:true, apiRetries:3, stopOnFailure:false},
    deps:{generate:async (prompt, {model}) => {
      const settings = resolveModelSettings({model:model.api, ...model.generationOptions});
      calls.push({prompt, model, settings});
      return html;
    }, save:async value => {saved.push(value); return {id:`saved-${saved.length}`};},
    heal:async () => {throw new Error('Unexpected repair');},
    runSandbox:async () => {throw new Error('Unexpected automatic verification');}},
  })});
  assert.equal(calls.length,6);
  assert.deepEqual(calls.slice(0,3).map(c=>c.model.modelId), models.map(m=>m.modelId));
  for (const call of calls) {
    assert.ok(prompts.some(p=>p.prompt===call.prompt));
    assert.equal(call.settings.profile,'maximum');
    assert.equal(call.settings.params.reasoning.effort,call.model.expectedEffort);
    assert.equal(call.settings.params.max_tokens,call.model.api.capabilities.maxOutputTokens);
  }
  assert.ok(saved.every(value=>value.response===html && !value.healed));
  assert.equal(saved.length,6);
});

test('comparison never retries or downgrades a failed generation even when old retry options remain', async () => {
  let calls=0;
  const result=await runBatch({prompts:[prompts[0]],
    model:{generationOptions:{profile:'automatic',recoveryLevel:2,automatic:{id:'old',limit:3}}},
    options:{mode:'comparison',apiRetries:3,stopOnFailure:false},
    deps:{generate:async (_prompt,{model})=>{
      calls++;
      assert.equal(model.generationOptions.profile,'maximum');
      assert.equal(model.generationOptions.automatic,undefined);
      assert.equal(model.generationOptions.recoveryLevel,undefined);
      throw Object.assign(new Error('Provider unavailable'),{retryable:true});
    }},
  });
  assert.equal(calls,1); assert.equal(result.failed,1);
});
