/**
 * @godot-class SubViewport
 * @role PROTOCOL
 *
 * Godot 4.7's `SubViewport.size`, at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`. The
 * receiver is the `THREE.Scene` that holds the viewport's 3D world: a Node3D's viewport is its
 * topmost three ancestor. The pixel size is Godot state no three object holds (the host renders
 * the scene at whatever size its canvas has), so it lives in `SIZE`, keyed by the Scene; an unset
 * viewport has Godot's default `Size2i(512, 512)` (`scene/main/viewport.h:262`).
 */

import type { Object3D } from 'three';
import { construct as vector2i, type Vector2i } from './vector2i';

const SIZE = new WeakMap<Object3D, Vector2i>();
const SIZE_CHANGED = new WeakMap<Object3D, Set<() => void>>();

/**
 * Stores `p_size.maxi(2)`, each component at least 2 (`Viewport::_set_size`,
 * `scene/main/viewport.cpp:1153`); Godot then resizes the render target, which the host does for
 * its own canvas.
 *
 * @godot SubViewport.set_size
 * @source scene/main/viewport.cpp:5611
 */
export function set_size(self: Object3D, p_size: Vector2i): void {
  const size = vector2i(Math.max(p_size.x, 2), Math.max(p_size.y, 2));
  const previous = SIZE.get(self) ?? vector2i(512, 512);
  SIZE.set(self, size);
  // A changed size emits `size_changed` (`viewport.cpp:1188`).
  if (previous.x === size.x && previous.y === size.y) return;
  for (const listener of [...(SIZE_CHANGED.get(self) ?? [])]) listener();
}

/**
 * Connects `listener` to the SubViewport's `size_changed`, as a root Control inside it does on
 * entering the canvas (`control.cpp:4577`); the returned call disconnects it.
 *
 * @godot SubViewport (protocol)
 * @source scene/main/viewport.cpp:1188
 */
export function godot_sub_viewport_connect_size_changed(self: Object3D, listener: () => void): () => void {
  const listeners = SIZE_CHANGED.get(self) ?? new Set<() => void>();
  SIZE_CHANGED.set(self, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * @godot SubViewport.get_size
 * @source scene/main/viewport.cpp:5640
 */
export function get_size(self: Object3D): Vector2i {
  return SIZE.get(self) ?? vector2i(512, 512);
}
