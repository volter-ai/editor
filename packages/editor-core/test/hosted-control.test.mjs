import assert from 'node:assert/strict';
import { test } from 'node:test';
import { control } from '../dist/server/launcher/control.js';

test('hosted operation success preserves diagnostics without failing; operation errors still reject', async () => {
  const priorExit = process.exitCode;
  const originalLog = console.log, originalError = console.error;
  const out = [], err = [];
  console.log = value => out.push(value);
  console.error = value => err.push(value);
  try {
    process.exitCode = undefined;
    const diagnostic = { entries: [{ severity: 'error', message: 'optional native watchdog unavailable' }, { severity: 'warn', message: 'shader limitation' }] };
    const client = { getUnresolvedConsole: async () => diagnostic };
    const live = { editor: { status: async () => ({ connected: true, wasmMemoryMB: 3335 }) }, tools: {}, session: { port: 0, projectRoot: 'hosted' } };
    await control('editor', 'status', undefined, undefined, undefined, { live, client, consolePolicy: 'report' });
    assert.equal(process.exitCode, undefined);
    assert.equal(JSON.parse(out[0]).wasmMemoryMB, 3335);
    assert.deepEqual(JSON.parse(err[0]), diagnostic);
    live.editor.status = async () => { throw new Error('editor refused'); };
    await assert.rejects(control('editor', 'status', undefined, undefined, undefined, { live, client, consolePolicy: 'report' }), /editor refused/);
    live.editor.status = async () => ({ connected: true });
    await control('editor', 'status', undefined, undefined, undefined, { live, client });
    assert.equal(process.exitCode, 1, 'existing local console policy stays strict');
  } finally {
    console.log = originalLog; console.error = originalError; process.exitCode = priorExit;
  }
});
