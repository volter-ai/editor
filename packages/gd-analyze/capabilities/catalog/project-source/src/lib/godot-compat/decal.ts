/**
 * @godot-class Decal
 * @role BINDING
 *
 * Godot 4.7's `Decal` (`scene/3d/decal.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * its parameters stored and read back as the node stores them. It draws nothing, as in Godot's web
 * export: the web platform renders with the Compatibility renderer only
 * (`rendering/renderer/rendering_method.web`, `main/main.cpp:2644`), whose decal storage is empty
 * (`TextureStorage::decal_set_size` and every other decal setter, `drivers/gles3/storage/
 * texture_storage.cpp:2505`, do nothing, and its scene render reads no decal). A scene writes the
 * node as `<GodotDecal>`, a group its properties are set on.
 */

import type { ReactElement } from 'react';
import { Group } from 'three';
import { construct as color, type Color } from './color';
import { type GodotElementClass, type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;
/** `Decal::DecalTexture` (`decal.h:39`): albedo, normal, ORM, emission. */
const TEXTURE_MAX = 4;

interface Decal {
  size: Vector3;
  textures: unknown[];
  emission_energy: number;
  albedo_mix: number;
  modulate: Color;
  cull_mask: number;
  normal_fade: number;
  upper_fade: number;
  lower_fade: number;
  distance_fade_enabled: boolean;
  distance_fade_begin: number;
  distance_fade_length: number;
}

const STATE = new WeakMap<object, Decal>();

/** A decal's parameters at their initial values (`decal.h:49`). */
function stateOf(self: object): Decal {
  let state = STATE.get(self);
  if (state === undefined) {
    state = {
      size: vector3(2, 2, 2),
      textures: new Array<unknown>(TEXTURE_MAX).fill(null),
      emission_energy: 1,
      albedo_mix: 1,
      modulate: color(1, 1, 1, 1),
      cull_mask: (1 << 20) - 1,
      normal_fade: 0,
      upper_fade: f32(0.3),
      lower_fade: f32(0.3),
      distance_fade_enabled: false,
      distance_fade_begin: 40,
      distance_fade_length: 10,
    };
    STATE.set(self, state);
  }
  return state;
}

/**
 * Each component at least 0.001.
 *
 * @godot Decal.set_size
 * @source scene/3d/decal.cpp:37
 */
export function set_size(self: object, size: Vector3): void {
  stateOf(self).size = vector3(f32(Math.max(size.x, 0.001)), f32(Math.max(size.y, 0.001)), f32(Math.max(size.z, 0.001)));
}

/**
 * @godot Decal.get_size
 * @source scene/3d/decal.cpp:43
 */
export function get_size(self: object): Vector3 {
  return stateOf(self).size;
}

/**
 * @godot Decal.set_texture
 * @source scene/3d/decal.cpp:47
 */
export function set_texture(self: object, type: number, texture: unknown): void {
  if (type < 0 || type >= TEXTURE_MAX) return;
  stateOf(self).textures[type] = texture;
}

/**
 * @godot Decal.get_texture
 * @source scene/3d/decal.cpp:69
 */
export function get_texture(self: object, type: number): unknown {
  return type < 0 || type >= TEXTURE_MAX ? null : stateOf(self).textures[type];
}

/**
 * @godot Decal.set_emission_energy
 * @source scene/3d/decal.cpp:74
 */
export function set_emission_energy(self: object, value: number): void {
  stateOf(self).emission_energy = f32(value);
}

/**
 * @godot Decal.get_emission_energy
 * @source scene/3d/decal.cpp:79
 */
export function get_emission_energy(self: object): number {
  return stateOf(self).emission_energy;
}

/**
 * @godot Decal.set_albedo_mix
 * @source scene/3d/decal.cpp:83
 */
export function set_albedo_mix(self: object, value: number): void {
  stateOf(self).albedo_mix = f32(value);
}

/**
 * @godot Decal.get_albedo_mix
 * @source scene/3d/decal.cpp:88
 */
export function get_albedo_mix(self: object): number {
  return stateOf(self).albedo_mix;
}

/**
 * At least 0.
 *
 * @godot Decal.set_upper_fade
 * @source scene/3d/decal.cpp:92
 */
export function set_upper_fade(self: object, value: number): void {
  stateOf(self).upper_fade = f32(Math.max(value, 0));
}

/**
 * @godot Decal.get_upper_fade
 * @source scene/3d/decal.cpp:97
 */
export function get_upper_fade(self: object): number {
  return stateOf(self).upper_fade;
}

/**
 * At least 0.
 *
 * @godot Decal.set_lower_fade
 * @source scene/3d/decal.cpp:101
 */
export function set_lower_fade(self: object, value: number): void {
  stateOf(self).lower_fade = f32(Math.max(value, 0));
}

/**
 * @godot Decal.get_lower_fade
 * @source scene/3d/decal.cpp:106
 */
export function get_lower_fade(self: object): number {
  return stateOf(self).lower_fade;
}

/**
 * @godot Decal.set_normal_fade
 * @source scene/3d/decal.cpp:110
 */
export function set_normal_fade(self: object, value: number): void {
  stateOf(self).normal_fade = f32(value);
}

/**
 * @godot Decal.get_normal_fade
 * @source scene/3d/decal.cpp:115
 */
export function get_normal_fade(self: object): number {
  return stateOf(self).normal_fade;
}

/**
 * @godot Decal.set_modulate
 * @source scene/3d/decal.cpp:119
 */
export function set_modulate(self: object, value: Color): void {
  stateOf(self).modulate = value;
}

/**
 * @godot Decal.get_modulate
 * @source scene/3d/decal.cpp:124
 */
export function get_modulate(self: object): Color {
  return stateOf(self).modulate;
}

/**
 * @godot Decal.set_enable_distance_fade
 * @source scene/3d/decal.cpp:128
 */
export function set_enable_distance_fade(self: object, value: boolean): void {
  stateOf(self).distance_fade_enabled = value;
}

/**
 * @godot Decal.is_distance_fade_enabled
 * @source scene/3d/decal.cpp:134
 */
export function is_distance_fade_enabled(self: object): boolean {
  return stateOf(self).distance_fade_enabled;
}

/**
 * @godot Decal.set_distance_fade_begin
 * @source scene/3d/decal.cpp:138
 */
export function set_distance_fade_begin(self: object, value: number): void {
  stateOf(self).distance_fade_begin = f32(value);
}

/**
 * @godot Decal.get_distance_fade_begin
 * @source scene/3d/decal.cpp:143
 */
export function get_distance_fade_begin(self: object): number {
  return stateOf(self).distance_fade_begin;
}

/**
 * @godot Decal.set_distance_fade_length
 * @source scene/3d/decal.cpp:147
 */
export function set_distance_fade_length(self: object, value: number): void {
  stateOf(self).distance_fade_length = f32(value);
}

/**
 * @godot Decal.get_distance_fade_length
 * @source scene/3d/decal.cpp:152
 */
export function get_distance_fade_length(self: object): number {
  return stateOf(self).distance_fade_length;
}

/**
 * @godot Decal.set_cull_mask
 * @source scene/3d/decal.cpp:156
 */
export function set_cull_mask(self: object, value: number): void {
  stateOf(self).cull_mask = value >>> 0;
}

/**
 * @godot Decal.get_cull_mask
 * @source scene/3d/decal.cpp:162
 */
export function get_cull_mask(self: object): number {
  return stateOf(self).cull_mask;
}

/** The props a scene states on `<GodotDecal>`, by the setter each calls. */
const DECAL: GodotElementClass<Group> = {
  create: () => new Group(),
  classes: ['Decal', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: (entity) => void stateOf(entity),
  props: new Map<string, GodotElementProp<Group>>([
    ['size', (self, value: readonly [number, number, number]) => set_size(self, vector3(...value))],
    ['textureAlbedo', (self, value: unknown) => set_texture(self, 0, value)],
    ['textureNormal', (self, value: unknown) => set_texture(self, 1, value)],
    ['textureOrm', (self, value: unknown) => set_texture(self, 2, value)],
    ['textureEmission', (self, value: unknown) => set_texture(self, 3, value)],
    ['emissionEnergy', (self, value: number) => set_emission_energy(self, value)],
    ['modulate', (self, value: readonly [number, number, number, number]) => set_modulate(self, color(...value))],
    ['albedoMix', (self, value: number) => set_albedo_mix(self, value)],
    ['normalFade', (self, value: number) => set_normal_fade(self, value)],
    ['upperFade', (self, value: number) => set_upper_fade(self, value)],
    ['lowerFade', (self, value: number) => set_lower_fade(self, value)],
    ['distanceFadeEnabled', (self, value: boolean) => set_enable_distance_fade(self, value)],
    ['distanceFadeBegin', (self, value: number) => set_distance_fade_begin(self, value)],
    ['distanceFadeLength', (self, value: number) => set_distance_fade_length(self, value)],
    ['cullMask', (self, value: number) => set_cull_mask(self, value)],
  ]),
};

/**
 * A Decal as a scene writes it (`decal.cpp:202`: its properties): a group holding the node's
 * parameters, drawing nothing (the web export's Compatibility renderer draws no decal).
 *
 * @godot Decal (protocol)
 * @source scene/3d/decal.cpp:202
 */
export function GodotDecal(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(DECAL, props);
}
