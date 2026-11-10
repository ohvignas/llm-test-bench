import { html } from 'htm/preact';
import { useState, useMemo } from 'preact/hooks';
import { CATEGORIES, PROMPT_SETS, categoryLabel, categoryIcon, promptSetOf, statsForPrompt } from '../services/library.js';
import { RatingWidget } from './RatingWidget.js';

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return ''; }
}

function PromptCard({ prompt, stats, onUse, onRun, onEdit, onRemove, isGenerating, showCategory }) {
  const [expanded, setExpanded] = useState(false);
  const hasRuns = stats.runs > 0;

  return html`
    <div class="library-card">
      <div class="library-card-head">
        <span class="library-card-title" title=${prompt.title}>${prompt.title}</span>
        ${prompt.source === 'user'
          ? html`<span class="library-badge library-badge-user" title="Votre prompt">personnel</span>`
          : html`<span class="library-badge" title="Prompt de départ sélectionné">sélectionné</span>`
        }
        ${promptSetOf(prompt) === 'advanced' && html`
          <span class="library-badge library-badge-advanced" title="Série avancée : enrichit un prompt de base avec des exigences numérotées">avancé</span>
        `}
        ${promptSetOf(prompt) === 'flagship' && html`
          <span class="library-badge library-badge-flagship" title="Simulations complexes pour les modèles les plus puissants">complexe</span>
        `}
      </div>
      ${showCategory && html`
        <div class="library-card-category">
          <i class=${`fa-solid ${categoryIcon(prompt.category)}`}></i> ${categoryLabel(prompt.category)}
        </div>
      `}
      <div
        class=${`library-card-prompt ${expanded ? 'expanded' : ''}`}
        role="button" tabIndex="0" aria-expanded=${expanded}
        onClick=${() => setExpanded(e => !e)}
        onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
        title=${expanded ? 'Cliquer pour réduire' : 'Cliquer pour développer'}
      >${prompt.description || prompt.prompt}</div>
      ${expanded && prompt.description && html`
        <div class="library-card-instruction"><strong>Consigne envoyée au modèle${prompt.originalTitle ? ' (version originale)' : ''}</strong><pre>${prompt.prompt}</pre></div>
      `}
      ${expanded && (prompt.notesFr || prompt.notes) && html`
        <div class="library-card-notes"><i class="fa-solid fa-circle-info"></i> ${prompt.notesFr || prompt.notes}</div>
      `}
      ${(prompt.tags || []).length > 0 && html`
        <div class="gallery-card-tags">
          ${prompt.tags.slice(0, 5).map(t => html`<span class="tag-chip" key=${t}>${t}</span>`)}
        </div>
      `}
      <div class="library-card-stats">
        ${hasRuns
          ? html`
              <i class="fa-solid fa-clock-rotate-left"></i>
              <span>${stats.runs} exécution${stats.runs === 1 ? '' : 's'} · ${stats.models} modèle${stats.models === 1 ? '' : 's'}</span>
              ${stats.bestRating > 0 && html`<span class="library-stats-rating">meilleure note <${RatingWidget} rating=${stats.bestRating} readonly size=${11} /></span>`}
              ${stats.lastRunAt && html`<span class="library-stats-date">${formatDate(stats.lastRunAt)}</span>`}
            `
          : html`<i class="fa-regular fa-circle"></i><span>jamais exécuté</span>`
        }
      </div>
      <div class="library-card-actions">
        <button class="btn btn-sm" onClick=${() => onUse(prompt)} title="Charger dans la vue Créer">
          <i class="fa-solid fa-pen"></i> Utiliser
        </button>
        <button
          class="btn btn-sm btn-primary"
          onClick=${() => onRun(prompt)}
          disabled=${isGenerating}
          title="Charger dans Créer et générer avec le modèle actuel"
        >
          <i class="fa-solid fa-bolt"></i> Exécuter
        </button>
        <span class="library-card-actions-spacer"></span>
        <button class="btn-icon" onClick=${() => onEdit(prompt)} title="Modifier le prompt (la version précédente est conservée)">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button
          class="btn-icon btn-icon-danger"
          onClick=${() => onRemove(prompt)}
          title=${prompt.source === 'user' ? 'Déplacer vers la corbeille de la bibliothèque (conservé sur le disque)' : 'Masquer ce prompt sélectionné'}
        >
          <i class=${`fa-solid ${prompt.source === 'user' ? 'fa-trash' : 'fa-eye-slash'}`}></i>
        </button>
      </div>
    </div>
  `;
}

export function PromptLibraryView({
  prompts,
  generations,
  hasDirectory,
  onPickDirectory,
  onUse,
  onRun,
  onAdd,
  onEdit,
  onRemove,
  onImport,
  importScanning,
  isGenerating,
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [promptSet, setPromptSet] = useState('all');
  const hasOtherSets = useMemo(() => prompts.some(p => promptSetOf(p) !== 'core'), [prompts]);

  const filtered = useMemo(() => {
    let list = prompts;
    if (promptSet !== 'all') list = list.filter(p => promptSetOf(p) === promptSet);
    if (category !== 'all') list = list.filter(p => p.category === category);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(q)
        || (p.description || '').toLowerCase().includes(q)
        || (p.originalTitle || '').toLowerCase().includes(q)
        || (p.aliases || []).some(alias => alias.toLowerCase().includes(q))
        || (p.prompt || '').toLowerCase().includes(q)
        || (p.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [prompts, promptSet, category, search]);

  const statsById = useMemo(() => {
    const map = new Map();
    for (const p of filtered) map.set(p.id, statsForPrompt(generations, p));
    return map;
  }, [filtered, generations]);

  // Group into category sections when showing everything; flat grid otherwise.
  const sections = useMemo(() => {
    if (category !== 'all') return [{ id: category, label: null, prompts: filtered }];
    return CATEGORIES
      .map(c => ({ id: c.id, label: c.label, icon: c.icon, prompts: filtered.filter(p => p.category === c.id) }))
      .concat([{
        id: 'other', label: 'Autres', icon: 'fa-lightbulb',
        prompts: filtered.filter(p => !CATEGORIES.some(c => c.id === p.category)),
      }])
      .filter(s => s.prompts.length > 0);
  }, [filtered, category]);

  return html`
    <div class="library-view">
      <div class="library-bar">
        <div class="library-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input
            class="form-input"
            placeholder="Rechercher des prompts…"
            value=${search}
            onInput=${(e) => setSearch(e.target.value)}
          />
        </div>
        <div class="library-cat-chips">
          <button
            class=${`library-cat-chip ${category === 'all' ? 'active' : ''}`}
            onClick=${() => setCategory('all')}
          >Tous</button>
          ${CATEGORIES.map(c => html`
            <button
              key=${c.id}
              class=${`library-cat-chip ${category === c.id ? 'active' : ''}`}
              onClick=${() => setCategory(c.id)}
            ><i class=${`fa-solid ${c.icon}`}></i> ${c.label}</button>
          `)}
        </div>
        ${hasOtherSets && html`
          <div class="library-cat-chips library-set-chips" title="Série de prompts">
            ${[{ id: 'all', label: 'Toutes les séries' }, ...PROMPT_SETS].map(s => html`
              <button
                key=${s.id}
                class=${`library-cat-chip ${promptSet === s.id ? 'active' : ''}`}
                title=${s.hint || 'Toutes les séries de prompts'}
                onClick=${() => setPromptSet(s.id)}
              >${s.icon ? html`<i class=${`fa-solid ${s.icon}`}></i> ` : ''}${s.label}</button>
            `)}
          </div>
        `}
        <span class="library-bar-spacer"></span>
        <button class="btn" onClick=${onImport} disabled=${importScanning} title="Rechercher des prompts à conserver dans les générations et les sources disponibles">
          <i class=${`fa-solid ${importScanning ? 'fa-spinner fa-spin' : 'fa-file-import'}`}></i>
          <span class="btn-label">Importer…</span>
        </button>
        <button class="btn btn-primary" onClick=${onAdd} title="Ajouter un prompt à votre bibliothèque">
          <i class="fa-solid fa-plus"></i>
          <span class="btn-label">Ajouter un prompt</span>
        </button>
      </div>

      ${!hasDirectory && html`
        <div class="library-dir-hint">
          <i class="fa-solid fa-circle-info"></i>
          Voici les prompts de départ sélectionnés. Connectez un dossier pour enregistrer vos prompts et consulter l’historique.
          <button class="btn btn-sm" onClick=${onPickDirectory}><i class="fa-solid fa-folder-plus"></i> Choisir un dossier</button>
        </div>
      `}

      ${sections.length === 0 && html`
        <div class="gallery-empty">
          <i class="fa-solid fa-book-open"></i>
          <p>Aucun prompt ne correspond aux filtres</p>
        </div>
      `}

      ${sections.map(section => html`
        <div class="library-section" key=${section.id}>
          ${section.label && html`
            <div class="library-section-header">
              <i class=${`fa-solid ${section.icon}`}></i> ${section.label}
              <span class="library-section-count">${section.prompts.length}</span>
            </div>
          `}
          <div class="library-grid">
            ${section.prompts.map(p => html`
              <${PromptCard}
                key=${p.id}
                prompt=${p}
                stats=${statsById.get(p.id) || { runs: 0, models: 0, bestRating: 0, lastRunAt: '' }}
                onUse=${onUse}
                onRun=${onRun}
                onEdit=${onEdit}
                onRemove=${onRemove}
                isGenerating=${isGenerating}
                showCategory=${false}
              />
            `)}
          </div>
        </div>
      `)}
    </div>
  `;
}
