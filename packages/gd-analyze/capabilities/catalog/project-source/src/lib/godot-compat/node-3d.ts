/**
 * @godot-class Node3D
 * @role PROTOCOL
 *
 * Godot 4.7's `Node3D` transform members, transcribed from `scene/3d/node_3d.cpp` and the
 * `core/math/basis.cpp` / `core/math/transform_3d.cpp` arithmetic they run, at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. `real_t` is 32-bit and every intermediate is rounded
 * with `Math.fround` where the C++ rounds it; `float` calls into the C library (`sinf`, `cosf`,
 * `asinf`, `atan2f`) are the double result rounded to float.
 *
 * The receiver is the `THREE.Object3D` the generated scene mounted. Its parent Node3D is its three
 * parent (`Object3D.parent`), unless that is absent, a `THREE.Scene` (the viewport above the 3D
 * tree), or a plain `Node`'s group, which `node.ts` marks non-spatial. The native entity holds the LOCAL transform: `matrix`
 * holds `data.local_transform` exactly (every element a float32 value, `matrixAutoUpdate` off),
 * and `position`/`quaternion`/`scale` are decomposed from it for three's own readers. Godot state
 * no three object holds lives in `NODE3D`, keyed by the Object3D: the Euler rotation and scale
 * split, the dirty bits, `rotation_order` and `top_level`. The global transform is computed on
 * demand from the three parent chain exactly as `get_global_transform` computes it; three's
 * `matrixWorld` is only the renderer's copy (a top-level node writes its own).
 *
 * An Object3D compat has not seen starts as Godot would have it: an identity matrix is a fresh
 * Node3D; any other local matrix is a Node3D whose `transform` was set (as a scene file sets it).
 */

import type { Object3D } from 'three';
import { type Basis, construct as basis } from './basis';
import { godot_node_duplicate_state, godot_node_is_spatial, is_inside_tree } from './node';
import { type Transform3D, construct as transform3d } from './transform-3d';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;
/** `(float)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);
/** `(real_t)UNIT_EPSILON` without `PRECISE_MATH_CHECKS` (`core/math/math_defs.h:65`). */
const UNIT_EPSILON = f32(0.001);
const PI = 3.1415926535897932384626433833;

/** `Node3D::DIRTY_*` (`scene/3d/node_3d.h:86`). */
const DIRTY_NONE = 0;
const DIRTY_EULER_ROTATION_AND_SCALE = 1;
const DIRTY_LOCAL_TRANSFORM = 2;

/** `EulerOrder` (`core/math/math_defs.h`): XYZ, XZY, YXZ, YZX, ZXY, ZYX. */
const EULER_XYZ = 0;
const EULER_XZY = 1;
const EULER_YXZ = 2;
const EULER_YZX = 3;
const EULER_ZXY = 4;
const EULER_ZYX = 5;

/** Nine float32 values, row-major: `rows[i][j]` is `m[3 * i + j]`. */
type Rows = readonly number[];
interface Local {
  readonly basis: Rows;
  readonly origin: readonly [number, number, number];
}

interface Node3DState {
  euler: readonly [number, number, number];
  scale: readonly [number, number, number];
  order: number;
  dirty: number;
  topLevel: boolean;
}

const NODE3D = new WeakMap<Object3D, Node3DState>();

// `duplicate` copies the stored transform properties: the matrix comes with the entity's copy.
godot_node_duplicate_state('Node3D', (from, to) => {
  const state = NODE3D.get(from as Object3D);
  if (state !== undefined) NODE3D.set(to as Object3D, { ...state });
});

// --- Vector3 and Basis arithmetic, as `core/math/vector3.h` and `core/math/basis.{h,cpp}` round it.

type V3 = readonly [number, number, number];

function dot3(a: V3, b: V3): number {
  return f32(f32(f32(a[0] * b[0]) + f32(a[1] * b[1])) + f32(a[2] * b[2]));
}

function length3(v: V3): number {
  return f32(Math.sqrt(f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2]))));
}

/** `Vector3::normalize` (`core/math/vector3.h:548`). */
function normalize3(v: V3): V3 {
  if (!(Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]))) return [0, 0, 0];
  let l = f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2]));
  if (l === 0) return [0, 0, 0];
  l = f32(Math.sqrt(l));
  return [f32(v[0] / l), f32(v[1] / l), f32(v[2] / l)];
}

function scale3(v: V3, s: number): V3 {
  return [f32(v[0] * s), f32(v[1] * s), f32(v[2] * s)];
}

function sub3(a: V3, b: V3): V3 {
  return [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2])];
}

function cross3(a: V3, b: V3): V3 {
  return [
    f32(f32(a[1] * b[2]) - f32(a[2] * b[1])),
    f32(f32(a[2] * b[0]) - f32(a[0] * b[2])),
    f32(f32(a[0] * b[1]) - f32(a[1] * b[0])),
  ];
}

function isZeroApprox3(v: V3): boolean {
  return Math.abs(v[0]) < CMP_EPSILON && Math.abs(v[1]) < CMP_EPSILON && Math.abs(v[2]) < CMP_EPSILON;
}

/** `Math::is_equal_approx(float, float)` (`core/math/math_funcs.h:540`). */
function isEqualApprox(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(CMP_EPSILON * Math.abs(left));
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(f32(left - right)) < tolerance;
}

function row(m: Rows, i: number): V3 {
  return [m[3 * i] as number, m[3 * i + 1] as number, m[3 * i + 2] as number];
}

function column(m: Rows, j: number): V3 {
  return [m[j] as number, m[3 + j] as number, m[6 + j] as number];
}

function fromColumns(x: V3, y: V3, z: V3): Rows {
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

const IDENTITY: Rows = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** `Basis::operator*` (`core/math/basis.h:281`): `set(p_matrix.tdotx(rows[i]), ...)`. */
function mulBasis(a: Rows, b: Rows): Rows {
  const out: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const r = row(a, i);
    for (let j = 0; j < 3; j += 1) {
      out.push(f32(f32(f32((b[j] as number) * r[0]) + f32((b[3 + j] as number) * r[1])) + f32((b[6 + j] as number) * r[2])));
    }
  }
  return out;
}

/** `Basis::xform` (`core/math/basis.h:336`). */
function xformBasis(m: Rows, v: V3): V3 {
  return [dot3(row(m, 0), v), dot3(row(m, 1), v), dot3(row(m, 2), v)];
}

/** `Basis::determinant` (`core/math/basis.h:350`). */
function determinant(m: Rows): number {
  const r = (i: number, j: number): number => m[3 * i + j] as number;
  return f32(
    f32(
      f32(r(0, 0) * f32(f32(r(1, 1) * r(2, 2)) - f32(r(2, 1) * r(1, 2)))) -
        f32(r(1, 0) * f32(f32(r(0, 1) * r(2, 2)) - f32(r(2, 1) * r(0, 2)))),
    ) + f32(r(2, 0) * f32(f32(r(0, 1) * r(1, 2)) - f32(r(1, 1) * r(0, 2)))),
  );
}

/** `Basis::invert` (`core/math/basis.cpp:39`); a zero determinant fails under `MATH_CHECKS`. */
function inverse(m: Rows): Rows {
  const r = (i: number, j: number): number => m[3 * i + j] as number;
  const cofac = (r1: number, c1: number, r2: number, c2: number): number =>
    f32(f32(r(r1, c1) * r(r2, c2)) - f32(r(r1, c2) * r(r2, c1)));
  const co = [cofac(1, 1, 2, 2), cofac(1, 2, 2, 0), cofac(1, 0, 2, 1)] as const;
  const det = f32(f32(f32(r(0, 0) * co[0]) + f32(r(0, 1) * co[1])) + f32(r(0, 2) * co[2]));
  if (det === 0) return m;
  const s = f32(1 / det);
  return [
    f32(co[0] * s), f32(cofac(0, 2, 2, 1) * s), f32(cofac(0, 1, 1, 2) * s),
    f32(co[1] * s), f32(cofac(0, 0, 2, 2) * s), f32(cofac(0, 2, 1, 0) * s),
    f32(co[2] * s), f32(cofac(0, 1, 2, 0) * s), f32(cofac(0, 0, 1, 1) * s),
  ];
}

/** `SIGN` (`core/typedefs.h:137`). */
function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

/** `Basis::get_scale` (`core/math/basis.cpp:301`): `SIGN(determinant()) * get_scale_abs()`. */
function getScale(m: Rows): V3 {
  const s = sign(determinant(m));
  return scale3([length3(column(m, 0)), length3(column(m, 1)), length3(column(m, 2))], s);
}

/** `Basis::orthonormalize` (`core/math/basis.cpp:56`): Gram-Schmidt over the columns. */
function orthonormalized(m: Rows): Rows {
  const x = normalize3(column(m, 0));
  let y = column(m, 1);
  let z = column(m, 2);
  y = normalize3(sub3(y, scale3(x, dot3(x, y))));
  z = normalize3(sub3(sub3(z, scale3(x, dot3(x, z))), scale3(y, dot3(y, z))));
  return fromColumns(x, y, z);
}

/** `std::atan2(float, float)`, whose result the C standard keeps within `[-pi, pi]`. */
function atan2f(y: number, x: number): number {
  const result = f32(Math.atan2(y, x));
  if (result > Math.PI) return 3.141592502593994;
  if (result < -Math.PI) return -3.141592502593994;
  return result;
}

/** `Math::asin(float)` (`core/math/math_funcs.h:101`). */
function asinf(x: number): number {
  return x < -1 ? f32(-f32(PI) / 2) : x > 1 ? f32(f32(PI) / 2) : f32(Math.asin(x));
}

/** `Basis::get_euler` (`core/math/basis.cpp:456`). */
function getEuler(m: Rows, order: number): V3 {
  const r = (i: number, j: number): number => m[3 * i + j] as number;
  const epsilon = f32(0.00000025);
  const one = f32(1 - epsilon);
  const halfPi = f32(PI / 2);
  switch (order) {
    case EULER_XYZ: {
      const sy = r(0, 2);
      if (sy < one) {
        if (sy > -one) {
          if (r(1, 0) === 0 && r(0, 1) === 0 && r(1, 2) === 0 && r(2, 1) === 0 && r(1, 1) === 1) {
            return [0, atan2f(r(0, 2), r(0, 0)), 0];
          }
          return [atan2f(-r(1, 2), r(2, 2)), asinf(sy), atan2f(-r(0, 1), r(0, 0))];
        }
        return [atan2f(r(2, 1), r(1, 1)), -halfPi, 0];
      }
      return [atan2f(r(2, 1), r(1, 1)), halfPi, 0];
    }
    case EULER_XZY: {
      const sz = r(0, 1);
      if (sz < one) {
        if (sz > -one) return [atan2f(r(2, 1), r(1, 1)), atan2f(r(0, 2), r(0, 0)), asinf(-sz)];
        return [-atan2f(r(1, 2), r(2, 2)), 0, halfPi];
      }
      return [-atan2f(r(1, 2), r(2, 2)), 0, -halfPi];
    }
    case EULER_YXZ: {
      const m12 = r(1, 2);
      if (m12 < one) {
        if (m12 > -one) {
          if (r(1, 0) === 0 && r(0, 1) === 0 && r(0, 2) === 0 && r(2, 0) === 0 && r(0, 0) === 1) {
            return [atan2f(-m12, r(1, 1)), 0, 0];
          }
          return [asinf(-m12), atan2f(r(0, 2), r(2, 2)), atan2f(r(1, 0), r(1, 1))];
        }
        return [f32(PI * 0.5), atan2f(r(0, 1), r(0, 0)), 0];
      }
      return [f32(-PI * 0.5), -atan2f(r(0, 1), r(0, 0)), 0];
    }
    case EULER_YZX: {
      const sz = r(1, 0);
      if (sz < one) {
        if (sz > -one) return [atan2f(-r(1, 2), r(1, 1)), atan2f(-r(2, 0), r(0, 0)), asinf(sz)];
        return [atan2f(r(2, 1), r(2, 2)), 0, -halfPi];
      }
      return [atan2f(r(2, 1), r(2, 2)), 0, halfPi];
    }
    case EULER_ZXY: {
      const sx = r(2, 1);
      if (sx < one) {
        if (sx > -one) return [asinf(sx), atan2f(-r(2, 0), r(2, 2)), atan2f(-r(0, 1), r(1, 1))];
        return [-halfPi, atan2f(r(0, 2), r(0, 0)), 0];
      }
      return [halfPi, atan2f(r(0, 2), r(0, 0)), 0];
    }
    case EULER_ZYX: {
      const sy = r(2, 0);
      if (sy < one) {
        if (sy > -one) return [atan2f(r(2, 1), r(2, 2)), asinf(-sy), atan2f(r(1, 0), r(0, 0))];
        return [0, halfPi, -atan2f(r(0, 1), r(1, 1))];
      }
      return [0, -halfPi, -atan2f(r(0, 1), r(1, 1))];
    }
    default:
      return [0, 0, 0];
  }
}

/** `Basis::get_euler_normalized` (`core/math/basis.cpp:386`). */
function getEulerNormalized(m: Rows, order: number): V3 {
  let o = orthonormalized(m);
  if (determinant(o) < 0) o = o.map((value) => f32(value * -1));
  return getEuler(o, order);
}

/** `Basis::set_euler` / `from_euler` (`core/math/basis.cpp:657`). */
function fromEuler(euler: V3, order: number): Rows {
  let c = f32(Math.cos(euler[0]));
  let s = f32(Math.sin(euler[0]));
  const xmat: Rows = [1, 0, 0, 0, c, -s, 0, s, c];
  c = f32(Math.cos(euler[1]));
  s = f32(Math.sin(euler[1]));
  const ymat: Rows = [c, 0, s, 0, 1, 0, -s, 0, c];
  c = f32(Math.cos(euler[2]));
  s = f32(Math.sin(euler[2]));
  const zmat: Rows = [c, -s, 0, s, c, 0, 0, 0, 1];
  switch (order) {
    case EULER_XYZ:
      return mulBasis(xmat, mulBasis(ymat, zmat));
    case EULER_XZY:
      return mulBasis(mulBasis(xmat, zmat), ymat);
    case EULER_YXZ:
      return mulBasis(mulBasis(ymat, xmat), zmat);
    case EULER_YZX:
      return mulBasis(mulBasis(ymat, zmat), xmat);
    case EULER_ZXY:
      return mulBasis(mulBasis(zmat, xmat), ymat);
    case EULER_ZYX:
      return mulBasis(mulBasis(zmat, ymat), xmat);
    default:
      return IDENTITY;
  }
}

/** `Basis::set_euler_scale` (`core/math/basis.cpp:876`): `from_euler(euler, order) * diagonal(scale)`. */
function eulerScale(euler: V3, scale: V3, order: number): Rows {
  return mulBasis(fromEuler(euler, order), [scale[0], 0, 0, 0, scale[1], 0, 0, 0, scale[2]]);
}

/** `Basis(axis, angle)` via `Basis::set_axis_angle` (`core/math/basis.cpp:841`). */
function axisAngle(axis: V3, angle: number): Rows {
  const lengthSquared = f32(f32(f32(axis[0] * axis[0]) + f32(axis[1] * axis[1])) + f32(axis[2] * axis[2]));
  if (!(lengthSquared === 1 || Math.abs(f32(lengthSquared - 1)) < UNIT_EPSILON)) return IDENTITY;
  const a = f32(angle);
  const sqX = f32(axis[0] * axis[0]);
  const sqY = f32(axis[1] * axis[1]);
  const sqZ = f32(axis[2] * axis[2]);
  const cosine = f32(Math.cos(a));
  const sine = f32(Math.sin(a));
  const t = f32(1 - cosine);
  let xyzt = f32(f32(axis[0] * axis[1]) * t);
  let zyxs = f32(axis[2] * sine);
  const r01 = f32(xyzt - zyxs);
  const r10 = f32(xyzt + zyxs);
  xyzt = f32(f32(axis[0] * axis[2]) * t);
  zyxs = f32(axis[1] * sine);
  const r02 = f32(xyzt + zyxs);
  const r20 = f32(xyzt - zyxs);
  xyzt = f32(f32(axis[1] * axis[2]) * t);
  zyxs = f32(axis[0] * sine);
  const r12 = f32(xyzt - zyxs);
  const r21 = f32(xyzt + zyxs);
  return [
    f32(sqX + f32(cosine * f32(1 - sqX))), r01, r02,
    r10, f32(sqY + f32(cosine * f32(1 - sqY))), r12,
    r20, r21, f32(sqZ + f32(cosine * f32(1 - sqZ))),
  ];
}

/** `Transform3D::operator*` (`core/math/transform_3d.cpp:185`): origin by `xform`, then the basis. */
function mulTransform(a: Local, b: Local): Local {
  const o = xformBasis(a.basis, b.origin);
  return {
    basis: mulBasis(a.basis, b.basis),
    origin: [f32(o[0] + a.origin[0]), f32(o[1] + a.origin[1]), f32(o[2] + a.origin[2])],
  };
}

/** `Transform3D::affine_inverse` (`core/math/transform_3d.cpp:35`). */
function affineInverse(t: Local): Local {
  const inv = inverse(t.basis);
  return { basis: inv, origin: xformBasis(inv, [-t.origin[0], -t.origin[1], -t.origin[2]]) };
}

/** `Basis::looking_at` (`core/math/basis.cpp:1034`). */
function lookingAt(target: V3, up: V3, useModelFront: boolean): Rows {
  if (isZeroApprox3(target) || isZeroApprox3(up)) return IDENTITY;
  let vz = normalize3(target);
  if (!useModelFront) vz = [-vz[0], -vz[1], -vz[2]];
  let vx = cross3(up, vz);
  if (isZeroApprox3(vx)) {
    // `Vector3::get_any_perpendicular` (`core/math/vector3.h:375`); `up` is not zero here.
    const useRight = Math.abs(up[0]) <= Math.abs(up[1]) && Math.abs(up[0]) <= Math.abs(up[2]);
    vx = normalize3(cross3(up, useRight ? [1, 0, 0] : [0, 1, 0]));
  }
  vx = normalize3(vx);
  const vy = cross3(vz, vx);
  return fromColumns(vx, vy, vz);
}

// --- The native receiver.

/** The local transform the Object3D's `matrix` holds (column-major, `matrix.elements`). */
function readLocal(object: Object3D): Local {
  const e = object.matrix.elements;
  return {
    basis: [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]].map((value) => f32(value as number)),
    origin: [f32(e[12] as number), f32(e[13] as number), f32(e[14] as number)],
  };
}

/** Write `data.local_transform` into the Object3D, and the renderer's copies derived from it. */
function writeLocal(object: Object3D, state: Node3DState, local: Local): void {
  const b = local.basis;
  const o = local.origin;
  object.matrixAutoUpdate = false;
  object.matrix.set(
    b[0] as number, b[1] as number, b[2] as number, o[0],
    b[3] as number, b[4] as number, b[5] as number, o[1],
    b[6] as number, b[7] as number, b[8] as number, o[2],
    0, 0, 0, 1,
  );
  object.matrix.decompose(object.position, object.quaternion, object.scale);
  if (state.topLevel) {
    object.matrixWorldAutoUpdate = false;
    object.matrixWorld.copy(object.matrix);
  } else {
    object.matrixWorldAutoUpdate = true;
  }
  object.matrixWorldNeedsUpdate = true;
}

function isIdentity(local: Local): boolean {
  return local.basis.every((value, index) => value === IDENTITY[index]) && local.origin.every((value) => value === 0);
}

function stateOf(object: Object3D): Node3DState {
  let state = NODE3D.get(object);
  if (state !== undefined) return state;
  if (object.matrixAutoUpdate) object.updateMatrix();
  const local = readLocal(object);
  state = {
    euler: [0, 0, 0],
    scale: [1, 1, 1],
    order: EULER_YXZ,
    dirty: isIdentity(local) ? DIRTY_NONE : DIRTY_EULER_ROTATION_AND_SCALE,
    topLevel: false,
  };
  NODE3D.set(object, state);
  writeLocal(object, state, local);
  return state;
}

/**
 * `data.parent`: the parent cast to Node3D (`scene/3d/node_3d.cpp:157`); a `THREE.Scene` or an
 * entity `node.ts` marks as a plain Node is not one, and the node then has no parent Node3D.
 */
function parentNode3D(object: Object3D): Object3D | null {
  const parent = object.parent;
  if (parent === null || (parent as { readonly isScene?: boolean }).isScene === true) return null;
  if (!godot_node_is_spatial(parent)) return null;
  return parent;
}

/** `_update_local_transform` (`scene/3d/node_3d.cpp:92`) when `DIRTY_LOCAL_TRANSFORM` is set. */
function localOf(object: Object3D, state: Node3DState): Local {
  const local = readLocal(object);
  if ((state.dirty & DIRTY_LOCAL_TRANSFORM) !== 0) {
    state.dirty &= ~DIRTY_LOCAL_TRANSFORM;
    return { basis: eulerScale(state.euler, state.scale, state.order), origin: local.origin };
  }
  return local;
}

/** `_update_rotation_and_scale` (`scene/3d/node_3d.cpp:98`) when its dirty bit is set. */
function rotationAndScaleOf(object: Object3D, state: Node3DState): void {
  if ((state.dirty & DIRTY_EULER_ROTATION_AND_SCALE) !== 0) {
    const local = readLocal(object);
    state.scale = getScale(local.basis);
    state.euler = getEulerNormalized(local.basis, state.order);
    state.dirty &= ~DIRTY_EULER_ROTATION_AND_SCALE;
  }
}

/**
 * The Object3D's `matrix` always holds the current local transform: when Godot would leave
 * `data.local_transform` stale behind `DIRTY_LOCAL_TRANSFORM`, the matrix holds what
 * `_update_local_transform` will produce, and the dirty bit stays as Godot keeps it.
 */
function markLocalDirty(object: Object3D, state: Node3DState): void {
  state.dirty = DIRTY_LOCAL_TRANSFORM;
  const origin = readLocal(object).origin;
  writeLocal(object, state, { basis: eulerScale(state.euler, state.scale, state.order), origin });
}

function globalOf(object: Object3D): Local {
  const state = stateOf(object);
  const local = localOf(object, state);
  const parent = parentNode3D(object);
  if (parent !== null && !state.topLevel) return mulTransform(globalOf(parent), local);
  return local;
}

function setLocal(object: Object3D, local: Local): void {
  const state = stateOf(object);
  state.dirty = DIRTY_EULER_ROTATION_AND_SCALE;
  writeLocal(object, state, local);
}

function toV3(v: Vector3): V3 {
  return [f32(v.x), f32(v.y), f32(v.z)];
}

function toVector3(v: V3): Vector3 {
  return vector3(v[0], v[1], v[2]);
}

function toBasis(m: Rows): Basis {
  return basis(toVector3(column(m, 0)), toVector3(column(m, 1)), toVector3(column(m, 2)));
}

function fromBasis(b: Basis): Rows {
  return fromColumns(toV3(b.x), toV3(b.y), toV3(b.z));
}

function toTransform(t: Local): Transform3D {
  return transform3d(toBasis(t.basis), toVector3(t.origin));
}

function fromTransform(t: Transform3D): Local {
  return { basis: fromBasis(t.basis), origin: toV3(t.origin) };
}

// --- Node3D members.

/**
 * @godot Node3D.set_transform
 * @source scene/3d/node_3d.cpp:399
 */
export function set_transform(self: Object3D, p_transform: Transform3D): void {
  setLocal(self, fromTransform(p_transform));
}

/**
 * @godot Node3D.get_transform
 * @source scene/3d/node_3d.cpp:429
 */
export function get_transform(self: Object3D): Transform3D {
  return toTransform(localOf(self, stateOf(self)));
}

/**
 * `data.local_transform.origin = p_position`; the dirty bits are untouched.
 *
 * @godot Node3D.set_position
 * @source scene/3d/node_3d.cpp:714
 */
export function set_position(self: Object3D, p_position: Vector3): void {
  const state = stateOf(self);
  const local = readLocal(self);
  writeLocal(self, state, { basis: local.basis, origin: toV3(p_position) });
}

/**
 * @godot Node3D.get_position
 * @source scene/3d/node_3d.cpp:836
 */
export function get_position(self: Object3D): Vector3 {
  stateOf(self);
  return toVector3(readLocal(self).origin);
}

/**
 * @godot Node3D.set_rotation
 * @source scene/3d/node_3d.cpp:796
 */
export function set_rotation(self: Object3D, p_euler_rad: Vector3): void {
  const state = stateOf(self);
  if ((state.dirty & DIRTY_EULER_ROTATION_AND_SCALE) !== 0) {
    state.scale = getScale(readLocal(self).basis);
    state.dirty &= ~DIRTY_EULER_ROTATION_AND_SCALE;
  }
  state.euler = toV3(p_euler_rad);
  markLocalDirty(self, state);
}

/**
 * @godot Node3D.get_rotation
 * @source scene/3d/node_3d.cpp:841
 */
export function get_rotation(self: Object3D): Vector3 {
  const state = stateOf(self);
  rotationAndScaleOf(self, state);
  return toVector3(state.euler);
}

/**
 * @godot Node3D.set_scale
 * @source scene/3d/node_3d.cpp:819
 */
export function set_scale(self: Object3D, p_scale: Vector3): void {
  const state = stateOf(self);
  if ((state.dirty & DIRTY_EULER_ROTATION_AND_SCALE) !== 0) {
    state.euler = getEulerNormalized(readLocal(self).basis, state.order);
    state.dirty &= ~DIRTY_EULER_ROTATION_AND_SCALE;
  }
  state.scale = toV3(p_scale);
  markLocalDirty(self, state);
}

/**
 * @godot Node3D.get_scale
 * @source scene/3d/node_3d.cpp:856
 */
export function get_scale(self: Object3D): Vector3 {
  const state = stateOf(self);
  rotationAndScaleOf(self, state);
  return toVector3(state.scale);
}

/**
 * `set_transform(Transform3D(p_basis, data.local_transform.origin))`.
 *
 * @godot Node3D.set_basis
 * @source scene/3d/node_3d.cpp:316
 */
export function set_basis(self: Object3D, p_basis: Basis): void {
  stateOf(self);
  setLocal(self, { basis: fromBasis(p_basis), origin: readLocal(self).origin });
}

/**
 * @godot Node3D.get_basis
 * @source scene/3d/node_3d.cpp:411
 */
export function get_basis(self: Object3D): Basis {
  return toBasis(localOf(self, stateOf(self)).basis);
}

/**
 * The parent's global transform times the local one, or the local one for a top-level node or a
 * node without a parent Node3D.
 *
 * @godot Node3D.get_global_transform
 * @source scene/3d/node_3d.cpp:648
 */
export function get_global_transform(self: Object3D): Transform3D {
  return toTransform(globalOf(self));
}

/**
 * @godot Node3D.set_global_transform
 * @source scene/3d/node_3d.cpp:420
 */
export function set_global_transform(self: Object3D, p_transform: Transform3D): void {
  const state = stateOf(self);
  const parent = parentNode3D(self);
  const wanted = fromTransform(p_transform);
  setLocal(self, parent !== null && !state.topLevel ? mulTransform(affineInverse(globalOf(parent)), wanted) : wanted);
}

/**
 * @godot Node3D.get_global_position
 * @source scene/3d/node_3d.cpp:341
 */
export function get_global_position(self: Object3D): Vector3 {
  return toVector3(globalOf(self).origin);
}

/**
 * @godot Node3D.set_global_position
 * @source scene/3d/node_3d.cpp:351
 */
export function set_global_position(self: Object3D, p_position: Vector3): void {
  const global = globalOf(self);
  set_global_transform(self, toTransform({ basis: global.basis, origin: toV3(p_position) }));
}

/**
 * @godot Node3D.get_global_basis
 * @source scene/3d/node_3d.cpp:346
 */
export function get_global_basis(self: Object3D): Basis {
  return toBasis(globalOf(self).basis);
}

/**
 * @godot Node3D.set_global_basis
 * @source scene/3d/node_3d.cpp:358
 */
export function set_global_basis(self: Object3D, p_basis: Basis): void {
  const global = globalOf(self);
  set_global_transform(self, toTransform({ basis: fromBasis(p_basis), origin: global.origin }));
}

/**
 * `t.basis.rotate(Vector3(0, 1, 0), p_angle)`: `Basis(axis, angle) * basis`
 * (`core/math/basis.cpp:352`).
 *
 * @godot Node3D.rotate_y
 * @source scene/3d/node_3d.cpp:1174
 */
export function rotate_y(self: Object3D, p_angle: number): void {
  const local = localOf(self, stateOf(self));
  setLocal(self, { basis: mulBasis(axisAngle([0, 1, 0], p_angle), local.basis), origin: local.origin });
}

/**
 * Fails (does nothing) when the position approximately equals the target or `up` is zero;
 * otherwise sets the global transform to `Basis::looking_at(target - pos, up)` at `pos` and
 * restores the previous scale. The Variant defaults are `up = Vector3.UP`,
 * `use_model_front = false`.
 *
 * @godot Node3D.look_at_from_position
 * @source scene/3d/node_3d.cpp:1258
 */
export function look_at_from_position(
  self: Object3D,
  p_pos: Vector3,
  p_target: Vector3,
  p_up: Vector3 = vector3(0, 1, 0),
  p_use_model_front = false,
): void {
  const pos = toV3(p_pos);
  const target = toV3(p_target);
  const up = toV3(p_up);
  if (isEqualApprox(pos[0], target[0]) && isEqualApprox(pos[1], target[1]) && isEqualApprox(pos[2], target[2])) return;
  if (isZeroApprox3(up)) return;
  const basisLooking = lookingAt(sub3(target, pos), up, p_use_model_front);
  const originalScale = get_scale(self);
  set_global_transform(self, toTransform({ basis: basisLooking, origin: pos }));
  set_scale(self, originalScale);
}

/**
 * Inside the tree, enabling keeps the global transform as the new local one; disabling with a
 * parent Node3D re-expresses the global transform under the parent.
 *
 * @godot Node3D.set_as_top_level
 * @source scene/3d/node_3d.cpp:1051
 */
export function set_as_top_level(self: Object3D, p_enabled: boolean): void {
  const state = stateOf(self);
  if (state.topLevel === p_enabled) return;
  const parent = parentNode3D(self);
  if (p_enabled) {
    setLocal(self, globalOf(self));
  } else if (parent !== null) {
    setLocal(self, mulTransform(affineInverse(globalOf(parent)), globalOf(self)));
  }
  state.topLevel = p_enabled;
  writeLocal(self, state, readLocal(self));
}

/**
 * @godot Node3D.is_set_as_top_level
 * @source scene/3d/node_3d.cpp:1077
 */
export function is_set_as_top_level(self: Object3D): boolean {
  return stateOf(self).topLevel;
}

/**
 * Converts the stored Euler rotation to the new order in whichever form is current.
 *
 * @godot Node3D.set_rotation_order
 * @source scene/3d/node_3d.cpp:760
 */
export function set_rotation_order(self: Object3D, p_order: number): void {
  const state = stateOf(self);
  if (state.order === p_order) return;
  if (!Number.isInteger(p_order) || p_order < 0 || p_order >= 6) return;
  if ((state.dirty & DIRTY_EULER_ROTATION_AND_SCALE) !== 0) {
    rotationAndScaleOf(self, state);
  } else if ((state.dirty & DIRTY_LOCAL_TRANSFORM) !== 0) {
    state.euler = getEulerNormalized(fromEuler(state.euler, state.order), p_order);
  } else {
    state.dirty |= DIRTY_LOCAL_TRANSFORM;
  }
  state.order = p_order;
  if ((state.dirty & DIRTY_LOCAL_TRANSFORM) !== 0) {
    const origin = readLocal(self).origin;
    writeLocal(self, state, { basis: eulerScale(state.euler, state.scale, state.order), origin });
  }
}

/**
 * @godot Node3D.get_rotation_order
 * @source scene/3d/node_3d.cpp:791
 */
export function get_rotation_order(self: Object3D): number {
  return stateOf(self).order;
}

/** The viewport's `find_world_3d()`, which `world-3d.ts` hands over when a world is attached. */
let viewportWorld: (() => object) | undefined;

/**
 * Hands Node3D the viewport's World3D: `world-3d.ts` calls it as the composition site attaches
 * the world (Node3D cannot import World3D, which reaches the physics modules built on Node3D).
 *
 * @godot Node3D (protocol)
 * @source scene/main/viewport.cpp:4855
 */
export function godot_node_3d_world_source(world: () => object): void {
  viewportWorld = world;
}

/**
 * The viewport's World3D for a node inside the tree (inside the world), else null.
 *
 * @godot Node3D.get_world_3d
 * @source scene/3d/node_3d.cpp:1082
 */
export function get_world_3d(self: Object3D): object | null {
  if (!is_inside_tree(self) || viewportWorld === undefined) return null;
  return viewportWorld();
}
