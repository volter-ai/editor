/**
 * @godot-class Container
 * @role PROTOCOL
 *
 * Godot 4.7's `Container` (`scene/gui/container.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Control that places its children. Godot queues a
 * sort (deferred) when a child is added, moved or removed, when a child's size flags, minimum size
 * or visibility changes, and when the container is resized; here the sort runs when a child's rect
 * is next read after any of what it reads has changed (`control.ts`).
 */

import type { Object3D } from 'three';
import { godot_node_entity } from './node';
import {
  godot_control_bound_desired_size,
  godot_control_is,
  godot_control_maximum_size,
  godot_control_queue_sort,
  godot_control_set_rect,
  get_combined_minimum_size,
  get_h_size_flags,
  get_v_size_flags,
  set_rotation,
  set_scale,
} from './control';
import { construct as rect2, type Rect2 } from './rect2';
import { construct as vector2 } from './vector2';

const f32 = Math.fround;

/** `Control::SizeFlags` (`scene/gui/control.h:79`). */
const SIZE_FILL = 1;
const SIZE_SHRINK_CENTER = 4;
const SIZE_SHRINK_END = 8;

/**
 * Places the child in the rect by its size flags: without `SIZE_FILL`, at its bound desired size
 * (at least its minimum, at most its maximum) at the begin, center (floored) or end of the rect;
 * then its rotation and scale are reset.
 *
 * @godot Container.fit_child_in_rect
 * @source scene/gui/container.cpp:109
 */
export function fit_child_in_rect(self: object, p_child: object, p_rect: Rect2): void {
  const child = godot_node_entity(p_child) as Object3D;
  if (child.parent !== godot_node_entity(self)) return;
  const minsize = get_combined_minimum_size(child);
  const desired = godot_control_bound_desired_size(child);
  const maxsize = godot_control_maximum_size(child);
  let x = p_rect.position.x;
  let y = p_rect.position.y;
  let width = p_rect.size.x;
  let height = p_rect.size.y;
  const hFlags = get_h_size_flags(child);
  const vFlags = get_v_size_flags(child);
  if ((hFlags & SIZE_FILL) === 0) {
    let finalWidth = f32(minsize.x);
    finalWidth = f32(Math.max(Math.min(desired.x, width), finalWidth));
    if (maxsize.x >= 0) finalWidth = f32(Math.min(finalWidth, maxsize.x));
    width = finalWidth;
    if ((hFlags & SIZE_SHRINK_END) !== 0) x = f32(x + f32(p_rect.size.x - finalWidth));
    else if ((hFlags & SIZE_SHRINK_CENTER) !== 0) x = f32(x + Math.floor(f32(f32(p_rect.size.x - finalWidth) / 2)));
  }
  if ((vFlags & SIZE_FILL) === 0) {
    let finalHeight = f32(minsize.y);
    finalHeight = f32(Math.max(Math.min(desired.y, height), finalHeight));
    if (maxsize.y >= 0) finalHeight = f32(Math.min(finalHeight, maxsize.y));
    height = finalHeight;
    if ((vFlags & SIZE_SHRINK_END) !== 0) y = f32(y + f32(p_rect.size.y - finalHeight));
    else if ((vFlags & SIZE_SHRINK_CENTER) !== 0) y = f32(y + Math.floor(f32(f32(p_rect.size.y - finalHeight) / 2)));
  }
  godot_control_set_rect(child, rect2(x, y, width, height));
  set_rotation(child, 0);
  set_scale(child, vector2(1, 1));
}

/**
 * @godot Container.queue_sort
 * @source scene/gui/container.cpp:156
 */
export function queue_sort(self: object): void {
  const entity = godot_node_entity(self) as Object3D;
  if (godot_control_is(entity, 'Container')) godot_control_queue_sort(entity);
}
