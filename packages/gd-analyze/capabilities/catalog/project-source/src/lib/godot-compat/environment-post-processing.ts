/**
 * Godot's shared tone mapping + glow postprocessing runtime for translated three worlds.
 *
 * The translator supplies only the Environment values the project authored. This module owns the
 * executable renderer chain, shader source, render targets and lifecycle once for every port.
 * Godot 3.6 and 4.7 use the same Filmic equation, while Godot 4.7's AgX path uses its exact
 * AllenWP curve and gamut matrices. The config selects the source engine's operator by identity.
 */
import {
  Color,
  HalfFloatType,
  Matrix4,
  ShaderMaterial,
  Vector3,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { type EffectComposer, Pass, RenderPass, ShaderPass } from 'postprocessing';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import {
  getLightEnergy,
  getSkyMode,
  SKY_MODE_LIGHT_AND_SKY,
  SKY_MODE_LIGHT_ONLY,
  SKY_MODE_SKY_ONLY,
} from './light-3d';
import {
  GodotDepthOfFieldPass,
  type GodotDepthOfFieldConfig,
} from './depth-of-field';
import {
  GodotAmbientOcclusionPass,
  type GodotAmbientOcclusionConfig,
} from './ambient-occlusion';
import {
  GodotAutoExposurePass,
  type GodotAutoExposureConfig,
} from './auto-exposure';
import {
  bindEnvironmentDepthOfFieldRuntime,
  bindEnvironmentAdjustmentRuntime,
  bindEnvironmentFogRuntime,
  bindEnvironmentGlowRuntime,
  bindEnvironmentSsaoRuntime,
  type GodotEnvironmentFogRuntime,
  type GodotEnvironmentGlowRuntime,
  type GodotEnvironmentAdjustmentRuntime,
} from './world-environment-3d';

class GodotAdjustmentUniformRuntime implements GodotEnvironmentAdjustmentRuntime {
  private enabled = true;
  private brightness: number;
  private contrast: number;
  private saturation: number;

  constructor(
    private readonly material: ShaderMaterial,
    initial: GodotColorAdjustments,
  ) {
    this.brightness = initial.brightness;
    this.contrast = initial.contrast;
    this.saturation = initial.saturation;
    this.apply();
  }

  isAdjustmentEnabled(): boolean { return this.enabled; }
  setAdjustmentEnabled(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('Environment.adjustment_enabled requires bool.');
    if (value === this.enabled) return;
    this.enabled = value;
    this.apply();
  }
  getAdjustmentBrightness(): number { return this.brightness; }
  setAdjustmentBrightness(value: number): void {
    this.brightness = this.scalar(value, 'adjustment_brightness');
    this.apply();
  }
  getAdjustmentContrast(): number { return this.contrast; }
  setAdjustmentContrast(value: number): void {
    this.contrast = this.scalar(value, 'adjustment_contrast');
    this.apply();
  }
  getAdjustmentSaturation(): number { return this.saturation; }
  setAdjustmentSaturation(value: number): void {
    this.saturation = this.scalar(value, 'adjustment_saturation');
    this.apply();
  }
  private scalar(value: number, member: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Environment.${member} requires a finite nonnegative float.`);
    }
    return value;
  }
  private apply(): void {
    this.material.uniforms['brightness']!.value = this.enabled ? this.brightness : 1;
    this.material.uniforms['contrast']!.value = this.enabled ? this.contrast : 1;
    this.material.uniforms['saturation']!.value = this.enabled ? this.saturation : 1;
    this.material.uniformsNeedUpdate = true;
  }
}

export interface GodotColorAdjustments {
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
}

export interface GodotGlowConfig {
  readonly dialect: 'godot-3' | 'godot-4';
  readonly enabled: boolean;
  readonly levels: readonly number[];
  readonly sourceLevels: readonly number[];
  readonly normalized: boolean;
  readonly levelCount: number;
  readonly intensity: number;
  readonly strength: number;
  readonly bloom: number;
  readonly hdrThreshold: number;
  readonly hdrScale: number;
  readonly luminanceCap: number;
  readonly mix: number;
  /** 0 ADDITIVE, 1 SCREEN, 3 REPLACE, 4 MIX. */
  readonly blendMode: number;
  /** Godot 3's per-Environment upscale selection. Godot 4 owns this as a project setting. */
  readonly bicubicUpscale?: boolean;
  readonly highQuality?: boolean;
}

/** Godot 4.7's non-volumetric Environment fog inputs. */
export type GodotFogConfig =
  | {
      readonly dialect: "godot-4";
      /** 0 EXPONENTIAL, 1 DEPTH. */
      readonly mode: 0 | 1;
      readonly lightColor: string;
      readonly lightEnergy: number;
      readonly sunScatter: number;
      readonly density: number;
      readonly height: number;
      readonly heightDensity: number;
      readonly aerialPerspective: number;
      readonly depthCurve: number;
      readonly depthBegin: number;
      readonly depthEnd: number;
      readonly skyAffect: number;
    }
  | {
      readonly dialect: "godot-3";
      readonly color: string;
      /** Godot 3 stores the fixed-fog density in `fog_color.a`. */
      readonly density: number;
      readonly sunColor: string;
      readonly sunAmount: number;
      readonly depthEnabled: boolean;
      readonly depthBegin: number;
      readonly depthEnd: number;
      readonly depthCurve: number;
      readonly transmitEnabled: boolean;
      readonly transmitCurve: number;
      readonly heightEnabled: boolean;
      readonly heightMin: number;
      readonly heightMax: number;
      readonly heightCurve: number;
    };

export interface GodotPostEffectBase {
  readonly exposure: number;
  readonly white: number;
  readonly adjustments?: GodotColorAdjustments;
  readonly glow?: GodotGlowConfig;
  readonly fog?: GodotFogConfig;
  readonly depthOfField?: GodotDepthOfFieldConfig;
  readonly ambientOcclusion?: GodotAmbientOcclusionConfig;
  readonly autoExposure?: GodotAutoExposureConfig;
}

/** The project-authored values consumed by Godot's exact postprocess implementation. */
export type GodotPostEffectConfig =
  | (GodotPostEffectBase & {
      /** Exact output conversion, used when fog is active without a carried tone curve. */
      readonly kind: "godot-output";
    })
  | (GodotPostEffectBase & {
      readonly kind: "godot-filmic";
    })
  | (GodotPostEffectBase & {
      readonly kind: "godot-agx";
      /** `Environment.tonemap_agx_contrast`; defaults are resolved by the translator. */
      readonly contrast: number;
    });

const GODOT_FILMIC_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const GODOT_OUTPUT_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D autoExposureTexture;
uniform float autoExposureEnabled;
uniform float autoExposureScale;
uniform float exposure;
varying vec2 vUv;
void main() {
  float adaptedExposure = autoExposureEnabled > 0.5
    ? exposure / (texture2D(autoExposureTexture, vec2(0.5)).r / autoExposureScale)
    : exposure;
  vec4 source = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(source.rgb * adaptedExposure, source.a);
  #include <colorspace_fragment>
}
`;

/**
 * Godot 4.7's fixed fog from `scene_forward_clustered.glsl::fog_process` and `sky.glsl`.
 * This is a depth-buffer post pass, never a Three Fog/FogExp2 approximation.
 */
const GODOT_FOG_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform mat4 inverseProjectionMatrix;
uniform mat4 inverseViewMatrix;
uniform int fogDialect;
uniform vec3 fogLightColor;
uniform float fogDensity;
uniform float fogHeight;
uniform float fogHeightDensity;
uniform float fogDepthCurve;
uniform float fogDepthBegin;
uniform float fogDepthEnd;
uniform float fogSkyAffect;
uniform float fogAerialPerspective;
uniform float fogSunScatter;
uniform float cameraFar;
uniform int fogMode;
uniform int directionalLightCount;
uniform vec3 directionalLightColors[8];
uniform vec3 directionalLightDirections[8];
uniform int skyDirectionalLightCount;
uniform vec3 skyDirectionalLightColors[8];
uniform vec3 skyDirectionalLightDirections[8];
uniform vec3 fog3SunColor;
uniform float fog3SunAmount;
uniform bool fog3DepthEnabled;
uniform bool fog3TransmitEnabled;
uniform float fog3TransmitCurve;
uniform bool fog3HeightEnabled;
uniform float fog3HeightMin;
uniform float fog3HeightMax;
uniform float fog3HeightCurve;
varying vec2 vUv;

vec3 reconstructViewPosition(float depth) {
  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = inverseProjectionMatrix * clip;
  return view.xyz / view.w;
}

void main() {
  vec4 inputColor = texture2D(tDiffuse, vUv);
  float depth = texture2D(tDepth, vUv).r;
  bool sky = depth >= 0.999999;
  vec3 vertex = reconstructViewPosition(depth);
  if (fogDialect == 3) {
    if (sky) {
      gl_FragColor = inputColor;
      return;
    }
    vec3 fogColor3 = fogLightColor;
    if (directionalLightCount > 0) {
      float sun = fog3SunAmount * pow(max(dot(normalize(vertex), directionalLightDirections[0]), 0.0), 8.0);
      fogColor3 = mix(fogColor3, fog3SunColor, sun);
    }
    float fogAmount3 = 0.0;
    if (fog3DepthEnabled) {
      float depthEnd3 = fogDepthEnd > 0.0 ? fogDepthEnd : cameraFar;
      float fogZ3 = smoothstep(fogDepthBegin, depthEnd3, length(vertex));
      fogAmount3 = pow(fogZ3, fogDepthCurve) * fogDensity;
      if (fog3TransmitEnabled) {
        float transmit = pow(fogZ3, fog3TransmitCurve);
        fogColor3 = mix(max(inputColor.rgb, fogColor3), fogColor3, transmit);
      }
    }
    if (fog3HeightEnabled) {
      float y3 = (inverseViewMatrix * vec4(vertex, 1.0)).y;
      float heightFog3 = pow(smoothstep(fog3HeightMin, fog3HeightMax, y3), fog3HeightCurve);
      fogAmount3 = max(fogAmount3, heightFog3);
    }
    fogAmount3 = clamp(fogAmount3, 0.0, 1.0);
    gl_FragColor = vec4(mix(inputColor.rgb, fogColor3, fogAmount3), inputColor.a);
    return;
  }
  vec3 fogColor = fogLightColor;
  vec3 viewDirection = normalize(vertex);
  if (sky) fogColor = mix(fogColor, inputColor.rgb, fogAerialPerspective);
  if (fogSunScatter > 0.001) {
    if (sky) {
      for (int index = 0; index < 8; index += 1) {
        if (index >= skyDirectionalLightCount) break;
        float lightAmount = pow(max(dot(viewDirection, skyDirectionalLightDirections[index]), 0.0), 8.0);
        // Godot's sky shader integrates the directional-light solid angle; the scene shader does not.
        lightAmount *= 3.14159265358979323846;
        fogColor += skyDirectionalLightColors[index] * lightAmount * fogSunScatter;
      }
    } else {
      for (int index = 0; index < 8; index += 1) {
        if (index >= directionalLightCount) break;
        float lightAmount = pow(max(dot(viewDirection, directionalLightDirections[index]), 0.0), 8.0);
        fogColor += directionalLightColors[index] * lightAmount * fogSunScatter;
      }
    }
  }

  float fogAmount = 0.0;
  if (sky) {
    fogAmount = fogSkyAffect;
  } else if (fogMode == 1) {
    float depthEnd = fogDepthEnd > 0.0 ? fogDepthEnd : cameraFar;
    float depthBegin = min(fogDepthBegin, depthEnd - 0.001);
    float fogZ = smoothstep(depthBegin, depthEnd, length(vertex));
    fogAmount = pow(fogZ, fogDepthCurve) * fogDensity;
  } else {
    fogAmount = 1.0 - exp(min(0.0, -length(vertex) * fogDensity));
  }
  if (!sky && abs(fogHeightDensity) >= 0.0001) {
    float y = (inverseViewMatrix * vec4(vertex, 1.0)).y;
    float yDistance = y - fogHeight;
    float heightFog = 1.0 - exp(min(0.0, yDistance * fogHeightDensity));
    fogAmount = max(heightFog, fogAmount);
  }
  fogAmount = clamp(fogAmount, 0.0, 1.0);
  gl_FragColor = vec4(mix(inputColor.rgb, fogColor, fogAmount), inputColor.a);
}
`;

export class GodotFogPass extends Pass implements GodotEnvironmentFogRuntime {
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly inverseProjection = new Matrix4();
  private readonly inverseView = new Matrix4();
  private readonly lightDirection = new Vector3();
  private readonly lightPosition = new Vector3();
  private readonly targetPosition = new Vector3();
  private depthTexture: Texture | null = null;
  private readonly unbindEnvironment: () => void;

  constructor(
    private readonly renderScene: Scene,
    private readonly renderCamera: Camera,
    fog: GodotFogConfig,
  ) {
    super('GodotFog');
    this.needsSwap = true;
    this.needsDepthTexture = true;
    const lightColor = new Color(
      fog.dialect === 'godot-4' ? fog.lightColor : fog.color,
    ).multiplyScalar(fog.dialect === 'godot-4' ? fog.lightEnergy : 1);
    this.material = new ShaderMaterial({
      name: 'GodotEnvironmentFog',
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        inverseProjectionMatrix: { value: this.inverseProjection },
        inverseViewMatrix: { value: this.inverseView },
        fogDialect: { value: fog.dialect === 'godot-4' ? 4 : 3 },
        fogLightColor: { value: lightColor },
        fogDensity: { value: fog.density },
        fogHeight: { value: fog.dialect === 'godot-4' ? fog.height : 0 },
        fogHeightDensity: {
          value: fog.dialect === 'godot-4' ? fog.heightDensity : 0,
        },
        fogDepthCurve: { value: fog.depthCurve },
        fogDepthBegin: { value: fog.depthBegin },
        fogDepthEnd: { value: fog.depthEnd },
        fogSkyAffect: { value: fog.dialect === 'godot-4' ? fog.skyAffect : 0 },
        fogAerialPerspective: {
          value: fog.dialect === 'godot-4' ? fog.aerialPerspective : 0,
        },
        fogSunScatter: {
          value: fog.dialect === 'godot-4' ? fog.sunScatter : 0,
        },
        cameraFar: { value: 1000 },
        fogMode: { value: fog.dialect === 'godot-4' ? fog.mode : 0 },
        directionalLightCount: { value: 0 },
        directionalLightColors: {
          value: [...Array(8)].map(() => new Color()),
        },
        directionalLightDirections: {
          value: [...Array(8)].map(() => new Vector3()),
        },
        skyDirectionalLightCount: { value: 0 },
        skyDirectionalLightColors: {
          value: [...Array(8)].map(() => new Color()),
        },
        skyDirectionalLightDirections: {
          value: [...Array(8)].map(() => new Vector3()),
        },
        fog3SunColor: {
          value: new Color(fog.dialect === 'godot-3' ? fog.sunColor : '#000000'),
        },
        fog3SunAmount: {
          value: fog.dialect === 'godot-3' ? fog.sunAmount : 0,
        },
        fog3DepthEnabled: {
          value: fog.dialect === 'godot-3' && fog.depthEnabled,
        },
        fog3TransmitEnabled: {
          value: fog.dialect === 'godot-3' && fog.transmitEnabled,
        },
        fog3TransmitCurve: {
          value: fog.dialect === 'godot-3' ? fog.transmitCurve : 1,
        },
        fog3HeightEnabled: {
          value: fog.dialect === 'godot-3' && fog.heightEnabled,
        },
        fog3HeightMin: {
          value: fog.dialect === 'godot-3' ? fog.heightMin : 0,
        },
        fog3HeightMax: {
          value: fog.dialect === 'godot-3' ? fog.heightMax : 0,
        },
        fog3HeightCurve: {
          value: fog.dialect === 'godot-3' ? fog.heightCurve : 1,
        },
      },
      vertexShader: GODOT_FILMIC_VERTEX,
      fragmentShader: GODOT_FOG_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
    this.unbindEnvironment = bindEnvironmentFogRuntime(renderScene, this);
  }

  isFogEnabled(): boolean { return this.enabled; }
  setFogEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') throw new TypeError('Environment.fog_enabled requires bool.');
    this.enabled = enabled;
  }

  getFogMode(): number { return Number(this.material.uniforms['fogMode']!.value); }
  setFogMode(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 1) {
      throw new RangeError('Environment.fog_mode requires EXPONENTIAL or DEPTH.');
    }
    this.material.uniforms['fogMode']!.value = value;
  }

  getFogLightColor(): { r: number; g: number; b: number; a: 1 } {
    const value = this.material.uniforms['fogLightColor']!.value as Color;
    const energy = Math.max(this.getFogLightEnergy(), Number.EPSILON);
    return { r: value.r / energy, g: value.g / energy, b: value.b / energy, a: 1 };
  }
  setFogLightColor(value: { r: number; g: number; b: number; a?: number }): void {
    if (![value.r, value.g, value.b, value.a ?? 1].every(Number.isFinite)) {
      throw new TypeError('Environment.fog_light_color requires finite Color.');
    }
    const energy = this.getFogLightEnergy();
    (this.material.uniforms['fogLightColor']!.value as Color)
      .setRGB(value.r, value.g, value.b).multiplyScalar(energy);
  }

  getFogLightEnergy(): number { return Number(this.material.userData['godotFogLightEnergy'] ?? 1); }
  setFogLightEnergy(value: number): void {
    value = this.nonnegative(value, 'fog_light_energy');
    const current = this.getFogLightColor();
    this.material.userData['godotFogLightEnergy'] = value;
    (this.material.uniforms['fogLightColor']!.value as Color)
      .setRGB(current.r, current.g, current.b).multiplyScalar(value);
  }

  getFogSunScatter(): number { return this.scalar('fogSunScatter'); }
  setFogSunScatter(value: number): void { this.setScalar('fogSunScatter', value, 'fog_sun_scatter'); }
  getFogDensity(): number { return this.scalar('fogDensity'); }
  setFogDensity(value: number): void { this.setScalar('fogDensity', value, 'fog_density'); }
  getFogHeight(): number { return this.scalar('fogHeight'); }
  setFogHeight(value: number): void {
    if (!Number.isFinite(value)) throw new TypeError('Environment.fog_height requires finite float.');
    this.material.uniforms['fogHeight']!.value = value;
  }
  getFogHeightDensity(): number { return this.scalar('fogHeightDensity'); }
  setFogHeightDensity(value: number): void {
    if (!Number.isFinite(value)) throw new TypeError('Environment.fog_height_density requires finite float.');
    this.material.uniforms['fogHeightDensity']!.value = value;
  }
  getFogAerialPerspective(): number { return this.scalar('fogAerialPerspective'); }
  setFogAerialPerspective(value: number): void { this.setUnitScalar('fogAerialPerspective', value, 'fog_aerial_perspective'); }
  getFogSkyAffect(): number { return this.scalar('fogSkyAffect'); }
  setFogSkyAffect(value: number): void { this.setUnitScalar('fogSkyAffect', value, 'fog_sky_affect'); }
  getFogDepthCurve(): number { return this.scalar('fogDepthCurve'); }
  setFogDepthCurve(value: number): void { this.setScalar('fogDepthCurve', value, 'fog_depth_curve'); }
  getFogDepthBegin(): number { return this.scalar('fogDepthBegin'); }
  setFogDepthBegin(value: number): void { this.setScalar('fogDepthBegin', value, 'fog_depth_begin'); }
  getFogDepthEnd(): number { return this.scalar('fogDepthEnd'); }
  setFogDepthEnd(value: number): void { this.setScalar('fogDepthEnd', value, 'fog_depth_end'); }

  private scalar(name: string): number { return Number(this.material.uniforms[name]!.value); }
  private nonnegative(value: number, member: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`Environment.${member} requires finite nonnegative float.`);
    }
    return value;
  }
  private setScalar(name: string, value: number, member: string): void {
    this.material.uniforms[name]!.value = this.nonnegative(value, member);
  }
  private setUnitScalar(name: string, value: number, member: string): void {
    value = this.nonnegative(value, member);
    if (value > 1) throw new RangeError(`Environment.${member} requires a value from 0 through 1.`);
    this.material.uniforms[name]!.value = value;
  }

  setDepthTexture(depthTexture: Texture | null): void {
    this.depthTexture = depthTexture;
    this.material.uniforms['tDepth']!.value = depthTexture;
  }

  getDepthTexture(): Texture {
    // postprocessing's declaration says Texture while its documented/runtime empty value is null.
    return this.depthTexture as Texture;
  }

  private updateFrameUniforms(): void {
    this.renderCamera.updateMatrixWorld();
    this.inverseProjection.copy(this.renderCamera.projectionMatrix).invert();
    this.inverseView.copy(this.renderCamera.matrixWorld);
    this.material.uniforms['cameraFar']!.value =
      'far' in this.renderCamera && typeof this.renderCamera.far === 'number'
        ? this.renderCamera.far
        : 1000;
    const colors = this.material.uniforms['directionalLightColors']!.value as Color[];
    const directions = this.material.uniforms['directionalLightDirections']!.value as Vector3[];
    const skyColors = this.material.uniforms['skyDirectionalLightColors']!.value as Color[];
    const skyDirections = this.material.uniforms['skyDirectionalLightDirections']!.value as Vector3[];
    let count = 0;
    let skyCount = 0;
    this.renderScene.traverseVisible((object) => {
      if (
        !('isDirectionalLight' in object) ||
        object.isDirectionalLight !== true ||
        !this.renderCamera.layers.test(object.layers)
      ) {
        return;
      }
      const light = object as typeof object & {
        readonly color: Color;
        readonly intensity: number;
        readonly target: { getWorldPosition(target: Vector3): Vector3 };
      };
      light.getWorldPosition(this.lightPosition);
      light.target.getWorldPosition(this.targetPosition);
      this.lightDirection
        .subVectors(this.lightPosition, this.targetPosition)
        .transformDirection(this.renderCamera.matrixWorldInverse);
      const skyMode = getSkyMode(light);
      if (
        count < 8 &&
        (skyMode === SKY_MODE_LIGHT_AND_SKY || skyMode === SKY_MODE_LIGHT_ONLY)
      ) {
        // `light_storage.cpp` uploads non-physical geometry energy as E*PI, which is exactly the
        // intensity the scene emitter stores on Three's directional light.
        colors[count]!.copy(light.color).multiplyScalar(light.intensity);
        directions[count]!.copy(this.lightDirection);
        count += 1;
      }
      if (
        skyCount < 8 &&
        (skyMode === SKY_MODE_LIGHT_AND_SKY || skyMode === SKY_MODE_SKY_ONLY)
      ) {
        // `sky.cpp` uploads authored E without the geometry PI multiplier.
        skyColors[skyCount]!.copy(light.color).multiplyScalar(getLightEnergy(light));
        skyDirections[skyCount]!.copy(this.lightDirection);
        skyCount += 1;
      }
    });
    this.material.uniforms['directionalLightCount']!.value = count;
    this.material.uniforms['skyDirectionalLightCount']!.value = skyCount;
  }

  render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
  ): void {
    if (inputBuffer === null) throw new Error('Godot fog requires a composer input buffer.');
    this.updateFrameUniforms();
    this.material.uniforms['tDiffuse']!.value = inputBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.unbindEnvironment();
    this.material.dispose();
    this.quad.dispose();
  }
}

/** Godot's Filmic operator and optional adjustment block from `tonemap.glsl`. */
function godotFilmicFragment(adjustments: boolean): string {
  return `
uniform sampler2D tDiffuse;
uniform sampler2D autoExposureTexture;
uniform float autoExposureEnabled;
uniform float autoExposureScale;
uniform float exposure;
uniform float white;
${
  adjustments
    ? `uniform float brightness;
uniform float contrast;
uniform float saturation;`
    : ""
}
varying vec2 vUv;

const float A = 0.88; // 0.22 * 2 * 2
const float B = 0.60; // 0.30 * 2
const float C = 0.10;
const float D = 0.20;
const float E = 0.01;
const float F = 0.30;

vec3 godotFilmicCurve(vec3 color) {
  return ((color * (A * color + C * B) + D * E) /
    (color * (A * color + B) + D * F)) - E / F;
}

float godotFilmicCurve(float value) {
  return ((value * (A * value + C * B) + D * E) /
    (value * (A * value + B) + D * F)) - E / F;
}
${
  adjustments
    ? `
// Godot's own transfer functions, from its tonemap.glsl lines 235-243.
vec3 godotLinearToSrgb(vec3 color) {
  const vec3 a = vec3(0.055);
  return mix((vec3(1.0) + a) * pow(color, vec3(1.0 / 2.4)) - a, 12.92 * color, vec3(lessThan(color, vec3(0.0031308))));
}

vec3 godotSrgbToLinear(vec3 color) {
  const vec3 a = vec3(0.055);
  return mix(pow((color + a) * (1.0 / (vec3(1.0) + a)), vec3(2.4)), color * (1.0 / 12.92), vec3(lessThan(color, vec3(0.04045))));
}
`
    : ""
}
void main() {
  vec4 inputColor = texture2D(tDiffuse, vUv);
  float adaptedExposure = autoExposureEnabled > 0.5
    ? exposure / (texture2D(autoExposureTexture, vec2(0.5)).r / autoExposureScale)
    : exposure;
  vec3 exposed = max(vec3(0.0), inputColor.rgb * adaptedExposure);
  vec3 mapped = clamp(godotFilmicCurve(exposed) / godotFilmicCurve(white), 0.0, 1.0);
${
  adjustments
    ? `  // brightness in LINEAR, then contrast and saturation on the sRGB-encoded value.
  mapped = godotLinearToSrgb(mapped * brightness);
  mapped = mix(vec3(0.5), mapped, contrast);
  mapped = mix(vec3(dot(vec3(1.0), mapped) * (1.0 / 3.0)), mapped, saturation);
  mapped = godotSrgbToLinear(clamp(mapped, 0.0, 1.0));`
    : ""
}
  gl_FragColor = vec4(mapped, inputColor.a);
  #include <colorspace_fragment>
}
`;
}

/**
 * Godot 4.7's AgX operator from pinned `tonemap.glsl`.
 *
 * This is deliberately not Three's AgXToneMapping: Godot 4.7 replaced its previous AgX curve
 * with AllenWP and combines its own Rec.709/Rec.2020 transforms with the AgX inset/outset matrices.
 * The CPU parameter derivation below is the matching `environment_storage.cpp` branch for an SDR
 * output maximum of 1.0, which is the browser canvas this copied runtime owns.
 */
function godotAgxFragment(adjustments: boolean): string {
  return `
uniform sampler2D tDiffuse;
uniform sampler2D autoExposureTexture;
uniform float autoExposureEnabled;
uniform float autoExposureScale;
uniform float exposure;
uniform float awpContrast;
uniform float awpToeA;
uniform float awpSlope;
uniform float awpW;
${
  adjustments
    ? `uniform float brightness;
uniform float contrast;
uniform float saturation;`
    : ""
}
varying vec2 vUv;

vec3 godotAgxCurve(vec3 x) {
  const float crossover = 0.18;
  const float shoulderMax = 0.82;
  vec3 s = x - crossover;
  vec3 slopeS = awpSlope * s;
  s = slopeS * (1.0 + s / awpW) / (1.0 + slopeS / shoulderMax);
  s += crossover;
  vec3 t = pow(x, vec3(awpContrast));
  t = t / (t + awpToeA);
  return mix(s, t, vec3(lessThan(x, vec3(crossover))));
}

vec3 godotAgx(vec3 color) {
  const mat3 inset = mat3(
    0.544814746488245, 0.140416948464053, 0.0888104196149096,
    0.373787398372697, 0.754137554567394, 0.178871756420858,
    0.0813978551390581, 0.105445496968552, 0.732317823964232
  );
  const mat3 outset = mat3(
    1.96488741169489, -0.299313364904742, -0.164352742528393,
    -0.855988495690215, 1.32639796461980, -0.238183969428088,
    -0.108898916004672, -0.0270845997150571, 1.40253671195648
  );
  color = inset * color;
  color = godotAgxCurve(color);
  color = min(vec3(1.0), color);
  return outset * color;
}
${
  adjustments
    ? `
vec3 godotLinearToSrgb(vec3 color) {
  const vec3 a = vec3(0.055);
  return mix((vec3(1.0) + a) * pow(color, vec3(1.0 / 2.4)) - a, 12.92 * color, vec3(lessThan(color, vec3(0.0031308))));
}

vec3 godotSrgbToLinear(vec3 color) {
  const vec3 a = vec3(0.055);
  return mix(pow((color + a) * (1.0 / (vec3(1.0) + a)), vec3(2.4)), color * (1.0 / 12.92), vec3(lessThan(color, vec3(0.04045))));
}
`
    : ""
}
void main() {
  vec4 inputColor = texture2D(tDiffuse, vUv);
  float adaptedExposure = autoExposureEnabled > 0.5
    ? exposure / (texture2D(autoExposureTexture, vec2(0.5)).r / autoExposureScale)
    : exposure;
  vec3 mapped = godotAgx(max(vec3(0.0), inputColor.rgb * adaptedExposure));
${
  adjustments
    ? `  mapped = godotLinearToSrgb(mapped * brightness);
  mapped = mix(vec3(0.5), mapped, contrast);
  mapped = mix(vec3(dot(vec3(1.0), mapped) * (1.0 / 3.0)), mapped, saturation);
  mapped = godotSrgbToLinear(clamp(mapped, 0.0, 1.0));`
    : ""
}
  gl_FragColor = vec4(mapped, inputColor.a);
  #include <colorspace_fragment>
}
`;
}

function godotAgxParameters(
  white: number,
  contrast: number,
): {
  toeA: number;
  slope: number;
  w: number;
} {
  const crossover = 0.18;
  const shoulderMax = 1 - crossover;
  const crossoverPower = Math.pow(crossover, contrast);
  const toeA = (1 / crossover - 1) * crossoverPower;
  const slopeDenominator = crossoverPower + toeA;
  const slope =
    (contrast * Math.pow(crossover, contrast - 1) * toeA) /
    (slopeDenominator * slopeDenominator);
  const width = white - crossover;
  return { toeA, slope, w: ((width * width) / shoulderMax) * slope };
}

const GODOT_GLOW_BLUR_VERTEX = GODOT_FILMIC_VERTEX;

/** Godot's 9-tap separable gaussian and first-level firefly/HDR feedback. */
const GODOT_GLOW_BLUR_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform vec2 tStep;
uniform float fireflyIn;
uniform float fireflyOut;
uniform float glowStrength;
uniform float glowExposure;
uniform float glowBloom;
uniform float glowHdrThreshold;
uniform float glowHdrScale;
uniform float glowLuminanceCap;
uniform sampler2D autoExposureTexture;
uniform float autoExposureEnabled;
uniform float autoExposureScale;
varying vec2 vUv;

const float K0 = 0.2024;
const float K1 = 0.1790;
const float K2 = 0.1240;
const float K3 = 0.0672;
const float K4 = 0.0285;

vec3 fireflyWeight() {
  return vec3(0.299, 0.587, 0.114) / max(glowLuminanceCap, 6.0);
}

vec3 tap(vec2 uv) {
  vec3 c = texture2D(tDiffuse, uv).rgb;
  if (fireflyIn > 0.5) c /= 1.0 + dot(c, fireflyWeight());
  return c;
}

void main() {
  vec3 c = tap(vUv) * K0;
  c += (tap(vUv + tStep) + tap(vUv - tStep)) * K1;
  c += (tap(vUv + tStep * 2.0) + tap(vUv - tStep * 2.0)) * K2;
  c += (tap(vUv + tStep * 3.0) + tap(vUv - tStep * 3.0)) * K3;
  c += (tap(vUv + tStep * 4.0) + tap(vUv - tStep * 4.0)) * K4;
  if (fireflyOut > 0.5) {
    c /= 1.0 - dot(c, fireflyWeight());
    c *= glowStrength;
    float adaptedExposure = autoExposureEnabled > 0.5
      ? glowExposure / (texture2D(autoExposureTexture, vec2(0.5)).r / autoExposureScale)
      : glowExposure;
    c *= adaptedExposure;
    float luminance = max(c.r, max(c.g, c.b));
    float feedback = max(smoothstep(glowHdrThreshold, glowHdrThreshold + glowHdrScale, luminance), glowBloom);
    c = min(c * feedback, vec3(glowLuminanceCap));
  } else {
    c *= glowStrength;
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

function glslFloat(value: number): string {
  const text = String(value);
  return text.includes(".") || /e/i.test(text) ? text : `${text}.0`;
}

/** `gather_glow` + `apply_glow` from Godot's `tonemap.glsl`. */
function godotGlowCompositeFragment(glow: GodotGlowConfig): string {
  const enabled = [...Array(glow.levelCount).keys()].filter(
    (index) => (glow.levels[index] ?? 0) > 0.0001,
  );
  const uniforms = enabled
    .map((index) => `uniform sampler2D tLevel${index};\nuniform vec2 tLevel${index}Size;`)
    .join("\n");
  const bicubic = glow.bicubicUpscale === true ? `
float glowW0(float a) { return (a * (a * (-a + 3.0) - 3.0) + 1.0) / 6.0; }
float glowW1(float a) { return (a * a * (3.0 * a - 6.0) + 4.0) / 6.0; }
float glowW2(float a) { return (a * (a * (-3.0 * a + 3.0) + 3.0) + 1.0) / 6.0; }
float glowW3(float a) { return a * a * a / 6.0; }
vec3 sampleGlowBicubic(sampler2D tex, vec2 texSize, vec2 uv) {
  vec2 texel = 1.0 / texSize;
  vec2 scaled = uv * texSize + vec2(0.5);
  vec2 integral = floor(scaled);
  vec2 f = fract(scaled);
  vec2 g0 = vec2(glowW0(f.x) + glowW1(f.x), glowW0(f.y) + glowW1(f.y));
  vec2 g1 = vec2(glowW2(f.x) + glowW3(f.x), glowW2(f.y) + glowW3(f.y));
  vec2 h0 = vec2(-1.0 + glowW1(f.x) / g0.x, -1.0 + glowW1(f.y) / g0.y);
  vec2 h1 = vec2(1.0 + glowW3(f.x) / g1.x, 1.0 + glowW3(f.y) / g1.y);
  vec2 p0 = (integral + vec2(h0.x, h0.y) - vec2(0.5)) * texel;
  vec2 p1 = (integral + vec2(h1.x, h0.y) - vec2(0.5)) * texel;
  vec2 p2 = (integral + vec2(h0.x, h1.y) - vec2(0.5)) * texel;
  vec2 p3 = (integral + vec2(h1.x, h1.y) - vec2(0.5)) * texel;
  return g0.y * (g0.x * texture2D(tex, p0).rgb + g1.x * texture2D(tex, p1).rgb) +
    g1.y * (g0.x * texture2D(tex, p2).rgb + g1.x * texture2D(tex, p3).rgb);
}
` : '';
  const gather = enabled
    .map(
      (index) =>
        `  glow += ${glow.bicubicUpscale === true
          ? `sampleGlowBicubic(tLevel${index}, tLevel${index}Size, vUv)`
          : `texture2D(tLevel${index}, vUv).rgb`} * ${glslFloat(glow.levels[index] ?? 0)};`,
    )
    .join("\n");
  const blend =
    glow.blendMode === 0
      ? "  color = color + glow;"
      : glow.blendMode === 3
        ? "  color = glow;"
        : glow.blendMode === 4
          ? `  color = color * (1.0 - glowMix) + glow;`
          : `  glow = clamp(glow, 0.0, white);
  color = color + glow - (color * glow / white);`;
  return `
uniform sampler2D tDiffuse;
${uniforms}
uniform float glowIntensity;
uniform float glowMix;
uniform float glowEnabled;
uniform float exposure;
uniform float white;
uniform sampler2D autoExposureTexture;
uniform float autoExposureEnabled;
uniform float autoExposureScale;
varying vec2 vUv;
${bicubic}

void main() {
  vec4 source = texture2D(tDiffuse, vUv);
  float adaptedExposure = autoExposureEnabled > 0.5
    ? exposure / (texture2D(autoExposureTexture, vec2(0.5)).r / autoExposureScale)
    : exposure;
  vec3 color = max(vec3(0.0), source.rgb * adaptedExposure);
  vec3 glow = vec3(0.0);
${gather}
  glow *= glowIntensity;
  if (glowEnabled > 0.5) {
${blend.split('\n').map((line) => `  ${line}`).join('\n')}
  }
  gl_FragColor = vec4(color, source.a);
}
`;
}

/** Godot's glow pyramid as one Three postprocessing pass. */
export class GodotGlowPass extends Pass implements GodotEnvironmentGlowRuntime {
  private readonly levels: WebGLRenderTarget[] = [];
  private readonly halves: WebGLRenderTarget[] = [];
  private readonly blur: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly sizedFor = new Vector2();
  private readonly drawingBuffer = new Vector2();
  private glow: GodotGlowConfig;
  private glowEnabled: boolean;
  private readonly unbindEnvironment: () => void;

  constructor(
    effect: GodotPostEffectConfig,
    glow: GodotGlowConfig,
    scene: Scene,
  ) {
    super();
    this.glow = {
      ...glow,
      levels: [...glow.levels],
      sourceLevels: [...glow.sourceLevels],
    };
    this.glowEnabled = glow.enabled;
    this.needsSwap = true;
    this.blur = new ShaderMaterial({
      name: "GodotGlowBlur",
      uniforms: {
        tDiffuse: { value: null },
        tStep: { value: new Vector2() },
        fireflyIn: { value: 0 },
        fireflyOut: { value: 0 },
        glowStrength: { value: glow.strength },
        glowExposure: { value: effect.exposure },
        glowBloom: { value: glow.bloom },
        glowHdrThreshold: { value: glow.hdrThreshold },
        glowHdrScale: { value: glow.hdrScale },
        glowLuminanceCap: { value: glow.luminanceCap },
        autoExposureTexture: { value: null },
        autoExposureEnabled: { value: effect.autoExposure === undefined ? 0 : 1 },
        autoExposureScale: { value: effect.autoExposure?.scale ?? 1 },
      },
      vertexShader: GODOT_GLOW_BLUR_VERTEX,
      fragmentShader: GODOT_GLOW_BLUR_FRAGMENT,
    });
    const levelUniforms = Object.fromEntries(
      [...Array(glow.levelCount).keys()]
        .filter((index) => (glow.levels[index] ?? 0) > 0.0001)
        .flatMap((index) => [
          [`tLevel${index}`, { value: null }],
          [`tLevel${index}Size`, { value: new Vector2(1, 1) }],
        ]),
    );
    this.composite = new ShaderMaterial({
      name: "GodotGlowComposite",
      uniforms: {
        tDiffuse: { value: null },
        ...levelUniforms,
        glowIntensity: {
          value: glow.blendMode === 4 ? glow.mix : glow.intensity,
        },
        glowMix: { value: glow.mix },
        glowEnabled: { value: glow.enabled ? 1 : 0 },
        exposure: { value: effect.exposure },
        white: { value: effect.white },
        autoExposureTexture: { value: null },
        autoExposureEnabled: { value: effect.autoExposure === undefined ? 0 : 1 },
        autoExposureScale: { value: effect.autoExposure?.scale ?? 1 },
      },
      vertexShader: GODOT_GLOW_BLUR_VERTEX,
      fragmentShader: godotGlowCompositeFragment(glow),
    });
    this.quad = new FullScreenQuad(this.blur);
    this.unbindEnvironment = bindEnvironmentGlowRuntime(scene, this);
  }

  isGlowEnabled(): boolean { return this.glowEnabled; }
  setGlowEnabled(enabled: boolean): void {
    if (enabled && this.glow.blendMode === 2) {
      throw new Error('Environment glow SOFTLIGHT requires the source post-tonemap insertion point and cannot be enabled by this pass.');
    }
    if (enabled && this.glow.highQuality === true) {
      throw new Error('Environment glow_high_quality requires the source high-quality pyramid layout and cannot be enabled by this pass.');
    }
    this.glowEnabled = enabled;
    (this.composite.uniforms['glowEnabled'] as { value: number }).value = enabled ? 1 : 0;
  }
  getGlowBloom(): number { return this.glow.bloom; }
  setGlowBloom(value: number): void {
    this.glow = { ...this.glow, bloom: value };
    (this.blur.uniforms['glowBloom'] as { value: number }).value = value;
  }
  getGlowIntensity(): number { return this.glow.intensity; }
  setGlowIntensity(value: number): void {
    this.glow = { ...this.glow, intensity: value };
    if (this.glow.blendMode !== 4) {
      (this.composite.uniforms['glowIntensity'] as { value: number }).value = value;
    }
  }
  getGlowStrength(): number { return this.glow.strength; }
  setGlowStrength(value: number): void {
    this.glow = { ...this.glow, strength: value };
    (this.blur.uniforms['glowStrength'] as { value: number }).value = value;
  }
  getGlowHdrThreshold(): number { return this.glow.hdrThreshold; }
  setGlowHdrThreshold(value: number): void {
    this.glow = { ...this.glow, hdrThreshold: value };
    (this.blur.uniforms['glowHdrThreshold'] as { value: number }).value = value;
  }
  getGlowHdrScale(): number { return this.glow.hdrScale; }
  setGlowHdrScale(value: number): void {
    this.glow = { ...this.glow, hdrScale: value };
    (this.blur.uniforms['glowHdrScale'] as { value: number }).value = value;
  }
  getGlowHdrLuminanceCap(): number { return this.glow.luminanceCap; }
  setGlowHdrLuminanceCap(value: number): void {
    this.glow = { ...this.glow, luminanceCap: value };
    (this.blur.uniforms['glowLuminanceCap'] as { value: number }).value = value;
  }
  getGlowBlendMode(): number { return this.glow.blendMode; }
  setGlowBlendMode(mode: number): void {
    const declared = this.glow.dialect === 'godot-3' ? [0, 1, 2, 3] : [0, 1, 2, 3, 4];
    if (!declared.includes(mode)) {
      throw new Error(`Environment glow blend mode ${mode} is outside the ${this.glow.dialect} source enum.`);
    }
    if (mode === 2 && this.glowEnabled) {
      throw new Error('Environment glow SOFTLIGHT requires the source post-tonemap insertion point and cannot replace an enabled pre-tonemap blend.');
    }
    this.glow = { ...this.glow, blendMode: mode };
    (this.composite.uniforms['glowIntensity'] as { value: number }).value =
      mode === 4 ? this.glow.mix : this.glow.intensity;
    this.composite.fragmentShader = godotGlowCompositeFragment(this.glow);
    this.composite.needsUpdate = true;
  }
  isGlowNormalized(): boolean { return this.glow.normalized; }
  setGlowNormalized(enabled: boolean): void {
    const total = this.glow.sourceLevels.reduce((sum, one) => sum + one, 0);
    const levels = enabled && total > 0
      ? this.glow.sourceLevels.map((one) => one / total)
      : [...this.glow.sourceLevels];
    this.glow = { ...this.glow, normalized: enabled, levels };
    this.composite.fragmentShader = godotGlowCompositeFragment(this.glow);
    this.composite.needsUpdate = true;
  }
  getGlowMix(): number { return this.glow.mix; }
  setGlowMix(value: number): void {
    if (value < 0 || value > 1) {
      throw new RangeError('Environment.glow_mix must be between 0 and 1.');
    }
    this.glow = { ...this.glow, mix: value };
    (this.composite.uniforms['glowMix'] as { value: number }).value = value;
    if (this.glow.blendMode === 4) {
      (this.composite.uniforms['glowIntensity'] as { value: number }).value = value;
    }
  }
  isGlowBicubicUpscaleEnabled(): boolean { return this.glow.bicubicUpscale === true; }
  setGlowBicubicUpscaleEnabled(enabled: boolean): void {
    this.glow = { ...this.glow, bicubicUpscale: enabled };
    this.composite.fragmentShader = godotGlowCompositeFragment(this.glow);
    this.composite.needsUpdate = true;
  }
  isGlowHighQualityEnabled(): boolean { return this.glow.highQuality === true; }
  setGlowHighQualityEnabled(enabled: boolean): void {
    if (enabled && this.glowEnabled) {
      throw new Error('Environment glow_high_quality requires the source high-quality pyramid and cannot replace the active low-quality carrier.');
    }
    this.glow = { ...this.glow, highQuality: enabled };
  }
  getGlowLevel(index: number): number { return this.glow.sourceLevels[index] ?? 0; }
  setGlowLevel(index: number, weight: number): void {
    const sourceLevels = [...this.glow.sourceLevels];
    sourceLevels[index] = weight;
    const total = sourceLevels.reduce((sum, one) => sum + one, 0);
    const levels = this.glow.normalized && total > 0
      ? sourceLevels.map((one) => one / total)
      : [...sourceLevels];
    let levelCount = 0;
    for (let cursor = 0; cursor < levels.length; cursor += 1) {
      if ((levels[cursor] ?? 0) > 0.0001) levelCount = cursor + 1;
    }
    this.glow = { ...this.glow, sourceLevels, levels, levelCount };
    const uniforms = this.composite.uniforms as Record<string, { value: unknown }>;
    for (let cursor = 0; cursor < levelCount; cursor += 1) {
      if ((levels[cursor] ?? 0) <= 0.0001) continue;
      uniforms[`tLevel${cursor}`] ??= { value: null };
      uniforms[`tLevel${cursor}Size`] ??= { value: new Vector2(1, 1) };
    }
    this.composite.fragmentShader = godotGlowCompositeFragment(this.glow);
    this.composite.needsUpdate = true;
    this.sizedFor.set(0, 0);
  }

  bindAutoExposure(pass: GodotAutoExposurePass): void {
    pass.bindExposureTexture(
      this.blur.uniforms['autoExposureTexture'] as { value: Texture | null },
    );
    pass.bindExposureTexture(
      this.composite.uniforms['autoExposureTexture'] as { value: Texture | null },
    );
  }

  /** Size against the drawing buffer; EffectComposer's pass size is CSS pixels. */
  private resize(width: number, height: number): void {
    if (this.sizedFor.x === width && this.sizedFor.y === height) return;
    this.sizedFor.set(width, height);
    for (let index = 0; index < this.glow.levelCount; index += 1) {
      const levelWidth = Math.max(1, width >> (index + 1));
      const levelHeight = Math.max(1, height >> (index + 1));
      const sourceHeight = Math.max(1, height >> index);
      const level = this.levels[index];
      if (level === undefined) {
        const options = {
          type: HalfFloatType,
          depthBuffer: false,
          stencilBuffer: false,
        };
        this.levels[index] = new WebGLRenderTarget(
          levelWidth,
          levelHeight,
          options,
        );
        this.halves[index] = new WebGLRenderTarget(
          levelWidth,
          sourceHeight,
          options,
        );
      } else {
        level.setSize(levelWidth, levelHeight);
        this.halves[index]?.setSize(levelWidth, sourceHeight);
      }
    }
  }

  setSize(): void {
    this.sizedFor.set(0, 0);
  }

  render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
  ): void {
    if (inputBuffer === null) throw new Error('Godot glow requires a composer input buffer.');
    const previousTarget = renderer.getRenderTarget();
    const size = renderer.getDrawingBufferSize(this.drawingBuffer);
    this.resize(size.x, size.y);
    const blur = this.blur.uniforms as Record<string, { value: unknown }>;
    const composite = this.composite.uniforms as Record<
      string,
      { value: unknown }
    >;
    const step = (blur["tStep"] as { value: Vector2 }).value;
    this.quad.material = this.blur;
    let source: Texture = inputBuffer.texture;
    let sourceWidth = size.x;
    let sourceHeight = size.y;
    for (let index = 0; index < this.glow.levelCount; index += 1) {
      const level = this.levels[index] as WebGLRenderTarget;
      const half = this.halves[index] as WebGLRenderTarget;
      const first = index === 0 ? 1 : 0;
      (blur["tDiffuse"] as { value: unknown }).value = source;
      step.set(1 / sourceWidth, 0);
      (blur["fireflyIn"] as { value: unknown }).value = first;
      (blur["fireflyOut"] as { value: unknown }).value = 0;
      (blur["glowStrength"] as { value: unknown }).value = 1;
      renderer.setRenderTarget(half);
      this.quad.render(renderer);
      (blur["tDiffuse"] as { value: unknown }).value = half.texture;
      step.set(0, 1 / sourceHeight);
      (blur["fireflyIn"] as { value: unknown }).value = 0;
      (blur["fireflyOut"] as { value: unknown }).value = first;
      (blur["glowStrength"] as { value: unknown }).value = this.glow.strength;
      renderer.setRenderTarget(level);
      this.quad.render(renderer);
      source = level.texture;
      sourceWidth = level.width;
      sourceHeight = level.height;
    }

    (composite["tDiffuse"] as { value: unknown }).value = inputBuffer.texture;
    for (let index = 0; index < this.glow.levelCount; index += 1) {
      if ((this.glow.levels[index] ?? 0) <= 0.0001) continue;
      (composite[`tLevel${index}`] as { value: unknown }).value = (
        this.levels[index] as WebGLRenderTarget
      ).texture;
      const level = this.levels[index] as WebGLRenderTarget;
      const sizeUniform = composite[`tLevel${index}Size`] as { value: Vector2 } | undefined;
      sizeUniform?.value.set(level.width, level.height);
    }
    this.quad.material = this.composite;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    this.quad.render(renderer);
    renderer.setRenderTarget(previousTarget);
  }

  dispose(): void {
    this.unbindEnvironment();
    for (const target of this.levels) target.dispose();
    for (const target of this.halves) target.dispose();
    this.levels.length = 0;
    this.halves.length = 0;
    this.sizedFor.set(0, 0);
    this.blur.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}

/** Mount the source project's Godot postprocess over the current R3F scene. */

/** Add Godot's pinned Filmic/AgX and glow passes to the caller-owned native composer. */
export function addExactGodotEnvironmentPasses(
  composer: EffectComposer,
  scene: Scene,
  camera: Camera,
  effect: GodotPostEffectConfig,
): readonly Pass[] {
  const agx =
    effect.kind === 'godot-agx'
      ? godotAgxParameters(effect.white, effect.contrast)
      : undefined;
  const tonemapMaterial = new ShaderMaterial({
    name:
      effect.kind === 'godot-agx'
        ? 'GodotAgX'
        : effect.kind === 'godot-filmic'
          ? 'GodotFilmic'
          : 'GodotOutput',
    uniforms: {
      tDiffuse: { value: null },
      exposure: { value: effect.glow === undefined ? effect.exposure : 1 },
      white: { value: effect.white },
      autoExposureTexture: { value: null },
      autoExposureEnabled: {
        value:
          effect.autoExposure === undefined || effect.glow !== undefined ? 0 : 1,
      },
      autoExposureScale: { value: effect.autoExposure?.scale ?? 1 },
      ...(effect.kind === 'godot-agx'
        ? {
            awpContrast: { value: effect.contrast },
            awpToeA: { value: agx?.toeA },
            awpSlope: { value: agx?.slope },
            awpW: { value: agx?.w },
          }
        : {}),
      ...(effect.adjustments === undefined
        ? {}
        : {
            brightness: { value: effect.adjustments.brightness },
            contrast: { value: effect.adjustments.contrast },
            saturation: { value: effect.adjustments.saturation },
          }),
    },
    vertexShader: GODOT_FILMIC_VERTEX,
    fragmentShader:
      effect.kind === 'godot-agx'
        ? godotAgxFragment(effect.adjustments !== undefined)
        : effect.kind === 'godot-filmic'
          ? godotFilmicFragment(effect.adjustments !== undefined)
          : GODOT_OUTPUT_FRAGMENT,
  });
  const render = new RenderPass(scene, camera);
  const fog = effect.fog === undefined ? undefined : new GodotFogPass(scene, camera, effect.fog);
  const depthOfField =
    effect.depthOfField === undefined
      ? undefined
      : new GodotDepthOfFieldPass(camera, effect.depthOfField);
  const autoExposure =
    effect.autoExposure === undefined
      ? undefined
      : new GodotAutoExposurePass(effect.autoExposure);
  const glow = effect.glow === undefined ? undefined : new GodotGlowPass(effect, effect.glow, scene);
  const ambientOcclusion =
    effect.ambientOcclusion === undefined
      ? undefined
      : new GodotAmbientOcclusionPass(effect.ambientOcclusion);
  const tonemap = new ShaderPass(tonemapMaterial, 'tDiffuse');
  if (effect.adjustments !== undefined) {
    const runtime = new GodotAdjustmentUniformRuntime(tonemapMaterial, effect.adjustments);
    const unbind = bindEnvironmentAdjustmentRuntime(scene, runtime);
    tonemapMaterial.addEventListener('dispose', unbind);
  }
  if (depthOfField !== undefined && effect.depthOfField?.dialect === 'godot-3') {
    depthOfField.bindEnvironmentRelease(bindEnvironmentDepthOfFieldRuntime(scene, depthOfField));
  }
  if (ambientOcclusion !== undefined) {
    ambientOcclusion.bindEnvironmentRelease(bindEnvironmentSsaoRuntime(scene, ambientOcclusion));
  }
  if (autoExposure !== undefined) {
    autoExposure.bindExposureTexture(
      tonemapMaterial.uniforms['autoExposureTexture'] as { value: Texture | null },
    );
    glow?.bindAutoExposure(autoExposure);
  }
  composer.addPass(render);
  if (fog !== undefined) composer.addPass(fog);
  if (depthOfField !== undefined) composer.addPass(depthOfField);
  if (autoExposure !== undefined) composer.addPass(autoExposure);
  if (glow !== undefined) composer.addPass(glow);
  if (ambientOcclusion !== undefined) composer.addPass(ambientOcclusion);
  composer.addPass(tonemap);
  const passes: Pass[] = [render];
  if (fog !== undefined) passes.push(fog);
  if (depthOfField !== undefined) passes.push(depthOfField);
  if (autoExposure !== undefined) passes.push(autoExposure);
  if (glow !== undefined) passes.push(glow);
  if (ambientOcclusion !== undefined) passes.push(ambientOcclusion);
  passes.push(tonemap);
  return passes;
}
