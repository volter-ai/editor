/**
 * @godot-class StyleBoxLine
 * @role BINDING
 *
 * Godot 4.7's `StyleBoxLine` (`scene/resources/style_box_line.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a line of its colour and thickness along its rect's
 * top (or left, vertical), grown past the rect's ends by `grow_begin` and `grow_end`
 * (`StyleBoxLine::draw`, `style_box_line.cpp:94`), as a filled element. Its own margin is half its
 * thickness across the line (`get_style_margin`, `:35`).
 */

import { type Color, construct as color } from './color';
import { godot_style_box_css_color, godot_style_box_new, type StyleBox } from './style-box';

export interface StyleBoxLine extends StyleBox {
  color: Color;
  thickness: number;
  vertical: boolean;
  growBegin: number;
  growEnd: number;
}

function paint(self: StyleBoxLine, layer: HTMLElement): void {
  Object.assign(layer.style, {
    backgroundColor: godot_style_box_css_color(self.color),
    ...(self.vertical
      ? { left: '0px', right: 'auto', width: `${String(self.thickness)}px`, top: `${String(-self.growBegin)}px`, bottom: `${String(-self.growEnd)}px`, height: 'auto' }
      : { top: '0px', bottom: 'auto', height: `${String(self.thickness)}px`, left: `${String(-self.growBegin)}px`, right: `${String(-self.growEnd)}px`, width: 'auto' }),
  });
}

/**
 * A line box of the properties a scene states over Godot's defaults (`style_box_line.h`: a black
 * line one pixel thick, grown a pixel each way).
 *
 * @godot StyleBoxLine (protocol)
 * @source scene/resources/style_box_line.cpp:94
 */
export function godot_style_box_line_new(properties: Readonly<Record<string, unknown>> = {}): StyleBoxLine {
  const number = (name: string, initial: number) => (typeof properties[name] === 'number' ? (properties[name] as number) : initial);
  const self = {} as StyleBoxLine;
  const box = godot_style_box_new(
    {
      styleMargin: (side) => ((self.vertical ? side === 0 || side === 2 : side === 1 || side === 3) ? self.thickness / 2 : 0),
      paint: (layer) => paint(self, layer),
      key: () => JSON.stringify([self.color, self.thickness, self.vertical, self.growBegin, self.growEnd]),
    },
    properties,
  );
  return Object.assign(self, box, {
    color: (properties['color'] as Color | undefined) ?? color(0, 0, 0, 1),
    thickness: number('thickness', 1),
    vertical: properties['vertical'] === true,
    growBegin: number('grow_begin', 1),
    growEnd: number('grow_end', 1),
  });
}

/**
 * @godot StyleBoxLine.StyleBoxLine
 * @source scene/resources/style_box_line.cpp:94
 */
export function construct(): StyleBoxLine {
  return godot_style_box_line_new();
}

/**
 * @godot StyleBoxLine.set_color
 * @source scene/resources/style_box_line.cpp:49
 */
export function set_color(self: StyleBoxLine, value: Color): void {
  self.color = value;
}

/**
 * @godot StyleBoxLine.set_thickness
 * @source scene/resources/style_box_line.cpp:58
 */
export function set_thickness(self: StyleBoxLine, thickness: number): void {
  self.thickness = thickness;
}

/**
 * @godot StyleBoxLine.set_vertical
 * @source scene/resources/style_box_line.cpp:67
 */
export function set_vertical(self: StyleBoxLine, vertical: boolean): void {
  self.vertical = vertical;
}

/**
 * @godot StyleBoxLine.set_grow_end
 * @source scene/resources/style_box_line.cpp:76
 */
export function set_grow_end(self: StyleBoxLine, offset: number): void {
  self.growEnd = offset;
}

/**
 * @godot StyleBoxLine.set_grow_begin
 * @source scene/resources/style_box_line.cpp:85
 */
export function set_grow_begin(self: StyleBoxLine, offset: number): void {
  self.growBegin = offset;
}
