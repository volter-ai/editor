import { Color, Object3D, Vector3 } from 'three';
import { GodotLightmapGIData, GodotVoxelGIData } from './baked-lighting-data';
import { registerGodotObjectIdentity } from './object';

export const GodotLightmapBakeQuality = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  ULTRA: 3,
} as const;

export const GodotLightmapGenerateProbes = {
  DISABLED: 0,
  SUBDIV_4: 1,
  SUBDIV_8: 2,
  SUBDIV_16: 3,
  SUBDIV_32: 4,
} as const;

export const GodotLightmapEnvironmentMode = {
  DISABLED: 0,
  SCENE: 1,
  CUSTOM_SKY: 2,
  CUSTOM_COLOR: 3,
} as const;

export const GodotVoxelGISubdiv = {
  SUBDIV_64: 0,
  SUBDIV_128: 1,
  SUBDIV_256: 2,
  SUBDIV_512: 3,
  MAX: 4,
} as const;

export const GodotVoxelGIUpdateMode = {
  ONCE: 0,
  EVERY_FRAME: 1,
} as const;

export type GodotLightmapBakeQualityValue = typeof GodotLightmapBakeQuality[keyof typeof GodotLightmapBakeQuality];
export type GodotLightmapGenerateProbesValue = typeof GodotLightmapGenerateProbes[keyof typeof GodotLightmapGenerateProbes];
export type GodotLightmapEnvironmentModeValue = typeof GodotLightmapEnvironmentMode[keyof typeof GodotLightmapEnvironmentMode];
export type GodotVoxelGISubdivValue = typeof GodotVoxelGISubdiv[keyof typeof GodotVoxelGISubdiv];
export type GodotVoxelGIUpdateModeValue = typeof GodotVoxelGIUpdateMode[keyof typeof GodotVoxelGIUpdateMode];

function finite(member: string, value: number, minimum = -Infinity): number {
  if (!Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${member} requires a finite value greater than or equal to ${minimum}.`);
  }
  return value;
}

function integer(member: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${member} requires an integer greater than or equal to ${minimum}.`);
  }
  return value;
}

function enumValue<T extends number>(member: string, value: number, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new RangeError(`${member} has an invalid enum value ${value}.`);
  return value as T;
}

export interface GodotLightmapBakeRequest {
  readonly fromNode: Object3D | null;
  readonly dataSavePath: string;
  readonly target: GodotLightmapGI;
}

export type GodotLightmapBakeHandler = (
  request: GodotLightmapBakeRequest,
) => number | Promise<number>;

export class GodotLightmapGI extends Object3D {
  private lightData: GodotLightmapGIData | null = null;
  private bakeQuality: GodotLightmapBakeQualityValue = GodotLightmapBakeQuality.MEDIUM;
  private texelScale = 0.2;
  private maxTextureSize = 16384;
  private bounces = 3;
  private bounceIndirectEnergy = 1;
  private directional = true;
  private interior = false;
  private useDenoiser = true;
  private denoiserStrength = 0.1;
  private denoiserRange = 10;
  private useTextureForBounces = true;
  private generateProbes: GodotLightmapGenerateProbesValue = GodotLightmapGenerateProbes.SUBDIV_8;
  private environmentMode: GodotLightmapEnvironmentModeValue = GodotLightmapEnvironmentMode.SCENE;
  private environmentCustomSky: unknown = null;
  private readonly environmentCustomColor = new Color(1, 1, 1);
  private environmentCustomEnergy = 1;
  private cameraAttributes: unknown = null;
  private supersampling = false;
  private supersamplingFactor = 2;
  private bakeHandler: GodotLightmapBakeHandler | null = null;

  constructor() {
    super();
    registerGodotObjectIdentity(this, 'LightmapGI');
  }

  set_light_data(value: GodotLightmapGIData | null): void { this.lightData = value; }
  get_light_data(): GodotLightmapGIData | null { return this.lightData; }
  set_bake_quality(value: number): void {
    this.bakeQuality = enumValue('LightmapGI.bake_quality', value, [0, 1, 2, 3]);
  }
  get_bake_quality(): GodotLightmapBakeQualityValue { return this.bakeQuality; }
  set_texel_scale(value: number): void { this.texelScale = finite('LightmapGI.texel_scale', value, 0.001); }
  get_texel_scale(): number { return this.texelScale; }
  set_max_texture_size(value: number): void { this.maxTextureSize = integer('LightmapGI.max_texture_size', value, 1); }
  get_max_texture_size(): number { return this.maxTextureSize; }
  set_bounces(value: number): void { this.bounces = integer('LightmapGI.bounces', value, 0); }
  get_bounces(): number { return this.bounces; }
  set_bounce_indirect_energy(value: number): void {
    this.bounceIndirectEnergy = finite('LightmapGI.bounce_indirect_energy', value, 0);
  }
  get_bounce_indirect_energy(): number { return this.bounceIndirectEnergy; }
  set_directional(value: boolean): void { this.directional = value; }
  is_directional(): boolean { return this.directional; }
  set_interior(value: boolean): void { this.interior = value; }
  is_interior(): boolean { return this.interior; }
  set_use_denoiser(value: boolean): void { this.useDenoiser = value; }
  is_using_denoiser(): boolean { return this.useDenoiser; }
  set_denoiser_strength(value: number): void { this.denoiserStrength = finite('LightmapGI.denoiser_strength', value, 0); }
  get_denoiser_strength(): number { return this.denoiserStrength; }
  set_denoiser_range(value: number): void { this.denoiserRange = integer('LightmapGI.denoiser_range', value, 0); }
  get_denoiser_range(): number { return this.denoiserRange; }
  set_use_texture_for_bounces(value: boolean): void { this.useTextureForBounces = value; }
  is_using_texture_for_bounces(): boolean { return this.useTextureForBounces; }
  set_generate_probes(value: number): void {
    this.generateProbes = enumValue('LightmapGI.generate_probes', value, [0, 1, 2, 3, 4]);
  }
  get_generate_probes(): GodotLightmapGenerateProbesValue { return this.generateProbes; }
  set_environment_mode(value: number): void {
    this.environmentMode = enumValue('LightmapGI.environment_mode', value, [0, 1, 2, 3]);
  }
  get_environment_mode(): GodotLightmapEnvironmentModeValue { return this.environmentMode; }
  set_environment_custom_sky(value: unknown): void { this.environmentCustomSky = value; }
  get_environment_custom_sky(): unknown { return this.environmentCustomSky; }
  set_environment_custom_color(value: Color): void { this.environmentCustomColor.copy(value); }
  get_environment_custom_color(): Color { return this.environmentCustomColor.clone(); }
  set_environment_custom_energy(value: number): void {
    this.environmentCustomEnergy = finite('LightmapGI.environment_custom_energy', value, 0);
  }
  get_environment_custom_energy(): number { return this.environmentCustomEnergy; }
  set_camera_attributes(value: unknown): void { this.cameraAttributes = value; }
  get_camera_attributes(): unknown { return this.cameraAttributes; }
  set_supersampling_enabled(value: boolean): void { this.supersampling = value; }
  is_supersampling_enabled(): boolean { return this.supersampling; }
  set_supersampling_factor(value: number): void {
    this.supersamplingFactor = finite('LightmapGI.supersampling_factor', value, 1);
  }
  get_supersampling_factor(): number { return this.supersamplingFactor; }
  set_bake_handler(value: GodotLightmapBakeHandler | null): void { this.bakeHandler = value; }
  bake(fromNode: Object3D | null = null, dataSavePath = ''): number | Promise<number> {
    if (this.bakeHandler === null) return 0;
    return this.bakeHandler({ fromNode, dataSavePath, target: this });
  }
  debug_bake(): number | Promise<number> { return this.bake(null, ''); }
}

export interface GodotVoxelGIBakeRequest {
  readonly fromNode: Object3D | null;
  readonly createVisualDebug: boolean;
  readonly target: GodotVoxelGI;
}

export type GodotVoxelGIBakeHandler = (request: GodotVoxelGIBakeRequest) => void | Promise<void>;

export class GodotVoxelGI extends Object3D {
  private data: GodotVoxelGIData | null = null;
  private readonly volumeSize = new Vector3(20, 20, 20);
  private subdiv: GodotVoxelGISubdivValue = GodotVoxelGISubdiv.SUBDIV_128;
  private updateMode: GodotVoxelGIUpdateModeValue = GodotVoxelGIUpdateMode.ONCE;
  private cameraAttributes: unknown = null;
  private bakeHandler: GodotVoxelGIBakeHandler | null = null;

  constructor() {
    super();
    registerGodotObjectIdentity(this, 'VoxelGI');
  }

  set_probe_data(value: GodotVoxelGIData | null): void { this.data = value; }
  get_probe_data(): GodotVoxelGIData | null { return this.data; }
  set_data(value: GodotVoxelGIData | null): void { this.data = value; }
  get_data(): GodotVoxelGIData | null { return this.data; }
  set_size(value: Vector3): void {
    if (![value.x, value.y, value.z].every((component) => Number.isFinite(component) && component >= 0)) {
      throw new RangeError('VoxelGI.size requires finite nonnegative components.');
    }
    this.volumeSize.copy(value);
  }
  get_size(): Vector3 { return this.volumeSize.clone(); }
  set_subdiv(value: number): void {
    this.subdiv = enumValue('VoxelGI.subdiv', value, [0, 1, 2, 3]);
  }
  get_subdiv(): GodotVoxelGISubdivValue { return this.subdiv; }
  set_update_mode(value: number): void {
    this.updateMode = enumValue('VoxelGI.update_mode', value, [0, 1]);
  }
  get_update_mode(): GodotVoxelGIUpdateModeValue { return this.updateMode; }
  set_camera_attributes(value: unknown): void { this.cameraAttributes = value; }
  get_camera_attributes(): unknown { return this.cameraAttributes; }
  get_estimated_cell_size(): number {
    const cells = [64, 128, 256, 512][this.subdiv] ?? 128;
    return Math.max(this.volumeSize.x, this.volumeSize.y, this.volumeSize.z) / cells;
  }
  set_bake_handler(value: GodotVoxelGIBakeHandler | null): void { this.bakeHandler = value; }
  bake(fromNode: Object3D | null = null, createVisualDebug = false): void | Promise<void> {
    return this.bakeHandler?.({ fromNode, createVisualDebug, target: this });
  }
  debug_bake(): void | Promise<void> { return this.bake(null, true); }
}

export class GodotLightmapProbe extends Object3D {
  constructor() {
    super();
    registerGodotObjectIdentity(this, 'LightmapProbe');
  }
}

export const createGodotLightmapGI = (): GodotLightmapGI => new GodotLightmapGI();
export const createGodotVoxelGI = (): GodotVoxelGI => new GodotVoxelGI();
export const createGodotLightmapProbe = (): GodotLightmapProbe => new GodotLightmapProbe();
