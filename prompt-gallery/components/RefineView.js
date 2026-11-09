import { html } from 'htm/preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { PlayOverlay } from '../../shared/components/PlayOverlay.js';
import { refineDisplayTitle, refineVersions } from '../services/refineVersions.js';
import { runHtmlSandbox, runStatusLabel } from '../services/sandboxRunner.js';
import * as refine from '../services/refine.js';

// The Refine call in flight. Module-level rather than a ref: the session (and
// its `busy` flag) outlives this view when the user switches tabs mid-call, and
// Stop must still reach the call on return. Only one call runs at a time.
let refineAbort = null;

function beginRefineCall() {
  refineAbort = new AbortController();
  return refineAbort;
}

function endRefineCall(abort) {
  if (refineAbort === abort) refineAbort = null;
}

// Same trick as the gallery's ViewIframe: apply srcdoc only after layout so
// pages that capture window size at boot (THREE.js etc.) don't start at 0x0.
const RESIZE_SHIM = `<script>
(function(){
  function kick(){
    if (window.innerWidth > 0 && window.innerHeight > 0) {
      try { window.dispatchEvent(new Event('resize')); } catch(e){}
      return true;
    }
    return false;
  }
  if (!kick()) {
    var tries = 0;
    var iv = setInterval(function(){ tries++; if (kick() || tries > 30) clearInterval(iv); }, 50);
  }
  window.addEventListener('load', function(){ setTimeout(kick, 50); });
})();
<\/script>`;

function withResizeShim(htmlContent) {
  if (!htmlContent) return htmlContent;
  const headMatch = htmlContent.match(/<head[^>]*>/i);
  if (headMatch) {
    const idx = headMatch.index + headMatch[0].length;
    return htmlContent.slice(0, idx) + RESIZE_SHIM + htmlContent.slice(idx);
  }
  return RESIZE_SHIM + htmlContent;
}

function LiveHtmlFrame({ frameKey, html: htmlContent }) {
  const ref = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled || !node.isConnected) return;
      if (node.offsetWidth > 0 && node.offsetHeight > 0) {
        node.srcdoc = withResizeShim(htmlContent);
      } else {
        requestAnimationFrame(apply);
      }
    };
    requestAnimationFrame(apply);
    return () => { cancelled = true; };
  }, [frameKey, htmlContent]);
  return html`<iframe ref=${ref} sandbox="allow-scripts" title="Aperçu de l’amélioration" />`;
}

const STEP_ICONS = { original: 'fa-file-code', heal: 'fa-kit-medical', improve: 'fa-wand-magic-sparkles' };

function statusDotClass(status) {
  if (!status) return 'refine-dot-pending';
  if (status.timedOut || status.errors.length > 0) return 'refine-dot-error';
  if (status.warnings.length > 0) return 'refine-dot-warn';
  return 'refine-dot-ok';
}

export function RefineView({
  session,
  onSessionChange,
  hasModel,
  providerId,
  modelId,
  hasDirectory,
  onSaveStep,
  addToast,
}) {
  const [attempts, setAttempts] = useState(1);
  const [errorsOpen, setErrorsOpen] = useState(false);
  // Full-window play of any step; `opened` keys a fresh player per opening.
  const [playing, setPlaying] = useState(null);

  const steps = session?.steps || [];
  const activeIndex = Math.min(session?.activeIndex || 0, steps.length - 1);
  const activeStep = steps[activeIndex] || null;
  const busy = session?.busy || null;
  const versions = useMemo(() => refineVersions(steps), [steps]);

  // ── session update helpers (always functional — async ops outlive renders) ──

  const patchSession = useCallback((patch) => {
    onSessionChange(prev => prev ? { ...prev, ...patch } : prev);
  }, [onSessionChange]);

  const patchStep = useCallback((index, patch) => {
    onSessionChange(prev => {
      if (!prev) return prev;
      const next = [...prev.steps];
      if (!next[index]) return prev;
      next[index] = { ...next[index], ...patch };
      return { ...prev, steps: next };
    });
  }, [onSessionChange]);

  // Append a step and make it active. The caller computes the new step's
  // index itself (busy-guarding means only the running operation appends, so
  // indices are deterministic — state updaters may not run synchronously).
  const appendStep = useCallback((step) => {
    onSessionChange(prev => {
      if (!prev) return prev;
      return { ...prev, steps: [...prev.steps, step], activeIndex: prev.steps.length };
    });
  }, [onSessionChange]);

  // ── sandbox runs ──

  const runStep = useCallback(async (index, htmlContent) => {
    patchStep(index, { runStatus: null, running: true });
    const status = await runHtmlSandbox(htmlContent);
    patchStep(index, { runStatus: status, running: false });
    return status;
  }, [patchStep]);

  // Auto-run the active step once when it has no result yet.
  useEffect(() => {
    if (!activeStep || activeStep.runStatus || activeStep.running || busy) return;
    runStep(activeIndex, activeStep.html);
  }, [activeStep, activeIndex, busy, runStep]);

  // ── heal ──

  const handleHeal = useCallback(async () => {
    if (!activeStep || busy) return;
    if (!hasModel) { addToast('Sélectionnez d’abord un modèle', 'error'); return; }
    const startStatus = activeStep.runStatus;
    if (!startStatus || startStatus.errors.length === 0) {
      addToast('Aucune erreur capturée à corriger', 'info');
      return;
    }
    patchSession({ busy: 'heal', streamBytes: 0 });
    const abort = beginRefineCall();
    try {
      const baseLen = steps.length;
      let currentHtml = activeStep.html;
      let currentErrors = startStatus.errors;
      for (let n = 1; n <= attempts; n++) {
        const healed = await refine.healHtml({
          providerId, modelId,
          prompt: session.prompt,
          html: currentHtml,
          errors: currentErrors,
          onChunk: (text) => patchSession({ streamBytes: text.length }),
          signal: abort.signal,
        });
        if (!healed || !healed.trim()) throw new Error('Le modèle a renvoyé un document vide');
        const stepIndex = baseLen + (n - 1);
        appendStep({
          kind: 'heal',
          label: attempts > 1 ? `Tentative de correction ${n}` : 'Corrigé',
          summary: `Correction : ${currentErrors.length} erreur${currentErrors.length === 1 ? '' : 's'} traitée${currentErrors.length === 1 ? '' : 's'}`,
          html: healed,
          runStatus: null,
        });
        const status = await runStep(stepIndex, healed);
        if (status.ok) {
          addToast(`Correction réussie : aucune erreur dans le bac à sable (tentative ${n})`, 'success');
          patchStep(stepIndex, { summary: `Correction : ${currentErrors.length} erreur${currentErrors.length === 1 ? '' : 's'} → aucune erreur` });
          return;
        }
        currentHtml = healed;
        currentErrors = status.errors;
      }
      addToast(`Encore ${currentErrors.length} erreur${currentErrors.length === 1 ? '' : 's'} après ${attempts} tentative${attempts === 1 ? '' : 's'}`, 'error');
    } catch (e) {
      if (abort.signal.aborted) addToast('Correction arrêtée', 'info');
      else addToast('Échec de la correction : ' + e.message, 'error');
    } finally {
      endRefineCall(abort);
      patchSession({ busy: null, streamBytes: 0 });
    }
  }, [activeStep, busy, hasModel, attempts, providerId, modelId, session?.prompt, steps.length, patchSession, patchStep, appendStep, runStep, addToast]);

  // ── suggest / apply ──

  const handleSuggest = useCallback(async () => {
    if (!activeStep || busy) return;
    if (!hasModel) { addToast('Sélectionnez d’abord un modèle', 'error'); return; }
    patchSession({ busy: 'suggest', suggestions: '' });
    const abort = beginRefineCall();
    try {
      const out = await refine.suggestImprovements({
        providerId, modelId,
        prompt: session.prompt,
        html: activeStep.html,
        onChunk: (text) => patchSession({ suggestions: text }),
        signal: abort.signal,
      });
      if (!out) throw new Error('Le modèle n’a renvoyé aucune suggestion');
      patchSession({ suggestions: out });
      addToast('Suggestions prêtes : modifiez la liste puis appliquez-la', 'success');
    } catch (e) {
      if (abort.signal.aborted) addToast('Suggestions arrêtées', 'info');
      else addToast('Échec des suggestions : ' + e.message, 'error');
    } finally {
      endRefineCall(abort);
      patchSession({ busy: null });
    }
  }, [activeStep, busy, hasModel, providerId, modelId, session?.prompt, patchSession, addToast]);

  const handleApply = useCallback(async () => {
    if (!activeStep || busy) return;
    if (!hasModel) { addToast('Sélectionnez d’abord un modèle', 'error'); return; }
    const instructions = (session.suggestions || '').trim();
    if (!instructions) { addToast('Aucune instruction d’amélioration à appliquer', 'error'); return; }
    patchSession({ busy: 'apply', streamBytes: 0 });
    const abort = beginRefineCall();
    try {
      const improved = await refine.applyImprovements({
        providerId, modelId,
        prompt: session.prompt,
        html: activeStep.html,
        instructions,
        onChunk: (text) => patchSession({ streamBytes: text.length }),
        signal: abort.signal,
      });
      if (!improved || !improved.trim()) throw new Error('Le modèle a renvoyé un document vide');
      const stepIndex = steps.length;
      appendStep({
        kind: 'improve',
        label: 'Améliorations appliquées',
        summary: `Amélioration : ${instructions.split('\n').filter(l => l.trim()).length} instruction(s)\n${instructions}`,
        html: improved,
        runStatus: null,
      });
      patchSession({ suggestions: '' });
      await runStep(stepIndex, improved);
      addToast('Améliorations appliquées', 'success');
    } catch (e) {
      if (abort.signal.aborted) addToast('Application arrêtée : vos instructions sont conservées', 'info');
      else addToast('Échec de l’application : ' + e.message, 'error');
    } finally {
      endRefineCall(abort);
      patchSession({ busy: null, streamBytes: 0 });
    }
  }, [activeStep, busy, hasModel, providerId, modelId, session?.prompt, session?.suggestions, steps.length, patchSession, appendStep, runStep, addToast]);

  // ── empty state ──

  if (!session) {
    return html`
      <div class="refine-view">
        <div class="gallery-empty">
          <i class="fa-solid fa-screwdriver-wrench"></i>
          <p>Aucune génération chargée à améliorer</p>
          <p class="refine-empty-hint">
            Ouvrez une génération dans la galerie puis cliquez sur <strong>Améliorer</strong>,
            ou générez du contenu dans Créer puis cliquez sur <strong>Améliorer</strong> au-dessus de l’aperçu.
          </p>
        </div>
      </div>
    `;
  }

  const status = activeStep?.runStatus;
  const hasErrors = !!status && status.errors.length > 0;
  const streamKb = ((session.streamBytes || 0) / 1024).toFixed(1);
  const alreadySaved = activeStep?.kind === 'original' && !!session.variantKey;

  return html`
    <div class="refine-view">
      <div class="refine-left">
        <div class="refine-header">
          <div class="refine-title" title=${refineDisplayTitle(session)}>
            <i class="fa-solid fa-screwdriver-wrench"></i> ${refineDisplayTitle(session)}
          </div>
          <div class="refine-source">
            ${session.model && html`<span class="model-badge"><i class="fa-solid fa-robot"></i> ${session.model}</span>`}
            ${session.folderId && html`<span class="refine-source-folder">${session.folderId}</span>`}
          </div>
        </div>

        <!-- Play: the active step full window, with every step to choose from -->
        ${versions.length > 0 && html`
          <button
            class="btn-play btn-play-wide refine-play"
            type="button"
            onClick=${() => setPlaying({ initialId: `step-${activeIndex}`, opened: Date.now() })}
            title="Ouvrir en pleine fenêtre et passer de l’original aux étapes améliorées"
          >
            <i class="fa-solid fa-play"></i>
            <span>Lancer${versions.length > 1 ? ` · ${versions.length} versions` : ''}<span class="btn-play-sub">${versions.length > 1
              ? 'Pleine fenêtre à partir de l’étape affichée, avec accès aux autres versions.'
              : 'Pleine fenêtre. Chaque correction ou amélioration ajoute une version.'}</span></span>
          </button>
        `}

        <!-- Run status -->
        <div class=${`refine-status ${!status ? 'pending' : hasErrors || status.timedOut ? 'error' : 'ok'}`}>
          <span class="refine-status-label">
            ${activeStep?.running || (!status && !busy)
              ? html`<i class="fa-solid fa-spinner fa-spin"></i> exécution dans le bac à sable…`
              : html`
                  <i class=${`fa-solid ${hasErrors || status?.timedOut ? 'fa-triangle-exclamation' : 'fa-circle-check'}`}></i>
                  ${runStatusLabel(status)}
                `
            }
          </span>
          <button
            class="btn-icon"
            onClick=${() => activeStep && runStep(activeIndex, activeStep.html)}
            disabled=${!!busy || activeStep?.running}
            title="Relancer la vérification dans le bac à sable"
          >
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          ${status && (status.errors.length > 0 || status.warnings.length > 0) && html`
            <button class="btn-icon" onClick=${() => setErrorsOpen(o => !o)} title=${errorsOpen ? 'Masquer les détails' : 'Afficher les détails'}>
              <i class=${`fa-solid ${errorsOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
            </button>
          `}
        </div>
        ${errorsOpen && status && html`
          <div class="refine-error-list">
            ${status.errors.map((e, i) => html`<div class="refine-error-item" key=${'e' + i}><i class="fa-solid fa-circle-xmark"></i> ${e}</div>`)}
            ${status.warnings.map((w, i) => html`<div class="refine-warn-item" key=${'w' + i}><i class="fa-solid fa-triangle-exclamation"></i> ${w}</div>`)}
          </div>
        `}

        <!-- Actions -->
        <div class="refine-actions">
          <button
            class="btn btn-primary"
            onClick=${handleHeal}
            disabled=${!!busy || !hasErrors}
            title=${hasErrors ? 'Envoyer les erreurs au modèle pour les corriger' : 'Disponible lorsque le bac à sable capture des erreurs'}
          >
            <i class=${`fa-solid ${busy === 'heal' ? 'fa-spinner fa-spin' : 'fa-kit-medical'}`}></i>
            ${busy === 'heal' ? `Correction… ${streamKb} Ko` : 'Corriger'}
          </button>
          <select
            class="form-input refine-attempts"
            value=${attempts}
            onChange=${(e) => setAttempts(parseInt(e.target.value, 10))}
            disabled=${!!busy}
            title="Nombre de nouvelles tentatives si les erreurs persistent"
          >
            <option value="1">1 tentative</option>
            <option value="2">2 tentatives</option>
            <option value="3">3 tentatives</option>
          </select>
          ${['heal', 'suggest', 'apply'].includes(busy) && html`
            <button
              class="btn btn-danger"
              onClick=${() => refineAbort?.abort()}
              title="Arrêter l’appel au modèle en cours (les agents CLI n’ont pas de limite de durée)"
            >
              <i class="fa-solid fa-stop"></i> Arrêter
            </button>`}
          <span class="library-card-actions-spacer"></span>
          <button
            class="btn"
            onClick=${handleSuggest}
            disabled=${!!busy}
            title="Demander des idées d’amélioration au modèle"
          >
            <i class=${`fa-solid ${busy === 'suggest' ? 'fa-spinner fa-spin' : 'fa-lightbulb'}`}></i>
            Proposer des améliorations
          </button>
        </div>

        <!-- Improvements editor: type your own instructions, or let
             "Proposer des améliorations" fill it in — either way, edit then Apply. -->
        <div class="refine-suggestions">
          <div class="section-header">
            <span><i class=${`fa-solid ${busy === 'suggest' ? 'fa-spinner fa-spin' : 'fa-lightbulb'}`}></i> Améliorations (à modifier avant application)</span>
            <div class="section-header-actions">
              <button class="btn-icon" onClick=${() => patchSession({ suggestions: '' })} title="Effacer les instructions" disabled=${!!busy || !session.suggestions}>
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </div>
          <textarea
            class="refine-suggestions-input"
            value=${session.suggestions}
            placeholder="Décrivez les modifications souhaitées (une par ligne) ou cliquez sur Proposer des améliorations…"
            onInput=${(e) => patchSession({ suggestions: e.target.value })}
            disabled=${busy === 'apply' || busy === 'suggest'}
          ></textarea>
          <button
            class="btn btn-primary refine-apply-btn"
            onClick=${handleApply}
            disabled=${!!busy || !(session.suggestions || '').trim()}
            title=${(session.suggestions || '').trim() ? 'Envoyer les instructions au modèle et ajouter le résultat comme nouvelle étape' : 'Saisissez ou générez d’abord des instructions d’amélioration'}
          >
            <i class=${`fa-solid ${busy === 'apply' ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i>
            ${busy === 'apply' ? `Application… ${streamKb} Ko` : 'Appliquer à la génération'}
          </button>
        </div>

        <!-- Step timeline -->
        <div class="refine-timeline">
          <div class="section-header"><span><i class="fa-solid fa-timeline"></i> Étapes</span></div>
          ${steps.map((step, i) => html`
            <div
              class=${`refine-step ${i === activeIndex ? 'active' : ''}`}
              key=${i}
              onClick=${() => !busy && patchSession({ activeIndex: i })}
              title=${step.summary || step.label}
            >
              <span class=${`refine-dot ${statusDotClass(step.runStatus)}`}></span>
              <i class=${`fa-solid ${STEP_ICONS[step.kind] || 'fa-file'}`}></i>
              <span class="refine-step-label">${step.label}</span>
              <span class="refine-step-size">${(step.html.length / 1024).toFixed(1)} KB</span>
            </div>
          `)}
        </div>

        <!-- Save -->
        <div class="refine-save">
          <button
            class="btn btn-primary"
            onClick=${() => onSaveStep(activeIndex)}
            disabled=${!!busy || !activeStep || alreadySaved || !hasDirectory}
            title=${!hasDirectory
              ? 'Connectez d’abord un dossier'
              : alreadySaved
                ? 'Ceci est l’original enregistré : corrigez-le ou améliorez-le d’abord'
                : 'Enregistrer cette étape comme nouvelle variante dans le dossier (l’original est conservé)'}
          >
            <i class="fa-solid fa-floppy-disk"></i> Enregistrer l’étape comme nouvelle variante
          </button>
        </div>
      </div>

      <div class="refine-preview">
        ${activeStep
          ? html`<${LiveHtmlFrame} frameKey=${`${activeIndex}-${steps.length}`} html=${activeStep.html} />`
          : html`<div class="gallery-empty"><i class="fa-solid fa-eye"></i><p>Aucune étape sélectionnée</p></div>`
        }
        ${(busy === 'heal' || busy === 'apply') && html`
          <div class="refine-stream-overlay">
            <i class="fa-solid fa-spinner fa-spin"></i> Réception de ${streamKb} Ko…
          </div>
        `}
      </div>
      ${playing && html`
        <${PlayOverlay}
          key=${playing.opened}
          versions=${versions}
          initialId=${playing.initialId}
          title=${refineDisplayTitle(session)}
          backLabel="Retour à Améliorer"
          onClose=${() => setPlaying(null)}
        />`}
    </div>
  `;
}
