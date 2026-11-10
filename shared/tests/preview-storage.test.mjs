import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { PREVIEW_STORAGE_SHIM, withPreviewStorage } from '../services/preview-storage.js';

const script = PREVIEW_STORAGE_SHIM.slice(PREVIEW_STORAGE_SHIM.indexOf('>') + 1, PREVIEW_STORAGE_SHIM.lastIndexOf('</script>'));
function frame(nativeStorage) {
  const nodes = [], handlers = new Map();
  const context = { document: {
    readyState: 'loading', body: { appendChild: node => nodes.push(node) },
    addEventListener: (type, callback) => handlers.set(type, callback),
    createElement: () => ({ style: {}, setAttribute() {}, appendChild(node) { this.child = node; } }),
  } };
  context.window = context;
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(context, name, nativeStorage
    ? { configurable: true, value: nativeStorage[name] }
    : { configurable: true, get() { throw new DOMException('Opaque origin', 'SecurityError'); } });
  Object.defineProperty(context, 'parent', { get() { throw new Error('Parent access forbidden'); } });
  context.fetch = () => { throw new Error('Network forbidden'); };
  vm.createContext(context);
  vm.runInContext(script, context);
  return { context, nodes, handlers };
}

test('opaque previews receive the Storage API before unguarded generated code runs', () => {
  const { context, nodes, handlers } = frame();
  vm.runInContext("var best=+localStorage.getItem('best')||0; localStorage.setItem('best',12); sessionStorage.setItem('turn',2);", context);
  assert.equal(context.best, 0);
  const store = context.localStorage;
  assert.equal(store.getItem('best'), '12');
  assert.equal(store.getItem('missing'), null);
  assert.equal(store.length, 1);
  assert.equal(store.key(0), 'best');
  assert.equal(store.key(1), null);
  store.score = 42;
  assert.equal(store.getItem('score'), '42');
  assert.equal(store.score, '42');
  assert.deepEqual(Object.keys(store), ['best', 'score']);
  delete store.score;
  assert.equal(store.length, 1);
  store.removeItem('best');
  assert.equal(store.length, 0);
  store.setItem('again', 1); store.clear();
  assert.equal(store.length, 0);
  assert.equal(context.sessionStorage.getItem('turn'), '2');
  assert.equal(context.__PG_PREVIEW_STORAGE__.persistent, false);
  handlers.get('DOMContentLoaded')();
  assert.match(nodes[0].child.textContent, /Stockage temporaire.*effacé au rechargement/);
});

test('frames and reloads have independent memory; repeated wrapper does not clear existing state', () => {
  const first = frame().context, second = frame().context;
  first.localStorage.setItem('secret-of-frame', 'one');
  assert.equal(second.localStorage.getItem('secret-of-frame'), null);
  assert.equal(first.sessionStorage.getItem('secret-of-frame'), null);
  vm.runInContext(script, first);
  assert.equal(first.localStorage.getItem('secret-of-frame'), 'one');
  assert.equal(frame().context.localStorage.getItem('secret-of-frame'), null);
});

test('accessible native storage is left untouched without a temporary-storage notice', () => {
  const nativeStorage = { localStorage: { getItem: () => 'native-local' }, sessionStorage: { getItem: () => 'native-session' } };
  const { context, handlers } = frame(nativeStorage);
  assert.equal(context.localStorage, nativeStorage.localStorage);
  assert.equal(context.sessionStorage, nativeStorage.sessionStorage);
  assert.equal(context.__PG_PREVIEW_STORAGE__, undefined);
  assert.equal(handlers.size, 0);
});

test('wrapper preserves doctype and source verbatim and precedes every generated script', () => {
  for (const source of ['<!DOCTYPE html><html><head><script>game()</script></head></html>', '<script>game()</script><div>Game</div>']) {
    const preview = withPreviewStorage(source);
    assert.equal(preview.replace(PREVIEW_STORAGE_SHIM, ''), source);
    assert.equal(withPreviewStorage(preview), preview);
    assert.equal(preview.split('\n').length, source.split('\n').length, 'generated source line numbers stay unchanged');
    assert.ok(preview.indexOf('data-pg-preview-storage') < preview.indexOf('game()'));
    if (source.startsWith('<!DOCTYPE')) assert.ok(preview.startsWith('<!DOCTYPE html>'));
  }
  assert.equal(withPreviewStorage(''), '');
});
