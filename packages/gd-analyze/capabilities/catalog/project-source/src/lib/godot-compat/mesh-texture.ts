/** Godot 3 MeshTexture Resource retaining mesh, base texture, and logical image size. */

import { Rectangle, Texture } from 'pixi.js';
import type { GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotConnection } from './signal';
import { bindGodotTexture2DCanvasApi, getGodotTexture2DImage } from './texture-2d';
import { vec2, type Vector2 } from './vector2';

export interface GodotMeshTexture extends Texture {
  mesh: object | null;
  base_texture: Texture | null;
  image_size: Vector2;
  set_mesh(mesh: object | null): void;
  get_mesh(): object | null;
  set_base_texture(texture: Texture | null): void;
  get_base_texture(): Texture | null;
  set_image_size(size: Vector2): void;
  get_image_size(): Vector2;
  get_width(): number;
  get_height(): number;
  get_size(): Vector2;
  has_alpha(): boolean;
  get_image(): GodotImage | null;
}

interface MeshTextureState {
  mesh: object | null;
  base: Texture | null;
  size: Vector2;
  meshChanged: GodotConnection | null;
  baseChanged: GodotConnection | null;
}

function nullableObject(value: unknown): object | null {
  if (value !== null && (typeof value !== 'object' && typeof value !== 'function')) {
    throw new TypeError('MeshTexture.mesh requires a Mesh Resource or null.');
  }
  return value;
}

function nullableTexture(value: unknown): Texture | null {
  if (value !== null && !(value instanceof Texture)) {
    throw new TypeError('MeshTexture.base_texture requires Texture2D or null.');
  }
  return value;
}

function imageSize(value: unknown): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('MeshTexture.image_size requires a Vector2.');
  }
  const x = Reflect.get(value, 'x');
  const y = Reflect.get(value, 'y');
  if (
    typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0 ||
    typeof y !== 'number' || !Number.isSafeInteger(y) || y < 0
  ) {
    throw new RangeError('MeshTexture.image_size requires non-negative integer dimensions.');
  }
  return vec2(x, y);
}

function nativeWidth(state: MeshTextureState): number {
  if (state.size.x > 0) return state.size.x;
  if (state.base === null) return 1;
  const method = Reflect.get(state.base, 'get_width');
  return typeof method === 'function' ? Number(method.call(state.base)) : state.base.orig.width;
}

function nativeHeight(state: MeshTextureState): number {
  if (state.size.y > 0) return state.size.y;
  if (state.base === null) return 1;
  const method = Reflect.get(state.base, 'get_height');
  return typeof method === 'function' ? Number(method.call(state.base)) : state.base.orig.height;
}

function syncNative(resource: GodotMeshTexture, state: MeshTextureState): void {
  const base = state.base ?? Texture.EMPTY;
  resource.source = base.source;
  resource.frame.copyFrom(base.frame);
  resource.orig.copyFrom(new Rectangle(0, 0, nativeWidth(state), nativeHeight(state)));
  resource.trim.copyFrom(base.trim);
  resource.update();
}

function watch(
  previous: GodotConnection | null,
  value: object | null,
  changed: () => void,
): GodotConnection | null {
  previous?.disconnect();
  return value === null ? null : godotResourceChangedSignal(value).connect(changed);
}

export function createGodotMeshTexture(): GodotMeshTexture {
  const native = new Texture({
    source: Texture.EMPTY.source,
    frame: new Rectangle(0, 0, 1, 1),
    orig: new Rectangle(0, 0, 1, 1),
    dynamic: true,
  }) as GodotMeshTexture;
  const state: MeshTextureState = {
    mesh: null,
    base: null,
    size: vec2(),
    meshChanged: null,
    baseChanged: null,
  };
  const nativeUpdate = native.update.bind(native);
  const nestedChanged = (): void => {
    syncNative(native, state);
    godotResourceEmitChanged(native);
  };

  Object.defineProperties(native, {
    mesh: { configurable: true, enumerable: true, get: () => state.mesh, set: (value: object | null) => native.set_mesh(value) },
    base_texture: { configurable: true, enumerable: true, get: () => state.base, set: (value: Texture | null) => native.set_base_texture(value) },
    image_size: { configurable: true, enumerable: true, get: () => vec2(state.size.x, state.size.y), set: (value: Vector2) => native.set_image_size(value) },
  });
  Object.assign(native, {
    set_mesh(value: object | null): void {
      const next = nullableObject(value);
      if (next === state.mesh) return;
      state.mesh = next;
      state.meshChanged = watch(state.meshChanged, next, nestedChanged);
      godotResourceEmitChanged(native);
    },
    get_mesh: (): object | null => state.mesh,
    set_base_texture(value: Texture | null): void {
      const next = nullableTexture(value);
      if (next === native) throw new Error('MeshTexture.base_texture cannot reference itself.');
      if (next === state.base) return;
      state.base = next;
      state.baseChanged = watch(state.baseChanged, next, nestedChanged);
      syncNative(native, state);
      godotResourceEmitChanged(native);
    },
    get_base_texture: (): Texture | null => state.base,
    set_image_size(value: Vector2): void {
      const next = imageSize(value);
      if (next.x === state.size.x && next.y === state.size.y) return;
      state.size = next;
      syncNative(native, state);
      godotResourceEmitChanged(native);
    },
    get_image_size: (): Vector2 => vec2(state.size.x, state.size.y),
    get_width: (): number => nativeWidth(state),
    get_height: (): number => nativeHeight(state),
    get_size: (): Vector2 => vec2(nativeWidth(state), nativeHeight(state)),
    has_alpha(): boolean {
      if (state.base === null) return false;
      const method = Reflect.get(state.base, 'has_alpha');
      return typeof method === 'function' ? Boolean(method.call(state.base)) : true;
    },
    get_image: (): GodotImage | null => state.base === null ? null : getGodotTexture2DImage(state.base),
    update(): void { nativeUpdate(); },
  });
  registerGodotObjectIdentity(native, 'MeshTexture');
  bindGodotResourceProtocol(native, {
    createDuplicate() { return createGodotMeshTexture(); },
    populateDuplicate(source, target, subresources, memo) {
      const mesh = source.get_mesh();
      const base = source.get_base_texture();
      target.set_mesh(subresources ? duplicateGodotSubresource(mesh, memo) : mesh);
      target.set_base_texture(subresources ? duplicateGodotSubresource(base, memo) : base);
      target.set_image_size(source.get_image_size());
    },
  });
  syncNative(native, state);
  return bindGodotTexture2DCanvasApi(native);
}
