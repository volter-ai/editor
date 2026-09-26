/**
 * MeshInstance.mesh over the retained Three Mesh and BufferGeometry identities.
 *
 * A translated MeshInstance already IS a THREE.Mesh and its authored Mesh resource already IS the
 * BufferGeometry it draws. This module only exposes Godot's property name and seats the native
 * geometry in the shared Resource lifecycle so `mesh.duplicate()` returns an independent native
 * geometry without inventing another mesh representation.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Box3,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SkinnedMesh,
  Vector3,
  Object3D,
} from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { aabb, type GodotAabb } from './aabb';
import {
  bindGodotResourceProtocol,
  godotResourceEmitChanged,
  hasGodotResourceProtocol,
} from './resource-io';
import { registerGodotObjectIdentity } from './object';
import type { CollisionLayers } from './collision-layers';
import type { GodotColliderOwner, GodotMutableColliderRegistry } from './collider-registry';
import { registerGodotThreeNodeRelease } from './node-3d';

export type GodotMeshInstance = Mesh | SkinnedMesh;

const MESH_RESOURCE = new WeakMap<GodotMeshInstance, BufferGeometry | null>();
const PRIVATE_EMPTY_GEOMETRY = new WeakMap<GodotMeshInstance, BufferGeometry>();
const SURFACE_MATERIALS = new WeakMap<GodotMeshInstance, Map<number, Material | null>>();
const BASE_SURFACE_MATERIALS = new WeakMap<GodotMeshInstance, readonly Material[]>();
const MESH_RESOURCE_MATERIALS = new WeakMap<BufferGeometry, readonly Material[]>();
const MESH_RESOURCE_OVERRIDES = new WeakMap<BufferGeometry, Map<number, Material | null>>();
const MESH_RESOURCE_SURFACE_ARRAYS = new WeakMap<BufferGeometry, unknown[][]>();
const MESH_RESOURCE_SURFACE_NAMES = new WeakMap<BufferGeometry, string[]>();
const MESH_RESOURCE_VIEWS = new WeakMap<BufferGeometry, Set<WeakRef<GodotMeshInstance>>>();
const MESH_RESOURCE_VIEW_REFS = new WeakMap<GodotMeshInstance, WeakRef<GodotMeshInstance>>();
// Godot renders a surface whose material slot is null with its engine fallback, not the material
// that occupied that slot before the write. One shared native material has the same immutable
// engine-owned lifetime as that fallback and is never disposed by a MeshInstance.
const DEFAULT_MESH_SURFACE_MATERIAL = new MeshStandardMaterial();
interface LiveMeshTrimeshCollision {
  readonly node: Mesh;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly sourceVertices: Float32Array;
  readonly indices: Uint32Array;
  basis: readonly number[];
}
const LIVE_MESH_TRIMESH_COLLISIONS = new Set<LiveMeshTrimeshCollision>();

function meshWorldBasis(node: Mesh): readonly number[] {
  const e = node.matrixWorld.elements;
  return [e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!];
}

function transformedTrimeshVertices(
  state: Pick<LiveMeshTrimeshCollision, 'sourceVertices' | 'basis'>,
): Float32Array {
  const transformed = state.sourceVertices.slice();
  const b = state.basis;
  for (let index = 0; index < transformed.length; index += 3) {
    const x = transformed[index]!;
    const y = transformed[index + 1]!;
    const z = transformed[index + 2]!;
    transformed[index] = b[0]! * x + b[3]! * y + b[6]! * z;
    transformed[index + 1] = b[1]! * x + b[4]! * y + b[7]! * z;
    transformed[index + 2] = b[2]! * x + b[5]! * y + b[8]! * z;
  }
  return transformed;
}

/** Bring runtime-created static trimeshes onto the current Three world transform before Rapier steps. */
export function syncMeshInstanceTrimeshCollisions(): void {
  for (const state of LIVE_MESH_TRIMESH_COLLISIONS) {
    state.node.updateWorldMatrix(true, false);
    const e = state.node.matrixWorld.elements;
    state.body.setTranslation({ x: e[12]!, y: e[13]!, z: e[14]! }, false);
    const basis = meshWorldBasis(state.node);
    if (basis.some((value, index) => value !== state.basis[index])) {
      state.basis = basis;
      state.collider.setShape(RAPIER.ColliderDesc.trimesh(transformedTrimeshVertices(state), state.indices).shape);
    }
  }
}

/** Surface materials retained with a native Mesh Resource, in Godot surface order. */
export function getGodotMeshResourceMaterials(geometry: BufferGeometry): readonly Material[] {
  const base = MESH_RESOURCE_MATERIALS.get(geometry) ?? [];
  const overrides = MESH_RESOURCE_OVERRIDES.get(geometry);
  const count = getGodotMeshResourceSurfaceCount(geometry);
  if (base.length === 0 && overrides === undefined) return [];
  return Array.from({ length: count }, (_, index) =>
    overrides?.has(index)
      ? overrides.get(index) ?? DEFAULT_MESH_SURFACE_MATERIAL
      : base[index] ?? base[0] ?? DEFAULT_MESH_SURFACE_MATERIAL,
  );
}

function seatMeshResourceMaterials(node: GodotMeshInstance, geometry: BufferGeometry): void {
  if (!MESH_RESOURCE_MATERIALS.has(geometry)) {
    MESH_RESOURCE_MATERIALS.set(
      geometry,
      Array.isArray(node.material) ? [...node.material] : [node.material],
    );
  }
  const views = MESH_RESOURCE_VIEWS.get(geometry) ?? new Set<WeakRef<GodotMeshInstance>>();
  let view = MESH_RESOURCE_VIEW_REFS.get(node);
  if (view === undefined) {
    view = new WeakRef(node);
    MESH_RESOURCE_VIEW_REFS.set(node, view);
  }
  views.add(view);
  MESH_RESOURCE_VIEWS.set(geometry, views);
}

function detachMeshResourceView(node: GodotMeshInstance): void {
  const prior = MESH_RESOURCE.get(node);
  const view = MESH_RESOURCE_VIEW_REFS.get(node);
  if (prior !== undefined && prior !== null && view !== undefined) {
    MESH_RESOURCE_VIEWS.get(prior)?.delete(view);
  }
}

function applyMeshResourceMaterials(node: GodotMeshInstance, geometry: BufferGeometry): void {
  const base = MESH_RESOURCE_MATERIALS.get(geometry) ?? [];
  const resource = MESH_RESOURCE_OVERRIDES.get(geometry);
  if (base.length === 0 && resource === undefined) return;
  const local = SURFACE_MATERIALS.get(node);
  const count = getGodotMeshResourceSurfaceCount(geometry);
  if (count === 0) return;
  const materials = Array.from({ length: count }, (_, index) => {
    const localMaterial = local?.get(index);
    if (localMaterial !== undefined && localMaterial !== null) return localMaterial;
    if (resource?.has(index)) return resource.get(index) ?? DEFAULT_MESH_SURFACE_MATERIAL;
    return base[index] ?? base[0]!;
  });
  node.material = materials.length === 1 ? materials[0]! : materials;
}

/** Clear all surface-owned metadata when a mutable mesh removes its native geometry surfaces. */
export function clearGodotMeshResourceSurfaces(value: unknown): void {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'clear_surfaces'));
  MESH_RESOURCE_MATERIALS.delete(geometry);
  MESH_RESOURCE_OVERRIDES.delete(geometry);
  MESH_RESOURCE_SURFACE_ARRAYS.delete(geometry);
  MESH_RESOURCE_SURFACE_NAMES.delete(geometry);
  refreshGodotMeshResourceViews(geometry);
}

export function createGodotMeshInstance(): Mesh {
  const geometry = new BufferGeometry();
  const node = new Mesh(geometry, new MeshBasicMaterial());
  registerGodotObjectIdentity(node, 'MeshInstance');
  // MeshInstance's Mesh Resource starts null. This private empty geometry is only Three's valid
  // renderer carrier until source assigns `mesh`; it is not a fabricated Godot Resource.
  PRIVATE_EMPTY_GEOMETRY.set(node, geometry);
  MESH_RESOURCE.set(node, null);
  return node;
}

export interface MeshTrimeshCollisionContext {
  readonly major: 3 | 4;
  readonly world: RAPIER.World;
  readonly colliders: GodotMutableColliderRegistry<RAPIER.Collider, GodotColliderOwner>;
  readonly layers: CollisionLayers;
}

/** MeshInstance.create_trimesh_collision over this Mesh's actual BufferGeometry and the world Rapier owns. */
export function createMeshInstanceTrimeshCollision(
  value: unknown,
  context: MeshTrimeshCollisionContext,
): void {
  const node = requireMeshInstance(value, 'create_trimesh_collision');
  if (node instanceof SkinnedMesh) {
    throw new Error('MeshInstance.create_trimesh_collision requires static BufferGeometry; a skinned mesh has pose-dependent vertices.');
  }
  const geometry = getMeshInstanceMesh(node);
  if (geometry === null) return;
  const position = geometry.getAttribute('position');
  if (position === undefined || position.itemSize !== 3 || position.count < 3) return;
  node.updateWorldMatrix(true, false);
  const world = node.matrixWorld.elements;
  const basis = meshWorldBasis(node);
  const sourceVertices = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    sourceVertices[index * 3] = position.getX(index);
    sourceVertices[index * 3 + 1] = position.getY(index);
    sourceVertices[index * 3 + 2] = position.getZ(index);
  }
  const sourceIndex = geometry.getIndex();
  const indices = sourceIndex === null
    ? Uint32Array.from({ length: position.count }, (_, index) => index)
    : Uint32Array.from({ length: sourceIndex.count }, (_, index) => sourceIndex.getX(index));
  if (indices.length < 3 || indices.length % 3 !== 0) {
    throw new Error('MeshInstance.create_trimesh_collision requires triangle-list BufferGeometry indices.');
  }
  const body = context.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(world[12]!, world[13]!, world[14]!),
  );
  let collider: RAPIER.Collider;
  try {
    collider = context.world.createCollider(
      RAPIER.ColliderDesc.trimesh(transformedTrimeshVertices({ sourceVertices, basis }), indices),
      body,
    );
  } catch (error) {
    context.world.removeRigidBody(body);
    throw error;
  }
  context.layers.set(collider, 1, 1);
  const staticBody = new Object3D();
  staticBody.name = `${node.name || 'MeshInstance'}_col`;
  registerGodotObjectIdentity(staticBody, context.major === 3 ? 'StaticBody' : 'StaticBody3D');
  node.add(staticBody);
  context.colliders.set(collider, { node: staticBody });
  const live: LiveMeshTrimeshCollision = {
    node,
    body,
    collider,
    sourceVertices,
    indices,
    basis,
  };
  LIVE_MESH_TRIMESH_COLLISIONS.add(live);
  registerGodotThreeNodeRelease(staticBody, () => {
    LIVE_MESH_TRIMESH_COLLISIONS.delete(live);
    context.colliders.delete(collider);
    context.world.removeRigidBody(body);
  });
}

/** Godot 3/4 `ArrayMesh.new()` as an empty mutable native Three Mesh resource. */
export function createGodotArrayMesh(): BufferGeometry {
  const geometry = new BufferGeometry();
  registerGodotObjectIdentity(geometry, 'ArrayMesh');
  return retainGodotMeshResource(geometry);
}

function requireMeshInstance(value: unknown, member: string): GodotMeshInstance {
  if (!(value instanceof Mesh) && !(value instanceof SkinnedMesh)) {
    throw new TypeError(`godot-compat: MeshInstance.${member} requires a retained THREE.Mesh.`);
  }
  return value;
}

function requireMeshResource(value: unknown, member: string): BufferGeometry {
  if (!(value instanceof BufferGeometry)) {
    throw new TypeError(
      `godot-compat: MeshInstance.${member} requires a native THREE.BufferGeometry Mesh resource.`,
    );
  }
  return value;
}

/** Seat a native geometry in Resource duplication exactly once and return the same identity. */
export function retainGodotMeshResource(geometry: BufferGeometry): BufferGeometry {
  if (hasGodotResourceProtocol(geometry as unknown)) return geometry;
  registerGodotObjectIdentity(geometry, 'Mesh');
  return bindGodotResourceProtocol(geometry, {
    createDuplicate(source) {
      const duplicate = retainGodotMeshResource(source.clone());
      const base = MESH_RESOURCE_MATERIALS.get(source);
      if (base !== undefined) MESH_RESOURCE_MATERIALS.set(duplicate, [...base]);
      const overrides = MESH_RESOURCE_OVERRIDES.get(source);
      if (overrides !== undefined) MESH_RESOURCE_OVERRIDES.set(duplicate, new Map(overrides));
      const arrays = MESH_RESOURCE_SURFACE_ARRAYS.get(source);
      if (arrays !== undefined) MESH_RESOURCE_SURFACE_ARRAYS.set(duplicate, arrays.map(cloneSurfaceArrays));
      const names = MESH_RESOURCE_SURFACE_NAMES.get(source);
      if (names !== undefined) MESH_RESOURCE_SURFACE_NAMES.set(duplicate, [...names]);
      return duplicate;
    },
  });
}

/** `MeshInstance.mesh` / `MeshInstance3D.mesh`: the exact geometry currently being rendered. */
export function getMeshInstanceMesh(value: unknown): BufferGeometry | null {
  const node = requireMeshInstance(value, 'mesh');
  if (MESH_RESOURCE.has(node)) {
    const retained = MESH_RESOURCE.get(node) ?? null;
    if (retained !== null) {
      seatMeshResourceMaterials(node, retained);
      applyMeshResourceMaterials(node, retained);
    }
    return retained;
  }
  const geometry = retainGodotMeshResource(requireMeshResource(node.geometry, 'mesh'));
  seatMeshResourceMaterials(node, geometry);
  applyMeshResourceMaterials(node, geometry);
  MESH_RESOURCE.set(node, geometry);
  return geometry;
}

/** Godot 3 VisualInstance.get_transformed_aabb over this retained Mesh's own world geometry. */
export function getVisualInstanceTransformedAabb(value: unknown): GodotAabb {
  const node = requireMeshInstance(value, 'get_transformed_aabb');
  node.updateWorldMatrix(true, false);
  let local: Box3;
  if (node instanceof SkinnedMesh) {
    node.computeBoundingBox();
    local = node.boundingBox?.clone() ?? new Box3();
  } else {
    if (node.geometry.boundingBox === null) node.geometry.computeBoundingBox();
    local = node.geometry.boundingBox?.clone() ?? new Box3();
  }
  if (local.isEmpty()) return aabb();
  local.applyMatrix4(node.matrixWorld);
  return aabb(local.min, local.getSize(new Vector3()));
}

/** Bind an authored native geometry Resource to the Three Mesh that renders it. */
export function bindGodotMeshResourceView(value: unknown, mesh: unknown): void {
  const node = requireMeshInstance(value, 'mesh resource view');
  const geometry = retainGodotMeshResource(requireMeshResource(mesh, 'mesh resource view'));
  if (MESH_RESOURCE.get(node) !== geometry) {
    detachMeshResourceView(node);
    MESH_RESOURCE.set(node, geometry);
  }
  node.geometry = geometry;
  seatMeshResourceMaterials(node, geometry);
  applyMeshResourceMaterials(node, geometry);
}

/** Re-apply surface/material cardinality after a mutable ArrayMesh gains another surface. */
export function refreshGodotMeshResourceViews(value: unknown): void {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'surface refresh'));
  const views = MESH_RESOURCE_VIEWS.get(geometry);
  for (const view of views ?? []) {
    const node = view.deref();
    if (node === undefined) views?.delete(view);
    else applyMeshResourceMaterials(node, geometry);
  }
}

/** Number of Godot surfaces retained as Three draw groups on a native Mesh resource. */
export function getGodotMeshResourceSurfaceCount(value: unknown): number {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'get_surface_count'));
  if (geometry.groups.length > 0) return geometry.groups.length;
  return geometry.getAttribute('position') === undefined ? 0 : 1;
}

/** Material authored on one native Mesh surface, or null when the resource carries none. */
export function getGodotMeshResourceSurfaceMaterial(
  value: unknown,
  surface: number,
): Material | null {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'surface_get_material'));
  const count = getGodotMeshResourceSurfaceCount(geometry);
  if (!Number.isSafeInteger(surface) || surface < 0 || surface >= count) {
    throw new RangeError(`Mesh.surface_get_material surface ${surface} is outside 0..${count - 1}.`);
  }
  const overrides = MESH_RESOURCE_OVERRIDES.get(geometry);
  if (overrides?.has(surface)) return overrides.get(surface) ?? null;
  return MESH_RESOURCE_MATERIALS.get(geometry)?.[surface] ?? null;
}

/** `Mesh.surface_set_material`: mutate the shared native geometry's retained material slot. */
export function setGodotMeshResourceSurfaceMaterial(
  value: unknown,
  surface: number,
  material: Material | null,
): void {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'surface_set_material'));
  const count = getGodotMeshResourceSurfaceCount(geometry);
  if (!Number.isSafeInteger(surface) || surface < 0 || surface >= count) {
    throw new RangeError(`Mesh.surface_set_material surface ${surface} is outside 0..${count - 1}.`);
  }
  if (material !== null && !(material instanceof Material)) {
    throw new TypeError('Mesh.surface_set_material requires a native Three Material or null.');
  }
  const overrides = MESH_RESOURCE_OVERRIDES.get(geometry) ?? new Map<number, Material | null>();
  if (overrides.has(surface) && overrides.get(surface) === material) return;
  overrides.set(surface, material);
  MESH_RESOURCE_OVERRIDES.set(geometry, overrides);
  const views = MESH_RESOURCE_VIEWS.get(geometry);
  if (views !== undefined) refreshGodotMeshResourceViews(geometry);
  godotResourceEmitChanged(geometry);
}

const ARRAY_VERTEX = 0;
const ARRAY_NORMAL = 1;
const ARRAY_TANGENT = 2;
const ARRAY_COLOR = 3;
const ARRAY_TEX_UV = 4;
const ARRAY_TEX_UV2 = 5;

function meshArrayIndices(major: 3 | 4): { readonly bones: number; readonly weights: number; readonly index: number; readonly max: number } {
  return major === 3
    ? { bones: 6, weights: 7, index: 8, max: 9 }
    : { bones: 10, weights: 11, index: 12, max: 13 };
}

function cloneArrayValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) =>
    typeof entry === 'object' && entry !== null ? { ...entry } : entry,
  );
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<unknown>);
  return value;
}

function cloneSurfaceArrays(arrays: unknown[]): unknown[] {
  return arrays.map(cloneArrayValue);
}

function surfaceSlot(arrays: readonly unknown[], index: number, member: string): readonly unknown[] {
  const value = arrays[index];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    throw new TypeError(`ArrayMesh.${member} array slot ${index} must be a packed array or null.`);
  }
  return Array.from(value as ArrayLike<unknown>);
}

function finiteComponent(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`ArrayMesh.${member} requires finite numeric components.`);
  }
  return value;
}

function vectorAttribute(values: readonly unknown[], itemSize: 2 | 3, member: string): Float32Array {
  const result = new Float32Array(values.length * itemSize);
  values.forEach((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new TypeError(`ArrayMesh.${member} entry ${index} is not a vector.`);
    }
    const vector = value as { x?: unknown; y?: unknown; z?: unknown };
    result[index * itemSize] = finiteComponent(vector.x, member);
    result[index * itemSize + 1] = finiteComponent(vector.y, member);
    if (itemSize === 3) result[index * itemSize + 2] = finiteComponent(vector.z, member);
  });
  return result;
}

function colorAttribute(values: readonly unknown[], member: string): Float32Array {
  const result = new Float32Array(values.length * 4);
  values.forEach((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new TypeError(`ArrayMesh.${member} entry ${index} is not a Color.`);
    }
    const color = value as { r?: unknown; g?: unknown; b?: unknown; a?: unknown };
    result[index * 4] = finiteComponent(color.r, member);
    result[index * 4 + 1] = finiteComponent(color.g, member);
    result[index * 4 + 2] = finiteComponent(color.b, member);
    result[index * 4 + 3] = finiteComponent(color.a, member);
  });
  return result;
}

function numericAttribute(values: readonly unknown[], itemSize: number, member: string): Float32Array {
  if (values.length % itemSize !== 0) {
    throw new RangeError(`ArrayMesh.${member} requires ${itemSize} values per vertex.`);
  }
  return Float32Array.from(values, (value) => finiteComponent(value, member));
}

interface NativeSurfaceArrays {
  readonly vertexCount: number;
  readonly indices: Uint32Array;
  readonly attributes: ReadonlyMap<string, { readonly values: Float32Array; readonly itemSize: number; readonly fill: readonly number[] }>;
}

function nativeSurfaceArrays(arrays: readonly unknown[], major: 3 | 4): NativeSurfaceArrays {
  const member = 'add_surface_from_arrays';
  const slots = meshArrayIndices(major);
  if (arrays.length < slots.max) {
    throw new RangeError(`ArrayMesh.${member} requires Mesh.ARRAY_MAX (${slots.max}) slots.`);
  }
  if (major === 4) {
    for (let slot = 6; slot <= 9; slot += 1) {
      if (surfaceSlot(arrays, slot, member).length > 0) {
        throw new Error(`ArrayMesh.${member} custom channel ${slot - 6} requires an ArrayCustomFormat not represented by Three BufferGeometry.`);
      }
    }
  }
  const vertices = surfaceSlot(arrays, ARRAY_VERTEX, member);
  if (vertices.length === 0) throw new Error(`ArrayMesh.${member} requires a non-empty vertex array.`);
  const vertexCount = vertices.length;
  const attributes = new Map<string, { values: Float32Array; itemSize: number; fill: readonly number[] }>();
  attributes.set('position', { values: vectorAttribute(vertices, 3, member), itemSize: 3, fill: [0, 0, 0] });
  const optional = (
    slot: number,
    name: string,
    itemSize: number,
    values: Float32Array,
    fill: readonly number[],
  ): void => {
    if (values.length === 0) return;
    if (values.length / itemSize !== vertexCount) {
      throw new RangeError(`ArrayMesh.${member} ${name} count does not match its vertex count.`);
    }
    attributes.set(name, { values, itemSize, fill });
    void slot;
  };
  const normals = surfaceSlot(arrays, ARRAY_NORMAL, member);
  optional(ARRAY_NORMAL, 'normal', 3, normals.length === 0 ? new Float32Array() : vectorAttribute(normals, 3, member), [0, 0, 0]);
  const tangents = surfaceSlot(arrays, ARRAY_TANGENT, member);
  optional(ARRAY_TANGENT, 'tangent', 4, numericAttribute(tangents, 4, member), [0, 0, 0, 1]);
  const colors = surfaceSlot(arrays, ARRAY_COLOR, member);
  optional(ARRAY_COLOR, 'color', 4, colors.length === 0 ? new Float32Array() : colorAttribute(colors, member), [1, 1, 1, 1]);
  const uvs = surfaceSlot(arrays, ARRAY_TEX_UV, member);
  optional(ARRAY_TEX_UV, 'uv', 2, uvs.length === 0 ? new Float32Array() : vectorAttribute(uvs, 2, member), [0, 0]);
  const uv2s = surfaceSlot(arrays, ARRAY_TEX_UV2, member);
  optional(ARRAY_TEX_UV2, 'uv1', 2, uv2s.length === 0 ? new Float32Array() : vectorAttribute(uv2s, 2, member), [0, 0]);
  const bones = surfaceSlot(arrays, slots.bones, member);
  optional(slots.bones, 'skinIndex', 4, numericAttribute(bones, 4, member), [0, 0, 0, 0]);
  const weights = surfaceSlot(arrays, slots.weights, member);
  optional(slots.weights, 'skinWeight', 4, numericAttribute(weights, 4, member), [0, 0, 0, 0]);
  const authoredIndices = surfaceSlot(arrays, slots.index, member);
  const indices = authoredIndices.length === 0
    ? Uint32Array.from({ length: vertexCount }, (_, index) => index)
    : Uint32Array.from(authoredIndices, (value) => {
        if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= vertexCount) {
          throw new RangeError(`ArrayMesh.${member} index ${String(value)} is outside the vertex array.`);
        }
        return Number(value);
      });
  if (indices.length % 3 !== 0) throw new RangeError(`ArrayMesh.${member} triangle indices must be divisible by three.`);
  return { vertexCount, indices, attributes };
}

/** `ArrayMesh.add_surface_from_arrays` over one shared native BufferGeometry Resource. */
export function addGodotArrayMeshSurface(
  value: unknown,
  major: 3 | 4,
  primitive: number,
  arrays: unknown,
  blendShapes: unknown = [],
  lodsOrFlags: unknown = major === 3 ? 0 : {},
  flags = 0,
): void {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'add_surface_from_arrays'));
  const triangles = major === 3 ? 4 : 3;
  if (primitive !== triangles) throw new Error('ArrayMesh.add_surface_from_arrays currently requires Mesh.PRIMITIVE_TRIANGLES.');
  if (!Array.isArray(arrays)) throw new TypeError('ArrayMesh.add_surface_from_arrays requires an Array.');
  if (!Array.isArray(blendShapes) || blendShapes.length > 0) {
    throw new Error('ArrayMesh.add_surface_from_arrays blend shapes require retained morph-target surfaces.');
  }
  if (major === 4) {
    const emptyLods = lodsOrFlags instanceof Map
      ? lodsOrFlags.size === 0
      : typeof lodsOrFlags === 'object' &&
        lodsOrFlags !== null &&
        !Array.isArray(lodsOrFlags) &&
        Object.keys(lodsOrFlags).length === 0;
    if (!emptyLods) {
      throw new Error('ArrayMesh.add_surface_from_arrays non-empty LOD dictionaries require retained alternate index buffers.');
    }
    if (!Number.isSafeInteger(flags)) throw new TypeError('ArrayMesh.add_surface_from_arrays flags must be an integer.');
  } else if (!Number.isSafeInteger(lodsOrFlags)) {
    throw new TypeError('ArrayMesh.add_surface_from_arrays compression flags must be an integer.');
  }
  const surface = nativeSurfaceArrays(arrays, major);
  const priorVertexCount = geometry.getAttribute('position')?.count ?? 0;
  const priorIndex = geometry.getIndex();
  const priorIndices = priorIndex === null
    ? Uint32Array.from({ length: priorVertexCount }, (_, index) => index)
    : Uint32Array.from(priorIndex.array, Number);
  const attributeNames = new Set([...Object.keys(geometry.attributes), ...surface.attributes.keys()]);
  for (const name of attributeNames) {
    const prior = geometry.getAttribute(name);
    const next = surface.attributes.get(name);
    const itemSize = next?.itemSize ?? prior?.itemSize;
    if (itemSize === undefined || (prior !== undefined && prior.itemSize !== itemSize)) {
      throw new Error(`ArrayMesh.add_surface_from_arrays cannot combine incompatible ${name} attributes.`);
    }
    const fill = next?.fill ?? Array.from({ length: itemSize }, () => 0);
    const combined = new Float32Array((priorVertexCount + surface.vertexCount) * itemSize);
    if (prior !== undefined) combined.set(Float32Array.from(prior.array, Number));
    else for (let vertex = 0; vertex < priorVertexCount; vertex += 1) combined.set(fill, vertex * itemSize);
    if (next !== undefined) combined.set(next.values, priorVertexCount * itemSize);
    else for (let vertex = 0; vertex < surface.vertexCount; vertex += 1) combined.set(fill, (priorVertexCount + vertex) * itemSize);
    geometry.setAttribute(name, new BufferAttribute(combined, itemSize));
  }
  const combinedIndices = new Uint32Array(priorIndices.length + surface.indices.length);
  combinedIndices.set(priorIndices);
  surface.indices.forEach((index, cursor) => { combinedIndices[priorIndices.length + cursor] = priorVertexCount + index; });
  geometry.setIndex(new BufferAttribute(combinedIndices, 1));
  if (priorVertexCount > 0 && geometry.groups.length === 0) geometry.addGroup(0, priorIndices.length, 0);
  geometry.addGroup(priorIndices.length, surface.indices.length, geometry.groups.length);
  const retained = MESH_RESOURCE_SURFACE_ARRAYS.get(geometry) ?? [];
  retained.push(cloneSurfaceArrays(arrays));
  MESH_RESOURCE_SURFACE_ARRAYS.set(geometry, retained);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  refreshGodotMeshResourceViews(geometry);
  godotResourceEmitChanged(geometry);
}

function requireSurfaceIndex(geometry: BufferGeometry, surface: number, member: string): number {
  const count = getGodotMeshResourceSurfaceCount(geometry);
  if (!Number.isSafeInteger(surface) || surface < 0 || surface >= count) {
    throw new RangeError(`ArrayMesh.${member} surface ${surface} is outside 0..${count - 1}.`);
  }
  return surface;
}

export function getGodotArrayMeshSurfaceName(value: unknown, surface: number): string {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'surface_get_name'));
  return MESH_RESOURCE_SURFACE_NAMES.get(geometry)?.[requireSurfaceIndex(geometry, surface, 'surface_get_name')] ?? '';
}

export function setGodotArrayMeshSurfaceName(value: unknown, surface: number, name: string): void {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'surface_set_name'));
  const index = requireSurfaceIndex(geometry, surface, 'surface_set_name');
  if (typeof name !== 'string') throw new TypeError('ArrayMesh.surface_set_name requires a String.');
  const names = MESH_RESOURCE_SURFACE_NAMES.get(geometry) ?? [];
  if (names[index] === name) return;
  names[index] = name;
  MESH_RESOURCE_SURFACE_NAMES.set(geometry, names);
  godotResourceEmitChanged(geometry);
}

export function getGodotMeshSurfaceArrays(value: unknown, surface: number, major: 3 | 4): unknown[] {
  const geometry = retainGodotMeshResource(requireMeshResource(value, 'surface_get_arrays'));
  const index = requireSurfaceIndex(geometry, surface, 'surface_get_arrays');
  const retained = MESH_RESOURCE_SURFACE_ARRAYS.get(geometry)?.[index];
  if (retained !== undefined) return cloneSurfaceArrays(retained);
  const slots = meshArrayIndices(major);
  const arrays = Array.from({ length: slots.max }, () => null) as unknown[];
  const group = geometry.groups[index] ?? { start: 0, count: geometry.getIndex()?.count ?? geometry.getAttribute('position').count };
  const nativeIndex = geometry.getIndex();
  const selected = nativeIndex === null
    ? Array.from({ length: group.count }, (_, cursor) => group.start + cursor)
    : Array.from(nativeIndex.array.slice(group.start, group.start + group.count), Number);
  const firstVertex = selected.length === 0 ? 0 : Math.min(...selected);
  const lastVertex = selected.length === 0 ? -1 : Math.max(...selected);
  const vectors = (name: string, itemSize: number, map: (parts: number[]) => unknown): unknown[] | null => {
    const attribute = geometry.getAttribute(name);
    if (attribute === undefined) return null;
    return Array.from({ length: lastVertex - firstVertex + 1 }, (_, cursor) =>
      map(Array.from({ length: itemSize }, (__, component) => Number(attribute.array[(firstVertex + cursor) * itemSize + component]))),
    );
  };
  arrays[ARRAY_VERTEX] = vectors('position', 3, ([x, y, z]) => ({ x, y, z }));
  arrays[ARRAY_NORMAL] = vectors('normal', 3, ([x, y, z]) => ({ x, y, z }));
  arrays[ARRAY_TANGENT] = vectors('tangent', 4, (parts) => parts)?.flat() ?? null;
  arrays[ARRAY_COLOR] = vectors('color', 4, ([r, g, b, a]) => ({ r, g, b, a }));
  arrays[ARRAY_TEX_UV] = vectors('uv', 2, ([x, y]) => ({ x, y }));
  arrays[ARRAY_TEX_UV2] = vectors('uv1', 2, ([x, y]) => ({ x, y }));
  arrays[slots.bones] = vectors('skinIndex', 4, (parts) => parts)?.flat() ?? null;
  arrays[slots.weights] = vectors('skinWeight', 4, (parts) => parts)?.flat() ?? null;
  arrays[slots.index] = selected.map((vertex) => vertex - firstVertex);
  return arrays;
}

/** Assign the exact shared Mesh resource identity to the retained Three draw node. */
export function setMeshInstanceMesh(value: unknown, mesh: unknown): void {
  const node = requireMeshInstance(value, 'mesh');
  if (mesh === null) {
    if (MESH_RESOURCE.has(node) && MESH_RESOURCE.get(node) === null) return;
    detachMeshResourceView(node);
    const empty = new BufferGeometry();
    PRIVATE_EMPTY_GEOMETRY.get(node)?.dispose();
    PRIVATE_EMPTY_GEOMETRY.set(node, empty);
    MESH_RESOURCE.set(node, null);
    node.geometry = empty;
    return;
  }
  const geometry = retainGodotMeshResource(requireMeshResource(mesh, 'mesh'));
  if (MESH_RESOURCE.get(node) === geometry) return;
  detachMeshResourceView(node);
  PRIVATE_EMPTY_GEOMETRY.get(node)?.dispose();
  PRIVATE_EMPTY_GEOMETRY.delete(node);
  bindGodotMeshResourceView(node, geometry);
}

function surfaceIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('MeshInstance surface index must be non-negative.');
  return value;
}

export function setMeshInstanceSurfaceMaterial(value: unknown, surface: number, material: Material | null): void {
  const node = requireMeshInstance(value, 'set_surface_material');
  const index = surfaceIndex(surface);
  if (material !== null && !(material instanceof Material)) {
    throw new TypeError('MeshInstance.set_surface_material requires a native Three Material or null.');
  }
  const materials = SURFACE_MATERIALS.get(node) ?? new Map<number, Material | null>();
  const base = BASE_SURFACE_MATERIALS.get(node) ?? (Array.isArray(node.material) ? [...node.material] : [node.material]);
  BASE_SURFACE_MATERIALS.set(node, base);
  materials.set(index, material);
  SURFACE_MATERIALS.set(node, materials);
  const current = Array.isArray(node.material) ? [...node.material] : [node.material];
  current[index] = material ?? base[index] ?? new MeshBasicMaterial();
  node.material = current.length === 1 ? current[0]! : current;
}

export function getMeshInstanceSurfaceMaterial(value: unknown, surface: number): Material | null {
  const node = requireMeshInstance(value, 'get_surface_material');
  const index = surfaceIndex(surface);
  return SURFACE_MATERIALS.get(node)?.get(index) ?? null;
}
