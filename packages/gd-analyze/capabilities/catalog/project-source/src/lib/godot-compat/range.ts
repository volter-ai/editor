/**
 * @godot-class Range
 * @role PROTOCOL
 *
 * Godot 4.7's `Range` (`scene/gui/range.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * a value between `min_value` and `max_value` (less the page), snapped to the step from the
 * minimum, rounded when `rounded`, with `value_changed` when it changes and `changed` when its
 * bounds do. Shared ranges (`share`) are not bound; the step snap is in double where Godot's widens.
 */

import type { Object3D } from 'three';
import { godot_node_entity } from './node';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

interface RangeState {
  min: number;
  max: number;
  step: number;
  page: number;
  value: number;
  rounded: boolean;
  allowGreater: boolean;
  allowLesser: boolean;
  expRatio: boolean;
  /** Redraws the class's look after its value changes. */
  readonly redraw: () => void;
  readonly valueChanged: SignalHandle<[number]>;
  readonly changed: SignalHandle<[]>;
}

const RANGES = new WeakMap<object, RangeState>();

function stateOf(self: object, member: string): RangeState {
  const state = RANGES.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Range`);
  return state;
}

/**
 * Makes `entity` (a Control already mounted) a Range of 0 to 100 by 1 (`Range::Range`).
 *
 * @godot Range (protocol)
 * @source scene/gui/range.cpp:461
 */
export function godot_range_mount(entity: Object3D, redraw: () => void = () => undefined): void {
  RANGES.set(entity, {
    min: 0,
    max: 100,
    step: 1,
    page: 0,
    value: 0,
    rounded: false,
    allowGreater: false,
    allowLesser: false,
    expRatio: false,
    redraw,
    valueChanged: createSignal<[number]>(),
    changed: createSignal<[]>(),
  });
}

/** `_calc_value` (`range.cpp:180`). */
function calc(state: RangeState, value: number): number {
  let v = value;
  if (state.step > 0) v = Math.round((v - state.min) / state.step) * state.step + state.min;
  if (state.rounded) v = Math.round(v);
  if (!state.allowGreater && v > state.max - state.page) v = state.max - state.page;
  if (!state.allowLesser && v < state.min) v = state.min;
  return v;
}

/**
 * @godot Range.set_value
 * @source scene/gui/range.cpp:166
 */
export function set_value(self: object, value: number): void {
  const state = stateOf(self, 'set_value');
  const previous = state.value;
  state.value = calc(state, value);
  if (state.value !== previous) {
    state.redraw();
    state.valueChanged.emit(state.value);
  }
}

/**
 * @godot Range.set_value_no_signal
 * @source scene/gui/range.cpp:200
 */
export function set_value_no_signal(self: object, value: number): void {
  const state = stateOf(self, 'set_value_no_signal');
  const previous = state.value;
  state.value = calc(state, value);
  if (state.value !== previous) state.redraw();
}

/**
 * @godot Range.get_value
 * @source scene/gui/range.cpp:266
 */
export function get_value(self: object): number {
  return stateOf(self, 'get_value').value;
}

/**
 * @godot Range.set_min
 * @source scene/gui/range.cpp:209
 */
export function set_min(self: object, minimum: number): void {
  const state = stateOf(self, 'set_min');
  if (state.min === minimum) return;
  state.min = minimum;
  state.max = Math.max(state.max, state.min);
  state.page = Math.min(Math.max(state.page, 0), state.max - state.min);
  set_value(self, state.value);
  state.changed.emit();
}

/**
 * @godot Range.get_min
 * @source scene/gui/range.cpp:270
 */
export function get_min(self: object): number {
  return stateOf(self, 'get_min').min;
}

/**
 * @godot Range.set_max
 * @source scene/gui/range.cpp:226
 */
export function set_max(self: object, maximum: number): void {
  const state = stateOf(self, 'set_max');
  const validated = Math.max(maximum, state.min);
  if (state.max === validated) return;
  state.max = validated;
  state.page = Math.min(Math.max(state.page, 0), state.max - state.min);
  set_value(self, state.value);
  state.changed.emit();
}

/**
 * @godot Range.get_max
 * @source scene/gui/range.cpp:274
 */
export function get_max(self: object): number {
  return stateOf(self, 'get_max').max;
}

/**
 * @godot Range.set_step
 * @source scene/gui/range.cpp:241
 */
export function set_step(self: object, step: number): void {
  const state = stateOf(self, 'set_step');
  if (state.step === step) return;
  state.step = step;
  state.changed.emit();
}

/**
 * @godot Range.get_step
 * @source scene/gui/range.cpp:278
 */
export function get_step(self: object): number {
  return stateOf(self, 'get_step').step;
}

/**
 * @godot Range.set_page
 * @source scene/gui/range.cpp:252
 */
export function set_page(self: object, pagesize: number): void {
  const state = stateOf(self, 'set_page');
  const validated = Math.min(Math.max(pagesize, 0), state.max - state.min);
  if (state.page === validated) return;
  state.page = validated;
  set_value(self, state.value);
  state.changed.emit();
}

/**
 * @godot Range.get_page
 * @source scene/gui/range.cpp:282
 */
export function get_page(self: object): number {
  return stateOf(self, 'get_page').page;
}

/**
 * @godot Range.set_as_ratio
 * @source scene/gui/range.cpp:286
 */
export function set_as_ratio(self: object, value: number): void {
  const state = stateOf(self, 'set_as_ratio');
  let v: number;
  if (state.expRatio && state.min >= 0) {
    const expMin = state.min === 0 ? 0 : Math.log2(state.min);
    const expMax = Math.log2(state.max);
    v = 2 ** (expMin + (expMax - expMin) * value);
  } else {
    const percent = (state.max - state.min) * value;
    v = state.step > 0 ? Math.round(percent / state.step) * state.step + state.min : percent + state.min;
  }
  set_value(self, Math.min(Math.max(v, state.min), state.max));
}

/**
 * @godot Range.get_as_ratio
 * @source scene/gui/range.cpp:306
 */
export function get_as_ratio(self: object): number {
  const state = stateOf(self, 'get_as_ratio');
  if (Math.abs(state.max - state.min) < 1e-5) return 1;
  const value = Math.min(Math.max(state.value, state.min), state.max);
  if (state.expRatio && state.min >= 0) {
    const expMin = state.min === 0 ? 0 : Math.log2(state.min);
    const expMax = Math.log2(state.max);
    return Math.min(Math.max((Math.log2(value) - expMin) / (expMax - expMin), 0), 1);
  }
  return Math.min(Math.max((value - state.min) / (state.max - state.min), 0), 1);
}

/**
 * @godot Range.set_use_rounded_values
 * @source scene/gui/range.cpp:423
 */
export function set_use_rounded_values(self: object, enabled: boolean): void {
  stateOf(self, 'set_use_rounded_values').rounded = enabled;
}

/**
 * @godot Range.set_allow_greater
 * @source scene/gui/range.cpp:445
 */
export function set_allow_greater(self: object, allow: boolean): void {
  stateOf(self, 'set_allow_greater').allowGreater = allow;
}

/**
 * @godot Range.set_allow_lesser
 * @source scene/gui/range.cpp:453
 */
export function set_allow_lesser(self: object, allow: boolean): void {
  stateOf(self, 'set_allow_lesser').allowLesser = allow;
}

/**
 * @godot Range.set_exp_ratio
 * @source scene/gui/range.cpp:431
 */
export function set_exp_ratio(self: object, enabled: boolean): void {
  stateOf(self, 'set_exp_ratio').expRatio = enabled;
}

/**
 * @godot Range.value_changed
 * @source scene/gui/range.cpp:400
 */
export function value_changed(self: object): GodotSignal<[number]> {
  return stateOf(self, 'value_changed').valueChanged.signal;
}

/**
 * @godot Range.changed
 * @source scene/gui/range.cpp:401
 */
export function changed(self: object): GodotSignal<[]> {
  return stateOf(self, 'changed').changed.signal;
}

/**
 * Range's properties as a scene element states them, bounds before the value.
 *
 * @godot Range (protocol)
 * @source scene/gui/range.cpp:403
 */
export function godot_range_props(): (readonly [string, (entity: Object3D, value: never) => void])[] {
  return [
    ['minValue', (entity, value: number) => set_min(entity, value)],
    ['maxValue', (entity, value: number) => set_max(entity, value)],
    ['step', (entity, value: number) => set_step(entity, value)],
    ['page', (entity, value: number) => set_page(entity, value)],
    ['rounded', (entity, value: boolean) => set_use_rounded_values(entity, value)],
    ['allowGreater', (entity, value: boolean) => set_allow_greater(entity, value)],
    ['allowLesser', (entity, value: boolean) => set_allow_lesser(entity, value)],
    ['expEdit', (entity, value: boolean) => set_exp_ratio(entity, value)],
    ['value', (entity, value: number) => set_value(entity, value)],
  ];
}
