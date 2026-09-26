/** Read/write PhysicsServer2D body state for native bodies already registered by emitted scenes. */
import RAPIER from '@dimforge/rapier2d-compat';
import type { CollisionLayers } from './collision-layers';
import { addCollisionExceptionWith, removeCollisionExceptionWith, type CollisionExceptions } from './collision-exceptions';
import type { GodotRid } from './gdscript-builtins';
import { godotObjectInstanceId } from './object';
import {
  physicsBody2DOfRid,
  physicsObject2DOfBodyRid,
  physicsRid2DOfBody,
  physicsSpaceRid2D,
  physicsWorld2DOfRid,
} from './physics-query-2d';
import type { GodotTransform2D } from './transform-2d';
import { vec2, type Vector2 } from './vector2';

export const BODY_STATE_TRANSFORM_2D = 0;
export const BODY_STATE_LINEAR_VELOCITY_2D = 1;
export const BODY_STATE_ANGULAR_VELOCITY_2D = 2;
export const BODY_STATE_SLEEPING_2D = 3;
export const BODY_STATE_CAN_SLEEP_2D = 4;
export const BODY_MODE_STATIC_2D = 0;
export const BODY_MODE_KINEMATIC_2D = 1;
export const BODY_MODE_RIGID_2D = 2;
export const BODY_MODE_RIGID_LINEAR_2D = 3;
export const BODY_PARAM_BOUNCE_2D = 0;
export const BODY_PARAM_FRICTION_2D = 1;
export const BODY_PARAM_MASS_2D = 2;
export const BODY_PARAM_INERTIA_2D = 3;
export const BODY_PARAM_CENTER_OF_MASS_2D = 4;
export const BODY_PARAM_GRAVITY_SCALE_2D = 5;
export const BODY_PARAM_LINEAR_DAMP_MODE_2D = 6;
export const BODY_PARAM_ANGULAR_DAMP_MODE_2D = 7;
export const BODY_PARAM_LINEAR_DAMP_2D = 8;
export const BODY_PARAM_ANGULAR_DAMP_2D = 9;
export const SPACE_PARAM_CONTACT_MAX_SEPARATION_2D = 1;
export const SPACE_PARAM_CONTACT_MAX_ALLOWED_PENETRATION_2D = 2;
export const SPACE_PARAM_SOLVER_ITERATIONS_2D = 8;

export interface PhysicsServerBody2DOptions {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly resolveCollider?: (collider: RAPIER.Collider) => unknown;
  readonly exceptions?: CollisionExceptions;
}

interface BodyDampModes { linear: number; angular: number }
const DAMP_MODES = new WeakMap<object, BodyDampModes>();
const SERVER_MODE = new WeakMap<object, number>();
interface BodyMassProperties {
  readonly colliderMasses: number[];
  mass: number;
  inertia: number;
  center: Vector2;
  automaticInertia: boolean;
  automaticCenter: boolean;
}
const MASS_PROPERTIES = new WeakMap<object, BodyMassProperties>();
const MAX_CONTACTS = new WeakMap<object, number>();
interface OmitForceIntegrationState { enabled: boolean; gravityScale: number; linearDamping: number; angularDamping: number }
const OMIT_FORCE_INTEGRATION = new WeakMap<object, OmitForceIntegrationState>();
const CCD_MODE = new WeakMap<object, number>();
const ATTACHED_OBJECT_ID = new WeakMap<object, bigint>();
const ATTACHED_CANVAS_ID = new WeakMap<object, bigint>();
const CAN_SLEEP = new WeakMap<object, boolean>();
const SHAPE_METADATA = new WeakMap<object, Map<number, unknown>>();
const COLLISION_PRIORITY = new WeakMap<object, number>();

function bodyInWorld(options: PhysicsServerBody2DOptions, rid: GodotRid): RAPIER.RigidBody {
  const body = physicsBody2DOfRid(rid);
  if (options.world.getRigidBody(body.handle) !== body) {
    throw new Error('PhysicsServer2D body RID belongs to a different registered native space');
  }
  return body;
}

function requireSpace(options: PhysicsServerBody2DOptions, rid: GodotRid): RAPIER.World {
  const world = physicsWorld2DOfRid(rid);
  if (world !== options.world) throw new Error('PhysicsServer2D space RID belongs to a different registered native space');
  return world;
}

export function physicsServerSpaceSetActive2D(options: PhysicsServerBody2DOptions, rid: GodotRid, active: boolean): void {
  requireSpace(options, rid);
  if (active !== true) throw new Error('PhysicsServer2D.space_set_active(false) cannot stop the host-owned native Rapier world scheduler');
}

export function physicsServerSpaceIsActive2D(options: PhysicsServerBody2DOptions, rid: GodotRid): boolean {
  requireSpace(options, rid);
  return true;
}

export function physicsServerSpaceSetParam2D(options: PhysicsServerBody2DOptions, rid: GodotRid, parameter: number, value: number): void {
  const world = requireSpace(options, rid);
  const amount = finiteNumber(value, 'PhysicsServer2D space parameter');
  if (amount < 0) throw new Error('PhysicsServer2D space parameter must be non-negative');
  switch (parameter) {
    case SPACE_PARAM_CONTACT_MAX_SEPARATION_2D:
      world.integrationParameters.normalizedPredictionDistance = amount / world.integrationParameters.lengthUnit;
      return;
    case SPACE_PARAM_CONTACT_MAX_ALLOWED_PENETRATION_2D:
      world.integrationParameters.normalizedAllowedLinearError = amount / world.integrationParameters.lengthUnit;
      return;
    case SPACE_PARAM_SOLVER_ITERATIONS_2D:
      if (!Number.isInteger(amount) || amount < 1) throw new Error('PhysicsServer2D solver iterations must be a positive integer');
      world.integrationParameters.numSolverIterations = amount;
      return;
    default: throw new Error(`PhysicsServer2D space parameter ${String(parameter)} has no equivalent mutable Rapier integration parameter`);
  }
}

export function physicsServerSpaceGetParam2D(options: PhysicsServerBody2DOptions, rid: GodotRid, parameter: number): number {
  const integration = requireSpace(options, rid).integrationParameters;
  switch (parameter) {
    case SPACE_PARAM_CONTACT_MAX_SEPARATION_2D: return integration.normalizedPredictionDistance * integration.lengthUnit;
    case SPACE_PARAM_CONTACT_MAX_ALLOWED_PENETRATION_2D: return integration.normalizedAllowedLinearError * integration.lengthUnit;
    case SPACE_PARAM_SOLVER_ITERATIONS_2D: return integration.numSolverIterations;
    default: throw new Error(`PhysicsServer2D space parameter ${String(parameter)} has no equivalent readable Rapier integration parameter`);
  }
}

function bodyTransform(body: RAPIER.RigidBody): GodotTransform2D {
  const angle = body.rotation();
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const position = body.translation();
  return { x: vec2(c, s), y: vec2(-s, c), origin: vec2(position.x, position.y) };
}

function transformPose(value: GodotTransform2D): { position: Vector2; rotation: number } {
  const xLength = Math.hypot(value.x.x, value.x.y);
  const yLength = Math.hypot(value.y.x, value.y.y);
  const dot = value.x.x * value.y.x + value.x.y * value.y.y;
  const determinant = value.x.x * value.y.y - value.x.y * value.y.x;
  if (![value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y].every(Number.isFinite) || Math.abs(xLength - 1) > 1e-6 || Math.abs(yLength - 1) > 1e-6 || Math.abs(dot) > 1e-6 || Math.abs(determinant - 1) > 1e-6) {
    throw new Error('PhysicsServer2D BODY_STATE_TRANSFORM must be a finite rigid Transform2D');
  }
  return { position: vec2(value.origin.x, value.origin.y), rotation: Math.atan2(value.x.y, value.x.x) };
}

function finiteVector(value: Readonly<Vector2>, name: string): Vector2 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error(`${name} must contain finite coordinates`);
  return vec2(value.x, value.y);
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function uint32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${name} must be a uint32`);
  return value;
}

export function physicsServerBodyGetState2D(
  options: PhysicsServerBody2DOptions,
  rid: GodotRid,
  state: number,
): GodotTransform2D | Vector2 | number | boolean {
  const body = bodyInWorld(options, rid);
  switch (state) {
    case BODY_STATE_TRANSFORM_2D: return bodyTransform(body);
    case BODY_STATE_LINEAR_VELOCITY_2D: {
      const velocity = body.linvel();
      return vec2(velocity.x, velocity.y);
    }
    case BODY_STATE_ANGULAR_VELOCITY_2D: return body.angvel();
    case BODY_STATE_SLEEPING_2D: return body.isSleeping();
    case BODY_STATE_CAN_SLEEP_2D:
      return CAN_SLEEP.get(body) ?? true;
    default: throw new RangeError(`PhysicsServer2D body state ${String(state)} is outside BodyState`);
  }
}

export function physicsServerBodySetState2D(
  options: PhysicsServerBody2DOptions,
  rid: GodotRid,
  state: number,
  value: unknown,
): void {
  const body = bodyInWorld(options, rid);
  switch (state) {
    case BODY_STATE_TRANSFORM_2D: {
      const pose = transformPose(value as GodotTransform2D);
      body.setTranslation(pose.position, true);
      body.setRotation(pose.rotation, true);
      if (body.isKinematic()) {
        body.setNextKinematicTranslation(pose.position);
        body.setNextKinematicRotation(pose.rotation);
      }
      return;
    }
    case BODY_STATE_LINEAR_VELOCITY_2D:
      body.setLinvel(finiteVector(value as Vector2, 'PhysicsServer2D BODY_STATE_LINEAR_VELOCITY'), true);
      return;
    case BODY_STATE_ANGULAR_VELOCITY_2D:
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('PhysicsServer2D BODY_STATE_ANGULAR_VELOCITY must be finite');
      body.setAngvel(value, true);
      return;
    case BODY_STATE_SLEEPING_2D:
      if (value === true) body.sleep();
      else if (value === false) body.wakeUp();
      else throw new Error('PhysicsServer2D BODY_STATE_SLEEPING must be boolean');
      return;
    case BODY_STATE_CAN_SLEEP_2D:
      if (value !== true) throw new Error('PhysicsServer2D BODY_STATE_CAN_SLEEP=false cannot be represented because Rapier has no runtime sleeping-eligibility setter');
      CAN_SLEEP.set(body, true);
      return;
    default: throw new RangeError(`PhysicsServer2D body state ${String(state)} is outside BodyState`);
  }
}

export function physicsServerBodyGetMode2D(options: PhysicsServerBody2DOptions, rid: GodotRid): number {
  const body = bodyInWorld(options, rid);
  const retained = SERVER_MODE.get(body);
  if (retained !== undefined) return retained;
  if (body.isFixed()) return BODY_MODE_STATIC_2D;
  if (body.isKinematic()) return BODY_MODE_KINEMATIC_2D;
  return BODY_MODE_RIGID_2D;
}

export function physicsServerBodySetMode2D(options: PhysicsServerBody2DOptions, major: 3 | 4, rid: GodotRid, mode: number): void {
  const body = bodyInWorld(options, rid);
  if (major === 3 && mode === BODY_MODE_RIGID_LINEAR_2D) {
    throw new Error('Physics2DServer BODY_MODE_CHARACTER cannot be represented because Rapier exposes no never-sleep body mode');
  }
  switch (mode) {
    case BODY_MODE_STATIC_2D:
      body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      SERVER_MODE.set(body, mode);
      return;
    case BODY_MODE_KINEMATIC_2D:
      body.lockRotations(false, true);
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      SERVER_MODE.set(body, mode);
      return;
    case BODY_MODE_RIGID_2D:
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.lockRotations(false, true);
      SERVER_MODE.set(body, mode);
      return;
    case BODY_MODE_RIGID_LINEAR_2D:
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.lockRotations(true, true);
      body.setAngvel(0, true);
      SERVER_MODE.set(body, mode);
      return;
    default: throw new RangeError(`PhysicsServer2D body mode ${String(mode)} is outside BodyMode`);
  }
}

export function physicsServerBodyGetCollisionLayer2D(options: PhysicsServerBody2DOptions, rid: GodotRid): number {
  const body = bodyInWorld(options, rid);
  return body.numColliders() === 0 ? 1 : options.layers.layerOf(body.collider(0));
}

export function physicsServerBodyGetCollisionMask2D(options: PhysicsServerBody2DOptions, rid: GodotRid): number {
  const body = bodyInWorld(options, rid);
  return body.numColliders() === 0 ? 1 : options.layers.maskOf(body.collider(0));
}

export function physicsServerBodySetCollisionLayer2D(options: PhysicsServerBody2DOptions, rid: GodotRid, layer: number): void {
  const body = bodyInWorld(options, rid);
  const value = uint32(layer, 'PhysicsServer2D collision layer');
  for (let index = 0; index < body.numColliders(); index += 1) options.layers.setLayer(body.collider(index), value);
}

export function physicsServerBodySetCollisionMask2D(options: PhysicsServerBody2DOptions, rid: GodotRid, mask: number): void {
  const body = bodyInWorld(options, rid);
  const value = uint32(mask, 'PhysicsServer2D collision mask');
  for (let index = 0; index < body.numColliders(); index += 1) options.layers.setMask(body.collider(index), value);
}

export function physicsServerBodySetCollisionPriority2D(options: PhysicsServerBody2DOptions, rid: GodotRid, priority: number): void {
  const body = bodyInWorld(options, rid);
  const value = finiteNumber(priority, 'PhysicsServer2D collision priority');
  if (value <= 0) throw new Error('PhysicsServer2D collision priority must be greater than zero');
  if (value !== 1) throw new Error('PhysicsServer2D non-default collision priority cannot be represented by Rapier integer dominance groups without changing collision response semantics');
  COLLISION_PRIORITY.set(body, value);
}

export function physicsServerBodyGetCollisionPriority2D(options: PhysicsServerBody2DOptions, rid: GodotRid): number {
  return COLLISION_PRIORITY.get(bodyInWorld(options, rid)) ?? 1;
}

export function physicsServerBodyAddCollisionException2D(options: PhysicsServerBody2DOptions, rid: GodotRid, exceptedRid: GodotRid): void {
  const body = bodyInWorld(options, rid);
  const excepted = bodyInWorld(options, exceptedRid);
  if (options.exceptions === undefined) throw new Error('PhysicsServer2D collision exceptions require the native world collision-exception registry');
  addCollisionExceptionWith(body, excepted, options.exceptions);
}

export function physicsServerBodyRemoveCollisionException2D(options: PhysicsServerBody2DOptions, rid: GodotRid, exceptedRid: GodotRid): void {
  const body = bodyInWorld(options, rid);
  const excepted = bodyInWorld(options, exceptedRid);
  if (options.exceptions === undefined) throw new Error('PhysicsServer2D collision exceptions require the native world collision-exception registry');
  removeCollisionExceptionWith(body, excepted, options.exceptions);
}

export function physicsBodyGetCollisionExceptions2D(
  options: PhysicsServerBody2DOptions,
  body: RAPIER.RigidBody,
): GodotRid[] {
  if (options.world.getRigidBody(body.handle) !== body) throw new Error('PhysicsBody2D belongs to a different registered native space');
  if (options.exceptions === undefined) throw new Error('PhysicsBody2D collision exceptions require the native world collision-exception registry');
  const result: GodotRid[] = [];
  for (const handle of options.exceptions.others(body.handle)) {
    const other = options.world.getRigidBody(handle);
    if (other !== null) result.push(physicsRid2DOfBody(other));
  }
  return result;
}

export function physicsServerBodyGetCollisionExceptions2D(options: PhysicsServerBody2DOptions, rid: GodotRid): GodotRid[] {
  return physicsBodyGetCollisionExceptions2D(options, bodyInWorld(options, rid));
}

export function physicsServerBodyGetShapeCount2D(options: PhysicsServerBody2DOptions, rid: GodotRid): number {
  return bodyInWorld(options, rid).numColliders();
}

export function physicsServerBodyGetShape2D(options: PhysicsServerBody2DOptions, rid: GodotRid, index: number): never {
  bodyCollider(options, rid, index);
  throw new Error('PhysicsServer2D.body_get_shape requires a registered Godot shape RID; a native Rapier collider shape has no first-party RID identity');
}

function bodyCollider(options: PhysicsServerBody2DOptions, rid: GodotRid, index: number): { body: RAPIER.RigidBody; collider: RAPIER.Collider } {
  const body = bodyInWorld(options, rid);
  if (!Number.isInteger(index) || index < 0 || index >= body.numColliders()) {
    throw new RangeError(`PhysicsServer2D body shape index ${String(index)} is outside the native body`);
  }
  return { body, collider: body.collider(index) };
}

export function physicsServerBodyGetShapeTransform2D(options: PhysicsServerBody2DOptions, rid: GodotRid, index: number): GodotTransform2D {
  const { body, collider } = bodyCollider(options, rid, index);
  const bodyPosition = body.translation();
  const bodyRotation = body.rotation();
  const colliderPosition = collider.translation();
  const dx = colliderPosition.x - bodyPosition.x;
  const dy = colliderPosition.y - bodyPosition.y;
  const inverseCos = Math.cos(bodyRotation);
  const inverseSin = Math.sin(bodyRotation);
  const localPosition = vec2(dx * inverseCos + dy * inverseSin, -dx * inverseSin + dy * inverseCos);
  const localRotation = collider.rotation() - bodyRotation;
  const c = Math.cos(localRotation);
  const s = Math.sin(localRotation);
  return { x: vec2(c, s), y: vec2(-s, c), origin: localPosition };
}

export function physicsServerBodySetShapeTransform2D(options: PhysicsServerBody2DOptions, rid: GodotRid, index: number, transform: GodotTransform2D): void {
  const { collider } = bodyCollider(options, rid, index);
  const pose = transformPose(transform);
  collider.setTranslationWrtParent(pose.position);
  collider.setRotationWrtParent(pose.rotation);
}

export function physicsServerBodySetShapeDisabled2D(options: PhysicsServerBody2DOptions, rid: GodotRid, index: number, disabled: boolean): void {
  if (typeof disabled !== 'boolean') throw new Error('PhysicsServer2D.body_set_shape_disabled requires a boolean');
  bodyCollider(options, rid, index).collider.setEnabled(!disabled);
}

export function physicsServerBodySetShapeMetadata2D(options: PhysicsServerBody2DOptions, rid: GodotRid, index: number, metadata: unknown): void {
  const { body } = bodyCollider(options, rid, index);
  const entries = SHAPE_METADATA.get(body) ?? new Map<number, unknown>();
  entries.set(index, metadata);
  SHAPE_METADATA.set(body, entries);
}

export function physicsServerBodyGetShapeMetadata2D(options: PhysicsServerBody2DOptions, rid: GodotRid, index: number): unknown {
  const { body } = bodyCollider(options, rid, index);
  return SHAPE_METADATA.get(body)?.get(index) ?? null;
}

export function physicsServerBodyGetObjectInstanceId2D(options: PhysicsServerBody2DOptions, rid: GodotRid): bigint {
  const body = bodyInWorld(options, rid);
  return ATTACHED_OBJECT_ID.get(body) ?? godotObjectInstanceId(physicsObject2DOfBodyRid(rid));
}

function instanceId(value: unknown, name: string): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Error(`${name} must be a non-negative Godot object instance ID`);
}

export function physicsServerBodyAttachObjectInstanceId2D(options: PhysicsServerBody2DOptions, rid: GodotRid, id: number | bigint): void {
  ATTACHED_OBJECT_ID.set(bodyInWorld(options, rid), instanceId(id, 'PhysicsServer2D object instance ID'));
}

export function physicsServerBodyAttachCanvasInstanceId2D(options: PhysicsServerBody2DOptions, rid: GodotRid, id: number | bigint): void {
  ATTACHED_CANVAS_ID.set(bodyInWorld(options, rid), instanceId(id, 'PhysicsServer2D canvas instance ID'));
}

export function physicsServerBodyGetCanvasInstanceId2D(options: PhysicsServerBody2DOptions, rid: GodotRid): bigint {
  return ATTACHED_CANVAS_ID.get(bodyInWorld(options, rid)) ?? 0n;
}

export function physicsServerBodyGetSpace2D(options: PhysicsServerBody2DOptions, rid: GodotRid): GodotRid {
  bodyInWorld(options, rid);
  return physicsSpaceRid2D(options.world);
}

export function physicsServerBodySetSpace2D(options: PhysicsServerBody2DOptions, rid: GodotRid, space: GodotRid): void {
  bodyInWorld(options, rid);
  const target = physicsWorld2DOfRid(space);
  if (target !== options.world) throw new Error('PhysicsServer2D.body_set_space cannot migrate a live native Rapier body between registered worlds');
}

function forcePoint(body: RAPIER.RigidBody, offset: Readonly<Vector2>): Vector2 {
  const local = finiteVector(offset, 'PhysicsServer2D force/impulse position');
  const position = body.translation();
  return vec2(position.x + local.x, position.y + local.y);
}

export function physicsServerBodyApplyCentralImpulse2D(options: PhysicsServerBody2DOptions, rid: GodotRid, impulse: Vector2): void {
  bodyInWorld(options, rid).applyImpulse(finiteVector(impulse, 'PhysicsServer2D central impulse'), true);
}

export function physicsServerBodyApplyImpulse2D(options: PhysicsServerBody2DOptions, rid: GodotRid, impulse: Vector2, position: Vector2 = vec2(0, 0)): void {
  const body = bodyInWorld(options, rid);
  body.applyImpulseAtPoint(finiteVector(impulse, 'PhysicsServer2D impulse'), forcePoint(body, position), true);
}

export function physicsServerBodyApplyTorqueImpulse2D(options: PhysicsServerBody2DOptions, rid: GodotRid, impulse: number): void {
  bodyInWorld(options, rid).applyTorqueImpulse(finiteNumber(impulse, 'PhysicsServer2D torque impulse'), true);
}

export function physicsServerBodyApplyCentralForce2D(options: PhysicsServerBody2DOptions, rid: GodotRid, force: Vector2): void {
  const body = bodyInWorld(options, rid);
  const value = finiteVector(force, 'PhysicsServer2D central force');
  body.applyImpulse(vec2(value.x * options.world.timestep, value.y * options.world.timestep), true);
}

export function physicsServerBodyApplyForce2D(options: PhysicsServerBody2DOptions, rid: GodotRid, force: Vector2, position: Vector2 = vec2(0, 0)): void {
  const body = bodyInWorld(options, rid);
  const value = finiteVector(force, 'PhysicsServer2D force');
  body.applyImpulseAtPoint(vec2(value.x * options.world.timestep, value.y * options.world.timestep), forcePoint(body, position), true);
}

export function physicsServerBodyApplyTorque2D(options: PhysicsServerBody2DOptions, rid: GodotRid, torque: number): void {
  bodyInWorld(options, rid).applyTorqueImpulse(finiteNumber(torque, 'PhysicsServer2D torque') * options.world.timestep, true);
}

export function physicsServerBodySetAxisVelocity2D(options: PhysicsServerBody2DOptions, rid: GodotRid, axisVelocity: Vector2): void {
  const body = bodyInWorld(options, rid);
  const axis = finiteVector(axisVelocity, 'PhysicsServer2D axis velocity');
  const length = Math.hypot(axis.x, axis.y);
  if (length === 0) return;
  const nx = axis.x / length;
  const ny = axis.y / length;
  const current = body.linvel();
  const along = current.x * nx + current.y * ny;
  body.setLinvel(vec2(current.x + nx * (length - along), current.y + ny * (length - along)), true);
}

export function physicsServerBodyAddConstantCentralForce2D(options: PhysicsServerBody2DOptions, rid: GodotRid, force: Vector2): void {
  bodyInWorld(options, rid).addForce(finiteVector(force, 'PhysicsServer2D constant central force'), true);
}

export function physicsServerBodyAddConstantForce2D(options: PhysicsServerBody2DOptions, rid: GodotRid, force: Vector2, position: Vector2 = vec2(0, 0)): void {
  const body = bodyInWorld(options, rid);
  body.addForceAtPoint(finiteVector(force, 'PhysicsServer2D constant force'), forcePoint(body, position), true);
}

export function physicsServerBodyAddConstantTorque2D(options: PhysicsServerBody2DOptions, rid: GodotRid, torque: number): void {
  bodyInWorld(options, rid).addTorque(finiteNumber(torque, 'PhysicsServer2D constant torque'), true);
}

export function physicsServerBodySetConstantForce2D(options: PhysicsServerBody2DOptions, rid: GodotRid, force: Vector2): void {
  const body = bodyInWorld(options, rid);
  body.resetForces(true);
  body.addForce(finiteVector(force, 'PhysicsServer2D constant force'), true);
}

export function physicsServerBodyGetConstantForce2D(options: PhysicsServerBody2DOptions, rid: GodotRid): Vector2 {
  const force = bodyInWorld(options, rid).userForce();
  return vec2(force.x, force.y);
}

export function physicsServerBodySetConstantTorque2D(options: PhysicsServerBody2DOptions, rid: GodotRid, torque: number): void {
  const body = bodyInWorld(options, rid);
  body.resetTorques(true);
  body.addTorque(finiteNumber(torque, 'PhysicsServer2D constant torque'), true);
}

export function physicsServerBodyGetConstantTorque2D(options: PhysicsServerBody2DOptions, rid: GodotRid): number {
  return bodyInWorld(options, rid).userTorque();
}

function normalizedBodyParameter(major: 3 | 4, parameter: number): number {
  if (major === 4 || parameter <= BODY_PARAM_INERTIA_2D) return parameter;
  if (parameter === 4) return BODY_PARAM_GRAVITY_SCALE_2D;
  if (parameter === 5) return BODY_PARAM_LINEAR_DAMP_2D;
  if (parameter === 6) return BODY_PARAM_ANGULAR_DAMP_2D;
  return parameter;
}

export function physicsServerBodyGetParam2D(options: PhysicsServerBody2DOptions, major: 3 | 4, rid: GodotRid, parameter: number): number | Vector2 {
  const body = bodyInWorld(options, rid);
  const param = normalizedBodyParameter(major, parameter);
  const collider = body.numColliders() === 0 ? undefined : body.collider(0);
  switch (param) {
    case BODY_PARAM_BOUNCE_2D: return collider?.restitution() ?? 0;
    case BODY_PARAM_FRICTION_2D: return collider?.friction() ?? 0;
    case BODY_PARAM_MASS_2D: return body.mass();
    case BODY_PARAM_INERTIA_2D: {
      const state = MASS_PROPERTIES.get(body);
      return state === undefined || state.automaticInertia ? 0 : state.inertia;
    }
    case BODY_PARAM_CENTER_OF_MASS_2D: {
      const state = MASS_PROPERTIES.get(body);
      return state === undefined || state.automaticCenter ? vec2(0, 0) : vec2(state.center.x, state.center.y);
    }
    case BODY_PARAM_GRAVITY_SCALE_2D: return OMIT_FORCE_INTEGRATION.get(body)?.gravityScale ?? body.gravityScale();
    case BODY_PARAM_LINEAR_DAMP_MODE_2D: return DAMP_MODES.get(body)?.linear ?? 0;
    case BODY_PARAM_ANGULAR_DAMP_MODE_2D: return DAMP_MODES.get(body)?.angular ?? 0;
    case BODY_PARAM_LINEAR_DAMP_2D: return OMIT_FORCE_INTEGRATION.get(body)?.linearDamping ?? body.linearDamping();
    case BODY_PARAM_ANGULAR_DAMP_2D: return OMIT_FORCE_INTEGRATION.get(body)?.angularDamping ?? body.angularDamping();
    default: throw new RangeError(`PhysicsServer2D body parameter ${String(parameter)} is outside BodyParameter`);
  }
}

function massProperties(body: RAPIER.RigidBody): BodyMassProperties {
  let state = MASS_PROPERTIES.get(body);
  if (state !== undefined) return state;
  const center = body.localCom();
  state = {
    colliderMasses: Array.from({ length: body.numColliders() }, (_, index) => body.collider(index).mass()),
    mass: body.mass(),
    inertia: body.principalInertia(),
    center: vec2(center.x, center.y),
    automaticInertia: true,
    automaticCenter: true,
  };
  MASS_PROPERTIES.set(body, state);
  return state;
}

function applyAutomaticMass(body: RAPIER.RigidBody, state: BodyMassProperties): void {
  body.setAdditionalMass(0, true);
  if (body.numColliders() === 0) {
    body.setAdditionalMassProperties(state.mass, state.center, state.inertia, true);
    body.recomputeMassPropertiesFromColliders();
    return;
  }
  const sourceTotal = state.colliderMasses.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < body.numColliders(); index += 1) {
    const weight = sourceTotal > 0
      ? (state.colliderMasses[index] ?? 0) / sourceTotal
      : 1 / Math.max(body.numColliders(), 1);
    body.collider(index).setMass(state.mass * weight);
  }
  body.recomputeMassPropertiesFromColliders();
}

function applyMassProperties(body: RAPIER.RigidBody, state: BodyMassProperties): void {
  applyAutomaticMass(body, state);
  const automaticCenter = body.localCom();
  const automaticInertia = body.principalInertia();
  state.center = state.automaticCenter ? vec2(automaticCenter.x, automaticCenter.y) : state.center;
  if (state.automaticInertia) {
    const dx = state.center.x - automaticCenter.x;
    const dy = state.center.y - automaticCenter.y;
    state.inertia = automaticInertia + state.mass * (dx * dx + dy * dy);
  }
  if (state.automaticCenter && state.automaticInertia) return;
  for (let index = 0; index < body.numColliders(); index += 1) body.collider(index).setMass(0);
  body.setAdditionalMassProperties(state.mass, state.center, state.inertia, true);
  body.recomputeMassPropertiesFromColliders();
}

export function physicsServerBodySetParam2D(options: PhysicsServerBody2DOptions, major: 3 | 4, rid: GodotRid, parameter: number, value: unknown): void {
  const body = bodyInWorld(options, rid);
  const param = normalizedBodyParameter(major, parameter);
  if (param === BODY_PARAM_MASS_2D || param === BODY_PARAM_INERTIA_2D || param === BODY_PARAM_CENTER_OF_MASS_2D) {
    const state = massProperties(body);
    if (param === BODY_PARAM_MASS_2D) {
      const mass = finiteNumber(value, 'PhysicsServer2D mass');
      if (mass <= 0) throw new Error('PhysicsServer2D mass must be greater than zero');
      state.mass = mass;
    } else if (param === BODY_PARAM_INERTIA_2D) {
      const inertia = finiteNumber(value, 'PhysicsServer2D inertia');
      if (inertia < 0) throw new Error('PhysicsServer2D inertia must be non-negative');
      state.automaticInertia = inertia === 0;
      if (inertia !== 0) state.inertia = inertia;
    } else {
      state.center = finiteVector(value as Vector2, 'PhysicsServer2D center of mass');
      state.automaticCenter = false;
    }
    applyMassProperties(body, state);
    return;
  }
  if (param === BODY_PARAM_BOUNCE_2D || param === BODY_PARAM_FRICTION_2D) {
    const coefficient = finiteNumber(value, param === BODY_PARAM_BOUNCE_2D ? 'PhysicsServer2D bounce' : 'PhysicsServer2D friction');
    if (coefficient < 0) throw new Error('PhysicsServer2D bounce/friction must be non-negative');
    for (let index = 0; index < body.numColliders(); index += 1) {
      if (param === BODY_PARAM_BOUNCE_2D) body.collider(index).setRestitution(coefficient);
      else body.collider(index).setFriction(coefficient);
    }
    return;
  }
  if (param === BODY_PARAM_GRAVITY_SCALE_2D) {
    const amount = finiteNumber(value, 'PhysicsServer2D gravity scale');
    const omitted = OMIT_FORCE_INTEGRATION.get(body);
    if (omitted?.enabled === true) omitted.gravityScale = amount;
    else body.setGravityScale(amount, true);
    return;
  }
  if (param === BODY_PARAM_LINEAR_DAMP_2D || param === BODY_PARAM_ANGULAR_DAMP_2D) {
    const amount = finiteNumber(value, param === BODY_PARAM_LINEAR_DAMP_2D ? 'PhysicsServer2D linear damp' : 'PhysicsServer2D angular damp');
    const omitted = OMIT_FORCE_INTEGRATION.get(body);
    if (omitted?.enabled === true) {
      if (param === BODY_PARAM_LINEAR_DAMP_2D) omitted.linearDamping = amount;
      else omitted.angularDamping = amount;
    } else if (param === BODY_PARAM_LINEAR_DAMP_2D) body.setLinearDamping(amount);
    else body.setAngularDamping(amount);
    return;
  }
  if (param === BODY_PARAM_LINEAR_DAMP_MODE_2D || param === BODY_PARAM_ANGULAR_DAMP_MODE_2D) {
    if (value !== 0 && value !== 1) throw new Error('PhysicsServer2D damp mode must be COMBINE (0) or REPLACE (1)');
    const modes = DAMP_MODES.get(body) ?? { linear: 0, angular: 0 };
    if (param === BODY_PARAM_LINEAR_DAMP_MODE_2D) modes.linear = value;
    else modes.angular = value;
    DAMP_MODES.set(body, modes);
    return;
  }
  throw new RangeError(`PhysicsServer2D body parameter ${String(parameter)} is outside BodyParameter`);
}

export function physicsServerBodyResetMassProperties2D(options: PhysicsServerBody2DOptions, rid: GodotRid): void {
  const body = bodyInWorld(options, rid);
  const state = massProperties(body);
  state.automaticCenter = true;
  state.automaticInertia = true;
  applyMassProperties(body, state);
}

export function physicsServerBodySetContinuousCollisionDetectionMode2D(options: PhysicsServerBody2DOptions, rid: GodotRid, mode: number): void {
  const body = bodyInWorld(options, rid);
  if (!Number.isInteger(mode) || mode < 0 || mode > 2) throw new RangeError(`PhysicsServer2D CCD mode ${String(mode)} is outside CCDMode`);
  body.enableCcd(mode !== 0);
  CCD_MODE.set(body, mode);
}

export function physicsServerBodyGetContinuousCollisionDetectionMode2D(options: PhysicsServerBody2DOptions, rid: GodotRid): number {
  const body = bodyInWorld(options, rid);
  return CCD_MODE.get(body) ?? (body.isCcdEnabled() ? 2 : 0);
}

export function physicsServerBodySetMaxContactsReported2D(options: PhysicsServerBody2DOptions, rid: GodotRid, amount: number): void {
  const body = bodyInWorld(options, rid);
  if (!Number.isInteger(amount) || amount < 0) throw new Error('PhysicsServer2D max contacts reported must be a non-negative integer');
  MAX_CONTACTS.set(body, amount);
}

export function physicsServerBodyGetMaxContactsReported2D(options: PhysicsServerBody2DOptions, rid: GodotRid): number {
  return MAX_CONTACTS.get(bodyInWorld(options, rid)) ?? 0;
}

export function physicsServerBodySetOmitForceIntegration2D(options: PhysicsServerBody2DOptions, rid: GodotRid, enabled: boolean): void {
  const body = bodyInWorld(options, rid);
  if (typeof enabled !== 'boolean') throw new Error('PhysicsServer2D omit force integration flag must be boolean');
  const current = OMIT_FORCE_INTEGRATION.get(body);
  if (enabled) {
    if (current?.enabled === true) return;
    const state = current ?? { enabled: true, gravityScale: body.gravityScale(), linearDamping: body.linearDamping(), angularDamping: body.angularDamping() };
    state.enabled = true;
    OMIT_FORCE_INTEGRATION.set(body, state);
    body.setGravityScale(0, true);
    body.setLinearDamping(0);
    body.setAngularDamping(0);
    return;
  }
  if (current === undefined || !current.enabled) return;
  current.enabled = false;
  body.setGravityScale(current.gravityScale, true);
  body.setLinearDamping(current.linearDamping);
  body.setAngularDamping(current.angularDamping);
}

export function physicsServerBodyIsOmittingForceIntegration2D(options: PhysicsServerBody2DOptions, rid: GodotRid): boolean {
  return OMIT_FORCE_INTEGRATION.get(bodyInWorld(options, rid))?.enabled ?? false;
}
