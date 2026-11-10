import { costTotals } from './batchCosts.js';

const timestamp = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Wall time, not the sum of simultaneous calls. Persisted call timestamps also
// make this available for older results without another provider request.
export function executionMetrics(calls = [], { now = Date.now(), done = true, startedAt, finishedAt } = {}) {
  const totals = costTotals(calls);
  const sent = totals.calls.filter(call => call.requestSent !== false);
  const spans = sent.map(call => {
    if (!timestamp(call.startedAt)) return null;
    const end = timestamp(call.finishedAt) ? call.finishedAt : !done && call.status === 'pending' ? now : null;
    return timestamp(end) && end >= call.startedAt ? [call.startedAt, end] : null;
  });
  const timed = spans.filter(Boolean);
  let elapsedMs = sent.length === 0 ? 0 : timed.length === sent.length
    ? Math.max(...timed.map(span => span[1])) - Math.min(...timed.map(span => span[0])) : null;
  if (timestamp(startedAt)) {
    const end = timestamp(finishedAt) ? finishedAt : !done ? now : null;
    if (timestamp(end) && end >= startedAt) elapsedMs = end - startedAt;
  }
  const groups = new Map();
  for (const call of totals.calls) {
    const key = call.modelKey || call.modelLabel || '';
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, label:call.modelLabel || key, calls:[] });
    groups.get(key).calls.push(call);
  }
  return { elapsedMs, requestCount:totals.requestCount, blockedCalls:totals.blockedCalls,
    models:[...groups.values()].map(group => ({key:group.key, label:group.label,
      ...executionMetricsWithoutModels(group.calls, {now, done})})) };
}

function executionMetricsWithoutModels(calls, options) {
  const result = executionMetrics(calls.map(({modelKey, modelLabel, ...call}) => call), options);
  return {elapsedMs:result.elapsedMs, requestCount:result.requestCount};
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'Non mesurée';
  const seconds = Math.floor(ms / 1000), h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return h ? `${h} h ${m} min ${s} s` : m ? `${m} min ${s} s` : `${s} s`;
}
