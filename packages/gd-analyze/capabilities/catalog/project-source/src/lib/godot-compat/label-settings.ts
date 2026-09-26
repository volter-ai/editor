/**
 * @godot-class LabelSettings
 * @role PROTOCOL
 *
 * Godot 4.7's `LabelSettings` resource (`scene/resources/label_settings.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Label's font size, colours, spacing, outline and
 * shadow, stored as set; a change emits `changed`, which the Labels using the settings listen to.
 * The font is the default theme's (`font` is not bound). Its native entity is a plain object.
 */

import { construct as color, type Color } from './color';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

export interface LabelSettings {
  lineSpacing: number;
  paragraphSpacing: number;
  fontSize: number;
  fontColor: Color;
  outlineSize: number;
  outlineColor: Color;
  shadowSize: number;
  shadowColor: Color;
  shadowOffset: Vector2;
  readonly listeners: Set<() => void>;
}

/**
 * A new `LabelSettings` with its defaults (`scene/resources/label_settings.h:53-65`).
 *
 * @godot LabelSettings (protocol)
 * @source scene/resources/label_settings.h:53
 */
export function godot_label_settings_new(): LabelSettings {
  return {
    lineSpacing: 3,
    paragraphSpacing: 0,
    fontSize: 16,
    fontColor: color(1, 1, 1, 1),
    outlineSize: 0,
    outlineColor: color(1, 1, 1, 1),
    shadowSize: 1,
    shadowColor: color(0, 0, 0, 0),
    shadowOffset: vector2(1, 1),
    listeners: new Set(),
  };
}

function changed(self: LabelSettings): void {
  for (const listener of [...self.listeners]) listener();
}

/**
 * @godot LabelSettings.set_line_spacing
 * @source scene/resources/label_settings.cpp:134
 */
export function set_line_spacing(self: LabelSettings, p_value: number): void {
  if (self.lineSpacing === f32(p_value)) return;
  self.lineSpacing = f32(p_value);
  changed(self);
}

/**
 * @godot LabelSettings.get_line_spacing
 * @source scene/resources/label_settings.cpp:141
 */
export function get_line_spacing(self: LabelSettings): number {
  return self.lineSpacing;
}

/**
 * @godot LabelSettings.set_paragraph_spacing
 * @source scene/resources/label_settings.cpp:145
 */
export function set_paragraph_spacing(self: LabelSettings, p_value: number): void {
  if (self.paragraphSpacing === f32(p_value)) return;
  self.paragraphSpacing = f32(p_value);
  changed(self);
}

/**
 * @godot LabelSettings.get_paragraph_spacing
 * @source scene/resources/label_settings.cpp:152
 */
export function get_paragraph_spacing(self: LabelSettings): number {
  return self.paragraphSpacing;
}

/**
 * @godot LabelSettings.set_font_size
 * @source scene/resources/label_settings.cpp:173
 */
export function set_font_size(self: LabelSettings, p_value: number): void {
  if (self.fontSize === p_value) return;
  self.fontSize = p_value;
  changed(self);
}

/**
 * @godot LabelSettings.get_font_size
 * @source scene/resources/label_settings.cpp:180
 */
export function get_font_size(self: LabelSettings): number {
  return self.fontSize;
}

/**
 * @godot LabelSettings.set_font_color
 * @source scene/resources/label_settings.cpp:184
 */
export function set_font_color(self: LabelSettings, p_value: Color): void {
  if (self.fontColor.r === p_value.r && self.fontColor.g === p_value.g && self.fontColor.b === p_value.b && self.fontColor.a === p_value.a) return;
  self.fontColor = p_value;
  changed(self);
}

/**
 * @godot LabelSettings.get_font_color
 * @source scene/resources/label_settings.cpp:191
 */
export function get_font_color(self: LabelSettings): Color {
  return self.fontColor;
}

/**
 * @godot LabelSettings.set_outline_size
 * @source scene/resources/label_settings.cpp:195
 */
export function set_outline_size(self: LabelSettings, p_value: number): void {
  if (self.outlineSize === p_value) return;
  self.outlineSize = p_value;
  changed(self);
}

/**
 * @godot LabelSettings.get_outline_size
 * @source scene/resources/label_settings.cpp:202
 */
export function get_outline_size(self: LabelSettings): number {
  return self.outlineSize;
}

/**
 * @godot LabelSettings.set_outline_color
 * @source scene/resources/label_settings.cpp:206
 */
export function set_outline_color(self: LabelSettings, p_value: Color): void {
  if (self.outlineColor.r === p_value.r && self.outlineColor.g === p_value.g && self.outlineColor.b === p_value.b && self.outlineColor.a === p_value.a) return;
  self.outlineColor = p_value;
  changed(self);
}

/**
 * @godot LabelSettings.get_outline_color
 * @source scene/resources/label_settings.cpp:213
 */
export function get_outline_color(self: LabelSettings): Color {
  return self.outlineColor;
}

/**
 * @godot LabelSettings.set_shadow_size
 * @source scene/resources/label_settings.cpp:217
 */
export function set_shadow_size(self: LabelSettings, p_value: number): void {
  if (self.shadowSize === p_value) return;
  self.shadowSize = p_value;
  changed(self);
}

/**
 * @godot LabelSettings.get_shadow_size
 * @source scene/resources/label_settings.cpp:224
 */
export function get_shadow_size(self: LabelSettings): number {
  return self.shadowSize;
}

/**
 * @godot LabelSettings.set_shadow_color
 * @source scene/resources/label_settings.cpp:228
 */
export function set_shadow_color(self: LabelSettings, p_value: Color): void {
  if (self.shadowColor.r === p_value.r && self.shadowColor.g === p_value.g && self.shadowColor.b === p_value.b && self.shadowColor.a === p_value.a) return;
  self.shadowColor = p_value;
  changed(self);
}

/**
 * @godot LabelSettings.get_shadow_color
 * @source scene/resources/label_settings.cpp:235
 */
export function get_shadow_color(self: LabelSettings): Color {
  return self.shadowColor;
}

/**
 * @godot LabelSettings.set_shadow_offset
 * @source scene/resources/label_settings.cpp:239
 */
export function set_shadow_offset(self: LabelSettings, p_value: Vector2): void {
  if (self.shadowOffset.x === p_value.x && self.shadowOffset.y === p_value.y) return;
  self.shadowOffset = p_value;
  changed(self);
}

/**
 * @godot LabelSettings.get_shadow_offset
 * @source scene/resources/label_settings.cpp:246
 */
export function get_shadow_offset(self: LabelSettings): Vector2 {
  return self.shadowOffset;
}
