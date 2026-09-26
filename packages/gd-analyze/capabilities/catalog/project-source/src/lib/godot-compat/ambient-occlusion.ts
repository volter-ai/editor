/**
 * Godot screen-space ambient occlusion passes.
 *
 * Godot 4's Compatibility renderer runs S4AO in the final post copy. This is a direct fragment
 * transcription of `drivers/gles3/shaders/s4ao_{micro,inc,mega}_inc.glsl` at 4.7-stable. Godot's
 * Compatibility renderer uses reversed-Z (clear 0, GEQUAL), while Three's WebGL renderer stores
 * standard depth (clear 1, LEQUAL); `godotDepth` performs that representation conversion once.
 * The equations, quality kernels and source ordering are otherwise unchanged.
 */
import {
  NoColorSpace,
  ShaderMaterial,
  Vector2,
  type IUniform,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { Pass } from 'postprocessing';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export interface GodotCompatibilitySsaoConfig {
  readonly dialect: 'godot-4-compatibility';
  /** Environment.ssao_radius. Compatibility uploads this as radius * 0.5. */
  readonly radius: number;
  /** Environment.ssao_intensity. Compatibility uploads this as intensity * 2. */
  readonly intensity: number;
  /** 0 VERY_LOW, 1 LOW, 2 MEDIUM, 3 HIGH, 4 ULTRA. */
  readonly quality: 0 | 1 | 2 | 3 | 4;
}

export type GodotAmbientOcclusionConfig = GodotCompatibilitySsaoConfig;

type GodotAmbientOcclusionUniforms = {
  readonly tDiffuse: IUniform<Texture | null>;
  readonly tDepth: IUniform<Texture | null>;
  readonly sourceSize: IUniform<Vector2>;
  readonly radiusFraction: IUniform<number>;
  readonly intensity: IUniform<number>;
  readonly quality: IUniform<number>;
};

const FULLSCREEN_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const S4AO_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 sourceSize;
uniform float radiusFraction;
uniform float intensity;
uniform int quality;
varying vec2 vUv;

const float PHI = 1.6180339887498948482;
const float SSAO_FALLOFF_FRAC = 0.25;

// Godot Compatibility stores reversed depth and Three WebGL stores standard depth. S4AO operates
// directly on Godot's stored value, so invert Three's representation before every source use.
float godotDepth(vec2 uv) {
  return 1.0 - texture2D(tDepth, uv).r;
}

float randomValue(vec2 uv) {
  vec2 prnUv = vec2(
    sourceSize.x * 1.087 * PHI,
    sourceSize.y * 1.087 * ((9.0 + sqrt(221.0)) / 10.0)
  );
  return fract(dot(uv, prnUv));
}

// \`s4ao_micro_inc.glsl\`: VERY_LOW, two balanced samples around the center.
float s4aoMicro(vec2 uv) {
  float depth = godotDepth(uv);
  float invFalloff = 1.0 / max(1e-4, depth * SSAO_FALLOFF_FRAC);
  float r01 = randomValue(uv);
  vec2 duv = vec2(r01 - 0.5, 2.0 * (r01 - r01 * r01)) *
    (2.0 * depth * radiusFraction);
  float occlusion = 0.0;
  for (int sampleIndex = 0; sampleIndex < 2; sampleIndex += 1) {
    float dz = godotDepth(uv + duv) - depth;
    occlusion += normalize(vec3(duv, dz)).z * mix(1.0, 0.0, dz * invFalloff);
    duv = -duv;
  }
  occlusion = 1.0 - clamp(occlusion * 0.5 * intensity, 0.0, 1.0);
  return occlusion * occlusion;
}

// \`s4ao_inc.glsl\`: LOW/MEDIUM use the same notched grid with a 2x2/4x4 kernel.
float s4aoGrid(vec2 uv, int sampleWidth) {
  float depth = godotDepth(uv);
  float radius = max(1e-4, depth * radiusFraction);
  float invFalloff = 1.0 / max(1e-4, depth * SSAO_FALLOFF_FRAC);
  float sampleMid = (float(sampleWidth) - 1.0) * 0.50001;
  float invHalfWidth = sampleWidth == 2 ? 1.0 / sampleMid : 1.7 / sampleMid;
  float notch = sampleWidth > 3 ? 1.0 : 0.0;
  float sampleCount = float(sampleWidth * sampleWidth) - 4.0 * notch;
  vec2 rcos = (invHalfWidth * radius) * vec2(0.5, randomValue(uv) - 0.5);
  vec2 rsin = rcos.yx * vec2(-1.0, 1.0);
  float occlusion = 0.0;
  vec2 baseDuv = -sampleMid * rsin;
  for (int row = 0; row < 4; row += 1) {
    if (row >= sampleWidth) break;
    int omitted = sampleWidth > 3 && (row == 0 || row == sampleWidth - 1) ? 1 : 0;
    vec2 duv = (float(omitted) - sampleMid) * rcos + baseDuv;
    for (int column = 0; column < 4; column += 1) {
      if (column >= sampleWidth - omitted - omitted) break;
      float dz = godotDepth(uv + duv) - depth;
      float validity = smoothstep(1.0, 0.0, dz * invFalloff);
      occlusion += normalize(vec3(duv, dz)).z * validity;
      duv += rcos;
    }
    baseDuv += rsin;
  }
  occlusion *= intensity / sampleCount;
  occlusion = clamp(1.0 - occlusion, 0.0, 1.0);
  return occlusion * occlusion;
}

// \`s4ao_mega_inc.glsl\`: HIGH/ULTRA use three/four concentric sample rings.
float s4aoRings(vec2 uv, bool mega) {
  float depth = godotDepth(uv);
  float invFalloff = 1.0 / max(1e-4, depth * SSAO_FALLOFF_FRAC);
  float r01 = randomValue(uv);
  vec2 rcos = vec2(r01 - 0.5, 2.0 * (r01 - r01 * r01)) *
    (2.0 * depth * radiusFraction);
  vec2 rsin = rcos.yx * vec2(-1.0, 1.0);
  float occlusion = 0.0;
  float ringShrink = 0.75;
  int ringCount = mega ? 4 : 3;
  float sampleCount = mega ? 60.0 : 30.0;
  for (int ring = 0; ring < 4; ring += 1) {
    if (ring >= ringCount) break;
    int samples = mega
      ? (ring == 0 ? 24 : ring == 1 ? 18 : ring == 2 ? 12 : 6)
      : (ring == 0 ? 15 : ring == 1 ? 10 : ring == 2 ? 5 : 1);
    float stepAngle = 6.283185307 / float(samples);
    float angle = float(ring - (ring / 2) * 2) * 0.5 * stepAngle;
    for (int sampleIndex = 0; sampleIndex < 24; sampleIndex += 1) {
      if (sampleIndex >= samples) break;
      vec2 duv = cos(angle) * rcos + sin(angle) * rsin;
      float dz = godotDepth(uv + duv) - depth;
      occlusion += normalize(vec3(duv, dz)).z *
        smoothstep(1.0, 0.0, dz * invFalloff);
      angle += stepAngle;
    }
    rcos *= ringShrink;
    rsin *= ringShrink;
  }
  occlusion *= intensity / sampleCount;
  occlusion = 1.0 - clamp(occlusion, 0.0, 1.0);
  return occlusion * occlusion;
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  float ao = quality == 0
    ? s4aoMicro(vUv)
    : quality == 1
      ? s4aoGrid(vUv, 2)
      : quality == 2
        ? s4aoGrid(vUv, 4)
        : s4aoRings(vUv, quality == 4);
  // Compatibility applies S4AO in linear space after glow and before tone mapping.
  gl_FragColor = vec4(color.rgb * ao, color.a);
}
`;

export class GodotAmbientOcclusionPass extends Pass {
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly uniforms: GodotAmbientOcclusionUniforms;
  private depthTexture: Texture | null = null;
  private releaseEnvironment: (() => void) | null = null;

  constructor(config: GodotAmbientOcclusionConfig) {
    super('GodotAmbientOcclusion');
    if (!Number.isFinite(config.radius) || !Number.isFinite(config.intensity)) {
      throw new Error(
        `Godot Compatibility S4AO requires finite radius/intensity; received ${config.radius}/${config.intensity}.`,
      );
    }
    if (!Number.isInteger(config.quality) || config.quality < 0 || config.quality > 4) {
      throw new Error(
        `Godot Compatibility S4AO quality must be an integer from 0 through 4; received ${config.quality}.`,
      );
    }
    this.needsSwap = true;
    this.needsDepthTexture = true;
    this.uniforms = {
      tDiffuse: { value: null },
      tDepth: { value: null },
      sourceSize: { value: new Vector2(1, 1) },
      radiusFraction: { value: config.radius * 0.5 },
      intensity: { value: config.intensity * 2.0 },
      quality: { value: config.quality },
    };
    this.material = new ShaderMaterial({
      name: 'GodotCompatibilityS4AO',
      uniforms: this.uniforms,
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: S4AO_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  bindEnvironmentRelease(release: () => void): void {
    this.releaseEnvironment?.();
    this.releaseEnvironment = release;
  }

  isSsaoEnabled(): boolean {
    return this.enabled;
  }

  setSsaoEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getSsaoRadius(): number {
    return this.uniforms['radiusFraction'].value * 2;
  }

  setSsaoRadius(radius: number): void {
    if (!Number.isFinite(radius) || radius < 0) {
      throw new RangeError('Environment.ssao_radius requires a finite non-negative float.');
    }
    this.uniforms['radiusFraction'].value = radius * 0.5;
  }

  getSsaoIntensity(): number {
    return this.uniforms['intensity'].value * 0.5;
  }

  setSsaoIntensity(intensity: number): void {
    if (!Number.isFinite(intensity) || intensity < 0) {
      throw new RangeError('Environment.ssao_intensity requires a finite non-negative float.');
    }
    this.uniforms['intensity'].value = intensity * 2;
  }

  getSsaoQuality(): number {
    return this.uniforms['quality'].value;
  }

  setSsaoQuality(quality: number): void {
    if (!Number.isInteger(quality) || quality < 0 || quality > 4) {
      throw new RangeError('Environment.ssao_quality requires an integer from 0 through 4.');
    }
    this.uniforms['quality'].value = quality;
  }

  setDepthTexture(depthTexture: Texture): void {
    this.depthTexture = depthTexture;
    this.uniforms['tDepth'].value = depthTexture;
  }

  getDepthTexture(): Texture {
    if (this.depthTexture === null) {
      throw new Error('Godot ambient occlusion has not received the composer depth texture.');
    }
    return this.depthTexture;
  }

  render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
  ): void {
    if (inputBuffer === null) {
      throw new Error('Godot ambient occlusion requires a composer input buffer.');
    }
    if (this.depthTexture === null) {
      throw new Error('Godot ambient occlusion requires the composer depth texture.');
    }
    if (!this.renderToScreen && outputBuffer === null) {
      throw new Error('Godot ambient occlusion requires a composer output buffer.');
    }
    // Three's WebGLRenderer selects LinearSRGBColorSpace (identity output transfer) whenever the
    // current target is a non-XR WebGLRenderTarget; EffectComposer's target texture is separately
    // NoColorSpace (identity sample transfer). RenderPass/glow therefore leave this buffer in
    // linear scene color and the final Godot tone/output pass performs the one output conversion.
    // Godot Compatibility explicitly calls srgb_to_linear immediately before S4AO because its
    // own main framebuffer is nonlinear; multiplying a color-tagged Three target here would apply
    // the source conversion zero or two times, so reject that topology rather than silently drift.
    if (inputBuffer.texture.colorSpace !== NoColorSpace) {
      throw new Error(
        `Godot Compatibility S4AO requires a linear composer target; received colorSpace=${inputBuffer.texture.colorSpace}.`,
      );
    }
    const previousTarget = renderer.getRenderTarget();
    this.uniforms['tDiffuse'].value = inputBuffer.texture;
    this.uniforms['sourceSize'].value.set(inputBuffer.width, inputBuffer.height);
    try {
      renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose(): void {
    this.releaseEnvironment?.();
    this.releaseEnvironment = null;
    this.depthTexture = null;
    this.uniforms['tDepth'].value = null;
    this.uniforms['tDiffuse'].value = null;
    this.material.dispose();
    this.quad.dispose();
  }
}
