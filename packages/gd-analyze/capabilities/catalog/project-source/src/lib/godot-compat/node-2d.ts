/**
 * @godot-class Node2D
 * @role PROTOCOL
 *
 * Godot 4.7's `Node2D` (`scene/2d/node_2d.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * a canvas item placed by its position, rotation, skew and scale, composed into its transform by
 * `set_rotation_scale_and_skew` (`_update_transform`), in single precision. Like a Control it is a
 * non-spatial three `Group` (`node.ts`) and a canvas item (`canvas-item.ts`) whose `get_transform()`
 * is this one; setting the transform directly (`set_transform`) is not bound, so the values are
 * never recovered from a transform.
 */

import type { Object3D } from 'three';
import { get_global_transform, godot_canvas_item_mount, godot_canvas_item_parent, type CanvasItemClass } from './canvas-item';
import { godot_node_adopt, godot_node_entity } from './node';
import { affine_inverse, construct as transform2d, op_multiply as xform, type Transform2D } from './transform-2d';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

/** `CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = 0.00001;

interface Node2DState {
  position: Vector2;
  rotation: number;
  skew: number;
  scale: Vector2;
  transform: Transform2D;
}

const NODES = new WeakMap<Object3D, Node2DState>();

function stateOf(self: object, member: string): Node2DState {
  const state = NODES.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Node2D`);
  return state;
}

/**
 * `_update_transform` (`node_2d.cpp:139`): `set_rotation_scale_and_skew` (`transform_2d.h:249`),
 * each term `cosf`/`sinf` of the `real_t` angle times the scale, and the position as the origin.
 */
function update(state: Node2DState): void {
  const rot = state.rotation;
  const turned = f32(rot + state.skew);
  state.transform = transform2d(
    vector2(f32(f32(Math.cos(rot)) * state.scale.x), f32(f32(Math.sin(rot)) * state.scale.x)),
    vector2(f32(-f32(Math.sin(turned)) * state.scale.y), f32(f32(Math.cos(turned)) * state.scale.y)),
    state.position,
  );
}

/**
 * Makes `entity` a Node2D of `classes` (nearest first, `Node2D` and its ancestors included), with
 * `extra` the class's own drawing, at the origin with no rotation, skew or scale
 * (`scene/2d/node_2d.h:43-47`).
 *
 * @godot Node2D (protocol)
 * @source scene/2d/node_2d.cpp:139
 */
export function godot_node_2d_mount(entity: Object3D, classes: readonly string[], extra: Omit<CanvasItemClass, 'transform'> = {}): void {
  const state: Node2DState = { position: vector2(), rotation: 0, skew: 0, scale: vector2(1, 1), transform: transform2d() };
  NODES.set(entity, state);
  godot_node_adopt(entity, { kind: 'node', classes });
  godot_canvas_item_mount(entity, classes, { ...extra, transform: () => state.transform });
}

/**
 * @godot Node2D.set_position
 * @source scene/2d/node_2d.cpp:159
 */
export function set_position(self: object, p_pos: Vector2): void {
  const state = stateOf(self, 'set_position');
  state.position = p_pos;
  update(state);
}

/**
 * @godot Node2D.get_position
 * @source scene/2d/node_2d.cpp:207
 */
export function get_position(self: object): Vector2 {
  return stateOf(self, 'get_position').position;
}

/**
 * @godot Node2D.set_rotation
 * @source scene/2d/node_2d.cpp:168
 */
export function set_rotation(self: object, p_radians: number): void {
  const state = stateOf(self, 'set_rotation');
  state.rotation = f32(p_radians);
  update(state);
}

/**
 * @godot Node2D.get_rotation
 * @source scene/2d/node_2d.cpp:216
 */
export function get_rotation(self: object): number {
  return stateOf(self, 'get_rotation').rotation;
}

/**
 * @godot Node2D.set_skew
 * @source scene/2d/node_2d.cpp:182
 */
export function set_skew(self: object, p_radians: number): void {
  const state = stateOf(self, 'set_skew');
  state.skew = f32(p_radians);
  update(state);
}

/**
 * @godot Node2D.get_skew
 * @source scene/2d/node_2d.cpp:230
 */
export function get_skew(self: object): number {
  return stateOf(self, 'get_skew').skew;
}

/**
 * A component that is approximately zero becomes `CMP_EPSILON` (`node_2d.cpp:197`).
 *
 * @godot Node2D.set_scale
 * @source scene/2d/node_2d.cpp:191
 */
export function set_scale(self: object, p_scale: Vector2): void {
  const state = stateOf(self, 'set_scale');
  state.scale = vector2(Math.abs(p_scale.x) < CMP_EPSILON ? CMP_EPSILON : p_scale.x, Math.abs(p_scale.y) < CMP_EPSILON ? CMP_EPSILON : p_scale.y);
  update(state);
}

/**
 * @godot Node2D.get_scale
 * @source scene/2d/node_2d.cpp:239
 */
export function get_scale(self: object): Vector2 {
  return stateOf(self, 'get_scale').scale;
}

/**
 * The global transform's origin.
 *
 * @godot Node2D.get_global_position
 * @source scene/2d/node_2d.cpp:293
 */
export function get_global_position(self: object): Vector2 {
  stateOf(self, 'get_global_position');
  return get_global_transform(self).origin;
}

/**
 * The point in the parent item's space (its global transform inverted), or itself without one.
 *
 * @godot Node2D.set_global_position
 * @source scene/2d/node_2d.cpp:298
 */
export function set_global_position(self: object, p_pos: Vector2): void {
  stateOf(self, 'set_global_position');
  const parent = godot_canvas_item_parent(godot_node_entity(self) as Object3D);
  set_position(self, parent === null ? p_pos : xform(affine_inverse(get_global_transform(parent)), p_pos));
}

/**
 * A plain Node2D as its class creates it, for the scene's mount.
 *
 * @godot Node2D (protocol)
 * @source scene/2d/node_2d.cpp:139
 */
export function godot_node_2d_node_mount(entity: Object3D): void {
  godot_node_2d_mount(entity, ['Node2D', 'CanvasItem', 'Node']);
}
