import { html } from 'htm/preact';
import { render } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  createDisplayRecordingSession,
  downloadRecording,
  extensionForMimeType,
  formatBytes,
  formatRecordingDuration,
  recordingFormatSupported,
  recordingSupported,
  saveRecording,
} from '../services/video-recorder.js';

// Toolbars use backdrop-filter, which establishes a containing block for
// fixed descendants in Chromium. Render recording layers at <body> so their
// overlays always span the viewport while keeping the trigger button in the
// app's toolbar. This uses the app's existing Preact instance, not compat.
function BodyPortal({ children }) {
  const hostRef = useRef(null);
  if (!hostRef.current && typeof document !== 'undefined') {
    hostRef.current = document.createElement('div');
    hostRef.current.className = 'record-video-portal';
  }

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    document.body.appendChild(host);
    return () => {
      render(null, host);
      host.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (hostRef.current) render(children, hostRef.current);
  }, [children]);
  return null;
}

export function RecordVideoButton({
  appId,
  appTitle = 'DevTools Hub',
  appHandle = null,
  sourceArtefactId = null,
  metadata,
  label = 'Enregistrer',
  className = 'btn btn-record-video',
  disabled = false,
  onNeedDirectory,
  onSaved,
  onDownloaded,
  onError,
}) {
  const supported = recordingSupported();
  const supportsMp4 = recordingFormatSupported('mp4');
  const supportsWebm = recordingFormatSupported('webm');
  const [phase, setPhase] = useState('idle');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [format, setFormat] = useState(() => supportsMp4 ? 'mp4' : 'webm');
  const [frameRate, setFrameRate] = useState(30);
  const [title, setTitle] = useState(`${appTitle} — enregistrement`);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [savedPath, setSavedPath] = useState('');
  const sessionRef = useRef(null);

  const reportError = useCallback(error => {
    if (error?.name === 'NotAllowedError') return;
    console.error('[RecordVideoButton]', error);
    onError?.(error);
  }, [onError]);

  useEffect(() => {
    if (!recording?.blob) { setPreviewUrl(''); return undefined; }
    const url = URL.createObjectURL(recording.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return undefined;
    const update = () => setElapsed(sessionRef.current?.getDurationMs?.() || 0);
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (session && session.state !== 'inactive') session.stop().catch(() => {});
  }, []);

  const finish = useCallback(result => {
    sessionRef.current = null;
    setRecording(result);
    setElapsed(result.durationMs || 0);
    setSavedPath('');
    setPhase('preview');
  }, []);

  const start = useCallback(async () => {
    if (!supported) return;
    setPhase('requesting');
    setElapsed(0);
    setSavedPath('');
    try {
      const session = await createDisplayRecordingSession({ includeAudio, format, frameRate });
      sessionRef.current = session;
      session.done.then(finish).catch(error => {
        sessionRef.current = null;
        setPhase('idle');
        reportError(error);
      });
      setPhase('preparing');
      // Paint away the permission dialog before encoding the first frame.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        session.start();
        setPhase('recording');
      }));
    } catch (error) {
      sessionRef.current = null;
      setPhase('idle');
      reportError(error);
    }
  }, [supported, includeAudio, format, frameRate, finish, reportError]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setPhase('finalizing');
    session.stop().catch(error => { setPhase('idle'); reportError(error); });
  }, [reportError]);

  const togglePause = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (phase === 'paused') {
      session.resume();
      setPhase('recording');
    } else {
      session.pause();
      setElapsed(session.getDurationMs());
      setPhase('paused');
    }
  }, [phase]);

  const discard = useCallback(() => {
    setRecording(null);
    setPreviewUrl('');
    setSavedPath('');
    setPhase('idle');
  }, []);

  const download = useCallback(() => {
    try {
      const filename = downloadRecording(recording, title);
      onDownloaded?.({ filename, recording });
    } catch (error) { reportError(error); }
  }, [recording, title, onDownloaded, reportError]);

  const save = useCallback(async () => {
    if (!appHandle) { onNeedDirectory?.(); return; }
    setPhase('saving');
    try {
      const extra = typeof metadata === 'function' ? await metadata() : (metadata || {});
      const route = extra.route || globalThis.location?.hash || '';
      const artefactId = typeof sourceArtefactId === 'function'
        ? await sourceArtefactId()
        : sourceArtefactId;
      const result = await saveRecording(appHandle, recording, {
        appId,
        appTitle,
        title,
        sourceArtefactId: artefactId,
        route,
        metadata: extra,
      });
      setSavedPath(result.path);
      setPhase('preview');
      onSaved?.(result);
    } catch (error) {
      setPhase('preview');
      reportError(error);
    }
  }, [appHandle, recording, appId, appTitle, title, sourceArtefactId, metadata, onNeedDirectory, onSaved, reportError]);

  return html`
    <button
      class=${className}
      onClick=${() => setPhase('config')}
      disabled=${disabled || !supported || phase !== 'idle'}
      title=${supported ? 'Enregistrer un onglet, une fenêtre ou un écran' : 'L’enregistrement d’écran est indisponible dans ce navigateur'}
    >
      <i class="fa-solid fa-video"></i><span class="btn-label">${label}</span>
    </button>

    <${BodyPortal}>
      ${(phase === 'config' || phase === 'requesting') && html`
      <div class="modal-overlay record-video-overlay">
        <div class="modal record-video-dialog" onClick=${event => event.stopPropagation()}>
          <div class="modal-header"><h2><i class="fa-solid fa-video"></i> Enregistrer une vidéo</h2><button class="btn-icon" onClick=${() => setPhase('idle')} disabled=${phase === 'requesting'} title="Fermer"><i class="fa-solid fa-xmark"></i></button></div>
          <div class="modal-body record-video-config">
            <div class="record-video-callout"><i class="fa-solid fa-display"></i><div><strong>Choisissez ce que Chrome doit enregistrer</strong><span>À l’étape suivante, choisissez cet onglet, une autre fenêtre ou un écran. Chrome demande votre autorisation à chaque fois.</span></div></div>
            <label class="form-group"><span>Titre de l’enregistrement</span><input class="form-input" value=${title} onInput=${event => setTitle(event.target.value)} /></label>
            <div class="record-video-options">
              <label>Format <select class="form-input record-video-format" value=${format} onChange=${event => setFormat(event.target.value)}>
                ${supportsMp4 && html`<option value="mp4">MP4 · H.264 (recommandé)</option>`}
                ${supportsWebm && html`<option value="webm">WebM · VP9</option>`}
                ${!supportsMp4 && !supportsWebm && html`<option value="webm">Réglage du navigateur</option>`}
              </select></label>
              <label><input type="checkbox" checked=${includeAudio} onChange=${event => setIncludeAudio(event.target.checked)} /> Demander le son de l’onglet ou du système</label>
              <label>Fréquence d’images <select class="form-input" value=${frameRate} onChange=${event => setFrameRate(Number(event.target.value))}><option value="30">30 FPS</option><option value="60">60 FPS</option></select></label>
            </div>
            <div class="record-video-note"><i class="fa-solid fa-circle-info"></i> ${supportsMp4 ? 'Le format MP4 utilise H.264 pour une large compatibilité. ' : 'Ce navigateur ne peut pas encoder directement en MP4 : le format WebM sera utilisé. '}Le son est inclus uniquement si la source choisie et le navigateur le permettent. Les commandes flottantes apparaîtront dans l’enregistrement de cet onglet.</div>
          </div>
          <div class="modal-footer"><button class="btn" onClick=${() => setPhase('idle')} disabled=${phase === 'requesting'}>Annuler</button><button class="btn btn-primary" onClick=${start} disabled=${phase === 'requesting' || !title.trim()}><i class=${`fa-solid ${phase === 'requesting' ? 'fa-spinner fa-spin' : 'fa-arrow-up-right-from-square'}`}></i> ${phase === 'requesting' ? 'En attente de Chrome…' : 'Choisir la source'}</button></div>
        </div>
      </div>
      `}

      ${(phase === 'preparing' || phase === 'recording' || phase === 'paused' || phase === 'finalizing') && html`
      <div class=${`record-video-controls ${phase === 'paused' ? 'is-paused' : ''}`} role="status" aria-live="polite">
        <span class="record-video-dot"></span>
        <strong>${phase === 'preparing' ? 'Démarrage…' : phase === 'finalizing' ? 'Finalisation…' : phase === 'paused' ? 'En pause' : 'Enregistrement'}</strong>
        <span class="record-video-time">${formatRecordingDuration(elapsed)}</span>
        <button class="btn-icon" onClick=${togglePause} disabled=${phase === 'preparing' || phase === 'finalizing'} title=${phase === 'paused' ? 'Reprendre' : 'Pause'}><i class=${`fa-solid ${phase === 'paused' ? 'fa-play' : 'fa-pause'}`}></i></button>
        <button class="btn btn-danger btn-sm" onClick=${stop} disabled=${phase === 'preparing' || phase === 'finalizing'}><i class="fa-solid fa-stop"></i> Arrêter</button>
      </div>
      `}

      ${(phase === 'preview' || phase === 'saving') && recording && html`
      <div class="modal-overlay record-video-overlay">
        <div class="modal record-video-preview-dialog" onClick=${event => event.stopPropagation()}>
          <div class="modal-header"><h2><i class="fa-solid fa-circle-check"></i> Enregistrement terminé</h2><button class="btn-icon" onClick=${discard} title="Fermer"><i class="fa-solid fa-xmark"></i></button></div>
          <div class="modal-body record-video-preview-body">
            <video class="record-video-preview" src=${previewUrl} controls playsinline></video>
            <label class="form-group"><span>Titre</span><input class="form-input" value=${title} onInput=${event => setTitle(event.target.value)} /></label>
            <div class="record-video-facts">
              <span><i class="fa-solid fa-clock"></i> ${formatRecordingDuration(recording.durationMs)}</span>
              <span><i class="fa-solid fa-expand"></i> ${recording.width && recording.height ? `${recording.width}×${recording.height}` : 'dimensions de la source'}</span>
              <span><i class="fa-solid fa-film"></i> ${recording.frameRate || frameRate} FPS</span>
              <span><i class="fa-solid fa-file-video"></i> ${(recording.extension || extensionForMimeType(recording.mimeType)).toUpperCase()}</span>
              <span><i class="fa-solid fa-hard-drive"></i> ${formatBytes(recording.sizeBytes)}</span>
              <span><i class=${`fa-solid ${recording.audio ? 'fa-volume-high' : 'fa-volume-xmark'}`}></i> ${recording.audio ? 'audio' : 'sans son'}</span>
            </div>
            ${savedPath && html`<div class="record-video-saved"><i class="fa-solid fa-folder-open"></i><span>Enregistré sans écrasement dans <code>${savedPath}</code></span></div>`}
            ${!appHandle && html`<div class="record-video-note"><i class="fa-solid fa-folder-plus"></i> Connectez un dossier de données pour conserver cet enregistrement avec l’application. Le téléchargement reste possible sans dossier.</div>`}
          </div>
          <div class="modal-footer record-video-preview-actions">
            <button class="btn btn-danger" onClick=${discard}><i class="fa-solid fa-trash"></i> Abandonner</button>
            <span class="toolbar-spacer"></span>
            <button class="btn" onClick=${download}><i class="fa-solid fa-download"></i> Télécharger</button>
            ${appHandle
              ? html`<button class="btn btn-primary" onClick=${save} disabled=${phase === 'saving' || !!savedPath}><i class=${`fa-solid ${phase === 'saving' ? 'fa-spinner fa-spin' : savedPath ? 'fa-check' : 'fa-floppy-disk'}`}></i> ${phase === 'saving' ? 'Enregistrement…' : savedPath ? 'Enregistré' : 'Enregistrer dans le dossier de données'}</button>`
              : html`<button class="btn btn-primary" onClick=${onNeedDirectory}><i class="fa-solid fa-folder-plus"></i> Connecter un dossier de données</button>`}
          </div>
        </div>
      </div>
      `}
    </${BodyPortal}>
  `;
}
