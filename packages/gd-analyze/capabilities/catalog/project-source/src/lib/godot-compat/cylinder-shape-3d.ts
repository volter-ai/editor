/**
 * @godot-class CylinderShape3D
 * @role BINDING
 *
 * Godot 4.7's `CylinderShape3D` (`scene/resources/3d/cylinder_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a cylinder along Y, `height` tall, as Rapier's
 * cylinder (a scene writes `<CylinderCollider args={[height / 2, radius]} />`).
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { godot_shape_3d_changed, godot_shape_3d_describe } from './shape-3d';

const f32 = Math.fround;

export interface CylinderShape3D {
  radius: number;
  height: number;
}

/**
 * A cylinder of radius 0.5 and height 2 (`cylinder_shape_3d.h:40`).
 *
 * @godot CylinderShape3D.CylinderShape3D
 * @source scene/resources/3d/cylinder_shape_3d.cpp:155
 */
export function construct(): CylinderShape3D {
  return godot_shape_3d_describe(
    { radius: 0.5, height: 2 },
    {
      collider: (shape) => RAPIER.ColliderDesc.cylinder(shape.height / 2, shape.radius),
      core: (shape) => ({ shape: new RAPIER.Cylinder(shape.height / 2, shape.radius), radius: 0 }),
    },
  );
}

/**
 * @godot CylinderShape3D.set_radius
 * @source scene/resources/3d/cylinder_shape_3d.cpp:115
 */
export function set_radius(self: CylinderShape3D, radius: number): void {
  self.radius = f32(radius);
  godot_shape_3d_changed(self);
}

/**
 * @godot CylinderShape3D.get_radius
 * @source scene/resources/3d/cylinder_shape_3d.cpp:122
 */
export function get_radius(self: CylinderShape3D): number {
  return self.radius;
}

/**
 * @godot CylinderShape3D.set_height
 * @source scene/resources/3d/cylinder_shape_3d.cpp:126
 */
export function set_height(self: CylinderShape3D, height: number): void {
  self.height = f32(height);
  godot_shape_3d_changed(self);
}

/**
 * @godot CylinderShape3D.get_height
 * @source scene/resources/3d/cylinder_shape_3d.cpp:133
 */
export function get_height(self: CylinderShape3D): number {
  return self.height;
}

/**
 * A CylinderShape3D of its defaults and the properties a scene states, by their prop names.
 *
 * @godot CylinderShape3D (protocol)
 * @source scene/resources/3d/cylinder_shape_3d.cpp:155
 */
export function godot_cylinder_shape_3d_new(properties: Readonly<Record<string, unknown>> = {}): CylinderShape3D {
  const self = construct();
  if (properties['radius'] !== undefined) set_radius(self, properties['radius'] as number);
  if (properties['height'] !== undefined) set_height(self, properties['height'] as number);
  return self;
}
