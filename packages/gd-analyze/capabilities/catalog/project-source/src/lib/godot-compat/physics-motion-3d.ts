/** Godot 4 PhysicsServer3D body motion tests over retained native Rapier bodies. */
import RAPIER, { QueryFilterFlags } from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3 as ThreeVector3, type Vector3Like } from 'three';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import { godotCarrierOfRid, type GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';
import { TRANSFORM3D_IDENTITY } from './basis';
import { transform3, type Transform, vec3, type Vector3 } from './variant-3d';

const MOTION_MARGIN = 0.001;
const BINARY_STEPS = 8;

export interface PhysicsTestMotionParameters3D {
  from: Transform;
  motion: Vector3;
}

export interface PhysicsTestMotionResult3D {
  getTravel(): Vector3;
  getRemainder(): Vector3;
  getCollisionNormal(index?: number): Vector3;
  getCollisionCount(): number;
}

export interface PhysicsBodyTestMotion3DOptions {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly infiniteInertia?: boolean;
  readonly exclude?: readonly GodotRid[];
}

interface MotionResultState {
  readonly travel: Vector3;
  readonly remainder: Vector3;
  readonly normal: Vector3;
  readonly collisionCount: number;
}

const RESULT_STATES = new WeakMap<PhysicsTestMotionResult3D, MotionResultState>();

function finiteVector(value: Vector3Like, member: string): Vector3 {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`${member} must contain finite coordinates`);
  }
  return vec3(value.x, value.y, value.z);
}

function copyTransform(value: Transform): Transform {
  return transform3(value.basis, value.origin);
}

function rigidPose(value: Transform): { position: ThreeVector3; rotation: Quaternion } {
  const matrix = new Matrix4().makeBasis(
    new ThreeVector3(value.basis[0].x, value.basis[0].y, value.basis[0].z),
    new ThreeVector3(value.basis[1].x, value.basis[1].y, value.basis[1].z),
    new ThreeVector3(value.basis[2].x, value.basis[2].y, value.basis[2].z),
  );
  matrix.setPosition(value.origin.x, value.origin.y, value.origin.z);
  const position = new ThreeVector3();
  const rotation = new Quaternion();
  const scale = new ThreeVector3();
  matrix.decompose(position, rotation, scale);
  if (![scale.x, scale.y, scale.z].every((axis) => Math.abs(axis - 1) <= 1e-6)) {
    throw new Error('PhysicsTestMotionParameters3D.from must be rigid; Rapier body shapes are unscaled');
  }
  return { position, rotation };
}

function emptyState(): MotionResultState {
  return {
    travel: vec3(0, 0, 0),
    remainder: vec3(0, 0, 0),
    normal: vec3(0, 0, 0),
    collisionCount: 0,
  };
}

export function createPhysicsTestMotionParameters3D(): PhysicsTestMotionParameters3D {
  let from = copyTransform(TRANSFORM3D_IDENTITY);
  let motion = vec3(0, 0, 0);
  const result = {} as PhysicsTestMotionParameters3D;
  Object.defineProperties(result, {
    from: {
      enumerable: true,
      get: () => copyTransform(from),
      set: (next: Transform) => { rigidPose(next); from = copyTransform(next); },
    },
    motion: {
      enumerable: true,
      get: () => vec3(motion.x, motion.y, motion.z),
      set: (next: Vector3Like) => { motion = finiteVector(next, 'PhysicsTestMotionParameters3D.motion'); },
    },
  });
  registerGodotObjectIdentity(result, 'PhysicsTestMotionParameters3D');
  return result;
}

export function createPhysicsTestMotionResult3D(godotMajor: 3 | 4 = 4): PhysicsTestMotionResult3D {
  const state = (): MotionResultState => RESULT_STATES.get(result) as MotionResultState;
  const result = {
    getTravel: () => vec3(state().travel.x, state().travel.y, state().travel.z),
    getRemainder: () => vec3(state().remainder.x, state().remainder.y, state().remainder.z),
    getCollisionNormal: (index = 0) => {
      const value = state();
      if (!Number.isInteger(index) || index < 0 || index >= value.collisionCount) {
        return vec3(0, 0, 0);
      }
      return vec3(value.normal.x, value.normal.y, value.normal.z);
    },
    getCollisionCount: () => state().collisionCount,
  } satisfies PhysicsTestMotionResult3D;
  RESULT_STATES.set(result, emptyState());
  registerGodotObjectIdentity(result, godotMajor === 3 ? 'PhysicsTestMotionResult' : 'PhysicsTestMotionResult3D');
  return result;
}

function nativeBody(value: GodotRid): RAPIER.RigidBody {
  const carrier = godotCarrierOfRid(value);
  if (
    carrier === undefined ||
    typeof (carrier as Partial<RAPIER.RigidBody>).numColliders !== 'function' ||
    typeof (carrier as Partial<RAPIER.RigidBody>).translation !== 'function' ||
    typeof (carrier as Partial<RAPIER.RigidBody>).rotation !== 'function'
  ) {
    throw new Error('PhysicsServer3D.body_test_motion requires a RID for a retained native Rapier body');
  }
  return carrier as RAPIER.RigidBody;
}

function resultState(value: PhysicsTestMotionResult3D): MotionResultState {
  const state = RESULT_STATES.get(value);
  if (state === undefined) {
    throw new Error('PhysicsServer3D.body_test_motion result must come from PhysicsTestMotionResult3D.new()');
  }
  return state;
}

/**
 * Native single-shape sweep. Multi-shape Godot bodies can return a collision array whose ordering
 * Rapier's aggregate query does not expose, so they are refused instead of collapsed to a lookalike.
 */
export function bodyTestMotion3D(
  options: PhysicsBodyTestMotion3DOptions,
  bodyRid: GodotRid,
  parameters: PhysicsTestMotionParameters3D,
  result: PhysicsTestMotionResult3D | null = null,
): boolean {
  if (result !== null) resultState(result);
  const body = nativeBody(bodyRid);
  if (options.world.getRigidBody(body.handle) !== body) {
    throw new Error('PhysicsServer3D.body_test_motion received a body outside the active native Rapier world');
  }
  if (body.numColliders() !== 1) {
    throw new Error('PhysicsServer3D.body_test_motion requires exactly one retained native collider; multi-shape collision ordering is not exposed by Rapier');
  }
  const collider = body.collider(0);
  if (!collider.isEnabled() || collider.isSensor()) {
    throw new Error('PhysicsServer3D.body_test_motion requires one enabled non-sensor native collider');
  }

  const pose = rigidPose(parameters.from);
  const motion = finiteVector(parameters.motion, 'PhysicsTestMotionParameters3D.motion');
  const bodyPosition = body.translation();
  const bodyRotation = body.rotation();
  const inverseBodyRotation = new Quaternion(bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w).invert();
  const colliderPosition = collider.translation();
  const colliderRotation = collider.rotation();
  const localPosition = new ThreeVector3(
    colliderPosition.x - bodyPosition.x,
    colliderPosition.y - bodyPosition.y,
    colliderPosition.z - bodyPosition.z,
  ).applyQuaternion(inverseBodyRotation);
  const localRotation = inverseBodyRotation.clone().multiply(
    new Quaternion(colliderRotation.x, colliderRotation.y, colliderRotation.z, colliderRotation.w),
  );
  const shapePosition = localPosition.applyQuaternion(pose.rotation).add(pose.position);
  const shapeRotation = pose.rotation.clone().multiply(localRotation);
  const mask = options.layers.maskOf(collider);
  const excludedBodies = new Set(
    (options.exclude ?? []).map((rid) => {
      const excluded = godotCarrierOfRid(rid) as Partial<RAPIER.RigidBody> | undefined;
      if (excluded === undefined || typeof excluded.handle !== 'number') {
        throw new Error('PhysicsServer body_test_motion exclude entries must be retained native body RIDs');
      }
      return excluded.handle;
    }),
  );
  const accepts = (candidate: RAPIER.Collider): boolean =>
    candidate.parent()?.handle !== body.handle &&
    !excludedBodies.has(candidate.parent()?.handle ?? -1) &&
    !(options.infiniteInertia === true && candidate.parent() !== null && options.layers.isDynamic(candidate.parent()!.handle)) &&
    candidate.isEnabled() &&
    !candidate.isSensor() &&
    godotCanCollideWith(options.layers, candidate, mask);

  let initialOverlap = false;
  options.world.forEachCollider((candidate) => {
    if (initialOverlap || !accepts(candidate)) return;
    const contact = candidate.contactShape(collider.shape, shapePosition, shapeRotation, MOTION_MARGIN);
    initialOverlap = contact !== null && contact.distance <= MOTION_MARGIN;
  });
  if (initialOverlap) {
    throw new Error('PhysicsServer3D.body_test_motion refuses an initially overlapping body because recovery collision ordering is not exposed by Rapier');
  }

  const hit = options.world.castShape(
    shapePosition,
    shapeRotation,
    motion,
    collider.shape,
    MOTION_MARGIN,
    1,
    false,
    QueryFilterFlags.EXCLUDE_SENSORS,
    undefined,
    collider,
    body,
    accepts,
  );
  if (hit === null) {
    if (result !== null) {
      RESULT_STATES.set(result, { ...emptyState(), travel: motion });
    }
    return false;
  }

  let safe = 0;
  let unsafe = Math.max(0, Math.min(1, hit.time_of_impact));
  const collidesAt = (fraction: number): boolean => {
    const at = shapePosition.clone().addScaledVector(new ThreeVector3(motion.x, motion.y, motion.z), fraction);
    let collision = false;
    options.world.forEachCollider((candidate) => {
      if (collision || !accepts(candidate)) return;
      const contact = candidate.contactShape(collider.shape, at, shapeRotation, MOTION_MARGIN);
      collision = contact !== null && contact.distance <= MOTION_MARGIN;
    });
    return collision;
  };
  for (let index = 0; index < BINARY_STEPS && unsafe > 0; index += 1) {
    const middle = (safe + unsafe) / 2;
    if (collidesAt(middle)) unsafe = middle;
    else safe = middle;
  }
  if (result !== null) {
    RESULT_STATES.set(result, {
      travel: vec3(motion.x * safe, motion.y * safe, motion.z * safe),
      remainder: vec3(motion.x * (1 - safe), motion.y * (1 - safe), motion.z * (1 - safe)),
      normal: vec3(hit.normal1.x, hit.normal1.y, hit.normal1.z),
      collisionCount: 1,
    });
  }
  return true;
}

/** Godot 3 PhysicsServer.body_test_motion positional spelling over the same retained sweep. */
export function bodyTestMotion3DLegacy(
  options: PhysicsBodyTestMotion3DOptions,
  bodyRid: GodotRid,
  from: Transform,
  motion: Vector3Like,
  infiniteInertia: boolean,
  result: PhysicsTestMotionResult3D | null = null,
  excludeRaycastShapes = true,
  exclude: readonly GodotRid[] = [],
): boolean {
  if (!excludeRaycastShapes) {
    throw new Error('PhysicsServer.body_test_motion(exclude_raycast_shapes=false) cannot be represented because Rapier has no ray-only shape category');
  }
  const parameters = createPhysicsTestMotionParameters3D();
  parameters.from = from;
  parameters.motion = motion;
  return bodyTestMotion3D({ ...options, infiniteInertia, exclude }, bodyRid, parameters, result);
}
