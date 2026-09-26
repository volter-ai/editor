/** Source-shaped Godot Gradient Resource with sorted points and exact sRGB/linear interpolation. */

import { colorLinearToSrgb, colorSrgbToLinear, godotColor } from './color';
import { registerGodotObjectIdentity } from './object';
import {
  packedColorArray,
  packedFloat32Array,
  type PackedColorArray,
  type PackedFloat32Array,
} from './packed-array';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import type { ColorValue } from './variant';

export const GradientInterpolationMode = {
  LINEAR: 0,
  CONSTANT: 1,
  CUBIC: 2,
} as const;

export const GradientColorSpace = {
  SRGB: 0,
  LINEAR_SRGB: 1,
  OKLAB: 2,
} as const;

interface GradientPoint {
  offset: number;
  color: ColorValue;
}

function color(value: unknown): ColorValue {
  if (typeof value !== 'object' || value === null) throw new TypeError('Gradient point requires Color.');
  const candidate = value as Partial<ColorValue>;
  for (const component of ['r', 'g', 'b', 'a'] as const) {
    if (typeof candidate[component] !== 'number' || !Number.isFinite(candidate[component])) {
      throw new TypeError(`Gradient Color.${component} must be finite.`);
    }
  }
  return godotColor(candidate.r, candidate.g, candidate.b, candidate.a);
}

function offset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Gradient offset must be finite.');
  return Math.fround(value);
}

function cubic(a: number, b: number, c: number, d: number, weight: number): number {
  const w2 = weight * weight;
  const w3 = w2 * weight;
  return 0.5 * (
    2 * b +
    (-a + c) * weight +
    (2 * a - 5 * b + 4 * c - d) * w2 +
    (-a + 3 * b - 3 * c + d) * w3
  );
}

export class GodotGradient {
  private points: GradientPoint[] = [
    { offset: 0, color: godotColor(0, 0, 0, 1) },
    { offset: 1, color: godotColor(1, 1, 1, 1) },
  ];
  private sorted = true;
  private interpolationMode: number = GradientInterpolationMode.LINEAR;
  private interpolationColorSpace: number = GradientColorSpace.SRGB;

  constructor() {
    registerGodotObjectIdentity(this, 'Gradient');
    bindGodotResourceProtocol(this, {
      createDuplicate() { return new GodotGradient(); },
      populateDuplicate(source, target) {
        target.set_offsets(source.get_offsets());
        target.set_colors(source.get_colors());
        target.set_interpolation_mode(source.get_interpolation_mode());
        target.set_interpolation_color_space(source.get_interpolation_color_space());
      },
    });
  }

  get offsets(): PackedFloat32Array { return this.get_offsets(); }
  set offsets(values: readonly number[]) { this.set_offsets(values); }
  get colors(): PackedColorArray { return this.get_colors(); }
  set colors(values: readonly ColorValue[]) { this.set_colors(values); }
  get interpolation_mode(): number { return this.get_interpolation_mode(); }
  set interpolation_mode(value: number) { this.set_interpolation_mode(value); }
  get interpolation_color_space(): number { return this.get_interpolation_color_space(); }
  set interpolation_color_space(value: number) { this.set_interpolation_color_space(value); }

  add_point(pointOffset: number, pointColor: ColorValue): void {
    this.points.push({ offset: offset(pointOffset), color: color(pointColor) });
    this.sorted = false;
    godotResourceEmitChanged(this);
  }

  remove_point(index: number): void {
    this.index(index);
    if (this.points.length <= 1) throw new Error('Gradient cannot remove its final point.');
    this.sort();
    this.points.splice(index, 1);
    godotResourceEmitChanged(this);
  }

  reverse(): void {
    for (const point of this.points) point.offset = Math.fround(1 - point.offset);
    this.sorted = false;
    this.sort();
    godotResourceEmitChanged(this);
  }

  set_offset(index: number, value: number): void {
    this.index(index);
    this.sort();
    (this.points[index] as GradientPoint).offset = offset(value);
    this.sorted = false;
    godotResourceEmitChanged(this);
  }

  get_offset(index: number): number {
    this.index(index);
    this.sort();
    return (this.points[index] as GradientPoint).offset;
  }

  set_color(index: number, value: ColorValue): void {
    this.index(index);
    this.sort();
    (this.points[index] as GradientPoint).color = color(value);
    godotResourceEmitChanged(this);
  }

  get_color(index: number): ColorValue {
    this.index(index);
    this.sort();
    return color((this.points[index] as GradientPoint).color);
  }

  get_point_count(): number { return this.points.length; }

  set_offsets(values: readonly number[]): void {
    this.points.length = values.length;
    for (let index = 0; index < values.length; index += 1) {
      const existing = this.points[index];
      this.points[index] = {
        offset: offset(values[index]),
        color: existing?.color ?? godotColor(),
      };
    }
    this.sorted = false;
    godotResourceEmitChanged(this);
  }

  get_offsets(): PackedFloat32Array {
    this.sort();
    return packedFloat32Array(this.points.map((point) => point.offset));
  }

  set_colors(values: readonly ColorValue[]): void {
    const previous = this.points;
    this.points = values.map((value, index) => ({
      offset: previous[index]?.offset ?? 0,
      color: color(value),
    }));
    if (previous.length < values.length) this.sorted = false;
    godotResourceEmitChanged(this);
  }

  get_colors(): PackedColorArray {
    this.sort();
    return packedColorArray(this.points.map((point) => point.color));
  }

  set_interpolation_mode(mode: number): void {
    if (!Number.isInteger(mode) || mode < 0 || mode > 2) throw new RangeError('Gradient interpolation mode must be 0..2.');
    if (mode === this.interpolationMode) return;
    this.interpolationMode = mode;
    godotResourceEmitChanged(this);
  }

  get_interpolation_mode(): number { return this.interpolationMode; }

  set_interpolation_color_space(space: number): void {
    if (!Number.isInteger(space) || space < 0 || space > 2) throw new RangeError('Gradient color space must be 0..2.');
    if (space === this.interpolationColorSpace) return;
    this.interpolationColorSpace = space;
    godotResourceEmitChanged(this);
  }

  get_interpolation_color_space(): number { return this.interpolationColorSpace; }

  sample(sampleOffset: number): ColorValue {
    const at = offset(sampleOffset);
    if (this.points.length === 0) return godotColor(0, 0, 0, 1);
    this.sort();
    const upper = this.points.findIndex((point) => point.offset > at);
    if (upper < 0) return color((this.points.at(-1) as GradientPoint).color);
    if (upper === 0) return color((this.points[0] as GradientPoint).color);
    const first = this.points[upper - 1] as GradientPoint;
    const second = this.points[upper] as GradientPoint;
    if (first.offset === at) return color(first.color);
    if (this.interpolationMode === GradientInterpolationMode.CONSTANT) return color(first.color);
    if (this.interpolationColorSpace === GradientColorSpace.OKLAB) {
      throw new Error('Gradient Oklab interpolation requires the pinned Godot ok_color conversion path.');
    }
    const weight = (at - first.offset) / (second.offset - first.offset);
    if (this.interpolationMode === GradientInterpolationMode.CUBIC) {
      const zero = this.points[Math.max(0, upper - 2)] as GradientPoint;
      const three = this.points[Math.min(this.points.length - 1, upper + 1)] as GradientPoint;
      const a = this.transform(zero.color);
      const b = this.transform(first.color);
      const c = this.transform(second.color);
      const d = this.transform(three.color);
      return this.inverse(godotColor(
        cubic(a.r, b.r, c.r, d.r, weight),
        cubic(a.g, b.g, c.g, d.g, weight),
        cubic(a.b, b.b, c.b, d.b, weight),
        cubic(a.a, b.a, c.a, d.a, weight),
      ));
    }
    const a = this.transform(first.color);
    const b = this.transform(second.color);
    return this.inverse(godotColor(
      a.r + (b.r - a.r) * weight,
      a.g + (b.g - a.g) * weight,
      a.b + (b.b - a.b) * weight,
      a.a + (b.a - a.a) * weight,
    ));
  }

  /** Godot 3 spelling of the same retained Gradient sampler. */
  interpolate(sampleOffset: number): ColorValue { return this.sample(sampleOffset); }

  private sort(): void {
    if (this.sorted) return;
    this.points.sort((a, b) => a.offset - b.offset);
    this.sorted = true;
  }

  private index(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= this.points.length) {
      throw new RangeError(`Gradient point ${value} is outside 0..${this.points.length - 1}.`);
    }
  }

  private transform(value: ColorValue): ColorValue {
    return this.interpolationColorSpace === GradientColorSpace.LINEAR_SRGB
      ? colorSrgbToLinear(value)
      : color(value);
  }

  private inverse(value: ColorValue): ColorValue {
    return this.interpolationColorSpace === GradientColorSpace.LINEAR_SRGB
      ? colorLinearToSrgb(value)
      : value;
  }
}

export function createGodotGradient(): GodotGradient { return new GodotGradient(); }
