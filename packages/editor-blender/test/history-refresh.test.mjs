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
    start(project, document) { probe.started = {project, document}; return Promise.resolve({}); }
    get presented() { return probe.presented ?? null; }
    present() { probe.presents = (probe.presents ?? 0) + 1; return Promise.resolve(); }
  }`,
  '@volter/editor-sdk/host': `export const editorHost = () => ({...probe.host, documents: {activeId: () => null, ...probe.host.documents}});`,
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

for (const explicit of [false, true]) test(`cold start resolves the declared Model document (explicit=${explicit})`, async () => {
  const probe = {host: {
    session: {open: () => true, onBeforeClose() {}, onEnded() {}, reportWorkerCallMeter() {}},
    documents: {context: () => undefined},
    workspace: {open: async address => { probe.opened = address; return true; }},
    project: {documentTable: async () => ({entries: [{id: 'custom-model-id', kind: 'model', source: {path: 'src/models/cube.blend'}}], default: null})},
  }};
  const module = {exports: {}};
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url), probe, AbortController,
  });
  const result = await module.exports.handleBlenderCommand({
    type: 'blender-start', project: '/project', ...(explicit ? {document: 'src/models/cube.blend'} : {}),
  });
  assert.equal(result.ok, true);
  assert.equal(probe.opened.kind, 'document');
  assert.equal(probe.opened.id, 'custom-model-id');
  assert.equal(probe.started.document, 'src/models/cube.blend');
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

test('cold start honors the declared default and refuses ambiguous Models', async () => {
  for (const defaultId of [null, 'second']) {
    const probe = {host: {
      session: {open: () => true, onBeforeClose() {}, onEnded() {}, reportWorkerCallMeter() {}},
      documents: {context: () => undefined},
      workspace: {open: async address => { probe.opened = address; return true; }},
      project: {documentTable: async () => ({entries: [
        {id: 'first', kind: 'model', source: {path: 'first.blend'}},
        {id: 'second', kind: 'model', source: {path: 'second.blend'}},
      ], default: defaultId})},
    }};
    const module = {exports: {}};
    runInNewContext(bundle.outputFiles[0].text, {
      module, exports: module.exports, require: createRequire(import.meta.url), probe, AbortController,
    });
    const result = await module.exports.handleBlenderCommand({type: 'blender-start', project: '/project'});
    if (defaultId === null) {
      assert.equal(result.ok, false);
      assert.match(result.error, /Choose a Model document/);
      assert.equal(probe.opened, undefined);
      assert.equal(probe.options, undefined);
    } else {
      assert.equal(result.ok, true);
      assert.equal(probe.opened.id, defaultId);
      assert.equal(probe.started.document, 'second.blend');
    }
  }
});

for (const [name, shown, latest, needed] of [
  ['already presented during file open', {session: 's', revision: 1}, {session: 's', revision: 1}, 0],
  ['reopened pane without a frame', null, {session: 's', revision: 1}, 1],
  ['new file without an initial frame', null, null, 1],
  ['view from a previous session', {session: 'old', revision: 1}, {session: 's', revision: 1}, 1],
  ['view behind the engine revision', {session: 's', revision: 1}, {session: 's', revision: 2}, 1],
]) test(`Model open presents only when needed: ${name}`, async () => {
  const binding = {documentId: 'document:model:scene.blend', entryId: 'model:scene.blend', blend: 'scene.blend'};
  let published = false;
  const view = {snapshot: () => shown, stageFrame() {}, applyFrame() {}, captureSnapshot() {}, recordPresentation() {}, recordPhotograph() {}};
  const probe = {presented: latest, presents: 0, host: {
    session: {open: () => true, onBeforeClose() {}, onEnded() {}, reportWorkerCallMeter() {}},
    projectLocalState: {projectRootPath: () => '/project'},
    documents: {activeId: () => binding.documentId, context: () => undefined,
      waitForContext: async () => { assert(published); return view; }},
  }};
  const module = {exports: {}};
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url), probe, AbortController,
  });
  module.exports.bindModelDocument(binding);
  assert.equal(await module.exports.openModelDocumentBlend(binding, () => { published = true; }), true);
  assert.equal(probe.presents, needed);
});
