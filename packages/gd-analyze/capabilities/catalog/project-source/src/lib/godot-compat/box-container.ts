/**
 * @godot-class BoxContainer
 * @role PROTOCOL
 *
 * Godot 4.7's `BoxContainer` (`scene/gui/box_container.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its children in a row (or a column) with the theme's
 * `separation` between them, the stretch space shared by the children that expand in proportion to
 * their stretch ratios, in Godot's integer pixels (`_resort`), and its minimum size the children's
 * (`_get_minimum_size`). `propagate_maximum_size` and right-to-left layout are not bound.
 */

import type { Object3D } from 'three';
import { fit_child_in_rect } from './container';
import {
  godot_control_bound_desired_size,
  godot_control_bound_minimum_size,
  godot_control_maximum_size,
  godot_control_mount,
  godot_control_sortable,
  get_combined_minimum_size,
  get_h_size_flags,
  get_size,
  get_stretch_ratio,
  get_theme_constant,
  get_v_size_flags,
  set_mouse_filter,
  update_minimum_size,
} from './control';
import { godot_node_entity } from './node';
import { construct as rect2 } from './rect2';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

/** `Control::SIZE_EXPAND` (`scene/gui/control.h:82`). */
const SIZE_EXPAND = 2;

/** `BoxContainer::AlignmentMode` (`scene/gui/box_container.h:39`). */
const ALIGNMENT_BEGIN = 0;
const ALIGNMENT_CENTER = 1;
const ALIGNMENT_END = 2;

interface BoxState {
  vertical: boolean;
  alignment: number;
}

const BOXES = new WeakMap<Object3D, BoxState>();

/** `(int)` of a `real_t`, truncating toward zero. */
function int(value: number): number {
  return Math.trunc(value);
}

function childrenOf(entity: Object3D, mode: 'visible' | 'visible-in-tree'): Object3D[] {
  return entity.children.flatMap((child) => {
    const sortable = godot_control_sortable(child, mode);
    return sortable === null ? [] : [sortable];
  });
}

/**
 * `_get_minimum_size` (`box_container.cpp:291`): the children's bound minimum (or desired) sizes,
 * ceiled to integers, summed along the box with the separation between them.
 */
function minimumSize(entity: Object3D, desired: boolean): Vector2 {
  const state = BOXES.get(entity) as BoxState;
  const separation = get_theme_constant(entity, 'separation');
  let width = 0;
  let height = 0;
  let first = true;
  for (const child of childrenOf(entity, 'visible')) {
    const size = desired ? godot_control_bound_desired_size(child) : godot_control_bound_minimum_size(child);
    const w = Math.ceil(size.x);
    const h = Math.ceil(size.y);
    if (state.vertical) {
      if (w > width) width = w;
      height += h + (first ? 0 : separation);
    } else {
      if (h > height) height = h;
      width += w + (first ? 0 : separation);
    }
    first = false;
  }
  return vector2(width, height);
}

interface SizeCache {
  minSize: number;
  maxSize: number;
  willStretch: boolean;
  finalSize: number;
}

/** `_resort` (`box_container.cpp:45`). */
function resort(entity: Object3D): void {
  const state = BOXES.get(entity) as BoxState;
  const vertical = state.vertical;
  const separation = get_theme_constant(entity, 'separation');
  const size = get_size(entity);
  const newWidth = int(size.x);
  const newHeight = int(size.y);
  const children = childrenOf(entity, 'visible-in-tree');
  let stretchMin = 0;
  let stretchAvail = 0;
  let stretchRatioTotal = 0;
  const cache = new Map<Object3D, SizeCache>();
  for (const child of children) {
    const min = get_combined_minimum_size(child);
    const max = godot_control_maximum_size(child);
    const minSize = vertical ? Math.ceil(min.y) : Math.ceil(min.x);
    let maxSize = int(vertical ? max.y : max.x);
    const willStretch = ((vertical ? get_v_size_flags(child) : get_h_size_flags(child)) & SIZE_EXPAND) !== 0;
    stretchMin += minSize;
    if (maxSize >= 0 && maxSize < minSize) maxSize = minSize;
    if (willStretch) {
      stretchAvail += minSize;
      stretchRatioTotal = f32(stretchRatioTotal + get_stretch_ratio(child));
    }
    cache.set(child, { minSize, maxSize, willStretch, finalSize: minSize });
  }
  if (children.length === 0) return;
  const stretchMax = (vertical ? newHeight : newWidth) - (children.length - 1) * separation;
  let stretchDiff = stretchMax - stretchMin;
  if (stretchDiff < 0) stretchDiff = 0;
  stretchAvail += stretchDiff;
  while (stretchRatioTotal > 0) {
    let refit = true;
    let error = 0;
    for (const child of children) {
      const msc = cache.get(child) as SizeCache;
      if (!msc.willStretch) continue;
      const ratio = get_stretch_ratio(child);
      const finalPixelSize = f32(f32(stretchAvail * ratio) / stretchRatioTotal);
      error = f32(error + f32(finalPixelSize - int(finalPixelSize)));
      if (finalPixelSize < msc.minSize) {
        msc.willStretch = false;
        stretchRatioTotal = f32(stretchRatioTotal - ratio);
        refit = false;
        stretchAvail -= msc.minSize;
        msc.finalSize = msc.minSize;
        break;
      } else if (msc.maxSize >= 0 && finalPixelSize > msc.maxSize) {
        msc.willStretch = false;
        stretchRatioTotal = f32(stretchRatioTotal - ratio);
        refit = false;
        stretchAvail -= msc.maxSize;
        msc.finalSize = msc.maxSize;
        break;
      } else {
        msc.finalSize = int(finalPixelSize);
        if (error >= 1 && (msc.maxSize < 0 || msc.finalSize < msc.maxSize)) {
          msc.finalSize += 1;
          error = f32(error - 1);
        }
      }
    }
    if (refit) break;
  }
  let finalStretchDiff = stretchMax - stretchMin;
  for (const child of children) {
    const msc = cache.get(child) as SizeCache;
    finalStretchDiff -= msc.finalSize - msc.minSize;
  }
  if (finalStretchDiff < 0) finalStretchDiff = 0;
  let ofs = 0;
  if (state.alignment === ALIGNMENT_CENTER) ofs = int(finalStretchDiff / 2);
  else if (state.alignment === ALIGNMENT_END) ofs = finalStretchDiff;
  let first = true;
  children.forEach((child, index) => {
    const msc = cache.get(child) as SizeCache;
    if (first) first = false;
    else ofs += separation;
    const from = ofs;
    let to = ofs + msc.finalSize;
    if (msc.willStretch && index === children.length - 1) to = vertical ? newHeight : newWidth;
    const extent = to - from;
    fit_child_in_rect(entity, child, vertical ? rect2(0, from, newWidth, extent) : rect2(from, 0, extent, newHeight));
    ofs = to;
  });
}

/**
 * Makes `entity` a box container of `classes` (nearest first), horizontal unless `vertical`, with
 * the default theme's `separation` of 4 (`scene/theme/default_theme.cpp:1265`).
 *
 * @godot BoxContainer (protocol)
 * @source scene/gui/box_container.cpp:425
 */
export function godot_box_container_mount(entity: Object3D, classes: readonly string[], vertical: boolean): void {
  BOXES.set(entity, { vertical, alignment: ALIGNMENT_BEGIN });
  godot_control_mount(entity, classes, {
    minimumSize: (box) => minimumSize(box, false),
    desiredSize: (box) => minimumSize(box, true),
    sort: resort,
    // `NOTIFICATION_THEME_CHANGED` (`box_container.cpp:343`).
    themeChanged: (box) => update_minimum_size(box),
    themeConstants: { separation: 4 },
  });
  // All containers let the mouse pass (`Container::Container`, `container.cpp:280`).
  set_mouse_filter(entity, 1);
}

function stateOf(self: object, member: string): BoxState {
  const state = BOXES.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a BoxContainer`);
  return state;
}

/**
 * @godot BoxContainer.set_alignment
 * @source scene/gui/box_container.cpp:360
 */
export function set_alignment(self: object, p_alignment: number): void {
  const state = stateOf(self, 'set_alignment');
  if (state.alignment === p_alignment) return;
  state.alignment = p_alignment;
  resort(godot_node_entity(self) as Object3D);
}

/**
 * @godot BoxContainer.get_alignment
 * @source scene/gui/box_container.cpp:368
 */
export function get_alignment(self: object): number {
  return stateOf(self, 'get_alignment').alignment;
}

/**
 * @godot BoxContainer.is_vertical
 * @source scene/gui/box_container.cpp:379
 */
export function is_vertical(self: object): boolean {
  return stateOf(self, 'is_vertical').vertical;
}
