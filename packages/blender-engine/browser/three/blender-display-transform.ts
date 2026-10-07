import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import displayShaders from './blender-display-shaders.json';
import type { RenderRequest } from '../protocol';

export interface BlenderDisplaySettings {
  readonly transform: string;
  readonly look: string;
  /** Linear multiplier, after alpha unassociation and before the view transform. */
  readonly exposure: number;
  readonly gamma: number;
}

export function blenderDisplaySettingsForRender(render: Pick<RenderRequest, 'toneMapping' | 'look' | 'exposure' | 'gamma'>): BlenderDisplaySettings {
  return {
    transform: {none: 'Standard', filmic: 'Filmic', agx: 'AgX', neutral: 'Khronos PBR Neutral'}[render.toneMapping],
    look: render.look ?? 'None', exposure: render.exposure, gamma: render.gamma ?? 1,
  };
}

interface DisplayTexture {
  readonly sampler: string;
  readonly offset: number;
  readonly count: number;
  readonly linear: boolean;
  readonly channels: number;
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
}
interface DisplayProcessor {
  readonly shader: string;
  readonly textures: readonly DisplayTexture[];
}
const processors: Readonly<Record<string, DisplayProcessor>> = displayShaders.processors;

let tableData: Promise<ArrayBuffer> | null = null;
function loadDisplayData(): Promise<ArrayBuffer> {
  return tableData ??= fetch(new URL('./blender-display-shaders.lut', import.meta.url))
    .then(async response => {
      if (!response.ok) throw new Error(`Blender display tables: ${response.status}`);
      return response.arrayBuffer();
    }).catch(error => { tableData = null; throw error; });
}

/** Native OCIO-generated shaders, not a resampled look+view cube. The exact
 * operation order and tetrahedral sampling come from Blender's pinned config.
 * Apply after scene-linear compositing; exposure precedes the view, gamma
 * follows it. Resources belong to the mounted document, never the frame loop. */
export class BlenderDisplayTransform {
  private readonly material: THREE.RawShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly textures: THREE.Texture[] = [];

  constructor(settings: BlenderDisplaySettings, data: ArrayBuffer) {
    const processor = processors[`${settings.transform}/${settings.look}`];
    if (!processor) throw new Error(`Unimplemented Blender display transform: ${settings.transform}, ${settings.look}`);
    const uniforms: Record<string, THREE.IUniform> = {
      frame: {value: null}, exposure: {value: settings.exposure},
      exponent: {value: 1 / Math.max(1e-7, settings.gamma)}, straightAlpha: {value: false},
    };
    for (const spec of processor.textures) {
      if (spec.offset + spec.count * 4 > data.byteLength)
        throw new Error('Invalid Blender display table');
    }
    for (const spec of processor.textures) {
      const values = new Float32Array(data, spec.offset, spec.count);
      // OCIO stores a 3D texture with blue varying fastest. Its generated GLSL
      // samples .zyx, so retain that order rather than transposing the cube.
      let texture: THREE.DataTexture | THREE.Data3DTexture;
      if (spec.size) texture = new THREE.Data3DTexture(values, spec.size, spec.size, spec.size);
      else texture = new THREE.DataTexture(values, spec.width, spec.height);
      texture.type = THREE.FloatType;
      texture.format = spec.channels === 1 ? THREE.RedFormat : THREE.RGBFormat;
      // Three infers sized float formats for Red/RGBA, but not RGB. WebGL2's
      // immutable 3D storage rejects an unsized RGB internal format.
      texture.internalFormat = spec.channels === 1 ? 'R32F' : 'RGB32F';
      texture.minFilter = texture.magFilter = spec.linear ? THREE.LinearFilter : THREE.NearestFilter;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.unpackAlignment = 1;
      texture.needsUpdate = true;
      this.textures.push(texture);
      uniforms[spec.sampler] = {value: texture};
    }
    this.material = new THREE.RawShaderMaterial({
      name: 'Blender OCIO display', glslVersion: THREE.GLSL3,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      uniforms,
      vertexShader: `precision highp float; in vec3 position; in vec2 uv; out vec2 vUv;
        void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
      fragmentShader: `precision highp float; precision highp sampler3D;
        uniform sampler2D frame; uniform float exposure; uniform float exponent;
        uniform bool straightAlpha; in vec2 vUv; out vec4 outputColor;
        ${processor.shader}
        void main() {
          vec4 pixel=texture(frame,vUv);
          vec3 linear=pixel.rgb*(pixel.a==0.0 ? exposure : exposure/pixel.a);
          vec3 display=clamp(pow(max(blenderDisplay(vec4(linear,1.0)).rgb,vec3(0.0)),vec3(exponent)),0.0,1.0);
          outputColor=vec4(straightAlpha ? display : display*pixel.a,pixel.a);
        }`,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer: THREE.WebGLRenderer, input: Pick<THREE.WebGLRenderTarget, 'texture'>,
    output: THREE.WebGLRenderTarget | null, straightAlpha: boolean): void {
    this.material.uniforms['frame']!.value = input.texture;
    this.material.uniforms['straightAlpha']!.value = straightAlpha;
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
  }

  /** Explicit render/compositor readback, never used by the live frame loop. */
  encodeFrame(renderer: THREE.WebGLRenderer, pixels: Uint16Array, width: number, height: number): Uint8Array {
    const previous = renderer.getRenderTarget();
    const input = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    input.needsUpdate = true;
    const output = new THREE.WebGLRenderTarget(width, height);
    try {
      this.render(renderer, {texture: input}, output, true);
      const bytes = new Uint8Array(width * height * 4);
      renderer.readRenderTargetPixels(output, 0, 0, width, height, bytes);
      return bytes;
    } finally {
      renderer.setRenderTarget(previous); input.dispose(); output.dispose();
    }
  }

  dispose(): void {
    for (const texture of this.textures) texture.dispose();
    this.material.dispose(); this.quad.dispose();
  }
}

export async function createBlenderDisplayTransform(settings: BlenderDisplaySettings): Promise<BlenderDisplayTransform> {
  if (!processors[`${settings.transform}/${settings.look}`])
    throw new Error(`Unimplemented Blender display transform: ${settings.transform}, ${settings.look}`);
  return new BlenderDisplayTransform(settings, await loadDisplayData());
}
