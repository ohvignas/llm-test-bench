import { html } from 'htm/preact';
import { ExecutorModelSelector } from '../../shared/components/ExecutorModelSelector.js';
import { CodingAgentActivity } from '../../shared/components/CodingAgentActivity.js';
import { RecordVideoButton } from '../../shared/components/RecordVideoButton.js';

export function Toolbar({
  route,
  theme,
  onNavigate,
  onToggleTheme, onHelp,
  onSave,
  onClear,
  hasDirectory,
  directoryName,
  onPickDirectory,
  // Provider/model props
  allModels,
  selectedProviderId,
  selectedModelId,
  backend,
  agentId,
  agentModelId,
  onExecutorChange,
  onGenerate,
  onCancelAgent,
  agentRunning,
  agentCancelling,
  isGenerating,
  modelsLoading,
  hasApiKey,
  onApiKeyClick,
  onProviderSettingsClick,
  onBatch,
  recordingProps,
}) {
  return html`
    <div class="toolbar">
      <div class="toolbar-left">
        <a class="btn-icon hub-link" href="../" title="Retour à l’accueil">
          <i class="fa-solid fa-grip"></i>
        </a>
        <span class="app-title">
          <i class="fa-solid fa-images"></i> Prompt Gallery
        </span>
        <div class="toolbar-divider"></div>
        <!-- The picker stays on every tab: Prompts runs generations, Refine and
             Batch both use whatever is selected here, and Compare/Gallery are
             where you decide what to run next. Only Generate is Create-only. -->
        <div class="openrouter-group">
          <button
            class=${`btn-icon btn-key ${hasApiKey ? 'api-key-set' : 'api-key-missing'}`}
            onClick=${onApiKeyClick}
            title=${hasApiKey ? 'Clé API configurée (cliquer pour gérer)' : 'Configurer votre clé API OpenRouter gratuite'}
          >
            <i class="fa-solid fa-key"></i>
          </button>
          <button
            class="btn-icon"
            onClick=${onProviderSettingsClick}
            title="Paramètres des fournisseurs"
            style=${{ fontSize: '13px', padding: '4px 8px' }}
          >
            <i class="fa-solid fa-server"></i>
          </button>
          <${ExecutorModelSelector}
            models=${allModels}
            backend=${backend}
            providerId=${selectedProviderId}
            modelId=${selectedModelId}
            agentId=${agentId}
            agentModelId=${agentModelId}
            onChange=${onExecutorChange}
            disabled=${allModels.length === 0 && !modelsLoading && backend !== 'agent'}
            loading=${modelsLoading}
            onSettingsClick=${onProviderSettingsClick}
          />
          ${agentRunning
            // Stop is shown wherever a run is live — a run started from Prompts
            // must still be stoppable after navigating away from Create.
            ? html`
              <button class="btn" onClick=${onCancelAgent} disabled=${agentCancelling}
                title="Arrêter la génération en cours">
                <i class="fa-solid fa-stop"></i>
                <span class="btn-label">${agentCancelling ? 'Arrêt…' : 'Arrêter'}</span>
              </button>`
            : route === 'create' && html`
              <button
                class=${`btn ${isGenerating ? 'btn-generating' : 'btn-generate'}`}
                onClick=${onGenerate}
                disabled=${isGenerating}
                title=${allModels.length > 0 || backend === 'agent' ? 'Générer du HTML à partir du prompt' : 'Configurez d’abord un fournisseur'}
              >
                <i class=${`fa-solid ${isGenerating ? 'fa-spinner fa-spin' : backend === 'agent' ? 'fa-terminal' : 'fa-bolt'}`}></i>
                <span class="btn-label">${isGenerating ? 'Génération…' : 'Générer'}</span>
              </button>`}
        </div>
      </div>

      <div class="toolbar-center">
        <button
          class=${`nav-tab ${route === 'create' ? 'active' : ''}`}
          onClick=${() => onNavigate('create')}
        >
          <i class="fa-solid fa-plus"></i> Créer
        </button>
        <button
          class=${`nav-tab ${route === 'prompts' ? 'active' : ''}`}
          onClick=${() => onNavigate('prompts')}
        >
          <i class="fa-solid fa-book"></i> Prompts
        </button>
        <button
          class=${`nav-tab ${route === 'refine' ? 'active' : ''}`}
          onClick=${() => onNavigate('refine')}
        >
          <i class="fa-solid fa-screwdriver-wrench"></i> Améliorer
        </button>
        <button
          class=${`nav-tab ${route === 'gallery' ? 'active' : ''}`}
          onClick=${() => onNavigate('gallery')}
        >
          <i class="fa-solid fa-images"></i> Galerie
        </button>
        <button
          class=${`nav-tab ${route === 'compare' ? 'active' : ''}`}
          onClick=${() => onNavigate('compare')}
        >
          <i class="fa-solid fa-columns"></i> Comparer
        </button>
        <button
          class=${`nav-tab ${route === 'runs' ? 'active' : ''}`}
          onClick=${() => onNavigate('runs')}
        >
          <i class="fa-solid fa-layer-group"></i> Exécutions
        </button>
      </div>

      <div class="toolbar-right">
        <${CodingAgentActivity} appId="prompt-gallery" />
        <button
          class="btn btn-directory"
          onClick=${onPickDirectory}
          title=${hasDirectory ? `Dossier de la galerie : ${directoryName} (cliquer pour modifier)` : 'Connecter un dossier pour enregistrer votre travail'}
        >
          <i class=${`fa-solid ${hasDirectory ? 'fa-folder-open' : 'fa-folder-plus'}`}></i>
          <span class="btn-label directory-name">${hasDirectory ? directoryName : 'Connecter un dossier'}</span>
        </button>
        <button class="btn btn-batch" onClick=${onBatch} title="Exécuter un modèle sur votre bibliothèque de prompts">
          <i class="fa-solid fa-layer-group"></i>
          <span class="btn-label">Lots</span>
        </button>
        <${RecordVideoButton} ...${recordingProps} />
        ${route === 'create' && html`
          <div class="toolbar-divider"></div>
          <button class="btn" onClick=${onClear} title="Effacer tous les champs">
            <i class="fa-solid fa-eraser"></i>
            <span class="btn-label">Effacer</span>
          </button>
          <button class="btn btn-primary" onClick=${onSave} title="Enregistrer (Ctrl+S)">
            <i class="fa-solid fa-floppy-disk"></i>
            <span class="btn-label">Enregistrer</span>
          </button>
        `}
        <button class="btn-icon" onClick=${onHelp} title="Aide">
          <i class="fa-solid fa-circle-question"></i>
        </button>
        <button
          class="btn-icon"
          onClick=${onToggleTheme}
          title=${`Passer au thème ${theme === 'dark' ? 'clair' : 'sombre'}`}
        >
          <i class=${`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
        </button>
      </div>
    </div>
  `;
}
