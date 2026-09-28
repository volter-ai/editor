/**
 * @godot-class SphereMesh
 * @role PROTOCOL
 *
 * Godot 4.7's `SphereMesh` (`scene/resources/3d/primitive_meshes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): rings of radial segments over a sphere (or a
 * hemisphere), built by `SphereMesh::create_mesh_array` (`:1988`) in single precision with the
 * angles in double (`Math::sin(Math::PI * v)`); `primitive-mesh.ts` stores and draws it.
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

export interface SphereMesh extends PrimitiveMesh {
  radius: number;
  height: number;
  radial_segments: number;
  rings: number;
  is_hemisphere: boolean;
}

/**
 * `SphereMesh::create_mesh_array` (`primitive_meshes.cpp:1988`) without UV2.
 *
 * @godot SphereMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:1988
 */
export function godot_sphere_mesh_arrays(self: SphereMesh): PrimitiveMeshArrays {
  const { radius, height, radial_segments: segments, rings, is_hemisphere: hemisphere } = self;
  const vertices: Vector3[] = [];
  const normals: Vector3[] = [];
  const tangents: number[] = [];
  const uvs: Vector2[] = [];
  const indices: number[] = [];
  const scale = f32(f32(height / radius) * (hemisphere ? 1 : 0.5));
  let point = 0;
  let thisrow = 0;
  let prevrow = 0;
  for (let j = 0; j <= rings + 1; j += 1) {
    const v = f32(j / (rings + 1));
    let w: number;
    let y: number;
    if (j === rings + 1) {
      w = 0;
      y = -1;
    } else {
      w = f32(Math.sin(Math.PI * v));
      y = f32(Math.cos(Math.PI * v));
    }
    for (let i = 0; i <= segments; i += 1) {
      const u = f32(i / segments);
      let x: number;
      let z: number;
      if (i === segments) {
        x = 0;
        z = 1;
      } else {
        x = f32(Math.sin(u * TAU));
        z = f32(Math.cos(u * TAU));
      }
      if (hemisphere && y < 0) {
        vertices.push(vector3(f32(f32(x * radius) * w), 0, f32(f32(z * radius) * w)));
        normals.push(vector3(0, -1, 0));
      } else {
        const p = vector3(f32(x * w), f32(y * scale), f32(z * w));
        vertices.push(vector3(f32(p.x * radius), f32(p.y * radius), f32(p.z * radius)));
        normals.push(normalized(vector3(f32(f32(x * w) * scale), y, f32(f32(z * w) * scale))));
      }
      tangents.push(z, 0, -x, 1);
      uvs.push(vector2(u, v));
      point += 1;
      if (i > 0 && j > 0) {
        indices.push(prevrow + i - 1, prevrow + i, thisrow + i - 1, prevrow + i, thisrow + i, thisrow + i - 1);
      }
    }
    prevrow = thisrow;
    thisrow = point;
  }
  return { vertices, normals, tangents, uvs, indices };
}

/**
 * A sphere of radius 0.5 and height 1, 64 radial segments and 32 rings (`primitive_meshes.h:340`).
 *
 * @godot SphereMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.h:340
 */
export function construct(): SphereMesh {
  return godot_primitive_mesh_describe<SphereMesh>(
    { flip_faces: false, radius: 0.5, height: 1, radial_segments: 64, rings: 32, is_hemisphere: false },
    godot_sphere_mesh_arrays,
  );
}

/**
 * A value within `is_equal_approx` of the current one leaves it.
 *
 * @godot SphereMesh.set_radius
 * @source scene/resources/3d/primitive_meshes.cpp:2116
 */
export function set_radius(self: SphereMesh, radius: number): void {
  const value = f32(radius);
  if (equalApprox(value, self.radius)) return;
  self.radius = value;
}

/**
 * @godot SphereMesh.get_radius
 * @source scene/resources/3d/primitive_meshes.cpp:2125
 */
export function get_radius(self: SphereMesh): number {
  return self.radius;
}

/**
 * @godot SphereMesh.set_height
 * @source scene/resources/3d/primitive_meshes.cpp:2129
 */
export function set_height(self: SphereMesh, height: number): void {
  const value = f32(height);
  if (equalApprox(self.height, value)) return;
  self.height = value;
}

/**
 * @godot SphereMesh.get_height
 * @source scene/resources/3d/primitive_meshes.cpp:2138
 */
export function get_height(self: SphereMesh): number {
  return self.height;
}

/**
 * At least 4 segments; below 4 when already 4 is ignored.
 *
 * @godot SphereMesh.set_radial_segments
 * @source scene/resources/3d/primitive_meshes.cpp:2142
 */
export function set_radial_segments(self: SphereMesh, segments: number): void {
  if (segments === self.radial_segments || (self.radial_segments === 4 && segments < 4)) return;
  self.radial_segments = segments > 4 ? segments : 4;
}

/**
 * @godot SphereMesh.get_radial_segments
 * @source scene/resources/3d/primitive_meshes.cpp:2150
 */
export function get_radial_segments(self: SphereMesh): number {
  return self.radial_segments;
}

/**
 * Fewer than 1 ring fails and leaves the rings.
 *
 * @godot SphereMesh.set_rings
 * @source scene/resources/3d/primitive_meshes.cpp:2154
 */
export function set_rings(self: SphereMesh, rings: number): void {
  if (rings === self.rings || rings < 1) return;
  self.rings = rings;
}

/**
 * @godot SphereMesh.get_rings
 * @source scene/resources/3d/primitive_meshes.cpp:2163
 */
export function get_rings(self: SphereMesh): number {
  return self.rings;
}

/**
 * @godot SphereMesh.set_is_hemisphere
 * @source scene/resources/3d/primitive_meshes.cpp:2167
 */
export function set_is_hemisphere(self: SphereMesh, hemisphere: boolean): void {
  self.is_hemisphere = hemisphere;
}

/**
 * @godot SphereMesh.get_is_hemisphere
 * @source scene/resources/3d/primitive_meshes.cpp:2176
 */
export function get_is_hemisphere(self: SphereMesh): boolean {
  return self.is_hemisphere;
}
