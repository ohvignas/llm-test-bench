import {html} from 'htm/preact';
import {useEffect,useRef,useState} from 'preact/hooks';
import {secureFetch} from '../../shared/services/secure-session.js';
import {executionActive,executionStatus} from '../services/executions.js';
import {recoveryFallback} from '../services/executionRecovery.js';
import {formatUsd} from '../services/batchCosts.js';
import {BenchIcon} from './BenchUi.js';

export function ExecutionChat({call,prompts,onClose,onSent}){
  const dialog=useRef(null),pending=useRef(null);
  const [history,setHistory]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const node=dialog.current,previous=document.activeElement;node.showModal();return()=>{node.close();previous?.focus?.();};},[]);
  useEffect(()=>{
    let live=true,timer;const controller=new AbortController();
    async function poll(){
      try{
        const response=await secureFetch(`/api/executions/${call.id}/conversation`,{signal:controller.signal,cache:'no-store'});
        const data=await response.json();if(!response.ok)throw new Error(data.error||'Conversation indisponible.');
        if(live){setHistory(data);setError('');}
        if(live&&executionActive(data.turns.at(-1)))timer=setTimeout(poll,1500);
      }catch(e){if(live)setError(e.message);}
    }
    poll();return()=>{live=false;controller.abort();clearTimeout(timer);};
  },[call.id]);
  const current=history?.turns?.at(-1),active=current&&executionActive(current);
  const canSend=current&&!active&&current.output_chars>0;
  async function send(event){
    event.preventDefault();if(busy||!canSend||!message.trim())return;
    if(!pending.current||pending.current.message!==message.trim())pending.current={id:crypto.randomUUID().replaceAll('-',''),message:message.trim()};
    setBusy(true);setError('');
    try{
      const response=await secureFetch(`/api/executions/${call.id}/adjust`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...pending.current,confirmed:true,fallback:recoveryFallback(call,prompts)})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Envoi non confirmé.');
      onSent(data.id);
    }catch(e){setError(e.message);setBusy(false);}
  }
  return html`<dialog ref=${dialog} class="bench-recovery-dialog bench-chat-dialog" aria-labelledby="chat-title" onCancel=${event=>{if(busy)event.preventDefault();else onClose();}}>
    <header><span class="bench-project-icon"><${BenchIcon} name="chat" size=${20}/></span><div><h2 id="chat-title">Chat · ajustements</h2><p>${history?.model_label||call.context?.modelLabel||call.model}</p><p>${history?.title||call.context?.title}</p></div></header>
    <div class="bench-recovery-body bench-chat-history" aria-label="Conversation conservée">
      ${!history&&html`<p role="status">Chargement de la conversation…</p>`}
      ${history?.truncated&&html`<p>Les 30 dernières versions sont affichées.</p>`}
      ${history?.turns.map(turn=>html`<div key=${turn.id} class="bench-chat-turn">
        ${turn.message&&html`<div class="bench-chat-message is-user"><strong>Vous</strong><p>${turn.message}</p></div>`}
        <div class="bench-chat-message"><strong>${turn.message?'Réponse du modèle':'Création initiale'}</strong><p>${executionStatus(turn)} · ${turn.output_chars.toLocaleString('fr-FR')} caractères de code conservés</p>${Number.isFinite(turn.cost)&&html`<small>Coût confirmé : ${formatUsd(turn.cost)}</small>`}</div>
      </div>`)}
    </div>
    <form class="bench-chat-composer" onSubmit=${send}>
      <label for="chat-message">Demander un ajustement</label>
      <textarea id="chat-message" rows="3" maxlength="12000" placeholder="Ex. : ajoute un menu, corrige les contrôles et conserve le reste du jeu…" value=${message} disabled=${busy||!canSend} onInput=${event=>setMessage(event.currentTarget.value)}/>
      <p>${active?'Cet appel est encore en cours. Vous pourrez ajuster le résultat une fois terminé.':!canSend?'Aucun code disponible à ajuster pour cet appel.':'Le code actuel et la conversation sont joints automatiquement. Envoyer déclenche un appel payant au même modèle, avec ses réglages actuels. Les versions précédentes restent conservées.'}</p>
      ${error&&html`<p class="bench-inline-error" role="alert">${error}</p>`}
      <div class="bench-chat-actions"><button class="btn" type="button" disabled=${busy} onClick=${onClose}>Fermer</button><button class="btn btn-primary" type="submit" disabled=${busy||!canSend||!message.trim()}>${busy?'Envoi…':'Envoyer l’ajustement · appel payant'}</button></div>
    </form>
  </dialog>`;
}
