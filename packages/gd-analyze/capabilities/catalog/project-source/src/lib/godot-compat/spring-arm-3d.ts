/**
 * @godot-class SpringArm3D
 * @role BINDING
 *
 * Godot 4.7's `SpringArm3D` (`scene/3d/physics/spring_arm_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as the component a scene declares: a group holding an
 * inner group its children hang in, which the arm's own component moves along the arm's +Z before
 * each physics step, as far as its shape swept through Rapier's world gets (a ray where it has no
 * shape, or a separation ray, less its margin), the colliders its mask admits less its excluded
 * bodies (`SpringArm3D::process_spring`, `spring_arm_3d.cpp:133`). Its children stand at its origin
 * (the plan states them there, as Godot places them), so the inner group places them. With no
 * shape Godot sweeps a child camera's view pyramid; this sweeps a ray.
 */

import { type Collider, Ray } from '@dimforge/rapier3d-compat';
import type { ThreeElements } from '@react-three/fiber';
import { createElement, type ReactElement, type Ref, useLayoutEffect, useRef } from 'react';
import { type Group, Matrix3, type Object3D, Quaternion as ThreeQuaternion, Vector3 as ThreeVector3 } from 'three';
import { useGodotBeforePhysicsStep } from './advance';
import { godot_collision_object_layers, godot_collision_object_of_collider, godot_physics_world } from './collision-object-3d';
import { godot_node_entity, is_inside_tree } from './node';
import { godot_shape_3d_collider } from './shape-3d';

interface ArmState {
  shape: object | null;
  length: number;
  mask: number;
  margin: number;
  readonly excluded: Set<object>;
  /** The length the last sweep allowed (`current_spring_length`). */
  hitLength: number;
  /** The inner group the arm's children hang in, which the sweep moves. */
  arm: Group | null;
}

const ARMS = new WeakMap<object, ArmState>();

/** An arm's settings as Godot starts them (`spring_arm_3d.h:41`). */
function stateOf(self: object): ArmState {
  const entity = godot_node_entity(self);
  let state = ARMS.get(entity);
  if (state === undefined) {
    state = { shape: null, length: 1, mask: 1, margin: 0.01, excluded: new Set(), hitLength: 0, arm: null };
    ARMS.set(entity, state);
  }
  return state;
}

const origin = new ThreeVector3();
const rotation = new ThreeQuaternion();
const scale = new ThreeVector3();
const direction = new ThreeVector3();
const basis = new Matrix3();

/** One sweep and the children placed (`process_spring`). */
function spring(entity: Object3D, state: ArmState): void {
  const world = godot_physics_world();
  if (world === undefined || state.length === 0) return;
  entity.updateWorldMatrix(true, false);
  entity.matrixWorld.decompose(origin, rotation, scale);
  direction.set(0, 0, 1).applyMatrix3(basis.setFromMatrix4(entity.matrixWorld));
  const motion = direction.clone().multiplyScalar(state.length);
  const admits = (collider: Collider): boolean => {
    const node = godot_collision_object_of_collider(collider);
    return node !== undefined && !state.excluded.has(node) && (godot_collision_object_layers(node).layer & state.mask) !== 0;
  };
  const desc = state.shape === null ? null : godot_shape_3d_collider(state.shape).desc;
  let fraction = 1;
  if (desc === null || desc === undefined) {
    const hit = world.castRay(new Ray(origin, motion), 1, true, undefined, undefined, undefined, undefined, admits);
    if (hit !== null) fraction = (hit.timeOfImpact * state.length - state.margin) / state.length;
  } else {
    const hit = world.castShape(origin, rotation, motion, desc.shape, state.margin, 1, true, undefined, undefined, undefined, undefined, admits);
    if (hit !== null) fraction = hit.time_of_impact;
  }
  state.hitLength = state.length * fraction;
  // The arm's own inner group, that far along its +Z (`get_global_transform().origin + cast_direction
  // * (spring_length * motion_delta)`), its children with it.
  const arm = state.arm;
  if (arm !== null) arm.position.set(0, 0, state.hitLength);
}

/**
 * @godot SpringArm3D.get_length
 * @source scene/3d/physics/spring_arm_3d.cpp:81
 */
export function get_length(self: object): number {
  return stateOf(self).length;
}

/**
 * @godot SpringArm3D.set_length
 * @source scene/3d/physics/spring_arm_3d.cpp:85
 */
export function set_length(self: object, length: number): void {
  stateOf(self).length = length;
}

/**
 * @godot SpringArm3D.set_shape
 * @source scene/3d/physics/spring_arm_3d.cpp:93
 */
export function set_shape(self: object, shape: object | null): void {
  stateOf(self).shape = shape;
}

/**
 * @godot SpringArm3D.get_shape
 * @source scene/3d/physics/spring_arm_3d.cpp:97
 */
export function get_shape(self: object): object | null {
  return stateOf(self).shape;
}

/**
 * @godot SpringArm3D.set_collision_mask
 * @source scene/3d/physics/spring_arm_3d.cpp:101
 */
export function set_collision_mask(self: object, mask: number): void {
  stateOf(self).mask = mask >>> 0;
}

/**
 * @godot SpringArm3D.get_collision_mask
 * @source scene/3d/physics/spring_arm_3d.cpp:105
 */
export function get_collision_mask(self: object): number {
  return stateOf(self).mask;
}

/**
 * @godot SpringArm3D.get_margin
 * @source scene/3d/physics/spring_arm_3d.cpp:109
 */
export function get_margin(self: object): number {
  return stateOf(self).margin;
}

/**
 * @godot SpringArm3D.set_margin
 * @source scene/3d/physics/spring_arm_3d.cpp:113
 */
export function set_margin(self: object, margin: number): void {
  stateOf(self).margin = margin;
}

/**
 * A body's RID the sweep leaves out: compat's RID of a collision object is its node.
 *
 * @godot SpringArm3D.add_excluded_object
 * @source scene/3d/physics/spring_arm_3d.cpp:117
 */
export function add_excluded_object(self: object, rid: object): void {
  stateOf(self).excluded.add(rid);
}

/**
 * @godot SpringArm3D.remove_excluded_object
 * @source scene/3d/physics/spring_arm_3d.cpp:121
 */
export function remove_excluded_object(self: object, rid: object): boolean {
  return stateOf(self).excluded.delete(rid);
}

/**
 * @godot SpringArm3D.clear_excluded_objects
 * @source scene/3d/physics/spring_arm_3d.cpp:125
 */
export function clear_excluded_objects(self: object): void {
  stateOf(self).excluded.clear();
}

/**
 * @godot SpringArm3D.get_hit_length
 * @source scene/3d/physics/spring_arm_3d.cpp:129
 */
export function get_hit_length(self: object): number {
  return stateOf(self).hitLength;
}

/** A `<GodotSpringArm3D>`'s props: a group's, and the arm's settings by their Godot names in camelCase. */
export type GodotSpringArm3DProps = Omit<ThreeElements['group'], 'ref'> & {
  readonly ref?: Ref<Group>;
  readonly shape?: object | null;
  readonly springLength?: number;
  readonly collisionMask?: number;
  readonly margin?: number;
};

/**
 * A SpringArm3D as a scene declares it: a group registered as the arm, its settings the element's,
 * its children in the inner group its own sweep moves before each physics step while it is in the tree.
 *
 * @godot SpringArm3D (protocol)
 * @source scene/3d/physics/spring_arm_3d.cpp:36
 */
export function GodotSpringArm3D({ ref, shape, springLength, collisionMask, margin, children, ...group }: GodotSpringArm3DProps): ReactElement {
  const own = useRef<Group>(null);
  const arm = useRef<Group>(null);
  useLayoutEffect(() => {
    const entity = own.current as Group;
    const state = stateOf(entity);
    state.arm = arm.current;
    if (shape !== undefined) set_shape(entity, shape);
    if (springLength !== undefined) set_length(entity, springLength);
    if (collisionMask !== undefined) set_collision_mask(entity, collisionMask);
    if (margin !== undefined) set_margin(entity, margin);
  }, []);
  useGodotBeforePhysicsStep(() => {
    const entity = own.current;
    if (entity !== null && is_inside_tree(entity)) spring(entity, stateOf(entity));
  });
  const refs = (value: Group | null) => {
    own.current = value;
    if (typeof ref === 'function') ref(value);
    else if (ref !== undefined && ref !== null) (ref as { current: Group | null }).current = value;
  };
  return createElement('group', { ...group, ref: refs }, createElement('group', { ref: arm }, children));
}
