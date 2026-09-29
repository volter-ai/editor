/**
 * @godot-class PropertyTweener
 * @role PROTOCOL
 *
 * Godot 4.7's `PropertyTweener`, transcribed from `scene/animation/tween.cpp` at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`: a property of one object eased from its value when
 * the tweener's step starts to a final value. `Tween.tween_property` makes it (`tween.ts`); its
 * target, values, transition, ease and delay live in `PROPERTY_TWEENER`, keyed by the record, and
 * the base `Tweener` state in `tweener.ts`.
 *
 * The target is read and written through the accessors the translation resolved for the property
 * (the class's getter and setter bindings), which `Object::get_indexed`/`set_indexed` reach in
 * Godot. A target that has been freed finishes the tweener (`ObjectDB::get_instance` is null).
 * A custom interpolator maps the eased weight to the one the value is blended by.
 */

import { godot_node_is_freed } from './node';
import { godot_tween_add_variant, godot_tween_interpolate_variant, godot_tween_lerp_variant, godot_tween_subtract_variant, type GodotTweenProperty } from './tween';
import { godot_tweener_elapsed, godot_tweener_finish, godot_tweener_init, godot_tweener_is_finished, godot_tweener_set_elapsed } from './tweener';

/** An opaque PropertyTweener (`Ref<PropertyTweener>`). */
export interface PropertyTweener {
  readonly __godotPropertyTweener: true;
}

/** `Tween::TRANS_MAX` / `EASE_MAX`: unset until the tweener joins its tween (`tween.h:239`). */
const TRANS_MAX = 12;
const EASE_MAX = 4;

interface PropertyTweenerState {
  readonly target: object;
  readonly access: GodotTweenProperty;
  initial_val: unknown;
  readonly base_final_val: unknown;
  final_val: unknown;
  delta_val: unknown;
  readonly duration: number;
  trans_type: number;
  ease_type: number;
  delay: number;
  do_continue: boolean;
  do_continue_delayed: boolean;
  relative: boolean;
  custom_method: ((weight: number) => unknown) | null;
}

const PROPERTY_TWEENER = new WeakMap<PropertyTweener, PropertyTweenerState>();

function stateOf(tweener: PropertyTweener): PropertyTweenerState {
  const state = PROPERTY_TWEENER.get(tweener);
  if (state === undefined) throw new TypeError('godot-compat: not a PropertyTweener.');
  return state;
}

/** `ObjectDB::get_instance(target)`: the target, or none once freed. */
function instance(state: PropertyTweenerState): object | undefined {
  return godot_node_is_freed(state.target) ? undefined : state.target;
}

/** `Math::is_zero_approx(double)` (`core/math/math_funcs.h:553`). */
function isZeroApprox(value: number): boolean {
  return Math.abs(value) < 0.00001;
}

/**
 * `PropertyTweener(target, property, to, duration)` (`tween.cpp:708`): the initial value read now,
 * the final value `to`; its `start` and `step` are the tweener's virtuals.
 *
 * @godot PropertyTweener (protocol)
 * @source scene/animation/tween.cpp:708
 */
export function godot_property_tweener_create(target: object, access: GodotTweenProperty, to: unknown, duration: number): PropertyTweener {
  const tweener = Object.freeze({ __godotPropertyTweener: true as const });
  const state: PropertyTweenerState = {
    target,
    access,
    initial_val: access.get(target as never),
    base_final_val: to,
    final_val: to,
    delta_val: undefined,
    duration,
    trans_type: TRANS_MAX,
    ease_type: EASE_MAX,
    delay: 0,
    do_continue: true,
    do_continue_delayed: false,
    relative: false,
    custom_method: null,
  };
  PROPERTY_TWEENER.set(tweener, state);
  godot_tweener_init(tweener, { start: () => start(state), step: (r_delta) => step(tweener, state, r_delta) });
  return tweener;
}

/**
 * `PropertyTweener::set_tween`: an unset transition or ease takes the tween's default.
 *
 * @godot PropertyTweener (protocol)
 * @source scene/animation/tween.cpp:688
 */
export function godot_property_tweener_set_tween(tweener: PropertyTweener, trans: number, ease: number): void {
  const state = stateOf(tweener);
  if (state.trans_type === TRANS_MAX) state.trans_type = trans;
  if (state.ease_type === EASE_MAX) state.ease_type = ease;
}

/** `PropertyTweener::start` (`tween.cpp:617`), after `Tweener::start`. */
function start(state: PropertyTweenerState): void {
  const target = instance(state);
  if (target === undefined) return;
  if (state.do_continue) {
    if (isZeroApprox(state.delay)) state.initial_val = state.access.get(target as never);
    else state.do_continue_delayed = true;
  }
  if (state.relative) state.final_val = godot_tween_add_variant(state.initial_val, state.base_final_val);
  state.delta_val = godot_tween_subtract_variant(state.final_val, state.initial_val);
}

/** `PropertyTweener::step` (`tween.cpp:640`). */
function step(tweener: PropertyTweener, state: PropertyTweenerState, r_delta: number): readonly [boolean, number] {
  if (godot_tweener_is_finished(tweener)) return [false, r_delta];
  const target = instance(state);
  if (target === undefined) {
    godot_tweener_finish(tweener);
    return [false, r_delta];
  }
  const elapsed_time = godot_tweener_elapsed(tweener) + r_delta;
  godot_tweener_set_elapsed(tweener, elapsed_time);
  if (elapsed_time < state.delay) return [true, 0];
  if (state.do_continue_delayed && !isZeroApprox(state.delay)) {
    state.initial_val = state.access.get(target as never);
    state.delta_val = godot_tween_subtract_variant(state.final_val, state.initial_val);
    state.do_continue_delayed = false;
  }
  const time = Math.min(elapsed_time - state.delay, state.duration);
  const custom = state.custom_method;
  if (custom !== null) {
    // `_get_custom_interpolated_value` (`tween.cpp:559`): the method's float, or the step fails.
    const weigh = (weight: number): number | undefined => {
      const result = custom(weight);
      return typeof result === 'number' ? result : undefined;
    };
    const eased = time < state.duration ? (godot_tween_interpolate_variant(0.0, 1.0, time, state.duration, state.trans_type, state.ease_type) as number) : 1.0;
    const weight = weigh(eased);
    if (weight === undefined) return [false, r_delta];
    state.access.set(target as never, godot_tween_lerp_variant(state.initial_val, state.final_val, weight) as never);
    if (time < state.duration) return [true, 0];
    const rest = elapsed_time - state.delay - state.duration;
    godot_tweener_finish(tweener);
    return [false, rest];
  }
  if (time < state.duration) {
    state.access.set(
      target as never,
      godot_tween_interpolate_variant(state.initial_val, state.delta_val, time, state.duration, state.trans_type, state.ease_type) as never,
    );
    return [true, 0];
  }
  state.access.set(target as never, state.final_val as never);
  const left = elapsed_time - state.delay - state.duration;
  godot_tweener_finish(tweener);
  return [false, left];
}

/**
 * Starts from `value` instead of the property's value when the step starts.
 *
 * @godot PropertyTweener.from
 * @source scene/animation/tween.cpp:573
 */
export function from(self: PropertyTweener, value: unknown): PropertyTweener {
  const state = stateOf(self);
  state.initial_val = value;
  state.do_continue = false;
  return self;
}

/**
 * Starts from the property's value now (read when the tweener was made) rather than when its step
 * starts.
 *
 * @godot PropertyTweener.from_current
 * @source scene/animation/tween.cpp:587
 */
export function from_current(self: PropertyTweener): PropertyTweener {
  stateOf(self).do_continue = false;
  return self;
}

/**
 * The final value is added to the start value.
 *
 * @godot PropertyTweener.as_relative
 * @source scene/animation/tween.cpp:592
 */
export function as_relative(self: PropertyTweener): PropertyTweener {
  stateOf(self).relative = true;
  return self;
}

/**
 * @godot PropertyTweener.set_trans
 * @source scene/animation/tween.cpp:597
 */
export function set_trans(self: PropertyTweener, trans: number): PropertyTweener {
  stateOf(self).trans_type = trans;
  return self;
}

/**
 * @godot PropertyTweener.set_ease
 * @source scene/animation/tween.cpp:602
 */
export function set_ease(self: PropertyTweener, ease: number): PropertyTweener {
  stateOf(self).ease_type = ease;
  return self;
}

/**
 * A method mapping the eased weight (0 to 1) to the weight the value is blended by from its start
 * to its final value; it must return a float.
 *
 * @godot PropertyTweener.set_custom_interpolator
 * @source scene/animation/tween.cpp:607
 */
export function set_custom_interpolator(self: PropertyTweener, interpolator_method: (weight: number) => unknown): PropertyTweener {
  stateOf(self).custom_method = interpolator_method;
  return self;
}

/**
 * Seconds the tweener waits after its step starts.
 *
 * @godot PropertyTweener.set_delay
 * @source scene/animation/tween.cpp:612
 */
export function set_delay(self: PropertyTweener, delay: number): PropertyTweener {
  stateOf(self).delay = delay;
  return self;
}
