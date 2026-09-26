import RAPIER from '@dimforge/rapier2d-compat';
import type { CollisionLayers } from './collision-layers';
import { godotGlobalCall, type GodotRid } from './gdscript-builtins';
import { godotObjectInstanceId } from './object';
import { packedVector2Array } from './packed-array';
import { bindArea2DMonitoring, isMonitorable2D, isMonitoring2D, releaseArea2DMonitoring, setMonitorable2D } from './area-2d';
import { physicsArea2DOfRid, physicsAreaRid2DOf, physicsSpaceRid2D, physicsWorld2DOfRid, rapierColliderDesc2D, registerPhysicsArea2D, releasePhysicsShapeResource2D, replacePhysicsArea2DShapes, retainPhysicsShapeResource2D, setPhysicsAreaObjectInstanceId2D, type GodotShape2D, type PhysicsArea2DRegistration } from './physics-query-2d';
import { godotResourceOfRid } from './resource-io';
import type { GodotTransform2D } from './transform-2d';
import { vec2, type Vector2 } from './vector2';

export interface PhysicsServerArea2DOptions {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly areas: Map<RAPIER.Collider, { readonly area?: object; readonly node?: object }>;
}

export interface PhysicsServerArea2DAuthoredState {
  readonly overrideMode?: number;
  readonly gravityOverrideMode?: number;
  readonly linearDampOverrideMode?: number;
  readonly angularDampOverrideMode?: number;
  readonly gravity?: number;
  readonly gravityVector?: Vector2;
  readonly gravityIsPoint?: boolean;
  readonly gravityPointUnitDistance?: number;
  readonly gravityPointAttenuation?: number;
  readonly linearDamp?: number;
  readonly angularDamp?: number;
  readonly priority?: number;
}

interface AreaServerState {
  layer: number;
  mask: number;
  objectId?: bigint;
  canvasId?: bigint;
  gravityOverrideMode: number;
  linearDampOverrideMode: number;
  angularDampOverrideMode: number;
  gravity: number;
  gravityVector: Vector2;
  gravityIsPoint: boolean;
  gravityPointUnitDistance: number;
  gravityPointAttenuation: number;
  linearDamp: number;
  angularDamp: number;
  priority: number;
  shapeRids: GodotRid[];
}

interface ServerShape2D {
  readonly type: number;
  data: unknown;
  sourceData: unknown;
  refs: number;
  readonly resource?: GodotShape2D;
}

const SERVER_STATE = new WeakMap<object, AreaServerState>();
const SERVER_SHAPES = new Map<bigint, ServerShape2D>();
const FREED_SHAPE_RIDS = new Set<bigint>();

function areaInWorld(options: PhysicsServerArea2DOptions, rid: GodotRid): PhysicsArea2DRegistration {
  const area = physicsArea2DOfRid(rid);
  if (area.world !== options.world) throw new Error('PhysicsServer2D Area RID belongs to a different registered native space');
  for (const shape of area.shapes) for (const collider of shape) {
    const owner = options.areas.get(collider);
    if ((owner?.area ?? owner?.node) !== area.node) throw new Error('PhysicsServer2D Area RID is absent from the native ctx.areaColliders registry');
  }
  return area;
}

function sensors(area: PhysicsArea2DRegistration): RAPIER.Collider[] {
  return area.shapes.flatMap((shape) => [...shape]);
}

function state(options: PhysicsServerArea2DOptions, area: PhysicsArea2DRegistration): AreaServerState {
  let value = SERVER_STATE.get(area.node);
  if (value !== undefined) return value;
  const first = sensors(area)[0];
  value = {
    layer: first === undefined ? 1 : options.layers.layerOf(first),
    mask: first === undefined ? 1 : options.layers.maskOf(first),
    gravityOverrideMode: 0,
    linearDampOverrideMode: 0,
    angularDampOverrideMode: 0,
    gravity: 980,
    gravityVector: vec2(0, 1),
    gravityIsPoint: false,
    gravityPointUnitDistance: 0,
    gravityPointAttenuation: 1,
    linearDamp: 0.1,
    angularDamp: 1,
    priority: 0,
    shapeRids: [],
  };
  SERVER_STATE.set(area.node, value);
  return value;
}

function nodeState(options: PhysicsServerArea2DOptions, node: object): AreaServerState {
  return state(options, areaInWorld(options, physicsAreaRid2DOf(node)));
}

export function getAreaGravity2D(options: PhysicsServerArea2DOptions, node: object): number {
  return nodeState(options, node).gravity;
}
export function setAreaGravity2D(options: PhysicsServerArea2DOptions, node: object, value: number): void {
  nodeState(options, node).gravity = finite(value, 'Area2D.gravity');
}
export function getAreaGravityDirection2D(options: PhysicsServerArea2DOptions, node: object): Vector2 {
  const value = nodeState(options, node).gravityVector;
  return vec2(value.x, value.y);
}
export function setAreaGravityDirection2D(options: PhysicsServerArea2DOptions, node: object, value: Vector2): void {
  nodeState(options, node).gravityVector = finiteVector(value, 'Area2D.gravity_direction');
}
export function getAreaGravityPoint2D(options: PhysicsServerArea2DOptions, node: object): boolean {
  return nodeState(options, node).gravityIsPoint;
}
export function setAreaGravityPoint2D(options: PhysicsServerArea2DOptions, node: object, value: boolean): void {
  nodeState(options, node).gravityIsPoint = boolean(value, 'Area2D.gravity_point');
}
export function getAreaGravityPointUnitDistance2D(options: PhysicsServerArea2DOptions, node: object): number {
  return nodeState(options, node).gravityPointUnitDistance;
}
export function setAreaGravityPointUnitDistance2D(options: PhysicsServerArea2DOptions, node: object, value: number): void {
  nodeState(options, node).gravityPointUnitDistance = finite(value, 'Area2D.gravity_point_unit_distance');
}
export function getAreaGravityPointAttenuation2D(options: PhysicsServerArea2DOptions, node: object): number {
  return nodeState(options, node).gravityPointAttenuation;
}
export function setAreaGravityPointAttenuation2D(options: PhysicsServerArea2DOptions, node: object, value: number): void {
  nodeState(options, node).gravityPointAttenuation = finite(value, 'Area2D.gravity_point_attenuation');
}
export function getAreaLinearDamp2D(options: PhysicsServerArea2DOptions, node: object): number {
  return nodeState(options, node).linearDamp;
}
export function setAreaLinearDamp2D(options: PhysicsServerArea2DOptions, node: object, value: number): void {
  nodeState(options, node).linearDamp = finite(value, 'Area2D.linear_damp');
}
export function getAreaAngularDamp2D(options: PhysicsServerArea2DOptions, node: object): number {
  return nodeState(options, node).angularDamp;
}
export function setAreaAngularDamp2D(options: PhysicsServerArea2DOptions, node: object, value: number): void {
  nodeState(options, node).angularDamp = finite(value, 'Area2D.angular_damp');
}
export function getAreaPriority2D(options: PhysicsServerArea2DOptions, node: object): number {
  return nodeState(options, node).priority;
}
export function setAreaPriority2D(options: PhysicsServerArea2DOptions, node: object, value: number): void {
  nodeState(options, node).priority = finite(value, 'Area2D.priority');
}

function uint32(value: number, member: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new Error(`${member} must be a uint32`);
  return value;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${member} must be finite`);
  return value;
}

function finiteVector(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value)) throw new Error(`${member} must be a Vector2`);
  const vector = value as { readonly x: unknown; readonly y: unknown };
  if (typeof vector.x !== 'number' || typeof vector.y !== 'number' || !Number.isFinite(vector.x) || !Number.isFinite(vector.y)) throw new Error(`${member} must be a finite Vector2`);
  return vec2(vector.x, vector.y);
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${member} must be boolean`);
  return value;
}

function rigidPose(value: GodotTransform2D): { position: Vector2; rotation: number } {
  const xLength = Math.hypot(value.x.x, value.x.y);
  const yLength = Math.hypot(value.y.x, value.y.y);
  const dot = value.x.x * value.y.x + value.x.y * value.y.y;
  const determinant = value.x.x * value.y.y - value.x.y * value.y.x;
  if (![value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y].every(Number.isFinite) || Math.abs(xLength - 1) > 1e-6 || Math.abs(yLength - 1) > 1e-6 || Math.abs(dot) > 1e-6 || Math.abs(determinant - 1) > 1e-6) {
    throw new Error('PhysicsServer2D Area Transform2D must be finite and rigid');
  }
  return { position: vec2(value.origin.x, value.origin.y), rotation: Math.atan2(value.x.y, value.x.x) };
}

function transformOf(position: Readonly<Vector2>, rotation: number): GodotTransform2D {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return { x: vec2(c, s), y: vec2(-s, c), origin: vec2(position.x, position.y) };
}

function shape(area: PhysicsArea2DRegistration, index: number): readonly RAPIER.Collider[] {
  if (!Number.isInteger(index) || index < 0 || index >= area.shapes.length) throw new RangeError(`PhysicsServer2D Area shape index ${String(index)} is outside the registered native Area`);
  return area.shapes[index] as readonly RAPIER.Collider[];
}

function allocateRid(): GodotRid {
  const id = godotGlobalCall<number>('rid_allocate_id', []);
  return godotGlobalCall('rid_from_int64', [id]);
}

function shapeRid(value: unknown): GodotRid {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'bigint') throw new Error('PhysicsServer2D Shape RID must be an actual Godot RID value');
  return value as GodotRid;
}

function serverShape(value: unknown): ServerShape2D {
  const rid = shapeRid(value);
  if (FREED_SHAPE_RIDS.has(rid.id)) throw new Error('PhysicsServer2D Shape RID has been freed');
  let result = SERVER_SHAPES.get(rid.id);
  if (result === undefined) {
    const resource = godotResourceOfRid(rid);
    if (resource !== undefined && 'kind' in resource && (
      resource.kind === 'ray' ||
      resource.kind === 'segment' ||
      resource.kind === 'circle' ||
      resource.kind === 'rectangle' ||
      resource.kind === 'capsule' ||
      resource.kind === 'convex-polygon' ||
      resource.kind === 'concave-polygon'
    )) {
      const shape = resource as GodotShape2D;
      const type = shape.kind === 'ray' ? 1
        : shape.kind === 'segment' ? 2
        : shape.kind === 'circle' ? 3
        : shape.kind === 'rectangle' ? 4
        : shape.kind === 'capsule' ? 5
        : shape.kind === 'convex-polygon' ? 6
        : 7;
      result = { type, data: undefined, sourceData: undefined, refs: 0, resource: shape };
      SERVER_SHAPES.set(rid.id, result);
    }
  }
  if (result === undefined) throw new Error('PhysicsServer2D Shape RID does not name a live registered native 2D shape');
  return result;
}

function resourceData(shape: GodotShape2D): unknown {
  if (shape.kind === 'ray') {
    return Object.freeze({ length: shape.length, slips_on_slope: shape.slips_on_slope });
  }
  if (shape.kind === 'segment') return Object.freeze({ position: shape.a, size: shape.b });
  if (shape.kind === 'circle') return shape.radius;
  if (shape.kind === 'rectangle') return vec2(shape.size.x / 2, shape.size.y / 2);
  if (shape.kind === 'capsule') return vec2(shape.radius, shape.height);
  if (shape.kind === 'convex-polygon') return packedVector2Array(shape.points);
  if (shape.kind === 'world-boundary') {
    throw new Error('PhysicsServer2D.shape_get_data for world-boundary Resources is not exposed by this direct Shape2D collider lane.');
  }
  return packedVector2Array(shape.segments);
}

function points(value: unknown, member: string): Vector2[] {
  if (!Array.isArray(value) && !(value instanceof Float32Array) && !(value instanceof Float64Array)) throw new Error(`${member} must be a packed Vector2 array`);
  if (value instanceof Float32Array || value instanceof Float64Array) {
    if (value.length % 2 !== 0) throw new Error(`${member} packed coordinates must have even length`);
    const result: Vector2[] = [];
    for (let i = 0; i < value.length; i += 2) result.push(finiteVector({ x: value[i], y: value[i + 1] }, member));
    return result;
  }
  return value.map((point) => finiteVector(point, member));
}

function shapeData(type: number, major: 3 | 4, value: unknown): unknown {
  if (type === 2) {
    if (typeof value !== 'object' || value === null || !('position' in value) || !('size' in value)) throw new Error('PhysicsServer2D segment shape data must be a Rect2 containing both endpoints');
    const rect = value as { readonly position: unknown; readonly size: unknown };
    return Object.freeze({ position: finiteVector(rect.position, 'PhysicsServer2D segment first point'), size: finiteVector(rect.size, 'PhysicsServer2D segment second point') });
  }
  if (type === 3) {
    const radius = finite(value, 'PhysicsServer2D circle radius');
    if (radius < 0) throw new Error('PhysicsServer2D circle radius must be non-negative');
    return radius;
  }
  if (type === 4) {
    const size = finiteVector(value, 'PhysicsServer2D rectangle half-extents');
    if (size.x < 0 || size.y < 0) throw new Error('PhysicsServer2D rectangle dimensions must be non-negative');
    return size;
  }
  if (type === 5) {
    let radius: number;
    let height: number;
    if (Array.isArray(value)) {
      if (value.length !== 2) throw new Error('PhysicsServer2D capsule Array data must be [height, radius]');
      height = finite(value[0], 'PhysicsServer2D capsule height');
      radius = finite(value[1], 'PhysicsServer2D capsule radius');
    } else {
      const capsule = finiteVector(value, 'PhysicsServer2D capsule radius/height');
      radius = capsule.x;
      height = capsule.y;
    }
    if (radius < 0 || height < 0) throw new Error('PhysicsServer2D capsule radius and height must be non-negative');
    return Object.freeze({
      radius,
      midHeight: major === 3 ? height : Math.max(0, height - radius * 2),
      sourceHeight: height,
    });
  }
  if (type === 6) {
    const polygon = points(value, 'PhysicsServer2D convex polygon points');
    if (polygon.length < 3) throw new Error('PhysicsServer2D convex polygon needs at least three points');
    return Object.freeze(polygon);
  }
  if (type === 7) {
    const segments = points(value, 'PhysicsServer2D concave polygon segments');
    if (segments.length < 2 || segments.length % 2 !== 0) throw new Error('PhysicsServer2D concave polygon data must contain endpoint pairs');
    return Object.freeze(segments);
  }
  throw new Error(`PhysicsServer2D shape type ${String(type)} has no native Rapier 2D representation`);
}

function copyShapeData(type: number, value: unknown): unknown {
  if (value === undefined || typeof value === 'number') return value;
  if (type === 2) {
    const rect = value as { readonly position: Vector2; readonly size: Vector2 };
    return { position: vec2(rect.position.x, rect.position.y), size: vec2(rect.size.x, rect.size.y) };
  }
  if (type === 5 && Array.isArray(value)) return [value[0], value[1]];
  if (type === 4 || type === 5) {
    const vector = value as Vector2;
    return vec2(vector.x, vector.y);
  }
  return packedVector2Array((value as readonly Vector2[]).map((point) => vec2(point.x, point.y)));
}

function descriptorOf(shape: ServerShape2D): RAPIER.ColliderDesc {
  if (shape.resource !== undefined) return rapierColliderDesc2D(shape.resource);
  if (shape.data === undefined) throw new Error('PhysicsServer2D Shape RID has no data; call shape_set_data before attaching it to an Area');
  if (shape.type === 2) {
    const data = shape.data as { readonly position: Vector2; readonly size: Vector2 };
    return RAPIER.ColliderDesc.segment(data.position, data.size);
  }
  if (shape.type === 3) return RAPIER.ColliderDesc.ball(shape.data as number);
  if (shape.type === 4) {
    const size = shape.data as Vector2;
    return RAPIER.ColliderDesc.cuboid(size.x, size.y);
  }
  if (shape.type === 5) {
    const data = shape.data as { readonly radius: number; readonly midHeight: number };
    return RAPIER.ColliderDesc.capsule(data.midHeight / 2, data.radius);
  }
  const polygon = shape.data as readonly Vector2[];
  const vertices = new Float32Array(polygon.flatMap((point) => [point.x, point.y]));
  if (shape.type === 6) {
    const descriptor = RAPIER.ColliderDesc.convexPolyline(vertices);
    if (descriptor === null) throw new Error('Rapier rejected PhysicsServer2D convex polygon shape data');
    return descriptor;
  }
  const indices = new Uint32Array(polygon.length);
  for (let i = 0; i < polygon.length; i += 2) {
    indices[i] = i;
    indices[i + 1] = i + 1;
  }
  return RAPIER.ColliderDesc.polyline(vertices, indices);
}

export function physicsServerShapeCreate2D(type: number): GodotRid {
  if (!Number.isInteger(type) || type < 2 || type > 7) throw new Error(`PhysicsServer2D shape type ${String(type)} is unsupported; native Area shapes support segment, circle, rectangle, capsule, convex, and concave polygons`);
  const rid = allocateRid();
  FREED_SHAPE_RIDS.delete(rid.id);
  SERVER_SHAPES.set(rid.id, { type, data: undefined, sourceData: undefined, refs: 0 });
  return rid;
}

export function physicsServerShapeSetData2D(major: 3 | 4, rid: GodotRid, data: unknown): void {
  const current = serverShape(rid);
  if (current.refs !== 0 && current.resource === undefined) {
    throw new Error('PhysicsServer2D.shape_set_data cannot change an attached raw Shape RID without rebuilding its live native Area sensors; detach it first');
  }
  const normalized = shapeData(current.type, major, data);
  if (current.resource !== undefined) {
    if (current.resource.kind === 'segment') {
      const segment = normalized as { readonly position: Vector2; readonly size: Vector2 };
      current.resource.a = segment.position;
      current.resource.b = segment.size;
    } else if (current.resource.kind === 'circle') current.resource.radius = normalized as number;
    else if (current.resource.kind === 'rectangle') {
      const extents = normalized as Vector2;
      current.resource.size = vec2(extents.x * 2, extents.y * 2);
    } else if (current.resource.kind === 'capsule') {
      const capsule = normalized as { readonly radius: number; readonly sourceHeight: number };
      current.resource.radius = capsule.radius;
      current.resource.height = capsule.sourceHeight;
    } else if (current.resource.kind === 'convex-polygon') current.resource.points = packedVector2Array(normalized as readonly Vector2[]);
    else if (current.resource.kind === 'concave-polygon') current.resource.segments = packedVector2Array(normalized as readonly Vector2[]);
    else throw new Error('PhysicsServer2D.shape_set_data cannot rewrite a retained world-boundary Resource through polygon data.');
    return;
  }
  current.data = normalized;
  current.sourceData = copyShapeData(current.type, current.type === 6 || current.type === 7 ? normalized : data);
}

export function physicsServerShapeGetData2D(rid: GodotRid): unknown {
  const current = serverShape(rid);
  if (current.resource !== undefined) return resourceData(current.resource);
  if (current.type === 5 && current.data !== undefined) {
    const capsule = current.data as { readonly radius: number; readonly sourceHeight: number };
    return vec2(capsule.sourceHeight, capsule.radius);
  }
  return copyShapeData(current.type, current.sourceData);
}
export function physicsServerShapeGetType2D(rid: GodotRid): number { return serverShape(rid).type; }

export function physicsServerUnsupportedShapeCreate2D(member: string): never {
  throw new Error(`${member} has no native Rapier Area sensor representation`);
}

export function physicsServerFreeRid2D(options: PhysicsServerArea2DOptions, ridValue: GodotRid): void {
  const rid = shapeRid(ridValue);
  let serverShapeValue = SERVER_SHAPES.get(rid.id);
  const resource = godotResourceOfRid(rid);
  if (serverShapeValue === undefined && resource !== undefined && 'kind' in resource && (
    resource.kind === 'segment' ||
    resource.kind === 'circle' ||
    resource.kind === 'rectangle' ||
    resource.kind === 'capsule' ||
    resource.kind === 'convex-polygon' ||
    resource.kind === 'concave-polygon'
  )) {
    serverShapeValue = serverShape(rid);
  }
  if (serverShapeValue !== undefined) {
    if (serverShapeValue.refs !== 0) throw new Error('PhysicsServer2D.free_rid cannot free a Shape RID while a server-owned Area still references it');
    SERVER_SHAPES.delete(rid.id);
    FREED_SHAPE_RIDS.add(rid.id);
    return;
  }
  physicsServerAreaFree2D(options, rid);
}

function areaShapeCollider(
  options: PhysicsServerArea2DOptions,
  area: PhysicsArea2DRegistration,
  major: 3 | 4,
  rid: GodotRid,
  transform: GodotTransform2D,
  disabled: boolean,
): RAPIER.Collider {
  if (typeof disabled !== 'boolean') throw new Error('PhysicsServer2D Area shape disabled state must be boolean');
  const pose = rigidPose(transform);
  void major;
  const descriptor = descriptorOf(serverShape(rid))
    .setSensor(true)
    .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
    .setTranslation(pose.position.x, pose.position.y)
    .setRotation(pose.rotation)
    .setEnabled(!disabled);
  const collider = options.world.createCollider(descriptor, area.body);
  const current = state(options, area);
  options.layers.setLayer(collider, current.layer);
  options.layers.setMask(collider, current.mask);
  options.areas.set(collider, { area: area.node });
  return collider;
}

export function physicsServerAreaCreate2D(options: PhysicsServerArea2DOptions): GodotRid {
  const node = {};
  const body = options.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  bindArea2DMonitoring(node);
  try {
    return registerPhysicsArea2D({
      node,
      sceneOwned: false,
      world: options.world,
      body,
      shapes: [],
    });
  } catch (error) {
    releaseArea2DMonitoring(node);
    options.world.removeRigidBody(body);
    throw error;
  }
}

export function physicsServerAreaFree2D(options: PhysicsServerArea2DOptions, rid: GodotRid): void {
  const area = areaInWorld(options, rid);
  if (area.sceneOwned) throw new Error('PhysicsServer2D.free_rid cannot free a scene-owned retained Area2D independently of its native scene lifecycle');
  const current = state(options, area);
  if (current.shapeRids.length !== area.shapes.length) throw new Error('PhysicsServer2D server-owned Area shape/RID registry is inconsistent');
  for (const [index, shapeRidValue] of current.shapeRids.entries()) {
    const retained = serverShape(shapeRidValue);
    retained.refs -= 1;
    if (retained.resource !== undefined) {
      const collider = area.shapes[index]?.[0];
      if (collider === undefined) throw new Error('PhysicsServer2D server-owned Area shape has no native consumer');
      releasePhysicsShapeResource2D(retained.resource, collider);
    }
  }
  current.shapeRids.length = 0;
  for (const collider of sensors(area)) options.areas.delete(collider);
  releaseArea2DMonitoring(area.node);
  options.world.removeRigidBody(area.body);
}

export function physicsServerAreaGetRid2D(node: object): GodotRid { return physicsAreaRid2DOf(node); }

export function bindPhysicsServerArea2DAuthoredState(
  options: PhysicsServerArea2DOptions,
  node: object,
  authored: PhysicsServerArea2DAuthoredState,
): void {
  const area = areaInWorld(options, physicsAreaRid2DOf(node));
  const current = state(options, area);
  for (const [member, mode] of [
    ['space_override', authored.overrideMode],
    ['gravity_space_override', authored.gravityOverrideMode],
    ['linear_damp_space_override', authored.linearDampOverrideMode],
    ['angular_damp_space_override', authored.angularDampOverrideMode],
  ] as const) {
    if (mode !== undefined && mode !== 0) throw new Error(`Area2D.${member}=${String(mode)} requires a native Area force field unavailable in Rapier`);
  }
  if (authored.gravity !== undefined) current.gravity = finite(authored.gravity, 'Area2D.gravity');
  if (authored.gravityVector !== undefined) current.gravityVector = finiteVector(authored.gravityVector, 'Area2D gravity vector');
  if (authored.gravityIsPoint !== undefined) current.gravityIsPoint = boolean(authored.gravityIsPoint, 'Area2D gravity point flag');
  if (authored.gravityPointUnitDistance !== undefined) current.gravityPointUnitDistance = finite(authored.gravityPointUnitDistance, 'Area2D gravity point distance');
  if (authored.gravityPointAttenuation !== undefined) current.gravityPointAttenuation = finite(authored.gravityPointAttenuation, 'Area2D gravity point attenuation');
  if (authored.linearDamp !== undefined) current.linearDamp = finite(authored.linearDamp, 'Area2D linear damp');
  if (authored.angularDamp !== undefined) current.angularDamp = finite(authored.angularDamp, 'Area2D angular damp');
  if (authored.priority !== undefined) current.priority = finite(authored.priority, 'Area2D priority');
}

export function physicsServerAreaGetSpace2D(options: PhysicsServerArea2DOptions, rid: GodotRid): GodotRid {
  areaInWorld(options, rid);
  return physicsSpaceRid2D(options.world);
}

export function physicsServerAreaSetSpace2D(options: PhysicsServerArea2DOptions, rid: GodotRid, space: GodotRid): void {
  areaInWorld(options, rid);
  if (physicsWorld2DOfRid(space) !== options.world) throw new Error('PhysicsServer2D.area_set_space cannot migrate live native Area sensors between Rapier worlds');
}

export function physicsServerAreaGetCollisionLayer2D(options: PhysicsServerArea2DOptions, rid: GodotRid): number {
  const area = areaInWorld(options, rid);
  const current = state(options, area);
  const first = sensors(area)[0];
  if (first !== undefined) current.layer = options.layers.layerOf(first);
  return current.layer;
}

export function physicsServerAreaSetCollisionLayer2D(options: PhysicsServerArea2DOptions, rid: GodotRid, layer: number): void {
  const area = areaInWorld(options, rid);
  const value = uint32(layer, 'PhysicsServer2D Area collision layer');
  state(options, area).layer = value;
  for (const sensor of sensors(area)) options.layers.setLayer(sensor, value);
}

export function physicsServerAreaGetCollisionMask2D(options: PhysicsServerArea2DOptions, rid: GodotRid): number {
  const area = areaInWorld(options, rid);
  const current = state(options, area);
  const first = sensors(area)[0];
  if (first !== undefined) current.mask = options.layers.maskOf(first);
  return current.mask;
}

export function physicsServerAreaSetCollisionMask2D(options: PhysicsServerArea2DOptions, rid: GodotRid, mask: number): void {
  const area = areaInWorld(options, rid);
  const value = uint32(mask, 'PhysicsServer2D Area collision mask');
  state(options, area).mask = value;
  for (const sensor of sensors(area)) options.layers.setMask(sensor, value);
}

function instanceId(value: unknown, member: string): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new Error(`${member} must be a non-negative Godot object instance ID`);
}

export function physicsServerAreaAttachObjectInstanceId2D(options: PhysicsServerArea2DOptions, rid: GodotRid, id: number | bigint): void {
  const area = areaInWorld(options, rid);
  const value = instanceId(id, 'PhysicsServer2D Area object instance ID');
  state(options, area).objectId = value;
  setPhysicsAreaObjectInstanceId2D(area.node, value);
}

export function physicsServerAreaGetObjectInstanceId2D(options: PhysicsServerArea2DOptions, rid: GodotRid): bigint {
  const area = areaInWorld(options, rid);
  return state(options, area).objectId ?? (area.sceneOwned ? godotObjectInstanceId(area.node) : 0n);
}

export function physicsServerAreaAttachCanvasInstanceId2D(options: PhysicsServerArea2DOptions, rid: GodotRid, id: number | bigint): void {
  const area = areaInWorld(options, rid);
  state(options, area).canvasId = instanceId(id, 'PhysicsServer2D Area canvas instance ID');
}

export function physicsServerAreaGetCanvasInstanceId2D(options: PhysicsServerArea2DOptions, rid: GodotRid): bigint {
  const area = areaInWorld(options, rid);
  return state(options, area).canvasId ?? 0n;
}

export function physicsServerAreaSetMonitorable2D(options: PhysicsServerArea2DOptions, rid: GodotRid, monitorable: boolean): void {
  const area = areaInWorld(options, rid);
  if (typeof monitorable !== 'boolean') throw new Error('PhysicsServer2D Area monitorable must be boolean');
  setMonitorable2D(area.node, monitorable);
}

export function physicsServerAreaIsMonitorable2D(options: PhysicsServerArea2DOptions, rid: GodotRid): boolean {
  return isMonitorable2D(areaInWorld(options, rid).node);
}

export function physicsServerAreaIsMonitoring2D(options: PhysicsServerArea2DOptions, rid: GodotRid): boolean {
  return isMonitoring2D(areaInWorld(options, rid).node);
}

export function physicsServerAreaSetMonitorCallback2D(options: PhysicsServerArea2DOptions, rid: GodotRid): never {
  areaInWorld(options, rid);
  throw new Error('PhysicsServer2D.area_set_monitor_callback cannot install a Godot server callback into the retained Area2D signal monitor');
}

export function physicsServerAreaSetAreaMonitorCallback2D(options: PhysicsServerArea2DOptions, rid: GodotRid): never {
  areaInWorld(options, rid);
  throw new Error('PhysicsServer2D.area_set_area_monitor_callback cannot install a Godot server callback into the retained Area2D signal monitor');
}

export function physicsServerAreaGetShapeCount2D(options: PhysicsServerArea2DOptions, rid: GodotRid): number { return areaInWorld(options, rid).shapes.length; }

export function physicsServerAreaGetShape2D(options: PhysicsServerArea2DOptions, rid: GodotRid, index: number): GodotRid {
  const area = areaInWorld(options, rid);
  shape(area, index);
  if (area.sceneOwned) throw new Error('PhysicsServer2D.area_get_shape cannot fabricate a Shape2D RID for a scene-authored native Rapier sensor');
  const result = state(options, area).shapeRids[index];
  if (result === undefined) throw new Error('PhysicsServer2D server-owned Area shape is missing its registered Shape2D RID');
  return result;
}

export function physicsServerAreaGetShapeTransform2D(options: PhysicsServerArea2DOptions, rid: GodotRid, index: number): GodotTransform2D {
  const area = areaInWorld(options, rid);
  const collider = shape(area, index)[0];
  if (collider === undefined) return transformOf(vec2(0, 0), 0);
  const bodyPosition = area.body.translation();
  const bodyRotation = area.body.rotation();
  const world = collider.translation();
  const dx = world.x - bodyPosition.x;
  const dy = world.y - bodyPosition.y;
  const c = Math.cos(bodyRotation);
  const s = Math.sin(bodyRotation);
  return transformOf(vec2(dx * c + dy * s, -dx * s + dy * c), collider.rotation() - bodyRotation);
}

export function physicsServerAreaSetShapeTransform2D(options: PhysicsServerArea2DOptions, rid: GodotRid, index: number, transform: GodotTransform2D): void {
  const pose = rigidPose(transform);
  for (const collider of shape(areaInWorld(options, rid), index)) {
    collider.setTranslationWrtParent(pose.position);
    collider.setRotationWrtParent(pose.rotation);
  }
}

export function physicsServerAreaSetShapeDisabled2D(options: PhysicsServerArea2DOptions, rid: GodotRid, index: number, disabled: boolean): void {
  if (typeof disabled !== 'boolean') throw new Error('PhysicsServer2D Area shape disabled state must be boolean');
  for (const collider of shape(areaInWorld(options, rid), index)) collider.setEnabled(!disabled);
}

export function physicsServerAreaGetTransform2D(options: PhysicsServerArea2DOptions, rid: GodotRid): GodotTransform2D {
  const body = areaInWorld(options, rid).body;
  return transformOf(body.translation(), body.rotation());
}

export function physicsServerAreaSetTransform2D(options: PhysicsServerArea2DOptions, rid: GodotRid, transform: GodotTransform2D): void {
  const body = areaInWorld(options, rid).body;
  const pose = rigidPose(transform);
  body.setTranslation(pose.position, true);
  body.setRotation(pose.rotation, true);
}

export function physicsServerAreaSetShape2D(options: PhysicsServerArea2DOptions, major: 3 | 4, rid: GodotRid, index: number, shapeRidValue: GodotRid): void {
  const area = areaInWorld(options, rid);
  const previousGroup = shape(area, index);
  if (area.sceneOwned) throw new Error('PhysicsServer2D.area_set_shape cannot structurally replace a scene-authored native Rapier sensor');
  const current = state(options, area);
  const previousRid = current.shapeRids[index];
  if (previousRid === undefined) throw new Error('PhysicsServer2D server-owned Area shape is missing its retained Shape RID');
  const previous = previousGroup[0];
  if (previous === undefined) throw new Error('PhysicsServer2D server-owned Area shape group has no native sensor');
  const nextRid = shapeRid(shapeRidValue);
  const nextShape = serverShape(nextRid);
  const transform = physicsServerAreaGetShapeTransform2D(options, rid, index);
  const collider = areaShapeCollider(options, area, major, nextRid, transform, !previous.isEnabled());
  const nextGroups = area.shapes.map((group, groupIndex) => groupIndex === index ? [collider] : [...group]);
  try {
    replacePhysicsArea2DShapes(area.node, nextGroups);
  } catch (error) {
    options.areas.delete(collider);
    options.world.removeCollider(collider, true);
    throw error;
  }
  const previousShape = serverShape(previousRid);
  previousShape.refs -= 1;
  if (previousShape.resource !== undefined) releasePhysicsShapeResource2D(previousShape.resource, previous);
  nextShape.refs += 1;
  if (nextShape.resource !== undefined) retainPhysicsShapeResource2D(nextShape.resource, collider);
  current.shapeRids[index] = nextRid;
  options.areas.delete(previous);
  options.world.removeCollider(previous, true);
}

export function physicsServerAreaAddShape2D(
  options: PhysicsServerArea2DOptions,
  major: 3 | 4,
  rid: GodotRid,
  shapeRidValue: GodotRid,
  transform: GodotTransform2D = transformOf(vec2(0, 0), 0),
  disabled = false,
): void {
  const area = areaInWorld(options, rid);
  if (area.sceneOwned) throw new Error('PhysicsServer2D.area_add_shape cannot structurally extend a scene-authored Area2D');
  const nextRid = shapeRid(shapeRidValue);
  const nextShape = serverShape(nextRid);
  const collider = areaShapeCollider(options, area, major, nextRid, transform, disabled);
  try {
    replacePhysicsArea2DShapes(area.node, [...area.shapes.map((group) => [...group]), [collider]]);
  } catch (error) {
    options.areas.delete(collider);
    options.world.removeCollider(collider, true);
    throw error;
  }
  nextShape.refs += 1;
  if (nextShape.resource !== undefined) retainPhysicsShapeResource2D(nextShape.resource, collider);
  state(options, area).shapeRids.push(nextRid);
}

export function physicsServerAreaRemoveShape2D(options: PhysicsServerArea2DOptions, rid: GodotRid, index: number): void {
  const area = areaInWorld(options, rid);
  const group = shape(area, index);
  if (area.sceneOwned) throw new Error('PhysicsServer2D.area_remove_shape cannot remove a scene-authored native Rapier sensor independently of its authored shape node');
  const current = state(options, area);
  if (current.shapeRids[index] === undefined) throw new Error('PhysicsServer2D server-owned Area shape is missing its retained Shape RID');
  replacePhysicsArea2DShapes(area.node, area.shapes.filter((_group, groupIndex) => groupIndex !== index).map((one) => [...one]));
  const previousRid = current.shapeRids.splice(index, 1)[0];
  if (previousRid !== undefined) {
    const previousShape = serverShape(previousRid);
    previousShape.refs -= 1;
    if (previousShape.resource !== undefined) {
      const collider = group[0];
      if (collider === undefined) throw new Error('PhysicsServer2D server-owned Area shape has no native consumer');
      releasePhysicsShapeResource2D(previousShape.resource, collider);
    }
  }
  for (const collider of group) {
    options.areas.delete(collider);
    options.world.removeCollider(collider, true);
  }
}

export function physicsServerAreaClearShapes2D(options: PhysicsServerArea2DOptions, rid: GodotRid): void {
  const area = areaInWorld(options, rid);
  if (area.sceneOwned) throw new Error('PhysicsServer2D.area_clear_shapes cannot remove scene-authored native Rapier sensors independently of their authored shape nodes');
  const current = state(options, area);
  if (current.shapeRids.length !== area.shapes.length) throw new Error('PhysicsServer2D server-owned Area shape/RID registry is inconsistent');
  const groups = area.shapes.map((group) => [...group]);
  replacePhysicsArea2DShapes(area.node, []);
  for (const [index, previousRid] of current.shapeRids.entries()) {
    const previousShape = serverShape(previousRid);
    previousShape.refs -= 1;
    if (previousShape.resource !== undefined) {
      const collider = groups[index]?.[0];
      if (collider === undefined) throw new Error('PhysicsServer2D server-owned Area shape has no native consumer');
      releasePhysicsShapeResource2D(previousShape.resource, collider);
    }
  }
  current.shapeRids.length = 0;
  for (const group of groups) for (const collider of group) {
    options.areas.delete(collider);
    options.world.removeCollider(collider, true);
  }
}

export function physicsServerAreaSetSpaceOverrideMode2D(options: PhysicsServerArea2DOptions, rid: GodotRid, mode: number): void {
  const area = areaInWorld(options, rid);
  if (mode !== 0) throw new Error('Physics2DServer non-disabled Area space override mode cannot be represented without a native Rapier Area force field');
  state(options, area).gravityOverrideMode = 0;
}

export function physicsServerAreaGetSpaceOverrideMode2D(options: PhysicsServerArea2DOptions, rid: GodotRid): number {
  return state(options, areaInWorld(options, rid)).gravityOverrideMode;
}

export function physicsServerAreaSetParam2D(options: PhysicsServerArea2DOptions, major: 3 | 4, rid: GodotRid, parameter: number, value: unknown): void {
  const current = state(options, areaInWorld(options, rid));
  if (major === 3) {
    if (parameter === 0) current.gravity = finite(value, 'Physics2DServer Area gravity');
    else if (parameter === 1) current.gravityVector = finiteVector(value, 'Physics2DServer Area gravity vector');
    else if (parameter === 2) current.gravityIsPoint = boolean(value, 'Physics2DServer Area gravity is point');
    else if (parameter === 3) current.gravityPointUnitDistance = finite(value, 'Physics2DServer Area gravity distance scale');
    else if (parameter === 4) current.gravityPointAttenuation = finite(value, 'Physics2DServer Area gravity attenuation');
    else if (parameter === 5) current.linearDamp = finite(value, 'Physics2DServer Area linear damp');
    else if (parameter === 6) current.angularDamp = finite(value, 'Physics2DServer Area angular damp');
    else if (parameter === 7) current.priority = finite(value, 'Physics2DServer Area priority');
    else throw new RangeError(`Physics2DServer Area parameter ${String(parameter)} is outside AreaParameter`);
    return;
  }
  if (parameter === 0 || parameter === 5 || parameter === 7) {
    if (value !== 0) throw new Error('PhysicsServer2D non-disabled Area override modes cannot be represented without native Rapier Area gravity/damping fields');
    if (parameter === 0) current.gravityOverrideMode = 0;
    else if (parameter === 5) current.linearDampOverrideMode = 0;
    else current.angularDampOverrideMode = 0;
  } else if (parameter === 1) current.gravity = finite(value, 'PhysicsServer2D Area gravity');
  else if (parameter === 2) current.gravityVector = finiteVector(value, 'PhysicsServer2D Area gravity vector');
  else if (parameter === 3) current.gravityIsPoint = boolean(value, 'PhysicsServer2D Area gravity is point');
  else if (parameter === 4) current.gravityPointUnitDistance = finite(value, 'PhysicsServer2D Area gravity point unit distance');
  else if (parameter === 6) current.linearDamp = finite(value, 'PhysicsServer2D Area linear damp');
  else if (parameter === 8) current.angularDamp = finite(value, 'PhysicsServer2D Area angular damp');
  else if (parameter === 9) current.priority = finite(value, 'PhysicsServer2D Area priority');
  else throw new RangeError(`PhysicsServer2D Area parameter ${String(parameter)} is outside AreaParameter`);
}

export function physicsServerAreaGetParam2D(options: PhysicsServerArea2DOptions, major: 3 | 4, rid: GodotRid, parameter: number): unknown {
  const current = state(options, areaInWorld(options, rid));
  const values = major === 3
    ? [current.gravity, current.gravityVector, current.gravityIsPoint, current.gravityPointUnitDistance, current.gravityPointAttenuation, current.linearDamp, current.angularDamp, current.priority]
    : [current.gravityOverrideMode, current.gravity, current.gravityVector, current.gravityIsPoint, current.gravityPointUnitDistance, current.linearDampOverrideMode, current.linearDamp, current.angularDampOverrideMode, current.angularDamp, current.priority];
  if (!Number.isInteger(parameter) || parameter < 0 || parameter >= values.length) throw new RangeError(`PhysicsServer2D Area parameter ${String(parameter)} is outside AreaParameter`);
  return values[parameter];
}
