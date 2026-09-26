import { Container, Graphics, Matrix } from 'pixi.js';
import { godotTransform2DNew, type GodotTransform2D } from './transform-2d';

interface CanvasItemRuntimeState {
  visibilityLayer: number;
  showBehindParent: boolean;
  clipChildrenMode: number;
  useParentMaterial: boolean;
  mask: Graphics | null;
  lightMask: number;
  notifyLocalTransform: boolean;
  notifyTransform: boolean;
  topLevel: boolean;
  topLevelWorldTransform: GodotTransform2D | null;
  visibilityParent: Container | null;
}

const STATES = new WeakMap<Container, CanvasItemRuntimeState>();

function stateOf(node: Container): CanvasItemRuntimeState {
  let state = STATES.get(node);
  if (state === undefined) {
    state = {
      visibilityLayer: 1,
      showBehindParent: false,
      clipChildrenMode: 0,
      useParentMaterial: false,
      mask: null,
      lightMask: 1,
      notifyLocalTransform: false,
      notifyTransform: false,
      topLevel: false,
      topLevelWorldTransform: null,
      visibilityParent: null,
    };
    STATES.set(node, state);
  }
  return state;
}

function integer(value: number, member: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`CanvasItem.${member} requires int.`);
  return value;
}

export function setCanvasItemVisibilityLayer(node: Container, value: number): void {
  const layer = integer(value, 'visibility_layer');
  if (layer < 0 || layer > 0xffff_ffff) throw new RangeError('CanvasItem.visibility_layer must be a 32-bit unsigned mask.');
  stateOf(node).visibilityLayer = layer >>> 0;
}

export function getCanvasItemVisibilityLayer(node: Container): number { return stateOf(node).visibilityLayer; }

export function setCanvasItemVisibilityLayerBit(node: Container, layer: number, enabled: boolean): void {
  const bit = integer(layer, 'set_visibility_layer_bit layer');
  if (bit < 1 || bit > 20 || typeof enabled !== 'boolean') throw new RangeError('CanvasItem visibility layer bit must be 1..20 and enabled bool.');
  const mask = 2 ** (bit - 1);
  const state = stateOf(node);
  state.visibilityLayer = enabled ? (state.visibilityLayer | mask) >>> 0 : (state.visibilityLayer & ~mask) >>> 0;
}

export function getCanvasItemVisibilityLayerBit(node: Container, layer: number): boolean {
  const bit = integer(layer, 'get_visibility_layer_bit layer');
  if (bit < 1 || bit > 20) throw new RangeError('CanvasItem visibility layer bit must be 1..20.');
  return (stateOf(node).visibilityLayer & 2 ** (bit - 1)) !== 0;
}

export function setCanvasItemShowBehindParent(node: Container, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CanvasItem.show_behind_parent requires bool.');
  const state = stateOf(node); state.showBehindParent = enabled;
  if (enabled && node.zIndex >= 0) node.zIndex = -1;
  else if (!enabled && node.zIndex < 0) node.zIndex = 0;
}

export function isCanvasItemShowingBehindParent(node: Container): boolean { return stateOf(node).showBehindParent; }

function refreshMask(node: Container, state: CanvasItemRuntimeState): void {
  if (state.mask !== null) { if (node.mask === state.mask) node.mask = null; state.mask.removeFromParent(); state.mask.destroy(); state.mask = null; }
  if (state.clipChildrenMode === 0) return;
  const bounds = node.getLocalBounds();
  const mask = new Graphics().rect(bounds.x, bounds.y, bounds.width, bounds.height).fill(0xffffff);
  mask.label = '__godot_canvas_item_clip'; node.addChild(mask); node.mask = mask; state.mask = mask;
}

export function setCanvasItemClipChildrenMode(node: Container, mode: number): void {
  const retained = integer(mode, 'clip_children_mode');
  if (retained < 0 || retained > 2) throw new RangeError('CanvasItem.clip_children_mode must be DISABLED, ONLY, or AND_DRAW.');
  const state = stateOf(node); state.clipChildrenMode = retained; refreshMask(node, state);
}

export function getCanvasItemClipChildrenMode(node: Container): number { return stateOf(node).clipChildrenMode; }

export function setCanvasItemUseParentMaterial(node: Container, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CanvasItem.use_parent_material requires bool.');
  const state = stateOf(node); state.useParentMaterial = enabled;
  if (enabled && node.parent instanceof Container) {
    const filters = node.parent.filters;
    node.filters = filters === null ? null : [...filters];
    node.blendMode = node.parent.blendMode;
  }
}

export function isCanvasItemUsingParentMaterial(node: Container): boolean { return stateOf(node).useParentMaterial; }

export function setCanvasItemLightMask(node: Container, value: number): void {
  const mask = integer(value, 'light_mask');
  if (mask < 0 || mask > 0xffff_ffff) throw new RangeError('CanvasItem.light_mask must be a 32-bit unsigned mask.');
  stateOf(node).lightMask = mask >>> 0;
}

export function getCanvasItemLightMask(node: Container): number { return stateOf(node).lightMask; }

export function setCanvasItemNotifyLocalTransform(node: Container, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CanvasItem.set_notify_local_transform requires bool.');
  stateOf(node).notifyLocalTransform = enabled;
}

export function isCanvasItemLocalTransformNotificationEnabled(node: Container): boolean {
  return stateOf(node).notifyLocalTransform;
}

export function setCanvasItemNotifyTransform(node: Container, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CanvasItem.set_notify_transform requires bool.');
  stateOf(node).notifyTransform = enabled;
}

export function isCanvasItemTransformNotificationEnabled(node: Container): boolean {
  return stateOf(node).notifyTransform;
}

/**
 * Retains CanvasItem's top-level transform boundary. The authored tree remains intact while global
 * transform reads use the captured world transform, matching Godot's scene-tree semantics.
 */
export function setCanvasItemAsTopLevel(node: Container, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CanvasItem.top_level requires bool.');
  const state = stateOf(node);
  if (state.topLevel === enabled) return;
  if (enabled) {
    node.getGlobalPosition();
    state.topLevelWorldTransform = matrixTransform(node.worldTransform);
  } else if (state.topLevelWorldTransform !== null && node.parent instanceof Container) {
    const world = state.topLevelWorldTransform;
    const parentInverse = node.parent.worldTransform.clone().invert();
    const desired = new Matrix(
      world.x.x,
      world.x.y,
      world.y.x,
      world.y.y,
      world.origin.x,
      world.origin.y,
    );
    const local = parentInverse.append(desired);
    node.setFromMatrix(local);
    state.topLevelWorldTransform = null;
  }
  state.topLevel = enabled;
}

export function isCanvasItemSetAsTopLevel(node: Container): boolean {
  return stateOf(node).topLevel;
}

/** Associate visibility with a different CanvasItem without changing transform ownership. */
export function setCanvasItemVisibilityParent(node: Container, parent: Container | null): void {
  if (parent === node) throw new RangeError('CanvasItem visibility parent cannot be itself.');
  let ancestor = parent;
  while (ancestor !== null) {
    if (ancestor === node) throw new RangeError('CanvasItem visibility parent cannot create a cycle.');
    ancestor = stateOf(ancestor).visibilityParent;
  }
  stateOf(node).visibilityParent = parent;
}

export function getCanvasItemVisibilityParent(node: Container): Container | null {
  return stateOf(node).visibilityParent;
}

export function isCanvasItemVisibleInTree(node: Container): boolean {
  const visited = new Set<Container>();
  let current: Container | null = node;
  while (current !== null) {
    if (visited.has(current)) return false;
    visited.add(current);
    if (!current.visible || current.alpha <= 0 || !current.renderable) return false;
    current = stateOf(current).visibilityParent ?? current.parent;
  }
  return true;
}

export function showCanvasItem(node: Container): void {
  node.visible = true;
}

export function hideCanvasItem(node: Container): void {
  node.visible = false;
}

function matrixTransform(matrix: { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly tx: number; readonly ty: number }): GodotTransform2D {
  return godotTransform2DNew(
    { x: matrix.a, y: matrix.b },
    { x: matrix.c, y: matrix.d },
    { x: matrix.tx, y: matrix.ty },
  );
}

export function getCanvasItemTransform(node: Container): GodotTransform2D {
  const rotation = node.rotation;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return godotTransform2DNew(
    { x: cosine * node.scale.x, y: sine * node.scale.x },
    { x: -sine * node.scale.y, y: cosine * node.scale.y },
    { x: node.position.x, y: node.position.y },
  );
}

export function getCanvasItemGlobalTransform(node: Container): GodotTransform2D {
  const retained = stateOf(node);
  if (retained.topLevel && retained.topLevelWorldTransform !== null) {
    return godotTransform2DNew(retained.topLevelWorldTransform);
  }
  node.getGlobalPosition();
  return matrixTransform(node.worldTransform);
}

export function getCanvasItemScreenTransform(node: Container): GodotTransform2D {
  return getCanvasItemGlobalTransform(node);
}

export function getCanvasItemViewportTransform(node: Container): GodotTransform2D {
  let root = node;
  while (root.parent instanceof Container) root = root.parent;
  return matrixTransform(root.worldTransform);
}

export function getCanvasItemGlobalTransformWithCanvas(node: Container): GodotTransform2D {
  return getCanvasItemGlobalTransform(node);
}

export function makeCanvasPositionLocal(node: Container, globalPoint: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
  if (!Number.isFinite(globalPoint.x) || !Number.isFinite(globalPoint.y)) throw new TypeError('CanvasItem.make_canvas_position_local requires Vector2.');
  const local = node.toLocal(globalPoint);
  return { x: local.x, y: local.y };
}

export function makeCanvasPositionGlobal(node: Container, localPoint: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
  if (!Number.isFinite(localPoint.x) || !Number.isFinite(localPoint.y)) throw new TypeError('CanvasItem position requires Vector2.');
  const global = node.toGlobal(localPoint);
  return { x: global.x, y: global.y };
}

export function makeCanvasInputLocal<T extends object>(node: Container, event: T): T {
  const copy = Object.create(Object.getPrototypeOf(event)) as T;
  Object.assign(copy, event);
  const position = Reflect.get(event, 'position') ?? Reflect.get(event, 'global_position');
  const positionX = typeof position === 'object' && position !== null ? Reflect.get(position, 'x') : undefined;
  const positionY = typeof position === 'object' && position !== null ? Reflect.get(position, 'y') : undefined;
  if (typeof positionX === 'number' && Number.isFinite(positionX) && typeof positionY === 'number' && Number.isFinite(positionY)) {
    const local = makeCanvasPositionLocal(node, { x: positionX, y: positionY });
    Reflect.set(copy, 'position', local);
    if (Reflect.has(copy, 'global_position')) Reflect.set(copy, 'global_position', local);
  }
  for (const property of ['relative', 'velocity', 'screen_relative', 'screen_velocity']) {
    const vector = Reflect.get(event, property);
    if (
      typeof vector !== 'object' ||
      vector === null ||
      !Number.isFinite(Reflect.get(vector, 'x')) ||
      !Number.isFinite(Reflect.get(vector, 'y'))
    ) continue;
    const inverse = node.worldTransform.clone().invert();
    const x = Number(Reflect.get(vector, 'x'));
    const y = Number(Reflect.get(vector, 'y'));
    Reflect.set(copy, property, {
      x: inverse.a * x + inverse.c * y,
      y: inverse.b * x + inverse.d * y,
    });
  }
  return copy;
}

export function getCanvasItemViewportRect(node: Container): {
  readonly position: { readonly x: number; readonly y: number };
  readonly size: { readonly x: number; readonly y: number };
} {
  let root = node;
  while (root.parent instanceof Container) root = root.parent;
  const bounds = root.getLocalBounds();
  return {
    position: { x: bounds.x, y: bounds.y },
    size: { x: bounds.width, y: bounds.height },
  };
}

export function moveCanvasItemToFront(node: Container): void {
  const parent = node.parent;
  if (parent instanceof Container) parent.setChildIndex(node, parent.children.length - 1);
}

export function forceUpdateCanvasItemTransform(node: Container): void {
  node.getGlobalPosition();
  if (stateOf(node).clipChildrenMode !== 0) refreshMask(node, stateOf(node));
}

export function getCanvasItemRect(node: Container): { readonly position: { readonly x: number; readonly y: number }; readonly size: { readonly x: number; readonly y: number } } {
  const bounds = node.getLocalBounds();
  return { position: { x: bounds.x, y: bounds.y }, size: { x: bounds.width, y: bounds.height } };
}

export function releaseCanvasItemRuntimeState(node: Container): void {
  const state = STATES.get(node); if (state === undefined) return;
  if (state.mask !== null) { if (node.mask === state.mask) node.mask = null; state.mask.removeFromParent(); state.mask.destroy(); }
  STATES.delete(node);
}
