/**
 * @godot-class CanvasItem
 * @role BINDING
 *
 * Godot 4.7's `CanvasItem` (`scene/main/canvas_item.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the page's DOM: a canvas item draws as one
 * absolutely placed element under its parent item's element, its canvas layer's element, or the
 * viewport's root element (canvas layer 0). The node itself is its native entity, a non-spatial
 * three `Group` as for a plain Node (`node.ts`), so the Node protocol keeps its tree; the element
 * and Godot's CanvasItem state live here, keyed by the entity.
 *
 * Visibility is Godot's: `visible` and `parent_visible_in_tree`, which is set when the item enters
 * the tree (its parent item's `is_visible_in_tree()`, a canvas layer's `is_visible()`, else a
 * visible viewport) and updated as visibility propagates (`_propagate_visibility_changed`); here it
 * is read from the parents when asked, which is what the propagation keeps it equal to. The global
 * transform is the parent item's global transform times the item's own `get_transform()`, which
 * the class that places the item (Control, Node2D) gives when it mounts the item.
 */

import type { Object3D } from 'three';
import { type Color, construct as color } from './color';
import { godot_node_entity, is_inside_tree } from './node';
import { construct as transform2d, op_multiply, type Transform2D } from './transform-2d';

interface CanvasItemState {
  /** The item's Godot class and its native ancestors, nearest first. */
  readonly classes: readonly string[];
  readonly transform: (entity: Object3D) => Transform2D;
  visible: boolean;
  topLevel: boolean;
  modulate: Color;
  selfModulate: Color;
  zIndex: number;
  zRelative: boolean;
  /** The class's `NOTIFICATION_VISIBILITY_CHANGED` and the `visibility_changed` signal's listeners. */
  readonly visibilityChanged: ((entity: Object3D) => void) | undefined;
}

interface CanvasLayerLink {
  readonly visible: (entity: Object3D) => boolean;
  readonly finalTransform: (entity: Object3D) => Transform2D;
}

const ITEMS = new WeakMap<Object3D, CanvasItemState>();
const LAYERS = new WeakMap<Object3D, CanvasLayerLink>();

/** `CANVAS_ITEM_Z_MIN`, `CANVAS_ITEM_Z_MAX` (`servers/rendering/rendering_server_enums.h:40`). */
const Z_MIN = -4096;
const Z_MAX = 4096;

function entityOf(self: object): Object3D {
  return godot_node_entity(self) as Object3D;
}

function stateOf(self: object, member: string): CanvasItemState {
  const state = ITEMS.get(entityOf(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a CanvasItem`);
  return state;
}

/**
 * Makes `entity` a canvas item of `classes` (nearest first), placed by `transform` (the class's
 * `get_transform()`), with CanvasItem's defaults (`scene/main/canvas_item.h:96-121`).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:1901
 */
export function godot_canvas_item_mount(
  entity: Object3D,
  classes: readonly string[],
  transform: (entity: Object3D) => Transform2D,
  visibilityChanged?: (entity: Object3D) => void,
): void {
  ITEMS.set(entity, {
    classes: Object.freeze([...classes]),
    transform,
    visibilityChanged,
    visible: true,
    topLevel: false,
    modulate: color(1, 1, 1, 1),
    selfModulate: color(1, 1, 1, 1),
    zIndex: 0,
    zRelative: true,
  });
}

/**
 * Registers a canvas layer: what its children read of its visibility and final transform.
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:400
 */
export function godot_canvas_item_layer(entity: Object3D, link: CanvasLayerLink): void {
  LAYERS.set(entity, link);
}

/**
 * Whether `entity` is a canvas item of class `className` (or a class deriving from it).
 *
 * @godot CanvasItem (protocol)
 * @source core/object/object.h:677
 */
export function godot_canvas_item_is(entity: object, className: string): boolean {
  return ITEMS.get(entity as Object3D)?.classes.includes(className) ?? false;
}

/**
 * The parent node's entity when it is a canvas item and the item is not top-level
 * (`CanvasItem::get_parent_item`, `canvas_item.cpp:646`).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:646
 */
export function godot_canvas_item_parent(entity: Object3D): Object3D | null {
  const state = ITEMS.get(entity);
  if (state === undefined || state.topLevel) return null;
  const parent = entity.parent;
  return parent !== null && ITEMS.has(parent) ? parent : null;
}

/**
 * The canvas layer an item draws in: the nearest canvas-layer ancestor above its chain of canvas
 * items, or null for the viewport's own canvas (`CanvasItem::_enter_canvas`, `canvas_item.cpp:258`).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:258
 */
export function godot_canvas_item_layer_of(entity: Object3D): Object3D | null {
  let node: Object3D | null = entity;
  while (node !== null && ITEMS.has(node)) node = node.parent;
  return node !== null && LAYERS.has(node) ? node : null;
}

/**
 * `parent_visible_in_tree` as `NOTIFICATION_ENTER_TREE` sets it and visibility propagation keeps
 * it (`canvas_item.cpp:383`): outside the tree false; under a canvas item, that item's
 * `is_visible_in_tree()`; under a canvas layer, the layer's `is_visible()`; else the viewport, a
 * window only when visible (the root window is).
 */
function parentVisibleInTree(entity: Object3D): boolean {
  if (!is_inside_tree(entity)) return false;
  const parent = entity.parent;
  if (parent === null) return true;
  if (ITEMS.has(parent)) return is_visible_in_tree(parent);
  const layer = LAYERS.get(parent);
  if (layer !== undefined) return layer.visible(parent);
  return true;
}

/**
 * `_handle_visibility_change` (`canvas_item.cpp:102`): the item is notified, then each child canvas
 * item that is itself visible handles the change in turn (`_propagate_visibility_changed`).
 */
function handleVisibilityChange(entity: Object3D): void {
  ITEMS.get(entity)?.visibilityChanged?.(entity);
  for (const child of [...entity.children]) godot_canvas_item_propagate_visibility(child);
}

/**
 * `_propagate_visibility_changed` (`canvas_item.cpp:77`): a child whose parent's visibility changed
 * handles it when it is visible itself (its `parent_visible_in_tree` is read from the parent here).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:77
 */
export function godot_canvas_item_propagate_visibility(entity: Object3D): void {
  const state = ITEMS.get(entity);
  if (state === undefined || !state.visible) return;
  handleVisibilityChange(entity);
}

/**
 * An item whose parent is not visible in the tree is only notified; otherwise the change
 * propagates to its visible children.
 *
 * @godot CanvasItem.set_visible
 * @source scene/main/canvas_item.cpp:86
 */
export function set_visible(self: object, p_visible: boolean): void {
  const state = stateOf(self, 'set_visible');
  if (state.visible === p_visible) return;
  state.visible = p_visible;
  const entity = entityOf(self);
  if (!parentVisibleInTree(entity)) {
    state.visibilityChanged?.(entity);
    return;
  }
  handleVisibilityChange(entity);
}

/**
 * @godot CanvasItem.is_visible
 * @source scene/main/canvas_item.cpp:133
 */
export function is_visible(self: object): boolean {
  return stateOf(self, 'is_visible').visible;
}

/**
 * @godot CanvasItem.show
 * @source scene/main/canvas_item.cpp:123
 */
export function show(self: object): void {
  set_visible(self, true);
}

/**
 * @godot CanvasItem.hide
 * @source scene/main/canvas_item.cpp:128
 */
export function hide(self: object): void {
  set_visible(self, false);
}

/**
 * `visible && parent_visible_in_tree`.
 *
 * @godot CanvasItem.is_visible_in_tree
 * @source scene/main/canvas_item.cpp:72
 */
export function is_visible_in_tree(self: object): boolean {
  const state = stateOf(self, 'is_visible_in_tree');
  return state.visible && parentVisibleInTree(entityOf(self));
}

/**
 * @godot CanvasItem.set_modulate
 * @source scene/main/canvas_item.cpp:575
 */
export function set_modulate(self: object, p_modulate: Color): void {
  stateOf(self, 'set_modulate').modulate = p_modulate;
}

/**
 * @godot CanvasItem.get_modulate
 * @source scene/main/canvas_item.cpp:585
 */
export function get_modulate(self: object): Color {
  return stateOf(self, 'get_modulate').modulate;
}

/**
 * @godot CanvasItem.set_self_modulate
 * @source scene/main/canvas_item.cpp:655
 */
export function set_self_modulate(self: object, p_self_modulate: Color): void {
  stateOf(self, 'set_self_modulate').selfModulate = p_self_modulate;
}

/**
 * @godot CanvasItem.get_self_modulate
 * @source scene/main/canvas_item.cpp:665
 */
export function get_self_modulate(self: object): Color {
  return stateOf(self, 'get_self_modulate').selfModulate;
}

/**
 * A value outside the rendering server's range fails and is ignored (`canvas_item.cpp:771`).
 *
 * @godot CanvasItem.set_z_index
 * @source scene/main/canvas_item.cpp:769
 */
export function set_z_index(self: object, p_z: number): void {
  if (p_z < Z_MIN || p_z > Z_MAX) return;
  stateOf(self, 'set_z_index').zIndex = p_z;
}

/**
 * @godot CanvasItem.get_z_index
 * @source scene/main/canvas_item.cpp:791
 */
export function get_z_index(self: object): number {
  return stateOf(self, 'get_z_index').zIndex;
}

/**
 * @godot CanvasItem.set_z_as_relative
 * @source scene/main/canvas_item.cpp:777
 */
export function set_z_as_relative(self: object, p_enabled: boolean): void {
  stateOf(self, 'set_z_as_relative').zRelative = p_enabled;
}

/**
 * @godot CanvasItem.is_z_relative
 * @source scene/main/canvas_item.cpp:787
 */
export function is_z_relative(self: object): boolean {
  return stateOf(self, 'is_z_relative').zRelative;
}

/**
 * @godot CanvasItem.set_as_top_level
 * @source scene/main/canvas_item.cpp:601
 */
export function set_as_top_level(self: object, p_top_level: boolean): void {
  stateOf(self, 'set_as_top_level').topLevel = p_top_level;
}

/**
 * @godot CanvasItem.is_set_as_top_level
 * @source scene/main/canvas_item.cpp:642
 */
export function is_set_as_top_level(self: object): boolean {
  return stateOf(self, 'is_set_as_top_level').topLevel;
}

/**
 * The item's own transform, as its class places it (Control's layout, Node2D's position, rotation,
 * skew and scale).
 *
 * @godot CanvasItem.get_transform
 * @source scene/main/canvas_item.cpp:1527
 */
export function get_transform(self: object): Transform2D {
  return stateOf(self, 'get_transform').transform(entityOf(self));
}

/**
 * The parent item's global transform times this item's `get_transform()`, or the item's own
 * without a parent item.
 *
 * @godot CanvasItem.get_global_transform
 * @source scene/main/canvas_item.cpp:200
 */
export function get_global_transform(self: object): Transform2D {
  const entity = entityOf(self);
  const state = stateOf(self, 'get_global_transform');
  const own = state.transform(entity);
  const parent = godot_canvas_item_parent(entity);
  return parent === null ? own : op_multiply(get_global_transform(parent), own);
}

/**
 * The canvas layer's final transform times the global transform; the viewport's canvas transform
 * (the identity: the host never moves the root canvas) without a layer; the global transform alone
 * outside the tree.
 *
 * @godot CanvasItem.get_global_transform_with_canvas
 * @source scene/main/canvas_item.cpp:183
 */
export function get_global_transform_with_canvas(self: object): Transform2D {
  const entity = entityOf(self);
  const global = get_global_transform(self);
  const layer = godot_canvas_item_layer_of(entity);
  if (layer !== null) return op_multiply((LAYERS.get(layer) as CanvasLayerLink).finalTransform(layer), global);
  if (is_inside_tree(entity)) return op_multiply(transform2d(), global);
  return global;
}
