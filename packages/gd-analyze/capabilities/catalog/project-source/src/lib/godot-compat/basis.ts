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

import {
  construct as quaternion,
  length_squared as quaternionLengthSquared,
  slerp as quaternionSlerp,
  type Quaternion,
} from './quaternion';
import {
  construct as vector3,
  cross,
  dot,
  is_equal_approx as vector3IsEqualApprox,
  is_finite as vector3IsFinite,
  is_zero_approx as vector3IsZeroApprox,
  length as vector3Length,
  length_squared as vector3LengthSquared,
  normalized,
  op_multiply as vector3Multiply,
  op_negate as vector3Negate,
  op_subtract as vector3Subtract,
  UP,
  type Vector3,
} from './vector3';

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
 * Gram-Schmidt over the columns in `real_t` (`Basis::orthonormalize`): x normalized, y less its x
 * part normalized, z less its x and y parts normalized.
 *
 * @godot Basis.orthonormalized
 * @source core/math/basis.cpp:56
 */
export function orthonormalized(self: Basis): Basis {
  const x = normalized(self.x);
  const y = normalized(vector3Subtract(self.y, vector3Multiply(x, dot(x, self.y))));
  const z = normalized(vector3Subtract(vector3Subtract(self.z, vector3Multiply(x, dot(x, self.z))), vector3Multiply(y, dot(y, self.z))));
  return fromColumns(x, y, z);
}

/**
 * `Basis(Quaternion)`: `Basis::set_quaternion` (`core/math/basis.cpp:829`), in `real_t`.
 *
 * @godot Basis (protocol)
 * @source core/math/basis.cpp:829
 */
export function godot_basis_from_quaternion(q: Quaternion): Basis {
  const d = quaternionLengthSquared(q);
  const s = f32(2 / d);
  const xs = f32(q.x * s);
  const ys = f32(q.y * s);
  const zs = f32(q.z * s);
  const wx = f32(q.w * xs);
  const wy = f32(q.w * ys);
  const wz = f32(q.w * zs);
  const xx = f32(q.x * xs);
  const xy = f32(q.x * ys);
  const xz = f32(q.x * zs);
  const yy = f32(q.y * ys);
  const yz = f32(q.y * zs);
  const zz = f32(q.z * zs);
  return fromRows(
    vector3(f32(1 - f32(yy + zz)), f32(xy - wz), f32(xz + wy)),
    vector3(f32(xy + wz), f32(1 - f32(xx + zz)), f32(yz - wx)),
    vector3(f32(xz - wy), f32(yz + wx), f32(1 - f32(xx + yy))),
  );
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

/** `rows[r1][c1] * rows[r2][c2] - rows[r1][c2] * rows[r2][c1]` (`core/math/basis.cpp:36`). */
function cofac(self: Basis, row1: 0 | 1 | 2, col1: 0 | 1 | 2, row2: 0 | 1 | 2, col2: 0 | 1 | 2): number {
  const at = (r: 0 | 1 | 2, c: 0 | 1 | 2): number => row(self, r)[(['x', 'y', 'z'] as const)[c]];
  return f32(f32(at(row1, col1) * at(row2, col2)) - f32(at(row1, col2) * at(row2, col1)));
}

/**
 * `Basis::invert` on a copy (`core/math/basis.cpp:39`): the cofactor matrix over the determinant.
 * Under `MATH_CHECKS` a zero determinant fails before writing, so the copy comes back unchanged.
 *
 * @godot Basis.inverse
 * @source core/math/basis.cpp:211
 */
export function inverse(self: Basis): Basis {
  const co0 = cofac(self, 1, 1, 2, 2);
  const co1 = cofac(self, 1, 2, 2, 0);
  const co2 = cofac(self, 1, 0, 2, 1);
  const r0 = row(self, 0);
  const det = f32(f32(f32(r0.x * co0) + f32(r0.y * co1)) + f32(r0.z * co2));
  if (det === 0) return self;
  const s = f32(1 / det);
  return fromRows(
    vector3(f32(co0 * s), f32(cofac(self, 0, 2, 2, 1) * s), f32(cofac(self, 0, 1, 1, 2) * s)),
    vector3(f32(co1 * s), f32(cofac(self, 0, 0, 2, 2) * s), f32(cofac(self, 0, 2, 1, 0) * s)),
    vector3(f32(co2 * s), f32(cofac(self, 0, 1, 2, 0) * s), f32(cofac(self, 0, 0, 1, 1) * s)),
  );
}

/** `tdotx`/`tdoty`/`tdotz`: a column dotted with `v` (`core/math/basis.h:116`). */
function tdot(column: Vector3, v: Vector3): number {
  return f32(f32(f32(column.x * v.x) + f32(column.y * v.y)) + f32(column.z * v.z));
}

/**
 * `Basis * Vector3` is `xform`: a dot per row (`core/math/basis.h:336`), registered as
 * `OperatorEvaluatorXForm<Vector3, Basis, Vector3>` (`core/variant/variant_op.cpp:336`).
 * `Basis * Basis` is the matrix product, each entry `right.tdot{x,y,z}(rows[i])`
 * (`core/math/basis.h:281`). `Basis * float` scales every entry (`core/math/basis.h:318`).
 *
 * @godot Basis.OP_MULTIPLY
 * @source core/math/basis.h:336
 */
export function op_multiply(left: Basis, right: Vector3): Vector3;
export function op_multiply(left: Basis, right: Basis): Basis;
export function op_multiply(left: Basis, right: number): Basis;
export function op_multiply(left: Basis, right: Vector3 | Basis | number): Vector3 | Basis {
  if (typeof right === 'number') {
    const s = f32(right);
    return fromColumns(vector3Multiply(left.x, s), vector3Multiply(left.y, s), vector3Multiply(left.z, s));
  }
  if ('x' in right && typeof right.x === 'number') {
    const v = right as Vector3;
    return vector3(dot(row(left, 0), v), dot(row(left, 1), v), dot(row(left, 2), v));
  }
  const m = right as Basis;
  const product = (r: Vector3): Vector3 => vector3(tdot(m.x, r), tdot(m.y, r), tdot(m.z, r));
  return fromRows(product(row(left, 0)), product(row(left, 1)), product(row(left, 2)));
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

/** `(float)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function isEqualApproxReal(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(CMP_EPSILON * Math.abs(left));
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(f32(left - right)) < tolerance;
}

/** `Math::is_zero_approx(float)` (`core/math/math_funcs.h:556`). */
function isZeroApproxReal(value: number): boolean {
  return Math.abs(value) < CMP_EPSILON;
}

/** `rows[r][c]`: column `c`'s component `r`. */
function at(self: Basis, r: 0 | 1 | 2, c: 0 | 1 | 2): number {
  const column = c === 0 ? self.x : c === 1 ? self.y : self.z;
  return r === 0 ? column.x : r === 1 ? column.y : column.z;
}

/** `Basis(xx, xy, xz, yx, yy, yz, zx, zy, zz)`: nine entries by rows (`core/math/basis.h:211`). */
function fromEntries(...e: readonly [number, number, number, number, number, number, number, number, number]): Basis {
  return fromRows(vector3(e[0], e[1], e[2]), vector3(e[3], e[4], e[5]), vector3(e[6], e[7], e[8]));
}

/**
 * The rows and columns swapped.
 *
 * @godot Basis.transposed
 * @source core/math/basis.cpp:223
 */
export function transposed(self: Basis): Basis {
  return fromRows(self.x, self.y, self.z);
}

/**
 * The cofactor expansion along the first column.
 *
 * @godot Basis.determinant
 * @source core/math/basis.h:350
 */
export function determinant(self: Basis): number {
  const m = (r: 0 | 1 | 2, c: 0 | 1 | 2): number => at(self, r, c);
  const a = f32(m(0, 0) * f32(f32(m(1, 1) * m(2, 2)) - f32(m(2, 1) * m(1, 2))));
  const b = f32(m(1, 0) * f32(f32(m(0, 1) * m(2, 2)) - f32(m(2, 1) * m(0, 2))));
  const c = f32(m(2, 0) * f32(f32(m(0, 1) * m(1, 2)) - f32(m(1, 1) * m(0, 2))));
  return f32(f32(a - b) + c);
}

/**
 * `Basis(axis, angle) * this`: rotated about the parent axis. Under `MATH_CHECKS` an axis that is not
 * normalized leaves the rotation the identity.
 *
 * @godot Basis.rotated
 * @source core/math/basis.cpp:352
 */
export function rotated(self: Basis, p_axis: Vector3, p_angle: number): Basis {
  return op_multiply(axisAngle(p_axis, p_angle), self);
}

/**
 * Each row scaled component-wise (`scale_local`, `core/math/basis.cpp:247`): each column `i` times
 * `scale[i]`.
 *
 * @godot Basis.scaled_local
 * @source core/math/basis.cpp:282
 */
export function scaled_local(self: Basis, p_scale: Vector3): Basis {
  return fromColumns(vector3Multiply(self.x, p_scale.x), vector3Multiply(self.y, p_scale.y), vector3Multiply(self.z, p_scale.z));
}

/** `SIGN` (`core/typedefs.h:137`). */
function signReal(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/**
 * The column lengths, all negated when the determinant is negative (`get_scale_abs`,
 * `core/math/basis.cpp:288`).
 *
 * @godot Basis.get_scale
 * @source core/math/basis.cpp:301
 */
export function get_scale(self: Basis): Vector3 {
  const detSign = signReal(determinant(self));
  return vector3Multiply(vector3(vector3Length(self.x), vector3Length(self.y), vector3Length(self.z)), detSign);
}

/**
 * The Euler angles for `order` (`EULER_ORDER_XYZ` 0 to `EULER_ORDER_ZYX` 5; the Variant default is
 * `EULER_ORDER_YXZ`, 2, `core/variant/variant_call.cpp:2544`), with Godot's gimbal-lock branches
 * and its exact-axis shortcuts for XYZ and YXZ. Another order is an error that returns (0, 0, 0).
 *
 * @godot Basis.get_euler
 * @source core/math/basis.cpp:456
 */
export function get_euler(self: Basis, p_order = 2): Vector3 {
  const m = (r: 0 | 1 | 2, c: 0 | 1 | 2): number => at(self, r, c);
  const atan2 = (y: number, x: number): number => f32(Math.atan2(y, x));
  const asin = (v: number): number => f32(Math.asin(v));
  const halfPi = f32(Math.PI / 2);
  const limit = f32(1 - f32(0.00000025));
  switch (p_order) {
    case 0: {
      const sy = m(0, 2);
      if (sy < limit) {
        if (sy > -limit) {
          if (m(1, 0) === 0 && m(0, 1) === 0 && m(1, 2) === 0 && m(2, 1) === 0 && m(1, 1) === 1) {
            return vector3(0, atan2(m(0, 2), m(0, 0)), 0);
          }
          return vector3(atan2(-m(1, 2), m(2, 2)), asin(sy), atan2(-m(0, 1), m(0, 0)));
        }
        return vector3(atan2(m(2, 1), m(1, 1)), -halfPi, 0);
      }
      return vector3(atan2(m(2, 1), m(1, 1)), halfPi, 0);
    }
    case 1: {
      const sz = m(0, 1);
      if (sz < limit) {
        if (sz > -limit) return vector3(atan2(m(2, 1), m(1, 1)), atan2(m(0, 2), m(0, 0)), asin(-sz));
        return vector3(-atan2(m(1, 2), m(2, 2)), 0, halfPi);
      }
      return vector3(-atan2(m(1, 2), m(2, 2)), 0, -halfPi);
    }
    case 2: {
      const m12 = m(1, 2);
      if (m12 < limit) {
        if (m12 > -limit) {
          if (m(1, 0) === 0 && m(0, 1) === 0 && m(0, 2) === 0 && m(2, 0) === 0 && m(0, 0) === 1) {
            return vector3(atan2(-m12, m(1, 1)), 0, 0);
          }
          return vector3(asin(-m12), atan2(m(0, 2), m(2, 2)), atan2(m(1, 0), m(1, 1)));
        }
        return vector3(f32(f32(Math.PI) * 0.5), atan2(m(0, 1), m(0, 0)), 0);
      }
      return vector3(-f32(f32(Math.PI) * 0.5), -atan2(m(0, 1), m(0, 0)), 0);
    }
    case 3: {
      const sz = m(1, 0);
      if (sz < limit) {
        if (sz > -limit) return vector3(atan2(-m(1, 2), m(1, 1)), atan2(-m(2, 0), m(0, 0)), asin(sz));
        return vector3(atan2(m(2, 1), m(2, 2)), 0, -halfPi);
      }
      return vector3(atan2(m(2, 1), m(2, 2)), 0, halfPi);
    }
    case 4: {
      const sx = m(2, 1);
      if (sx < limit) {
        if (sx > -limit) return vector3(asin(sx), atan2(-m(2, 0), m(2, 2)), atan2(-m(0, 1), m(1, 1)));
        return vector3(-halfPi, atan2(m(0, 2), m(0, 0)), 0);
      }
      return vector3(halfPi, atan2(m(0, 2), m(0, 0)), 0);
    }
    case 5: {
      const sy = m(2, 0);
      if (sy < limit) {
        if (sy > -limit) return vector3(atan2(m(2, 1), m(2, 2)), asin(-sy), atan2(m(1, 0), m(0, 0)));
        return vector3(0, halfPi, -atan2(m(0, 1), m(1, 1)));
      }
      return vector3(0, -halfPi, -atan2(m(0, 1), m(1, 1)));
    }
    default:
      return vector3(0, 0, 0);
  }
}

/**
 * The first column dotted with the vector.
 *
 * @godot Basis.tdotx
 * @source core/math/basis.h:116
 */
export function tdotx(self: Basis, p_with: Vector3): number {
  return tdot(self.x, p_with);
}

/**
 * @godot Basis.tdoty
 * @source core/math/basis.h:119
 */
export function tdoty(self: Basis, p_with: Vector3): number {
  return tdot(self.y, p_with);
}

/**
 * @godot Basis.tdotz
 * @source core/math/basis.h:122
 */
export function tdotz(self: Basis, p_with: Vector3): number {
  return tdot(self.z, p_with);
}

/**
 * `determinant() ~ 1` and conformal (`Basis::is_rotation`, `core/math/basis.cpp:130`).
 */
function isRotation(self: Basis): boolean {
  const det = determinant(self);
  return is_conformal(self) && (det === 1 || Math.abs(f32(det - 1)) < UNIT_EPSILON);
}

/**
 * `Basis::get_quaternion` (`core/math/basis.cpp:715`): Shepperd's method on the rows; under
 * `MATH_CHECKS` a basis that is not a rotation is an error that returns the identity quaternion.
 * `Quaternion(Basis)` is this.
 *
 * @godot Basis (protocol)
 * @source core/math/basis.cpp:715
 */
export function godot_basis_get_quaternion(self: Basis): Quaternion {
  if (!isRotation(self)) return quaternion();
  const m = (r: 0 | 1 | 2, c: 0 | 1 | 2): number => at(self, r, c);
  const trace = f32(f32(m(0, 0) + m(1, 1)) + m(2, 2));
  const temp = [0, 0, 0, 0];
  if (trace > 0) {
    let s = f32(Math.sqrt(f32(trace + 1)));
    temp[3] = f32(s * 0.5);
    s = f32(0.5 / s);
    temp[0] = f32(f32(m(2, 1) - m(1, 2)) * s);
    temp[1] = f32(f32(m(0, 2) - m(2, 0)) * s);
    temp[2] = f32(f32(m(1, 0) - m(0, 1)) * s);
  } else {
    const i: 0 | 1 | 2 = m(0, 0) < m(1, 1) ? (m(1, 1) < m(2, 2) ? 2 : 1) : m(0, 0) < m(2, 2) ? 2 : 0;
    const j = ((i + 1) % 3) as 0 | 1 | 2;
    const k = ((i + 2) % 3) as 0 | 1 | 2;
    let s = f32(Math.sqrt(f32(f32(f32(m(i, i) - m(j, j)) - m(k, k)) + 1)));
    temp[i] = f32(s * 0.5);
    s = f32(0.5 / s);
    temp[3] = f32(f32(m(k, j) - m(j, k)) * s);
    temp[j] = f32(f32(m(j, i) + m(i, j)) * s);
    temp[k] = f32(f32(m(k, i) + m(i, k)) * s);
  }
  return quaternion(temp[0] ?? 0, temp[1] ?? 0, temp[2] ?? 0, temp[3] ?? 0);
}

/**
 * The rotations slerped as quaternions (`Quaternion(Basis)`), then each row scaled by the lerp of
 * the two rows' lengths.
 *
 * @godot Basis.slerp
 * @source core/math/basis.cpp:911
 */
export function slerp(self: Basis, p_to: Basis, p_weight: number): Basis {
  const weight = f32(p_weight);
  const b = godot_basis_from_quaternion(
    quaternionSlerp(godot_basis_get_quaternion(self), godot_basis_get_quaternion(p_to), weight),
  );
  const lerpLength = (r: 0 | 1 | 2): number => {
    const from = vector3Length(row(self, r));
    return f32(from + f32(f32(vector3Length(row(p_to, r)) - from) * weight));
  };
  return fromRows(vector3Multiply(row(b, 0), lerpLength(0)), vector3Multiply(row(b, 1), lerpLength(1)), vector3Multiply(row(b, 2), lerpLength(2)));
}

/**
 * Columns of equal length and mutually perpendicular.
 *
 * @godot Basis.is_conformal
 * @source core/math/basis.cpp:113
 */
export function is_conformal(self: Basis): boolean {
  const xLenSq = vector3LengthSquared(self.x);
  return (
    isEqualApproxReal(xLenSq, vector3LengthSquared(self.y)) &&
    isEqualApproxReal(xLenSq, vector3LengthSquared(self.z)) &&
    isZeroApproxReal(dot(self.x, self.y)) &&
    isZeroApproxReal(dot(self.x, self.z)) &&
    isZeroApproxReal(dot(self.y, self.z))
  );
}

/**
 * Row by row (`Vector3::is_equal_approx`), which compares the same nine entries as the columns.
 *
 * @godot Basis.is_equal_approx
 * @source core/math/basis.cpp:697
 */
export function is_equal_approx(self: Basis, p_basis: Basis): boolean {
  return vector3IsEqualApprox(self.x, p_basis.x) && vector3IsEqualApprox(self.y, p_basis.y) && vector3IsEqualApprox(self.z, p_basis.z);
}

/**
 * @godot Basis.is_finite
 * @source core/math/basis.cpp:705
 */
export function is_finite(self: Basis): boolean {
  return vector3IsFinite(self.x) && vector3IsFinite(self.y) && vector3IsFinite(self.z);
}

/**
 * Unit columns, mutually perpendicular.
 *
 * @godot Basis.is_orthonormal
 * @source core/math/basis.cpp:104
 */
export function is_orthonormal(self: Basis): boolean {
  return (
    isEqualApproxReal(vector3LengthSquared(self.x), 1) &&
    isEqualApproxReal(vector3LengthSquared(self.y), 1) &&
    isEqualApproxReal(vector3LengthSquared(self.z), 1) &&
    isZeroApproxReal(dot(self.x, self.y)) &&
    isZeroApproxReal(dot(self.x, self.z)) &&
    isZeroApproxReal(dot(self.y, self.z))
  );
}

/**
 * The basis orthonormalized, negated when its determinant is negative, as a quaternion.
 *
 * @godot Basis.get_rotation_quaternion
 * @source core/math/basis.cpp:400
 */
export function get_rotation_quaternion(self: Basis): Quaternion {
  let m = orthonormalized(self);
  if (determinant(m) < 0) m = fromColumns(vector3Negate(m.x), vector3Negate(m.y), vector3Negate(m.z));
  return godot_basis_get_quaternion(m);
}

/**
 * The basis whose -Z (or +Z with `use_model_front`) faces `target`, with Y as close to `up` as it
 * can be; under `MATH_CHECKS` a zero target or up returns the identity. The Variant defaults are
 * `up = Vector3.UP` and `use_model_front = false` (`core/variant/variant_call.cpp:2554`).
 *
 * @godot Basis.looking_at
 * @source core/math/basis.cpp:1034
 */
export function looking_at(p_target: Vector3, p_up: Vector3 = UP, p_use_model_front = false): Basis {
  if (vector3IsZeroApprox(p_target) || vector3IsZeroApprox(p_up)) return IDENTITY;
  let vZ = normalized(p_target);
  if (!p_use_model_front) vZ = vector3Negate(vZ);
  let vX = cross(p_up, vZ);
  if (vector3IsZeroApprox(vX)) {
    const useRight = Math.abs(p_up.x) <= Math.abs(p_up.y) && Math.abs(p_up.x) <= Math.abs(p_up.z);
    vX = normalized(cross(p_up, useRight ? vector3(1, 0, 0) : UP));
  }
  vX = normalized(vX);
  return fromColumns(vX, cross(vZ, vX), vZ);
}

/**
 * The diagonal basis.
 *
 * @godot Basis.from_scale
 * @source core/math/basis.cpp:229
 */
export function from_scale(p_scale: Vector3): Basis {
  return fromEntries(p_scale.x, 0, 0, 0, p_scale.y, 0, 0, 0, p_scale.z);
}

/**
 * `Basis::set_euler` (`core/math/basis.cpp:657`): the three axis rotations composed in `order`
 * (the Variant default is `EULER_ORDER_YXZ`, 2, `core/variant/variant_call.cpp:2556`). Another
 * order is an error that leaves the identity.
 *
 * @godot Basis.from_euler
 * @source core/math/basis.h:85
 */
export function from_euler(p_euler: Vector3, p_order = 2): Basis {
  let c = f32(Math.cos(p_euler.x));
  let s = f32(Math.sin(p_euler.x));
  const xmat = fromEntries(1, 0, 0, 0, c, -s, 0, s, c);
  c = f32(Math.cos(p_euler.y));
  s = f32(Math.sin(p_euler.y));
  const ymat = fromEntries(c, 0, s, 0, 1, 0, -s, 0, c);
  c = f32(Math.cos(p_euler.z));
  s = f32(Math.sin(p_euler.z));
  const zmat = fromEntries(c, -s, 0, s, c, 0, 0, 0, 1);
  const mul = (a: Basis, b: Basis): Basis => op_multiply(a, b);
  switch (p_order) {
    case 0:
      return mul(xmat, mul(ymat, zmat));
    case 1:
      return mul(mul(xmat, zmat), ymat);
    case 2:
      return mul(mul(ymat, xmat), zmat);
    case 3:
      return mul(mul(ymat, zmat), xmat);
    case 4:
      return mul(mul(zmat, xmat), ymat);
    case 5:
      return mul(mul(zmat, ymat), xmat);
    default:
      return IDENTITY;
  }
}

/**
 * Every entry divided by the scalar (`core/math/basis.h:330`); plain `OperatorEvaluatorDiv`, so a
 * zero divisor follows IEEE division.
 *
 * @godot Basis.OP_DIVIDE
 * @source core/math/basis.h:330
 */
export function op_divide(left: Basis, right: number): Basis {
  const s = f32(right);
  const div = (v: Vector3): Vector3 => vector3(f32(v.x / s), f32(v.y / s), f32(v.z / s));
  return fromColumns(div(left.x), div(left.y), div(left.z));
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:549`).
 *
 * @godot Basis.OP_EQUAL
 * @source core/math/basis.h:258
 */
export function op_equal(left: Basis, right: Basis | null): boolean {
  if (right === null) return false;
  const same = (a: Vector3, b: Vector3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
  return same(left.x, right.x) && same(left.y, right.y) && same(left.z, right.z);
}

/**
 * @godot Basis.OP_NOT_EQUAL
 * @source core/math/basis.h:270
 */
export function op_not_equal(left: Basis, right: Basis | null): boolean {
  return !op_equal(left, right);
}

/**
 * `b == Basis()`, the identity.
 *
 * @godot Basis.OP_NOT
 * @source core/variant/variant_op.cpp:900
 */
export function op_not(self: Basis): boolean {
  return op_equal(self, IDENTITY);
}

/** Whether an Array element or a Dictionary key is this Basis. */
function isBasisEqual(value: unknown, b: Basis): boolean {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) return false;
  const other = value as Basis;
  return typeof other.x === 'object' && typeof other.y === 'object' && typeof other.z === 'object' && op_equal(b, other);
}

/**
 * `b in array` is `array.find(b) != -1`; `b in dict` is `dict.has(b)`
 * (`core/variant/variant_op.h:1180`). A Basis key is matched by value.
 *
 * @godot Basis.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Basis, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isBasisEqual(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isBasisEqual(key, left)) return true;
  return false;
}
