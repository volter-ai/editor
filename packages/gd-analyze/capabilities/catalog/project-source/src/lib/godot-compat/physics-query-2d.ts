/** Godot 3.6/4.x direct 2D physics queries over the project's native Rapier world. */
import RAPIER from '@dimforge/rapier2d-compat';
import { Container } from 'pixi.js';
import { godotCanCollideWith, type CollisionLayers } from './collision-layers';
import { godotGlobalCall, type GodotRid } from './gdscript-builtins';
import { godotObjectInstanceId, registerGodotObjectIdentity } from './object';
import { packedVector2Array, type PackedVector2Array } from './packed-array';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import { TRANSFORM2D_IDENTITY, type GodotTransform2D } from './transform-2d';
import { vec2, type Vector2 } from './vector2';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';

export interface PhysicsBodyHandle2D { readonly handle: number }
export type PhysicsQueryExclude2D = PhysicsBodyHandle2D | GodotRid;
export interface PhysicsArea2DRegistration {
  readonly node: object;
  readonly sceneOwned: boolean;
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly shapes: RAPIER.Collider[][];
}

export interface PhysicsShapeQueryParameters2D {
  shape: GodotShape2D | null;
  transform: GodotTransform2D;
  motion: Vector2;
  margin: number;
  collisionMask: number;
  exclude: readonly PhysicsQueryExclude2D[];
  collideWithBodies: boolean;
  collideWithAreas: boolean;
}

export interface PhysicsPointQueryParameters2D {
  position: Vector2;
  canvasInstanceId: number;
  collisionMask: number;
  exclude: readonly PhysicsQueryExclude2D[];
  collideWithBodies: boolean;
  collideWithAreas: boolean;
}

export interface PhysicsRayQueryParameters2D {
  from: Vector2;
  to: Vector2;
  collisionMask: number;
  exclude: readonly PhysicsQueryExclude2D[];
  collideWithBodies: boolean;
  collideWithAreas: boolean;
  hitFromInside: boolean;
}

export interface PhysicsQueryHit2D {
  readonly collider: unknown;
  readonly collider_id: bigint;
  readonly rid: GodotRid;
  readonly shape: number;
}

export interface PhysicsRestInfo2D extends PhysicsQueryHit2D {
  readonly point: Vector2;
  readonly normal: Vector2;
  readonly linear_velocity: Vector2;
}

export interface PhysicsRayResult2D extends PhysicsQueryHit2D {
  readonly position: Vector2;
  readonly normal: Vector2;
}

export interface PhysicsDirectSpaceState2D {
  intersectPoint(parameters: PhysicsPointQueryParameters2D, maxResults?: number): PhysicsQueryHit2D[];
  intersectPoint3(
    point: Readonly<Vector2>,
    maxResults?: number,
    exclude?: readonly PhysicsQueryExclude2D[],
    collisionMask?: number,
    collideWithBodies?: boolean,
    collideWithAreas?: boolean,
  ): PhysicsQueryHit2D[];
  intersectShape(parameters: PhysicsShapeQueryParameters2D, maxResults?: number): PhysicsQueryHit2D[];
  intersectRay(parameters: PhysicsRayQueryParameters2D): PhysicsRayResult2D | Readonly<Record<string, never>>;
  intersectRay3(
    from: Readonly<Vector2>,
    to: Readonly<Vector2>,
    exclude?: readonly PhysicsQueryExclude2D[],
    collisionMask?: number,
    collideWithBodies?: boolean,
    collideWithAreas?: boolean,
  ): PhysicsRayResult2D | Readonly<Record<string, never>>;
  castMotion(parameters: PhysicsShapeQueryParameters2D): readonly [number, number];
  collideShape(parameters: PhysicsShapeQueryParameters2D, maxResults?: number): Vector2[];
  getRestInfo(parameters: PhysicsShapeQueryParameters2D): PhysicsRestInfo2D | Readonly<Record<string, never>>;
}

export interface PhysicsDirectSpaceState2DOptions {
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
}

const ALL_LAYERS = 0xffff_ffff;
const BODY_BY_NODE = new WeakMap<object, PhysicsBodyHandle2D>();
const NODE_BY_BODY = new WeakMap<object, object>();
const RID_BY_BODY = new WeakMap<object, GodotRid>();
const BODY_BY_RID = new Map<bigint, WeakRef<object>>();
const RID_BY_WORLD = new WeakMap<object, GodotRid>();
const WORLD_BY_RID = new Map<bigint, WeakRef<object>>();
const AREA_BY_NODE = new WeakMap<object, PhysicsArea2DRegistration>();
const AREA_BY_COLLIDER = new WeakMap<object, PhysicsArea2DRegistration>();
const RID_BY_AREA = new WeakMap<object, GodotRid>();
const AREA_BY_RID = new Map<bigint, object>();
const OBJECT_ID_BY_AREA = new WeakMap<object, bigint>();

function allocatePhysicsRid2D(): GodotRid {
  const id = godotGlobalCall<number>('rid_allocate_id', []);
  return godotGlobalCall('rid_from_int64', [id]);
}

export function registerPhysicsArea2D(registration: PhysicsArea2DRegistration): GodotRid {
  if (AREA_BY_NODE.has(registration.node)) throw new Error('PhysicsServer2D Area RID registry received an already-registered retained Area2D node');
  if (registration.world.getRigidBody(registration.body.handle) !== registration.body) throw new Error('PhysicsServer2D Area body belongs to a different native Rapier world');
  const registeredSensors = new Set<number>();
  for (const shape of registration.shapes) {
    for (const collider of shape) {
      if (registration.world.getCollider(collider.handle) !== collider || !collider.isSensor()) throw new Error('PhysicsServer2D Area shapes must be live native Rapier sensors in the registered world');
      if (collider.parent() !== registration.body) throw new Error('PhysicsServer2D Area sensor is attached to a body not exclusively owned by the registered Area2D');
      if (AREA_BY_COLLIDER.has(collider)) throw new Error('PhysicsServer2D Area sensor is already owned by another registered Area RID');
      if (registeredSensors.has(collider.handle)) throw new Error('PhysicsServer2D Area sensor cannot occupy more than one authored shape group');
      registeredSensors.add(collider.handle);
    }
  }
  const rid = allocatePhysicsRid2D();
  for (const shape of registration.shapes) for (const collider of shape) AREA_BY_COLLIDER.set(collider, registration);
  AREA_BY_NODE.set(registration.node, registration);
  RID_BY_AREA.set(registration.node, rid);
  AREA_BY_RID.set(rid.id, registration.node);
  return rid;
}

export function unregisterPhysicsArea2D(node: object): void {
  const registration = AREA_BY_NODE.get(node);
  if (registration === undefined) return;
  for (const shape of registration.shapes) for (const collider of shape) AREA_BY_COLLIDER.delete(collider);
  const rid = RID_BY_AREA.get(node);
  if (rid !== undefined && AREA_BY_RID.get(rid.id) === node) AREA_BY_RID.delete(rid.id);
  RID_BY_AREA.delete(node);
  OBJECT_ID_BY_AREA.delete(node);
  AREA_BY_NODE.delete(node);
}

export function setPhysicsAreaObjectInstanceId2D(node: object, id: bigint): void {
  if (!AREA_BY_NODE.has(node)) throw new Error('PhysicsServer2D Area object instance ID requires a live registered Area RID');
  OBJECT_ID_BY_AREA.set(node, id);
}

export function replacePhysicsArea2DShapes(node: object, shapes: RAPIER.Collider[][]): void {
  const registration = AREA_BY_NODE.get(node);
  if (registration === undefined) throw new Error('PhysicsServer2D Area shape mutation requires a live registered Area RID');
  const registeredSensors = new Set<number>();
  for (const group of shapes) for (const collider of group) {
    if (registration.world.getCollider(collider.handle) !== collider || !collider.isSensor() || collider.parent() !== registration.body) {
      throw new Error('PhysicsServer2D Area shape mutation received a sensor not owned by the registered Area body');
    }
    const owner = AREA_BY_COLLIDER.get(collider);
    if (owner !== undefined && owner !== registration) throw new Error('PhysicsServer2D Area shape mutation received a sensor owned by another Area RID');
    if (registeredSensors.has(collider.handle)) throw new Error('PhysicsServer2D Area sensor cannot occupy more than one shape group');
    registeredSensors.add(collider.handle);
  }
  for (const group of registration.shapes) for (const collider of group) AREA_BY_COLLIDER.delete(collider);
  registration.shapes.splice(0, registration.shapes.length, ...shapes);
  for (const group of registration.shapes) for (const collider of group) AREA_BY_COLLIDER.set(collider, registration);
}

export function physicsArea2DOfRid(rid: GodotRid): PhysicsArea2DRegistration {
  if (typeof rid !== 'object' || rid === null || typeof rid.id !== 'bigint') throw new Error('PhysicsServer2D Area RID must be an actual Godot RID value');
  const node = AREA_BY_RID.get(rid.id);
  const registration = node === undefined ? undefined : AREA_BY_NODE.get(node);
  if (registration === undefined) {
    AREA_BY_RID.delete(rid.id);
    throw new Error('PhysicsServer2D Area RID does not name a live registered native Area2D');
  }
  return registration;
}

export function physicsAreaRid2DOf(node: object): GodotRid {
  const rid = RID_BY_AREA.get(node);
  if (rid === undefined) throw new Error('Area2D has no live registered native Area RID');
  return rid;
}

export function physicsCollisionObjectBody2DOfRid(rid: GodotRid): RAPIER.RigidBody {
  if (typeof rid !== 'object' || rid === null || typeof rid.id !== 'bigint') throw new Error('PhysicsServer2D collision-object RID must be an actual Godot RID value');
  const areaNode = AREA_BY_RID.get(rid.id);
  const area = areaNode === undefined ? undefined : AREA_BY_NODE.get(areaNode);
  return area?.body ?? physicsBody2DOfRid(rid);
}

export function physicsRid2DOfNode(node: object): GodotRid {
  const area = RID_BY_AREA.get(node);
  if (area !== undefined) return area;
  return physicsRid2DOfBody(shapeCastBody2DOf(node));
}

export function physicsSpaceRid2D(world: RAPIER.World): GodotRid {
  let rid = RID_BY_WORLD.get(world);
  if (rid === undefined) {
    rid = allocatePhysicsRid2D();
    RID_BY_WORLD.set(world, rid);
    WORLD_BY_RID.set(rid.id, new WeakRef(world));
  }
  return rid;
}

export function physicsWorld2DOfRid(rid: GodotRid): RAPIER.World {
  if (typeof rid !== 'object' || rid === null || typeof rid.id !== 'bigint') {
    throw new Error('PhysicsServer2D space must be an actual Godot RID value');
  }
  const world = WORLD_BY_RID.get(rid.id)?.deref();
  if (world === undefined) {
    WORLD_BY_RID.delete(rid.id);
    throw new Error('PhysicsServer2D space RID does not name a live registered native Rapier world');
  }
  return world as RAPIER.World;
}

export function registerShapeCastBody2D(node: object, body: PhysicsBodyHandle2D): void {
  const existing = BODY_BY_NODE.get(node);
  if (existing !== undefined && existing.handle !== body.handle) {
    throw new Error('PhysicsBody2D identity registry received two native bodies for one retained node');
  }
  BODY_BY_NODE.set(node, body);
  NODE_BY_BODY.set(body, node);
  if (!RID_BY_BODY.has(body)) {
    const rid = allocatePhysicsRid2D();
    RID_BY_BODY.set(body, rid);
    BODY_BY_RID.set(rid.id, new WeakRef(body));
  }
}

export function unregisterShapeCastBody2D(node: object, body: PhysicsBodyHandle2D): void {
  if (BODY_BY_NODE.get(node)?.handle === body.handle) BODY_BY_NODE.delete(node);
  if (NODE_BY_BODY.get(body) === node) NODE_BY_BODY.delete(body);
  const rid = RID_BY_BODY.get(body);
  if (rid !== undefined && BODY_BY_RID.get(rid.id)?.deref() === body) BODY_BY_RID.delete(rid.id);
  RID_BY_BODY.delete(body);
}

export function shapeCastBody2DOf(value: unknown): PhysicsBodyHandle2D {
  if (typeof value === 'object' && value !== null) {
    const registered = BODY_BY_NODE.get(value);
    if (registered !== undefined) return registered;
    if ('handle' in value && typeof value.handle === 'number') return value as PhysicsBodyHandle2D;
    if ('body' in value) {
      const body = (value as { readonly body?: unknown }).body;
      if (typeof body === 'object' && body !== null && 'handle' in body && typeof body.handle === 'number') {
        return body as PhysicsBodyHandle2D;
      }
    }
  }
  throw new Error('PhysicsBody2D identity requires a retained Godot node or native Rapier body');
}

function collisionObjectBody2D(value: unknown): RAPIER.RigidBody {
  return shapeCastBody2DOf(value) as RAPIER.RigidBody;
}

/** Live CollisionObject2D layer ownership is the retained Rapier body's native colliders. */
export function getCollisionObjectLayer2D(value: unknown, layers: CollisionLayers): number {
  const body = collisionObjectBody2D(value);
  return body.numColliders() === 0 ? 1 : layers.layerOf(body.collider(0));
}

export function setCollisionObjectLayer2D(
  value: unknown,
  layers: CollisionLayers,
  layer: number,
): void {
  const body = collisionObjectBody2D(value);
  const next = uint32(layer, 'CollisionObject2D.collision_layer');
  for (let index = 0; index < body.numColliders(); index += 1) {
    layers.setLayer(body.collider(index), next);
  }
}

/** Live CollisionObject2D mask ownership across every native shape on one retained body. */
export function getCollisionObjectMask2D(value: unknown, layers: CollisionLayers): number {
  const body = collisionObjectBody2D(value);
  if (body.numColliders() === 0) {
    throw new Error('CollisionObject2D.collision_mask read requires a live retained Rapier collider binding.');
  }
  return layers.maskOf(body.collider(0));
}

export function setCollisionObjectMask2D(
  value: unknown,
  layers: CollisionLayers,
  mask: number,
): void {
  const body = collisionObjectBody2D(value);
  const next = uint32(mask, 'CollisionObject2D.collision_mask');
  const count = body.numColliders();
  if (count === 0) {
    throw new Error('CollisionObject2D.collision_mask write requires a live retained Rapier collider binding.');
  }
  for (let index = 0; index < count; index += 1) {
    layers.setMask(body.collider(index), next);
  }
}

function collisionBit(bit: number, oneBased: boolean, member: string): number {
  const minimum = oneBased ? 1 : 0;
  const maximum = oneBased ? 32 : 31;
  if (!Number.isSafeInteger(bit) || bit < minimum || bit > maximum) {
    throw new RangeError(`${member} requires a layer number in ${minimum}..${maximum}.`);
  }
  return oneBased ? bit - 1 : bit;
}

export function getCollisionObjectLayerValue2D(
  value: unknown,
  layers: CollisionLayers,
  layerNumber: number,
): boolean {
  const bit = collisionBit(layerNumber, true, 'CollisionObject2D.get_collision_layer_value');
  return (getCollisionObjectLayer2D(value, layers) & (1 << bit)) !== 0;
}

export function setCollisionObjectLayerValue2D(
  value: unknown,
  layers: CollisionLayers,
  layerNumber: number,
  enabled: boolean,
): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject2D.set_collision_layer_value enabled must be bool.');
  const bit = collisionBit(layerNumber, true, 'CollisionObject2D.set_collision_layer_value');
  const current = getCollisionObjectLayer2D(value, layers);
  setCollisionObjectLayer2D(value, layers, enabled ? current | (1 << bit) : current & ~(1 << bit));
}

export function getCollisionObjectMaskValue2D(
  value: unknown,
  layers: CollisionLayers,
  layerNumber: number,
): boolean {
  const bit = collisionBit(layerNumber, true, 'CollisionObject2D.get_collision_mask_value');
  return (getCollisionObjectMask2D(value, layers) & (1 << bit)) !== 0;
}

export function setCollisionObjectMaskValue2D(
  value: unknown,
  layers: CollisionLayers,
  layerNumber: number,
  enabled: boolean,
): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject2D.set_collision_mask_value enabled must be bool.');
  const bit = collisionBit(layerNumber, true, 'CollisionObject2D.set_collision_mask_value');
  const current = getCollisionObjectMask2D(value, layers);
  setCollisionObjectMask2D(value, layers, enabled ? current | (1 << bit) : current & ~(1 << bit));
}

export function getCollisionObjectLayerBit2D(
  value: unknown,
  layers: CollisionLayers,
  bitNumber: number,
): boolean {
  const bit = collisionBit(bitNumber, false, 'CollisionObject2D.get_collision_layer_bit');
  return (getCollisionObjectLayer2D(value, layers) & (1 << bit)) !== 0;
}

export function setCollisionObjectLayerBit2D(
  value: unknown,
  layers: CollisionLayers,
  bitNumber: number,
  enabled: boolean,
): void {
  const bit = collisionBit(bitNumber, false, 'CollisionObject2D.set_collision_layer_bit');
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject2D.set_collision_layer_bit enabled must be bool.');
  const current = getCollisionObjectLayer2D(value, layers);
  setCollisionObjectLayer2D(value, layers, enabled ? current | (1 << bit) : current & ~(1 << bit));
}

export function getCollisionObjectMaskBit2D(
  value: unknown,
  layers: CollisionLayers,
  bitNumber: number,
): boolean {
  const bit = collisionBit(bitNumber, false, 'CollisionObject2D.get_collision_mask_bit');
  return (getCollisionObjectMask2D(value, layers) & (1 << bit)) !== 0;
}

export function setCollisionObjectMaskBit2D(
  value: unknown,
  layers: CollisionLayers,
  bitNumber: number,
  enabled: boolean,
): void {
  const bit = collisionBit(bitNumber, false, 'CollisionObject2D.set_collision_mask_bit');
  if (typeof enabled !== 'boolean') throw new TypeError('CollisionObject2D.set_collision_mask_bit enabled must be bool.');
  const current = getCollisionObjectMask2D(value, layers);
  setCollisionObjectMask2D(value, layers, enabled ? current | (1 << bit) : current & ~(1 << bit));
}

export function getCollisionObjectRid2D(value: unknown): GodotRid {
  return physicsRid2DOfBody(collisionObjectBody2D(value));
}

export function physicsBody2DOfRid(rid: GodotRid): RAPIER.RigidBody {
  if (typeof rid !== 'object' || rid === null || typeof rid.id !== 'bigint') {
    throw new Error('PhysicsBody2D RID must be an actual Godot RID value');
  }
  const body = BODY_BY_RID.get(rid.id)?.deref();
  if (body === undefined || !('handle' in body) || typeof body.handle !== 'number') {
    BODY_BY_RID.delete(rid.id);
    throw new Error('PhysicsBody2D RID does not name a live registered native body');
  }
  return body as RAPIER.RigidBody;
}

export function physicsRid2DOf(collider: RAPIER.Collider): GodotRid {
  const area = AREA_BY_COLLIDER.get(collider);
  if (area !== undefined) return physicsAreaRid2DOf(area.node);
  const body = collider.parent();
  if (body === null) throw new Error('2D query hit a collider without a registered PhysicsBody2D RID owner');
  const rid = RID_BY_BODY.get(body);
  if (rid === undefined) throw new Error('2D query hit a PhysicsBody2D absent from the native RID registry');
  return rid;
}

export function physicsRid2DOfBody(body: PhysicsBodyHandle2D | GodotRid): GodotRid {
  if (!('handle' in body)) return body;
  const rid = RID_BY_BODY.get(body);
  if (rid === undefined) throw new Error('PhysicsBody2D is absent from the native RID registry');
  return rid;
}

export function physicsObject2DOfBodyRid(rid: GodotRid): object {
  const body = physicsBody2DOfRid(rid);
  const node = NODE_BY_BODY.get(body);
  if (node === undefined) throw new Error('PhysicsBody2D RID has no live registered retained Godot node');
  return node;
}

function finiteVector(value: Readonly<Vector2>, name: string): Vector2 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(`${name} must contain finite coordinates`);
  }
  return vec2(value.x, value.y);
}

function uint32(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${name} must be an unsigned 32-bit integer`);
  }
  return value;
}

function resultLimit(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error('max_results must be a non-negative integer');
  return value;
}

function rigidPose(transform: GodotTransform2D): { position: Vector2; rotation: number } {
  const xLength = Math.hypot(transform.x.x, transform.x.y);
  const yLength = Math.hypot(transform.y.x, transform.y.y);
  const dot = transform.x.x * transform.y.x + transform.x.y * transform.y.y;
  const determinant = transform.x.x * transform.y.y - transform.x.y * transform.y.x;
  if (
    Math.abs(xLength - 1) > 1e-6 ||
    Math.abs(yLength - 1) > 1e-6 ||
    Math.abs(dot) > 1e-6 ||
    Math.abs(determinant - 1) > 1e-6
  ) {
    throw new Error('PhysicsShapeQueryParameters2D.transform must be rigid; Rapier shapes are unscaled');
  }
  return {
    position: finiteVector(transform.origin, 'PhysicsShapeQueryParameters2D.transform.origin'),
    rotation: Math.atan2(transform.x.y, transform.x.x),
  };
}

function shapeIndex(collider: RAPIER.Collider): number {
  const body = collider.parent();
  if (body === null) return 0;
  for (let index = 0; index < body.numColliders(); index += 1) {
    if (body.collider(index).handle === collider.handle) return index;
  }
  throw new Error('Rapier collider is absent from its parent body collider registry');
}

function bodyVelocityAt(collider: RAPIER.Collider, point: Readonly<Vector2>): Vector2 {
  const body = collider.parent();
  if (body === null) return vec2(0, 0);
  const velocity = body.linvel();
  const center = body.translation();
  const angular = body.angvel();
  const radiusX = point.x - center.x;
  const radiusY = point.y - center.y;
  return vec2(velocity.x - angular * radiusY, velocity.y + angular * radiusX);
}

export function physicsVelocityAtPoint2D(collider: RAPIER.Collider, point: Readonly<Vector2>): Vector2 {
  return bodyVelocityAt(collider, point);
}

function frozenHit(collider: RAPIER.Collider, resolve: (value: RAPIER.Collider) => unknown): PhysicsQueryHit2D {
  const area = AREA_BY_COLLIDER.get(collider);
  const areaShape = area?.shapes.findIndex((group) => group.some((one) => one.handle === collider.handle));
  if (area !== undefined && areaShape === -1) throw new Error('2D query hit an Area sensor absent from its registered authored shape group');
  if (area !== undefined) {
    return Object.freeze({
      collider: area.sceneOwned ? area.node : null,
      collider_id: OBJECT_ID_BY_AREA.get(area.node) ?? (area.sceneOwned ? godotObjectInstanceId(area.node) : 0n),
      rid: physicsAreaRid2DOf(area.node),
      shape: areaShape ?? -1,
    });
  }
  const colliderObject = resolve(collider);
  if ((typeof colliderObject !== 'object' || colliderObject === null) && typeof colliderObject !== 'function') {
    throw new Error('2D query collider resolver returned no registered Godot Object');
  }
  return Object.freeze({
    collider: colliderObject,
    collider_id: godotObjectInstanceId(colliderObject),
    rid: physicsRid2DOf(collider),
    shape: areaShape ?? shapeIndex(collider),
  });
}

function queryFilter(
  layers: CollisionLayers,
  parameters: Pick<PhysicsShapeQueryParameters2D, 'collisionMask' | 'exclude' | 'collideWithAreas' | 'collideWithBodies'>,
): (collider: RAPIER.Collider) => boolean {
  const excluded = new Set(parameters.exclude.map((one) =>
    'handle' in one ? one.handle : physicsCollisionObjectBody2DOfRid(one).handle));
  return (collider) => {
    if (collider.isSensor() ? !parameters.collideWithAreas : !parameters.collideWithBodies) return false;
    if (!godotCanCollideWith(layers, collider, parameters.collisionMask)) return false;
    const body = collider.parent();
    return body === null || !excluded.has(body.handle);
  };
}

function requireShape(parameters: PhysicsShapeQueryParameters2D): RAPIER.Shape {
  if (parameters.shape === null) throw new Error('PhysicsShapeQueryParameters2D.shape is required');
  return rapierShape2D(parameters.shape);
}

export interface GodotCircleShape2D { readonly kind: 'circle'; radius: number }
export interface GodotRectangleShape2D { readonly kind: 'rectangle'; size: Vector2; extents: Vector2 }
export interface GodotWorldBoundaryShape2D {
  readonly kind: 'world-boundary';
  normal: Vector2;
  distance: number;
  get_normal(): Vector2;
  set_normal(value: Readonly<Vector2>): void;
  get_distance(): number;
  set_distance(value: number): void;
}
export interface GodotLineShape2D {
  readonly kind: 'world-boundary';
  normal: Vector2;
  d: number;
  /** Canonical internal half-plane offset shared with the Godot 4 carrier. */
  readonly distance: number;
  get_normal(): Vector2;
  set_normal(value: Readonly<Vector2>): void;
  get_d(): number;
  set_d(value: number): void;
}
export interface GodotSegmentShape2D {
  readonly kind: 'segment';
  a: Vector2;
  b: Vector2;
}
export interface GodotRayShape2D {
  readonly kind: 'ray';
  length: number;
  slips_on_slope: boolean;
  get_length(): number;
  set_length(value: number): void;
  get_slips_on_slope(): boolean;
  set_slips_on_slope(value: boolean): void;
}
export interface GodotConvexPolygonShape2D {
  readonly kind: 'convex-polygon';
  points: PackedVector2Array;
  set_points(points: PackedVector2Array): void;
}
export interface GodotConcavePolygonShape2D {
  readonly kind: 'concave-polygon';
  segments: PackedVector2Array;
}
export type GodotShape2D =
  | GodotCircleShape2D
  | GodotRectangleShape2D
  | GodotWorldBoundaryShape2D
  | GodotLineShape2D
  | GodotRayShape2D
  | GodotCapsuleShape2D
  | GodotSegmentShape2D
  | GodotConvexPolygonShape2D
  | GodotConcavePolygonShape2D;

const GODOT_SHAPES_2D = new WeakSet<object>();

export function isGodotShape2D(value: unknown): value is GodotShape2D {
  return typeof value === 'object' && value !== null && GODOT_SHAPES_2D.has(value);
}

function retainGodotShape2D<T extends GodotShape2D>(value: T): T {
  GODOT_SHAPES_2D.add(value);
  return value;
}
export interface PhysicsShapeResource2DConsumer {
  setShape(shape: RAPIER.Shape): void;
  /** A collider consumer needs the authored Resource too because a half-plane owns an offset. */
  setShapeResource?(shape: GodotShape2D): void;
}

export type GodotRuntimeCollisionShape2D = Container & PhysicsShapeResource2DConsumer & {
  nativeShape: RAPIER.Shape;
  nativeTranslation: Vector2;
  shape: GodotShape2D;
  set_shape(shape: GodotShape2D): void;
  get_shape(): GodotShape2D;
};

export function createGodotCollisionShape2D(): GodotRuntimeCollisionShape2D {
  const node = bindGodotCanvasNode2DApi(new Container()) as unknown as GodotRuntimeCollisionShape2D;
  node.nativeShape = new RAPIER.Cuboid(10, 10);
  node.nativeTranslation = vec2(0, 0);
  node.setShape = (shape) => { node.nativeShape = shape; };
  node.setShapeResource = (shape) => {
    node.nativeShape = nativeRapierShape2D(shape);
    node.nativeTranslation = localShapeOffset2D(shape);
  };
  registerGodotObjectIdentity(node, 'CollisionShape2D');
  bindCollisionShape2DResource(node, createRectangleShape2D());
  Object.defineProperty(node, 'shape', {
    configurable: true,
    enumerable: true,
    get: () => getCollisionShape2DShape(node),
    set: (value: GodotShape2D) => setCollisionShape2DShape(node, value),
  });
  Object.assign(node, {
    set_shape: (value: GodotShape2D): void => setCollisionShape2DShape(node, value),
    get_shape: (): GodotShape2D => getCollisionShape2DShape(node),
  });
  registerCanvasNodeRelease(node, () => releaseCollisionShape2DResource(node));
  return node;
}
const RETAINED_SHAPE_CONSUMERS = new WeakMap<object, Set<PhysicsShapeResource2DConsumer>>();
const COLLISION_SHAPE_RESOURCES = new WeakMap<object, GodotShape2D>();
const COLLISION_SHAPE_NATIVE_CONSUMERS = new WeakMap<object, PhysicsShapeResource2DConsumer>();

function shapeResourceChanged(shape: GodotShape2D): void {
  for (const consumer of RETAINED_SHAPE_CONSUMERS.get(shape) ?? []) {
    if (consumer.setShapeResource !== undefined) consumer.setShapeResource(shape);
    else consumer.setShape(rapierShape2D(shape));
  }
  godotResourceEmitChanged(shape);
}

export function retainPhysicsShapeResource2D(
  shape: GodotShape2D,
  consumer: PhysicsShapeResource2DConsumer,
): void {
  let consumers = RETAINED_SHAPE_CONSUMERS.get(shape);
  if (consumers === undefined) {
    consumers = new Set();
    RETAINED_SHAPE_CONSUMERS.set(shape, consumers);
  }
  if (consumers.has(consumer)) throw new Error('Shape2D native consumer registry received the same collider twice');
  consumers.add(consumer);
}

export function releasePhysicsShapeResource2D(
  shape: GodotShape2D,
  consumer: PhysicsShapeResource2DConsumer,
): void {
  const consumers = RETAINED_SHAPE_CONSUMERS.get(shape);
  if (consumers === undefined || !consumers.delete(consumer)) {
    throw new Error('Shape2D native consumer registry underflow');
  }
  if (consumers.size === 0) RETAINED_SHAPE_CONSUMERS.delete(shape);
}

export function bindCollisionShape2DResource(
  collider: PhysicsShapeResource2DConsumer,
  shape: GodotShape2D,
  placement?: Readonly<{ translation: Readonly<Vector2>; rotation: number }>,
): void {
  if (COLLISION_SHAPE_RESOURCES.has(collider)) {
    throw new Error('CollisionShape2D native collider already has a retained shape Resource.');
  }
  const consumer = placement === undefined
    ? collider
    : createRapierColliderShape2DConsumer(collider as RAPIER.Collider, placement.translation, placement.rotation);
  COLLISION_SHAPE_RESOURCES.set(collider, shape);
  COLLISION_SHAPE_NATIVE_CONSUMERS.set(collider, consumer);
  retainPhysicsShapeResource2D(shape, consumer);
}

export function getCollisionShape2DShape(collider: object): GodotShape2D {
  const shape = COLLISION_SHAPE_RESOURCES.get(collider);
  if (shape === undefined) throw new Error('CollisionShape2D.shape was read before its native collider binding.');
  return shape;
}

export function setCollisionShape2DShape(
  collider: PhysicsShapeResource2DConsumer,
  shape: GodotShape2D,
): void {
  if (!isGodotShape2D(shape)) throw new TypeError('CollisionShape2D.shape requires a Shape2D Resource.');
  const previous = getCollisionShape2DShape(collider);
  if (previous === shape) return;
  const consumer = COLLISION_SHAPE_NATIVE_CONSUMERS.get(collider) ?? collider;
  releasePhysicsShapeResource2D(previous, consumer);
  COLLISION_SHAPE_RESOURCES.set(collider, shape);
  retainPhysicsShapeResource2D(shape, consumer);
  if (consumer.setShapeResource !== undefined) consumer.setShapeResource(shape);
  else consumer.setShape(rapierShape2D(shape));
}

export function releaseCollisionShape2DResource(collider: PhysicsShapeResource2DConsumer): void {
  const shape = COLLISION_SHAPE_RESOURCES.get(collider);
  if (shape === undefined) return;
  releasePhysicsShapeResource2D(shape, COLLISION_SHAPE_NATIVE_CONSUMERS.get(collider) ?? collider);
  COLLISION_SHAPE_NATIVE_CONSUMERS.delete(collider);
  COLLISION_SHAPE_RESOURCES.delete(collider);
}

export interface GodotCapsuleShape2D {
  readonly kind: 'capsule';
  readonly godotMajor: 3 | 4;
  radius: number;
  /** Source-visible height: mid-section in Godot 3, total capsule height in Godot 4. */
  height: number;
  /** Rapier's segment length before halving for its `Capsule` constructor. */
  readonly midHeight: number;
}

export function createPhysicsShapeQueryParameters2D(godotMajor: 3 | 4 = 4): PhysicsShapeQueryParameters2D {
  return {
    shape: null,
    transform: {
      x: { ...TRANSFORM2D_IDENTITY.x },
      y: { ...TRANSFORM2D_IDENTITY.y },
      origin: { ...TRANSFORM2D_IDENTITY.origin },
    },
    motion: vec2(0, 0),
    margin: 0,
    collisionMask: godotMajor === 3 ? 0x7fff_ffff : ALL_LAYERS,
    exclude: [],
    collideWithBodies: true,
    collideWithAreas: false,
  };
}

export function createPhysicsPointQueryParameters2D(): PhysicsPointQueryParameters2D {
  return {
    position: vec2(0, 0),
    canvasInstanceId: 0,
    collisionMask: ALL_LAYERS,
    exclude: [],
    collideWithBodies: true,
    collideWithAreas: false,
  };
}

export function createPhysicsRayQueryParameters2D(): PhysicsRayQueryParameters2D {
  let from = vec2(0, 0);
  let to = vec2(0, 0);
  let collisionMask = ALL_LAYERS;
  let exclude: readonly PhysicsQueryExclude2D[] = [];
  const parameters = {
    collideWithBodies: true,
    collideWithAreas: false,
    hitFromInside: false,
  } as PhysicsRayQueryParameters2D;
  Object.defineProperties(parameters, {
    from: {
      enumerable: true,
      get: () => vec2(from.x, from.y),
      set: (value: Vector2) => { from = finiteVector(value, 'PhysicsRayQueryParameters2D.from'); },
    },
    to: {
      enumerable: true,
      get: () => vec2(to.x, to.y),
      set: (value: Vector2) => { to = finiteVector(value, 'PhysicsRayQueryParameters2D.to'); },
    },
    collisionMask: {
      enumerable: true,
      get: () => collisionMask,
      set: (value: number) => { collisionMask = uint32(value, 'PhysicsRayQueryParameters2D.collision_mask'); },
    },
    exclude: {
      enumerable: true,
      get: () => [...exclude],
      set: (value: readonly PhysicsQueryExclude2D[]) => {
        if (!Array.isArray(value)) throw new TypeError('PhysicsRayQueryParameters2D.exclude must be an Array of RIDs.');
        exclude = [...value];
      },
    },
  });
  return parameters;
}

/** Shape resources stay plain native values; scripts may assign them directly to query.shape. */
export function createCircleShape2D(radius = 10): GodotCircleShape2D {
  if (!Number.isFinite(radius) || radius < 0) throw new Error('CircleShape2D.radius must be >= 0');
  let liveRadius = radius;
  const value = { kind: 'circle' } as GodotCircleShape2D;
  Object.defineProperty(value, 'radius', {
    enumerable: true,
    get: () => liveRadius,
    set: (next: number) => {
      if (!Number.isFinite(next) || next < 0) throw new Error('CircleShape2D.radius must be >= 0');
      liveRadius = next;
      shapeResourceChanged(value);
    },
  });
  registerGodotObjectIdentity(value, 'CircleShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createCircleShape2D(source.radius); },
  }));
}

export function createRectangleShape2D(size: Readonly<Vector2> = vec2(20, 20)): GodotRectangleShape2D {
  let liveSize = finiteVector(size, 'RectangleShape2D.size');
  if (liveSize.x < 0 || liveSize.y < 0) throw new Error('RectangleShape2D.size must be non-negative');
  const value = { kind: 'rectangle' } as GodotRectangleShape2D;
  Object.defineProperty(value, 'size', {
    enumerable: true,
    get: () => vec2(liveSize.x, liveSize.y),
    set: (next: Vector2) => {
      const finite = finiteVector(next, 'RectangleShape2D.size');
      if (finite.x < 0 || finite.y < 0) throw new Error('RectangleShape2D.size must be non-negative');
      liveSize = finite;
      shapeResourceChanged(value);
    },
  });
  Object.defineProperty(value, 'extents', {
    enumerable: true,
    get: () => vec2(liveSize.x / 2, liveSize.y / 2),
    set: (next: Readonly<Vector2>) => {
      const finite = finiteVector(next, 'RectangleShape2D.extents');
      if (finite.x < 0 || finite.y < 0) throw new Error('RectangleShape2D.extents must be non-negative');
      liveSize = vec2(finite.x * 2, finite.y * 2);
      shapeResourceChanged(value);
    },
  });
  registerGodotObjectIdentity(value, 'RectangleShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createRectangleShape2D(source.size); },
  }));
}

/** Godot 4's infinite 2D world boundary retained as Rapier's native half-space parameters. */
export function createWorldBoundaryShape2D(
  normal: Readonly<Vector2> = vec2(0, -1),
  distance = 0,
): GodotWorldBoundaryShape2D {
  let liveNormal = finiteVector(normal, 'WorldBoundaryShape2D.normal');
  let liveDistance = Number(distance);
  const length = Math.hypot(liveNormal.x, liveNormal.y);
  if (!(length > 0)) throw new RangeError('WorldBoundaryShape2D.normal must be non-zero.');
  if (!Number.isFinite(liveDistance)) {
    throw new RangeError('WorldBoundaryShape2D.distance must be finite.');
  }
  const value = { kind: 'world-boundary' } as GodotWorldBoundaryShape2D;
  Object.defineProperties(value, {
    normal: {
      enumerable: true,
      get: () => vec2(liveNormal.x, liveNormal.y),
      set: (next: Readonly<Vector2>) => {
        const finite = finiteVector(next, 'WorldBoundaryShape2D.normal');
        const magnitude = Math.hypot(finite.x, finite.y);
        if (!(magnitude > 0)) throw new RangeError('WorldBoundaryShape2D.normal must be non-zero.');
        if (finite.x === liveNormal.x && finite.y === liveNormal.y) return;
        liveNormal = finite;
        shapeResourceChanged(value);
      },
    },
    distance: {
      enumerable: true,
      get: () => liveDistance,
      set: (next: number) => {
        if (!Number.isFinite(next)) throw new RangeError('WorldBoundaryShape2D.distance must be finite.');
        if (next === liveDistance) return;
        liveDistance = next;
        shapeResourceChanged(value);
      },
    },
  });
  value.get_normal = () => value.normal;
  value.set_normal = (next) => { value.normal = next as Vector2; };
  value.get_distance = () => value.distance;
  value.set_distance = (next) => { value.distance = next; };
  registerGodotObjectIdentity(value, 'WorldBoundaryShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createWorldBoundaryShape2D(source.normal, source.distance); },
  }));
}

/** Godot 3's canonical name/property spelling for the same infinite half-plane resource. */
export function createLineShape2D(
  normal: Readonly<Vector2> = vec2(0, -1),
  d = 0,
): GodotLineShape2D {
  let liveNormal = finiteVector(normal, 'LineShape2D.normal');
  const length = Math.hypot(liveNormal.x, liveNormal.y);
  if (!(length > 0)) throw new RangeError('LineShape2D.normal must be non-zero.');
  let liveDistance = Number(d);
  if (!Number.isFinite(liveDistance)) throw new RangeError('LineShape2D.d must be finite.');
  const value = { kind: 'world-boundary' } as GodotLineShape2D;
  Object.defineProperties(value, {
    normal: {
      enumerable: true,
      get: () => vec2(liveNormal.x, liveNormal.y),
      set: (next: Readonly<Vector2>) => {
        const finite = finiteVector(next, 'LineShape2D.normal');
        const magnitude = Math.hypot(finite.x, finite.y);
        if (!(magnitude > 0)) throw new RangeError('LineShape2D.normal must be non-zero.');
        if (finite.x === liveNormal.x && finite.y === liveNormal.y) return;
        liveNormal = finite;
        shapeResourceChanged(value);
      },
    },
    d: {
      enumerable: true,
      get: () => liveDistance,
      set: (next: number) => {
        if (!Number.isFinite(next)) throw new RangeError('LineShape2D.d must be finite.');
        if (next === liveDistance) return;
        liveDistance = next;
        shapeResourceChanged(value);
      },
    },
    distance: { enumerable: false, get: () => liveDistance },
  });
  value.get_normal = () => value.normal;
  value.set_normal = (next) => { value.normal = next as Vector2; };
  value.get_d = () => value.d;
  value.set_d = (next) => { value.d = next; };
  registerGodotObjectIdentity(value, 'LineShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createLineShape2D(source.normal, source.d); },
  }));
}

export function createCapsuleShape2D(
  godotMajor: 3 | 4 = 4,
  radius = 10,
  height = 20,
): GodotCapsuleShape2D {
  if (![radius, height].every(Number.isFinite) || radius < 0 || height < 0) {
    throw new Error('CapsuleShape2D radius and height must be non-negative');
  }
  let liveRadius = radius;
  let midHeight = godotMajor === 3 ? height : Math.max(0, height - radius * 2);
  const value = { kind: 'capsule', godotMajor } as GodotCapsuleShape2D;
  Object.defineProperties(value, {
    radius: {
      enumerable: true,
      get: () => liveRadius,
      set: (next: number) => {
        if (!Number.isFinite(next) || next < 0) throw new Error('CapsuleShape2D.radius must be >= 0');
        const totalHeight = midHeight + liveRadius * 2;
        liveRadius = next;
        if (godotMajor === 4) midHeight = Math.max(0, totalHeight - liveRadius * 2);
        shapeResourceChanged(value);
      },
    },
    height: {
      enumerable: true,
      get: () => godotMajor === 3 ? midHeight : midHeight + liveRadius * 2,
      set: (next: number) => {
        if (!Number.isFinite(next) || next < 0) throw new Error('CapsuleShape2D.height must be >= 0');
        if (godotMajor === 3) {
          midHeight = next;
        } else if (next < liveRadius * 2) {
          liveRadius = next / 2;
          midHeight = 0;
        } else {
          midHeight = next - liveRadius * 2;
        }
        shapeResourceChanged(value);
      },
    },
    midHeight: { enumerable: false, get: () => midHeight },
  });
  registerGodotObjectIdentity(value, 'CapsuleShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) {
      return createCapsuleShape2D(source.godotMajor, source.radius, source.height);
    },
  }));
}

/** Godot 3's 2D ray resource reaches from its local origin along +Y. */
export function createGodotRayShape2D(length = 20, slipsOnSlope = false): GodotRayShape2D {
  if (!Number.isFinite(length) || length < 0) throw new RangeError('RayShape2D.length must be non-negative.');
  let retainedLength = length;
  let retainedSlips = Boolean(slipsOnSlope);
  const value = { kind: 'ray' } as GodotRayShape2D;
  const setLength = (next: number): void => {
    if (!Number.isFinite(next) || next < 0) throw new RangeError('RayShape2D.length must be non-negative.');
    if (next === retainedLength) return;
    retainedLength = next;
    shapeResourceChanged(value);
  };
  const setSlips = (next: boolean): void => {
    if (typeof next !== 'boolean') throw new TypeError('RayShape2D.slips_on_slope requires bool.');
    if (next === retainedSlips) return;
    retainedSlips = next;
    shapeResourceChanged(value);
  };
  Object.defineProperties(value, {
    length: { enumerable: true, get: () => retainedLength, set: setLength },
    slips_on_slope: { enumerable: true, get: () => retainedSlips, set: setSlips },
  });
  value.get_length = () => retainedLength;
  value.set_length = setLength;
  value.get_slips_on_slope = () => retainedSlips;
  value.set_slips_on_slope = setSlips;
  registerGodotObjectIdentity(value, 'RayShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createGodotRayShape2D(source.length, source.slips_on_slope); },
  }));
}

function shapePoints2D(values: Iterable<unknown>, member: string): PackedVector2Array {
  let points: PackedVector2Array;
  try {
    points = packedVector2Array(values);
  } catch (error) {
    throw new Error(`${member} must contain finite Vector2 values`, { cause: error });
  }
  for (const point of points) finiteVector(point, member);
  return points;
}

function rapierVertices2D(points: readonly Vector2[]): Float32Array {
  const result = new Float32Array(points.length * 2);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    result[i * 2] = point.x;
    result[i * 2 + 1] = point.y;
  }
  return result;
}

function worldBoundaryNormal2D(shape: GodotWorldBoundaryShape2D | GodotLineShape2D): Vector2 {
  const normal = finiteVector(shape.normal, 'WorldBoundaryShape2D.normal');
  const magnitude = Math.hypot(normal.x, normal.y);
  if (!(magnitude > 0)) throw new RangeError('WorldBoundaryShape2D.normal must be non-zero.');
  return vec2(normal.x / magnitude, normal.y / magnitude);
}

function localShapeOffset2D(shape: GodotShape2D): Vector2 {
  if (shape.kind !== 'world-boundary') return vec2(0, 0);
  if (!Number.isFinite(shape.distance)) throw new TypeError('WorldBoundaryShape2D distance must be finite.');
  const authoredNormal = finiteVector(shape.normal, 'WorldBoundaryShape2D.normal');
  const magnitude = Math.hypot(authoredNormal.x, authoredNormal.y);
  if (!(magnitude > 0)) throw new RangeError('WorldBoundaryShape2D.normal must be non-zero.');
  const signedDistance = shape.distance / magnitude;
  return vec2(
    authoredNormal.x / magnitude * signedDistance,
    authoredNormal.y / magnitude * signedDistance,
  );
}

function nativeRapierShape2D(shape: GodotShape2D): RAPIER.Shape {
  return shape.kind === 'world-boundary'
    ? new RAPIER.HalfSpace(worldBoundaryNormal2D(shape))
    : rapierShape2D(shape);
}

function placedShapeTranslation2D(
  shape: GodotShape2D,
  translation: Readonly<Vector2>,
  rotation: number,
): Vector2 {
  const base = finiteVector(translation, 'CollisionShape2D.position');
  if (!Number.isFinite(rotation)) throw new TypeError('CollisionShape2D.rotation must be finite.');
  const offset = localShapeOffset2D(shape);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return vec2(
    base.x + offset.x * cosine - offset.y * sine,
    base.y + offset.x * sine + offset.y * cosine,
  );
}

/** Live resource mutations replace the native half-space and its local offset atomically. */
export function createRapierColliderShape2DConsumer(
  collider: RAPIER.Collider,
  translation: Readonly<Vector2> = vec2(0, 0),
  rotation = 0,
): PhysicsShapeResource2DConsumer {
  const base = finiteVector(translation, 'CollisionShape2D.position');
  if (!Number.isFinite(rotation)) throw new TypeError('CollisionShape2D.rotation must be finite.');
  return {
    setShape(shape) { collider.setShape(shape); },
    setShapeResource(shape) {
      collider.setShape(nativeRapierShape2D(shape));
      collider.setTranslationWrtParent(placedShapeTranslation2D(shape, base, rotation));
      collider.setRotationWrtParent(rotation);
    },
  };
}

export function createSegmentShape2D(
  a: Readonly<Vector2> = vec2(0, 0),
  b: Readonly<Vector2> = vec2(0, 10),
): GodotSegmentShape2D {
  let liveA = finiteVector(a, 'SegmentShape2D.a');
  let liveB = finiteVector(b, 'SegmentShape2D.b');
  const value = { kind: 'segment' } as GodotSegmentShape2D;
  Object.defineProperties(value, {
    a: {
      enumerable: true,
      get: () => vec2(liveA.x, liveA.y),
      set: (next: Vector2) => {
        const finite = finiteVector(next, 'SegmentShape2D.a');
        if (finite.x === liveA.x && finite.y === liveA.y) return;
        liveA = finite;
        shapeResourceChanged(value);
      },
    },
    b: {
      enumerable: true,
      get: () => vec2(liveB.x, liveB.y),
      set: (next: Vector2) => {
        const finite = finiteVector(next, 'SegmentShape2D.b');
        if (finite.x === liveB.x && finite.y === liveB.y) return;
        liveB = finite;
        shapeResourceChanged(value);
      },
    },
  });
  registerGodotObjectIdentity(value, 'SegmentShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createSegmentShape2D(source.a, source.b); },
  }));
}

export function createConvexPolygonShape2D(
  points: Iterable<unknown> = [],
): GodotConvexPolygonShape2D {
  let livePoints = shapePoints2D(points, 'ConvexPolygonShape2D.points');
  const value = { kind: 'convex-polygon' } as GodotConvexPolygonShape2D;
  Object.defineProperty(value, 'points', {
    enumerable: true,
    get: () => packedVector2Array(livePoints),
    set: (next: PackedVector2Array) => {
      livePoints = shapePoints2D(next, 'ConvexPolygonShape2D.points');
      shapeResourceChanged(value);
    },
  });
  value.set_points = (next: PackedVector2Array): void => { value.points = next; };
  registerGodotObjectIdentity(value, 'ConvexPolygonShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createConvexPolygonShape2D(source.points); },
  }));
}

export function createConcavePolygonShape2D(
  segments: Iterable<unknown> = [],
): GodotConcavePolygonShape2D {
  let liveSegments = shapePoints2D(segments, 'ConcavePolygonShape2D.segments');
  const value = { kind: 'concave-polygon' } as GodotConcavePolygonShape2D;
  Object.defineProperty(value, 'segments', {
    enumerable: true,
    get: () => packedVector2Array(liveSegments),
    set: (next: PackedVector2Array) => {
      liveSegments = shapePoints2D(next, 'ConcavePolygonShape2D.segments');
      shapeResourceChanged(value);
    },
  });
  registerGodotObjectIdentity(value, 'ConcavePolygonShape2D');
  return retainGodotShape2D(bindGodotResourceProtocol(value, {
    createDuplicate(source) { return createConcavePolygonShape2D(source.segments); },
  }));
}

export function rapierShape2D(shape: GodotShape2D): RAPIER.Shape {
  if (shape.kind === 'circle') {
    if (!Number.isFinite(shape.radius) || shape.radius < 0) throw new Error('CircleShape2D.radius must be >= 0');
    return new RAPIER.Ball(shape.radius);
  }
  if (shape.kind === 'rectangle') {
    const size = finiteVector(shape.size, 'RectangleShape2D.size');
    if (size.x < 0 || size.y < 0) throw new Error('RectangleShape2D.size must be non-negative');
    return new RAPIER.Cuboid(size.x / 2, size.y / 2);
  }
  if (shape.kind === 'world-boundary') {
    const normal = worldBoundaryNormal2D(shape);
    if (shape.distance !== 0) {
      throw new Error(
        'WorldBoundaryShape2D.distance requires a collider descriptor transform; bare shape queries cannot erase that offset.',
      );
    }
    return new RAPIER.HalfSpace(normal);
  }
  if (shape.kind === 'segment') {
    return new RAPIER.Segment(
      finiteVector(shape.a, 'SegmentShape2D.a'),
      finiteVector(shape.b, 'SegmentShape2D.b'),
    );
  }
  if (shape.kind === 'ray') {
    return new RAPIER.Segment(vec2(0, 0), vec2(0, shape.length));
  }
  if (shape.kind === 'convex-polygon') {
    if (shape.points.length < 3) throw new Error('ConvexPolygonShape2D needs at least three points for a native Rapier shape');
    return new RAPIER.ConvexPolygon(rapierVertices2D(shape.points), false);
  }
  if (shape.kind === 'concave-polygon') {
    if (shape.segments.length < 2 || shape.segments.length % 2 !== 0) {
      throw new Error('ConcavePolygonShape2D.segments must contain endpoint pairs for a native Rapier shape');
    }
    const indices = new Uint32Array(shape.segments.length);
    for (let i = 0; i < indices.length; i += 1) indices[i] = i;
    return new RAPIER.Polyline(rapierVertices2D(shape.segments), indices);
  }
  if (![shape.radius, shape.midHeight].every(Number.isFinite) || shape.radius < 0 || shape.midHeight < 0) {
    throw new Error('CapsuleShape2D radius and normalized mid-height must be non-negative');
  }
  return new RAPIER.Capsule(shape.midHeight / 2, shape.radius);
}

export function rapierColliderDesc2D(
  shape: GodotShape2D,
  translation?: Readonly<Vector2>,
  rotation = 0,
): RAPIER.ColliderDesc {
  if (shape.kind === 'segment') return RAPIER.ColliderDesc.segment(shape.a, shape.b);
  if (shape.kind === 'ray') return RAPIER.ColliderDesc.segment(vec2(0, 0), vec2(0, shape.length));
  if (shape.kind === 'circle') return RAPIER.ColliderDesc.ball(shape.radius);
  if (shape.kind === 'rectangle') return RAPIER.ColliderDesc.cuboid(shape.size.x / 2, shape.size.y / 2);
  if (shape.kind === 'capsule') return RAPIER.ColliderDesc.capsule(shape.midHeight / 2, shape.radius);
  if (shape.kind === 'world-boundary') {
    const descriptor = RAPIER.ColliderDesc.halfspace(worldBoundaryNormal2D(shape));
    const at = placedShapeTranslation2D(shape, translation ?? vec2(0, 0), rotation);
    return descriptor.setTranslation(at.x, at.y).setRotation(rotation);
  }
  const points = shape.kind === 'convex-polygon' ? shape.points : shape.segments;
  const vertices = rapierVertices2D(points);
  if (shape.kind === 'convex-polygon') {
    if (points.length < 3) throw new Error('ConvexPolygonShape2D needs at least three points for a native Rapier collider');
    const descriptor = RAPIER.ColliderDesc.convexHull(vertices);
    if (descriptor === null) throw new Error('ConvexPolygonShape2D points do not form a native Rapier convex hull');
    return descriptor;
  }
  if (points.length < 2 || points.length % 2 !== 0) {
    throw new Error('ConcavePolygonShape2D.segments must contain endpoint pairs for a native Rapier collider');
  }
  const indices = new Uint32Array(points.length);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i;
  return RAPIER.ColliderDesc.polyline(vertices, indices);
}

export function createPhysicsDirectSpaceState2D(
  world: RAPIER.World,
  options: PhysicsDirectSpaceState2DOptions,
): PhysicsDirectSpaceState2D {
  const hit = (collider: RAPIER.Collider): PhysicsQueryHit2D => frozenHit(collider, options.resolveCollider);

  const intersectPoint = (
    parameters: PhysicsPointQueryParameters2D,
    maxResults = 32,
  ): PhysicsQueryHit2D[] => {
    if (parameters.canvasInstanceId !== 0) {
      throw new Error('PhysicsPointQueryParameters2D.canvas_instance_id cannot be mapped to Rapier world identity');
    }
    const results: RAPIER.Collider[] = [];
    const filter = queryFilter(options.layers, parameters);
    world.intersectionsWithPoint(finiteVector(parameters.position, 'PhysicsPointQueryParameters2D.position'), (collider) => {
      results.push(collider);
      return results.length < resultLimit(maxResults);
    }, undefined, undefined, undefined, undefined, filter);
    return results.sort((a, b) => a.handle - b.handle).slice(0, maxResults).map(hit);
  };

  const castMotion = (parameters: PhysicsShapeQueryParameters2D): readonly [number, number] => {
    if (!Number.isFinite(parameters.margin) || parameters.margin < 0) {
      throw new Error('PhysicsShapeQueryParameters2D.margin must be >= 0');
    }
    const pose = rigidPose(parameters.transform);
    const motion = finiteVector(parameters.motion, 'PhysicsShapeQueryParameters2D.motion');
    const shape = requireShape(parameters);
    const baseFilter = queryFilter(options.layers, parameters);
    const initiallyOverlapping = new Set<number>();
    world.forEachCollider((collider) => {
      if (!baseFilter(collider)) return;
      const contact = collider.contactShape(shape, pose.position, pose.rotation, parameters.margin);
      if (contact !== null && contact.distance <= parameters.margin) initiallyOverlapping.add(collider.handle);
    });
    const filter = (collider: RAPIER.Collider): boolean =>
      !initiallyOverlapping.has(collider.handle) && baseFilter(collider);
    const cast = world.castShape(
      pose.position, pose.rotation, motion, shape, parameters.margin, 1, false,
      undefined, undefined, undefined, undefined, filter,
    );
    if (cast === null) return Object.freeze([1, 1]);
    let safe = 0;
    let unsafe = Math.max(0, Math.min(1, cast.time_of_impact));
    const collidesAt = (fraction: number): boolean => {
      const at = vec2(pose.position.x + motion.x * fraction, pose.position.y + motion.y * fraction);
      let collided = false;
      world.forEachCollider((collider) => {
        if (collided || !filter(collider)) return;
        const contact = collider.contactShape(shape, at, pose.rotation, parameters.margin);
        collided = contact !== null && contact.distance <= parameters.margin;
      });
      return collided;
    };
    if (unsafe === 0) return Object.freeze([0, 0]);
    // Godot exposes a conservative non-colliding/colliding bracket, not one mathematical TOI.
    // Eight bisections match the native solver's finite recovery bracket while keeping `safe`
    // on the separated side and `unsafe` on the colliding side of the SAME margin predicate.
    for (let step = 0; step < 8; step += 1) {
      const middle = (safe + unsafe) / 2;
      if (collidesAt(middle)) unsafe = middle;
      else safe = middle;
    }
    return Object.freeze([safe, unsafe]);
  };

  const contacts = (
    parameters: PhysicsShapeQueryParameters2D,
    maxResults: number,
  ): { collider: RAPIER.Collider; point: Vector2; otherPoint: Vector2; normal: Vector2; distance: number }[] => {
    if (!Number.isFinite(parameters.margin) || parameters.margin < 0) {
      throw new Error('PhysicsShapeQueryParameters2D.margin must be >= 0');
    }
    const pose = rigidPose(parameters.transform);
    const shape = requireShape(parameters);
    const found: { collider: RAPIER.Collider; point: Vector2; otherPoint: Vector2; normal: Vector2; distance: number }[] = [];
    const filter = queryFilter(options.layers, parameters);
    world.forEachCollider((collider) => {
      if (!filter(collider)) return;
      const contact = collider.contactShape(shape, pose.position, pose.rotation, parameters.margin);
      if (contact === null || contact.distance > parameters.margin) return;
      const colliderPosition = collider.translation();
      const colliderRotation = collider.rotation();
      const colliderCos = Math.cos(colliderRotation);
      const colliderSin = Math.sin(colliderRotation);
      const queryCos = Math.cos(pose.rotation);
      const querySin = Math.sin(pose.rotation);
      const colliderPoint = vec2(
        colliderPosition.x + contact.point1.x * colliderCos - contact.point1.y * colliderSin,
        colliderPosition.y + contact.point1.x * colliderSin + contact.point1.y * colliderCos,
      );
      const queryPoint = vec2(
        pose.position.x + contact.point2.x * queryCos - contact.point2.y * querySin,
        pose.position.y + contact.point2.x * querySin + contact.point2.y * queryCos,
      );
      const colliderNormal = vec2(
        contact.normal1.x * colliderCos - contact.normal1.y * colliderSin,
        contact.normal1.x * colliderSin + contact.normal1.y * colliderCos,
      );
      found.push({
        collider,
        point: queryPoint,
        otherPoint: colliderPoint,
        normal: colliderNormal,
        distance: contact.distance,
      });
    });
    return found.sort((a, b) => a.distance - b.distance || a.collider.handle - b.collider.handle).slice(0, resultLimit(maxResults));
  };

  const intersectShape = (
    parameters: PhysicsShapeQueryParameters2D,
    maxResults = 32,
  ): PhysicsQueryHit2D[] => contacts(parameters, maxResults).map((one) => hit(one.collider));

  const intersectRay = (
    parameters: PhysicsRayQueryParameters2D,
  ): PhysicsRayResult2D | Readonly<Record<string, never>> => {
    const from = finiteVector(parameters.from, 'PhysicsRayQueryParameters2D.from');
    const to = finiteVector(parameters.to, 'PhysicsRayQueryParameters2D.to');
    const direction = vec2(to.x - from.x, to.y - from.y);
    if (direction.x === 0 && direction.y === 0) return Object.freeze({});
    const filter = queryFilter(options.layers, {
      collisionMask: uint32(parameters.collisionMask, 'PhysicsRayQueryParameters2D.collision_mask'),
      exclude: parameters.exclude,
      collideWithAreas: parameters.collideWithAreas,
      collideWithBodies: parameters.collideWithBodies,
    });
    const ray = new RAPIER.Ray(from, direction);
    const result = world.castRayAndGetNormal(
      ray,
      1,
      parameters.hitFromInside,
      undefined,
      undefined,
      undefined,
      undefined,
      filter,
    );
    if (result === null) return Object.freeze({});
    const base = hit(result.collider);
    const inside = result.timeOfImpact === 0 && parameters.hitFromInside;
    return Object.freeze({
      ...base,
      position: vec2(
        from.x + direction.x * result.timeOfImpact,
        from.y + direction.y * result.timeOfImpact,
      ),
      normal: inside ? vec2(0, 0) : vec2(result.normal.x, result.normal.y),
    });
  };

  return {
    intersectPoint,
    intersectPoint3(point, maxResults = 32, exclude = [], collisionMask = 0x7fff_ffff, collideWithBodies = true, collideWithAreas = false) {
      return intersectPoint({ position: finiteVector(point, 'intersect_point point'), canvasInstanceId: 0, collisionMask: uint32(collisionMask, 'collision_mask'), exclude, collideWithBodies, collideWithAreas }, maxResults);
    },
    intersectRay,
    intersectRay3(
      from,
      to,
      exclude = [],
      collisionMask = 0x7fff_ffff,
      collideWithBodies = true,
      collideWithAreas = false,
    ) {
      return intersectRay({
        from: finiteVector(from, 'intersect_ray from'),
        to: finiteVector(to, 'intersect_ray to'),
        exclude,
        collisionMask: uint32(collisionMask, 'intersect_ray collision_mask'),
        collideWithBodies,
        collideWithAreas,
        hitFromInside: false,
      });
    },
    intersectShape,
    castMotion,
    collideShape(parameters, maxResults = 32): Vector2[] {
      return contacts(parameters, maxResults).flatMap((one) => [one.point, one.otherPoint]);
    },
    getRestInfo(parameters): PhysicsRestInfo2D | Readonly<Record<string, never>> {
      const first = contacts(parameters, 1)[0];
      if (first === undefined) return Object.freeze({});
      return Object.freeze({
        ...hit(first.collider),
        point: first.otherPoint,
        normal: first.normal,
        linear_velocity: bodyVelocityAt(first.collider, first.otherPoint),
      });
    },
  };
}

export function createPhysicsDirectSpaceState2DFromRid(
  space: GodotRid,
  options: PhysicsDirectSpaceState2DOptions,
): PhysicsDirectSpaceState2D {
  return createPhysicsDirectSpaceState2D(physicsWorld2DOfRid(space), options);
}
