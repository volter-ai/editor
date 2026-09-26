/**
 * @godot-class CollisionShape3D
 * @role BINDING
 *
 * Godot 4.7's `CollisionShape3D` (`scene/3d/physics/collision_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node3D child of a collision object that gives it a
 * shape at the child's local transform. Its entity is an Object3D; the shape and `disabled` live in
 * `SHAPE`, keyed by it. `collision-object-3d.ts` builds the Rapier collider from them, or, for a
 * collider the scene's JSX declares (`<CuboidCollider>`), the shape is read from that collider.
 */

import { type Collider, type Cuboid, ShapeType } from '@dimforge/rapier3d-compat';
import { construct as box, set_size } from './box-shape-3d';
import { godot_node_class_reader, godot_node_entity } from './node';
import { construct as vector3 } from './vector3';

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

/** The colliders the scene's JSX declares: CollisionShape3D nodes. */
const DECLARED = new WeakSet<object>();
const COLLISION_SHAPE_3D = Object.freeze(['CollisionShape3D', 'Node3D', 'Node', 'Object']);
godot_node_class_reader((entity) => (DECLARED.has(entity) ? COLLISION_SHAPE_3D : undefined));

/**
 * Registers a collider the scene's JSX declares as a CollisionShape3D, its shape the Godot shape
 * the collider holds: a cuboid is a BoxShape3D of twice its half extents (`BoxShape3D` hands the
 * server `size / 2`, `box_shape_3d.cpp:37`).
 *
 * @godot CollisionShape3D (protocol)
 * @source scene/3d/physics/collision_shape_3d.cpp:192
 */
export function godot_collision_shape_3d_declare(entity: object, collider: Collider): void {
  if (SHAPE.has(entity)) return;
  DECLARED.add(entity);
  if (collider.shape.type !== ShapeType.Cuboid) {
    throw new Error(`godot-compat: a declared collider of Rapier shape ${String(collider.shape.type)} has no Godot shape yet.`);
  }
  const half = (collider.shape as Cuboid).halfExtents;
  const shape = box();
  set_size(shape, vector3(half.x * 2, half.y * 2, half.z * 2));
  stateOf(entity).shape = shape;
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
