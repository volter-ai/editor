/**
 * @godot-class RigidBody3D
 * @role BINDING
 *
 * Godot 4.7's `RigidBody3D` (`scene/3d/physics/rigid_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a dynamic @react-three/rapier body: Rapier
 * integrates it, with `<Physics>`'s gravity times its gravity scale and its own damping, and solves
 * its contacts. A custom integrator turns both off (gravity scale and damping 0), leaving the
 * velocity to the script's `_integrate_forces`, which the body's component runs from its own
 * `useBeforePhysicsStep` through `godot_rigid_body_3d_integrate`: the body's state, as
 * `PhysicsDirectBodyState3D` views it, with its contacts from Rapier's contact pairs when it reports
 * contacts; what the script sets reaches the body before the step. The body's settings are its
 * node's `userData`'s, then its setters'.
 */

import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import { godot_collision_object_body, godot_collision_object_node, godot_collision_object_of_collider, godot_physics_world } from './collision-object-3d';
import { godot_node_entity } from './node';
import { type BodyContact, type BodyServerState, godot_direct_body_state, type PhysicsDirectBodyState3D } from './physics-direct-body-state-3d';
import { godot_physics_material_computed, godot_physics_material_of, type PhysicsMaterial } from './physics-material';
import { construct as basis } from './basis';
import { construct as transform3d, type Transform3D } from './transform-3d';
import { construct as vector3, op_multiply, type Vector3 } from './vector3';

const f32 = Math.fround;

interface RigidState {
  mass: number;
  gravity_scale: number;
  linear_damp: number;
  angular_damp: number;
  linear_damp_mode: number;
  angular_damp_mode: number;
  continuous_cd: boolean;
  custom_integrator: boolean;
  contact_monitor: boolean;
  max_contacts_reported: number;
  contact_count: number;
  lock_rotation: boolean;
  material: PhysicsMaterial | null;
}

const RIGID = new WeakMap<object, RigidState>();

/** A rigid body's settings, made with Godot's defaults and its node's `userData` when first asked for. */
function stateOf(object: object): RigidState {
  const entity = godot_node_entity(object);
  let state = RIGID.get(entity);
  if (state === undefined) {
    const data = ((entity as Object3D).userData ?? {}) as Readonly<Record<string, unknown>>;
    // The values the scene authored are the body's own props (`gravityScale`, `linearDamping`, …).
    const body = godot_collision_object_body(entity);
    state = {
      mass: data['mass'] === undefined ? 1 : f32(Number(data['mass'])),
      gravity_scale: body === undefined ? 1 : f32(body.gravityScale()),
      linear_damp: body === undefined ? 0 : f32(body.linearDamping()),
      angular_damp: body === undefined ? 0 : f32(body.angularDamping()),
      linear_damp_mode: data['linear_damp_mode'] === undefined ? 0 : Number(data['linear_damp_mode']),
      angular_damp_mode: data['angular_damp_mode'] === undefined ? 0 : Number(data['angular_damp_mode']),
      continuous_cd: body?.isCcdEnabled() ?? false,
      custom_integrator: data['custom_integrator'] === true,
      contact_monitor: data['contact_monitor'] === true,
      max_contacts_reported: data['max_contacts_reported'] === undefined ? 0 : Number(data['max_contacts_reported']) | 0,
      contact_count: 0,
      lock_rotation: false,
      material: data['physics_material_override'] === undefined ? null : godot_physics_material_of(data['physics_material_override'] as Readonly<Record<string, unknown>>),
    };
    RIGID.set(entity, state);
    apply(entity, state);
  }
  return state;
}

/** The settings Rapier holds, on the node's body. */
function apply(entity: object, state: RigidState): void {
  const body = godot_collision_object_body(entity);
  if (body === undefined) return;
  body.setGravityScale(state.custom_integrator ? 0 : state.gravity_scale, true);
  body.setLinearDamping(state.custom_integrator ? 0 : state.linear_damp);
  body.setAngularDamping(state.custom_integrator ? 0 : state.angular_damp);
  body.enableCcd(state.continuous_cd);
  body.lockRotations(state.lock_rotation, true);
  if (state.material !== null) {
    const { friction, bounce } = godot_physics_material_computed(state.material);
    for (let index = 0; index < body.numColliders(); index += 1) {
      const collider = body.collider(index);
      collider.setFriction(friction);
      collider.setRestitution(bounce);
    }
  }
}

function bodyOf(object: object): RigidBody | undefined {
  return godot_collision_object_body(object);
}

function toVector(v: { readonly x: number; readonly y: number; readonly z: number }): Vector3 {
  return vector3(v.x, v.y, v.z);
}

/** The body's contacts this step, from Rapier's contact pairs, at most `limit`. */
function contactsOf(body: RigidBody, limit: number): BodyContact[] {
  const world = godot_physics_world();
  const contacts: BodyContact[] = [];
  if (world === undefined || limit <= 0) return contacts;
  for (let index = 0; index < body.numColliders() && contacts.length < limit; index += 1) {
    const own: Collider = body.collider(index);
    world.contactPairsWith(own, (other: Collider) => {
      if (contacts.length >= limit) return;
      const collider = godot_collision_object_of_collider(other);
      if (collider === undefined) return;
      world.contactPair(own, other, (manifold, flipped) => {
        if (contacts.length >= limit || manifold.numContacts() === 0) return;
        const n = manifold.normal();
        const sign = flipped ? 1 : -1;
        const point = manifold.localContactPoint1(0) ?? { x: 0, y: 0, z: 0 };
        contacts.push({
          local_pos: vector3(point.x, point.y, point.z),
          local_normal: vector3(sign * n.x, sign * n.y, sign * n.z),
          depth: -manifold.contactDist(0),
          local_shape: index,
          collider,
          collider_shape: 0,
        });
      });
    });
  }
  return contacts;
}

/**
 * Runs `integrate` with the body's direct state (the script's `_integrate_forces`), then hands what
 * it set to the body. Called from the body's component in `useBeforePhysicsStep`.
 *
 * @godot RigidBody3D (protocol)
 * @source scene/3d/physics/rigid_body_3d.cpp:170
 */
export function godot_rigid_body_3d_integrate(object: object | null, integrate: (state: PhysicsDirectBodyState3D) => void): void {
  if (object === null) return;
  // The component's ref holds the Rapier body; its node is the collision object.
  const entity = godot_collision_object_node(object) ?? godot_node_entity(object);
  const body = bodyOf(entity);
  const world = godot_physics_world();
  if (body === undefined || world === undefined) return;
  const state = stateOf(entity);
  const g = world.gravity;
  const server: BodyServerState = {
    linear_velocity: toVector(body.linvel()),
    angular_velocity: toVector(body.angvel()),
    gravity: op_multiply(vector3(g.x, g.y, g.z), state.gravity_scale),
    step: world.timestep,
    contacts: state.contact_monitor ? contactsOf(body, state.max_contacts_reported) : [],
    transform: (): Transform3D => {
      const p = body.translation();
      const q = body.rotation();
      return transform3d(basis(...quaternionBasis(q)), vector3(p.x, p.y, p.z));
    },
    wakeup: () => body.wakeUp(),
    object: (rid) => rid,
  };
  state.contact_count = server.contacts.length;
  integrate(godot_direct_body_state(server));
  body.setLinvel(server.linear_velocity, true);
  body.setAngvel(server.angular_velocity, true);
}

/** A unit quaternion's rotation as a Basis's rows. */
function quaternionBasis(q: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }) {
  const { x, y, z, w } = q;
  return [
    vector3(1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)),
    vector3(2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)),
    vector3(2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)),
  ] as const;
}

/**
 * @godot RigidBody3D.set_mass
 * @source scene/3d/physics/rigid_body_3d.cpp:341
 */
export function set_mass(self: object, mass: number): void {
  stateOf(self).mass = f32(mass);
}

/**
 * @godot RigidBody3D.get_mass
 * @source scene/3d/physics/rigid_body_3d.cpp:347
 */
export function get_mass(self: object): number {
  return stateOf(self).mass;
}

/**
 * @godot RigidBody3D.set_gravity_scale
 * @source scene/3d/physics/rigid_body_3d.cpp:424
 */
export function set_gravity_scale(self: object, gravity_scale: number): void {
  const state = stateOf(self);
  state.gravity_scale = f32(gravity_scale);
  apply(godot_node_entity(self), state);
}

/**
 * @godot RigidBody3D.get_gravity_scale
 * @source scene/3d/physics/rigid_body_3d.cpp:429
 */
export function get_gravity_scale(self: object): number {
  return stateOf(self).gravity_scale;
}

/**
 * @godot RigidBody3D.set_linear_damp
 * @source scene/3d/physics/rigid_body_3d.cpp:451
 */
export function set_linear_damp(self: object, linear_damp: number): void {
  const state = stateOf(self);
  state.linear_damp = f32(linear_damp);
  apply(godot_node_entity(self), state);
}

/**
 * @godot RigidBody3D.get_linear_damp
 * @source scene/3d/physics/rigid_body_3d.cpp:457
 */
export function get_linear_damp(self: object): number {
  return stateOf(self).linear_damp;
}

/**
 * @godot RigidBody3D.set_angular_damp
 * @source scene/3d/physics/rigid_body_3d.cpp:461
 */
export function set_angular_damp(self: object, angular_damp: number): void {
  const state = stateOf(self);
  state.angular_damp = f32(angular_damp);
  apply(godot_node_entity(self), state);
}

/**
 * @godot RigidBody3D.get_angular_damp
 * @source scene/3d/physics/rigid_body_3d.cpp:467
 */
export function get_angular_damp(self: object): number {
  return stateOf(self).angular_damp;
}

/**
 * Stored: a damp mode says how an area's damping combines with the body's, and the scene writes
 * no damping areas, so the body's own damping is what Rapier applies either way.
 *
 * @godot RigidBody3D.set_linear_damp_mode
 * @source scene/3d/physics/rigid_body_3d.cpp:433
 */
export function set_linear_damp_mode(self: object, mode: number): void {
  stateOf(self).linear_damp_mode = mode;
}

/**
 * @godot RigidBody3D.get_linear_damp_mode
 * @source scene/3d/physics/rigid_body_3d.cpp:438
 */
export function get_linear_damp_mode(self: object): number {
  return stateOf(self).linear_damp_mode;
}

/**
 * Stored, as the linear mode is.
 *
 * @godot RigidBody3D.set_angular_damp_mode
 * @source scene/3d/physics/rigid_body_3d.cpp:442
 */
export function set_angular_damp_mode(self: object, mode: number): void {
  stateOf(self).angular_damp_mode = mode;
}

/**
 * @godot RigidBody3D.get_angular_damp_mode
 * @source scene/3d/physics/rigid_body_3d.cpp:447
 */
export function get_angular_damp_mode(self: object): number {
  return stateOf(self).angular_damp_mode;
}

/**
 * Rapier's continuous collision detection on the body.
 *
 * @godot RigidBody3D.set_use_continuous_collision_detection
 * @source scene/3d/physics/rigid_body_3d.cpp:600
 */
export function set_use_continuous_collision_detection(self: object, enable: boolean): void {
  const state = stateOf(self);
  state.continuous_cd = Boolean(enable);
  apply(godot_node_entity(self), state);
}

/**
 * @godot RigidBody3D.is_using_continuous_collision_detection
 * @source scene/3d/physics/rigid_body_3d.cpp:605
 */
export function is_using_continuous_collision_detection(self: object): boolean {
  return stateOf(self).continuous_cd;
}

/**
 * @godot RigidBody3D.set_linear_velocity
 * @source scene/3d/physics/rigid_body_3d.cpp:478
 */
export function set_linear_velocity(self: object, linear_velocity: Vector3): void {
  stateOf(self);
  bodyOf(self)?.setLinvel(linear_velocity, true);
}

/**
 * @godot RigidBody3D.get_linear_velocity
 * @source scene/3d/physics/rigid_body_3d.cpp:483
 */
export function get_linear_velocity(self: object): Vector3 {
  const body = bodyOf(self);
  return body === undefined ? vector3() : toVector(body.linvel());
}

/**
 * @godot RigidBody3D.set_angular_velocity
 * @source scene/3d/physics/rigid_body_3d.cpp:487
 */
export function set_angular_velocity(self: object, angular_velocity: Vector3): void {
  stateOf(self);
  bodyOf(self)?.setAngvel(angular_velocity, true);
}

/**
 * @godot RigidBody3D.get_angular_velocity
 * @source scene/3d/physics/rigid_body_3d.cpp:492
 */
export function get_angular_velocity(self: object): Vector3 {
  const body = bodyOf(self);
  return body === undefined ? vector3() : toVector(body.angvel());
}

/**
 * @godot RigidBody3D.set_use_custom_integrator
 * @source scene/3d/physics/rigid_body_3d.cpp:500
 */
export function set_use_custom_integrator(self: object, enable: boolean): void {
  const state = stateOf(self);
  state.custom_integrator = enable;
  apply(godot_node_entity(self), state);
}

/**
 * @godot RigidBody3D.is_using_custom_integrator
 * @source scene/3d/physics/rigid_body_3d.cpp:508
 */
export function is_using_custom_integrator(self: object): boolean {
  return stateOf(self).custom_integrator;
}

/**
 * @godot RigidBody3D.set_max_contacts_reported
 * @source scene/3d/physics/rigid_body_3d.cpp:531
 */
export function set_max_contacts_reported(self: object, amount: number): void {
  stateOf(self).max_contacts_reported = amount | 0;
}

/**
 * @godot RigidBody3D.get_max_contacts_reported
 * @source scene/3d/physics/rigid_body_3d.cpp:537
 */
export function get_max_contacts_reported(self: object): number {
  return stateOf(self).max_contacts_reported;
}

/**
 * @godot RigidBody3D.get_contact_count
 * @source scene/3d/physics/rigid_body_3d.cpp:541
 */
export function get_contact_count(self: object): number {
  return stateOf(self).contact_count;
}

/**
 * @godot RigidBody3D.set_contact_monitor
 * @source scene/3d/physics/rigid_body_3d.cpp:609
 */
export function set_contact_monitor(self: object, enabled: boolean): void {
  stateOf(self).contact_monitor = enabled;
}

/**
 * @godot RigidBody3D.is_contact_monitor_enabled
 * @source scene/3d/physics/rigid_body_3d.cpp:638
 */
export function is_contact_monitor_enabled(self: object): boolean {
  return stateOf(self).contact_monitor;
}

/**
 * @godot RigidBody3D.apply_central_impulse
 * @source scene/3d/physics/rigid_body_3d.cpp:545
 */
export function apply_central_impulse(self: object, impulse: Vector3): void {
  stateOf(self);
  bodyOf(self)?.applyImpulse(impulse, true);
}

/**
 * @godot RigidBody3D.set_lock_rotation_enabled
 * @source scene/3d/physics/rigid_body_3d.cpp:302
 */
export function set_lock_rotation_enabled(self: object, lock_rotation: boolean): void {
  const state = stateOf(self);
  state.lock_rotation = lock_rotation;
  apply(godot_node_entity(self), state);
}

/**
 * @godot RigidBody3D.is_lock_rotation_enabled
 * @source scene/3d/physics/rigid_body_3d.cpp:311
 */
export function is_lock_rotation_enabled(self: object): boolean {
  return stateOf(self).lock_rotation;
}

/**
 * @godot RigidBody3D.set_physics_material_override
 * @source scene/3d/physics/rigid_body_3d.cpp:407
 */
export function set_physics_material_override(self: object, physics_material_override: PhysicsMaterial | null): void {
  const state = stateOf(self);
  state.material = physics_material_override;
  apply(godot_node_entity(self), state);
}

/**
 * @godot RigidBody3D.get_physics_material_override
 * @source scene/3d/physics/rigid_body_3d.cpp:420
 */
export function get_physics_material_override(self: object): PhysicsMaterial | null {
  return stateOf(self).material;
}
