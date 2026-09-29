/**
 * @godot-class SurfaceTool
 * @role BINDING
 *
 * Godot 4.7's `SurfaceTool` (`scene/resources/surface_tool.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a list of vertices, each taking the attributes last
 * set, committed as an `ArrayMesh` surface (`array-mesh.ts`, three `BufferGeometry`). Triangles
 * only, as `ArrayMesh` binds them. `generate_normals` sums face normals over vertices at one
 * position and smooth group, as Godot's does; `generate_tangents` is three's
 * `BufferGeometry.computeTangents`, not Godot's MikkTSpace. Bones, weights and custom channels are
 * not bound.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import { godot_array_mesh_new, type ArrayMesh, type GodotArrayMeshSurface } from './array-mesh';
import type { BaseMaterial3D } from './base-material-3d';
import type { Color } from './color';
import type { Vector2 } from './vector2';
import type { Vector3 } from './vector3';

interface Vertex {
  readonly vertex: Vector3;
  normal: Vector3 | null;
  readonly uv: Vector2 | null;
  readonly uv2: Vector2 | null;
  readonly color: Color | null;
  tangent: readonly [number, number, number, number] | null;
  readonly smooth_group: number;
}

export interface SurfaceTool {
  primitive: number;
  vertices: Vertex[];
  indices: number[];
  material: BaseMaterial3D | null;
  last_normal: Vector3 | null;
  last_uv: Vector2 | null;
  last_uv2: Vector2 | null;
  last_color: Color | null;
  last_tangent: readonly [number, number, number, number] | null;
  last_smooth_group: number;
}

/** `PrimitiveType::PRIMITIVE_TRIANGLES`. */
const PRIMITIVE_TRIANGLES = 3;
/** `PrimitiveType::PRIMITIVE_LINES`, the primitive a cleared tool holds. */
const PRIMITIVE_LINES = 1;
const NO_SMOOTH_GROUP = 0xffffffff;

const vec3 = (x: number, y: number, z: number): Vector3 => Object.freeze({ x: Math.fround(x), y: Math.fround(y), z: Math.fround(z) });

function normalized(v: { readonly x: number; readonly y: number; readonly z: number }): Vector3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return length === 0 ? vec3(0, 0, 0) : vec3(v.x / length, v.y / length, v.z / length);
}

/** `Plane(p1, p2, p3).normal`: `(p1 - p3).cross(p1 - p2)`, normalized (`core/math/plane.h`). */
function faceNormal(a: Vector3, b: Vector3, c: Vector3): Vector3 {
  const u = { x: a.x - c.x, y: a.y - c.y, z: a.z - c.z };
  const v = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  return normalized({ x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x });
}

const vertexKey = (v: Vertex) =>
  JSON.stringify([v.vertex, v.normal, v.uv, v.uv2, v.color, v.tangent, v.smooth_group]);

/**
 * `SurfaceTool.new()`.
 *
 * @godot SurfaceTool.SurfaceTool
 * @source scene/resources/surface_tool.cpp:219
 */
export function construct(): SurfaceTool {
  const self = {} as SurfaceTool;
  clear(self);
  return self;
}

/**
 * @godot SurfaceTool.clear
 * @source scene/resources/surface_tool.cpp:1249
 */
export function clear(self: SurfaceTool): void {
  self.primitive = PRIMITIVE_LINES;
  self.vertices = [];
  self.indices = [];
  self.material = null;
  self.last_normal = null;
  self.last_uv = null;
  self.last_uv2 = null;
  self.last_color = null;
  self.last_tangent = null;
  self.last_smooth_group = 0;
}

/**
 * @godot SurfaceTool.begin
 * @source scene/resources/surface_tool.cpp:219
 */
export function begin(self: SurfaceTool, primitive: number): void {
  if (primitive !== PRIMITIVE_TRIANGLES) throw new Error(`godot-compat: SurfaceTool of primitive ${String(primitive)} is not bound`);
  clear(self);
  self.primitive = primitive;
}

/**
 * @godot SurfaceTool.set_normal
 * @source scene/resources/surface_tool.cpp:306
 */
export function set_normal(self: SurfaceTool, normal: Vector3): void {
  self.last_normal = normal;
}

/**
 * @godot SurfaceTool.set_uv
 * @source scene/resources/surface_tool.cpp:323
 */
export function set_uv(self: SurfaceTool, uv: Vector2): void {
  self.last_uv = uv;
}

/**
 * @godot SurfaceTool.set_uv2
 * @source scene/resources/surface_tool.cpp:331
 */
export function set_uv2(self: SurfaceTool, uv2: Vector2): void {
  self.last_uv2 = uv2;
}

/**
 * @godot SurfaceTool.set_color
 * @source scene/resources/surface_tool.cpp:297
 */
export function set_color(self: SurfaceTool, color: Color): void {
  self.last_color = color;
}

/**
 * A tangent `Plane`: its normal the tangent, its `d` the binormal's sign.
 *
 * @godot SurfaceTool.set_tangent
 * @source scene/resources/surface_tool.cpp:315
 */
export function set_tangent(self: SurfaceTool, tangent: { readonly normal: Vector3; readonly d: number }): void {
  self.last_tangent = [tangent.normal.x, tangent.normal.y, tangent.normal.z, tangent.d < 0 ? -1 : 1];
}

/**
 * @godot SurfaceTool.set_smooth_group
 * @source scene/resources/surface_tool.cpp:374
 */
export function set_smooth_group(self: SurfaceTool, index: number): void {
  self.last_smooth_group = index >>> 0;
}

/**
 * @godot SurfaceTool.set_material
 * @source scene/resources/surface_tool.cpp:1241
 */
export function set_material(self: SurfaceTool, material: BaseMaterial3D | null): void {
  self.material = material;
}

/**
 * A vertex with the attributes last set.
 *
 * @godot SurfaceTool.add_vertex
 * @source scene/resources/surface_tool.cpp:227
 */
export function add_vertex(self: SurfaceTool, vertex: Vector3): void {
  self.vertices.push({
    vertex,
    normal: self.last_normal,
    uv: self.last_uv,
    uv2: self.last_uv2,
    color: self.last_color,
    tangent: self.last_tangent,
    smooth_group: self.last_smooth_group,
  });
}

/**
 * @godot SurfaceTool.add_index
 * @source scene/resources/surface_tool.cpp:411
 */
export function add_index(self: SurfaceTool, index: number): void {
  self.indices.push(index);
}

/**
 * Shares equal vertices through an index array; a tool already indexed is left as it is.
 *
 * @godot SurfaceTool.index
 * @source scene/resources/surface_tool.cpp:748
 */
export function index(self: SurfaceTool): void {
  if (self.indices.length > 0) return;
  const seen = new Map<string, number>();
  const kept: Vertex[] = [];
  for (const vertex of self.vertices) {
    const key = vertexKey(vertex);
    let at = seen.get(key);
    if (at === undefined) {
      at = kept.length;
      seen.set(key, at);
      kept.push(vertex);
    }
    self.indices.push(at);
  }
  self.vertices = kept;
}

/**
 * @godot SurfaceTool.deindex
 * @source scene/resources/surface_tool.cpp:775
 */
export function deindex(self: SurfaceTool): void {
  if (self.indices.length === 0) return;
  self.vertices = self.indices.map((at) => ({ ...(self.vertices[at] as Vertex) }));
  self.indices = [];
}

/**
 * Each triangle's face normal, summed and normalized over the vertices one position and smooth
 * group share (a vertex outside every group, `UINT32_MAX`, takes its face's own).
 *
 * @godot SurfaceTool.generate_normals
 * @source scene/resources/surface_tool.cpp:1187
 */
export function generate_normals(self: SurfaceTool, flip = false): void {
  const wasIndexed = self.indices.length > 0;
  deindex(self);
  const key = (v: Vertex) => `${v.vertex.x},${v.vertex.y},${v.vertex.z},${v.smooth_group}`;
  const sums = new Map<string, { x: number; y: number; z: number }>();
  const vertices = self.vertices.map((vertex) => ({ ...vertex }));
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const [a, b, c] = [vertices[i] as Vertex, vertices[i + 1] as Vertex, vertices[i + 2] as Vertex];
    const normal = flip ? faceNormal(c.vertex, b.vertex, a.vertex) : faceNormal(a.vertex, b.vertex, c.vertex);
    for (const v of [a, b, c]) {
      if (v.smooth_group === NO_SMOOTH_GROUP) {
        v.normal = normal;
        continue;
      }
      const sum = sums.get(key(v));
      if (sum === undefined) sums.set(key(v), { ...normal });
      else {
        sum.x += normal.x;
        sum.y += normal.y;
        sum.z += normal.z;
      }
    }
  }
  for (const v of vertices) {
    if (v.smooth_group !== NO_SMOOTH_GROUP) v.normal = normalized(sums.get(key(v)) ?? { x: 0, y: 0, z: 0 });
  }
  self.vertices = vertices;
  if (wasIndexed) index(self);
}

/**
 * Tangents from the UVs and normals every vertex needs, as three's `computeTangents` gives them.
 *
 * @godot SurfaceTool.generate_tangents
 * @source scene/resources/surface_tool.cpp:1156
 */
export function generate_tangents(self: SurfaceTool): void {
  if (self.vertices.some((v) => v.uv === null || v.normal === null)) throw new Error('godot-compat: SurfaceTool.generate_tangents needs UVs and normals on every vertex');
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(self.vertices.flatMap((v) => [v.vertex.x, v.vertex.y, v.vertex.z])), 3));
  geometry.setAttribute('normal', new BufferAttribute(Float32Array.from(self.vertices.flatMap((v) => [v.normal!.x, v.normal!.y, v.normal!.z])), 3));
  geometry.setAttribute('uv', new BufferAttribute(Float32Array.from(self.vertices.flatMap((v) => [v.uv!.x, v.uv!.y])), 2));
  geometry.setIndex(self.indices.length > 0 ? [...self.indices] : self.vertices.map((_, i) => i));
  geometry.computeTangents();
  const tangents = geometry.getAttribute('tangent');
  self.vertices = self.vertices.map((v, i) => ({ ...v, tangent: [tangents.getX(i), tangents.getY(i), tangents.getZ(i), tangents.getW(i)] as const }));
  geometry.dispose();
}

/** The tool's arrays as one `ArrayMesh` surface; an attribute no vertex set is absent. */
function surfaceOf(self: SurfaceTool): GodotArrayMeshSurface {
  const vs = self.vertices;
  const present = <T>(read: (v: Vertex) => T | null): boolean => vs.some((v) => read(v) !== null);
  const flat = <T>(read: (v: Vertex) => T | null, parts: (value: T | null) => readonly number[]) => vs.flatMap((v) => parts(read(v)));
  return {
    primitive: self.primitive,
    vertex: flat((v) => v.vertex, (p) => [p!.x, p!.y, p!.z]),
    ...(present((v) => v.normal) ? { normal: flat((v) => v.normal, (p) => (p === null ? [0, 0, 0] : [p.x, p.y, p.z])) } : {}),
    ...(present((v) => v.tangent) ? { tangent: flat((v) => v.tangent, (p) => p ?? [1, 0, 0, 1]) } : {}),
    ...(present((v) => v.color) ? { color: flat((v) => v.color, (p) => (p === null ? [1, 1, 1, 1] : [p.r, p.g, p.b, p.a])) } : {}),
    ...(present((v) => v.uv) ? { tex_uv: flat((v) => v.uv, (p) => (p === null ? [0, 0] : [p.x, p.y])) } : {}),
    ...(present((v) => v.uv2) ? { tex_uv2: flat((v) => v.uv2, (p) => (p === null ? [0, 0] : [p.x, p.y])) } : {}),
    ...(self.indices.length > 0 ? { index: [...self.indices] } : {}),
    material: self.material,
  };
}

/**
 * The tool's surface added to `existing`, or to a new `ArrayMesh`; a tool with no vertices adds
 * nothing.
 *
 * @godot SurfaceTool.commit
 * @source scene/resources/surface_tool.cpp:713
 */
export function commit(self: SurfaceTool, existing: ArrayMesh | null = null, _flags = 0): ArrayMesh {
  const surfaces = self.vertices.length === 0 ? [] : [surfaceOf(self)];
  if (existing === null) return godot_array_mesh_new({ surfaces });
  (existing.surfaces as GodotArrayMeshSurface[]).push(...surfaces);
  return existing;
}
