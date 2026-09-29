/**
 * @godot-class CenterContainer
 * @role BINDING
 *
 * Godot 4.7's `CenterContainer` (`scene/gui/center_container.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): each child at its minimum size, centred in the
 * container (or centred on its top-left corner with `use_top_left`), its minimum size the largest
 * child's (none with `use_top_left`).
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { fit_child_in_rect, queue_sort } from './container';
import { godot_control_mount, godot_control_props, godot_control_sortable, get_combined_minimum_size, get_size, set_mouse_filter, update_minimum_size } from './control';
import { godot_node_adopt, godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as rect2 } from './rect2';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['CenterContainer', 'Container', 'Control', 'CanvasItem', 'Node', 'Object'];
const TOP_LEFT = new WeakMap<object, boolean>();

function sortable(entity: Object3D, mode: 'visible' | 'visible-in-tree'): Object3D[] {
  return entity.children.flatMap((child) => {
    const found = godot_control_sortable(child, mode);
    return found === null ? [] : [found];
  });
}

/** `CenterContainer::get_minimum_size` (`center_container.cpp:33`). */
function minimumSize(entity: Object3D): Vector2 {
  if (TOP_LEFT.get(entity) === true) return vector2(0, 0);
  let width = 0;
  let height = 0;
  for (const child of sortable(entity, 'visible')) {
    const size = get_combined_minimum_size(child);
    width = Math.max(width, size.x);
    height = Math.max(height, size.y);
  }
  return vector2(width, height);
}

/** `NOTIFICATION_SORT_CHILDREN` (`center_container.cpp:75`). */
function sort(entity: Object3D): void {
  const size = get_size(entity);
  const topLeft = TOP_LEFT.get(entity) === true;
  for (const child of sortable(entity, 'visible-in-tree')) {
    const min = get_combined_minimum_size(child);
    const x = topLeft ? Math.floor(-min.x * 0.5) : Math.floor((size.x - min.x) / 2);
    const y = topLeft ? Math.floor(-min.y * 0.5) : Math.floor((size.y - min.y) / 2);
    fit_child_in_rect(entity, child, rect2(x, y, min.x, min.y));
  }
}

/**
 * Makes `entity` a CenterContainer.
 *
 * @godot CenterContainer (protocol)
 * @source scene/gui/center_container.cpp:33
 */
export function godot_center_container_mount(entity: Object3D): void {
  godot_control_mount(entity, CLASSES.slice(0, -1), {
    minimumSize,
    desiredSize: minimumSize,
    sort,
    themeChanged: (container) => update_minimum_size(container),
  });
  set_mouse_filter(entity, 1);
}

/**
 * @godot CenterContainer.CenterContainer
 * @source scene/gui/center_container.h:35
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_center_container_mount(entity);
  return entity;
}

/**
 * @godot CenterContainer.set_use_top_left
 * @source scene/gui/center_container.cpp:50
 */
export function set_use_top_left(self: object, enable: boolean): void {
  const entity = godot_node_entity(self) as Object3D;
  if ((TOP_LEFT.get(entity) === true) === enable) return;
  TOP_LEFT.set(entity, enable);
  update_minimum_size(entity);
  queue_sort(entity);
}

/**
 * @godot CenterContainer.is_using_top_left
 * @source scene/gui/center_container.cpp:61
 */
export function is_using_top_left(self: object): boolean {
  return TOP_LEFT.get(godot_node_entity(self)) === true;
}

const CENTER_CONTAINER = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_center_container_mount,
  props: new Map<string, GodotElementProp<Object3D>>([...godot_control_props(), ['useTopLeft', (entity, value: boolean) => set_use_top_left(entity, value)]]),
};

/**
 * @godot CenterContainer (protocol)
 * @source scene/gui/center_container.cpp:90
 */
export function GodotCenterContainer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(CENTER_CONTAINER, props);
}
