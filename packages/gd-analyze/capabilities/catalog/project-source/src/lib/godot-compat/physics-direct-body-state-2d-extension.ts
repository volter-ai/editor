/** Godot PhysicsDirectBodyState2DExtension over an exact project physics carrier. */

import { registerGodotObjectIdentity } from './object';
import type { GodotTransform2D } from './transform-2d';
import type { Vector2 } from './vector2';

export type GodotPhysicsRID = unknown;

export interface GodotPhysicsDirectBodyState2DExtensionHooks {
  _get_total_gravity(): Vector2;
  _get_total_linear_damp(): number;
  _get_total_angular_damp(): number;
  _get_center_of_mass(): Vector2;
  _get_center_of_mass_local(): Vector2;
  _get_inverse_mass(): number;
  _get_inverse_inertia(): number;
  _set_linear_velocity(value: Vector2): void;
  _get_linear_velocity(): Vector2;
  _set_angular_velocity(value: number): void;
  _get_angular_velocity(): number;
  _set_transform(value: GodotTransform2D): void;
  _get_transform(): GodotTransform2D;
  _get_velocity_at_local_position(position: Vector2): Vector2;
  _apply_central_impulse(value: Vector2): void;
  _apply_impulse(value: Vector2, position: Vector2): void;
  _apply_torque_impulse(value: number): void;
  _apply_central_force(value: Vector2): void;
  _apply_force(value: Vector2, position: Vector2): void;
  _apply_torque(value: number): void;
  _add_constant_central_force(value: Vector2): void;
  _add_constant_force(value: Vector2, position: Vector2): void;
  _add_constant_torque(value: number): void;
  _set_constant_force(value: Vector2): void;
  _get_constant_force(): Vector2;
  _set_constant_torque(value: number): void;
  _get_constant_torque(): number;
  _set_sleep_state(enabled: boolean): void;
  _is_sleeping(): boolean;
  _set_collision_layer(layer: number): void;
  _get_collision_layer(): number;
  _set_collision_mask(mask: number): void;
  _get_collision_mask(): number;
  _get_contact_count(): number;
  _get_contact_local_position(index: number): Vector2;
  _get_contact_local_normal(index: number): Vector2;
  _get_contact_local_shape(index: number): number;
  _get_contact_local_velocity_at_position(index: number): Vector2;
  _get_contact_collider(index: number): GodotPhysicsRID;
  _get_contact_collider_position(index: number): Vector2;
  _get_contact_collider_id(index: number): number;
  _get_contact_collider_object(index: number): object | null;
  _get_contact_collider_shape(index: number): number;
  _get_contact_collider_velocity_at_position(index: number): Vector2;
  _get_contact_impulse(index: number): Vector2;
  _get_step(): number;
  _integrate_forces(): void;
  _get_space_state(): unknown;
}

function vector(value: Vector2, member: string): Vector2 {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError(`PhysicsDirectBodyState2DExtension.${member} requires finite Vector2.`);
  return { x: value.x, y: value.y };
}
function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`PhysicsDirectBodyState2DExtension.${member} requires finite float.`);
  return value;
}

export class GodotPhysicsDirectBodyState2DExtension {
  constructor(private readonly hooks: GodotPhysicsDirectBodyState2DExtensionHooks) {
    registerGodotObjectIdentity(this, 'PhysicsDirectBodyState2DExtension');
  }
  _get_total_gravity(): Vector2 { return vector(this.hooks._get_total_gravity(), 'total_gravity'); }
  _get_total_linear_damp(): number { return finite(this.hooks._get_total_linear_damp(), 'total_linear_damp'); }
  _get_total_angular_damp(): number { return finite(this.hooks._get_total_angular_damp(), 'total_angular_damp'); }
  _get_center_of_mass(): Vector2 { return vector(this.hooks._get_center_of_mass(), 'center_of_mass'); }
  _get_center_of_mass_local(): Vector2 { return vector(this.hooks._get_center_of_mass_local(), 'center_of_mass_local'); }
  _get_inverse_mass(): number { return finite(this.hooks._get_inverse_mass(), 'inverse_mass'); }
  _get_inverse_inertia(): number { return finite(this.hooks._get_inverse_inertia(), 'inverse_inertia'); }
  _set_linear_velocity(value: Vector2): void { this.hooks._set_linear_velocity(vector(value, 'linear_velocity')); }
  _get_linear_velocity(): Vector2 { return vector(this.hooks._get_linear_velocity(), 'linear_velocity'); }
  _set_angular_velocity(value: number): void { this.hooks._set_angular_velocity(finite(value, 'angular_velocity')); }
  _get_angular_velocity(): number { return finite(this.hooks._get_angular_velocity(), 'angular_velocity'); }
  _set_transform(value: GodotTransform2D): void { this.hooks._set_transform(value); }
  _get_transform(): GodotTransform2D { return this.hooks._get_transform(); }
  _get_velocity_at_local_position(position: Vector2): Vector2 { return vector(this.hooks._get_velocity_at_local_position(vector(position, 'local_position')), 'velocity_at_local_position'); }
  _apply_central_impulse(value: Vector2): void { this.hooks._apply_central_impulse(vector(value, 'central_impulse')); }
  _apply_impulse(value: Vector2, position: Vector2 = { x: 0, y: 0 }): void { this.hooks._apply_impulse(vector(value, 'impulse'), vector(position, 'impulse_position')); }
  _apply_torque_impulse(value: number): void { this.hooks._apply_torque_impulse(finite(value, 'torque_impulse')); }
  _apply_central_force(value: Vector2): void { this.hooks._apply_central_force(vector(value, 'central_force')); }
  _apply_force(value: Vector2, position: Vector2 = { x: 0, y: 0 }): void { this.hooks._apply_force(vector(value, 'force'), vector(position, 'force_position')); }
  _apply_torque(value: number): void { this.hooks._apply_torque(finite(value, 'torque')); }
  _add_constant_central_force(value: Vector2): void { this.hooks._add_constant_central_force(vector(value, 'constant_central_force')); }
  _add_constant_force(value: Vector2, position: Vector2 = { x: 0, y: 0 }): void { this.hooks._add_constant_force(vector(value, 'constant_force'), vector(position, 'constant_force_position')); }
  _add_constant_torque(value: number): void { this.hooks._add_constant_torque(finite(value, 'constant_torque')); }
  _set_constant_force(value: Vector2): void { this.hooks._set_constant_force(vector(value, 'constant_force')); }
  _get_constant_force(): Vector2 { return vector(this.hooks._get_constant_force(), 'constant_force'); }
  _set_constant_torque(value: number): void { this.hooks._set_constant_torque(finite(value, 'constant_torque')); }
  _get_constant_torque(): number { return finite(this.hooks._get_constant_torque(), 'constant_torque'); }
  _set_sleep_state(enabled: boolean): void { this.hooks._set_sleep_state(Boolean(enabled)); }
  _is_sleeping(): boolean { return Boolean(this.hooks._is_sleeping()); }
  _set_collision_layer(layer: number): void { this.hooks._set_collision_layer(this.mask(layer, 'collision_layer')); }
  _get_collision_layer(): number { return this.mask(this.hooks._get_collision_layer(), 'collision_layer'); }
  _set_collision_mask(mask: number): void { this.hooks._set_collision_mask(this.mask(mask, 'collision_mask')); }
  _get_collision_mask(): number { return this.mask(this.hooks._get_collision_mask(), 'collision_mask'); }
  _get_contact_count(): number { return Math.max(0, Math.trunc(this.hooks._get_contact_count())); }
  _get_contact_local_position(index: number): Vector2 { return vector(this.hooks._get_contact_local_position(this.contact(index)), 'contact_local_position'); }
  _get_contact_local_normal(index: number): Vector2 { return vector(this.hooks._get_contact_local_normal(this.contact(index)), 'contact_local_normal'); }
  _get_contact_local_shape(index: number): number { return Math.trunc(this.hooks._get_contact_local_shape(this.contact(index))); }
  _get_contact_local_velocity_at_position(index: number): Vector2 { return vector(this.hooks._get_contact_local_velocity_at_position(this.contact(index)), 'contact_local_velocity'); }
  _get_contact_collider(index: number): GodotPhysicsRID { return this.hooks._get_contact_collider(this.contact(index)); }
  _get_contact_collider_position(index: number): Vector2 { return vector(this.hooks._get_contact_collider_position(this.contact(index)), 'contact_collider_position'); }
  _get_contact_collider_id(index: number): number { return Math.trunc(this.hooks._get_contact_collider_id(this.contact(index))); }
  _get_contact_collider_object(index: number): object | null { return this.hooks._get_contact_collider_object(this.contact(index)); }
  _get_contact_collider_shape(index: number): number { return Math.trunc(this.hooks._get_contact_collider_shape(this.contact(index))); }
  _get_contact_collider_velocity_at_position(index: number): Vector2 { return vector(this.hooks._get_contact_collider_velocity_at_position(this.contact(index)), 'contact_collider_velocity'); }
  _get_contact_impulse(index: number): Vector2 { return vector(this.hooks._get_contact_impulse(this.contact(index)), 'contact_impulse'); }
  _get_step(): number { return finite(this.hooks._get_step(), 'step'); }
  _integrate_forces(): void { this.hooks._integrate_forces(); }
  _get_space_state(): unknown { return this.hooks._get_space_state(); }
  private contact(index: number): number {
    const count = this._get_contact_count();
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) throw new RangeError(`Physics body contact requires 0..${Math.max(0, count - 1)}.`);
    return index;
  }
  private mask(value: number, member: string): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError(`Physics body ${member} requires unsigned 32-bit int.`);
    return value;
  }
}

export function createGodotPhysicsDirectBodyState2DExtension(hooks: GodotPhysicsDirectBodyState2DExtensionHooks): GodotPhysicsDirectBodyState2DExtension {
  return new GodotPhysicsDirectBodyState2DExtension(hooks);
}
