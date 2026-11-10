import {html} from 'htm/preact';
import {reviewRecovery} from '../services/executionRecovery.js';

export function RecoverySettings({plan,strategy,busy,onChange}){
  const review=reviewRecovery(plan,strategy),adaptation=plan.adaptation;
  return html`<div class="bench-recovery-settings">
    ${adaptation&&html`<p class="bench-recovery-risk">${adaptation.reason}</p>`}
    ${adaptation?.available&&html`<label class="bench-recovery-strategy">Réglages de reprise
      <select class="form-input" value=${review.strategy} disabled=${busy} onChange=${event=>onChange?.(event.currentTarget.value)}>
        <option value="adapted">Adaptés après l’échec · recommandé</option>
        <option value="original">Réglages d’origine · risque d’échec répété</option>
      </select></label>`}
    <small>Plafond total : ${review.maxTokens?.toLocaleString('fr-FR')||'réglage d’origine'} tokens · ${review.reasoningTokens?`Réflexion : ${review.reasoningTokens.toLocaleString('fr-FR')} tokens`:`Effort : ${review.effort||'réglage d’origine'}`}</small>
    ${adaptation?.available&&review.strategy==='original'&&html`<p class="bench-recovery-risk">Vous conservez volontairement les réglages qui ont échoué. Un nouvel échec peut être facturé.</p>`}
  </div>`;
}
