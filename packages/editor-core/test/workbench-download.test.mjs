import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../../sdk/src/session/workbench-locator.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const token = 'fake-workbench-token';
const tag = 'test-workbench';
const releaseUrl = `https://api.github.com/repos/volter-ai/code-oss/releases/tags/${tag}`;
const assetUrl = id => `https://api.github.com/repos/volter-ai/code-oss/releases/assets/${id}`;

test('project hosts isolate cookies across folders and survive a port change', () => {
  const exports = {};
  vm.runInNewContext(js, {
    exports, process, URL,
    require: name => name === './product-locator'
      ? { PRODUCT_DECLARATION_KEY: 'volter.product', workbenchProductId: () => 'cyclotron' }
      : require(name),
  });
  const first = new URL(exports.workbenchUrl(28000, '/tmp/first/project'));
  const otherFolder = new URL(exports.workbenchUrl(28000, '/tmp/second/project'));
  const otherPort = new URL(exports.workbenchUrl(28001, '/tmp/first/project'));
  assert.notEqual(first.hostname, otherFolder.hostname, 'A common folder name must not share cookies');
  assert.equal(first.hostname, otherPort.hostname, 'Reopening a project retains its browser identity');
  assert.equal(first.searchParams.get('project'), 'project');
  assert.equal(first.port, '28000');
});


test('printed launch URLs use the project name on Windows and POSIX', () => {
  for (const [paths, projectRoot, expected] of [
    [path.win32, "C:\\Users\\person\\My Models\\cube-project\\", "cube-project"],
    [path.win32, "\\\\server\\share\\My Models\\cube project", "cube project"],
    [path.posix, "/Users/person/My Models/cube-project/", "cube-project"],
    [path.posix, "/tmp/literal\\name", "literal\\name"],
  ]) {
    const exports = {};
    vm.runInNewContext(js, {
      exports, process, URL,
      require: name => name === 'node:path' ? paths
        : name === './product-locator' ? { PRODUCT_DECLARATION_KEY: 'volter.product', workbenchProductId: () => 'cyclotron' }
        : require(name),
    });
    const printed = new URL(exports.workbenchUrl(28000, projectRoot));
    assert.equal(printed.searchParams.get('project'), expected);
    assert.match(printed.hostname, /^editor-[a-f0-9]{16}\.localhost$/);
    assert.equal(new URL(exports.workbenchUrl(28001, projectRoot)).hostname, printed.hostname);
  }
});

async function refusal({ failRequest, failBody, malformed, cause }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-download-test-'));
  const requests = [];
  const exports = {};
  const sha = 'a'.repeat(64);
  const assets = [{ id: 1, name: 'BUILD.json', size: 100 }, { id: 2, name: 'workbench.tar.gz', size: 100 }];
  const fetch = async (url, options) => {
    requests.push(url);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    if (requests.length === failRequest) throw cause;
    if (requests.length === failBody) return new Response(new ReadableStream({ start(controller) { controller.error(cause); } }));
    if (requests.length === malformed) return new Response('{');
    if (requests.length === 1) return Response.json({ assets });
    if (requests.length === 2) return Response.json({ platform: `${process.platform}-${process.arch}`, tarballSha256: sha });
    throw new Error('Unexpected download request');
  };
  vm.runInNewContext(js, {
    exports, fetch, URL, console,
    process: { ...process, env: { ...process.env, GITHUB_TOKEN: token } },
    require: name => name === 'node:os' ? { ...os, homedir: () => root }
      : name === './product-locator' ? { PRODUCT_DECLARATION_KEY: 'volter.product', workbenchProductId: () => 'cyclotron' }
      : require(name),
  });
  try {
    let error;
    try {
      await exports.resolveWorkbenchForProject({
        projectRoot: path.join(root, 'project'),
        product: { name: '@volter/cyclotron', command: 'cyclotron', workbench: { release: tag, tarballSha256: sha } },
        io: { log() {} },
      });
    } catch (caught) { error = caught; }
    assert.ok(error, 'Fault must refuse launch');
    if (cause) assert.equal(error.cause, cause, 'Original thrown value remains attached');
    const cache = path.join(root, '.volter/workbenches');
    assert.deepEqual(fs.existsSync(cache) ? fs.readdirSync(cache) : [], [], 'Failed transfer leaves no partial or installed marker');
    assert.equal(fs.existsSync(path.join(root, 'project/.volter/workbench.json')), false);
    assert.equal(requests.length, failRequest ?? failBody ?? malformed, 'No automatic retry or next-stage request');
    assert.equal(error.message.includes(token), false);
    return { message: error.message, requests };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('request failures identify metadata, BUILD and archive URLs with nested transport codes', async () => {
  for (const [failRequest, stage, url] of [[1, 'release metadata request', releaseUrl], [2, 'BUILD.json request', assetUrl(1)], [3, 'archive request', assetUrl(2)]]) {
    const cause = new TypeError('fetch failed', { cause: Object.assign(new Error('connect failed'), { code: 'EADDRNOTAVAIL' }) });
    const result = await refusal({ failRequest, cause });
    assert.ok(result.message.includes(stage));
    assert.ok(result.message.includes(url));
    assert.ok(result.message.includes('EADDRNOTAVAIL'));
  }
});

test('failed body reads identify the transfer that failed and clean the partial directory', async () => {
  for (const [failBody, stage] of [[1, 'release metadata response'], [2, 'BUILD.json response'], [3, 'archive transfer']]) {
    const cause = Object.assign(new Error('stream reset'), { code: 'ECONNRESET' });
    const result = await refusal({ failBody, cause });
    assert.ok(result.message.includes(stage));
    assert.ok(result.message.includes('ECONNRESET'));
  }
});

test('invalid metadata retains JSON parse attribution rather than a generic launch error', async () => {
  for (const [malformed, stage] of [[1, 'release metadata response'], [2, 'BUILD.json parse']]) {
    const result = await refusal({ malformed });
    assert.ok(result.message.includes(stage));
    assert.ok(result.message.includes('SyntaxError'));
  }
});

test('diagnostics redact tokens and signed URLs while preserving aggregate causes', async () => {
  const cause = new TypeError(`fetch failed ${token}`, { cause: new AggregateError([
    Object.assign(new Error(`https://user:password@downloads.example/asset?secret=hidden#fragment ${token}`), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('second connection failed'), { code: 'ETIMEDOUT' }),
    new Error('HTTPS://user:password@downloads.example/asset?secret=hidden#fragment'),
    new Error('hTtPs://user:password@downloads.example/asset?secret=hidden#fragment'),
  ], 'connections failed') });
  const { message } = await refusal({ failRequest: 1, cause });
  for (const secret of [token, 'password', 'hidden', 'fragment', 'user:']) assert.equal(message.includes(secret), false);
  assert.ok(message.includes('https://downloads.example/asset'));
  assert.ok(message.includes('ECONNREFUSED'));
  assert.ok(message.includes('ETIMEDOUT'));
});
