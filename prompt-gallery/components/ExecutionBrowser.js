import { html } from 'htm/preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { secureMode, secureFetch } from '../../shared/services/secure-session.js';
import { HtmlLive, HtmlLightbox } from './BatchReview.js';
import { executionActive, executionProjects, executionProjectKey, executionStatus, executionCost, executionDuration } from '../services/executions.js';

const when = seconds => new Date(seconds*1000).toLocaleString('fr-FR');
const model = call => call.context?.modelLabel || call.model;

function ExecutionPane({ call, attempts }) {
  const [snapshot,setSnapshot] = useState(null);
  const [error,setError] = useState('');
  const [zoom,setZoom] = useState(false);
  const [stopping,setStopping] = useState(false);
  useEffect(() => {
    let live=true, timer;
    const controller=new AbortController();
    setSnapshot(null); setError(''); setStopping(false);
    async function poll() {
      try {
        const response=await secureFetch(`/api/executions/${call.id}`,{signal:controller.signal,cache:'no-store'});
        if (!response.ok) throw new Error('Impossible de charger le résultat conservé.');
        const data=await response.json();
        if (live) { setSnapshot(data); setError(''); }
        if (live && executionActive(data)) timer=setTimeout(poll,2000);
      } catch (e) { if (live) {setError(e.message);timer=setTimeout(poll,5000);} }
    }
    poll();
    return ()=>{live=false;controller.abort();clearTimeout(timer);};
  },[call.id]);
  const data=snapshot || call;
  const output=snapshot?.output || '';
  const costs=executionCost(attempts);
  async function stop() {
    setStopping(true);
    try {
      const response=await secureFetch(`/api/executions/${call.id}/stop`,{method:'POST'});
      if (!response.ok) throw new Error('Arrêt non confirmé ; réessayez.');
    } catch(e) {setError(e.message);setStopping(false);}
  }
  return html`<article class=${`execution-pane ${data.state==='error'?'is-error':''}`}>
    <header><strong>${model(data)}</strong><span>${executionStatus(data)}</span>
      <div>${executionDuration(data.duration_seconds)} · ${costs.count} appel(s) · ${costs.label}</div>
      ${executionActive(data) && html`<small>Dernier signal : il y a ${Math.floor(data.last_signal_seconds || 0)} s · ${data.output_chars.toLocaleString('fr-FR')} caractères reçus</small>`}
      ${data.error?.message && html`<p class="execution-error">${data.error.message}</p>`}
      ${error && html`<p class="execution-error" role="alert">${error}</p>`}
      ${executionActive(data) && html`<button class="btn btn-sm" onClick=${stop} disabled=${stopping}>${stopping?'Arrêt demandé…':'Arrêter cet appel'}</button>`}
    </header>
    ${data.summary && html`<details><summary>Résumé transmis par le fournisseur</summary><p class="execution-summary-text">${data.summary}</p></details>`}
    <div class="execution-preview-head"><strong>Aperçu du résultat</strong>
      ${output && html`<button class="btn btn-sm" onClick=${()=>setZoom(true)}>Plein écran</button>`}</div>
    <div class="execution-preview">${output
      ? html`<${HtmlLive} html=${output} />`
      : html`<p>${executionActive(data)?'En attente du premier code.':'Aucun code conservé pour cet appel.'}</p>`}</div>
    ${output && data.state!=='ok' && html`<p class="execution-note">Code partiel conservé. L’aperçu peut être incomplet.</p>`}
    <details class="execution-code"><summary>Code reçu · ${data.output_chars.toLocaleString('fr-FR')} caractères</summary><pre>${output || 'Aucun code reçu.'}</pre></details>
    ${attempts.length>1 && html`<details><summary>${attempts.length} tentatives conservées</summary>${attempts.map(a=>html`<p key=${a.id}>${when(a.started)} · ${executionStatus(a)} · ${executionCost([a]).label}</p>`)}</details>`}
    ${zoom && html`<${HtmlLightbox} html=${output} title=${call.context.title} subtitle=${model(call)} onClose=${()=>setZoom(false)} />`}
  </article>`;
}

export function ExecutionBrowser({ view='runs', selectedProject='', onProjectChange }) {
  const enabled=secureMode();
  const [calls,setCalls]=useState([]);
  const [error,setError]=useState('');
  const [loaded,setLoaded]=useState(false);
  const [revision,setRevision]=useState(0);
  useEffect(()=>{
    if (!enabled) return;
    let live=true,timer;
    const controller=new AbortController();
    async function poll() {
      try {
        const response=await secureFetch('/api/executions?limit=200',{signal:controller.signal,cache:'no-store'});
        if (!response.ok) throw new Error('Historique serveur indisponible.');
        const data=await response.json();
        if(live) {setCalls(data.calls || []);setError('');setLoaded(true);}
      } catch(e) {if(live) {setError(e.message);setLoaded(true);}}
      if(live) timer=setTimeout(poll,3000);
    }
    poll();return()=>{live=false;controller.abort();clearTimeout(timer);};
  },[enabled,revision]);
  const projects=useMemo(()=>executionProjects(calls),[calls]);
  const project=projects.find(p=>p.key===selectedProject);
  const active=calls.filter(executionActive).length;
  const select=key=>onProjectChange ? onProjectChange(key) : (window.location.hash='#/compare/'+encodeURIComponent(key));
  if(!enabled) return null;
  if(view==='compare' && selectedProject) {
    const models=new Map();
    for (const call of project?.calls || []) {
      if(!models.has(call.model)) models.set(call.model,[]);
      models.get(call.model).push(call);
    }
    return html`<section class="execution-browser">
      <div class="execution-heading"><button class="btn" onClick=${()=>onProjectChange?.('')}>← Tous les prompts</button>
        <h2>${project?.title || 'Comparaison'}</h2></div>
      <p class="execution-note">Les appels déjà démarrés continuent sur le serveur après un rechargement. Le code reçu est conservé automatiquement.</p>
      ${error && html`<p class="execution-error" role="alert">${error}</p>`}
      ${!project ? html`<p>${loaded?'Ce projet ne figure pas dans les 200 appels les plus récents.':'Chargement…'}</p>`
        : html`<div class="execution-panes">${[...models.values()].map(attempts=>html`<${ExecutionPane} key=${attempts[0].id} call=${attempts[0]} attempts=${attempts} />`)}</div>`}
    </section>`;
  }
  return html`<section class="execution-browser">
    <div class="execution-heading"><h2>${view==='compare'?'Projets à comparer':'Exécutions suivies sur le serveur'}</h2>
      <span>${active} en cours · ${view==='compare'?projects.length+' prompt(s)':calls.length+' appel(s)'}</span>
      <button class="btn btn-sm" onClick=${()=>setRevision(n=>n+1)}>Actualiser</button></div>
    ${error && html`<p class="execution-error" role="alert">${error}</p>`}
    ${!loaded && html`<p>Chargement de l’historique…</p>`}
    ${view==='compare'
      ? html`<p class="execution-note">Choisissez un prompt pour afficher les modèles côte à côte, y compris ceux en cours ou en échec.</p>
        <div class="execution-projects">${projects.map(p=>html`<button class="execution-project" key=${p.key} onClick=${()=>select(p.key)}>
          <strong>${p.title}</strong><span>${new Set(p.calls.map(c=>c.model)).size} modèle(s) · ${p.calls.filter(executionActive).length} en cours</span>
          <span>${executionCost(p.calls).label}</span><small>${when(p.started)}</small><b>Comparer les modèles →</b></button>`)}</div>
        ${loaded&&!projects.length && html`<p>Aucun projet identifié sur le serveur pour le moment. Les prochains lots apparaîtront ici dès leur lancement.</p>`}
        ${calls.some(c=>!executionProjectKey(c)) && html`<p class="execution-note">Les anciens appels ne contiennent pas le titre du prompt. Ils restent consultables dans <a href="#/runs">Exécutions</a> ; aucun résultat n’est attribué à un projet au hasard.</p>`}`
      : html`<div class="execution-table-wrap"><table class="execution-table"><thead><tr><th>Prompt / modèle</th><th>Statut</th><th>Durée</th><th>Coût confirmé</th><th>Résultat</th></tr></thead>
          <tbody>${calls.map(c=>html`<tr key=${c.id}>
            <td><strong>${c.context?.title || 'Prompt non enregistré — ancien appel'}</strong><span>${model(c)}</span><small>${when(c.started)}</small></td>
            <td>${executionStatus(c)}${c.error?.message && html`<small class="execution-error">${c.error.message}</small>`}</td>
            <td>${executionDuration(c.duration_seconds)}</td><td>${executionCost([c]).label}</td>
            <td>${executionProjectKey(c) ? html`<button class="btn btn-sm" onClick=${()=>select(executionProjectKey(c))}>Voir / comparer</button>`
              : html`<span>${c.output_chars ? `${c.output_chars.toLocaleString('fr-FR')} caractères reçus, code non conservé`:'Aucun code conservé'}</span>`}</td>
          </tr>`)}</tbody></table></div>
        ${loaded&&!calls.length&&html`<p>Aucun appel enregistré sur le serveur.</p>`}`}
  </section>`;
}
