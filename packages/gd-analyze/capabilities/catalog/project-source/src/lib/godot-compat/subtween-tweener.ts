/**
 * @godot-class SubtweenTweener
 * @role PROTOCOL
 *
 * Godot 4.7's `SubtweenTweener` (`scene/animation/tween.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a step that runs another Tween to its end.
 * `Tween.tween_subtween` makes it (`tween.ts`); the subtween and delay live in `SUBTWEEN_TWEENER`,
 * the base `Tweener` state in `tweener.ts`.
 */

import { get_total_elapsed_time, godot_tween_step, is_valid, play, stop, type Tween } from './tween';
import { godot_tweener_elapsed, godot_tweener_finish, godot_tweener_init, godot_tweener_is_finished, godot_tweener_set_elapsed } from './tweener';

/** An opaque SubtweenTweener (`Ref<SubtweenTweener>`). */
export interface SubtweenTweener {
  readonly __godotSubtweenTweener: true;
}

interface SubtweenTweenerState {
  readonly subtween: Tween;
  delay: number;
}

const SUBTWEEN_TWEENER = new WeakMap<SubtweenTweener, SubtweenTweenerState>();

/**
 * `SubtweenTweener(subtween)` (`tween.cpp:940`), with its `start` (`:894`: the subtween reset and
 * played, or the tweener finished when the subtween was killed) and `step` (`:909`: the subtween
 * stepped after the delay until it ends) as the tweener's virtuals.
 *
 * @godot SubtweenTweener (protocol)
 * @source scene/animation/tween.cpp:940
 */
export function godot_subtween_tweener_create(subtween: Tween): SubtweenTweener {
  const tweener = Object.freeze({ __godotSubtweenTweener: true as const });
  const state: SubtweenTweenerState = { subtween, delay: 0 };
  SUBTWEEN_TWEENER.set(tweener, state);
  godot_tweener_init(tweener, {
    start: () => {
      stop(subtween);
      if (is_valid(subtween)) play(subtween);
      else godot_tweener_finish(tweener);
    },
    step: (r_delta) => {
      if (godot_tweener_is_finished(tweener)) return [false, r_delta];
      const elapsed = godot_tweener_elapsed(tweener) + r_delta;
      godot_tweener_set_elapsed(tweener, elapsed);
      if (elapsed < state.delay) return [true, 0];
      if (!godot_tween_step(subtween, r_delta)) {
        godot_tweener_finish(tweener);
        return [false, elapsed - state.delay - get_total_elapsed_time(subtween)];
      }
      return [true, 0];
    },
  });
  return tweener;
}

/**
 * Seconds the subtween waits after the step starts.
 *
 * @godot SubtweenTweener.set_delay
 * @source scene/animation/tween.cpp:931
 */
export function set_delay(self: SubtweenTweener, delay: number): SubtweenTweener {
  const state = SUBTWEEN_TWEENER.get(self);
  if (state === undefined) throw new TypeError('godot-compat: not a SubtweenTweener.');
  state.delay = delay;
  return self;
}
