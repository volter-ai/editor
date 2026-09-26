/**
 * `AnimatedSprite3D` — a SpriteFrames player over the retained `THREE.Mesh` SpriteBase3D.
 *
 * starter-kit-fps is the measured surface. `enemy.gd:58-63` resets two muzzle
 * billboards to `frame = 0` then `play("default")`; `player.gd:182` plays the
 * same `"default"` on the weapon muzzle; `player.gd:212` plays `"shot"` on an
 * instanced `impact.tscn`. The pinned 4.7 dump declares `frame: int`
 * (`set_frame`/`get_frame`) and
 * `play(name: StringName = &"", custom_speed: float = 1.0, from_end: bool = false)`
 * on `AnimatedSprite3D` (inherits `SpriteBase3D`).
 *
 * ## What the corpus authors, and why UV is TRUE
 *
 * Both SpriteFrames sets are AtlasTexture cells on ONE PNG, not a packed
 * spritesheet this lane would have to bake:
 *
 * - `sprites/burst_animation.tres` — animation `"default"`, speed 30, loop
 *   false, two 256×256 cells at `(0,0)` and `(256,0)` plus a trailing `null`
 *   frame (the flash hides itself).
 * - `objects/impact.tscn` inline SpriteFrames — animation `"shot"`, speed 30,
 *   loop false, four 128×128 cells of `hit.png` in a 2×2.
 *
 * Godot's SpriteFrames is a named set of those frames. Each frame retains the authored
 * AtlasTexture as the native THREE.Texture identity; the shared SpriteBase3D binding clones
 * that native sampling view and observes its Resource `changed` signal. No
 * asset-pipeline piece is missing:
 * the regions are authored, the PNG is shipped, and the host already loads
 * textures.
 *
 * Godot's region origin is the IMAGE top-left. `atlas-texture.ts` composes it with the source's
 * actual Three `flipY`, offset, and repeat instead of baking a second frame record here.
 *
 * The 2D `animated-sprite.ts` backend is Pixi's `AnimatedSprite`. Claiming
 * that battery here would be claiming `Label.text` for `Label3D`.
 *
 * ## Who drives it
 *
 * No `requestAnimationFrame`, no three mixer. A sprite advances only inside
 * {@link advanceAnimatedSprite3D}, which the port calls with the same seconds
 * `tree.tick` already measures. `custom_speed` multiplies the animation's
 * authored fps; `from_end` starts at the last frame and steps backwards.
 * Unused dump members (`pause`, `play_backwards`) are not on this object.
 * `animation_finished` is the return of {@link advanceAnimatedSprite3D}: true
 * the step a non-looping animation reaches its last frame and stops.
 *
 * ## Resource ownership
 *
 * **Owns:** the WeakMap SpriteFrames playback state. **Shares:** the retained
 * SpriteBase3D binding and atlas `THREE.Texture` loaded by the caller.
 */

import { Texture, type Mesh } from 'three';
import type { GodotAtlasTexture3D } from './atlas-texture';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import {
  createGodotSpriteFrames,
  observeGodotSpriteFrames,
  type GodotSpriteAnimation,
  type GodotSpriteFrames,
} from './sprite-frames';
import {
  bindGodotSprite3D,
  getSprite3DTexture,
  setSprite3DRegionEnabled,
  setSprite3DTexture,
  type Sprite3DOptions,
} from './sprite-3d';

/** One AtlasTexture cell, or `null` for the authored empty frame that hides the billboard. */
export interface Sprite3DFrame {
  readonly texture: GodotAtlasTexture3D;
  /** Godot 4 SpriteFrames' per-frame duration multiplier. */
  readonly duration?: number;
}

/** One named animation in a 3D `SpriteFrames`. */
export interface Sprite3DAnimation {
  readonly frames: readonly (Sprite3DFrame | null)[];
  /** Godot's per-animation `speed`, in FRAMES PER SECOND. Godot's default is 5. */
  readonly speed?: number;
  /** Godot's per-animation `loop`. Default true, as in Godot. */
  readonly loop?: boolean;
  /** Godot 4 SpriteFrames LoopMode: NONE=0, LINEAR=1, PINGPONG=2. */
  readonly loopMode?: 0 | 1 | 2;
}

/** Godot's `SpriteFrames` resource — a named set of atlas-cell animations. */
export type SpriteFrames3D = GodotSpriteFrames<GodotAtlasTexture3D>;

/** Godot's own default animation speed, in FPS. */
export const DEFAULT_SPRITE_3D_SPEED = 5;

/** Build a 3D `SpriteFrames`. The emitted project reads these off the `.tscn`/`.tres`. */
export function createSpriteFrames3D(
  animations: Readonly<Record<string, Sprite3DAnimation>>,
  major: 3 | 4 = 4,
): SpriteFrames3D {
  return createGodotSpriteFrames<GodotAtlasTexture3D>(major, Object.fromEntries(
    Object.entries(animations).map(([name, animation]) => [name, {
      frames: animation.frames.map((frame) => frame === null
        ? null
        : {
            texture: frame.texture,
            ...(frame.duration === undefined ? {} : { duration: frame.duration }),
          }),
      ...(animation.speed === undefined ? {} : { speed: animation.speed }),
      loop: animation.loop ?? (animation.loopMode === undefined || animation.loopMode !== 0),
      ...(animation.loopMode === undefined ? {} : { loopMode: animation.loopMode }),
    }]),
  ));
}

export function getAnimationNames3D(frames: SpriteFrames3D): string[] {
  return [...frames.get_animation_names()];
}

interface Sprite3DState {
  major: 3 | 4;
  frames: SpriteFrames3D;
  animation: string;
  frame: number;
  playing: boolean;
  /** Progress through the current frame, matching Godot 4's 0..1 playhead. */
  frameProgress: number;
  /** `play(..., custom_speed)` multiplier. 1 when `play` is called with the default. */
  customSpeed: number;
  /** Ping-pong direction multiplier; public custom speed remains authored and observable. */
  reverse: boolean;
  speedScale: number;
  autoplay: string;
  readonly frameChanged: SignalHandle<readonly []>;
  readonly animationChanged: SignalHandle<readonly []>;
  readonly animationLooped: SignalHandle<readonly []>;
  readonly animationFinished: SignalHandle<readonly []>;
  readonly spriteFramesChanged: SignalHandle<readonly []>;
  releaseFrames: () => void;
}

const STATE = new WeakMap<Mesh, Sprite3DState>();

function stateOf(sprite: Mesh, caller: string): Sprite3DState {
  const state = STATE.get(sprite);
  if (state === undefined) {
    throw new Error(
      `godot-compat: ${caller} was called on an AnimatedSprite3D with no SpriteFrames. Call ` +
        'setSpriteFrames3D(sprite, frames) first — Godot\'s AnimatedSprite3D carries its ' +
        '`sprite_frames` resource and an unbound THREE.Mesh has nowhere to hold one.',
    );
  }
  return state;
}

function applyFrame(sprite: Mesh, state: Sprite3DState): void {
  const animation = state.frames.animations[state.animation];
  if (animation === undefined) return;
  const cell = animation.frames[state.frame]?.texture;
  if (cell === null || cell === undefined) {
    sprite.visible = false;
    return;
  }
  sprite.visible = true;
  if (getSprite3DTexture(sprite) !== cell) setSprite3DTexture(sprite, cell);
  setSprite3DRegionEnabled(sprite, false);
}

/**
 * `sprite.sprite_frames = frames` — selects the first animation by name order,
 * matching Godot (and the 2D `setFrames`). Playback is not started.
 */
export function setSpriteFrames3D(
  sprite: Mesh,
  frames: SpriteFrames3D,
  major: 3 | 4 = 4,
  baseOptions: Omit<Sprite3DOptions, 'major' | 'texture' | 'regionEnabled' | 'regionRect'> = {},
): void {
  const names = getAnimationNames3D(frames);
  const first = names.includes('default') ? 'default' : names[0];
  if (first === undefined) {
    throw new Error(
      'godot-compat: setSpriteFrames3D() was given a SpriteFrames with no animations. Godot ' +
        'renders nothing for such a sprite; there is no honest animation to select here.',
    );
  }
  const existing = STATE.get(sprite);
  if (existing !== undefined) {
    if (existing.frames === frames) return;
    existing.releaseFrames();
    existing.frames = frames;
    existing.releaseFrames = observeGodotSpriteFrames(frames, () => {
      if (frames.animations[existing.animation] === undefined) {
        const names = getAnimationNames3D(frames);
        existing.animation = names.includes('default') ? 'default' : (names[0] ?? '');
        existing.frame = 0;
        existing.frameProgress = 0;
      }
      const active = frames.animations[existing.animation];
      if (active !== undefined) {
        existing.frame = Math.min(existing.frame, Math.max(0, active.frames.length - 1));
        applyFrame(sprite, existing);
      } else sprite.visible = false;
      existing.spriteFramesChanged.emit();
    });
    if (frames.animations[existing.animation] === undefined) {
      existing.animation = first;
      existing.frame = 0;
      existing.frameProgress = 0;
      if (existing.major === 4) existing.animationChanged.emit();
    } else {
      const count = frames.animations[existing.animation]!.frames.length;
      existing.frame = Math.min(existing.frame, Math.max(0, count - 1));
    }
    if (existing.major === 4) {
      if (existing.autoplay !== '' && frames.animations[existing.autoplay] === undefined) existing.autoplay = '';
      stopAnimatedSprite3D(sprite);
      existing.spriteFramesChanged.emit();
    } else {
      existing.frameProgress = 0;
      applyFrame(sprite, existing);
    }
    return;
  }
  const firstFrame = Object.values(frames.animations)
    .flatMap((animation) => animation.frames)
    .map((frame) => frame?.texture ?? null)
    .find((frame): frame is GodotAtlasTexture3D => frame !== null);
  const initialTexture = firstFrame ?? new Texture();
  bindGodotSprite3D(sprite, {
    ...baseOptions,
    major,
    texture: initialTexture,
    regionEnabled: false,
  });
  const state: Sprite3DState = {
    major,
    frames,
    animation: first,
    frame: 0,
    playing: false,
    frameProgress: 0,
    customSpeed: 1,
    reverse: false,
    speedScale: 1,
    autoplay: '',
    frameChanged: createSignal(),
    animationChanged: createSignal(),
    animationLooped: createSignal(),
    animationFinished: createSignal(),
    spriteFramesChanged: createSignal(),
    releaseFrames: () => {},
  };
  state.releaseFrames = observeGodotSpriteFrames(frames, () => {
    if (frames.animations[state.animation] === undefined) {
      const names = getAnimationNames3D(frames);
      state.animation = names.includes('default') ? 'default' : (names[0] ?? '');
      state.frame = 0;
      state.frameProgress = 0;
    }
    const active = frames.animations[state.animation];
    if (active !== undefined) {
      state.frame = Math.min(state.frame, Math.max(0, active.frames.length - 1));
      applyFrame(sprite, state);
    } else sprite.visible = false;
    state.spriteFramesChanged.emit();
  });
  STATE.set(sprite, state);
  applyFrame(sprite, state);
  if (firstFrame === undefined) sprite.visible = false;
  state.spriteFramesChanged.emit();
}

export function getSpriteFrames3D(sprite: Mesh): SpriteFrames3D {
  return stateOf(sprite, 'getSpriteFrames3D()').frames;
}

/** `sprite.frame` — the int the 4.7 dump declares on AnimatedSprite3D. */
export function getFrame3D(sprite: Mesh): number {
  return stateOf(sprite, 'getFrame3D()').frame;
}

/**
 * `sprite.frame = n` — `enemy.gd:58`/`:62` reset the muzzle to 0 before play.
 * Out of range refuses by name rather than wrapping: Godot prints an error and
 * leaves the playhead, which in a port looks like the flash never restarted.
 */
export function setFrame3D(sprite: Mesh, frame: number): void {
  const state = stateOf(sprite, `setFrame3D(${frame})`);
  const animation = state.frames.animations[state.animation];
  if (animation === undefined) {
    throw new Error(
      `godot-compat: setFrame3D(${frame}) on animation "${state.animation}", which this ` +
        'SpriteFrames does not have.',
    );
  }
  if (!Number.isSafeInteger(frame)) throw new TypeError('AnimatedSprite3D.frame requires an integer.');
  const next = Math.max(0, Math.min(Math.max(0, animation.frames.length - 1), frame));
  const changed = next !== state.frame;
  state.frame = next;
  state.frameProgress = getPlayingSpeed3D(sprite) < 0 ? 1 : 0;
  applyFrame(sprite, state);
  if (changed) state.frameChanged.emit();
}

/**
 * `sprite.play(name, custom_speed, from_end)` — the 4.7 dump's signature.
 * An empty / omitted name plays the current animation. Corpus calls pass
 * `"default"` or `"shot"` only; `custom_speed`/`from_end` are implemented
 * because they are on the declared member, not because the fixture writes them.
 */
export function playAnimatedSprite3D(
  sprite: Mesh,
  name?: string,
  customSpeed = 1,
  fromEnd = false,
): void {
  const state = stateOf(sprite, 'playAnimatedSprite3D()');
  if (state.major === 3 && (customSpeed !== 1 || fromEnd)) {
    throw new Error('Godot 3 AnimatedSprite3D.play accepts only the animation name.');
  }
  const chosen = name === undefined || name === '' ? state.animation : name;
  const animation = state.frames.animations[chosen];
  if (animation === undefined) {
    throw new Error(
      `godot-compat: play("${chosen}"), which this SpriteFrames does not have. ` +
        `Available: ${getAnimationNames3D(state.frames).join(', ')}.`,
    );
  }
  const changedAnimation = chosen !== state.animation;
  state.animation = chosen;
  if (!Number.isFinite(customSpeed)) throw new TypeError('AnimatedSprite3D.play custom_speed requires a finite float.');
  state.customSpeed = customSpeed;
  state.reverse = false;
  state.playing = true;
  const last = animation.frames.length - 1;
  const backwards = state.speedScale * customSpeed < 0;
  if (state.major === 3) {
    if (changedAnimation) {
      state.frame = 0;
      state.frameProgress = 0;
      state.animationChanged.emit();
    }
  } else if (changedAnimation) {
    state.frame = fromEnd ? Math.max(0, last) : 0;
    state.frameProgress = fromEnd ? 1 : 0;
    state.animationChanged.emit();
  } else if (fromEnd && backwards && state.frame === 0 && state.frameProgress <= 0) {
    state.frame = Math.max(0, last);
    state.frameProgress = 1;
  } else if (!fromEnd && !backwards && state.frame === last && state.frameProgress >= 1) {
    state.frame = 0;
    state.frameProgress = 0;
  }
  applyFrame(sprite, state);
}

/**
 * Advance a playing billboard by `dt` SECONDS. The port calls this; compat owns no clock.
 * Returns `true` the step a non-looping animation reaches its last frame and stops —
 * Godot's `animation_finished`. A loop wrap or a sprite that is not playing returns `false`.
 */
export function advanceAnimatedSprite3D(sprite: Mesh, dt: number): boolean {
  const state = STATE.get(sprite);
  if (state === undefined || !state.playing) return false;
  const animation = state.frames.animations[state.animation];
  if (animation === undefined || animation.frames.length === 0) return false;
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('AnimatedSprite3D.advance requires a finite nonnegative delta.');
  if (state.major === 3) return advanceGodot3(sprite, state, animation, dt);
  let remaining = dt;
  let finished = false;
  let zeroProgressTransitions = 0;
  while (remaining > 0) {
    const remainingBeforeStep = remaining;
    const frameDuration = animation.frames[state.frame]?.duration ?? 1;
    if (!Number.isFinite(frameDuration) || frameDuration <= 0) throw new RangeError('AnimatedSprite3D frame duration must be greater than zero.');
    const speed = (animation.speed ?? DEFAULT_SPRITE_3D_SPEED) * state.speedScale * state.customSpeed * (state.reverse ? -1 : 1) / frameDuration;
    if (speed === 0) return finished;
    const absoluteSpeed = Math.abs(speed);
    const last = animation.frames.length - 1;
    if (speed > 0) {
      if (state.frameProgress >= 1) {
        if (state.frame >= last) {
          const loopMode = animation.loopMode ?? ((animation.loop ?? true) ? 1 : 0);
          if (loopMode === 0) {
            state.frame = last;
            state.playing = false;
            state.animationFinished.emit();
            return true;
          }
          if (loopMode === 2) { state.frame = last; state.reverse = !state.reverse; }
          else state.frame = 0;
          state.animationLooped.emit();
        } else state.frame += 1;
        state.frameProgress = 0;
        applyFrame(sprite, state);
        state.frameChanged.emit();
      }
      const amount = Math.min((1 - state.frameProgress) / absoluteSpeed, remaining);
      state.frameProgress += amount * absoluteSpeed;
      remaining -= amount;
    } else {
      if (state.frameProgress <= 0) {
        if (state.frame <= 0) {
          const loopMode = animation.loopMode ?? ((animation.loop ?? true) ? 1 : 0);
          if (loopMode === 0) {
            state.frame = 0;
            state.playing = false;
            state.animationFinished.emit();
            return true;
          }
          if (loopMode === 2) { state.frame = 0; state.reverse = !state.reverse; }
          else state.frame = last;
          state.animationLooped.emit();
        } else state.frame -= 1;
        state.frameProgress = 1;
        applyFrame(sprite, state);
        state.frameChanged.emit();
      }
      const amount = Math.min(state.frameProgress / absoluteSpeed, remaining);
      state.frameProgress -= amount * absoluteSpeed;
      remaining -= amount;
    }
    if (remaining === remainingBeforeStep) {
      zeroProgressTransitions += 1;
      if (zeroProgressTransitions > animation.frames.length + 1) return finished;
    } else {
      zeroProgressTransitions = 0;
    }
  }
  return finished;
}

function advanceGodot3(
  sprite: Mesh,
  state: Sprite3DState,
  animation: GodotSpriteAnimation<GodotAtlasTexture3D>,
  dt: number,
): boolean {
  const fps = animation.speed ?? DEFAULT_SPRITE_3D_SPEED;
  if (!Number.isFinite(fps) || fps < 0) throw new RangeError('Godot 3 SpriteFrames speed requires a finite nonnegative float.');
  if (fps === 0 || dt === 0) return false;
  let remaining = dt;
  let emittedFinished = false;
  while (remaining > 0) {
    const toBoundary = (1 - state.frameProgress) / fps;
    const consumed = Math.min(toBoundary, remaining);
    state.frameProgress += consumed * fps;
    remaining -= consumed;
    if (state.frameProgress < 1) break;
    state.frameProgress = 0;
    if (state.frame >= animation.frames.length - 1) {
      state.frame = animation.loop ?? true ? 0 : animation.frames.length - 1;
      state.animationFinished.emit();
      emittedFinished = true;
    } else {
      state.frame += 1;
    }
    applyFrame(sprite, state);
    state.frameChanged.emit();
  }
  return emittedFinished;
}

export function isPlaying3D(sprite: Mesh): boolean {
  return stateOf(sprite, 'isPlaying3D()').playing;
}

export function getAnimation3D(sprite: Mesh): string {
  return stateOf(sprite, 'getAnimation3D()').animation;
}

export function setAnimation3D(sprite: Mesh, name: string): void {
  const state = stateOf(sprite, 'setAnimation3D()');
  if (name === state.animation) return;
  state.animation = name;
  if (state.major === 4) state.animationChanged.emit();
  if (state.frames.animations[name] === undefined || state.frames.animations[name]!.frames.length === 0) {
    state.animation = '';
    stopAnimatedSprite3D(sprite);
    throw new Error(`AnimatedSprite3D has no animation named "${name}".`);
  }
  const backwards = getPlayingSpeed3D(sprite) < 0;
  state.frame = backwards ? state.frames.animations[name]!.frames.length - 1 : 0;
  state.frameProgress = backwards ? 1 : 0;
  applyFrame(sprite, state);
}

export function pauseAnimatedSprite3D(sprite: Mesh): void { const state = stateOf(sprite, 'pauseAnimatedSprite3D()'); if (state.major === 3) throw new Error('AnimatedSprite3D.pause does not exist in Godot 3.'); state.playing = false; }
export function stopAnimatedSprite3D(sprite: Mesh): void { const state = stateOf(sprite, 'stopAnimatedSprite3D()'); state.playing = false; if (state.major === 4) { state.customSpeed = 1; state.reverse = false; state.frame = 0; state.frameProgress = 0; applyFrame(sprite, state); } }
export function playBackwardsAnimatedSprite3D(sprite: Mesh, name = ''): void { playAnimatedSprite3D(sprite, name, -1, true); }
export function setFrameProgress3D(sprite: Mesh, value: number): void { const state = stateOf(sprite, 'setFrameProgress3D()'); if (state.major === 3) throw new Error('AnimatedSprite3D.frame_progress does not exist in Godot 3.'); if (!Number.isFinite(value)) throw new TypeError('AnimatedSprite3D.frame_progress requires a finite float.'); state.frameProgress = value; }
export function getFrameProgress3D(sprite: Mesh): number { const state = stateOf(sprite, 'getFrameProgress3D()'); if (state.major === 3) throw new Error('AnimatedSprite3D.frame_progress does not exist in Godot 3.'); return state.frameProgress; }
export function setFrameAndProgress3D(sprite: Mesh, frame: number, progress: number): void { setFrame3D(sprite, frame); setFrameProgress3D(sprite, progress); }
export function setSpeedScale3D(sprite: Mesh, value: number): void { const state = stateOf(sprite, 'setSpeedScale3D()'); if (state.major === 3) throw new Error('AnimatedSprite3D.speed_scale does not exist in Godot 3.'); if (!Number.isFinite(value)) throw new TypeError('AnimatedSprite3D.speed_scale requires a finite float.'); state.speedScale = value; }
export function getSpeedScale3D(sprite: Mesh): number { const state = stateOf(sprite, 'getSpeedScale3D()'); if (state.major === 3) throw new Error('AnimatedSprite3D.speed_scale does not exist in Godot 3.'); return state.speedScale; }
export function getPlayingSpeed3D(sprite: Mesh): number { const state = stateOf(sprite, 'getPlayingSpeed3D()'); return state.playing ? state.speedScale * state.customSpeed * (state.reverse ? -1 : 1) : 0; }
export function setAutoplay3D(sprite: Mesh, name: string): void { const state = stateOf(sprite, 'setAutoplay3D()'); if (state.major === 3) throw new Error('AnimatedSprite3D.autoplay does not exist in Godot 3.'); if (typeof name !== 'string') throw new TypeError('AnimatedSprite3D.autoplay requires String.'); state.autoplay = name; }
export function getAutoplay3D(sprite: Mesh): string { const state = stateOf(sprite, 'getAutoplay3D()'); if (state.major === 3) throw new Error('AnimatedSprite3D.autoplay does not exist in Godot 3.'); return state.autoplay; }
export function startAutoplay3D(sprite: Mesh): void { const state = stateOf(sprite, 'startAutoplay3D()'); if (state.autoplay !== '' && state.frames.animations[state.autoplay] !== undefined) playAnimatedSprite3D(sprite, state.autoplay); }
export function animatedSprite3DSignal(sprite: Mesh, name: 'frame_changed' | 'animation_changed' | 'animation_looped' | 'animation_finished' | 'sprite_frames_changed'): GodotSignal<readonly []> {
  const state = stateOf(sprite, `AnimatedSprite3D.${name}`);
  if (name === 'frame_changed') return state.frameChanged.signal;
  if (name === 'animation_changed') return state.animationChanged.signal;
  if (name === 'animation_looped') return state.animationLooped.signal;
  if (name === 'animation_finished') return state.animationFinished.signal;
  return state.spriteFramesChanged.signal;
}
