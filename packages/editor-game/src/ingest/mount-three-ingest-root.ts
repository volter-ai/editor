/**
 * Mount a `{ ingest }` root on the THREE surface — an UNMODIFIED three.js game
 * loaded into the real editor with ZERO edits to the game's code.
 *
 * This is a thin HOST. It mounts the game through the
 * {@link mountIngestGame} `RootAdapter` path — which captures the game's live
 * scene and returns an `IngestMount` whose `authoring` is the three
 * authoring adapter implemented DIRECTLY over the live `Object3D` tree (NO
 * fabricated descriptors). The host then:
 *   - installs that adapter as the editor's active authoring override, so the
 *     hierarchy + inspector render from the adapter's providers, and
 *   - swaps the editor viewport onto the live scene (`enterPlayScene`, handed
 *     the adapter's pure stable-id projection) so selection + gizmo work.
 *
 * The first-party editor surface is untouched; the SAME editor surface now
 * drives a foreign game. Its canvas and DOM siblings live in
 * `mount-canvas-ingest-root.ts` and `mount-dom-ingest-root.ts`; the routing
 * that picks between them is `mount-ingest-root.ts`.
 */

import { measureAdapterReach } from '../host/adapter-reach';
import { setActiveAuthoring } from '@volter/editor-core/authoring/active-adapter';
import { setActiveSystems } from '@volter/editor-sdk/kit/authoring/active-systems';
import { withContractHierarchy } from '../host/authoring/contract-hierarchy-authoring';
import { clearMountFailureReports } from '@volter/editor-sdk/kit/mount-failure-report';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { gameLoopGate, setGameInputGate } from '../host/gated-globals';
import { acquireLiveDocument, liveDocumentContainer } from '@volter/editor-sdk/kit/live-document';
import { pickGameCamera } from '@volter/editor-core/scene-framing';
import type { ResolvedAdapterRoot } from '@volter/editor-project/manifest/load';
import type { CaptureMechanism } from '@volter/threejs-runtime/adapter/ingest/scene-capture';
import { type IngestSession, serializeEntry, setActiveIngest } from './active-ingest';
import { withDetectedDomSurface } from './authoring/ingest-dom-surface-authoring';
import { type MountIngestOptions, mountIngestGame } from './authoring/ingest-root-adapter';
import { releaseGamePointerLock } from './game-pointer-lock';
import { landIngestBootInEdit } from './ingest-boot-viewport';
import {
  defineLoopHookFields,
  ingestHookEvidence,
  publishIngestHook,
} from './ingest-evidence-hook';
import {
  activeIngestContract,
  bindIngestLifecycle,
  ingestPlaying,
  setIngestPlaying,
} from './ingest-play-control';
import {
  beginMountCoverage,
  recordMountCoverage,
  reportMeasuredLoop,
  threeMountLoopFacts,
} from './mount-coverage';
import { resolveIngestDescriptor } from './resolve-three';
import { getIngestGame } from './surface-three';
import type { IngestGame } from './types';
import { exitActiveIngest, unmountThreeIngestRoot } from './unmount-ingest-root';

/**
 * How this mount reached the game's runtime, named for the reader of any
 * capability warning it produces — and named from the MEASUREMENT
 * (`SceneCaptureHandle.capturedVia`), never assumed.
 *
 * There are two, and the difference is what a reader needs: a `shared-three`
 * game runs on the editor's very `three` instance; a `devtools-observer` game
 * runs its OWN pinned revision (a vendored build bundles or pins one) and only
 * its renderer is shared, through three's public `__THREE_DEVTOOLS__` seam.
 * Printing the first sentence for both is how a coverage row starts lying.
 */
function captureMechanism(via: CaptureMechanism | null): string {
  if (via === 'devtools-observer') {
    return (
      "this game runs its OWN copy of three; the host reached its renderer through three's " +
      '`__THREE_DEVTOOLS__` observation seam'
    );
  }
  return "this game imports the host's three directly, in the editor's own realm";
}

/**
 * Publish a captured three ingest to the whole editor: resize lifecycle,
 * hierarchy/inspector adapter, viewport adoption and the `__vgaiIngest`
 * proof hook.
 */
function activateCapturedThreeIngest(args: {
  store: EditorShellStore;
  session: IngestSession;
  gameContainer: HTMLElement;
  sessionId: string;
}): void {
  const { store, session, sessionId } = args;
  const mount = session.mount;
  if (!mount) return;
  const rawAuthoring = mount.authoring;
  const contract = activeIngestContract();
  const contractAuthoring = withContractHierarchy(rawAuthoring, contract?.systems?.hierarchy);
  const liveAuthoring = withDetectedDomSurface({
    primary: contractAuthoring,
    worldId: sessionId,
    hostEl: mount.hostEl,
    ...(contract?.root ? { declaredRoot: contract.root } : {}),
    store,
  });
  const liveScene = mount.scene;

  // Host lifecycle: keep the game's renderer sized to its container (resize).
  const ro = new ResizeObserver(() => {
    const r = args.gameContainer.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) mount.game.resize?.(r.width, r.height);
  });
  ro.observe(args.gameContainer);
  session.resizeObserver = ro;

  const stats = rawAuthoring.refresh();
  // WHERE EDITS GO, measured rather than asserted. This line used to end in a
  // flat "edits are live-only (this game has no source the editor may write)",
  // which is a claim about every ingested game ever mounted — and it was wrong
  // for the first one whose own source the editor's authoring transform
  // reached. The adapter's own reach measurement answers instead, in the
  // persistence backend's own words.
  const reachNow = rawAuthoring.measureWriteReach();
  editorConsole.log(
    `Captured live scene (${liveScene.children.length} top-level children, ` +
      `${mount.capture.getDrawCount()} draws); ingested ${stats.count} objects ` +
      `(${stats.meshes} meshes, ${stats.lights} lights` +
      // Named only when there IS instanced content: an InstancedMesh is one
      // object drawing N units, so every count on this line under-reports the
      // scene by `instances - instancedMeshes` without saying so.
      (stats.instancedMeshes > 0
        ? `, incl. ${stats.instancedMeshes} InstancedMesh drawing ${stats.instances} units`
        : '') +
      '); ' +
      `${reachNow.addressable} of ${reachNow.total} have a source address — ` +
      `edits go to ${reachNow.destination}`,
    'ingest',
  );
  reportMeasuredLoop(sessionId, mount.realmLoopVerdict?.() ?? undefined);

  // The editor's hierarchy + inspector now render from THIS adapter.
  setActiveAuthoring(liveAuthoring);
  // An unmodified game exposes NO engine System adapters (it owns its own
  // physics/input/animation/etc.) → those are correctly N/A while ingested. Only
  // the asset-path remap (done at mount) is a first-party asset-adapter behavior.
  // The ONE exception is earned, never inferred: a game that DECLARES verbs and
  // state in its contract (`window.vgaiGame.systems`) gets a `debug` adapter
  // projected from those declarations by `mountIngestGame`, so `game.commands()`
  // /`game.state()` reach it through the ordinary bridge. A game that declares
  // nothing still lands here with `{}` and the pre-contract floor stands.
  setActiveSystems(mount.game.systems ?? {});
  // Bind the viewport/objectMap/gizmo to the live scene through the adapter's
  // pure projection. The game's own Object3Ds remain untouched.
  store.enterPlayScene(liveScene, undefined, rawAuthoring.objectMapSnapshot());
  // The editor camera boots at (10,10,10) looking at the origin — a pose that
  // means something for a scene the reader authored, and nothing at all for a
  // world they did not: an ingested world centred hundreds of units from the
  // origin and hundreds of units across leaves the opening Scene view on empty
  // space. Frame the world instead — from the GAME'S OWN camera when it has
  // one, which is the view its author chose. The lookup is passed LIVE, not
  // resolved here: an R3F game's camera is often not in the scene yet on the
  // frame we capture it on (its `<Suspense>` content has not resolved), and a
  // camera resolved once at mount would miss it. The viewport measures a
  // framing meanwhile, and keeps asking until there IS content — a
  // level-streaming game captures on its first drawn frame and then parses its
  // world in for several seconds afterwards.
  store.focusOnScene(() => pickGameCamera(mount.capture.captured?.camera, liveScene));
  landIngestBootInEdit();
  store.shell.notifyIngestEdit(); // ensure panels re-render against the override
  clearMountFailureReports(); // D-W3: mount succeeded

  // What this editor CANNOT do with this game, said out loud once, right where
  // the mount has just finished saying what it could (`capability-coverage.ts`).
  const reach = measureAdapterReach({ authoring: liveAuthoring });
  recordMountCoverage({
    reach,
    reachMechanism: captureMechanism(mount.capture.capturedVia),
    loop: () => threeMountLoopFacts(mount),
    // The adapter's OWN measurement of how far this world reaches into source.
    // A function, like the loop verdict beside it: a captured world keeps
    // streaming objects in, so a count taken at mount would start lying.
    writeReach: () => rawAuthoring.measureWriteReach(),
  });

  // Dev/proof hook: expose ingest state for automation + screenshots.
  const hook: Record<string, unknown> = {
    gameId: sessionId,
    ...ingestHookEvidence(liveAuthoring),
    drawCount: () => mount.capture.getDrawCount(),
    // LIVE, like `drawCount`/`engineSystems` beside it — not the mount-time
    // `stats` snapshot this used to hand out. An ingested game keeps loading
    // after we mount it (games-fps streams its whole collision world in via
    // GLTFLoader well after first capture), so a frozen count is not merely
    // stale, it is unfalsifiable: anything polling it waits forever on a
    // number that cannot change. That cost a week of nightly red, read the
    // whole time as "the world GLTF never loads" — the asset was arriving
    // fine with a 200, and the snapshot simply predated it.
    get reflected() {
      return rawAuthoring.refresh();
    },
    get sceneChildren() {
      return liveScene.children.length;
    },
    // D-A3: the MEASURED editor reach of a headless-verifiable healthy mount.
    reach,
    // Host-lifecycle resize: drive the game renderer's size (proof/automation).
    resize: (w: number, h: number) => mount.game.resize?.(w, h),
    // Loop-host: drive the SAME normalized lifecycle as the Play surface.
    ...(session.lifecycle.setPaused ? { setPaused: session.lifecycle.setPaused } : {}),
    // DEV-only: the live authoring adapter + store, so e2e/proof can drive the
    // SAME providers the hierarchy/inspector/gizmo use.
    ...(import.meta.env.DEV ? { adapter: liveAuthoring, store } : {}),
  };
  defineLoopHookFields(hook, mount);
  publishIngestHook('__vgaiIngest', hook);
}

async function mountThreeIngestRootInner(
  store: EditorShellStore,
  game: IngestGame,
  sessionId: string,
): Promise<void> {
  // D-V1: tear down WHATEVER kind is currently active, not just a prior
  // three session — closes the cross-kind leak (F26 residual).
  exitActiveIngest();

  // A new mount is a new coverage answer, even for the same world: the console
  // door's once-guard keys on this token.
  beginMountCoverage(sessionId);

  // The Game document exists only while a runtime does, so install it (and
  // wait for its panel to commit) before reading the container it owns.
  await acquireLiveDocument();
  const gameContainer = liveDocumentContainer();
  if (!gameContainer) {
    editorConsole.error('Game container not mounted — cannot ingest', 'ingest');
    return;
  }

  // Ingest edits are LIVE-ONLY. Autosave/save-guard no longer suppress on a
  // flag — the active adapter installed below (setActiveAuthoring) carries its
  // own persistence provider, which is what EditorShellStore's autosave/saveNow
  // now consult (design). Still switch into the guarded "playing" state so the
  // viewport swaps onto the live scene.
  store.shell.setPlayState('playing');
  editorConsole.log(`Ingesting unmodified game: ${game.name}`, 'ingest');

  // Drive the SAME input gate play-mode uses (play-mode.ts's
  // `gameInputActive`, wired via `setGameInputGate`) so an ingested game's raw
  // window/document input listeners (gated via gated-globals.ts's proxy —
  // reachable because `server/dev.ts`'s prelude shadows the in-tree ingest
  // fixture roots too, see game-globals-shadow.ts) only fire while the Play
  // tab is the active viewport surface, exactly like a first-party play
  // session.
  const ingestInputActive = () =>
    store.shell.playState === 'playing' && store.shell.activeViewportTab === 'play';

  try {
    const mountOpts: MountIngestOptions = { captureTimeoutMs: game.captureTimeoutMs };

    // Mount the unmodified game through the RootAdapter path → captured live
    // scene + a three authoring adapter over its Object3D tree,
    // whose edits are live-only (no sidecar, no source write).
    const mount = await mountIngestGame(store, game, gameContainer, mountOpts);
    const setPaused = mount.game.setPaused;
    const session: IngestSession = {
      store,
      mount,
      lifecycle: bindIngestLifecycle(
        setPaused
          ? {
              setPaused: (paused) => setPaused(paused),
              step: () => gameLoopGate()?.step(1),
              canStep: () =>
                mount.realmLoopVerdict?.()?.loop === 'gated' && gameLoopGate() !== null,
            }
          : {
              pauseGap: 'the captured Three root exposes no mounted setPaused capability',
            },
      ),
    };
    setActiveIngest({ kind: 'three', session, siblings: [], worldId: sessionId });
    setGameInputGate(ingestInputActive);
    // The other half of the pointer-lock gate (`ingest/game-pointer-lock.ts`
    // refuses ACQUISITION while the gate is closed): a lock the game already
    // holds when the gate CLOSES — leaving play, or switching to the Edit tab
    // mid-flight — must be released, or the editor is left with a captured,
    // invisible cursor over a game that is no longer receiving input.
    session.inputGateUnsubscribe = store.shell.subscribe(() => {
      if (!ingestInputActive()) releaseGamePointerLock();
    });
    // The realm gate only just became reachable, so push the play state we
    // already hold onto it (see setIngestPlaying). A fresh mount is not
    // playing, which is what makes Edit quiet from the moment the host can
    // speak to the realm at all.
    setIngestPlaying(ingestPlaying());

    activateCapturedThreeIngest({ store, session, gameContainer, sessionId });
  } catch (err) {
    editorConsole.error(`Ingest failed: ${err}`, 'ingest');
    unmountThreeIngestRoot();
    throw err;
  }
}

/**
 * Mount an already-resolved {@link IngestGame} descriptor, however it was
 * built. Resolves once the game's live scene is captured, the authoring adapter
 * is active, and it is shown in the editor for editing.
 *
 * T3.3 slice 3 split this out of {@link mountThreeIngestRootById} so the
 * descriptor's ORIGIN is a separate concern from mounting it:
 * {@link mountThreeIngestRootById} resolves `gameId` against the in-tree
 * fixture glob (`ingest/surface-three.ts`);
 * {@link mountThreeIngestRootFromManifest} builds the descriptor straight from
 * an arbitrary project's manifest instead (the CLI-on-folder route, for a game
 * folder never registered in source) — both end up here. `sessionId` is the
 * id this session is known by — the `__vgaiIngest` dev-hook's reported
 * `gameId` and the id every log line names; it is always the world/game id
 * (`game.id`), passed explicitly rather than re-read off `game` so the two
 * callers' "id" concept — a fixture's registry-era id vs. a manifest's world
 * id — stays one parameter, not two silently-assumed-equal fields.
 *
 * Serialized through the shared entry queue; see `active-ingest.ts`'s
 * {@link serializeEntry}.
 */
export function mountThreeIngestRoot(
  store: EditorShellStore,
  game: IngestGame,
  sessionId: string,
): Promise<void> {
  return serializeEntry(() => mountThreeIngestRootInner(store, game, sessionId));
}

/**
 * Mount an in-tree fixture game by its discovered id —
 * `ingest/surface-three.ts`'s glob discovery is the lookup.
 */
export async function mountThreeIngestRootById(
  store: EditorShellStore,
  gameId: string,
): Promise<void> {
  const game = getIngestGame(gameId);
  if (!game) {
    editorConsole.error(`Unknown ingest game: ${gameId}`, 'ingest');
    return;
  }
  return mountThreeIngestRoot(store, game, gameId);
}

/**
 * Mount straight from a manifest's `ingest-three` world — the CLI-on-folder
 * route (T3.3 slice 3): a game folder never registered in source, whose
 * `vgai.project.json` declares an ingest-three world. Builds the descriptor via
 * `resolveIngestDescriptor` (ingest/resolve-three.ts — parameterized by the
 * manifest's ingest fields, no registry lookup) and mounts it exactly like any
 * other {@link IngestGame}. The session is known by the world id — the same
 * namespace an in-tree fixture id lives in, different origin.
 */
export async function mountThreeIngestRootFromManifest(
  store: EditorShellStore,
  world: ResolvedAdapterRoot,
  projectRoot: string,
): Promise<void> {
  const game = resolveIngestDescriptor(world, projectRoot);
  return mountThreeIngestRoot(store, game, world.id);
}
