/**
 * @godot-class MethodTweener
 * @role PROTOCOL
 *
 * Godot 4.7's `MethodTweener` (`scene/animation/tween.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Callable called each step with a value eased from
 * `from` to `to`. `Tween.tween_method` makes it (`tween.ts`); its callback, values, transition, ease
 * and delay live in `METHOD_TWEENER`, keyed by the record, the base `Tweener` state in `tweener.ts`.
 * A compat Callable is a JS function, always valid (`callable.ts`).
 */

import { godot_tween_interpolate_variant, godot_tween_subtract_variant } from './tween';
import { godot_tweener_elapsed, godot_tweener_finish, godot_tweener_init, godot_tweener_is_finished, godot_tweener_set_elapsed } from './tweener';

/** An opaque MethodTweener (`Ref<MethodTweener>`). */
export interface MethodTweener {
  readonly __godotMethodTweener: true;
}

/** `Tween::TRANS_MAX` / `EASE_MAX`: unset until the tweener joins its tween (`tween.h:239`). */
const TRANS_MAX = 12;
const EASE_MAX = 4;

interface MethodTweenerState {
  readonly callback: (value: never) => unknown;
  readonly initial_val: unknown;
  readonly delta_val: unknown;
  readonly final_val: unknown;
  readonly duration: number;
  trans_type: number;
  ease_type: number;
  delay: number;
}

const METHOD_TWEENER = new WeakMap<MethodTweener, MethodTweenerState>();

function stateOf(tweener: MethodTweener): MethodTweenerState {
  const state = METHOD_TWEENER.get(tweener);
  if (state === undefined) throw new TypeError('godot-compat: not a MethodTweener.');
  return state;
}

/**
 * `MethodTweener(callback, from, to, duration)` (`tween.cpp:877`), its `step` the tweener's virtual.
 *
 * @godot MethodTweener (protocol)
 * @source scene/animation/tween.cpp:877
 */
export function godot_method_tweener_create(callback: (value: never) => unknown, from: unknown, to: unknown, duration: number): MethodTweener {
  const tweener = Object.freeze({ __godotMethodTweener: true as const });
  const state: MethodTweenerState = {
    callback,
    initial_val: from,
    delta_val: godot_tween_subtract_variant(to, from),
    final_val: to,
    duration,
    trans_type: TRANS_MAX,
    ease_type: EASE_MAX,
    delay: 0,
  };
  METHOD_TWEENER.set(tweener, state);
  godot_tweener_init(tweener, { step: (r_delta) => step(tweener, state, r_delta) });
  return tweener;
}

/**
 * `MethodTweener::set_tween`: an unset transition or ease takes the tween's default.
 *
 * @godot MethodTweener (protocol)
 * @source scene/animation/tween.cpp:861
 */
export function godot_method_tweener_set_tween(tweener: MethodTweener, trans: number, ease: number): void {
  const state = stateOf(tweener);
  if (state.trans_type === TRANS_MAX) state.trans_type = trans;
  if (state.ease_type === EASE_MAX) state.ease_type = ease;
}

/** `MethodTweener::step` (`tween.cpp:815`): the eased value (the final one at the end) to the callback. */
function step(tweener: MethodTweener, state: MethodTweenerState, r_delta: number): readonly [boolean, number] {
  if (godot_tweener_is_finished(tweener)) return [false, r_delta];
  const elapsed = godot_tweener_elapsed(tweener) + r_delta;
  godot_tweener_set_elapsed(tweener, elapsed);
  if (elapsed < state.delay) return [true, 0];
  const time = Math.min(elapsed - state.delay, state.duration);
  const value = time < state.duration ? godot_tween_interpolate_variant(state.initial_val, state.delta_val, time, state.duration, state.trans_type, state.ease_type) : state.final_val;
  // A script error aborts only this call (docs/GODOT.md §Order of work).
  try {
    state.callback(value as never);
  } catch (error) {
    console.error(error);
  }
  if (time < state.duration) return [true, 0];
  godot_tweener_finish(tweener);
  return [false, elapsed - state.delay - state.duration];
}

/**
 * Seconds the tweener waits after its step starts.
 *
 * @godot MethodTweener.set_delay
 * @source scene/animation/tween.cpp:800
 */
export function set_delay(self: MethodTweener, delay: number): MethodTweener {
  stateOf(self).delay = delay;
  return self;
}

/**
 * @godot MethodTweener.set_trans
 * @source scene/animation/tween.cpp:805
 */
export function set_trans(self: MethodTweener, trans: number): MethodTweener {
  stateOf(self).trans_type = trans;
  return self;
}

/**
 * @godot MethodTweener.set_ease
 * @source scene/animation/tween.cpp:810
 */
export function set_ease(self: MethodTweener, ease: number): MethodTweener {
  stateOf(self).ease_type = ease;
  return self;
}
