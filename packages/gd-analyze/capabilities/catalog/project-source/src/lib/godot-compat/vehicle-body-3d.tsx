/**
 * @godot-class VehicleBody3D
 * @role BINDING
 *
 * Godot 4.7's `VehicleBody3D` (`scene/3d/physics/vehicle_body_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a RigidBody3D (its `<RigidBody>`) on ray-cast
 * wheels, the model Godot took from Bullet's `btRaycastVehicle`, which Rapier's
 * `DynamicRayCastVehicleController` is too. The body's driver (`<GodotVehicleBody3D>`, inside its
 * `<RigidBody>`) makes the controller over the body, up `+Y` and forward `+Z` as Godot's chassis,
 * with a wheel per VehicleWheel3D child in child order; before each physics step it hands the
 * controller the wheels' settings and forces, lets it update the body, and places each wheel down
 * its suspension, steered and rolling (`VehicleBody3D::_update_wheel`, `vehicle_body_3d.cpp:411`).
 * The body's engine force, brake and steering reach its traction, all and steering wheels, as
 * Godot's setters hand them on. Differences from Godot's solver are Rapier's: a wheel's roll
 * influence is not applied, and its side friction stiffness is Rapier's 1.
 */

import type { DynamicRayCastVehicleController } from '@dimforge/rapier3d-compat';
import { createElement, type ReactElement, useEffect, useRef } from 'react';
import { type Group, Matrix4, type Object3D, Vector3 as ThreeVector3 } from 'three';
import { useGodotBeforePhysicsStep } from './advance';
import { godot_collision_object_body, godot_physics_world } from './collision-object-3d';
import { godot_node_entity, godot_node_foreign } from './node';
import { godot_vehicle_wheel_3d_mount_point, godot_vehicle_wheel_3d_state, type GodotVehicleWheelState } from './vehicle-wheel-3d';
import { construct as vector3 } from './vector3';

interface VehicleState {
  engineForce: number;
  brake: number;
  steering: number;
  controller?: DynamicRayCastVehicleController;
  /** The wheels the controller was made with, in its order. */
  wheels: readonly Object3D[];
}

const VEHICLES = new WeakMap<object, VehicleState>();

/** The vehicle's forces, from its scene's values (`userData`) when first asked for. */
function stateOf(self: object): VehicleState {
  const entity = godot_node_entity(self);
  let state = VEHICLES.get(entity);
  if (state === undefined) {
    const data = ((entity as Object3D).userData ?? {}) as Readonly<Record<string, unknown>>;
    state = {
      engineForce: typeof data['engine_force'] === 'number' ? data['engine_force'] : 0,
      brake: typeof data['brake'] === 'number' ? data['brake'] : 0,
      steering: typeof data['steering'] === 'number' ? data['steering'] : 0,
      wheels: [],
    };
    VEHICLES.set(entity, state);
  }
  return state;
}

/** The body's VehicleWheel3D children, in child order (the order they enter the tree). */
function wheelsOf(entity: object): { readonly object: Object3D; readonly wheel: GodotVehicleWheelState }[] {
  return (entity as Object3D).children.flatMap((object) => {
    const wheel = godot_vehicle_wheel_3d_state(object);
    return wheel === undefined ? [] : [{ object, wheel }];
  });
}

const UP = new ThreeVector3();
const RIGHT = new ThreeVector3();
const FORWARD = new ThreeVector3();
const BASIS = new Matrix4();
const TURN = new Matrix4();
const ROLL = new Matrix4();

/**
 * Places a wheel in the chassis's space as Godot does: down its suspension by the suspension's
 * length, its basis the axle, up and forward axes, rolled about the axle and steered about up
 * (`VehicleBody3D::_update_wheel`, `vehicle_body_3d.cpp:411`).
 */
function placeWheel(object: Object3D, wheel: GodotVehicleWheelState, suspension: number, rotation: number): void {
  const mount = godot_vehicle_wheel_3d_mount_point(object, wheel);
  UP.copy(mount.direction).negate();
  RIGHT.copy(mount.axle);
  FORWARD.crossVectors(UP, RIGHT).normalize();
  BASIS.makeBasis(RIGHT, UP, FORWARD);
  TURN.makeRotationAxis(UP, wheel.steering);
  ROLL.makeRotationAxis(RIGHT, rotation);
  const placed = TURN.multiply(ROLL).multiply(BASIS);
  object.quaternion.setFromRotationMatrix(placed);
  object.position.copy(mount.origin).addScaledVector(mount.direction, suspension);
}

/**
 * The vehicle's controller before each physics step: made over the body with its wheels (again
 * when its wheels change), handed each wheel's settings and forces, run, and its wheels placed.
 *
 * @godot VehicleBody3D (protocol)
 * @source scene/3d/physics/vehicle_body_3d.cpp:929
 */
function drive(entity: object, step: number): void {
  const world = godot_physics_world();
  const body = godot_collision_object_body(entity);
  if (world === undefined || body === undefined) return;
  const state = stateOf(entity);
  const wheels = wheelsOf(entity);
  let controller = state.controller;
  if (controller === undefined || controller.chassis() !== body || wheels.length !== state.wheels.length || wheels.some((entry, index) => entry.object !== state.wheels[index])) {
    if (controller !== undefined) world.removeVehicleController(controller);
    controller = world.createVehicleController(body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;
    for (const { object, wheel } of wheels) {
      const mount = godot_vehicle_wheel_3d_mount_point(object, wheel);
      controller.addWheel(mount.origin, mount.direction, mount.axle, wheel.restLength, wheel.radius);
    }
    state.controller = controller;
    state.wheels = wheels.map((entry) => entry.object);
  }
  wheels.forEach(({ wheel }, index) => {
    controller.setWheelSuspensionRestLength(index, wheel.restLength);
    controller.setWheelMaxSuspensionTravel(index, wheel.travel);
    controller.setWheelRadius(index, wheel.radius);
    controller.setWheelSuspensionStiffness(index, wheel.stiffness);
    controller.setWheelSuspensionCompression(index, wheel.compression);
    controller.setWheelSuspensionRelaxation(index, wheel.relaxation);
    controller.setWheelMaxSuspensionForce(index, wheel.maxForce);
    controller.setWheelFrictionSlip(index, wheel.frictionSlip);
    controller.setWheelSteering(index, wheel.steering);
    controller.setWheelEngineForce(index, wheel.engineForce);
    controller.setWheelBrake(index, wheel.brake);
  });
  const before = wheels.map((_, index) => controller.wheelRotation(index) ?? 0);
  controller.updateVehicle(step);
  wheels.forEach(({ object, wheel }, index) => {
    const rotation = controller.wheelRotation(index) ?? 0;
    // Turns per minute over the step (`vehicle_body_3d.cpp:998`).
    wheel.rpm = ((rotation - (before[index] as number)) / step) * 60 / (Math.PI * 2);
    wheel.inContact = controller.wheelIsInContact(index);
    const point = controller.wheelContactPoint(index);
    const normal = controller.wheelContactNormal(index);
    wheel.contactPoint = point === null ? vector3(0, 0, 0) : vector3(point.x, point.y, point.z);
    wheel.contactNormal = normal === null ? vector3(0, 0, 0) : vector3(normal.x, normal.y, normal.z);
    placeWheel(object, wheel, controller.wheelSuspensionLength(index) ?? wheel.restLength, rotation);
  });
}

/**
 * The vehicle's driver, inside its `<RigidBody>`: it runs the body's controller before each
 * physics step and lets it go as it unmounts. It marks its place in the body with an object that
 * is no node.
 *
 * @godot VehicleBody3D (protocol)
 * @source scene/3d/physics/vehicle_body_3d.cpp:929
 */
export function GodotVehicleBody3D(): ReactElement {
  const marker = useRef<Group | null>(null);
  useGodotBeforePhysicsStep((step) => {
    const entity = marker.current?.parent;
    if (entity !== null && entity !== undefined) drive(entity, step);
  });
  useEffect(() => {
    const held = marker.current;
    if (held !== null) godot_node_foreign(held);
    const entity = held?.parent;
    return () => {
      const state = entity === null || entity === undefined ? undefined : VEHICLES.get(entity);
      const controller = state?.controller;
      if (state === undefined || controller === undefined) return;
      godot_physics_world()?.removeVehicleController(controller);
      delete state.controller;
      state.wheels = [];
    };
  }, []);
  return createElement('group', { ref: marker });
}

/**
 * The engine force of each traction wheel (`vehicle_body_3d.cpp:1006`).
 *
 * @godot VehicleBody3D.set_engine_force
 * @source scene/3d/physics/vehicle_body_3d.cpp:1006
 */
export function set_engine_force(self: object, engine_force: number): void {
  stateOf(self).engineForce = engine_force;
  for (const { wheel } of wheelsOf(godot_node_entity(self))) if (wheel.traction) wheel.engineForce = engine_force;
}

/**
 * @godot VehicleBody3D.get_engine_force
 * @source scene/3d/physics/vehicle_body_3d.cpp:1016
 */
export function get_engine_force(self: object): number {
  return stateOf(self).engineForce;
}

/**
 * The brake of every wheel (`vehicle_body_3d.cpp:1020`).
 *
 * @godot VehicleBody3D.set_brake
 * @source scene/3d/physics/vehicle_body_3d.cpp:1020
 */
export function set_brake(self: object, brake: number): void {
  stateOf(self).brake = brake;
  for (const { wheel } of wheelsOf(godot_node_entity(self))) wheel.brake = brake;
}

/**
 * @godot VehicleBody3D.get_brake
 * @source scene/3d/physics/vehicle_body_3d.cpp:1028
 */
export function get_brake(self: object): number {
  return stateOf(self).brake;
}

/**
 * The steering of each steering wheel (`vehicle_body_3d.cpp:1032`).
 *
 * @godot VehicleBody3D.set_steering
 * @source scene/3d/physics/vehicle_body_3d.cpp:1032
 */
export function set_steering(self: object, steering: number): void {
  stateOf(self).steering = steering;
  for (const { wheel } of wheelsOf(godot_node_entity(self))) if (wheel.steers) wheel.steering = steering;
}

/**
 * @godot VehicleBody3D.get_steering
 * @source scene/3d/physics/vehicle_body_3d.cpp:1042
 */
export function get_steering(self: object): number {
  return stateOf(self).steering;
}
