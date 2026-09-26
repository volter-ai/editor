import { Color, Euler, Matrix3, Matrix4, Quaternion, Vector2, Vector3, Vector4 } from 'three';
import { registerGodotObjectIdentity } from './object';

export interface GodotAnimationMixerBackupEntry {
  readonly path: string;
  readonly value: unknown;
}

export interface GodotAnimationMixerPlaybackSnapshot {
  readonly active: boolean;
  readonly deterministic: boolean;
  readonly rootMotionTrack: string;
  readonly callbackModeProcess: number;
  readonly callbackModeMethod: number;
  readonly callbackModeDiscrete: number;
  readonly audioMaxPolyphony: number;
}

export interface GodotAnimationMixerBackupTarget {
  getProperty(path: string): unknown;
  setProperty(path: string, value: unknown): void;
  getPlaybackState?(): GodotAnimationMixerPlaybackSnapshot;
  setPlaybackState?(state: GodotAnimationMixerPlaybackSnapshot): void;
  beginRestore?(): void;
  endRestore?(): void;
}

function path(value: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('AnimationMixerBackup path requires nonempty NodePath.');
  return value;
}

function cloneValue(value: unknown): unknown {
  if (value instanceof Vector2 || value instanceof Vector3 || value instanceof Vector4 ||
      value instanceof Quaternion || value instanceof Euler || value instanceof Color ||
      value instanceof Matrix3 || value instanceof Matrix4) return value.clone();
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof Int8Array) return Int8Array.from(value);
  if (value instanceof Uint16Array) return Uint16Array.from(value);
  if (value instanceof Int16Array) return Int16Array.from(value);
  if (value instanceof Uint32Array) return Uint32Array.from(value);
  if (value instanceof Int32Array) return Int32Array.from(value);
  if (value instanceof Float32Array) return Float32Array.from(value);
  if (value instanceof Float64Array) return Float64Array.from(value);
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [cloneValue(key), cloneValue(item)]));
  if (value instanceof Set) return new Set([...value].map(cloneValue));
  if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype === Object.prototype || prototype === null) {
      const copy: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) copy[key] = cloneValue(item);
      return copy;
    }
  }
  return value;
}

function playback(value: GodotAnimationMixerPlaybackSnapshot): GodotAnimationMixerPlaybackSnapshot {
  if (typeof value.active !== 'boolean' || typeof value.deterministic !== 'boolean') {
    throw new TypeError('AnimationMixerBackup playback active/deterministic require bool.');
  }
  if (typeof value.rootMotionTrack !== 'string') throw new TypeError('AnimationMixerBackup root_motion_track requires NodePath.');
  const numbers = [value.callbackModeProcess, value.callbackModeMethod, value.callbackModeDiscrete, value.audioMaxPolyphony];
  if (!numbers.every(Number.isSafeInteger)) throw new TypeError('AnimationMixerBackup playback modes require integers.');
  return { ...value };
}

export class GodotAnimationMixerBackup {
  private readonly values = new Map<string, unknown>();
  private playbackState: GodotAnimationMixerPlaybackSnapshot | null = null;
  private target: GodotAnimationMixerBackupTarget | null = null;

  constructor(target: GodotAnimationMixerBackupTarget | null = null) {
    this.target = target;
    registerGodotObjectIdentity(this, 'AnimationMixerBackup');
  }

  bind_target(value: GodotAnimationMixerBackupTarget | null): void { this.target = value; }
  get_target(): GodotAnimationMixerBackupTarget | null { return this.target; }

  capture(paths: Iterable<string>): void {
    const target = this.requireTarget();
    this.values.clear();
    for (const propertyPath of paths) {
      const key = path(propertyPath);
      this.values.set(key, cloneValue(target.getProperty(key)));
    }
    const state = target.getPlaybackState?.();
    this.playbackState = state === undefined ? null : playback(state);
  }

  capture_property(propertyPath: string): void {
    const key = path(propertyPath);
    this.values.set(key, cloneValue(this.requireTarget().getProperty(key)));
  }

  capture_value(propertyPath: string, value: unknown): void {
    this.values.set(path(propertyPath), cloneValue(value));
  }

  capture_playback_state(value?: GodotAnimationMixerPlaybackSnapshot): void {
    const state = value ?? this.requireTarget().getPlaybackState?.();
    if (state === undefined) throw new Error('AnimationMixerBackup target exposes no playback state.');
    this.playbackState = playback(state);
  }

  restore(): void {
    const target = this.requireTarget();
    target.beginRestore?.();
    try {
      for (const [propertyPath, value] of this.values) target.setProperty(propertyPath, cloneValue(value));
      if (this.playbackState !== null) target.setPlaybackState?.({ ...this.playbackState });
    } finally {
      target.endRestore?.();
    }
  }

  restore_property(propertyPath: string): boolean {
    const key = path(propertyPath);
    if (!this.values.has(key)) return false;
    this.requireTarget().setProperty(key, cloneValue(this.values.get(key)));
    return true;
  }

  refresh(): void {
    const target = this.requireTarget();
    for (const key of this.values.keys()) this.values.set(key, cloneValue(target.getProperty(key)));
    const state = target.getPlaybackState?.();
    if (state !== undefined) this.playbackState = playback(state);
  }

  erase_property(propertyPath: string): boolean { return this.values.delete(path(propertyPath)); }
  has_property(propertyPath: string): boolean { return this.values.has(path(propertyPath)); }
  get_property(propertyPath: string): unknown { return cloneValue(this.values.get(path(propertyPath))); }
  get_property_list(): string[] { return [...this.values.keys()]; }
  get_entries(): GodotAnimationMixerBackupEntry[] {
    return [...this.values].map(([propertyPath, value]) => ({ path: propertyPath, value: cloneValue(value) }));
  }
  get_playback_state(): GodotAnimationMixerPlaybackSnapshot | null {
    return this.playbackState === null ? null : { ...this.playbackState };
  }
  clear(): void { this.values.clear(); this.playbackState = null; }
  is_empty(): boolean { return this.values.size === 0 && this.playbackState === null; }
  size(): number { return this.values.size; }

  duplicate(): GodotAnimationMixerBackup {
    const copy = new GodotAnimationMixerBackup(this.target);
    for (const [propertyPath, value] of this.values) copy.values.set(propertyPath, cloneValue(value));
    copy.playbackState = this.playbackState === null ? null : { ...this.playbackState };
    return copy;
  }

  private requireTarget(): GodotAnimationMixerBackupTarget {
    if (this.target === null) throw new Error('AnimationMixerBackup requires a bound AnimationMixer target.');
    return this.target;
  }
}

export const createGodotAnimationMixerBackup = (target: GodotAnimationMixerBackupTarget | null = null): GodotAnimationMixerBackup => new GodotAnimationMixerBackup(target);
