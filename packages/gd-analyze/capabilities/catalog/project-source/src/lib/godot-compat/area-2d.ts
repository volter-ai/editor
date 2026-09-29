/**
 * @godot-class Area2D
 * @role BINDING
 *
 * Godot 4.7's `Area2D` (`scene/2d/physics/area_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as a Node2D its CollisionShape2D children make
 * pickable by the mouse (`collision-object-2d.ts`). Overlap with physics bodies and areas is not
 * bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_collision_object_2d_mount } from './collision-object-2d';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['Area2D', 'CollisionObject2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

/**
 * Makes `entity` an Area2D: a Node2D, pickable (`Area2D::Area2D` sets `input_pickable`).
 *
 * @godot Area2D (protocol)
 * @source scene/2d/physics/area_2d.cpp:640
 */
export function godot_area_2d_mount(entity: Object3D): void {
  godot_node_2d_mount(entity, CLASSES);
  godot_collision_object_2d_mount(entity, true);
}

/**
 * A new Area2D (`Area2D.new()`).
 *
 * @godot Area2D.Area2D
 * @source scene/2d/physics/area_2d.cpp:640
 */
export function construct(): Group {
  const entity = new Group();
  godot_area_2d_mount(entity);
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  return entity;
}

const AREA_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_area_2d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    // The physics layers and monitoring are the physics space's, which is not bound.
    ['collisionLayer', () => undefined],
    ['collisionMask', () => undefined],
    ['monitoring', () => undefined],
    ['monitorable', () => undefined],
  ]),
};

/**
 * An Area2D as a scene writes it: `<GodotArea2D scale={[0.5, 0.5]} />`.
 *
 * @godot Area2D (protocol)
 * @source scene/2d/physics/area_2d.cpp:640
 */
export function GodotArea2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(AREA_2D, props);
}
