/**
 * @godot-class CapsuleShape2D
 * @role BINDING
 *
 * Godot 4.7's `CapsuleShape2D` (`scene/resources/2d/capsule_shape_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a vertical capsule, `height` from cap to cap.
 */

import type { Vector2 } from './vector2';

export interface CapsuleShape2D {
  radius: number;
  height: number;
}

const CAPSULES = new WeakSet<object>();

/**
 * A new CapsuleShape2D, with the properties a scene states (`radius`, `height`).
 *
 * @godot CapsuleShape2D (protocol)
 * @source scene/resources/2d/capsule_shape_2d.cpp:117
 */
export function godot_capsule_shape_2d_new(properties: Readonly<Record<string, unknown>> = {}): CapsuleShape2D {
  const self: CapsuleShape2D = { radius: (properties['radius'] as number | undefined) ?? 10, height: (properties['height'] as number | undefined) ?? 30 };
  CAPSULES.add(self);
  return self;
}

/**
 * @godot CapsuleShape2D.CapsuleShape2D
 * @source scene/resources/2d/capsule_shape_2d.cpp:117
 */
export function construct(): CapsuleShape2D {
  return godot_capsule_shape_2d_new();
}

/**
 * The shape as the 2D physics tests it: its axis segment, rounded by its radius.
 *
 * @godot CapsuleShape2D (protocol)
 * @source servers/physics_2d/godot_shape_2d.cpp:630
 */
export function godot_capsule_shape_2d_outline(self: object): { readonly points: readonly (readonly [number, number])[]; readonly radius: number } | undefined {
  if (!CAPSULES.has(self)) return undefined;
  const { radius, height } = self as CapsuleShape2D;
  const half = Math.max(height / 2 - radius, 0);
  return { points: [[0, -half], [0, half]], radius };
}

/**
 * Whether a point in the shape's space is inside it.
 *
 * @godot CapsuleShape2D (protocol)
 * @source servers/physics_2d/godot_shape_2d.cpp:640
 */
export function godot_capsule_shape_2d_has_point(self: object, point: Vector2): boolean | undefined {
  if (!CAPSULES.has(self)) return undefined;
  const { radius, height } = self as CapsuleShape2D;
  const half = Math.max(height / 2 - radius, 0);
  return Math.hypot(point.x, Math.max(Math.abs(point.y) - half, 0)) <= radius;
}

/**
 * @godot CapsuleShape2D.set_radius
 * @source scene/resources/2d/capsule_shape_2d.cpp:60
 */
export function set_radius(self: CapsuleShape2D, radius: number): void {
  self.radius = radius;
}

/**
 * @godot CapsuleShape2D.get_radius
 * @source scene/resources/2d/capsule_shape_2d.cpp:67
 */
export function get_radius(self: CapsuleShape2D): number {
  return self.radius;
}

/**
 * @godot CapsuleShape2D.set_height
 * @source scene/resources/2d/capsule_shape_2d.cpp:71
 */
export function set_height(self: CapsuleShape2D, height: number): void {
  self.height = height;
}

/**
 * @godot CapsuleShape2D.get_height
 * @source scene/resources/2d/capsule_shape_2d.cpp:78
 */
export function get_height(self: CapsuleShape2D): number {
  return self.height;
}
