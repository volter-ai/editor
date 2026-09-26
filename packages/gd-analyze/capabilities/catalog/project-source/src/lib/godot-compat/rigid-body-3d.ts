/**
 * `RigidBody` and the `PhysicsDirectBodyState` its `_integrate_forces(state)` is handed — over the
 * PORT'S own Rapier 3D world and body.
 *
 * ## `_integrate_forces` is NOT inside the solver, and that is the whole design
 *
 * The name says mid-step and the file it lives in says otherwise. Godot 3.6 registers the script's
 * `_integrate_forces` as a body's `fi_callback`; `BodySW::integrate_velocities`
 * (`servers/physics/body_sw.cpp:582-589`) queues the body on the space's state-query list AFTER the
 * solve, `SpaceSW`'s query flush calls `BodySW::call_queries` (`body_sw.cpp:707`), and
 * `Main::iteration` (`main/main.cpp:2377`) runs `PhysicsServer::flush_queries()` at the TOP of a
 * physics tick — before `_physics_process`, and before that tick's `PhysicsServer::step()`
 * (`main.cpp:2390`). So the callback is a PRE-STEP hook that reports the previous step's result:
 *
 * | what the script touches | what it actually is |
 * |---|---|
 * | `state.get_linear_velocity()` | the velocity AFTER the previous step's solve |
 * | `state.set_linear_velocity(v)` | the velocity the NEXT `step()` integrates |
 * | `state.get_contact_count()` | the contacts the PREVIOUS step's solve produced |
 * | `state.get_step()` | the fixed physics delta, not a wall clock |
 *
 * `test/ground-truth/godot36-physics-state.json` is that table measured rather than read: its
 * `freeFall` phase records a body whose whole integrator is the script, and the velocity it is
 * handed at iteration N is exactly the one it wrote at N-1, with the origin moved by that velocity
 * times the step.
 *
 * That makes the surface expressible with no Rapier hook at all. **The port runs the translated
 * `_integrate_forces` between steps, immediately before `world.step()`** — the same position Godot
 * runs it in — and every member below is an ordinary read or write on a body that is not being
 * solved at that moment. There is no pre-solve callback here, no `modifySolverContacts`, and none
 * is needed.
 *
 * ## Godot's `gravity_scale` comes from the PORT, not from Rapier
 *
 * `get_total_gravity()` looks like `world.gravity * body.gravityScale()` and must not be: a
 * `custom_integrator = true` body (which is what `enemy.tscn` authors) is exactly the body whose
 * Rapier `gravityScale` a port sets to ZERO, because turning Rapier's own integration off is the
 * only way to let the script be the integrator. Reading it back would hand the script that has to
 * apply gravity the news that there is none. Godot keeps the two separate — `BodySW::integrate_forces`
 * computes `gravity` from the areas and `gravity_scale` whether or not `omit_force_integration` is
 * set (`body_sw.cpp:448-493`) — so the AUTHORED scale is what this takes, from the `.tscn`, through
 * {@link CreatePhysicsDirectBodyStateOptions.gravityScale}.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing. **Shares:** the Rapier `World` and `RigidBody` the port handed it, plus the
 * collider resolver. **Teardown:** none — nothing is registered, subscribed or cached.
 */

import { RigidBodyDesc, RigidBodyType } from '@dimforge/rapier3d-compat';
import { bodyOwningNode, markBodyOwnedNode } from '@volter/threejs-runtime/adapter/body-marks';
import { Object3D, type Vector3Like } from 'three';
import { basisFromQuaternion, basisRotationQuaternion } from './basis';
import { quaternion } from './quaternion';
import { type Transform, transform3, type Vector3, vec3 } from './variant-3d';
import { registerGodotObjectIdentity } from './object';
import { registerGodotThreeNodeRelease } from './node-3d';

/** The half of a Rapier 3D `RigidBody` this file touches. Structural for the reason
 *  `physics-2d.ts`'s header records; Rapier's own `RigidBody` satisfies it. */
export interface RigidBody3DLike {
  readonly handle: number;
  linvel(): Vector3Like;
  angvel(): Vector3Like;
  setLinvel(velocity: Vector3Like, wakeUp: boolean): void;
  setAngvel(velocity: Vector3Like, wakeUp: boolean): void;
  translation(): Vector3Like;
  rotation(): { readonly x: number; readonly y: number; readonly z: number; readonly w: number };
  setTranslation(translation: Vector3Like, wakeUp: boolean): void;
  setRotation(rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }, wakeUp: boolean): void;
  addForce(force: Vector3Like, wakeUp: boolean): void;
  addTorque(torque: Vector3Like, wakeUp: boolean): void;
  lockRotations(locked: boolean, wakeUp: boolean): void;
  setEnabledRotations(enableX: boolean, enableY: boolean, enableZ: boolean, wakeUp: boolean): void;
  numColliders(): number;
  collider(index: number): ColliderLike;
}

/** The half of a Rapier 3D `Collider` this file touches. */
export interface ColliderLike {
  handle: unknown;
  activeHooks(): number;
  setActiveHooks(activeHooks: number): void;
}

/** The half of a Rapier 3D `TempContactManifold` this file reads. */
export interface ContactManifoldLike {
  /** World-space contact normal, pointing from the manifold's own first shape toward its second. */
  normal(): Vector3Like;
  numContacts(): number;
  /** Signed distance at contact `i`; NEGATIVE is penetration, which is Godot's positive `depth`. */
  contactDist(index: number): number;
}

/** The half of a Rapier 3D `World` this file reads. Rapier's own `World` satisfies it. */
export interface ContactWorldLike {
  /** Rapier's own simulation step — see {@link PhysicsDirectBodyState.getStep}. */
  readonly timestep: number;
  readonly gravity: Vector3Like;
  contactPairsWith(collider: ColliderLike, f: (other: ColliderLike) => void): void;
  contactPair(
    collider1: ColliderLike,
    collider2: ColliderLike,
    f: (manifold: ContactManifoldLike, flipped: boolean) => void,
  ): void;
}

/** What {@link createPhysicsDirectBodyState} needs from the port. */
export interface CreatePhysicsDirectBodyStateOptions {
  /** The port's Rapier world — the narrow phase the contact list is read from. */
  readonly world: ContactWorldLike;
  /** The body whose `_integrate_forces` this state serves. */
  readonly body: RigidBody3DLike;
  /**
   * A Rapier collider -> the game object a script expects from
   * `get_contact_collider_object(i)`. The port already holds both halves; the refusal behind this
   * is `kinematic-body-3d.ts`'s, for the same reason.
   */
  readonly resolveCollider: (collider: ColliderLike) => unknown;
  /**
   * Godot's `RigidBody.gravity_scale` as the `.tscn` AUTHORS it — not Rapier's runtime gravity
   * scale. See this module's header. Defaults to Godot's own default of 1.
   */
  readonly gravityScale?: number;
  /**
   * Godot's `RigidBody.contacts_reported` (`enemy.tscn` authors 5). When more contacts exist than
   * this, the DEEPEST are kept, which is what Godot's own eviction converges to: `BodySW::add_contact`
   * (`servers/physics/body_sw.h:345-380`) replaces the least-deep entry and only when the newcomer
   * is deeper. Omitted means no cap.
   */
  readonly contactsReported?: number;
  /** Authored `contact_monitor`, seated for live `get_colliding_bodies()` reads. */
  readonly contactMonitor?: boolean;
}

/** `PhysicsDirectBodyState`, narrowed to the surface `enemy.gd:16-72` measures. */
export interface PhysicsDirectBodyState {
  /**
   * `state.get_step()` — `enemy.gd:17`.
   *
   * Rapier's `world.timestep`, which is its own answer to "how long is a solver step". Godot's is
   * the step that just FINISHED (`SpaceSW::get_step`, set at the top of `StepSW::step`) and this is
   * the step the next `world.step()` will take; under the fixed timestep both engines run they are
   * the same number, which is what the ground truth measured (1/120 on every step). This is a READ
   * of the library's own value, not a clock of compat's own — `move_and_slide`'s `dt` argument is
   * still the rule for anything Rapier does not already know.
   */
  getStep(): number;
  /** Live solver pose, copied into Godot's value-shaped Transform. */
  getTransform(): Transform;
  /** Replace the live solver pose without introducing a scene-node shadow. */
  setTransform(value: Transform): void;
  /** Accumulate torque for the next native Rapier step. */
  addTorque(torque: Vector3Like): void;
  /** Accumulate force at the body's center for the next native Rapier step. */
  addCentralForce(force: Vector3Like): void;
  /** `state.get_total_gravity()` — `enemy.gd:19`. See this module's header for where the scale
   *  comes from. */
  getTotalGravity(): Vector3;
  /** `state.get_linear_velocity()` — `enemy.gd:18`. A VALUE copy, for the reason
   *  `physics-2d.ts`'s `getLinearVelocity` copies. */
  getLinearVelocity(): Vector3;
  /** `state.set_linear_velocity(v)` — `enemy.gd:28`, `:72`. The velocity the next `world.step()`
   *  integrates. */
  setLinearVelocity(velocity: Vector3Like): void;
  /** `state.angular_velocity` / `get_angular_velocity()`, detached from Rapier's temporary view. */
  getAngularVelocity(): Vector3;
  /**
   * `state.set_angular_velocity(v)` — `enemy.gd:39`.
   *
   * Only meaningful once the body's rotations are UNLOCKED, which is exactly what
   * `set_mode(MODE_RIGID)` does one line earlier — see {@link setMode}.
   */
  setAngularVelocity(velocity: Vector3Like): void;
  /** `state.get_contact_count()` — `enemy.gd:31`. */
  getContactCount(): number;
  /**
   * `state.get_contact_local_normal(i)` — `enemy.gd:33`.
   *
   * World-space, and pointing OUT of the other body TOWARD this one, which is what Godot means
   * despite the name: `BodyPairSW` hands body A `-c.normal` and body B `+c.normal`
   * (`servers/physics/body_pair_sw.cpp:293,298`) where `c.normal` is `(pointA - pointB).normalized()`
   * (`:66`), so each side gets the obstacle's outward normal. The ground truth's `resting` phase
   * measures it as `(0, 1, 0)` for a body on a floor. Same meaning as `KinematicCollision.normal`.
   */
  getContactLocalNormal(index: number): Vector3;
  /** `state.get_contact_collider_object(i)` — `enemy.gd:32`. The GAME's object, as
   *  {@link CreatePhysicsDirectBodyStateOptions.resolveCollider} named it. */
  getContactColliderObject(index: number): unknown;
  /**
   * The Rapier body this state serves — the translation bridge for `RigidBody.set_mode`.
   *
   * `set_mode` is a `RigidBody` member, not a `PhysicsDirectBodyState` one: Godot hands
   * `_integrate_forces(state)` BOTH `self` (the RigidBody) and `state` (this solver-state view), and
   * `enemy.gd:37` reaches `self` to call `set_mode(MODE_RIGID)`. This translation materializes only
   * the state per instance (the port's `bodyState(scene)`), so the way an emitted
   * `_integrate_forces` reaches `self`'s body is through the state that already wraps it —
   * `setMode(state.body, MODE_RIGID)`. It is the SAME body every method above reads and writes.
   */
  readonly body: RigidBody3DLike;
}

/** Godot's `RigidBody.MODE_RIGID`. The integer is the engine's own, from the ground truth's
 *  `modes` block rather than from memory. */
export const RIGID_BODY_MODE_RIGID = 0;

export function getMode(body: RigidBody3DLike): number {
  void body;
  return RIGID_BODY_MODE_RIGID;
}

/**
 * Build the state view. One per translated `RigidBody` whose script defines `_integrate_forces`.
 *
 * The port calls the translated body BETWEEN steps, immediately before `world.step()` — see this
 * module's header. Nothing is cached because nothing needs to be: Rapier's narrow phase only
 * changes inside `world.step()`, so every read below answers identically for the whole callback.
 */
export function createPhysicsDirectBodyState(
  options: CreatePhysicsDirectBodyStateOptions,
): PhysicsDirectBodyState {
  if (options.contactsReported !== undefined && !CONTACTS_REPORTED.has(options.body)) {
    setRigidBodyContactsReported(options.body, options.contactsReported);
  }
  if (options.contactMonitor !== undefined && !CONTACT_MONITOR.has(options.body)) {
    setRigidBodyContactMonitor(options.body, options.contactMonitor);
  }
  const { world, body, resolveCollider, gravityScale = 1, contactsReported } = options;

  return {
    body,

    getStep(): number {
      return world.timestep;
    },

    getTransform(): Transform {
      const at = body.translation();
      const rotation = body.rotation();
      return transform3(
        basisFromQuaternion(quaternion(rotation.x, rotation.y, rotation.z, rotation.w)),
        at,
      );
    },

    setTransform(value): void {
      body.setTranslation(value.origin, true);
      body.setRotation(basisRotationQuaternion(value.basis), true);
    },

    addTorque(torque): void {
      body.addTorque(finiteImpulse3D(torque, 'PhysicsDirectBodyState.add_torque'), true);
    },

    addCentralForce(force): void {
      body.addForce(finiteImpulse3D(force, 'PhysicsDirectBodyState.add_central_force'), true);
    },

    getTotalGravity(): Vector3 {
      const gravity = world.gravity;
      const authoredScale = FORCE_INTEGRATION.get(body)?.gravityScale ?? gravityScale;
      return vec3(
        gravity.x * authoredScale,
        gravity.y * authoredScale,
        gravity.z * authoredScale,
      );
    },

    getLinearVelocity(): Vector3 {
      const velocity = body.linvel();
      return vec3(velocity.x, velocity.y, velocity.z);
    },

    setLinearVelocity(velocity): void {
      body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    },

    getAngularVelocity(): Vector3 {
      const velocity = body.angvel();
      return vec3(velocity.x, velocity.y, velocity.z);
    },

    setAngularVelocity(velocity): void {
      body.setAngvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
    },

    getContactCount(): number {
      return collectContacts(world, body, contactsReported).length;
    },

    getContactLocalNormal(index): Vector3 {
      const contact = contactAt(world, body, contactsReported, index, 'get_contact_local_normal');
      return vec3(contact.normal.x, contact.normal.y, contact.normal.z);
    },

    getContactColliderObject(index): unknown {
      const contact = contactAt(
        world,
        body,
        contactsReported,
        index,
        'get_contact_collider_object',
      );
      return resolveCollider(contact.collider);
    },
  };
}

/**
 * `body.set_mode(mode)` — `enemy.gd:37`.
 *
 * MEASURED, both sides, because "MODE_CHARACTER is a rigid body that cannot rotate" is the kind of
 * claim that reads true and ships wrong. Godot's `BodySW::set_mode` zeroes a CHARACTER's inverse
 * inertia tensor (`servers/physics/body_sw.cpp:143-147, 270-275`), and the ground truth's
 * `modeStaysCharacter` phase shows what that means for the call `enemy.gd` actually makes: a
 * CHARACTER handed `state.set_angular_velocity((0,0,3))` reads back ZERO on the next step and never
 * turns, while `modeSwitchToRigid` — the identical call one line after `set_mode(MODE_RIGID)` —
 * keeps 3 rad/s and tumbles. Rapier's `lockRotations` is measurably the same switch: a locked body
 * discards a written `setAngvel`, an unlocked one keeps it.
 *
 * @throws for Godot's other three modes, by name. MODE_STATIC and MODE_KINEMATIC are a Rapier BODY
 * TYPE change (`setBodyType`) rather than a rotation lock, and MODE_CHARACTER additionally means
 * "never sleeps" (`BodySW::sleep_test`, `body_sw.cpp:727`), which is the port's `setCanSleep(false)`
 * at construction and not a runtime transition. No measured script performs any of the three, so
 * absorbing them silently would be answering for behaviour nothing has checked.
 */
export function setMode(body: RigidBody3DLike, mode: number): void {
  if (mode !== RIGID_BODY_MODE_RIGID) {
    throw new Error(
      `godot-compat: set_mode(${mode}) — only RigidBody.MODE_RIGID (${RIGID_BODY_MODE_RIGID}) has ` +
        'a measured backend. MODE_STATIC (1) and MODE_KINEMATIC (3) are a Rapier body-TYPE change ' +
        '(body.setBodyType(RigidBodyType.Fixed / KinematicPositionBased)), and MODE_CHARACTER (2) ' +
        'is a rotation lock PLUS "never sleeps" — body.lockRotations(true, true) and ' +
        "RigidBodyDesc.setCanSleep(false) at construction, which is the port's setup rather than " +
        'a runtime transition. Refusing is deliberate: no measured script makes these calls, so ' +
        'nothing has checked what they would do.',
    );
  }
  // Godot's MODE_RIGID restores the real inertia tensor, so contacts and written angular
  // velocities move the body again. It does NOT zero the existing angular velocity — only the
  // switch INTO MODE_CHARACTER does (`body_sw.cpp:274`) — so nothing is cleared here either.
  body.lockRotations(false, true);
}

/** `body.linear_velocity = v` — `player.gd:120`, on the bullet it just instanced. The same one
 *  call as the state's `set_linear_velocity`, on the same object, reached without a state. */
export function setLinearVelocity(body: RigidBody3DLike, velocity: Vector3Like): void {
  body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);
}

/** `body.linear_velocity` as a detached Godot value, backed by Rapier's live solver velocity. */
export function getLinearVelocity3D(body: RigidBody3DLike): Vector3 {
  const velocity = body.linvel();
  return vec3(velocity.x, velocity.y, velocity.z);
}

/**
 * The dynamic body fused onto a Godot `RigidBody3D` node.
 *
 * The two velocity properties above take the Rapier body directly, because a script reaches them
 * on a scene ROOT the emitted class already holds a `body` field for. `angular_velocity` is the
 * case that is not: `starter-kit-racing`'s `vehicle.gd` steers a `Sphere` RigidBody3D that hangs
 * BELOW a Node3D scene root, so the receiver the emitter has is the node, not the body. The link
 * is the mark the scene wrote at the one place both halves existed — `markBodyOwnedNode` at the
 * construction seam — read back here through the engine's own accessor. It is the same
 * transform-authority link the editor's gizmo follows, not a second registry.
 *
 * @throws when the node carries no mark. Rapier has no "the body for this Object3D" question to
 * ask, so there is nothing to fall back to: answering `(0, 0, 0)` would report a body at rest that
 * may be spinning, and swallowing a write would drop the steering input the script just computed.
 */
function rigidBodyOfNode(node: Object3D, member: string): RigidBody3DLike {
  const body = bodyOwningNode(node) as unknown as RigidBody3DLike | undefined;
  if (body === undefined) {
    throw new Error(
      `godot-compat: RigidBody3D.${member} was reached on "${node.name}", a node no Rapier body ` +
        'owns. Godot fuses the scene-tree transform and the physics body into ONE object and this ' +
        'engine does not; the emitted scene links the pair with `markBodyOwnedNode` where it ' +
        'builds them, so an unmarked node means the property was read before that seam ran.',
    );
  }
  return body;
}

export function rigidBody3DOfNode(node: Object3D, member: string): RigidBody3DLike {
  return rigidBodyOfNode(node, member);
}

export interface GodotRigidBodyConstructor3DOptions {
  readonly world: RigidBodyWorld<RigidBody3DLike> & { removeRigidBody(body: RigidBody3DLike): void };
}

export function createGodotRigidBody(options: GodotRigidBodyConstructor3DOptions): Object3D {
  const node = new Object3D();
  registerGodotObjectIdentity(node, 'RigidBody');
  const body = options.world.createRigidBody(RigidBodyDesc.dynamic());
  markBodyOwnedNode(node, body as never);
  Object.defineProperty(node, 'body', { enumerable: false, configurable: false, value: body });
  registerGodotThreeNodeRelease(node, () => options.world.removeRigidBody(body));
  return node;
}

/**
 * `body.angular_velocity` — `vehicle.gd:92` reads its length, `:119` adds to it.
 *
 * RADIANS PER SECOND about a GLOBAL axis, on both engines, so this is Rapier's own `angvel()` with
 * nothing converted. Measured, not assumed:
 *
 *  - **The unit** is `test/ground-truth/godot36-physics-state.json`'s `modeSwitchToRigid` phase.
 *    Its iteration 4 writes `(0, 0, 3)` at a `1/120` step and records the body's up axis landing
 *    on `(-0.02499739639461040, 0.99968749284744260, 0)` — exactly `(-sin 0.025, cos 0.025, 0)`,
 *    which is `3 * 1/120` radians. A degrees-per-second reading would be off by 57x.
 *  - **The frame** is the property's own use: `vehicle.gd:119` is
 *    `sphere.angular_velocity += vehicle_model.get_global_transform().basis.x * …`, which adds a
 *    vector taken from a GLOBAL basis. Godot's own accessors are the pinned oracle's
 *    (`vendor/extension-api/godot-4.7-extension_api.json`: `RigidBody3D.angular_velocity` is a
 *    `Vector3` over `set_angular_velocity`/`get_angular_velocity`), and Rapier's `angvel` is
 *    world-space too — `gd-analyze`'s `test/rigid-body-angular-velocity.test.ts` steps a
 *    PRE-ROTATED body to prove that side rather than trusting it, and steps the `(0, 0, 3)` case
 *    onto the ground truth's own number rather than onto a recomputation of it.
 *
 * There is no axis conversion for the same reason `variant-3d.ts` and `skeletal-animation.ts`
 * state: Godot and three are both right-handed and Y-up, so `basis.ts` has nothing to do here.
 */
export function getAngularVelocity3D(node: Object3D): Vector3 {
  const velocity = rigidBodyOfNode(node, 'angular_velocity').angvel();
  return vec3(velocity.x, velocity.y, velocity.z);
}

/** `body.angular_velocity = v`, and the `+=` form `vehicle.gd:119` writes. Wakes the body, the
 *  same cadence {@link setLinearVelocity} writes at. */
export function setAngularVelocity3D(node: Object3D, velocity: Vector3Like): void {
  rigidBodyOfNode(node, 'angular_velocity').setAngvel(
    { x: velocity.x, y: velocity.y, z: velocity.z },
    true,
  );
}

/** `RigidBody.custom_integrator` on the same body mark used by angular_velocity. */
export function getRigidBodyCustomIntegrator3D(node: Object3D): boolean {
  return getRigidBodyCustomIntegrator(rigidBodyOfNode(node, 'custom_integrator'));
}

/** Toggle the live body's existing Rapier force-integration path; the script callback schedule is unchanged. */
export function setRigidBodyCustomIntegrator3D(node: Object3D, enabled: boolean): void {
  setRigidBodyCustomIntegrator(rigidBodyOfNode(node, 'custom_integrator'), enabled);
}

/** One entry of the assembled contact list. */
interface Contact {
  readonly normal: Vector3Like;
  readonly collider: ColliderLike;
  /** Godot's sign: POSITIVE is penetration. */
  readonly depth: number;
}

/** The distinct Godot body owners touching this body after the previous solve, deepest contacts
 *  first and capped by `max_contacts_reported`. Several contact points on one body still identify
 *  one body, matching `RigidBody3D.body_entered(body)` rather than emitting per manifold point. */
export function rigidBodyContactOwners(
  world: ContactWorldLike,
  body: RigidBody3DLike,
  resolveCollider: (collider: ColliderLike) => unknown,
  contactsReported: number,
): readonly unknown[] {
  if (CONTACT_MONITOR.get(body) === false) return [];
  const effectiveLimit = CONTACTS_REPORTED.get(body) ?? contactsReported;
  if (effectiveLimit <= 0) return [];
  const owners: unknown[] = [];
  const seen = new Set<unknown>();
  for (const contact of collectContacts(world, body, effectiveLimit)) {
    const owner = resolveCollider(contact.collider);
    if (owner === undefined || seen.has(owner)) continue;
    seen.add(owner);
    owners.push(owner);
  }
  return owners;
}

const CONTACT_MONITOR = new WeakMap<object, boolean>();
const CONTACTS_REPORTED = new WeakMap<object, number>();

export function getRigidBodyContactMonitor(body: object): boolean {
  return CONTACT_MONITOR.get(body) ?? false;
}

export function setRigidBodyContactMonitor(body: object, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody.contact_monitor must be bool.');
  CONTACT_MONITOR.set(body, value);
}

export function getRigidBodyContactsReported(body: object): number {
  return CONTACTS_REPORTED.get(body) ?? 0;
}

export function setRigidBodyContactsReported(body: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('RigidBody contacts reported must be a non-negative integer.');
  }
  CONTACTS_REPORTED.set(body, value);
}

/** Live contact owners from Rapier's narrow phase, gated and capped by the two Godot properties. */
export function getRigidBodyCollidingBodies(
  world: ContactWorldLike,
  body: RigidBody3DLike,
  resolveCollider: (collider: ColliderLike) => unknown,
): readonly unknown[] {
  if (!getRigidBodyContactMonitor(body)) return [];
  return rigidBodyContactOwners(world, body, resolveCollider, getRigidBodyContactsReported(body));
}

/**
 * The body's contacts, assembled from every collider it owns.
 *
 * Ordered DEEPEST FIRST. Godot's order is its solver's insertion order, which no narrow-phase read
 * can recover, so the choice is between Rapier's internal graph order (arbitrary and unstated) and
 * a stated one; depth is stated, deterministic, and is the axis Godot's own eviction sorts on.
 * `enemy.gd:31` SCANS the whole list, so nothing measured depends on the order — a script that
 * indexed a fixed slot would.
 */
function collectContacts(
  world: ContactWorldLike,
  body: RigidBody3DLike,
  contactsReported: number | undefined,
): readonly Contact[] {
  const contacts: Contact[] = [];
  for (let i = 0; i < body.numColliders(); i += 1) {
    const mine = body.collider(i);
    world.contactPairsWith(mine, (other) => {
      world.contactPair(mine, other, (manifold, flipped) => {
        const count = manifold.numContacts();
        if (count === 0) return;
        // `normal()` runs from the manifold's own first shape to its second, and `flipped` says
        // this collider is the SECOND. So it already points toward us when flipped, and away from
        // us when not — measured both ways in `test/physics-state-3d.test.ts`.
        const normal = manifold.normal();
        const towardsMe = flipped
          ? { x: normal.x, y: normal.y, z: normal.z }
          : { x: -normal.x, y: -normal.y, z: -normal.z };
        for (let c = 0; c < count; c += 1) {
          contacts.push({ normal: towardsMe, collider: other, depth: -manifold.contactDist(c) });
        }
      });
    });
  }
  contacts.sort((a, b) => b.depth - a.depth);
  return contactsReported === undefined ? contacts : contacts.slice(0, contactsReported);
}

/** One contact by index, or a throw naming the member and the count — Godot pushes an error and
 *  returns a zero vector, which reads as a real contact pointing nowhere. */
function contactAt(
  world: ContactWorldLike,
  body: RigidBody3DLike,
  contactsReported: number | undefined,
  index: number,
  member: string,
): Contact {
  const contacts = collectContacts(world, body, contactsReported);
  const contact = index < 0 || index >= contacts.length ? undefined : contacts[index];
  if (contact === undefined) {
    throw new Error(
      `godot-compat: ${member}(${index}) is out of range — this body reports ` +
        `${contacts.length} contact(s). Godot pushes an error and hands back a ZERO vector, which ` +
        'a caller reads as a real contact pointing nowhere.',
    );
  }
  return contact;
}

// --- body construction (the port used to stamp these Rapier desc clauses) -------------------------

/** The half of a Rapier 3D `World` the body factories call. Rapier's own `World` satisfies it. */
export interface RigidBodyWorld<TBody = object> {
  createRigidBody(desc: RigidBodyDesc): TBody;
}

/** Authored numbers a PLAIN DYNAMIC `RigidBody` carries onto Rapier's own integrator. */
export interface DynamicBodySpec {
  /** Godot's `gravity_scale`. Default 1 — omitted from the desc, same as a body that never authored it. */
  readonly gravityScale?: number;
  /** Resolved linear damp (project default already applied). 0 emits no clause. */
  readonly linearDamp?: number;
  /** Resolved angular damp (project default already applied). 0 emits no clause. */
  readonly angularDamp?: number;
  /** Godot `continuous_cd`. Rapier's CCD. */
  readonly ccd?: boolean;
}

interface ForceIntegrationState {
  readonly body: ConfigurableRigidBody3DLike;
  gravityScale: number;
  linearDamp: number;
  angularDamp: number;
  customIntegrator: boolean;
}

const FORCE_INTEGRATION = new WeakMap<object, ForceIntegrationState>();

function retainForceIntegration(
  body: ConfigurableRigidBody3DLike,
  spec: Readonly<{
    gravityScale?: number;
    linearDamp?: number;
    angularDamp?: number;
    customIntegrator?: boolean;
  }>,
): void {
  FORCE_INTEGRATION.set(body, {
    body,
    gravityScale: spec.gravityScale ?? 1,
    linearDamp: spec.linearDamp ?? 0,
    angularDamp: spec.angularDamp ?? 0,
    customIntegrator: spec.customIntegrator ?? false,
  });
}

function forceIntegrationState(body: object): ForceIntegrationState {
  const state = FORCE_INTEGRATION.get(body);
  if (state === undefined) {
    throw new Error('RigidBody.custom_integrator requires a body created by the retained Rapier integration owner.');
  }
  return state;
}

export function getRigidBodyCustomIntegrator(body: object): boolean {
  return forceIntegrationState(body).customIntegrator;
}

export function setRigidBodyCustomIntegrator(body: object, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('RigidBody.custom_integrator must be bool.');
  const state = forceIntegrationState(body);
  state.customIntegrator = enabled;
  state.body.setGravityScale(enabled ? 0 : state.gravityScale, true);
  state.body.setLinearDamping(enabled ? 0 : state.linearDamp);
  state.body.setAngularDamping(enabled ? 0 : state.angularDamp);
  state.body.wakeUp();
}

/**
 * A PLAIN DYNAMIC `RigidBody` — Rapier's own integration steps gravity (scaled by the authored
 * `gravity_scale`) plus whatever velocity a script sets through `set_linear_velocity`. This is
 * the projectile shape (`bullet.tscn`).
 *
 * Mass is NOT applied here: Godot's `mass` is the body's TOTAL over its shapes, so it is a
 * post-pass after every collider is hung — see {@link applyDynamicBodyMass}.
 */
export function createDynamicBody<TBody extends ConfigurableRigidBody3DLike>(
  world: RigidBodyWorld<TBody>,
  spec: DynamicBodySpec = {},
): TBody {
  const desc = RigidBodyDesc.dynamic();
  if (spec.gravityScale !== undefined && spec.gravityScale !== 1) {
    desc.setGravityScale(spec.gravityScale);
  }
  if (spec.linearDamp !== undefined && spec.linearDamp !== 0) {
    desc.setLinearDamping(spec.linearDamp);
  }
  if (spec.angularDamp !== undefined && spec.angularDamp !== 0) {
    desc.setAngularDamping(spec.angularDamp);
  }
  if (spec.ccd === true) desc.setCcdEnabled(true);
  const body = world.createRigidBody(desc);
  retainForceIntegration(body, spec);
  return body;
}

/** Authored numbers a custom-integrating `RigidBody` carries. */
export interface CustomIntegratorBodySpec {
  /**
   * Godot MODE_CHARACTER (`mode = 2`): the inverse inertia tensor is zeroed, so the body cannot
   * rotate until `set_mode(MODE_RIGID)` restores it (`setMode` = `lockRotations(false)`).
   */
  readonly lockRotations?: boolean;
  /** Whether Godot's built-in force integration starts omitted. */
  readonly customIntegrator?: boolean;
  readonly gravityScale?: number;
  readonly linearDamp?: number;
  readonly angularDamp?: number;
}

/** The half of a Rapier 3D `RigidBody` {@link createCustomIntegratorBody} configures. */
export interface CustomIntegratorRigidBodyLike extends ConfigurableRigidBody3DLike {
  lockRotations(locked: boolean, wakeUp: boolean): void;
}

/**
 * A custom-integrating `RigidBody` — a DYNAMIC body whose whole force integration is the script's
 * `_integrate_forces(state)`. `custom_integrator = true` zeroes Godot's built-in force integration,
 * which Rapier expresses as `gravityScale(0)`. The translated callback's velocity writes wake the
 * body through Rapier's native setter; construction does not invent a mutable sleep-policy seam.
 *
 * The AUTHORED `gravity_scale` the script reads through `state.get_total_gravity()` is a SEPARATE
 * number, handed to {@link createPhysicsDirectBodyState} — see this module's header.
 */
export function createCustomIntegratorBody<TBody extends CustomIntegratorRigidBodyLike>(
  world: RigidBodyWorld<TBody>,
  spec: CustomIntegratorBodySpec = {},
): TBody {
  const customIntegrator = spec.customIntegrator ?? true;
  const gravityScale = spec.gravityScale ?? 1;
  const linearDamp = spec.linearDamp ?? 0;
  const angularDamp = spec.angularDamp ?? 0;
  const desc = RigidBodyDesc.dynamic()
    .setGravityScale(customIntegrator ? 0 : gravityScale)
    .setLinearDamping(customIntegrator ? 0 : linearDamp)
    .setAngularDamping(customIntegrator ? 0 : angularDamp);
  const body = world.createRigidBody(desc);
  retainForceIntegration(body, { customIntegrator, gravityScale, linearDamp, angularDamp });
  if (spec.lockRotations === true) body.lockRotations(true, true);
  return body;
}

/** The half of a Rapier 3D `RigidBody` {@link applyDynamicBodyMass} walks. */
export interface MassedRigidBodyLike {
  mass(): number;
  numColliders(): number;
  collider(index: number): { density(): number; setDensity(density: number): void };
}

/** The native body-type seam behind Godot 4's `freeze`/`freeze_mode` pair. */
export interface FreezableRigidBodyLike {
  bodyType(): RigidBodyType;
  setBodyType(type: RigidBodyType, wakeUp: boolean): void;
}

export interface RotationLockableRigidBody3DLike {
  areRotationsLocked(): boolean;
  lockRotations(locked: boolean, wakeUp: boolean): void;
}

/** Native dynamic-body controls shared by Godot 3 RigidBody and Godot 4 RigidBody3D. */
export interface ConfigurableRigidBody3DLike {
  gravityScale(): number;
  setGravityScale(value: number, wakeUp: boolean): void;
  linearDamping(): number;
  setLinearDamping(value: number): void;
  angularDamping(): number;
  setAngularDamping(value: number): void;
  isSleeping(): boolean;
  sleep(): void;
  wakeUp(): void;
  isCcdEnabled(): boolean;
  enableCcd(enabled: boolean): void;
}

/** Native Rapier force/impulse surface shared by both Godot 3 and 4 dynamic bodies. */
export interface DrivenRigidBody3DLike {
  applyImpulse(impulse: Vector3Like, wakeUp: boolean): void;
  applyImpulseAtPoint(impulse: Vector3Like, point: Vector3Like, wakeUp: boolean): void;
  applyTorqueImpulse(torqueImpulse: Vector3Like, wakeUp: boolean): void;
  addForce(force: Vector3Like, wakeUp: boolean): void;
  addForceAtPoint(force: Vector3Like, point: Vector3Like, wakeUp: boolean): void;
  addTorque(torque: Vector3Like, wakeUp: boolean): void;
  userForce(): Vector3Like;
  userTorque(): Vector3Like;
  resetForces(wakeUp: boolean): void;
  resetTorques(wakeUp: boolean): void;
  translation(): Vector3Like;
}

/**
 * Godot's `RigidBody.mass` as the body's TOTAL, distributed across its shapes BY VOLUME.
 *
 * Rapier derives each collider's mass from its own `density * volume` and sums them, so scaling
 * every collider's density by `authored total / Rapier's derived total` lands on exactly Godot's
 * distribution — for one shape and for six alike. Applied AFTER every collider is hung; `setMass`
 * on each desc would give EACH shape the whole body's mass.
 */
export function applyDynamicBodyMass(body: MassedRigidBodyLike, mass: number): void {
  const derivedMass = body.mass();
  if (derivedMass <= 0) return;
  const massScale = mass / derivedMass;
  for (let i = 0; i < body.numColliders(); i += 1) {
    const shape = body.collider(i);
    shape.setDensity(shape.density() * massScale);
  }
}

export function getRigidBodyMass(body: MassedRigidBodyLike): number { return body.mass(); }
export function setRigidBodyMass(body: MassedRigidBodyLike, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('RigidBody.mass must be finite and greater than zero.');
  if (body.mass() <= 0 || body.numColliders() === 0) {
    throw new Error('RigidBody.mass cannot be applied before the native body owns a positive-volume collider.');
  }
  applyDynamicBodyMass(body, value);
}

/** Godot 4 `RigidBody3D.FREEZE_MODE_STATIC`. */
export const RIGID_BODY_FREEZE_MODE_STATIC = 0;
/** Godot 4 `RigidBody3D.FREEZE_MODE_KINEMATIC`. */
export const RIGID_BODY_FREEZE_MODE_KINEMATIC = 1;

const FREEZE_MODE = new WeakMap<object, number>();

/** Whether the live Rapier body has been removed from dynamic simulation. */
export function getRigidBodyFreeze(body: FreezableRigidBodyLike): boolean {
  return body.bodyType() !== RigidBodyType.Dynamic;
}

/**
 * Toggle Godot 4's frozen state on the native body. Static freeze uses a fixed Rapier body;
 * kinematic freeze uses a position-based kinematic body so authored transform writes still move it.
 */
export function setRigidBodyFreeze(body: FreezableRigidBodyLike, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody3D.freeze must be bool.');
  if (!value) {
    body.setBodyType(RigidBodyType.Dynamic, true);
    return;
  }
  body.setBodyType(
    getRigidBodyFreezeMode(body) === RIGID_BODY_FREEZE_MODE_KINEMATIC
      ? RigidBodyType.KinematicPositionBased
      : RigidBodyType.Fixed,
    true,
  );
}

/** The retained mode is meaningful while unfrozen too, exactly as Godot's property is. */
export function getRigidBodyFreezeMode(body: FreezableRigidBodyLike): number {
  return FREEZE_MODE.get(body) ?? RIGID_BODY_FREEZE_MODE_STATIC;
}

/** Change the freeze representation immediately when the body is already frozen. */
export function setRigidBodyFreezeMode(body: FreezableRigidBodyLike, value: number): void {
  if (value !== RIGID_BODY_FREEZE_MODE_STATIC && value !== RIGID_BODY_FREEZE_MODE_KINEMATIC) {
    throw new RangeError('RigidBody3D.freeze_mode must be FREEZE_MODE_STATIC (0) or FREEZE_MODE_KINEMATIC (1).');
  }
  const frozen = getRigidBodyFreeze(body);
  FREEZE_MODE.set(body, value);
  if (frozen) setRigidBodyFreeze(body, true);
}

export function getRigidBodyGravityScale(body: ConfigurableRigidBody3DLike): number {
  return FORCE_INTEGRATION.get(body)?.gravityScale ?? body.gravityScale();
}

export function setRigidBodyGravityScale(body: ConfigurableRigidBody3DLike, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError('RigidBody.gravity_scale must be finite.');
  const state = FORCE_INTEGRATION.get(body);
  if (state !== undefined) state.gravityScale = value;
  body.setGravityScale(state?.customIntegrator === true ? 0 : value, true);
}

export function getRigidBodyLinearDamp(body: ConfigurableRigidBody3DLike): number {
  return FORCE_INTEGRATION.get(body)?.linearDamp ?? body.linearDamping();
}

export function setRigidBodyLinearDamp(body: ConfigurableRigidBody3DLike, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('RigidBody.linear_damp must be a finite non-negative number.');
  }
  const state = FORCE_INTEGRATION.get(body);
  if (state !== undefined) state.linearDamp = value;
  body.setLinearDamping(state?.customIntegrator === true ? 0 : value);
  body.wakeUp();
}

export function getRigidBodyAngularDamp(body: ConfigurableRigidBody3DLike): number {
  return FORCE_INTEGRATION.get(body)?.angularDamp ?? body.angularDamping();
}

export function setRigidBodyAngularDamp(body: ConfigurableRigidBody3DLike, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('RigidBody.angular_damp must be a finite non-negative number.');
  }
  const state = FORCE_INTEGRATION.get(body);
  if (state !== undefined) state.angularDamp = value;
  body.setAngularDamping(state?.customIntegrator === true ? 0 : value);
  body.wakeUp();
}

export function getRigidBodySleeping(body: ConfigurableRigidBody3DLike): boolean {
  return body.isSleeping();
}

export function setRigidBodySleeping(body: ConfigurableRigidBody3DLike, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody.sleeping must be bool.');
  if (value) body.sleep();
  else body.wakeUp();
}

export function getRigidBodyContinuousCd(body: ConfigurableRigidBody3DLike): boolean {
  return body.isCcdEnabled();
}

export function setRigidBodyContinuousCd(body: ConfigurableRigidBody3DLike, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody.continuous_cd must be bool.');
  body.enableCcd(value);
}

function finiteImpulse3D(value: Vector3Like, member: string): Vector3Like {
  if (![value?.x, value?.y, value?.z].every(Number.isFinite)) {
    throw new TypeError(`${member} requires a finite Vector3.`);
  }
  return { x: value.x, y: value.y, z: value.z };
}

export function applyRigidBodyCentralImpulse3D(
  body: DrivenRigidBody3DLike,
  impulse: Vector3Like,
): void {
  body.applyImpulse(finiteImpulse3D(impulse, 'RigidBody3D.apply_central_impulse'), true);
}

/** Godot 4 order: impulse first, world-space offset from the body's center second. */
export function applyRigidBodyImpulse3D(
  body: DrivenRigidBody3DLike,
  impulse: Vector3Like,
  position: Vector3Like = { x: 0, y: 0, z: 0 },
): void {
  const offset = finiteImpulse3D(position, 'RigidBody3D.apply_impulse position');
  const center = body.translation();
  body.applyImpulseAtPoint(
    finiteImpulse3D(impulse, 'RigidBody3D.apply_impulse impulse'),
    { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z },
    true,
  );
}

/** Godot 3 order: position first, impulse second. */
export function applyRigidBodyImpulse3(
  body: DrivenRigidBody3DLike,
  position: Vector3Like,
  impulse: Vector3Like,
): void {
  applyRigidBodyImpulse3D(body, impulse, position);
}

export function applyRigidBodyTorqueImpulse3D(
  body: DrivenRigidBody3DLike,
  impulse: Vector3Like,
): void {
  body.applyTorqueImpulse(finiteImpulse3D(impulse, 'RigidBody3D.apply_torque_impulse'), true);
}

export function addRigidBodyCentralForce3D(body: DrivenRigidBody3DLike, force: Vector3Like): void {
  body.addForce(finiteImpulse3D(force, 'RigidBody3D.apply_central_force'), true);
}

export function addRigidBodyForce3D(
  body: DrivenRigidBody3DLike,
  force: Vector3Like,
  position: Vector3Like = { x: 0, y: 0, z: 0 },
): void {
  const offset = finiteImpulse3D(position, 'RigidBody3D.apply_force position');
  const center = body.translation();
  body.addForceAtPoint(
    finiteImpulse3D(force, 'RigidBody3D.apply_force force'),
    { x: center.x + offset.x, y: center.y + offset.y, z: center.z + offset.z },
    true,
  );
}

export function addRigidBodyForce3(
  body: DrivenRigidBody3DLike,
  force: Vector3Like,
  position: Vector3Like,
): void {
  addRigidBodyForce3D(body, force, position);
}

export function addRigidBodyTorque3D(body: DrivenRigidBody3DLike, torque: Vector3Like): void {
  body.addTorque(finiteImpulse3D(torque, 'RigidBody3D.apply_torque'), true);
}

/** Replace velocity along the supplied axis while preserving both perpendicular components. */
export function setRigidBodyAxisVelocity3D(
  body: RigidBody3DLike,
  axisVelocity: Vector3Like,
): void {
  const axis = finiteImpulse3D(axisVelocity, 'RigidBody3D.set_axis_velocity');
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (length === 0) return;
  const normal = { x: axis.x / length, y: axis.y / length, z: axis.z / length };
  const current = body.linvel();
  const along = current.x * normal.x + current.y * normal.y + current.z * normal.z;
  body.setLinvel({
    x: current.x - normal.x * along + axis.x,
    y: current.y - normal.y * along + axis.y,
    z: current.z - normal.z * along + axis.z,
  }, true);
}

export function getRigidBodyConstantForce3D(body: DrivenRigidBody3DLike): Vector3 {
  const force = body.userForce();
  return vec3(force.x, force.y, force.z);
}

export function setRigidBodyConstantForce3D(
  body: DrivenRigidBody3DLike,
  value: Vector3Like,
): void {
  const force = finiteImpulse3D(value, 'RigidBody3D.constant_force');
  body.resetForces(true);
  body.addForce(force, true);
}

export function getRigidBodyConstantTorque3D(body: DrivenRigidBody3DLike): Vector3 {
  const torque = body.userTorque();
  return vec3(torque.x, torque.y, torque.z);
}

export function setRigidBodyConstantTorque3D(
  body: DrivenRigidBody3DLike,
  value: Vector3Like,
): void {
  const torque = finiteImpulse3D(value, 'RigidBody3D.constant_torque');
  body.resetTorques(true);
  body.addTorque(torque, true);
}

export function getRigidBodyLockRotation3D(body: RotationLockableRigidBody3DLike): boolean {
  return body.areRotationsLocked();
}

export function setRigidBodyLockRotation3D(
  body: RotationLockableRigidBody3DLike,
  value: boolean,
): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody3D.lock_rotation must be bool.');
  body.lockRotations(value, true);
}
