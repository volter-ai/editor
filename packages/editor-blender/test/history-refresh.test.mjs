import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const stubs = {
  '@volter/blender-engine/browser': `export class BlenderRuntime {
    constructor(options) { probe.options = options; (probe.instances ??= []).push(this); }
    historyStep(id, direction) { probe.moves.push([id, direction]); return probe.restored; }
    start(project, document) { this.project = project; this.document = document; probe.started = {project, document};
      probe.events?.push(['start', document]); return probe.start?.(this) ?? Promise.resolve({}); }
    async stop() { probe.events?.push(['flush', this.document]); await probe.stop?.(this); }
    terminate() { probe.events?.push(['terminate', this.document]); }
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

const tick = () => new Promise(resolve => setImmediate(resolve));
function handoffFixture() {
  const probe = {events: [], instances: [], active: null, open: true, invalidated: [], host: {
    session: {open: () => probe.open, onBeforeClose(fn) { probe.close = fn; }, onEnded() {}, reportWorkerCallMeter() {}},
    projectLocalState: {projectRootPath: () => '/project'},
    history: {record(element) { probe.element = element; }, invalidate(resources) { probe.invalidated.push([...resources]); }},
    documents: {activeId: () => probe.active, context: () => undefined,
      waitForContext: async () => ({snapshot: () => null, stageFrame() {}, applyFrame() {}, captureSnapshot() {}, recordPresentation() {}, recordPhotograph() {}})},
  }};
  const module = {exports: {}};
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require: createRequire(import.meta.url), probe, AbortController,
  });
  function select(blend) {
    const binding = {documentId: `document:model:${blend}`, entryId: `model:${blend}`, blend};
    probe.active = binding.documentId;
    module.exports.bindModelDocument(binding);
    return binding;
  }
  const open = binding => module.exports.openModelDocumentBlend(binding, () => probe.events.push(['publish', binding.blend]));
  return {probe, api: module.exports, select, open};
}

test('file handoff flushes the old owner before starting or publishing the new file', async () => {
  const {probe, api, select, open} = handoffFixture();
  await open(select('A.blend'));
  probe.options.history([{id: 'edit-A', label: 'Move', resource: 'A.blend'}]);
  let saved;
  probe.stop = () => new Promise(resolve => { saved = resolve; });
  const switching = open(select('B.blend'));
  await tick();
  assert.deepEqual(probe.events.slice(-1).map(row => Array.from(row)), [['flush', 'A.blend']]);
  assert.equal(probe.instances.length, 1);
  assert.equal(probe.invalidated.length, 0);
  assert.throws(() => api.blenderRuntime(), /Blender is editing A.blend/);
  saved();
  assert.equal(await switching, true);
  assert.deepEqual(probe.events.slice(-4).map(row => Array.from(row)), [['flush', 'A.blend'], ['terminate', 'A.blend'], ['start', 'B.blend'], ['publish', 'B.blend']]);
  assert.deepEqual(probe.invalidated, [['A.blend']]);
  await assert.rejects(probe.element.undo(), /history belongs to a closed worker/);
});

test('failed persistence retains the old owner and history, and the open queue recovers', async () => {
  const {probe, api, select, open} = handoffFixture();
  await open(select('A.blend'));
  probe.options.history([{id: 'edit-A', label: 'Move', resource: 'A.blend'}]);
  probe.stop = async () => { throw Error('disk full'); };
  await assert.rejects(open(select('B.blend')), /disk full/);
  assert.equal(probe.instances.length, 1);
  assert.equal(probe.invalidated.length, 0);
  await open(select('A.blend'));
  assert.equal(api.blenderRuntime(), probe.instances[0]);
  assert.equal(probe.instances.length, 1, 'returning to the unsaved model reuses its worker');
  probe.stop = undefined;
  assert.equal(await open(select('B.blend')), true);
  assert.equal(probe.instances.length, 2);
});

test('a superseded selection never starts or publishes after the old save finishes', async () => {
  const {probe, select, open} = handoffFixture();
  await open(select('A.blend'));
  let saved;
  probe.stop = () => new Promise(resolve => { saved = resolve; });
  const b = open(select('B.blend'));
  await tick();
  const c = open(select('C.blend'));
  saved();
  assert.equal(await b, false);
  assert.equal(await c, true);
  assert.equal(probe.instances.length, 2);
  assert(!probe.events.some(([kind, file]) => ['start', 'publish'].includes(kind) && file === 'B.blend'));
  assert.equal(probe.instances[1].document, 'C.blend');
});

test('session closure during a save cannot resurrect a worker for the waiting file', async () => {
  const {probe, select, open} = handoffFixture();
  await open(select('A.blend'));
  let saved;
  probe.stop = () => new Promise(resolve => { saved = resolve; });
  const b = open(select('B.blend'));
  await tick();
  probe.open = false;
  const closing = probe.close();
  saved();
  assert.equal(await b, false);
  await closing;
  assert.equal(probe.instances.length, 1);
  assert.equal(probe.events.filter(([kind]) => kind === 'terminate').length, 1);
});

test('reopening the same file preserves its worker and history', async () => {
  const {probe, select, open} = handoffFixture();
  await open(select('A.blend'));
  probe.options.history([{id: 'edit-A', label: 'Move', resource: 'A.blend'}]);
  assert.equal(await open(select('A.blend')), true);
  assert.equal(probe.instances.length, 1);
  assert(!probe.events.some(([kind]) => kind === 'flush' || kind === 'terminate'));
  assert.equal(probe.invalidated.length, 0);
});

test('a selection superseded during startup cannot present into the replacement pane', async () => {
  const {probe, select, open} = handoffFixture();
  await open(select('A.blend'));
  let loaded;
  probe.start = owner => owner.document === 'B.blend' ? new Promise(resolve => { loaded = resolve; }) : Promise.resolve();
  const b = open(select('B.blend'));
  await tick();
  const presentsBefore = probe.presents;
  const c = open(select('C.blend'));
  loaded();
  assert.equal(await b, false);
  assert.equal(await c, true);
  assert.equal(probe.presents, presentsBefore + 1, 'only C requests a new presented frame');
  assert.equal(probe.instances.at(-1).document, 'C.blend');
});

test('explicit stop shares the handoff queue and stops its actual final owner', async () => {
  const {probe, api, select, open} = handoffFixture();
  await open(select('A.blend'));
  let saved;
  probe.stop = owner => owner.document === 'A.blend' ? new Promise(resolve => { saved = resolve; }) : Promise.resolve();
  const b = open(select('B.blend'));
  await tick();
  const stopped = api.handleBlenderCommand({type: 'blender-stop'});
  saved();
  assert.equal(await b, true);
  assert.equal((await stopped).ok, true);
  assert.deepEqual(probe.events.filter(([kind]) => ['flush', 'terminate'].includes(kind)).map(row => Array.from(row)),
    [['flush', 'A.blend'], ['terminate', 'A.blend'], ['flush', 'B.blend'], ['terminate', 'B.blend']]);
});
