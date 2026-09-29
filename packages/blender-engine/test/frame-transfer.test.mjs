import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../browser/frame-transfer.mts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { frameTransferBuffers } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('nested mesh columns and images move intact instead of being cloned', () => {
  const positions = new Float64Array([1, 2, 3]);
  const indices = new Uint32Array([0]);
  const image = new Uint8Array([255, 127]);
  const shared = new Uint8Array(new SharedArrayBuffer(8));
  const frame = {
    meshes: { bridge: { columns: { co: positions, triangles: indices }, attributes: [{ data: positions.subarray(1) }] } },
    images: { sky: { encoded: image } },
    overlay: { shared },
  };
  const transfer = frameTransferBuffers(frame);
  assert.equal(transfer.length, 3, 'aliased views transfer their buffer once');
  const delivered = structuredClone(frame, { transfer });
  assert.equal(positions.byteLength, 0);
  assert.equal(indices.byteLength, 0);
  assert.equal(image.byteLength, 0);
  assert.deepEqual([...delivered.meshes.bridge.columns.co], [1, 2, 3]);
  assert.deepEqual([...delivered.images.sky.encoded], [255, 127]);
  assert.equal(shared.byteLength, 8, 'shared memory is not transferable');
});
