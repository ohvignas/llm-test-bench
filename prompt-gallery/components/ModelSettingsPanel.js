import {html} from 'htm/preact';
export function ModelSettingsPanel({reports,loading,error,onRefresh,onOverride,onReset}) {
 return html`<section class="model-settings-panel" aria-label="Réglages adaptés aux modèles">
  <div class="model-settings-head"><strong>Réglages effectifs par modèle</strong><button class="btn btn-sm" disabled=${loading} onClick=${onRefresh}>${loading?'Lecture de l’API…':'Actualiser les capacités API'}</button><button class="btn btn-sm" onClick=${onReset}>Réinitialiser les personnalisations</button></div>
  ${error&&html`<p class="model-settings-error">${error}</p>`}
  ${reports.map(({model,settings,error,isOpenRouter})=>html`<div class="model-settings-row" key=${model.providerId+model.modelId}>
   <strong>${model.label||model.modelId}</strong>
   ${!isOpenRouter?html`<p>Réglages natifs de ce fournisseur ; capacités OpenRouter non applicables.</p>`:error?html`<p class="model-settings-error">${error}</p>`:html`
    <p>API consultée le ${new Date(settings.fetchedAt).toLocaleString('fr-FR')} · Contexte : ${settings.contextLength?.toLocaleString('fr-FR')||'non communiqué'} · Sortie maximale : ${settings.maxOutputTokens?.toLocaleString('fr-FR')||'non communiquée'} tokens</p>
    <div class="model-settings-controls"><label>Sortie par appel (raisonnement compris)<input class="form-input" type="number" min="1" max=${settings.maxOutputTokens||undefined} value=${settings.params.max_tokens??settings.params.max_completion_tokens} onInput=${e=>{const totalTokens=Number(e.target.value);if(Number.isSafeInteger(totalTokens)&&totalTokens>0)onOverride(model,{profile:'manual',totalTokens,reasoningEffort:settings.params.reasoning?.effort||settings.params.reasoning_effort});}}/></label>
    ${settings.supportedEfforts.length>0?html`<label>Effort ${settings.mandatoryReasoning?'(raisonnement obligatoire)':''}<select class="form-input" value=${settings.params.reasoning?.effort||settings.params.reasoning_effort||''} onChange=${e=>onOverride(model,{profile:'manual',reasoningEffort:e.target.value,totalTokens:settings.params.max_tokens??settings.params.max_completion_tokens})}>
      ${settings.supportedEfforts.filter(e=>!settings.mandatoryReasoning||e!=='none').map(e=>html`<option value=${e} key=${e}>${({max:'Maximal',xhigh:'Très élevé',high:'Élevé',medium:'Moyen',low:'Faible',minimal:'Minimal',none:'Désactivé'})[e]||e}</option>`)}</select></label>`:html`<span>${settings.params.reasoning?.max_tokens?`Budget de raisonnement demandé : ${settings.params.reasoning.max_tokens} tokens`:'Raisonnement : contrôle non annoncé par l’API'}</span>`}</div>
    ${settings.adjustments.map(note=>html`<p class="model-settings-note">${note}</p>`)}
    <details><summary>Paramètres qui seront envoyés</summary><pre>${JSON.stringify(settings.params,null,2)}</pre><p>Paramètres acceptés par l’API : ${settings.supportedParameters.join(', ')}</p>${Object.keys(settings.defaultParameters).length>0&&html`<p>Valeurs par défaut annoncées : ${JSON.stringify(settings.defaultParameters)}</p>`}</details>
   `}
  </div>`)}
 </section>`;
}
