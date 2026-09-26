/**
 * @godot-class Quaternion
 * @role PROTOCOL
 *
 * Godot 4.7's `Quaternion` built-in value (`core/math/quaternion.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): four `real_t` components, 32-bit, rounded with
 * `Math.fround`. Only construction is transcribed.
 */

const f32 = Math.fround;

export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

function make(x: number, y: number, z: number, w: number): Quaternion {
  return Object.freeze({ x: f32(x), y: f32(y), z: f32(z), w: f32(w) });
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:140-145`) with no arguments (the
 * identity, `quaternion.h:120`), `from: Quaternion` and `x, y, z, w`. The Basis, axis-angle and
 * arc constructors are not transcribed.
 *
 * @godot Quaternion.Quaternion
 * @source core/math/quaternion.h:123
 */
export function construct(...args: readonly [] | readonly [Quaternion] | readonly [number, number, number, number]): Quaternion {
  if (args.length === 0) return make(0, 0, 0, 1);
  if (args.length === 1) return make(args[0].x, args[0].y, args[0].z, args[0].w);
  return make(args[0], args[1], args[2], args[3]);
}
