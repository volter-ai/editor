import { registerGodotObjectIdentity } from './object';
import { packedStringArray, type PackedStringArray } from './packed-array';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
} from './resource-io';
import { compareString } from './string-core';

export interface GodotSpriteFrame<TTexture> {
  texture: TTexture | null;
  duration: number;
}

export interface GodotSpriteAnimation<TTexture> {
  frames: GodotSpriteFrame<TTexture>[];
  speed: number;
  loop: boolean;
  loopMode?: 0 | 1 | 2;
}

export interface GodotSpriteFrames<TTexture> {
  readonly animations: Record<string, GodotSpriteAnimation<TTexture>>;
  add_animation(name: string): void;
  duplicate_animation(name: string, newName: string): void;
  has_animation(name: string): boolean;
  remove_animation(name: string): void;
  rename_animation(name: string, newName: string): void;
  get_animation_names(): PackedStringArray;
  set_animation_speed(name: string, fps: number): void;
  get_animation_speed(name: string): number;
  set_animation_loop(name: string, loop: boolean): void;
  get_animation_loop(name: string): boolean;
  set_animation_loop_mode(name: string, mode: number): void;
  get_animation_loop_mode(name: string): number;
  get_frame_count(name: string): number;
  add_frame(name: string, texture: TTexture | null, duration?: number, atPosition?: number): void;
  set_frame(name: string, index: number, texture: TTexture | null, duration?: number): void;
  remove_frame(name: string, index: number): void;
  clear(name: string): void;
  clear_all(): void;
  get_frame(name: string, index: number): TTexture | null;
  get_frame_texture(name: string, index: number): TTexture | null;
  set_frame_duration(name: string, index: number, duration: number): void;
  get_frame_duration(name: string, index: number): number;
  _set_animations(
    value:
      | readonly SpriteFramesSerializedAnimation<TTexture>[]
      | Readonly<Record<string, SpriteFramesAnimationInput<TTexture>>>,
  ): void;
  _get_animations(): readonly SpriteFramesSerializedAnimation<TTexture>[];
}

export const SPRITE_FRAME_MINIMUM_DURATION = 0.01;

export interface SpriteFramesAnimationInput<TTexture> {
  readonly frames?: readonly ({ readonly texture: TTexture | null; readonly duration?: number } | TTexture | null)[];
  readonly textures?: readonly (TTexture | null)[];
  readonly durations?: readonly number[];
  readonly speed?: number;
  readonly loop?: boolean;
  readonly loopMode?: 0 | 1 | 2;
}

export interface SpriteFramesSerializedAnimation<TTexture> {
  readonly name: string;
  readonly speed?: number;
  /** Godot 3 serializes bool; Godot 4 serializes the LoopMode enum in this same field. */
  readonly loop?: boolean | 0 | 1 | 2;
  readonly loop_mode?: 0 | 1 | 2;
  readonly frames?: readonly (
    | TTexture
    | null
    | { readonly texture: TTexture | null; readonly duration?: number }
  )[];
}

type ChangeListener<TTexture> = (
  resource: GodotSpriteFrames<TTexture>,
  animationName: string | undefined,
) => void;

interface SpriteFramesState<TTexture> {
  readonly major: 3 | 4;
  readonly listeners: Set<ChangeListener<TTexture>>;
}

const STATES = new WeakMap<object, SpriteFramesState<unknown>>();

function requireName(name: string, caller: string): string {
  if (typeof name !== 'string') throw new TypeError(`SpriteFrames.${caller} requires StringName.`);
  if (name.length === 0) throw new RangeError(`SpriteFrames.${caller} requires a nonempty animation name.`);
  return name;
}

function requireAnimation<TTexture>(
  resource: GodotSpriteFrames<TTexture>,
  name: string,
  caller: string,
): GodotSpriteAnimation<TTexture> {
  requireName(name, caller);
  const animation = resource.animations[name];
  if (animation === undefined) {
    throw new RangeError(`SpriteFrames.${caller} cannot find animation \"${name}\".`);
  }
  return animation;
}

function requireIndex<TTexture>(
  resource: GodotSpriteFrames<TTexture>,
  name: string,
  index: number,
  caller: string,
): { animation: GodotSpriteAnimation<TTexture>; index: number } {
  const animation = requireAnimation(resource, name, caller);
  if (!Number.isSafeInteger(index) || index < 0 || index >= animation.frames.length) {
    throw new RangeError(
      `SpriteFrames.${caller} frame index ${String(index)} is outside animation \"${name}\" ` +
        `(frame count ${animation.frames.length}).`,
    );
  }
  return { animation, index };
}

function requireSpeed(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('SpriteFrames animation speed must be a finite nonnegative value.');
  }
  return value;
}

function requireDuration(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('SpriteFrames frame duration must be finite.');
  return Math.max(SPRITE_FRAME_MINIMUM_DURATION, value);
}

function requireLoopMode(value: number): 0 | 1 | 2 {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2) {
    throw new RangeError('SpriteFrames animation loop mode must be NONE=0, LINEAR=1, or PINGPONG=2.');
  }
  return value as 0 | 1 | 2;
}

function stateOf<TTexture>(resource: GodotSpriteFrames<TTexture>): SpriteFramesState<TTexture> {
  const state = STATES.get(resource) as SpriteFramesState<TTexture> | undefined;
  if (state === undefined) throw new TypeError('Expected a SpriteFrames resource created by godot-compat.');
  return state;
}

/** The engine generation whose SpriteFrames playback rules this retained resource follows. */
export function godotSpriteFramesMajor<TTexture>(resource: GodotSpriteFrames<TTexture>): 3 | 4 {
  return stateOf(resource).major;
}

function changed<TTexture>(resource: GodotSpriteFrames<TTexture>, animationName?: string): void {
  for (const listener of stateOf(resource).listeners) listener(resource, animationName);
  godotResourceEmitChanged(resource);
}

function normalizeAnimation<TTexture>(
  input: SpriteFramesAnimationInput<TTexture>,
): GodotSpriteAnimation<TTexture> {
  const rawFrames = input.frames ?? input.textures ?? [];
  const frames = rawFrames.map((raw, index): GodotSpriteFrame<TTexture> => {
    if (raw !== null && typeof raw === 'object' && 'texture' in raw && 'duration' in raw) {
      const cell = raw as { readonly texture: TTexture | null; readonly duration?: number };
      return { texture: cell.texture, duration: requireDuration(cell.duration ?? 1) };
    }
    return {
      texture: raw as TTexture | null,
      duration: requireDuration(input.durations?.[index] ?? 1),
    };
  });
  return {
    frames,
    speed: requireSpeed(input.speed ?? 5),
    loop: input.loop ?? true,
    ...(input.loopMode === undefined ? {} : { loopMode: input.loopMode }),
  };
}

export function createGodotSpriteFrames<TTexture>(
  major: 3 | 4 = 4,
  initial: Readonly<Record<string, SpriteFramesAnimationInput<TTexture>>> = {},
): GodotSpriteFrames<TTexture> {
  const animations: Record<string, GodotSpriteAnimation<TTexture>> = Object.create(null) as Record<
    string,
    GodotSpriteAnimation<TTexture>
  >;
  for (const [name, animation] of Object.entries(initial)) {
    requireName(name, 'create');
    animations[name] = normalizeAnimation(animation);
  }
  if (Object.keys(animations).length === 0) {
    animations['default'] = { frames: [], speed: 5, loop: true };
  }

  const resource = {
    animations,
    add_animation(name: string): void {
      requireName(name, 'add_animation');
      if (animations[name] !== undefined) {
        throw new Error(`SpriteFrames.add_animation cannot replace existing animation \"${name}\".`);
      }
      animations[name] = { frames: [], speed: 5, loop: true };
      changed(resource, name);
    },
    duplicate_animation(name: string, newName: string): void {
      const source = requireAnimation(resource, name, 'duplicate_animation');
      requireName(newName, 'duplicate_animation');
      if (animations[newName] !== undefined) {
        throw new Error(`SpriteFrames.duplicate_animation cannot replace existing animation \"${newName}\".`);
      }
      animations[newName] = {
        frames: source.frames.map((frame) => ({ ...frame })),
        speed: source.speed,
        loop: source.loop,
        ...(source.loopMode === undefined ? {} : { loopMode: source.loopMode }),
      };
      changed(resource, newName);
    },
    has_animation(name: string): boolean {
      if (typeof name !== 'string') throw new TypeError('SpriteFrames.has_animation requires StringName.');
      return animations[name] !== undefined;
    },
    remove_animation(name: string): void {
      requireAnimation(resource, name, 'remove_animation');
      delete animations[name];
      changed(resource, name);
    },
    rename_animation(name: string, newName: string): void {
      const animation = requireAnimation(resource, name, 'rename_animation');
      requireName(newName, 'rename_animation');
      if (name === newName) return;
      if (animations[newName] !== undefined) {
        throw new Error(`SpriteFrames.rename_animation cannot replace existing animation \"${newName}\".`);
      }
      delete animations[name];
      animations[newName] = animation;
      changed(resource, name);
      changed(resource, newName);
    },
    get_animation_names(): PackedStringArray {
      return packedStringArray(Object.keys(animations).sort(compareString));
    },
    set_animation_speed(name: string, fps: number): void {
      const animation = requireAnimation(resource, name, 'set_animation_speed');
      const next = requireSpeed(fps);
      if (animation.speed === next) return;
      animation.speed = next;
      changed(resource, name);
    },
    get_animation_speed(name: string): number {
      return requireAnimation(resource, name, 'get_animation_speed').speed;
    },
    set_animation_loop(name: string, loop: boolean): void {
      if (typeof loop !== 'boolean') throw new TypeError('SpriteFrames.set_animation_loop requires bool.');
      const animation = requireAnimation(resource, name, 'set_animation_loop');
      if (animation.loop === loop) return;
      animation.loop = loop;
      if (animation.loopMode !== undefined) animation.loopMode = loop ? 1 : 0;
      changed(resource, name);
    },
    get_animation_loop(name: string): boolean {
      return requireAnimation(resource, name, 'get_animation_loop').loop;
    },
    set_animation_loop_mode(name: string, mode: number): void {
      if (major === 3) throw new Error('SpriteFrames.set_animation_loop_mode is unavailable in Godot 3.');
      const animation = requireAnimation(resource, name, 'set_animation_loop_mode');
      const next = requireLoopMode(mode);
      if (animation.loopMode === next) return;
      animation.loopMode = next;
      animation.loop = next !== 0;
      changed(resource, name);
    },
    get_animation_loop_mode(name: string): number {
      if (major === 3) throw new Error('SpriteFrames.get_animation_loop_mode is unavailable in Godot 3.');
      const animation = requireAnimation(resource, name, 'get_animation_loop_mode');
      return animation.loopMode ?? (animation.loop ? 1 : 0);
    },
    get_frame_count(name: string): number {
      return requireAnimation(resource, name, 'get_frame_count').frames.length;
    },
    add_frame(name: string, texture: TTexture | null, durationOrPosition = 1, authoredPosition = -1): void {
      const animation = requireAnimation(resource, name, 'add_frame');
      const duration = major === 3 ? 1 : durationOrPosition;
      const atPosition = major === 3 ? durationOrPosition : authoredPosition;
      const frame = { texture, duration: requireDuration(duration) };
      if (!Number.isSafeInteger(atPosition) || atPosition < -1) {
        throw new RangeError(`SpriteFrames.add_frame insertion index ${String(atPosition)} is invalid.`);
      }
      if (atPosition === -1 || atPosition >= animation.frames.length) animation.frames.push(frame);
      else animation.frames.splice(atPosition, 0, frame);
      changed(resource, name);
    },
    set_frame(name: string, index: number, texture: TTexture | null, duration?: number): void {
      const found = requireIndex(resource, name, index, 'set_frame');
      found.animation.frames[index] = {
        texture,
        duration: major === 3
          ? found.animation.frames[index]!.duration
          : requireDuration(duration ?? 1),
      };
      changed(resource, name);
    },
    remove_frame(name: string, index: number): void {
      const found = requireIndex(resource, name, index, 'remove_frame');
      found.animation.frames.splice(index, 1);
      changed(resource, name);
    },
    clear(name: string): void {
      const animation = requireAnimation(resource, name, 'clear');
      if (animation.frames.length === 0) return;
      animation.frames.length = 0;
      changed(resource, name);
    },
    clear_all(): void {
      for (const name of Object.keys(animations)) delete animations[name];
      animations['default'] = {
        frames: [],
        speed: 5,
        loop: true,
        ...(major === 4 ? { loopMode: 1 as const } : {}),
      };
      changed(resource);
    },
    get_frame(name: string, index: number): TTexture | null {
      if (major === 4) throw new Error('SpriteFrames.get_frame was renamed to get_frame_texture in Godot 4.');
      return requireIndex(resource, name, index, 'get_frame').animation.frames[index]!.texture;
    },
    get_frame_texture(name: string, index: number): TTexture | null {
      if (major === 3) throw new Error('SpriteFrames.get_frame_texture is unavailable in Godot 3; use get_frame.');
      return requireIndex(resource, name, index, 'get_frame_texture').animation.frames[index]!.texture;
    },
    set_frame_duration(name: string, index: number, duration: number): void {
      if (major === 3) throw new Error('SpriteFrames.set_frame_duration is unavailable in Godot 3.');
      const found = requireIndex(resource, name, index, 'set_frame_duration');
      const next = requireDuration(duration);
      if (found.animation.frames[index]!.duration === next) return;
      found.animation.frames[index]!.duration = next;
      changed(resource, name);
    },
    get_frame_duration(name: string, index: number): number {
      if (major === 3) throw new Error('SpriteFrames.get_frame_duration is unavailable in Godot 3.');
      return requireIndex(resource, name, index, 'get_frame_duration').animation.frames[index]!.duration;
    },
    _set_animations(value): void {
      for (const name of Object.keys(animations)) delete animations[name];
      if (Array.isArray(value)) {
        for (const raw of value) {
          if (raw === null || typeof raw !== 'object') {
            throw new TypeError('SpriteFrames._set_animations entries must be dictionaries.');
          }
          const name = requireName(raw.name, '_set_animations');
          if (animations[name] !== undefined) {
            throw new Error(`SpriteFrames._set_animations contains duplicate animation \"${name}\".`);
          }
          const loopMode = major === 4
            ? (typeof raw.loop === 'number' ? requireLoopMode(raw.loop) : raw.loop_mode)
            : undefined;
          animations[name] = normalizeAnimation({
            ...(raw.frames === undefined ? {} : { frames: raw.frames }),
            ...(raw.speed === undefined ? {} : { speed: raw.speed }),
            loop: major === 3
              ? (typeof raw.loop === 'boolean' ? raw.loop : true)
              : (typeof raw.loop === 'number'
                  ? raw.loop !== 0
                  : (raw.loop ?? (raw.loop_mode === undefined || raw.loop_mode !== 0))),
            ...(loopMode === undefined ? {} : { loopMode }),
          });
        }
      } else if (value !== null && typeof value === 'object') {
        for (const [name, animation] of Object.entries(value)) {
          requireName(name, '_set_animations');
          animations[name] = normalizeAnimation(animation);
        }
      } else {
        throw new TypeError('SpriteFrames._set_animations requires the serialized animations Array.');
      }
      if (Object.keys(animations).length === 0) {
        animations['default'] = {
          frames: [],
          speed: 5,
          loop: true,
          ...(major === 4 ? { loopMode: 1 as const } : {}),
        };
      }
      changed(resource);
    },
    _get_animations(): readonly SpriteFramesSerializedAnimation<TTexture>[] {
      return Object.keys(animations).sort(compareString).map((name) => {
        const animation = animations[name]!;
        return major === 3
          ? {
              name,
              speed: animation.speed,
              loop: animation.loop,
              frames: animation.frames.map((frame) => frame.texture),
            }
          : {
              name,
              speed: animation.speed,
              loop: animation.loopMode ?? (animation.loop ? 1 : 0),
              frames: animation.frames.map((frame) => ({ ...frame })),
            };
      });
    },
  } satisfies GodotSpriteFrames<TTexture>;

  STATES.set(resource, { major, listeners: new Set() } as SpriteFramesState<unknown>);
  registerGodotObjectIdentity(resource, 'SpriteFrames');
  return bindGodotResourceProtocol(resource, {
    createDuplicate() {
      return createGodotSpriteFrames<TTexture>(major);
    },
    populateDuplicate(source, target, subresources, memo) {
      target._set_animations(source._get_animations().map((animation) => {
        const frames = animation.frames?.map((frame) => {
          if (frame === null) return null;
          if (typeof frame === 'object' && 'texture' in frame) {
            return {
              ...frame,
              texture: subresources
                ? duplicateGodotSubresource(frame.texture, memo)
                : frame.texture,
            };
          }
          return subresources ? duplicateGodotSubresource(frame, memo) : frame;
        });
        return {
          ...animation,
          ...(frames === undefined ? {} : { frames }),
        };
      }));
    },
  });
}

export function observeGodotSpriteFrames<TTexture>(
  resource: GodotSpriteFrames<TTexture>,
  listener: ChangeListener<TTexture>,
): () => void {
  const listeners = stateOf(resource).listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resource operations used by translated dynamic calls without exposing the internal Map. */
export function spriteFramesHasAnimation<TTexture>(
  resource: GodotSpriteFrames<TTexture>,
  name: string,
): boolean {
  return resource.has_animation(name);
}

export function spriteFramesAnimationNames<TTexture>(
  resource: GodotSpriteFrames<TTexture>,
): PackedStringArray {
  return resource.get_animation_names();
}

export function spriteFramesFrameTexture<TTexture>(
  resource: GodotSpriteFrames<TTexture>,
  animation: string,
  frame: number,
): TTexture | null {
  return stateOf(resource).major === 3
    ? resource.get_frame(animation, frame)
    : resource.get_frame_texture(animation, frame);
}
