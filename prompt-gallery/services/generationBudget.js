import {resolveModelSettings} from '../../shared/services/model-capabilities.js';
export const DEFAULT_HTML_BUDGET={totalTokens:32768,reasoningTokens:4096};
// Compatibility entry point: capabilities are required; model names never imply limits.
export function htmlGenerationParams({providerType,model,profile='benchmark',params,budget}={}) {
  if(providerType!=='openrouter')return params;
  return resolveModelSettings({model,profile,params,budget}).params;
}

// Upgrade the former app default once; explicit per-model budgets/efforts survive.
export function restoreGenerationSettings(stored = {}) {
  const valid = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const profile = ['benchmark','maximum','code','manual'].includes(valid.profile) ? valid.profile : 'benchmark';
  return {...valid, defaultsVersion:3, profile:valid.defaultsVersion !== 3 && profile === 'code' ? 'benchmark' : profile};
}
