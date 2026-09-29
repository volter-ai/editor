import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createHostedAttachmentRelay } from '../dist/server/hosted-attachment-relay.js';
import { attachHostedEditorPage, connectHostedAttachment, HOSTED_ATTACHMENT_FRAGMENT, isHostedRequest } from '../dist/server/hosted-attachment-client.js';

async function fixture(t, options = {}) {
  let relay;
  const server = createServer((req, res) => void relay.middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  relay = createHostedAttachmentRelay({ origin, ...options }); relay.install(server);
  t.after(async () => { relay.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const create = async () => {
    const response = await fetch(`${origin}/__editor-hosted`, { method: 'POST', body: JSON.stringify({ page: `${origin}/model-editor/example` }) });
    return await response.json();
  };
  return { origin, create };
}
function browser(created) {
  const worker = { ...created, token: created.workerToken };
  const url = new URL(created.page); url.hash = new URLSearchParams({ [HOSTED_ATTACHMENT_FRAGMENT]: JSON.stringify(worker) });
  let scrubbed;
  const page = attachHostedEditorPage({ location: { href: url.href }, replaceUrl(value) { scrubbed = value; } });
  assert.equal(scrubbed, created.page, 'worker capability removed from address');
  return page;
}
async function ready(connection) {
  for (let i = 0; i < 100 && connection.state.phase !== 'ready'; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(connection.state.phase, 'ready');
}

test('hosted attachment reaches existing editor HTTP routes, preserving body/status and tab isolation', async t => {
  const f = await fixture(t);
  const created = await f.create();
  const page = browser(created); t.after(() => page.close());
  const seen = [];
  page.serve(async (input, init) => {
    seen.push({ path: new URL(input).pathname, method: init.method, body: init.body });
    return Response.json({ ok: true, scene: 'Bridge', body: init.body ?? null });
  });
  const client = await connectHostedAttachment({ ...created, token: created.clientToken }); t.after(() => client.close());
  await ready(client);
  const body = JSON.stringify({ type: 'capture-viewport' });
  const answer = await client.fetch('http://127.0.0.1/__editor/command', { method: 'POST', body });
  assert.equal((await answer.json()).scene, 'Bridge');
  assert.deepEqual(seen, [{ path: '/__editor/command', method: 'POST', body }]);
  const other = await f.create();
  const unconnected = await connectHostedAttachment({ ...other, token: other.clientToken }); t.after(() => unconnected.close());
  await assert.rejects(unconnected.fetch('http://127.0.0.1/__editor/state'), /not connected/);
  await assert.rejects(connectHostedAttachment({ ...created, token: other.clientToken }), /refused/);
  await assert.rejects(connectHostedAttachment({ ...created, token: created.workerToken }), /refused/);
});

test('disconnect and cancellation fail the call without replaying a mutation', async t => {
  const f = await fixture(t); const created = await f.create(); const page = browser(created); t.after(() => page.close());
  let calls = 0, aborted = 0;
  page.serve(async (_input, init) => {
    calls++;
    return await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => { aborted++; reject(new Error('aborted')); }, { once: true }));
  });
  const client = await connectHostedAttachment({ ...created, token: created.clientToken }); t.after(() => client.close()); await ready(client);
  const controller = new AbortController();
  const first = client.fetch('http://127.0.0.1/__editor/command', { method: 'POST', body: '{}', signal: controller.signal });
  const firstRejected = assert.rejects(first, /cancelled/);
  while (calls < 1) await new Promise(r => setTimeout(r, 5));
  controller.abort(); await firstRejected;
  while (aborted < 1) await new Promise(r => setTimeout(r, 5));
  const second = client.fetch('http://127.0.0.1/__editor/command', { method: 'POST', body: '{}' });
  const secondRejected = assert.rejects(second, /disconnected/);
  while (calls < 2) await new Promise(r => setTimeout(r, 5));
  page.close(); await secondRejected; assert.equal(calls, 2);
});

test('the attachment rejects arbitrary destinations, oversized inputs and wrong origins', async t => {
  const base = { type: 'request', id: 'a', method: 'POST', path: '/__editor/command' };
  assert.equal(isHostedRequest({ ...base, path: '/api/shell' }), false);
  assert.equal(isHostedRequest({ ...base, path: '/__editor/../secrets' }), false);
  assert.equal(isHostedRequest({ ...base, body: 'x'.repeat(1024 * 1024 + 1) }), false);
  const f = await fixture(t, { maxLeases: 1 });
  const denied = await fetch(`${f.origin}/__editor-hosted`, { method: 'POST', headers: { origin: 'https://elsewhere.example' }, body: '{}' });
  assert.equal(denied.status, 403);
  await f.create();
  const full = await fetch(`${f.origin}/__editor-hosted`, { method: 'POST', body: JSON.stringify({ page: `${f.origin}/x` }) });
  assert.equal(full.status, 429);
});

test('EditorClient uses the attachment for both status and command/screenshot envelopes', async t => {
  const output = await mkdtemp(fileURLToPath(new URL('./.hosted-sdk-', import.meta.url)));
  t.after(() => rm(output, { recursive: true, force: true }));
  await build({ entryPoints: [fileURLToPath(new URL('../../editor-sdk/src/client.ts', import.meta.url))],
    outfile: `${output}/client.mjs`, bundle: true, platform: 'node', format: 'esm', external: ['undici'] });
  const { EditorClient } = await import(pathToFileURL(`${output}/client.mjs`).href);
  const f = await fixture(t); const created = await f.create(); const page = browser(created); t.after(() => page.close());
  page.serve(async (input, init) => {
    if (new URL(input).pathname === '/__editor/state') return Response.json({ connected: true });
    assert.equal(JSON.parse(init.body).type, 'capture-active-document');
    return Response.json({ ok: true, base64: 'aW1hZ2U=', mimeType: 'image/png' });
  });
  const remote = await connectHostedAttachment({ ...created, token: created.clientToken }); t.after(() => remote.close()); await ready(remote);
  const client = new EditorClient({ url: 'http://127.0.0.1', fetch: remote.fetch });
  assert.equal((await client.getState()).connected, true);
  assert.deepEqual(await client.captureActiveDocument(), { ok: true, base64: 'aW1hZ2U=', mimeType: 'image/png' });
});
