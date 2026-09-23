import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundled = await build({
  stdin: {
    contents: "export { worldField } from './three/world-field-sampler'; export { Vector3 } from 'three';",
    resolveDir: fileURLToPath(new URL('../browser/', import.meta.url)), loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { worldField, Vector3 } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`
);
function sample(vector_type, vector, scale = [2, 3, 4], rotation = [0, 0, 0]) {
  return worldField({kind: 'mapping', vector_type, vector, scale, rotation,
    location: [10, 20, 30]})(new Vector3()).toArray();
}

test('world mapping distinguishes point, texture, vector and normal semantics', () => {
  assert.deepEqual(sample('POINT', [1, 2, 3]), [12, 26, 42]);
  assert.deepEqual(sample('TEXTURE', [12, 26, 42]), [1, 2, 3]);
  assert.deepEqual(sample('VECTOR', [1, 2, 3]), [2, 6, 12]);
  const normal = sample('NORMAL', [2, 3, 4]);
  normal.forEach(v => assert.ok(Math.abs(v - 1 / Math.sqrt(3)) < 1e-12));
});

test('texture mapping uses inverse rotation and safe division at zero scale', () => {
  const result = sample('TEXTURE', [10, 22, 30], [2, 0, 4], [0, 0, Math.PI / 2]);
  assert.ok(Math.abs(result[0] - 1) < 1e-12);
  assert.deepEqual(result.slice(1), [0, 0]);
  assert.deepEqual(sample('NORMAL', [1, 2, 3], [0, 0, 0]), [0, 0, 0]);
});

test('linked background strength multiplies radiance without clamping', () => {
  const field = worldField({kind: 'mix_color', factor: 3, a: [0, 0, 0],
    b: [0.25, 0.5, 2], clamp_factor: false, clamp_result: false});
  assert.deepEqual(field(new Vector3()).toArray(), [0.75, 1.5, 6]);
});
