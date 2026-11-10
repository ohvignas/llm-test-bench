import { html } from 'htm/preact';
import { useRef, useEffect, useState } from 'preact/hooks';
import {
  completionTokenCount,
  estimatedTokenCount,
  formatTokensPerSecond,
  tokensPerSecond,
} from '../services/batchMetrics.js';
import { consoleCounts, entryLine, formatConsoleForCopy } from '../services/previewConsole.js';
import { BatchCosts } from './BatchCosts.js';
import {AgentSettings} from './AgentSettings.js';

export function PromptEditor({
  prompt,
  onPromptChange,
  response,
  onResponseChange,
  responseStats,
  responseTiming,
  responseCosts = [],
  isGenerating,
  agentEnabled=false,
  theme,
  onMorph,
  onSavePromptToLibrary,
  consoleEntries = [],
  checkStatus = null,
  responseView = 'code',
  onResponseViewChange,
  onClearConsole,
  showFullscreenPreview = false,   // the full-screen preview is controlled by the app,
  onFullscreenPreviewChange,       // so a button outside the editor can open it too
}) {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const silentUpdate = useRef(false);
  const copyTimerRef = useRef(null);
  const setShowFullscreenPreview = (open) => onFullscreenPreviewChange?.(open);
  const [copiedTarget, setCopiedTarget] = useState('');
  const [rateClock, setRateClock] = useState(Date.now());

  const responseCharacters = String(response || '').length;
  const reportedTokens = completionTokenCount(responseStats);
  const responseTokens = reportedTokens ?? estimatedTokenCount(response);
  const responseTokenRate = tokensPerSecond(responseStats, responseTokens, responseTiming, rateClock);
  // A half-written page throws on its unfinished scripts, so nothing is
  // counted until the generation ends.
  const liveEntries = isGenerating ? [] : consoleEntries;
  const liveCounts = consoleCounts(liveEntries);
  const checkErrors = checkStatus && !checkStatus.running
    ? (checkStatus.timedOut ? ['Délai de vérification automatique dépassé : boucle infinie ou chargement bloqué possible'] : (checkStatus.errors || []))
    : [];
  const errorTotal = liveCounts.errors + checkErrors.length;
  const showErrors = responseView === 'errors';
  const pendingJumpRef = useRef(null);

  useEffect(() => {
    if (!isGenerating || !responseCharacters || !responseTiming?.startedAt) return undefined;
    setRateClock(Date.now());
    const timer = window.setInterval(() => setRateClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating, responseCharacters, responseTiming?.startedAt]);

  // Initialize Ace Editor for HTML response
  useEffect(() => {
    if (!containerRef.current || editorRef.current) return;

    const editor = window.ace.edit(containerRef.current, {
      mode: 'ace/mode/html',
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      wrap: true,
      showPrintMargin: false,
      tabSize: 2,
      useSoftTabs: true,
      scrollPastEnd: 0.5,
    });
    // Ace's hidden textarea is what screen readers and axe see.
    editor.textInput.getElement().setAttribute('aria-label', 'Éditeur de code HTML');

    editor.setValue(response, -1);

    editor.session.on('change', () => {
      if (silentUpdate.current) return;
      onResponseChange(editor.getValue());
    });

    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  // Sync response value from parent
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.getValue() !== response) {
      silentUpdate.current = true;
      const pos = editor.getCursorPosition();
      editor.setValue(response, -1);
      editor.moveCursorToPosition(pos);
      editor.clearSelection();
      silentUpdate.current = false;
    }
  }, [response]);

  // Sync theme
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.setTheme(theme === 'dark' ? 'ace/theme/monokai' : 'ace/theme/chrome');
  }, [theme]);

  // Resize on container changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const observer = new ResizeObserver(() => editor.resize());
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // "line N" in the errors list: back to the code, then to that line.
  useEffect(() => {
    const editor = editorRef.current;
    const jump = pendingJumpRef.current;
    if (showErrors || !editor || !jump) return;
    pendingJumpRef.current = null;
    editor.resize(true);
    editor.gotoLine(jump.line, Math.max(0, jump.col - 1), true);
    editor.scrollToLine(jump.line, true, true, () => {});
    editor.focus();
  }, [showErrors]);

  const jumpToLine = (at) => {
    pendingJumpRef.current = at;
    onResponseViewChange?.('code');
  };

  useEffect(() => {
    if (!showFullscreenPreview) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setShowFullscreenPreview(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFullscreenPreview]);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const copyText = async (text, target) => {
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      setCopiedTarget(target);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedTarget(''), 1200);
    } catch (e) {
      console.warn('Copy failed:', e);
    }
  };

  return html`
    <div class="create-left">
      <!-- Prompt Section -->
      <div class="prompt-section">
        <div class="section-header">
          <span><i class="fa-solid fa-comment-dots"></i> Prompt</span>
          <div class="section-header-actions">
            <button
              class=${`btn-icon copy-btn ${copiedTarget === 'prompt' ? 'copied' : ''}`}
              onClick=${() => copyText(prompt, 'prompt')}
              title=${copiedTarget === 'prompt' ? 'Prompt copié' : 'Copier le prompt'}
              disabled=${!prompt}
              style=${{ fontSize: '12px' }}
            >
              <i class=${`fa-solid ${copiedTarget === 'prompt' ? 'fa-check' : 'fa-copy'}`}></i>
            </button>
            ${onSavePromptToLibrary && html`
              <button
                class="btn-icon"
                onClick=${onSavePromptToLibrary}
                title="Enregistrer ce prompt dans la bibliothèque"
                disabled=${!prompt}
                style=${{ fontSize: '12px' }}
              >
                <i class="fa-solid fa-bookmark"></i>
              </button>
            `}
          </div>
        </div>
        <textarea
          class="prompt-textarea"
          value=${prompt}
          onInput=${(e) => onPromptChange(e.target.value)}
          placeholder="Saisissez votre prompt ici (Markdown accepté)…"
        ></textarea>
      </div>
      ${agentEnabled&&html`<${AgentSettings} disabled=${isGenerating}/>`}
      ${agentEnabled&&responseStats?.agentEvents?.length>0&&html`<details class="bench-agent-settings" open><summary>Activité de l’agent</summary><div class="batch-activity-summary">${responseStats.agentEvents.slice(-8).map(e=>html`<p>${e.message}</p>`)}</div></details>`}
      <!-- Response Section -->
      <div class="response-section">
        ${responseCosts.length > 0 && html`<${BatchCosts} calls=${responseCosts} done=${!isGenerating} />`}
        <div class="section-header">
          ${showErrors
            ? html`<span><i class="fa-solid fa-bug"></i> Erreurs</span>`
            : html`<span><i class="fa-solid fa-code"></i> Réponse HTML</span>`}
          <div class="section-header-actions">
            ${responseCharacters > 0 && html`
              <div class="response-metrics" aria-label="Statistiques de génération de la réponse HTML">
                <span>${responseCharacters.toLocaleString()} caractères reçus</span>
                <span class="response-metric-divider">·</span>
                <span>${responseTokens.toLocaleString()} tokens générés</span>
                <span class="response-metric-divider">·</span>
                <span>${formatTokensPerSecond(responseTokenRate)}</span>
              </div>
            `}
            <button
              class=${`btn-icon response-view-toggle ${showErrors ? 'active' : ''} ${errorTotal ? 'has-errors' : liveCounts.warnings ? 'has-warnings' : ''}`}
              onClick=${() => onResponseViewChange?.(showErrors ? 'code' : 'errors')}
              title=${showErrors
                ? 'Afficher le code généré'
                : errorTotal
                  ? `Afficher les erreurs (${errorTotal})`
                  : liveCounts.warnings ? `Afficher les avertissements (${liveCounts.warnings})` : 'Afficher les erreurs (aucune pour le moment)'}
              aria-pressed=${showErrors}
              style=${{ fontSize: '12px' }}
            >
              <i class=${`fa-solid ${showErrors ? 'fa-code' : 'fa-bug'}`}></i>
              ${!showErrors && (errorTotal || liveCounts.warnings) ? html`
                <span class="response-view-badge">${errorTotal || liveCounts.warnings}</span>
              ` : null}
            </button>
            <button
              class=${`btn-icon copy-btn ${copiedTarget === 'response' ? 'copied' : ''}`}
              onClick=${() => copyText(response, 'response')}
              title=${copiedTarget === 'response' ? 'Réponse HTML copiée' : 'Copier la réponse HTML'}
              disabled=${!response}
              style=${{ fontSize: '12px' }}
            >
              <i class=${`fa-solid ${copiedTarget === 'response' ? 'fa-check' : 'fa-copy'}`}></i>
            </button>
            <button
              class=${`btn-icon ${showFullscreenPreview ? 'active' : ''}`}
              onClick=${() => setShowFullscreenPreview(true)}
              title="Aperçu en plein écran"
              disabled=${!response}
              style=${{ fontSize: '12px' }}
            >
              <i class="fa-solid fa-eye"></i>
            </button>
            ${onMorph && html`
              <button
                class="btn-icon"
                onClick=${onMorph}
                title="Envoyer vers Code Morph Lab"
                disabled=${!response}
                style=${{ fontSize: '12px' }}
              >
                <i class="fa-solid fa-wand-magic-sparkles"></i>
              </button>
            `}
          </div>
        </div>
        <div class="editor-container" ref=${containerRef} hidden=${showErrors}></div>
        ${showErrors && html`
          <div class="response-errors" aria-label="Erreurs de la page générée">
            <div class="response-errors-bar">
              <span>
                ${isGenerating
                  ? 'Les erreurs apparaissent à la fin de la génération.'
                  : `Aperçu : ${liveCounts.errors} erreur${liveCounts.errors === 1 ? '' : 's'}, ${liveCounts.warnings} avertissement${liveCounts.warnings === 1 ? '' : 's'}`}
              </span>
              <span class="library-card-actions-spacer"></span>
              <button
                class=${`btn btn-sm ${copiedTarget === 'errors' ? 'copied' : ''}`}
                onClick=${() => copyText([
                  formatConsoleForCopy(liveEntries),
                  checkErrors.length ? `Vérification automatique :\n${checkErrors.join('\n')}` : '',
                ].filter(Boolean).join('\n\n'), 'errors')}
                disabled=${!liveEntries.length && !checkErrors.length}
                title="Copier toutes les erreurs et tous les avertissements"
              >
                <i class=${`fa-solid ${copiedTarget === 'errors' ? 'fa-check' : 'fa-copy'}`}></i> Copier
              </button>
              <button class="btn btn-sm" onClick=${onClearConsole} disabled=${!liveEntries.length} title="Effacer la liste de l’aperçu (elle se remplit pendant l’exécution)">
                <i class="fa-solid fa-eraser"></i> Effacer
              </button>
            </div>
            <div class="response-errors-list">
              ${!isGenerating && !liveEntries.length && !checkErrors.length && html`
                <div class="response-errors-empty">
                  <i class="fa-solid fa-circle-check"></i>
                  ${response
                    ? 'Aucune erreur ni aucun avertissement pour le moment. Les messages de l’aperçu apparaîtront ici pendant son utilisation.'
                    : 'Générez ou collez du HTML ; ses erreurs apparaîtront ici.'}
                </div>
              `}
              ${liveEntries.map(entry => {
                const at = entryLine(entry);
                return html`
                  <div class=${`response-error ${entry.level}`} key=${entry.key}>
                    <i class=${`fa-solid ${entry.level === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-xmark'}`}></i>
                    <div class="response-error-body">
                      <div class="response-error-message">${entry.message}</div>
                      <div class="response-error-meta">
                        ${at && html`
                          <button class="response-error-line" onClick=${() => jumpToLine(at)} title="Afficher cette ligne dans le code">
                            ligne ${at.line}${at.col ? `:${at.col}` : ''}
                          </button>
                        `}
                        ${entry.count > 1 && html`<span class="response-error-count">×${entry.count.toLocaleString()}</span>`}
                      </div>
                      ${entry.stack && entry.stack !== entry.message && html`
                        <details class="response-error-stack">
                          <summary>Pile d’appels</summary>
                          <pre>${entry.stack}</pre>
                        </details>
                      `}
                    </div>
                  </div>
                `;
              })}
              ${checkErrors.length > 0 && html`
                <div class="response-errors-heading">Vérification automatique (exécution masquée après génération)</div>
                ${checkErrors.map((message, i) => html`
                  <div class="response-error error" key=${`check-${i}`}>
                    <i class="fa-solid fa-circle-xmark"></i>
                    <div class="response-error-body">
                      <div class="response-error-message">${message}</div>
                    </div>
                  </div>
                `)}
              `}
            </div>
          </div>
        `}
      </div>
      ${showFullscreenPreview && html`
        <div class="html-fullscreen-preview" role="dialog" aria-modal="true" aria-label="Aperçu du rendu HTML">
          <div class="html-fullscreen-toolbar">
            <span><i class="fa-solid fa-eye"></i> Rendu HTML</span>
            <button
              class="btn"
              onClick=${() => setShowFullscreenPreview(false)}
              title="Retour à l’éditeur"
            >
              <i class="fa-solid fa-arrow-left"></i>
              Retour
            </button>
          </div>
          <div class="html-fullscreen-frame">
            ${response
              ? html`<iframe
                  srcdoc=${response}
                  sandbox="allow-scripts allow-modals allow-pointer-lock"
                  title="Aperçu du rendu HTML en plein écran"
                />`
              : html`
                  <div class="gallery-empty" style=${{ background: 'var(--bg-primary)' }}>
                    <i class="fa-solid fa-eye"></i>
                    <p>Collez ou saisissez du HTML dans l’éditeur de réponse pour afficher l’aperçu</p>
                  </div>
                `
            }
          </div>
        </div>
      `}
    </div>
  `;
}
