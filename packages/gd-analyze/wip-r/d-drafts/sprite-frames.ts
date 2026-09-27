/**
 * @godot-class SpriteFrames
 * @role PROTOCOL
 *
 * Godot 4.7's `SpriteFrames` (`scene/resources/sprite_frames.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): named animations, each a speed in frames per second,
 * a loop mode and frames of a texture and a relative duration (at least
 * `SPRITE_FRAME_MINIMUM_DURATION`, 0.01 in float). A new one holds an empty `default` animation. A
 * scene states the whole set as its `animations` array (`_set_animations`), which replaces them.
 */

import type { Texture } from 'three';

const f32 = Math.fround;

/** `SPRITE_FRAME_MINIMUM_DURATION` (`sprite_frames.h:35`). */
const MINIMUM_DURATION = f32(0.01);

/** `SpriteFrames::LoopMode` (`sprite_frames.h:41`). */
export const LOOP_NONE = 0;
export const LOOP_LINEAR = 1;
export const LOOP_PINGPONG = 2;

interface Frame {
  readonly texture: Texture | null;
  readonly duration: number;
}

interface Animation {
  speed: number;
  loop: number;
  frames: Frame[];
}

export interface SpriteFrames {
  readonly animations: Map<string, Animation>;
  /** Listeners of the resource's `changed` signal (`Resource::emit_changed`). */
  readonly changed: Set<() => void>;
}

/** One animation as a scene states it (`_set_animations`, `sprite_frames.cpp:206`). */
export interface GodotSpriteFramesAnimation {
  readonly name: string;
  readonly speed: number;
  /** A LoopMode, or a boolean (`(int)loop`: false 0, true 1). */
  readonly loop: number | boolean;
  readonly frames: readonly { readonly texture: Texture | null; readonly duration: number }[];
}

function emitChanged(self: SpriteFrames): void {
  for (const listener of [...self.changed]) listener();
}

function newAnimation(): Animation {
  return { speed: 5, loop: LOOP_LINEAR, frames: [] };
}

/**
 * A new SpriteFrames with its `default` animation (`sprite_frames.cpp:307`).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/resources/sprite_frames.cpp:307
 */
export function construct(): SpriteFrames {
  const self: SpriteFrames = { animations: new Map(), changed: new Set() };
  add_animation(self, 'default');
  return self;
}

/**
 * An existing name fails and changes nothing.
 *
 * @godot SpriteFrames.add_animation
 * @source scene/resources/sprite_frames.cpp:100
 */
export function add_animation(self: SpriteFrames, anim: string): void {
  if (self.animations.has(anim)) return;
  self.animations.set(anim, newAnimation());
}

/**
 * @godot SpriteFrames.has_animation
 * @source scene/resources/sprite_frames.cpp:106
 */
export function has_animation(self: SpriteFrames, anim: string): boolean {
  return self.animations.has(anim);
}

/**
 * @godot SpriteFrames.remove_animation
 * @source scene/resources/sprite_frames.cpp:116
 */
export function remove_animation(self: SpriteFrames, anim: string): void {
  self.animations.delete(anim);
}

/**
 * The names, sorted (`Vector<String>::sort`).
 *
 * @godot SpriteFrames.get_animation_names
 * @source scene/resources/sprite_frames.cpp:135
 */
export function get_animation_names(self: SpriteFrames): string[] {
  return [...self.animations.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A negative speed or a missing animation fails and changes nothing.
 *
 * @godot SpriteFrames.set_animation_speed
 * @source scene/resources/sprite_frames.cpp:144
 */
export function set_animation_speed(self: SpriteFrames, anim: string, fps: number): void {
  if (fps < 0) return;
  const animation = self.animations.get(anim);
  if (animation === undefined) return;
  animation.speed = fps;
}

/**
 * A missing animation fails and reads 0.
 *
 * @godot SpriteFrames.get_animation_speed
 * @source scene/resources/sprite_frames.cpp:151
 */
export function get_animation_speed(self: SpriteFrames, anim: string): number {
  return self.animations.get(anim)?.speed ?? 0;
}

/**
 * @godot SpriteFrames.set_animation_loop
 * @source scene/resources/sprite_frames.cpp:158
 */
export function set_animation_loop(self: SpriteFrames, anim: string, loop: boolean): void {
  set_animation_loop_mode(self, anim, loop ? LOOP_LINEAR : LOOP_NONE);
}

/**
 * @godot SpriteFrames.get_animation_loop
 * @source scene/resources/sprite_frames.cpp:162
 */
export function get_animation_loop(self: SpriteFrames, anim: string): boolean {
  return get_animation_loop_mode(self, anim) === LOOP_LINEAR;
}

/**
 * @godot SpriteFrames.set_animation_loop_mode
 * @source scene/resources/sprite_frames.cpp:167
 */
export function set_animation_loop_mode(self: SpriteFrames, anim: string, mode: number): void {
  const animation = self.animations.get(anim);
  if (animation === undefined) return;
  animation.loop = mode;
}

/**
 * A missing animation fails and reads `LOOP_NONE`.
 *
 * @godot SpriteFrames.get_animation_loop_mode
 * @source scene/resources/sprite_frames.cpp:173
 */
export function get_animation_loop_mode(self: SpriteFrames, anim: string): number {
  return self.animations.get(anim)?.loop ?? LOOP_NONE;
}

/**
 * The duration is stored as a float of at least the minimum; a position outside the frames appends.
 *
 * @godot SpriteFrames.add_frame
 * @source scene/resources/sprite_frames.cpp:36
 */
export function add_frame(self: SpriteFrames, anim: string, texture: Texture | null, duration = 1, atPosition = -1): void {
  const animation = self.animations.get(anim);
  if (animation === undefined) return;
  const frame = { texture, duration: Math.max(MINIMUM_DURATION, f32(duration)) };
  if (atPosition >= 0 && atPosition < animation.frames.length) animation.frames.splice(atPosition, 0, frame);
  else animation.frames.push(frame);
  emitChanged(self);
}

/**
 * An index past the frames changes nothing.
 *
 * @godot SpriteFrames.set_frame
 * @source scene/resources/sprite_frames.cpp:53
 */
export function set_frame(self: SpriteFrames, anim: string, index: number, texture: Texture | null, duration = 1): void {
  const animation = self.animations.get(anim);
  if (animation === undefined || index < 0 || index >= animation.frames.length) return;
  animation.frames[index] = { texture, duration: Math.max(MINIMUM_DURATION, f32(duration)) };
  emitChanged(self);
}

/**
 * @godot SpriteFrames.get_frame_count
 * @source scene/resources/sprite_frames.cpp:70
 */
export function get_frame_count(self: SpriteFrames, anim: string): number {
  return self.animations.get(anim)?.frames.length ?? 0;
}

/**
 * A missing animation or an index outside the frames reads null.
 *
 * @godot SpriteFrames.get_frame_texture
 * @source scene/resources/sprite_frames.h:103
 */
export function get_frame_texture(self: SpriteFrames, anim: string, index: number): Texture | null {
  if (index < 0) return null;
  return self.animations.get(anim)?.frames[index]?.texture ?? null;
}

/**
 * A missing animation or an index outside the frames reads 1.
 *
 * @godot SpriteFrames.get_frame_duration
 * @source scene/resources/sprite_frames.h:114
 */
export function get_frame_duration(self: SpriteFrames, anim: string, index: number): number {
  if (index < 0) return 1;
  return self.animations.get(anim)?.frames[index]?.duration ?? 1;
}

/**
 * @godot SpriteFrames.clear
 * @source scene/resources/sprite_frames.cpp:86
 */
export function clear(self: SpriteFrames, anim: string): void {
  const animation = self.animations.get(anim);
  if (animation === undefined) return;
  animation.frames = [];
  emitChanged(self);
}

/**
 * @godot SpriteFrames.clear_all
 * @source scene/resources/sprite_frames.cpp:95
 */
export function clear_all(self: SpriteFrames): void {
  self.animations.clear();
  add_animation(self, 'default');
}

/**
 * The set a scene states: every animation replaced by these (`_set_animations`), each frame's
 * duration at least the minimum.
 *
 * @godot SpriteFrames (protocol)
 * @source scene/resources/sprite_frames.cpp:206
 */
export function godot_sprite_frames_new(animations: readonly GodotSpriteFramesAnimation[]): SpriteFrames {
  const self = construct();
  self.animations.clear();
  for (const animation of animations) {
    self.animations.set(animation.name, {
      speed: animation.speed,
      loop: typeof animation.loop === 'boolean' ? (animation.loop ? LOOP_LINEAR : LOOP_NONE) : animation.loop,
      frames: animation.frames.map((frame) => ({ texture: frame.texture, duration: Math.max(MINIMUM_DURATION, f32(frame.duration)) })),
    });
  }
  return self;
}
