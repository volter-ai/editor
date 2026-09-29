/**
 * @godot-class PhysicsBody3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsBody3D` (`scene/3d/physics/physics_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over @react-three/rapier bodies: collision
 * exceptions, which the contact filter the world registers (`godot_physics_body_3d_collides`),
 * the character controller and space queries honour; and axis locks, Rapier's enabled translations
 * and rotations on the node's body.
 *
 * Rapier keeps one set of locked axes where Godot keeps a body's `locked_axis` beside a rigid
 * body's `lock_rotation` (which switches it to `BODY_MODE_RIGID_LINEAR`, rigid_body_3d.cpp:295), so
 * each body's locks are one record here, seeded once from what the scene authored (its `userData`),
 * and every change writes both to Rapier: a rotation is enabled unless `lock_rotation` holds or its
 * axis is locked.
 */

import { ActiveHooks } from '@dimforge/rapier3d-compat';
import { godot_collision_object_body, godot_collision_object_colliders, godot_physics_world } from './collision-object-3d';
import { construct as vector3, type Vector3 } from './vector3';
import { godot_node_entity } from './node';

/** Each node's collision exceptions (`PhysicsBody3D::add_collision_exception_with`), both ways. */
const EXCEPTIONS = new WeakMap<object, Set<object>>();
/** A body's locks: its `locked_axis` bits (`PhysicsServer3D::BodyAxis`) and a rigid body's `lock_rotation`. */
interface Locks {
  axes: number;
  rotation: boolean;
}

const LOCKS = new WeakMap<object, Locks>();

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
 * The node's locks, seeded when first asked for from what the scene authored: its `locked_axis`
 * bits and `lock_rotation`, which the scene states in its `userData` (`axis_lock`, `lock_rotation`)
 * beside Rapier's own props, since Rapier merges them and cannot report them back.
 */
function locksOf(entity: object): Locks {
  let locks = LOCKS.get(entity);
  if (locks === undefined) {
    const data = (entity as { readonly userData?: Readonly<Record<string, unknown>> }).userData ?? {};
    locks = { axes: Number(data['axis_lock'] ?? 0) | 0, rotation: data['lock_rotation'] === true };
    LOCKS.set(entity, locks);
  }
  return locks;
}

/** Writes the node's locks to its body. */
function applyLocks(entity: object, locks: Locks): void {
  const body = godot_collision_object_body(entity);
  if (body === undefined) return;
  const { axes, rotation } = locks;
  body.setEnabledTranslations((axes & 1) === 0, (axes & 2) === 0, (axes & 4) === 0, true);
  body.setEnabledRotations(!rotation && (axes & 8) === 0, !rotation && (axes & 16) === 0, !rotation && (axes & 32) === 0, true);
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
  const locks = locksOf(entity);
  locks.axes = lock ? locks.axes | axis : locks.axes & ~axis;
  applyLocks(entity, locks);
}

/**
 * @godot PhysicsBody3D.get_axis_lock
 * @source scene/3d/physics/physics_body_3d.cpp:201
 */
export function get_axis_lock(self: object, axis: number): boolean {
  return (locksOf(godot_node_entity(self)).axes & axis) !== 0;
}

/**
 * Locks or frees every rotation of a rigid body (`RigidBody3D.lock_rotation`), its axis locks kept.
 *
 * @godot RigidBody3D (protocol)
 * @source scene/3d/physics/rigid_body_3d.cpp:295
 */
export function godot_physics_body_3d_lock_rotation(self: object, lock: boolean): void {
  const entity = godot_node_entity(self);
  const locks = locksOf(entity);
  locks.rotation = lock;
  applyLocks(entity, locks);
}

/**
 * Whether a rigid body's `lock_rotation` holds.
 *
 * @godot RigidBody3D (protocol)
 * @source scene/3d/physics/rigid_body_3d.cpp:311
 */
export function godot_physics_body_3d_rotation_locked(self: object): boolean {
  return locksOf(godot_node_entity(self)).rotation;
}

/**
 * The gravity acting on the body: the physics world's (Rapier's); an Area3D's gravity override is
 * not added.
 *
 * @godot PhysicsBody3D.get_gravity
 * @source scene/3d/physics/physics_body_3d.cpp:183
 */
export function get_gravity(self: object): Vector3 {
  void self;
  const gravity = godot_physics_world()?.gravity;
  return gravity === undefined ? vector3(0, 0, 0) : vector3(gravity.x, gravity.y, gravity.z);
}
