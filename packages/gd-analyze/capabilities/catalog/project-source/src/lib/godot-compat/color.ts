/**
 * @godot-class Color
 * @role PROTOCOL
 *
 * Godot 4.7's `Color` built-in value, transcribed from `core/math/color.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Components are `float` (always 32-bit), rounded with
 * `Math.fround`.
 */

const f32 = Math.fround;

export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function make(r: number, g: number, b: number, a: number): Color {
  return Object.freeze({ r: f32(r), g: f32(g), b: f32(b), a: f32(a) });
}

/** `Color::hex` (`core/math/color.cpp:284`): each byte divided by `255.0f` in float. */
function hex(value: number): Color {
  const channel = (shift: number): number => f32(((value >>> shift) & 0xff) / f32(255));
  return make(channel(24), channel(16), channel(8), channel(0));
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:167-172`): no arguments
 * (`(0, 0, 0, 1)`, `core/math/color.h:251`), `from: Color`, `from: Color, alpha`
 * (`core/math/color.h:270`), `r, g, b` (alpha 1, `core/math/color.h:264`) and `r, g, b, a`.
 * The `code: String` constructors are not transcribed.
 *
 * @godot Color.Color
 * @source core/math/color.h:258
 */
export function construct(
  ...args:
    | readonly []
    | readonly [Color]
    | readonly [Color, number]
    | readonly [number, number, number]
    | readonly [number, number, number, number]
): Color {
  if (args.length === 0) return make(0, 0, 0, 1);
  if (args.length === 1) return make(args[0].r, args[0].g, args[0].b, args[0].a);
  if (args.length === 2) return make(args[0].r, args[0].g, args[0].b, args[1]);
  if (args.length === 3) return make(args[0], args[1], args[2], 1);
  return make(args[0], args[1], args[2], args[3]);
}

/**
 * The named colour `GRAY` is `Color::hex(0xBEBEBEFF)` (`core/math/color_names.inc:100`),
 * registered as a constant from the named-colour table (`core/variant/variant_call.cpp:3088`).
 *
 * @godot Color.GRAY
 * @source core/math/color_names.inc:100
 */
export const GRAY: Color = hex(0xbebebeff);

/**
 * `c.r = value` writes `float r` (`core/math/color.h:42`); a new record assigned back.
 *
 * @godot Color.r
 * @source core/math/color.h:42
 */
export function with_r(self: Color, value: number): Color {
  return make(value, self.g, self.b, self.a);
}

/**
 * @godot Color.g
 * @source core/math/color.h:43
 */
export function with_g(self: Color, value: number): Color {
  return make(self.r, value, self.b, self.a);
}

/**
 * @godot Color.b
 * @source core/math/color.h:44
 */
export function with_b(self: Color, value: number): Color {
  return make(self.r, self.g, value, self.a);
}

/**
 * @godot Color.a
 * @source core/math/color.h:45
 */
export function with_a(self: Color, value: number): Color {
  return make(self.r, self.g, self.b, value);
}
