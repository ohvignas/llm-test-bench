import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LANE_MODE, restoreLaneMode, planBatchLanes, runLanes, combineSummaries} from '../../prompt-gallery/services/batchPlan.js';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';
import {costTotals} from '../../prompt-gallery/services/batchCosts.js';

const prompts = ['game', 'portfolio', 'simulation'].map(id => ({id, title:id, prompt:`Full ${id} instructions`, tags:[]}));
const models = ['A', 'B'].map(modelId => ({providerId:'mock', modelId, generationOptions:{profile:'maximum', reviewedMaxTokens:128000}}));
const html = id => `<!doctype html><html><body>${id}</body></html>`;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve=yes; reject=no;});
  return {promise, resolve, reject};
}

test('new and invalid preferences select all projects in parallel; explicit alternatives remain available', () => {
  assert.equal(DEFAULT_LANE_MODE, 'all-parallel');
  for (const value of [null, undefined, '', 'invalid']) assert.equal(restoreLaneMode(value), 'all-parallel');
  for (const value of ['all-parallel', 'parallel', 'sequential']) assert.equal(restoreLaneMode(value), value);
});

test('six calls start together at maximum settings; failure, output, costs and saved runs remain independent', {timeout:3000}, async () => {
  const plan = planBatchLanes({prompts, models, runId:'six-at-once'});
  const gates = Array.from({length:6}, deferred), started = deferred();
  const calls = [], saved = [], events = [], failures = [];
  const running = runLanes({lanes:plan.lanes, mode:DEFAULT_LANE_MODE, stopOnFailure:true,
    onFailure:task => failures.push(task.offset),
    runOne:(task, gate) => runBatch({prompts:task.prompts, model:task.model,
      options:{mode:'comparison', progressive:true, apiRetries:3, stopOnFailure:true},
      shouldStop:gate.shouldStop,
      onEvent:event => {
        events.push({...event, index:task.offset + (event.index || 0)});
        if (event.type === 'item' && event.status === 'error') gate.onFailure();
      },
      deps:{generate:async (text, {model, onChunk, onStats}) => {
        const index = task.offset;
        calls.push(index);
        assert.equal(text, prompts[index % 3].prompt);
        assert.equal(model.generationOptions.profile, 'maximum');
        assert.equal(model.generationOptions.reviewedMaxTokens, 128000);
        onStats({telemetryId:`live-${index}`});
        if (calls.length === 6) started.resolve();
        try {
          const result = await gates[index].promise;
          onChunk(result);
          return result;
        } finally { onStats({cost:(index + 1) / 100}); }
      }, save:async value => {saved.push(value); return {id:`saved-${task.offset}`};}},
    }),
  });
  await started.promise;
  assert.deepEqual(calls, [0,1,2,3,4,5], 'All six have started before any resolves');
  assert.equal(saved.length, 0);
  gates[0].reject(Object.assign(new Error('Provider failure'), {retryable:false}));
  // Complete in a different order from the flat model-major display list.
  for (const index of [5,2,4,1,3]) gates[index].resolve(html(index));
  const summaries = await running, total = combineSummaries(summaries);
  assert.equal(calls.length, 6, 'No automatic retry in comparison');
  assert.deepEqual(failures, [0]);
  assert.equal(summaries.length, 2); assert.equal(total.lanes, 2);
  assert.equal(total.failed, 1); assert.equal(total.saved, 5);
  assert.equal(saved.filter(value => value.model.modelId === 'A').length, 2, 'Other projects of failed model finish');
  for (const value of saved) {
    const index = events.find(e => e.type === 'chunk' && e.html === value.response).index;
    assert.equal(value.model.batchRunId, `six-at-once-m${Math.floor(index / 3) + 1}`);
    assert.equal(value.model.batchGroupId, 'six-at-once');
    assert.equal(value.billing.calls.length, 1);
    assert.equal(value.billing.calls[0].telemetryId, `live-${index}`);
    assert.equal(value.billing.confirmedUsd, (index + 1) / 100);
  }
  const costs = costTotals(events.filter(e => e.type === 'cost').map(e => e.call));
  assert.equal(costs.requestCount, 6); assert.equal(costs.missingCosts, 0);
  assert.ok(Math.abs(costs.confirmedUsd - .21) < 1e-9, 'Includes failed charge once');
});

test('every project can pause before its first call, then resume together', {timeout:3000}, async () => {
  const {lanes} = planBatchLanes({prompts, models, runId:'paused'});
  let paused = true, parked = 0, generated = 0;
  const ready = deferred(), release = deferred();
  const running = runLanes({lanes, mode:DEFAULT_LANE_MODE, runOne:(task, gate) => runBatch({
    prompts:task.prompts, model:task.model, options:{mode:'comparison'}, shouldStop:gate.shouldStop,
    shouldPause:() => paused, waitIfPaused:async () => {if (++parked === 6) ready.resolve(); await release.promise;},
    deps:{generate:async () => {generated++; return html('ok');}, save:async () => ({id:'saved'})},
  })});
  await ready.promise;
  assert.equal(generated, 0);
  paused = false; release.resolve();
  assert.equal(combineSummaries(await running).saved, 6);
  assert.equal(generated, 6);
});

test('a user stop while every task is paused prevents all API calls', {timeout:3000}, async () => {
  const {lanes} = planBatchLanes({prompts, models, runId:'stop-paused'});
  let stopped = false, parked = 0;
  const ready = deferred(), release = deferred();
  const running = runLanes({lanes, mode:DEFAULT_LANE_MODE, shouldStop:() => stopped,
    runOne:(task, gate) => runBatch({prompts:task.prompts, model:task.model,
      options:{mode:'comparison'}, shouldStop:gate.shouldStop, shouldPause:() => true,
      waitIfPaused:async () => {if (++parked === 6) ready.resolve(); await release.promise;},
      deps:{generate:async () => {assert.fail('Stopped task must not call provider');}},
    }),
  });
  await ready.promise;
  stopped = true; release.resolve();
  const result = combineSummaries(await running);
  assert.equal(result.saved, 0); assert.equal(result.stopped, true);
});
