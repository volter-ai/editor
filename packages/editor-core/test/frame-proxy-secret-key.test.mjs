import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../server/frame-proxy.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { startFrameProxy } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
);

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
function send(port, path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('the advertised secret-key POST reaches Code-OSS and preserves its response', async () => {
  const received = [];
  const fakeKey = Buffer.alloc(32, 42);
  const upstream = createServer((req, res) => {
    if (req.url === '/') {
      res.end('<meta id="vscode-workbench-web-base-url" data-settings="/oss-test/static">');
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url, method: req.method, cookie: req.headers.cookie,
        body: Buffer.concat(chunks).toString() });
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'set-cookie': 'fake-client-half=test-only; HttpOnly; SameSite=Strict; Path=/',
      });
      res.end(fakeKey);
    });
  });
  const project = createServer((req, res) => {
    res.writeHead(404);
    res.end('project route');
  });
  let proxy;
  try {
    const upstreamPort = await listen(upstream);
    const sessionPort = await listen(project);
    const reservation = createServer();
    const port = await listen(reservation);
    await close(reservation);
    proxy = await startFrameProxy({
      port, upstreamPort, sessionPort, projectRoot: '/tmp/test-project',
      colorTheme: null, log() {},
    });
    const response = await send(port, '/_vscode-cli/mint-key', {
      method: 'POST', headers: { cookie: 'fake-client-half=test-only' }, body: 'request-body',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, fakeKey);
    assert.deepEqual(received, [{
      path: '/_vscode-cli/mint-key', method: 'POST', cookie: 'fake-client-half=test-only',
      body: 'request-body',
    }]);
    assert.equal(response.headers['set-cookie'][0],
      'fake-client-half=test-only; HttpOnly; SameSite=Strict; Path=/');

    for (const path of ['/__editor/project', '/_vscode-cli/mint-key-extra']) {
      assert.equal((await send(port, path)).status, 404);
    }
    assert.equal(received.length, 1, 'unrelated project paths must stay on the project server');
  } finally {
    if (proxy) await proxy.close();
    await close(upstream);
    await close(project);
  }
});
