import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../src/model-opening-error.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
const module = { exports: {} };
runInNewContext(result.outputFiles[0].text, { module, exports: module.exports });
const { modelOpeningErrorMessage } = module.exports;

test('worker stacks and local paths stay out of visible opening errors', () => {
  const detail = 'Error: RuntimeError: Error: File format is not supported in file "/private/project/invalid.blend" at Object.request (http://localhost/assets/worker.js:1:50)';
  const message = modelOpeningErrorMessage(detail);
  assert.match(message, /not a supported Blender model/);
  assert.doesNotMatch(message, /private|localhost|Object|worker\.js/);
  assert.equal(detail.includes('/private/project/invalid.blend'), true, 'the original diagnostic is not rewritten');
});

test('unknown and access failures explain recovery without exposing diagnostics', () => {
  assert.match(modelOpeningErrorMessage('EACCES /private/project/a.blend'), /permissions/);
  assert.match(modelOpeningErrorMessage('ENOENT /private/project/a.blend'), /could not be found/);
  assert.match(modelOpeningErrorMessage('Failed to fetch at worker.js:1'), /connection/);
  assert.match(modelOpeningErrorMessage('secret detail at internal.js:2'), /Details are available in the console/);
  assert.doesNotMatch(modelOpeningErrorMessage('secret detail at internal.js:2'), /secret|internal/);
});
