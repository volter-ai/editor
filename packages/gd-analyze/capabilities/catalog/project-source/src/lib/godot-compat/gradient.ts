/**
 * @godot-class Gradient
 * @role PROTOCOL
 *
 * Godot 4.7's `Gradient` resource (`scene/resources/gradient.{h,cpp}`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): points of an offset and a colour, sorted by offset
 * before they are read, sampled constant, linearly or cubically, in sRGB or linear sRGB. Offsets
 * and colours are `float`, rounded with `Math.fround`. The Oklab colour space is not transcribed.
 */

import { type Color, construct as color } from './color';

const f32 = Math.fround;

/** `Gradient::InterpolationMode` (`gradient.h:41`). */
const INTERPOLATE_LINEAR = 0;
const INTERPOLATE_CONSTANT = 1;
const INTERPOLATE_CUBIC = 2;
/** `Gradient::ColorSpace` (`gradient.h:47`). */
const COLOR_SPACE_SRGB = 0;
const COLOR_SPACE_LINEAR_SRGB = 1;

interface Point {
  offset: number;
  color: Color;
}

export interface Gradient {
  points: Point[];
  sorted: boolean;
  interpolation_mode: number;
  interpolation_color_space: number;
}

/**
 * Black at 0 to white at 1 (`Gradient::Gradient`).
 *
 * @godot Gradient (protocol)
 * @source scene/resources/gradient.cpp:36
 */
export function construct(): Gradient {
  return {
    points: [
      { offset: 0, color: color(0, 0, 0, 1) },
      { offset: 1, color: color(1, 1, 1, 1) },
    ],
    sorted: true,
    interpolation_mode: INTERPOLATE_LINEAR,
    interpolation_color_space: COLOR_SPACE_SRGB,
  };
}

/** `_update_sorting` (`gradient.h:66`): points by offset. */
function sort(self: Gradient): void {
  if (self.sorted) return;
  self.points.sort((left, right) => left.offset - right.offset);
  self.sorted = true;
}

/** `Color::srgb_to_linear` (`core/math/color.h:192`). */
function srgbToLinear(value: Color): Color {
  const channel = (c: number): number =>
    c < f32(0.04045) ? f32(c * f32(1 / 12.92)) : f32(Math.pow(f32((c + 0.055) * (1.0 / (1.0 + 0.055))), f32(2.4)));
  return color(channel(value.r), channel(value.g), channel(value.b), value.a);
}

/** `Color::linear_to_srgb` (`core/math/color.h:199`). */
function linearToSrgb(value: Color): Color {
  const channel = (c: number): number =>
    c < f32(0.0031308) ? f32(f32(12.92) * c) : f32((1.0 + 0.055) * f32(Math.pow(c, f32(1 / 2.4))) - 0.055);
  return color(channel(value.r), channel(value.g), channel(value.b), value.a);
}

function transform(self: Gradient, value: Color): Color {
  if (self.interpolation_color_space === COLOR_SPACE_LINEAR_SRGB) return srgbToLinear(value);
  if (self.interpolation_color_space !== COLOR_SPACE_SRGB) throw new Error('godot-compat: the Oklab gradient colour space is not transcribed.');
  return value;
}

function inverse(self: Gradient, value: Color): Color {
  return self.interpolation_color_space === COLOR_SPACE_LINEAR_SRGB ? linearToSrgb(value) : value;
}

/** `Math::lerp` in float (`core/math/math_funcs.h:338`). */
function lerp(from: number, to: number, weight: number): number {
  return f32(from + f32(f32(to - from) * weight));
}

/** `Math::cubic_interpolate` in float (`core/math/math_funcs.h:349`). */
function cubic(from: number, to: number, pre: number, post: number, weight: number): number {
  const w2 = f32(weight * weight);
  const w3 = f32(w2 * weight);
  const a = f32(from * 2);
  const b = f32(f32(-pre + to) * weight);
  const c = f32(f32(f32(f32(f32(2 * pre) - f32(5 * from)) + f32(4 * to)) - post) * w2);
  const d = f32(f32(f32(f32(-pre + f32(3 * from)) - f32(3 * to)) + post) * w3);
  return f32(0.5 * f32(f32(f32(a + b) + c) + d));
}

/**
 * The colour at `offset` (`Gradient::get_color_at_offset`): the point's own colour at a point, the
 * end colours beyond the ends, else the two points around it interpolated.
 *
 * @godot Gradient.sample
 * @source scene/resources/gradient.h:151
 */
export function sample(self: Gradient, p_offset: number): Color {
  const offset = f32(p_offset);
  const points = self.points;
  if (points.length === 0) return color(0, 0, 0, 1);
  sort(self);
  let low = 0;
  let high = points.length - 1;
  let middle = 0;
  while (low <= high) {
    middle = Math.trunc((low + high) / 2);
    const point = points[middle] as Point;
    if (point.offset > offset) high = middle - 1;
    else if (point.offset < offset) low = middle + 1;
    else return point.color;
  }
  if ((points[middle] as Point).offset > offset) middle -= 1;
  const first = middle;
  const second = middle + 1;
  if (second >= points.length) return (points[points.length - 1] as Point).color;
  if (first < 0) return (points[0] as Point).color;
  const point1 = points[first] as Point;
  const point2 = points[second] as Point;
  const weight = f32(f32(offset - point1.offset) / f32(point2.offset - point1.offset));
  if (self.interpolation_mode === INTERPOLATE_CONSTANT) return point1.color;
  if (self.interpolation_mode === INTERPOLATE_CUBIC) {
    const point0 = points[first - 1 < 0 ? first : first - 1] as Point;
    const point3 = points[second + 1 >= points.length ? second : second + 1] as Point;
    const [c0, c1, c2, c3] = [point0, point1, point2, point3].map((point) => transform(self, point.color)) as [Color, Color, Color, Color];
    return inverse(
      self,
      color(
        cubic(c1.r, c2.r, c0.r, c3.r, weight),
        cubic(c1.g, c2.g, c0.g, c3.g, weight),
        cubic(c1.b, c2.b, c0.b, c3.b, weight),
        cubic(c1.a, c2.a, c0.a, c3.a, weight),
      ),
    );
  }
  const c1 = transform(self, point1.color);
  const c2 = transform(self, point2.color);
  return inverse(self, color(lerp(c1.r, c2.r, weight), lerp(c1.g, c2.g, weight), lerp(c1.b, c2.b, weight), lerp(c1.a, c2.a, weight)));
}

/**
 * The points' offsets, resizing the point list; the colours of new points are black.
 *
 * @godot Gradient.set_offsets
 * @source scene/resources/gradient.cpp:147
 */
export function set_offsets(self: Gradient, offsets: readonly number[]): void {
  self.points = offsets.map((offset, index) => ({ offset: f32(offset), color: self.points[index]?.color ?? color() }));
  self.sorted = false;
}

/**
 * @godot Gradient.get_offsets
 * @source scene/resources/gradient.cpp:102
 */
export function get_offsets(self: Gradient): number[] {
  return self.points.map((point) => point.offset);
}

/**
 * The points' colours, resizing the point list; new points are at offset 0 and unsort it.
 *
 * @godot Gradient.set_colors
 * @source scene/resources/gradient.cpp:156
 */
export function set_colors(self: Gradient, colors: readonly Color[]): void {
  if (self.points.length < colors.length) self.sorted = false;
  self.points = colors.map((value, index) => ({ offset: self.points[index]?.offset ?? 0, color: color(value.r, value.g, value.b, value.a) }));
}

/**
 * @godot Gradient.get_colors
 * @source scene/resources/gradient.cpp:111
 */
export function get_colors(self: Gradient): Color[] {
  return self.points.map((point) => point.color);
}

/**
 * @godot Gradient.set_interpolation_mode
 * @source scene/resources/gradient.cpp:120
 */
export function set_interpolation_mode(self: Gradient, mode: number): void {
  self.interpolation_mode = mode;
}

/**
 * @godot Gradient.get_interpolation_mode
 * @source scene/resources/gradient.cpp:130
 */
export function get_interpolation_mode(self: Gradient): number {
  return self.interpolation_mode;
}

/**
 * @godot Gradient.set_interpolation_color_space
 * @source scene/resources/gradient.cpp:134
 */
export function set_interpolation_color_space(self: Gradient, space: number): void {
  self.interpolation_color_space = space;
}

/**
 * @godot Gradient.get_interpolation_color_space
 * @source scene/resources/gradient.cpp:143
 */
export function get_interpolation_color_space(self: Gradient): number {
  return self.interpolation_color_space;
}

/**
 * @godot Gradient.add_point
 * @source scene/resources/gradient.cpp:167
 */
export function add_point(self: Gradient, offset: number, value: Color): void {
  self.points.push({ offset: f32(offset), color: value });
  self.sorted = false;
}

/**
 * @godot Gradient.get_point_count
 * @source scene/resources/gradient.cpp:221
 */
export function get_point_count(self: Gradient): number {
  return self.points.length;
}

/**
 * A Gradient of the properties a scene states (`offsets` and `colors` as flat numbers, a colour
 * four), set in the order given; an unknown one fails by name.
 *
 * @godot Gradient (protocol)
 * @source scene/resources/gradient.cpp:36
 */
export function godot_gradient_new(properties: Readonly<Record<string, unknown>> = {}): Gradient {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'offsets') set_offsets(self, value as readonly number[]);
    else if (property === 'colors') {
      const flat = value as readonly number[];
      set_colors(self, Array.from({ length: flat.length / 4 }, (_, i) => color(flat[i * 4] as number, flat[i * 4 + 1] as number, flat[i * 4 + 2] as number, flat[i * 4 + 3] as number)));
    } else if (property === 'interpolationMode') set_interpolation_mode(self, value as number);
    else if (property === 'interpolationColorSpace') set_interpolation_color_space(self, value as number);
    else throw new Error(`godot-compat: Gradient has no ${property} property.`);
  }
  return self;
}
