/** Godot 3 ImmediateGeometry's retained triangle builder over one native Three Mesh. */
import { BufferAttribute, BufferGeometry, Material, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { registerGodotObjectIdentity } from './object';
import {
  clearGodotMeshResourceSurfaces,
  refreshGodotMeshResourceViews,
  retainGodotMeshResource,
  setGodotMeshResourceSurfaceMaterial,
} from './mesh-instance';
import { godotResourceEmitChanged } from './resource-io';

export interface ImmediateGeometryVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface ImmediateGeometryColor { readonly r: number; readonly g: number; readonly b: number; readonly a?: number }

interface ImmediateGeometryState {
  active: boolean;
  color: Required<ImmediateGeometryColor>;
  readonly mesh: Mesh;
  readonly positions: number[];
  readonly colors: number[];
}

const STATES = new WeakMap<Object3D, ImmediateGeometryState>();

function stateOf(node: Object3D): ImmediateGeometryState {
  const state = STATES.get(node);
  if (state === undefined) throw new TypeError('ImmediateGeometry requires a retained native Three Mesh');
  return state;
}

export function createGodotImmediateGeometry(node: Object3D = new Object3D()): Object3D {
  const geometry = new BufferGeometry();
  const material = new MeshStandardMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);
  node.add(mesh);
  registerGodotObjectIdentity(node, 'ImmediateGeometry');
  STATES.set(node, {
    active: false,
    color: { r: 1, g: 1, b: 1, a: 1 },
    mesh,
    positions: [],
    colors: [],
  });
  return node;
}

/** The measured ImmediateGeometry surface is Mesh.PRIMITIVE_TRIANGLES (4), with no texture. */
export function immediateGeometryBegin(node: Object3D, primitive: number, texture: unknown = null): void {
  const state = stateOf(node);
  if (state.active) throw new Error('ImmediateGeometry.begin cannot nest before end');
  if (primitive !== 4) {
    throw new Error(`ImmediateGeometry.begin only carries native triangle surfaces; got primitive ${String(primitive)}`);
  }
  if (texture !== null && texture !== undefined) {
    throw new Error('ImmediateGeometry.begin texture override has no exact retained Three material route');
  }
  state.active = true;
}

export function immediateGeometrySetColor(node: Object3D, color: ImmediateGeometryColor): void {
  const state = stateOf(node);
  if (!state.active) throw new Error('ImmediateGeometry.set_color requires an active begin/end surface');
  const values = [color.r, color.g, color.b, color.a ?? 1];
  if (!values.every(Number.isFinite)) throw new TypeError('ImmediateGeometry.set_color requires finite Color components');
  if (values[3] !== 1) {
    throw new Error('ImmediateGeometry.set_color alpha requires a vertex-alpha shader this native material does not carry');
  }
  state.color = { r: values[0]!, g: values[1]!, b: values[2]!, a: values[3]! };
}

export function immediateGeometryAddVertex(node: Object3D, vertex: ImmediateGeometryVector3): void {
  const state = stateOf(node);
  if (!state.active) throw new Error('ImmediateGeometry.add_vertex requires an active begin/end surface');
  if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) {
    throw new TypeError('ImmediateGeometry.add_vertex requires a finite Vector3');
  }
  state.positions.push(vertex.x, vertex.y, vertex.z);
  state.colors.push(state.color.r, state.color.g, state.color.b);
}

export function immediateGeometryEnd(node: Object3D): void {
  const state = stateOf(node);
  if (!state.active) throw new Error('ImmediateGeometry.end requires an active begin/end surface');
  if ((state.positions.length / 3) % 3 !== 0) {
    throw new Error('ImmediateGeometry triangle surface must end on a complete three-vertex primitive');
  }
  state.active = false;
  const geometry = state.mesh.geometry;
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(state.positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(state.colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function releaseGodotImmediateGeometry(node: Object3D): void {
  const state = STATES.get(node);
  if (state === undefined) return;
  state.mesh.removeFromParent();
  state.mesh.geometry.dispose();
  (state.mesh.material as MeshStandardMaterial).dispose();
  STATES.delete(node);
}

interface ImmediateMeshState {
  active: boolean;
  readonly positions: number[];
  surfaceFirstVertex: number;
  surfaceMaterial: Material | null;
}

const IMMEDIATE_MESH_STATES = new WeakMap<BufferGeometry, ImmediateMeshState>();

function immediateMeshStateOf(mesh: BufferGeometry): ImmediateMeshState {
  const state = IMMEDIATE_MESH_STATES.get(mesh);
  if (state === undefined) {
    throw new TypeError('ImmediateMesh requires a retained native THREE.BufferGeometry resource');
  }
  return state;
}

/** Godot 4 ImmediateMesh as the native mutable BufferGeometry consumed by MeshInstance3D. */
export function createGodotImmediateMesh(): BufferGeometry {
  const mesh = retainGodotMeshResource(new BufferGeometry());
  registerGodotObjectIdentity(mesh, 'ImmediateMesh');
  IMMEDIATE_MESH_STATES.set(mesh, {
    active: false,
    positions: [],
    surfaceFirstVertex: 0,
    surfaceMaterial: null,
  });
  return mesh;
}

/** Begin one exact triangle surface. Godot 4's Mesh.PRIMITIVE_TRIANGLES value is 3. */
export function immediateMeshSurfaceBegin(
  mesh: BufferGeometry,
  primitive: number,
  material: Material | null = null,
): void {
  const state = immediateMeshStateOf(mesh);
  if (state.active) throw new Error('ImmediateMesh.surface_begin cannot nest before surface_end');
  if (primitive !== 3) {
    throw new Error(`ImmediateMesh.surface_begin only carries native triangle surfaces; got ${String(primitive)}`);
  }
  if (material !== null && !(material instanceof Material)) {
    throw new TypeError('ImmediateMesh.surface_begin material must be a native Three Material or null');
  }
  state.active = true;
  state.surfaceFirstVertex = state.positions.length / 3;
  state.surfaceMaterial = material;
}

export function immediateMeshSurfaceAddVertex(
  mesh: BufferGeometry,
  vertex: ImmediateGeometryVector3,
): void {
  const state = immediateMeshStateOf(mesh);
  if (!state.active) {
    throw new Error('ImmediateMesh.surface_add_vertex requires an active surface_begin/surface_end surface');
  }
  if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) {
    throw new TypeError('ImmediateMesh.surface_add_vertex requires a finite Vector3');
  }
  state.positions.push(vertex.x, vertex.y, vertex.z);
}

export function immediateMeshSurfaceEnd(mesh: BufferGeometry): void {
  const state = immediateMeshStateOf(mesh);
  if (!state.active) throw new Error('ImmediateMesh.surface_end requires an active surface');
  const vertexCount = state.positions.length / 3 - state.surfaceFirstVertex;
  if (vertexCount === 0 || vertexCount % 3 !== 0) {
    throw new Error('ImmediateMesh triangle surface must contain complete three-vertex primitives');
  }
  state.active = false;
  mesh.setAttribute('position', new BufferAttribute(new Float32Array(state.positions), 3));
  mesh.addGroup(state.surfaceFirstVertex, vertexCount, mesh.groups.length);
  mesh.computeVertexNormals();
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  setGodotMeshResourceSurfaceMaterial(mesh, mesh.groups.length - 1, state.surfaceMaterial);
  refreshGodotMeshResourceViews(mesh);
  godotResourceEmitChanged(mesh);
}

export function immediateMeshClearSurfaces(mesh: BufferGeometry): void {
  const state = immediateMeshStateOf(mesh);
  if (state.active) throw new Error('ImmediateMesh.clear_surfaces cannot run inside an active surface');
  state.positions.length = 0;
  state.surfaceFirstVertex = 0;
  state.surfaceMaterial = null;
  mesh.deleteAttribute('position');
  mesh.deleteAttribute('normal');
  mesh.clearGroups();
  clearGodotMeshResourceSurfaces(mesh);
  mesh.boundingBox = null;
  mesh.boundingSphere = null;
  refreshGodotMeshResourceViews(mesh);
  godotResourceEmitChanged(mesh);
}
