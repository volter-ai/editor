import { Color } from 'three';
import { bindGodotMaterial, duplicateGodotMaterial } from './material';
import { godotResourceEmitChanged } from './resource-io';

export interface GodotFogMaterialOptions {
  readonly density?: number;
  readonly albedo?: Color;
  readonly emission?: Color;
  readonly heightFalloff?: number;
  readonly edgeFade?: number;
  readonly densityTexture?: unknown;
}

export interface GodotFogMaterialState {
  readonly density: number;
  readonly albedo: Color;
  readonly emission: Color;
  readonly heightFalloff: number;
  readonly edgeFade: number;
  readonly densityTexture: unknown;
}

function finiteNonnegative(member: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`FogMaterial.${member} requires a finite nonnegative number.`);
  }
  return value;
}

function finiteUnit(member: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`FogMaterial.${member} requires a finite number from 0 through 1.`);
  }
  return value;
}

export class GodotFogMaterial {
  private densityValue: number;
  private readonly albedoValue: Color;
  private readonly emissionValue: Color;
  private heightFalloffValue: number;
  private edgeFadeValue: number;
  private densityTextureValue: unknown;

  constructor(options: GodotFogMaterialOptions = {}) {
    this.densityValue = finiteNonnegative('density', options.density ?? 1);
    this.albedoValue = (options.albedo ?? new Color(1, 1, 1)).clone();
    this.emissionValue = (options.emission ?? new Color(0, 0, 0)).clone();
    this.heightFalloffValue = finiteNonnegative('height_falloff', options.heightFalloff ?? 0);
    this.edgeFadeValue = finiteUnit('edge_fade', options.edgeFade ?? 0.1);
    this.densityTextureValue = options.densityTexture ?? null;
    bindGodotMaterial<GodotFogMaterial>(this, {}, 'FogMaterial', {
      createDuplicate: (source) => new GodotFogMaterial(source.state()),
    });
  }

  get density(): number { return this.get_density(); }
  set density(value: number) { this.set_density(value); }
  get albedo(): Color { return this.get_albedo(); }
  set albedo(value: Color) { this.set_albedo(value); }
  get emission(): Color { return this.get_emission(); }
  set emission(value: Color) { this.set_emission(value); }
  get height_falloff(): number { return this.get_height_falloff(); }
  set height_falloff(value: number) { this.set_height_falloff(value); }
  get edge_fade(): number { return this.get_edge_fade(); }
  set edge_fade(value: number) { this.set_edge_fade(value); }
  get density_texture(): unknown { return this.get_density_texture(); }
  set density_texture(value: unknown) { this.set_density_texture(value); }

  set_density(value: number): void {
    value = finiteNonnegative('density', value);
    if (value === this.densityValue) return;
    this.densityValue = value;
    godotResourceEmitChanged(this);
  }

  get_density(): number {
    return this.densityValue;
  }

  set_albedo(value: Color): void {
    if (this.albedoValue.equals(value)) return;
    this.albedoValue.copy(value);
    godotResourceEmitChanged(this);
  }

  get_albedo(): Color {
    return this.albedoValue.clone();
  }

  set_emission(value: Color): void {
    if (this.emissionValue.equals(value)) return;
    this.emissionValue.copy(value);
    godotResourceEmitChanged(this);
  }

  get_emission(): Color {
    return this.emissionValue.clone();
  }

  set_height_falloff(value: number): void {
    value = finiteNonnegative('height_falloff', value);
    if (value === this.heightFalloffValue) return;
    this.heightFalloffValue = value;
    godotResourceEmitChanged(this);
  }

  get_height_falloff(): number {
    return this.heightFalloffValue;
  }

  set_edge_fade(value: number): void {
    value = finiteUnit('edge_fade', value);
    if (value === this.edgeFadeValue) return;
    this.edgeFadeValue = value;
    godotResourceEmitChanged(this);
  }

  get_edge_fade(): number {
    return this.edgeFadeValue;
  }

  set_density_texture(value: unknown): void {
    if (value === this.densityTextureValue) return;
    this.densityTextureValue = value;
    godotResourceEmitChanged(this);
  }

  get_density_texture(): unknown {
    return this.densityTextureValue;
  }

  state(): GodotFogMaterialState {
    return {
      density: this.densityValue,
      albedo: this.albedoValue.clone(),
      emission: this.emissionValue.clone(),
      heightFalloff: this.heightFalloffValue,
      edgeFade: this.edgeFadeValue,
      densityTexture: this.densityTextureValue,
    };
  }

  duplicate(deep = false): GodotFogMaterial {
    return duplicateGodotMaterial<GodotFogMaterial>(
      this,
      (source) => new GodotFogMaterial(source.state()),
      deep,
      'FogMaterial',
    );
  }
}

export const createGodotFogMaterial = (
  options: GodotFogMaterialOptions = {},
): GodotFogMaterial => new GodotFogMaterial(options);
