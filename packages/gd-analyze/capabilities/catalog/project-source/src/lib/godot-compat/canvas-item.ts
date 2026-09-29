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
import { godot_canvas_item_material_css_blend } from './canvas-item-material';
import { godot_input_mouse_position } from './input';
import { get_viewport, godot_node_entity, is_inside_tree } from './node';
import type { Rect2 } from './rect2';
import { get_visible_rect } from './viewport';
import { affine_inverse, construct as transform2d, op_multiply, type Transform2D } from './transform-2d';
import type { Vector2 } from './vector2';
import type { GodotElementProp } from './react-lifecycle';

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
  /**
   * The state `draw` reads, as a key: the item is drawn again only when it changes (the redraw its
   * setters queue, `CanvasItem::queue_redraw`, `canvas_item.cpp:469`). Without one, the item is
   * drawn every frame.
   */
  readonly drawKey?: (entity: Object3D, element: HTMLElement) => string;
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
  /** Its material, and whether it draws with its parent's instead (`use_parent_material`). */
  material: object | null;
  useParentMaterial: boolean;
  /** `TextureFilter` and `TextureRepeat` (`canvas_item.h:52`); 0 takes the parent's. */
  textureFilter: number;
  textureRepeat: number;
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
    material: null,
    useParentMaterial: false,
    textureFilter: 0,
    textureRepeat: 0,
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
 * A canvas item's Godot class and its native ancestors, nearest first.
 *
 * @godot CanvasItem (protocol)
 * @source core/object/object.h:677
 */
export function godot_canvas_item_classes(entity: object): readonly string[] {
  return ITEMS.get(entity as Object3D)?.classes ?? [];
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
  return layer === null ? rootCanvasTransform : (LAYERS.get(layer) as CanvasLayerLink).finalTransform(layer);
}

/** The root viewport's canvas transform, which its current Camera2D sets (`Viewport::set_canvas_transform`). */
let rootCanvasTransform: Transform2D = transform2d();

/**
 * Sets the root viewport's canvas transform (a current Camera2D's view, `camera_2d.cpp:326`): the
 * canvas's items outside a canvas layer draw through it.
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/viewport.cpp:1111
 */
export function godot_canvas_item_set_canvas_transform(transform: Transform2D): void {
  rootCanvasTransform = transform;
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
  if (is_inside_tree(entity)) return op_multiply(rootCanvasTransform, global);
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

/** The last value compat wrote to each of an element's style properties. */
const STYLES = new WeakMap<HTMLElement, Map<string, string>>();

/** Writes a style property only when its value changed (`canvas_item_set_*` sends a change). */
function put(element: HTMLElement, property: 'position' | 'left' | 'top' | 'width' | 'height' | 'pointerEvents' | 'zIndex' | 'transformOrigin' | 'transform' | 'display' | 'filter' | 'mixBlendMode' | 'imageRendering', value: string): void {
  let written = STYLES.get(element);
  if (written === undefined) {
    written = new Map();
    STYLES.set(element, written);
  }
  if (written.get(property) === value) return;
  written.set(property, value);
  element.style[property] = value;
}

/** Each drawn item's last draw key. */
const DRAWN = new WeakMap<Object3D, string>();

/**
 * Where a canvas item's element goes: its nearest canvas item's element (a layer's own element for
 * the items under it), else its viewport's own canvas; and the canvas a top-level item goes in (its
 * layer's element, else the viewport's canvas). Undefined when the node is not under `viewport`
 * (another viewport's scene, or out of the tree).
 */
function placeOf(entity: Object3D, viewport: Object3D, root: HTMLElement): { readonly container: HTMLElement; readonly canvas: HTMLElement } | undefined {
  const document = root.ownerDocument;
  let container: HTMLElement | undefined;
  let canvas: HTMLElement | undefined;
  for (let node = entity.parent; node !== null; node = node.parent) {
    if (node === viewport) {
      const own = viewportCanvas(root);
      return { container: container ?? own, canvas: canvas ?? own };
    }
    if ((node as { readonly isScene?: boolean }).isScene === true) return undefined;
    if (LAYERS.has(node)) {
      const element = elementOf(node, document);
      container ??= element;
      canvas ??= element;
    } else if (ITEMS.has(node)) container ??= elementOf(node, document);
  }
  return undefined;
}

/** Puts an item's element in `parent`, before the element of the next sibling already there (tree order). */
function placeIn(entity: Object3D, element: HTMLElement, parent: HTMLElement): void {
  if (element.parentElement === parent) return;
  const siblings = entity.parent?.children ?? [];
  for (const sibling of siblings.slice(siblings.indexOf(entity) + 1)) {
    const next = ELEMENTS.get(sibling);
    if (next?.parentElement === parent) {
      parent.insertBefore(element, next);
      return;
    }
  }
  parent.appendChild(element);
}

/**
 * Draws one canvas item or canvas layer onto the page, under `root` (the root Window's canvas
 * layer): a layer as a full-size element stacked by its layer (`z-index`) with its final transform;
 * an item as an element in its parent item's (or its canvas's), placed by the transform it draws
 * with (`transform-origin` at its top-left), sized as its box, hidden when not visible (with its
 * children, as Godot hides them), its `modulate` a filter on it and its children, its `z_index` its
 * stacking among its siblings, and its own drawing inside. As the rendering server keeps what it was
 * sent, only what changed is written: a style when its value did, the drawing when its draw key did.
 * An item out of the tree takes its element off the page.
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:469
 */
export function godot_canvas_item_draw(entity: Object3D, viewport: Object3D, root: HTMLElement): void {
  root.dataset['godotRoot'] = '';
  const own = viewportCanvas(root);
  if (own.parentElement !== root) root.appendChild(own);
  // The viewport's canvas transform (its Camera2D's view) moves the whole canvas.
  own.style.transformOrigin = '0px 0px';
  own.style.transform = matrix(rootCanvasTransform);
  const element = elementOf(entity, root.ownerDocument);
  const place = is_inside_tree(entity) ? placeOf(entity, viewport, root) : undefined;
  if (place === undefined) {
    element.remove();
    return;
  }
  const link = LAYERS.get(entity);
  if (link !== undefined) {
    put(element, 'position', 'absolute');
    put(element, 'left', '0px');
    put(element, 'top', '0px');
    put(element, 'width', '100%');
    put(element, 'height', '100%');
    put(element, 'pointerEvents', 'none');
    put(element, 'zIndex', String(link.layer(entity)));
    put(element, 'transformOrigin', '0px 0px');
    put(element, 'transform', matrix(link.finalTransform(entity)));
    put(element, 'display', link.visible(entity) ? '' : 'none');
    placeIn(entity, element, root);
    return;
  }
  const state = ITEMS.get(entity);
  if (state === undefined) return;
  const size = state.class.size?.(entity);
  put(element, 'position', 'absolute');
  put(element, 'left', '0px');
  put(element, 'top', '0px');
  put(element, 'width', `${String(size?.x ?? 0)}px`);
  put(element, 'height', `${String(size?.y ?? 0)}px`);
  put(element, 'transformOrigin', '0px 0px');
  put(element, 'transform', matrix((state.class.drawTransform ?? state.class.transform)(entity)));
  put(element, 'display', state.visible ? '' : 'none');
  put(element, 'zIndex', String(state.zIndex));
  put(element, 'filter', colorFilter(root, state.modulate));
  put(element, 'mixBlendMode', godot_canvas_item_material_css_blend(materialOf(entity, state)));
  // Nearest filtering is the page's pixelated rendering, which its children inherit as the parent
  // node's filter (`get_texture_filter_in_tree`, `canvas_item.cpp:1760`); linear is the page's own.
  put(element, 'imageRendering', state.textureFilter === 0 ? '' : state.textureFilter % 2 === 1 ? 'pixelated' : 'auto');
  placeIn(entity, element, state.topLevel ? place.canvas : place.container);
  if (state.class.draw === undefined) return;
  const key = state.class.drawKey?.(entity, element);
  if (key !== undefined && DRAWN.get(entity) === key) return;
  state.class.draw(entity, element);
  if (key !== undefined) DRAWN.set(entity, key);
}

/** The material an item draws with: its own, or its parent item's where it uses the parent's. */
function materialOf(entity: Object3D, state: CanvasItemState): object | null {
  if (!state.useParentMaterial) return state.material;
  const parent = entity.parent;
  const parentState = parent === null ? undefined : ITEMS.get(parent);
  return parent === null || parentState === undefined ? null : materialOf(parent, parentState);
}

/**
 * @godot CanvasItem.set_texture_filter
 * @source scene/main/canvas_item.cpp:1665
 */
export function set_texture_filter(self: object, texture_filter: number): void {
  stateOf(self, 'set_texture_filter').textureFilter = texture_filter;
}

/**
 * @godot CanvasItem.get_texture_filter
 * @source scene/main/canvas_item.cpp:1676
 */
export function get_texture_filter(self: object): number {
  return stateOf(self, 'get_texture_filter').textureFilter;
}

/**
 * Stored and read back; the page repeats a texture where its drawing asks for it.
 *
 * @godot CanvasItem.set_texture_repeat
 * @source scene/main/canvas_item.cpp:1720
 */
export function set_texture_repeat(self: object, texture_repeat: number): void {
  stateOf(self, 'set_texture_repeat').textureRepeat = texture_repeat;
}

/**
 * @godot CanvasItem.get_texture_repeat
 * @source scene/main/canvas_item.cpp:1755
 */
export function get_texture_repeat(self: object): number {
  return stateOf(self, 'get_texture_repeat').textureRepeat;
}

/**
 * The item's material (a CanvasItemMaterial's blend is its element's CSS blend; a shader material's
 * shader is not run by the page's canvas).
 *
 * @godot CanvasItem.set_material
 * @source scene/main/canvas_item.cpp:1180
 */
export function set_material(self: object, material: object | null): void {
  const state = ITEMS.get(entityOf(self));
  if (state !== undefined) state.material = material;
}

/**
 * @godot CanvasItem.get_material
 * @source scene/main/canvas_item.cpp:1196
 */
export function get_material(self: object): object | null {
  return ITEMS.get(entityOf(self))?.material ?? null;
}

/**
 * @godot CanvasItem.set_use_parent_material
 * @source scene/main/canvas_item.cpp:1186
 */
export function set_use_parent_material(self: object, use: boolean): void {
  const state = ITEMS.get(entityOf(self));
  if (state !== undefined) state.useParentMaterial = use;
}

/**
 * @godot CanvasItem.get_use_parent_material
 * @source scene/main/canvas_item.cpp:1192
 */
export function get_use_parent_material(self: object): boolean {
  return ITEMS.get(entityOf(self))?.useParentMaterial ?? false;
}

/**
 * Whether a node is a canvas item or a canvas layer, which draws itself (`useGodotCanvasItem`).
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:1901
 */
export function godot_canvas_item_draws(entity: Object3D): boolean {
  return ITEMS.has(entity) || LAYERS.has(entity);
}

/**
 * Takes a canvas item's or layer's element off the page, as its component unmounts.
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:469
 */
export function godot_canvas_item_undraw(entity: Object3D): void {
  ELEMENTS.get(entity)?.remove();
}

/**
 * CanvasItem's properties as a scene element states them (`useGodotElement`), by their setters.
 *
 * @godot CanvasItem (protocol)
 * @source scene/main/canvas_item.cpp:1581
 */
export function godot_canvas_item_props(): (readonly [string, GodotElementProp<Object3D>])[] {
  return [
    ['visible', (entity, value: boolean) => set_visible(entity, value)],
    ['modulate', (entity, value: readonly [number, number, number, number]) => set_modulate(entity, color(...value))],
    ['selfModulate', (entity, value: readonly [number, number, number, number]) => set_self_modulate(entity, color(...value))],
    ['topLevel', (entity, value: boolean) => set_as_top_level(entity, value)],
    ['zIndex', (entity, value: number) => set_z_index(entity, value)],
    ['zAsRelative', (entity, value: boolean) => set_z_as_relative(entity, value)],
    ['material', (entity, value: object | null) => set_material(entity, value)],
    ['useParentMaterial', (entity, value: boolean) => set_use_parent_material(entity, value)],
    ['textureFilter', (entity, value: number) => set_texture_filter(entity, value)],
    ['textureRepeat', (entity, value: number) => set_texture_repeat(entity, value)],
  ];
}

/**
 * The rect of the viewport the item is in (`get_viewport()->get_visible_rect()`); outside the tree
 * it fails.
 *
 * @godot CanvasItem.get_viewport_rect
 * @source scene/main/canvas_item.cpp:450
 */
export function get_viewport_rect(self: object): Rect2 {
  const viewport = get_viewport(godot_node_entity(self));
  if (viewport === null) throw new Error('godot-compat: CanvasItem.get_viewport_rect outside the tree');
  return get_visible_rect(viewport);
}

/**
 * The mouse's position in the item's own coordinates: the viewport's mouse position through the
 * inverse of the item's transform with its canvas.
 *
 * @godot CanvasItem.get_local_mouse_position
 * @source scene/main/canvas_item.cpp:1105
 */
export function get_local_mouse_position(self: object): Vector2 {
  return op_multiply(affine_inverse(get_global_transform_with_canvas(self)), godot_input_mouse_position());
}

/**
 * @godot CanvasItem.get_global_mouse_position
 * @source scene/main/canvas_item.cpp:1096
 */
export function get_global_mouse_position(self: object): Vector2 {
  void self;
  return godot_input_mouse_position();
}
