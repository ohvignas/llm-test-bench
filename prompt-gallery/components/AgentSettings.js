import {html} from 'htm/preact';
import {useState,useEffect} from 'preact/hooks';
import {readAgentLimits,saveAgentLimits} from '../services/agentSettings.js';

export function AgentSettings({value,onChange,disabled=false}){
  const [stored,setStored]=useState(readAgentLimits),limits=value||stored;
  useEffect(()=>{const receive=event=>setStored(event.detail);window.addEventListener('bench-agent-limits',receive);return()=>window.removeEventListener('bench-agent-limits',receive);},[]);
  function change(key,number){const next={...limits,[key]:number};setStored(next);saveAgentLimits(next);onChange?.(next);}
  return html`<section class="bench-agent-settings" aria-label="Limites de l’agent Mastra">
    <strong>Agent Mastra · fichiers, outils et construction du projet</strong>
    <div><label>Appels maximum par prompt et modèle<input class="form-input" type="number" min="1" max="16" step="1" value=${limits.maxSteps} disabled=${disabled} onChange=${e=>change('maxSteps',Math.max(1,Math.min(16,Math.round(Number(e.currentTarget.value)||8))))}/></label>
    <label>Budget par prompt et modèle ($US)<input class="form-input" type="number" min="0.01" max="100" step="0.5" value=${limits.budgetUsd} disabled=${disabled} onChange=${e=>change('budgetUsd',Math.max(.01,Math.min(100,Number(e.currentTarget.value)||10)))}/></label></div>
    <p>Chaque étape peut appeler le modèle et être facturée. Ces limites incluent ses corrections. Les outils tournent dans un projet Docker isolé, sans clé API. La construction est vérifiée ; la qualité et toutes les interactions ne sont pas certifiées.</p>
  </section>`;
}
