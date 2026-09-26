/** Retained Pixi per-CanvasItem lighting for Godot 3 Light2D and Godot 4 Light2D families. */

import {
  Container,
  Filter,
  GlProgram,
  Matrix,
  Point,
  Texture,
  UniformGroup,
} from 'pixi.js';
import { packedVector2Array, type PackedVector2Array } from './packed-array';
import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';
import type { ColorValue } from './variant';
import type { Vector2 } from './vector2';
import {
  CANVAS_ITEM_LIGHT_MODE,
  getCanvasItemMaterial,
  getGodotCanvasMaterialLightMode,
} from './canvas-item-material';
import { releaseGradientTexture2D } from './pixi-drawables-2d';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';

const WHITE: ColorValue = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
const SHADOW_DEFAULT: ColorValue = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

export interface CanvasLight2DOptions {
  readonly major: 3 | 4;
  readonly kind: 'point' | 'directional';
  readonly enabled?: boolean;
  readonly editorOnly?: boolean;
  readonly color?: ColorValue;
  readonly energy?: number;
  readonly blendMode?: number;
  readonly rangeZMin?: number;
  readonly rangeZMax?: number;
  readonly rangeLayerMin?: number;
  readonly rangeLayerMax?: number;
  readonly itemCullMask?: number;
  readonly shadowEnabled?: boolean;
  readonly shadowColor?: ColorValue;
  readonly shadowFilter?: number;
  readonly shadowSmooth?: number;
  readonly shadowBufferSize?: number;
  readonly shadowGradientLength?: number;
  readonly shadowItemCullMask?: number;
  readonly texture?: Texture | null;
  readonly offset?: Vector2;
  readonly textureScale?: number;
  readonly height?: number;
  readonly maxDistance?: number;
}

export interface CanvasLight2DApi {
  enabled: boolean;
  editor_only: boolean;
  color: ColorValue;
  energy: number;
  blend_mode: number;
  mode: number;
  range_z_min: number;
  range_z_max: number;
  range_layer_min: number;
  range_layer_max: number;
  range_item_cull_mask: number;
  shadow_enabled: boolean;
  shadow_color: ColorValue;
  shadow_filter: number;
  shadow_filter_smooth: number;
  shadow_buffer_size: number;
  shadow_gradient_length: number;
  shadow_item_cull_mask: number;
  texture: Texture | null;
  offset: Vector2;
  texture_offset: Vector2;
  texture_scale: number;
  height: number;
  range_height: number;
  max_distance: number;
  set_enabled(value: boolean): void;
  is_enabled(): boolean;
  set_editor_only(value: boolean): void;
  is_editor_only(): boolean;
  set_color(value: ColorValue): void;
  get_color(): ColorValue;
  set_energy(value: number): void;
  get_energy(): number;
  set_blend_mode(value: number): void;
  get_blend_mode(): number;
  set_mode(value: number): void;
  get_mode(): number;
  set_z_range_min(value: number): void;
  get_z_range_min(): number;
  set_z_range_max(value: number): void;
  get_z_range_max(): number;
  set_layer_range_min(value: number): void;
  get_layer_range_min(): number;
  set_layer_range_max(value: number): void;
  get_layer_range_max(): number;
  set_item_cull_mask(value: number): void;
  get_item_cull_mask(): number;
  set_item_shadow_cull_mask(value: number): void;
  get_item_shadow_cull_mask(): number;
  set_shadow_enabled(value: boolean): void;
  is_shadow_enabled(): boolean;
  set_shadow_color(value: ColorValue): void;
  get_shadow_color(): ColorValue;
  set_shadow_filter(value: number): void;
  get_shadow_filter(): number;
  set_shadow_smooth(value: number): void;
  get_shadow_smooth(): number;
  set_shadow_buffer_size(value: number): void;
  get_shadow_buffer_size(): number;
  set_shadow_gradient_length(value: number): void;
  get_shadow_gradient_length(): number;
  set_texture(value: Texture | null): void;
  get_texture(): Texture | null;
  set_texture_offset(value: Vector2): void;
  get_texture_offset(): Vector2;
  set_texture_scale(value: number): void;
  get_texture_scale(): number;
  set_height(value: number): void;
  get_height(): number;
  set_max_distance(value: number): void;
  get_max_distance(): number;
}

export type GodotCanvasLight2D = Container & CanvasLight2DApi;

interface LightState {
  readonly id: number;
  readonly root: Container;
  readonly node: GodotCanvasLight2D;
  readonly major: 3 | 4;
  readonly kind: 'point' | 'directional';
  enabled: boolean;
  editorOnly: boolean;
  color: ColorValue;
  energy: number;
  blendMode: number;
  zMin: number;
  zMax: number;
  layerMin: number;
  layerMax: number;
  itemMask: number;
  shadowEnabled: boolean;
  shadowColor: ColorValue;
  shadowFilter: number;
  shadowSmooth: number;
  shadowBufferSize: number;
  shadowGradientLength: number;
  shadowItemMask: number;
  texture: Texture | null;
  offset: Vector2;
  textureScale: number;
  height: number;
  maxDistance: number;
  revision: number;
}

interface ItemState {
  readonly root: Container;
  readonly item: Container;
  lightMask: number;
  layer: number;
  installed: InstalledFilter[];
  signature: string;
}

function itemLightMode(item: Container): number {
  return getGodotCanvasMaterialLightMode(getCanvasItemMaterial(item));
}

interface OccluderState {
  readonly id: number;
  readonly root: Container;
  readonly node: GodotCanvasLightOccluder2D;
  polygon: GodotOccluderPolygon2D | null;
  sdf: boolean;
  lightMask: number;
  revision: number;
  releasePolygonObserver: (() => void) | null;
}

interface RootState {
  readonly lights: Set<GodotCanvasLight2D>;
  readonly items: Set<Container>;
  readonly occluders: Set<GodotCanvasLightOccluder2D>;
  aggregate: ItemState | null;
  revision: number;
}

const ROOTS = new WeakMap<Container, RootState>();
const LIGHTS = new WeakMap<GodotCanvasLight2D, LightState>();
const ITEMS = new WeakMap<Container, ItemState>();
const OCCLUDERS = new WeakMap<GodotCanvasLightOccluder2D, OccluderState>();
const CANVAS_LAYERS = new WeakMap<Container, number>();
const OCCLUDER_POLYGONS = new WeakSet<object>();
const OCCLUDER_POLYGON_OBSERVERS = new WeakMap<object, Set<() => void>>();
const WARNED_DEVICE_LIMIT = new WeakSet<Container>();
let nextBindingId = 1;
const TEXTURE_IDS = new WeakMap<Texture, number>();

function textureId(texture: Texture | null): number {
  if (texture === null) return 0;
  let id = TEXTURE_IDS.get(texture);
  if (id === undefined) { id = nextBindingId++; TEXTURE_IDS.set(texture, id); }
  return id;
}

export function registerCanvasLightingLayer(layer: Container, value: number): void {
  CANVAS_LAYERS.set(layer, integer(value, 'CanvasLayer.layer'));
}

export function releaseCanvasLightingLayer(layer: Container): void {
  CANVAS_LAYERS.delete(layer);
}

function effectiveCanvasLayer(item: Container, root: Container): number {
  let current: Container | null = item;
  while (current !== null && current !== root) {
    const layer = CANVAS_LAYERS.get(current);
    if (layer !== undefined) return layer;
    current = current.parent;
  }
  return 0;
}

function rootState(root: Container): RootState {
  let state = ROOTS.get(root);
  if (state !== undefined) return state;
  state = { lights: new Set(), items: new Set(), occluders: new Set(), aggregate: null, revision: 0 };
  ROOTS.set(root, state);
  return state;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${member} requires finite float.`);
  return value;
}

function integer(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`${member} requires int.`);
  return value;
}

function mask(value: unknown, member: string): number {
  const next = integer(value, member);
  if (next < -0x80000000 || next > 0xffffffff) throw new RangeError(`${member} requires a 32-bit mask.`);
  return next >>> 0;
}

function enumValue(value: unknown, member: string, min: number, max: number): number {
  const next = integer(value, member);
  if (next < min || next > max) throw new RangeError(`${member} must be ${min}..${max}.`);
  return next;
}

function colorValue(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${member} requires Color.`);
  const one = value as Partial<ColorValue>;
  return {
    r: finite(one.r, `${member}.r`),
    g: finite(one.g, `${member}.g`),
    b: finite(one.b, `${member}.b`),
    a: finite(one.a, `${member}.a`),
  };
}

function pointValue(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`${member} requires Vector2.`);
  const one = value as Partial<Vector2>;
  return { x: finite(one.x, `${member}.x`), y: finite(one.y, `${member}.y`) };
}

function copyColor(value: ColorValue): ColorValue { return { r: value.r, g: value.g, b: value.b, a: value.a }; }
function copyPoint(value: Vector2): Vector2 { return { x: value.x, y: value.y }; }

function changed(state: LightState): void {
  state.revision += 1;
  rootState(state.root).revision += 1;
}

function property<T>(
  target: object,
  name: string,
  read: () => T,
  write: (value: T) => void,
): void {
  Object.defineProperty(target, name, { configurable: true, enumerable: true, get: read, set: write });
}

/** Bind the authored light API directly onto its retained native Pixi Container. */
export function bindCanvasLight2D(
  node: Container,
  root: Container,
  options: CanvasLight2DOptions,
): GodotCanvasLight2D {
  releaseCanvasLight2D(node as GodotCanvasLight2D);
  const light = node as GodotCanvasLight2D;
  const state: LightState = {
    id: nextBindingId++,
    root,
    node: light,
    major: options.major,
    kind: options.kind,
    enabled: options.enabled ?? true,
    editorOnly: options.editorOnly ?? false,
    color: colorValue(options.color ?? WHITE, 'Light2D.color'),
    energy: finite(options.energy ?? 1, 'Light2D.energy'),
    blendMode: enumValue(options.blendMode ?? 0, 'Light2D.blend_mode', 0, options.major === 3 ? 3 : 2),
    zMin: integer(options.rangeZMin ?? -1024, 'Light2D.range_z_min'),
    zMax: integer(options.rangeZMax ?? 1024, 'Light2D.range_z_max'),
    layerMin: integer(options.rangeLayerMin ?? -512, 'Light2D.range_layer_min'),
    layerMax: integer(options.rangeLayerMax ?? 512, 'Light2D.range_layer_max'),
    itemMask: mask(options.itemCullMask ?? 1, 'Light2D.range_item_cull_mask'),
    shadowEnabled: options.shadowEnabled ?? false,
    shadowColor: colorValue(options.shadowColor ?? SHADOW_DEFAULT, 'Light2D.shadow_color'),
    shadowFilter: enumValue(options.shadowFilter ?? 0, 'Light2D.shadow_filter', 0, options.major === 3 ? 5 : 2),
    shadowSmooth: finite(options.shadowSmooth ?? 0, 'Light2D.shadow_filter_smooth'),
    shadowBufferSize: integer(options.shadowBufferSize ?? 2048, 'Light2D.shadow_buffer_size'),
    shadowGradientLength: finite(options.shadowGradientLength ?? 0, 'Light2D.shadow_gradient_length'),
    shadowItemMask: mask(options.shadowItemCullMask ?? 1, 'Light2D.shadow_item_cull_mask'),
    texture: options.texture ?? null,
    offset: pointValue(options.offset ?? { x: 0, y: 0 }, 'PointLight2D.offset'),
    textureScale: finite(options.textureScale ?? 1, 'PointLight2D.texture_scale'),
    height: finite(options.height ?? 0, 'Light2D.height'),
    maxDistance: finite(options.maxDistance ?? 10_000, 'DirectionalLight2D.max_distance'),
    revision: 0,
  };
  if (state.textureScale === 0) throw new RangeError('PointLight2D.texture_scale cannot be zero.');
  LIGHTS.set(light, state);
  rootState(root).lights.add(light);
  rootState(root).revision += 1;

  const assign = <K extends keyof LightState>(key: K, value: LightState[K]): void => {
    if (state[key] === value) return;
    state[key] = value;
    changed(state);
  };
  property(light, 'enabled', () => state.enabled, (value) => assign('enabled', boolean(value, 'Light2D.enabled')));
  property(light, 'editor_only', () => state.editorOnly, (value) => assign('editorOnly', boolean(value, 'Light2D.editor_only')));
  property(light, 'color', () => copyColor(state.color), (value) => { state.color = colorValue(value, 'Light2D.color'); changed(state); });
  property(light, 'energy', () => state.energy, (value) => assign('energy', finite(value, 'Light2D.energy')));
  property(light, 'blend_mode', () => state.blendMode, (value) => assign('blendMode', enumValue(value, 'Light2D.blend_mode', 0, state.major === 3 ? 3 : 2)));
  property(light, 'mode', () => state.blendMode, (value) => assign('blendMode', enumValue(value, 'Light2D.mode', 0, state.major === 3 ? 3 : 2)));
  property(light, 'range_z_min', () => state.zMin, (value) => assign('zMin', integer(value, 'Light2D.range_z_min')));
  property(light, 'range_z_max', () => state.zMax, (value) => assign('zMax', integer(value, 'Light2D.range_z_max')));
  property(light, 'range_layer_min', () => state.layerMin, (value) => assign('layerMin', integer(value, 'Light2D.range_layer_min')));
  property(light, 'range_layer_max', () => state.layerMax, (value) => assign('layerMax', integer(value, 'Light2D.range_layer_max')));
  property(light, 'range_item_cull_mask', () => state.itemMask, (value) => assign('itemMask', mask(value, 'Light2D.range_item_cull_mask')));
  property(light, 'shadow_enabled', () => state.shadowEnabled, (value) => assign('shadowEnabled', boolean(value, 'Light2D.shadow_enabled')));
  property(light, 'shadow_color', () => copyColor(state.shadowColor), (value) => { state.shadowColor = colorValue(value, 'Light2D.shadow_color'); changed(state); });
  property(light, 'shadow_filter', () => state.shadowFilter, (value) => assign('shadowFilter', enumValue(value, 'Light2D.shadow_filter', 0, state.major === 3 ? 5 : 2)));
  property(light, 'shadow_filter_smooth', () => state.shadowSmooth, (value) => assign('shadowSmooth', finite(value, 'Light2D.shadow_filter_smooth')));
  property(light, 'shadow_buffer_size', () => state.shadowBufferSize, (value) => assign('shadowBufferSize', integer(value, 'Light2D.shadow_buffer_size')));
  property(light, 'shadow_gradient_length', () => state.shadowGradientLength, (value) => assign('shadowGradientLength', finite(value, 'Light2D.shadow_gradient_length')));
  property(light, 'shadow_item_cull_mask', () => state.shadowItemMask, (value) => assign('shadowItemMask', mask(value, 'Light2D.shadow_item_cull_mask')));
  property(light, 'texture', () => state.texture, (value) => {
    if (value !== null && !(value instanceof Texture)) throw new TypeError('PointLight2D.texture requires Pixi Texture2D.');
    const previous = state.texture;
    assign('texture', value);
    if (previous !== null && previous !== value) releaseGradientTexture2D(previous);
  });
  property(light, 'offset', () => copyPoint(state.offset), (value) => { state.offset = pointValue(value, 'PointLight2D.offset'); changed(state); });
  property(light, 'texture_offset', () => copyPoint(state.offset), (value) => { state.offset = pointValue(value, 'PointLight2D.texture_offset'); changed(state); });
  property(light, 'texture_scale', () => state.textureScale, (value) => { const next = finite(value, 'PointLight2D.texture_scale'); if (next === 0) throw new RangeError('PointLight2D.texture_scale cannot be zero.'); assign('textureScale', next); });
  property(light, 'height', () => state.height, (value) => assign('height', finite(value, 'Light2D.height')));
  property(light, 'range_height', () => state.height, (value) => assign('height', finite(value, 'Light2D.range_height')));
  property(light, 'max_distance', () => state.maxDistance, (value) => assign('maxDistance', finite(value, 'DirectionalLight2D.max_distance')));

  Object.assign(light, {
    set_enabled: (value: boolean) => { light.enabled = value; }, is_enabled: () => light.enabled,
    set_editor_only: (value: boolean) => { light.editor_only = value; }, is_editor_only: () => light.editor_only,
    set_color: (value: ColorValue) => { light.color = value; }, get_color: () => light.color,
    set_energy: (value: number) => { light.energy = value; }, get_energy: () => light.energy,
    set_blend_mode: (value: number) => { light.blend_mode = value; }, get_blend_mode: () => light.blend_mode,
    set_mode: (value: number) => { light.mode = value; }, get_mode: () => light.mode,
    set_z_range_min: (value: number) => { light.range_z_min = value; }, get_z_range_min: () => light.range_z_min,
    set_z_range_max: (value: number) => { light.range_z_max = value; }, get_z_range_max: () => light.range_z_max,
    set_layer_range_min: (value: number) => { light.range_layer_min = value; }, get_layer_range_min: () => light.range_layer_min,
    set_layer_range_max: (value: number) => { light.range_layer_max = value; }, get_layer_range_max: () => light.range_layer_max,
    set_item_cull_mask: (value: number) => { light.range_item_cull_mask = value; }, get_item_cull_mask: () => light.range_item_cull_mask,
    set_item_shadow_cull_mask: (value: number) => { light.shadow_item_cull_mask = value; }, get_item_shadow_cull_mask: () => light.shadow_item_cull_mask,
    set_shadow_enabled: (value: boolean) => { light.shadow_enabled = value; }, is_shadow_enabled: () => light.shadow_enabled,
    set_shadow_color: (value: ColorValue) => { light.shadow_color = value; }, get_shadow_color: () => light.shadow_color,
    set_shadow_filter: (value: number) => { light.shadow_filter = value; }, get_shadow_filter: () => light.shadow_filter,
    set_shadow_smooth: (value: number) => { light.shadow_filter_smooth = value; }, get_shadow_smooth: () => light.shadow_filter_smooth,
    set_shadow_buffer_size: (value: number) => { light.shadow_buffer_size = value; }, get_shadow_buffer_size: () => light.shadow_buffer_size,
    set_shadow_gradient_length: (value: number) => { light.shadow_gradient_length = value; }, get_shadow_gradient_length: () => light.shadow_gradient_length,
    set_texture: (value: Texture | null) => { light.texture = value; }, get_texture: () => light.texture,
    set_texture_offset: (value: Vector2) => { light.texture_offset = value; }, get_texture_offset: () => light.texture_offset,
    set_texture_scale: (value: number) => { light.texture_scale = value; }, get_texture_scale: () => light.texture_scale,
    set_height: (value: number) => { light.height = value; }, get_height: () => light.height,
    set_max_distance: (value: number) => { light.max_distance = value; }, get_max_distance: () => light.max_distance,
  } satisfies Partial<CanvasLight2DApi>);
  return light;
}

export function releaseCanvasLight2D(light: GodotCanvasLight2D): void {
  const state = LIGHTS.get(light);
  if (state === undefined) return;
  LIGHTS.delete(light);
  if (state.texture !== null) releaseGradientTexture2D(state.texture);
  const root = rootState(state.root);
  root.lights.delete(light);
  root.revision += 1;
}

/** Construct a retained native Godot 3 Light2D or Godot 4 point/directional light node. */
export function createGodotCanvasLight2D(
  root: Container,
  options: CanvasLight2DOptions,
): GodotCanvasLight2D {
  const node = bindCanvasLight2D(bindGodotCanvasNode2DApi(new Container()), root, options);
  const className = options.major === 3
    ? 'Light2D'
    : options.kind === 'directional' ? 'DirectionalLight2D' : 'PointLight2D';
  registerGodotObjectIdentity(node, className);
  registerCanvasNodeRelease(node, () => releaseCanvasLight2D(node));
  return node;
}

export function createGodotPointLight2D(
  root: Container,
  options: Omit<CanvasLight2DOptions, 'major' | 'kind'> & { readonly major?: 3 | 4 } = {},
): GodotCanvasLight2D {
  return createGodotCanvasLight2D(root, { ...options, major: options.major ?? 4, kind: 'point' });
}

export function createGodotDirectionalLight2D(
  root: Container,
  options: Omit<CanvasLight2DOptions, 'major' | 'kind'> = {},
): GodotCanvasLight2D {
  return createGodotCanvasLight2D(root, { ...options, major: 4, kind: 'directional' });
}

export interface CanvasItemLightOptions { readonly lightMask?: number; readonly layer?: number }

export function bindCanvasItemLighting(
  item: Container,
  root: Container,
  options: CanvasItemLightOptions = {},
): Container {
  releaseCanvasItemLighting(item);
  const state: ItemState = {
    root,
    item,
    lightMask: mask(options.lightMask ?? 1, 'CanvasItem.light_mask'),
    layer: integer(options.layer ?? 0, 'CanvasItem canvas layer'),
    installed: [],
    signature: '',
  };
  ITEMS.set(item, state);
  rootState(root).items.add(item);
  property(item, 'light_mask', () => state.lightMask, (value) => {
    state.lightMask = mask(value, 'CanvasItem.light_mask');
    state.signature = '';
  });
  Object.assign(item, {
    set_light_mask: (value: number) => { (item as Container & { light_mask: number }).light_mask = value; },
    get_light_mask: () => state.lightMask,
  });
  return item;
}

function removeInstalled(state: ItemState): void {
  state.signature = '';
  if (state.installed.length === 0) return;
  const installed = new Set(state.installed.map((entry) => entry.filter));
  state.item.filters = (state.item.filters ?? []).filter((filter) => !installed.has(filter));
  for (const entry of state.installed) entry.filter.destroy();
  state.installed = [];
}

export function releaseCanvasItemLighting(item: Container): void {
  const state = ITEMS.get(item);
  if (state === undefined) return;
  removeInstalled(state);
  rootState(state.root).items.delete(item);
  ITEMS.delete(item);
}

const FILTER_VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) { return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void) { gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }
`;

function lightFragment(passes: readonly LightPass[]): string {
  const declarations = passes.map((pass, index) => `
uniform vec2 uLightPosition${index};
uniform vec2 uLightDirection${index};
uniform vec2 uLightOffset${index};
uniform vec4 uLightInverse${index};
uniform vec2 uLightTranslation${index};
uniform vec2 uLightTextureSize${index};
uniform vec4 uLightColor${index};
uniform vec4 uShadowColor${index};
uniform vec4 uShadowSettings${index};
uniform vec4 uLightParams${index};
uniform int uLightBlend${index};
uniform sampler2D uLightTexture${index};
${pass.shadows.map((_segment, edge) => `uniform vec4 uShadowEdge${index}_${edge};\nuniform int uShadowCull${index}_${edge};`).join('\n')}`).join('');
  const shadowFunctions = passes.map(({ light, shadows }, index) => {
    if (shadows.length === 0 || !light.shadowEnabled) return '';
    const origin = light.kind === 'point'
      ? `uLightPosition${index}`
      : `target - uLightDirection${index} * uLightParams${index}.w`;
    const ray = shadows.map((_segment, edge) =>
      `rayOccluded(${origin}, target, uShadowEdge${index}_${edge}, uShadowCull${index}_${edge})`).join(' || ');
    return `float shadowAt${index}(vec2 target) { return (${ray}) ? 1.0 : 0.0; }`;
  }).join('\n');
  const applications = passes.map(({ light, shadows }, index) => {
    const shadow = shadows.length === 0 ? `
  float shadowAmount${index} = 0.0;
  float shadowFactor${index} = 1.0;
  vec3 shadowTint${index} = vec3(0.0);` : `
  float hardShadow${index} = shadowAt${index}(localPosition);
  float shadowAmount${index} = hardShadow${index};
  float shadowKernel${index} = uShadowSettings${index}.x;
  float shadowRadius${index} = max(1.0, uShadowSettings${index}.y) * uShadowSettings${index}.z;
  if (shadowKernel${index} > 1.0) {
    shadowAmount${index} = 0.0;
    float samples${index} = 0.0;
    float kernelRadius${index} = (shadowKernel${index} - 1.0) * 0.5;
    for (int sy = -6; sy <= 6; sy++) for (int sx = -6; sx <= 6; sx++) {
      if (abs(float(sx)) <= kernelRadius${index} && abs(float(sy)) <= kernelRadius${index}) {
        shadowAmount${index} += shadowAt${index}(localPosition + vec2(float(sx), float(sy)) * shadowRadius${index});
        samples${index} += 1.0;
      }
    }
    shadowAmount${index} /= samples${index};
  }
  float shadowFactor${index} = mix(1.0, uShadowColor${index}.a, shadowAmount${index});
  vec3 shadowTint${index} = uShadowColor${index}.rgb * shadowAmount${index};`;
    return light.kind === 'point' ? `
  vec2 lightLocal${index} = vec2(
    dot(uLightInverse${index}.xy, localPosition),
    dot(uLightInverse${index}.zw, localPosition)
  ) + uLightTranslation${index} - uLightOffset${index};
  vec2 lightUv${index} = lightLocal${index} / (uLightTextureSize${index} * uLightParams${index}.y) + vec2(0.5);
  float inside${index} = step(0.0, lightUv${index}.x) * step(lightUv${index}.x, 1.0) * step(0.0, lightUv${index}.y) * step(lightUv${index}.y, 1.0);
  vec4 lightSample${index} = texture(uLightTexture${index}, lightUv${index}) * inside${index};
  ${shadow}
  vec3 contribution${index} = (lightSample${index}.rgb * uLightColor${index}.rgb * shadowFactor${index} + shadowTint${index}) * uLightParams${index}.x;
  float lightAlpha${index} = lightSample${index}.a * uLightColor${index}.a * shadowFactor${index} * uLightParams${index}.x;
  if (uLightBlend${index} == 0) lit += source.rgb * contribution${index};
  else if (uLightBlend${index} == 1) lit -= source.rgb * contribution${index};
  else if (uLightBlend${index} == 2) lit = mix(lit, contribution${index} * source.a, clamp(lightAlpha${index}, 0.0, 1.0));
  else lit *= clamp(lightAlpha${index}, 0.0, 1.0);` : `
  ${shadow}
  vec3 contribution${index} = (uLightColor${index}.rgb * shadowFactor${index} + shadowTint${index}) * uLightParams${index}.x;
  float lightAlpha${index} = uLightColor${index}.a * shadowFactor${index} * uLightParams${index}.x;
  if (uLightBlend${index} == 0) lit += source.rgb * contribution${index};
  else if (uLightBlend${index} == 1) lit -= source.rgb * contribution${index};
  else if (uLightBlend${index} == 2) lit = mix(lit, contribution${index} * source.a, clamp(lightAlpha${index}, 0.0, 1.0));
  else lit *= clamp(lightAlpha${index}, 0.0, 1.0);`;
  }).join('');
  return `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec2 uItemSize;
uniform vec2 uItemOrigin;
uniform int uItemLightMode;
${declarations}
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
bool rayOccluded(vec2 origin, vec2 target, vec4 packedEdge, int cullMode) {
  vec2 a = packedEdge.xy;
  vec2 edge = packedEdge.zw - a;
  vec2 ray = target - origin;
  float denominator = cross2(ray, edge);
  if (abs(denominator) < 0.000001) return false;
  float facing = cross2(edge, origin - a);
  if ((cullMode == 1 && facing <= 0.0) || (cullMode == 2 && facing >= 0.0)) return false;
  vec2 relative = a - origin;
  float t = cross2(relative, edge) / denominator;
  float u = cross2(relative, ray) / denominator;
  return t > 0.000001 && t < 0.999999 && u >= 0.0 && u <= 1.0;
}
${shadowFunctions}
void main(void) {
  vec4 source = texture(uTexture, vTextureCoord);
  vec2 localPosition = uItemOrigin + vTextureCoord * uItemSize;
  vec3 lit = uItemLightMode == 2 ? vec3(0.0) : source.rgb;
  ${applications}
  finalColor = vec4(lit, source.a);
}`;
}

interface ShadowSegment {
  readonly occluder: OccluderState;
  readonly edge: number;
}

interface LightPass {
  readonly light: LightState;
  readonly shadows: readonly ShadowSegment[];
}

interface InstalledFilter {
  readonly filter: Filter;
  readonly group: UniformGroup;
  readonly passes: readonly LightPass[];
}

function shadowSegments(root: RootState, light: LightState): ShadowSegment[] {
  if (!light.shadowEnabled) return [];
  const segments: ShadowSegment[] = [];
  for (const native of root.occluders) {
    const occluder = OCCLUDERS.get(native);
    if (occluder === undefined || occluder.polygon === null) continue;
    if ((occluder.lightMask & light.shadowItemMask) === 0) continue;
    const points = occluder.polygon.polygon;
    const edgeCount = occluder.polygon.closed ? points.length : Math.max(0, points.length - 1);
    for (let edge = 0; edge < edgeCount; edge += 1) segments.push({ occluder, edge });
  }
  return segments;
}

function buildFilter(item: ItemState, passes: readonly LightPass[]): InstalledFilter {
  const uniforms: Record<string, { value: unknown; type: 'f32' | 'i32' | 'vec2<f32>' | 'vec4<f32>' }> = {
    uItemSize: { value: new Float32Array(2), type: 'vec2<f32>' },
    uItemOrigin: { value: new Float32Array(2), type: 'vec2<f32>' },
    uItemLightMode: { value: 0, type: 'i32' },
  };
  const resources: Record<string, unknown> = {};
  passes.forEach(({ light, shadows }, index) => {
    uniforms[`uLightPosition${index}`] = { value: new Float32Array(2), type: 'vec2<f32>' };
    uniforms[`uLightDirection${index}`] = { value: new Float32Array(2), type: 'vec2<f32>' };
    uniforms[`uLightOffset${index}`] = { value: new Float32Array(2), type: 'vec2<f32>' };
    uniforms[`uLightInverse${index}`] = { value: new Float32Array(4), type: 'vec4<f32>' };
    uniforms[`uLightTranslation${index}`] = { value: new Float32Array(2), type: 'vec2<f32>' };
    uniforms[`uLightTextureSize${index}`] = { value: new Float32Array(2), type: 'vec2<f32>' };
    uniforms[`uLightColor${index}`] = { value: new Float32Array(4), type: 'vec4<f32>' };
    uniforms[`uShadowColor${index}`] = { value: new Float32Array(4), type: 'vec4<f32>' };
    uniforms[`uShadowSettings${index}`] = { value: new Float32Array(4), type: 'vec4<f32>' };
    uniforms[`uLightParams${index}`] = { value: new Float32Array(4), type: 'vec4<f32>' };
    uniforms[`uLightBlend${index}`] = { value: light.blendMode, type: 'i32' };
    resources[`uLightTexture${index}`] = (light.texture ?? Texture.WHITE).source;
    shadows.forEach((_segment, edge) => {
      uniforms[`uShadowEdge${index}_${edge}`] = { value: new Float32Array(4), type: 'vec4<f32>' };
      uniforms[`uShadowCull${index}_${edge}`] = { value: 0, type: 'i32' };
    });
  });
  const group = new UniformGroup(uniforms);
  resources['lightingUniforms'] = group;
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: FILTER_VERTEX, fragment: lightFragment(passes) }),
    resources,
  });
  // Keep unrelated authored/ShaderMaterial filters; this owner removes only filters it installed.
  item.item.filters = [...(item.item.filters ?? []), filter];
  const installed = { filter, group, passes };
  item.installed.push(installed);
  return installed;
}

function lightEligible(item: ItemState, light: LightState): boolean {
  if (itemLightMode(item.item) === CANVAS_ITEM_LIGHT_MODE.UNSHADED) return false;
  if (!light.enabled || light.editorOnly || !visibleInRetainedTree(light.node)) return false;
  if ((item.lightMask & light.itemMask) === 0) return false;
  const finalZ = effectiveCanvasZ(item.item, item.root);
  if (finalZ < light.zMin || finalZ > light.zMax) return false;
  if (item.layer < light.layerMin || item.layer > light.layerMax) return false;
  if (light.kind === 'point' && light.texture === null) return false;
  return true;
}

function effectiveCanvasZ(item: Container, root: Container): number {
  let z = 0;
  let current: Container | null = item;
  while (current !== null && current !== root) {
    z += current.zIndex;
    current = current.parent;
  }
  return z;
}

function visibleInRetainedTree(node: Container): boolean {
  let current: Container | null = node;
  while (current !== null) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function updateFilter(item: ItemState, passes: readonly LightPass[], group: UniformGroup): void {
  const bounds = item.item.getLocalBounds();
  group.uniforms['uItemSize'] = new Float32Array([bounds.width, bounds.height]);
  group.uniforms['uItemOrigin'] = new Float32Array([bounds.x, bounds.y]);
  group.uniforms['uItemLightMode'] = itemLightMode(item.item);
  passes.forEach(({ light, shadows }, index) => {
    const global = light.node.getGlobalPosition(new Point());
    const local = item.item.toLocal(global, undefined, new Point());
    const itemOriginGlobal = item.item.toGlobal(new Point(0, 0));
    const itemXGlobal = item.item.toGlobal(new Point(1, 0));
    const itemYGlobal = item.item.toGlobal(new Point(0, 1));
    const originInLight = light.node.toLocal(itemOriginGlobal, undefined, new Point());
    const xInLight = light.node.toLocal(itemXGlobal, undefined, new Point());
    const yInLight = light.node.toLocal(itemYGlobal, undefined, new Point());
    const lightOffsetGlobal = light.node.toGlobal(new Point(light.offset.x, light.offset.y));
    const lightOffsetInItem = item.item.toLocal(lightOffsetGlobal, undefined, new Point());
    const lightTransform = light.node.getGlobalTransform(new Matrix());
    const globalDirection = new Point(lightTransform.a, lightTransform.b);
    const globalDirectionEnd = new Point(global.x + globalDirection.x, global.y + globalDirection.y);
    const localDirectionEnd = item.item.toLocal(globalDirectionEnd, undefined, new Point());
    const directionLength = Math.hypot(localDirectionEnd.x - local.x, localDirectionEnd.y - local.y) || 1;
    const texture = light.texture ?? Texture.WHITE;
    group.uniforms[`uLightPosition${index}`] = new Float32Array([local.x, local.y]);
    group.uniforms[`uLightDirection${index}`] = new Float32Array([
      (localDirectionEnd.x - local.x) / directionLength,
      (localDirectionEnd.y - local.y) / directionLength,
    ]);
    group.uniforms[`uLightOffset${index}`] = new Float32Array([light.offset.x, light.offset.y]);
    group.uniforms[`uLightInverse${index}`] = new Float32Array([
      xInLight.x - originInLight.x,
      yInLight.x - originInLight.x,
      xInLight.y - originInLight.y,
      yInLight.y - originInLight.y,
    ]);
    group.uniforms[`uLightTranslation${index}`] = new Float32Array([originInLight.x, originInLight.y]);
    group.uniforms[`uLightPosition${index}`] = new Float32Array([lightOffsetInItem.x, lightOffsetInItem.y]);
    group.uniforms[`uLightTextureSize${index}`] = new Float32Array([texture.width, texture.height]);
    group.uniforms[`uLightColor${index}`] = new Float32Array([light.color.r, light.color.g, light.color.b, light.color.a]);
    group.uniforms[`uShadowColor${index}`] = new Float32Array([light.shadowColor.r, light.shadowColor.g, light.shadowColor.b, light.shadowColor.a]);
    const kernel = light.shadowFilter === 0 ? 1 : light.major === 3
      ? [1, 3, 5, 7, 9, 13][light.shadowFilter] ?? 1
      : light.shadowFilter === 1 ? 5 : 13;
    group.uniforms[`uShadowSettings${index}`] = new Float32Array([
      kernel,
      Math.max(light.shadowSmooth, light.shadowGradientLength),
      2048 / Math.max(1, light.shadowBufferSize),
      0,
    ]);
    group.uniforms[`uLightParams${index}`] = new Float32Array([light.energy, light.textureScale, light.height, light.maxDistance]);
    group.uniforms[`uLightBlend${index}`] = light.blendMode;
    shadows.forEach(({ occluder, edge }, shadowIndex) => {
      const polygon = occluder.polygon;
      if (polygon === null) return;
      const points = polygon.polygon;
      const first = points[edge];
      const second = points[(edge + 1) % points.length];
      if (first === undefined || second === undefined) return;
      const firstGlobal = occluder.node.toGlobal(new Point(first.x, first.y));
      const secondGlobal = occluder.node.toGlobal(new Point(second.x, second.y));
      const a = item.item.toLocal(firstGlobal, undefined, new Point());
      const b = item.item.toLocal(secondGlobal, undefined, new Point());
      group.uniforms[`uShadowEdge${index}_${shadowIndex}`] = new Float32Array([a.x, a.y, b.x, b.y]);
      group.uniforms[`uShadowCull${index}_${shadowIndex}`] = polygon.cull_mode;
    });
  });
}

function fitSinglePass(
  root: Container,
  passes: readonly LightPass[],
  maxFragmentUniformVectors: number,
): LightPass[] {
  const result: LightPass[] = [];
  let vectors = 2;
  for (const pass of passes) {
    const required = 8 + pass.shadows.length * 2;
    if (vectors + 8 > maxFragmentUniformVectors) break;
    if (vectors + required > maxFragmentUniformVectors) {
      result.push({ light: pass.light, shadows: [] });
      vectors += 8;
    } else {
      result.push(pass);
      vectors += required;
    }
  }
  const complete = result.length === passes.length && result.every((pass, index) => pass.shadows.length === passes[index]?.shadows.length);
  if (!complete && !WARNED_DEVICE_LIMIT.has(root)) {
    WARNED_DEVICE_LIMIT.add(root);
    console.error(
      `Godot 2D lighting exceeds this WebGL device's ${maxFragmentUniformVectors} fragment-uniform vectors; ` +
      'the single-pass renderer omits only the excess lights/shadow edges instead of introducing incorrect multipass cross terms.',
    );
  }
  return result;
}

function topologySignature(passes: readonly LightPass[]): string {
  return passes.map(({ light, shadows }) => {
    const shadowShape = shadows.map(({ occluder, edge }) =>
      `${occluder.id}:${edge}:${occluder.polygon?.cull_mode ?? 0}`).join(',');
    return `${light.id}:${light.kind}:${textureId(light.texture)}:[${shadowShape}]`;
  }).join('|');
}

function updateItemLighting(
  state: ItemState,
  root: RootState,
  lights: readonly LightState[],
  maxFragmentUniformVectors: number,
): void {
  const lightMode = itemLightMode(state.item);
  if (lightMode === CANVAS_ITEM_LIGHT_MODE.UNSHADED) {
    removeInstalled(state);
    return;
  }
  const requested = lights.map((light) => ({ light, shadows: shadowSegments(root, light) }));
  const passes = fitSinglePass(state.root, requested, maxFragmentUniformVectors);
  const signature = passes.length === 0 && lightMode === CANVAS_ITEM_LIGHT_MODE.LIGHT_ONLY
    ? 'light-only'
    : topologySignature(passes);
  if (signature !== state.signature) {
    removeInstalled(state);
    state.signature = signature;
    if (passes.length === 0 && lightMode === CANVAS_ITEM_LIGHT_MODE.LIGHT_ONLY) buildFilter(state, []);
    else if (passes.length > 0) buildFilter(state, passes);
  }
  for (const installed of state.installed) updateFilter(state, installed.passes, installed.group);
}

function defaultEnvelope(light: LightState): boolean {
  return light.itemMask === 1 && light.zMin === -1024 && light.zMax === 1024 &&
    light.layerMin === -512 && light.layerMax === 512;
}

function aggregateState(root: Container, binding: RootState): ItemState {
  if (binding.aggregate !== null) return binding.aggregate;
  binding.aggregate = { root, item: root, lightMask: 1, layer: 0, installed: [], signature: '' };
  return binding.aggregate;
}

function hasRegisteredDescendant(state: ItemState): boolean {
  const stack = [...state.item.children];
  while (stack.length > 0) {
    const child = stack.pop();
    if (!(child instanceof Container)) continue;
    if (ITEMS.has(child)) return true;
    stack.push(...child.children);
  }
  return false;
}

function hasNativeRenderBoundary(node: Container): boolean {
  if ((node as Container & { renderPipeId?: unknown }).renderPipeId !== undefined) return true;
  for (const child of node.children) {
    if (!(child instanceof Container) || ITEMS.has(child)) continue;
    if (hasNativeRenderBoundary(child)) return true;
  }
  return false;
}

function disjointFilterBoundary(state: ItemState): boolean {
  return !hasRegisteredDescendant(state) && hasNativeRenderBoundary(state.item);
}

/** Refresh native filters immediately before Pixi renders the retained canvas. */
export function updateCanvasLighting(root: Container, maxFragmentUniformVectors = 224): void {
  if (!Number.isSafeInteger(maxFragmentUniformVectors) || maxFragmentUniformVectors < 32) {
    throw new RangeError('Canvas lighting requires the WebGL MAX_FRAGMENT_UNIFORM_VECTORS device limit.');
  }
  const rootBinding = ROOTS.get(root);
  if (rootBinding === undefined) return;
  const allLights = [...rootBinding.lights]
    .map((light) => LIGHTS.get(light))
    .filter((light): light is LightState => light !== undefined && light.enabled && !light.editorOnly && visibleInRetainedTree(light.node) &&
      (light.kind !== 'point' || light.texture !== null));
  const itemStates = [...rootBinding.items]
    .map((item) => ITEMS.get(item))
    .filter((state): state is ItemState => state !== undefined);
  for (const state of itemStates) state.layer = effectiveCanvasLayer(state.item, root);
  const canAggregate = itemStates.every((state) => state.lightMask === 1 && state.layer === 0) &&
    itemStates.every((state) => itemLightMode(state.item) === CANVAS_ITEM_LIGHT_MODE.NORMAL) &&
    allLights.every(defaultEnvelope);
  if (canAggregate) {
    for (const state of itemStates) removeInstalled(state);
    updateItemLighting(aggregateState(root, rootBinding), rootBinding, allLights, maxFragmentUniformVectors);
    return;
  }
  if (rootBinding.aggregate !== null) removeInstalled(rootBinding.aggregate);
  for (const state of itemStates) {
    if (!disjointFilterBoundary(state)) {
      removeInstalled(state);
      continue;
    }
    const lights = allLights.filter((light) => lightEligible(state, light));
    updateItemLighting(state, rootBinding, lights, maxFragmentUniformVectors);
  }
}

export interface GodotOccluderPolygon2D {
  readonly __godotClass: 'OccluderPolygon2D';
  polygon: PackedVector2Array;
  closed: boolean;
  cull_mode: number;
  set_polygon(value: PackedVector2Array): void;
  get_polygon(): PackedVector2Array;
  set_closed(value: boolean): void;
  is_closed(): boolean;
  set_cull_mode(value: number): void;
  get_cull_mode(): number;
}

function notifyOccluderPolygon2D(resource: GodotOccluderPolygon2D): void {
  for (const observer of OCCLUDER_POLYGON_OBSERVERS.get(resource) ?? []) observer();
}

function observeOccluderPolygon2D(resource: GodotOccluderPolygon2D, observer: () => void): () => void {
  let observers = OCCLUDER_POLYGON_OBSERVERS.get(resource);
  if (observers === undefined) {
    observers = new Set();
    OCCLUDER_POLYGON_OBSERVERS.set(resource, observers);
  }
  observers.add(observer);
  return () => {
    const retained = OCCLUDER_POLYGON_OBSERVERS.get(resource);
    if (retained === undefined) return;
    retained.delete(observer);
    if (retained.size === 0) OCCLUDER_POLYGON_OBSERVERS.delete(resource);
  };
}

export function createOccluderPolygon2D(): GodotOccluderPolygon2D {
  let polygon = packedVector2Array();
  let closed = true;
  let cullMode = 0;
  const resource = {} as GodotOccluderPolygon2D;
  Object.defineProperty(resource, '__godotClass', { enumerable: true, value: 'OccluderPolygon2D' });
  property(resource, 'polygon', () => packedVector2Array(polygon), (value) => {
    if (!Array.isArray(value)) throw new TypeError('OccluderPolygon2D.polygon requires PackedVector2Array.');
    polygon = packedVector2Array(value);
    notifyOccluderPolygon2D(resource);
    godotResourceEmitChanged(resource);
  });
  property(resource, 'closed', () => closed, (value) => {
    const next = boolean(value, 'OccluderPolygon2D.closed');
    if (next === closed) return;
    closed = next;
    notifyOccluderPolygon2D(resource);
    godotResourceEmitChanged(resource);
  });
  property(resource, 'cull_mode', () => cullMode, (value) => {
    cullMode = enumValue(value, 'OccluderPolygon2D.cull_mode', 0, 2);
    // Godot updates RenderingServer culling without emitting Resource.changed.
    notifyOccluderPolygon2D(resource);
  });
  Object.assign(resource, {
    set_polygon: (value: PackedVector2Array) => { resource.polygon = value; }, get_polygon: () => resource.polygon,
    set_closed: (value: boolean) => { resource.closed = value; }, is_closed: () => resource.closed,
    set_cull_mode: (value: number) => { resource.cull_mode = value; }, get_cull_mode: () => resource.cull_mode,
  });
  registerGodotObjectIdentity(resource, 'OccluderPolygon2D');
  bindGodotResourceProtocol(resource, {
    createDuplicate(source) {
      const copy = createOccluderPolygon2D();
      copy.polygon = source.polygon;
      copy.closed = source.closed;
      copy.cull_mode = source.cull_mode;
      return copy;
    },
  });
  OCCLUDER_POLYGONS.add(resource);
  return resource;
}

export const createGodotOccluderPolygon2D = createOccluderPolygon2D;

export interface CanvasLightOccluder2DApi {
  occluder: GodotOccluderPolygon2D | null;
  sdf_collision: boolean;
  occluder_light_mask: number;
  light_mask: number;
  set_occluder_polygon(value: GodotOccluderPolygon2D | null): void;
  get_occluder_polygon(): GodotOccluderPolygon2D | null;
  set_as_sdf_collision(value: boolean): void;
  is_set_as_sdf_collision(): boolean;
  set_occluder_light_mask(value: number): void;
  get_occluder_light_mask(): number;
}
export type GodotCanvasLightOccluder2D = Container & CanvasLightOccluder2DApi;

export function bindCanvasLightOccluder2D(
  node: Container,
  root: Container,
  initial: { readonly occluder?: GodotOccluderPolygon2D | null; readonly sdfCollision?: boolean; readonly lightMask?: number },
): GodotCanvasLightOccluder2D {
  releaseCanvasLightOccluder2D(node as GodotCanvasLightOccluder2D);
  const occluder = node as GodotCanvasLightOccluder2D;
  if (initial.occluder !== undefined && initial.occluder !== null && !OCCLUDER_POLYGONS.has(initial.occluder)) {
    throw new TypeError('LightOccluder2D.occluder requires OccluderPolygon2D or null.');
  }
  const state: OccluderState = {
    id: nextBindingId++,
    root,
    node: occluder,
    polygon: initial.occluder ?? null,
    sdf: initial.sdfCollision ?? true,
    lightMask: mask(initial.lightMask ?? 1, 'LightOccluder2D.occluder_light_mask'),
    revision: 0,
    releasePolygonObserver: null,
  };
  const touch = (): void => { state.revision += 1; rootState(root).revision += 1; };
  if (state.polygon !== null) state.releasePolygonObserver = observeOccluderPolygon2D(state.polygon, touch);
  OCCLUDERS.set(occluder, state);
  rootState(root).occluders.add(occluder);
  property(occluder, 'occluder', () => state.polygon, (value) => {
    if (value !== null && !OCCLUDER_POLYGONS.has(value)) {
      throw new TypeError('LightOccluder2D.occluder requires OccluderPolygon2D or null.');
    }
    state.releasePolygonObserver?.();
    state.polygon = value;
    state.releasePolygonObserver = value === null ? null : observeOccluderPolygon2D(value, touch);
    touch();
  });
  // Canvas SDF is observable only to CanvasItem shaders. Those shader inputs are
  // admitted/refused at their own material boundary; ordinary occlusion retains it.
  property(occluder, 'sdf_collision', () => state.sdf, (value) => { state.sdf = boolean(value, 'LightOccluder2D.sdf_collision'); touch(); });
  property(occluder, 'occluder_light_mask', () => state.lightMask, (value) => { state.lightMask = mask(value, 'LightOccluder2D.occluder_light_mask'); touch(); });
  property(occluder, 'light_mask', () => state.lightMask, (value) => { state.lightMask = mask(value, 'LightOccluder2D.light_mask'); touch(); });
  Object.assign(occluder, {
    set_occluder_polygon: (value: GodotOccluderPolygon2D | null) => { occluder.occluder = value; }, get_occluder_polygon: () => occluder.occluder,
    set_as_sdf_collision: (value: boolean) => { occluder.sdf_collision = value; }, is_set_as_sdf_collision: () => occluder.sdf_collision,
    set_occluder_light_mask: (value: number) => { occluder.occluder_light_mask = value; }, get_occluder_light_mask: () => occluder.occluder_light_mask,
  });
  return occluder;
}

export function releaseCanvasLightOccluder2D(occluder: GodotCanvasLightOccluder2D): void {
  const state = OCCLUDERS.get(occluder);
  if (state === undefined) return;
  state.releasePolygonObserver?.();
  state.releasePolygonObserver = null;
  OCCLUDERS.delete(occluder);
  const root = rootState(state.root);
  root.occluders.delete(occluder);
  root.revision += 1;
}

export function createGodotLightOccluder2D(
  root: Container,
  initial: {
    readonly occluder?: GodotOccluderPolygon2D | null;
    readonly sdfCollision?: boolean;
    readonly lightMask?: number;
  } = {},
): GodotCanvasLightOccluder2D {
  const node = bindCanvasLightOccluder2D(bindGodotCanvasNode2DApi(new Container()), root, initial);
  registerGodotObjectIdentity(node, 'LightOccluder2D');
  registerCanvasNodeRelease(node, () => releaseCanvasLightOccluder2D(node));
  return node;
}
