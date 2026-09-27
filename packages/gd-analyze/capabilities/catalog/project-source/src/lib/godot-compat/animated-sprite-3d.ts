/**
 * @godot-class AnimatedSprite3D
 * @role BINDING
 *
 * Godot 4.7's `AnimatedSprite3D` (`scene/3d/sprite_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three `Mesh` through `sprite-base-3d.ts`:
 * the current frame of its SpriteFrames' current animation drawn as the quad (`_draw`), and the
 * animation stepped in its internal process (`NOTIFICATION_INTERNAL_PROCESS`), which the Node
 * protocol runs on the SceneTree's clock: the frame's progress advances by the process delta at the
 * animation's speed times the speed scales and `1 / duration`, a finished frame moves to the next,
 * and the last frame loops, bounces or stops as the animation's loop mode says, emitting
 * `frame_changed`, `animation_looped` and `animation_finished` as Godot does. Real values are as
 * Godot stores them: `speed_scale` and `custom_speed_scale` are float, `frame_speed_scale` and
 * `frame_progress` `real_t` (float), the speed and the time left `double`.
 *
 * Bound: `sprite_frames`, `animation`, `frame`, `frame_progress` (read), `play` and `is_playing`,
 * what the corpus reaches. Not bound: `autoplay` (so `NOTIFICATION_READY` plays nothing),
 * `speed_scale` (1), `set_frame_progress`, `set_frame_and_progress`, `play_backwards`, `pause`,
 * `stop` (reached here only from within, as Godot's own code reaches them), and the SpriteFrames
 * `changed` connection (`_res_changed`): compat's SpriteFrames binds no member that changes it.
 */

import type { ReactElement } from 'react';
import { Mesh, type Texture } from 'three';
import { get_process_delta_time, godot_node_entity, godot_node_set_internal_process } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as rect2, type Rect2 } from './rect2';
import { type GodotSignal, godot_object_signal } from './signal';
import {
  godot_sprite_base_3d_draw_texture_rect,
  godot_sprite_base_3d_mount,
  godot_sprite_base_3d_origin,
  godot_sprite_base_3d_props,
  godot_sprite_base_3d_queue_redraw,
  godot_sprite_base_3d_set_based,
} from './sprite-base-3d';
import {
  get_animation_loop_mode,
  get_animation_names,
  get_animation_speed,
  get_frame_count,
  get_frame_duration,
  get_frame_texture,
  godot_sprite_frames_animation_list,
  has_animation,
  type SpriteFrames,
} from './sprite-frames';
import { get_size as texture_size } from './texture-2d';
import { construct as vector2 } from './vector2';

const f32 = Math.fround;

/** `SpriteFrames::LoopMode` (`sprite_frames.h:41`). */
const LOOP_NONE = 0;
const LOOP_PINGPONG = 2;

/** The signals `AnimatedSprite3D::_bind_methods` adds (`sprite_3d.cpp:1545`). */
export type GodotAnimatedSprite3DSignal = 'sprite_frames_changed' | 'animation_changed' | 'frame_changed' | 'animation_looped' | 'animation_finished';

interface AnimatedSprite3DState {
  frames: SpriteFrames | null;
  autoplay: string;
  playing: boolean;
  animation: string;
  frame: number;
  speedScale: number;
  customSpeedScale: number;
  frameSpeedScale: number;
  frameProgress: number;
}

const SPRITES = new WeakMap<Mesh, AnimatedSprite3DState>();

function stateOf(self: object, member: string): AnimatedSprite3DState {
  const state = SPRITES.get(godot_node_entity(self) as Mesh);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not an AnimatedSprite3D`);
  return state;
}

/** `std::signbit`: a negative number or a negative zero. */
const signbit = (value: number): boolean => value < 0 || Object.is(value, -0);

function emit(entity: object, name: GodotAnimatedSprite3DSignal): void {
  godot_object_signal<[]>(entity, name).emit();
}

/**
 * One of the node's signals, which its internal process and setters emit.
 *
 * @godot AnimatedSprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1545
 */
export function godot_animated_sprite_3d_signal(self: object, name: GodotAnimatedSprite3DSignal): GodotSignal<[]> {
  return godot_object_signal<[]>(godot_node_entity(self) as object, name).signal;
}

/** `AnimatedSprite3D::_draw` (`sprite_3d.cpp:1035`): the current frame's texture, centred. */
function draw(entity: Mesh): void {
  const state = SPRITES.get(entity) as AnimatedSprite3DState;
  godot_sprite_base_3d_set_based(entity, true);
  if (state.frames === null || !has_animation(state.frames, state.animation)) return;
  const texture = get_frame_texture(state.frames, state.animation, state.frame);
  if (texture === null) {
    godot_sprite_base_3d_set_based(entity, false);
    return;
  }
  const size = texture_size(texture);
  if (size.x === 0 || size.y === 0) return;
  godot_sprite_base_3d_draw_texture_rect(entity, texture, rect2(godot_sprite_base_3d_origin(size), size), rect2(vector2(0, 0), size));
}

/** `AnimatedSprite3D::get_item_rect` (`sprite_3d.cpp:1320`). */
function itemRect(entity: Mesh): Rect2 {
  const state = SPRITES.get(entity) as AnimatedSprite3DState;
  if (state.frames === null || !has_animation(state.frames, state.animation)) return rect2(0, 0, 1, 1);
  if (state.frame < 0 || state.frame >= get_frame_count(state.frames, state.animation)) return rect2(0, 0, 1, 1);
  const texture: Texture | null = state.animation === '' ? null : get_frame_texture(state.frames, state.animation, state.frame);
  if (texture === null) return rect2(0, 0, 1, 1);
  let s = texture_size(texture);
  const ofs = godot_sprite_base_3d_origin(s);
  if (s.x === 0 && s.y === 0) s = vector2(1, 1);
  return rect2(ofs, s);
}

/** `_calc_frame_speed_scale` (`sprite_3d.cpp:1443`) over `_get_frame_duration` (`:1436`). */
function calcFrameSpeedScale(state: AnimatedSprite3DState): void {
  const duration = state.frames !== null && has_animation(state.frames, state.animation) ? get_frame_duration(state.frames, state.animation, state.frame) : 1;
  state.frameSpeedScale = f32(1.0 / duration);
}

/** `get_playing_speed` (`sprite_3d.cpp:1313`). */
function playingSpeed(state: AnimatedSprite3DState): number {
  return state.playing ? f32(state.speedScale * state.customSpeedScale) : 0;
}

/** `set_frame_and_progress` (`sprite_3d.cpp:1278`): the frame clamped to the animation's. */
function setFrameAndProgress(entity: Mesh, state: AnimatedSprite3DState, frame: number, progress: number): void {
  if (state.frames === null) return;
  const has = has_animation(state.frames, state.animation);
  const endFrame = has ? Math.max(0, get_frame_count(state.frames, state.animation) - 1) : 0;
  const changed = state.frame !== frame;
  if (frame < 0) state.frame = 0;
  else if (has && frame > endFrame) state.frame = endFrame;
  else state.frame = frame;
  calcFrameSpeedScale(state);
  state.frameProgress = f32(progress);
  if (!changed) return;
  godot_sprite_base_3d_queue_redraw(entity);
  emit(entity, 'frame_changed');
}

/** `_stop_internal` (`sprite_3d.cpp:1418`), `pause` (`:1428`) without reset, `stop` (`:1432`) with. */
function stopInternal(entity: Mesh, state: AnimatedSprite3DState, reset: boolean): void {
  state.playing = false;
  if (reset) {
    state.customSpeedScale = 1;
    setFrameAndProgress(entity, state, 0, 0);
  }
  godot_node_set_internal_process(entity, undefined);
}

/** `NOTIFICATION_INTERNAL_PROCESS` (`sprite_3d.cpp:1132`): the process delta spent on the frames. */
function internalProcess(entity: Mesh, state: AnimatedSprite3DState): void {
  if (state.frames === null || !has_animation(state.frames, state.animation)) return;
  let remaining = get_process_delta_time(entity);
  let i = 0;
  while (remaining !== 0) {
    const frames = state.frames as SpriteFrames;
    // Animation speed may be changed by animation_finished or frame_changed signals.
    const speed = get_animation_speed(frames, state.animation) * state.speedScale * state.customSpeedScale * state.frameSpeedScale;
    const absSpeed = Math.abs(speed);
    if (speed === 0) return;
    const fc = get_frame_count(frames, state.animation);
    const lastFrame = fc - 1;
    if (!signbit(speed)) {
      if (state.frameProgress >= 1.0) {
        if (state.frame >= lastFrame) {
          const loop = get_animation_loop_mode(frames, state.animation);
          if (loop === LOOP_NONE) {
            state.frame = lastFrame;
            stopInternal(entity, state, false);
            emit(entity, 'animation_finished');
            return;
          }
          if (loop === LOOP_PINGPONG) {
            state.frame = lastFrame;
            state.customSpeedScale = f32(-state.customSpeedScale);
          } else {
            state.frame = 0;
          }
          emit(entity, 'animation_looped');
        } else {
          state.frame += 1;
        }
        calcFrameSpeedScale(state);
        state.frameProgress = 0;
        godot_sprite_base_3d_queue_redraw(entity);
        emit(entity, 'frame_changed');
      }
      const toProcess = Math.min((1.0 - state.frameProgress) / absSpeed, remaining);
      state.frameProgress = f32(state.frameProgress + toProcess * absSpeed);
      remaining -= toProcess;
    } else {
      if (state.frameProgress <= 0) {
        if (state.frame <= 0) {
          const loop = get_animation_loop_mode(frames, state.animation);
          if (loop === LOOP_NONE) {
            state.frame = 0;
            stopInternal(entity, state, false);
            emit(entity, 'animation_finished');
            return;
          }
          if (loop === LOOP_PINGPONG) {
            state.frame = 0;
            state.customSpeedScale = f32(-state.customSpeedScale);
          } else {
            state.frame = lastFrame;
          }
          emit(entity, 'animation_looped');
        } else {
          state.frame -= 1;
        }
        calcFrameSpeedScale(state);
        state.frameProgress = 1;
        godot_sprite_base_3d_queue_redraw(entity);
        emit(entity, 'frame_changed');
      }
      const toProcess = Math.min(state.frameProgress / absSpeed, remaining);
      state.frameProgress = f32(state.frameProgress - toProcess * absSpeed);
      remaining -= toProcess;
    }
    i += 1;
    // Prevents freezing if to_process is each time much less than remaining.
    if (i > fc) return;
  }
}

/**
 * Makes `entity` an AnimatedSprite3D (`AnimatedSprite3D::AnimatedSprite3D`, `sprite_3d.cpp:1563`;
 * `sprite_3d.h:260`): no frames, animation `default`, frame 0, not playing, every speed scale 1.
 *
 * @godot AnimatedSprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1563
 */
export function godot_animated_sprite_3d_mount(entity: Mesh): void {
  SPRITES.set(entity, {
    frames: null,
    autoplay: '',
    playing: false,
    animation: 'default',
    frame: 0,
    speedScale: 1,
    customSpeedScale: 1,
    frameSpeedScale: 1,
    frameProgress: 0,
  });
  godot_sprite_base_3d_mount(entity, { draw, itemRect });
}

/**
 * The first animation (in insertion order) becomes current when the frames lack the current one;
 * the node stops (frame 0), redraws and emits `sprite_frames_changed`.
 *
 * @godot AnimatedSprite3D.set_sprite_frames
 * @source scene/3d/sprite_3d.cpp:1224
 */
export function set_sprite_frames(self: object, sprite_frames: SpriteFrames | null): void {
  const entity = godot_node_entity(self) as Mesh;
  const state = stateOf(entity, 'set_sprite_frames');
  if (state.frames === sprite_frames) return;
  state.frames = sprite_frames;
  if (sprite_frames !== null) {
    const list = godot_sprite_frames_animation_list(sprite_frames);
    if (list.length === 0) {
      set_animation(entity, '');
      state.autoplay = '';
    } else {
      if (!has_animation(sprite_frames, state.animation)) set_animation(entity, list[0] as string);
      if (!has_animation(sprite_frames, state.autoplay)) state.autoplay = '';
    }
  }
  stopInternal(entity, state, true);
  godot_sprite_base_3d_queue_redraw(entity);
  emit(entity, 'sprite_frames_changed');
}

/**
 * @godot AnimatedSprite3D.get_sprite_frames
 * @source scene/3d/sprite_3d.cpp:1258
 */
export function get_sprite_frames(self: object): SpriteFrames | null {
  return stateOf(self, 'get_sprite_frames').frames;
}

/**
 * The frame, its progress 0 (1 while playing backwards), clamped to the animation's frames.
 *
 * @godot AnimatedSprite3D.set_frame
 * @source scene/3d/sprite_3d.cpp:1262
 */
export function set_frame(self: object, frame: number): void {
  const entity = godot_node_entity(self) as Mesh;
  const state = stateOf(entity, 'set_frame');
  setFrameAndProgress(entity, state, Math.trunc(frame), signbit(playingSpeed(state)) ? 1.0 : 0.0);
}

/**
 * @godot AnimatedSprite3D.get_frame
 * @source scene/3d/sprite_3d.cpp:1266
 */
export function get_frame(self: object): number {
  return stateOf(self, 'get_frame').frame;
}

/**
 * @godot AnimatedSprite3D.get_frame_progress
 * @source scene/3d/sprite_3d.cpp:1274
 */
export function get_frame_progress(self: object): number {
  return stateOf(self, 'get_frame_progress').frameProgress;
}

/**
 * @godot AnimatedSprite3D.is_playing
 * @source scene/3d/sprite_3d.cpp:1355
 */
export function is_playing(self: object): boolean {
  return stateOf(self, 'is_playing').playing;
}

/**
 * Plays `name` (the current animation when empty) from its start, or from its end with
 * `from_end`; a name the frames lack fails, an animation without frames does nothing. Replaying the
 * current animation restarts it only when it had finished.
 *
 * @godot AnimatedSprite3D.play
 * @source scene/3d/sprite_3d.cpp:1371
 */
export function play(self: object, name = '', custom_speed = 1.0, from_end = false): void {
  const entity = godot_node_entity(self) as Mesh;
  const state = stateOf(entity, 'play');
  const played = name === '' ? state.animation : name;
  if (state.frames === null) return;
  if (!get_animation_names(state.frames).includes(played)) return;
  if (get_frame_count(state.frames, played) === 0) return;
  state.playing = true;
  state.customSpeedScale = f32(custom_speed);
  if (played !== state.animation) {
    state.animation = played;
    const endFrame = Math.max(0, get_frame_count(state.frames, state.animation) - 1);
    if (from_end) setFrameAndProgress(entity, state, endFrame, 1.0);
    else setFrameAndProgress(entity, state, 0, 0.0);
    emit(entity, 'animation_changed');
  } else {
    const endFrame = Math.max(0, get_frame_count(state.frames, state.animation) - 1);
    const backward = signbit(f32(state.speedScale * state.customSpeedScale));
    if (from_end && backward && state.frame === 0 && state.frameProgress <= 0.0) setFrameAndProgress(entity, state, endFrame, 1.0);
    else if (!from_end && !backward && state.frame === endFrame && state.frameProgress >= 1.0) setFrameAndProgress(entity, state, 0, 0.0);
  }
  godot_node_set_internal_process(entity, () => internalProcess(entity, state));
  godot_sprite_base_3d_queue_redraw(entity);
}

/**
 * Emits `animation_changed`; without frames, or with a name the frames lack, the animation stops
 * (an empty or frameless one is kept, a missing one fails). Otherwise its first frame (its last,
 * playing backwards).
 *
 * @godot AnimatedSprite3D.set_animation
 * @source scene/3d/sprite_3d.cpp:1447
 */
export function set_animation(self: object, name: string): void {
  const entity = godot_node_entity(self) as Mesh;
  const state = stateOf(entity, 'set_animation');
  if (state.animation === name) return;
  state.animation = name;
  emit(entity, 'animation_changed');
  if (state.frames === null) {
    state.animation = '';
    stopInternal(entity, state, true);
    return;
  }
  if (state.animation === '' || get_frame_count(state.frames, state.animation) === 0) {
    stopInternal(entity, state, true);
    return;
  } else if (!get_animation_names(state.frames).includes(state.animation)) {
    state.animation = '';
    stopInternal(entity, state, true);
    return;
  }
  if (signbit(playingSpeed(state))) setFrameAndProgress(entity, state, get_frame_count(state.frames, state.animation) - 1, 1.0);
  else setFrameAndProgress(entity, state, 0, 0.0);
  godot_sprite_base_3d_queue_redraw(entity);
}

/**
 * @godot AnimatedSprite3D.get_animation
 * @source scene/3d/sprite_3d.cpp:1481
 */
export function get_animation(self: object): string {
  return stateOf(self, 'get_animation').animation;
}

const ANIMATED_SPRITE_3D = {
  create: () => new Mesh(),
  classes: ['AnimatedSprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: godot_animated_sprite_3d_mount,
  props: new Map<string, GodotElementProp<Mesh>>([
    ['spriteFrames', (entity, value: SpriteFrames | null) => set_sprite_frames(entity, value)],
    ['animation', (entity, value: string) => set_animation(entity, value)],
    ['frame', (entity, value: number) => set_frame(entity, value)],
    ...godot_sprite_base_3d_props(),
  ]),
};

/**
 * An AnimatedSprite3D as a scene writes it: `<GodotAnimatedSprite3D spriteFrames={…} frame={2} />`.
 *
 * @godot AnimatedSprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1563
 */
export function GodotAnimatedSprite3D(props: GodotElementProps<Mesh>): ReactElement {
  return useGodotElement(ANIMATED_SPRITE_3D, props);
}
