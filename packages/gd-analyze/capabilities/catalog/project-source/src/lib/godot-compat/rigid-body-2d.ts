/**
 * @godot-class RigidBody2D
 * @role BINDING
 *
 * Godot 4.7's `RigidBody2D` (`scene/2d/physics/rigid_body_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) stepped by the page each physics step
 * (`GodotBody2D::integrate_forces`, `godot_body_2d.cpp:540`): gravity times `gravity_scale` and the
 * forces applied accelerate it, damping slows it, it moves and turns by its velocities, and a
 * contact with another body pushes it out along the normal, its velocity into the contact removed
 * and bounced by its physics material. With `contact_monitor`, `body_entered` and `body_exited`
 * report its contacts. Frozen, it stays where it is.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_collision_object_2d_mount, godot_physics_2d_contacts, godot_physics_2d_kind, set_collision_layer, set_collision_mask } from './collision-object-2d';
import { get_global_position, get_rotation, godot_node_2d_mount, godot_node_2d_props, set_global_position, set_rotation } from './node-2d';
import { godot_node_adopt, godot_node_entity, godot_node_object, godot_node_set_internal_physics } from './node';
import { godot_physics_2d_gravity } from './physics-body-2d';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['RigidBody2D', 'PhysicsBody2D', 'CollisionObject2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

interface RigidState {
  linearVelocity: Vector2;
  angularVelocity: number;
  gravityScale: number;
  mass: number;
  linearDamp: number;
  angularDamp: number;
  freeze: boolean;
  lockRotation: boolean;
  bounce: number;
  force: Vector2;
  torque: number;
  contactMonitor: boolean;
  maxContacts: number;
  readonly contacts: Set<Object3D>;
  readonly bodyEntered: SignalHandle<[object]>;
  readonly bodyExited: SignalHandle<[object]>;
}

const BODIES = new WeakMap<object, RigidState>();

function stateOf(self: object, member: string): RigidState {
  const state = BODIES.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a RigidBody2D`);
  return state;
}

/** One physics step of the body. */
function step(entity: Object3D, state: RigidState, delta: number): void {
  if (state.freeze) return;
  const gravity = godot_physics_2d_gravity();
  const damp = Math.max(0, 1 - state.linearDamp * delta);
  let vx = (state.linearVelocity.x + (gravity.x * state.gravityScale + state.force.x / state.mass) * delta) * damp;
  let vy = (state.linearVelocity.y + (gravity.y * state.gravityScale + state.force.y / state.mass) * delta) * damp;
  const angular = state.lockRotation ? 0 : (state.angularVelocity + (state.torque / state.mass) * delta) * Math.max(0, 1 - state.angularDamp * delta);
  const at = get_global_position(entity);
  set_global_position(entity, vector2(at.x + vx * delta, at.y + vy * delta));
  if (angular !== 0) set_rotation(entity, get_rotation(entity) + angular * delta);
  const touching = new Set<Object3D>();
  for (const contact of godot_physics_2d_contacts(entity)) {
    touching.add(contact.other);
    // Another rigid body takes half the push; a static, kinematic or character body none.
    const share = godot_physics_2d_kind(contact.other) === 'rigid' ? 0.5 : 1;
    const [nx, ny] = contact.normal;
    const now = get_global_position(entity);
    set_global_position(entity, vector2(now.x + nx * contact.depth * share, now.y + ny * contact.depth * share));
    const into = vx * nx + vy * ny;
    if (into < 0) {
      vx -= (1 + state.bounce) * into * nx;
      vy -= (1 + state.bounce) * into * ny;
    }
  }
  state.linearVelocity = vector2(vx, vy);
  state.angularVelocity = angular;
  if (!state.contactMonitor || state.maxContacts <= 0) return;
  for (const other of [...state.contacts]) {
    if (touching.has(other)) continue;
    state.contacts.delete(other);
    state.bodyExited.emit(godot_node_object(other));
  }
  for (const other of touching) {
    if (state.contacts.has(other) || state.contacts.size >= state.maxContacts) continue;
    state.contacts.add(other);
    state.bodyEntered.emit(godot_node_object(other));
  }
}

/**
 * Makes `entity` a RigidBody2D, stepped each physics step (`RigidBody2D::RigidBody2D`,
 * `rigid_body_2d.cpp:872`).
 *
 * @godot RigidBody2D (protocol)
 * @source scene/2d/physics/rigid_body_2d.cpp:872
 */
export function godot_rigid_body_2d_mount(entity: Object3D): void {
  const state: RigidState = {
    linearVelocity: vector2(),
    angularVelocity: 0,
    gravityScale: 1,
    mass: 1,
    linearDamp: 0,
    angularDamp: 0,
    freeze: false,
    lockRotation: false,
    bounce: 0,
    force: vector2(),
    torque: 0,
    contactMonitor: false,
    maxContacts: 0,
    contacts: new Set(),
    bodyEntered: createSignal<[object]>(),
    bodyExited: createSignal<[object]>(),
  };
  BODIES.set(entity, state);
  godot_node_2d_mount(entity, CLASSES);
  godot_collision_object_2d_mount(entity, 'rigid', false);
  godot_node_set_internal_physics(entity, (delta) => step(entity, state, delta));
}

/**
 * @godot RigidBody2D.RigidBody2D
 * @source scene/2d/physics/rigid_body_2d.cpp:872
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_rigid_body_2d_mount(entity);
  return entity;
}

/**
 * @godot RigidBody2D.set_linear_velocity
 * @source scene/2d/physics/rigid_body_2d.cpp:449
 */
export function set_linear_velocity(self: object, velocity: Vector2): void {
  stateOf(self, 'set_linear_velocity').linearVelocity = velocity;
}

/**
 * @godot RigidBody2D.get_linear_velocity
 * @source scene/2d/physics/rigid_body_2d.cpp:458
 */
export function get_linear_velocity(self: object): Vector2 {
  return stateOf(self, 'get_linear_velocity').linearVelocity;
}

/**
 * @godot RigidBody2D.set_angular_velocity
 * @source scene/2d/physics/rigid_body_2d.cpp:462
 */
export function set_angular_velocity(self: object, velocity: number): void {
  stateOf(self, 'set_angular_velocity').angularVelocity = velocity;
}

/**
 * @godot RigidBody2D.get_angular_velocity
 * @source scene/2d/physics/rigid_body_2d.cpp:471
 */
export function get_angular_velocity(self: object): number {
  return stateOf(self, 'get_angular_velocity').angularVelocity;
}

/**
 * @godot RigidBody2D.set_gravity_scale
 * @source scene/2d/physics/rigid_body_2d.cpp:363
 */
export function set_gravity_scale(self: object, scale: number): void {
  stateOf(self, 'set_gravity_scale').gravityScale = scale;
}

/**
 * @godot RigidBody2D.get_gravity_scale
 * @source scene/2d/physics/rigid_body_2d.cpp:368
 */
export function get_gravity_scale(self: object): number {
  return stateOf(self, 'get_gravity_scale').gravityScale;
}

/**
 * A mass of 0 or less fails.
 *
 * @godot RigidBody2D.set_mass
 * @source scene/2d/physics/rigid_body_2d.cpp:303
 */
export function set_mass(self: object, mass: number): void {
  if (mass > 0) stateOf(self, 'set_mass').mass = mass;
}

/**
 * @godot RigidBody2D.get_mass
 * @source scene/2d/physics/rigid_body_2d.cpp:309
 */
export function get_mass(self: object): number {
  return stateOf(self, 'get_mass').mass;
}

/**
 * @godot RigidBody2D.set_linear_damp
 * @source scene/2d/physics/rigid_body_2d.cpp:386
 */
export function set_linear_damp(self: object, damp: number): void {
  stateOf(self, 'set_linear_damp').linearDamp = damp;
}

/**
 * @godot RigidBody2D.set_angular_damp
 * @source scene/2d/physics/rigid_body_2d.cpp:406
 */
export function set_angular_damp(self: object, damp: number): void {
  stateOf(self, 'set_angular_damp').angularDamp = damp;
}

/**
 * @godot RigidBody2D.set_freeze_enabled
 * @source scene/2d/physics/rigid_body_2d.cpp:264
 */
export function set_freeze_enabled(self: object, freeze: boolean): void {
  stateOf(self, 'set_freeze_enabled').freeze = freeze;
}

/**
 * @godot RigidBody2D.is_freeze_enabled
 * @source scene/2d/physics/rigid_body_2d.cpp:275
 */
export function is_freeze_enabled(self: object): boolean {
  return stateOf(self, 'is_freeze_enabled').freeze;
}

/**
 * @godot RigidBody2D.set_lock_rotation_enabled
 * @source scene/2d/physics/rigid_body_2d.cpp:253
 */
export function set_lock_rotation_enabled(self: object, lock: boolean): void {
  stateOf(self, 'set_lock_rotation_enabled').lockRotation = lock;
}

/**
 * @godot RigidBody2D.set_contact_monitor
 * @source scene/2d/physics/rigid_body_2d.cpp:595
 */
export function set_contact_monitor(self: object, enabled: boolean): void {
  stateOf(self, 'set_contact_monitor').contactMonitor = enabled;
}

/**
 * @godot RigidBody2D.set_max_contacts_reported
 * @source scene/2d/physics/rigid_body_2d.cpp:579
 */
export function set_max_contacts_reported(self: object, amount: number): void {
  stateOf(self, 'set_max_contacts_reported').maxContacts = amount;
}

/**
 * @godot RigidBody2D.get_colliding_bodies
 * @source scene/2d/physics/rigid_body_2d.cpp:622
 */
export function get_colliding_bodies(self: object): object[] {
  return [...stateOf(self, 'get_colliding_bodies').contacts].map((other) => godot_node_object(other));
}

/**
 * @godot RigidBody2D.apply_central_impulse
 * @source scene/2d/physics/rigid_body_2d.cpp:508
 */
export function apply_central_impulse(self: object, impulse: Vector2 = vector2()): void {
  const state = stateOf(self, 'apply_central_impulse');
  state.linearVelocity = vector2(state.linearVelocity.x + impulse.x / state.mass, state.linearVelocity.y + impulse.y / state.mass);
}

/**
 * @godot RigidBody2D.apply_impulse
 * @source scene/2d/physics/rigid_body_2d.cpp:512
 */
export function apply_impulse(self: object, impulse: Vector2, position: Vector2 = vector2()): void {
  apply_central_impulse(self, impulse);
  const state = stateOf(self, 'apply_impulse');
  state.angularVelocity += (position.x * impulse.y - position.y * impulse.x) / state.mass;
}

/**
 * @godot RigidBody2D.apply_central_force
 * @source scene/2d/physics/rigid_body_2d.cpp:524
 */
export function apply_central_force(self: object, force: Vector2): void {
  const state = stateOf(self, 'apply_central_force');
  state.linearVelocity = vector2(state.linearVelocity.x + force.x / state.mass / 60, state.linearVelocity.y + force.y / state.mass / 60);
}

/**
 * @godot RigidBody2D.add_constant_central_force
 * @source scene/2d/physics/rigid_body_2d.cpp:540
 */
export function add_constant_central_force(self: object, force: Vector2): void {
  const state = stateOf(self, 'add_constant_central_force');
  state.force = vector2(state.force.x + force.x, state.force.y + force.y);
}

/**
 * @godot RigidBody2D.set_constant_force
 * @source scene/2d/physics/rigid_body_2d.cpp:552
 */
export function set_constant_force(self: object, force: Vector2): void {
  stateOf(self, 'set_constant_force').force = force;
}

/**
 * @godot RigidBody2D.set_constant_torque
 * @source scene/2d/physics/rigid_body_2d.cpp:560
 */
export function set_constant_torque(self: object, torque: number): void {
  stateOf(self, 'set_constant_torque').torque = torque;
}

/**
 * @godot RigidBody2D.body_entered
 * @source scene/2d/physics/rigid_body_2d.cpp:844
 */
export function body_entered(self: object): GodotSignal<[object]> {
  return stateOf(self, 'body_entered').bodyEntered.signal;
}

/**
 * @godot RigidBody2D.body_exited
 * @source scene/2d/physics/rigid_body_2d.cpp:845
 */
export function body_exited(self: object): GodotSignal<[object]> {
  return stateOf(self, 'body_exited').bodyExited.signal;
}

const RIGID_BODY_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_rigid_body_2d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['collisionLayer', (entity, value: number) => set_collision_layer(entity, value)],
    ['collisionMask', (entity, value: number) => set_collision_mask(entity, value)],
    ['gravityScale', (entity, value: number) => set_gravity_scale(entity, value)],
    ['mass', (entity, value: number) => set_mass(entity, value)],
    ['linearVelocity', (entity, value: readonly [number, number]) => set_linear_velocity(entity, vector2(...value))],
    ['angularVelocity', (entity, value: number) => set_angular_velocity(entity, value)],
    ['linearDamp', (entity, value: number) => set_linear_damp(entity, value)],
    ['angularDamp', (entity, value: number) => set_angular_damp(entity, value)],
    ['freeze', (entity, value: boolean) => set_freeze_enabled(entity, value)],
    ['lockRotation', (entity, value: boolean) => set_lock_rotation_enabled(entity, value)],
    ['contactMonitor', (entity, value: boolean) => set_contact_monitor(entity, value)],
    ['maxContactsReported', (entity, value: number) => set_max_contacts_reported(entity, value)],
    ['physicsMaterialOverride', () => undefined],
    ['canSleep', () => undefined],
  ]),
};

/**
 * A RigidBody2D as a scene writes it: `<GodotRigidBody2D gravityScale={0} />`.
 *
 * @godot RigidBody2D (protocol)
 * @source scene/2d/physics/rigid_body_2d.cpp:872
 */
export function GodotRigidBody2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(RIGID_BODY_2D, props);
}
