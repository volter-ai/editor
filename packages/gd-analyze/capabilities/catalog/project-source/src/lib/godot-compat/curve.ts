/**
 * @godot-class Curve
 * @role PROTOCOL
 *
 * Godot 4.7's `Curve` resource (`scene/resources/curve.{h,cpp}`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): points of a position, two tangents and two tangent
 * modes, kept in offset order, sampled as a cubic Bézier between each pair, and a baked cache of
 * `bake_resolution` samples for `sample_baked`. Values are `real_t` (float), rounded with
 * `Math.fround`.
 */

import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;
/** `CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = 0.00001;
/** `MIN_Y_RANGE` (`curve.cpp:318`). */
const MIN_Y_RANGE = 0.01;
/** `Curve::TangentMode` (`curve.h:48`). */
const TANGENT_FREE = 0;
const TANGENT_LINEAR = 1;

interface Point {
  position: { x: number; y: number };
  left_tangent: number;
  right_tangent: number;
  left_mode: number;
  right_mode: number;
}

export interface Curve {
  points: Point[];
  bake_resolution: number;
  min_value: number;
  max_value: number;
  min_domain: number;
  max_domain: number;
  baked: number[];
  dirty: boolean;
}

/**
 * No points, value and domain 0 to 1, a bake resolution of 100 (`curve.h:171`).
 *
 * @godot Curve (protocol)
 * @source scene/resources/curve.cpp:41
 */
export function construct(): Curve {
  return { points: [], bake_resolution: 100, min_value: 0, max_value: 1, min_domain: 0, max_domain: 1, baked: [], dirty: true };
}

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);

/** `Curve::get_index` (`curve.cpp:129`): the lower-bound point of `offset`. */
function indexOf(self: Curve, offset: number): number {
  let imin = 0;
  let imax = self.points.length - 1;
  while (imax - imin > 1) {
    const m = Math.trunc((imin + imax) / 2);
    const a = (self.points[m] as Point).position.x;
    const b = (self.points[m + 1] as Point).position.x;
    if (a < offset && b < offset) imin = m;
    else if (a > offset) imax = m;
    else return m;
  }
  if (offset > (self.points[imax] as Point).position.x) return imax;
  return imin;
}

/** `(to - from).normalized()`'s slope `v.y / v.x` (`Vector2::normalize`, `vector2.cpp:52`). */
function slope(from: { x: number; y: number }, to: { x: number; y: number }): number {
  let x = f32(to.x - from.x);
  let y = f32(to.y - from.y);
  const l = f32(f32(x * x) + f32(y * y));
  if (l !== 0) {
    const s = f32(Math.sqrt(l));
    x = f32(x / s);
    y = f32(y / s);
  }
  return f32(y / x);
}

/** `Curve::update_auto_tangents` (`curve.cpp:291`): linear tangents follow their neighbours. */
function updateAutoTangents(self: Curve, index: number): void {
  const p = self.points[index] as Point;
  const before = self.points[index - 1];
  const after = self.points[index + 1];
  if (before !== undefined) {
    if (p.left_mode === TANGENT_LINEAR) p.left_tangent = slope(p.position, before.position);
    if (before.right_mode === TANGENT_LINEAR) before.right_tangent = slope(p.position, before.position);
  }
  if (after !== undefined) {
    if (p.right_mode === TANGENT_LINEAR) p.right_tangent = slope(p.position, after.position);
    if (after.left_mode === TANGENT_LINEAR) after.left_tangent = slope(p.position, after.position);
  }
}

/** `Curve::_add_point` (`curve.cpp:65`): clamped to the ranges, inserted in offset order. */
function addPoint(self: Curve, x: number, y: number, left: number, right: number, leftMode: number, rightMode: number): number {
  const point: Point = {
    position: { x: f32(clamp(f32(x), self.min_domain, self.max_domain)), y: f32(clamp(f32(y), self.min_value, self.max_value)) },
    left_tangent: f32(left),
    right_tangent: f32(right),
    left_mode: leftMode,
    right_mode: rightMode,
  };
  let at: number;
  if (self.points.length === 0) {
    self.points.push(point);
    at = 0;
  } else if (self.points.length === 1) {
    at = f32(point.position.x - (self.points[0] as Point).position.x) > 0 ? 1 : 0;
    self.points.splice(at, 0, point);
  } else {
    let i = indexOf(self, point.position.x);
    if (i === 0 && point.position.x < (self.points[0] as Point).position.x) {
      at = 0;
    } else {
      i += 1;
      at = i;
    }
    self.points.splice(at, 0, point);
  }
  updateAutoTangents(self, at);
  self.dirty = true;
  return at;
}

/**
 * @godot Curve.add_point
 * @source scene/resources/curve.cpp:115
 */
export function add_point(self: Curve, position: Vector2, left_tangent = 0, right_tangent = 0, left_mode = TANGENT_FREE, right_mode = TANGENT_FREE): number {
  return addPoint(self, position.x, position.y, left_tangent, right_tangent, left_mode, right_mode);
}

/**
 * The points as the scene stores them (`_data`): each a position, two tangents and two modes.
 *
 * @godot Curve._set_data
 * @source scene/resources/curve.cpp:481
 */
export function _set_data(self: Curve, data: readonly unknown[]): void {
  if (data.length % 5 !== 0) return;
  self.points = [];
  for (let i = 0; i < data.length; i += 5) {
    const position = data[i] as Vector2;
    self.points.push({
      position: { x: f32(position.x), y: f32(position.y) },
      left_tangent: f32(Number(data[i + 1])),
      right_tangent: f32(Number(data[i + 2])),
      left_mode: Number(data[i + 3]),
      right_mode: Number(data[i + 4]),
    });
  }
  self.dirty = true;
}

/**
 * The value and domain ranges as the scene stores them (`_limits`: minimum and maximum value, then
 * domain), without the setters' constraints; any other length resets them to 0 to 1.
 *
 * @godot Curve._set_limits
 * @source scene/resources/curve.cpp:332
 */
export function _set_limits(self: Curve, limits: readonly number[]): void {
  const [minValue, maxValue, minDomain, maxDomain] = limits.length === 4 ? limits.map(f32) : [0, 1, 0, 1];
  self.min_value = minValue as number;
  self.max_value = maxValue as number;
  self.min_domain = minDomain as number;
  self.max_domain = maxDomain as number;
  self.dirty = true;
}

/**
 * Fewer points drop the last ones; more add points at the end of the domain (the first at its
 * start), each at value 0 clamped to the range.
 *
 * @godot Curve.set_point_count
 * @source scene/resources/curve.cpp:45
 */
export function set_point_count(self: Curve, count: number): void {
  if (count < 0 || count === self.points.length) return;
  if (count < self.points.length) {
    self.points.length = count;
    self.dirty = true;
    return;
  }
  const offset = self.points.length === 0 ? clamp(0, self.min_domain, self.max_domain) : self.max_domain;
  const value = clamp(0, self.min_value, self.max_value);
  for (let i = count - self.points.length; i > 0; i -= 1) addPoint(self, offset, value, 0, 0, TANGENT_FREE, TANGENT_FREE);
}

/**
 * @godot Curve.get_point_count
 * @source scene/resources/curve.h:78
 */
export function get_point_count(self: Curve): number {
  return self.points.length;
}

/**
 * @godot Curve.get_point_position
 * @source scene/resources/curve.cpp:281
 */
export function get_point_position(self: Curve, index: number): Vector2 {
  const point = self.points[index];
  return point === undefined ? vector2(0, 0) : vector2(point.position.x, point.position.y);
}

/** `Curve::sample_local_nocheck` (`curve.cpp:414`): the cubic Bézier between a point and the next. */
function sampleLocal(self: Curve, index: number, local: number): number {
  const a = self.points[index] as Point;
  const b = self.points[index + 1] as Point;
  let d = f32(b.position.x - a.position.x);
  if (Math.abs(d) < CMP_EPSILON) return b.position.y;
  const t = f32(local / d);
  d = f32(d / 3);
  const yac = f32(a.position.y + f32(d * a.right_tangent));
  const ybc = f32(b.position.y - f32(d * b.left_tangent));
  // `Math::bezier_interpolate` in float (`core/math/math_funcs.h:451`).
  const omt = f32(1 - t);
  const omt2 = f32(omt * omt);
  const omt3 = f32(omt2 * omt);
  const t2 = f32(t * t);
  const t3 = f32(t2 * t);
  return f32(
    f32(f32(f32(a.position.y * omt3) + f32(f32(f32(yac * omt2) * t) * 3)) + f32(f32(f32(ybc * omt) * t2) * 3)) + f32(b.position.y * t3),
  );
}

/**
 * The curve's value at `offset`: the first point's value before it, the last's after it.
 *
 * @godot Curve.sample
 * @source scene/resources/curve.cpp:391
 */
export function sample(self: Curve, p_offset: number): number {
  const offset = f32(p_offset);
  if (self.points.length === 0) return 0;
  if (self.points.length === 1) return (self.points[0] as Point).position.y;
  const i = indexOf(self, offset);
  if (i === self.points.length - 1) return (self.points[i] as Point).position.y;
  const local = f32(offset - (self.points[i] as Point).position.x);
  if (i === 0 && local <= 0) return (self.points[0] as Point).position.y;
  return sampleLocal(self, i, local);
}

/** `Curve::_bake` (`curve.cpp:528`): `bake_resolution` samples across the domain. */
function bakeCache(self: Curve): void {
  const range = f32(self.max_domain - self.min_domain);
  self.baked = new Array<number>(self.bake_resolution).fill(0);
  for (let i = 1; i < self.bake_resolution - 1; i += 1) {
    const x = f32(f32(f32(range * i) / f32(self.bake_resolution - 1)) + self.min_domain);
    self.baked[i] = sample(self, x);
  }
  if (self.points.length !== 0) {
    self.baked[0] = (self.points[0] as Point).position.y;
    self.baked[self.baked.length - 1] = (self.points[self.points.length - 1] as Point).position.y;
  }
  self.dirty = false;
}

/**
 * @godot Curve.bake
 * @source scene/resources/curve.cpp:524
 */
export function bake(self: Curve): void {
  bakeCache(self);
}

/**
 * The baked cache interpolated linearly at `offset` (baked first when the curve changed).
 *
 * @godot Curve.sample_baked
 * @source scene/resources/curve.cpp:554
 */
export function sample_baked(self: Curve, p_offset: number): number {
  const offset = f32(p_offset);
  if (!Number.isFinite(offset)) return 0;
  if (self.dirty) bakeCache(self);
  const cache = self.baked;
  if (cache.length === 0) return self.points.length === 0 ? 0 : (self.points[0] as Point).position.y;
  if (cache.length === 1) return cache[0] as number;
  let fi = f32(f32(f32(offset - self.min_domain) / f32(self.max_domain - self.min_domain)) * (cache.length - 1));
  let i = Math.floor(fi);
  if (i < 0) {
    i = 0;
    fi = 0;
  } else if (i >= cache.length) {
    i = cache.length - 1;
    fi = 0;
  }
  if (i + 1 < cache.length) {
    const t = f32(fi - i);
    const from = cache[i] as number;
    return f32(from + f32(f32((cache[i + 1] as number) - from) * t));
  }
  return cache[cache.length - 1] as number;
}

/**
 * @godot Curve.set_bake_resolution
 * @source scene/resources/curve.cpp:547
 */
export function set_bake_resolution(self: Curve, resolution: number): void {
  if (resolution < 1 || resolution > 1000) return;
  self.bake_resolution = resolution;
  self.dirty = true;
}

/**
 * @godot Curve.get_bake_resolution
 * @source scene/resources/curve.h:140
 */
export function get_bake_resolution(self: Curve): number {
  return self.bake_resolution;
}

/**
 * At most the maximum less `MIN_Y_RANGE`, and at most every point's value.
 *
 * @godot Curve.set_min_value
 * @source scene/resources/curve.cpp:349
 */
export function set_min_value(self: Curve, min: number): void {
  let value = f32(Math.min(f32(min), f32(self.max_value - f32(MIN_Y_RANGE))));
  for (const point of self.points) value = Math.min(value, point.position.y);
  self.min_value = value;
}

/**
 * At least the minimum plus `MIN_Y_RANGE`, and at least every point's value.
 *
 * @godot Curve.set_max_value
 * @source scene/resources/curve.cpp:359
 */
export function set_max_value(self: Curve, max: number): void {
  let value = f32(Math.max(f32(max), f32(self.min_value + f32(MIN_Y_RANGE))));
  for (const point of self.points) value = Math.max(value, point.position.y);
  self.max_value = value;
}

/**
 * An empty curve at the default range becomes a flat line at 1 over the range given
 * (`Curve::ensure_default_setup`), as a particle parameter's curve does when it is set.
 *
 * @godot Curve (protocol)
 * @source scene/resources/curve.cpp:593
 */
export function godot_curve_ensure_default_setup(self: Curve, min: number, max: number): void {
  if (self.points.length === 0 && self.min_value === 0 && self.max_value === 1) {
    add_point(self, vector2(0, 1));
    add_point(self, vector2(1, 1));
    set_min_value(self, min);
    set_max_value(self, max);
  }
}

/**
 * @godot Curve.get_min_value
 * @source scene/resources/curve.h:103
 */
export function get_min_value(self: Curve): number {
  return self.min_value;
}

/**
 * @godot Curve.get_max_value
 * @source scene/resources/curve.h:105
 */
export function get_max_value(self: Curve): number {
  return self.max_value;
}

/**
 * A Curve of the properties a scene states, set in the order given: `limits` (`_limits`), `data`
 * (`_data`: each point's position as two numbers, its two tangents and two modes, flat),
 * `pointCount`, the value range and the bake resolution; an unknown one fails by name.
 *
 * @godot Curve (protocol)
 * @source scene/resources/curve.cpp:41
 */
export function godot_curve_new(properties: Readonly<Record<string, unknown>> = {}): Curve {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'data') {
      const flat = value as readonly number[];
      const entries: unknown[] = [];
      for (let i = 0; i + 6 <= flat.length; i += 6) entries.push(vector2(flat[i] as number, flat[i + 1] as number), flat[i + 2], flat[i + 3], flat[i + 4], flat[i + 5]);
      _set_data(self, entries);
    } else if (property === 'limits') _set_limits(self, value as readonly number[]);
    else if (property === 'pointCount') set_point_count(self, value as number);
    else if (property === 'minValue') set_min_value(self, value as number);
    else if (property === 'maxValue') set_max_value(self, value as number);
    else if (property === 'bakeResolution') set_bake_resolution(self, value as number);
    else throw new Error(`godot-compat: Curve has no ${property} property.`);
  }
  return self;
}
