/** RenderingServer CanvasItem commands backed by retained Pixi entities and command children. */

import {
  Container,
  Graphics,
  Matrix,
  Mesh,
  MeshGeometry,
  NineSliceSprite,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';

import type { GodotRid } from './gdscript-builtins';
import { godotRenderingServerCanvasItemClear } from './canvas-draw';
import { getCanvasItemLightMask } from './canvas-item-state';
import { getCanvasItemMaterial, setCanvasItemMaterial, type GodotCanvasMaterial } from './canvas-item-material';
import { GodotMultiMesh, MULTIMESH_TRANSFORM_2D } from './multimesh';
import {
  getNode2DTransform,
  getModulate,
  getSelfModulate,
  getZAsRelative,
  getZIndex,
  isCanvasYSortEnabled,
  bindGodotCanvasItemApi,
  markInternalCanvasChild,
  setSelfModulate,
  setVisible,
  setZIndex,
} from './node';
import { godotResourceGetRid, godotResourceOfRid } from './resource-io';
import type { ColorValue } from './variant';
import type { Vector2 } from './vector2';

export interface GodotCanvasGroupMode {
  readonly mode: number;
  readonly clearMargin: number;
  readonly fitEmpty: boolean;
  readonly fitMargin: number;
  readonly blurMipmaps: boolean;
}

export interface GodotCanvasVisibilityNotifier {
  readonly area: { readonly position: Vector2; readonly size: Vector2 };
  readonly enterCallable: unknown;
  readonly exitCallable: unknown;
}

interface ServerCanvasState {
  readonly commands: Container[];
  readonly instanceShaderParameters: Map<string, unknown>;
  defaultTextureFilter: number;
  defaultTextureRepeat: number;
  visibilityLayer: number;
  clip: boolean;
  clipIgnore: boolean;
  distanceFieldMode: boolean;
  customRectEnabled: boolean;
  customRect: { position: Vector2; size: Vector2 };
  drawBehindParent: boolean;
  interpolated: boolean;
  updateWhenVisible: boolean;
  skeleton: GodotRid;
  drawIndex: number;
  useParentMaterial: boolean;
  copyToBackbuffer: { enabled: boolean; rect: { position: Vector2; size: Vector2 } };
  visibilityNotifier: GodotCanvasVisibilityNotifier | null;
  canvasGroupMode: GodotCanvasGroupMode;
  animationSlice: { animationLength: number; sliceBegin: number; sliceEnd: number; offset: number } | null;
}

function isCanvasAncestor(candidate: Container, node: Container): boolean {
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (parent === candidate) return true;
  }
  return false;
}

interface ServerCanvasResourceState {
  defaultTextureFilter: number;
  defaultTextureRepeat: number;
  disableScale: boolean;
  parentScale: number;
  parent: GodotRid;
  modulate: ColorValue;
  shadowTextureSize: number;
  readonly mirroring: Map<Container, Vector2>;
}

interface ServerCanvasTextureState {
  readonly channels: Map<number, GodotRid>;
  baseColor: ColorValue;
  shininess: number;
  textureFilter: number;
  textureRepeat: number;
}

const SERVER_STATE = new WeakMap<Container, ServerCanvasState>();
const SERVER_CANVASES = new WeakMap<Container, ServerCanvasResourceState>();
const SERVER_CANVAS_TEXTURES = new WeakMap<Texture, ServerCanvasTextureState>();
const DRAW_TARGET = new WeakMap<Container, Graphics>();

const EMPTY_RECT = Object.freeze({
  position: Object.freeze({ x: 0, y: 0 }),
  size: Object.freeze({ x: 0, y: 0 }),
});

function finite(member: string, argument: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`RenderingServer.${member} ${argument} must be finite.`);
  }
  return value;
}

function integer(member: string, argument: string, value: unknown, minimum = 0): number {
  const retained = finite(member, argument, value);
  if (!Number.isSafeInteger(retained) || retained < minimum) {
    throw new RangeError(`RenderingServer.${member} ${argument} must be an integer >= ${minimum}.`);
  }
  return retained;
}

function boolean(member: string, argument: string, value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`RenderingServer.${member} ${argument} must be bool.`);
  return value;
}

function point(member: string, argument: string, value: unknown): Vector2 {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`RenderingServer.${member} ${argument} must be Vector2.`);
  }
  return {
    x: finite(member, `${argument}.x`, Reflect.get(value, 'x')),
    y: finite(member, `${argument}.y`, Reflect.get(value, 'y')),
  };
}

function color(member: string, argument: string, value: unknown): ColorValue {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`RenderingServer.${member} ${argument} must be Color.`);
  }
  return {
    r: finite(member, `${argument}.r`, Reflect.get(value, 'r')),
    g: finite(member, `${argument}.g`, Reflect.get(value, 'g')),
    b: finite(member, `${argument}.b`, Reflect.get(value, 'b')),
    a: finite(member, `${argument}.a`, Reflect.get(value, 'a')),
  };
}

function rect(member: string, argument: string, value: unknown): { position: Vector2; size: Vector2 } {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`RenderingServer.${member} ${argument} must be Rect2.`);
  }
  const position = point(member, `${argument}.position`, Reflect.get(value, 'position'));
  const size = point(member, `${argument}.size`, Reflect.get(value, 'size'));
  if (size.x < 0 || size.y < 0) throw new RangeError(`RenderingServer.${member} ${argument}.size must be non-negative.`);
  return { position, size };
}

function points(member: string, argument: string, value: unknown): Vector2[] {
  if (!Array.isArray(value)) throw new TypeError(`RenderingServer.${member} ${argument} must be PackedVector2Array.`);
  return value.map((entry, index) => point(member, `${argument}[${index}]`, entry));
}

function colors(member: string, argument: string, value: unknown): ColorValue[] {
  if (!Array.isArray(value)) throw new TypeError(`RenderingServer.${member} ${argument} must be PackedColorArray.`);
  return value.map((entry, index) => color(member, `${argument}[${index}]`, entry));
}

function pixiColor(value: ColorValue): { color: number; alpha: number } {
  const byte = (component: number): number => Math.max(0, Math.min(255, Math.round(component * 255)));
  return {
    color: byte(value.r) * 0x10000 + byte(value.g) * 0x100 + byte(value.b),
    alpha: Math.max(0, Math.min(1, value.a)),
  };
}

function canvasItem(rid: GodotRid, member: string): Container {
  const retained = godotResourceOfRid(rid);
  if (!(retained instanceof Container)) {
    throw new TypeError(`RenderingServer.${member} RID must identify a retained native Pixi CanvasItem.`);
  }
  return retained;
}

function canvas(rid: GodotRid, member: string): Container {
  const retained = godotResourceOfRid(rid);
  if (!(retained instanceof Container) || !SERVER_CANVASES.has(retained)) {
    throw new TypeError(`RenderingServer.${member} RID must identify a retained Canvas.`);
  }
  return retained;
}

function canvasState(owner: Container): ServerCanvasResourceState {
  const retained = SERVER_CANVASES.get(owner);
  if (retained === undefined) throw new TypeError('RenderingServer Canvas RID has no retained canvas state.');
  return retained;
}

function stateOf(node: Container): ServerCanvasState {
  const retained = SERVER_STATE.get(node);
  if (retained !== undefined) return retained;
  const created: ServerCanvasState = {
    commands: [],
    instanceShaderParameters: new Map(),
    defaultTextureFilter: 0,
    defaultTextureRepeat: 0,
    visibilityLayer: 1,
    clip: false,
    clipIgnore: false,
    distanceFieldMode: false,
    customRectEnabled: false,
    customRect: { position: { x: 0, y: 0 }, size: { x: 0, y: 0 } },
    drawBehindParent: false,
    interpolated: false,
    updateWhenVisible: false,
    skeleton: { id: 0n },
    drawIndex: 0,
    useParentMaterial: false,
    copyToBackbuffer: { enabled: false, rect: EMPTY_RECT },
    visibilityNotifier: null,
    canvasGroupMode: { mode: 0, clearMargin: 5, fitEmpty: false, fitMargin: 0, blurMipmaps: false },
    animationSlice: null,
  };
  SERVER_STATE.set(node, created);
  return created;
}

function graphics(node: Container): Graphics {
  if (node instanceof Graphics) return node;
  const retained = DRAW_TARGET.get(node);
  if (retained !== undefined) return retained;
  const created = markInternalCanvasChild(new Graphics());
  node.addChildAt(created, 0);
  DRAW_TARGET.set(node, created);
  stateOf(node).commands.push(created);
  return created;
}

function texture(rid: GodotRid, member: string): Texture {
  const retained = godotResourceOfRid(rid);
  if (!(retained instanceof Texture)) {
    throw new TypeError(`RenderingServer.${member} texture RID must identify a retained native Pixi Texture2D.`);
  }
  return retained;
}

function addCommand(owner: Container, command: Container): void {
  const retained = markInternalCanvasChild(command);
  const state = stateOf(owner);
  owner.addChild(retained);
  state.commands.push(retained);
  retained.zIndex = state.drawIndex;
}

function uniformColor(member: string, values: readonly ColorValue[]): ColorValue {
  const first = values[0] ?? { r: 1, g: 1, b: 1, a: 1 };
  if (values.some((entry) => entry.r !== first.r || entry.g !== first.g || entry.b !== first.b || entry.a !== first.a)) {
    throw new Error(`RenderingServer.${member} per-vertex color interpolation has no exact native Pixi Graphics carrier.`);
  }
  return first;
}

/** RenderingServer.canvas_create() retains a native Pixi root with stable RID identity. */
export function godotRenderingServerCanvasCreate(): GodotRid {
  const owner = new Container();
  SERVER_CANVASES.set(owner, {
    defaultTextureFilter: 0,
    defaultTextureRepeat: 0,
    disableScale: false,
    parentScale: 1,
    parent: { id: 0n },
    modulate: { r: 1, g: 1, b: 1, a: 1 },
    shadowTextureSize: 2048,
    mirroring: new Map(),
  });
  return godotResourceGetRid(owner);
}

export function godotRenderingServerCanvasSetShadowTextureSize(canvasRid: GodotRid, sizeValue: unknown): void {
  const size = integer('canvas_set_shadow_texture_size', 'size', sizeValue);
  if (size > 16384) throw new RangeError('RenderingServer.canvas_set_shadow_texture_size must be <= 16384.');
  canvasState(canvas(canvasRid, 'canvas_set_shadow_texture_size')).shadowTextureSize = size;
}

export function godotRenderingServerCanvasGetShadowTextureSize(canvasRid: GodotRid): number {
  return canvasState(canvas(canvasRid, 'canvas_get_shadow_texture_size')).shadowTextureSize;
}

export function godotRenderingServerCanvasSetItemMirroring(canvasRid: GodotRid, itemRid: GodotRid, mirroringValue: unknown): void {
  const owner = canvas(canvasRid, 'canvas_set_item_mirroring');
  const item = canvasItem(itemRid, 'canvas_set_item_mirroring');
  const mirroring = point('canvas_set_item_mirroring', 'mirroring', mirroringValue);
  canvasState(owner).mirroring.set(item, mirroring);
  if (item.parent !== owner) owner.addChild(item);
}

export function godotRenderingServerCanvasGetItemMirroring(canvasRid: GodotRid, itemRid: GodotRid): Vector2 {
  const owner = canvas(canvasRid, 'canvas_get_item_mirroring');
  const item = canvasItem(itemRid, 'canvas_get_item_mirroring');
  return { ...(canvasState(owner).mirroring.get(item) ?? { x: 0, y: 0 }) };
}

export function godotRenderingServerCanvasSetModulate(canvasRid: GodotRid, colorValue: unknown): void {
  const owner = canvas(canvasRid, 'canvas_set_modulate');
  const retained = color('canvas_set_modulate', 'color', colorValue);
  const pixi = pixiColor(retained);
  const state = canvasState(owner);
  state.modulate = retained;
  owner.tint = pixi.color;
  owner.alpha = pixi.alpha;
}

export function godotRenderingServerCanvasGetModulate(canvasRid: GodotRid): ColorValue {
  return { ...canvasState(canvas(canvasRid, 'canvas_get_modulate')).modulate };
}

export function godotRenderingServerCanvasSetDisableScale(canvasRid: GodotRid, disabledValue: unknown): void {
  const owner = canvas(canvasRid, 'canvas_set_disable_scale');
  const state = canvasState(owner);
  state.disableScale = boolean('canvas_set_disable_scale', 'disable', disabledValue);
  if (state.disableScale) owner.scale.set(1, 1);
  else owner.scale.set(state.parentScale, state.parentScale);
}

export function godotRenderingServerCanvasIsScaleDisabled(canvasRid: GodotRid): boolean {
  return canvasState(canvas(canvasRid, 'canvas_is_scale_disabled')).disableScale;
}

export function godotRenderingServerCanvasSetParent(canvasRid: GodotRid, parentRid: GodotRid, scaleValue = 1): void {
  const owner = canvas(canvasRid, 'canvas_set_parent');
  const state = canvasState(owner);
  const scale = finite('canvas_set_parent', 'scale', scaleValue);
  if (scale <= 0) throw new RangeError('RenderingServer.canvas_set_parent scale must be positive.');
  state.parentScale = scale;
  if (!state.disableScale) owner.scale.set(scale, scale);
  if (parentRid.id === 0n) {
    state.parent = { id: 0n };
    owner.removeFromParent();
    return;
  }
  const parent = canvas(parentRid, 'canvas_set_parent');
  if (parent === owner || isCanvasAncestor(owner, parent)) throw new Error('RenderingServer.canvas_set_parent would create a Canvas cycle.');
  state.parent = parentRid;
  parent.addChild(owner);
}

export function godotRenderingServerCanvasGetParent(canvasRid: GodotRid): GodotRid {
  return { ...canvasState(canvas(canvasRid, 'canvas_get_parent')).parent };
}

export function godotRenderingServerCanvasGetParentScale(canvasRid: GodotRid): number {
  return canvasState(canvas(canvasRid, 'canvas_get_parent_scale')).parentScale;
}

export function godotRenderingServerCanvasSetDefaultTextureFilter(canvasRid: GodotRid, value: unknown): void {
  canvasState(canvas(canvasRid, 'canvas_set_default_texture_filter')).defaultTextureFilter = integer('canvas_set_default_texture_filter', 'filter', value);
}

export function godotRenderingServerCanvasGetDefaultTextureFilter(canvasRid: GodotRid): number {
  return canvasState(canvas(canvasRid, 'canvas_get_default_texture_filter')).defaultTextureFilter;
}

export function godotRenderingServerCanvasSetDefaultTextureRepeat(canvasRid: GodotRid, value: unknown): void {
  canvasState(canvas(canvasRid, 'canvas_set_default_texture_repeat')).defaultTextureRepeat = integer('canvas_set_default_texture_repeat', 'repeat', value);
}

export function godotRenderingServerCanvasGetDefaultTextureRepeat(canvasRid: GodotRid): number {
  return canvasState(canvas(canvasRid, 'canvas_get_default_texture_repeat')).defaultTextureRepeat;
}

export function godotRenderingServerCanvasTextureCreate(): GodotRid {
  const retained = new Texture({ source: Texture.EMPTY.source });
  SERVER_CANVAS_TEXTURES.set(retained, {
    channels: new Map(),
    baseColor: { r: 1, g: 1, b: 1, a: 1 },
    shininess: 1,
    textureFilter: 0,
    textureRepeat: 0,
  });
  return godotResourceGetRid(retained);
}

function canvasTextureState(rid: GodotRid, member: string): ServerCanvasTextureState {
  const retained = godotResourceOfRid(rid);
  if (!(retained instanceof Texture)) throw new TypeError(`RenderingServer.${member} RID must identify CanvasTexture.`);
  const state = SERVER_CANVAS_TEXTURES.get(retained);
  if (state === undefined) throw new TypeError(`RenderingServer.${member} RID must identify CanvasTexture.`);
  return state;
}

export function godotRenderingServerCanvasTextureSetChannel(rid: GodotRid, channelValue: unknown, textureRid: GodotRid): void {
  const channel = integer('canvas_texture_set_channel', 'channel', channelValue);
  if (channel > 2) throw new RangeError('RenderingServer.canvas_texture_set_channel channel must be DIFFUSE, NORMAL, or SPECULAR.');
  if (textureRid.id !== 0n) texture(textureRid, 'canvas_texture_set_channel');
  const state = canvasTextureState(rid, 'canvas_texture_set_channel');
  if (textureRid.id === 0n) state.channels.delete(channel); else state.channels.set(channel, textureRid);
}

export function godotRenderingServerCanvasTextureGetChannel(rid: GodotRid, channelValue: unknown): GodotRid {
  const channel = integer('canvas_texture_get_channel', 'channel', channelValue);
  if (channel > 2) throw new RangeError('RenderingServer.canvas_texture_get_channel channel must be DIFFUSE, NORMAL, or SPECULAR.');
  return canvasTextureState(rid, 'canvas_texture_get_channel').channels.get(channel) ?? { id: 0n };
}

export function godotRenderingServerCanvasTextureSetShadingParameters(rid: GodotRid, baseColorValue: unknown, shininessValue: unknown): void {
  const state = canvasTextureState(rid, 'canvas_texture_set_shading_parameters');
  state.baseColor = color('canvas_texture_set_shading_parameters', 'base_color', baseColorValue);
  state.shininess = finite('canvas_texture_set_shading_parameters', 'shininess', shininessValue);
  if (state.shininess < 0 || state.shininess > 1) throw new RangeError('RenderingServer CanvasTexture shininess must be in [0, 1].');
}

export function godotRenderingServerCanvasTextureGetShadingParameters(rid: GodotRid): { readonly baseColor: ColorValue; readonly shininess: number } {
  const state = canvasTextureState(rid, 'canvas_texture_get_shading_parameters');
  return { baseColor: { ...state.baseColor }, shininess: state.shininess };
}

export function godotRenderingServerCanvasTextureSetTextureFilter(rid: GodotRid, filterValue: unknown): void {
  canvasTextureState(rid, 'canvas_texture_set_texture_filter').textureFilter = integer('canvas_texture_set_texture_filter', 'filter', filterValue);
}

export function godotRenderingServerCanvasTextureGetTextureFilter(rid: GodotRid): number {
  return canvasTextureState(rid, 'canvas_texture_get_texture_filter').textureFilter;
}

export function godotRenderingServerCanvasTextureSetTextureRepeat(rid: GodotRid, repeatValue: unknown): void {
  canvasTextureState(rid, 'canvas_texture_set_texture_repeat').textureRepeat = integer('canvas_texture_set_texture_repeat', 'repeat', repeatValue);
}

export function godotRenderingServerCanvasTextureGetTextureRepeat(rid: GodotRid): number {
  return canvasTextureState(rid, 'canvas_texture_get_texture_repeat').textureRepeat;
}

export function godotRenderingServerCanvasItemCreate(): GodotRid {
  const item = bindGodotCanvasItemApi(new Container());
  stateOf(item);
  return godotResourceGetRid(item);
}

export function godotRenderingServerCanvasItemSetParent(rid: GodotRid, parentRid: GodotRid): void {
  const item = canvasItem(rid, 'canvas_item_set_parent');
  if (parentRid.id === 0n) {
    item.removeFromParent();
    return;
  }
  const parent = canvasItem(parentRid, 'canvas_item_set_parent');
  if (parent === item || isCanvasAncestor(item, parent)) throw new Error('RenderingServer.canvas_item_set_parent would create a CanvasItem cycle.');
  parent.addChild(item);
}

export function godotRenderingServerCanvasItemGetParent(rid: GodotRid): GodotRid {
  const parent = canvasItem(rid, 'canvas_item_get_parent').parent;
  return parent === null ? { id: 0n } : godotResourceGetRid(parent);
}

export function godotRenderingServerCanvasItemGetTransform(rid: GodotRid): ReturnType<typeof getNode2DTransform> {
  return getNode2DTransform(canvasItem(rid, 'canvas_item_get_transform'));
}

export function godotRenderingServerCanvasItemGetModulate(rid: GodotRid): ColorValue {
  const item = canvasItem(rid, 'canvas_item_get_modulate');
  return { ...getModulate(item as Container & { modulate: ColorValue }) };
}

export function godotRenderingServerCanvasItemIsSortingChildrenByY(rid: GodotRid): boolean {
  return isCanvasYSortEnabled(canvasItem(rid, 'canvas_item_is_sorting_children_by_y'));
}

export function godotRenderingServerCanvasItemGetLightMask(rid: GodotRid): number {
  return getCanvasItemLightMask(canvasItem(rid, 'canvas_item_get_light_mask'));
}

export function godotRenderingServerCanvasItemSetDefaultTextureFilter(rid: GodotRid, value: unknown): void {
  stateOf(canvasItem(rid, 'canvas_item_set_default_texture_filter')).defaultTextureFilter = integer('canvas_item_set_default_texture_filter', 'filter', value);
}

export function godotRenderingServerCanvasItemSetDefaultTextureRepeat(rid: GodotRid, value: unknown): void {
  stateOf(canvasItem(rid, 'canvas_item_set_default_texture_repeat')).defaultTextureRepeat = integer('canvas_item_set_default_texture_repeat', 'repeat', value);
}

export function godotRenderingServerCanvasItemGetDefaultTextureFilter(rid: GodotRid): number {
  return stateOf(canvasItem(rid, 'canvas_item_get_default_texture_filter')).defaultTextureFilter;
}

export function godotRenderingServerCanvasItemGetDefaultTextureRepeat(rid: GodotRid): number {
  return stateOf(canvasItem(rid, 'canvas_item_get_default_texture_repeat')).defaultTextureRepeat;
}

export function godotRenderingServerCanvasItemSetVisibilityLayer(rid: GodotRid, value: unknown): void {
  const layer = integer('canvas_item_set_visibility_layer', 'visibility_layer', value);
  if (layer > 0xffff_ffff) throw new RangeError('RenderingServer.canvas_item_set_visibility_layer requires a 32-bit mask.');
  stateOf(canvasItem(rid, 'canvas_item_set_visibility_layer')).visibilityLayer = layer;
}

export function godotRenderingServerCanvasItemSetVisibilityLayerBit(rid: GodotRid, bitValue: unknown, enabledValue: unknown): void {
  const state = stateOf(canvasItem(rid, 'canvas_item_set_visibility_layer'));
  const bit = integer('canvas_item_set_visibility_layer', 'layer', bitValue);
  if (bit > 31) throw new RangeError('RenderingServer CanvasItem visibility layer bit must be in [0, 31].');
  const mask = 2 ** bit;
  state.visibilityLayer = boolean('canvas_item_set_visibility_layer', 'enabled', enabledValue)
    ? (state.visibilityLayer | mask) >>> 0
    : (state.visibilityLayer & ~mask) >>> 0;
}

export function godotRenderingServerCanvasItemGetVisibilityLayer(rid: GodotRid): number {
  return stateOf(canvasItem(rid, 'canvas_item_get_visibility_layer')).visibilityLayer;
}

export function godotRenderingServerCanvasItemSetClip(rid: GodotRid, enabledValue: unknown): void {
  const item = canvasItem(rid, 'canvas_item_set_clip');
  const state = stateOf(item);
  state.clip = boolean('canvas_item_set_clip', 'clip', enabledValue);
  applyClip(item, state);
}

function applyClip(item: Container, state: ServerCanvasState): void {
  const old = item.mask;
  if (old instanceof Graphics && state.commands.includes(old)) {
    const index = state.commands.indexOf(old);
    state.commands.splice(index, 1);
    old.removeFromParent();
    old.destroy();
  }
  item.mask = null;
  if (!state.clip || state.clipIgnore || !state.customRectEnabled) return;
  const mask = markInternalCanvasChild(new Graphics())
    .rect(state.customRect.position.x, state.customRect.position.y, state.customRect.size.x, state.customRect.size.y)
    .fill(0xffffff);
  item.addChild(mask);
  state.commands.push(mask);
  item.mask = mask;
}

export function godotRenderingServerCanvasItemSetClipIgnore(rid: GodotRid, enabledValue: unknown): void {
  const item = canvasItem(rid, 'canvas_item_set_clip_ignore');
  const state = stateOf(item);
  state.clipIgnore = boolean('canvas_item_set_clip_ignore', 'ignore', enabledValue);
  applyClip(item, state);
}

export function godotRenderingServerCanvasItemSetDistanceFieldMode(rid: GodotRid, enabledValue: unknown): void {
  stateOf(canvasItem(rid, 'canvas_item_set_distance_field_mode')).distanceFieldMode = boolean('canvas_item_set_distance_field_mode', 'enabled', enabledValue);
}

export function godotRenderingServerCanvasItemSetCustomRect(rid: GodotRid, enabledValue: unknown, rectValue: unknown): void {
  const item = canvasItem(rid, 'canvas_item_set_custom_rect');
  const state = stateOf(item);
  state.customRectEnabled = boolean('canvas_item_set_custom_rect', 'enabled', enabledValue);
  state.customRect = rect('canvas_item_set_custom_rect', 'rect', rectValue);
  applyClip(item, state);
}

export function godotRenderingServerCanvasItemSetSelfModulate(rid: GodotRid, value: unknown): void {
  setSelfModulate(canvasItem(rid, 'canvas_item_set_self_modulate'), color('canvas_item_set_self_modulate', 'color', value));
}

export function godotRenderingServerCanvasItemGetSelfModulate(rid: GodotRid): ColorValue {
  return { ...getSelfModulate(canvasItem(rid, 'canvas_item_get_self_modulate')) };
}

export function godotRenderingServerCanvasItemGetZIndex(rid: GodotRid): number {
  return getZIndex(canvasItem(rid, 'canvas_item_get_z_index'));
}

export function godotRenderingServerCanvasItemIsZRelativeToParent(rid: GodotRid): boolean {
  return getZAsRelative(canvasItem(rid, 'canvas_item_is_z_relative_to_parent'));
}

export function godotRenderingServerCanvasItemSetDrawBehindParent(rid: GodotRid, enabledValue: unknown): void {
  const item = canvasItem(rid, 'canvas_item_set_draw_behind_parent');
  const state = stateOf(item);
  state.drawBehindParent = boolean('canvas_item_set_draw_behind_parent', 'enabled', enabledValue);
  if (state.drawBehindParent && item.zIndex >= 0) setZIndex(item, -1);
  else if (!state.drawBehindParent && item.zIndex < 0) setZIndex(item, 0);
}

export function godotRenderingServerCanvasItemSetInterpolated(rid: GodotRid, enabledValue: unknown): void {
  stateOf(canvasItem(rid, 'canvas_item_set_interpolated')).interpolated = boolean('canvas_item_set_interpolated', 'enabled', enabledValue);
}

export function godotRenderingServerCanvasItemSetUpdateWhenVisible(rid: GodotRid, enabledValue: unknown): void {
  stateOf(canvasItem(rid, 'canvas_item_set_update_when_visible')).updateWhenVisible = boolean('canvas_item_set_update_when_visible', 'enabled', enabledValue);
}

export function godotRenderingServerCanvasItemSetSkeleton(rid: GodotRid, skeletonRid: GodotRid): void {
  if (typeof skeletonRid !== 'object' || skeletonRid === null || typeof skeletonRid.id !== 'bigint') throw new TypeError('RenderingServer.canvas_item_set_skeleton requires RID.');
  stateOf(canvasItem(rid, 'canvas_item_set_skeleton')).skeleton = skeletonRid;
}

export function godotRenderingServerCanvasItemGetClip(rid: GodotRid): boolean { return stateOf(canvasItem(rid, 'canvas_item_get_clip')).clip; }
export function godotRenderingServerCanvasItemGetClipIgnore(rid: GodotRid): boolean { return stateOf(canvasItem(rid, 'canvas_item_get_clip_ignore')).clipIgnore; }
export function godotRenderingServerCanvasItemIsDistanceFieldMode(rid: GodotRid): boolean { return stateOf(canvasItem(rid, 'canvas_item_is_distance_field_mode')).distanceFieldMode; }
export function godotRenderingServerCanvasItemGetCustomRect(rid: GodotRid): { readonly position: Vector2; readonly size: Vector2 } | null {
  const state = stateOf(canvasItem(rid, 'canvas_item_get_custom_rect'));
  return state.customRectEnabled ? state.customRect : null;
}
export function godotRenderingServerCanvasItemIsDrawingBehindParent(rid: GodotRid): boolean { return stateOf(canvasItem(rid, 'canvas_item_is_drawing_behind_parent')).drawBehindParent; }
export function godotRenderingServerCanvasItemIsInterpolated(rid: GodotRid): boolean { return stateOf(canvasItem(rid, 'canvas_item_is_interpolated')).interpolated; }
export function godotRenderingServerCanvasItemIsUpdateWhenVisible(rid: GodotRid): boolean { return stateOf(canvasItem(rid, 'canvas_item_is_update_when_visible')).updateWhenVisible; }
export function godotRenderingServerCanvasItemGetSkeleton(rid: GodotRid): GodotRid { return stateOf(canvasItem(rid, 'canvas_item_get_skeleton')).skeleton; }

export function godotRenderingServerCanvasItemResetPhysicsInterpolation(rid: GodotRid): void {
  stateOf(canvasItem(rid, 'canvas_item_reset_physics_interpolation')).interpolated = false;
}

export function godotRenderingServerCanvasItemTransformPhysicsInterpolation(rid: GodotRid, transformValue: unknown): void {
  const item = canvasItem(rid, 'canvas_item_transform_physics_interpolation');
  const transform = transformMatrix('canvas_item_transform_physics_interpolation', transformValue);
  item.setFromMatrix(transform.append(item.localTransform));
}

function transformMatrix(member: string, value: unknown): Matrix {
  if (typeof value !== 'object' || value === null) throw new TypeError(`RenderingServer.${member} requires Transform2D.`);
  const x = point(member, 'transform.x', Reflect.get(value, 'x'));
  const y = point(member, 'transform.y', Reflect.get(value, 'y'));
  const origin = point(member, 'transform.origin', Reflect.get(value, 'origin'));
  return new Matrix(x.x, x.y, y.x, y.y, origin.x, origin.y);
}

export function godotRenderingServerCanvasItemAddPolyline(rid: GodotRid, pointsValue: unknown, colorsValue: unknown, widthValue = -1, antialiasedValue = false): void {
  const line = points('canvas_item_add_polyline', 'points', pointsValue);
  if (line.length < 2) return;
  const width = finite('canvas_item_add_polyline', 'width', widthValue);
  if (width <= 0) throw new RangeError('RenderingServer.canvas_item_add_polyline requires positive width on Pixi.');
  if (boolean('canvas_item_add_polyline', 'antialiased', antialiasedValue)) throw new Error('Per-command antialiasing is unavailable; Pixi antialiasing is renderer-wide.');
  graphics(canvasItem(rid, 'canvas_item_add_polyline')).poly(line.flatMap((entry) => [entry.x, entry.y]), false).stroke({ ...pixiColor(uniformColor('canvas_item_add_polyline', colors('canvas_item_add_polyline', 'colors', colorsValue))), width });
}

export function godotRenderingServerCanvasItemAddLineCommand(rid: GodotRid, fromValue: unknown, toValue: unknown, colorValue: unknown, widthValue = -1, antialiasedValue = false): void {
  const from = point('canvas_item_add_line', 'from', fromValue);
  const to = point('canvas_item_add_line', 'to', toValue);
  const width = finite('canvas_item_add_line', 'width', widthValue);
  if (width <= 0) throw new RangeError('RenderingServer.canvas_item_add_line width must be positive.');
  if (boolean('canvas_item_add_line', 'antialiased', antialiasedValue)) throw new Error('Per-command antialiasing is unavailable; Pixi antialiasing is renderer-wide.');
  graphics(canvasItem(rid, 'canvas_item_add_line')).moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ ...pixiColor(color('canvas_item_add_line', 'color', colorValue)), width });
}

export function godotRenderingServerCanvasItemAddCircleCommand(rid: GodotRid, positionValue: unknown, radiusValue: unknown, colorValue: unknown): void {
  const center = point('canvas_item_add_circle', 'position', positionValue);
  const radius = finite('canvas_item_add_circle', 'radius', radiusValue);
  if (radius < 0) throw new RangeError('RenderingServer.canvas_item_add_circle radius must be non-negative.');
  graphics(canvasItem(rid, 'canvas_item_add_circle')).circle(center.x, center.y, radius).fill(pixiColor(color('canvas_item_add_circle', 'color', colorValue)));
}

export function godotRenderingServerCanvasItemAddTexturedPolygon(rid: GodotRid, pointsValue: unknown, colorsValue: unknown, uvsValue: unknown = [], textureRid: GodotRid = { id: 0n }): void {
  const vertices = points('canvas_item_add_polygon', 'points', pointsValue);
  if (vertices.length < 3) return;
  const tint = pixiColor(uniformColor('canvas_item_add_polygon', colors('canvas_item_add_polygon', 'colors', colorsValue)));
  const uvs = points('canvas_item_add_polygon', 'uvs', uvsValue);
  if (textureRid.id !== 0n || uvs.length > 0) {
    if (uvs.length !== vertices.length) throw new RangeError('RenderingServer.canvas_item_add_polygon UV count must match point count.');
    const retainedTexture = texture(textureRid, 'canvas_item_add_polygon');
    const minimumX = Math.min(...vertices.map((entry) => entry.x));
    const minimumY = Math.min(...vertices.map((entry) => entry.y));
    const maximumX = Math.max(...vertices.map((entry) => entry.x));
    const maximumY = Math.max(...vertices.map((entry) => entry.y));
    const bounds = new Rectangle(minimumX, minimumY, maximumX - minimumX, maximumY - minimumY);
    const sprite = new Sprite(retainedTexture); sprite.position.set(bounds.x, bounds.y); sprite.width = bounds.width; sprite.height = bounds.height; sprite.tint = tint.color; sprite.alpha = tint.alpha; addCommand(canvasItem(rid, 'canvas_item_add_polygon'), sprite); return;
  }
  graphics(canvasItem(rid, 'canvas_item_add_polygon')).poly(vertices.flatMap((entry) => [entry.x, entry.y]), true).fill(tint);
}

export function godotRenderingServerCanvasItemAddDashedLine(rid: GodotRid, fromValue: unknown, toValue: unknown, colorValue: unknown, widthValue = -1, dashValue = 2, alignedValue = true, antialiasedValue = false): void {
  const from = point('canvas_item_add_dashed_line', 'from', fromValue);
  const to = point('canvas_item_add_dashed_line', 'to', toValue);
  const width = finite('canvas_item_add_dashed_line', 'width', widthValue);
  const dash = finite('canvas_item_add_dashed_line', 'dash', dashValue);
  if (width <= 0 || dash <= 0) throw new RangeError('RenderingServer.canvas_item_add_dashed_line width and dash must be positive.');
  boolean('canvas_item_add_dashed_line', 'aligned', alignedValue);
  if (boolean('canvas_item_add_dashed_line', 'antialiased', antialiasedValue)) throw new Error('Per-command antialiasing is unavailable; Pixi antialiasing is renderer-wide.');
  const dx = to.x - from.x; const dy = to.y - from.y; const length = Math.hypot(dx, dy); if (length === 0) return;
  const target = graphics(canvasItem(rid, 'canvas_item_add_dashed_line'));
  for (let offset = 0; offset < length; offset += dash * 2) {
    const end = Math.min(length, offset + dash); target.moveTo(from.x + dx * offset / length, from.y + dy * offset / length).lineTo(from.x + dx * end / length, from.y + dy * end / length);
  }
  target.stroke({ ...pixiColor(color('canvas_item_add_dashed_line', 'color', colorValue)), width });
}

export function godotRenderingServerCanvasItemAddArc(rid: GodotRid, centerValue: unknown, radiusValue: unknown, startAngleValue: unknown, endAngleValue: unknown, pointCountValue: unknown, colorValue: unknown, widthValue = -1, antialiasedValue = false): void {
  const center = point('canvas_item_add_arc', 'center', centerValue);
  const radius = finite('canvas_item_add_arc', 'radius', radiusValue);
  const start = finite('canvas_item_add_arc', 'start_angle', startAngleValue);
  const end = finite('canvas_item_add_arc', 'end_angle', endAngleValue);
  const count = integer('canvas_item_add_arc', 'point_count', pointCountValue, 2);
  const width = finite('canvas_item_add_arc', 'width', widthValue);
  if (radius < 0 || width <= 0) throw new RangeError('RenderingServer.canvas_item_add_arc radius must be non-negative and width positive.');
  if (boolean('canvas_item_add_arc', 'antialiased', antialiasedValue)) throw new Error('Per-command antialiasing is unavailable; Pixi antialiasing is renderer-wide.');
  const vertices: number[] = [];
  for (let index = 0; index < count; index += 1) { const angle = start + (end - start) * index / (count - 1); vertices.push(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius); }
  graphics(canvasItem(rid, 'canvas_item_add_arc')).poly(vertices, false).stroke({ ...pixiColor(color('canvas_item_add_arc', 'color', colorValue)), width });
}

export function godotRenderingServerCanvasItemAddString(
  rid: GodotRid,
  positionValue: unknown,
  _fontRid: GodotRid,
  textValue: unknown,
  alignmentValue = -1,
  widthValue = -1,
  fontSizeValue = 16,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  justificationFlagsValue = 3,
  directionValue = 0,
  orientationValue = 0,
): void {
  const position = point('canvas_item_add_string', 'position', positionValue);
  if (typeof textValue !== 'string') throw new TypeError('RenderingServer.canvas_item_add_string text must be String.');
  const alignment = integer('canvas_item_add_string', 'alignment', alignmentValue, -1);
  const width = finite('canvas_item_add_string', 'width', widthValue);
  const fontSize = integer('canvas_item_add_string', 'font_size', fontSizeValue, 1);
  integer('canvas_item_add_string', 'justification_flags', justificationFlagsValue);
  const direction = integer('canvas_item_add_string', 'direction', directionValue);
  const orientation = integer('canvas_item_add_string', 'orientation', orientationValue);
  const tint = pixiColor(color('canvas_item_add_string', 'modulate', modulateValue));
  const drawable = new Text({ text: textValue, style: { fill: tint.color, fontSize, align: alignment === 1 ? 'center' : alignment === 2 ? 'right' : 'left', wordWrap: width >= 0, wordWrapWidth: width >= 0 ? width : 100000, whiteSpace: 'pre' } });
  drawable.alpha = tint.alpha; drawable.position.set(position.x, position.y - fontSize * 0.8);
  drawable.anchor.x = alignment === 1 ? 0.5 : alignment === 2 ? 1 : 0;
  if (direction === 2) drawable.scale.x = -1;
  if (orientation === 1) drawable.rotation = Math.PI / 2;
  addCommand(canvasItem(rid, 'canvas_item_add_string'), drawable);
}

export function godotRenderingServerCanvasItemAddMultilineString(
  rid: GodotRid,
  positionValue: unknown,
  _fontRid: GodotRid,
  textValue: unknown,
  alignmentValue = -1,
  widthValue = -1,
  fontSizeValue = 16,
  maxLinesValue = -1,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  lineSpacingValue = 0,
  justificationFlagsValue = 3,
  directionValue = 0,
  orientationValue = 0,
): void {
  const position = point('canvas_item_add_multiline_string', 'position', positionValue);
  if (typeof textValue !== 'string') throw new TypeError('RenderingServer.canvas_item_add_multiline_string text must be String.');
  const alignment = integer('canvas_item_add_multiline_string', 'alignment', alignmentValue, -1);
  const width = finite('canvas_item_add_multiline_string', 'width', widthValue);
  const fontSize = integer('canvas_item_add_multiline_string', 'font_size', fontSizeValue, 1);
  const maxLines = integer('canvas_item_add_multiline_string', 'max_lines', maxLinesValue, -1);
  const lineSpacing = finite('canvas_item_add_multiline_string', 'line_spacing', lineSpacingValue);
  integer('canvas_item_add_multiline_string', 'justification_flags', justificationFlagsValue);
  const direction = integer('canvas_item_add_multiline_string', 'direction', directionValue);
  const orientation = integer('canvas_item_add_multiline_string', 'orientation', orientationValue);
  const retainedText = maxLines < 0 ? textValue : textValue.split('\n').slice(0, maxLines).join('\n');
  const tint = pixiColor(color('canvas_item_add_multiline_string', 'modulate', modulateValue));
  const textAlign: 'left' | 'center' | 'right' = alignment === 1 ? 'center' : alignment === 2 ? 'right' : 'left';
  const drawable = new Text({ text: retainedText, style: { fill: tint.color, fontSize, leading: lineSpacing, align: textAlign, wordWrap: width >= 0, wordWrapWidth: width >= 0 ? width : 100000, whiteSpace: 'pre' } });
  drawable.alpha = tint.alpha; drawable.position.set(position.x, position.y - fontSize * 0.8);
  drawable.anchor.x = alignment === 1 ? 0.5 : alignment === 2 ? 1 : 0;
  if (direction === 2) drawable.scale.x = -1;
  if (orientation === 1) drawable.rotation = Math.PI / 2;
  addCommand(canvasItem(rid, 'canvas_item_add_multiline_string'), drawable);
}

export function godotRenderingServerCanvasItemAddMultiline(rid: GodotRid, pointsValue: unknown, colorsValue: unknown, widthValue = -1, antialiasedValue = false): void {
  const line = points('canvas_item_add_multiline', 'points', pointsValue);
  if (line.length % 2 !== 0) throw new RangeError('RenderingServer.canvas_item_add_multiline requires complete point pairs.');
  const width = finite('canvas_item_add_multiline', 'width', widthValue);
  if (width <= 0) throw new RangeError('RenderingServer.canvas_item_add_multiline requires positive width on Pixi.');
  if (boolean('canvas_item_add_multiline', 'antialiased', antialiasedValue)) throw new Error('Per-command antialiasing is unavailable; Pixi antialiasing is renderer-wide.');
  const target = graphics(canvasItem(rid, 'canvas_item_add_multiline'));
  const stroke = { ...pixiColor(uniformColor('canvas_item_add_multiline', colors('canvas_item_add_multiline', 'colors', colorsValue))), width };
  for (let index = 0; index < line.length; index += 2) target.moveTo(line[index]!.x, line[index]!.y).lineTo(line[index + 1]!.x, line[index + 1]!.y).stroke(stroke);
}

export function godotRenderingServerCanvasItemAddRect(rid: GodotRid, rectValue: unknown, colorValue: unknown): void {
  const value = rect('canvas_item_add_rect', 'rect', rectValue);
  graphics(canvasItem(rid, 'canvas_item_add_rect')).rect(value.position.x, value.position.y, value.size.x, value.size.y).fill(pixiColor(color('canvas_item_add_rect', 'color', colorValue)));
}

export function godotRenderingServerCanvasItemAddEllipse(rid: GodotRid, positionValue: unknown, majorAxisValue: unknown, minorAxisValue: unknown, colorValue: unknown): void {
  const position = point('canvas_item_add_ellipse', 'position', positionValue);
  const major = nonNegative('canvas_item_add_ellipse', 'major_axis', majorAxisValue);
  const minor = nonNegative('canvas_item_add_ellipse', 'minor_axis', minorAxisValue);
  graphics(canvasItem(rid, 'canvas_item_add_ellipse')).ellipse(position.x, position.y, major, minor).fill(pixiColor(color('canvas_item_add_ellipse', 'color', colorValue)));
}

function nonNegative(member: string, argument: string, value: unknown): number {
  const retained = finite(member, argument, value);
  if (retained < 0) throw new RangeError(`RenderingServer.${member} ${argument} must be non-negative.`);
  return retained;
}

function textureSprite(owner: Container, textureValue: Texture, target: { position: Vector2; size: Vector2 }, source?: { position: Vector2; size: Vector2 }, modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 }, transposeValue = false): Sprite {
  const region = source === undefined ? textureValue : new Texture({
    source: textureValue.source,
    frame: new Rectangle(textureValue.frame.x + source.position.x, textureValue.frame.y + source.position.y, source.size.x, source.size.y),
  });
  const sprite = new Sprite(region);
  sprite.position.set(target.position.x, target.position.y);
  sprite.width = target.size.x;
  sprite.height = target.size.y;
  if (transposeValue) sprite.rotation = Math.PI / 2;
  const tint = pixiColor(color('canvas_item_add_texture_rect', 'modulate', modulateValue));
  sprite.tint = tint.color;
  sprite.alpha = tint.alpha;
  addCommand(owner, sprite);
  return sprite;
}

export function godotRenderingServerCanvasItemAddTextureRect(rid: GodotRid, rectValue: unknown, textureRid: GodotRid, tileValue = false, modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 }, transposeValue = false): void {
  const owner = canvasItem(rid, 'canvas_item_add_texture_rect');
  const target = rect('canvas_item_add_texture_rect', 'rect', rectValue);
  const retained = texture(textureRid, 'canvas_item_add_texture_rect');
  if (boolean('canvas_item_add_texture_rect', 'tile', tileValue)) {
    graphics(owner).rect(target.position.x, target.position.y, target.size.x, target.size.y).fill({ ...pixiColor(color('canvas_item_add_texture_rect', 'modulate', modulateValue)), texture: retained, matrix: new Matrix().translate(target.position.x, target.position.y) });
    return;
  }
  textureSprite(owner, retained, target, undefined, modulateValue, boolean('canvas_item_add_texture_rect', 'transpose', transposeValue));
}

export function godotRenderingServerCanvasItemAddTextureRectRegion(rid: GodotRid, rectValue: unknown, textureRid: GodotRid, sourceRectValue: unknown, modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 }, transposeValue = false, clipUvValue = true): void {
  const owner = canvasItem(rid, 'canvas_item_add_texture_rect_region');
  const retained = texture(textureRid, 'canvas_item_add_texture_rect_region');
  const target = rect('canvas_item_add_texture_rect_region', 'rect', rectValue);
  let source = rect('canvas_item_add_texture_rect_region', 'src_rect', sourceRectValue);
  if (boolean('canvas_item_add_texture_rect_region', 'clip_uv', clipUvValue)) {
    const x = Math.max(0, source.position.x);
    const y = Math.max(0, source.position.y);
    source = { position: { x, y }, size: { x: Math.max(0, Math.min(retained.frame.width - x, source.size.x)), y: Math.max(0, Math.min(retained.frame.height - y, source.size.y)) } };
  }
  if (source.size.x === 0 || source.size.y === 0) return;
  textureSprite(owner, retained, target, source, modulateValue, boolean('canvas_item_add_texture_rect_region', 'transpose', transposeValue));
}

export function godotRenderingServerCanvasItemAddNinePatch(rid: GodotRid, rectValue: unknown, sourceRectValue: unknown, textureRid: GodotRid, topLeftValue: unknown, bottomRightValue: unknown, xAxisModeValue = 0, yAxisModeValue = 0, drawCenterValue = true, modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 }): void {
  const owner = canvasItem(rid, 'canvas_item_add_nine_patch');
  const target = rect('canvas_item_add_nine_patch', 'rect', rectValue);
  const source = rect('canvas_item_add_nine_patch', 'source', sourceRectValue);
  const topLeft = point('canvas_item_add_nine_patch', 'topleft', topLeftValue);
  const bottomRight = point('canvas_item_add_nine_patch', 'bottomright', bottomRightValue);
  if (integer('canvas_item_add_nine_patch', 'x_axis_mode', xAxisModeValue) > 2 || integer('canvas_item_add_nine_patch', 'y_axis_mode', yAxisModeValue) > 2) throw new RangeError('RenderingServer nine-patch axis modes must be STRETCH, TILE, or TILE_FIT.');
  if (!boolean('canvas_item_add_nine_patch', 'draw_center', drawCenterValue)) throw new Error('RenderingServer nine-patch draw_center=false has no exact Pixi NineSliceSprite carrier.');
  const retained = texture(textureRid, 'canvas_item_add_nine_patch');
  const region = new Texture({ source: retained.source, frame: new Rectangle(retained.frame.x + source.position.x, retained.frame.y + source.position.y, source.size.x, source.size.y) });
  const slice = new NineSliceSprite({ texture: region, leftWidth: topLeft.x, topHeight: topLeft.y, rightWidth: bottomRight.x, bottomHeight: bottomRight.y, width: target.size.x, height: target.size.y });
  slice.position.set(target.position.x, target.position.y);
  const tint = pixiColor(color('canvas_item_add_nine_patch', 'modulate', modulateValue));
  slice.tint = tint.color;
  slice.alpha = tint.alpha;
  addCommand(owner, slice);
}

export function godotRenderingServerCanvasItemAddPrimitive(rid: GodotRid, pointsValue: unknown, colorsValue: unknown, uvsValue: unknown = [], textureRid: GodotRid = { id: 0n }): void {
  if ((Array.isArray(uvsValue) && uvsValue.length > 0) || textureRid.id !== 0n) throw new Error('RenderingServer.canvas_item_add_primitive textured UV primitives are unavailable on Pixi Graphics.');
  const vertices = points('canvas_item_add_primitive', 'points', pointsValue);
  if (vertices.length < 1 || vertices.length > 4) throw new RangeError('RenderingServer.canvas_item_add_primitive accepts one to four points.');
  const tint = pixiColor(uniformColor('canvas_item_add_primitive', colors('canvas_item_add_primitive', 'colors', colorsValue)));
  const target = graphics(canvasItem(rid, 'canvas_item_add_primitive'));
  if (vertices.length === 1) target.circle(vertices[0]!.x, vertices[0]!.y, 0.5).fill(tint);
  else if (vertices.length === 2) target.moveTo(vertices[0]!.x, vertices[0]!.y).lineTo(vertices[1]!.x, vertices[1]!.y).stroke({ ...tint, width: 1 });
  else target.poly(vertices.flatMap((entry) => [entry.x, entry.y]), true).fill(tint);
}

export function godotRenderingServerCanvasItemAddTriangleArray(
  rid: GodotRid,
  indicesValue: unknown,
  pointsValue: unknown,
  colorsValue: unknown = [],
  uvsValue: unknown = [],
  bonesValue: unknown = [],
  weightsValue: unknown = [],
  textureRid: GodotRid = { id: 0n },
  countValue = -1,
): void {
  if (!Array.isArray(indicesValue) || indicesValue.some((entry) => !Number.isSafeInteger(entry) || entry < 0)) {
    throw new TypeError('RenderingServer.canvas_item_add_triangle_array indices must be PackedInt32Array.');
  }
  const vertices = points('canvas_item_add_triangle_array', 'points', pointsValue);
  const indices = indicesValue as number[];
  const count = countValue === -1 ? indices.length : integer('canvas_item_add_triangle_array', 'count', countValue);
  if (count > indices.length || count % 3 !== 0) throw new RangeError('RenderingServer.canvas_item_add_triangle_array count must select complete triangles.');
  if (indices.slice(0, count).some((index) => index >= vertices.length)) throw new RangeError('RenderingServer.canvas_item_add_triangle_array index exceeds vertex count.');
  if ((Array.isArray(uvsValue) && uvsValue.length > 0) || textureRid.id !== 0n) {
    throw new Error('RenderingServer.canvas_item_add_triangle_array textured UV triangles have no exact Pixi Graphics carrier.');
  }
  if ((Array.isArray(bonesValue) && bonesValue.length > 0) || (Array.isArray(weightsValue) && weightsValue.length > 0)) {
    throw new Error('RenderingServer.canvas_item_add_triangle_array skeletal weights require a native mesh carrier.');
  }
  const vertexColors = colors('canvas_item_add_triangle_array', 'colors', colorsValue);
  if (vertexColors.length !== 0 && vertexColors.length !== 1 && vertexColors.length !== vertices.length) {
    throw new RangeError('RenderingServer.canvas_item_add_triangle_array colors must be empty, singular, or per-vertex.');
  }
  const target = graphics(canvasItem(rid, 'canvas_item_add_triangle_array'));
  for (let index = 0; index < count; index += 3) {
    const ia = indices[index]!;
    const ib = indices[index + 1]!;
    const ic = indices[index + 2]!;
    const triangleColors = vertexColors.length <= 1 ? vertexColors : [vertexColors[ia]!, vertexColors[ib]!, vertexColors[ic]!];
    const fill = pixiColor(uniformColor('canvas_item_add_triangle_array', triangleColors));
    target.poly([
      vertices[ia]!.x, vertices[ia]!.y,
      vertices[ib]!.x, vertices[ib]!.y,
      vertices[ic]!.x, vertices[ic]!.y,
    ], true).fill(fill);
  }
}

export function godotRenderingServerCanvasItemAddMesh(
  rid: GodotRid,
  meshRid: GodotRid,
  transformValue: unknown = { x: { x: 1, y: 0 }, y: { x: 0, y: 1 }, origin: { x: 0, y: 0 } },
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  textureRid: GodotRid = { id: 0n },
): void {
  const retained = godotResourceOfRid(meshRid);
  if (!(retained instanceof Mesh)) throw new TypeError('RenderingServer.canvas_item_add_mesh mesh RID must identify retained Pixi Mesh geometry.');
  const textureValue = textureRid.id === 0n ? retained.texture : texture(textureRid, 'canvas_item_add_mesh');
  const command = new Mesh({ geometry: retained.geometry, texture: textureValue });
  command.setFromMatrix(transformMatrix('canvas_item_add_mesh', transformValue));
  const tint = pixiColor(color('canvas_item_add_mesh', 'modulate', modulateValue));
  command.tint = tint.color;
  command.alpha = tint.alpha;
  addCommand(canvasItem(rid, 'canvas_item_add_mesh'), command);
}

export function godotRenderingServerCanvasItemAddMultiMesh(
  rid: GodotRid,
  multimeshRid: GodotRid,
  textureRid: GodotRid = { id: 0n },
): void {
  const retained = godotResourceOfRid(multimeshRid);
  if (!(retained instanceof GodotMultiMesh)) {
    throw new TypeError(
      'RenderingServer.canvas_item_add_multimesh MultiMesh RID must identify retained MultiMesh instance data.',
    );
  }
  if (retained.transform_format !== MULTIMESH_TRANSFORM_2D) {
    throw new Error('RenderingServer.canvas_item_add_multimesh requires MultiMesh.TRANSFORM_2D.');
  }
  if (retained.use_custom_data) {
    throw new Error(
      'RenderingServer.canvas_item_add_multimesh custom instance data requires an authored Pixi shader backend.',
    );
  }
  const meshValue = retained.mesh;
  const mesh = meshValue instanceof Mesh
    ? { geometry: meshValue.geometry, texture: meshValue.texture }
    : typeof meshValue === 'object' && meshValue !== null &&
        Reflect.get(meshValue, 'geometry') instanceof MeshGeometry &&
        Reflect.get(meshValue, 'texture') instanceof Texture
      ? {
          geometry: Reflect.get(meshValue, 'geometry') as MeshGeometry,
          texture: Reflect.get(meshValue, 'texture') as Texture,
        }
      : null;
  if (mesh === null) {
    throw new TypeError(
      'RenderingServer.canvas_item_add_multimesh requires MultiMesh.mesh to retain native Pixi geometry.',
    );
  }
  const textureValue = textureRid.id === 0n
    ? mesh.texture
    : texture(textureRid, 'canvas_item_add_multimesh');
  const owner = canvasItem(rid, 'canvas_item_add_multimesh');
  const count = retained.visible_instance_count < 0
    ? retained.instance_count
    : Math.min(retained.instance_count, retained.visible_instance_count);
  for (let index = 0; index < count; index += 1) {
    const transform = retained.get_instance_transform_2d(index);
    const command = new Mesh({ geometry: mesh.geometry, texture: textureValue });
    command.setFromMatrix(new Matrix(
      transform.x.x,
      transform.x.y,
      transform.y.x,
      transform.y.y,
      transform.origin.x,
      transform.origin.y,
    ));
    if (retained.use_colors) {
      const tint = pixiColor(retained.get_instance_color(index));
      command.tint = tint.color;
      command.alpha = tint.alpha;
    }
    addCommand(owner, command);
  }
}

export function godotRenderingServerCanvasItemAddMsdfTextureRectRegion(
  rid: GodotRid,
  rectValue: unknown,
  textureRid: GodotRid,
  sourceRectValue: unknown,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
  outlineSizeValue = 0,
  pixelRangeValue = 4,
  scaleValue = 1,
): void {
  nonNegative('canvas_item_add_msdf_texture_rect_region', 'outline_size', outlineSizeValue);
  nonNegative('canvas_item_add_msdf_texture_rect_region', 'pixel_range', pixelRangeValue);
  nonNegative('canvas_item_add_msdf_texture_rect_region', 'scale', scaleValue);
  godotRenderingServerCanvasItemAddTextureRectRegion(rid, rectValue, textureRid, sourceRectValue, modulateValue, false, true);
}

export function godotRenderingServerCanvasItemAddLcdTextureRectRegion(
  rid: GodotRid,
  rectValue: unknown,
  textureRid: GodotRid,
  sourceRectValue: unknown,
  modulateValue: unknown = { r: 1, g: 1, b: 1, a: 1 },
): void {
  godotRenderingServerCanvasItemAddTextureRectRegion(rid, rectValue, textureRid, sourceRectValue, modulateValue, false, true);
}

export function godotRenderingServerCanvasItemAddAnimationSlice(rid: GodotRid, animationLengthValue: unknown, sliceBeginValue: unknown, sliceEndValue: unknown, offsetValue = 0): void {
  const animationLength = nonNegative('canvas_item_add_animation_slice', 'animation_length', animationLengthValue);
  const sliceBegin = nonNegative('canvas_item_add_animation_slice', 'slice_begin', sliceBeginValue);
  const sliceEnd = nonNegative('canvas_item_add_animation_slice', 'slice_end', sliceEndValue);
  const offset = finite('canvas_item_add_animation_slice', 'offset', offsetValue);
  if (sliceBegin > sliceEnd || sliceEnd > animationLength) throw new RangeError('RenderingServer.canvas_item_add_animation_slice requires 0 <= begin <= end <= animation_length.');
  stateOf(canvasItem(rid, 'canvas_item_add_animation_slice')).animationSlice = { animationLength, sliceBegin, sliceEnd, offset };
}

export function godotRenderingServerCanvasItemAddSetTransform(rid: GodotRid, transformValue: unknown): void {
  graphics(canvasItem(rid, 'canvas_item_add_set_transform')).setTransform(transformMatrix('canvas_item_add_set_transform', transformValue));
}

export function godotRenderingServerCanvasItemSetCopyToBackbuffer(rid: GodotRid, enabledValue: unknown, rectValue: unknown = EMPTY_RECT): void {
  const state = stateOf(canvasItem(rid, 'canvas_item_set_copy_to_backbuffer'));
  state.copyToBackbuffer = { enabled: boolean('canvas_item_set_copy_to_backbuffer', 'enabled', enabledValue), rect: rect('canvas_item_set_copy_to_backbuffer', 'rect', rectValue) };
}

export function godotRenderingServerCanvasItemSetDrawIndex(rid: GodotRid, indexValue: unknown): void {
  const owner = canvasItem(rid, 'canvas_item_set_draw_index');
  const state = stateOf(owner);
  state.drawIndex = integer('canvas_item_set_draw_index', 'index', indexValue);
  for (const command of state.commands) command.zIndex = state.drawIndex;
  owner.sortableChildren = true;
}

export function godotRenderingServerCanvasItemSetMaterial(rid: GodotRid, materialRid: GodotRid): void {
  const material = materialRid.id === 0n ? null : godotResourceOfRid(materialRid) ?? null;
  setCanvasItemMaterial(canvasItem(rid, 'canvas_item_set_material'), material as GodotCanvasMaterial | null);
}

export function godotRenderingServerCanvasItemGetMaterial(rid: GodotRid): GodotRid {
  const material = getCanvasItemMaterial(canvasItem(rid, 'canvas_item_get_material'));
  return material === null ? { id: 0n } : godotResourceGetRid(material);
}

export function godotRenderingServerCanvasItemSetUseParentMaterial(rid: GodotRid, enabledValue: unknown): void {
  stateOf(canvasItem(rid, 'canvas_item_set_use_parent_material')).useParentMaterial = boolean('canvas_item_set_use_parent_material', 'enabled', enabledValue);
}

export function godotRenderingServerCanvasItemSetInstanceShaderParameter(rid: GodotRid, nameValue: unknown, value: unknown): void {
  if (typeof nameValue !== 'string') throw new TypeError('RenderingServer.canvas_item_set_instance_shader_parameter name must be StringName.');
  stateOf(canvasItem(rid, 'canvas_item_set_instance_shader_parameter')).instanceShaderParameters.set(nameValue, value);
}

export function godotRenderingServerCanvasItemGetInstanceShaderParameter(rid: GodotRid, nameValue: unknown): unknown {
  if (typeof nameValue !== 'string') throw new TypeError('RenderingServer.canvas_item_get_instance_shader_parameter name must be StringName.');
  return stateOf(canvasItem(rid, 'canvas_item_get_instance_shader_parameter')).instanceShaderParameters.get(nameValue) ?? null;
}

export function godotRenderingServerCanvasItemGetInstanceShaderParameterList(rid: GodotRid): readonly Readonly<Record<string, unknown>>[] {
  return [...stateOf(canvasItem(rid, 'canvas_item_get_instance_shader_parameter_list')).instanceShaderParameters].map(([name, value]) => ({ name, type: typeof value }));
}

export function godotRenderingServerCanvasItemSetVisibilityNotifier(rid: GodotRid, enabledValue: unknown, rectValue: unknown, enterCallable: unknown, exitCallable: unknown): void {
  const state = stateOf(canvasItem(rid, 'canvas_item_set_visibility_notifier'));
  state.visibilityNotifier = boolean('canvas_item_set_visibility_notifier', 'enabled', enabledValue)
    ? { area: rect('canvas_item_set_visibility_notifier', 'area', rectValue), enterCallable, exitCallable }
    : null;
}

export function godotRenderingServerCanvasItemSetCanvasGroupMode(rid: GodotRid, modeValue: unknown, clearMarginValue = 5, fitEmptyValue = false, fitMarginValue = 0, blurMipmapsValue = false): void {
  const mode = integer('canvas_item_set_canvas_group_mode', 'mode', modeValue);
  if (mode > 3) throw new RangeError('RenderingServer CanvasGroup mode must be DISABLED, CLIP_ONLY, CLIP_AND_DRAW, or TRANSPARENT.');
  stateOf(canvasItem(rid, 'canvas_item_set_canvas_group_mode')).canvasGroupMode = {
    mode,
    clearMargin: nonNegative('canvas_item_set_canvas_group_mode', 'clear_margin', clearMarginValue),
    fitEmpty: boolean('canvas_item_set_canvas_group_mode', 'fit_empty', fitEmptyValue),
    fitMargin: nonNegative('canvas_item_set_canvas_group_mode', 'fit_margin', fitMarginValue),
    blurMipmaps: boolean('canvas_item_set_canvas_group_mode', 'blur_mipmaps', blurMipmapsValue),
  };
}

export function godotRenderingServerCanvasItemGetCopyToBackbuffer(rid: GodotRid): ServerCanvasState['copyToBackbuffer'] { return stateOf(canvasItem(rid, 'canvas_item_get_copy_to_backbuffer')).copyToBackbuffer; }
export function godotRenderingServerCanvasItemGetDrawIndex(rid: GodotRid): number { return stateOf(canvasItem(rid, 'canvas_item_get_draw_index')).drawIndex; }
export function godotRenderingServerCanvasItemIsUsingParentMaterial(rid: GodotRid): boolean { return stateOf(canvasItem(rid, 'canvas_item_is_using_parent_material')).useParentMaterial; }
export function godotRenderingServerCanvasItemGetVisibilityNotifier(rid: GodotRid): GodotCanvasVisibilityNotifier | null { return stateOf(canvasItem(rid, 'canvas_item_get_visibility_notifier')).visibilityNotifier; }
export function godotRenderingServerCanvasItemGetCanvasGroupMode(rid: GodotRid): GodotCanvasGroupMode { return stateOf(canvasItem(rid, 'canvas_item_get_canvas_group_mode')).canvasGroupMode; }
export function godotRenderingServerCanvasItemGetAnimationSlice(rid: GodotRid): ServerCanvasState['animationSlice'] { return stateOf(canvasItem(rid, 'canvas_item_get_animation_slice')).animationSlice; }

export function godotRenderingServerCanvasItemSetVisible(rid: GodotRid, visibleValue: unknown): void {
  setVisible(canvasItem(rid, 'canvas_item_set_visible'), boolean('canvas_item_set_visible', 'visible', visibleValue));
}

export function godotRenderingServerCanvasItemGetVisible(rid: GodotRid): boolean {
  return canvasItem(rid, 'canvas_item_get_visible').visible;
}

export function godotRenderingServerCanvasItemClearCommands(rid: GodotRid): void {
  const owner = canvasItem(rid, 'canvas_item_clear');
  const state = stateOf(owner);
  for (const command of state.commands.splice(0)) {
    command.removeFromParent();
    command.destroy({ children: true });
  }
  DRAW_TARGET.delete(owner);
  godotRenderingServerCanvasItemClear(rid);
}
