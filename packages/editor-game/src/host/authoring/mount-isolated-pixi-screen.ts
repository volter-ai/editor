/**
 * DESIGN-TIME isolation of a Pixi screen CLASS — Edit mounts the piece
 * on the same Scene camera first-party canvas Edit uses
 * (`canvas-design-mount.ts`).
 *
 * The construct keeps its authored stage size. The viewport is a presentation
 * surface: the editor camera frames it, wheel zooms, and the grid shows
 * around it. The pane is never the game's output rectangle — that is how a
 * letterboxed 1280×720 screen made zoom a no-op.
 *
 * `new Ctor()`, settle at rest. No ticker, no `show()` (GameScreen.show
 * starts the match). The live ingest host is not used.
 */

import type { Application, Container } from 'pixi.js';
import { type CanvasPixiNamespace, resolveCanvasPixiForEditor } from '../canvas-entry-runtime';
import { createWithOwnedPixiTickerListeners } from './owned-pixi-ticker-listeners';
import { initializePixiIsolationAssets } from './pixi-isolation-assets';
import { fitSceneView, registerStillFramePresenter } from './pixi-still-presentation';
import type { RootViewController } from '@volter/editor-core/authoring/world-pan-state';

export type IsolatedPixiScreenCtor = (new () => IsolatedPixiScreen) & {
  readonly assetBundles?: readonly string[];
};

export type IsolatedPixiScreen = Container & {
  prepare?(data: unknown): void;
  resize?(width: number, height: number): void;
};

const EMPTY_RESULT = { score: 0, popped: 0, combo: 0, powerups: 0, highscore: 0 };

type PoseNode = {
  x: number;
  y: number;
  alpha: number;
  readonly children?: readonly PoseNode[];
};

/**
 * Isolation shows the CONSTRUCT at rest, not the intro tween and not the
 * running match.
 *
 * `prepare` is the game's pre-show hook: Result fills labels; Title parks
 * intro groups off-screen pending `show()`. Snapshot the constructed pose,
 * let prepare write data, then restore pose and keep alpha 1. Never call
 * `show()` — that starts the match / starts tweens.
 */
export function settleIsolatedScreen(screen: IsolatedPixiScreen): void {
  const poses = snapshotPoses(screen as PoseNode);
  screen.prepare?.(EMPTY_RESULT);
  restorePoses(screen as PoseNode, poses);
  screen.alpha = 1;
}

function snapshotPoses(node: PoseNode): Map<PoseNode, { x: number; y: number; alpha: number }> {
  const out = new Map<PoseNode, { x: number; y: number; alpha: number }>();
  const walk = (current: PoseNode) => {
    out.set(current, { x: current.x, y: current.y, alpha: current.alpha });
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return out;
}

function restorePoses(
  node: PoseNode,
  poses: Map<PoseNode, { x: number; y: number; alpha: number }>,
): void {
  const pose = poses.get(node);
  if (pose) {
    node.x = pose.x;
    node.y = pose.y;
    node.alpha = pose.alpha;
  }
  for (const child of node.children ?? []) restorePoses(child, poses);
}

/**
 * Authored stage size — the construct's own units, never the pane.
 *
 * Height is the Bubbo HUD's design content height (925). Isolation used to
 * resize to 720, so `windowHeight - content.height` went negative, the
 * thin-screen Title sat above the stage, and opening-fit of `getBounds()`
 * zoomed the camera out around that off-screen wordmark.
 */
export const ISOLATED_PIXI_STAGE = { width: 1280, height: 925 } as const;

/** The Scene camera frames this rectangle, not the AABB of every child. */
export function isolatedStageBounds(): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return { x: 0, y: 0, width: ISOLATED_PIXI_STAGE.width, height: ISOLATED_PIXI_STAGE.height };
}

export interface MountedIsolatedPixiScreen {
  readonly canvas: HTMLCanvasElement;
  readonly app: Application;
  readonly screen: IsolatedPixiScreen;
  /** The namespace this screen was constructed and rendered in — the caller's
   *  authoring adapter and preview take the SAME one. */
  readonly pixi: CanvasPixiNamespace;
  dispose(): void;
}

export interface MountIsolatedPixiScreenOptions {
  readonly initAssets?: () => Promise<void>;
  /** Project-relative identity of the module behind `initAssets`. */
  readonly assetSourcePath?: string;
  /** Adapter-declared prerequisite for constructing this isolated piece. */
  readonly isolationSetup?: () => void | Promise<void>;
  /** The document's independent Scene camera. Required: isolation is a
   *  Scene-camera piece, not a letterboxed output. */
  readonly view: RootViewController;
  /** Already-mounted document pane the viewport canvas draws into. */
  readonly layer: HTMLElement;
}

/** Frame authored bounds in the Scene camera — the shared design-time fit
 *  (`pixi-still-presentation.ts`), re-exported under this mount's own name for
 *  its existing callers. */
export const fitIsolatedSceneView = fitSceneView;

export async function mountIsolatedPixiScreen(
  Ctor: IsolatedPixiScreenCtor,
  options: MountIsolatedPixiScreenOptions,
): Promise<MountedIsolatedPixiScreen> {
  const { view, layer } = options;
  const stage = ISOLATED_PIXI_STAGE;
  // THE namespace: `Ctor` is one of the GAME's own classes, loaded through the
  // project graph, so its `pixi.js` is the project's under the packaged
  // runtime. Everything this mount builds around it — the Application that
  // draws it, the `Assets` bundles it needs, the `Ticker.shared` whose
  // constructor-time registrations are withheld, the presentation Matrix —
  // has to be that same one. See `../../vite-plugin-module-doorways.ts`.
  const pixi = await resolveCanvasPixiForEditor();
  const app = new pixi.Application();
  await app.init({
    autoStart: false,
    sharedTicker: false,
    backgroundAlpha: 0,
    width: stage.width,
    height: stage.height,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  const canvas = app.canvas as HTMLCanvasElement;
  canvas.dataset['vgaiCanvasSceneSurface'] = 'true';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  layer.appendChild(canvas);

  if (options.initAssets) {
    await initializePixiIsolationAssets(
      options.assetSourcePath ?? options.initAssets.name,
      options.initAssets,
    );
  }
  if (Ctor.assetBundles && Ctor.assetBundles.length > 0) {
    await pixi.Assets.loadBundle([...Ctor.assetBundles]);
  }
  await options.isolationSetup?.();
  const ownedScreen = createWithOwnedPixiTickerListeners(() => {
    const isolated = new Ctor();
    // `prepare` is part of constructing the at-rest authoring document and may
    // schedule delayed GSAP work (Bubbo's Porthole does). Keep it inside the
    // owned-clock window so teardown can kill that work before Play begins.
    settleIsolatedScreen(isolated);
    return isolated;
  }, pixi);
  const screen = ownedScreen.value;
  app.stage.addChild(screen);
  // World size once. The pane is the camera, not a second resolution.
  screen.resize?.(stage.width, stage.height);

  const resizeRenderer = (): void => {
    const rect = layer.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const renderer = app.renderer;
    if (renderer.screen.width !== rect.width || renderer.screen.height !== rect.height) {
      renderer.resize(rect.width, rect.height);
    }
  };

  const renderScene = (): boolean => {
    const renderer = app.renderer;
    if (!renderer) return false;
    resizeRenderer();
    const pose = view.get();
    renderer.render({
      container: app.stage,
      transform: new pixi.Matrix(pose.zoom, 0, 0, pose.zoom, pose.x, pose.y),
    });
    return true;
  };

  const unregisterPresented = registerStillFramePresenter(canvas, renderScene);

  let frame = 0;
  let disposed = false;
  const draw = (): void => {
    frame = requestAnimationFrame(draw);
    if (disposed) return;
    renderScene();
  };
  frame = requestAnimationFrame(draw);

  const observer = new ResizeObserver(() => {
    if (disposed) return;
    renderScene();
  });
  observer.observe(layer);

  let openingFit = 0;
  let openingAttempts = 0;
  let openingCancelled = false;
  const stopOpeningOnNavigation = view.subscribe(() => {
    openingCancelled = true;
  });
  const tryOpeningFit = (): void => {
    if (openingCancelled || disposed || openingAttempts++ > 180) return;
    if (fitIsolatedSceneView(layer, isolatedStageBounds(), view)) return;
    openingFit = requestAnimationFrame(tryOpeningFit);
  };
  openingFit = requestAnimationFrame(tryOpeningFit);

  return {
    canvas,
    app,
    screen,
    pixi,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(openingFit);
      stopOpeningOnNavigation();
      observer.disconnect();
      unregisterPresented();
      ownedScreen.dispose();
      app.destroy(true, { children: true });
      canvas.remove();
    },
  };
}
