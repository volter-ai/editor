/**
 * @godot-class Generic6DOFJoint3D
 * @role BINDING
 *
 * Godot 4.7's `Generic6DOFJoint3D` (`scene/3d/physics/joints/generic_6dof_joint_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its two bodies joined in the joint's frame, each of
 * the frame's three linear and three angular axes locked, limited or free by its settings, as
 * Rapier's generic joint (`JointData.generic`, through `useImpulseJoint`) with the locked axes in
 * its mask. An axis is locked where its limit is on with its lower bound not below its upper (a
 * new joint's axes are all locked, `generic_6dof_joint_3d.cpp:315`); Rapier's generic joint has no
 * limits in between, so a limited axis turns or slides freely. Springs and motors are kept for the
 * getters and move nothing.
 */

import { JointAxesMask, JointData } from '@dimforge/rapier3d-compat';
import { type RapierRigidBody, useImpulseJoint } from '@react-three/rapier';
import { createElement, type ReactElement, useEffect, useRef } from 'react';
import { Group, type Object3D } from 'three';
import { type GodotJointBodies, godot_joint_3d_props, useGodotJointBodies } from './joint-3d';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';


/** `Param` (`generic_6dof_joint_3d.h:39`): the ones the lock reads. */
const PARAM_LINEAR_LOWER_LIMIT = 0;
const PARAM_LINEAR_UPPER_LIMIT = 1;
const PARAM_ANGULAR_LOWER_LIMIT = 10;
const PARAM_ANGULAR_UPPER_LIMIT = 11;
/** `Flag` (`generic_6dof_joint_3d.h:65`). */
const FLAG_ENABLE_LINEAR_LIMIT = 0;
const FLAG_ENABLE_ANGULAR_LIMIT = 1;

/** A new joint's parameters on each axis (`Generic6DOFJoint3D::Generic6DOFJoint3D`, `:315`). */
const DEFAULT_PARAMS = [0, 0, 0.7, 0.5, 1, 0, 0, 0.01, 0.01, 0, 0, 0, 0.5, 1, 0, 0, 0.5, 0, 300, 0, 0, 0];
const DEFAULT_FLAGS = [true, true, false, false, false, false];

interface AxisState {
  readonly params: number[];
  readonly flags: boolean[];
}

const AXES = new WeakMap<object, readonly [AxisState, AxisState, AxisState]>();

function axesOf(self: object): readonly [AxisState, AxisState, AxisState] {
  const entity = godot_node_entity(self);
  let axes = AXES.get(entity);
  if (axes === undefined) {
    const axis = (): AxisState => ({ params: [...DEFAULT_PARAMS], flags: [...DEFAULT_FLAGS] });
    axes = [axis(), axis(), axis()];
    AXES.set(entity, axes);
  }
  return axes;
}

/**
 * @godot Generic6DOFJoint3D.set_param_x
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:199
 */
export function set_param_x(self: object, param: number, value: number): void {
  axesOf(self)[0].params[param] = value;
}

/**
 * @godot Generic6DOFJoint3D.get_param_x
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:209
 */
export function get_param_x(self: object, param: number): number {
  return axesOf(self)[0].params[param] ?? 0;
}

/**
 * @godot Generic6DOFJoint3D.set_param_y
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:214
 */
export function set_param_y(self: object, param: number, value: number): void {
  axesOf(self)[1].params[param] = value;
}

/**
 * @godot Generic6DOFJoint3D.get_param_y
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:223
 */
export function get_param_y(self: object, param: number): number {
  return axesOf(self)[1].params[param] ?? 0;
}

/**
 * @godot Generic6DOFJoint3D.set_param_z
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:228
 */
export function set_param_z(self: object, param: number, value: number): void {
  axesOf(self)[2].params[param] = value;
}

/**
 * @godot Generic6DOFJoint3D.get_param_z
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:237
 */
export function get_param_z(self: object, param: number): number {
  return axesOf(self)[2].params[param] ?? 0;
}

/**
 * @godot Generic6DOFJoint3D.set_flag_x
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:242
 */
export function set_flag_x(self: object, flag: number, enabled: boolean): void {
  axesOf(self)[0].flags[flag] = enabled;
}

/**
 * @godot Generic6DOFJoint3D.get_flag_x
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:251
 */
export function get_flag_x(self: object, flag: number): boolean {
  return axesOf(self)[0].flags[flag] ?? false;
}

/**
 * @godot Generic6DOFJoint3D.set_flag_y
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:256
 */
export function set_flag_y(self: object, flag: number, enabled: boolean): void {
  axesOf(self)[1].flags[flag] = enabled;
}

/**
 * @godot Generic6DOFJoint3D.get_flag_y
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:265
 */
export function get_flag_y(self: object, flag: number): boolean {
  return axesOf(self)[1].flags[flag] ?? false;
}

/**
 * @godot Generic6DOFJoint3D.set_flag_z
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:270
 */
export function set_flag_z(self: object, flag: number, enabled: boolean): void {
  axesOf(self)[2].flags[flag] = enabled;
}

/**
 * @godot Generic6DOFJoint3D.get_flag_z
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:279
 */
export function get_flag_z(self: object, flag: number): boolean {
  return axesOf(self)[2].flags[flag] ?? false;
}

/** The axes the joint locks, as Rapier's mask. */
function lockedAxes(entity: object): JointAxesMask {
  const axes = axesOf(entity);
  const locked = (axis: AxisState, flag: number, lower: number, upper: number) => axis.flags[flag] === true && (axis.params[lower] ?? 0) >= (axis.params[upper] ?? 0);
  const linear = [JointAxesMask.LinX, JointAxesMask.LinY, JointAxesMask.LinZ];
  const angular = [JointAxesMask.AngX, JointAxesMask.AngY, JointAxesMask.AngZ];
  let mask = 0;
  axes.forEach((axis, index) => {
    if (locked(axis, FLAG_ENABLE_LINEAR_LIMIT, PARAM_LINEAR_LOWER_LIMIT, PARAM_LINEAR_UPPER_LIMIT)) mask |= linear[index] as number;
    if (locked(axis, FLAG_ENABLE_ANGULAR_LIMIT, PARAM_ANGULAR_LOWER_LIMIT, PARAM_ANGULAR_UPPER_LIMIT)) mask |= angular[index] as number;
  });
  return mask as JointAxesMask;
}

/** The generic joint of the two bodies in the joint's frame, made once as it mounts. */
function Generic({ bodies, mask }: { readonly bodies: GodotJointBodies; readonly mask: JointAxesMask }): null {
  const a = useRef<RapierRigidBody>(bodies.a as RapierRigidBody);
  const b = useRef<RapierRigidBody>(bodies.b as RapierRigidBody);
  const joint = useImpulseJoint(a, b, JointData.generic(bodies.anchorA, bodies.anchorB, bodies.axisA, mask));
  useEffect(() => joint.current?.setContactsEnabled(bodies.contacts), [joint, bodies]);
  return null;
}

/** Each per-axis property's prop (`angularLimitXUpperAngle`), by its group, field and slot (`ADD_PROPERTYI`, `:52`). */
const SLOTS: readonly (readonly [string, 'flag' | 'param', number])[] = [
  ['linear_limit/enabled', 'flag', 0],
  ['linear_limit/upper_distance', 'param', 1],
  ['linear_limit/lower_distance', 'param', 0],
  ['linear_limit/softness', 'param', 2],
  ['linear_limit/restitution', 'param', 3],
  ['linear_limit/damping', 'param', 4],
  ['linear_motor/enabled', 'flag', 5],
  ['linear_motor/target_velocity', 'param', 5],
  ['linear_motor/force_limit', 'param', 6],
  ['linear_spring/enabled', 'flag', 3],
  ['linear_spring/stiffness', 'param', 7],
  ['linear_spring/damping', 'param', 8],
  ['linear_spring/equilibrium_point', 'param', 9],
  ['angular_limit/enabled', 'flag', 1],
  ['angular_limit/upper_angle', 'param', 11],
  ['angular_limit/lower_angle', 'param', 10],
  ['angular_limit/softness', 'param', 12],
  ['angular_limit/restitution', 'param', 14],
  ['angular_limit/damping', 'param', 13],
  ['angular_limit/force_limit', 'param', 15],
  ['angular_limit/erp', 'param', 16],
  ['angular_motor/enabled', 'flag', 4],
  ['angular_motor/target_velocity', 'param', 17],
  ['angular_motor/force_limit', 'param', 18],
  ['angular_spring/enabled', 'flag', 2],
  ['angular_spring/stiffness', 'param', 19],
  ['angular_spring/damping', 'param', 20],
  ['angular_spring/equilibrium_point', 'param', 21],
];

const camel = (name: string) => name.replace(/[_/]([a-z])/gu, (_, letter: string) => letter.toUpperCase());

const GENERIC_6DOF_JOINT_3D = {
  create: () => new Group(),
  spatial: true,
  mount: (entity: Object3D) => void axesOf(entity),
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_joint_3d_props(),
    ...SLOTS.flatMap(([name, kind, slot]) =>
      (['x', 'y', 'z'] as const).map((axis, index): readonly [string, GodotElementProp<Object3D>] => {
        const [group, field] = name.split('/') as [string, string];
        return [
          camel(`${group}_${axis}/${field}`),
          (entity, value: number | boolean) => {
            const state = axesOf(entity)[index] as AxisState;
            if (kind === 'flag') state.flags[slot] = Boolean(value);
            else state.params[slot] = Number(value);
          },
        ];
      }),
    ),
  ]),
};

/**
 * A generic joint as a scene writes it: `<GodotGeneric6DOFJoint3D nodeA="../Trailer" nodeB="../Body" />`.
 *
 * @godot Generic6DOFJoint3D (protocol)
 * @source scene/3d/physics/joints/generic_6dof_joint_3d.cpp:284
 */
export function GodotGeneric6DOFJoint3D(props: GodotElementProps<Group>): ReactElement {
  const element = useGodotElement(GENERIC_6DOF_JOINT_3D, props);
  const entity = (element.props as { readonly object: Group }).object;
  const bodies = useGodotJointBodies(entity);
  return createElement(
    'primitive',
    { ...(element.props as object) },
    props.children,
    bodies === undefined ? null : createElement(Generic, { key: 'joint', bodies, mask: lockedAxes(entity) }),
  );
}
