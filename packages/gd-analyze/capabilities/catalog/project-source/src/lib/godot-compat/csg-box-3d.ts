/**
 * @godot-class CSGBox3D
 * @role BINDING
 *
 * Godot 4.7's `CSGBox3D` (`modules/csg/csg_shape.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) standing alone, as a three box mesh: its `size`
 * (1, 1, 1 by default, `csg_shape.h:290`) is the box's geometry, and with no material it draws with
 * the Compatibility renderer's default material (`rasterizer_scene_gles3.cpp:4628`: `ALBEDO` 0.6,
 * which the scene shader decodes from sRGB like any albedo, `scene.glsl:2398`; roughness 0.8,
 * metallic 0.2), as a mesh without one does. With `use_collision` it is also a fixed body with a
 * cuboid collider of its size, as `@react-three/rapier` writes a static box. A scene writes the node
 * as `<GodotCSGBox3D>`.
 */

import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { createElement, type ReactElement } from 'react';
import { BoxGeometry, Color, type Material, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three';
import { type BaseMaterial3D, godot_base_material_3d_three } from './base-material-3d';
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

const MATERIALS = new WeakMap<object, BaseMaterial3D | null>();
const COLLIDING = new WeakMap<object, boolean>();

/**
 * @godot CSGBox3D.set_material
 * @source modules/csg/csg_shape.cpp:1681
 */
export function set_material(self: object, material: BaseMaterial3D | null): void {
  MATERIALS.set(self, material);
  if (material !== null) (self as Mesh).material = godot_base_material_3d_three(material);
}

/**
 * @godot CSGBox3D.get_material
 * @source modules/csg/csg_shape.cpp:1687
 */
export function get_material(self: object): BaseMaterial3D | null {
  return MATERIALS.get(self) ?? null;
}

/**
 * Whether the shape is a static body too; the collider is its element's (`GodotCSGBox3D`).
 *
 * @godot CSGShape3D.set_use_collision
 * @source modules/csg/csg_shape.cpp:85
 */
export function set_use_collision(self: object, enable: boolean): void {
  COLLIDING.set(self, enable);
}

/**
 * @godot CSGShape3D.is_using_collision
 * @source modules/csg/csg_shape.cpp:116
 */
export function is_using_collision(self: object): boolean {
  return COLLIDING.get(self) ?? false;
}

const CSG_BOX_3D: GodotElementClass<Mesh> = {
  create: () => new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: new Color().setRGB(0.6, 0.6, 0.6, SRGBColorSpace), roughness: 0.8, metalness: 0.2 })),
  classes: ['CSGBox3D', 'CSGPrimitive3D', 'CSGShape3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'],
  spatial: true,
  mount: (entity) => {
    entity.receiveShadow = true;
    entity.castShadow = true;
  },
  props: new Map<string, GodotElementProp<Mesh>>([
    ['size', (self, value: readonly [number, number, number]) => set_size(self, vector3(...value))],
    // The scene's material is three's already (`scene-family-elements.ts`), drawn as it is.
    ['material', (self, value: Material) => {
      self.material = value;
    }],
    ['useCollision', (self, value: boolean) => set_use_collision(self, value)],
  ]),
};

/**
 * A CSGBox3D as a scene writes it (`csg_shape.cpp:1820`: its properties): a box mesh of its size.
 *
 * @godot CSGBox3D (protocol)
 * @source modules/csg/csg_shape.cpp:1820
 */
export function GodotCSGBox3D(props: GodotElementProps<Mesh>): ReactElement {
  const size = (props['size'] as readonly [number, number, number] | undefined) ?? [1, 1, 1];
  const collider =
    props['useCollision'] === true
      ? createElement(RigidBody, { type: 'fixed', colliders: false }, createElement(CuboidCollider, { args: [size[0] / 2, size[1] / 2, size[2] / 2] }))
      : null;
  return useGodotElement(CSG_BOX_3D, collider === null ? props : { ...props, children: [props.children, collider] });
}
