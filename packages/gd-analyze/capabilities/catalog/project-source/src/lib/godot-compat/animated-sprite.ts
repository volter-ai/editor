/**
 * `AnimatedSprite` and `SpriteFrames` — the pilot's single biggest requisition
 * (7 of its 29 engine members) and the one place Pixi's own object genuinely
 * does not answer the question.
 *
 * ## What Pixi already has, and what it does not
 *
 * Pixi's `AnimatedSprite` is ONE animation: an array of textures plus a play
 * head. Godot's is a NAMED SET of animations (`SpriteFrames`) plus a `animation`
 * string selecting one. `Player.gd` flips between `"right"` and `"up"`;
 * `Mob.gd:6-7` reads `frames.get_animation_names()` and picks a random walk
 * cycle. Nothing in Pixi holds that set, so this file does — and holds ONLY
 * that:
 *
 * | Godot | backend |
 * |---|---|
 * | `sprite.play()` / `stop()` | Pixi's own `play()` / `stop()` |
 * | `sprite.playing` (READ) | Pixi's own `playing` getter |
 * | `sprite.playing = true` | real: Pixi's `playing` is read-only, so it is `play()`/`stop()` |
 * | `sprite.flip_h` / `flip_v` | real: a negative `scale` component |
 * | `sprite.centered` / `offset` | retained values projected onto Pixi's native frame anchor |
 * | `sprite.frames` | this file: `SpriteFrames` has no Pixi counterpart |
 * | `sprite.animation` | this file: selects `frames`' named texture list |
 * | `frames.get_animation_names()` | this file: the set's keys, sorted |
 *
 * Everything else about the sprite stays Pixi's: the returned object IS the
 * `AnimatedSprite`, so `tint`, `scale`, `position` and every other call after
 * this one is Pixi's own API. Helper, not wrapper — the return path is the
 * library's object.
 *
 * ## Where the SpriteFrames set lives: a `WeakMap`, not a property
 *
 * `roblox-compat` records its extra slots in three's `userData`, which exists
 * for exactly that. Pixi has no `userData`, and fabricating a field on a
 * `Container` would be inventing an engine property that nothing else in the
 * repo reads. A module-level `WeakMap` keyed on the sprite carries the frames
 * and the current animation name instead: no fabricated surface, and a sprite
 * that is destroyed takes its entry with it.
 *
 * ## `autoUpdate` is forced OFF, and the caller steps the sprite
 *
 * Pixi's `AnimatedSprite.play()` subscribes to `Ticker.shared`, which runs on
 * `requestAnimationFrame`. That is a second, undeterministic timeline — the
 * same objection `timer.ts` and `roblox-compat`'s `TweenService` record — and
 * in a headless test it throws outright (`requestAnimationFrame is not
 * defined`). So {@link play} sets `autoUpdate = false` first, and the port
 * advances the sprite from time it already has:
 *
 * ```ts
 * app.ticker.add((ticker) => advanceAnimation(sprite, ticker.deltaMS / 1000));
 * ```
 *
 * Every clock is the caller's — nothing here joins a shared ticker.
 * {@link advanceAnimation} ports Godot's frame-duration/progress walk and writes each resulting
 * visible frame onto this same retained Pixi object.
 */

import { AnimatedSprite, Texture, type PointData } from 'pixi.js';
import { registerGodotObjectIdentity } from './object';
import {
  createGodotSpriteFrames,
  godotSpriteFramesMajor,
  observeGodotSpriteFrames,
  type GodotSpriteAnimation,
  type GodotSpriteFrames,
} from './sprite-frames';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/** One named animation in a `SpriteFrames`. */
export interface SpriteAnimation {
  readonly textures: readonly (Texture | null)[];
  readonly durations?: readonly number[];
  /** Godot's per-animation `speed`, in FRAMES PER SECOND. Godot's default is 5. */
  readonly speed?: number;
  /** Godot's per-animation `loop`. Default true, as in Godot. */
  readonly loop?: boolean;
}

/** Godot's `SpriteFrames` resource — a named set of animations. */
export type SpriteFrames = GodotSpriteFrames<Texture>;

export type GodotCanvasAnimatedSprite = AnimatedSprite & {
  frames: SpriteFrames;
  sprite_frames: SpriteFrames;
  animation: string;
  frame: number;
  frame_progress: number;
  speed_scale: number;
  playing: boolean;
  centered: boolean;
  offset: PointData;
  flip_h: boolean;
  flip_v: boolean;
  readonly animation_finished: GodotSignal<readonly []>;
  set_sprite_frames(frames: SpriteFrames): void;
  get_sprite_frames(): SpriteFrames;
  set_frames(frames: SpriteFrames): void;
  get_frames(): SpriteFrames;
  set_animation(name: string): void;
  get_animation(): string;
  set_frame(frame: number): void;
  get_frame(): number;
  set_frame_and_progress(frame: number, progress: number): void;
  set_frame_progress(progress: number): void;
  get_frame_progress(): number;
  set_speed_scale(scale: number): void;
  get_speed_scale(): number;
  set_playing(playing: boolean): void;
  is_playing(): boolean;
  play(name?: string, customSpeed?: number, fromEnd?: boolean): void;
  play_backwards(name?: string): void;
  pause(): void;
  stop(): void;
  set_centered(centered: boolean): void;
  is_centered(): boolean;
  set_offset(offset: PointData): void;
  get_offset(): PointData;
  set_flip_h(flipped: boolean): void;
  is_flipped_h(): boolean;
  set_flip_v(flipped: boolean): void;
  is_flipped_v(): boolean;
};

/** Godot's own default animation speed, in FPS. */
export const DEFAULT_ANIMATION_SPEED = 5;

/** Runtime AnimatedSprite.new() with Godot's retained default SpriteFrames identity. */
export function createGodotCanvasAnimatedSprite(major: 3 | 4): GodotCanvasAnimatedSprite {
  const sprite = new AnimatedSprite([Texture.EMPTY]);
  sprite.autoUpdate = false;
  registerGodotObjectIdentity(sprite, major === 3 ? 'AnimatedSprite' : 'AnimatedSprite2D');
  setFrames(sprite, createSpriteFrames({
    default: { textures: [Texture.EMPTY], speed: DEFAULT_ANIMATION_SPEED, loop: true },
  }, major));
  return sprite as GodotCanvasAnimatedSprite;
}

/** Build a `SpriteFrames`. The emitted project reads these off the `.tscn`'s
 *  `SubResource( "SpriteFrames" )` block. */
export function createSpriteFrames(
  animations: Readonly<Record<string, SpriteAnimation>>,
  major: 3 | 4 = 4,
): SpriteFrames {
  return createGodotSpriteFrames(major, Object.fromEntries(
    Object.entries(animations).map(([name, animation]) => [name, {
      textures: animation.textures,
      ...(animation.durations === undefined ? {} : { durations: animation.durations }),
      ...(animation.speed === undefined ? {} : { speed: animation.speed }),
      ...(animation.loop === undefined ? {} : { loop: animation.loop }),
    }]),
  ));
}

/**
 * `frames.get_animation_names()` — `Mob.gd:6`.
 *
 * SORTED, because Godot's is: `SpriteFrames` stores its animations in a sorted
 * map and returns the names in that order. `Mob.gd:7` indexes the result with
 * `randi() % size()`, so an unsorted order would make the same seed pick a
 * different mob — a determinism difference hiding behind an ordering detail.
 */
export function getAnimationNames(frames: SpriteFrames): string[] {
  return [...frames.get_animation_names()];
}

/** What a sprite carries beyond Pixi's own state. */
interface SpriteState {
  major: 3 | 4;
  frames: SpriteFrames;
  animation: string;
  speedScale: number;
  customSpeedScale: number;
  frameProgress: number;
  centered: boolean;
  offset: PointData;
  releaseFrames: () => void;
  readonly nativePlay: () => void;
  readonly nativeStop: () => void;
  readonly nativeIsPlaying: () => boolean;
  readonly animationFinished: SignalHandle<readonly []>;
}

const STATE = new WeakMap<AnimatedSprite, SpriteState>();

function stateOf(sprite: AnimatedSprite, caller: string): SpriteState {
  const state = STATE.get(sprite);
  if (state === undefined) {
    throw new Error(
      `godot-compat: ${caller} was called on an AnimatedSprite with no SpriteFrames. Call ` +
        "setFrames(sprite, frames) first — Godot's AnimatedSprite carries its `frames` resource " +
        'and a Pixi AnimatedSprite has nowhere to hold one, so compat is told rather than ' +
        'guessing which texture list is which animation.',
    );
  }
  return state;
}

function finiteAnimatedSpriteOffset(value: PointData): PointData {
  if (
    typeof value !== 'object' || value === null ||
    typeof value.x !== 'number' || !Number.isFinite(value.x) ||
    typeof value.y !== 'number' || !Number.isFinite(value.y)
  ) {
    throw new TypeError('AnimatedSprite.offset requires a finite Vector2.');
  }
  return { x: value.x, y: value.y };
}

/**
 * Godot draws the active frame at `offset - size / 2` when centered, and at `offset` otherwise.
 * Pixi's anchor is normalized to the active frame, so the exact native equivalent changes when a
 * differently-sized frame becomes current. Every playhead mutation calls this same seam.
 */
function syncAnimatedSpriteLayout(sprite: AnimatedSprite): void {
  const state = STATE.get(sprite);
  if (state === undefined) return;
  const width = sprite.texture.orig.width;
  const height = sprite.texture.orig.height;
  if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) {
    throw new RangeError('AnimatedSprite active-frame dimensions must be finite and non-negative.');
  }
  const anchor = (size: number, offset: number, flipped: boolean): number => {
    const centered = state.centered ? 0.5 : 0;
    // An empty frame draws no destination rect. Keep its origin finite; the retained pixel offset
    // is applied as soon as a non-empty frame becomes current.
    if (size === 0) return flipped ? 1 - centered : centered;
    const unflipped = centered - offset / size;
    // Godot flips texture sampling WITHIN the same authored destination rect. Pixi flips geometry
    // around the anchor, so reflecting the anchor preserves that rect under negative scale.
    return flipped ? 1 - unflipped : unflipped;
  };
  sprite.anchor.set(
    anchor(width, state.offset.x, sprite.scale.x < 0),
    anchor(height, state.offset.y, sprite.scale.y < 0),
  );
}

function setAnimatedSpritePlayhead(sprite: AnimatedSprite, frame: number, progress: number): void {
  const state = stateOf(sprite, 'setAnimatedSpritePlayhead()');
  sprite.currentFrame = frame;
  state.frameProgress = progress;
  syncAnimatedSpriteLayout(sprite);
}

function startNativePlayback(sprite: AnimatedSprite): void {
  sprite.autoUpdate = false;
  stateOf(sprite, 'play()').nativePlay();
}

/** Seat authored layout state on the same retained Pixi object that runtime property writes use. */
export function bindAnimatedSpriteLayout(
  sprite: AnimatedSprite,
  centered: boolean,
  offset: PointData,
): void {
  if (typeof centered !== 'boolean') throw new TypeError('AnimatedSprite.centered requires bool.');
  const state = stateOf(sprite, 'bindAnimatedSpriteLayout()');
  state.centered = centered;
  state.offset = finiteAnimatedSpriteOffset(offset);
  syncAnimatedSpriteLayout(sprite);
}

export function isAnimatedSpriteCentered(sprite: AnimatedSprite): boolean {
  return stateOf(sprite, 'AnimatedSprite.centered').centered;
}

export function setAnimatedSpriteCentered(sprite: AnimatedSprite, centered: boolean): void {
  if (typeof centered !== 'boolean') throw new TypeError('AnimatedSprite.centered requires bool.');
  stateOf(sprite, 'AnimatedSprite.centered').centered = centered;
  syncAnimatedSpriteLayout(sprite);
}

export function getAnimatedSpriteOffset(sprite: AnimatedSprite): PointData {
  const offset = stateOf(sprite, 'AnimatedSprite.offset').offset;
  return { x: offset.x, y: offset.y };
}

export function setAnimatedSpriteOffset(sprite: AnimatedSprite, offset: PointData): void {
  stateOf(sprite, 'AnimatedSprite.offset').offset = finiteAnimatedSpriteOffset(offset);
  syncAnimatedSpriteLayout(sprite);
}

/**
 * `sprite.frames = spriteFrames` — `Mob.gd:6` reads it back off the sprite.
 *
 * Selects the FIRST animation by name order, matching Godot: assigning a
 * `SpriteFrames` sets `animation` to its first entry (Godot uses `"default"`
 * when one exists, which is also first alphabetically in every set that has
 * one). Playback state is not started; a `.tscn` decides that with `playing`.
 */
export function setFrames(sprite: AnimatedSprite, frames: SpriteFrames): void {
  const names = getAnimationNames(frames);
  const first = names.includes('default') ? 'default' : names[0];
  if (first === undefined) {
    throw new Error(
      'godot-compat: setFrames() was given a SpriteFrames with no animations. Godot renders ' +
        'nothing for such a sprite and reports an empty animation name; there is no honest ' +
        'value to select here.',
    );
  }
  const previous = STATE.get(sprite);
  const nativePlay = previous?.nativePlay ?? sprite.play.bind(sprite);
  const nativeStop = previous?.nativeStop ?? sprite.stop.bind(sprite);
  const nativePlayingDescriptor = (() => {
    for (let owner: object | null = Object.getPrototypeOf(sprite); owner !== null; owner = Object.getPrototypeOf(owner)) {
      const descriptor = Object.getOwnPropertyDescriptor(owner, 'playing');
      if (descriptor?.get !== undefined) return descriptor.get.bind(sprite) as () => boolean;
    }
    return undefined;
  })();
  previous?.releaseFrames();
  const state: SpriteState = {
    major: godotSpriteFramesMajor(frames),
    frames,
    animation: first,
    speedScale: previous?.speedScale ?? 1,
    customSpeedScale: previous?.customSpeedScale ?? 1,
    frameProgress: 0,
    centered: previous?.centered ?? true,
    offset: previous === undefined ? { x: 0, y: 0 } : { ...previous.offset },
    releaseFrames: () => {},
    nativePlay,
    nativeStop,
    nativeIsPlaying: previous?.nativeIsPlaying ?? nativePlayingDescriptor ?? (() => false),
    animationFinished: previous?.animationFinished ?? createSignal<readonly []>(),
  };
  state.releaseFrames = observeGodotSpriteFrames(frames, () => {
    if (frames.animations[state.animation] === undefined) {
      const names = getAnimationNames(frames);
      state.animation = names.includes('default') ? 'default' : (names[0] ?? '');
    }
    const active = frames.animations[state.animation];
    if (active !== undefined) applyAnimation(sprite, active);
    else {
      state.nativeStop();
      sprite.visible = false;
    }
  });
  STATE.set(sprite, state);
  applyAnimation(sprite, frames.animations[first]!);
  bindGodotCanvasAnimatedSpriteApi(sprite);
}

/** `sprite.frames` — the set assigned by {@link setFrames}. */
export function getFrames(sprite: AnimatedSprite): SpriteFrames {
  return stateOf(sprite, 'getFrames()').frames;
}

/** Point the sprite's textures at one named animation, preserving playback. */
function applyAnimation(sprite: AnimatedSprite, animation: GodotSpriteAnimation<Texture>): void {
  // Pixi's `textures` setter calls gotoAndStop(0). Godot's `animation = "…"`
  // restarts at frame 0 but KEEPS playing, which is what `Player.gd:36`
  // depends on — it reassigns `animation` every frame while walking.
  const wasPlaying = stateOf(sprite, 'applyAnimation()').nativeIsPlaying();
  if (animation.frames.length === 0) {
    stateOf(sprite, 'applyAnimation()').nativeStop();
    sprite.visible = false;
    return;
  }
  sprite.visible = true;
  if (animation.speed === 0) {
    sprite.textures = animation.frames.map((frame) => frame.texture ?? Texture.EMPTY) as AnimatedSprite['textures'];
    sprite.animationSpeed = 0;
  } else {
    sprite.textures = animation.frames.map((frame) => ({
      texture: frame.texture ?? Texture.EMPTY,
      time: frame.duration * 1_000 / animation.speed,
    })) as AnimatedSprite['textures'];
    const state = stateOf(sprite, 'applyAnimation()');
    sprite.animationSpeed = state.speedScale * state.customSpeedScale;
  }
  stateOf(sprite, 'applyAnimation()').frameProgress = 0;
  sprite.loop = animation.loop;
  syncAnimatedSpriteLayout(sprite);
  if (wasPlaying) startNativePlayback(sprite);
}

/**
 * `sprite.animation = "right"` — `Player.gd:36`, `:40`; `Mob.gd:7`.
 *
 * @throws naming the animation and the ones that exist. Godot prints an error
 * and leaves the sprite on its previous animation, which in a port looks like
 * the character simply stopped changing pose.
 */
export function setAnimation(sprite: AnimatedSprite, name: string): void {
  const state = stateOf(sprite, `setAnimation("${name}")`);
  const animation = state.frames.animations[name];
  if (animation === undefined) {
    throw new Error(
      `godot-compat: sprite.animation = "${name}", which this SpriteFrames does not have. ` +
        `Available: ${getAnimationNames(state.frames).join(', ')}.`,
    );
  }
  if (state.animation === name) return;
  state.animation = name;
  applyAnimation(sprite, animation);
}

/** `sprite.animation`. */
export function getAnimation(sprite: AnimatedSprite): string {
  return stateOf(sprite, 'getAnimation()').animation;
}

/** Godot 3 AnimatedSprite.speed_scale over Pixi's native animation clock multiplier. */
export function getAnimatedSpriteSpeedScale(sprite: AnimatedSprite): number {
  return stateOf(sprite, 'speed_scale').speedScale;
}

export function setAnimatedSpriteSpeedScale(sprite: AnimatedSprite, value: number): void {
  if (!Number.isFinite(value)) throw new TypeError('AnimatedSprite.speed_scale requires a finite number.');
  const state = stateOf(sprite, 'speed_scale');
  state.speedScale = value;
  const animation = state.frames.animations[state.animation];
  sprite.animationSpeed = animation?.speed === 0 ? 0 : value * state.customSpeedScale;
}

/** `AnimatedSprite2D.frame`: Pixi retains the same zero-based active-frame index. */
export function getAnimatedSpriteFrame(sprite: AnimatedSprite): number {
  stateOf(sprite, 'get_frame()');
  return sprite.currentFrame;
}

/** Select one frame without changing the play/pause state. */
export function setAnimatedSpriteFrame(sprite: AnimatedSprite, frame: number): void {
  const state = stateOf(sprite, 'set_frame()');
  if (!Number.isInteger(frame)) {
    throw new TypeError('godot-compat: AnimatedSprite2D.frame must be an integer.');
  }
  if (frame < 0 || frame >= sprite.totalFrames) {
    throw new RangeError(
      `godot-compat: AnimatedSprite2D.frame ${frame} is outside 0..${Math.max(0, sprite.totalFrames - 1)}.`,
    );
  }
  setAnimatedSpritePlayhead(sprite, frame, state.speedScale * state.customSpeedScale < 0 ? 1 : 0);
}

/** Godot 4's method spelling for the same retained playback flag. */
export function isAnimatedSpritePlaying(sprite: AnimatedSprite): boolean {
  return stateOf(sprite, 'is_playing()').nativeIsPlaying();
}

/**
 * `sprite.play()` — `Player.gd:27`.
 *
 * Forces `autoUpdate = false` before playing, so the sprite never joins Pixi's
 * shared rAF ticker. See this module's header for why that is a requirement
 * rather than a preference.
 */
export function play(
  sprite: AnimatedSprite,
  name?: string,
  customSpeed?: number,
  fromEnd?: boolean,
): void {
  const state = stateOf(sprite, 'play()');
  if (state.major === 3 && (customSpeed !== undefined || fromEnd !== undefined)) {
    throw new Error('Godot 3 AnimatedSprite.play accepts only the animation name.');
  }
  if (name !== undefined && typeof name !== 'string') {
    throw new TypeError('AnimatedSprite2D.play name requires StringName.');
  }
  const resolvedSpeed = customSpeed ?? 1;
  const resolvedFromEnd = fromEnd ?? false;
  if (!Number.isFinite(resolvedSpeed)) {
    throw new TypeError('AnimatedSprite2D.play custom_speed requires a finite float.');
  }
  if (typeof resolvedFromEnd !== 'boolean') {
    throw new TypeError('AnimatedSprite2D.play from_end requires bool.');
  }
  const chosen = name === undefined || name === '' ? state.animation : name;
  const animation = state.frames.animations[chosen];
  if (animation === undefined) {
    throw new Error(
      `godot-compat: play("${chosen}"), which this SpriteFrames does not have. ` +
        `Available: ${getAnimationNames(state.frames).join(', ')}.`,
    );
  }
  if (animation.frames.length === 0) return;

  const changedAnimation = chosen !== state.animation;
  state.customSpeedScale = resolvedSpeed;
  sprite.animationSpeed = animation.speed === 0 ? 0 : state.speedScale * resolvedSpeed;
  if (changedAnimation) {
    state.animation = chosen;
    applyAnimation(sprite, animation);
    setAnimatedSpritePlayhead(
      sprite,
      resolvedFromEnd ? animation.frames.length - 1 : 0,
      resolvedFromEnd ? 1 : 0,
    );
  } else {
    const backwards = state.speedScale * state.customSpeedScale < 0;
    if (resolvedFromEnd && backwards && sprite.currentFrame === 0 && state.frameProgress <= 0) {
      setAnimatedSpritePlayhead(sprite, animation.frames.length - 1, 1);
    } else if (
      !resolvedFromEnd &&
      !backwards &&
      sprite.currentFrame === animation.frames.length - 1 &&
      state.frameProgress >= 1
    ) {
      setAnimatedSpritePlayhead(sprite, 0, 0);
    }
  }
  startNativePlayback(sprite);
}

/** `sprite.stop()` — `Player.gd:29`. */
export function stop(sprite: AnimatedSprite): void {
  stateOf(sprite, 'stop()').nativeStop();
}

/** `sprite.playing` (read) — Pixi's own getter, under Godot's name. */
export function isPlaying(sprite: AnimatedSprite): boolean {
  return stateOf(sprite, 'playing').nativeIsPlaying();
}

/**
 * `sprite.playing = true` — `Mob.gd:5`.
 *
 * Godot's `playing` is read/WRITE and Pixi's is read-only, so this is the one
 * member of the pair that is a real adaptation rather than a rename.
 */
export function setPlaying(sprite: AnimatedSprite, playing: boolean): void {
  if (playing) play(sprite);
  else stop(sprite);
}

/**
 * `sprite.flip_h` / `flip_v` — `Player.gd:37`, `:38`, `:41`.
 *
 * Godot flips texture sampling inside the destination rectangle without moving that rectangle.
 * Pixi's negative scale flips geometry about its anchor, so {@link syncAnimatedSpriteLayout}
 * reflects the anchor on each flipped axis to keep the authored `centered`/`offset` rectangle
 * stationary.
 *
 * The magnitude of the existing scale is preserved, so a sprite scaled 2× stays
 * 2× when flipped.
 */
export function setFlipH(sprite: AnimatedSprite, flip: boolean): void {
  sprite.scale.x = Math.abs(sprite.scale.x) * (flip ? -1 : 1);
  syncAnimatedSpriteLayout(sprite);
}

/** `sprite.flip_h` (read). */
export function getFlipH(sprite: AnimatedSprite): boolean {
  return sprite.scale.x < 0;
}

/** `sprite.flip_v = …`. */
export function setFlipV(sprite: AnimatedSprite, flip: boolean): void {
  sprite.scale.y = Math.abs(sprite.scale.y) * (flip ? -1 : 1);
  syncAnimatedSpriteLayout(sprite);
}

/** `sprite.flip_v` (read). */
export function getFlipV(sprite: AnimatedSprite): boolean {
  return sprite.scale.y < 0;
}

/**
 * Advance a playing sprite by `dt` SECONDS.
 *
 * The port calls this; compat subscribes to nothing. The retained Pixi object owns the visible
 * frame and playing flag while this function advances Godot's per-frame duration/progress rules.
 */
export function advanceAnimation(sprite: AnimatedSprite, dt: number): void {
  if (!stateOf(sprite, 'advanceAnimation()').nativeIsPlaying()) return;
  if (!Number.isFinite(dt) || dt < 0) {
    throw new RangeError('AnimatedSprite2D.advance requires a finite nonnegative delta.');
  }
  const state = stateOf(sprite, 'advanceAnimation()');
  const animation = state.frames.animations[state.animation];
  if (animation === undefined || animation.frames.length === 0) return;
  let remaining = dt;
  let iterations = 0;
  while (remaining > 0) {
    const frameDuration = animation.frames[sprite.currentFrame]?.duration ?? 1;
    if (!Number.isFinite(frameDuration) || frameDuration <= 0) {
      throw new RangeError('AnimatedSprite2D frame duration must be greater than zero.');
    }
    const speed = animation.speed * state.speedScale * state.customSpeedScale / frameDuration;
    if (speed === 0) return;
    const absoluteSpeed = Math.abs(speed);
    const last = animation.frames.length - 1;
    if (speed > 0) {
      if (state.frameProgress >= 1) {
        if (sprite.currentFrame >= last) {
          const loopMode = animation.loopMode ?? (animation.loop ? 1 : 0);
          if (loopMode === 0) {
            setAnimatedSpritePlayhead(sprite, last, 1);
            state.nativeStop();
            state.animationFinished.emit();
            return;
          }
          if (loopMode === 2) {
            state.customSpeedScale *= -1;
            sprite.animationSpeed = state.speedScale * state.customSpeedScale;
            setAnimatedSpritePlayhead(sprite, last, 1);
          } else {
            setAnimatedSpritePlayhead(sprite, 0, 0);
          }
        } else {
          setAnimatedSpritePlayhead(sprite, sprite.currentFrame + 1, 0);
        }
      }
      const amount = Math.min((1 - state.frameProgress) / absoluteSpeed, remaining);
      state.frameProgress += amount * absoluteSpeed;
      remaining -= amount;
    } else {
      if (state.frameProgress <= 0) {
        if (sprite.currentFrame <= 0) {
          const loopMode = animation.loopMode ?? (animation.loop ? 1 : 0);
          if (loopMode === 0) {
            setAnimatedSpritePlayhead(sprite, 0, 0);
            state.nativeStop();
            state.animationFinished.emit();
            return;
          }
          if (loopMode === 2) {
            state.customSpeedScale *= -1;
            sprite.animationSpeed = state.speedScale * state.customSpeedScale;
            setAnimatedSpritePlayhead(sprite, 0, 0);
          } else {
            setAnimatedSpritePlayhead(sprite, last, 1);
          }
        } else {
          setAnimatedSpritePlayhead(sprite, sprite.currentFrame - 1, 1);
        }
      }
      const amount = Math.min(state.frameProgress / absoluteSpeed, remaining);
      state.frameProgress -= amount * absoluteSpeed;
      remaining -= amount;
    }
    iterations += 1;
    if (iterations > animation.frames.length) return;
  }
  syncAnimatedSpriteLayout(sprite);
}

/** Godot 3 `AnimatedSprite.animation_finished`, emitted only when a non-looping run completes. */
export function getAnimatedSpriteAnimationFinishedSignal(
  sprite: AnimatedSprite,
): GodotSignal<readonly []> {
  return stateOf(sprite, 'animation_finished').animationFinished.signal;
}

export function getAnimatedSpriteFrameProgress(sprite: AnimatedSprite): number {
  return stateOf(sprite, 'frame_progress').frameProgress;
}

export function setAnimatedSpriteFrameProgress(sprite: AnimatedSprite, progress: number): void {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError('AnimatedSprite2D.frame_progress must be in [0, 1].');
  }
  stateOf(sprite, 'frame_progress').frameProgress = progress;
}

/** Install Godot's direct AnimatedSprite/AnimatedSprite2D vocabulary on the native Pixi player. */
export function bindGodotCanvasAnimatedSpriteApi(
  source: AnimatedSprite,
): GodotCanvasAnimatedSprite {
  const sprite = source as GodotCanvasAnimatedSprite;
  Object.defineProperties(sprite, {
    frames: { configurable: true, enumerable: true, get: () => getFrames(sprite), set: (value: SpriteFrames) => setFrames(sprite, value) },
    sprite_frames: { configurable: true, enumerable: true, get: () => getFrames(sprite), set: (value: SpriteFrames) => setFrames(sprite, value) },
    animation: { configurable: true, enumerable: true, get: () => getAnimation(sprite), set: (value: string) => setAnimation(sprite, value) },
    frame: { configurable: true, enumerable: true, get: () => getAnimatedSpriteFrame(sprite), set: (value: number) => setAnimatedSpriteFrame(sprite, value) },
    frame_progress: { configurable: true, enumerable: true, get: () => getAnimatedSpriteFrameProgress(sprite), set: (value: number) => setAnimatedSpriteFrameProgress(sprite, value) },
    speed_scale: { configurable: true, enumerable: true, get: () => getAnimatedSpriteSpeedScale(sprite), set: (value: number) => setAnimatedSpriteSpeedScale(sprite, value) },
    playing: { configurable: true, enumerable: true, get: () => isPlaying(sprite), set: (value: boolean) => setPlaying(sprite, value) },
    centered: { configurable: true, enumerable: true, get: () => isAnimatedSpriteCentered(sprite), set: (value: boolean) => setAnimatedSpriteCentered(sprite, value) },
    offset: { configurable: true, enumerable: true, get: () => getAnimatedSpriteOffset(sprite), set: (value: PointData) => setAnimatedSpriteOffset(sprite, value) },
    flip_h: { configurable: true, enumerable: true, get: () => getFlipH(sprite), set: (value: boolean) => setFlipH(sprite, value) },
    flip_v: { configurable: true, enumerable: true, get: () => getFlipV(sprite), set: (value: boolean) => setFlipV(sprite, value) },
    animation_finished: { configurable: true, enumerable: true, get: () => getAnimatedSpriteAnimationFinishedSignal(sprite) },
  });
  Object.assign(sprite, {
    set_sprite_frames: (value: SpriteFrames): void => setFrames(sprite, value),
    get_sprite_frames: (): SpriteFrames => getFrames(sprite),
    set_frames: (value: SpriteFrames): void => setFrames(sprite, value),
    get_frames: (): SpriteFrames => getFrames(sprite),
    set_animation: (value: string): void => setAnimation(sprite, value),
    get_animation: (): string => getAnimation(sprite),
    set_frame: (value: number): void => setAnimatedSpriteFrame(sprite, value),
    get_frame: (): number => getAnimatedSpriteFrame(sprite),
    set_frame_and_progress: (frame: number, progress: number): void => {
      setAnimatedSpriteFrame(sprite, frame);
      setAnimatedSpriteFrameProgress(sprite, progress);
    },
    set_frame_progress: (value: number): void => setAnimatedSpriteFrameProgress(sprite, value),
    get_frame_progress: (): number => getAnimatedSpriteFrameProgress(sprite),
    set_speed_scale: (value: number): void => setAnimatedSpriteSpeedScale(sprite, value),
    get_speed_scale: (): number => getAnimatedSpriteSpeedScale(sprite),
    set_playing: (value: boolean): void => setPlaying(sprite, value),
    is_playing: (): boolean => isPlaying(sprite),
    play: (name?: string, customSpeed?: number, fromEnd?: boolean): void => play(sprite, name, customSpeed, fromEnd),
    play_backwards: (name = ''): void => play(sprite, name, -1, true),
    pause: (): void => stateOf(sprite, 'pause()').nativeStop(),
    stop: (): void => stop(sprite),
    set_centered: (value: boolean): void => setAnimatedSpriteCentered(sprite, value),
    is_centered: (): boolean => isAnimatedSpriteCentered(sprite),
    set_offset: (value: PointData): void => setAnimatedSpriteOffset(sprite, value),
    get_offset: (): PointData => getAnimatedSpriteOffset(sprite),
    set_flip_h: (value: boolean): void => setFlipH(sprite, value),
    is_flipped_h: (): boolean => getFlipH(sprite),
    set_flip_v: (value: boolean): void => setFlipV(sprite, value),
    is_flipped_v: (): boolean => getFlipV(sprite),
  });
  return sprite;
}
