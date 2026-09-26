import type { Camera, Scene } from 'three';
import type { GodotRid } from './gdscript-builtins';
import { godotRidOfCarrier } from './gdscript-builtins';
import type { GodotEnvironment } from './world-environment-3d';

export interface GodotWorld3DRenderingSnapshot {
  readonly scene: Scene | null;
  readonly environment: GodotEnvironment | null;
  readonly fallbackEnvironment: GodotEnvironment | null;
  readonly activeEnvironment: GodotEnvironment | null;
  readonly camera: Camera | null;
  readonly scenario: GodotRid;
}

export interface GodotWorld3DRenderingBinding {
  apply(snapshot: GodotWorld3DRenderingSnapshot): void;
}

interface MutableWorldState {
  scene: Scene | null;
  environment: GodotEnvironment | null;
  fallbackEnvironment: GodotEnvironment | null;
  camera: Camera | null;
  scenarioCarrier: object;
  binding: GodotWorld3DRenderingBinding | null;
  listeners: Set<(snapshot: GodotWorld3DRenderingSnapshot) => void>;
}

const WORLD_RENDERING = new WeakMap<object, MutableWorldState>();

function ownerOf(world: unknown): object {
  if ((typeof world !== 'object' || world === null) && typeof world !== 'function') {
    throw new TypeError('godot-compat: World3D rendering requires a World3D object.');
  }
  return world as object;
}

function environment(value: unknown, member: string): GodotEnvironment | null {
  if (value === null) return null;
  if (typeof value !== 'object' || value === undefined || !('background' in value) || !('backgroundIntensity' in value)) {
    throw new TypeError(`godot-compat: World3D.${member} requires Environment or null.`);
  }
  return value as GodotEnvironment;
}

function camera(value: unknown): Camera | null {
  if (value === null) return null;
  if (typeof value !== 'object' || value === undefined || !('isCamera' in value)) {
    throw new TypeError('godot-compat: World3D.camera requires native Camera or null.');
  }
  return value as Camera;
}

function stateOf(world: unknown): MutableWorldState {
  const owner = ownerOf(world);
  let state = WORLD_RENDERING.get(owner);
  if (state !== undefined) return state;
  const scene = 'isScene' in owner ? owner as Scene : null;
  state = {
    scene,
    environment: null,
    fallbackEnvironment: null,
    camera: null,
    scenarioCarrier: scene ?? {},
    binding: null,
    listeners: new Set(),
  };
  WORLD_RENDERING.set(owner, state);
  return state;
}

function activeEnvironment(state: MutableWorldState): GodotEnvironment | null {
  return state.environment ?? state.fallbackEnvironment;
}

function snapshot(state: MutableWorldState): GodotWorld3DRenderingSnapshot {
  return Object.freeze({
    scene: state.scene,
    environment: state.environment,
    fallbackEnvironment: state.fallbackEnvironment,
    activeEnvironment: activeEnvironment(state),
    camera: state.camera,
    scenario: godotRidOfCarrier(state.scenarioCarrier),
  });
}

function applySceneEnvironment(state: MutableWorldState): void {
  if (state.scene === null) return;
  const active = activeEnvironment(state);
  if (active === null) return;
  state.scene.background = active.background;
  state.scene.backgroundIntensity = active.backgroundIntensity;
  state.scene.backgroundRotation.copy(active.backgroundRotation);
  state.scene.environment = active.environment ?? null;
  state.scene.environmentIntensity = active.backgroundIntensity;
  state.scene.environmentRotation.copy(active.environmentRotation);
}

function publish(state: MutableWorldState): void {
  applySceneEnvironment(state);
  const value = snapshot(state);
  state.binding?.apply(value);
  for (const listener of state.listeners) listener(value);
}

export function initializeGodotWorld3DRendering(
  world: object,
  options: {
    scene?: Scene | null;
    environment?: GodotEnvironment | null;
    fallbackEnvironment?: GodotEnvironment | null;
    camera?: Camera | null;
    scenarioCarrier?: object;
  } = {},
): void {
  const state = stateOf(world);
  state.scene = options.scene ?? state.scene;
  state.environment = environment(options.environment ?? state.environment, 'environment');
  state.fallbackEnvironment = environment(options.fallbackEnvironment ?? state.fallbackEnvironment, 'fallback_environment');
  state.camera = camera(options.camera ?? state.camera);
  state.scenarioCarrier = options.scenarioCarrier ?? state.scenarioCarrier;
  publish(state);
}

export function bindGodotWorld3DRendering(world: unknown, binding: GodotWorld3DRenderingBinding | null): () => void {
  const state = stateOf(world);
  state.binding = binding;
  if (binding !== null) binding.apply(snapshot(state));
  return () => { if (state.binding === binding) state.binding = null; };
}

export function watchGodotWorld3DRendering(
  world: unknown,
  listener: (snapshot: GodotWorld3DRenderingSnapshot) => void,
): () => void {
  const state = stateOf(world);
  state.listeners.add(listener);
  listener(snapshot(state));
  return () => state.listeners.delete(listener);
}

export function getGodotWorld3DRenderingSnapshot(world: unknown): GodotWorld3DRenderingSnapshot {
  return snapshot(stateOf(world));
}

export function getGodotWorld3DEnvironment(world: unknown): GodotEnvironment | null {
  return stateOf(world).environment;
}

export function setGodotWorld3DEnvironment(world: unknown, value: unknown): void {
  const state = stateOf(world);
  state.environment = environment(value, 'environment');
  publish(state);
}

export function getGodotWorld3DFallbackEnvironment(world: unknown): GodotEnvironment | null {
  return stateOf(world).fallbackEnvironment;
}

export function setGodotWorld3DFallbackEnvironment(world: unknown, value: unknown): void {
  const state = stateOf(world);
  state.fallbackEnvironment = environment(value, 'fallback_environment');
  publish(state);
}

export function getGodotWorld3DActiveEnvironment(world: unknown): GodotEnvironment | null {
  return activeEnvironment(stateOf(world));
}

export function getGodotWorld3DCamera(world: unknown): Camera | null {
  return stateOf(world).camera;
}

export function setGodotWorld3DCamera(world: unknown, value: unknown): void {
  const state = stateOf(world);
  state.camera = camera(value);
  publish(state);
}

export function getGodotWorld3DScenario(world: unknown): GodotRid {
  return godotRidOfCarrier(stateOf(world).scenarioCarrier);
}

export function getGodotWorld3DScene(world: unknown): Scene | null {
  return stateOf(world).scene;
}

export function setGodotWorld3DScene(world: unknown, value: Scene | null): void {
  if (value !== null && (typeof value !== 'object' || !('isScene' in value))) {
    throw new TypeError('godot-compat: World3D scene requires native Scene or null.');
  }
  const state = stateOf(world);
  state.scene = value;
  if (value !== null) state.scenarioCarrier = value;
  publish(state);
}

export function refreshGodotWorld3DEnvironment(world: unknown): void {
  publish(stateOf(world));
}
