/**
 * @godot-class HSeparator
 * @role BINDING
 *
 * Godot 4.7's `HSeparator` (`scene/gui/separator.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its `separator` stylebox drawn across its width,
 * centred in its height (`Separator::_notification`, `separator.cpp:45`), its minimum height the
 * theme's `separation`. The default theme's separator is a grey line a pixel thick, 4 pixels in
 * from each end (`default_theme.cpp:734`), with a separation of 4.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { construct as color } from './color';
import { godot_control_mount, godot_control_props, get_theme_constant, get_theme_stylebox, update_minimum_size } from './control';
import { godot_node_adopt } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { get_margin, godot_style_box_key, godot_style_box_paint, type StyleBox } from './style-box';
import { godot_style_box_line_new } from './style-box-line';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['HSeparator', 'Separator', 'Control', 'CanvasItem', 'Node', 'Object'];

/** `separator_horizontal` (`default_theme.cpp:734`). */
const DEFAULT_SEPARATOR = godot_style_box_line_new({ color: color(0.5, 0.5, 0.5, 1), thickness: 1, content_margin_left: 4, content_margin_top: 0, content_margin_right: 4, content_margin_bottom: 0 });

function separator(entity: Object3D): StyleBox {
  return (get_theme_stylebox(entity, 'separator') as StyleBox | null) ?? DEFAULT_SEPARATOR;
}

/** `Separator::get_minimum_size` (`separator.cpp:35`). */
function minimumSize(entity: Object3D): Vector2 {
  return vector2(3, get_theme_constant(entity, 'separation'));
}

const LINES = new WeakMap<Object3D, readonly [HTMLElement, HTMLElement]>();

/** The stylebox in a rect its minimum height tall, centred (`separator.cpp:54`). */
function draw(entity: Object3D, element: HTMLElement): void {
  let parts = LINES.get(entity);
  if (parts === undefined) {
    const band = element.ownerDocument.createElement('div');
    band.setAttribute('data-godot-content', '');
    Object.assign(band.style, { position: 'absolute', left: '0px', right: '0px', top: '50%', pointerEvents: 'none' });
    const line = element.ownerDocument.createElement('div');
    line.style.position = 'absolute';
    band.append(line);
    parts = [band, line];
    LINES.set(entity, parts);
  }
  const [band, line] = parts;
  if (band.parentElement !== element) element.insertBefore(band, element.firstChild);
  const style = separator(entity);
  const height = get_margin(style, 1) + get_margin(style, 3);
  band.style.height = `${String(height)}px`;
  band.style.marginTop = `${String(-Math.trunc(height / 2))}px`;
  godot_style_box_paint(style, line);
  band.style.filter = godot_canvas_item_self_filter(entity, element);
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  return `${godot_style_box_key(separator(entity))}|${godot_canvas_item_self_filter(entity, element)}`;
}

/**
 * @godot HSeparator (protocol)
 * @source scene/gui/separator.cpp:45
 */
export function godot_h_separator_mount(entity: Object3D): void {
  godot_control_mount(entity, CLASSES.slice(0, -1), {
    minimumSize,
    draw,
    drawKey,
    themeChanged: (control) => update_minimum_size(control),
    themeConstants: { separation: 4 },
  });
}

/**
 * @godot HSeparator.HSeparator
 * @source scene/gui/separator.cpp:71
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_h_separator_mount(entity);
  return entity;
}

const H_SEPARATOR = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_h_separator_mount,
  props: new Map<string, GodotElementProp<Object3D>>(godot_control_props()),
};

/**
 * An HSeparator as a scene writes it; its line a theme override (`themeOverrides`).
 *
 * @godot HSeparator (protocol)
 * @source scene/gui/separator.cpp:45
 */
export function GodotHSeparator(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(H_SEPARATOR, props);
}
