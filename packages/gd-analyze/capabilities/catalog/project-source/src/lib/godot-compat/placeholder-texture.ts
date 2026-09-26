/** Godot PlaceholderTexture2D as a drawable native Pixi texture with retained logical size. */

import { Rectangle, Texture } from 'pixi.js';
import { createGodotImage, IMAGE_FORMAT, type GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  godotResourceEmitChanged,
  godotResourceGetRid,
} from './resource-io';
import type { GodotRid } from './gdscript-builtins';
import { vec2, type Vector2 } from './vector2';
import { bindGodotTexture2DCanvasApi } from './texture-2d';

export interface GodotPlaceholderTexture2D extends Texture {
  size: Vector2;
  set_size(size: Vector2): void;
  get_size(): Vector2;
  get_width(): number;
  get_height(): number;
  has_alpha(): boolean;
  get_image(): GodotImage;
  get_rid(): GodotRid;
}

interface PlaceholderTextureState {
  width: number;
  height: number;
}

const STATES = new WeakMap<GodotPlaceholderTexture2D, PlaceholderTextureState>();

function dimension(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 16384) {
    throw new RangeError(`PlaceholderTexture2D.${member} requires an integer in [1, 16384].`);
  }
  return value;
}

function sizeValue(value: unknown): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('PlaceholderTexture2D.size requires a Vector2.');
  }
  return vec2(
    dimension(Reflect.get(value, 'x'), 'size.x'),
    dimension(Reflect.get(value, 'y'), 'size.y'),
  );
}

function checkerImage(width: number, height: number): GodotImage {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const dark = ((x >> 3) + (y >> 3)) % 2 === 0;
      data[offset] = dark ? 64 : 255;
      data[offset + 1] = 0;
      data[offset + 2] = dark ? 64 : 255;
      data[offset + 3] = 255;
    }
  }
  return createGodotImage(width, height, false, IMAGE_FORMAT.FORMAT_RGBA8, data);
}

function syncNative(resource: GodotPlaceholderTexture2D, state: PlaceholderTextureState): void {
  resource.orig.copyFrom(new Rectangle(0, 0, state.width, state.height));
  resource.trim.copyFrom(new Rectangle(0, 0, 1, 1));
  resource.update();
}

export function createGodotPlaceholderTexture2D(
  initialSize: Vector2 = vec2(1, 1),
): GodotPlaceholderTexture2D {
  const validated = sizeValue(initialSize);
  const native = new Texture({
    source: Texture.WHITE.source,
    frame: new Rectangle(0, 0, 1, 1),
    orig: new Rectangle(0, 0, validated.x, validated.y),
    trim: new Rectangle(0, 0, 1, 1),
    dynamic: true,
  }) as GodotPlaceholderTexture2D;
  const state: PlaceholderTextureState = { width: validated.x, height: validated.y };
  STATES.set(native, state);
  const nativeUpdate = native.update.bind(native);

  Object.defineProperty(native, 'size', {
    configurable: true,
    enumerable: true,
    get: () => vec2(state.width, state.height),
    set: (value: Vector2) => native.set_size(value),
  });
  Object.assign(native, {
    set_size(value: Vector2): void {
      const next = sizeValue(value);
      if (next.x === state.width && next.y === state.height) return;
      state.width = next.x;
      state.height = next.y;
      syncNative(native, state);
      godotResourceEmitChanged(native);
    },
    get_size: (): Vector2 => vec2(state.width, state.height),
    get_width: (): number => state.width,
    get_height: (): number => state.height,
    has_alpha: (): boolean => false,
    get_image: (): GodotImage => checkerImage(state.width, state.height),
    get_rid: (): GodotRid => godotResourceGetRid(native),
    update(): void { nativeUpdate(); },
  });
  registerGodotObjectIdentity(native, 'PlaceholderTexture2D');
  bindGodotResourceProtocol(native, {
    createDuplicate(source) { return createGodotPlaceholderTexture2D(source.get_size()); },
  });
  return bindGodotTexture2DCanvasApi(native);
}
