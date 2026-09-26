import { BufferAttribute, type BufferGeometry } from 'three';
import {
  immediateMeshClearSurfaces,
  immediateMeshSurfaceAddVertex,
  immediateMeshSurfaceEnd,
  type ImmediateGeometryVector3,
} from './immediate-geometry';
import { godotResourceEmitChanged } from './resource-io';

interface AttributeState {
  normal: [number, number, number];
  tangent: [number, number, number, number];
  color: [number, number, number, number];
  uv: [number, number];
  uv2: [number, number];
  normals: number[];
  tangents: number[];
  colors: number[];
  uvs: number[];
  uv2s: number[];
}

const STATES = new WeakMap<BufferGeometry, AttributeState>();

function stateOf(mesh: BufferGeometry): AttributeState {
  let state = STATES.get(mesh);
  if (state === undefined) {
    state = { normal: [0, 0, 0], tangent: [0, 0, 0, 1], color: [1, 1, 1, 1], uv: [0, 0], uv2: [0, 0], normals: [], tangents: [], colors: [], uvs: [], uv2s: [] };
    STATES.set(mesh, state);
  }
  return state;
}

function components(value: unknown, member: string, names: readonly string[]): number[] {
  if (typeof value !== 'object' || value === null) throw new TypeError(`godot-compat: ImmediateMesh.${member} requires vector value.`);
  return names.map((name) => {
    const component = Reflect.get(value, name);
    if (typeof component !== 'number' || !Number.isFinite(component)) throw new TypeError(`godot-compat: ImmediateMesh.${member}.${name} requires finite number.`);
    return component;
  });
}

export function extendedImmediateMeshSurfaceSetColor(mesh: BufferGeometry, value: unknown): void {
  const rgb = components(value, 'surface_set_color', ['r', 'g', 'b']);
  const alphaValue = typeof value === 'object' && value !== null ? Reflect.get(value, 'a') : undefined;
  const alpha = alphaValue === undefined ? 1 : alphaValue;
  if (typeof alpha !== 'number' || !Number.isFinite(alpha)) throw new TypeError('godot-compat: ImmediateMesh.surface_set_color.a requires finite number.');
  stateOf(mesh).color = [rgb[0]!, rgb[1]!, rgb[2]!, alpha];
}

export function extendedImmediateMeshSurfaceSetNormal(mesh: BufferGeometry, value: unknown): void {
  stateOf(mesh).normal = components(value, 'surface_set_normal', ['x', 'y', 'z']) as [number, number, number];
}

export function extendedImmediateMeshSurfaceSetTangent(mesh: BufferGeometry, value: unknown): void {
  stateOf(mesh).tangent = components(value, 'surface_set_tangent', ['x', 'y', 'z', 'w']) as [number, number, number, number];
}

export function extendedImmediateMeshSurfaceSetUv(mesh: BufferGeometry, value: unknown): void {
  stateOf(mesh).uv = components(value, 'surface_set_uv', ['x', 'y']) as [number, number];
}

export function extendedImmediateMeshSurfaceSetUv2(mesh: BufferGeometry, value: unknown): void {
  stateOf(mesh).uv2 = components(value, 'surface_set_uv2', ['x', 'y']) as [number, number];
}

export function extendedImmediateMeshSurfaceAddVertex(mesh: BufferGeometry, vertex: ImmediateGeometryVector3): void {
  immediateMeshSurfaceAddVertex(mesh, vertex);
  const state = stateOf(mesh);
  state.normals.push(...state.normal); state.tangents.push(...state.tangent); state.colors.push(...state.color);
  state.uvs.push(...state.uv); state.uv2s.push(...state.uv2);
}

export function extendedImmediateMeshSurfaceAddVertex2D(mesh: BufferGeometry, vertex: unknown): void {
  const point = components(vertex, 'surface_add_vertex_2d', ['x', 'y']);
  extendedImmediateMeshSurfaceAddVertex(mesh, { x: point[0]!, y: point[1]!, z: 0 });
}

export function extendedImmediateMeshSurfaceEnd(mesh: BufferGeometry): void {
  immediateMeshSurfaceEnd(mesh);
  const state = stateOf(mesh), count = mesh.getAttribute('position')?.count ?? 0;
  if (state.normals.length === count * 3) mesh.setAttribute('normal', new BufferAttribute(new Float32Array(state.normals), 3));
  if (state.tangents.length === count * 4) mesh.setAttribute('tangent', new BufferAttribute(new Float32Array(state.tangents), 4));
  if (state.colors.length === count * 4) mesh.setAttribute('color', new BufferAttribute(new Float32Array(state.colors), 4));
  if (state.uvs.length === count * 2) mesh.setAttribute('uv', new BufferAttribute(new Float32Array(state.uvs), 2));
  if (state.uv2s.length === count * 2) mesh.setAttribute('uv1', new BufferAttribute(new Float32Array(state.uv2s), 2));
  godotResourceEmitChanged(mesh);
}

export function extendedImmediateMeshClearSurfaces(mesh: BufferGeometry): void {
  immediateMeshClearSurfaces(mesh);
  const state = stateOf(mesh); state.normals.length = 0; state.tangents.length = 0; state.colors.length = 0; state.uvs.length = 0; state.uv2s.length = 0;
  mesh.deleteAttribute('tangent'); mesh.deleteAttribute('color'); mesh.deleteAttribute('uv'); mesh.deleteAttribute('uv1');
}

export function releaseImmediateMeshAttributes(mesh: BufferGeometry): void { STATES.delete(mesh); }
