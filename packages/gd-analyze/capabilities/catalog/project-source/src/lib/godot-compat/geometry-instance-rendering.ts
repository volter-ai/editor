import { Vector3, type Camera, type Material, type Object3D } from 'three';

export const GODOT_GEOMETRY_INSTANCE_SHADOW_CASTING_SETTING = {
  OFF: 0,
  ON: 1,
  DOUBLE_SIDED: 2,
  SHADOWS_ONLY: 3,
  SHADOW_CASTING_SETTING_OFF: 0,
  SHADOW_CASTING_SETTING_ON: 1,
  SHADOW_CASTING_SETTING_DOUBLE_SIDED: 2,
  SHADOW_CASTING_SETTING_SHADOWS_ONLY: 3,
} as const;

export const GODOT_GEOMETRY_INSTANCE_GI_MODE = {
  DISABLED: 0,
  STATIC: 1,
  DYNAMIC: 2,
  GI_MODE_DISABLED: 0,
  GI_MODE_STATIC: 1,
  GI_MODE_DYNAMIC: 2,
} as const;

export const GODOT_GEOMETRY_INSTANCE_VISIBILITY_RANGE_FADE_MODE = {
  DISABLED: 0,
  SELF: 1,
  DEPENDENCIES: 2,
  VISIBILITY_RANGE_FADE_DISABLED: 0,
  VISIBILITY_RANGE_FADE_SELF: 1,
  VISIBILITY_RANGE_FADE_DEPENDENCIES: 2,
} as const;

export const GODOT_GEOMETRY_INSTANCE_LIGHTMAP_SCALE = {
  SCALE_1X: 0,
  SCALE_2X: 1,
  SCALE_4X: 2,
  SCALE_8X: 3,
  MAX: 4,
  LIGHTMAP_SCALE_1X: 0,
  LIGHTMAP_SCALE_2X: 1,
  LIGHTMAP_SCALE_4X: 2,
  LIGHTMAP_SCALE_8X: 3,
  LIGHTMAP_SCALE_MAX: 4,
} as const;

export interface GodotGeometryInstanceRenderingSnapshot {
  readonly materialOverlay: Material | null;
  readonly transparency: number;
  readonly castShadow: number;
  readonly extraCullMargin: number;
  readonly lodBias: number;
  readonly ignoreOcclusionCulling: boolean;
  readonly giMode: number;
  readonly lightmapScale: number;
  readonly visibilityRangeBegin: number;
  readonly visibilityRangeBeginMargin: number;
  readonly visibilityRangeEnd: number;
  readonly visibilityRangeEndMargin: number;
  readonly visibilityRangeFadeMode: number;
}

interface MaterialOpacityState { opacity: number; transparent: boolean; visible: boolean }
interface GeometryState {
  materialOverlay: Material | null;
  transparency: number;
  castShadow: number;
  extraCullMargin: number;
  lodBias: number;
  ignoreOcclusionCulling: boolean;
  giMode: number;
  lightmapScale: number;
  visibilityRangeBegin: number;
  visibilityRangeBeginMargin: number;
  visibilityRangeEnd: number;
  visibilityRangeEndMargin: number;
  visibilityRangeFadeMode: number;
  sourceVisible: boolean;
  materialState: Map<Material, MaterialOpacityState>;
  listeners: Set<(snapshot: GodotGeometryInstanceRenderingSnapshot) => void>;
}

const STATES = new WeakMap<Object3D, GeometryState>();
const _position = new Vector3();
const _cameraPosition = new Vector3();

function stateOf(instance: Object3D): GeometryState {
  let state = STATES.get(instance);
  if (state !== undefined) return state;
  state = {
    materialOverlay: null,
    transparency: 0,
    castShadow: 1,
    extraCullMargin: 0,
    lodBias: 1,
    ignoreOcclusionCulling: false,
    giMode: 1,
    lightmapScale: 0,
    visibilityRangeBegin: 0,
    visibilityRangeBeginMargin: 0,
    visibilityRangeEnd: 0,
    visibilityRangeEndMargin: 0,
    visibilityRangeFadeMode: 0,
    sourceVisible: instance.visible,
    materialState: new Map(),
    listeners: new Set(),
  };
  STATES.set(instance, state);
  return state;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`godot-compat: GeometryInstance3D.${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function mode(value: unknown, member: string, maximum: number): number {
  const result = finite(value, member, 0, maximum);
  if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: GeometryInstance3D.${member} requires an integer.`);
  return result;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: GeometryInstance3D.${member} requires bool.`);
  return value;
}

function materialsOf(instance: Object3D): Material[] {
  const materials: Material[] = [];
  instance.traverse((object) => {
    const value = Reflect.get(object, 'material') as Material | Material[] | undefined;
    if (Array.isArray(value)) materials.push(...value);
    else if (value && typeof value === 'object') materials.push(value);
  });
  return materials;
}

function snapshot(state: GeometryState): GodotGeometryInstanceRenderingSnapshot {
  return Object.freeze({
    materialOverlay: state.materialOverlay,
    transparency: state.transparency,
    castShadow: state.castShadow,
    extraCullMargin: state.extraCullMargin,
    lodBias: state.lodBias,
    ignoreOcclusionCulling: state.ignoreOcclusionCulling,
    giMode: state.giMode,
    lightmapScale: state.lightmapScale,
    visibilityRangeBegin: state.visibilityRangeBegin,
    visibilityRangeBeginMargin: state.visibilityRangeBeginMargin,
    visibilityRangeEnd: state.visibilityRangeEnd,
    visibilityRangeEndMargin: state.visibilityRangeEndMargin,
    visibilityRangeFadeMode: state.visibilityRangeFadeMode,
  });
}

function publish(state: GeometryState): void {
  const value = snapshot(state);
  for (const listener of state.listeners) listener(value);
}

function applyTransparency(instance: Object3D, visibilityFactor = 1): void {
  const state = stateOf(instance);
  const opacity = Math.max(0, Math.min(1, (1 - state.transparency) * visibilityFactor));
  for (const material of materialsOf(instance)) {
    let original = state.materialState.get(material);
    if (original === undefined) {
      original = { opacity: material.opacity, transparent: material.transparent, visible: material.visible };
      state.materialState.set(material, original);
    }
    material.opacity = original.opacity * opacity;
    material.transparent = original.transparent || material.opacity < 1;
    material.visible = original.visible && opacity > 0;
    material.needsUpdate = true;
  }
  instance.visible = state.sourceVisible && opacity > 0;
}

export function bindGodotGeometryInstanceRendering(instance: Object3D): () => void {
  const state = stateOf(instance);
  applyTransparency(instance);
  return () => {
    for (const [material, original] of state.materialState) {
      material.opacity = original.opacity;
      material.transparent = original.transparent;
      material.visible = original.visible;
      material.needsUpdate = true;
    }
    state.materialState.clear();
    instance.visible = state.sourceVisible;
    STATES.delete(instance);
  };
}

export function watchGodotGeometryInstanceRendering(
  instance: Object3D,
  listener: (snapshot: GodotGeometryInstanceRenderingSnapshot) => void,
): () => void {
  const state = stateOf(instance);
  state.listeners.add(listener);
  listener(snapshot(state));
  return () => state.listeners.delete(listener);
}

export function getGodotGeometryInstanceRenderingSnapshot(instance: Object3D): GodotGeometryInstanceRenderingSnapshot {
  return snapshot(stateOf(instance));
}

export function updateGodotGeometryInstanceVisibility(instance: Object3D, camera: Camera | { x: number; y: number; z: number }): number {
  const state = stateOf(instance);
  instance.getWorldPosition(_position);
  if ('isCamera' in camera) camera.getWorldPosition(_cameraPosition);
  else _cameraPosition.set(camera.x, camera.y, camera.z);
  const distance = _position.distanceTo(_cameraPosition);
  let factor = 1;
  if (state.visibilityRangeBegin > 0 && distance < state.visibilityRangeBegin) {
    factor = state.visibilityRangeBeginMargin <= 0
      ? 0
      : Math.max(0, Math.min(1, (distance - state.visibilityRangeBegin + state.visibilityRangeBeginMargin) / state.visibilityRangeBeginMargin));
  }
  if (state.visibilityRangeEnd > 0 && distance > state.visibilityRangeEnd) {
    factor = state.visibilityRangeEndMargin <= 0
      ? 0
      : Math.min(factor, Math.max(0, 1 - (distance - state.visibilityRangeEnd) / state.visibilityRangeEndMargin));
  }
  applyTransparency(instance, state.visibilityRangeFadeMode === 0 ? (factor > 0 ? 1 : 0) : factor);
  return factor;
}

export function getGodotGeometryInstanceMaterialOverlay(instance: Object3D): Material | null { return stateOf(instance).materialOverlay; }
export function setGodotGeometryInstanceMaterialOverlay(instance: Object3D, value: Material | null): void {
  if (value !== null && (typeof value !== 'object' || !('isMaterial' in value))) throw new TypeError('GeometryInstance3D.material_overlay requires Material or null.');
  const state = stateOf(instance); state.materialOverlay = value; publish(state);
}
export function getGodotGeometryInstanceTransparency(instance: Object3D): number { return stateOf(instance).transparency; }
export function setGodotGeometryInstanceTransparency(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.transparency = finite(value, 'transparency', 0, 1); applyTransparency(instance); publish(state); }
export function getGodotGeometryInstanceCastShadow(instance: Object3D): number { return stateOf(instance).castShadow; }
export function setGodotGeometryInstanceCastShadow(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.castShadow = mode(value, 'cast_shadow', 3); instance.traverse((object) => { object.castShadow = state.castShadow !== 0; object.visible = state.castShadow !== 3 && state.sourceVisible; }); publish(state); }
export function getGodotGeometryInstanceExtraCullMargin(instance: Object3D): number { return stateOf(instance).extraCullMargin; }
export function setGodotGeometryInstanceExtraCullMargin(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.extraCullMargin = finite(value, 'extra_cull_margin', 0); instance.frustumCulled = state.extraCullMargin === 0; publish(state); }
export function getGodotGeometryInstanceLodBias(instance: Object3D): number { return stateOf(instance).lodBias; }
export function setGodotGeometryInstanceLodBias(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.lodBias = finite(value, 'lod_bias', 0); publish(state); }
export function isGodotGeometryInstanceIgnoringOcclusionCulling(instance: Object3D): boolean { return stateOf(instance).ignoreOcclusionCulling; }
export function setGodotGeometryInstanceIgnoreOcclusionCulling(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.ignoreOcclusionCulling = bool(value, 'ignore_occlusion_culling'); publish(state); }
export function getGodotGeometryInstanceGiMode(instance: Object3D): number { return stateOf(instance).giMode; }
export function setGodotGeometryInstanceGiMode(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.giMode = mode(value, 'gi_mode', 2); publish(state); }
export function getGodotGeometryInstanceLightmapScale(instance: Object3D): number { return stateOf(instance).lightmapScale; }
export function setGodotGeometryInstanceLightmapScale(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.lightmapScale = mode(value, 'lightmap_scale', 4); publish(state); }
export function getGodotGeometryInstanceVisibilityRangeBegin(instance: Object3D): number { return stateOf(instance).visibilityRangeBegin; }
export function setGodotGeometryInstanceVisibilityRangeBegin(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.visibilityRangeBegin = finite(value, 'visibility_range_begin', 0); publish(state); }
export function getGodotGeometryInstanceVisibilityRangeBeginMargin(instance: Object3D): number { return stateOf(instance).visibilityRangeBeginMargin; }
export function setGodotGeometryInstanceVisibilityRangeBeginMargin(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.visibilityRangeBeginMargin = finite(value, 'visibility_range_begin_margin', 0); publish(state); }
export function getGodotGeometryInstanceVisibilityRangeEnd(instance: Object3D): number { return stateOf(instance).visibilityRangeEnd; }
export function setGodotGeometryInstanceVisibilityRangeEnd(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.visibilityRangeEnd = finite(value, 'visibility_range_end', 0); publish(state); }
export function getGodotGeometryInstanceVisibilityRangeEndMargin(instance: Object3D): number { return stateOf(instance).visibilityRangeEndMargin; }
export function setGodotGeometryInstanceVisibilityRangeEndMargin(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.visibilityRangeEndMargin = finite(value, 'visibility_range_end_margin', 0); publish(state); }
export function getGodotGeometryInstanceVisibilityRangeFadeMode(instance: Object3D): number { return stateOf(instance).visibilityRangeFadeMode; }
export function setGodotGeometryInstanceVisibilityRangeFadeMode(instance: Object3D, value: unknown): void { const state = stateOf(instance); state.visibilityRangeFadeMode = mode(value, 'visibility_range_fade_mode', 2); publish(state); }
