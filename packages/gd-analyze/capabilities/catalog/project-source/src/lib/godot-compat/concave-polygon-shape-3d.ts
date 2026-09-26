/**
 * @godot-class ConcavePolygonShape3D
 * @role BINDING
 *
 * Godot 4.7's `ConcavePolygonShape3D` (`scene/resources/3d/concave_polygon_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Rapier triangle mesh: `faces` holds three
 * vertices per triangle (a frozen array), triangle `i` of the mesh being face `i`.
 * `backface_collision` is kept for the queries that honour it.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_shape_3d_describe } from './shape-3d';
import { construct as vector3, type Vector3 } from './vector3';

export interface ConcavePolygonShape3D {
  faces: readonly Vector3[];
  backface_collision: boolean;
}

/**
 * A shape without faces (no collider until it has some).
 *
 * @godot ConcavePolygonShape3D (protocol)
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:134
 */
export function construct(): ConcavePolygonShape3D {
  return godot_shape_3d_describe(
    { faces: Object.freeze([]) as readonly Vector3[], backface_collision: false },
    {
      // A face count not a multiple of three fails in `_setup` (`godot_shape_3d.cpp:1603`).
      collider: (shape) => {
        const count = shape.faces.length;
        if (count === 0 || count % 3 !== 0) return null;
        const vertices = new Float32Array(shape.faces.flatMap((p) => [p.x, p.y, p.z]));
        const indices = new Uint32Array(Array.from({ length: count }, (_, index) => index));
        return RAPIER.ColliderDesc.trimesh(vertices, indices);
      },
      backface: (shape) => shape.backface_collision,
    },
  );
}

/**
 * @godot ConcavePolygonShape3D.set_faces
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:100
 */
export function set_faces(self: ConcavePolygonShape3D, faces: readonly Vector3[]): void {
  self.faces = Object.freeze(faces.map((point) => vector3(point)));
}

/**
 * @godot ConcavePolygonShape3D.get_faces
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:106
 */
export function get_faces(self: ConcavePolygonShape3D): readonly Vector3[] {
  return self.faces;
}

/**
 * @godot ConcavePolygonShape3D.set_backface_collision_enabled
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:110
 */
export function set_backface_collision_enabled(self: ConcavePolygonShape3D, enabled: boolean): void {
  self.backface_collision = enabled;
}

/**
 * @godot ConcavePolygonShape3D.is_backface_collision_enabled
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:119
 */
export function is_backface_collision_enabled(self: ConcavePolygonShape3D): boolean {
  return self.backface_collision;
}
