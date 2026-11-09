// Total output includes thinking. Adaptive models expose effort, not a hard thinking cap.
export const DEFAULT_HTML_BUDGET = { totalTokens: 32768, reasoningTokens: 4096, reasoningEffort: 'low' };

export function usesAdaptiveReasoning(modelId = '') {
  if (!/^~?anthropic\//i.test(modelId)) return false;
  if (/claude-(?:opus|sonnet|haiku|fable)-latest/i.test(modelId)) return true;
  const version = modelId.match(/claude-(?:opus|sonnet|haiku|fable)-(\d+)(?:\.(\d+))?/i);
  return !!version && (Number(version[1]) >= 5 || (Number(version[1]) === 4 && Number(version[2]) >= 6));
}

export function htmlGenerationParams({ providerType, modelId, params, budget } = {}) {
  if (providerType !== 'openrouter') return params;
  const out = { ...params };
  const total = Number(budget?.totalTokens ?? out.max_tokens ?? DEFAULT_HTML_BUDGET.totalTokens);
  if (!Number.isInteger(total) || total < 1 || total > 200000) {
    throw new Error('Le budget total doit être un entier entre 1 et 200000 tokens.');
  }
  out.max_tokens = total;
  const adaptive = usesAdaptiveReasoning(modelId);
  if (adaptive && out.reasoning?.max_tokens != null) {
    throw new Error('Ce Claude utilise un raisonnement adaptatif : choisissez un effort plutôt qu’un budget de raisonnement ignoré.');
  }
  const hasReasoning = out.reasoning != null || out.reasoning_effort != null || out.enable_thinking != null;
  if (/^~?anthropic\//i.test(modelId || '') && !hasReasoning) {
    const reasoning = Number(budget?.reasoningTokens ?? DEFAULT_HTML_BUDGET.reasoningTokens);
    if (adaptive) {
      const effort = budget?.reasoningEffort ?? DEFAULT_HTML_BUDGET.reasoningEffort;
      if (!['low','medium','high'].includes(effort)) throw new Error('Effort de raisonnement invalide.');
      out.reasoning = { effort };
    } else out.reasoning = { max_tokens: reasoning };
  }
  const reasoning = out.reasoning?.max_tokens;
  if (reasoning != null && (!Number.isInteger(reasoning) || reasoning < 1024 || reasoning >= total)) {
    throw new Error('Le budget de raisonnement doit être un entier d’au moins 1024 tokens et inférieur au budget total.');
  }
  return out;
}
