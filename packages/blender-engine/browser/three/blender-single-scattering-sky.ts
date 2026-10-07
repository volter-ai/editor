/* SPDX-FileCopyrightText: 2011-2020 Blender Authors
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single-scattering precomputation from intern/sky/source/sky_single_scattering.cpp,
 * Blender revision 071e080 (the public source retained on this machine).
 * The atmosphere, quadrature, spectrum and nonlinear LUT layout are Blender's.
 * Float operations retain the native model's precision at Earth-scale positions.
 */
import type {SkyParameters} from './blender-sky';

const f = Math.fround;
const RAYLEIGH_SCALE = 8000, MIE_SCALE = 1200, MIE_COEFF = f(2e-5);
const MIE_G = f(0.76), SQR_G = f(MIE_G * MIE_G);
const EARTH_RADIUS = 6360000, ATMOSPHERE_RADIUS = 6420000;
const PI = f(Math.PI), HALF_PI = f(Math.PI / 2), TWO_PI = f(Math.PI * 2);
const IRRADIANCE = [1.45756829855593, 1.5659630555973838, 1.6514844906767046, 1.7149624273720931, 1.7579798380502054, 1.7825640788592454, 1.7909510847583856, 1.7854155013341066, 1.7681555486430685, 1.741220696472504, 1.7064712716494368, 1.6655608745273989, 1.6199343724245185, 1.5708359736889208, 1.5193233505930548, 1.466284949652144, 1.4124585274017245, 1.358449619703841, 1.3047491384473928, 1.2517496327261082, 1.1997599875542062].map(f);
const RAYLEIGH_COEFF = [5.424820087636473e-05, 4.418549866505454e-05, 3.635151910165377e-05, 3.017929012024763e-05, 2.526320226989157e-05, 2.130859310621843e-05, 1.809838025320633e-05, 1.547057129129042e-05, 1.33028497733685e-05, 1.150184784075764e-05, 9.99557429990163e-06, 8.72799973630707e-06, 7.65513700977967e-06, 6.74217203751443e-06, 5.96134125832052e-06, 5.2903459806581e-06, 4.71115687557433e-06, 4.20910481110487e-06, 3.77218381260133e-06, 3.3905125547728e-06, 3.05591531679811e-06].map(f);
const OZONE_COEFF = [3.25126849861e-09, 5.85395365047e-09, 1.977191155085e-08, 7.309568762914e-08, 2.0084561514287e-07, 4.0383958096161e-07, 6.3551335912363e-07, 9.670704118097e-07, 1.5479740042441e-06, 2.09038647223331e-06, 2.46128056164565e-06, 2.73551299461512e-06, 2.15125863128643e-06, 1.59051840791988e-06, 1.12356197979857e-06, 7.3527551487574e-07, 4.6450130357806e-07, 3.3096079921048e-07, 2.2512612292678e-07, 1.487912926649e-07, 1.6828623364192e-07].map(f);
const CMF_XYZ = [[0.001368, 3.9e-05, 0.006450001], [0.01431, 0.000396, 0.06785001], [0.13438, 0.004, 0.6456], [0.34828, 0.023, 1.74706], [0.2908, 0.06, 1.6692], [0.09564, 0.13902, 0.8129501], [0.0049, 0.323, 0.272], [0.06327, 0.71, 0.07824999], [0.2904, 0.954, 0.0203], [0.5945, 0.995, 0.0039], [0.9163, 0.87, 0.001650001], [1.0622, 0.631, 0.0008], [0.8544499, 0.381, 0.00019], [0.4479, 0.175, 2e-05], [0.1649, 0.061, 0.0], [0.04677, 0.017, 0.0], [0.01135916, 0.004102, 0.0], [0.002899327, 0.001047, 0.0], [0.0006900786, 0.0002492, 0.0], [0.0001661505, 6e-05, 0.0], [4.150994e-05, 1.499e-05, 0.0]].map(row => row.map(f));
const QUADRATURE_NODES = [0.006811185292, 0.03614807107, 0.09004346519, 0.1706680068, 0.2818362161, 0.4303406404, 0.6296271457, 0.9145252695].map(f);
const QUADRATURE_WEIGHTS = [0.01750893642, 0.04135477391, 0.06678839063, 0.09507698807, 0.1283416365, 0.1707430204, 0.2327233347, 0.3562490486].map(f);

type V = readonly [number, number, number];
const add = (a: V, b: V): V => [f(a[0] + b[0]), f(a[1] + b[1]), f(a[2] + b[2])];
const scale = (a: V, b: number): V => [f(a[0] * b), f(a[1] * b), f(a[2] * b)];
const multiply = (a: V, b: V): V => [f(a[0] * b[0]), f(a[1] * b[1]), f(a[2] * b[2])];
const dot = (a: V, b: V): number => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
const length = (a: V): number => f(Math.sqrt(dot(a, a)));
const direction = (latitude: number, longitude: number): V => [
  f(f(Math.cos(latitude)) * f(Math.cos(longitude))),
  f(f(Math.cos(latitude)) * f(Math.sin(longitude))), f(Math.sin(latitude)),
];

function atmosphereDistance(position: V, ray: V): number {
  const b = f(2 * dot(ray, position));
  const c = f(dot(position, position) - f(ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS));
  return f(f(-b + f(Math.sqrt(f(f(b * b) - f(4 * c))))) / 2);
}

function earthBlocks(position: V, ray: V): boolean {
  if (ray[2] >= 0) return false;
  const b = f(2 * dot(ray, position));
  const c = f(dot(position, position) - f(EARTH_RADIUS * EARTH_RADIUS));
  return f(f(b * b) - f(4 * c)) >= 0;
}

function density(position: V): V {
  const height = f(length(position) - EARTH_RADIUS);
  return [f(Math.exp(f(-height / RAYLEIGH_SCALE))), f(Math.exp(f(-height / MIE_SCALE))),
    f(Math.max(0, f(1 - f(Math.abs(f(height - 25000)) / 15000))))];
}

/** Native quadrature integrates the density factors rather than 21 spectra. */
function opticalDepth(position: V, ray: V): V {
  const end = add(position, scale(ray, atmosphereDistance(position, ray)));
  const distance = length([f(end[0] - position[0]), f(end[1] - position[1]), f(end[2] - position[2])]);
  const segment = scale(ray, distance);
  let depth: V = [0, 0, 0];
  for (let i = 0; i < QUADRATURE_NODES.length; i++)
    depth = add(depth, scale(density(add(position, scale(segment, QUADRATURE_NODES[i]!))), QUADRATURE_WEIGHTS[i]!));
  return scale(depth, distance);
}

function spectrumToXyz(spectrum: Float32Array): V {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < spectrum.length; i++) {
    x = f(x + f(CMF_XYZ[i]![0]! * spectrum[i]!));
    y = f(y + f(CMF_XYZ[i]![1]! * spectrum[i]!));
    z = f(z + f(CMF_XYZ[i]![2]! * spectrum[i]!));
  }
  return [f(x * 20), f(y * 20), f(z * 20)];
}

function inscattering(ray: V, sun: V, origin: V, factors: V): V {
  const end = add(origin, scale(ray, atmosphereDistance(origin, ray)));
  const rayLength = length([f(end[0] - origin[0]), f(end[1] - origin[1]), f(end[2] - origin[2])]);
  const step = f(rayLength / 32), segment = scale(ray, step);
  const mu = dot(ray, sun), mu2 = f(mu * mu);
  const rayleigh = f(f(f(.1875 * f(1 / Math.PI)) * f(1 + mu2)));
  const denominator = f(f(f(8 * PI) * f(2 + SQR_G)) * f(Math.pow(f(f(1 + SQR_G) - f(f(2 * MIE_G) * mu)), 1.5)));
  const mie = f(f(f(f(3 * f(1 - SQR_G)) * f(1 + mu2))) / denominator);
  const result = new Float32Array(21);
  let depth: V = [0, 0, 0], position = add(origin, scale(segment, .5));
  for (let i = 0; i < 32; i++) {
    const d = multiply(factors, density(position));
    depth = add(depth, scale(d, step));
    if (!earthBlocks(position, sun)) {
      const total = add(depth, multiply(factors, opticalDepth(position, sun)));
      for (let wl = 0; wl < 21; wl++) {
        const extinction = f(f(f(total[0] * RAYLEIGH_COEFF[wl]!) + f(total[1] * f(1.11 * MIE_COEFF))) + f(total[2] * OZONE_COEFF[wl]!));
        const attenuation = f(Math.exp(-extinction));
        const scattering = f(f(rayleigh * f(d[0] * RAYLEIGH_COEFF[wl]!)) + f(mie * f(d[1] * MIE_COEFF)));
        result[wl] = f(result[wl]! + f(f(f(attenuation * scattering) * IRRADIANCE[wl]!) * step));
      }
    }
    position = add(position, segment);
  }
  return spectrumToXyz(result);
}

/** SKY_single_scattering_precompute_texture: upper sky mirrored in longitude,
 * lower sky faded from the horizon, with more latitude samples near it. */
export function precomputeSingleScatteringSky(p: SkyParameters, width = 512, height = 256): Float32Array {
  const pixels = new Float32Array(width * height * 3);
  const halfWidth = width / 2, halfHeight = height / 2;
  const origin: V = [0, 0, f(EARTH_RADIUS + Math.min(59999, Math.max(1, f(p.altitude))))];
  const sun = direction(f(p.sunElevation), 0);
  const factors: V = [f(p.airDensity), f(p.aerosolDensity), f(p.ozoneDensity)];
  const longitudeStep = f(TWO_PI / width);
  for (let y = halfHeight; y < height; y++) {
    const latitudeStep = f(f(y / halfHeight) - 1);
    const latitude = f(HALF_PI * f(latitudeStep * latitudeStep));
    for (let x = 0; x < halfWidth; x++) {
      const longitude = f(f(longitudeStep * x) - PI);
      const xyz = inscattering(direction(latitude, longitude), sun, origin, factors);
      pixels.set(xyz, (y * width + x) * 3);
      pixels.set(xyz, (y * width + width - x - 1) * 3);
    }
  }
  for (let y = 0; y < halfHeight; y++) {
    const latitudeStep = f(f(y / halfHeight) - 1);
    const z = f(Math.sin(f(HALF_PI * f(latitudeStep * latitudeStep))));
    let fade = 0;
    if (z < .4) { fade = f(1 - f(z * 2.5)); fade = f(f(fade * fade) * fade); }
    for (let x = 0; x < width * 3; x++) pixels[y * width * 3 + x] = f(pixels[halfHeight * width * 3 + x]! * fade);
  }
  return pixels;
}
