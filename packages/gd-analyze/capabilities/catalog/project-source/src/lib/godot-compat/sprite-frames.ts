/**
 * @godot-class SpriteFrames
 * @role PROTOCOL
 *
 * Godot 4.7's `SpriteFrames` (`scene/resources/sprite_frames.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): named animations in the order they were added (Godot's
 * `HashMap` keeps insertion order), each a speed in frames per second (`double`), a loop mode and
 * frames of a texture and a relative duration (`float`, at least `SPRITE_FRAME_MINIMUM_DURATION`). A
 * new one holds an empty `default` animation; a scene states the whole set as its `animations`
 * array, which `_set_animations` puts in place of every animation.
 *
 * Bound: the reads an AnimatedSprite3D makes of its frames. Not bound: the editing members
 * (`add_animation`, `add_frame`, `set_*`, `remove_*`, `rename_animation`, `clear*`), which no game in
 * the corpus calls, and the `changed` signal they emit.
 */

import type { Texture } from 'three';

const f32 = Math.fround;

/** `SPRITE_FRAME_MINIMUM_DURATION` (`sprite_frames.h:35`), a float. */
const MINIMUM_DURATION = f32(0.01);

/** `SpriteFrames::LoopMode` (`sprite_frames.h:41`). */
const LOOP_NONE = 0;
const LOOP_LINEAR = 1;

interface Frame {
  readonly texture: Texture | null;
  readonly duration: number;
}

interface Animation {
  readonly speed: number;
  readonly loop: number;
  readonly frames: readonly Frame[];
}

/** A SpriteFrames resource: its animations by name, in insertion order. */
export interface SpriteFrames {
  readonly animations: Map<string, Animation>;
}

/** One animation as a scene states it (`_set_animations`, `sprite_frames.cpp:206`). */
export interface GodotSpriteFramesAnimation {
  readonly name: string;
  readonly speed: number;
  /** A LoopMode, or a boolean (`(int)loop`: false 0, true 1). */
  readonly loop: number | boolean;
  readonly frames: readonly { readonly texture: Texture | null; readonly duration: number }[];
}

/**
 * A SpriteFrames: with no `animations`, the constructor's empty `default` animation (speed 5,
 * looping, `sprite_frames.cpp:307`, `sprite_frames.h:52`); with them, `_set_animations`: every
 * animation replaced by these, each duration stored as a float of at least the minimum, the loop as
 * `(int)loop`.
 *
 * @godot SpriteFrames (protocol)
 * @source scene/resources/sprite_frames.cpp:206
 */
export function godot_sprite_frames_new(animations?: readonly GodotSpriteFramesAnimation[]): SpriteFrames {
  const self: SpriteFrames = { animations: new Map() };
  if (animations === undefined) {
    self.animations.set('default', { speed: 5, loop: LOOP_LINEAR, frames: [] });
    return self;
  }
  for (const animation of animations) {
    self.animations.set(animation.name, {
      speed: animation.speed,
      loop: typeof animation.loop === 'boolean' ? (animation.loop ? LOOP_LINEAR : LOOP_NONE) : Math.trunc(animation.loop),
      frames: animation.frames.map((frame) => ({ texture: frame.texture, duration: Math.max(MINIMUM_DURATION, f32(frame.duration)) })),
    });
  }
  return self;
}

/**
 * The names in insertion order (`get_animation_list`, `sprite_frames.cpp:129`).
 *
 * @godot SpriteFrames (protocol)
 * @source scene/resources/sprite_frames.cpp:129
 */
export function godot_sprite_frames_animation_list(self: SpriteFrames): readonly string[] {
  return [...self.animations.keys()];
}

/**
 * @godot SpriteFrames.has_animation
 * @source scene/resources/sprite_frames.cpp:106
 */
export function has_animation(self: SpriteFrames, anim: string): boolean {
  return self.animations.has(anim);
}

/**
 * The names, sorted (`Vector<String>::sort`, by code point).
 *
 * @godot SpriteFrames.get_animation_names
 * @source scene/resources/sprite_frames.cpp:135
 */
export function get_animation_names(self: SpriteFrames): string[] {
  return [...self.animations.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
 * A missing animation fails and reads `LOOP_NONE`.
 *
 * @godot SpriteFrames.get_animation_loop_mode
 * @source scene/resources/sprite_frames.cpp:173
 */
export function get_animation_loop_mode(self: SpriteFrames, anim: string): number {
  return self.animations.get(anim)?.loop ?? LOOP_NONE;
}

/**
 * A missing animation fails and reads 0.
 *
 * @godot SpriteFrames.get_frame_count
 * @source scene/resources/sprite_frames.cpp:70
 */
export function get_frame_count(self: SpriteFrames, anim: string): number {
  return self.animations.get(anim)?.frames.length ?? 0;
}

/**
 * A missing animation or a negative index fails and reads null; an index past the frames reads null.
 *
 * @godot SpriteFrames.get_frame_texture
 * @source scene/resources/sprite_frames.h:94
 */
export function get_frame_texture(self: SpriteFrames, anim: string, idx: number): Texture | null {
  if (idx < 0) return null;
  return self.animations.get(anim)?.frames[idx]?.texture ?? null;
}

/**
 * A missing animation or a negative index fails and reads 1; an index past the frames reads 1.
 *
 * @godot SpriteFrames.get_frame_duration
 * @source scene/resources/sprite_frames.h:105
 */
export function get_frame_duration(self: SpriteFrames, anim: string, idx: number): number {
  if (idx < 0) return 1;
  return self.animations.get(anim)?.frames[idx]?.duration ?? 1;
}
