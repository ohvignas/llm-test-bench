import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefineBilling } from '../../prompt-gallery/services/refineBilling.js';

test('refine tracks suggestions and improvements with final provider charges without double counting', async () => {
  const updates = [];
  const tracker = createRefineBilling({ details: { modelId: 'test-model' }, onBilling: billing => updates.push(billing) });
  assert.equal(await tracker.run('suggest', async onStats => {
    onStats({ cost: 0.01 }); onStats({ cost: 0.02 }); return 'Improve contrast';
  }), 'Improve contrast');
  const firstSavedSnapshot = tracker.snapshot();
  assert.equal(firstSavedSnapshot.confirmedUsd, 0.02);
  assert.equal(await tracker.run('improve', async onStats => { onStats({ cost: 0.03 }); return '<html>Updated</html>'; }), '<html>Updated</html>');
  const total = tracker.snapshot();
  assert.equal(total.calls.length, 2);
  assert.equal(total.confirmedUsd, 0.05);
  assert.equal(total.calls[0].role, 'suggest');
  assert.equal(total.calls[1].role, 'improve');
  assert.ok(total.calls.every(call => call.status === 'done' && call.modelId === 'test-model'));
  assert.equal(firstSavedSnapshot.calls.length, 1, 'saving a version preserves its historical snapshot');
  assert.equal(firstSavedSnapshot.confirmedUsd, 0.02);
  assert.equal(updates[0].calls[0].status, 'pending');
  assert.equal(updates.at(-1).calls[1].status, 'done');
});

test('refine retains paid errors and missing usage across later user actions', async () => {
  const first = createRefineBilling();
  const error = Object.assign(new Error('Output budget exhausted'), { stats: { cost: 0.12 } });
  await assert.rejects(first.run('heal', async () => { throw error; }), error);
  const next = createRefineBilling({ calls: first.snapshot().calls });
  await next.run('heal', async () => '<html>Repaired</html>');
  assert.equal(next.snapshot().confirmedUsd, 0.12);
  assert.equal(next.snapshot().missingCosts, 1);
  assert.deepEqual(next.snapshot().calls.map(call => call.status), ['error', 'done']);
});

test('cancelled refine call is retained and never retried by the tracker', async () => {
  const tracker = createRefineBilling();
  let invoked = 0;
  await assert.rejects(tracker.run('improve', async onStats => {
    invoked++; onStats({ cost: 0.04 }); throw new DOMException('Stopped', 'AbortError');
  }), { name: 'AbortError' });
  assert.equal(invoked, 1);
  assert.equal(tracker.snapshot().calls[0].status, 'cancelled');
  assert.equal(tracker.snapshot().confirmedUsd, 0.04);
});
