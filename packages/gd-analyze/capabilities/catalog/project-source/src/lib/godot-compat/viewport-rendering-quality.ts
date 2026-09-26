import type { Texture } from 'three';

export const GODOT_VIEWPORT_SCREEN_SPACE_AA = {
  DISABLED: 0,
  FXAA: 1,
  SCREEN_SPACE_AA_DISABLED: 0,
  SCREEN_SPACE_AA_FXAA: 1,
} as const;

export const GODOT_VIEWPORT_SCALING_3D_MODE = {
  BILINEAR: 0,
  FSR: 1,
  FSR2: 2,
  METALFX_SPATIAL: 3,
  METALFX_TEMPORAL: 4,
  OFF: 0,
  SCALING_3D_MODE_BILINEAR: 0,
  SCALING_3D_MODE_FSR: 1,
  SCALING_3D_MODE_FSR2: 2,
} as const;

export const GODOT_VIEWPORT_ANISOTROPY = {
  DISABLED: 0,
  ANISOTROPY_2X: 1,
  ANISOTROPY_4X: 2,
  ANISOTROPY_8X: 3,
  ANISOTROPY_16X: 4,
} as const;

export const GODOT_VIEWPORT_VRS_MODE = {
  DISABLED: 0,
  TEXTURE: 1,
  XR: 2,
  VRS_DISABLED: 0,
  VRS_TEXTURE: 1,
  VRS_XR: 2,
} as const;

export type GodotViewportScreenSpaceAa = 0 | 1;
export type GodotViewportScaling3dMode = 0 | 1 | 2 | 3 | 4;
export type GodotViewportAnisotropy = 0 | 1 | 2 | 3 | 4;
export type GodotViewportVrsMode = 0 | 1 | 2;

export interface GodotViewportRenderingQualitySnapshot {
  readonly msaa2d: number;
  readonly screenSpaceAa: GodotViewportScreenSpaceAa;
  readonly temporalAa: boolean;
  readonly debanding: boolean;
  readonly scaling3dMode: GodotViewportScaling3dMode;
  readonly scaling3dScale: number;
  readonly fsrSharpness: number;
  readonly textureMipmapBias: number;
  readonly anisotropicFilteringLevel: GodotViewportAnisotropy;
  readonly meshLodThreshold: number;
  readonly vrsMode: GodotViewportVrsMode;
  readonly vrsUpdateMode: number;
  readonly vrsTexture: Texture | null;
  readonly positionalShadowAtlasSize: number;
  readonly positionalShadowAtlas16Bits: boolean;
  readonly positionalShadowAtlasQuadrants: readonly [number, number, number, number];
}

export interface GodotViewportRenderingQualityBinding {
  apply(snapshot: GodotViewportRenderingQualitySnapshot): void;
}

interface MutableQualityState {
  msaa2d: number;
  screenSpaceAa: GodotViewportScreenSpaceAa;
  temporalAa: boolean;
  debanding: boolean;
  scaling3dMode: GodotViewportScaling3dMode;
  scaling3dScale: number;
  fsrSharpness: number;
  textureMipmapBias: number;
  anisotropicFilteringLevel: GodotViewportAnisotropy;
  meshLodThreshold: number;
  vrsMode: GodotViewportVrsMode;
  vrsUpdateMode: number;
  vrsTexture: Texture | null;
  positionalShadowAtlasSize: number;
  positionalShadowAtlas16Bits: boolean;
  positionalShadowAtlasQuadrants: [number, number, number, number];
  binding: GodotViewportRenderingQualityBinding | null;
  listeners: Set<(snapshot: GodotViewportRenderingQualitySnapshot) => void>;
}

const VIEWPORT_RENDERING_QUALITY = new WeakMap<object, MutableQualityState>();

function ownerOf(viewport: unknown): object {
  if ((typeof viewport !== 'object' || viewport === null) && typeof viewport !== 'function') {
    throw new TypeError('godot-compat: Viewport rendering quality requires a Viewport object.');
  }
  return viewport as object;
}

function stateOf(viewport: unknown): MutableQualityState {
  const owner = ownerOf(viewport);
  let state = VIEWPORT_RENDERING_QUALITY.get(owner);
  if (state !== undefined) return state;
  state = {
    msaa2d: 0,
    screenSpaceAa: 0,
    temporalAa: false,
    debanding: false,
    scaling3dMode: 0,
    scaling3dScale: 1,
    fsrSharpness: 0.2,
    textureMipmapBias: 0,
    anisotropicFilteringLevel: 2,
    meshLodThreshold: 1,
    vrsMode: 0,
    vrsUpdateMode: 1,
    vrsTexture: null,
    positionalShadowAtlasSize: 2048,
    positionalShadowAtlas16Bits: true,
    positionalShadowAtlasQuadrants: [2, 2, 3, 4],
    binding: null,
    listeners: new Set(),
  };
  VIEWPORT_RENDERING_QUALITY.set(owner, state);
  return state;
}

function snapshot(state: MutableQualityState): GodotViewportRenderingQualitySnapshot {
  return Object.freeze({
    msaa2d: state.msaa2d,
    screenSpaceAa: state.screenSpaceAa,
    temporalAa: state.temporalAa,
    debanding: state.debanding,
    scaling3dMode: state.scaling3dMode,
    scaling3dScale: state.scaling3dScale,
    fsrSharpness: state.fsrSharpness,
    textureMipmapBias: state.textureMipmapBias,
    anisotropicFilteringLevel: state.anisotropicFilteringLevel,
    meshLodThreshold: state.meshLodThreshold,
    vrsMode: state.vrsMode,
    vrsUpdateMode: state.vrsUpdateMode,
    vrsTexture: state.vrsTexture,
    positionalShadowAtlasSize: state.positionalShadowAtlasSize,
    positionalShadowAtlas16Bits: state.positionalShadowAtlas16Bits,
    positionalShadowAtlasQuadrants: Object.freeze([...state.positionalShadowAtlasQuadrants]) as unknown as readonly [number, number, number, number],
  });
}

function publish(state: MutableQualityState): void {
  const value = snapshot(state);
  state.binding?.apply(value);
  for (const listener of state.listeners) listener(value);
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`godot-compat: Viewport.${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  const number = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(number)) throw new TypeError(`godot-compat: Viewport.${member} requires an integer.`);
  return number;
}

function boolean(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: Viewport.${member} requires bool.`);
  return value;
}

export function bindGodotViewportRenderingQuality(
  viewport: unknown,
  binding: GodotViewportRenderingQualityBinding | null,
): () => void {
  const state = stateOf(viewport);
  state.binding = binding;
  if (binding !== null) binding.apply(snapshot(state));
  return () => {
    if (state.binding === binding) state.binding = null;
  };
}

export function watchGodotViewportRenderingQuality(
  viewport: unknown,
  listener: (snapshot: GodotViewportRenderingQualitySnapshot) => void,
): () => void {
  const state = stateOf(viewport);
  state.listeners.add(listener);
  listener(snapshot(state));
  return () => state.listeners.delete(listener);
}

export function getGodotViewportRenderingQuality(viewport: unknown): GodotViewportRenderingQualitySnapshot {
  return snapshot(stateOf(viewport));
}

export function getGodotViewportMsaa2d(viewport: unknown): number { return stateOf(viewport).msaa2d; }
export function setGodotViewportMsaa2d(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.msaa2d = integer(value, 'msaa_2d', 0, 3);
  publish(state);
}

export function getGodotViewportScreenSpaceAa(viewport: unknown): GodotViewportScreenSpaceAa { return stateOf(viewport).screenSpaceAa; }
export function setGodotViewportScreenSpaceAa(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.screenSpaceAa = integer(value, 'screen_space_aa', 0, 1) as GodotViewportScreenSpaceAa;
  publish(state);
}

export function isGodotViewportTemporalAaEnabled(viewport: unknown): boolean { return stateOf(viewport).temporalAa; }
export function setGodotViewportTemporalAaEnabled(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.temporalAa = boolean(value, 'use_taa');
  publish(state);
}

export function isGodotViewportDebandingEnabled(viewport: unknown): boolean { return stateOf(viewport).debanding; }
export function setGodotViewportDebandingEnabled(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.debanding = boolean(value, 'use_debanding');
  publish(state);
}

export function getGodotViewportScaling3dMode(viewport: unknown): GodotViewportScaling3dMode { return stateOf(viewport).scaling3dMode; }
export function setGodotViewportScaling3dMode(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.scaling3dMode = integer(value, 'scaling_3d_mode', 0, 4) as GodotViewportScaling3dMode;
  publish(state);
}

export function getGodotViewportScaling3dScale(viewport: unknown): number { return stateOf(viewport).scaling3dScale; }
export function setGodotViewportScaling3dScale(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.scaling3dScale = finite(value, 'scaling_3d_scale', 0.25, 2);
  publish(state);
}

export function getGodotViewportFsrSharpness(viewport: unknown): number { return stateOf(viewport).fsrSharpness; }
export function setGodotViewportFsrSharpness(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.fsrSharpness = finite(value, 'fsr_sharpness', 0, 2);
  publish(state);
}

export function getGodotViewportTextureMipmapBias(viewport: unknown): number { return stateOf(viewport).textureMipmapBias; }
export function setGodotViewportTextureMipmapBias(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.textureMipmapBias = finite(value, 'texture_mipmap_bias', -16, 16);
  publish(state);
}

export function getGodotViewportAnisotropicFilteringLevel(viewport: unknown): GodotViewportAnisotropy { return stateOf(viewport).anisotropicFilteringLevel; }
export function setGodotViewportAnisotropicFilteringLevel(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.anisotropicFilteringLevel = integer(value, 'anisotropic_filtering_level', 0, 4) as GodotViewportAnisotropy;
  publish(state);
}

export function getGodotViewportMeshLodThreshold(viewport: unknown): number { return stateOf(viewport).meshLodThreshold; }
export function setGodotViewportMeshLodThreshold(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.meshLodThreshold = finite(value, 'mesh_lod_threshold', 0);
  publish(state);
}

export function getGodotViewportVrsMode(viewport: unknown): GodotViewportVrsMode { return stateOf(viewport).vrsMode; }
export function setGodotViewportVrsMode(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.vrsMode = integer(value, 'vrs_mode', 0, 2) as GodotViewportVrsMode;
  publish(state);
}

export function getGodotViewportVrsUpdateMode(viewport: unknown): number { return stateOf(viewport).vrsUpdateMode; }
export function setGodotViewportVrsUpdateMode(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.vrsUpdateMode = integer(value, 'vrs_update_mode', 0, 4);
  publish(state);
}

export function getGodotViewportVrsTexture(viewport: unknown): Texture | null { return stateOf(viewport).vrsTexture; }
export function setGodotViewportVrsTexture(viewport: unknown, value: Texture | null): void {
  if (value !== null && (typeof value !== 'object' || !('isTexture' in value))) {
    throw new TypeError('godot-compat: Viewport.vrs_texture requires Texture2D or null.');
  }
  const state = stateOf(viewport);
  state.vrsTexture = value;
  publish(state);
}

export function getGodotViewportPositionalShadowAtlasSize(viewport: unknown): number { return stateOf(viewport).positionalShadowAtlasSize; }
export function setGodotViewportPositionalShadowAtlasSize(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.positionalShadowAtlasSize = integer(value, 'positional_shadow_atlas_size', 0, 16384);
  publish(state);
}

export function isGodotViewportPositionalShadowAtlas16Bits(viewport: unknown): boolean { return stateOf(viewport).positionalShadowAtlas16Bits; }
export function setGodotViewportPositionalShadowAtlas16Bits(viewport: unknown, value: unknown): void {
  const state = stateOf(viewport);
  state.positionalShadowAtlas16Bits = boolean(value, 'positional_shadow_atlas_16_bits');
  publish(state);
}

export function getGodotViewportPositionalShadowAtlasQuadrantSubdivision(viewport: unknown, quadrant: unknown): number {
  return stateOf(viewport).positionalShadowAtlasQuadrants[integer(quadrant, 'positional_shadow_atlas_quadrant', 0, 3)]!;
}

export function setGodotViewportPositionalShadowAtlasQuadrantSubdivision(
  viewport: unknown,
  quadrant: unknown,
  subdivision: unknown,
): void {
  const state = stateOf(viewport);
  const index = integer(quadrant, 'positional_shadow_atlas_quadrant', 0, 3);
  state.positionalShadowAtlasQuadrants[index] = integer(subdivision, 'positional_shadow_atlas_quadrant_subdiv', 0, 6);
  publish(state);
}
