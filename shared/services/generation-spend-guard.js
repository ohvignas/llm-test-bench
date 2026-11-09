// Prevent accidental repeat billing after a failed Prompt Gallery request.
// Only SHA-256 fingerprints are persisted: no prompts, responses or credentials.
const KEY='prompt-gallery-failed-calls-v1';
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
  async run({modelId,systemPrompt,userPrompt,params},operation) {
   const base=await digest({modelId,systemPrompt,userPrompt});
   const exact=await digest({base,params});
   if(pending.has(exact))throw failure('GENERATION_IN_FLIGHT','Cet appel est déjà en cours. Aucun second appel envoyé.');
   const records=read();
   if(records.some(r=>r.exact===exact||(r.filtered&&r.base===base)))throw failure('PAID_RETRY_BLOCKED','Relance bloquée : cet appel a déjà échoué et peut avoir été facturé. Modifiez le prompt ou les réglages. Après un filtrage, changer le budget ne suffit pas. Pour réessayer volontairement, utilisez « Autoriser les relances » dans les options du lot.');
   // Check persistence before sending a paid request.
   try {storage.setItem(KEY,JSON.stringify([...records,{base,exact,pending:true,at:Date.now()}].slice(-100)));}
   catch {throw failure('SPEND_GUARD_UNAVAILABLE','Stockage de protection indisponible : aucun appel envoyé.');}
   pending.add(exact);
   try {const result=await operation();storage.setItem(KEY,JSON.stringify(read().filter(r=>r.exact!==exact)));return result;}
   catch(error) {
    try {storage.setItem(KEY,JSON.stringify([...read().filter(r=>r.exact!==exact),{base,exact,filtered:error.code==='CONTENT_FILTERED',at:Date.now()}].slice(-100)));}
    catch {/* Keep the original upstream error and its billed usage. */}
    error.retryable=false;
    throw error;
   } finally {pending.delete(exact);}
  },
 };
}
let defaultGuard;
export function generationSpendGuard(){return defaultGuard??=createSpendGuard(globalThis.localStorage);}
export function clearFailedGenerationBlocks(){generationSpendGuard().clear();}
