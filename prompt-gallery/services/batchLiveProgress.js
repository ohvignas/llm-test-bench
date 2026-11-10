// Explain a model's live phase even before there is HTML to preview.
const LABELS = {
  queued: 'En attente', dispatched: 'Requête envoyée', spawned: 'Démarrage',
  firstOutput: 'Réponse en cours', sessionReady: 'Attente du modèle',
  firstThought: 'Raisonnement en cours', firstToken: 'Réception de la réponse',
  firstTool: 'Utilisation des outils',
};

export function batchItemRunning(item) {
  return ['planning', 'generating', 'checking', 'healing', 'auditing', 'repairing'].includes(item?.status);
}

export function batchLiveStatus(calls, model, now = Date.now(), telemetryIds = null) {
  if (!model) return null;
  const call = calls.filter(c => c.app === 'prompt-gallery'
    && c.providerId === model.providerId && c.modelId === model.modelId
    && (telemetryIds === null || telemetryIds.includes(c.id)))
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  if (!call) return null;
  const seconds = Math.max(0, Math.floor((now - call.startedAt) / 1000));
  const elapsed = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  return {label: LABELS[call.phase] || 'Génération en cours', elapsed, outputChars: call.outputChars || 0};
}
