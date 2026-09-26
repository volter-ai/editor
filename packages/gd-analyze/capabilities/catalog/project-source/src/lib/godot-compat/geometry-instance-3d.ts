import { Box3, Object3D, Vector3 } from 'three';
import { aabb, copyAabb, type GodotAabb } from './aabb';
import { registerGodotObjectIdentity } from './object';

export const GodotGeometryInstanceGIMode = {
  DISABLED: 0,
  STATIC: 1,
  DYNAMIC: 2,
} as const;

export const GodotGeometryInstanceLightmapScale = {
  SCALE_1X: 0,
  SCALE_2X: 1,
  SCALE_4X: 2,
  SCALE_8X: 3,
  MAX: 4,
} as const;

export const GodotGeometryInstanceVisibilityRangeFadeMode = {
  DISABLED: 0,
  SELF: 1,
  DEPENDENCIES: 2,
} as const;

export type GodotGeometryInstanceGIModeValue = typeof GodotGeometryInstanceGIMode[keyof typeof GodotGeometryInstanceGIMode];
export type GodotGeometryInstanceLightmapScaleValue = typeof GodotGeometryInstanceLightmapScale[keyof typeof GodotGeometryInstanceLightmapScale];
export type GodotGeometryInstanceVisibilityRangeFadeModeValue = typeof GodotGeometryInstanceVisibilityRangeFadeMode[keyof typeof GodotGeometryInstanceVisibilityRangeFadeMode];

interface GodotVisualInstanceState {
  layerMask: number;
  sortingOffset: number;
  sortingUseAabbCenter: boolean;
}

interface GodotGeometryInstanceState extends GodotVisualInstanceState {
  customAabb: GodotAabb;
  extraCullMargin: number;
  lodBias: number;
  transparency: number;
  ignoreOcclusionCulling: boolean;
  giMode: GodotGeometryInstanceGIModeValue;
  lightmapScale: GodotGeometryInstanceLightmapScaleValue;
  visibilityRangeBegin: number;
  visibilityRangeBeginMargin: number;
  visibilityRangeEnd: number;
  visibilityRangeEndMargin: number;
  visibilityRangeFadeMode: GodotGeometryInstanceVisibilityRangeFadeModeValue;
}

const visualStates = new WeakMap<Object3D, GodotVisualInstanceState>();
const geometryStates = new WeakMap<Object3D, GodotGeometryInstanceState>();

function newVisualState(): GodotVisualInstanceState {
  return { layerMask: 1, sortingOffset: 0, sortingUseAabbCenter: true };
}

function newGeometryState(): GodotGeometryInstanceState {
  return {
    ...newVisualState(),
    customAabb: aabb(),
    extraCullMargin: 0,
    lodBias: 1,
    transparency: 0,
    ignoreOcclusionCulling: false,
    giMode: GodotGeometryInstanceGIMode.STATIC,
    lightmapScale: GodotGeometryInstanceLightmapScale.SCALE_1X,
    visibilityRangeBegin: 0,
    visibilityRangeBeginMargin: 0,
    visibilityRangeEnd: 0,
    visibilityRangeEndMargin: 0,
    visibilityRangeFadeMode: GodotGeometryInstanceVisibilityRangeFadeMode.DISABLED,
  };
}

function visualState(node: Object3D): GodotVisualInstanceState {
  const geometry = geometryStates.get(node);
  if (geometry !== undefined) return geometry;
  let state = visualStates.get(node);
  if (state === undefined) {
    state = newVisualState();
    visualStates.set(node, state);
  }
  return state;
}

function geometryState(node: Object3D): GodotGeometryInstanceState {
  let state = geometryStates.get(node);
  if (state === undefined) {
    const visual = visualStates.get(node) ?? newVisualState();
    state = { ...newGeometryState(), ...visual };
    geometryStates.set(node, state);
    visualStates.delete(node);
  }
  return state;
}

function finite(member: string, value: number, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function unsignedMask(member: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${member} requires an unsigned 32-bit layer mask.`);
  }
  return value >>> 0;
}

function setObjectLayers(node: Object3D, mask: number): void {
  node.layers.mask = mask >>> 0;
  node.traverse((child) => { child.layers.mask = mask >>> 0; });
}

export function bindGodotVisualInstance3D<T extends Object3D>(node: T): T {
  registerGodotObjectIdentity(node, 'VisualInstance3D');
  visualState(node);
  return node;
}

export function bindGodotGeometryInstance3D<T extends Object3D>(node: T): T {
  registerGodotObjectIdentity(node, 'GeometryInstance3D');
  geometryState(node);
  return node;
}

export function createGodotVisualInstance3D(): Object3D {
  return bindGodotVisualInstance3D(new Object3D());
}

export function createGodotGeometryInstance3D(): Object3D {
  return bindGodotGeometryInstance3D(new Object3D());
}

export function setGodotVisualLayerMask(node: Object3D, value: number): void {
  const mask = unsignedMask('VisualInstance3D.layers', value);
  visualState(node).layerMask = mask;
  setObjectLayers(node, mask);
}

export function getGodotVisualLayerMask(node: Object3D): number {
  return visualState(node).layerMask;
}

export function setGodotVisualLayerValue(node: Object3D, layerNumber: number, enabled: boolean): void {
  if (!Number.isInteger(layerNumber) || layerNumber < 1 || layerNumber > 32) {
    throw new RangeError('VisualInstance3D layer number must be in [1, 32].');
  }
  const bit = 2 ** (layerNumber - 1);
  const oldMask = visualState(node).layerMask;
  const changed = enabled ? (oldMask | bit) >>> 0 : (oldMask & ~bit) >>> 0;
  setGodotVisualLayerMask(node, changed);
}

export function getGodotVisualLayerValue(node: Object3D, layerNumber: number): boolean {
  if (!Number.isInteger(layerNumber) || layerNumber < 1 || layerNumber > 32) {
    throw new RangeError('VisualInstance3D layer number must be in [1, 32].');
  }
  const bit = 2 ** (layerNumber - 1);
  return (visualState(node).layerMask & bit) !== 0;
}

export function setGodotVisualSortingOffset(node: Object3D, value: number): void {
  const offset = finite('VisualInstance3D.sorting_offset', value);
  visualState(node).sortingOffset = offset;
  node.traverse((child) => { child.renderOrder = offset; });
}

export function getGodotVisualSortingOffset(node: Object3D): number {
  return visualState(node).sortingOffset;
}

export function setGodotVisualSortingUseAabbCenter(node: Object3D, value: boolean): void {
  visualState(node).sortingUseAabbCenter = value;
}

export function isGodotVisualSortingUsingAabbCenter(node: Object3D): boolean {
  return visualState(node).sortingUseAabbCenter;
}

export function getGodotVisualAabb(node: Object3D): GodotAabb {
  node.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(node);
  if (bounds.isEmpty()) return aabb();
  const size = bounds.getSize(new Vector3());
  return aabb(bounds.min, size);
}

export function getGodotVisualTransformedAabb(node: Object3D): GodotAabb {
  return getGodotVisualAabb(node);
}

export function setGodotGeometryCustomAabb(node: Object3D, value: GodotAabb): void {
  geometryState(node).customAabb = copyAabb(value);
}

export function getGodotGeometryCustomAabb(node: Object3D): GodotAabb {
  return copyAabb(geometryState(node).customAabb);
}

export function setGodotGeometryExtraCullMargin(node: Object3D, value: number): void {
  geometryState(node).extraCullMargin = finite('GeometryInstance3D.extra_cull_margin', value, 0);
}

export function getGodotGeometryExtraCullMargin(node: Object3D): number {
  return geometryState(node).extraCullMargin;
}

export function setGodotGeometryLodBias(node: Object3D, value: number): void {
  geometryState(node).lodBias = finite('GeometryInstance3D.lod_bias', value, 0.001);
}

export function getGodotGeometryLodBias(node: Object3D): number {
  return geometryState(node).lodBias;
}

export function setGodotGeometryTransparency(node: Object3D, value: number): void {
  geometryState(node).transparency = finite('GeometryInstance3D.transparency', value, 0, 1);
}

export function getGodotGeometryTransparency(node: Object3D): number {
  return geometryState(node).transparency;
}

export function setGodotGeometryIgnoreOcclusionCulling(node: Object3D, value: boolean): void {
  geometryState(node).ignoreOcclusionCulling = value;
}

export function isGodotGeometryIgnoringOcclusionCulling(node: Object3D): boolean {
  return geometryState(node).ignoreOcclusionCulling;
}

export function setGodotGeometryGIMode(node: Object3D, value: number): void {
  if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('GeometryInstance3D.gi_mode requires 0, 1, or 2.');
  geometryState(node).giMode = value;
}

export function getGodotGeometryGIMode(node: Object3D): GodotGeometryInstanceGIModeValue {
  return geometryState(node).giMode;
}

export function setGodotGeometryLightmapScale(node: Object3D, value: number): void {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    throw new RangeError('GeometryInstance3D.lightmap_scale requires a valid scale enum.');
  }
  geometryState(node).lightmapScale = value;
}

export function getGodotGeometryLightmapScale(node: Object3D): GodotGeometryInstanceLightmapScaleValue {
  return geometryState(node).lightmapScale;
}

export function setGodotGeometryVisibilityRangeBegin(node: Object3D, value: number): void {
  geometryState(node).visibilityRangeBegin = finite('GeometryInstance3D.visibility_range_begin', value, 0);
}

export function getGodotGeometryVisibilityRangeBegin(node: Object3D): number {
  return geometryState(node).visibilityRangeBegin;
}

export function setGodotGeometryVisibilityRangeBeginMargin(node: Object3D, value: number): void {
  geometryState(node).visibilityRangeBeginMargin = finite('GeometryInstance3D.visibility_range_begin_margin', value, 0);
}

export function getGodotGeometryVisibilityRangeBeginMargin(node: Object3D): number {
  return geometryState(node).visibilityRangeBeginMargin;
}

export function setGodotGeometryVisibilityRangeEnd(node: Object3D, value: number): void {
  geometryState(node).visibilityRangeEnd = finite('GeometryInstance3D.visibility_range_end', value, 0);
}

export function getGodotGeometryVisibilityRangeEnd(node: Object3D): number {
  return geometryState(node).visibilityRangeEnd;
}

export function setGodotGeometryVisibilityRangeEndMargin(node: Object3D, value: number): void {
  geometryState(node).visibilityRangeEndMargin = finite('GeometryInstance3D.visibility_range_end_margin', value, 0);
}

export function getGodotGeometryVisibilityRangeEndMargin(node: Object3D): number {
  return geometryState(node).visibilityRangeEndMargin;
}

export function setGodotGeometryVisibilityRangeFadeMode(node: Object3D, value: number): void {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new RangeError('GeometryInstance3D.visibility_range_fade_mode requires 0, 1, or 2.');
  }
  geometryState(node).visibilityRangeFadeMode = value;
}

export function getGodotGeometryVisibilityRangeFadeMode(node: Object3D): GodotGeometryInstanceVisibilityRangeFadeModeValue {
  return geometryState(node).visibilityRangeFadeMode;
}

export function isGodotGeometryVisibleAtDistance(node: Object3D, distance: number): boolean {
  const state = geometryState(node);
  const begin = Math.max(0, state.visibilityRangeBegin - state.visibilityRangeBeginMargin);
  const end = state.visibilityRangeEnd === 0
    ? Infinity
    : state.visibilityRangeEnd + state.visibilityRangeEndMargin;
  return distance >= begin && distance <= end;
}
