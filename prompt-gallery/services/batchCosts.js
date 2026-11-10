// Only provider-reported charges. Missing usage is never interpreted as free.
let sequence = 0;

// Keep one identity from dispatch through save, so a streamed cumulative charge
// is replaced rather than added again on every stats event or later save.
export function createCostCall(role, details = {}) {
  return {...details, id:details.id || globalThis.crypto?.randomUUID?.() || `call-${Date.now().toString(36)}-${++sequence}`,
    role, startedAt:details.startedAt ?? Date.now(), status:'pending', usd:null};
}

/** Provider-reported USD only. Token counts/pricing are never used to estimate. */
export function updateCostCall(call, stats) {
  const next = {...call};
  if (typeof stats?.telemetryId === 'string') next.telemetryId = stats.telemetryId;
  if (typeof stats?.executionId === 'string') next.executionId = stats.executionId;
  if (stats?.reasoningSummary?.source === 'provider-summary') next.reasoningSummary = stats.reasoningSummary;
  if (Number.isSafeInteger(stats?.reasoningSignals) && stats.reasoningSignals >= 0) next.reasoningSignals = stats.reasoningSignals;
  if (Number.isFinite(stats?.cost) && stats.cost >= 0) next.usd = stats.cost;
  if (stats?.settings) {
    const {profile, source, params = {}} = stats.settings;
    next.settings = {profile, source, maxTokens:params.max_tokens ?? params.max_completion_tokens,
      reasoningEffort:params.reasoning?.effort || params.reasoning_effort || null,
      reasoningTokens:params.reasoning?.max_tokens ?? null};
  }
  if (stats?.feedback) next.feedback = stats.feedback;
  return next;
}

/** Preserve charges reported on a failed call as well as successful calls. */
export function finishCostCall(call, error = null) {
  if (error?.requestSent === false) return {...call, status:'blocked', requestSent:false, finishedAt:Date.now()};
  return {...updateCostCall(call, error?.stats),
    status:error ? (error.name === 'AbortError' ? 'cancelled' : 'error') : 'done', finishedAt:Date.now()};
}

export function costTotals(calls = []) {
  const unique = [...new Map(calls.map(call => [call.id, call])).values()];
  const requested = unique.filter(call => call.requestSent !== false);
  const known = requested.filter(call => Number.isFinite(call.usd) && call.usd >= 0);
  return {currency:'USD', confirmedUsd:known.length ? known.reduce((sum, call) => sum + call.usd, 0) : null,
    missingCosts:requested.length - known.length, requestCount:requested.length,
    blockedCalls:unique.length - requested.length, calls:unique};
}
export function formatUsd(value) {
  return Number.isFinite(value) ? `${value.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:12})} $US` : 'Coût en attente';
}
export function withPromptCosts(deps, emit, promptItem) {
  const calls = new Map();
  const wrapped = {...deps};
  for (const role of ['generate','heal','audit','repair']) {
    if (!deps[role]) continue;
    wrapped[role] = async (...args) => {
      const position = role === 'generate' ? 1 : 0;
      const options = args[position] || {};
      let call = createCostCall(role, options.stage ? {stage:options.stage} : {});
      const publish = () => { calls.set(call.id,{...call}); emit({type:'cost',call:{...call}}); };
      publish();
      const mdl = options.model;
      const context = promptItem && mdl ? {promptItem,model:{...mdl,generationOptions:{...mdl.generationOptions,
        executionContext:{promptId:promptItem.id || '',title:promptItem.title || 'Création personnalisée',
          groupId:mdl.batchGroupId || mdl.batchRunId || '',runId:mdl.batchRunId || '',modelLabel:mdl.label || mdl.modelId}}}} : {};
      args[position] = {...options,...context,onStats:stats => {
        call = updateCostCall(call, stats);
        publish();
        options.onStats?.(stats);
      }};
      try { const result = await deps[role](...args); call=finishCostCall(call); return result; }
      catch (error) { call=finishCostCall(call,error); throw error; }
      finally { publish(); }
    };
  }
  if (deps.save) wrapped.save = args => deps.save({...args,billing:{scope:'prompt',...costTotals([...calls.values()])}});
  return wrapped;
}
