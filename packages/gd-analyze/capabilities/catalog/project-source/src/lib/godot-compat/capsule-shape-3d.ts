/**
 * @godot-class CapsuleShape3D
 * @role BINDING
 *
 * Godot 4.7's `CapsuleShape3D` (`scene/resources/3d/capsule_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Rapier capsule along Y. Godot's `height` is the
 * whole capsule, caps included; Rapier's half height is the cylinder's, `height / 2 - radius`.
 * `radius` and `height` are C `float`s; each setter keeps `height >= 2 * radius`.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_shape_3d_describe } from './shape-3d';

const f32 = Math.fround;

export interface CapsuleShape3D {
  radius: number;
  height: number;
}

/**
 * A capsule of radius 0.5 and height 2.
 *
 * @godot CapsuleShape3D (protocol)
 * @source scene/resources/3d/capsule_shape_3d.cpp:156
 */
export function construct(): CapsuleShape3D {
  return godot_shape_3d_describe(
    { radius: 0.5, height: 2 },
    {
      collider: (shape) => RAPIER.ColliderDesc.capsule(shape.height / 2 - shape.radius, shape.radius),
      core: (shape) => {
        const half = shape.height / 2 - shape.radius;
        return { shape: new RAPIER.Segment({ x: 0, y: -half, z: 0 }, { x: 0, y: half, z: 0 }), radius: shape.radius };
      },
    },
  );
}

/**
 * A negative radius fails; a radius over half the height raises the height to twice it.
 *
 * @godot CapsuleShape3D.set_radius
 * @source scene/resources/3d/capsule_shape_3d.cpp:102
 */
export function set_radius(self: CapsuleShape3D, radius: number): void {
  if (radius < 0) return;
  self.radius = f32(radius);
  if (self.height < f32(self.radius * 2)) self.height = f32(self.radius * 2);
}

/**
 * @godot CapsuleShape3D.get_radius
 * @source scene/resources/3d/capsule_shape_3d.cpp:112
 */
export function get_radius(self: CapsuleShape3D): number {
  return self.radius;
}

/**
 * A negative height fails; a height under twice the radius lowers the radius to half of it.
 *
 * @godot CapsuleShape3D.set_height
 * @source scene/resources/3d/capsule_shape_3d.cpp:116
 */
export function set_height(self: CapsuleShape3D, height: number): void {
  if (height < 0) return;
  self.height = f32(height);
  if (self.radius > f32(self.height * 0.5)) self.radius = f32(self.height * 0.5);
}

/**
 * @godot CapsuleShape3D.get_height
 * @source scene/resources/3d/capsule_shape_3d.cpp:126
 */
export function get_height(self: CapsuleShape3D): number {
  return self.height;
}
