/**
 * @godot-class BoxShape3D
 * @role BINDING
 *
 * Godot 4.7's `BoxShape3D` (`scene/resources/3d/box_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Rapier cuboid of half its size, the data the
 * scene resource hands the physics server (`size / 2`).
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_shape_3d_describe } from './shape-3d';
import { construct as vector3, type Vector3 } from './vector3';

export interface BoxShape3D {
  size: Vector3;
}

/**
 * A box of size (1, 1, 1).
 *
 * @godot BoxShape3D (protocol)
 * @source scene/resources/3d/box_shape_3d.cpp:118
 */
export function construct(): BoxShape3D {
  return godot_shape_3d_describe(
    { size: vector3(1, 1, 1) },
    { collider: (shape) => RAPIER.ColliderDesc.cuboid(shape.size.x / 2, shape.size.y / 2, shape.size.z / 2) },
  );
}

/**
 * A negative component fails and leaves the size.
 *
 * @godot BoxShape3D.set_size
 * @source scene/resources/3d/box_shape_3d.cpp:100
 */
export function set_size(self: BoxShape3D, size: Vector3): void {
  if (size.x < 0 || size.y < 0 || size.z < 0) return;
  self.size = vector3(size);
}

/**
 * @godot BoxShape3D.get_size
 * @source scene/resources/3d/box_shape_3d.cpp:107
 */
export function get_size(self: BoxShape3D): Vector3 {
  return self.size;
}
