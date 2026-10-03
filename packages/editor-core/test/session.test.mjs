import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {startFrameProxy} from '../dist/server/frame-proxy.js';
import {closeHttpServer, createProcessShutdown} from '../dist/server/process-shutdown.js';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('workbench proxy routes session and native requests and retains isolation headers', async () => {
  let discoveryRequests = 0;
  const upstream = createServer((req, res) => {
    if (req.url === '/') {
      if (++discoveryRequests === 1) { res.writeHead(503); res.end('starting'); return; }
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
    const origin = new URL(proxy.url).origin;
    const control = await fetch(`${origin}/__editor/project`);
    assert.equal(control.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(control.headers.get('cross-origin-embedder-policy'), 'credentialless');
    assert.equal(control.headers.get('document-policy'), 'js-profiling');
    assert.deepEqual(await control.json(), {path: '/__editor/project'});
    assert.equal(discoveryRequests, 2);
    const native = await fetch(`${origin}/modeling/static/probe.js`);
    const page = await fetch(origin);
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
