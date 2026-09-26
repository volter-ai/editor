/**
 * A Godot `SpatialMaterial` as a three `MeshStandardMaterial` / `MeshBasicMaterial`.
 *
 * The BAG is produced by `gd-analyze`'s `translate/data/spatial-material.ts` and stored as a
 * {@link GodotExternalMaterial} table row. This file constructs the three material from that bag;
 * it does not re-read Godot properties. Scene JSX still spells the same bag as element attributes
 * — `createSpatialMaterial` is the constructor-call twin `withExternalMaterials` uses.
 */

import {
  AdditiveBlending,
  BackSide,
  DoubleSide,
  FrontSide,
  GreaterDepth,
  LessEqualDepth,
  type Material,
  MeshBasicMaterial,
  type MeshBasicMaterialParameters,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MultiplyBlending,
  NormalBlending,
  type MeshStandardMaterialParameters,
  SRGBColorSpace,
  Texture,
  SubtractiveBlending,
  type Vector3Like,
} from 'three';
import {
  bindGodotMaterial,
  duplicateGodotMaterial,
  type GodotMaterialDuplicateProtocol,
} from './material';
import {
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { ColorValue } from './variant';
import { setGodotAlphaDepthPrepassMaterial } from './alpha-depth-prepass-material';

/**
 * One extracted material as its three CLASS plus that class's own parameters.
 *
 * The class is part of the row rather than assumed, because Godot's `flags_unshaded` is not a
 * parameter in three: an unshaded surface is a `MeshBasicMaterial`, which has no roughness,
 * metalness or emissive at all. That is also why the walk REPLACES rather than patches — a
 * loader-built `MeshStandardMaterial` cannot be assigned into a basic one.
 */
export type GodotExternalMaterial =
  | { readonly kind: 'standard'; readonly params: MeshStandardMaterialParameters }
  | { readonly kind: 'basic'; readonly params: MeshBasicMaterialParameters };

/** Construct the three material `withExternalMaterials` used to `new` inline. */
export function createSpatialMaterial(bag: GodotExternalMaterial): Material {
  const material = bag.kind === 'basic'
    ? new MeshBasicMaterial(bag.params)
    : new MeshStandardMaterial(bag.params);
  bindGodotMaterial(material);
  return material;
}

export const GODOT_BASE_MATERIAL_CULL_MODE = {
  BACK: 0,
  FRONT: 1,
  DISABLED: 2,
  CULL_BACK: 0,
  CULL_FRONT: 1,
  CULL_DISABLED: 2,
} as const;

export const GODOT_BASE_MATERIAL_BLEND_MODE = {
  MIX: 0,
  ADD: 1,
  SUB: 2,
  MUL: 3,
  PREMULT_ALPHA: 4,
  BLEND_MODE_MIX: 0,
  BLEND_MODE_ADD: 1,
  BLEND_MODE_SUB: 2,
  BLEND_MODE_MUL: 3,
  BLEND_MODE_PREMULT_ALPHA: 4,
} as const;

export const GODOT_BASE_MATERIAL_BILLBOARD_MODE = {
  DISABLED: 0,
  ENABLED: 1,
  FIXED_Y: 2,
  PARTICLES: 3,
  BILLBOARD_DISABLED: 0,
  BILLBOARD_ENABLED: 1,
  BILLBOARD_FIXED_Y: 2,
  BILLBOARD_PARTICLES: 3,
} as const;

export const GODOT_BASE_MATERIAL_TEXTURE = {
  ALBEDO: 0,
  METALLIC: 1,
  ROUGHNESS: 2,
  EMISSION: 3,
  NORMAL: 4,
  RIM: 5,
  CLEARCOAT: 6,
  FLOWMAP: 7,
  AMBIENT_OCCLUSION: 8,
  HEIGHTMAP: 9,
  SUBSURFACE_SCATTERING: 10,
  SUBSURFACE_TRANSMITTANCE: 11,
  BACKLIGHT: 12,
  REFRACTION: 13,
  DETAIL_MASK: 14,
  DETAIL_ALBEDO: 15,
  DETAIL_NORMAL: 16,
  ORM: 17,
  BENT_NORMAL: 18,
  MAX: 19,
  TEXTURE_ALBEDO: 0,
  TEXTURE_METALLIC: 1,
  TEXTURE_ROUGHNESS: 2,
  TEXTURE_EMISSION: 3,
  TEXTURE_NORMAL: 4,
  TEXTURE_RIM: 5,
  TEXTURE_CLEARCOAT: 6,
  TEXTURE_FLOWMAP: 7,
  TEXTURE_AMBIENT_OCCLUSION: 8,
  TEXTURE_HEIGHTMAP: 9,
  TEXTURE_SUBSURFACE_SCATTERING: 10,
  TEXTURE_SUBSURFACE_TRANSMITTANCE: 11,
  TEXTURE_BACKLIGHT: 12,
  TEXTURE_REFRACTION: 13,
  TEXTURE_DETAIL_MASK: 14,
  TEXTURE_DETAIL_ALBEDO: 15,
  TEXTURE_DETAIL_NORMAL: 16,
  TEXTURE_ORM: 17,
  TEXTURE_BENT_NORMAL: 18,
  TEXTURE_MAX: 19,
} as const;

export const GODOT_BASE_MATERIAL_TRANSPARENCY = {
  DISABLED: 0,
  ALPHA: 1,
  ALPHA_SCISSOR: 2,
  ALPHA_HASH: 3,
  DEPTH_PRE_PASS: 4,
  TRANSPARENCY_DISABLED: 0,
  TRANSPARENCY_ALPHA: 1,
  TRANSPARENCY_ALPHA_SCISSOR: 2,
  TRANSPARENCY_ALPHA_HASH: 3,
  TRANSPARENCY_ALPHA_DEPTH_PRE_PASS: 4,
  TRANSPARENCY_MAX: 5,
} as const;

export const GODOT_BASE_MATERIAL_SHADING_MODE = {
  UNSHADED: 0,
  PER_PIXEL: 1,
  PER_VERTEX: 2,
  SHADING_MODE_UNSHADED: 0,
  SHADING_MODE_PER_PIXEL: 1,
  SHADING_MODE_PER_VERTEX: 2,
  SHADING_MODE_MAX: 3,
} as const;

export const GODOT_BASE_MATERIAL_FEATURE = {
  EMISSION: 0,
  NORMAL_MAPPING: 1,
  RIM: 2,
  CLEARCOAT: 3,
  ANISOTROPY: 4,
  AMBIENT_OCCLUSION: 5,
  HEIGHT_MAPPING: 6,
  SUBSURFACE_SCATTERING: 7,
  SUBSURFACE_TRANSMITTANCE: 8,
  BACKLIGHT: 9,
  REFRACTION: 10,
  DETAIL: 11,
  BENT_NORMAL_MAPPING: 12,
  MAX: 13,
  FEATURE_EMISSION: 0,
  FEATURE_NORMAL_MAPPING: 1,
  FEATURE_RIM: 2,
  FEATURE_CLEARCOAT: 3,
  FEATURE_ANISOTROPY: 4,
  FEATURE_AMBIENT_OCCLUSION: 5,
  FEATURE_HEIGHT_MAPPING: 6,
  FEATURE_SUBSURFACE_SCATTERING: 7,
  FEATURE_SUBSURFACE_TRANSMITTANCE: 8,
  FEATURE_BACKLIGHT: 9,
  FEATURE_REFRACTION: 10,
  FEATURE_DETAIL: 11,
  FEATURE_BENT_NORMAL_MAPPING: 12,
  FEATURE_MAX: 13,
} as const;

export const GODOT_BASE_MATERIAL_DEPTH_DRAW_MODE = {
  OPAQUE_ONLY: 0,
  ALWAYS: 1,
  DISABLED: 2,
  DEPTH_DRAW_OPAQUE_ONLY: 0,
  DEPTH_DRAW_ALWAYS: 1,
  DEPTH_DRAW_DISABLED: 2,
} as const;

export const GODOT_BASE_MATERIAL_DEPTH_TEST = {
  DEFAULT: 0,
  INVERTED: 1,
  DEPTH_TEST_DEFAULT: 0,
  DEPTH_TEST_INVERTED: 1,
} as const;

export const GODOT_BASE_MATERIAL_ALPHA_ANTIALIASING = {
  OFF: 0,
  ALPHA_TO_COVERAGE: 1,
  ALPHA_TO_COVERAGE_AND_TO_ONE: 2,
  ALPHA_ANTIALIASING_OFF: 0,
  ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE: 1,
  ALPHA_ANTIALIASING_ALPHA_TO_COVERAGE_AND_TO_ONE: 2,
} as const;

export const GODOT_BASE_MATERIAL_TEXTURE_CHANNEL = {
  RED: 0,
  GREEN: 1,
  BLUE: 2,
  ALPHA: 3,
  GRAYSCALE: 4,
  TEXTURE_CHANNEL_RED: 0,
  TEXTURE_CHANNEL_GREEN: 1,
  TEXTURE_CHANNEL_BLUE: 2,
  TEXTURE_CHANNEL_ALPHA: 3,
  TEXTURE_CHANNEL_GRAYSCALE: 4,
} as const;

export const GODOT_BASE_MATERIAL_DETAIL_UV = {
  UV_1: 0,
  UV_2: 1,
  DETAIL_UV_1: 0,
  DETAIL_UV_2: 1,
} as const;
export const GODOT_BASE_MATERIAL_DIFFUSE_MODE = {
  BURLEY: 0,
  LAMBERT: 1,
  LAMBERT_WRAP: 2,
  TOON: 3,
  DIFFUSE_BURLEY: 0,
  DIFFUSE_LAMBERT: 1,
  DIFFUSE_LAMBERT_WRAP: 2,
  DIFFUSE_TOON: 3,
} as const;
export const GODOT_BASE_MATERIAL_SPECULAR_MODE = {
  SCHLICK_GGX: 0,
  TOON: 1,
  DISABLED: 2,
  SPECULAR_SCHLICK_GGX: 0,
  SPECULAR_TOON: 1,
  SPECULAR_DISABLED: 2,
} as const;
export const GODOT_BASE_MATERIAL_EMISSION_OPERATOR = {
  ADD: 0,
  MULTIPLY: 1,
  EMISSION_OP_ADD: 0,
  EMISSION_OP_MULTIPLY: 1,
} as const;
export const GODOT_BASE_MATERIAL_DISTANCE_FADE_MODE = {
  DISABLED: 0,
  PIXEL_ALPHA: 1,
  PIXEL_DITHER: 2,
  OBJECT_DITHER: 3,
  DISTANCE_FADE_DISABLED: 0,
  DISTANCE_FADE_PIXEL_ALPHA: 1,
  DISTANCE_FADE_PIXEL_DITHER: 2,
  DISTANCE_FADE_OBJECT_DITHER: 3,
} as const;

export const GODOT_BASE_MATERIAL_TEXTURE_FILTER = {
  TEXTURE_FILTER_NEAREST: 0,
  TEXTURE_FILTER_LINEAR: 1,
  TEXTURE_FILTER_NEAREST_WITH_MIPMAPS: 2,
  TEXTURE_FILTER_LINEAR_WITH_MIPMAPS: 3,
  TEXTURE_FILTER_NEAREST_WITH_MIPMAPS_ANISOTROPIC: 4,
  TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC: 5,
  TEXTURE_FILTER_MAX: 6,
} as const;

export const GODOT_BASE_MATERIAL_FLAGS = {
  FLAG_DISABLE_DEPTH_TEST: 0,
  FLAG_ALBEDO_FROM_VERTEX_COLOR: 1,
  FLAG_SRGB_VERTEX_COLOR: 2,
  FLAG_USE_POINT_SIZE: 3,
  FLAG_FIXED_SIZE: 4,
  FLAG_BILLBOARD_KEEP_SCALE: 5,
  FLAG_UV1_USE_TRIPLANAR: 6,
  FLAG_UV2_USE_TRIPLANAR: 7,
  FLAG_UV1_USE_WORLD_TRIPLANAR: 8,
  FLAG_UV2_USE_WORLD_TRIPLANAR: 9,
  FLAG_AO_ON_UV2: 10,
  FLAG_EMISSION_ON_UV2: 11,
  FLAG_ALBEDO_TEXTURE_FORCE_SRGB: 12,
  FLAG_DONT_RECEIVE_SHADOWS: 13,
  FLAG_DISABLE_AMBIENT_LIGHT: 14,
  FLAG_USE_SHADOW_TO_OPACITY: 15,
  FLAG_USE_TEXTURE_REPEAT: 16,
  FLAG_INVERT_HEIGHTMAP: 17,
  FLAG_SUBSURFACE_MODE_SKIN: 18,
  FLAG_PARTICLE_TRAILS_MODE: 19,
  FLAG_ALBEDO_TEXTURE_MSDF: 20,
  FLAG_DISABLE_FOG: 21,
  FLAG_DISABLE_SPECULAR_OCCLUSION: 22,
  FLAG_USE_Z_CLIP_SCALE: 23,
  FLAG_USE_FOV_OVERRIDE: 24,
  FLAG_MAX: 25,
} as const;

export const GODOT_BASE_MATERIAL_STENCIL_MODE = {
  STENCIL_MODE_DISABLED: 0,
  STENCIL_MODE_OUTLINE: 1,
  STENCIL_MODE_XRAY: 2,
  STENCIL_MODE_CUSTOM: 3,
} as const;
export const GODOT_BASE_MATERIAL_STENCIL_FLAGS = {
  STENCIL_FLAG_READ: 1,
  STENCIL_FLAG_WRITE: 2,
  STENCIL_FLAG_WRITE_DEPTH_FAIL: 4,
} as const;
export const GODOT_BASE_MATERIAL_STENCIL_COMPARE = {
  STENCIL_COMPARE_ALWAYS: 0,
  STENCIL_COMPARE_LESS: 1,
  STENCIL_COMPARE_EQUAL: 2,
  STENCIL_COMPARE_LESS_OR_EQUAL: 3,
  STENCIL_COMPARE_GREATER: 4,
  STENCIL_COMPARE_NOT_EQUAL: 5,
  STENCIL_COMPARE_GREATER_OR_EQUAL: 6,
} as const;

export interface GodotStandardMaterial3DState {
  readonly godotClass: 'SpatialMaterial' | 'StandardMaterial3D' | 'ORMMaterial3D';
  albedo: ColorValue;
  metallic: number;
  roughness: number;
  blendMode: number;
  billboardMode: number;
  cullMode: number;
  transparency: number;
  emission: ColorValue;
  emissionEnabled: boolean;
  emissionEnergy: number;
  normalScale: number;
  vertexColorUseAsAlbedo: boolean;
  noDepthTest: boolean;
  alphaScissorEnabled: boolean;
  alphaScissorThreshold: number;
  shadingMode: number;
  clearcoatEnabled: boolean;
  clearcoat: number;
  clearcoatRoughness: number;
  anisotropyEnabled: boolean;
  anisotropy: number;
  normalEnabled: boolean;
  aoEnabled: boolean;
  depthDrawMode: number;
  depthTest: number;
  disableFog: boolean;
  uv1Scale: { x: number; y: number; z: number };
  readonly unshadedUniform: { value: number };
  readonly textures: Map<number, Texture>;
  readonly textureReleases: Map<number, () => void>;
}

export type GodotStandardMaterial3D = MeshStandardMaterial & {
  duplicate(deep?: boolean): GodotStandardMaterial3D;
};

/**
 * Source state needed when AnimationPlayer reaches a SpatialMaterial through a
 * `material_override:<property>` NodePath.  The renderer material is still the native material
 * authored by the Three scene; this record retains the Godot Resource's independent property
 * values so changing one property does not reverse-engineer the others from renderer state.
 */
export interface GodotSpatialMaterialAnimationState {
  readonly godotClass: 'SpatialMaterial' | 'StandardMaterial3D';
  readonly emission: ColorValue;
  readonly emissionEnabled: boolean;
  readonly emissionTexture: boolean;
  readonly hdr: boolean;
  emissionEnergy: number;
}

const standardMaterialStates = new WeakMap<MeshStandardMaterial, GodotStandardMaterial3DState>();
const animatedSpatialMaterialStates = new WeakMap<Material, GodotSpatialMaterialAnimationState>();

function copyColor(value: ColorValue): ColorValue {
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function materialColor(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${member} requires a Color value.`);
  }
  const color = {
    r: Number(Reflect.get(value, 'r')),
    g: Number(Reflect.get(value, 'g')),
    b: Number(Reflect.get(value, 'b')),
    a: Number(Reflect.get(value, 'a')),
  };
  if (![color.r, color.g, color.b, color.a].every(Number.isFinite)) {
    throw new TypeError(`${member} requires four finite Color channels.`);
  }
  return color;
}

function scalar(value: unknown, member: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${member} requires a finite float.`);
  return number;
}

/** Retain the Godot Resource state on an already-authored native Three material. */
export function bindGodotSpatialMaterialAnimationState(
  material: Material,
  source: GodotSpatialMaterialAnimationState,
): void {
  if (!(material instanceof MeshStandardMaterial) && !(material instanceof MeshBasicMaterial)) {
    throw new TypeError(
      `${source.godotClass} animation requires a native MeshStandardMaterial or MeshBasicMaterial.`,
    );
  }
  if (animatedSpatialMaterialStates.has(material)) return;
  animatedSpatialMaterialStates.set(material, {
    ...source,
    emission: copyColor(source.emission),
    emissionEnergy: scalar(source.emissionEnergy, `${source.godotClass}.emission_energy`),
  });
}

/**
 * Godot 3's Material3D shader multiplies the complete emission term by `emission_energy`.
 * Preserve that multiplication over Three's emissive color/intensity pair; an unshaded native
 * material has no emission term, so a disabled emission remains a source-faithful no-op.
 */
export function setGodotSpatialMaterialAnimationEmissionEnergy(
  material: Material,
  value: unknown,
): void {
  const state = animatedSpatialMaterialStates.get(material);
  if (state === undefined) {
    throw new TypeError(
      'material_override:emission_energy requires a retained SpatialMaterial/StandardMaterial3D Resource.',
    );
  }
  state.emissionEnergy = scalar(value, `${state.godotClass}.emission_energy`);
  if (!state.emissionEnabled) {
    material.needsUpdate = true;
    godotResourceEmitChanged(material);
    return;
  }
  if (!(material instanceof MeshStandardMaterial)) {
    throw new Error(
      `${state.godotClass}.emission_energy cannot mutate an enabled emission term on an unshaded native material.`,
    );
  }
  if (state.hdr || state.emissionTexture) {
    material.emissive.setRGB(state.emission.r, state.emission.g, state.emission.b, SRGBColorSpace);
    material.emissiveIntensity = state.emissionEnergy;
  } else {
    material.emissive.setRGB(
      Math.max(0, Math.min(1, state.emission.r * state.emissionEnergy)),
      Math.max(0, Math.min(1, state.emission.g * state.emissionEnergy)),
      Math.max(0, Math.min(1, state.emission.b * state.emissionEnergy)),
      SRGBColorSpace,
    );
    material.emissiveIntensity = 1;
  }
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotSpatialMaterialAnimationEmissionEnergy(material: Material): number {
  const state = animatedSpatialMaterialStates.get(material);
  if (state === undefined) {
    throw new TypeError(
      'material_override:emission_energy requires a retained SpatialMaterial/StandardMaterial3D Resource.',
    );
  }
  return state.emissionEnergy;
}

function standardState(material: MeshStandardMaterial): GodotStandardMaterial3DState {
  const state = standardMaterialStates.get(material);
  if (state === undefined) {
    throw new Error('godot-compat: native Three material has no Spatial/StandardMaterial3D state.');
  }
  return state;
}

function physicalMaterial(
  material: MeshStandardMaterial,
  member: string,
): MeshPhysicalMaterial {
  if (!(material instanceof MeshPhysicalMaterial)) {
    throw new Error(`${member} requires the retained native MeshPhysicalMaterial owner.`);
  }
  return material;
}

function applyAlbedo(
  material: MeshStandardMaterial,
  state: GodotStandardMaterial3DState,
): void {
  const color = state.albedo;
  material.color.setRGB(color.r, color.g, color.b, SRGBColorSpace);
  material.opacity = color.a;
  material.transparent = state.transparency === GODOT_BASE_MATERIAL_TRANSPARENCY.ALPHA ||
    state.transparency === GODOT_BASE_MATERIAL_TRANSPARENCY.DEPTH_PRE_PASS ||
    state.blendMode !== GODOT_BASE_MATERIAL_BLEND_MODE.MIX;
  material.alphaHash = state.transparency === GODOT_BASE_MATERIAL_TRANSPARENCY.ALPHA_HASH;
  material.alphaTest = state.alphaScissorEnabled ? state.alphaScissorThreshold : 0;
  material.premultipliedAlpha = state.blendMode === GODOT_BASE_MATERIAL_BLEND_MODE.PREMULT_ALPHA;
  material.depthWrite = state.depthDrawMode === GODOT_BASE_MATERIAL_DEPTH_DRAW_MODE.ALWAYS ||
    (state.depthDrawMode === GODOT_BASE_MATERIAL_DEPTH_DRAW_MODE.OPAQUE_ONLY &&
      !material.transparent);
  setGodotAlphaDepthPrepassMaterial(
    material,
    state.transparency === GODOT_BASE_MATERIAL_TRANSPARENCY.DEPTH_PRE_PASS,
  );
  material.needsUpdate = true;
}

function applyEmission(
  material: MeshStandardMaterial,
  state: GodotStandardMaterial3DState,
): void {
  material.emissive.setRGB(state.emission.r, state.emission.g, state.emission.b);
  material.emissiveIntensity = state.emissionEnabled ? state.emissionEnergy : 0;
  material.needsUpdate = true;
}

function installStandardMaterialState(
  material: MeshStandardMaterial,
  state: GodotStandardMaterial3DState,
): GodotStandardMaterial3D {
  const native = material as GodotStandardMaterial3D;
  standardMaterialStates.set(native, state);
  const previousCompile = native.onBeforeCompile.bind(native);
  const previousKey = native.customProgramCacheKey.bind(native);
  native.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer);
    shader.uniforms['godotUnshaded'] = state.unshadedUniform;
    shader.uniforms['godotBillboardMode'] = { value: state.billboardMode };
    const litOutput = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;';
    if (!shader.fragmentShader.includes(litOutput)) {
      throw new Error('godot-compat: Three standard-material shader no longer exposes its outgoing-light seam.');
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      litOutput,
      `vec3 outgoingLight = godotUnshaded > 0.5
        ? diffuseColor.rgb
        : totalDiffuse + totalSpecular + totalEmissiveRadiance;`,
    ).replace(
      'void main() {',
      'uniform float godotUnshaded;\nvoid main() {',
    );
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'uniform float godotBillboardMode;\nvoid main() {',
    ).replace(
      '#include <project_vertex>',
      `vec4 mvPosition;
      if (godotBillboardMode < 0.5) {
        mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      } else {
        vec3 godotScale = vec3(
          length(modelViewMatrix[0].xyz),
          length(modelViewMatrix[1].xyz),
          length(modelViewMatrix[2].xyz)
        );
        vec4 godotCenter = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 godotBillboardPosition = transformed * godotScale;
        if (godotBillboardMode > 1.5 && godotBillboardMode < 2.5) {
          vec3 godotUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          vec3 godotForward = normalize(vec3(-godotCenter.x, 0.0, -godotCenter.z));
          vec3 godotRight = normalize(cross(godotUp, godotForward));
          godotBillboardPosition = godotRight * godotBillboardPosition.x +
            godotUp * godotBillboardPosition.y + godotForward * godotBillboardPosition.z;
        }
        mvPosition = godotCenter + vec4(godotBillboardPosition, 0.0);
        gl_Position = projectionMatrix * mvPosition;
      }`,
    );
  };
  native.customProgramCacheKey = () => `${previousKey()}|godot-shading-mode-v1|billboard-${state.billboardMode}`;
  for (const [parameter, texture] of state.textures) {
    bindTextureChange(native, state, parameter, texture);
  }
  native.addEventListener('dispose', () => {
    for (const release of state.textureReleases.values()) release();
    state.textureReleases.clear();
  });
  Object.defineProperty(native, 'duplicate', {
    configurable: true,
    value: (deep = false) => duplicateGodotStandardMaterial3D(native, deep),
  });
  return native;
}

function bindTextureChange(
  material: MeshStandardMaterial,
  state: GodotStandardMaterial3DState,
  parameter: number,
  texture: Texture | null,
): void {
  state.textureReleases.get(parameter)?.();
  state.textureReleases.delete(parameter);
  if (texture === null) return;
  const connection = godotResourceChangedSignal(texture).connect(() => {
    material.needsUpdate = true;
    godotResourceEmitChanged(material);
  });
  state.textureReleases.set(parameter, () => connection.disconnect());
}

function cloneGodotStandardMaterial3D(
  source: MeshStandardMaterial,
): GodotStandardMaterial3D {
  const sourceState = standardState(source);
  const copy = source.clone();
  bindGodotMaterial(copy, {}, sourceState.godotClass, standardMaterialDuplicateProtocol());
  return installStandardMaterialState(copy, {
    godotClass: sourceState.godotClass,
    albedo: copyColor(sourceState.albedo),
    metallic: sourceState.metallic,
    roughness: sourceState.roughness,
    blendMode: sourceState.blendMode,
    billboardMode: sourceState.billboardMode,
    cullMode: sourceState.cullMode,
    transparency: sourceState.transparency,
    emission: copyColor(sourceState.emission),
    emissionEnabled: sourceState.emissionEnabled,
    emissionEnergy: sourceState.emissionEnergy,
    normalScale: sourceState.normalScale,
    vertexColorUseAsAlbedo: sourceState.vertexColorUseAsAlbedo,
    noDepthTest: sourceState.noDepthTest,
    alphaScissorEnabled: sourceState.alphaScissorEnabled,
    alphaScissorThreshold: sourceState.alphaScissorThreshold,
    shadingMode: sourceState.shadingMode,
    clearcoatEnabled: sourceState.clearcoatEnabled,
    clearcoat: sourceState.clearcoat,
    clearcoatRoughness: sourceState.clearcoatRoughness,
    anisotropyEnabled: sourceState.anisotropyEnabled,
    anisotropy: sourceState.anisotropy,
    normalEnabled: sourceState.normalEnabled,
    aoEnabled: sourceState.aoEnabled,
    depthDrawMode: sourceState.depthDrawMode,
    depthTest: sourceState.depthTest,
    disableFog: sourceState.disableFog,
    uv1Scale: { ...sourceState.uv1Scale },
    unshadedUniform: { value: sourceState.unshadedUniform.value },
    textures: new Map(sourceState.textures),
    textureReleases: new Map(),
  });
}

function standardMaterialDuplicateProtocol(): GodotMaterialDuplicateProtocol<MeshStandardMaterial> {
  return {
    createDuplicate: cloneGodotStandardMaterial3D,
    populateDuplicate(source, target, subresources, memo) {
      if (!subresources) return;
      for (const [parameter, texture] of standardState(source).textures) {
        setGodotStandardMaterialTexture(
          target,
          parameter,
          duplicateGodotSubresource(texture, memo),
        );
      }
    },
  };
}

export function createGodotStandardMaterial3D(
  godotClass: GodotStandardMaterial3DState['godotClass'] = 'StandardMaterial3D',
): GodotStandardMaterial3D {
  const native = new MeshPhysicalMaterial();
  const state: GodotStandardMaterial3DState = {
    godotClass,
    albedo: { r: 1, g: 1, b: 1, a: 1 },
    metallic: 0,
    roughness: 1,
    blendMode: GODOT_BASE_MATERIAL_BLEND_MODE.MIX,
    billboardMode: GODOT_BASE_MATERIAL_BILLBOARD_MODE.DISABLED,
    cullMode: GODOT_BASE_MATERIAL_CULL_MODE.BACK,
    transparency: GODOT_BASE_MATERIAL_TRANSPARENCY.DISABLED,
    emission: { r: 0, g: 0, b: 0, a: 1 },
    emissionEnabled: false,
    emissionEnergy: 1,
    normalScale: 1,
    vertexColorUseAsAlbedo: false,
    noDepthTest: false,
    alphaScissorEnabled: false,
    alphaScissorThreshold: 0.5,
    shadingMode: GODOT_BASE_MATERIAL_SHADING_MODE.PER_PIXEL,
    clearcoatEnabled: false,
    clearcoat: 1,
    clearcoatRoughness: 0.5,
    anisotropyEnabled: false,
    anisotropy: 0,
    normalEnabled: false,
    aoEnabled: false,
    depthDrawMode: GODOT_BASE_MATERIAL_DEPTH_DRAW_MODE.OPAQUE_ONLY,
    depthTest: GODOT_BASE_MATERIAL_DEPTH_TEST.DEFAULT,
    disableFog: false,
    uv1Scale: { x: 1, y: 1, z: 1 },
    unshadedUniform: { value: 0 },
    textures: new Map(),
    textureReleases: new Map(),
  };
  native.clearcoatRoughness = state.clearcoatRoughness;
  bindGodotMaterial(native, {}, godotClass, standardMaterialDuplicateProtocol());
  applyAlbedo(native, state);
  applyEmission(native, state);
  return installStandardMaterialState(native, state);
}

export function createGodotSpatialMaterial(): GodotStandardMaterial3D {
  return createGodotStandardMaterial3D('SpatialMaterial');
}

export function createGodotORMMaterial3D(): GodotStandardMaterial3D {
  return createGodotStandardMaterial3D('ORMMaterial3D');
}

export function setGodotStandardMaterialAlbedo(
  material: MeshStandardMaterial,
  value: ColorValue,
): void {
  const state = standardState(material);
  state.albedo = materialColor(value, `${state.godotClass}.albedo_color`);
  applyAlbedo(material, state);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialAlbedo(material: MeshStandardMaterial): ColorValue {
  return copyColor(standardState(material).albedo);
}

export function setGodotStandardMaterialMetallic(
  material: MeshStandardMaterial,
  value: number,
): void {
  const state = standardState(material);
  state.metallic = scalar(value, `${state.godotClass}.metallic`);
  material.metalness = state.metallic;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialMetallic(material: MeshStandardMaterial): number {
  return standardState(material).metallic;
}

export function setGodotStandardMaterialRoughness(
  material: MeshStandardMaterial,
  value: number,
): void {
  const state = standardState(material);
  state.roughness = scalar(value, `${state.godotClass}.roughness`);
  material.roughness = state.roughness;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialRoughness(material: MeshStandardMaterial): number {
  return standardState(material).roughness;
}

/** Godot 3 Material3D UV1 scale over the native texture transform shared by its UV1 slots. */
export function setGodotStandardMaterialUv1Scale(
  material: MeshStandardMaterial,
  value: Vector3Like,
): void {
  if (![value?.x, value?.y, value?.z].every(Number.isFinite)) {
    throw new TypeError('Material3D.uv1_scale requires a finite Vector3.');
  }
  const state = standardState(material);
  state.uv1Scale = { x: value.x, y: value.y, z: value.z };
  for (const texture of state.textures.values()) texture.repeat.set(value.x, value.y);
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialUv1Scale(
  material: MeshStandardMaterial,
): { x: number; y: number; z: number } {
  return { ...standardState(material).uv1Scale };
}

export function setGodotStandardMaterialBlendMode(
  material: MeshStandardMaterial,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 4) {
    throw new RangeError(`BaseMaterial3D.blend_mode must be an integer from 0 through 4; got ${value}.`);
  }
  const state = standardState(material);
  if (state.blendMode === value) return;
  state.blendMode = value;
  material.blending = value === GODOT_BASE_MATERIAL_BLEND_MODE.ADD
    ? AdditiveBlending
    : value === GODOT_BASE_MATERIAL_BLEND_MODE.SUB
      ? SubtractiveBlending
      : value === GODOT_BASE_MATERIAL_BLEND_MODE.MUL
      ? MultiplyBlending
      : NormalBlending;
  applyAlbedo(material, state);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialBlendMode(material: MeshStandardMaterial): number {
  return standardState(material).blendMode;
}

export function setGodotStandardMaterialBillboardMode(
  material: MeshStandardMaterial,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new RangeError(`BaseMaterial3D.billboard_mode must be an integer from 0 through 3; got ${value}.`);
  }
  const state = standardState(material);
  if (state.billboardMode === value) return;
  state.billboardMode = value;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialBillboardMode(material: MeshStandardMaterial): number {
  return standardState(material).billboardMode;
}

export function setGodotStandardMaterialEmission(
  material: MeshStandardMaterial,
  value: ColorValue,
): void {
  const state = standardState(material);
  state.emission = materialColor(value, `${state.godotClass}.emission`);
  applyEmission(material, state);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialEmission(material: MeshStandardMaterial): ColorValue {
  return copyColor(standardState(material).emission);
}

export function setGodotStandardMaterialEmissionEnabled(
  material: MeshStandardMaterial,
  value: boolean,
): void {
  const state = standardState(material);
  state.emissionEnabled = Boolean(value);
  applyEmission(material, state);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialEmissionEnabled(material: MeshStandardMaterial): boolean {
  return standardState(material).emissionEnabled;
}

export function setGodotStandardMaterialEmissionEnergy(
  material: MeshStandardMaterial,
  value: number,
): void {
  const state = standardState(material);
  state.emissionEnergy = scalar(value, `${state.godotClass}.emission_energy_multiplier`);
  applyEmission(material, state);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialEmissionEnergy(material: MeshStandardMaterial): number {
  return standardState(material).emissionEnergy;
}

export function setGodotStandardMaterialNormalScale(
  material: MeshStandardMaterial,
  value: number,
): void {
  const state = standardState(material);
  state.normalScale = scalar(value, `${state.godotClass}.normal_scale`);
  material.normalScale.set(state.normalScale, state.normalScale);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialNormalScale(material: MeshStandardMaterial): number {
  return standardState(material).normalScale;
}

export function setGodotStandardMaterialVertexColorUseAsAlbedo(
  material: MeshStandardMaterial,
  value: boolean,
): void {
  const state = standardState(material);
  state.vertexColorUseAsAlbedo = Boolean(value);
  material.vertexColors = state.vertexColorUseAsAlbedo;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialVertexColorUseAsAlbedo(
  material: MeshStandardMaterial,
): boolean {
  return standardState(material).vertexColorUseAsAlbedo;
}

export function setGodotStandardMaterialNoDepthTest(
  material: MeshStandardMaterial,
  value: boolean,
): void {
  const state = standardState(material);
  state.noDepthTest = Boolean(value);
  material.depthTest = !state.noDepthTest;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialNoDepthTest(material: MeshStandardMaterial): boolean {
  return standardState(material).noDepthTest;
}

export function setGodotStandardMaterialAlphaScissorEnabled(
  material: MeshStandardMaterial,
  value: boolean,
): void {
  const state = standardState(material);
  state.alphaScissorEnabled = Boolean(value);
  applyAlbedo(material, state);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialAlphaScissorEnabled(
  material: MeshStandardMaterial,
): boolean {
  return standardState(material).alphaScissorEnabled;
}

export function setGodotStandardMaterialAlphaScissorThreshold(
  material: MeshStandardMaterial,
  value: number,
): void {
  const state = standardState(material);
  const threshold = scalar(value, `${state.godotClass}.alpha_scissor_threshold`);
  if (threshold < 0 || threshold > 1) {
    throw new RangeError(`${state.godotClass}.alpha_scissor_threshold must be between 0 and 1.`);
  }
  state.alphaScissorThreshold = threshold;
  applyAlbedo(material, state);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialAlphaScissorThreshold(material: MeshStandardMaterial): number {
  return standardState(material).alphaScissorThreshold;
}

export function setGodotStandardMaterialCullMode(
  material: MeshStandardMaterial,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new RangeError(`BaseMaterial3D.cull_mode must be an integer from 0 through 2; got ${value}.`);
  }
  const state = standardState(material);
  state.cullMode = value;
  material.side = value === 0 ? FrontSide : value === 1 ? BackSide : DoubleSide;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialCullMode(material: MeshStandardMaterial): number {
  return standardState(material).cullMode;
}

export function setGodotStandardMaterialTransparency(
  material: MeshStandardMaterial,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 4) {
    throw new RangeError(
      `BaseMaterial3D.transparency must be an integer from 0 through 4; got ${value}.`,
    );
  }
  const state = standardState(material);
  const alphaScissorEnabled = value === GODOT_BASE_MATERIAL_TRANSPARENCY.ALPHA_SCISSOR;
  if (state.transparency === value && state.alphaScissorEnabled === alphaScissorEnabled) return;
  state.transparency = value;
  state.alphaScissorEnabled = alphaScissorEnabled;
  applyAlbedo(material, state);
  godotResourceEmitChanged(material);
}

export function setGodotStandardMaterialClearcoatEnabled(
  material: MeshStandardMaterial,
  value: boolean,
): void {
  const state = standardState(material);
  state.clearcoatEnabled = Boolean(value);
  physicalMaterial(material, `${state.godotClass}.clearcoat_enabled`).clearcoat =
    state.clearcoatEnabled ? state.clearcoat : 0;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialClearcoatEnabled(material: MeshStandardMaterial): boolean {
  return standardState(material).clearcoatEnabled;
}

export function setGodotStandardMaterialClearcoat(
  material: MeshStandardMaterial,
  value: number,
): void {
  const state = standardState(material);
  const amount = scalar(value, `${state.godotClass}.clearcoat`);
  if (amount < 0 || amount > 1) throw new RangeError(`${state.godotClass}.clearcoat must be 0..1.`);
  state.clearcoat = amount;
  physicalMaterial(material, `${state.godotClass}.clearcoat`).clearcoat =
    state.clearcoatEnabled ? amount : 0;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialClearcoat(material: MeshStandardMaterial): number {
  return standardState(material).clearcoat;
}

export function setGodotStandardMaterialClearcoatRoughness(
  material: MeshStandardMaterial,
  value: number,
): void {
  const state = standardState(material);
  const roughness = scalar(value, `${state.godotClass}.clearcoat_roughness`);
  if (roughness < 0 || roughness > 1) {
    throw new RangeError(`${state.godotClass}.clearcoat_roughness must be 0..1.`);
  }
  state.clearcoatRoughness = roughness;
  physicalMaterial(material, `${state.godotClass}.clearcoat_roughness`).clearcoatRoughness = roughness;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialClearcoatRoughness(
  material: MeshStandardMaterial,
): number {
  return standardState(material).clearcoatRoughness;
}

export function setGodotStandardMaterialAnisotropyEnabled(
  material: MeshStandardMaterial,
  value: boolean,
): void {
  const state = standardState(material);
  state.anisotropyEnabled = Boolean(value);
  physicalMaterial(material, `${state.godotClass}.anisotropy_enabled`).anisotropy =
    state.anisotropyEnabled ? state.anisotropy : 0;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialAnisotropyEnabled(material: MeshStandardMaterial): boolean {
  return standardState(material).anisotropyEnabled;
}

export function setGodotStandardMaterialAnisotropy(
  material: MeshStandardMaterial,
  value: number,
): void {
  const state = standardState(material);
  const amount = scalar(value, `${state.godotClass}.anisotropy`);
  if (amount < 0 || amount > 1) throw new RangeError(`${state.godotClass}.anisotropy must be 0..1.`);
  state.anisotropy = amount;
  physicalMaterial(material, `${state.godotClass}.anisotropy`).anisotropy =
    state.anisotropyEnabled ? amount : 0;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialAnisotropy(material: MeshStandardMaterial): number {
  return standardState(material).anisotropy;
}

export function setGodotStandardMaterialDepthDrawMode(
  material: MeshStandardMaterial,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new RangeError('BaseMaterial3D.depth_draw_mode must be an integer from 0 through 2.');
  }
  const state = standardState(material);
  state.depthDrawMode = value;
  applyAlbedo(material, state);
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialDepthDrawMode(material: MeshStandardMaterial): number {
  return standardState(material).depthDrawMode;
}

export function setGodotStandardMaterialDepthTest(
  material: MeshStandardMaterial,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 1) {
    throw new RangeError('BaseMaterial3D.depth_test must be DEFAULT (0) or INVERTED (1).');
  }
  const state = standardState(material);
  state.depthTest = value;
  material.depthFunc = value === GODOT_BASE_MATERIAL_DEPTH_TEST.DEFAULT
    ? LessEqualDepth
    : GreaterDepth;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialDepthTest(material: MeshStandardMaterial): number {
  return standardState(material).depthTest;
}

export function setGodotStandardMaterialDisableFog(
  material: MeshStandardMaterial,
  value: boolean,
): void {
  const state = standardState(material);
  state.disableFog = Boolean(value);
  material.fog = !state.disableFog;
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialDisableFog(material: MeshStandardMaterial): boolean {
  return standardState(material).disableFog;
}

export function setGodotStandardMaterialFeature(
  material: MeshStandardMaterial,
  feature: number,
  enabled: boolean,
): void {
  const state = standardState(material);
  switch (feature) {
    case GODOT_BASE_MATERIAL_FEATURE.EMISSION:
      setGodotStandardMaterialEmissionEnabled(material, enabled);
      return;
    case GODOT_BASE_MATERIAL_FEATURE.NORMAL_MAPPING:
      state.normalEnabled = Boolean(enabled);
      material.normalMap = state.normalEnabled
        ? (state.textures.get(GODOT_BASE_MATERIAL_TEXTURE.NORMAL) ?? null)
        : null;
      break;
    case GODOT_BASE_MATERIAL_FEATURE.CLEARCOAT:
      setGodotStandardMaterialClearcoatEnabled(material, enabled);
      return;
    case GODOT_BASE_MATERIAL_FEATURE.ANISOTROPY:
      setGodotStandardMaterialAnisotropyEnabled(material, enabled);
      return;
    case GODOT_BASE_MATERIAL_FEATURE.AMBIENT_OCCLUSION:
      state.aoEnabled = Boolean(enabled);
      material.aoMap = state.aoEnabled
        ? (state.textures.get(GODOT_BASE_MATERIAL_TEXTURE.AMBIENT_OCCLUSION) ?? null)
        : null;
      break;
    default:
      throw new Error(`BaseMaterial3D feature ${feature} has no exact native Three material owner.`);
  }
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialFeature(
  material: MeshStandardMaterial,
  feature: number,
): boolean {
  const state = standardState(material);
  if (feature === GODOT_BASE_MATERIAL_FEATURE.EMISSION) return state.emissionEnabled;
  if (feature === GODOT_BASE_MATERIAL_FEATURE.NORMAL_MAPPING) return state.normalEnabled;
  if (feature === GODOT_BASE_MATERIAL_FEATURE.CLEARCOAT) return state.clearcoatEnabled;
  if (feature === GODOT_BASE_MATERIAL_FEATURE.ANISOTROPY) return state.anisotropyEnabled;
  if (feature === GODOT_BASE_MATERIAL_FEATURE.AMBIENT_OCCLUSION) return state.aoEnabled;
  throw new Error(`BaseMaterial3D feature ${feature} has no exact native Three material owner.`);
}

export function getGodotStandardMaterialTransparency(material: MeshStandardMaterial): number {
  return standardState(material).transparency;
}

export function setGodotStandardMaterialShadingMode(
  material: MeshStandardMaterial,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new RangeError(`BaseMaterial3D.shading_mode must be an integer from 0 through 2; got ${value}.`);
  }
  if (value === GODOT_BASE_MATERIAL_SHADING_MODE.PER_VERTEX) {
    throw new Error(
      'BaseMaterial3D SHADING_MODE_PER_VERTEX has no exact native Three material equivalent.',
    );
  }
  const state = standardState(material);
  if (state.shadingMode === value) return;
  state.shadingMode = value;
  state.unshadedUniform.value = value === GODOT_BASE_MATERIAL_SHADING_MODE.UNSHADED ? 1 : 0;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialShadingMode(material: MeshStandardMaterial): number {
  return standardState(material).shadingMode;
}

export function setGodotStandardMaterialTransparent(
  material: MeshStandardMaterial,
  value: boolean,
): void {
  setGodotStandardMaterialTransparency(
    material,
    value
      ? GODOT_BASE_MATERIAL_TRANSPARENCY.ALPHA
      : GODOT_BASE_MATERIAL_TRANSPARENCY.DISABLED,
  );
}

export function getGodotStandardMaterialTransparent(material: MeshStandardMaterial): boolean {
  return standardState(material).transparency === GODOT_BASE_MATERIAL_TRANSPARENCY.ALPHA;
}

export function setGodotStandardMaterialTexture(
  material: MeshStandardMaterial,
  parameter: number,
  texture: Texture | null,
): void {
  if (texture !== null && !(texture instanceof Texture)) {
    throw new TypeError('BaseMaterial3D texture slots require a native Three Texture or null.');
  }
  const state = standardState(material);
  switch (parameter) {
    case GODOT_BASE_MATERIAL_TEXTURE.ALBEDO:
      material.map = texture;
      break;
    case GODOT_BASE_MATERIAL_TEXTURE.METALLIC:
      material.metalnessMap = texture;
      break;
    case GODOT_BASE_MATERIAL_TEXTURE.ROUGHNESS:
      material.roughnessMap = texture;
      break;
    case GODOT_BASE_MATERIAL_TEXTURE.EMISSION:
      material.emissiveMap = texture;
      break;
    case GODOT_BASE_MATERIAL_TEXTURE.NORMAL:
      material.normalMap = state.normalEnabled ? texture : null;
      break;
    case GODOT_BASE_MATERIAL_TEXTURE.CLEARCOAT:
      physicalMaterial(material, `${state.godotClass}.clearcoat_texture`).clearcoatMap = texture;
      break;
    case GODOT_BASE_MATERIAL_TEXTURE.FLOWMAP:
      physicalMaterial(material, `${state.godotClass}.anisotropy_flowmap`).anisotropyMap = texture;
      break;
    case GODOT_BASE_MATERIAL_TEXTURE.AMBIENT_OCCLUSION:
      material.aoMap = state.aoEnabled ? texture : null;
      break;
    case GODOT_BASE_MATERIAL_TEXTURE.ORM:
      material.aoMap = texture;
      material.roughnessMap = texture;
      material.metalnessMap = texture;
      break;
    default:
      throw new Error(
        `BaseMaterial3D texture parameter ${parameter} has no exact MeshStandardMaterial slot.`,
      );
  }
  if (texture === null) state.textures.delete(parameter);
  else {
    texture.repeat.set(state.uv1Scale.x, state.uv1Scale.y);
    state.textures.set(parameter, texture);
  }
  bindTextureChange(material, state, parameter, texture);
  material.needsUpdate = true;
  godotResourceEmitChanged(material);
}

export function getGodotStandardMaterialTexture(
  material: MeshStandardMaterial,
  parameter: number,
): Texture | null {
  return standardState(material).textures.get(parameter) ?? null;
}

export function duplicateGodotStandardMaterial3D(
  material: GodotStandardMaterial3D,
  deep = false,
): GodotStandardMaterial3D {
  const source = standardState(material);
  return duplicateGodotMaterial(
    material,
    cloneGodotStandardMaterial3D,
    deep,
    source.godotClass,
  );
}
