/** Retained Godot Shape/Shape3D Resources backed by native Rapier geometry. */

import RAPIER from '@dimforge/rapier3d-compat';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import { vec3, type Vector3 } from './variant-3d';

export interface GodotShape3DConsumer { setShape(shape: RAPIER.Shape): void }
interface Shape3DBase { readonly at: Vector3; readonly nativeShape: RAPIER.Shape }
export interface GodotBoxShape extends Shape3DBase {
  readonly kind: 'box'; readonly type: 'box'; readonly halfExtents: Vector3;
  extents: Vector3; size: Vector3;
}
export interface GodotSphereShape3D extends Shape3DBase {
  readonly kind: 'sphere'; readonly type: 'sphere'; radius: number;
}
export interface GodotCapsuleShape3D extends Shape3DBase {
  readonly kind: 'capsule'; readonly type: 'capsule'; readonly godotMajor: 3 | 4;
  radius: number; height: number; mid_height: number; readonly colliderHeight: number;
}
export interface GodotCylinderShape3D extends Shape3DBase {
  readonly kind: 'cylinder'; readonly type: 'cylinder'; radius: number; height: number;
}
export interface GodotConvexPolygonShape3D extends Shape3DBase {
  readonly kind: 'convex'; readonly type: 'convex'; points: readonly Vector3[];
  readonly godotMajor: 3 | 4;
  readonly vertices: Float32Array;
}
export interface GodotConcavePolygonShape3D extends Shape3DBase {
  readonly kind: 'trimesh'; readonly type: 'trimesh'; faces: readonly Vector3[];
  data: readonly Vector3[]; readonly godotMajor: 3 | 4;
  backface_collision: boolean; readonly vertices: Float32Array; readonly triangles: number;
}
export interface GodotSeparationRayShape3D extends Shape3DBase {
  readonly kind: 'separation-ray'; readonly type: 'separation-ray';
  length: number; slide_on_slope: boolean;
  set_length(value: number): void;
  get_length(): number;
  set_slide_on_slope(value: boolean): void;
  get_slide_on_slope(): boolean;
}
export interface GodotRayShape3D extends Shape3DBase {
  readonly kind: 'ray'; readonly type: 'ray';
  length: number; slips_on_slope: boolean;
  set_length(value: number): void;
  get_length(): number;
  set_slips_on_slope(value: boolean): void;
  get_slips_on_slope(): boolean;
}
export type GodotShape3D = GodotBoxShape | GodotSphereShape3D | GodotCapsuleShape3D |
  GodotCylinderShape3D | GodotConvexPolygonShape3D | GodotConcavePolygonShape3D |
  GodotSeparationRayShape3D | GodotRayShape3D;

const SHAPE_CONSUMERS = new WeakMap<object, Set<GodotShape3DConsumer>>();
const GODOT_SHAPES = new WeakSet<object>();
const ORIGIN = Object.freeze(vec3(0, 0, 0));

function finiteNonNegative(value: number, member: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${member} requires a finite non-negative number.`);
  return value;
}
function finiteVector(value: Readonly<Vector3>, member: string): Vector3 {
  const result = vec3(Number(value.x), Number(value.y), Number(value.z));
  if (![result.x, result.y, result.z].every(Number.isFinite)) throw new TypeError(`${member} requires a finite Vector3.`);
  return result;
}
function nonNegativeVector(value: Readonly<Vector3>, member: string): Vector3 {
  const result = finiteVector(value, member);
  if (result.x < 0 || result.y < 0 || result.z < 0) throw new RangeError(`${member} requires non-negative components.`);
  return result;
}
function shapePoints(value: Iterable<Readonly<Vector3>>, member: string): Vector3[] {
  if (value === null || value === undefined || typeof value[Symbol.iterator] !== 'function') {
    throw new TypeError(`${member} requires a PackedVector3Array-compatible iterable.`);
  }
  return [...value].map((point, index) => finiteVector(point, `${member}[${index}]`));
}
function shapeVertices(value: readonly Vector3[]): Float32Array {
  const result = new Float32Array(value.length * 3);
  value.forEach((point, index) => {
    result[index * 3] = point.x; result[index * 3 + 1] = point.y; result[index * 3 + 2] = point.z;
  });
  return result;
}
function changed(shape: GodotShape3D): void {
  for (const consumer of SHAPE_CONSUMERS.get(shape) ?? []) consumer.setShape(shape.nativeShape);
  godotResourceEmitChanged(shape);
}
export function retainGodotShape3D(shape: GodotShape3D, consumer: GodotShape3DConsumer): void {
  void shape.nativeShape;
  let consumers = SHAPE_CONSUMERS.get(shape);
  if (consumers === undefined) { consumers = new Set(); SHAPE_CONSUMERS.set(shape, consumers); }
  if (consumers.has(consumer)) throw new Error('Shape3D native consumer is already retained.');
  consumers.add(consumer);
}
export function releaseGodotShape3D(shape: GodotShape3D, consumer: GodotShape3DConsumer): void {
  const consumers = SHAPE_CONSUMERS.get(shape);
  if (consumers === undefined || !consumers.delete(consumer)) throw new Error('Shape3D native consumer retention underflow.');
  if (consumers.size === 0) SHAPE_CONSUMERS.delete(shape);
}
export function isGodotShape3D(value: unknown): value is GodotShape3D {
  return typeof value === 'object' && value !== null && GODOT_SHAPES.has(value);
}

type AuthoredBoxOrCylinder =
  | { readonly type: 'box'; readonly halfExtents: Vector3; readonly at: Vector3 }
  | { readonly type: 'cylinder'; readonly radius: number; readonly height: number; readonly at: Vector3 };

/** Materialize an authored Box/Cylinder sub-resource through the same live Resource constructors
 * used by `Shape.new()`, while retaining the CollisionShape-local placement the native collider
 * consumes. The placement is translator metadata, not a Shape member; duplication correctly
 * creates a plain Resource at the origin through each constructor's existing duplicate closure. */
export function createGodotAuthoredShapeResource(
  authored: AuthoredBoxOrCylinder,
  godotClass: 'BoxShape' | 'BoxShape3D' | 'CylinderShape' | 'CylinderShape3D',
): GodotBoxShape | GodotCylinderShape3D {
  let resource: GodotBoxShape | GodotCylinderShape3D;
  if (godotClass === 'BoxShape' || godotClass === 'BoxShape3D') {
    if (authored.type !== 'box') throw new TypeError(`${godotClass} requires authored box dimensions.`);
    resource = godotClass === 'BoxShape'
      ? createGodotBoxShape(authored.halfExtents)
      : createGodotBoxShape3D(vec3(
          authored.halfExtents.x * 2,
          authored.halfExtents.y * 2,
          authored.halfExtents.z * 2,
        ));
  } else {
    if (authored.type !== 'cylinder') throw new TypeError(`${godotClass} requires authored cylinder dimensions.`);
    resource = godotClass === 'CylinderShape'
      ? createGodotCylinderShape(authored.radius, authored.height)
      : createGodotCylinderShape3D(authored.radius, authored.height);
  }
  Object.defineProperty(resource, 'at', {
    configurable: true,
    enumerable: true,
    value: finiteVector(authored.at, `${godotClass} collider placement`),
  });
  return resource;
}

function makeBoxShape(godotClass: 'BoxShape' | 'BoxShape3D', extents: Vector3): GodotBoxShape {
  let halfExtents = nonNegativeVector(extents, `${godotClass}.${godotClass === 'BoxShape' ? 'extents' : 'size'}`);
  let nativeShape = new RAPIER.Cuboid(halfExtents.x, halfExtents.y, halfExtents.z);
  const value = { kind: 'box', type: 'box', at: ORIGIN } as GodotBoxShape;
  const setHalfExtents = (next: Vector3, member: string): void => {
    const finite = nonNegativeVector(next, member);
    if (finite.x === halfExtents.x && finite.y === halfExtents.y && finite.z === halfExtents.z) return;
    halfExtents = finite; nativeShape = new RAPIER.Cuboid(finite.x, finite.y, finite.z); changed(value);
  };
  Object.defineProperties(value, {
    halfExtents: { enumerable: true, get: () => vec3(halfExtents.x, halfExtents.y, halfExtents.z) },
    extents: { enumerable: true, get: () => vec3(halfExtents.x, halfExtents.y, halfExtents.z), set: (next: Vector3) => setHalfExtents(next, 'BoxShape.extents') },
    size: { enumerable: true, get: () => vec3(halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2), set: (next: Vector3) => {
      const size = nonNegativeVector(next, 'BoxShape3D.size');
      setHalfExtents(vec3(size.x / 2, size.y / 2, size.z / 2), 'BoxShape3D.size');
    } },
    nativeShape: { enumerable: false, get: () => nativeShape },
  });
  GODOT_SHAPES.add(value);
  registerGodotObjectIdentity(value, godotClass);
  return bindGodotResourceProtocol(value, { createDuplicate(source) {
    return godotClass === 'BoxShape' ? createGodotBoxShape(source.extents) : createGodotBoxShape3D(source.size);
  } });
}
export function createGodotBoxShape(extents: Vector3 = vec3(1, 1, 1)): GodotBoxShape { return makeBoxShape('BoxShape', extents); }
export function createGodotBoxShape3D(size: Vector3 = vec3(1, 1, 1)): GodotBoxShape {
  const finite = nonNegativeVector(size, 'BoxShape3D.size');
  return makeBoxShape('BoxShape3D', vec3(finite.x / 2, finite.y / 2, finite.z / 2));
}

function makeSphereShape(godotClass: 'SphereShape' | 'SphereShape3D', radius: number): GodotSphereShape3D {
  let liveRadius = finiteNonNegative(radius, `${godotClass}.radius`);
  let nativeShape = new RAPIER.Ball(liveRadius);
  const value = { kind: 'sphere', type: 'sphere', at: ORIGIN } as GodotSphereShape3D;
  Object.defineProperties(value, {
    radius: { enumerable: true, get: () => liveRadius, set: (next: number) => {
      const finite = finiteNonNegative(next, `${godotClass}.radius`);
      if (finite === liveRadius) return; liveRadius = finite; nativeShape = new RAPIER.Ball(finite); changed(value);
    } },
    nativeShape: { enumerable: false, get: () => nativeShape },
  });
  GODOT_SHAPES.add(value);
  registerGodotObjectIdentity(value, godotClass);
  return bindGodotResourceProtocol(value, { createDuplicate(source) { return makeSphereShape(godotClass, source.radius); } });
}
export function createGodotSphereShape(radius = 1): GodotSphereShape3D { return makeSphereShape('SphereShape', radius); }
export function createGodotSphereShape3D(radius = 0.5): GodotSphereShape3D { return makeSphereShape('SphereShape3D', radius); }

export function createGodotCapsuleShape3D(godotMajor: 3 | 4 = 4, radius = 0.5, height = 2): GodotCapsuleShape3D {
  const godotClass = godotMajor === 4 ? 'CapsuleShape3D' : 'CapsuleShape';
  let liveRadius = finiteNonNegative(radius, `${godotClass}.radius`);
  let liveHeight = finiteNonNegative(height, `${godotClass}.height`);
  if (godotMajor === 4 && liveHeight < liveRadius * 2) liveRadius = liveHeight / 2;
  const midHeight = (): number => godotMajor === 4 ? Math.max(0, liveHeight - liveRadius * 2) : liveHeight;
  let nativeShape = new RAPIER.Capsule(midHeight() / 2, liveRadius);
  const value = { kind: 'capsule', type: 'capsule', godotMajor, at: ORIGIN } as GodotCapsuleShape3D;
  const rebuild = (): void => { nativeShape = new RAPIER.Capsule(midHeight() / 2, liveRadius); changed(value); };
  Object.defineProperties(value, {
    radius: { enumerable: true, get: () => liveRadius, set: (next: number) => {
      const finite = finiteNonNegative(next, `${godotClass}.radius`);
      if (finite === liveRadius) return;
      liveRadius = finite;
      if (godotMajor === 4 && liveHeight < liveRadius * 2) liveHeight = liveRadius * 2;
      rebuild();
    } },
    height: { enumerable: true, get: () => liveHeight, set: (next: number) => {
      const finite = finiteNonNegative(next, `${godotClass}.height`);
      if (finite === liveHeight) return; liveHeight = finite;
      if (godotMajor === 4 && liveRadius * 2 > liveHeight) liveRadius = liveHeight / 2;
      rebuild();
    } },
    mid_height: { enumerable: true, get: midHeight, set: (next: number) => {
      const finite = finiteNonNegative(next, `${godotClass}.mid_height`);
      const nextHeight = godotMajor === 4 ? finite + liveRadius * 2 : finite;
      if (nextHeight === liveHeight) return;
      liveHeight = nextHeight;
      rebuild();
    } },
    colliderHeight: { enumerable: false, get: midHeight },
    nativeShape: { enumerable: false, get: () => nativeShape },
  });
  GODOT_SHAPES.add(value);
  registerGodotObjectIdentity(value, godotClass);
  return bindGodotResourceProtocol(value, { createDuplicate(source) {
    return createGodotCapsuleShape3D(source.godotMajor, source.radius, source.height);
  } });
}

function makeCylinderShape(godotClass: 'CylinderShape' | 'CylinderShape3D', radius: number, height: number): GodotCylinderShape3D {
  let liveRadius = finiteNonNegative(radius, `${godotClass}.radius`);
  let liveHeight = finiteNonNegative(height, `${godotClass}.height`);
  let nativeShape = new RAPIER.Cylinder(liveHeight / 2, liveRadius);
  const value = { kind: 'cylinder', type: 'cylinder', at: ORIGIN } as GodotCylinderShape3D;
  const rebuild = (): void => { nativeShape = new RAPIER.Cylinder(liveHeight / 2, liveRadius); changed(value); };
  Object.defineProperties(value, {
    radius: { enumerable: true, get: () => liveRadius, set: (next: number) => {
      const finite = finiteNonNegative(next, `${godotClass}.radius`);
      if (finite === liveRadius) return; liveRadius = finite; rebuild();
    } },
    height: { enumerable: true, get: () => liveHeight, set: (next: number) => {
      const finite = finiteNonNegative(next, `${godotClass}.height`);
      if (finite === liveHeight) return; liveHeight = finite; rebuild();
    } },
    nativeShape: { enumerable: false, get: () => nativeShape },
  });
  GODOT_SHAPES.add(value);
  registerGodotObjectIdentity(value, godotClass);
  return bindGodotResourceProtocol(value, { createDuplicate(source) {
    return makeCylinderShape(godotClass, source.radius, source.height);
  } });
}
export function createGodotCylinderShape(radius = 1, height = 2): GodotCylinderShape3D {
  return makeCylinderShape('CylinderShape', radius, height);
}
export function createGodotCylinderShape3D(radius = 0.5, height = 2): GodotCylinderShape3D {
  return makeCylinderShape('CylinderShape3D', radius, height);
}

export function createGodotSeparationRayShape3D(
  length = 1,
  slideOnSlope = false,
): GodotSeparationRayShape3D {
  let retainedLength = finiteNonNegative(length, 'SeparationRayShape3D.length');
  let retainedSlide = Boolean(slideOnSlope);
  let nativeShape: RAPIER.Shape = new RAPIER.Capsule(retainedLength / 2, 0);
  const value = { kind: 'separation-ray', type: 'separation-ray', at: ORIGIN } as GodotSeparationRayShape3D;
  const setLength = (next: number): void => {
    const finite = finiteNonNegative(next, 'SeparationRayShape3D.length');
    if (finite === retainedLength) return;
    retainedLength = finite;
    nativeShape = new RAPIER.Capsule(retainedLength / 2, 0);
    changed(value);
  };
  const setSlide = (next: boolean): void => {
    if (typeof next !== 'boolean') throw new TypeError('SeparationRayShape3D.slide_on_slope requires bool.');
    if (next === retainedSlide) return;
    retainedSlide = next;
    godotResourceEmitChanged(value);
  };
  Object.defineProperties(value, {
    nativeShape: { enumerable: true, get: () => nativeShape },
    length: { enumerable: true, get: () => retainedLength, set: setLength },
    slide_on_slope: { enumerable: true, get: () => retainedSlide, set: setSlide },
  });
  Object.assign(value, {
    set_length: setLength,
    get_length: () => retainedLength,
    set_slide_on_slope: setSlide,
    get_slide_on_slope: () => retainedSlide,
  });
  GODOT_SHAPES.add(value);
  registerGodotObjectIdentity(value, 'SeparationRayShape3D');
  return bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createGodotSeparationRayShape3D(source.length, source.slide_on_slope); },
  });
}

/** Godot 3's ray resource reaches from its local origin along +Z for `length` units. */
export function createGodotRayShape(length = 1, slipsOnSlope = false): GodotRayShape3D {
  let retainedLength = finiteNonNegative(length, 'RayShape.length');
  let retainedSlips = Boolean(slipsOnSlope);
  let nativeShape: RAPIER.Shape = new RAPIER.Segment(ORIGIN, vec3(0, 0, retainedLength));
  const value = { kind: 'ray', type: 'ray', at: ORIGIN } as GodotRayShape3D;
  const setLength = (next: number): void => {
    const finite = finiteNonNegative(next, 'RayShape.length');
    if (finite === retainedLength) return;
    retainedLength = finite;
    nativeShape = new RAPIER.Segment(ORIGIN, vec3(0, 0, retainedLength));
    changed(value);
  };
  const setSlips = (next: boolean): void => {
    if (typeof next !== 'boolean') throw new TypeError('RayShape.slips_on_slope requires bool.');
    if (next === retainedSlips) return;
    retainedSlips = next;
    godotResourceEmitChanged(value);
  };
  Object.defineProperties(value, {
    nativeShape: { enumerable: false, get: () => nativeShape },
    length: { enumerable: true, get: () => retainedLength, set: setLength },
    slips_on_slope: { enumerable: true, get: () => retainedSlips, set: setSlips },
  });
  Object.assign(value, {
    set_length: setLength,
    get_length: () => retainedLength,
    set_slips_on_slope: setSlips,
    get_slips_on_slope: () => retainedSlips,
  });
  GODOT_SHAPES.add(value);
  registerGodotObjectIdentity(value, 'RayShape');
  return bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createGodotRayShape(source.length, source.slips_on_slope); },
  });
}

export function createGodotConvexPolygonShape3D(
  initialPoints: Iterable<Readonly<Vector3>> = [],
  godotMajor: 3 | 4 = 4,
): GodotConvexPolygonShape3D {
  const className = godotMajor === 3 ? 'ConvexPolygonShape' : 'ConvexPolygonShape3D';
  let livePoints = shapePoints(initialPoints, `${className}.points`);
  let liveVertices = shapeVertices(livePoints);
  let nativeShape = livePoints.length >= 4 ? RAPIER.ColliderDesc.convexHull(liveVertices)?.shape ?? null : null;
  if (livePoints.length > 0 && nativeShape === null) throw new RangeError(`${className}.points must form a non-degenerate 3D convex hull.`);
  const value = { kind: 'convex', type: 'convex', at: ORIGIN, godotMajor } as GodotConvexPolygonShape3D;
  Object.defineProperties(value, {
    points: { enumerable: true, get: () => livePoints.map((point) => vec3(point.x, point.y, point.z)), set: (next: Iterable<Vector3>) => {
      const nextPoints = shapePoints(next, `${className}.points`);
      const nextVertices = shapeVertices(nextPoints);
      const nextShape = nextPoints.length >= 4 ? RAPIER.ColliderDesc.convexHull(nextVertices)?.shape ?? null : null;
      if (nextPoints.length > 0 && nextShape === null) throw new RangeError(`${className}.points must form a non-degenerate 3D convex hull.`);
      if (nextShape === null && (SHAPE_CONSUMERS.get(value)?.size ?? 0) > 0) {
        throw new Error(`${className}.points cannot be cleared while native colliders retain the shape.`);
      }
      livePoints = nextPoints; liveVertices = nextVertices; nativeShape = nextShape; changed(value);
    } },
    // Enumerable because the emitter composes the retained Resource with CollisionShape3D's
    // node-local placement/surface clauses for the one native attach. The Resource remains the
    // retained identity; later `points` writes replace the collider shape through `changed`.
    vertices: { enumerable: true, get: () => liveVertices.slice() },
    nativeShape: { enumerable: false, get: () => {
      if (nativeShape === null) throw new Error(`${className} needs at least four hull points before native use.`);
      return nativeShape;
    } },
  });
  GODOT_SHAPES.add(value);
  registerGodotObjectIdentity(value, className);
  return bindGodotResourceProtocol(value, { createDuplicate(source) {
    return createGodotConvexPolygonShape3D(source.points, source.godotMajor);
  } });
}

export function createGodotConcavePolygonShape3D(
  initialFaces: Iterable<Readonly<Vector3>> = [],
  godotMajor: 3 | 4 = 4,
): GodotConcavePolygonShape3D {
  const className = godotMajor === 3 ? 'ConcavePolygonShape' : 'ConcavePolygonShape3D';
  let liveFaces = shapePoints(initialFaces, `${className}.faces`);
  if (liveFaces.length % 3 !== 0) throw new RangeError(`${className}.faces requires complete triangles.`);
  let liveVertices = shapeVertices(liveFaces);
  let backfaceCollision = false;
  const makeNative = (): RAPIER.Shape => {
    const indices = new Uint32Array(liveFaces.length);
    for (let index = 0; index < indices.length; index += 1) indices[index] = index;
    return RAPIER.ColliderDesc.trimesh(liveVertices, indices).shape;
  };
  let nativeShape: RAPIER.Shape | null = liveFaces.length === 0 ? null : makeNative();
  const value = { kind: 'trimesh', type: 'trimesh', at: ORIGIN, godotMajor } as GodotConcavePolygonShape3D;
  const rebuild = (): void => { nativeShape = liveFaces.length === 0 ? null : makeNative(); changed(value); };
  Object.defineProperties(value, {
    faces: { enumerable: true, get: () => liveFaces.map((point) => vec3(point.x, point.y, point.z)), set: (next: Iterable<Vector3>) => {
      const nextFaces = shapePoints(next, `${className}.faces`);
      if (nextFaces.length % 3 !== 0) throw new RangeError(`${className}.faces requires complete triangles.`);
      if (nextFaces.length === 0 && (SHAPE_CONSUMERS.get(value)?.size ?? 0) > 0) {
        throw new Error(`${className}.faces cannot be cleared while native colliders retain the shape.`);
      }
      liveFaces = nextFaces; liveVertices = shapeVertices(nextFaces); rebuild();
    } },
    data: { enumerable: true, get: () => liveFaces.map((point) => vec3(point.x, point.y, point.z)), set: (next: Iterable<Vector3>) => {
      const nextFaces = shapePoints(next, `${className}.data`);
      if (nextFaces.length % 3 !== 0) throw new RangeError(`${className}.data requires complete triangles.`);
      if (nextFaces.length === 0 && (SHAPE_CONSUMERS.get(value)?.size ?? 0) > 0) {
        throw new Error(`${className}.data cannot be cleared while native colliders retain the shape.`);
      }
      liveFaces = nextFaces; liveVertices = shapeVertices(nextFaces); rebuild();
    } },
    backface_collision: { enumerable: true, get: () => backfaceCollision, set: (next: boolean) => {
      if (typeof next !== 'boolean') throw new TypeError(`${className}.backface_collision requires bool.`);
      if (next === backfaceCollision) return;
      if (next) {
        throw new Error(
          `${className}.backface_collision requires one-sided triangle configuration ` +
          'that the native Rapier shape API does not expose.',
        );
      }
      backfaceCollision = false;
    } },
    vertices: { enumerable: false, get: () => liveVertices.slice() },
    triangles: { enumerable: false, get: () => liveFaces.length / 3 },
    nativeShape: { enumerable: false, get: () => {
      if (nativeShape === null) throw new Error(`${className} needs at least one triangle before native use.`);
      return nativeShape;
    } },
  });
  GODOT_SHAPES.add(value);
  registerGodotObjectIdentity(value, className);
  return bindGodotResourceProtocol(value, { createDuplicate(source) {
    const duplicate = createGodotConcavePolygonShape3D(source.faces, source.godotMajor);
    duplicate.backface_collision = source.backface_collision;
    return duplicate;
  } });
}
