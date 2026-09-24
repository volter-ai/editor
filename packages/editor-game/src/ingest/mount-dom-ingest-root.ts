/**
 * Mount a `{ ingest }` root on the DOM surface — an unmodified native-React
 * game, mounted through the EXACT SAME react-world host stack `default-react`/
 * multi-world react roots use, NOT the capture-based three/canvas bridge (there
 * is no scene to capture; the mounted tree IS React, D-N1).
 */

import { measureAdapterReach } from '@editor/adapter-reach';
import { setActiveAuthoring } from '@editor/authoring/active-adapter';
import { setActiveSystems } from '@editor/authoring/active-systems';
import { clearMountFailureReports } from '@editor/authoring/mount-failure-report';
import { resolveAllRoots } from '@editor/binding-resolver';
import { editorConsole } from '@editor/editor-console';
import type { EditorShellStore } from '@editor/editor-shell-store';
import { setGameInputGate } from '@editor/gated-globals';
import { authoringJournal } from '@editor/history/json-history-resource';
import { acquireLiveDocument, liveDocumentContainer } from '@editor/live-document';
import { DomAuthoringAdapter } from '@vgai/dom/dom-authoring-adapter';
import type { ResolvedAdapterRoot, ResolvedGameManifest } from '@vgai/project/manifest/load';
import { serializeEntry, setActiveIngest } from './active-ingest';
import { landIngestBootInEdit } from './ingest-boot-viewport';
import { ingestHookEvidence, publishIngestHook, reactDomEvidence } from './ingest-evidence-hook';
import { bindIngestLifecycle } from './ingest-play-control';
import { domMountLoopFacts, type MountCoverageInputs, recordMountCoverage } from './mount-coverage';
import { getIngestGameDom, ingestGameDomProjectRoot } from './surface-dom';
import { exitActiveIngest } from './unmount-ingest-root';

/** How a react ingest reaches the game: it mounts through the host's own
 *  native React runtime, so whatever the editor cannot do here is the
 *  adapter's own missing surface, not an unreachable realm. */
const REACT_MECHANISM =
  "this world mounts in the host's native React runtime, so the editor is limited only by " +
  'what its authoring adapter provides';

/** The coverage inputs both react routes record — identical by construction,
 *  because both mount through the same native runtime. */
function domMountCoverage(adapter: DomAuthoringAdapter): MountCoverageInputs {
  return {
    reach: measureAdapterReach({ authoring: adapter }),
    reachMechanism: REACT_MECHANISM,
    loop: domMountLoopFacts,
  };
}

/**
 * Mount a discovered native-React fixture game (`ingest/surface-dom.ts`'s glob
 * discovery is the lookup).
 *
 * Reuses `resolveAllRoots` + universal `createGameRuntime` rather than
 * hand-building a `DomHostContext`/`Game`: a
 * single-element `roots` array gets EVERY host concern for free (the
 * absolutely-positioned DOM-root layer, a real `Game`, dispose via
 * `session.stop()`) with zero reinvention — `resolveAllRoots`'s
 * `MULTI_WORLD_ALLOWED_IDENTITIES` gate only fires for `roots.length > 1`
 * (see that function's doc comment), so a ONE-element manifest containing an
 * `ingest-react` world resolves cleanly through it despite that identity
 * being excluded from real multi-world manifests.
 *
 * D-N8 v2 / D-K4: the active authoring override is a real
 * `DomAuthoringAdapter` — a structural-path DOM walker over the mounted
 * react tree, applying edits live (never to source, see that file's doc
 * comment). The published `reach` is MEASURED off this real adapter
 * (`adapter-reach.ts`), not hard-coded, so every capability it does not
 * provide keeps warning.
 */
async function mountDomIngestRootInner(store: EditorShellStore, folderId: string): Promise<void> {
  const game = getIngestGameDom(folderId);
  if (!game) {
    editorConsole.error(`Unknown react ingest game: ${folderId}`, 'ingest');
    return;
  }
  const projectRoot = ingestGameDomProjectRoot(folderId);
  if (!projectRoot) {
    editorConsole.error(
      `React ingest "${folderId}": no __VGAI_ENGINE_ROOT__ available to resolve its entry`,
      'ingest',
    );
    return;
  }
  // The Game document exists only while a runtime does, so install it (and
  // wait for its panel to commit) before reading the container it owns.
  await acquireLiveDocument();
  const gameContainer = liveDocumentContainer();
  if (!gameContainer) {
    editorConsole.error('Game container not mounted — cannot ingest (react)', 'ingest');
    return;
  }
  // D-V1: tear down WHATEVER kind is currently active, not just a prior
  // react session — closes the cross-kind leak (F26 residual).
  exitActiveIngest();

  store.setPlayState('playing');
  editorConsole.log(`Ingesting unmodified native-React game: ${game.manifest.name}`, 'ingest');

  // F26: same cold-mount announcement as the other ingest routes — the react
  // world's entry executes in the editor realm and may declare the game
  // contract to defer its session until ▶. Opt-in, never demanded.
  (window as unknown as { __vgaiMountCold?: boolean }).__vgaiMountCold = true;
  const { createGameRuntime } = await import('@vgai/game-runtime/runtime/create-runtime');
  const specs = await resolveAllRoots(game.manifest, projectRoot);
  const w = gameContainer.clientWidth;
  const h = gameContainer.clientHeight;
  const session = await createGameRuntime({
    container: gameContainer,
    roots: specs,
    width: w,
    height: h,
  });

  // D-K4: construct the real authoring adapter over the mounted world's live
  // DOM root (its style edits are live-only — there is no source path here and
  // no sidecar any more). The adapter has its own `selection` provider
  // (store-backed, same shape as `ReactRootAuthoringAdapter.selection`), so —
  // unlike a `{ module }` adapter with none — it is installed directly, never
  // `withStoreSelection`-wrapped.
  const root = session.game.roots[0]!.reactRoot();
  // A held surface: its journal is the WORLD's, so undo survives a remount of
  // this game (`../history/json-history-resource.ts`).
  const adapter = new DomAuthoringAdapter(root, store, {
    journal: authoringJournal(folderId),
  });
  // Unlike the capture routes, a react ingest mounts through the NATIVE
  // runtime — its Game.play pause/resume IS the honest control (D10). Named
  // (rather than inlined below) so `setPausedPresent`'s D-L1 `typeof`
  // check reads the SAME real control the session actually installs, never
  // an independent literal.
  const setPaused = (p: boolean) => (p ? session.game.play.pause() : session.game.play.resume());
  const lifecycle = bindIngestLifecycle({ setPaused });

  setActiveIngest({
    kind: 'dom',
    session: {
      store,
      lifecycle,
      stop: () => session.stop(),
      adapter,
    },
    siblings: [],
    worldId: folderId,
  });
  // Same play-mode input gate every other same-realm ingest route drives (R2c).
  // The former per-surface `games-2d`/`games-react` fixture
  // trees into the single `ingest/games` tree, which IS what
  // `game-globals-shadow.ts` roots its shadow at — so a native-React fixture's
  // own listeners are shadowed on the same terms as every other surface's now
  // (this comment used to record the opposite, from the R-N6 residual).
  setGameInputGate(() => store.playState === 'playing' && store.activeViewportTab === 'play');

  setActiveAuthoring(adapter);
  setActiveSystems({});
  landIngestBootInEdit(store);
  store.notifyIngestEdit();
  clearMountFailureReports(); // D-W3: mount succeeded

  const coverage = domMountCoverage(adapter);
  recordMountCoverage(coverage);

  publishIngestHook('__vgaiIngestReact', {
    gameId: folderId,
    worldId: game.worldId,
    ...ingestHookEvidence(adapter),
    noAuthoring: false,
    // D-K4: MEASURED off the real adapter (`adapter-reach.ts`) — a
    // hierarchy+inspector+persistence adapter with no `transforms` reports a
    // standing `transforms` gap, never a hard-coded claim.
    reach: coverage.reach,
    // D-L1: the doctor MOUNTED-bar evidence accessor —
    // see `reactDomEvidence`'s own doc comment.
    domEvidence: () => reactDomEvidence(root, adapter),
    // D-L1: honest `typeof === 'function'` check on the REAL session
    // control this route just installed above — never an independent
    // literal `true` (mirrors `__vgaiSiblingMounts`'s identical discipline).
    setPausedPresent: typeof lifecycle.setPaused === 'function',
  });
}

/**
 * D-Y2 (slice S2) — the manifest-route sibling of {@link mountDomIngestRoot}: an
 * EXTERNAL-FOLDER `ingest-react` world (the opened project's OWN
 * `vgai.project.json`, not the in-tree `ingest/games/<id>` fixture registry)
 * enters the same react ingest session. Exactly the same roots-path recipe
 * (one-element `resolveAllRoots` + roots-path `createGameRuntime`) and the same
 * `DomAuthoringAdapter` D-K4 wiring — only the SOURCE of
 * `world`/`projectRoot` differs (the opened project's manifest +
 * `project.rootPath`, via `mount-ingest-root.ts`'s react route, instead of
 * `getIngestGameDom`/`ingestGameDomProjectRoot`'s vendored-fixture lookup).
 * `resolveIngestReactAdapter`'s own guards (`entry` required, no `scene`) run
 * unchanged inside `resolveAllRoots` — this function
 * adds no new validation of its own, mirroring
 * `mountCanvasIngestRootFromManifest`'s relationship to its vendored sibling.
 */
export async function mountDomIngestRootFromManifest(
  store: EditorShellStore,
  manifest: ResolvedGameManifest,
  world: ResolvedAdapterRoot,
  projectRoot: string,
): Promise<void> {
  // The Game document exists only while a runtime does, so install it (and
  // wait for its panel to commit) before reading the container it owns.
  await acquireLiveDocument();
  const gameContainer = liveDocumentContainer();
  if (!gameContainer) {
    editorConsole.error('Game container not mounted — cannot ingest (react)', 'ingest');
    return;
  }
  // D-V1: tear down WHATEVER kind is currently active, not just a prior
  // react session — closes the cross-kind leak (F26 residual).
  exitActiveIngest();

  store.setPlayState('playing');
  editorConsole.log(
    `Ingesting unmodified native-React game (external folder): ${world.id}`,
    'ingest',
  );

  // F26: same cold-mount announcement the vendored route makes — an
  // external-folder game may declare the game contract too.
  (window as unknown as { __vgaiMountCold?: boolean }).__vgaiMountCold = true;
  const { createGameRuntime } = await import('@vgai/game-runtime/runtime/create-runtime');
  const specs = await resolveAllRoots({ ...manifest, roots: [world] }, projectRoot);
  const w = gameContainer.clientWidth;
  const h = gameContainer.clientHeight;
  const session = await createGameRuntime({
    container: gameContainer,
    roots: specs,
    width: w,
    height: h,
  });

  // D-K4: same adapter construction as the vendored route.
  const root = session.game.roots[0]!.reactRoot();
  const adapter = new DomAuthoringAdapter(root, store, {
    journal: authoringJournal(world.id),
  });
  // Same honest control as the vendored route (D10): a manifest-routed react
  // ingest mounts through the NATIVE runtime, so Game.play pause/resume IS
  // real. Named (D-L1) so `setPausedPresent` checks the SAME real control.
  const setPaused = (p: boolean) => (p ? session.game.play.pause() : session.game.play.resume());
  const lifecycle = bindIngestLifecycle({ setPaused });

  setActiveIngest({
    kind: 'dom',
    session: {
      store,
      lifecycle,
      stop: () => session.stop(),
      adapter,
    },
    siblings: [],
    worldId: world.id,
  });
  setGameInputGate(() => store.playState === 'playing' && store.activeViewportTab === 'play');

  setActiveAuthoring(adapter);
  setActiveSystems({});
  landIngestBootInEdit(store);
  store.notifyIngestEdit();
  clearMountFailureReports(); // D-W3: mount succeeded

  const coverage = domMountCoverage(adapter);
  recordMountCoverage(coverage);

  publishIngestHook('__vgaiIngestReact', {
    worldId: world.id,
    ...ingestHookEvidence(adapter),
    noAuthoring: false,
    // D-K4: see mountDomIngestRoot's identical comment — MEASURED, never
    // hard-coded.
    reach: coverage.reach,
    // D-L1: see mountDomIngestRoot's identical comment.
    domEvidence: () => reactDomEvidence(root, adapter),
    setPausedPresent: typeof lifecycle.setPaused === 'function',
  });
}

/**
 * Mount a discovered native-React fixture game by its folder id. Serialized
 * through the shared entry queue; see `active-ingest.ts`'s `serializeEntry`.
 */
export function mountDomIngestRoot(store: EditorShellStore, folderId: string): Promise<void> {
  return serializeEntry(() => mountDomIngestRootInner(store, folderId));
}
