/**
 * @godot-class StaticBody2D
 * @role BINDING
 *
 * Godot 4.7's `StaticBody2D` (`scene/2d/physics/static_body_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a body that does not move by itself, which moving
 * bodies collide with (`collision-object-2d.ts`). Its constant velocities are stored.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_collision_object_2d_mount, set_collision_layer, set_collision_mask } from './collision-object-2d';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['StaticBody2D', 'PhysicsBody2D', 'CollisionObject2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

/**
 * @godot StaticBody2D (protocol)
 * @source scene/2d/physics/static_body_2d.cpp:95
 */
export function godot_static_body_2d_mount(entity: Object3D): void {
  godot_node_2d_mount(entity, CLASSES);
  godot_collision_object_2d_mount(entity, 'static', false);
}

/**
 * @godot StaticBody2D.StaticBody2D
 * @source scene/2d/physics/static_body_2d.cpp:95
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_static_body_2d_mount(entity);
  return entity;
}

const STATIC_BODY_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_static_body_2d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['collisionLayer', (entity, value: number) => set_collision_layer(entity, value)],
    ['collisionMask', (entity, value: number) => set_collision_mask(entity, value)],
    ['physicsMaterialOverride', () => undefined],
    ['constantLinearVelocity', () => undefined],
    ['constantAngularVelocity', () => undefined],
  ]),
};

/**
 * A StaticBody2D as a scene writes it: `<GodotStaticBody2D collisionLayer={1} />`.
 *
 * @godot StaticBody2D (protocol)
 * @source scene/2d/physics/static_body_2d.cpp:95
 */
export function GodotStaticBody2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(STATIC_BODY_2D, props);
}
