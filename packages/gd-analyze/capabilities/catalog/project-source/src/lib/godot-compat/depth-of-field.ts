/**
 * Godot's depth-of-field passes, transcribed from the pinned 3.6 GLES3 separable blur and 4.7
 * compute/raster bokeh implementations. The pass owns only native Three render targets/materials; authored
 * resource values are resolved by gd-analyze before construction.
 */
import {
  HalfFloatType,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { Pass } from 'postprocessing';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export type GodotDepthOfFieldConfig =
  | {
      readonly dialect: 'godot-3';
      readonly farEnabled: boolean;
      readonly farDistance: number;
      readonly farTransition: number;
      readonly farAmount: number;
      readonly farQuality: 0 | 1 | 2;
      readonly nearEnabled: boolean;
      readonly nearDistance: number;
      readonly nearTransition: number;
      readonly nearAmount: number;
      readonly nearQuality: 0 | 1 | 2;
    }
  | {
      readonly dialect: 'godot-4';
      readonly farEnabled: boolean;
      readonly farDistance: number;
      readonly farTransition: number;
      readonly nearEnabled: boolean;
      readonly nearDistance: number;
      readonly nearTransition: number;
      readonly amount: number;
      /** 0 BOX, 1 HEXAGON, 2 CIRCLE. */
      readonly shape: 0 | 1 | 2;
      /** 0 VERY_LOW, 1 LOW, 2 MEDIUM, 3 HIGH. */
      readonly quality: 0 | 1 | 2 | 3;
      readonly rendererPath: 'compute' | 'raster';
    };

const FULLSCREEN_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const LINEAR_DEPTH = `
float linearDepth(float storedDepth) {
  float depth = storedDepth * 2.0 - 1.0;
  if (orthogonal) {
    return cameraNear + storedDepth * (cameraFar - cameraNear);
  }
  return 2.0 * cameraNear * cameraFar /
    (cameraFar + cameraNear - depth * (cameraFar - cameraNear));
}
`;

const GODOT4_WEIGHT_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform bool orthogonal;
uniform bool farEnabled;
uniform float farBegin;
uniform float farEnd;
uniform bool farPhysical;
uniform float farBlurSize;
uniform bool nearEnabled;
uniform float nearBegin;
uniform float nearEnd;
uniform bool nearPhysical;
uniform float nearBlurSize;
uniform float blurSize;
varying vec2 vUv;
${LINEAR_DEPTH}
float getBlurSize(float depth) {
  if (nearEnabled && depth < nearBegin) {
    if (nearPhysical) {
      float d = abs(nearBegin - depth);
      return -(d / (nearBegin - d)) * nearBlurSize;
    }
    return -(1.0 - smoothstep(nearEnd, nearBegin, depth)) * blurSize;
  }
  if (farEnabled && depth > farBegin) {
    if (farPhysical) {
      float d = abs(farBegin - depth);
      return (d / (farBegin + d)) * farBlurSize;
    }
    return smoothstep(farBegin, farEnd, depth) * blurSize;
  }
  return 0.0;
}
void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  color.a = getBlurSize(linearDepth(texture2D(tDepth, vUv).r));
  gl_FragColor = color;
}
`;

const GODOT4_BOKEH_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tWeight;
uniform vec2 targetSize;
uniform float blurSize;
uniform float blurScale;
uniform int blurSteps;
uniform int shape;
uniform bool secondPass;
uniform bool halfSize;
uniform bool weightOutput;
uniform bool computePath;
uniform bool useJitter;
uniform float jitterSeed;
varying vec2 vUv;
const float GOLDEN_ANGLE = 2.39996323;
float hash12n(vec2 p) {
  p = fract(p * vec2(5.3987, 5.4421));
  p += dot(p.yx, p.xy + vec2(21.5351, 14.3137));
  return fract(p.x * p.y * 95.4307);
}
vec4 sampleColor(vec2 uv) {
  vec4 color = texture2D(tDiffuse, uv);
  color.a = texture2D(tWeight, uv).a;
  return color;
}
vec4 weightedFilter(vec2 direction, vec2 uv, vec2 pixelSize) {
  direction *= pixelSize;
  vec4 center = sampleColor(uv);
  vec4 accum = center;
  float total = 1.0;
  float stepScale = blurSize / float(blurSteps);
  if (useJitter) uv += direction * (hash12n(uv + jitterSeed) - 0.5);
  for (int index = -24; index <= 24; index += 1) {
    if (index == 0 || abs(index) > blurSteps) continue;
    float radius = float(index) * stepScale;
    vec4 sampleValue = sampleColor(uv + direction * radius);
    float limit = sampleValue.a < center.a ? abs(sampleValue.a) : abs(center.a);
    float influence = smoothstep(abs(radius) - 0.5, abs(radius) + 0.5, limit);
    accum += mix(center, sampleValue, influence);
    total += 1.0;
  }
  return accum / total;
}
void main() {
  vec2 pixelSize = 1.0 / targetSize;
  vec2 uv = vUv;
  if (shape == 2) {
    if (halfSize) pixelSize *= 0.5;
    uv += pixelSize * 0.5;
    float sourceAlpha = texture2D(tDiffuse, uv).a;
    vec4 center = sampleColor(uv);
    vec4 accum = center;
    float total = 1.0;
    float radius = blurScale;
    for (int index = 0; index < 4096; index += 1) {
      if (radius >= blurSize) break;
      float angle = float(index) * GOLDEN_ANGLE;
      vec4 sampleValue = sampleColor(uv + vec2(cos(angle), sin(angle)) * pixelSize * radius);
      float limit = abs(sampleValue.a);
      if (sampleValue.a > center.a) limit = clamp(limit, 0.0, abs(center.a) * 2.0);
      float influence = smoothstep(radius - 0.5, radius + 0.5, limit);
      accum += mix(accum / total, sampleValue, influence);
      total += 1.0;
      radius += blurScale / radius;
    }
    vec4 color = accum / total;
    gl_FragColor = weightOutput
      ? vec4(color.a)
      : vec4(color.rgb, computePath ? color.a : sourceAlpha);
    return;
  }
  uv += pixelSize * (secondPass || !halfSize ? 0.5 : 0.25);
  vec2 direction = shape == 0
    ? (secondPass ? vec2(0.0, 1.0) : vec2(1.0, 0.0))
    : (secondPass ? normalize(vec2(1.0, 0.577350269189626)) : vec2(0.0, 1.0));
  vec4 color = weightedFilter(direction, uv, pixelSize);
  if (shape == 1 && secondPass) {
    vec4 second = weightedFilter(normalize(vec2(-1.0, 0.577350269189626)), uv, pixelSize);
    color.rgb = min(color.rgb, second.rgb);
    color.a = (color.a + second.a) * 0.5;
  }
  float sourceAlpha = texture2D(tDiffuse, uv).a;
  gl_FragColor = weightOutput
    ? vec4(color.a)
    : vec4(color.rgb, computePath ? color.a : sourceAlpha);
}
`;

const GODOT4_COMPOSITE_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tBlurred;
uniform sampler2D tWeight;
uniform sampler2D tOriginalWeight;
uniform bool computePath;
varying vec2 vUv;
void main() {
  vec4 original = texture2D(tDiffuse, vUv);
  vec4 blurred = texture2D(tBlurred, vUv);
  float centerWeight = texture2D(tWeight, vUv).r;
  float sampleWeight = texture2D(tOriginalWeight, vUv).r;
  float mixAmount;
  if (computePath) {
    mixAmount = centerWeight < sampleWeight
      ? clamp(max(abs(centerWeight), abs(sampleWeight)), 0.0, 1.0)
      : clamp(abs(sampleWeight), 0.0, 1.0);
  } else {
    mixAmount = sampleWeight < centerWeight
      ? clamp(max(abs(centerWeight), abs(sampleWeight)), 0.0, 1.0)
      : clamp(abs(centerWeight), 0.0, 1.0);
  }
  gl_FragColor = vec4(mix(original.rgb, blurred.rgb, mixAmount),
    computePath ? 0.0 : mixAmount * mixAmount + original.a * (1.0 - mixAmount));
}
`;

const GODOT3_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tOriginal;
uniform float cameraNear;
uniform float cameraFar;
uniform bool orthogonal;
uniform int mode;
uniform float dofBegin;
uniform float dofEnd;
uniform vec2 dofDirection;
uniform float dofRadius;
uniform int kernelSize;
uniform int kernelFrom;
uniform float kernel[21];
varying vec2 vUv;
${LINEAR_DEPTH}
void main() {
  vec4 colorAccum = vec4(0.0);
  vec4 weightAccum = vec4(0.0);
  float maxAccum = 0.0;
  float centerAmount = smoothstep(dofBegin, dofEnd, linearDepth(texture2D(tDepth, vUv).r));
  for (int index = 0; index < 21; index += 1) {
    if (index >= kernelSize) break;
    int integerOffset = index - kernelFrom;
    vec2 tapUv = vUv + dofDirection * float(integerOffset) *
      (mode == 0 ? centerAmount : 1.0) * dofRadius;
    float tapKernel = kernel[index];
    vec4 tapColor = texture2D(tDiffuse, tapUv);
    float tapDepth = linearDepth(texture2D(tDepth, tapUv).r);
    if (mode == 0) {
      float tapAmount = integerOffset == 0 ? 1.0 : smoothstep(dofBegin, dofEnd, tapDepth);
      tapAmount *= tapAmount * tapAmount * tapKernel;
      vec4 weight = vec4(tapAmount) * vec4(vec3(tapColor.a), 1.0);
      weightAccum += weight;
      colorAccum += tapColor * weight;
    } else {
      float influence = max(0.0, 1.0 - float(abs(integerOffset)) / float(kernelFrom));
      float tapAmount = 1.0 - smoothstep(dofEnd, dofBegin, tapDepth);
      tapAmount *= tapAmount * tapAmount;
      if (mode == 1) tapColor.a = 1.0 - smoothstep(dofEnd, dofBegin, tapDepth);
      maxAccum = max(maxAccum, tapAmount * influence);
      colorAccum += tapColor * tapKernel;
    }
  }
  if (mode == 0) {
    if (weightAccum.r > 0.0) colorAccum /= weightAccum;
    gl_FragColor = colorAccum;
    return;
  }
  colorAccum.a = max(colorAccum.a, sqrt(maxAccum));
  if (mode == 2) {
    vec4 original = texture2D(tOriginal, vUv);
    colorAccum = mix(original, colorAccum, colorAccum.a);
  } else if (mode == 3) {
    vec4 original = texture2D(tOriginal, vUv);
    colorAccum = vec4(mix(original.rgb, colorAccum.rgb, colorAccum.a), original.a);
  }
  gl_FragColor = colorAccum;
}
`;

const GODOT3_KERNELS: readonly (readonly number[])[] = [
  [0.153388, 0.221461, 0.250301, 0.221461, 0.153388],
  [0.055037, 0.072806, 0.090506, 0.105726, 0.116061, 0.119726, 0.116061, 0.105726, 0.090506, 0.072806, 0.055037],
  [0.028174, 0.032676, 0.037311, 0.041944, 0.046421, 0.050582, 0.054261, 0.057307, 0.059587, 0.060998, 0.061476, 0.060998, 0.059587, 0.057307, 0.054261, 0.050582, 0.046421, 0.041944, 0.037311, 0.032676, 0.028174],
];

/** Native postprocessing Pass implementing the source engine's exact DOF branch. */
export class GodotDepthOfFieldPass extends Pass {
  private readonly quad: FullScreenQuad;
  private readonly weight: ShaderMaterial;
  private readonly bokeh: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly gaussian: ShaderMaterial;
  private readonly fullA = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly fullB = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly fullWeightB = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly halfA = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly halfB = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly halfWeightA = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly halfWeightB = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly sizedFor = new Vector2();
  private depthTexture: Texture | null = null;
  private releaseEnvironment: (() => void) | undefined;

  constructor(
    private readonly renderCamera: Camera,
    private config: GodotDepthOfFieldConfig,
  ) {
    super('GodotDepthOfField');
    this.needsSwap = true;
    this.needsDepthTexture = true;
    this.weight = new ShaderMaterial({
      name: 'Godot4DofWeight',
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, cameraNear: { value: 0.05 },
        cameraFar: { value: 4000 }, orthogonal: { value: false }, farEnabled: { value: false },
        farBegin: { value: 10 }, farEnd: { value: 15 }, farPhysical: { value: false },
        farBlurSize: { value: 6.4 }, nearEnabled: { value: false }, nearBegin: { value: 2 },
        nearEnd: { value: 1 }, nearPhysical: { value: false }, nearBlurSize: { value: 6.4 },
        blurSize: { value: 6.4 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: GODOT4_WEIGHT_FRAGMENT,
    });
    this.bokeh = new ShaderMaterial({
      name: 'Godot4BokehDof',
      uniforms: {
        tDiffuse: { value: null }, tWeight: { value: null }, targetSize: { value: new Vector2(1, 1) },
        blurSize: { value: 1 }, blurScale: { value: 0.5 }, blurSteps: { value: 6 }, shape: { value: 0 },
        secondPass: { value: false }, halfSize: { value: false }, weightOutput: { value: false },
        computePath: { value: false },
        useJitter: { value: false }, jitterSeed: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: GODOT4_BOKEH_FRAGMENT,
    });
    this.composite = new ShaderMaterial({
      name: 'Godot4BokehComposite',
      uniforms: {
        tDiffuse: { value: null },
        tBlurred: { value: null },
        tWeight: { value: null },
        tOriginalWeight: { value: null },
        computePath: { value: false },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: GODOT4_COMPOSITE_FRAGMENT,
    });
    this.gaussian = new ShaderMaterial({
      name: 'Godot3DepthOfField',
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null }, tOriginal: { value: null },
        cameraNear: { value: 0.05 }, cameraFar: { value: 4000 }, orthogonal: { value: false },
        mode: { value: 0 }, dofBegin: { value: 10 }, dofEnd: { value: 15 },
        dofDirection: { value: new Vector2(1, 0) }, dofRadius: { value: 0.01 },
        kernelSize: { value: 5 }, kernelFrom: { value: 2 }, kernel: { value: [...GODOT3_KERNELS[0]!] },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: GODOT3_FRAGMENT,
    });
    this.quad = new FullScreenQuad(this.weight);
  }

  /** Mutate the same Godot 3 configuration the native pass consumes on its next render. */
  getGodot3Config(): Readonly<Extract<GodotDepthOfFieldConfig, { dialect: 'godot-3' }>> {
    if (this.config.dialect !== 'godot-3') {
      throw new Error('Godot 3 Environment DOF cannot mutate a Godot 4 CameraAttributes pass.');
    }
    return this.config;
  }

  setGodot3Config(
    patch: Partial<Omit<Extract<GodotDepthOfFieldConfig, { dialect: 'godot-3' }>, 'dialect'>>,
  ): void {
    const current = this.getGodot3Config();
    this.config = { ...current, ...patch };
  }

  bindEnvironmentRelease(release: () => void): void {
    this.releaseEnvironment?.();
    this.releaseEnvironment = release;
  }

  setDepthTexture(texture: Texture | null): void {
    this.depthTexture = texture;
    this.weight.uniforms['tDepth']!.value = texture;
    this.gaussian.uniforms['tDepth']!.value = texture;
  }

  getDepthTexture(): Texture {
    return this.depthTexture as Texture;
  }

  private resize(width: number, height: number): void {
    if (this.sizedFor.x === width && this.sizedFor.y === height) return;
    this.sizedFor.set(width, height);
    this.fullA.setSize(width, height);
    this.fullB.setSize(width, height);
    this.fullWeightB.setSize(width, height);
    const halfWidth = Math.max(1, width >> 1);
    const halfHeight = Math.max(1, height >> 1);
    this.halfA.setSize(halfWidth, halfHeight);
    this.halfB.setSize(halfWidth, halfHeight);
    this.halfWeightA.setSize(halfWidth, halfHeight);
    this.halfWeightB.setSize(halfWidth, halfHeight);
  }

  setSize(): void {
    this.sizedFor.set(0, 0);
  }

  private updateCamera(material: ShaderMaterial): void {
    const near =
      'near' in this.renderCamera && typeof this.renderCamera.near === 'number'
        ? this.renderCamera.near
        : 0.05;
    const far =
      'far' in this.renderCamera && typeof this.renderCamera.far === 'number'
        ? this.renderCamera.far
        : 4000;
    material.uniforms['cameraNear']!.value = near;
    material.uniforms['cameraFar']!.value = far;
    material.uniforms['orthogonal']!.value =
      'isOrthographicCamera' in this.renderCamera &&
      this.renderCamera.isOrthographicCamera === true;
  }

  private draw(renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  /**
   * Godot's raster path writes retained color alpha and blur weight to separate MRT attachments.
   * Repeating the deterministic fragment invocation keeps those channels separate on WebGL hosts
   * without requiring a renderer-owned MRT target.
   */
  private drawGodot4Bokeh(
    renderer: WebGLRenderer,
    colorTarget: WebGLRenderTarget | null,
    weightTarget?: WebGLRenderTarget,
  ): void {
    this.bokeh.uniforms['weightOutput']!.value = false;
    this.draw(renderer, this.bokeh, colorTarget);
    if (weightTarget !== undefined) {
      this.bokeh.uniforms['weightOutput']!.value = true;
      this.draw(renderer, this.bokeh, weightTarget);
    }
  }

  private renderGodot4(
    renderer: WebGLRenderer,
    input: WebGLRenderTarget,
    output: WebGLRenderTarget | null,
    width: number,
    height: number,
    config: Extract<GodotDepthOfFieldConfig, { dialect: 'godot-4' }>,
  ): void {
    const blurSize = config.amount * 64;
    const computePath = config.rendererPath === 'compute';
    const weight = this.weight.uniforms;
    weight['tDiffuse']!.value = input.texture;
    this.updateCamera(this.weight);
    weight['farEnabled']!.value = config.farEnabled;
    weight['farBegin']!.value = config.farDistance;
    weight['farEnd']!.value = config.farDistance + config.farTransition;
    weight['farPhysical']!.value = computePath && config.farTransition < 0;
    weight['farBlurSize']!.value = computePath ? blurSize : 0;
    weight['nearEnabled']!.value = config.nearEnabled;
    weight['nearBegin']!.value = config.nearDistance;
    weight['nearEnd']!.value = config.nearDistance - config.nearTransition;
    weight['nearPhysical']!.value = computePath && config.nearTransition < 0;
    weight['nearBlurSize']!.value = computePath ? blurSize : 0;
    weight['blurSize']!.value =
      computePath && config.nearTransition < 0 && config.farTransition < 0 ? 32 : blurSize;
    this.draw(renderer, this.weight, this.fullA);

    const bokeh = this.bokeh.uniforms;
    bokeh['shape']!.value = config.shape;
    bokeh['computePath']!.value = computePath;
    // Raster zeroes these push constants; Forward+ compute reads the setting and a fresh randf.
    bokeh['useJitter']!.value = false;
    bokeh['jitterSeed']!.value = 0;
    bokeh['tDiffuse']!.value = input.texture;
    bokeh['tWeight']!.value = this.fullA.texture;
    if (config.shape === 2) {
      bokeh['targetSize']!.value = new Vector2(Math.max(1, width >> 1), Math.max(1, height >> 1));
      bokeh['blurSize']!.value = blurSize;
      bokeh['blurScale']!.value = [8, 4, 1, 0.5][config.quality]!;
      bokeh['halfSize']!.value = true;
      bokeh['secondPass']!.value = false;
      this.drawGodot4Bokeh(renderer, this.halfA, this.halfWeightA);
      this.renderGodot4Composite(
        renderer,
        input.texture,
        this.halfA.texture,
        this.halfWeightA.texture,
        output,
      );
      return;
    }
    const half = config.quality <= 1;
    const targetSize = half
      ? new Vector2(Math.max(1, width >> 1), Math.max(1, height >> 1))
      : new Vector2(width, height);
    bokeh['targetSize']!.value = targetSize;
    bokeh['blurSize']!.value = half ? blurSize * 0.5 : blurSize;
    bokeh['blurScale']!.value = 0.5;
    bokeh['blurSteps']!.value = [6, 12, 12, 24][config.quality]!;
    bokeh['halfSize']!.value = half;
    bokeh['secondPass']!.value = false;
    this.drawGodot4Bokeh(
      renderer,
      half ? this.halfA : this.fullB,
      half ? this.halfWeightA : this.fullWeightB,
    );
    bokeh['tDiffuse']!.value = half ? this.halfA.texture : this.fullB.texture;
    bokeh['tWeight']!.value = half ? this.halfWeightA.texture : this.fullWeightB.texture;
    bokeh['secondPass']!.value = true;
    if (half) {
      this.drawGodot4Bokeh(renderer, this.halfB, this.halfWeightB);
      this.renderGodot4Composite(
        renderer,
        input.texture,
        this.halfB.texture,
        this.halfWeightB.texture,
        output,
      );
    } else {
      this.drawGodot4Bokeh(renderer, output);
    }
  }

  private renderGodot4Composite(
    renderer: WebGLRenderer,
    original: Texture,
    blurred: Texture,
    blurredWeight: Texture,
    output: WebGLRenderTarget | null,
  ): void {
    this.composite.uniforms['tDiffuse']!.value = original;
    this.composite.uniforms['tBlurred']!.value = blurred;
    this.composite.uniforms['tWeight']!.value = blurredWeight;
    this.composite.uniforms['tOriginalWeight']!.value = this.fullA.texture;
    this.composite.uniforms['computePath']!.value =
      this.config.dialect === 'godot-4' && this.config.rendererPath === 'compute';
    this.draw(renderer, this.composite, output);
  }

  private setGodot3Kernel(quality: 0 | 1 | 2): void {
    const kernel = GODOT3_KERNELS[quality]!;
    this.gaussian.uniforms['kernel']!.value = [...kernel, ...Array(21 - kernel.length).fill(0)];
    this.gaussian.uniforms['kernelSize']!.value = kernel.length;
    this.gaussian.uniforms['kernelFrom']!.value = (kernel.length - 1) / 2;
  }

  private renderGodot3(
    renderer: WebGLRenderer,
    input: WebGLRenderTarget,
    output: WebGLRenderTarget | null,
    config: Extract<GodotDepthOfFieldConfig, { dialect: 'godot-3' }>,
  ): void {
    this.updateCamera(this.gaussian);
    const uniforms = this.gaussian.uniforms;
    let source: Texture = input.texture;
    if (config.farEnabled) {
      this.setGodot3Kernel(config.farQuality);
      uniforms['mode']!.value = 0;
      uniforms['dofBegin']!.value = config.farDistance;
      uniforms['dofEnd']!.value = config.farDistance + config.farTransition;
      uniforms['dofRadius']!.value = (config.farAmount * config.farAmount) / [4, 10, 20][config.farQuality]!;
      uniforms['tDiffuse']!.value = source;
      (uniforms['dofDirection']!.value as Vector2).set(1, 0);
      this.draw(renderer, this.gaussian, this.fullA);
      uniforms['tDiffuse']!.value = this.fullA.texture;
      (uniforms['dofDirection']!.value as Vector2).set(0, 1);
      this.draw(renderer, this.gaussian, config.nearEnabled ? this.fullB : output);
      if (!config.nearEnabled) return;
      source = this.fullB.texture;
    }
    if (config.nearEnabled) {
      this.setGodot3Kernel(config.nearQuality);
      uniforms['dofBegin']!.value = config.nearDistance;
      uniforms['dofEnd']!.value = config.nearDistance - config.nearTransition;
      uniforms['dofRadius']!.value = (config.nearAmount * config.nearAmount) / [4, 10, 20][config.nearQuality]!;
      uniforms['mode']!.value = 1;
      uniforms['tDiffuse']!.value = source;
      (uniforms['dofDirection']!.value as Vector2).set(1, 0);
      this.draw(renderer, this.gaussian, this.fullA);
      uniforms['mode']!.value = config.farEnabled ? 3 : 2;
      uniforms['tDiffuse']!.value = this.fullA.texture;
      uniforms['tOriginal']!.value = source;
      (uniforms['dofDirection']!.value as Vector2).set(0, 1);
      this.draw(renderer, this.gaussian, output);
      return;
    }
    throw new Error('Godot depth of field requires an enabled near or far branch.');
  }

  render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    outputBuffer: WebGLRenderTarget | null,
  ): void {
    if (inputBuffer === null) throw new Error('Godot depth of field requires a composer input buffer.');
    const previousTarget = renderer.getRenderTarget();
    this.resize(inputBuffer.width, inputBuffer.height);
    const output = this.renderToScreen ? null : outputBuffer;
    try {
      if (this.config.dialect === 'godot-4') {
        this.renderGodot4(
          renderer,
          inputBuffer,
          output,
          inputBuffer.width,
          inputBuffer.height,
          this.config,
        );
      } else {
        this.renderGodot3(renderer, inputBuffer, output, this.config);
      }
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose(): void {
    this.releaseEnvironment?.();
    this.releaseEnvironment = undefined;
    this.fullA.dispose();
    this.fullB.dispose();
    this.fullWeightB.dispose();
    this.halfA.dispose();
    this.halfB.dispose();
    this.halfWeightA.dispose();
    this.halfWeightB.dispose();
    this.weight.dispose();
    this.bokeh.dispose();
    this.composite.dispose();
    this.gaussian.dispose();
    this.quad.dispose();
  }
}
