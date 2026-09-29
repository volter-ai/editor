/**
 * @godot-class Rect2
 * @role PROTOCOL
 *
 * Godot 4.7's `Rect2` built-in value, transcribed from `core/math/rect2.h` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: a `Point2 position` and a `Size2 size`, both `Vector2`.
 */

import type { Transform2D } from './transform-2d';
import {
  abs as vector2Abs,
  is_equal_approx as vector2IsEqualApprox,
  is_finite as vector2IsFinite,
  max as vector2Max,
  min as vector2Min,
  minf as vector2Minf,
  op_add as vector2Add,
  op_multiply as vector2Multiply,
  op_subtract as vector2Subtract,
  construct as vector2,
  type Vector2,
} from './vector2';

const f32 = Math.fround;

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

/**
 * `position + size * 0.5`.
 *
 * @godot Rect2.get_center
 * @source core/math/rect2.h:52
 */
export function get_center(self: Rect2): Vector2 {
  return vector2Add(self.position, vector2Multiply(self.size, 0.5));
}

/**
 * `width * height`.
 *
 * @godot Rect2.get_area
 * @source core/math/rect2.h:50
 */
export function get_area(self: Rect2): number {
  return f32(self.size.x * self.size.y);
}

/**
 * @godot Rect2.has_area
 * @source core/math/rect2.h:143
 */
export function has_area(self: Rect2): boolean {
  return self.size.x > 0 && self.size.y > 0;
}

/**
 * Inside the begin edges, outside the end edges.
 *
 * @godot Rect2.has_point
 * @source core/math/rect2.h:182
 */
export function has_point(self: Rect2, p_point: Vector2): boolean {
  if (p_point.x < self.position.x || p_point.y < self.position.y) return false;
  if (p_point.x >= f32(self.position.x + self.size.x)) return false;
  if (p_point.y >= f32(self.position.y + self.size.y)) return false;
  return true;
}

/**
 * @godot Rect2.is_equal_approx
 * @source core/math/rect2.cpp:37
 */
export function is_equal_approx(self: Rect2, p_rect: Rect2): boolean {
  return vector2IsEqualApprox(self.position, p_rect.position) && vector2IsEqualApprox(self.size, p_rect.size);
}

/**
 * @godot Rect2.is_finite
 * @source core/math/rect2.cpp:45
 */
export function is_finite(self: Rect2): boolean {
  return vector2IsFinite(self.position) && vector2IsFinite(self.size);
}

/**
 * Overlap with a positive area, or touching too when `include_borders` (the Variant default is
 * false).
 *
 * @godot Rect2.intersects
 * @source core/math/rect2.h:54
 */
export function intersects(self: Rect2, p_rect: Rect2, p_include_borders = false): boolean {
  const selfEndX = f32(self.position.x + self.size.x);
  const selfEndY = f32(self.position.y + self.size.y);
  const otherEndX = f32(p_rect.position.x + p_rect.size.x);
  const otherEndY = f32(p_rect.position.y + p_rect.size.y);
  if (p_include_borders) {
    return !(self.position.x > otherEndX || selfEndX < p_rect.position.x || self.position.y > otherEndY || selfEndY < p_rect.position.y);
  }
  return !(self.position.x >= otherEndX || selfEndX <= p_rect.position.x || self.position.y >= otherEndY || selfEndY <= p_rect.position.y);
}

/**
 * @godot Rect2.encloses
 * @source core/math/rect2.h:132
 */
export function encloses(self: Rect2, p_rect: Rect2): boolean {
  return (
    p_rect.position.x >= self.position.x &&
    p_rect.position.y >= self.position.y &&
    f32(p_rect.position.x + p_rect.size.x) <= f32(self.position.x + self.size.x) &&
    f32(p_rect.position.y + p_rect.size.y) <= f32(self.position.y + self.size.y)
  );
}

/**
 * The overlap, or `Rect2()` when the two do not intersect.
 *
 * @godot Rect2.intersection
 * @source core/math/rect2.h:148
 */
export function intersection(self: Rect2, p_rect: Rect2): Rect2 {
  if (!intersects(self, p_rect)) return construct();
  const position = vector2Max(p_rect.position, self.position);
  const end = vector2Min(vector2Add(p_rect.position, p_rect.size), vector2Add(self.position, self.size));
  return construct(position, vector2Subtract(end, position));
}

/**
 * The smallest rect enclosing both.
 *
 * @godot Rect2.merge
 * @source core/math/rect2.h:165
 */
export function merge(self: Rect2, p_rect: Rect2): Rect2 {
  const position = vector2Min(p_rect.position, self.position);
  const end = vector2Max(vector2Add(p_rect.position, p_rect.size), vector2Add(self.position, self.size));
  return construct(position, vector2Subtract(end, position));
}

/**
 * The rect grown to include the point (`expand_to`, `core/math/rect2.h:254`).
 *
 * @godot Rect2.expand
 * @source core/math/rect2.h:248
 */
export function expand(self: Rect2, p_vector: Vector2): Rect2 {
  const end = vector2Add(self.position, self.size);
  const begin = vector2(
    p_vector.x < self.position.x ? p_vector.x : self.position.x,
    p_vector.y < self.position.y ? p_vector.y : self.position.y,
  );
  const grown = vector2(p_vector.x > end.x ? p_vector.x : end.x, p_vector.y > end.y ? p_vector.y : end.y);
  return construct(begin, vector2Subtract(grown, begin));
}

/**
 * Every side moved out by `amount` (`grow_by`, `core/math/rect2.h:218`).
 *
 * @godot Rect2.grow
 * @source core/math/rect2.h:212
 */
export function grow(self: Rect2, p_amount: number): Rect2 {
  return grow_individual(self, p_amount, p_amount, p_amount, p_amount);
}

/**
 * One side moved out: `side` is `SIDE_LEFT` (0), `SIDE_TOP` (1), `SIDE_RIGHT` (2) or
 * `SIDE_BOTTOM` (3) (`grow_side_bind`, `core/math/rect2.h:234`).
 *
 * @godot Rect2.grow_side
 * @source core/math/rect2.h:225
 */
export function grow_side(self: Rect2, p_side: number, p_amount: number): Rect2 {
  return grow_individual(
    self,
    p_side === 0 ? p_amount : 0,
    p_side === 1 ? p_amount : 0,
    p_side === 2 ? p_amount : 0,
    p_side === 3 ? p_amount : 0,
  );
}

/**
 * @godot Rect2.grow_individual
 * @source core/math/rect2.h:238
 */
export function grow_individual(self: Rect2, p_left: number, p_top: number, p_right: number, p_bottom: number): Rect2 {
  const [left, top, right, bottom] = [f32(p_left), f32(p_top), f32(p_right), f32(p_bottom)];
  return construct(
    vector2(f32(self.position.x - left), f32(self.position.y - top)),
    vector2(f32(self.size.x + f32(left + right)), f32(self.size.y + f32(top + bottom))),
  );
}

/**
 * The same area with a non-negative size: `Rect2(position + size.minf(0), size.abs())`.
 *
 * @godot Rect2.abs
 * @source core/math/rect2.h:281
 */
export function abs(self: Rect2): Rect2 {
  return construct(vector2Add(self.position, vector2Minf(self.size, 0)), vector2Abs(self.size));
}

/**
 * Against null (the `Variant` right operand) it is false (`core/variant/variant_op.cpp:539`).
 *
 * @godot Rect2.OP_EQUAL
 * @source core/math/rect2.h:209
 */
export function op_equal(left: Rect2, right: Rect2 | null): boolean {
  return (
    right !== null &&
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.size.x === right.size.x &&
    left.size.y === right.size.y
  );
}

/**
 * @godot Rect2.OP_NOT_EQUAL
 * @source core/math/rect2.h:210
 */
export function op_not_equal(left: Rect2, right: Rect2 | null): boolean {
  return !op_equal(left, right);
}

/**
 * `r == Rect2()`.
 *
 * @godot Rect2.OP_NOT
 * @source core/variant/variant_op.cpp:890
 */
export function op_not(self: Rect2): boolean {
  return self.position.x === 0 && self.position.y === 0 && self.size.x === 0 && self.size.y === 0;
}

/**
 * `Rect2 * Transform2D` is the transform's `xform_inv`: the four corners through `xform_inv`
 * (`Vector2 * Transform2D`), then the rect enclosing them (`OperatorEvaluatorXFormInv`,
 * `core/variant/variant_op.cpp:312`).
 *
 * @godot Rect2.OP_MULTIPLY
 * @source core/math/transform_2d.h:256
 */
export function op_multiply(left: Rect2, right: Transform2D): Rect2 {
  const { position: p, size: s } = left;
  const ends = [
    vector2Multiply(p, right),
    vector2Multiply(vector2(p.x, f32(p.y + s.y)), right),
    vector2Multiply(vector2(f32(p.x + s.x), f32(p.y + s.y)), right),
    vector2Multiply(vector2(f32(p.x + s.x), p.y), right),
  ] as const;
  let rect = construct(ends[0], vector2());
  for (const end of ends.slice(1)) rect = expand(rect, end);
  return rect;
}

/** Whether an Array element or a Dictionary key is this Rect2. */
function isRect2Equal(value: unknown, r: Rect2): boolean {
  if (typeof value !== 'object' || value === null || !('position' in value) || !('size' in value)) return false;
  const other = value as Rect2;
  return op_equal(r, other);
}

/**
 * `r in array` is `array.find(r) != -1`; `r in dict` is `dict.has(r)`
 * (`core/variant/variant_op.h:1180`). A Rect2 key is matched by value.
 *
 * @godot Rect2.OP_IN
 * @source core/variant/variant_op.h:1142
 */
export function op_in(left: Rect2, right: readonly unknown[] | ReadonlyMap<unknown, unknown>): boolean {
  if (Array.isArray(right)) return right.some((element) => isRect2Equal(element, left));
  for (const key of (right as ReadonlyMap<unknown, unknown>).keys()) if (isRect2Equal(key, left)) return true;
  return false;
}
