/**
 * @godot-class Marker3D
 * @role BINDING
 *
 * Godot 4.7's `Marker3D` (`scene/3d/marker_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node3D (a three group) with the size of its editor
 * gizmo, which no game draws. The extents live in `EXTENTS`, keyed by the entity. A scene declares
 * one as the `<GodotMarker3D>` element, a group with the extents as a prop.
 */

import type { ThreeElements } from '@react-three/fiber';
import { createElement, type Ref, useLayoutEffect, useRef } from 'react';
import type { Group, Object3D } from 'three';
import { godot_node_class_reader, godot_node_duplicate_state } from './node';
import './node-3d';

const f32 = Math.fround;
const EXTENTS = new WeakMap<Object3D, number>();
const MARKERS = new WeakSet<object>();
const MARKER_3D = Object.freeze(['Marker3D', 'Node3D', 'Node', 'Object']);
godot_node_class_reader((entity) => (MARKERS.has(entity) ? MARKER_3D : undefined));

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

/** A `<GodotMarker3D>`'s props: a group's, and its gizmo's extents. */
export type GodotMarker3DProps = Omit<ThreeElements['group'], 'ref'> & { readonly ref?: Ref<Group>; readonly gizmoExtents?: number };

/**
 * A Marker3D as a scene declares it: a group registered as the marker, with its gizmo's extents.
 *
 * @godot Marker3D (protocol)
 * @source scene/3d/marker_3d.cpp:54
 */
export function GodotMarker3D({ ref, gizmoExtents, ...group }: GodotMarker3DProps) {
  const own = useRef<Group>(null);
  useLayoutEffect(() => {
    const entity = own.current as Group;
    MARKERS.add(entity);
    if (gizmoExtents !== undefined) set_gizmo_extents(entity, gizmoExtents);
  }, []);
  const refs = (value: Group | null) => {
    own.current = value;
    if (typeof ref === 'function') ref(value);
    else if (ref !== undefined && ref !== null) (ref as { current: Group | null }).current = value;
  };
  return createElement('group', { ...group, ref: refs });
}
