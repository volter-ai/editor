/**
 * @godot-class PanelContainer
 * @role BINDING
 *
 * Godot 4.7's `PanelContainer` (`scene/gui/panel_container.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its `panel` stylebox drawn over its rect, each
 * child fit to the rect less the stylebox's margins, its minimum size the largest child's plus
 * those margins. The default theme's panel is a dark translucent flat box with no margins
 * (`default_theme.cpp:1274`).
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_canvas_item_self_filter } from './canvas-item';
import { construct as color } from './color';
import { fit_child_in_rect } from './container';
import { godot_control_mount, godot_control_props, godot_control_sortable, get_combined_minimum_size, get_size, get_theme_stylebox, set_mouse_filter, update_minimum_size } from './control';
import { godot_node_adopt } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as rect2 } from './rect2';
import { get_margin, godot_style_box_key, godot_style_box_paint, type StyleBox } from './style-box';
import { godot_style_box_flat_new } from './style-box-flat';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['PanelContainer', 'Container', 'Control', 'CanvasItem', 'Node', 'Object'];

/** `make_flat_stylebox(style_normal_color, 0, 0, 0, 0)` (`default_theme.cpp:57`, `:112`): corners of 3. */
const DEFAULT_PANEL = godot_style_box_flat_new({
  bg_color: color(0.1, 0.1, 0.1, 0.6),
  content_margin_left: 0,
  content_margin_top: 0,
  content_margin_right: 0,
  content_margin_bottom: 0,
  corner_radius_top_left: 3,
  corner_radius_top_right: 3,
  corner_radius_bottom_right: 3,
  corner_radius_bottom_left: 3,
});

function panel(entity: Object3D): StyleBox {
  return (get_theme_stylebox(entity, 'panel') as StyleBox | null) ?? DEFAULT_PANEL;
}

function sortable(entity: Object3D, mode: 'visible' | 'visible-in-tree'): Object3D[] {
  return entity.children.flatMap((child) => {
    const found = godot_control_sortable(child, mode);
    return found === null ? [] : [found];
  });
}

/** `PanelContainer::get_minimum_size` (`panel_container.cpp:35`). */
function minimumSize(entity: Object3D): Vector2 {
  let width = 0;
  let height = 0;
  for (const child of sortable(entity, 'visible')) {
    const size = get_combined_minimum_size(child);
    width = Math.max(width, size.x);
    height = Math.max(height, size.y);
  }
  const style = panel(entity);
  return vector2(width + get_margin(style, 0) + get_margin(style, 2), height + get_margin(style, 1) + get_margin(style, 3));
}

/** `NOTIFICATION_SORT_CHILDREN` (`panel_container.cpp:78`). */
function sort(entity: Object3D): void {
  const size = get_size(entity);
  const style = panel(entity);
  const left = get_margin(style, 0);
  const top = get_margin(style, 1);
  for (const child of sortable(entity, 'visible-in-tree')) {
    fit_child_in_rect(entity, child, rect2(left, top, size.x - left - get_margin(style, 2), size.y - top - get_margin(style, 3)));
  }
}

const LAYERS = new WeakMap<Object3D, HTMLElement>();

/** `NOTIFICATION_DRAW` (`panel_container.cpp:73`): the panel over the whole rect, behind the children. */
function draw(entity: Object3D, element: HTMLElement): void {
  let layer = LAYERS.get(entity);
  if (layer === undefined) {
    layer = element.ownerDocument.createElement('div');
    layer.setAttribute('data-godot-content', '');
    layer.style.position = 'absolute';
    layer.style.inset = '0px';
    layer.style.pointerEvents = 'none';
    LAYERS.set(entity, layer);
  }
  if (layer.parentElement !== element) element.insertBefore(layer, element.firstChild);
  godot_style_box_paint(panel(entity), layer);
  layer.style.filter = godot_canvas_item_self_filter(entity, element);
}

function drawKey(entity: Object3D, element: HTMLElement): string {
  return `${godot_style_box_key(panel(entity))}|${godot_canvas_item_self_filter(entity, element)}`;
}

/**
 * @godot PanelContainer (protocol)
 * @source scene/gui/panel_container.cpp:71
 */
export function godot_panel_container_mount(entity: Object3D): void {
  godot_control_mount(entity, CLASSES.slice(0, -1), {
    minimumSize,
    desiredSize: minimumSize,
    sort,
    draw,
    drawKey,
    themeChanged: (container) => update_minimum_size(container),
  });
  // A PanelContainer stops the mouse (`PanelContainer::PanelContainer`, `panel_container.cpp:102`).
  set_mouse_filter(entity, 0);
}

/**
 * @godot PanelContainer.PanelContainer
 * @source scene/gui/panel_container.cpp:102
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_panel_container_mount(entity);
  return entity;
}

const PANEL_CONTAINER = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_panel_container_mount,
  props: new Map<string, GodotElementProp<Object3D>>(godot_control_props()),
};

/**
 * A PanelContainer as a scene writes it; its panel a theme override (`themeOverrides`).
 *
 * @godot PanelContainer (protocol)
 * @source scene/gui/panel_container.cpp:71
 */
export function GodotPanelContainer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(PANEL_CONTAINER, props);
}
