import { html } from 'htm/preact';
import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import { CATEGORIES } from '../services/library.js';

export function PromptFormDialog({ initial, onSave, onClose, addToast }) {
  const isEdit = !!initial?.id;
  const [title, setTitle] = useState(initial?.title || '');
  const [category, setCategory] = useState(initial?.category || 'html-js');
  const [tags, setTags] = useState((initial?.tags || []).join(', '));
  const [promptText, setPromptText] = useState(initial?.prompt || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const titleRef = useRef(null);
  const revisionCount = initial?.revisions?.length || 0;

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      titleRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  const handleSave = useCallback(() => {
    if (!title.trim()) {
      addToast('Saisissez un titre', 'error');
      return;
    }
    if (!promptText.trim()) {
      addToast('Saisissez le texte du prompt', 'error');
      return;
    }
    onSave({
      title: title.trim(),
      category,
      tags: tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      prompt: promptText.trim(),
      notes: notes.trim(),
    });
  }, [title, category, tags, promptText, notes, onSave, addToast]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  return html`
    <div class="modal-overlay" onKeyDown=${handleKeyDown}>
      <div class="modal prompt-form-dialog" onClick=${(e) => e.stopPropagation()} style=${{ width: '640px' }}>
        <div class="modal-header">
          <h2>${isEdit ? 'Modifier le prompt' : 'Ajouter un prompt à la bibliothèque'}</h2>
          <button class="btn-icon" onClick=${onClose}>
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label>Titre</label>
            <input
              ref=${titleRef}
              class="form-input"
              value=${title}
              onInput=${(e) => setTitle(e.target.value)}
              placeholder="ex. Nuages en raymarching"
            />
            <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Les exécutions de ce prompt sont enregistrées dans un dossier nommé à partir du titre
            </span>
          </div>

          <div class="form-group">
            <label>Catégorie</label>
            <select class="form-input" value=${category} onChange=${(e) => setCategory(e.target.value)}>
              ${CATEGORIES.map(c => html`<option key=${c.id} value=${c.id}>${c.label}</option>`)}
            </select>
          </div>

          <div class="form-group">
            <label>Étiquettes (séparées par des virgules)</label>
            <input
              class="form-input"
              value=${tags}
              onInput=${(e) => setTags(e.target.value)}
              placeholder="ex. jeu, particules, sans-bibliothèques"
            />
          </div>

          <div class="form-group">
            <label>Prompt</label>
            <textarea
              class="form-input prompt-form-textarea"
              value=${promptText}
              onInput=${(e) => setPromptText(e.target.value)}
              placeholder="Le prompt complet à envoyer au modèle…"
            ></textarea>
            ${isEdit && html`
              <span style=${{ fontSize: '11px', color: 'var(--text-muted)' }}>
                ${revisionCount > 0
                  ? `${revisionCount} révision antérieure${revisionCount === 1 ? '' : 's'} conservée(s) — `
                  : ''
                }la modification du texte conserve la version précédente comme révision
              </span>
            `}
          </div>

          <div class="form-group">
            <label>Notes (points à surveiller lors de l’évaluation)</label>
            <textarea
              class="form-input prompt-form-notes"
              value=${notes}
              onInput=${(e) => setNotes(e.target.value)}
              placeholder="ex. À surveiller : physique liée à la fréquence d’images ; absence de fin de partie…"
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn" onClick=${onClose}>Annuler</button>
          <button class="btn btn-primary" onClick=${handleSave}>
            <i class="fa-solid fa-floppy-disk"></i> ${isEdit ? 'Enregistrer les modifications' : 'Ajouter à la bibliothèque'}
          </button>
        </div>
      </div>
    </div>
  `;
}
