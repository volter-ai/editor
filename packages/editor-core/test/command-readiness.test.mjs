import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/command-registry.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{name: 'discovery-boundaries', setup(build) {
    build.onResolve({filter: /^\.\/(initial-project|tool-loader)$/}, args => ({path: args.path, namespace: 'stub'}));
    build.onLoad({filter: /.*/, namespace: 'stub'}, args => ({contents: args.path === './initial-project'
      ? 'export const projectBootstrapSettled = () => probe.bootstrap;'
      : 'export const refreshProjectToolContributions = () => { probe.loads++; return probe.load(); };'}));
  }}],
});
function registry(probe) {
  const module = {exports: {}};
  runInNewContext(bundle.outputFiles[0].text, {module, exports: module.exports, probe});
  return module.exports;
}

test('an early package command waits for bootstrap and discovery', async () => {
  let boot, loaded;
  const probe = {loads: 0, bootstrap: new Promise(r => { boot = r; }), load: () => new Promise(r => { loaded = r; })};
  const api = registry(probe);
  let settled = false;
  const pending = api.resolveContributedCommand('test-package-edit').then(value => { settled = true; return value; });
  await new Promise(r => setImmediate(r));
  assert.equal(probe.loads, 0);
  boot();
  await new Promise(r => setImmediate(r));
  assert.equal(probe.loads, 1);
  assert.equal(settled, false);
  const spec = {handle: () => ({ok: true})};
  api.registerContributedCommands('test-package', {'test-package-edit': spec});
  loaded();
  assert.equal(await pending, spec);
  assert.equal(await api.resolveContributedCommand('test-package-edit'), spec);
  assert.equal(probe.loads, 1);
});

test('native commands need no discovery; genuinely absent package commands still refuse', async () => {
  const probe = {loads: 0, bootstrap: Promise.resolve(), load: async () => {}};
  const api = registry(probe);
  assert.equal(await api.resolveContributedCommand('session-prepare-close'), null);
  assert.equal(await api.resolveContributedCommand(undefined), null);
  assert.equal(probe.loads, 0);
  assert.equal(await api.resolveContributedCommand('no-such-package-command'), null);
  assert.equal(probe.loads, 1);
});
