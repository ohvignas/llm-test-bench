import {html} from 'htm/preact';
import {batchActivity} from '../services/batchActivity.js';
import {generationActivity} from '../services/batchGenerationLog.js';

export function BatchActivity({model, index, calls, liveCalls, entries, now, statusLabel = 'En attente'}) {
  const activity = batchActivity({model, index, calls, liveCalls, entries});
  const signal = activity.live ? generationActivity(activity.live, now) : null;
  return html`<section class="batch-activity" aria-label="Réflexion et activité">
    <div class="batch-activity-head"><strong>Réflexion et activité</strong><span>${statusLabel}</span></div>
    <div class="batch-activity-body">
      ${signal && html`<p class=${signal.stalled ? 'batch-activity-warning' : ''}>${signal.label}${signal.stalled ? ' · Silence du fournisseur ; aucune panne confirmée.' : ''}</p>`}
      ${Number.isFinite(activity.signals) && html`<p>${activity.signals.toLocaleString('fr-FR')} signaux de raisonnement reçus. Ce compteur ne mesure pas les tokens.</p>`}
      ${activity.text ? html`<strong class="batch-activity-summary-label">Résumé transmis par le fournisseur</strong>
        <div class="batch-activity-summary">${activity.text}</div>
        ${activity.truncated && html`<p>Extrait limité aux 8 000 premiers caractères.</p>`}`
        : html`<p class="batch-activity-empty">Aucun résumé de raisonnement transmis pour cet appel. Les événements ci-dessous montrent l’activité observable ; le détail du raisonnement interne n’est pas affiché.</p>`}
      ${activity.entries.length > 0 && html`<ol class="batch-activity-events" aria-label="Dernières étapes observées">
        ${activity.entries.map(entry => html`<li key=${entry.id} class=${entry.level === 'error' ? 'batch-activity-error' : ''}>
          <time>${new Date(entry.at).toLocaleTimeString('fr-FR', {hour12:false})}</time><span>${entry.message}</span>
        </li>`)}
      </ol>`}
    </div>
  </section>`;
}
