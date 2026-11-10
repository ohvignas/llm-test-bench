import { createCostCall, updateCostCall, finishCostCall, costTotals } from './batchCosts.js';

// One tracker per user action; a multi-attempt repair retains every call,
// including failed calls and providers that omit billing information.
export function createRefineBilling({ calls = [], details = {}, onBilling = () => {} } = {}) {
  const ledger = new Map(calls.map(call => [call.id, call]));
  const snapshot = () => ({ scope: 'refine-session', ...costTotals([...ledger.values()]) });
  const publish = call => { ledger.set(call.id, call); onBilling(snapshot()); };
  return {
    snapshot,
    async run(role, invoke) {
      let call = createCostCall(role, details);
      publish(call);
      try {
        const result = await invoke(stats => { call = updateCostCall(call, stats); publish(call); });
        call = finishCostCall(call);
        return result;
      } catch (error) {
        call = finishCostCall(call, error);
        throw error;
      } finally { publish(call); }
    },
  };
}
