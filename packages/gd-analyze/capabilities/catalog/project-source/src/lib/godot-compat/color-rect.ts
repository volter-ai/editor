/**
 * @godot-class ColorRect
 * @role BINDING
 *
 * Godot 4.7's `ColorRect` (`scene/gui/color_rect.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the element its scene renders (docs/GODOT.md
 * "UI is React DOM"): its colour is the element's background.
 */

import { type Color, construct as color } from './color';
import { godot_node_entity } from './node';

function elementOf(self: object, member: string): HTMLElement {
  const entity = godot_node_entity(self) as unknown;
  if (typeof HTMLElement === 'undefined' || !(entity instanceof HTMLElement)) throw new Error(`godot-compat: ColorRect.${member} on a node that is not a Control's element`);
  return entity;
}

const COLORS = new WeakMap<HTMLElement, Color>();

/**
 * @godot ColorRect.set_color
 * @source scene/gui/color_rect.cpp:36
 */
export function set_color(self: object, p_color: Color): void {
  const element = elementOf(self, 'set_color');
  COLORS.set(element, p_color);
  const byte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255);
  element.style.background = `rgba(${String(byte(p_color.r))}, ${String(byte(p_color.g))}, ${String(byte(p_color.b))}, ${String(p_color.a)})`;
}

/**
 * @godot ColorRect.get_color
 * @source scene/gui/color_rect.cpp:45
 */
export function get_color(self: object): Color {
  return COLORS.get(elementOf(self, 'get_color')) ?? color(1, 1, 1, 1);
}
