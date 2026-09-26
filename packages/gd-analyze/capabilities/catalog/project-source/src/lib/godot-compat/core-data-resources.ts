/** Small core Resource/RefCounted data carriers used by serialization and import fallbacks. */

import { registerGodotObjectIdentity } from './object';
import { bindGodotResourceProtocol } from './resource-io';

const OK = 0;
const ERR_INVALID_PARAMETER = 31;

function integerId(value: unknown): bigint {
  if (typeof value === 'bigint') return BigInt.asUintN(64, value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('EncodedObjectAsID.object_id requires non-negative int64.');
  }
  return BigInt(value);
}

export class GodotEncodedObjectAsID {
  private objectIdValue = 0n;

  constructor(id: number | bigint = 0) {
    registerGodotObjectIdentity(this, 'EncodedObjectAsID');
    this.set_object_id(id);
  }

  get object_id(): bigint { return this.objectIdValue; }
  set object_id(value: number | bigint) { this.set_object_id(value); }
  set_object_id(value: unknown): void { this.objectIdValue = integerId(value); }
  get_object_id(): bigint { return this.objectIdValue; }
}

interface MissingResourceState {
  originalClass: string;
  recording: boolean;
  readonly properties: Map<string | symbol, unknown>;
}

const MISSING_RESOURCE_STATES = new WeakMap<object, MissingResourceState>();

export class GodotMissingResource {
  constructor() {
    const state: MissingResourceState = { originalClass: '', recording: false, properties: new Map() };
    const proxy = new Proxy(this, {
      get: (target, property, receiver) => {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        return state.properties.get(property);
      },
      set: (target, property, value, receiver) => {
        if (Reflect.has(target, property)) return Reflect.set(target, property, value, receiver);
        if (state.recording) state.properties.set(property, value);
        return true;
      },
      has: (target, property) => Reflect.has(target, property) || state.properties.has(property),
      ownKeys: (target) => [...new Set([...Reflect.ownKeys(target), ...state.properties.keys()])],
      getOwnPropertyDescriptor: (target, property) =>
        Reflect.getOwnPropertyDescriptor(target, property) ??
        (state.properties.has(property) ? { configurable: true, enumerable: true, writable: true, value: state.properties.get(property) } : undefined),
    });
    MISSING_RESOURCE_STATES.set(proxy, state);
    registerGodotObjectIdentity(proxy, 'MissingResource');
    bindGodotResourceProtocol<GodotMissingResource>(proxy, {
      createDuplicate: (source) => {
        const copy = new GodotMissingResource();
        copy.set_original_class(source.get_original_class());
        copy.set_recording_properties(source.is_recording_properties());
        for (const [key, value] of source.get_recorded_properties()) Reflect.set(copy, key, value);
        return copy;
      },
    });
    return proxy;
  }

  private state(): MissingResourceState {
    const state = MISSING_RESOURCE_STATES.get(this);
    if (state === undefined) throw new Error('MissingResource state is unavailable.');
    return state;
  }

  get original_class(): string { return this.get_original_class(); }
  set original_class(value: string) { this.set_original_class(value); }
  get recording_properties(): boolean { return this.is_recording_properties(); }
  set recording_properties(value: boolean) { this.set_recording_properties(value); }

  set_original_class(value: unknown): void {
    if (typeof value !== 'string') throw new TypeError('MissingResource.original_class requires String.');
    this.state().originalClass = value;
  }

  get_original_class(): string { return this.state().originalClass; }
  set_recording_properties(enable: unknown): void { this.state().recording = Boolean(enable); }
  is_recording_properties(): boolean { return this.state().recording; }
  get_recorded_properties(): ReadonlyMap<string | symbol, unknown> { return this.state().properties; }
}

type Packable = readonly unknown[] | ReadonlyMap<unknown, unknown> | Readonly<Record<string, unknown>>;

function clonePackable(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  const cached = seen.get(value);
  if (cached !== undefined) return cached;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(clonePackable(entry, seen));
    return copy;
  }
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    seen.set(value, copy);
    for (const [key, entry] of value) copy.set(clonePackable(key, seen), clonePackable(entry, seen));
    return copy;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) copy[key] = clonePackable(entry, seen);
  return copy;
}

function packedSize(value: unknown, seen = new Set<object>()): number {
  if (value === null) return 4;
  if (typeof value === 'boolean') return 4;
  if (typeof value === 'number' || typeof value === 'bigint') return 8;
  if (typeof value === 'string') return 4 + new TextEncoder().encode(value).byteLength;
  if (typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value)) return 4 + value.reduce((size, entry) => size + packedSize(entry, seen), 0);
  if (value instanceof Map) {
    let size = 4;
    for (const [key, entry] of value) size += packedSize(key, seen) + packedSize(entry, seen);
    return size;
  }
  return 4 + Object.entries(value).reduce((size, [key, entry]) => size + packedSize(key, seen) + packedSize(entry, seen), 0);
}

export class GodotPackedDataContainerRef {
  constructor(readonly value: unknown) { registerGodotObjectIdentity(this, 'PackedDataContainerRef'); }
  size(): number {
    if (Array.isArray(this.value)) return this.value.length;
    if (this.value instanceof Map) return this.value.size;
    if (typeof this.value === 'object' && this.value !== null) return Object.keys(this.value).length;
    return 0;
  }
  get(index: unknown): unknown {
    const value = this.value;
    const result = Array.isArray(value) ? value[Number(index)] : value instanceof Map ? value.get(index) :
      typeof value === 'object' && value !== null ? Reflect.get(value, String(index)) : null;
    return result !== null && typeof result === 'object' ? new GodotPackedDataContainerRef(result) : result;
  }
}

export class GodotPackedDataContainer {
  private value: Packable | null = null;
  private byteSize = 0;

  constructor() {
    registerGodotObjectIdentity(this, 'PackedDataContainer');
    bindGodotResourceProtocol(this, { createDuplicate: (source: GodotPackedDataContainer) => {
      const copy = new GodotPackedDataContainer();
      if (source.value !== null) copy.pack(source.value);
      return copy;
    } });
  }

  pack(value: unknown): number {
    if (!Array.isArray(value) && !(value instanceof Map) && (typeof value !== 'object' || value === null)) {
      return ERR_INVALID_PARAMETER;
    }
    this.value = clonePackable(value) as Packable;
    this.byteSize = packedSize(this.value);
    return OK;
  }

  size(): number { return this.byteSize; }
  get(index: unknown): unknown { return this.value === null ? null : new GodotPackedDataContainerRef(this.value).get(index); }
}

export const createGodotEncodedObjectAsID = (): GodotEncodedObjectAsID => new GodotEncodedObjectAsID();
export const createGodotMissingResource = (): GodotMissingResource => new GodotMissingResource();
export const createGodotPackedDataContainer = (): GodotPackedDataContainer => new GodotPackedDataContainer();
