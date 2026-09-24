/**
 * Mount a `{ ingest }` root on the CANVAS surface — the sibling of
 * `mount-three-ingest-root.ts` on the canvas substrate.
 *
 * `resolveIngest2DDescriptor` (ingest/resolve-canvas.ts) builds an `IngestGame2D`
 * straight from a canvas-surface manifest root, and `mountIngestGame2D` runs
 * the game's own modules in the editor's realm with the Pixi render trap
 * installed. A canvas root says `canvas`; WHICH library draws on it is a fact
 * about the live realm, never a manifest claim, so the mount RECOGNIZES it:
 *
 *  - the host's pixi captured a frame -> the live canvas authoring adapter;
 *  - otherwise `authoring/canvas-runtime-recognition.ts` reads the runtimes'
 *    own public registries -> `PhaserLiveAuthoringAdapter` /
 *    `BabylonAuthoringAdapter`;
 *  - nothing recognized -> the mount FAILS BY NAME.
 *
 * Every branch installs the SAME full `AuthoringAdapter` contract — no
 * separate editor data model, no fallback. A
 * runtime the host cannot recognize is never presented as one it is not, nor
 * as an editable tree the editor fabricated.
 */

import { measureAdapterReach } from '../host/adapter-reach';
import { nextPaint } from '../host/after-paint';
import { setActiveAuthoring } from '@volter/editor-core/authoring/active-adapter';
import { setActiveSystems } from '@volter/editor-core/authoring/active-systems';
import { BabylonAuthoringAdapter } from '../host/authoring/babylon-authoring-adapter';
import {
  type BabylonRealmLike,
  findBabylonEngine,
  findPhaserGame,
  type PhaserRealmLike,
} from '../host/authoring/canvas-runtime-recognition';
import {
  type ContractScenesStories,
  createContractScenesStories,
} from '../host/authoring/contract-scenes-stories';
import { clearMountFailureReports } from '@volter/editor-sdk/kit/mount-failure-report';
import { PhaserLiveAuthoringAdapter } from '../host/authoring/phaser-live-authoring-adapter';
import { PixiAuthoringAdapter } from '../host/authoring/pixi-authoring-adapter';
import { createCreationSiteCanvasWriteTarget } from '../host/authoring/pixi-creation-site-write-target';
import { resolveCanvasPixiForEditor } from '../host/canvas-entry-runtime';
import {
  capturePixiDisplayObjectThumbnail,
  registerPresentedPixiApps,
} from '@volter/editor-core/canvas-preview-frames';
import { editorConsole } from '@volter/editor-core/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { GAME_SURFACE_CONTAINMENT_CSS } from '../host/game-realm-page';
import {
  clearGameSurface,
  gameLoopGate,
  setGameInputGate,
  setGameSurface,
} from '../host/gated-globals';
import { authoringJournal } from '../host/history/json-history-resource';
import { acquireLiveDocument, liveDocumentContainer } from '@volter/editor-core/live-document';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import { recordRootReadiness } from '@volter/editor-sdk/kit/readiness';
import type { MeasuredLoop } from '../host/same-realm-loop-gate';
import { projectContractSystemAdapters } from '@volter/game-runtime/adapter/ingest/contract-system-adapters';
import type { RenderDebugWiring } from '@volter/game-runtime/dev/render-debug-adapter';
import type { IngestGame2D } from '@volter/game-runtime/pixi/ingest';
import { INGEST_GAME_2D_LOAD_ERROR_NAME, mountIngestGame2D } from '@volter/game-runtime/pixi/ingest';
import { createPhysics2DRegistry } from '@volter/game-runtime/pixi/physics-registry';
import { installPixiRenderPassBracket } from '@volter/game-runtime/pixi/render-pass-bracket';
import {
  composePhysicsAdapters2D,
  createPhysicsAdapter2D,
  type PhysicsAdapter2D,
} from '@volter/game-runtime/pixi/system-adapters';
import type { AuthoringAdapter } from '@volter/editor-project/adapter/authoring';
import { readGameReady } from '@volter/editor-project/adapter/ingest/game-contract';
import { displayKeyedPhysics } from '@volter/editor-project/adapter/system-adapter';
import type { ResolvedAdapterRoot } from '@volter/editor-project/manifest/load';
import type { Application, Container } from 'pixi.js';
import { serializeEntry, setActiveIngest } from './active-ingest';
import { withDetectedDomSurface } from './authoring/ingest-dom-surface-authoring';
import { setCaptureWait } from './capture-wait-report';
import { ingestGameRealmWindow, readIngestGameContract } from './game-contract-realm';
import { repaintHeldSceneSwitch } from './held-scene-repaint';
import { claimUnresizedSurfaceBox } from './host-surface-box';
import { landIngestBootInEdit } from './ingest-boot-viewport';
import { installIngestCanvasScene } from './ingest-canvas-scene-document';
import { ingestHookEvidence, publishIngestHook } from './ingest-evidence-hook';
import { bindIngestLifecycle, ingestPlaying } from './ingest-play-control';
import { wireIngestSystems } from './ingest-render-debug';
import { LOOP_PROBE_ABSENT, recordMountCoverage } from './mount-coverage';
import { resolveIngest2DDescriptor } from './resolve-canvas';
import { getIngestGame2D } from './surface-canvas';
import { exitActiveIngest } from './unmount-ingest-root';

/** How this mount reached the game's runtime, in the words a capability
 *  warning hands the reader. Mechanism only — never a grade. */
const CAPTURE_MECHANISM = "this game imports the host's pixi directly, in the editor's own realm";

/** What the pixi branch's render-debug wiring hands back to the mount, so the
 *  session's ONE teardown path can end both halves of it. */
interface CanvasRenderDebugHandle {
  readonly wiring: RenderDebugWiring | null;
  /** Takes the bracket back off the renderer's runners. */
  readonly uninstall: () => void;
}

/**
 * Publish the game's DECLARED system surface — the line this lane was missing.
 *
 * A canvas ingest used to hand `setActiveSystems({})` unconditionally, so
 * `game.commands()`/`game.state()`/`game.waitSimTime()` had nothing to answer
 * for EVERY canvas ingest, including one that declared a full contract. That is
 * not the same as the honest empty: `command-listener.ts` already refuses those
 * calls over a plane-less ingest by naming the missing plane, and that refusal
 * stays exactly right for a game that declares nothing. What was wrong is that
 * a game which DID declare could not be heard — a lane you can see but cannot
 * DRIVE.
 *
 * `wireIngestSystems` (`ingest/ingest-render-debug.ts`) is the ONE assembly
 * point, shared with the three lane, so a shim never learns which surface it is
 * beside and no second assembly can publish a different surface from the same
 * declaration.
 *
 * `renderDebug` is ENGINE-owned on both surfaces — no game declares it — and
 * this lane reaches it through `renderer`: the captured Pixi renderer's own
 * WebGL2 context is what the GL-level frame capture instruments, and its own
 * `prerender`/`postrender` runners are the bracket. Passed `undefined` (the
 * recognized Phaser/Babylon branch, where the host's pixi captured nothing) the
 * slot stays absent, which is the honest answer and not a degraded one.
 */
function publishCanvasIngestSystems(
  gameName: string,
  renderer: unknown,
  physics: PhysicsAdapter2D | null,
): CanvasRenderDebugHandle {
  const contractSystems = readIngestGameContract()?.systems;
  let uninstallBracket: (() => void) | null = null;
  const { systems, renderDebug, debugCollisions } = wireIngestSystems({
    contractSystems,
    surface: 'canvas',
    ...(physics ? { physics } : {}),
    ...(renderer ? { canvasRuntime: { renderer } } : {}),
    // The bracket is this surface's own seam. `wireIngestSystems` decides WHAT
    // goes in the pass; the renderer's runners decide WHEN the pass is.
    setRenderPassHooks: (hooks) => {
      uninstallBracket?.();
      uninstallBracket = hooks ? installPixiRenderPassBracket(renderer, hooks) : null;
    },
  });
  setActiveSystems(systems);
  editorConsole.log(
    contractSystems
      ? `canvas ingest: "${gameName}" declares the vgai game contract — ` +
          `${contractSystems.commands?.length ?? 0} commands, ` +
          `${contractSystems.state?.length ?? 0} state providers`
      : `canvas ingest: "${gameName}" declares no vgai game contract — game.commands()/` +
          'game.state() have nothing to answer and will refuse by naming that',
    'ingest',
  );
  // A name two feeders both declare is REFUSED when called, by a coded error
  // naming both. Said here too, because a refusal nobody sees until they call
  // the name is a defect that ships.
  for (const collision of debugCollisions) {
    editorConsole.error(`canvas ingest: "${gameName}" — ${collision}; it will refuse`, 'ingest');
  }
  if (renderer) {
    editorConsole.log(
      renderDebug
        ? `canvas ingest: "${gameName}" render debugging is live — the Frame debugger captures ` +
            "through the game's own Pixi renderer (draws are unattributed: Pixi's batcher " +
            'merges display objects, so no display object is the author of a draw)'
        : `canvas ingest: "${gameName}" has no render-debug capability — its renderer exposes ` +
            'no real WebGL2 context, or no prerender/postrender runners to bracket',
      'ingest',
    );
  }
  return { wiring: renderDebug, uninstall: () => uninstallBracket?.() };
}

/**
 * TWO failures, TWO sentences.
 *
 * `mountIngestGame2D` already distinguishes them — `IngestGame2DLoadError`
 * when the game's own modules never ran, a spent capture window when they ran
 * and nothing drew — and the mount's one catch used to flatten both into the
 * capture trap's words: "the host's pixi captured no frame … or it bundles its
 * own (un-shared) copy of pixi.js". That sentence names a module-IDENTITY
 * defect and sends the reader to `vite-plugin-module-doorways.ts`. MEASURED on
 * a packaged build whose real cause was a JSX-bearing `.js` module this host
 * had no transform for: the console said un-shared pixi, the network said
 * "Failed to fetch dynamically imported module … /src/game.js".
 */
function unrecognizedCanvasMountMessage(gameId: string, failure: unknown): string {
  if (failure instanceof Error && failure.name === INGEST_GAME_2D_LOAD_ERROR_NAME) {
    return (
      `canvas ingest: game "${gameId}" never ran — its own modules failed to load, so nothing ` +
      `could render and there is no canvas runtime in the realm to recognize (${failure})`
    );
  }
  return (
    `canvas ingest: game "${gameId}" mounted no recognized canvas runtime — the host's pixi ` +
    'captured no frame, and the realm holds no Phaser game or Babylon.js engine on their ' +
    `own public registries either (${failure})`
  );
}

function rendererCanvasBelongsToHost(renderer: unknown, hostEl: HTMLElement): boolean {
  const canvas = (renderer as { canvas?: unknown } | null)?.canvas;
  return canvas instanceof Node && hostEl.contains(canvas);
}

/**
 * The physics carrier THIS GAME declared, in the canvas surface's own
 * (Container-keyed) vocabulary — or `null` when it declared none.
 *
 * The projection is the ONE validator: presence + typeof for the four members,
 * plus the keying check that makes a node-id-keyed declaration on this surface
 * `malformed` by name instead of a bound shape nothing here can call
 * (`@volter/game-runtime/adapter/ingest/contract-system-adapters`). Both verdicts reach
 * the reader through the coverage row for `system.physics`, so a refusal here
 * is never silent.
 */
function declaredCanvasPhysics(): PhysicsAdapter2D | null {
  return displayKeyedPhysics(
    projectContractSystemAdapters(readIngestGameContract()?.systems, 'canvas').bound.physics,
  );
}

/** A canvas runtime the host RECOGNIZED in the live realm, with the structural
 *  authoring adapter that projects it. Nothing here is derived from the
 *  manifest, the mount route or the game's id. */
interface RecognizedCanvasRuntime {
  readonly runtime: 'phaser' | 'babylon';
  readonly adapter: AuthoringAdapter & { dispose(): void; refresh(): unknown };
  /** Words a capability warning hands the reader — mechanism only. */
  readonly mechanism: string;
}

/**
 * Ask the REALM which non-pixi canvas runtime it actually contains, through
 * `authoring/canvas-runtime-recognition.ts`'s reads of the runtimes' own public
 * registries. `null` means the host recognizes nothing here — which fails the
 * mount by name at the call site.
 */
function recognizeStructuralCanvasRuntime(
  store: EditorShellStore,
  realm: PhaserRealmLike & BabylonRealmLike,
): RecognizedCanvasRuntime | null {
  const phaserGame = findPhaserGame(realm);
  if (phaserGame) {
    return {
      runtime: 'phaser',
      adapter: new PhaserLiveAuthoringAdapter(phaserGame, store),
      mechanism:
        "this game runs its own Phaser instance in the editor's own realm; the host reads " +
        'that live game’s active scenes and display lists',
    };
  }
  const babylonEngine = findBabylonEngine(realm);
  if (babylonEngine) {
    return {
      runtime: 'babylon',
      adapter: new BabylonAuthoringAdapter(babylonEngine, store),
      mechanism:
        "this game runs its own Babylon.js engine in the editor's own realm; the host reads " +
        'that live engine’s scenes and root nodes',
    };
  }
  return null;
}

/**
 * Publish a recognized non-pixi canvas runtime as the live ingest session —
 * the same session/authoring/coverage/hook handoff the pixi branch performs,
 * over that runtime's own structural adapter.
 *
 * Pause runs through the same-realm loop gate (`gated-globals.ts` installs it
 * over the game module's scheduling entry points), which is a real hold rather
 * than a button that lies. No probe has measured that hold on this route, so
 * the loop verdict stays `null` — unmeasured is its own answer.
 */
function publishStructuralCanvasRuntime(
  store: EditorShellStore,
  game: IngestGame2D,
  sessionId: string,
  hostEl: HTMLElement,
  recognized: RecognizedCanvasRuntime,
): void {
  const rawAuthoring = recognized.adapter;
  rawAuthoring.refresh();
  const adapter = withDetectedDomSurface({
    primary: rawAuthoring,
    worldId: sessionId,
    hostEl,
    store,
  });

  const gate = gameLoopGate();
  const loopFacts = (): { loop: MeasuredLoop | null; reason: string } =>
    gate
      ? {
          loop: null,
          reason:
            'the same-realm loop gate holds this game’s scheduling, but no probe has measured ' +
            'that control on this route',
        }
      : { loop: null, reason: LOOP_PROBE_ABSENT };
  const lifecycle = bindIngestLifecycle(
    gate
      ? {
          setPaused: (paused) => {
            if (paused) gate.hold();
            else gate.release();
          },
        }
      : {
          pauseGap: `${recognized.runtime} exposes no host-controlled loop gate`,
        },
  );

  let disposeScene = () => {};
  setActiveIngest({
    kind: 'canvas',
    session: {
      store,
      adapter: rawAuthoring,
      hostEl,
      lifecycle,
      loop: loopFacts,
      // The ONE teardown path for the surface this branch inherited (see the
      // ownership block in `mountCanvasIngestRootInner`).
      dispose: () => {
        disposeScene();
        rawAuthoring.dispose();
        clearGameSurface();
        hostEl.remove();
      },
    },
    siblings: [],
    worldId: sessionId,
  });
  disposeScene = installIngestCanvasScene(store);

  setGameInputGate(() => store.playState === 'playing' && store.activeViewportTab === 'play');
  setActiveAuthoring(adapter);
  // No captured Pixi renderer on this branch — the host's pixi drew nothing, so
  // there is no context to instrument, no runner pair to bracket, and no
  // host-owned registry carrier to compose with either: what the game itself
  // declared is the only physics this route can have.
  publishCanvasIngestSystems(game.name, undefined, declaredCanvasPhysics());
  landIngestBootInEdit(store);
  store.notifyIngestEdit();
  clearMountFailureReports();

  recordMountCoverage({
    reach: measureAdapterReach({ authoring: adapter }),
    reachMechanism: recognized.mechanism,
    loop: loopFacts,
  });

  editorConsole.log(
    `canvas ingest: recognized ${recognized.runtime} in the realm and captured "${game.name}"`,
    'ingest',
  );

  publishIngestHook('__vgaiIngest2D', {
    gameId: sessionId,
    ...ingestHookEvidence(adapter),
    runtime: recognized.runtime,
    // Live for the same reason the pixi branch's is: the game keeps building
    // its tree after the mount, so a snapshot goes stale immediately.
    get reflected() {
      return rawAuthoring.refresh();
    },
    ...(lifecycle.setPaused ? { setPaused: lifecycle.setPaused } : {}),
    reach: measureAdapterReach({ authoring: adapter }),
    adapter,
    store,
  });
}

async function mountCanvasIngestRootInner(
  store: EditorShellStore,
  game: IngestGame2D,
  sessionId: string,
): Promise<void> {
  // D-V1: tear down WHATEVER kind is currently active, not just a prior
  // pixi session — closes the cross-kind leak (F26 residual).
  exitActiveIngest();

  // The Game document exists only while a runtime does, so install it (and
  // wait for its panel to commit) before reading the container it owns.
  await acquireLiveDocument();
  const gameContainer = liveDocumentContainer();
  if (!gameContainer) {
    editorConsole.error('Game container not mounted — cannot ingest (canvas)', 'ingest');
    return;
  }

  store.setPlayState('playing');
  editorConsole.log(`Ingesting unmodified PixiJS game: ${game.name}`, 'ingest');

  // PD-3: READINESS, RECORDED. The three lane's self-booting mount has always
  // written this row (`authoring/ingest-root-adapter.ts`); the canvas lane
  // never did, so a Pixi ingest was simply MISSING from the `readiness` facet —
  // and a missing row is indistinguishable from a root nobody has asked about,
  // which is the exact ambiguity the facet exists to remove.
  //
  // The mechanism is read the same way the three lane reads it, off the game's
  // OWN contract, because `ReadinessMechanism` names HOW readiness is answered
  // and there are exactly three answerers (see `readiness.ts`'s header). A lane
  // name would be a fourth value on a different axis — which root mounted it is
  // already knowable from the root itself.
  const declaredReady = readGameReady(readIngestGameContract());
  if (declaredReady.malformed !== null) {
    // Same sentence the three lane says (`ingest-root-adapter.ts`): a broken
    // declaration is loud, and the host measures instead.
    editorConsole.error(
      `Ingest game "${game.id}" ${declaredReady.malformed} — the host is measuring readiness ` +
        'instead.',
      'ingest',
    );
  }
  const readinessMechanism = declaredReady.ready === null ? 'measured-wait' : 'contract-ready';
  const readinessSource = declaredReady.ready === null ? 'measured' : 'declared';
  recordRootReadiness({
    rootId: game.id,
    mechanism: readinessMechanism,
    source: readinessSource,
    state: 'waiting',
  });

  // ## RESOURCE OWNERSHIP — the host surface for a canvas ingest
  //
  // OWNER: this mount. SHARERS: the game's realm (it sees `hostEl` as
  // `document.body`, via `setGameSurface`) and the pixel doors (they read the
  // game's `Application` through `registerPresentedPixiApps`). ONE teardown
  // path: the session's `dispose()` below, which unregisters the app, clears
  // the realm surface and removes `hostEl` — removing the surface removes the
  // game's ENTIRE DOM with it. The two early-exit paths (a recognized non-pixi
  // runtime, and nothing recognized) hand that same teardown on or run it
  // before throwing; nothing else may end this surface.
  //
  // THE GAME'S PAGE IS THIS BOX, from before its first module runs — the exact
  // adoption the three ingest mount performs
  // (`authoring/ingest-root-adapter.ts`, `game-realm-page.ts` reason 1), and
  // its absence here is why an ingested Pixi game's canvas landed at PAGE
  // level, below the editor's fold: MEASURED on the `flappy` fixture, a
  // `body > canvas` at y=915 while the Game pane held an empty 300x150
  // placeholder — so every pixel door photographed the placeholder and every
  // one of them was honestly blank.
  //
  // The `background` is the LETTERBOX. Because this lane never re-resolves the
  // game's renderer, a game whose aspect differs from the pane's leaves margins
  // (`ingest/host-surface-box.ts`), and margins with no background are alpha-0
  // in every capture — a region whose appearance is whatever the viewer happens
  // to composite it over, and which reads as 64% #000000 to the frame's own
  // flatness check. Black is both the letterbox convention and an answer the
  // screen and the photograph agree on. It is a DEFAULT, not a claim: this
  // element is the game's `document.body` in-realm, so a game that paints its
  // own page background still wins.
  const hostEl = document.createElement('div');
  hostEl.id = 'container';
  hostEl.style.cssText = `position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#000;${GAME_SURFACE_CONTAINMENT_CSS}`;
  gameContainer.appendChild(hostEl);
  setGameSurface(hostEl);
  // Same scoped-CSS contract the three lane holds (ingest-root-adapter.ts):
  // the surface is the scope root, and the project's declared page sheet is
  // installed BEFORE the game's entry runs so its first paint is styled.
  // Measured missing here: babylon-space-truckers' declared canvas{100%}
  // sizing never loaded on the canvas lane, leaving the game a default
  // 300x150 canvas in the pane corner (2026-08-28).
  {
    const { markGameCssScope } = await import('@volter/editor-sdk/session/game-css-scope');
    markGameCssScope(hostEl);
    const scopedCssProject = getCurrentProject();
    if (scopedCssProject) {
      const { ensureScopedGameStyles } = await import('@volter/editor-core/scoped-game-css');
      await ensureScopedGameStyles(scopedCssProject.rootPath);
    }
  }

  // F26: same cold-mount announcement the three adapter makes
  // (ingest-root-adapter.ts) — a pixi game may declare the game contract and
  // defer its session until ▶; games that ignore the flag behave as before.
  (window as unknown as { __vgaiMountCold?: boolean }).__vgaiMountCold = true;
  // THE namespace the game's own modules will resolve `pixi.js` to.
  //
  // `installSceneCapture2D` wraps `Application.prototype.render` on the
  // namespace it is handed, and the engine states the invariant in its own
  // header: the trap must be installed on the SAME `pixi.js` module instance
  // the game uses, or the game "cannot be captured at all, and its mount fails
  // by name". Under the packaged runtime the game's entry is served as
  // `/@fs/<project>/…` by the PROJECT-rooted Vite (the only Vite there — the
  // editor's own shell is a prebuilt static bundle), so the game's `pixi.js`
  // is the project's and a shell namespace traps a class nobody calls.
  // MEASURED with the shell's: the `bunnymark` ingest fixture opened on a
  // packaged build failed by name after 8s of visible time, quoting that same
  // invariant back — "the game never rendered, or it bundles its own
  // (un-shared) copy of pixi.js".
  const pixi = await resolveCanvasPixiForEditor();
  let mount: Exclude<Awaited<ReturnType<typeof mountIngestGame2D>>, null>;
  try {
    const candidate = await mountIngestGame2D(pixi, game, {
      ...(game.captureTimeoutMs !== undefined ? { captureTimeoutMs: game.captureTimeoutMs } : {}),
      // The editor can have several live Pixi Applications at once: prefab and
      // screen previews render beside the game. The realm redirects the game's
      // `document.body` into this host, so canvas containment is the honest
      // ownership discriminator and prevents a preview's earlier frame from
      // being mistaken for this ingest root.
      acceptCapture: ({ renderer }) => rendererCanvasBelongsToHost(renderer, hostEl),
      // The same writer the three lane installs (`ingest-root-adapter.ts`): the
      // capture window is a budget of VISIBLE time and PARKS on a hidden tab, so
      // without this the wait reads as a hung mount at every door.
      onWait: (wait) => setCaptureWait(game.id, wait),
      // A classic/module Babylon bundle cannot render through the host's Pixi
      // namespace. When its carrier publishes a boot promise, await that
      // concrete signal and dispatch structurally without first burning a
      // visible-time Pixi timeout (which can remain parked forever in an
      // unfocused editor window).
      preferStructuralRuntime: async () => {
        const realm = ingestGameRealmWindow() as unknown as PhaserRealmLike & BabylonRealmLike;
        await realm.__vgaiBabylon?.ready;
        return recognizeStructuralCanvasRuntime(store, realm) !== null;
      },
    });
    if (candidate === null) {
      const recognized = recognizeStructuralCanvasRuntime(
        store,
        ingestGameRealmWindow() as unknown as PhaserRealmLike & BabylonRealmLike,
      );
      if (recognized) {
        publishStructuralCanvasRuntime(store, game, sessionId, hostEl, recognized);
        return;
      }
      throw new Error(
        `canvas ingest: game "${game.id}" reported a structural runtime, but it disappeared before dispatch`,
      );
    }
    mount = candidate;
  } catch (pixiFailure) {
    // The host's pixi drew no capturable frame — but the game's OWN modules
    // have already run (`mountIngestGame2D` calls `game.load()` before it waits
    // for a frame), so the realm is now the place to ask what this game
    // actually is. Recognized -> that runtime's structural authoring adapter,
    // the same full contract the pixi branch installs. Recognized nothing ->
    // fail by name below.
    //
    // `hostEl` STAYS: the game already appended its own DOM into it while it
    // was the realm's page, so tearing it down here would strand a recognized
    // runtime's canvas exactly the way the pixi branch used to be stranded.
    // The recognized branch inherits the teardown; the unrecognized one runs
    // it before throwing.
    const recognized = recognizeStructuralCanvasRuntime(
      store,
      ingestGameRealmWindow() as unknown as PhaserRealmLike & BabylonRealmLike,
    );
    if (recognized) {
      publishStructuralCanvasRuntime(store, game, sessionId, hostEl, recognized);
      return;
    }
    clearGameSurface();
    hostEl.remove();
    // The row must not be left at `waiting` for a mount that is over: a parked
    // wait and a dead one are the two states this facet exists to tell apart.
    recordRootReadiness({
      rootId: game.id,
      mechanism: readinessMechanism,
      source: readinessSource,
      state: 'failed',
      // Same split the three lane makes: a game that DECLARED ready and never
      // produced a capturable render is a different defect from one that
      // declared nothing and whose measured fallback simply expired.
      failure:
        declaredReady.ready === null ? 'no-readiness-declaration' : 'declared-ready-never-resolved',
    });
    throw new Error(unrecognizedCanvasMountMessage(game.id, pixiFailure));
  }

  const stage = mount.stage as Container;
  // The game's async setup may add display objects after its first captured frame —
  // wait for the stage to settle. `nextPaint()` rather than a bare rAF because
  // this mount is awaited by `vgai play`: in a hidden tab (every agent-worktree
  // `vgai edit` opens one — see `after-paint.ts`) no frame ever arrives, so a
  // bare chain hangs this bounded loop on iteration 1 and play stalls in its
  // boot phase with nothing to report.
  for (let i = 0; i < 90 && (stage.children?.length ?? 0) === 0; i++) {
    await nextPaint();
  }

  // The captured `Application` — the game's own, trapped on its first render
  // (`@volter/game-runtime/pixi/scene-capture`). Two things hang off it, and neither is
  // available anywhere else.
  const app = mount.capture.captured?.app as Application | undefined;

  // (1) ADOPT ITS CANVAS. A game that appended into the realm's page is already
  // inside `hostEl`; one whose module was not realm-shadowed (an in-tree
  // fixture, imported through the editor's own bundle) still has its canvas
  // wherever it put it. Reparent either way, and claim its CSS box — a game
  // sizes its canvas in literal pixels while it believes it owns the window,
  // and nothing else ever un-stamps that. The box is the UNRESIZED policy, not
  // the three lane's fill: this mount never re-resolves the game's renderer, so
  // filling would stretch it (`ingest/host-surface-box.ts` states both, and why
  // they differ).
  const gameCanvas = app?.canvas as HTMLCanvasElement | undefined;
  if (gameCanvas) {
    claimUnresizedSurfaceBox(gameCanvas);
    if (gameCanvas.parentElement !== hostEl) hostEl.appendChild(gameCanvas);
  }

  // (2) MAKE IT PHOTOGRAPHABLE. A Pixi canvas is created without
  // `preserveDrawingBuffer`, so a compositor reading it after paint gets
  // nothing — the measured blank-capture defect `stories/story-pixi-preview.ts`
  // records for the story lane and the canvas board. The same registry is the
  // answer here: the pixel doors ask `presentedPixiFrame` for a registered
  // canvas and it extracts through Pixi's own renderer instead. Registered here
  // for the same reason the first-party canvas root registers at ITS mount
  // (`authoring/canvas-design-mount.ts`) — an ingested game and a first-party
  // canvas world are the same surface, and the doors must not be able to tell
  // them apart.
  const unregisterPresentedApp = registerPresentedPixiApps(app ? [app] : []);

  // TWO possible owners of a display object's pose, and they own DIFFERENT
  // objects: the host's registry-backed carrier answers for bodies the editor
  // itself created, and the game's declared carrier answers for the ones its
  // own simulation drives. The registry is EMPTY on this route (an ingested
  // game never registers into it), which is exactly why handing the write
  // target that one alone left freeze/commit a no-op on every ingest — a gizmo
  // drag over a simulated body was stomped by the game's next frame with
  // nothing anywhere saying so.
  //
  // Composed ownership-first (`composePhysicsAdapters2D`): the declared carrier
  // is asked first because it is the one with a real claim here, and the
  // registry stays as the fallback rather than being dropped, so a host-created
  // body keeps behaving exactly as before.
  const declaredPhysics = declaredCanvasPhysics();
  const registryPhysics = createPhysicsAdapter2D(createPhysics2DRegistry());
  const physicsAdapter = declaredPhysics
    ? composePhysicsAdapters2D([declaredPhysics, registryPhysics])
    : registryPhysics;
  // Every authored edit writes the GAME'S OWN SOURCE, at the line that
  // constructed the object — the canvas half of ARCHITECTURE-CORE §Editor's
  // ingest-authoring model, and the same destination the three ingest lane has
  // (`structuralThree`). There is deliberately no branch here on whether a
  // write is reachable: the backend answers that per edit, in the sentence the
  // user reads, and an edit it cannot honestly anchor stays live-only WITH ITS
  // REASON rather than falling back to a destination that is not the game's.
  // The game's own declared SCENES, in the editor's stories vocabulary — the
  // screens this game swaps between ARE its design-time states
  // (`authoring/contract-scenes-stories.ts` states why the projection is
  // world-level and why it omits `isolate`). `null` for a game that declared
  // none, which the adapter passes on as an absent provider rather than an
  // empty picker.
  //
  // The repaint is THIS MOUNT'S contribution to a scene switch, because it
  // needs what only this mount owns: the captured `Application` to draw with
  // and the hold state to gate on. A held mount's stopped ticker is also its
  // renderer, so without this a scene switch in Edit moves `current()` under a
  // frozen picture (`ingest/held-scene-repaint.ts` carries the measurement and
  // the content-vs-presentation line it walks).
  //
  // Handed in as the projection's SEAM rather than wrapped around the object it
  // returns: the picker's `apply` and the `open` protocol verb's `goToScene`
  // are one path through that module, and a wrapper around the outer member
  // would silently leave the other one unpainted.
  // Annotated because the seam below reads `stories.active` — its own binding,
  // one frame later — which makes the initializer's type circular otherwise.
  const stories: ContractScenesStories | null = createContractScenesStories(
    readIngestGameContract(),
    {
      onSwitchAccepted: (sceneId) =>
        repaintHeldSceneSwitch(sceneId, {
          isHeld: () => !ingestPlaying(),
          currentScene: () => stories?.active('') ?? null,
          render: () => app?.render(),
          schedule: (cb) => requestAnimationFrame(cb),
        }),
    },
  );
  const rawAuthoring = new PixiAuthoringAdapter(stage, store, {
    // The captured stage is the GAME's, so the adapter's namespace is the one
    // the capture trap was installed on.
    pixi,
    // `sessionId` IS the world id (see this function's doc), which is exactly
    // the subject a held surface's undo stack belongs to — it outlives every
    // remount of this game.
    journal: authoringJournal(sessionId),
    target: createCreationSiteCanvasWriteTarget({
      physics: physicsAdapter,
      history: store.projectHistory,
    }),
    ...(stories ? { stories } : {}),
    // The captured game canvas is the screen↔stage mapping `pickable`/`rects`
    // need — the same argument the first-party canvas mount passes
    // (`authoring/canvas-design-mount.ts`). A resolver because a restarted
    // game presents a new canvas under this same adapter; 1:1 is correct here
    // because `claimUnresizedSurfaceBox` above keeps the canvas at its natural
    // CSS size, so stage units are its client pixels.
    surface: () => (app?.canvas as HTMLElement | undefined) ?? null,
    capturePreview: (object, size) => capturePixiDisplayObjectThumbnail(object, { ...size, pixi }),
  });
  const stats = rawAuthoring.refresh();
  const adapter = withDetectedDomSurface({
    primary: rawAuthoring,
    worldId: sessionId,
    hostEl,
    store,
  });

  // Assigned by `publishCanvasIngestSystems` below and released by the session's
  // ONE teardown path — declared here because that path is written first.
  let renderDebugHandle: CanvasRenderDebugHandle | null = null;
  let disposeScene = () => {};
  const gate = gameLoopGate();
  const lifecycle = bindIngestLifecycle({
    setPaused: (paused) => {
      // The captured ticker and the same-realm scheduling gate are one
      // fallback capability. Holding only either half can freeze the picture
      // while timers keep simulating, or park timers while Pixi keeps drawing.
      mount.setPaused(paused);
      if (paused) gate?.hold();
      else gate?.release();
    },
  });

  setActiveIngest({
    kind: 'canvas',
    session: {
      store,
      adapter: rawAuthoring,
      hostEl,
      lifecycle,
      // THE one teardown path (see the ownership block above): the pixel doors
      // stop seeing this app, the realm stops standing in for a surface that no
      // longer exists, and removing `hostEl` removes the game's whole DOM. A
      // re-mount therefore starts from nothing — no stale registration can make
      // the next capture read the previous game's canvas.
      dispose: () => {
        // Take the render-pass bracket off the renderer's runners and reject
        // any armed capture BEFORE the game goes, so nothing outlives the mount
        // holding a patched GL context — the same ordering the three lane's
        // dispose uses (`authoring/ingest-root-adapter.ts`).
        disposeScene();
        renderDebugHandle?.uninstall();
        renderDebugHandle?.wiring?.dispose();
        unregisterPresentedApp();
        mount.dispose();
        clearGameSurface();
        hostEl.remove();
      },
    },
    siblings: [],
    worldId: sessionId,
  });
  disposeScene = installIngestCanvasScene(store);

  // R2c: PixiJS ingest fixtures (`ingest/games/**`) are just as
  // unshadowed-by-default as the three.js ones — drive the same gate as
  // {@link mountThreeIngestRoot} (see that function's doc comment).
  setGameInputGate(() => store.playState === 'playing' && store.activeViewportTab === 'play');

  setActiveAuthoring(adapter);
  // The captured game's OWN renderer — the one object that carries both halves
  // of render debugging on this surface (its real WebGL2 context, and its
  // published render-pass runners). Nothing else in the editor has it.
  // The composed carrier — the SAME object the write target above drives — is
  // what the bag publishes, and only when the game declared one: publishing the
  // host's empty registry carrier would light a green `system.physics` row over
  // a capability no ingested game has.
  renderDebugHandle = publishCanvasIngestSystems(
    game.name,
    mount.capture.captured?.renderer,
    declaredPhysics ? physicsAdapter : null,
  );
  landIngestBootInEdit(store);
  store.notifyIngestEdit();
  clearMountFailureReports(); // D-W3: mount succeeded
  // PD-3: the mount stood — but `contract-ready` may only be recorded when the
  // declared promise actually ANSWERED. The three lane's `awaitWorldReady`
  // (`authoring/ingest-root-adapter.ts`) is the precedent: a game that declares
  // `window.vgaiGame.ready` is awaited exactly once, and a declared signal that
  // REJECTS does not fail the mount (the frame is already captured) — it
  // degrades to the measured wait, LOUDLY, and the row then reports `measured`,
  // which is the truth about which answer stood. Recording `contract-ready`
  // without consulting the promise — as this path first shipped — attributes
  // the answer to a declaration nobody read.
  let readinessStood: 'declared' | 'measured' = 'measured';
  if (declaredReady.ready) {
    try {
      await declaredReady.ready();
      readinessStood = 'declared';
    } catch (err) {
      editorConsole.error(
        `Ingest game "${game.id}" declared \`window.vgaiGame.ready\` and it REJECTED ` +
          `(${String(err)}) — the frame was already captured, so the host fell back to the ` +
          'measured settle wait. This root now reports readiness as measured.',
        'ingest',
      );
    }
  }
  recordRootReadiness({
    rootId: game.id,
    mechanism: readinessStood === 'declared' ? 'contract-ready' : 'measured-wait',
    source: readinessStood,
    state: 'ready',
  });

  recordMountCoverage({
    reach: measureAdapterReach({ authoring: adapter }),
    reachMechanism: CAPTURE_MECHANISM,
    // The captured Application's real ticker IS the control the play surface
    // above drives — but naming a mechanism is not measuring it, and this used
    // to emit the bare word `'gated'` on the strength of the sentence below.
    // That word is also the manifest's declared intent vocabulary, so the
    // coverage report printed `loop ✓ gated` about a capability nothing had
    // probed: stopping the ticker stops what Pixi drives, and says nothing
    // about a game that simulates on its own `setInterval` — the exact split
    // `same-realm-loop-gate.ts`'s header was written about. No verdict until
    // `verifySameRealmLoopControl` runs on this route.
    loop: () => ({
      loop: null,
      reason:
        'the host stops and starts the captured PixiJS Application ticker directly, but no ' +
        'probe has measured whether that holds everything this game schedules',
    }),
  });

  editorConsole.log(
    `pixi ingest: captured "${game.name}" (${stats.count} nodes, ${stats.sprites} sprites)`,
    'ingest',
  );

  publishIngestHook('__vgaiIngest2D', {
    gameId: sessionId,
    ...ingestHookEvidence(adapter),
    drawCount: () => mount.capture.getDrawCount(),
    // Live, for the same reason as the three.js hook: a pixi game keeps
    // adding display objects after its first captured frame (the settle loop
    // right before this only waits for the stage to become NON-EMPTY), so a
    // mount-time snapshot goes stale immediately.
    get reflected() {
      return rawAuthoring.refresh();
    },
    setPaused: lifecycle.setPaused,
    // D-A3: the MEASURED editor reach of a headless-verifiable healthy mount.
    reach: measureAdapterReach({ authoring: adapter }),
    adapter,
    store,
  });
}

/**
 * Mount an already-resolved {@link IngestGame2D} descriptor — the canvas
 * sibling of `mountThreeIngestRoot`. `sessionId` is always the world id — the
 * id this session is known by in logs and the dev hook. Its edits are written
 * into the game's own source at the creation site of the edited object; an edit
 * that cannot be honestly anchored there stays live-only AND SAYS WHY — never a
 * sidecar, never an overlay document.
 *
 * Serialized through the shared entry queue; see `active-ingest.ts`'s
 * `serializeEntry`.
 */
export function mountCanvasIngestRoot(
  store: EditorShellStore,
  game: IngestGame2D,
  sessionId: string,
): Promise<void> {
  return serializeEntry(() => mountCanvasIngestRootInner(store, game, sessionId));
}

/**
 * Mount straight from a manifest's canvas-surface `{ ingest }` root — the
 * canvas sibling of `mountThreeIngestRootFromManifest`. Builds the descriptor
 * via `resolveIngest2DDescriptor` (ingest/resolve-canvas.ts) and mounts it exactly
 * like any other {@link IngestGame2D}.
 */
export async function mountCanvasIngestRootFromManifest(
  store: EditorShellStore,
  world: ResolvedAdapterRoot,
  projectRoot: string,
): Promise<void> {
  const game = resolveIngest2DDescriptor(world, projectRoot);
  return mountCanvasIngestRoot(store, game, world.id);
}

/**
 * Mount an in-tree pixi fixture game by its discovered id
 * (`ingest/surface-canvas.ts`'s glob discovery is the lookup). Canvas sibling
 * of `mountThreeIngestRootById`.
 */
export async function mountCanvasIngestRootById(
  store: EditorShellStore,
  gameId: string,
): Promise<void> {
  const game = getIngestGame2D(gameId);
  if (!game) {
    editorConsole.error(`Unknown pixi ingest game: ${gameId}`, 'ingest');
    return;
  }
  return mountCanvasIngestRoot(store, game, gameId);
}
