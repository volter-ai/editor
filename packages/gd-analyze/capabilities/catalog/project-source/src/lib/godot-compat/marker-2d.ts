/**
 * @godot-class Marker2D
 * @role BINDING
 *
 * Godot 4.7's `Marker2D` (`scene/2d/marker_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node2D marking a place; its cross is drawn only in
 * the editor, so on the page it draws nothing.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['Marker2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];
const EXTENTS = new WeakMap<object, number>();

/**
 * @godot Marker2D (protocol)
 * @source scene/2d/marker_2d.cpp:117
 */
export function godot_marker_2d_mount(entity: Object3D): void {
  godot_node_2d_mount(entity, CLASSES);
  EXTENTS.set(entity, 10);
}

/**
 * @godot Marker2D.Marker2D
 * @source scene/2d/marker_2d.cpp:117
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_marker_2d_mount(entity);
  return entity;
}

/**
 * @godot Marker2D.set_gizmo_extents
 * @source scene/2d/marker_2d.cpp:98
 */
export function set_gizmo_extents(self: Object3D, extents: number): void {
  EXTENTS.set(self, extents);
}

/**
 * @godot Marker2D.get_gizmo_extents
 * @source scene/2d/marker_2d.cpp:107
 */
export function get_gizmo_extents(self: Object3D): number {
  return EXTENTS.get(self) ?? 10;
}

const MARKER_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_marker_2d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([...godot_node_2d_props(), ['gizmoExtents', (entity, value: number) => set_gizmo_extents(entity, value)]]),
};

/**
 * A Marker2D as a scene writes it: `<GodotMarker2D position={[240, 450]} />`.
 *
 * @godot Marker2D (protocol)
 * @source scene/2d/marker_2d.cpp:117
 */
export function GodotMarker2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(MARKER_2D, props);
}
