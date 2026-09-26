/**
 * `RigidBody2D.linear_velocity` and `CollisionShape2D.disabled` — over the
 * PORT'S own Rapier 2D objects.
 *
 * ## Two members, one refusal
 *
 * Godot's `RigidBody2D` is a single object that is simultaneously a transform
 * in the scene tree and a body in the physics world; its `CollisionShape2D`
 * child is simultaneously a tree node and a collider. Here those are two
 * objects with two owners — the `Container` in the display tree, the
 * body/collider in the Rapier world.
 *
 * A `Container → { body, collider }` link DOES exist in this repo:
 * `@vgai/engine/pixi/physics-registry`'s `Physics2DRegistry`, which play mode
 * and canvas ingest build so the engine's own postPhysics writer and collision
 * dispatch have a reverse index. The refusal is not that the shape is
 * unthinkable — it is that a TRANSLATED port does not populate it. An emitted
 * Godot port creates its Rapier bodies in its own setup and holds the refs
 * there; making these two members take a `Container` would mean compat either
 * reaching into an engine registry nothing has filled, or standing up a SECOND
 * one for itself and asking somebody to keep it in sync. That is general
 * supply, not translation — the same refusal `roblox-compat`'s `part.ts`
 * records for `CanCollide`. The port already holds the body ref its own setup
 * created; pass it.
 *
 * ## Why the Rapier types are structural
 *
 * A `RigidBody`'s `linvel()`/`setLinvel()` and a `Collider`'s
 * `isEnabled()`/`setEnabled()` are two methods each. Declaring
 * `@dimforge/rapier2d-compat` as a capability dependency for four method
 * signatures would make every project that copies this folder install a physics
 * engine it may not use — and Rapier's real classes satisfy these interfaces
 * structurally, so the call sites typecheck against the actual library either
 * way. (`roblox-compat`'s `ClickEventLike` records the same trade for fiber's
 * click payload.)
 *
 * ## `linear_velocity` is a demand the member table could not cite
 *
 * `Main.gd:49` is `mob.linear_velocity = velocity.rotated(direction)`, and
 * `gd-analyze` reports it unresolved: `mob` came from
 * `mob_scene.instance()` on an untyped `export(PackedScene)` var, so there is
 * no receiver class to attribute it to. It is implemented here on the strength
 * of the source; `packed-scene.ts` carries the whole story of that inference.
 *
 * ## Resource ownership
 *
 * Nothing. Every function here is a read or a write on an object the caller
 * already owns; there is no state, no registry and no teardown.
 */

import { Matrix, type Container, type PointData } from 'pixi.js';
import RAPIER from '@dimforge/rapier2d-compat';
import type { GodotTransform2D } from './transform-2d';
import { transform2DScale } from './transform-2d';
import { type Vector2, vec2 } from './vector2';

/**
 * The half of a Rapier 2D `RigidBody` this file touches.
 *
 * Structural on purpose — see this module's header. Rapier's own `RigidBody`
 * satisfies it.
 */
export interface LinearVelocityBody {
  linvel(): PointData;
  setLinvel(velocity: PointData, wakeUp: boolean): void;
}

/** Native angular velocity access on a retained Rapier 2D body. */
export interface AngularVelocityBody2D {
  angvel(): number;
  setAngvel(velocity: number, wakeUp: boolean): void;
}

/** Native Rapier 2D body/collider mass seam. */
export interface MassedRigidBody2DLike {
  mass(): number;
  numColliders(): number;
  collider(index: number): { density(): number; setDensity(density: number): void };
}

/** Native body-type seam behind Godot 4 `RigidBody2D.freeze`. */
export interface FreezableRigidBody2DLike {
  bodyType(): RAPIER.RigidBodyType;
  setBodyType(type: RAPIER.RigidBodyType, wakeUp: boolean): void;
}

export interface ConfigurableRigidBody2DLike {
  gravityScale(): number;
  setGravityScale(value: number, wakeUp: boolean): void;
  linearDamping(): number;
  setLinearDamping(value: number): void;
  angularDamping(): number;
  setAngularDamping(value: number): void;
  isSleeping(): boolean;
  sleep(): void;
  wakeUp(): void;
}

export interface DrivenRigidBody2DLike {
  applyImpulse(impulse: PointData, wakeUp: boolean): void;
  applyImpulseAtPoint(impulse: PointData, point: PointData, wakeUp: boolean): void;
  applyTorqueImpulse(impulse: number, wakeUp: boolean): void;
  addForce(force: PointData, wakeUp: boolean): void;
  addForceAtPoint(force: PointData, point: PointData, wakeUp: boolean): void;
  addTorque(torque: number, wakeUp: boolean): void;
  userForce(): PointData;
  userTorque(): number;
  resetForces(wakeUp: boolean): void;
  resetTorques(wakeUp: boolean): void;
  translation(): PointData;
}

export interface RotationLockableRigidBody2DLike {
  isRotationLocked(): boolean;
  lockRotations(locked: boolean, wakeUp: boolean): void;
}

export interface ContactCollider2DLike { readonly handle: unknown }
export interface ContactingRigidBody2DLike {
  numColliders(): number;
  collider(index: number): ContactCollider2DLike;
}
export interface ContactWorld2DLike {
  contactPairsWith(collider: ContactCollider2DLike, callback: (other: ContactCollider2DLike) => void): void;
}

/**
 * The half of a Rapier 2D `Collider` this file touches. Rapier's own `Collider`
 * satisfies it.
 */
export interface EnableableCollider {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
}

function isRigidTransform(matrix: Matrix): boolean {
  const epsilon = 1e-6;
  const xLength = Math.hypot(matrix.a, matrix.b);
  const yLength = Math.hypot(matrix.c, matrix.d);
  const orthogonal = matrix.a * matrix.c + matrix.b * matrix.d;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return (
    Math.abs(xLength - 1) <= epsilon &&
    Math.abs(yLength - 1) <= epsilon &&
    Math.abs(orthogonal) <= epsilon &&
    Math.abs(determinant - 1) <= epsilon
  );
}

/** Refuse a mounted transform Rapier cannot preserve instead of splitting render/solver identity. */
export function assertRigidBody2DTransform(node: Container, presentationRoot: Container): void {
  let current: Container | null = node;
  while (current !== presentationRoot) {
    if (current === null) {
      throw new Error('PhysicsBody2D is not mounted below the SceneTree presentation root.');
    }
    current.updateLocalTransform();
    if (!isRigidTransform(current.localTransform)) {
      throw new Error(
        `PhysicsBody2D \`${current.label || '<unnamed>'}\` has scale, skew, or reflection in its ` +
          'mounted transform chain; Rapier 2D can preserve only translation and rotation.',
      );
    }
    current = current.parent;
  }
}

/** Godot canvas-space transform with camera presentation removed. */
export function godotCanvasTransform2D(node: Container, presentationRoot: Container): Matrix {
  const rootGlobal = presentationRoot.getGlobalTransform(new Matrix());
  const nodeGlobal = node.getGlobalTransform(new Matrix());
  return rootGlobal.invert().append(nodeGlobal);
}

function transformValue(matrix: Matrix): GodotTransform2D {
  return {
    x: vec2(matrix.a, matrix.b),
    y: vec2(matrix.c, matrix.d),
    origin: vec2(matrix.tx, matrix.ty),
  };
}

function transformMatrix(value: GodotTransform2D, member: string): Matrix {
  const numbers = [
    value?.x?.x,
    value?.x?.y,
    value?.y?.x,
    value?.y?.y,
    value?.origin?.x,
    value?.origin?.y,
  ];
  if (numbers.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new TypeError(`${member} requires a finite Transform2D value.`);
  }
  return new Matrix(value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y);
}

/** `Node2D.global_transform` in logical canvas space, excluding Camera2D presentation. */
export function getCanvasGlobalTransform2D(
  node: Container,
  presentationRoot: Container,
): GodotTransform2D {
  return transformValue(godotCanvasTransform2D(node, presentationRoot));
}

export function setCanvasGlobalTransform2D(
  node: Container,
  presentationRoot: Container,
  value: GodotTransform2D,
): void {
  const desired = transformMatrix(value, 'Node2D.global_transform');
  const parent = node.parent ?? presentationRoot;
  const parentTransform = godotCanvasTransform2D(parent, presentationRoot);
  node.setFromMatrix(parentTransform.invert().append(desired));
}

/** Global rotation is Transform2D's X-axis angle; scale, skew, and reflection remain native. */
export function getCanvasGlobalRotation2D(
  node: Container,
  presentationRoot: Container,
): number {
  const transform = godotCanvasTransform2D(node, presentationRoot);
  return Math.atan2(transform.b, transform.a);
}

export function setCanvasGlobalRotation2D(
  node: Container,
  presentationRoot: Container,
  radians: number,
): void {
  if (!Number.isFinite(radians)) {
    throw new TypeError(`Node2D.global_rotation requires a finite number; received ${String(radians)}.`);
  }
  const current = godotCanvasTransform2D(node, presentationRoot);
  const delta = radians - Math.atan2(current.b, current.a);
  const cosine = Math.cos(delta);
  const sine = Math.sin(delta);
  // Rotate the complete GLOBAL basis, rather than adding an angle to the local Euler field: under
  // a non-uniformly scaled or skewed parent, global rotation is not the sum of local rotations.
  // Left-multiplying both basis columns preserves their lengths, skew, and determinant while the
  // origin stays fixed, then global_transform's parent solve recovers the exact local matrix.
  setCanvasGlobalTransform2D(node, presentationRoot, {
    x: vec2(cosine * current.a - sine * current.b, sine * current.a + cosine * current.b),
    y: vec2(cosine * current.c - sine * current.d, sine * current.c + cosine * current.d),
    origin: vec2(current.tx, current.ty),
  });
}

export function getCanvasGlobalRotationDegrees2D(
  node: Container,
  presentationRoot: Container,
): number {
  return getCanvasGlobalRotation2D(node, presentationRoot) * (180 / Math.PI);
}

export function setCanvasGlobalRotationDegrees2D(
  node: Container,
  presentationRoot: Container,
  degrees: number,
): void {
  if (!Number.isFinite(degrees)) {
    throw new TypeError(
      `Node2D.global_rotation_degrees requires a finite number; received ${String(degrees)}.`,
    );
  }
  setCanvasGlobalRotation2D(node, presentationRoot, degrees * (Math.PI / 180));
}

/** `Node2D.global_scale`, decomposed from the complete logical canvas basis. */
export function getCanvasGlobalScale2D(
  node: Container,
  presentationRoot: Container,
): Vector2 {
  const scale = transform2DScale(getCanvasGlobalTransform2D(node, presentationRoot));
  return vec2(scale.x, scale.y);
}

export function setCanvasGlobalScale2D(
  node: Container,
  presentationRoot: Container,
  value: PointData,
): void {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    throw new TypeError('Node2D.global_scale requires a finite Vector2.');
  }
  const current = godotCanvasTransform2D(node, presentationRoot);
  const currentScale = transform2DScale(transformValue(current));
  if (currentScale.x === 0 || currentScale.y === 0) {
    throw new Error('Node2D.global_scale cannot recover a collapsed global basis axis.');
  }
  const xFactor = value.x / currentScale.x;
  const yFactor = value.y / currentScale.y;
  setCanvasGlobalTransform2D(node, presentationRoot, {
    x: vec2(current.a * xFactor, current.b * xFactor),
    y: vec2(current.c * yFactor, current.d * yFactor),
    origin: vec2(current.tx, current.ty),
  });
}

export function toCanvasLocal2D(
  node: Container,
  presentationRoot: Container,
  globalPoint: PointData,
): Vector2 {
  if (!Number.isFinite(globalPoint?.x) || !Number.isFinite(globalPoint?.y)) {
    throw new TypeError('Node2D.to_local requires a finite Vector2 point.');
  }
  const local = godotCanvasTransform2D(node, presentationRoot).applyInverse(globalPoint);
  return vec2(local.x, local.y);
}

export function toCanvasGlobal2D(
  node: Container,
  presentationRoot: Container,
  localPoint: PointData,
): Vector2 {
  if (!Number.isFinite(localPoint?.x) || !Number.isFinite(localPoint?.y)) {
    throw new TypeError('Node2D.to_global requires a finite Vector2 point.');
  }
  const global = godotCanvasTransform2D(node, presentationRoot).apply(localPoint);
  return vec2(global.x, global.y);
}

/** `Node2D.global_position` in logical Godot canvas space, excluding Camera2D presentation. */
export function getCanvasGlobalPosition2D(
  node: Container,
  presentationRoot: Container,
): Vector2 {
  const point = godotCanvasTransform2D(node, presentationRoot).apply({ x: 0, y: 0 });
  return vec2(point.x, point.y);
}

/** `Node2D.look_at(point)` rotates the node's global +X axis toward a global canvas point. */
export function lookAtCanvas2D(
  node: Container,
  presentationRoot: Container,
  point: Vector2,
): void {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new TypeError('Node2D.look_at requires a finite global Vector2 point.');
  }
  const origin = getCanvasGlobalPosition2D(node, presentationRoot);
  setCanvasGlobalRotation2D(
    node,
    presentationRoot,
    Math.atan2(point.y - origin.y, point.x - origin.x),
  );
}

/** Set `Node2D.global_position` through the live native parent transform in logical canvas space. */
export function setCanvasGlobalPosition2D(
  node: Container,
  presentationRoot: Container,
  value: Vector2,
): void {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    throw new TypeError('Node2D.global_position must contain finite coordinates');
  }
  const parent = node.parent ?? presentationRoot;
  const local = godotCanvasTransform2D(parent, presentationRoot).applyInverse(value);
  node.position.set(local.x, local.y);
}

/** `body.linear_velocity` — as a `Vector2` VALUE, for the reason `node.ts`'s
 *  `getPosition` copies: a GDScript property read hands back a copy, and
 *  Rapier's `linvel()` returns a live vector object. */
export function getLinearVelocity(body: LinearVelocityBody): Vector2 {
  const velocity = body.linvel();
  return vec2(velocity.x, velocity.y);
}

/**
 * `body.linear_velocity = v` — `Main.gd:49`.
 *
 * Wakes the body, which Godot does implicitly: a rigid body Rapier has put to
 * sleep ignores a velocity write until something else touches it, and a mob
 * that spawns asleep simply never moves.
 *
 * `z?: never` is what makes this file's plain name safe to sit beside
 * `rigid-body-3d.ts`'s, which the barrel re-exports as `setLinearVelocity3D`.
 * A `Vector3` satisfies `PointData` on its own, so a 3D caller that reached for
 * the unsuffixed name COMPILED and then silently dropped the Z: Rapier read
 * `z: undefined`, the body's whole isometry went `NaN` on the first step, and
 * the projectile disappeared with no error anywhere. Now it is a type error at
 * the call site.
 */
export function setLinearVelocity(
  body: LinearVelocityBody,
  value: PointData & { readonly z?: never },
): void {
  body.setLinvel({ x: value.x, y: value.y }, true);
}

export function getAngularVelocity2D(body: AngularVelocityBody2D): number {
  return body.angvel();
}

export function setAngularVelocity2D(body: AngularVelocityBody2D, value: number): void {
  if (!Number.isFinite(value)) {
    throw new TypeError('RigidBody2D.angular_velocity must be a finite number.');
  }
  body.setAngvel(value, true);
}

/** Read Godot's total body mass from the native solver body. */
export function getRigidBodyMass2D(body: MassedRigidBody2DLike): number {
  return body.mass();
}

/** Distribute Godot's total body mass over its native colliders by their current volume. */
export function setRigidBodyMass2D(body: MassedRigidBody2DLike, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('RigidBody2D.mass must be finite and greater than zero.');
  }
  const derivedMass = body.mass();
  if (derivedMass <= 0 || body.numColliders() === 0) {
    throw new Error('RigidBody2D.mass cannot be applied before the native body owns a positive-area collider.');
  }
  const scale = value / derivedMass;
  for (let index = 0; index < body.numColliders(); index += 1) {
    const collider = body.collider(index);
    collider.setDensity(collider.density() * scale);
  }
}

const FREEZE_MODE_2D = new WeakMap<object, number>();

export const RIGID_BODY_2D_FREEZE_MODE_STATIC = 0;
export const RIGID_BODY_2D_FREEZE_MODE_KINEMATIC = 1;

export function getRigidBodyFreeze2D(body: FreezableRigidBody2DLike): boolean {
  return body.bodyType() !== RAPIER.RigidBodyType.Dynamic;
}

export function setRigidBodyFreeze2D(body: FreezableRigidBody2DLike, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody2D.freeze must be bool.');
  if (!value) {
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    return;
  }
  body.setBodyType(
    getRigidBodyFreezeMode2D(body) === RIGID_BODY_2D_FREEZE_MODE_KINEMATIC
      ? RAPIER.RigidBodyType.KinematicPositionBased
      : RAPIER.RigidBodyType.Fixed,
    true,
  );
}

export function getRigidBodyFreezeMode2D(body: FreezableRigidBody2DLike): number {
  return FREEZE_MODE_2D.get(body) ?? RIGID_BODY_2D_FREEZE_MODE_STATIC;
}

export function setRigidBodyFreezeMode2D(body: FreezableRigidBody2DLike, value: number): void {
  if (value !== RIGID_BODY_2D_FREEZE_MODE_STATIC && value !== RIGID_BODY_2D_FREEZE_MODE_KINEMATIC) {
    throw new RangeError('RigidBody2D.freeze_mode must be FREEZE_MODE_STATIC (0) or FREEZE_MODE_KINEMATIC (1).');
  }
  const frozen = getRigidBodyFreeze2D(body);
  FREEZE_MODE_2D.set(body, value);
  if (frozen) setRigidBodyFreeze2D(body, true);
}

export function getRigidBodyGravityScale2D(body: ConfigurableRigidBody2DLike): number {
  return body.gravityScale();
}

export function setRigidBodyGravityScale2D(body: ConfigurableRigidBody2DLike, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError('RigidBody2D.gravity_scale must be finite.');
  body.setGravityScale(value, true);
}

export function getRigidBodyLinearDamp2D(body: ConfigurableRigidBody2DLike): number {
  return body.linearDamping();
}

export function setRigidBodyLinearDamp2D(body: ConfigurableRigidBody2DLike, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('RigidBody2D.linear_damp must be a finite non-negative number.');
  }
  body.setLinearDamping(value);
}

export function getRigidBodyAngularDamp2D(body: ConfigurableRigidBody2DLike): number {
  return body.angularDamping();
}

export function setRigidBodyAngularDamp2D(body: ConfigurableRigidBody2DLike, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('RigidBody2D.angular_damp must be a finite non-negative number.');
  }
  body.setAngularDamping(value);
}

export function getRigidBodySleeping2D(body: ConfigurableRigidBody2DLike): boolean {
  return body.isSleeping();
}

export function setRigidBodySleeping2D(body: ConfigurableRigidBody2DLike, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody2D.sleeping must be bool.');
  if (value) body.sleep();
  else body.wakeUp();
}

function finiteDriveVector2D(value: PointData, member: string): PointData {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    throw new TypeError(`${member} requires a finite Vector2.`);
  }
  return { x: value.x, y: value.y };
}

export function applyRigidBodyCentralImpulse2D(
  body: DrivenRigidBody2DLike,
  impulse: PointData,
): void {
  body.applyImpulse(finiteDriveVector2D(impulse, 'RigidBody2D.apply_central_impulse'), true);
}

/** Godot 4 argument order: impulse, position offset. */
export function applyRigidBodyImpulse2D(
  body: DrivenRigidBody2DLike,
  impulse: PointData,
  position: PointData = { x: 0, y: 0 },
): void {
  const offset = finiteDriveVector2D(position, 'RigidBody2D.apply_impulse position');
  const center = body.translation();
  body.applyImpulseAtPoint(
    finiteDriveVector2D(impulse, 'RigidBody2D.apply_impulse impulse'),
    { x: center.x + offset.x, y: center.y + offset.y },
    true,
  );
}

/** Godot 3 argument order: offset, impulse. */
export function applyRigidBodyImpulse2DLegacy(
  body: DrivenRigidBody2DLike,
  offset: PointData,
  impulse: PointData,
): void {
  applyRigidBodyImpulse2D(body, impulse, offset);
}

export function applyRigidBodyImpulse2DDialect(
  body: DrivenRigidBody2DLike,
  godotMajor: 3 | 4,
  first: PointData,
  second?: PointData,
): void {
  if (godotMajor === 3) {
    if (second === undefined) {
      throw new TypeError('Godot 3 RigidBody2D.apply_impulse requires offset and impulse.');
    }
    applyRigidBodyImpulse2DLegacy(body, first, second);
    return;
  }
  applyRigidBodyImpulse2D(body, first, second);
}

export function applyRigidBodyTorqueImpulse2D(
  body: DrivenRigidBody2DLike,
  impulse: number,
): void {
  if (!Number.isFinite(impulse)) {
    throw new TypeError('RigidBody2D.apply_torque_impulse requires a finite number.');
  }
  body.applyTorqueImpulse(impulse, true);
}

export function addRigidBodyCentralForce2D(body: DrivenRigidBody2DLike, force: PointData): void {
  body.addForce(finiteDriveVector2D(force, 'RigidBody2D.apply_central_force'), true);
}

export function addRigidBodyForce2D(
  body: DrivenRigidBody2DLike,
  force: PointData,
  position: PointData = { x: 0, y: 0 },
): void {
  const offset = finiteDriveVector2D(position, 'RigidBody2D.apply_force position');
  const center = body.translation();
  body.addForceAtPoint(
    finiteDriveVector2D(force, 'RigidBody2D.apply_force force'),
    { x: center.x + offset.x, y: center.y + offset.y },
    true,
  );
}

export function addRigidBodyForce2DLegacy(
  body: DrivenRigidBody2DLike,
  offset: PointData,
  force: PointData,
): void {
  addRigidBodyForce2D(body, force, offset);
}

export function addRigidBodyForce2DDialect(
  body: DrivenRigidBody2DLike,
  godotMajor: 3 | 4,
  first: PointData,
  second?: PointData,
): void {
  if (godotMajor === 3) {
    if (second === undefined) {
      throw new TypeError('Godot 3 RigidBody2D.add_force requires offset and force.');
    }
    addRigidBodyForce2DLegacy(body, first, second);
    return;
  }
  addRigidBodyForce2D(body, first, second);
}

export function addRigidBodyTorque2D(body: DrivenRigidBody2DLike, torque: number): void {
  if (!Number.isFinite(torque)) {
    throw new TypeError('RigidBody2D.apply_torque requires a finite number.');
  }
  body.addTorque(torque, true);
}

export function setRigidBodyAxisVelocity2D(
  body: LinearVelocityBody,
  axisVelocity: PointData,
): void {
  const axis = finiteDriveVector2D(axisVelocity, 'RigidBody2D.set_axis_velocity');
  const length = Math.hypot(axis.x, axis.y);
  if (length === 0) return;
  const normal = { x: axis.x / length, y: axis.y / length };
  const current = body.linvel();
  const along = current.x * normal.x + current.y * normal.y;
  body.setLinvel({
    x: current.x - normal.x * along + axis.x,
    y: current.y - normal.y * along + axis.y,
  }, true);
}

export function getRigidBodyLockRotation2D(body: RotationLockableRigidBody2DLike): boolean {
  return body.isRotationLocked();
}

export function setRigidBodyLockRotation2D(
  body: RotationLockableRigidBody2DLike,
  value: boolean,
): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody2D.lock_rotation must be bool.');
  body.lockRotations(value, true);
}

export function getRigidBodyConstantForce2D(body: DrivenRigidBody2DLike): Vector2 {
  const force = body.userForce();
  return vec2(force.x, force.y);
}

export function setRigidBodyConstantForce2D(
  body: DrivenRigidBody2DLike,
  value: PointData,
): void {
  const force = finiteDriveVector2D(value, 'RigidBody2D.constant_force');
  body.resetForces(true);
  body.addForce(force, true);
}

export function getRigidBodyConstantTorque2D(body: DrivenRigidBody2DLike): number {
  return body.userTorque();
}

export function setRigidBodyConstantTorque2D(
  body: DrivenRigidBody2DLike,
  value: number,
): void {
  if (!Number.isFinite(value)) {
    throw new TypeError('RigidBody2D.constant_torque must be a finite number.');
  }
  body.resetTorques(true);
  body.addTorque(value, true);
}

const CONTACT_MONITOR_2D = new WeakMap<object, boolean>();
const CONTACTS_REPORTED_2D = new WeakMap<object, number>();

export function getRigidBodyContactMonitor2D(body: object): boolean {
  return CONTACT_MONITOR_2D.get(body) ?? false;
}

export function setRigidBodyContactMonitor2D(body: object, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('RigidBody2D.contact_monitor must be bool.');
  CONTACT_MONITOR_2D.set(body, value);
}

export function getRigidBodyContactsReported2D(body: object): number {
  return CONTACTS_REPORTED_2D.get(body) ?? 0;
}

export function setRigidBodyContactsReported2D(body: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('RigidBody2D contacts reported must be a non-negative integer.');
  }
  CONTACTS_REPORTED_2D.set(body, value);
}

export function getRigidBodyCollidingBodies2D(
  world: ContactWorld2DLike,
  body: ContactingRigidBody2DLike,
  resolveCollider: (collider: ContactCollider2DLike) => unknown,
): readonly unknown[] {
  if (!getRigidBodyContactMonitor2D(body)) return [];
  const limit = getRigidBodyContactsReported2D(body);
  if (limit <= 0) return [];
  const owners: unknown[] = [];
  const seen = new Set<unknown>();
  for (let index = 0; index < body.numColliders() && owners.length < limit; index += 1) {
    world.contactPairsWith(body.collider(index), (other) => {
      if (owners.length >= limit) return;
      const owner = resolveCollider(other);
      if (owner === null || owner === undefined || seen.has(owner)) return;
      seen.add(owner);
      owners.push(owner);
    });
  }
  return owners;
}

/** `collision_shape.disabled` — `Player.gd:47` sets it false, `:54` sets it
 *  true (deferred). Godot's `disabled` is the inverse of Rapier's `enabled`. */
export function isDisabled(collider: EnableableCollider): boolean {
  return !collider.isEnabled();
}

/**
 * `collision_shape.disabled = value`.
 *
 * `Player.gd:54` reaches this through `set_deferred`, and that is not
 * decoration: the call happens inside a `body_entered` handler, i.e. inside the
 * physics step, where mutating a collider is exactly what Rapier's own docs
 * forbid. `deferred.ts` is what makes the write land after the step instead.
 */
export function setDisabled(collider: EnableableCollider, disabled: boolean): void {
  collider.setEnabled(!disabled);
}
