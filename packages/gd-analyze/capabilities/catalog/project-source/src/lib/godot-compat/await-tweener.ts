/**
 * @godot-class AwaitTweener
 * @role PROTOCOL
 *
 * Godot 4.7's `AwaitTweener` (`scene/animation/tween.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a step that waits for a signal, or for its timeout.
 * `Tween.tween_await` makes it (`tween.ts`); it connects to the signal when made, and its
 * connection, timeout and whether the signal came live in `AWAIT_TWEENER`, the base `Tweener` state
 * in `tweener.ts`.
 */

import type { GodotConnection, GodotSignal } from './signal';
import { godot_tweener_elapsed, godot_tweener_finish, godot_tweener_init, godot_tweener_is_finished, godot_tweener_set_elapsed } from './tweener';

/** An opaque AwaitTweener (`Ref<AwaitTweener>`). */
export interface AwaitTweener {
  readonly __godotAwaitTweener: true;
}

interface AwaitTweenerState {
  readonly connection: GodotConnection;
  timeout: number;
  received: boolean;
}

const AWAIT_TWEENER = new WeakMap<AwaitTweener, AwaitTweenerState>();

/**
 * `AwaitTweener(signal)` (`tween.cpp:984`): connected to the signal now, `received` set by its
 * emission. Its `start` (`:953`) clears `received`; its `step` (`:958`) finishes once the signal has
 * come (or its connection is gone), or at the timeout (none while it is negative), consuming the
 * delta while it waits.
 *
 * @godot AwaitTweener (protocol)
 * @source scene/animation/tween.cpp:984
 */
export function godot_await_tweener_create(signal: GodotSignal<readonly unknown[]>): AwaitTweener {
  const tweener = Object.freeze({ __godotAwaitTweener: true as const });
  const state: AwaitTweenerState = {
    connection: signal.connect(() => {
      state.received = true;
    }),
    timeout: -1,
    received: false,
  };
  AWAIT_TWEENER.set(tweener, state);
  godot_tweener_init(tweener, {
    start: () => {
      state.received = false;
    },
    step: (r_delta) => {
      if (godot_tweener_is_finished(tweener)) return [false, r_delta];
      if (!state.connection.isConnected()) {
        godot_tweener_finish(tweener);
        return [false, r_delta];
      }
      const elapsed = godot_tweener_elapsed(tweener) + r_delta;
      godot_tweener_set_elapsed(tweener, elapsed);
      if (state.timeout >= 0 && elapsed >= state.timeout) {
        godot_tweener_finish(tweener);
        return [false, elapsed - state.timeout];
      }
      if (state.received) {
        godot_tweener_finish(tweener);
        return [false, 0];
      }
      return [true, 0];
    },
  });
  return tweener;
}

/**
 * Seconds to wait for the signal at most (negative: no timeout).
 *
 * @godot AwaitTweener.set_timeout
 * @source scene/animation/tween.cpp:948
 */
export function set_timeout(self: AwaitTweener, timeout: number): AwaitTweener {
  const state = AWAIT_TWEENER.get(self);
  if (state === undefined) throw new TypeError('godot-compat: not an AwaitTweener.');
  state.timeout = timeout;
  return self;
}
