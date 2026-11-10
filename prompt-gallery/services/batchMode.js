export const DEFAULT_BATCH_MODE = 'comparison';

// A comparison must not inherit an economy override or a learned recovery policy.
// Use this same selection for the displayed settings and the submitted request.
export function batchGenerationOptions({mode, profile = 'benchmark', override = {}, budget = {}} = {}) {
  if (mode === 'comparison') return {profile: 'maximum'};
  if (mode === 'automatic') return {profile: 'automatic', budget};
  return {profile, ...override, budget: {...budget, ...override}};
}
