/** Godot CanvasTexture Resource over RenderingServer's retained canvas-texture RID state. */

import { Texture } from 'pixi.js';
import {
  godotRenderingServerCanvasTextureCreate,
  godotRenderingServerCanvasTextureGetShadingParameters,
  godotRenderingServerCanvasTextureGetTextureFilter,
  godotRenderingServerCanvasTextureGetTextureRepeat,
  godotRenderingServerCanvasTextureSetChannel,
  godotRenderingServerCanvasTextureSetShadingParameters,
  godotRenderingServerCanvasTextureSetTextureFilter,
  godotRenderingServerCanvasTextureSetTextureRepeat,
} from './canvas-server';
import type { GodotRid } from './gdscript-builtins';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
  godotResourceGetRid,
  godotResourceOfRid,
} from './resource-io';
import type { ColorValue } from './variant';
import { bindGodotTexture2DCanvasApi } from './texture-2d';

export interface GodotCanvasTextureResource extends Texture {
  diffuse_texture: Texture | null;
  normal_texture: Texture | null;
  specular_texture: Texture | null;
  specular_color: ColorValue;
  specular_shininess: number;
  texture_filter: number;
  texture_repeat: number;
  set_diffuse_texture(texture: Texture | null): void;
  get_diffuse_texture(): Texture | null;
  set_normal_texture(texture: Texture | null): void;
  get_normal_texture(): Texture | null;
  set_specular_texture(texture: Texture | null): void;
  get_specular_texture(): Texture | null;
  set_specular_color(color: ColorValue): void;
  get_specular_color(): ColorValue;
  set_specular_shininess(value: number): void;
  get_specular_shininess(): number;
  set_texture_filter(value: number): void;
  get_texture_filter(): number;
  set_texture_repeat(value: number): void;
  get_texture_repeat(): number;
  get_width(): number;
  get_height(): number;
  get_size(): { x: number; y: number };
  has_alpha(): boolean;
  get_image(): unknown | null;
  get_rid(): GodotRid;
}

interface CanvasTextureResourceState {
  readonly rid: GodotRid;
  diffuse: Texture | null;
  normal: Texture | null;
  specular: Texture | null;
}

const RESOURCE_STATES = new WeakMap<GodotCanvasTextureResource, CanvasTextureResourceState>();
const NIL_RID: GodotRid = Object.freeze({ id: 0n });

function texture(value: Texture | null, member: string): Texture | null {
  if (value !== null && !(value instanceof Texture)) {
    throw new TypeError(`CanvasTexture.${member} requires Texture2D or null.`);
  }
  return value;
}

function color(value: ColorValue): ColorValue {
  if (
    typeof value !== 'object' || value === null ||
    ![value.r, value.g, value.b, value.a].every(Number.isFinite)
  ) throw new TypeError('CanvasTexture.specular_color requires a finite Color.');
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function shininess(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('CanvasTexture.specular_shininess requires a finite value in [0, 1].');
  }
  return value;
}

function filter(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) {
    throw new RangeError('CanvasTexture.texture_filter requires DEFAULT (0) through LINEAR_WITH_MIPMAPS_ANISOTROPIC (6).');
  }
  return value;
}

function repeat(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw new RangeError('CanvasTexture.texture_repeat requires DEFAULT (0) through MIRROR (3).');
  }
  return value;
}

function syncDiffuse(resource: GodotCanvasTextureResource, diffuse: Texture | null): void {
  const source = diffuse ?? Texture.EMPTY;
  resource.source = source.source;
  resource.frame.copyFrom(source.frame);
  resource.orig.copyFrom(source.orig);
  resource.trim.copyFrom(source.trim);
  resource.update();
}

function forwardedTextureMethod(resource: GodotCanvasTextureResource, member: string): unknown {
  const diffuse = RESOURCE_STATES.get(resource)?.diffuse;
  if (diffuse === null || diffuse === undefined) return undefined;
  return Reflect.get(diffuse, member);
}

export function createGodotCanvasTextureResource(): GodotCanvasTextureResource {
  const rid = godotRenderingServerCanvasTextureCreate();
  const retained = godotResourceOfRid(rid);
  if (!(retained instanceof Texture)) {
    throw new Error('RenderingServer.canvas_texture_create returned no retained Pixi Texture.');
  }
  const resource = retained as GodotCanvasTextureResource;
  const state: CanvasTextureResourceState = { rid, diffuse: null, normal: null, specular: null };
  RESOURCE_STATES.set(resource, state);
  registerGodotObjectIdentity(resource, 'CanvasTexture');
  Object.defineProperties(resource, {
    diffuse_texture: { enumerable: true, configurable: true, get: () => state.diffuse, set: (value: Texture | null) => resource.set_diffuse_texture(value) },
    normal_texture: { enumerable: true, configurable: true, get: () => state.normal, set: (value: Texture | null) => resource.set_normal_texture(value) },
    specular_texture: { enumerable: true, configurable: true, get: () => state.specular, set: (value: Texture | null) => resource.set_specular_texture(value) },
    specular_color: { enumerable: true, configurable: true, get: () => resource.get_specular_color(), set: (value: ColorValue) => resource.set_specular_color(value) },
    specular_shininess: { enumerable: true, configurable: true, get: () => resource.get_specular_shininess(), set: (value: number) => resource.set_specular_shininess(value) },
    texture_filter: { enumerable: true, configurable: true, get: () => resource.get_texture_filter(), set: (value: number) => resource.set_texture_filter(value) },
    texture_repeat: { enumerable: true, configurable: true, get: () => resource.get_texture_repeat(), set: (value: number) => resource.set_texture_repeat(value) },
  });
  Object.assign(resource, {
    set_diffuse_texture(value: Texture | null): void {
      const next = texture(value, 'diffuse_texture');
      if (next === state.diffuse) return;
      state.diffuse = next;
      godotRenderingServerCanvasTextureSetChannel(rid, 0, next === null ? NIL_RID : godotResourceGetRid(next));
      syncDiffuse(resource, next);
      godotResourceEmitChanged(resource);
    },
    get_diffuse_texture: (): Texture | null => state.diffuse,
    set_normal_texture(value: Texture | null): void {
      const next = texture(value, 'normal_texture');
      if (next === state.normal) return;
      state.normal = next;
      godotRenderingServerCanvasTextureSetChannel(rid, 1, next === null ? NIL_RID : godotResourceGetRid(next));
      godotResourceEmitChanged(resource);
    },
    get_normal_texture: (): Texture | null => state.normal,
    set_specular_texture(value: Texture | null): void {
      const next = texture(value, 'specular_texture');
      if (next === state.specular) return;
      state.specular = next;
      godotRenderingServerCanvasTextureSetChannel(rid, 2, next === null ? NIL_RID : godotResourceGetRid(next));
      godotResourceEmitChanged(resource);
    },
    get_specular_texture: (): Texture | null => state.specular,
    set_specular_color(value: ColorValue): void {
      const current = godotRenderingServerCanvasTextureGetShadingParameters(rid);
      godotRenderingServerCanvasTextureSetShadingParameters(rid, color(value), current.shininess);
      godotResourceEmitChanged(resource);
    },
    get_specular_color: (): ColorValue => ({ ...godotRenderingServerCanvasTextureGetShadingParameters(rid).baseColor }),
    set_specular_shininess(value: number): void {
      const current = godotRenderingServerCanvasTextureGetShadingParameters(rid);
      godotRenderingServerCanvasTextureSetShadingParameters(rid, current.baseColor, shininess(value));
      godotResourceEmitChanged(resource);
    },
    get_specular_shininess: (): number => godotRenderingServerCanvasTextureGetShadingParameters(rid).shininess,
    set_texture_filter(value: number): void {
      godotRenderingServerCanvasTextureSetTextureFilter(rid, filter(value));
      godotResourceEmitChanged(resource);
    },
    get_texture_filter: (): number => godotRenderingServerCanvasTextureGetTextureFilter(rid),
    set_texture_repeat(value: number): void {
      godotRenderingServerCanvasTextureSetTextureRepeat(rid, repeat(value));
      godotResourceEmitChanged(resource);
    },
    get_texture_repeat: (): number => godotRenderingServerCanvasTextureGetTextureRepeat(rid),
    get_width: (): number => state.diffuse?.width ?? 1,
    get_height: (): number => state.diffuse?.height ?? 1,
    get_size: (): { x: number; y: number } => ({ x: state.diffuse?.width ?? 1, y: state.diffuse?.height ?? 1 }),
    has_alpha(): boolean {
      const method = forwardedTextureMethod(resource, 'has_alpha');
      return typeof method === 'function' ? Boolean(Reflect.apply(method, state.diffuse, [])) : true;
    },
    get_image(): unknown | null {
      const method = forwardedTextureMethod(resource, 'get_image') ?? forwardedTextureMethod(resource, 'get_data');
      return typeof method === 'function' ? Reflect.apply(method, state.diffuse, []) : null;
    },
    get_rid: (): GodotRid => rid,
  });
  bindGodotResourceProtocol(resource, {
    createDuplicate() { return createGodotCanvasTextureResource(); },
    populateDuplicate(source, target, subresources, memo) {
      target.set_diffuse_texture(subresources ? duplicateGodotSubresource(source.diffuse_texture, memo) : source.diffuse_texture);
      target.set_normal_texture(subresources ? duplicateGodotSubresource(source.normal_texture, memo) : source.normal_texture);
      target.set_specular_texture(subresources ? duplicateGodotSubresource(source.specular_texture, memo) : source.specular_texture);
      target.set_specular_color(source.specular_color);
      target.set_specular_shininess(source.specular_shininess);
      target.set_texture_filter(source.texture_filter);
      target.set_texture_repeat(source.texture_repeat);
    },
  });
  syncDiffuse(resource, null);
  return bindGodotTexture2DCanvasApi(resource);
}
