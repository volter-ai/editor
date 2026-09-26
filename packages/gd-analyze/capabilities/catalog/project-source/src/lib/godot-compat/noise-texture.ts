/**
 * Godot 4.7 NoiseTexture2D/3D generation over Noise, Image, Pixi, and Three.
 * Generation order, defaults, and the Image::MAX_PIXELS capacity boundary follow
 * `modules/noise/noise_texture_{2d,3d}.cpp` and `core/io/image.h`.
 */

import { Data3DTexture, RedFormat, RGBAFormat, UnsignedByteType } from 'three';
import { GodotGradient } from './gradient';
import { createGodotImage, type GodotImage, IMAGE_FORMAT } from './image';
import { createGodotImageTexture, type GodotImageTexture } from './image-texture';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotConnection } from './signal';

interface NoiseResource {
  get_image(width: number, height: number, invert?: boolean, in3dSpace?: boolean, normalize?: boolean): GodotImage;
  get_seamless_image(width: number, height: number, invert?: boolean, in3dSpace?: boolean, skirt?: number, normalize?: boolean): GodotImage;
  get_image_3d(width: number, height: number, depth: number, invert?: boolean, normalize?: boolean): GodotImage[];
  get_seamless_image_3d(width: number, height: number, depth: number, invert?: boolean, skirt?: number, normalize?: boolean): GodotImage[];
}

const IMAGE_MAX_PIXELS = 268_435_456;

function assertNoisePixelCapacity(width: number, height: number, depth: number, resource: string): void {
  if (width > Math.floor(IMAGE_MAX_PIXELS / height / depth)) {
    throw new RangeError(`${resource} is too big; lower its width, height, or depth.`);
  }
}

function positiveInteger(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${member} requires a positive integer.`);
  }
  return value;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${member} requires a finite float.`);
  return value;
}

function resource<T extends object>(value: unknown, member: string): T | null {
  if (value === null) return null;
  if (typeof value !== 'object') throw new TypeError(`${member} requires a Resource or null.`);
  return value as T;
}

function replaceWatch(connection: GodotConnection | null, value: object | null, listener: () => void): GodotConnection | null {
  connection?.disconnect();
  return value === null ? null : godotResourceChangedSignal(value).connect(listener);
}

function luminance(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function modulateWithGradient(image: GodotImage, gradient: GodotGradient): GodotImage {
  const output = createGodotImage(image.width, image.height, false, IMAGE_FORMAT.FORMAT_RGBA8);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const pixel = image.get_pixel(x, y);
    output.set_pixel(x, y, gradient.sample(luminance(pixel.r, pixel.g, pixel.b)));
  }
  return output;
}

class QueuedGeneration<T> {
  private queued = false;
  private running = false;
  private error: unknown;
  private value: T;

  constructor(initial: T, private readonly generate: () => T, private readonly apply: (value: T) => void) {
    this.value = initial;
  }

  queue(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      if (!this.queued) return;
      this.flush();
    });
  }

  flush(): T {
    if (this.running) return this.value;
    if (this.queued) {
      this.queued = false;
      this.running = true;
      try {
        const next = this.generate();
        this.apply(next);
        this.value = next;
        this.error = undefined;
      } catch (error) {
        this.error = error;
      } finally {
        this.running = false;
      }
    }
    if (this.error !== undefined) throw this.error;
    return this.value;
  }
}

export interface GodotNoiseTexture2D extends GodotImageTexture {
  set_width(value: number): void;
  get_width(): number;
  set_height(value: number): void;
  get_height(): number;
  set_generate_mipmaps(value: boolean): void;
  is_generating_mipmaps(): boolean;
  set_noise(value: NoiseResource | null): void;
  get_noise(): NoiseResource | null;
  set_color_ramp(value: GodotGradient | null): void;
  get_color_ramp(): GodotGradient | null;
  set_seamless(value: boolean): void;
  get_seamless(): boolean;
  set_invert(value: boolean): void;
  get_invert(): boolean;
  set_in_3d_space(value: boolean): void;
  is_in_3d_space(): boolean;
  set_as_normal_map(value: boolean): void;
  is_normal_map(): boolean;
  set_normalize(value: boolean): void;
  is_normalized(): boolean;
  set_seamless_blend_skirt(value: number): void;
  get_seamless_blend_skirt(): number;
  set_bump_strength(value: number): void;
  get_bump_strength(): number;
  get_image(): GodotImage | null;
}

export function createGodotNoiseTexture2D(): GodotNoiseTexture2D {
  const initial = createGodotImage(1, 1, false, IMAGE_FORMAT.FORMAT_L8, [0]);
  const texture = createGodotImageTexture(initial) as GodotNoiseTexture2D;
  registerGodotObjectIdentity(texture, 'NoiseTexture2D');
  let width = 512;
  let height = 512;
  let generateMipmaps = true;
  let noise: NoiseResource | null = null;
  let colorRamp: GodotGradient | null = null;
  let seamless = false;
  let invert = false;
  let in3dSpace = false;
  let normalMap = false;
  let normalize = true;
  let skirt = 0.1;
  let bumpStrength = 8;
  let noiseChanged: GodotConnection | null = null;
  let rampChanged: GodotConnection | null = null;

  const generation = new QueuedGeneration<GodotImage | null>(null, () => {
    if (noise === null) return null;
    assertNoisePixelCapacity(width, height, 1, 'NoiseTexture2D');
    let image = seamless
      ? noise.get_seamless_image(width, height, invert, in3dSpace, skirt, normalize)
      : noise.get_image(width, height, invert, in3dSpace, normalize);
    if (colorRamp !== null) image = modulateWithGradient(image, colorRamp);
    if (normalMap) image.bump_map_to_normal_map(bumpStrength);
    if (generateMipmaps) image.generate_mipmaps();
    return image;
  }, (image) => {
    if (image !== null) texture.set_image(image);
    godotResourceEmitChanged(texture);
  });
  const queue = (): void => generation.queue();
  const setBool = (value: unknown, member: string, current: boolean, assign: (next: boolean) => void): void => {
    const next = boolean(value, member);
    if (next === current) return;
    assign(next);
    queue();
  };

  Object.assign(texture, {
    set_width(value: number) { const next = positiveInteger(value, 'NoiseTexture2D.width'); assertNoisePixelCapacity(next, height, 1, 'NoiseTexture2D'); if (next === width) return; width = next; queue(); },
    get_width: () => width,
    set_height(value: number) { const next = positiveInteger(value, 'NoiseTexture2D.height'); assertNoisePixelCapacity(width, next, 1, 'NoiseTexture2D'); if (next === height) return; height = next; queue(); },
    get_height: () => height,
    set_generate_mipmaps(value: boolean) { setBool(value, 'NoiseTexture2D.generate_mipmaps', generateMipmaps, (next) => { generateMipmaps = next; }); },
    is_generating_mipmaps: () => generateMipmaps,
    set_noise(value: NoiseResource | null) {
      const next = resource<NoiseResource>(value, 'NoiseTexture2D.noise');
      if (next === noise) return;
      noiseChanged = replaceWatch(noiseChanged, next, queue);
      noise = next;
      queue();
    },
    get_noise: () => noise,
    set_color_ramp(value: GodotGradient | null) {
      const next = resource<GodotGradient>(value, 'NoiseTexture2D.color_ramp');
      if (next === colorRamp) return;
      rampChanged = replaceWatch(rampChanged, next, queue);
      colorRamp = next;
      queue();
    },
    get_color_ramp: () => colorRamp,
    set_seamless(value: boolean) { setBool(value, 'NoiseTexture2D.seamless', seamless, (next) => { seamless = next; }); },
    get_seamless: () => seamless,
    set_invert(value: boolean) { setBool(value, 'NoiseTexture2D.invert', invert, (next) => { invert = next; }); },
    get_invert: () => invert,
    set_in_3d_space(value: boolean) { setBool(value, 'NoiseTexture2D.in_3d_space', in3dSpace, (next) => { in3dSpace = next; }); },
    is_in_3d_space: () => in3dSpace,
    set_as_normal_map(value: boolean) { setBool(value, 'NoiseTexture2D.as_normal_map', normalMap, (next) => { normalMap = next; }); },
    is_normal_map: () => normalMap,
    set_normalize(value: boolean) { setBool(value, 'NoiseTexture2D.normalize', normalize, (next) => { normalize = next; }); },
    is_normalized: () => normalize,
    set_seamless_blend_skirt(value: number) { const next = finite(value, 'NoiseTexture2D.seamless_blend_skirt'); if (next < 0 || next > 1) throw new RangeError('NoiseTexture2D.seamless_blend_skirt must be 0..1.'); if (next === skirt) return; skirt = next; queue(); },
    get_seamless_blend_skirt: () => skirt,
    set_bump_strength(value: number) { const next = finite(value, 'NoiseTexture2D.bump_strength'); if (next === bumpStrength) return; bumpStrength = next; if (normalMap) queue(); },
    get_bump_strength: () => bumpStrength,
    get_image: () => generation.flush(),
    has_alpha: () => false,
  });
  bindGodotResourceProtocol(texture, {
    createDuplicate(source) {
      const duplicate = createGodotNoiseTexture2D();
      duplicate.set_width(source.get_width());
      duplicate.set_height(source.get_height());
      duplicate.set_generate_mipmaps(source.is_generating_mipmaps());
      duplicate.set_noise(source.get_noise());
      duplicate.set_color_ramp(source.get_color_ramp());
      duplicate.set_seamless(source.get_seamless());
      duplicate.set_invert(source.get_invert());
      duplicate.set_in_3d_space(source.is_in_3d_space());
      duplicate.set_as_normal_map(source.is_normal_map());
      duplicate.set_normalize(source.is_normalized());
      duplicate.set_seamless_blend_skirt(source.get_seamless_blend_skirt());
      duplicate.set_bump_strength(source.get_bump_strength());
      return duplicate;
    },
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      const sourceNoise = source.get_noise();
      const sourceRamp = source.get_color_ramp();
      target.set_noise(sourceNoise === null ? null : duplicateGodotSubresource(sourceNoise, memo));
      target.set_color_ramp(sourceRamp === null ? null : duplicateGodotSubresource(sourceRamp, memo));
    },
  });
  generation.queue();
  return texture;
}

export interface GodotNoiseTexture extends GodotNoiseTexture2D {
  set_as_normalmap(value: boolean): void;
  is_normalmap(): boolean;
}

/** Godot 3 `NoiseTexture`, retaining the same native Pixi/Three texture and generation pipeline. */
export function createGodotNoiseTexture(): GodotNoiseTexture {
  const texture = createGodotNoiseTexture2D() as GodotNoiseTexture;
  registerGodotObjectIdentity(texture, 'NoiseTexture');
  Object.assign(texture, {
    set_as_normalmap: texture.set_as_normal_map.bind(texture),
    is_normalmap: texture.is_normal_map.bind(texture),
  });
  bindGodotResourceProtocol(texture, {
    createDuplicate(source) {
      const duplicate = createGodotNoiseTexture();
      duplicate.set_width(source.get_width());
      duplicate.set_height(source.get_height());
      duplicate.set_generate_mipmaps(source.is_generating_mipmaps());
      duplicate.set_noise(source.get_noise());
      duplicate.set_seamless(source.get_seamless());
      duplicate.set_invert(source.get_invert());
      duplicate.set_in_3d_space(source.is_in_3d_space());
      duplicate.set_as_normalmap(source.is_normalmap());
      duplicate.set_normalize(source.is_normalized());
      duplicate.set_seamless_blend_skirt(source.get_seamless_blend_skirt());
      duplicate.set_bump_strength(source.get_bump_strength());
      return duplicate;
    },
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      const sourceNoise = source.get_noise();
      target.set_noise(sourceNoise === null ? null : duplicateGodotSubresource(sourceNoise, memo));
    },
  });
  return texture;
}

export interface GodotNoiseTexture3D extends Data3DTexture {
  set_width(value: number): void;
  get_width(): number;
  set_height(value: number): void;
  get_height(): number;
  set_depth(value: number): void;
  get_depth(): number;
  set_noise(value: NoiseResource | null): void;
  get_noise(): NoiseResource | null;
  set_color_ramp(value: GodotGradient | null): void;
  get_color_ramp(): GodotGradient | null;
  set_seamless(value: boolean): void;
  get_seamless(): boolean;
  set_invert(value: boolean): void;
  get_invert(): boolean;
  set_normalize(value: boolean): void;
  is_normalized(): boolean;
  set_seamless_blend_skirt(value: number): void;
  get_seamless_blend_skirt(): number;
  get_data(): GodotImage[];
  get_format(): number;
  has_mipmaps(): false;
}

export function createGodotNoiseTexture3D(): GodotNoiseTexture3D {
  const texture = new Data3DTexture(new Uint8Array([0]), 1, 1, 1) as GodotNoiseTexture3D;
  texture.format = RedFormat;
  texture.type = UnsignedByteType;
  texture.needsUpdate = true;
  registerGodotObjectIdentity(texture, 'NoiseTexture3D');
  let width = 64;
  let height = 64;
  let depth = 64;
  let noise: NoiseResource | null = null;
  let colorRamp: GodotGradient | null = null;
  let seamless = false;
  let invert = false;
  let normalize = true;
  let skirt = 0.1;
  let noiseChanged: GodotConnection | null = null;
  let rampChanged: GodotConnection | null = null;
  let imageFormat: number = IMAGE_FORMAT.FORMAT_L8;
  const generation = new QueuedGeneration<GodotImage[]>([], () => {
    if (noise === null) return [];
    assertNoisePixelCapacity(width, height, depth, 'NoiseTexture3D');
    let images = seamless
      ? noise.get_seamless_image_3d(width, height, depth, invert, skirt, normalize)
      : noise.get_image_3d(width, height, depth, invert, normalize);
    if (colorRamp !== null) images = images.map((image) => modulateWithGradient(image, colorRamp!));
    return images;
  }, (images) => {
    if (images.length > 0) {
      imageFormat = images[0]!.format;
      if (imageFormat !== IMAGE_FORMAT.FORMAT_L8 && imageFormat !== IMAGE_FORMAT.FORMAT_RGBA8) {
        throw new Error(`NoiseTexture3D native texture cannot preserve Image format ${imageFormat}.`);
      }
      const channels = imageFormat === IMAGE_FORMAT.FORMAT_L8 ? 1 : 4;
      const data = new Uint8Array(width * height * images.length * channels);
      images.forEach((image, index) => data.set(image.get_data(), index * width * height * channels));
      texture.image = { data, width, height, depth: images.length };
      texture.format = channels === 1 ? RedFormat : RGBAFormat;
      texture.needsUpdate = true;
    }
    godotResourceEmitChanged(texture);
  });
  const queue = (): void => generation.queue();
  Object.assign(texture, {
    set_width(value: number) { const next = positiveInteger(value, 'NoiseTexture3D.width'); assertNoisePixelCapacity(next, height, depth, 'NoiseTexture3D'); if (next === width) return; width = next; queue(); },
    get_width: () => width,
    set_height(value: number) { const next = positiveInteger(value, 'NoiseTexture3D.height'); assertNoisePixelCapacity(width, next, depth, 'NoiseTexture3D'); if (next === height) return; height = next; queue(); },
    get_height: () => height,
    set_depth(value: number) { const next = positiveInteger(value, 'NoiseTexture3D.depth'); assertNoisePixelCapacity(width, height, next, 'NoiseTexture3D'); if (next === depth) return; depth = next; queue(); },
    get_depth: () => depth,
    set_noise(value: NoiseResource | null) { const next = resource<NoiseResource>(value, 'NoiseTexture3D.noise'); if (next === noise) return; noiseChanged = replaceWatch(noiseChanged, next, queue); noise = next; queue(); },
    get_noise: () => noise,
    set_color_ramp(value: GodotGradient | null) { const next = resource<GodotGradient>(value, 'NoiseTexture3D.color_ramp'); if (next === colorRamp) return; rampChanged = replaceWatch(rampChanged, next, queue); colorRamp = next; queue(); },
    get_color_ramp: () => colorRamp,
    set_seamless(value: boolean) { const next = boolean(value, 'NoiseTexture3D.seamless'); if (next === seamless) return; seamless = next; queue(); },
    get_seamless: () => seamless,
    set_invert(value: boolean) { const next = boolean(value, 'NoiseTexture3D.invert'); if (next === invert) return; invert = next; queue(); },
    get_invert: () => invert,
    set_normalize(value: boolean) { const next = boolean(value, 'NoiseTexture3D.normalize'); if (next === normalize) return; normalize = next; queue(); },
    is_normalized: () => normalize,
    set_seamless_blend_skirt(value: number) { const next = finite(value, 'NoiseTexture3D.seamless_blend_skirt'); if (next < 0.05 || next > 1) throw new RangeError('NoiseTexture3D.seamless_blend_skirt must be 0.05..1.'); if (next === skirt) return; skirt = next; queue(); },
    get_seamless_blend_skirt: () => skirt,
    get_data: () => generation.flush(),
    get_format: () => imageFormat,
    has_mipmaps: () => false as const,
  });
  bindGodotResourceProtocol(texture, {
    createDuplicate(source) {
      const duplicate = createGodotNoiseTexture3D();
      duplicate.set_width(source.get_width());
      duplicate.set_height(source.get_height());
      duplicate.set_depth(source.get_depth());
      duplicate.set_noise(source.get_noise());
      duplicate.set_color_ramp(source.get_color_ramp());
      duplicate.set_seamless(source.get_seamless());
      duplicate.set_invert(source.get_invert());
      duplicate.set_normalize(source.is_normalized());
      duplicate.set_seamless_blend_skirt(source.get_seamless_blend_skirt());
      return duplicate;
    },
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      const sourceNoise = source.get_noise();
      const sourceRamp = source.get_color_ramp();
      target.set_noise(sourceNoise === null ? null : duplicateGodotSubresource(sourceNoise, memo));
      target.set_color_ramp(sourceRamp === null ? null : duplicateGodotSubresource(sourceRamp, memo));
    },
  });
  generation.queue();
  return texture;
}
