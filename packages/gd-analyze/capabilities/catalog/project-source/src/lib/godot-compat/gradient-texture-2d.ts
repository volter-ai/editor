/**
 * @godot-class GradientTexture2D
 * @role BINDING
 *
 * Godot 4.7's `GradientTexture2D` (`scene/resources/gradient_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): an image of `width` by `height` whose every pixel is
 * its gradient sampled at the pixel's fill offset (linear, radial, square or conic from `fill_from`
 * to `fill_to`, clamped, repeated or mirrored), stored as 8-bit RGBA, drawn as a three
 * `DataTexture` whose rows are laid out as three's image textures are (the image's first row at
 * `v = 1`). High-dynamic-range images are not transcribed.
 */

import { DataTexture, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import type { Color } from './color';
import { type Gradient, get_point_count, sample } from './gradient';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;
/** `GradientTexture2D::Fill` (`gradient_texture.h:77`). */
const FILL_LINEAR = 0;
const FILL_RADIAL = 1;
const FILL_SQUARE = 2;
const FILL_CONIC = 3;
/** `GradientTexture2D::Repeat` (`gradient_texture.h:83`). */
const REPEAT_NONE = 0;
const REPEAT = 1;
const REPEAT_MIRROR = 2;

export interface GradientTexture2D {
  gradient: Gradient | null;
  width: number;
  height: number;
  use_hdr: boolean;
  fill_from: Vector2;
  fill_to: Vector2;
  fill: number;
  repeat: number;
  texture: DataTexture | null;
}

/**
 * 64 by 64, filled linearly from (0, 0) to (1, 0), not repeated (`gradient_texture.h:93`).
 *
 * @godot GradientTexture2D (protocol)
 * @source scene/resources/gradient_texture.cpp:193
 */
export function construct(): GradientTexture2D {
  return { gradient: null, width: 64, height: 64, use_hdr: false, fill_from: vector2(0, 0), fill_to: vector2(1, 0), fill: FILL_LINEAR, repeat: REPEAT_NONE, texture: null };
}

const length = (x: number, y: number): number => f32(Math.sqrt(f32(f32(x * x) + f32(y * y))));

/** `GradientTexture2D::_get_gradient_offset_at` (`gradient_texture.cpp:285`). */
function offsetAt(self: GradientTexture2D, x: number, y: number): number {
  const from = self.fill_from;
  const to = self.fill_to;
  if (from.x === to.x && from.y === to.y) return 0;
  let ofs = 0;
  const px = self.width > 1 ? f32(x / (self.width - 1)) : 0;
  const py = self.height > 1 ? f32(y / (self.height - 1)) : 0;
  const nx = f32(to.x - from.x);
  const ny = f32(to.y - from.y);
  if (self.fill === FILL_LINEAR) {
    // `Geometry2D::get_closest_point_to_segment_uncapped` (`core/math/geometry_2d.h:157`).
    const qx = f32(px - from.x);
    const qy = f32(py - from.y);
    const l2 = f32(f32(nx * nx) + f32(ny * ny));
    let cx = from.x;
    let cy = from.y;
    if (!(l2 < 1e-20)) {
      const d = f32(f32(f32(nx * qx) + f32(ny * qy)) / l2);
      cx = f32(from.x + f32(nx * d));
      cy = f32(from.y + f32(ny * d));
    }
    const rx = f32(cx - from.x);
    const ry = f32(cy - from.y);
    ofs = f32(length(rx, ry) / length(nx, ny));
    if (f32(f32(rx * nx) + f32(ry * ny)) < 0) ofs = -ofs;
  } else if (self.fill === FILL_RADIAL) {
    ofs = f32(length(f32(px - from.x), f32(py - from.y)) / length(nx, ny));
  } else if (self.fill === FILL_SQUARE) {
    ofs = f32(
      Math.max(Math.abs(f32(px - from.x)), Math.abs(f32(py - from.y))) / Math.max(Math.abs(nx), Math.abs(ny)),
    );
  } else if (self.fill === FILL_CONIC) {
    // `Vector2::angle_to` (`vector2.cpp:90`), then `Math::fposmod` in double over TAU.
    const vx = f32(px - from.x);
    const vy = f32(py - from.y);
    const angle = f32(Math.atan2(f32(f32(nx * vy) - f32(ny * vx)), f32(f32(nx * vx) + f32(ny * vy))));
    const tau = Math.PI * 2;
    let mod = angle % tau;
    if (mod < 0 !== tau < 0 && mod !== 0) mod += tau;
    ofs = f32(mod / tau);
  }
  if (self.repeat === REPEAT_NONE) {
    ofs = ofs < 0 ? 0 : ofs > 1 ? 1 : ofs;
  } else if (self.repeat === REPEAT) {
    ofs = f32(ofs % 1);
    if (ofs < 0) ofs = f32(1 + ofs);
  } else if (self.repeat === REPEAT_MIRROR) {
    ofs = f32(Math.abs(ofs) % 2);
    if (ofs > 1) ofs = f32(2 - ofs);
  }
  return ofs;
}

/** `Color::get_r8` and its siblings (`core/math/color.h:228`). */
function byte(value: number): number {
  const scaled = Math.round(f32(value * 255));
  return scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
}

/**
 * The image's RGBA8 bytes, row by row from the top (`GradientTexture2D::_update`,
 * `gradient_texture.cpp:231`): one colour where the gradient has at most one point.
 *
 * @godot GradientTexture2D (protocol)
 * @source scene/resources/gradient_texture.cpp:231
 */
export function godot_gradient_texture_2d_pixels(self: GradientTexture2D): Uint8Array {
  const data = new Uint8Array(self.width * self.height * 4);
  const gradient = self.gradient;
  if (gradient === null) return data;
  if (self.use_hdr) throw new Error('godot-compat: a high-dynamic-range GradientTexture2D is not transcribed.');
  const points = get_point_count(gradient);
  const put = (index: number, color: Color): void => {
    data[index * 4] = byte(color.r);
    data[index * 4 + 1] = byte(color.g);
    data[index * 4 + 2] = byte(color.b);
    data[index * 4 + 3] = byte(color.a);
  };
  for (let y = 0; y < self.height; y += 1) {
    for (let x = 0; x < self.width; x += 1) {
      const color = points <= 1 ? (points === 1 ? sample(gradient, 0) : ({ r: 0, g: 0, b: 0, a: 1 } as Color)) : sample(gradient, offsetAt(self, x, y));
      put(x + y * self.width, color);
    }
  }
  return data;
}

/**
 * The image as three draws it: a `DataTexture` of the bytes, sRGB, its rows bottom-up so the
 * image's first row is at `v = 1` as in three's image textures. Made once, remade after a change.
 *
 * @godot GradientTexture2D (protocol)
 * @source scene/resources/gradient_texture.cpp:231
 */
export function godot_gradient_texture_2d_texture(self: GradientTexture2D): DataTexture {
  if (self.texture !== null) return self.texture;
  const pixels = godot_gradient_texture_2d_pixels(self);
  const flipped = new Uint8Array(pixels.length);
  const row = self.width * 4;
  for (let y = 0; y < self.height; y += 1) flipped.set(pixels.subarray(y * row, (y + 1) * row), (self.height - 1 - y) * row);
  const texture = new DataTexture(flipped, self.width, self.height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  self.texture = texture;
  return texture;
}

function changed(self: GradientTexture2D): void {
  self.texture?.dispose();
  self.texture = null;
}

/**
 * @godot GradientTexture2D.set_gradient
 * @source scene/resources/gradient_texture.cpp:204
 */
export function set_gradient(self: GradientTexture2D, gradient: Gradient | null): void {
  self.gradient = gradient;
  changed(self);
}

/**
 * @godot GradientTexture2D.get_gradient
 * @source scene/resources/gradient_texture.cpp:219
 */
export function get_gradient(self: GradientTexture2D): Gradient | null {
  return self.gradient;
}

/**
 * A width outside 1 to 16384 fails and leaves it.
 *
 * @godot GradientTexture2D.set_width
 * @source scene/resources/gradient_texture.cpp:328
 */
export function set_width(self: GradientTexture2D, width: number): void {
  if (width <= 0 || width > 16384) return;
  self.width = width;
  changed(self);
}

/**
 * A height outside 1 to 16384 fails and leaves it.
 *
 * @godot GradientTexture2D.set_height
 * @source scene/resources/gradient_texture.cpp:339
 */
export function set_height(self: GradientTexture2D, height: number): void {
  if (height <= 0 || height > 16384) return;
  self.height = height;
  changed(self);
}

/**
 * @godot GradientTexture2D.set_fill_from
 * @source scene/resources/gradient_texture.cpp:363
 */
export function set_fill_from(self: GradientTexture2D, from: Vector2): void {
  self.fill_from = vector2(from);
  changed(self);
}

/**
 * @godot GradientTexture2D.get_fill_from
 * @source scene/resources/gradient_texture.cpp:369
 */
export function get_fill_from(self: GradientTexture2D): Vector2 {
  return self.fill_from;
}

/**
 * @godot GradientTexture2D.set_fill_to
 * @source scene/resources/gradient_texture.cpp:373
 */
export function set_fill_to(self: GradientTexture2D, to: Vector2): void {
  self.fill_to = vector2(to);
  changed(self);
}

/**
 * @godot GradientTexture2D.get_fill_to
 * @source scene/resources/gradient_texture.cpp:379
 */
export function get_fill_to(self: GradientTexture2D): Vector2 {
  return self.fill_to;
}

/**
 * @godot GradientTexture2D.set_fill
 * @source scene/resources/gradient_texture.cpp:383
 */
export function set_fill(self: GradientTexture2D, fill: number): void {
  self.fill = fill;
  changed(self);
}

/**
 * @godot GradientTexture2D.get_fill
 * @source scene/resources/gradient_texture.cpp:389
 */
export function get_fill(self: GradientTexture2D): number {
  return self.fill;
}

/**
 * @godot GradientTexture2D.set_repeat
 * @source scene/resources/gradient_texture.cpp:393
 */
export function set_repeat(self: GradientTexture2D, repeat: number): void {
  self.repeat = repeat;
  changed(self);
}

/**
 * @godot GradientTexture2D.get_repeat
 * @source scene/resources/gradient_texture.cpp:399
 */
export function get_repeat(self: GradientTexture2D): number {
  return self.repeat;
}

/**
 * A GradientTexture2D of the properties a scene states, set in the order given; an unknown one
 * fails by name.
 *
 * @godot GradientTexture2D (protocol)
 * @source scene/resources/gradient_texture.cpp:193
 */
export function godot_gradient_texture_2d_new(properties: Readonly<Record<string, unknown>> = {}): GradientTexture2D {
  const self = construct();
  const pair = (value: unknown): Vector2 => vector2(...(value as [number, number]));
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'gradient') set_gradient(self, value as Gradient | null);
    else if (property === 'width') set_width(self, value as number);
    else if (property === 'height') set_height(self, value as number);
    else if (property === 'fill') set_fill(self, value as number);
    else if (property === 'fillFrom') set_fill_from(self, pair(value));
    else if (property === 'fillTo') set_fill_to(self, pair(value));
    else if (property === 'repeat') set_repeat(self, value as number);
    else throw new Error(`godot-compat: GradientTexture2D has no ${property} property.`);
  }
  return self;
}
