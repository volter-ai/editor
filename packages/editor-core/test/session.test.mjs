import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {test} from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {startFrameProxy} from '../dist/server/frame-proxy.js';
import {closeHttpServer, createProcessShutdown} from '../dist/server/process-shutdown.js';

const originBundle = await build({
  stdin: {contents: "export {isAllowedEditorOrigin} from './server/server-utils';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url))},
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {isAllowedEditorOrigin} = await import(
  `data:text/javascript;base64,${Buffer.from(originBundle.outputFiles[0].contents).toString('base64')}`,
);

const lifecycleBundle = await build({
  entryPoints: [fileURLToPath(new URL('../server/tab-lifecycle.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {createTabLifecycle} = await import(
  `data:text/javascript;base64,${Buffer.from(lifecycleBundle.outputFiles[0].contents).toString('base64')}`,
);

test('ensuring a ready project focuses without navigation; a launcher can still be adopted', () => {
  const sent = [], opened = [];
  const controller = createTabLifecycle({
    editorUrl: 'http://editor-abcd.localhost:28000/?project=project',
    openUrl: url => opened.push(url),
    sendToTab: (tabId, event, data) => { sent.push({tabId, event, data}); return true; },
    broadcastToClients: () => 0,
    lastIndexRequestAt: () => null, now: () => 1000, tickIntervalMs: 0,
  });
  try {
    controller.onTabChannelOpen('tab', 'vscode');
    controller.onBeat({tabId: 'tab', epoch: 'epoch', seq: 1, visibility: 'visible'});
    controller.onTabListener('tab', 'epoch');
    controller.onTabRoute('tab', 'project');
    assert.equal(controller.ensure(true), 'focused');
    assert.deepEqual(sent.at(-1), {tabId: 'tab', event: 'tab-refocus', data: {}});
    assert.deepEqual(opened, []);
    controller.onTabRoute('tab', 'no-project');
    assert.equal(controller.ensure(true), 'adopt');
    assert.equal(sent.at(-1).event, 'tab-adopt');
    assert.equal(sent.at(-1).data.url, 'http://editor-abcd.localhost:28000/?project=project');
  } finally { controller.stop(); }
});

test('project localhost origins can attach while remote lookalikes remain refused', () => {
  assert.equal(isAllowedEditorOrigin('http://editor-abcd.localhost:28000'), true);
  assert.equal(isAllowedEditorOrigin('http://localhost:28000'), true);
  assert.equal(isAllowedEditorOrigin('http://127.0.0.1:28000'), true);
  for (const origin of ['http://localhost.example.com', 'http://editor.localhost.example.com', 'http://notlocalhost', 'http://example.com']) {
    assert.equal(isAllowedEditorOrigin(origin), false, origin);
  }
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('workbench proxy routes session and native requests and retains isolation headers', async () => {
  let discoveryRequests = 0;
  let pageCookie;
  const upstream = createServer((req, res) => {
    if (req.url === '/') {
      if (++discoveryRequests === 1) { res.writeHead(503); res.end('starting'); return; }
      pageCookie = req.headers.cookie;
      res.setHeader('content-type', 'text/html');
      res.end('<meta id="vscode-workbench-web-base-url" data-settings="/modeling/static">');
      return;
    }
    res.setHeader('content-type', 'text/plain');
    res.end(`workbench:${req.url}`);
  });
  const session = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({path: req.url}));
  });
  const upstreamPort = await listen(upstream);
  const sessionPort = await listen(session);
  const reservation = createServer();
  const port = await listen(reservation);
  await closeHttpServer(reservation);
  let proxy;
  try {
    proxy = await startFrameProxy({port, upstreamPort, sessionPort,
      projectRoot: '/tmp/modeling-proxy-probe', colorTheme: 'dark', log() {}});
    const canonical = new URL(proxy.url);
    assert.match(canonical.hostname, /^editor-[a-f0-9]{16}\.localhost$/);
    // Node DNS need not resolve *.localhost. Dial loopback while retaining the
    // browser's Host header so this exercises the actual proxy document route.
    const origin = `http://127.0.0.1:${port}`;
    const atProjectHost = suffix => new Promise((resolve, reject) => {
      const req = request(`${origin}${suffix}`, {headers: {host: canonical.host}}, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(new Response(Buffer.concat(chunks), {status: res.statusCode, headers: res.headers})));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
    const control = await fetch(`${origin}/__editor/project`);
    assert.equal(control.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(control.headers.get('cross-origin-embedder-policy'), 'credentialless');
    assert.equal(control.headers.get('document-policy'), 'js-profiling');
    assert.deepEqual(await control.json(), {path: '/__editor/project'});
    assert.equal(discoveryRequests, 2);
    const native = await fetch(`${origin}/modeling/static/probe.js`);
    const staleCookie = 'vscode-secret-key-path=/_vscode-cli/mint-key';
    const beforeRedirect = discoveryRequests;
    const legacy = await fetch(`${origin}/?project=modeling-proxy-probe`, {
      headers: {cookie: staleCookie}, redirect: 'manual',
    });
    assert.equal(legacy.status, 302);
    assert.equal(legacy.headers.get('location'), proxy.url);
    assert.equal(legacy.headers.get('set-cookie'), null, 'Other local apps retain their cookies');
    assert.equal(discoveryRequests, beforeRedirect, 'Alien cookie never boots this workbench');
    const projectRedirect = await atProjectHost('/?project=modeling-proxy-probe');
    assert.equal(projectRedirect.status, 302);
    assert.equal(projectRedirect.headers.get('location'), '/?folder=%2Ftmp%2Fmodeling-proxy-probe');
    const page = await atProjectHost('/');
    assert.equal(page.status, 200);
    assert.equal(pageCookie, undefined);
    assert.equal(page.headers.get('document-policy'), 'js-profiling');
    assert.equal(await native.text(), 'workbench:/modeling/static/probe.js');
  } finally {
    await proxy?.close();
    await Promise.all([closeHttpServer(upstream), closeHttpServer(session)]);
  }
});

test('shutdown runs independent cleanup even if one resource hangs, and is idempotent', async () => {
  const events = [], exits = [];
  let closed = 0;
  const shutdown = createProcessShutdown({taskTimeoutMs: 20, timeoutMs: 200,
    tasks: [
      {name: 'stuck', run: () => new Promise(() => {})},
      {name: 'independent', run: () => { closed++; }},
    ], journal: event => events.push(event), exit: code => exits.push(code), log() {}});
  const first = shutdown('probe');
  assert.equal(shutdown('repeat'), first);
  await first;
  assert.equal(closed, 1);
  assert.deepEqual(exits, [1]);
  assert.equal(events[0].task, 'stuck');
  assert.equal(events[0].outcome, 'timeout');
});
