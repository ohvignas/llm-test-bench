import {html} from 'htm/preact';
import {batchLiveStatus} from '../services/batchLiveProgress.js';
import {generationActivity, logModelKey} from '../services/batchGenerationLog.js';

function clock(at) { return new Date(at).toLocaleTimeString('fr-FR', {hour12:false}); }
export function BatchGenerationLog({entries, models, calls, startedAt, now, filter, onFilterChange, done = false, costCalls = []}) {
  const visible = filter === 'all' ? entries : entries.filter(e => e.modelKey === filter);
  function download() {
    const blob = new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),currency:'USD',costCalls:costCalls.filter(c=>filter==='all'||c.modelKey===filter),entries:visible},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'journal-generation.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  return html`
    <section class=${`batch-generation-log ${done ? 'is-finished' : ''}`} aria-label="Journal de génération">
      <div class="batch-log-head">
        <strong>Journal de génération</strong>
        <label>Modèle <select class="form-input" value=${filter} onChange=${e => onFilterChange(e.target.value)}>
          <option value="all">Tous les modèles</option>
          ${models.map(model => html`<option key=${logModelKey(model)} value=${logModelKey(model)}>${model.label || model.modelId}</option>`)}
        </select></label>
        <button class="btn btn-sm" onClick=${download} disabled=${!visible.length}>Exporter le journal</button>
      </div>
      <div class="batch-log-signals">
        ${models.filter(m => filter === 'all' || logModelKey(m) === filter).map(model => {
          const call = calls.filter(c => c.app === 'prompt-gallery' && c.startedAt >= startedAt && logModelKey(c) === logModelKey(model))
            .sort((a,b) => b.startedAt - a.startedAt)[0];
          const activity = generationActivity(call,now);
          return html`<div key=${logModelKey(model)} class=${`batch-log-signal ${call && activity.stalled ? 'is-silent' : ''}`}>
            <strong>${model.label || model.modelId}</strong>
            <span>${call ? batchLiveStatus([call],model,now)?.label : done ? 'Appels terminés ; consulter les événements' : 'En attente d’un appel observé'}</span>
            ${call && html`<span>${activity.label} · ${call.outputChars || 0} caractères · ${call.reasoningChunks || 0} signaux de raisonnement reçus</span>`}
          </div>`;
        })}
      </div>
      <p class="batch-log-explanation">Signaux observés, sans le détail du raisonnement interne. Un silence ne confirme pas une panne. Les 400 dernières entrées restent dans cette fenêtre ; exportez-les pour les conserver.</p>
      <ol class="batch-log-entries" role="log" aria-live="polite" aria-relevant="additions">
        ${visible.length ? visible.slice().sort((a,b) => b.at - a.at || b.id - a.id).map(entry => html`
          <li key=${entry.id} class=${`batch-log-entry is-${entry.level}`}>
            <time dateTime=${new Date(entry.at).toISOString()}>${clock(entry.at)}</time>
            <div><strong>${entry.modelLabel}${entry.promptTitle ? ` · ${entry.promptTitle}` : ''}</strong><span>${entry.message}</span></div>
          </li>`) : html`<li class="batch-log-empty">Aucun événement pour cette sélection.</li>`}
      </ol>
    </section>`;
}
