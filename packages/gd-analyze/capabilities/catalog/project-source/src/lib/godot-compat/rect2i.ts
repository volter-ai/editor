/**
 * @godot-class Rect2i
 * @role BINDING
 *
 * Godot 4.7's `Rect2i`, transcribed from `core/math/rect2i.h` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: an integer rectangle, its position and size, a
 * frozen record as the other built-in records are.
 */

import { construct as vector2i, type Vector2i } from './vector2i';

export interface Rect2i {
  readonly position: Vector2i;
  readonly size: Vector2i;
}

function make(position: Vector2i, size: Vector2i): Rect2i {
  return Object.freeze({ position: vector2i(position.x, position.y), size: vector2i(size.x, size.y) });
}

/**
 * @godot Rect2i.Rect2i
 * @source core/math/rect2i.h:251
 */
export function construct(...args: readonly [] | readonly [Rect2i] | readonly [Vector2i, Vector2i] | readonly [number, number, number, number]): Rect2i {
  if (args.length === 0) return make(vector2i(0, 0), vector2i(0, 0));
  if (args.length === 1) return make(args[0].position, args[0].size);
  if (args.length === 2) return make(args[0], args[1]);
  return make(vector2i(args[0], args[1]), vector2i(args[2], args[3]));
}

/**
 * @godot Rect2i.has_point
 * @source core/math/rect2i.h:65
 */
export function has_point(self: Rect2i, point: Vector2i): boolean {
  return point.x >= self.position.x && point.y >= self.position.y && point.x < self.position.x + self.size.x && point.y < self.position.y + self.size.y;
}

/**
 * @godot Rect2i.get_area
 * @source core/math/rect2i.h:44
 */
export function get_area(self: Rect2i): number {
  return self.size.x * self.size.y;
}

/**
 * @godot Rect2i.get_center
 * @source core/math/rect2i.h:46
 */
export function get_center(self: Rect2i): Vector2i {
  return vector2i(self.position.x + Math.trunc(self.size.x / 2), self.position.y + Math.trunc(self.size.y / 2));
}

/**
 * @godot Rect2i.intersects
 * @source core/math/rect2i.h:48
 */
export function intersects(self: Rect2i, other: Rect2i): boolean {
  return self.position.x < other.position.x + other.size.x && self.position.x + self.size.x > other.position.x && self.position.y < other.position.y + other.size.y && self.position.y + self.size.y > other.position.y;
}

/**
 * @godot Rect2i.encloses
 * @source core/math/rect2i.h:74
 */
export function encloses(self: Rect2i, other: Rect2i): boolean {
  return other.position.x >= self.position.x && other.position.y >= self.position.y && other.position.x + other.size.x <= self.position.x + self.size.x && other.position.y + other.size.y <= self.position.y + self.size.y;
}
