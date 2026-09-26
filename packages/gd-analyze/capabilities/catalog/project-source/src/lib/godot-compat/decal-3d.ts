import {
  BoxGeometry,
  Mesh,
  ShaderMaterial,
  Texture,
  Vector4,
  type IUniform,
} from 'three';
import { registerGodotObjectIdentity } from './object';
import type { ColorValue } from './variant';

export interface GodotDecalSize { readonly x: number; readonly y: number; readonly z: number }

export interface GodotDecal3DOptions {
  readonly size?: GodotDecalSize;
  readonly textureAlbedo?: Texture | null;
  readonly textureNormal?: Texture | null;
  readonly textureOrm?: Texture | null;
  readonly textureEmission?: Texture | null;
  readonly emissionEnergy?: number;
  readonly albedoMix?: number;
  readonly modulate?: ColorValue;
  readonly upperFade?: number;
  readonly lowerFade?: number;
  readonly normalFade?: number;
  readonly distanceFadeEnabled?: boolean;
  readonly distanceFadeBegin?: number;
  readonly distanceFadeLength?: number;
  readonly cullMask?: number;
}

interface DecalState {
  size: GodotDecalSize;
  textureAlbedo: Texture | null;
  textureNormal: Texture | null;
  textureOrm: Texture | null;
  textureEmission: Texture | null;
  emissionEnergy: number;
  albedoMix: number;
  modulate: ColorValue;
  upperFade: number;
  lowerFade: number;
  normalFade: number;
  distanceFadeEnabled: boolean;
  distanceFadeBegin: number;
  distanceFadeLength: number;
  cullMask: number;
  listeners: Set<() => void>;
}

const STATES = new WeakMap<Mesh, DecalState>();

const VERTEX_SHADER = /* glsl */`
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main() {
    vLocalPosition = position;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  uniform sampler2D albedoTexture;
  uniform sampler2D normalTexture;
  uniform sampler2D ormTexture;
  uniform sampler2D emissionTexture;
  uniform bool hasAlbedoTexture;
  uniform bool hasNormalTexture;
  uniform bool hasOrmTexture;
  uniform bool hasEmissionTexture;
  uniform vec4 modulate;
  uniform float emissionEnergy;
  uniform float albedoMix;
  uniform float upperFade;
  uniform float lowerFade;
  uniform float normalFade;
  uniform bool distanceFadeEnabled;
  uniform float distanceFadeBegin;
  uniform float distanceFadeLength;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vec3 box = vLocalPosition + vec3(0.5);
    vec2 uv = box.xz;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
    vec4 albedo = hasAlbedoTexture ? texture2D(albedoTexture, uv) : vec4(1.0);
    albedo *= modulate;
    float topFade = upperFade <= 0.00001 ? 1.0 : smoothstep(0.0, upperFade, 1.0 - box.y);
    float bottomFade = lowerFade <= 0.00001 ? 1.0 : smoothstep(0.0, lowerFade, box.y);
    float angleFade = normalFade <= 0.00001 ? 1.0 : smoothstep(normalFade, 1.0, abs(vWorldNormal.y));
    float distanceFade = 1.0;
    if (distanceFadeEnabled) {
      float cameraDistance = distance(cameraPosition, vWorldPosition);
      distanceFade = 1.0 - smoothstep(distanceFadeBegin, distanceFadeBegin + max(distanceFadeLength, 0.00001), cameraDistance);
    }
    vec3 normalColor = hasNormalTexture ? texture2D(normalTexture, uv).rgb : vec3(0.5, 0.5, 1.0);
    vec3 orm = hasOrmTexture ? texture2D(ormTexture, uv).rgb : vec3(1.0, 1.0, 0.0);
    vec3 emission = hasEmissionTexture ? texture2D(emissionTexture, uv).rgb * emissionEnergy : vec3(0.0);
    vec3 base = mix(vec3(1.0), albedo.rgb, albedoMix);
    base *= mix(vec3(1.0), normalColor * 2.0, 0.08);
    base *= mix(1.0, orm.r, 0.08);
    float alpha = albedo.a * topFade * bottomFade * angleFade * distanceFade;
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(base + emission, alpha);
  }
`;

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`godot-compat: Decal.${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function size(value: unknown): GodotDecalSize {
  if (typeof value !== 'object' || value === null || !('x' in value) || !('y' in value) || !('z' in value)) {
    throw new TypeError('godot-compat: Decal.size requires Vector3.');
  }
  return Object.freeze({
    x: finite(value.x, 'size.x', Number.MIN_VALUE),
    y: finite(value.y, 'size.y', Number.MIN_VALUE),
    z: finite(value.z, 'size.z', Number.MIN_VALUE),
  });
}

function color(value: unknown): ColorValue {
  if (typeof value !== 'object' || value === null || !('r' in value) || !('g' in value) || !('b' in value)) {
    throw new TypeError('godot-compat: Decal.modulate requires Color.');
  }
  return Object.freeze({
    r: finite(value.r, 'modulate.r'), g: finite(value.g, 'modulate.g'), b: finite(value.b, 'modulate.b'),
    a: finite('a' in value ? value.a : 1, 'modulate.a'),
  });
}

function texture(value: unknown, member: string): Texture | null {
  if (value === null) return null;
  if (!(value instanceof Texture)) throw new TypeError(`godot-compat: Decal.${member} requires Texture2D or null.`);
  return value;
}

function stateOf(decal: Mesh): DecalState {
  const state = STATES.get(decal);
  if (state === undefined) throw new TypeError('godot-compat: Decal member requires a retained Decal Mesh.');
  return state;
}

function materialOf(decal: Mesh): ShaderMaterial {
  if (!(decal.material instanceof ShaderMaterial)) throw new TypeError('godot-compat: Decal lost its native ShaderMaterial.');
  return decal.material;
}

function uniform(material: ShaderMaterial, name: string): IUniform {
  const value = material.uniforms[name];
  if (value === undefined) {
    throw new TypeError(`godot-compat: Decal native ShaderMaterial lost its ${name} uniform.`);
  }
  return value;
}

function changed(decal: Mesh): void {
  decal.layers.mask = stateOf(decal).cullMask;
  for (const listener of stateOf(decal).listeners) listener();
}

function syncGeometry(decal: Mesh): void {
  const state = stateOf(decal);
  const replacement = new BoxGeometry(state.size.x, state.size.y, state.size.z);
  decal.geometry.dispose();
  decal.geometry = replacement;
  changed(decal);
}

function syncUniforms(decal: Mesh): void {
  const state = stateOf(decal);
  const material = materialOf(decal);
  uniform(material, 'albedoTexture').value = state.textureAlbedo;
  uniform(material, 'normalTexture').value = state.textureNormal;
  uniform(material, 'ormTexture').value = state.textureOrm;
  uniform(material, 'emissionTexture').value = state.textureEmission;
  uniform(material, 'hasAlbedoTexture').value = state.textureAlbedo !== null;
  uniform(material, 'hasNormalTexture').value = state.textureNormal !== null;
  uniform(material, 'hasOrmTexture').value = state.textureOrm !== null;
  uniform(material, 'hasEmissionTexture').value = state.textureEmission !== null;
  const modulate = uniform(material, 'modulate').value;
  if (!(modulate instanceof Vector4)) {
    throw new TypeError('godot-compat: Decal native ShaderMaterial lost its Vector4 modulate uniform.');
  }
  modulate.set(state.modulate.r, state.modulate.g, state.modulate.b, state.modulate.a);
  uniform(material, 'emissionEnergy').value = state.emissionEnergy;
  uniform(material, 'albedoMix').value = state.albedoMix;
  uniform(material, 'upperFade').value = state.upperFade;
  uniform(material, 'lowerFade').value = state.lowerFade;
  uniform(material, 'normalFade').value = state.normalFade;
  uniform(material, 'distanceFadeEnabled').value = state.distanceFadeEnabled;
  uniform(material, 'distanceFadeBegin').value = state.distanceFadeBegin;
  uniform(material, 'distanceFadeLength').value = state.distanceFadeLength;
  changed(decal);
}

export function createGodotDecal3D(options: GodotDecal3DOptions = {}): Mesh {
  const material = new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    uniforms: {
      albedoTexture: { value: null }, normalTexture: { value: null }, ormTexture: { value: null }, emissionTexture: { value: null },
      hasAlbedoTexture: { value: false }, hasNormalTexture: { value: false }, hasOrmTexture: { value: false }, hasEmissionTexture: { value: false },
      modulate: { value: new Vector4(1, 1, 1, 1) },
      emissionEnergy: { value: 1 }, albedoMix: { value: 1 }, upperFade: { value: 0.3 }, lowerFade: { value: 0.3 }, normalFade: { value: 0 },
      distanceFadeEnabled: { value: false }, distanceFadeBegin: { value: 40 }, distanceFadeLength: { value: 10 },
    },
  });
  const decal = new Mesh(new BoxGeometry(2, 2, 2), material);
  const state: DecalState = {
    size: size(options.size ?? { x: 2, y: 2, z: 2 }),
    textureAlbedo: texture(options.textureAlbedo ?? null, 'texture_albedo'),
    textureNormal: texture(options.textureNormal ?? null, 'texture_normal'),
    textureOrm: texture(options.textureOrm ?? null, 'texture_orm'),
    textureEmission: texture(options.textureEmission ?? null, 'texture_emission'),
    emissionEnergy: finite(options.emissionEnergy ?? 1, 'emission_energy', 0), albedoMix: finite(options.albedoMix ?? 1, 'albedo_mix', 0, 1),
    modulate: color(options.modulate ?? { r: 1, g: 1, b: 1, a: 1 }), upperFade: finite(options.upperFade ?? 0.3, 'upper_fade', 0, 1),
    lowerFade: finite(options.lowerFade ?? 0.3, 'lower_fade', 0, 1), normalFade: finite(options.normalFade ?? 0, 'normal_fade', 0, 1),
    distanceFadeEnabled: options.distanceFadeEnabled ?? false, distanceFadeBegin: finite(options.distanceFadeBegin ?? 40, 'distance_fade_begin', 0),
    distanceFadeLength: finite(options.distanceFadeLength ?? 10, 'distance_fade_length', 0), cullMask: options.cullMask ?? 0x000f_ffff,
    listeners: new Set(),
  };
  STATES.set(decal, state); registerGodotObjectIdentity(decal, 'Decal'); syncGeometry(decal); syncUniforms(decal);
  return decal;
}

export function getGodotDecalSize(decal: Mesh): GodotDecalSize { return { ...stateOf(decal).size }; }
export function setGodotDecalSize(decal: Mesh, value: unknown): void { stateOf(decal).size = size(value); syncGeometry(decal); }
export function getGodotDecalTextureAlbedo(decal: Mesh): Texture | null { return stateOf(decal).textureAlbedo; }
export function setGodotDecalTextureAlbedo(decal: Mesh, value: unknown): void { stateOf(decal).textureAlbedo = texture(value, 'texture_albedo'); syncUniforms(decal); }
export function getGodotDecalTextureNormal(decal: Mesh): Texture | null { return stateOf(decal).textureNormal; }
export function setGodotDecalTextureNormal(decal: Mesh, value: unknown): void { stateOf(decal).textureNormal = texture(value, 'texture_normal'); syncUniforms(decal); }
export function getGodotDecalTextureOrm(decal: Mesh): Texture | null { return stateOf(decal).textureOrm; }
export function setGodotDecalTextureOrm(decal: Mesh, value: unknown): void { stateOf(decal).textureOrm = texture(value, 'texture_orm'); syncUniforms(decal); }
export function getGodotDecalTextureEmission(decal: Mesh): Texture | null { return stateOf(decal).textureEmission; }
export function setGodotDecalTextureEmission(decal: Mesh, value: unknown): void { stateOf(decal).textureEmission = texture(value, 'texture_emission'); syncUniforms(decal); }
export function getGodotDecalEmissionEnergy(decal: Mesh): number { return stateOf(decal).emissionEnergy; }
export function setGodotDecalEmissionEnergy(decal: Mesh, value: unknown): void { stateOf(decal).emissionEnergy = finite(value, 'emission_energy', 0); syncUniforms(decal); }
export function getGodotDecalAlbedoMix(decal: Mesh): number { return stateOf(decal).albedoMix; }
export function setGodotDecalAlbedoMix(decal: Mesh, value: unknown): void { stateOf(decal).albedoMix = finite(value, 'albedo_mix', 0, 1); syncUniforms(decal); }
export function getGodotDecalModulate(decal: Mesh): ColorValue { return { ...stateOf(decal).modulate }; }
export function setGodotDecalModulate(decal: Mesh, value: unknown): void { stateOf(decal).modulate = color(value); syncUniforms(decal); }
export function getGodotDecalUpperFade(decal: Mesh): number { return stateOf(decal).upperFade; }
export function setGodotDecalUpperFade(decal: Mesh, value: unknown): void { stateOf(decal).upperFade = finite(value, 'upper_fade', 0, 1); syncUniforms(decal); }
export function getGodotDecalLowerFade(decal: Mesh): number { return stateOf(decal).lowerFade; }
export function setGodotDecalLowerFade(decal: Mesh, value: unknown): void { stateOf(decal).lowerFade = finite(value, 'lower_fade', 0, 1); syncUniforms(decal); }
export function getGodotDecalNormalFade(decal: Mesh): number { return stateOf(decal).normalFade; }
export function setGodotDecalNormalFade(decal: Mesh, value: unknown): void { stateOf(decal).normalFade = finite(value, 'normal_fade', 0, 1); syncUniforms(decal); }
export function isGodotDecalDistanceFadeEnabled(decal: Mesh): boolean { return stateOf(decal).distanceFadeEnabled; }
export function setGodotDecalDistanceFadeEnabled(decal: Mesh, value: unknown): void { if (typeof value !== 'boolean') throw new TypeError('Decal.distance_fade_enabled requires bool.'); stateOf(decal).distanceFadeEnabled = value; syncUniforms(decal); }
export function getGodotDecalDistanceFadeBegin(decal: Mesh): number { return stateOf(decal).distanceFadeBegin; }
export function setGodotDecalDistanceFadeBegin(decal: Mesh, value: unknown): void { stateOf(decal).distanceFadeBegin = finite(value, 'distance_fade_begin', 0); syncUniforms(decal); }
export function getGodotDecalDistanceFadeLength(decal: Mesh): number { return stateOf(decal).distanceFadeLength; }
export function setGodotDecalDistanceFadeLength(decal: Mesh, value: unknown): void { stateOf(decal).distanceFadeLength = finite(value, 'distance_fade_length', 0); syncUniforms(decal); }
export function getGodotDecalCullMask(decal: Mesh): number { return stateOf(decal).cullMask; }
export function setGodotDecalCullMask(decal: Mesh, value: unknown): void { stateOf(decal).cullMask = Math.trunc(finite(value, 'cull_mask', 0, 0xffff_ffff)); changed(decal); }
export function watchGodotDecal3D(decal: Mesh, listener: () => void): () => void { stateOf(decal).listeners.add(listener); return () => stateOf(decal).listeners.delete(listener); }
export function disposeGodotDecal3D(decal: Mesh): void { decal.removeFromParent(); decal.geometry.dispose(); materialOf(decal).dispose(); STATES.delete(decal); }
