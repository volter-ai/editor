import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { control } from '../dist/server/launcher/control.js';
import * as uiCore from '@volter/supercode-ui/core';

const require = createRequire(import.meta.url);
// Exercise the real catalog, controls HTTP boundary and chat lifecycle; the
// runtime's credential mint and the discovery UI are outside this test.
function loadServer(name) {
  const source = readFileSync(new URL(`../server/${name}.ts`, import.meta.url), 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'cjs', logLevel: 'silent' });
  const module = { exports: {} };
  const imports = specifier => {
    if (specifier.startsWith('node:')) return require(specifier);
    if (specifier === '@volter/supercode-ui/core') return uiCore;
    if (specifier === '../src/harness-chat-types') return loadServer('../src/harness-chat-types');
    if (specifier === './frontend-controls' || specifier === './chat-session-catalog') return loadServer(specifier.slice(2));
    if (specifier === './frontend-handoff') return {
      mintFrontendHandoff: async () => ({ env: {}, isBusy: async () => false, dispose: async () => {} }),
    };
    if (['@volter/supercode-ui/controller', '@volter/supercode-ui/host', './coding-inference-launch', './project-mcp-servers'].includes(specifier)) return {};
    throw new Error(`Unexpected test import: ${specifier}`);
  };
  runInNewContext(code, { module, exports: module.exports, require: imports, process, console, Buffer, URL,
    setTimeout, clearTimeout, AbortSignal, structuredClone });
  return module.exports;
}

const { ChatSessionCatalog } = loadServer('chat-session-catalog');
const { HarnessChatService } = loadServer('harness-chat-service');
const selection = { harness: 'codex', model: 'test-model', effort: 'medium' };

async function fixture(t, { identity = null, active = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'editor-chat-restore-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, '.volter', 'chat-sessions.json');
  const catalog = new ChatSessionCatalog(file);
  const entry = catalog.create(selection);
  entry.identity = identity;
  if (!active) catalog.create({ ...selection, model: 'other-model' });
  catalog.save();
  const service = new HarnessChatService({ engineRoot: root, getProjectRoot: () => root, onChange() {}, discoveryPollMs: 0 });
  const actions = [];
  service.workspace = root;
  service.controller = {
    async dispatch(action) {
      actions.push(action);
      if (action.type === 'start') service.managedRuntime = { handle: { runtime_id: 'test-runtime' }, closed: false };
      return { error: null };
    },
    async close() {},
  };
  service.lastSnapshot = { ...service.lastSnapshot, error: null, requests: [], turn: { state: 'idle' }, sessions: [],
    harnesses: [{ id: 'codex', label: 'Codex', availableActions: { start: true, resume: false } }] };
  t.after(() => service.close());
  const env = await service.frontendControlsEnv();
  async function open() {
    const response = await fetch(`${env.SUPERCODE_FRONTEND_HOST_URL}/open`, { method: 'POST',
      headers: { Authorization: `Bearer ${readFileSync(env.SUPERCODE_FRONTEND_HOST_CREDENTIAL_FILE, 'utf8')}` },
      body: JSON.stringify({ id: entry.id }) });
    return { status: response.status, body: await response.json() };
  }
  return { service, entry, actions, open, saved: () => JSON.parse(readFileSync(file, 'utf8')) };
}

test('reopen an unsent chat with its saved selection and catalog id; successful eval remains successful', async t => {
  const f = await fixture(t);
  const restored = await f.open();
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.deepEqual(restored.body.selection, selection);
  assert.equal(restored.body.activeSession, f.entry.id);
  assert.deepEqual(restored.body.history, []);
  assert.equal(f.actions.length, 1);
  assert.equal(f.actions[0].type, 'start');
  assert.equal(f.actions[0].harness, 'codex');
  assert.equal(f.saved().sessions.length, 1, 'restore must not create a second catalog entry');
  assert.equal(f.saved().sessions[0].identity, null);
  const priorExit = process.exitCode, originalLog = console.log;
  try {
    process.exitCode = undefined;
    const output = [];
    console.log = value => output.push(value);
    await control('editor', 'eval', '6 * 7', undefined, undefined, {
      live: { editor: {}, tools: {}, session: { port: 0, projectRoot: 'test' } },
      client: { getUnresolvedConsole: async () => ({ entries: restored.body.error ? [restored.body.error] : [] }) },
    });
    assert.equal(output[0], '42');
    assert.equal(process.exitCode, undefined);
  } finally { console.log = originalLog; process.exitCode = priorExit; }
});

test('switching to another unsent chat keeps its identity and requires start rather than resume readiness', async t => {
  const f = await fixture(t, { active: false });
  const restored = await f.open();
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.activeSession, f.entry.id);
  assert.deepEqual(restored.body.selection, selection);
  assert.equal(f.saved().sessions.length, 2);
  assert.equal(f.actions[0].type, 'start');
});

test('restore waits for the initial handoff and reuses an already running unsent chat', async t => {
  const f = await fixture(t);
  let finish;
  let entered;
  const opening = new Promise(resolve => { entered = resolve; });
  const originalOpen = f.service.openChat.bind(f.service);
  f.service.openChat = id => { entered(); return originalOpen(id); };
  f.service.frontendHandoffInFlight = new Promise(resolve => { finish = () => {
    f.service.frontendHandoffValue = { env: {}, isBusy: async () => false, dispose: async () => {} };
    f.service.managedRuntime = { closed: false };
    resolve();
  }; });
  const pending = f.open();
  await opening;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.actions.length, 0);
  finish();
  assert.equal((await pending).status, 200);
  assert.equal(f.actions.length, 0, 'initial activation must not start a duplicate runtime');
});

test('a persisted conversation still refuses when its exact harness session is unavailable', async t => {
  const f = await fixture(t, { identity: 'persisted-session' });
  f.service.lastSnapshot.harnesses[0].availableActions.resume = true;
  const restored = await f.open();
  assert.equal(restored.status, 400);
  assert.match(restored.body.error, /exact harness session could not be found/);
  assert.ok(f.actions.every(action => action.type !== 'start'));
  assert.equal(f.saved().sessions[0].identity, 'persisted-session');
});
