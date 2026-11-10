import test from 'node:test';
import assert from 'node:assert/strict';
import * as metadata from '../../prompt-gallery/services/metadata.js';
import * as library from '../../prompt-gallery/services/library.js';
import { generationRoute, parseGalleryRoute } from '../../prompt-gallery/services/routes.js';

// File System Access contract in memory: no production files, browser, or API.
function directory(name = 'root') {
  const entries = new Map();
  const missing = () => new DOMException('Missing entry', 'NotFoundError');
  return {
    name, kind: 'directory', entries,
    async *[Symbol.asyncIterator]() { yield* entries; },
    async getDirectoryHandle(key, { create = false } = {}) {
      if (!entries.has(key) && create) entries.set(key, directory(key));
      const entry = entries.get(key);
      if (!entry) throw missing();
      if (entry.kind !== 'directory') throw new DOMException('Not a directory', 'TypeMismatchError');
      return entry;
    },
    async getFileHandle(key, { create = false } = {}) {
      if (!entries.has(key) && create) entries.set(key, {
        name: key, kind: 'file', data: '', writes: 0,
        async getFile() { return new Blob([this.data]); },
        async createWritable() {
          let value;
          return { write: async next => { value = next; }, close: async () => { this.data = value; this.writes++; } };
        },
      });
      const entry = entries.get(key);
      if (!entry) throw missing();
      if (entry.kind !== 'file') throw new DOMException('Not a file', 'TypeMismatchError');
      return entry;
    },
    async removeEntry(key, { recursive = false } = {}) {
      if (!entries.has(key)) throw missing();
      const entry = entries.get(key);
      if (entry.kind === 'directory' && entry.entries.size && !recursive) throw new DOMException('Not empty', 'InvalidModificationError');
      entries.delete(key);
    },
  };
}

async function put(root, folder, file, content) {
  const dir = await root.getDirectoryHandle(folder, { create: true });
  const handle = await dir.getFileHandle(file, { create: true });
  handle.data = content;
  return handle;
}

async function legacy(root, html = '<html>Legacy</html>') {
  await put(root, 'project', 'prompt.md', 'Original prompt');
  await put(root, 'project', 'response.html', html);
  await put(root, 'project', 'metadata.json', JSON.stringify(metadata.createMetadata('legacy')));
}

test('save and lazy-load a generation, metadata, and a thumbnail', async () => {
  const root = directory();
  const saved = await metadata.saveGeneration(root, 'project', 'Original prompt', '<html>New</html>', metadata.createMetadata('Model A', ['game']));
  assert.equal(saved.folderId, 'project');
  const listed = await metadata.listGenerations(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].response, '');
  assert.equal(listed[0].hasResponse, true);
  assert.deepEqual(listed[0].metadata.tags, ['game']);
  assert.equal((await metadata.ensureResponse(root, listed[0])).response, '<html>New</html>');
  assert.equal((await metadata.loadGeneration(root, saved.id)).prompt, 'Original prompt');
  assert.equal(await metadata.saveThumbnail(root, saved.id, new Uint8Array([1, 2, 3])), true);
  assert.equal(await metadata.saveThumbnail(root, saved.id, new Uint8Array([4])), false);
  assert.deepEqual([...new Uint8Array(await (await metadata.loadThumbnail(root, saved.id)).arrayBuffer())], [1, 2, 3]);
});

test('identical result IDs in different data roots never share cached HTML', async () => {
  const first = directory('first'), second = directory('second');
  await legacy(first, '<html>First root</html>');
  await legacy(second, '<html>Second root</html>');
  assert.equal(await metadata.loadResponse(first, 'project'), '<html>First root</html>');
  assert.equal((await metadata.listGenerations(second))[0].response, '');
  assert.equal(await metadata.loadResponse(second, 'project'), '<html>Second root</html>');
  assert.equal((await metadata.listGenerations(first))[0].response, '<html>First root</html>');
});

test('adding a variant keeps the legacy generation visible and deleting legacy preserves the variant', async () => {
  const root = directory();
  await legacy(root);
  const saved = await metadata.saveGeneration(root, 'project', 'Original prompt', '<html>New</html>', metadata.createMetadata('new'));
  assert.deepEqual(new Set((await metadata.listGenerations(root)).map(g => g.id)), new Set(['project', saved.id]));
  await metadata.deleteGeneration(root, 'project');
  assert.deepEqual((await metadata.listGenerations(root)).map(g => g.id), [saved.id]);
  assert.equal(await metadata.loadResponse(root, saved.id), '<html>New</html>');
  await metadata.deleteGeneration(root, saved.id);
  assert.equal(root.entries.has('project'), false);
});

test('deleting a modern variant preserves legacy HTML and prompt in a mixed folder', async () => {
  const root = directory();
  await legacy(root);
  const saved = await metadata.saveGeneration(root, 'project', 'Original prompt', '<html>New</html>', metadata.createMetadata('new'));
  await metadata.deleteGeneration(root, saved.id);
  assert.deepEqual((await metadata.listGenerations(root)).map(g => g.id), ['project']);
  assert.equal((await metadata.loadGeneration(root, 'project')).response, '<html>Legacy</html>');
});

test('delete reports storage permission failures rather than claiming success', async () => {
  const root = directory();
  await legacy(root);
  const dir = await root.getDirectoryHandle('project');
  dir.removeEntry = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  await assert.rejects(metadata.deleteGeneration(root, 'project'), { name: 'NotAllowedError' });
  assert.equal((await metadata.loadGeneration(root, 'project')).response, '<html>Legacy</html>');
});

test('saving refuses to overwrite an existing prompt that cannot be read', async () => {
  const root = directory();
  await legacy(root);
  const dir = await root.getDirectoryHandle('project');
  const prompt = await dir.getFileHandle('prompt.md');
  prompt.getFile = async () => { throw new DOMException('Read denied', 'NotAllowedError'); };
  await assert.rejects(metadata.saveGeneration(root, 'project', 'Replacement prompt', '<html>New</html>', metadata.createMetadata('new')), { name: 'NotAllowedError' });
  assert.equal(prompt.data, 'Original prompt');
  assert.equal(prompt.writes, 0);
  assert.equal(dir.entries.size, 3);
});

test('a transient HTML read failure is surfaced and is not cached as an empty response', async () => {
  const root = directory();
  await legacy(root);
  const file = await (await root.getDirectoryHandle('project')).getFileHandle('response.html');
  const read = file.getFile.bind(file);
  file.getFile = async () => { throw new DOMException('Read denied', 'NotAllowedError'); };
  await assert.rejects(metadata.loadResponse(root, 'project'), { name: 'NotAllowedError' });
  file.getFile = read;
  assert.equal(await metadata.loadResponse(root, 'project'), '<html>Legacy</html>');
});

test('corrupt user libraries are not treated as empty and overwritten on adding a prompt', async () => {
  for (const content of ['{ broken', 'null', '[]', '{"prompts":{}}', '{"seedOverrides":[]}']) {
    const root = directory();
    const file = await put(root, '_library', 'library.json', content);
    await assert.rejects(library.addPrompt(root, { title: 'New', prompt: 'New prompt' }), /invalide/);
    assert.equal(file.data, content);
    assert.equal(file.writes, 0);
  }
});

test('a permission failure reading the library prevents any write', async () => {
  const root = directory();
  const file = await put(root, '_library', 'library.json', '{"prompts":[]}');
  file.getFile = async () => { throw new DOMException('Read denied', 'NotAllowedError'); };
  await assert.rejects(library.addPrompt(root, { title: 'New' }), /Lecture de la bibliothèque impossible/);
  assert.equal(file.writes, 0);
});

test('a new library and older partial schema remain editable, preserving existing entries', async () => {
  const root = directory();
  const first = await library.addPrompt(root, { title: 'First', prompt: 'Original' });
  const second = await library.addPrompt(root, { title: 'Second', prompt: 'Second' });
  assert.deepEqual((await library.loadUserLibrary(root)).prompts.map(p => p.id), [first.id, second.id]);
  const partial = directory();
  await put(partial, '_library', 'library.json', JSON.stringify({ prompts: [first], seedOverrides: {} }));
  await library.addPrompt(partial, { title: 'Third' });
  const loaded = await library.loadUserLibrary(partial);
  assert.equal(loaded.prompts[0].prompt, 'Original');
  assert.equal(loaded.prompts.length, 2);
  assert.deepEqual(loaded.hiddenSeedIds, []);
});

test('import writes the selection once, deduplicating repeated sources and retries', async () => {
  const root = directory();
  const original = await library.addPrompt(root, { title: 'Existing', prompt: 'Original' });
  const file = await (await root.getDirectoryHandle('_library')).getFileHandle('library.json');
  const writesBefore = file.writes;
  const items = [{ title: 'A', prompt: 'First prompt' }, { title: 'Duplicate A', prompt: ' FIRST   PROMPT ' }, { title: 'B', prompt: 'Second prompt' }];
  const added = await library.importPrompts(root, items);
  assert.equal(added.length, 2);
  assert.equal(file.writes, writesBefore + 1);
  assert.equal((await library.loadUserLibrary(root)).prompts[0].id, original.id);
  assert.equal((await library.loadUserLibrary(root)).prompts.length, 3);
  assert.equal((await library.importPrompts(root, items)).length, 0);
  assert.equal(file.writes, writesBefore + 1);
});

test('a failed bulk import leaves the previous library intact and can be retried without duplicates', async () => {
  const root = directory();
  await library.addPrompt(root, { title: 'Existing', prompt: 'Original' });
  const file = await (await root.getDirectoryHandle('_library')).getFileHandle('library.json');
  const before = file.data, createWritable = file.createWritable.bind(file);
  const items = [{ title: 'A', prompt: 'First' }, { title: 'B', prompt: 'Second' }];
  file.createWritable = async () => { throw new DOMException('Disk full', 'QuotaExceededError'); };
  await assert.rejects(library.importPrompts(root, items), { name: 'QuotaExceededError' });
  assert.equal(file.data, before);
  file.createWritable = createWritable;
  await library.importPrompts(root, items);
  assert.equal((await library.loadUserLibrary(root)).prompts.length, 3);
});

test('editing a user prompt preserves its revision and removal moves it to trash', async () => {
  const root = directory();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ prompts: [] });
  try {
    const entry = await library.addPrompt(root, { title: 'Original title', prompt: 'Original prompt' });
    await library.updatePrompt(root, entry.id, { title: 'New title', prompt: 'New prompt' });
    const edited = (await library.loadUserLibrary(root)).prompts[0];
    assert.equal(edited.revisions[0].prompt, 'Original prompt');
    assert.equal(edited.prompt, 'New prompt');
    await library.removePrompt(root, entry.id);
    const state = await library.loadUserLibrary(root);
    assert.equal(state.prompts.length, 0);
    assert.equal(state.trash[0].id, entry.id);
    assert.equal(state.trash[0].revisions[0].prompt, 'Original prompt');
  } finally { globalThis.fetch = originalFetch; }
});

test('view routes round-trip accents, literal escapes, spaces, and composite variant IDs', () => {
  for (const id of ['été/modèle_123', 'site%20perso/model', 'mon projet/abc', 'site#1/model', 'normal/model']) {
    const hash = new URL('#/' + generationRoute(id), 'http://localhost/').hash;
    assert.deepEqual(parseGalleryRoute(hash), { name: 'view', param: id });
  }
  assert.deepEqual(parseGalleryRoute('#/view/%C3%A9t%C3%A9/model'), { name: 'view', param: 'été/model' });
  assert.deepEqual(parseGalleryRoute('#/view/100%/model'), { name: 'view', param: '100%/model' });
  assert.deepEqual(parseGalleryRoute(''), { name: 'create', param: '' });
  assert.deepEqual(parseGalleryRoute('#/gallery/%C3%A9t%C3%A9'), { name: 'gallery', param: '%C3%A9t%C3%A9' });
});

test('import scanner does not request an unpublished Three Prompt Lab', async () => {
  const previousDocument = globalThis.document, previousFetch = globalThis.fetch;
  globalThis.document = { documentElement: { dataset: { distribution: 'public', crossAppHandoffs: 'off', handoffTargets: 'prompt-gallery' } } };
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error('Unexpected request'); };
  try {
    assert.deepEqual(await library.scanThreePromptLab(), []);
    assert.equal(fetches, 0);
  } finally { globalThis.document = previousDocument; globalThis.fetch = previousFetch; }
});
