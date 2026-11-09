import { html } from 'htm/preact';
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import { hasApiKey } from '../services/providers-openrouter.js';
import { secureMode } from '../services/secure-session.js';

export function ApiKeyDialog({ currentKey, onSave, onClose }) {
  const [key, setKey] = useState(currentKey || '');
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const configured = !!currentKey || hasApiKey();

  const handleSave = useCallback(async () => {
    setSaving(true);
    try { await onSave(key.trim()); }
    catch (failure) { setError(failure.message); }
    finally { setSaving(false); }
  }, [key, onSave]);

  useEffect(() => {
    const dismiss = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, [onClose]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  return html`
    <div class="modal-overlay">
      <div class="modal" onClick=${(e) => e.stopPropagation()} style=${{ maxWidth: '500px' }}>
        <div class="modal-header">
          <h2><i class="fa-solid fa-key" style=${{ marginRight: '8px', color: 'var(--accent)' }}></i>Clé API OpenRouter</h2>
          <button class="btn-icon" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="modal-body">
          <p style=${{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            ${secureMode()
              ? 'Ta clé est chiffrée et conservée sur ce serveur local. Elle ne sera pas réaffichée et restera disponible après un redémarrage.'
              : 'Ta clé est conservée dans le stockage local de cette application.'}
          </p>

          <div class="form-group">
            <label>${configured ? 'Remplacer la clé enregistrée' : 'Clé API'}</label>
            <input
              ref=${inputRef}
              class="form-input"
              type="password"
              value=${key}
              onInput=${(e) => setKey(e.target.value)}
              onKeyDown=${(e) => e.key === 'Enter' && handleSave()}
              placeholder=${configured ? 'Clé déjà enregistrée — saisir pour remplacer' : 'sk-or-v1-...'}
              style=${{ fontFamily: 'monospace' }}
            />
          </div>

          <p style=${{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
            Créer une clé sur
            <a href="https://openrouter.ai/keys" target="_blank" rel="noopener"
               style=${{ color: 'var(--accent)' }}>openrouter.ai/keys</a>.
            Les appels sont facturés selon le modèle choisi.
          </p>
        </div>

        ${error && html`<p role="alert" style=${{ color: 'var(--danger, #f87171)', padding: '0 20px' }}>${error}</p>`}

        <div class="modal-footer">
          ${configured && html`
            <button class="btn btn-danger" onClick=${() => onSave('')} style=${{ marginRight: 'auto' }}>
              <i class="fa-solid fa-trash"></i> Supprimer la clé
            </button>
          `}
          <button class="btn" onClick=${onClose}>Annuler</button>
          <button class="btn btn-primary" onClick=${handleSave} disabled=${saving || !key.trim()}>
            <i class="fa-solid fa-check"></i> ${saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  `;
}
