// Prompt Gallery HTML requests reserve room for code after reasoning.
export const DEFAULT_HTML_BUDGET = { totalTokens: 32768, reasoningTokens: 4096 };

export function htmlGenerationParams({ providerType, modelId, params, budget } = {}) {
  if (providerType !== 'openrouter') return params;
  const out = { ...params };
  const total = Number(budget?.totalTokens ?? out.max_tokens ?? DEFAULT_HTML_BUDGET.totalTokens);
  if (!Number.isInteger(total) || total < 1 || total > 200000) {
    throw new Error('Le budget total doit être un entier entre 1 et 200000 tokens.');
  }
  out.max_tokens = total;
  const hasReasoning = out.reasoning != null || out.reasoning_effort != null || out.enable_thinking != null;
  if (/^~?anthropic\//i.test(modelId || '') && !hasReasoning) {
    const reasoning = Number(budget?.reasoningTokens ?? DEFAULT_HTML_BUDGET.reasoningTokens);
    out.reasoning = { max_tokens: reasoning };
  }
  const reasoning = out.reasoning?.max_tokens;
  if (reasoning != null && (!Number.isInteger(reasoning) || reasoning < 1024 || reasoning >= total)) {
    throw new Error('Le budget de raisonnement doit être un entier d’au moins 1024 tokens et inférieur au budget total.');
  }
  return out;
}
