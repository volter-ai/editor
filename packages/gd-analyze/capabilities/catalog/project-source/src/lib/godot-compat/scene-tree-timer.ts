/**
 * @godot-class SceneTreeTimer
 * @role PROTOCOL
 *
 * Godot 4.7's `SceneTreeTimer`, transcribed from `scene/main/scene_tree.cpp` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A timer is a record holding its `timeout` signal (read
 * as a property, as scripts read it); its time left and flags live in `TIMER`, keyed by the record.
 * `SceneTree.create_timer` makes it and `SceneTree`'s timer pass advances it (`scene-tree.ts`).
 */

import { createSignal, type GodotSignal, type SignalHandle } from './signal';

export interface SceneTreeTimer {
  readonly timeout: GodotSignal<[]>;
}

interface TimerState {
  timeLeft: number;
  processAlways: boolean;
  processInPhysics: boolean;
  ignoreTimeScale: boolean;
  readonly timeout: SignalHandle<[]>;
}

const TIMER = new WeakMap<SceneTreeTimer, TimerState>();

function stateOf(timer: SceneTreeTimer): TimerState {
  const state = TIMER.get(timer);
  if (state === undefined) throw new TypeError('godot-compat: not a SceneTreeTimer.');
  return state;
}

/**
 * A timer with its delay and flags (`SceneTree::create_timer`, `scene/main/scene_tree.cpp:1768`).
 *
 * @godot SceneTreeTimer (protocol)
 * @source scene/main/scene_tree.cpp:1768
 */
export function godot_timer_create(
  delay: number,
  processAlways: boolean,
  processInPhysics: boolean,
  ignoreTimeScale: boolean,
): SceneTreeTimer {
  const timeout = createSignal<[]>();
  const timer: SceneTreeTimer = Object.freeze({ timeout: timeout.signal });
  TIMER.set(timer, { timeLeft: delay, processAlways, processInPhysics, ignoreTimeScale, timeout });
  return timer;
}

/**
 * One step of `SceneTree::process_timers` for this timer (`scene/main/scene_tree.cpp:793`): a timer
 * of the other kind is skipped; otherwise `get_time_left() - delta` is stored, and at or below 0
 * `timeout` is emitted and the timer reports it is done.
 *
 * @godot SceneTreeTimer (protocol)
 * @source scene/main/scene_tree.cpp:793
 */
export function godot_timer_advance(timer: SceneTreeTimer, delta: number, physicsFrame: boolean): 'skip' | 'running' | 'done' {
  const state = stateOf(timer);
  if (state.processInPhysics !== physicsFrame) return 'skip';
  const timeLeft = get_time_left(timer) - delta;
  state.timeLeft = timeLeft;
  if (timeLeft <= 0) {
    state.timeout.emit();
    return 'done';
  }
  return 'running';
}

/**
 * `MAX(time_left, 0.0)`.
 *
 * @godot SceneTreeTimer.get_time_left
 * @source scene/main/scene_tree.cpp:88
 */
export function get_time_left(self: SceneTreeTimer): number {
  const timeLeft = stateOf(self).timeLeft;
  return timeLeft > 0 ? timeLeft : 0;
}

/**
 * @godot SceneTreeTimer.set_time_left
 * @source scene/main/scene_tree.cpp:84
 */
export function set_time_left(self: SceneTreeTimer, time: number): void {
  stateOf(self).timeLeft = time;
}
