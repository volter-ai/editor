/**
 * THE door: mounting a project whose manifest declares an `{ ingest }` root is
 * ordinary root-adapter dispatch, exactly like every other root — this module
 * is the dispatcher.
 *
 * It answers one question per surface ("does the OPEN PROJECT declare an
 * `{ ingest }` root, and which surface is it?"), hands off to the per-surface
 * mount module (`mount-three-ingest-root.ts` / `mount-canvas-ingest-root.ts` /
 * `mount-dom-ingest-root.ts`), mounts a composite's remaining roots beside it
 * (`ingest-siblings.ts`), and re-exports the mount/unmount API its callers
 * drive. The measurement half lives in `mount-coverage.ts`, the live session in
 * `active-ingest.ts`, teardown in `unmount-ingest-root.ts` — nothing here
 * measures anything.
 *
 * Dispatching is ALL it does, and that is what keeps the mount-failure seam
 * connected: the Game document belongs to whoever mounts into its container,
 * so each per-surface mount module acquires it (`acquireGameDocument`) right
 * before it reads `liveDocumentContainer()` and reports its own missing-container
 * refusal. A route here that acquired first and refused on its own would
 * pre-empt that mount — the failure would then be a bare console line that
 * never reaches {@link reportFailedIngestMount}, which is precisely the
 * trace-less failure D-W3/S-1 exists to eliminate. Every route's ONLY failure
 * path is therefore its catch block.
 */

import { getAuthoringOverride, setActiveAuthoring } from '@volter/editor-core/authoring/active-adapter';
import {
  CompositeAuthoringAdapter,
  type CompositeChild,
} from '@volter/editor-core/authoring/composite-authoring-adapter';
import {
  addMountFailureReport,
  clearMountFailureReports,
  formatMountFailureMessage,
  getMountFailureReports,
  type MountFailureReport,
} from '@volter/editor-sdk/kit/mount-failure-report';
import { editorConsole } from '@volter/editor-core/editor-console';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { registerEditorStateFacet } from '@volter/editor-core/editor-state-facets';
import { liveDocumentContainer } from '@volter/editor-core/live-document';
import { fetchGameManifest, isManifestAbsence } from '@volter/editor-core/manifest-project';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import { onShellStore } from '@volter/editor-core/shell-store-door';
import { ingestRoots, rootById } from '@volter/editor-project/adapter/manifest-interpreter';
import { MANIFEST_FILENAME } from '@volter/editor-project/manifest/filename';
import type { ResolvedAdapterRoot, ResolvedGameManifest } from '@volter/editor-project/manifest/load';
import { activeIngest, attachIngestSiblings } from './active-ingest';
import { captureWaitStatus } from './capture-wait-report';
import { resetIngestPlaySurface } from './ingest-play-control';
// TYPE-ONLY (D-V2): `ingest-siblings.ts` imports from `module-mode.ts`, and a
// value import here would risk closing that cycle at the wrong end. The actual
// `mountIngestSiblings` call below is a dynamic `import()`, right where it's
// used (`mountCompositeSiblings`); only the TYPE is needed at the top level,
// and type-only imports are erased before the cycle could ever matter.
import type { SiblingMount } from './ingest-siblings';
import { ingestStatusFacet } from './live-ingest-facet';
import {
  exitActiveIngest,
  unmountCanvasIngestRoot,
  unmountDomIngestRoot,
  unmountThreeIngestRoot,
} from './unmount-ingest-root';

export {
  activeIngestKind,
  type IngestKind,
  isIngestActive,
  isIngestActive2D,
  isIngestActiveReact,
} from './active-ingest';
export { getIngestPlayControl, type IngestPlayControl } from './ingest-play-control';
export { ingestStatusFacet } from './live-ingest-facet';
export {
  unmountCanvasIngestRoot,
  unmountDomIngestRoot,
  unmountThreeIngestRoot,
} from './unmount-ingest-root';

type CanvasMounts = typeof import('./mount-canvas-ingest-root');
type DomMounts = typeof import('./mount-dom-ingest-root');
type ThreeMounts = typeof import('./mount-three-ingest-root');

const canvasMounts = () => import('./mount-canvas-ingest-root');
const domMounts = () => import('./mount-dom-ingest-root');
const threeMounts = () => import('./mount-three-ingest-root');

export function mountCanvasIngestRoot(
  ...args: Parameters<CanvasMounts['mountCanvasIngestRoot']>
): ReturnType<CanvasMounts['mountCanvasIngestRoot']> {
  return canvasMounts().then((module) => module.mountCanvasIngestRoot(...args));
}

export function mountCanvasIngestRootById(
  ...args: Parameters<CanvasMounts['mountCanvasIngestRootById']>
): ReturnType<CanvasMounts['mountCanvasIngestRootById']> {
  return canvasMounts().then((module) => module.mountCanvasIngestRootById(...args));
}

export function mountCanvasIngestRootFromManifest(
  ...args: Parameters<CanvasMounts['mountCanvasIngestRootFromManifest']>
): ReturnType<CanvasMounts['mountCanvasIngestRootFromManifest']> {
  return canvasMounts().then((module) => module.mountCanvasIngestRootFromManifest(...args));
}

export function mountDomIngestRoot(
  ...args: Parameters<DomMounts['mountDomIngestRoot']>
): ReturnType<DomMounts['mountDomIngestRoot']> {
  return domMounts().then((module) => module.mountDomIngestRoot(...args));
}

export function mountDomIngestRootFromManifest(
  ...args: Parameters<DomMounts['mountDomIngestRootFromManifest']>
): ReturnType<DomMounts['mountDomIngestRootFromManifest']> {
  return domMounts().then((module) => module.mountDomIngestRootFromManifest(...args));
}

export function mountThreeIngestRoot(
  ...args: Parameters<ThreeMounts['mountThreeIngestRoot']>
): ReturnType<ThreeMounts['mountThreeIngestRoot']> {
  return threeMounts().then((module) => module.mountThreeIngestRoot(...args));
}

export function mountThreeIngestRootById(
  ...args: Parameters<ThreeMounts['mountThreeIngestRootById']>
): ReturnType<ThreeMounts['mountThreeIngestRootById']> {
  return threeMounts().then((module) => module.mountThreeIngestRootById(...args));
}

export function mountThreeIngestRootFromManifest(
  ...args: Parameters<ThreeMounts['mountThreeIngestRootFromManifest']>
): ReturnType<ThreeMounts['mountThreeIngestRootFromManifest']> {
  return threeMounts().then((module) => module.mountThreeIngestRootFromManifest(...args));
}

let _boundStore: EditorShellStore | null = null;

/**
 * The editor store, so the dev hook / UI can launch a mount — bound on the
 * store's ARRIVAL (`shell-store-door.ts`), once per project session
 * (`AppRoot` unmounts/remounts `DefaultEditorLayout` under a fresh
 * `EditorProvider` on "return to project screen" -> reopen).
 *
 * D-W3: the arrival is the earliest point every new project session reaches,
 * so it is where a PREVIOUS project's stale mount-failure report is dropped.
 * The rest of the project-switch teardown — the live ingest session itself
 * (`active-ingest.ts`'s slot and the `active-adapter.ts` globals it sets), the
 * play session, the System adapters and the session measurement ledgers — is
 * `project-session-reset.ts`, fired by `project-manager.ts`'s
 * `onProjectSessionEnd`.
 */
onShellStore((store) => {
  _boundStore = store;
  clearMountFailureReports();
});

// What only the ingest lane knows of the state report
// (`editor-state-facets.ts`): the live ingest session's OWN facts (world id,
// surface reached, whether its loop is running, the MEASURED loop verdict)
// — null when nothing is ingested; a non-null facet IS the mount evidence —
// and the state BETWEEN mounted and failed: a mount still waiting for the
// game's first frame, a budget of VISIBLE time (parked on a hidden tab).
registerEditorStateFacet(() => ({
  ingest: ingestStatusFacet(),
  ingestCaptureWait: captureWaitStatus(),
}));

/**
 * S-1, the other half: a mount that FAILED must leave the editor in a stopped,
 * empty state — never in the half-entered "playing" one its own prologue set up.
 *
 * The per-surface mount paths flip `store.setPlayState('playing')` BEFORE the
 * mount is attempted (that flag is what swaps the viewport onto the live
 * scene). When the mount then throws, that flag, plus any authoring
 * adapter/adopted scene a partial mount installed, used to survive — so
 * `vgai status` reported `playing`, the hierarchy kept presenting whatever tree
 * was underneath, and the only trace of the failure was one console line. This
 * is the single teardown every failure path runs: drop the partial session,
 * reset the play surface, and record + broadcast the failure so the status item
 * actually shows.
 *
 * Safe to call when nothing mounted at all (`exitActiveIngest` and
 * `exitPlayScene` are both no-ops on an empty slot/stack), which is what makes
 * it callable from any catch block without first proving how far the mount got.
 */
function reportFailedIngestMount(store: EditorShellStore, report: MountFailureReport): void {
  editorConsole.error(
    `Ingest mount failed for "${report.worldId}" (${report.identity}): ${report.message}`,
    'ingest',
  );
  // Tear down whatever the mount DID publish. Deliberately only this: when
  // the slot was never assigned, nothing overrode the edit-mode authoring
  // composite or adopted a scene, so clearing those here would blank the
  // hierarchy for the project's OTHER roots too. `exitActiveIngest` is a no-op
  // on an empty slot and the full per-kind teardown otherwise.
  exitActiveIngest();
  resetIngestPlaySurface();
  // The prologue's `setPlayState('playing')` must never outlive a failed mount
  // — that flag is what `collectState` reported as a live game (S-1).
  store.setPlayState('stopped');
  addMountFailureReport(report);
  // `addMountFailureReport` notifies the status item through the slot's own
  // subscribe; this broadcast is for the STORE-subscribed panels (hierarchy,
  // play controls) that must re-render off the teardown above — a failed
  // mount never reaches the success path's `notifyIngestEdit()`.
  store.notifyIngestEdit();
}

/**
 * THE manifest read for the whole ingest route chain — and the one place a
 * failure to read it is allowed to end the chain.
 *
 * Each `tryManifestIngestRoute*` used to fetch this for itself behind
 * `.catch(() => null)` and then `return false`. ABSENCE and FAILURE therefore
 * had the same shape, so a project that declared a perfectly good ingest root
 * in a manifest the strict loader rejected — one unrecognized key is enough,
 * the schema is `.strict()` — was declined by all three routes, fell past the
 * hosted lane, and mounted NOTHING, with not one line anywhere saying why:
 * a Boundary row with 0 children over a black frame and a silent console.
 * An in-tree fixture's mount failure was loud through the same session,
 * because `mountCanvasIngestRootById` takes a DISCOVERED descriptor and never
 * reads a manifest at all — the two lanes disagreed about whether failing to
 * mount is something the reader gets told.
 *
 * `null` still means "this chain has nothing to route", but only ever after
 * the reason has been either (a) genuine absence — this project has no
 * manifest, which is not an ingest project and not an error — or (b) said out
 * loud.
 */
async function readIngestChainManifest(): Promise<ResolvedGameManifest | null> {
  // Same realm split as `module-mode.ts`: a storage-backed project's manifest
  // reads through the realm; staged hosted content has its own discovery.
  try {
    return await fetchGameManifest();
  } catch (err) {
    if (isManifestAbsence(err)) return null; // not a manifest project; nothing to explain
    editorConsole.error(
      `Ingest routing: this project's ${MANIFEST_FILENAME} could not be read, so no root was ` +
        `mounted from it — ${formatMountFailureMessage(err)}`,
      'ingest',
    );
    return null;
  }
}

/**
 * D-V2 (composite): every world in `manifest.roots` whose adapter is `{
 * ingest }` — a composite manifest caps this at exactly one (see each
 * `tryManifestIngestRoute*` below); ≥2 is a loud named error via {@link
 * reportTooManyIngestRoots}, never a silent first-wins pick.
 */
function findIngestRoots(manifest: ResolvedGameManifest): ResolvedAdapterRoot[] {
  return ingestRoots(manifest);
}

/**
 * D-V2: the "composite declares ≥2 ingest roots" violation — named, listing
 * every offending world id, reported once (into BOTH `editorConsole` and the
 * D-V5 multi-entry mount-failure report, one entry per offending world so
 * the status item names all of them) by whichever `tryManifestIngestRoute*`
 * happens to run first (module route order: three, pixi, react — see
 * {@link autoLaunchIngest}) — the caller returns `true` right after this
 * (claims the route), so the other two ingest routes never also report it.
 */
function reportTooManyIngestRoots(ingestRoots: ResolvedAdapterRoot[]): void {
  const ids = ingestRoots.map((w) => `"${w.id}"`).join(', ');
  const message =
    'a composite manifest declares exactly ONE ingest world in this slice — found ' +
    `${ingestRoots.length}: ${ids}.`;
  editorConsole.error(`Manifest composite ingest route: ${message}`, 'ingest');
  for (const world of ingestRoots) {
    addMountFailureReport({
      worldId: world.id,
      kind: world.surface,
      identity: world.adapter.identity,
      message,
    });
  }
}

/**
 * D-V2: mount every OTHER world in a composite manifest (every world besides
 * `ingestRootId`, the one just mounted through its own per-surface path) via
 * `ingest-siblings.ts`'s `mountIngestSiblings`, and attach the resulting
 * handles onto the live slot so `exitActiveIngest` tears them down.
 * Dynamically imported — `ingest-siblings.ts` imports from `module-mode.ts`,
 * and a static import here would risk closing that cycle at the wrong end
 * (mirrors {@link autoLaunchIngest}'s own dynamic import of `module-mode.ts`
 * below, for the identical reason). Never throws: `mountIngestSiblings` already
 * catches every individual sibling's failure into the mount-failure report.
 * Returns the mounted handles so the caller can promote authoring (D-E2,
 * {@link promoteToCompositeAuthoring}) — `store` is threaded through so each
 * sibling gets an honest `SiblingMount.authoring` (D-E1).
 */
async function mountCompositeSiblings(
  manifest: ResolvedGameManifest,
  ingestRootId: string,
  gameContainer: HTMLElement,
  projectRoot: string,
  store: EditorShellStore,
): Promise<SiblingMount[]> {
  const { mountIngestSiblings } = await import('./ingest-siblings');
  const siblings = await mountIngestSiblings(
    manifest,
    ingestRootId,
    gameContainer,
    projectRoot,
    store,
  );
  attachIngestSiblings(siblings);
  return siblings;
}

/**
 * D-E2 (promotion on the ingest composite): when a composite's siblings
 * actually mounted (`siblings.length > 0`), promote the active authoring
 * override — currently the PRIMARY ingest world's own plain adapter, installed
 * by the route's own mount that just ran immediately before this call — to
 * a `CompositeAuthoringAdapter` whose ordered children are the primary world
 * FIRST (it is the route's anchor) followed by every mounted sibling in
 * manifest order, each routed by its own manifest `kind`. A single-world mount
 * (`siblings.length === 0`) is untouched — byte-stable, no group node, no
 * wrapper: §1F's single-world clause.
 *
 * The primary's own adapter is read back via `getAuthoringOverride()` rather
 * than threaded as a parameter — every composite route's own mount call
 * already installed it via `setActiveAuthoring` synchronously before
 * this runs (mirrors `attachIngestSiblings`'s identical "just installed"
 * assumption); `null` (defensive only — nothing in this synchronous
 * call chain clears it in between) is a no-op, same guard shape.
 */
function promoteToCompositeAuthoring(
  manifest: ResolvedGameManifest,
  ingestRoot: ResolvedAdapterRoot,
  siblings: readonly SiblingMount[],
): void {
  if (siblings.length === 0) return;
  const primaryAdapter = getAuthoringOverride();
  if (!primaryAdapter) return;
  // A readable hybrid ingest is already a small surface composite (Canvas +
  // nested DOM UI). Flatten those children before adding manifest siblings:
  // CompositeAuthoringAdapter's synthetic `world:*` ids belong to ONE
  // composite and may never be nested inside another composite that would
  // interpret them as its own group ids.
  const primaryChildren: CompositeChild[] =
    primaryAdapter instanceof CompositeAuthoringAdapter
      ? primaryAdapter.childAdapters().map((child) => ({
          worldId: child.worldId,
          kind: child.kind,
          adapter: child.adapter,
          role: child.role,
          zOrder: child.zOrder,
          ...(child.label !== undefined ? { label: child.label } : {}),
          ...(child.parentRootId !== undefined ? { parentRootId: child.parentRootId } : {}),
        }))
      : [{ worldId: ingestRoot.id, kind: ingestRoot.surface, adapter: primaryAdapter }];
  const children: CompositeChild[] = [
    ...primaryChildren,
    ...siblings.map((s) => ({
      worldId: s.worldId,
      kind: rootById(manifest, s.worldId)?.surface ?? 'unknown',
      // D-E1: every successfully-mounted SiblingMount gets an honest
      // `authoring` whenever a store was supplied — every composite route
      // below supplies one, so this is never actually undefined in
      // production; the non-null assertion mirrors D-E2's own spec.
      adapter: s.authoring!,
    })),
  ];
  setActiveAuthoring(new CompositeAuthoringAdapter(children));
}

/**
 * Route 1 of {@link autoLaunchIngest} (T3.3 slice 3, §1E): a manifest-backed
 * project declaring a three-surface `{ ingest }` root mounts straight from
 * that root. Returns `true` if this route applied (whether it succeeded or
 * logged an error) — the caller must not also try route 2 in that case
 * (§1B's "manifest wins" discovery order); `false` means "no manifest, no
 * ingest root at all, or the one ingest root isn't ingest-three", so the
 * next route (canvas, dom, then the hosted lane) still gets a chance.
 *
 * The manifest is HANDED IN ({@link readIngestChainManifest} reads it once for
 * the chain) rather than fetched here. It was fetched per route behind a
 * swallowing `catch`, which made "this project has no manifest" and "this
 * project's manifest is unreadable" the same silent answer — see that
 * function for the dark mount that produced.
 *
 * D-V2 (F24 composite): scans ALL roots for `{ ingest }` adapters, not just
 * `roots[0]` — 0 ingest roots declines (unchanged non-ingest-manifest
 * behavior); ≥2 claims the route and fails loudly
 * ({@link reportTooManyIngestRoots}), mounting nothing; exactly 1 whose
 * identity is `ingest-three` mounts THAT world (wherever it sits in the
 * array) through the existing mount path, then mounts every other world as a
 * sibling ({@link mountCompositeSiblings}) — a sibling failure never
 * unmounts the ingest world (it is caught internally, per-world, by
 * `ingest-siblings.ts`).
 */
async function tryManifestIngestRoute(
  store: EditorShellStore,
  manifest: ResolvedGameManifest | null,
): Promise<boolean> {
  if (!manifest) return false;
  const ingestRoots = findIngestRoots(manifest);
  if (ingestRoots.length === 0) return false;
  if (ingestRoots.length > 1) {
    reportTooManyIngestRoots(ingestRoots);
    return true;
  }
  const ingestRoot = ingestRoots[0]!;
  if (ingestRoot.adapter.identity !== 'ingest-three') return false;

  const project = getCurrentProject();
  if (!project) {
    editorConsole.error(
      'Manifest declares an ingest-three world but no project is open — cannot auto-ingest',
      'ingest',
    );
    return true;
  }
  try {
    await mountThreeIngestRootFromManifest(store, ingestRoot, project.rootPath);
    // D-V2: mount every OTHER world as a composite sibling — a no-op loop
    // when this is a single-world manifest (nothing else to iterate).
    const gameContainer = liveDocumentContainer();
    if (gameContainer) {
      const siblings = await mountCompositeSiblings(
        manifest,
        ingestRoot.id,
        gameContainer,
        project.rootPath,
        store,
      );
      // D-E2: promote to a composite once any sibling actually mounted —
      // byte-stable (no-op) for a single-world manifest.
      promoteToCompositeAuthoring(manifest, ingestRoot, siblings);
    }
  } catch (err) {
    // D-W3 (F9) + S-1: a console line was, until now, the ONLY trace this
    // failure left anywhere in the UI — the default Untitled scene has
    // already loaded by this point (§0.4), so nothing visibly changed, and
    // the half-entered `playState: 'playing'` made the dead world report
    // itself alive. `reportFailedIngestMount` is the one path that resets the
    // surface, records the failure report AND broadcasts it.
    reportFailedIngestMount(store, {
      worldId: ingestRoot.id,
      kind: ingestRoot.surface,
      identity: ingestRoot.adapter.identity,
      message: formatMountFailureMessage(err),
    });
  }
  return true;
}

/**
 * Canvas sibling of {@link tryManifestIngestRoute} (T6.1 slice 4): a
 * manifest-backed project declaring an `ingest-pixi` root mounts straight from
 * that root. Same "applied or not" contract, same D-V2 composite
 * scan/route-selection/sibling-mount shape as its three sibling above.
 */
async function tryManifestIngestRoute2D(
  store: EditorShellStore,
  manifest: ResolvedGameManifest | null,
): Promise<boolean> {
  if (!manifest) return false;
  const ingestRoots = findIngestRoots(manifest);
  if (ingestRoots.length === 0) return false;
  if (ingestRoots.length > 1) {
    reportTooManyIngestRoots(ingestRoots);
    return true;
  }
  const ingestRoot = ingestRoots[0]!;
  if (ingestRoot.adapter.identity !== 'ingest-pixi') return false;

  const project = getCurrentProject();
  if (!project) {
    editorConsole.error(
      'Manifest declares an ingest-pixi world but no project is open — cannot auto-ingest',
      'ingest',
    );
    return true;
  }
  try {
    await mountCanvasIngestRootFromManifest(store, ingestRoot, project.rootPath);
    const gameContainer = liveDocumentContainer();
    if (gameContainer) {
      const siblings = await mountCompositeSiblings(
        manifest,
        ingestRoot.id,
        gameContainer,
        project.rootPath,
        store,
      );
      // D-E2: promote to a composite once any sibling actually mounted —
      // byte-stable (no-op) for a single-world manifest.
      promoteToCompositeAuthoring(manifest, ingestRoot, siblings);
    }
  } catch (err) {
    // D-W3 (F9) + S-1 — see tryManifestIngestRoute's identical comment above.
    reportFailedIngestMount(store, {
      worldId: ingestRoot.id,
      kind: ingestRoot.surface,
      identity: ingestRoot.adapter.identity,
      message: formatMountFailureMessage(err),
    });
  }
  return true;
}

/**
 * DOM sibling of {@link tryManifestIngestRoute}/{@link tryManifestIngestRoute2D}
 * (D-Y2, slice S2): a manifest-backed project declaring an `ingest-react` root
 * mounts the native-React ingest session straight from that root (external
 * folder — `vgai edit <folder>` — not the in-tree `ingest/games/<id>` fixture
 * registry). Same "applied or not" contract, same D-V2 composite scan/
 * route-selection/sibling-mount shape as its three/canvas siblings above.
 */
async function tryManifestIngestRouteReact(
  store: EditorShellStore,
  manifest: ResolvedGameManifest | null,
): Promise<boolean> {
  if (!manifest) return false;
  const ingestRoots = findIngestRoots(manifest);
  if (ingestRoots.length === 0) return false;
  if (ingestRoots.length > 1) {
    reportTooManyIngestRoots(ingestRoots);
    return true;
  }
  const ingestRoot = ingestRoots[0]!;
  if (ingestRoot.adapter.identity !== 'ingest-react') return false;

  const project = getCurrentProject();
  if (!project) {
    editorConsole.error(
      'Manifest declares an ingest-react world but no project is open — cannot auto-ingest',
      'ingest',
    );
    return true;
  }
  try {
    await mountDomIngestRootFromManifest(store, manifest, ingestRoot, project.rootPath);
    const gameContainer = liveDocumentContainer();
    if (gameContainer) {
      const siblings = await mountCompositeSiblings(
        manifest,
        ingestRoot.id,
        gameContainer,
        project.rootPath,
        store,
      );
      // D-E2: promote to a composite once any sibling actually mounted —
      // byte-stable (no-op) for a single-world manifest.
      promoteToCompositeAuthoring(manifest, ingestRoot, siblings);
    }
  } catch (err) {
    // D-W3 (F9) + S-1 — see tryManifestIngestRoute's identical comment above.
    reportFailedIngestMount(store, {
      worldId: ingestRoot.id,
      kind: ingestRoot.surface,
      identity: ingestRoot.adapter.identity,
      message: formatMountFailureMessage(err),
    });
  }
  return true;
}

/**
 * Hosted entry point, called once after `loadInitialScene`: mount whichever
 * `{ ingest }` root the open project declares, from whichever discovery route
 * applies, so ingestion needs no dev hook. Checked in order (§1B's "manifest
 * wins" discovery order):
 *
 *  1. Manifest route, `{ module }` (T3.4 slice 2, `./module-mode.ts`'s
 *     `tryManifestModuleRoute`) — a manifest's first world declaring a custom
 *     adapter module auto-mounts through the generic
 *     `RootAdapter`/`ThreeHostContext` contract (or, since D-Y1, the
 *     WORLDS PATH for a non-three module world — see that file) and installs ITS
 *     OWN `MountedThreeRoot.authoring` as the active override, so the SAME
 *     adapter-driven hierarchy/inspector panels below drive it. Mutually
 *     exclusive with routes 2–4 by construction (a world resolves to exactly one
 *     adapter identity).
 *  2. Manifest route, three (T3.3 slice 3, {@link tryManifestIngestRoute}) — the
 *     CLI-on-folder AC ("point the CLI at an ingest game folder never registered
 *     in source -> opens, plays, edits"). Browser-mode builds fall straight
 *     through to route 5.
 *  3. Manifest route, canvas (T6.1 slice 4, {@link tryManifestIngestRoute2D}) —
 *     the discovery path for an `ingest-pixi` world.
 *  4. Manifest route, dom (D-Y2, {@link tryManifestIngestRouteReact}) —
 *     the external-folder discovery path for an `ingest-react` world. A
 *     manifest's first world resolves to exactly one adapter identity, so
 *     routes 1–4 are mutually exclusive in practice; all are tried since
 *     neither can tell that in advance without fetching.
 *
 * There is no sixth route by id. A vendored game IS a project and opens through
 * the session like every other one, which is what routes 2–4 already read.
 */
export function autoLaunchIngest(store: EditorShellStore): Promise<void> {
  return dedupeAutoLaunch(store, () => autoLaunchIngestInner(store));
}

/**
 * ONE auto-launch per (session, open project) — closing the
 * double-entry the #745 review measured.
 *
 * Two independent bootstraps call {@link autoLaunchIngest}:
 * `world-root-stage.ts`'s boot chain and `NonThreeAuthoringBootstrap.tsx`'s. Both
 * are correct to — neither can know whether the other exists for this project —
 * so the same launch happens twice. `serializeEntry` keeps that
 * from leaving two live sessions, but serializing is not the same as
 * deduplicating: the second call still tears the first mount down and MOUNTS THE
 * GAME AGAIN. For anything with a module-level side effect that is a coin
 * flip — a game registering a named easing curve at import time dies on the
 * second construction with `Custom ease already registered`.
 *
 * The ARCHITECTURE-CORE contract behind problem 17 says it plainly: LOADING
 * CONSTRUCTS, and it constructs once. So the launch is memoized on the store
 * (session identity — a `WeakMap` keeps that from leaking) crossed with the
 * OPEN PROJECT, which is precisely what determines what the launch will do:
 * every route above reads the open project (locally the session's, hosted the
 * one `?project=<id>` resolved) and nothing reads a URL. Both callers await the
 * SAME promise and observe the same outcome, including a rejection.
 */
const _autoLaunched = new WeakMap<EditorShellStore, Map<string, Promise<void>>>();

function dedupeAutoLaunch(store: EditorShellStore, run: () => Promise<void>): Promise<void> {
  let perStore = _autoLaunched.get(store);
  if (!perStore) {
    perStore = new Map();
    _autoLaunched.set(store, perStore);
  }
  // `?? ''` because the key only has to be STABLE per session: a boot with no
  // project open yet (the local no-project dev server, a harness stub) has
  // exactly one launch to dedupe, so one key is the right answer there rather
  // than a crash on the boot path.
  const key = getCurrentProject()?.rootPath ?? '';
  const existing = perStore.get(key);
  if (existing) return existing;
  const started = run();
  perStore.set(key, started);
  return started;
}

/** TEST-ONLY: forget this store's auto-launch memo (see {@link dedupeAutoLaunch}). */
export function resetAutoLaunchDedupeForTests(store: EditorShellStore): void {
  _autoLaunched.delete(store);
}

/**
 * THE route chain, with no opinion about when it runs. Called at boot by
 * {@link autoLaunchIngest} and at the play edge by
 * `deferred-ingest-play.ts`'s `mountDeferredIngestForPlay` — one mount, two
 * moments, so a deferred root's Play is byte-for-byte the mount that used to
 * happen at boot rather than a second implementation of it.
 */
export async function launchIngestRoutes(store: EditorShellStore): Promise<void> {
  const { tryManifestModuleRoute } = await import('./module-mode');
  if (await tryManifestModuleRoute(store)) return;
  // ONE read for all three manifest routes (see `readIngestChainManifest`):
  // they used to fetch it three times and swallow every failure identically.
  const manifest = await readIngestChainManifest();
  if (await tryManifestIngestRoute(store, manifest)) return;
  if (await tryManifestIngestRoute2D(store, manifest)) return;
  await tryManifestIngestRouteReact(store, manifest);
}

async function autoLaunchIngestInner(store: EditorShellStore): Promise<void> {
  // Edit already owns pieces (a named world component, or isolation-document
  // scene tabs) — do not construct the live game underneath them. Play
  // mounts it (`deferred-ingest-play.ts`). Land on the default Edit piece.
  const { deferredIngestPlayActive, ingestMountIsDeferredToPlay } = await import(
    './deferred-ingest-play'
  );
  if (await ingestMountIsDeferredToPlay()) {
    // Story discovery can make the second boot caller arrive after the user
    // has already pressed ▶ and the deferred mount has claimed the session.
    // That late BOOT intent is stale: landing on Edit here used to switch the
    // running game out from under the user, and once cold landing also owned
    // the required hold it paused the game as well. Play is the newer owner;
    // never let an old bootstrap override it.
    if (deferredIngestPlayActive()) return;
    const { landIngestBootInEdit } = await import('./ingest-boot-viewport');
    landIngestBootInEdit(store);
    return;
  }
  await launchIngestRoutes(store);
}

// Dev hook so the editor UI / e2e can drive a mount against the bound store.
// The `typeof window` half matters: this module is imported by
// `command-listener.ts` (S-2 routes relayed play control to the ingest surface),
// and several of that module's suites run under the Node vitest environment
// where a bare top-level `window` write is a load-time ReferenceError.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)['__vgaiIngestApi'] = {
    enter: (gameId: string) => {
      if (!_boundStore) throw new Error('ingest roots not bound');
      return mountThreeIngestRootById(_boundStore, gameId);
    },
    exit: unmountThreeIngestRoot,
    // This hook is the per-surface (three) API — keep it slot-specific;
    // `isIngestActive` itself is kind-agnostic as of F26.
    isActive: () => activeIngest()?.kind === 'three',
  };
  // Canvas sibling (T6.1 slice 4) — same shape, over the canvas ingest session.
  (window as unknown as Record<string, unknown>)['__vgaiIngestApi2D'] = {
    enter: (gameId: string) => {
      if (!_boundStore) throw new Error('ingest roots not bound');
      return mountCanvasIngestRootById(_boundStore, gameId);
    },
    exit: unmountCanvasIngestRoot,
    isActive: () => activeIngest()?.kind === 'canvas',
  };
  // DOM sibling (Track N, N2) — same shape, over the native-React ingest
  // session.
  (window as unknown as Record<string, unknown>)['__vgaiIngestApiReact'] = {
    enter: (folderId: string) => {
      if (!_boundStore) throw new Error('ingest roots not bound');
      return mountDomIngestRoot(_boundStore, folderId);
    },
    exit: unmountDomIngestRoot,
    isActive: () => activeIngest()?.kind === 'dom',
  };
  // Headless-readable mount outcomes —
  // `packages/editor/src/authoring/mount-failure-report.ts`'s multi-entry
  // list is otherwise only ever read by the status bar's `mount-failure`
  // contribution (a React component), invisible to `page.evaluate()`. This is
  // a plain function returning the LIVE list — `vgai doctor`'s browser
  // phase is this surface's first consumer, but any other dev/e2e caller can
  // poll it the same way `__vgaiIngestApi*` are already polled.
  (window as unknown as Record<string, unknown>)['__vgaiMountFailureReports'] = () =>
    getMountFailureReports();
  // D-H1 (Slice B): headless-readable per-sibling signal — the live slot's
  // `siblings` (D-V2's composite-sibling handles, `ingest-siblings.ts`'s
  // `SiblingMount[]`) is otherwise invisible to `page.evaluate()`, same blind spot
  // `__vgaiMountFailureReports` closed for mount failures. A plain function
  // returning a LIVE view (never a snapshot, re-reads the slot on every call) of
  // honest per-sibling flags only — no capture/draw proof, see
  // `DoctorSiblingEvidence`'s doc comment (`packages/editor/src/doctor/report.ts`).
  (window as unknown as Record<string, unknown>)['__vgaiSiblingMounts'] = () =>
    (activeIngest()?.siblings ?? []).map((s) => ({
      worldId: s.worldId,
      setPausedPresent: typeof s.setPaused === 'function',
      authoringPresent: !!s.authoring,
      authoringPersist: s.authoring?.capabilities.persist === true,
    }));
}
