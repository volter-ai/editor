/**
 * @godot-class PhysicsDirectBodyState3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsDirectBodyState3D` as GodotPhysics3D implements it
 * (`modules/godot_physics_3d/godot_body_direct_state_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a view of one rigid body's server state, which
 * `rigid-body-3d.ts` keeps over its Rapier body and hands to `_integrate_forces`. Setting a
 * velocity wakes the body and reaches the Rapier body before the next step.
 */

import type { Transform3D } from './transform-3d';
import { construct as vector3, type Vector3 } from './vector3';

/** One contact the body reported in the last step (`GodotBody3D::Contact`, `godot_body_3d.h:118`). */
export interface BodyContact {
  readonly local_pos: Vector3;
  readonly local_normal: Vector3;
  readonly depth: number;
  readonly local_shape: number;
  readonly collider: object;
  readonly collider_shape: number;
}

/** The body server state the view reads and writes. */
export interface BodyServerState {
  linear_velocity: Vector3;
  angular_velocity: Vector3;
  gravity: Vector3;
  step: number;
  contacts: BodyContact[];
  readonly transform: () => Transform3D;
  readonly wakeup: () => void;
  readonly object: (rid: object) => object;
}

export interface PhysicsDirectBodyState3D {
  readonly server: BodyServerState;
}

/**
 * The direct state of a body's server state.
 *
 * @godot PhysicsDirectBodyState3D (protocol)
 * @source modules/godot_physics_3d/godot_body_3d.cpp:819
 */
export function godot_direct_body_state(server: BodyServerState): PhysicsDirectBodyState3D {
  return Object.freeze({ server });
}

function contact(self: PhysicsDirectBodyState3D, index: number): BodyContact | undefined {
  return index >= 0 && index < self.server.contacts.length ? self.server.contacts[index] : undefined;
}

/**
 * The space's last step.
 *
 * @godot PhysicsDirectBodyState3D.get_step
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:251
 */
export function get_step(self: PhysicsDirectBodyState3D): number {
  return self.server.step;
}

/**
 * @godot PhysicsDirectBodyState3D.get_total_gravity
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:36
 */
export function get_total_gravity(self: PhysicsDirectBodyState3D): Vector3 {
  return self.server.gravity;
}

/**
 * @godot PhysicsDirectBodyState3D.get_linear_velocity
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:77
 */
export function get_linear_velocity(self: PhysicsDirectBodyState3D): Vector3 {
  return self.server.linear_velocity;
}

/**
 * Wakes the body.
 *
 * @godot PhysicsDirectBodyState3D.set_linear_velocity
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:72
 */
export function set_linear_velocity(self: PhysicsDirectBodyState3D, velocity: Vector3): void {
  self.server.wakeup();
  self.server.linear_velocity = vector3(velocity);
}

/**
 * @godot PhysicsDirectBodyState3D.get_angular_velocity
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:86
 */
export function get_angular_velocity(self: PhysicsDirectBodyState3D): Vector3 {
  return self.server.angular_velocity;
}

/**
 * Wakes the body.
 *
 * @godot PhysicsDirectBodyState3D.set_angular_velocity
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:81
 */
export function set_angular_velocity(self: PhysicsDirectBodyState3D, velocity: Vector3): void {
  self.server.wakeup();
  self.server.angular_velocity = vector3(velocity);
}

/**
 * @godot PhysicsDirectBodyState3D.get_transform
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:94
 */
export function get_transform(self: PhysicsDirectBodyState3D): Transform3D {
  return self.server.transform();
}

/**
 * @godot PhysicsDirectBodyState3D.get_contact_count
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:193
 */
export function get_contact_count(self: PhysicsDirectBodyState3D): number {
  return self.server.contacts.length;
}

/**
 * An index outside the contacts fails with (0, 0, 0).
 *
 * @godot PhysicsDirectBodyState3D.get_contact_local_position
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:197
 */
export function get_contact_local_position(self: PhysicsDirectBodyState3D, contact_idx: number): Vector3 {
  return contact(self, contact_idx)?.local_pos ?? vector3();
}

/**
 * An index outside the contacts fails with (0, 0, 0).
 *
 * @godot PhysicsDirectBodyState3D.get_contact_local_normal
 * @source modules/godot_physics_3d/godot_body_direct_state_3d.cpp:202
 */
export function get_contact_local_normal(self: PhysicsDirectBodyState3D, contact_idx: number): Vector3 {
  return contact(self, contact_idx)?.local_normal ?? vector3();
}

/**
 * The collider's object; an index outside the contacts fails with null.
 *
 * @godot PhysicsDirectBodyState3D.get_contact_collider_object
 * @source servers/physics_3d/physics_server_3d.cpp:85
 */
export function get_contact_collider_object(self: PhysicsDirectBodyState3D, contact_idx: number): object | null {
  const found = contact(self, contact_idx);
  return found === undefined ? null : self.server.object(found.collider);
}
