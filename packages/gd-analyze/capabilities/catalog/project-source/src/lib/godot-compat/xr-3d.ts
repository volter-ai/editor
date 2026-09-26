/** Godot 4 XR scene nodes over Three's native WebXR camera/origin graph. */
import { Object3D, type PerspectiveCamera } from 'three';
import { createGodotThreeNode3D } from './node-3d';
import { registerGodotObjectIdentity } from './object';
import { createGodotCamera3D } from './spatial';
import type { Vector2 } from './vector2';
import { createSignal, type GodotSignal } from './signal';
import { bindGodotXRNode3D } from './xr-runtime';

/**
 * Three's WebXRManager derives its ArrayCamera from the application's active PerspectiveCamera.
 * The retained node is therefore the same native camera owner as Camera3D, with the exact XR
 * ClassDB identity layered onto it rather than a detached parallel camera.
 */
export function createGodotXRCamera3D(viewportSize: () => Vector2): PerspectiveCamera {
  const camera = createGodotCamera3D(4, viewportSize);
  registerGodotObjectIdentity(camera, 'XRCamera3D');
  return camera;
}

/** WebXR's reference-space origin is the real Object3D parent whose transform seats XR children. */
export function createGodotXROrigin3D(): Object3D {
  const origin = createGodotThreeNode3D(4);
  registerGodotObjectIdentity(origin, 'XROrigin3D');
  return origin;
}

/** Native XR controller node with the same named scalar-input store used by WebXR action binding. */
export class GodotXRController3D extends Object3D {
  readonly input_float_changed: GodotSignal<readonly [string, number]>;
  private readonly inputFloatChanged = createSignal<readonly [string, number]>();
  private readonly floatInputs = new Map<string, number>();

  constructor(tracker = '', pose = 'default') {
    super();
    this.input_float_changed = this.inputFloatChanged.signal;
    registerGodotObjectIdentity(this, 'XRController3D');
    bindGodotXRNode3D(this, tracker, pose);
  }

  get_float(name: string): number {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('XRController3D.get_float requires a non-empty StringName.');
    }
    return this.floatInputs.get(name) ?? 0;
  }

  /** Adapter boundary used by the native WebXR input poller. */
  set_float_input(name: string, value: number): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('XRController3D float input requires a non-empty StringName.');
    }
    if (!Number.isFinite(value)) throw new TypeError('XRController3D float input requires a finite float.');
    if (this.floatInputs.get(name) === value) return;
    this.floatInputs.set(name, value);
    this.inputFloatChanged.emit(name, value);
  }
}

export function createGodotXRController3D(tracker = '', pose = 'default'): GodotXRController3D {
  return new GodotXRController3D(tracker, pose);
}

const XR_WORLD_SCALES = new WeakMap<object, number>();

/** XRServer's world-units-per-meter state, scoped to the translated SceneTree singleton owner. */
export function godotXRServerWorldScale(owner: object): number {
  return XR_WORLD_SCALES.get(owner) ?? 1;
}

export function setGodotXRServerWorldScale(owner: object, value: number): void {
  if (!Number.isFinite(value) || value < 0.01) {
    throw new RangeError('XRServer.world_scale requires a finite value of at least 0.01.');
  }
  XR_WORLD_SCALES.set(owner, value);
}

/** XRNode3D is the native transform which receives a retained positional-tracker pose. */
export function createGodotXRNode3D(tracker = '', pose = 'default'): Object3D {
  const node = createGodotThreeNode3D(4);
  registerGodotObjectIdentity(node, 'XRNode3D');
  bindGodotXRNode3D(node, tracker, pose);
  return node;
}

/** Anchors are native reference-space transforms. Plane metadata is retained by the port. */
export interface GodotXRAnchor3D extends Object3D {
  godotXRAnchorSize: Vector2;
  godotXRAnchorPlane: number;
}

export function createGodotXRAnchor3D(size: Vector2 = { x: 0, y: 0 }, plane = 0): GodotXRAnchor3D {
  const node = createGodotThreeNode3D(4) as GodotXRAnchor3D;
  registerGodotObjectIdentity(node, 'XRAnchor3D');
  node.godotXRAnchorSize = { ...size };
  node.godotXRAnchorPlane = plane;
  return node;
}

export function getGodotXRAnchorSize(anchor: GodotXRAnchor3D): Vector2 {
  return { ...anchor.godotXRAnchorSize };
}

export function getGodotXRAnchorPlane(anchor: GodotXRAnchor3D): number {
  return anchor.godotXRAnchorPlane;
}
