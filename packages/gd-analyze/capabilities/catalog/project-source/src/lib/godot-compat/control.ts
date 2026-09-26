/**
 * @godot-class Control
 * @role PROTOCOL
 *
 * Godot 4.7's `Control` layout (`scene/gui/control.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): anchors and offsets against the parent's anchorable
 * rect, grow directions, minimum and maximum sizes, the layout presets, position and size, and
 * the transform `rotation`, `scale` and `pivot_offset` make (`_get_internal_transform`), in single
 * precision. A Control is a canvas item (`canvas-item.ts`) whose `get_transform()` is this
 * layout's; the page draws it where the layout puts it (the DOM does no layout of its own).
 *
 * Godot keeps `pos_cache` and `size_cache` and refreshes them in `_size_changed`, which runs when an
 * anchor, offset or grow direction is set, when the parent item's rect changes (its
 * `item_rect_changed`), after the node enters the tree (`NOTIFICATION_POST_ENTER_TREE`, here on its
 * `tree_entered`), when the theme or visibility changes, and deferred when the minimum or maximum
 * size changes (`update_minimum_size`, `update_maximum_size`, on the message queue); so does this
 * module, at the same points. A container sorts its children deferred (`Container::queue_sort`)
 * when a child enters or leaves, a child's size flags, minimum size or visibility change, or the
 * container is resized.
 *
 * Not bound: right-to-left layout (a node's layout direction is the locale's, left to right),
 * `propagate_maximum_size`, the offset transform, and the desired size of classes that report one.
 */

import type { Object3D } from 'three';
import {
  get_global_transform,
  get_global_transform_with_canvas,
  get_transform,
  godot_canvas_item_canvas_transform,
  godot_canvas_item_is,
  godot_canvas_item_layer_number,
  godot_canvas_item_layer_of,
  godot_canvas_item_mount,
  godot_canvas_item_parent,
  is_set_as_top_level,
  is_visible,
  is_visible_in_tree,
} from './canvas-item';
import { godot_node_adopt, godot_node_entity, godot_node_tree_signal, is_inside_tree } from './node';
import { godot_message_queue_push } from './object';
import { construct as rect2, type Rect2 } from './rect2';
import { get_size as subViewportSize } from './sub-viewport';
import { get_size as windowSize, godot_window_has_size } from './window';
import { basis_xform, construct as transform2d, get_scale as transformScale, affine_inverse, op_multiply as xform, type Transform2D } from './transform-2d';
import { construct as vector2, type Vector2 } from './vector2';

const f32 = Math.fround;

/** `Side` (`core/math/math_defs.h:94`). */
const SIDE_LEFT = 0;
const SIDE_TOP = 1;
const SIDE_RIGHT = 2;
const SIDE_BOTTOM = 3;

/** `Control::GrowDirection` (`scene/gui/control.h:80`). */
const GROW_DIRECTION_BEGIN = 0;
const GROW_DIRECTION_END = 1;
const GROW_DIRECTION_BOTH = 2;

/** `Control::LayoutPreset` (`scene/gui/control.h:57`). */
const PRESET_TOP_LEFT = 0;
const PRESET_TOP_RIGHT = 1;
const PRESET_BOTTOM_LEFT = 2;
const PRESET_BOTTOM_RIGHT = 3;
const PRESET_CENTER_LEFT = 4;
const PRESET_CENTER_TOP = 5;
const PRESET_CENTER_RIGHT = 6;
const PRESET_CENTER_BOTTOM = 7;
const PRESET_CENTER = 8;
const PRESET_LEFT_WIDE = 9;
const PRESET_TOP_WIDE = 10;
const PRESET_RIGHT_WIDE = 11;
const PRESET_BOTTOM_WIDE = 12;
const PRESET_VCENTER_WIDE = 13;
const PRESET_HCENTER_WIDE = 14;
const PRESET_FULL_RECT = 15;

/** `Control::LayoutPresetMode` (`scene/gui/control.h:76`). */
const PRESET_MODE_MINSIZE = 0;
const PRESET_MODE_KEEP_WIDTH = 1;
const PRESET_MODE_KEEP_HEIGHT = 2;
const PRESET_MODE_KEEP_SIZE = 3;

/** `Control::MouseFilter` (`scene/gui/control.h:89`). */
const MOUSE_FILTER_STOP = 0;
const MOUSE_FILTER_IGNORE = 2;

/** `Control::LayoutMode` (`scene/gui/control.h:149`). */
const LAYOUT_MODE_POSITION = 0;
const LAYOUT_MODE_ANCHORS = 1;
const LAYOUT_MODE_CONTAINER = 2;
const LAYOUT_MODE_UNCONTROLLED = 3;

/** `CMP_EPSILON` (`core/math/math_defs.h:50`), as `real_t`. */
const CMP_EPSILON = f32(0.00001);

/** What a class deriving from Control computes itself (Godot's virtuals). */
export interface ControlVirtuals {
  /** `get_minimum_size()`; Control's own is zero. */
  readonly minimumSize?: (entity: Object3D) => Vector2;
  /** `get_desired_size()`; Control's own is zero. */
  readonly desiredSize?: (entity: Object3D) => Vector2;
  /** A container's children sort (`NOTIFICATION_SORT_CHILDREN`); a Control with one is a Container. */
  readonly sort?: (entity: Object3D) => void;
  /** The class's own `NOTIFICATION_RESIZED`, after Container's. */
  readonly resized?: (entity: Object3D) => void;
  /** The class's own `NOTIFICATION_THEME_CHANGED`, after Control's and Container's. */
  readonly themeChanged?: (entity: Object3D) => void;
  /** The default theme's constants for the class (`scene/theme/default_theme.cpp`). */
  readonly themeConstants?: Readonly<Record<string, number>>;
  /** `NOTIFICATION_DRAW`: the class's own drawing into its element. */
  readonly draw?: (entity: Object3D, element: HTMLElement) => void;
}

interface ControlState {
  readonly anchor: number[];
  readonly offset: number[];
  hGrow: number;
  vGrow: number;
  customMinimumSize: Vector2;
  customMaximumSize: Vector2;
  hSizeFlags: number;
  vSizeFlags: number;
  stretchRatio: number;
  rotation: number;
  scale: Vector2;
  pivotOffset: Vector2;
  readonly virtuals: ControlVirtuals;
  readonly constantOverrides: Map<string, number>;
  posCache: Vector2;
  sizeCache: Vector2;
  lastMinimumSize: Vector2;
  lastMaximumSize: Vector2;
  updatingLastMinimumSize: boolean;
  updatingLastMaximumSize: boolean;
  maximumSizeValid: boolean;
  pendingSort: boolean;
  mouseFilter: number;
  forcePassScrollEvents: boolean;
  /** `data.stored_layout_mode`, `data.stored_use_custom_anchors` (`control.h:222`). */
  storedLayoutMode: number;
  storedUseCustomAnchors: boolean;
  /** The script's `_gui_input` and the class's own `gui_input`. */
  guiInput: ((event: unknown) => void) | undefined;
  nativeGuiInput: ((event: unknown) => void) | undefined;
}

const CONTROLS = new WeakMap<Object3D, ControlState>();

function entityOf(self: object): Object3D {
  return godot_node_entity(self) as Object3D;
}

function stateOf(self: object, member = 'Control'): ControlState {
  const state = CONTROLS.get(entityOf(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Control`);
  return state;
}

/**
 * Makes `entity` a Control of `classes` (nearest first, `Control` and its ancestors included) with
 * Control's defaults (`scene/gui/control.h:222-275`): a node (`node.ts`), a canvas item placed by
 * this layout, and the class's virtuals.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:5161
 */
export function godot_control_mount(entity: Object3D, classes: readonly string[], virtuals: ControlVirtuals = {}): void {
  godot_node_adopt(entity, { kind: 'node', classes });
  godot_canvas_item_mount(entity, classes, {
    transform: godot_control_transform,
    drawTransform,
    size: (node) => (CONTROLS.get(node) as ControlState).sizeCache,
    visibilityChanged,
    ...(virtuals.draw === undefined ? {} : { draw: virtuals.draw }),
  });
  CONTROLS.set(entity, {
    anchor: [0, 0, 0, 0],
    offset: [0, 0, 0, 0],
    hGrow: GROW_DIRECTION_END,
    vGrow: GROW_DIRECTION_END,
    customMinimumSize: vector2(),
    customMaximumSize: vector2(-1, -1),
    hSizeFlags: 1,
    vSizeFlags: 1,
    stretchRatio: 1,
    rotation: 0,
    scale: vector2(1, 1),
    pivotOffset: vector2(),
    virtuals,
    constantOverrides: new Map(),
    posCache: vector2(),
    sizeCache: vector2(),
    lastMinimumSize: vector2(),
    lastMaximumSize: vector2(),
    updatingLastMinimumSize: false,
    updatingLastMaximumSize: false,
    maximumSizeValid: false,
    pendingSort: false,
    mouseFilter: MOUSE_FILTER_STOP,
    forcePassScrollEvents: true,
    storedLayoutMode: LAYOUT_MODE_POSITION,
    storedUseCustomAnchors: false,
    guiInput: undefined,
    nativeGuiInput: undefined,
  });
  godot_node_tree_signal(entity, 'tree_entered').connect(() => enteredTree(entity));
  godot_node_tree_signal(entity, 'tree_exiting').connect(() => exitingTree(entity));
}

/** The parent node's entity when it is a Container. */
function parentContainer(entity: Object3D): Object3D | null {
  const parent = entity.parent;
  return parent !== null && CONTROLS.get(parent)?.virtuals.sort !== undefined ? parent : null;
}

/**
 * `NOTIFICATION_ENTER_TREE`'s theme change (`set_theme_context`), `NOTIFICATION_POST_ENTER_TREE`
 * (`control.cpp:4518`: `update_maximum_size()`, `_size_changed()`), then the parent container's
 * `add_child_notify` (`container.cpp:46`: `update_minimum_size()`, `queue_sort()`).
 */
function enteredTree(entity: Object3D): void {
  // `NOTIFICATION_PARENTED`'s `_update_layout_mode` (`control.cpp:4493`), which the scene's parenting
  // precedes its entering the tree.
  const state = CONTROLS.get(entity) as ControlState;
  state.storedLayoutMode = computedLayoutMode(entity, state);
  themeChanged(entity);
  updateMaximumSize(entity);
  sizeChanged(entity);
  const container = parentContainer(entity);
  if (container !== null) {
    updateMinimumSize(container);
    queueSort(container);
  }
}

/** The parent container's `remove_child_notify` (`container.cpp:76`). */
function exitingTree(entity: Object3D): void {
  const container = parentContainer(entity);
  if (container !== null) {
    updateMinimumSize(container);
    queueSort(container);
  }
}

/**
 * `NOTIFICATION_THEME_CHANGED`: Control's (`control.cpp:4628`: `update_minimum_size()`,
 * `_size_changed()`), a Container's (`container.cpp:225`: `queue_sort()`), then the class's own.
 */
function themeChanged(entity: Object3D): void {
  const state = CONTROLS.get(entity) as ControlState;
  updateMinimumSize(entity);
  sizeChanged(entity);
  if (state.virtuals.sort !== undefined) queueSort(entity);
  state.virtuals.themeChanged?.(entity);
}

/**
 * `NOTIFICATION_VISIBILITY_CHANGED`: Control's (`control.cpp:4639`: when visible in the tree,
 * `update_maximum_size()` and `_size_changed()`), a Container's (`container.cpp:230`: when visible
 * in the tree, `queue_sort()`), then the `visibility_changed` signal a parent container listens to
 * (`_child_minsize_changed`, `container.cpp:37`).
 */
function visibilityChanged(entity: Object3D): void {
  const state = CONTROLS.get(entity) as ControlState;
  if (is_visible_in_tree(entity)) {
    updateMaximumSize(entity);
    sizeChanged(entity);
    if (state.virtuals.sort !== undefined) queueSort(entity);
  }
  const container = parentContainer(entity);
  if (container !== null) {
    updateMinimumSize(container);
    queueSort(container);
  }
}

/**
 * `Container::queue_sort` (`container.cpp:156`): inside the tree, one deferred `_sort_children`
 * (`container.cpp:94`), which sorts when the container is still inside the tree.
 */
function queueSort(entity: Object3D): void {
  const state = CONTROLS.get(entity) as ControlState;
  if (!is_inside_tree(entity) || state.pendingSort) return;
  state.pendingSort = true;
  godot_message_queue_push(entity, () => {
    if (is_inside_tree(entity)) state.virtuals.sort?.(entity);
    state.pendingSort = false;
  });
}

/**
 * `update_minimum_size` (`control.cpp:1888`): inside the tree, a node not visible in the tree forgets
 * its last minimum size; a visible one queues `_update_minimum_size` once (`control.cpp:1872`), which
 * reruns `_size_changed` and tells a parent container when the minimum size changed.
 */
function updateMinimumSize(entity: Object3D): void {
  const state = CONTROLS.get(entity) as ControlState;
  if (!is_inside_tree(entity)) return;
  if (!is_visible_in_tree(entity)) {
    state.lastMinimumSize = vector2(-1, -1);
    return;
  }
  if (state.updatingLastMinimumSize) return;
  state.updatingLastMinimumSize = true;
  godot_message_queue_push(entity, () => updateMinimumSizeNow(entity));
}

function updateMinimumSizeNow(entity: Object3D): void {
  const state = CONTROLS.get(entity) as ControlState;
  if (!is_inside_tree(entity)) {
    state.updatingLastMinimumSize = false;
    return;
  }
  const minsize = get_combined_minimum_size(entity);
  state.updatingLastMinimumSize = false;
  if (minsize.x !== state.lastMinimumSize.x || minsize.y !== state.lastMinimumSize.y) {
    state.lastMinimumSize = minsize;
    sizeChanged(entity);
    const container = parentContainer(entity);
    if (container !== null) {
      updateMinimumSize(container);
      queueSort(container);
    }
  }
}

/**
 * `update_maximum_size` (`control.cpp:1732`): inside the tree, the maximum cache is invalid and each
 * child Control whose cache is valid updates too; a node visible in the tree queues
 * `_update_minimum_size` (unless queued) and `_update_maximum_size` (`control.cpp:1716`) once.
 */
function updateMaximumSize(entity: Object3D): void {
  const state = CONTROLS.get(entity) as ControlState;
  if (!is_inside_tree(entity)) return;
  state.maximumSizeValid = false;
  for (const child of [...entity.children]) {
    const childState = CONTROLS.get(child);
    if (childState !== undefined && !is_set_as_top_level(child) && childState.maximumSizeValid) updateMaximumSize(child);
  }
  if (!is_visible_in_tree(entity)) {
    state.lastMaximumSize = vector2(-1, -1);
    return;
  }
  if (state.updatingLastMaximumSize) return;
  state.updatingLastMaximumSize = true;
  if (!state.updatingLastMinimumSize) {
    state.updatingLastMinimumSize = true;
    godot_message_queue_push(entity, () => updateMinimumSizeNow(entity));
  }
  godot_message_queue_push(entity, () => {
    if (!is_inside_tree(entity)) {
      state.updatingLastMaximumSize = false;
      return;
    }
    const maxsize = combinedMaximumSize(state);
    state.updatingLastMaximumSize = false;
    if (maxsize.x !== state.lastMaximumSize.x || maxsize.y !== state.lastMaximumSize.y) {
      state.lastMaximumSize = maxsize;
      sizeChanged(entity);
      const container = parentContainer(entity);
      if (container !== null) {
        updateMinimumSize(container);
        queueSort(container);
      }
    }
  });
}

/**
 * The viewport a node draws in: its nearest three `Scene` ancestor (a `SubViewport`, or the root).
 */
function viewportOf(entity: Object3D): Object3D | null {
  for (let node = entity.parent; node !== null; node = node.parent) {
    if ((node as { readonly isScene?: boolean }).isScene === true) return node;
  }
  return null;
}

/**
 * `get_parent_anchorable_rect` (`control.cpp:708`): the parent canvas item's anchorable rect (a
 * Control's is `(0, 0, size)`, any other item's is empty), else the viewport's visible rect;
 * empty outside the tree.
 */
function parentAnchorableRect(entity: Object3D): Rect2 {
  if (!is_inside_tree(entity)) return rect2();
  const parent = godot_canvas_item_parent(entity);
  if (parent !== null) return CONTROLS.has(parent) ? rect2(vector2(), (CONTROLS.get(parent) as ControlState).sizeCache) : rect2();
  const viewport = viewportOf(entity);
  if (viewport === null) return rect2();
  const size = godot_window_has_size(viewport) ? windowSize(viewport) : subViewportSize(viewport);
  return rect2(0, 0, size.x, size.y);
}

/**
 * `get_minimum_size()` (the class's) grown to the custom minimum size.
 *
 * @godot Control.get_combined_minimum_size
 * @source scene/gui/control.cpp:2137
 */
export function get_combined_minimum_size(self: object): Vector2 {
  const state = stateOf(self, 'get_combined_minimum_size');
  const own = get_minimum_size(self);
  return vector2(Math.max(own.x, state.customMinimumSize.x), Math.max(own.y, state.customMinimumSize.y));
}

/**
 * @godot Control.get_minimum_size
 * @source scene/gui/control.cpp:1930
 */
export function get_minimum_size(self: object): Vector2 {
  const state = stateOf(self, 'get_minimum_size');
  return state.virtuals.minimumSize?.(entityOf(self)) ?? vector2();
}

/**
 * The class's maximum size (none) capped by the custom maximum size (`_update_maximum_size_cache`,
 * `control.cpp:1816`); a component below zero is no maximum.
 */
function combinedMaximumSize(state: ControlState): Vector2 {
  state.maximumSizeValid = true;
  return state.customMaximumSize;
}

/** `Math::is_equal_approx` for `float` (`core/math/math_funcs.h:540`). */
function equalApprox(left: number, right: number): boolean {
  if (left === right) return true;
  let tolerance = f32(CMP_EPSILON * Math.abs(left));
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(f32(left - right)) < tolerance;
}

/**
 * `_size_changed` (`control.cpp:2160`): the new rect into the caches; inside the tree, a rect that
 * changed (approximately) is announced to the child Controls placed in it (`item_rect_changed`,
 * each child's `_size_changed`), and a changed size resizes a container (`NOTIFICATION_RESIZED`,
 * `queue_sort()`).
 */
function sizeChanged(entity: Object3D): void {
  const state = CONTROLS.get(entity) as ControlState;
  const { position, size } = computeRect(entity);
  const approxPos = !(equalApprox(position.x, state.posCache.x) && equalApprox(position.y, state.posCache.y));
  const approxSize = !(equalApprox(size.x, state.sizeCache.x) && equalApprox(size.y, state.sizeCache.y));
  state.posCache = position;
  state.sizeCache = size;
  if (!is_inside_tree(entity) || !(approxPos || approxSize)) return;
  for (const child of [...entity.children]) {
    if (CONTROLS.has(child) && godot_canvas_item_parent(child) === entity && is_inside_tree(child)) sizeChanged(child);
  }
  if (!approxSize) return;
  if (state.virtuals.sort !== undefined) queueSort(entity);
  state.virtuals.resized?.(entity);
}

/**
 * The rect `_size_changed` computes: the edges from the offsets and the anchors times the parent
 * rect, the size raised to the minimum and lowered to the maximum, moving by the grow direction.
 */
function computeRect(entity: Object3D): { readonly position: Vector2; readonly size: Vector2 } {
  const state = CONTROLS.get(entity) as ControlState;
  const parentRect = parentAnchorableRect(entity);
  const area = [parentRect.size.x, parentRect.size.y];
  const edge = state.offset.map((offset, index) => f32(offset + f32((state.anchor[index] as number) * (area[index & 1] as number))));
  let posX = edge[0] as number;
  let posY = edge[1] as number;
  let width = f32((edge[2] as number) - posX);
  let height = f32((edge[3] as number) - posY);
  const maximum = combinedMaximumSize(state);
  const minimum = get_combined_minimum_size(entity);
  if (minimum.x > width) {
    if (state.hGrow === GROW_DIRECTION_BEGIN) posX = f32(posX + f32(width - minimum.x));
    else if (state.hGrow === GROW_DIRECTION_BOTH) posX = f32(posX + f32(0.5 * f32(width - minimum.x)));
    width = minimum.x;
  }
  if (maximum.x >= 0 && maximum.x < width) {
    if (state.hGrow === GROW_DIRECTION_BEGIN) posX = f32(posX + f32(width - maximum.x));
    else if (state.hGrow === GROW_DIRECTION_BOTH) posX = f32(posX + f32(0.5 * f32(width - maximum.x)));
    width = maximum.x;
  }
  if (minimum.y > height) {
    if (state.vGrow === GROW_DIRECTION_BEGIN) posY = f32(posY + f32(height - minimum.y));
    else if (state.vGrow === GROW_DIRECTION_BOTH) posY = f32(posY + f32(0.5 * f32(height - minimum.y)));
    height = minimum.y;
  }
  if (maximum.y >= 0 && maximum.y < height) {
    if (state.vGrow === GROW_DIRECTION_BEGIN) posY = f32(posY + f32(height - maximum.y));
    else if (state.vGrow === GROW_DIRECTION_BOTH) posY = f32(posY + f32(0.5 * f32(height - maximum.y)));
    height = maximum.y;
  }
  return { position: vector2(posX, posY), size: vector2(width, height) };
}

/** `_compute_offsets` (`control.cpp:936`): the offsets that place `rect` under the anchors. */
function computeOffsets(entity: Object3D, state: ControlState, rect: Rect2): void {
  const parent = parentAnchorableRect(entity).size;
  const x = rect.position.x;
  state.offset[0] = f32(x - f32((state.anchor[0] as number) * parent.x));
  state.offset[1] = f32(rect.position.y - f32((state.anchor[1] as number) * parent.y));
  state.offset[2] = f32(f32(x + rect.size.x) - f32((state.anchor[2] as number) * parent.x));
  state.offset[3] = f32(f32(rect.position.y + rect.size.y) - f32((state.anchor[3] as number) * parent.y));
}

/**
 * `_compute_anchors` (`control.cpp:921`): the anchors that place `rect` under the offsets; a parent
 * of zero width or height fails and leaves them.
 */
function computeAnchors(entity: Object3D, state: ControlState, rect: Rect2): void {
  const parent = parentAnchorableRect(entity).size;
  if (parent.x === 0 || parent.y === 0) return;
  const x = rect.position.x;
  state.anchor[0] = f32(f32(x - (state.offset[0] as number)) / parent.x);
  state.anchor[1] = f32(f32(rect.position.y - (state.offset[1] as number)) / parent.y);
  state.anchor[2] = f32(f32(f32(x + rect.size.x) - (state.offset[2] as number)) / parent.x);
  state.anchor[3] = f32(f32(f32(rect.position.y + rect.size.y) - (state.offset[3] as number)) / parent.y);
}

/**
 * Keeps the edge where it is unless `p_keep_offset`; an anchor passing its opposite pushes it (or,
 * without `p_push_opposite_anchor`, stops at it).
 *
 * @godot Control.set_anchor
 * @source scene/gui/control.cpp:790
 */
export function set_anchor(self: object, p_side: number, p_anchor: number, p_keep_offset = false, p_push_opposite_anchor = true): void {
  if (p_side < 0 || p_side > 3) return;
  const entity = entityOf(self);
  const state = stateOf(self, 'set_anchor');
  const parent = parentAnchorableRect(entity);
  const range = p_side === SIDE_LEFT || p_side === SIDE_RIGHT ? parent.size.x : parent.size.y;
  const opposite = (p_side + 2) % 4;
  const previous = f32((state.offset[p_side] as number) + f32((state.anchor[p_side] as number) * range));
  const previousOpposite = f32((state.offset[opposite] as number) + f32((state.anchor[opposite] as number) * range));
  state.anchor[p_side] = f32(p_anchor);
  const anchor = state.anchor[p_side] as number;
  const other = state.anchor[opposite] as number;
  if (((p_side === SIDE_LEFT || p_side === SIDE_TOP) && anchor > other) || ((p_side === SIDE_RIGHT || p_side === SIDE_BOTTOM) && anchor < other)) {
    if (p_push_opposite_anchor) state.anchor[opposite] = anchor;
    else state.anchor[p_side] = other;
  }
  if (!p_keep_offset) {
    state.offset[p_side] = f32(previous - f32((state.anchor[p_side] as number) * range));
    if (p_push_opposite_anchor) state.offset[opposite] = f32(previousOpposite - f32((state.anchor[opposite] as number) * range));
  }
  if (is_inside_tree(entity)) sizeChanged(entity);
}

/**
 * @godot Control.get_anchor
 * @source scene/gui/control.cpp:823
 */
export function get_anchor(self: object, p_side: number): number {
  if (p_side < 0 || p_side > 3) return 0;
  return stateOf(self, 'get_anchor').anchor[p_side] as number;
}

/**
 * @godot Control.set_offset
 * @source scene/gui/control.cpp:830
 */
export function set_offset(self: object, p_side: number, p_value: number): void {
  if (p_side < 0 || p_side > 3) return;
  const state = stateOf(self, 'set_offset');
  if (state.offset[p_side] === f32(p_value)) return;
  state.offset[p_side] = f32(p_value);
  sizeChanged(entityOf(self));
}

/**
 * @godot Control.get_offset
 * @source scene/gui/control.cpp:841
 */
export function get_offset(self: object, p_offset: number): number {
  if (p_offset < 0 || p_offset > 3) return 0;
  return stateOf(self, 'get_offset').offset[p_offset] as number;
}

/**
 * @godot Control.set_anchor_and_offset
 * @source scene/gui/control.cpp:848
 */
export function set_anchor_and_offset(self: object, p_side: number, p_anchor: number, p_offset: number, p_push_opposite_anchor = false): void {
  set_anchor(self, p_side, p_anchor, false, p_push_opposite_anchor);
  set_offset(self, p_side, p_offset);
}

/**
 * @godot Control.set_begin
 * @source scene/gui/control.cpp:854
 */
export function set_begin(self: object, p_point: Vector2): void {
  if (!Number.isFinite(p_point.x) || !Number.isFinite(p_point.y)) return;
  const state = stateOf(self, 'set_begin');
  if (state.offset[0] === p_point.x && state.offset[1] === p_point.y) return;
  state.offset[0] = p_point.x;
  state.offset[1] = p_point.y;
  sizeChanged(entityOf(self));
}

/**
 * @godot Control.get_begin
 * @source scene/gui/control.cpp:866
 */
export function get_begin(self: object): Vector2 {
  const state = stateOf(self, 'get_begin');
  return vector2(state.offset[0] as number, state.offset[1] as number);
}

/**
 * @godot Control.set_end
 * @source scene/gui/control.cpp:871
 */
export function set_end(self: object, p_point: Vector2): void {
  const state = stateOf(self, 'set_end');
  if (state.offset[2] === p_point.x && state.offset[3] === p_point.y) return;
  state.offset[2] = p_point.x;
  state.offset[3] = p_point.y;
  sizeChanged(entityOf(self));
}

/**
 * @godot Control.get_end
 * @source scene/gui/control.cpp:882
 */
export function get_end(self: object): Vector2 {
  const state = stateOf(self, 'get_end');
  return vector2(state.offset[2] as number, state.offset[3] as number);
}

/**
 * @godot Control.set_h_grow_direction
 * @source scene/gui/control.cpp:887
 */
export function set_h_grow_direction(self: object, p_direction: number): void {
  const state = stateOf(self, 'set_h_grow_direction');
  if (state.hGrow === p_direction || p_direction < 0 || p_direction > 2) return;
  state.hGrow = p_direction;
  sizeChanged(entityOf(self));
}

/**
 * @godot Control.get_h_grow_direction
 * @source scene/gui/control.cpp:899
 */
export function get_h_grow_direction(self: object): number {
  return stateOf(self, 'get_h_grow_direction').hGrow;
}

/**
 * @godot Control.set_v_grow_direction
 * @source scene/gui/control.cpp:904
 */
export function set_v_grow_direction(self: object, p_direction: number): void {
  const state = stateOf(self, 'set_v_grow_direction');
  if (state.vGrow === p_direction || p_direction < 0 || p_direction > 2) return;
  state.vGrow = p_direction;
  sizeChanged(entityOf(self));
}

/**
 * @godot Control.get_v_grow_direction
 * @source scene/gui/control.cpp:916
 */
export function get_v_grow_direction(self: object): number {
  return stateOf(self, 'get_v_grow_direction').vGrow;
}

const LEFT_BEGIN = [PRESET_TOP_LEFT, PRESET_BOTTOM_LEFT, PRESET_CENTER_LEFT, PRESET_TOP_WIDE, PRESET_BOTTOM_WIDE, PRESET_LEFT_WIDE, PRESET_HCENTER_WIDE, PRESET_FULL_RECT];
const LEFT_CENTER = [PRESET_CENTER_TOP, PRESET_CENTER_BOTTOM, PRESET_CENTER, PRESET_VCENTER_WIDE];
const TOP_BEGIN = [PRESET_TOP_LEFT, PRESET_TOP_RIGHT, PRESET_CENTER_TOP, PRESET_LEFT_WIDE, PRESET_RIGHT_WIDE, PRESET_TOP_WIDE, PRESET_VCENTER_WIDE, PRESET_FULL_RECT];
const TOP_CENTER = [PRESET_CENTER_LEFT, PRESET_CENTER_RIGHT, PRESET_CENTER, PRESET_HCENTER_WIDE];
const RIGHT_BEGIN = [PRESET_TOP_LEFT, PRESET_BOTTOM_LEFT, PRESET_CENTER_LEFT, PRESET_LEFT_WIDE];
const RIGHT_CENTER = [PRESET_CENTER_TOP, PRESET_CENTER_BOTTOM, PRESET_CENTER, PRESET_VCENTER_WIDE];
const BOTTOM_BEGIN = [PRESET_TOP_LEFT, PRESET_TOP_RIGHT, PRESET_CENTER_TOP, PRESET_TOP_WIDE];
const BOTTOM_CENTER = [PRESET_CENTER_LEFT, PRESET_CENTER_RIGHT, PRESET_CENTER, PRESET_HCENTER_WIDE];

/** Which of begin (0), center (1) or end (2) a preset puts a side at. */
function presetPlace(preset: number, begin: readonly number[], center: readonly number[]): 0 | 1 | 2 {
  if (begin.includes(preset)) return 0;
  if (center.includes(preset)) return 1;
  return 2;
}

const ANCHOR_OF = [0, 0.5, 1] as const;

/**
 * Each side's anchor by the preset (`set_anchor(side, ..., p_keep_offsets)`).
 *
 * @godot Control.set_anchors_preset
 * @source scene/gui/control.cpp:1146
 */
export function set_anchors_preset(self: object, p_preset: number, p_keep_offsets = false): void {
  if (p_preset < 0 || p_preset >= 16) return;
  set_anchor(self, SIDE_LEFT, ANCHOR_OF[presetPlace(p_preset, LEFT_BEGIN, LEFT_CENTER)], p_keep_offsets);
  set_anchor(self, SIDE_TOP, ANCHOR_OF[presetPlace(p_preset, TOP_BEGIN, TOP_CENTER)], p_keep_offsets);
  set_anchor(self, SIDE_RIGHT, ANCHOR_OF[presetPlace(p_preset, RIGHT_BEGIN, RIGHT_CENTER)], p_keep_offsets);
  set_anchor(self, SIDE_BOTTOM, ANCHOR_OF[presetPlace(p_preset, BOTTOM_BEGIN, BOTTOM_CENTER)], p_keep_offsets);
}

/**
 * The offsets that put the node, at its size or (by `p_resize_mode`) its minimum size, where the
 * preset says within the parent rect, `p_margin` in from the edges.
 *
 * @godot Control.set_offsets_preset
 * @source scene/gui/control.cpp:1263
 */
export function set_offsets_preset(self: object, p_preset: number, p_resize_mode = 0, p_margin = 0): void {
  if (p_preset < 0 || p_preset >= 16 || p_resize_mode < 0 || p_resize_mode >= 4) return;
  const entity = entityOf(self);
  const state = stateOf(self, 'set_offsets_preset');
  const minSize = get_minimum_size(self);
  let newX = (CONTROLS.get(entity) as ControlState).sizeCache.x;
  let newY = (CONTROLS.get(entity) as ControlState).sizeCache.y;
  if (p_resize_mode === PRESET_MODE_MINSIZE || p_resize_mode === PRESET_MODE_KEEP_HEIGHT) newX = minSize.x;
  if (p_resize_mode === PRESET_MODE_MINSIZE || p_resize_mode === PRESET_MODE_KEEP_WIDTH) newY = minSize.y;
  const parent = parentAnchorableRect(entity);
  const x = parent.size.x;
  const y = parent.size.y;
  state.offset[0] = presetOffset(presetPlace(p_preset, LEFT_BEGIN, LEFT_CENTER), x, state.anchor[0] as number, newX, p_margin, parent.position.x, false);
  state.offset[1] = presetOffset(presetPlace(p_preset, TOP_BEGIN, TOP_CENTER), y, state.anchor[1] as number, newY, p_margin, parent.position.y, false);
  state.offset[2] = presetOffset(presetPlace(p_preset, RIGHT_BEGIN, RIGHT_CENTER), x, state.anchor[2] as number, newX, p_margin, parent.position.x, true);
  state.offset[3] = presetOffset(presetPlace(p_preset, BOTTOM_BEGIN, BOTTOM_CENTER), y, state.anchor[3] as number, newY, p_margin, parent.position.y, true);
  sizeChanged(entity);
}

/**
 * One offset of `set_offsets_preset` (`control.cpp:1283-1394`). The anchor term's constant is a
 * double literal (`x * (0.0 - anchor)`), so each expression is evaluated in double and stored as
 * `real_t`; `size / 2` is a `real_t` division. At the begin edge (left, top) the node starts
 * `margin` in from where the preset puts it; at the end edge (right, bottom) it ends there.
 */
function presetOffset(place: 0 | 1 | 2, extent: number, anchor: number, size: number, margin: number, origin: number, end: boolean): number {
  if (place === 0) return f32(extent * (0 - anchor) + (end ? size : 0) + margin + origin);
  if (place === 1) return f32(extent * (0.5 - anchor) + (end ? f32(size / 2) : -f32(size / 2)) + origin);
  return f32(extent * (1 - anchor) - (end ? 0 : size) - margin + origin);
}

/**
 * @godot Control.set_anchors_and_offsets_preset
 * @source scene/gui/control.cpp:1399
 */
export function set_anchors_and_offsets_preset(self: object, p_preset: number, p_resize_mode = 0, p_margin = 0): void {
  set_anchors_preset(self, p_preset);
  set_offsets_preset(self, p_preset, p_resize_mode, p_margin);
}

/**
 * Each grow direction by the preset (`Control::set_grow_direction_preset`).
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:1405
 */
export function godot_control_grow_direction_preset(self: object, p_preset: number): void {
  const h = [PRESET_TOP_LEFT, PRESET_BOTTOM_LEFT, PRESET_CENTER_LEFT, PRESET_LEFT_WIDE].includes(p_preset)
    ? GROW_DIRECTION_END
    : [PRESET_TOP_RIGHT, PRESET_BOTTOM_RIGHT, PRESET_CENTER_RIGHT, PRESET_RIGHT_WIDE].includes(p_preset)
      ? GROW_DIRECTION_BEGIN
      : GROW_DIRECTION_BOTH;
  const v = [PRESET_TOP_LEFT, PRESET_TOP_RIGHT, PRESET_CENTER_TOP, PRESET_TOP_WIDE].includes(p_preset)
    ? GROW_DIRECTION_END
    : [PRESET_BOTTOM_LEFT, PRESET_BOTTOM_RIGHT, PRESET_CENTER_BOTTOM, PRESET_BOTTOM_WIDE].includes(p_preset)
      ? GROW_DIRECTION_BEGIN
      : GROW_DIRECTION_BOTH;
  set_h_grow_direction(self, h);
  set_v_grow_direction(self, v);
}

/**
 * The offsets (or, with `p_keep_offsets`, the anchors) that move the node to `p_point` at its size.
 *
 * @godot Control.set_position
 * @source scene/gui/control.cpp:1468
 */
export function set_position(self: object, p_point: Vector2, p_keep_offsets = false): void {
  const entity = entityOf(self);
  const state = stateOf(self, 'set_position');
  const rect = rect2(p_point, (CONTROLS.get(entity) as ControlState).sizeCache);
  if (p_keep_offsets) computeAnchors(entity, state, rect);
  else computeOffsets(entity, state, rect);
  sizeChanged(entity);
}

/**
 * @godot Control.get_position
 * @source scene/gui/control.cpp:1487
 */
export function get_position(self: object): Vector2 {
  return stateOf(self, 'get_position').posCache;
}

/**
 * The size raised to the combined minimum and lowered to the maximum, then the offsets (or, with
 * `p_keep_offsets`, the anchors) that give it at the node's position.
 *
 * @godot Control.set_size
 * @source scene/gui/control.cpp:1525
 */
export function set_size(self: object, p_size: Vector2, p_keep_offsets = false): void {
  if (!Number.isFinite(p_size.x) || !Number.isFinite(p_size.y)) return;
  const entity = entityOf(self);
  const state = stateOf(self, 'set_size');
  let width = p_size.x;
  let height = p_size.y;
  const min = get_combined_minimum_size(self);
  if (width < min.x) width = min.x;
  if (height < min.y) height = min.y;
  const max = combinedMaximumSize(state);
  if (max.x >= 0 && width > max.x) width = max.x;
  if (max.y >= 0 && height > max.y) height = max.y;
  const rect = rect2((CONTROLS.get(entity) as ControlState).posCache, vector2(width, height));
  if (p_keep_offsets) computeAnchors(entity, state, rect);
  else computeOffsets(entity, state, rect);
  sizeChanged(entity);
}

/**
 * @godot Control.get_size
 * @source scene/gui/control.cpp:1563
 */
export function get_size(self: object): Vector2 {
  return stateOf(self, 'get_size').sizeCache;
}

/**
 * @godot Control.reset_size
 * @source scene/gui/control.cpp:1568
 */
export function reset_size(self: object): void {
  set_size(self, vector2());
}

/**
 * All anchors to the top-left, and the offsets that place `p_rect` (`Control::set_rect`), as a
 * container's `fit_child_in_rect` sets them.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:1573
 */
export function godot_control_set_rect(self: object, p_rect: Rect2): void {
  const entity = entityOf(self);
  const state = stateOf(self, 'set_rect');
  for (let side = 0; side < 4; side += 1) state.anchor[side] = 0;
  computeOffsets(entity, state, p_rect);
  if (is_inside_tree(entity)) sizeChanged(entity);
}

/**
 * `T(pivot) * R(rotation) * S(scale) * T(-pivot)` (`_get_internal_transform`,
 * `control.cpp:743`), built as `Transform2D(rotation, scale, 0, pivot)` then `translate_local`.
 */
function internalTransform(entity: Object3D, state: ControlState): Transform2D {
  const pivot = state.pivotOffset;
  const base = transform2d(state.rotation, state.scale, 0, pivot);
  const moved = basis_xform(base, vector2(-pivot.x, -pivot.y));
  return transform2d(base.x, base.y, vector2(f32(base.origin.x + moved.x), f32(base.origin.y + moved.y)));
}

/**
 * The internal transform moved by the position (`Control::get_transform`), which CanvasItem's
 * `get_transform` returns for a Control.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:771
 */
export function godot_control_transform(self: object): Transform2D {
  const entity = entityOf(self);
  const state = stateOf(self, 'get_transform');
  const internal = internalTransform(entity, state);
  const position = (CONTROLS.get(entity) as ControlState).posCache;
  return transform2d(internal.x, internal.y, vector2(f32(internal.origin.x + position.x), f32(internal.origin.y + position.y)));
}

/**
 * `_update_canvas_item_transform` (`control.cpp:755`): the transform the node draws with, its origin
 * snapped to whole pixels (`floor(origin + 0.5)`) when it is not rotated off a quarter turn, as the
 * viewport's `snap_controls_to_pixels` (on by default, `scene/main/viewport.h:274`) asks.
 */
function drawTransform(entity: Object3D): Transform2D {
  const transform = godot_control_transform(entity);
  const state = CONTROLS.get(entity) as ControlState;
  if (!is_inside_tree(entity) || !(Math.abs(f32(Math.sin(f32(state.rotation * 4)))) < f32(0.00001))) return transform;
  return transform2d(transform.x, transform.y, vector2(Math.floor(f32(transform.origin.x + 0.5)), Math.floor(f32(transform.origin.y + 0.5))));
}

/**
 * @godot Control.get_rect
 * @source scene/gui/control.cpp:1585
 */
export function get_rect(self: object): Rect2 {
  const transform = godot_control_transform(self);
  const scale = transformScale(transform);
  const size = get_size(self);
  return rect2(transform.origin, vector2(f32(scale.x * size.x), f32(scale.y * size.y)));
}

/**
 * The global transform's origin, and its scale times the size.
 *
 * @godot Control.get_global_rect
 * @source scene/gui/control.cpp:1591
 */
export function get_global_rect(self: object): Rect2 {
  const transform = get_global_transform(self);
  const scale = transformScale(transform);
  const size = get_size(self);
  return rect2(transform.origin, vector2(f32(scale.x * size.x), f32(scale.y * size.y)));
}

/**
 * @godot Control.get_global_position
 * @source scene/gui/control.cpp:1505
 */
export function get_global_position(self: object): Vector2 {
  return get_global_transform(self).origin;
}

/**
 * The point in the parent item's space (its global transform inverted), less the internal
 * transform's origin, set as the position.
 *
 * @godot Control.set_global_position
 * @source scene/gui/control.cpp:1495
 */
export function set_global_position(self: object, p_point: Vector2, p_keep_offsets = false): void {
  const entity = entityOf(self);
  const state = stateOf(self, 'set_global_position');
  const parent = godot_canvas_item_parent(entity);
  const inParent = parent === null ? p_point : xform(affine_inverse(get_global_transform(parent)), p_point);
  const origin = internalTransform(entity, state).origin;
  set_position(self, vector2(f32(inParent.x - origin.x), f32(inParent.y - origin.y)), p_keep_offsets);
}

/**
 * @godot Control.get_parent_area_size
 * @source scene/gui/control.cpp:736
 */
export function get_parent_area_size(self: object): Vector2 {
  stateOf(self, 'get_parent_area_size');
  return parentAnchorableRect(entityOf(self)).size;
}

/**
 * A non-finite size is ignored (`control.cpp:1943`).
 *
 * @godot Control.set_custom_minimum_size
 * @source scene/gui/control.cpp:1937
 */
export function set_custom_minimum_size(self: object, p_custom: Vector2): void {
  const state = stateOf(self, 'set_custom_minimum_size');
  if (p_custom.x === state.customMinimumSize.x && p_custom.y === state.customMinimumSize.y) return;
  if (!Number.isFinite(p_custom.x) || !Number.isFinite(p_custom.y)) return;
  state.customMinimumSize = p_custom;
  updateMinimumSize(entityOf(self));
}

/**
 * @godot Control.get_custom_minimum_size
 * @source scene/gui/control.cpp:1953
 */
export function get_custom_minimum_size(self: object): Vector2 {
  return stateOf(self, 'get_custom_minimum_size').customMinimumSize;
}

/**
 * A negative component is -1 (no maximum); a non-finite size is ignored.
 *
 * @godot Control.set_custom_maximum_size
 * @source scene/gui/control.cpp:1780
 */
export function set_custom_maximum_size(self: object, p_custom: Vector2): void {
  const state = stateOf(self, 'set_custom_maximum_size');
  if (p_custom.x === state.customMaximumSize.x && p_custom.y === state.customMaximumSize.y) return;
  if (!Number.isFinite(p_custom.x) || !Number.isFinite(p_custom.y)) return;
  state.customMaximumSize = vector2(p_custom.x < 0 ? -1 : p_custom.x, p_custom.y < 0 ? -1 : p_custom.y);
  updateMaximumSize(entityOf(self));
}

/**
 * @godot Control.get_custom_maximum_size
 * @source scene/gui/control.cpp:1804
 */
export function get_custom_maximum_size(self: object): Vector2 {
  return stateOf(self, 'get_custom_maximum_size').customMaximumSize;
}

/**
 * @godot Control.set_h_size_flags
 * @source scene/gui/control.cpp:2261
 */
export function set_h_size_flags(self: object, p_flags: number): void {
  const state = stateOf(self, 'set_h_size_flags');
  if (state.hSizeFlags === p_flags) return;
  state.hSizeFlags = p_flags;
  sizeFlagsChanged(entityOf(self));
}

/**
 * @godot Control.get_h_size_flags
 * @source scene/gui/control.cpp:2270
 */
export function get_h_size_flags(self: object): number {
  return stateOf(self, 'get_h_size_flags').hSizeFlags;
}

/**
 * @godot Control.set_v_size_flags
 * @source scene/gui/control.cpp:2275
 */
export function set_v_size_flags(self: object, p_flags: number): void {
  const state = stateOf(self, 'set_v_size_flags');
  if (state.vSizeFlags === p_flags) return;
  state.vSizeFlags = p_flags;
  sizeFlagsChanged(entityOf(self));
}

/**
 * @godot Control.get_v_size_flags
 * @source scene/gui/control.cpp:2284
 */
export function get_v_size_flags(self: object): number {
  return stateOf(self, 'get_v_size_flags').vSizeFlags;
}

/**
 * @godot Control.set_stretch_ratio
 * @source scene/gui/control.cpp:2289
 */
export function set_stretch_ratio(self: object, p_ratio: number): void {
  const state = stateOf(self, 'set_stretch_ratio');
  if (state.stretchRatio === f32(p_ratio)) return;
  state.stretchRatio = f32(p_ratio);
  sizeFlagsChanged(entityOf(self));
}

/** `size_flags_changed`, which a parent container sorts on (`container.cpp:52`). */
function sizeFlagsChanged(entity: Object3D): void {
  const container = parentContainer(entity);
  if (container !== null) queueSort(container);
}

/**
 * @godot Control.get_stretch_ratio
 * @source scene/gui/control.cpp:2299
 */
export function get_stretch_ratio(self: object): number {
  return stateOf(self, 'get_stretch_ratio').stretchRatio;
}

/**
 * @godot Control.set_rotation
 * @source scene/gui/control.cpp:1634
 */
export function set_rotation(self: object, p_radians: number): void {
  stateOf(self, 'set_rotation').rotation = f32(p_radians);
}

/**
 * @godot Control.get_rotation
 * @source scene/gui/control.cpp:1651
 */
export function get_rotation(self: object): number {
  return stateOf(self, 'get_rotation').rotation;
}

/**
 * A zero component becomes `CMP_EPSILON` (`control.cpp:1618`).
 *
 * @godot Control.set_scale
 * @source scene/gui/control.cpp:1610
 */
export function set_scale(self: object, p_scale: Vector2): void {
  stateOf(self, 'set_scale').scale = vector2(p_scale.x === 0 ? CMP_EPSILON : p_scale.x, p_scale.y === 0 ? CMP_EPSILON : p_scale.y);
}

/**
 * @godot Control.get_scale
 * @source scene/gui/control.cpp:1629
 */
export function get_scale(self: object): Vector2 {
  return stateOf(self, 'get_scale').scale;
}

/**
 * @godot Control.set_pivot_offset
 * @source scene/gui/control.cpp:1678
 */
export function set_pivot_offset(self: object, p_pivot: Vector2): void {
  stateOf(self, 'set_pivot_offset').pivotOffset = p_pivot;
}

/**
 * @godot Control.get_pivot_offset
 * @source scene/gui/control.cpp:1690
 */
export function get_pivot_offset(self: object): Vector2 {
  return stateOf(self, 'get_pivot_offset').pivotOffset;
}

/**
 * @godot Control.add_theme_constant_override
 * @source scene/gui/control.cpp:4036
 */
export function add_theme_constant_override(self: object, p_name: string, p_constant: number): void {
  stateOf(self, 'add_theme_constant_override').constantOverrides.set(p_name, p_constant);
  themeOverrideChanged(entityOf(self));
}

/** `_notify_theme_override_changed` (`control.cpp:3578`): inside the tree, the theme changed. */
function themeOverrideChanged(entity: Object3D): void {
  if (is_inside_tree(entity)) themeChanged(entity);
}

/**
 * @godot Control.remove_theme_constant_override
 * @source scene/gui/control.cpp:4084
 */
export function remove_theme_constant_override(self: object, p_name: string): void {
  stateOf(self, 'remove_theme_constant_override').constantOverrides.delete(p_name);
  themeOverrideChanged(entityOf(self));
}

/**
 * @godot Control.has_theme_constant_override
 * @source scene/gui/control.cpp:4120
 */
export function has_theme_constant_override(self: object, p_name: string): boolean {
  return stateOf(self, 'has_theme_constant_override').constantOverrides.has(p_name);
}

/**
 * The node's override, else the default theme's constant for its class (no project or node
 * themes are bound), else 0 (`Control::get_theme_constant`, `control.cpp:3792`).
 *
 * @godot Control.get_theme_constant
 * @source scene/gui/control.cpp:3792
 */
export function get_theme_constant(self: object, p_name: string): number {
  const state = stateOf(self, 'get_theme_constant');
  return state.constantOverrides.get(p_name) ?? state.virtuals.themeConstants?.[p_name] ?? 0;
}

/**
 * `get_bound_desired_size` (`control.cpp:2018`): the desired size raised to the combined minimum
 * and capped by the maximum.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:2018
 */
export function godot_control_bound_desired_size(entity: Object3D): Vector2 {
  const state = CONTROLS.get(entity) as ControlState;
  const desired = state.virtuals.desiredSize?.(entity) ?? vector2();
  const min = get_combined_minimum_size(entity);
  const max = combinedMaximumSize(state);
  let x = Math.max(desired.x, min.x);
  let y = Math.max(desired.y, min.y);
  if (max.x >= 0) x = Math.min(x, max.x);
  if (max.y >= 0) y = Math.min(y, max.y);
  return vector2(x, y);
}

/**
 * `update_minimum_size` for a class whose minimum size changed.
 *
 * @godot Control.update_minimum_size
 * @source scene/gui/control.cpp:1888
 */
export function update_minimum_size(self: object): void {
  stateOf(self, 'update_minimum_size');
  updateMinimumSize(entityOf(self));
}

/**
 * Queues a container's sort (`Container::queue_sort`, deferred).
 *
 * @godot Control (protocol)
 * @source scene/gui/container.cpp:156
 */
export function godot_control_queue_sort(entity: Object3D): void {
  if (CONTROLS.get(entity)?.virtuals.sort !== undefined) queueSort(entity);
}

/**
 * The children a container lays out (`Container::as_sortable_control`, `container.cpp:170`): Controls
 * that are not top-level and, by `mode`, visible (`VISIBLE`) or visible in the tree
 * (`VISIBLE_IN_TREE`, the default).
 *
 * @godot Control (protocol)
 * @source scene/gui/container.cpp:170
 */
export function godot_control_sortable(entity: Object3D, mode: 'visible' | 'visible-in-tree' = 'visible-in-tree'): Object3D | null {
  if (!CONTROLS.has(entity) || is_set_as_top_level(entity)) return null;
  if (mode === 'visible' && !is_visible(entity)) return null;
  if (mode === 'visible-in-tree' && !is_visible_in_tree(entity)) return null;
  return entity;
}

/**
 * Whether `entity` is a Control of class `className`.
 *
 * @godot Control (protocol)
 * @source core/object/object.h:677
 */
export function godot_control_is(entity: object, className: string): boolean {
  return CONTROLS.has(entity as Object3D) && godot_canvas_item_is(entity, className);
}

/**
 * `get_bound_minimum_size` (`control.cpp:2145`): the combined minimum size capped by the maximum.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:2145
 */
export function godot_control_bound_minimum_size(entity: Object3D): Vector2 {
  const state = CONTROLS.get(entity) as ControlState;
  const min = get_combined_minimum_size(entity);
  const max = combinedMaximumSize(state);
  return vector2(max.x >= 0 && min.x > max.x ? max.x : min.x, max.y >= 0 && min.y > max.y ? max.y : min.y);
}

/**
 * `get_combined_maximum_size` for a container's sort.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:1852
 */
export function godot_control_maximum_size(entity: Object3D): Vector2 {
  return combinedMaximumSize(CONTROLS.get(entity) as ControlState);
}

// --- GUI input.

/**
 * An index outside the three filters fails and is ignored.
 *
 * @godot Control.set_mouse_filter
 * @source scene/gui/control.cpp:2554
 */
export function set_mouse_filter(self: object, p_filter: number): void {
  if (p_filter < 0 || p_filter > 2) return;
  stateOf(self, 'set_mouse_filter').mouseFilter = p_filter;
}

/**
 * @godot Control.get_mouse_filter
 * @source scene/gui/control.cpp:2571
 */
export function get_mouse_filter(self: object): number {
  return stateOf(self, 'get_mouse_filter').mouseFilter;
}

/**
 * The node's `_gui_input` (a script's) and `gui_input` (its class's) handlers.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:2518
 */
export function godot_control_set_gui_input(entity: Object3D, handlers: { readonly script?: (event: unknown) => void; readonly native?: (event: unknown) => void }): void {
  const state = CONTROLS.get(entity) as ControlState;
  if (handlers.script !== undefined) state.guiInput = handlers.script;
  if (handlers.native !== undefined) state.nativeGuiInput = handlers.native;
}

/** `Rect2(Point2(), get_size()).has_point` (`Control::has_point`, `control.cpp:2545`). */
function hasPoint(state: ControlState, point: Vector2): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < state.sizeCache.x && point.y < state.sizeCache.y;
}

/** `_gui_find_control_at_pos` (`viewport.cpp:1844`): the last child first, then the node itself. */
function findAt(entity: Object3D, point: Vector2, parentXform: Transform2D): Object3D | null {
  if (!is_visible(entity)) return null;
  const matrix = xform(parentXform, get_transform(entity));
  if (f32(f32(matrix.x.x * matrix.y.y) - f32(matrix.x.y * matrix.y.x)) === 0) return null;
  const children = entity.children;
  for (let i = children.length - 1; i >= 0; i -= 1) {
    const child = children[i] as Object3D;
    if (!godot_canvas_item_is(child, 'CanvasItem') || is_set_as_top_level(child)) continue;
    const found = findAt(child, point, matrix);
    if (found !== null) return found;
  }
  const state = CONTROLS.get(entity);
  if (state === undefined || state.mouseFilter === MOUSE_FILTER_IGNORE) return null;
  return hasPoint(state, xform(affine_inverse(matrix), point)) ? entity : null;
}

/**
 * `Viewport::gui_find_control` (`viewport.cpp:1816`): the viewport's root Controls (those with no
 * Control above them in their canvas item chain, and top-level ones), by canvas layer then tree
 * order, tried from the last; the first Control under the point that takes the mouse.
 *
 * @godot Control (protocol)
 * @source scene/main/viewport.cpp:1816
 */
export function godot_control_find(viewport: Object3D, point: Vector2): Object3D | null {
  const roots: { readonly entity: Object3D; readonly layer: number }[] = [];
  const visit = (node: Object3D, underControl: boolean): void => {
    for (const child of node.children) {
      if ((child as { readonly isScene?: boolean }).isScene === true) continue;
      const control = CONTROLS.has(child);
      const item = godot_canvas_item_is(child, 'CanvasItem');
      if (control && is_inside_tree(child) && (!underControl || is_set_as_top_level(child))) {
        const layer = godot_canvas_item_layer_of(child);
        roots.push({ entity: child, layer: layer === null ? 0 : godot_canvas_item_layer_number(layer) });
      }
      visit(child, item ? underControl || control : false);
    }
  };
  visit(viewport, false);
  const ordered = roots.map((root, index) => ({ ...root, index })).sort((a, b) => (a.layer === b.layer ? a.index - b.index : a.layer - b.layer));
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const root = (ordered[i] as (typeof ordered)[number]).entity;
    if (!is_visible_in_tree(root)) continue;
    const parent = godot_canvas_item_parent(root);
    const base = parent !== null ? get_global_transform_with_canvas(parent) : godot_canvas_item_canvas_transform(root);
    const found = findAt(root, point, base);
    if (found !== null) return found;
  }
  return null;
}

/**
 * `Viewport::_gui_call_input` (`viewport.cpp:1740`): the Control and then its parents get the
 * event, each in its own space, until one that stops the mouse takes a pointer event, the event is
 * handled, or a top-level item is reached. `move` gives the event in a parent's space.
 *
 * @godot Control (protocol)
 * @source scene/main/viewport.cpp:1740
 */
export function godot_control_call_gui_input(
  control: Object3D,
  event: unknown,
  pointer: boolean,
  move: (event: unknown, transform: Transform2D) => unknown,
  handled: () => boolean,
  setHandled: () => void,
): void {
  let ev = event;
  let item: Object3D | null = control;
  while (item !== null) {
    const state = CONTROLS.get(item);
    if (state !== undefined) {
      if (state.mouseFilter !== MOUSE_FILTER_IGNORE) {
        // `Control::_call_gui_input` (`control.cpp:2518`): the script's, then the class's.
        if (!handled()) state.guiInput?.(ev);
        if (is_inside_tree(item) && !handled()) state.nativeGuiInput?.(ev);
      }
      if (!is_inside_tree(item) || is_set_as_top_level(item)) break;
      if (state.mouseFilter === MOUSE_FILTER_STOP && pointer) {
        setHandled();
        break;
      }
    }
    if (handled()) break;
    if (is_set_as_top_level(item)) break;
    ev = move(ev, get_transform(item));
    item = godot_canvas_item_parent(item);
  }
}

// --- Layout modes and presets, as the scene's properties set them.

/** `_get_layout_mode` (`control.cpp:978`). */
function computedLayoutMode(entity: Object3D, state: ControlState): number {
  const parent = entity.parent;
  const parentState = parent === null ? undefined : CONTROLS.get(parent);
  if (parentState === undefined) return LAYOUT_MODE_UNCONTROLLED;
  if (parentState.virtuals.sort !== undefined) return LAYOUT_MODE_CONTAINER;
  if (anchorsLayoutPreset(state) !== PRESET_TOP_LEFT) return LAYOUT_MODE_ANCHORS;
  if (state.storedLayoutMode === LAYOUT_MODE_POSITION || state.storedLayoutMode === LAYOUT_MODE_ANCHORS) return state.storedLayoutMode;
  return LAYOUT_MODE_POSITION;
}

/** `_get_anchors_layout_preset` (`control.cpp:1071`). */
function anchorsLayoutPreset(state: ControlState): number {
  if (state.storedLayoutMode !== LAYOUT_MODE_UNCONTROLLED && state.storedLayoutMode !== LAYOUT_MODE_ANCHORS) return PRESET_TOP_LEFT;
  if (state.storedUseCustomAnchors) return -1;
  const [left, top, right, bottom] = state.anchor as [number, number, number, number];
  const is = (l: number, t: number, r: number, b: number): boolean => left === l && top === t && right === r && bottom === b;
  if (is(0, 0, 0, 0)) return PRESET_TOP_LEFT;
  if (is(1, 0, 1, 0)) return PRESET_TOP_RIGHT;
  if (is(0, 1, 0, 1)) return PRESET_BOTTOM_LEFT;
  if (is(1, 1, 1, 1)) return PRESET_BOTTOM_RIGHT;
  if (is(0, 0.5, 0, 0.5)) return PRESET_CENTER_LEFT;
  if (is(1, 0.5, 1, 0.5)) return PRESET_CENTER_RIGHT;
  if (is(0.5, 0, 0.5, 0)) return PRESET_CENTER_TOP;
  if (is(0.5, 1, 0.5, 1)) return PRESET_CENTER_BOTTOM;
  if (is(0.5, 0.5, 0.5, 0.5)) return PRESET_CENTER;
  if (is(0, 0, 0, 1)) return PRESET_LEFT_WIDE;
  if (is(1, 0, 1, 1)) return PRESET_RIGHT_WIDE;
  if (is(0, 0, 1, 0)) return PRESET_TOP_WIDE;
  if (is(0, 1, 1, 1)) return PRESET_BOTTOM_WIDE;
  if (is(0.5, 0, 0.5, 1)) return PRESET_VCENTER_WIDE;
  if (is(0, 0.5, 1, 0.5)) return PRESET_HCENTER_WIDE;
  if (is(0, 0, 1, 1)) return PRESET_FULL_RECT;
  return -1;
}

/**
 * The layout mode the node is in: uncontrolled without a parent Control, in a container under
 * one, anchored when its anchors are not a top-left preset, else the stored mode.
 *
 * @godot Control._get_layout_mode
 * @source scene/gui/control.cpp:978
 */
export function _get_layout_mode(self: object): number {
  return computedLayoutMode(entityOf(self), stateOf(self, '_get_layout_mode'));
}

/**
 * Stores the mode; `LAYOUT_MODE_POSITION` puts the node at the top-left preset keeping its size.
 *
 * @godot Control._set_layout_mode
 * @source scene/gui/control.cpp:951
 */
export function _set_layout_mode(self: object, p_mode: number): void {
  const state = stateOf(self, '_set_layout_mode');
  state.storedLayoutMode = p_mode;
  if (p_mode === LAYOUT_MODE_POSITION) {
    state.storedUseCustomAnchors = false;
    set_anchors_and_offsets_preset(self, PRESET_TOP_LEFT, PRESET_MODE_KEEP_SIZE);
    godot_control_grow_direction_preset(self, PRESET_TOP_LEFT);
  }
}

/**
 * @godot Control._get_anchors_layout_preset
 * @source scene/gui/control.cpp:1071
 */
export function _get_anchors_layout_preset(self: object): number {
  return anchorsLayoutPreset(stateOf(self, '_get_anchors_layout_preset'));
}

/**
 * `-1` (custom) keeps the anchors; otherwise, anchored or uncontrolled, the preset's anchors, its
 * offsets (keeping the size for a corner or center, the minimum size for a wide preset) and grow
 * directions.
 *
 * @godot Control._set_anchors_layout_preset
 * @source scene/gui/control.cpp:1014
 */
export function _set_anchors_layout_preset(self: object, p_preset: number): void {
  const state = stateOf(self, '_set_anchors_layout_preset');
  if (p_preset === -1) {
    state.storedUseCustomAnchors = true;
    return;
  }
  if (state.storedLayoutMode !== LAYOUT_MODE_UNCONTROLLED && state.storedLayoutMode !== LAYOUT_MODE_ANCHORS) return;
  state.storedUseCustomAnchors = false;
  set_anchors_preset(self, p_preset);
  const wide = p_preset >= PRESET_LEFT_WIDE;
  set_offsets_preset(self, p_preset, wide ? PRESET_MODE_MINSIZE : PRESET_MODE_KEEP_SIZE);
  godot_control_grow_direction_preset(self, p_preset);
}

/**
 * `set_anchor(side, anchor)` with its defaults, the `anchor_*` properties' setter.
 *
 * @godot Control._set_anchor
 * @source scene/gui/control.cpp:786
 */
export function _set_anchor(self: object, p_side: number, p_anchor: number): void {
  set_anchor(self, p_side, p_anchor);
}

/**
 * @godot Control.set_force_pass_scroll_events
 * @source scene/gui/control.cpp:2639
 */
export function set_force_pass_scroll_events(self: object, p_force_pass_scroll_events: boolean): void {
  stateOf(self, 'set_force_pass_scroll_events').forcePassScrollEvents = p_force_pass_scroll_events;
}

/**
 * @godot Control.is_force_pass_scroll_events
 * @source scene/gui/control.cpp:2644
 */
export function is_force_pass_scroll_events(self: object): boolean {
  return stateOf(self, 'is_force_pass_scroll_events').forcePassScrollEvents;
}

/**
 * A plain Control as its class creates it (`Control::Control`), for the scene's mount.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:5161
 */
export function godot_control_node_mount(entity: Object3D): void {
  godot_control_mount(entity, ['Control', 'CanvasItem', 'Node']);
}
