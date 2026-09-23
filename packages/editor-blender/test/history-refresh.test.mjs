import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const stubs = {
  '@volter/blender-engine/browser': `export class BlenderRuntime {
    constructor(options) { probe.options = options; }
    historyStep(id, direction) { probe.moves.push([id, direction]); return probe.restored; }
  }`,
  '@volter/editor-sdk/host': `export const editorHost = () => probe.host;`,
  '../contributions/blender-outliner-model': `
    export const blenderEngineSelection = () => ({selected: ['Restored Cube'], active: 'Restored Cube'});
    export const refreshBlenderOutliner = names => { probe.reads.push(names); return probe.refreshed; };
  `,
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../host/blender-runtime-host.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['three'],
  plugins: [{ name: 'host-boundaries', setup(build) {
    build.onResolve({filter: /.*/}, args => args.kind === 'entry-point' || args.path === 'three'
      ? undefined : {path: args.path, namespace: 'stub'});
    build.onLoad({filter: /.*/, namespace: 'stub'}, args => ({contents: stubs[args.path] ?? `
      export const AGX_LOOK_TABLES = {}, agxEncodeFrame = () => {}, displayTableUrl = () => {},
        filmicEncodeFrame = () => {}, standardEncodeFrame = () => {}, invokeViewVerb = () => {},
        captureSceneImage = () => {}, captureSceneLinear = () => {}, fitClipPlanes = () => {},
        contentWorldBounds = () => {}, nodeViewState = () => {}, refuseNodeViewGesture = () => {},
        requestNodeViewAll = () => {}, setNodeViewState = () => {};
    `}));
  }}],
});

for (const direction of ['undo', 'redo']) test(`${direction} waits for the restored Outliner before acknowledging`, async () => {
  let restore, refresh;
  const probe = {
    moves: [], reads: [],
    restored: new Promise(resolve => { restore = resolve; }),
    refreshed: new Promise(resolve => { refresh = resolve; }),
    host: {session: {onBeforeClose() {}, onEnded() {}, reportWorkerCallMeter() {}}, history: {record(element) { probe.element = element; }}},
  };
  const module = {exports: {}};
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url), probe, AbortController,
  });
  module.exports.blenderRuntime();
  probe.options.history([{id: 'native-step', label: 'Duplicate', resource: 'cube.blend'}]);
  let settled = false;
  const moving = probe.element[direction]().then(result => { settled = true; return result; });
  assert.equal(probe.reads.length, 0);
  restore(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.deepEqual(Array.from(probe.reads[0]), ['Restored Cube']);
  refresh();
  assert.equal(await moving, true);
  assert.deepEqual(Array.from(probe.moves[0]), ['native-step', direction]);
});
