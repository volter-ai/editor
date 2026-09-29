/**
 * @godot-class InputEventKey
 * @role PROTOCOL
 *
 * Godot 4.7's `InputEventKey` keycodes on the event records of `input-event.ts`, at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`, and the key events a script makes and sets.
 */

import type { InputEventRecord } from './input-event';

type KeyEvent = Extract<InputEventRecord, { readonly type: 'key' }>;

/**
 * An event as a key event: a script reaches InputEventKey's members on an `InputEvent` it tested
 * (`event is InputEventKey and event.keycode`), which Godot resolves on the object at run time; on
 * another event the member is not there and the call fails by name.
 */
function keyOf(self: InputEventRecord, member: string): KeyEvent {
  if (self.type !== 'key') throw new TypeError(`godot-compat: InputEventKey.${member} on an event that is not a key event.`);
  return self;
}

/**
 * @godot InputEventKey.get_keycode
 * @source core/input/input_event.cpp:341
 */
export function get_keycode(self: InputEventRecord): number {
  const key = keyOf(self, 'get_keycode');
  return key.keycode;
}

/**
 * @godot InputEventKey.get_physical_keycode
 * @source core/input/input_event.cpp:359
 */
export function get_physical_keycode(self: InputEventRecord): number {
  const key = keyOf(self, 'get_physical_keycode');
  return key.physical_keycode;
}

type MutableKeyEvent = { -readonly [K in keyof KeyEvent]: KeyEvent[K] };

/**
 * A key event a script makes (`InputEventKey.new()`): released, no key, the keyboard's device.
 *
 * @godot InputEventKey.InputEventKey
 * @source core/input/input_event.cpp:669
 */
export function construct(): KeyEvent {
  return { type: 'key', device: 16, pressed: false, keycode: 0, physical_keycode: 0, key_label: 0 };
}

/**
 * @godot InputEventKey.set_pressed
 * @source core/input/input_event.cpp:331
 */
export function set_pressed(self: InputEventRecord, pressed: boolean): void {
  const key = keyOf(self, 'set_pressed');
  (key as MutableKeyEvent).pressed = pressed;
}

/**
 * @godot InputEventKey.set_keycode
 * @source core/input/input_event.cpp:336
 */
export function set_keycode(self: InputEventRecord, keycode: number): void {
  const key = keyOf(self, 'set_keycode');
  (key as MutableKeyEvent).keycode = keycode;
}

/**
 * @godot InputEventKey.set_key_label
 * @source core/input/input_event.cpp:345
 */
export function set_key_label(self: InputEventRecord, key_label: number): void {
  const key = keyOf(self, 'set_key_label');
  (key as MutableKeyEvent).key_label = key_label;
}

/**
 * @godot InputEventKey.get_key_label
 * @source core/input/input_event.cpp:350
 */
export function get_key_label(self: InputEventRecord): number {
  const key = keyOf(self, 'get_key_label');
  return key.key_label;
}

/**
 * @godot InputEventKey.set_physical_keycode
 * @source core/input/input_event.cpp:354
 */
export function set_physical_keycode(self: InputEventRecord, physical_keycode: number): void {
  const key = keyOf(self, 'set_physical_keycode');
  (key as MutableKeyEvent).physical_keycode = physical_keycode;
}

/**
 * @godot InputEventKey.set_echo
 * @source core/input/input_event.cpp:381
 */
export function set_echo(self: InputEventRecord, echo: boolean): void {
  const key = keyOf(self, 'set_echo');
  (key as MutableKeyEvent).echo = echo;
}
