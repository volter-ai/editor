import type { Camera, Matrix4, Object3D } from 'three';
import type { GodotEnvironment } from './world-environment-3d';

export const GODOT_CAMERA_DOPPLER_TRACKING = {
  DISABLED: 0,
  IDLE_STEP: 1,
  PHYSICS_STEP: 2,
  DOPPLER_TRACKING_DISABLED: 0,
  DOPPLER_TRACKING_IDLE_STEP: 1,
  DOPPLER_TRACKING_PHYSICS_STEP: 2,
} as const;

export type GodotCameraDopplerTracking = 0 | 1 | 2;

/**
 * Structural compositor resource accepted by Camera3D. The renderer integration owns the actual
 * pass graph; compat only retains the resource and publishes changes without inserting a second
 * scene or renderer abstraction.
 */
export interface GodotCameraCompositor {
  readonly __godotClass?: 'Compositor';
  readonly compositorEffects?: readonly unknown[];
}

export interface GodotCameraRenderingSnapshot {
  readonly environment: GodotEnvironment | null;
  readonly compositor: GodotCameraCompositor | null;
  readonly dopplerTracking: GodotCameraDopplerTracking;
  readonly current: boolean;
  readonly worldMatrix: Matrix4;
}

export interface GodotCameraRenderingBinding {
  setEnvironment?(environment: GodotEnvironment | null): void;
  setCompositor?(compositor: GodotCameraCompositor | null): void;
  setDopplerTracking?(mode: GodotCameraDopplerTracking): void;
  setCurrent?(current: boolean): void;
}

interface CameraRenderingState {
  environment: GodotEnvironment | null;
  compositor: GodotCameraCompositor | null;
  dopplerTracking: GodotCameraDopplerTracking;
  current: boolean;
  binding: GodotCameraRenderingBinding | null;
  listeners: Set<(snapshot: GodotCameraRenderingSnapshot) => void>;
}

const CAMERA_RENDERING = new WeakMap<Camera, CameraRenderingState>();

function stateOf(camera: Camera): CameraRenderingState {
  let state = CAMERA_RENDERING.get(camera);
  if (state !== undefined) return state;
  state = {
    environment: null,
    compositor: null,
    dopplerTracking: GODOT_CAMERA_DOPPLER_TRACKING.DISABLED,
    current: false,
    binding: null,
    listeners: new Set(),
  };
  CAMERA_RENDERING.set(camera, state);
  return state;
}

function snapshotOf(camera: Camera, state: CameraRenderingState): GodotCameraRenderingSnapshot {
  camera.updateWorldMatrix(true, false);
  return Object.freeze({
    environment: state.environment,
    compositor: state.compositor,
    dopplerTracking: state.dopplerTracking,
    current: state.current,
    worldMatrix: camera.matrixWorld.clone(),
  });
}

function changed(camera: Camera, state: CameraRenderingState): void {
  if (state.listeners.size === 0) return;
  const snapshot = snapshotOf(camera, state);
  for (const listener of state.listeners) listener(snapshot);
}

function requireEnvironment(value: unknown): GodotEnvironment | null {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    value === undefined ||
    !('background' in value) ||
    !('backgroundIntensity' in value)
  ) {
    throw new TypeError('godot-compat: Camera3D.environment requires Environment or null.');
  }
  return value as GodotEnvironment;
}

function requireCompositor(value: unknown): GodotCameraCompositor | null {
  if (value === null) return null;
  if (typeof value !== 'object' || value === undefined) {
    throw new TypeError('godot-compat: Camera3D.compositor requires Compositor or null.');
  }
  return value as GodotCameraCompositor;
}

function requireDopplerTracking(value: unknown): GodotCameraDopplerTracking {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new RangeError('godot-compat: Camera3D.doppler_tracking requires a mode in [0, 2].');
  }
  return value;
}

export function bindGodotCameraRendering(
  camera: Camera,
  binding: GodotCameraRenderingBinding | null,
): () => void {
  const state = stateOf(camera);
  state.binding = binding;
  if (binding !== null) {
    binding.setEnvironment?.(state.environment);
    binding.setCompositor?.(state.compositor);
    binding.setDopplerTracking?.(state.dopplerTracking);
    binding.setCurrent?.(state.current);
  }
  return () => {
    if (state.binding === binding) state.binding = null;
  };
}

export function watchGodotCameraRendering(
  camera: Camera,
  listener: (snapshot: GodotCameraRenderingSnapshot) => void,
): () => void {
  const state = stateOf(camera);
  state.listeners.add(listener);
  listener(snapshotOf(camera, state));
  return () => state.listeners.delete(listener);
}

export function getGodotCameraEnvironment(camera: Camera): GodotEnvironment | null {
  return stateOf(camera).environment;
}

export function setGodotCameraEnvironment(camera: Camera, value: unknown): void {
  const state = stateOf(camera);
  const environment = requireEnvironment(value);
  if (state.environment === environment) return;
  state.environment = environment;
  state.binding?.setEnvironment?.(environment);
  changed(camera, state);
}

export function getGodotCameraCompositor(camera: Camera): GodotCameraCompositor | null {
  return stateOf(camera).compositor;
}

export function setGodotCameraCompositor(camera: Camera, value: unknown): void {
  const state = stateOf(camera);
  const compositor = requireCompositor(value);
  if (state.compositor === compositor) return;
  state.compositor = compositor;
  state.binding?.setCompositor?.(compositor);
  changed(camera, state);
}

export function getGodotCameraDopplerTracking(camera: Camera): GodotCameraDopplerTracking {
  return stateOf(camera).dopplerTracking;
}

export function setGodotCameraDopplerTracking(camera: Camera, value: unknown): void {
  const state = stateOf(camera);
  const mode = requireDopplerTracking(value);
  if (state.dopplerTracking === mode) return;
  state.dopplerTracking = mode;
  state.binding?.setDopplerTracking?.(mode);
  changed(camera, state);
}

export function isGodotCameraRenderingCurrent(camera: Camera): boolean {
  return stateOf(camera).current;
}

export function setGodotCameraRenderingCurrent(camera: Camera, value: unknown): void {
  if (typeof value !== 'boolean') {
    throw new TypeError('godot-compat: Camera3D.current requires bool.');
  }
  const state = stateOf(camera);
  if (state.current === value) return;
  state.current = value;
  state.binding?.setCurrent?.(value);
  changed(camera, state);
}

export function getGodotCameraRenderingSnapshot(camera: Camera): GodotCameraRenderingSnapshot {
  return snapshotOf(camera, stateOf(camera));
}

export function getGodotCameraTransform(camera: Camera): Matrix4 {
  camera.updateWorldMatrix(true, false);
  return camera.matrixWorld.clone();
}

export function getGodotCameraParent(camera: Camera): Object3D | null {
  return camera.parent;
}
