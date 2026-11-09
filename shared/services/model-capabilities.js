// OpenRouter's advertised capabilities are authoritative; never infer them from model names.
const EFFORTS=['max','xhigh','high','medium','low','minimal','none'];
const positive=value=>Number.isSafeInteger(value)&&value>0?value:null;
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
function invalid(message) { return Object.assign(new Error(message),{code:'MODEL_SETTINGS',retryable:false}); }
export function normalizeOpenRouterModel(model, fetchedAt=Date.now()) {
  const reasoning=model.reasoning&&typeof model.reasoning==='object'?{
    mandatory:model.reasoning.mandatory===true,
    supports_max_tokens:model.reasoning.supports_max_tokens===true,
    ...(own(model.reasoning,'supported_efforts')?{supported_efforts:model.reasoning.supported_efforts===null?null:(Array.isArray(model.reasoning.supported_efforts)?model.reasoning.supported_efforts.filter(e=>EFFORTS.includes(e)):[])}:{}),
    ...(EFFORTS.includes(model.reasoning.default_effort)?{default_effort:model.reasoning.default_effort}:{}),
    default_enabled:model.reasoning.default_enabled===true,
  }:null;
  return {id:model.id,name:model.name||model.id,context_length:positive(model.context_length),pricing:model.pricing||null,
    capabilities:{version:1,source:'openrouter-api',fetchedAt,
      contextLength:positive(model.top_provider?.context_length)||positive(model.context_length),
      maxOutputTokens:positive(model.top_provider?.max_completion_tokens),
      supportedParameters:Array.isArray(model.supported_parameters)?model.supported_parameters.filter(k=>typeof k==='string'):null,
      outputModalities:Array.isArray(model.architecture?.output_modalities)?model.architecture.output_modalities.filter(k=>typeof k==='string'):null,
      defaultParameters:Object.fromEntries(Object.entries(model.default_parameters||{}).filter(([key,value])=>['temperature','top_p','top_k','frequency_penalty','presence_penalty','repetition_penalty'].includes(key)&&Number.isFinite(value))),
      reasoning}};
}
export function resolveModelSettings({model,profile='code',params={},budget={},reviewedMaxTokens}={}) {
  const caps=model?.capabilities||model?.raw?.capabilities;
  if (!caps || caps.source!=='openrouter-api'||!Array.isArray(caps.supportedParameters)) throw invalid('Capacités API indisponibles : actualisez les modèles avant de lancer.');
  if (!['maximum','code','manual'].includes(profile)) throw invalid('Profil de génération inconnu.');
  if (caps.outputModalities&&!caps.outputModalities.includes('text')) throw invalid('Ce modèle ne produit pas de texte ; il ne peut pas générer une page HTML.');
  const supported=new Set(caps.supportedParameters),adjustments=[];
  const limit=positive(caps.maxOutputTokens);
  if(profile==='maximum'&&!limit) throw invalid('La limite de sortie n’est pas communiquée par l’API : choisissez un budget manuel.');
  const requested=profile==='maximum'?limit:Number(budget.totalTokens??params.max_tokens??32768);
  if(!positive(requested)) throw invalid('Le budget total doit être un entier positif.');
  const total=Math.min(requested,limit||requested,positive(caps.contextLength)||requested,positive(reviewedMaxTokens)||requested);
  if(total!==requested) adjustments.push(`Sortie plafonnée à ${total} tokens selon les limites API et le plafond affiché.`);
  const out={};
  for(const [key,value] of Object.entries(params||{})) {
    if(['reasoning','reasoning_effort','enable_thinking','max_tokens','max_completion_tokens','provider'].includes(key)) continue;
    const wireKey=key==='repeat_penalty'?'repetition_penalty':key;
    if(supported.has(wireKey))out[wireKey]=value;
    else adjustments.push(`Paramètre non accepté retiré : ${key}.`);
  }
  if(supported.has('max_tokens'))out.max_tokens=total;
  else if(supported.has('max_completion_tokens'))out.max_completion_tokens=total;
  else throw invalid('L’API ne déclare aucun paramètre de limite de sortie pour ce modèle.');
  const reasoning=caps.reasoning;
  const requestedReasoning=params.reasoning || (params.reasoning_effort?{effort:params.reasoning_effort}:params.enable_thinking===false?{enabled:false}:null);
  if(reasoning&&(supported.has('reasoning')||supported.has('reasoning_effort'))) {
    const efforts=reasoning.supported_efforts===null?EFFORTS:reasoning.supported_efforts;
    if(reasoning.mandatory&&(requestedReasoning?.enabled===false||requestedReasoning?.effort==='none'||budget.reasoningEffort==='none'))throw invalid('Le raisonnement est obligatoire pour ce modèle.');
    if(Array.isArray(efforts)&&efforts.length) {
      const enabled=efforts.filter(e=>e!=='none');
      const chosen=profile==='manual'?(budget.reasoningEffort||(requestedReasoning?.enabled===false?'none':requestedReasoning?.effort)||reasoning.default_effort||enabled.at(-1))
        :profile==='maximum'?enabled[0]:(['low','minimal','medium'].find(e=>enabled.includes(e))||enabled.at(-1));
      if(!efforts.includes(chosen))throw invalid(`Effort non accepté par l’API : ${chosen}. Valeurs : ${efforts.join(', ')}.`);
      if(supported.has('reasoning'))out.reasoning={effort:chosen};else out.reasoning_effort=chosen;
      if(requestedReasoning?.max_tokens!=null)adjustments.push('Budget fixe remplacé par l’effort annoncé par l’API.');
    } else if(reasoning.supports_max_tokens&&supported.has('reasoning')) {
      const amount=Number(budget.reasoningTokens??requestedReasoning?.max_tokens??Math.min(4096,Math.floor(total/4)));
      if(!positive(amount)||amount>=total)throw invalid('Le budget de raisonnement doit être positif et inférieur au total.');
      out.reasoning={max_tokens:amount};
    } else {
      adjustments.push('Raisonnement géré par le modèle : aucun contrôle précis annoncé par l’API.');
    }
  } else if(requestedReasoning)adjustments.push('Raisonnement non configurable selon l’API ; paramètre retiré.');
  if(profile==='maximum'&&reasoning)adjustments.push('Effort maximal : le raisonnement peut consommer toute la sortie. Aucun résultat ni coût fixe garanti.');
  // Preserve caller routing constraints while requiring support for every sent parameter.
  out.provider={...(params.provider||{}),require_parameters:true};
  return {profile,modelId:model.modelId||model.id,source:caps.source,fetchedAt:caps.fetchedAt,
    maxOutputTokens:limit,contextLength:caps.contextLength,supportedParameters:caps.supportedParameters,defaultParameters:caps.defaultParameters||{},mandatoryReasoning:!!reasoning?.mandatory,
    supportedEfforts:reasoning?.supported_efforts===null?EFFORTS:reasoning?.supported_efforts||[],params:out,adjustments};
}
export function generationFeedback(stats={}) {
  if(stats.finishReason==='content_filter')return {kind:'content-filtered',message:'Arrêt signalé par le fournisseur : filtrage de contenu (content_filter). Motif précis non communiqué. Aucun nouvel appel automatique.'};
  if(stats.finishReason!=='length')return null;
  const visible=Number.isFinite(stats.completionTokens)&&Number.isFinite(stats.reasoningTokens)?stats.completionTokens-stats.reasoningTokens:null;
  return visible===0?{kind:'reasoning-exhausted',nextProfile:'code',message:'Budget consommé par le raisonnement sans code. Passez au profil Génération de code ou réduisez le périmètre ; aucun appel automatique.'}
    :{kind:'truncated',message:'Réponse incomplète : limite de sortie atteinte. Augmentez le budget dans la limite API ou découpez le prompt ; aucun appel automatique.'};
}
