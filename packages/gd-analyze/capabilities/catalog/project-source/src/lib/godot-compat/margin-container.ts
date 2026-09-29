/**
 * @godot-class MarginContainer
 * @role BINDING
 *
 * Godot 4.7's `MarginContainer` (`scene/gui/margin_container.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): each child fit to its rect less the theme's
 * `margin_left`, `margin_top`, `margin_right` and `margin_bottom` (0 in the default theme), its
 * minimum size the largest child's plus the margins.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { fit_child_in_rect } from './container';
import { godot_control_mount, godot_control_props, godot_control_sortable, get_combined_minimum_size, get_size, get_theme_constant, set_mouse_filter, update_minimum_size } from './control';
import { godot_node_adopt } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as rect2 } from './rect2';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['MarginContainer', 'Container', 'Control', 'CanvasItem', 'Node', 'Object'];

function margins(entity: Object3D): { left: number; top: number; right: number; bottom: number } {
  return {
    left: get_theme_constant(entity, 'margin_left'),
    top: get_theme_constant(entity, 'margin_top'),
    right: get_theme_constant(entity, 'margin_right'),
    bottom: get_theme_constant(entity, 'margin_bottom'),
  };
}

function sortable(entity: Object3D, mode: 'visible' | 'visible-in-tree'): Object3D[] {
  return entity.children.flatMap((child) => {
    const found = godot_control_sortable(child, mode);
    return found === null ? [] : [found];
  });
}

/** `MarginContainer::get_minimum_size` (`margin_container.cpp:33`). */
function minimumSize(entity: Object3D): Vector2 {
  let width = 0;
  let height = 0;
  for (const child of sortable(entity, 'visible')) {
    const size = get_combined_minimum_size(child);
    if (size.x > width) width = size.x;
    if (size.y > height) height = size.y;
  }
  const m = margins(entity);
  return vector2(width + m.left + m.right, height + m.top + m.bottom);
}

/** `NOTIFICATION_SORT_CHILDREN` (`margin_container.cpp:96`). */
function sort(entity: Object3D): void {
  const size = get_size(entity);
  const m = margins(entity);
  for (const child of sortable(entity, 'visible-in-tree')) {
    fit_child_in_rect(entity, child, rect2(m.left, m.top, Math.trunc(size.x - m.left - m.right), Math.trunc(size.y - m.top - m.bottom)));
  }
}

/**
 * Makes `entity` a MarginContainer.
 *
 * @godot MarginContainer (protocol)
 * @source scene/gui/margin_container.cpp:33
 */
export function godot_margin_container_mount(entity: Object3D): void {
  godot_control_mount(entity, CLASSES.slice(0, -1), {
    minimumSize,
    desiredSize: minimumSize,
    sort,
    themeChanged: (container) => update_minimum_size(container),
    themeConstants: { margin_left: 0, margin_top: 0, margin_right: 0, margin_bottom: 0 },
  });
  // All containers let the mouse pass (`Container::Container`, `container.cpp:280`).
  set_mouse_filter(entity, 1);
}

/**
 * A new MarginContainer (`MarginContainer.new()`).
 *
 * @godot MarginContainer.MarginContainer
 * @source scene/gui/margin_container.cpp:124
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_margin_container_mount(entity);
  return entity;
}

const MARGIN_CONTAINER = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_margin_container_mount,
  props: new Map<string, GodotElementProp<Object3D>>(godot_control_props()),
};

/**
 * A MarginContainer as a scene writes it; its margins are theme overrides (`themeOverrides`).
 *
 * @godot MarginContainer (protocol)
 * @source scene/gui/margin_container.cpp:117
 */
export function GodotMarginContainer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(MARGIN_CONTAINER, props);
}
