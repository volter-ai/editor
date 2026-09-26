/**
 * @godot-class AnimationPlayer
 * @role PROTOCOL
 *
 * Godot 4.7's `AnimationPlayer` (`scene/animation/animation_player.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over compat's AnimationMixer: the playback (the
 * current animation's position, speed and section, the fading-out blends), its queue, blend times,
 * `animation_started`/`animation_finished`/`animation_changed`/`current_animation_changed`, and
 * autoplay on ready. Each process makes the current animation's instance (and each blend's) for the
 * mixer to blend and apply. Capture playback (an animation with `UPDATE_CAPTURE` tracks) and
 * markers are not transcribed (they throw).
 *
 * A scene writes the node as `<GodotAnimationPlayer libraries={{ '': coin }} autoplay="spin"
 * bindings={…} />`, its libraries loaded from the translation's data files.
 */

import { Group, type Object3D } from 'three';
import type { ReactElement } from 'react';
import { type Animation, godot_animation_capture_included } from './animation';
import type { AnimationLibrary } from './animation-library';
import {
  type GodotAnimationBindings,
  type GodotAnimationPlaybackInfo,
  godot_animation_mixer_adopt,
  godot_animation_mixer_animation,
  godot_animation_mixer_bind,
  godot_animation_mixer_clear_caches,
  godot_animation_mixer_emit,
  godot_animation_mixer_make_instance,
  godot_animation_mixer_process,
  godot_animation_mixer_set_library,
  godot_animation_mixer_set_process,
  has_animation,
  is_active,
  set_active,
  set_callback_mode_discrete,
  set_callback_mode_method,
  set_callback_mode_process,
  set_deterministic,
  set_reset_on_save_enabled,
} from './animation-mixer';
import { godot_node_entity, godot_node_ready_signal } from './node';
import { godot_message_queue_push } from './object';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type SignalHandle } from './signal';

const f32 = Math.fround;
const CMP_EPSILON = 0.00001;
/** `Animation::LoopMode` and `LoopedFlag` (`animation.h:74`, `:81`). */
const LOOP_NONE = 0;
const LOOP_LINEAR = 1;
const LOOPED_FLAG_NONE = 0;
const LOOPED_FLAG_END = 1;
const LOOPED_FLAG_START = 2;

/** `Math::is_equal_approx(double, double)` (`math_funcs.h:528`). */
function isEqualApprox(a: number, b: number): boolean {
  if (a === b) return true;
  let tolerance = CMP_EPSILON * Math.abs(a);
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(a - b) < tolerance;
}
/** `Animation::is_*_approx` (`animation.h:586`). */
const lessOrEqual = (a: number, b: number) => a < b || isEqualApprox(a, b);
const less = (a: number, b: number) => a < b && !isEqualApprox(a, b);
const greaterOrEqual = (a: number, b: number) => a > b || isEqualApprox(a, b);
const greater = (a: number, b: number) => a > b && !isEqualApprox(a, b);
/** `Math::is_zero_approx(double)` (`math_funcs.h:535`). */
const isZeroApprox = (value: number) => Math.abs(value) < CMP_EPSILON;
/** `Math::fposmod(double, double)` (`math_funcs.h:278`). */
function fposmod(x: number, y: number): number {
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return value + 0;
}
const signbit = (value: number) => value < 0 || Object.is(value, -0);

/** `AnimationPlayer::PlaybackData` (`animation_player.h:67`). */
interface PlaybackData {
  isEnabled: boolean;
  animationName: string;
  animationLength: number;
  pos: number;
  speedScale: number;
  startTime: number;
  endTime: number;
}

function startOf(data: PlaybackData): number {
  if (data.isEnabled && (less(data.startTime, 0) || greater(data.startTime, data.animationLength))) return 0;
  return data.startTime;
}

function endOf(data: PlaybackData): number {
  if (data.isEnabled && (less(data.endTime, 0) || greater(data.endTime, data.animationLength))) return data.animationLength;
  return data.endTime;
}

interface Blend {
  readonly data: PlaybackData;
  readonly blendTime: number;
  blendLeft: number;
}

interface PlayerSignals {
  readonly current_animation_changed: SignalHandle<[string]>;
  readonly animation_changed: SignalHandle<[string, string]>;
}

interface PlayerState {
  readonly entity: object;
  speedScale: number;
  defaultBlendTime: number;
  autoCapture: boolean;
  autoCaptureDuration: number;
  autoCaptureTransition: number;
  autoCaptureEase: number;
  current: PlaybackData;
  assigned: string;
  seeked: boolean;
  internalSeeked: boolean;
  started: boolean;
  blend: Blend[];
  readonly blendTimes: Map<string, number>;
  queue: string[];
  readonly next: Map<string, string>;
  tmpFrom: Animation | undefined;
  endReached: boolean;
  endNotify: boolean;
  finishedAnim: string;
  autoplay: string;
  playing: boolean;
  movieQuitOnFinish: boolean;
  readonly signals: PlayerSignals;
}

const PLAYERS = new WeakMap<object, PlayerState>();

function stateOf(self: object, member: string): PlayerState {
  const state = PLAYERS.get(godot_node_entity(self));
  if (state === undefined) throw new TypeError(`godot-compat: AnimationPlayer.${member} requires an AnimationPlayer receiver.`);
  return state;
}

function freshPlayback(): PlaybackData {
  return { isEnabled: false, animationName: '', animationLength: 0, pos: 0, speedScale: 1, startTime: 0, endTime: 0 };
}

const blendKey = (from: string, to: string) => `${from}\0${to}`;

/** `_process_playback_data` (`animation_player.cpp:162`). */
function processPlaybackData(state: PlayerState, cd: PlaybackData, delta: number, blend: number, seeked: boolean, internalSeeked: boolean, started: boolean, isCurrent: boolean): void {
  const speed = f32(f32(state.speedScale) * f32(cd.speedScale));
  const backwards = signbit(speed);
  let step = started ? 0 : delta * speed;
  let nextPos = cd.pos + step;
  const start = startOf(cd);
  const end = endOf(cd);
  const animation = godot_animation_mixer_animation(state.entity, cd.animationName) as Animation;
  let loopedFlag = LOOPED_FLAG_NONE;
  let weight = f32(blend);
  switch (animation.loop_mode) {
    case LOOP_NONE:
      if (less(nextPos, start)) nextPos = start;
      else if (greater(nextPos, end)) nextPos = end;
      step = nextPos - cd.pos;
      break;
    case LOOP_LINEAR:
      if (less(nextPos, start) && greaterOrEqual(cd.pos, start)) loopedFlag = LOOPED_FLAG_START;
      if (greater(nextPos, end) && lessOrEqual(cd.pos, end)) loopedFlag = LOOPED_FLAG_END;
      nextPos = fposmod(nextPos - start, end - start) + start;
      break;
    default:
      throw new Error('godot-compat: ping-pong playback is not transcribed.');
  }
  const prevPos = cd.pos;
  if (isCurrent && animation.loop_mode === LOOP_NONE) {
    if (!backwards && lessOrEqual(prevPos, end) && isEqualApprox(nextPos, end)) {
      nextPos = end;
      state.endReached = true;
      state.endNotify = less(prevPos, end);
      weight = 1;
    }
    if (backwards && greaterOrEqual(prevPos, start) && isEqualApprox(nextPos, start)) {
      nextPos = start;
      state.endReached = true;
      state.endNotify = greater(prevPos, start);
      weight = 1;
    }
  }
  cd.pos = nextPos;
  let infoDelta = started ? 0 : step;
  if (isZeroApprox(infoDelta) && backwards) infoDelta = -0;
  const info: GodotAnimationPlaybackInfo = {
    time: started ? prevPos : nextPos,
    delta: infoDelta,
    start,
    end,
    seeked: started ? true : seeked,
    isExternalSeeking: !internalSeeked && !started,
    loopedFlag,
    weight,
  };
  godot_animation_mixer_make_instance(state.entity, cd.animationName, info);
}

/** `get_current_blend_amount` (`animation_player.cpp:257`). */
function currentBlendAmount(state: PlayerState): number {
  let blend = 1;
  for (const b of state.blend) blend = f32(blend - b.blendLeft);
  return Math.max(0, blend);
}

/** `_blend_playback_data` (`animation_player.cpp:266`). */
function blendPlaybackData(state: PlayerState, delta: number, started: boolean): void {
  const seeked = state.seeked;
  const internalSeeked = state.internalSeeked;
  if (!isZeroApprox(delta)) {
    state.seeked = false;
    state.internalSeeked = false;
  }
  processPlaybackData(state, state.current, delta, currentBlendAmount(state), seeked, internalSeeked, started, true);
  if (state.endReached) {
    state.blend = [];
    if (state.endNotify) state.finishedAnim = state.assigned;
    return;
  }
  const erase: number[] = [];
  state.blend.forEach((b, i) => {
    b.blendLeft = Math.max(0, b.blendLeft - Math.abs(f32(state.speedScale) * delta) / b.blendTime);
    if (lessOrEqual(b.blendLeft, 0)) {
      erase.push(i);
      b.blendLeft = CMP_EPSILON;
    }
    processPlaybackData(state, b.data, delta, b.blendLeft, false, false, false, false);
  });
  for (let i = erase.length - 1; i >= 0; i -= 1) state.blend.splice(erase[i] as number, 1);
}

/** `_blend_pre_process` (`animation_player.cpp:305`). */
function blendPreProcess(state: PlayerState, delta: number): boolean {
  if (!state.current.isEnabled) {
    godot_animation_mixer_set_process(state.entity, false);
    return false;
  }
  state.tmpFrom = godot_animation_mixer_animation(state.entity, state.current.animationName);
  state.endReached = false;
  state.endNotify = false;
  state.finishedAnim = '';
  const started = state.started;
  if (state.started) state.started = false;
  const previous = state.current.animationName;
  blendPlaybackData(state, delta, started);
  return previous === state.current.animationName;
}

/** `_blend_post_process` (`animation_player.cpp:333`). */
function blendPostProcess(state: PlayerState): void {
  if (state.endReached) {
    if (state.tmpFrom === godot_animation_mixer_animation(state.entity, state.current.animationName)) {
      if (state.queue.length > 0) {
        if (state.finishedAnim !== '') {
          godot_animation_mixer_emit(state.entity, 'animation_finished', state.finishedAnim);
          if (state.queue.length === 0) {
            state.endReached = false;
            state.endNotify = false;
            state.tmpFrom = undefined;
            return;
          }
        }
        const old = state.assigned;
        play(state.entity, state.queue[0] as string);
        const renamed = state.assigned;
        state.queue.shift();
        if (state.endNotify) state.signals.animation_changed.emit(old, renamed);
      } else {
        godot_animation_mixer_clear_caches(state.entity);
        state.playing = false;
        godot_animation_mixer_set_process(state.entity, false);
        if (state.endNotify) {
          if (state.finishedAnim !== '') godot_animation_mixer_emit(state.entity, 'animation_finished', state.finishedAnim);
          state.signals.current_animation_changed.emit('');
        }
      }
    }
    state.endReached = false;
    state.endNotify = false;
  }
  state.tmpFrom = undefined;
}

/**
 * Makes an entity an AnimationPlayer: an AnimationMixer with the player's playback, which plays its
 * autoplay animation on ready (`NOTIFICATION_READY`, `animation_player.cpp:150`).
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:1074
 */
export function godot_animation_player_mount(entity: object): void {
  const state: PlayerState = {
    entity,
    speedScale: 1,
    defaultBlendTime: 0,
    autoCapture: true,
    autoCaptureDuration: -1,
    autoCaptureTransition: 0,
    autoCaptureEase: 0,
    current: freshPlayback(),
    assigned: '',
    seeked: false,
    internalSeeked: false,
    started: false,
    blend: [],
    blendTimes: new Map(),
    queue: [],
    next: new Map(),
    tmpFrom: undefined,
    endReached: false,
    endNotify: false,
    finishedAnim: '',
    autoplay: '',
    playing: false,
    movieQuitOnFinish: false,
    signals: { current_animation_changed: createSignal<[string]>(), animation_changed: createSignal<[string, string]>() },
  };
  PLAYERS.set(entity, state);
  godot_animation_mixer_adopt(entity, {
    preProcess: (delta) => blendPreProcess(state, delta),
    // `AnimationPlayer::advance` (`animation_player.cpp:704`): a started animation is processed first.
    advance: (delta) => {
      checkImmediatelyAfterStart(state);
      godot_animation_mixer_process(entity, delta);
    },
    postProcess: () => blendPostProcess(state),
    animationChanged: (name) => {
      if (state.current.isEnabled && state.current.animationName === name) {
        const animation = godot_animation_mixer_animation(entity, name);
        if (animation !== undefined) state.current.animationLength = animation.length;
      }
    },
    // `AnimationPlayer::_animation_removed` (`animation_player.cpp:940`): after the mixer's update,
    // the blend times naming an animation still in the set.
    animationRemoved: (name, library) => {
      const key = library === '' ? name : `${library}/${name}`;
      if (!has_animation(entity, key)) return;
      for (const bk of [...state.blendTimes.keys()]) {
        const [from, to] = bk.split('\0') as [string, string];
        if (from === key || to === key) state.blendTimes.delete(bk);
      }
    },
  });
  godot_node_ready_signal(entity).connect(() => {
    if (has_animation(entity, state.autoplay)) {
      set_active(entity, is_active(entity));
      play(entity, state.autoplay);
      checkImmediatelyAfterStart(state);
    }
  });
}

/**
 * The player's own signals (`current_animation_changed`, `animation_changed`); the mixer's are
 * `godot_animation_mixer_signal`'s.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:1070
 */
export function godot_animation_player_signal<Name extends keyof PlayerSignals>(self: object, name: Name): PlayerSignals[Name]['signal'] {
  return stateOf(self, name).signals[name].signal as PlayerSignals[Name]['signal'];
}

/** `_check_immediately_after_start` (`animation_player.cpp:705`). */
function checkImmediatelyAfterStart(state: PlayerState): void {
  if (state.started) godot_animation_mixer_process(state.entity, 0);
}

/** `seek_internal` (`animation_player.cpp:663`). */
function seekInternal(state: PlayerState, time: number, update: boolean, updateOnly: boolean, internal: boolean): void {
  if (!is_active(state.entity)) return;
  const backward = less(time, state.current.pos);
  checkImmediatelyAfterStart(state);
  state.current.pos = time;
  if (!state.current.isEnabled) {
    if (state.assigned !== '') {
      const animation = godot_animation_mixer_animation(state.entity, state.assigned);
      if (animation === undefined) return;
      state.current.isEnabled = true;
      state.current.animationName = state.assigned;
      state.current.animationLength = animation.length;
    }
    if (!state.current.isEnabled) return;
  }
  state.seeked = true;
  state.internalSeeked = internal;
  if (update) {
    godot_animation_mixer_process(state.entity, backward ? -0 : 0, updateOnly);
    state.seeked = false;
  }
}

/** `_stop_internal` (`animation_player.cpp:830`). */
function stopInternal(state: PlayerState, reset: boolean, keepState: boolean): void {
  godot_animation_mixer_clear_caches(state.entity);
  const start = state.current.isEnabled ? startOf(state.current) : 0;
  if (reset) {
    state.blend = [];
    if (keepState) state.current.pos = start;
    else seekInternal(state, start, true, true, true);
    state.current.isEnabled = false;
    state.current.animationName = '';
    state.current.speedScale = 1;
    state.signals.current_animation_changed.emit('');
  }
  godot_animation_mixer_set_process(state.entity, false);
  state.queue = [];
  state.playing = false;
}

/**
 * `play_section` (`animation_player.cpp:465`): the blend from the current animation, the position
 * reset for a new animation, and `animation_started`; then the animation's `next` is queued.
 *
 * @godot AnimationPlayer.play_section
 * @source scene/animation/animation_player.cpp:465
 */
export function play_section(self: object, name = '', start_time = -1, end_time = -1, custom_blend = -1, custom_speed = 1, from_end = false): void {
  const state = stateOf(self, 'play_section');
  const requested = String(name);
  const key = requested === '' ? state.assigned : requested;
  const animation = godot_animation_mixer_animation(state.entity, key);
  if (animation === undefined) return;
  if (start_time >= 0 && end_time >= 0 && isEqualApprox(start_time, end_time)) return;
  if (start_time >= 0 && end_time >= 0 && greater(start_time, end_time)) return;
  if (state.current.isEnabled) {
    let blendTime = 0;
    if (greaterOrEqual(custom_blend, 0)) blendTime = custom_blend;
    else if (state.blendTimes.has(blendKey(state.current.animationName, key))) blendTime = state.blendTimes.get(blendKey(state.current.animationName, key)) as number;
    else if (state.blendTimes.has(blendKey('*', key))) blendTime = state.blendTimes.get(blendKey('*', key)) as number;
    else if (state.blendTimes.has(blendKey(state.current.animationName, '*'))) blendTime = state.blendTimes.get(blendKey(state.current.animationName, '*')) as number;
    if (less(custom_blend, 0) && isZeroApprox(blendTime) && state.defaultBlendTime !== 0) blendTime = state.defaultBlendTime;
    if (greater(blendTime, 0)) state.blend.push({ data: { ...state.current }, blendLeft: currentBlendAmount(state), blendTime });
    else state.blend = [];
  }
  const c = state.current;
  c.isEnabled = true;
  c.animationName = key;
  c.animationLength = animation.length;
  c.speedScale = f32(custom_speed);
  c.startTime = start_time;
  c.endTime = end_time;
  const start = startOf(c);
  const end = endOf(c);
  if (!state.endReached) state.queue = [];
  if (state.assigned !== key) {
    c.pos = from_end ? end : start;
    state.assigned = key;
    state.signals.current_animation_changed.emit(state.assigned);
  } else if (from_end && lessOrEqual(c.pos, start)) {
    seekInternal(state, end, true, true, true);
  } else if (!from_end && greaterOrEqual(c.pos, end)) {
    seekInternal(state, start, true, true, true);
  } else if (state.playing) {
    return;
  }
  state.seeked = false;
  state.started = true;
  godot_animation_mixer_set_process(state.entity, true);
  state.playing = true;
  godot_animation_mixer_emit(state.entity, 'animation_started', state.assigned);
  const next = state.next.get(requested);
  if (next !== undefined && next !== '' && has_animation(state.entity, next)) queue(self, next);
}

/**
 * With `playback_auto_capture` (the default) `play_with_capture`, which does nothing more for an
 * animation without capture tracks (`_capture`, `animation_player.cpp:565`).
 *
 * @godot AnimationPlayer.play
 * @source scene/animation/animation_player.cpp:423
 */
export function play(self: object, name = '', custom_blend = -1, custom_speed = 1, from_end = false): void {
  const state = stateOf(self, 'play');
  if (state.autoCapture) {
    const animation = godot_animation_mixer_animation(state.entity, String(name) === '' ? state.assigned : String(name));
    if (animation !== undefined && godot_animation_capture_included(animation)) throw new Error('godot-compat: AnimationPlayer capture playback is not transcribed.');
  }
  play_section(self, name, -1, -1, custom_blend, custom_speed, from_end);
}

/**
 * @godot AnimationPlayer.play_backwards
 * @source scene/animation/animation_player.cpp:403
 */
export function play_backwards(self: object, name = '', custom_blend = -1): void {
  play(self, name, custom_blend, -1, true);
}

/**
 * @godot AnimationPlayer.play_section_backwards
 * @source scene/animation/animation_player.cpp:411
 */
export function play_section_backwards(self: object, name = '', start_time = -1, end_time = -1, custom_blend = -1): void {
  play_section(self, name, start_time, end_time, custom_blend, -1, true);
}

/**
 * Plays now when nothing is playing, else after the queue.
 *
 * @godot AnimationPlayer.queue
 * @source scene/animation/animation_player.cpp:381
 */
export function queue(self: object, name: string): void {
  const state = stateOf(self, 'queue');
  if (!state.playing) play(self, name);
  else state.queue.push(String(name));
}

/**
 * @godot AnimationPlayer.get_queue
 * @source scene/animation/animation_player.cpp:389
 */
export function get_queue(self: object): string[] {
  return [...stateOf(self, 'get_queue').queue];
}

/**
 * @godot AnimationPlayer.clear_queue
 * @source scene/animation/animation_player.cpp:398
 */
export function clear_queue(self: object): void {
  stateOf(self, 'clear_queue').queue = [];
}

/**
 * @godot AnimationPlayer.is_playing
 * @source scene/animation/animation_player.cpp:604
 */
export function is_playing(self: object): boolean {
  return stateOf(self, 'is_playing').playing;
}

/**
 * `[stop]` or "" stops (deferred) when playing; another animation plays, keeping the speed.
 *
 * @godot AnimationPlayer.set_current_animation
 * @source scene/animation/animation_player.cpp:608
 */
export function set_current_animation(self: object, animation: string): void {
  const state = stateOf(self, 'set_current_animation');
  const name = String(animation);
  if (name === '[stop]' || name === '') {
    if (state.playing) {
      const entity = state.entity;
      godot_message_queue_push(entity, () => stop(entity));
    }
  } else if (!state.playing) {
    play(self, name);
  } else if (state.assigned !== name) {
    const speed = state.current.speedScale;
    play(self, name, -1, speed, signbit(speed));
  }
}

/**
 * "" when not playing.
 *
 * @godot AnimationPlayer.get_current_animation
 * @source scene/animation/animation_player.cpp:627
 */
export function get_current_animation(self: object): string {
  const state = stateOf(self, 'get_current_animation');
  return state.playing ? state.assigned : '';
}

/**
 * @godot AnimationPlayer.set_assigned_animation
 * @source scene/animation/animation_player.cpp:631
 */
export function set_assigned_animation(self: object, animation: string): void {
  const state = stateOf(self, 'set_assigned_animation');
  const name = String(animation);
  if (state.playing) {
    const speed = state.current.speedScale;
    play(self, name, -1, speed, signbit(speed));
    return;
  }
  const found = godot_animation_mixer_animation(state.entity, name);
  if (found === undefined) return;
  state.current.pos = 0;
  state.current.isEnabled = true;
  state.current.animationName = name;
  state.current.animationLength = found.length;
  state.current.startTime = -1;
  state.current.endTime = -1;
  state.assigned = name;
  state.signals.current_animation_changed.emit(state.assigned);
}

/**
 * @godot AnimationPlayer.get_assigned_animation
 * @source scene/animation/animation_player.cpp:648
 */
export function get_assigned_animation(self: object): string {
  return stateOf(self, 'get_assigned_animation').assigned;
}

/**
 * @godot AnimationPlayer.pause
 * @source scene/animation/animation_player.cpp:652
 */
export function pause(self: object): void {
  stopInternal(stateOf(self, 'pause'), false, false);
}

/**
 * @godot AnimationPlayer.stop
 * @source scene/animation/animation_player.cpp:656
 */
export function stop(self: object, keep_state = false): void {
  stopInternal(stateOf(self, 'stop'), true, keep_state);
}

/**
 * @godot AnimationPlayer.set_speed_scale
 * @source scene/animation/animation_player.cpp:660
 */
export function set_speed_scale(self: object, speed: number): void {
  stateOf(self, 'set_speed_scale').speedScale = f32(speed);
}

/**
 * @godot AnimationPlayer.get_speed_scale
 * @source scene/animation/animation_player.cpp:664
 */
export function get_speed_scale(self: object): number {
  return stateOf(self, 'get_speed_scale').speedScale;
}

/**
 * @godot AnimationPlayer.get_playing_speed
 * @source scene/animation/animation_player.cpp:668
 */
export function get_playing_speed(self: object): number {
  const state = stateOf(self, 'get_playing_speed');
  return state.playing ? f32(state.speedScale * state.current.speedScale) : 0;
}

/**
 * Seeking clamps to the section; with `update` the animation is processed at once.
 *
 * @godot AnimationPlayer.seek
 * @source scene/animation/animation_player.cpp:700
 */
export function seek(self: object, seconds: number, update = false, update_only = false): void {
  seekInternal(stateOf(self, 'seek'), seconds, update, update_only, false);
}

/**
 * @godot AnimationPlayer.is_animation_active
 * @source scene/animation/animation_player.cpp:715
 */
export function is_animation_active(self: object): boolean {
  return stateOf(self, 'is_animation_active').current.isEnabled;
}

/**
 * 0 without a current animation.
 *
 * @godot AnimationPlayer.get_current_animation_position
 * @source scene/animation/animation_player.cpp:719
 */
export function get_current_animation_position(self: object): number {
  const state = stateOf(self, 'get_current_animation_position');
  return state.current.isEnabled ? state.current.pos : 0;
}

/**
 * 0 without a current animation.
 *
 * @godot AnimationPlayer.get_current_animation_length
 * @source scene/animation/animation_player.cpp:724
 */
export function get_current_animation_length(self: object): number {
  const state = stateOf(self, 'get_current_animation_length');
  return state.current.isEnabled ? state.current.animationLength : 0;
}

/**
 * @godot AnimationPlayer.set_section
 * @source scene/animation/animation_player.cpp:747
 */
export function set_section(self: object, start_time = -1, end_time = -1): void {
  const state = stateOf(self, 'set_section');
  if (!state.current.isEnabled) return;
  if (greaterOrEqual(start_time, 0) && greaterOrEqual(end_time, 0) && greaterOrEqual(start_time, end_time)) return;
  state.current.startTime = start_time;
  state.current.endTime = end_time;
  state.current.pos = Math.min(Math.max(state.current.pos, startOf(state.current)), endOf(state.current));
}

/**
 * @godot AnimationPlayer.reset_section
 * @source scene/animation/animation_player.cpp:755
 */
export function reset_section(self: object): void {
  const state = stateOf(self, 'reset_section');
  state.current.startTime = -1;
  state.current.endTime = -1;
}

/**
 * @godot AnimationPlayer.get_section_start_time
 * @source scene/animation/animation_player.cpp:760
 */
export function get_section_start_time(self: object): number {
  const state = stateOf(self, 'get_section_start_time');
  return state.current.isEnabled ? startOf(state.current) : state.current.startTime;
}

/**
 * @godot AnimationPlayer.get_section_end_time
 * @source scene/animation/animation_player.cpp:765
 */
export function get_section_end_time(self: object): number {
  const state = stateOf(self, 'get_section_end_time');
  return state.current.isEnabled ? endOf(state.current) : state.current.endTime;
}

/**
 * @godot AnimationPlayer.has_section
 * @source scene/animation/animation_player.cpp:770
 */
export function has_section(self: object): boolean {
  const state = stateOf(self, 'has_section');
  return greaterOrEqual(state.current.startTime, 0) || greaterOrEqual(state.current.endTime, 0);
}

/**
 * Only read on ready: setting it later has no effect.
 *
 * @godot AnimationPlayer.set_autoplay
 * @source scene/animation/animation_player.cpp:774
 */
export function set_autoplay(self: object, name: string): void {
  stateOf(self, 'set_autoplay').autoplay = String(name);
}

/**
 * @godot AnimationPlayer.get_autoplay
 * @source scene/animation/animation_player.cpp:782
 */
export function get_autoplay(self: object): string {
  return stateOf(self, 'get_autoplay').autoplay;
}

/**
 * @godot AnimationPlayer.set_movie_quit_on_finish_enabled
 * @source scene/animation/animation_player.cpp:786
 */
export function set_movie_quit_on_finish_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_movie_quit_on_finish_enabled').movieQuitOnFinish = Boolean(enabled);
}

/**
 * @godot AnimationPlayer.is_movie_quit_on_finish_enabled
 * @source scene/animation/animation_player.cpp:790
 */
export function is_movie_quit_on_finish_enabled(self: object): boolean {
  return stateOf(self, 'is_movie_quit_on_finish_enabled').movieQuitOnFinish;
}

/**
 * A missing animation fails.
 *
 * @godot AnimationPlayer.animation_set_next
 * @source scene/animation/animation_player.cpp:852
 */
export function animation_set_next(self: object, animation_from: string, animation_to: string): void {
  const state = stateOf(self, 'animation_set_next');
  if (!has_animation(state.entity, animation_from)) return;
  state.next.set(String(animation_from), String(animation_to));
}

/**
 * @godot AnimationPlayer.animation_get_next
 * @source scene/animation/animation_player.cpp:857
 */
export function animation_get_next(self: object, animation_from: string): string {
  return stateOf(self, 'animation_get_next').next.get(String(animation_from)) ?? '';
}

/**
 * @godot AnimationPlayer.set_default_blend_time
 * @source scene/animation/animation_player.cpp:865
 */
export function set_default_blend_time(self: object, sec: number): void {
  stateOf(self, 'set_default_blend_time').defaultBlendTime = sec;
}

/**
 * @godot AnimationPlayer.get_default_blend_time
 * @source scene/animation/animation_player.cpp:869
 */
export function get_default_blend_time(self: object): number {
  return stateOf(self, 'get_default_blend_time').defaultBlendTime;
}

/**
 * Both animations must exist; a zero time removes the pair.
 *
 * @godot AnimationPlayer.set_blend_time
 * @source scene/animation/animation_player.cpp:873
 */
export function set_blend_time(self: object, animation_from: string, animation_to: string, sec: number): void {
  const state = stateOf(self, 'set_blend_time');
  if (!has_animation(state.entity, animation_from) || !has_animation(state.entity, animation_to) || sec < 0) return;
  const key = blendKey(String(animation_from), String(animation_to));
  if (isZeroApprox(sec)) state.blendTimes.delete(key);
  else state.blendTimes.set(key, sec);
}

/**
 * @godot AnimationPlayer.get_blend_time
 * @source scene/animation/animation_player.cpp:888
 */
export function get_blend_time(self: object, animation_from: string, animation_to: string): number {
  return stateOf(self, 'get_blend_time').blendTimes.get(blendKey(String(animation_from), String(animation_to))) ?? 0;
}

/**
 * @godot AnimationPlayer.set_auto_capture
 * @source scene/animation/animation_player.cpp:900
 */
export function set_auto_capture(self: object, auto_capture: boolean): void {
  stateOf(self, 'set_auto_capture').autoCapture = Boolean(auto_capture);
}

/**
 * @godot AnimationPlayer.is_auto_capture
 * @source scene/animation/animation_player.cpp:905
 */
export function is_auto_capture(self: object): boolean {
  return stateOf(self, 'is_auto_capture').autoCapture;
}

// --- The scene's element.

const PROPS = new Map<string, GodotElementProp<Object3D>>([
  ['bindings', (entity, value: GodotAnimationBindings) => godot_animation_mixer_bind(entity, value)],
  [
    'libraries',
    (entity, value: Readonly<Record<string, AnimationLibrary>>) => {
      for (const [name, library] of Object.entries(value)) godot_animation_mixer_set_library(entity, name, library);
    },
  ],
  ['active', (entity, value: boolean) => set_active(entity, value)],
  ['deterministic', (entity, value: boolean) => set_deterministic(entity, value)],
  ['resetOnSave', (entity, value: boolean) => set_reset_on_save_enabled(entity, value)],
  ['callbackModeDiscrete', (entity, value: number) => set_callback_mode_discrete(entity, value)],
  ['autoplay', (entity, value: string) => set_autoplay(entity, value)],
  ['callbackModeProcess', (entity, value: number) => set_callback_mode_process(entity, value)],
  ['callbackModeMethod', (entity, value: number) => set_callback_mode_method(entity, value)],
  ['speedScale', (entity, value: number) => set_speed_scale(entity, value)],
  ['playbackDefaultBlendTime', (entity, value: number) => set_default_blend_time(entity, value)],
  ['playbackAutoCapture', (entity, value: boolean) => set_auto_capture(entity, value)],
]);

const ANIMATION_PLAYER = {
  create: () => new Group(),
  classes: ['AnimationPlayer', 'AnimationMixer', 'Node', 'Object'],
  spatial: false,
  mount: godot_animation_player_mount,
  props: PROPS,
};

/**
 * An AnimationPlayer as a scene writes it: `<GodotAnimationPlayer bindings={…} libraries={{ '':
 * coin }} autoplay="spin" />`, the track bindings first, then its authored properties in order.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:1074
 */
export function GodotAnimationPlayer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(ANIMATION_PLAYER, props);
}

