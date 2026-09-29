import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const source = await build({ entryPoints: ['packages/blender-engine/browser/pull-job.mts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { PullJob, checkpointStream } = await import(`data:text/javascript;base64,${Buffer.from(source.outputFiles[0].text).toString('base64')}`);

test('load producer is parked between requests; stale and concurrent continuations cannot advance it', async () => {
  const work = [];
  const job = new PullJob(async pause => {
    work.push('boot'); await pause('booted');
    work.push('open'); await pause('opened');
    work.push('present'); return { ready: true };
  });
  const first = await job.step(); assert.equal(first.phase, 'booted');
  await new Promise(resolve => setTimeout(resolve, 5)); assert.deepEqual(work, ['boot']);
  await assert.rejects(job.step('wrong'), /Invalid/);
  const pending = job.step(first.token);
  await assert.rejects(job.step(first.token), /Invalid/);
  const second = await pending; assert.deepEqual(work, ['boot', 'open']);
  await assert.rejects(job.step(first.token), /Invalid/);
  assert.deepEqual(await job.step(second.token), { load: 'done', value: { ready: true } });
  await assert.rejects(job.step(second.token), /Invalid/);
});

test('failure belongs to the resumed unit and never masquerades as completion', async () => {
  const job = new PullJob(async pause => { await pause('loaded'); throw new Error('export failed'); });
  const first = await job.step();
  await assert.rejects(job.step(first.token), /export failed/);
  await assert.rejects(job.step(), /Invalid/);
});

test('imports preserve bytes and backpressure at one MiB boundaries', async () => {
  const input = new Uint8Array(3 * 1024 * 1024 + 17);
  for (let i = 0; i < input.length; i++) input[i] = i % 251;
  let advances = 0, release;
  const stream = checkpointStream(new ReadableStream({ start(c) { c.enqueue(input); c.close(); } }),
    () => { advances++; return new Promise(resolve => { release = resolve; }); });
  const reader = stream.getReader(); let offset = 0;
  for (let chunk = 0; chunk < 4; chunk++) {
    const pending = reader.read();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(advances, chunk + 1); release();
    const { value, done } = await pending; assert.equal(done, false);
    assert(value.length <= 1024 * 1024); assert.deepEqual(value, input.subarray(offset, offset + value.length));
    offset += value.length;
    await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(advances, chunk + 1);
  }
  assert.equal(offset, input.length); assert.equal((await reader.read()).done, true);
});

test('actual worker startup parks the engine and completes streamed presentation before readiness', async () => {
  const { runInNewContext } = await import('node:vm');
  const bundled = await build({ entryPoints: ['packages/blender-engine/browser/worker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'engine-port', setup(b) {
      b.onResolve({ filter: /blender-engine\.mts|session-frame\.mts/ }, a => ({ path: a.path, namespace: 'port' }));
      b.onLoad({ filter: /.*/, namespace: 'port' }, a => ({ contents: a.path.includes('blender-engine')
        ? 'export const startBlenderEngine = globalThis.startEngine;'
        : 'export const isColumnDescriptor = () => false; export const describeFrame = (_,f) => f; export const columnsToTypedArrays = (_,f) => f;' }));
    } }],
  });
  const replies = [], events = [];
  const self = { addEventListener() {}, postMessage(reply) {
    replies.push(reply);
    if (reply.op === 'frame-stream') queueMicrotask(() => self.onmessage({ data: { op: 'present-result', id: reply.id } }));
  } };
  const context = { self, module: { exports: {} }, performance, crypto, TextEncoder, TextDecoder,
    Uint8Array, ArrayBuffer, Blob, ReadableStream, setTimeout, clearTimeout,
    fetch: async url => ({ ok: true, json: async () => url.endsWith('/status') ? { available: true } : { root: '/project', files: [] } }),
    startEngine: async options => ({ files: {}, readArena: async () => new Uint8Array(0), memoryBytes: () => null,
      request: async request => {
        events.push(request.op);
        if (request.op === 'history-events') return [];
        await options.ask({ checkpoint: 'opened' }); events.push('evaluated');
        await options.ask({ frame: { session: 'proof', revision: 1, meshes: {}, images: {} } });
        events.push('presented'); return { session: 'proof' };
      },
    }),
  };
  runInNewContext(bundled.outputFiles[0].text, context);
  let id = 0;
  const send = async command => {
    const call = ++id; self.onmessage({ data: { ...command, id: call } });
    for (let tries = 0; tries < 1000; tries++) {
      const answer = replies.find(r => r.id === call && !r.op);
      if (answer) { assert.equal(answer.error, undefined); return answer.result; }
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.fail('startup continuation did not settle');
  };
  let result = await send({ op: 'start', project: '/project', document: 'proof.blend' });
  assert.equal(result.phase, 'engine-ready'); assert.deepEqual(events, []);
  while (result.load === 'continue') {
    const before = events.slice(); await new Promise(resolve => setTimeout(resolve, 2)); assert.deepEqual(events, before);
    result = await send({ op: 'load-next', token: result.token });
  }
  assert.equal(result.load, 'done'); assert.equal(result.value.session, 'proof');
  assert.deepEqual(events, ['start', 'evaluated', 'presented', 'history-events']);
  assert(replies.some(r => r.op === 'frame-stream'));
});
