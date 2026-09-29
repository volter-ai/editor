/**
 * @godot-class ColorRect
 * @role BINDING
 *
 * Godot 4.7's `ColorRect` (`scene/gui/color_rect.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Control filling its rect with `color`.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { type Color, construct as color } from './color';
import { get_size, godot_control_mount, godot_control_props } from './control';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['ColorRect', 'Control', 'CanvasItem', 'Node', 'Object'];
const COLORS = new WeakMap<object, Color>();

const css = (c: Color): string => `rgba(${String(Math.round(Math.min(c.r, 1) * 255))}, ${String(Math.round(Math.min(c.g, 1) * 255))}, ${String(Math.round(Math.min(c.b, 1) * 255))}, ${String(c.a)})`;

/** `NOTIFICATION_DRAW` (`color_rect.cpp:47`): the rect in the colour. */
function draw(entity: Object3D, element: HTMLElement): void {
  element.style.backgroundColor = css(COLORS.get(entity) ?? color(1, 1, 1, 1));
  element.style.filter = godot_canvas_item_self_filter(entity, element);
}

/** `NOTIFICATION_DRAW` in a SubViewport: the rect filled with the colour, tinted. */
function paint(entity: Object3D, context: CanvasRenderingContext2D, tint: Color): void {
  const fill = COLORS.get(entity) ?? color(1, 1, 1, 1);
  const size = get_size(entity);
  context.fillStyle = css(color(fill.r * tint.r, fill.g * tint.g, fill.b * tint.b, fill.a));
  context.fillRect(0, 0, size.x, size.y);
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  return JSON.stringify([COLORS.get(entity), godot_canvas_item_self_filter(entity, element)]);
}

/**
 * Makes `entity` a ColorRect, white (`color_rect.h:41`).
 *
 * @godot ColorRect (protocol)
 * @source scene/gui/color_rect.cpp:62
 */
export function godot_color_rect_mount(entity: Object3D): void {
  COLORS.set(entity, color(1, 1, 1, 1));
  godot_control_mount(entity, CLASSES, { draw, drawKey, paint, shaded: (node) => COLORS.get(node) ?? color(1, 1, 1, 1) });
}

/**
 * @godot ColorRect.set_color
 * @source scene/gui/color_rect.cpp:33
 */
export function set_color(self: object, value: Color): void {
  COLORS.set(godot_node_entity(self), value);
}

/**
 * @godot ColorRect.get_color
 * @source scene/gui/color_rect.cpp:43
 */
export function get_color(self: object): Color {
  return COLORS.get(godot_node_entity(self)) ?? color(1, 1, 1, 1);
}

const COLOR_RECT = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_color_rect_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_control_props(),
    ['color', (entity, value: readonly [number, number, number, number]) => set_color(entity, color(...value))],
  ]),
};

/**
 * A ColorRect as a scene writes it: `<GodotColorRect color={[0.2, 0.3, 0.4, 1]} />`.
 *
 * @godot ColorRect (protocol)
 * @source scene/gui/color_rect.cpp:62
 */
export function GodotColorRect(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(COLOR_RECT, props);
}
