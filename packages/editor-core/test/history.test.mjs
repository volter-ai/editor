import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundled = await build({
  stdin: {
    contents: `export { HistoryService } from './history-service';
      export { setHistoryDelegate, emitHistoryElement, recordedHistoryElements,
        invalidateHistoryResources, onHistoryInvalidated, notifyHistoryDelegateChanged } from './history-delegate';`,
    resolveDir: fileURLToPath(new URL('../src/history/', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { HistoryService, setHistoryDelegate, emitHistoryElement, recordedHistoryElements,
  invalidateHistoryResources, onHistoryInvalidated, notifyHistoryDelegateChanged } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`
);

test('native invalidation removes catch-up entries and notifies the workbench', () => {
  const undo = async () => true;
  emitHistoryElement({ id: 'model', label: 'Move', resources: ['cube.blend'], undo, redo: undo });
  emitHistoryElement({ id: 'source', label: 'Type', resources: ['main.ts'], undo, redo: undo });
  let invalidated;
  const unsubscribe = onHistoryInvalidated(paths => { invalidated = paths; });
  invalidateHistoryResources(['cube.blend']);
  assert.deepEqual(invalidated, ['cube.blend']);
  assert.deepEqual(recordedHistoryElements().map(element => element.id), ['source']);
  unsubscribe();
  invalidateHistoryResources(['main.ts']);
});

test('an empty native document history does not report an undo or redo', async () => {
  const history = new HistoryService();
  let invoked = 0;
  setHistoryDelegate({
    canUndo: () => false, canRedo: () => false,
    undo: () => invoked++, redo: () => invoked++,
  });
  try {
    assert.equal(await history.undo(), false);
    assert.equal(await history.redo(), false);
    assert.equal(invoked, 0);
  } finally {
    setHistoryDelegate(null);
  }
});

test('native history waits for restoration and propagates failures', async () => {
  const history = new HistoryService();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let settled = false;
  setHistoryDelegate({
    canUndo: () => true, canRedo: () => true,
    undo: () => pending,
    redo: async () => { throw new Error('native restore failed'); },
  });
  try {
    const undo = history.undo().then(value => { settled = true; return value; });
    await Promise.resolve();
    assert.equal(settled, false);
    release();
    assert.equal(await undo, true);
    await assert.rejects(history.redo(), /native restore failed/);
  } finally {
    setHistoryDelegate(null);
  }
});

test('a handled native command that refused restoration reports no movement', async () => {
  const history = new HistoryService();
  setHistoryDelegate({
    canUndo: () => true, canRedo: () => true,
    undo: async () => false, redo: async () => false,
  });
  try {
    assert.equal(await history.undo(), false);
    assert.equal(await history.redo(), false);
  } finally {
    setHistoryDelegate(null);
  }
});

test('native availability and labels follow completed moves and document focus', async () => {
  const history = new HistoryService();
  let applied = true;
  let focused = true;
  setHistoryDelegate({
    canUndo: () => focused && applied, canRedo: () => focused && !applied,
    undoLabel: () => focused && applied ? 'Move' : null,
    redoLabel: () => focused && !applied ? 'Move' : null,
    undo: async () => { applied = false; return true; },
    redo: async () => { applied = true; return true; },
  });
  try {
    assert.equal(history.getSnapshot().undoLabel, 'Move');
    await history.undo();
    assert.equal(history.getSnapshot().canUndo, false);
    assert.equal(history.getSnapshot().canRedo, true);
    assert.equal(history.getSnapshot().redoLabel, 'Move');
    // The workbench's own keyboard path does not call HistoryService.undo.
    applied = true;
    notifyHistoryDelegateChanged();
    assert.equal(history.getSnapshot().canUndo, true);
    focused = false;
    assert.equal(history.getSnapshot().canUndo, false);
    assert.equal(history.getSnapshot(), history.getSnapshot());
  } finally {
    history.dispose();
    setHistoryDelegate(null);
  }
});
