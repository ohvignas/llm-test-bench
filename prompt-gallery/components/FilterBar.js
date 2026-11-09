import { html } from 'htm/preact';

const COLLECTIONS = [
  { id: 'all', label: 'Tous', icon: 'fa-layer-group' },
  { id: 'unreviewed', label: 'Non évalués', icon: 'fa-inbox' },
  { id: 'favorites', label: 'Favoris', icon: 'fa-star' },
  { id: 'recent', label: 'Récents', icon: 'fa-clock' },
  { id: 'refined', label: 'Amélioré', icon: 'fa-screwdriver-wrench' },
  { id: 'archived', label: 'Archivé', icon: 'fa-box-archive' },
];

const VERIFICATION_COLLECTIONS = [
  { id: 'verified', label: 'Vérifié', icon: 'fa-shield-circle-check' },
  { id: 'verification-warn', label: 'À vérifier', icon: 'fa-circle-question' },
  { id: 'verification-failed', label: 'Échec de la vérification', icon: 'fa-shield-halved' },
];

export function FilterBar({
  viewMode,
  onViewModeChange,
  search,
  onSearchChange,
  sortBy,
  onSortChange,
  filterModel,
  onFilterModelChange,
  filterTag,
  onFilterTagChange,
  minRating,
  onMinRatingChange,
  collection,
  onCollectionChange,
  models,
  tags,
  collectionCounts,
  resultCount,
  onClear,
  hasVerification = false,
}) {
  const hasFilters = Boolean(search || filterModel || filterTag || Number(minRating) > 0 || collection !== 'all');

  return html`
    <div class="gallery-controls">
      <div class="filter-bar">
        <div class="gallery-view-toggle" role="group" aria-label="Vue de la galerie">
          <button
            class=${viewMode === 'projects' ? 'active' : ''}
            onClick=${() => onViewModeChange('projects')}
            title="Regrouper les générations par projet de prompt"
          ><i class="fa-solid fa-folder-tree"></i><span>Projets</span></button>
          <button
            class=${viewMode === 'variants' ? 'active' : ''}
            onClick=${() => onViewModeChange('variants')}
            title="Afficher toutes les générations"
          ><i class="fa-solid fa-images"></i><span>Variantes</span></button>
        </div>

        <div class="filter-search-wrapper">
          <i class="fa-solid fa-search"></i>
          <input
            class="filter-search"
            type="search"
            placeholder="Rechercher projets, prompts, notes, étiquettes ou modèles"
            value=${search}
            onInput=${event => onSearchChange(event.target.value)}
          />
        </div>

        <select class="filter-select" value=${filterModel} onChange=${event => onFilterModelChange(event.target.value)} title="Filtrer par modèle">
          <option value="">Tous les modèles</option>
          ${models.map(model => html`<option key=${model} value=${model}>${model}</option>`)}
        </select>
        <select class="filter-select" value=${filterTag} onChange=${event => onFilterTagChange(event.target.value)} title="Filtrer par étiquette">
          <option value="">Toutes les étiquettes</option>
          ${tags.map(tag => html`<option key=${tag} value=${tag}>${tag}</option>`)}
        </select>
        <select class="filter-select" value=${minRating} onChange=${event => onMinRatingChange(Number(event.target.value))} title="Note minimale">
          <option value="0">Toutes les notes</option>
          <option value="5">5 étoiles et plus</option>
          <option value="7">7 étoiles et plus</option>
          <option value="8">8 étoiles et plus</option>
          <option value="9">9 étoiles et plus</option>
          <option value="10">10 étoiles</option>
        </select>
        <select class="filter-select" value=${sortBy} onChange=${event => onSortChange(event.target.value)} title="Trier les résultats">
          <option value="date-desc">Plus récents en premier</option>
          <option value="date-asc">Plus anciens en premier</option>
          <option value="rating-desc">Meilleures notes</option>
          <option value="rating-asc">Notes les plus basses</option>
          <option value="name-asc">Nom A–Z</option>
          <option value="name-desc">Nom Z–A</option>
          ${viewMode === 'projects' && html`<option value="variants-desc">Plus de variantes</option>`}
        </select>
        <button class="btn-icon" onClick=${onClear} disabled=${!hasFilters} title="Effacer les filtres de la galerie">
          <i class="fa-solid fa-filter-circle-xmark"></i>
        </button>
      </div>

      <div class="gallery-collection-bar">
        <div class="gallery-collection-tabs" role="group" aria-label="Collection à évaluer">
          ${(hasVerification ? [...COLLECTIONS, ...VERIFICATION_COLLECTIONS] : COLLECTIONS).map(item => html`
            <button
              key=${item.id}
              class=${collection === item.id ? 'active' : ''}
              onClick=${() => onCollectionChange(item.id)}
            >
              <i class=${`fa-solid ${item.icon}`}></i>
              <span>${item.label}</span>
              <span class="collection-count">${collectionCounts[item.id] || 0}</span>
            </button>
          `)}
        </div>
        <span class="gallery-result-count">${resultCount} ${viewMode === 'projects' ? 'projet' : 'variante'}${resultCount === 1 ? '' : 's'}</span>
      </div>
    </div>
  `;
}
