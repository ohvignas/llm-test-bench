import { html } from 'htm/preact';
import { useLazyHtml } from './useLazyHtml.js';
import { withPreviewStorage } from '../../shared/services/preview-storage.js';
import { useMemo, useState } from 'preact/hooks';
import { ExecutionSummary } from './ExecutionSummary.js';
import { ExecutionBrowser } from './ExecutionBrowser.js';
import { RatingWidget } from './RatingWidget.js';
import { ratingOf } from '../services/rating.js';
import {
  collectGalleryFacets,
  filterVariants,
  groupGenerationsByFolder,
  isArchived,
  modelLabel,
  pickDistinctModelVariants,
  shortModelLabel,
  sortProjects,
  sortVariants,
} from '../services/gallery.js';

const MAX_COMPARE = 4;

function shortDate(value) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
}

function providerLabel(generation) {
  return generation.metadata?.providerName || generation.metadata?.providerId || '';
}

// Only the panes actually being compared fetch their page (the list view has
// none — see useLazyHtml).
function ComparePane({ generation, loadHtml }) {
  const { html: page, loading } = useLazyHtml(generation.id, loadHtml, { initial: generation.response || '' });
  if (loading && !page) return html`<div class="compare-pane-loading">Chargement…</div>`;
  return html`<iframe
    srcdoc=${withPreviewStorage(page || '')}
    sandbox="allow-scripts allow-modals allow-pointer-lock"
    title=${generation.id}
  ></iframe>`;
}

export function CompareView({ generations, compareIds, onCompareIdsChange, onOpen, loadHtml, executionProject, onExecutionProjectChange }) {
  const [selecting, setSelecting] = useState(true);
  const [search, setSearch] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState('date-desc');
  const [showArchived, setShowArchived] = useState(false);

  const byId = useMemo(() => new Map(generations.map(g => [g.id, g])), [generations]);
  const facets = useMemo(() => collectGalleryFacets(generations), [generations]);

  // Projects, each already filtered down to the variants that matched — so a
  // model filter leaves a project showing only that model's runs.
  const projects = useMemo(() => {
    const matched = filterVariants(generations, {
      query: search,
      model: filterModel,
      minRating,
      // 'all' already means "everything except archived"; the toggle swaps to
      // the archived-only collection rather than mixing the two together.
      collection: showArchived ? 'archived' : 'all',
    });
    const grouped = groupGenerationsByFolder(matched)
      .map(project => ({ ...project, variants: sortVariants(project.variants, sortBy) }));
    return sortProjects(grouped, sortBy);
  }, [generations, search, filterModel, minRating, sortBy, showArchived]);

  const matchCount = projects.reduce((total, project) => total + project.variants.length, 0);
  const hasFilters = Boolean(search || filterModel || minRating > 0 || showArchived);
  const selected = compareIds.map(id => byId.get(id)).filter(Boolean);

  const toggleId = (id) => {
    if (compareIds.includes(id)) {
      onCompareIdsChange(compareIds.filter(x => x !== id));
    } else if (compareIds.length < MAX_COMPARE) {
      onCompareIdsChange([...compareIds, id]);
    }
  };

  // "Line up" replaces the selection rather than appending: the intent is to
  // look at this project, not to add its runs to a half-built set.
  const lineUpProject = (project) => {
    const picked = pickDistinctModelVariants(project.variants, MAX_COMPARE);
    onCompareIdsChange(picked.map(g => g.id));
    if (picked.length >= 2) setSelecting(false);
  };

  const clearFilters = () => {
    setSearch('');
    setFilterModel('');
    setMinRating(0);
    setShowArchived(false);
  };

  const reset = () => {
    onCompareIdsChange([]);
    setSelecting(true);
  };

  if (executionProject) return html`<${ExecutionBrowser} view="compare" selectedProject=${executionProject} onProjectChange=${onExecutionProjectChange} />`;
  if (selecting || compareIds.length < 2) {
    return html`
      <div class="compare-view">
        <${ExecutionBrowser} view="compare" onProjectChange=${onExecutionProjectChange} />
        <div class="compare-controls">
          <div class="filter-bar">
            <div class="filter-search-wrapper">
              <i class="fa-solid fa-search"></i>
              <input
                class="filter-search"
                type="search"
                placeholder="Rechercher prompts, modèles, fournisseurs, étiquettes ou notes"
                value=${search}
                onInput=${e => setSearch(e.target.value)}
              />
            </div>
            <select class="filter-select" value=${filterModel} onChange=${e => setFilterModel(e.target.value)} title="Filtrer par modèle">
              <option value="">Tous les modèles</option>
              ${facets.models.map(model => html`<option key=${model} value=${model}>${model}</option>`)}
            </select>
            <select class="filter-select" value=${minRating} onChange=${e => setMinRating(Number(e.target.value))} title="Note minimale">
              <option value="0">Toutes les notes</option>
              <option value="5">5 étoiles et plus</option>
              <option value="7">7 étoiles et plus</option>
              <option value="8">8 étoiles et plus</option>
              <option value="9">9 étoiles et plus</option>
              <option value="10">10 étoiles</option>
            </select>
            <select class="filter-select" value=${sortBy} onChange=${e => setSortBy(e.target.value)} title="Trier">
              <option value="date-desc">Plus récents en premier</option>
              <option value="date-asc">Plus anciens en premier</option>
              <option value="rating-desc">Meilleures notes</option>
              <option value="name-asc">Nom A–Z</option>
              <option value="variants-desc">Plus de variantes</option>
            </select>
            <button
              class=${`btn-icon ${showArchived ? 'active' : ''}`}
              onClick=${() => setShowArchived(v => !v)}
              title=${showArchived ? 'Archives uniquement : cliquer pour afficher les éléments actifs' : 'Afficher les générations archivées'}
            >
              <i class="fa-solid fa-box-archive"></i>
            </button>
            <button class="btn-icon" onClick=${clearFilters} disabled=${!hasFilters} title="Effacer les filtres">
              <i class="fa-solid fa-filter-circle-xmark"></i>
            </button>
            <span class="gallery-result-count">${matchCount} génération${matchCount === 1 ? '' : 's'}</span>
          </div>

          <div class="compare-tray">
            <span class="compare-tray-label">
              <i class="fa-solid fa-columns"></i>
              Sélection : ${compareIds.length}/${MAX_COMPARE}
            </span>
            ${selected.length === 0
              ? html`<span class="compare-tray-hint">Choisissez 2 à ${MAX_COMPARE} générations ou « Comparer les modèles » sur un prompt</span>`
              : selected.map(g => html`
                  <button key=${g.id} class="compare-chip" onClick=${() => toggleId(g.id)} title="Retirer de la comparaison">
                    <span>${shortModelLabel(g)}</span>
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                `)
            }
            <span class="library-card-actions-spacer"></span>
            ${compareIds.length > 0 && html`<button class="btn btn-sm" onClick=${reset}>Effacer</button>`}
            <button
              class="btn btn-primary btn-sm"
              onClick=${() => compareIds.length >= 2 && setSelecting(false)}
              disabled=${compareIds.length < 2}
            >
              <i class="fa-solid fa-columns"></i> Comparer (${compareIds.length})
            </button>
          </div>
        </div>

        <div class="compare-pick-scroll">
          ${generations.length === 0
            ? html`
                <div class="compare-selector">
                  <i class="fa-solid fa-columns"></i>
                  <p>Aucune génération disponible. Enregistrez-en d’abord !</p>
                </div>
              `
            : projects.length === 0
              ? html`
                  <div class="compare-selector">
                    <i class="fa-solid fa-filter-circle-xmark"></i>
                    <p>Aucun résultat pour ces filtres.</p>
                    <button class="btn" onClick=${clearFilters}>Effacer les filtres</button>
                  </div>
                `
              : projects.map(project => html`
                  <section class="compare-project" key=${project.folderId}>
                    <header class="compare-project-header">
                      <div class="compare-project-heading">
                        <span class="gallery-card-title">${project.title}</span>
                        <span class="compare-project-meta">
                          ${project.variants.length} exécution${project.variants.length === 1 ? '' : 's'}
                          · ${project.models.length} modèle${project.models.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <button
                        class="btn btn-sm"
                        onClick=${() => lineUpProject(project)}
                        disabled=${project.variants.length < 2}
                        title="Comparer ce prompt sur ${MAX_COMPARE} modèles au maximum"
                      >
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Comparer les modèles
                      </button>
                      ${project.prompt && html`<p class="compare-project-prompt">${project.prompt}</p>`}
                    </header>
                    <div class="compare-pick-grid">
                      ${project.variants.map(g => {
                        const picked = compareIds.includes(g.id);
                        const full = !picked && compareIds.length >= MAX_COMPARE;
                        return html`
                          <div
                            key=${g.id}
                            class=${`compare-pick-card ${picked ? 'selected' : ''} ${full ? 'disabled' : ''}`}
                            onClick=${() => !full && toggleId(g.id)}
                            title=${full ? `Désélectionnez un élément : maximum ${MAX_COMPARE}` : modelLabel(g)}
                          >
                            <i class=${`fa-${picked ? 'solid fa-circle-check' : 'regular fa-circle'}`}
                               style=${{ color: picked ? 'var(--accent)' : 'var(--text-muted)' }}></i>
                            <div class="compare-pick-body">
                              <div class="compare-pick-model">${shortModelLabel(g)}</div>
                              <div class="compare-pick-sub">
                                ${providerLabel(g) && html`<span>${providerLabel(g)}</span>`}
                                ${shortDate(g.metadata?.createdAt) && html`<span>${shortDate(g.metadata.createdAt)}</span>`}
                                ${isArchived(g) && html`<span><i class="fa-solid fa-box-archive"></i></span>`}
                              </div>
                            </div>
                            <${RatingWidget} rating=${ratingOf(g.metadata)} readonly size=${10} />
                          </div>
                        `;
                      })}
                    </div>
                  </section>
                `)
          }
        </div>
      </div>
    `;
  }

  const cols = selected.length;
  const samePrompt = selected.every(g => (g.folderId || g.id) === (selected[0].folderId || selected[0].id));

  return html`
    <div class="compare-view">
      <div class="filter-bar compare-result-bar">
        <button class="btn btn-sm" onClick=${() => setSelecting(true)}>
          <i class="fa-solid fa-arrow-left"></i> Modifier la sélection
        </button>
        <div class="compare-result-prompt">
          ${samePrompt && selected[0].prompt
            ? html`<span title=${selected[0].prompt}>${selected[0].prompt}</span>`
            : html`<span class="compare-tray-hint">Comparaison de ${cols} générations issues de prompts différents</span>`
          }
        </div>
        <button class="btn btn-sm" onClick=${reset} title="Effacer la sélection">
          <i class="fa-solid fa-xmark"></i> Effacer
        </button>
      </div>
      <div class="compare-grid" style=${{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        ${selected.map(g => html`
          <div class="compare-col" key=${g.id}>
            <div class="compare-col-header">
              <div>
                <div class="gallery-card-title">${shortModelLabel(g)}</div>
                <div class="compare-col-sub">
                  ${providerLabel(g) && html`<span>${providerLabel(g)}</span>`}
                  ${!samePrompt && html`<span>${g.folderId || g.id}</span>`}
                  ${shortDate(g.metadata?.createdAt) && html`<span>${shortDate(g.metadata.createdAt)}</span>`}
                </div>
              </div>
              <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <${RatingWidget} rating=${ratingOf(g.metadata)} readonly size=${11} />
                ${onOpen && html`
                  <button class="btn-icon" onClick=${() => onOpen(g.id)} title="Ouvrir cette génération">
                    <i class="fa-solid fa-up-right-from-square"></i>
                  </button>
                `}
              </div>
            </div>
            <${ExecutionSummary} calls=${g.metadata?.billing?.calls || []} known=${!!g.metadata?.billing} compact=${true} />
            <${ComparePane} generation=${g} loadHtml=${loadHtml} />
          </div>
        `)}
      </div>
    </div>
  `;
}
