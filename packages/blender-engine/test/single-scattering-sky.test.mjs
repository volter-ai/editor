import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const result = await build({stdin: {contents: `
  export {precomputeSingleScatteringSky, precomputeSingleScatteringSun} from './blender-single-scattering-sky';
  export {skyTextureKey, primeSkyTexture, hasSkyTexture, skyField} from './blender-sky';
  export {collectSkyParameters, worldField, worldSolarIrradiance, withoutSolarDiscs} from './world-field-sampler';
  export {WorldBackground} from './blender-runtime-lighting';
  export {Vector3, Scene, Group, FloatType} from 'three';`,
  resolveDir: fileURLToPath(new URL('../browser/three/', import.meta.url)), loader: 'ts'},
  bundle: true, platform: 'node', format: 'esm', write: false});
const {precomputeSingleScatteringSky, precomputeSingleScatteringSun, skyTextureKey, primeSkyTexture, hasSkyTexture,
  skyField, collectSkyParameters, worldField, worldSolarIrradiance, withoutSolarDiscs, WorldBackground, Vector3, Scene, Group, FloatType} = await import('data:text/javascript;base64,' +
  Buffer.from(result.outputFiles[0].contents).toString('base64'));
const reference = JSON.parse(await readFile(new URL('./fixtures/single-scattering-sky.json', import.meta.url)));
const solarReference = JSON.parse(await readFile(new URL('./fixtures/single-scattering-sun.json', import.meta.url)));

test('solar spectral radiance matches pinned native sun precomputation', () => {
  for (const {parameters, bottom, top} of solarReference.cases) {
    const actual = precomputeSingleScatteringSun(parameters, parameters.sunSize);
    [bottom, top].forEach((pixel, edge) => pixel.forEach((expected, channel) =>
      assert.ok(Math.abs(actual[edge][channel] - expected) <= Math.max(.01, Math.abs(expected) * 2e-6),
        `solar edge ${edge} channel ${channel}: ${actual[edge][channel]} vs native ${expected}`)));
  }
});

test('world sunlight follows rotation, intensity, expression weights and native limb darkening', () => {
  const p = solarReference.cases[0].parameters;
  primeSkyTexture(p, new Float32Array(512 * 256 * 3));
  const expression = {kind:'sky', sky_model:p.model, sun_disc:true, sun_size:p.sunSize,
    sun_intensity:1, sun_elevation:p.sunElevation, sun_rotation:2.6179938316345215,
    altitude:p.altitude, air_density:p.airDensity, aerosol_density:p.aerosolDensity,
    ozone_density:p.ozoneDensity};
  const [sun] = worldSolarIrradiance(expression);
  assert.ok(sun.irradiance.length() > 100);
  assert.ok(sun.direction.distanceTo(new Vector3(Math.cos(p.sunElevation)*Math.cos(expression.sun_rotation),
    Math.cos(p.sunElevation)*Math.sin(expression.sun_rotation), Math.sin(p.sunElevation))) < 1e-12);
  const field = worldField(expression), center = field(sun.direction).clone();
  const edge = sun.direction.clone().applyAxisAngle(new Vector3().crossVectors(sun.direction, new Vector3(0,0,1)).normalize(), p.sunSize*.49);
  assert.ok(field(edge).length() < center.length() * .6);
  assert.equal(worldField(withoutSolarDiscs(expression))(sun.direction).length(), 0);
  assert.deepEqual(worldSolarIrradiance({...expression, sun_disc:false}), []);
  const [half] = worldSolarIrradiance({...expression, sun_intensity:.5});
  assert.ok(half.irradiance.distanceTo(sun.irradiance.clone().multiplyScalar(.5)) < 1e-8);
  const [quarter] = worldSolarIrradiance({kind:'mix_color',factor:.25,a:[0,0,0],b:expression,clamp_factor:false,clamp_result:false});
  assert.ok(quarter.irradiance.distanceTo(sun.irradiance.clone().multiplyScalar(.25)) < 1e-8);
});

test('world sun composes once, keeps HDR radiance, and releases lights with its world', async () => {
  const p = solarReference.cases[0].parameters;
  primeSkyTexture(p, new Float32Array(512 * 256 * 3));
  // Aim at a sampled background texel, whose native solar radiance exceeds
  // half-float range. This must neither clip nor enter the diffuse IBL twice.
  const expression = {kind:'sky',sky_model:p.model,sun_disc:true,sun_size:p.sunSize,sun_intensity:1,
    sun_elevation:(101.5/128-.5)*Math.PI,sun_rotation:Math.PI/256,
    altitude:0,air_density:1,aerosol_density:1,ozone_density:1};
  primeSkyTexture({...p,sunElevation:expression.sun_elevation}, new Float32Array(512*256*3));
  const scene = new Scene(), root = new Group();scene.add(root);
  const world = new WorldBackground();
  world.apply(root, {color:[0,0,0],strength:.4,shader:expression});await world.ready();
  assert.equal(world.solarLights.length,1);
  assert.equal(world.solarLights[0].intensity,.4);
  assert.equal(world.solarLights[0].castShadow,true);
  world.apply(root,{color:[0,0,0],strength:1,shader:expression});await world.ready();
  assert.equal(world.solarLights.length,1,'no accumulating sunlight on repeated presents');
  assert.equal(scene.background.type,FloatType);
  assert.ok(scene.background.image.data.some(v=>v>65504));
  assert.ok(scene.environment.image.data.every((v,index)=>index%4===3 || v===0),'disc excluded from the IBL');
  world.clear();
  assert.equal(world.solarLights.length,0);
  assert.equal(scene.children.length,1);
  assert.equal(scene.background,null);assert.equal(scene.environment,null);
});

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
