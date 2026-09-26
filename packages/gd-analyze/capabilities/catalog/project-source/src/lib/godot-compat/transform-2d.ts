/**
 * @godot-class Transform2D
 * @role PROTOCOL
 *
 * Godot 4.7's `Transform2D` built-in value, transcribed from `core/math/transform_2d.{h,cpp}` at
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Godot stores `columns[3]`: `x`, `y` and
 * `origin`, which are the record's fields. `real_t` is 32-bit.
 */

import { construct as vector2, length, type Vector2 } from './vector2';

const f32 = Math.fround;

export interface Transform2D {
  readonly x: Vector2;
  readonly y: Vector2;
  readonly origin: Vector2;
}

function make(x: Vector2, y: Vector2, origin: Vector2): Transform2D {
  return Object.freeze({ x: vector2(x), y: vector2(y), origin: vector2(origin) });
}

/** `SIGN` (`core/typedefs.h:137`): 1, -1, or 0 (also for NaN). */
function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:126-130`): no arguments (the
 * identity, `core/math/transform_2d.h:58`), `from: Transform2D`, `rotation, position`
 * (`core/math/transform_2d.cpp:97`), `rotation, scale, skew, position`
 * (`core/math/transform_2d.cpp:107`), and `x_axis, y_axis, origin`.
 *
 * @godot Transform2D.Transform2D
 * @source core/math/transform_2d.h:145
 */
export function construct(
  ...args:
    | readonly []
    | readonly [Transform2D]
    | readonly [number, Vector2]
    | readonly [number, Vector2, number, Vector2]
    | readonly [Vector2, Vector2, Vector2]
): Transform2D {
  if (args.length === 0) return make(vector2(1, 0), vector2(0, 1), vector2(0, 0));
  if (args.length === 1) return make(args[0].x, args[0].y, args[0].origin);
  if (args.length === 2) {
    const rot = f32(args[0]);
    const cr = f32(Math.cos(rot));
    const sr = f32(Math.sin(rot));
    return make(vector2(cr, sr), vector2(-sr, cr), args[1]);
  }
  if (args.length === 4) {
    const rot = f32(args[0]);
    const scale = args[1];
    const skew = f32(args[2]);
    const turned = f32(rot + skew);
    return make(
      vector2(f32(f32(Math.cos(rot)) * scale.x), f32(f32(Math.sin(rot)) * scale.x)),
      vector2(f32(-f32(Math.sin(turned)) * scale.y), f32(f32(Math.cos(turned)) * scale.y)),
      args[3],
    );
  }
  return make(args[0], args[1], args[2]);
}

/**
 * `Size2(columns[0].length(), SIGN(determinant()) * columns[1].length())`, the determinant being
 * `x.x * y.y - x.y * y.x` (`core/math/transform_2d.cpp:259`).
 *
 * @godot Transform2D.get_scale
 * @source core/math/transform_2d.cpp:115
 */
export function get_scale(self: Transform2D): Vector2 {
  const determinant = f32(f32(self.x.x * self.y.y) - f32(self.x.y * self.y.x));
  return vector2(length(self.x), f32(sign(determinant) * length(self.y)));
}

/**
 * `t.x = value` writes `columns[0]` (`core/math/transform_2d.h:58`); a new record assigned back.
 *
 * @godot Transform2D.x
 * @source core/math/transform_2d.h:58
 */
export function with_x(self: Transform2D, value: Vector2): Transform2D {
  return make(value, self.y, self.origin);
}

/**
 * @godot Transform2D.y
 * @source core/math/transform_2d.h:58
 */
export function with_y(self: Transform2D, value: Vector2): Transform2D {
  return make(self.x, value, self.origin);
}

/**
 * @godot Transform2D.origin
 * @source core/math/transform_2d.h:58
 */
export function with_origin(self: Transform2D, value: Vector2): Transform2D {
  return make(self.x, self.y, value);
}
