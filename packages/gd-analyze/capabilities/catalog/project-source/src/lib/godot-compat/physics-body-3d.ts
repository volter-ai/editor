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

import { ActiveHooks, type Collider, QueryFilterFlags } from '@dimforge/rapier3d-compat';
import { Quaternion as ThreeQuaternion, Vector3 as ThreeVector3, type Object3D } from 'three';
import {
  godot_collision_object_body,
  godot_collision_object_colliders,
  godot_collision_object_layers,
  godot_collision_object_of_collider,
  godot_physics_world,
} from './collision-object-3d';
import { godot_kinematic_collision_3d_new, type KinematicCollision3D } from './kinematic-collision-3d';
import { construct as vector3, type Vector3 } from './vector3';
import { godot_node_entity, godot_node_object } from './node';
import { set_global_position } from './node-3d';

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

/**
 * Moves the body along `motion` until its shape meets another (`PhysicsBody3D::_move`,
 * `physics_body_3d.cpp:87`): Rapier sweeps its first collider (`castShape`) through what its mask
 * takes, bodies only, never itself nor its exceptions; the body goes to where the sweep stops (not
 * with `test_only`), and the collision is returned with the motion made and left, or null where
 * nothing is met. Godot's recovery from a start inside another shape is Rapier's: a sweep already
 * touching stops at once.
 *
 * @godot PhysicsBody3D.move_and_collide
 * @source scene/3d/physics/physics_body_3d.cpp:87
 */
export function move_and_collide(self: object, motion: Vector3, test_only = false, safe_margin = 0.001): KinematicCollision3D | null {
  const entity = godot_node_entity(self);
  const body = godot_collision_object_body(entity);
  const world = godot_physics_world();
  const collider = body !== undefined && body.numColliders() > 0 ? body.collider(0) : undefined;
  if (body === undefined || world === undefined || collider === undefined) return null;
  const own = godot_collision_object_layers(entity);
  const admits = (other: Collider): boolean => {
    if (other.parent()?.handle === body.handle) return false;
    const node = godot_collision_object_of_collider(other);
    return node !== undefined && (own.mask & godot_collision_object_layers(node).layer) !== 0 && godot_physics_body_3d_collides(entity, node);
  };
  const hit = world.castShape(collider.translation(), collider.rotation(), motion, collider.shape, safe_margin, 1, true, QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, undefined, admits);
  const fraction = hit === null ? 1 : hit.time_of_impact;
  const travel = vector3(motion.x * fraction, motion.y * fraction, motion.z * fraction);
  if (!test_only) {
    const from = body.translation();
    const to = vector3(from.x + travel.x, from.y + travel.y, from.z + travel.z);
    if (body.isKinematic()) body.setNextKinematicTranslation(to);
    else body.setTranslation(to, true);
    set_global_position(entity as Object3D, to);
  }
  if (hit === null) return null;
  // The witness and normal on the shape met, from its space into the world's.
  const place = hit.collider.translation();
  const turn = hit.collider.rotation();
  const quaternion = new ThreeQuaternion(turn.x, turn.y, turn.z, turn.w);
  const point = new ThreeVector3(hit.witness2.x, hit.witness2.y, hit.witness2.z).applyQuaternion(quaternion).add(new ThreeVector3(place.x, place.y, place.z));
  const normal = new ThreeVector3(hit.normal2.x, hit.normal2.y, hit.normal2.z).applyQuaternion(quaternion);
  const other = godot_collision_object_of_collider(hit.collider);
  return godot_kinematic_collision_3d_new({
    hits: [{ collider: other === undefined ? null : godot_node_object(other), normal: vector3(normal.x, normal.y, normal.z), position: vector3(point.x, point.y, point.z) }],
    travel,
    remainder: vector3(motion.x - travel.x, motion.y - travel.y, motion.z - travel.z),
  });
}
