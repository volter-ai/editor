/**
 * @godot-class QuadMesh
 * @role PROTOCOL
 *
 * Godot 4.7's `QuadMesh` (`scene/resources/3d/primitive_meshes.h:287`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a `PlaneMesh` that faces Z with size (1, 1). Its
 * members are PlaneMesh's (`plane-mesh.ts`).
 */

import { godot_plane_mesh_arrays, type PlaneMesh } from './plane-mesh';
import { godot_primitive_mesh_describe } from './primitive-mesh';
import { construct as vector2 } from './vector2';
import { construct as vector3 } from './vector3';

/**
 * `QuadMesh()`: `set_orientation(FACE_Z)`, `set_size(Size2(1, 1))` over PlaneMesh's defaults.
 *
 * @godot QuadMesh (protocol)
 * @source scene/resources/3d/primitive_meshes.h:291
 */
export function construct(): PlaneMesh {
  return godot_primitive_mesh_describe<PlaneMesh>(
    {
      flip_faces: false,
      size: vector2(1, 1),
      subdivide_width: 0,
      subdivide_depth: 0,
      center_offset: vector3(0, 0, 0),
      orientation: 2,
    },
    godot_plane_mesh_arrays,
  );
}
