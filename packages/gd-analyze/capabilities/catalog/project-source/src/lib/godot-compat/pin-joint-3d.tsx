/**
 * @godot-class PinJoint3D
 * @role BINDING
 *
 * Godot 4.7's `PinJoint3D` (`scene/3d/physics/joints/pin_joint_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its two bodies pinned at the joint's place, free to
 * turn about it, as Rapier's spherical joint (`useSphericalJoint`), each anchored at the pin in its
 * own space (`PinJoint3D::_configure_joint`, `pin_joint_3d.cpp:59`). Its bias, damping and impulse
 * clamp are kept for the getters: Rapier's solver has no such settings.
 */

import type { RapierRigidBody } from '@react-three/rapier';
import { useSphericalJoint } from '@react-three/rapier';
import { createElement, type ReactElement, useEffect, useRef } from 'react';
import { Group, type Object3D } from 'three';
import { type GodotJointBodies, godot_joint_3d_props, useGodotJointBodies } from './joint-3d';
import { godot_node_adopt, godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';

const CLASSES = ['PinJoint3D', 'Joint3D', 'Node3D', 'Node', 'Object'];

const PARAMS = new WeakMap<object, number[]>();

function paramsOf(self: object): number[] {
  const entity = godot_node_entity(self);
  let params = PARAMS.get(entity);
  if (params === undefined) {
    // `PinJoint3D::PinJoint3D` (`pin_joint_3d.cpp:76`): bias 0.3, damping 1, no impulse clamp.
    params = [0.3, 1, 0];
    PARAMS.set(entity, params);
  }
  return params;
}

/**
 * @godot PinJoint3D.set_param
 * @source scene/3d/physics/joints/pin_joint_3d.cpp:46
 */
export function set_param(self: object, param: number, value: number): void {
  paramsOf(self)[param] = value;
}

/**
 * @godot PinJoint3D.get_param
 * @source scene/3d/physics/joints/pin_joint_3d.cpp:54
 */
export function get_param(self: object, param: number): number {
  return paramsOf(self)[param] ?? 0;
}

/** The spherical joint of the two bodies, made once as it mounts. */
function Pin({ bodies }: { readonly bodies: GodotJointBodies }): null {
  const a = useRef<RapierRigidBody>(bodies.a as RapierRigidBody);
  const b = useRef<RapierRigidBody>(bodies.b as RapierRigidBody);
  const joint = useSphericalJoint(a, b, [bodies.anchorA, bodies.anchorB]);
  useEffect(() => joint.current?.setContactsEnabled(bodies.contacts), [joint, bodies]);
  return null;
}

/**
 * @godot PinJoint3D.PinJoint3D
 * @source scene/3d/physics/joints/pin_joint_3d.cpp:76
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'spatial', classes: CLASSES });
  return entity;
}

const PIN_JOINT_3D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: true,
  mount: (entity: Object3D) => void paramsOf(entity),
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_joint_3d_props(),
    ['paramsBias', (entity, value: number) => set_param(entity, 0, value)],
    ['paramsDamping', (entity, value: number) => set_param(entity, 1, value)],
    ['paramsImpulseClamp', (entity, value: number) => set_param(entity, 2, value)],
  ]),
};

/**
 * A pin joint as a scene writes it: `<GodotPinJoint3D nodeA="../Body" nodeB="../Chain" />`.
 *
 * @godot PinJoint3D (protocol)
 * @source scene/3d/physics/joints/pin_joint_3d.cpp:59
 */
export function GodotPinJoint3D(props: GodotElementProps<Group>): ReactElement {
  const element = useGodotElement(PIN_JOINT_3D, props);
  const entity = (element.props as { readonly object: Group }).object;
  const bodies = useGodotJointBodies(entity);
  return createElement('primitive', { ...(element.props as object) }, props.children, bodies === undefined ? null : createElement(Pin, { key: 'joint', bodies }));
}
