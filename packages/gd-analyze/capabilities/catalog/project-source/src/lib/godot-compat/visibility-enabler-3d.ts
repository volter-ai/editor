import { Object3D, type Camera } from 'three';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';
import {
  createVisibilityNotifier3D,
  type VisibilityAABB,
  type VisibilityNotifier3D,
} from './visibility-notifier-3d';

export const GodotVisibleOnScreenEnablerMode = {
  INHERIT: 0,
  ALWAYS: 1,
  WHEN_PAUSED: 2,
} as const;

export type GodotVisibleOnScreenEnablerModeValue = typeof GodotVisibleOnScreenEnablerMode[keyof typeof GodotVisibleOnScreenEnablerMode];

export interface GodotVisibilityActivationTarget {
  setProcessMode?(mode: GodotVisibleOnScreenEnablerModeValue): void;
  setEnabled?(enabled: boolean): void;
  set_process?(enabled: boolean): void;
  set_physics_process?(enabled: boolean): void;
}

export interface GodotVisibleOnScreenEnabler3DOptions {
  readonly aabb?: VisibilityAABB;
  readonly target?: GodotVisibilityActivationTarget | null;
  readonly targetNode?: string;
  readonly enableMode?: GodotVisibleOnScreenEnablerModeValue;
}

const DEFAULT_AABB: VisibilityAABB = {
  position: { x: -1, y: -1, z: -1 },
  size: { x: 2, y: 2, z: 2 },
};

function mode(value: number): GodotVisibleOnScreenEnablerModeValue {
  if (value !== 0 && value !== 1 && value !== 2) {
    throw new RangeError('VisibleOnScreenEnabler3D.enable_mode requires INHERIT, ALWAYS, or WHEN_PAUSED.');
  }
  return value;
}

function copyAabb(value: VisibilityAABB): VisibilityAABB {
  const components = [value.position.x, value.position.y, value.position.z, value.size.x, value.size.y, value.size.z];
  if (!components.every(Number.isFinite) || value.size.x < 0 || value.size.y < 0 || value.size.z < 0) {
    throw new RangeError('VisibleOnScreenNotifier3D.aabb requires finite position and nonnegative size.');
  }
  return {
    position: { ...value.position },
    size: { ...value.size },
  };
}

export class GodotVisibleOnScreenEnabler3D extends Object3D {
  private readonly enteredHandle = createSignal<readonly []>();
  private readonly exitedHandle = createSignal<readonly []>();
  readonly screen_entered: GodotSignal<readonly []> = this.enteredHandle.signal;
  readonly screen_exited: GodotSignal<readonly []> = this.exitedHandle.signal;
  private aabbValue: VisibilityAABB;
  private notifier: VisibilityNotifier3D;
  private targetValue: GodotVisibilityActivationTarget | null;
  private targetNodeValue: string;
  private enableModeValue: GodotVisibleOnScreenEnablerModeValue;
  private onScreenValue = false;

  constructor(options: GodotVisibleOnScreenEnabler3DOptions = {}) {
    super();
    registerGodotObjectIdentity(this, 'VisibleOnScreenEnabler3D');
    this.aabbValue = copyAabb(options.aabb ?? DEFAULT_AABB);
    this.notifier = createVisibilityNotifier3D(this.aabbValue);
    this.targetValue = options.target ?? null;
    this.targetNodeValue = options.targetNode ?? '..';
    this.enableModeValue = mode(options.enableMode ?? GodotVisibleOnScreenEnablerMode.INHERIT);
    this.applyTarget(false);
  }

  set_aabb(value: VisibilityAABB): void {
    this.aabbValue = copyAabb(value);
    this.notifier = createVisibilityNotifier3D(this.aabbValue);
    this.onScreenValue = false;
    this.applyTarget(false);
  }
  get_aabb(): VisibilityAABB { return copyAabb(this.aabbValue); }
  set_enable_mode(value: number): void { this.enableModeValue = mode(value); this.applyTarget(this.onScreenValue); }
  get_enable_mode(): GodotVisibleOnScreenEnablerModeValue { return this.enableModeValue; }
  set_enable_node_path(value: string): void {
    if (typeof value !== 'string') throw new TypeError('VisibleOnScreenEnabler3D.enable_node_path requires NodePath.');
    this.targetNodeValue = value;
  }
  get_enable_node_path(): string { return this.targetNodeValue; }
  set_target(value: GodotVisibilityActivationTarget | null): void {
    this.targetValue = value;
    this.applyTarget(this.onScreenValue);
  }
  get_target(): GodotVisibilityActivationTarget | null { return this.targetValue; }
  is_on_screen(): boolean { return this.onScreenValue; }

  update_visibility(camera: Camera): boolean | undefined {
    const transition = this.notifier.visibilityChanged(camera, this);
    if (transition === undefined) return undefined;
    this.onScreenValue = transition;
    this.applyTarget(transition);
    if (transition) this.enteredHandle.emit();
    else this.exitedHandle.emit();
    return transition;
  }

  private applyTarget(visible: boolean): void {
    const target = this.targetValue;
    if (target === null) return;
    if (visible) {
      target.setProcessMode?.(this.enableModeValue);
      target.setEnabled?.(true);
      target.set_process?.(true);
      target.set_physics_process?.(true);
    } else {
      target.setEnabled?.(false);
      target.set_process?.(false);
      target.set_physics_process?.(false);
    }
  }
}

export class GodotVisibleOnScreenNotifier3D extends GodotVisibleOnScreenEnabler3D {
  constructor(aabb: VisibilityAABB = DEFAULT_AABB) {
    super({ aabb });
    registerGodotObjectIdentity(this, 'VisibleOnScreenNotifier3D');
  }
  override set_target(value: GodotVisibilityActivationTarget | null): void { void value; }
}

export const createGodotVisibleOnScreenEnabler3D = (
  options: GodotVisibleOnScreenEnabler3DOptions = {},
): GodotVisibleOnScreenEnabler3D => new GodotVisibleOnScreenEnabler3D(options);

export const createGodotVisibleOnScreenNotifier3D = (
  aabb: VisibilityAABB = DEFAULT_AABB,
): GodotVisibleOnScreenNotifier3D => new GodotVisibleOnScreenNotifier3D(aabb);
