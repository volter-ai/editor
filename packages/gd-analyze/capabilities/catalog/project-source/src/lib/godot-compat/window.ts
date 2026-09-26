/**
 * @godot-class Window
 * @role BINDING
 *
 * Godot 4.7's root `Window` (`scene/main/window.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto the page element the game draws in: the
 * root window's size is that element's size in CSS pixels, which the host sets when it mounts the
 * game and whenever the element is resized (the web display server's canvas size,
 * `platform/web/display_server_web.cpp`). The receiver is the tree's root entity.
 */

import type { Object3D } from 'three';
import { construct as vector2i, type Vector2i } from './vector2i';

const SIZES = new WeakMap<Object3D, Vector2i>();
const SIZE_CHANGED = new WeakMap<Object3D, Set<() => void>>();

/**
 * Stores the window's size as the host reads it from the page (`Window::set_size`,
 * `window.cpp:413`, with the size the display server gives); a script's own `set_size` on the root
 * window is the platform's to honour and is not bound. A size that differs from the stored one
 * emits the viewport's `size_changed` (`Viewport::_set_size`, `viewport.cpp:1188`), after the
 * floor of 2 (`viewport.cpp:1154`).
 *
 * @godot Window (protocol)
 * @source scene/main/window.cpp:413
 */
export function godot_window_set_size(self: Object3D, p_size: Vector2i): void {
  const size = vector2i(Math.max(p_size.x, 2), Math.max(p_size.y, 2));
  const previous = SIZES.get(self);
  SIZES.set(self, size);
  if (previous !== undefined && previous.x === size.x && previous.y === size.y) return;
  for (const listener of [...(SIZE_CHANGED.get(self) ?? [])]) listener();
}

/**
 * Connects `listener` to the window's `size_changed`, as a root Control connects its
 * `_size_changed` on entering the canvas (`control.cpp:4577`); the returned call disconnects it
 * (`NOTIFICATION_EXIT_CANVAS`, `control.cpp:4589`).
 *
 * @godot Window (protocol)
 * @source scene/main/viewport.cpp:1188
 */
export function godot_window_connect_size_changed(self: Object3D, listener: () => void): () => void {
  const listeners = SIZE_CHANGED.get(self) ?? new Set<() => void>();
  SIZE_CHANGED.set(self, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The window's size; before the host sets one, `DEFAULT_WINDOW_SIZE` squared (`window.h:104`).
 *
 * @godot Window.get_size
 * @source scene/main/window.cpp:427
 */
export function get_size(self: Object3D): Vector2i {
  return SIZES.get(self) ?? vector2i(100, 100);
}

/**
 * Whether `entity` is a window whose size the host set (the root viewport).
 *
 * @godot Window (protocol)
 * @source scene/main/viewport.cpp:1238
 */
export function godot_window_has_size(entity: Object3D): boolean {
  return SIZES.has(entity);
}
