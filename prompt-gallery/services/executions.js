export const ACTIVE_EXECUTIONS = new Set(['queued','running','connecting','waiting','reasoning','writing']);
export const executionActive = call => ACTIVE_EXECUTIONS.has(call.state);
export function executionProjectKey(call) {
  const c = call.context || {};
  return c.promptId || c.title ? JSON.stringify([c.groupId || c.runId || 'individuel',c.promptId || c.title]) : null;
}
export function executionProjects(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = executionProjectKey(call);
    if (!key) continue; // Never invent a prompt association for old numeric logs.
    if (!groups.has(key)) groups.set(key,{key,title:call.context.title || call.context.promptId,calls:[],started:call.started});
    groups.get(key).calls.push(call);
  }
  return [...groups.values()].sort((a,b)=>b.started-a.started);
}
export function executionStatus(call) {
  if (call.finish_reason === 'length') return call.output_chars ? 'Sortie incomplète — limite atteinte' : 'Échec — budget épuisé sans code';
  return {queued:'En attente de démarrage',running:'Connexion au fournisseur',connecting:'Connexion au fournisseur',
    waiting:'Réponse attendue',reasoning:'Raisonnement en cours',writing:'Code en cours',ok:'Terminé',
    error:'Échec',cancelled:'Interrompu',interrupted:'Interrompu — serveur redémarré'}[call.state] || 'État inconnu';
}
export function executionCost(calls) {
  const sent = calls.filter(c=>c.error?.requestSent !== false);
  const known = sent.filter(c=>Number.isFinite(c.usage?.cost));
  const total = known.reduce((sum,c)=>sum+c.usage.cost,0);
  const amount = new Intl.NumberFormat('fr-FR',{maximumFractionDigits:6}).format(total)+' $US';
  return {count:sent.length, unknown:sent.length-known.length,
    label:!sent.length?'Aucun appel envoyé':!known.length?'Coût non communiqué':amount+(known.length<sent.length?' + coûts en attente':'')};
}
export function executionDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'Durée inconnue';
  const value = Math.max(0,Math.floor(seconds));
  return value<60 ? `${value} s` : `${Math.floor(value/60)} min ${value%60} s`;
}
