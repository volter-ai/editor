/** Godot procedural Texture Resources over the retained Image/Pixi/Three texture identity. */

import { createGodotCurve, type GodotCurve } from './curve';
import { GodotGradient } from './gradient';
import { createGodotImage, type GodotImage, IMAGE_FORMAT } from './image';
import { createGodotFloatImageTexture, type GodotImageTexture } from './image-texture';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotConnection } from './signal';
import { type Vector2, vec2 } from './vector2';

export const GRADIENT_FILL_LINEAR = 0;
export const GRADIENT_FILL_RADIAL = 1;
export const GRADIENT_FILL_SQUARE = 2;
export const GRADIENT_FILL_CONIC = 3;
export const GRADIENT_REPEAT_NONE = 0;
export const GRADIENT_REPEAT = 1;
export const GRADIENT_REPEAT_MIRROR = 2;
export const CURVE_TEXTURE_MODE_RGB = 0;
export const CURVE_TEXTURE_MODE_RED = 1;

export interface GodotGradientTexture1D extends GodotImageTexture {
  set_gradient(value: GodotGradient | null): void;
  get_gradient(): GodotGradient | null;
  set_width(value: number): void;
  get_width(): number;
  get_height(): number;
  set_use_hdr(value: boolean): void;
  is_using_hdr(): boolean;
  get_image(): GodotImage | null;
  update_now(): void;
}

export interface GodotGradientTexture2D extends GodotGradientTexture1D {
  set_height(value: number): void;
  set_fill(value: number): void;
  get_fill(): number;
  set_fill_from(value: Vector2): void;
  get_fill_from(): Vector2;
  set_fill_to(value: Vector2): void;
  get_fill_to(): Vector2;
  set_repeat(value: number): void;
  get_repeat(): number;
}

export interface GodotCurveTexture extends GodotImageTexture {
  set_width(value: number): void;
  get_width(): number;
  get_height(): number;
  set_texture_mode(value: number): void;
  get_texture_mode(): number;
  set_curve(value: GodotCurve | null): void;
  get_curve(): GodotCurve | null;
  ensure_default_setup(minimum?: number, maximum?: number): void;
  get_image(): GodotImage;
}

export interface GodotCurveXYZTexture extends GodotImageTexture {
  set_width(value: number): void;
  get_width(): number;
  get_height(): number;
  set_curve_x(value: GodotCurve | null): void;
  get_curve_x(): GodotCurve | null;
  set_curve_y(value: GodotCurve | null): void;
  get_curve_y(): GodotCurve | null;
  set_curve_z(value: GodotCurve | null): void;
  get_curve_z(): GodotCurve | null;
  ensure_default_setup(minimum?: number, maximum?: number): void;
  get_image(): GodotImage;
}

type MutableImageTexture = GodotImageTexture & Record<string, unknown>;

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires an integer in ${minimum}..${maximum}.`);
  }
  return value;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function vector2(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${member} requires Vector2.`);
  const input = value as Partial<Vector2>;
  if (typeof input.x !== 'number' || !Number.isFinite(input.x) || typeof input.y !== 'number' || !Number.isFinite(input.y)) {
    throw new TypeError(`${member} requires a finite Vector2.`);
  }
  return vec2(input.x, input.y);
}

function fposmod(value: number, modulus: number): number {
  const result = value % modulus;
  return result < 0 ? result + modulus : result;
}

function byte(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function blankImage(): GodotImage {
  return createGodotImage(1, 1, false, IMAGE_FORMAT.FORMAT_RGBA8, [0, 0, 0, 255]);
}

class DeferredTextureUpdate {
  private queued = false;
  private updating = false;
  private image: GodotImage | null = null;

  constructor(
    readonly native: MutableImageTexture,
    private readonly generate: () => GodotImage | null,
    private readonly afterUpdate?: () => void,
  ) {}

  queue(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => {
      if (this.queued) this.flush();
    });
  }

  flush(): GodotImage | null {
    if (!this.queued || this.updating) return this.image;
    this.queued = false;
    this.updating = true;
    try {
      const image = this.generate();
      this.image = image;
      if (image !== null) this.native.set_image(image);
      this.afterUpdate?.();
      return image;
    } finally {
      this.updating = false;
    }
  }

  getImage(): GodotImage | null {
    this.flush();
    if (this.image === null) return null;
    return createGodotImage(this.image.width, this.image.height, this.image.has_mipmaps(), this.image.format, this.image.get_data());
  }
}

function textureResource(className: string): MutableImageTexture {
  const texture = createGodotFloatImageTexture(blankImage()) as MutableImageTexture;
  registerGodotObjectIdentity(texture, className);
  return texture;
}

function watchResource(
  previous: GodotConnection | null,
  value: object | null,
  update: () => void,
): GodotConnection | null {
  previous?.disconnect();
  return value === null ? null : godotResourceChangedSignal(value).connect(update);
}

function makeGradientTexture1D(major: 3 | 4): GodotGradientTexture1D {
  const className = major === 3 ? 'GradientTexture' : 'GradientTexture1D';
  const texture = textureResource(className);
  let gradient: GodotGradient | null = null;
  let gradientChanged: GodotConnection | null = null;
  let width = major === 3 ? 2048 : 256;
  let useHdr = false;
  const update = new DeferredTextureUpdate(texture, () => {
    if (gradient === null) return null;
    const format = useHdr ? IMAGE_FORMAT.FORMAT_RGBAF : IMAGE_FORMAT.FORMAT_RGBA8;
    const image = createGodotImage(width, 1, false, format);
    for (let x = 0; x < width; x += 1) image.set_pixel(x, 0, gradient.sample(x / (width - 1)));
    return image;
  }, () => godotResourceEmitChanged(texture));
  const changed = (): void => { if (major === 4) godotResourceEmitChanged(texture); };
  const methods = {
    set_gradient(value: GodotGradient | null) {
      if (value === gradient) return;
      gradientChanged = watchResource(gradientChanged, value, () => {
        update.queue();
        if (major === 3) update.flush();
      });
      gradient = value;
      update.queue();
      if (major === 3) update.flush();
      godotResourceEmitChanged(texture);
    },
    get_gradient: () => gradient,
    set_width(value: number) {
      width = major === 3
        ? integer(value, 'GradientTexture.width', 1, Number.MAX_SAFE_INTEGER)
        : integer(value, 'GradientTexture1D.width', 1, 16384);
      update.queue();
      changed();
    },
    get_width: () => width,
    get_height: () => 1,
    set_use_hdr(value: boolean) { const next = bool(value, `${className}.use_hdr`); if (next === useHdr) return; useHdr = next; update.queue(); changed(); },
    is_using_hdr: () => useHdr,
    get_image: () => update.getImage(),
    update_now: () => { update.flush(); },
    has_alpha: () => true,
  };
  const result = Object.assign(texture, methods);
  bindGodotResourceProtocol<GodotGradientTexture1D>(result, {
    createDuplicate() {
      return makeGradientTexture1D(major);
    },
    populateDuplicate(source, target, subresources, memo) {
      const sourceGradient = source.get_gradient();
      target.set_gradient(subresources ? duplicateGodotSubresource(sourceGradient, memo) : sourceGradient);
      target.set_width(source.get_width());
      if (major === 4) target.set_use_hdr(source.is_using_hdr());
      target.update_now();
    },
  });
  update.queue();
  return result;
}

function gradientOffset(
  x: number,
  y: number,
  width: number,
  height: number,
  from: Vector2,
  to: Vector2,
  fill: number,
  repeat: number,
): number {
  if (from.x === to.x && from.y === to.y) return 0;
  const position = vec2(width > 1 ? x / (width - 1) : 0, height > 1 ? y / (height - 1) : 0);
  const axisX = to.x - from.x;
  const axisY = to.y - from.y;
  let offset = 0;
  if (fill === GRADIENT_FILL_LINEAR) {
    const lengthSquared = axisX * axisX + axisY * axisY;
    const projection = ((position.x - from.x) * axisX + (position.y - from.y) * axisY) / lengthSquared;
    const closestX = from.x + axisX * projection;
    const closestY = from.y + axisY * projection;
    offset = Math.hypot(closestX - from.x, closestY - from.y) / Math.sqrt(lengthSquared);
    if ((closestX - from.x) * axisX + (closestY - from.y) * axisY < 0) offset *= -1;
  } else if (fill === GRADIENT_FILL_RADIAL) {
    offset = Math.hypot(position.x - from.x, position.y - from.y) / Math.hypot(axisX, axisY);
  } else if (fill === GRADIENT_FILL_SQUARE) {
    offset = Math.max(Math.abs(position.x - from.x), Math.abs(position.y - from.y)) /
      Math.max(Math.abs(axisX), Math.abs(axisY));
  } else {
    const cross = axisX * (position.y - from.y) - axisY * (position.x - from.x);
    const dot = axisX * (position.x - from.x) + axisY * (position.y - from.y);
    offset = fposmod(Math.atan2(cross, dot), Math.PI * 2) / (Math.PI * 2);
  }
  if (repeat === GRADIENT_REPEAT_NONE) return Math.max(0, Math.min(1, offset));
  if (repeat === GRADIENT_REPEAT) return fposmod(offset, 1);
  const mirrored = Math.abs(offset) % 2;
  return mirrored > 1 ? 2 - mirrored : mirrored;
}

function makeGradientTexture2D(major: 3 | 4): GodotGradientTexture2D {
  const texture = textureResource('GradientTexture2D');
  let gradient: GodotGradient | null = null;
  let gradientChanged: GodotConnection | null = null;
  let width = 64;
  let height = 64;
  let useHdr = false;
  let fill = GRADIENT_FILL_LINEAR;
  let repeat = GRADIENT_REPEAT_NONE;
  let fillFrom = vec2();
  let fillTo = vec2(1, 0);
  const update = new DeferredTextureUpdate(texture, () => {
    if (gradient === null) return null;
    const format = useHdr ? IMAGE_FORMAT.FORMAT_RGBAF : IMAGE_FORMAT.FORMAT_RGBA8;
    const image = createGodotImage(width, height, false, format);
    if (gradient.get_point_count() <= 1) {
      image.fill(gradient.get_point_count() === 1 ? gradient.get_color(0) : { r: 0, g: 0, b: 0, a: 1 });
      return image;
    }
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      image.set_pixel(x, y, gradient.sample(gradientOffset(x, y, width, height, fillFrom, fillTo, fill, repeat)));
    }
    return image;
  }, () => godotResourceEmitChanged(texture));
  const queue = (): void => update.queue();
  const changed = (): void => { if (major === 4) godotResourceEmitChanged(texture); };
  const result = Object.assign(texture, {
    set_gradient(value: GodotGradient | null) { if (value === gradient) return; gradientChanged = watchResource(gradientChanged, value, queue); gradient = value; queue(); changed(); },
    get_gradient: () => gradient,
    set_width(value: number) { width = integer(value, 'GradientTexture2D.width', 1, major === 4 ? 16384 : Number.MAX_SAFE_INTEGER); queue(); changed(); },
    get_width: () => width,
    set_height(value: number) { height = integer(value, 'GradientTexture2D.height', 1, major === 4 ? 16384 : Number.MAX_SAFE_INTEGER); queue(); changed(); },
    get_height: () => height,
    set_use_hdr(value: boolean) { const next = bool(value, 'GradientTexture2D.use_hdr'); if (next === useHdr) return; useHdr = next; queue(); changed(); },
    is_using_hdr: () => useHdr,
    set_fill(value: number) { fill = integer(value, 'GradientTexture2D.fill', 0, major === 3 ? 1 : 3); queue(); changed(); },
    get_fill: () => fill,
    set_fill_from(value: Vector2) { fillFrom = vector2(value, 'GradientTexture2D.fill_from'); queue(); changed(); },
    get_fill_from: () => vec2(fillFrom.x, fillFrom.y),
    set_fill_to(value: Vector2) { fillTo = vector2(value, 'GradientTexture2D.fill_to'); queue(); changed(); },
    get_fill_to: () => vec2(fillTo.x, fillTo.y),
    set_repeat(value: number) { repeat = integer(value, 'GradientTexture2D.repeat', 0, 2); queue(); changed(); },
    get_repeat: () => repeat,
    get_image: () => update.getImage(),
    update_now: () => { update.flush(); },
    has_alpha: () => true,
  });
  bindGodotResourceProtocol<GodotGradientTexture2D>(result, {
    createDuplicate() {
      return makeGradientTexture2D(major);
    },
    populateDuplicate(source, target, subresources, memo) {
      const sourceGradient = source.get_gradient();
      target.set_gradient(subresources ? duplicateGodotSubresource(sourceGradient, memo) : sourceGradient);
      target.set_width(source.get_width());
      target.set_height(source.get_height());
      target.set_use_hdr(source.is_using_hdr());
      target.set_fill(source.get_fill());
      target.set_fill_from(source.get_fill_from());
      target.set_fill_to(source.get_fill_to());
      target.set_repeat(source.get_repeat());
      target.update_now();
    },
  });
  update.queue();
  return result;
}

function makeCurveTexture(xyz: boolean, major: 3 | 4): GodotCurveTexture & GodotCurveXYZTexture {
  const className = xyz ? 'CurveXYZTexture' : 'CurveTexture';
  let width = major === 3 ? 2048 : 256;
  let mode = CURVE_TEXTURE_MODE_RGB;
  let curve: GodotCurve | null = null;
  let curveX: GodotCurve | null = null;
  let curveY: GodotCurve | null = null;
  let curveZ: GodotCurve | null = null;
  let curveConnection: GodotConnection | null = null;
  let xConnection: GodotConnection | null = null;
  let yConnection: GodotConnection | null = null;
  let zConnection: GodotConnection | null = null;
  const generate = (): GodotImage => {
    const format = major === 3 || (!xyz && mode === CURVE_TEXTURE_MODE_RED) ? IMAGE_FORMAT.FORMAT_RF : IMAGE_FORMAT.FORMAT_RGBF;
    const image = createGodotImage(width, 1, false, format);
    for (let index = 0; index < width; index += 1) {
      const at = index / width;
      if (xyz) {
        image.set_pixel(index, 0, { r: curveX?.sample_baked(at) ?? 0, g: curveY?.sample_baked(at) ?? 0, b: curveZ?.sample_baked(at) ?? 0, a: 1 });
      } else {
        const value = curve?.sample_baked(at) ?? 0;
        image.set_pixel(index, 0, { r: value, g: value, b: value, a: 1 });
      }
    }
    return image;
  };
  let image = generate();
  const texture = createGodotFloatImageTexture(image) as MutableImageTexture;
  registerGodotObjectIdentity(texture, className);
  const update = (): void => {
    image = generate();
    texture.set_image(image);
    godotResourceEmitChanged(texture);
  };
  const setCurve = (value: GodotCurve | null): void => {
    if (xyz) throw new Error('CurveXYZTexture has no curve property.');
    if (value === curve) return;
    curveConnection = watchResource(curveConnection, value, update);
    curve = value;
    update();
  };
  const setCurveX = (value: GodotCurve | null): void => {
    if (!xyz) throw new Error('CurveTexture has no curve_x property.');
    if (value === curveX) return;
    xConnection = watchResource(xConnection, value, update);
    curveX = value;
    update();
  };
  const setCurveY = (value: GodotCurve | null): void => {
    if (!xyz) throw new Error('CurveTexture has no curve_y property.');
    if (value === curveY) return;
    yConnection = watchResource(yConnection, value, update);
    curveY = value;
    update();
  };
  const setCurveZ = (value: GodotCurve | null): void => {
    if (!xyz) throw new Error('CurveTexture has no curve_z property.');
    if (value === curveZ) return;
    zConnection = watchResource(zConnection, value, update);
    curveZ = value;
    update();
  };
  const result = Object.assign(texture, {
    set_width(value: number) { const next = integer(value, `${className}.width`, 32, 4096); if (next === width) return; width = next; update(); },
    get_width: () => width,
    get_height: () => 1,
    set_texture_mode(value: number) { if (xyz || major === 3) throw new Error(`${className} has no texture_mode in Godot ${major}.`); const next = integer(value, 'CurveTexture.texture_mode', 0, 1); if (next === mode) return; mode = next; update(); },
    get_texture_mode: () => mode,
    set_curve: setCurve,
    get_curve: () => curve,
    set_curve_x: setCurveX,
    get_curve_x: () => curveX,
    set_curve_y: setCurveY,
    get_curve_y: () => curveY,
    set_curve_z: setCurveZ,
    get_curve_z: () => curveZ,
    ensure_default_setup(minimum = 0, maximum = 1) {
      const create = (): GodotCurve => { const result = createGodotCurve(); result.add_point(vec2(0, 1)); result.add_point(vec2(1, 1)); result.set_min_value(minimum); result.set_max_value(maximum); return result; };
      if (xyz) {
        if (curveX === null) setCurveX(create());
        if (curveY === null) setCurveY(create());
        if (curveZ === null) setCurveZ(create());
      } else if (curve === null) setCurve(create());
    },
    get_image: () => createGodotImage(image.width, image.height, image.has_mipmaps(), image.format, image.get_data()),
  });
  return result;
}

export function createGodotGradientTexture1D(): GodotGradientTexture1D { return makeGradientTexture1D(4); }
export function createGodotGradientTexture(): GodotGradientTexture1D { return makeGradientTexture1D(3); }
export function createGodotGradientTexture2D(major: 3 | 4): GodotGradientTexture2D { return makeGradientTexture2D(major); }
export function createGodotCurveTexture(major: 3 | 4): GodotCurveTexture { return makeCurveTexture(false, major); }
export function createGodotCurveXYZTexture(): GodotCurveXYZTexture { return makeCurveTexture(true, 4); }
