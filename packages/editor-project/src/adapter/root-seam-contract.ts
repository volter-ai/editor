/** Exhaustive proof requirements for substrate mount/lifecycle seams. */

import type { AdapterSurface } from './adapter-surface';
import type {
  MountedCanvasRoot,
  MountedReactRoot,
  MountedRootBase,
  MountedThreeRoot,
  RootAdapter,
  RootStateObserver,
} from './root-adapter';
import { defineSeamShape } from './seam-evidence';

export const ROOT_ADAPTER_SHAPE = defineSeamShape<RootAdapter<AdapterSurface>>()({
  id: { optional: false, kind: 'value', required: 'shape' },
  mount: { optional: false, kind: 'function', required: 'effect' },
});

export const MOUNTED_ROOT_BASE_SHAPE = defineSeamShape<MountedRootBase>()({
  drivesOwnLoop: { optional: false, kind: 'value', required: 'shape' },
  updateCadence: { optional: true, kind: 'value', required: 'shape' },
  update: { optional: true, kind: 'function', required: 'effect' },
  fixedUpdate: { optional: true, kind: 'function', required: 'effect' },
  setPaused: { optional: true, kind: 'function', required: 'effect' },
  step: { optional: true, kind: 'function', required: 'effect' },
  resize: { optional: true, kind: 'function', required: 'effect' },
  dispose: { optional: false, kind: 'function', required: 'effect' },
  disposeComplete: { optional: true, kind: 'value', required: 'effect' },
  authoring: { optional: true, kind: 'value', required: 'operation' },
  systems: { optional: true, kind: 'value', required: 'operation' },
  systemScope: { optional: true, kind: 'value', required: 'operation' },
  observe: { optional: true, kind: 'value', required: 'effect' },
});

export const ROOT_STATE_OBSERVER_SHAPE = defineSeamShape<RootStateObserver>()({
  subscribe: { optional: false, kind: 'function', required: 'effect' },
  snapshot: { optional: false, kind: 'function', required: 'operation' },
});

type ThreeSurface = Omit<MountedThreeRoot<object, object>, keyof MountedRootBase>;
type CanvasSurface = Omit<MountedCanvasRoot, keyof MountedRootBase>;
type DomSurface = Omit<MountedReactRoot, keyof MountedRootBase>;

export const MOUNTED_THREE_SURFACE_SHAPE = defineSeamShape<ThreeSurface>()({
  kind: { optional: false, kind: 'value', required: 'shape' },
  scene: { optional: false, kind: 'value', required: 'effect' },
  camera: { optional: false, kind: 'value', required: 'effect' },
  rendererConfig: { optional: true, kind: 'value', required: 'shape' },
});

export const MOUNTED_CANVAS_SURFACE_SHAPE = defineSeamShape<CanvasSurface>()({
  kind: { optional: false, kind: 'value', required: 'shape' },
  canvas: { optional: false, kind: 'value', required: 'effect' },
  substrate: { optional: false, kind: 'value', required: 'effect' },
});

export const MOUNTED_DOM_SURFACE_SHAPE = defineSeamShape<DomSurface>()({
  kind: { optional: false, kind: 'value', required: 'shape' },
  container: { optional: false, kind: 'value', required: 'effect' },
});
