/** Godot 3 ClippedCamera over a native Three camera and Rapier convex sweep. */
import RAPIER from '@dimforge/rapier3d-compat';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import { registerGodotObjectIdentity } from './object';

export interface BindGodotClippedCamera3DOptions {
  readonly camera: PerspectiveCamera;
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly margin?: number;
  readonly collisionMask?: number;
  readonly clipToAreas?: boolean;
  readonly clipToBodies?: boolean;
}

export type GodotClippedCamera3D = PerspectiveCamera & {
  margin: number;
  collisionMask: number;
  clipToAreas: boolean;
  clipToBodies: boolean;
};

interface ClippedCameraState {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly desiredLocalPosition: Vector3;
  readonly appliedLocalPosition: Vector3;
  readonly parentPosition: Vector3;
  readonly parentRotation: Quaternion;
  readonly parentScale: Vector3;
  readonly desiredWorldPosition: Vector3;
  readonly cameraRotation: Quaternion;
  readonly cameraWorldScale: Vector3;
  readonly forward: Vector3;
  readonly offsetFromParent: Vector3;
  readonly rayFrom: Vector3;
  readonly motion: Vector3;
  readonly renderedWorldPosition: Vector3;
  readonly projectionElements: Float64Array;
  readonly projectionPoints: readonly [Vector3, Vector3, Vector3, Vector3];
  readonly projectionVertices: Float32Array;
  projectionShape: RAPIER.Shape | undefined;
  margin: number;
  collisionMask: number;
  clipToAreas: boolean;
  clipToBodies: boolean;
  clipOffset: number;
}

const CLIPPED_CAMERAS = new WeakMap<PerspectiveCamera, ClippedCameraState>();

function finiteNonNegative(value: number, member: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`ClippedCamera.${member} must be a finite number >= 0.`);
  }
  return value;
}

function uint32(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError('ClippedCamera.collision_mask must be an unsigned 32-bit integer.');
  }
  return value >>> 0;
}

function projectionMatches(state: ClippedCameraState, camera: PerspectiveCamera): boolean {
  const elements = camera.projectionMatrix.elements;
  for (let index = 0; index < 16; index += 1) {
    if (state.projectionElements[index] !== elements[index]) return false;
  }
  return true;
}

function pyramidShape(state: ClippedCameraState, camera: PerspectiveCamera): RAPIER.Shape {
  if (state.projectionShape !== undefined && projectionMatches(state, camera)) {
    return state.projectionShape;
  }
  const elements = camera.projectionMatrix.elements;
  for (let index = 0; index < 16; index += 1) state.projectionElements[index] = elements[index]!;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const corners = state.projectionPoints;
  corners[0].set(-1, -1, -1).applyMatrix4(camera.projectionMatrixInverse);
  corners[1].set(1, -1, -1).applyMatrix4(camera.projectionMatrixInverse);
  corners[2].set(-1, 1, -1).applyMatrix4(camera.projectionMatrixInverse);
  corners[3].set(1, 1, -1).applyMatrix4(camera.projectionMatrixInverse);
  const vertices = state.projectionVertices;
  vertices[0] = 0;
  vertices[1] = 0;
  vertices[2] = 0;
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index]!;
    const offset = (index + 1) * 3;
    vertices[offset] = corner.x;
    vertices[offset + 1] = corner.y;
    vertices[offset + 2] = corner.z;
  }
  const descriptor = RAPIER.ColliderDesc.convexHull(vertices);
  if (descriptor === null) {
    throw new Error('ClippedCamera could not construct its camera-frustum collision pyramid.');
  }
  state.projectionShape = descriptor.shape;
  return state.projectionShape;
}

function hasUnitScale(scale: Vector3): boolean {
  return Math.abs(scale.x - 1) <= 1e-7 &&
    Math.abs(scale.y - 1) <= 1e-7 &&
    Math.abs(scale.z - 1) <= 1e-7;
}

function applyRenderedPosition(
  state: ClippedCameraState,
  camera: PerspectiveCamera,
  parent: NonNullable<PerspectiveCamera['parent']>,
): void {
  state.renderedWorldPosition
    .copy(state.desiredWorldPosition)
    .addScaledVector(state.forward, state.clipOffset);
  camera.position.copy(parent.worldToLocal(state.renderedWorldPosition));
  state.appliedLocalPosition.copy(camera.position);
  camera.updateWorldMatrix(false, false);
}

/** Bind the camera's authored desired pose; updates move only its native rendered position. */
export function bindGodotClippedCamera3D(
  options: BindGodotClippedCamera3DOptions,
): GodotClippedCamera3D {
  const margin = finiteNonNegative(options.margin ?? 0, 'margin');
  const collisionMask = uint32(options.collisionMask ?? 1);
  if (typeof options.clipToAreas !== 'undefined' && typeof options.clipToAreas !== 'boolean') {
    throw new TypeError('ClippedCamera.clip_to_areas requires bool.');
  }
  if (typeof options.clipToBodies !== 'undefined' && typeof options.clipToBodies !== 'boolean') {
    throw new TypeError('ClippedCamera.clip_to_bodies requires bool.');
  }
  const binding = options.camera as GodotClippedCamera3D;
  registerGodotObjectIdentity(binding, 'ClippedCamera');
  const state: ClippedCameraState = {
    world: options.world,
    layers: options.layers,
    desiredLocalPosition: options.camera.position.clone(),
    appliedLocalPosition: options.camera.position.clone(),
    parentPosition: new Vector3(),
    parentRotation: new Quaternion(),
    parentScale: new Vector3(),
    desiredWorldPosition: new Vector3(),
    cameraRotation: new Quaternion(),
    cameraWorldScale: new Vector3(),
    forward: new Vector3(),
    offsetFromParent: new Vector3(),
    rayFrom: new Vector3(),
    motion: new Vector3(),
    renderedWorldPosition: new Vector3(),
    projectionElements: new Float64Array(16).fill(Number.NaN),
    projectionPoints: [new Vector3(), new Vector3(), new Vector3(), new Vector3()],
    projectionVertices: new Float32Array(15),
    projectionShape: undefined,
    margin,
    collisionMask,
    clipToAreas: options.clipToAreas ?? false,
    clipToBodies: options.clipToBodies ?? true,
    clipOffset: 0,
  };
  CLIPPED_CAMERAS.set(binding, state);
  Object.defineProperties(binding, {
    margin: {
      configurable: true,
      get: () => state.margin,
      set: (value: number) => { state.margin = finiteNonNegative(value, 'margin'); },
    },
    collisionMask: {
      configurable: true,
      get: () => state.collisionMask,
      set: (value: number) => { state.collisionMask = uint32(value); },
    },
    clipToAreas: {
      configurable: true,
      get: () => state.clipToAreas,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('ClippedCamera.clip_to_areas requires bool.');
        state.clipToAreas = value;
      },
    },
    clipToBodies: {
      configurable: true,
      get: () => state.clipToBodies,
      set: (value: boolean) => {
        if (typeof value !== 'boolean') throw new TypeError('ClippedCamera.clip_to_bodies requires bool.');
        state.clipToBodies = value;
      },
    },
  });
  return binding;
}

/** Run immediately before the fixed physics callback, matching CLIP_PROCESS_PHYSICS. */
export function updateGodotClippedCamera3D(camera: PerspectiveCamera): void {
  const state = CLIPPED_CAMERAS.get(camera);
  if (state === undefined) throw new Error('ClippedCamera update requires a retained native binding.');
  const parent = camera.parent;
  if (parent === null) {
    state.desiredLocalPosition.copy(camera.position);
    state.appliedLocalPosition.copy(camera.position);
    state.clipOffset = 0;
    return;
  }

  // A script writes the desired local transform. The previous update's native clipped pose is not
  // fed back as a new desired pose on the next fixed tick.
  if (!camera.position.equals(state.appliedLocalPosition)) {
    state.desiredLocalPosition.copy(camera.position);
  }
  parent.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  parent.matrixWorld.decompose(state.parentPosition, state.parentRotation, state.parentScale);
  camera.matrixWorld.decompose(state.renderedWorldPosition, state.cameraRotation, state.cameraWorldScale);
  if (!hasUnitScale(state.parentScale) || !hasUnitScale(state.cameraWorldScale)) {
    throw new Error('ClippedCamera refuses a scaled transform because its Rapier frustum query is unscaled.');
  }
  state.desiredWorldPosition.copy(state.desiredLocalPosition).applyMatrix4(parent.matrixWorld);
  state.forward.set(0, 0, -1).applyQuaternion(state.cameraRotation).normalize();
  const planeDistance = state.forward.dot(
    state.offsetFromParent.copy(state.desiredWorldPosition).sub(state.parentPosition),
  );
  // `Plane(parent_pos, cam_fw).is_point_over(cam_pos)`: Godot leaves the previous clip offset
  // untouched when the authored camera crosses its parent's forward plane. Three renders from
  // the native Camera transform, so reapply that retained offset to an authored pose change.
  if (planeDistance > 0) {
    applyRenderedPosition(state, camera, parent);
    return;
  }
  state.rayFrom.copy(state.desiredWorldPosition).addScaledVector(state.forward, -planeDistance);
  state.motion.copy(state.desiredWorldPosition).sub(state.rayFrom);
  const length = state.motion.length();
  if (length === 0) {
    camera.position.copy(state.desiredLocalPosition);
    state.appliedLocalPosition.copy(camera.position);
    state.clipOffset = 0;
    return;
  }

  const shape = pyramidShape(state, camera);
  const hit = state.world.castShape(
    state.rayFrom,
    state.cameraRotation,
    state.motion,
    shape,
    state.margin,
    1,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    (collider) => {
      const area = collider.isSensor();
      if (area ? !state.clipToAreas : !state.clipToBodies) return false;
      return godotCanCollideWith(state.layers, collider, state.collisionMask);
    },
  );
  let fraction = 1;
  if (hit !== null) {
    const candidate = 'timeOfImpact' in hit ? hit.timeOfImpact : hit.time_of_impact;
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      throw new Error('ClippedCamera native shape cast returned no finite time of impact.');
    }
    fraction = candidate;
  }
  const safeFraction = Math.max(0, Math.min(1, fraction));
  state.clipOffset = length * (1 - safeFraction);
  applyRenderedPosition(state, camera, parent);
}

export function getGodotClippedCameraOffset(camera: PerspectiveCamera): number {
  const state = CLIPPED_CAMERAS.get(camera);
  if (state === undefined) throw new Error('ClippedCamera.get_clip_offset requires a retained native binding.');
  return state.clipOffset;
}

export function releaseGodotClippedCamera3D(camera: PerspectiveCamera): void {
  const state = CLIPPED_CAMERAS.get(camera);
  if (state === undefined) return;
  camera.position.copy(state.desiredLocalPosition);
  CLIPPED_CAMERAS.delete(camera);
}
