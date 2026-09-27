/**
 * @godot-class AABB
 * @role PROTOCOL
 *
 * Godot 4.7's `AABB` built-in value, transcribed from `core/math/aabb.{h,cpp}` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: a `Vector3 position` and a `Vector3 size`. `real_t`
 * is 32-bit in the pinned build, so every component and every `real_t` intermediate is rounded with
 * `Math.fround` where the C++ rounds it (`-ffp-contract=off`: no fused multiply-add). It is an
 * editor build, so `MATH_CHECKS` is defined: a negative size makes `intersects`, `encloses`,
 * `has_point`, `merge` and `expand` print "AABB size is negative" and then compute as usual, so the
 * results here are the same.
 *
 * `end` is not stored: Godot reads it through `get_end()` (`core/variant/variant_setget.h:313`), so
 * the record carries it as a non-enumerable getter, and a read of `aabb.end` is `position + size`.
 */

import { construct as vector3, is_equal_approx as vector3IsEqualApprox, type Vector3 } from './vector3';

const f32 = Math.fround;

export interface AABB {
  readonly position: Vector3;
  readonly size: Vector3;
  /** `get_end()`: `position + size` (`core/math/aabb.h:127`), computed on each read. */
  readonly end: Vector3;
}

/** `Vector3 + Vector3`, one `real_t` sum per component. */
function add(a: Vector3, b: Vector3): Vector3 {
  return vector3(f32(a.x + b.x), f32(a.y + b.y), f32(a.z + b.z));
}

/** `Vector3 - Vector3`, one `real_t` difference per component. */
function subtract(a: Vector3, b: Vector3): Vector3 {
  return vector3(f32(a.x - b.x), f32(a.y - b.y), f32(a.z - b.z));
}

function make(position: Vector3, size: Vector3): AABB {
  const record = { position: vector3(position), size: vector3(size) };
  Object.defineProperty(record, 'end', {
    get: (): Vector3 => add(record.position, record.size),
    enumerable: false,
  });
  return Object.freeze(record) as AABB;
}

/**
 * The Variant constructors (`core/variant/variant_construct.cpp:147-149`): no arguments (zero
 * position and size), `from: AABB`, and `position, size` (`core/math/aabb.h:148`).
 *
 * @godot AABB.AABB
 * @source core/math/aabb.h:148
 */
export function construct(...args: readonly [] | readonly [AABB] | readonly [Vector3, Vector3]): AABB {
  if (args.length === 0) return make(vector3(), vector3());
  if (args.length === 1) return make(args[0].position, args[0].size);
  return make(args[0], args[1]);
}

/**
 * `a.position = value` writes `Vector3 position` (`core/math/aabb.h:45`); a new record assigned back.
 *
 * @godot AABB.position
 * @source core/math/aabb.h:45
 */
export function with_position(self: AABB, value: Vector3): AABB {
  return make(value, self.size);
}

/**
 * @godot AABB.size
 * @source core/math/aabb.h:46
 */
export function with_size(self: AABB, value: Vector3): AABB {
  return make(self.position, value);
}

/**
 * `a.end = value` is `set_end` (`core/variant/variant_setget.h:313`): the position stays and
 * `size = p_end - position`.
 *
 * @godot AABB.end
 * @source core/math/aabb.h:123
 */
export function with_end(self: AABB, value: Vector3): AABB {
  return make(self.position, subtract(vector3(value), self.position));
}

/**
 * The largest of `size.x`, `size.y`, `size.z`, by strict `>` from `size.x` (a NaN never wins).
 *
 * @godot AABB.get_longest_axis_size
 * @source core/math/aabb.h:399
 */
export function get_longest_axis_size(self: AABB): number {
  let max_size = self.size.x;
  if (self.size.y > max_size) max_size = self.size.y;
  if (self.size.z > max_size) max_size = self.size.z;
  return max_size;
}

/**
 * `AABB::grow_by` (mutating, not bound in ClassDB) on a copy: each position component less
 * `p_amount`, each size component plus `2.0f * p_amount`.
 *
 * @godot AABB (protocol)
 * @source core/math/aabb.h:481
 */
export function godot_aabb_grow_by(self: AABB, p_amount: number): AABB {
  const amount = f32(p_amount);
  const twice = f32(2 * amount);
  const { position, size } = self;
  return make(
    vector3(f32(position.x - amount), f32(position.y - amount), f32(position.z - amount)),
    vector3(f32(size.x + twice), f32(size.y + twice), f32(size.z + twice)),
  );
}

/**
 * `AABB aabb = *this; aabb.grow_by(p_by);`.
 *
 * @godot AABB.grow
 * @source core/math/aabb.cpp:351
 */
export function grow(self: AABB, p_by: number): AABB {
  return godot_aabb_grow_by(self, p_by);
}

/**
 * `AABB::expand_to` (mutating, not bound in ClassDB) on a copy: `begin = position` and
 * `end = position + size` each widened to the point per component by strict `<` / `>`, then
 * `position = begin`, `size = end - begin`.
 *
 * @godot AABB (protocol)
 * @source core/math/aabb.h:356
 */
export function godot_aabb_expand_to(self: AABB, p_vector: Vector3): AABB {
  const begin = { x: self.position.x, y: self.position.y, z: self.position.z };
  const end = { ...add(self.position, self.size) };
  if (p_vector.x < begin.x) begin.x = p_vector.x;
  if (p_vector.y < begin.y) begin.y = p_vector.y;
  if (p_vector.z < begin.z) begin.z = p_vector.z;
  if (p_vector.x > end.x) end.x = p_vector.x;
  if (p_vector.y > end.y) end.y = p_vector.y;
  if (p_vector.z > end.z) end.z = p_vector.z;
  const b = vector3(begin.x, begin.y, begin.z);
  return make(b, subtract(vector3(end.x, end.y, end.z), b));
}

/**
 * `AABB aabb = *this; aabb.expand_to(p_vector);`.
 *
 * @godot AABB.expand
 * @source core/math/aabb.cpp:345
 */
export function expand(self: AABB, p_vector: Vector3): AABB {
  return godot_aabb_expand_to(self, p_vector);
}

/**
 * `merge_with` on a copy (`core/math/aabb.cpp:40`): the per-component min of the two beginnings
 * and max of the two ends by strict `<` / `>` (the second box's value on a tie or a NaN), then
 * `size = max - min`. An empty box is not skipped: its position still bounds the result.
 *
 * @godot AABB.merge
 * @source core/math/aabb.cpp:339
 */
export function merge(self: AABB, p_with: AABB): AABB {
  const beg_1 = self.position;
  const beg_2 = p_with.position;
  const end_1 = add(self.size, beg_1);
  const end_2 = add(p_with.size, beg_2);
  const min = vector3(
    beg_1.x < beg_2.x ? beg_1.x : beg_2.x,
    beg_1.y < beg_2.y ? beg_1.y : beg_2.y,
    beg_1.z < beg_2.z ? beg_1.z : beg_2.z,
  );
  const max = vector3(
    end_1.x > end_2.x ? end_1.x : end_2.x,
    end_1.y > end_2.y ? end_1.y : end_2.y,
    end_1.z > end_2.z ? end_1.z : end_2.z,
  );
  return make(min, subtract(max, min));
}

/**
 * Inclusive on every face: false only when a component is strictly below `position` or strictly
 * above `position + size` (a NaN component is never outside).
 *
 * @godot AABB.has_point
 * @source core/math/aabb.h:328
 */
export function has_point(self: AABB, p_point: Vector3): boolean {
  const { position, size } = self;
  if (p_point.x < position.x) return false;
  if (p_point.y < position.y) return false;
  if (p_point.z < position.z) return false;
  if (p_point.x > f32(position.x + size.x)) return false;
  if (p_point.y > f32(position.y + size.y)) return false;
  if (p_point.z > f32(position.z + size.z)) return false;
  return true;
}

/**
 * `position + (size * 0.5f)`.
 *
 * @godot AABB.get_center
 * @source core/math/aabb.h:131
 */
export function get_center(self: AABB): Vector3 {
  const { position, size } = self;
  return add(position, vector3(f32(size.x * 0.5), f32(size.y * 0.5), f32(size.z * 0.5)));
}

/**
 * `size.x * size.y * size.z`, left to right in `real_t` (negative for an odd count of negative sizes).
 *
 * @godot AABB.get_volume
 * @source core/math/aabb.cpp:36
 */
export function get_volume(self: AABB): number {
  return f32(f32(self.size.x * self.size.y) * self.size.z);
}

/**
 * `AABB(position + size.minf(0), size.abs())`. `MIN(x, 0)` is `x < 0 ? x : 0`
 * (`core/typedefs.h:142`), so a NaN size adds `+0`. For a `-0` size the official arm64 binary
 * differs from that source reading: inlined against the constant, the compare-select compiles to
 * `fminnm`, which orders `-0` below `+0`, so `-0` is kept and `-0 + -0` stays `-0` (measured:
 * `AABB(Vector3(-0.0, ...), Vector3(-0.0, ...)).abs().position.x` is `-0.0`, while the bound
 * `Vector3(-0.0, ...).minf(0.0)` is `+0.0`). This follows the binary.
 *
 * @godot AABB.abs
 * @source core/math/aabb.h:113
 */
export function abs(self: AABB): AABB {
  const { position, size } = self;
  const min0 = (x: number): number => (x < 0 || Object.is(x, -0) ? x : 0);
  const minf = vector3(min0(size.x), min0(size.y), min0(size.z));
  return make(add(position, minf), vector3(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)));
}

/**
 * Exclusive: touching faces do not overlap (`>=` / `<=` reject), so a zero-size box intersects
 * nothing it only touches.
 *
 * @godot AABB.intersects
 * @source core/math/aabb.h:154
 */
export function intersects(self: AABB, p_aabb: AABB): boolean {
  const a = self.position;
  const s = self.size;
  const b = p_aabb.position;
  const t = p_aabb.size;
  if (a.x >= f32(b.x + t.x)) return false;
  if (f32(a.x + s.x) <= b.x) return false;
  if (a.y >= f32(b.y + t.y)) return false;
  if (f32(a.y + s.y) <= b.y) return false;
  if (a.z >= f32(b.z + t.z)) return false;
  if (f32(a.z + s.z) <= b.z) return false;
  return true;
}

/**
 * Inclusive: `src_min <= dst_min` and `src_max >= dst_max` on every axis.
 *
 * @godot AABB.encloses
 * @source core/math/aabb.h:210
 */
export function encloses(self: AABB, p_aabb: AABB): boolean {
  const src_min = self.position;
  const src_max = add(self.position, self.size);
  const dst_min = p_aabb.position;
  const dst_max = add(p_aabb.position, p_aabb.size);
  return (
    src_min.x <= dst_min.x &&
    src_max.x >= dst_max.x &&
    src_min.y <= dst_min.y &&
    src_max.y >= dst_max.y &&
    src_min.z <= dst_min.z &&
    src_max.z >= dst_max.z
  );
}

/**
 * `position.is_equal_approx(p_aabb.position) && size.is_equal_approx(p_aabb.size)`.
 *
 * @godot AABB.is_equal_approx
 * @source core/math/aabb.cpp:67
 */
export function is_equal_approx(self: AABB, p_aabb: AABB): boolean {
  return vector3IsEqualApprox(self.position, p_aabb.position) && vector3IsEqualApprox(self.size, p_aabb.size);
}

/**
 * `position == p_rval.position && size == p_rval.size`, component by component (`NaN != NaN`).
 *
 * @godot AABB.OP_EQUAL
 * @source core/math/aabb.h:62
 */
export function op_equal(left: AABB, right: AABB): boolean {
  const p = left.position;
  const q = right.position;
  const s = left.size;
  const t = right.size;
  return p.x === q.x && p.y === q.y && p.z === q.z && s.x === t.x && s.y === t.y && s.z === t.z;
}

/**
 * `position != p_rval.position || size != p_rval.size`, component by component.
 *
 * @godot AABB.OP_NOT_EQUAL
 * @source core/math/aabb.h:65
 */
export function op_not_equal(left: AABB, right: AABB): boolean {
  const p = left.position;
  const q = right.position;
  const s = left.size;
  const t = right.size;
  return p.x !== q.x || p.y !== q.y || p.z !== q.z || s.x !== t.x || s.y !== t.y || s.z !== t.z;
}
