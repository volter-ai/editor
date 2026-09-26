/** Godot 3 LargeTexture composed from retained native Pixi Texture pieces. */

import { Rectangle, Texture } from 'pixi.js';
import { createGodotImage, IMAGE_FORMAT, type GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import { godotRect2New } from './rect2';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotConnection } from './signal';
import { bindGodotTexture2DCanvasApi, getGodotTexture2DImage } from './texture-2d';
import { vec2, type Vector2 } from './vector2';

export interface GodotLargeTexture extends Texture {
  size: Vector2;
  set_size(size: Vector2): void;
  get_size(): Vector2;
  get_width(): number;
  get_height(): number;
  add_piece(offset: Vector2, texture: Texture): number;
  set_piece_offset(index: number, offset: Vector2): void;
  set_piece_texture(index: number, texture: Texture): void;
  get_piece_offset(index: number): Vector2;
  get_piece_texture(index: number): Texture;
  get_piece_count(): number;
  clear(): void;
  has_alpha(): boolean;
  get_image(): GodotImage;
}

interface LargeTexturePiece {
  offset: Vector2;
  texture: Texture;
  changed: GodotConnection;
}

interface LargeTextureState {
  width: number;
  height: number;
  readonly canvas: HTMLCanvasElement;
  readonly pieces: LargeTexturePiece[];
}

const STATES = new WeakMap<GodotLargeTexture, LargeTextureState>();

function newCanvas(): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('LargeTexture requires a browser Canvas for native composition.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

function integer(value: unknown, member: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`LargeTexture.${member} requires an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

function vector(value: unknown, member: string, minimum = Number.MIN_SAFE_INTEGER): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`LargeTexture.${member} requires a Vector2.`);
  }
  return vec2(
    integer(Reflect.get(value, 'x'), `${member}.x`, minimum),
    integer(Reflect.get(value, 'y'), `${member}.y`, minimum),
  );
}

function textureValue(value: unknown, member: string): Texture {
  if (!(value instanceof Texture)) throw new TypeError(`LargeTexture.${member} requires Texture2D.`);
  return value;
}

function pieceIndex(state: LargeTextureState, value: unknown, member: string): number {
  const index = integer(value, member);
  if (index >= state.pieces.length) {
    throw new RangeError(`LargeTexture.${member} index ${index} is outside the piece array.`);
  }
  return index;
}

function drawableResource(texture: Texture): CanvasImageSource | null {
  const resource = texture.source.resource;
  if (typeof ImageBitmap !== 'undefined' && resource instanceof ImageBitmap) return resource;
  if (typeof ImageData !== 'undefined' && resource instanceof ImageData) return null;
  if (typeof HTMLCanvasElement !== 'undefined' && resource instanceof HTMLCanvasElement) return resource;
  if (typeof HTMLImageElement !== 'undefined' && resource instanceof HTMLImageElement) return resource;
  if (typeof HTMLVideoElement !== 'undefined' && resource instanceof HTMLVideoElement) return resource;
  if (typeof OffscreenCanvas !== 'undefined' && resource instanceof OffscreenCanvas) return resource;
  return null;
}

function redraw(resource: GodotLargeTexture, state: LargeTextureState): void {
  state.canvas.width = Math.max(1, state.width);
  state.canvas.height = Math.max(1, state.height);
  const context = state.canvas.getContext('2d');
  if (context === null) throw new Error('LargeTexture lost its native 2D Canvas context.');
  context.clearRect(0, 0, state.canvas.width, state.canvas.height);
  for (const piece of state.pieces) {
    const source = drawableResource(piece.texture);
    if (source === null) continue;
    const frame = piece.texture.frame;
    context.drawImage(
      source,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      piece.offset.x,
      piece.offset.y,
      piece.texture.orig.width,
      piece.texture.orig.height,
    );
  }
  resource.source.update();
  resource.frame.copyFrom(new Rectangle(0, 0, state.canvas.width, state.canvas.height));
  resource.orig.copyFrom(resource.frame);
  resource.trim.copyFrom(resource.frame);
  resource.update();
}

function makePiece(
  resource: GodotLargeTexture,
  state: LargeTextureState,
  offset: Vector2,
  texture: Texture,
): LargeTexturePiece {
  return {
    offset,
    texture,
    changed: godotResourceChangedSignal(texture).connect(() => {
      redraw(resource, state);
      godotResourceEmitChanged(resource);
    }),
  };
}

export function createGodotLargeTexture(initialSize: Vector2 = vec2()): GodotLargeTexture {
  const size = vector(initialSize, 'size', 0);
  const canvas = newCanvas();
  const native = Texture.from(canvas) as GodotLargeTexture;
  const state: LargeTextureState = { width: size.x, height: size.y, canvas, pieces: [] };
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
      const next = vector(value, 'size', 0);
      if (next.x === state.width && next.y === state.height) return;
      state.width = next.x;
      state.height = next.y;
      redraw(native, state);
      godotResourceEmitChanged(native);
    },
    get_size: (): Vector2 => vec2(state.width, state.height),
    get_width: (): number => state.width,
    get_height: (): number => state.height,
    add_piece(offset: Vector2, texture: Texture): number {
      const piece = makePiece(native, state, vector(offset, 'add_piece.offset'), textureValue(texture, 'add_piece.texture'));
      state.pieces.push(piece);
      redraw(native, state);
      godotResourceEmitChanged(native);
      return state.pieces.length - 1;
    },
    set_piece_offset(index: number, offset: Vector2): void {
      const piece = state.pieces[pieceIndex(state, index, 'set_piece_offset')]!;
      piece.offset = vector(offset, 'set_piece_offset.offset');
      redraw(native, state);
      godotResourceEmitChanged(native);
    },
    set_piece_texture(index: number, texture: Texture): void {
      const piece = state.pieces[pieceIndex(state, index, 'set_piece_texture')]!;
      const next = textureValue(texture, 'set_piece_texture.texture');
      if (piece.texture === next) return;
      piece.changed.disconnect();
      piece.texture = next;
      piece.changed = godotResourceChangedSignal(next).connect(() => {
        redraw(native, state);
        godotResourceEmitChanged(native);
      });
      redraw(native, state);
      godotResourceEmitChanged(native);
    },
    get_piece_offset(index: number): Vector2 {
      const offset = state.pieces[pieceIndex(state, index, 'get_piece_offset')]!.offset;
      return vec2(offset.x, offset.y);
    },
    get_piece_texture(index: number): Texture {
      return state.pieces[pieceIndex(state, index, 'get_piece_texture')]!.texture;
    },
    get_piece_count: (): number => state.pieces.length,
    clear(): void {
      if (state.pieces.length === 0) return;
      for (const piece of state.pieces) piece.changed.disconnect();
      state.pieces.length = 0;
      redraw(native, state);
      godotResourceEmitChanged(native);
    },
    has_alpha(): boolean {
      return state.pieces.some((piece) => {
        const method = Reflect.get(piece.texture, 'has_alpha');
        return typeof method === 'function' ? Boolean(method.call(piece.texture)) : true;
      });
    },
    get_image(): GodotImage {
      const image = createGodotImage(state.width, state.height, false, IMAGE_FORMAT.FORMAT_RGBA8);
      for (const piece of state.pieces) {
        const source = getGodotTexture2DImage(piece.texture);
        if (source === null) continue;
        image.blit_rect(source, godotRect2New(0, 0, source.width, source.height), piece.offset);
      }
      return image;
    },
    update(): void { nativeUpdate(); },
  });
  registerGodotObjectIdentity(native, 'LargeTexture');
  bindGodotResourceProtocol(native, {
    createDuplicate(source) {
      const copy = createGodotLargeTexture(source.get_size());
      for (let index = 0; index < source.get_piece_count(); index += 1) {
        copy.add_piece(source.get_piece_offset(index), source.get_piece_texture(index));
      }
      return copy;
    },
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      target.clear();
      for (let index = 0; index < source.get_piece_count(); index += 1) {
        target.add_piece(
          source.get_piece_offset(index),
          duplicateGodotSubresource(source.get_piece_texture(index), memo),
        );
      }
    },
  });
  redraw(native, state);
  return bindGodotTexture2DCanvasApi(native);
}
