/**
 * @godot-class Curve2D
 * @role BINDING
 *
 * Godot 4.7's `Curve2D` (`scene/resources/curve.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): points joined by cubic Béziers (each point's
 * position with its in and out handles), measured along its length as its baked points
 * (`bake_interval` apart) measure it, which PathFollow2D places its node along.
 */

import { construct as vector2, type Vector2 } from './vector2';

interface Point {
  position: Vector2;
  in: Vector2;
  out: Vector2;
}

export interface Curve2D {
  points: Point[];
  bakeInterval: number;
  /** The baked polyline and each baked point's distance from the start, when current. */
  baked?: { readonly points: readonly Vector2[]; readonly distances: readonly number[] };
}

const CURVES = new WeakSet<object>();

/**
 * A new Curve2D, with the properties a scene states (`_data`'s points, `bake_interval`).
 *
 * @godot Curve2D (protocol)
 * @source scene/resources/curve.cpp:1420
 */
export function godot_curve_2d_new(properties: Readonly<Record<string, unknown>> = {}): Curve2D {
  const self: Curve2D = { points: [], bakeInterval: 5 };
  CURVES.add(self);
  if (properties['bakeInterval'] !== undefined) self.bakeInterval = properties['bakeInterval'] as number;
  if (properties['data'] !== undefined) _set_data(self, properties['data']);
  return self;
}

/**
 * @godot Curve2D.Curve2D
 * @source scene/resources/curve.cpp:1420
 */
export function construct(): Curve2D {
  return godot_curve_2d_new();
}

/**
 * The points as the scene stores them: `points`, each point's in handle, out handle and position.
 *
 * @godot Curve2D._set_data
 * @source scene/resources/curve.cpp:1262
 */
export function _set_data(self: Curve2D, data: unknown): void {
  const raw = data instanceof Map ? data.get('points') : (data as Readonly<Record<string, unknown>> | null)?.['points'];
  const flat = Array.isArray(raw) ? (raw as readonly unknown[]).flatMap((entry) => (typeof entry === 'number' ? [entry] : [(entry as Vector2).x, (entry as Vector2).y])) : [];
  self.points = [];
  for (let i = 0; i + 5 < flat.length; i += 6) {
    self.points.push({ in: vector2(flat[i] as number, flat[i + 1] as number), out: vector2(flat[i + 2] as number, flat[i + 3] as number), position: vector2(flat[i + 4] as number, flat[i + 5] as number) });
  }
  delete self.baked;
}

function bezier(p0: Vector2, c0: Vector2, c1: Vector2, p1: Vector2, t: number): Vector2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return vector2(a * p0.x + b * c0.x + c * c1.x + d * p1.x, a * p0.y + b * c0.y + c * c1.y + d * p1.y);
}

function bake(self: Curve2D): NonNullable<Curve2D['baked']> {
  if (self.baked !== undefined) return self.baked;
  const points: Vector2[] = [];
  const distances: number[] = [];
  const push = (point: Vector2) => {
    const last = points.at(-1);
    distances.push(last === undefined ? 0 : (distances.at(-1) as number) + Math.hypot(point.x - last.x, point.y - last.y));
    points.push(point);
  };
  if (self.points.length > 0) push((self.points[0] as Point).position);
  for (let i = 0; i + 1 < self.points.length; i += 1) {
    const a = self.points[i] as Point;
    const b = self.points[i + 1] as Point;
    const c0 = vector2(a.position.x + a.out.x, a.position.y + a.out.y);
    const c1 = vector2(b.position.x + b.in.x, b.position.y + b.in.y);
    const chord = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
    const steps = Math.max(1, Math.ceil(chord / Math.max(self.bakeInterval, 0.01)));
    for (let s = 1; s <= steps; s += 1) push(bezier(a.position, c0, c1, b.position, s / steps));
  }
  self.baked = { points, distances };
  return self.baked;
}

/**
 * @godot Curve2D.get_baked_length
 * @source scene/resources/curve.cpp:1004
 */
export function get_baked_length(self: Curve2D): number {
  return bake(self).distances.at(-1) ?? 0;
}

/**
 * The point at `offset` along the baked curve, and the direction there.
 *
 * @godot Curve2D (protocol)
 * @source scene/resources/curve.cpp:1060
 */
export function godot_curve_2d_sample(self: Curve2D, offset: number): { readonly position: Vector2; readonly direction: Vector2 } {
  const { points, distances } = bake(self);
  if (points.length === 0) return { position: vector2(), direction: vector2(1, 0) };
  if (points.length === 1) return { position: points[0] as Vector2, direction: vector2(1, 0) };
  const length = distances.at(-1) as number;
  const at = Math.min(Math.max(offset, 0), length);
  let i = 1;
  while (i < distances.length - 1 && (distances[i] as number) < at) i += 1;
  const a = points[i - 1] as Vector2;
  const b = points[i] as Vector2;
  const span = (distances[i] as number) - (distances[i - 1] as number);
  const t = span > 0 ? (at - (distances[i - 1] as number)) / span : 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { position: vector2(a.x + dx * t, a.y + dy * t), direction: vector2(dx / d, dy / d) };
}

/**
 * @godot Curve2D.sample_baked
 * @source scene/resources/curve.cpp:1060
 */
export function sample_baked(self: Curve2D, offset = 0, cubic = false): Vector2 {
  void cubic;
  return godot_curve_2d_sample(self, offset).position;
}

/**
 * @godot Curve2D.get_point_count
 * @source scene/resources/curve.cpp:730
 */
export function get_point_count(self: Curve2D): number {
  return self.points.length;
}

/**
 * @godot Curve2D.add_point
 * @source scene/resources/curve.cpp:750
 */
export function add_point(self: Curve2D, position: Vector2, in_: Vector2 = vector2(), out: Vector2 = vector2(), index = -1): void {
  const point = { position, in: in_, out };
  if (index < 0 || index >= self.points.length) self.points.push(point);
  else self.points.splice(index, 0, point);
  delete self.baked;
}

/**
 * @godot Curve2D.get_point_position
 * @source scene/resources/curve.cpp:783
 */
export function get_point_position(self: Curve2D, idx: number): Vector2 {
  return self.points[idx]?.position ?? vector2();
}

/**
 * @godot Curve2D.set_point_position
 * @source scene/resources/curve.cpp:776
 */
export function set_point_position(self: Curve2D, idx: number, position: Vector2): void {
  const point = self.points[idx];
  if (point === undefined) return;
  point.position = position;
  delete self.baked;
}

/**
 * @godot Curve2D.clear_points
 * @source scene/resources/curve.cpp:768
 */
export function clear_points(self: Curve2D): void {
  self.points = [];
  delete self.baked;
}
