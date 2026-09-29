/**
 * @godot-class InputEventKey
 * @role PROTOCOL
 *
 * Godot 4.7's `InputEventKey` keycodes on the event records of `input-event.ts`, at revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`.
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
