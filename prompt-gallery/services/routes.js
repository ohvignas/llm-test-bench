export function generationRoute(id) {
  return 'view/' + encodeURIComponent(id);
}

export function parseGalleryRoute(hash = '#/create') {
  const path = (hash || '#/create').replace('#/', '');
  const firstSlash = path.indexOf('/');
  if (firstSlash === -1) return { name: path || 'create', param: '' };
  const name = path.substring(0, firstSlash);
  let param = path.substring(firstSlash + 1);
  // Other views decode their own parameters; view IDs were previously left
  // encoded, so folders containing French accents could never be reopened.
  if (name === 'view') {
    try { param = decodeURIComponent(param); } catch { /* Keep legacy literal %. */ }
  }
  return { name, param };
}
