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
 * Focus is each viewport's focus owner, kept here by the viewport entity (`Viewport::gui.key_focus`):
 * grabbing and releasing it, the focus modes and their recursive behaviour, and the next, previous
 * and neighbouring focusable Controls. Theme items are the node's overrides, then the default theme's
 * items for its class (`ControlVirtuals`), then ThemeDB's fallbacks; a Theme resource set on a node is
 * kept and read back, and its own items are not looked up. `clip_contents` clips the node's element
 * (`overflow: hidden`), the element holding its children's.
 *
 * Not bound: right-to-left mirroring of the layout (`is_layout_rtl` reports the direction, the
 * layout stays left to right), and the desired size of classes that report one.
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
import { type Color, construct as color } from './color';
import { godot_font_default, type GodotFont } from './font';
import { godot_object_signal } from './signal';
import { get_node_or_null, godot_node_adopt, godot_node_entity, godot_node_object, godot_node_is_queued, godot_node_observe_child_order, godot_node_tree_signal, is_inside_tree } from './node';
import { godot_message_queue_push } from './object';
import { construct as rect2, type Rect2 } from './rect2';
import { get_size as subViewportSize } from './sub-viewport';
import { godot_window_connect_size_changed, godot_window_has_size, godot_window_visible_size } from './window';
import { basis_xform, construct as transform2d, get_scale as transformScale, affine_inverse, op_multiply as xform, type Transform2D } from './transform-2d';
import { construct as vector2, type Vector2 } from './vector2';
import type { ReactElement } from 'react';
import { Group } from 'three';
import { godot_canvas_item_props } from './canvas-item';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

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

/** `Control::FocusMode` (`scene/gui/control.h:93`) and the recursive behaviours (`:100`, `:106`). */
const FOCUS_NONE = 0;
const FOCUS_CLICK = 1;
const FOCUS_ALL = 2;
const FOCUS_ACCESSIBILITY = 3;
const BEHAVIOR_INHERITED = 0;
const BEHAVIOR_ENABLED = 2;

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
  /** The default theme's colors and font sizes for the class (`scene/theme/default_theme.cpp`). */
  readonly themeColors?: Readonly<Record<string, Color>>;
  readonly themeFontSizes?: Readonly<Record<string, number>>;
  /** `NOTIFICATION_DRAW`: the class's own drawing into its element. */
  readonly draw?: (entity: Object3D, element: HTMLElement) => void;
  /** The state `draw` reads, as a key (`CanvasItemClass.drawKey`). */
  readonly drawKey?: (entity: Object3D, element: HTMLElement) => string;
}

/** `Data::OffsetTransform` (`scene/gui/control.h`): the transform applied after the node's own. */
interface OffsetTransform {
  enabled: boolean;
  position: Vector2;
  positionRatio: Vector2;
  scale: Vector2;
  rotation: number;
  pivot: Vector2;
  pivotRatio: Vector2;
  visualOnly: boolean;
}

interface ControlState {
  readonly entity: Object3D;
  /** A root Control's connection to its viewport's `size_changed`, while in the canvas. */
  viewportSizeChanged?: (() => void) | undefined;
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
  pivotOffsetRatio: Vector2;
  offsetTransform: OffsetTransform | undefined;
  propagateMaximumSize: boolean;
  readonly virtuals: ControlVirtuals;
  readonly constantOverrides: Map<string, number>;
  readonly colorOverrides: Map<string, Color>;
  readonly fontSizeOverrides: Map<string, number>;
  readonly fontOverrides: Map<string, unknown>;
  readonly iconOverrides: Map<string, unknown>;
  readonly styleboxOverrides: Map<string, unknown>;
  bulkThemeOverride: boolean;
  theme: object | null;
  themeTypeVariation: string;
  focusMode: number;
  focusBehaviorRecursive: number;
  mouseBehaviorRecursive: number;
  readonly focusNeighbor: string[];
  focusNext: string;
  focusPrevious: string;
  tooltipText: string;
  tooltipAutoTranslateMode: number;
  translationContext: string;
  autoTranslate: boolean;
  localizeNumeralSystem: boolean;
  layoutDirection: number;
  defaultCursorShape: number;
  clipContents: boolean;
  shortcutContext: object | null;
  dragForwarding: readonly [unknown, unknown, unknown] | null;
  accessibility: { name: string; description: string; live: number; controls: string[]; describedBy: string[]; labeledBy: string[]; flowTo: string[] };
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
  // `clip_contents` clips the element that holds the children's elements, before the class draws.
  const clip = (node: Object3D, element: HTMLElement): void => {
    element.style.overflow = (CONTROLS.get(node) as ControlState).clipContents ? 'hidden' : '';
  };
  const draw = virtuals.draw;
  const drawKey = virtuals.drawKey;
  godot_canvas_item_mount(entity, classes, {
    transform: godot_control_transform,
    drawTransform,
    size: (node) => (CONTROLS.get(node) as ControlState).sizeCache,
    visibilityChanged,
    draw: (node, element) => {
      clip(node, element);
      draw?.(node, element);
    },
    ...(draw !== undefined && drawKey === undefined
      ? {}
      : { drawKey: (node: Object3D, element: HTMLElement) => `${String((CONTROLS.get(node) as ControlState).clipContents)}|${drawKey?.(node, element) ?? ''}` }),
  });
  CONTROLS.set(entity, {
    entity,
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
    pivotOffsetRatio: vector2(),
    offsetTransform: undefined,
    propagateMaximumSize: false,
    virtuals,
    constantOverrides: new Map(),
    colorOverrides: new Map(),
    fontSizeOverrides: new Map(),
    fontOverrides: new Map(),
    iconOverrides: new Map(),
    styleboxOverrides: new Map(),
    bulkThemeOverride: false,
    theme: null,
    themeTypeVariation: '',
    focusMode: FOCUS_NONE,
    focusBehaviorRecursive: BEHAVIOR_INHERITED,
    mouseBehaviorRecursive: BEHAVIOR_INHERITED,
    focusNeighbor: ['', '', '', ''],
    focusNext: '',
    focusPrevious: '',
    tooltipText: '',
    tooltipAutoTranslateMode: 0,
    translationContext: '',
    autoTranslate: true,
    localizeNumeralSystem: true,
    layoutDirection: 0,
    defaultCursorShape: 0,
    clipContents: false,
    shortcutContext: null,
    dragForwarding: null,
    accessibility: { name: '', description: '', live: 0, controls: [], describedBy: [], labeledBy: [], flowTo: [] },
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
  // `NOTIFICATION_ENTER_CANVAS` (`control.cpp:4577`): without a parent canvas item, the Control
  // follows its viewport's size, the root window's or a SubViewport's (the viewport is one of them).
  const viewport = godot_canvas_item_parent(entity) === null ? viewportOf(entity) : null;
  if (viewport !== null) {
    state.viewportSizeChanged = godot_window_connect_size_changed(viewport, () => sizeChanged(entity));
  }
  themeChanged(entity);
  updateMaximumSize(entity);
  sizeChanged(entity);
  const container = parentContainer(entity);
  if (container !== null) {
    updateMinimumSize(container);
    queueSort(container);
  }
}

/**
 * `NOTIFICATION_EXIT_CANVAS`'s viewport disconnection (`control.cpp:4589`), then the parent
 * container's `remove_child_notify` (`container.cpp:76`).
 */
function exitingTree(entity: Object3D): void {
  const state = CONTROLS.get(entity) as ControlState;
  state.viewportSizeChanged?.();
  state.viewportSizeChanged = undefined;
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
// `Container::move_child_notify` (`container.cpp:65`): a Control child moved, the container's
// minimum size is updated and its children sorted again.
godot_node_observe_child_order((parent, child) => {
  const state = CONTROLS.get(parent as Object3D);
  if (state?.virtuals.sort === undefined || !CONTROLS.has(child as Object3D)) return;
  update_minimum_size(parent);
  queueSort(parent as Object3D);
});

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
  const size = godot_window_has_size(viewport) ? godot_window_visible_size(viewport) : subViewportSize(viewport);
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
  let x = state.customMaximumSize.x;
  let y = state.customMaximumSize.y;
  // `data.parent_maximum_size_cache`: a parent Control that propagates its maximum size caps it.
  const parent = godot_canvas_item_parent(state.entity);
  const parentState = parent === null || is_set_as_top_level(state.entity) ? undefined : CONTROLS.get(parent);
  if (parentState?.propagateMaximumSize === true) {
    const cap = combinedMaximumSize(parentState);
    if (cap.x >= 0) x = x >= 0 ? Math.min(x, cap.x) : cap.x;
    if (cap.y >= 0) y = y >= 0 ? Math.min(y, cap.y) : cap.y;
  }
  return x === state.customMaximumSize.x && y === state.customMaximumSize.y ? state.customMaximumSize : vector2(x, y);
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
  const pivot = combinedPivot(state);
  const base = transform2d(state.rotation, state.scale, 0, pivot);
  const moved = basis_xform(base, vector2(-pivot.x, -pivot.y));
  const own = transform2d(base.x, base.y, vector2(f32(base.origin.x + moved.x), f32(base.origin.y + moved.y)));
  const offset = state.offsetTransform;
  return offset?.enabled === true && !offset.visualOnly ? xform(own, offsetTransform(state)) : own;
}

/** `get_combined_pivot_offset` (`control.cpp:1695`): the pivot plus its ratio of the size. */
function combinedPivot(state: ControlState): Vector2 {
  const size = state.sizeCache;
  return vector2(f32(state.pivotOffset.x + f32(state.pivotOffsetRatio.x * size.x)), f32(state.pivotOffset.y + f32(state.pivotOffsetRatio.y * size.y)));
}

/**
 * `get_offset_transform` (`control.cpp:2503`): `T(pivot + translation) * R * S * T(-pivot)`, each
 * of the pivot and translation absolute plus a ratio of the size.
 */
function offsetTransform(state: ControlState): Transform2D {
  const offset = state.offsetTransform;
  if (offset?.enabled !== true) return transform2d();
  const size = state.sizeCache;
  const translation = vector2(f32(offset.position.x + f32(offset.positionRatio.x * size.x)), f32(offset.position.y + f32(offset.positionRatio.y * size.y)));
  const pivot = vector2(f32(offset.pivot.x + f32(offset.pivotRatio.x * size.x)), f32(offset.pivot.y + f32(offset.pivotRatio.y * size.y)));
  const base = transform2d(offset.rotation, offset.scale, 0, vector2(f32(pivot.x + translation.x), f32(pivot.y + translation.y)));
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
  const snapped =
    !is_inside_tree(entity) || !(Math.abs(f32(Math.sin(f32(state.rotation * 4)))) < f32(0.00001))
      ? transform
      : transform2d(transform.x, transform.y, vector2(Math.floor(f32(transform.origin.x + 0.5)), Math.floor(f32(transform.origin.y + 0.5))));
  // A visual-only offset transform moves the drawing and nothing else (`control.cpp:764`).
  return state.offsetTransform?.enabled === true && state.offsetTransform.visualOnly ? xform(snapped, offsetTransform(state)) : snapped;
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
  if (!(CONTROLS.get(entity) as ControlState).bulkThemeOverride && is_inside_tree(entity)) themeChanged(entity);
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
  if (state === undefined || mouseFilterWithOverride(entity, state) === MOUSE_FILTER_IGNORE) return null;
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
  const outer = acceptEvent;
  acceptEvent = setHandled;
  try {
    callGuiInput(control, event, pointer, move, handled, setHandled);
  } finally {
    acceptEvent = outer;
  }
}

/** The `Viewport::_gui_accept_event` of the GUI event being delivered, which `accept_event` calls. */
let acceptEvent: (() => void) | undefined;

function callGuiInput(
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
      const filter = mouseFilterWithOverride(item, state);
      // A Control queued for deletion takes no more input; the event goes on.
      if (filter !== MOUSE_FILTER_IGNORE && !godot_node_is_queued(item)) {
        // `Control::_call_gui_input` (`control.cpp:2518`): the script's, then the class's.
        if (!handled()) {
          // A script error aborts only its `_gui_input` (docs/GODOT.md §Order of work).
          try {
            state.guiInput?.(ev);
          } catch (error) {
            console.error(error);
          }
        }
        if (is_inside_tree(item) && !handled()) state.nativeGuiInput?.(ev);
      }
      if (!is_inside_tree(item) || is_set_as_top_level(item)) break;
      if (filter === MOUSE_FILTER_STOP && pointer) {
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

/**
 * Control's properties as a scene element states them, over CanvasItem's: the layout mode and
 * anchors preset through their internal setters, each anchor and offset by its side.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:4902
 */
export function godot_control_props(): (readonly [string, GodotElementProp<Object3D>])[] {
  const v2 = (value: readonly [number, number]) => vector2(...value);
  return [
    ...godot_canvas_item_props(),
    ['customMinimumSize', (entity, value: readonly [number, number]) => set_custom_minimum_size(entity, v2(value))],
    ['customMaximumSize', (entity, value: readonly [number, number]) => set_custom_maximum_size(entity, v2(value))],
    ['layoutMode', (entity, value: number) => _set_layout_mode(entity, value)],
    ['anchorsPreset', (entity, value: number) => _set_anchors_layout_preset(entity, value)],
    ...(['Left', 'Top', 'Right', 'Bottom'] as const).flatMap((side, index): (readonly [string, GodotElementProp<Object3D>])[] => [
      [`anchor${side}`, (entity, value: number) => _set_anchor(entity, index, value)],
      [`offset${side}`, (entity, value: number) => set_offset(entity, index, value)],
    ]),
    ['growHorizontal', (entity, value: number) => set_h_grow_direction(entity, value)],
    ['growVertical', (entity, value: number) => set_v_grow_direction(entity, value)],
    ['rotation', (entity, value: number) => set_rotation(entity, value)],
    ['scale', (entity, value: readonly [number, number]) => set_scale(entity, v2(value))],
    ['pivotOffset', (entity, value: readonly [number, number]) => set_pivot_offset(entity, v2(value))],
    ['sizeFlagsHorizontal', (entity, value: number) => set_h_size_flags(entity, value)],
    ['sizeFlagsVertical', (entity, value: number) => set_v_size_flags(entity, value)],
    ['sizeFlagsStretchRatio', (entity, value: number) => set_stretch_ratio(entity, value)],
    ['mouseFilter', (entity, value: number) => set_mouse_filter(entity, value)],
    ['mouseForcePassScrollEvents', (entity, value: boolean) => set_force_pass_scroll_events(entity, value)],
  ];
}

const CONTROL = {
  create: () => new Group(),
  classes: ['Control', 'CanvasItem', 'Node', 'Object'],
  spatial: false,
  mount: godot_control_node_mount,
  props: new Map(godot_control_props()),
};

/**
 * A Control as a scene writes it: `<GodotControl layoutMode={3} anchorsPreset={15} />`.
 *
 * @godot Control (protocol)
 * @source scene/gui/control.cpp:5161
 */
export function GodotControl(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(CONTROL, props);
}

// --- Sizes and transforms.

/**
 * The class's own maximum size: none (`-1, -1`) for Control.
 *
 * @godot Control.get_maximum_size
 * @source scene/gui/control.cpp:1809
 */
export function get_maximum_size(self: object): Vector2 {
  stateOf(self, 'get_maximum_size');
  return vector2(-1, -1);
}

/**
 * The maximum size capped by the custom maximum and, where the parent Control propagates its own,
 * by the parent's.
 *
 * @godot Control.get_combined_maximum_size
 * @source scene/gui/control.cpp:1852
 */
export function get_combined_maximum_size(self: object): Vector2 {
  return combinedMaximumSize(stateOf(self, 'get_combined_maximum_size'));
}

/**
 * Whether the children's maximum sizes are capped by this node's; a change updates them.
 *
 * @godot Control.set_propagate_maximum_size
 * @source scene/gui/control.cpp:1702
 */
export function set_propagate_maximum_size(self: object, p_propagate: boolean): void {
  const state = stateOf(self, 'set_propagate_maximum_size');
  if (state.propagateMaximumSize === Boolean(p_propagate)) return;
  state.propagateMaximumSize = Boolean(p_propagate);
  for (const child of [...state.entity.children]) if (CONTROLS.has(child)) updateMaximumSize(child);
  updateMaximumSize(state.entity);
}

/**
 * @godot Control.is_propagating_maximum_size
 * @source scene/gui/control.cpp:1711
 */
export function is_propagating_maximum_size(self: object): boolean {
  return stateOf(self, 'is_propagating_maximum_size').propagateMaximumSize;
}

/**
 * The maximum size is computed again (deferred), for a class whose maximum size changed.
 *
 * @godot Control.update_maximum_size
 * @source scene/gui/control.cpp:1732
 */
export function update_maximum_size(self: object): void {
  stateOf(self, 'update_maximum_size');
  updateMaximumSize(entityOf(self));
}

/**
 * The combined minimum size capped by the combined maximum size.
 *
 * @godot Control.get_bound_minimum_size
 * @source scene/gui/control.cpp:2145
 */
export function get_bound_minimum_size(self: object): Vector2 {
  stateOf(self, 'get_bound_minimum_size');
  return godot_control_bound_minimum_size(entityOf(self));
}

/**
 * `set_rotation(deg_to_rad(degrees))`.
 *
 * @godot Control.set_rotation_degrees
 * @source scene/gui/control.cpp:1646
 */
export function set_rotation_degrees(self: object, p_degrees: number): void {
  set_rotation(self, f32(f32(p_degrees) * f32(Math.PI / 180)));
}

/**
 * @godot Control.get_rotation_degrees
 * @source scene/gui/control.cpp:1656
 */
export function get_rotation_degrees(self: object): number {
  return f32(get_rotation(self) * f32(180 / Math.PI));
}

/**
 * The pivot as a ratio of the size, added to `pivot_offset`.
 *
 * @godot Control.set_pivot_offset_ratio
 * @source scene/gui/control.cpp:1661
 */
export function set_pivot_offset_ratio(self: object, p_ratio: Vector2): void {
  stateOf(self, 'set_pivot_offset_ratio').pivotOffsetRatio = p_ratio;
}

/**
 * @godot Control.get_pivot_offset_ratio
 * @source scene/gui/control.cpp:1673
 */
export function get_pivot_offset_ratio(self: object): Vector2 {
  return stateOf(self, 'get_pivot_offset_ratio').pivotOffsetRatio;
}

/**
 * `pivot_offset + pivot_offset_ratio * size`.
 *
 * @godot Control.get_combined_pivot_offset
 * @source scene/gui/control.cpp:1695
 */
export function get_combined_pivot_offset(self: object): Vector2 {
  return combinedPivot(stateOf(self, 'get_combined_pivot_offset'));
}

/** The node's offset transform, made on first use with its defaults (`_ensure_allocated_offset_transform`). */
function offsetOf(self: object, member: string): OffsetTransform {
  const state = stateOf(self, member);
  state.offsetTransform ??= {
    enabled: false,
    position: vector2(),
    positionRatio: vector2(),
    scale: vector2(1, 1),
    rotation: 0,
    pivot: vector2(),
    pivotRatio: vector2(0.5, 0.5),
    visualOnly: true,
  };
  return state.offsetTransform;
}

/** The offset transform's value, or its default before one is made. */
function offsetRead<Key extends keyof OffsetTransform>(self: object, member: string, key: Key, fallback: OffsetTransform[Key]): OffsetTransform[Key] {
  const offset = stateOf(self, member).offsetTransform;
  return offset === undefined ? fallback : offset[key];
}

/**
 * A transform applied after the node's own, about its own pivot; unless visual only, it moves the
 * node's rect and input as well as its drawing.
 *
 * @godot Control.set_offset_transform_enabled
 * @source scene/gui/control.cpp:2306
 */
export function set_offset_transform_enabled(self: object, p_enabled: boolean): void {
  offsetOf(self, 'set_offset_transform_enabled').enabled = Boolean(p_enabled);
}

/**
 * @godot Control.is_offset_transform_enabled
 * @source scene/gui/control.cpp:2324
 */
export function is_offset_transform_enabled(self: object): boolean {
  return offsetRead(self, 'is_offset_transform_enabled', 'enabled', false);
}

/**
 * @godot Control.set_offset_transform_position
 * @source scene/gui/control.cpp:2328
 */
export function set_offset_transform_position(self: object, p_offset: Vector2): void {
  offsetOf(self, 'set_offset_transform_position').position = p_offset;
}

/**
 * @godot Control.get_offset_transform_position
 * @source scene/gui/control.cpp:2345
 */
export function get_offset_transform_position(self: object): Vector2 {
  return offsetRead(self, 'get_offset_transform_position', 'position', vector2());
}

/**
 * @godot Control.set_offset_transform_position_ratio
 * @source scene/gui/control.cpp:2353
 */
export function set_offset_transform_position_ratio(self: object, p_offset: Vector2): void {
  offsetOf(self, 'set_offset_transform_position_ratio').positionRatio = p_offset;
}

/**
 * @godot Control.get_offset_transform_position_ratio
 * @source scene/gui/control.cpp:2370
 */
export function get_offset_transform_position_ratio(self: object): Vector2 {
  return offsetRead(self, 'get_offset_transform_position_ratio', 'positionRatio', vector2());
}

/**
 * @godot Control.set_offset_transform_scale
 * @source scene/gui/control.cpp:2378
 */
export function set_offset_transform_scale(self: object, p_scale: Vector2): void {
  offsetOf(self, 'set_offset_transform_scale').scale = p_scale;
}

/**
 * @godot Control.get_offset_transform_scale
 * @source scene/gui/control.cpp:2395
 */
export function get_offset_transform_scale(self: object): Vector2 {
  return offsetRead(self, 'get_offset_transform_scale', 'scale', vector2(1, 1));
}

/**
 * @godot Control.set_offset_transform_rotation
 * @source scene/gui/control.cpp:2403
 */
export function set_offset_transform_rotation(self: object, p_rotation: number): void {
  offsetOf(self, 'set_offset_transform_rotation').rotation = f32(p_rotation);
}

/**
 * @godot Control.get_offset_transform_rotation
 * @source scene/gui/control.cpp:2420
 */
export function get_offset_transform_rotation(self: object): number {
  return offsetRead(self, 'get_offset_transform_rotation', 'rotation', 0);
}

/**
 * @godot Control.set_offset_transform_pivot
 * @source scene/gui/control.cpp:2428
 */
export function set_offset_transform_pivot(self: object, p_pivot: Vector2): void {
  offsetOf(self, 'set_offset_transform_pivot').pivot = p_pivot;
}

/**
 * @godot Control.get_offset_transform_pivot
 * @source scene/gui/control.cpp:2445
 */
export function get_offset_transform_pivot(self: object): Vector2 {
  return offsetRead(self, 'get_offset_transform_pivot', 'pivot', vector2());
}

/**
 * @godot Control.set_offset_transform_pivot_ratio
 * @source scene/gui/control.cpp:2453
 */
export function set_offset_transform_pivot_ratio(self: object, p_pivot: Vector2): void {
  offsetOf(self, 'set_offset_transform_pivot_ratio').pivotRatio = p_pivot;
}

/**
 * @godot Control.get_offset_transform_pivot_ratio
 * @source scene/gui/control.cpp:2470
 */
export function get_offset_transform_pivot_ratio(self: object): Vector2 {
  return offsetRead(self, 'get_offset_transform_pivot_ratio', 'pivotRatio', vector2(0.5, 0.5));
}

/**
 * @godot Control.set_offset_transform_visual_only
 * @source scene/gui/control.cpp:2478
 */
export function set_offset_transform_visual_only(self: object, p_enabled: boolean): void {
  offsetOf(self, 'set_offset_transform_visual_only').visualOnly = Boolean(p_enabled);
}

/**
 * @godot Control.is_offset_transform_visual_only
 * @source scene/gui/control.cpp:2495
 */
export function is_offset_transform_visual_only(self: object): boolean {
  return offsetRead(self, 'is_offset_transform_visual_only', 'visualOnly', true);
}

/**
 * The parent node when it is a Control, else null.
 *
 * @godot Control.get_parent_control
 * @source scene/gui/control.cpp:681
 */
export function get_parent_control(self: object): object | null {
  stateOf(self, 'get_parent_control');
  const parent = parentControl(entityOf(self));
  return parent === null ? null : godot_node_object(parent);
}

/** `data.parent_control`: the parent node when it is a Control. */
function parentControl(entity: Object3D): Object3D | null {
  const parent = entity.parent;
  return parent !== null && CONTROLS.has(parent) ? parent : null;
}

/**
 * @godot Control.set_clip_contents
 * @source scene/gui/control.cpp:3556
 */
export function set_clip_contents(self: object, p_clip: boolean): void {
  stateOf(self, 'set_clip_contents').clipContents = Boolean(p_clip);
}

/**
 * @godot Control.is_clipping_contents
 * @source scene/gui/control.cpp:3565
 */
export function is_clipping_contents(self: object): boolean {
  return stateOf(self, 'is_clipping_contents').clipContents;
}

// --- Input.

/**
 * Marks the GUI event being delivered as handled (`Viewport::_gui_accept_event`); outside a
 * delivery, or outside the tree, it does nothing.
 *
 * @godot Control.accept_event
 * @source scene/gui/control.cpp:2538
 */
export function accept_event(self: object): void {
  if (!is_inside_tree(entityOf(self))) return;
  acceptEvent?.();
}

/** `_is_mouse_filter_enabled` (`control.cpp:2599`): the recursive behaviour, inherited up the parent Controls. */
function mouseFilterEnabled(entity: Object3D): boolean {
  const state = CONTROLS.get(entity) as ControlState;
  if (state.mouseBehaviorRecursive === BEHAVIOR_INHERITED) {
    const parent = parentControl(entity);
    return parent === null ? true : mouseFilterEnabled(parent);
  }
  return state.mouseBehaviorRecursive === BEHAVIOR_ENABLED;
}

/** `get_mouse_filter_with_override` (`control.cpp:2576`). */
function mouseFilterWithOverride(entity: Object3D, state: ControlState): number {
  return mouseFilterEnabled(entity) ? state.mouseFilter : MOUSE_FILTER_IGNORE;
}

/**
 * The mouse filter, or `MOUSE_FILTER_IGNORE` where the recursive mouse behaviour disables it.
 *
 * @godot Control.get_mouse_filter_with_override
 * @source scene/gui/control.cpp:2576
 */
export function get_mouse_filter_with_override(self: object): number {
  return mouseFilterWithOverride(entityOf(self), stateOf(self, 'get_mouse_filter_with_override'));
}

/**
 * `MOUSE_BEHAVIOR_INHERITED` (0), `DISABLED` (1) or `ENABLED` (2), for the node and the children
 * that inherit it; another index fails.
 *
 * @godot Control.set_mouse_behavior_recursive
 * @source scene/gui/control.cpp:2584
 */
export function set_mouse_behavior_recursive(self: object, p_mouse_behavior_recursive: number): void {
  if (p_mouse_behavior_recursive < 0 || p_mouse_behavior_recursive > 2) return;
  stateOf(self, 'set_mouse_behavior_recursive').mouseBehaviorRecursive = p_mouse_behavior_recursive;
}

/**
 * @godot Control.get_mouse_behavior_recursive
 * @source scene/gui/control.cpp:2594
 */
export function get_mouse_behavior_recursive(self: object): number {
  return stateOf(self, 'get_mouse_behavior_recursive').mouseBehaviorRecursive;
}

/**
 * Moving the pointer is something a page cannot do (the web display server has no `warp_mouse`),
 * so it does nothing.
 *
 * @godot Control.warp_mouse
 * @source scene/gui/control.cpp:2649
 */
export function warp_mouse(self: object, p_position: Vector2): void {
  stateOf(self, 'warp_mouse');
  void p_position;
}

/**
 * The node whose subtree must hold the focus owner for the node's shortcuts to fire; null for none.
 *
 * @godot Control.set_shortcut_context
 * @source scene/gui/control.cpp:2655
 */
export function set_shortcut_context(self: object, p_node: object | null): void {
  stateOf(self, 'set_shortcut_context').shortcutContext = p_node;
}

/**
 * @godot Control.get_shortcut_context
 * @source scene/gui/control.cpp:2664
 */
export function get_shortcut_context(self: object): object | null {
  return stateOf(self, 'get_shortcut_context').shortcutContext;
}

/**
 * The callables that stand in for `_get_drag_data`, `_can_drop_data` and `_drop_data`, kept for
 * the viewport's drag and drop.
 *
 * @godot Control.set_drag_forwarding
 * @source scene/gui/control.cpp:2688
 */
export function set_drag_forwarding(self: object, p_drag_func: unknown, p_can_drop_func: unknown, p_drop_func: unknown): void {
  stateOf(self, 'set_drag_forwarding').dragForwarding = [p_drag_func, p_can_drop_func, p_drop_func];
}

/**
 * Whether the viewport's last drag ended in a drop. The root viewport binds no drag and drop
 * (`viewport.ts`), so no drag succeeds.
 *
 * @godot Control.is_drag_successful
 * @source scene/gui/control.cpp:2891
 */
export function is_drag_successful(self: object): boolean {
  stateOf(self, 'is_drag_successful');
  return false;
}

// --- Focus.

/** Each viewport's focus owner (`Viewport::gui.key_focus`), keyed by the viewport entity. */
const FOCUS_OWNER = new WeakMap<Object3D, Object3D>();

function focusViewport(entity: Object3D): Object3D | null {
  return viewportOf(entity);
}

/** `_is_focus_mode_enabled` (`control.cpp:2947`): the recursive behaviour, inherited up the parent Controls. */
function focusModeEnabled(entity: Object3D): boolean {
  const state = CONTROLS.get(entity) as ControlState;
  if (state.focusBehaviorRecursive === BEHAVIOR_INHERITED) {
    const parent = parentControl(entity);
    return parent === null ? true : focusModeEnabled(parent);
  }
  return state.focusBehaviorRecursive === BEHAVIOR_ENABLED;
}

function focusModeWithOverride(entity: Object3D): number {
  return focusModeEnabled(entity) ? (CONTROLS.get(entity) as ControlState).focusMode : FOCUS_NONE;
}

/** `_is_focusable` (`control.cpp:2942`), with no screen reader active. */
function focusable(entity: Object3D): boolean {
  const mode = focusModeWithOverride(entity);
  return is_visible_in_tree(entity) && (mode === FOCUS_ALL || mode === FOCUS_CLICK);
}

function hasFocus(entity: Object3D): boolean {
  const viewport = focusViewport(entity);
  return is_inside_tree(entity) && viewport !== null && FOCUS_OWNER.get(viewport) === entity;
}

/** `Viewport::gui_release_focus`: the owner loses the focus and says so (`focus_exited`). */
function releaseFocusOf(viewport: Object3D): void {
  const owner = FOCUS_OWNER.get(viewport);
  if (owner === undefined) return;
  FOCUS_OWNER.delete(viewport);
  godot_object_signal<[]>(owner, 'focus_exited').emit();
}

/**
 * `FOCUS_NONE` (0), `FOCUS_CLICK` (1), `FOCUS_ALL` (2) or `FOCUS_ACCESSIBILITY` (3); turning it
 * off releases a focus the node holds.
 *
 * @godot Control.set_focus_mode
 * @source scene/gui/control.cpp:2898
 */
export function set_focus_mode(self: object, p_focus_mode: number): void {
  if (p_focus_mode < 0 || p_focus_mode > 3) return;
  const entity = entityOf(self);
  const state = stateOf(self, 'set_focus_mode');
  if (is_inside_tree(entity) && p_focus_mode === FOCUS_NONE && state.focusMode !== FOCUS_NONE && hasFocus(entity)) release_focus(self);
  state.focusMode = p_focus_mode;
}

/**
 * @godot Control.get_focus_mode
 * @source scene/gui/control.cpp:2913
 */
export function get_focus_mode(self: object): number {
  return stateOf(self, 'get_focus_mode').focusMode;
}

/**
 * The focus mode, or `FOCUS_NONE` where the recursive focus behaviour disables it.
 *
 * @godot Control.get_focus_mode_with_override
 * @source scene/gui/control.cpp:2918
 */
export function get_focus_mode_with_override(self: object): number {
  stateOf(self, 'get_focus_mode_with_override');
  return focusModeWithOverride(entityOf(self));
}

/**
 * `FOCUS_BEHAVIOR_INHERITED` (0), `DISABLED` (1) or `ENABLED` (2); a node it disables lets go of the
 * focus, as does a child that inherits it.
 *
 * @godot Control.set_focus_behavior_recursive
 * @source scene/gui/control.cpp:2926
 */
export function set_focus_behavior_recursive(self: object, p_focus_behavior_recursive: number): void {
  if (p_focus_behavior_recursive < 0 || p_focus_behavior_recursive > 2) return;
  const entity = entityOf(self);
  stateOf(self, 'set_focus_behavior_recursive').focusBehaviorRecursive = p_focus_behavior_recursive;
  const viewport = focusViewport(entity);
  const owner = viewport === null ? undefined : FOCUS_OWNER.get(viewport);
  if (viewport !== null && owner !== undefined && (owner === entity || entity.getObjectById(owner.id) !== undefined) && focusModeWithOverride(owner) === FOCUS_NONE) {
    releaseFocusOf(viewport);
  }
}

/**
 * @godot Control.get_focus_behavior_recursive
 * @source scene/gui/control.cpp:2937
 */
export function get_focus_behavior_recursive(self: object): number {
  return stateOf(self, 'get_focus_behavior_recursive').focusBehaviorRecursive;
}

/**
 * Whether the node holds its viewport's focus.
 *
 * @godot Control.has_focus
 * @source scene/gui/control.cpp:2989
 */
export function has_focus(self: object, p_ignore_hidden_focus = false): boolean {
  stateOf(self, 'has_focus');
  void p_ignore_hidden_focus;
  return hasFocus(entityOf(self));
}

/**
 * Takes the viewport's focus from its owner (`focus_exited` there, then `focus_entered` here); a
 * node outside the tree, or whose focus mode (with its override) is none, fails. With no screen
 * reader, an accessibility-only focus mode cannot take it either.
 *
 * @godot Control.grab_focus
 * @source scene/gui/control.cpp:2994
 */
export function grab_focus(self: object, p_hide_focus = false): void {
  void p_hide_focus;
  const entity = entityOf(self);
  stateOf(self, 'grab_focus');
  if (!is_inside_tree(entity)) return;
  const mode = focusModeWithOverride(entity);
  if (mode === FOCUS_NONE || mode === FOCUS_ACCESSIBILITY) return;
  const viewport = focusViewport(entity);
  if (viewport === null || FOCUS_OWNER.get(viewport) === entity) return;
  releaseFocusOf(viewport);
  FOCUS_OWNER.set(viewport, entity);
  godot_object_signal<[]>(entity, 'focus_entered').emit();
}

/**
 * Lets go of the viewport's focus, if the node holds it; outside the tree it fails.
 *
 * @godot Control.release_focus
 * @source scene/gui/control.cpp:3020
 */
export function release_focus(self: object): void {
  const entity = entityOf(self);
  stateOf(self, 'release_focus');
  if (!is_inside_tree(entity) || !hasFocus(entity)) return;
  releaseFocusOf(focusViewport(entity) as Object3D);
}

/** The Control a focus path names, or null (`get_node_or_null` then the Control cast). */
function focusPath(entity: Object3D, path: string): Object3D | null {
  const node = get_node_or_null(entity, path);
  if (node === null || typeof node !== 'object') return null;
  const target = godot_node_entity(node) as Object3D;
  return CONTROLS.has(target) ? target : null;
}

/** A Control child that focus search visits: visible in the tree and not top-level. */
function searchable(node: Object3D | undefined): node is Object3D {
  return node !== undefined && CONTROLS.has(node) && is_visible_in_tree(node) && !is_set_as_top_level(node);
}

/** `_next_control` (`control.cpp:3032`): the next searchable sibling, else the parent's. */
function nextControl(from: Object3D): Object3D | null {
  if (is_set_as_top_level(from)) return null;
  const parent = parentControl(from);
  if (parent === null) return null;
  const siblings = parent.children;
  for (let i = siblings.indexOf(from) + 1; i < siblings.length; i += 1) if (searchable(siblings[i])) return siblings[i] as Object3D;
  return nextControl(parent);
}

/** `_prev_control` (`control.cpp:3148`): the last searchable descendant along the last children. */
function prevControl(from: Object3D): Object3D {
  const children = from.children;
  for (let i = children.length - 1; i >= 0; i -= 1) if (searchable(children[i])) return prevControl(children[i] as Object3D);
  return from;
}

/** The root Control above a node (`data.RI`): the last Control up the parents, or a top-level one. */
function rootControl(entity: Object3D): Object3D {
  let node = entity;
  while (!is_set_as_top_level(node)) {
    const parent = parentControl(node);
    if (parent === null) break;
    node = parent;
  }
  return node;
}

/** The root Controls beside a root Control under its parent (`data.parent_window`'s children). */
function rootSiblings(root: Object3D): Object3D[] {
  return root.parent === null ? [root] : root.parent.children.filter((child) => CONTROLS.has(child));
}

/**
 * The next Control in tree order that takes focus from the keyboard (`FOCUS_ALL`): `focus_next`
 * when it names a focusable Control, else the first child, the next sibling up the parents, and
 * the next root Control in the viewport, wrapping around.
 *
 * @godot Control.find_next_valid_focus
 * @source scene/gui/control.cpp:3057
 */
export function find_next_valid_focus(self: object): object | null {
  const entity = entityOf(self);
  const state = stateOf(self, 'find_next_valid_focus');
  if (state.focusNext !== '') {
    const named = focusPath(entity, state.focusNext);
    if (named === null) return null;
    if (focusable(named)) return godot_node_object(named);
  }
  let from = entity;
  const checked = new Set<Object3D>([from]);
  let windowNext = -1;
  for (;;) {
    let next: Object3D | null = from.children.find(searchable) ?? null;
    if (next === null) {
      next = nextControl(from);
      if (next === null) {
        const root = rootControl(entity);
        const roots = rootSiblings(root);
        if (windowNext === -1) windowNext = roots.indexOf(root);
        for (let i = 1; i < roots.length + 1; i += 1) {
          const index = (((windowNext + i) % roots.length) + roots.length) % roots.length;
          const candidate = roots[index];
          if (!searchable(candidate)) continue;
          windowNext = index;
          next = candidate;
          break;
        }
      }
    }
    if (next === null) return null;
    if (focusModeWithOverride(next) === FOCUS_ALL) return godot_node_object(next);
    if (checked.has(next)) return null;
    checked.add(next);
    from = next;
  }
}

/**
 * The previous Control in tree order that takes focus from the keyboard: `focus_previous` when it
 * names a focusable Control, else the previous sibling's last descendant, the parent, and the
 * previous root Control in the viewport, wrapping around.
 *
 * @godot Control.find_prev_valid_focus
 * @source scene/gui/control.cpp:3164
 */
export function find_prev_valid_focus(self: object): object | null {
  const entity = entityOf(self);
  const state = stateOf(self, 'find_prev_valid_focus');
  if (state.focusPrevious !== '') {
    const named = focusPath(entity, state.focusPrevious);
    if (named === null) return null;
    if (focusable(named)) return godot_node_object(named);
  }
  let from = entity;
  const checked = new Set<Object3D>([from]);
  let windowPrev = -1;
  for (;;) {
    let prev: Object3D | null = null;
    const parent = parentControl(from);
    if (is_set_as_top_level(from) || parent === null) {
      const roots = rootSiblings(from);
      if (windowPrev === -1) windowPrev = roots.indexOf(from);
      for (let i = 1; i < roots.length + 1; i += 1) {
        const index = (((windowPrev - i) % roots.length) + roots.length) % roots.length;
        const candidate = roots[index];
        if (!searchable(candidate)) continue;
        windowPrev = index;
        prev = prevControl(candidate);
        break;
      }
      prev ??= prevControl(from);
    } else {
      const siblings = (from.parent as Object3D).children;
      for (let i = siblings.indexOf(from) - 1; i >= 0; i -= 1) {
        if (!searchable(siblings[i])) continue;
        prev = siblings[i] as Object3D;
        break;
      }
      prev = prev === null ? parent : prevControl(prev);
    }
    if (focusModeWithOverride(prev) === FOCUS_ALL) return godot_node_object(prev);
    if (checked.has(prev)) return null;
    checked.add(prev);
    from = prev;
  }
}

/** `MAX_NEIGHBOR_SEARCH_COUNT` (`control.cpp:3283`). */
const MAX_NEIGHBOR_SEARCH_COUNT = 512;
const FOCUS_DIRECTIONS = [vector2(-1, 0), vector2(0, -1), vector2(1, 0), vector2(0, 1)] as const;

/**
 * `_window_find_focus_neighbor` (`control.cpp:3409`): the keyboard-focusable Control past `min`
 * along `dir` whose rect lies nearest the node's.
 */
function findFocusNeighbor(self: Object3D, dir: Vector2, at: Object3D, rect: Rect2, min: number, best: { control: Object3D | null; distance: number }): void {
  if ((at as { readonly isScene?: boolean }).isScene === true) return;
  if (CONTROLS.has(at) && at !== self && focusModeWithOverride(at) === FOCUS_ALL) {
    const r = get_global_rect(at);
    const begin = f32(f32(dir.x * r.position.x) + f32(dir.y * r.position.y));
    const end = f32(f32(dir.x * f32(r.position.x + r.size.x)) + f32(dir.y * f32(r.position.y + r.size.y)));
    if (Math.max(begin, end) > f32(min + CMP_EPSILON)) {
      const cx = f32(f32(r.position.x + r.size.x / 2) - f32(rect.position.x + rect.size.x / 2));
      const cy = f32(f32(r.position.y + r.size.y / 2) - f32(rect.position.y + rect.size.y / 2));
      const abx = f32(Math.abs(cx) - 0.5 * r.size.x - 0.5 * rect.size.x);
      const aby = f32(Math.abs(cy) - 0.5 * r.size.y - 0.5 * rect.size.y);
      const distance = (abx > 0 ? abx * abx : 0) + (aby > 0 ? aby * aby : 0);
      if (distance < best.distance || best.control === null) {
        best.distance = distance;
        best.control = at;
      } else if (distance === best.distance) {
        // The tie goes to the Control most aligned with the direction.
        const closest = get_global_rect(best.control);
        const ox = f32(closest.position.x + closest.size.x / 2) - f32(rect.position.x + rect.size.x / 2);
        const oy = f32(closest.position.y + closest.size.y / 2) - f32(rect.position.y + rect.size.y / 2);
        if (Math.abs(dir.x * cy - dir.y * cx) < Math.abs(dir.x * oy - dir.y * ox)) best.control = at;
      }
    }
  }
  for (const child of at.children) {
    if (CONTROLS.has(child) && !is_visible_in_tree(child)) continue;
    findFocusNeighbor(self, dir, child, rect, min, best);
  }
}

/** `_get_focus_neighbor` (`control.cpp:3285`). */
function focusNeighbor(entity: Object3D, side: number, count: number): Object3D | null {
  if (count >= MAX_NEIGHBOR_SEARCH_COUNT) return null;
  const state = CONTROLS.get(entity) as ControlState;
  const path = state.focusNeighbor[side] as string;
  if (path !== '') {
    const named = focusPath(entity, path);
    if (named === null) return null;
    return focusable(named) ? named : focusNeighbor(named, side, count + 1);
  }
  const dir = FOCUS_DIRECTIONS[side] as Vector2;
  const rect = get_global_rect(entity);
  const begin = f32(f32(dir.x * rect.position.x) + f32(dir.y * rect.position.y));
  const end = f32(f32(dir.x * f32(rect.position.x + rect.size.x)) + f32(dir.y * f32(rect.position.y + rect.size.y)));
  const best = { control: null as Object3D | null, distance: 1e14 };
  findFocusNeighbor(entity, dir, rootControl(entity), rect, Math.max(begin, end), best);
  return best.control;
}

/**
 * The Control focus moves to from this one toward `side`: the neighbour its path names (or that
 * one's own, when it cannot take focus), else the nearest keyboard-focusable Control past the node's
 * edge within its root Control.
 *
 * @godot Control.find_valid_focus_neighbor
 * @source scene/gui/control.cpp:3405
 */
export function find_valid_focus_neighbor(self: object, p_side: number): object | null {
  stateOf(self, 'find_valid_focus_neighbor');
  if (p_side < 0 || p_side > 3) return null;
  const found = focusNeighbor(entityOf(self), p_side, 0);
  return found === null ? null : godot_node_object(found);
}

/**
 * An index outside the four sides fails.
 *
 * @godot Control.set_focus_neighbor
 * @source scene/gui/control.cpp:3251
 */
export function set_focus_neighbor(self: object, p_side: number, p_neighbor: string): void {
  if (p_side < 0 || p_side > 3) return;
  stateOf(self, 'set_focus_neighbor').focusNeighbor[p_side] = String(p_neighbor);
}

/**
 * @godot Control.get_focus_neighbor
 * @source scene/gui/control.cpp:3257
 */
export function get_focus_neighbor(self: object, p_side: number): string {
  if (p_side < 0 || p_side > 3) return '';
  return stateOf(self, 'get_focus_neighbor').focusNeighbor[p_side] as string;
}

/**
 * @godot Control.set_focus_next
 * @source scene/gui/control.cpp:3263
 */
export function set_focus_next(self: object, p_next: string): void {
  stateOf(self, 'set_focus_next').focusNext = String(p_next);
}

/**
 * @godot Control.get_focus_next
 * @source scene/gui/control.cpp:3268
 */
export function get_focus_next(self: object): string {
  return stateOf(self, 'get_focus_next').focusNext;
}

/**
 * @godot Control.set_focus_previous
 * @source scene/gui/control.cpp:3273
 */
export function set_focus_previous(self: object, p_prev: string): void {
  stateOf(self, 'set_focus_previous').focusPrevious = String(p_prev);
}

/**
 * @godot Control.get_focus_previous
 * @source scene/gui/control.cpp:3278
 */
export function get_focus_previous(self: object): string {
  return stateOf(self, 'get_focus_previous').focusPrevious;
}

// --- Theme items.

/** Whether the override applies to the asked type: none named, the node's class, or its variation. */
function overridesApply(entity: Object3D, state: ControlState, themeType: string): boolean {
  return themeType === '' || themeType === state.themeTypeVariation || godot_control_is(entity, themeType);
}

/** The default theme's item for the node's class, when the asked type is the node's own. */
function defaultItem<Value>(entity: Object3D, state: ControlState, themeType: string, items: Readonly<Record<string, Value>> | undefined, name: string): Value | undefined {
  if (themeType !== '' && !godot_control_is(entity, themeType)) return undefined;
  return items !== undefined && Object.hasOwn(items, name) ? items[name] : undefined;
}

/**
 * The node's color override, else the default theme's for its class, else `Color()`.
 *
 * @godot Control.get_theme_color
 * @source scene/gui/control.cpp:3768
 */
export function get_theme_color(self: object, p_name: string, p_theme_type = ''): Color {
  const entity = entityOf(self);
  const state = stateOf(self, 'get_theme_color');
  if (overridesApply(entity, state, p_theme_type) && state.colorOverrides.has(p_name)) return state.colorOverrides.get(p_name) as Color;
  return defaultItem(entity, state, p_theme_type, state.virtuals.themeColors, p_name) ?? color();
}

/**
 * The node's font size override, else the default theme's for its class, else the default font
 * size (16, `ThemeDB::fallback_font_size`).
 *
 * @godot Control.get_theme_font_size
 * @source scene/gui/control.cpp:3744
 */
export function get_theme_font_size(self: object, p_name: string, p_theme_type = ''): number {
  const entity = entityOf(self);
  const state = stateOf(self, 'get_theme_font_size');
  if (overridesApply(entity, state, p_theme_type) && state.fontSizeOverrides.has(p_name)) return state.fontSizeOverrides.get(p_name) as number;
  return defaultItem(entity, state, p_theme_type, state.virtuals.themeFontSizes, p_name) ?? DEFAULT_FONT_SIZE;
}

/**
 * The node's font override, else the default theme's font (every class's font is the default one).
 *
 * @godot Control.get_theme_font
 * @source scene/gui/control.cpp:3720
 */
export function get_theme_font(self: object, p_name: string, p_theme_type = ''): unknown {
  const entity = entityOf(self);
  const state = stateOf(self, 'get_theme_font');
  if (overridesApply(entity, state, p_theme_type) && state.fontOverrides.has(p_name)) return state.fontOverrides.get(p_name);
  return godot_font_default();
}

/**
 * The node's icon override, else null (no default-theme icons are bound).
 *
 * @godot Control.get_theme_icon
 * @source scene/gui/control.cpp:3672
 */
export function get_theme_icon(self: object, p_name: string, p_theme_type = ''): unknown {
  const entity = entityOf(self);
  const state = stateOf(self, 'get_theme_icon');
  if (overridesApply(entity, state, p_theme_type) && state.iconOverrides.has(p_name)) return state.iconOverrides.get(p_name);
  return null;
}

/**
 * The node's stylebox override, else null (no default-theme styleboxes are bound).
 *
 * @godot Control.get_theme_stylebox
 * @source scene/gui/control.cpp:3696
 */
export function get_theme_stylebox(self: object, p_name: string, p_theme_type = ''): unknown {
  const entity = entityOf(self);
  const state = stateOf(self, 'get_theme_stylebox');
  if (overridesApply(entity, state, p_theme_type) && state.styleboxOverrides.has(p_name)) return state.styleboxOverrides.get(p_name);
  return null;
}

/**
 * @godot Control.has_theme_color
 * @source scene/gui/control.cpp:3949
 */
export function has_theme_color(self: object, p_name: string, p_theme_type = ''): boolean {
  const entity = entityOf(self);
  const state = stateOf(self, 'has_theme_color');
  return (overridesApply(entity, state, p_theme_type) && state.colorOverrides.has(p_name)) || defaultItem(entity, state, p_theme_type, state.virtuals.themeColors, p_name) !== undefined;
}

/**
 * @godot Control.has_theme_font_size
 * @source scene/gui/control.cpp:3932
 */
export function has_theme_font_size(self: object, p_name: string, p_theme_type = ''): boolean {
  const entity = entityOf(self);
  const state = stateOf(self, 'has_theme_font_size');
  return (overridesApply(entity, state, p_theme_type) && state.fontSizeOverrides.has(p_name)) || defaultItem(entity, state, p_theme_type, state.virtuals.themeFontSizes, p_name) !== undefined;
}

/**
 * @godot Control.has_theme_constant
 * @source scene/gui/control.cpp:3966
 */
export function has_theme_constant(self: object, p_name: string, p_theme_type = ''): boolean {
  const entity = entityOf(self);
  const state = stateOf(self, 'has_theme_constant');
  return (overridesApply(entity, state, p_theme_type) && state.constantOverrides.has(p_name)) || defaultItem(entity, state, p_theme_type, state.virtuals.themeConstants, p_name) !== undefined;
}

/**
 * @godot Control.has_theme_font
 * @source scene/gui/control.cpp:3915
 */
export function has_theme_font(self: object, p_name: string, p_theme_type = ''): boolean {
  const entity = entityOf(self);
  const state = stateOf(self, 'has_theme_font');
  return overridesApply(entity, state, p_theme_type) && state.fontOverrides.has(p_name);
}

/**
 * @godot Control.has_theme_icon
 * @source scene/gui/control.cpp:3881
 */
export function has_theme_icon(self: object, p_name: string, p_theme_type = ''): boolean {
  const entity = entityOf(self);
  const state = stateOf(self, 'has_theme_icon');
  return overridesApply(entity, state, p_theme_type) && state.iconOverrides.has(p_name);
}

/**
 * @godot Control.has_theme_stylebox
 * @source scene/gui/control.cpp:3898
 */
export function has_theme_stylebox(self: object, p_name: string, p_theme_type = ''): boolean {
  const entity = entityOf(self);
  const state = stateOf(self, 'has_theme_stylebox');
  return overridesApply(entity, state, p_theme_type) && state.styleboxOverrides.has(p_name);
}

/** `ThemeDB::fallback_font_size` (`scene/theme/theme_db.cpp`), the default theme's font size. */
const DEFAULT_FONT_SIZE = 16;

/** An override setter: the item into its map, then `_notify_theme_override_changed`. */
function addOverride<Value>(self: object, member: string, pick: (state: ControlState) => Map<string, Value>, name: string, value: Value): void {
  pick(stateOf(self, member)).set(name, value);
  themeOverrideChanged(entityOf(self));
}

function removeOverride(self: object, member: string, pick: (state: ControlState) => Map<string, unknown>, name: string): void {
  pick(stateOf(self, member)).delete(name);
  themeOverrideChanged(entityOf(self));
}

/**
 * @godot Control.add_theme_color_override
 * @source scene/gui/control.cpp:4030
 */
export function add_theme_color_override(self: object, p_name: string, p_color: Color): void {
  addOverride(self, 'add_theme_color_override', (state) => state.colorOverrides, p_name, p_color);
}

/**
 * @godot Control.add_theme_font_size_override
 * @source scene/gui/control.cpp:4024
 */
export function add_theme_font_size_override(self: object, p_name: string, p_font_size: number): void {
  addOverride(self, 'add_theme_font_size_override', (state) => state.fontSizeOverrides, p_name, Math.trunc(p_font_size));
}

/**
 * A null font fails (`RequiredParam`).
 *
 * @godot Control.add_theme_font_override
 * @source scene/gui/control.cpp:4011
 */
export function add_theme_font_override(self: object, p_name: string, p_font: GodotFont | null): void {
  if (p_font === null) return;
  addOverride<unknown>(self, 'add_theme_font_override', (state) => state.fontOverrides, p_name, p_font);
}

/**
 * A null texture fails (`RequiredParam`).
 *
 * @godot Control.add_theme_icon_override
 * @source scene/gui/control.cpp:3985
 */
export function add_theme_icon_override(self: object, p_name: string, p_icon: object | null): void {
  if (p_icon === null) return;
  addOverride<unknown>(self, 'add_theme_icon_override', (state) => state.iconOverrides, p_name, p_icon);
}

/**
 * A null stylebox fails (`RequiredParam`).
 *
 * @godot Control.add_theme_stylebox_override
 * @source scene/gui/control.cpp:3998
 */
export function add_theme_stylebox_override(self: object, p_name: string, p_stylebox: object | null): void {
  if (p_stylebox === null) return;
  addOverride<unknown>(self, 'add_theme_stylebox_override', (state) => state.styleboxOverrides, p_name, p_stylebox);
}

/**
 * @godot Control.remove_theme_color_override
 * @source scene/gui/control.cpp:4078
 */
export function remove_theme_color_override(self: object, p_name: string): void {
  removeOverride(self, 'remove_theme_color_override', (state) => state.colorOverrides, p_name);
}

/**
 * @godot Control.remove_theme_font_size_override
 * @source scene/gui/control.cpp:4072
 */
export function remove_theme_font_size_override(self: object, p_name: string): void {
  removeOverride(self, 'remove_theme_font_size_override', (state) => state.fontSizeOverrides, p_name);
}

/**
 * @godot Control.remove_theme_font_override
 * @source scene/gui/control.cpp:4062
 */
export function remove_theme_font_override(self: object, p_name: string): void {
  removeOverride(self, 'remove_theme_font_override', (state) => state.fontOverrides, p_name);
}

/**
 * @godot Control.remove_theme_icon_override
 * @source scene/gui/control.cpp:4042
 */
export function remove_theme_icon_override(self: object, p_name: string): void {
  removeOverride(self, 'remove_theme_icon_override', (state) => state.iconOverrides, p_name);
}

/**
 * @godot Control.remove_theme_stylebox_override
 * @source scene/gui/control.cpp:4052
 */
export function remove_theme_stylebox_override(self: object, p_name: string): void {
  removeOverride(self, 'remove_theme_stylebox_override', (state) => state.styleboxOverrides, p_name);
}

/**
 * @godot Control.has_theme_color_override
 * @source scene/gui/control.cpp:4114
 */
export function has_theme_color_override(self: object, p_name: string): boolean {
  return stateOf(self, 'has_theme_color_override').colorOverrides.has(p_name);
}

/**
 * @godot Control.has_theme_font_size_override
 * @source scene/gui/control.cpp:4108
 */
export function has_theme_font_size_override(self: object, p_name: string): boolean {
  return stateOf(self, 'has_theme_font_size_override').fontSizeOverrides.has(p_name);
}

/**
 * @godot Control.has_theme_font_override
 * @source scene/gui/control.cpp:4102
 */
export function has_theme_font_override(self: object, p_name: string): boolean {
  return stateOf(self, 'has_theme_font_override').fontOverrides.has(p_name);
}

/**
 * @godot Control.has_theme_icon_override
 * @source scene/gui/control.cpp:4090
 */
export function has_theme_icon_override(self: object, p_name: string): boolean {
  return stateOf(self, 'has_theme_icon_override').iconOverrides.has(p_name);
}

/**
 * @godot Control.has_theme_stylebox_override
 * @source scene/gui/control.cpp:4096
 */
export function has_theme_stylebox_override(self: object, p_name: string): boolean {
  return stateOf(self, 'has_theme_stylebox_override').styleboxOverrides.has(p_name);
}

/**
 * Override changes made until `end_bulk_theme_override` announce the theme change once.
 *
 * @godot Control.begin_bulk_theme_override
 * @source scene/gui/control.cpp:4145
 */
export function begin_bulk_theme_override(self: object): void {
  stateOf(self, 'begin_bulk_theme_override').bulkThemeOverride = true;
}

/**
 * Fails outside a bulk override; else the theme change is announced.
 *
 * @godot Control.end_bulk_theme_override
 * @source scene/gui/control.cpp:4150
 */
export function end_bulk_theme_override(self: object): void {
  const state = stateOf(self, 'end_bulk_theme_override');
  if (!state.bulkThemeOverride) return;
  state.bulkThemeOverride = false;
  themeOverrideChanged(entityOf(self));
}

/**
 * The default theme's base scale, 1.
 *
 * @godot Control.get_theme_default_base_scale
 * @source scene/gui/control.cpp:4128
 */
export function get_theme_default_base_scale(self: object): number {
  stateOf(self, 'get_theme_default_base_scale');
  return 1;
}

/**
 * The default theme's font (`font.ts`).
 *
 * @godot Control.get_theme_default_font
 * @source scene/gui/control.cpp:4133
 */
export function get_theme_default_font(self: object): GodotFont {
  stateOf(self, 'get_theme_default_font');
  return godot_font_default();
}

/**
 * The default theme's font size, 16.
 *
 * @godot Control.get_theme_default_font_size
 * @source scene/gui/control.cpp:4138
 */
export function get_theme_default_font_size(self: object): number {
  stateOf(self, 'get_theme_default_font_size');
  return DEFAULT_FONT_SIZE;
}

/**
 * Kept and read back; the node's theme changes (`NOTIFICATION_THEME_CHANGED`). The Theme's own
 * items are not looked up (the module header).
 *
 * @godot Control.set_theme
 * @source scene/gui/control.cpp:3617
 */
export function set_theme(self: object, p_theme: object | null): void {
  const state = stateOf(self, 'set_theme');
  if (state.theme === p_theme) return;
  state.theme = p_theme;
  if (is_inside_tree(state.entity)) themeChanged(state.entity);
}

/**
 * @godot Control.get_theme
 * @source scene/gui/control.cpp:3649
 */
export function get_theme(self: object): object | null {
  return stateOf(self, 'get_theme').theme;
}

/**
 * The type the node's overrides also answer for; the theme changes.
 *
 * @godot Control.set_theme_type_variation
 * @source scene/gui/control.cpp:3654
 */
export function set_theme_type_variation(self: object, p_theme_type: string): void {
  const state = stateOf(self, 'set_theme_type_variation');
  if (state.themeTypeVariation === p_theme_type) return;
  state.themeTypeVariation = String(p_theme_type);
  if (is_inside_tree(state.entity)) themeChanged(state.entity);
}

/**
 * @godot Control.get_theme_type_variation
 * @source scene/gui/control.cpp:3665
 */
export function get_theme_type_variation(self: object): string {
  return stateOf(self, 'get_theme_type_variation').themeTypeVariation;
}

// --- Cursor, tooltip, translation and layout direction.

/**
 * The shape the pointer takes over the node, kept and read back (`CursorShape`, 17 of them); the
 * root viewport binds no cursor shapes over Controls (`viewport.ts`).
 *
 * @godot Control.set_default_cursor_shape
 * @source scene/gui/control.cpp:3508
 */
export function set_default_cursor_shape(self: object, p_shape: number): void {
  if (p_shape < 0 || p_shape >= 17) return;
  stateOf(self, 'set_default_cursor_shape').defaultCursorShape = p_shape;
}

/**
 * @godot Control.get_default_cursor_shape
 * @source scene/gui/control.cpp:3528
 */
export function get_default_cursor_shape(self: object): number {
  return stateOf(self, 'get_default_cursor_shape').defaultCursorShape;
}

/**
 * The default cursor shape (Control has no `_get_cursor_shape` of its own).
 *
 * @godot Control.get_cursor_shape
 * @source scene/gui/control.cpp:3533
 */
export function get_cursor_shape(self: object, p_pos: Vector2 = vector2()): number {
  void p_pos;
  return get_default_cursor_shape(self);
}

/**
 * @godot Control.set_tooltip_text
 * @source scene/gui/control.cpp:4315
 */
export function set_tooltip_text(self: object, p_hint: string): void {
  stateOf(self, 'set_tooltip_text').tooltipText = String(p_hint);
}

/**
 * @godot Control.get_tooltip_text
 * @source scene/gui/control.cpp:4321
 */
export function get_tooltip_text(self: object): string {
  return stateOf(self, 'get_tooltip_text').tooltipText;
}

/**
 * The tooltip text (Control has no `_get_tooltip` of its own).
 *
 * @godot Control.get_tooltip
 * @source scene/gui/control.cpp:4343
 */
export function get_tooltip(self: object, p_at_position: Vector2 = vector2()): string {
  void p_at_position;
  return get_tooltip_text(self);
}

/**
 * @godot Control.set_tooltip_auto_translate_mode
 * @source scene/gui/control.cpp:4294
 */
export function set_tooltip_auto_translate_mode(self: object, p_mode: number): void {
  stateOf(self, 'set_tooltip_auto_translate_mode').tooltipAutoTranslateMode = p_mode;
}

/**
 * @godot Control.get_tooltip_auto_translate_mode
 * @source scene/gui/control.cpp:4299
 */
export function get_tooltip_auto_translate_mode(self: object): number {
  return stateOf(self, 'get_tooltip_auto_translate_mode').tooltipAutoTranslateMode;
}

/**
 * @godot Control.set_translation_context
 * @source scene/gui/control.cpp:4326
 */
export function set_translation_context(self: object, p_context: string): void {
  stateOf(self, 'set_translation_context').translationContext = String(p_context);
}

/**
 * @godot Control.get_translation_context
 * @source scene/gui/control.cpp:4331
 */
export function get_translation_context(self: object): string {
  return stateOf(self, 'get_translation_context').translationContext;
}

/**
 * The deprecated switch for the node's auto translation (`AUTO_TRANSLATE_MODE_ALWAYS` or
 * `DISABLED`).
 *
 * @godot Control.set_auto_translate
 * @source scene/gui/control.cpp:4283
 */
export function set_auto_translate(self: object, p_enable: boolean): void {
  stateOf(self, 'set_auto_translate').autoTranslate = Boolean(p_enable);
}

/**
 * @godot Control.is_auto_translating
 * @source scene/gui/control.cpp:4288
 */
export function is_auto_translating(self: object): boolean {
  return stateOf(self, 'is_auto_translating').autoTranslate;
}

/**
 * @godot Control.set_localize_numeral_system
 * @source scene/gui/control.cpp:4266
 */
export function set_localize_numeral_system(self: object, p_enable: boolean): void {
  stateOf(self, 'set_localize_numeral_system').localizeNumeralSystem = Boolean(p_enable);
}

/**
 * @godot Control.is_localizing_numeral_system
 * @source scene/gui/control.cpp:4277
 */
export function is_localizing_numeral_system(self: object): boolean {
  return stateOf(self, 'is_localizing_numeral_system').localizeNumeralSystem;
}

/** `LayoutDirection` (`scene/gui/control.h:136`). */
const LAYOUT_DIRECTION_INHERITED = 0;
const LAYOUT_DIRECTION_LTR = 2;
const LAYOUT_DIRECTION_RTL = 3;
const LAYOUT_DIRECTION_MAX = 5;

/**
 * `LAYOUT_DIRECTION_INHERITED` (0), `APPLICATION_LOCALE` (1), `LTR` (2), `RTL` (3) or
 * `SYSTEM_LOCALE` (4); another index fails.
 *
 * @godot Control.set_layout_direction
 * @source scene/gui/control.cpp:4171
 */
export function set_layout_direction(self: object, p_direction: number): void {
  if (p_direction < 0 || p_direction >= LAYOUT_DIRECTION_MAX) return;
  stateOf(self, 'set_layout_direction').layoutDirection = p_direction;
}

/**
 * @godot Control.get_layout_direction
 * @source scene/gui/control.cpp:4183
 */
export function get_layout_direction(self: object): number {
  return stateOf(self, 'get_layout_direction').layoutDirection;
}

/**
 * `TextServer::is_locale_right_to_left` of the page's locale (`navigator.language`, which the web
 * platform's `OS::get_locale` reads): a locale written in a right-to-left script.
 */
function localeRightToLeft(): boolean {
  const locale = (globalThis as { readonly navigator?: { readonly language?: string } }).navigator?.language ?? 'en';
  const language = locale.toLowerCase().split(/[-_]/u)[0] ?? '';
  return ['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug', 'yi', 'dv', 'ckb', 'syr', 'nqo'].includes(language);
}

/**
 * Right to left when set so; inherited from the parent Control, else the root's direction, the
 * locale's; the locale's for the locale modes. The layout itself stays left to right (the module
 * header).
 *
 * @godot Control.is_layout_rtl
 * @source scene/gui/control.cpp:4188
 */
export function is_layout_rtl(self: object): boolean {
  const state = stateOf(self, 'is_layout_rtl');
  if (state.layoutDirection === LAYOUT_DIRECTION_RTL) return true;
  if (state.layoutDirection === LAYOUT_DIRECTION_LTR) return false;
  if (state.layoutDirection === LAYOUT_DIRECTION_INHERITED) {
    const parent = parentControl(state.entity);
    if (parent !== null) return is_layout_rtl(parent);
  }
  return localeRightToLeft();
}

// --- Accessibility: kept and read back (the page's accessibility tree is not built from them).

/**
 * @godot Control.set_accessibility_name
 * @source scene/gui/control.cpp:2799
 */
export function set_accessibility_name(self: object, p_name: string): void {
  stateOf(self, 'set_accessibility_name').accessibility.name = String(p_name);
}

/**
 * @godot Control.get_accessibility_name
 * @source scene/gui/control.cpp:2808
 */
export function get_accessibility_name(self: object): string {
  return stateOf(self, 'get_accessibility_name').accessibility.name;
}

/**
 * @godot Control.set_accessibility_description
 * @source scene/gui/control.cpp:2812
 */
export function set_accessibility_description(self: object, p_description: string): void {
  stateOf(self, 'set_accessibility_description').accessibility.description = String(p_description);
}

/**
 * @godot Control.get_accessibility_description
 * @source scene/gui/control.cpp:2820
 */
export function get_accessibility_description(self: object): string {
  return stateOf(self, 'get_accessibility_description').accessibility.description;
}

/**
 * @godot Control.set_accessibility_live
 * @source scene/gui/control.cpp:2824
 */
export function set_accessibility_live(self: object, p_mode: number): void {
  stateOf(self, 'set_accessibility_live').accessibility.live = p_mode;
}

/**
 * @godot Control.get_accessibility_live
 * @source scene/gui/control.cpp:2832
 */
export function get_accessibility_live(self: object): number {
  return stateOf(self, 'get_accessibility_live').accessibility.live;
}

/**
 * @godot Control.set_accessibility_controls_nodes
 * @source scene/gui/control.cpp:2836
 */
export function set_accessibility_controls_nodes(self: object, p_node_path: string[]): void {
  stateOf(self, 'set_accessibility_controls_nodes').accessibility.controls = p_node_path;
}

/**
 * @godot Control.get_accessibility_controls_nodes
 * @source scene/gui/control.cpp:2844
 */
export function get_accessibility_controls_nodes(self: object): string[] {
  return stateOf(self, 'get_accessibility_controls_nodes').accessibility.controls;
}

/**
 * @godot Control.set_accessibility_described_by_nodes
 * @source scene/gui/control.cpp:2848
 */
export function set_accessibility_described_by_nodes(self: object, p_node_path: string[]): void {
  stateOf(self, 'set_accessibility_described_by_nodes').accessibility.describedBy = p_node_path;
}

/**
 * @godot Control.get_accessibility_described_by_nodes
 * @source scene/gui/control.cpp:2856
 */
export function get_accessibility_described_by_nodes(self: object): string[] {
  return stateOf(self, 'get_accessibility_described_by_nodes').accessibility.describedBy;
}

/**
 * @godot Control.set_accessibility_labeled_by_nodes
 * @source scene/gui/control.cpp:2860
 */
export function set_accessibility_labeled_by_nodes(self: object, p_node_path: string[]): void {
  stateOf(self, 'set_accessibility_labeled_by_nodes').accessibility.labeledBy = p_node_path;
}

/**
 * @godot Control.get_accessibility_labeled_by_nodes
 * @source scene/gui/control.cpp:2868
 */
export function get_accessibility_labeled_by_nodes(self: object): string[] {
  return stateOf(self, 'get_accessibility_labeled_by_nodes').accessibility.labeledBy;
}

/**
 * @godot Control.set_accessibility_flow_to_nodes
 * @source scene/gui/control.cpp:2872
 */
export function set_accessibility_flow_to_nodes(self: object, p_node_path: string[]): void {
  stateOf(self, 'set_accessibility_flow_to_nodes').accessibility.flowTo = p_node_path;
}

/**
 * @godot Control.get_accessibility_flow_to_nodes
 * @source scene/gui/control.cpp:2880
 */
export function get_accessibility_flow_to_nodes(self: object): string[] {
  return stateOf(self, 'get_accessibility_flow_to_nodes').accessibility.flowTo;
}
