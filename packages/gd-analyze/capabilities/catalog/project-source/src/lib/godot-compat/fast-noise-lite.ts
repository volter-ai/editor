/**
 * @godot-class FastNoiseLite
 * @role BINDING
 *
 * Godot 4.7's `FastNoiseLite` (`modules/noise/fastnoise_lite.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the `fastnoise-lite` package, the same
 * library's JavaScript port that Godot compiles in C++: each setting handed to the library as
 * Godot's setters hand it (Godot's enums are the library's, in order), a sample offset by `offset`
 * first (`FastNoiseLite::get_noise_2d`, `fastnoise_lite.cpp:318`). The port computes in doubles
 * where Godot's library computes in floats. Domain warp is not bound: the port warps only its own
 * vector class.
 */

/// <reference path="./fastnoise-lite.d.ts" />

import Library from 'fastnoise-lite';
import { godot_noise_changed, type Noise } from './noise';
import { construct as vector3, type Vector3 } from './vector3';

/** `NoiseType`, `FractalType`, `CellularDistanceFunction`, `CellularReturnType` (`fastnoise_lite.h:44`), as the library names them. */
const NOISE_TYPES = ['OpenSimplex2', 'OpenSimplex2S', 'Cellular', 'Perlin', 'ValueCubic', 'Value'] as const;
const FRACTAL_TYPES = ['None', 'FBm', 'Ridged', 'PingPong'] as const;
const DISTANCE_FUNCTIONS = ['Euclidean', 'EuclideanSq', 'Manhattan', 'Hybrid'] as const;
const RETURN_TYPES = ['CellValue', 'Distance', 'Distance2', 'Distance2Add', 'Distance2Sub', 'Distance2Mul', 'Distance2Div'] as const;

export interface FastNoiseLite extends Noise {
  readonly library: Library;
  noise_type: number;
  seed: number;
  frequency: number;
  offset: Vector3;
  fractal_type: number;
  fractal_octaves: number;
  fractal_lacunarity: number;
  fractal_gain: number;
  fractal_weighted_strength: number;
  fractal_ping_pong_strength: number;
  cellular_distance_function: number;
  cellular_jitter: number;
  cellular_return_type: number;
}

function named<const Names extends readonly string[]>(names: Names, value: number, what: string): Names[number] {
  const name = names[value];
  if (name === undefined) throw new RangeError(`godot-compat: FastNoiseLite has no ${what} ${String(value)}`);
  return name;
}

/**
 * Simplex smooth, seed 0, frequency 0.01, five FBM octaves (`fastnoise_lite.h:101`), handed to
 * the library as the constructor hands them.
 *
 * @godot FastNoiseLite.FastNoiseLite
 * @source modules/noise/fastnoise_lite.cpp:53
 */
export function construct(): FastNoiseLite {
  const library = new Library();
  const self: FastNoiseLite = {
    library,
    noise_type: 1,
    seed: 0,
    frequency: 0.01,
    offset: vector3(0, 0, 0),
    fractal_type: 1,
    fractal_octaves: 5,
    fractal_lacunarity: 2,
    fractal_gain: 0.5,
    fractal_weighted_strength: 0,
    fractal_ping_pong_strength: 2,
    cellular_distance_function: 0,
    cellular_jitter: 1,
    cellular_return_type: 1,
    listeners: new Set(),
    sample2d: (x, y) => library.GetNoise(x + self.offset.x, y + self.offset.y),
    sample3d: (x, y, z) => library.GetNoise(x + self.offset.x, y + self.offset.y, z + self.offset.z),
  };
  library.SetNoiseType(Library.NoiseType[named(NOISE_TYPES, self.noise_type, 'noise type')]);
  library.SetSeed(self.seed);
  library.SetFrequency(self.frequency);
  library.SetFractalType(Library.FractalType[named(FRACTAL_TYPES, self.fractal_type, 'fractal type')]);
  library.SetFractalOctaves(self.fractal_octaves);
  library.SetFractalLacunarity(self.fractal_lacunarity);
  library.SetFractalGain(self.fractal_gain);
  library.SetFractalWeightedStrength(self.fractal_weighted_strength);
  library.SetFractalPingPongStrength(self.fractal_ping_pong_strength);
  library.SetCellularDistanceFunction(Library.CellularDistanceFunction[named(DISTANCE_FUNCTIONS, self.cellular_distance_function, 'distance function')]);
  library.SetCellularReturnType(Library.CellularReturnType[named(RETURN_TYPES, self.cellular_return_type, 'return type')]);
  library.SetCellularJitter(self.cellular_jitter);
  return self;
}

/**
 * @godot FastNoiseLite.set_noise_type
 * @source modules/noise/fastnoise_lite.cpp:84
 */
export function set_noise_type(self: FastNoiseLite, type: number): void {
  self.library.SetNoiseType(Library.NoiseType[named(NOISE_TYPES, type, 'noise type')]);
  self.noise_type = type;
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_noise_type
 * @source modules/noise/fastnoise_lite.cpp:91
 */
export function get_noise_type(self: FastNoiseLite): number {
  return self.noise_type;
}

/**
 * @godot FastNoiseLite.set_seed
 * @source modules/noise/fastnoise_lite.cpp:95
 */
export function set_seed(self: FastNoiseLite, seed: number): void {
  self.seed = seed;
  self.library.SetSeed(seed);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_seed
 * @source modules/noise/fastnoise_lite.cpp:102
 */
export function get_seed(self: FastNoiseLite): number {
  return self.seed;
}

/**
 * @godot FastNoiseLite.set_frequency
 * @source modules/noise/fastnoise_lite.cpp:106
 */
export function set_frequency(self: FastNoiseLite, freq: number): void {
  self.frequency = freq;
  self.library.SetFrequency(freq);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_frequency
 * @source modules/noise/fastnoise_lite.cpp:112
 */
export function get_frequency(self: FastNoiseLite): number {
  return self.frequency;
}

/**
 * @godot FastNoiseLite.set_offset
 * @source modules/noise/fastnoise_lite.cpp:116
 */
export function set_offset(self: FastNoiseLite, offset: Vector3): void {
  self.offset = vector3(offset.x, offset.y, offset.z);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_offset
 * @source modules/noise/fastnoise_lite.cpp:121
 */
export function get_offset(self: FastNoiseLite): Vector3 {
  return self.offset;
}

/**
 * @godot FastNoiseLite.set_fractal_type
 * @source modules/noise/fastnoise_lite.cpp:127
 */
export function set_fractal_type(self: FastNoiseLite, type: number): void {
  self.library.SetFractalType(Library.FractalType[named(FRACTAL_TYPES, type, 'fractal type')]);
  self.fractal_type = type;
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_fractal_type
 * @source modules/noise/fastnoise_lite.cpp:134
 */
export function get_fractal_type(self: FastNoiseLite): number {
  return self.fractal_type;
}

/**
 * @godot FastNoiseLite.set_fractal_octaves
 * @source modules/noise/fastnoise_lite.cpp:138
 */
export function set_fractal_octaves(self: FastNoiseLite, octave_count: number): void {
  self.fractal_octaves = octave_count;
  self.library.SetFractalOctaves(octave_count);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_fractal_octaves
 * @source modules/noise/fastnoise_lite.cpp:144
 */
export function get_fractal_octaves(self: FastNoiseLite): number {
  return self.fractal_octaves;
}

/**
 * @godot FastNoiseLite.set_fractal_lacunarity
 * @source modules/noise/fastnoise_lite.cpp:148
 */
export function set_fractal_lacunarity(self: FastNoiseLite, lacunarity: number): void {
  self.fractal_lacunarity = lacunarity;
  self.library.SetFractalLacunarity(lacunarity);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_fractal_lacunarity
 * @source modules/noise/fastnoise_lite.cpp:154
 */
export function get_fractal_lacunarity(self: FastNoiseLite): number {
  return self.fractal_lacunarity;
}

/**
 * @godot FastNoiseLite.set_fractal_gain
 * @source modules/noise/fastnoise_lite.cpp:158
 */
export function set_fractal_gain(self: FastNoiseLite, gain: number): void {
  self.fractal_gain = gain;
  self.library.SetFractalGain(gain);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_fractal_gain
 * @source modules/noise/fastnoise_lite.cpp:164
 */
export function get_fractal_gain(self: FastNoiseLite): number {
  return self.fractal_gain;
}

/**
 * @godot FastNoiseLite.set_fractal_weighted_strength
 * @source modules/noise/fastnoise_lite.cpp:168
 */
export function set_fractal_weighted_strength(self: FastNoiseLite, weighted_strength: number): void {
  self.fractal_weighted_strength = weighted_strength;
  self.library.SetFractalWeightedStrength(weighted_strength);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_fractal_weighted_strength
 * @source modules/noise/fastnoise_lite.cpp:173
 */
export function get_fractal_weighted_strength(self: FastNoiseLite): number {
  return self.fractal_weighted_strength;
}

/**
 * @godot FastNoiseLite.set_fractal_ping_pong_strength
 * @source modules/noise/fastnoise_lite.cpp:177
 */
export function set_fractal_ping_pong_strength(self: FastNoiseLite, ping_pong_strength: number): void {
  self.fractal_ping_pong_strength = ping_pong_strength;
  self.library.SetFractalPingPongStrength(ping_pong_strength);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_fractal_ping_pong_strength
 * @source modules/noise/fastnoise_lite.cpp:182
 */
export function get_fractal_ping_pong_strength(self: FastNoiseLite): number {
  return self.fractal_ping_pong_strength;
}

/**
 * @godot FastNoiseLite.set_cellular_distance_function
 * @source modules/noise/fastnoise_lite.cpp:188
 */
export function set_cellular_distance_function(self: FastNoiseLite, func: number): void {
  self.library.SetCellularDistanceFunction(Library.CellularDistanceFunction[named(DISTANCE_FUNCTIONS, func, 'distance function')]);
  self.cellular_distance_function = func;
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_cellular_distance_function
 * @source modules/noise/fastnoise_lite.cpp:194
 */
export function get_cellular_distance_function(self: FastNoiseLite): number {
  return self.cellular_distance_function;
}

/**
 * @godot FastNoiseLite.set_cellular_jitter
 * @source modules/noise/fastnoise_lite.cpp:198
 */
export function set_cellular_jitter(self: FastNoiseLite, jitter: number): void {
  self.cellular_jitter = jitter;
  self.library.SetCellularJitter(jitter);
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_cellular_jitter
 * @source modules/noise/fastnoise_lite.cpp:204
 */
export function get_cellular_jitter(self: FastNoiseLite): number {
  return self.cellular_jitter;
}

/**
 * @godot FastNoiseLite.set_cellular_return_type
 * @source modules/noise/fastnoise_lite.cpp:208
 */
export function set_cellular_return_type(self: FastNoiseLite, ret: number): void {
  self.library.SetCellularReturnType(Library.CellularReturnType[named(RETURN_TYPES, ret, 'return type')]);
  self.cellular_return_type = ret;
  godot_noise_changed(self);
}

/**
 * @godot FastNoiseLite.get_cellular_return_type
 * @source modules/noise/fastnoise_lite.cpp:214
 */
export function get_cellular_return_type(self: FastNoiseLite): number {
  return self.cellular_return_type;
}

const SETTERS: Readonly<Record<string, (self: FastNoiseLite, value: never) => void>> = {
  noiseType: set_noise_type,
  seed: set_seed,
  frequency: set_frequency,
  offset: (self, value: readonly [number, number, number]) => set_offset(self, vector3(...value)),
  fractalType: set_fractal_type,
  fractalOctaves: set_fractal_octaves,
  fractalLacunarity: set_fractal_lacunarity,
  fractalGain: set_fractal_gain,
  fractalWeightedStrength: set_fractal_weighted_strength,
  fractalPingPongStrength: set_fractal_ping_pong_strength,
  cellularDistanceFunction: set_cellular_distance_function,
  cellularJitter: set_cellular_jitter,
  cellularReturnType: set_cellular_return_type,
};

/**
 * A FastNoiseLite of the properties a scene states; an unknown one fails by name.
 *
 * @godot FastNoiseLite (protocol)
 * @source modules/noise/fastnoise_lite.cpp:53
 */
export function godot_fast_noise_lite_new(properties: Readonly<Record<string, unknown>> = {}): FastNoiseLite {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    const setter = SETTERS[property];
    if (setter === undefined) throw new Error(`godot-compat: FastNoiseLite has no ${property} property.`);
    setter(self, value as never);
  }
  return self;
}
