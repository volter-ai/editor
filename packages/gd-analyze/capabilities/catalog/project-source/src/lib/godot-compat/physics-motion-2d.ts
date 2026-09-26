/** Godot 3.6/4.x body motion tests over registered native Rapier 2D bodies. */
import RAPIER, { QueryFilterFlags } from '@dimforge/rapier2d-compat';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import type { GodotRid } from './gdscript-builtins';
import { godotObjectInstanceId } from './object';
import {
  physicsBody2DOfRid,
  physicsRid2DOf,
  physicsRid2DOfBody,
  physicsVelocityAtPoint2D,
  shapeCastBody2DOf,
} from './physics-query-2d';
import { TRANSFORM2D_IDENTITY, type GodotTransform2D } from './transform-2d';
import { vec2, type Vector2 } from './vector2';

const DEFAULT_MARGIN = 0.08;
const BINARY_STEPS = 8;
const RECOVERY_STEPS = 4;

export interface PhysicsTestMotionParameters2D {
  from: GodotTransform2D;
  motion: Vector2;
  margin: number;
  collideSeparationRay: boolean;
  excludeBodies: readonly GodotRid[];
  excludeObjects: readonly (number | bigint)[];
  recoveryAsCollision: boolean;
}

export interface PhysicsTestMotionResult2D {
  getTravel(): Vector2;
  getRemainder(): Vector2;
  getCollisionPoint(): Vector2;
  getCollisionNormal(): Vector2;
  getColliderVelocity(): Vector2;
  getColliderId(): bigint;
  getColliderRid(): GodotRid;
  getCollider(): unknown;
  getColliderShape(): number;
  getCollisionLocalShape(): number;
  getCollisionDepth(): number;
  getCollisionSafeFraction(): number;
  getCollisionUnsafeFraction(): number;
}

export interface PhysicsBodyTestMotion2DOptions {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
}

export interface PhysicsBodyMotionCollision2D {
  readonly collider: unknown;
  readonly colliderId: bigint;
  readonly colliderRid: GodotRid;
  readonly colliderShape: number;
  readonly colliderVelocity: Vector2;
  readonly depth: number;
  readonly localShape: number;
  readonly normal: Vector2;
  readonly position: Vector2;
  readonly remainder: Vector2;
  readonly travel: Vector2;
}

interface MotionResultState {
  travel: Vector2;
  remainder: Vector2;
  point: Vector2;
  normal: Vector2;
  colliderVelocity: Vector2;
  colliderId: bigint;
  colliderRid: GodotRid;
  collider: unknown;
  colliderShape: number;
  localShape: number;
  depth: number;
  safeFraction: number;
  unsafeFraction: number;
}

interface MovingShape {
  readonly collider: RAPIER.Collider;
  readonly shape: RAPIER.Shape;
  readonly localPosition: Vector2;
  readonly localRotation: number;
  readonly index: number;
  readonly mask: number;
}

interface MotionContact {
  readonly moving: MovingShape;
  readonly collider: RAPIER.Collider;
  readonly point: Vector2;
  readonly normal: Vector2;
  readonly distance: number;
}

interface MotionCastHit {
  readonly collider: RAPIER.Collider;
  readonly time_of_impact: number;
  readonly witness2: Vector2;
  readonly normal2: Vector2;
}

const RESULT_STATES = new WeakMap<PhysicsTestMotionResult2D, MotionResultState>();

function copyTransform(value: GodotTransform2D): GodotTransform2D {
  return {
    x: vec2(value.x.x, value.x.y),
    y: vec2(value.y.x, value.y.y),
    origin: vec2(value.origin.x, value.origin.y),
  };
}

function finiteVector(value: Readonly<Vector2>, name: string): Vector2 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`${name} must contain finite coordinates`);
  }
  return vec2(value.x, value.y);
}

function nonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
  return value;
}

function rigidPose(transform: GodotTransform2D): { position: Vector2; rotation: number } {
  const x = finiteVector(transform.x, 'PhysicsTestMotionParameters2D.from.x');
  const y = finiteVector(transform.y, 'PhysicsTestMotionParameters2D.from.y');
  const xLength = Math.hypot(x.x, x.y);
  const yLength = Math.hypot(y.x, y.y);
  const dot = x.x * y.x + x.y * y.y;
  const determinant = x.x * y.y - x.y * y.x;
  if (Math.abs(xLength - 1) > 1e-6 || Math.abs(yLength - 1) > 1e-6 || Math.abs(dot) > 1e-6 || Math.abs(determinant - 1) > 1e-6) {
    throw new Error('PhysicsTestMotionParameters2D.from must be rigid; Rapier body shapes are unscaled');
  }
  return {
    position: finiteVector(transform.origin, 'PhysicsTestMotionParameters2D.from.origin'),
    rotation: Math.atan2(x.y, x.x),
  };
}

function rotate(value: Readonly<Vector2>, angle: number): Vector2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return vec2(value.x * c - value.y * s, value.x * s + value.y * c);
}

function worldPoint(collider: RAPIER.Collider, local: Readonly<Vector2>): Vector2 {
  const rotated = rotate(local, collider.rotation());
  const position = collider.translation();
  return vec2(position.x + rotated.x, position.y + rotated.y);
}

function worldNormal(collider: RAPIER.Collider, local: Readonly<Vector2>): Vector2 {
  const normal = rotate(local, collider.rotation());
  const length = Math.hypot(normal.x, normal.y);
  return length === 0 ? vec2(0, 0) : vec2(normal.x / length, normal.y / length);
}

function colliderShapeIndex(collider: RAPIER.Collider): number {
  const body = collider.parent();
  if (body === null) return 0;
  for (let index = 0; index < body.numColliders(); index += 1) {
    if (body.collider(index).handle === collider.handle) return index;
  }
  throw new Error('PhysicsTestMotionResult2D collider is absent from its registered native body');
}

function movingShapes(body: RAPIER.RigidBody, layers: CollisionLayers): MovingShape[] {
  const bodyPosition = body.translation();
  const bodyRotation = body.rotation();
  const inverse = -bodyRotation;
  const result: MovingShape[] = [];
  for (let index = 0; index < body.numColliders(); index += 1) {
    const collider = body.collider(index);
    if (collider.isSensor() || !collider.isEnabled()) continue;
    const position = collider.translation();
    result.push({
      collider,
      shape: collider.shape,
      localPosition: rotate(vec2(position.x - bodyPosition.x, position.y - bodyPosition.y), inverse),
      localRotation: collider.rotation() - bodyRotation,
      index,
      mask: layers.maskOf(collider),
    });
  }
  return result;
}

function shapePose(
  moving: MovingShape,
  bodyPosition: Readonly<Vector2>,
  bodyRotation: number,
): { position: Vector2; rotation: number } {
  const offset = rotate(moving.localPosition, bodyRotation);
  return {
    position: vec2(bodyPosition.x + offset.x, bodyPosition.y + offset.y),
    rotation: bodyRotation + moving.localRotation,
  };
}

function emptyState(): MotionResultState {
  return {
    travel: vec2(0, 0),
    remainder: vec2(0, 0),
    point: vec2(0, 0),
    normal: vec2(0, 0),
    colliderVelocity: vec2(0, 0),
    colliderId: 0n,
    colliderRid: Object.freeze({ id: 0n }),
    collider: null,
    colliderShape: 0,
    localShape: 0,
    depth: 0,
    safeFraction: 1,
    unsafeFraction: 1,
  };
}

export function createPhysicsTestMotionParameters2D(): PhysicsTestMotionParameters2D {
  let from = copyTransform(TRANSFORM2D_IDENTITY);
  let motion = vec2(0, 0);
  let margin = DEFAULT_MARGIN;
  let excludeBodies: readonly GodotRid[] = [];
  let excludeObjects: readonly (number | bigint)[] = [];
  const value = {
    collideSeparationRay: false,
    recoveryAsCollision: false,
  } as PhysicsTestMotionParameters2D;
  Object.defineProperties(value, {
    from: { enumerable: true, get: () => copyTransform(from), set: (next: GodotTransform2D) => { rigidPose(next); from = copyTransform(next); } },
    motion: { enumerable: true, get: () => vec2(motion.x, motion.y), set: (next: Vector2) => { motion = finiteVector(next, 'PhysicsTestMotionParameters2D.motion'); } },
    margin: { enumerable: true, get: () => margin, set: (next: number) => { margin = nonNegative(next, 'PhysicsTestMotionParameters2D.margin'); } },
    excludeBodies: { enumerable: true, get: () => [...excludeBodies], set: (next: readonly GodotRid[]) => { excludeBodies = [...next]; } },
    excludeObjects: { enumerable: true, get: () => [...excludeObjects], set: (next: readonly (number | bigint)[]) => { excludeObjects = [...next]; } },
  });
  return value;
}

export function createPhysicsTestMotionResult2D(): PhysicsTestMotionResult2D {
  const result = {
    getTravel: () => vec2(state().travel.x, state().travel.y),
    getRemainder: () => vec2(state().remainder.x, state().remainder.y),
    getCollisionPoint: () => vec2(state().point.x, state().point.y),
    getCollisionNormal: () => vec2(state().normal.x, state().normal.y),
    getColliderVelocity: () => vec2(state().colliderVelocity.x, state().colliderVelocity.y),
    getColliderId: () => state().colliderId,
    getColliderRid: () => state().colliderRid,
    getCollider: () => state().collider,
    getColliderShape: () => state().colliderShape,
    getCollisionLocalShape: () => state().localShape,
    getCollisionDepth: () => state().depth,
    getCollisionSafeFraction: () => state().safeFraction,
    getCollisionUnsafeFraction: () => state().unsafeFraction,
  } satisfies PhysicsTestMotionResult2D;
  const state = (): MotionResultState => RESULT_STATES.get(result) as MotionResultState;
  RESULT_STATES.set(result, emptyState());
  return result;
}

/** PhysicsBody2D.test_move: the node-level door into the same native body sweep as PhysicsServer2D. */
export function physicsBodyTestMove2D(
  options: PhysicsBodyTestMotion2DOptions,
  bodyValue: unknown,
  from: GodotTransform2D,
  motion: Vector2,
  result: PhysicsTestMotionResult2D | null = null,
  margin = DEFAULT_MARGIN,
  recoveryAsCollision = false,
): boolean {
  const parameters = createPhysicsTestMotionParameters2D();
  parameters.from = from;
  parameters.motion = motion;
  parameters.margin = margin;
  parameters.recoveryAsCollision = recoveryAsCollision;
  return bodyTestMotion2D(
    options,
    physicsRid2DOfBody(shapeCastBody2DOf(bodyValue)),
    parameters,
    result,
  );
}

/** PhysicsBody2D.get_gravity: current native space gravity for a retained body. */
export function physicsBodyGetGravity2D(world: RAPIER.World, bodyValue: unknown): Vector2 {
  const body = shapeCastBody2DOf(bodyValue);
  if (world.getRigidBody(body.handle) === null) {
    throw new Error('PhysicsBody2D.get_gravity() received a body outside the active native Rapier space.');
  }
  return vec2(world.gravity.x, world.gravity.y);
}

/** PhysicsBody2D.move_and_collide over the same exact native sweep as body_test_motion. */
export function physicsBodyMoveAndCollide2D(
  options: PhysicsBodyTestMotion2DOptions,
  bodyValue: unknown,
  motion: Vector2,
  testOnly = false,
  safeMargin = DEFAULT_MARGIN,
  recoveryAsCollision = false,
): PhysicsBodyMotionCollision2D | null {
  const bodyHandle = shapeCastBody2DOf(bodyValue);
  const body = options.world.getRigidBody(bodyHandle.handle);
  if (body === null) throw new Error('PhysicsBody2D.move_and_collide() received a body outside the active native Rapier space.');
  const angle = body.rotation();
  const origin = body.translation();
  const parameters = createPhysicsTestMotionParameters2D();
  parameters.from = {
    x: vec2(Math.cos(angle), Math.sin(angle)),
    y: vec2(-Math.sin(angle), Math.cos(angle)),
    origin: vec2(origin.x, origin.y),
  };
  parameters.motion = motion;
  parameters.margin = safeMargin;
  parameters.recoveryAsCollision = recoveryAsCollision;
  const result = createPhysicsTestMotionResult2D();
  if (!bodyTestMotion2D(options, physicsRid2DOfBody(bodyHandle), parameters, result)) return null;
  const travel = result.getTravel();
  if (!testOnly) {
    const target = vec2(origin.x + travel.x, origin.y + travel.y);
    body.setTranslation(target, false);
    if (body.isKinematic()) body.setNextKinematicTranslation(target);
    if (typeof bodyValue === 'object' && bodyValue !== null && 'position' in bodyValue) {
      const node = bodyValue as {
        readonly parent?: { toLocal?(point: Vector2): Vector2 } | null;
        readonly position?: { set?(x: number, y: number): void };
      };
      const local = node.parent?.toLocal?.(target) ?? target;
      node.position?.set?.(local.x, local.y);
    }
  }
  return Object.freeze({
    collider: result.getCollider(),
    colliderId: result.getColliderId(),
    colliderRid: result.getColliderRid(),
    colliderShape: result.getColliderShape(),
    colliderVelocity: result.getColliderVelocity(),
    depth: result.getCollisionDepth(),
    localShape: result.getCollisionLocalShape(),
    normal: result.getCollisionNormal(),
    position: result.getCollisionPoint(),
    remainder: result.getRemainder(),
    travel,
  });
}

function resultState(result: PhysicsTestMotionResult2D): MotionResultState {
  const state = RESULT_STATES.get(result);
  if (state === undefined) throw new Error('body_test_motion result must be created by PhysicsTestMotionResult2D.new()');
  return state;
}

function writeCollisionResult(
  result: PhysicsTestMotionResult2D,
  options: PhysicsBodyTestMotion2DOptions,
  contact: MotionContact,
  travel: Vector2,
  remainder: Vector2,
  depth: number,
  safeFraction: number,
  unsafeFraction: number,
): void {
  const colliderObject = options.resolveCollider(contact.collider);
  if ((typeof colliderObject !== 'object' || colliderObject === null) && typeof colliderObject !== 'function') {
    throw new Error('body_test_motion collider resolver returned no registered Godot Object');
  }
  RESULT_STATES.set(result, {
    travel,
    remainder,
    point: contact.point,
    normal: contact.normal,
    colliderVelocity: physicsVelocityAtPoint2D(contact.collider, contact.point),
    colliderId: godotObjectInstanceId(colliderObject),
    colliderRid: physicsRid2DOf(contact.collider),
    collider: colliderObject,
    colliderShape: colliderShapeIndex(contact.collider),
    localShape: contact.moving.index,
    depth,
    safeFraction,
    unsafeFraction,
  });
}

export function bodyTestMotion2D(
  options: PhysicsBodyTestMotion2DOptions,
  bodyRid: GodotRid,
  parameters: PhysicsTestMotionParameters2D,
  result: PhysicsTestMotionResult2D | null = null,
  infiniteInertia = false,
): boolean {
  if (parameters.collideSeparationRay) {
    throw new Error('PhysicsTestMotionParameters2D.collide_separation_ray=true cannot be represented because Rapier has no Godot separation-ray shape category');
  }
  if (result !== null) resultState(result);
  const body = physicsBody2DOfRid(bodyRid);
  const pose = rigidPose(parameters.from);
  const motion = finiteVector(parameters.motion, 'PhysicsTestMotionParameters2D.motion');
  const margin = nonNegative(parameters.margin, 'PhysicsTestMotionParameters2D.margin');
  const shapes = movingShapes(body, options.layers);
  if (shapes.length === 0) {
    if (result !== null) {
      RESULT_STATES.set(result, { ...emptyState(), travel: motion });
    }
    return false;
  }
  const excludedBodies = new Set(parameters.excludeBodies.map((rid) => physicsBody2DOfRid(rid).handle));
  const excludedObjects = new Set(parameters.excludeObjects.map((id) => BigInt(id)));
  const accepts = (moving: MovingShape, collider: RAPIER.Collider): boolean => {
    const owner = collider.parent();
    if (owner?.handle === body.handle || (owner !== null && excludedBodies.has(owner.handle))) return false;
    if (collider.isSensor() || !collider.isEnabled()) return false;
    if (infiniteInertia && owner?.isDynamic() === true) return false;
    if (!godotCanCollideWith(options.layers, collider, moving.mask)) return false;
    if (excludedObjects.size > 0) {
      const object = options.resolveCollider(collider);
      if (((typeof object === 'object' && object !== null) || typeof object === 'function') && excludedObjects.has(godotObjectInstanceId(object))) return false;
    }
    return true;
  };

  let recovered = vec2(0, 0);
  let recoveryContact: MotionContact | null = null;
  for (let step = 0; step < RECOVERY_STEPS; step += 1) {
    let deepest: MotionContact | undefined;
    for (const moving of shapes) {
      const movingPose = shapePose(moving, vec2(pose.position.x + recovered.x, pose.position.y + recovered.y), pose.rotation);
      options.world.forEachCollider((collider) => {
        if (!accepts(moving, collider)) return;
        const contact = collider.contactShape(moving.shape, movingPose.position, movingPose.rotation, margin);
        if (contact === null || contact.distance >= margin) return;
        const candidate: MotionContact = {
          moving,
          collider,
          point: worldPoint(collider, contact.point1),
          normal: worldNormal(collider, contact.normal1),
          distance: contact.distance,
        };
        if (deepest === undefined || candidate.distance < deepest.distance) deepest = candidate;
      });
    }
    const recoveryHit = deepest as MotionContact | undefined;
    if (recoveryHit === undefined) break;
    if (recoveryContact === null || recoveryHit.distance < recoveryContact.distance) recoveryContact = recoveryHit;
    const amount = Math.max(0, margin - recoveryHit.distance);
    recovered = vec2(recovered.x + recoveryHit.normal.x * amount, recovered.y + recoveryHit.normal.y * amount);
  }

  if (parameters.recoveryAsCollision && recoveryContact !== null) {
    if (result !== null) {
      writeCollisionResult(result, options, recoveryContact, recovered, motion, Math.max(0, -recoveryContact.distance), 0, 0);
    }
    return true;
  }

  const start = vec2(pose.position.x + recovered.x, pose.position.y + recovered.y);
  let cast: { moving: MovingShape; hit: MotionCastHit } | null = null;
  for (const moving of shapes) {
    const movingPose = shapePose(moving, start, pose.rotation);
    const hit = options.world.castShape(
      movingPose.position,
      movingPose.rotation,
      motion,
      moving.shape,
      margin,
      1,
      false,
      QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      moving.collider,
      body,
      (candidate) => accepts(moving, candidate),
    );
    if (hit !== null && (cast === null || hit.time_of_impact < cast.hit.time_of_impact)) cast = { moving, hit };
  }
  if (cast === null) {
    if (result !== null) RESULT_STATES.set(result, { ...emptyState(), travel: vec2(recovered.x + motion.x, recovered.y + motion.y) });
    return false;
  }

  let safe = 0;
  let unsafe = Math.max(0, Math.min(1, cast.hit.time_of_impact));
  const collidesAt = (fraction: number): boolean => {
    const bodyAt = vec2(start.x + motion.x * fraction, start.y + motion.y * fraction);
    for (const moving of shapes) {
      const movingPose = shapePose(moving, bodyAt, pose.rotation);
      let collided = false;
      options.world.forEachCollider((collider) => {
        if (collided || !accepts(moving, collider)) return;
        const contact = collider.contactShape(moving.shape, movingPose.position, movingPose.rotation, margin);
        collided = contact !== null && contact.distance <= margin;
      });
      if (collided) return true;
    }
    return false;
  };
  for (let step = 0; step < BINARY_STEPS && unsafe > 0; step += 1) {
    const middle = (safe + unsafe) / 2;
    if (collidesAt(middle)) unsafe = middle;
    else safe = middle;
  }
  const impactBody = vec2(start.x + motion.x * unsafe, start.y + motion.y * unsafe);
  const impactPose = shapePose(cast.moving, impactBody, pose.rotation);
  const contact = cast.hit.collider.contactShape(cast.moving.shape, impactPose.position, impactPose.rotation, margin);
  const collision: MotionContact = contact === null
    ? {
        moving: cast.moving,
        collider: cast.hit.collider,
        point: worldPoint(cast.hit.collider, cast.hit.witness2),
        normal: worldNormal(cast.hit.collider, cast.hit.normal2),
        distance: 0,
      }
    : {
        moving: cast.moving,
        collider: cast.hit.collider,
        point: worldPoint(cast.hit.collider, contact.point1),
        normal: worldNormal(cast.hit.collider, contact.normal1),
        distance: contact.distance,
      };
  if (result !== null) {
    const applied = vec2(recovered.x + motion.x * safe, recovered.y + motion.y * safe);
    const remainder = vec2(motion.x * (1 - safe), motion.y * (1 - safe));
    writeCollisionResult(result, options, collision, applied, remainder, Math.max(0, -collision.distance), safe, unsafe);
  }
  return true;
}

export function bodyTestMotion2DLegacy(
  options: PhysicsBodyTestMotion2DOptions,
  bodyRid: GodotRid,
  from: GodotTransform2D,
  motion: Vector2,
  infiniteInertia: boolean,
  margin = DEFAULT_MARGIN,
  result: PhysicsTestMotionResult2D | null = null,
  excludeRaycastShapes = true,
  exclude: readonly GodotRid[] = [],
): boolean {
  if (!excludeRaycastShapes) {
    throw new Error('Physics2DServer.body_test_motion(exclude_raycast_shapes=false) cannot be represented because Rapier has no ray-only shape category');
  }
  const parameters = createPhysicsTestMotionParameters2D();
  parameters.from = from;
  parameters.motion = motion;
  parameters.margin = margin;
  parameters.excludeBodies = exclude;
  return bodyTestMotion2D(options, bodyRid, parameters, result, infiniteInertia);
}
