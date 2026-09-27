/**
 * @godot-class ReflectionProbe
 * @role BINDING
 *
 * Godot 4.7's `ReflectionProbe` (`scene/3d/reflection_probe.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the game editor's `reflections` capability,
 * whose `<ReflectionProbe>` captures the scene with three's `CubeCamera` and prefilters it: a scene
 * writes the node as that element with the props `godot_reflection_probe_props` maps its properties
 * to, the Godot values themselves in its `userData`. The mapping is the Compatibility renderer's
 * capture (`RendererSceneCull::_render_reflection_probe_step`, `renderer_scene_cull.cpp:3814`):
 * the box is the probe's `size`, the capture point its `origin_offset`, the near plane 0.01 and the
 * far plane the largest of `max_distance` and the distances from the capture point to the box's
 * faces; box projection projects onto the same box; `UPDATE_ONCE` captures on a change,
 * `UPDATE_ALWAYS` every frame. Named deviations:
 * - `reflection-probe-receivers`: Godot draws every geometry inside the box with the probe's
 *   reflection (at most two probes each, `rasterizer_scene_gles3.cpp:1406`); the capability publishes
 *   the capture and binds no material, so the imported scene's materials do not reflect it.
 * - `reflection-probe-far`: Godot's faces are captured in turn with the far plane grown to each
 *   face's distance so far; the capability captures every face with the largest.
 * - `reflection-probe-ambient`: the probe's ambient (interior, ambient mode and colour) is not drawn.
 */

import type { Object3D } from 'three';
import { godot_node_class_reader } from './node';
import { construct as color, type Color } from './color';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;

/** A probe's parameters (`reflection_probe.h:50`). */
interface ReflectionProbe {
  intensity: number;
  blend_distance: number;
  max_distance: number;
  size: Vector3;
  origin_offset: Vector3;
  box_projection: boolean;
  enable_shadows: boolean;
  interior: boolean;
  ambient_mode: number;
  ambient_color: Color;
  ambient_color_energy: number;
  mesh_lod_threshold: number;
  cull_mask: number;
  reflection_mask: number;
  update_mode: number;
}

/** The capability's live mark, which its element keeps in `userData.reflectionProbe`. */
interface ProbeMark {
  readonly config: Readonly<Record<string, unknown>>;
  updateConfig(config: Readonly<Record<string, unknown>>): void;
}

const STATE = new WeakMap<object, ReflectionProbe>();

/** The Godot values a scene states by name, over the probe's initial ones (`reflection_probe.h:50`). */
function initial(authored: Readonly<Record<string, unknown>>): ReflectionProbe {
  const v = (value: unknown, fallback: Vector3): Vector3 => (Array.isArray(value) ? vector3(value[0] as number, value[1] as number, value[2] as number) : fallback);
  const n = (value: unknown, fallback: number): number => (typeof value === 'number' ? f32(value) : fallback);
  const b = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  return {
    intensity: n(authored['intensity'], 1),
    blend_distance: n(authored['blend_distance'], 1),
    max_distance: n(authored['max_distance'], 0),
    size: v(authored['size'], vector3(20, 20, 20)),
    origin_offset: v(authored['origin_offset'], vector3(0, 0, 0)),
    box_projection: b(authored['box_projection'], false),
    enable_shadows: b(authored['enable_shadows'], false),
    interior: b(authored['interior'], false),
    ambient_mode: typeof authored['ambient_mode'] === 'number' ? authored['ambient_mode'] : 1,
    ambient_color: Array.isArray(authored['ambient_color']) ? color(...(authored['ambient_color'] as [number, number, number])) : color(0, 0, 0),
    ambient_color_energy: n(authored['ambient_color_energy'], 1),
    mesh_lod_threshold: n(authored['mesh_lod_threshold'], 1),
    cull_mask: typeof authored['cull_mask'] === 'number' ? authored['cull_mask'] : (1 << 20) - 1,
    reflection_mask: typeof authored['reflection_mask'] === 'number' ? authored['reflection_mask'] : (1 << 20) - 1,
    update_mode: typeof authored['update_mode'] === 'number' ? authored['update_mode'] : 0,
  };
}

function stateOf(self: object): ReflectionProbe {
  let state = STATE.get(self);
  if (state === undefined) {
    const data = (self as Object3D).userData as Readonly<Record<string, unknown>> | undefined;
    state = initial((data?.['godot'] as Readonly<Record<string, unknown>> | undefined) ?? {});
    clampOffset(state);
    STATE.set(self, state);
  }
  return state;
}

/**
 * The capability's props for a probe's parameters (`renderer_scene_cull.cpp:3814`), with the Godot
 * values in `userData.godot`.
 */
function config(state: ReflectionProbe): Readonly<Record<string, unknown>> {
  const size = [state.size.x, state.size.y, state.size.z];
  const offset = [state.origin_offset.x, state.origin_offset.y, state.origin_offset.z];
  // Each face's distance from the capture point to the box, the far plane the largest with max_distance.
  let far = state.max_distance;
  for (let axis = 0; axis < 3; axis += 1) {
    const half = f32((size[axis] as number) / 2);
    far = Math.max(far, Math.abs(f32(half - (offset[axis] as number))), Math.abs(f32(half + (offset[axis] as number))));
  }
  return {
    shape: 'box',
    size,
    intensity: state.intensity,
    blendDistance: state.blend_distance,
    parallaxProjection: state.box_projection,
    parallaxSize: size,
    captureOffset: offset,
    captureMode: state.update_mode === 1 ? 'realtime' : 'on-change',
    near: 0.01,
    far,
    cullMask: state.cull_mask,
    captureShadows: state.enable_shadows,
  };
}

/**
 * The `<ReflectionProbe>` props a scene states for a probe's authored properties (by Godot name):
 * the capture they map to, and the Godot values in `userData.godot`.
 *
 * @godot ReflectionProbe (protocol)
 * @source servers/rendering/renderer_scene_cull.cpp:3814
 */
export function godot_reflection_probe_props(authored: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const state = initial(authored);
  // `set_size` and `set_origin_offset` keep the capture point inside the box.
  clampOffset(state);
  return { ...config(state), userData: { godot: authored } };
}

/** The capture point kept 0.01 inside each half of the box (`reflection_probe.cpp:103`). */
function clampOffset(state: ReflectionProbe, sized = false): void {
  const size = [state.size.x, state.size.y, state.size.z];
  const offset = [state.origin_offset.x, state.origin_offset.y, state.origin_offset.z];
  for (let i = 0; i < 3; i += 1) {
    let half = f32((size[i] as number) / 2);
    // `set_size` keeps at least 0.01 of each half; `set_origin_offset` does not (`:127`).
    if (sized && half < 0.01) half = f32(0.01);
    if (half - 0.01 < Math.abs(offset[i] as number)) offset[i] = f32(Math.sign(offset[i] as number) * (half - 0.01));
  }
  state.origin_offset = vector3(offset[0] as number, offset[1] as number, offset[2] as number);
}

function changed(self: object, state: ReflectionProbe): void {
  const mark = ((self as Object3D).userData as Record<string, unknown> | undefined)?.['reflectionProbe'] as ProbeMark | undefined;
  mark?.updateConfig({ ...mark.config, ...config(state) });
}

/**
 * @godot ReflectionProbe.set_intensity
 * @source scene/3d/reflection_probe.cpp:37
 */
export function set_intensity(self: object, value: number): void {
  const state = stateOf(self);
  state.intensity = f32(value);
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_intensity
 * @source scene/3d/reflection_probe.cpp:42
 */
export function get_intensity(self: object): number {
  return stateOf(self).intensity;
}

/**
 * @godot ReflectionProbe.set_blend_distance
 * @source scene/3d/reflection_probe.cpp:46
 */
export function set_blend_distance(self: object, value: number): void {
  const state = stateOf(self);
  state.blend_distance = f32(value);
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_blend_distance
 * @source scene/3d/reflection_probe.cpp:52
 */
export function get_blend_distance(self: object): number {
  return stateOf(self).blend_distance;
}

/**
 * @godot ReflectionProbe.set_ambient_mode
 * @source scene/3d/reflection_probe.cpp:56
 */
export function set_ambient_mode(self: object, value: number): void {
  const state = stateOf(self);
  state.ambient_mode = value;
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_ambient_mode
 * @source scene/3d/reflection_probe.cpp:62
 */
export function get_ambient_mode(self: object): number {
  return stateOf(self).ambient_mode;
}

/**
 * @godot ReflectionProbe.set_ambient_color
 * @source scene/3d/reflection_probe.cpp:66
 */
export function set_ambient_color(self: object, value: Color): void {
  const state = stateOf(self);
  state.ambient_color = value;
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_ambient_color
 * @source scene/3d/reflection_probe.cpp:80
 */
export function get_ambient_color(self: object): Color {
  return stateOf(self).ambient_color;
}

/**
 * @godot ReflectionProbe.set_ambient_color_energy
 * @source scene/3d/reflection_probe.cpp:71
 */
export function set_ambient_color_energy(self: object, value: number): void {
  const state = stateOf(self);
  state.ambient_color_energy = f32(value);
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_ambient_color_energy
 * @source scene/3d/reflection_probe.cpp:76
 */
export function get_ambient_color_energy(self: object): number {
  return stateOf(self).ambient_color_energy;
}

/**
 * Clamped to 0 to 262144.
 *
 * @godot ReflectionProbe.set_max_distance
 * @source scene/3d/reflection_probe.cpp:84
 */
export function set_max_distance(self: object, value: number): void {
  const state = stateOf(self);
  state.max_distance = f32(Math.min(Math.max(value, 0), 262144));
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_max_distance
 * @source scene/3d/reflection_probe.cpp:90
 */
export function get_max_distance(self: object): number {
  return stateOf(self).max_distance;
}

/**
 * @godot ReflectionProbe.set_mesh_lod_threshold
 * @source scene/3d/reflection_probe.cpp:94
 */
export function set_mesh_lod_threshold(self: object, value: number): void {
  const state = stateOf(self);
  state.mesh_lod_threshold = f32(value);
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_mesh_lod_threshold
 * @source scene/3d/reflection_probe.cpp:99
 */
export function get_mesh_lod_threshold(self: object): number {
  return stateOf(self).mesh_lod_threshold;
}

/**
 * The capture point is kept inside the new box.
 *
 * @godot ReflectionProbe.set_size
 * @source scene/3d/reflection_probe.cpp:103
 */
export function set_size(self: object, value: Vector3): void {
  const state = stateOf(self);
  state.size = vector3(value);
  clampOffset(state, true);
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_size
 * @source scene/3d/reflection_probe.cpp:123
 */
export function get_size(self: object): Vector3 {
  return stateOf(self).size;
}

/**
 * Kept 0.01 inside each half of the box.
 *
 * @godot ReflectionProbe.set_origin_offset
 * @source scene/3d/reflection_probe.cpp:127
 */
export function set_origin_offset(self: object, value: Vector3): void {
  const state = stateOf(self);
  state.origin_offset = vector3(value);
  clampOffset(state);
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_origin_offset
 * @source scene/3d/reflection_probe.cpp:142
 */
export function get_origin_offset(self: object): Vector3 {
  return stateOf(self).origin_offset;
}

/**
 * @godot ReflectionProbe.set_enable_box_projection
 * @source scene/3d/reflection_probe.cpp:146
 */
export function set_enable_box_projection(self: object, value: boolean): void {
  const state = stateOf(self);
  state.box_projection = value;
  changed(self, state);
}

/**
 * @godot ReflectionProbe.is_box_projection_enabled
 * @source scene/3d/reflection_probe.cpp:151
 */
export function is_box_projection_enabled(self: object): boolean {
  return stateOf(self).box_projection;
}

/**
 * @godot ReflectionProbe.set_as_interior
 * @source scene/3d/reflection_probe.cpp:155
 */
export function set_as_interior(self: object, value: boolean): void {
  const state = stateOf(self);
  state.interior = value;
  changed(self, state);
}

/**
 * @godot ReflectionProbe.is_set_as_interior
 * @source scene/3d/reflection_probe.cpp:160
 */
export function is_set_as_interior(self: object): boolean {
  return stateOf(self).interior;
}

/**
 * @godot ReflectionProbe.set_enable_shadows
 * @source scene/3d/reflection_probe.cpp:164
 */
export function set_enable_shadows(self: object, value: boolean): void {
  const state = stateOf(self);
  state.enable_shadows = value;
  changed(self, state);
}

/**
 * @godot ReflectionProbe.are_shadows_enabled
 * @source scene/3d/reflection_probe.cpp:169
 */
export function are_shadows_enabled(self: object): boolean {
  return stateOf(self).enable_shadows;
}

/**
 * @godot ReflectionProbe.set_cull_mask
 * @source scene/3d/reflection_probe.cpp:173
 */
export function set_cull_mask(self: object, value: number): void {
  const state = stateOf(self);
  state.cull_mask = value >>> 0;
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_cull_mask
 * @source scene/3d/reflection_probe.cpp:178
 */
export function get_cull_mask(self: object): number {
  return stateOf(self).cull_mask;
}

/**
 * @godot ReflectionProbe.set_reflection_mask
 * @source scene/3d/reflection_probe.cpp:182
 */
export function set_reflection_mask(self: object, value: number): void {
  const state = stateOf(self);
  state.reflection_mask = value >>> 0;
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_reflection_mask
 * @source scene/3d/reflection_probe.cpp:187
 */
export function get_reflection_mask(self: object): number {
  return stateOf(self).reflection_mask;
}

/**
 * @godot ReflectionProbe.set_update_mode
 * @source scene/3d/reflection_probe.cpp:191
 */
export function set_update_mode(self: object, value: number): void {
  const state = stateOf(self);
  state.update_mode = value;
  changed(self, state);
}

/**
 * @godot ReflectionProbe.get_update_mode
 * @source scene/3d/reflection_probe.cpp:196
 */
export function get_update_mode(self: object): number {
  return stateOf(self).update_mode;
}

// The node's class, for a probe its JSX declares.
godot_node_class_reader((entity) =>
  ((entity as Object3D).userData as Record<string, unknown> | undefined)?.['reflectionProbe'] !== undefined
    ? ['ReflectionProbe', 'VisualInstance3D', 'Node3D', 'Node', 'Object']
    : undefined,
);
