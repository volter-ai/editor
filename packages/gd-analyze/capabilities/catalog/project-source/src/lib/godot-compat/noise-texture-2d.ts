/**
 * @godot-class NoiseTexture2D
 * @role BINDING
 *
 * Godot 4.7's `NoiseTexture2D` (`modules/noise/noise_texture_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its noise's greyscale image, seamless where it says
 * (`NoiseTexture2D::_generate_texture`, `noise_texture_2d.cpp:155`), drawn as a three
 * `DataTexture` that is the texture itself, so a material or shader samples it as it samples any
 * image. The image is remade when a setting or the noise changes; Godot makes it on a thread and
 * this makes it at once. Greyscale samples as `(l, l, l, 1)`, as Godot's `FORMAT_L8` does. A color
 * ramp and a normal map are not bound.
 */

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType } from 'three';
import type { Image } from './image';
import { get_image as noise_image, get_seamless_image, type Noise } from './noise';
import { godot_texture_2d_emit_changed, godot_texture_2d_image, godot_texture_2d_size } from './texture-2d';

interface NoiseTextureState {
  noise: Noise | null;
  width: number;
  height: number;
  invert: boolean;
  in_3d_space: boolean;
  generate_mipmaps: boolean;
  seamless: boolean;
  seamless_blend_skirt: number;
  normalize: boolean;
  image: Image | null;
  /** Remakes the image when the noise changes. */
  readonly listener: () => void;
  /** Set while a scene's properties are applied: the image is made once, after them. */
  building: boolean;
}

const STATES = new WeakMap<DataTexture, NoiseTextureState>();

function stateOf(self: DataTexture): NoiseTextureState {
  const state = STATES.get(self);
  if (state === undefined) throw new TypeError('godot-compat: a texture that is no NoiseTexture2D');
  return state;
}

/** The image's greyscale as three's RGBA bytes. */
function rgba(image: Image | null, width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const grey = image?.levels[0];
  for (let i = 0; i < width * height; i += 1) {
    const value = grey?.[i] ?? 0;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return data;
}

/**
 * Makes the image from the noise and hands it to three (`NoiseTexture2D::_update_texture`,
 * `noise_texture_2d.cpp:208`): a texture without a noise is blank.
 */
function update(self: DataTexture): void {
  const state = stateOf(self);
  if (state.building) return;
  const noise = state.noise;
  state.image =
    noise === null
      ? null
      : state.seamless
        ? get_seamless_image(noise, state.width, state.height, state.invert, state.in_3d_space, state.seamless_blend_skirt, state.normalize)
        : noise_image(noise, state.width, state.height, state.invert, state.in_3d_space, state.normalize);
  const current = self.image as { readonly width: number; readonly height: number };
  // A new size is a new GPU texture.
  if (current.width !== state.width || current.height !== state.height) self.dispose();
  self.image = { data: rgba(state.image, state.width, state.height), width: state.width, height: state.height };
  self.generateMipmaps = state.generate_mipmaps;
  self.minFilter = state.generate_mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  self.needsUpdate = true;
  godot_texture_2d_emit_changed(self);
}

/**
 * 512 by 512, normalized, mipmapped, without a noise (`noise_texture_2d.h:54`).
 *
 * @godot NoiseTexture2D.NoiseTexture2D
 * @source modules/noise/noise_texture_2d.cpp:37
 */
export function construct(): DataTexture {
  const texture = new DataTexture(new Uint8Array(512 * 512 * 4), 512, 512, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  const state: NoiseTextureState = {
    noise: null,
    width: 512,
    height: 512,
    invert: false,
    in_3d_space: false,
    generate_mipmaps: true,
    seamless: false,
    seamless_blend_skirt: 0.1,
    normalize: true,
    image: null,
    listener: () => update(texture),
    building: false,
  };
  STATES.set(texture, state);
  godot_texture_2d_size(texture, () => [state.width, state.height]);
  godot_texture_2d_image(texture, () => state.image);
  texture.needsUpdate = true;
  return texture;
}

/**
 * @godot NoiseTexture2D.set_noise
 * @source modules/noise/noise_texture_2d.cpp:224
 */
export function set_noise(self: DataTexture, noise: Noise | null): void {
  const state = stateOf(self);
  if (noise === state.noise) return;
  state.noise?.listeners.delete(state.listener);
  state.noise = noise;
  noise?.listeners.add(state.listener);
  update(self);
}

/**
 * @godot NoiseTexture2D.get_noise
 * @source modules/noise/noise_texture_2d.cpp:238
 */
export function get_noise(self: DataTexture): Noise | null {
  return stateOf(self).noise;
}

/**
 * A width below 1 fails and leaves it.
 *
 * @godot NoiseTexture2D.set_width
 * @source modules/noise/noise_texture_2d.cpp:242
 */
export function set_width(self: DataTexture, width: number): void {
  const state = stateOf(self);
  if (width <= 0 || width === state.width) return;
  state.width = width;
  update(self);
}

/**
 * A height below 1 fails and leaves it.
 *
 * @godot NoiseTexture2D.set_height
 * @source modules/noise/noise_texture_2d.cpp:251
 */
export function set_height(self: DataTexture, height: number): void {
  const state = stateOf(self);
  if (height <= 0 || height === state.height) return;
  state.height = height;
  update(self);
}

/**
 * @godot NoiseTexture2D.set_invert
 * @source modules/noise/noise_texture_2d.cpp:260
 */
export function set_invert(self: DataTexture, invert: boolean): void {
  const state = stateOf(self);
  if (invert === state.invert) return;
  state.invert = invert;
  update(self);
}

/**
 * @godot NoiseTexture2D.get_invert
 * @source modules/noise/noise_texture_2d.cpp:268
 */
export function get_invert(self: DataTexture): boolean {
  return stateOf(self).invert;
}

/**
 * @godot NoiseTexture2D.set_in_3d_space
 * @source modules/noise/noise_texture_2d.cpp:272
 */
export function set_in_3d_space(self: DataTexture, enable: boolean): void {
  const state = stateOf(self);
  if (enable === state.in_3d_space) return;
  state.in_3d_space = enable;
  update(self);
}

/**
 * @godot NoiseTexture2D.is_in_3d_space
 * @source modules/noise/noise_texture_2d.cpp:279
 */
export function is_in_3d_space(self: DataTexture): boolean {
  return stateOf(self).in_3d_space;
}

/**
 * @godot NoiseTexture2D.set_generate_mipmaps
 * @source modules/noise/noise_texture_2d.cpp:283
 */
export function set_generate_mipmaps(self: DataTexture, enable: boolean): void {
  const state = stateOf(self);
  if (enable === state.generate_mipmaps) return;
  state.generate_mipmaps = enable;
  update(self);
}

/**
 * @godot NoiseTexture2D.is_generating_mipmaps
 * @source modules/noise/noise_texture_2d.cpp:291
 */
export function is_generating_mipmaps(self: DataTexture): boolean {
  return stateOf(self).generate_mipmaps;
}

/**
 * @godot NoiseTexture2D.set_seamless
 * @source modules/noise/noise_texture_2d.cpp:295
 */
export function set_seamless(self: DataTexture, seamless: boolean): void {
  const state = stateOf(self);
  if (seamless === state.seamless) return;
  state.seamless = seamless;
  update(self);
}

/**
 * @godot NoiseTexture2D.get_seamless
 * @source modules/noise/noise_texture_2d.cpp:304
 */
export function get_seamless(self: DataTexture): boolean {
  return stateOf(self).seamless;
}

/**
 * A skirt outside 0 to 1 fails and leaves it.
 *
 * @godot NoiseTexture2D.set_seamless_blend_skirt
 * @source modules/noise/noise_texture_2d.cpp:308
 */
export function set_seamless_blend_skirt(self: DataTexture, blend_skirt: number): void {
  const state = stateOf(self);
  if (blend_skirt < 0 || blend_skirt > 1 || blend_skirt === state.seamless_blend_skirt) return;
  state.seamless_blend_skirt = blend_skirt;
  update(self);
}

/**
 * @godot NoiseTexture2D.get_seamless_blend_skirt
 * @source modules/noise/noise_texture_2d.cpp:317
 */
export function get_seamless_blend_skirt(self: DataTexture): number {
  return stateOf(self).seamless_blend_skirt;
}

/**
 * @godot NoiseTexture2D.set_normalize
 * @source modules/noise/noise_texture_2d.cpp:362
 */
export function set_normalize(self: DataTexture, normalize: boolean): void {
  const state = stateOf(self);
  if (normalize === state.normalize) return;
  state.normalize = normalize;
  update(self);
}

/**
 * @godot NoiseTexture2D.is_normalized
 * @source modules/noise/noise_texture_2d.cpp:370
 */
export function is_normalized(self: DataTexture): boolean {
  return stateOf(self).normalize;
}

const SETTERS: Readonly<Record<string, (self: DataTexture, value: never) => void>> = {
  noise: set_noise,
  width: set_width,
  height: set_height,
  invert: set_invert,
  in3dSpace: set_in_3d_space,
  generateMipmaps: set_generate_mipmaps,
  seamless: set_seamless,
  seamlessBlendSkirt: set_seamless_blend_skirt,
  normalize: set_normalize,
};

/**
 * A NoiseTexture2D of the properties a scene states, its image made once they are applied; an
 * unknown one fails by name.
 *
 * @godot NoiseTexture2D (protocol)
 * @source modules/noise/noise_texture_2d.cpp:37
 */
export function godot_noise_texture_2d_new(properties: Readonly<Record<string, unknown>> = {}): DataTexture {
  const self = construct();
  const state = stateOf(self);
  state.building = true;
  for (const [property, value] of Object.entries(properties)) {
    const setter = SETTERS[property];
    if (setter === undefined) throw new Error(`godot-compat: NoiseTexture2D has no ${property} property.`);
    setter(self, value as never);
  }
  state.building = false;
  update(self);
  return self;
}
