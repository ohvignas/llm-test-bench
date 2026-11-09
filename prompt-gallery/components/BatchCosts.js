import {html} from 'htm/preact';
import {costTotals,formatUsd} from '../services/batchCosts.js';
const ROLES={generate:'Génération',heal:'Correction',audit:'Audit',repair:'Réparation'};
export function BatchCosts({calls,done=false}) {
  const total=costTotals(calls);
  return html`<section class="batch-costs" aria-label="Coûts des appels API">
    <div class="batch-cost-total" role="status" aria-live="polite"><strong>Total confirmé : ${total.confirmedUsd==null&&done?'Coût non communiqué':formatUsd(total.confirmedUsd)}</strong>
      <span>${calls.length} appel(s) · ${total.missingCosts ? `${total.missingCosts} coût(s) ${done?'non communiqué(s)':'en attente'}` : calls.length?'tous les coûts reçus':'aucun appel lancé'}</span></div>
    <p>Montants en dollars US communiqués par l’API, généralement à la fin de chaque appel. Le cumul se met à jour à leur réception. Les échecs facturés sont inclus ; un montant manquant ne vaut pas zéro.</p>
    ${calls.length>0 && html`<details><summary>Détail de chaque appel</summary><ul>${calls.map(call=>html`<li key=${call.id}>
      <span>${call.modelLabel} · ${call.promptTitle} · ${ROLES[call.role]||call.role}</span>
      <strong>${Number.isFinite(call.usd)?formatUsd(call.usd):call.status==='pending'?'Coût en attente':'Coût non communiqué'}</strong>
      <span>${call.status==='pending'?'En cours':call.status==='error'?'Échec':call.status==='cancelled'?'Annulé':'Terminé'}</span>
    </li>`)}</ul></details>`}
  </section>`;
}
