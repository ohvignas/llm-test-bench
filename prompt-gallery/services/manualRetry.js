// A retry is an explicit, single-item action. Never turn a failure into a loop.
export function retryProposal(message = '', maximum = 128000) {
  const match = String(message).match(/can only afford\s+([\d,]+)\b/i);
  const affordable = match ? Number(match[1].replaceAll(',', '')) : null;
  const creditLimited = Number.isSafeInteger(affordable) && affordable > 0 && affordable < maximum;
  return {maximum, affordable:creditLimited ? affordable : null,
    // Leave a small margin; another active call can still change the balance.
    recommended:creditLimited ? Math.floor(affordable * 0.95) : maximum};
}

export function manualRetryModel(model, totalTokens, maximum, id) {
  if (!Number.isSafeInteger(totalTokens) || totalTokens < 256 || totalTokens > maximum)
    throw new Error(`Choisissez un plafond entre 256 et ${maximum} tokens.`);
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Identifiant de relance invalide.');
  return {...model, generationOptions:{profile:'maximum', reviewedMaxTokens:totalTokens, explicitRetry:id}};
}

export function applyRetrySummaries(summary, retries) {
  const next = {...summary};
  for (const {result, wasError} of retries) {
    next.failed = Math.max(0, (next.failed || 0) - (wasError ? 1 : 0) + (result.failed || 0));
    for (const key of ['generated','saved']) next[key] = (next[key] || 0) + (result[key] || 0);
  }
  return next;
}

export function createRetryQueue() {
  const pending = new Set();
  return {
    get size() { return pending.size; },
    has: index => pending.has(index),
    async run(index, task) {
      if (pending.has(index)) return;
      pending.add(index);
      try { return await task(); } finally { pending.delete(index); }
    },
  };
}
