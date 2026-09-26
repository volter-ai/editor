/**
 * Godot 4 FogMaterial/FogVolume over a retained native Three volume mesh.
 *
 * Godot's clustered renderer injects FogMaterial density into a froxel volume. WebGL/Three has no
 * froxel owner, so the binding keeps the same source resource and volume node but renders the
 * Beer-Lambert integral directly on the volume's back faces. This is still one native renderer
 * object: scripts mutate the ShaderMaterial uniforms that draw the fog, and changing shape rebuilds
 * the volume geometry consumed by that material.
 *
 * The density kernel is transcribed from Godot 4.7's FogMaterial defaults and
 * `servers/rendering/renderer_rd/shaders/environment/volumetric_fog_process.glsl`: density is
 * nonnegative, albedo and emission are linear colors, height falloff is exponential in local Y,
 * and edge fade attenuates density by distance to the primitive boundary. DensityTexture is sampled
 * in normalized local volume coordinates when the retained texture has a native Three Texture.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Texture,
} from 'three';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceChangedSignal,
  godotResourceEmitChanged,
} from './resource-io';
import type { ColorValue } from './variant';
import type { Vector3 as GodotVector3 } from './variant-3d';

export const GODOT_FOG_VOLUME_SHAPE = Object.freeze({
  ELLIPSOID: 0,
  CONE: 1,
  CYLINDER: 2,
  BOX: 3,
  WORLD: 4,
  MAX: 5,
  SHAPE_ELLIPSOID: 0,
  SHAPE_CONE: 1,
  SHAPE_CYLINDER: 2,
  SHAPE_BOX: 3,
  SHAPE_WORLD: 4,
  SHAPE_MAX: 5,
} as const);

export type GodotFogVolumeShape = 0 | 1 | 2 | 3 | 4;

export interface GodotFogDensityTexture {
  readonly three?: Texture;
}

export interface GodotFogMaterialState {
  readonly density: number;
  readonly albedo: ColorValue;
  readonly emission: ColorValue;
  readonly heightFalloff: number;
  readonly edgeFade: number;
  readonly densityTexture: GodotFogDensityTexture | null;
}

export interface GodotFogVolumeOptions {
  readonly size?: GodotVector3;
  readonly shape?: GodotFogVolumeShape;
  readonly material?: GodotFogMaterial | null;
}

const WHITE: ColorValue = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
const BLACK: ColorValue = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`FogMaterial.${member} requires a finite number.`);
  }
  return value;
}

function nonnegative(value: unknown, member: string): number {
  const next = finite(value, member);
  if (next < 0) throw new RangeError(`FogMaterial.${member} cannot be negative.`);
  return next;
}

function color(value: unknown, member: string): ColorValue {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`FogMaterial.${member} requires Color.`);
  }
  const candidate = value as Partial<ColorValue>;
  const r = finite(candidate.r, member);
  const g = finite(candidate.g, member);
  const b = finite(candidate.b, member);
  const a = candidate.a === undefined ? 1 : finite(candidate.a, member);
  return { r, g, b, a };
}

function sameColor(a: ColorValue, b: ColorValue): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

function textureOf(value: GodotFogDensityTexture | null): Texture | null {
  if (value === null) return null;
  const native = value.three;
  if (native === undefined || !native.isTexture) {
    throw new TypeError('FogMaterial.density_texture requires a retained native Three Texture or null.');
  }
  return native;
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 godotFogLocalPosition;
varying vec3 godotFogWorldPosition;
varying vec3 godotFogCameraLocal;

void main() {
  godotFogLocalPosition = position;
  godotFogWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  godotFogCameraLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform float godotFogDensity;
uniform vec4 godotFogAlbedo;
uniform vec4 godotFogEmission;
uniform float godotFogHeightFalloff;
uniform float godotFogEdgeFade;
uniform int godotFogShape;
uniform bool godotFogHasDensityTexture;
uniform sampler3D godotFogDensityTexture;
uniform vec3 godotFogVolumeSize;

varying vec3 godotFogLocalPosition;
varying vec3 godotFogWorldPosition;
varying vec3 godotFogCameraLocal;

float godotFogBoxDistance(vec3 p) {
  vec3 q = abs(p) - vec3(0.5);
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float godotFogEllipsoidDistance(vec3 p) {
  return length(p * 2.0) - 1.0;
}

float godotFogCylinderDistance(vec3 p) {
  vec2 d = abs(vec2(length(p.xz) * 2.0, p.y * 2.0)) - vec2(1.0);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float godotFogConeDistance(vec3 p) {
  float y = p.y + 0.5;
  float radius = max(0.0, 1.0 - y);
  float side = length(p.xz) * 2.0 - radius;
  return max(side, max(-y, y - 1.0));
}

float godotFogBoundary(vec3 p) {
  if (godotFogShape == 0) return godotFogEllipsoidDistance(p);
  if (godotFogShape == 1) return godotFogConeDistance(p);
  if (godotFogShape == 2) return godotFogCylinderDistance(p);
  return godotFogBoxDistance(p);
}

vec2 godotFogBoxIntersection(vec3 origin, vec3 direction) {
  vec3 inverseDirection = 1.0 / direction;
  vec3 lo = (-vec3(0.5) - origin) * inverseDirection;
  vec3 hi = ( vec3(0.5) - origin) * inverseDirection;
  vec3 nearPoint = min(lo, hi);
  vec3 farPoint = max(lo, hi);
  return vec2(max(nearPoint.x, max(nearPoint.y, nearPoint.z)),
              min(farPoint.x, min(farPoint.y, farPoint.z)));
}

float godotFogShapeMask(vec3 p) {
  float distance = godotFogBoundary(p);
  if (distance > 0.0) return 0.0;
  if (godotFogEdgeFade <= 0.0) return 1.0;
  return clamp(-distance / max(godotFogEdgeFade, 0.000001), 0.0, 1.0);
}

void main() {
  vec3 direction = normalize(godotFogLocalPosition - godotFogCameraLocal);
  vec2 segment = godotFogBoxIntersection(godotFogCameraLocal, direction);
  float nearDistance = max(segment.x, 0.0);
  float farDistance = segment.y;
  if (farDistance <= nearDistance) discard;

  const int STEP_COUNT = 32;
  float stepLength = (farDistance - nearDistance) / float(STEP_COUNT);
  float opticalDepth = 0.0;
  vec3 emissionIntegral = vec3(0.0);
  vec3 samplePoint = godotFogCameraLocal + direction * (nearDistance + stepLength * 0.5);

  for (int index = 0; index < STEP_COUNT; index++) {
    float mask = godotFogShapeMask(samplePoint);
    vec3 uvw = samplePoint + vec3(0.5);
    float textureDensity = godotFogHasDensityTexture
      ? texture(godotFogDensityTexture, clamp(uvw, 0.0, 1.0)).r
      : 1.0;
    float heightDensity = exp(-max(samplePoint.y, 0.0) * godotFogHeightFalloff);
    float sampleDensity = max(godotFogDensity * textureDensity * heightDensity * mask, 0.0);
    opticalDepth += sampleDensity * stepLength * length(godotFogVolumeSize);
    emissionIntegral += godotFogEmission.rgb * sampleDensity * stepLength;
    samplePoint += direction * stepLength;
  }

  float alpha = (1.0 - exp(-opticalDepth)) * godotFogAlbedo.a;
  vec3 scattering = godotFogAlbedo.rgb * alpha;
  gl_FragColor = vec4(scattering + emissionIntegral * godotFogEmission.a, alpha);
}
`;

export class GodotFogMaterial {
  private densityValue = 1;
  private albedoValue: ColorValue = { ...WHITE };
  private emissionValue: ColorValue = { ...BLACK };
  private heightFalloffValue = 0;
  private edgeFadeValue = 0.1;
  private densityTextureValue: GodotFogDensityTexture | null = null;

  public constructor(initial: Partial<GodotFogMaterialState> = {}) {
    registerGodotObjectIdentity(this, 'FogMaterial');
    bindGodotResourceProtocol<GodotFogMaterial>(this, {
      createDuplicate: (source, deep, memo) => new GodotFogMaterial({
        ...source.state(),
        densityTexture: deep && source.densityTextureValue !== null
          ? duplicateGodotSubresource(source.densityTextureValue, memo)
          : source.densityTextureValue,
      }),
    });
    if (initial.density !== undefined) this.densityValue = nonnegative(initial.density, 'density');
    if (initial.albedo !== undefined) this.albedoValue = color(initial.albedo, 'albedo');
    if (initial.emission !== undefined) this.emissionValue = color(initial.emission, 'emission');
    if (initial.heightFalloff !== undefined) {
      this.heightFalloffValue = nonnegative(initial.heightFalloff, 'height_falloff');
    }
    if (initial.edgeFade !== undefined) this.edgeFadeValue = nonnegative(initial.edgeFade, 'edge_fade');
    if (initial.densityTexture !== undefined) {
      textureOf(initial.densityTexture);
      this.densityTextureValue = initial.densityTexture;
    }
  }

  public get density(): number { return this.getDensity(); }
  public set density(value: number) { this.setDensity(value); }
  public get albedo(): ColorValue { return this.getAlbedo(); }
  public set albedo(value: ColorValue) { this.setAlbedo(value); }
  public get emission(): ColorValue { return this.getEmission(); }
  public set emission(value: ColorValue) { this.setEmission(value); }
  public get height_falloff(): number { return this.getHeightFalloff(); }
  public set height_falloff(value: number) { this.setHeightFalloff(value); }
  public get edge_fade(): number { return this.getEdgeFade(); }
  public set edge_fade(value: number) { this.setEdgeFade(value); }
  public get density_texture(): GodotFogDensityTexture | null { return this.getDensityTexture(); }
  public set density_texture(value: GodotFogDensityTexture | null) { this.setDensityTexture(value); }

  public setDensity(value: number): void {
    value = nonnegative(value, 'density');
    if (value === this.densityValue) return;
    this.densityValue = value;
    godotResourceEmitChanged(this);
  }
  public getDensity(): number { return this.densityValue; }

  public setAlbedo(value: ColorValue): void {
    const next = color(value, 'albedo');
    if (sameColor(next, this.albedoValue)) return;
    this.albedoValue = next;
    godotResourceEmitChanged(this);
  }
  public getAlbedo(): ColorValue { return { ...this.albedoValue }; }

  public setEmission(value: ColorValue): void {
    const next = color(value, 'emission');
    if (sameColor(next, this.emissionValue)) return;
    this.emissionValue = next;
    godotResourceEmitChanged(this);
  }
  public getEmission(): ColorValue { return { ...this.emissionValue }; }

  public setHeightFalloff(value: number): void {
    value = nonnegative(value, 'height_falloff');
    if (value === this.heightFalloffValue) return;
    this.heightFalloffValue = value;
    godotResourceEmitChanged(this);
  }
  public getHeightFalloff(): number { return this.heightFalloffValue; }

  public setEdgeFade(value: number): void {
    value = nonnegative(value, 'edge_fade');
    if (value === this.edgeFadeValue) return;
    this.edgeFadeValue = value;
    godotResourceEmitChanged(this);
  }
  public getEdgeFade(): number { return this.edgeFadeValue; }

  public setDensityTexture(value: GodotFogDensityTexture | null): void {
    textureOf(value);
    if (value === this.densityTextureValue) return;
    this.densityTextureValue = value;
    godotResourceEmitChanged(this);
  }
  public getDensityTexture(): GodotFogDensityTexture | null { return this.densityTextureValue; }

  public state(): GodotFogMaterialState {
    return {
      density: this.densityValue,
      albedo: this.getAlbedo(),
      emission: this.getEmission(),
      heightFalloff: this.heightFalloffValue,
      edgeFade: this.edgeFadeValue,
      densityTexture: this.densityTextureValue,
    };
  }
}

function volumeSize(value: GodotVector3): GodotVector3 {
  const x = finite(value?.x, 'size');
  const y = finite(value?.y, 'size');
  const z = finite(value?.z, 'size');
  if (x <= 0 || y <= 0 || z <= 0) {
    throw new RangeError('FogVolume.size requires three positive finite components.');
  }
  return { x, y, z };
}

function volumeShape(value: number): GodotFogVolumeShape {
  if (!Number.isInteger(value) || value < 0 || value >= GODOT_FOG_VOLUME_SHAPE.MAX) {
    throw new RangeError(`FogVolume.shape has unknown value ${String(value)}.`);
  }
  return value as GodotFogVolumeShape;
}

function geometryFor(shape: GodotFogVolumeShape): BufferGeometry {
  if (shape === GODOT_FOG_VOLUME_SHAPE.ELLIPSOID) return new IcosahedronGeometry(0.5, 4);
  if (shape === GODOT_FOG_VOLUME_SHAPE.CONE) return new ConeGeometry(0.5, 1, 48, 1, false);
  if (shape === GODOT_FOG_VOLUME_SHAPE.CYLINDER) return new CylinderGeometry(0.5, 0.5, 1, 48, 1, false);
  return new BoxGeometry(1, 1, 1);
}

function shaderFor(material: GodotFogMaterial, shape: GodotFogVolumeShape, size: GodotVector3): ShaderMaterial {
  const state = material.state();
  const densityTexture = textureOf(state.densityTexture);
  return new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: BackSide,
    blending: state.albedo.a < 1 ? NormalBlending : AdditiveBlending,
    uniforms: {
      godotFogDensity: { value: state.density },
      godotFogAlbedo: { value: new Color(state.albedo.r, state.albedo.g, state.albedo.b) },
      godotFogEmission: { value: new Color(state.emission.r, state.emission.g, state.emission.b) },
      godotFogHeightFalloff: { value: state.heightFalloff },
      godotFogEdgeFade: { value: state.edgeFade },
      godotFogShape: { value: shape },
      godotFogHasDensityTexture: { value: densityTexture !== null },
      godotFogDensityTexture: { value: densityTexture },
      godotFogVolumeSize: { value: new Vector3(size.x, size.y, size.z) },
    },
  });
}

export class GodotFogVolume extends Mesh<BufferGeometry, ShaderMaterial> {
  private sizeValue: GodotVector3;
  private shapeValue: GodotFogVolumeShape;
  private materialValue: GodotFogMaterial;
  private releaseMaterial: (() => void) | null = null;

  public constructor(options: GodotFogVolumeOptions = {}) {
    const shape = volumeShape(options.shape ?? GODOT_FOG_VOLUME_SHAPE.BOX);
    const size = volumeSize(options.size ?? { x: 2, y: 2, z: 2 });
    const material = options.material ?? new GodotFogMaterial();
    super(geometryFor(shape), shaderFor(material, shape, size));
    this.sizeValue = size;
    this.shapeValue = shape;
    this.materialValue = material;
    this.name = 'FogVolume';
    this.frustumCulled = shape !== GODOT_FOG_VOLUME_SHAPE.WORLD;
    this.renderOrder = 1000;
    this.scale.set(size.x, size.y, size.z);
    registerGodotObjectIdentity(this, 'FogVolume');
    this.watchMaterial();
  }

  public get size(): GodotVector3 { return this.getSize(); }
  public set size(value: GodotVector3) { this.setSize(value); }
  public get shape(): GodotFogVolumeShape { return this.getShape(); }
  public set shape(value: GodotFogVolumeShape) { this.setShape(value); }
  public get fog_material(): GodotFogMaterial { return this.getFogMaterial(); }
  public set fog_material(value: GodotFogMaterial) { this.setFogMaterial(value); }

  public setSize(value: GodotVector3): void {
    const next = volumeSize(value);
    if (next.x === this.sizeValue.x && next.y === this.sizeValue.y && next.z === this.sizeValue.z) return;
    this.sizeValue = next;
    this.scale.set(next.x, next.y, next.z);
    this.material.uniforms['godotFogVolumeSize']!.value.set(next.x, next.y, next.z);
  }
  public getSize(): GodotVector3 { return { ...this.sizeValue }; }

  public setShape(value: number): void {
    const next = volumeShape(value);
    if (next === this.shapeValue) return;
    const previous = this.geometry;
    this.geometry = geometryFor(next);
    this.shapeValue = next;
    this.frustumCulled = next !== GODOT_FOG_VOLUME_SHAPE.WORLD;
    this.material.uniforms['godotFogShape']!.value = next;
    previous.dispose();
  }
  public getShape(): GodotFogVolumeShape { return this.shapeValue; }

  public setFogMaterial(value: GodotFogMaterial | null): void {
    const next = value ?? new GodotFogMaterial();
    if (!(next instanceof GodotFogMaterial)) {
      throw new TypeError('FogVolume.material requires FogMaterial or null.');
    }
    if (next === this.materialValue) return;
    this.releaseMaterial?.();
    this.materialValue = next;
    this.watchMaterial();
    this.syncMaterial();
  }
  public getFogMaterial(): GodotFogMaterial { return this.materialValue; }

  public disposeFogVolume(): void {
    this.releaseMaterial?.();
    this.releaseMaterial = null;
    this.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }

  private watchMaterial(): void {
    const connection = godotResourceChangedSignal(this.materialValue).connect(() => this.syncMaterial());
    this.releaseMaterial = () => connection.disconnect();
  }

  private syncMaterial(): void {
    const state = this.materialValue.state();
    const uniforms = this.material.uniforms;
    uniforms['godotFogDensity']!.value = state.density;
    uniforms['godotFogAlbedo']!.value.setRGB(state.albedo.r, state.albedo.g, state.albedo.b);
    uniforms['godotFogEmission']!.value.setRGB(state.emission.r, state.emission.g, state.emission.b);
    uniforms['godotFogHeightFalloff']!.value = state.heightFalloff;
    uniforms['godotFogEdgeFade']!.value = state.edgeFade;
    const densityTexture = textureOf(state.densityTexture);
    uniforms['godotFogHasDensityTexture']!.value = densityTexture !== null;
    uniforms['godotFogDensityTexture']!.value = densityTexture;
    this.material.blending = state.albedo.a < 1 ? NormalBlending : AdditiveBlending;
    this.material.uniformsNeedUpdate = true;
  }
}

export function createGodotFogMaterial(
  initial: Partial<GodotFogMaterialState> = {},
): GodotFogMaterial {
  return new GodotFogMaterial(initial);
}

export function createGodotFogVolume(options: GodotFogVolumeOptions = {}): GodotFogVolume {
  return new GodotFogVolume(options);
}
