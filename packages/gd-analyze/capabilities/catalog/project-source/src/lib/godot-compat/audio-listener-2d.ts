/** Godot 4 AudioListener2D over the retained Pixi world transform used by positional Web Audio. */

import { Container } from 'pixi.js';
import { registerCanvasNodeRelease } from './node';
import { registerGodotObjectIdentity } from './object';

export interface GodotAudioListener2D extends Container {
  readonly __godotClass: 'AudioListener2D';
  make_current(): void;
  clear_current(): void;
  is_current(): boolean;
}

let currentListener: GodotAudioListener2D | null = null;

export function bindAudioListener2D<T extends Container>(node: T): T & GodotAudioListener2D {
  const listener = node as T & GodotAudioListener2D;
  Object.assign(listener, {
    make_current(): void {
      currentListener = listener;
    },
    clear_current(): void {
      if (currentListener === listener) currentListener = null;
    },
    is_current(): boolean {
      return currentListener === listener;
    },
  });
  registerGodotObjectIdentity(listener, 'AudioListener2D');
  registerCanvasNodeRelease(listener, () => {
    if (currentListener === listener) currentListener = null;
  });
  return listener;
}

export function createGodotAudioListener2D(): GodotAudioListener2D {
  return bindAudioListener2D(new Container());
}

/** Resolve only a live listener belonging to this mounted canvas root. */
export function activeAudioListener2DCenter(
  root: Container,
): { readonly x: number; readonly y: number } | null {
  const listener = currentListener;
  if (listener === null) return null;
  let ancestor: Container | null = listener;
  while (ancestor !== null && ancestor !== root) ancestor = ancestor.parent;
  if (ancestor !== root) return null;
  return { x: listener.worldTransform.tx, y: listener.worldTransform.ty };
}
