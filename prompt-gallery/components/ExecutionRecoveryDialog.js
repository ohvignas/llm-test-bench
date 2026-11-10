import {html} from 'htm/preact';
import {useEffect,useRef} from 'preact/hooks';
import {BenchIcon} from './BenchUi.js';
import {RecoverySettings} from './RecoverySettings.js';

export function ExecutionRecoveryDialog({state,onClose,onStart,onStrategyChange}){
  const dialog=useRef(null);
  useEffect(()=>{const node=dialog.current;const previous=document.activeElement;node?.showModal();return()=>{node?.close();previous?.focus?.();};},[]);
  return html`<dialog ref=${dialog} class="bench-recovery-dialog" onCancel=${e=>{if(state.busy)e.preventDefault();else onClose();}} aria-labelledby="recovery-title">
    <header><span class="bench-project-icon"><${BenchIcon} name="refresh" size=${20}/></span><div><h2 id="recovery-title">${state.restart?'Réessayer tout le comparatif':state.rows?.some(r=>r.plan.mode==='continue')?'Reprendre le code conservé':'Préparer un nouvel essai'}</h2><p>${state.restart?'Le prompt complet sera relancé sur chacun de ses modèles, y compris ceux qui ont réussi. Les résultats précédents restent conservés.':'Un nouvel appel par modèle sélectionné. Les précédentes tentatives restent conservées.'}</p></div></header>
    <div class="bench-recovery-body">
    ${state.loading?html`<p role="status">Préparation de la reprise… Aucun appel de génération envoyé.</p>`:html`<ul>${state.rows.map(row=>html`<li key=${row.call.id}><strong>${row.plan.model_label}</strong><span>${row.plan.title}</span><p>${row.plan.mode==='restart'?'Nouvelle génération du prompt complet. Le résultat précédent reste intact. Vérifiez les réglages ci-dessous.':row.plan.mode==='continue'?`Continuer après les ${row.plan.output_chars.toLocaleString('fr-FR')} caractères sauvegardés. Le code original reste intact.`:'Aucun code reçu : un nouvel essai est nécessaire. La réflexion interne interrompue ne peut pas être restaurée.'}</p><${RecoverySettings} plan=${row.plan} strategy=${row.strategy} busy=${state.busy} onChange=${value=>onStrategyChange?.(row.call.id,value)}/>${!row.plan.request_saved&&html`<small>Ancien appel : consigne retrouvée dans la bibliothèque actuelle ; elle peut avoir changé.</small>`}</li>`)}</ul>
      <p class="bench-recovery-cost">Ce nouvel appel est payant. Son coût sera celui communiqué par OpenRouter ; il s’ajoutera aux tentatives précédentes.</p>`}
    ${state.error&&html`<p class="bench-inline-error" role="alert">${state.error}</p>`}
    </div>
    <footer><button class="btn" disabled=${state.busy} onClick=${onClose}>Annuler</button><button class="btn btn-primary" disabled=${state.loading||state.busy||!state.rows?.length} onClick=${onStart}>${state.busy?'Lancement…':`Confirmer ${state.rows?.length||0} nouvel${state.rows?.length>1?'s':''} appel${state.rows?.length>1?'s':''} payant${state.rows?.length>1?'s':''}`}</button></footer>
  </dialog>`;
}
