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
import type { Vector2 } from './vector2';

/** What the class that places and draws a canvas item gives it. */
export interface CanvasItemClass {
  /** `get_transform()`. */
  readonly transform: (entity: Object3D) => Transform2D;
  /** The transform the item draws with (`canvas_item_set_transform`); `transform` by default. */
  readonly drawTransform?: (entity: Object3D) => Transform2D;
  /** The size of the item's box (a Control's size); none by default. */
  readonly size?: (entity: Object3D) => Vector2;
  /** `NOTIFICATION_VISIBILITY_CHANGED` and the `visibility_changed` signal's listeners. */
  readonly visibilityChanged?: (entity: Object3D) => void;
  /** `NOTIFICATION_DRAW`: the item's own drawing, into its element. */
  readonly draw?: (entity: Object3D, element: HTMLElement) => void;
}

interface CanvasItemState {
  /** The item's Godot class and its native ancestors, nearest first. */
  readonly classes: readonly string[];
  readonly class: CanvasItemClass;
  visible: boolean;
  topLevel: boolean;
  modulate: Color;
  selfModulate: Color;
  zIndex: number;
  zRelative: boolean;
}

interface CanvasLayerLink {
  readonly layer: (entity: Object3D) => number;
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
 * Makes `entity` a canvas item of `classes` (nearest first), placed and drawn as its class says,
 * with CanvasItem's defaults (`scene/main/canvas_item.h:96-121`).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:1901
 */
export function godot_canvas_item_mount(entity: Object3D, classes: readonly string[], itemClass: CanvasItemClass): void {
  ITEMS.set(entity, {
    classes: Object.freeze([...classes]),
    class: itemClass,
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
 * The canvas layer an item draws in: its top parent item's, which is the nearest canvas layer above
 * it before a viewport, or null for the viewport's own canvas (`CanvasItem::_enter_canvas`,
 * `canvas_item.cpp:258`).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:258
 */
export function godot_canvas_item_layer_of(entity: Object3D): Object3D | null {
  let item = entity;
  for (let parent = godot_canvas_item_parent(item); parent !== null; parent = godot_canvas_item_parent(item)) item = parent;
  for (let node: Object3D | null = item; node !== null; node = node.parent) {
    if (LAYERS.has(node)) return node;
    if ((node as { readonly isScene?: boolean }).isScene === true) return null;
  }
  return null;
}

/**
 * A canvas layer's `layer`, which orders the viewport's root Controls (`CanvasItem::get_canvas_layer`).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:1700
 */
export function godot_canvas_item_layer_number(layer: Object3D): number {
  return LAYERS.get(layer)?.layer(layer) ?? 0;
}

/**
 * `CanvasItem::get_canvas_transform` (`canvas_item.cpp:1647`): the canvas layer's final transform,
 * else the viewport's canvas transform (the identity: the host never moves the root canvas).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:1647
 */
export function godot_canvas_item_canvas_transform(entity: Object3D): Transform2D {
  const layer = godot_canvas_item_layer_of(entity);
  return layer === null ? transform2d() : (LAYERS.get(layer) as CanvasLayerLink).finalTransform(layer);
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
  ITEMS.get(entity)?.class.visibilityChanged?.(entity);
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
    state.class.visibilityChanged?.(entity);
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
  return stateOf(self, 'get_transform').class.transform(entityOf(self));
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
  const own = state.class.transform(entity);
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

// --- Drawing onto the page.

const ELEMENTS = new WeakMap<Object3D, HTMLElement>();
const CANVASES = new WeakMap<HTMLElement, HTMLElement>();
const FILTERS = new WeakMap<HTMLElement, Map<string, string>>();
let filterSerial = 0;

/** CSS `matrix(a, b, c, d, e, f)` of a Transform2D: its columns and origin. */
function matrix(transform: Transform2D): string {
  return `matrix(${String(transform.x.x)}, ${String(transform.x.y)}, ${String(transform.y.x)}, ${String(transform.y.y)}, ${String(transform.origin.x)}, ${String(transform.origin.y)})`;
}

/**
 * The CSS filter multiplying a drawing by `modulate` (an SVG `feColorMatrix` scaling each channel,
 * in sRGB as the Compatibility renderer's 2D shader multiplies, `canvas.glsl`), or none for white.
 */
function colorFilter(root: HTMLElement, modulate: Color): string {
  if (modulate.r === 1 && modulate.g === 1 && modulate.b === 1 && modulate.a === 1) return '';
  let filters = FILTERS.get(root);
  if (filters === undefined) {
    filters = new Map();
    FILTERS.set(root, filters);
  }
  const values = `${String(modulate.r)} 0 0 0 0 0 ${String(modulate.g)} 0 0 0 0 0 ${String(modulate.b)} 0 0 0 0 0 ${String(modulate.a)} 0`;
  let id = filters.get(values);
  if (id === undefined) {
    const document = root.ownerDocument;
    const namespace = 'http://www.w3.org/2000/svg';
    let defs = root.querySelector(':scope > svg[data-godot-filters] > defs');
    if (defs === null) {
      const svg = document.createElementNS(namespace, 'svg');
      svg.setAttribute('data-godot-filters', '');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('style', 'position:absolute');
      defs = document.createElementNS(namespace, 'defs');
      svg.appendChild(defs);
      root.appendChild(svg);
    }
    id = `godot-modulate-${String((filterSerial += 1))}`;
    const filter = document.createElementNS(namespace, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const colorMatrix = document.createElementNS(namespace, 'feColorMatrix');
    colorMatrix.setAttribute('type', 'matrix');
    colorMatrix.setAttribute('values', values);
    filter.appendChild(colorMatrix);
    defs.appendChild(filter);
    filters.set(values, id);
  }
  return `url(#${id})`;
}

function elementOf(entity: Object3D, document: Document): HTMLElement {
  let element = ELEMENTS.get(entity);
  if (element === undefined) {
    element = document.createElement('div');
    element.dataset['godot'] = entity.name;
    ELEMENTS.set(entity, element);
  }
  return element;
}

/** The viewport's own canvas (layer 0) inside `root`. */
function viewportCanvas(root: HTMLElement): HTMLElement {
  let canvas = CANVASES.get(root);
  if (canvas === undefined) {
    canvas = root.ownerDocument.createElement('div');
    canvas.dataset['godot'] = '';
    canvas.style.position = 'absolute';
    canvas.style.left = '0px';
    canvas.style.top = '0px';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none';
    CANVASES.set(root, canvas);
  }
  return canvas;
}

/**
 * The filter a class applies to its own drawing only (`self_modulate`, `canvas_item_set_self_modulate`).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:655
 */
export function godot_canvas_item_self_filter(entity: Object3D, element: HTMLElement): string {
  const root = element.closest('[data-godot-root]') as HTMLElement | null;
  return root === null ? '' : colorFilter(root, (ITEMS.get(entity) as CanvasItemState).selfModulate);
}

/**
 * Draws a viewport's canvas items onto the page, under `root`: the viewport's own canvas and each
 * canvas layer as a full-size element stacked by its layer (`z-index`) with the layer's final
 * transform, each canvas item as an element in its parent item's (or its canvas's), placed by the
 * transform it draws with (`transform-origin` at its top-left), sized as its box, hidden when not
 * visible (with its children, as Godot hides them), its `modulate` a filter on it and its children,
 * its `z_index` its stacking among its siblings, and its own drawing inside. Elements of nodes no
 * longer in the viewport are removed. The host calls it each frame it renders.
 *
 * @godot CanvasItem (protocol)
 * @source servers/rendering/renderer_canvas_cull.cpp:304
 */
export function godot_canvas_draw(viewport: Object3D, root: HTMLElement): void {
  const document = root.ownerDocument;
  root.dataset['godotRoot'] = '';
  const touched = new Set<HTMLElement>();
  const own = viewportCanvas(root);
  own.style.transform = '';
  root.appendChild(own);
  touched.add(own);
  const visit = (node: Object3D, container: HTMLElement, canvas: HTMLElement): void => {
    for (const child of node.children) {
      if ((child as { readonly isScene?: boolean }).isScene === true) continue;
      const layer = LAYERS.get(child);
      if (layer !== undefined) {
        const element = elementOf(child, document);
        element.style.position = 'absolute';
        element.style.left = '0px';
        element.style.top = '0px';
        element.style.width = '100%';
        element.style.height = '100%';
        element.style.pointerEvents = 'none';
        element.style.zIndex = String(layer.layer(child));
        element.style.transformOrigin = '0px 0px';
        element.style.transform = matrix(layer.finalTransform(child));
        element.style.display = layer.visible(child) ? '' : 'none';
        root.appendChild(element);
        touched.add(element);
        visit(child, element, element);
        continue;
      }
      const state = ITEMS.get(child);
      if (state === undefined) {
        visit(child, canvas, canvas);
        continue;
      }
      const element = elementOf(child, document);
      const size = state.class.size?.(child);
      element.style.position = 'absolute';
      element.style.left = '0px';
      element.style.top = '0px';
      element.style.width = `${String(size?.x ?? 0)}px`;
      element.style.height = `${String(size?.y ?? 0)}px`;
      element.style.transformOrigin = '0px 0px';
      element.style.transform = matrix((state.class.drawTransform ?? state.class.transform)(child));
      element.style.display = state.visible ? '' : 'none';
      element.style.zIndex = String(state.zIndex);
      element.style.filter = colorFilter(root, state.modulate);
      (state.topLevel ? canvas : container).appendChild(element);
      touched.add(element);
      state.class.draw?.(child, element);
      visit(child, element, canvas);
    }
  };
  visit(viewport, own, own);
  for (const element of [...root.querySelectorAll<HTMLElement>('[data-godot]')]) {
    if (!touched.has(element) && element.parentElement !== null && !element.hasAttribute('data-godot-content')) element.remove();
  }
}
