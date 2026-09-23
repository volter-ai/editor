import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../browser/runtime.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
// Preserve a valid base for the worker URL while loading the actual runtime.
const source = bundle.outputFiles[0].text.replaceAll('import.meta.url', JSON.stringify(import.meta.url));
const { BlenderRuntime } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

class FakeWorker {
  static latest;
  messages = [];
  terminations = 0;
  constructor() { FakeWorker.latest = this; }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminations++; }
  reply(message, result = {}) { this.onmessage({ data: { id: message.id, result } }); }
  fail(message) { this.onmessage({ data: { id: message.id, error: 'HTTP 507 disk full' } }); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeWorker(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  globalThis.Worker = FakeWorker;
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'Worker', original);
    else delete globalThis.Worker;
  });
}

test('explicit shutdown persists before termination and refuses new work', async t => {
  fakeWorker(t);
  const runtime = new BlenderRuntime({ present: () => ({}) });
  const worker = FakeWorker.latest;
  const start = runtime.start('/project', 'model.blend');
  worker.reply(worker.messages[0]);
  await start;
  const edit = runtime.execute('edit');
  await tick();
  const stopping = runtime.stop();
  assert.equal(runtime.stop(), stopping);
  await tick();
  assert.deepEqual(worker.messages.map(m => m.op), ['start', 'execute', 'flush-document']);
  assert.equal(worker.terminations, 0);
  await assert.rejects(runtime.execute('too late'), /stopping/);
  worker.reply(worker.messages[1]);
  await edit;
  assert.equal(worker.terminations, 0);
  worker.reply(worker.messages[2]);
  await stopping;
  assert.equal(worker.terminations, 1);
  await runtime.stop();
  runtime.terminate();
  assert.equal(worker.terminations, 1);
});

test('failed save retains the worker and permits retry', async t => {
  fakeWorker(t);
  const runtime = new BlenderRuntime({ present: () => ({}) });
  const worker = FakeWorker.latest;
  const start = runtime.start('/project');
  worker.reply(worker.messages[0]);
  await start;
  const stopping = runtime.stop();
  const refused = assert.rejects(stopping, /disk full/);
  await tick();
  worker.fail(worker.messages.at(-1));
  await refused;
  assert.equal(worker.terminations, 0);
  const retry = runtime.stop();
  await tick();
  assert.equal(worker.messages.at(-1).op, 'flush-document');
  worker.reply(worker.messages.at(-1));
  await retry;
  assert.equal(worker.terminations, 1);
});

test('stop waits for startup; an unused runtime needs no save', async t => {
  fakeWorker(t);
  const runtime = new BlenderRuntime({ present: () => ({}) });
  const worker = FakeWorker.latest;
  const start = runtime.start('/project');
  const stopping = runtime.stop();
  await tick();
  assert.equal(worker.messages.length, 1);
  worker.reply(worker.messages[0]);
  await start;
  await tick();
  worker.reply(worker.messages[1]);
  await stopping;
  const unused = new BlenderRuntime({ present: () => ({}) });
  await unused.stop();
  assert.equal(FakeWorker.latest.messages.length, 0);
  assert.equal(FakeWorker.latest.terminations, 1);
});

test('worker edit acknowledgment waits for durable upload; failed saves stay dirty and retry', async () => {
  const workerBundle = await build({
    entryPoints: [fileURLToPath(new URL('../browser/worker.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'cjs', write: false,
    plugins: [{ name: 'engine-fixture', setup(builder) {
      builder.onResolve({ filter: /blender-engine\.mts|session-frame\.mts/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
        args.path.includes('blender-engine')
          ? 'export const startBlenderEngine = globalThis.startEngine;'
          : 'export const describeFrame = (_, frame) => frame; export const columnsToTypedArrays = (_, frame) => frame;',
      }));
    } }],
  });
  let options, finishUpload, failUpload = false;
  let revision = 0;
  const events = [], replies = [];
  const self = { postMessage(reply) { replies.push(reply); } };
  const context = {
    self, module: { exports: {} }, setTimeout, clearTimeout, Uint8Array, ArrayBuffer, Blob,
    startEngine: async value => {
      options = value;
      return {
        readArena: async () => new ArrayBuffer(0), memoryBytes: () => null,
        files: { readFile: async () => new Uint8Array([revision]) },
        request: async request => {
          events.push(request.op);
          if (request.op === 'execute') {
            await options.ask({ frame: {}, saveDue: true });
            revision++;
            return { result: 'edited' };
          }
          if (request.op === 'save-document') return { saved: true, path: '/project/model.blend' };
          if (request.op === 'history-events') return [];
          return {};
        },
      };
    },
    fetch: async (url, init) => {
      if (url.endsWith('/status')) return { ok: true, json: async () => ({ available: true }) };
      if (url.endsWith('blender-project-index')) return { ok: true, json: async () => ({ root: '/project', files: [] }) };
      assert.ok(url.startsWith('/__editor/blender-document'));
      events.push(`upload:${new Uint8Array(await init.body.arrayBuffer())[0]}`);
      await new Promise(resolve => { finishUpload = resolve; });
      return { ok: !failUpload, status: 507, text: async () => 'disk full' };
    },
  };
  runInNewContext(workerBundle.outputFiles[0].text, context);
  const send = data => self.onmessage({ data });
  const until = async predicate => {
    for (let i = 0; i < 100 && !predicate(); i++) await tick();
    assert.ok(predicate(), `worker reached expected state: ${JSON.stringify({ events, replies })}`);
  };
  send({ id: 1, op: 'start', project: '/project', document: 'model.blend' });
  await until(() => replies.some(r => r.id === 1 && 'result' in r));
  send({ id: 2, op: 'execute', code: 'edit' });
  await until(() => replies.some(r => r.op === 'present'));
  assert.ok(!events.includes('save-document'));
  // This must bypass the command queue: the edit is waiting for its frame.
  send({ op: 'present-result', id: replies.find(r => r.op === 'present').id });
  await until(() => events.includes('upload:1'));
  assert.ok(!replies.some(r => r.id === 2 && !r.op));
  failUpload = true;
  finishUpload();
  await until(() => replies.some(r => r.id === 2 && !r.op));
  assert.match(replies.find(r => r.id === 2 && !r.op).error, /disk full/);
  assert.equal(replies.filter(r => r.op === 'document-dirty').at(-1).dirty, true);
  failUpload = false;
  send({ id: 4, op: 'flush-document' });
  await until(() => events.filter(e => e === 'upload:1').length === 2);
  finishUpload();
  await until(() => replies.some(r => r.id === 4));
  assert.equal(replies.find(r => r.id === 4).result.saved, true);
  assert.equal(replies.filter(r => r.op === 'document-dirty').at(-1).dirty, false);
});

test('browser unload is guarded while calls or failed saves remain, not after persistence', async t => {
  fakeWorker(t);
  const events = new EventTarget();
  const add = globalThis.addEventListener, remove = globalThis.removeEventListener;
  globalThis.addEventListener = events.addEventListener.bind(events);
  globalThis.removeEventListener = events.removeEventListener.bind(events);
  t.after(() => { globalThis.addEventListener = add; globalThis.removeEventListener = remove; });
  const runtime = new BlenderRuntime({ present: () => ({}) });
  const worker = FakeWorker.latest;
  const guarded = () => {
    const event = new Event('beforeunload', { cancelable: true });
    // DOM BeforeUnloadEvent has a writable string returnValue.
    Object.defineProperty(event, 'returnValue', { value: '', writable: true });
    events.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(guarded(), false);
  const start = runtime.start('/project');
  assert.equal(guarded(), true);
  worker.reply(worker.messages[0]);
  await start;
  assert.equal(guarded(), false);
  worker.onmessage({ data: { op: 'document-dirty', dirty: true } });
  assert.equal(guarded(), true);
  worker.onmessage({ data: { op: 'document-dirty', dirty: false } });
  assert.equal(guarded(), false);
  runtime.terminate();
  assert.equal(guarded(), false);
});
