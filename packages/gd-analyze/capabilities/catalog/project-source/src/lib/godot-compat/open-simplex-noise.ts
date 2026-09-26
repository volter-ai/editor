/**
 * Godot 3's `OpenSimplexNoise` scalar Resource surface.
 *
 * This is the algorithm Godot 3.6 vendors in `thirdparty/misc/open-simplex-noise.c`, including its
 * unsigned 64-bit LCG permutation. JavaScript numbers cannot reproduce that integer wrap, so the
 * seed path uses `BigInt.asUintN(64, ...)`; the noise calculation itself uses numbers just as the
 * original C implementation uses doubles. Octave composition follows
 * `modules/opensimplex/open_simplex_noise.cpp` exactly.
 *
 * Compat owns no random source and no clock. A seed fully determines the permutation arrays, and
 * callers choose the coordinates. The 3D/4D evaluators use the same public-domain OpenSimplex
 * lookup formulation over the exact Godot permutation, gradient tables, squish constants, and
 * normalization factors from `thirdparty/misc/open-simplex-noise.c`.
 */

import { registerGodotObjectIdentity } from './object';
import { makeNoise3D, type OpenSimplexNoise3D } from './open-simplex-noise-3d.js';
import { makeNoise4D, type OpenSimplexNoise4D } from './open-simplex-noise-4d.js';
import { createGodotImage, type GodotImage, IMAGE_FORMAT } from './image';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import { type Vector2, VECTOR2_ZERO } from './vector2';
import type { Vector3 } from './variant-3d';

const STRETCH_2D = -0.211324865405187;
const SQUISH_2D = 0.366025403784439;
const NORM_2D = 47;
const MAX_OCTAVES = 9;
const LCG_MULTIPLIER = 6364136223846793005n;
const LCG_INCREMENT = 1442695040888963407n;

const GRADIENTS_2D = [5, 2, 2, 5, -5, 2, -2, 5, 5, -2, 2, -5, -5, -2, -2, -5] as const;

function coordinate(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`OpenSimplexNoise.${member} requires finite coordinates.`);
  }
  return value;
}

function nextSeed(seed: bigint): bigint {
  return BigInt.asUintN(64, seed * LCG_MULTIPLIER + LCG_INCREMENT);
}

/** Godot's seed-generated 256-entry OpenSimplex permutation. */
function makePermutation(seed: number): Int16Array {
  const source = Int16Array.from({ length: 256 }, (_, index) => index);
  const permutation = new Int16Array(256);
  let state = BigInt.asUintN(64, BigInt.asIntN(32, BigInt(Math.trunc(seed))));

  state = nextSeed(nextSeed(nextSeed(state)));
  for (let index = 255; index >= 0; index -= 1) {
    state = nextSeed(state);
    const selected = Number((state + 31n) % BigInt(index + 1));
    permutation[index] = source[selected] as number;
    source[selected] = source[index] as number;
  }
  return permutation;
}

function extrapolate2(
  permutation: Int16Array,
  xsb: number,
  ysb: number,
  dx: number,
  dy: number,
): number {
  const first = permutation[xsb & 0xff] as number;
  const index = (permutation[(first + ysb) & 0xff] as number) & 0x0e;
  return (GRADIENTS_2D[index] as number) * dx + (GRADIENTS_2D[index + 1] as number) * dy;
}

/** Godot's vendored `open_simplex_noise2`, kept structurally aligned with the original. */
function openSimplexNoise2(permutation: Int16Array, x: number, y: number): number {
  const stretchOffset = (x + y) * STRETCH_2D;
  const xs = x + stretchOffset;
  const ys = y + stretchOffset;
  let xsb = Math.floor(xs);
  let ysb = Math.floor(ys);

  const squishOffset = (xsb + ysb) * SQUISH_2D;
  const xb = xsb + squishOffset;
  const yb = ysb + squishOffset;
  const xins = xs - xsb;
  const yins = ys - ysb;
  const inSum = xins + yins;
  let dx0 = x - xb;
  let dy0 = y - yb;

  let value = 0;

  const dx1 = dx0 - 1 - SQUISH_2D;
  const dy1 = dy0 - SQUISH_2D;
  let attenuation1 = 2 - dx1 * dx1 - dy1 * dy1;
  if (attenuation1 > 0) {
    attenuation1 *= attenuation1;
    value +=
      attenuation1 * attenuation1 * extrapolate2(permutation, xsb + 1, ysb, dx1, dy1);
  }

  const dx2 = dx0 - SQUISH_2D;
  const dy2 = dy0 - 1 - SQUISH_2D;
  let attenuation2 = 2 - dx2 * dx2 - dy2 * dy2;
  if (attenuation2 > 0) {
    attenuation2 *= attenuation2;
    value +=
      attenuation2 * attenuation2 * extrapolate2(permutation, xsb, ysb + 1, dx2, dy2);
  }

  let xsvExtra: number;
  let ysvExtra: number;
  let dxExtra: number;
  let dyExtra: number;
  if (inSum <= 1) {
    const zins = 1 - inSum;
    if (zins > xins || zins > yins) {
      if (xins > yins) {
        xsvExtra = xsb + 1;
        ysvExtra = ysb - 1;
        dxExtra = dx0 - 1;
        dyExtra = dy0 + 1;
      } else {
        xsvExtra = xsb - 1;
        ysvExtra = ysb + 1;
        dxExtra = dx0 + 1;
        dyExtra = dy0 - 1;
      }
    } else {
      xsvExtra = xsb + 1;
      ysvExtra = ysb + 1;
      dxExtra = dx0 - 1 - 2 * SQUISH_2D;
      dyExtra = dy0 - 1 - 2 * SQUISH_2D;
    }
  } else {
    const zins = 2 - inSum;
    if (zins < xins || zins < yins) {
      if (xins > yins) {
        xsvExtra = xsb + 2;
        ysvExtra = ysb;
        dxExtra = dx0 - 2 - 2 * SQUISH_2D;
        dyExtra = dy0 - 2 * SQUISH_2D;
      } else {
        xsvExtra = xsb;
        ysvExtra = ysb + 2;
        dxExtra = dx0 - 2 * SQUISH_2D;
        dyExtra = dy0 - 2 - 2 * SQUISH_2D;
      }
    } else {
      xsvExtra = xsb;
      ysvExtra = ysb;
      dxExtra = dx0;
      dyExtra = dy0;
    }
    xsb += 1;
    ysb += 1;
    dx0 = dx0 - 1 - 2 * SQUISH_2D;
    dy0 = dy0 - 1 - 2 * SQUISH_2D;
  }

  let attenuation0 = 2 - dx0 * dx0 - dy0 * dy0;
  if (attenuation0 > 0) {
    attenuation0 *= attenuation0;
    value += attenuation0 * attenuation0 * extrapolate2(permutation, xsb, ysb, dx0, dy0);
  }

  let attenuationExtra = 2 - dxExtra * dxExtra - dyExtra * dyExtra;
  if (attenuationExtra > 0) {
    attenuationExtra *= attenuationExtra;
    value +=
      attenuationExtra *
      attenuationExtra *
      extrapolate2(permutation, xsvExtra, ysvExtra, dxExtra, dyExtra);
  }
  return value / NORM_2D;
}

/** The property and method surface Godot 3 exposes to GDScript. */
export interface GodotOpenSimplexNoise {
  resource_name: string;
  seed: number;
  octaves: number;
  period: number;
  persistence: number;
  lacunarity: number;
  get_seed(): number;
  set_seed(value: number): void;
  get_octaves(): number;
  set_octaves(value: number): void;
  get_period(): number;
  set_period(value: number): void;
  get_persistence(): number;
  set_persistence(value: number): void;
  get_lacunarity(): number;
  set_lacunarity(value: number): void;
  getNoise1d(x: number): number;
  getNoise2d(x: number, y: number): number;
  getNoise3d(x: number, y: number, z: number): number;
  getNoise4d(x: number, y: number, z: number, w: number): number;
  get_noise_1d(x: number): number;
  get_noise_2d(x: number, y: number): number;
  get_noise_2dv(value: Vector2): number;
  get_noise_3d(x: number, y: number, z: number): number;
  get_noise_3dv(value: Vector3): number;
  get_noise_4d(x: number, y: number, z: number, w: number): number;
  get_image(width: number, height: number, offset?: Vector2): GodotImage;
  get_seamless_image(size: number): GodotImage;
}

class OpenSimplexNoise implements GodotOpenSimplexNoise {
  resource_name = '';
  #seed = 0;
  #octaves = 3;
  #period = 64;
  #persistence = 0.5;
  #lacunarity = 2;
  #permutations = Array.from({ length: MAX_OCTAVES }, (_, index) => makePermutation(index * 2));
  #noise3d: OpenSimplexNoise3D[] = this.#permutations.map(makeNoise3D);
  #noise4d: OpenSimplexNoise4D[] = this.#permutations.map(makeNoise4D);

  constructor() {
    registerGodotObjectIdentity(this, 'OpenSimplexNoise');
    bindGodotResourceProtocol<GodotOpenSimplexNoise>(this, {
      createDuplicate(source) {
        const duplicate = new OpenSimplexNoise();
        duplicate.seed = source.seed;
        duplicate.octaves = source.octaves;
        duplicate.period = source.period;
        duplicate.persistence = source.persistence;
        duplicate.lacunarity = source.lacunarity;
        return duplicate;
      },
    });
  }

  get seed(): number {
    return this.#seed;
  }

  set seed(value: number) {
    if (!Number.isFinite(value)) throw new TypeError('OpenSimplexNoise.seed requires a finite int.');
    const next = Number(BigInt.asIntN(32, BigInt(Math.trunc(value))));
    if (next === this.#seed) return;
    this.#seed = next;
    this.#permutations = Array.from({ length: MAX_OCTAVES }, (_, index) =>
      makePermutation(next + index * 2),
    );
    this.#noise3d = this.#permutations.map(makeNoise3D);
    this.#noise4d = this.#permutations.map(makeNoise4D);
    this.changed();
  }

  get octaves(): number {
    return this.#octaves;
  }

  set octaves(value: number) {
    if (!Number.isFinite(value)) throw new TypeError('OpenSimplexNoise.octaves requires a finite int.');
    const next = Math.trunc(value);
    if (next > MAX_OCTAVES) return;
    const clamped = Math.max(1, next);
    if (clamped === this.#octaves) return;
    this.#octaves = clamped;
    this.changed();
  }

  get period(): number {
    return this.#period;
  }

  set period(value: number) {
    if (!Number.isFinite(value)) throw new TypeError('OpenSimplexNoise.period requires a finite float.');
    if (value === this.#period) return;
    this.#period = value;
    this.changed();
  }

  get persistence(): number {
    return this.#persistence;
  }

  set persistence(value: number) {
    if (!Number.isFinite(value)) throw new TypeError('OpenSimplexNoise.persistence requires a finite float.');
    if (value === this.#persistence) return;
    this.#persistence = value;
    this.changed();
  }

  get lacunarity(): number {
    return this.#lacunarity;
  }

  set lacunarity(value: number) {
    if (!Number.isFinite(value)) throw new TypeError('OpenSimplexNoise.lacunarity requires a finite float.');
    if (value === this.#lacunarity) return;
    this.#lacunarity = value;
    this.changed();
  }

  private changed(): void {
    godotResourceEmitChanged(this);
  }

  get_seed(): number { return this.seed; }
  set_seed(value: number): void { this.seed = value; }
  get_octaves(): number { return this.octaves; }
  set_octaves(value: number): void { this.octaves = value; }
  get_period(): number { return this.period; }
  set_period(value: number): void { this.period = value; }
  get_persistence(): number { return this.persistence; }
  set_persistence(value: number): void { this.persistence = value; }
  get_lacunarity(): number { return this.lacunarity; }
  set_lacunarity(value: number): void { this.lacunarity = value; }

  getNoise1d(x: number): number {
    return this.getNoise2d(coordinate(x, 'get_noise_1d'), 1);
  }

  getNoise2d(x: number, y: number): number {
    x = coordinate(x, 'get_noise_2d');
    y = coordinate(y, 'get_noise_2d');
    let octaveX = x / this.#period;
    let octaveY = y / this.#period;
    let amplitude = 1;
    let maximum = 1;
    let sum = openSimplexNoise2(this.#permutations[0] as Int16Array, octaveX, octaveY);

    for (let index = 1; index < this.#octaves; index += 1) {
      octaveX *= this.#lacunarity;
      octaveY *= this.#lacunarity;
      amplitude *= this.#persistence;
      maximum += amplitude;
      sum += openSimplexNoise2(this.#permutations[index] as Int16Array, octaveX, octaveY) * amplitude;
    }
    return sum / maximum;
  }

  getNoise3d(x: number, y: number, z: number): number {
    x = coordinate(x, 'get_noise_3d');
    y = coordinate(y, 'get_noise_3d');
    z = coordinate(z, 'get_noise_3d');
    let octaveX = x / this.#period;
    let octaveY = y / this.#period;
    let octaveZ = z / this.#period;
    let amplitude = 1;
    let maximum = 1;
    let sum = this.#noise3d[0]!(octaveX, octaveY, octaveZ);
    for (let index = 1; index < this.#octaves; index += 1) {
      octaveX *= this.#lacunarity;
      octaveY *= this.#lacunarity;
      octaveZ *= this.#lacunarity;
      amplitude *= this.#persistence;
      maximum += amplitude;
      sum += this.#noise3d[index]!(octaveX, octaveY, octaveZ) * amplitude;
    }
    return sum / maximum;
  }

  getNoise4d(x: number, y: number, z: number, w: number): number {
    x = coordinate(x, 'get_noise_4d');
    y = coordinate(y, 'get_noise_4d');
    z = coordinate(z, 'get_noise_4d');
    w = coordinate(w, 'get_noise_4d');
    let octaveX = x / this.#period;
    let octaveY = y / this.#period;
    let octaveZ = z / this.#period;
    let octaveW = w / this.#period;
    let amplitude = 1;
    let maximum = 1;
    let sum = this.#noise4d[0]!(octaveX, octaveY, octaveZ, octaveW);
    for (let index = 1; index < this.#octaves; index += 1) {
      octaveX *= this.#lacunarity;
      octaveY *= this.#lacunarity;
      octaveZ *= this.#lacunarity;
      octaveW *= this.#lacunarity;
      amplitude *= this.#persistence;
      maximum += amplitude;
      sum += this.#noise4d[index]!(octaveX, octaveY, octaveZ, octaveW) * amplitude;
    }
    return sum / maximum;
  }

  get_noise_1d(x: number): number { return this.getNoise1d(x); }
  get_noise_2d(x: number, y: number): number { return this.getNoise2d(x, y); }
  get_noise_2dv(value: Vector2): number { return this.getNoise2d(value.x, value.y); }
  get_noise_3d(x: number, y: number, z: number): number { return this.getNoise3d(x, y, z); }
  get_noise_3dv(value: Vector3): number { return this.getNoise3d(value.x, value.y, value.z); }
  get_noise_4d(x: number, y: number, z: number, w: number): number { return this.getNoise4d(x, y, z, w); }

  get_image(widthValue: number, heightValue: number, offset: Vector2 = VECTOR2_ZERO): GodotImage {
    const width = imageDimension(widthValue, 'get_image width');
    const height = imageDimension(heightValue, 'get_image height');
    const offsetX = imageCoordinate(offset?.x, 'get_image offset.x');
    const offsetY = imageCoordinate(offset?.y, 'get_image offset.y');
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = this.get_noise_2d(x + offsetX, y + offsetY) * 0.5 + 0.5;
        data[x + y * width] = Math.trunc(Math.max(0, Math.min(255, value * 255)));
      }
    }
    return createGodotImage(width, height, false, IMAGE_FORMAT.FORMAT_L8, data);
  }

  get_seamless_image(sizeValue: number): GodotImage {
    const size = imageDimension(sizeValue, 'get_seamless_image size');
    const data = new Uint8Array(size * size);
    const radius = size / (2 * Math.PI);
    for (let y = 0; y < size; y += 1) {
      const verticalAngle = (y / size) * 2 * Math.PI;
      for (let x = 0; x < size; x += 1) {
        const horizontalAngle = (x / size) * 2 * Math.PI;
        const value = this.get_noise_4d(
          radius * Math.sin(horizontalAngle),
          radius * Math.cos(horizontalAngle),
          radius * Math.sin(verticalAngle),
          radius * Math.cos(verticalAngle),
        ) * 0.5 + 0.5;
        data[x + y * size] = Math.trunc(Math.max(0, Math.min(255, value * 255)));
      }
    }
    return createGodotImage(size, size, false, IMAGE_FORMAT.FORMAT_L8, data);
  }
}

function imageDimension(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`OpenSimplexNoise.${member} requires a positive integer.`);
  }
  return value;
}

function imageCoordinate(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`OpenSimplexNoise.${member} requires a finite float.`);
  }
  return value;
}

/** `OpenSimplexNoise.new()` — a fresh resource with Godot 3's defaults. */
export function createOpenSimplexNoise(): GodotOpenSimplexNoise {
  return new OpenSimplexNoise();
}
