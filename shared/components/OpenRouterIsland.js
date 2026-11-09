// OpenRouterIsland — shared toolbar group for [API key · provider settings ·
// model picker]. Mirrors the per-lab copies in style-atlas-lab,
// motion-atlas-lab, spoken-line-studio, cute-animals-studio; future labs
// import this shared version instead of duplicating.
//
// Selection is persisted per-app under `${appId}-provider` / `${appId}-model`
// in localStorage. Emits `onSelectionChange({ providerId, modelId })` so the
// host lab can route LLM calls through the chosen model.
//
// A local CLI agent row (Claude Code, Codex, …) also gets a thinking-level
// dropdown. The level is saved per agent + model and the cli-agent provider
// reads it back at run time, so hosts need no extra wiring for it.

import { html } from 'htm/preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import { ProviderModelSelector } from './ProviderModelSelector.js';
import { AgentEffortSelect, seedAgentModelEffort } from './AgentEffortSelect.js';
import { groupAgentModelOptions, listAgentModelOptions } from '../services/agent-backend.js';
import { CLI_DEFAULT_MODEL, agentIdFromProviderId, isCliAgentProviderId } from '../services/providers-cli-agent.js';
import { ProviderSettingsDialog } from './ProviderSettingsDialog.js';
import * as modelProviders from '../services/model-providers.js';
import * as openrouter from '../services/providers-openrouter.js';
import { subscribeSuite } from '../services/suite-prefs.js';

import { ApiKeyDialog } from './ApiKeyDialog.js';

/**
 * @param {Object} props
 * @param {string} props.appId          Used to namespace LS keys for selection.
 * @param {(sel:{providerId:string, modelId:string})=>void} [props.onSelectionChange]
 * @param {string} [props.title]        Tooltip text on the group container.
 */
export function OpenRouterIsland({ appId, onSelectionChange, title = 'LLM provider + model' }) {
  if (!appId) throw new Error('OpenRouterIsland: appId prop is required');
  const PROVIDER_KEY = `${appId}-provider`;
  const MODEL_KEY = `${appId}-model`;

  const initial = modelProviders.getEffectiveSelection(PROVIDER_KEY, MODEL_KEY);
  const [providerId, setProviderId] = useState(initial.provider || modelProviders.getDefaultProvider() || '');
  const [modelId, setModelId] = useState(
    initial.model || (initial.provider ? modelProviders.getDefaultModel(initial.provider) : '')
  );
  const [allModels, setAllModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(() => openrouter.hasApiKey());
  const [showApiKeyDialog, setShowApiKeyDialog] = useState(false);
  const [showProviderSettings, setShowProviderSettings] = useState(false);
  const [agentChoices, setAgentChoices] = useState([]);

  const agentId = isCliAgentProviderId(providerId) ? agentIdFromProviderId(providerId) : '';
  const agentModelId = modelId === CLI_DEFAULT_MODEL ? '' : modelId;

  useEffect(() => {
    let live = true;
    setAgentChoices([]);
    if (!agentId) return undefined;
    listAgentModelOptions(agentId).then((options) => {
      if (live) setAgentChoices(groupAgentModelOptions(options));
    });
    return () => { live = false; };
  }, [agentId]);

  useEffect(() => {
    if (providerId) localStorage.setItem(PROVIDER_KEY, providerId);
    if (modelId) localStorage.setItem(MODEL_KEY, modelId);
    onSelectionChange?.({ providerId, modelId });
  }, [providerId, modelId, onSelectionChange, PROVIDER_KEY, MODEL_KEY]);

  useEffect(() => {
    const sync = () => setHasApiKey(openrouter.hasApiKey());
    sync();
    return subscribeSuite('api-keys', sync);
  }, []);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const models = await modelProviders.fetchEnabledModels({ freeOnly: false });
      setAllModels(models);
    } catch (e) {
      console.warn(`[OpenRouterIsland:${appId}] model fetch failed:`, e);
    } finally {
      setModelsLoading(false);
    }
  }, [appId]);

  useEffect(() => { loadModels(); }, [loadModels, hasApiKey]);

  // If the persisted (providerId, modelId) is no longer in the model list,
  // fall back to the user's default provider / first model.
  useEffect(() => {
    if (allModels.length === 0) return;
    const stillValid = allModels.some(m => m.providerId === providerId && m.modelId === modelId);
    if (modelId && stillValid) return;
    const def = modelProviders.getDefaultProvider();
    const defModel = def ? modelProviders.getDefaultModel(def) : '';
    const exact = (def && defModel)
      ? allModels.find(m => m.providerId === def && m.modelId === defModel) : null;
    const providerMatch = !exact && def ? allModels.find(m => m.providerId === def) : null;
    const pick = exact || providerMatch || allModels[0];
    setProviderId(pick.providerId);
    setModelId(pick.modelId);
  }, [allModels, modelId, providerId]);

  const handleModelChange = useCallback((pId, mId) => {
    if (isCliAgentProviderId(pId) && mId !== CLI_DEFAULT_MODEL) {
      const id = agentIdFromProviderId(pId);
      listAgentModelOptions(id).then(options => seedAgentModelEffort(id, mId, groupAgentModelOptions(options)));
    }
    setProviderId(pId);
    setModelId(mId);
  }, []);

  const handleApiKeySave = useCallback(async (key) => {
    await openrouter.saveApiKey(key);
    setHasApiKey(openrouter.hasApiKey());
    setShowApiKeyDialog(false);
    loadModels();
  }, [loadModels]);

  return html`
    <div class="openrouter-group" title=${title}>
      <button
        class=${`btn-icon btn-key ${hasApiKey ? 'api-key-set' : 'api-key-missing'}`}
        onClick=${() => setShowApiKeyDialog(true)}
        title=${hasApiKey ? 'OpenRouter key set — click to manage' : 'Click to set your free OpenRouter API key'}
      >
        <i class="fa-solid fa-key"></i>
      </button>
      <button
        class="btn-icon"
        onClick=${() => setShowProviderSettings(true)}
        title="Provider settings"
        style=${{ fontSize: '13px', padding: '4px 8px' }}
      >
        <i class="fa-solid fa-server"></i>
      </button>
      <${ProviderModelSelector}
        models=${allModels}
        providerId=${providerId}
        modelId=${modelId}
        onChange=${handleModelChange}
        disabled=${allModels.length === 0 && !modelsLoading}
        loading=${modelsLoading}
        onSettingsClick=${() => setShowProviderSettings(true)}
      />
      ${agentId && agentChoices.some(choice => choice.id === agentModelId) && html`
        <${AgentEffortSelect}
          agentId=${agentId}
          modelId=${agentModelId}
          choices=${agentChoices}
        />`}
    </div>
    ${showApiKeyDialog && html`
      <${ApiKeyDialog}
        currentKey=${openrouter.getApiKey()}
        onSave=${handleApiKeySave}
        onClose=${() => setShowApiKeyDialog(false)}
      />
    `}
    ${showProviderSettings && html`
      <${ProviderSettingsDialog}
        onClose=${() => { setShowProviderSettings(false); loadModels(); }}
      />
    `}
  `;
}
