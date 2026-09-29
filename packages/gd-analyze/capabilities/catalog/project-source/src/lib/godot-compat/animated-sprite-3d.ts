/**
 * @godot-class AnimatedSprite3D
 * @role BINDING
 *
 * Godot 4.7's `AnimatedSprite3D` (`scene/3d/sprite_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a SpriteBase3D drawing the current frame of an
 * animation of its SpriteFrames. Playing, its internal processing advances the frame by the
 * animation's speed, the frame's duration and the speed scales (`NOTIFICATION_INTERNAL_PROCESS`),
 * emitting `frame_changed`, and at the end `animation_looped` or `animation_finished`.
 */

import type { ReactElement } from 'react';
import { Mesh } from 'three';
import { godot_node_adopt, godot_node_entity, godot_node_set_internal_process, ready } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { godot_sprite_base_3d_mount, godot_sprite_base_3d_props, godot_sprite_base_3d_redraw } from './sprite-base-3d';
import { get_animation_loop, get_animation_names, get_animation_speed, get_frame_count, get_frame_duration, get_frame_texture, has_animation, type SpriteFrames } from './sprite-frames';

interface AnimatedState {
  readonly entity: Mesh;
  frames: SpriteFrames | null;
  animation: string;
  autoplay: string;
  frame: number;
  frameProgress: number;
  speedScale: number;
  customSpeedScale: number;
  frameSpeedScale: number;
  playing: boolean;
  readonly signals: Readonly<Record<'animation_finished' | 'animation_looped' | 'animation_changed' | 'frame_changed' | 'sprite_frames_changed', SignalHandle<[]>>>;
}

const ANIMATED = new WeakMap<object, AnimatedState>();

function stateOf(self: object, member: string): AnimatedState {
  const state = ANIMATED.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not an AnimatedSprite3D`);
  return state;
}

function frameCount(state: AnimatedState): number {
  return state.frames === null ? 0 : get_frame_count(state.frames, state.animation);
}

/** `_calc_frame_speed_scale` (`sprite_3d.cpp:1280`). */
function calcFrameSpeedScale(state: AnimatedState): void {
  state.frameSpeedScale = state.frames === null ? 1 : 1 / get_frame_duration(state.frames, state.animation, state.frame);
}

function playingSpeed(state: AnimatedState): number {
  return state.playing && state.frames !== null ? get_animation_speed(state.frames, state.animation) * state.speedScale * state.customSpeedScale : 0;
}

/** `set_frame_and_progress` (`sprite_3d.cpp:1318`). */
function setFrameAndProgress(state: AnimatedState, frame: number, progress: number): void {
  if (state.frames === null) return;
  const count = frameCount(state);
  const clamped = count === 0 ? 0 : Math.min(Math.max(frame, 0), count - 1);
  const changed = state.frame !== clamped;
  state.frame = clamped;
  calcFrameSpeedScale(state);
  state.frameProgress = progress;
  if (!changed) return;
  godot_sprite_base_3d_redraw(state.entity);
  state.signals.frame_changed.emit();
}

/** `NOTIFICATION_INTERNAL_PROCESS` (`sprite_3d.cpp:1117`). */
function advance(state: AnimatedState, delta: number): void {
  if (state.frames === null || !has_animation(state.frames, state.animation)) return;
  let remaining = delta;
  let i = 0;
  while (remaining > 0) {
    const speed = get_animation_speed(state.frames, state.animation) * state.speedScale * state.customSpeedScale * state.frameSpeedScale;
    const absSpeed = Math.abs(speed);
    if (speed === 0) return;
    const count = frameCount(state);
    const last = count - 1;
    if (speed > 0 || Object.is(speed, 0)) {
      if (state.frameProgress >= 1) {
        if (state.frame >= last) {
          if (get_animation_loop(state.frames, state.animation)) {
            state.frame = 0;
            state.signals.animation_looped.emit();
          } else {
            state.frame = last;
            stopInternal(state, false);
            state.signals.animation_finished.emit();
            return;
          }
        } else state.frame += 1;
        calcFrameSpeedScale(state);
        state.frameProgress = 0;
        godot_sprite_base_3d_redraw(state.entity);
        state.signals.frame_changed.emit();
      }
      const toProcess = Math.min((1 - state.frameProgress) / absSpeed, remaining);
      state.frameProgress += toProcess * absSpeed;
      remaining -= toProcess;
    } else {
      if (state.frameProgress <= 0) {
        if (state.frame <= 0) {
          if (get_animation_loop(state.frames, state.animation)) {
            state.frame = last;
            state.signals.animation_looped.emit();
          } else {
            state.frame = 0;
            stopInternal(state, false);
            state.signals.animation_finished.emit();
            return;
          }
        } else state.frame -= 1;
        calcFrameSpeedScale(state);
        state.frameProgress = 1;
        godot_sprite_base_3d_redraw(state.entity);
        state.signals.frame_changed.emit();
      }
      const toProcess = Math.min(state.frameProgress / absSpeed, remaining);
      state.frameProgress -= toProcess * absSpeed;
      remaining -= toProcess;
    }
    i += 1;
    if (i > count) return;
  }
}

function setProcessing(state: AnimatedState, on: boolean): void {
  godot_node_set_internal_process(state.entity, on ? (delta) => advance(state, delta) : undefined);
}

/** `_stop_internal` (`sprite_3d.cpp:1466`). */
function stopInternal(state: AnimatedState, reset: boolean): void {
  state.playing = false;
  if (reset) {
    state.customSpeedScale = 1;
    setFrameAndProgress(state, 0, 0);
  }
  setProcessing(state, false);
}

/**
 * Makes `entity` an AnimatedSprite3D; `autoplay` plays when it is ready (`sprite_3d.cpp:1108`).
 *
 * @godot AnimatedSprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1108
 */
export function godot_animated_sprite_3d_mount(entity: Mesh): void {
  const state: AnimatedState = {
    entity,
    frames: null,
    animation: 'default',
    autoplay: '',
    frame: 0,
    frameProgress: 0,
    speedScale: 1,
    customSpeedScale: 1,
    frameSpeedScale: 1,
    playing: false,
    signals: {
      animation_finished: createSignal<[]>(),
      animation_looped: createSignal<[]>(),
      animation_changed: createSignal<[]>(),
      frame_changed: createSignal<[]>(),
      sprite_frames_changed: createSignal<[]>(),
    },
  };
  ANIMATED.set(entity, state);
  godot_sprite_base_3d_mount(entity, () => (state.frames === null ? null : get_frame_texture(state.frames, state.animation, state.frame)));
  ready(entity).connect(() => {
    if (state.frames !== null && has_animation(state.frames, state.autoplay)) play(entity, state.autoplay);
  });
}

/**
 * A new AnimatedSprite3D (`AnimatedSprite3D.new()`).
 *
 * @godot AnimatedSprite3D.AnimatedSprite3D
 * @source scene/3d/sprite_3d.cpp:1590
 */
export function construct(): Mesh {
  const entity = new Mesh();
  godot_node_adopt(entity, { kind: 'spatial', classes: ['AnimatedSprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'] });
  godot_animated_sprite_3d_mount(entity);
  return entity;
}

/**
 * @godot AnimatedSprite3D.set_sprite_frames
 * @source scene/3d/sprite_3d.cpp:1195
 */
export function set_sprite_frames(self: object, frames: SpriteFrames | null): void {
  const state = stateOf(self, 'set_sprite_frames');
  if (state.frames === frames) return;
  state.frames = frames;
  if (frames === null) state.frame = 0;
  else {
    const names = get_animation_names(frames);
    if (names.length === 0) {
      set_animation(self, '');
      state.autoplay = '';
    } else {
      if (!has_animation(frames, state.animation)) set_animation(self, names[0] as string);
      if (!has_animation(frames, state.autoplay)) state.autoplay = '';
    }
  }
  godot_sprite_base_3d_redraw(self);
  state.signals.sprite_frames_changed.emit();
}

/**
 * @godot AnimatedSprite3D.get_sprite_frames
 * @source scene/3d/sprite_3d.cpp:1228
 */
export function get_sprite_frames(self: object): SpriteFrames | null {
  return stateOf(self, 'get_sprite_frames').frames;
}

/**
 * The frame, its progress at the start (or, playing backwards, the end).
 *
 * @godot AnimatedSprite3D.set_frame
 * @source scene/3d/sprite_3d.cpp:1232
 */
export function set_frame(self: object, frame: number): void {
  const state = stateOf(self, 'set_frame');
  setFrameAndProgress(state, frame, playingSpeed(state) < 0 ? 1 : 0);
}

/**
 * @godot AnimatedSprite3D.get_frame
 * @source scene/3d/sprite_3d.cpp:1236
 */
export function get_frame(self: object): number {
  return stateOf(self, 'get_frame').frame;
}

/**
 * @godot AnimatedSprite3D.set_frame_progress
 * @source scene/3d/sprite_3d.cpp:1240
 */
export function set_frame_progress(self: object, progress: number): void {
  stateOf(self, 'set_frame_progress').frameProgress = progress;
}

/**
 * @godot AnimatedSprite3D.get_frame_progress
 * @source scene/3d/sprite_3d.cpp:1244
 */
export function get_frame_progress(self: object): number {
  return stateOf(self, 'get_frame_progress').frameProgress;
}

/**
 * @godot AnimatedSprite3D.set_frame_and_progress
 * @source scene/3d/sprite_3d.cpp:1248
 */
export function set_frame_and_progress(self: object, frame: number, progress: number): void {
  setFrameAndProgress(stateOf(self, 'set_frame_and_progress'), frame, progress);
}

/**
 * @godot AnimatedSprite3D.set_speed_scale
 * @source scene/3d/sprite_3d.cpp:1291
 */
export function set_speed_scale(self: object, speed_scale: number): void {
  stateOf(self, 'set_speed_scale').speedScale = speed_scale;
}

/**
 * @godot AnimatedSprite3D.get_speed_scale
 * @source scene/3d/sprite_3d.cpp:1295
 */
export function get_speed_scale(self: object): number {
  return stateOf(self, 'get_speed_scale').speedScale;
}

/**
 * @godot AnimatedSprite3D.get_playing_speed
 * @source scene/3d/sprite_3d.cpp:1299
 */
export function get_playing_speed(self: object): number {
  return playingSpeed(stateOf(self, 'get_playing_speed'));
}

/**
 * @godot AnimatedSprite3D.is_playing
 * @source scene/3d/sprite_3d.cpp:1364
 */
export function is_playing(self: object): boolean {
  return stateOf(self, 'is_playing').playing;
}

/**
 * @godot AnimatedSprite3D.set_autoplay
 * @source scene/3d/sprite_3d.cpp:1368
 */
export function set_autoplay(self: object, name: string): void {
  stateOf(self, 'set_autoplay').autoplay = name;
}

/**
 * @godot AnimatedSprite3D.get_autoplay
 * @source scene/3d/sprite_3d.cpp:1377
 */
export function get_autoplay(self: object): string {
  return stateOf(self, 'get_autoplay').autoplay;
}

/**
 * Plays `name` (the current animation when empty) from its start, or from its end with
 * `from_end`; the one already playing goes on unless it ended.
 *
 * @godot AnimatedSprite3D.play
 * @source scene/3d/sprite_3d.cpp:1381
 */
export function play(self: object, name = '', custom_speed = 1, from_end = false): void {
  const state = stateOf(self, 'play');
  const next = name === '' ? state.animation : name;
  if (state.frames === null || !has_animation(state.frames, next)) return;
  if (get_frame_count(state.frames, next) === 0) return;
  state.playing = true;
  state.customSpeedScale = custom_speed;
  if (next !== state.animation) {
    state.animation = next;
    const end = Math.max(0, frameCount(state) - 1);
    if (from_end) setFrameAndProgress(state, end, 1);
    else setFrameAndProgress(state, 0, 0);
    state.signals.animation_changed.emit();
  } else {
    const end = Math.max(0, frameCount(state) - 1);
    const backward = get_animation_speed(state.frames, state.animation) * state.speedScale * state.customSpeedScale < 0;
    if (from_end && backward && state.frame === 0 && state.frameProgress <= 0) setFrameAndProgress(state, end, 1);
    else if (!from_end && !backward && state.frame === end && state.frameProgress >= 1) setFrameAndProgress(state, 0, 0);
  }
  setProcessing(state, true);
  godot_sprite_base_3d_redraw(self);
}

/**
 * @godot AnimatedSprite3D.play_backwards
 * @source scene/3d/sprite_3d.cpp:1422
 */
export function play_backwards(self: object, name = ''): void {
  play(self, name, -1, true);
}

/**
 * @godot AnimatedSprite3D.pause
 * @source scene/3d/sprite_3d.cpp:1476
 */
export function pause(self: object): void {
  stopInternal(stateOf(self, 'pause'), false);
}

/**
 * @godot AnimatedSprite3D.stop
 * @source scene/3d/sprite_3d.cpp:1480
 */
export function stop(self: object): void {
  stopInternal(stateOf(self, 'stop'), true);
}

/**
 * @godot AnimatedSprite3D.set_animation
 * @source scene/3d/sprite_3d.cpp:1488
 */
export function set_animation(self: object, name: string): void {
  const state = stateOf(self, 'set_animation');
  if (state.animation === name) return;
  state.animation = name;
  state.signals.animation_changed.emit();
  if (state.frames === null) {
    state.animation = '';
    stopInternal(state, true);
    return;
  }
  const count = frameCount(state);
  if (name === '' || count === 0) stopInternal(state, true);
  else if (!has_animation(state.frames, name)) {
    state.animation = '';
    stopInternal(state, true);
  } else if (playingSpeed(state) < 0) setFrameAndProgress(state, count - 1, 1);
  else setFrameAndProgress(state, 0, 0);
  godot_sprite_base_3d_redraw(self);
}

/**
 * @godot AnimatedSprite3D.get_animation
 * @source scene/3d/sprite_3d.cpp:1521
 */
export function get_animation(self: object): string {
  return stateOf(self, 'get_animation').animation;
}

function signalOf(name: keyof AnimatedState['signals']) {
  return (self: object): GodotSignal<[]> => stateOf(self, name).signals[name].signal;
}

/**
 * @godot AnimatedSprite3D.animation_finished
 * @source scene/3d/sprite_3d.cpp:1573
 */
export function animation_finished(self: object): GodotSignal<[]> {
  return signalOf('animation_finished')(self);
}

/**
 * @godot AnimatedSprite3D.animation_looped
 * @source scene/3d/sprite_3d.cpp:1572
 */
export function animation_looped(self: object): GodotSignal<[]> {
  return signalOf('animation_looped')(self);
}

/**
 * @godot AnimatedSprite3D.animation_changed
 * @source scene/3d/sprite_3d.cpp:1570
 */
export function animation_changed(self: object): GodotSignal<[]> {
  return signalOf('animation_changed')(self);
}

/**
 * @godot AnimatedSprite3D.frame_changed
 * @source scene/3d/sprite_3d.cpp:1571
 */
export function frame_changed(self: object): GodotSignal<[]> {
  return signalOf('frame_changed')(self);
}

/**
 * @godot AnimatedSprite3D.sprite_frames_changed
 * @source scene/3d/sprite_3d.cpp:1569
 */
export function sprite_frames_changed(self: object): GodotSignal<[]> {
  return signalOf('sprite_frames_changed')(self);
}

const ANIMATED_SPRITE_3D = {
  create: () => new Mesh(),
  classes: ['AnimatedSprite3D', 'SpriteBase3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: godot_animated_sprite_3d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Mesh>>([
    ...godot_sprite_base_3d_props(),
    ['spriteFrames', (entity, value: SpriteFrames | null) => set_sprite_frames(entity, value)],
    ['animation', (entity, value: string) => set_animation(entity, value)],
    ['autoplay', (entity, value: string) => set_autoplay(entity, value)],
    ['frame', (entity, value: number) => set_frame(entity, value)],
    ['frameProgress', (entity, value: number) => set_frame_progress(entity, value)],
    ['speedScale', (entity, value: number) => set_speed_scale(entity, value)],
  ]),
};

/**
 * An AnimatedSprite3D as a scene writes it: `<GodotAnimatedSprite3D spriteFrames={f} animation="shot" />`.
 *
 * @godot AnimatedSprite3D (protocol)
 * @source scene/3d/sprite_3d.cpp:1540
 */
export function GodotAnimatedSprite3D(props: GodotElementProps<Mesh>): ReactElement {
  return useGodotElement(ANIMATED_SPRITE_3D, props);
}
