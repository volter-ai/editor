import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundled = await build({
  stdin: {
    contents: `export { HistoryService } from './history-service';
      export { setHistoryDelegate } from './history-delegate';`,
    resolveDir: fileURLToPath(new URL('../src/history/', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { HistoryService, setHistoryDelegate } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`
);

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
