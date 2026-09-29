/**
 * @godot-class CollisionShape2D
 * @role BINDING
 *
 * Godot 4.7's `CollisionShape2D` (`scene/2d/physics/collision_shape_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node2D holding the shape its parent
 * CollisionObject2D is picked by (`collision-object-2d.ts`).
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_collision_object_2d_set_disabled, godot_collision_object_2d_set_shape, godot_collision_object_2d_shape_mount, godot_collision_object_2d_shape_of } from './collision-object-2d';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['CollisionShape2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

/**
 * @godot CollisionShape2D (protocol)
 * @source scene/2d/physics/collision_shape_2d.cpp:245
 */
export function godot_collision_shape_2d_mount(entity: Object3D): void {
  godot_node_2d_mount(entity, CLASSES);
  godot_collision_object_2d_shape_mount(entity);
}

/**
 * @godot CollisionShape2D.set_shape
 * @source scene/2d/physics/collision_shape_2d.cpp:150
 */
export function set_shape(self: object, shape: object | null): void {
  godot_collision_object_2d_set_shape(self, shape);
}

/**
 * @godot CollisionShape2D.get_shape
 * @source scene/2d/physics/collision_shape_2d.cpp:180
 */
export function get_shape(self: object): object | null {
  return godot_collision_object_2d_shape_of(self);
}

/**
 * @godot CollisionShape2D.set_disabled
 * @source scene/2d/physics/collision_shape_2d.cpp:195
 */
export function set_disabled(self: object, disabled: boolean): void {
  godot_collision_object_2d_set_disabled(self, disabled);
}

const COLLISION_SHAPE_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_collision_shape_2d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['shape', (entity, value: object | null) => set_shape(entity, value)],
    ['disabled', (entity, value: boolean) => set_disabled(entity, value)],
  ]),
};

/**
 * A CollisionShape2D as a scene writes it: `<GodotCollisionShape2D shape={rectangle} />`.
 *
 * @godot CollisionShape2D (protocol)
 * @source scene/2d/physics/collision_shape_2d.cpp:245
 */
export function GodotCollisionShape2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(COLLISION_SHAPE_2D, props);
}
