/**
 * @godot-class Joint3D
 * @role PROTOCOL
 *
 * Godot 4.7's `Joint3D` (`scene/3d/physics/joints/joint_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a node joining the two physics bodies its `node_a`
 * and `node_b` paths name, as a `@react-three/rapier` impulse joint. The joint is made once both
 * bodies exist (`Joint3D::_update_joint`, `joint_3d.cpp:53`), each anchored where the joint node
 * stands in its body's space, and the two bodies do not collide while joined
 * (`exclude_nodes_from_collision`, on by default). A joint to one body and the world, and the
 * solver priority, are not bound.
 */

import type { RigidBody } from '@dimforge/rapier3d-compat';
import { useState } from 'react';
import { Matrix4, type Object3D, Quaternion as ThreeQuaternion, Vector3 as ThreeVector3 } from 'three';
import { useGodotBeforePhysicsStep } from './advance';
import { godot_collision_object_body } from './collision-object-3d';
import { get_node_or_null, godot_node_entity } from './node';

interface JointState {
  nodeA: string;
  nodeB: string;
  exclude: boolean;
  solverPriority: number;
}

const JOINTS = new WeakMap<object, JointState>();

function stateOf(self: object): JointState {
  const entity = godot_node_entity(self);
  let state = JOINTS.get(entity);
  if (state === undefined) {
    state = { nodeA: '', nodeB: '', exclude: true, solverPriority: 1 };
    JOINTS.set(entity, state);
  }
  return state;
}

/**
 * @godot Joint3D.set_node_a
 * @source scene/3d/physics/joints/joint_3d.cpp:124
 */
export function set_node_a(self: object, node_a: string): void {
  stateOf(self).nodeA = String(node_a);
}

/**
 * @godot Joint3D.get_node_a
 * @source scene/3d/physics/joints/joint_3d.cpp:137
 */
export function get_node_a(self: object): string {
  return stateOf(self).nodeA;
}

/**
 * @godot Joint3D.set_node_b
 * @source scene/3d/physics/joints/joint_3d.cpp:141
 */
export function set_node_b(self: object, node_b: string): void {
  stateOf(self).nodeB = String(node_b);
}

/**
 * @godot Joint3D.get_node_b
 * @source scene/3d/physics/joints/joint_3d.cpp:154
 */
export function get_node_b(self: object): string {
  return stateOf(self).nodeB;
}

/**
 * @godot Joint3D.set_exclude_nodes_from_collision
 * @source scene/3d/physics/joints/joint_3d.cpp:187
 */
export function set_exclude_nodes_from_collision(self: object, enable: boolean): void {
  stateOf(self).exclude = enable;
}

/**
 * @godot Joint3D.get_exclude_nodes_from_collision
 * @source scene/3d/physics/joints/joint_3d.cpp:199
 */
export function get_exclude_nodes_from_collision(self: object): boolean {
  return stateOf(self).exclude;
}

/**
 * @godot Joint3D.set_solver_priority
 * @source scene/3d/physics/joints/joint_3d.cpp:158
 */
export function set_solver_priority(self: object, priority: number): void {
  stateOf(self).solverPriority = priority;
}

/**
 * @godot Joint3D.get_solver_priority
 * @source scene/3d/physics/joints/joint_3d.cpp:165
 */
export function get_solver_priority(self: object): number {
  return stateOf(self).solverPriority;
}

/** A joint's two bodies, the joint's frame in each body's space, and whether they collide. */
export interface GodotJointBodies {
  readonly a: RigidBody;
  readonly b: RigidBody;
  readonly anchorA: { readonly x: number; readonly y: number; readonly z: number };
  readonly anchorB: { readonly x: number; readonly y: number; readonly z: number };
  /** The joint's X axis in body A's space (`Generic6DOFJoint3D::_configure_joint`'s `local_a`). */
  readonly axisA: { readonly x: number; readonly y: number; readonly z: number };
  readonly contacts: boolean;
}

/** The joint node's frame in a body's space: the body's pose inverted, times the joint's. */
function inBody(body: RigidBody, joint: Matrix4): { readonly anchor: ThreeVector3; readonly axis: ThreeVector3 } {
  const translation = body.translation();
  const rotation = body.rotation();
  const pose = new Matrix4().compose(
    new ThreeVector3(translation.x, translation.y, translation.z),
    new ThreeQuaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    new ThreeVector3(1, 1, 1),
  );
  const local = pose.invert().multiply(joint);
  const anchor = new ThreeVector3().setFromMatrixPosition(local);
  const axis = new ThreeVector3().setFromMatrixColumn(local, 0).normalize();
  return { anchor, axis };
}

/**
 * The joint's bodies once both exist, looked for before each physics step until they do
 * (`Joint3D::_update_joint`, `joint_3d.cpp:53`).
 *
 * @godot Joint3D (protocol)
 * @source scene/3d/physics/joints/joint_3d.cpp:53
 */
export function useGodotJointBodies(entity: Object3D): GodotJointBodies | undefined {
  const [bodies, setBodies] = useState<GodotJointBodies | undefined>(undefined);
  useGodotBeforePhysicsStep(() => {
    if (bodies !== undefined) return;
    const state = stateOf(entity);
    const nodeA = state.nodeA === '' ? null : get_node_or_null(entity, state.nodeA);
    const nodeB = state.nodeB === '' ? null : get_node_or_null(entity, state.nodeB);
    const a = nodeA === null || nodeA === undefined ? undefined : godot_collision_object_body(nodeA as object);
    const b = nodeB === null || nodeB === undefined ? undefined : godot_collision_object_body(nodeB as object);
    if (a === undefined || b === undefined || a === b) return;
    entity.updateWorldMatrix(true, false);
    const frame = entity.matrixWorld.clone();
    const inA = inBody(a, frame);
    const inB = inBody(b, frame);
    setBodies({ a, b, anchorA: inA.anchor, anchorB: inB.anchor, axisA: inA.axis, contacts: !state.exclude });
  });
  return bodies;
}

/**
 * Joint3D's properties as a joint element states them (`nodeA`, `nodeB`, …).
 *
 * @godot Joint3D (protocol)
 * @source scene/3d/physics/joints/joint_3d.cpp:228
 */
export function godot_joint_3d_props(): (readonly [string, (entity: Object3D, value: never) => void])[] {
  return [
    ['nodeA', (entity, value: string) => set_node_a(entity, value)],
    ['nodeB', (entity, value: string) => set_node_b(entity, value)],
    ['excludeNodesFromCollision', (entity, value: boolean) => set_exclude_nodes_from_collision(entity, value)],
    ['solverPriority', (entity, value: number) => set_solver_priority(entity, value)],
  ];
}
