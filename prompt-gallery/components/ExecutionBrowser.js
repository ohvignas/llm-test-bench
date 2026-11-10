import {html} from 'htm/preact';
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';
import {secureFetch} from '../../shared/services/secure-session.js';
import {BatchLiveComparison} from './BatchLiveComparison.js';
import {BatchGenerationLog} from './BatchGenerationLog.js';
import {BatchCosts} from './BatchCosts.js';
import {HtmlLightbox} from './BatchReview.js';
import {BenchBadge, BenchIcon, BenchMetric} from './BenchUi.js';
import {costTotals,formatUsd} from '../services/batchCosts.js';
import {executionMetrics,formatDuration} from '../services/executionMetrics.js';
import {recoveryCandidates,comparisonRetryCandidates,recoveryFallback} from '../services/executionRecovery.js';
import {ExecutionRecoveryDialog} from './ExecutionRecoveryDialog.js';
import {executionActive, executionProjects, executionProjectKey, executionStatus, executionCost, executionDuration, executionBatchSnapshot} from '../services/executions.js';

const when=seconds=>new Date(seconds*1000).toLocaleString('fr-FR');
const groupOf=call=>call.context?.groupId || call.context?.runId || 'individuel';

// Reuses the batch's actual comparison, activity, journal and cost components.
// Only the data source changes, so navigating/reloading never starts a call.
export function ExecutionBrowser({view='runs', selectedProject='', onProjectChange, onBrowseSaved, theme='dark',prompts=[]}) {
  const [calls,setCalls]=useState([]), [loaded,setLoaded]=useState(false), [error,setError]=useState('');
  const [revision,setRevision]=useState(0), [pages,setPages]=useState({}), [zoom,setZoom]=useState(-1);
  const [displayMode,setDisplayMode]=useState('split'), [filter,setFilter]=useState('all');
  const [search,setSearch]=useState(''),[statusFilter,setStatusFilter]=useState('all');
  const [recovery,setRecovery]=useState(null);
  const recoveryRevision=useRef(0);
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
  async function prepareRecovery(selected,{restart=false}={}){
    if(!selected.length)return;
    const revision=++recoveryRevision.current;
    setRecovery({loading:true,rows:[],busy:false,restart});
    try{
      const rows=await Promise.all(selected.map(async call=>{
        const fallback=recoveryFallback(call,prompts);
        const response=await secureFetch(`/api/executions/${call.id}/recovery-plan`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fallback,restart})});
        const plan=await response.json();if(!response.ok)throw new Error(plan.error||'Reprise indisponible.');
        return {call,plan,fallback,restart,id:crypto.randomUUID().replaceAll('-','')};
      }));
      if(revision===recoveryRevision.current)setRecovery({loading:false,rows,busy:false,restart});
    }catch(e){if(revision===recoveryRevision.current)setRecovery({loading:false,rows:[],busy:false,restart,error:e.message});}
  }
  async function startRecovery(){
    if(!recovery||recovery.busy)return;
    setRecovery(previous=>({...previous,busy:true,error:''}));
    try{
      const results=await Promise.allSettled(recovery.rows.map(async row=>{
        const response=await secureFetch(`/api/executions/${row.call.id}/recover`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id,confirmed:true,fallback:row.fallback,restart:row.restart})});
        const data=await response.json();if(!response.ok)throw new Error(data.error||'Lancement non confirmé.');
      }));
      setRevision(n=>n+1);
      const failed=results.find(r=>r.status==='rejected');
      if(failed)throw failed.reason;
      const key=executionProjectKey(recovery.rows[0].call);setRecovery(null);select(key);
    }catch(e){setRecovery(previous=>({...previous,busy:false,error:e.message}));}
  }
  const retryIndex=index=>{
    const call=calls.find(c=>c.id===snapshot.runList[index]?.executionId);
    if(call)prepareRecovery([call]);
  };
  const recoveryDialog=recovery&&html`<${ExecutionRecoveryDialog} state=${recovery} onClose=${()=>{recoveryRevision.current++;setRecovery(null);}} onStart=${startRecovery}/>`;
  const history=calls.filter(c=>!executionProjectKey(c)&&!executionActive(c));
  const totals=costTotals(snapshot.costCalls),timing=executionMetrics(snapshot.costCalls,{now:snapshot.now,done:snapshot.done});
  const costLabel=totals.confirmedUsd===null ? snapshot.done?'Non communiqué':'En attente' : formatUsd(totals.confirmedUsd);
  const matched=projects.filter(p=>p.title.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))
    &&(statusFilter!=='active'||p.calls.some(executionActive)))
    .sort((a,b)=>Number(b.calls.some(executionActive))-Number(a.calls.some(executionActive)));
  const stateOf=p=>p.calls.some(executionActive)?{label:'En cours',tone:'active'}:p.calls.some(c=>c.state==='error')?{label:'Échec',tone:'danger'}:p.calls.some(c=>['cancelled','interrupted'].includes(c.state))?{label:'Interrompu',tone:'neutral'}:{label:'Terminé',tone:'success'};
  const renderSearch=()=>html`<label class="bench-search"><${BenchIcon} name="search" size=${17}/><input type="search" aria-label="Rechercher un projet" placeholder="Rechercher un projet…" value=${search} onInput=${e=>setSearch(e.target.value)}/></label>`;
  if(view==='runs')return html`<section class="bench-runs" aria-label="Exécutions des projets">
    <header class="bench-page-header"><div><span class="bench-eyebrow">VOTRE ESPACE DE TEST</span><h1>Exécutions</h1><p>Chaque projet, ses modèles et sa progression. Dès le lancement.</p></div><div class="bench-header-actions"><button class="btn" onClick=${()=>setRevision(n=>n+1)}><${BenchIcon} name="refresh" size=${16}/>Actualiser</button><button class="btn" onClick=${onBrowseSaved}>Ouvrir le dossier</button></div></header>
    <div class="bench-runs-metrics"><${BenchMetric} label="Appels en cours" value=${active.length} note="Connexions actuellement observées" icon="activity"/><${BenchMetric} label="Projets suivis" value=${projects.length} note="Tous les modèles regroupés par projet" icon="layers"/><${BenchMetric} label="Coûts confirmés" value=${executionCost(projects.flatMap(p=>p.calls)).label} note="Montants communiqués par le fournisseur"/></div>
    <div class="bench-list-toolbar">${renderSearch()}<div class="bench-segmented" aria-label="Filtrer les projets"><button class=${statusFilter==='all'?'is-selected':''} aria-pressed=${statusFilter==='all'} onClick=${()=>setStatusFilter('all')}>Tous les projets</button><button class=${statusFilter==='active'?'is-selected':''} aria-pressed=${statusFilter==='active'} onClick=${()=>setStatusFilter('active')}>En cours <span>${projects.filter(p=>p.calls.some(executionActive)).length}</span></button></div></div>
    ${error&&html`<p class="bench-inline-error" role="alert">${error}</p>`}
    <div class="bench-project-grid">${matched.map(project=>{
      const state=stateOf(project),models=[...new Map(project.calls.map(c=>[c.model,c])).values()];
      return html`<article class="bench-project-card" key=${project.key}>
        <div class="bench-project-top"><span class="bench-project-icon"><${BenchIcon} name="layers" size=${20}/></span><${BenchBadge} tone=${state.tone} live=${state.tone==='active'}>${state.label}</${BenchBadge}></div>
        <h2>${project.title}</h2><time>${when(project.started)}</time>
        <ul class="bench-project-models">${models.map(c=>html`<li key=${c.model}><span>${(c.context?.modelLabel||c.model).split(' / ').at(-1).replace(/^(Anthropic|OpenAI|Google):\s*/,'')}</span><small>${executionStatus(c)}</small></li>`)}</ul>
        <div class="bench-project-bottom"><span>${models.length} modèle(s)</span><strong>${executionCost(project.calls).label}</strong></div>
        <button class="btn bench-open-project" onClick=${()=>select(project.key)}>Ouvrir la comparaison<${BenchIcon} name="arrow" size=${16}/></button>
        <button class="btn bench-retry-comparison" disabled=${!comparisonRetryCandidates(project.calls).length} title=${project.calls.some(executionActive)?'Attendez la fin des appels de ce prompt.':'Préparer un nouvel appel pour chaque modèle, y compris ceux qui ont réussi.'} onClick=${()=>prepareRecovery(comparisonRetryCandidates(project.calls),{restart:true})}><${BenchIcon} name="refresh" size=${15}/>Réessayer tout le comparatif</button>
        ${recoveryCandidates(project.calls).length>0&&html`<button class="btn" onClick=${()=>prepareRecovery(recoveryCandidates(project.calls))}><${BenchIcon} name="refresh" size=${15}/>Reprendre / réessayer ${recoveryCandidates(project.calls).length} modèle(s)</button>`}
      </article>`;
    })}</div>
    ${!matched.length&&html`<div class="bench-empty"><${BenchIcon} name="layers" size=${32}/><h2>${loaded?'Aucun projet à afficher':'Chargement des projets…'}</h2><p>${search?'Essayez un autre nom de projet.':'Les projets apparaissent dès le lancement, avant le premier code.'}</p></div>`}
    ${active.filter(c=>!executionProjectKey(c)).map(c=>html`<p key=${c.id}>${c.model} · Appel sans titre conservé · ${executionStatus(c)}</p>`)}
    ${history.length>0&&html`<details class="bench-legacy"><summary>Historique de l’ancienne version · ${history.length} appel(s)</summary>${history.map(c=>html`<div key=${c.id}><span>${c.model}</span><span>${executionStatus(c)}</span><strong>${executionCost([c]).label}</strong></div>`)}</details>`}
    ${recoveryDialog}
  </section>`;
  return html`<section class="bench-workspace" aria-label="Suivi du lot en direct">
    <aside class="bench-project-sidebar"><header><span class="bench-eyebrow">COMPARAISON</span><h2>Vos projets <span>${projects.length}</span></h2></header>${renderSearch()}
      <nav aria-label="Projets du lot">${matched.map(p=>{
        const state=stateOf(p);return html`<button class=${`bench-project-nav ${chosen?.key===p.key?'is-selected':''}`} aria-current=${chosen?.key===p.key?'page':undefined} key=${p.key} onClick=${()=>select(p.key)}><span class="bench-nav-title">${p.title}</span><span class="bench-nav-meta"><${BenchBadge} tone=${state.tone} live=${state.tone==='active'}>${state.label}</${BenchBadge}><small>${new Set(p.calls.map(c=>c.model)).size} modèles</small></span></button>`;
      })}${!matched.length&&html`<p class="bench-sidebar-empty">${loaded?'Aucun projet':'Chargement…'}</p>`}</nav>
      <footer><${BenchIcon} name="activity" size=${16}/><span>${active.length} appel(s) en cours</span><a href="#/runs">Exécutions<${BenchIcon} name="arrow" size=${14}/></a></footer>
    </aside>
    <main class="bench-stage">
      <header class="bench-page-header"><div><span class="bench-eyebrow">COMPARER LES MODÈLES</span><h1>${chosen?.title || 'Comparer en direct'}</h1><p>${chosen?`${new Set(chosen.calls.map(c=>c.model)).size} modèles · ${when(chosen.started)}`:'Vos modèles apparaissent ici dès le lancement.'}</p></div><div class="bench-header-actions"><${BenchBadge} tone=${active.length?'active':'neutral'} live=${active.length>0}>${active.length?'En direct':'Aucun appel actif'}</${BenchBadge}>${chosen&&html`<button class="btn bench-retry-comparison" disabled=${!comparisonRetryCandidates(chosen.calls).length} title=${chosen.calls.some(executionActive)?'Attendez la fin des appels de ce prompt.':'Préparer un nouvel essai pour chacun des modèles de ce prompt.'} onClick=${()=>prepareRecovery(comparisonRetryCandidates(chosen.calls),{restart:true})}><${BenchIcon} name="refresh" size=${15}/>Réessayer tout le comparatif</button>`}<button class="btn" onClick=${onBrowseSaved}>Dossier</button></div></header>
      <label class="bench-mobile-project-picker">Projet<select class="form-input" value=${chosen?.key || ''} onChange=${e=>select(e.target.value)}>${projects.map(p=>html`<option key=${p.key} value=${p.key}>${p.title}</option>`)}</select></label>
      ${error&&html`<p class="bench-inline-error" role="alert">${error}</p>`}
      ${visibleCalls.length?html`<div class="bench-overview"><${BenchMetric} label="Durée du lot" value=${formatDuration(timing.elapsedMs)} icon="clock"/><${BenchMetric} label="Appels API" value=${totals.requestCount} note=${`${snapshot.items.filter(i=>!['generating','queued'].includes(i.status)).length} / ${snapshot.runList.length} terminés`} icon="activity"/><${BenchMetric} label="Coût confirmé du lot" value=${costLabel} note=${totals.missingCosts?`${totals.missingCosts} coût(s) ${snapshot.done?'non communiqué(s)':'en attente'}`:'Tous les coûts reçus'}/></div>
        <div class="bench-view-toolbar"><div class="bench-segmented" aria-label="Affichage de la comparaison">${[['split','screen','Aperçu et code'],['preview','screen','Aperçu'],['code','code','Code'],['activity','activity','Activité'],['journal','journal','Journal']].map(([id,icon,label])=>html`<button class=${displayMode===id?'is-selected':''} aria-pressed=${displayMode===id} key=${id} onClick=${()=>setDisplayMode(id)}><${BenchIcon} name=${icon} size=${15}/>${label}</button>`)}</div><details class="bench-billing"><summary>Détail des coûts</summary><${BatchCosts} calls=${snapshot.costCalls} done=${snapshot.done} startedAt=${snapshot.startedAt}/></details></div>
        ${displayMode==='journal'?html`<${BatchGenerationLog} entries=${snapshot.entries} models=${snapshot.models} calls=${snapshot.liveCalls} startedAt=${snapshot.startedAt} now=${snapshot.now} filter=${filter} onFilterChange=${setFilter} done=${snapshot.done} costCalls=${snapshot.costCalls}/>`:html`<${BatchLiveComparison} ...${snapshot} selectedPromptId=${chosen?.key||''} onPromptChange=${select} paused=${false} theme=${theme} onFullscreen=${setZoom} onStop=${stop} onRetry=${retryIndex} showLiveOutput=${true} hidePromptSelector=${true} displayMode=${displayMode}/>`}`
        :html`<div class="bench-empty"><${BenchIcon} name="screen" size=${36}/><h2>${loaded?'Prêt pour votre prochaine comparaison':'Chargement du lot…'}</h2><p>Lancez un lot. Chaque modèle sera visible ici, même pendant le raisonnement et avant la première page.</p></div>`}
    </main>
    ${zoom>=0&&snapshot.outputs[zoom]&&html`<${HtmlLightbox} html=${snapshot.outputs[zoom]} title=${snapshot.runList[zoom]?.title} onClose=${()=>setZoom(-1)}/>`}
    ${recoveryDialog}
  </section>`;
}
