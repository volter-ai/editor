/**
 * @godot-class CSGBox3D
 * @role BINDING
 *
 * Godot 4.7's `CSGBox3D` (`modules/csg/csg_shape.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) standing alone, as a three box mesh: its `size`
 * (1, 1, 1 by default, `csg_shape.h:290`) is the box's geometry, and with no material it draws with
 * the Compatibility renderer's default material (`rasterizer_scene_gles3.cpp:4628`: `ALBEDO` 0.6, a
 * shader literal and so linear, roughness 0.8, metallic 0.2), as a mesh without one does. A scene writes the node as `<GodotCSGBox3D>`.
 */

import type { ReactElement } from 'react';
import { BoxGeometry, Color, Mesh, MeshStandardMaterial } from 'three';
import { type GodotElementClass, type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector3, type Vector3 } from './vector3';

const SIZE = new WeakMap<object, Vector3>();

/**
 * @godot CSGBox3D.set_size
 * @source modules/csg/csg_shape.cpp:1831
 */
export function set_size(self: object, size: Vector3): void {
  SIZE.set(self, vector3(size.x, size.y, size.z));
  const mesh = self as Mesh;
  mesh.geometry.dispose();
  mesh.geometry = new BoxGeometry(size.x, size.y, size.z);
}

/**
 * @godot CSGBox3D.get_size
 * @source modules/csg/csg_shape.cpp:1837
 */
export function get_size(self: object): Vector3 {
  return SIZE.get(self) ?? vector3(1, 1, 1);
}

const CSG_BOX_3D: GodotElementClass<Mesh> = {
  create: () => new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: new Color(0.6, 0.6, 0.6), roughness: 0.8, metalness: 0.2 })),
  classes: ['CSGBox3D', 'CSGPrimitive3D', 'CSGShape3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: (entity) => {
    entity.receiveShadow = true;
    entity.castShadow = true;
  },
  props: new Map<string, GodotElementProp<Mesh>>([['size', (self, value: readonly [number, number, number]) => set_size(self, vector3(...value))]]),
};

/**
 * A CSGBox3D as a scene writes it (`csg_shape.cpp:1820`: its properties): a box mesh of its size.
 *
 * @godot CSGBox3D (protocol)
 * @source modules/csg/csg_shape.cpp:1820
 */
export function GodotCSGBox3D(props: GodotElementProps<Mesh>): ReactElement {
  return useGodotElement(CSG_BOX_3D, props);
}
