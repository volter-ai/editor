/**
 * @godot-class Marker3D
 * @role BINDING
 *
 * Godot 4.7's `Marker3D` (`scene/3d/marker_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node3D (a three group) with the size of its editor
 * gizmo, which no game draws. The extents live in `EXTENTS`, keyed by the entity.
 */

import type { Object3D } from 'three';
import { godot_node_duplicate_state } from './node';
import './node-3d';

const f32 = Math.fround;
const EXTENTS = new WeakMap<Object3D, number>();

godot_node_duplicate_state('Marker3D', (from, to) => {
  const extents = EXTENTS.get(from as Object3D);
  if (extents !== undefined) EXTENTS.set(to as Object3D, extents);
});

/**
 * The value is stored as `real_t`.
 *
 * @godot Marker3D.set_gizmo_extents
 * @source scene/3d/marker_3d.cpp:35
 */
export function set_gizmo_extents(self: Object3D, extents: number): void {
  EXTENTS.set(self, f32(extents));
}

/**
 * 0.25 until set (`marker_3d.h`).
 *
 * @godot Marker3D.get_gizmo_extents
 * @source scene/3d/marker_3d.cpp:43
 */
export function get_gizmo_extents(self: Object3D): number {
  return EXTENTS.get(self) ?? f32(0.25);
}
