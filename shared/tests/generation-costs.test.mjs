import test from 'node:test';
import assert from 'node:assert/strict';
import {createCostCall, updateCostCall, finishCostCall, costTotals, withPromptCosts} from '../../prompt-gallery/services/batchCosts.js';

test('single and refine calls keep stable identities and replace cumulative charges without mutating state', () => {
  const initial = createCostCall('improve', {modelId:'fixture', startedAt:42});
  const partial = updateCostCall(initial, {cost:0.12});
  const complete = finishCostCall(updateCostCall(partial, {cost:0.14}));
  assert.equal(initial.usd, null);
  assert.equal(partial.usd, 0.12);
  assert.equal(complete.usd, 0.14);
  assert.equal(complete.id, initial.id);
  assert.equal(complete.startedAt, 42);
  assert.equal(complete.modelId, 'fixture');
  assert.equal(complete.status, 'done');
  assert.ok(complete.finishedAt >= 42);
  assert.equal(costTotals([initial,partial,complete]).confirmedUsd, 0.14);
  assert.equal(costTotals([initial,partial,complete]).calls.length, 1);
  assert.notEqual(createCostCall('improve').id, initial.id);
});

test('only a finite non-negative numeric API charge counts as confirmed, including a real zero', () => {
  let call = createCostCall('generate');
  for (const cost of [undefined,null,'0.10',NaN,Infinity,-1]) call = updateCostCall(call, {cost});
  call = updateCostCall(call, {completionTokens:500, pricing:{completion:0.001}});
  assert.deepEqual(costTotals([call]), {currency:'USD',confirmedUsd:null,missingCosts:1,requestCount:1,blockedCalls:0,calls:[call]});
  const free = updateCostCall(call, {cost:0});
  assert.equal(free.usd, 0);
  assert.equal(costTotals([free]).missingCosts, 0);
  assert.equal(updateCostCall(free, {}).usd, 0);
});

test('failed and cancelled calls preserve final provider charges and optional settings safely', () => {
  const started = createCostCall('suggest');
  const settingsOnly = updateCostCall(started, {settings:{profile:'code'}});
  assert.equal(settingsOnly.settings.profile, 'code');
  const error = Object.assign(new Error('No complete document'), {stats:{cost:0.674272, feedback:{kind:'empty'}}});
  const failed = finishCostCall(settingsOnly, error);
  assert.equal(failed.usd, 0.674272);
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.feedback, {kind:'empty'});
  const stopped = finishCostCall(started, new DOMException('Stopped', 'AbortError'));
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.usd, null);
});

test('batch failures also retain a charge attached to the error when no final stats callback arrived', async () => {
  const events = [];
  const error = Object.assign(new Error('Budget exhausted'), {stats:{cost:0.25}});
  const wrapped = withPromptCosts({generate:async () => {throw error;}}, event => events.push(event));
  await assert.rejects(wrapped.generate('prompt', {}), error);
  const final = events.at(-1).call;
  assert.equal(final.usd, 0.25);
  assert.equal(final.status, 'error');
  assert.equal(final.id, events[0].call.id);
});

test('a positively identified preflight rejection is not counted as an API call or an unknown charge', () => {
  const blocked = finishCostCall(createCostCall('generate'), Object.assign(new Error('Already failed'), {requestSent:false}));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.requestSent, false);
  assert.equal(blocked.usd, null);
  const totals = costTotals([blocked]);
  assert.equal(totals.requestCount, 0);
  assert.equal(totals.blockedCalls, 1);
  assert.equal(totals.missingCosts, 0);
  assert.equal(totals.confirmedUsd, null);
  assert.equal(totals.calls.length, 1);
  const paid = finishCostCall(updateCostCall(createCostCall('generate'), {cost:0.2}));
  assert.equal(costTotals([paid,blocked]).confirmedUsd, 0.2);
});

test('a generic network failure or error code alone never asserts that the provider was not called', () => {
  for (const error of [new Error('network error'), Object.assign(new Error('storage failed after response'), {code:'SPEND_GUARD_UNAVAILABLE'})]) {
    const totals = costTotals([finishCostCall(createCostCall('generate'), error)]);
    assert.equal(totals.requestCount, 1);
    assert.equal(totals.missingCosts, 1);
    assert.equal(totals.blockedCalls, 0);
  }
});
