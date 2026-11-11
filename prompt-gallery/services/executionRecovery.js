import {SYSTEM_PROMPT} from './htmlSystemPrompt.js';

export function reviewRecovery(plan,strategy=plan?.adaptation?.available?'adapted':'original'){
  if(strategy==='adapted'&&plan?.adaptation?.available){
    const parameters=plan.adaptation.parameters;
    return {strategy:'adapted',expected_parameters:parameters,
      maxTokens:parameters.max_tokens??parameters.max_completion_tokens,
      effort:parameters.reasoning?.effort??parameters.reasoning_effort,
      reasoningTokens:parameters.reasoning?.max_tokens};
  }
  return {strategy:'original',maxTokens:plan?.max_tokens,effort:plan?.reasoning_effort,reasoningTokens:plan?.reasoning_tokens};
}

export const canRecoverExecution=call=>call?.durable && ['cancelled','interrupted','error'].includes(call.state);
export function latestModelExecutions(calls=[]){
  const latest=new Map();
  for(const call of calls.toSorted((a,b)=>b.started-a.started))if(!latest.has(call.model))latest.set(call.model,call);
  return [...latest.values()];
}
export function recoveryCandidates(calls=[]){
  return latestModelExecutions(calls).filter(canRecoverExecution);
}
export function comparisonRetryCandidates(calls=[]){
  if(calls.some(c=>['queued','running','connecting','waiting','reasoning','writing'].includes(c.state)))return [];
  return latestModelExecutions(calls).filter(c=>c.durable&&['ok','error','cancelled','interrupted'].includes(c.state));
}
export function recoveryFallback(call,prompts=[]){
  if(call.request_saved)return undefined;
  const prompt=prompts.find(p=>p.id===call.context?.promptId);
  if(!prompt?.prompt?.trim())return undefined;
  const settings=call.settings || {},reasoning={};
  if(settings.reasoning_effort)reasoning.effort=settings.reasoning_effort;
  if(Number.isSafeInteger(settings.reasoning_tokens)&&settings.reasoning_tokens>0)reasoning.max_tokens=settings.reasoning_tokens;
  if(!Number.isSafeInteger(settings.max_tokens)||settings.max_tokens<=0)return undefined;
  return {model:call.model,messages:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt.prompt}],
    stream:true,stream_options:{include_usage:true},max_tokens:settings.max_tokens,
    ...(Object.keys(reasoning).length?{reasoning}:{})};
}
