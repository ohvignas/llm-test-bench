import {html} from 'htm/preact';
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {CellEditor} from '../../shared/components/CellEditor.js';
import {withPreviewStorage} from '../../shared/services/preview-storage.js';
import {liveComparisonCards, liveComparisonPrompts} from '../services/batchLiveComparison.js';
import {batchItemRunning, batchLiveStatus} from '../services/batchLiveProgress.js';
import {costTotals, formatUsd} from '../services/batchCosts.js';
import {executionMetrics, formatDuration} from '../services/executionMetrics.js';
import {BatchActivity} from './BatchActivity.js';
import {BenchBadge, BenchIcon} from './BenchUi.js';
import {generationActivity} from '../services/batchGenerationLog.js';

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

function LiveModelPane({card, liveCalls, entries, now, done, paused, theme, onFullscreen, onRetry, onStop, showLiveOutput, displayMode}) {
  const {model, index, prompt, item, output, calls} = card;
  const active = !done && batchItemRunning(item);
  const live = active ? batchLiveStatus(liveCalls, model, now, calls.map(call => call.telemetryId).filter(Boolean)) : null;
  const status = paused && active ? 'En pause' : live?.label || LABELS[item.status] || 'En attente';
  const costs = costTotals(calls), timing = executionMetrics(calls, {now, done});
  const label = model.label || model.modelId;
  const shortLabel=label.split(' / ').at(-1).replace(/^(Anthropic|OpenAI|Google):\s*/, '');
  const current=calls.toSorted((a,b)=>b.startedAt-a.startedAt)[0];
  const telemetry=liveCalls.find(c=>c.id===current?.telemetryId);
  const signal=telemetry?generationActivity(telemetry,now):null;
  const preview = usePreviewDocument(output, active, index);
  const srcdoc = useMemo(() => preview ? withPreviewStorage(preview) : '', [preview]);
  const cost = costs.confirmedUsd == null ? calls.length ? calls.some(c=>c.status==='pending')?'En attente':'Non communiqué' : 'Aucun appel'
    : formatUsd(costs.confirmedUsd)+(costs.missingCosts?' + en attente':'');
  const tone=item.status==='error'?'danger':active?'active':['saved','verified'].includes(item.status)?'success':'neutral';
  return html`<article class=${`live-model-pane bench-model ${item.status==='error'?'has-error':''}`} aria-label=${`Modèle : ${label}`}>
    <header class="bench-model-head">
      <div class="bench-model-identity"><span class="bench-model-avatar" aria-hidden="true">${shortLabel.slice(0,1)}</span><div><h2 title=${label}>${shortLabel}</h2><small>${model.providerId==='openrouter'?'via OpenRouter':model.providerId}</small></div>
        <${BenchBadge} tone=${tone} live=${active}>${status}</${BenchBadge}>
        ${onStop&&(active||item.status==='queued')&&html`<button class="bench-icon-button is-danger" title="Arrêter cet appel" aria-label="Arrêter cet appel" onClick=${()=>onStop(index)}><${BenchIcon} name="stop" size=${16}/></button>`}
      </div>
      <div class="bench-model-metrics"><span><${BenchIcon} name="clock" size=${14}/>${formatDuration(timing.elapsedMs)}</span><span>${timing.requestCount} appel(s)</span><strong>${cost}</strong></div>
      ${item.stage && html`<small>Étape ${item.stage.index}/${item.stage.total} · ${item.stage.title}</small>`}
      ${item.message&&['error','no_progress','stopped'].includes(item.status)&&html`<p class=${item.status==='stopped'?'bench-inline-notice':'bench-inline-error'}>${item.status==='stopped'&&item.message.startsWith('Appel arrete depuis la CLI')?'Génération arrêtée à votre demande.':item.message}</p>`}
      ${onRetry&&!item.savedIds?.length&&['error','stopped','not-started'].includes(item.status)&&html`<button class="btn btn-sm bench-recover-model" onClick=${()=>onRetry(index)}><${BenchIcon} name="refresh" size=${14}/>${output.trim()?'Reprendre':'Réessayer'}</button>`}
    </header>
    ${displayMode==='activity' ? html`<${BatchActivity} model=${model} index=${index} calls=${calls} liveCalls=${liveCalls} entries=${entries} now=${now} statusLabel=${status}/>` : html`
      <div class="bench-signal" title=${signal?.label || status}><span class=${`bench-live-dot ${active?'':'is-idle'}`}/><span>${signal?.label || status}</span><small>${(telemetry?.reasoningChunks ?? current?.reasoningSignals ?? 0).toLocaleString('fr-FR')} signaux</small></div>
      ${showLiveOutput ? html`
        ${displayMode!=='code'&&html`<div class="bench-preview-toolbar"><span><${BenchIcon} name="screen" size=${15}/>Aperçu ${active?'en direct':'du résultat'}</span><button class="bench-icon-button" title="Plein écran" aria-label="Plein écran" disabled=${!output&&!item.savedIds?.length} onClick=${()=>onFullscreen(index)}><${BenchIcon} name="expand" size=${15}/></button></div>
          ${srcdoc?html`<iframe class="live-model-preview" title=${`Aperçu en direct : ${label}`} sandbox="allow-scripts" srcdoc=${srcdoc}></iframe>`:html`<div class="live-model-empty"><${BenchIcon} name=${active?'activity':'screen'} size=${30}/><strong>${active?'Le modèle prépare sa réponse':item.status==='error'?'Aucun aperçu produit':item.status==='stopped'?'Génération interrompue':'En attente du code'}</strong><span>${active?'Le premier code apparaîtra ici dès sa réception.':item.status==='stopped'?'L’appel est arrêté. Aucun code n’a été reçu.':item.status==='error'?'Consultez l’activité ou le journal pour voir l’erreur.':'Le code conservé s’affichera ici.'}</span></div>`}`}
        ${displayMode!=='preview'&&html`<div class="bench-code-toolbar"><span><${BenchIcon} name="code" size=${15}/>${active?'Code en direct':'Code reçu'}</span><small>${output.length.toLocaleString('fr-FR')} caractères</small></div><${CellEditor} className="live-model-code" value=${output} kind="html" theme=${theme} readOnly=${true} minLines=${displayMode==='code'?26:9} maxLines=${displayMode==='code'?26:9} fontSize=${12} followOutput=${active}/>`}
      `:html`<div class="live-model-empty">Aperçu et code masqués pour cette exécution.</div>`}`}
  </article>`;
}

export function BatchLiveComparison({models, runList, items, outputs, costCalls, liveCalls, entries = [], now, done, paused, theme, onFullscreen, onRetry, onStop, showLiveOutput, selectedPromptId, onPromptChange, displayMode, hidePromptSelector=false}) {
  const [localPromptId, setLocalPromptId] = useState('');
  const [localMode,setLocalMode]=useState('split');
  const promptId=selectedPromptId ?? localPromptId;
  const setPromptId=value=>{setLocalPromptId(value);onPromptChange?.(value);};
  const prompts = useMemo(() => liveComparisonPrompts(runList), [runList]);
  const cards = liveComparisonCards({models, runList, items, outputs, calls:costCalls, promptId});
  const mode=displayMode || localMode;
  return html`<section class=${`batch-live-comparison bench-comparison is-${mode}`} aria-label="Comparaison des modèles en direct">
    ${(!hidePromptSelector||!displayMode)&&html`<div class="live-comparison-options">
      ${!hidePromptSelector&&html`<label>Prompt affiché <select class="form-input" value=${promptId} onChange=${event=>setPromptId(event.target.value)}>${selectedPromptId===undefined&&html`<option value="">Suivre le travail de chaque modèle</option>`}${prompts.map(p=>html`<option key=${p.id} value=${p.id}>${p.title}</option>`)}</select></label>`}
      ${!displayMode&&html`<div class="bench-segmented">${[['split','screen','Aperçu et code'],['activity','activity','Activité']].map(([id,icon,title])=>html`<button class=${localMode===id?'is-selected':''} aria-pressed=${localMode===id} onClick=${()=>setLocalMode(id)}><${BenchIcon} name=${icon} size=${15}/>${title}</button>`)}</div>`}
    </div>`}
    <div class="live-comparison-grid" style=${{'--live-columns':Math.max(1,Math.min(cards.length,3))}}>${cards.map(card=>html`<${LiveModelPane} key=${card.laneIndex} card=${card} liveCalls=${liveCalls} entries=${entries} now=${now} done=${done} paused=${paused} theme=${theme} onFullscreen=${onFullscreen} onRetry=${onRetry} onStop=${onStop} showLiveOutput=${showLiveOutput} displayMode=${mode}/>` )}</div>
  </section>`;
}
