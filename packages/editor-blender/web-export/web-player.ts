/**
 * A MODEL'S GAME AS A PAGE OF ITS OWN: what `cyclotron export web` builds around, playing the
 * dump the editor wrote (`web-export-files.ts`) with no editor and no Blender.
 *
 * It draws the game the way the editor's Play draws it:
 *
 * 1. THE COPY is a `BlenderRuntimeView` built from the exported frame (`applyFrame`), as
 *    `BlenderRuntimeView.detach` builds Play's copy, held in Blender's Rendered shading with
 *    render visibility (`holdRendered(…, 'render')`), and prepared before its first frame
 *    (`prepareRendered`: the scene's lights, World and image decodes ready).
 * 2. THE CHARACTERS animate through Play's own evaluator (`playAnimation`, `blender-pose.ts`),
 *    asking the exported clips (`clips.json`) instead of Blender.
 * 3. THE FRAME: the script's updates (the runner the page is handed, `@volter/play`'s
 *    `createPlayRunner`), then `refreshRendered` and `prepareDraw` for the camera the script
 *    posed, a scene-linear half-float draw, and Blender's display transform onto the canvas
 *    (`BlenderDisplayTransform`, the scene's `view_settings`) — the editor's Rendered viewport.
 *
 * THE PAGE'S SHAPE is the project's `resolution`: the stage keeps that aspect inside the window,
 * as the editor's play area does, and the HUD layer (`hud`) covers exactly the stage. The canvas
 * draws at the stage's size in device pixels (at most 2× the CSS size).
 *
 * `window.__volterExport` holds the view, runner, camera and renderer, for a person (or a probe)
 * looking from the console.
 */
import * as THREE from 'three';
import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import { createBlenderDisplayTransform, type BlenderDisplayTransform } from '@volter/blender-engine/browser/three/blender-display-transform';
import { ownedSurfaceMaterial } from '@volter/blender-engine/browser/three/blender-physical-material';
import { playAnimation, type PlayAnimation } from '../contributions/blender-play-skin';
import { decodeFrameFile } from './frame-codec';
import type { WebExportClips, WebExportManifest } from './web-export-files';

/** What the page needs of a runner: `@volter/play`'s `createPlayRunner` answers it. */
export interface WebPlayerRunner {
  start(script: { readonly default?: unknown }, name?: string): Promise<void>;
  frame(seconds: number): void;
  dispose(): void;
}

export interface WebPlayerStage {
  readonly root: THREE.Object3D;
  readonly camera: () => THREE.Camera;
  readonly animation: PlayAnimation | undefined;
  readonly ownMaterial: (material: THREE.Material) => THREE.Material | null;
  readonly report: (title: string, detail: string) => void;
}

export interface WebPlayerOptions {
  /** The element the page fills; the stage, canvas and HUD are made inside it. */
  readonly container: HTMLElement;
  readonly manifest: WebExportManifest;
  /** URLs of the dump's frame file and clips. */
  readonly frameUrl: string;
  readonly clipsUrl: string;
  /** The project's play script module (its default export is the game). */
  readonly script: { readonly default?: unknown };
  /** Builds the runner over the stage: `(stage) => createPlayRunner(stage)`. */
  readonly runner: (stage: WebPlayerStage) => WebPlayerRunner;
  /** Mount the project's `dom` roots into the HUD layer before the script starts, so the script
   *  and its UI share one module graph (a store both import) from the first update. */
  readonly mountHud?: (hud: HTMLElement) => void | Promise<void>;
}

export interface WebPlayer {
  readonly view: BlenderRuntimeView;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly runner: WebPlayerRunner;
  readonly animation: PlayAnimation | undefined;
  readonly stage: HTMLElement;
  readonly hud: HTMLElement;
  /** Frames drawn so far. */
  readonly frames: number;
  dispose(): void;
}

/** The longest real time one drawn frame counts: a tab that was hidden resumes, not leaps. */
const MAX_FRAME_SECONDS = 0.25;
const MAX_PIXEL_RATIO = 2;

async function fetchBytes(url: string, what: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The game's ${what} could not be loaded (${response.status} ${response.statusText}): ${url}`);
  return response.arrayBuffer();
}

function element(tag: string, style: Partial<CSSStyleDeclaration>, parent: HTMLElement): HTMLElement {
  const made = document.createElement(tag);
  Object.assign(made.style, style);
  parent.appendChild(made);
  return made;
}

/** The scene camera as the page's first camera: Blender's view through it, fitted to `aspect`. */
function sceneCamera(view: BlenderRuntimeView, name: string | null, aspect: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
  const looked = name === null ? null : view.cameraView(name, { width: aspect * 1000, height: 1000 }, 1, [0, 0]);
  if (!looked) return camera;
  camera.position.fromArray(looked.position);
  camera.quaternion.fromArray(looked.quaternion);
  const halfHeight = (looked.window.top - looked.window.bottom) / 2;
  if (looked.projection === 'perspective' && halfHeight > 0) camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(halfHeight));
  camera.near = looked.near;
  camera.far = looked.far;
  camera.updateProjectionMatrix();
  return camera;
}

export async function bootWebPlayer(options: WebPlayerOptions): Promise<WebPlayer> {
  const { container, manifest } = options;
  const aspect = manifest.resolution ? manifest.resolution.width / manifest.resolution.height : null;
  // The stage is placed inside the container; a container the page left static is made its
  // positioning parent, and one the page already placed (fixed, absolute) keeps its own place.
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  Object.assign(container.style, { overflow: 'hidden', background: '#000' });
  // THE STAGE: the game's frame, centred and as large as the window allows at its aspect.
  const stage = element('div', { position: 'absolute', overflow: 'hidden' }, container);
  stage.dataset['testid'] = 'export-stage';
  const canvas = element('canvas', { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', outline: 'none' }, stage) as HTMLCanvasElement;
  canvas.tabIndex = 0;
  const hud = element('div', { position: 'absolute', inset: '0', pointerEvents: 'none', visibility: 'hidden' }, stage);
  hud.dataset['testid'] = 'export-hud';
  const status = element('div', {
    position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
    padding: '24px', color: '#e6e6e6', font: '600 14px system-ui, sans-serif', background: 'rgba(0, 0, 0, 0.6)', pointerEvents: 'none',
  }, stage);
  status.dataset['testid'] = 'export-status';
  const say = (text: string): void => { status.textContent = text; };
  let failed = false;
  const fail = (title: string, detail: string): void => {
    failed = true;
    status.style.display = 'flex';
    status.style.color = '#ff8a80';
    status.textContent = `${title}: ${detail}`;
    // biome-ignore lint/suspicious/noConsole: a page of its own has no other place to say it.
    console.error(`${title}: ${detail}`);
  };
  const layout = (): void => {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    let w = width, h = height;
    if (aspect !== null) {
      if (width / height > aspect) w = Math.round(height * aspect);
      else h = Math.round(width / aspect);
    }
    Object.assign(stage.style, { width: `${w}px`, height: `${h}px`, left: `${Math.round((width - w) / 2)}px`, top: `${Math.round((height - h) / 2)}px` });
  };
  layout();

  say('Loading…');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const view = new BlenderRuntimeView();
  scene.add(view.root);

  const [frameBytes, clips] = await Promise.all([
    fetchBytes(options.frameUrl, 'model'),
    fetchBytes(options.clipsUrl, 'animation').then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as WebExportClips),
  ]);
  say('Building the scene…');
  view.applyFrame(decodeFrameFile(frameBytes));
  const camera = sceneCamera(view, manifest.camera, aspect ?? (canvas.clientWidth / Math.max(1, canvas.clientHeight)));

  // THE DRAW BUFFERS follow the stage's size.
  let target: THREE.WebGLRenderTarget | null = null;
  const size = new THREE.Vector2();
  const resize = (): void => {
    layout();
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(ratio);
    renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight), false);
    renderer.getDrawingBufferSize(size);
    target?.setSize(size.x, size.y);
    camera.aspect = size.x / Math.max(1, size.y);
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  window.addEventListener('resize', resize);

  // BLENDER'S RENDERED SHADING, held through the camera the script poses.
  view.holdRendered(() => camera, undefined, 'render');
  say('Preparing the lighting…');
  await view.prepareRendered(camera, 'render');

  let display: BlenderDisplayTransform | null = null;
  if (manifest.display) {
    display = await createBlenderDisplayTransform(manifest.display);
    target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  }

  // THE CHARACTERS: Play's evaluator over the exported clips.
  const lookup = (armature: string, action: string): Promise<BlenderActionClip | null> => {
    const entry = clips.armatures[armature]?.[action];
    if (typeof entry === 'number') return Promise.resolve(clips.clips[entry] ?? null);
    return Promise.reject(new Error(typeof entry === 'string' ? entry : `${armature} / ${action} was not exported`));
  };
  let animation: PlayAnimation | undefined;
  try {
    // biome-ignore lint/suspicious/noConsole: the page's console is where its warnings go.
    animation = playAnimation(view, lookup, new Map(), { warn: (said) => console.warn(said) });
    const missing = (await animation.prepare()).failed;
    // biome-ignore lint/suspicious/noConsole: as above.
    if (missing.length > 0) console.warn(`The game starts without ${missing.length} clip(s): ${missing.join('; ')}`);
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: as above.
    console.error(`The game's animation could not be set up, so it plays without it: ${error instanceof Error ? error.message : String(error)}`);
    animation = undefined;
  }

  const runner = options.runner({
    root: view.root,
    camera: () => camera,
    animation,
    ownMaterial: (material) => ownedSurfaceMaterial(material),
    report: fail,
  });
  say('Starting…');
  if (options.mountHud) await options.mountHud(hud);
  try {
    await runner.start(options.script, manifest.script);
  } catch {
    // Said by the runner's report, on the page.
  }

  let frames = 0;
  let last = performance.now();
  let handle = 0;
  let disposed = false;
  const draw = (now: number): void => {
    if (disposed) return;
    handle = requestAnimationFrame(draw);
    const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
    last = now;
    runner.frame(seconds);
    view.refreshRendered();
    const finish = view.prepareDraw(camera, {
      interactive: false, height: size.y, multiDraw: renderer.extensions.has('WEBGL_multi_draw'), renderer,
    });
    try {
      if (display && target) {
        renderer.setRenderTarget(target);
        renderer.clear(true, true, false);
        renderer.render(scene, camera);
        display.render(renderer, target, null, false);
      } else {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    } finally {
      renderer.setRenderTarget(null);
      finish();
    }
    frames += 1;
    if (frames === 1) {
      hud.style.visibility = 'visible';
      if (!failed) status.style.display = 'none';
    }
  };
  handle = requestAnimationFrame(draw);

  const player: WebPlayer = {
    view, scene, camera, renderer, runner, animation, stage, hud,
    get frames() { return frames; },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(handle);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      runner.dispose();
      animation?.dispose();
      display?.dispose();
      target?.dispose();
      view.dispose();
      renderer.dispose();
      stage.remove();
    },
  };
  (window as unknown as { __volterExport?: WebPlayer }).__volterExport = player;
  return player;
}
