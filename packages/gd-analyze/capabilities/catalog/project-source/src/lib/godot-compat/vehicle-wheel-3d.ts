/**
 * @godot-class VehicleWheel3D
 * @role BINDING
 *
 * Godot 4.7's `VehicleWheel3D` (`scene/3d/physics/vehicle_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a wheel of its parent VehicleBody3D, which that
 * body's driver hands to Rapier's ray-cast vehicle controller (`vehicle-body-3d.tsx`) with its
 * suspension, friction and forces. Where it hangs is its transform as it first joins the vehicle
 * (`NOTIFICATION_ENTER_TREE`): its origin the chassis connection point, its `-Y` the suspension's
 * direction, its `X` the axle; after that the vehicle places it each physics step, down its
 * suspension, steered and rolling. Rapier's controller has no roll influence: the wheel keeps the
 * value, which moves nothing.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, Vector3 as ThreeVector3 } from 'three';
import { godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector3, type Vector3 } from './vector3';


/** A wheel's settings (`vehicle_body_3d.h:83`) and what its vehicle last found for it. */
export interface GodotVehicleWheelState {
  radius: number;
  restLength: number;
  travel: number;
  stiffness: number;
  maxForce: number;
  compression: number;
  relaxation: number;
  frictionSlip: number;
  rollInfluence: number;
  traction: boolean;
  steers: boolean;
  engineForce: number;
  brake: number;
  steering: number;
  /** Where it hangs on the chassis, from its transform as it first joined the vehicle. */
  mount?: { readonly origin: ThreeVector3; readonly direction: ThreeVector3; readonly axle: ThreeVector3 };
  inContact: boolean;
  contactPoint: Vector3;
  contactNormal: Vector3;
  rpm: number;
}

const WHEELS = new WeakMap<object, GodotVehicleWheelState>();

/**
 * The wheel's state, or undefined for an object that is not a VehicleWheel3D.
 *
 * @godot VehicleWheel3D (protocol)
 * @source scene/3d/physics/vehicle_body_3d.cpp:391
 */
export function godot_vehicle_wheel_3d_state(self: object): GodotVehicleWheelState | undefined {
  return WHEELS.get(godot_node_entity(self));
}

function stateOf(self: object, member: string): GodotVehicleWheelState {
  const state = godot_vehicle_wheel_3d_state(self);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a VehicleWheel3D`);
  return state;
}

/**
 * Where the wheel hangs, read once from its transform (`VehicleWheel3D::_notification`,
 * `vehicle_body_3d.cpp:117`): the chassis connection point, the suspension direction (`-Y`) and
 * the axle (`X`).
 *
 * @godot VehicleWheel3D (protocol)
 * @source scene/3d/physics/vehicle_body_3d.cpp:127
 */
export function godot_vehicle_wheel_3d_mount_point(entity: Object3D, state: GodotVehicleWheelState): NonNullable<GodotVehicleWheelState['mount']> {
  if (state.mount === undefined) {
    entity.updateMatrix();
    const x = new ThreeVector3();
    const y = new ThreeVector3();
    const z = new ThreeVector3();
    entity.matrix.extractBasis(x, y, z);
    state.mount = { origin: entity.position.clone(), direction: y.normalize().negate(), axle: x.normalize() };
  }
  return state.mount;
}

/**
 * @godot VehicleWheel3D (protocol)
 * @source scene/3d/physics/vehicle_body_3d.cpp:391
 */
export function godot_vehicle_wheel_3d_mount(entity: Object3D): void {
  WHEELS.set(entity, {
    radius: 0.5,
    restLength: 0.15,
    travel: 0.2,
    stiffness: 5.88,
    maxForce: 6000,
    compression: 0.83,
    relaxation: 0.88,
    frictionSlip: 10.5,
    rollInfluence: 0.1,
    traction: false,
    steers: false,
    engineForce: 0,
    brake: 0,
    steering: 0,
    inContact: false,
    contactPoint: vector3(0, 0, 0),
    contactNormal: vector3(0, 0, 0),
    rpm: 0,
  });
}

/**
 * @godot VehicleWheel3D.set_radius
 * @source scene/3d/physics/vehicle_body_3d.cpp:180
 */
export function set_radius(self: object, radius: number): void {
  stateOf(self, 'set_radius').radius = radius;
}

/**
 * @godot VehicleWheel3D.get_radius
 * @source scene/3d/physics/vehicle_body_3d.cpp:185
 */
export function get_radius(self: object): number {
  return stateOf(self, 'get_radius').radius;
}

/**
 * @godot VehicleWheel3D.set_suspension_rest_length
 * @source scene/3d/physics/vehicle_body_3d.cpp:189
 */
export function set_suspension_rest_length(self: object, length: number): void {
  stateOf(self, 'set_suspension_rest_length').restLength = length;
}

/**
 * @godot VehicleWheel3D.get_suspension_rest_length
 * @source scene/3d/physics/vehicle_body_3d.cpp:194
 */
export function get_suspension_rest_length(self: object): number {
  return stateOf(self, 'get_suspension_rest_length').restLength;
}

/**
 * @godot VehicleWheel3D.set_suspension_travel
 * @source scene/3d/physics/vehicle_body_3d.cpp:198
 */
export function set_suspension_travel(self: object, length: number): void {
  stateOf(self, 'set_suspension_travel').travel = length;
}

/**
 * @godot VehicleWheel3D.get_suspension_travel
 * @source scene/3d/physics/vehicle_body_3d.cpp:202
 */
export function get_suspension_travel(self: object): number {
  return stateOf(self, 'get_suspension_travel').travel;
}

/**
 * @godot VehicleWheel3D.set_suspension_stiffness
 * @source scene/3d/physics/vehicle_body_3d.cpp:206
 */
export function set_suspension_stiffness(self: object, value: number): void {
  stateOf(self, 'set_suspension_stiffness').stiffness = value;
}

/**
 * @godot VehicleWheel3D.get_suspension_stiffness
 * @source scene/3d/physics/vehicle_body_3d.cpp:210
 */
export function get_suspension_stiffness(self: object): number {
  return stateOf(self, 'get_suspension_stiffness').stiffness;
}

/**
 * @godot VehicleWheel3D.set_suspension_max_force
 * @source scene/3d/physics/vehicle_body_3d.cpp:214
 */
export function set_suspension_max_force(self: object, value: number): void {
  stateOf(self, 'set_suspension_max_force').maxForce = value;
}

/**
 * @godot VehicleWheel3D.get_suspension_max_force
 * @source scene/3d/physics/vehicle_body_3d.cpp:218
 */
export function get_suspension_max_force(self: object): number {
  return stateOf(self, 'get_suspension_max_force').maxForce;
}

/**
 * @godot VehicleWheel3D.set_damping_compression
 * @source scene/3d/physics/vehicle_body_3d.cpp:222
 */
export function set_damping_compression(self: object, value: number): void {
  stateOf(self, 'set_damping_compression').compression = value;
}

/**
 * @godot VehicleWheel3D.get_damping_compression
 * @source scene/3d/physics/vehicle_body_3d.cpp:226
 */
export function get_damping_compression(self: object): number {
  return stateOf(self, 'get_damping_compression').compression;
}

/**
 * @godot VehicleWheel3D.set_damping_relaxation
 * @source scene/3d/physics/vehicle_body_3d.cpp:230
 */
export function set_damping_relaxation(self: object, value: number): void {
  stateOf(self, 'set_damping_relaxation').relaxation = value;
}

/**
 * @godot VehicleWheel3D.get_damping_relaxation
 * @source scene/3d/physics/vehicle_body_3d.cpp:234
 */
export function get_damping_relaxation(self: object): number {
  return stateOf(self, 'get_damping_relaxation').relaxation;
}

/**
 * @godot VehicleWheel3D.set_friction_slip
 * @source scene/3d/physics/vehicle_body_3d.cpp:238
 */
export function set_friction_slip(self: object, value: number): void {
  stateOf(self, 'set_friction_slip').frictionSlip = value;
}

/**
 * @godot VehicleWheel3D.get_friction_slip
 * @source scene/3d/physics/vehicle_body_3d.cpp:242
 */
export function get_friction_slip(self: object): number {
  return stateOf(self, 'get_friction_slip').frictionSlip;
}

/**
 * @godot VehicleWheel3D.set_roll_influence
 * @source scene/3d/physics/vehicle_body_3d.cpp:246
 */
export function set_roll_influence(self: object, value: number): void {
  stateOf(self, 'set_roll_influence').rollInfluence = value;
}

/**
 * @godot VehicleWheel3D.get_roll_influence
 * @source scene/3d/physics/vehicle_body_3d.cpp:250
 */
export function get_roll_influence(self: object): number {
  return stateOf(self, 'get_roll_influence').rollInfluence;
}

/**
 * @godot VehicleWheel3D.is_in_contact
 * @source scene/3d/physics/vehicle_body_3d.cpp:254
 */
export function is_in_contact(self: object): boolean {
  return stateOf(self, 'is_in_contact').inContact;
}

/**
 * @godot VehicleWheel3D.get_contact_point
 * @source scene/3d/physics/vehicle_body_3d.cpp:258
 */
export function get_contact_point(self: object): Vector3 {
  return stateOf(self, 'get_contact_point').contactPoint;
}

/**
 * @godot VehicleWheel3D.get_contact_normal
 * @source scene/3d/physics/vehicle_body_3d.cpp:262
 */
export function get_contact_normal(self: object): Vector3 {
  return stateOf(self, 'get_contact_normal').contactNormal;
}

/**
 * @godot VehicleWheel3D.set_engine_force
 * @source scene/3d/physics/vehicle_body_3d.cpp:343
 */
export function set_engine_force(self: object, force: number): void {
  stateOf(self, 'set_engine_force').engineForce = force;
}

/**
 * @godot VehicleWheel3D.get_engine_force
 * @source scene/3d/physics/vehicle_body_3d.cpp:347
 */
export function get_engine_force(self: object): number {
  return stateOf(self, 'get_engine_force').engineForce;
}

/**
 * @godot VehicleWheel3D.set_brake
 * @source scene/3d/physics/vehicle_body_3d.cpp:351
 */
export function set_brake(self: object, brake: number): void {
  stateOf(self, 'set_brake').brake = brake;
}

/**
 * @godot VehicleWheel3D.get_brake
 * @source scene/3d/physics/vehicle_body_3d.cpp:355
 */
export function get_brake(self: object): number {
  return stateOf(self, 'get_brake').brake;
}

/**
 * @godot VehicleWheel3D.set_steering
 * @source scene/3d/physics/vehicle_body_3d.cpp:359
 */
export function set_steering(self: object, steering: number): void {
  stateOf(self, 'set_steering').steering = steering;
}

/**
 * @godot VehicleWheel3D.get_steering
 * @source scene/3d/physics/vehicle_body_3d.cpp:363
 */
export function get_steering(self: object): number {
  return stateOf(self, 'get_steering').steering;
}

/**
 * @godot VehicleWheel3D.set_use_as_traction
 * @source scene/3d/physics/vehicle_body_3d.cpp:367
 */
export function set_use_as_traction(self: object, enable: boolean): void {
  stateOf(self, 'set_use_as_traction').traction = enable;
}

/**
 * @godot VehicleWheel3D.is_used_as_traction
 * @source scene/3d/physics/vehicle_body_3d.cpp:371
 */
export function is_used_as_traction(self: object): boolean {
  return stateOf(self, 'is_used_as_traction').traction;
}

/**
 * @godot VehicleWheel3D.set_use_as_steering
 * @source scene/3d/physics/vehicle_body_3d.cpp:375
 */
export function set_use_as_steering(self: object, enable: boolean): void {
  stateOf(self, 'set_use_as_steering').steers = enable;
}

/**
 * @godot VehicleWheel3D.is_used_as_steering
 * @source scene/3d/physics/vehicle_body_3d.cpp:379
 */
export function is_used_as_steering(self: object): boolean {
  return stateOf(self, 'is_used_as_steering').steers;
}

/**
 * The wheel's turns per minute over the last physics step (`VehicleBody3D::_body_state_changed`,
 * `vehicle_body_3d.cpp:998`).
 *
 * @godot VehicleWheel3D.get_rpm
 * @source scene/3d/physics/vehicle_body_3d.cpp:387
 */
export function get_rpm(self: object): number {
  return stateOf(self, 'get_rpm').rpm;
}

const VEHICLE_WHEEL_3D = {
  create: () => new Group(),
  spatial: true,
  mount: godot_vehicle_wheel_3d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ['wheelRadius', (entity, value: number) => set_radius(entity, value)],
    ['wheelRestLength', (entity, value: number) => set_suspension_rest_length(entity, value)],
    ['suspensionTravel', (entity, value: number) => set_suspension_travel(entity, value)],
    ['suspensionStiffness', (entity, value: number) => set_suspension_stiffness(entity, value)],
    ['suspensionMaxForce', (entity, value: number) => set_suspension_max_force(entity, value)],
    ['dampingCompression', (entity, value: number) => set_damping_compression(entity, value)],
    ['dampingRelaxation', (entity, value: number) => set_damping_relaxation(entity, value)],
    ['wheelFrictionSlip', (entity, value: number) => set_friction_slip(entity, value)],
    ['wheelRollInfluence', (entity, value: number) => set_roll_influence(entity, value)],
    ['useAsTraction', (entity, value: boolean) => set_use_as_traction(entity, value)],
    ['useAsSteering', (entity, value: boolean) => set_use_as_steering(entity, value)],
    ['engineForce', (entity, value: number) => set_engine_force(entity, value)],
    ['brake', (entity, value: number) => set_brake(entity, value)],
    ['steering', (entity, value: number) => set_steering(entity, value)],
  ]),
};

/**
 * A wheel as a scene writes it: `<GodotVehicleWheel3D wheelRadius={0.25} useAsTraction />`.
 *
 * @godot VehicleWheel3D (protocol)
 * @source scene/3d/physics/vehicle_body_3d.cpp:391
 */
export function GodotVehicleWheel3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(VEHICLE_WHEEL_3D, props);
}
