import {html} from 'htm/preact';
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {CellEditor} from '../../shared/components/CellEditor.js';
import {withPreviewStorage} from '../../shared/services/preview-storage.js';
import {liveComparisonCards, liveComparisonPrompts} from '../services/batchLiveComparison.js';
import {batchItemRunning, batchLiveStatus} from '../services/batchLiveProgress.js';
import {costTotals, formatUsd} from '../services/batchCosts.js';
import {executionMetrics, formatDuration} from '../services/executionMetrics.js';

const LABELS = {queued:'En attente', 'not-started':'Non lancé', saved:'Enregistré', error:'Échec',
  'saved-unverified':'Enregistré — vérification interrompue', stopped:'Arrêté', skipped:'Ignoré', verified:'Vérifié', warned:'À vérifier', no_progress:'Aucun progrès',
  generating:'Génération', checking:'Vérification', healing:'Correction', repairing:'Réparation', auditing:'Audit', planning:'Planification'};

// Refresh regularly during streaming, rather than remounting a preview on every
// token. The final document is shown immediately. No same-origin privilege.
function usePreviewDocument(output, active, identity) {
  const latest = useRef(output);
  latest.current = output;
  const [preview, setPreview] = useState(output);
  useEffect(() => {
    setPreview(latest.current);
    if (!active) return;
    const timer = setInterval(() => setPreview(latest.current), 1500);
    return () => clearInterval(timer);
  }, [active, identity]);
  useEffect(() => { if (!active) setPreview(output); }, [active, output]);
  return preview;
}

function LiveModelPane({card, liveCalls, now, done, paused, theme, onFullscreen, showLiveOutput}) {
  const {model, index, prompt, item, output, calls} = card;
  const active = !done && batchItemRunning(item);
  const live = active ? batchLiveStatus(liveCalls, model, now) : null;
  const status = paused && active ? 'En pause' : live?.label || LABELS[item.status] || 'En attente';
  const costs = costTotals(calls);
  const timing = executionMetrics(calls, {now, done});
  const label = model.label || model.modelId;
  const preview = usePreviewDocument(output, active, index);
  const srcdoc = useMemo(() => preview ? withPreviewStorage(preview) : '', [preview]);
  const cost = costs.confirmedUsd == null
    ? calls.length ? (calls.some(call => call.status === 'pending') ? 'Coût en attente' : 'Coût non communiqué') : 'Aucun appel'
    : `${formatUsd(costs.confirmedUsd)}${costs.missingCosts ? ` + ${costs.missingCosts} coût(s) en attente ou non communiqué(s)` : ''}`;
  return html`<article class=${`live-model-pane ${item.status === 'error' ? 'has-error' : ''}`} aria-label=${`Modèle : ${label}`}>
    <header class="live-model-head">
      <h3>${label}</h3>
      <div class="live-model-prompt">${prompt?.title || 'Prompt en attente'}</div>
      <div class="live-model-status" role="status"><span>${status}</span><span>${formatDuration(timing.elapsedMs)} · ${timing.requestCount} appel(s)</span></div>
      ${item.stage && html`<small>Étape ${item.stage.index}/${item.stage.total} · ${item.stage.title}</small>`}
      <div class="live-model-cost">${cost}</div>
      ${item.message && ['error','no_progress','stopped'].includes(item.status) && html`<p class="live-model-error">${item.message}</p>`}
    </header>
    ${showLiveOutput ? html`<div class="live-model-preview-head"><strong>Aperçu ${active ? 'en direct' : 'du résultat'}</strong>
      <button class="btn btn-sm" disabled=${!output && !item.savedIds?.length} onClick=${() => onFullscreen(index)}>Plein écran</button>
    </div>
    ${srcdoc ? html`<iframe class="live-model-preview" title=${`Aperçu en direct : ${label}`} sandbox="allow-scripts" srcdoc=${srcdoc}></iframe>`
      : html`<div class="live-model-empty">${item.status === 'error' ? 'Aucun aperçu produit.' : 'L’aperçu apparaîtra dès réception du HTML.'}</div>`}
    <div class="live-model-code-head"><strong>${active ? 'Code en direct' : 'Code reçu'}</strong><span>${output.length.toLocaleString('fr-FR')} caractères</span></div>
    <${CellEditor} className="live-model-code" value=${output} kind="html" theme=${theme} readOnly=${true}
      minLines=${9} maxLines=${9} fontSize=${12} followOutput=${active}/>`
      : html`<div class="live-model-empty">Aperçu et code masqués pour cette exécution.</div>`}
  </article>`;
}

export function BatchLiveComparison({models, runList, items, outputs, costCalls, liveCalls, now, done, paused, theme, onFullscreen, showLiveOutput}) {
  const [promptId, setPromptId] = useState('');
  const prompts = useMemo(() => liveComparisonPrompts(runList), [runList]);
  const cards = liveComparisonCards({models, runList, items, outputs, calls:costCalls, promptId});
  return html`<section class="batch-live-comparison" aria-label="Comparaison des modèles en direct">
    <div class="live-comparison-options">
      <label>Prompt affiché <select class="form-input" value=${promptId} onChange=${event => setPromptId(event.target.value)}>
        <option value="">Suivre le travail de chaque modèle</option>
        ${prompts.map(prompt => html`<option key=${prompt.id} value=${prompt.id}>${prompt.title}</option>`)}
      </select></label>
      <p>${showLiveOutput ? 'Le code et l’aperçu se mettent à jour pendant la génération. Un aperçu partiel peut rester vide tant que le code nécessaire n’est pas arrivé.'
        : 'L’affichage du code et des aperçus a été désactivé au lancement. Les états, durées et coûts restent visibles.'}</p>
    </div>
    <div class="live-comparison-grid" style=${{'--live-columns':Math.max(1, Math.min(cards.length, 3))}}>
      ${cards.map(card => html`<${LiveModelPane} key=${card.laneIndex} card=${card} liveCalls=${liveCalls} now=${now}
        done=${done} paused=${paused} theme=${theme} onFullscreen=${onFullscreen} showLiveOutput=${showLiveOutput}/>`)}
    </div>
  </section>`;
}
