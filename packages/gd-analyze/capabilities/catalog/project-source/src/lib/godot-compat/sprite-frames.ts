/**
 * @godot-class SpriteFrames
 * @role BINDING
 *
 * Godot 4.7's `SpriteFrames` (`scene/resources/sprite_frames.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): named animations, each its frames (a texture and a
 * relative duration), its speed in frames per second and whether it loops. A new one has the
 * animation `default` at 5 frames per second, looping.
 */

import { createSignal, type SignalHandle } from './signal';

export interface SpriteFrame {
  readonly texture: object | null;
  readonly duration: number;
}

interface Animation {
  speed: number;
  loop: boolean;
  frames: SpriteFrame[];
}

export interface SpriteFrames {
  readonly animations: Map<string, Animation>;
}

function entry(value: unknown, key: string): unknown {
  return value instanceof Map ? value.get(key) : (value as Readonly<Record<string, unknown>> | null)?.[key];
}

/**
 * A new SpriteFrames, with the animations a scene states (`animations`, as `_set_animations` takes them).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/resources/sprite_frames.cpp:268
 */
export function godot_sprite_frames_new(properties: Readonly<Record<string, unknown>> = {}): SpriteFrames {
  const self: SpriteFrames = { animations: new Map([['default', { speed: 5, loop: true, frames: [] }]]) };
  if (properties['animations'] !== undefined) _set_animations(self, properties['animations'] as readonly unknown[]);
  return self;
}

/**
 * @godot SpriteFrames.SpriteFrames
 * @source scene/resources/sprite_frames.cpp:268
 */
export function construct(): SpriteFrames {
  return godot_sprite_frames_new();
}

/**
 * The animations as the scene stores them: each a Dictionary of its `name`, `speed`, `loop` and
 * `frames` (each a Dictionary of its `texture` and `duration`).
 *
 * @godot SpriteFrames._set_animations
 * @source scene/resources/sprite_frames.cpp:187
 */
export function _set_animations(self: SpriteFrames, animations: readonly unknown[]): void {
  self.animations.clear();
  for (const animation of animations) {
    const frames = (entry(animation, 'frames') ?? []) as readonly unknown[];
    self.animations.set(String(entry(animation, 'name') ?? ''), {
      speed: Number(entry(animation, 'speed') ?? 5),
      loop: Boolean(entry(animation, 'loop') ?? true),
      frames: frames.map((frame) => ({ texture: (entry(frame, 'texture') ?? null) as object | null, duration: Number(entry(frame, 'duration') ?? 1) })),
    });
  }
}

function animationOf(self: SpriteFrames, anim: string): Animation | undefined {
  return self.animations.get(anim);
}

/**
 * @godot SpriteFrames.has_animation
 * @source scene/resources/sprite_frames.cpp:60
 */
export function has_animation(self: SpriteFrames, anim: string): boolean {
  return self.animations.has(anim);
}

/**
 * @godot SpriteFrames.get_animation_names
 * @source scene/resources/sprite_frames.cpp:122
 */
export function get_animation_names(self: SpriteFrames): string[] {
  return [...self.animations.keys()].sort();
}

/**
 * @godot SpriteFrames.get_frame_count
 * @source scene/resources/sprite_frames.h:83
 */
export function get_frame_count(self: SpriteFrames, anim: string): number {
  return animationOf(self, anim)?.frames.length ?? 0;
}

/**
 * @godot SpriteFrames.get_frame_texture
 * @source scene/resources/sprite_frames.h:88
 */
export function get_frame_texture(self: SpriteFrames, anim: string, idx: number): object | null {
  return animationOf(self, anim)?.frames[idx]?.texture ?? null;
}

/**
 * @godot SpriteFrames.get_frame_duration
 * @source scene/resources/sprite_frames.h:102
 */
export function get_frame_duration(self: SpriteFrames, anim: string, idx: number): number {
  return animationOf(self, anim)?.frames[idx]?.duration ?? 1;
}

/**
 * @godot SpriteFrames.get_animation_speed
 * @source scene/resources/sprite_frames.cpp:141
 */
export function get_animation_speed(self: SpriteFrames, anim: string): number {
  return animationOf(self, anim)?.speed ?? 0;
}

/**
 * @godot SpriteFrames.set_animation_speed
 * @source scene/resources/sprite_frames.cpp:134
 */
export function set_animation_speed(self: SpriteFrames, anim: string, fps: number): void {
  const animation = animationOf(self, anim);
  if (animation !== undefined && fps >= 0) animation.speed = fps;
}

/**
 * @godot SpriteFrames.get_animation_loop
 * @source scene/resources/sprite_frames.cpp:154
 */
export function get_animation_loop(self: SpriteFrames, anim: string): boolean {
  return animationOf(self, anim)?.loop ?? false;
}

/**
 * @godot SpriteFrames.set_animation_loop
 * @source scene/resources/sprite_frames.cpp:147
 */
export function set_animation_loop(self: SpriteFrames, anim: string, loop: boolean): void {
  const animation = animationOf(self, anim);
  if (animation !== undefined) animation.loop = loop;
}

/**
 * An animated sprite's playback of its SpriteFrames (AnimatedSprite2D and AnimatedSprite3D share
 * it, `scene/2d/animated_sprite_2d.cpp`, `scene/3d/sprite_3d.cpp`): the current animation, frame
 * and progress, the speed scales and the signals.
 */
export interface GodotSpriteFramesPlayer {
  frames: SpriteFrames | null;
  animation: string;
  autoplay: string;
  frame: number;
  frameProgress: number;
  speedScale: number;
  customSpeedScale: number;
  frameSpeedScale: number;
  playing: boolean;
  /** Redraws the sprite (its frame changed). */
  readonly redraw: () => void;
  /** Turns the sprite's internal processing, which calls `godot_sprite_frames_advance`, on or off. */
  readonly process: (on: boolean) => void;
  readonly signals: {
    readonly animation_finished: SignalHandle<[]>;
    readonly animation_looped: SignalHandle<[]>;
    readonly animation_changed: SignalHandle<[]>;
    readonly frame_changed: SignalHandle<[]>;
    readonly sprite_frames_changed: SignalHandle<[]>;
  };
}

/**
 * A new playback: the `default` animation, stopped at frame 0.
 *
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:620
 */
export function godot_sprite_frames_player(redraw: () => void, process: (on: boolean) => void): GodotSpriteFramesPlayer {
  return {
    frames: null,
    animation: 'default',
    autoplay: '',
    frame: 0,
    frameProgress: 0,
    speedScale: 1,
    customSpeedScale: 1,
    frameSpeedScale: 1,
    playing: false,
    redraw,
    process,
    signals: {
      animation_finished: createSignal<[]>(),
      animation_looped: createSignal<[]>(),
      animation_changed: createSignal<[]>(),
      frame_changed: createSignal<[]>(),
      sprite_frames_changed: createSignal<[]>(),
    },
  };
}

function frameCountOf(player: GodotSpriteFramesPlayer): number {
  return player.frames === null ? 0 : get_frame_count(player.frames, player.animation);
}

function calcFrameSpeedScale(player: GodotSpriteFramesPlayer): void {
  player.frameSpeedScale = player.frames === null ? 1 : 1 / get_frame_duration(player.frames, player.animation, player.frame);
}

/**
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:469
 */
export function godot_sprite_frames_playing_speed(player: GodotSpriteFramesPlayer): number {
  return player.playing && player.frames !== null ? get_animation_speed(player.frames, player.animation) * player.speedScale * player.customSpeedScale : 0;
}

/**
 * `set_frame_and_progress` (`animated_sprite_2d.cpp:388`).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:388
 */
export function godot_sprite_frames_set_frame_and_progress(player: GodotSpriteFramesPlayer, frame: number, progress: number): void {
  if (player.frames === null) return;
  const count = frameCountOf(player);
  const clamped = count === 0 ? 0 : Math.min(Math.max(frame, 0), count - 1);
  const changed = player.frame !== clamped;
  player.frame = clamped;
  calcFrameSpeedScale(player);
  player.frameProgress = progress;
  if (!changed) return;
  player.redraw();
  player.signals.frame_changed.emit();
}

/**
 * `_stop_internal` (`animated_sprite_2d.cpp:538`).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:538
 */
export function godot_sprite_frames_stop(player: GodotSpriteFramesPlayer, reset: boolean): void {
  player.playing = false;
  if (reset) {
    player.customSpeedScale = 1;
    godot_sprite_frames_set_frame_and_progress(player, 0, 0);
  }
  player.process(false);
}

/**
 * One process step (`NOTIFICATION_INTERNAL_PROCESS`, `animated_sprite_2d.cpp:257`).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:257
 */
export function godot_sprite_frames_advance(player: GodotSpriteFramesPlayer, delta: number): void {
  const frames = player.frames;
  if (frames === null || !has_animation(frames, player.animation)) return;
  let remaining = delta;
  let i = 0;
  while (remaining > 0) {
    const speed = get_animation_speed(frames, player.animation) * player.speedScale * player.customSpeedScale * player.frameSpeedScale;
    const absSpeed = Math.abs(speed);
    if (speed === 0) return;
    const count = frameCountOf(player);
    const last = count - 1;
    if (speed > 0) {
      if (player.frameProgress >= 1) {
        if (player.frame >= last) {
          if (get_animation_loop(frames, player.animation)) {
            player.frame = 0;
            player.signals.animation_looped.emit();
          } else {
            player.frame = last;
            godot_sprite_frames_stop(player, false);
            player.signals.animation_finished.emit();
            return;
          }
        } else player.frame += 1;
        calcFrameSpeedScale(player);
        player.frameProgress = 0;
        player.redraw();
        player.signals.frame_changed.emit();
      }
      const toProcess = Math.min((1 - player.frameProgress) / absSpeed, remaining);
      player.frameProgress += toProcess * absSpeed;
      remaining -= toProcess;
    } else {
      if (player.frameProgress <= 0) {
        if (player.frame <= 0) {
          if (get_animation_loop(frames, player.animation)) {
            player.frame = last;
            player.signals.animation_looped.emit();
          } else {
            player.frame = 0;
            godot_sprite_frames_stop(player, false);
            player.signals.animation_finished.emit();
            return;
          }
        } else player.frame -= 1;
        calcFrameSpeedScale(player);
        player.frameProgress = 1;
        player.redraw();
        player.signals.frame_changed.emit();
      }
      const toProcess = Math.min(player.frameProgress / absSpeed, remaining);
      player.frameProgress -= toProcess * absSpeed;
      remaining -= toProcess;
    }
    i += 1;
    if (i > count) return;
  }
}

/**
 * `play` (`animated_sprite_2d.cpp:474`).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:474
 */
export function godot_sprite_frames_play(player: GodotSpriteFramesPlayer, name: string, customSpeed: number, fromEnd: boolean): void {
  const next = name === '' ? player.animation : name;
  const frames = player.frames;
  if (frames === null || !has_animation(frames, next) || get_frame_count(frames, next) === 0) return;
  player.playing = true;
  player.customSpeedScale = customSpeed;
  const end = () => Math.max(0, frameCountOf(player) - 1);
  if (next !== player.animation) {
    player.animation = next;
    if (fromEnd) godot_sprite_frames_set_frame_and_progress(player, end(), 1);
    else godot_sprite_frames_set_frame_and_progress(player, 0, 0);
    player.signals.animation_changed.emit();
  } else {
    const backward = get_animation_speed(frames, player.animation) * player.speedScale * player.customSpeedScale < 0;
    if (fromEnd && backward && player.frame === 0 && player.frameProgress <= 0) godot_sprite_frames_set_frame_and_progress(player, end(), 1);
    else if (!fromEnd && !backward && player.frame === end() && player.frameProgress >= 1) godot_sprite_frames_set_frame_and_progress(player, 0, 0);
  }
  player.process(true);
  player.redraw();
}

/**
 * `set_animation` (`animated_sprite_2d.cpp:563`).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:563
 */
export function godot_sprite_frames_set_animation(player: GodotSpriteFramesPlayer, name: string): void {
  if (player.animation === name) return;
  player.animation = name;
  player.signals.animation_changed.emit();
  const frames = player.frames;
  if (frames === null) {
    player.animation = '';
    godot_sprite_frames_stop(player, true);
    return;
  }
  const count = frameCountOf(player);
  if (name === '' || count === 0) godot_sprite_frames_stop(player, true);
  else if (!has_animation(frames, name)) {
    player.animation = '';
    godot_sprite_frames_stop(player, true);
  } else if (godot_sprite_frames_playing_speed(player) < 0) godot_sprite_frames_set_frame_and_progress(player, count - 1, 1);
  else godot_sprite_frames_set_frame_and_progress(player, 0, 0);
  player.redraw();
}

/**
 * `set_sprite_frames` (`animated_sprite_2d.cpp:305`).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:305
 */
export function godot_sprite_frames_set_frames(player: GodotSpriteFramesPlayer, frames: SpriteFrames | null): void {
  if (player.frames === frames) return;
  player.frames = frames;
  if (frames === null) player.frame = 0;
  else {
    const names = get_animation_names(frames);
    if (names.length === 0) {
      godot_sprite_frames_set_animation(player, '');
      player.autoplay = '';
    } else {
      if (!has_animation(frames, player.animation)) godot_sprite_frames_set_animation(player, names[0] as string);
      if (!has_animation(frames, player.autoplay)) player.autoplay = '';
    }
  }
  player.redraw();
  player.signals.sprite_frames_changed.emit();
}

/**
 * The texture of the current frame, or null.
 *
 * @godot SpriteFrames (protocol)
 * @source scene/2d/animated_sprite_2d.cpp:212
 */
export function godot_sprite_frames_texture(player: GodotSpriteFramesPlayer): object | null {
  return player.frames === null ? null : get_frame_texture(player.frames, player.animation, player.frame);
}
