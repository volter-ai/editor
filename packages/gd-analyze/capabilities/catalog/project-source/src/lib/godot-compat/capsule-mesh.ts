/**
 * @godot-class CapsuleMesh
 * @role BINDING
 *
 * Godot 4.7's `CapsuleMesh` (`scene/resources/3d/primitive_meshes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a cylinder of its height less its two hemispherical
 * caps, as three's `CapsuleGeometry` of the same radius, straight length, rings to a cap and
 * segments around (a scene draws the geometry itself, `<capsuleGeometry>`). Its vertices and UVs
 * are three's, not Godot's `create_mesh_array` (`:410`). The radius never exceeds half the height,
 * either setter moving the other (`set_radius`, `:632`).
 */

import { CapsuleGeometry } from 'three';
import { godot_primitive_mesh_describe, godot_primitive_mesh_unchanged, type PrimitiveMesh, type PrimitiveMeshArrays } from './primitive-mesh';
import { construct as vector2 } from './vector2';
import { construct as vector3 } from './vector3';

export interface CapsuleMesh extends PrimitiveMesh {
  radius: number;
  height: number;
  radial_segments: number;
  rings: number;
}

/**
 * The capsule's arrays from three's geometry in Godot's conventions (`primitive-mesh.ts`): its
 * triangles wound as Godot's, its UVs from the image's top row, tangents along the rings.
 *
 * @godot CapsuleMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:410
 */
export function godot_capsule_mesh_arrays(self: CapsuleMesh): PrimitiveMeshArrays {
  const geometry = new CapsuleGeometry(self.radius, Math.max(self.height - self.radius * 2, 0), Math.max(self.rings, 1), Math.max(self.radial_segments, 3));
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const count = position.count;
  const arrays: PrimitiveMeshArrays = {
    vertices: Array.from({ length: count }, (_, i) => vector3(position.getX(i), position.getY(i), position.getZ(i))),
    normals: Array.from({ length: count }, (_, i) => vector3(normal.getX(i), normal.getY(i), normal.getZ(i))),
    tangents: Array.from({ length: count }, (_, i) => [-normal.getZ(i), 0, normal.getX(i), 1]).flat(),
    uvs: Array.from({ length: count }, (_, i) => vector2(uv.getX(i), 1 - uv.getY(i))),
    // Godot's winding (clockwise on screen, `primitive-mesh.ts`): each triangle's last two swapped.
    indices: Array.from({ length: index === null ? count : index.count }, (_, i) => {
      const corner = i - (i % 3) + [0, 2, 1][i % 3]!;
      return index === null ? corner : index.getX(corner);
    }),
  };
  geometry.dispose();
  return arrays;
}

/**
 * @godot CapsuleMesh.CapsuleMesh
 * @source scene/resources/3d/primitive_meshes.cpp:410
 */
export function construct(): CapsuleMesh {
  return godot_primitive_mesh_describe<CapsuleMesh>({ flip_faces: false, radius: 0.5, height: 2, radial_segments: 64, rings: 8 }, godot_capsule_mesh_arrays);
}

/**
 * @godot CapsuleMesh.set_radius
 * @source scene/resources/3d/primitive_meshes.cpp:632
 */
export function set_radius(self: CapsuleMesh, radius: number): void {
  godot_primitive_mesh_unchanged(self, 'CapsuleMesh.set_radius');
  self.radius = radius;
  if (self.radius > self.height * 0.5) self.height = self.radius * 2;
}

/**
 * @godot CapsuleMesh.get_radius
 * @source scene/resources/3d/primitive_meshes.cpp:645
 */
export function get_radius(self: CapsuleMesh): number {
  return self.radius;
}

/**
 * @godot CapsuleMesh.set_height
 * @source scene/resources/3d/primitive_meshes.cpp:649
 */
export function set_height(self: CapsuleMesh, height: number): void {
  godot_primitive_mesh_unchanged(self, 'CapsuleMesh.set_height');
  self.height = height;
  if (self.radius > self.height * 0.5) self.radius = self.height * 0.5;
}

/**
 * @godot CapsuleMesh.get_height
 * @source scene/resources/3d/primitive_meshes.cpp:662
 */
export function get_height(self: CapsuleMesh): number {
  return self.height;
}

/**
 * @godot CapsuleMesh.set_radial_segments
 * @source scene/resources/3d/primitive_meshes.cpp:666
 */
export function set_radial_segments(self: CapsuleMesh, segments: number): void {
  godot_primitive_mesh_unchanged(self, 'CapsuleMesh.set_radial_segments');
  self.radial_segments = segments > 4 ? segments : 4;
}

/**
 * @godot CapsuleMesh.set_rings
 * @source scene/resources/3d/primitive_meshes.cpp:679
 */
export function set_rings(self: CapsuleMesh, rings: number): void {
  godot_primitive_mesh_unchanged(self, 'CapsuleMesh.set_rings');
  self.rings = rings > 0 ? rings : 0;
}
