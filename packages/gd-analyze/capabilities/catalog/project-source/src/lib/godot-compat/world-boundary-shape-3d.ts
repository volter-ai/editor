/**
 * @godot-class WorldBoundaryShape3D
 * @role BINDING
 *
 * Godot 4.7's `WorldBoundaryShape3D` (`scene/resources/3d/world_boundary_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): an infinite plane, what is behind it solid. Rapier's
 * scene idiom is a thin, wide cuboid on the default plane (normal +Y through the origin), which is
 * what a script's shape builds too; its plane is stored.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { construct as plane, type Plane } from './plane';
import { godot_shape_3d_changed, godot_shape_3d_describe } from './shape-3d';
import { construct as vector3 } from './vector3';

export interface WorldBoundaryShape3D {
  plane: Plane;
}

/**
 * The plane `Plane(0, 1, 0, 0)` (`world_boundary_shape_3d.h:40`).
 *
 * @godot WorldBoundaryShape3D.WorldBoundaryShape3D
 * @source scene/resources/3d/world_boundary_shape_3d.cpp:82
 */
export function construct(): WorldBoundaryShape3D {
  return godot_shape_3d_describe(
    { plane: plane(vector3(0, 1, 0), 0) },
    {
      collider: () => RAPIER.ColliderDesc.cuboid(10000, 0.01, 10000),
      core: () => ({ shape: new RAPIER.Cuboid(10000, 0.01, 10000), radius: 0 }),
    },
  );
}

/**
 * @godot WorldBoundaryShape3D.set_plane
 * @source scene/resources/3d/world_boundary_shape_3d.cpp:60
 */
export function set_plane(self: WorldBoundaryShape3D, value: Plane): void {
  self.plane = value;
  godot_shape_3d_changed(self);
}

/**
 * @godot WorldBoundaryShape3D.get_plane
 * @source scene/resources/3d/world_boundary_shape_3d.cpp:66
 */
export function get_plane(self: WorldBoundaryShape3D): Plane {
  return self.plane;
}
