/**
 * @godot-class RibbonTrailMesh
 * @role PROTOCOL
 *
 * Godot 4.7's `RibbonTrailMesh` (`scene/resources/3d/primitive_meshes.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a strip (or two crossed strips) `sections` long down
 * its Y, each section `section_length` and cut into `section_segments`, `size` wide scaled by
 * `curve` along it, built by `RibbonTrailMesh::_create_mesh_array` (`:2884`). Each of its rows is
 * bound to the two bones of its section, blended across it, and its `sections + 1` bones' bind poses
 * are rows along Y (`get_builtin_bind_pose`, `:2874`): a particle system with trails places them at
 * its particles' past transforms (`cpu-particles-3d.ts`). `primitive-mesh.ts` stores and draws it.
 */

import { type Curve, get_point_count, sample_baked } from './curve';
import { godot_primitive_mesh_describe, godot_primitive_mesh_describe_skin, godot_primitive_mesh_unchanged, type PrimitiveMesh, type PrimitiveMeshArrays, type PrimitiveMeshSkin } from './primitive-mesh';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;
const SHAPE_CROSS = 1;

export interface RibbonTrailMesh extends PrimitiveMesh {
  shape: number;
  size: number;
  sections: number;
  section_length: number;
  section_segments: number;
  curve: Curve | null;
}

/** The strips' width at `v` down the trail. */
function widthAt(self: RibbonTrailMesh, v: number): number {
  return self.curve !== null && get_point_count(self.curve) > 0 ? f32(self.size * sample_baked(self.curve, v)) : self.size;
}

/**
 * `RibbonTrailMesh::_create_mesh_array` (`primitive_meshes.cpp:2884`).
 *
 * @godot RibbonTrailMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:2884
 */
export function godot_ribbon_trail_mesh_arrays(self: RibbonTrailMesh): PrimitiveMeshArrays {
  const total = self.section_segments * self.sections;
  const depth = f32(self.section_length * self.sections);
  const cross = self.shape === SHAPE_CROSS;
  const vertices: Vector3[] = [];
  const normals: Vector3[] = [];
  const tangents: number[] = [];
  const uvs: Vector2[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= total; j += 1) {
    const v = f32(j / total);
    const y = f32(f32(depth * 0.5) - f32(depth * v));
    const s = widthAt(self, v);
    vertices.push(vector3(f32(-s * 0.5), y, 0), vector3(f32(s * 0.5), y, 0));
    normals.push(vector3(0, 0, 1), vector3(0, 0, 1));
    uvs.push(vector2(0, v), vector2(1, v));
    tangents.push(0, 1, 0, 1, 0, 1, 0, 1);
    if (cross) {
      vertices.push(vector3(0, y, f32(-s * 0.5)), vector3(0, y, f32(s * 0.5)));
      normals.push(vector3(1, 0, 0), vector3(1, 0, 0));
      uvs.push(vector2(0, v), vector2(1, v));
      tangents.push(0, 1, 0, 1, 0, 1, 0, 1);
    }
    if (j === 0) continue;
    if (cross) {
      const base = j * 4 - 4;
      indices.push(base, base + 1, base + 4, base + 1, base + 5, base + 4, base + 2, base + 3, base + 6, base + 3, base + 7, base + 6);
    } else {
      const base = j * 2 - 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  return { vertices, normals, tangents, uvs, indices };
}

/**
 * Each row's two bones and weights (`_create_mesh_array`'s `ARRAY_BONES`, `ARRAY_WEIGHTS`), and the
 * bones' bind poses (`get_builtin_bind_pose`, `:2874`): row `j` of section `j / section_segments`,
 * blended toward the next bone across it; bone `k`'s pose the inverse of its row's place on Y.
 *
 * @godot RibbonTrailMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.cpp:2874
 */
export function godot_ribbon_trail_mesh_skin(self: RibbonTrailMesh): PrimitiveMeshSkin {
  const total = self.section_segments * self.sections;
  const bones: number[] = [];
  const weights: number[] = [];
  for (let j = 0; j <= total; j += 1) {
    const bone = Math.floor(j / self.section_segments);
    const blend = f32(1 - f32((j % self.section_segments) / self.section_segments));
    for (let side = 0; side < (self.shape === SHAPE_CROSS ? 4 : 2); side += 1) {
      bones.push(bone, Math.min(self.sections, bone + 1));
      weights.push(blend, f32(1 - blend));
    }
  }
  const depth = f32(self.section_length * self.sections);
  const bindY = Array.from({ length: self.sections + 1 }, (_, k) => -f32(f32(depth / 2) - f32(self.section_length * k)));
  return { bones, weights, bindY };
}

/**
 * Two crossed strips a metre wide, five sections of 0.2 each cut in three (`primitive_meshes.h:478`).
 *
 * @godot RibbonTrailMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.h:478
 */
export function construct(): RibbonTrailMesh {
  const mesh = godot_primitive_mesh_describe<RibbonTrailMesh>(
    { flip_faces: false, shape: SHAPE_CROSS, size: 1, sections: 5, section_length: f32(0.2), section_segments: 3, curve: null },
    godot_ribbon_trail_mesh_arrays,
  );
  return godot_primitive_mesh_describe_skin(mesh, godot_ribbon_trail_mesh_skin);
}

/**
 * @godot RibbonTrailMesh.set_shape
 * @source scene/resources/3d/primitive_meshes.cpp:2793
 */
export function set_shape(self: RibbonTrailMesh, shape: number): void {
  if (shape === self.shape) return;
  godot_primitive_mesh_unchanged(self, 'RibbonTrailMesh.set_shape');
  self.shape = shape;
}

/**
 * @godot RibbonTrailMesh.get_shape
 * @source scene/resources/3d/primitive_meshes.cpp:2800
 */
export function get_shape(self: RibbonTrailMesh): number {
  return self.shape;
}

/**
 * @godot RibbonTrailMesh.set_size
 * @source scene/resources/3d/primitive_meshes.cpp:2804
 */
export function set_size(self: RibbonTrailMesh, size: number): void {
  const value = f32(size);
  if (value === self.size) return;
  godot_primitive_mesh_unchanged(self, 'RibbonTrailMesh.set_size');
  self.size = value;
}

/**
 * @godot RibbonTrailMesh.get_size
 * @source scene/resources/3d/primitive_meshes.cpp:2811
 */
export function get_size(self: RibbonTrailMesh): number {
  return self.size;
}

/**
 * Two to 128 sections; another count fails and leaves it.
 *
 * @godot RibbonTrailMesh.set_sections
 * @source scene/resources/3d/primitive_meshes.cpp:2815
 */
export function set_sections(self: RibbonTrailMesh, sections: number): void {
  if (sections === self.sections) return;
  if (sections < 2 || sections > 128) return;
  godot_primitive_mesh_unchanged(self, 'RibbonTrailMesh.set_sections');
  self.sections = sections;
}

/**
 * @godot RibbonTrailMesh.get_sections
 * @source scene/resources/3d/primitive_meshes.cpp:2823
 */
export function get_sections(self: RibbonTrailMesh): number {
  return self.sections;
}

/**
 * @godot RibbonTrailMesh.set_section_length
 * @source scene/resources/3d/primitive_meshes.cpp:2827
 */
export function set_section_length(self: RibbonTrailMesh, section_length: number): void {
  const value = f32(section_length);
  if (value === self.section_length) return;
  godot_primitive_mesh_unchanged(self, 'RibbonTrailMesh.set_section_length');
  self.section_length = value;
}

/**
 * @godot RibbonTrailMesh.get_section_length
 * @source scene/resources/3d/primitive_meshes.cpp:2834
 */
export function get_section_length(self: RibbonTrailMesh): number {
  return self.section_length;
}

/**
 * One to 1024 segments; another count fails and leaves it.
 *
 * @godot RibbonTrailMesh.set_section_segments
 * @source scene/resources/3d/primitive_meshes.cpp:2838
 */
export function set_section_segments(self: RibbonTrailMesh, section_segments: number): void {
  if (section_segments === self.section_segments) return;
  if (section_segments < 1 || section_segments > 1024) return;
  godot_primitive_mesh_unchanged(self, 'RibbonTrailMesh.set_section_segments');
  self.section_segments = section_segments;
}

/**
 * @godot RibbonTrailMesh.get_section_segments
 * @source scene/resources/3d/primitive_meshes.cpp:2846
 */
export function get_section_segments(self: RibbonTrailMesh): number {
  return self.section_segments;
}

/**
 * @godot RibbonTrailMesh.set_curve
 * @source scene/resources/3d/primitive_meshes.cpp:2850
 */
export function set_curve(self: RibbonTrailMesh, curve: Curve | null): void {
  if (curve === self.curve) return;
  godot_primitive_mesh_unchanged(self, 'RibbonTrailMesh.set_curve');
  self.curve = curve;
}

/**
 * @godot RibbonTrailMesh.get_curve
 * @source scene/resources/3d/primitive_meshes.cpp:2863
 */
export function get_curve(self: RibbonTrailMesh): Curve | null {
  return self.curve;
}
