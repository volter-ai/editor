/** Godot CameraTexture over host-provided native Pixi camera-feed textures. */

import { Rectangle, Texture } from 'pixi.js';
import type { GodotImage } from './image';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { GodotConnection } from './signal';
import { bindGodotTexture2DCanvasApi, getGodotTexture2DImage } from './texture-2d';
import { vec2, type Vector2 } from './vector2';

export interface GodotCameraTexture extends Texture {
  camera_feed_id: number;
  which_feed: number;
  set_camera_feed_id(feedId: number): void;
  get_camera_feed_id(): number;
  set_which_feed(feed: number): void;
  get_which_feed(): number;
  camera_is_active(): boolean;
  get_width(): number;
  get_height(): number;
  get_size(): Vector2;
  has_alpha(): boolean;
  get_image(): GodotImage | null;
}

interface CameraFeedRegistration {
  texture: Texture;
  readonly users: Set<GodotCameraTexture>;
}

interface CameraTextureState {
  feedId: number;
  feed: number;
  active: Texture | null;
  activeChanged: GodotConnection | null;
}

const FEEDS = new Map<string, CameraFeedRegistration>();
const STATES = new WeakMap<GodotCameraTexture, CameraTextureState>();

function key(feedId: number, feed: number): string {
  return `${feedId}:${feed}`;
}

function nonNegativeInteger(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`CameraTexture.${member} requires a non-negative integer.`);
  }
  return value;
}

function stateOf(resource: GodotCameraTexture): CameraTextureState {
  const state = STATES.get(resource);
  if (state === undefined) throw new Error('CameraTexture resource was released.');
  return state;
}

function dimensions(texture: Texture | null): Vector2 {
  if (texture === null) return vec2(1, 1);
  const getWidth = Reflect.get(texture, 'get_width');
  const getHeight = Reflect.get(texture, 'get_height');
  return vec2(
    typeof getWidth === 'function' ? Number(getWidth.call(texture)) : texture.orig.width,
    typeof getHeight === 'function' ? Number(getHeight.call(texture)) : texture.orig.height,
  );
}

function syncNative(resource: GodotCameraTexture, state: CameraTextureState): void {
  const source = state.active ?? Texture.EMPTY;
  resource.source = source.source;
  resource.frame.copyFrom(source.frame);
  resource.orig.copyFrom(source.orig);
  resource.trim.copyFrom(source.trim);
  resource.update();
}

function detach(resource: GodotCameraTexture, state: CameraTextureState): void {
  FEEDS.get(key(state.feedId, state.feed))?.users.delete(resource);
  state.activeChanged?.disconnect();
  state.activeChanged = null;
  state.active = null;
}

function refresh(resource: GodotCameraTexture): void {
  const state = stateOf(resource);
  detach(resource, state);
  const registration = FEEDS.get(key(state.feedId, state.feed));
  if (registration !== undefined) {
    registration.users.add(resource);
    state.active = registration.texture;
    state.activeChanged = godotResourceChangedSignal(registration.texture).connect(() => {
      syncNative(resource, state);
      godotResourceEmitChanged(resource);
    });
  }
  syncNative(resource, state);
  godotResourceEmitChanged(resource);
}

/** Register an already-authorized camera feed texture; returns an exact unregister callback. */
export function registerGodotCameraFeedTexture(
  feedIdValue: number,
  whichFeedValue: number,
  texture: Texture,
): () => void {
  const feedId = nonNegativeInteger(feedIdValue, 'camera_feed_id');
  const feed = nonNegativeInteger(whichFeedValue, 'which_feed');
  if (!(texture instanceof Texture)) throw new TypeError('CameraTexture feed requires a native Pixi Texture.');
  const feedKey = key(feedId, feed);
  const existing = FEEDS.get(feedKey);
  const users = existing?.users ?? new Set<GodotCameraTexture>();
  FEEDS.set(feedKey, { texture, users });
  for (const user of [...users]) refresh(user);
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    const current = FEEDS.get(feedKey);
    if (current?.texture !== texture) return;
    FEEDS.delete(feedKey);
    for (const user of [...current.users]) refresh(user);
  };
}

export function createGodotCameraTexture(
  cameraFeedId = 0,
  whichFeed = 0,
): GodotCameraTexture {
  const native = new Texture({
    source: Texture.EMPTY.source,
    frame: new Rectangle(0, 0, 1, 1),
    orig: new Rectangle(0, 0, 1, 1),
    dynamic: true,
  }) as GodotCameraTexture;
  const state: CameraTextureState = {
    feedId: nonNegativeInteger(cameraFeedId, 'camera_feed_id'),
    feed: nonNegativeInteger(whichFeed, 'which_feed'),
    active: null,
    activeChanged: null,
  };
  STATES.set(native, state);
  const nativeUpdate = native.update.bind(native);
  Object.defineProperties(native, {
    camera_feed_id: { configurable: true, enumerable: true, get: () => state.feedId, set: (value: number) => native.set_camera_feed_id(value) },
    which_feed: { configurable: true, enumerable: true, get: () => state.feed, set: (value: number) => native.set_which_feed(value) },
  });
  Object.assign(native, {
    set_camera_feed_id(value: number): void {
      const next = nonNegativeInteger(value, 'camera_feed_id');
      if (next === state.feedId) return;
      detach(native, state);
      state.feedId = next;
      refresh(native);
    },
    get_camera_feed_id: (): number => state.feedId,
    set_which_feed(value: number): void {
      const next = nonNegativeInteger(value, 'which_feed');
      if (next === state.feed) return;
      detach(native, state);
      state.feed = next;
      refresh(native);
    },
    get_which_feed: (): number => state.feed,
    camera_is_active: (): boolean => state.active !== null,
    get_width: (): number => dimensions(state.active).x,
    get_height: (): number => dimensions(state.active).y,
    get_size: (): Vector2 => dimensions(state.active),
    has_alpha(): boolean {
      if (state.active === null) return false;
      const method = Reflect.get(state.active, 'has_alpha');
      return typeof method === 'function' ? Boolean(method.call(state.active)) : false;
    },
    get_image: (): GodotImage | null => state.active === null ? null : getGodotTexture2DImage(state.active),
    update(): void { nativeUpdate(); },
  });
  registerGodotObjectIdentity(native, 'CameraTexture');
  bindGodotResourceProtocol(native, {
    createDuplicate(source) {
      return createGodotCameraTexture(source.get_camera_feed_id(), source.get_which_feed());
    },
  });
  refresh(native);
  return bindGodotTexture2DCanvasApi(native);
}

export function releaseGodotCameraTexture(resource: GodotCameraTexture): void {
  const state = STATES.get(resource);
  if (state === undefined) return;
  detach(resource, state);
  STATES.delete(resource);
  resource.destroy(false);
}
