import { html } from 'htm/preact';
import { useState, useCallback } from 'preact/hooks';
import { RatingWidget } from './RatingWidget.js';
import { ratingOf, withRating } from '../services/rating.js';
import { sendToCodeMorphLab } from '../../shared/services/code-morph-handoff.js';
import { sendToBugfixBench } from '../../shared/services/bugfix-bench-handoff.js';
import { VerificationDetails } from './VerificationBadge.js';
import { BatchCosts } from './BatchCosts.js';
import { sanitizeRichHtml } from '../../shared/services/content-sanitizer.js';

export function MetadataPanel({ generation, response, onUpdateMetadata, onSavePromptToLibrary, onRefine, onEdit, onDelete, onCompare, onClose, allowHandoffs = true, allowMorph = allowHandoffs }) {
  const [tagInput, setTagInput] = useState('');

  if (!generation) return null;

  const { id, folderId, prompt, metadata } = generation;
  const meta = metadata || {};
  const displayName = folderId || id;

  const handleRatingChange = useCallback((rating) => {
    onUpdateMetadata(id, withRating(meta, rating));
  }, [id, meta, onUpdateMetadata]);

  const handleAddTag = useCallback((e) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      const tag = tagInput.trim().toLowerCase();
      if (!meta.tags?.includes(tag)) {
        onUpdateMetadata(id, { ...meta, tags: [...(meta.tags || []), tag] });
      }
      setTagInput('');
    }
  }, [id, meta, tagInput, onUpdateMetadata]);

  const handleRemoveTag = useCallback((tag) => {
    onUpdateMetadata(id, { ...meta, tags: (meta.tags || []).filter(t => t !== tag) });
  }, [id, meta, onUpdateMetadata]);

  const handleNotesChange = useCallback((e) => {
    onUpdateMetadata(id, { ...meta, notes: e.target.value });
  }, [id, meta, onUpdateMetadata]);

  const renderMarkdown = () => {
    if (!prompt) return '';
    let rendered = prompt;
    try {
      if (window.marked) rendered = window.marked.parse(prompt);
    } catch (e) {
      rendered = prompt;
    }
    return sanitizeRichHtml(rendered);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch (e) {
      return dateStr;
    }
  };

  return html`
    <div class="metadata-panel">
      <div class="metadata-header">
        <h3>${displayName}</h3>
        <button class="btn-icon" onClick=${onClose} title="Fermer le panneau">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="metadata-body">
        <!-- Rating -->
        <div class="metadata-field">
          <span class="metadata-label">Note</span>
          <${RatingWidget} rating=${ratingOf(meta)} onChange=${handleRatingChange} size=${15} />
        </div>

        <!-- Model -->
        <div class="metadata-field">
          <span class="metadata-label">Modèle</span>
          <span class="metadata-value">
            ${meta.model ? html`<span class="model-badge"><i class="fa-solid fa-robot"></i> ${meta.model}</span>` : '—'}
          </span>
        </div>

        <!-- Date -->
        ${meta.billing?.calls?.length > 0 && html`<${BatchCosts} calls=${meta.billing.calls} done=${true} />`}
        <div class="metadata-field">
          <span class="metadata-label">Création</span>
          <span class="metadata-value">${formatDate(meta.createdAt)}</span>
        </div>

        <!-- Refine lineage -->
        ${meta.derivedFrom && html`
          <div class="metadata-field">
            <span class="metadata-label">Issu de</span>
            <span class="metadata-value" style=${{ fontSize: '12px' }}>
              <i class="fa-solid fa-screwdriver-wrench"></i> ${meta.derivedFrom}
              ${meta.refine?.kind && html` <span class="tag-chip">${meta.refine.kind}</span>`}
            </span>
          </div>
        `}

        ${meta.verification && html`
          <div class="metadata-field">
            <span class="metadata-label">Vérification</span>
            <${VerificationDetails}
              verification=${meta.verification}
              parentId=${meta.derivedFrom ? `${folderId}/${meta.derivedFrom}` : ''}
            />
          </div>
        `}

        <!-- Tags -->
        <div class="metadata-field">
          <span class="metadata-label">Étiquettes</span>
          <div class="metadata-tags-edit">
            ${(meta.tags || []).map(tag => html`
              <span class="tag-chip" key=${tag}>
                ${tag}
                <button class="tag-remove" onClick=${() => handleRemoveTag(tag)} title="Supprimer l’étiquette">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </span>
            `)}
            <input
              class="tag-input"
              placeholder="Ajouter une étiquette…"
              value=${tagInput}
              onInput=${(e) => setTagInput(e.target.value)}
              onKeyDown=${handleAddTag}
            />
          </div>
        </div>

        <!-- Notes -->
        <div class="metadata-field">
          <span class="metadata-label">Notes</span>
          <textarea
            class="metadata-notes-input"
            value=${meta.notes || ''}
            onInput=${handleNotesChange}
            placeholder="Ajouter des notes…"
          ></textarea>
        </div>

        <!-- Prompt preview -->
        <div class="metadata-field">
          <span class="metadata-label">Prompt</span>
          <div class="metadata-prompt-preview" dangerouslySetInnerHTML=${{ __html: renderMarkdown() }}></div>
        </div>
      </div>

      <div class="metadata-actions">
        <button class="btn" onClick=${() => onEdit(id)} title="Modifier dans la vue Créer">
          <i class="fa-solid fa-pen-to-square"></i> Modifier
        </button>
        <button class="btn" onClick=${() => onCompare(id)} title="Ajouter à la comparaison">
          <i class="fa-solid fa-columns"></i> Comparer
        </button>
        ${onRefine && html`
          <button class="btn" onClick=${() => onRefine(id)} title="Ouvrir dans Améliorer : corriger les erreurs ou ajouter des fonctionnalités (nouvelle variante)">
            <i class="fa-solid fa-screwdriver-wrench"></i> Améliorer
          </button>
        `}
        ${onSavePromptToLibrary && prompt && html`
          <button
            class="btn"
            onClick=${() => onSavePromptToLibrary(
              (folderId || id).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              prompt
            )}
            title="Enregistrer le prompt de cette génération dans la bibliothèque"
          >
            <i class="fa-solid fa-bookmark"></i> Conserver le prompt
          </button>
        `}
        ${allowMorph && html`<button class="btn" onClick=${() => {
          try {
            sendToCodeMorphLab({
              source: 'prompt-gallery',
              kind: 'code',
              title: displayName,
              prompt: prompt,
              files: [{ name: 'index.html', content: response || '' }],
              language: 'html',
              meta: {
                model: meta.model,
                createdAt: meta.createdAt,
                sourceId: folderId || id,
              },
            });
          } catch (e) {
            alert('Échec de l’envoi : ' + e.message);
          }
        }} title="Transformer cette génération dans Code Morph Lab">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Transformer
        </button>`}
        ${allowHandoffs && html`<button class="btn" onClick=${() => {
          try {
            sendToBugfixBench({
              source: 'prompt-gallery',
              title: displayName,
              files: [{ name: 'index.html', content: response || '' }],
              language: 'html',
              entryFile: 'index.html',
              meta: {
                model: meta.model,
                createdAt: meta.createdAt,
                sourceId: folderId || id,
              },
            });
          } catch (e) {
            alert('Échec de l’envoi : ' + e.message);
          }
        }} title="Créer une tâche Bugfix Bench à partir de cette génération">
          <i class="fa-solid fa-bug"></i> Déboguer
        </button>`}
        <button class="btn btn-danger" onClick=${() => onDelete(id)} title="Supprimer la génération">
          <i class="fa-solid fa-trash"></i> Supprimer
        </button>
      </div>
    </div>
  `;
}
