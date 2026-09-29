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
  return Object.freeze({
    type: 'action',
    device: 0,
    action: String(properties['action'] ?? ''),
    pressed: Boolean(properties['pressed'] ?? false),
    strength: Number(properties['strength'] ?? 1),
  }) as unknown as InputEventRecord;
}
