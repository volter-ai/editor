/**
 * @godot-class Curve3D
 * @role BINDING
 *
 * Godot 4.7's `Curve3D` (`scene/resources/curve.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): points joined by cubic Béziers (each point's position
 * with its in and out handles, and a tilt), measured along its length as its baked points
 * (`bake_interval` apart) measure it, which PathFollow3D places its node along.
 */

import { construct as vector3, type Vector3 } from './vector3';

interface Point {
  position: Vector3;
  in: Vector3;
  out: Vector3;
  tilt: number;
}

export interface Curve3D {
  points: Point[];
  bakeInterval: number;
  baked?: { readonly points: readonly Vector3[]; readonly distances: readonly number[] };
}

/**
 * A new Curve3D, with the properties a scene states (`_data`'s points and tilts, `bake_interval`).
 *
 * @godot Curve3D (protocol)
 * @source scene/resources/curve.cpp:2380
 */
export function godot_curve_3d_new(properties: Readonly<Record<string, unknown>> = {}): Curve3D {
  const self: Curve3D = { points: [], bakeInterval: 0.2 };
  if (properties['bakeInterval'] !== undefined) self.bakeInterval = properties['bakeInterval'] as number;
  if (properties['data'] !== undefined) _set_data(self, properties['data']);
  return self;
}

/**
 * @godot Curve3D.Curve3D
 * @source scene/resources/curve.cpp:2380
 */
export function construct(): Curve3D {
  return godot_curve_3d_new();
}

function entry(data: unknown, key: string): unknown {
  return data instanceof Map ? data.get(key) : (data as Readonly<Record<string, unknown>> | null)?.[key];
}

/**
 * The points as the scene stores them: `points` (each point's in handle, out handle and position)
 * and `tilts`.
 *
 * @godot Curve3D._set_data
 * @source scene/resources/curve.cpp:2175
 */
export function _set_data(self: Curve3D, data: unknown): void {
  const flat = (entry(data, 'points') ?? []) as readonly number[];
  const tilts = (entry(data, 'tilts') ?? []) as readonly number[];
  self.points = [];
  for (let i = 0; i + 8 < flat.length; i += 9) {
    self.points.push({
      in: vector3(flat[i] as number, flat[i + 1] as number, flat[i + 2] as number),
      out: vector3(flat[i + 3] as number, flat[i + 4] as number, flat[i + 5] as number),
      position: vector3(flat[i + 6] as number, flat[i + 7] as number, flat[i + 8] as number),
      tilt: tilts[i / 9] ?? 0,
    });
  }
  delete self.baked;
}

function bezier(p0: Vector3, c0: Vector3, c1: Vector3, p1: Vector3, t: number): Vector3 {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return vector3(a * p0.x + b * c0.x + c * c1.x + d * p1.x, a * p0.y + b * c0.y + c * c1.y + d * p1.y, a * p0.z + b * c0.z + c * c1.z + d * p1.z);
}

function bake(self: Curve3D): NonNullable<Curve3D['baked']> {
  if (self.baked !== undefined) return self.baked;
  const points: Vector3[] = [];
  const distances: number[] = [];
  const push = (point: Vector3) => {
    const last = points.at(-1);
    distances.push(last === undefined ? 0 : (distances.at(-1) as number) + Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z));
    points.push(point);
  };
  if (self.points.length > 0) push((self.points[0] as Point).position);
  for (let i = 0; i + 1 < self.points.length; i += 1) {
    const a = self.points[i] as Point;
    const b = self.points[i + 1] as Point;
    const c0 = vector3(a.position.x + a.out.x, a.position.y + a.out.y, a.position.z + a.out.z);
    const c1 = vector3(b.position.x + b.in.x, b.position.y + b.in.y, b.position.z + b.in.z);
    const chord = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z);
    const steps = Math.max(1, Math.ceil(chord / Math.max(self.bakeInterval, 0.001)));
    for (let s = 1; s <= steps; s += 1) push(bezier(a.position, c0, c1, b.position, s / steps));
  }
  self.baked = { points, distances };
  return self.baked;
}

/**
 * @godot Curve3D.get_baked_length
 * @source scene/resources/curve.cpp:1830
 */
export function get_baked_length(self: Curve3D): number {
  return bake(self).distances.at(-1) ?? 0;
}

/**
 * The point at `offset` along the baked curve, and the direction there.
 *
 * @godot Curve3D (protocol)
 * @source scene/resources/curve.cpp:1880
 */
export function godot_curve_3d_sample(self: Curve3D, offset: number): { readonly position: Vector3; readonly direction: Vector3 } {
  const { points, distances } = bake(self);
  if (points.length < 2) return { position: points[0] ?? vector3(), direction: vector3(0, 0, -1) };
  const length = distances.at(-1) as number;
  const at = Math.min(Math.max(offset, 0), length);
  let i = 1;
  while (i < distances.length - 1 && (distances[i] as number) < at) i += 1;
  const a = points[i - 1] as Vector3;
  const b = points[i] as Vector3;
  const span = (distances[i] as number) - (distances[i - 1] as number);
  const t = span > 0 ? (at - (distances[i - 1] as number)) / span : 0;
  const [dx, dy, dz] = [b.x - a.x, b.y - a.y, b.z - a.z];
  const d = Math.hypot(dx, dy, dz) || 1;
  return { position: vector3(a.x + dx * t, a.y + dy * t, a.z + dz * t), direction: vector3(dx / d, dy / d, dz / d) };
}

/**
 * @godot Curve3D.sample_baked
 * @source scene/resources/curve.cpp:1880
 */
export function sample_baked(self: Curve3D, offset = 0, cubic = false): Vector3 {
  void cubic;
  return godot_curve_3d_sample(self, offset).position;
}

/**
 * @godot Curve3D.get_point_count
 * @source scene/resources/curve.cpp:1510
 */
export function get_point_count(self: Curve3D): number {
  return self.points.length;
}

/**
 * @godot Curve3D.get_point_position
 * @source scene/resources/curve.cpp:1560
 */
export function get_point_position(self: Curve3D, idx: number): Vector3 {
  return self.points[idx]?.position ?? vector3();
}

/**
 * @godot Curve3D.add_point
 * @source scene/resources/curve.cpp:1530
 */
export function add_point(self: Curve3D, position: Vector3, in_: Vector3 = vector3(), out: Vector3 = vector3(), index = -1): void {
  const point = { position, in: in_, out, tilt: 0 };
  if (index < 0 || index >= self.points.length) self.points.push(point);
  else self.points.splice(index, 0, point);
  delete self.baked;
}
