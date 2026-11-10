// Bounded, local diagnostic history. Never store response bodies or reasoning text.
const PHASES = {
  queued: 'Appel préparé', dispatched: 'Requête envoyée au fournisseur',
  spawned: 'Processus démarré', firstOutput: 'Premier signal du processus reçu',
  sessionReady: 'Connexion établie ; réponse du modèle attendue',
  firstThought: 'Raisonnement signalé par le fournisseur', firstToken: 'Premier contenu de réponse reçu',
  firstTool: 'Utilisation d’un outil signalée', done: 'Flux terminé',
};
const STATES = {
  start: 'Début du prompt', planning: 'Planification', generating: 'Génération demandée',
  checking: 'Vérification dans le bac à sable', healing: 'Correction des erreurs demandée',
  auditing: 'Audit demandé', repairing: 'Réparation demandée', saved: 'Résultat enregistré',
  skipped: 'Prompt ignoré', stopped: 'Exécution arrêtée', verified: 'Résultat vérifié',
  warned: 'Résultat à vérifier', no_progress: 'Aucun progrès observé', error: 'Échec',
  'saved-unverified': 'Code enregistré — vérification interrompue, reprise disponible',
};
export const logModelKey = model => JSON.stringify([model?.providerId || '', model?.modelId || '']);
export function safeLogText(value, max = 1200) {
  return String(value ?? '')
    .replace(/\bsk-[a-z0-9_-]+/gi, '[clé masquée]')
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [masqué]')
    .replace(/(["']?(?:api[_-]?key|authorization|access[_-]?token|secret)["']?\s*[:=]\s*)["']?[^\s,;&"'}]+["']?/gi, '$1[masqué]')
    .slice(0, max);
}
function duration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
export function generationActivity(call, now = Date.now()) {
  if (!call) return { label: 'Aucun appel observé', stalled: false };
  const last = call.lastReceivedAt ?? call.lastActivityAt ?? call.startedAt;
  const idleMs = Math.max(0, now - last);
  const stalled = idleMs >= 60000;
  return {
    label: call.lastReceivedAt == null ? `Aucun fragment de flux reçu · attente ${duration(now - call.startedAt)}`
      : `Dernier signal reçu il y a ${duration(idleMs)}`,
    stalled, idleMs,
  };
}
export function createBatchJournal({ models = [], startedAt = Date.now(), limit = 400 } = {}) {
  const allowed = new Map(models.map(m => [logModelKey(m), m]));
  const seen = new Set();
  const progressAt = new Map();
  const silent = new Set();
  const chunks = new Set();
  let rows = [], sequence = 0;
  function append(context, stage, message, at, level = 'info') {
    const model = context?.model || {};
    rows.push({ id: ++sequence, at, level, modelKey: logModelKey(model),
      promptIndex: Number.isInteger(context?.index) ? context.index : null,
      modelLabel: safeLogText(model.label || model.modelId || 'Lot', 200),
      promptTitle: safeLogText(context?.title || '', 200), stage, message: safeLogText(message) });
    if (rows.length > limit) rows = rows.slice(-limit);
  }
  return {
    entries: () => rows.slice(),
    event(event, context = {}, at = Date.now()) {
      const {type, status} = event;
      if (type === 'item' && STATES[status]) {
        const level = status === 'error' ? 'error' : ['saved','verified'].includes(status) ? 'success' : 'info';
        const attempt = status === 'generating' && Number.isInteger(event.attempt) ? ` · tentative ${event.attempt + 1}` : '';
        append(context, status, STATES[status] + attempt + (event.message ? ` : ${event.message}` : ''), at, level);
      } else if (type === 'log' || type === 'retry') {
        append(context, type, event.message || 'Tentative signalée', at, 'warn');
      } else if (type === 'chunk' && event.html) {
        const key = `${logModelKey(context.model)}:${context.index}`;
        if (!chunks.has(key)) {
          chunks.add(key);
          append(context, 'html', `Premier HTML exploitable reçu (${event.html.length} caractères)`, at);
        }
      } else if (type === 'stats' && event.stats) {
        const stats = event.stats, parts = [];
        if (Object.keys(stats).every(key => ['telemetryId','reasoningSummary','reasoningSignals'].includes(key))) return;
        if(stats.settings) {
          const settings=stats.settings,p=settings.params||{},signature=`settings:${logModelKey(context.model)}:${context.index}:${JSON.stringify([p.max_tokens??p.max_completion_tokens,p.reasoning?.effort||p.reasoning_effort,p.reasoning?.max_tokens])}`;
          if(!seen.has(signature)) {seen.add(signature);append(context,'settings',`Réglages API · profil ${({automatic:'automatique — reprise adaptée',benchmark:'comparaison — effort très élevé',maximum:'qualité maximale',code:'génération de code',manual:'personnalisé'})[settings.profile]||'personnalisé'} · sortie ${p.max_tokens??p.max_completion_tokens} tokens · ${p.reasoning?.effort||p.reasoning_effort?`effort ${p.reasoning?.effort||p.reasoning_effort}`:p.reasoning?.max_tokens?`raisonnement demandé : ${p.reasoning.max_tokens} tokens`:'contrôle du raisonnement non annoncé'}`,at);}
        }
        if(stats.feedback?.message)append(context,'diagnostic',stats.feedback.message,at,'warn');
        if(stats.settings&&!stats.finishReason&&stats.cost==null&&stats.completionTokens==null)return;
        if (Number.isFinite(stats.completionTokens)) parts.push(`${stats.completionTokens} tokens de sortie`);
        if (Number.isFinite(stats.reasoningTokens)) parts.push(`dont ${stats.reasoningTokens} de raisonnement`);
        if (Number.isFinite(stats.cost)) parts.push(`coût communiqué : ${stats.cost} USD`);
        if (stats.finishReason) parts.push(stats.finishReason === 'length' ? 'limite du budget de tokens atteinte' : `fin : ${stats.finishReason}`);
        append(context, 'stats', parts.length ? parts.join(' · ') : 'Mesures reçues ; tokens et coût non communiqués', at);
      } else if (type === 'control') append(context, 'control', event.message, at);
    },
    observeCalls(calls, now = Date.now(), contexts = null) {
      for (const call of calls) {
        const model = allowed.get(logModelKey(call));
        if (!model || call.app !== 'prompt-gallery' || call.startedAt < startedAt) continue;
        if (contexts && !contexts.has(call.id)) continue;
        const context = {...contexts?.get(call.id), model};
        const phases = call.phases || {[call.phase]: Math.max(0, now - call.startedAt)};
        for (const [phase, offset] of Object.entries(phases)) {
          const key = `${call.id}:${phase}`;
          if (!PHASES[phase] || seen.has(key)) continue;
          seen.add(key);
          append(context, phase, PHASES[phase], call.startedAt + offset);
        }
        const activity = generationActivity(call, now);
        if (activity.stalled && !silent.has(call.id)) {
          silent.add(call.id);
          append(context, 'silence', `${activity.label}. Aucune panne confirmée : le fournisseur peut rester silencieux.`, now, 'warn');
        } else if (!activity.stalled && silent.delete(call.id)) {
          append(context, 'resumed', 'Réception de signaux reprise', now);
        }
        // Aggregate traffic; one log line per five seconds, never one per token.
        const previous = progressAt.get(call.id);
        const changed = call.outputChars !== previous?.chars || call.reasoningChunks !== previous?.reasoning;
        if ((call.outputChars || call.reasoningChunks) && changed && now - (previous?.at ?? -Infinity) >= 5000) {
          progressAt.set(call.id, {at:now,chars:call.outputChars,reasoning:call.reasoningChunks});
          append(context, 'progress', `${call.outputChars || 0} caractères de réponse reçus · ${call.reasoningChunks || 0} signaux de raisonnement reçus`, now);
        }
      }
    },
  };
}
