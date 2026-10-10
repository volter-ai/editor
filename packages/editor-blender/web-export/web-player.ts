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
import type { BlenderActionClip, BlenderSceneMovie } from '@volter/blender-engine/browser/rna';
import { BlenderRuntimeView } from '@volter/blender-engine/browser/three/blender-runtime-view';
import { createBlenderDisplayTransform, type BlenderDisplayTransform } from '@volter/blender-engine/browser/three/blender-display-transform';
import { ownedSurfaceMaterial } from '@volter/blender-engine/browser/three/blender-physical-material';
import { playAnimation, type PlayAnimation } from '../contributions/blender-play-skin';
import { decodeFrameFile } from './frame-codec';
import { WEB_EXPORT_CLIPS_FILE, WEB_EXPORT_FRAME_FILE, WEB_EXPORT_MOVIE_FILE, type WebExportClips, type WebExportManifest } from './web-export-files';

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
  /** Load a bundled level into `root` (`play.load`), or read one ahead (`play.preload`); absent
   *  when the page bundles no levels. */
  readonly loadLevel?: (level: string) => Promise<{ readonly animation?: PlayAnimation | undefined; readonly script?: { readonly default?: unknown } | null; readonly name?: string }>;
  readonly preloadLevel?: (level: string) => Promise<void>;
}

/** The page's levels (`docs/LEVELS.md`): each cook under the page's data, and each level's own
 *  play script when it has one. */
export interface WebPlayerLevels {
  /** The URL of one of a level's cooked files. */
  url(level: string, file: string): string;
  /** The level's own play script module, or null when it has none. */
  script(level: string): Promise<{ readonly default?: unknown }> | null;
  /** The level's script's name, for the log. */
  scriptName?(level: string): string | undefined;
}

export interface WebPlayerOptions {
  /** The element the page fills; the stage, canvas and HUD are made inside it. */
  readonly container: HTMLElement;
  readonly manifest: WebExportManifest;
  /** URLs of the dump's frame file and clips. */
  readonly frameUrl: string;
  readonly clipsUrl: string;
  /** The scene's movie, for cutscenes and sequences; absent or missing, the page plays none. */
  readonly movieUrl?: string;
  /** The project's play script module (its default export is the game). */
  readonly script: { readonly default?: unknown };
  /** Builds the runner over the stage: `(stage) => createPlayRunner(stage)`. */
  readonly runner: (stage: WebPlayerStage) => WebPlayerRunner;
  /** Mount the project's `dom` roots into the HUD layer before the script starts, so the script
   *  and its UI share one module graph (a store both import) from the first update. */
  readonly mountHud?: (hud: HTMLElement) => void | Promise<void>;
  /** The levels the page bundles; absent, `play.load` is refused. */
  readonly levels?: WebPlayerLevels;
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

/** A download that brings no byte for this long is abandoned and asked for again. */
const STALL_SECONDS = 20;
const FETCH_TRIES = 3;

/** The bytes the page's downloads have brought so far, for its loading line. */
class Downloads {
  private readonly counts = new Map<number, number>();
  private next = 0;
  /** A counter for one download; `set` it to the bytes read so far. */
  track(): { set(bytes: number): void; done(): void } {
    const id = this.next++;
    this.counts.set(id, 0);
    return { set: (bytes) => { this.counts.set(id, bytes); }, done: () => { this.counts.delete(id); } };
  }
  /** Megabytes in flight, or null when nothing is downloading. */
  megabytes(): number | null {
    if (this.counts.size === 0) return null;
    let bytes = 0;
    for (const n of this.counts.values()) bytes += n;
    return Math.round(bytes / 1e6);
  }
}

class FetchRefused extends Error {}

/**
 * One of the game's files, read with its progress: a download that brings no byte for
 * STALL_SECONDS is abandoned and asked for again past the browser's cache (a fresh address, not
 * stored). A stalled response is otherwise never given up, and a cached one can hold every later
 * request for the same file behind it, reloads included (playtest round 29: E at the bridge's war
 * table left the game on "…", and every load in that window after it on "Loading…"). A refusal
 * (404, 500) is said at once; `optional` files answer null to one.
 */
async function fetchBytes(url: string, what: string, downloads: Downloads, optional?: false): Promise<ArrayBuffer>;
async function fetchBytes(url: string, what: string, downloads: Downloads, optional: true): Promise<ArrayBuffer | null>;
async function fetchBytes(url: string, what: string, downloads: Downloads, optional = false): Promise<ArrayBuffer | null> {
  let last: unknown = null;
  for (let attempt = 0; attempt < FETCH_TRIES; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error(`no data for ${STALL_SECONDS} s`)), STALL_SECONDS * 1000);
    };
    const count = downloads.track();
    try {
      arm();
      const response = attempt === 0
        ? await fetch(url, { signal: controller.signal })
        : await fetch(`${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        if (optional) return null;
        throw new FetchRefused(`The game's ${what} could not be loaded (${response.status} ${response.statusText}): ${url}`);
      }
      if (!response.body) return await response.arrayBuffer();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        chunks.push(value);
        size += value.byteLength;
        count.set(size);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
      return bytes.buffer;
    } catch (error) {
      if (error instanceof FetchRefused) throw error;
      last = controller.signal.aborted ? controller.signal.reason : error;
      // biome-ignore lint/suspicious/noConsole: the page's console is where its warnings go.
      console.warn(`The game's ${what} stopped downloading (${last instanceof Error ? last.message : String(last)}); ${attempt + 1 < FETCH_TRIES ? 'asking again' : 'giving up'}: ${url}`);
    } finally {
      clearTimeout(timer);
      count.done();
    }
  }
  if (optional) return null;
  throw new Error(`The game's ${what} stopped downloading ${FETCH_TRIES} times (${last instanceof Error ? last.message : String(last)}): ${url}. Reload the page; if it stops again, open the game in a new window.`);
}

const json = <T>(bytes: ArrayBuffer): T => JSON.parse(new TextDecoder().decode(bytes)) as T;

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

  // THE DOWNLOADS, counted on the loading line as they come (a line that stops counting is a
  // download that stalled, and is asked for again: `fetchBytes`)
  const downloads = new Downloads();
  const counting = (): (() => void) => {
    const tick = (): void => { const mb = downloads.megabytes(); say(mb ? `Loading… ${mb} MB` : 'Loading…'); };
    tick();
    const handle = setInterval(tick, 250);
    return () => clearInterval(handle);
  };
  const stopCounting = counting();
  const [frameBytes, clips, movie] = await Promise.all([
    fetchBytes(options.frameUrl, 'model', downloads),
    fetchBytes(options.clipsUrl, 'animation', downloads).then((bytes) => json<WebExportClips>(bytes)),
    options.movieUrl
      ? fetchBytes(options.movieUrl, 'movie', downloads, true).then((bytes) => (bytes ? json<BlenderSceneMovie | null>(bytes) : null)).catch(() => null)
      : Promise.resolve(null),
  ]).finally(stopCounting);
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
    animation = playAnimation(view, lookup, new Map(), { warn: (said) => console.warn(said), readMovie: async () => movie });
    const missing = (await animation.prepare()).failed;
    // biome-ignore lint/suspicious/noConsole: as above.
    if (missing.length > 0) console.warn(`The game starts without ${missing.length} clip(s): ${missing.join('; ')}`);
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: as above.
    console.error(`The game's animation could not be set up, so it plays without it: ${error instanceof Error ? error.message : String(error)}`);
    animation = undefined;
  }

  // THE PAGE'S LEVELS (`play.load`): a cook read once (and ahead, by `play.preload`), then built into
  // the same view the game runs in, its clips and movie becoming the run's animation
  const cooks = new Map<string, Promise<{ frame: { session: string }; clips: WebExportClips; movie: BlenderSceneMovie | null }>>();
  const readCook = (level: string) => {
    const levels = options.levels;
    if (!levels) return Promise.reject(new Error('This page bundles no levels.'));
    let cook = cooks.get(level);
    if (!cook) {
      cook = Promise.all([
        fetchBytes(levels.url(level, WEB_EXPORT_FRAME_FILE), `level ${level}`, downloads),
        fetchBytes(levels.url(level, WEB_EXPORT_CLIPS_FILE), `level ${level}'s animation`, downloads).then((bytes) => json<WebExportClips>(bytes)),
        fetchBytes(levels.url(level, WEB_EXPORT_MOVIE_FILE), `level ${level}'s movie`, downloads, true)
          .then((bytes) => (bytes ? json<BlenderSceneMovie | null>(bytes) : null)).catch(() => null),
      ]).then(([bytes, levelClips, levelMovie]) => ({ frame: decodeFrameFile(bytes) as { session: string }, clips: levelClips, movie: levelMovie }));
      cooks.set(level, cook);
      cook.catch(() => { if (cooks.get(level) === cook) cooks.delete(level); });
    }
    return cook;
  };
  const preloadLevel = async (level: string): Promise<void> => { await readCook(level); };
  // A level still downloading when the game asks for it shows its count over the stage (one read
  // ahead by `play.preload` is usually there already, and shows nothing); one that cannot be had
  // says why for a while, and the script's own catch decides what next (the bridge lets E try again)
  const waitForCook = async (level: string) => {
    const reading = readCook(level);
    const counter: { stop: (() => void) | null } = { stop: null };
    const shown = setTimeout(() => { status.style.display = 'flex'; counter.stop = counting(); }, 400);
    let erred = false;
    try {
      return await reading;
    } catch (error) {
      erred = true;
      counter.stop?.();
      counter.stop = null;
      say(error instanceof Error ? error.message : String(error));
      status.style.display = 'flex';
      status.style.color = '#ff8a80';
      setTimeout(() => { if (!failed) { status.style.display = 'none'; status.style.color = '#e6e6e6'; } }, 12000);
      throw error;
    } finally {
      clearTimeout(shown);
      counter.stop?.();
      if (!failed && !erred) status.style.display = 'none';
    }
  };
  const loadLevel = async (level: string) => {
    const cook = await waitForCook(level);
    cooks.delete(level);
    cook.frame.session = `level:${level}:${Date.now()}`;
    animation?.dispose();
    animation = undefined;
    view.applyFrame(cook.frame);
    await view.prepareRendered(camera, 'render');
    let next: PlayAnimation | undefined;
    try {
      next = playAnimation(view, (armature, action) => {
        const entry = cook.clips.armatures[armature]?.[action];
        if (typeof entry === 'number') return Promise.resolve(cook.clips.clips[entry] ?? null);
        return Promise.reject(new Error(typeof entry === 'string' ? entry : `${armature} / ${action} was not exported with level ${level}`));
      }, new Map(), { warn: (said) => console.warn(said), readMovie: async () => cook.movie });
      await next.prepare();
    } catch (error) {
      console.error(`Level ${level}'s animation could not be set up, so it plays without it: ${error instanceof Error ? error.message : String(error)}`);
      next = undefined;
    }
    animation = next;
    const script = options.levels!.script(level);
    return { animation: next, script: script ? await script : null, name: options.levels!.scriptName?.(level) ?? level };
  };

  const runner = options.runner({
    root: view.root,
    camera: () => camera,
    animation,
    ownMaterial: (material) => ownedSurfaceMaterial(material),
    report: fail,
    ...(options.levels ? { loadLevel, preloadLevel } : {}),
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
