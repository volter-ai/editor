/**
 * Godot's `Basis` (a 3x3 matrix) and the `Transform` members built on it —
 * `follow_camera.gd`, `enemy.gd` and `player.gd`'s whole steering surface.
 *
 * The 3D sibling of `variant-3d.ts` (which owns `Vector3` and `Transform`'s
 * `origin`), split out for the same reason `node-3d.ts` is: a Godot game is 2D
 * or 3D, and a port that deletes the half it does not use should be deleting
 * whole files. A `Basis` is a VALUE, frozen, exactly as a `Vector3` is — see
 * `variant-3d.ts`'s header for why an aliased `THREE.Vector3` is the bug class
 * the value semantics exist to prevent.
 *
 * ## The ONE convention that matters here: `basis[i]` is a COLUMN, measured
 *
 * This is the whole reason the file has a header, and it was settled by the
 * engine rather than by reading C++. Godot 3's `Basis` stores its 3x3 as three
 * ROW vectors internally, but GDScript's `basis[i]` and `basis.x/y/z` both
 * return the i-th **column** — the i-th axis, `M·eᵢ`, where the local +X/+Y/+Z
 * points in the parent frame. `test/ground-truth/godot36-transform.json`'s
 * `micro.basisFromColumns` proves it: `Basis(a, b, c)[i] == [a, b, c][i]`, and
 * its `micro.basisXform` proves `xform(v) == v.x·col0 + v.y·col1 + v.z·col2`.
 * So a `Basis` here is its three COLUMNS, `[col0, col1, col2]`, which is exactly
 * the shape `variant-3d.ts`'s `Transform.basis` already carries and the order
 * `THREE.Matrix4` stores — a translated `basis[2]` is a plain `basis[2]` and a
 * `Transform.basis[0]` (`follow_camera.gd:75`) needs no transpose.
 *
 * ## Every operation is measured against 3.6, not read
 *
 *   - {@link basisFromAxisAngle} `Basis(axis, angle)` — the rotation the
 *     autoturn rays are built from (`follow_camera.gd:50-62`). Right-handed
 *     about a UNIT axis, `micro.basisAxisAngle_*`.
 *   - {@link basisXform} `Basis.xform(v)` / `Basis * Vector3` — `M·v`
 *     (`follow_camera.gd:50`, `player.gd:49`).
 *   - {@link basisScaled} `Basis.scaled(s)` — the surprising one:
 *     `micro.basisScaled_nonuniform` shows it scales each ROW by `s[i]`
 *     (`diag(s)·M`), so in COLUMN terms every column is multiplied
 *     COMPONENTWISE by `s`, NOT column `j` uniformly by `s[j]`. The fixture's
 *     own call (`player.gd:80`) is a uniform `0.3`, where the two agree — this
 *     is written for the case that does not.
 *   - {@link basisMul} `Basis * Basis` — the matrix product
 *     (`follow_camera.gd:75`), `micro.basisMul_Ry90_Rx90`.
 *   - {@link transformLookingAt} `Transform.looking_at(target, up)` — orients
 *     -Z at the target FROM the transform's own origin (`enemy.gd:63`,
 *     `Transform().looking_at(-dir, up)`), the same `-Z` convention `spatial.ts`
 *     records for `look_at`. `micro.transformLookingAt{,_offset}`.
 *   - {@link transformOrthonormalized} `Transform.orthonormalized()` — Godot's
 *     own Gram-Schmidt over the columns in x, y, z order, origin untouched
 *     (`player.gd:119`), `micro.transformOrthonormalized`.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing. Two module-scoped scratch `Matrix4`s exist so a per-frame
 * `Basis(axis, angle)` or `looking_at` does not allocate; each is written and
 * read within one call and never escapes. **Shares:** nothing — inputs and
 * outputs are frozen value records. **Teardown:** none.
 */

import { Euler, Matrix4, Quaternion, Vector3 as ThreeVector3, type Vector3Like } from 'three';
import { aabb, aabbEndpoint, aabbExpand, type GodotAabb } from './aabb';
import type { Plane } from './plane';
import { planeFromNormalPoint } from './plane';
import { type GodotQuaternion, quaternion, quaternionSlerp, quaternionToEuler } from './quaternion';
import {
  add3,
  dot3,
  lerp3,
  mul3,
  neg3,
  sub3,
  type Transform,
  transform3,
  type Vector3,
  vec3,
  VECTOR3_UP,
  VECTOR3_ZERO,
} from './variant-3d';

/**
 * Godot's `Basis` — its three COLUMN vectors `[col0, col1, col2]`.
 *
 * The same shape as `Transform.basis`, and deliberately so: a `Transform`'s
 * basis IS a `Basis`, and the two must be one type or `t.basis` needs a
 * conversion the emitter would have to write at every site. See this module's
 * header for why columns, measured.
 */
export type Basis = readonly [Vector3, Vector3, Vector3];

function isVector3Value(value: unknown): value is Vector3 {
  if (typeof value !== 'object' || value === null) return false;
  const vector = value as Partial<Vector3>;
  return typeof vector.x === 'number' && Number.isFinite(vector.x) &&
    typeof vector.y === 'number' && Number.isFinite(vector.y) &&
    typeof vector.z === 'number' && Number.isFinite(vector.z);
}

function isBasisValue(value: unknown): value is Basis {
  return Array.isArray(value) && value.length === 3 && value.every(isVector3Value);
}

function isQuaternionValue(value: unknown): value is GodotQuaternion {
  if (typeof value !== 'object' || value === null) return false;
  const quaternion = value as Partial<GodotQuaternion>;
  return typeof quaternion.x === 'number' && Number.isFinite(quaternion.x) &&
    typeof quaternion.y === 'number' && Number.isFinite(quaternion.y) &&
    typeof quaternion.z === 'number' && Number.isFinite(quaternion.z) &&
    typeof quaternion.w === 'number' && Number.isFinite(quaternion.w);
}

// Scratch. Never escapes a call; see this module's header.
const _m = new Matrix4();
const _a = new ThreeVector3();
const _b = new ThreeVector3();
const _c = new ThreeVector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _sa = new ThreeVector3();
const _sb = new ThreeVector3();
const _loc = new ThreeVector3();

/** Read `matrix.elements` (three's COLUMN-major layout) as a `Basis`. */
function basisFromMatrix(m: Matrix4): Basis {
  const e = m.elements;
  return [
    vec3(e[0] as number, e[1] as number, e[2] as number),
    vec3(e[4] as number, e[5] as number, e[6] as number),
    vec3(e[8] as number, e[9] as number, e[10] as number),
  ];
}

/**
 * `Basis(x, y, z)` — the three-column constructor
 * (`player.gd:80`, `Basis(-facing, UP, -facing.cross(UP))`).
 *
 * The arguments ARE the columns, verbatim; `micro.basisFromColumns`.
 */
export function basisFromColumns(x: Vector3Like, y: Vector3Like, z: Vector3Like): Basis {
  return [vec3(x.x, x.y, x.z), vec3(y.x, y.y, y.z), vec3(z.x, z.y, z.z)];
}

/**
 * `Basis(axis, angle)` — an axis-angle rotation
 * (`follow_camera.gd:50`, `Basis(Vector3.UP, deg2rad(aperture))`).
 *
 * Right-handed about `axis`, which Godot asserts is a UNIT vector; a scaled
 * axis silently changes the angle as well as the plane, so this rejects it the
 * way `variant-3d.ts`'s `rotated3` does rather than building a skewed basis
 * that reads as a physics bug three transforms away.
 *
 * @throws if `axis` is not unit-length.
 */
export function basisFromAxisAngle(axis: Vector3Like, angle: number): Basis {
  const len = Math.hypot(axis.x, axis.y, axis.z);
  if (Math.abs(len - 1) > 1e-6) {
    throw new Error(
      `godot-compat: Basis(axis, angle) needs a UNIT axis, got one of length ${len}. Godot ` +
        'asserts the same precondition; normalize the axis (Vector3.UP and friends are already ' +
        'unit) rather than letting its length scale the rotation.',
    );
  }
  _m.makeRotationAxis(_a.set(axis.x, axis.y, axis.z), angle);
  return basisFromMatrix(_m);
}

/** `Basis(quat)` — expand a Godot quaternion into the basis's three COLUMN vectors. */
export function basisFromQuaternion(quaternion: GodotQuaternion): Basis {
  const { x, y, z, w } = quaternion;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    vec3(1 - (yy + zz), xy + wz, xz - wy),
    vec3(xy - wz, 1 - (xx + zz), yz + wx),
    vec3(xz + wy, yz - wx, 1 - (xx + yy)),
  ];
}

/**
 * Godot 3's `Basis.get_orthogonal_index()`.
 *
 * Godot first snaps every matrix element to -1/0/1 at thresholds -0.5/+0.5, then compares the
 * result with its 24-entry `_ortho_bases` table. The order below is that exact table expressed as
 * columns, the representation this module uses. A non-orthogonal result returns 0, matching Godot.
 */
export function basisOrthogonalIndex(basis: Basis): number {
  const snapped = basis.map((column) =>
    vec3(snapOrthogonal(column.x), snapOrthogonal(column.y), snapOrthogonal(column.z)),
  ) as unknown as Basis;
  for (let index = 0; index < GODOT_ORTHO_BASES.length; index += 1) {
    const candidate = GODOT_ORTHO_BASES[index] as Basis;
    if (candidate.every((column, axis) => basisColumnEqual(column, snapped[axis] as Vector3))) {
      return index;
    }
  }
  return 0;
}

/** Godot 3's `Basis.set_orthogonal_index(index)` lookup, as a frozen basis value. */
export function basisAtOrthogonalIndex(index: number): Basis {
  const basis = GODOT_ORTHO_BASES[index];
  if (basis === undefined) {
    throw new RangeError(`godot-compat: Basis orthogonal index ${index} is outside 0..23.`);
  }
  return basis;
}

function basisColumnEqual(a: Vector3, b: Vector3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function snapOrthogonal(value: number): number {
  if (value > 0.5) return 1;
  if (value < -0.5) return -1;
  return 0;
}

function orthogonalBasis(values: readonly number[]): Basis {
  return [
    vec3(values[0] as number, values[1] as number, values[2] as number),
    vec3(values[3] as number, values[4] as number, values[5] as number),
    vec3(values[6] as number, values[7] as number, values[8] as number),
  ];
}

/**
 * Godot's 24 orthogonal bases — the rotations that map a cube onto itself — as the images of the
 * unit axes, i.e. the three COLUMNS this module's `Basis` is. This is the ONE copy in the
 * capability: `Basis.get_orthogonal_index` ({@link basisOrthogonalIndex}),
 * `Basis.set_orthogonal_index` ({@link basisAtOrthogonalIndex}), `GridMap`'s runtime
 * `set_cell_item` orientation (`grid-map.ts`) and the authored-`data.cells` bake
 * (`grid-map-instances.ts`) all index THIS table, so the four cannot disagree about what
 * orientation 1 means. They did: `grid-map.ts` used to carry a private four-entry Y-turn table and
 * return 0..3 into it, while `grid-map-instances.ts` and the pooled `GridMap` path read the 24, so
 * `set_cell_item(cell, item, get_orthogonal_index_from_basis(b))` rotated an instanced tile about
 * Z where the game asked for a `rotate_y`.
 *
 * The numbers are `Basis::_ortho_bases` (`core/math/basis.cpp` @ 3.6-stable; Godot 4 keeps the
 * same table and the same index meaning, which is why an authored 4.x `GridMap`'s `rot` field
 * decodes through it). One SECOND copy exists and is deliberate:
 * `GODOT_ORTHOGONAL_BASES` in `packages/gd-analyze/src/read/grid-map.ts`, the COMPILER's own —
 * the translator must not import capability source, because a user's port owns and edits its copy.
 * Those two are byte-identical by construction and each cites the other; do not add a third.
 */
export const GODOT_ORTHO_BASES: readonly Basis[] = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [0, 1, 0, -1, 0, 0, 0, 0, 1],
  [-1, 0, 0, 0, -1, 0, 0, 0, 1],
  [0, -1, 0, 1, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 0, -1, 0],
  [0, 1, 0, 0, 0, 1, 1, 0, 0],
  [-1, 0, 0, 0, 0, 1, 0, 1, 0],
  [0, -1, 0, 0, 0, 1, -1, 0, 0],
  [1, 0, 0, 0, -1, 0, 0, 0, -1],
  [0, 1, 0, 1, 0, 0, 0, 0, -1],
  [-1, 0, 0, 0, 1, 0, 0, 0, -1],
  [0, -1, 0, -1, 0, 0, 0, 0, -1],
  [1, 0, 0, 0, 0, -1, 0, 1, 0],
  [0, 1, 0, 0, 0, -1, -1, 0, 0],
  [-1, 0, 0, 0, 0, -1, 0, -1, 0],
  [0, -1, 0, 0, 0, -1, 1, 0, 0],
  [0, 0, -1, 0, 1, 0, 1, 0, 0],
  [0, 0, -1, -1, 0, 0, 0, 1, 0],
  [0, 0, -1, 0, -1, 0, -1, 0, 0],
  [0, 0, -1, 1, 0, 0, 0, -1, 0],
  [0, 0, 1, 0, -1, 0, 1, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 1, 0],
  [0, 0, 1, 0, 1, 0, -1, 0, 0],
  [0, 0, 1, -1, 0, 0, 0, -1, 0],
].map(orthogonalBasis);

/**
 * `basis.xform(v)` and `basis * v` — the matrix-vector product `M·v`
 * (`follow_camera.gd:50`, `player.gd:49`).
 *
 * `M·v = v.x·col0 + v.y·col1 + v.z·col2`, measured in `micro.basisXform`.
 */
export function basisXform(basis: Basis, v: Vector3Like): Vector3 {
  const [c0, c1, c2] = basis;
  return vec3(
    c0.x * v.x + c1.x * v.y + c2.x * v.z,
    c0.y * v.x + c1.y * v.y + c2.y * v.z,
    c0.z * v.x + c1.z * v.y + c2.z * v.z,
  );
}

/**
 * `a * b` — the `Basis` product (`follow_camera.gd:75`,
 * `Basis(t.basis[0], angle) * t.basis`).
 *
 * `(A·B)`'s column j is `A·(B's column j)`, so this is `basisXform(a, ·)` over
 * b's columns — measured in `micro.basisMul_Ry90_Rx90`.
 */
export function basisMul(a: Basis, b: Basis): Basis {
  return [basisXform(a, b[0]), basisXform(a, b[1]), basisXform(a, b[2])];
}

/**
 * `basis.scaled(s)` — `player.gd:80`, `Basis(...).scaled(CHAR_SCALE)`.
 *
 * Godot scales each ROW `i` by `s[i]` (`diag(s)·M`), which in the column layout
 * here is every column multiplied COMPONENTWISE by `s`. The fixture's own scale
 * is a uniform `0.3` where row- and column-scaling agree; the NON-uniform
 * `micro.basisScaled_nonuniform` is what pins the direction.
 */
/**
 * `basis.inverse()` — `starter-kit-fps` `player.gd:72`,
 * `basis.inverse() * applied_velocity`.
 *
 * The inverse of the 3x3 whose columns ARE this Basis, over three's own
 * `Matrix4.invert`. A CharacterBody3D's local basis is an orthonormal rotation
 * (the fixture's only caller), so the inverse is the transpose; the general
 * inverse is what the dump declares (`Basis.inverse() -> Basis`) and what a
 * scaled basis would need.
 *
 * A singular basis is returned unchanged: Godot's checked `Basis::invert()`
 * reports the condition and exits before writing, which the exhaustive 4.7
 * native differential audits with an all-zero basis.
 */
export function basisInverse(basis: Basis): Basis {
  const [c0, c1, c2] = basis;
  _m.set(c0.x, c1.x, c2.x, 0, c0.y, c1.y, c2.y, 0, c0.z, c1.z, c2.z, 0, 0, 0, 0, 1);
  if (Math.abs(_m.determinant()) < 1e-12) {
    return basis;
  }
  _m.invert();
  return basisFromMatrix(_m);
}

export function basisScaled(basis: Basis, s: Vector3Like): Basis {
  const scale = (c: Vector3): Vector3 => vec3(c.x * s.x, c.y * s.y, c.z * s.z);
  return [scale(basis[0]), scale(basis[1]), scale(basis[2])];
}

/**
 * `t.basis = b` — a NEW `Transform` with `b` as its basis and `t`'s origin
 * (`follow_camera.gd:75-76`, which reassigns `t.basis` then `set_transform(t)`).
 *
 * A value, not a mutation: a `Transform` is frozen (`variant-3d.ts`), so the
 * emitter's `t.basis = …` becomes `t = withBasis(t, …)`.
 */
export function withBasis(t: Transform, basis: Basis): Transform {
  return transform3(basis, t.origin);
}

/** `t.origin = v` — rebuild the Transform value with its basis preserved. */
export function withOrigin(t: Transform, origin: Vector3Like): Transform {
  return transform3(t.basis, origin);
}

/**
 * `transform.looking_at(target, up)` — `enemy.gd:63`,
 * `Transform().looking_at(-dir, up)`.
 *
 * Orients so the transform's **-Z** points at the world-space `target`, from
 * its OWN origin as the eye (`micro.transformLookingAt_offset` proves the eye is
 * the origin, not the world zero), and leaves the origin unchanged. Same -Z
 * convention, and the same `Matrix4.lookAt`, that `spatial.ts`'s `lookAt`
 * records — NOT `THREE.Object3D.lookAt`, which aims +Z for a non-camera.
 *
 * @throws if `target` is the origin, or `up` is parallel to the line of sight —
 * Godot reports the error and leaves the basis alone; the degenerate basis this
 * would otherwise build propagates `NaN` into every child transform.
 */
export function transformLookingAt(t: Transform, target: Vector3Like, up: Vector3Like): Transform {
  const dx = target.x - t.origin.x;
  const dy = target.y - t.origin.y;
  const dz = target.z - t.origin.z;
  if (dx * dx + dy * dy + dz * dz === 0) {
    throw new Error(
      "godot-compat: Transform.looking_at() was given the transform's own origin as the target, " +
        'so there is no direction to face. Godot reports the same error and leaves the basis alone.',
    );
  }
  // cross(dir, up) == 0  <=>  up parallel to the line of sight.
  const cx = dy * up.z - dz * up.y;
  const cy = dz * up.x - dx * up.z;
  const cz = dx * up.y - dy * up.x;
  if (cx * cx + cy * cy + cz * cz === 0) {
    throw new Error(
      "godot-compat: Transform.looking_at()'s up vector is parallel to the direction to the " +
        'target, so the resulting basis is degenerate. Godot reports the same error; pass an up ' +
        'vector that is not along the line of sight.',
    );
  }
  _m.lookAt(
    _a.set(t.origin.x, t.origin.y, t.origin.z),
    _b.set(target.x, target.y, target.z),
    _c.set(up.x, up.y, up.z),
  );
  return transform3(basisFromMatrix(_m), t.origin);
}

/**
 * `transform.orthonormalized()` — `player.gd:119`,
 * `get_global_transform().orthonormalized()`.
 *
 * Godot's own Gram-Schmidt over the COLUMNS in x, y, z order (`Basis::
 * orthonormalize`), origin untouched — `micro.transformOrthonormalized` drops a
 * scaled, sheared basis back to a pure rotation with its origin intact.
 */
export function transformOrthonormalized(t: Transform): Transform {
  return transform3(basisOrthonormalized(t.basis), t.origin);
}

/** `Basis.orthonormalized()` — Godot's column-order Gram-Schmidt, as a new value. */
export function basisOrthonormalized(basis: Basis): Basis {
  const [x0, y0, z0] = basis;
  const x = norm(x0);
  const y = norm(sub(y0, mul(x, dot(x, y0))));
  const z = norm(sub(sub(z0, mul(x, dot(x, z0))), mul(y, dot(y, z0))));
  return [x, y, z];
}

/** Godot 3 `Basis.normalized()`: normalize each column without removing shear. */
export function basisNormalized(basis: Basis): Basis {
  return [norm(basis[0]), norm(basis[1]), norm(basis[2])];
}

/** Godot 4 `Transform3D.interpolate_with`: lerp origin and scale independently, slerp the
 * rotation quaternion, then rebuild the basis from that quaternion and interpolated scale. */
export function transformInterpolateWith(
  from: Transform,
  to: Transform,
  weight: number,
): Transform {
  const setMatrix = (value: Transform): void => {
    const [x, y, z] = value.basis;
    _m.set(
      x.x,
      y.x,
      z.x,
      value.origin.x,
      x.y,
      y.y,
      z.y,
      value.origin.y,
      x.z,
      y.z,
      z.z,
      value.origin.z,
      0,
      0,
      0,
      1,
    );
  };
  setMatrix(from);
  _m.decompose(_a, _qa, _sa);
  setMatrix(to);
  _m.decompose(_b, _qb, _sb);
  _loc.copy(_a).lerp(_b, weight);
  _qa.slerp(_qb, weight).normalize();
  _sa.lerp(_sb, weight);
  _m.compose(_loc, _qa, _sa);
  return transform3(basisFromMatrix(_m), vec3(_loc.x, _loc.y, _loc.z));
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function sub(a: Vector3, b: Vector3): Vector3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}
function mul(a: Vector3, s: number): Vector3 {
  return vec3(a.x * s, a.y * s, a.z * s);
}
function norm(a: Vector3): Vector3 {
  const len = Math.hypot(a.x, a.y, a.z);
  return len === 0 ? a : vec3(a.x / len, a.y / len, a.z / len);
}

export const BASIS_IDENTITY: Basis = basisFromColumns(vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1));
export const BASIS_FLIP_X: Basis = basisFromColumns(vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1));
export const BASIS_FLIP_Y: Basis = basisFromColumns(vec3(1, 0, 0), vec3(0, -1, 0), vec3(0, 0, 1));
export const BASIS_FLIP_Z: Basis = basisFromColumns(vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, -1));

const EULER_ORDERS = ['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'] as const;

export function basisFromEuler(euler: Vector3Like, order = 2): Basis {
  _qa.setFromEuler(new Euler(euler.x, euler.y, euler.z, EULER_ORDERS[order] ?? 'YXZ'));
  return basisFromQuaternion(quaternion(_qa.x, _qa.y, _qa.z, _qa.w));
}

export function basisDeterminant(value: Basis): number {
  const [x, y, z] = value;
  return (
    x.x * (y.y * z.z - z.y * y.z) - y.x * (x.y * z.z - z.y * x.z) + z.x * (x.y * y.z - y.y * x.z)
  );
}

export function basisTransposed(value: Basis): Basis {
  return basisFromColumns(
    vec3(value[0].x, value[1].x, value[2].x),
    vec3(value[0].y, value[1].y, value[2].y),
    vec3(value[0].z, value[1].z, value[2].z),
  );
}

export function basisScaledLocal(value: Basis, scale: Vector3Like): Basis {
  return basisFromColumns(
    mul3(value[0], scale.x),
    mul3(value[1], scale.y),
    mul3(value[2], scale.z),
  );
}

export function basisScale(value: Basis): Vector3 {
  const sign = Math.sign(basisDeterminant(value));
  return vec3(
    sign * Math.hypot(value[0].x, value[0].y, value[0].z),
    sign * Math.hypot(value[1].x, value[1].y, value[1].z),
    sign * Math.hypot(value[2].x, value[2].y, value[2].z),
  );
}

export function basisRotationQuaternion(value: Basis): GodotQuaternion {
  const orthonormal = basisOrthonormalized(value);
  const rotation = basisDeterminant(orthonormal) < 0
    ? basisScaled(orthonormal, vec3(-1, -1, -1))
    : orthonormal;
  const [x, y, z] = rotation;
  _m.set(x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1);
  _qa.setFromRotationMatrix(_m).normalize();
  return quaternion(_qa.x, _qa.y, _qa.z, _qa.w);
}

export function basisLookingAt(
  target: Vector3Like,
  up: Vector3Like = VECTOR3_UP,
  useModelFront = false,
): Basis {
  const length = Math.hypot(target.x, target.y, target.z);
  if (length < 0.00001 || Math.hypot(up.x, up.y, up.z) < 0.00001) return BASIS_IDENTITY;
  let z = vec3(target.x / length, target.y / length, target.z / length);
  if (!useModelFront) z = neg3(z);
  let x = vec3(up.y * z.z - up.z * z.y, up.z * z.x - up.x * z.z, up.x * z.y - up.y * z.x);
  let xLength = Math.hypot(x.x, x.y, x.z);
  if (xLength < 0.00001) {
    const perpendicular =
      Math.abs(up.x) <= Math.abs(up.y) && Math.abs(up.x) <= Math.abs(up.z)
        ? vec3(0, -up.z, up.y)
        : Math.abs(up.y) <= Math.abs(up.z)
          ? vec3(-up.z, 0, up.x)
          : vec3(-up.y, up.x, 0);
    x = perpendicular;
    xLength = Math.hypot(x.x, x.y, x.z);
  }
  x = mul3(x, 1 / xLength);
  const y = vec3(z.y * x.z - z.z * x.y, z.z * x.x - z.x * x.z, z.x * x.y - z.y * x.x);
  return basisFromColumns(x, y, z);
}

function approxNumber(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) < Math.max(0.00001 * Math.abs(a), 0.00001);
}

function basisEquals(a: Basis, b: unknown): boolean {
  if (!Array.isArray(b) || b.length !== 3) return false;
  return a.every((column, index) => {
    const other = b[index] as Partial<Vector3Like>;
    return column.x === other?.x && column.y === other?.y && column.z === other?.z;
  });
}

function basisApprox(a: Basis, b: Basis): boolean {
  return a.every((column, index) => {
    const other = b[index] as Vector3;
    return (
      approxNumber(column.x, other.x) &&
      approxNumber(column.y, other.y) &&
      approxNumber(column.z, other.z)
    );
  });
}

export function godotBasisNew(...args: unknown[]): Basis {
  if (args.length === 0) return BASIS_IDENTITY;
  if (args.length === 1) {
    const value = args[0];
    if (Array.isArray(value)) return basisFromColumns(value[0], value[1], value[2]);
    return basisFromQuaternion(value as GodotQuaternion);
  }
  if (args.length === 2) return basisFromAxisAngle(args[0] as Vector3Like, args[1] as number);
  if (args.length === 3)
    return basisFromColumns(args[0] as Vector3Like, args[1] as Vector3Like, args[2] as Vector3Like);
  throw new Error(`godot-compat: unsupported Basis constructor with ${args.length} arguments.`);
}

export function godotBasisStatic(name: string, args: readonly unknown[]): Basis {
  switch (name) {
    case 'from_euler':
      return basisFromEuler(args[0] as Vector3Like, (args[1] as number | undefined) ?? 2);
    case 'from_scale':
      return basisScaledLocal(BASIS_IDENTITY, args[0] as Vector3Like);
    case 'looking_at':
      return basisLookingAt(
        args[0] as Vector3Like,
        (args[1] as Vector3Like | undefined) ?? VECTOR3_UP,
        (args[2] as boolean | undefined) ?? false,
      );
    default:
      throw new Error(`godot-compat: unsupported Basis static ${name}.`);
  }
}

export function godotBasisCall(name: string, value: Basis, args: readonly unknown[]): unknown {
  switch (name) {
    case 'determinant':
      return basisDeterminant(value);
    case 'get_euler':
      return quaternionToEuler(
        basisRotationQuaternion(value),
        (args[0] as number | undefined) ?? 2,
      );
    case 'get_rotation_quat':
    case 'get_rotation_quaternion':
      return basisRotationQuaternion(value);
    case 'get_scale':
      return basisScale(value);
    case 'inverse':
      return basisInverse(value);
    case 'is_conformal': {
      const sx = Math.hypot(value[0].x, value[0].y, value[0].z);
      const sy = Math.hypot(value[1].x, value[1].y, value[1].z);
      const sz = Math.hypot(value[2].x, value[2].y, value[2].z);
      return (
        approxNumber(sx, sy) &&
        approxNumber(sy, sz) &&
        Math.abs(dot3(value[0], value[1])) < 0.00001 &&
        Math.abs(dot3(value[0], value[2])) < 0.00001 &&
        Math.abs(dot3(value[1], value[2])) < 0.00001
      );
    }
    case 'is_equal_approx':
      return basisApprox(value, args[0] as Basis);
    case 'is_finite':
      return value.every(
        (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
      );
    case 'is_orthonormal':
      return basisApprox(basisMul(basisTransposed(value), value), BASIS_IDENTITY);
    case 'orthonormalized':
      return basisOrthonormalized(value);
    case 'normalized':
      return basisNormalized(value);
    case 'rotated':
      return basisMul(basisFromAxisAngle(args[0] as Vector3Like, args[1] as number), value);
    case 'scaled':
      return basisScaled(value, args[0] as Vector3Like);
    case 'scaled_local':
      return basisScaledLocal(value, args[0] as Vector3Like);
    case 'slerp': {
      const target = args[0] as Basis;
      const weight = args[1] as number;
      return basisScaledLocal(
        basisFromQuaternion(
          quaternionSlerp(basisRotationQuaternion(value), basisRotationQuaternion(target), weight),
        ),
        lerp3(basisScale(value), basisScale(target), weight),
      );
    }
    case 'tdotx':
      return dot3(value[0], args[0] as Vector3Like);
    case 'tdoty':
      return dot3(value[1], args[0] as Vector3Like);
    case 'tdotz':
      return dot3(value[2], args[0] as Vector3Like);
    case 'transposed':
      return basisTransposed(value);
    default:
      throw new Error(`godot-compat: unsupported Basis method ${name}.`);
  }
}

export function godotBasisOperator(
  operator: '==' | '!=' | 'not' | 'in',
  left: Basis,
  right?: unknown,
): boolean;
export function godotBasisOperator(
  operator: '*',
  left: Basis,
  right: Vector3Like,
): Vector3;
export function godotBasisOperator(
  operator: '*',
  left: Basis,
  right: Basis | number,
): Basis;
export function godotBasisOperator(operator: '/', left: Basis, right: number): Basis;
export function godotBasisOperator(operator: string, left: unknown, right?: unknown): unknown;
export function godotBasisOperator(operator: string, left: unknown, right?: unknown): unknown {
  const value = left as Basis;
  switch (operator) {
    case '==':
      return basisEquals(value, right);
    case '!=':
      return !basisEquals(value, right);
    case 'not':
      return basisEquals(value, BASIS_IDENTITY);
    case '*':
      if (typeof right === 'number') return value.map((v) => mul3(v, right)) as unknown as Basis;
      return Array.isArray(right)
        ? basisMul(value, right as unknown as Basis)
        : basisXform(value, right as Vector3Like);
    case '/':
      return value.map((v) => mul3(v, 1 / (right as number))) as unknown as Basis;
    case 'in': {
      const container = right;
      if (Array.isArray(container))
        return container.some((candidate) => basisEquals(value, candidate));
      if (container instanceof Map)
        for (const candidate of container.keys()) if (basisEquals(value, candidate)) return true;
      return false;
    }
    default:
      throw new Error(`godot-compat: unsupported Basis operator ${operator}.`);
  }
}

export const TRANSFORM3D_IDENTITY = transform3(BASIS_IDENTITY, VECTOR3_ZERO);
export const TRANSFORM3D_FLIP_X = transform3(BASIS_FLIP_X, VECTOR3_ZERO);
export const TRANSFORM3D_FLIP_Y = transform3(BASIS_FLIP_Y, VECTOR3_ZERO);
export const TRANSFORM3D_FLIP_Z = transform3(BASIS_FLIP_Z, VECTOR3_ZERO);

export function transform3DMul(a: Transform, b: Transform): Transform {
  return transform3(basisMul(a.basis, b.basis), add3(basisXform(a.basis, b.origin), a.origin));
}

export function transformTranslated(value: Transform, offset: Vector3Like): Transform {
  return transform3(value.basis, add3(value.origin, basisXform(value.basis, offset)));
}

export function transformRotated(
  value: Transform,
  axis: Vector3Like,
  angle: number,
): Transform {
  const rotation = basisFromAxisAngle(axis, angle);
  return transform3(basisMul(rotation, value.basis), basisXform(rotation, value.origin));
}

export function transformScaled(value: Transform, scale: Vector3Like): Transform {
  return transform3(basisScaled(value.basis, scale), {
    x: value.origin.x * scale.x,
    y: value.origin.y * scale.y,
    z: value.origin.z * scale.z,
  });
}

function transform3DInverse(value: Transform, affine: boolean): Transform {
  if (affine && Math.abs(basisDeterminant(value.basis)) < 1e-12) {
    return transform3(value.basis, basisXform(value.basis, neg3(value.origin)));
  }
  const basis = affine ? basisInverse(value.basis) : basisTransposed(value.basis);
  return transform3(basis, basisXform(basis, neg3(value.origin)));
}

function transformAabb(value: Transform, box: GodotAabb): GodotAabb {
  let result = aabb(basisXform(value.basis, aabbEndpoint(box, 0)), VECTOR3_ZERO);
  result = aabb(add3(result.position, value.origin), result.size);
  for (let index = 1; index < 8; index += 1)
    result = aabbExpand(
      result,
      add3(basisXform(value.basis, aabbEndpoint(box, index)), value.origin),
    );
  return result;
}

function transformPlane(value: Transform, source: Plane): Plane {
  const point = mul3(source.normal, source.d);
  const transformedPoint = add3(basisXform(value.basis, point), value.origin);
  const normal = basisXform(basisTransposed(basisInverse(value.basis)), source.normal);
  const length = Math.hypot(normal.x, normal.y, normal.z);
  return planeFromNormalPoint(mul3(normal, 1 / length), transformedPoint);
}

function transformEquals(a: Transform, b: unknown): boolean {
  if (typeof b !== 'object' || b === null) return false;
  const other = b as Partial<Transform>;
  return (
    !!other.basis &&
    !!other.origin &&
    basisEquals(a.basis, other.basis) &&
    a.origin.x === other.origin.x &&
    a.origin.y === other.origin.y &&
    a.origin.z === other.origin.z
  );
}

export function godotTransform3DNew(...args: unknown[]): Transform {
  if (args.length === 0) return TRANSFORM3D_IDENTITY;
  if (args.length === 1) {
    const value = args[0];
    if (
      typeof value === 'object' && value !== null &&
      'basis' in value && 'origin' in value
    ) {
      const transform = value as Transform;
      if (!isBasisValue(transform.basis) || !isVector3Value(transform.origin)) {
        throw new TypeError('godot-compat: Transform3D copy constructor requires a Transform3D value.');
      }
      return transform3(transform.basis, transform.origin);
    }
    if (isQuaternionValue(value)) {
      return transform3(basisFromQuaternion(value), VECTOR3_ZERO);
    }
    throw new TypeError(
      'godot-compat: Transform3D one-argument constructor requires Transform3D or Quaternion.',
    );
  }
  if (args.length === 2) {
    if (!isBasisValue(args[0]) || !isVector3Value(args[1])) {
      throw new TypeError('godot-compat: Transform3D(Basis, Vector3) requires exact Basis and Vector3 values.');
    }
    return transform3(args[0], args[1]);
  }
  if (args.length === 4) {
    if (!args.every(isVector3Value)) {
      throw new TypeError(
        'godot-compat: Transform3D(x, y, z, origin) requires four exact Vector3 values.',
      );
    }
    return transform3(
      basisFromColumns(args[0] as Vector3Like, args[1] as Vector3Like, args[2] as Vector3Like),
      args[3] as Vector3Like,
    );
  }
  throw new Error(
    `godot-compat: unsupported Transform3D constructor with ${args.length} arguments.`,
  );
}

export function godotTransform3DCall(
  name:
    | 'affine_inverse'
    | 'inverse'
    | 'interpolate_with'
    | 'looking_at'
    | 'orthonormalized'
    | 'rotated'
    | 'rotated_local'
    | 'scaled'
    | 'scaled_local'
    | 'translated'
    | 'translated_local',
  value: Transform,
  args: readonly unknown[],
): Transform;
export function godotTransform3DCall(
  name: 'is_equal_approx' | 'is_finite',
  value: Transform,
  args: readonly unknown[],
): boolean;
export function godotTransform3DCall(
  name: string,
  value: Transform,
  args: readonly unknown[],
): unknown;
export function godotTransform3DCall(
  name: string,
  value: Transform,
  args: readonly unknown[],
): unknown {
  switch (name) {
    case 'affine_inverse':
      return transform3DInverse(value, true);
    case 'inverse':
      return transform3DInverse(value, false);
    case 'interpolate_with':
      return transformInterpolateWith(value, args[0] as Transform, args[1] as number);
    case 'is_equal_approx': {
      const other = args[0] as Transform;
      return (
        basisApprox(value.basis, other.basis) &&
        approxNumber(value.origin.x, other.origin.x) &&
        approxNumber(value.origin.y, other.origin.y) &&
        approxNumber(value.origin.z, other.origin.z)
      );
    }
    case 'is_finite':
      return (
        value.basis.every(
          (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
        ) &&
        Number.isFinite(value.origin.x) &&
        Number.isFinite(value.origin.y) &&
        Number.isFinite(value.origin.z)
      );
    case 'looking_at':
      if (
        Math.hypot(
          (args[0] as Vector3Like).x - value.origin.x,
          (args[0] as Vector3Like).y - value.origin.y,
          (args[0] as Vector3Like).z - value.origin.z,
        ) < 0.00001
      )
        return TRANSFORM3D_IDENTITY;
      return transform3(
        basisLookingAt(
          sub3(args[0] as Vector3Like, value.origin),
          (args[1] as Vector3Like | undefined) ?? VECTOR3_UP,
          (args[2] as boolean | undefined) ?? false,
        ),
        value.origin,
      );
    case 'orthonormalized':
      return transformOrthonormalized(value);
    case 'rotated': {
      return transformRotated(value, args[0] as Vector3Like, args[1] as number);
    }
    case 'rotated_local':
      return transform3(
        basisMul(value.basis, basisFromAxisAngle(args[0] as Vector3Like, args[1] as number)),
        value.origin,
      );
    case 'scaled':
      return transformScaled(value, args[0] as Vector3Like);
    case 'scaled_local':
      return transform3(basisScaledLocal(value.basis, args[0] as Vector3Like), value.origin);
    case 'translated':
      return transformTranslated(value, args[0] as Vector3Like);
    case 'translated_local':
      return transform3(
        value.basis,
        add3(value.origin, basisXform(value.basis, args[0] as Vector3Like)),
      );
    default:
      throw new Error(`godot-compat: unsupported Transform3D method ${name}.`);
  }
}

export function godotTransform3DOperator(
  operator: string,
  left: unknown,
  right?: unknown,
): unknown {
  const value = left as Transform;
  switch (operator) {
    case '==':
      return transformEquals(value, right);
    case '!=':
      return !transformEquals(value, right);
    case 'not':
      return transformEquals(value, TRANSFORM3D_IDENTITY);
    case '*':
      if (typeof right === 'number')
        return transform3(
          value.basis.map((v) => mul3(v, right)) as unknown as Basis,
          mul3(value.origin, right),
        );
      if (Array.isArray(right))
        return right.length === 3 && typeof right[0] === 'object' && 'x' in right[0]
          ? (right as Vector3Like[]).map((v) => add3(basisXform(value.basis, v), value.origin))
          : transform3DMul(value, right as unknown as Transform);
      if (typeof right === 'object' && right !== null && 'basis' in right)
        return transform3DMul(value, right as Transform);
      if (typeof right === 'object' && right !== null && 'normal' in right)
        return transformPlane(value, right as Plane);
      if (typeof right === 'object' && right !== null && 'position' in right && 'size' in right)
        return transformAabb(value, right as GodotAabb);
      return add3(basisXform(value.basis, right as Vector3Like), value.origin);
    case '/':
      return transform3(
        value.basis.map((v) => mul3(v, 1 / (right as number))) as unknown as Basis,
        mul3(value.origin, 1 / (right as number)),
      );
    case 'in': {
      const container = right;
      if (Array.isArray(container))
        return container.some((candidate) => transformEquals(value, candidate));
      if (container instanceof Map)
        for (const candidate of container.keys())
          if (transformEquals(value, candidate)) return true;
      return false;
    }
    default:
      throw new Error(`godot-compat: unsupported Transform3D operator ${operator}.`);
  }
}
