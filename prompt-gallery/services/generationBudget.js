import {resolveModelSettings} from '../../shared/services/model-capabilities.js';
export const DEFAULT_HTML_BUDGET={totalTokens:32768,reasoningTokens:4096};
// Compatibility entry point: capabilities are required; model names never imply limits.
export function htmlGenerationParams({providerType,model,profile='code',params,budget}={}) {
  if(providerType!=='openrouter')return params;
  return resolveModelSettings({model,profile,params,budget}).params;
}
