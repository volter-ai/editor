import { Object3D, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';

export const GodotParticleCollisionSDFResolution = {
  RESOLUTION_16: 0,
  RESOLUTION_32: 1,
  RESOLUTION_64: 2,
  RESOLUTION_128: 3,
  RESOLUTION_256: 4,
  RESOLUTION_512: 5,
  MAX: 6,
} as const;

export const GodotParticleCollisionHeightFieldResolution = {
  RESOLUTION_256: 0,
  RESOLUTION_512: 1,
  RESOLUTION_1024: 2,
  RESOLUTION_2048: 3,
  RESOLUTION_4096: 4,
  RESOLUTION_8192: 5,
  MAX: 6,
} as const;

export const GodotParticleCollisionHeightFieldUpdateMode = {
  WHEN_MOVED: 0,
  ALWAYS: 1,
} as const;

export type GodotParticleCollisionSDFResolutionValue = Exclude<typeof GodotParticleCollisionSDFResolution[keyof typeof GodotParticleCollisionSDFResolution], 6>;
export type GodotParticleCollisionHeightFieldResolutionValue = Exclude<typeof GodotParticleCollisionHeightFieldResolution[keyof typeof GodotParticleCollisionHeightFieldResolution], 6>;
export type GodotParticleCollisionHeightFieldUpdateModeValue = typeof GodotParticleCollisionHeightFieldUpdateMode[keyof typeof GodotParticleCollisionHeightFieldUpdateMode];

function finite(member: string, value: number, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function nonnegativeVector(member: string, value: Vector3): Vector3 {
  if (![value.x, value.y, value.z].every((component) => Number.isFinite(component) && component >= 0)) {
    throw new RangeError(`${member} requires finite nonnegative components.`);
  }
  return value.clone();
}

function mask(member: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${member} requires an unsigned 32-bit mask.`);
  }
  return value >>> 0;
}

function setMaskBit(current: number, layer: number, enabled: boolean): number {
  if (!Number.isInteger(layer) || layer < 1 || layer > 32) {
    throw new RangeError('Particle field layer number must be in [1, 32].');
  }
  const bit = 2 ** (layer - 1);
  return enabled ? (current | bit) >>> 0 : (current & ~bit) >>> 0;
}

function getMaskBit(current: number, layer: number): boolean {
  if (!Number.isInteger(layer) || layer < 1 || layer > 32) {
    throw new RangeError('Particle field layer number must be in [1, 32].');
  }
  return (current & 2 ** (layer - 1)) !== 0;
}

export class GodotGPUParticlesAttractor3D extends Object3D {
  private cullMaskValue = 1;
  private strengthValue = 1;
  private attenuationValue = 1;
  private directionalityValue = 0;

  protected constructor(godotClass = 'GPUParticlesAttractor3D') {
    super();
    registerGodotObjectIdentity(this, godotClass);
  }

  set_cull_mask(value: number): void { this.cullMaskValue = mask('GPUParticlesAttractor3D.cull_mask', value); }
  get_cull_mask(): number { return this.cullMaskValue; }
  set_cull_mask_value(layer: number, enabled: boolean): void { this.cullMaskValue = setMaskBit(this.cullMaskValue, layer, enabled); }
  get_cull_mask_value(layer: number): boolean { return getMaskBit(this.cullMaskValue, layer); }
  set_strength(value: number): void { this.strengthValue = finite('GPUParticlesAttractor3D.strength', value); }
  get_strength(): number { return this.strengthValue; }
  set_attenuation(value: number): void { this.attenuationValue = finite('GPUParticlesAttractor3D.attenuation', value, 0); }
  get_attenuation(): number { return this.attenuationValue; }
  set_directionality(value: number): void { this.directionalityValue = finite('GPUParticlesAttractor3D.directionality', value, 0, 1); }
  get_directionality(): number { return this.directionalityValue; }

  get_force_at(localPosition: Vector3): Vector3 {
    const distance = localPosition.length();
    if (distance <= Number.EPSILON) return new Vector3();
    const falloff = this.attenuationValue === 0 ? 1 : 1 / Math.pow(distance, this.attenuationValue);
    return localPosition.clone().normalize().multiplyScalar(-this.strengthValue * falloff);
  }
}

export class GodotGPUParticlesAttractorBox3D extends GodotGPUParticlesAttractor3D {
  private readonly volumeSize = new Vector3(2, 2, 2);
  constructor() { super('GPUParticlesAttractorBox3D'); }
  set_size(value: Vector3): void { this.volumeSize.copy(nonnegativeVector('GPUParticlesAttractorBox3D.size', value)); }
  get_size(): Vector3 { return this.volumeSize.clone(); }
  contains_local_point(value: Vector3): boolean {
    return Math.abs(value.x) <= this.volumeSize.x * 0.5 && Math.abs(value.y) <= this.volumeSize.y * 0.5 && Math.abs(value.z) <= this.volumeSize.z * 0.5;
  }
}

export class GodotGPUParticlesAttractorSphere3D extends GodotGPUParticlesAttractor3D {
  private radiusValue = 1;
  constructor() { super('GPUParticlesAttractorSphere3D'); }
  set_radius(value: number): void { this.radiusValue = finite('GPUParticlesAttractorSphere3D.radius', value, 0); }
  get_radius(): number { return this.radiusValue; }
  contains_local_point(value: Vector3): boolean { return value.lengthSq() <= this.radiusValue * this.radiusValue; }
}

export class GodotGPUParticlesAttractorVectorField3D extends GodotGPUParticlesAttractor3D {
  private readonly volumeSize = new Vector3(2, 2, 2);
  private textureValue: unknown = null;
  constructor() { super('GPUParticlesAttractorVectorField3D'); }
  set_size(value: Vector3): void { this.volumeSize.copy(nonnegativeVector('GPUParticlesAttractorVectorField3D.size', value)); }
  get_size(): Vector3 { return this.volumeSize.clone(); }
  set_texture(value: unknown): void { this.textureValue = value; }
  get_texture(): unknown { return this.textureValue; }
}

export class GodotGPUParticlesCollision3D extends Object3D {
  private cullMaskValue = 1;

  protected constructor(godotClass = 'GPUParticlesCollision3D') {
    super();
    registerGodotObjectIdentity(this, godotClass);
  }

  set_cull_mask(value: number): void { this.cullMaskValue = mask('GPUParticlesCollision3D.cull_mask', value); }
  get_cull_mask(): number { return this.cullMaskValue; }
  set_cull_mask_value(layer: number, enabled: boolean): void { this.cullMaskValue = setMaskBit(this.cullMaskValue, layer, enabled); }
  get_cull_mask_value(layer: number): boolean { return getMaskBit(this.cullMaskValue, layer); }
}

export class GodotGPUParticlesCollisionBox3D extends GodotGPUParticlesCollision3D {
  private readonly volumeSize = new Vector3(2, 2, 2);
  constructor() { super('GPUParticlesCollisionBox3D'); }
  set_size(value: Vector3): void { this.volumeSize.copy(nonnegativeVector('GPUParticlesCollisionBox3D.size', value)); }
  get_size(): Vector3 { return this.volumeSize.clone(); }
  signed_distance(localPosition: Vector3): number {
    const half = this.volumeSize.clone().multiplyScalar(0.5);
    const q = new Vector3(Math.abs(localPosition.x), Math.abs(localPosition.y), Math.abs(localPosition.z)).sub(half);
    const outside = new Vector3(Math.max(q.x, 0), Math.max(q.y, 0), Math.max(q.z, 0)).length();
    return outside + Math.min(Math.max(q.x, q.y, q.z), 0);
  }
}

export class GodotGPUParticlesCollisionSphere3D extends GodotGPUParticlesCollision3D {
  private radiusValue = 1;
  constructor() { super('GPUParticlesCollisionSphere3D'); }
  set_radius(value: number): void { this.radiusValue = finite('GPUParticlesCollisionSphere3D.radius', value, 0); }
  get_radius(): number { return this.radiusValue; }
  signed_distance(localPosition: Vector3): number { return localPosition.length() - this.radiusValue; }
}

export interface GodotParticleSDFBakeRequest {
  readonly target: GodotGPUParticlesCollisionSDF3D;
  readonly savePath: string;
}

export type GodotParticleSDFBakeHandler = (request: GodotParticleSDFBakeRequest) => unknown | Promise<unknown>;

export class GodotGPUParticlesCollisionSDF3D extends GodotGPUParticlesCollision3D {
  private readonly volumeSize = new Vector3(2, 2, 2);
  private resolutionValue: GodotParticleCollisionSDFResolutionValue = GodotParticleCollisionSDFResolution.RESOLUTION_64;
  private thicknessValue = 1;
  private textureValue: unknown = null;
  private bakeMaskValue = 0xffff_ffff;
  private bakeHandler: GodotParticleSDFBakeHandler | null = null;

  constructor() { super('GPUParticlesCollisionSDF3D'); }
  set_size(value: Vector3): void { this.volumeSize.copy(nonnegativeVector('GPUParticlesCollisionSDF3D.size', value)); }
  get_size(): Vector3 { return this.volumeSize.clone(); }
  set_resolution(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= GodotParticleCollisionSDFResolution.MAX) throw new RangeError('GPUParticlesCollisionSDF3D.resolution requires a valid resolution.');
    this.resolutionValue = value as GodotParticleCollisionSDFResolutionValue;
  }
  get_resolution(): GodotParticleCollisionSDFResolutionValue { return this.resolutionValue; }
  set_thickness(value: number): void { this.thicknessValue = finite('GPUParticlesCollisionSDF3D.thickness', value, 0); }
  get_thickness(): number { return this.thicknessValue; }
  set_texture(value: unknown): void { this.textureValue = value; }
  get_texture(): unknown { return this.textureValue; }
  set_bake_mask(value: number): void { this.bakeMaskValue = mask('GPUParticlesCollisionSDF3D.bake_mask', value); }
  get_bake_mask(): number { return this.bakeMaskValue; }
  set_bake_mask_value(layer: number, enabled: boolean): void { this.bakeMaskValue = setMaskBit(this.bakeMaskValue, layer, enabled); }
  get_bake_mask_value(layer: number): boolean { return getMaskBit(this.bakeMaskValue, layer); }
  set_bake_handler(value: GodotParticleSDFBakeHandler | null): void { this.bakeHandler = value; }
  bake(savePath = ''): unknown | Promise<unknown> { return this.bakeHandler?.({ target: this, savePath }) ?? null; }
  get_estimated_cell_size(): number {
    const cells = [16, 32, 64, 128, 256, 512][this.resolutionValue] ?? 64;
    return Math.max(this.volumeSize.x, this.volumeSize.y, this.volumeSize.z) / cells;
  }
}

export class GodotGPUParticlesCollisionHeightField3D extends GodotGPUParticlesCollision3D {
  private readonly volumeSize = new Vector3(2, 2, 2);
  private resolutionValue: GodotParticleCollisionHeightFieldResolutionValue = GodotParticleCollisionHeightFieldResolution.RESOLUTION_1024;
  private updateModeValue: GodotParticleCollisionHeightFieldUpdateModeValue = GodotParticleCollisionHeightFieldUpdateMode.WHEN_MOVED;
  private followCameraEnabledValue = false;

  constructor() { super('GPUParticlesCollisionHeightField3D'); }
  set_size(value: Vector3): void { this.volumeSize.copy(nonnegativeVector('GPUParticlesCollisionHeightField3D.size', value)); }
  get_size(): Vector3 { return this.volumeSize.clone(); }
  set_resolution(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= GodotParticleCollisionHeightFieldResolution.MAX) throw new RangeError('GPUParticlesCollisionHeightField3D.resolution requires a valid resolution.');
    this.resolutionValue = value as GodotParticleCollisionHeightFieldResolutionValue;
  }
  get_resolution(): GodotParticleCollisionHeightFieldResolutionValue { return this.resolutionValue; }
  set_update_mode(value: number): void {
    if (value !== 0 && value !== 1) throw new RangeError('GPUParticlesCollisionHeightField3D.update_mode requires WHEN_MOVED or ALWAYS.');
    this.updateModeValue = value;
  }
  get_update_mode(): GodotParticleCollisionHeightFieldUpdateModeValue { return this.updateModeValue; }
  set_follow_camera_enabled(value: boolean): void { this.followCameraEnabledValue = value; }
  is_follow_camera_enabled(): boolean { return this.followCameraEnabledValue; }
}

export const createGodotGPUParticlesAttractorBox3D = (): GodotGPUParticlesAttractorBox3D => new GodotGPUParticlesAttractorBox3D();
export const createGodotGPUParticlesAttractorSphere3D = (): GodotGPUParticlesAttractorSphere3D => new GodotGPUParticlesAttractorSphere3D();
export const createGodotGPUParticlesAttractorVectorField3D = (): GodotGPUParticlesAttractorVectorField3D => new GodotGPUParticlesAttractorVectorField3D();
export const createGodotGPUParticlesCollisionBox3D = (): GodotGPUParticlesCollisionBox3D => new GodotGPUParticlesCollisionBox3D();
export const createGodotGPUParticlesCollisionSphere3D = (): GodotGPUParticlesCollisionSphere3D => new GodotGPUParticlesCollisionSphere3D();
export const createGodotGPUParticlesCollisionSDF3D = (): GodotGPUParticlesCollisionSDF3D => new GodotGPUParticlesCollisionSDF3D();
export const createGodotGPUParticlesCollisionHeightField3D = (): GodotGPUParticlesCollisionHeightField3D => new GodotGPUParticlesCollisionHeightField3D();
