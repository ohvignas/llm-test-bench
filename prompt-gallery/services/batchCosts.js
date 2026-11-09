// Only provider-reported charges. Missing usage is never interpreted as free.
let sequence = 0;
export function costTotals(calls = []) {
  const unique = [...new Map(calls.map(call => [call.id, call])).values()];
  const known = unique.filter(call => Number.isFinite(call.usd) && call.usd >= 0);
  return {currency:'USD', confirmedUsd:known.length ? known.reduce((sum, call) => sum + call.usd, 0) : null,
    missingCosts:unique.length - known.length, calls:unique};
}
export function formatUsd(value) {
  return Number.isFinite(value) ? `${value.toLocaleString('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:12})} $US` : 'Coût en attente';
}
export function withPromptCosts(deps, emit) {
  const calls = new Map();
  const wrapped = {...deps};
  for (const role of ['generate','heal','audit','repair']) {
    if (!deps[role]) continue;
    wrapped[role] = async (...args) => {
      const position = role === 'generate' ? 1 : 0;
      const options = args[position] || {};
      const call = {id:globalThis.crypto?.randomUUID?.() || `call-${Date.now().toString(36)}-${++sequence}`,role,startedAt:Date.now(),status:'pending',usd:null};
      const publish = () => { calls.set(call.id,{...call}); emit({type:'cost',call:{...call}}); };
      publish();
      args[position] = {...options,onStats:stats => {
        if (Number.isFinite(stats?.cost) && stats.cost >= 0) call.usd = stats.cost;
        publish();
        options.onStats?.(stats);
      }};
      try { const result = await deps[role](...args); call.status='done'; return result; }
      catch (error) { call.status=error.name === 'AbortError' ? 'cancelled' : 'error'; throw error; }
      finally { call.finishedAt=Date.now(); publish(); }
    };
  }
  if (deps.save) wrapped.save = args => deps.save({...args,billing:{scope:'prompt',...costTotals([...calls.values()])}});
  return wrapped;
}
