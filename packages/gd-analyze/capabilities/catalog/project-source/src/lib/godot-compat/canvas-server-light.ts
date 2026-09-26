/** Retained low-level RenderingServer CanvasLight and occluder RID protocol. */

import { Container, Matrix, Texture } from 'pixi.js';
import type { GodotRid } from './gdscript-builtins';
import { godotResourceGetRid, godotResourceOfRid } from './resource-io';
import type { ColorValue } from './variant';
import type { Vector2 } from './vector2';

export interface GodotServerCanvasLightState {
  canvas: Container | null;
  enabled: boolean;
  texture: Texture | null;
  textureOffset: Vector2;
  textureScale: number;
  interpolated: boolean;
  color: ColorValue;
  height: number;
  energy: number;
  mode: number;
  blendMode: number;
  zMin: number;
  zMax: number;
  layerMin: number;
  layerMax: number;
  itemCullMask: number;
  itemShadowCullMask: number;
  directionalDistance: number;
  shadowEnabled: boolean;
  shadowFilter: number;
  shadowColor: ColorValue;
  shadowSmooth: number;
  shadowBufferSize: number;
  shadowGradientLength: number;
}

export interface GodotServerCanvasOccluderState {
  canvas: Container | null;
  enabled: boolean;
  polygon: GodotServerCanvasOccluderPolygonState | null;
  lightMask: number;
  asSdfCollision: boolean;
  interpolated: boolean;
}

export interface GodotServerCanvasOccluderPolygonState {
  points: Vector2[];
  closed: boolean;
  cullMode: number;
}

const LIGHTS = new WeakMap<Container, GodotServerCanvasLightState>();
const OCCLUDERS = new WeakMap<Container, GodotServerCanvasOccluderState>();
const POLYGONS = new WeakMap<object, GodotServerCanvasOccluderPolygonState>();

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`RenderingServer.${member} requires finite number.`);
  return value;
}

function nonnegative(value: unknown, member: string): number {
  const parsed = finite(value, member);
  if (parsed < 0) throw new RangeError(`RenderingServer.${member} requires non-negative number.`);
  return parsed;
}

function integer(value: unknown, member: string, minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`RenderingServer.${member} requires integer ${minimum}..${maximum}.`);
  return value;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`RenderingServer.${member} requires bool.`);
  return value;
}

function point(value: unknown, member: string): Vector2 {
  if (typeof value !== 'object' || value === null) throw new TypeError(`RenderingServer.${member} requires Vector2.`);
  return { x: finite(Reflect.get(value, 'x'), `${member}.x`), y: finite(Reflect.get(value, 'y'), `${member}.y`) };
}

function color(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) throw new TypeError(`RenderingServer.${member} requires Color.`);
  return { r: finite(Reflect.get(value, 'r'), `${member}.r`), g: finite(Reflect.get(value, 'g'), `${member}.g`), b: finite(Reflect.get(value, 'b'), `${member}.b`), a: finite(Reflect.get(value, 'a'), `${member}.a`) };
}

function transform(value: unknown, member: string): Matrix {
  if (Array.isArray(value) && value.length === 6 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return new Matrix(value[0], value[1], value[2], value[3], value[4], value[5]);
  }
  if (typeof value !== 'object' || value === null) throw new TypeError(`RenderingServer.${member} requires Transform2D.`);
  const x = Reflect.get(value, 'x');
  const y = Reflect.get(value, 'y');
  const origin = Reflect.get(value, 'origin');
  if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null || typeof origin !== 'object' || origin === null) {
    throw new TypeError(`RenderingServer.${member} requires Transform2D basis and origin.`);
  }
  return new Matrix(
    finite(Reflect.get(x, 'x'), `${member}.x.x`), finite(Reflect.get(x, 'y'), `${member}.x.y`),
    finite(Reflect.get(y, 'x'), `${member}.y.x`), finite(Reflect.get(y, 'y'), `${member}.y.y`),
    finite(Reflect.get(origin, 'x'), `${member}.origin.x`), finite(Reflect.get(origin, 'y'), `${member}.origin.y`),
  );
}

function pixiColor(value: ColorValue): number {
  const byte = (entry: number): number => Math.round(Math.max(0, Math.min(1, entry)) * 255);
  return byte(value.r) * 0x10000 + byte(value.g) * 0x100 + byte(value.b);
}

function resourceContainer(rid: GodotRid, member: string): Container {
  const retained = godotResourceOfRid(rid);
  if (!(retained instanceof Container)) throw new TypeError(`RenderingServer.${member} RID requires retained Canvas resource.`);
  return retained;
}

function light(rid: GodotRid, member: string): [Container, GodotServerCanvasLightState] {
  const owner = resourceContainer(rid, member);
  const state = LIGHTS.get(owner);
  if (state === undefined) throw new TypeError(`RenderingServer.${member} RID requires CanvasLight.`);
  return [owner, state];
}

function occluder(rid: GodotRid, member: string): [Container, GodotServerCanvasOccluderState] {
  const owner = resourceContainer(rid, member);
  const state = OCCLUDERS.get(owner);
  if (state === undefined) throw new TypeError(`RenderingServer.${member} RID requires CanvasLightOccluder.`);
  return [owner, state];
}

function polygon(rid: GodotRid, member: string): GodotServerCanvasOccluderPolygonState {
  const retained = godotResourceOfRid(rid);
  if (typeof retained !== 'object' || retained === null) throw new TypeError(`RenderingServer.${member} RID requires CanvasOccluderPolygon.`);
  const state = POLYGONS.get(retained);
  if (state === undefined) throw new TypeError(`RenderingServer.${member} RID requires CanvasOccluderPolygon.`);
  return state;
}

function attach(owner: Container, previous: Container | null, nextRid: GodotRid, member: string): Container | null {
  if (previous !== null && owner.parent === previous) owner.removeFromParent();
  if (nextRid.id === 0n) return null;
  const next = resourceContainer(nextRid, member);
  for (let ancestor: Container | null = next; ancestor !== null; ancestor = ancestor.parent) {
    if (ancestor === owner) throw new Error(`RenderingServer.${member} would create a canvas cycle.`);
  }
  next.addChild(owner);
  return next;
}

export function godotRenderingServerCanvasLightCreate(): GodotRid {
  const owner = new Container();
  LIGHTS.set(owner, { canvas: null, enabled: true, texture: null, textureOffset: { x: 0, y: 0 }, textureScale: 1, interpolated: false, color: { r: 1, g: 1, b: 1, a: 1 }, height: 0, energy: 1, mode: 0, blendMode: 0, zMin: -1024, zMax: 1024, layerMin: 0, layerMax: 0, itemCullMask: 1, itemShadowCullMask: 1, directionalDistance: 10000, shadowEnabled: false, shadowFilter: 0, shadowColor: { r: 0, g: 0, b: 0, a: 0 }, shadowSmooth: 0, shadowBufferSize: 2048, shadowGradientLength: 0 });
  return godotResourceGetRid(owner);
}

export function godotRenderingServerCanvasLightAttachToCanvas(lightRid: GodotRid, canvasRid: GodotRid): void {
  const [owner, state] = light(lightRid, 'canvas_light_attach_to_canvas');
  state.canvas = attach(owner, state.canvas, canvasRid, 'canvas_light_attach_to_canvas');
}

export function godotRenderingServerCanvasLightSetEnabled(lightRid: GodotRid, value: unknown): void {
  const [owner, state] = light(lightRid, 'canvas_light_set_enabled'); state.enabled = boolean(value, 'canvas_light_set_enabled'); owner.visible = state.enabled;
}

export function godotRenderingServerCanvasLightSetTransform(lightRid: GodotRid, value: unknown): void {
  light(lightRid, 'canvas_light_set_transform')[0].setFromMatrix(transform(value, 'canvas_light_set_transform'));
}

export function godotRenderingServerCanvasLightSetTexture(lightRid: GodotRid, textureRid: GodotRid): void {
  const [, state] = light(lightRid, 'canvas_light_set_texture');
  if (textureRid.id === 0n) { state.texture = null; return; }
  const retained = godotResourceOfRid(textureRid);
  if (!(retained instanceof Texture)) throw new TypeError('RenderingServer.canvas_light_set_texture RID requires Texture2D.');
  state.texture = retained;
}

export function godotRenderingServerCanvasLightSetTextureOffset(lightRid: GodotRid, value: unknown): void {
  const [owner, state] = light(lightRid, 'canvas_light_set_texture_offset'); state.textureOffset = point(value, 'canvas_light_set_texture_offset'); owner.pivot.set(-state.textureOffset.x, -state.textureOffset.y);
}

export function godotRenderingServerCanvasLightSetTextureScale(lightRid: GodotRid, value: unknown): void {
  const [owner, state] = light(lightRid, 'canvas_light_set_texture_scale');
  state.textureScale = finite(value, 'canvas_light_set_texture_scale');
  if (state.textureScale === 0) throw new RangeError('RenderingServer.canvas_light_set_texture_scale cannot be zero.');
  owner.scale.set(state.textureScale, state.textureScale);
}

export function godotRenderingServerCanvasLightSetInterpolated(lightRid: GodotRid, value: unknown): void {
  light(lightRid, 'canvas_light_set_interpolated')[1].interpolated = boolean(value, 'canvas_light_set_interpolated');
}

export function godotRenderingServerCanvasLightResetPhysicsInterpolation(lightRid: GodotRid): void {
  light(lightRid, 'canvas_light_reset_physics_interpolation');
}

export function godotRenderingServerCanvasLightTransformPhysicsInterpolation(lightRid: GodotRid, value: unknown): void {
  const [owner, state] = light(lightRid, 'canvas_light_transform_physics_interpolation');
  if (state.interpolated) owner.setFromMatrix(transform(value, 'canvas_light_transform_physics_interpolation'));
}

export function godotRenderingServerCanvasLightSetColor(lightRid: GodotRid, value: unknown): void {
  const [owner, state] = light(lightRid, 'canvas_light_set_color'); state.color = color(value, 'canvas_light_set_color'); owner.tint = pixiColor(state.color); owner.alpha = state.color.a;
}

export function godotRenderingServerCanvasLightSetHeight(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_height')[1].height = finite(value, 'canvas_light_set_height'); }
export function godotRenderingServerCanvasLightSetEnergy(lightRid: GodotRid, value: unknown): void { const [owner, state] = light(lightRid, 'canvas_light_set_energy'); state.energy = nonnegative(value, 'canvas_light_set_energy'); owner.alpha = Math.max(0, Math.min(1, state.color.a * state.energy)); }
export function godotRenderingServerCanvasLightSetMode(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_mode')[1].mode = integer(value, 'canvas_light_set_mode', 0, 1); }
export function godotRenderingServerCanvasLightSetBlendMode(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_blend_mode')[1].blendMode = integer(value, 'canvas_light_set_blend_mode', 0, 3); }

export function godotRenderingServerCanvasLightSetZRange(lightRid: GodotRid, minimum: unknown, maximum: unknown): void {
  const state = light(lightRid, 'canvas_light_set_z_range')[1]; state.zMin = integer(minimum, 'canvas_light_set_z_range.min'); state.zMax = integer(maximum, 'canvas_light_set_z_range.max');
  if (state.zMin > state.zMax) throw new RangeError('RenderingServer.canvas_light_set_z_range min cannot exceed max.');
}

export function godotRenderingServerCanvasLightSetLayerRange(lightRid: GodotRid, minimum: unknown, maximum: unknown): void {
  const state = light(lightRid, 'canvas_light_set_layer_range')[1]; state.layerMin = integer(minimum, 'canvas_light_set_layer_range.min'); state.layerMax = integer(maximum, 'canvas_light_set_layer_range.max');
  if (state.layerMin > state.layerMax) throw new RangeError('RenderingServer.canvas_light_set_layer_range min cannot exceed max.');
}

export function godotRenderingServerCanvasLightSetItemCullMask(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_item_cull_mask')[1].itemCullMask = integer(value, 'canvas_light_set_item_cull_mask', 0, 0xffffffff) >>> 0; }
export function godotRenderingServerCanvasLightSetItemShadowCullMask(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_item_shadow_cull_mask')[1].itemShadowCullMask = integer(value, 'canvas_light_set_item_shadow_cull_mask', 0, 0xffffffff) >>> 0; }
export function godotRenderingServerCanvasLightSetDirectionalDistance(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_directional_distance')[1].directionalDistance = nonnegative(value, 'canvas_light_set_directional_distance'); }
export function godotRenderingServerCanvasLightSetShadowEnabled(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_shadow_enabled')[1].shadowEnabled = boolean(value, 'canvas_light_set_shadow_enabled'); }
export function godotRenderingServerCanvasLightSetShadowFilter(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_shadow_filter')[1].shadowFilter = integer(value, 'canvas_light_set_shadow_filter', 0, 5); }
export function godotRenderingServerCanvasLightSetShadowColor(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_shadow_color')[1].shadowColor = color(value, 'canvas_light_set_shadow_color'); }
export function godotRenderingServerCanvasLightSetShadowSmooth(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_shadow_smooth')[1].shadowSmooth = nonnegative(value, 'canvas_light_set_shadow_smooth'); }
export function godotRenderingServerCanvasLightSetShadowBufferSize(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_shadow_buffer_size')[1].shadowBufferSize = integer(value, 'canvas_light_set_shadow_buffer_size', 1, 16384); }
export function godotRenderingServerCanvasLightSetShadowGradientLength(lightRid: GodotRid, value: unknown): void { light(lightRid, 'canvas_light_set_shadow_gradient_length')[1].shadowGradientLength = nonnegative(value, 'canvas_light_set_shadow_gradient_length'); }

export function godotRenderingServerCanvasLightOccluderCreate(): GodotRid {
  const owner = new Container(); OCCLUDERS.set(owner, { canvas: null, enabled: true, polygon: null, lightMask: 1, asSdfCollision: false, interpolated: false }); return godotResourceGetRid(owner);
}

export function godotRenderingServerCanvasLightOccluderAttachToCanvas(occluderRid: GodotRid, canvasRid: GodotRid): void { const [owner, state] = occluder(occluderRid, 'canvas_light_occluder_attach_to_canvas'); state.canvas = attach(owner, state.canvas, canvasRid, 'canvas_light_occluder_attach_to_canvas'); }
export function godotRenderingServerCanvasLightOccluderSetEnabled(occluderRid: GodotRid, value: unknown): void { const [owner, state] = occluder(occluderRid, 'canvas_light_occluder_set_enabled'); state.enabled = boolean(value, 'canvas_light_occluder_set_enabled'); owner.visible = state.enabled; }
export function godotRenderingServerCanvasLightOccluderSetTransform(occluderRid: GodotRid, value: unknown): void { occluder(occluderRid, 'canvas_light_occluder_set_transform')[0].setFromMatrix(transform(value, 'canvas_light_occluder_set_transform')); }
export function godotRenderingServerCanvasLightOccluderSetInterpolated(occluderRid: GodotRid, value: unknown): void { occluder(occluderRid, 'canvas_light_occluder_set_interpolated')[1].interpolated = boolean(value, 'canvas_light_occluder_set_interpolated'); }
export function godotRenderingServerCanvasLightOccluderResetPhysicsInterpolation(occluderRid: GodotRid): void { occluder(occluderRid, 'canvas_light_occluder_reset_physics_interpolation'); }
export function godotRenderingServerCanvasLightOccluderTransformPhysicsInterpolation(occluderRid: GodotRid, value: unknown): void { const [owner, state] = occluder(occluderRid, 'canvas_light_occluder_transform_physics_interpolation'); if (state.interpolated) owner.setFromMatrix(transform(value, 'canvas_light_occluder_transform_physics_interpolation')); }
export function godotRenderingServerCanvasLightOccluderSetPolygon(occluderRid: GodotRid, polygonRid: GodotRid): void { const state = occluder(occluderRid, 'canvas_light_occluder_set_polygon')[1]; state.polygon = polygonRid.id === 0n ? null : polygon(polygonRid, 'canvas_light_occluder_set_polygon'); }
export function godotRenderingServerCanvasLightOccluderSetAsSdfCollision(occluderRid: GodotRid, value: unknown): void { occluder(occluderRid, 'canvas_light_occluder_set_as_sdf_collision')[1].asSdfCollision = boolean(value, 'canvas_light_occluder_set_as_sdf_collision'); }
export function godotRenderingServerCanvasLightOccluderSetLightMask(occluderRid: GodotRid, value: unknown): void { occluder(occluderRid, 'canvas_light_occluder_set_light_mask')[1].lightMask = integer(value, 'canvas_light_occluder_set_light_mask', 0, 0xffffffff) >>> 0; }

export function godotRenderingServerCanvasOccluderPolygonCreate(): GodotRid { const retained = {}; POLYGONS.set(retained, { points: [], closed: true, cullMode: 0 }); return godotResourceGetRid(retained); }
export function godotRenderingServerCanvasOccluderPolygonSetShape(polygonRid: GodotRid, shape: unknown, closedValue = true): void {
  if (!Array.isArray(shape)) throw new TypeError('RenderingServer.canvas_occluder_polygon_set_shape requires PackedVector2Array.');
  const state = polygon(polygonRid, 'canvas_occluder_polygon_set_shape'); state.points = shape.map((entry, index) => point(entry, `canvas_occluder_polygon_set_shape[${index}]`)); state.closed = boolean(closedValue, 'canvas_occluder_polygon_set_shape.closed');
}
export function godotRenderingServerCanvasOccluderPolygonSetCullMode(polygonRid: GodotRid, value: unknown): void { polygon(polygonRid, 'canvas_occluder_polygon_set_cull_mode').cullMode = integer(value, 'canvas_occluder_polygon_set_cull_mode', 0, 2); }
