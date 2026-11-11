// Generation service for Prompt Gallery
// Uses the unified model-providers layer for provider/model management
// Keeps backward compat exports for OpenRouter API key management

import { getApiKey, saveApiKey, hasApiKey } from '../../shared/services/providers-openrouter.js';
import { streamChat, getProvider } from '../../shared/services/model-providers.js';
import { streamHtmlDocument, requireHtmlDocument } from './htmlOutput.js';
import { PROMPT_GALLERY_CHAT_AGENT_BUDGETS } from './codingAgent.js';

export { getApiKey, saveApiKey, hasApiKey };

import {SYSTEM_PROMPT} from './htmlSystemPrompt.js';
import {readAgentLimits} from './agentSettings.js';
import {secureMode} from '../../shared/services/secure-session.js';

/**
 * Generate HTML through the unified provider system.
 * @param {string} prompt - User prompt
 * @param {string} providerId - Provider ID
 * @param {string} modelId - Model ID
 * @param {Function} [onChunk] - Streaming callback
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Stop: cancels a CLI-agent run on the
 *   bridge and detaches any other stream. CLI agents run with no time limit,
 *   so this is how a run that will not finish gets ended.
 */
export async function generateHtml(prompt, providerId, modelId, onChunk, onStats, params, { signal, generationOptions } = {}) {
  const mastra=secureMode()&&(providerId==='openrouter'||getProvider(providerId)?.type==='openrouter')&&generationOptions?.engine!=='completion';
  const context={promptId:'custom-'+crypto.randomUUID(),title:'Création personnalisée',modelLabel:modelId,...generationOptions?.executionContext};
  if(mastra)Object.assign(context,{engine:'mastra',agentLimits:generationOptions?.agentLimits||readAgentLimits()});
  return streamHtmlDocument(streamChat, {
    providerId,
    modelId,
    systemPrompt: mastra?'Build the requested project with the Mastra development tools. Save source files, inspect build errors and produce a complete working web artifact.':SYSTEM_PROMPT,
    userPrompt: prompt,
    appTitle: 'Prompt Gallery',
    onChunk,
    onStats,
    params,
    generationOptions:{...generationOptions,executionContext:context,validateResult:requireHtmlDocument},
    signal,
    agentBudgets: PROMPT_GALLERY_CHAT_AGENT_BUDGETS,
  });
}
