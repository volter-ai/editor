import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const { outputFiles } = await build({
  stdin: {
    contents: 'export { pollEditorLeaseIdentity } from "../../sdk/src/kit/api/project-state.ts";',
    resolveDir: new URL('.', import.meta.url).pathname,
  },
  bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'leaseApi',
});

async function poll(response) {
  const context = { AbortSignal, fetch: async () => response };
  runInNewContext(outputFiles[0].text, context);
  return JSON.parse(JSON.stringify(await context.leaseApi.pollEditorLeaseIdentity()));
}

test('only an explicit page-owned lease opts out of the process watchdog', async () => {
  assert.deepEqual(await poll(Response.json({ project: { path: '/trial' }, session: { pid: 0, lease: 'page' } })), {
    ok: true, identity: { project: '/trial', pid: 0 }, lease: 'page',
  });
  for (const session of [{ pid: 42 }, { pid: 0 }, { pid: 42, lease: 'unknown' }]) {
    assert.deepEqual(await poll(Response.json({ project: { path: '/local' }, session })), {
      ok: true, identity: { project: '/local', pid: session.pid },
    });
  }
});

test('a static host fallback and failed response remain failed polls', async () => {
  assert.deepEqual(await poll(new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } })), { ok: false });
  assert.deepEqual(await poll(Response.json({ error: 'unavailable' }, { status: 503 })), { ok: false });
});
