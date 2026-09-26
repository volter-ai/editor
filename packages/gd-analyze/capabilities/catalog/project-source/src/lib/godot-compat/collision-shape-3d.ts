/**
 * @godot-class CollisionShape3D
 * @role BINDING
 *
 * Godot 4.7's `CollisionShape3D` (`scene/3d/physics/collision_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node3D child of a collision object that gives it a
 * shape at the child's local transform. Its entity is an Object3D; the shape and `disabled` live in
 * `SHAPE`, keyed by it. `collision-object-3d.ts` builds the Rapier collider from them.
 */

import { godot_node_entity } from './node';

interface ShapeState {
  shape: object | null;
  disabled: boolean;
}

const SHAPE = new WeakMap<object, ShapeState>();

function stateOf(object: object): ShapeState {
  const entity = godot_node_entity(object);
  let state = SHAPE.get(entity);
  if (state === undefined) {
    state = { shape: null, disabled: false };
    SHAPE.set(entity, state);
  }
  return state;
}

/**
 * Registers a node as a CollisionShape3D.
 *
 * @godot CollisionShape3D (protocol)
 * @source scene/3d/physics/collision_shape_3d.cpp:192
 */
export function godot_collision_shape_3d_adopt(entity: object): void {
  stateOf(entity);
}

/**
 * The shape and `disabled` of a CollisionShape3D entity, or undefined for any other node.
 *
 * @godot CollisionShape3D (protocol)
 * @source scene/3d/physics/collision_shape_3d.cpp:192
 */
export function godot_collision_shape_3d_of(entity: object): { readonly shape: object | null; readonly disabled: boolean } | undefined {
  return SHAPE.get(entity);
}

/**
 * @godot CollisionShape3D.set_shape
 * @source scene/3d/physics/collision_shape_3d.cpp:192
 */
export function set_shape(self: object, shape: object | null): void {
  stateOf(self).shape = shape;
}

/**
 * @godot CollisionShape3D.get_shape
 * @source scene/3d/physics/collision_shape_3d.cpp:234
 */
export function get_shape(self: object): object | null {
  return stateOf(self).shape;
}

/**
 * @godot CollisionShape3D.set_disabled
 * @source scene/3d/physics/collision_shape_3d.cpp:238
 */
export function set_disabled(self: object, disabled: boolean): void {
  stateOf(self).disabled = disabled;
}

/**
 * @godot CollisionShape3D.is_disabled
 * @source scene/3d/physics/collision_shape_3d.cpp:246
 */
export function is_disabled(self: object): boolean {
  return stateOf(self).disabled;
}
