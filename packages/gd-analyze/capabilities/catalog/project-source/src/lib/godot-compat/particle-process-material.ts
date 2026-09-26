import { Color, Vector3 } from 'three';
import { bindGodotMaterial, duplicateGodotMaterial } from './material';
import { godotResourceEmitChanged } from './resource-io';

export const GodotParticleParameter = {
  INITIAL_LINEAR_VELOCITY: 0,
  ANGULAR_VELOCITY: 1,
  ORBIT_VELOCITY: 2,
  LINEAR_ACCEL: 3,
  RADIAL_ACCEL: 4,
  TANGENTIAL_ACCEL: 5,
  DAMPING: 6,
  ANGLE: 7,
  SCALE: 8,
  HUE_VARIATION: 9,
  ANIM_SPEED: 10,
  ANIM_OFFSET: 11,
  MAX: 12,
} as const;

export const GodotParticleFlag = {
  ALIGN_Y_TO_VELOCITY: 0,
  ROTATE_Y: 1,
  DISABLE_Z: 2,
  DAMPING_AS_FRICTION: 3,
  MAX: 4,
} as const;

export const GodotParticleEmissionShape = {
  POINT: 0,
  SPHERE: 1,
  SPHERE_SURFACE: 2,
  BOX: 3,
  POINTS: 4,
  DIRECTED_POINTS: 5,
  RING: 6,
  MAX: 7,
} as const;

export const GodotParticleSubEmitterMode = {
  DISABLED: 0,
  CONSTANT: 1,
  AT_END: 2,
  AT_COLLISION: 3,
  AT_START: 4,
  MAX: 5,
} as const;

export const GodotParticleCollisionMode = {
  DISABLED: 0,
  RIGID: 1,
  HIDE_ON_CONTACT: 2,
} as const;

export type GodotParticleParameterValue = Exclude<typeof GodotParticleParameter[keyof typeof GodotParticleParameter], 12>;
export type GodotParticleFlagValue = Exclude<typeof GodotParticleFlag[keyof typeof GodotParticleFlag], 4>;
export type GodotParticleEmissionShapeValue = Exclude<typeof GodotParticleEmissionShape[keyof typeof GodotParticleEmissionShape], 7>;
export type GodotParticleSubEmitterModeValue = Exclude<typeof GodotParticleSubEmitterMode[keyof typeof GodotParticleSubEmitterMode], 5>;
export type GodotParticleCollisionModeValue = typeof GodotParticleCollisionMode[keyof typeof GodotParticleCollisionMode];

export interface GodotParticleParameterRange {
  minimum: number;
  maximum: number;
  curve: unknown;
}

export interface GodotParticleProcessMaterialOptions {
  readonly direction?: Vector3;
  readonly spread?: number;
  readonly flatness?: number;
  readonly gravity?: Vector3;
  readonly lifetimeRandomness?: number;
  readonly emissionShape?: GodotParticleEmissionShapeValue;
  readonly color?: Color;
}

function finite(member: string, value: number, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`ParticleProcessMaterial.${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function natural(member: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`ParticleProcessMaterial.${member} requires a nonnegative integer.`);
  }
  return value;
}

function vector(member: string, value: Vector3): Vector3 {
  if (![value.x, value.y, value.z].every((component) => Number.isFinite(component))) {
    throw new RangeError(`ParticleProcessMaterial.${member} requires finite vector components.`);
  }
  return value.clone();
}

function parameter(value: number): GodotParticleParameterValue {
  if (!Number.isInteger(value) || value < 0 || value >= GodotParticleParameter.MAX) {
    throw new RangeError('ParticleProcessMaterial parameter must be in [0, PARAM_MAX).');
  }
  return value as GodotParticleParameterValue;
}

function flag(value: number): GodotParticleFlagValue {
  if (!Number.isInteger(value) || value < 0 || value >= GodotParticleFlag.MAX) {
    throw new RangeError('ParticleProcessMaterial flag must be in [0, PARTICLE_FLAG_MAX).');
  }
  return value as GodotParticleFlagValue;
}

function newRanges(): GodotParticleParameterRange[] {
  return Array.from({ length: GodotParticleParameter.MAX }, (_, index) => ({
    minimum: index === GodotParticleParameter.SCALE ? 1 : 0,
    maximum: index === GodotParticleParameter.SCALE ? 1 : 0,
    curve: null,
  }));
}

export class GodotParticleProcessMaterial {
  private readonly directionValue: Vector3;
  private spreadValue: number;
  private flatnessValue: number;
  private readonly gravityValue: Vector3;
  private lifetimeRandomnessValue: number;
  private readonly parameterRanges = newRanges();
  private readonly particleFlags = [false, false, false, false];
  private emissionShapeValue: GodotParticleEmissionShapeValue;
  private readonly emissionSphereDirection = new Vector3(0, 1, 0);
  private emissionSphereRadiusValue = 1;
  private emissionSphereInnerRadiusValue = 0;
  private readonly emissionBoxExtentsValue = new Vector3(1, 1, 1);
  private emissionPointTextureValue: unknown = null;
  private emissionNormalTextureValue: unknown = null;
  private emissionColorTextureValue: unknown = null;
  private emissionPointCountValue = 1;
  private emissionRingAxisValue = new Vector3(0, 0, 1);
  private emissionRingHeightValue = 1;
  private emissionRingRadiusValue = 1;
  private emissionRingInnerRadiusValue = 0;
  private readonly colorValue: Color;
  private colorRampValue: unknown = null;
  private colorInitialRampValue: unknown = null;
  private inheritVelocityRatioValue = 0;
  private subEmitterModeValue: GodotParticleSubEmitterModeValue = GodotParticleSubEmitterMode.DISABLED;
  private subEmitterFrequencyValue = 4;
  private subEmitterAmountAtEndValue = 1;
  private subEmitterAmountAtCollisionValue = 1;
  private subEmitterAmountAtStartValue = 1;
  private turbulenceEnabledValue = false;
  private turbulenceNoiseStrengthValue = 1;
  private turbulenceNoiseScaleValue = 9;
  private turbulenceNoiseSpeedValue = new Vector3(0, 0, 0);
  private turbulenceNoiseSpeedRandomValue = 0.2;
  private turbulenceInfluenceMinValue = 0.1;
  private turbulenceInfluenceMaxValue = 0.1;
  private turbulenceInfluenceOverLifeValue: unknown = null;
  private collisionModeValue: GodotParticleCollisionModeValue = GodotParticleCollisionMode.DISABLED;
  private collisionFrictionValue = 0;
  private collisionBounceValue = 0;
  private collisionUseScaleValue = false;
  private attractorInteractionEnabledValue = true;

  constructor(options: GodotParticleProcessMaterialOptions = {}) {
    this.directionValue = vector('direction', options.direction ?? new Vector3(1, 0, 0));
    this.spreadValue = finite('spread', options.spread ?? 45, 0, 180);
    this.flatnessValue = finite('flatness', options.flatness ?? 0, 0, 1);
    this.gravityValue = vector('gravity', options.gravity ?? new Vector3(0, -9.8, 0));
    this.lifetimeRandomnessValue = finite('lifetime_randomness', options.lifetimeRandomness ?? 0, 0, 1);
    this.emissionShapeValue = options.emissionShape ?? GodotParticleEmissionShape.POINT;
    this.colorValue = (options.color ?? new Color(1, 1, 1)).clone();
    bindGodotMaterial<GodotParticleProcessMaterial>(this, {}, 'ParticleProcessMaterial', {
      createDuplicate: (source) => source.copy(),
    });
  }

  set_direction(value: Vector3): void { this.directionValue.copy(vector('direction', value)); this.changed(); }
  get_direction(): Vector3 { return this.directionValue.clone(); }
  set_spread(value: number): void { this.spreadValue = finite('spread', value, 0, 180); this.changed(); }
  get_spread(): number { return this.spreadValue; }
  set_flatness(value: number): void { this.flatnessValue = finite('flatness', value, 0, 1); this.changed(); }
  get_flatness(): number { return this.flatnessValue; }
  set_gravity(value: Vector3): void { this.gravityValue.copy(vector('gravity', value)); this.changed(); }
  get_gravity(): Vector3 { return this.gravityValue.clone(); }
  set_lifetime_randomness(value: number): void { this.lifetimeRandomnessValue = finite('lifetime_randomness', value, 0, 1); this.changed(); }
  get_lifetime_randomness(): number { return this.lifetimeRandomnessValue; }

  set_param_min(which: number, value: number): void {
    const range = this.range(which);
    range.minimum = finite(`param_${which}_min`, value);
    this.changed();
  }
  get_param_min(which: number): number { return this.range(which).minimum; }
  set_param_max(which: number, value: number): void {
    const range = this.range(which);
    range.maximum = finite(`param_${which}_max`, value);
    this.changed();
  }
  get_param_max(which: number): number { return this.range(which).maximum; }
  set_param(which: number, value: number): void { this.set_param_max(which, value); this.range(which).minimum = value; }
  get_param(which: number): number { return this.get_param_max(which); }
  set_param_curve(which: number, value: unknown): void { this.range(which).curve = value; this.changed(); }
  get_param_curve(which: number): unknown { return this.range(which).curve; }

  set_particle_flag(which: number, enabled: boolean): void { this.particleFlags[flag(which)] = enabled; this.changed(); }
  get_particle_flag(which: number): boolean { return this.particleFlags[flag(which)] ?? false; }

  set_emission_shape(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= GodotParticleEmissionShape.MAX) {
      throw new RangeError('ParticleProcessMaterial.emission_shape requires a valid emission shape.');
    }
    this.emissionShapeValue = value as GodotParticleEmissionShapeValue;
    this.changed();
  }
  get_emission_shape(): GodotParticleEmissionShapeValue { return this.emissionShapeValue; }
  set_emission_sphere_direction(value: Vector3): void { this.emissionSphereDirection.copy(vector('emission_sphere_direction', value)); this.changed(); }
  get_emission_sphere_direction(): Vector3 { return this.emissionSphereDirection.clone(); }
  set_emission_sphere_radius(value: number): void { this.emissionSphereRadiusValue = finite('emission_sphere_radius', value, 0); this.changed(); }
  get_emission_sphere_radius(): number { return this.emissionSphereRadiusValue; }
  set_emission_sphere_inner_radius(value: number): void { this.emissionSphereInnerRadiusValue = finite('emission_sphere_inner_radius', value, 0); this.changed(); }
  get_emission_sphere_inner_radius(): number { return this.emissionSphereInnerRadiusValue; }
  set_emission_box_extents(value: Vector3): void {
    const next = vector('emission_box_extents', value);
    if (next.x < 0 || next.y < 0 || next.z < 0) throw new RangeError('ParticleProcessMaterial.emission_box_extents requires nonnegative components.');
    this.emissionBoxExtentsValue.copy(next); this.changed();
  }
  get_emission_box_extents(): Vector3 { return this.emissionBoxExtentsValue.clone(); }
  set_emission_point_texture(value: unknown): void { this.emissionPointTextureValue = value; this.changed(); }
  get_emission_point_texture(): unknown { return this.emissionPointTextureValue; }
  set_emission_normal_texture(value: unknown): void { this.emissionNormalTextureValue = value; this.changed(); }
  get_emission_normal_texture(): unknown { return this.emissionNormalTextureValue; }
  set_emission_color_texture(value: unknown): void { this.emissionColorTextureValue = value; this.changed(); }
  get_emission_color_texture(): unknown { return this.emissionColorTextureValue; }
  set_emission_point_count(value: number): void { this.emissionPointCountValue = natural('emission_point_count', value); this.changed(); }
  get_emission_point_count(): number { return this.emissionPointCountValue; }
  set_emission_ring_axis(value: Vector3): void { this.emissionRingAxisValue = vector('emission_ring_axis', value); this.changed(); }
  get_emission_ring_axis(): Vector3 { return this.emissionRingAxisValue.clone(); }
  set_emission_ring_height(value: number): void { this.emissionRingHeightValue = finite('emission_ring_height', value, 0); this.changed(); }
  get_emission_ring_height(): number { return this.emissionRingHeightValue; }
  set_emission_ring_radius(value: number): void { this.emissionRingRadiusValue = finite('emission_ring_radius', value, 0); this.changed(); }
  get_emission_ring_radius(): number { return this.emissionRingRadiusValue; }
  set_emission_ring_inner_radius(value: number): void { this.emissionRingInnerRadiusValue = finite('emission_ring_inner_radius', value, 0); this.changed(); }
  get_emission_ring_inner_radius(): number { return this.emissionRingInnerRadiusValue; }

  set_color(value: Color): void { this.colorValue.copy(value); this.changed(); }
  get_color(): Color { return this.colorValue.clone(); }
  set_color_ramp(value: unknown): void { this.colorRampValue = value; this.changed(); }
  get_color_ramp(): unknown { return this.colorRampValue; }
  set_color_initial_ramp(value: unknown): void { this.colorInitialRampValue = value; this.changed(); }
  get_color_initial_ramp(): unknown { return this.colorInitialRampValue; }
  set_inherit_velocity_ratio(value: number): void { this.inheritVelocityRatioValue = finite('inherit_velocity_ratio', value, 0, 1); this.changed(); }
  get_inherit_velocity_ratio(): number { return this.inheritVelocityRatioValue; }

  set_sub_emitter_mode(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= GodotParticleSubEmitterMode.MAX) throw new RangeError('ParticleProcessMaterial.sub_emitter_mode requires a valid mode.');
    this.subEmitterModeValue = value as GodotParticleSubEmitterModeValue; this.changed();
  }
  get_sub_emitter_mode(): GodotParticleSubEmitterModeValue { return this.subEmitterModeValue; }
  set_sub_emitter_frequency(value: number): void { this.subEmitterFrequencyValue = finite('sub_emitter_frequency', value, 0.01); this.changed(); }
  get_sub_emitter_frequency(): number { return this.subEmitterFrequencyValue; }
  set_sub_emitter_amount_at_end(value: number): void { this.subEmitterAmountAtEndValue = natural('sub_emitter_amount_at_end', value); this.changed(); }
  get_sub_emitter_amount_at_end(): number { return this.subEmitterAmountAtEndValue; }
  set_sub_emitter_amount_at_collision(value: number): void { this.subEmitterAmountAtCollisionValue = natural('sub_emitter_amount_at_collision', value); this.changed(); }
  get_sub_emitter_amount_at_collision(): number { return this.subEmitterAmountAtCollisionValue; }
  set_sub_emitter_amount_at_start(value: number): void { this.subEmitterAmountAtStartValue = natural('sub_emitter_amount_at_start', value); this.changed(); }
  get_sub_emitter_amount_at_start(): number { return this.subEmitterAmountAtStartValue; }
  get_sub_emitter_amount_at_start_curve(): unknown { return null; }

  set_turbulence_enabled(value: boolean): void { this.turbulenceEnabledValue = value; this.changed(); }
  get_turbulence_enabled(): boolean { return this.turbulenceEnabledValue; }
  set_turbulence_noise_strength(value: number): void { this.turbulenceNoiseStrengthValue = finite('turbulence_noise_strength', value, 0); this.changed(); }
  get_turbulence_noise_strength(): number { return this.turbulenceNoiseStrengthValue; }
  set_turbulence_noise_scale(value: number): void { this.turbulenceNoiseScaleValue = finite('turbulence_noise_scale', value, 0.001); this.changed(); }
  get_turbulence_noise_scale(): number { return this.turbulenceNoiseScaleValue; }
  set_turbulence_noise_speed(value: Vector3): void { this.turbulenceNoiseSpeedValue = vector('turbulence_noise_speed', value); this.changed(); }
  get_turbulence_noise_speed(): Vector3 { return this.turbulenceNoiseSpeedValue.clone(); }
  set_turbulence_noise_speed_random(value: number): void { this.turbulenceNoiseSpeedRandomValue = finite('turbulence_noise_speed_random', value, 0, 1); this.changed(); }
  get_turbulence_noise_speed_random(): number { return this.turbulenceNoiseSpeedRandomValue; }
  set_turbulence_influence_min(value: number): void { this.turbulenceInfluenceMinValue = finite('turbulence_influence_min', value); this.changed(); }
  get_turbulence_influence_min(): number { return this.turbulenceInfluenceMinValue; }
  set_turbulence_influence_max(value: number): void { this.turbulenceInfluenceMaxValue = finite('turbulence_influence_max', value); this.changed(); }
  get_turbulence_influence_max(): number { return this.turbulenceInfluenceMaxValue; }
  set_turbulence_influence_over_life(value: unknown): void { this.turbulenceInfluenceOverLifeValue = value; this.changed(); }
  get_turbulence_influence_over_life(): unknown { return this.turbulenceInfluenceOverLifeValue; }

  set_collision_mode(value: number): void {
    if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('ParticleProcessMaterial.collision_mode requires 0, 1, or 2.');
    this.collisionModeValue = value; this.changed();
  }
  get_collision_mode(): GodotParticleCollisionModeValue { return this.collisionModeValue; }
  set_collision_friction(value: number): void { this.collisionFrictionValue = finite('collision_friction', value, 0, 1); this.changed(); }
  get_collision_friction(): number { return this.collisionFrictionValue; }
  set_collision_bounce(value: number): void { this.collisionBounceValue = finite('collision_bounce', value, 0, 1); this.changed(); }
  get_collision_bounce(): number { return this.collisionBounceValue; }
  set_collision_use_scale(value: boolean): void { this.collisionUseScaleValue = value; this.changed(); }
  is_collision_using_scale(): boolean { return this.collisionUseScaleValue; }
  set_attractor_interaction_enabled(value: boolean): void { this.attractorInteractionEnabledValue = value; this.changed(); }
  is_attractor_interaction_enabled(): boolean { return this.attractorInteractionEnabledValue; }

  duplicate(deep = false): GodotParticleProcessMaterial {
    return duplicateGodotMaterial<GodotParticleProcessMaterial>(this, (source) => source.copy(), deep, 'ParticleProcessMaterial');
  }

  private range(which: number): GodotParticleParameterRange {
    return this.parameterRanges[parameter(which)]!;
  }

  private changed(): void {
    godotResourceEmitChanged(this);
  }

  private copy(): GodotParticleProcessMaterial {
    const copy = new GodotParticleProcessMaterial({
      direction: this.directionValue, spread: this.spreadValue, flatness: this.flatnessValue,
      gravity: this.gravityValue, lifetimeRandomness: this.lifetimeRandomnessValue,
      emissionShape: this.emissionShapeValue, color: this.colorValue,
    });
    for (let index = 0; index < GodotParticleParameter.MAX; index += 1) {
      const source = this.parameterRanges[index]!;
      const target = copy.parameterRanges[index]!;
      target.minimum = source.minimum; target.maximum = source.maximum; target.curve = source.curve;
    }
    for (let index = 0; index < GodotParticleFlag.MAX; index += 1) copy.particleFlags[index] = this.particleFlags[index] ?? false;
    copy.emissionSphereDirection.copy(this.emissionSphereDirection);
    copy.emissionSphereRadiusValue = this.emissionSphereRadiusValue;
    copy.emissionSphereInnerRadiusValue = this.emissionSphereInnerRadiusValue;
    copy.emissionBoxExtentsValue.copy(this.emissionBoxExtentsValue);
    copy.emissionPointTextureValue = this.emissionPointTextureValue;
    copy.emissionNormalTextureValue = this.emissionNormalTextureValue;
    copy.emissionColorTextureValue = this.emissionColorTextureValue;
    copy.emissionPointCountValue = this.emissionPointCountValue;
    copy.emissionRingAxisValue.copy(this.emissionRingAxisValue);
    copy.emissionRingHeightValue = this.emissionRingHeightValue;
    copy.emissionRingRadiusValue = this.emissionRingRadiusValue;
    copy.emissionRingInnerRadiusValue = this.emissionRingInnerRadiusValue;
    copy.colorRampValue = this.colorRampValue; copy.colorInitialRampValue = this.colorInitialRampValue;
    copy.inheritVelocityRatioValue = this.inheritVelocityRatioValue;
    copy.subEmitterModeValue = this.subEmitterModeValue; copy.subEmitterFrequencyValue = this.subEmitterFrequencyValue;
    copy.subEmitterAmountAtEndValue = this.subEmitterAmountAtEndValue;
    copy.subEmitterAmountAtCollisionValue = this.subEmitterAmountAtCollisionValue;
    copy.subEmitterAmountAtStartValue = this.subEmitterAmountAtStartValue;
    copy.turbulenceEnabledValue = this.turbulenceEnabledValue;
    copy.turbulenceNoiseStrengthValue = this.turbulenceNoiseStrengthValue;
    copy.turbulenceNoiseScaleValue = this.turbulenceNoiseScaleValue;
    copy.turbulenceNoiseSpeedValue.copy(this.turbulenceNoiseSpeedValue);
    copy.turbulenceNoiseSpeedRandomValue = this.turbulenceNoiseSpeedRandomValue;
    copy.turbulenceInfluenceMinValue = this.turbulenceInfluenceMinValue;
    copy.turbulenceInfluenceMaxValue = this.turbulenceInfluenceMaxValue;
    copy.turbulenceInfluenceOverLifeValue = this.turbulenceInfluenceOverLifeValue;
    copy.collisionModeValue = this.collisionModeValue; copy.collisionFrictionValue = this.collisionFrictionValue;
    copy.collisionBounceValue = this.collisionBounceValue; copy.collisionUseScaleValue = this.collisionUseScaleValue;
    copy.attractorInteractionEnabledValue = this.attractorInteractionEnabledValue;
    return copy;
  }
}

export const createGodotParticleProcessMaterial = (
  options: GodotParticleProcessMaterialOptions = {},
): GodotParticleProcessMaterial => new GodotParticleProcessMaterial(options);
