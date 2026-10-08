import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: [new URL('../view/page/service-worker.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2022',
});

function worker({ embedded = true, announced = true, owner = true, recordedEntries = () => ({}) } = {}) {
  const listeners = {};
  const deliveries = [];
  const origin = 'https://trial.example';
  const clients = new Map();
  const editor = {
    id: 'editor', type: 'window', frameType: embedded ? 'nested' : 'top-level',
    visibilityState: 'visible',
    postMessage(message, ports) {
      if (message.type === 'volter-view:announce') {
        listeners.message({ data: { type: 'volter-view:page-ready' }, source: editor });
      } else {
        deliveries.push(this.id);
        ports[0].postMessage({ status: 200, headers: [['Content-Type', 'application/json']], body: new TextEncoder().encode('{"project":"canyon"}').buffer });
      }
    },
  };
  const extension = { id: 'extension-host', type: 'window', frameType: 'nested', postMessage() {} };
  if (owner) clients.set(editor.id, editor);
  clients.set(extension.id, extension);
  class Channel {
    port1 = { onmessage: null };
    port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage({ data })) };
  }
  runInNewContext(outputFiles[0].text, {
    self: {
      clients: { get: async id => clients.get(id), matchAll: async () => [...clients.values()] },
      addEventListener: (name, callback) => { listeners[name] = callback; },
    },
    location: { origin }, Request, Response, Headers, URL, TextEncoder,
    setTimeout, clearTimeout, MessageChannel: Channel,
    fetch: async url => String(url).startsWith('/__view/r/')
      ? new Response(String(url), { headers: { 'Content-Type': 'text/javascript' } })
      : Response.json({ entries: recordedEntries() }),
  });
  if (owner && announced) listeners.message({ data: { type: 'volter-view:page-ready' }, source: editor });
  return {
    deliveries,
    request(clientId, navigation = false, pathname = '/__editor/assets') {
      let response;
      const request = navigation ? { url: `${origin}/`, mode: 'navigate', method: 'GET' } : new Request(`${origin}${pathname}`);
      listeners.fetch({ request, clientId, resultingClientId: '', respondWith: value => { response = value; } });
      return response;
    },
  };
}

test('an embedded editor answers its own project requests', async () => {
  const view = worker();
  const response = await view.request('editor');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { project: 'canyon' });
  assert.deepEqual(view.deliveries, ['editor']);
});

test("the host's own routes are left to the browser", () => {
  const view = worker();
  assert.equal(view.request('editor', false, '/api/account'), undefined);
  assert.equal(view.request('editor', false, '/auth/start'), undefined);
});

test('the view document opts in to cross-origin embedding after worker control', async () => {
  const response = await worker().request('editor', true);
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'credentialless');
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
});

test('opening a replacement build refreshes the worker module table', async () => {
  let version = 'old';
  const view = worker({ recordedEntries: () => ({
    [`/node_modules/react.js?v=${version}`]: { file: `${version}.js`, type: 'text/javascript', status: 200 },
  }) });
  const first = await view.request('editor', false, '/node_modules/react.js?v=old');
  assert.equal(await first.text(), '/__view/r/old.js');
  version = 'new';
  await view.request('editor', true);
  const second = await view.request('editor', false, '/node_modules/react.js?v=new');
  assert.equal(await second.text(), '/__view/r/new.js');
  assert.deepEqual(view.deliveries, []);
});

test('extension-host requests go to the announced editor, not the extension iframe', async () => {
  const view = worker();
  assert.equal((await view.request('extension-host')).status, 200);
  assert.deepEqual(view.deliveries, ['editor']);
});

test('a restarted worker discovers an embedded editor again', async () => {
  const view = worker({ announced: false });
  assert.equal((await view.request('worker')).status, 200);
  assert.deepEqual(view.deliveries, ['editor']);
});

test('a standalone editor still answers its requests', async () => {
  const view = worker({ embedded: false });
  assert.equal((await view.request('editor')).status, 200);
});

test('an extension iframe alone cannot claim to hold a project', async () => {
  const view = worker({ owner: false });
  const response = await view.request('extension-host');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('x-volter-limited-view'), 'no-page');
  assert.deepEqual(view.deliveries, []);
});
