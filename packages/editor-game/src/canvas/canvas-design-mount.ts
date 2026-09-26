/**
 * The canvas root's DESIGN-TIME mount — the game's own native world, on screen
 * and authorable in EDIT mode, with the host clock never advanced.
 *
 * ## Why this is a layer mount and not a second design session
 *
 * `r3f-design-session.ts` exists because a three world has to be ADOPTED into
 * the editor's own WebGL viewport: the editor already owns a renderer, a
 * camera and a raycaster, so the session mounts fiber against a mock renderer
 * and hands the resulting `THREE.Scene` to the store. None of that applies
 * here. A canvas world draws through its OWN substrate into its OWN
 * viewport-sized canvas. Pixi receives the editor's independent 2D Scene
 * camera; Babylon receives its native camera and GizmoManager. Neither path
 * reparents or mirrors the native entity tree.
 *
 * So this module is the `mountReactLayer` sibling, and it inherits that
 * module's whole lifecycle rather than restating one: candidate discovery,
 * the play handoff (layers torn down and the world's Boundary node restored
 * the instant play starts; Stop queues one edit-mode rebuild), the failure
 * degrade to a `BoundaryAuthoringAdapter` disclosure node, the pan
 * subscription, and the eye/interactive session toggles. `r3f-design-session`
 * says of its own play handoff that it "mirrors design-time-layers.ts"; this
 * lane uses the original instead of a second copy.
 *
 * ## The paused clock, stated once
 *
 * Pixi initializes its `Application` with `autoStart: false` and
 * `sharedTicker: false`; the ticker never starts and this module calls only
 * `app.render()`. Babylon receives `mounted.update(0)`, explicitly a zero-delta
 * still-frame request. Both paths render inspector and gizmo edits without
 * advancing game time. Same shape as the editor's own three viewport, which
 * also draws every frame over a scene nothing is ticking.
 *
 * ## Input is off
 *
 * The design host carries a REAL `Game` — the world's components read
 * `ctx.input`/`ctx.random`/`ctx.debug` at their first commit and a fabricated
 * stand-in would throw there — but `game.input.setEnabled(false)` is called
 * before the mount, because design time is not play. `InputManager` binds
 * window-level listeners in its constructor; `game.dispose()` unbinds them and
 * this module's disposer is what calls it.
 */

import { setActiveSystems, updateInstanceSystems } from '@volter/editor-sdk/kit/authoring/active-systems';
import {
  BabylonAuthoringAdapter,
  type BabylonEngineLike,
} from '../host/authoring/babylon-authoring-adapter';
import { PixiAuthoringAdapter } from '../host/authoring/pixi-authoring-adapter';
import { createOidCanvasIdentity } from '../host/authoring/pixi-source-identity';
import { createSourceCanvasWriteTarget } from '../host/authoring/pixi-source-write-target';
import {
  fitSceneView,
  registerStillFramePresenter,
} from '../host/authoring/pixi-still-presentation';
import { createCreationSitePersistence } from '../host/authoring/source-persistence-backend';
import {
  type RootViewController,
  sharedRootViewController,
} from '@volter/editor-sdk/kit/world-pan-state';
import {
  resolveCanvasEntryAdapterForEditor,
  resolveCanvasPixiForEditor,
} from '../host/canvas-entry-runtime';
import {
  capturePixiDisplayObjectThumbnail,
  withApplicationCollector,
} from '../host/canvas-preview-frames';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from '@volter/editor-threejs/kit/editor-shell-store';
import { authoringJournal } from '../host/history/json-history-resource';
import { getCurrentProject } from '@volter/editor-sdk/kit/project-manager';
import { beginProjectMountEpoch } from '@volter/editor-sdk/session/project-module-url';
import { activeRealmServices } from '../host/realm-services';
import { tierSourceWriteBackend } from '@volter/editor-sdk/kit/ui-source/tier-source-write-backend';
import type { AuthoringAdapter, MountedCanvasRoot } from '@volter/editor-project/adapter';
import {
  installNativeDebugBindings,
  installNativeSystemsBindings,
  nativeDebugBindingFromEntryModule,
  nativeSystemsBindingFromEntryModule,
} from '../runtime/adapter/native-debug-module';
import { createAssetCache } from '@volter/threejs-runtime/assets';
import { createGameLoop } from '../runtime/core/game-loop';
import { registerCanvasRoot } from '../runtime/create-runtime';
import { createGame, type GameInternal } from '../runtime/game';
import type { GameCanvasHostContext } from '../runtime/host-context';
import type { Application } from 'pixi.js';

/** What a design-time canvas layer hands back to `design-time-layers.ts`. */
export interface MountedCanvasDesignLayer {
  readonly adapter: AuthoringAdapter;
  dispose(): void;
}

/** Fallback stage size when the project declares no `resolution` — the same
 *  720p the canvas host defaults to elsewhere. */
const DEFAULT_STAGE = { width: 1280, height: 720 } as const;

/**
 * The inert design-time `Game`.
 *
 * A REAL `createGame` whose loop is constructed and NEVER started (the same
 * decision, for the same reason, as `r3f-design-session.ts`'s `createDesignHost`
 * and `design-time-layers.ts`'s `createDesignTimeGame`): the design-time Game
 * shell is what the lib-legal react doors (`useOptionalGame`,
 * `useDebugProvider`) resolve against, so a world whose components read the
 * game handle design-mounts exactly as it plays.
 */
function createDesignGame(): GameInternal {
  const game = createGame({
    loop: createGameLoop({ update: () => {} }),
    assets: createAssetCache(),
  });
  return game;
}

/** The viewport-sized surface the native stage draws into. World extents are
 * deliberately not encoded in this element: the editor camera matrix decides
 * which part of the unbounded authored plane is visible. */
function createDesignCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.dataset['vgaiCanvasSceneSurface'] = 'true';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  return canvas;
}

interface BabylonDesignMountOptions {
  readonly worldId: string;
  readonly entry: string;
  readonly layer: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly game: GameInternal;
  readonly mounted: MountedCanvasRoot;
  readonly store: EditorShellStore;
  readonly onFirstFrame?: (() => void) | undefined;
}

/** Babylon's native 3D Scene document. The host asks the mounted root to draw
 * a zero-delta still frame; simulation remains frozen, while native picking
 * and GizmoManager author the real Babylon nodes. */
function mountBabylonDesignLayer(options: BabylonDesignMountOptions): MountedCanvasDesignLayer {
  const { worldId, entry, layer, canvas, game, mounted, store, onFirstFrame } = options;
  const backend = createCreationSitePersistence({ history: store.shell.projectHistory });
  const adapter = new BabylonAuthoringAdapter(mounted.substrate.root as BabylonEngineLike, store, {
    canvas,
    api: mounted.substrate.api as never,
    persistence: backend,
    journal: authoringJournal(worldId),
    provenance: {
      source: 'source-code',
      label: 'babylon',
      detail:
        'Native Babylon.js scene graph; imperative edits write to the construction site in the game’s own source.',
    },
  });
  let publishedSystems = game.systemAdapters;
  setActiveSystems(publishedSystems);
  const unsubscribeSystemAdapters = game.subscribeSystemAdapters?.(() => {
    publishedSystems = game.systemAdapters;
    updateInstanceSystems(publishedSystems);
    store.shell.notifyIngestEdit();
  });
  const resize = (): void => {
    const rect = layer.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) mounted.resize?.(rect.width, rect.height);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(layer);
  resize();
  let disposed = false;
  let first = false;
  let frame = 0;
  const draw = (): void => {
    frame = requestAnimationFrame(draw);
    if (disposed) return;
    try {
      mounted.update?.(0);
      if (!first) {
        first = true;
        onFirstFrame?.();
      }
    } catch (error) {
      cancelAnimationFrame(frame);
      editorConsole.error(
        `[babylon-design] world "${worldId}" failed to render: ${String(error)}`,
        'authoring',
      );
    }
  };
  frame = requestAnimationFrame(draw);
  editorConsole.log(
    `[babylon-design] world "${worldId}" mounted as a native Babylon Scene (${entry})`,
    'authoring',
  );
  return {
    adapter,
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      adapter.dispose();
      unsubscribeSystemAdapters?.();
      setActiveSystems(null);
      mounted.dispose();
      canvas.remove();
      game.dispose();
    },
  };
}

/**
 * Mount one canvas root's world into `layer` for design-time authoring.
 *
 * Throws on any failure (a missing entry, a module that is neither shape, a
 * tree that crashes before its first commit — the canvas mount already
 * converts that last one into a named error rather than a hang). The caller
 * degrades a throw to the world's `BoundaryAuthoringAdapter` disclosure node.
 */
export async function mountCanvasDesignLayer(
  worldId: string,
  entry: string | undefined,
  layer: HTMLElement,
  projectRoot: string,
  store: EditorShellStore,
  suppliedView?: RootViewController,
  onFirstFrame?: () => void,
): Promise<MountedCanvasDesignLayer> {
  if (!entry) {
    throw new Error(`canvas root "${worldId}": no \`entry\` declared — nothing to mount.`);
  }

  // One epoch per design mount: this world shares no project module graph with
  // anything else (`ingest-siblings.ts`'s sibling layer does the same).
  const realm = await activeRealmServices(projectRoot, beginProjectMountEpoch());
  const entryModule = await realm.loadEntryModule(entry, worldId, 'canvas');

  const entryDebug = nativeDebugBindingFromEntryModule(worldId, entryModule);
  const entrySystems = nativeSystemsBindingFromEntryModule(worldId, entryModule, 'canvas');

  // Pixi and the reconciler are loaded ONLY when a project actually has a
  // canvas root: a static import would put them in every editor bundle,
  // including one opening a three-only project. Under the PACKAGED runtime the
  // adjudicator itself comes from the project's own Vite graph, so the adapter
  // it builds closes over the project's React/`@pixi/react`/`pixi.js` rather
  // than the prebuilt shell's — see `canvas-entry-runtime.ts`.
  const rootAdapter = await resolveCanvasEntryAdapterForEditor(entryModule, worldId);
  // THE namespace for everything this mount builds — see
  // `../../vite-plugin-module-doorways.ts`. Resolved beside the adjudicator
  // because it comes from the same graph the adjudicator does.
  if (!rootAdapter) {
    throw new Error(
      `canvas root "${worldId}": entry module "${entry}" must default-export a React component ` +
        '(`export default function World() { … }`) — or export an `adapter` for full control.',
    );
  }

  const activeProject = getCurrentProject();
  const width = activeProject?.config.resolution?.width ?? DEFAULT_STAGE.width;
  const height = activeProject?.config.resolution?.height ?? DEFAULT_STAGE.height;
  const view = suppliedView ?? sharedRootViewController;
  const canvas = createDesignCanvas();
  layer.appendChild(canvas);

  const game = createDesignGame();
  const host: GameCanvasHostContext = {
    canvas,
    width,
    height,
    game,
    headless: false,
    // The Scene grid is editor chrome behind native world content. Explicit
    // source-owned backgrounds still draw normally; the renderer itself must
    // not fabricate the runtime's opaque output surface over the grid.
    transparent: true,
    // Scene capture must photograph the exact PRESENTED frame, including this
    // document's independent editor-camera matrix. Registering the app with
    // the generic Pixi extraction seam would re-render its raw stage and omit
    // that presentation transform. This design-only renderer therefore keeps
    // its drawing buffer so the compositor reads the viewport canvas itself.
    preserveDrawingBuffer: true,
  };

  // The Pixi `Application`, when Pixi is the declared substrate. It is
  // collected through Pixi's own `__PIXI_APP_INIT__` hook; imperative adapters
  // such as Babylon simply leave this handle undefined.
  let mounted: MountedCanvasRoot;
  let app: Application | undefined;
  try {
    mounted = await withApplicationCollector(async (created) => {
      const result = await rootAdapter.mount(host);
      app = created[0];
      return result;
    });
  } catch (error) {
    canvas.remove();
    game.dispose();
    throw error;
  }
  registerCanvasRoot(game, rootAdapter, mounted, { id: worldId });
  installNativeDebugBindings(game, entryDebug ? [entryDebug] : []);
  installNativeSystemsBindings(game, entrySystems ? [entrySystems] : []);

  if (mounted.substrate.name === 'babylon') {
    return mountBabylonDesignLayer({
      worldId,
      entry,
      layer,
      canvas,
      game,
      mounted,
      store,
      onFirstFrame,
    });
  }
  if (mounted.substrate.name !== 'pixi') {
    mounted.dispose();
    canvas.remove();
    game.dispose();
    throw new Error(
      `canvas root "${worldId}" mounted undeclared editor substrate ` +
        `"${mounted.substrate.name}" — declare pixi or babylon and provide its authoring adapter.`,
    );
  }
  const stage = mounted.substrate.root as import('pixi.js').Container;
  const pixi = await resolveCanvasPixiForEditor();

  // A MOUNT WITHOUT AN APPLICATION IS A DESIGN VIEW THAT CAN NEVER DRAW, and it
  // used to say nothing at all: `renderScene()` below simply answers `false`
  // forever, the rAF loop spins, the capture door hands back a canvas nothing
  // ever rendered into, and the Scene reads as an empty grid over a world that
  // mounted perfectly. The hook is Pixi's own devtools global, so anything that
  // moves it (a Pixi upgrade, a second collector, a mount that never reaches
  // `Application.init`) breaks the handle without breaking the mount. Say so.
  if (app === undefined) {
    editorConsole.error(
      `[canvas-design] world "${worldId}" mounted, but its Pixi Application was never handed to ` +
        "the design view (Pixi's `__PIXI_APP_INIT__` hook did not report one) — this Scene will " +
        'render no frames at all. The world itself is fine; the editor cannot draw it.',
      'authoring',
    );
  }
  // This inert editor mount is still a real Game shell. Register its native
  // root so Game.systemAdapters sees the mounted bag, then publish that live
  // aggregate exactly as the R3F design session does. Without this, Canvas
  // authoring exists while system coverage reads an empty active plane and
  // fabricates a missing-debug warning over a registry the mount did create.
  let publishedSystems = game.systemAdapters;
  setActiveSystems(publishedSystems);
  const unsubscribeSystemAdapters = game.subscribeSystemAdapters?.(() => {
    publishedSystems = game.systemAdapters;
    updateInstanceSystems(publishedSystems);
    store.shell.notifyIngestEdit();
  });
  // THE canvas authoring adapter, on its two declared axes: oid identity (this
  // world's containers carry the `data-oid` the editor's transform stamped) and
  // a TSX-source persistence target. The very same class projects an ingested
  // game's stage, with the structural identity and the live-only target — the
  // adapter is keyed on the SURFACE, never on provenance.
  const writeBackend = await tierSourceWriteBackend();
  const adapter = new PixiAuthoringAdapter(stage, store, {
    pixi,
    identity: createOidCanvasIdentity(worldId),
    journal: authoringJournal(worldId),
    target: createSourceCanvasWriteTarget({
      worldId,
      entryPath: entry,
      pixi,
      writeBackend,
    }),
    surface: () => canvas,
    capturePreview: (object, size) => capturePixiDisplayObjectThumbnail(object, { ...size, pixi }),
    pointFromClient: (clientX, clientY, surfaceRect) => {
      const pose = view.get();
      return {
        x: (clientX - surfaceRect.left - pose.x) / pose.zoom,
        y: (clientY - surfaceRect.top - pose.y) / pose.zoom,
      };
    },
  });

  // The Pixi renderer belongs to the document viewport, not the game's
  // declared output resolution. Resize only presentation; the world mounted
  // against the real project width/height above and keeps those semantics.
  const resize = (): void => {
    const rect = layer.getBoundingClientRect();
    const renderer = app?.renderer;
    if (renderer && rect.width > 0 && rect.height > 0) renderer.resize(rect.width, rect.height);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(layer);
  resize();

  const renderScene = (): boolean => {
    const renderer = app?.renderer;
    if (!renderer) return false;
    const rect = layer.getBoundingClientRect();
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      (renderer.screen.width !== rect.width || renderer.screen.height !== rect.height)
    ) {
      renderer.resize(rect.width, rect.height);
    }
    const pose = view.get();
    renderer.render({
      container: stage,
      // The world's OWN `Matrix` — this value is handed to the world's own
      // renderer, which is free to type-check what it is given.
      transform: new pixi.Matrix(pose.zoom, 0, 0, pose.zoom, pose.x, pose.y),
    });
    return true;
  };

  const unregisterPresented = registerStillFramePresenter(canvas, renderScene);

  // THE PAUSED CLOCK (see this module's header): draw, never advance. A frame
  // costs one render of a still stage and stops the moment the tab is hidden,
  // because that is what `requestAnimationFrame` does.
  let frame = 0;
  let disposed = false;
  let firstFrameReported = false;
  const draw = (): void => {
    frame = requestAnimationFrame(draw);
    if (disposed) return;
    try {
      const rendered = renderScene();
      if (rendered && !firstFrameReported) {
        firstFrameReported = true;
        onFirstFrame?.();
      }
    } catch (error) {
      cancelAnimationFrame(frame);
      frame = 0;
      editorConsole.error(
        `[canvas-design] world "${worldId}" failed to render — the design view is frozen: ${String(error)}`,
        'authoring',
      );
    }
  };
  frame = requestAnimationFrame(draw);

  // Open on the authored WORLD, not on the declared output rectangle. Content
  // may arrive after an atlas resolves, so keep a short frame window open
  // until real bounds exist. Any user navigation cancels it immediately.
  const initialRect = layer.getBoundingClientRect();
  if (initialRect.width > 0 && initialRect.height > 0) {
    view.setView(initialRect.width / 2, initialRect.height / 2, 1);
  }
  let openingFit = 0;
  let openingAttempts = 0;
  let openingCancelled = false;
  const stopOpeningOnNavigation = view.subscribe(() => {
    openingCancelled = true;
  });
  // …but never SMALLER than the player's own view of it. Fitting the whole
  // world let a 1792×1280 floor open the survivor example at 26–34 %, where
  // the 48 px hero is ~13 screen px on a busy grid: a tester read the scene as
  // "only an infinite grid, nothing selectable" while the hero was drawn at
  // the origin the whole time (runhuman pass 123; reproduced 2026-09-02). The
  // declared resolution is what the player sees, so the zoom that frames IT
  // is the floor: a world larger than the screen opens at screen scale,
  // centred on the world; a smaller world still fills the pane as before.
  // MEASURED after the first cut (which floored at the declared-resolution
  // fit): the default dock leaves a 700×898 pane, the 1280×720 frame fits it
  // at 47 %, and the 48 px hero was a 6 px speck — an improvement on 26 %
  // and still a bare grid (build-45 gate, 2026-09-02). The player's view is
  // 1:1 pixels, so the floor is 1:1: a big world opens at native scale,
  // cropped to the pane around the world's centre — the hero at the origin,
  // the floor art at its own size — and the author zooms out on purpose. A
  // world that fits the pane at more than 1:1 still fills it, as before.
  const declaredFitZoom = (): number => {
    const rect = layer.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return 1;
    return Math.max(1, Math.min((rect.width - 96) / width, (rect.height - 96) / height));
  };
  const tryOpeningFit = (): void => {
    if (openingCancelled || disposed || openingAttempts++ > 180) return;
    const bounds = stage.getBounds();
    if (fitSceneView(layer, bounds, view, declaredFitZoom())) return;
    openingFit = requestAnimationFrame(tryOpeningFit);
  };
  openingFit = requestAnimationFrame(tryOpeningFit);

  editorConsole.log(
    `[canvas-design] world "${worldId}" mounted for design-time authoring (${entry})`,
    'authoring',
  );

  return {
    adapter,
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(openingFit);
      stopOpeningOnNavigation();
      resizeObserver.disconnect();
      unregisterPresented();
      adapter.dispose();
      unsubscribeSystemAdapters?.();
      setActiveSystems(null);
      try {
        mounted.dispose();
      } catch (error) {
        editorConsole.error(`[canvas-design] dispose failed: ${String(error)}`, 'authoring');
      }
      canvas.remove();
      game.dispose();
    },
  };
}
