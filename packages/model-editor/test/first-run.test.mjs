import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import { writeProject } from '../dist-node/create.js';

const startupBundle = await build({ entryPoints: [fileURLToPath(new URL('../node/startup.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { startupProject } = await import(`data:text/javascript;base64,${Buffer.from(startupBundle.outputFiles[0].contents).toString('base64')}`);

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'model-editor-first-run-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cwd = join(home, 'launch');
  await mkdir(cwd);
  return { home, cwd };
}

test('bare launch creates a saved cube project, then reopens it without resetting edits', async t => {
  const options = await fixture(t);
  let creations = 0;
  const create = async request => { creations++; return writeProject(request); };
  const folder = await startupProject(create, options);
  assert.equal(folder, join(options.home, 'Documents', 'Volter Models', 'Untitled Model'));
  const adapter = await readFile(join(folder, 'volter.adapter.ts'), 'utf8');
  assert.match(adapter, /default: 'model:src\/models\/cube.blend'/);
  assert.ok((await readFile(join(folder, 'src/models/cube.blend'))).length > 0);
  const mcp = JSON.parse(await readFile(join(folder, '.mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers.blender.command, 'node');
  assert.match(await readFile(join(folder, '.codex/config.toml'), 'utf8'), /\[mcp_servers.blender\]/);
  assert.match(await readFile(join(folder, 'AGENTS.md'), 'utf8'), /execute_blender_code/);
  assert.equal(await readFile(join(folder, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  await writeFile(join(folder, 'src/models/cube.py'), '# user edit\n');
  assert.equal(await startupProject(create, options), folder);
  assert.equal(creations, 1);
  assert.equal(await readFile(join(folder, 'src/models/cube.py'), 'utf8'), '# user edit\n');
});

test('launch from a project subfolder opens its project and creates no starter', async t => {
  const options = await fixture(t);
  await writeFile(join(options.cwd, 'volter.project.json'), '{}');
  const subfolder = join(options.cwd, 'src', 'models');
  await mkdir(subfolder, { recursive: true });
  assert.equal(await startupProject(() => assert.fail('must not create'), { ...options, cwd: subfolder }), options.cwd);
});

test('an occupied starter folder is preserved and creation failures remain failures', async t => {
  const options = await fixture(t);
  const occupied = join(options.home, 'Documents', 'Volter Models', 'Untitled Model');
  await mkdir(occupied, { recursive: true });
  await writeFile(join(occupied, 'my-work.txt'), 'keep me');
  const folder = await startupProject(writeProject, options);
  assert.equal(folder, `${occupied} 2`);
  assert.equal(await readFile(join(occupied, 'my-work.txt'), 'utf8'), 'keep me');
  await assert.rejects(writeProject({ name: 'Duplicate', targetDir: folder }), { code: 'EEXIST' });
  const other = await fixture(t);
  await assert.rejects(startupProject(async () => { throw new Error('installation failed'); }, other), /installation failed/);
});

const chatBundle = await build({ entryPoints: [fileURLToPath(new URL('../node/chat.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'live-fixture', setup(builder) {
    builder.onResolve({ filter: /^@volter\/editor-live$/ }, () => ({ path: 'live', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const connect = globalThis.connect;' }));
  } }] });

function chatFixture(state, resource = 'supercode://conversation/conversation') {
  const calls = [];
  const context = { URL, module: { exports: {} }, connect: async () => ({ editor: { command: async (id, args) => {
    calls.push({ id, args });
    return id === 'supercode.frontend.status' ? state : id === 'volter.chat.inspect' ? { sessionResource: resource } : null;
  } } }) };
  runInNewContext(chatBundle.outputFiles[0].text, context);
  return { chat: context.module.exports.chat, calls };
}
const ready = { activeSession: 'conversation', setupHandoff: { complete: true },
  connections: [{ id: 'conversation', sessionId: 'native-session', pendingRequests: [] }] };

test('external prompts use the visible native conversation and preserve the human draft', async () => {
  const { chat, calls } = chatFixture(ready);
  const receipt = await chat(['send', 'Round the cube']);
  assert.equal(receipt.dispatched, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(2))), [
    { id: 'workbench.action.chat.open', args: { query: 'Round the cube', isPartialQuery: false, preserveInput: true } },
  ]);
  await chat(['stop']);
  assert.equal(calls.at(-1).id, 'workbench.action.chat.cancel');
});

test('a visible new-chat draft retains its chosen agent and unrelated chats are refused', async () => {
  const draft = chatFixture(ready, 'supercode:/untitled-new-chat');
  assert.equal((await draft.chat(['send', 'Inspect the cube'])).dispatched, true);
  assert.ok(!draft.calls.some(c => c.id === 'volter.chat.openSession'));
  const unrelated = chatFixture(ready, 'other-agent:/conversation');
  await assert.rejects(unrelated.chat(['send', 'Inspect the cube']), /focused Chat/);
  const switched = chatFixture({ ...ready, setupHandoff: { complete: false } });
  assert.equal((await switched.chat(['send', 'Inspect the cube'])).dispatched, true);
});

test('signed-out, busy and pending-approval states refuse another prompt', async () => {
  for (const state of [{}, { ...ready, connections: [], setupHandoff: { complete: false } }, { ...ready, busy: true },
    { ...ready, connections: [{ id: 'conversation', pendingRequests: [{ id: 1 }] }] }]) {
    const { chat, calls } = chatFixture(state);
    await assert.rejects(chat(['send', 'Round the cube']), /Chat (is not ready|has an active turn)/);
    assert.equal(calls.length, 2);
    assert.equal((await chat(['status'])).activeSession, state.activeSession);
  }
  const { chat, calls } = chatFixture(ready);
  await assert.rejects(chat(['send', ' ']), /Usage:/);
  assert.equal(calls.length, 0);
});
