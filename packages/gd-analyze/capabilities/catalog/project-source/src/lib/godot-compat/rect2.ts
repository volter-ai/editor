/**
 * @godot-class Rect2
 * @role PROTOCOL
 *
 * Godot 4.7's `Rect2` built-in value, transcribed from `core/math/rect2.h` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: a `Point2 position` and a `Size2 size`, both `Vector2`.
 */

import { construct as vector2, type Vector2 } from './vector2';

export interface Rect2 {
  readonly position: Vector2;
  readonly size: Vector2;
}

function make(position: Vector2, size: Vector2): Rect2 {
  return Object.freeze({ position: vector2(position), size: vector2(size) });
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:94-98`): no arguments, `from:
 * Rect2`, `position, size` (`core/math/rect2.h:378`) and `x, y, width, height`
 * (`core/math/rect2.h:374`). `from: Rect2i` is not transcribed.
 *
 * @godot Rect2.Rect2
 * @source core/math/rect2.h:378
 */
export function construct(
  ...args: readonly [] | readonly [Rect2] | readonly [Vector2, Vector2] | readonly [number, number, number, number]
): Rect2 {
  if (args.length === 0) return make(vector2(), vector2());
  if (args.length === 1) return make(args[0].position, args[0].size);
  if (args.length === 2) return make(args[0], args[1]);
  return make(vector2(args[0], args[1]), vector2(args[2], args[3]));
}

/**
 * `r.position = value` writes `Point2 position` (`core/math/rect2.h:42`); a new record assigned back.
 *
 * @godot Rect2.position
 * @source core/math/rect2.h:42
 */
export function with_position(self: Rect2, value: Vector2): Rect2 {
  return make(value, self.size);
}

/**
 * @godot Rect2.size
 * @source core/math/rect2.h:43
 */
export function with_size(self: Rect2, value: Vector2): Rect2 {
  return make(self.position, value);
}
