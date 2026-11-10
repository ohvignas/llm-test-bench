import {html} from 'htm/preact';
import {useEffect,useRef,useState} from 'preact/hooks';
import {secureFetch} from '../../shared/services/secure-session.js';
import {executionActive,executionStatus} from '../services/executions.js';
import {recoveryFallback,reviewRecovery} from '../services/executionRecovery.js';
import {formatUsd} from '../services/batchCosts.js';
import {BenchIcon} from './BenchUi.js';
import {RecoverySettings} from './RecoverySettings.js';

export function ExecutionChat({call,prompts,onClose,onSent}){
  const dialog=useRef(null),pending=useRef(null);
  const [history,setHistory]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [plan,setPlan]=useState(null),[strategy,setStrategy]=useState('original');
  useEffect(()=>{const node=dialog.current,previous=document.activeElement;node.showModal();return()=>{node.close();previous?.focus?.();};},[]);
  useEffect(()=>{
    let live=true,timer;const controller=new AbortController();setPlan(null);
    async function poll(){
      try{
        const response=await secureFetch(`/api/executions/${call.id}/conversation`,{signal:controller.signal,cache:'no-store'});
        const data=await response.json();if(!response.ok)throw new Error(data.error||'Conversation indisponible.');
        if(live){setHistory(data);setError('');}
        const current=data.turns.at(-1);
        if(live&&!executionActive(current)&&current.output_chars>0){
          const prepared=await secureFetch(`/api/executions/${call.id}/recovery-plan`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({restart:true,fallback:recoveryFallback(call,prompts)})});
          const proposal=await prepared.json();if(!prepared.ok)throw new Error(proposal.error||'Réglages indisponibles.');
          if(live){setPlan(proposal);setStrategy(proposal.adaptation?.available?'adapted':'original');}
        }
        if(live&&executionActive(data.turns.at(-1)))timer=setTimeout(poll,1500);
      }catch(e){if(live)setError(e.message);}
    }
    poll();return()=>{live=false;controller.abort();clearTimeout(timer);};
  },[call.id]);
  const current=history?.turns?.at(-1),active=current&&executionActive(current);
  const hasResult=current&&!active&&current.output_chars>0;
  const canSend=hasResult&&!!plan;
  async function send(event){
    event.preventDefault();if(busy||!canSend||!message.trim())return;
    const review=reviewRecovery(plan,strategy),key=JSON.stringify([message.trim(),review]);
    if(!pending.current||pending.current.key!==key)pending.current={id:crypto.randomUUID().replaceAll('-',''),message:message.trim(),key};
    setBusy(true);setError('');
    try{
      const response=await secureFetch(`/api/executions/${call.id}/adjust`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:pending.current.id,message:pending.current.message,confirmed:true,fallback:recoveryFallback(call,prompts),strategy:review.strategy,expected_parameters:review.expected_parameters})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Envoi non confirmé.');
      onSent(data.id);
    }catch(e){setError(e.message);setBusy(false);}
  }
  return html`<dialog ref=${dialog} class="bench-recovery-dialog bench-chat-dialog" aria-labelledby="chat-title" onCancel=${event=>{if(busy)event.preventDefault();else onClose();}}>
    <header><span class="bench-project-icon"><${BenchIcon} name="chat" size=${20}/></span><div><h2 id="chat-title">Chat · ajustements</h2><p>${history?.model_label||call.context?.modelLabel||call.model}</p><p>${history?.title||call.context?.title}</p></div></header>
    <div class="bench-recovery-body">
    <div class="bench-chat-history" aria-label="Conversation conservée">
      ${!history&&html`<p role="status">Chargement de la conversation…</p>`}
      ${history?.truncated&&html`<p>Les 30 dernières versions sont affichées.</p>`}
      ${history?.turns.map(turn=>html`<div key=${turn.id} class="bench-chat-turn">
        ${turn.message&&html`<div class="bench-chat-message is-user"><strong>Vous</strong><p>${turn.message}</p></div>`}
        <div class="bench-chat-message"><strong>${turn.message?'Réponse du modèle':'Création initiale'}</strong><p>${executionStatus(turn)} · ${turn.output_chars.toLocaleString('fr-FR')} caractères de code conservés</p>${Number.isFinite(turn.cost)&&html`<small>Coût confirmé : ${formatUsd(turn.cost)}</small>`}</div>
      </div>`)}
    </div>
    <form id="chat-adjustment-form" class="bench-chat-composer" onSubmit=${send}>
      <label for="chat-message">Demander un ajustement</label>
      <textarea id="chat-message" rows="3" maxlength="12000" placeholder="Ex. : ajoute un menu, corrige les contrôles et conserve le reste du jeu…" value=${message} disabled=${busy||!hasResult} onInput=${event=>setMessage(event.currentTarget.value)}/>
      ${plan&&html`<${RecoverySettings} plan=${plan} strategy=${strategy} busy=${busy} onChange=${setStrategy}/>`}
      <p>${active?'Cet appel est encore en cours. Vous pourrez ajuster le résultat une fois terminé.':!hasResult?'Aucun code disponible à ajuster pour cet appel.':!plan?'Vérification des réglages avant l’envoi… Aucun appel de génération lancé.':'Le code actuel et la conversation sont joints automatiquement. Envoyer déclenche un appel payant au même modèle, avec les réglages affichés. Les versions précédentes restent conservées.'}</p>
      ${error&&html`<p class="bench-inline-error" role="alert">${error}</p>`}
    </form>
    </div>
    <footer class="bench-chat-actions"><button class="btn" type="button" disabled=${busy} onClick=${onClose}>Fermer</button><button class="btn btn-primary" form="chat-adjustment-form" type="submit" disabled=${busy||!canSend||!message.trim()}>${busy?'Envoi…':'Envoyer l’ajustement · appel payant'}</button></footer>
  </dialog>`;
}
