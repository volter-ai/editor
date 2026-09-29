/**
 * @godot-class ShapeCast3D
 * @role BINDING
 *
 * Godot 4.7's `ShapeCast3D` (`scene/3d/physics/shape_cast_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over Rapier's `castShape`: its shape swept from its
 * global transform along its global `target_position`, its margin Rapier's target distance, the
 * colliders its mask admits (by their node's layer), its exceptions and, with `exclude_parent`, its
 * parent body left out. The first hit is where the sweep first touches; a further result (up to
 * `max_results`) is the next hit along the sweep with the ones found left out, where Godot gathers
 * the contacts at the first impact. Godot refreshes the result each physics step
 * (`shape_cast_3d.cpp:75`); here the sweep runs when a script reads it, as `ray-cast-3d.ts` does.
 * The debug shape is not drawn.
 */

import { type Collider, QueryFilterFlags } from '@dimforge/rapier3d-compat';
import type { ReactElement } from 'react';
import { Group, Matrix3, type Object3D, Quaternion as ThreeQuaternion, Vector3 as ThreeVector3 } from 'three';
import { godot_collision_object_body, godot_collision_object_layers, godot_collision_object_of_collider, godot_physics_world } from './collision-object-3d';
import { construct as color, type Color } from './color';
import { godot_node_entity, godot_node_object, is_inside_tree } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { godot_shape_3d_collider } from './shape-3d';
import { construct as vector3, type Vector3 } from './vector3';

interface Hit {
  readonly collider: object;
  readonly point: Vector3;
  readonly normal: Vector3;
}

interface CastState {
  enabled: boolean;
  shape: object | null;
  target: Vector3;
  margin: number;
  maxResults: number;
  mask: number;
  excludeParent: boolean;
  collideWithAreas: boolean;
  collideWithBodies: boolean;
  debugColor: Color;
  readonly exceptions: Set<object>;
  hits: Hit[];
  safeFraction: number;
  unsafeFraction: number;
}

const CASTS = new WeakMap<object, CastState>();

/** A ShapeCast3D's settings as Godot starts them (`shape_cast_3d.h:41`). */
function stateOf(self: object): CastState {
  const entity = godot_node_entity(self);
  let state = CASTS.get(entity);
  if (state === undefined) {
    state = {
      enabled: true,
      shape: null,
      target: vector3(0, -1, 0),
      margin: 0,
      maxResults: 32,
      mask: 1,
      excludeParent: true,
      collideWithAreas: false,
      collideWithBodies: true,
      debugColor: color(0, 0, 0, 1),
      exceptions: new Set(),
      hits: [],
      safeFraction: 1,
      unsafeFraction: 1,
    };
    CASTS.set(entity, state);
  }
  return state;
}

const origin = new ThreeVector3();
const rotation = new ThreeQuaternion();
const scale = new ThreeVector3();
const motion = new ThreeVector3();
const basis = new Matrix3();

/** The sweep (`ShapeCast3D::_update_shapecast_state`, `shape_cast_3d.cpp:385`), over Rapier's world. */
function update(entity: Object3D, state: CastState): void {
  state.hits = [];
  state.safeFraction = 1;
  state.unsafeFraction = 1;
  const world = godot_physics_world();
  const shape = state.shape === null ? null : godot_shape_3d_collider(state.shape).desc?.shape;
  if (world === undefined || shape === null || shape === undefined) return;
  entity.updateWorldMatrix(true, false);
  entity.matrixWorld.decompose(origin, rotation, scale);
  motion.set(state.target.x, state.target.y, state.target.z).applyMatrix3(basis.setFromMatrix4(entity.matrixWorld));
  const excluded = new Set([...state.exceptions]);
  const parent = entity.parent;
  if (state.excludeParent && parent !== null && godot_collision_object_body(parent) !== undefined) excluded.add(godot_node_entity(parent));
  const found = new Set<Collider>();
  const admits = (collider: Collider): boolean => {
    const node = godot_collision_object_of_collider(collider);
    return node !== undefined && !found.has(collider) && !excluded.has(node) && (godot_collision_object_layers(node).layer & state.mask) !== 0;
  };
  const flags = (state.collideWithAreas ? 0 : QueryFilterFlags.EXCLUDE_SENSORS) | (state.collideWithBodies ? 0 : QueryFilterFlags.EXCLUDE_SOLIDS);
  const still = motion.lengthSq() === 0;
  while (state.hits.length < state.maxResults) {
    const hit = world.castShape(origin, rotation, motion, shape, state.margin, still ? 0 : 1, true, flags, undefined, undefined, undefined, admits);
    if (hit === null) break;
    found.add(hit.collider);
    if (state.hits.length === 0) {
      state.safeFraction = hit.time_of_impact;
      state.unsafeFraction = hit.time_of_impact;
    }
    // The witness and normal on the collider, from its space into the world's.
    const place = hit.collider.translation();
    const turn = hit.collider.rotation();
    const quaternion = new ThreeQuaternion(turn.x, turn.y, turn.z, turn.w);
    const point = new ThreeVector3(hit.witness2.x, hit.witness2.y, hit.witness2.z).applyQuaternion(quaternion).add(new ThreeVector3(place.x, place.y, place.z));
    const normal = new ThreeVector3(hit.normal2.x, hit.normal2.y, hit.normal2.z).applyQuaternion(quaternion);
    state.hits.push({ collider: godot_collision_object_of_collider(hit.collider) as object, point: vector3(point.x, point.y, point.z), normal: vector3(normal.x, normal.y, normal.z) });
  }
}

/** The result, swept when a script reads it; a disabled cast keeps its last. */
function current(self: object): CastState {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(entity);
  if (state.enabled && is_inside_tree(entity)) update(entity, state);
  return state;
}

/**
 * @godot ShapeCast3D.set_enabled
 * @source scene/3d/physics/shape_cast_3d.cpp:194
 */
export function set_enabled(self: object, enabled: boolean): void {
  stateOf(self).enabled = enabled;
}

/**
 * @godot ShapeCast3D.is_enabled
 * @source scene/3d/physics/shape_cast_3d.cpp:214
 */
export function is_enabled(self: object): boolean {
  return stateOf(self).enabled;
}

/**
 * @godot ShapeCast3D.set_target_position
 * @source scene/3d/physics/shape_cast_3d.cpp:218
 */
export function set_target_position(self: object, local_point: Vector3): void {
  stateOf(self).target = vector3(local_point.x, local_point.y, local_point.z);
}

/**
 * @godot ShapeCast3D.get_target_position
 * @source scene/3d/physics/shape_cast_3d.cpp:234
 */
export function get_target_position(self: object): Vector3 {
  return stateOf(self).target;
}

/**
 * @godot ShapeCast3D.set_margin
 * @source scene/3d/physics/shape_cast_3d.cpp:238
 */
export function set_margin(self: object, margin: number): void {
  stateOf(self).margin = margin;
}

/**
 * @godot ShapeCast3D.get_margin
 * @source scene/3d/physics/shape_cast_3d.cpp:242
 */
export function get_margin(self: object): number {
  return stateOf(self).margin;
}

/**
 * @godot ShapeCast3D.set_max_results
 * @source scene/3d/physics/shape_cast_3d.cpp:246
 */
export function set_max_results(self: object, max_results: number): void {
  stateOf(self).maxResults = max_results;
}

/**
 * @godot ShapeCast3D.get_max_results
 * @source scene/3d/physics/shape_cast_3d.cpp:250
 */
export function get_max_results(self: object): number {
  return stateOf(self).maxResults;
}

/**
 * @godot ShapeCast3D.set_collision_mask
 * @source scene/3d/physics/shape_cast_3d.cpp:254
 */
export function set_collision_mask(self: object, mask: number): void {
  stateOf(self).mask = mask >>> 0;
}

/**
 * @godot ShapeCast3D.get_collision_mask
 * @source scene/3d/physics/shape_cast_3d.cpp:258
 */
export function get_collision_mask(self: object): number {
  return stateOf(self).mask;
}

/**
 * @godot ShapeCast3D.set_collision_mask_value
 * @source scene/3d/physics/shape_cast_3d.cpp:262
 */
export function set_collision_mask_value(self: object, layer_number: number, value: boolean): void {
  const bit = 1 << (layer_number - 1);
  const state = stateOf(self);
  state.mask = (value ? state.mask | bit : state.mask & ~bit) >>> 0;
}

/**
 * @godot ShapeCast3D.get_collision_mask_value
 * @source scene/3d/physics/shape_cast_3d.cpp:274
 */
export function get_collision_mask_value(self: object, layer_number: number): boolean {
  return (stateOf(self).mask & (1 << (layer_number - 1))) !== 0;
}

/**
 * @godot ShapeCast3D.get_collision_count
 * @source scene/3d/physics/shape_cast_3d.cpp:280
 */
export function get_collision_count(self: object): number {
  return current(self).hits.length;
}

/**
 * @godot ShapeCast3D.is_colliding
 * @source scene/3d/physics/shape_cast_3d.cpp:284
 */
export function is_colliding(self: object): boolean {
  return current(self).hits.length > 0;
}

/**
 * @godot ShapeCast3D.get_collider
 * @source scene/3d/physics/shape_cast_3d.cpp:288
 */
export function get_collider(self: object, index: number): object | null {
  const hit = current(self).hits[index];
  return hit === undefined ? null : godot_node_object(hit.collider);
}

/**
 * @godot ShapeCast3D.get_collider_shape
 * @source scene/3d/physics/shape_cast_3d.cpp:302
 */
export function get_collider_shape(self: object, index: number): number {
  return current(self).hits[index] === undefined ? -1 : 0;
}

/**
 * @godot ShapeCast3D.get_collision_point
 * @source scene/3d/physics/shape_cast_3d.cpp:307
 */
export function get_collision_point(self: object, index: number): Vector3 {
  return current(self).hits[index]?.point ?? vector3(0, 0, 0);
}

/**
 * @godot ShapeCast3D.get_collision_normal
 * @source scene/3d/physics/shape_cast_3d.cpp:312
 */
export function get_collision_normal(self: object, index: number): Vector3 {
  return current(self).hits[index]?.normal ?? vector3(0, 0, 0);
}

/**
 * @godot ShapeCast3D.get_closest_collision_safe_fraction
 * @source scene/3d/physics/shape_cast_3d.cpp:317
 */
export function get_closest_collision_safe_fraction(self: object): number {
  return current(self).safeFraction;
}

/**
 * @godot ShapeCast3D.get_closest_collision_unsafe_fraction
 * @source scene/3d/physics/shape_cast_3d.cpp:321
 */
export function get_closest_collision_unsafe_fraction(self: object): number {
  return current(self).unsafeFraction;
}

/**
 * @godot ShapeCast3D.set_shape
 * @source scene/3d/physics/shape_cast_3d.cpp:338
 */
export function set_shape(self: object, shape: object | null): void {
  stateOf(self).shape = shape;
}

/**
 * @godot ShapeCast3D.get_shape
 * @source scene/3d/physics/shape_cast_3d.cpp:359
 */
export function get_shape(self: object): object | null {
  return stateOf(self).shape;
}

/**
 * @godot ShapeCast3D.set_exclude_parent_body
 * @source scene/3d/physics/shape_cast_3d.cpp:363
 */
export function set_exclude_parent_body(self: object, exclude: boolean): void {
  stateOf(self).excludeParent = exclude;
}

/**
 * @godot ShapeCast3D.get_exclude_parent_body
 * @source scene/3d/physics/shape_cast_3d.cpp:381
 */
export function get_exclude_parent_body(self: object): boolean {
  return stateOf(self).excludeParent;
}

/**
 * Sweeps now, inside or outside the physics step.
 *
 * @godot ShapeCast3D.force_shapecast_update
 * @source scene/3d/physics/shape_cast_3d.cpp:436
 */
export function force_shapecast_update(self: object): void {
  const entity = godot_node_entity(self) as Object3D;
  if (is_inside_tree(entity)) update(entity, stateOf(entity));
}

/**
 * @godot ShapeCast3D.add_exception
 * @source scene/3d/physics/shape_cast_3d.cpp:444
 */
export function add_exception(self: object, node: object): void {
  stateOf(self).exceptions.add(godot_node_entity(node));
}

/**
 * @godot ShapeCast3D.remove_exception
 * @source scene/3d/physics/shape_cast_3d.cpp:453
 */
export function remove_exception(self: object, node: object): void {
  stateOf(self).exceptions.delete(godot_node_entity(node));
}

/**
 * @godot ShapeCast3D.clear_exceptions
 * @source scene/3d/physics/shape_cast_3d.cpp:458
 */
export function clear_exceptions(self: object): void {
  stateOf(self).exceptions.clear();
}

/**
 * @godot ShapeCast3D.set_collide_with_areas
 * @source scene/3d/physics/shape_cast_3d.cpp:462
 */
export function set_collide_with_areas(self: object, enable: boolean): void {
  stateOf(self).collideWithAreas = enable;
}

/**
 * @godot ShapeCast3D.is_collide_with_areas_enabled
 * @source scene/3d/physics/shape_cast_3d.cpp:466
 */
export function is_collide_with_areas_enabled(self: object): boolean {
  return stateOf(self).collideWithAreas;
}

/**
 * @godot ShapeCast3D.set_collide_with_bodies
 * @source scene/3d/physics/shape_cast_3d.cpp:470
 */
export function set_collide_with_bodies(self: object, enable: boolean): void {
  stateOf(self).collideWithBodies = enable;
}

/**
 * @godot ShapeCast3D.is_collide_with_bodies_enabled
 * @source scene/3d/physics/shape_cast_3d.cpp:474
 */
export function is_collide_with_bodies_enabled(self: object): boolean {
  return stateOf(self).collideWithBodies;
}

/**
 * The result as dictionaries of each hit's point, normal and collider (`collision_result`).
 *
 * @godot ShapeCast3D.get_collision_result
 * @source scene/3d/physics/shape_cast_3d.cpp:478
 */
export function get_collision_result(self: object): Map<string, unknown>[] {
  return current(self).hits.map(
    (hit) =>
      new Map<string, unknown>([
        ['collider_id', godot_node_object(hit.collider)],
        ['collider', godot_node_object(hit.collider)],
        ['shape', 0],
        ['point', hit.point],
        ['normal', hit.normal],
        ['rid', hit.collider],
      ]),
  );
}

/**
 * @godot ShapeCast3D.set_debug_shape_custom_color
 * @source scene/3d/physics/shape_cast_3d.cpp:525
 */
export function set_debug_shape_custom_color(self: object, debug_shape_custom_color: Color): void {
  stateOf(self).debugColor = debug_shape_custom_color;
}

/**
 * @godot ShapeCast3D.get_debug_shape_custom_color
 * @source scene/3d/physics/shape_cast_3d.cpp:529
 */
export function get_debug_shape_custom_color(self: object): Color {
  return stateOf(self).debugColor;
}

const SHAPE_CAST_3D = {
  create: () => new Group(),
  spatial: true,
  mount: (entity: Object3D) => void stateOf(entity),
  props: new Map<string, GodotElementProp<Object3D>>([
    ['enabled', (entity, value: boolean) => set_enabled(entity, value)],
    ['shape', (entity, value: object | null) => set_shape(entity, value)],
    ['targetPosition', (entity, value: readonly [number, number, number]) => set_target_position(entity, vector3(...value))],
    ['margin', (entity, value: number) => set_margin(entity, value)],
    ['maxResults', (entity, value: number) => set_max_results(entity, value)],
    ['collisionMask', (entity, value: number) => set_collision_mask(entity, value)],
    ['excludeParent', (entity, value: boolean) => set_exclude_parent_body(entity, value)],
    ['collideWithAreas', (entity, value: boolean) => set_collide_with_areas(entity, value)],
    ['collideWithBodies', (entity, value: boolean) => set_collide_with_bodies(entity, value)],
    ['debugShapeCustomColor', (entity, value: readonly [number, number, number, number]) => set_debug_shape_custom_color(entity, color(...value))],
  ]),
};

/**
 * A ShapeCast3D as a scene writes it: `<GodotShapeCast3D shape={cylinder} targetPosition={[0, -2.6, 0]} />`.
 *
 * @godot ShapeCast3D (protocol)
 * @source scene/3d/physics/shape_cast_3d.h:41
 */
export function GodotShapeCast3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(SHAPE_CAST_3D, props);
}
