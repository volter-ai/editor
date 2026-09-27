/**
 * @godot-class CurveTexture
 * @role BINDING
 *
 * Godot 4.7's `CurveTexture` (`scene/resources/curve_texture.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): an image `width` texels wide and one high whose texel
 * `i` is its curve's baked sample at `i / width` (`_update`, `:94`), stored as 32-bit floats, one
 * channel (`TEXTURE_MODE_RED`) or the value in all three (`TEXTURE_MODE_RGB`, the default); without
 * a curve every texel is 0. A particle process material samples it (`gpu-particles-3d.ts`).
 */

import { type Curve, sample_baked } from './curve';

const f32 = Math.fround;
/** `CurveTexture::TextureMode` (`curve_texture.h:41`). */
const TEXTURE_MODE_RGB = 0;
const TEXTURE_MODE_RED = 1;

export interface CurveTexture {
  curve: Curve | null;
  width: number;
  texture_mode: number;
}

/**
 * 256 texels wide, RGB (`curve_texture.h:48`).
 *
 * @godot CurveTexture.CurveTexture
 * @source scene/resources/curve_texture.h:48
 */
export function construct(): CurveTexture {
  return { curve: null, width: 256, texture_mode: TEXTURE_MODE_RGB };
}

/**
 * The image's texels (`CurveTexture::_update`): per texel the curve's baked sample at `i / width`,
 * repeated in three channels for `TEXTURE_MODE_RGB`.
 *
 * @godot CurveTexture (protocol)
 * @source scene/resources/curve_texture.cpp:94
 */
export function godot_curve_texture_pixels(self: CurveTexture): { readonly width: number; readonly height: number; readonly format: 'rgbf' | 'rf'; readonly data: Float32Array } {
  const channels = self.texture_mode === TEXTURE_MODE_RGB ? 3 : 1;
  const data = new Float32Array(self.width * channels);
  const curve = self.curve;
  if (curve !== null) {
    for (let i = 0; i < self.width; i += 1) {
      const t = f32(i / f32(self.width));
      const value = sample_baked(curve, t);
      for (let c = 0; c < channels; c += 1) data[i * channels + c] = value;
    }
  }
  return { width: self.width, height: 1, format: channels === 3 ? 'rgbf' : 'rf', data };
}

/**
 * A width outside 32 to 4096 fails and leaves it.
 *
 * @godot CurveTexture.set_width
 * @source scene/resources/curve_texture.cpp:54
 */
export function set_width(self: CurveTexture, p_width: number): void {
  if (p_width < 32 || p_width > 4096) return;
  self.width = p_width;
}

/**
 * The override of `Texture2D.get_width` (ClassDB binds it on `Texture2D`, not here).
 *
 * @godot CurveTexture (protocol)
 * @source scene/resources/curve_texture.cpp:65
 */
export function get_width(self: CurveTexture): number {
  return self.width;
}

/**
 * @godot CurveTexture.set_curve
 * @source scene/resources/curve_texture.cpp:81
 */
export function set_curve(self: CurveTexture, p_curve: Curve | null): void {
  self.curve = p_curve;
}

/**
 * @godot CurveTexture.get_curve
 * @source scene/resources/curve_texture.cpp:147
 */
export function get_curve(self: CurveTexture): Curve | null {
  return self.curve;
}

/**
 * A mode other than RGB and Red fails and leaves it.
 *
 * @godot CurveTexture.set_texture_mode
 * @source scene/resources/curve_texture.cpp:151
 */
export function set_texture_mode(self: CurveTexture, p_mode: number): void {
  if (p_mode < TEXTURE_MODE_RGB || p_mode > TEXTURE_MODE_RED) return;
  self.texture_mode = p_mode;
}

/**
 * @godot CurveTexture.get_texture_mode
 * @source scene/resources/curve_texture.cpp:159
 */
export function get_texture_mode(self: CurveTexture): number {
  return self.texture_mode;
}

/**
 * A CurveTexture of the properties a scene states; an unknown one fails by name.
 *
 * @godot CurveTexture (protocol)
 * @source scene/resources/curve_texture.cpp:37
 */
export function godot_curve_texture_new(properties: Readonly<Record<string, unknown>> = {}): CurveTexture {
  const self = construct();
  for (const [property, value] of Object.entries(properties)) {
    if (property === 'curve') set_curve(self, value as Curve | null);
    else if (property === 'width') set_width(self, value as number);
    else if (property === 'textureMode') set_texture_mode(self, value as number);
    else throw new Error(`godot-compat: CurveTexture has no ${property} property.`);
  }
  return self;
}
