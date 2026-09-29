/**
 * @godot-class CircleShape2D
 * @role BINDING
 *
 * Godot 4.7's `CircleShape2D` (`scene/resources/2d/circle_shape_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a circle of `radius` around its origin.
 */

import type { Vector2 } from './vector2';

export interface CircleShape2D {
  radius: number;
}

const CIRCLES = new WeakSet<object>();

/**
 * A new CircleShape2D, with the properties a scene states (`radius`).
 *
 * @godot CircleShape2D (protocol)
 * @source scene/resources/2d/circle_shape_2d.cpp:99
 */
export function godot_circle_shape_2d_new(properties: Readonly<Record<string, unknown>> = {}): CircleShape2D {
  const self: CircleShape2D = { radius: (properties['radius'] as number | undefined) ?? 10 };
  CIRCLES.add(self);
  return self;
}

/**
 * @godot CircleShape2D.CircleShape2D
 * @source scene/resources/2d/circle_shape_2d.cpp:99
 */
export function construct(): CircleShape2D {
  return godot_circle_shape_2d_new();
}

/**
 * Whether a point in the shape's space is inside it.
 *
 * @godot CircleShape2D (protocol)
 * @source scene/resources/2d/circle_shape_2d.cpp:36
 */
export function godot_circle_shape_2d_has_point(self: object, point: Vector2): boolean | undefined {
  if (!CIRCLES.has(self)) return undefined;
  return Math.hypot(point.x, point.y) <= (self as CircleShape2D).radius;
}

/**
 * @godot CircleShape2D.set_radius
 * @source scene/resources/2d/circle_shape_2d.cpp:45
 */
export function set_radius(self: CircleShape2D, radius: number): void {
  self.radius = radius;
}

/**
 * @godot CircleShape2D.get_radius
 * @source scene/resources/2d/circle_shape_2d.cpp:51
 */
export function get_radius(self: CircleShape2D): number {
  return self.radius;
}

/**
 * The shape as the 2D physics tests it: its centre, rounded by its radius.
 *
 * @godot CircleShape2D (protocol)
 * @source servers/physics_2d/godot_shape_2d.cpp:394
 */
export function godot_circle_shape_2d_outline(self: object): { readonly points: readonly (readonly [number, number])[]; readonly radius: number } | undefined {
  if (!CIRCLES.has(self)) return undefined;
  return { points: [[0, 0]], radius: (self as CircleShape2D).radius };
}
