/** Godot OpenXR binding modifier Resources and authored threshold state. */

import type { GodotOpenXRActionSet } from './openxr-action-map';
import type { GodotOpenXRHapticBase } from './openxr-haptic';
import { registerGodotObjectIdentity } from './object';
import { packedByteArray, type PackedByteArray } from './packed-array';
import { bindGodotResourceProtocol, godotResourceEmitChanged } from './resource-io';

export interface GodotOpenXRBindingModifierHooks {
  _get_description?(): string;
  _get_ip_modification?(): Iterable<number>;
}

function unit(value: number, member: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${member} requires 0..1.`);
  return value;
}

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires finite float.`);
  return value;
}

export class GodotOpenXRBindingModifier {
  constructor(
    protected readonly hooks: GodotOpenXRBindingModifierHooks = {},
    className = 'OpenXRBindingModifier',
  ) {
    registerGodotObjectIdentity(this, className);
    bindGodotResourceProtocol<GodotOpenXRBindingModifier>(this, {
      createDuplicate: (source) => source.duplicateModifier(),
    });
  }
  protected duplicateModifier(): GodotOpenXRBindingModifier {
    return new GodotOpenXRBindingModifier(this.hooks);
  }
  _get_description(): string { return String(this.hooks._get_description?.() ?? ''); }
  _get_ip_modification(): PackedByteArray { return packedByteArray(this.hooks._get_ip_modification?.() ?? []); }
}

export class GodotOpenXRActionBindingModifier extends GodotOpenXRBindingModifier {
  constructor(hooks: GodotOpenXRBindingModifierHooks = {}, className = 'OpenXRActionBindingModifier') {
    super(hooks, className);
  }
  protected override duplicateModifier(): GodotOpenXRBindingModifier {
    return new GodotOpenXRActionBindingModifier(this.hooks);
  }
}
export class GodotOpenXRIPBindingModifier extends GodotOpenXRBindingModifier {
  constructor(hooks: GodotOpenXRBindingModifierHooks = {}, className = 'OpenXRIPBindingModifier') {
    super(hooks, className);
  }
  protected override duplicateModifier(): GodotOpenXRBindingModifier {
    return new GodotOpenXRIPBindingModifier(this.hooks);
  }
}

export class GodotOpenXRAnalogThresholdModifier extends GodotOpenXRActionBindingModifier {
  private onThreshold = 0.9;
  private offThreshold = 0.1;
  private onHaptic: GodotOpenXRHapticBase | null = null;
  private offHaptic: GodotOpenXRHapticBase | null = null;
  constructor(hooks: GodotOpenXRBindingModifierHooks = {}) { super(hooks, 'OpenXRAnalogThresholdModifier'); }
  set_on_threshold(value: number): void {
    const threshold = unit(value, 'OpenXRAnalogThresholdModifier.on_threshold');
    if (threshold < this.offThreshold) throw new RangeError('OpenXR on_threshold must be at least off_threshold.');
    this.onThreshold = threshold; godotResourceEmitChanged(this);
  }
  get_on_threshold(): number { return this.onThreshold; }
  set_off_threshold(value: number): void {
    const threshold = unit(value, 'OpenXRAnalogThresholdModifier.off_threshold');
    if (threshold > this.onThreshold) throw new RangeError('OpenXR off_threshold must not exceed on_threshold.');
    this.offThreshold = threshold; godotResourceEmitChanged(this);
  }
  get_off_threshold(): number { return this.offThreshold; }
  set_on_haptic(value: GodotOpenXRHapticBase | null): void { this.onHaptic = value; godotResourceEmitChanged(this); }
  get_on_haptic(): GodotOpenXRHapticBase | null { return this.onHaptic; }
  set_off_haptic(value: GodotOpenXRHapticBase | null): void { this.offHaptic = value; godotResourceEmitChanged(this); }
  get_off_haptic(): GodotOpenXRHapticBase | null { return this.offHaptic; }
  protected override duplicateModifier(): GodotOpenXRBindingModifier {
    const duplicate = new GodotOpenXRAnalogThresholdModifier(this.hooks);
    duplicate.onThreshold = this.onThreshold;
    duplicate.offThreshold = this.offThreshold;
    duplicate.onHaptic = this.onHaptic;
    duplicate.offHaptic = this.offHaptic;
    return duplicate;
  }
  evaluate(value: number, previouslyOn = false): boolean {
    return previouslyOn ? value > this.offThreshold : value >= this.onThreshold;
  }
}

export class GodotOpenXRDpadBindingModifier extends GodotOpenXRIPBindingModifier {
  private actionSet: GodotOpenXRActionSet | null = null;
  private inputPath = '';
  private threshold = 0.6;
  private thresholdReleased = 0.4;
  private centerRegion = 0.1;
  private wedgeAngle = Math.PI / 2;
  private sticky = false;
  private onHaptic: GodotOpenXRHapticBase | null = null;
  private offHaptic: GodotOpenXRHapticBase | null = null;
  constructor(hooks: GodotOpenXRBindingModifierHooks = {}) { super(hooks, 'OpenXRDpadBindingModifier'); }
  set_action_set(value: GodotOpenXRActionSet | null): void { this.actionSet = value; godotResourceEmitChanged(this); }
  get_action_set(): GodotOpenXRActionSet | null { return this.actionSet; }
  set_input_path(value: string): void {
    if (typeof value !== 'string') throw new TypeError('OpenXRDpadBindingModifier.input_path requires String.');
    this.inputPath = value; godotResourceEmitChanged(this);
  }
  get_input_path(): string { return this.inputPath; }
  set_threshold(value: number): void {
    const threshold = unit(value, 'OpenXRDpadBindingModifier.threshold');
    if (threshold < this.thresholdReleased) throw new RangeError('OpenXR D-pad threshold must be >= threshold_released.');
    this.threshold = threshold; godotResourceEmitChanged(this);
  }
  get_threshold(): number { return this.threshold; }
  set_threshold_released(value: number): void {
    const threshold = unit(value, 'OpenXRDpadBindingModifier.threshold_released');
    if (threshold > this.threshold) throw new RangeError('OpenXR D-pad threshold_released must be <= threshold.');
    this.thresholdReleased = threshold; godotResourceEmitChanged(this);
  }
  get_threshold_released(): number { return this.thresholdReleased; }
  set_center_region(value: number): void { this.centerRegion = unit(value, 'OpenXRDpadBindingModifier.center_region'); godotResourceEmitChanged(this); }
  get_center_region(): number { return this.centerRegion; }
  set_wedge_angle(value: number): void {
    const angle = finite(value, 'OpenXRDpadBindingModifier.wedge_angle');
    if (angle <= 0 || angle > Math.PI * 2) throw new RangeError('OpenXR D-pad wedge_angle requires 0 < angle <= TAU.');
    this.wedgeAngle = angle; godotResourceEmitChanged(this);
  }
  get_wedge_angle(): number { return this.wedgeAngle; }
  set_is_sticky(value: boolean): void { this.sticky = Boolean(value); godotResourceEmitChanged(this); }
  get_is_sticky(): boolean { return this.sticky; }
  set_on_haptic(value: GodotOpenXRHapticBase | null): void { this.onHaptic = value; godotResourceEmitChanged(this); }
  get_on_haptic(): GodotOpenXRHapticBase | null { return this.onHaptic; }
  set_off_haptic(value: GodotOpenXRHapticBase | null): void { this.offHaptic = value; godotResourceEmitChanged(this); }
  get_off_haptic(): GodotOpenXRHapticBase | null { return this.offHaptic; }
  protected override duplicateModifier(): GodotOpenXRBindingModifier {
    const duplicate = new GodotOpenXRDpadBindingModifier(this.hooks);
    duplicate.actionSet = this.actionSet;
    duplicate.inputPath = this.inputPath;
    duplicate.threshold = this.threshold;
    duplicate.thresholdReleased = this.thresholdReleased;
    duplicate.centerRegion = this.centerRegion;
    duplicate.wedgeAngle = this.wedgeAngle;
    duplicate.sticky = this.sticky;
    duplicate.onHaptic = this.onHaptic;
    duplicate.offHaptic = this.offHaptic;
    return duplicate;
  }
  direction(x: number, y: number, previous = -1): number {
    const magnitude = Math.hypot(x, y);
    const activeThreshold = previous >= 0 && this.sticky ? this.thresholdReleased : this.threshold;
    if (magnitude < Math.max(this.centerRegion, activeThreshold)) return -1;
    const angle = Math.atan2(y, x);
    const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
    return Math.floor((normalized + this.wedgeAngle / 2) / this.wedgeAngle) % Math.max(1, Math.round(Math.PI * 2 / this.wedgeAngle));
  }
}

export function createGodotOpenXRBindingModifier(hooks: GodotOpenXRBindingModifierHooks = {}): GodotOpenXRBindingModifier { return new GodotOpenXRBindingModifier(hooks); }
export function createGodotOpenXRActionBindingModifier(hooks: GodotOpenXRBindingModifierHooks = {}): GodotOpenXRActionBindingModifier { return new GodotOpenXRActionBindingModifier(hooks); }
export function createGodotOpenXRIPBindingModifier(hooks: GodotOpenXRBindingModifierHooks = {}): GodotOpenXRIPBindingModifier { return new GodotOpenXRIPBindingModifier(hooks); }
export function createGodotOpenXRAnalogThresholdModifier(hooks: GodotOpenXRBindingModifierHooks = {}): GodotOpenXRAnalogThresholdModifier { return new GodotOpenXRAnalogThresholdModifier(hooks); }
export function createGodotOpenXRDpadBindingModifier(hooks: GodotOpenXRBindingModifierHooks = {}): GodotOpenXRDpadBindingModifier { return new GodotOpenXRDpadBindingModifier(hooks); }
