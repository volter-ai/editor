/**
 * @godot-class Path3D
 * @role BINDING
 *
 * Godot 4.7's `Path3D` (`scene/3d/path_3d.cpp`, revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`):
 * a Node3D holding a Curve3D its PathFollow3D children follow. Its curve is drawn only in the editor.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import type { Curve3D } from './curve-3d';
import { godot_node_adopt, godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['Path3D', 'Node3D', 'Node', 'Object'];
const CURVES = new WeakMap<object, Curve3D | null>();

/**
 * @godot Path3D (protocol)
 * @source scene/3d/path_3d.cpp:219
 */
export function godot_path_3d_mount(entity: Object3D): void {
  CURVES.set(entity, null);
}

/**
 * @godot Path3D.Path3D
 * @source scene/3d/path_3d.cpp:219
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'spatial', classes: CLASSES });
  godot_path_3d_mount(entity);
  return entity;
}

/**
 * @godot Path3D.set_curve
 * @source scene/3d/path_3d.cpp:180
 */
export function set_curve(self: object, curve: Curve3D | null): void {
  CURVES.set(godot_node_entity(self), curve);
}

/**
 * @godot Path3D.get_curve
 * @source scene/3d/path_3d.cpp:199
 */
export function get_curve(self: object): Curve3D | null {
  return CURVES.get(godot_node_entity(self)) ?? null;
}

/**
 * The curve of a Path3D, for its followers.
 *
 * @godot Path3D (protocol)
 * @source scene/3d/path_3d.cpp:240
 */
export function godot_path_3d_curve(entity: object): Curve3D | null | undefined {
  return CURVES.get(entity);
}

const PATH_3D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: true,
  mount: godot_path_3d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([['curve', (entity, value: Curve3D | null) => set_curve(entity, value)]]),
};

/**
 * A Path3D as a scene writes it: `<GodotPath3D curve={curve} />`.
 *
 * @godot Path3D (protocol)
 * @source scene/3d/path_3d.cpp:219
 */
export function GodotPath3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(PATH_3D, props);
}
