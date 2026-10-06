import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const stubs = {
  '@volter/editor-sdk/host': 'export const editorHost = () => ({console: {error: (...args) => probe.errors.push(args)}});',
  '@volter/editor-threejs/adapter/three-contract': 'export const threeObject = () => null;',
  '@volter/editor-threejs/viewport-door': 'export const viewportStages = () => [];',
  '../host/blender-runtime-host': `export const blenderExecute = code => probe.execute(code);
    export const blenderRnaSet = () => {}, beginBlenderGesture = () => {}, endBlenderGesture = () => {};`,
  './blender-outliner-model': `
    export const blenderEngineSelection = () => probe.engine;
    export const blenderOutlinerState = () => ({byId: probe.rows});
    export const blenderOutlinerVersion = () => probe.version;
    export const blenderPresentedView = () => probe.view;
    export const subscribeBlenderOutliner = fn => {probe.treeListeners.add(fn); return () => probe.treeListeners.delete(fn);};
    export const onBlenderFrame = fn => {probe.frameListeners.add(fn); return () => probe.frameListeners.delete(fn);};
    export const refreshBlenderOutliner = () => {}, showBlenderOutliner = () => {}, writeBlenderOutlinerColumn = () => {};`,
};
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../contributions/blender-outliner-authoring.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{name: 'selection-boundaries', setup(build) {
    build.onResolve({filter: /.*/}, args => args.kind === 'entry-point' ? undefined : {path: args.path, namespace: 'stub'});
    build.onLoad({filter: /.*/, namespace: 'stub'}, args => ({contents: stubs[args.path]}));
  }}],
});

async function fixture() {
  const objects = new Map(['Cube', 'Camera'].map(name => [name, {name}]));
  const probe = {engine: {selected: [], active: null}, version: 1, errors: [], writes: [],
    treeListeners: new Set(), frameListeners: new Set(), published: [],
    rows: new Map([...objects].map(([name]) => [name, {id: name, name, object: name, type: 'TSE_SOME_ID', struct: 'Object'}])),
    view: {root: {}, objectForBlenderName: name => objects.get(name)},
    execute: () => new Promise((resolve, reject) => probe.writes.push({resolve, reject})),
  };
  const module = {exports: {}};
  runInNewContext(bundle.outputFiles[0].text, {module, exports: module.exports, probe, setTimeout, clearTimeout, queueMicrotask});
  const result = module.exports.createBlenderOutlinerAuthoring({defaultAdapter: {
    hierarchy: {idForObject3D: object => object.name}, selection: {set: ids => probe.published.push([...ids])},
  }});
  await new Promise(resolve => setTimeout(resolve, 5));
  const tree = () => {probe.version++; for (const fn of probe.treeListeners) fn();};
  const frame = () => {for (const fn of probe.frameListeners) fn();};
  const settle = async (index, names) => {
    probe.engine = {selected: names, active: names.at(-1) ?? null}; frame();
    probe.writes[index].resolve({error: null}); await new Promise(resolve => setImmediate(resolve));
  };
  return {probe, ...result, tree, frame, settle};
}

test('an Outliner refresh cannot erase a click while its Blender selection write is pending', async () => {
  const f = await fixture();
  f.adapter.selection.set(['Cube']);
  f.tree(); // loading/read publication still sees the previous engine frame
  assert.deepEqual(f.probe.published, [['Cube']]);
  await f.settle(0, ['Cube']);
  assert.deepEqual(f.probe.published, [['Cube']]);
  f.probe.engine = {selected: ['Camera'], active: 'Camera'};
  f.frame();
  assert.deepEqual(f.probe.published, [['Cube'], ['Camera']], 'later native changes remain authoritative');
  f.dispose();
});

test('an older selection completion cannot replace a newer click', async () => {
  const f = await fixture();
  f.adapter.selection.set(['Cube']); f.adapter.selection.set(['Camera']);
  await f.settle(0, ['Cube']); f.tree();
  assert.deepEqual(f.probe.published, [['Cube'], ['Camera']]);
  await f.settle(1, ['Camera']);
  assert.deepEqual(f.probe.published, [['Cube'], ['Camera']]);
  f.dispose();
});

test('a refused write restores Blender selection and reports the refusal', async () => {
  const f = await fixture();
  f.adapter.selection.set(['Cube']);
  f.probe.writes[0].resolve({error: 'object is not selectable'});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.probe.published, [['Cube'], []]);
  assert.match(f.probe.errors[0][0], /object is not selectable/);
  f.dispose();
});

test('a retired adapter never publishes a late selection completion', async () => {
  const f = await fixture();
  f.adapter.selection.set(['Cube']); f.dispose();
  await f.settle(0, ['Camera']);
  assert.deepEqual(f.probe.published, [['Cube']]);
});

test('a rejected worker call restores the native selection without an unhandled rejection', async () => {
  const f = await fixture();
  f.adapter.selection.set(['Cube']);
  f.probe.writes[0].reject(new Error('worker disconnected'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.probe.published, [['Cube'], []]);
  assert.match(f.probe.errors[0][0], /worker disconnected/);
  f.dispose();
});
