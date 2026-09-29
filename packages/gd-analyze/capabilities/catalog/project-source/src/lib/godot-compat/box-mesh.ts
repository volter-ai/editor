/**
 * @godot-class BoxMesh
 * @role BINDING
 *
 * Godot 4.7's `BoxMesh` (`scene/resources/3d/primitive_meshes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a box of `size`, each face in its cell of Godot's
 * 3×2 UV layout (`BoxMesh::create_mesh_array`, `primitive_meshes.cpp:1170`). A scene draws it as
 * three's `boxGeometry`; a script's box builds these arrays. Subdivisions are stored: each face is
 * one quad.
 */

import { godot_primitive_mesh_describe, godot_primitive_mesh_unchanged, type PrimitiveMesh, type PrimitiveMeshArrays } from './primitive-mesh';
import { construct as vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';

export interface BoxMesh extends PrimitiveMesh {
  size: Vector3;
  subdivide_width: number;
  subdivide_height: number;
  subdivide_depth: number;
}

/**
 * The box's faces: +Z, +X, -Z (top UV row), -X, +Y, -Y (bottom row), each a quad.
 *
 * @godot BoxMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:1170
 */
export function godot_box_mesh_arrays(self: BoxMesh): PrimitiveMeshArrays {
  const [hx, hy, hz] = [self.size.x / 2, self.size.y / 2, self.size.z / 2];
  const faces: readonly (readonly [Vector3, Vector3, Vector3, number, number])[] = [
    [vector3(0, 0, 1), vector3(1, 0, 0), vector3(0, 1, 0), 0, 0],
    [vector3(1, 0, 0), vector3(0, 0, -1), vector3(0, 1, 0), 1, 0],
    [vector3(0, 0, -1), vector3(-1, 0, 0), vector3(0, 1, 0), 2, 0],
    [vector3(-1, 0, 0), vector3(0, 0, 1), vector3(0, 1, 0), 0, 1],
    [vector3(0, 1, 0), vector3(1, 0, 0), vector3(0, 0, -1), 1, 1],
    [vector3(0, -1, 0), vector3(1, 0, 0), vector3(0, 0, 1), 2, 1],
  ];
  const vertices: Vector3[] = [];
  const normals: Vector3[] = [];
  const tangents: number[] = [];
  const uvs: ReturnType<typeof vector2>[] = [];
  const indices: number[] = [];
  for (const [n, u, v, column, row] of faces) {
    const base = vertices.length;
    for (const [su, sv] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
      vertices.push(vector3(n.x * hx + u.x * hx * su + v.x * hy * sv, n.y * hy + u.y * hy * su + v.y * hy * sv, n.z * hz + u.z * hz * su + v.z * hz * sv));
      normals.push(n);
      tangents.push(u.x, u.y, u.z, 1);
      uvs.push(vector2((column + (su + 1) / 2) / 3, (row + (1 - sv) / 2) / 2));
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { vertices, normals, tangents, uvs, indices };
}

/**
 * A 1×1×1 box, undivided (`primitive_meshes.h:192`).
 *
 * @godot BoxMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.h:192
 */
export function construct(): BoxMesh {
  return godot_primitive_mesh_describe<BoxMesh>({ flip_faces: false, size: vector3(1, 1, 1), subdivide_width: 0, subdivide_height: 0, subdivide_depth: 0 }, godot_box_mesh_arrays);
}

/**
 * @godot BoxMesh.set_size
 * @source scene/resources/3d/primitive_meshes.cpp:1330
 */
export function set_size(self: BoxMesh, size: Vector3): void {
  godot_primitive_mesh_unchanged(self, 'BoxMesh.set_size');
  self.size = size;
}

/**
 * @godot BoxMesh.get_size
 * @source scene/resources/3d/primitive_meshes.cpp:1335
 */
export function get_size(self: BoxMesh): Vector3 {
  return self.size;
}

/**
 * @godot BoxMesh.set_subdivide_width
 * @source scene/resources/3d/primitive_meshes.cpp:1339
 */
export function set_subdivide_width(self: BoxMesh, divisions: number): void {
  self.subdivide_width = Math.max(divisions, 0);
}

/**
 * @godot BoxMesh.set_subdivide_height
 * @source scene/resources/3d/primitive_meshes.cpp:1348
 */
export function set_subdivide_height(self: BoxMesh, divisions: number): void {
  self.subdivide_height = Math.max(divisions, 0);
}

/**
 * @godot BoxMesh.set_subdivide_depth
 * @source scene/resources/3d/primitive_meshes.cpp:1357
 */
export function set_subdivide_depth(self: BoxMesh, divisions: number): void {
  self.subdivide_depth = Math.max(divisions, 0);
}
