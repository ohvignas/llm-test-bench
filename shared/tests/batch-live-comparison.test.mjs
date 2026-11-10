import test from 'node:test';
import assert from 'node:assert/strict';
import {liveComparisonCards, liveComparisonPrompts} from '../../prompt-gallery/services/batchLiveComparison.js';
import {planBatchLanes} from '../../prompt-gallery/services/batchPlan.js';

const models = ['A', 'B', 'C'].map(modelId => ({providerId:'mock', modelId}));
const prompts = ['one', 'two'].map(id => ({id, title:id}));
const {runList} = planBatchLanes({models, prompts, runId:'live'});

test('each model follows its own running prompt and keeps its output and costs separate', () => {
  const items = ['saved','generating','generating','queued','saved','error'].map(status => ({status}));
  const outputs = ['A1','A2','B1','','C1',''];
  const calls = runList.map((_, index) => ({id:`call-${index}`, index, usd:index/100}));
  const cards = liveComparisonCards({models, runList, items, outputs, calls});
  assert.deepEqual(cards.map(card => card.index), [1,2,5]);
  assert.deepEqual(cards.map(card => card.output), ['A2','B1','']);
  assert.deepEqual(cards.map(card => card.calls.map(call => call.id)), [['call-1'],['call-2'],['call-5']]);
  assert.equal(cards[2].item.status, 'error');
});

test('pinning a prompt aligns the three models including queued and completed results', () => {
  const items = ['saved','generating','generating','queued','saved','saved'].map(status => ({status}));
  const cards = liveComparisonCards({models, runList, items, promptId:'two'});
  assert.deepEqual(cards.map(card => card.index), [1,3,5]);
  assert.deepEqual(cards.map(card => card.item.status), ['generating','queued','saved']);
  assert.deepEqual(liveComparisonPrompts(runList), prompts);
});

test('a lane not started after protection trips still has its own empty pane', () => {
  const cards = liveComparisonCards({models, runList, items:runList.map(() => ({status:'not-started'}))});
  assert.deepEqual(cards.map(card => card.index), [0,2,4]);
  assert.ok(cards.every(card => card.output === '' && card.calls.length === 0));
});

test('finished models keep their last result while the others continue', () => {
  const items = ['saved','saved','saved','generating','generating','queued'].map(status => ({status}));
  const cards = liveComparisonCards({models, runList, items, outputs:['a1','a2','b1','b2','c1','']});
  assert.deepEqual(cards.map(card => card.output), ['a2','b2','c1']);
});
