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

// Adapt persisted calls to the existing batch presentation. Empty outputs are
// real items too: reasoning, queued and failed calls must never disappear.
export function executionBatchSnapshot(calls, now = Date.now()) {
  const models = [...new Map(calls.map(c => [c.model, {
    providerId:'openrouter', modelId:c.model, label:c.context?.modelLabel || c.model,
  }])).values()];
  const runList=[], items=[], outputs=[], costCalls=[], liveCalls=[], entries=[];
  for (const [laneIndex, model] of models.entries()) {
    const byPrompt=new Map();
    for (const call of calls.filter(c=>c.model===model.modelId)) {
      const key=executionProjectKey(call) || call.id;
      if (!byPrompt.has(key)) byPrompt.set(key,[]);
      byPrompt.get(key).push(call);
    }
    for (const [key, attempts] of byPrompt) {
      attempts.sort((a,b)=>b.started-a.started);
      const latest=attempts[0], index=runList.length;
      const title=latest.context?.title || 'Appel ancien — titre non conservé';
      runList.push({id:key,title,laneIndex,executionId:latest.id});
      const active=executionActive(latest);
      items.push({status:active ? latest.state==='queued'?'queued':'generating'
        : latest.state==='ok'?'saved':['cancelled','interrupted'].includes(latest.state)?'stopped':'error',
        message:latest.error?.message || (latest.finish_reason==='length'?executionStatus(latest):''),
        executionId:latest.id});
      outputs.push(latest.output || '');
      for (const call of attempts) {
        const running=executionActive(call), modelKey=JSON.stringify(['openrouter',call.model]);
        costCalls.push({id:call.id, index, telemetryId:call.id, modelKey, modelLabel:model.label,
          promptTitle:title, role:'generate', startedAt:call.started*1000,
          ...(running?{}:{finishedAt:call.updated*1000}),
          status:call.error?.requestSent===false?'blocked':running?'pending':call.state==='ok'?'done':call.state==='error'?'error':'cancelled',
          ...(call.error?.requestSent===false?{requestSent:false}:{}), usd:call.usage?.cost ?? null,
          reasoningSignals:call.reasoning_events || 0,
          ...(call.summary?{reasoningSummary:{source:'provider-summary',text:call.summary}}:{})});
        if(running) liveCalls.push({...model,id:call.id,app:'prompt-gallery',startedAt:call.started*1000,
          lastReceivedAt:call.updated*1000,outputChars:call.output_chars || 0,reasoningChunks:call.reasoning_events || 0,
          phase:call.state==='reasoning'?'firstThought':call.state==='writing'?'firstToken':call.state==='queued'?'queued':'sessionReady'});
        entries.push({id:call.id,at:call.updated*1000,modelKey,modelLabel:model.label,promptTitle:title,promptIndex:index,
          level:call.state==='error'?'error':'info',message:call.error?.message ||
            `${executionStatus(call)} · ${call.output_chars || 0} caractères reçus · ${call.reasoning_events || 0} signaux de raisonnement`});
      }
    }
  }
  const currentIds=new Set(runList.map(item=>item.executionId));
  const currentCostCalls=costCalls.filter(call=>currentIds.has(call.id));
  return {models,runList,items,outputs,costCalls,currentCostCalls,liveCalls,entries,now,
    startedAt:calls.length?Math.min(...calls.map(c=>c.started*1000)):now,
    done:!calls.some(executionActive)};
}
