export const DEFAULT_AGENT_LIMITS={maxSteps:8,budgetUsd:10};
const KEY='prompt-gallery-mastra-limits';
export function agentLimits(value={}){
  return {maxSteps:Number.isInteger(value.maxSteps)&&value.maxSteps>=1&&value.maxSteps<=16?value.maxSteps:8,
    budgetUsd:Number.isFinite(value.budgetUsd)&&value.budgetUsd>0&&value.budgetUsd<=100?value.budgetUsd:10};
}
export function readAgentLimits(){try{return agentLimits(JSON.parse(localStorage.getItem(KEY)||'{}'));}catch{return {...DEFAULT_AGENT_LIMITS};}}
export function saveAgentLimits(value){try{const limits=agentLimits(value);localStorage.setItem(KEY,JSON.stringify(limits));if(typeof CustomEvent!=='undefined')globalThis.dispatchEvent(new CustomEvent('bench-agent-limits',{detail:limits}));}catch{}}
