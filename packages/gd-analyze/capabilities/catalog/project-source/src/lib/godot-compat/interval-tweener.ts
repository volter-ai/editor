/**
 * @godot-class IntervalTweener
 * @role PROTOCOL
 *
 * Godot 4.7's `IntervalTweener` (`scene/animation/tween.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a step that does nothing for its duration.
 * `Tween.tween_interval` makes it (`tween.ts`); the base `Tweener` state is `tweener.ts`'s.
 */

import { godot_tweener_elapsed, godot_tweener_finish, godot_tweener_init, godot_tweener_is_finished, godot_tweener_set_elapsed } from './tweener';

/** An opaque IntervalTweener (`Ref<IntervalTweener>`). */
export interface IntervalTweener {
  readonly __godotIntervalTweener: true;
}

/**
 * `IntervalTweener(time)` (`tween.cpp:742`), its `step` the tweener's virtual (`:725`): active
 * until its time has passed, then finished with what is left of the delta.
 *
 * @godot IntervalTweener (protocol)
 * @source scene/animation/tween.cpp:742
 */
export function godot_interval_tweener_create(duration: number): IntervalTweener {
  const tweener = Object.freeze({ __godotIntervalTweener: true as const });
  godot_tweener_init(tweener, {
    step: (r_delta) => {
      if (godot_tweener_is_finished(tweener)) return [false, r_delta];
      const elapsed = godot_tweener_elapsed(tweener) + r_delta;
      godot_tweener_set_elapsed(tweener, elapsed);
      if (elapsed < duration) return [true, 0];
      godot_tweener_finish(tweener);
      return [false, elapsed - duration];
    },
  });
  return tweener;
}
