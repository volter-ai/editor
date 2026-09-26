/** Godot 3 `Listener` over the native Three world transform used by positional Web Audio. */
import { Object3D } from 'three';
import { registerGodotThreeNodeRelease } from './node-3d';
import { registerGodotObjectIdentity } from './object';

export interface GodotAudioListener3D extends Object3D {
  readonly __godotClass: 'Listener';
  make_current(): void;
  clear_current(): void;
  is_current(): boolean;
}

let currentListener: GodotAudioListener3D | null = null;

export function bindGodotAudioListener3D<T extends Object3D>(
  node: T,
): T & GodotAudioListener3D {
  const listener = node as T & GodotAudioListener3D;
  Object.defineProperties(listener, {
    __godotClass: { configurable: true, value: 'Listener' },
    make_current: { configurable: true, value: () => { currentListener = listener; } },
    clear_current: {
      configurable: true,
      value: () => { if (currentListener === listener) currentListener = null; },
    },
    is_current: { configurable: true, value: () => currentListener === listener },
  });
  registerGodotObjectIdentity(listener, 'Listener');
  registerGodotThreeNodeRelease(listener, () => {
    if (currentListener === listener) currentListener = null;
  });
  return listener;
}

export function createGodotAudioListener3D(): GodotAudioListener3D {
  return bindGodotAudioListener3D(new Object3D());
}

export function releaseGodotAudioListener3D(listener: Object3D): void {
  if (currentListener === listener) currentListener = null;
}

function listenerOf(node: Object3D): GodotAudioListener3D {
  const listener = node as Partial<GodotAudioListener3D>;
  if (listener.__godotClass !== 'Listener') {
    throw new TypeError('Listener operation requires a retained Godot Listener node.');
  }
  return listener as GodotAudioListener3D;
}

export function makeGodotAudioListener3DCurrent(listener: Object3D): void {
  listenerOf(listener).make_current();
}

export function clearGodotAudioListener3DCurrent(listener: Object3D): void {
  listenerOf(listener).clear_current();
}

export function isGodotAudioListener3DCurrent(listener: Object3D): boolean {
  return listenerOf(listener).is_current();
}

/** Resolve the active Godot listener, falling back to the Viewport's current Camera. */
export function activeGodotAudioListener3D(fallback: Object3D): Object3D {
  const listener = currentListener;
  if (listener === null) return fallback;
  let listenerRoot: Object3D = listener;
  while (listenerRoot.parent !== null) listenerRoot = listenerRoot.parent;
  let fallbackRoot: Object3D = fallback;
  while (fallbackRoot.parent !== null) fallbackRoot = fallbackRoot.parent;
  return listenerRoot === fallbackRoot ? listener : fallback;
}
