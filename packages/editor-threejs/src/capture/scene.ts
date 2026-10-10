/** Capture an already isolated scene. The caller owns the scene and camera;
 * this function owns its renderer lease and targets for one synchronous draw. */
import * as THREE from 'three';
import { acquireInspectorPreviewRenderer } from '../viewport/preview-renderer';
import { viewportCaptureOutputPass } from './output-pass';
import type { DocumentDisplayTransform } from '../render/document-display-transform';
import {resolveSceneLinearSize} from './linear-resolve';
import { adoptReversedDepth, floatDepthTexture, rendererReversedDepth } from '../render/reversed-depth';

export interface SceneCaptureOptions {
  width: number;
  height: number;
  transparent?: boolean;
  toneMapping?: THREE.ToneMapping;
  exposure?: number;
  /** Caller-owned draw resources for this renderer/camera. The returned
   * cleanup runs after success or failure, before releasing the renderer. */
  prepareDraw?: (renderer:THREE.WebGLRenderer,camera:THREE.Camera)=>void|(()=>void);
  /** Integration-owned GPU display resolve, shared with its live viewport. */
  displayTransform?: DocumentDisplayTransform;
  /** Caller-owned scene-linear effect. The input carries a depth texture;
   * the returned target remains caller-owned and must contain half floats. */
  effect?: {
    render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget,
      scene: THREE.Scene, camera: THREE.Camera): THREE.WebGLRenderTarget;
  } | undefined;
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
  // Render Result/EXR captures need the same scene-linear antialiasing as PNG
  // captures. Resolving only the display path left Blender renders with one
  // raster sample per pixel, particularly visible on textured roof tiles.
  const scale = 2;
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
  let displayInput: THREE.WebGLRenderTarget | undefined;
  let completed = false;
  let finishDraw:(()=>void)|void=undefined;
  try {
    // Float depth wherever depth is reversed (`render/reversed-depth.ts`), and for an effect that reads it.
    const reversed = rendererReversedDepth(renderer);
    hdr = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
      type: THREE.HalfFloatType,
      ...(reversed ? { depthTexture: floatDepthTexture(renderWidth, renderHeight) } : {}),
    });
    if (options.effect && !reversed) hdr.depthTexture = new THREE.DepthTexture(renderWidth, renderHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = options.toneMapping ?? THREE.NoToneMapping;
    renderer.toneMappingExposure = options.exposure ?? 1;
    renderer.setClearColor(0, options.transparent ? 0 : 1);
    if (options.transparent) scene.background = null;
    renderer.setRenderTarget(hdr);
    finishDraw=options.prepareDraw?.(renderer,camera);
    renderer.clear();
    // (a photograph's camera and the suns it composed are new: reversed before three culls and builds the
    // shadow matrices, or every lit face reads as shadowed in its one frame)
    adoptReversedDepth(renderer, scene, camera);
    renderer.render(scene, camera);
    const resolved = options.effect?.render(renderer, hdr, scene, camera) ?? hdr;
    if (resolved.texture.type !== THREE.HalfFloatType || resolved.width !== renderWidth || resolved.height !== renderHeight)
      throw new Error('Scene capture effect must return a same-size half-float target');
    if (linear) {
      displayInput=resolveSceneLinearSize(renderer,resolved,width,height);
      const pixels = new Uint16Array(width * height * 4);
      renderer.readRenderTargetPixels(displayInput, 0, 0, width, height, pixels);
      completed = true;
      return { pixels, width, height };
    }
    display = new THREE.WebGLRenderTarget(options.displayTransform ? width : renderWidth, options.displayTransform ? height : renderHeight);
    if (options.displayTransform) {
      displayInput=resolveSceneLinearSize(renderer,resolved,width,height);
      options.displayTransform.render(renderer, displayInput, display, options.transparent === true);
    }
    else viewportCaptureOutputPass(options.transparent === true).render(renderer, display, resolved, 0, false);
    const pixels = new Uint8Array(display.width * display.height * 4);
    renderer.readRenderTargetPixels(display, 0, 0, display.width, display.height, pixels);
    const full = document.createElement('canvas');
    full.width = display.width;
    full.height = display.height;
    const context = full.getContext('2d');
    if (!context) throw new Error('Scene capture could not create an image canvas');
    const image = context.createImageData(display.width, display.height);
    const stride = display.width * 4;
    for (let y = 0; y < display.height; y++)
      image.data.set(
        pixels.subarray((display.height - 1 - y) * stride, (display.height - y) * stride),
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
    try {finishDraw?.();} finally {
      scene.background = previous.background;
      renderer.setRenderTarget(previous.target);
      renderer.toneMapping = previous.toneMapping;
      renderer.toneMappingExposure = previous.exposure;
      renderer.outputColorSpace = previous.colorSpace;
      renderer.shadowMap.enabled = previous.shadows;
      renderer.shadowMap.type = previous.shadowType;
      renderer.setClearColor(previous.clearColor, previous.clearAlpha);
      display?.dispose();
      displayInput?.dispose();
      hdr?.dispose();
      lease.release({ discard: !completed });
    }
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

/** Resolve a compositor/EXR frame through the SAME GPU display pipeline as
 * the document. The input stays scene-linear; only the returned bytes are
 * display encoded. Pixels retain GL's bottom-up ordering. */
export function resolveSceneLinearDisplay(
  frame: LinearCaptureFrame,
  transform: DocumentDisplayTransform,
): Uint8Array {
  const lease = acquireInspectorPreviewRenderer();
  const renderer = lease.renderer;
  const previous = renderer.getRenderTarget();
  const input = new THREE.DataTexture(frame.pixels, frame.width, frame.height, THREE.RGBAFormat, THREE.HalfFloatType);
  input.needsUpdate = true;
  const output = new THREE.WebGLRenderTarget(frame.width, frame.height);
  let completed = false;
  try {
    transform.render(renderer, {texture: input}, output, true);
    const pixels = new Uint8Array(frame.width * frame.height * 4);
    renderer.readRenderTargetPixels(output, 0, 0, frame.width, frame.height, pixels);
    completed = true;
    return pixels;
  } finally {
    renderer.setRenderTarget(previous);
    input.dispose(); output.dispose();
    lease.release({discard: !completed});
  }
}
