export const DEFAULT_BATCH_MODE = 'agent';

// A comparison must not inherit an economy override or a learned recovery policy.
// Use this same selection for the displayed settings and the submitted request.
export function batchGenerationOptions({mode, profile = 'benchmark', override = {}, budget = {}} = {}) {
  if (mode === 'agent') return {profile,...override,budget:{...budget,...override},engine:'mastra'};
  if (mode === 'comparison') return {profile: 'maximum',engine:'completion'};
  if (mode === 'automatic') return {profile: 'automatic', budget,engine:'completion'};
  return {profile, ...override, budget: {...budget, ...override},engine:'completion'};
}
