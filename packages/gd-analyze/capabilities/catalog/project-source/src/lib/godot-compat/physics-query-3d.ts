/** Godot 3D direct-space query parameters and queries over the project's native Rapier world. */
import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Quaternion, Vector3 as ThreeVector3, type Vector3Like } from 'three';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import {
  godotCarrierOfRid,
  godotGlobalCall,
  godotRidOfCarrier,
  type GodotRid,
} from './gdscript-builtins';
import { rapierShape3D, type ColliderAttachShape } from './collider-3d';
import { godotObjectInstanceId, registerGodotObjectIdentity } from './object';
import { packedFloat32Array, type PackedArrayValue } from './packed-array';
import { godotDictionary, type GodotDictionary } from './variant';
import { transform3, type Transform, vec3, type Vector3 } from './variant-3d';
import { physicsServerShapeNative3D } from './physics-server-area-3d';

export interface QueryBodyHandle { readonly handle: number }
export type PhysicsQueryExclude3D = QueryBodyHandle | GodotRid;

export interface PhysicsArea3DRegistration {
  readonly node: object;
  readonly sceneOwned: boolean;
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly shapes: RAPIER.Collider[][];
}

const RID_BY_WORLD = new WeakMap<object, GodotRid>();
const WORLD_BY_RID = new Map<bigint, WeakRef<object>>();
const AREA_BY_NODE = new WeakMap<object, PhysicsArea3DRegistration>();
const AREA_BY_COLLIDER = new WeakMap<object, PhysicsArea3DRegistration>();
const RID_BY_AREA = new WeakMap<object, GodotRid>();
const AREA_BY_RID = new Map<bigint, object>();
const OBJECT_ID_BY_AREA = new WeakMap<object, bigint>();

function allocatePhysicsRid3D(): GodotRid {
  const id = godotGlobalCall<number>('rid_allocate_id', []);
  return godotGlobalCall('rid_from_int64', [id]);
}

export function registerPhysicsArea3D(registration: PhysicsArea3DRegistration): GodotRid {
  if (AREA_BY_NODE.has(registration.node)) throw new Error('PhysicsServer3D Area RID registry received an already-registered retained Area3D node');
  if (registration.world.getRigidBody(registration.body.handle) !== registration.body) throw new Error('PhysicsServer3D Area body belongs to a different native Rapier world');
  const registeredSensors = new Set<number>();
  for (const shape of registration.shapes) for (const collider of shape) {
    if (registration.world.getCollider(collider.handle) !== collider || !collider.isSensor()) throw new Error('PhysicsServer3D Area shapes must be live native Rapier sensors in the registered world');
    if (collider.parent() !== registration.body) throw new Error('PhysicsServer3D Area sensor is attached to a body not exclusively owned by the registered Area3D');
    if (AREA_BY_COLLIDER.has(collider)) throw new Error('PhysicsServer3D Area sensor is already owned by another registered Area RID');
    if (registeredSensors.has(collider.handle)) throw new Error('PhysicsServer3D Area sensor cannot occupy more than one authored shape group');
    registeredSensors.add(collider.handle);
  }
  const rid = allocatePhysicsRid3D();
  for (const group of registration.shapes) for (const collider of group) AREA_BY_COLLIDER.set(collider, registration);
  AREA_BY_NODE.set(registration.node, registration);
  RID_BY_AREA.set(registration.node, rid);
  AREA_BY_RID.set(rid.id, registration.node);
  return rid;
}

export function unregisterPhysicsArea3D(node: object): void {
  const registration = AREA_BY_NODE.get(node);
  if (registration === undefined) return;
  for (const group of registration.shapes) for (const collider of group) AREA_BY_COLLIDER.delete(collider);
  const rid = RID_BY_AREA.get(node);
  if (rid !== undefined && AREA_BY_RID.get(rid.id) === node) AREA_BY_RID.delete(rid.id);
  RID_BY_AREA.delete(node);
  OBJECT_ID_BY_AREA.delete(node);
  AREA_BY_NODE.delete(node);
}

export function replacePhysicsArea3DShapes(node: object, shapes: RAPIER.Collider[][]): void {
  const registration = AREA_BY_NODE.get(node);
  if (registration === undefined) throw new Error('PhysicsServer3D Area shape mutation requires a live registered Area RID');
  const handles = new Set<number>();
  for (const group of shapes) for (const collider of group) {
    if (registration.world.getCollider(collider.handle) !== collider || !collider.isSensor() || collider.parent() !== registration.body) throw new Error('PhysicsServer3D Area shape mutation received a sensor not owned by the registered Area body');
    const owner = AREA_BY_COLLIDER.get(collider);
    if (owner !== undefined && owner !== registration) throw new Error('PhysicsServer3D Area shape mutation received a sensor owned by another Area RID');
    if (handles.has(collider.handle)) throw new Error('PhysicsServer3D Area sensor cannot occupy more than one shape group');
    handles.add(collider.handle);
  }
  for (const group of registration.shapes) for (const collider of group) AREA_BY_COLLIDER.delete(collider);
  registration.shapes.splice(0, registration.shapes.length, ...shapes);
  for (const group of shapes) for (const collider of group) AREA_BY_COLLIDER.set(collider, registration);
}

export function physicsArea3DOfRid(rid: GodotRid): PhysicsArea3DRegistration {
  if (typeof rid !== 'object' || rid === null || typeof rid.id !== 'bigint') throw new Error('PhysicsServer3D Area RID must be an actual Godot RID value');
  const node = AREA_BY_RID.get(rid.id);
  const registration = node === undefined ? undefined : AREA_BY_NODE.get(node);
  if (registration === undefined) {
    AREA_BY_RID.delete(rid.id);
    throw new Error('PhysicsServer3D Area RID does not name a live registered native Area3D');
  }
  return registration;
}

/** Read the retained Area registration by its actual world-node identity without fabricating RID state. */
export function physicsArea3DOfNode(node: object): PhysicsArea3DRegistration | undefined {
  return AREA_BY_NODE.get(node);
}

export function physicsAreaRid3DOf(node: object): GodotRid {
  const rid = RID_BY_AREA.get(node);
  if (rid === undefined) throw new Error('Area3D has no live registered native Area RID');
  return rid;
}

export function physicsSpaceRid3D(world: RAPIER.World): GodotRid {
  let rid = RID_BY_WORLD.get(world);
  if (rid === undefined) {
    rid = allocatePhysicsRid3D();
    RID_BY_WORLD.set(world, rid);
    WORLD_BY_RID.set(rid.id, new WeakRef(world));
  }
  return rid;
}

export function physicsWorld3DOfRid(rid: GodotRid): RAPIER.World {
  if (typeof rid !== 'object' || rid === null || typeof rid.id !== 'bigint') throw new Error('PhysicsServer3D space must be an actual Godot RID value');
  const world = WORLD_BY_RID.get(rid.id)?.deref();
  if (world === undefined) {
    WORLD_BY_RID.delete(rid.id);
    throw new Error('PhysicsServer3D space RID does not name a live registered native Rapier world');
  }
  return world as RAPIER.World;
}

export function setPhysicsAreaObjectInstanceId3D(node: object, id: bigint): void {
  if (!AREA_BY_NODE.has(node)) throw new Error('PhysicsServer3D Area object instance ID requires a live registered Area RID');
  OBJECT_ID_BY_AREA.set(node, id);
}

export function physicsArea3DOfCollider(collider: RAPIER.Collider): PhysicsArea3DRegistration | undefined {
  return AREA_BY_COLLIDER.get(collider);
}

export function physicsAreaObjectInstanceId3D(node: object): bigint | undefined {
  return OBJECT_ID_BY_AREA.get(node);
}

export interface GodotPhysicsShapeQueryParameters3D {
  shape: RAPIER.Shape | ColliderAttachShape | GodotRid | null;
  shapeRid: RAPIER.Shape | ColliderAttachShape | GodotRid | null;
  transform: Transform;
  motion: Vector3;
  margin: number;
  collisionMask: number;
  exclude: PhysicsQueryExclude3D[];
  collideWithBodies: boolean;
  collideWithAreas: boolean;
}

export interface GodotPhysicsPointQueryParameters3D {
  position: Vector3;
  collisionMask: number;
  exclude: PhysicsQueryExclude3D[];
  collideWithBodies: boolean;
  collideWithAreas: boolean;
}

export type GodotShapeQueryHit = GodotDictionary & {
  readonly collider: unknown;
  readonly collider_id: bigint;
  readonly rid: QueryBodyHandle | GodotRid;
  readonly shape: number;
};

export type GodotRestInfo = GodotDictionary & {
  readonly collider_id: bigint;
  readonly rid: QueryBodyHandle | GodotRid;
  readonly shape: number;
  readonly point: Vector3;
  readonly normal: Vector3;
  readonly linear_velocity: Vector3;
};

export type GodotRestMiss = GodotDictionary & {
  readonly collider_id?: undefined;
  readonly rid?: undefined;
  readonly shape?: undefined;
  readonly point?: undefined;
  readonly normal?: undefined;
  readonly linear_velocity?: undefined;
};

export type GodotRestResult = GodotRestInfo | GodotRestMiss;

function queryDictionary<T extends object>(entries: Readonly<Record<string, unknown>>): GodotDictionary & T {
  const value = godotDictionary(Object.entries(entries)) as GodotDictionary & T;
  for (const key of Object.keys(entries)) {
    Object.defineProperty(value, key, {
      configurable: true,
      enumerable: false,
      get: () => value.get(key),
      set: (next: unknown) => { value.set(key, next); },
    });
  }
  return value;
}

export interface PhysicsQuerySpaceOptions {
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
  readonly godotMajor: 3 | 4;
}

export interface PhysicsShapeQueryMethods3D {
  intersectPoint(parameters: GodotPhysicsPointQueryParameters3D, maxResults?: number): GodotShapeQueryHit[];
  intersectPointLegacy(
    position: Vector3Like,
    maxResults?: number,
    exclude?: readonly PhysicsQueryExclude3D[],
    collisionMask?: number,
    collideWithBodies?: boolean,
    collideWithAreas?: boolean,
  ): GodotShapeQueryHit[];
  intersectShape(parameters: GodotPhysicsShapeQueryParameters3D, maxResults?: number): GodotShapeQueryHit[];
  castMotion(parameters: GodotPhysicsShapeQueryParameters3D): PackedArrayValue<number> | number[];
  collideShape(parameters: GodotPhysicsShapeQueryParameters3D, maxResults?: number): Vector3[];
  getRestInfo(parameters: GodotPhysicsShapeQueryParameters3D): GodotRestResult;
}

const IDENTITY_BASIS = [
  vec3(1, 0, 0),
  vec3(0, 1, 0),
  vec3(0, 0, 1),
] as const;
const IDENTITY_TRANSFORM = transform3(IDENTITY_BASIS, vec3(0, 0, 0));

function copyTransform(value: Transform): Transform {
  return transform3(value.basis, value.origin);
}

function finiteVector(value: Vector3Like, member: string): Vector3 {
  if (![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new TypeError(`${member} must contain finite Vector3 components`);
  }
  return vec3(value.x, value.y, value.z);
}

function uint32(value: number, member: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${member} must be an integer representable at the JavaScript boundary`);
  }
  return value >>> 0;
}

function nativeMargin(parameters: GodotPhysicsShapeQueryParameters3D): number {
  if (parameters.margin < 0) {
    throw new Error(
      'PhysicsShapeQueryParameters3D.margin accepts negative values in Godot, but Rapier shape ' +
        'prediction distances do not represent negative/shrinking margins.',
    );
  }
  return parameters.margin;
}

function exclusions(value: readonly PhysicsQueryExclude3D[], member: string): PhysicsQueryExclude3D[] {
  if (!Array.isArray(value)) throw new TypeError(`${member} must contain PhysicsBody3D handles or actual Godot RIDs`);
  const unique = new Map<string, PhysicsQueryExclude3D>();
  for (const item of value) {
    if (typeof item !== 'object' || item === null) throw new TypeError(`${member} must contain PhysicsBody3D handles or actual Godot RIDs`);
    if ('id' in item && typeof item.id === 'bigint') unique.set(`r:${item.id}`, item as GodotRid);
    else if ('handle' in item && Number.isInteger(item.handle)) unique.set(`h:${item.handle}`, item as QueryBodyHandle);
    else throw new TypeError(`${member} must contain PhysicsBody3D handles or actual Godot RIDs`);
  }
  return [...unique.values()];
}

function isColliderSpec(value: unknown): value is ColliderAttachShape {
  return typeof value === 'object' && value !== null &&
    ['box', 'sphere', 'capsule', 'cylinder', 'convex', 'trimesh'].includes(String(Reflect.get(value, 'type')));
}

function nativeShape(value: GodotPhysicsShapeQueryParameters3D['shape'], godotMajor: 3 | 4): RAPIER.Shape {
  if (value === null) throw new Error('PhysicsShapeQueryParameters3D.shape is null');
  if (Reflect.has(value as object, 'id') && !isColliderSpec(value)) {
    return physicsServerShapeNative3D(godotMajor, value as GodotRid);
  }
  return isColliderSpec(value) ? rapierShape3D(value) : value as RAPIER.Shape;
}

export function createPhysicsShapeQueryParameters3D(
  godotMajor: 3 | 4,
): GodotPhysicsShapeQueryParameters3D {
  let shapeRef: GodotPhysicsShapeQueryParameters3D['shape'] = null;
  let shapeRid: GodotPhysicsShapeQueryParameters3D['shapeRid'] = null;
  let transform = IDENTITY_TRANSFORM;
  let motion = vec3(0, 0, 0);
  let margin = 0;
  let collisionMask = godotMajor === 3 ? 0x7fff_ffff : 0xffff_ffff;
  let exclude: PhysicsQueryExclude3D[] = [];
  let collideWithBodies = true;
  let collideWithAreas = false;
  const result = {} as GodotPhysicsShapeQueryParameters3D;
  Object.defineProperties(result, {
    shape: { enumerable: true, get: () => shapeRef, set: (value: GodotPhysicsShapeQueryParameters3D['shape']) => {
      if (value === null || (!isColliderSpec(value) && typeof value !== 'object')) {
        throw new TypeError('PhysicsShapeQueryParameters3D.shape must be a non-null Shape3D');
      }
      shapeRef = value;
      shapeRid = value;
    } },
    shapeRid: { enumerable: true, get: () => shapeRid, set: (value: GodotPhysicsShapeQueryParameters3D['shapeRid']) => {
      if (value !== null && !isColliderSpec(value) && typeof value !== 'object') {
        throw new TypeError('PhysicsShapeQueryParameters3D.shape_rid must be a native Shape3D identity');
      }
      if (shapeRid !== value) {
        shapeRef = null;
        shapeRid = value;
      }
    } },
    transform: { enumerable: true, get: () => copyTransform(transform), set: (value: Transform) => {
      transform = copyTransform(value);
    } },
    motion: { enumerable: true, get: () => vec3(motion.x, motion.y, motion.z), set: (value: Vector3Like) => {
      motion = finiteVector(value, 'PhysicsShapeQueryParameters3D.motion');
    } },
    margin: { enumerable: true, get: () => margin, set: (value: number) => {
      if (!Number.isFinite(value)) throw new RangeError('PhysicsShapeQueryParameters3D.margin must be finite');
      margin = value;
    } },
    collisionMask: { enumerable: true, get: () => collisionMask, set: (value: number) => {
      collisionMask = uint32(value, 'PhysicsShapeQueryParameters3D.collision_mask');
    } },
    exclude: { enumerable: true, get: () => [...exclude], set: (value: readonly PhysicsQueryExclude3D[]) => {
      exclude = exclusions(value, 'PhysicsShapeQueryParameters3D.exclude');
    } },
    collideWithBodies: { enumerable: true, get: () => collideWithBodies, set: (value: boolean) => { collideWithBodies = value; } },
    collideWithAreas: { enumerable: true, get: () => collideWithAreas, set: (value: boolean) => { collideWithAreas = value; } },
  });
  registerGodotObjectIdentity(result, godotMajor === 3 ? 'PhysicsShapeQueryParameters' : 'PhysicsShapeQueryParameters3D');
  return result;
}

export function createPhysicsPointQueryParameters3D(): GodotPhysicsPointQueryParameters3D {
  let position = vec3(0, 0, 0);
  let collisionMask = 0xffff_ffff;
  let exclude: PhysicsQueryExclude3D[] = [];
  let collideWithBodies = true;
  let collideWithAreas = false;
  const result = {} as GodotPhysicsPointQueryParameters3D;
  Object.defineProperties(result, {
    position: { enumerable: true, get: () => vec3(position.x, position.y, position.z), set: (value: Vector3Like) => {
      position = finiteVector(value, 'PhysicsPointQueryParameters3D.position');
    } },
    collisionMask: { enumerable: true, get: () => collisionMask, set: (value: number) => {
      collisionMask = uint32(value, 'PhysicsPointQueryParameters3D.collision_mask');
    } },
    exclude: { enumerable: true, get: () => [...exclude], set: (value: readonly PhysicsQueryExclude3D[]) => {
      exclude = exclusions(value, 'PhysicsPointQueryParameters3D.exclude');
    } },
    collideWithBodies: { enumerable: true, get: () => collideWithBodies, set: (value: boolean) => { collideWithBodies = value; } },
    collideWithAreas: { enumerable: true, get: () => collideWithAreas, set: (value: boolean) => { collideWithAreas = value; } },
  });
  registerGodotObjectIdentity(result, 'PhysicsPointQueryParameters3D');
  return result;
}

function queryPose(transform: Transform): { position: ThreeVector3; rotation: Quaternion } {
  const matrix = new Matrix4().makeBasis(
    new ThreeVector3(transform.basis[0].x, transform.basis[0].y, transform.basis[0].z),
    new ThreeVector3(transform.basis[1].x, transform.basis[1].y, transform.basis[1].z),
    new ThreeVector3(transform.basis[2].x, transform.basis[2].y, transform.basis[2].z),
  );
  matrix.setPosition(transform.origin.x, transform.origin.y, transform.origin.z);
  const position = new ThreeVector3();
  const rotation = new Quaternion();
  const scale = new ThreeVector3();
  matrix.decompose(position, rotation, scale);
  if (![scale.x, scale.y, scale.z].every((axis) => Math.abs(axis - 1) <= 1e-6)) {
    throw new Error('PhysicsShapeQueryParameters3D.transform refuses scaled or reflected bases');
  }
  return { position, rotation };
}

function colliderShapeIndex(collider: RAPIER.Collider): number {
  const area = AREA_BY_COLLIDER.get(collider);
  if (area !== undefined) {
    const index = area.shapes.findIndex((group) => group.some((one) => one.handle === collider.handle));
    return index < 0 ? 0 : index;
  }
  const body = collider.parent();
  if (body === null) return 0;
  for (let index = 0; index < body.numColliders(); index += 1) {
    if (body.collider(index).handle === collider.handle) return index;
  }
  return 0;
}

function predicate(
  options: PhysicsQuerySpaceOptions,
  mask: number,
  excluded: readonly PhysicsQueryExclude3D[],
  collideWithBodies: boolean,
  collideWithAreas: boolean,
): (collider: RAPIER.Collider) => boolean {
  return (collider) => {
    if (collider.isSensor() ? !collideWithAreas : !collideWithBodies) return false;
    if (!godotCanCollideWith(options.layers, collider, mask)) return false;
    const area = AREA_BY_COLLIDER.get(collider);
    if (area !== undefined) {
      const rid = RID_BY_AREA.get(area.node);
      if (rid !== undefined && excluded.some((one) => 'id' in one && one.id === rid.id)) return false;
    }
    const body = collider.parent();
    return body === null || !excluded.some((one) => {
      if ('handle' in one) return one.handle === body.handle;
      return godotCarrierOfRid(one) === body;
    });
  };
}

function hit(options: PhysicsQuerySpaceOptions, collider: RAPIER.Collider): GodotShapeQueryHit {
  const area = AREA_BY_COLLIDER.get(collider);
  const resolved = options.resolveCollider(collider);
  const owner = area === undefined ? resolved : area.sceneOwned ? area.node : null;
  const nativeOwner = area === undefined
    ? godotRidOfCarrier(collider.parent() ?? collider)
    : physicsAreaRid3DOf(area.node);
  return queryDictionary<GodotShapeQueryHit>({
    collider: owner,
    collider_id: area === undefined
      ? (typeof owner === 'object' && owner !== null ? godotObjectInstanceId(owner) : 0n)
      : (OBJECT_ID_BY_AREA.get(area.node) ?? (area.sceneOwned ? godotObjectInstanceId(area.node) : 0n)),
    rid: nativeOwner,
    shape: colliderShapeIndex(collider),
  });
}

export function intersectPoint3D(
  world: RAPIER.World,
  parameters: GodotPhysicsPointQueryParameters3D,
  maxResults: number,
  options: PhysicsQuerySpaceOptions,
): GodotShapeQueryHit[] {
  if (!Number.isInteger(maxResults) || maxResults < 0) throw new RangeError('intersect_point max_results must be >= 0');
  if (maxResults === 0) return [];
  const found: GodotShapeQueryHit[] = [];
  world.intersectionsWithPoint(
    parameters.position,
    (collider) => {
      found.push(hit(options, collider));
      return found.length < maxResults;
    },
    undefined, undefined, undefined, undefined,
    predicate(options, parameters.collisionMask, parameters.exclude, parameters.collideWithBodies, parameters.collideWithAreas),
  );
  return found;
}

export function intersectShape3D(
  world: RAPIER.World,
  parameters: GodotPhysicsShapeQueryParameters3D,
  maxResults: number,
  options: PhysicsQuerySpaceOptions,
): GodotShapeQueryHit[] {
  if (!Number.isInteger(maxResults) || maxResults < 0) throw new RangeError('intersect_shape max_results must be >= 0');
  if (maxResults === 0) return [];
  return contacts3D(world, parameters, maxResults, options).map((contact) => hit(options, contact.collider));
}

export function castMotion3D(
  world: RAPIER.World,
  parameters: GodotPhysicsShapeQueryParameters3D,
  options: PhysicsQuerySpaceOptions,
): PackedArrayValue<number> | number[] {
  const pose = queryPose(parameters.transform);
  const shape = nativeShape(parameters.shapeRid, options.godotMajor);
  const margin = nativeMargin(parameters);
  const accepts = predicate(
    options,
    parameters.collisionMask,
    parameters.exclude,
    parameters.collideWithBodies,
    parameters.collideWithAreas,
  );
  // PhysicsDirectSpaceState3D::cast_motion deliberately ignores colliders the shape already
  // intersects before moving. Rapier's stopAtPenetration=true reports those at t=0, so identify
  // and exclude exactly that initial set before asking for the sweep.
  const initial = new Set<number>();
  world.forEachCollider((collider) => {
    if (!accepts(collider)) return;
    const contact = collider.contactShape(shape, pose.position, pose.rotation, margin);
    if (contact !== null && contact.distance <= margin) initial.add(collider.handle);
  });
  const sweepAccepts = (collider: RAPIER.Collider): boolean => accepts(collider) && !initial.has(collider.handle);
  let result: ReturnType<RAPIER.World['castShape']> = null;
  for (;;) {
    result = world.castShape(
      pose.position, pose.rotation, parameters.motion, shape,
      margin, 1, true,
      undefined, undefined, undefined, undefined,
      sweepAccepts,
    );
    if (result === null || result.time_of_impact > 0) break;
    if (initial.has(result.collider.handle)) {
      throw new Error('PhysicsDirectSpaceState3D.cast_motion could not exclude an initial Rapier overlap');
    }
    initial.add(result.collider.handle);
  }
  if (result === null) {
    return options.godotMajor === 4 ? packedFloat32Array([1, 1]) : [1, 1];
  }
  const intersectsAt = (fraction: number): boolean => {
    const position = pose.position.clone().addScaledVector(
      new ThreeVector3(parameters.motion.x, parameters.motion.y, parameters.motion.z),
      fraction,
    );
    let overlaps = false;
    world.forEachCollider((collider) => {
      if (overlaps || !sweepAccepts(collider)) return;
      const contact = collider.contactShape(shape, position, pose.rotation, margin);
      overlaps = contact !== null && contact.distance <= margin;
    });
    return overlaps;
  };
  // Godot's own solver exposes the two ends of an eight-step conservative-advancement bracket.
  // Re-run that exact 4.x source loop against the native Rapier contact predicate instead of
  // collapsing both values onto Rapier's one TOI.
  let safe = 0;
  let unsafe = 1;
  let fractionCoefficient = 0.5;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const fraction = safe + (unsafe - safe) * fractionCoefficient;
    if (intersectsAt(fraction)) {
      unsafe = fraction;
      fractionCoefficient = iteration === 0 || safe > 0 ? 0.5 : 0.25;
    } else {
      safe = fraction;
      fractionCoefficient = iteration === 0 || unsafe < 1 ? 0.5 : 0.75;
    }
  }
  const fractions = [safe, unsafe];
  return options.godotMajor === 4 ? packedFloat32Array(fractions) : fractions;
}

function worldPoint(collider: RAPIER.Collider, local: Vector3Like): ThreeVector3 {
  const p = collider.translation();
  const r = collider.rotation();
  return new ThreeVector3(local.x, local.y, local.z)
    .applyQuaternion(new Quaternion(r.x, r.y, r.z, r.w))
    .add(new ThreeVector3(p.x, p.y, p.z));
}

function queryPoint(pose: ReturnType<typeof queryPose>, local: Vector3Like): ThreeVector3 {
  return new ThreeVector3(local.x, local.y, local.z).applyQuaternion(pose.rotation).add(pose.position);
}

function worldNormal(collider: RAPIER.Collider, local: Vector3Like): ThreeVector3 {
  const rotation = collider.rotation();
  return new ThreeVector3(local.x, local.y, local.z)
    .applyQuaternion(new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w))
    .normalize();
}

function contacts3D(
  world: RAPIER.World,
  parameters: GodotPhysicsShapeQueryParameters3D,
  maxResults: number,
  options: PhysicsQuerySpaceOptions,
): readonly { collider: RAPIER.Collider; point1: ThreeVector3; point2: ThreeVector3; normal: ThreeVector3; distance: number }[] {
  if (!Number.isInteger(maxResults) || maxResults < 0) throw new RangeError('shape query max_results must be >= 0');
  if (maxResults === 0) return [];
  const pose = queryPose(parameters.transform);
  const shape = nativeShape(parameters.shapeRid, options.godotMajor);
  const margin = nativeMargin(parameters);
  const accepts = predicate(options, parameters.collisionMask, parameters.exclude, parameters.collideWithBodies, parameters.collideWithAreas);
  const found: { collider: RAPIER.Collider; point1: ThreeVector3; point2: ThreeVector3; normal: ThreeVector3; distance: number }[] = [];
  world.forEachCollider((collider) => {
    if (found.length >= maxResults || !accepts(collider)) return;
    const contact = collider.contactShape(shape, pose.position, pose.rotation, margin);
    if (contact === null || contact.distance > margin) return;
    const p1 = worldPoint(collider, contact.point1);
    const p2 = queryPoint(pose, contact.point2);
    found.push({
      collider,
      point1: p1,
      point2: p2,
      normal: worldNormal(collider, contact.normal1),
      distance: contact.distance,
    });
  });
  found.sort((a, b) => a.distance - b.distance || a.collider.handle - b.collider.handle);
  return found;
}

export function collideShape3D(
  world: RAPIER.World,
  parameters: GodotPhysicsShapeQueryParameters3D,
  maxResults: number,
  options: PhysicsQuerySpaceOptions,
): Vector3[] {
  return contacts3D(world, parameters, maxResults, options).flatMap((contact) => [
    vec3(contact.point2.x, contact.point2.y, contact.point2.z),
    vec3(contact.point1.x, contact.point1.y, contact.point1.z),
  ]);
}

export function getRestInfo3D(
  world: RAPIER.World,
  parameters: GodotPhysicsShapeQueryParameters3D,
  options: PhysicsQuerySpaceOptions,
): GodotRestResult {
  const contact = contacts3D(world, parameters, Number.MAX_SAFE_INTEGER, options)[0];
  if (contact === undefined) return godotDictionary();
  const body = contact.collider.parent();
  const linear = body?.linvel() ?? { x: 0, y: 0, z: 0 };
  const angular = body?.angvel() ?? { x: 0, y: 0, z: 0 };
  const center = body === null
    ? contact.point1
    : ((body as RAPIER.RigidBody & { worldCom?: () => Vector3Like }).worldCom?.() ?? body.translation());
  const radius = contact.point1.clone().sub(new ThreeVector3(center.x, center.y, center.z));
  const velocity = new ThreeVector3(angular.x, angular.y, angular.z)
    .cross(radius)
    .add(new ThreeVector3(linear.x, linear.y, linear.z));
  const owner = hit(options, contact.collider);
  return queryDictionary<GodotRestInfo>({
    collider_id: owner.collider_id,
    rid: owner.rid,
    shape: owner.shape,
    point: vec3(contact.point1.x, contact.point1.y, contact.point1.z),
    normal: vec3(contact.normal.x, contact.normal.y, contact.normal.z),
    linear_velocity: vec3(velocity.x, velocity.y, velocity.z),
  });
}

/** Install the Godot method spellings over one native Rapier world without wrapping that world. */
export function physicsShapeQueryMethods3D(
  nativeWorld: unknown,
  options: PhysicsQuerySpaceOptions,
): PhysicsShapeQueryMethods3D {
  const world = nativeWorld as RAPIER.World;
  return {
    intersectPoint: (parameters, maxResults = 32) => intersectPoint3D(world, parameters, maxResults, options),
    intersectPointLegacy: (
      position,
      maxResults = 32,
      exclude = [],
      collisionMask = 0x7fff_ffff,
      collideWithBodies = true,
      collideWithAreas = false,
    ) => intersectPoint3D(
      world,
      {
        position: finiteVector(position, 'PhysicsDirectSpaceState.intersect_point position'),
        collisionMask: uint32(collisionMask, 'PhysicsDirectSpaceState.intersect_point collision_mask'),
        exclude: exclusions(exclude, 'PhysicsDirectSpaceState.intersect_point exclude'),
        collideWithBodies,
        collideWithAreas,
      },
      maxResults,
      options,
    ),
    intersectShape: (parameters, maxResults = 32) => intersectShape3D(world, parameters, maxResults, options),
    castMotion: (parameters) => castMotion3D(world, parameters, options),
    collideShape: (parameters, maxResults = 32) => collideShape3D(world, parameters, maxResults, options),
    getRestInfo: (parameters) => getRestInfo3D(world, parameters, options),
  };
}
