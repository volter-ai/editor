import { Color, Matrix4, Object3D, Vector3 } from 'three';
import { aabb, copyAabb, type GodotAabb } from './aabb';
import { registerGodotObjectIdentity } from './object';
import type { GodotParticleProcessMaterial } from './particle-process-material';

export const GodotGPUParticlesDrawOrder = {
  INDEX: 0,
  LIFETIME: 1,
  REVERSE_LIFETIME: 2,
  VIEW_DEPTH: 3,
} as const;

export const GodotGPUParticlesTransformAlign = {
  DISABLED: 0,
  Z_BILLBOARD: 1,
  Y_TO_VELOCITY: 2,
  Z_BILLBOARD_Y_TO_VELOCITY: 3,
} as const;

export const GodotGPUParticlesEmitFlags = {
  POSITION: 1,
  ROTATION_SCALE: 2,
  VELOCITY: 4,
  COLOR: 8,
  CUSTOM: 16,
} as const;

export type GodotGPUParticlesDrawOrderValue = typeof GodotGPUParticlesDrawOrder[keyof typeof GodotGPUParticlesDrawOrder];
export type GodotGPUParticlesTransformAlignValue = typeof GodotGPUParticlesTransformAlign[keyof typeof GodotGPUParticlesTransformAlign];

export interface GodotGPUParticleEmission {
  readonly transform: Matrix4;
  readonly velocity: Vector3;
  readonly color: Color;
  readonly custom: Color;
  readonly flags: number;
}

export interface GodotGPUParticlesRuntimeCarrier {
  setEmitting(value: boolean): void;
  restart(keepSeed: boolean): void;
  emitParticle(emission: GodotGPUParticleEmission): void;
  requestProcess(time: number): void;
  captureAabb?(): GodotAabb;
  setSpeedScale?(value: number): void;
  setAmount?(amount: number, ratio: number): void;
}

function finite(member: string, value: number, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function integer(member: string, value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return value;
}

function finiteVector(member: string, value: Vector3): Vector3 {
  if (![value.x, value.y, value.z].every((component) => Number.isFinite(component))) {
    throw new RangeError(`${member} requires finite vector components.`);
  }
  return value.clone();
}

export class GodotGPUParticles3D extends Object3D {
  private emittingValue = true;
  private amountValue = 8;
  private amountRatioValue = 1;
  private lifetimeValue = 1;
  private oneShotValue = false;
  private preprocessValue = 0;
  private explosivenessRatioValue = 0;
  private randomnessRatioValue = 0;
  private visibilityAabbValue: GodotAabb = aabb({ x: -4, y: -4, z: -4 }, { x: 8, y: 8, z: 8 });
  private localCoordsValue = false;
  private fixedFpsValue = 30;
  private interpolateValue = true;
  private fractDeltaValue = true;
  private drawOrderValue: GodotGPUParticlesDrawOrderValue = GodotGPUParticlesDrawOrder.INDEX;
  private speedScaleValue = 1;
  private collisionBaseSizeValue = 1;
  private trailEnabledValue = false;
  private trailLifetimeValue = 0.3;
  private transformAlignValue: GodotGPUParticlesTransformAlignValue = GodotGPUParticlesTransformAlign.DISABLED;
  private processMaterialValue: GodotParticleProcessMaterial | null = null;
  private drawPassesValue = 1;
  private readonly drawPassMeshes: unknown[] = [null, null, null, null];
  private skinValue: unknown = null;
  private subEmitterValue: string | Object3D | null = null;
  private useFixedSeedValue = false;
  private seedValue = 0;
  private runtime: GodotGPUParticlesRuntimeCarrier | null = null;
  private readonly pendingEmissions: GodotGPUParticleEmission[] = [];

  constructor() {
    super();
    registerGodotObjectIdentity(this, 'GPUParticles3D');
  }

  bind_runtime(value: GodotGPUParticlesRuntimeCarrier | null): void {
    this.runtime = value;
    if (value === null) return;
    value.setEmitting(this.emittingValue);
    value.setSpeedScale?.(this.speedScaleValue);
    value.setAmount?.(this.amountValue, this.amountRatioValue);
    for (const emission of this.pendingEmissions.splice(0)) value.emitParticle(emission);
  }

  get_runtime(): GodotGPUParticlesRuntimeCarrier | null { return this.runtime; }
  set_emitting(value: boolean): void { this.emittingValue = value; this.runtime?.setEmitting(value); }
  is_emitting(): boolean { return this.emittingValue; }
  set_amount(value: number): void {
    this.amountValue = integer('GPUParticles3D.amount', value, 1);
    this.runtime?.setAmount?.(this.amountValue, this.amountRatioValue);
  }
  get_amount(): number { return this.amountValue; }
  set_amount_ratio(value: number): void {
    this.amountRatioValue = finite('GPUParticles3D.amount_ratio', value, 0, 1);
    this.runtime?.setAmount?.(this.amountValue, this.amountRatioValue);
  }
  get_amount_ratio(): number { return this.amountRatioValue; }
  set_lifetime(value: number): void { this.lifetimeValue = finite('GPUParticles3D.lifetime', value, 0.01); }
  get_lifetime(): number { return this.lifetimeValue; }
  set_one_shot(value: boolean): void { this.oneShotValue = value; }
  get_one_shot(): boolean { return this.oneShotValue; }
  set_pre_process_time(value: number): void { this.preprocessValue = finite('GPUParticles3D.preprocess', value, 0); }
  get_pre_process_time(): number { return this.preprocessValue; }
  set_preprocess(value: number): void { this.set_pre_process_time(value); }
  get_preprocess(): number { return this.preprocessValue; }
  set_explosiveness_ratio(value: number): void { this.explosivenessRatioValue = finite('GPUParticles3D.explosiveness', value, 0, 1); }
  get_explosiveness_ratio(): number { return this.explosivenessRatioValue; }
  set_randomness_ratio(value: number): void { this.randomnessRatioValue = finite('GPUParticles3D.randomness', value, 0, 1); }
  get_randomness_ratio(): number { return this.randomnessRatioValue; }
  set_visibility_aabb(value: GodotAabb): void { this.visibilityAabbValue = copyAabb(value); }
  get_visibility_aabb(): GodotAabb { return copyAabb(this.visibilityAabbValue); }
  set_use_local_coordinates(value: boolean): void { this.localCoordsValue = value; }
  get_use_local_coordinates(): boolean { return this.localCoordsValue; }
  set_fixed_fps(value: number): void { this.fixedFpsValue = integer('GPUParticles3D.fixed_fps', value, 0, 1000); }
  get_fixed_fps(): number { return this.fixedFpsValue; }
  set_interpolate(value: boolean): void { this.interpolateValue = value; }
  get_interpolate(): boolean { return this.interpolateValue; }
  set_fractional_delta(value: boolean): void { this.fractDeltaValue = value; }
  get_fractional_delta(): boolean { return this.fractDeltaValue; }
  set_draw_order(value: number): void {
    if (value !== 0 && value !== 1 && value !== 2 && value !== 3) throw new RangeError('GPUParticles3D.draw_order requires a valid mode.');
    this.drawOrderValue = value;
  }
  get_draw_order(): GodotGPUParticlesDrawOrderValue { return this.drawOrderValue; }
  set_speed_scale(value: number): void {
    this.speedScaleValue = finite('GPUParticles3D.speed_scale', value, 0);
    this.runtime?.setSpeedScale?.(value);
  }
  get_speed_scale(): number { return this.speedScaleValue; }
  set_collision_base_size(value: number): void { this.collisionBaseSizeValue = finite('GPUParticles3D.collision_base_size', value, 0); }
  get_collision_base_size(): number { return this.collisionBaseSizeValue; }
  set_trail_enabled(value: boolean): void { this.trailEnabledValue = value; }
  is_trail_enabled(): boolean { return this.trailEnabledValue; }
  set_trail_lifetime(value: number): void { this.trailLifetimeValue = finite('GPUParticles3D.trail_lifetime', value, 0.01); }
  get_trail_lifetime(): number { return this.trailLifetimeValue; }
  set_transform_align(value: number): void {
    if (value !== 0 && value !== 1 && value !== 2 && value !== 3) throw new RangeError('GPUParticles3D.transform_align requires a valid mode.');
    this.transformAlignValue = value;
  }
  get_transform_align(): GodotGPUParticlesTransformAlignValue { return this.transformAlignValue; }
  set_process_material(value: GodotParticleProcessMaterial | null): void { this.processMaterialValue = value; }
  get_process_material(): GodotParticleProcessMaterial | null { return this.processMaterialValue; }
  set_draw_passes(value: number): void { this.drawPassesValue = integer('GPUParticles3D.draw_passes', value, 0, 4); }
  get_draw_passes(): number { return this.drawPassesValue; }
  set_draw_pass_mesh(pass: number, mesh: unknown): void {
    const index = integer('GPUParticles3D draw pass', pass, 1, 4) - 1;
    this.drawPassMeshes[index] = mesh;
  }
  get_draw_pass_mesh(pass: number): unknown {
    const index = integer('GPUParticles3D draw pass', pass, 1, 4) - 1;
    return this.drawPassMeshes[index] ?? null;
  }
  set_draw_pass_1(value: unknown): void { this.set_draw_pass_mesh(1, value); }
  get_draw_pass_1(): unknown { return this.get_draw_pass_mesh(1); }
  set_draw_pass_2(value: unknown): void { this.set_draw_pass_mesh(2, value); }
  get_draw_pass_2(): unknown { return this.get_draw_pass_mesh(2); }
  set_draw_pass_3(value: unknown): void { this.set_draw_pass_mesh(3, value); }
  get_draw_pass_3(): unknown { return this.get_draw_pass_mesh(3); }
  set_draw_pass_4(value: unknown): void { this.set_draw_pass_mesh(4, value); }
  get_draw_pass_4(): unknown { return this.get_draw_pass_mesh(4); }
  set_skin(value: unknown): void { this.skinValue = value; }
  get_skin(): unknown { return this.skinValue; }
  set_sub_emitter(value: string | Object3D | null): void { this.subEmitterValue = value; }
  get_sub_emitter(): string | Object3D | null { return this.subEmitterValue; }
  set_use_fixed_seed(value: boolean): void { this.useFixedSeedValue = value; }
  get_use_fixed_seed(): boolean { return this.useFixedSeedValue; }
  set_seed(value: number): void { this.seedValue = integer('GPUParticles3D.seed', value, 0, 0xffff_ffff); }
  get_seed(): number { return this.seedValue; }

  restart(keepSeed = false): void {
    if (!keepSeed && !this.useFixedSeedValue) this.seedValue = Math.floor(Math.random() * 0x1_0000_0000);
    this.emittingValue = true;
    this.runtime?.restart(keepSeed);
  }

  emit_particle(transform: Matrix4, velocity: Vector3, color: Color, custom: Color, flags: number): void {
    if (!Number.isInteger(flags) || flags < 0 || flags > 31) throw new RangeError('GPUParticles3D.emit_particle flags require a 5-bit mask.');
    const emission: GodotGPUParticleEmission = {
      transform: transform.clone(), velocity: finiteVector('GPUParticles3D.emit_particle velocity', velocity),
      color: color.clone(), custom: custom.clone(), flags,
    };
    if (this.runtime === null) this.pendingEmissions.push(emission);
    else this.runtime.emitParticle(emission);
  }

  request_particles_process(processTime: number): void {
    this.runtime?.requestProcess(finite('GPUParticles3D.request_particles_process', processTime, 0));
  }

  capture_aabb(): GodotAabb {
    return this.runtime?.captureAabb?.() ?? copyAabb(this.visibilityAabbValue);
  }

  convert_from_particles(source: GodotGPUParticles3D): void {
    this.emittingValue = source.emittingValue; this.amountValue = source.amountValue;
    this.amountRatioValue = source.amountRatioValue; this.lifetimeValue = source.lifetimeValue;
    this.oneShotValue = source.oneShotValue; this.preprocessValue = source.preprocessValue;
    this.explosivenessRatioValue = source.explosivenessRatioValue;
    this.randomnessRatioValue = source.randomnessRatioValue;
    this.visibilityAabbValue = copyAabb(source.visibilityAabbValue);
    this.localCoordsValue = source.localCoordsValue; this.fixedFpsValue = source.fixedFpsValue;
    this.interpolateValue = source.interpolateValue; this.fractDeltaValue = source.fractDeltaValue;
    this.drawOrderValue = source.drawOrderValue; this.speedScaleValue = source.speedScaleValue;
    this.collisionBaseSizeValue = source.collisionBaseSizeValue; this.trailEnabledValue = source.trailEnabledValue;
    this.trailLifetimeValue = source.trailLifetimeValue; this.transformAlignValue = source.transformAlignValue;
    this.processMaterialValue = source.processMaterialValue; this.drawPassesValue = source.drawPassesValue;
    for (let index = 0; index < 4; index += 1) this.drawPassMeshes[index] = source.drawPassMeshes[index] ?? null;
    this.skinValue = source.skinValue; this.subEmitterValue = source.subEmitterValue;
    this.useFixedSeedValue = source.useFixedSeedValue; this.seedValue = source.seedValue;
  }
}

export const createGodotGPUParticles3D = (): GodotGPUParticles3D => new GodotGPUParticles3D();
