import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/session-close.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { onBeforeSessionClose, prepareSessionClose } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);
test('close waits for save barriers, coalesces requests and permits retry after refusal', async () => {
  let release;
  let fail = true;
  const remove = onBeforeSessionClose(async () => {
    await new Promise(resolve => { release = resolve; });
    if (fail) throw new Error('save failed');
  });
  try {
    const first = prepareSessionClose();
    assert.equal(prepareSessionClose(), first);
    const refusal = assert.rejects(first, /save failed/);
    await Promise.resolve();
    release();
    await refusal;
    fail = false;
    const retry = prepareSessionClose();
    await Promise.resolve();
    release();
    await retry;
  } finally { remove(); }
  await prepareSessionClose();
});

const cli = await build({
  entryPoints: [fileURLToPath(new URL('../server/launcher/control.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'session-fixture', setup(builder) {
    builder.onResolve({ filter: /^@volter\/editor-live$|^@volter\/editor-sdk\/client$|^\.\/editor-sessions$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const connect = globalThis.fixture.connect;
      export const EditorClient = globalThis.fixture.Client;
      export const verifiedSessions = globalThis.fixture.sessions;
      export const terminateEditorSession = globalThis.fixture.terminate;
    ` }));
  } }],
});
test('CLI never signals the process before saves, refuses failed saves, and closes headless sessions', async () => {
  const events = [];
  let fail = false, headless = false;
  const context = {
    module: { exports: {} }, console: { log() {} },
    fixture: {
      connect: async () => ({ session: { port: 123, projectRoot: '/project' } }),
      sessions: async () => [{ port: 123, project: '/project', registered: true, pid: 456 }],
      terminate: async () => { events.push('terminate'); return 'graceful'; },
      Client: class {
        async getState() { return headless ? { connected: false, tabs: [] } : { connected: true }; }
        async prepareClose() { events.push('save'); if (fail) throw new Error('disk full'); }
      },
    },
  };
  runInNewContext(cli.outputFiles[0].text, context);
  const { control } = context.module.exports;
  await control('volter-model-editor', 'close');
  assert.deepEqual(events.splice(0), ['save', 'terminate']);
  fail = true;
  await assert.rejects(control('volter-model-editor', 'close'), /disk full/);
  assert.deepEqual(events.splice(0), ['save']);
  headless = true;
  await control('volter-model-editor', 'close');
  assert.deepEqual(events, ['terminate']);
});
