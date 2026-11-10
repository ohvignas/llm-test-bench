// Live generation status chip — spec 340.
//
// Shows what the model call(s) in flight on this page are doing right now:
//
//   ⏳ Starting · Codex CLI · 4s
//   🧠 Thinking · 3.1k tokens · 58s   usually 40s–1m 30s
//   ✍️ Writing · 12.4k chars · 1m 12s
//
// It reads generation-telemetry's in-flight registry, which every provider
// call already feeds, so an app only has to render it — as a component in its
// own toolbar, or floating via mountGenerationStatus() with one line of code.
// The "usually" range is this model's p25–p75 over the last 30 days, from
// serve.py; it is simply absent without serve.py or history.

import { html, render } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { subscribeInFlight, fetchTypical } from '../services/generation-telemetry.js';

const PHASE_LABELS = {
  queued: 'En attente', dispatched: 'Envoi', spawned: 'Démarrage', firstOutput: 'Démarrage',
  sessionReady: 'Attente du modèle', firstThought: 'Raisonnement', firstToken: 'Rédaction',
  firstTool: 'Utilisation des outils', done: 'Terminé',
};

const ICONS = {
  queued: 'fa-hourglass-start',
  dispatched: 'fa-paper-plane',
  spawned: 'fa-power-off',
  firstOutput: 'fa-power-off',
  sessionReady: 'fa-hourglass-half',
  firstThought: 'fa-brain',
  firstToken: 'fa-pen-nib',
  firstTool: 'fa-screwdriver-wrench',
};

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m}m ${rest}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatCount(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function modelLabel(snapshot) {
  const provider = snapshot.providerName || snapshot.providerId;
  const model = snapshot.modelId && !['default', '__cli_default__'].includes(snapshot.modelId)
    ? snapshot.modelId.split('/').pop() : '';
  return model ? `${provider} · ${model}` : provider;
}

/** The p25–p75 hint relevant to the phase a call is in, if any. */
export function typicalHint(snapshot, typical) {
  if (!typical) return '';
  const range = (stat) => (stat && stat.n >= 3 ? `habituellement ${formatDuration(stat.p25)}–${formatDuration(stat.p75)}` : '');
  if (snapshot.phase === 'firstThought') return range(typical.think);
  if (snapshot.phase === 'firstToken' || snapshot.phase === 'firstTool') return range(typical.total);
  return range(typical.waitFirstWord);
}

function useInFlight() {
  const [calls, setCalls] = useState([]);
  const [, setTick] = useState(0);
  useEffect(() => subscribeInFlight(setCalls), []);
  // Elapsed times move even when no event arrives (a long redacted think).
  useEffect(() => {
    if (!calls.length) return undefined;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [calls.length]);
  return calls;
}

function useTypical(snapshot) {
  const [typical, setTypical] = useState(null);
  const key = snapshot ? `${snapshot.providerId}::${snapshot.modelId}` : '';
  useEffect(() => {
    if (!snapshot) return undefined;
    let live = true;
    fetchTypical(snapshot.providerId, snapshot.modelId).then(v => { if (live) setTypical(v); });
    return () => { live = false; };
  }, [key]);
  return typical;
}

/**
 * The chip. Renders nothing while no call is in flight.
 * `filter(snapshot)` narrows which calls it follows (default: all on the page).
 */
export function GenerationStatus({ filter = null, className = '' }) {
  ensureStyles();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const all = useInFlight();
  const calls = filter ? all.filter(filter) : all;
  const current = calls.length ? calls.reduce((a, b) => (b.startedAt > a.startedAt ? b : a)) : null;
  const typical = useTypical(current);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const closeEscape = event => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [open]);
  useEffect(() => { if (!calls.length) setOpen(false); }, [calls.length]);
  if (!current) return null;

  // Snapshots are only taken when an event arrives; the clock keeps moving.
  const elapsed = Math.max(current.elapsedMs, Date.now() - current.startedAt);
  const hint = typicalHint(current, typical);
  const label = PHASE_LABELS[current.phase] || current.label;
  const title = [
    `${label} — ${modelLabel(current)}`,
    `Démarré il y a ${formatDuration(elapsed)} (${current.entry || 'appel'})`,
    hint,
    calls.length > 1 ? `${calls.length} appels en cours sur cette page` : '',
    'Afficher le suivi de chaque appel, sans quitter la page.',
  ].filter(Boolean).join('\n');

  return html`
    <div class="gen-status-root" ref=${root}>
    <button type="button" ref=${trigger} class=${`gen-status gen-status-${current.phase} ${className}`}
      aria-label=${`Suivi des générations : ${calls.length} appel(s) en cours`}
      aria-expanded=${open} title=${title} onClick=${() => setOpen(value => !value)}>
      <i aria-hidden="true" class=${`fa-solid ${ICONS[current.phase] || 'fa-circle-notch'}`}></i>
      <span class="gen-status-label">${calls.length > 1 ? `${calls.length} appels en cours` : label}</span>
      <span class="gen-status-model">${modelLabel(current)}</span>
      <span class="gen-status-time">${formatDuration(elapsed)}</span>
    </button>
    ${open && html`<section class="gen-status-panel" aria-label="Suivi des générations">
      <header><strong>Suivi des générations · ${calls.length}</strong>
        <button type="button" aria-label="Fermer le suivi" onClick=${() => {setOpen(false);trigger.current?.focus();}}>×</button></header>
      <div class="gen-status-calls">${calls.map(call => html`<article key=${call.id}>
        <strong>${modelLabel(call)}</strong>
        <div class="gen-status-metrics"><span>${PHASE_LABELS[call.phase] || call.label}</span>
          <span>${formatDuration(Math.max(call.elapsedMs, Date.now() - call.startedAt))}</span></div>
        <div>${Number(call.outputChars || 0).toLocaleString('fr-FR')} caractères reçus · ${Number(call.reasoningChunks || 0).toLocaleString('fr-FR')} signaux de raisonnement</div>
        <small>${Number.isFinite(call.lastReceivedAt) ? `Dernier signal reçu il y a ${formatDuration(Date.now() - call.lastReceivedAt)}` : 'En attente du premier signal du fournisseur'}</small>
        ${!call.outputChars && call.phase === 'firstThought' && html`<p>Le fournisseur signale du raisonnement ; aucun code reçu pour cet appel.</p>`}
      </article>`)}</div>
      <footer>Les signaux ne sont pas des tokens. Ils ne permettent pas de vérifier le contenu du raisonnement interne. Les coûts confirmés figurent dans le journal du lot.</footer>
    </section>`}
    </div>
  `;
}

/**
 * Float the chip in a page corner — the one-line adoption path:
 *   mountGenerationStatus();                     // bottom-left
 *   mountGenerationStatus({ corner: 'bottom-right' });
 * Returns an unmount function.
 */
export function mountGenerationStatus({ corner = 'bottom-left', filter = null } = {}) {
  if (typeof document === 'undefined') return () => {};
  const host = document.createElement('div');
  host.className = `gen-status-host gen-status-host-${corner}`;
  document.body.appendChild(host);
  render(html`<${GenerationStatus} filter=${filter} />`, host);
  return () => { render(null, host); host.remove(); };
}

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.dataset.owner = 'generation-status';
  style.textContent = `
.gen-status-root { position: relative; max-width: 100%; font-family: system-ui, sans-serif; }
.gen-status { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; cursor: pointer;
  padding: 3px 10px; border-radius: 999px; font-size: 12px; line-height: 18px;
  background: var(--bg-tertiary, #2a2a2a); color: var(--text-primary, #eee);
  border: 1px solid var(--border-color, #444); text-decoration: none; white-space: nowrap;
  overflow: hidden; }
.gen-status:hover { border-color: var(--accent, #60a5fa); }
.gen-status:focus-visible { outline: 2px solid var(--accent, #60a5fa); outline-offset: 3px; }
.gen-status i { color: var(--accent, #60a5fa); }
.gen-status-firstThought i { animation: gen-status-pulse 1.6s ease-in-out infinite; }
.gen-status-label { font-weight: 600; flex-shrink: 0; }
.gen-status-model { color: var(--text-secondary, #bbb); overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 220px; }
.gen-status-time { flex-shrink: 0; }
.gen-status-detail, .gen-status-time { font-variant-numeric: tabular-nums; }
.gen-status-hint { color: var(--text-muted, #888); }
.gen-status-more { color: var(--text-muted, #888); }
.gen-status-host { position: fixed; z-index: 9000; max-width: calc(100vw - 24px); pointer-events: none; }
.gen-status-host .gen-status { pointer-events: auto; box-shadow: var(--shadow, 0 2px 8px rgba(0,0,0,.3)); }
.gen-status-panel { position: absolute; bottom: calc(100% + 10px); left: 0; width: min(420px, calc(100vw - 24px));
  box-sizing: border-box; max-height: min(600px, calc(100dvh - 110px)); display: flex; flex-direction: column;
  pointer-events: auto; background: var(--bg-secondary, #202124); color: var(--text-primary, #eee);
  border: 1px solid var(--border-color, #555); border-radius: 12px; box-shadow: 0 8px 36px #0008;
  font-size: 13px; line-height: 1.5; white-space: normal; overflow: hidden; text-align: left; }
.gen-status-panel header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; }
.gen-status-panel header button { border: 0; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font-size: 24px; padding: 0 8px; }
.gen-status-calls { overflow: auto; min-height: 0; }
.gen-status-calls article { padding: 12px 14px; border-top: 1px solid var(--border-color, #444); overflow-wrap: anywhere; }
.gen-status-metrics { display: flex; justify-content: space-between; gap: 12px; margin: 5px 0; color: var(--accent, #60a5fa); }
.gen-status-calls p { margin: 7px 0 0; color: #fbbf24; }
.gen-status-calls small, .gen-status-panel footer { color: var(--text-secondary, #bbb); }
.gen-status-panel footer { padding: 10px 14px; border-top: 1px solid var(--border-color, #444); font-size: 12px; }
.gen-status-host-bottom-right .gen-status-panel, .gen-status-host-top-right .gen-status-panel { left: auto; right: 0; }
.gen-status-host-top-right .gen-status-panel { bottom: auto; top: calc(100% + 10px); }
@media (max-width: 480px) { .gen-status-model { max-width: 105px; } }
.gen-status-host-bottom-left { left: 12px; bottom: 12px; }
.gen-status-host-bottom-right { right: 12px; bottom: 12px; }
.gen-status-host-top-right { right: 12px; top: 56px; }
@keyframes gen-status-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .gen-status-firstThought i { animation: none; } }
`;
  document.head.appendChild(style);
}
