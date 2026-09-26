/** Godot RenderSceneBuffersExtension retained render-target configuration. */

import { registerGodotObjectIdentity } from './object';

export type GodotRenderSceneBuffersConfiguration = object;

export interface GodotRenderSceneBuffersExtensionHooks {
  _configure(configuration: GodotRenderSceneBuffersConfiguration): void;
  _set_fsr_sharpness(value: number): void;
  _set_texture_mipmap_bias(value: number): void;
  _set_anisotropic_filtering_level(value: number): void;
  _set_use_debanding(value: boolean): void;
}

export class GodotRenderSceneBuffersExtension {
  private configuration: GodotRenderSceneBuffersConfiguration | null = null;
  private fsrSharpness = 0.2;
  private textureMipmapBias = 0;
  private anisotropicFilteringLevel = 0;
  private useDebanding = false;
  constructor(private readonly hooks: GodotRenderSceneBuffersExtensionHooks) {
    registerGodotObjectIdentity(this, 'RenderSceneBuffersExtension');
  }
  _configure(configuration: GodotRenderSceneBuffersConfiguration): void {
    if (typeof configuration !== 'object' || configuration === null) throw new TypeError('RenderSceneBuffers configuration requires Object.');
    this.hooks._configure(configuration);
    this.configuration = configuration;
  }
  _set_fsr_sharpness(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 2) throw new RangeError('RenderSceneBuffers FSR sharpness requires 0..2.');
    this.fsrSharpness = value;
    this.hooks._set_fsr_sharpness(value);
  }
  _set_texture_mipmap_bias(value: number): void {
    if (!Number.isFinite(value)) throw new TypeError('RenderSceneBuffers mipmap bias requires finite float.');
    this.textureMipmapBias = value;
    this.hooks._set_texture_mipmap_bias(value);
  }
  _set_anisotropic_filtering_level(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('RenderSceneBuffers anisotropic level requires non-negative int.');
    this.anisotropicFilteringLevel = value;
    this.hooks._set_anisotropic_filtering_level(value);
  }
  _set_use_debanding(value: boolean): void {
    this.useDebanding = Boolean(value);
    this.hooks._set_use_debanding(this.useDebanding);
  }
  configure(configuration: GodotRenderSceneBuffersConfiguration): void { this._configure(configuration); }
  set_fsr_sharpness(value: number): void { this._set_fsr_sharpness(value); }
  set_texture_mipmap_bias(value: number): void { this._set_texture_mipmap_bias(value); }
  set_anisotropic_filtering_level(value: number): void { this._set_anisotropic_filtering_level(value); }
  set_use_debanding(value: boolean): void { this._set_use_debanding(value); }
  get_configuration(): GodotRenderSceneBuffersConfiguration | null { return this.configuration; }
  get_fsr_sharpness(): number { return this.fsrSharpness; }
  get_texture_mipmap_bias(): number { return this.textureMipmapBias; }
  get_anisotropic_filtering_level(): number { return this.anisotropicFilteringLevel; }
  is_using_debanding(): boolean { return this.useDebanding; }
}

export function createGodotRenderSceneBuffersExtension(hooks: GodotRenderSceneBuffersExtensionHooks): GodotRenderSceneBuffersExtension {
  return new GodotRenderSceneBuffersExtension(hooks);
}
