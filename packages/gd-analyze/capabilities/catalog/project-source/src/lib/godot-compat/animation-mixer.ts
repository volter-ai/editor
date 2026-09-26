import type { AnimationClip } from 'three';
import { animationLibraryEntries, type GodotAnimationLibrary } from './animation-resource';
import { createSignal, type GodotSignal } from './signal';

export const GODOT_ANIMATION_CALLBACK_MODE_PROCESS_PHYSICS = 0;
export const GODOT_ANIMATION_CALLBACK_MODE_PROCESS_IDLE = 1;
export const GODOT_ANIMATION_CALLBACK_MODE_PROCESS_MANUAL = 2;
export const GODOT_ANIMATION_CALLBACK_MODE_METHOD_DEFERRED = 0;
export const GODOT_ANIMATION_CALLBACK_MODE_METHOD_IMMEDIATE = 1;
export const GODOT_ANIMATION_CALLBACK_MODE_DISCRETE_DOMINANT = 0;
export const GODOT_ANIMATION_CALLBACK_MODE_DISCRETE_RECESSIVE = 1;
export const GODOT_ANIMATION_CALLBACK_MODE_DISCRETE_FORCE_CONTINUOUS = 2;

export interface GodotAnimationMixerCarrier {
  postProcessKeyValue?(animation: AnimationClip, track: number, value: unknown, objectId: bigint | number, objectSubIndex: number): unknown;
  advance?(delta: number, mixer: GodotAnimationMixer): void;
  capture?(name: string, duration: number, transitionType: number, easeType: number): void;
  clearCaches?(): void;
}

export class GodotAnimationMixer {
  private readonly libraries = new Map<string, GodotAnimationLibrary>();
  private readonly animationListChangedSignal = createSignal<readonly []>();
  private readonly librariesUpdatedSignal = createSignal<readonly []>();
  private readonly animationFinishedSignal = createSignal<readonly [string]>();
  private readonly animationStartedSignal = createSignal<readonly [string]>();
  private readonly cachesClearedSignal = createSignal<readonly []>();
  private readonly mixerAppliedSignal = createSignal<readonly []>();
  private readonly mixerUpdatedSignal = createSignal<readonly []>();
  private active = true;
  private deterministic = false;
  private rootNode: unknown = '..';
  private callbackModeProcess = GODOT_ANIMATION_CALLBACK_MODE_PROCESS_IDLE;
  private callbackModeMethod = GODOT_ANIMATION_CALLBACK_MODE_METHOD_DEFERRED;
  private callbackModeDiscrete = GODOT_ANIMATION_CALLBACK_MODE_DISCRETE_DOMINANT;
  private audioMaxPolyphony = 32;
  private rootMotionTrack: unknown = '';
  private rootMotionLocal = false;
  private resetOnSave = true;
  private rootMotionPosition = { x: 0, y: 0, z: 0 };
  private rootMotionRotation = { x: 0, y: 0, z: 0, w: 1 };
  private rootMotionScale = { x: 1, y: 1, z: 1 };
  private rootMotionPositionAccumulator = { x: 0, y: 0, z: 0 };
  private rootMotionRotationAccumulator = { x: 0, y: 0, z: 0, w: 1 };
  private rootMotionScaleAccumulator = { x: 1, y: 1, z: 1 };

  readonly animation_list_changed: GodotSignal<readonly []> = this.animationListChangedSignal.signal;
  readonly animation_libraries_updated: GodotSignal<readonly []> = this.librariesUpdatedSignal.signal;
  readonly animation_finished: GodotSignal<readonly [string]> = this.animationFinishedSignal.signal;
  readonly animation_started: GodotSignal<readonly [string]> = this.animationStartedSignal.signal;
  readonly caches_cleared: GodotSignal<readonly []> = this.cachesClearedSignal.signal;
  readonly mixer_applied: GodotSignal<readonly []> = this.mixerAppliedSignal.signal;
  readonly mixer_updated: GodotSignal<readonly []> = this.mixerUpdatedSignal.signal;

  constructor(private readonly carrier: GodotAnimationMixerCarrier = {}) {}

  _post_process_key_value(animation: AnimationClip, track: number, value: unknown, objectId: bigint | number, objectSubIndex: number): unknown {
    return this.carrier.postProcessKeyValue?.(animation, track, value, objectId, objectSubIndex) ?? value;
  }

  add_animation_library(name: string, library: GodotAnimationLibrary): number {
    if (this.libraries.has(name)) return 31;
    this.libraries.set(name, library);
    this.librariesUpdatedSignal.emit();
    this.animationListChangedSignal.emit();
    return 0;
  }

  remove_animation_library(name: string): void {
    if (!this.libraries.delete(name)) return;
    this.librariesUpdatedSignal.emit();
    this.animationListChangedSignal.emit();
  }

  rename_animation_library(name: string, newName: string): void {
    if (name === newName || this.libraries.has(newName)) return;
    const library = this.libraries.get(name);
    if (library === undefined) return;
    this.libraries.delete(name);
    this.libraries.set(newName, library);
    this.librariesUpdatedSignal.emit();
    this.animationListChangedSignal.emit();
  }

  has_animation_library(name: string): boolean { return this.libraries.has(name); }
  get_animation_library(name: string): GodotAnimationLibrary | null { return this.libraries.get(name) ?? null; }
  get_animation_library_list(): readonly string[] { return [...this.libraries.keys()].sort(); }

  has_animation(name: string): boolean { return this.resolveAnimation(name) !== null; }
  get_animation(name: string): AnimationClip | null { return this.resolveAnimation(name); }

  get_animation_list(): readonly string[] {
    const names: string[] = [];
    for (const [libraryName, library] of this.libraries) {
      for (const animationName of animationLibraryEntries(library).keys()) {
        names.push(libraryName === '' ? animationName : `${libraryName}/${animationName}`);
      }
    }
    return names.sort();
  }

  set_active(active: boolean): void { this.active = active; }
  is_active(): boolean { return this.active; }
  set_deterministic(deterministic: boolean): void { this.deterministic = deterministic; }
  is_deterministic(): boolean { return this.deterministic; }
  set_root_node(path: unknown): void { this.rootNode = path; }
  get_root_node(): unknown { return this.rootNode; }

  set_callback_mode_process(mode: number): void { this.callbackModeProcess = this.enumValue(mode, 0, 2, 'callback_mode_process'); }
  get_callback_mode_process(): number { return this.callbackModeProcess; }
  set_callback_mode_method(mode: number): void { this.callbackModeMethod = this.enumValue(mode, 0, 1, 'callback_mode_method'); }
  get_callback_mode_method(): number { return this.callbackModeMethod; }
  set_callback_mode_discrete(mode: number): void { this.callbackModeDiscrete = this.enumValue(mode, 0, 2, 'callback_mode_discrete'); }
  get_callback_mode_discrete(): number { return this.callbackModeDiscrete; }

  set_audio_max_polyphony(maxPolyphony: number): void {
    if (!Number.isSafeInteger(maxPolyphony) || maxPolyphony < 0) throw new RangeError('AnimationMixer audio_max_polyphony must be non-negative.');
    this.audioMaxPolyphony = maxPolyphony;
  }
  get_audio_max_polyphony(): number { return this.audioMaxPolyphony; }
  set_root_motion_track(path: unknown): void { this.rootMotionTrack = path; }
  get_root_motion_track(): unknown { return this.rootMotionTrack; }
  set_root_motion_local(enabled: boolean): void { this.rootMotionLocal = enabled; }
  is_root_motion_local(): boolean { return this.rootMotionLocal; }
  get_root_motion_position(): Readonly<{ x: number; y: number; z: number }> { return this.rootMotionPosition; }
  get_root_motion_rotation(): Readonly<{ x: number; y: number; z: number; w: number }> { return this.rootMotionRotation; }
  get_root_motion_scale(): Readonly<{ x: number; y: number; z: number }> { return this.rootMotionScale; }
  get_root_motion_position_accumulator(): Readonly<{ x: number; y: number; z: number }> { return this.rootMotionPositionAccumulator; }
  get_root_motion_rotation_accumulator(): Readonly<{ x: number; y: number; z: number; w: number }> { return this.rootMotionRotationAccumulator; }
  get_root_motion_scale_accumulator(): Readonly<{ x: number; y: number; z: number }> { return this.rootMotionScaleAccumulator; }

  clear_caches(): void {
    this.carrier.clearCaches?.();
    this.cachesClearedSignal.emit();
  }

  advance(delta: number): void {
    if (!this.active) return;
    if (!Number.isFinite(delta)) throw new TypeError('AnimationMixer.advance requires finite delta.');
    this.carrier.advance?.(delta, this);
    this.mixerUpdatedSignal.emit();
    this.mixerAppliedSignal.emit();
  }

  capture(name: string, duration: number, transType = 0, easeType = 0): void {
    if (!this.has_animation(name)) return;
    this.animationStartedSignal.emit(name);
    this.carrier.capture?.(name, duration, transType, easeType);
    if (duration <= 0) this.animationFinishedSignal.emit(name);
  }

  set_reset_on_save_enabled(enabled: boolean): void { this.resetOnSave = enabled; }
  is_reset_on_save_enabled(): boolean { return this.resetOnSave; }

  find_animation(animation: AnimationClip): string {
    for (const name of this.get_animation_list()) if (this.get_animation(name) === animation) return name;
    return '';
  }

  find_animation_library(animation: AnimationClip): string {
    for (const [name, library] of this.libraries) {
      for (const candidate of animationLibraryEntries(library).values()) if (candidate === animation) return name;
    }
    return '';
  }

  set_root_motion_state(
    position: Readonly<{ x: number; y: number; z: number }>,
    rotation: Readonly<{ x: number; y: number; z: number; w: number }>,
    scale: Readonly<{ x: number; y: number; z: number }>,
  ): void {
    this.rootMotionPosition = { ...position };
    this.rootMotionRotation = { ...rotation };
    this.rootMotionScale = { ...scale };
    this.rootMotionPositionAccumulator = { ...position };
    this.rootMotionRotationAccumulator = { ...rotation };
    this.rootMotionScaleAccumulator = { ...scale };
  }

  private resolveAnimation(name: string): AnimationClip | null {
    const separator = name.indexOf('/');
    const libraryName = separator < 0 ? '' : name.slice(0, separator);
    const animationName = separator < 0 ? name : name.slice(separator + 1);
    return this.libraries.get(libraryName)?.get_animation(animationName) ?? null;
  }

  private enumValue(value: number, minimum: number, maximum: number, member: string): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`AnimationMixer ${member} is invalid.`);
    return value;
  }
}

export function createGodotAnimationMixer(carrier: GodotAnimationMixerCarrier = {}): GodotAnimationMixer {
  return new GodotAnimationMixer(carrier);
}
