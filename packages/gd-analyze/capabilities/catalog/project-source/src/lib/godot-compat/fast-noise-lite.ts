/** Godot 4.7 Noise/FastNoiseLite over the pinned upstream FastNoiseLite 1.1 scalar core. */

import FastNoiseLiteCore from './fast-noise-lite-core';
import type { GodotImage } from './image';
import { generateGodotNoiseImages, generateGodotSeamlessNoiseImages } from './noise-image';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourcePath, godotResourceEmitChanged } from './resource-io';
import type { Vector2 } from './vector2';
import { type Vector3, vec3 } from './variant-3d';

export const FAST_NOISE_TYPE_SIMPLEX = 0;
export const FAST_NOISE_TYPE_SIMPLEX_SMOOTH = 1;
export const FAST_NOISE_TYPE_CELLULAR = 2;
export const FAST_NOISE_TYPE_PERLIN = 3;
export const FAST_NOISE_TYPE_VALUE_CUBIC = 4;
export const FAST_NOISE_TYPE_VALUE = 5;

export const FAST_NOISE_FRACTAL_NONE = 0;
export const FAST_NOISE_FRACTAL_FBM = 1;
export const FAST_NOISE_FRACTAL_RIDGED = 2;
export const FAST_NOISE_FRACTAL_PING_PONG = 3;

export const FAST_NOISE_DISTANCE_EUCLIDEAN = 0;
export const FAST_NOISE_DISTANCE_EUCLIDEAN_SQUARED = 1;
export const FAST_NOISE_DISTANCE_MANHATTAN = 2;
export const FAST_NOISE_DISTANCE_HYBRID = 3;

export const FAST_NOISE_RETURN_CELL_VALUE = 0;
export const FAST_NOISE_RETURN_DISTANCE = 1;
export const FAST_NOISE_RETURN_DISTANCE2 = 2;
export const FAST_NOISE_RETURN_DISTANCE2_ADD = 3;
export const FAST_NOISE_RETURN_DISTANCE2_SUB = 4;
export const FAST_NOISE_RETURN_DISTANCE2_MUL = 5;
export const FAST_NOISE_RETURN_DISTANCE2_DIV = 6;

export const FAST_NOISE_DOMAIN_WARP_SIMPLEX = 0;
export const FAST_NOISE_DOMAIN_WARP_SIMPLEX_REDUCED = 1;
export const FAST_NOISE_DOMAIN_WARP_BASIC_GRID = 2;
export const FAST_NOISE_DOMAIN_WARP_FRACTAL_NONE = 0;
export const FAST_NOISE_DOMAIN_WARP_FRACTAL_PROGRESSIVE = 1;
export const FAST_NOISE_DOMAIN_WARP_FRACTAL_INDEPENDENT = 2;

const NOISE_TYPES = [
  FastNoiseLiteCore.NoiseType.OpenSimplex2,
  FastNoiseLiteCore.NoiseType.OpenSimplex2S,
  FastNoiseLiteCore.NoiseType.Cellular,
  FastNoiseLiteCore.NoiseType.Perlin,
  FastNoiseLiteCore.NoiseType.ValueCubic,
  FastNoiseLiteCore.NoiseType.Value,
] as const;
const FRACTAL_TYPES = [
  FastNoiseLiteCore.FractalType.None,
  FastNoiseLiteCore.FractalType.FBm,
  FastNoiseLiteCore.FractalType.Ridged,
  FastNoiseLiteCore.FractalType.PingPong,
] as const;
const DISTANCE_TYPES = [
  FastNoiseLiteCore.CellularDistanceFunction.Euclidean,
  FastNoiseLiteCore.CellularDistanceFunction.EuclideanSq,
  FastNoiseLiteCore.CellularDistanceFunction.Manhattan,
  FastNoiseLiteCore.CellularDistanceFunction.Hybrid,
] as const;
const RETURN_TYPES = [
  FastNoiseLiteCore.CellularReturnType.CellValue,
  FastNoiseLiteCore.CellularReturnType.Distance,
  FastNoiseLiteCore.CellularReturnType.Distance2,
  FastNoiseLiteCore.CellularReturnType.Distance2Add,
  FastNoiseLiteCore.CellularReturnType.Distance2Sub,
  FastNoiseLiteCore.CellularReturnType.Distance2Mul,
  FastNoiseLiteCore.CellularReturnType.Distance2Div,
] as const;
const WARP_TYPES = [
  FastNoiseLiteCore.DomainWarpType.OpenSimplex2,
  FastNoiseLiteCore.DomainWarpType.OpenSimplex2Reduced,
  FastNoiseLiteCore.DomainWarpType.BasicGrid,
] as const;
const WARP_FRACTALS = [
  FastNoiseLiteCore.FractalType.None,
  FastNoiseLiteCore.FractalType.DomainWarpProgressive,
  FastNoiseLiteCore.FractalType.DomainWarpIndependent,
] as const;

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`FastNoiseLite.${member} requires a finite float.`);
  }
  return value;
}

function int32(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new TypeError(`FastNoiseLite.${member} requires an int.`);
  }
  return value | 0;
}

function enumValue<T>(values: readonly T[], value: unknown, member: string): T {
  const index = int32(value, member);
  const mapped = values[index];
  if (mapped === undefined) throw new RangeError(`FastNoiseLite.${member} received invalid enum value ${index}.`);
  return mapped;
}

function vector3(value: unknown, member: string): Vector3 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`FastNoiseLite.${member} requires Vector3.`);
  const source = value as Partial<Vector3>;
  return vec3(finite(source.x, member), finite(source.y, member), finite(source.z, member));
}

export class GodotFastNoiseLite {
  resource_name = '';
  private readonly noise = new FastNoiseLiteCore();
  private readonly warp = new FastNoiseLiteCore();
  private noiseTypeValue = FAST_NOISE_TYPE_SIMPLEX_SMOOTH;
  private seedValue = 0;
  private frequencyValue = 0.01;
  private offsetValue = vec3(0, 0, 0);
  private fractalTypeValue = FAST_NOISE_FRACTAL_FBM;
  private fractalOctavesValue = 5;
  private fractalLacunarityValue = 2;
  private fractalGainValue = 0.5;
  private fractalWeightedStrengthValue = 0;
  private fractalPingPongStrengthValue = 2;
  private cellularDistanceFunctionValue = FAST_NOISE_DISTANCE_EUCLIDEAN;
  private cellularReturnTypeValue = FAST_NOISE_RETURN_DISTANCE;
  private cellularJitterValue = 1;
  private domainWarpEnabledValue = false;
  private domainWarpTypeValue = FAST_NOISE_DOMAIN_WARP_SIMPLEX;
  private domainWarpAmplitudeValue = 30;
  private domainWarpFrequencyValue = 0.05;
  private domainWarpFractalTypeValue = FAST_NOISE_DOMAIN_WARP_FRACTAL_PROGRESSIVE;
  private domainWarpFractalOctavesValue = 5;
  private domainWarpFractalLacunarityValue = 6;
  private domainWarpFractalGainValue = 0.5;

  constructor() {
    registerGodotObjectIdentity(this, 'FastNoiseLite');
    bindGodotResourcePath(this, '');
    this.syncNoise();
    this.syncWarp();
  }

  private changed(): void { godotResourceEmitChanged(this); }

  private syncNoise(): void {
    this.noise.SetNoiseType(NOISE_TYPES[this.noiseTypeValue]!);
    this.noise.SetSeed(this.seedValue);
    this.noise.SetFrequency(this.frequencyValue);
    this.noise.SetFractalType(FRACTAL_TYPES[this.fractalTypeValue]!);
    this.noise.SetFractalOctaves(this.fractalOctavesValue);
    this.noise.SetFractalLacunarity(this.fractalLacunarityValue);
    this.noise.SetFractalGain(this.fractalGainValue);
    this.noise.SetFractalWeightedStrength(this.fractalWeightedStrengthValue);
    this.noise.SetFractalPingPongStrength(this.fractalPingPongStrengthValue);
    this.noise.SetCellularDistanceFunction(DISTANCE_TYPES[this.cellularDistanceFunctionValue]!);
    this.noise.SetCellularReturnType(RETURN_TYPES[this.cellularReturnTypeValue]!);
    this.noise.SetCellularJitter(this.cellularJitterValue);
  }

  private syncWarp(): void {
    this.warp.SetDomainWarpType(WARP_TYPES[this.domainWarpTypeValue]!);
    this.warp.SetSeed(this.seedValue);
    this.warp.SetDomainWarpAmp(this.domainWarpAmplitudeValue);
    this.warp.SetFrequency(this.domainWarpFrequencyValue);
    this.warp.SetFractalType(WARP_FRACTALS[this.domainWarpFractalTypeValue]!);
    this.warp.SetFractalOctaves(this.domainWarpFractalOctavesValue);
    this.warp.SetFractalLacunarity(this.domainWarpFractalLacunarityValue);
    this.warp.SetFractalGain(this.domainWarpFractalGainValue);
  }

  get noise_type(): number { return this.noiseTypeValue; }
  set noise_type(value: number) { this.set_noise_type(value); }
  set_noise_type(value: number): void {
    enumValue(NOISE_TYPES, value, 'noise_type');
    this.noiseTypeValue = value;
    this.noise.SetNoiseType(NOISE_TYPES[value]!);
    this.changed();
  }
  get_noise_type(): number { return this.noiseTypeValue; }

  get seed(): number { return this.seedValue; }
  set seed(value: number) { this.set_seed(value); }
  set_seed(value: number): void {
    this.seedValue = int32(value, 'seed');
    this.noise.SetSeed(this.seedValue);
    this.warp.SetSeed(this.seedValue);
    this.changed();
  }
  get_seed(): number { return this.seedValue; }

  get frequency(): number { return this.frequencyValue; }
  set frequency(value: number) { this.set_frequency(value); }
  set_frequency(value: number): void {
    this.frequencyValue = finite(value, 'frequency');
    this.noise.SetFrequency(this.frequencyValue);
    this.changed();
  }
  get_frequency(): number { return this.frequencyValue; }

  get offset(): Vector3 { return this.offsetValue; }
  set offset(value: Vector3) { this.set_offset(value); }
  set_offset(value: Vector3): void { this.offsetValue = vector3(value, 'offset'); this.changed(); }
  get_offset(): Vector3 { return this.offsetValue; }

  get fractal_type(): number { return this.fractalTypeValue; }
  set fractal_type(value: number) { this.set_fractal_type(value); }
  set_fractal_type(value: number): void {
    enumValue(FRACTAL_TYPES, value, 'fractal_type');
    this.fractalTypeValue = value;
    this.noise.SetFractalType(FRACTAL_TYPES[value]!);
    this.changed();
  }
  get_fractal_type(): number { return this.fractalTypeValue; }

  get fractal_octaves(): number { return this.fractalOctavesValue; }
  set fractal_octaves(value: number) { this.set_fractal_octaves(value); }
  set_fractal_octaves(value: number): void {
    this.fractalOctavesValue = int32(value, 'fractal_octaves');
    this.noise.SetFractalOctaves(this.fractalOctavesValue);
    this.changed();
  }
  get_fractal_octaves(): number { return this.fractalOctavesValue; }

  get fractal_lacunarity(): number { return this.fractalLacunarityValue; }
  set fractal_lacunarity(value: number) { this.set_fractal_lacunarity(value); }
  set_fractal_lacunarity(value: number): void {
    this.fractalLacunarityValue = finite(value, 'fractal_lacunarity');
    this.noise.SetFractalLacunarity(this.fractalLacunarityValue);
    this.changed();
  }
  get_fractal_lacunarity(): number { return this.fractalLacunarityValue; }

  get fractal_gain(): number { return this.fractalGainValue; }
  set fractal_gain(value: number) { this.set_fractal_gain(value); }
  set_fractal_gain(value: number): void {
    this.fractalGainValue = finite(value, 'fractal_gain');
    this.noise.SetFractalGain(this.fractalGainValue);
    this.changed();
  }
  get_fractal_gain(): number { return this.fractalGainValue; }

  get fractal_weighted_strength(): number { return this.fractalWeightedStrengthValue; }
  set fractal_weighted_strength(value: number) { this.set_fractal_weighted_strength(value); }
  set_fractal_weighted_strength(value: number): void {
    this.fractalWeightedStrengthValue = finite(value, 'fractal_weighted_strength');
    this.noise.SetFractalWeightedStrength(this.fractalWeightedStrengthValue);
    this.changed();
  }
  get_fractal_weighted_strength(): number { return this.fractalWeightedStrengthValue; }

  get fractal_ping_pong_strength(): number { return this.fractalPingPongStrengthValue; }
  set fractal_ping_pong_strength(value: number) { this.set_fractal_ping_pong_strength(value); }
  set_fractal_ping_pong_strength(value: number): void {
    this.fractalPingPongStrengthValue = finite(value, 'fractal_ping_pong_strength');
    this.noise.SetFractalPingPongStrength(this.fractalPingPongStrengthValue);
    this.changed();
  }
  get_fractal_ping_pong_strength(): number { return this.fractalPingPongStrengthValue; }

  get cellular_distance_function(): number { return this.cellularDistanceFunctionValue; }
  set cellular_distance_function(value: number) { this.set_cellular_distance_function(value); }
  set_cellular_distance_function(value: number): void {
    enumValue(DISTANCE_TYPES, value, 'cellular_distance_function');
    this.cellularDistanceFunctionValue = value;
    this.noise.SetCellularDistanceFunction(DISTANCE_TYPES[value]!);
    this.changed();
  }
  get_cellular_distance_function(): number { return this.cellularDistanceFunctionValue; }

  get cellular_return_type(): number { return this.cellularReturnTypeValue; }
  set cellular_return_type(value: number) { this.set_cellular_return_type(value); }
  set_cellular_return_type(value: number): void {
    enumValue(RETURN_TYPES, value, 'cellular_return_type');
    this.cellularReturnTypeValue = value;
    this.noise.SetCellularReturnType(RETURN_TYPES[value]!);
    this.changed();
  }
  get_cellular_return_type(): number { return this.cellularReturnTypeValue; }

  get cellular_jitter(): number { return this.cellularJitterValue; }
  set cellular_jitter(value: number) { this.set_cellular_jitter(value); }
  set_cellular_jitter(value: number): void {
    this.cellularJitterValue = finite(value, 'cellular_jitter');
    this.noise.SetCellularJitter(this.cellularJitterValue);
    this.changed();
  }
  get_cellular_jitter(): number { return this.cellularJitterValue; }

  get domain_warp_enabled(): boolean { return this.domainWarpEnabledValue; }
  set domain_warp_enabled(value: boolean) { this.set_domain_warp_enabled(value); }
  set_domain_warp_enabled(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('FastNoiseLite.domain_warp_enabled requires bool.');
    if (value === this.domainWarpEnabledValue) return;
    this.domainWarpEnabledValue = value;
    this.changed();
  }
  is_domain_warp_enabled(): boolean { return this.domainWarpEnabledValue; }

  get domain_warp_type(): number { return this.domainWarpTypeValue; }
  set domain_warp_type(value: number) { this.set_domain_warp_type(value); }
  set_domain_warp_type(value: number): void {
    enumValue(WARP_TYPES, value, 'domain_warp_type');
    this.domainWarpTypeValue = value;
    this.warp.SetDomainWarpType(WARP_TYPES[value]!);
    this.changed();
  }
  get_domain_warp_type(): number { return this.domainWarpTypeValue; }

  get domain_warp_amplitude(): number { return this.domainWarpAmplitudeValue; }
  set domain_warp_amplitude(value: number) { this.set_domain_warp_amplitude(value); }
  set_domain_warp_amplitude(value: number): void {
    this.domainWarpAmplitudeValue = finite(value, 'domain_warp_amplitude');
    this.warp.SetDomainWarpAmp(this.domainWarpAmplitudeValue);
    this.changed();
  }
  get_domain_warp_amplitude(): number { return this.domainWarpAmplitudeValue; }

  get domain_warp_frequency(): number { return this.domainWarpFrequencyValue; }
  set domain_warp_frequency(value: number) { this.set_domain_warp_frequency(value); }
  set_domain_warp_frequency(value: number): void {
    this.domainWarpFrequencyValue = finite(value, 'domain_warp_frequency');
    this.warp.SetFrequency(this.domainWarpFrequencyValue);
    this.changed();
  }
  get_domain_warp_frequency(): number { return this.domainWarpFrequencyValue; }

  get domain_warp_fractal_type(): number { return this.domainWarpFractalTypeValue; }
  set domain_warp_fractal_type(value: number) { this.set_domain_warp_fractal_type(value); }
  set_domain_warp_fractal_type(value: number): void {
    enumValue(WARP_FRACTALS, value, 'domain_warp_fractal_type');
    this.domainWarpFractalTypeValue = value;
    this.warp.SetFractalType(WARP_FRACTALS[value]!);
    this.changed();
  }
  get_domain_warp_fractal_type(): number { return this.domainWarpFractalTypeValue; }

  get domain_warp_fractal_octaves(): number { return this.domainWarpFractalOctavesValue; }
  set domain_warp_fractal_octaves(value: number) { this.set_domain_warp_fractal_octaves(value); }
  set_domain_warp_fractal_octaves(value: number): void {
    this.domainWarpFractalOctavesValue = int32(value, 'domain_warp_fractal_octaves');
    this.warp.SetFractalOctaves(this.domainWarpFractalOctavesValue);
    this.changed();
  }
  get_domain_warp_fractal_octaves(): number { return this.domainWarpFractalOctavesValue; }

  get domain_warp_fractal_lacunarity(): number { return this.domainWarpFractalLacunarityValue; }
  set domain_warp_fractal_lacunarity(value: number) { this.set_domain_warp_fractal_lacunarity(value); }
  set_domain_warp_fractal_lacunarity(value: number): void {
    this.domainWarpFractalLacunarityValue = finite(value, 'domain_warp_fractal_lacunarity');
    this.warp.SetFractalLacunarity(this.domainWarpFractalLacunarityValue);
    this.changed();
  }
  get_domain_warp_fractal_lacunarity(): number { return this.domainWarpFractalLacunarityValue; }

  get domain_warp_fractal_gain(): number { return this.domainWarpFractalGainValue; }
  set domain_warp_fractal_gain(value: number) { this.set_domain_warp_fractal_gain(value); }
  set_domain_warp_fractal_gain(value: number): void {
    this.domainWarpFractalGainValue = finite(value, 'domain_warp_fractal_gain');
    this.warp.SetFractalGain(this.domainWarpFractalGainValue);
    this.changed();
  }
  get_domain_warp_fractal_gain(): number { return this.domainWarpFractalGainValue; }

  _changed(): void { this.changed(); }

  get_noise_1d(x: number): number {
    // Godot's 1D surface is its 2D kernel at y=0. The shared call owns offset and domain warp
    // exactly once; applying either here too double-transforms x.
    return this.get_noise_2d(finite(x, 'get_noise_1d'), 0);
  }

  get_noise_2dv(value: Vector2): number { return this.get_noise_2d(value.x, value.y); }
  get_noise_2d(x: number, y: number): number {
    const point = {
      x: finite(x, 'get_noise_2d') + this.offsetValue.x,
      y: finite(y, 'get_noise_2d') + this.offsetValue.y,
    };
    if (this.domainWarpEnabledValue) this.warp.DomainWrap(point);
    return this.noise.GetNoise(point.x, point.y);
  }

  get_noise_3dv(value: Vector3): number { return this.get_noise_3d(value.x, value.y, value.z); }
  get_noise_3d(x: number, y: number, z: number): number {
    const point = {
      x: finite(x, 'get_noise_3d') + this.offsetValue.x,
      y: finite(y, 'get_noise_3d') + this.offsetValue.y,
      z: finite(z, 'get_noise_3d') + this.offsetValue.z,
    };
    if (this.domainWarpEnabledValue) this.warp.DomainWrap(point);
    return this.noise.GetNoise(point.x, point.y, point.z);
  }

  get_image(
    width: number,
    height: number,
    invert = false,
    in3dSpace = false,
    normalize = true,
  ): GodotImage {
    return generateGodotNoiseImages(this, width, height, 1, invert, in3dSpace, normalize)[0]!;
  }

  get_image_3d(
    width: number,
    height: number,
    depth: number,
    invert = false,
    normalize = true,
  ): GodotImage[] {
    return generateGodotNoiseImages(this, width, height, depth, invert, true, normalize, 'get_image_3d');
  }

  get_seamless_image(
    width: number,
    height: number,
    invert = false,
    in3dSpace = false,
    skirt = 0.1,
    normalize = true,
  ): GodotImage {
    return generateGodotSeamlessNoiseImages(
      this,
      width,
      height,
      1,
      invert,
      in3dSpace,
      skirt,
      normalize,
    )[0]!;
  }

  get_seamless_image_3d(
    width: number,
    height: number,
    depth: number,
    invert = false,
    skirt = 0.1,
    normalize = true,
  ): GodotImage[] {
    return generateGodotSeamlessNoiseImages(
      this,
      width,
      height,
      depth,
      invert,
      true,
      skirt,
      normalize,
      'get_seamless_image_3d',
    );
  }
}

export function createGodotFastNoiseLite(): GodotFastNoiseLite { return new GodotFastNoiseLite(); }
