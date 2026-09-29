/**
 * @godot-class Shortcut
 * @role BINDING
 *
 * Godot 4.7's `Shortcut` (`scene/gui/shortcut.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the input events that trigger a button.
 */

import type { InputEventRecord } from './input-event';

export interface Shortcut {
  events: readonly InputEventRecord[];
}

/**
 * A new Shortcut, with the events a scene states.
 *
 * @godot Shortcut (protocol)
 * @source scene/gui/shortcut.cpp:150
 */
export function godot_shortcut_new(properties: Readonly<Record<string, unknown>> = {}): Shortcut {
  return { events: (properties['events'] as readonly InputEventRecord[] | undefined) ?? [] };
}

/**
 * @godot Shortcut.Shortcut
 * @source scene/gui/shortcut.cpp:150
 */
export function construct(): Shortcut {
  return godot_shortcut_new();
}

/**
 * @godot Shortcut.set_events
 * @source scene/gui/shortcut.cpp:34
 */
export function set_events(self: Shortcut, events: readonly InputEventRecord[]): void {
  self.events = events;
}

/**
 * @godot Shortcut.get_events
 * @source scene/gui/shortcut.cpp:39
 */
export function get_events(self: Shortcut): readonly InputEventRecord[] {
  return self.events;
}

/**
 * @godot Shortcut.has_valid_event
 * @source scene/gui/shortcut.cpp:43
 */
export function has_valid_event(self: Shortcut): boolean {
  return self.events.length > 0;
}
