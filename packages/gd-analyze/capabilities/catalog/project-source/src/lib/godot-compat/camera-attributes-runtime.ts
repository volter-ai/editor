import type { Camera } from 'three';
import {
  setGodotCameraAttributes,
  watchGodotCameraAttributes,
  type GodotCameraAttributes,
  type GodotCameraAttributesPhysical,
  type GodotCameraAttributesPractical,
} from './camera-attributes';

export interface GodotCameraExposureRuntimeConfig {
  readonly enabled: boolean;
  readonly multiplier: number;
  readonly sensitivity: number;
  readonly aperture: number;
  readonly shutterSpeed: number;
  readonly exposureValue: number;
  readonly autoExposure: null | {
    readonly minLuminance: number;
    readonly maxLuminance: number;
    readonly speed: number;
    readonly scale: number;
  };
}

export interface GodotCameraDepthOfFieldRuntimeConfig {
  readonly enabled: boolean;
  readonly focusDistance: number;
  readonly aperture: number;
  readonly blurAmount: number;
  readonly farEnabled: boolean;
  readonly farDistance: number;
  readonly farTransition: number;
  readonly nearEnabled: boolean;
  readonly nearDistance: number;
  readonly nearTransition: number;
}

export interface GodotCameraAttributesRuntimeSnapshot {
  readonly attributes: GodotCameraAttributes | null;
  readonly exposure: GodotCameraExposureRuntimeConfig;
  readonly depthOfField: GodotCameraDepthOfFieldRuntimeConfig;
}

export interface GodotCameraAttributesRuntimeBinding {
  applyExposure(config: GodotCameraExposureRuntimeConfig): void;
  applyDepthOfField(config: GodotCameraDepthOfFieldRuntimeConfig): void;
}

interface CameraAttributesState {
  attributes: GodotCameraAttributes | null;
  releaseAttributes: (() => void) | null;
  binding: GodotCameraAttributesRuntimeBinding | null;
  listeners: Set<(snapshot: GodotCameraAttributesRuntimeSnapshot) => void>;
}

const CAMERA_ATTRIBUTES_RUNTIME = new WeakMap<Camera, CameraAttributesState>();

function stateOf(camera: Camera): CameraAttributesState {
  let state = CAMERA_ATTRIBUTES_RUNTIME.get(camera);
  if (state !== undefined) return state;
  state = { attributes: null, releaseAttributes: null, binding: null, listeners: new Set() };
  CAMERA_ATTRIBUTES_RUNTIME.set(camera, state);
  return state;
}

function exposureValue(aperture: number, shutterSpeed: number, sensitivity: number): number {
  const shutterSeconds = 1 / Math.max(shutterSpeed, 0.000001);
  return Math.log2((aperture * aperture / shutterSeconds) * (100 / Math.max(sensitivity, 0.000001)));
}

function physicalExposure(attributes: GodotCameraAttributesPhysical): GodotCameraExposureRuntimeConfig {
  const ev = exposureValue(attributes.exposure_aperture, attributes.exposure_shutter_speed, attributes.exposure_sensitivity);
  const multiplier = attributes.exposure_multiplier / (1.2 * Math.pow(2, ev));
  return Object.freeze({
    enabled: true,
    multiplier,
    sensitivity: attributes.exposure_sensitivity,
    aperture: attributes.exposure_aperture,
    shutterSpeed: attributes.exposure_shutter_speed,
    exposureValue: ev,
    autoExposure: attributes.auto_exposure_enabled
      ? Object.freeze({
          minLuminance: Math.pow(2, attributes.auto_exposure_min_exposure_value),
          maxLuminance: Math.pow(2, attributes.auto_exposure_max_exposure_value),
          speed: attributes.auto_exposure_speed,
          scale: attributes.auto_exposure_scale,
        })
      : null,
  });
}

function practicalExposure(attributes: GodotCameraAttributesPractical): GodotCameraExposureRuntimeConfig {
  const multiplier = attributes.exposure_multiplier * (100 / Math.max(attributes.exposure_sensitivity, 0.000001));
  return Object.freeze({
    enabled: true,
    multiplier,
    sensitivity: attributes.exposure_sensitivity,
    aperture: 16,
    shutterSpeed: 100,
    exposureValue: Math.log2(1 / Math.max(multiplier, 0.000001)),
    autoExposure: attributes.auto_exposure_enabled
      ? Object.freeze({
          minLuminance: Math.max(0.000001, attributes.auto_exposure_min_sensitivity / 100),
          maxLuminance: Math.max(0.000001, attributes.auto_exposure_max_sensitivity / 100),
          speed: attributes.auto_exposure_speed,
          scale: attributes.auto_exposure_scale,
        })
      : null,
  });
}

function disabledExposure(): GodotCameraExposureRuntimeConfig {
  return Object.freeze({ enabled: false, multiplier: 1, sensitivity: 100, aperture: 16, shutterSpeed: 100, exposureValue: 0, autoExposure: null });
}

function depthOfField(attributes: GodotCameraAttributes | null): GodotCameraDepthOfFieldRuntimeConfig {
  if (attributes === null) {
    return Object.freeze({ enabled: false, focusDistance: 10, aperture: 16, blurAmount: 0, farEnabled: false, farDistance: 10, farTransition: 5, nearEnabled: false, nearDistance: 2, nearTransition: 1 });
  }
  if (attributes.__godotClass === 'CameraAttributesPhysical') {
    return Object.freeze({
      enabled: attributes.frustum_focus_distance > 0 && attributes.exposure_aperture > 0,
      focusDistance: attributes.frustum_focus_distance,
      aperture: attributes.exposure_aperture,
      blurAmount: Math.min(1, 1 / Math.max(attributes.exposure_aperture, 0.001)),
      farEnabled: true,
      farDistance: attributes.frustum_focus_distance,
      farTransition: Math.max(0.001, attributes.frustum_focus_distance / attributes.exposure_aperture),
      nearEnabled: true,
      nearDistance: attributes.frustum_focus_distance,
      nearTransition: Math.max(0.001, attributes.frustum_focus_distance / attributes.exposure_aperture),
    });
  }
  return Object.freeze({
    enabled: attributes.dof_blur_far_enabled || attributes.dof_blur_near_enabled,
    focusDistance: attributes.dof_blur_near_enabled ? attributes.dof_blur_near_distance : attributes.dof_blur_far_distance,
    aperture: Math.max(0.001, 1 / Math.max(attributes.dof_blur_amount, 0.001)),
    blurAmount: attributes.dof_blur_amount,
    farEnabled: attributes.dof_blur_far_enabled,
    farDistance: attributes.dof_blur_far_distance,
    farTransition: attributes.dof_blur_far_transition,
    nearEnabled: attributes.dof_blur_near_enabled,
    nearDistance: attributes.dof_blur_near_distance,
    nearTransition: attributes.dof_blur_near_transition,
  });
}

function snapshotOf(state: CameraAttributesState): GodotCameraAttributesRuntimeSnapshot {
  const attributes = state.attributes;
  const exposure = attributes === null
    ? disabledExposure()
    : attributes.__godotClass === 'CameraAttributesPhysical'
      ? physicalExposure(attributes)
      : practicalExposure(attributes);
  return Object.freeze({ attributes, exposure, depthOfField: depthOfField(attributes) });
}

function publish(state: CameraAttributesState): void {
  const snapshot = snapshotOf(state);
  state.binding?.applyExposure(snapshot.exposure);
  state.binding?.applyDepthOfField(snapshot.depthOfField);
  for (const listener of state.listeners) listener(snapshot);
}

function requireAttributes(value: unknown): GodotCameraAttributes | null {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    !('__godotClass' in value) ||
    (value.__godotClass !== 'CameraAttributesPhysical' && value.__godotClass !== 'CameraAttributesPractical')
  ) {
    throw new TypeError('godot-compat: camera attributes runtime requires CameraAttributes or null.');
  }
  return value as GodotCameraAttributes;
}

export function setGodotCameraRuntimeAttributes(camera: Camera, value: unknown): void {
  const state = stateOf(camera);
  const attributes = requireAttributes(value);
  if (state.attributes === attributes) return;
  state.releaseAttributes?.();
  state.releaseAttributes = null;
  state.attributes = attributes;
  if (attributes !== null) state.releaseAttributes = watchGodotCameraAttributes(attributes, () => publish(state));
  publish(state);
}

export function setGodotCameraAttributesWithRuntime(camera: Camera, value: unknown): void {
  const attributes = requireAttributes(value);
  setGodotCameraAttributes(camera as Parameters<typeof setGodotCameraAttributes>[0], attributes);
  setGodotCameraRuntimeAttributes(camera, attributes);
}

export function getGodotCameraRuntimeAttributes(camera: Camera): GodotCameraAttributes | null { return stateOf(camera).attributes; }

export function bindGodotCameraAttributesRuntime(camera: Camera, binding: GodotCameraAttributesRuntimeBinding | null): () => void {
  const state = stateOf(camera); state.binding = binding;
  if (binding !== null) { const snapshot = snapshotOf(state); binding.applyExposure(snapshot.exposure); binding.applyDepthOfField(snapshot.depthOfField); }
  return () => { if (state.binding === binding) state.binding = null; };
}

export function watchGodotCameraAttributesRuntime(camera: Camera, listener: (snapshot: GodotCameraAttributesRuntimeSnapshot) => void): () => void {
  const state = stateOf(camera); state.listeners.add(listener); listener(snapshotOf(state)); return () => state.listeners.delete(listener);
}

export function getGodotCameraAttributesRuntimeSnapshot(camera: Camera): GodotCameraAttributesRuntimeSnapshot { return snapshotOf(stateOf(camera)); }

export function disposeGodotCameraAttributesRuntime(camera: Camera): void {
  const state = stateOf(camera); state.releaseAttributes?.(); state.listeners.clear(); state.binding = null; CAMERA_ATTRIBUTES_RUNTIME.delete(camera);
}
