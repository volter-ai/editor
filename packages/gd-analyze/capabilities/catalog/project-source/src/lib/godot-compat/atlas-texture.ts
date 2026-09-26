/** Godot AtlasTexture as a live native Pixi/Three subtexture Resource. */

import { Rectangle, Texture as PixiTexture } from 'pixi.js';
import { Texture as ThreeTexture } from 'three';
import { type GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import { godotRect2New, type GodotRect2 } from './rect2';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  getGodotResourceLocalToScene,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
  godotResourceSetupLocalToScene,
  hasGodotResourceProtocol,
} from './resource-io';
import type { GodotConnection } from './signal';
import { vec2 } from './vector2';
import { bindGodotTexture2DCanvasApi } from './texture-2d';

export type GodotTexture2D = PixiTexture | ThreeTexture;

export interface GodotAtlasTexture<TAtlas extends GodotTexture2D = GodotTexture2D> {
  atlas: TAtlas | null;
  region: GodotRect2;
  margin: GodotRect2;
  filter_clip: boolean;
  set_atlas(atlas: TAtlas | null): void;
  get_atlas(): TAtlas | null;
  set_region(region: GodotRect2): void;
  get_region(): GodotRect2;
  set_margin(margin: GodotRect2): void;
  get_margin(): GodotRect2;
  set_filter_clip(enabled: boolean): void;
  has_filter_clip(): boolean;
  get_width(): number;
  get_height(): number;
  get_size(): ReturnType<typeof vec2>;
  has_alpha(): boolean;
  get_image(): GodotImage | null;
}

export type GodotAtlasTexture2D = PixiTexture & GodotAtlasTexture<PixiTexture>;
export type GodotAtlasTexture3D = ThreeTexture & GodotAtlasTexture<ThreeTexture>;

interface AtlasState<TAtlas extends GodotTexture2D> {
  atlas: TAtlas | null;
  region: GodotRect2;
  margin: GodotRect2;
  filterClip: boolean;
  nestedChanged: GodotConnection | null;
  readonly syncNative: () => void;
}

const STATES = new WeakMap<object, AtlasState<GodotTexture2D>>();

function copyRect(value: GodotRect2): GodotRect2 {
  return godotRect2New(value.position.x, value.position.y, value.size.x, value.size.y);
}

function rect(value: unknown, member: string): GodotRect2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`AtlasTexture.${member} requires a Rect2.`);
  }
  const candidate = value as Partial<GodotRect2>;
  const numbers = [
    candidate.position?.x,
    candidate.position?.y,
    candidate.size?.x,
    candidate.size?.y,
  ];
  if (numbers.some((one) => typeof one !== 'number' || !Number.isFinite(one))) {
    throw new TypeError(`AtlasTexture.${member} requires a finite Rect2.`);
  }
  return godotRect2New(
    candidate.position!.x,
    candidate.position!.y,
    candidate.size!.x,
    candidate.size!.y,
  );
}

function equalRect(left: GodotRect2, right: GodotRect2): boolean {
  return left.position.x === right.position.x && left.position.y === right.position.y &&
    left.size.x === right.size.x && left.size.y === right.size.y;
}

function stateOf<TAtlas extends GodotTexture2D>(resource: object): AtlasState<TAtlas> {
  const state = STATES.get(resource) as AtlasState<TAtlas> | undefined;
  if (state === undefined) throw new TypeError('Expected an AtlasTexture created by godot-compat.');
  return state;
}

function nativeSize(texture: GodotTexture2D): { width: number; height: number } {
  if (texture instanceof PixiTexture) {
    return { width: texture.orig.width, height: texture.orig.height };
  }
  const image = texture.image as { width?: unknown; height?: unknown } | undefined;
  if (typeof image?.width !== 'number' || !Number.isFinite(image.width) || image.width <= 0 ||
      typeof image.height !== 'number' || !Number.isFinite(image.height) || image.height <= 0) {
    throw new Error('AtlasTexture atlas dimensions are unavailable; load the Texture2D first.');
  }
  return { width: image.width, height: image.height };
}

function textureWidth(texture: GodotTexture2D | null): number {
  if (texture === null) return 1;
  const method = Reflect.get(texture, 'get_width');
  return typeof method === 'function' ? Number(method.call(texture)) : nativeSize(texture).width;
}

function textureHeight(texture: GodotTexture2D | null): number {
  if (texture === null) return 1;
  const method = Reflect.get(texture, 'get_height');
  return typeof method === 'function' ? Number(method.call(texture)) : nativeSize(texture).height;
}

function roundedRegion(state: AtlasState<GodotTexture2D>): GodotRect2 {
  return godotRect2New(
    state.region.position.x,
    state.region.position.y,
    state.region.size.x === 0 ? textureWidth(state.atlas) : Math.floor(state.region.size.x),
    state.region.size.y === 0 ? textureHeight(state.atlas) : Math.floor(state.region.size.y),
  );
}

function logicalWidth(state: AtlasState<GodotTexture2D>): number {
  return state.region.size.x === 0
    ? textureWidth(state.atlas)
    : Math.floor(state.region.size.x) + state.margin.size.x;
}

function logicalHeight(state: AtlasState<GodotTexture2D>): number {
  return state.region.size.y === 0
    ? textureHeight(state.atlas)
    : Math.floor(state.region.size.y) + state.margin.size.y;
}

function imageOf(texture: GodotTexture2D | null): GodotImage | null {
  if (texture === null) return null;
  const getter = Reflect.get(texture, 'get_image') ?? Reflect.get(texture, 'get_data');
  if (typeof getter !== 'function') {
    throw new Error(
      'AtlasTexture.get_image() cannot synchronously read back this browser-native texture; ' +
        'bind an ImageTexture backed by a Godot Image.',
    );
  }
  const image = getter.call(texture) as GodotImage | null;
  return image ?? null;
}

function getAtlasImage(resource: object): GodotImage | null {
  const state = stateOf(resource);
  const image = imageOf(state.atlas);
  if (image === null) return null;
  const region = roundedRegion(state);
  return image.get_region({
    position: vec2(region.position.x, region.position.y),
    size: vec2(region.size.x, region.size.y),
  });
}

function bindNested(resource: object, state: AtlasState<GodotTexture2D>): void {
  state.nestedChanged?.disconnect();
  state.nestedChanged = null;
  if (state.atlas === null || !hasGodotResourceProtocol(state.atlas)) return;
  state.nestedChanged = godotResourceChangedSignal(state.atlas).connect(() => {
    state.syncNative();
    godotResourceEmitChanged(resource);
  });
}

function installApi<TNative extends GodotTexture2D>(
  native: TNative,
  state: AtlasState<TNative>,
): TNative & GodotAtlasTexture<TNative> {
  const resource = native as TNative & GodotAtlasTexture<TNative>;
  STATES.set(resource, state as AtlasState<GodotTexture2D>);
  Object.defineProperties(resource, {
    atlas: {
      enumerable: true,
      configurable: true,
      get: () => state.atlas,
      set: (value: TNative | null) => resource.set_atlas(value),
    },
    region: {
      enumerable: true,
      configurable: true,
      get: () => copyRect(state.region),
      set: (value: GodotRect2) => resource.set_region(value),
    },
    margin: {
      enumerable: true,
      configurable: true,
      get: () => copyRect(state.margin),
      set: (value: GodotRect2) => resource.set_margin(value),
    },
    filter_clip: {
      enumerable: true,
      configurable: true,
      get: () => state.filterClip,
      set: (value: boolean) => resource.set_filter_clip(value),
    },
  });
  Object.assign(resource, {
    set_atlas(next: TNative | null): void {
      const wrongSurface = next !== null && (
        native instanceof PixiTexture
          ? !(next instanceof PixiTexture)
          : !(next instanceof ThreeTexture)
      );
      if (wrongSurface) {
        throw new TypeError('AtlasTexture.atlas requires a Texture2D Resource or null.');
      }
      if (next === resource) throw new Error('AtlasTexture.atlas cannot reference itself.');
      if (state.atlas === next) return;
      state.atlas = next;
      bindNested(resource, state as AtlasState<GodotTexture2D>);
      state.syncNative();
      godotResourceEmitChanged(resource);
    },
    get_atlas: () => state.atlas,
    set_region(value: GodotRect2): void {
      const next = rect(value, 'region');
      if (equalRect(state.region, next)) return;
      state.region = next;
      state.syncNative();
      godotResourceEmitChanged(resource);
    },
    get_region: () => copyRect(state.region),
    set_margin(value: GodotRect2): void {
      const next = rect(value, 'margin');
      if (equalRect(state.margin, next)) return;
      state.margin = next;
      state.syncNative();
      godotResourceEmitChanged(resource);
    },
    get_margin: () => copyRect(state.margin),
    set_filter_clip(value: boolean): void {
      if (typeof value !== 'boolean') throw new TypeError('AtlasTexture.filter_clip requires bool.');
      state.filterClip = value;
      godotResourceEmitChanged(resource);
    },
    has_filter_clip: () => state.filterClip,
    get_width: () => logicalWidth(state as AtlasState<GodotTexture2D>),
    get_height: () => logicalHeight(state as AtlasState<GodotTexture2D>),
    get_size: () => vec2(
      logicalWidth(state as AtlasState<GodotTexture2D>),
      logicalHeight(state as AtlasState<GodotTexture2D>),
    ),
    has_alpha(): boolean {
      const method = state.atlas === null ? undefined : Reflect.get(state.atlas, 'has_alpha');
      if (state.atlas === null) return false;
      if (typeof method !== 'function') {
        throw new Error(
          'AtlasTexture.has_alpha() cannot inspect the source format of this browser-native texture.',
        );
      }
      return Boolean(method.call(state.atlas));
    },
    get_image: () => getAtlasImage(resource),
  });
  registerGodotObjectIdentity(resource, 'AtlasTexture');
  bindGodotResourceProtocol(resource, {
    createDuplicate(source) {
      return (source instanceof PixiTexture
        ? createGodotAtlasTexture(null, source.get_region(), source.get_margin(), source.has_filter_clip())
        : createGodotAtlasTexture3D(null, source.get_region(), source.get_margin(), source.has_filter_clip())) as unknown as typeof source;
    },
    populateDuplicate(source, target, subresources, memo) {
      const atlas = source.get_atlas();
      target.set_atlas(subresources ? duplicateGodotSubresource(atlas, memo) : atlas);
    },
    setupLocalToScene(source, scene) {
      const atlas = source.get_atlas();
      if (atlas !== null && getGodotResourceLocalToScene(atlas)) {
        godotResourceSetupLocalToScene(atlas, scene);
      }
    },
  });
  return resource;
}

export function createGodotAtlasTexture(
  atlas: PixiTexture | null = null,
  region: GodotRect2 = godotRect2New(),
  margin: GodotRect2 = godotRect2New(),
  filterClip = false,
): GodotAtlasTexture2D {
  const initial = atlas ?? PixiTexture.EMPTY;
  const native = new PixiTexture({
    source: initial.source,
    frame: new Rectangle(0, 0, 1, 1),
    orig: new Rectangle(0, 0, 1, 1),
    trim: new Rectangle(0, 0, 1, 1),
    dynamic: true,
  });
  const state: AtlasState<PixiTexture> = {
    atlas: null,
    region: rect(region, 'region'),
    margin: rect(margin, 'margin'),
    filterClip,
    nestedChanged: null,
    syncNative: () => {
      const source = state.atlas ?? PixiTexture.EMPTY;
      const selected = roundedRegion(state as AtlasState<GodotTexture2D>);
      if (selected.size.x < 0 || selected.size.y < 0) {
        throw new RangeError('AtlasTexture.region cannot be represented by Pixi with a negative size.');
      }
      const content = source.trim ?? new Rectangle(0, 0, source.orig.width, source.orig.height);
      const selectedRight = selected.position.x + selected.size.x;
      const selectedBottom = selected.position.y + selected.size.y;
      const contentRight = content.x + content.width;
      const contentBottom = content.y + content.height;
      const visibleX = Math.max(selected.position.x, content.x);
      const visibleY = Math.max(selected.position.y, content.y);
      const visibleWidth = Math.max(0, Math.min(selectedRight, contentRight) - visibleX);
      const visibleHeight = Math.max(0, Math.min(selectedBottom, contentBottom) - visibleY);
      native.source = source.source;
      native.frame.copyFrom(new Rectangle(
        source.frame.x + visibleX - content.x,
        source.frame.y + visibleY - content.y,
        visibleWidth,
        visibleHeight,
      ));
      native.orig.copyFrom(new Rectangle(0, 0, logicalWidth(state), logicalHeight(state)));
      native.trim.copyFrom(new Rectangle(
        state.margin.position.x + visibleX - selected.position.x,
        state.margin.position.y + visibleY - selected.position.y,
        visibleWidth,
        visibleHeight,
      ));
      native.update();
    },
  };
  const resource = installApi(native, state);
  resource.set_filter_clip(filterClip);
  resource.set_atlas(atlas);
  state.syncNative();
  return bindGodotTexture2DCanvasApi(resource);
}

export function createGodotAtlasTexture3D(
  atlas: ThreeTexture | null = null,
  region: GodotRect2 = godotRect2New(),
  margin: GodotRect2 = godotRect2New(),
  filterClip = false,
): GodotAtlasTexture3D {
  const empty = new ThreeTexture();
  const native = (atlas ?? empty).clone();
  const state: AtlasState<ThreeTexture> = {
    atlas: null,
    region: rect(region, 'region'),
    margin: rect(margin, 'margin'),
    filterClip,
    nestedChanged: null,
    syncNative: () => {
      const source = state.atlas;
      if (source === null) {
        native.source = empty.source;
        native.offset.set(0, 0);
        native.repeat.set(1, 1);
        native.flipY = empty.flipY;
        native.needsUpdate = true;
        return;
      }
      const selected = roundedRegion(state as AtlasState<GodotTexture2D>);
      const width = textureWidth(source);
      const height = textureHeight(source);
      native.source = source.source;
      native.image = source.image;
      native.flipY = source.flipY;
      native.offset.copy(source.offset);
      native.repeat.copy(source.repeat);
      native.offset.x += source.repeat.x * selected.position.x / width;
      native.offset.y += source.repeat.y * (source.flipY
        ? 1 - (selected.position.y + selected.size.y) / height
        : selected.position.y / height);
      native.repeat.x *= selected.size.x / width;
      native.repeat.y *= selected.size.y / height;
      native.needsUpdate = true;
    },
  };
  const resource = installApi(native, state);
  resource.set_filter_clip(filterClip);
  resource.set_atlas(atlas);
  state.syncNative();
  return resource;
}

/** Release the native subtexture view without destroying its separately owned atlas source. */
export function releaseGodotAtlasTexture(
  resource: GodotAtlasTexture2D | GodotAtlasTexture3D,
): void {
  const state = STATES.get(resource);
  if (state === undefined) return;
  state.nestedChanged?.disconnect();
  state.nestedChanged = null;
  STATES.delete(resource);
  if (resource instanceof PixiTexture) resource.destroy(false);
  else if (resource instanceof ThreeTexture) resource.dispose();
}
