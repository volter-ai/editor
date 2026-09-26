/**
 * @godot-class RigidBody3D
 * @role BINDING
 *
 * Godot 4.7's `RigidBody3D` (`scene/3d/physics/rigid_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a dynamic Rapier body (`collision-object-3d.ts`).
 * GodotPhysics3D's force integration is transcribed (`GodotBody3D::integrate_forces`,
 * `modules/godot_physics_3d/godot_body_3d.cpp:477`): each step the body's velocity is damped by the
 * space's default damping plus its own, then accelerated by the space's default gravity times its
 * gravity scale, in single precision, and handed to Rapier (whose own gravity and damping are off
 * for it); Rapier's step solves the contacts and moves the body, and the velocity and transform
 * are read back. A custom integrator skips the integration. A locked axis (`axis_lock_*`) has its
 * velocity zeroed before the solve, and Rapier holds it fixed through it. At the next `flush_queries` the body's
 * state callback (`_body_state_changed`, `rigid_body_3d.cpp:170`) runs the node's
 * `_integrate_forces` with its `PhysicsDirectBodyState3D`, then syncs the node's transform and
 * velocities; contacts are reported from Rapier's contact manifolds when `max_contacts_reported`
 * is positive.
 *
 * Bounded deviation: contact resolution (impulses, friction, restitution, stacking) and rotation
 * integration are Rapier's, not GodotPhysics3D's solver's; a body in free flight follows Godot's
 * integration to float32 rounding, a body in contact follows Rapier's solver, within the
 * `physics-trajectory` comparator's bound (0.1 in position and velocity, measured per claim) over the
 * cases' two seconds. Sleeping is
 * Rapier's. Area gravity and damping overrides are not transcribed.
 */

import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import {
  godot_collision_object_adopt,
  godot_collision_object_declarer,
  godot_collision_object_material,
  godot_collision_object_object,
  godot_collision_object_of_collider,
  godot_collision_object_locked_axes,
  godot_collision_object_state,
  godot_collision_object_moved,
  godot_collision_object_synced,
  godot_collision_objects,
} from './collision-object-3d';
import { godot_node_entity } from './node';
import { get_global_transform, set_global_transform } from './node-3d';
import { type BodyContact, type BodyServerState, godot_direct_body_state, type PhysicsDirectBodyState3D } from './physics-direct-body-state-3d';
import { godot_physics_body_3d_declared_locks } from './physics-body-3d';
import { godot_physics_material_of, type PhysicsMaterial } from './physics-material';
import { get_setting } from './project-settings';
import { type Basis, construct as basis, op_multiply as basisMultiply } from './basis';
import { construct as transform3d, op_multiply as transformMultiply, type Transform3D } from './transform-3d';
import { construct as vector3, dot, length, normalized, op_add, op_divide, op_multiply, op_subtract, type Vector3 } from './vector3';
import { godot_world_3d_physics_callbacks } from './world-3d';

const f32 = Math.fround;
/** `(real_t)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

interface RigidState {
  mass: number;
  gravity_scale: number;
  linear_damp: number;
  angular_damp: number;
  custom_integrator: boolean;
  contact_monitor: boolean;
  max_contacts_reported: number;
  lock_rotation: boolean;
  /** The node's copies, synced from the server (`_sync_body_state`, `rigid_body_3d.cpp:149`). */
  linear_velocity: Vector3;
  angular_velocity: Vector3;
  contact_count: number;
  readonly server: BodyServerState;
  readonly direct: PhysicsDirectBodyState3D;
  integrate: ((state: PhysicsDirectBodyState3D) => void) | undefined;
  /** Stepped since its last state callback (in the space's state query list). */
  stepped: boolean;
  material: PhysicsMaterial | null;
  /** `_inv_mass`, recomputed from the mass as each step starts (`GodotSpace3D::setup`). */
  inv_mass: number;
  /** Where the step started and the velocities it moved with, when it flies free of contacts. */
  before: { readonly transform: Transform3D; readonly velocity: Vector3; readonly angular: Vector3 } | undefined;
  /** The contacts to report for the step under way. */
  reporting: BodyContact[];
  awake: boolean;
}

const RIGID = new Map<object, RigidState>();

function stateOf(object: object, member: string): RigidState {
  const state = RIGID.get(godot_node_entity(object));
  if (state === undefined) throw new TypeError(`godot-compat: RigidBody3D.${member} requires a RigidBody3D.`);
  return state;
}

/** The space's default gravity and damping (`physics/3d/default_*`, `servers/physics_server_3d.cpp`). */
function spaceDefaults(): { gravity: Vector3; linear_damp: number; angular_damp: number } {
  const magnitude = f32(Number(get_setting('physics/3d/default_gravity', 9.8)));
  const direction = (get_setting('physics/3d/default_gravity_vector', null) as Vector3 | null) ?? vector3(0, -1, 0);
  return {
    // `GodotArea3D::compute_gravity`: `gravity_vector * gravity` (`godot_area_3d.cpp:321`).
    gravity: op_multiply(vector3(direction), magnitude),
    linear_damp: f32(Number(get_setting('physics/3d/default_linear_damp', 0.1))),
    angular_damp: f32(Number(get_setting('physics/3d/default_angular_damp', 0.1))),
  };
}

/** `GodotBody3D::integrate_forces` (`godot_body_3d.cpp:477`) and the velocities handed to Rapier. */
function integrateForces(world: World, delta: number): void {
  void world;
  const step = f32(delta);
  const defaults = spaceDefaults();
  for (const [entity, object] of godot_collision_objects()) {
    const state = RIGID.get(entity);
    const body = object.body;
    if (state === undefined || body === undefined) continue;
    state.server.step = step;
    // Mass properties changed since the last step are updated as this one sets up (`godot_space_3d.cpp:1180`).
    state.inv_mass = f32(1 / state.mass);
    if (!state.awake && body.isSleeping()) continue;
    const gravity = op_multiply(defaults.gravity, state.gravity_scale);
    state.server.gravity = gravity;
    if (!state.custom_integrator) {
      const total_linear_damp = f32(defaults.linear_damp + state.linear_damp);
      const total_angular_damp = f32(defaults.angular_damp + state.angular_damp);
      const force = op_multiply(gravity, state.mass);
      let damp = f32(1 - f32(step * total_linear_damp));
      if (damp < 0) damp = 0;
      let angular_damp_new = f32(1 - f32(step * total_angular_damp));
      if (angular_damp_new < 0) angular_damp_new = 0;
      const inv_mass = state.inv_mass;
      state.server.linear_velocity = op_add(op_multiply(state.server.linear_velocity, damp), op_multiply(op_multiply(force, inv_mass), step));
      state.server.angular_velocity = op_multiply(state.server.angular_velocity, angular_damp_new);
    }
    // `integrate_velocities` zeroes the velocity along each locked axis (`godot_body_3d.cpp:685`);
    // Rapier's step holds those axes fixed.
    const locked = godot_collision_object_locked_axes(entity);
    if (locked !== 0) {
      const lv = state.server.linear_velocity;
      const av = state.server.angular_velocity;
      state.server.linear_velocity = vector3(locked & 1 ? 0 : lv.x, locked & 2 ? 0 : lv.y, locked & 4 ? 0 : lv.z);
      state.server.angular_velocity = vector3(locked & 8 ? 0 : av.x, locked & 16 ? 0 : av.y, locked & 32 ? 0 : av.z);
    }
    // Rapier integrates the velocity Godot's integration gave it, with its own gravity and damping off.
    body.setGravityScale(0, false);
    body.setLinearDamping(0);
    body.setAngularDamping(0);
    body.setEnabledTranslations((locked & 1) === 0, (locked & 2) === 0, (locked & 4) === 0, false);
    if (state.lock_rotation) body.lockRotations(true, false);
    else body.setEnabledRotations((locked & 8) === 0, (locked & 16) === 0, (locked & 32) === 0, false);
    const colliders = object.colliders.map((entry) => entry.collider).filter((collider): collider is Collider => collider !== undefined);
    const volume = colliders.reduce((sum, collider) => sum + collider.volume(), 0);
    if (volume > 0) for (const collider of colliders) collider.setDensity(state.mass / volume);
    const v = state.server.linear_velocity;
    const w = state.server.angular_velocity;
    body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
    body.setAngvel({ x: w.x, y: w.y, z: w.z }, true);
    state.before = { transform: object.transform, velocity: v, angular: w };
    state.awake = false;
    state.stepped = true;
  }
}

/**
 * The contacts the body reports for this step, up to `max_contacts_reported`, the deepest kept
 * (`GodotBody3D::add_contact`, `godot_body_3d.cpp:352`), and whether any contact is solved this
 * step. GodotPhysics3D sets up its pairs from the poses before it integrates
 * (`godot_step_3d.cpp:225`); Rapier's step computes its contact graph from those same poses before
 * it solves, so the graph read once the step has run is this step's, placed on the body's
 * transform as the step began.
 */
function stepContacts(
  world: World,
  object: NonNullable<ReturnType<typeof godot_collision_object_state>>,
  state: RigidState,
  start: Transform3D,
): boolean {
  let solved = false;
  const contacts: BodyContact[] = [];
  {
      object.colliders.forEach((entry, local_shape) => {
        if (entry.collider === undefined) return;
        world.contactPairsWith(entry.collider, (other) => {
          const otherEntity = godot_collision_object_of_collider(other);
          if (otherEntity === undefined) return;
          const otherState = godot_collision_object_state(otherEntity);
          const collider_shape = otherState?.colliders.findIndex((candidate) => candidate.collider === other) ?? 0;
          world.contactPair(entry.collider as Collider, other, (manifold, flipped) => {
            if (manifold.numSolverContacts() > 0) solved = true;
            if (state.max_contacts_reported <= 0) return;
            const n = manifold.normal();
            // The manifold normal points from the first collider to the second; the body's is toward it.
            const toward = flipped ? vector3(n.x, n.y, n.z) : vector3(-n.x, -n.y, -n.z);
            for (let i = 0; i < manifold.numContacts(); i += 1) {
              const distance = manifold.contactDist(i);
              if (distance > 0) continue;
              const local = flipped ? manifold.localContactPoint2(i) : manifold.localContactPoint1(i);
              if (local === null) continue;
              const onBody = transformMultiply(transformMultiply(start, entry.local), vector3(local.x, local.y, local.z));
              const contact: BodyContact = { local_pos: onBody, local_normal: toward, depth: f32(-distance), local_shape, collider: otherEntity, collider_shape };
              if (contacts.length < state.max_contacts_reported) contacts.push(contact);
              else {
                let least = 0;
                contacts.forEach((c, index) => {
                  if (c.depth < (contacts[least] as BodyContact).depth) least = index;
                });
                if ((contacts[least] as BodyContact).depth < contact.depth) contacts[least] = contact;
              }
            }
          });
        });
      });
    }
  state.reporting = contacts;
  return solved;
}

/** `Basis::orthonormalize` (`core/math/basis.cpp:56`): Gram-Schmidt on the columns. */
function orthonormalized(b: Basis): Basis {
  const x = normalized(b.x);
  const y = normalized(op_subtract(b.y, op_multiply(x, dot(x, b.y))));
  const z = normalized(op_subtract(op_subtract(b.z, op_multiply(x, dot(x, b.z))), op_multiply(y, dot(y, b.z))));
  return basis(x, y, z);
}

/** The free-flight part of `GodotBody3D::integrate_velocities` (`godot_body_3d.cpp:712`). */
function integrateVelocities(from: Transform3D, linear: Vector3, angular: Vector3, step: number, com: { x: number; y: number; z: number }): Transform3D {
  let origin = from.origin;
  let turned = from.basis;
  const ang_vel = length(angular);
  if (Math.abs(ang_vel) >= CMP_EPSILON) {
    const axis = op_divide(angular, ang_vel);
    const rot = basis(axis, f32(ang_vel * step));
    const product = basisMultiply(rot, turned);
    // `(identity3 - rot) * transform_new.basis`.
    const identityLessRot = basis(op_subtract(vector3(1, 0, 0), rot.x), op_subtract(vector3(0, 1, 0), rot.y), op_subtract(vector3(0, 0, 1), rot.z));
    origin = op_add(origin, basisMultiply(basisMultiply(identityLessRot, turned), vector3(com.x, com.y, com.z)));
    turned = orthonormalized(product);
  }
  origin = op_add(origin, op_multiply(linear, step));
  return transform3d(turned, origin);
}

/** After Rapier's step: the solved velocities, and the contacts to report (`GodotBody3D::add_contact`, `godot_body_3d.cpp:352`). */
function readBack(world: World): void {
  for (const [entity, object] of godot_collision_objects()) {
    const state = RIGID.get(entity);
    const body = object.body;
    if (state === undefined || body === undefined) continue;
    const v = body.linvel();
    const w = body.angvel();
    state.server.linear_velocity = vector3(v.x, v.y, v.z);
    state.server.angular_velocity = vector3(w.x, w.y, w.z);
    // In free flight (no contact solved this step) the step is Godot's `integrate_velocities`
    // (`godot_body_3d.cpp:712`): the basis turned by the angular velocity, then the origin moved by
    // the linear velocity.
    const before = state.before;
    state.before = undefined;
    if (before === undefined) {
      state.server.contacts = state.reporting;
      continue;
    }
    const solved = stepContacts(world, object, state, before.transform);
    if (!solved) {
      const moved = integrateVelocities(before.transform, before.velocity, before.angular, state.server.step, body.localCom());
      state.server.linear_velocity = before.velocity;
      state.server.angular_velocity = before.angular;
      body.setLinvel({ x: before.velocity.x, y: before.velocity.y, z: before.velocity.z }, false);
      body.setAngvel({ x: before.angular.x, y: before.angular.y, z: before.angular.z }, false);
      godot_collision_object_moved(entity, moved);
    }
    state.server.contacts = state.reporting;
  }
}

/** `_sync_body_state` (`rigid_body_3d.cpp:149`). */
function syncBodyState(entity: object, state: RigidState): void {
  set_global_transform(entity as Object3D, state.server.transform());
  godot_collision_object_synced(entity, get_global_transform(entity as Object3D));
  state.linear_velocity = state.server.linear_velocity;
  state.angular_velocity = state.server.angular_velocity;
  state.contact_count = state.server.contacts.length;
}

/** The state callbacks of `flush_queries` (`GodotBody3D::call_queries`, `godot_body_3d.cpp:762`). */
function flushBodies(): void {
  for (const [entity, state] of [...RIGID]) {
    const object = godot_collision_object_state(entity);
    if (object === undefined) {
      RIGID.delete(entity);
      continue;
    }
    if (!state.stepped || object.body === undefined) continue;
    state.stepped = false;
    if (state.integrate !== undefined) {
      syncBodyState(entity, state);
      state.integrate(state.direct);
    }
    syncBodyState(entity, state);
  }
}

/**
 * Registers a node as a RigidBody3D with Godot's defaults (`rigid_body_3d.h`): mass 1, gravity
 * scale 1, no damping of its own, no custom integrator, no contacts reported.
 *
 * @godot RigidBody3D (protocol)
 * @source scene/3d/physics/rigid_body_3d.cpp:829
 */
export function godot_rigid_body_3d_adopt(entity: object): void {
  godot_collision_object_adopt(entity, 'rigid');
  if (RIGID.has(entity)) return;
  const server: BodyServerState = {
    linear_velocity: vector3(),
    angular_velocity: vector3(),
    gravity: vector3(),
    step: 0,
    contacts: [],
    transform: () => godot_collision_object_state(entity)?.transform ?? transform3d(),
    wakeup: () => {
      state.awake = true;
    },
    object: (rid) => godot_collision_object_object(rid),
  };
  const state: RigidState = {
    mass: 1,
    gravity_scale: 1,
    linear_damp: 0,
    angular_damp: 0,
    custom_integrator: false,
    contact_monitor: false,
    max_contacts_reported: 0,
    lock_rotation: false,
    linear_velocity: vector3(),
    angular_velocity: vector3(),
    contact_count: 0,
    server,
    direct: godot_direct_body_state(server),
    integrate: undefined,
    stepped: false,
    before: undefined,
    reporting: [],
    inv_mass: 1,
    material: null,
    awake: true,
  };
  RIGID.set(entity, state);
  godot_world_3d_physics_callbacks(flushBodies, integrateForces, readBack, 0);
}

/**
 * The script's `_integrate_forces(state)`, run from the body's state callback.
 *
 * @godot RigidBody3D (protocol)
 * @source scene/3d/physics/rigid_body_3d.cpp:173
 */
export function godot_rigid_body_3d_integrate_forces(entity: object, integrate: ((state: PhysicsDirectBodyState3D) => void) | undefined): void {
  stateOf(entity, '_integrate_forces').integrate = integrate;
}

/**
 * A non-positive mass fails and leaves it.
 *
 * @godot RigidBody3D.set_mass
 * @source scene/3d/physics/rigid_body_3d.cpp:341
 */
export function set_mass(self: object, mass: number): void {
  if (mass <= 0) return;
  stateOf(self, 'set_mass').mass = f32(mass);
}

/**
 * @godot RigidBody3D.get_mass
 * @source scene/3d/physics/rigid_body_3d.cpp:347
 */
export function get_mass(self: object): number {
  return stateOf(self, 'get_mass').mass;
}

/**
 * @godot RigidBody3D.set_gravity_scale
 * @source scene/3d/physics/rigid_body_3d.cpp:424
 */
export function set_gravity_scale(self: object, gravity_scale: number): void {
  stateOf(self, 'set_gravity_scale').gravity_scale = f32(gravity_scale);
}

/**
 * @godot RigidBody3D.get_gravity_scale
 * @source scene/3d/physics/rigid_body_3d.cpp:429
 */
export function get_gravity_scale(self: object): number {
  return stateOf(self, 'get_gravity_scale').gravity_scale;
}

/**
 * A negative damping fails and leaves it.
 *
 * @godot RigidBody3D.set_linear_damp
 * @source scene/3d/physics/rigid_body_3d.cpp:451
 */
export function set_linear_damp(self: object, linear_damp: number): void {
  if (linear_damp < 0) return;
  stateOf(self, 'set_linear_damp').linear_damp = f32(linear_damp);
}

/**
 * @godot RigidBody3D.get_linear_damp
 * @source scene/3d/physics/rigid_body_3d.cpp:457
 */
export function get_linear_damp(self: object): number {
  return stateOf(self, 'get_linear_damp').linear_damp;
}

/**
 * The node's velocity and the server's (`BODY_STATE_LINEAR_VELOCITY`), waking the body.
 *
 * @godot RigidBody3D.set_linear_velocity
 * @source scene/3d/physics/rigid_body_3d.cpp:478
 */
export function set_linear_velocity(self: object, linear_velocity: Vector3): void {
  const state = stateOf(self, 'set_linear_velocity');
  state.linear_velocity = vector3(linear_velocity);
  state.server.linear_velocity = state.linear_velocity;
  state.awake = true;
}

/**
 * @godot RigidBody3D.get_linear_velocity
 * @source scene/3d/physics/rigid_body_3d.cpp:483
 */
export function get_linear_velocity(self: object): Vector3 {
  return stateOf(self, 'get_linear_velocity').linear_velocity;
}

/**
 * @godot RigidBody3D.set_angular_velocity
 * @source scene/3d/physics/rigid_body_3d.cpp:487
 */
export function set_angular_velocity(self: object, angular_velocity: Vector3): void {
  const state = stateOf(self, 'set_angular_velocity');
  state.angular_velocity = vector3(angular_velocity);
  state.server.angular_velocity = state.angular_velocity;
  state.awake = true;
}

/**
 * @godot RigidBody3D.get_angular_velocity
 * @source scene/3d/physics/rigid_body_3d.cpp:492
 */
export function get_angular_velocity(self: object): Vector3 {
  return stateOf(self, 'get_angular_velocity').angular_velocity;
}

/**
 * @godot RigidBody3D.set_use_custom_integrator
 * @source scene/3d/physics/rigid_body_3d.cpp:500
 */
export function set_use_custom_integrator(self: object, enable: boolean): void {
  stateOf(self, 'set_use_custom_integrator').custom_integrator = enable;
}

/**
 * @godot RigidBody3D.is_using_custom_integrator
 * @source scene/3d/physics/rigid_body_3d.cpp:508
 */
export function is_using_custom_integrator(self: object): boolean {
  return stateOf(self, 'is_using_custom_integrator').custom_integrator;
}

/**
 * An amount outside 0..255 fails and leaves it.
 *
 * @godot RigidBody3D.set_max_contacts_reported
 * @source scene/3d/physics/rigid_body_3d.cpp:531
 */
export function set_max_contacts_reported(self: object, amount: number): void {
  if (amount < 0 || amount >= 256) return;
  stateOf(self, 'set_max_contacts_reported').max_contacts_reported = amount | 0;
}

/**
 * @godot RigidBody3D.get_max_contacts_reported
 * @source scene/3d/physics/rigid_body_3d.cpp:537
 */
export function get_max_contacts_reported(self: object): number {
  return stateOf(self, 'get_max_contacts_reported').max_contacts_reported;
}

/**
 * The contacts reported at the last sync.
 *
 * @godot RigidBody3D.get_contact_count
 * @source scene/3d/physics/rigid_body_3d.cpp:541
 */
export function get_contact_count(self: object): number {
  return stateOf(self, 'get_contact_count').contact_count;
}

/**
 * @godot RigidBody3D.set_contact_monitor
 * @source scene/3d/physics/rigid_body_3d.cpp:609
 */
export function set_contact_monitor(self: object, enabled: boolean): void {
  stateOf(self, 'set_contact_monitor').contact_monitor = enabled;
}

/**
 * @godot RigidBody3D.is_contact_monitor_enabled
 * @source scene/3d/physics/rigid_body_3d.cpp:638
 */
export function is_contact_monitor_enabled(self: object): boolean {
  return stateOf(self, 'is_contact_monitor_enabled').contact_monitor;
}

/**
 * `linear_velocity += impulse * inv_mass` on the server, waking the body
 * (`GodotBody3D::apply_central_impulse`, `godot_body_3d.h:223`).
 *
 * @godot RigidBody3D.apply_central_impulse
 * @source scene/3d/physics/rigid_body_3d.cpp:545
 */
export function apply_central_impulse(self: object, impulse: Vector3): void {
  const state = stateOf(self, 'apply_central_impulse');
  state.server.linear_velocity = op_add(state.server.linear_velocity, op_multiply(impulse, state.inv_mass));
  state.awake = true;
}

/**
 * @godot RigidBody3D.set_lock_rotation_enabled
 * @source scene/3d/physics/rigid_body_3d.cpp:302
 */
export function set_lock_rotation_enabled(self: object, lock_rotation: boolean): void {
  stateOf(self, 'set_lock_rotation_enabled').lock_rotation = lock_rotation;
}

/**
 * @godot RigidBody3D.is_lock_rotation_enabled
 * @source scene/3d/physics/rigid_body_3d.cpp:311
 */
export function is_lock_rotation_enabled(self: object): boolean {
  return stateOf(self, 'is_lock_rotation_enabled').lock_rotation;
}


/**
 * @godot RigidBody3D.set_physics_material_override
 * @source scene/3d/physics/rigid_body_3d.cpp:407
 */
export function set_physics_material_override(self: object, physics_material_override: PhysicsMaterial | null): void {
  stateOf(self, 'set_physics_material_override').material = physics_material_override;
  godot_collision_object_material(godot_node_entity(self), physics_material_override);
}

/**
 * @godot RigidBody3D.get_physics_material_override
 * @source scene/3d/physics/rigid_body_3d.cpp:420
 */
export function get_physics_material_override(self: object): PhysicsMaterial | null {
  return stateOf(self, 'get_physics_material_override').material;
}

/**
 * A dynamic body the scene's JSX declares is a RigidBody3D: its gravity scale and damping are the
 * ones its Rapier body holds (`gravityScale`, `linearDamping`, `angularDamping` props, which compat
 * takes over, since Godot integrates them), its axis locks the ones it enforces, and its mass,
 * `lock_rotation`, custom integrator, contact reporting and material override the `userData`
 * holds by their Godot names.
 *
 * @godot RigidBody3D (protocol)
 * @source scene/3d/physics/rigid_body_3d.cpp:829
 */
function declareRigidBody(entity: object, body: RigidBody, data: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  godot_rigid_body_3d_adopt(entity);
  const state = RIGID.get(entity) as RigidState;
  state.gravity_scale = f32(body.gravityScale());
  state.linear_damp = f32(body.linearDamping());
  state.angular_damp = f32(body.angularDamping());
  const read = new Set<string>();
  for (const [key, value] of Object.entries(data)) {
    if (key === 'mass') set_mass(entity, Number(value));
    else if (key === 'lock_rotation') set_lock_rotation_enabled(entity, Boolean(value));
    else if (key === 'custom_integrator') set_use_custom_integrator(entity, Boolean(value));
    else if (key === 'contact_monitor') set_contact_monitor(entity, Boolean(value));
    else if (key === 'max_contacts_reported') set_max_contacts_reported(entity, Number(value));
    else if (key === 'physics_material_override') set_physics_material_override(entity, godot_physics_material_of(value as Readonly<Record<string, unknown>>));
    else continue;
    read.add(key);
  }
  godot_physics_body_3d_declared_locks(entity, body, !state.lock_rotation);
  return read;
}

godot_collision_object_declarer('rigid', declareRigidBody);
