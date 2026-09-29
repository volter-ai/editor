/**
 * @godot-class GridContainer
 * @role BINDING
 *
 * Godot 4.7's `GridContainer` (`scene/gui/grid_container.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its children in rows of `columns`, each column as
 * wide as its widest child and each row as tall as its tallest, the space left shared by the columns
 * and rows whose children expand, with the theme's `h_separation` and `v_separation` (4 in the
 * default theme) between them, in Godot's integer pixels. Right-to-left layout is not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { fit_child_in_rect, queue_sort } from './container';
import { godot_control_mount, godot_control_props, godot_control_sortable, get_combined_minimum_size, get_h_size_flags, get_size, get_theme_constant, get_v_size_flags, set_mouse_filter, update_minimum_size } from './control';
import { godot_node_adopt, godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as rect2 } from './rect2';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['GridContainer', 'Container', 'Control', 'CanvasItem', 'Node', 'Object'];
/** `Control::SIZE_EXPAND` (`scene/gui/control.h:82`). */
const SIZE_EXPAND = 2;
const COLUMNS = new WeakMap<object, number>();

function columnsOf(entity: Object3D): number {
  return COLUMNS.get(entity) ?? 1;
}

function sortable(entity: Object3D, mode: 'visible' | 'visible-in-tree'): Object3D[] {
  return entity.children.flatMap((child) => {
    const found = godot_control_sortable(child, mode);
    return found === null ? [] : [found];
  });
}

/** `GridContainer::get_minimum_size` (`grid_container.cpp:273`). */
function minimumSize(entity: Object3D): Vector2 {
  const columns = columnsOf(entity);
  const colMinW = new Map<number, number>();
  const rowMinH = new Map<number, number>();
  let maxRow = 0;
  let maxCol = 0;
  sortable(entity, 'visible').forEach((child, index) => {
    const row = Math.trunc(index / columns);
    const col = index % columns;
    const ms = get_combined_minimum_size(child);
    colMinW.set(col, Math.max(colMinW.get(col) ?? Number.NEGATIVE_INFINITY, Math.trunc(ms.x)));
    rowMinH.set(row, Math.max(rowMinH.get(row) ?? Number.NEGATIVE_INFINITY, Math.trunc(ms.y)));
    maxCol = Math.max(col, maxCol);
    maxRow = Math.max(row, maxRow);
  });
  let width = 0;
  let height = 0;
  for (const value of colMinW.values()) width += value;
  for (const value of rowMinH.values()) height += value;
  return vector2(width + get_theme_constant(entity, 'h_separation') * maxCol, height + get_theme_constant(entity, 'v_separation') * maxRow);
}

/** Sheds the expanding line with the largest minimum until every one fits its share (`grid_container.cpp:106`). */
function fitExpanded(expanded: Set<number>, mins: Map<number, number>, remaining: number): number {
  let space = remaining;
  let canFit = false;
  while (!canFit && expanded.size > 0) {
    canFit = true;
    const ordered = [...expanded].sort((a, b) => a - b);
    let maxIndex = ordered[0] as number;
    for (const line of ordered) {
      if ((mins.get(line) ?? 0) > (mins.get(maxIndex) ?? 0)) maxIndex = line;
      if (canFit && space / expanded.size < (mins.get(line) ?? 0)) canFit = false;
    }
    if (!canFit) {
      expanded.delete(maxIndex);
      space -= mins.get(maxIndex) ?? 0;
    }
  }
  return space;
}

/** `NOTIFICATION_SORT_CHILDREN` (`grid_container.cpp:36`). */
function sort(entity: Object3D): void {
  const columns = columnsOf(entity);
  const hSep = get_theme_constant(entity, 'h_separation');
  const vSep = get_theme_constant(entity, 'v_separation');
  const children = sortable(entity, 'visible-in-tree');
  const colMinW = new Map<number, number>();
  const rowMinH = new Map<number, number>();
  const colExpanded = new Set<number>();
  const rowExpanded = new Set<number>();
  children.forEach((child, index) => {
    const row = Math.trunc(index / columns);
    const col = index % columns;
    const ms = get_combined_minimum_size(child);
    colMinW.set(col, Math.max(colMinW.get(col) ?? Number.NEGATIVE_INFINITY, Math.trunc(ms.x)));
    rowMinH.set(row, Math.max(rowMinH.get(row) ?? Number.NEGATIVE_INFINITY, Math.trunc(ms.y)));
    if ((get_h_size_flags(child) & SIZE_EXPAND) !== 0) colExpanded.add(col);
    if ((get_v_size_flags(child) & SIZE_EXPAND) !== 0) rowExpanded.add(row);
  });
  const count = children.length;
  const maxCol = Math.min(count, columns);
  const maxRow = Math.ceil(count / columns);
  for (let i = count; i < columns; i += 1) colExpanded.add(i);
  const size = get_size(entity);
  let width = size.x;
  let height = size.y;
  for (const [col, min] of colMinW) if (!colExpanded.has(col)) width -= min;
  for (const [row, min] of rowMinH) if (!rowExpanded.has(row)) height -= min;
  height -= vSep * Math.max(maxRow - 1, 0);
  width -= hSep * Math.max(maxCol - 1, 0);
  width = fitExpanded(colExpanded, colMinW, width);
  height = fitExpanded(rowExpanded, rowMinH, height);
  const colExpand = colExpanded.size > 0 ? Math.trunc(width / colExpanded.size) : 0;
  let colRemainingPixel = colExpanded.size > 0 ? Math.trunc(width - colExpanded.size * colExpand) : 0;
  const rowExpand = rowExpanded.size > 0 ? Math.trunc(height / rowExpanded.size) : 0;
  let rowRemainingPixel = rowExpanded.size > 0 ? Math.trunc(height - rowExpanded.size * rowExpand) : 0;
  let colRemainingIndex = 0;
  for (let i = 0; i < maxCol && colRemainingPixel !== 0; i += 1) {
    if (colExpanded.has(i)) {
      colRemainingIndex = i + 1;
      colRemainingPixel -= 1;
    }
  }
  let rowRemainingIndex = 0;
  for (let i = 0; i < maxRow && rowRemainingPixel !== 0; i += 1) {
    if (rowExpanded.has(i)) {
      rowRemainingIndex = i + 1;
      rowRemainingPixel -= 1;
    }
  }
  let colOfs = 0;
  let rowOfs = 0;
  children.forEach((child, index) => {
    const row = Math.trunc(index / columns);
    const col = index % columns;
    if (col === 0) {
      colOfs = 0;
      if (row > 0) {
        rowOfs += (rowExpanded.has(row - 1) ? rowExpand : (rowMinH.get(row - 1) ?? 0)) + vSep;
        if (rowExpanded.has(row - 1) && row - 1 < rowRemainingIndex) rowOfs += 1;
      }
    }
    let w = colExpanded.has(col) ? colExpand : (colMinW.get(col) ?? 0);
    let h = rowExpanded.has(row) ? rowExpand : (rowMinH.get(row) ?? 0);
    if (colExpanded.has(col) && col < colRemainingIndex) w += 1;
    if (rowExpanded.has(row) && row < rowRemainingIndex) h += 1;
    fit_child_in_rect(entity, child, rect2(colOfs, rowOfs, w, h));
    colOfs += w + hSep;
  });
}

/**
 * Makes `entity` a GridContainer of one column.
 *
 * @godot GridContainer (protocol)
 * @source scene/gui/grid_container.cpp:273
 */
export function godot_grid_container_mount(entity: Object3D): void {
  COLUMNS.set(entity, 1);
  godot_control_mount(entity, CLASSES.slice(0, -1), {
    minimumSize,
    desiredSize: minimumSize,
    sort,
    themeChanged: (container) => update_minimum_size(container),
    themeConstants: { h_separation: 4, v_separation: 4 },
  });
  set_mouse_filter(entity, 1);
}

/**
 * @godot GridContainer.GridContainer
 * @source scene/gui/grid_container.h:35
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_grid_container_mount(entity);
  return entity;
}

/**
 * Fewer than one column fails.
 *
 * @godot GridContainer.set_columns
 * @source scene/gui/grid_container.cpp:243
 */
export function set_columns(self: object, columns: number): void {
  const entity = godot_node_entity(self) as Object3D;
  if (columns < 1 || columnsOf(entity) === columns) return;
  COLUMNS.set(entity, columns);
  queue_sort(entity);
  update_minimum_size(entity);
}

/**
 * @godot GridContainer.get_columns
 * @source scene/gui/grid_container.cpp:255
 */
export function get_columns(self: object): number {
  return columnsOf(godot_node_entity(self) as Object3D);
}

const GRID_CONTAINER = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_grid_container_mount,
  props: new Map<string, GodotElementProp<Object3D>>([...godot_control_props(), ['columns', (entity, value: number) => set_columns(entity, value)]]),
};

/**
 * @godot GridContainer (protocol)
 * @source scene/gui/grid_container.cpp:263
 */
export function GodotGridContainer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(GRID_CONTAINER, props);
}
