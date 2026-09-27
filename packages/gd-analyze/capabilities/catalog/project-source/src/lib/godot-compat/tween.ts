/**
 * @godot-class Tween
 * @role PROTOCOL
 *
 * Godot 4.7's `Tween`, transcribed from `scene/animation/tween.cpp`, `tween.h` and
 * `easing_equations.h` at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. A tween is an
 * opaque record `SceneTree.create_tween` makes (`scene-tree.ts`), which also steps it in the tree's
 * process or physics pass; its steps, flags and signals live in `TWEEN`, keyed by the record.
 *
 * Transcribed: `tween_property` and `tween_callback` (with `PropertyTweener` and `CallbackTweener`),
 * sequential and parallel steps, loops, speed scale, kill/stop/pause/play, the bound node, the
 * process and pause modes, and the `step_finished`, `loop_finished` and `finished` signals. Not
 * transcribed (no binding): `tween_interval`, `tween_method`, `tween_subtween`, `tween_await`,
 * `custom_step` and `set_ignore_time_scale`.
 *
 * The easing equations run in `real_t` (float32), as Godot declares them; where one calls the C
 * library in double (`Math::sin`/`cos` of a double argument) or in float (`Math::pow`/`sqrt` of
 * float arguments), the browser's `Math` is used and rounded as the C overload returns. Godot's
 * editor build is the oracle, so `DEBUG_ENABLED` code (the infinite-loop check) is transcribed.
 *
 * A property is tweened through the accessors the translation resolved for it (`get`/`set`, the
 * native class's getter and setter bindings, as a script's own property read and write use them);
 * `Object::get_indexed`/`set_indexed` by name is not dispatched here. The Variant arithmetic
 * (`Animation::add_variant`, `subtract_variant`, `interpolate_variant`) is transcribed for the
 * types the translation lets through: `float`, `Vector2`, `Vector3` and `Color`.
 */

import { type Color, construct as color } from './color';
import { can_process as nodeCanProcess, godot_node_is_freed, is_inside_tree } from './node';
import { godot_callback_tweener_create, type CallbackTweener } from './callback-tweener';
import { godot_property_tweener_create, godot_property_tweener_set_tween, type PropertyTweener } from './property-tweener';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { godot_tweener_set_tween, godot_tweener_start, godot_tweener_step } from './tweener';
import { construct as vector2, type Vector2 } from './vector2';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;

/** An opaque Tween (`Ref<Tween>`); its state is compat's. */
export interface Tween {
  readonly __godotTween: true;
}

/** `Tween::TWEEN_PROCESS_IDLE` (`tween.h:75`); any other mode runs in the physics pass. */
const TWEEN_PROCESS_IDLE = 1;
/** `Tween::TweenPauseMode` (`tween.h:78`). */
const TWEEN_PAUSE_BOUND = 0;
const TWEEN_PAUSE_PROCESS = 2;
/** `Tween::TransitionType` and `EaseType` bounds (`tween.h:84`, `:100`). */
const TRANS_MAX = 12;
const EASE_MAX = 4;
const EASE_IN_OUT = 2;
const TRANS_LINEAR = 0;

interface TweenState {
  process_mode: number;
  pause_mode: number;
  default_transition: number;
  default_ease: number;
  bound_node: object | undefined;
  readonly tweeners: object[][];
  total_time: number;
  current_step: number;
  loops: number;
  loops_done: number;
  speed_scale: number;
  is_bound: boolean;
  started: boolean;
  running: boolean;
  in_step: boolean;
  dead: boolean;
  valid: boolean;
  default_parallel: boolean;
  parallel_enabled: boolean;
  readonly finished: SignalHandle<[]>;
  readonly step_finished: SignalHandle<[number]>;
  readonly loop_finished: SignalHandle<[number]>;
}

const TWEEN = new WeakMap<Tween, TweenState>();

function stateOf(tween: Tween): TweenState {
  const state = TWEEN.get(tween);
  if (state === undefined) throw new TypeError('godot-compat: not a Tween.');
  return state;
}

/**
 * `Tween(SceneTree *p_parent_tree)`: a valid tween with the defaults `tween.h` declares; the tree
 * holds it (`SceneTree::create_tween`, `scene-tree.ts`).
 *
 * @godot Tween (protocol)
 * @source scene/animation/tween.cpp:554
 */
export function godot_tween_create(): Tween {
  const tween = Object.freeze({ __godotTween: true as const });
  TWEEN.set(tween, {
    process_mode: TWEEN_PROCESS_IDLE,
    pause_mode: TWEEN_PAUSE_BOUND,
    default_transition: TRANS_LINEAR,
    default_ease: EASE_IN_OUT,
    bound_node: undefined,
    tweeners: [],
    total_time: 0,
    current_step: -1,
    loops: 1,
    loops_done: 0,
    speed_scale: 1,
    is_bound: false,
    started: false,
    running: true,
    in_step: false,
    dead: false,
    valid: true,
    default_parallel: false,
    parallel_enabled: false,
    finished: createSignal<[]>(),
    step_finished: createSignal<[number]>(),
    loop_finished: createSignal<[number]>(),
  });
  return tween;
}

// --- Appending.

/** `CHECK_VALID()` (`tween.cpp:39`): Godot's error and a null result. */
function checkValid(state: TweenState): boolean {
  // "Tween invalid. Either finished or created outside scene tree." /
  // "Can't append to a Tween that has started. Use stop() first."
  return state.valid && !state.started;
}

/**
 * `Tween::append` (`tween.cpp:182`): into the current step when parallel is enabled, otherwise a new
 * step; parallel is then reset to the tween's default.
 */
function append(tween: Tween, state: TweenState, tweener: object): void {
  godot_tweener_set_tween(tweener, tween);
  if (state.parallel_enabled) state.current_step = Math.max(state.current_step, 0);
  else state.current_step += 1;
  state.parallel_enabled = state.default_parallel;
  while (state.tweeners.length < state.current_step + 1) state.tweeners.push([]);
  (state.tweeners[state.current_step] as object[]).push(tweener);
}

/** A property as the translation resolved it: its getter and setter on the target. */
export interface GodotTweenProperty {
  readonly get: (self: never) => unknown;
  readonly set: (self: never, value: never) => void;
}

/**
 * A `PropertyTweener` from the property's current value to `final_val` over `duration` seconds;
 * the value types must match (`Animation::validate_type_match`, an `int` final value on a `float`
 * property converts). The target and property are the translation's (`property` names what
 * `access` reads and writes).
 *
 * @godot Tween.tween_property
 * @source scene/animation/tween.cpp:100
 */
export function tween_property(
  self: Tween,
  object: object,
  property: string,
  final_val: unknown,
  duration: number,
  access: GodotTweenProperty,
): PropertyTweener | null {
  const state = stateOf(self);
  if (!checkValid(state)) return null;
  void property;
  // "Type mismatch between initial and final value": Godot's error, and no tweener.
  if (variantType(access.get(object as never)) !== variantType(final_val)) return null;
  const tweener = godot_property_tweener_create(object, access, final_val, duration);
  append(self, state, tweener);
  godot_property_tweener_set_tween(tweener, state.default_transition, state.default_ease);
  return tweener;
}

/**
 * A `CallbackTweener` that calls `callback` when its step starts.
 *
 * @godot Tween.tween_callback
 * @source scene/animation/tween.cpp:132
 */
export function tween_callback(self: Tween, callback: (...args: never[]) => unknown): CallbackTweener | null {
  const state = stateOf(self);
  if (!checkValid(state)) return null;
  const tweener = godot_callback_tweener_create(callback);
  append(self, state, tweener);
  return tweener;
}

// --- Control.

/**
 * `_stop_internal(true)`: not running, and reset to start over.
 *
 * @godot Tween.stop
 * @source scene/animation/tween.cpp:196
 */
export function stop(self: Tween): void {
  const state = stateOf(self);
  state.running = false;
  state.started = false;
  state.dead = false;
  state.total_time = 0;
}

/**
 * `_stop_internal(false)`: not running.
 *
 * @godot Tween.pause
 * @source scene/animation/tween.cpp:200
 */
export function pause(self: Tween): void {
  stateOf(self).running = false;
}

/**
 * Running again, unless invalid or finished (Godot's errors, nothing changes).
 *
 * @godot Tween.play
 * @source scene/animation/tween.cpp:204
 */
export function play(self: Tween): void {
  const state = stateOf(self);
  if (!state.valid || state.dead) return;
  state.running = true;
}

/**
 * Not running, invalid and dead; the tree drops it at its next pass.
 *
 * @godot Tween.kill
 * @source scene/animation/tween.cpp:210
 */
export function kill(self: Tween): void {
  const state = stateOf(self);
  state.running = false;
  state.valid = false;
  state.dead = true;
}

/**
 * @godot Tween.has_tweeners
 * @source scene/animation/tween.cpp:221
 */
export function has_tweeners(self: Tween): boolean {
  return stateOf(self).tweeners.length > 0;
}

/**
 * @godot Tween.is_running
 * @source scene/animation/tween.cpp:225
 */
export function is_running(self: Tween): boolean {
  return stateOf(self).running;
}

/**
 * @godot Tween.is_valid
 * @source scene/animation/tween.cpp:229
 */
export function is_valid(self: Tween): boolean {
  return stateOf(self).valid;
}

/**
 * `Tween::clear`: invalid, with no tweeners (the tree calls it when it drops the tween).
 *
 * @godot Tween (protocol)
 * @source scene/animation/tween.cpp:233
 */
export function godot_tween_clear(self: Tween): void {
  const state = stateOf(self);
  state.valid = false;
  state.tweeners.length = 0;
}

/**
 * Binds the tween to a node: it runs only while the node is inside the tree and dies with it.
 *
 * @godot Tween.bind_node
 * @source scene/animation/tween.cpp:238
 */
export function bind_node(self: Tween, node: object): Tween {
  const state = stateOf(self);
  state.bound_node = node;
  state.is_bound = true;
  return self;
}

/**
 * @godot Tween.set_process_mode
 * @source scene/animation/tween.cpp:246
 */
export function set_process_mode(self: Tween, mode: number): Tween {
  stateOf(self).process_mode = mode;
  return self;
}

/**
 * @godot Tween.set_pause_mode
 * @source scene/animation/tween.cpp:255
 */
export function set_pause_mode(self: Tween, mode: number): Tween {
  stateOf(self).pause_mode = mode;
  return self;
}

/**
 * Whether later tweeners join the current step by default (and the next one does); the Variant
 * default is `true`.
 *
 * @godot Tween.set_parallel
 * @source scene/animation/tween.cpp:273
 */
export function set_parallel(self: Tween, parallel = true): Tween {
  const state = stateOf(self);
  state.default_parallel = parallel;
  state.parallel_enabled = parallel;
  return self;
}

/**
 * The number of times the steps run (0 or less: forever); the Variant default is 0.
 *
 * @godot Tween.set_loops
 * @source scene/animation/tween.cpp:279
 */
export function set_loops(self: Tween, loops = 0): Tween {
  stateOf(self).loops = Math.trunc(loops) | 0;
  return self;
}

/**
 * -1 when looping forever, otherwise the loops not yet done.
 *
 * @godot Tween.get_loops_left
 * @source scene/animation/tween.cpp:284
 */
export function get_loops_left(self: Tween): number {
  const state = stateOf(self);
  return state.loops <= 0 ? -1 : state.loops - state.loops_done;
}

/**
 * Stored as `float`.
 *
 * @godot Tween.set_speed_scale
 * @source scene/animation/tween.cpp:292
 */
export function set_speed_scale(self: Tween, speed: number): Tween {
  stateOf(self).speed_scale = f32(speed);
  return self;
}

/**
 * The transition later property tweeners take unless they set their own.
 *
 * @godot Tween.set_trans
 * @source scene/animation/tween.cpp:297
 */
export function set_trans(self: Tween, trans: number): Tween {
  stateOf(self).default_transition = trans;
  return self;
}

/**
 * The ease later property tweeners take unless they set their own.
 *
 * @godot Tween.set_ease
 * @source scene/animation/tween.cpp:306
 */
export function set_ease(self: Tween, ease: number): Tween {
  stateOf(self).default_ease = ease;
  return self;
}

/**
 * The next tweener joins the current step.
 *
 * @godot Tween.parallel
 * @source scene/animation/tween.cpp:315
 */
export function parallel(self: Tween): Tween {
  stateOf(self).parallel_enabled = true;
  return self;
}

/**
 * The next tweener starts a new step.
 *
 * @godot Tween.chain
 * @source scene/animation/tween.cpp:320
 */
export function chain(self: Tween): Tween {
  stateOf(self).parallel_enabled = false;
  return self;
}

/**
 * The time the tween has run, scaled by its speed.
 *
 * @godot Tween.get_total_elapsed_time
 * @source scene/animation/tween.cpp:453
 */
export function get_total_elapsed_time(self: Tween): number {
  return stateOf(self).total_time;
}

// --- Signals.

/**
 * Emitted with the index of each step as it finishes.
 *
 * @godot Tween.step_finished
 * @source scene/animation/tween.cpp:520
 */
export function step_finished(self: Tween): GodotSignal<[number]> {
  return stateOf(self).step_finished.signal;
}

/**
 * Emitted with the count of loops done as each loop but the last finishes.
 *
 * @godot Tween.loop_finished
 * @source scene/animation/tween.cpp:521
 */
export function loop_finished(self: Tween): GodotSignal<[number]> {
  return stateOf(self).loop_finished.signal;
}

/**
 * Emitted once, when the last loop's last step finishes.
 *
 * @godot Tween.finished
 * @source scene/animation/tween.cpp:522
 */
export function finished(self: Tween): GodotSignal<[]> {
  return stateOf(self).finished.signal;
}

// --- Processing.

/** `Tween::get_bound_node`: the bound node, or none once it is freed (`ObjectDB::get_instance`). */
function boundNode(state: TweenState): object | undefined {
  if (!state.is_bound || state.bound_node === undefined) return undefined;
  return godot_node_is_freed(state.bound_node) ? undefined : state.bound_node;
}

/** `Math::is_equal_approx(double, double)` (`core/math/math_funcs.h:528`). */
function isEqualApprox(a: number, b: number): boolean {
  if (a === b) return true;
  let tolerance = 0.00001 * Math.abs(a);
  if (tolerance < 0.00001) tolerance = 0.00001;
  return Math.abs(a - b) < tolerance;
}

/** `Tween::_start_tweeners` (`tween.cpp:80`). */
function startTweeners(state: TweenState): void {
  if (state.tweeners.length === 0) {
    state.dead = true;
    // "Tween without commands, aborting."
    return;
  }
  for (const tweener of state.tweeners[state.current_step] as object[]) godot_tweener_start(tweener);
}

/**
 * `Tween::step` (`tween.cpp:335`): false when the tree should drop the tween (dead, its bound node
 * freed, or started with no tweeners). A bound node outside the tree holds it; otherwise the scaled
 * delta runs the current step's tweeners, and each step they finish in the same delta passes what
 * they leave to the next, emitting `step_finished`, `loop_finished` and `finished`.
 *
 * @godot Tween (protocol)
 * @source scene/animation/tween.cpp:335
 */
export function godot_tween_step(self: Tween, p_delta: number): boolean {
  const state = stateOf(self);
  if (state.dead) return false;
  if (state.is_bound) {
    const node = boundNode(state);
    if (node === undefined) return false;
    if (!is_inside_tree(node)) return true;
  }
  if (!state.running) return true;
  state.in_step = true;
  if (!state.started) {
    if (state.tweeners.length === 0) {
      state.in_step = false;
      // "Tween (bound to …): started with no Tweeners."
      return false;
    }
    state.current_step = 0;
    state.loops_done = 0;
    state.total_time = 0;
    startTweeners(state);
    state.started = true;
  }
  let rem_delta = p_delta * state.speed_scale;
  let step_active = false;
  state.total_time += rem_delta;
  const initial_delta = rem_delta;
  let potential_infinite = false;
  while (state.running && rem_delta > 0) {
    let step_delta = rem_delta;
    step_active = false;
    for (const tweener of state.tweeners[state.current_step] as object[]) {
      const [active, temp_delta] = godot_tweener_step(tweener, rem_delta);
      step_active = active || step_active;
      step_delta = Math.min(temp_delta, step_delta);
    }
    rem_delta = step_delta;
    if (!step_active) {
      state.step_finished.emit(state.current_step);
      state.current_step += 1;
      if (state.current_step === state.tweeners.length) {
        state.loops_done += 1;
        if (state.loops_done === state.loops) {
          state.running = false;
          state.dead = true;
          state.finished.emit();
          break;
        }
        state.loop_finished.emit(state.loops_done);
        state.current_step = 0;
        startTweeners(state);
        if (state.loops <= 0 && isEqualApprox(rem_delta, initial_delta)) {
          if (!potential_infinite) potential_infinite = true;
          else {
            // "Infinite loop detected. Check set_loops() description for more info."
            state.in_step = false;
            return false;
          }
        }
      } else {
        startTweeners(state);
      }
    }
  }
  state.in_step = false;
  return true;
}

/**
 * `Tween::can_process` (`tween.cpp:434`): a tween bound to a live node with pause mode BOUND runs
 * when the node is inside the tree and can process; otherwise when the tree is not paused (compat's
 * tree never pauses) or the mode is PROCESS.
 *
 * @godot Tween (protocol)
 * @source scene/animation/tween.cpp:434
 */
export function godot_tween_can_process(self: Tween, tree_paused: boolean): boolean {
  const state = stateOf(self);
  if (state.is_bound && state.pause_mode === TWEEN_PAUSE_BOUND) {
    const node = boundNode(state);
    if (node !== undefined) return is_inside_tree(node) && nodeCanProcess(node);
  }
  return !tree_paused || state.pause_mode === TWEEN_PAUSE_PROCESS;
}

/**
 * Whether the tween runs in the physics pass (`TWEEN_PROCESS_PHYSICS`) rather than the process pass.
 *
 * @godot Tween (protocol)
 * @source scene/animation/tween.cpp:251
 */
export function godot_tween_in_physics(self: Tween): boolean {
  return stateOf(self).process_mode !== TWEEN_PROCESS_IDLE;
}

// --- The easing equations (`scene/animation/easing_equations.h`), in `real_t`.

/** `Math::pow(float, float)` is `powf`. */
const powf = (x: number, y: number): number => f32(Math.pow(x, y));
/** `Math::sqrt(float)` is `sqrtf` (correctly rounded). */
const sqrtf = (x: number): number => f32(Math.sqrt(x));
/** `Math::PI` is a double. */
const PI = Math.PI;

type Equation = (t: number, b: number, c: number, d: number) => number;

/** The `out_in` every family but Bounce and Spring shares: `out` over the first half, `in` over the second. */
function outIn(inFn: Equation, outFn: Equation): Equation {
  return (t, b, c, d) => {
    if (t < f32(d / 2)) return outFn(f32(t * 2), b, f32(c / 2), d);
    const h = f32(c / 2);
    return inFn(f32(f32(t * 2) - d), f32(b + h), h, d);
  };
}

/** Bounce's and Spring's `in_out`: `in` over the first half, `out` over the second. */
function inOut(inFn: Equation, outFn: Equation): Equation {
  return (t, b, c, d) => {
    if (t < f32(d / 2)) return inFn(f32(t * 2), b, f32(c / 2), d);
    const h = f32(c / 2);
    return outFn(f32(f32(t * 2) - d), f32(b + h), h, d);
  };
}

const linearIn: Equation = (t, b, c, d) => f32(f32(f32(c * t) / d) + b);

const sineIn: Equation = (t, b, c, d) => f32(-c * Math.cos(f32(t / d) * (PI / 2)) + c + b);
const sineOut: Equation = (t, b, c, d) => f32(c * Math.sin(f32(t / d) * (PI / 2)) + b);
const sineInOut: Equation = (t, b, c, d) => f32(f32(-c / 2) * (Math.cos((PI * t) / d) - 1) + b);

const quintIn: Equation = (t, b, c, d) => f32(f32(c * powf(f32(t / d), 5)) + b);
const quintOut: Equation = (t, b, c, d) => f32(f32(c * f32(powf(f32(f32(t / d) - 1), 5) + 1)) + b);
const quintInOut: Equation = (t, b, c, d) => {
  t = f32(f32(t / d) * 2);
  if (t < 1) return f32(f32(f32(c / 2) * powf(t, 5)) + b);
  return f32(f32(f32(c / 2) * f32(powf(f32(t - 2), 5) + 2)) + b);
};

const quartIn: Equation = (t, b, c, d) => f32(f32(c * powf(f32(t / d), 4)) + b);
const quartOut: Equation = (t, b, c, d) => f32(f32(-c * f32(powf(f32(f32(t / d) - 1), 4) - 1)) + b);
const quartInOut: Equation = (t, b, c, d) => {
  t = f32(f32(t / d) * 2);
  if (t < 1) return f32(f32(f32(c / 2) * powf(t, 4)) + b);
  return f32(f32(f32(-c / 2) * f32(powf(f32(t - 2), 4) - 2)) + b);
};

const quadIn: Equation = (t, b, c, d) => f32(f32(c * powf(f32(t / d), 2)) + b);
const quadOut: Equation = (t, b, c, d) => {
  t = f32(t / d);
  return f32(f32(f32(-c * t) * f32(t - 2)) + b);
};
const quadInOut: Equation = (t, b, c, d) => {
  t = f32(f32(t / d) * 2);
  if (t < 1) return f32(f32(f32(c / 2) * powf(t, 2)) + b);
  return f32(f32(f32(-c / 2) * f32(f32(f32(t - 1) * f32(t - 3)) - 1)) + b);
};

const expoIn: Equation = (t, b, c, d) => {
  if (t === 0) return b;
  return f32(f32(f32(c * powf(2, f32(10 * f32(f32(t / d) - 1)))) + b) - c * 0.001);
};
const expoOut: Equation = (t, b, c, d) => {
  if (t === d) return f32(b + c);
  return f32(c * 1.001 * f32(-powf(2, f32(f32(-10 * t) / d)) + 1) + b);
};
const expoInOut: Equation = (t, b, c, d) => {
  if (t === 0) return b;
  if (t === d) return f32(b + c);
  t = f32(f32(t / d) * 2);
  if (t < 1) return f32(f32(f32(f32(c / 2) * powf(2, f32(10 * f32(t - 1)))) + b) - c * 0.0005);
  return f32(f32(c / 2) * 1.0005 * f32(-powf(2, f32(-10 * f32(t - 1))) + 2) + b);
};

const elasticIn: Equation = (t, b, c, d) => {
  if (t === 0) return b;
  t = f32(t / d);
  if (t === 1) return f32(b + c);
  t = f32(t - 1);
  const p = f32(d * f32(0.3));
  const a = f32(c * powf(2, f32(10 * t)));
  const s = f32(p / 4);
  return f32(-(a * Math.sin((f32(f32(t * d) - s) * (2 * PI)) / p)) + b);
};
const elasticOut: Equation = (t, b, c, d) => {
  if (t === 0) return b;
  t = f32(t / d);
  if (t === 1) return f32(b + c);
  const p = f32(d * f32(0.3));
  const s = f32(p / 4);
  return f32(f32(c * powf(2, f32(-10 * t))) * Math.sin((f32(f32(t * d) - s) * (2 * PI)) / p) + c + b);
};
const elasticInOut: Equation = (t, b, c, d) => {
  if (t === 0) return b;
  t = f32(t / f32(d / 2));
  if (t === 2) return f32(b + c);
  const p = f32(d * f32(f32(0.3) * 1.5));
  let a = c;
  const s = f32(p / 4);
  if (t < 1) {
    t = f32(t - 1);
    a = f32(a * powf(2, f32(10 * t)));
    return f32(-0.5 * (a * Math.sin((f32(f32(t * d) - s) * (2 * PI)) / p)) + b);
  }
  t = f32(t - 1);
  a = f32(a * powf(2, f32(-10 * t)));
  return f32(a * Math.sin((f32(f32(t * d) - s) * (2 * PI)) / p) * 0.5 + c + b);
};

const cubicIn: Equation = (t, b, c, d) => {
  t = f32(t / d);
  return f32(f32(f32(f32(c * t) * t) * t) + b);
};
const cubicOut: Equation = (t, b, c, d) => {
  t = f32(f32(t / d) - 1);
  return f32(f32(c * f32(f32(f32(t * t) * t) + 1)) + b);
};
const cubicInOut: Equation = (t, b, c, d) => {
  t = f32(t / f32(d / 2));
  if (t < 1) return f32(f32(f32(f32(f32(c / 2) * t) * t) * t) + b);
  t = f32(t - 2);
  return f32(f32(f32(c / 2) * f32(f32(f32(t * t) * t) + 2)) + b);
};

const circIn: Equation = (t, b, c, d) => {
  t = f32(t / d);
  return f32(f32(-c * f32(sqrtf(f32(1 - f32(t * t))) - 1)) + b);
};
const circOut: Equation = (t, b, c, d) => {
  t = f32(f32(t / d) - 1);
  return f32(f32(c * sqrtf(f32(1 - f32(t * t)))) + b);
};
const circInOut: Equation = (t, b, c, d) => {
  t = f32(t / f32(d / 2));
  if (t < 1) return f32(f32(f32(-c / 2) * f32(sqrtf(f32(1 - f32(t * t))) - 1)) + b);
  t = f32(t - 2);
  return f32(f32(f32(c / 2) * f32(sqrtf(f32(1 - f32(t * t))) + 1)) + b);
};

const bounceOut: Equation = (t, b, c, d) => {
  t = f32(t / d);
  if (t < f32(1 / 2.75)) return f32(f32(c * f32(f32(7.5625 * t) * t)) + b);
  if (t < f32(2 / 2.75)) {
    t = f32(t - f32(1.5 / 2.75));
    return f32(f32(c * f32(f32(f32(7.5625 * t) * t) + 0.75)) + b);
  }
  if (t < 2.5 / 2.75) {
    t = f32(t - f32(2.25 / 2.75));
    return f32(f32(c * f32(f32(f32(7.5625 * t) * t) + 0.9375)) + b);
  }
  t = f32(t - f32(2.625 / 2.75));
  return f32(f32(c * f32(f32(f32(7.5625 * t) * t) + 0.984375)) + b);
};
const bounceIn: Equation = (t, b, c, d) => f32(f32(c - bounceOut(f32(d - t), 0, c, d)) + b);

const BACK_S = f32(1.70158);
const BACK_S_IN_OUT = f32(f32(1.70158) * f32(1.525));
const backIn: Equation = (t, b, c, d) => {
  t = f32(t / d);
  return f32(f32(f32(f32(c * t) * t) * f32(f32(f32(BACK_S + 1) * t) - BACK_S)) + b);
};
const backOut: Equation = (t, b, c, d) => {
  t = f32(f32(t / d) - 1);
  return f32(f32(c * f32(f32(f32(t * t) * f32(f32(f32(BACK_S + 1) * t) + BACK_S)) + 1)) + b);
};
const backInOut: Equation = (t, b, c, d) => {
  const s = BACK_S_IN_OUT;
  t = f32(t / f32(d / 2));
  if (t < 1) return f32(f32(f32(c / 2) * f32(f32(t * t) * f32(f32(f32(s + 1) * t) - s))) + b);
  t = f32(t - 2);
  return f32(f32(f32(c / 2) * f32(f32(f32(t * t) * f32(f32(f32(s + 1) * t) + s)) + 2)) + b);
};

const springOut: Equation = (t, b, c, d) => {
  t = f32(t / d);
  const s = f32(1.0 - t);
  t = f32((Math.sin(t * PI * (0.2 + 2.5 * t * t * t)) * powf(s, f32(2.2)) + t) * (1.0 + 1.2 * s));
  return f32(f32(c * t) + b);
};
const springIn: Equation = (t, b, c, d) => f32(f32(c - springOut(f32(d - t), 0, c, d)) + b);

/** `Tween::interpolaters[TRANS_MAX][EASE_MAX]` (`tween.cpp:43`), by transition then ease. */
const INTERPOLATERS: readonly (readonly Equation[])[] = [
  [linearIn, linearIn, linearIn, linearIn],
  [sineIn, sineOut, sineInOut, outIn(sineIn, sineOut)],
  [quintIn, quintOut, quintInOut, outIn(quintIn, quintOut)],
  [quartIn, quartOut, quartInOut, outIn(quartIn, quartOut)],
  [quadIn, quadOut, quadInOut, outIn(quadIn, quadOut)],
  [expoIn, expoOut, expoInOut, outIn(expoIn, expoOut)],
  [elasticIn, elasticOut, elasticInOut, outIn(elasticIn, elasticOut)],
  [cubicIn, cubicOut, cubicInOut, outIn(cubicIn, cubicOut)],
  [circIn, circOut, circInOut, outIn(circIn, circOut)],
  [bounceIn, bounceOut, inOut(bounceIn, bounceOut), outIn(bounceIn, bounceOut)],
  [backIn, backOut, backInOut, outIn(backIn, backOut)],
  [springIn, springOut, inOut(springIn, springOut), outIn(springIn, springOut)],
];

/**
 * `Tween::run_equation`: the transition's equation for the ease, in `real_t`; a zero duration is
 * the end value.
 *
 * @godot Tween (protocol)
 * @source scene/animation/tween.cpp:457
 */
export function godot_tween_run_equation(trans: number, ease: number, time: number, initial: number, delta: number, duration: number): number {
  const t = f32(time);
  const b = f32(initial);
  const c = f32(delta);
  const d = f32(duration);
  if (d === 0) return f32(b + c);
  const equation = INTERPOLATERS[trans]?.[ease];
  if (equation === undefined) throw new RangeError('godot-compat: a Tween transition or ease out of range.');
  return equation(t, b, c, d);
}

// --- `Animation`'s Variant arithmetic for the tweened types (`scene/resources/animation.cpp`).

/** `Variant::Type` of a tweened value (`core/variant/variant.h:96`). */
const FLOAT = 3;
const VECTOR2 = 5;
const VECTOR3 = 9;
const COLOR = 20;

function variantType(value: unknown): number {
  if (typeof value === 'number') return FLOAT;
  if (value !== null && typeof value === 'object') {
    if ('r' in value && 'g' in value && 'b' in value && 'a' in value) return COLOR;
    if ('x' in value && 'y' in value && !('w' in value)) return 'z' in value ? VECTOR3 : VECTOR2;
  }
  throw new TypeError('godot-compat: a tweened value of this Variant type is not transcribed.');
}

/**
 * `Animation::add_variant` (`animation.cpp:5847`): a float in double; a Vector2, Vector3 or Color by
 * `Variant::evaluate(OP_ADD)`, component by component in float.
 *
 * @godot Tween (protocol)
 * @source scene/resources/animation.cpp:5847
 */
export function godot_tween_add_variant(a: unknown, b: unknown): unknown {
  return componentwise(a, b, (x, y) => x + y);
}

/**
 * `Animation::subtract_variant` (`animation.cpp:5961`), as `add_variant` with `-`.
 *
 * @godot Tween (protocol)
 * @source scene/resources/animation.cpp:5961
 */
export function godot_tween_subtract_variant(a: unknown, b: unknown): unknown {
  return componentwise(a, b, (x, y) => x - y);
}

function componentwise(a: unknown, b: unknown, op: (x: number, y: number) => number): unknown {
  const type = variantType(a);
  if (type !== variantType(b)) return a;
  switch (type) {
    case FLOAT:
      return op(a as number, b as number);
    case VECTOR2: {
      const u = a as Vector2;
      const v = b as Vector2;
      return vector2(f32(op(u.x, v.x)), f32(op(u.y, v.y)));
    }
    case VECTOR3: {
      const u = a as Vector3;
      const v = b as Vector3;
      return vector3(f32(op(u.x, v.x)), f32(op(u.y, v.y)), f32(op(u.z, v.z)));
    }
    default: {
      const u = a as Color;
      const v = b as Color;
      return color(f32(op(u.r, v.r)), f32(op(u.g, v.g)), f32(op(u.b, v.b)), f32(op(u.a, v.a)));
    }
  }
}

/** `Math::lerp(float, float, float)` (`core/math/math_funcs.h:338`). */
function lerpf(from: number, to: number, weight: number): number {
  return f32(from + f32(f32(to - from) * weight));
}

/**
 * `Animation::interpolate_variant` (`animation.cpp:6212`) with a `float` weight: a float by
 * `Math::lerp` in double, a Vector2, Vector3 or Color by its `lerp` in float.
 *
 * @godot Tween (protocol)
 * @source scene/resources/animation.cpp:6212
 */
export function godot_tween_lerp_variant(a: unknown, b: unknown, c: number): unknown {
  const weight = f32(c);
  const type = variantType(a);
  if (type !== variantType(b)) return a;
  switch (type) {
    case FLOAT:
      return (a as number) + ((b as number) - (a as number)) * weight;
    case VECTOR2: {
      const u = a as Vector2;
      const v = b as Vector2;
      return vector2(lerpf(u.x, v.x, weight), lerpf(u.y, v.y, weight));
    }
    case VECTOR3: {
      const u = a as Vector3;
      const v = b as Vector3;
      return vector3(lerpf(u.x, v.x, weight), lerpf(u.y, v.y, weight), lerpf(u.z, v.z, weight));
    }
    default: {
      const u = a as Color;
      const v = b as Color;
      return color(lerpf(u.r, v.r, weight), lerpf(u.g, v.g, weight), lerpf(u.b, v.b, weight), lerpf(u.a, v.a, weight));
    }
  }
}

/**
 * `Tween::interpolate_variant` (`tween.cpp:467`): `initial + delta` blended from `initial` by the
 * eased weight of `time` over `duration`.
 *
 * @godot Tween (protocol)
 * @source scene/animation/tween.cpp:467
 */
export function godot_tween_interpolate_variant(initial: unknown, delta: unknown, time: number, duration: number, trans: number, ease: number): unknown {
  if (trans < 0 || trans >= TRANS_MAX || ease < 0 || ease >= EASE_MAX) return null;
  const end = godot_tween_add_variant(initial, delta);
  return godot_tween_lerp_variant(initial, end, godot_tween_run_equation(trans, ease, time, 0.0, 1.0, duration));
}

/**
 * The value a property tweener with this transition and ease sets at `elapsed_time`: `initial_value
 * + delta_value` blended from `initial_value` by the eased weight (a transition or ease out of range
 * gives null, with Godot's error).
 *
 * @godot Tween.interpolate_value
 * @source scene/animation/tween.cpp:467
 */
export function interpolate_value(initial_value: unknown, delta_value: unknown, elapsed_time: number, duration: number, trans_type: number, ease_type: number): unknown {
  return godot_tween_interpolate_variant(initial_value, delta_value, elapsed_time, duration, trans_type, ease_type);
}
