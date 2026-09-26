/** Godot SpringArm3D driven by Rapier's native ray/shape casts. */
import RAPIER from '@dimforge/rapier3d-compat';
import { Camera, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import { registerGodotObjectIdentity } from './object';
import { isGodotObjectFreed } from './object-liveness';
import type { GodotConnection, GodotSignal } from './signal';
import {
  createGodotBoxShape,
  createGodotBoxShape3D,
  createGodotCapsuleShape3D,
  createGodotConcavePolygonShape3D,
  createGodotConvexPolygonShape3D,
  createGodotCylinderShape,
  createGodotCylinderShape3D,
  createGodotSphereShape3D,
  isGodotShape3D,
  releaseGodotShape3D,
  retainGodotShape3D,
  type GodotShape3D,
  type GodotShape3DConsumer,
} from './shape-3d';
import type { ColliderAttachShape } from './collider-3d';

export interface SpringArmBodyHandle { readonly handle: number }

export type GodotSpringArm3D = Object3D & {
  springLength: number;
  margin: number;
  collisionMask: number;
  shape: GodotShape3D | null;
  addExcludedObject(body: SpringArmBodyHandle): void;
  removeExcludedObject(body: SpringArmBodyHandle): boolean;
  clearExcludedObjects(): void;
  getHitLength(): number;
  update(): void;
  release(): void;
};

export interface CreateSpringArm3DOptions {
  readonly node?: Object3D;
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly shape?: RAPIER.Shape;
  readonly shapeResource?: GodotShape3D | null;
  /**
   * Godot uses the last direct Camera3D child's near-plane pyramid whenever `shape` is null.
   * The resolver stays live because scripts may replace projection parameters after attachment.
   */
  readonly camera?: () => Camera;
  readonly godotMajor?: 3 | 4;
  readonly physicsFrame?: GodotSignal<readonly []>;
  readonly springLength?: number;
  readonly margin?: number;
  readonly collisionMask?: number;
  readonly excluded?: readonly SpringArmBodyHandle[];
}

export function createSpringArm3D(options: CreateSpringArm3DOptions): GodotSpringArm3D {
  const node = options.node ?? new Object3D();
  let length = options.springLength ?? 1;
  let margin = options.margin ?? 0.01;
  let collisionMask = options.collisionMask ?? 1;
  let hitLength = length;
  let nativeShape = options.shapeResource?.nativeShape ?? options.shape;
  let shapeResource = options.shapeResource ?? null;
  const excluded = new Set<number>((options.excluded ?? []).map((body) => body.handle));
  const projectionElements = new Float64Array(16).fill(Number.NaN);
  const inverseProjection = new Matrix4();
  const nearPlanePoints = [new Vector3(), new Vector3(), new Vector3(), new Vector3()] as const;
  const pyramidVertices = new Float32Array(15);
  let pyramidShape: RAPIER.Shape | undefined;

  const validate = (): void => {
    if (!Number.isFinite(length) || length < 0) throw new Error('SpringArm3D spring_length must be >= 0');
    if (!Number.isFinite(margin) || margin < 0) throw new Error('SpringArm3D margin must be >= 0');
    if (!Number.isInteger(collisionMask) || collisionMask < 0 || collisionMask > 0xffff_ffff) {
      throw new Error('SpringArm3D collision_mask must be a uint32');
    }
  };
  validate();
  const filter = (collider: RAPIER.Collider): boolean => {
    const parent = collider.parent();
    return !collider.isSensor() &&
      (parent === null || !excluded.has(parent.handle)) &&
      godotCanCollideWith(options.layers, collider, collisionMask);
  };

  const cameraPyramidShape = (camera: Camera): RAPIER.Shape => {
    const projection = camera.projectionMatrix.elements;
    let unchanged = pyramidShape !== undefined;
    for (let index = 0; index < 16; index += 1) {
      if (projectionElements[index] !== projection[index]) unchanged = false;
    }
    if (unchanged) return pyramidShape!;
    for (let index = 0; index < 16; index += 1) projectionElements[index] = projection[index]!;

    // Camera3D::get_near_plane_points() returns the camera origin followed by the four
    // near-plane endpoints of its current Projection. Three's inverse projection maps the same
    // near NDC square into those four camera-local endpoints for both perspective and orthogonal
    // projections, including KEEP_WIDTH's already-authored aspect conversion.
    inverseProjection.copy(camera.projectionMatrix).invert();
    nearPlanePoints[0].set(-1, -1, -1).applyMatrix4(inverseProjection);
    nearPlanePoints[1].set(1, -1, -1).applyMatrix4(inverseProjection);
    nearPlanePoints[2].set(-1, 1, -1).applyMatrix4(inverseProjection);
    nearPlanePoints[3].set(1, 1, -1).applyMatrix4(inverseProjection);
    pyramidVertices[0] = 0;
    pyramidVertices[1] = 0;
    pyramidVertices[2] = 0;
    for (let index = 0; index < nearPlanePoints.length; index += 1) {
      const point = nearPlanePoints[index]!;
      const offset = (index + 1) * 3;
      pyramidVertices[offset] = point.x;
      pyramidVertices[offset + 1] = point.y;
      pyramidVertices[offset + 2] = point.z;
    }
    const descriptor = RAPIER.ColliderDesc.convexHull(pyramidVertices);
    if (descriptor === null) {
      throw new Error('SpringArm3D could not construct Camera3D.get_near_plane_points() convex hull.');
    }
    pyramidShape = descriptor.shape;
    return pyramidShape;
  };

  const update = (): void => {
    validate();
    node.updateWorldMatrix(true, false);
    const origin = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    node.matrixWorld.decompose(origin, rotation, scale);
    if (![scale.x, scale.y, scale.z].every((one) => Math.abs(one - 1) <= 1e-7)) {
      throw new Error('SpringArm3D refuses a scaled transform because Rapier queries are unscaled');
    }
    const motion = new Vector3(0, 0, length).applyQuaternion(rotation);
    let queryShape = nativeShape;
    let queryRotation = rotation;
    if (queryShape === undefined && options.camera !== undefined) {
      const camera = options.camera();
      if (!camera?.isCamera) {
        throw new TypeError('SpringArm3D camera resolver must return its direct Camera3D child.');
      }
      camera.updateWorldMatrix(true, false);
      const cameraOrigin = new Vector3();
      const cameraRotation = new Quaternion();
      const cameraScale = new Vector3();
      camera.matrixWorld.decompose(cameraOrigin, cameraRotation, cameraScale);
      if (![cameraScale.x, cameraScale.y, cameraScale.z].every((one) => Math.abs(one - 1) <= 1e-7)) {
        throw new Error('SpringArm3D Camera3D child must have unit global scale for its convex sweep.');
      }
      queryShape = cameraPyramidShape(camera);
      // SpringArm3D copies the adjusted camera basis, then replaces only its origin with the arm
      // origin. The camera child's authored translation therefore never offsets this cast.
      queryRotation = cameraRotation;
    }
    const hit = queryShape === undefined
      ? options.world.castRayAndGetNormal(
          new RAPIER.Ray(origin, motion),
          1,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          filter,
        )
      : options.world.castShape(
          origin,
          queryRotation,
          motion,
          queryShape,
          0,
          1,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          filter,
        );
    const fraction = hit === null
      ? 1
      : ('timeOfImpact' in hit ? hit.timeOfImpact : hit.time_of_impact);
    // Godot subtracts margin only from the ray fallback. Shape motion already incorporates its
    // margin in the query and uses the returned safe fraction verbatim.
    hitLength = length * fraction - (queryShape === undefined ? margin : 0);
    // SpringArm3D overwrites every direct Node3D child's global origin with the arm origin plus
    // its cast direction. Relative to this direct parent that is precisely (0, 0, hitLength):
    // authored lateral offsets are not retained after the first physics update.
    for (const child of node.children) child.position.set(0, 0, hitLength);
  };

  const shapeConsumer: GodotShape3DConsumer = { setShape(value): void { nativeShape = value; } };
  if (shapeResource !== null) retainGodotShape3D(shapeResource, shapeConsumer);
  const binding = node as GodotSpringArm3D;
  registerGodotObjectIdentity(binding, (options.godotMajor ?? 4) === 4 ? 'SpringArm3D' : 'SpringArm');
  Object.defineProperties(binding, {
    springLength: { configurable: true, get: () => length, set: (value: number) => {
      if (!Number.isFinite(value) || value < 0) throw new Error('SpringArm3D spring_length must be >= 0');
      length = value;
    } },
    margin: { configurable: true, get: () => margin, set: (value: number) => {
      if (!Number.isFinite(value) || value < 0) throw new Error('SpringArm3D margin must be >= 0');
      margin = value;
    } },
    collisionMask: { configurable: true, get: () => collisionMask, set: (value: number) => {
      if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new Error('SpringArm3D collision_mask must be a uint32');
      }
      collisionMask = value;
    } },
    shape: { configurable: true, get: () => shapeResource, set: (value: GodotShape3D | null) => {
      if (value !== null && !isGodotShape3D(value)) throw new TypeError('SpringArm3D.shape requires Shape3D or null');
      if (value === shapeResource) return;
      if (shapeResource !== null) releaseGodotShape3D(shapeResource, shapeConsumer);
      shapeResource = value;
      nativeShape = value?.nativeShape;
      if (value !== null) retainGodotShape3D(value, shapeConsumer);
    } },
  });
  let physicsConnection: GodotConnection | undefined;
  physicsConnection = options.physicsFrame?.connect(() => {
    if (isGodotObjectFreed(node)) {
      physicsConnection?.disconnect();
      physicsConnection = undefined;
      return;
    }
    update();
  });
  return Object.assign(binding, {
    addExcludedObject(body: SpringArmBodyHandle): void { excluded.add(body.handle); },
    removeExcludedObject(body: SpringArmBodyHandle): boolean { return excluded.delete(body.handle); },
    clearExcludedObjects(): void { excluded.clear(); },
    getHitLength(): number { return hitLength; },
    update,
    release(): void {
      physicsConnection?.disconnect();
      if (shapeResource !== null) releaseGodotShape3D(shapeResource, shapeConsumer);
      shapeResource = null;
      nativeShape = undefined;
    },
  });
}

/** Turn the same authored collider spec into the retained Shape Resource SpringArm.shape exposes. */
export function createGodotSpringArmShape3D(
  spec: ColliderAttachShape,
  godotMajor: 3 | 4,
): GodotShape3D {
  if (isGodotShape3D(spec)) return spec;
  switch (spec.type) {
    case 'box':
      return godotMajor === 3
        ? createGodotBoxShape(spec.halfExtents)
        : createGodotBoxShape3D({ x: spec.halfExtents.x * 2, y: spec.halfExtents.y * 2, z: spec.halfExtents.z * 2 });
    case 'sphere': return createGodotSphereShape3D(spec.radius);
    case 'capsule': return createGodotCapsuleShape3D(godotMajor, spec.radius, spec.height);
    case 'cylinder':
      return godotMajor === 3
        ? createGodotCylinderShape(spec.radius, spec.height)
        : createGodotCylinderShape3D(spec.radius, spec.height);
    case 'convex':
      return createGodotConvexPolygonShape3D(Array.from({ length: spec.vertices.length / 3 }, (_, index) => ({
        x: spec.vertices[index * 3]!, y: spec.vertices[index * 3 + 1]!, z: spec.vertices[index * 3 + 2]!,
      })));
    case 'trimesh':
      return createGodotConcavePolygonShape3D(Array.from({ length: spec.vertices.length / 3 }, (_, index) => ({
        x: spec.vertices[index * 3]!, y: spec.vertices[index * 3 + 1]!, z: spec.vertices[index * 3 + 2]!,
      })));
  }
}
