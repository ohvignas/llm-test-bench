import {html} from 'htm/preact';
import {costTotals,formatUsd} from '../services/batchCosts.js';
import {ExecutionSummary} from './ExecutionSummary.js';
import {executionMetrics,formatDuration} from '../services/executionMetrics.js';
const ROLES={generate:'Génération',heal:'Correction',audit:'Audit',repair:'Réparation',suggest:'Suggestions',improve:'Amélioration'};
export function BatchCosts({calls,done=false,startedAt,finishedAt}) {
  const total=costTotals(calls);
  const requestCount=total.requestCount ?? total.calls.length;
  const blockedCalls=total.blockedCalls ?? 0;
  return html`<section class="batch-costs" aria-label="Coûts des appels API">
    <${ExecutionSummary} calls=${calls} done=${done} startedAt=${startedAt} finishedAt=${finishedAt} />
    <div class="batch-cost-total" role="status" aria-live="polite"><strong>${!requestCount ? 'Aucun appel envoyé' : `Total confirmé : ${total.confirmedUsd==null&&done?'Coût non communiqué':formatUsd(total.confirmedUsd)}`}</strong>
      <span>${requestCount} appel(s)${blockedCalls ? ` · ${blockedCalls} tentative(s) bloquée(s)` : ''} · ${total.missingCosts ? `${total.missingCosts} coût(s) ${done?'non communiqué(s)':'en attente'}` : requestCount?'tous les coûts reçus':'aucun appel lancé'}</span></div>
    <p>Montants en dollars US communiqués par l’API, généralement à la fin de chaque appel. Le cumul se met à jour à leur réception. Les échecs facturés sont inclus ; un montant manquant ne vaut pas zéro.</p>
    ${total.calls.length>0 && html`<details><summary>Détail de chaque appel</summary><ul>${total.calls.map(call=>html`<li key=${call.id}>
      <span>${call.modelLabel} · ${call.promptTitle} · ${ROLES[call.role]||call.role}${call.stage ? ` · Étape ${call.stage.index}/${call.stage.total} : ${call.stage.title}` : ''}</span>
      <strong>${call.requestSent===false?'Aucun appel envoyé':Number.isFinite(call.usd)?formatUsd(call.usd):call.status==='pending'?'Coût en attente':'Coût non communiqué'}</strong>
      <span>${call.status==='blocked'?'Bloqué':call.status==='pending'?'En cours':call.status==='error'?'Échec':call.status==='cancelled'?'Annulé':'Terminé'} · ${formatDuration(executionMetrics([call],{done}).elapsedMs)}</span>
    </li>`)}</ul></details>`}
  </section>`;
}
