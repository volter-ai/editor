/**
 * @godot-class SeparationRayShape3D
 * @role BINDING
 *
 * Godot 4.7's `SeparationRayShape3D` (`scene/resources/3d/separation_ray_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a ray of `length` along the shape's +Z. Rapier has
 * no such collider, so it gives none: a query that sweeps it (a SpringArm3D's) casts a ray, and a
 * body's collision shape of it takes no part in contacts.
 */

import { godot_shape_3d_changed, godot_shape_3d_describe } from './shape-3d';

const f32 = Math.fround;

export interface SeparationRayShape3D {
  length: number;
  slide_on_slope: boolean;
}

/**
 * A ray of length 1 (`separation_ray_shape_3d.h:40`).
 *
 * @godot SeparationRayShape3D.SeparationRayShape3D
 * @source scene/resources/3d/separation_ray_shape_3d.cpp:92
 */
export function construct(): SeparationRayShape3D {
  return godot_shape_3d_describe({ length: 1, slide_on_slope: false }, { collider: () => null });
}

/**
 * @godot SeparationRayShape3D.set_length
 * @source scene/resources/3d/separation_ray_shape_3d.cpp:61
 */
export function set_length(self: SeparationRayShape3D, length: number): void {
  self.length = f32(length);
  godot_shape_3d_changed(self);
}

/**
 * @godot SeparationRayShape3D.get_length
 * @source scene/resources/3d/separation_ray_shape_3d.cpp:67
 */
export function get_length(self: SeparationRayShape3D): number {
  return self.length;
}

/**
 * @godot SeparationRayShape3D.set_slide_on_slope
 * @source scene/resources/3d/separation_ray_shape_3d.cpp:71
 */
export function set_slide_on_slope(self: SeparationRayShape3D, active: boolean): void {
  self.slide_on_slope = active;
  godot_shape_3d_changed(self);
}

/**
 * @godot SeparationRayShape3D.get_slide_on_slope
 * @source scene/resources/3d/separation_ray_shape_3d.cpp:77
 */
export function get_slide_on_slope(self: SeparationRayShape3D): boolean {
  return self.slide_on_slope;
}

/**
 * A SeparationRayShape3D of its defaults and the properties a scene states, by their prop names.
 *
 * @godot SeparationRayShape3D (protocol)
 * @source scene/resources/3d/separation_ray_shape_3d.cpp:92
 */
export function godot_separation_ray_shape_3d_new(properties: Readonly<Record<string, unknown>> = {}): SeparationRayShape3D {
  const self = construct();
  if (properties['length'] !== undefined) set_length(self, properties['length'] as number);
  if (properties['slideOnSlope'] !== undefined) set_slide_on_slope(self, properties['slideOnSlope'] as boolean);
  return self;
}
