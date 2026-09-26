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

/**
 * Stores `p_size.maxi(2)`, each component at least 2 (`Viewport::_set_size`,
 * `scene/main/viewport.cpp:1153`); Godot then resizes the render target, which the host does for
 * its own canvas.
 *
 * @godot SubViewport.set_size
 * @source scene/main/viewport.cpp:5611
 */
export function set_size(self: Object3D, p_size: Vector2i): void {
  SIZE.set(self, vector2i(Math.max(p_size.x, 2), Math.max(p_size.y, 2)));
}

/**
 * @godot SubViewport.get_size
 * @source scene/main/viewport.cpp:5640
 */
export function get_size(self: Object3D): Vector2i {
  return SIZE.get(self) ?? vector2i(512, 512);
}
