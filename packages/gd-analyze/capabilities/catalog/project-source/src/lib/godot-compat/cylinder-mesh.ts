/**
 * @godot-class CylinderMesh
 * @role PROTOCOL
 *
 * Godot 4.7's `CylinderMesh` (`scene/resources/3d/primitive_meshes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a side of rings between two radii and optional caps,
 * built by `CylinderMesh::create_mesh_array` (`:1075`) in single precision with the angles in
 * double; `primitive-mesh.ts` stores and draws it.
 */

import { godot_primitive_mesh_describe, type PrimitiveMesh, type PrimitiveMeshArrays } from './primitive-mesh';
import { construct as vector2, type Vector2 } from './vector2';
import { normalized, construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;
const TAU = 6.283185307179586;

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function equalApprox(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(f32(0.00001) * Math.abs(left));
  if (tolerance < f32(0.00001)) tolerance = f32(0.00001);
  return Math.abs(f32(left - right)) < tolerance;
}

export interface CylinderMesh extends PrimitiveMesh {
  top_radius: number;
  bottom_radius: number;
  height: number;
  radial_segments: number;
  rings: number;
  cap_top: boolean;
  cap_bottom: boolean;
}

/** `(sin(r * TAU), cos(r * TAU))` for segment `i`, the last segment closing at (0, 1). */
function around(i: number, segments: number): [number, number] {
  if (i === segments) return [0, 1];
  const r = f32(i / segments);
  return [f32(Math.sin(r * TAU)), f32(Math.cos(r * TAU))];
}

/**
 * `CylinderMesh::create_mesh_array` (`primitive_meshes.cpp:1075`) without UV2.
 *
 * @godot CylinderMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:1075
 */
export function godot_cylinder_mesh_arrays(self: CylinderMesh): PrimitiveMeshArrays {
  const { top_radius: top, bottom_radius: bottom, height, radial_segments: segments, rings } = self;
  const vertices: Vector3[] = [];
  const normals: Vector3[] = [];
  const tangents: number[] = [];
  const uvs: Vector2[] = [];
  const indices: number[] = [];
  let point = 0;
  let thisrow = 0;
  let prevrow = 0;
  const sideNormalY = f32(f32(bottom - top) / height);
  for (let j = 0; j <= rings + 1; j += 1) {
    const v = f32(j / (rings + 1));
    const radius = f32(top + f32(f32(bottom - top) * v));
    let y = f32(height * v);
    y = f32(height * 0.5 - y);
    for (let i = 0; i <= segments; i += 1) {
      const u = f32(i / segments);
      const [x, z] = around(i, segments);
      vertices.push(vector3(f32(x * radius), y, f32(z * radius)));
      normals.push(normalized(vector3(x, sideNormalY, z)));
      tangents.push(z, 0, -x, 1);
      uvs.push(vector2(u, f32(v * 0.5)));
      point += 1;
      if (i > 0 && j > 0) {
        indices.push(prevrow + i - 1, prevrow + i, thisrow + i - 1, prevrow + i, thisrow + i, thisrow + i - 1);
      }
    }
    prevrow = thisrow;
    thisrow = point;
  }
  if (self.cap_top && top > 0) {
    const y = f32(height * 0.5);
    thisrow = point;
    vertices.push(vector3(0, y, 0));
    normals.push(vector3(0, 1, 0));
    tangents.push(1, 0, 0, 1);
    uvs.push(vector2(0.25, 0.75));
    point += 1;
    for (let i = 0; i <= segments; i += 1) {
      const [x, z] = around(i, segments);
      vertices.push(vector3(f32(x * top), y, f32(z * top)));
      normals.push(vector3(0, 1, 0));
      tangents.push(1, 0, 0, 1);
      uvs.push(vector2(f32((x + 1) * 0.25), f32(0.5 + (z + 1) * 0.25)));
      point += 1;
      if (i > 0) indices.push(thisrow, point - 1, point - 2);
    }
  }
  if (self.cap_bottom && bottom > 0) {
    const y = f32(height * -0.5);
    thisrow = point;
    vertices.push(vector3(0, y, 0));
    normals.push(vector3(0, -1, 0));
    tangents.push(1, 0, 0, 1);
    uvs.push(vector2(0.75, 0.75));
    point += 1;
    for (let i = 0; i <= segments; i += 1) {
      const [x, z] = around(i, segments);
      vertices.push(vector3(f32(x * bottom), y, f32(z * bottom)));
      normals.push(vector3(0, -1, 0));
      tangents.push(1, 0, 0, 1);
      uvs.push(vector2(f32(0.5 + (x + 1) * 0.25), f32(1 - (z + 1) * 0.25)));
      point += 1;
      if (i > 0) indices.push(thisrow, point - 2, point - 1);
    }
  }
  return { vertices, normals, tangents, uvs, indices };
}

/**
 * Radii 0.5, height 2, 64 radial segments, 4 rings, both caps (`primitive_meshes.h:200`).
 *
 * @godot CylinderMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.h:200
 */
export function construct(): CylinderMesh {
  return godot_primitive_mesh_describe<CylinderMesh>(
    {
      flip_faces: false,
      top_radius: 0.5,
      bottom_radius: 0.5,
      height: 2,
      radial_segments: 64,
      rings: 4,
      cap_top: true,
      cap_bottom: true,
    },
    godot_cylinder_mesh_arrays,
  );
}

/**
 * @godot CylinderMesh.set_top_radius
 * @source scene/resources/3d/primitive_meshes.cpp:1305
 */
export function set_top_radius(self: CylinderMesh, radius: number): void {
  const value = f32(radius);
  if (equalApprox(value, self.top_radius)) return;
  self.top_radius = value;
}

/**
 * @godot CylinderMesh.get_top_radius
 * @source scene/resources/3d/primitive_meshes.cpp:1315
 */
export function get_top_radius(self: CylinderMesh): number {
  return self.top_radius;
}

/**
 * @godot CylinderMesh.set_bottom_radius
 * @source scene/resources/3d/primitive_meshes.cpp:1319
 */
export function set_bottom_radius(self: CylinderMesh, radius: number): void {
  const value = f32(radius);
  if (equalApprox(value, self.bottom_radius)) return;
  self.bottom_radius = value;
}

/**
 * @godot CylinderMesh.get_bottom_radius
 * @source scene/resources/3d/primitive_meshes.cpp:1329
 */
export function get_bottom_radius(self: CylinderMesh): number {
  return self.bottom_radius;
}

/**
 * @godot CylinderMesh.set_height
 * @source scene/resources/3d/primitive_meshes.cpp:1333
 */
export function set_height(self: CylinderMesh, height: number): void {
  const value = f32(height);
  if (equalApprox(value, self.height)) return;
  self.height = value;
}

/**
 * @godot CylinderMesh.get_height
 * @source scene/resources/3d/primitive_meshes.cpp:1343
 */
export function get_height(self: CylinderMesh): number {
  return self.height;
}

/**
 * At least 4 segments.
 *
 * @godot CylinderMesh.set_radial_segments
 * @source scene/resources/3d/primitive_meshes.cpp:1347
 */
export function set_radial_segments(self: CylinderMesh, segments: number): void {
  if (segments === self.radial_segments) return;
  self.radial_segments = segments > 4 ? segments : 4;
}

/**
 * @godot CylinderMesh.get_radial_segments
 * @source scene/resources/3d/primitive_meshes.cpp:1356
 */
export function get_radial_segments(self: CylinderMesh): number {
  return self.radial_segments;
}

/**
 * A negative ring count fails and leaves the rings.
 *
 * @godot CylinderMesh.set_rings
 * @source scene/resources/3d/primitive_meshes.cpp:1360
 */
export function set_rings(self: CylinderMesh, rings: number): void {
  if (rings === self.rings || rings < 0) return;
  self.rings = rings;
}

/**
 * @godot CylinderMesh.get_rings
 * @source scene/resources/3d/primitive_meshes.cpp:1370
 */
export function get_rings(self: CylinderMesh): number {
  return self.rings;
}

/**
 * @godot CylinderMesh.set_cap_top
 * @source scene/resources/3d/primitive_meshes.cpp:1374
 */
export function set_cap_top(self: CylinderMesh, cap: boolean): void {
  self.cap_top = cap;
}

/**
 * @godot CylinderMesh.is_cap_top
 * @source scene/resources/3d/primitive_meshes.cpp:1383
 */
export function is_cap_top(self: CylinderMesh): boolean {
  return self.cap_top;
}

/**
 * @godot CylinderMesh.set_cap_bottom
 * @source scene/resources/3d/primitive_meshes.cpp:1387
 */
export function set_cap_bottom(self: CylinderMesh, cap: boolean): void {
  self.cap_bottom = cap;
}

/**
 * @godot CylinderMesh.is_cap_bottom
 * @source scene/resources/3d/primitive_meshes.cpp:1396
 */
export function is_cap_bottom(self: CylinderMesh): boolean {
  return self.cap_bottom;
}
