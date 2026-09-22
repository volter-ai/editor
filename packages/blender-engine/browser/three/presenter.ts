/**
 * THE PRESENTER FOR A HOST WITHOUT A STAGE (WS-AC, cut 1b).
 *
 * "Our Blender renders with three.js" is a translation (`./blender-runtime-view`
 * and the modules beside it) plus one act: point a camera at the translated
 * scene, render into a scene-linear target, read the pixels, run Blender's
 * display transform, answer. The editor performs that act with its own stage
 * and renderer (`packages/blender/host/blender-runtime-host.ts`), which is why
 * the editor never imports THIS file. A host that has no renderer — a bare
 * page with `@volter/browser-wali`, an Emscripten page, the substrate
 * workbench — attaches one of these to the Blender it started, and the guest's
 * `bpy.ops.render.render` comes back as a three.js photograph exactly as it
 * does in the editor.
 *
 * What it does NOT do, on purpose: overlays (modeling chrome, hidden for a
 * render anyway), selection outlines, the editor's supersampled `captureImage`
 * for the Standard transform. Every transform here goes through the linear
 * capture and the same encoders the editor uses for AgX and Filmic.
 */
import * as THREE from 'three';
import type { CaptureRequest, RenderRequest } from '../protocol';
import type { PresentAnswer } from '../runtime';
import { AGX_LOOK_TABLES, agxEncodeFrame } from './blender-agx';
import { displayTableUrl } from './blender-display-lut';
import { filmicEncodeFrame } from './blender-filmic';
import { BlenderRuntimeView } from './blender-runtime-view';
import { standardEncodeFrame } from './blender-standard';

export interface PresenterOptions {
  /** The canvas to render into; an OffscreenCanvas of 1x1 when absent. */
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  /** The photograph camera's clipping; the editor's stage camera values. */
  near?: number;
  far?: number;
}

export interface Presenter {
  /** The translated scene, for a host that also wants to SHOW it. */
  readonly view: BlenderRuntimeView;
  readonly scene: THREE.Scene;
  /** `BlenderRuntimeOptions.present`, answered here. */
  present(frame: unknown, description: unknown, capture?: CaptureRequest): Promise<PresentAnswer>;
  dispose(): void;
}

const MAXIMUM_EDGE = 2048;

const displayTables = new Map<string, Promise<Uint16Array>>();
function displayTable(file: string): Promise<Uint16Array> {
  let pending = displayTables.get(file);
  if (!pending) {
    pending = fetch(displayTableUrl(file)).then(async (response) => {
      if (!response.ok)
        throw new Error(`Blender display table ${file}: ${response.status} ${response.statusText}`);
      return new Uint16Array(await response.arrayBuffer());
    });
    displayTables.set(file, pending);
  }
  return pending;
}

function displayTableFor(render: RenderRequest): string | null {
  const look = render.look ?? 'None';
  if (render.toneMapping === 'none') return null;
  if (render.toneMapping === 'filmic') return 'filmic-srgb.lut';
  if (render.toneMapping !== 'agx')
    throw new Error(
      `Blender's Khronos PBR Neutral view transform has no scene-linear implementation in the ` +
        `browser (implemented: Standard, AgX, Filmic)`,
    );
  if (look === 'None') return 'agx-base-srgb.lut';
  const file = AGX_LOOK_TABLES[look as keyof typeof AGX_LOOK_TABLES];
  if (file === undefined) throw new Error(`Blender display transform has no table for look ${look}`);
  return file;
}

async function pngBase64(bytes: Uint8Array | Uint8ClampedArray, width: number, height: number): Promise<string> {
  // The linear capture is bottom-up (GL); the image is top-down.
  const stride = width * 4;
  const image = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const source = (height - 1 - y) * stride;
    image.set(bytes.subarray(source, source + stride), y * stride);
  }
  const data = new ImageData(image, width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Blender display transform could not create its image canvas');
    context.putImageData(data, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Blender display transform could not create its image canvas');
  context.putImageData(data, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const raw = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < raw.length; i += 0x8000)
    binary += String.fromCharCode(...raw.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function createPresenter(options: PresenterOptions = {}): Presenter {
  const view = new BlenderRuntimeView();
  const scene = new THREE.Scene();
  scene.add(view.root);
  const canvas = options.canvas ?? new OffscreenCanvas(1, 1);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(1);
  const near = options.near ?? 0.1;
  const far = options.far ?? 1000;

  async function present(
    frame: unknown,
    description: unknown,
    capture?: CaptureRequest,
  ): Promise<PresentAnswer> {
    const applied = view.applyFrame(frame) as { held?: unknown } | null | undefined;
    const held =
      typeof applied === 'object' && applied !== null && 'held' in applied
        ? (applied.held as { session: string; revision: number } | null)
        : null;
    view.recordPresentation(description);
    const answer = (photograph?: unknown): PresentAnswer => ({
      ...(photograph === undefined ? {} : { capture: photograph }),
      held,
    });
    const render = capture?.render;
    if (!render) return answer();
    const { position, target, up } = capture;
    if (!position || !target || !up)
      throw new Error('A Blender render capture must carry the scene camera position, target and up');

    // THE PHOTOGRAPH HAS ITS OWN CAMERA, placed from Blender's frame through the
    // model root's Z-up -> Y-up matrix and reported back through its inverse —
    // exactly as the editor's host does, because `session.py` asserts the echo.
    view.root.updateMatrixWorld(true);
    const toDocument = view.root.matrixWorld;
    const toBlender = new THREE.Matrix4().copy(toDocument).invert();
    const documentBasis = new THREE.Matrix3().setFromMatrix4(toDocument);
    const blenderBasis = new THREE.Matrix3().setFromMatrix4(toBlender);
    const eye = new THREE.Vector3(position[0], position[1], position[2]).applyMatrix4(toDocument);
    const focus = new THREE.Vector3(target[0], target[1], target[2]).applyMatrix4(toDocument);
    const upward = new THREE.Vector3(up[0], up[1], up[2]).applyMatrix3(documentBasis);
    const width = Math.min(MAXIMUM_EDGE, Math.round(render.width));
    const height = Math.min(MAXIMUM_EDGE, Math.round(render.height));
    const aspect = width / height;
    const camera: THREE.Camera = render.orthographic
      ? new THREE.OrthographicCamera(
          (-render.fov / 2) * aspect,
          (render.fov / 2) * aspect,
          render.fov / 2,
          -render.fov / 2,
          near,
          far,
        )
      : new THREE.PerspectiveCamera(render.fov, aspect, near, far);
    camera.up.copy(upward);
    camera.position.copy(eye);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
    const photographedFrom = {
      position: eye.clone().applyMatrix4(toBlender).toArray(),
      target: focus.clone().applyMatrix4(toBlender).toArray(),
      up: upward.clone().applyMatrix3(blenderBasis).toArray(),
    };
    view.recordPhotograph({
      sent: { position, target, up },
      photographed: photographedFrom,
      render: { width, height, fov: render.fov, orthographic: render.orthographic },
    });

    const tableFile = displayTableFor(render);
    const table = tableFile ? await displayTable(tableFile) : null;
    const mappings: Record<string, THREE.ToneMapping> = {
      none: THREE.NoToneMapping,
      agx: THREE.AgXToneMapping,
      neutral: THREE.NeutralToneMapping,
      filmic: THREE.NoToneMapping,
    };
    const previousMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    renderer.toneMapping = mappings[render.toneMapping] ?? THREE.AgXToneMapping;
    renderer.toneMappingExposure = render.exposure;
    const sceneTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    try {
      await view.setRendered(true, camera);
      let pixels: Uint16Array;
      if (render.linearInput) {
        pixels = halfFloatFrame(render.linearInput.base64);
      } else {
        renderer.setSize(width, height, false);
        renderer.setRenderTarget(sceneTarget);
        const background = scene.background;
        if (render.transparent) {
          scene.background = null;
          renderer.setClearColor(0, 0);
        }
        try {
          renderer.render(scene, camera);
        } finally {
          scene.background = background;
        }
        pixels = new Uint16Array(width * height * 4);
        renderer.readRenderTargetPixels(sceneTarget, 0, 0, width, height, pixels);
        renderer.setRenderTarget(null);
      }
      const count = width * height;
      const bytes =
        render.toneMapping === 'none'
          ? standardEncodeFrame(pixels, count, render.exposure)
          : render.toneMapping === 'filmic'
            ? filmicEncodeFrame(table!, pixels, count, render.exposure)
            : agxEncodeFrame(table!, pixels, count, {
                exposure: render.exposure,
                composedLook: (render.look ?? 'None') !== 'None',
              });
      const photograph: Record<string, unknown> = {
        base64: await pngBase64(bytes, width, height),
        mimeType: 'image/png',
        camera: photographedFrom,
      };
      if (render.linear === true) {
        const raw = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
        let binary = '';
        for (let i = 0; i < raw.length; i += 0x8000)
          binary += String.fromCharCode(...raw.subarray(i, i + 0x8000));
        photograph['linearBase64'] = btoa(binary);
        photograph['linearWidth'] = width;
        photograph['linearHeight'] = height;
      }
      return answer(photograph);
    } finally {
      sceneTarget.dispose();
      renderer.toneMapping = previousMapping;
      renderer.toneMappingExposure = previousExposure;
      await view.setRendered(false);
    }
  }

  return {
    view,
    scene,
    present,
    dispose() {
      renderer.dispose();
    },
  };
}

/** A composited frame's scene-linear half floats, as `linearInput` carries them. */
function halfFloatFrame(base64: string): Uint16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
}
