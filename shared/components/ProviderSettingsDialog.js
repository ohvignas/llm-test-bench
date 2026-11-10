// ProviderSettingsDialog — shared Preact component
// Two modes:
//   - Global (no appId): edits provider config (URL, API key, add/remove). Used in /settings/.
//   - Per-app (appId set): only toggles which providers are visible in this app's
//     model picker. URL/API-key/add/remove controls are hidden — those remain global.
//     Per-app toggle state is stored at prefs(appId).disabledProviders (array of IDs).

import { html } from 'htm/preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import * as providers from '../services/model-providers.js';
import { getApiKey, saveApiKey, hasApiKey } from '../services/providers-openrouter.js';
import { createProvider as createLmStudioProvider } from '../services/providers-lmstudio.js';
import { createProvider as createOpenAiCompatibleProvider } from '../services/providers-openai-compatible.js';
import {
  createProvider as createUnslothStudioProvider,
  getApiKey as getUnslothStudioApiKey,
  saveApiKey as saveUnslothStudioApiKey,
} from '../services/providers-unsloth-studio.js';
import { prefs as readPrefs, setPref as setAppPref } from '../services/app-prefs.js';
import { isPublicDistribution } from '../services/distribution.js';
import { secureMode } from '../services/secure-session.js';

const LOCAL_PROVIDER_META = {
  lmstudio: {
    title: 'LM Studio',
    pluralTitle: 'Serveurs LM Studio',
    icon: 'fa-network-wired',
    defaultName: 'LM Studio',
    defaultUrl: 'http://localhost:1234',
    placeholderName: 'LM Studio principal',
    placeholderUrl: 'http://192.168.1.20:1234',
    emptyText: 'Aucun serveur LM Studio configuré',
    needsKey: false,
    create: createLmStudioProvider,
  },
  'openai-compatible': {
    title: 'Compatible OpenAI',
    pluralTitle: 'Serveurs compatibles OpenAI',
    icon: 'fa-plug',
    defaultName: 'OpenAI-Compatible',
    defaultUrl: 'http://127.0.0.1:8080',
    placeholderName: 'Serveur Qwen (Tailscale)',
    placeholderUrl: 'http://qwen-box.tailnet.ts.net:8081',
    emptyText: 'Aucun serveur compatible OpenAI configuré',
    // Optional here: plenty of local servers take no key at all.
    needsKey: true,
    keyOnProvider: true,
    keyPlaceholder: 'Facultatif : laisser vide si le serveur ne demande pas de clé',
    supportsModelIds: true,
    supportsProxy: true,
    create: createOpenAiCompatibleProvider,
  },
  'unsloth-studio': {
    title: 'Unsloth Studio',
    pluralTitle: 'Serveurs Unsloth Studio',
    icon: 'fa-bolt',
    defaultName: 'Unsloth Studio',
    defaultUrl: 'http://127.0.0.1:8888',
    placeholderName: 'Unsloth DiffusionGemma',
    placeholderUrl: 'http://127.0.0.1:8888',
    emptyText: 'Aucun serveur Unsloth Studio configuré',
    needsKey: true,
    create: createUnslothStudioProvider,
  },
};

function localProviderMeta(type) {
  return LOCAL_PROVIDER_META[type] || LOCAL_PROVIDER_META.lmstudio;
}

export function ProviderSettingsDialog({ onClose, onProvidersChanged, appId }) {
  const isPerApp = !!appId;
  const proxyAvailable = !secureMode() && !isPublicDistribution();
  // The private hub has a full global Settings app, so its per-app dialogs only
  // control visibility. The small public distribution has no provider manager;
  // let visitors add/edit shared endpoints directly from any gallery instead.
  const canManageProviders = !isPerApp || isPublicDistribution();
  const [providerList, setProviderList] = useState(() => providers.getProviders());
  const [disabledForApp, setDisabledForApp] = useState(() => {
    if (!isPerApp) return [];
    const snap = readPrefs(appId, { defaults: { disabledProviders: [] } });
    return Array.isArray(snap.disabledProviders) ? snap.disabledProviders : [];
  });
  const [apiKey, setApiKey] = useState(() => getApiKey());
  const [testResults, setTestResults] = useState({});
  const [testing, setTesting] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newType, setNewType] = useState('lmstudio');
  const [newApiKey, setNewApiKey] = useState('');
  const [newModelIds, setNewModelIds] = useState('');
  const [newUseProxy, setNewUseProxy] = useState(proxyAvailable);
  const [newTags, setNewTags] = useState('');
  const [newTimeout, setNewTimeout] = useState('30000');
  const [editingId, setEditingId] = useState(null);

  const reload = useCallback(() => {
    setProviderList(providers.getProviders());
    if (onProvidersChanged) onProvidersChanged();
  }, [onProvidersChanged]);

  // ── OpenRouter API Key ──
  const [keyError, setKeyError] = useState('');
  const handleSaveApiKey = useCallback(async () => {
    try { await saveApiKey(apiKey.trim()); setApiKey(''); setKeyError(''); reload(); }
    catch (error) { setKeyError(error.message); }
  }, [apiKey, reload]);

  const handleRemoveApiKey = useCallback(async () => {
    try { await saveApiKey(''); setApiKey(''); setKeyError(''); reload(); }
    catch (error) { setKeyError(error.message); }
  }, [reload]);

  // ── Test connection ──
  const handleTest = useCallback(async (provider) => {
    setTesting(t => ({ ...t, [provider.id]: true }));
    setTestResults(r => ({ ...r, [provider.id]: null }));
    try {
      const result = await providers.testConnection(provider);
      setTestResults(r => ({ ...r, [provider.id]: result }));
    } catch (e) {
      setTestResults(r => ({ ...r, [provider.id]: { ok: false, error: e.message } }));
    } finally {
      setTesting(t => ({ ...t, [provider.id]: false }));
    }
  }, []);

  // Auto-test enabled providers on mount to show health status
  useEffect(() => {
    for (const p of providerList) {
      if (p.enabled !== false && !testResults[p.id] && !testing[p.id]) {
        handleTest(p);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle enable/disable ──
  // Global mode: flips provider.enabled in the registry (affects every app).
  // Per-app mode: adds/removes the provider id from prefs(appId).disabledProviders.
  const handleToggle = useCallback((id) => {
    if (isPerApp && !canManageProviders) {
      setDisabledForApp(prev => {
        const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
        setAppPref(appId, 'disabledProviders', next).catch(e => {
          console.warn(`[ProviderSettingsDialog] saving disabledProviders for ${appId} failed:`, e);
        });
        if (onProvidersChanged) onProvidersChanged();
        return next;
      });
      return;
    }
    const p = providerList.find(x => x.id === id);
    if (!p) return;
    providers.updateProvider(id, { enabled: !p.enabled });
    reload();
  }, [isPerApp, canManageProviders, appId, providerList, reload, onProvidersChanged]);

  const isProviderOnForApp = useCallback((p) => {
    if (!p) return false;
    if (isPerApp && !canManageProviders) {
      // In per-app mode, only providers globally enabled count; the per-app
      // list further opts them out.
      return p.enabled !== false && !disabledForApp.includes(p.id);
    }
    return p.enabled !== false;
  }, [isPerApp, canManageProviders, disabledForApp]);

  // ── Remove provider ──
  const handleRemove = useCallback((id) => {
    if (id === 'openrouter') return; // Can't remove OpenRouter
    providers.removeProvider(id);
    reload();
  }, [reload]);

  const resetEndpointForm = useCallback(() => {
    setShowAddForm(false);
    setNewName('');
    setNewUrl('');
    setNewApiKey('');
    setNewModelIds('');
    setNewUseProxy(proxyAvailable);
    setNewTags('');
    setNewTimeout('30000');
  }, [proxyAvailable]);

  const startAddEndpoint = useCallback((type) => {
    const meta = localProviderMeta(type);
    setEditingId(null);
    setNewType(type);
    setNewName(meta.defaultName);
    setNewUrl(meta.defaultUrl);
    setNewApiKey('');
    setNewModelIds('');
    setNewUseProxy(proxyAvailable);
    setNewTags('');
    setNewTimeout('30000');
    setShowAddForm(true);
  }, [proxyAvailable]);

  // ── Add local endpoint ──
  const handleAdd = useCallback(() => {
    if (!newUrl.trim()) return;
    const meta = localProviderMeta(newType);
    const tags = newTags.trim() ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const cfg = {
      name: newName.trim() || meta.defaultName,
      baseUrl: newUrl.trim(),
      tags,
      timeoutMs: parseInt(newTimeout) || 30000,
    };
    // Types that keep their key on the provider record rather than in the
    // Unsloth key store, and that can pin model ids / route via the hub proxy.
    if (meta.keyOnProvider) cfg.apiKey = newApiKey.trim();
    if (meta.supportsModelIds) cfg.modelIds = newModelIds.trim();
    if (meta.supportsProxy) cfg.useProxy = proxyAvailable && newUseProxy;
    const provider = meta.create(cfg);
    try {
      providers.addProvider(provider);
      if (meta.needsKey && !meta.keyOnProvider) saveUnslothStudioApiKey(provider, newApiKey);
      resetEndpointForm();
      reload();
    } catch (e) {
      alert(e.message);
    }
  }, [newType, newName, newUrl, newApiKey, newModelIds, newUseProxy, newTags, newTimeout, resetEndpointForm, reload, proxyAvailable]);

  // ── Edit local endpoint ──
  const handleStartEdit = useCallback((provider) => {
    if (provider.type === 'openrouter') return;
    const meta = localProviderMeta(provider.type);
    setEditingId(provider.id);
    setNewType(provider.type);
    setNewName(provider.name || '');
    setNewUrl(provider.baseUrl || '');
    setNewApiKey(meta.keyOnProvider ? (provider.apiKey || '')
      : (meta.needsKey ? getUnslothStudioApiKey(provider) : ''));
    setNewModelIds(Array.isArray(provider.modelIds) ? provider.modelIds.join(', ') : (provider.modelIds || ''));
    setNewUseProxy(proxyAvailable && provider.useProxy !== false);
    setNewTags((provider.tags || []).join(', '));
    setNewTimeout(String(provider.timeoutMs || 30000));
  }, [proxyAvailable]);

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !newUrl.trim()) return;
    const current = providerList.find(p => p.id === editingId);
    const meta = localProviderMeta(current?.type || newType);
    const tags = newTags.trim() ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const cfg = {
      name: newName.trim() || meta.defaultName,
      baseUrl: newUrl.trim(),
      tags,
      timeoutMs: parseInt(newTimeout) || 30000,
    };
    if (meta.keyOnProvider) cfg.apiKey = newApiKey.trim();
    if (meta.supportsModelIds) cfg.modelIds = newModelIds.trim();
    if (meta.supportsProxy) cfg.useProxy = proxyAvailable && newUseProxy;
    providers.updateProvider(editingId, cfg);
    if (meta.needsKey && !meta.keyOnProvider) saveUnslothStudioApiKey(editingId, newApiKey);
    resetEndpointForm();
    setEditingId(null);
    reload();
  }, [editingId, providerList, newType, newName, newUrl, newApiKey, newModelIds, newUseProxy, newTags, newTimeout, resetEndpointForm, reload, proxyAvailable]);

  const handleCancelEdit = useCallback(() => {
    resetEndpointForm();
    setEditingId(null);
  }, [resetEndpointForm]);

  // ── Refresh models ──
  const handleRefreshModels = useCallback(async (provider) => {
    setTesting(t => ({ ...t, [`refresh-${provider.id}`]: true }));
    try {
      await providers.refreshProviderModels(provider.id);
      setTestResults(r => ({ ...r, [provider.id]: { ok: true, refreshed: true } }));
    } catch (e) {
      setTestResults(r => ({ ...r, [provider.id]: { ok: false, error: e.message } }));
    } finally {
      setTesting(t => ({ ...t, [`refresh-${provider.id}`]: false }));
    }
  }, []);

  const statusDot = (providerId) => {
    if (testing[providerId]) {
      return html`<i class="fa-solid fa-circle fa-beat-fade" style=${{ fontSize: '8px', color: 'var(--text-muted)', marginLeft: '6px' }}></i>`;
    }
    const result = testResults[providerId];
    if (!result) return null;
    const color = result.ok ? 'var(--success, #22c55e)' : 'var(--danger, #ef4444)';
    const title = result.ok
      ? `Connecté${result.modelCount ? ` — ${result.modelCount} modèles` : ''}`
      : `Erreur : ${result.error}`;
    return html`<i class="fa-solid fa-circle" style=${{ fontSize: '8px', color, marginLeft: '6px' }} title=${title}></i>`;
  };

  // In per-app mode we only surface globally-enabled providers — there's
  // nothing for the user to toggle on a provider they've turned off in /settings/.
  const visibleList = isPerApp && !canManageProviders
    ? providerList.filter(p => p.enabled !== false)
    : providerList;
  // Fields only some endpoint types carry. Rendered by both the add form and
  // the inline edit form, so they stay in step.
  const endpointExtras = (type) => {
    const meta = localProviderMeta(type);
    return html`
      ${meta.supportsModelIds && html`
        <div class="form-group">
          <label>Identifiants des modèles (séparés par des virgules, facultatif)</label>
          <input class="form-input" value=${newModelIds}
            onInput=${e => setNewModelIds(e.target.value)}
            placeholder="qwen3.8-27b — uniquement si le serveur ne propose pas /v1/models" />
        </div>
      `}
      ${meta.supportsProxy && !proxyAvailable && html`
        <p class="setting-help">Connexion directe au serveur : autorisez cette origine dans ses réglages CORS.
          Le proxy générique <code>/__llm</code> n’est pas disponible dans cette installation.</p>
      `}
      ${meta.supportsProxy && proxyAvailable && html`
        <div class="form-group">
          <label style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked=${newUseProxy}
              onChange=${e => setNewUseProxy(e.target.checked)} />
            <span>Passer par cet atelier (résout les problèmes CORS)</span>
          </label>
          <div style=${{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.5 }}>
            La plupart des serveurs locaux n’envoient pas d’en-têtes CORS : le navigateur bloque donc
            les appels directs même lorsque curl fonctionne. Conservez cette option sauf si le serveur définit
            <code>Access-Control-Allow-Origin</code> lui-même. La page doit être servie par <code>serve.py</code>.
          </div>
        </div>
      `}
    `;
  };

  const openRouterProvider = visibleList.find(p => p.type === 'openrouter');
  const localProviders = visibleList.filter(p => p.type !== 'openrouter');

  return html`
    <div class="modal-overlay">
      <div class="modal provider-settings-modal" onClick=${e => e.stopPropagation()} style=${{ maxWidth: '620px', width: '90vw' }}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-server" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>${canManageProviders ? 'Fournisseurs de modèles' : 'Modèles dans cette application'}</h2>
          <button class="btn-icon" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="modal-body" style=${{ gap: '18px' }}>
          ${isPerApp && !canManageProviders && html`
            <div class="provider-perapp-hint" style=${{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: '12px',
              lineHeight: 1.5,
            }}>
              <i class="fa-solid fa-circle-info" style=${{ marginRight: '6px', color: 'var(--accent)' }}></i>
              Ces options concernent uniquement le sélecteur de modèles de cette application. Ajoutez ou modifiez les fournisseurs dans
              <a href="../settings.html" style=${{ color: 'var(--accent)' }}>les paramètres globaux</a>.
            </div>
          `}
          <!-- OpenRouter Section -->
          <div class="provider-section">
            <div class="provider-section-header">
              <h3><i class="fa-solid fa-cloud" style=${{ marginRight: '6px' }}></i> OpenRouter${statusDot(openRouterProvider?.id)}</h3>
              <div style=${{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                ${openRouterProvider && html`
                  <button class="btn btn-sm" onClick=${() => handleTest(openRouterProvider)}
                    disabled=${testing[openRouterProvider?.id]}>
                    <i class=${`fa-solid ${testing[openRouterProvider?.id] ? 'fa-spinner fa-spin' : 'fa-plug'}`}></i>
                    Tester
                  </button>
                  <button class="btn btn-sm" onClick=${() => handleRefreshModels(openRouterProvider)}
                    disabled=${testing[`refresh-${openRouterProvider?.id}`]}>
                    <i class=${`fa-solid ${testing[`refresh-${openRouterProvider?.id}`] ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`}></i>
                  </button>
                  <label class="provider-toggle">
                    <input type="checkbox"
                      checked=${isProviderOnForApp(openRouterProvider)}
                      onChange=${() => handleToggle(openRouterProvider.id)}
                    />
                    <span class="toggle-slider"></span>
                  </label>
                `}
              </div>
            </div>

            ${testResults[openRouterProvider?.id] && html`
              <div class=${`provider-test-result ${testResults[openRouterProvider?.id].ok ? 'success' : 'error'}`}>
                ${testResults[openRouterProvider?.id].ok
                  ? html`<i class="fa-solid fa-circle-check"></i> Connecté${testResults[openRouterProvider?.id].modelCount ? ` — ${testResults[openRouterProvider?.id].modelCount} modèles` : ''}${testResults[openRouterProvider?.id].refreshed ? ' (cache actualisé)' : ''}`
                  : html`<i class="fa-solid fa-circle-xmark"></i> ${testResults[openRouterProvider?.id].error}`
                }
              </div>
            `}

            ${canManageProviders && html`
              <div class="form-group">
                <label>Clé API</label>
                ${keyError && html`<p role="alert">${keyError}</p>`}
                <div style=${{ display: 'flex', gap: '6px' }}>
                  <input class="form-input" type="password" value=${apiKey}
                    onInput=${e => setApiKey(e.target.value)}
                    onKeyDown=${e => e.key === 'Enter' && handleSaveApiKey()}
                    placeholder="sk-or-v1-..."
                    style=${{ flex: 1, fontFamily: 'monospace', fontSize: '13px' }}
                  />
                  <button class="btn btn-primary btn-sm" onClick=${handleSaveApiKey}>
                    <i class="fa-solid fa-check"></i>
                  </button>
                  ${hasApiKey() && html`
                    <button class="btn btn-danger btn-sm" onClick=${handleRemoveApiKey}>
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  `}
                </div>
                <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Obtenir une clé gratuite sur <a href="https://openrouter.ai/keys" target="_blank" rel="noopener" style=${{ color: 'var(--accent)' }}>openrouter.ai/keys</a>
                </span>
              </div>
            `}
          </div>

          <!-- Local endpoint section -->
          <div class="provider-section">
            <div class="provider-section-header">
              <h3><i class="fa-solid fa-network-wired" style=${{ marginRight: '6px' }}></i> Serveurs locaux compatibles OpenAI</h3>
              ${canManageProviders && html`
                <div style=${{ display: 'flex', gap: '6px' }}>
                  <button class="btn btn-sm btn-primary" onClick=${() => startAddEndpoint('lmstudio')}>
                    <i class="fa-solid fa-plus"></i> LM Studio
                  </button>
                  <button class="btn btn-sm btn-primary" onClick=${() => startAddEndpoint('openai-compatible')}>
                    <i class="fa-solid fa-plug"></i> Compatible OpenAI
                  </button>
                  <button class="btn btn-sm btn-primary" onClick=${() => startAddEndpoint('unsloth-studio')}>
                    <i class="fa-solid fa-plus"></i> Unsloth Studio
                  </button>
                </div>
              `}
            </div>

            ${canManageProviders && html`
              <div class="provider-perapp-hint" style=${{
                padding: '10px 12px',
                borderRadius: '8px',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                fontSize: '12px',
                lineHeight: 1.5,
              }}>
                <i class="fa-solid fa-shield-halved" style=${{ marginRight: '6px', color: 'var(--accent)' }}></i>
                Pour LM Studio, activez CORS dans les paramètres développeur du serveur ou démarrez-le avec
                <code>lms server start --cors</code>. Si votre navigateur demande l’accès de ce site
                au réseau local, choisissez <strong>Autoriser</strong>. Les serveurs restent enregistrés dans vos paramètres locaux.
              </div>
            `}

            ${localProviders.length === 0 && !showAddForm && html`
              <div class="provider-empty">
                <i class="fa-solid fa-desktop" style=${{ opacity: 0.4, fontSize: '24px' }}></i>
                <span>Aucun serveur local configuré</span>
                <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Ajoutez LM Studio ou Unsloth Studio pour utiliser des modèles locaux
                </span>
              </div>
            `}

            ${localProviders.map(p => (canManageProviders && editingId === p.id) ? html`
              <!-- Inline edit form -->
              <div class="provider-card editing" key=${p.id}>
                <div class="form-group">
                  <label>Nom</label>
                  <input class="form-input" value=${newName} onInput=${e => setNewName(e.target.value)} placeholder=${localProviderMeta(p.type).placeholderName} />
                </div>
                <div class="form-group">
                  <label>URL de base</label>
                  <input class="form-input" value=${newUrl} onInput=${e => setNewUrl(e.target.value)} placeholder=${localProviderMeta(p.type).placeholderUrl} />
                </div>
                ${localProviderMeta(p.type).needsKey && html`
                  <div class="form-group">
                    <label>Clé API</label>
                    <input class="form-input" type="password" value=${newApiKey}
                      onInput=${e => setNewApiKey(e.target.value)}
                      placeholder=${localProviderMeta(p.type).keyPlaceholder || 'sk-unsloth-...'}
                      style=${{ fontFamily: 'monospace', fontSize: '13px' }}
                    />
                  </div>
                `}
                ${endpointExtras(p.type)}
                <div style=${{ display: 'flex', gap: '8px' }}>
                  <div class="form-group" style=${{ flex: 1 }}>
                    <label>Étiquettes</label>
                    <input class="form-input" value=${newTags} onInput=${e => setNewTags(e.target.value)} placeholder="réseau-local, gpu, principal" />
                  </div>
                  <div class="form-group" style=${{ width: '100px' }}>
                    <label>Délai maximal (ms)</label>
                    <input class="form-input" type="number" value=${newTimeout} onInput=${e => setNewTimeout(e.target.value)} />
                  </div>
                </div>
                <div style=${{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button class="btn btn-sm" onClick=${handleCancelEdit}>Annuler</button>
                  <button class="btn btn-sm btn-primary" onClick=${handleSaveEdit}>Enregistrer</button>
                </div>
              </div>
            ` : html`
              <div class="provider-card" key=${p.id}>
                <div class="provider-card-header">
                  <div class="provider-card-info">
                    <span class="provider-card-name">
                      <i class=${`fa-solid ${localProviderMeta(p.type).icon}`} style=${{ marginRight: '6px', color: 'var(--text-muted)' }}></i>
                      ${p.name}${statusDot(p.id)}
                    </span>
                    <span class="provider-card-url">${p.baseUrl}</span>
                    ${p.tags?.length > 0 && html`
                      <div class="provider-card-tags">
                        ${p.tags.map(tag => html`<span class="provider-tag" key=${tag}>${tag}</span>`)}
                      </div>
                    `}
                  </div>
                  <div class="provider-card-actions">
                    <button class="btn-icon btn-sm" onClick=${() => handleTest(p)} disabled=${testing[p.id]} title="Tester la connexion">
                      <i class=${`fa-solid ${testing[p.id] ? 'fa-spinner fa-spin' : 'fa-plug'}`}></i>
                    </button>
                    <button class="btn-icon btn-sm" onClick=${() => handleRefreshModels(p)} disabled=${testing[`refresh-${p.id}`]} title="Actualiser les modèles">
                      <i class=${`fa-solid ${testing[`refresh-${p.id}`] ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`}></i>
                    </button>
                    ${canManageProviders && html`
                      <button class="btn-icon btn-sm" onClick=${() => handleStartEdit(p)} title="Modifier">
                        <i class="fa-solid fa-pen"></i>
                      </button>
                      <button class="btn-icon btn-sm" onClick=${() => handleRemove(p.id)} title="Supprimer" style=${{ color: 'var(--danger)' }}>
                        <i class="fa-solid fa-trash"></i>
                      </button>
                    `}
                    <label class="provider-toggle">
                      <input type="checkbox" checked=${isProviderOnForApp(p)} onChange=${() => handleToggle(p.id)} />
                      <span class="toggle-slider"></span>
                    </label>
                  </div>
                </div>
                ${testResults[p.id] && html`
                  <div class=${`provider-test-result ${testResults[p.id].ok ? 'success' : 'error'}`}>
                    ${testResults[p.id].ok
                      ? html`<i class="fa-solid fa-circle-check"></i> Connecté${testResults[p.id].modelCount ? ` — ${testResults[p.id].modelCount} modèles` : ''}${testResults[p.id].refreshed ? ' (cache actualisé)' : ''}`
                      : html`<i class="fa-solid fa-circle-xmark"></i> ${testResults[p.id].error}`
                    }
                  </div>
                `}
              </div>
            `)}

            <!-- Add Form -->
            ${canManageProviders && showAddForm && !editingId && html`
              <div class="provider-card editing">
                <div class="form-group">
                  <label>Nom</label>
                  <input class="form-input" value=${newName} onInput=${e => setNewName(e.target.value)}
                    placeholder=${localProviderMeta(newType).placeholderName} autoFocus />
                </div>
                <div class="form-group">
                  <label>URL de base</label>
                  <input class="form-input" value=${newUrl} onInput=${e => setNewUrl(e.target.value)}
                    placeholder=${localProviderMeta(newType).placeholderUrl} />
                </div>
                ${localProviderMeta(newType).needsKey && html`
                  <div class="form-group">
                    <label>Clé API</label>
                    <input class="form-input" type="password" value=${newApiKey}
                      onInput=${e => setNewApiKey(e.target.value)}
                      placeholder=${localProviderMeta(newType).keyPlaceholder || 'sk-unsloth-...'}
                      style=${{ fontFamily: 'monospace', fontSize: '13px' }}
                    />
                  </div>
                `}
                ${endpointExtras(newType)}
                <div style=${{ display: 'flex', gap: '8px' }}>
                  <div class="form-group" style=${{ flex: 1 }}>
                    <label>Étiquettes (séparées par des virgules)</label>
                    <input class="form-input" value=${newTags} onInput=${e => setNewTags(e.target.value)}
                      placeholder="réseau-local, gpu, principal" />
                  </div>
                  <div class="form-group" style=${{ width: '100px' }}>
                    <label>Délai maximal (ms)</label>
                    <input class="form-input" type="number" value=${newTimeout} onInput=${e => setNewTimeout(e.target.value)} />
                  </div>
                </div>
                <div style=${{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button class="btn btn-sm" onClick=${resetEndpointForm}>
                    Annuler
                  </button>
                  <button class="btn btn-sm btn-primary" onClick=${handleAdd} disabled=${!newUrl.trim()}>
                    <i class="fa-solid fa-plus"></i> Ajouter ${localProviderMeta(newType).title}
                  </button>
                </div>
              </div>
            `}
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Fermer</button>
        </div>
      </div>
    </div>
  `;
}
