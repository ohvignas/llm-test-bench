// Series filter browsing; text search always covers the complete library.
function normalized(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
export function batchPromptChoices({prompts, setId = 'all', query = '', selectedIds = new Set()}) {
  const terms = normalized(query).trim().split(/\s+/).filter(Boolean);
  const matches = prompts.filter(prompt => {
    const text = normalized([prompt.title, prompt.originalTitle, prompt.description, prompt.id,
      ...(prompt.tags || []), ...(prompt.aliases || [])].join(' '));
    return terms.every(term => text.includes(term));
  });
  const effectiveSet = terms.length ? 'all' : setId;
  const visible = effectiveSet === 'all' ? matches : matches.filter(prompt => (prompt.set || 'core') === effectiveSet);
  const matchingSets = {};
  for (const prompt of matches) {
    const set = prompt.set || 'core';
    matchingSets[set] = (matchingSets[set] || 0) + 1;
  }
  const selected=prompts.filter(prompt=>selectedIds.has(prompt.id));
  const selectedBySet={};
  for(const prompt of selected) {const set=prompt.set||'core';selectedBySet[set]=(selectedBySet[set]||0)+1;}
  return {visible,selected,selectedBySet,matchingSets,effectiveSet};
}

export function setVisibleSelection(selectedIds,visible,checked) {
  const next=new Set(selectedIds);
  for(const prompt of visible) {if(checked)next.add(prompt.id);else next.delete(prompt.id);}
  return next;
}
