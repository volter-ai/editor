/**
 * @godot-class CallbackTweener
 * @role PROTOCOL
 *
 * Godot 4.7's `CallbackTweener`, transcribed from `scene/animation/tween.cpp` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: a Callable called once its delay has passed.
 * `Tween.tween_callback` makes it (`tween.ts`); its callback and delay live in `CALLBACK_TWEENER`,
 * the base `Tweener` state in `tweener.ts`. A compat Callable is a JS function, which is always
 * valid (`callable.ts`), so `Callable::is_valid`'s freed-object case does not arise here.
 */

import { godot_tweener_elapsed, godot_tweener_finish, godot_tweener_init, godot_tweener_is_finished, godot_tweener_set_elapsed } from './tweener';

/** An opaque CallbackTweener (`Ref<CallbackTweener>`). */
export interface CallbackTweener {
  readonly __godotCallbackTweener: true;
}

interface CallbackTweenerState {
  readonly callback: (...args: never[]) => unknown;
  delay: number;
}

const CALLBACK_TWEENER = new WeakMap<CallbackTweener, CallbackTweenerState>();

function stateOf(tweener: CallbackTweener): CallbackTweenerState {
  const state = CALLBACK_TWEENER.get(tweener);
  if (state === undefined) throw new TypeError('godot-compat: not a CallbackTweener.');
  return state;
}

/**
 * `CallbackTweener(callback)` (`tween.cpp:787`), with its `step` as the tweener's virtual.
 *
 * @godot CallbackTweener (protocol)
 * @source scene/animation/tween.cpp:787
 */
export function godot_callback_tweener_create(callback: (...args: never[]) => unknown): CallbackTweener {
  const tweener = Object.freeze({ __godotCallbackTweener: true as const });
  const state: CallbackTweenerState = { callback, delay: 0 };
  CALLBACK_TWEENER.set(tweener, state);
  godot_tweener_init(tweener, { step: (r_delta) => step(tweener, state, r_delta) });
  return tweener;
}

/** `CallbackTweener::step` (`tween.cpp:755`): the call once the delay has passed. */
function step(tweener: CallbackTweener, state: CallbackTweenerState, r_delta: number): readonly [boolean, number] {
  if (godot_tweener_is_finished(tweener)) return [false, r_delta];
  const elapsed_time = godot_tweener_elapsed(tweener) + r_delta;
  godot_tweener_set_elapsed(tweener, elapsed_time);
  if (elapsed_time >= state.delay) {
    // A script error aborts only this callback (docs/GODOT.md §Order of work).
    try {
      (state.callback as () => unknown)();
    } catch (error) {
      console.error(error);
    }
    const left = elapsed_time - state.delay;
    godot_tweener_finish(tweener);
    return [false, left];
  }
  return [true, 0];
}

/**
 * Seconds the call waits after its step starts.
 *
 * @godot CallbackTweener.set_delay
 * @source scene/animation/tween.cpp:750
 */
export function set_delay(self: CallbackTweener, delay: number): CallbackTweener {
  stateOf(self).delay = delay;
  return self;
}
