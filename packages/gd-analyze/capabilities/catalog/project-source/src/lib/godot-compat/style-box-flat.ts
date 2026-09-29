/**
 * @godot-class StyleBoxFlat
 * @role BINDING
 *
 * Godot 4.7's `StyleBoxFlat` (`scene/resources/style_box_flat.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as CSS: its fill the background colour (none when
 * it draws no center), its borders the element's borders inside its rect, its corners the border
 * radii, its shadow a box shadow, the rect grown by its expand margins. Its own margin on a side is
 * that side's border width (`get_style_margin`, `style_box_flat.cpp:37`). Skew, border blending
 * and the corner detail are kept and not drawn: CSS rounds corners smoothly.
 */

import { type Color, construct as color } from './color';
import { godot_style_box_css_color, godot_style_box_new, type StyleBox } from './style-box';
import { construct as vector2, type Vector2 } from './vector2';

export interface StyleBoxFlat extends StyleBox {
  bgColor: Color;
  borderColor: Color;
  readonly borderWidth: number[];
  readonly cornerRadius: number[];
  readonly expandMargin: number[];
  drawCenter: boolean;
  borderBlend: boolean;
  cornerDetail: number;
  skew: Vector2;
  shadowColor: Color;
  shadowSize: number;
  shadowOffset: Vector2;
  antiAliased: boolean;
  aaSize: number;
}

const SIDES = ['left', 'top', 'right', 'bottom'];
const CORNERS = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];

function paint(self: StyleBoxFlat, layer: HTMLElement): void {
  const [left, top, right, bottom] = self.expandMargin as [number, number, number, number];
  Object.assign(layer.style, {
    left: `${String(-left)}px`,
    top: `${String(-top)}px`,
    right: `${String(-right)}px`,
    bottom: `${String(-bottom)}px`,
    boxSizing: 'border-box',
    backgroundColor: self.drawCenter ? godot_style_box_css_color(self.bgColor) : 'transparent',
    borderStyle: 'solid',
    borderColor: godot_style_box_css_color(self.borderColor),
    // CSS states top, right, bottom, left; Godot's sides are left, top, right, bottom.
    borderWidth: [1, 2, 3, 0].map((side) => `${String(self.borderWidth[side] ?? 0)}px`).join(' '),
    borderRadius: self.cornerRadius.map((radius) => `${String(radius)}px`).join(' '),
    boxShadow: self.shadowSize > 0 ? `${String(self.shadowOffset.x)}px ${String(self.shadowOffset.y)}px ${String(self.shadowSize)}px ${godot_style_box_css_color(self.shadowColor)}` : 'none',
  });
}

/**
 * A flat box of the properties a scene states (`bg_color`, `border_width_left`, …) over Godot's
 * defaults (`style_box_flat.h:38`).
 *
 * @godot StyleBoxFlat (protocol)
 * @source scene/resources/style_box_flat.cpp:456
 */
export function godot_style_box_flat_new(properties: Readonly<Record<string, unknown>> = {}): StyleBoxFlat {
  const number = (name: string, initial: number) => (typeof properties[name] === 'number' ? (properties[name] as number) : initial);
  const colorOf = (name: string, initial: Color) => (properties[name] as Color | undefined) ?? initial;
  const self = {} as StyleBoxFlat;
  const box = godot_style_box_new(
    {
      styleMargin: (side) => self.borderWidth[side] ?? 0,
      paint: (layer) => paint(self, layer),
      key: () => JSON.stringify([self.bgColor, self.borderColor, self.borderWidth, self.cornerRadius, self.expandMargin, self.drawCenter, self.shadowColor, self.shadowSize, self.shadowOffset]),
    },
    properties,
  );
  return Object.assign(self, box, {
    bgColor: colorOf('bg_color', color(0.6, 0.6, 0.6, 1)),
    borderColor: colorOf('border_color', color(0.8, 0.8, 0.8, 1)),
    borderWidth: SIDES.map((side) => number(`border_width_${side}`, 0)),
    cornerRadius: CORNERS.map((corner) => number(`corner_radius_${corner}`, 0)),
    expandMargin: SIDES.map((side) => number(`expand_margin_${side}`, 0)),
    drawCenter: properties['draw_center'] !== false,
    borderBlend: properties['border_blend'] === true,
    cornerDetail: number('corner_detail', 8),
    skew: (properties['skew'] as Vector2 | undefined) ?? vector2(0, 0),
    shadowColor: colorOf('shadow_color', color(0, 0, 0, 0.6)),
    shadowSize: number('shadow_size', 0),
    shadowOffset: (properties['shadow_offset'] as Vector2 | undefined) ?? vector2(0, 0),
    antiAliased: properties['anti_aliasing'] !== false,
    aaSize: number('anti_aliasing_size', 1),
  });
}

/**
 * @godot StyleBoxFlat.StyleBoxFlat
 * @source scene/resources/style_box_flat.cpp:456
 */
export function construct(): StyleBoxFlat {
  return godot_style_box_flat_new();
}

/**
 * @godot StyleBoxFlat.set_bg_color
 * @source scene/resources/style_box_flat.cpp:51
 */
export function set_bg_color(self: StyleBoxFlat, value: Color): void {
  self.bgColor = value;
}

/**
 * @godot StyleBoxFlat.get_bg_color
 * @source scene/resources/style_box_flat.cpp:56
 */
export function get_bg_color(self: StyleBoxFlat): Color {
  return self.bgColor;
}

/**
 * @godot StyleBoxFlat.set_border_color
 * @source scene/resources/style_box_flat.cpp:60
 */
export function set_border_color(self: StyleBoxFlat, value: Color): void {
  self.borderColor = value;
}

/**
 * @godot StyleBoxFlat.set_border_width_all
 * @source scene/resources/style_box_flat.cpp:69
 */
export function set_border_width_all(self: StyleBoxFlat, width: number): void {
  for (let side = 0; side < 4; side += 1) self.borderWidth[side] = width;
}

/**
 * @godot StyleBoxFlat.set_border_width
 * @source scene/resources/style_box_flat.cpp:81
 */
export function set_border_width(self: StyleBoxFlat, side: number, width: number): void {
  self.borderWidth[side] = width;
}

/**
 * @godot StyleBoxFlat.set_border_blend
 * @source scene/resources/style_box_flat.cpp:92
 */
export function set_border_blend(self: StyleBoxFlat, blend: boolean): void {
  self.borderBlend = blend;
}

/**
 * @godot StyleBoxFlat.set_corner_radius
 * @source scene/resources/style_box_flat.cpp:101
 */
export function set_corner_radius(self: StyleBoxFlat, corner: number, radius: number): void {
  self.cornerRadius[corner] = radius;
}

/**
 * @godot StyleBoxFlat.set_corner_radius_all
 * @source scene/resources/style_box_flat.cpp:107
 */
export function set_corner_radius_all(self: StyleBoxFlat, radius: number): void {
  for (let corner = 0; corner < 4; corner += 1) self.cornerRadius[corner] = radius;
}

/**
 * @godot StyleBoxFlat.set_corner_detail
 * @source scene/resources/style_box_flat.cpp:129
 */
export function set_corner_detail(self: StyleBoxFlat, detail: number): void {
  self.cornerDetail = detail;
}

/**
 * @godot StyleBoxFlat.set_expand_margin
 * @source scene/resources/style_box_flat.cpp:138
 */
export function set_expand_margin(self: StyleBoxFlat, side: number, size: number): void {
  self.expandMargin[side] = size;
}

/**
 * @godot StyleBoxFlat.set_draw_center
 * @source scene/resources/style_box_flat.cpp:164
 */
export function set_draw_center(self: StyleBoxFlat, enabled: boolean): void {
  self.drawCenter = enabled;
}

/**
 * @godot StyleBoxFlat.set_skew
 * @source scene/resources/style_box_flat.cpp:173
 */
export function set_skew(self: StyleBoxFlat, skew: Vector2): void {
  self.skew = skew;
}

/**
 * @godot StyleBoxFlat.set_shadow_color
 * @source scene/resources/style_box_flat.cpp:182
 */
export function set_shadow_color(self: StyleBoxFlat, value: Color): void {
  self.shadowColor = value;
}

/**
 * @godot StyleBoxFlat.set_shadow_size
 * @source scene/resources/style_box_flat.cpp:191
 */
export function set_shadow_size(self: StyleBoxFlat, size: number): void {
  self.shadowSize = size;
}

/**
 * @godot StyleBoxFlat.set_shadow_offset
 * @source scene/resources/style_box_flat.cpp:200
 */
export function set_shadow_offset(self: StyleBoxFlat, offset: Vector2): void {
  self.shadowOffset = offset;
}

/**
 * @godot StyleBoxFlat.set_anti_aliased
 * @source scene/resources/style_box_flat.cpp:209
 */
export function set_anti_aliased(self: StyleBoxFlat, anti_aliased: boolean): void {
  self.antiAliased = anti_aliased;
}

/**
 * @godot StyleBoxFlat.set_aa_size
 * @source scene/resources/style_box_flat.cpp:219
 */
export function set_aa_size(self: StyleBoxFlat, size: number): void {
  self.aaSize = size;
}
