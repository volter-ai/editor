/** Godot PhysicsServer2DExtension protocol over an exact project physics server. */

import { registerGodotObjectIdentity } from './object';
import { packedVector2Array, type PackedVector2Array } from './packed-array';
import type { GodotPhysicsRID } from './physics-direct-body-state-2d-extension';
import type { GodotTransform2D } from './transform-2d';
import type { Vector2 } from './vector2';

export interface GodotPhysicsServer2DExtensionCarrier { invoke(method: string, args: readonly unknown[]): unknown }

export class GodotPhysicsServer2DExtension {
  constructor(private readonly carrier: GodotPhysicsServer2DExtensionCarrier) { registerGodotObjectIdentity(this, 'PhysicsServer2DExtension'); }
  private call(method: string, ...args: readonly unknown[]): unknown { return this.carrier.invoke(method, args); }
  private int(method: string, ...args: readonly unknown[]): number { return Math.trunc(Number(this.call(method, ...args))); }
  private num(method: string, ...args: readonly unknown[]): number { return Number(this.call(method, ...args)); }
  private bool(method: string, ...args: readonly unknown[]): boolean { return Boolean(this.call(method, ...args)); }
  private vec(method: string, ...args: readonly unknown[]): Vector2 { const value = this.call(method, ...args) as Vector2; return { x: value.x, y: value.y }; }

  _world_boundary_shape_create(): GodotPhysicsRID { return this.call('_world_boundary_shape_create'); }
  _separation_ray_shape_create(): GodotPhysicsRID { return this.call('_separation_ray_shape_create'); }
  _segment_shape_create(): GodotPhysicsRID { return this.call('_segment_shape_create'); }
  _circle_shape_create(): GodotPhysicsRID { return this.call('_circle_shape_create'); }
  _rectangle_shape_create(): GodotPhysicsRID { return this.call('_rectangle_shape_create'); }
  _capsule_shape_create(): GodotPhysicsRID { return this.call('_capsule_shape_create'); }
  _convex_polygon_shape_create(): GodotPhysicsRID { return this.call('_convex_polygon_shape_create'); }
  _concave_polygon_shape_create(): GodotPhysicsRID { return this.call('_concave_polygon_shape_create'); }
  _shape_set_data(shape: GodotPhysicsRID, data: unknown): void { this.call('_shape_set_data', shape, data); }
  _shape_set_custom_solver_bias(shape: GodotPhysicsRID, bias: number): void { this.call('_shape_set_custom_solver_bias', shape, bias); }
  _shape_get_type(shape: GodotPhysicsRID): number { return this.int('_shape_get_type', shape); }
  _shape_get_data(shape: GodotPhysicsRID): unknown { return this.call('_shape_get_data', shape); }
  _shape_get_custom_solver_bias(shape: GodotPhysicsRID): number { return this.num('_shape_get_custom_solver_bias', shape); }
  _shape_collide(shapeA: GodotPhysicsRID, transformA: GodotTransform2D, motionA: Vector2, shapeB: GodotPhysicsRID, transformB: GodotTransform2D, motionB: Vector2, results: unknown[], resultMax: number): boolean { return this.bool('_shape_collide', shapeA, transformA, motionA, shapeB, transformB, motionB, results, resultMax); }

  _space_create(): GodotPhysicsRID { return this.call('_space_create'); }
  _space_set_active(space: GodotPhysicsRID, active: boolean): void { this.call('_space_set_active', space, active); }
  _space_is_active(space: GodotPhysicsRID): boolean { return this.bool('_space_is_active', space); }
  _space_set_param(space: GodotPhysicsRID, parameter: number, value: number): void { this.call('_space_set_param', space, parameter, value); }
  _space_get_param(space: GodotPhysicsRID, parameter: number): number { return this.num('_space_get_param', space, parameter); }
  _space_get_direct_state(space: GodotPhysicsRID): unknown { return this.call('_space_get_direct_state', space); }
  _space_set_debug_contacts(space: GodotPhysicsRID, maximum: number): void { this.call('_space_set_debug_contacts', space, maximum); }
  _space_get_contacts(space: GodotPhysicsRID): PackedVector2Array { return packedVector2Array(this.call('_space_get_contacts', space) as Iterable<Vector2>); }
  _space_get_contact_count(space: GodotPhysicsRID): number { return this.int('_space_get_contact_count', space); }

  _area_create(): GodotPhysicsRID { return this.call('_area_create'); }
  _area_set_space(area: GodotPhysicsRID, space: GodotPhysicsRID): void { this.call('_area_set_space', area, space); }
  _area_get_space(area: GodotPhysicsRID): GodotPhysicsRID { return this.call('_area_get_space', area); }
  _area_add_shape(area: GodotPhysicsRID, shape: GodotPhysicsRID, transform: GodotTransform2D, disabled = false): void { this.call('_area_add_shape', area, shape, transform, disabled); }
  _area_set_shape(area: GodotPhysicsRID, index: number, shape: GodotPhysicsRID): void { this.call('_area_set_shape', area, index, shape); }
  _area_set_shape_transform(area: GodotPhysicsRID, index: number, transform: GodotTransform2D): void { this.call('_area_set_shape_transform', area, index, transform); }
  _area_set_shape_disabled(area: GodotPhysicsRID, index: number, disabled: boolean): void { this.call('_area_set_shape_disabled', area, index, disabled); }
  _area_get_shape_count(area: GodotPhysicsRID): number { return this.int('_area_get_shape_count', area); }
  _area_get_shape(area: GodotPhysicsRID, index: number): GodotPhysicsRID { return this.call('_area_get_shape', area, index); }
  _area_get_shape_transform(area: GodotPhysicsRID, index: number): GodotTransform2D { return this.call('_area_get_shape_transform', area, index) as GodotTransform2D; }
  _area_remove_shape(area: GodotPhysicsRID, index: number): void { this.call('_area_remove_shape', area, index); }
  _area_clear_shapes(area: GodotPhysicsRID): void { this.call('_area_clear_shapes', area); }
  _area_attach_object_instance_id(area: GodotPhysicsRID, id: number | bigint): void { this.call('_area_attach_object_instance_id', area, id); }
  _area_get_object_instance_id(area: GodotPhysicsRID): number { return this.int('_area_get_object_instance_id', area); }
  _area_attach_canvas_instance_id(area: GodotPhysicsRID, id: number | bigint): void { this.call('_area_attach_canvas_instance_id', area, id); }
  _area_get_canvas_instance_id(area: GodotPhysicsRID): number { return this.int('_area_get_canvas_instance_id', area); }
  _area_set_param(area: GodotPhysicsRID, parameter: number, value: unknown): void { this.call('_area_set_param', area, parameter, value); }
  _area_set_transform(area: GodotPhysicsRID, transform: GodotTransform2D): void { this.call('_area_set_transform', area, transform); }
  _area_get_param(area: GodotPhysicsRID, parameter: number): unknown { return this.call('_area_get_param', area, parameter); }
  _area_get_transform(area: GodotPhysicsRID): GodotTransform2D { return this.call('_area_get_transform', area) as GodotTransform2D; }
  _area_set_collision_layer(area: GodotPhysicsRID, layer: number): void { this.call('_area_set_collision_layer', area, layer); }
  _area_get_collision_layer(area: GodotPhysicsRID): number { return this.int('_area_get_collision_layer', area); }
  _area_set_collision_mask(area: GodotPhysicsRID, mask: number): void { this.call('_area_set_collision_mask', area, mask); }
  _area_get_collision_mask(area: GodotPhysicsRID): number { return this.int('_area_get_collision_mask', area); }
  _area_set_monitorable(area: GodotPhysicsRID, monitorable: boolean): void { this.call('_area_set_monitorable', area, monitorable); }
  _area_set_pickable(area: GodotPhysicsRID, pickable: boolean): void { this.call('_area_set_pickable', area, pickable); }
  _area_set_monitor_callback(area: GodotPhysicsRID, callback: unknown): void { this.call('_area_set_monitor_callback', area, callback); }
  _area_set_area_monitor_callback(area: GodotPhysicsRID, callback: unknown): void { this.call('_area_set_area_monitor_callback', area, callback); }

  _body_create(): GodotPhysicsRID { return this.call('_body_create'); }
  _body_set_space(body: GodotPhysicsRID, space: GodotPhysicsRID): void { this.call('_body_set_space', body, space); }
  _body_get_space(body: GodotPhysicsRID): GodotPhysicsRID { return this.call('_body_get_space', body); }
  _body_set_mode(body: GodotPhysicsRID, mode: number): void { this.call('_body_set_mode', body, mode); }
  _body_get_mode(body: GodotPhysicsRID): number { return this.int('_body_get_mode', body); }
  _body_add_shape(body: GodotPhysicsRID, shape: GodotPhysicsRID, transform: GodotTransform2D, disabled = false): void { this.call('_body_add_shape', body, shape, transform, disabled); }
  _body_set_shape(body: GodotPhysicsRID, index: number, shape: GodotPhysicsRID): void { this.call('_body_set_shape', body, index, shape); }
  _body_set_shape_transform(body: GodotPhysicsRID, index: number, transform: GodotTransform2D): void { this.call('_body_set_shape_transform', body, index, transform); }
  _body_get_shape_count(body: GodotPhysicsRID): number { return this.int('_body_get_shape_count', body); }
  _body_get_shape(body: GodotPhysicsRID, index: number): GodotPhysicsRID { return this.call('_body_get_shape', body, index); }
  _body_get_shape_transform(body: GodotPhysicsRID, index: number): GodotTransform2D { return this.call('_body_get_shape_transform', body, index) as GodotTransform2D; }
  _body_set_shape_disabled(body: GodotPhysicsRID, index: number, disabled: boolean): void { this.call('_body_set_shape_disabled', body, index, disabled); }
  _body_set_shape_as_one_way_collision(body: GodotPhysicsRID, index: number, enabled: boolean, margin: number, direction: Vector2): void { this.call('_body_set_shape_as_one_way_collision', body, index, enabled, margin, direction); }
  _body_remove_shape(body: GodotPhysicsRID, index: number): void { this.call('_body_remove_shape', body, index); }
  _body_clear_shapes(body: GodotPhysicsRID): void { this.call('_body_clear_shapes', body); }
  _body_attach_object_instance_id(body: GodotPhysicsRID, id: number | bigint): void { this.call('_body_attach_object_instance_id', body, id); }
  _body_get_object_instance_id(body: GodotPhysicsRID): number { return this.int('_body_get_object_instance_id', body); }
  _body_attach_canvas_instance_id(body: GodotPhysicsRID, id: number | bigint): void { this.call('_body_attach_canvas_instance_id', body, id); }
  _body_get_canvas_instance_id(body: GodotPhysicsRID): number { return this.int('_body_get_canvas_instance_id', body); }
  _body_set_continuous_collision_detection_mode(body: GodotPhysicsRID, mode: number): void { this.call('_body_set_continuous_collision_detection_mode', body, mode); }
  _body_get_continuous_collision_detection_mode(body: GodotPhysicsRID): number { return this.int('_body_get_continuous_collision_detection_mode', body); }
  _body_set_collision_layer(body: GodotPhysicsRID, layer: number): void { this.call('_body_set_collision_layer', body, layer); }
  _body_get_collision_layer(body: GodotPhysicsRID): number { return this.int('_body_get_collision_layer', body); }
  _body_set_collision_mask(body: GodotPhysicsRID, mask: number): void { this.call('_body_set_collision_mask', body, mask); }
  _body_get_collision_mask(body: GodotPhysicsRID): number { return this.int('_body_get_collision_mask', body); }
  _body_set_collision_priority(body: GodotPhysicsRID, priority: number): void { this.call('_body_set_collision_priority', body, priority); }
  _body_get_collision_priority(body: GodotPhysicsRID): number { return this.num('_body_get_collision_priority', body); }
  _body_set_param(body: GodotPhysicsRID, parameter: number, value: unknown): void { this.call('_body_set_param', body, parameter, value); }
  _body_get_param(body: GodotPhysicsRID, parameter: number): unknown { return this.call('_body_get_param', body, parameter); }
  _body_reset_mass_properties(body: GodotPhysicsRID): void { this.call('_body_reset_mass_properties', body); }
  _body_set_state(body: GodotPhysicsRID, state: number, value: unknown): void { this.call('_body_set_state', body, state, value); }
  _body_get_state(body: GodotPhysicsRID, state: number): unknown { return this.call('_body_get_state', body, state); }
  _body_apply_central_impulse(body: GodotPhysicsRID, impulse: Vector2): void { this.call('_body_apply_central_impulse', body, impulse); }
  _body_apply_torque_impulse(body: GodotPhysicsRID, impulse: number): void { this.call('_body_apply_torque_impulse', body, impulse); }
  _body_apply_impulse(body: GodotPhysicsRID, impulse: Vector2, position = { x: 0, y: 0 }): void { this.call('_body_apply_impulse', body, impulse, position); }
  _body_apply_central_force(body: GodotPhysicsRID, force: Vector2): void { this.call('_body_apply_central_force', body, force); }
  _body_apply_force(body: GodotPhysicsRID, force: Vector2, position = { x: 0, y: 0 }): void { this.call('_body_apply_force', body, force, position); }
  _body_apply_torque(body: GodotPhysicsRID, torque: number): void { this.call('_body_apply_torque', body, torque); }
  _body_add_constant_central_force(body: GodotPhysicsRID, force: Vector2): void { this.call('_body_add_constant_central_force', body, force); }
  _body_add_constant_force(body: GodotPhysicsRID, force: Vector2, position = { x: 0, y: 0 }): void { this.call('_body_add_constant_force', body, force, position); }
  _body_add_constant_torque(body: GodotPhysicsRID, torque: number): void { this.call('_body_add_constant_torque', body, torque); }
  _body_set_constant_force(body: GodotPhysicsRID, force: Vector2): void { this.call('_body_set_constant_force', body, force); }
  _body_get_constant_force(body: GodotPhysicsRID): Vector2 { return this.vec('_body_get_constant_force', body); }
  _body_set_constant_torque(body: GodotPhysicsRID, torque: number): void { this.call('_body_set_constant_torque', body, torque); }
  _body_get_constant_torque(body: GodotPhysicsRID): number { return this.num('_body_get_constant_torque', body); }
  _body_set_axis_velocity(body: GodotPhysicsRID, velocity: Vector2): void { this.call('_body_set_axis_velocity', body, velocity); }
  _body_add_collision_exception(body: GodotPhysicsRID, exceptedBody: GodotPhysicsRID): void { this.call('_body_add_collision_exception', body, exceptedBody); }
  _body_remove_collision_exception(body: GodotPhysicsRID, exceptedBody: GodotPhysicsRID): void { this.call('_body_remove_collision_exception', body, exceptedBody); }
  _body_get_collision_exceptions(body: GodotPhysicsRID): readonly GodotPhysicsRID[] { return [...(this.call('_body_get_collision_exceptions', body) as Iterable<GodotPhysicsRID>)]; }
  _body_set_max_contacts_reported(body: GodotPhysicsRID, amount: number): void { this.call('_body_set_max_contacts_reported', body, amount); }
  _body_get_max_contacts_reported(body: GodotPhysicsRID): number { return this.int('_body_get_max_contacts_reported', body); }
  _body_set_contacts_reported_depth_threshold(body: GodotPhysicsRID, threshold: number): void { this.call('_body_set_contacts_reported_depth_threshold', body, threshold); }
  _body_get_contacts_reported_depth_threshold(body: GodotPhysicsRID): number { return this.num('_body_get_contacts_reported_depth_threshold', body); }
  _body_set_omit_force_integration(body: GodotPhysicsRID, enabled: boolean): void { this.call('_body_set_omit_force_integration', body, enabled); }
  _body_is_omitting_force_integration(body: GodotPhysicsRID): boolean { return this.bool('_body_is_omitting_force_integration', body); }
  _body_set_state_sync_callback(body: GodotPhysicsRID, callback: unknown): void { this.call('_body_set_state_sync_callback', body, callback); }
  _body_set_force_integration_callback(body: GodotPhysicsRID, callback: unknown, userData: unknown = null): void { this.call('_body_set_force_integration_callback', body, callback, userData); }
  _body_collide_shape(body: GodotPhysicsRID, bodyShape: number, shape: GodotPhysicsRID, transform: GodotTransform2D, motion: Vector2, results: unknown[], resultMax: number): boolean { return this.bool('_body_collide_shape', body, bodyShape, shape, transform, motion, results, resultMax); }
  _body_set_pickable(body: GodotPhysicsRID, pickable: boolean): void { this.call('_body_set_pickable', body, pickable); }
  _body_get_direct_state(body: GodotPhysicsRID): unknown { return this.call('_body_get_direct_state', body); }
  _body_test_motion(body: GodotPhysicsRID, from: GodotTransform2D, motion: Vector2, margin: number, collideSeparationRay: boolean, recoveryAsCollision: boolean, result: unknown): boolean { return this.bool('_body_test_motion', body, from, motion, margin, collideSeparationRay, recoveryAsCollision, result); }

  _joint_create(): GodotPhysicsRID { return this.call('_joint_create'); }
  _joint_clear(joint: GodotPhysicsRID): void { this.call('_joint_clear', joint); }
  _joint_set_param(joint: GodotPhysicsRID, parameter: number, value: number): void { this.call('_joint_set_param', joint, parameter, value); }
  _joint_get_param(joint: GodotPhysicsRID, parameter: number): number { return this.num('_joint_get_param', joint, parameter); }
  _joint_disable_collisions_between_bodies(joint: GodotPhysicsRID, disable: boolean): void { this.call('_joint_disable_collisions_between_bodies', joint, disable); }
  _joint_is_disabled_collisions_between_bodies(joint: GodotPhysicsRID): boolean { return this.bool('_joint_is_disabled_collisions_between_bodies', joint); }
  _joint_make_pin(joint: GodotPhysicsRID, anchor: Vector2, bodyA: GodotPhysicsRID, bodyB: GodotPhysicsRID): void { this.call('_joint_make_pin', joint, anchor, bodyA, bodyB); }
  _joint_make_groove(joint: GodotPhysicsRID, groove1: Vector2, groove2: Vector2, anchor: Vector2, bodyA: GodotPhysicsRID, bodyB: GodotPhysicsRID): void { this.call('_joint_make_groove', joint, groove1, groove2, anchor, bodyA, bodyB); }
  _joint_make_damped_spring(joint: GodotPhysicsRID, anchorA: Vector2, anchorB: Vector2, bodyA: GodotPhysicsRID, bodyB: GodotPhysicsRID): void { this.call('_joint_make_damped_spring', joint, anchorA, anchorB, bodyA, bodyB); }
  _pin_joint_set_flag(joint: GodotPhysicsRID, flag: number, enabled: boolean): void { this.call('_pin_joint_set_flag', joint, flag, enabled); }
  _pin_joint_get_flag(joint: GodotPhysicsRID, flag: number): boolean { return this.bool('_pin_joint_get_flag', joint, flag); }
  _pin_joint_set_param(joint: GodotPhysicsRID, parameter: number, value: number): void { this.call('_pin_joint_set_param', joint, parameter, value); }
  _pin_joint_get_param(joint: GodotPhysicsRID, parameter: number): number { return this.num('_pin_joint_get_param', joint, parameter); }
  _damped_spring_joint_set_param(joint: GodotPhysicsRID, parameter: number, value: number): void { this.call('_damped_spring_joint_set_param', joint, parameter, value); }
  _damped_spring_joint_get_param(joint: GodotPhysicsRID, parameter: number): number { return this.num('_damped_spring_joint_get_param', joint, parameter); }
  _joint_get_type(joint: GodotPhysicsRID): number { return this.int('_joint_get_type', joint); }

  _free_rid(rid: GodotPhysicsRID): void { this.call('_free_rid', rid); }
  _set_active(active: boolean): void { this.call('_set_active', active); }
  _init(): void { this.call('_init'); }
  _step(step: number): void { this.call('_step', step); }
  _sync(): void { this.call('_sync'); }
  _flush_queries(): void { this.call('_flush_queries'); }
  _end_sync(): void { this.call('_end_sync'); }
  _finish(): void { this.call('_finish'); }
  _is_flushing_queries(): boolean { return this.bool('_is_flushing_queries'); }
  _get_process_info(info: number): number { return this.int('_get_process_info', info); }
  body_test_motion_is_excluding_body(body: GodotPhysicsRID): boolean { return this.bool('body_test_motion_is_excluding_body', body); }
  body_test_motion_is_excluding_object(object: number | bigint): boolean { return this.bool('body_test_motion_is_excluding_object', object); }
}

export function createGodotPhysicsServer2DExtension(carrier: GodotPhysicsServer2DExtensionCarrier): GodotPhysicsServer2DExtension { return new GodotPhysicsServer2DExtension(carrier); }
