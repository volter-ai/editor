/** Godot ProxyTexture/ProxyTexture2D retaining one stable native Pixi texture identity. */

import { Rectangle, Texture } from 'pixi.js';
import type { GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
  godotResourceGetRid,
} from './resource-io';
import type { GodotRid } from './gdscript-builtins';
import type { GodotConnection } from './signal';
import { bindGodotTexture2DCanvasApi, getGodotTexture2DImage } from './texture-2d';
import { vec2, type Vector2 } from './vector2';

export interface GodotProxyTexture2D extends Texture {
  base: Texture | null;
  set_base(texture: Texture | null): void;
  get_base(): Texture | null;
  get_width(): number;
  get_height(): number;
  get_size(): Vector2;
  has_alpha(): boolean;
  get_image(): GodotImage | null;
  get_rid(): GodotRid;
}

interface ProxyTextureState {
  base: Texture | null;
  connection: GodotConnection | null;
}

const STATES = new WeakMap<GodotProxyTexture2D, ProxyTextureState>();

function textureOrNull(value: unknown): Texture | null {
  if (value !== null && !(value instanceof Texture)) {
    throw new TypeError('ProxyTexture2D.base requires Texture2D or null.');
  }
  return value;
}

function width(base: Texture | null): number {
  if (base === null) return 1;
  const getter = Reflect.get(base, 'get_width');
  return typeof getter === 'function' ? Number(getter.call(base)) : base.orig.width;
}

function height(base: Texture | null): number {
  if (base === null) return 1;
  const getter = Reflect.get(base, 'get_height');
  return typeof getter === 'function' ? Number(getter.call(base)) : base.orig.height;
}

function syncNative(resource: GodotProxyTexture2D, state: ProxyTextureState): void {
  const base = state.base ?? Texture.EMPTY;
  resource.source = base.source;
  resource.frame.copyFrom(base.frame);
  resource.orig.copyFrom(base.orig);
  resource.trim.copyFrom(base.trim);
  resource.update();
}

function bindBase(resource: GodotProxyTexture2D, state: ProxyTextureState): void {
  state.connection?.disconnect();
  state.connection = state.base === null ? null : godotResourceChangedSignal(state.base).connect(() => {
    syncNative(resource, state);
    godotResourceEmitChanged(resource);
  });
}

export function createGodotProxyTexture2D(
  initial: Texture | null = null,
  major: 3 | 4 = 4,
): GodotProxyTexture2D {
  const native = new Texture({
    source: Texture.EMPTY.source,
    frame: new Rectangle(0, 0, 1, 1),
    orig: new Rectangle(0, 0, 1, 1),
    dynamic: true,
  }) as GodotProxyTexture2D;
  const state: ProxyTextureState = { base: null, connection: null };
  STATES.set(native, state);
  const nativeUpdate = native.update.bind(native);
  Object.defineProperty(native, 'base', {
    configurable: true,
    enumerable: true,
    get: () => state.base,
    set: (value: Texture | null) => native.set_base(value),
  });
  Object.assign(native, {
    set_base(value: Texture | null): void {
      const next = textureOrNull(value);
      if (next === native) throw new Error('ProxyTexture2D.base cannot reference itself.');
      if (next === state.base) return;
      state.base = next;
      bindBase(native, state);
      syncNative(native, state);
      godotResourceEmitChanged(native);
    },
    get_base: (): Texture | null => state.base,
    get_width: (): number => width(state.base),
    get_height: (): number => height(state.base),
    get_size: (): Vector2 => vec2(width(state.base), height(state.base)),
    has_alpha(): boolean {
      if (state.base === null) return false;
      const method = Reflect.get(state.base, 'has_alpha');
      return typeof method === 'function' ? Boolean(method.call(state.base)) : true;
    },
    get_image(): GodotImage | null {
      return state.base === null ? null : getGodotTexture2DImage(state.base);
    },
    get_rid: (): GodotRid => godotResourceGetRid(native),
    update(): void { nativeUpdate(); },
  });
  registerGodotObjectIdentity(native, major === 3 ? 'ProxyTexture' : 'ProxyTexture2D');
  bindGodotResourceProtocol(native, {
    createDuplicate() { return createGodotProxyTexture2D(null, major); },
    populateDuplicate(source, target, subresources, memo) {
      target.set_base(subresources ? duplicateGodotSubresource(source.get_base(), memo) : source.get_base());
    },
  });
  native.set_base(initial);
  return bindGodotTexture2DCanvasApi(native);
}

export function createGodotProxyTexture(initial: Texture | null = null): GodotProxyTexture2D {
  return createGodotProxyTexture2D(initial, 3);
}
