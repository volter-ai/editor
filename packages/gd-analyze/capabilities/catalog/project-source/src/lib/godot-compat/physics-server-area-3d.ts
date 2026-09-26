import RAPIER from '@dimforge/rapier3d-compat';
import { Matrix4, Object3D, Quaternion, Vector3 as ThreeVector3 } from 'three';
import type { CollisionLayers } from './collision-layers';
import { godotGlobalCall, type GodotRid } from './gdscript-builtins';
import { godotObjectInstanceId, registerGodotObjectIdentity } from './object';
import { registerGodotThreeNodeRelease } from './node-3d';
import {
  createAreaMonitoring3D,
  isMonitorable3D,
  isMonitoring3D,
  setMonitorable3D,
  setMonitoring3D,
} from './area-3d';
import type { ColliderAttachShape } from './collider-3d';
import {
  physicsArea3DOfRid,
  physicsAreaRid3DOf,
  physicsSpaceRid3D,
  physicsWorld3DOfRid,
  registerPhysicsArea3D,
  replacePhysicsArea3DShapes,
  setPhysicsAreaObjectInstanceId3D,
  unregisterPhysicsArea3D,
  type PhysicsArea3DRegistration,
} from './physics-query-3d';
import { godotResourceOfRid } from './resource-io';
import { godotDictionary } from './variant';
import { transform3, vec3, type Transform, type Vector3 } from './variant-3d';

export interface PhysicsServerArea3DOptions {
  readonly world: RAPIER.World;
  readonly layers: CollisionLayers;
  readonly areas: Map<RAPIER.Collider, { readonly area?: object; readonly node?: object }>;
}

export interface PhysicsServerArea3DAuthoredState {
  readonly monitoring?: boolean;
  readonly monitorable?: boolean;
  readonly rayPickable?: boolean;
  readonly overrideMode?: number;
  readonly gravityOverrideMode?: number;
  readonly linearDampOverrideMode?: number;
  readonly angularDampOverrideMode?: number;
  readonly gravity?: number;
  readonly gravityVector?: Vector3;
  readonly gravityIsPoint?: boolean;
  readonly gravityPointUnitDistance?: number;
  readonly gravityPointAttenuation?: number;
  readonly linearDamp?: number;
  readonly angularDamp?: number;
  readonly priority?: number;
}

interface AreaServerState3D {
  layer: number;
  mask: number;
  objectId?: bigint;
  rayPickable: boolean;
  monitoring: ReturnType<typeof createAreaMonitoring3D>;
  gravityOverrideMode: number;
  linearDampOverrideMode: number;
  angularDampOverrideMode: number;
  gravity: number;
  gravityVector: Vector3;
  gravityIsPoint: boolean;
  gravityPointUnitDistance: number;
  gravityPointAttenuation: number;
  linearDamp: number;
  angularDamp: number;
  priority: number;
  windForceMagnitude: number;
  windSource: Vector3;
  windDirection: Vector3;
  windAttenuationFactor: number;
  shapeRids: GodotRid[];
}

interface ServerShape3D {
  readonly type: number;
  readonly godotMajor: 3 | 4;
  data: unknown;
  sourceData: unknown;
  margin: number;
  refs: number;
}

const SERVER_STATE = new WeakMap<object, AreaServerState3D>();
const SERVER_SHAPES = new Map<bigint, ServerShape3D>();
const FREED_SHAPE_RIDS = new Set<bigint>();

function allocateRid(): GodotRid {
  const id = godotGlobalCall<number>('rid_allocate_id', []);
  return godotGlobalCall('rid_from_int64', [id]);
}

function areaInWorld(options: PhysicsServerArea3DOptions, rid: GodotRid): PhysicsArea3DRegistration {
  const area = physicsArea3DOfRid(rid);
  if (area.world !== options.world) throw new Error('PhysicsServer3D Area RID belongs to a different registered native space');
  for (const group of area.shapes) for (const collider of group) {
    const owner = options.areas.get(collider);
    if ((owner?.area ?? owner?.node) !== area.node) throw new Error('PhysicsServer3D Area RID is absent from the native Area sensor registry');
  }
  return area;
}

function sensors(area: PhysicsArea3DRegistration): RAPIER.Collider[] {
  return area.shapes.flatMap((group) => [...group]);
}

function state(options: PhysicsServerArea3DOptions, area: PhysicsArea3DRegistration): AreaServerState3D {
  let current = SERVER_STATE.get(area.node);
  if (current !== undefined) return current;
  const first = sensors(area)[0];
  current = {
    layer: first === undefined ? 1 : options.layers.layerOf(first),
    mask: first === undefined ? 1 : options.layers.maskOf(first),
    rayPickable: true,
    monitoring: createAreaMonitoring3D(),
    gravityOverrideMode: 0,
    linearDampOverrideMode: 0,
    angularDampOverrideMode: 0,
    gravity: 9.8,
    gravityVector: vec3(0, -1, 0),
    gravityIsPoint: false,
    gravityPointUnitDistance: 0,
    gravityPointAttenuation: 1,
    linearDamp: 0.1,
    angularDamp: 0.1,
    priority: 0,
    windForceMagnitude: 0,
    windSource: vec3(0, 0, 0),
    windDirection: vec3(1, 0, 0),
    windAttenuationFactor: 0,
    shapeRids: [],
  };
  SERVER_STATE.set(area.node, current);
  return current;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${member} must be finite`);
  return value;
}

function finiteVector(value: unknown, member: string): Vector3 {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) throw new TypeError(`${member} must be a Vector3`);
  const point = value as { readonly x: unknown; readonly y: unknown; readonly z: unknown };
  return vec3(finite(point.x, `${member}.x`), finite(point.y, `${member}.y`), finite(point.z, `${member}.z`));
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} must be boolean`);
  return value;
}

function uint32(value: number, member: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`${member} must be a uint32`);
  return value;
}

function shapeRid(value: unknown): GodotRid {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'bigint') throw new TypeError('PhysicsServer3D Shape RID must be an actual Godot RID value');
  return value as GodotRid;
}

function serverShape(value: unknown, godotMajor?: 3 | 4): ServerShape3D {
  const rid = shapeRid(value);
  if (FREED_SHAPE_RIDS.has(rid.id)) throw new Error('PhysicsServer3D Shape RID has been freed');
  let result = SERVER_SHAPES.get(rid.id);
  if (result === undefined) {
    const resource = godotResourceOfRid(rid);
    if (resource !== undefined && 'type' in resource) {
      const spec = resource as Partial<ColliderAttachShape>;
      if (godotMajor === undefined) throw new Error('PhysicsServer3D Shape3D resource RID requires its authored Godot dialect at the native boundary');
      if (spec.type === 'sphere') result = { type: 2, godotMajor, data: spec.radius, sourceData: spec.radius, margin: 0.04, refs: 0 };
      else if (spec.type === 'box' && spec.halfExtents !== undefined) {
        const extents = finiteVector(spec.halfExtents, 'BoxShape3D half-extents');
        result = { type: 3, godotMajor, data: extents, sourceData: vec3(extents.x, extents.y, extents.z), margin: 0.04, refs: 0 };
      } else if (spec.type === 'capsule') {
        const radius = finite(spec.radius, 'CapsuleShape3D radius');
        const midHeight = finite(spec.height, 'CapsuleShape3D mid height');
        const sourceHeight = godotMajor === 3 ? midHeight : midHeight + radius * 2;
        result = { type: 4, godotMajor, data: { sourceHeight, midHeight, radius }, sourceData: godotDictionary([['height', sourceHeight], ['radius', radius]]), margin: 0.04, refs: 0 };
      } else if (spec.type === 'cylinder') {
        const height = finite(spec.height, 'CylinderShape3D height');
        const radius = finite(spec.radius, 'CylinderShape3D radius');
        result = { type: 5, godotMajor, data: { height, radius }, sourceData: godotDictionary([['height', height], ['radius', radius]]), margin: 0.04, refs: 0 };
      } else if (spec.type === 'trimesh' && spec.vertices !== undefined) {
        const faces = vectorPoints(spec.vertices, 'ConcavePolygonShape3D faces');
        result = { type: 7, godotMajor, data: { faces, backfaceCollision: false }, sourceData: godotDictionary([['faces', copyPoints(faces)], ['backface_collision', false]]), margin: 0.04, refs: 0 };
      }
      if (result !== undefined) SERVER_SHAPES.set(rid.id, result);
    }
    if (resource !== undefined && result === undefined) throw new Error('PhysicsServer3D Shape3D resource RID has no native Rapier shape representation');
    if (result === undefined) throw new Error('PhysicsServer3D Shape RID does not name a live registered native 3D shape');
  }
  if (godotMajor !== undefined && result.godotMajor !== godotMajor) throw new Error(`PhysicsServer3D Shape RID belongs to Godot ${result.godotMajor}, not Godot ${godotMajor}`);
  return result;
}

function rigidPose(value: Transform): { readonly position: ThreeVector3; readonly rotation: Quaternion } {
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
  if (![position.x, position.y, position.z, rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite) || Math.abs(scale.x - 1) > 1e-6 || Math.abs(scale.y - 1) > 1e-6 || Math.abs(scale.z - 1) > 1e-6 || matrix.determinant() < 0) throw new Error('PhysicsServer3D Area Transform3D must be finite and rigid');
  return { position, rotation };
}

function transformOf(position: Readonly<Vector3>, rotation: Readonly<{ x: number; y: number; z: number; w: number }>): Transform {
  const matrix = new Matrix4().makeRotationFromQuaternion(new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
  const elements = matrix.elements;
  return transform3([
    vec3(elements[0], elements[1], elements[2]),
    vec3(elements[4], elements[5], elements[6]),
    vec3(elements[8], elements[9], elements[10]),
  ], vec3(position.x, position.y, position.z));
}

function shape(area: PhysicsArea3DRegistration, index: number): readonly RAPIER.Collider[] {
  if (!Number.isInteger(index) || index < 0 || index >= area.shapes.length) throw new RangeError(`PhysicsServer3D Area shape index ${String(index)} is outside the registered native Area`);
  return area.shapes[index] as readonly RAPIER.Collider[];
}

function values(value: unknown, member: string): unknown[] {
  if (Array.isArray(value)) return [...value];
  if (value instanceof Float32Array || value instanceof Float64Array || value instanceof Int32Array) return Array.from(value);
  throw new TypeError(`${member} must be an Array or packed array`);
}

function vectorPoints(value: unknown, member: string): Vector3[] {
  const input = values(value, member);
  if (input.length === 0) return [];
  if (typeof input[0] === 'number') {
    if (input.length % 3 !== 0) throw new Error(`${member} packed scalar count must be divisible by three`);
    const result: Vector3[] = [];
    for (let index = 0; index < input.length; index += 3) result.push(finiteVector({ x: input[index], y: input[index + 1], z: input[index + 2] }, member));
    return result;
  }
  return input.map((point) => finiteVector(point, member));
}

function dictionaryEntry(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) throw new TypeError('PhysicsServer3D shape data must be a Dictionary');
  if ('get' in value && typeof value.get === 'function') return (value as { get(key: string): unknown }).get(key);
  return Reflect.get(value, key);
}

function copyPoints(points: readonly Vector3[]): Vector3[] {
  return points.map((point) => vec3(point.x, point.y, point.z));
}

function shapeData(type: number, godotMajor: 3 | 4, value: unknown): unknown {
  if (type === 2) {
    const radius = finite(value, 'PhysicsServer3D sphere radius');
    if (radius < 0) throw new RangeError('PhysicsServer3D sphere radius must be non-negative');
    return radius;
  }
  if (type === 3) {
    const halfExtents = finiteVector(value, 'PhysicsServer3D box half-extents');
    if (halfExtents.x < 0 || halfExtents.y < 0 || halfExtents.z < 0) throw new RangeError('PhysicsServer3D box half-extents must be non-negative');
    return halfExtents;
  }
  if (type === 4 || type === 5) {
    const height = finite(dictionaryEntry(value, 'height'), 'PhysicsServer3D shape height');
    const radius = finite(dictionaryEntry(value, 'radius'), 'PhysicsServer3D shape radius');
    if (height < 0 || radius < 0) throw new RangeError('PhysicsServer3D shape height and radius must be non-negative');
    if (type === 4) return Object.freeze({ sourceHeight: height, midHeight: godotMajor === 3 ? height : Math.max(0, height - radius * 2), radius });
    return Object.freeze({ height, radius });
  }
  if (type === 6) {
    const points = vectorPoints(value, 'PhysicsServer3D convex polygon points');
    if (points.length < 4) throw new Error('PhysicsServer3D convex polygon requires at least four points');
    return points;
  }
  if (type === 7) {
    const facesValue = typeof value === 'object' && value !== null && (Reflect.has(value, 'faces') || ('get' in value && typeof value.get === 'function'))
      ? dictionaryEntry(value, 'faces')
      : value;
    const faces = vectorPoints(facesValue, 'PhysicsServer3D concave polygon faces');
    if (faces.length % 3 !== 0) throw new Error('PhysicsServer3D concave polygon faces must contain complete triangles');
    const backfaceValue = typeof value === 'object' && value !== null && (Reflect.has(value, 'backface_collision') || ('get' in value && typeof value.get === 'function'))
      ? dictionaryEntry(value, 'backface_collision')
      : false;
    const backfaceCollision = backfaceValue === undefined ? false : boolean(backfaceValue, 'PhysicsServer3D concave polygon backface_collision');
    if (backfaceCollision) throw new Error('PhysicsServer3D concave polygon backface_collision=true has no native one-sided Rapier trimesh equivalent');
    return Object.freeze({ faces, backfaceCollision });
  }
  if (type === 8) {
    const width = finite(dictionaryEntry(value, 'width'), 'PhysicsServer3D heightmap width');
    const depth = finite(dictionaryEntry(value, 'depth'), 'PhysicsServer3D heightmap depth');
    if (!Number.isInteger(width) || !Number.isInteger(depth) || width < 2 || depth < 2) throw new RangeError('PhysicsServer3D heightmap width and depth must be integers of at least two');
    const heights = values(dictionaryEntry(value, 'heights'), 'PhysicsServer3D heightmap heights').map((height) => finite(height, 'PhysicsServer3D heightmap height'));
    if (heights.length !== width * depth) throw new Error('PhysicsServer3D heightmap heights length must equal width * depth');
    const minValue = dictionaryEntry(value, 'min_height');
    const maxValue = dictionaryEntry(value, 'max_height');
    const minHeight = minValue === undefined ? Math.min(...heights) : finite(minValue, 'PhysicsServer3D heightmap min_height');
    const maxHeight = maxValue === undefined ? Math.max(...heights) : finite(maxValue, 'PhysicsServer3D heightmap max_height');
    return Object.freeze({ width, depth, heights, minHeight, maxHeight });
  }
  throw new Error(`PhysicsServer3D shape type ${String(type)} has no native Rapier Area sensor representation`);
}

function sourceShapeData(type: number, normalized: unknown): unknown {
  if (type === 2) return normalized;
  if (type === 3) {
    const point = normalized as Vector3;
    return vec3(point.x, point.y, point.z);
  }
  if (type === 4 || type === 5) {
    const pair = normalized as { readonly height?: number; readonly sourceHeight?: number; readonly radius: number };
    return godotDictionary([['height', type === 4 ? pair.sourceHeight : pair.height], ['radius', pair.radius]]);
  }
  if (type === 6) return copyPoints(normalized as readonly Vector3[]);
  if (type === 7) {
    const concave = normalized as { readonly faces: readonly Vector3[]; readonly backfaceCollision: boolean };
    return godotDictionary([['faces', copyPoints(concave.faces)], ['backface_collision', concave.backfaceCollision]]);
  }
  const map = normalized as { readonly width: number; readonly depth: number; readonly heights: readonly number[]; readonly minHeight: number; readonly maxHeight: number };
  return godotDictionary([['width', map.width], ['depth', map.depth], ['heights', new Float32Array(map.heights)], ['min_height', map.minHeight], ['max_height', map.maxHeight]]);
}

function descriptorOf(current: ServerShape3D): RAPIER.ColliderDesc {
  if (current.data === undefined) throw new Error('PhysicsServer3D Shape RID has no data; call shape_set_data before attaching it to an Area');
  let descriptor: RAPIER.ColliderDesc | null;
  if (current.type === 2) descriptor = RAPIER.ColliderDesc.ball(current.data as number);
  else if (current.type === 3) {
    const extents = current.data as Vector3;
    descriptor = RAPIER.ColliderDesc.cuboid(extents.x, extents.y, extents.z);
  } else if (current.type === 4) {
    const capsule = current.data as { readonly midHeight: number; readonly radius: number };
    descriptor = RAPIER.ColliderDesc.capsule(capsule.midHeight / 2, capsule.radius);
  } else if (current.type === 5) {
    const cylinder = current.data as { readonly height: number; readonly radius: number };
    descriptor = RAPIER.ColliderDesc.cylinder(cylinder.height / 2, cylinder.radius);
  } else if (current.type === 6) {
    const vertices = new Float32Array((current.data as readonly Vector3[]).flatMap((point) => [point.x, point.y, point.z]));
    descriptor = RAPIER.ColliderDesc.convexHull(vertices);
  } else if (current.type === 7) {
    const faces = (current.data as { readonly faces: readonly Vector3[] }).faces;
    const vertices = new Float32Array(faces.flatMap((point) => [point.x, point.y, point.z]));
    const indices = new Uint32Array(faces.length);
    for (let index = 0; index < indices.length; index += 1) indices[index] = index;
    descriptor = RAPIER.ColliderDesc.trimesh(vertices, indices);
  } else {
    const map = current.data as { readonly width: number; readonly depth: number; readonly heights: readonly number[] };
    descriptor = RAPIER.ColliderDesc.heightfield(map.depth - 1, map.width - 1, new Float32Array(map.heights), { x: 1, y: 1, z: 1 });
  }
  if (descriptor === null) throw new Error('Rapier rejected PhysicsServer3D shape data');
  if (current.margin !== 0) descriptor.setContactSkin(current.margin);
  return descriptor;
}

export function physicsServerShapeCreate3D(godotMajor: 3 | 4, type: number): GodotRid {
  if (!Number.isInteger(type) || type < 2 || type > 8) throw new Error(`PhysicsServer3D shape type ${String(type)} is unsupported; native Area sensors support sphere, box, capsule, cylinder, convex, concave, and heightmap shapes`);
  const rid = allocateRid();
  FREED_SHAPE_RIDS.delete(rid.id);
  SERVER_SHAPES.set(rid.id, { type, godotMajor, data: undefined, sourceData: undefined, margin: 0.04, refs: 0 });
  return rid;
}

export function physicsServerShapeSetData3D(godotMajor: 3 | 4, rid: GodotRid, value: unknown): void {
  const current = serverShape(rid, godotMajor);
  if (current.refs !== 0) throw new Error('PhysicsServer3D.shape_set_data cannot change an attached Shape RID without rebuilding its live native Area sensors; detach it first');
  const normalized = shapeData(current.type, godotMajor, value);
  current.data = normalized;
  current.sourceData = sourceShapeData(current.type, normalized);
}

export function physicsServerShapeGetData3D(godotMajor: 3 | 4, rid: GodotRid): unknown {
  const current = serverShape(rid, godotMajor);
  return current.sourceData === undefined ? undefined : sourceShapeData(current.type, current.data);
}

export function physicsServerShapeGetType3D(godotMajor: 3 | 4, rid: GodotRid): number { return serverShape(rid, godotMajor).type; }

export function physicsServerShapeSetMargin3D(godotMajor: 3 | 4, rid: GodotRid, margin: number): void {
  const current = serverShape(rid, godotMajor);
  if (current.refs !== 0) throw new Error('PhysicsServer3D.shape_set_margin cannot change an attached Shape RID without rebuilding its live native Area sensors; detach it first');
  const next = finite(margin, 'PhysicsServer3D Shape margin');
  if (next < 0) throw new RangeError('PhysicsServer3D Shape margin cannot be negative in the native Rapier representation');
  current.margin = next;
}

export function physicsServerShapeGetMargin3D(godotMajor: 3 | 4, rid: GodotRid): number { return serverShape(rid, godotMajor).margin; }

/** Resolve a registered Shape RID for direct-space queries without exposing its server metadata. */
export function physicsServerShapeNative3D(godotMajor: 3 | 4, rid: GodotRid): RAPIER.Shape {
  return descriptorOf(serverShape(rid, godotMajor)).shape;
}

export function physicsServerUnsupportedShapeCreate3D(member: string): never {
  throw new Error(`${member} has no native Rapier Area sensor representation`);
}

function identityTransform(): Transform {
  return transform3([vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)], vec3(0, 0, 0));
}

function areaShapeCollider(
  options: PhysicsServerArea3DOptions,
  area: PhysicsArea3DRegistration,
  godotMajor: 3 | 4,
  rid: GodotRid,
  transform: Transform,
  disabled: boolean,
): RAPIER.Collider {
  if (typeof disabled !== 'boolean') throw new TypeError('PhysicsServer3D Area shape disabled state must be boolean');
  const pose = rigidPose(transform);
  const descriptor = descriptorOf(serverShape(rid, godotMajor))
    .setSensor(true)
    .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL)
    .setTranslation(pose.position.x, pose.position.y, pose.position.z)
    .setRotation(pose.rotation)
    .setEnabled(!disabled);
  const collider = options.world.createCollider(descriptor, area.body);
  const current = state(options, area);
  options.layers.setLayer(collider, current.layer);
  options.layers.setMask(collider, current.mask);
  options.areas.set(collider, { area: area.node });
  return collider;
}

export function physicsServerAreaCreate3D(options: PhysicsServerArea3DOptions): GodotRid {
  const node = {};
  const body = options.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  try {
    return registerPhysicsArea3D({ node, sceneOwned: false, world: options.world, body, shapes: [] });
  } catch (error) {
    options.world.removeRigidBody(body);
    throw error;
  }
}

/** Runtime Godot 3 `Area.new()` over the existing PhysicsServer3D/Rapier carrier. */
export function createGodotArea3D(options: PhysicsServerArea3DOptions): Object3D {
  const node = new Object3D();
  registerGodotObjectIdentity(node, 'Area');
  const body = options.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  try {
    registerPhysicsArea3D({ node, sceneOwned: false, world: options.world, body, shapes: [] });
    registerGodotThreeNodeRelease(node, () => {
      unregisterPhysicsArea3D(node);
      options.world.removeRigidBody(body);
    });
    return node;
  } catch (error) {
    options.world.removeRigidBody(body);
    throw error;
  }
}

export function physicsServerAreaFree3D(options: PhysicsServerArea3DOptions, rid: GodotRid): void {
  const area = areaInWorld(options, rid);
  if (area.sceneOwned) throw new Error('PhysicsServer3D.free_rid cannot free a scene-owned retained Area3D independently of its native scene lifecycle');
  const current = state(options, area);
  if (current.shapeRids.length !== area.shapes.length) throw new Error('PhysicsServer3D server-owned Area shape/RID registry is inconsistent');
  for (const retainedRid of current.shapeRids) serverShape(retainedRid).refs -= 1;
  current.shapeRids.length = 0;
  for (const collider of sensors(area)) options.areas.delete(collider);
  unregisterPhysicsArea3D(area.node);
  options.world.removeRigidBody(area.body);
}

export function physicsServerFreeRid3D(options: PhysicsServerArea3DOptions, godotMajor: 3 | 4, ridValue: GodotRid): void {
  const rid = shapeRid(ridValue);
  let current = SERVER_SHAPES.get(rid.id);
  if (current === undefined && godotResourceOfRid(rid) !== undefined) current = serverShape(rid, godotMajor);
  if (current !== undefined) {
    if (current.refs !== 0) throw new Error('PhysicsServer3D.free_rid cannot free a Shape RID while a server-owned Area still references it');
    SERVER_SHAPES.delete(rid.id);
    FREED_SHAPE_RIDS.add(rid.id);
    return;
  }
  physicsServerAreaFree3D(options, rid);
}

export function physicsServerAreaGetRid3D(node: object): GodotRid { return physicsAreaRid3DOf(node); }

export function registerScenePhysicsArea3D(
  options: PhysicsServerArea3DOptions,
  node: object,
  body: RAPIER.RigidBody,
  shapes: RAPIER.Collider[][],
): GodotRid {
  for (const group of shapes) for (const collider of group) options.areas.set(collider, { area: node, node });
  try {
    return registerPhysicsArea3D({ node, sceneOwned: true, world: options.world, body, shapes });
  } catch (error) {
    for (const group of shapes) for (const collider of group) options.areas.delete(collider);
    throw error;
  }
}

export function unregisterScenePhysicsArea3D(options: PhysicsServerArea3DOptions, node: object): void {
  const rid = physicsAreaRid3DOf(node);
  const area = areaInWorld(options, rid);
  if (!area.sceneOwned) throw new Error('PhysicsServer3D scene Area release received a server-owned Area RID');
  for (const collider of sensors(area)) options.areas.delete(collider);
  unregisterPhysicsArea3D(node);
}

export function bindPhysicsServerArea3DAuthoredState(
  options: PhysicsServerArea3DOptions,
  node: object,
  authored: PhysicsServerArea3DAuthoredState,
): void {
  const area = areaInWorld(options, physicsAreaRid3DOf(node));
  const current = state(options, area);
  if (authored.monitoring !== undefined) setMonitoring3D(current.monitoring, boolean(authored.monitoring, 'Area3D.monitoring'));
  if (authored.monitorable !== undefined) setMonitorable3D(current.monitoring, boolean(authored.monitorable, 'Area3D.monitorable'));
  if (authored.rayPickable !== undefined) current.rayPickable = boolean(authored.rayPickable, 'Area3D.input_ray_pickable');
  for (const [member, mode] of [
    ['space_override', authored.overrideMode],
    ['gravity_space_override', authored.gravityOverrideMode],
    ['linear_damp_space_override', authored.linearDampOverrideMode],
    ['angular_damp_space_override', authored.angularDampOverrideMode],
  ] as const) if (mode !== undefined && mode !== 0) throw new Error(`Area3D.${member}=${String(mode)} requires a native Area force field unavailable in Rapier`);
  if (authored.gravity !== undefined) current.gravity = finite(authored.gravity, 'Area3D.gravity');
  if (authored.gravityVector !== undefined) current.gravityVector = finiteVector(authored.gravityVector, 'Area3D.gravity_direction');
  if (authored.gravityIsPoint !== undefined) current.gravityIsPoint = boolean(authored.gravityIsPoint, 'Area3D.gravity_point');
  if (authored.gravityPointUnitDistance !== undefined) current.gravityPointUnitDistance = finite(authored.gravityPointUnitDistance, 'Area3D.gravity_point_unit_distance');
  if (authored.gravityPointAttenuation !== undefined) current.gravityPointAttenuation = finite(authored.gravityPointAttenuation, 'Area3D.gravity_point_attenuation');
  if (authored.linearDamp !== undefined) current.linearDamp = finite(authored.linearDamp, 'Area3D.linear_damp');
  if (authored.angularDamp !== undefined) current.angularDamp = finite(authored.angularDamp, 'Area3D.angular_damp');
  if (authored.priority !== undefined) current.priority = finite(authored.priority, 'Area3D.priority');
}

export function physicsServerAreaGetSpace3D(options: PhysicsServerArea3DOptions, rid: GodotRid): GodotRid {
  areaInWorld(options, rid);
  return physicsSpaceRid3D(options.world);
}

export function physicsServerAreaSetSpace3D(options: PhysicsServerArea3DOptions, rid: GodotRid, space: GodotRid): void {
  areaInWorld(options, rid);
  if (physicsWorld3DOfRid(space) !== options.world) throw new Error('PhysicsServer3D.area_set_space cannot migrate live native Area sensors between Rapier worlds');
}

export function physicsServerAreaGetCollisionLayer3D(options: PhysicsServerArea3DOptions, rid: GodotRid): number {
  const area = areaInWorld(options, rid);
  const current = state(options, area);
  const first = sensors(area)[0];
  if (first !== undefined) current.layer = options.layers.layerOf(first);
  return current.layer;
}

export function physicsServerAreaSetCollisionLayer3D(options: PhysicsServerArea3DOptions, rid: GodotRid, layer: number): void {
  const area = areaInWorld(options, rid);
  const next = uint32(layer, 'PhysicsServer3D Area collision layer');
  state(options, area).layer = next;
  for (const collider of sensors(area)) options.layers.setLayer(collider, next);
}

export function physicsServerAreaGetCollisionMask3D(options: PhysicsServerArea3DOptions, rid: GodotRid): number {
  const area = areaInWorld(options, rid);
  const current = state(options, area);
  const first = sensors(area)[0];
  if (first !== undefined) current.mask = options.layers.maskOf(first);
  return current.mask;
}

export function physicsServerAreaSetCollisionMask3D(options: PhysicsServerArea3DOptions, rid: GodotRid, mask: number): void {
  const area = areaInWorld(options, rid);
  const next = uint32(mask, 'PhysicsServer3D Area collision mask');
  state(options, area).mask = next;
  for (const collider of sensors(area)) options.layers.setMask(collider, next);
}

function instanceId(value: unknown, member: string): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new TypeError(`${member} must be a non-negative Godot object instance ID`);
}

export function physicsServerAreaAttachObjectInstanceId3D(options: PhysicsServerArea3DOptions, rid: GodotRid, id: number | bigint): void {
  const area = areaInWorld(options, rid);
  const next = instanceId(id, 'PhysicsServer3D Area object instance ID');
  state(options, area).objectId = next;
  setPhysicsAreaObjectInstanceId3D(area.node, next);
}

export function physicsServerAreaGetObjectInstanceId3D(options: PhysicsServerArea3DOptions, rid: GodotRid): bigint {
  const area = areaInWorld(options, rid);
  return state(options, area).objectId ?? (area.sceneOwned ? godotObjectInstanceId(area.node) : 0n);
}

export function physicsServerAreaSetMonitorable3D(options: PhysicsServerArea3DOptions, rid: GodotRid, value: boolean): void {
  const area = areaInWorld(options, rid);
  setMonitorable3D(state(options, area).monitoring, boolean(value, 'PhysicsServer3D Area monitorable'));
}

export function physicsServerAreaIsMonitorable3D(options: PhysicsServerArea3DOptions, rid: GodotRid): boolean {
  return isMonitorable3D(state(options, areaInWorld(options, rid)).monitoring);
}

export function physicsServerAreaSetMonitoring3D(options: PhysicsServerArea3DOptions, rid: GodotRid, value: boolean): void {
  const current = state(options, areaInWorld(options, rid));
  setMonitoring3D(current.monitoring, boolean(value, 'PhysicsServer3D Area monitoring'));
}

export function physicsServerAreaIsMonitoring3D(options: PhysicsServerArea3DOptions, rid: GodotRid): boolean {
  return isMonitoring3D(state(options, areaInWorld(options, rid)).monitoring);
}

/**
 * The live Area-to-Area overlap set used by `area_entered`/`area_exited` dispatch. The asking
 * Area's `monitoring` gates the entire query, while each candidate Area's independent
 * `monitorable` flag gates only that candidate. Both sides remain real enabled Rapier sensors;
 * changing either flag never fabricates or disables a collider.
 */
export function physicsServerAreaOverlappingAreas3D<T extends object>(
  options: PhysicsServerArea3DOptions,
  rid: GodotRid,
): T[] {
  const askingArea = areaInWorld(options, rid);
  if (!isMonitoring3D(state(options, askingArea).monitoring)) return [];
  const askingSensors = sensors(askingArea).filter((collider) => collider.isEnabled());
  if (askingSensors.length === 0) return [];
  const ownSensors = new Set(askingSensors);
  const result = new Set<T>();
  for (const sensor of askingSensors) {
    options.world.intersectionsWithShape(
      sensor.translation(),
      sensor.rotation(),
      sensor.shape,
      (candidate) => {
        if (ownSensors.has(candidate) || !candidate.isEnabled()) return true;
        const owner = options.areas.get(candidate);
        if (owner === undefined) return true;
        const candidateNode = owner.area ?? owner.node;
        if (candidateNode === undefined || candidateNode === askingArea.node) return true;
        let candidateArea: PhysicsArea3DRegistration;
        try {
          candidateArea = physicsArea3DOfRid(physicsAreaRid3DOf(candidateNode));
        } catch (cause) {
          throw new Error('Area overlap registry contains a collider without a live retained Area3D binding', { cause });
        }
        if (candidateArea.world !== options.world) {
          throw new Error('Area overlap registry contains a collider bound to a different native Rapier world');
        }
        if ((options.layers.layerOf(candidate) & options.layers.maskOf(sensor)) === 0) return true;
        if (!isMonitorable3D(state(options, candidateArea).monitoring)) return true;
        result.add(candidateNode as T);
        return true;
      },
    );
  }
  return [...result];
}

/** Script-facing Area.get_overlapping_areas, including Godot's monitoring precondition. */
export function physicsServerAreaGetOverlappingAreas3D<T extends object>(
  options: PhysicsServerArea3DOptions,
  rid: GodotRid,
): T[] {
  const area = areaInWorld(options, rid);
  if (!isMonitoring3D(state(options, area).monitoring)) {
    throw new Error("Area.get_overlapping_areas(): Can't find overlapping areas when monitoring is off.");
  }
  return physicsServerAreaOverlappingAreas3D<T>(options, rid);
}

export function physicsServerAreaSetMonitorCallback3D(options: PhysicsServerArea3DOptions, rid: GodotRid): never {
  areaInWorld(options, rid);
  throw new Error('PhysicsServer3D.area_set_monitor_callback cannot install a Godot server callback into the retained Area3D monitor');
}

export function physicsServerAreaSetAreaMonitorCallback3D(options: PhysicsServerArea3DOptions, rid: GodotRid): never {
  areaInWorld(options, rid);
  throw new Error('PhysicsServer3D.area_set_area_monitor_callback cannot install a Godot server callback into the retained Area3D monitor');
}

export function physicsServerAreaSetRayPickable3D(options: PhysicsServerArea3DOptions, rid: GodotRid, enable: boolean): void {
  const area = areaInWorld(options, rid);
  const pickable = boolean(enable, 'PhysicsServer3D Area ray pickable');
  state(options, area).rayPickable = pickable;
}

export function physicsServerAreaIsRayPickable3D(options: PhysicsServerArea3DOptions, rid: GodotRid): boolean {
  return state(options, areaInWorld(options, rid)).rayPickable;
}

export function physicsServerAreaGetShapeCount3D(options: PhysicsServerArea3DOptions, rid: GodotRid): number {
  return areaInWorld(options, rid).shapes.length;
}

export function physicsServerAreaGetShape3D(options: PhysicsServerArea3DOptions, rid: GodotRid, index: number): GodotRid {
  const area = areaInWorld(options, rid);
  shape(area, index);
  if (area.sceneOwned) throw new Error('PhysicsServer3D.area_get_shape cannot fabricate a Shape3D RID for a scene-authored native Rapier sensor');
  const result = state(options, area).shapeRids[index];
  if (result === undefined) throw new Error('PhysicsServer3D server-owned Area shape is missing its registered Shape3D RID');
  return result;
}

export function physicsServerAreaGetShapeTransform3D(options: PhysicsServerArea3DOptions, rid: GodotRid, index: number): Transform {
  const area = areaInWorld(options, rid);
  const collider = shape(area, index)[0];
  if (collider === undefined) return identityTransform();
  const bodyPosition = area.body.translation();
  const bodyRotationValue = area.body.rotation();
  const bodyRotation = new Quaternion(bodyRotationValue.x, bodyRotationValue.y, bodyRotationValue.z, bodyRotationValue.w);
  const inverseBody = bodyRotation.clone().invert();
  const worldPositionValue = collider.translation();
  const localPosition = new ThreeVector3(
    worldPositionValue.x - bodyPosition.x,
    worldPositionValue.y - bodyPosition.y,
    worldPositionValue.z - bodyPosition.z,
  ).applyQuaternion(inverseBody);
  const worldRotation = collider.rotation();
  const localRotation = inverseBody.multiply(new Quaternion(worldRotation.x, worldRotation.y, worldRotation.z, worldRotation.w));
  return transformOf(localPosition, localRotation);
}

export function physicsServerAreaSetShapeTransform3D(options: PhysicsServerArea3DOptions, rid: GodotRid, index: number, transform: Transform): void {
  const pose = rigidPose(transform);
  for (const collider of shape(areaInWorld(options, rid), index)) {
    collider.setTranslationWrtParent(pose.position);
    collider.setRotationWrtParent(pose.rotation);
  }
}

export function physicsServerAreaSetShapeDisabled3D(options: PhysicsServerArea3DOptions, rid: GodotRid, index: number, disabled: boolean): void {
  const next = boolean(disabled, 'PhysicsServer3D Area shape disabled state');
  for (const collider of shape(areaInWorld(options, rid), index)) collider.setEnabled(!next);
}

export function physicsServerAreaGetTransform3D(options: PhysicsServerArea3DOptions, rid: GodotRid): Transform {
  const body = areaInWorld(options, rid).body;
  return transformOf(body.translation(), body.rotation());
}

export function physicsServerAreaSetTransform3D(options: PhysicsServerArea3DOptions, rid: GodotRid, transform: Transform): void {
  const body = areaInWorld(options, rid).body;
  const pose = rigidPose(transform);
  body.setTranslation(pose.position, true);
  body.setRotation(pose.rotation, true);
}

export function physicsServerAreaAddShape3D(
  options: PhysicsServerArea3DOptions,
  godotMajor: 3 | 4,
  rid: GodotRid,
  shapeRidValue: GodotRid,
  transform: Transform = identityTransform(),
  disabled = false,
): void {
  const area = areaInWorld(options, rid);
  if (area.sceneOwned) throw new Error('PhysicsServer3D.area_add_shape cannot structurally extend a scene-authored Area3D');
  const nextRid = shapeRid(shapeRidValue);
  const nextShape = serverShape(nextRid, godotMajor);
  const collider = areaShapeCollider(options, area, godotMajor, nextRid, transform, disabled);
  try {
    replacePhysicsArea3DShapes(area.node, [...area.shapes.map((group) => [...group]), [collider]]);
  } catch (error) {
    options.areas.delete(collider);
    options.world.removeCollider(collider, true);
    throw error;
  }
  nextShape.refs += 1;
  state(options, area).shapeRids.push(nextRid);
}

export function physicsServerAreaSetShape3D(options: PhysicsServerArea3DOptions, godotMajor: 3 | 4, rid: GodotRid, index: number, shapeRidValue: GodotRid): void {
  const area = areaInWorld(options, rid);
  const previousGroup = shape(area, index);
  if (area.sceneOwned) throw new Error('PhysicsServer3D.area_set_shape cannot structurally replace a scene-authored native Rapier sensor');
  const current = state(options, area);
  const previousRid = current.shapeRids[index];
  const previous = previousGroup[0];
  if (previousRid === undefined || previous === undefined) throw new Error('PhysicsServer3D server-owned Area shape registry is inconsistent');
  const nextRid = shapeRid(shapeRidValue);
  const nextShape = serverShape(nextRid, godotMajor);
  const transform = physicsServerAreaGetShapeTransform3D(options, rid, index);
  const collider = areaShapeCollider(options, area, godotMajor, nextRid, transform, !previous.isEnabled());
  try {
    replacePhysicsArea3DShapes(area.node, area.shapes.map((group, groupIndex) => groupIndex === index ? [collider] : [...group]));
  } catch (error) {
    options.areas.delete(collider);
    options.world.removeCollider(collider, true);
    throw error;
  }
  serverShape(previousRid).refs -= 1;
  nextShape.refs += 1;
  current.shapeRids[index] = nextRid;
  for (const old of previousGroup) {
    options.areas.delete(old);
    options.world.removeCollider(old, true);
  }
}

export function physicsServerAreaRemoveShape3D(options: PhysicsServerArea3DOptions, rid: GodotRid, index: number): void {
  const area = areaInWorld(options, rid);
  const group = shape(area, index);
  if (area.sceneOwned) throw new Error('PhysicsServer3D.area_remove_shape cannot remove a scene-authored native Rapier sensor independently of its authored shape node');
  const current = state(options, area);
  const retainedRid = current.shapeRids[index];
  if (retainedRid === undefined) throw new Error('PhysicsServer3D server-owned Area shape is missing its retained Shape RID');
  replacePhysicsArea3DShapes(area.node, area.shapes.filter((_group, groupIndex) => groupIndex !== index).map((one) => [...one]));
  current.shapeRids.splice(index, 1);
  serverShape(retainedRid).refs -= 1;
  for (const collider of group) {
    options.areas.delete(collider);
    options.world.removeCollider(collider, true);
  }
}

export function physicsServerAreaClearShapes3D(options: PhysicsServerArea3DOptions, rid: GodotRid): void {
  const area = areaInWorld(options, rid);
  if (area.sceneOwned) throw new Error('PhysicsServer3D.area_clear_shapes cannot remove scene-authored native Rapier sensors independently of their authored shape nodes');
  const current = state(options, area);
  if (current.shapeRids.length !== area.shapes.length) throw new Error('PhysicsServer3D server-owned Area shape/RID registry is inconsistent');
  const groups = area.shapes.map((group) => [...group]);
  replacePhysicsArea3DShapes(area.node, []);
  for (const retainedRid of current.shapeRids) serverShape(retainedRid).refs -= 1;
  current.shapeRids.length = 0;
  for (const group of groups) for (const collider of group) {
    options.areas.delete(collider);
    options.world.removeCollider(collider, true);
  }
}

export function physicsServerAreaSetSpaceOverrideMode3D(options: PhysicsServerArea3DOptions, rid: GodotRid, mode: number): void {
  const current = state(options, areaInWorld(options, rid));
  if (!Number.isInteger(mode) || mode < 0 || mode > 4) throw new RangeError(`PhysicsServer3D Area space override mode ${String(mode)} is outside AreaSpaceOverrideMode`);
  if (mode !== 0) throw new Error('PhysicsServer3D non-disabled Area space override mode requires a native gravity/damping force field unavailable in Rapier');
  current.gravityOverrideMode = mode;
}

export function physicsServerAreaGetSpaceOverrideMode3D(options: PhysicsServerArea3DOptions, rid: GodotRid): number {
  return state(options, areaInWorld(options, rid)).gravityOverrideMode;
}

export function physicsServerAreaSetParam3D(options: PhysicsServerArea3DOptions, major: 3 | 4, rid: GodotRid, parameter: number, value: unknown): void {
  if (!Number.isInteger(parameter)) throw new RangeError('PhysicsServer3D Area parameter must be an integer');
  const current = state(options, areaInWorld(options, rid));
  if (major === 3) {
    if (parameter === 0) current.gravity = finite(value, 'PhysicsServer Area gravity');
    else if (parameter === 1) current.gravityVector = finiteVector(value, 'PhysicsServer Area gravity vector');
    else if (parameter === 2) current.gravityIsPoint = boolean(value, 'PhysicsServer Area gravity is point');
    else if (parameter === 3) current.gravityPointUnitDistance = finite(value, 'PhysicsServer Area gravity distance scale');
    else if (parameter === 4) current.gravityPointAttenuation = finite(value, 'PhysicsServer Area gravity point attenuation');
    else if (parameter === 5) current.linearDamp = finite(value, 'PhysicsServer Area linear damp');
    else if (parameter === 6) current.angularDamp = finite(value, 'PhysicsServer Area angular damp');
    else if (parameter === 7) current.priority = finite(value, 'PhysicsServer Area priority');
    else throw new RangeError(`PhysicsServer Area parameter ${String(parameter)} is outside AreaParameter`);
    return;
  }
  if (parameter === 0 || parameter === 5 || parameter === 7) {
    const mode = finite(value, 'PhysicsServer3D Area override mode');
    if (!Number.isInteger(mode) || mode < 0 || mode > 4) throw new RangeError(`PhysicsServer3D Area override mode ${String(mode)} is outside AreaSpaceOverrideMode`);
    if (mode !== 0) throw new Error('PhysicsServer3D non-disabled Area override modes require native gravity/damping force fields unavailable in Rapier');
    if (parameter === 0) current.gravityOverrideMode = mode;
    else if (parameter === 5) current.linearDampOverrideMode = mode;
    else current.angularDampOverrideMode = mode;
  } else if (parameter === 1) current.gravity = finite(value, 'PhysicsServer3D Area gravity');
  else if (parameter === 2) current.gravityVector = finiteVector(value, 'PhysicsServer3D Area gravity vector');
  else if (parameter === 3) current.gravityIsPoint = boolean(value, 'PhysicsServer3D Area gravity is point');
  else if (parameter === 4) current.gravityPointUnitDistance = finite(value, 'PhysicsServer3D Area gravity point unit distance');
  else if (parameter === 6) current.linearDamp = finite(value, 'PhysicsServer3D Area linear damp');
  else if (parameter === 8) current.angularDamp = finite(value, 'PhysicsServer3D Area angular damp');
  else if (parameter === 9) current.priority = finite(value, 'PhysicsServer3D Area priority');
  else if (parameter === 10) {
    const next = finite(value, 'PhysicsServer3D Area wind force magnitude');
    if (next !== 0) throw new Error('PhysicsServer3D Area wind force has no native Rapier force-field representation');
    current.windForceMagnitude = next;
  } else if (parameter === 11) {
    const next = finiteVector(value, 'PhysicsServer3D Area wind source');
    if (next.x !== 0 || next.y !== 0 || next.z !== 0) throw new Error('PhysicsServer3D Area wind source has no native Rapier force-field representation');
    current.windSource = next;
  } else if (parameter === 12) {
    const next = finiteVector(value, 'PhysicsServer3D Area wind direction');
    if (next.x !== 1 || next.y !== 0 || next.z !== 0) throw new Error('PhysicsServer3D Area wind direction has no native Rapier force-field representation');
    current.windDirection = next;
  } else if (parameter === 13) {
    const next = finite(value, 'PhysicsServer3D Area wind attenuation factor');
    if (next !== 0) throw new Error('PhysicsServer3D Area wind attenuation has no native Rapier force-field representation');
    current.windAttenuationFactor = next;
  } else throw new RangeError(`PhysicsServer3D Area parameter ${String(parameter)} is outside AreaParameter`);
}

export function physicsServerAreaGetParam3D(options: PhysicsServerArea3DOptions, major: 3 | 4, rid: GodotRid, parameter: number): unknown {
  const current = state(options, areaInWorld(options, rid));
  const valuesByDialect = major === 3
    ? [current.gravity, current.gravityVector, current.gravityIsPoint, current.gravityPointUnitDistance, current.gravityPointAttenuation, current.linearDamp, current.angularDamp, current.priority]
    : [current.gravityOverrideMode, current.gravity, current.gravityVector, current.gravityIsPoint, current.gravityPointUnitDistance, current.linearDampOverrideMode, current.linearDamp, current.angularDampOverrideMode, current.angularDamp, current.priority, current.windForceMagnitude, current.windSource, current.windDirection, current.windAttenuationFactor];
  if (!Number.isInteger(parameter) || parameter < 0 || parameter >= valuesByDialect.length) throw new RangeError(`PhysicsServer3D Area parameter ${String(parameter)} is outside AreaParameter`);
  const result = valuesByDialect[parameter];
  return typeof result === 'object' && result !== null && 'x' in result ? vec3((result as Vector3).x, (result as Vector3).y, (result as Vector3).z) : result;
}
