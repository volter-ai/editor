import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const result = await build({stdin: {contents: `
  export {precomputeSingleScatteringSky} from './blender-single-scattering-sky';
  export {skyTextureKey, primeSkyTexture, hasSkyTexture, skyField} from './blender-sky';
  export {collectSkyParameters} from './world-field-sampler';
  export {Vector3} from 'three';`,
  resolveDir: fileURLToPath(new URL('../browser/three/', import.meta.url)), loader: 'ts'},
  bundle: true, platform: 'node', format: 'esm', write: false});
const {precomputeSingleScatteringSky, skyTextureKey, primeSkyTexture, hasSkyTexture,
  skyField, collectSkyParameters, Vector3} = await import('data:text/javascript;base64,' +
  Buffer.from(result.outputFiles[0].contents).toString('base64'));
const reference = JSON.parse(await readFile(new URL('./fixtures/single-scattering-sky.json', import.meta.url)));

test('single-scattering LUT matches native Blender at horizon, zenith and lower sky', () => {
  const pixels = precomputeSingleScatteringSky(reference.parameters, reference.width, reference.height);
  for (const {pixel: [x, y], xyz} of reference.samples)
    xyz.forEach((expected, channel) => assert.ok(
      Math.abs(pixels[(y * reference.width + x) * 3 + channel] - expected) < 2e-5,
      `native XYZ mismatch at ${x},${y}, channel ${channel}`));
  for (let y = 0; y < reference.height; y++)
    for (let x = 0; x < reference.width / 2; x++)
      for (let channel = 0; channel < 3; channel++)
        assert.equal(pixels[(y * reference.width + x) * 3 + channel],
          pixels[(y * reference.width + reference.width - x - 1) * 3 + channel]);
});

test('sky identities separate models and preserve native elevation conventions', () => {
  const single = reference.parameters;
  const multiple = {...single, model: 'MULTIPLE_SCATTERING'};
  assert.notEqual(skyTextureKey(single), skyTextureKey(multiple));
  const {model, ...legacy} = multiple;
  assert.equal(skyTextureKey(multiple), skyTextureKey(legacy));
  assert.equal(skyTextureKey(single), skyTextureKey({...single, sunRotation: 5}));
  assert.notEqual(skyTextureKey(single), skyTextureKey({...single, sunElevation: Math.PI - single.sunElevation}));
});

test('off-thread model selection reaches the sampler without an inline precompute', () => {
  const p = reference.parameters;
  const expression = {kind: 'sky', sky_model: p.model, sun_elevation: p.sunElevation,
    sun_rotation: p.sunRotation, altitude: p.altitude, air_density: p.airDensity,
    aerosol_density: p.aerosolDensity, ozone_density: p.ozoneDensity};
  assert.deepEqual(collectSkyParameters(expression), [p]);
  const pixels = new Float32Array(512 * 256 * 3); pixels.fill(1);
  primeSkyTexture(p, pixels);
  assert.equal(hasSkyTexture(p), true);
  assert.equal(hasSkyTexture({...p, model: 'MULTIPLE_SCATTERING'}), false);
  const a = skyField(p)(new Vector3(0, 0, 1)).clone();
  const b = skyField(p)(new Vector3(1, 0, 0));
  assert.deepEqual(a.toArray(), b.toArray());
  assert.ok(a.toArray().every(Number.isFinite));
});
