/**
 * @godot-class InputEventAction
 * @role BINDING
 *
 * Godot 4.7's `InputEventAction` (`core/input/input_event.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a scene declares one (a button's shortcut): an
 * action event record.
 */

import type { InputEventRecord } from './input-event';

/**
 * An action event of the properties a scene states (`action`, `pressed`, `strength`).
 *
 * @godot InputEventAction (protocol)
 * @source core/input/input_event.cpp:1620
 */
export function godot_input_event_action_new(properties: Readonly<Record<string, unknown>> = {}): InputEventRecord {
  return {
    type: 'action',
    device: 0,
    action: String(properties['action'] ?? ''),
    pressed: Boolean(properties['pressed'] ?? false),
    strength: Number(properties['strength'] ?? 1),
  } as unknown as InputEventRecord;
}

type ActionRecord = { type: 'action'; action: string; pressed: boolean; strength: number };

/**
 * @godot InputEventAction.set_action
 * @source core/input/input_event.cpp:1584
 */
export function set_action(self: object, action: string): void {
  (self as ActionRecord).action = String(action);
}

/**
 * @godot InputEventAction.get_action
 * @source core/input/input_event.cpp:1588
 */
export function get_action(self: object): string {
  return (self as ActionRecord).action;
}

/**
 * @godot InputEventAction.set_pressed
 * @source core/input/input_event.cpp:1592
 */
export function set_pressed(self: object, pressed: boolean): void {
  (self as ActionRecord).pressed = pressed;
}

/**
 * @godot InputEventAction.set_strength
 * @source core/input/input_event.cpp:1596
 */
export function set_strength(self: object, strength: number): void {
  (self as ActionRecord).strength = strength;
}

/**
 * @godot InputEventAction.get_strength
 * @source core/input/input_event.cpp:1600
 */
export function get_strength(self: object): number {
  return (self as ActionRecord).strength;
}
