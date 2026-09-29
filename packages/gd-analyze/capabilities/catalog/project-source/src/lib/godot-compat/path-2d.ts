/**
 * @godot-class Path2D
 * @role BINDING
 *
 * Godot 4.7's `Path2D` (`scene/2d/path_2d.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * a Node2D holding a Curve2D its PathFollow2D children follow. Its curve is drawn only in the editor.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import type { Curve2D } from './curve-2d';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt, godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['Path2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];
const CURVES = new WeakMap<object, Curve2D | null>();

/**
 * @godot Path2D (protocol)
 * @source scene/2d/path_2d.cpp:190
 */
export function godot_path_2d_mount(entity: Object3D): void {
  godot_node_2d_mount(entity, CLASSES);
  CURVES.set(entity, null);
}

/**
 * @godot Path2D.Path2D
 * @source scene/2d/path_2d.cpp:190
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_path_2d_mount(entity);
  return entity;
}

/**
 * @godot Path2D.set_curve
 * @source scene/2d/path_2d.cpp:157
 */
export function set_curve(self: object, curve: Curve2D | null): void {
  CURVES.set(godot_node_entity(self), curve);
}

/**
 * @godot Path2D.get_curve
 * @source scene/2d/path_2d.cpp:175
 */
export function get_curve(self: object): Curve2D | null {
  return CURVES.get(godot_node_entity(self)) ?? null;
}

/**
 * Whether an entity is a Path2D (a PathFollow2D follows its parent's curve).
 *
 * @godot Path2D (protocol)
 * @source scene/2d/path_2d.cpp:215
 */
export function godot_path_2d_curve(entity: object): Curve2D | null | undefined {
  return CURVES.get(entity);
}

const PATH_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_path_2d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([...godot_node_2d_props(), ['curve', (entity, value: Curve2D | null) => set_curve(entity, value)]]),
};

/**
 * A Path2D as a scene writes it: `<GodotPath2D curve={curve} />`.
 *
 * @godot Path2D (protocol)
 * @source scene/2d/path_2d.cpp:190
 */
export function GodotPath2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(PATH_2D, props);
}
