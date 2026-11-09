// Search only affects this launch; hidden selections remain checked for later.
function normalized(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
export function batchPromptChoices({prompts, setId, query = '', selectedIds = new Set()}) {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  const matches = prompts.filter(prompt => {
    const text = normalized([prompt.title, prompt.originalTitle, prompt.description, prompt.id,
      ...(prompt.tags || []), ...(prompt.aliases || [])].join(' '));
    return terms.every(term => text.includes(term));
  });
  const visible = matches.filter(prompt => (prompt.set || 'core') === setId);
  const matchingSets = {};
  for (const prompt of matches) {
    const set = prompt.set || 'core';
    matchingSets[set] = (matchingSets[set] || 0) + 1;
  }
  return {visible, selected:visible.filter(prompt => selectedIds.has(prompt.id)), matchingSets};
}
