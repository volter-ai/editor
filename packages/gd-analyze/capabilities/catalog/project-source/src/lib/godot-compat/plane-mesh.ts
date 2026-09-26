/**
 * @godot-class PlaneMesh
 * @role PROTOCOL
 *
 * Godot 4.7's `PlaneMesh` (`scene/resources/3d/primitive_meshes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a subdivided rectangle facing X, Y or Z, built by
 * `PlaneMesh::_create_mesh_array` (`:1417`) in single precision; `primitive-mesh.ts` stores and
 * draws it.
 */

import { godot_primitive_mesh_describe, type PrimitiveMesh, type PrimitiveMeshArrays } from './primitive-mesh';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function equalApprox(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(f32(0.00001) * Math.abs(left));
  if (tolerance < f32(0.00001)) tolerance = f32(0.00001);
  return Math.abs(f32(left - right)) < tolerance;
}

/** `PlaneMesh::Orientation` (`primitive_meshes.h:241`). */
const FACE_X = 0;
const FACE_Y = 1;
const FACE_Z = 2;

export interface PlaneMesh extends PrimitiveMesh {
  size: Vector2;
  subdivide_width: number;
  subdivide_depth: number;
  center_offset: Vector3;
  orientation: number;
}

/**
 * `PlaneMesh::_create_mesh_array` (`primitive_meshes.cpp:1417`), `float` where the C++ is.
 *
 * @godot PlaneMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:1417
 */
export function godot_plane_mesh_arrays(self: PlaneMesh): PrimitiveMeshArrays {
  const vertices: Vector3[] = [];
  const normals: Vector3[] = [];
  const tangents: number[] = [];
  const uvs: Vector2[] = [];
  const indices: number[] = [];
  const startX = f32(self.size.x * -0.5);
  const startY = f32(self.size.y * -0.5);
  const normal =
    self.orientation === FACE_X ? vector3(1, 0, 0) : self.orientation === FACE_Z ? vector3(0, 0, 1) : vector3(0, 1, 0);
  const offset = self.center_offset;
  const w = self.subdivide_width;
  const d = self.subdivide_depth;
  let point = 0;
  let z = startY;
  let thisrow = point;
  let prevrow = 0;
  for (let j = 0; j <= d + 1; j += 1) {
    let x = startX;
    for (let i = 0; i <= w + 1; i += 1) {
      // `float u = i; u /= (subdivide_w + 1.0);`: a double division stored in a float.
      const u = f32(i / (w + 1));
      const v = f32(j / (d + 1));
      if (self.orientation === FACE_X) {
        vertices.push(vector3(f32(0 + offset.x), f32(z + offset.y), f32(x + offset.z)));
      } else if (self.orientation === FACE_Y) {
        vertices.push(vector3(f32(-x + offset.x), f32(0 + offset.y), f32(-z + offset.z)));
      } else {
        vertices.push(vector3(f32(-x + offset.x), f32(z + offset.y), f32(0 + offset.z)));
      }
      normals.push(normal);
      if (self.orientation === FACE_X) tangents.push(0, 0, -1, 1);
      else tangents.push(1, 0, 0, 1);
      uvs.push(vector2(f32(1 - u), f32(1 - v)));
      point += 1;
      if (i > 0 && j > 0) {
        indices.push(prevrow + i - 1, prevrow + i, thisrow + i - 1, prevrow + i, thisrow + i, thisrow + i - 1);
      }
      x = f32(x + self.size.x / (w + 1));
    }
    z = f32(z + self.size.y / (d + 1));
    prevrow = thisrow;
    thisrow = point;
  }
  return { vertices, normals, tangents, uvs, indices };
}

/**
 * A plane of size (2, 2) facing Y (`primitive_meshes.h:253`).
 *
 * @godot PlaneMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.h:253
 */
export function construct(): PlaneMesh {
  return godot_primitive_mesh_describe<PlaneMesh>(
    {
      flip_faces: false,
      size: vector2(2, 2),
      subdivide_width: 0,
      subdivide_depth: 0,
      center_offset: vector3(0, 0, 0),
      orientation: FACE_Y,
    },
    godot_plane_mesh_arrays,
  );
}

/**
 * @godot PlaneMesh.set_size
 * @source scene/resources/3d/primitive_meshes.cpp:1531
 */
export function set_size(self: PlaneMesh, size: Vector2): void {
  self.size = vector2(size);
}

/**
 * @godot PlaneMesh.get_size
 * @source scene/resources/3d/primitive_meshes.cpp:1540
 */
export function get_size(self: PlaneMesh): Vector2 {
  return self.size;
}

/**
 * Negative divisions store 0 (`subdivide_w = p_divisions > 0 ? p_divisions : 0`).
 *
 * @godot PlaneMesh.set_subdivide_width
 * @source scene/resources/3d/primitive_meshes.cpp:1544
 */
export function set_subdivide_width(self: PlaneMesh, divisions: number): void {
  self.subdivide_width = divisions > 0 ? divisions : 0;
}

/**
 * @godot PlaneMesh.get_subdivide_width
 * @source scene/resources/3d/primitive_meshes.cpp:1552
 */
export function get_subdivide_width(self: PlaneMesh): number {
  return self.subdivide_width;
}

/**
 * @godot PlaneMesh.set_subdivide_depth
 * @source scene/resources/3d/primitive_meshes.cpp:1556
 */
export function set_subdivide_depth(self: PlaneMesh, divisions: number): void {
  self.subdivide_depth = divisions > 0 ? divisions : 0;
}

/**
 * @godot PlaneMesh.get_subdivide_depth
 * @source scene/resources/3d/primitive_meshes.cpp:1564
 */
export function get_subdivide_depth(self: PlaneMesh): number {
  return self.subdivide_depth;
}

/**
 * @godot PlaneMesh.set_center_offset
 * @source scene/resources/3d/primitive_meshes.cpp:1568
 */
export function set_center_offset(self: PlaneMesh, offset: Vector3): void {
  const current = self.center_offset;
  if (equalApprox(offset.x, current.x) && equalApprox(offset.y, current.y) && equalApprox(offset.z, current.z)) return;
  self.center_offset = offset;
}

/**
 * @godot PlaneMesh.get_center_offset
 * @source scene/resources/3d/primitive_meshes.cpp:1576
 */
export function get_center_offset(self: PlaneMesh): Vector3 {
  return self.center_offset;
}

/**
 * @godot PlaneMesh.set_orientation
 * @source scene/resources/3d/primitive_meshes.cpp:1580
 */
export function set_orientation(self: PlaneMesh, orientation: number): void {
  self.orientation = orientation;
}

/**
 * @godot PlaneMesh.get_orientation
 * @source scene/resources/3d/primitive_meshes.cpp:1588
 */
export function get_orientation(self: PlaneMesh): number {
  return self.orientation;
}

const FACING_Y = new WeakSet<object>();

/**
 * Turns three's plane (in XY, facing +Z) to face +Y as Godot's `PlaneMesh` does by default
 * (`ORIENTATION_FACE_Y`, `primitive_meshes.cpp`): a rotation of -90 degrees about X, applied
 * once to a geometry however often R3F reports its update.
 *
 * @godot PlaneMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:1467
 */
export function godot_plane_mesh_face_y(geometry: { rotateX(angle: number): unknown }): void {
  if (FACING_Y.has(geometry)) return;
  FACING_Y.add(geometry);
  geometry.rotateX(-Math.PI / 2);
}

const FACING_X = new WeakSet<object>();

/**
 * Turns three's plane (in XY, facing +Z) to face +X as Godot's `ORIENTATION_FACE_X` plane does
 * (`primitive_meshes.cpp:1465`: its width along Z, its height along Y): a rotation of 90 degrees
 * about Y, applied once to a geometry however often R3F reports its update.
 *
 * @godot PlaneMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:1465
 */
export function godot_plane_mesh_face_x(geometry: { rotateY(angle: number): unknown }): void {
  if (FACING_X.has(geometry)) return;
  FACING_X.add(geometry);
  geometry.rotateY(Math.PI / 2);
}
