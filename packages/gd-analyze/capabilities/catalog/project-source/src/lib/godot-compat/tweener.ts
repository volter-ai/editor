/**
 * @godot-class Tweener
 * @role PROTOCOL
 *
 * Godot 4.7's `Tweener`, the base of the steps a `Tween` runs, transcribed from
 * `scene/animation/tween.cpp` and `tween.h` at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`.
 * A tweener is a record its subclass module makes (`PropertyTweener`, `CallbackTweener`); its
 * elapsed time, `finished` flag, owning tween and `finished` signal live here, keyed by the record,
 * with the subclass's `start` and `step` (the C++ virtuals) given when it is made.
 */

import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/** A tweener's virtuals: `start` after the base's (`Tweener::start`), and `step`. */
export interface GodotTweenerVirtuals {
  readonly start?: () => void;
  /** `step(double &r_delta)`: whether it is still active, and the delta it leaves. */
  readonly step: (r_delta: number) => readonly [active: boolean, r_delta: number];
}

interface TweenerState {
  /** `Tweener::tween_id`: the tween the tweener was appended to. */
  tween: object | undefined;
  elapsed_time: number;
  finished: boolean;
  readonly virtuals: GodotTweenerVirtuals;
  readonly finishedSignal: SignalHandle<[]>;
}

const TWEENER = new WeakMap<object, TweenerState>();

function stateOf(tweener: object): TweenerState {
  const state = TWEENER.get(tweener);
  if (state === undefined) throw new TypeError('godot-compat: not a Tweener.');
  return state;
}

/**
 * Registers a tweener record with its virtuals: `elapsed_time = 0`, `finished = false`
 * (`tween.h:48`).
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.h:48
 */
export function godot_tweener_init(tweener: object, virtuals: GodotTweenerVirtuals): void {
  TWEENER.set(tweener, { tween: undefined, elapsed_time: 0, finished: false, virtuals, finishedSignal: createSignal<[]>() });
}

/**
 * `Tweener::set_tween`: the tween the tweener belongs to.
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.cpp:58
 */
export function godot_tweener_set_tween(tweener: object, tween: object): void {
  stateOf(tweener).tween = tween;
}

/**
 * `Tweener::_get_tween`.
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.cpp:67
 */
export function godot_tweener_tween(tweener: object): object | undefined {
  return stateOf(tweener).tween;
}

/**
 * `Tweener::start` (`elapsed_time = 0; finished = false`), then the subclass's own start.
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.cpp:62
 */
export function godot_tweener_start(tweener: object): void {
  const state = stateOf(tweener);
  state.elapsed_time = 0;
  state.finished = false;
  state.virtuals.start?.();
}

/**
 * The tweener's `step(r_delta)` virtual.
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.h:47
 */
export function godot_tweener_step(tweener: object, r_delta: number): readonly [active: boolean, r_delta: number] {
  return stateOf(tweener).virtuals.step(r_delta);
}

/**
 * The time the tweener has run since it started (`elapsed_time`), which its `step` advances.
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.h:56
 */
export function godot_tweener_elapsed(tweener: object): number {
  return stateOf(tweener).elapsed_time;
}

/**
 * Stores `elapsed_time`.
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.h:56
 */
export function godot_tweener_set_elapsed(tweener: object, elapsed: number): void {
  stateOf(tweener).elapsed_time = elapsed;
}

/**
 * Whether the tweener has finished (`finished`), which a later `step` answers with `false`.
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.h:57
 */
export function godot_tweener_is_finished(tweener: object): boolean {
  return stateOf(tweener).finished;
}

/**
 * `Tweener::_finish`: `finished = true`, then the `finished` signal.
 *
 * @godot Tweener (protocol)
 * @source scene/animation/tween.cpp:71
 */
export function godot_tweener_finish(tweener: object): void {
  const state = stateOf(tweener);
  state.finished = true;
  state.finishedSignal.emit();
}

/**
 * The tweener's `finished` signal, emitted when it finishes.
 *
 * @godot Tweener.finished
 * @source scene/animation/tween.cpp:77
 */
export function finished(self: object): GodotSignal<[]> {
  return stateOf(self).finishedSignal.signal;
}
