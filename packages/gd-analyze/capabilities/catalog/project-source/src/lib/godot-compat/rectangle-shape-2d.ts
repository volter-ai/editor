/**
 * @godot-class RectangleShape2D
 * @role BINDING
 *
 * Godot 4.7's `RectangleShape2D` (`scene/resources/2d/rectangle_shape_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a rectangle of `size` centred on its origin.
 */

import { construct as vector2, type Vector2 } from './vector2';

export interface RectangleShape2D {
  size: Vector2;
}

const RECTANGLES = new WeakSet<object>();

/**
 * A new RectangleShape2D, with the properties a scene states (`size`).
 *
 * @godot RectangleShape2D (protocol)
 * @source scene/resources/2d/rectangle_shape_2d.cpp:131
 */
export function godot_rectangle_shape_2d_new(properties: Readonly<Record<string, unknown>> = {}): RectangleShape2D {
  const size = properties['size'] as readonly [number, number] | Vector2 | undefined;
  const self: RectangleShape2D = { size: size === undefined ? vector2(20, 20) : Array.isArray(size) ? vector2(size[0] as number, size[1] as number) : (size as Vector2) };
  RECTANGLES.add(self);
  return self;
}

/**
 * @godot RectangleShape2D.RectangleShape2D
 * @source scene/resources/2d/rectangle_shape_2d.cpp:131
 */
export function construct(): RectangleShape2D {
  return godot_rectangle_shape_2d_new();
}

/**
 * Whether a point in the shape's space is inside it (`RectangleShape2D::_edit_is_selected_on_click`).
 *
 * @godot RectangleShape2D (protocol)
 * @source scene/resources/2d/rectangle_shape_2d.cpp:40
 */
export function godot_rectangle_shape_2d_has_point(self: object, point: Vector2): boolean | undefined {
  if (!RECTANGLES.has(self)) return undefined;
  const size = (self as RectangleShape2D).size;
  return Math.abs(point.x) <= size.x / 2 && Math.abs(point.y) <= size.y / 2;
}

/**
 * @godot RectangleShape2D.set_size
 * @source scene/resources/2d/rectangle_shape_2d.cpp:52
 */
export function set_size(self: RectangleShape2D, size: Vector2): void {
  self.size = size;
}

/**
 * @godot RectangleShape2D.get_size
 * @source scene/resources/2d/rectangle_shape_2d.cpp:58
 */
export function get_size(self: RectangleShape2D): Vector2 {
  return self.size;
}

/**
 * The shape as the 2D physics tests it: its outline's points and no radius.
 *
 * @godot RectangleShape2D (protocol)
 * @source servers/physics_2d/godot_shape_2d.cpp:445
 */
export function godot_rectangle_shape_2d_outline(self: object): { readonly points: readonly (readonly [number, number])[]; readonly radius: number } | undefined {
  if (!RECTANGLES.has(self)) return undefined;
  const { x, y } = (self as RectangleShape2D).size;
  return { points: [[-x / 2, -y / 2], [x / 2, -y / 2], [x / 2, y / 2], [-x / 2, y / 2]], radius: 0 };
}
