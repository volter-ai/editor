/**
 * @godot-class Area2D
 * @role BINDING
 *
 * Godot 4.7's `Area2D` (`scene/2d/physics/area_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node2D its CollisionShape2D children make
 * pickable by the mouse and, each physics step, report the bodies and areas they overlap
 * (`collision-object-2d.ts`). Gravity and damping overrides are not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { type GodotSignal } from './signal';
import { godot_collision_object_2d_mount, godot_physics_2d_area_step, godot_physics_2d_monitoring, godot_physics_2d_overlapping, godot_physics_2d_set_monitorable, godot_physics_2d_set_monitoring, godot_physics_2d_signal, set_collision_layer, set_collision_mask } from './collision-object-2d';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt, godot_node_set_internal_physics } from './node';
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
  godot_collision_object_2d_mount(entity, 'area', true);
  godot_node_set_internal_physics(entity, () => godot_physics_2d_area_step(entity));
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

/**
 * @godot Area2D.set_monitoring
 * @source scene/2d/physics/area_2d.cpp:376
 */
export function set_monitoring(self: object, enable: boolean): void {
  godot_physics_2d_set_monitoring(self, enable);
}

/**
 * @godot Area2D.is_monitoring
 * @source scene/2d/physics/area_2d.cpp:386
 */
export function is_monitoring(self: object): boolean {
  return godot_physics_2d_monitoring(self);
}

/**
 * @godot Area2D.set_monitorable
 * @source scene/2d/physics/area_2d.cpp:398
 */
export function set_monitorable(self: object, enable: boolean): void {
  godot_physics_2d_set_monitorable(self, enable);
}

/**
 * @godot Area2D.get_overlapping_bodies
 * @source scene/2d/physics/area_2d.cpp:420
 */
export function get_overlapping_bodies(self: object): object[] {
  return godot_physics_2d_overlapping(self, false);
}

/**
 * @godot Area2D.get_overlapping_areas
 * @source scene/2d/physics/area_2d.cpp:434
 */
export function get_overlapping_areas(self: object): object[] {
  return godot_physics_2d_overlapping(self, true);
}

/**
 * @godot Area2D.has_overlapping_bodies
 * @source scene/2d/physics/area_2d.cpp:448
 */
export function has_overlapping_bodies(self: object): boolean {
  return godot_physics_2d_overlapping(self, false).length > 0;
}

/**
 * @godot Area2D.has_overlapping_areas
 * @source scene/2d/physics/area_2d.cpp:453
 */
export function has_overlapping_areas(self: object): boolean {
  return godot_physics_2d_overlapping(self, true).length > 0;
}

/**
 * @godot Area2D.body_entered
 * @source scene/2d/physics/area_2d.cpp:590
 */
export function body_entered(self: object): GodotSignal<[object]> {
  return godot_physics_2d_signal(self, 'body_entered');
}

/**
 * @godot Area2D.body_exited
 * @source scene/2d/physics/area_2d.cpp:591
 */
export function body_exited(self: object): GodotSignal<[object]> {
  return godot_physics_2d_signal(self, 'body_exited');
}

/**
 * @godot Area2D.area_entered
 * @source scene/2d/physics/area_2d.cpp:594
 */
export function area_entered(self: object): GodotSignal<[object]> {
  return godot_physics_2d_signal(self, 'area_entered');
}

/**
 * @godot Area2D.area_exited
 * @source scene/2d/physics/area_2d.cpp:595
 */
export function area_exited(self: object): GodotSignal<[object]> {
  return godot_physics_2d_signal(self, 'area_exited');
}

const AREA_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_area_2d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['collisionLayer', (entity, value: number) => set_collision_layer(entity, value)],
    ['collisionMask', (entity, value: number) => set_collision_mask(entity, value)],
    ['monitoring', (entity, value: boolean) => set_monitoring(entity, value)],
    ['monitorable', (entity, value: boolean) => set_monitorable(entity, value)],
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
