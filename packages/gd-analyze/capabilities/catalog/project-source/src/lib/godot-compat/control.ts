/**
 * @godot-class Control
 * @role BINDING
 *
 * Godot 4.7's `Control` (`scene/gui/control.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the React DOM element its scene renders
 * (docs/GODOT.md "UI is React DOM"): the page lays the element out from the style the plan computed
 * from Godot's rules (`scene-control-idioms.ts`), and a script's position, size, rotation, scale,
 * pivot, minimum size and theme overrides are that element's style. Positions are in the page's 2D
 * world, the overlay the Controls are laid out in at the project's 2D size (`godot-controls.tsx`).
 *
 * Not bound: Godot's own layout pass (the page's), focus navigation beyond the page's focus, and
 * the theme lookups of classes the page draws itself.
 */

import { type Color, construct as color } from './color';
import { godot_node_entity } from './node';
import { construct as rect2, type Rect2 } from './rect2';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

/** The element a Control is. */
function elementOf(self: object, member: string): HTMLElement {
  const entity = godot_node_entity(self) as unknown;
  if (typeof HTMLElement === 'undefined' || !(entity instanceof HTMLElement)) throw new Error(`godot-compat: Control.${member} on a node that is not a Control's element`);
  return entity;
}

/** A length in the element's own style (`12px`), or undefined for any other form. */
function pixels(value: string): number | undefined {
  const match = /^(-?[\d.]+)px$/u.exec(value.trim());
  return match === null ? undefined : Number(match[1]);
}

/** The canvas the element is laid out in: the page's overlay (`GodotStretch`), or the page itself. */
function canvasOf(element: HTMLElement): { readonly left: number; readonly top: number; readonly scaleX: number; readonly scaleY: number } {
  const canvas = element.closest<HTMLElement>('[data-godot-canvas]');
  if (canvas === null) return { left: 0, top: 0, scaleX: 1, scaleY: 1 };
  const box = canvas.getBoundingClientRect();
  return { left: box.left, top: box.top, scaleX: canvas.offsetWidth === 0 ? 1 : box.width / canvas.offsetWidth, scaleY: canvas.offsetHeight === 0 ? 1 : box.height / canvas.offsetHeight };
}

/**
 * Where the element is in its parent's box, before its rotation and scale.
 *
 * @godot Control.get_position
 * @source scene/gui/control.cpp:1487
 */
export function get_position(self: object): Vector2 {
  const element = elementOf(self, 'get_position');
  return vector2(f32(element.offsetLeft), f32(element.offsetTop));
}

/**
 * Moves the element within its parent's box, keeping its size (`_set_position`: the offsets move,
 * the anchors stay).
 *
 * @godot Control.set_position
 * @source scene/gui/control.cpp:1468
 */
export function set_position(self: object, p_point: Vector2, p_keep_offsets = false): void {
  void p_keep_offsets;
  const element = elementOf(self, 'set_position');
  if (element.style.right !== '') {
    element.style.width = `${String(element.offsetWidth)}px`;
    element.style.right = '';
  }
  if (element.style.bottom !== '') {
    element.style.height = `${String(element.offsetHeight)}px`;
    element.style.bottom = '';
  }
  element.style.left = `${String(p_point.x)}px`;
  element.style.top = `${String(p_point.y)}px`;
}

/**
 * Where the element is in the page's 2D world.
 *
 * @godot Control.get_global_position
 * @source scene/gui/control.cpp:1505
 */
export function get_global_position(self: object): Vector2 {
  const element = elementOf(self, 'get_global_position');
  const canvas = canvasOf(element);
  const box = element.getBoundingClientRect();
  return vector2(f32((box.left - canvas.left) / canvas.scaleX), f32((box.top - canvas.top) / canvas.scaleY));
}

/**
 * Moves the element to a point of the page's 2D world.
 *
 * @godot Control.set_global_position
 * @source scene/gui/control.cpp:1496
 */
export function set_global_position(self: object, p_point: Vector2, p_keep_offsets = false): void {
  const global = get_global_position(self);
  const local = get_position(self);
  set_position(self, vector2(local.x + p_point.x - global.x, local.y + p_point.y - global.y), p_keep_offsets);
}

/**
 * @godot Control.get_size
 * @source scene/gui/control.cpp:1563
 */
export function get_size(self: object): Vector2 {
  const element = elementOf(self, 'get_size');
  return vector2(f32(element.offsetWidth), f32(element.offsetHeight));
}

/**
 * @godot Control.set_size
 * @source scene/gui/control.cpp:1525
 */
export function set_size(self: object, p_size: Vector2, p_keep_offsets = false): void {
  void p_keep_offsets;
  const element = elementOf(self, 'set_size');
  element.style.width = `${String(p_size.x)}px`;
  element.style.height = `${String(p_size.y)}px`;
}

/**
 * @godot Control.get_rect
 * @source scene/gui/control.cpp:1585
 */
export function get_rect(self: object): Rect2 {
  const position = get_position(self);
  const size = get_size(self);
  return rect2(position.x, position.y, size.x, size.y);
}

/**
 * @godot Control.get_global_rect
 * @source scene/gui/control.cpp:1591
 */
export function get_global_rect(self: object): Rect2 {
  const position = get_global_position(self);
  const size = get_size(self);
  return rect2(position.x, position.y, size.x, size.y);
}

/**
 * @godot Control.get_rotation
 * @source scene/gui/control.cpp:1651
 */
export function get_rotation(self: object): number {
  const element = elementOf(self, 'get_rotation');
  const match = /^(-?[\d.e-]+)rad$/u.exec(element.style.rotate.trim());
  return match === null ? 0 : f32(Number(match[1]));
}

/**
 * CSS's own `rotate`, about the pivot (`transform-origin`).
 *
 * @godot Control.set_rotation
 * @source scene/gui/control.cpp:1634
 */
export function set_rotation(self: object, p_radians: number): void {
  elementOf(self, 'set_rotation').style.rotate = `${String(p_radians)}rad`;
}

/**
 * @godot Control.get_rotation_degrees
 * @source scene/gui/control.cpp:1656
 */
export function get_rotation_degrees(self: object): number {
  return f32((get_rotation(self) * 180) / Math.PI);
}

/**
 * @godot Control.set_rotation_degrees
 * @source scene/gui/control.cpp:1646
 */
export function set_rotation_degrees(self: object, p_degrees: number): void {
  set_rotation(self, (p_degrees * Math.PI) / 180);
}

/**
 * @godot Control.get_scale
 * @source scene/gui/control.cpp:1629
 */
export function get_scale(self: object): Vector2 {
  const [x = '1', y = x] = elementOf(self, 'get_scale').style.scale.trim().split(/\s+/u);
  return vector2(f32(Number(x) || 1), f32(Number(y) || 1));
}

/**
 * CSS's own `scale`, about the pivot.
 *
 * @godot Control.set_scale
 * @source scene/gui/control.cpp:1610
 */
export function set_scale(self: object, p_scale: Vector2): void {
  elementOf(self, 'set_scale').style.scale = `${String(p_scale.x)} ${String(p_scale.y)}`;
}

/**
 * The pivot the element rotates and scales about (`transform-origin`).
 *
 * @godot Control.get_pivot_offset
 * @source scene/gui/control.cpp:1690
 */
export function get_pivot_offset(self: object): Vector2 {
  const [x = '0px', y = '0px'] = elementOf(self, 'get_pivot_offset').style.transformOrigin.trim().split(/\s+/u);
  return vector2(f32(pixels(x) ?? 0), f32(pixels(y) ?? 0));
}

/**
 * @godot Control.set_pivot_offset
 * @source scene/gui/control.cpp:1678
 */
export function set_pivot_offset(self: object, p_pivot: Vector2): void {
  elementOf(self, 'set_pivot_offset').style.transformOrigin = `${String(p_pivot.x)}px ${String(p_pivot.y)}px`;
}

/**
 * @godot Control.get_custom_minimum_size
 * @source scene/gui/control.cpp:1953
 */
export function get_custom_minimum_size(self: object): Vector2 {
  const element = elementOf(self, 'get_custom_minimum_size');
  return vector2(f32(pixels(element.style.minWidth) ?? 0), f32(pixels(element.style.minHeight) ?? 0));
}

/**
 * The element's own minimum size (`min-width`, `min-height`).
 *
 * @godot Control.set_custom_minimum_size
 * @source scene/gui/control.cpp:1937
 */
export function set_custom_minimum_size(self: object, p_custom: Vector2): void {
  const element = elementOf(self, 'set_custom_minimum_size');
  element.style.minWidth = p_custom.x > 0 ? `${String(p_custom.x)}px` : '';
  element.style.minHeight = p_custom.y > 0 ? `${String(p_custom.y)}px` : '';
}

/** `MOUSE_FILTER_STOP`, `_PASS`, `_IGNORE`. */
const MOUSE_FILTER_IGNORE = 2;

/**
 * Whether the element takes pointer input (`pointer-events`).
 *
 * @godot Control.set_mouse_filter
 * @source scene/gui/control.cpp:2554
 */
export function set_mouse_filter(self: object, p_filter: number): void {
  const element = elementOf(self, 'set_mouse_filter');
  element.style.pointerEvents = p_filter === MOUSE_FILTER_IGNORE ? 'none' : 'auto';
  element.dataset['mouseFilter'] = String(p_filter);
}

/**
 * @godot Control.get_mouse_filter
 * @source scene/gui/control.cpp:2571
 */
export function get_mouse_filter(self: object): number {
  const element = elementOf(self, 'get_mouse_filter');
  const stated = element.dataset['mouseFilter'];
  return stated !== undefined ? Number(stated) : element.style.pointerEvents === 'none' ? MOUSE_FILTER_IGNORE : 0;
}

/** A colour as CSS. */
function css(value: Color): string {
  const byte = (channel: number) => Math.round(Math.min(1, Math.max(0, channel)) * 255);
  return `rgba(${String(byte(value.r))}, ${String(byte(value.g))}, ${String(byte(value.b))}, ${String(value.a)})`;
}

/** The theme colours a script overrides, by name, as their elements keep them. */
const COLORS = new WeakMap<HTMLElement, Map<string, Color>>();

/**
 * A theme colour of the element's own: its text's (`font_color`), the page's `color`.
 *
 * @godot Control.add_theme_color_override
 * @source scene/gui/control.cpp:4030
 */
export function add_theme_color_override(self: object, p_name: string, p_color: Color): void {
  const element = elementOf(self, 'add_theme_color_override');
  let colors = COLORS.get(element);
  if (colors === undefined) {
    colors = new Map();
    COLORS.set(element, colors);
  }
  colors.set(p_name, p_color);
  if (p_name === 'font_color') element.style.color = css(p_color);
}

/**
 * @godot Control.remove_theme_color_override
 * @source scene/gui/control.cpp:4078
 */
export function remove_theme_color_override(self: object, p_name: string): void {
  const element = elementOf(self, 'remove_theme_color_override');
  COLORS.get(element)?.delete(p_name);
  if (p_name === 'font_color') element.style.color = '';
}

/**
 * The colour the element draws a theme item in: its override, else its computed text colour.
 *
 * @godot Control.get_theme_color
 * @source scene/gui/control.cpp:3768
 */
export function get_theme_color(self: object, p_name: string, p_theme_type = ''): Color {
  void p_theme_type;
  const element = elementOf(self, 'get_theme_color');
  const own = COLORS.get(element)?.get(p_name);
  if (own !== undefined) return own;
  const match = /rgba?\(([^)]+)\)/u.exec(getComputedStyle(element).color);
  const [r = 255, g = 255, b = 255, a = 1] = (match?.[1] ?? '').split(',').map((part) => Number(part.trim()));
  return color(r / 255, g / 255, b / 255, a);
}

/**
 * A font size of the element's own (`font_size`, the page's `font-size`).
 *
 * @godot Control.add_theme_font_size_override
 * @source scene/gui/control.cpp:4024
 */
export function add_theme_font_size_override(self: object, p_name: string, p_font_size: number): void {
  const element = elementOf(self, 'add_theme_font_size_override');
  if (p_name === 'font_size') element.style.fontSize = `${String(p_font_size)}px`;
}

/**
 * The page's focus: the element takes it.
 *
 * @godot Control.grab_focus
 * @source scene/gui/control.cpp:2994
 */
export function grab_focus(self: object, p_hide_focus = false): void {
  void p_hide_focus;
  elementOf(self, 'grab_focus').focus();
}

/**
 * @godot Control.release_focus
 * @source scene/gui/control.cpp:3020
 */
export function release_focus(self: object): void {
  elementOf(self, 'release_focus').blur();
}

/**
 * @godot Control.has_focus
 * @source scene/gui/control.cpp:2989
 */
export function has_focus(self: object, p_ignore_hidden_focus = false): boolean {
  void p_ignore_hidden_focus;
  const element = elementOf(self, 'has_focus');
  return element.ownerDocument.activeElement === element;
}
