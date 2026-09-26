/**
 * @godot-class GradientTexture1D
 * @role BINDING
 *
 * Godot 4.7's `GradientTexture1D` (`scene/resources/gradient_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): an image `width` pixels wide and one high whose
 * pixel `i` is its gradient sampled at `i / (width - 1)`, stored as 8-bit RGBA and drawn as a three
 * `DataTexture`. High-dynamic-range images are not transcribed.
 */

import { DataTexture, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { type Gradient, sample } from './gradient';

const f32 = Math.fround;

export interface GradientTexture1D {
  gradient: Gradient | null;
  width: number;
  use_hdr: boolean;
  texture: DataTexture | null;
}

/**
 * 256 pixels wide (`gradient_texture.h:43`).
 *
 * @godot GradientTexture1D (protocol)
 * @source scene/resources/gradient_texture.cpp:38
 */
export function construct(): GradientTexture1D {
  return { gradient: null, width: 256, use_hdr: false, texture: null };
}

/** `Color::get_r8` and its siblings (`core/math/color.h:228`). */
function byte(value: number): number {
  const scaled = Math.round(f32(value * 255));
  return scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
}

/**
 * The image's RGBA8 bytes (`GradientTexture1D::_update`).
 *
 * @godot GradientTexture1D (protocol)
 * @source scene/resources/gradient_texture.cpp:91
 */
export function godot_gradient_texture_1d_pixels(self: GradientTexture1D): Uint8Array {
  const data = new Uint8Array(self.width * 4);
  const gradient = self.gradient;
  if (gradient === null) return data;
  if (self.use_hdr) throw new Error('godot-compat: a high-dynamic-range GradientTexture1D is not transcribed.');
  for (let i = 0; i < self.width; i += 1) {
    const color = sample(gradient, f32(i / (self.width - 1)));
    data[i * 4] = byte(color.r);
    data[i * 4 + 1] = byte(color.g);
    data[i * 4 + 2] = byte(color.b);
    data[i * 4 + 3] = byte(color.a);
  }
  return data;
}

/**
 * The image as three draws it: a `DataTexture` of the bytes, sRGB. Made once, remade after a change.
 *
 * @godot GradientTexture1D (protocol)
 * @source scene/resources/gradient_texture.cpp:91
 */
export function godot_gradient_texture_1d_texture(self: GradientTexture1D): DataTexture {
  if (self.texture !== null) return self.texture;
  const texture = new DataTexture(godot_gradient_texture_1d_pixels(self), self.width, 1, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  self.texture = texture;
  return texture;
}

/**
 * @godot GradientTexture1D.set_gradient
 * @source scene/resources/gradient_texture.cpp:64
 */
export function set_gradient(self: GradientTexture1D, gradient: Gradient | null): void {
  self.gradient = gradient;
  self.texture?.dispose();
  self.texture = null;
}

/**
 * @godot GradientTexture1D.get_gradient
 * @source scene/resources/gradient_texture.cpp:79
 */
export function get_gradient(self: GradientTexture1D): Gradient | null {
  return self.gradient;
}

/**
 * A width outside 1 to 16384 fails and leaves it.
 *
 * @godot GradientTexture1D.set_width
 * @source scene/resources/gradient_texture.cpp:145
 */
export function set_width(self: GradientTexture1D, width: number): void {
  if (width <= 0 || width > 16384) return;
  self.width = width;
  self.texture?.dispose();
  self.texture = null;
}

/**
 * A GradientTexture1D of the properties a scene states; an unknown one fails by name.
 *
 * @godot GradientTexture1D (protocol)
 * @source scene/resources/gradient_texture.cpp:38
 */
export function godot_gradient_texture_1d_new(properties: Readonly<Record<string, unknown>> = {}): GradientTexture1D {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'gradient') set_gradient(self, value as Gradient | null);
    else if (property === 'width') set_width(self, value as number);
    else throw new Error(`godot-compat: GradientTexture1D has no ${property} property.`);
  }
  return self;
}
