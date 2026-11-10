import {html} from 'htm/preact';
import {useEffect, useState} from 'preact/hooks';
import {executionMetrics, formatDuration} from '../services/executionMetrics.js';

export function ExecutionSummary({calls = [], done = true, startedAt, finishedAt, compact = false, known = true}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (done) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [done, startedAt]);
  const metrics = executionMetrics(calls, {now, done, startedAt, finishedAt});
  const duration = known ? formatDuration(metrics.elapsedMs) : 'Non mesurée';
  const count = known ? metrics.requestCount : 'Non enregistré';
  if (compact) return html`<div class="execution-summary-compact" aria-label="Durée et appels API">Durée des appels : <strong>${duration}</strong> · <strong>${count}</strong> appel(s) API</div>`;
  return html`<section class="execution-summary" aria-label="Temps d’exécution et appels API">
    <div class="execution-summary-totals"><span>${startedAt != null ? 'Durée totale du lot' : 'Durée des appels'} : <strong>${duration}</strong></span><span>Appels API : <strong>${count}</strong></span></div>
    ${metrics.models.length > 1 && html`<ul>${metrics.models.map(model => html`<li key=${model.key}><span>${model.label}</span><strong>${formatDuration(model.elapsedMs)} · ${model.requestCount} appel(s)</strong></li>`)}</ul>`}
    ${startedAt != null && html`<small>Temps écoulé, pauses et vérifications comprises. Les appels simultanés ne sont pas additionnés.</small>`}
  </section>`;
}
