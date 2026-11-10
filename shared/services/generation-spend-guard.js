import {secureMode,secureFetch} from './secure-session.js';
// Prevent accidental repeat billing after a failed Prompt Gallery request.
// Only SHA-256 fingerprints are persisted: no prompts, responses or credentials.
const KEY='prompt-gallery-failed-calls-v1';
const AUTO_KEY='prompt-gallery-automatic-runs-v1';
const stable=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]))):value;
const failure=(code,message)=>Object.assign(new Error(message),{code,retryable:false});
const digest=async value=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value))))),b=>b.toString(16).padStart(2,'0')).join('');
export function createSpendGuard(storage) {
 const pending=new Set();
 const read=()=>{
  let records;
  try {records=JSON.parse(storage.getItem(KEY)||'[]');}
  catch {throw failure('SPEND_GUARD_UNAVAILABLE','Historique de protection illisible. Réinitialisez les blocages avant de lancer.');}
  return Array.isArray(records)?records.filter(r=>r&&typeof r.exact==='string'&&typeof r.base==='string').slice(-100):[];
 };
 return {
  clear(){storage.removeItem(KEY);},
  async run({modelId,systemPrompt,userPrompt,params,automatic},operation) {
   const base=await digest({modelId,systemPrompt,userPrompt});
   const exact=await digest({base,params});
   try {
    if(pending.has(exact))throw failure('GENERATION_IN_FLIGHT','Cet appel est déjà en cours. Aucun second appel envoyé.');
    const records=read();
    if(automatic && (automatic.limit!==3 || !/^[a-zA-Z0-9-]{16,80}$/.test(automatic.id)))throw failure('AUTOMATIC_LIMIT','Configuration automatique invalide.');
    if(records.some(r=>(r.base===base&&(r.filtered||r.pending)) || (!automatic&&r.exact===exact)))throw failure('PAID_RETRY_BLOCKED','Relance bloquée : appel en cours, interrompu ou déjà échoué. Aucun second appel envoyé. Vérifiez les réglages ou préparez une reprise.');
    if(automatic) {
      let runs;
      try {runs=JSON.parse(storage.getItem(AUTO_KEY)||'[]');if(!Array.isArray(runs))throw new Error();}
      catch {throw failure('SPEND_GUARD_UNAVAILABLE','Historique des reprises automatiques illisible.');}
      const current=runs.find(r=>r.id===automatic.id);
      if(current&&(current.model!==modelId||current.calls>=3||current.pending))throw failure('AUTOMATIC_LIMIT','Limite de trois appels atteinte ou appel automatique encore en cours.');
      storage.setItem(AUTO_KEY,JSON.stringify([...runs.filter(r=>r.id!==automatic.id),{id:automatic.id,model:modelId,calls:(current?.calls||0)+1,pending:true}].slice(-100)));
    }
    // Check persistence before sending a paid request.
    try {storage.setItem(KEY,JSON.stringify([...records,{base,exact,pending:true,at:Date.now()}].slice(-100)));}
    catch {throw failure('SPEND_GUARD_UNAVAILABLE','Stockage de protection indisponible : aucun appel envoyé.');}
   } catch (error) {error.requestSent=false;throw error;}
   pending.add(exact);
   try {const result=await operation();storage.setItem(KEY,JSON.stringify(read().filter(r=>r.exact!==exact)));return result;}
   catch(error) {
    try {storage.setItem(KEY,JSON.stringify([...read().filter(r=>r.exact!==exact),{base,exact,filtered:error.code==='CONTENT_FILTERED'||error.status===403,at:Date.now()}].slice(-100)));}
    catch {/* Keep the original upstream error and its billed usage. */}
    error.retryable=false;
    throw error;
   } finally {
    pending.delete(exact);
    if(automatic)try {
      const runs=JSON.parse(storage.getItem(AUTO_KEY)||'[]');
      storage.setItem(AUTO_KEY,JSON.stringify(runs.map(r=>r.id===automatic.id?{...r,pending:false}:r)));
    } catch {/* Fail closed if persistence is unavailable. */}
   }
  },
 };
}
let defaultGuard;
export function generationSpendGuard(){return defaultGuard??=createSpendGuard(globalThis.localStorage);}
export async function clearFailedGenerationBlocks(){
 if(secureMode()){
  const response=await secureFetch('/api/openrouter/retry-blocks',{method:'DELETE'});
  if(!response.ok)throw new Error('Impossible de réinitialiser les blocages du serveur.');
 }
 generationSpendGuard().clear();
}
