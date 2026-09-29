/**
 * @godot-class Label
 * @role BINDING
 *
 * Godot 4.7's `Label` (`scene/gui/label.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`)
 * bound onto the element its scene renders (docs/GODOT.md "UI is React DOM"): its text is the
 * element's text, which the page lays out and draws in the font, size and colour the plan gave its
 * style (`scene-control-idioms.ts`).
 */

import { godot_dom_text_element, godot_dom_text_get, godot_dom_text_set } from './dom-text';

/**
 * @godot Label.set_text
 * @source scene/gui/label.cpp:1131
 */
export function set_text(self: object, p_string: string): void {
  godot_dom_text_set(godot_dom_text_element(self, 'Label.set_text'), p_string);
}

/**
 * @godot Label.get_text
 * @source scene/gui/label.cpp:1331
 */
export function get_text(self: object): string {
  return godot_dom_text_get(godot_dom_text_element(self, 'Label.get_text'));
}

/** `HorizontalAlignment` as CSS's `text-align`. */
const ALIGN = ['left', 'center', 'right', 'justify'] as const;

/**
 * @godot Label.set_horizontal_alignment
 * @source scene/gui/label.cpp:1096
 */
export function set_horizontal_alignment(self: object, p_alignment: number): void {
  godot_dom_text_element(self, 'Label.set_horizontal_alignment').style.textAlign = ALIGN[p_alignment] ?? 'left';
}

/**
 * @godot Label.get_horizontal_alignment
 * @source scene/gui/label.cpp:1112
 */
export function get_horizontal_alignment(self: object): number {
  const align = godot_dom_text_element(self, 'Label.get_horizontal_alignment').style.textAlign;
  return Math.max(0, ALIGN.indexOf(align as (typeof ALIGN)[number]));
}
