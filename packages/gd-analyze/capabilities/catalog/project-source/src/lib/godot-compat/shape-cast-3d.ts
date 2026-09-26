/** Godot ShapeCast3D over Rapier's native swept-shape query. */
import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3, type Object3D, type Vector3Like } from 'three';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import { vec3, type Vector3 as GodotVector3 } from './variant-3d';

export interface ShapeCastBodyHandle { readonly handle: number }

export type GodotShapeCast3D = Object3D & {
  enabled: boolean;
  targetPosition: Vector3Like;
  margin: number;
  maxResults: number;
  collisionMask: number;
  collideWithAreas: boolean;
  collideWithBodies: boolean;
  forceShapecastUpdate(): void;
  isColliding(): boolean;
  getCollisionCount(): number;
  getCollider(index: number): unknown;
  getColliderShape(index: number): number;
  getCollisionPoint(index: number): GodotVector3;
  getCollisionNormal(index: number): GodotVector3;
  getClosestCollisionSafeFraction(): number;
  getClosestCollisionUnsafeFraction(): number;
  setCollisionMaskValue(layerNumber: number, value: boolean): void;
  getCollisionMaskValue(layerNumber: number): boolean;
  addException(body: ShapeCastBodyHandle): void;
  removeException(body: ShapeCastBodyHandle): void;
  clearExceptions(): void;
};

export interface CreateShapeCast3DOptions {
  readonly node: Object3D;
  readonly world: RAPIER.World;
  readonly shape: RAPIER.Shape;
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
  readonly targetPosition?: Vector3Like;
  readonly enabled?: boolean;
  readonly margin?: number;
  readonly maxResults?: number;
  readonly collisionMask?: number;
  readonly collideWithAreas?: boolean;
  readonly collideWithBodies?: boolean;
  readonly exclude?: readonly ShapeCastBodyHandle[];
}

interface ShapeCollision {
  readonly collider: RAPIER.Collider;
  readonly colliderObject: unknown;
  readonly point: GodotVector3;
  readonly normal: GodotVector3;
  readonly fraction: number;
  readonly shapeIndex: number;
}

function finiteVector(value: Vector3Like, name: string): Vector3 {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`ShapeCast3D ${name} must contain finite components`);
  }
  return new Vector3(value.x, value.y, value.z);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`ShapeCast3D ${name} must be >= 1`);
  return value;
}

function uint32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`ShapeCast3D ${name} must be a uint32`);
  }
  return value;
}

function layerBit(layerNumber: number): number {
  if (!Number.isInteger(layerNumber) || layerNumber < 1 || layerNumber > 32) {
    throw new RangeError('ShapeCast3D collision layer number must be in [1, 32]');
  }
  return 2 ** (layerNumber - 1);
}

function collisionPoint(collider: RAPIER.Collider, local: Vector3Like): GodotVector3 {
  const p = collider.translation();
  const r = collider.rotation();
  const world = new Vector3(local.x, local.y, local.z)
    .applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w))
    .add(new Vector3(p.x, p.y, p.z));
  return vec3(world.x, world.y, world.z);
}

function collisionNormal(collider: RAPIER.Collider, local: Vector3Like): GodotVector3 {
  const r = collider.rotation();
  const world = new Vector3(local.x, local.y, local.z)
    .applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w))
    .normalize();
  return vec3(world.x, world.y, world.z);
}

function colliderShapeIndex(collider: RAPIER.Collider): number {
  const body = collider.parent();
  if (body === null) {
    throw new Error('ShapeCast3D cannot expose a shape-owner index for a collider without a PhysicsBody3D');
  }
  for (let index = 0; index < body.numColliders(); index += 1) {
    if (body.collider(index).handle === collider.handle) return index;
  }
  throw new Error('ShapeCast3D collider is absent from its owning PhysicsBody3D collider registry');
}

export function createShapeCast3D(options: CreateShapeCast3DOptions): GodotShapeCast3D {
  const excluded = new Set<number>((options.exclude ?? []).map((body) => body.handle));
  let target = finiteVector(options.targetPosition ?? { x: 0, y: -1, z: 0 }, 'target_position');
  let enabled = options.enabled ?? true;
  let margin = options.margin ?? 0;
  let maxResults = positiveInteger(options.maxResults ?? 32, 'max_results');
  let collisionMask = uint32(options.collisionMask ?? 1, 'collision_mask');
  let collideWithAreas = options.collideWithAreas ?? false;
  let collideWithBodies = options.collideWithBodies ?? true;
  let collisions: ShapeCollision[] = [];

  const update = (): void => {
    collisions = [];
    if (!enabled) return;
    options.node.updateWorldMatrix(true, false);
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    options.node.matrixWorld.decompose(position, rotation, scale);
    if (![scale.x, scale.y, scale.z].every((one) => Math.abs(one - 1) <= 1e-7)) {
      throw new Error('ShapeCast3D refuses a scaled transform because Rapier shapes are unscaled');
    }
    const velocity = target.clone().applyQuaternion(rotation);
    const accepts = (collider: RAPIER.Collider): boolean => {
      const body = collider.parent();
      if (body !== null && excluded.has(body.handle)) return false;
      if (collider.isSensor() ? !collideWithAreas : !collideWithBodies) return false;
      return godotCanCollideWith(options.layers, collider, collisionMask);
    };
    // Godot first obtains one cast_motion fraction, moves the query shape to that
    // impact pose, and only then gathers rest_info contacts. It never collects
    // unrelated colliders encountered later along the sweep.
    const hit = options.world.castShape(
      position,
      rotation,
      velocity,
      options.shape,
      margin,
      1,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      accepts,
    );
    if (hit === null) return;
    const fraction = Math.max(0, Math.min(1, hit.time_of_impact));
    const impactPosition = position.clone().addScaledVector(velocity, fraction);
    options.world.forEachCollider((collider) => {
      if (collisions.length >= maxResults || !accepts(collider)) return;
      const contact = collider.contactShape(options.shape, impactPosition, rotation, margin);
      if (contact === null || contact.distance > margin) return;
      collisions.push({
        collider,
        colliderObject: options.resolveCollider(collider),
        point: vec3(contact.point1.x, contact.point1.y, contact.point1.z),
        normal: vec3(contact.normal1.x, contact.normal1.y, contact.normal1.z),
        fraction,
        shapeIndex: colliderShapeIndex(collider),
      });
    });
    // Rapier's contact query can omit a touching shape at an exact floating-point
    // boundary. Preserve the first native cast witness in that case.
    if (!collisions.some((one) => one.collider.handle === hit.collider.handle)) {
      collisions.push({
        collider: hit.collider,
        colliderObject: options.resolveCollider(hit.collider),
        point: collisionPoint(hit.collider, hit.witness2),
        normal: collisionNormal(hit.collider, hit.normal2),
        fraction,
        shapeIndex: colliderShapeIndex(hit.collider),
      });
    }
    collisions.sort((a, b) => a.collider.handle - b.collider.handle);
    if (collisions.length > maxResults) collisions.length = maxResults;
  };

  const collision = (index: number): ShapeCollision => {
    if (!Number.isInteger(index) || index < 0 || index >= collisions.length) {
      throw new RangeError(`ShapeCast3D collision index ${String(index)} is outside the result set`);
    }
    return collisions[index] as ShapeCollision;
  };

  const binding = options.node as GodotShapeCast3D;
  Object.defineProperties(binding, {
    enabled: { configurable: true, get: () => enabled, set: (value: boolean) => { enabled = value; if (!value) collisions = []; } },
    targetPosition: { configurable: true, get: () => vec3(target.x, target.y, target.z), set: (value: Vector3Like) => { target = finiteVector(value, 'target_position'); } },
    margin: { configurable: true, get: () => margin, set: (value: number) => {
      if (!Number.isFinite(value) || value < 0) throw new Error('ShapeCast3D margin must be >= 0');
      margin = value;
    } },
    maxResults: { configurable: true, get: () => maxResults, set: (value: number) => { maxResults = positiveInteger(value, 'max_results'); } },
    collisionMask: { configurable: true, get: () => collisionMask, set: (value: number) => {
      collisionMask = uint32(value, 'collision_mask');
    } },
    collideWithAreas: { configurable: true, get: () => collideWithAreas, set: (value: boolean) => { collideWithAreas = value; } },
    collideWithBodies: { configurable: true, get: () => collideWithBodies, set: (value: boolean) => { collideWithBodies = value; } },
  });
  return Object.assign(binding, {
    forceShapecastUpdate: update,
    isColliding(): boolean { return collisions.length > 0; },
    getCollisionCount(): number { return collisions.length; },
    getCollider(index: number): unknown { return collision(index).colliderObject; },
    getColliderShape(index: number): number { return collision(index).shapeIndex; },
    getCollisionPoint(index: number): GodotVector3 { return collision(index).point; },
    getCollisionNormal(index: number): GodotVector3 { return collision(index).normal; },
    getClosestCollisionSafeFraction(): number {
      const fraction = collisions[0]?.fraction;
      // Rapier exposes the impact TOI but not Godot's recovery bracket. Reporting
      // the same conservative fraction is meaningful; subtracting machine epsilon
      // would not establish separation at world scale.
      return fraction ?? 1;
    },
    getClosestCollisionUnsafeFraction(): number { return collisions[0]?.fraction ?? 1; },
    setCollisionMaskValue(layerNumber: number, value: boolean): void {
      if (typeof value !== 'boolean') throw new TypeError('ShapeCast3D mask value must be boolean');
      const bit = layerBit(layerNumber);
      collisionMask = value ? (collisionMask | bit) >>> 0 : (collisionMask & ~bit) >>> 0;
    },
    getCollisionMaskValue(layerNumber: number): boolean {
      return (collisionMask & layerBit(layerNumber)) !== 0;
    },
    addException(body: ShapeCastBodyHandle): void { excluded.add(body.handle); },
    removeException(body: ShapeCastBodyHandle): void { excluded.delete(body.handle); },
    clearExceptions(): void { excluded.clear(); },
  });
}
