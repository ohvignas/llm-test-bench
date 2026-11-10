import {html} from 'htm/preact';
import {useEffect, useMemo, useState} from 'preact/hooks';
import {secureFetch} from '../../shared/services/secure-session.js';
import {BatchLiveComparison} from './BatchLiveComparison.js';
import {BatchGenerationLog} from './BatchGenerationLog.js';
import {BatchCosts} from './BatchCosts.js';
import {HtmlLightbox} from './BatchReview.js';
import {executionActive, executionProjects, executionProjectKey, executionStatus, executionCost, executionDuration, executionBatchSnapshot} from '../services/executions.js';

const when=seconds=>new Date(seconds*1000).toLocaleString('fr-FR');
const groupOf=call=>call.context?.groupId || call.context?.runId || 'individuel';

// Reuses the batch's actual comparison, activity, journal and cost components.
// Only the data source changes, so navigating/reloading never starts a call.
export function ExecutionBrowser({view='runs', selectedProject='', onProjectChange, onBrowseSaved, theme='dark'}) {
  const [calls,setCalls]=useState([]), [loaded,setLoaded]=useState(false), [error,setError]=useState('');
  const [revision,setRevision]=useState(0), [pages,setPages]=useState({}), [zoom,setZoom]=useState(-1);
  const [journal,setJournal]=useState(false), [filter,setFilter]=useState('all');
  useEffect(()=>{
    let live=true,timer;const controller=new AbortController();
    async function poll(){
      try {
        const response=await secureFetch('/api/executions?limit=500',{signal:controller.signal,cache:'no-store'});
        if(!response.ok)throw new Error('Impossible de lire les exécutions du serveur.');
        const data=await response.json();
        if(live){setCalls(data.calls || []);setLoaded(true);setError('');}
      }catch(e){if(live){setError(e.message);setLoaded(true);}}
      if(live)timer=setTimeout(poll,1500);
    }
    poll();return()=>{live=false;controller.abort();clearTimeout(timer);};
  },[revision]);
  const projects=useMemo(()=>executionProjects(calls),[calls]);
  const active=calls.filter(executionActive);
  const chosen=projects.find(p=>p.key===selectedProject) || projects.find(p=>p.calls.some(executionActive)) || projects[0];
  const group=chosen ? groupOf(chosen.calls[0]) : null;
  const groupProjects=projects.filter(p=>groupOf(p.calls[0])===group);
  const visibleCalls=view==='compare'
    ? calls.filter(c=>group!==null ? groupOf(c)===group && executionProjectKey(c) : executionActive(c)) : [];
  const detailIds=visibleCalls.filter(c=>c.durable && (!chosen || executionProjectKey(c)===chosen.key)).map(c=>c.id).sort().join(',');
  useEffect(()=>{
    if(!detailIds)return;
    let live=true,timer;const controller=new AbortController();
    async function poll(){
      try {
        const rows=await Promise.all(detailIds.split(',').map(async id=>{
          const response=await secureFetch(`/api/executions/${id}`,{signal:controller.signal,cache:'no-store'});
          if(!response.ok)throw new Error('Lecture du code interrompue ; le serveur conserve le résultat.');
          return response.json();
        }));
        if(live)setPages(previous=>({...previous,...Object.fromEntries(rows.map(r=>[r.id,r.output || '']))}));
        if(live && rows.some(executionActive))timer=setTimeout(poll,1500);
      }catch(e){if(live){setError(e.message);timer=setTimeout(poll,3000);}}
    }
    poll();return()=>{live=false;controller.abort();clearTimeout(timer);};
  },[detailIds]);
  const snapshot=executionBatchSnapshot(visibleCalls.map(c=>({...c,output:pages[c.id] || ''})));
  const select=key=>{setZoom(-1);setFilter('all');onProjectChange ? onProjectChange(key) : (window.location.hash='#/compare/'+encodeURIComponent(key));};
  async function stop(index){
    const call=snapshot.runList[index];if(!call)return;
    try {
      const response=await secureFetch(`/api/executions/${call.executionId}/stop`,{method:'POST'});
      if(!response.ok)throw new Error('Arrêt non confirmé.');
      setRevision(n=>n+1);
    }catch(e){setError(e.message);}
  }
  const history=calls.filter(c=>!executionProjectKey(c)&&!executionActive(c));
  if(view==='runs')return html`<div class="runs-view">
    <div class="runs-toolbar"><div class="runs-intro"><i class="fa-solid fa-layer-group"></i><strong>Exécutions</strong><span>${active.length} appel(s) en cours · ${projects.length} projet(s)</span></div>
      <div class="runs-actions"><button class="btn btn-sm" onClick=${()=>setRevision(n=>n+1)}>Actualiser</button><button class="btn btn-sm" onClick=${onBrowseSaved}>Résultats enregistrés dans le dossier</button></div></div>
    ${error && html`<p class="live-model-error" role="alert">${error}</p>`}
    <div class="runs-list">${projects.map(project=>{
      const running=project.calls.filter(executionActive), failed=project.calls.filter(c=>c.state==='error');
      return html`<div class="runs-row execution-project-row" key=${project.key}>
        <button class="runs-row-open" onClick=${()=>select(project.key)}>
          <i class=${`fa-solid ${running.length?'fa-bolt':failed.length?'fa-triangle-exclamation':'fa-layer-group'} runs-row-icon`}></i>
          <span class="runs-row-model">${project.title}<small>${new Set(project.calls.map(c=>c.model)).size} modèle(s) · ${running.length} en cours · ${failed.length} échec(s)</small></span>
          <span class="runs-row-when">${when(project.started)}</span><span class="runs-row-meta">${executionCost(project.calls).label} <i class="fa-solid fa-chevron-right"></i></span>
        </button>
      </div>`;
    })}
    ${active.filter(c=>!executionProjectKey(c)).map(c=>html`<div class="runs-row" key=${c.id}><span class="runs-row-open"><strong>${c.model}</strong> · Appel ancien — titre non conservé · ${executionStatus(c)} · ${executionDuration(c.duration_seconds)}</span></div>`)}
    ${!projects.length && !active.length && html`<div class="runs-empty"><p>${loaded?'Aucun projet en cours. Les projets apparaissent ici dès le lancement du lot, avant la première page.':'Chargement des exécutions…'}</p></div>`}</div>
    ${history.length>0 && html`<details class="execution-legacy-history"><summary>Historique antérieur · ${history.length} appel(s)</summary>${history.map(c=>html`<div class="runs-row" key=${c.id}><div class="runs-row-open"><span class="runs-row-model">${c.model}<small>Titre et code non conservés par l’ancienne version · ${when(c.started)}</small></span><span>${executionStatus(c)} · ${executionCost([c]).label}</span></div></div>`)}</details>`}
  </div>`;
  return html`<section class="batch-live-workspace" aria-label="Suivi du lot en direct">
    <header class="batch-live-header"><div><h2>Comparer en direct</h2><p>${active.length} appel(s) en cours · ${projects.length} projet(s) · ${snapshot.items.filter(i=>i.status!=='generating'&&i.status!=='queued').length} / ${snapshot.runList.length} terminé(s) dans ce lot</p></div>
      <div class="batch-window-actions"><button class="btn" onClick=${()=>setJournal(v=>!v)}>${journal?'Aperçu et code':'Journal et détails du lot'}</button><button class="btn" onClick=${onBrowseSaved}>Résultats du dossier</button></div></header>
    ${error && html`<p class="live-model-error" role="alert">${error}</p>`}
    ${projects.length>0 && html`<nav class="execution-project-tabs" aria-label="Projets du lot">${groupProjects.map(p=>html`<button class=${`btn ${chosen?.key===p.key?'btn-primary':''}`} aria-pressed=${chosen?.key===p.key} key=${p.key} onClick=${()=>select(p.key)}>${p.title}<small>${p.calls.filter(executionActive).length} en cours · ${executionCost(p.calls).label}</small></button>`)}
      ${projects.length>groupProjects.length && html`<label>Autres lots <select class="form-input" value=${chosen?.key} onChange=${e=>select(e.target.value)}>${projects.map(p=>html`<option value=${p.key} key=${p.key}>${p.title} · ${when(p.started)}</option>`)}</select></label>`}</nav>`}
    ${visibleCalls.length ? html`<${BatchCosts} calls=${snapshot.costCalls} done=${snapshot.done} startedAt=${snapshot.startedAt}/>
      ${journal?html`<${BatchGenerationLog} entries=${snapshot.entries} models=${snapshot.models} calls=${snapshot.liveCalls} startedAt=${snapshot.startedAt} now=${snapshot.now} filter=${filter} onFilterChange=${setFilter} done=${snapshot.done} costCalls=${snapshot.costCalls}/>`
        :html`<${BatchLiveComparison} ...${snapshot} selectedPromptId=${chosen?.key || ''} onPromptChange=${select} paused=${false} theme=${theme} onFullscreen=${setZoom} onStop=${stop} showLiveOutput=${true}/>`}`
      :html`<div class="runs-empty"><i class="fa-solid fa-table-columns"></i><p>${loaded?'Aucune génération en cours. Dès le lancement d’un lot, les modèles apparaîtront ici, même avec zéro caractère reçu.':'Chargement du lot…'}</p></div>`}
    ${zoom>=0 && snapshot.outputs[zoom] && html`<${HtmlLightbox} html=${snapshot.outputs[zoom]} title=${snapshot.runList[zoom]?.title} onClose=${()=>setZoom(-1)}/>`}
  </section>`;
}
