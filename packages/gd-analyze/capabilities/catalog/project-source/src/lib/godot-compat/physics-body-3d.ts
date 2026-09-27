/**
 * @godot-class PhysicsBody3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsBody3D` (`scene/3d/physics/physics_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over @react-three/rapier bodies: collision
 * exceptions, which the contact filter the world registers (`godot_physics_body_3d_collides`),
 * the character controller and space queries honour; and axis locks, Rapier's enabled translations
 * and rotations on the node's body.
 */

import { ActiveHooks } from '@dimforge/rapier3d-compat';
import { godot_collision_object_body, godot_collision_object_colliders } from './collision-object-3d';
import { godot_node_entity } from './node';

/** Each node's collision exceptions (`PhysicsBody3D::add_collision_exception_with`), both ways. */
const EXCEPTIONS = new WeakMap<object, Set<object>>();
/** The node's `locked_axis` bits (`PhysicsServer3D::BodyAxis`). */
const LOCKED = new WeakMap<object, number>();

function exceptionsOf(entity: object): Set<object> {
  let set = EXCEPTIONS.get(entity);
  if (set === undefined) {
    set = new Set();
    EXCEPTIONS.set(entity, set);
  }
  return set;
}

/**
 * Whether two nodes' bodies may touch: not when either lists the other as an exception.
 *
 * @godot PhysicsBody3D (protocol)
 * @source scene/3d/physics/physics_body_3d.cpp:76
 */
export function godot_physics_body_3d_collides(a: object, b: object): boolean {
  return !(EXCEPTIONS.get(a)?.has(b) ?? false) && !(EXCEPTIONS.get(b)?.has(a) ?? false);
}

/**
 * @godot PhysicsBody3D.add_collision_exception_with
 * @source scene/3d/physics/physics_body_3d.cpp:76
 */
export function add_collision_exception_with(self: object, body: object): void {
  const entity = godot_node_entity(self);
  const other = godot_node_entity(body);
  exceptionsOf(entity).add(other);
  // Rapier asks the world's contact filter only about colliders that want it.
  for (const node of [entity, other]) {
    for (const collider of godot_collision_object_colliders(node)) collider.setActiveHooks(ActiveHooks.FILTER_CONTACT_PAIRS);
  }
}

/**
 * @godot PhysicsBody3D.remove_collision_exception_with
 * @source scene/3d/physics/physics_body_3d.cpp:83
 */
export function remove_collision_exception_with(self: object, body: object): void {
  exceptionsOf(godot_node_entity(self)).delete(godot_node_entity(body));
}

/**
 * Sets or clears a `BodyAxis` bit (linear x 1, y 2, z 4; angular x 8, y 16, z 32) of the node's
 * locks, as its Rapier body's enabled translations and rotations.
 *
 * @godot PhysicsBody3D.set_axis_lock
 * @source scene/3d/physics/physics_body_3d.cpp:192
 */
export function set_axis_lock(self: object, axis: number, lock: boolean): void {
  const entity = godot_node_entity(self);
  const locked = lock ? (LOCKED.get(entity) ?? 0) | axis : (LOCKED.get(entity) ?? 0) & ~axis;
  LOCKED.set(entity, locked);
  const body = godot_collision_object_body(entity);
  if (body === undefined) return;
  body.setEnabledTranslations((locked & 1) === 0, (locked & 2) === 0, (locked & 4) === 0, true);
  body.setEnabledRotations((locked & 8) === 0, (locked & 16) === 0, (locked & 32) === 0, true);
}

/**
 * @godot PhysicsBody3D.get_axis_lock
 * @source scene/3d/physics/physics_body_3d.cpp:201
 */
export function get_axis_lock(self: object, axis: number): boolean {
  const entity = godot_node_entity(self);
  const known = LOCKED.get(entity);
  if (known !== undefined) return (known & axis) !== 0;
  // A lock the scene declared (`enabledRotations` / `enabledTranslations`), read from the body.
  const body = godot_collision_object_body(entity);
  if (body === undefined) return false;
  const inverse = body.effectiveInvMass();
  const inertia = body.effectiveWorldInvInertia();
  const declared =
    (inverse.x === 0 ? 1 : 0) | (inverse.y === 0 ? 2 : 0) | (inverse.z === 0 ? 4 : 0) |
    (inertia.m11 === 0 ? 8 : 0) | (inertia.m22 === 0 ? 16 : 0) | (inertia.m33 === 0 ? 32 : 0);
  return (declared & axis) !== 0;
}
