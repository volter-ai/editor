/**
 * @godot-class ButtonGroup
 * @role BINDING
 *
 * Godot 4.7's `ButtonGroup` (`scene/gui/base_button.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the toggle buttons that share it, of which one is
 * pressed at a time: pressing one unpresses the others, and (unless the group allows unpressing)
 * pressing the pressed one keeps it pressed (`BaseButton::_unpress_group`, `base_button.cpp:38`).
 * Its `pressed` signal names the button pressed. A group is local to its scene
 * (`set_local_to_scene(true)`): each instance of the scene has its own.
 */

import { createSignal, type GodotSignal, type SignalHandle } from './signal';

export interface ButtonGroup {
  allowUnpress: boolean;
  /** The buttons in it, in the order they joined (`HashSet` insertion order). */
  readonly buttons: Set<object>;
  readonly pressedSignal: SignalHandle<[object]>;
}

/**
 * @godot ButtonGroup.ButtonGroup
 * @source scene/gui/base_button.cpp:645
 */
export function construct(): ButtonGroup {
  return { allowUnpress: false, buttons: new Set(), pressedSignal: createSignal<[object]>() };
}

/**
 * @godot ButtonGroup.set_allow_unpress
 * @source scene/gui/base_button.cpp:627
 */
export function set_allow_unpress(self: ButtonGroup, enabled: boolean): void {
  self.allowUnpress = enabled;
}

/**
 * @godot ButtonGroup.is_allow_unpress
 * @source scene/gui/base_button.cpp:630
 */
export function is_allow_unpress(self: ButtonGroup): boolean {
  return self.allowUnpress;
}

/**
 * @godot ButtonGroup.get_buttons
 * @source scene/gui/base_button.cpp:608
 */
export function get_buttons(self: ButtonGroup): object[] {
  return [...self.buttons];
}

/**
 * @godot ButtonGroup.pressed
 * @source scene/gui/base_button.cpp:641
 */
export function pressed(self: ButtonGroup): GodotSignal<[object]> {
  return self.pressedSignal.signal;
}
