/**
 * @godot-class Button
 * @role BINDING
 *
 * Godot 4.7's `Button` (`scene/gui/button.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`)
 * bound onto the `<button>` (or a CheckBox's `<label>`) its scene renders (docs/GODOT.md "UI is
 * React DOM"): its text is the element's; pressing is `base-button.ts`'s.
 */

import { godot_dom_text_element, godot_dom_text_get, godot_dom_text_set } from './dom-text';

/**
 * @godot Button.set_text
 * @source scene/gui/button.cpp:600
 */
export function set_text(self: object, p_text: string): void {
  godot_dom_text_set(godot_dom_text_element(self, 'Button.set_text'), p_text);
}

/**
 * @godot Button.get_text
 * @source scene/gui/button.cpp:615
 */
export function get_text(self: object): string {
  return godot_dom_text_get(godot_dom_text_element(self, 'Button.get_text'));
}
