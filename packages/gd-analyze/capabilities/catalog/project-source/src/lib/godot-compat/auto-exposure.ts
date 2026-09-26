/**
 * Godot 4.7 RD auto exposure, transcribed from `luminance_reduce.glsl`,
 * `luminance_reduce_raster.glsl`, and `renderer_scene_render_rd.cpp`.
 *
 * This is a native composer pass: it observes the current linear scene-color target, owns the
 * same retained one-pixel luminance state as Godot's RenderSceneBuffers, and leaves the composer's
 * color buffer untouched for the following glow/tonemap passes.
 */
import {
  FloatType,
  NoColorSpace,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { Pass } from 'postprocessing';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export interface GodotAutoExposureConfig {
  readonly dialect: 'godot-4';
  readonly rendererPath: 'compute' | 'raster';
  readonly minLuminance: number;
  readonly maxLuminance: number;
  readonly speed: number;
  readonly scale: number;
}

const FULLSCREEN_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const REDUCE_FRAGMENT = `
uniform sampler2D tSource;
uniform sampler2D tPrevious;
uniform vec2 sourceSize;
uniform vec2 destSize;
uniform float firstPass;
uniform float finalPass;
uniform float initialized;
uniform float computePath;
uniform float exposureAdjust;
uniform float minLuminance;
uniform float maxLuminance;
varying vec2 vUv;

void main() {
  vec2 destPosition = floor(vUv * destSize);
  vec2 sourceFrom = computePath > 0.5
    ? destPosition * 8.0
    : floor(destPosition * sourceSize / destSize);
  vec2 sourceTo = computePath > 0.5
    ? min(sourceFrom + vec2(8.0), sourceSize)
    : floor((destPosition + vec2(1.0)) * sourceSize / destSize);
  sourceTo = max(sourceTo, sourceFrom + vec2(1.0));
  vec3 colorSum = vec3(0.0);
  float luminanceSum = 0.0;
  float sampleCount = 0.0;
  for (int y = 0; y < 16; y += 1) {
    for (int x = 0; x < 16; x += 1) {
      vec2 position = sourceFrom + vec2(float(x), float(y));
      if (position.x >= sourceTo.x || position.y >= sourceTo.y) continue;
      vec3 color = texture2D(tSource, (position + vec2(0.5)) / sourceSize).rgb;
      colorSum += color;
      luminanceSum += max(color.r, max(color.g, color.b));
      sampleCount += 1.0;
    }
  }
  vec3 averageColor = colorSum / sampleCount;
  float luminance = firstPass > 0.5
    ? (computePath > 0.5
      ? luminanceSum / sampleCount
      : max(averageColor.r, max(averageColor.g, averageColor.b)))
    : averageColor.r;
  if (finalPass > 0.5 && initialized > 0.5) {
    float previous = texture2D(tPrevious, vec2(0.5)).r;
    if (computePath > 0.5) {
      luminance = clamp(
        previous + (luminance - previous) * exposureAdjust,
        minLuminance,
        maxLuminance
      );
    } else {
      float target = clamp(luminance, minLuminance, maxLuminance);
      luminance = previous + (target - previous) * clamp(exposureAdjust, 0.0, 1.0);
    }
  }
  gl_FragColor = vec4(luminance, 0.0, 0.0, 1.0);
}
`;

function exposureTarget(width = 1, height = 1): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, {
    type: FloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.colorSpace = NoColorSpace;
  target.texture.generateMipmaps = false;
  return target;
}

export class GodotAutoExposurePass extends Pass {
  private readonly material: ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly levels: WebGLRenderTarget[] = [];
  private previous = exposureTarget();
  private next = exposureTarget();
  private sizedFor = new Vector2();
  private initialized = false;
  private readonly textureUniforms = new Set<{ value: Texture | null }>();

  constructor(readonly config: GodotAutoExposureConfig) {
    super('GodotAutoExposure');
    for (const [name, value] of Object.entries(config)) {
      if (name === 'dialect' || name === 'rendererPath') continue;
      if (!Number.isFinite(value)) {
        throw new Error(`Godot auto exposure ${name} must be finite; received ${String(value)}.`);
      }
    }
    if (config.minLuminance < 0 || config.maxLuminance < config.minLuminance) {
      throw new Error(
        `Godot auto exposure requires 0 <= minLuminance <= maxLuminance; received ${config.minLuminance}/${config.maxLuminance}.`,
      );
    }
    if (config.speed < 0 || config.scale <= 0) {
      throw new Error(
        `Godot auto exposure requires speed >= 0 and scale > 0; received ${config.speed}/${config.scale}.`,
      );
    }
    this.needsSwap = false;
    this.material = new ShaderMaterial({
      name: 'GodotAutoExposureReduce',
      uniforms: {
        tSource: { value: null },
        tPrevious: { value: null },
        sourceSize: { value: new Vector2(1, 1) },
        destSize: { value: new Vector2(1, 1) },
        firstPass: { value: 0 },
        finalPass: { value: 0 },
        initialized: { value: 0 },
        computePath: { value: config.rendererPath === 'compute' ? 1 : 0 },
        exposureAdjust: { value: 0 },
        minLuminance: { value: config.minLuminance },
        maxLuminance: { value: config.maxLuminance },
      },
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: REDUCE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  getExposureTexture(): Texture {
    return this.previous.texture;
  }

  bindExposureTexture(uniform: { value: Texture | null }): void {
    this.textureUniforms.add(uniform);
    uniform.value = this.previous.texture;
  }

  private resize(width: number, height: number): void {
    if (this.sizedFor.x === width && this.sizedFor.y === height) return;
    this.sizedFor.set(width, height);
    let sourceWidth = width;
    let sourceHeight = height;
    let index = 0;
    while (sourceWidth > 1 || sourceHeight > 1) {
      const levelWidth = Math.max(Math.floor(sourceWidth / 8), 1);
      const levelHeight = Math.max(Math.floor(sourceHeight / 8), 1);
      if (levelWidth === 1 && levelHeight === 1) break;
      const level = this.levels[index] ?? exposureTarget(levelWidth, levelHeight);
      level.setSize(levelWidth, levelHeight);
      this.levels[index] = level;
      sourceWidth = levelWidth;
      sourceHeight = levelHeight;
      index += 1;
    }
    for (const stale of this.levels.splice(index)) stale.dispose();
    this.initialized = false;
  }

  setSize(width: number, height: number): void {
    this.resize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
  }

  render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget | null,
    _outputBuffer: WebGLRenderTarget | null,
    deltaTime = 0,
  ): void {
    if (inputBuffer === null) {
      throw new Error('Godot auto exposure requires a composer input buffer.');
    }
    if (inputBuffer.texture.colorSpace !== NoColorSpace) {
      throw new Error(
        `Godot auto exposure requires linear scene color; received colorSpace=${inputBuffer.texture.colorSpace}.`,
      );
    }
    if (
      renderer.capabilities.isWebGL2 !== true ||
      renderer.extensions.get('EXT_color_buffer_float') === null
    ) {
      throw new Error(
        'Godot auto exposure requires WebGL2 EXT_color_buffer_float for its retained R32F-equivalent luminance targets.',
      );
    }
    this.resize(inputBuffer.width, inputBuffer.height);
    const uniforms = this.material.uniforms;
    uniforms['exposureAdjust']!.value = this.config.speed * deltaTime;
    // In the compute source, a viewport that reduces directly to 1x1 never enters the i > 0
    // WRITE_LUMINANCE variant, so it also never reads history. Preserve that small-target edge.
    uniforms['initialized']!.value =
      this.initialized &&
      (this.config.rendererPath === 'raster' || this.levels.length > 0)
        ? 1
        : 0;
    uniforms['tPrevious']!.value = this.previous.texture;
    const previousTarget = renderer.getRenderTarget();
    let source: Texture = inputBuffer.texture;
    let sourceWidth = inputBuffer.width;
    let sourceHeight = inputBuffer.height;
    try {
      for (let index = 0; index <= this.levels.length; index += 1) {
        const target = index < this.levels.length ? this.levels[index]! : this.next;
        uniforms['tSource']!.value = source;
        (uniforms['sourceSize']!.value as Vector2).set(sourceWidth, sourceHeight);
        (uniforms['destSize']!.value as Vector2).set(target.width, target.height);
        uniforms['firstPass']!.value = index === 0 ? 1 : 0;
        uniforms['finalPass']!.value = index === this.levels.length ? 1 : 0;
        renderer.setRenderTarget(target);
        this.quad.render(renderer);
        source = target.texture;
        sourceWidth = target.width;
        sourceHeight = target.height;
      }
      const retained = this.previous;
      this.previous = this.next;
      this.next = retained;
      for (const uniform of this.textureUniforms) uniform.value = this.previous.texture;
      this.initialized = true;
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose(): void {
    for (const level of this.levels) level.dispose();
    this.levels.length = 0;
    this.previous.dispose();
    this.next.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
