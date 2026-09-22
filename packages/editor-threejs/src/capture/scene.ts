/** Capture an already isolated scene. The caller owns the scene and camera;
 * this function owns its renderer lease and targets for one synchronous draw. */
import * as THREE from 'three';
import { acquireInspectorPreviewRenderer } from '../viewport/preview-renderer';
import { viewportCaptureOutputPass } from './output-pass';

export interface SceneCaptureOptions {
  width: number;
  height: number;
  transparent?: boolean;
  toneMapping?: THREE.ToneMapping;
  exposure?: number;
}

export interface LinearCaptureFrame {
  readonly pixels: Uint16Array;
  readonly width: number;
  readonly height: number;
}

function capture(
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: SceneCaptureOptions,
  linear: true,
): LinearCaptureFrame;
function capture(
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: SceneCaptureOptions,
  linear: false,
): string;
function capture(
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: SceneCaptureOptions,
  linear: boolean,
): string | LinearCaptureFrame {
  if (
    !Number.isFinite(options.width) ||
    !Number.isFinite(options.height) ||
    options.width < 1 ||
    options.height < 1
  )
    throw new Error('Scene capture requires finite positive dimensions');
  const width = Math.min(2048, Math.round(options.width));
  const height = Math.min(2048, Math.round(options.height));
  const scale = linear ? 1 : 2;
  const renderWidth = width * scale;
  const renderHeight = height * scale;
  const lease = acquireInspectorPreviewRenderer();
  const renderer = lease.renderer;
  const previous = {
    target: renderer.getRenderTarget(),
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    colorSpace: renderer.outputColorSpace,
    shadows: renderer.shadowMap.enabled,
    shadowType: renderer.shadowMap.type,
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    background: scene.background,
  };
  let hdr: THREE.WebGLRenderTarget | undefined;
  let display: THREE.WebGLRenderTarget | undefined;
  let completed = false;
  try {
    hdr = new THREE.WebGLRenderTarget(renderWidth, renderHeight, { type: THREE.HalfFloatType });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = options.toneMapping ?? THREE.NoToneMapping;
    renderer.toneMappingExposure = options.exposure ?? 1;
    renderer.setClearColor(0, options.transparent ? 0 : 1);
    if (options.transparent) scene.background = null;
    renderer.setRenderTarget(hdr);
    renderer.clear();
    renderer.render(scene, camera);
    if (linear) {
      const pixels = new Uint16Array(renderWidth * renderHeight * 4);
      renderer.readRenderTargetPixels(hdr, 0, 0, renderWidth, renderHeight, pixels);
      completed = true;
      return { pixels, width, height };
    }
    display = new THREE.WebGLRenderTarget(renderWidth, renderHeight);
    viewportCaptureOutputPass(options.transparent === true).render(
      renderer,
      display,
      hdr,
      0,
      false,
    );
    const pixels = new Uint8Array(renderWidth * renderHeight * 4);
    renderer.readRenderTargetPixels(display, 0, 0, renderWidth, renderHeight, pixels);
    const full = document.createElement('canvas');
    full.width = renderWidth;
    full.height = renderHeight;
    const context = full.getContext('2d');
    if (!context) throw new Error('Scene capture could not create an image canvas');
    const image = context.createImageData(renderWidth, renderHeight);
    const stride = renderWidth * 4;
    for (let y = 0; y < renderHeight; y++)
      image.data.set(
        pixels.subarray((renderHeight - 1 - y) * stride, (renderHeight - y) * stride),
        y * stride,
      );
    context.putImageData(image, 0, 0);
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const outputContext = output.getContext('2d');
    if (!outputContext) throw new Error('Scene capture could not create an output canvas');
    outputContext.drawImage(full, 0, 0, width, height);
    const imageUrl = output.toDataURL('image/png');
    completed = true;
    return imageUrl;
  } finally {
    scene.background = previous.background;
    renderer.setRenderTarget(previous.target);
    renderer.toneMapping = previous.toneMapping;
    renderer.toneMappingExposure = previous.exposure;
    renderer.outputColorSpace = previous.colorSpace;
    renderer.shadowMap.enabled = previous.shadows;
    renderer.shadowMap.type = previous.shadowType;
    renderer.setClearColor(previous.clearColor, previous.clearAlpha);
    display?.dispose();
    hdr?.dispose();
    lease.release({ discard: !completed });
  }
}

export function captureSceneLinear(
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: SceneCaptureOptions,
): LinearCaptureFrame {
  return capture(scene, camera, options, true);
}

export function captureSceneImage(
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: SceneCaptureOptions,
): string {
  return capture(scene, camera, options, false);
}
