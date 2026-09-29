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
 * @godot InputEventKey.get_keycode
 * @source core/input/input_event.cpp:341
 */
export function get_keycode(self: KeyEvent): number {
  return self.keycode;
}

/**
 * @godot InputEventKey.get_physical_keycode
 * @source core/input/input_event.cpp:359
 */
export function get_physical_keycode(self: KeyEvent): number {
  return self.physical_keycode;
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
export function set_pressed(self: KeyEvent, pressed: boolean): void {
  (self as MutableKeyEvent).pressed = pressed;
}

/**
 * @godot InputEventKey.set_keycode
 * @source core/input/input_event.cpp:336
 */
export function set_keycode(self: KeyEvent, keycode: number): void {
  (self as MutableKeyEvent).keycode = keycode;
}

/**
 * @godot InputEventKey.set_key_label
 * @source core/input/input_event.cpp:345
 */
export function set_key_label(self: KeyEvent, key_label: number): void {
  (self as MutableKeyEvent).key_label = key_label;
}

/**
 * @godot InputEventKey.get_key_label
 * @source core/input/input_event.cpp:350
 */
export function get_key_label(self: KeyEvent): number {
  return self.key_label;
}

/**
 * @godot InputEventKey.set_physical_keycode
 * @source core/input/input_event.cpp:354
 */
export function set_physical_keycode(self: KeyEvent, physical_keycode: number): void {
  (self as MutableKeyEvent).physical_keycode = physical_keycode;
}

/**
 * @godot InputEventKey.set_echo
 * @source core/input/input_event.cpp:381
 */
export function set_echo(self: KeyEvent, echo: boolean): void {
  (self as MutableKeyEvent).echo = echo;
}
