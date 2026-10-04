import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isMissingEditorBuildAsset, installStaleChunkRecovery } from '../src/stale-chunk-recovery.ts';

const editor = 'https://editor.example/product/assets/product-AbCd1234.js';
const chunk = 'https://editor.example/product/assets/Inspector-EfGh5678.js';
const failedImport = url => new TypeError(`Failed to fetch dynamically imported module: ${url}`);

test('project imports and evaluation failures never probe deployment assets', async () => {
  let requests = 0;
  for (const error of [
    failedImport('https://editor.example/@fs/private/project/src/ui/game.tsx?t=1'),
    failedImport('https://editor.example/src/ui/game.tsx?volter-mount=2'),
    failedImport('https://editor.example/src/models/track.play.ts?t=3'),
    new SyntaxError('Unexpected token ;'),
    new Error('HUD module evaluation failed'),
    new TypeError('Importing a module script failed.'),
    null,
  ]) {
    assert.equal(await isMissingEditorBuildAsset(error, editor, () => {
      requests++;
      return Promise.resolve({ status: 404 });
    }), false);
  }
  assert.equal(requests, 0);
});

test('a reported asset must belong to this editor build directory', async () => {
  let requests = 0;
  const request = async () => { requests++; return { status: 404 }; };
  for (const url of [
    'https://other.example/product/assets/Inspector-EfGh5678.js',
    'https://editor.example/assets/Inspector-EfGh5678.js',
    'https://editor.example/product/assets/project.js',
  ]) {
    assert.equal(await isMissingEditorBuildAsset(failedImport(url), editor, request), false);
  }
  assert.equal(await isMissingEditorBuildAsset(failedImport(chunk),
    'https://editor.example/src/frame/bridge.tsx', request), false);
  assert.equal(requests, 0);
});

test('only confirmed missing build assets permit recovery, not network/transform/server errors', async () => {
  for (const status of [200, 403, 404, 410, 500, 503]) {
    const requests = [];
    const missing = await isMissingEditorBuildAsset(failedImport(chunk), editor, async (url, init) => {
      requests.push({ url, init });
      return { status };
    });
    assert.deepEqual(requests, [{ url: chunk, init: { method: 'HEAD', cache: 'no-store' } }]);
    assert.equal(missing, status === 404 || status === 410);
  }
  assert.equal(await isMissingEditorBuildAsset(failedImport(chunk), editor,
    async () => { throw new TypeError('Failed to fetch'); }), false);
  assert.equal(await isMissingEditorBuildAsset(
    new Error('Unable to preload CSS for /product/assets/Inspector-EfGh5678.css'), editor,
    async () => ({ status: 404 })), true);
});

test('project preload errors keep their rejection and do not consume the reload guard', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  let listener;
  let reloads = 0;
  let writes = 0;
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      addEventListener: (name, callback) => {
        assert.equal(name, 'vite:preloadError');
        listener = callback;
      },
      location: { reload: () => { reloads++; } },
    } });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
      getItem: () => null,
      setItem: () => { writes++; },
    } });
    installStaleChunkRecovery();
    for (const payload of [new Error('HUD failed'), failedImport('https://editor.example/src/ui/game.tsx')]) {
      const event = new Event('vite:preloadError', { cancelable: true });
      event.payload = payload;
      await listener(event);
      assert.equal(event.defaultPrevented, false);
    }
    assert.equal(reloads, 0);
    assert.equal(writes, 0);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, 'window', previousWindow);
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else Object.defineProperty(globalThis, 'sessionStorage', previousStorage);
  }
});
