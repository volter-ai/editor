/** Godot Curve Resource: ordered cubic Bézier points and the source bake cache. */

import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import type { Vector2 } from './vector2';

export const CurveTangentMode = { FREE: 0, LINEAR: 1 } as const;

interface CurvePoint {
  position: Vector2;
  leftTangent: number;
  rightTangent: number;
  leftMode: number;
  rightMode: number;
}

export interface GodotAuthoredCurvePoint {
  readonly position: Vector2;
  readonly leftTangent: number;
  readonly rightTangent: number;
  readonly leftMode: number;
  readonly rightMode: number;
}

const AUTHORED_CURVE_SEED = Symbol('godot-authored-curve-seed');

const finite = (value: number, member: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`Curve.${member} must be finite.`);
  return Math.fround(value);
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

export class GodotCurve {
  private points: CurvePoint[] = [];
  private minValue = 0;
  private maxValue = 1;
  private minDomain = 0;
  private maxDomain = 1;
  private bakeResolution = 100;
  private baked: number[] = [];
  private dirty = true;
  private readonly rangeChanged: SignalHandle<readonly []> = createSignal();
  private readonly domainChanged: SignalHandle<readonly []> = createSignal();

  constructor() { registerGodotObjectIdentity(this, 'Curve'); }

  get_point_count(): number { return this.points.length; }

  set_point_count(count: number): void {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('Curve.point_count must be non-negative.');
    if (count < this.points.length) this.points.length = count;
    else {
      const defaultOffset = this.points.length === 0 ? clamp(0, this.minDomain, this.maxDomain) : this.maxDomain;
      const defaultValue = clamp(0, this.minValue, this.maxValue);
      while (this.points.length < count) this.add(defaultOffset, defaultValue, 0, 0, 0, 0);
    }
    this.markDirty();
  }

  /**
   * ResourceFormatLoader's `Curve._data` path. Unlike interactive `add_point`, Godot's
   * `Curve::set_data` copies the saved tangent values and modes literally; LINEAR modes must not
   * recompute those already-authored tangents while loading.
   */
  [AUTHORED_CURVE_SEED](points: readonly GodotAuthoredCurvePoint[]): void {
    this.points = points.map((point) => ({
      position: this.vector(point.position),
      leftTangent: finite(point.leftTangent, 'left_tangent'),
      rightTangent: finite(point.rightTangent, 'right_tangent'),
      leftMode: this.mode(point.leftMode),
      rightMode: this.mode(point.rightMode),
    }));
    this.markDirty();
  }

  add_point(position: Vector2, leftTangent = 0, rightTangent = 0, leftMode = 0, rightMode = 0): number {
    const point = this.vector(position);
    this.mode(leftMode);
    this.mode(rightMode);
    const index = this.add(point.x, point.y, leftTangent, rightTangent, leftMode, rightMode);
    this.markDirty();
    return index;
  }

  remove_point(index: number): void {
    this.requireIndex(index);
    this.points.splice(index, 1);
    this.markDirty();
  }

  clear_points(): void {
    if (this.points.length === 0) return;
    this.points = [];
    this.markDirty();
  }

  get_point_position(index: number): Vector2 {
    const point = this.point(index).position;
    return { x: point.x, y: point.y };
  }

  set_point_value(index: number, value: number): void {
    this.point(index).position.y = finite(value, 'set_point_value');
    this.updateTangents(index);
    this.markDirty();
  }

  set_point_offset(index: number, value: number): number {
    const point = { ...this.point(index), position: { ...this.point(index).position } };
    this.points.splice(index, 1);
    const next = this.add(value, point.position.y, point.leftTangent, point.rightTangent, point.leftMode, point.rightMode);
    if (index !== next && index < this.points.length) this.updateTangents(index);
    this.updateTangents(next);
    this.markDirty();
    return next;
  }

  get_point_left_tangent(index: number): number { return this.point(index).leftTangent; }
  get_point_right_tangent(index: number): number { return this.point(index).rightTangent; }
  get_point_left_mode(index: number): number { return this.point(index).leftMode; }
  get_point_right_mode(index: number): number { return this.point(index).rightMode; }

  set_point_left_tangent(index: number, tangent: number): void {
    const point = this.point(index);
    point.leftTangent = finite(tangent, 'set_point_left_tangent');
    point.leftMode = CurveTangentMode.FREE;
    this.markDirty();
  }

  set_point_right_tangent(index: number, tangent: number): void {
    const point = this.point(index);
    point.rightTangent = finite(tangent, 'set_point_right_tangent');
    point.rightMode = CurveTangentMode.FREE;
    this.markDirty();
  }

  set_point_left_mode(index: number, mode: number): void {
    const point = this.point(index);
    point.leftMode = this.mode(mode);
    if (index > 0 && mode === CurveTangentMode.LINEAR) {
      point.leftTangent = this.slope(point.position, this.points[index - 1]!.position);
    }
    this.markDirty();
  }

  set_point_right_mode(index: number, mode: number): void {
    const point = this.point(index);
    point.rightMode = this.mode(mode);
    if (index + 1 < this.points.length && mode === CurveTangentMode.LINEAR) {
      point.rightTangent = this.slope(point.position, this.points[index + 1]!.position);
    }
    this.markDirty();
  }

  sample(value: number): number {
    const at = finite(value, 'sample');
    if (this.points.length === 0) return 0;
    if (this.points.length === 1) return this.points[0]!.position.y;
    const index = this.indexAt(at);
    if (index === this.points.length - 1) return this.points[index]!.position.y;
    const local = at - this.points[index]!.position.x;
    if (index === 0 && local <= 0) return this.points[0]!.position.y;
    return this.sampleLocal(index, local);
  }

  /** Godot 3 spelling retained over the same Curve sample implementation. */
  interpolate(value: number): number { return this.sample(value); }

  sample_baked(value: number): number {
    const at = finite(value, 'sample_baked');
    if (this.dirty) this.bake();
    if (this.baked.length === 0) return this.points[0]?.position.y ?? 0;
    if (this.baked.length === 1) return this.baked[0] ?? 0;
    let fraction = (at - this.minDomain) / this.get_domain_range() * (this.baked.length - 1);
    let index = Math.floor(fraction);
    if (index < 0) { index = 0; fraction = 0; }
    else if (index >= this.baked.length) { index = this.baked.length - 1; fraction = 0; }
    if (index + 1 >= this.baked.length) return this.baked.at(-1) ?? 0;
    const weight = fraction - index;
    return (this.baked[index] ?? 0) + ((this.baked[index + 1] ?? 0) - (this.baked[index] ?? 0)) * weight;
  }

  clean_dupes(): void {
    let changed = false;
    for (let index = 1; index < this.points.length; index += 1) {
      if (this.points[index]!.position.x - this.points[index - 1]!.position.x <= 0.00001) {
        this.points.splice(index--, 1);
        changed = true;
      }
    }
    if (changed) this.markDirty();
  }

  bake(): void {
    this.baked = Array.from({ length: this.bakeResolution }, () => 0);
    for (let index = 1; index < this.bakeResolution - 1; index += 1) {
      const x = this.get_domain_range() * index / (this.bakeResolution - 1) + this.minDomain;
      this.baked[index] = this.sample(x);
    }
    if (this.points.length > 0 && this.baked.length > 0) {
      this.baked[0] = this.points[0]!.position.y;
      this.baked[this.baked.length - 1] = this.points.at(-1)!.position.y;
    }
    this.dirty = false;
  }

  get_min_value(): number { return this.minValue; }
  get_max_value(): number { return this.maxValue; }
  get_min_domain(): number { return this.minDomain; }
  get_max_domain(): number { return this.maxDomain; }
  get_value_range(): number { return this.maxValue - this.minValue; }
  get_domain_range(): number { return this.maxDomain - this.minDomain; }
  get_bake_resolution(): number { return this.bakeResolution; }
  get range_changed(): GodotSignal<readonly []> { return this.rangeChanged.signal; }
  get domain_changed(): GodotSignal<readonly []> { return this.domainChanged.signal; }

  set_min_value(value: number): void {
    this.minValue = Math.min(finite(value, 'min_value'), this.maxValue - 0.01);
    for (const point of this.points) this.minValue = Math.min(this.minValue, point.position.y);
    this.markDirty();
    this.rangeChanged.emit();
  }
  set_max_value(value: number): void {
    this.maxValue = Math.max(finite(value, 'max_value'), this.minValue + 0.01);
    for (const point of this.points) this.maxValue = Math.max(this.maxValue, point.position.y);
    this.markDirty();
    this.rangeChanged.emit();
  }
  set_min_domain(value: number): void {
    this.minDomain = Math.min(finite(value, 'min_domain'), this.maxDomain - 0.01);
    if (this.points.length > 0) this.minDomain = Math.min(this.minDomain, this.points[0]!.position.x);
    this.markDirty();
    this.domainChanged.emit();
  }
  set_max_domain(value: number): void {
    this.maxDomain = Math.max(finite(value, 'max_domain'), this.minDomain + 0.01);
    if (this.points.length > 0) this.maxDomain = Math.max(this.maxDomain, this.points.at(-1)!.position.x);
    this.markDirty();
    this.domainChanged.emit();
  }
  set_bake_resolution(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 1000) throw new RangeError('Curve bake_resolution must be 1..1000.');
    this.bakeResolution = value;
    this.markDirty();
  }

  private add(x: number, y: number, left: number, right: number, leftMode: number, rightMode: number): number {
    const point: CurvePoint = {
      position: { x: clamp(finite(x, 'point.x'), this.minDomain, this.maxDomain), y: clamp(finite(y, 'point.y'), this.minValue, this.maxValue) },
      leftTangent: finite(left, 'left_tangent'), rightTangent: finite(right, 'right_tangent'),
      leftMode: this.mode(leftMode), rightMode: this.mode(rightMode),
    };
    let index = this.points.findIndex((candidate) => candidate.position.x > point.position.x);
    if (index < 0) index = this.points.length;
    this.points.splice(index, 0, point);
    this.updateTangents(index);
    return index;
  }

  private sampleLocal(index: number, local: number): number {
    const a = this.points[index]!;
    const b = this.points[index + 1]!;
    let distance = b.position.x - a.position.x;
    if (Math.abs(distance) <= 0.00001) return b.position.y;
    const weight = local / distance;
    distance /= 3;
    const ac = a.position.y + distance * a.rightTangent;
    const bc = b.position.y - distance * b.leftTangent;
    const inverse = 1 - weight;
    return inverse ** 3 * a.position.y + 3 * inverse ** 2 * weight * ac + 3 * inverse * weight ** 2 * bc + weight ** 3 * b.position.y;
  }

  private indexAt(value: number): number {
    let index = 0;
    while (index + 1 < this.points.length && this.points[index + 1]!.position.x <= value) index += 1;
    return index;
  }

  private updateTangents(index: number): void {
    if (index < 0 || index >= this.points.length) return;
    const point = this.points[index]!;
    if (index > 0) {
      const previous = this.points[index - 1]!;
      if (point.leftMode === 1) point.leftTangent = this.slope(point.position, previous.position);
      if (previous.rightMode === 1) previous.rightTangent = this.slope(previous.position, point.position);
    }
    if (index + 1 < this.points.length) {
      const next = this.points[index + 1]!;
      if (point.rightMode === 1) point.rightTangent = this.slope(point.position, next.position);
      if (next.leftMode === 1) next.leftTangent = this.slope(next.position, point.position);
    }
  }

  private slope(from: Vector2, to: Vector2): number { return (to.y - from.y) / (to.x - from.x); }
  private point(index: number): CurvePoint { this.requireIndex(index); return this.points[index]!; }
  private requireIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.points.length) throw new RangeError(`Curve point ${index} is out of range.`);
  }
  private mode(value: number): number {
    if (value !== 0 && value !== 1) throw new RangeError('Curve tangent mode must be FREE(0) or LINEAR(1).');
    return value;
  }
  private vector(value: Vector2): Vector2 {
    if (typeof value !== 'object' || value === null) throw new TypeError('Curve.add_point requires Vector2.');
    return { x: finite(value.x, 'point.x'), y: finite(value.y, 'point.y') };
  }
  private markDirty(): void { this.dirty = true; godotResourceEmitChanged(this); }
}

export function createGodotCurve(): GodotCurve { return new GodotCurve(); }

/** Translator-facing authored Resource seed; behavior stays with the retained compat Resource. */
export function seedGodotCurveAuthoredPoints(
  curve: GodotCurve,
  points: readonly GodotAuthoredCurvePoint[],
): void {
  curve[AUTHORED_CURVE_SEED](points);
}
