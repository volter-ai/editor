import type { Object3D, Texture } from 'three';
import { registerGodotObjectIdentity } from './object';
import { godotMaterialTexture } from './texture-3d';
import type { ColorValue } from './variant';

export const GODOT_LIGHTMAP_GI_BAKE_QUALITY = { LOW: 0, MEDIUM: 1, HIGH: 2, ULTRA: 3, BAKE_QUALITY_LOW: 0, BAKE_QUALITY_MEDIUM: 1, BAKE_QUALITY_HIGH: 2, BAKE_QUALITY_ULTRA: 3 } as const;
export const GODOT_LIGHTMAP_GI_ENVIRONMENT_MODE = { DISABLED: 0, SCENE: 1, CUSTOM_SKY: 2, CUSTOM_COLOR: 3, ENVIRONMENT_MODE_DISABLED: 0, ENVIRONMENT_MODE_SCENE: 1, ENVIRONMENT_MODE_CUSTOM_SKY: 2, ENVIRONMENT_MODE_CUSTOM_COLOR: 3 } as const;
export const GODOT_LIGHTMAP_GI_GENERATE_PROBES = { DISABLED: 0, SUBDIV_4: 1, SUBDIV_8: 2, SUBDIV_16: 3, SUBDIV_32: 4, GENERATE_PROBES_DISABLED: 0, GENERATE_PROBES_SUBDIV_4: 1, GENERATE_PROBES_SUBDIV_8: 2, GENERATE_PROBES_SUBDIV_16: 3, GENERATE_PROBES_SUBDIV_32: 4 } as const;
export const GODOT_LIGHTMAP_GI_SHADOWMASK_MODE = { NONE: 0, REPLACE: 1, OVERLAY: 2, SHADOWMASK_MODE_NONE: 0, SHADOWMASK_MODE_REPLACE: 1, SHADOWMASK_MODE_OVERLAY: 2 } as const;

export interface GodotLightmapTextureBinding {
  readonly texture: Texture;
  readonly shadowmask?: Texture | null;
  readonly layer?: number;
}

export interface GodotLightmapGIData {
  readonly __godotClass: 'LightmapGIData';
  lightTextures: GodotLightmapTextureBinding[];
  usesSphericalHarmonics: boolean;
  bakedExposure: number;
  interior: boolean;
  userData: Record<string, unknown>;
}

export interface GodotLightmapGI {
  readonly __godotClass: 'LightmapGI';
  quality: number;
  bounces: number;
  bounce_indirect_energy: number;
  directional: boolean;
  interior: boolean;
  use_texture_for_bounces: boolean;
  bias: number;
  texel_scale: number;
  max_texture_size: number;
  supersampling_enabled: boolean;
  supersampling_factor: number;
  environment_mode: number;
  environment_custom_sky: unknown | null;
  environment_custom_color: ColorValue;
  environment_custom_energy: number;
  camera_attributes: unknown | null;
  generate_probes: number;
  probe_subdiv: number;
  baked_exposure_normalization: number;
  denoiser_range: number;
  denoiser_strength: number;
  denoiser_enabled: boolean;
  shadowmask_mode: number;
  light_data: GodotLightmapGIData | null;
}

export interface GodotLightmapGIApplyBinding {
  apply(node: GodotLightmapGI, data: GodotLightmapGIData | null): void;
}

type Listener = (node: GodotLightmapGI, member: string) => void;
const NODE_LISTENERS = new WeakMap<GodotLightmapGI, Set<Listener>>();
const DATA_LISTENERS = new WeakMap<GodotLightmapGIData, Set<() => void>>();
const NODE_BINDINGS = new WeakMap<GodotLightmapGI, GodotLightmapGIApplyBinding>();

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new RangeError(`godot-compat: LightmapGI.${member} requires a finite value in [${minimum}, ${maximum}].`);
  return value;
}
function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  const number = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(number)) throw new TypeError(`godot-compat: LightmapGI.${member} requires an integer.`);
  return number;
}
function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: LightmapGI.${member} requires bool.`);
  return value;
}
function color(value: unknown): ColorValue {
  if (typeof value !== 'object' || value === null || !('r' in value) || !('g' in value) || !('b' in value)) throw new TypeError('godot-compat: LightmapGI.environment_custom_color requires Color.');
  return Object.freeze({ r: finite(value.r, 'environment_custom_color.r'), g: finite(value.g, 'environment_custom_color.g'), b: finite(value.b, 'environment_custom_color.b'), a: finite('a' in value ? value.a : 1, 'environment_custom_color.a') });
}

function emit(node: GodotLightmapGI, member: string): void {
  for (const listener of NODE_LISTENERS.get(node) ?? []) listener(node, member);
  NODE_BINDINGS.get(node)?.apply(node, node.light_data);
}

function property(node: GodotLightmapGI, member: string, initial: unknown, normalize: (value: unknown) => unknown): void {
  let retained = normalize(initial);
  Object.defineProperty(node, member, { enumerable: true, configurable: true, get: () => retained, set: (value: unknown) => { retained = normalize(value); emit(node, member); } });
}

function lightmapData(value: unknown): GodotLightmapGIData | null {
  if (value === null) return null;
  if (typeof value !== 'object' || (value as { __godotClass?: unknown }).__godotClass !== 'LightmapGIData') throw new TypeError('godot-compat: LightmapGI.light_data requires LightmapGIData or null.');
  return value as GodotLightmapGIData;
}

export function createGodotLightmapGIData(): GodotLightmapGIData {
  const data: GodotLightmapGIData = { __godotClass: 'LightmapGIData', lightTextures: [], usesSphericalHarmonics: false, bakedExposure: 1, interior: false, userData: {} };
  DATA_LISTENERS.set(data, new Set());
  registerGodotObjectIdentity(data, 'LightmapGIData');
  return data;
}

export function setGodotLightmapGIDataTextures(data: GodotLightmapGIData, textures: readonly GodotLightmapTextureBinding[]): void {
  if (!Array.isArray(textures)) throw new TypeError('godot-compat: LightmapGIData textures require Array.');
  data.lightTextures = textures.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || !entry.texture || !('isTexture' in entry.texture)) throw new TypeError(`godot-compat: LightmapGIData texture ${index} requires native Texture.`);
    return Object.freeze({ texture: entry.texture, shadowmask: entry.shadowmask ?? null, layer: integer(entry.layer ?? index, 'LightmapGIData.layer', 0, 65535) });
  });
  for (const listener of DATA_LISTENERS.get(data) ?? []) listener();
}

export function getGodotLightmapGIDataTextures(data: GodotLightmapGIData): GodotLightmapTextureBinding[] { return data.lightTextures.map((entry) => ({ ...entry })); }
export function setGodotLightmapGIDataUsesSphericalHarmonics(data: GodotLightmapGIData, value: unknown): void { data.usesSphericalHarmonics = bool(value, 'LightmapGIData.uses_spherical_harmonics'); for (const listener of DATA_LISTENERS.get(data) ?? []) listener(); }
export function isGodotLightmapGIDataUsingSphericalHarmonics(data: GodotLightmapGIData): boolean { return data.usesSphericalHarmonics; }
export function setGodotLightmapGIDataUserData(data: GodotLightmapGIData, value: unknown): void { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('LightmapGIData.user_data requires Dictionary.'); data.userData = { ...(value as Record<string, unknown>) }; for (const listener of DATA_LISTENERS.get(data) ?? []) listener(); }
export function getGodotLightmapGIDataUserData(data: GodotLightmapGIData): Record<string, unknown> { return { ...data.userData }; }

export function createGodotLightmapGI(): GodotLightmapGI {
  const node = { __godotClass: 'LightmapGI' as const } as GodotLightmapGI;
  property(node, 'quality', 1, (value) => integer(value, 'quality', 0, 3));
  property(node, 'bounces', 3, (value) => integer(value, 'bounces', 0, 16));
  property(node, 'bounce_indirect_energy', 1, (value) => finite(value, 'bounce_indirect_energy', 0));
  property(node, 'directional', false, (value) => bool(value, 'directional'));
  property(node, 'interior', false, (value) => bool(value, 'interior'));
  property(node, 'use_texture_for_bounces', true, (value) => bool(value, 'use_texture_for_bounces'));
  property(node, 'bias', 0.0005, (value) => finite(value, 'bias', 0));
  property(node, 'texel_scale', 1, (value) => finite(value, 'texel_scale', Number.MIN_VALUE));
  property(node, 'max_texture_size', 16384, (value) => integer(value, 'max_texture_size', 64, 65536));
  property(node, 'supersampling_enabled', false, (value) => bool(value, 'supersampling_enabled'));
  property(node, 'supersampling_factor', 2, (value) => finite(value, 'supersampling_factor', 1, 8));
  property(node, 'environment_mode', 1, (value) => integer(value, 'environment_mode', 0, 3));
  property(node, 'environment_custom_sky', null, (value) => value ?? null);
  property(node, 'environment_custom_color', { r: 1, g: 1, b: 1, a: 1 }, color);
  property(node, 'environment_custom_energy', 1, (value) => finite(value, 'environment_custom_energy', 0));
  property(node, 'camera_attributes', null, (value) => value ?? null);
  property(node, 'generate_probes', 2, (value) => integer(value, 'generate_probes', 0, 4));
  property(node, 'probe_subdiv', 8, (value) => integer(value, 'probe_subdiv', 1, 64));
  property(node, 'baked_exposure_normalization', 1, (value) => finite(value, 'baked_exposure_normalization', 0));
  property(node, 'denoiser_range', 10, (value) => finite(value, 'denoiser_range', 0));
  property(node, 'denoiser_strength', 0.1, (value) => finite(value, 'denoiser_strength', 0, 1));
  property(node, 'denoiser_enabled', true, (value) => bool(value, 'denoiser_enabled'));
  property(node, 'shadowmask_mode', 0, (value) => integer(value, 'shadowmask_mode', 0, 2));
  property(node, 'light_data', null, lightmapData);
  NODE_LISTENERS.set(node, new Set());
  registerGodotObjectIdentity(node, 'LightmapGI');
  return node;
}

export function bindGodotLightmapGI(node: GodotLightmapGI, binding: GodotLightmapGIApplyBinding): () => void {
  NODE_BINDINGS.set(node, binding); binding.apply(node, node.light_data);
  let releaseData: (() => void) | undefined;
  const rebindData = () => {
    releaseData?.(); releaseData = undefined;
    if (node.light_data !== null) {
      const listeners = DATA_LISTENERS.get(node.light_data)!;
      const apply = () => binding.apply(node, node.light_data);
      listeners.add(apply); releaseData = () => listeners.delete(apply);
    }
    binding.apply(node, node.light_data);
  };
  const releaseNode = watchGodotLightmapGI(node, (_node, member) => { if (member === 'light_data') rebindData(); });
  rebindData();
  return () => { releaseNode(); releaseData?.(); if (NODE_BINDINGS.get(node) === binding) NODE_BINDINGS.delete(node); };
}

export function watchGodotLightmapGI(node: GodotLightmapGI, listener: Listener): () => void {
  let listeners = NODE_LISTENERS.get(node); if (listeners === undefined) { listeners = new Set(); NODE_LISTENERS.set(node, listeners); }
  listeners.add(listener); return () => listeners?.delete(listener);
}

export function applyGodotLightmapGIToObjects(data: GodotLightmapGIData, objects: readonly Object3D[]): void {
  for (const [index, root] of objects.entries()) {
    const binding = data.lightTextures[index] ?? data.lightTextures[0];
    if (binding === undefined) continue;
    root.traverse((object) => {
      type LightmappedMaterial = { lightMap?: Texture | null; lightMapIntensity?: number; needsUpdate?: boolean };
      const authored = Reflect.get(object, 'material') as LightmappedMaterial | LightmappedMaterial[] | undefined;
      if (authored === undefined) return;
      for (const material of Array.isArray(authored) ? authored : [authored]) {
        // Godot samples baked lightmaps from ARRAY_TEX_UV2. Three r180's channel 1 selects the
        // geometry attribute named `uv1`; keep that slot-local choice off the shared source texture.
        material.lightMap = godotMaterialTexture(binding.texture, { uvSet: 1, data: true });
        material.lightMapIntensity = data.bakedExposure;
        material.needsUpdate = true;
      }
    });
  }
}
