/** Retained Pixi view of the canonical cross-surface Godot MultiMesh Resource. */
import { Container, Matrix, Mesh, MeshGeometry, Texture } from 'pixi.js';
import { GodotMultiMesh, MULTIMESH_FORMAT_8BIT, MULTIMESH_FORMAT_FLOAT, MULTIMESH_FORMAT_NONE, MULTIMESH_TRANSFORM_2D, MULTIMESH_TRANSFORM_3D, type MultiMeshChange } from './multimesh';
import { registerGodotObjectIdentity } from './object';
import type { GodotTransform2D } from './transform-2d';
import type { ColorValue } from './variant';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';

export { MULTIMESH_FORMAT_8BIT, MULTIMESH_FORMAT_FLOAT, MULTIMESH_FORMAT_NONE, MULTIMESH_TRANSFORM_2D, MULTIMESH_TRANSFORM_3D } from './multimesh';
export type { GodotMultiMesh } from './multimesh';

export interface MultiMesh2DGeometrySpec { readonly positions: Float32Array; readonly uvs?: Float32Array; readonly indices: Uint16Array | Uint32Array; readonly texture?: Texture; }
export interface GodotMultiMesh2DGeometry { readonly geometry: MeshGeometry; texture: Texture; }
export interface MultiMesh2DOptions {
  readonly major: 3 | 4; readonly geometry?: GodotMultiMesh2DGeometry; readonly multimesh?: GodotMultiMesh;
  readonly instanceCount?: number; readonly visibleInstanceCount?: number; readonly transformFormat?: number;
  readonly colorFormat?: number; readonly customDataFormat?: number; readonly transforms?: readonly GodotTransform2D[];
  readonly colors?: readonly ColorValue[]; readonly blendMode?: 'normal' | 'add'; readonly modulate?: ColorValue;
}
export type GodotMultiMeshInstance2D = Container & { multimesh: GodotMultiMesh | null; set_multimesh(value: GodotMultiMesh | null): void; get_multimesh(): GodotMultiMesh | null };

interface ViewState { resource: GodotMultiMesh | null; geometry: GodotMultiMesh2DGeometry | null; meshes: Mesh<MeshGeometry>[]; blendMode: 'normal' | 'add'; unsubscribe: (() => void) | null; }
const STATES = new WeakMap<GodotMultiMeshInstance2D, ViewState>();
const GEOMETRY_USERS = new WeakMap<GodotMultiMesh2DGeometry, number>();
const GEOMETRY_OWNER_RELEASED = new WeakSet<GodotMultiMesh2DGeometry>();
const RELEASED_GEOMETRIES = new WeakSet<GodotMultiMesh2DGeometry>();

function colorNumber(color: ColorValue): number { const b = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))); return (b(color.r) << 16) | (b(color.g) << 8) | b(color.b); }
function applyTransform(mesh: Mesh<MeshGeometry>, value: GodotTransform2D): void { mesh.setFromMatrix(new Matrix(value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y)); }
function applyColor(mesh: Mesh<MeshGeometry>, value: ColorValue): void { mesh.tint = colorNumber(value); mesh.alpha = value.a; }
function geometryOf(resource: GodotMultiMesh): GodotMultiMesh2DGeometry | null {
  const value = resource.mesh;
  if (value === null) return null;
  if (typeof value !== 'object' || !('geometry' in value) || !('texture' in value)) throw new TypeError('MultiMeshInstance2D requires MultiMesh.mesh to be a retained Pixi geometry resource.');
  return value as GodotMultiMesh2DGeometry;
}
function retainGeometry(resource: GodotMultiMesh2DGeometry): void { if (RELEASED_GEOMETRIES.has(resource)) throw new Error('MultiMesh geometry resource was already released.'); GEOMETRY_USERS.set(resource, (GEOMETRY_USERS.get(resource) ?? 0) + 1); }
function releaseGeometry(resource: GodotMultiMesh2DGeometry): void {
  const count = GEOMETRY_USERS.get(resource) ?? 0;
  if (count <= 0) throw new Error('MultiMesh geometry resource reference count underflow.');
  if (count > 1) GEOMETRY_USERS.set(resource, count - 1); else { GEOMETRY_USERS.delete(resource); if (GEOMETRY_OWNER_RELEASED.has(resource) && !RELEASED_GEOMETRIES.has(resource)) { RELEASED_GEOMETRIES.add(resource); resource.geometry.destroy(); } }
}
function clear(owner: GodotMultiMeshInstance2D, state: ViewState): void {
  for (const mesh of state.meshes) { owner.removeChild(mesh); mesh.destroy({ texture: false, textureSource: false }); }
  state.meshes.length = 0;
  if (state.geometry !== null) releaseGeometry(state.geometry);
  state.geometry = null;
}
function assertRenderable(resource: GodotMultiMesh): void {
  if (resource.transform_format !== MULTIMESH_TRANSFORM_2D) throw new Error('MultiMeshInstance2D requires MultiMesh.TRANSFORM_2D.');
  if (resource.use_custom_data) throw new Error('MultiMeshInstance2D cannot consume INSTANCE_CUSTOM without an authored Pixi shader backend.');
}
function applyVisibility(state: ViewState): void { const r = state.resource; if (r === null) return; const n = r.visible_instance_count < 0 ? r.instance_count : r.visible_instance_count; state.meshes.forEach((mesh, i) => { mesh.visible = i < n; }); }
function rebuild(owner: GodotMultiMeshInstance2D, state: ViewState): void {
  clear(owner, state); const resource = state.resource; if (resource === null) return; assertRenderable(resource);
  const geometry = geometryOf(resource); if (geometry === null) return; retainGeometry(geometry); state.geometry = geometry;
  for (let index = 0; index < resource.instance_count; index += 1) { const mesh = new Mesh({ geometry: geometry.geometry, texture: geometry.texture }); mesh.blendMode = state.blendMode; applyTransform(mesh, resource.get_instance_transform_2d(index)); if (resource.use_colors) applyColor(mesh, resource.get_instance_color(index)); state.meshes.push(mesh); owner.addChild(mesh); }
  applyVisibility(state);
}
function changed(owner: GodotMultiMeshInstance2D, state: ViewState, change: MultiMeshChange): void {
  const resource = state.resource; if (resource === null) return;
  if (change.kind === 'allocation' || change.kind === 'mesh') rebuild(owner, state);
  else if (change.kind === 'visible') applyVisibility(state);
  else if (change.kind === 'transform') { const mesh = state.meshes[change.index]; if (mesh !== undefined) applyTransform(mesh, resource.get_instance_transform_2d(change.index)); }
  else if (change.kind === 'color') { const mesh = state.meshes[change.index]; if (mesh !== undefined) applyColor(mesh, resource.get_instance_color(change.index)); }
  else if (change.kind === 'custom-data') assertRenderable(resource);
  else for (let i = 0; i < state.meshes.length; i += 1) { applyTransform(state.meshes[i]!, resource.get_instance_transform_2d(i)); if (resource.use_colors) applyColor(state.meshes[i]!, resource.get_instance_color(i)); }
}
function bind(owner: GodotMultiMeshInstance2D, value: GodotMultiMesh | null): void {
  const state = STATES.get(owner); if (state === undefined) throw new Error('MultiMeshInstance2D was released.'); if (state.resource === value) return;
  if (value !== null && !(value instanceof GodotMultiMesh)) throw new TypeError('MultiMeshInstance2D.multimesh requires a retained GodotMultiMesh Resource or null.');
  clear(owner, state); state.unsubscribe?.(); state.resource = value; state.unsubscribe = value?.observe((change) => changed(owner, state, change)) ?? null; rebuild(owner, state);
}

export function createMultiMesh2DGeometry(spec: MultiMesh2DGeometrySpec): GodotMultiMesh2DGeometry {
  if (spec.positions.length % 2 !== 0) throw new Error('MultiMesh ArrayMesh positions must be XY pairs.'); const count = spec.positions.length / 2; const uvs = spec.uvs ?? new Float32Array(count * 2); if (uvs.length !== count * 2) throw new Error('MultiMesh ArrayMesh UV count does not match its vertices.');
  const indices = spec.indices instanceof Uint32Array ? spec.indices : Uint32Array.from(spec.indices);
  return { geometry: new MeshGeometry({ positions: spec.positions, uvs, indices }), texture: spec.texture ?? Texture.WHITE };
}
export function releaseMultiMesh2DGeometry(resource: GodotMultiMesh2DGeometry): void { if (GEOMETRY_OWNER_RELEASED.has(resource)) return; GEOMETRY_OWNER_RELEASED.add(resource); if ((GEOMETRY_USERS.get(resource) ?? 0) === 0 && !RELEASED_GEOMETRIES.has(resource)) { RELEASED_GEOMETRIES.add(resource); resource.geometry.destroy(); } }
export function createMultiMeshInstance2D(options: MultiMesh2DOptions): GodotMultiMeshInstance2D {
  const owner = bindGodotCanvasNode2DApi(new Container()) as unknown as GodotMultiMeshInstance2D; const state: ViewState = { resource: null, geometry: null, meshes: [], blendMode: options.blendMode ?? 'normal', unsubscribe: null }; STATES.set(owner, state); registerGodotObjectIdentity(owner, 'MultiMeshInstance2D');
  Object.defineProperty(owner, 'multimesh', { enumerable: true, configurable: false, get: () => state.resource, set: (value: GodotMultiMesh | null) => bind(owner, value) }); owner.set_multimesh = (value) => bind(owner, value); owner.get_multimesh = () => state.resource;
  const resource = options.multimesh ?? new GodotMultiMesh({
    major: options.major,
    mesh: options.geometry ?? null,
    transformFormat: options.transformFormat ?? 0,
    ...(options.colorFormat === undefined ? {} : { colorFormat: options.colorFormat }),
    ...(options.customDataFormat === undefined ? {} : { customDataFormat: options.customDataFormat }),
    ...(options.major === 4 ? {
      useColors: (options.colorFormat ?? 0) !== 0,
      useCustomData: (options.customDataFormat ?? 0) !== 0,
    } : {}),
    instanceCount: options.instanceCount ?? 0,
    visibleInstanceCount: options.visibleInstanceCount ?? -1,
  });
  options.transforms?.forEach((value, index) => resource.set_instance_transform_2d(index, value)); options.colors?.forEach((value, index) => resource.set_instance_color(index, value)); bind(owner, resource);
  if (options.modulate !== undefined) { owner.tint = colorNumber(options.modulate); owner.alpha = options.modulate.a; }
  registerCanvasNodeRelease(owner, () => releaseMultiMeshInstance2D(owner));
  return owner;
}
export function releaseMultiMeshInstance2D(owner: GodotMultiMeshInstance2D): void { const state = STATES.get(owner); if (state === undefined) return; clear(owner, state); state.unsubscribe?.(); state.resource = null; STATES.delete(owner); }
