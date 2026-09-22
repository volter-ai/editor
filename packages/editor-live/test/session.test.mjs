import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {connect, unconnectedBindings} from '../dist/index.js';

test('installed client attaches only to the intended project and reads command responses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'volter-live-'));
  let servedPath = root;
  let manifestError = null;
  const commands = [];
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/__editor/project') {
      res.end(JSON.stringify(manifestError
        ? {project: null, serving: {path: servedPath, error: manifestError}}
        : {project: {path: servedPath}}));
      return;
    }
    if (req.url === '/__editor/command') {
      let body = ''; for await (const chunk of req) body += chunk;
      commands.push(JSON.parse(body));
      res.write('{"ok":true,');
      // Reading the response must finish before the Node agent is disposed.
      setImmediate(() => res.end('"state":"ready"}'));
      return;
    }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  try {
    await mkdir(join(root, '.vgai'));
    await writeFile(join(root, 'vgai.project.json'), '{}');
    await writeFile(join(root, '.vgai/session.json'), JSON.stringify({port, pid: process.pid,
      startedAt: new Date().toISOString(), url: `http://127.0.0.1:${port}`}));
    const deps = {transport: {listSessions: async () => []}};
    const session = await connect(root, deps);
    assert.equal(session.session.port, port);
    assert.equal((await session.editor.blender('blender-status')).state, 'ready');
    assert.deepEqual(commands, [{type: 'blender-status'}]);
    assert.equal('game' in session, false);
    assert.equal('recording' in session.editor, false);
    assert.equal('play' in session.editor, false);

    manifestError = 'roots must be an array';
    await assert.rejects(connect(root, deps), /roots must be an array/);
    manifestError = null;
    servedPath = join(root, 'different-project');
    await assert.rejects(connect(root, deps), /lists NO live sessions/);
    await assert.rejects(connect(root, {transport: {listSessions: async () => [
      {port, project: servedPath, pid: process.pid},
    ]}}), /none of them opens/);
    await assert.rejects(connect(root, {transport: {listSessions: async () => {
      throw new Error('discovery unavailable');
    }}}), /discovery unavailable/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, {recursive: true, force: true});
  }
});

test('surface introspection does not need a running session', () => {
  const bindings = unconnectedBindings();
  assert.deepEqual(Object.keys(bindings), ['editor', 'tools']);
  assert.equal(typeof bindings.editor.document.query, 'function');
  assert.equal(typeof bindings.editor.blender, 'function');
});
