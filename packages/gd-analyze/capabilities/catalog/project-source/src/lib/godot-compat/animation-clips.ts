/**
 * @godot-class AnimationPlayer
 * @role PROTOCOL
 *
 * An imported model's AnimationPlayer as three plays a glTF's animations: its clips on three's
 * `AnimationMixer` over the model (drei's `useAnimations` idiom), each Godot animation the glTF
 * clip of its name, looped as the importer set it. `play` starts the clip's action, fading from the
 * one playing over the blend time; the speed scale is the mixer's; the mixer's `finished` event
 * ends a clip that does not loop, emits `animation_finished` and plays what is queued. The model's
 * element advances the mixer from its own frame (`useGodotClips`).
 */

import { AnimationMixer, LoopOnce, LoopPingPong, LoopRepeat, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/** `Animation::LoopMode` (`animation.h:74`). */
const LOOP_LINEAR = 1;
const LOOP_PINGPONG = 2;

interface ClipPlayer {
  readonly mixer: AnimationMixer;
  readonly clips: ReadonlyMap<string, { readonly clip: AnimationClip; readonly loopMode: number }>;
  /** The animation `play` last set (`assigned_animation`), and whether it is playing. */
  assigned: string;
  playing: boolean;
  action: AnimationAction | undefined;
  speedScale: number;
  defaultBlendTime: number;
  queue: string[];
  readonly signals: {
    readonly animation_started: SignalHandle<[string]>;
    readonly animation_finished: SignalHandle<[string]>;
    readonly current_animation_changed: SignalHandle<[string]>;
  };
}

const PLAYERS = new WeakMap<object, ClipPlayer>();
/** Each model's clip players, which its element advances. */
const MODELS = new WeakMap<object, ClipPlayer[]>();

/**
 * Makes a model's AnimationPlayer play the glTF's clips: `model` is the model's root, the clips
 * the loaded glTF's, each with the loop mode the importer gave its animation (`loopModes`).
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:1074
 */
export function godot_animation_clips_mount(player: object, model: Object3D, clips: readonly AnimationClip[], loopModes: ReadonlyMap<string, number>): void {
  const state: ClipPlayer = {
    mixer: new AnimationMixer(model),
    clips: new Map(clips.map((clip) => [clip.name, { clip, loopMode: loopModes.get(clip.name) ?? 0 }] as const)),
    assigned: '',
    playing: false,
    action: undefined,
    speedScale: 1,
    defaultBlendTime: 0,
    queue: [],
    signals: { animation_started: createSignal<[string]>(), animation_finished: createSignal<[string]>(), current_animation_changed: createSignal<[string]>() },
  };
  state.mixer.addEventListener('finished', (event) => {
    if (event.action !== state.action) return;
    state.playing = false;
    const finished = state.assigned;
    state.signals.animation_finished.emit(finished);
    const next = state.queue.shift();
    if (next !== undefined) godot_animation_clips_play(player, next);
    else state.signals.current_animation_changed.emit('');
  });
  PLAYERS.set(player, state);
  const players = MODELS.get(model) ?? [];
  players.push(state);
  MODELS.set(model, players);
}

/**
 * Whether an AnimationPlayer plays a glTF's clips (`godot_animation_clips_mount`).
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:1074
 */
export function godot_animation_clips_of(player: object): boolean {
  return PLAYERS.has(player);
}

function stateOf(player: object): ClipPlayer {
  const state = PLAYERS.get(player);
  if (state === undefined) throw new Error('godot-compat: the AnimationPlayer plays no clips');
  return state;
}

/**
 * `play`: the clip from its start (or from its end, backwards), fading from the one playing over the
 * blend time; the one already playing goes on.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:423
 */
export function godot_animation_clips_play(player: object, name: string, customBlend = -1, customSpeed = 1, fromEnd = false): void {
  const state = stateOf(player);
  const key = name === '' ? state.assigned : name;
  const entry = state.clips.get(key);
  if (entry === undefined) return;
  if (key === state.assigned && state.playing) return;
  const action = state.mixer.clipAction(entry.clip);
  action.reset();
  action.setLoop(entry.loopMode === LOOP_LINEAR ? LoopRepeat : entry.loopMode === LOOP_PINGPONG ? LoopPingPong : LoopOnce, Infinity);
  action.clampWhenFinished = true;
  action.timeScale = fromEnd ? -customSpeed : customSpeed;
  if (fromEnd) action.time = entry.clip.duration;
  const blend = customBlend >= 0 ? customBlend : state.defaultBlendTime;
  const previous = state.action;
  action.play();
  if (previous !== undefined && previous !== action) {
    if (blend > 0) action.crossFadeFrom(previous, blend, false);
    else previous.stop();
  }
  state.action = action;
  state.playing = true;
  if (state.assigned !== key) {
    state.assigned = key;
    state.signals.current_animation_changed.emit(key);
  }
  state.signals.animation_started.emit(key);
}

/**
 * `queue`: played when the one playing ends, at once when none is.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:376
 */
export function godot_animation_clips_queue(player: object, name: string): void {
  const state = stateOf(player);
  if (!state.playing) godot_animation_clips_play(player, name);
  else state.queue.push(name);
}

/**
 * `stop` (`keep_state` keeps the pose) or `pause`.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:634
 */
export function godot_animation_clips_stop(player: object, reset: boolean): void {
  const state = stateOf(player);
  state.queue = [];
  if (state.action !== undefined) {
    if (reset) state.action.stop();
    else state.action.paused = true;
  }
  state.playing = false;
}

/**
 * `current_animation`: the playing animation, else empty.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:762
 */
export function godot_animation_clips_current(player: object): string {
  const state = stateOf(player);
  return state.playing ? state.assigned : '';
}

/**
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:782
 */
export function godot_animation_clips_assigned(player: object): string {
  return stateOf(player).assigned;
}

/**
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:726
 */
export function godot_animation_clips_playing(player: object): boolean {
  return stateOf(player).playing;
}

/**
 * `speed_scale`: the mixer's time scale.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:816
 */
export function godot_animation_clips_set_speed(player: object, speed: number): void {
  const state = stateOf(player);
  state.speedScale = speed;
  state.mixer.timeScale = speed;
}

/**
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:820
 */
export function godot_animation_clips_speed(player: object): number {
  return stateOf(player).speedScale;
}

/**
 * The playing clip's position and length.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:870
 */
export function godot_animation_clips_position(player: object): number {
  return stateOf(player).action?.time ?? 0;
}

/**
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:878
 */
export function godot_animation_clips_length(player: object): number {
  const state = stateOf(player);
  return state.clips.get(state.assigned)?.clip.duration ?? 0;
}

/**
 * `seek`: the playing clip's position.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:846
 */
export function godot_animation_clips_seek(player: object, seconds: number): void {
  const state = stateOf(player);
  if (state.action !== undefined) state.action.time = seconds;
  state.mixer.update(0);
}

/**
 * The animations the player has, by name, and whether it has one.
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:414
 */
export function godot_animation_clips_list(player: object): string[] {
  return [...stateOf(player).clips.keys()].sort();
}

/**
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:805
 */
export function godot_animation_clips_set_default_blend(player: object, seconds: number): void {
  stateOf(player).defaultBlendTime = seconds;
}

/**
 * The player's signals: `animation_started`, `animation_finished`, `current_animation_changed`.
 *
 * @godot AnimationPlayer (protocol)
 * @source scene/animation/animation_player.cpp:1049
 */
export function godot_animation_clips_signal(player: object, name: string): GodotSignal<unknown[]> | undefined {
  const signals = stateOf(player).signals as Readonly<Record<string, SignalHandle<[string]>>>;
  return signals[name]?.signal as GodotSignal<unknown[]> | undefined;
}

/**
 * Advances a model's clip players by a frame's delta (the model's element's own frame).
 *
 * @godot AnimationMixer (protocol)
 * @source scene/animation/animation_mixer.cpp:2283
 */
export function godot_animation_clips_advance(model: object, delta: number): void {
  for (const state of MODELS.get(model) ?? []) state.mixer.update(delta);
}
