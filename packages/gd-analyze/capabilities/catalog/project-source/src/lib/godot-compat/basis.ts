/**
 * @godot-class Basis
 * @role PROTOCOL
 *
 * Godot 4.7's `Basis` built-in value, transcribed from `core/math/basis.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. Godot stores three `rows`; its script-visible
 * `x`, `y`, `z` are the COLUMNS (`get_column`, `core/math/basis.h:177`), and the compat record
 * holds those columns, so `rows[i][j]` is `column j`'s component `i`. `real_t` is 32-bit and every
 * intermediate is rounded with `Math.fround` where the C++ rounds it.
 */

import { construct as vector3, dot, op_multiply as vector3Multiply, type Vector3 } from './vector3';

const f32 = Math.fround;
/** `(real_t)UNIT_EPSILON` without `PRECISE_MATH_CHECKS` (`core/math/math_defs.h:65`). */
const UNIT_EPSILON = f32(0.001);

export interface Basis {
  readonly x: Vector3;
  readonly y: Vector3;
  readonly z: Vector3;
}

function fromColumns(x: Vector3, y: Vector3, z: Vector3): Basis {
  return Object.freeze({ x, y, z });
}

/** `Basis(real_t xx, xy, xz, yx, ...)` takes rows (`core/math/basis.h:211`). */
function fromRows(r0: Vector3, r1: Vector3, r2: Vector3): Basis {
  return fromColumns(vector3(r0.x, r1.x, r2.x), vector3(r0.y, r1.y, r2.y), vector3(r0.z, r1.z, r2.z));
}

function row(self: Basis, index: 0 | 1 | 2): Vector3 {
  const key = (['x', 'y', 'z'] as const)[index];
  return vector3(self.x[key], self.y[key], self.z[key]);
}

const IDENTITY = fromRows(vector3(1, 0, 0), vector3(0, 1, 0), vector3(0, 0, 1));

/**
 * `Basis::set_axis_angle` (`core/math/basis.cpp:841`) on a default (identity) basis; under
 * `MATH_CHECKS` an axis that fails `is_normalized()` returns before writing.
 */
function axisAngle(p_axis: Vector3, p_angle: number): Basis {
  const lengthSquared = f32(f32(f32(p_axis.x * p_axis.x) + f32(p_axis.y * p_axis.y)) + f32(p_axis.z * p_axis.z));
  if (!(lengthSquared === 1 || Math.abs(f32(lengthSquared - 1)) < UNIT_EPSILON)) return IDENTITY;
  const angle = f32(p_angle);
  const sqX = f32(p_axis.x * p_axis.x);
  const sqY = f32(p_axis.y * p_axis.y);
  const sqZ = f32(p_axis.z * p_axis.z);
  const cosine = f32(Math.cos(angle));
  const r00 = f32(sqX + f32(cosine * f32(1 - sqX)));
  const r11 = f32(sqY + f32(cosine * f32(1 - sqY)));
  const r22 = f32(sqZ + f32(cosine * f32(1 - sqZ)));
  const sine = f32(Math.sin(angle));
  const t = f32(1 - cosine);
  let xyzt = f32(f32(p_axis.x * p_axis.y) * t);
  let zyxs = f32(p_axis.z * sine);
  const r01 = f32(xyzt - zyxs);
  const r10 = f32(xyzt + zyxs);
  xyzt = f32(f32(p_axis.x * p_axis.z) * t);
  zyxs = f32(p_axis.y * sine);
  const r02 = f32(xyzt + zyxs);
  const r20 = f32(xyzt - zyxs);
  xyzt = f32(f32(p_axis.y * p_axis.z) * t);
  zyxs = f32(p_axis.x * sine);
  const r12 = f32(xyzt - zyxs);
  const r21 = f32(xyzt + zyxs);
  return fromRows(vector3(r00, r01, r02), vector3(r10, r11, r12), vector3(r20, r21, r22));
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:151-155`): no arguments (the
 * identity, `core/math/basis.h:41`), `from: Basis`, `axis: Vector3, angle: float`
 * (`Basis(p_axis, p_angle)`, `core/math/basis.h:236`), and three column vectors
 * (`core/math/basis.h:240`). `from: Quaternion` is not transcribed.
 *
 * @godot Basis.Basis
 * @source core/math/basis.h:240
 */
export function construct(
  ...args: readonly [] | readonly [Basis] | readonly [Vector3, number] | readonly [Vector3, Vector3, Vector3]
): Basis {
  if (args.length === 0) return IDENTITY;
  if (args.length === 1) return fromColumns(args[0].x, args[0].y, args[0].z);
  if (args.length === 2) return axisAngle(args[0], args[1]);
  return fromColumns(vector3(args[0]), vector3(args[1]), vector3(args[2]));
}

/**
 * `rows[i] *= p_scale[i]` on a copy (`core/math/basis.cpp:235`).
 *
 * @godot Basis.scaled
 * @source core/math/basis.cpp:241
 */
export function scaled(self: Basis, p_scale: Vector3): Basis {
  return fromRows(
    vector3Multiply(row(self, 0), p_scale.x),
    vector3Multiply(row(self, 1), p_scale.y),
    vector3Multiply(row(self, 2), p_scale.z),
  );
}

/**
 * `Basis * Vector3` is `xform`: a dot per row (`core/math/basis.h:336`), registered as
 * `OperatorEvaluatorXForm<Vector3, Basis, Vector3>` (`core/variant/variant_op.cpp:336`).
 *
 * @godot Basis.OP_MULTIPLY
 * @source core/math/basis.h:336
 */
export function op_multiply(left: Basis, right: Vector3): Vector3 {
  return vector3(dot(row(left, 0), right), dot(row(left, 1), right), dot(row(left, 2), right));
}

/**
 * `b.x = value` is `set_column(0, value)` (`core/math/basis.h:182`); a new record assigned back.
 *
 * @godot Basis.x
 * @source core/math/basis.h:182
 */
export function with_x(self: Basis, value: Vector3): Basis {
  return fromColumns(vector3(value), self.y, self.z);
}

/**
 * @godot Basis.y
 * @source core/math/basis.h:182
 */
export function with_y(self: Basis, value: Vector3): Basis {
  return fromColumns(self.x, vector3(value), self.z);
}

/**
 * @godot Basis.z
 * @source core/math/basis.h:182
 */
export function with_z(self: Basis, value: Vector3): Basis {
  return fromColumns(self.x, self.y, vector3(value));
}
