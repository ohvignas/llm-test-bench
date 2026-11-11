// Only the provider's explicit high-level summaries, never raw or encrypted
// reasoning. Bounded per call; no extra model request and no prompt changes.
export const REASONING_SUMMARY_LIMIT = 8000;
const SUMMARIZED_CLAUDE=/^anthropic\/claude-(?:fable-5(?:\.[12])?|mythos-5(?:\.[12])?|opus-(?:5(?:\.5)?|4\.[78])|sonnet-5(?:\.5)?|haiku-5\.5)(?::[a-z-]+)?$/;

// OpenRouter's documented default for these Claude versions is summarized
// thinking. Its compatibility transport may label that summary reasoning.text.
// Other models and unknown/encrypted formats never take this path.
export function providerSummaryParts(delta,modelId='') {
  const details=Array.isArray(delta?.reasoning_details)?delta.reasoning_details:[];
  const explicit=details.filter(p=>p?.type==='reasoning.summary'&&typeof p.summary==='string');
  if(explicit.length)return explicit;
  if(!SUMMARIZED_CLAUDE.test(modelId))return [];
  const parts=details.filter(p=>p?.type==='reasoning.text'&&p.format==='anthropic-claude-v1'&&typeof p.text==='string')
    .map(p=>({...p,type:'reasoning.summary',summary:p.text}));
  if(parts.length)return parts;
  return !details.length&&typeof delta?.reasoning==='string'?[{type:'reasoning.summary',summary:delta.reasoning}]:[];
}

export function safeSummaryText(value) {
  return String(value || '')
    .replace(/\bsk-[a-z0-9_-]+/gi, '[clé masquée]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [masqué]')
    .replace(/(["']?(?:api[_-]?key|authorization|access[_-]?token|secret)["']?\s*[:=]\s*)["']?[^\s,;&"'}]+["']?/gi, '$1[masqué]');
}

export function createReasoningSummary() {
  let text = '', previousBlock = null, truncated = false;
  return {
    add(details) {
      if (!Array.isArray(details)) return false;
      let changed = false;
      for (const detail of details) {
        if (detail?.type !== 'reasoning.summary' || typeof detail.summary !== 'string' || !detail.summary) continue;
        const block = detail.id ?? detail.index ?? '';
        const part = (text && previousBlock !== block ? '\n\n' : '') + detail.summary;
        previousBlock = block;
        const room = REASONING_SUMMARY_LIMIT - text.length;
        if (part.length > room) truncated = true;
        if (room > 0) {text += part.slice(0, room); changed = true;}
      }
      return changed;
    },
    snapshot() {
      return text ? {text:safeSummaryText(text), truncated, source:'provider-summary'} : null;
    },
  };
}
