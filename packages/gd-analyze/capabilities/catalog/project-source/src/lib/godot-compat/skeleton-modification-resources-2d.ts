/** Stateful SkeletonModification2D LookAt and Jiggle resources. */

import { GodotSkeletonModification2D } from './skeleton-modifiers-2d';

export interface GodotSkeletonModification2DTargetCarrier {
  executeLookAt?(modification: GodotSkeletonModification2DLookAt, delta: number, strength: number): void;
  executeJiggle?(modification: GodotSkeletonModification2DJiggle, delta: number, strength: number): void;
}

interface Vector2Value { readonly x: number; readonly y: number }

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite number.`);
  return value;
}

function nonNegative(value: number, member: string): number {
  const result = finite(value, member);
  if (result < 0) throw new RangeError(`${member} requires a non-negative value.`);
  return result;
}

function vector(value: Vector2Value, member: string): Vector2Value {
  if (value === null || typeof value !== 'object') throw new TypeError(`${member} requires Vector2.`);
  return Object.freeze({ x: finite(Number(value.x), `${member}.x`), y: finite(Number(value.y), `${member}.y`) });
}

function nodePath(value: string, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} requires NodePath.`);
  return value;
}

function boneIndex(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < -1) throw new RangeError(`${member} requires an integer >= -1.`);
  return value;
}

export class GodotSkeletonModification2DLookAt extends GodotSkeletonModification2D {
  private targetNodePathValue = '';
  private boneIndexValue = -1;
  private bone2dNodeValue = '';
  private additionalRotationValue = 0;
  private constraintEnabledValue = false;
  private constraintMinAngleValue = -Math.PI;
  private constraintMaxAngleValue = Math.PI;
  private constraintAngleInvertValue = false;
  private constraintInLocalSpaceValue = false;

  constructor(carrier: GodotSkeletonModification2DTargetCarrier = {}) {
    super({ execute: (modification, delta, strength) => carrier.executeLookAt?.(modification as GodotSkeletonModification2DLookAt, delta, strength) }, 'SkeletonModification2DLookAt');
  }

  set_target_nodepath(value: string): void { this.targetNodePathValue = nodePath(value, 'SkeletonModification2DLookAt.target_nodepath'); }
  get_target_nodepath(): string { return this.targetNodePathValue; }
  set_bone_index(value: number): void { this.boneIndexValue = boneIndex(value, 'SkeletonModification2DLookAt.bone_index'); }
  get_bone_index(): number { return this.boneIndexValue; }
  set_bone2d_node(value: string): void { this.bone2dNodeValue = nodePath(value, 'SkeletonModification2DLookAt.bone2d_node'); }
  get_bone2d_node(): string { return this.bone2dNodeValue; }
  set_additional_rotation(value: number): void { this.additionalRotationValue = finite(value, 'SkeletonModification2DLookAt.additional_rotation'); }
  get_additional_rotation(): number { return this.additionalRotationValue; }
  set_enable_constraint(value: boolean): void { this.constraintEnabledValue = Boolean(value); }
  get_enable_constraint(): boolean { return this.constraintEnabledValue; }
  set_constraint_angle_min(value: number): void {
    const angle = finite(value, 'SkeletonModification2DLookAt.constraint_angle_min');
    if (angle > this.constraintMaxAngleValue) throw new RangeError('LookAt minimum constraint angle cannot exceed maximum.');
    this.constraintMinAngleValue = angle;
  }
  get_constraint_angle_min(): number { return this.constraintMinAngleValue; }
  set_constraint_angle_max(value: number): void {
    const angle = finite(value, 'SkeletonModification2DLookAt.constraint_angle_max');
    if (angle < this.constraintMinAngleValue) throw new RangeError('LookAt maximum constraint angle cannot be less than minimum.');
    this.constraintMaxAngleValue = angle;
  }
  get_constraint_angle_max(): number { return this.constraintMaxAngleValue; }
  set_constraint_angle_invert(value: boolean): void { this.constraintAngleInvertValue = Boolean(value); }
  get_constraint_angle_invert(): boolean { return this.constraintAngleInvertValue; }
  set_constraint_in_localspace(value: boolean): void { this.constraintInLocalSpaceValue = Boolean(value); }
  get_constraint_in_localspace(): boolean { return this.constraintInLocalSpaceValue; }

  constrain_angle(angle: number): number {
    const candidate = finite(angle + this.additionalRotationValue, 'SkeletonModification2DLookAt angle');
    if (!this.constraintEnabledValue) return candidate;
    if (!this.constraintAngleInvertValue) return Math.max(this.constraintMinAngleValue, Math.min(this.constraintMaxAngleValue, candidate));
    if (candidate < this.constraintMinAngleValue || candidate > this.constraintMaxAngleValue) return candidate;
    return candidate - this.constraintMinAngleValue < this.constraintMaxAngleValue - candidate
      ? this.constraintMinAngleValue
      : this.constraintMaxAngleValue;
  }
}

export class GodotSkeletonModification2DJiggle extends GodotSkeletonModification2D {
  private targetNodePathValue = '';
  private boneIndexValue = -1;
  private bone2dNodeValue = '';
  private stiffnessValue = 3;
  private massValue = 0.75;
  private dampingValue = 0.75;
  private useGravityValue = false;
  private gravityValue: Vector2Value = Object.freeze({ x: 0, y: 6 });
  private useCollidersValue = false;
  private collisionMaskValue = 1;
  private jointDataValue: Vector2Value = Object.freeze({ x: 0, y: 0 });
  private lastPositionValue: Vector2Value = Object.freeze({ x: 0, y: 0 });
  private velocityValue: Vector2Value = Object.freeze({ x: 0, y: 0 });

  constructor(carrier: GodotSkeletonModification2DTargetCarrier = {}) {
    super({ execute: (modification, delta, strength) => carrier.executeJiggle?.(modification as GodotSkeletonModification2DJiggle, delta, strength) }, 'SkeletonModification2DJiggle');
  }

  set_target_nodepath(value: string): void { this.targetNodePathValue = nodePath(value, 'SkeletonModification2DJiggle.target_nodepath'); }
  get_target_nodepath(): string { return this.targetNodePathValue; }
  set_bone_index(value: number): void { this.boneIndexValue = boneIndex(value, 'SkeletonModification2DJiggle.bone_index'); }
  get_bone_index(): number { return this.boneIndexValue; }
  set_bone2d_node(value: string): void { this.bone2dNodeValue = nodePath(value, 'SkeletonModification2DJiggle.bone2d_node'); }
  get_bone2d_node(): string { return this.bone2dNodeValue; }
  set_stiffness(value: number): void { this.stiffnessValue = nonNegative(value, 'SkeletonModification2DJiggle.stiffness'); }
  get_stiffness(): number { return this.stiffnessValue; }
  set_mass(value: number): void {
    const mass = nonNegative(value, 'SkeletonModification2DJiggle.mass');
    if (mass === 0) throw new RangeError('SkeletonModification2DJiggle.mass must be greater than zero.');
    this.massValue = mass;
  }
  get_mass(): number { return this.massValue; }
  set_damping(value: number): void { this.dampingValue = nonNegative(value, 'SkeletonModification2DJiggle.damping'); }
  get_damping(): number { return this.dampingValue; }
  set_use_gravity(value: boolean): void { this.useGravityValue = Boolean(value); }
  get_use_gravity(): boolean { return this.useGravityValue; }
  set_gravity(value: Vector2Value): void { this.gravityValue = vector(value, 'SkeletonModification2DJiggle.gravity'); }
  get_gravity(): Vector2Value { return { ...this.gravityValue }; }
  set_use_colliders(value: boolean): void { this.useCollidersValue = Boolean(value); }
  get_use_colliders(): boolean { return this.useCollidersValue; }
  set_collision_mask(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError('SkeletonModification2DJiggle.collision_mask requires uint32.');
    this.collisionMaskValue = value;
  }
  get_collision_mask(): number { return this.collisionMaskValue; }
  set_joint_data(value: Vector2Value): void { this.jointDataValue = vector(value, 'SkeletonModification2DJiggle.joint_data'); }
  get_joint_data(): Vector2Value { return { ...this.jointDataValue }; }
  get_velocity(): Vector2Value { return { ...this.velocityValue }; }
  get_last_position(): Vector2Value { return { ...this.lastPositionValue }; }

  reset_physics_state(position: Vector2Value = { x: 0, y: 0 }): void {
    const point = vector(position, 'SkeletonModification2DJiggle reset position');
    this.lastPositionValue = point;
    this.velocityValue = Object.freeze({ x: 0, y: 0 });
  }

  integrate(target: Vector2Value, delta: number, strength: number): Vector2Value {
    const goal = vector(target, 'SkeletonModification2DJiggle target');
    const step = nonNegative(delta, 'SkeletonModification2DJiggle delta');
    const influence = Math.max(0, Math.min(1, finite(strength, 'SkeletonModification2DJiggle strength')));
    const gravity = this.useGravityValue ? this.gravityValue : { x: 0, y: 0 };
    const acceleration = {
      x: (goal.x - this.lastPositionValue.x) * this.stiffnessValue / this.massValue + gravity.x,
      y: (goal.y - this.lastPositionValue.y) * this.stiffnessValue / this.massValue + gravity.y,
    };
    const attenuation = Math.exp(-this.dampingValue * step);
    this.velocityValue = Object.freeze({
      x: (this.velocityValue.x + acceleration.x * step) * attenuation,
      y: (this.velocityValue.y + acceleration.y * step) * attenuation,
    });
    this.lastPositionValue = Object.freeze({
      x: this.lastPositionValue.x + this.velocityValue.x * step * influence,
      y: this.lastPositionValue.y + this.velocityValue.y * step * influence,
    });
    return { ...this.lastPositionValue };
  }
}

export const createGodotSkeletonModification2DLookAt = (
  carrier: GodotSkeletonModification2DTargetCarrier = {},
): GodotSkeletonModification2DLookAt => new GodotSkeletonModification2DLookAt(carrier);

export const createGodotSkeletonModification2DJiggle = (
  carrier: GodotSkeletonModification2DTargetCarrier = {},
): GodotSkeletonModification2DJiggle => new GodotSkeletonModification2DJiggle(carrier);
