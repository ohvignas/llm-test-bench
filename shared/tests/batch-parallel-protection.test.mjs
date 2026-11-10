import test from 'node:test';
import assert from 'node:assert/strict';
import {planBatchLanes, runLanes, combineSummaries} from '../../prompt-gallery/services/batchPlan.js';
import {runBatch} from '../../prompt-gallery/services/batchRunner.js';

const prompts = ['first', 'second'].map(id => ({id, title:id, prompt:`Create ${id}`, tags:[]}));
const models = ['A', 'B', 'C'].map(modelId => ({providerId:'mock', modelId, label:modelId}));
const html = '<!doctype html><html><body>Completed result</body></html>';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
function launch({mode='parallel', protection=true, deps, onFailure, shouldPause, waitIfPaused, events=[]}) {
  const {lanes} = planBatchLanes({prompts, models, runId:'parallel-test'});
  return runLanes({lanes, mode, stopOnFailure:protection, onFailure,
    runOne:(lane, gate) => runBatch({prompts:lane.prompts, model:lane.model,
      options:{progressive:false, stopOnFailure:protection, apiRetries:0}, deps,
      shouldStop:gate.shouldStop, shouldPause, waitIfPaused,
      onEvent:event => {
        events.push({...event, model:lane.model.modelId});
        if (event.type === 'item' && ['error', 'no_progress'].includes(event.status)) gate.onFailure();
      },
    }),
  });
}

test('a failed model stops its own queue while the other parallel models finish all prompts', {timeout:2000}, async () => {
  const gates = models.map(deferred), started = deferred(), failed = deferred();
  const calls = [], saved = [], events = [];
  const batch = launch({events, onFailure:failed.resolve, deps:{
    generate:async (prompt, {model, onStats}) => {
      calls.push([model.modelId, prompt]);
      if (calls.length === 3) started.resolve();
      try { return await gates[models.findIndex(m => m.modelId === model.modelId)].promise; }
      finally { onStats({cost:.1}); }
    },
    save:async value => { saved.push(value); return {id:value.model.modelId}; },
  }});
  await started.promise;
  assert.deepEqual(calls.map(([id]) => id), ['A', 'B', 'C']);
  gates[0].reject(new Error('Provider failed'));
  await failed.promise;
  gates[1].resolve(html); gates[2].resolve(html);
  const totals = combineSummaries(await batch);
  assert.equal(calls.length, 5, 'Only the failing model skips its second prompt');
  assert.equal(calls.filter(([id]) => id === 'A').length, 1);
  assert.equal(totals.failed, 1); assert.equal(totals.saved, 4);
  assert.deepEqual(saved.map(result => result.model.modelId).sort(), ['B', 'B', 'C', 'C']);
  assert.ok(saved.every(result => result.response === html && result.billing.confirmedUsd === .1));
  assert.ok(events.some(event => event.model === 'A' && event.type === 'cost' && event.call?.usd === .1), 'Failed call billing remains visible');
});

test('protected parallel batch continues every model when all prompts succeed', {timeout:2000}, async () => {
  const started = deferred(), gate = deferred(); const calls = [];
  const batch = launch({deps:{
    generate:async (prompt, {model}) => {
      calls.push([model.modelId, prompt]);
      if (calls.length === 3) started.resolve();
      await gate.promise; return html;
    },
    save:async () => ({id:'saved'}),
  }});
  await started.promise;
  assert.equal(calls.length, 3);
  gate.resolve();
  const total = combineSummaries(await batch);
  assert.equal(calls.length, 6); assert.equal(total.saved, 6); assert.equal(total.failed, 0);
});

test('protected sequential mode continues the next independent model after a failure', async () => {
  const calls = [];
  const results = await launch({mode:'sequential', deps:{
    generate:async (_, {model}) => { calls.push(model.modelId); throw new Error('Failed'); },
  }});
  assert.deepEqual(calls, ['A','B','C']); assert.equal(results.length, 3); assert.equal(combineSummaries(results).failed, 3);
});

test('turning protection off keeps other models and prompts running after a failure', async () => {
  const calls = [];
  const results = await launch({protection:false, deps:{
    generate:async (prompt, {model}) => {
      calls.push([model.modelId, prompt]);
      if (model.modelId === 'A' && prompt === prompts[0].prompt) throw new Error('Failed');
      return html;
    },
    save:async () => ({id:'saved'}),
  }});
  assert.equal(calls.length, 6); assert.equal(combineSummaries(results).saved, 5);
});

test('failure does not override a pause requested for the other models', {timeout:2000}, async () => {
  const slow = deferred(), parked = deferred(), release = deferred(), failed = deferred();
  let pause = false, notifications = 0; const calls = [];
  const batch = launch({shouldPause:() => pause,
    waitIfPaused:async () => { parked.resolve(); await release.promise; },
    onFailure:() => { notifications++; failed.resolve(); },
    deps:{
      generate:async (prompt, {model}) => {
        calls.push([model.modelId, prompt]);
        if (model.modelId === 'A') return slow.promise;
        if (prompt === prompts[0].prompt) pause = true; return html;
      },
      save:async () => ({id:'saved'}),
    },
  });
  await parked.promise;
  slow.reject(new Error('Failure while another model is paused'));
  await failed.promise;
  assert.equal(calls.length, 3, 'Unaffected models remain paused');
  pause = false; release.resolve();
  const results = await batch;
  assert.equal(notifications, 1); assert.equal(calls.length, 5);
  assert.equal(combineSummaries(results).saved, 4);
});


test('two concurrent provider failures both remain errors while the third model completes verification', {timeout:2000}, async () => {
  const started = deferred(), gates = models.map(deferred), calls = [], events = [];
  const {lanes} = planBatchLanes({prompts:[prompts[0]],models,runId:'verified-independent'});
  const running = runLanes({lanes,stopOnFailure:true,runOne:(lane,gate)=>runBatch({
    prompts:lane.prompts,model:lane.model,options:{mode:'verified',maxRepairRounds:0},shouldStop:gate.shouldStop,
    onEvent:event=>{events.push({...event,model:lane.model.modelId});if(event.type==='item'&&event.status==='error')gate.onFailure();},
    deps:{
      generate:async(_, {model})=>{calls.push('generate:'+model.modelId);if(calls.length===3)started.resolve();return gates[models.findIndex(m=>m.modelId===model.modelId)].promise;},
      runSandbox:async()=>({ok:true,errors:[],warnings:[],timedOut:false}),
      audit:async({checklist,model})=>{calls.push('audit:'+model.modelId);return {checks:checklist.checks.map(c=>({id:c.id,status:'pass',evidence:'Checked'}))};},
      save:async()=>({id:'saved-C'}),
    },
  })});
  await started.promise;
  gates[0].reject(Object.assign(new Error('Budget exhausted A'),{retryable:false}));
  gates[1].reject(Object.assign(new Error('Budget exhausted B'),{retryable:false}));
  gates[2].resolve(html);
  const totals = combineSummaries(await running);
  assert.equal(totals.failed,2);assert.equal(totals.verifiedPassed,1);assert.equal(totals.saved,1);
  assert.deepEqual(calls,['generate:A','generate:B','generate:C','audit:C']);
  assert.equal(events.filter(e=>e.type==='item'&&e.status==='error').length,2);
});
