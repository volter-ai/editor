/**
 * @godot-class Range
 * @role BINDING
 *
 * Godot 4.7's `Range` (`scene/gui/range.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`)
 * bound onto the element its scene renders (docs/GODOT.md "UI is React DOM"): a slider's
 * `<input type=range>`, whose value, bounds and step are its own and whose `input` event is
 * `value_changed`; a TextureProgressBar's box, whose value and bounds are its `data-*` and whose
 * progress texture is clipped to the value's share (`--godot-ratio`).
 */

import { godot_node_entity } from './node';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

function elementOf(self: object, member: string): HTMLElement {
  const entity = godot_node_entity(self) as unknown;
  if (typeof HTMLElement === 'undefined' || !(entity instanceof HTMLElement)) throw new Error(`godot-compat: Range.${member} on a node that is not a Control's element`);
  return entity;
}

const isInput = (element: HTMLElement): element is HTMLInputElement => element instanceof HTMLInputElement;

/** A bound: the slider's own attribute, else the bar's `data-*`. */
function bound(element: HTMLElement, name: 'min' | 'max' | 'step', fallback: number): number {
  const value = isInput(element) ? element.getAttribute(name) : element.dataset[name];
  return value === null || value === undefined || value === '' ? fallback : Number(value);
}

const VALUE_CHANGED = new WeakMap<HTMLElement, SignalHandle<[number]>>();

/**
 * @godot Range.value_changed
 * @source scene/gui/range.cpp:410
 */
export function value_changed(self: object): GodotSignal<[number]> {
  const element = elementOf(self, 'value_changed');
  let handle = VALUE_CHANGED.get(element);
  if (handle === undefined) {
    const made = createSignal<[number]>();
    handle = made;
    VALUE_CHANGED.set(element, made);
    if (isInput(element)) element.addEventListener('input', () => made.emit(Number(element.value)));
  }
  return handle.signal;
}

/**
 * @godot Range.get_value
 * @source scene/gui/range.cpp:276
 */
export function get_value(self: object): number {
  const element = elementOf(self, 'get_value');
  return isInput(element) ? Number(element.value) : Number(element.dataset['value'] ?? '0');
}

/**
 * The value clamped to the bounds and snapped to the step (`Range::set_value`), reported by
 * `value_changed` when it changes.
 *
 * @godot Range.set_value
 * @source scene/gui/range.cpp:172
 */
export function set_value(self: object, p_val: number): void {
  const element = elementOf(self, 'set_value');
  const min = bound(element, 'min', 0);
  const max = bound(element, 'max', 100);
  const step = bound(element, 'step', 1);
  let value = step > 0 ? Math.round((p_val - min) / step) * step + min : p_val;
  value = Math.min(max, Math.max(min, value));
  if (get_value(self) === value) return;
  if (isInput(element)) element.value = String(value);
  else {
    element.dataset['value'] = String(value);
    element.style.setProperty('--godot-ratio', String(max === min ? 0 : (value - min) / (max - min)));
  }
  VALUE_CHANGED.get(element)?.emit(value);
}

/**
 * @godot Range.get_min
 * @source scene/gui/range.cpp:280
 */
export function get_min(self: object): number {
  return bound(elementOf(self, 'get_min'), 'min', 0);
}

/**
 * @godot Range.get_max
 * @source scene/gui/range.cpp:284
 */
export function get_max(self: object): number {
  return bound(elementOf(self, 'get_max'), 'max', 100);
}

/**
 * @godot Range.get_step
 * @source scene/gui/range.cpp:288
 */
export function get_step(self: object): number {
  return bound(elementOf(self, 'get_step'), 'step', 1);
}

/**
 * The value's share of the bounds.
 *
 * @godot Range.get_as_ratio
 * @source scene/gui/range.cpp:316
 */
export function get_as_ratio(self: object): number {
  const min = get_min(self);
  const max = get_max(self);
  return max === min ? 0 : (get_value(self) - min) / (max - min);
}
