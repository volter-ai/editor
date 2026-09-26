/**
 * @godot-class SphereShape3D
 * @role BINDING
 *
 * Godot 4.7's `SphereShape3D` (`scene/resources/3d/sphere_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Rapier ball. `radius` is a C `float`.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_shape_3d_describe } from './shape-3d';

const f32 = Math.fround;

export interface SphereShape3D {
  radius: number;
}

/**
 * A sphere of radius 0.5.
 *
 * @godot SphereShape3D (protocol)
 * @source scene/resources/3d/sphere_shape_3d.cpp:104
 */
export function construct(): SphereShape3D {
  return godot_shape_3d_describe(
    { radius: 0.5 },
    {
      collider: (shape) => RAPIER.ColliderDesc.ball(shape.radius),
      core: (shape) => ({ shape: new RAPIER.Ball(0), radius: shape.radius }),
    },
  );
}

/**
 * A negative radius fails and leaves it.
 *
 * @godot SphereShape3D.set_radius
 * @source scene/resources/3d/sphere_shape_3d.cpp:86
 */
export function set_radius(self: SphereShape3D, radius: number): void {
  if (radius < 0) return;
  self.radius = f32(radius);
}

/**
 * @godot SphereShape3D.get_radius
 * @source scene/resources/3d/sphere_shape_3d.cpp:93
 */
export function get_radius(self: SphereShape3D): number {
  return self.radius;
}
