/**
 * @godot-class SpriteFrames
 * @role BINDING
 *
 * Godot 4.7's `SpriteFrames` (`scene/resources/sprite_frames.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): named animations, each its frames (a texture and a
 * relative duration), its speed in frames per second and whether it loops. A new one has the
 * animation `default` at 5 frames per second, looping.
 */

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
