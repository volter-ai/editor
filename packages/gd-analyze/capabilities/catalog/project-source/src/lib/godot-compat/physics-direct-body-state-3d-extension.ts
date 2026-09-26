/** Godot PhysicsDirectBodyState3DExtension over an exact project physics carrier. */

import { Matrix4, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';
import type { GodotPhysicsRID } from './physics-direct-body-state-2d-extension';

export type GodotPhysicsBasis3D = unknown;

export interface GodotPhysicsDirectBodyState3DExtensionHooks {
  _get_total_gravity(): Vector3; _get_total_linear_damp(): number; _get_total_angular_damp(): number;
  _get_center_of_mass(): Vector3; _get_center_of_mass_local(): Vector3;
  _get_principal_inertia_axes(): GodotPhysicsBasis3D; _get_inverse_mass(): number;
  _get_inverse_inertia(): Vector3; _get_inverse_inertia_tensor(): GodotPhysicsBasis3D;
  _set_linear_velocity(value: Vector3): void; _get_linear_velocity(): Vector3;
  _set_angular_velocity(value: Vector3): void; _get_angular_velocity(): Vector3;
  _set_transform(value: Matrix4): void; _get_transform(): Matrix4;
  _get_velocity_at_local_position(position: Vector3): Vector3;
  _apply_central_impulse(value: Vector3): void; _apply_impulse(value: Vector3, position: Vector3): void;
  _apply_torque_impulse(value: Vector3): void; _apply_central_force(value: Vector3): void;
  _apply_force(value: Vector3, position: Vector3): void; _apply_torque(value: Vector3): void;
  _add_constant_central_force(value: Vector3): void; _add_constant_force(value: Vector3, position: Vector3): void;
  _add_constant_torque(value: Vector3): void; _set_constant_force(value: Vector3): void;
  _get_constant_force(): Vector3; _set_constant_torque(value: Vector3): void; _get_constant_torque(): Vector3;
  _set_sleep_state(enabled: boolean): void; _is_sleeping(): boolean;
  _set_collision_layer(layer: number): void; _get_collision_layer(): number;
  _set_collision_mask(mask: number): void; _get_collision_mask(): number;
  _get_contact_count(): number; _get_contact_local_position(index: number): Vector3;
  _get_contact_local_normal(index: number): Vector3; _get_contact_impulse(index: number): Vector3;
  _get_contact_local_shape(index: number): number; _get_contact_local_velocity_at_position(index: number): Vector3;
  _get_contact_collider(index: number): GodotPhysicsRID; _get_contact_collider_position(index: number): Vector3;
  _get_contact_collider_id(index: number): number; _get_contact_collider_object(index: number): object | null;
  _get_contact_collider_shape(index: number): number; _get_contact_collider_velocity_at_position(index: number): Vector3;
  _get_step(): number; _integrate_forces(): void; _get_space_state(): unknown;
}

function vec(value: Vector3, member: string): Vector3 {
  if (!(value instanceof Vector3) || !Number.isFinite(value.x + value.y + value.z)) {
    throw new TypeError(`PhysicsDirectBodyState3DExtension.${member} requires finite Vector3.`);
  }
  return value.clone();
}
function num(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`PhysicsDirectBodyState3DExtension.${member} requires finite float.`);
  return value;
}

export class GodotPhysicsDirectBodyState3DExtension {
  constructor(private readonly hooks: GodotPhysicsDirectBodyState3DExtensionHooks) {
    registerGodotObjectIdentity(this, 'PhysicsDirectBodyState3DExtension');
  }
  _get_total_gravity(): Vector3 { return vec(this.hooks._get_total_gravity(), 'total_gravity'); }
  _get_total_linear_damp(): number { return num(this.hooks._get_total_linear_damp(), 'total_linear_damp'); }
  _get_total_angular_damp(): number { return num(this.hooks._get_total_angular_damp(), 'total_angular_damp'); }
  _get_center_of_mass(): Vector3 { return vec(this.hooks._get_center_of_mass(), 'center_of_mass'); }
  _get_center_of_mass_local(): Vector3 { return vec(this.hooks._get_center_of_mass_local(), 'center_of_mass_local'); }
  _get_principal_inertia_axes(): GodotPhysicsBasis3D { return this.hooks._get_principal_inertia_axes(); }
  _get_inverse_mass(): number { return num(this.hooks._get_inverse_mass(), 'inverse_mass'); }
  _get_inverse_inertia(): Vector3 { return vec(this.hooks._get_inverse_inertia(), 'inverse_inertia'); }
  _get_inverse_inertia_tensor(): GodotPhysicsBasis3D { return this.hooks._get_inverse_inertia_tensor(); }
  _set_linear_velocity(value: Vector3): void { this.hooks._set_linear_velocity(vec(value, 'linear_velocity')); }
  _get_linear_velocity(): Vector3 { return vec(this.hooks._get_linear_velocity(), 'linear_velocity'); }
  _set_angular_velocity(value: Vector3): void { this.hooks._set_angular_velocity(vec(value, 'angular_velocity')); }
  _get_angular_velocity(): Vector3 { return vec(this.hooks._get_angular_velocity(), 'angular_velocity'); }
  _set_transform(value: Matrix4): void { if (!(value instanceof Matrix4)) throw new TypeError('Physics body transform requires Transform3D.'); this.hooks._set_transform(value.clone()); }
  _get_transform(): Matrix4 { const value = this.hooks._get_transform(); if (!(value instanceof Matrix4)) throw new TypeError('Physics body transform requires Transform3D.'); return value.clone(); }
  _get_velocity_at_local_position(position: Vector3): Vector3 { return vec(this.hooks._get_velocity_at_local_position(vec(position, 'local_position')), 'velocity_at_local_position'); }
  _apply_central_impulse(value: Vector3): void { this.hooks._apply_central_impulse(vec(value, 'central_impulse')); }
  _apply_impulse(value: Vector3, position = new Vector3()): void { this.hooks._apply_impulse(vec(value, 'impulse'), vec(position, 'impulse_position')); }
  _apply_torque_impulse(value: Vector3): void { this.hooks._apply_torque_impulse(vec(value, 'torque_impulse')); }
  _apply_central_force(value: Vector3): void { this.hooks._apply_central_force(vec(value, 'central_force')); }
  _apply_force(value: Vector3, position = new Vector3()): void { this.hooks._apply_force(vec(value, 'force'), vec(position, 'force_position')); }
  _apply_torque(value: Vector3): void { this.hooks._apply_torque(vec(value, 'torque')); }
  _add_constant_central_force(value: Vector3): void { this.hooks._add_constant_central_force(vec(value, 'constant_central_force')); }
  _add_constant_force(value: Vector3, position = new Vector3()): void { this.hooks._add_constant_force(vec(value, 'constant_force'), vec(position, 'constant_force_position')); }
  _add_constant_torque(value: Vector3): void { this.hooks._add_constant_torque(vec(value, 'constant_torque')); }
  _set_constant_force(value: Vector3): void { this.hooks._set_constant_force(vec(value, 'constant_force')); }
  _get_constant_force(): Vector3 { return vec(this.hooks._get_constant_force(), 'constant_force'); }
  _set_constant_torque(value: Vector3): void { this.hooks._set_constant_torque(vec(value, 'constant_torque')); }
  _get_constant_torque(): Vector3 { return vec(this.hooks._get_constant_torque(), 'constant_torque'); }
  _set_sleep_state(enabled: boolean): void { this.hooks._set_sleep_state(Boolean(enabled)); }
  _is_sleeping(): boolean { return Boolean(this.hooks._is_sleeping()); }
  _set_collision_layer(layer: number): void { this.hooks._set_collision_layer(this.mask(layer)); }
  _get_collision_layer(): number { return this.mask(this.hooks._get_collision_layer()); }
  _set_collision_mask(mask: number): void { this.hooks._set_collision_mask(this.mask(mask)); }
  _get_collision_mask(): number { return this.mask(this.hooks._get_collision_mask()); }
  _get_contact_count(): number { return Math.max(0, Math.trunc(this.hooks._get_contact_count())); }
  _get_contact_local_position(index: number): Vector3 { return vec(this.hooks._get_contact_local_position(this.contact(index)), 'contact_local_position'); }
  _get_contact_local_normal(index: number): Vector3 { return vec(this.hooks._get_contact_local_normal(this.contact(index)), 'contact_local_normal'); }
  _get_contact_impulse(index: number): Vector3 { return vec(this.hooks._get_contact_impulse(this.contact(index)), 'contact_impulse'); }
  _get_contact_local_shape(index: number): number { return Math.trunc(this.hooks._get_contact_local_shape(this.contact(index))); }
  _get_contact_local_velocity_at_position(index: number): Vector3 { return vec(this.hooks._get_contact_local_velocity_at_position(this.contact(index)), 'contact_local_velocity'); }
  _get_contact_collider(index: number): GodotPhysicsRID { return this.hooks._get_contact_collider(this.contact(index)); }
  _get_contact_collider_position(index: number): Vector3 { return vec(this.hooks._get_contact_collider_position(this.contact(index)), 'contact_collider_position'); }
  _get_contact_collider_id(index: number): number { return Math.trunc(this.hooks._get_contact_collider_id(this.contact(index))); }
  _get_contact_collider_object(index: number): object | null { return this.hooks._get_contact_collider_object(this.contact(index)); }
  _get_contact_collider_shape(index: number): number { return Math.trunc(this.hooks._get_contact_collider_shape(this.contact(index))); }
  _get_contact_collider_velocity_at_position(index: number): Vector3 { return vec(this.hooks._get_contact_collider_velocity_at_position(this.contact(index)), 'contact_collider_velocity'); }
  _get_step(): number { return num(this.hooks._get_step(), 'step'); }
  _integrate_forces(): void { this.hooks._integrate_forces(); }
  _get_space_state(): unknown { return this.hooks._get_space_state(); }
  private contact(index: number): number {
    const count = this._get_contact_count();
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw new RangeError(`Physics body contact requires 0..${Math.max(0, count - 1)}.`);
    return index;
  }
  private mask(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError('Physics body collision mask requires unsigned 32-bit int.');
    return value;
  }
}

export function createGodotPhysicsDirectBodyState3DExtension(hooks: GodotPhysicsDirectBodyState3DExtensionHooks): GodotPhysicsDirectBodyState3DExtension {
  return new GodotPhysicsDirectBodyState3DExtension(hooks);
}
