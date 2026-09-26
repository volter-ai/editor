/**
 * Design-time layer stack (B1) — the LIFECYCLE of the design-time layers a
 * caller-owned authoring host shows, over mounts the surface PACKAGES
 * register (`design-time-mount-registry.ts`). Runtime still uses a z-ordered
 * composite, but the editor supplies a distinct host per world document; only
 * Game presents the composed result. Layers default `pointer-events:none`;
 * the eye (`world-session-state.ts`'s `hidden`) hides a layer; `interactive`
 * forwards real pointer events for design-time hover/press testing (a mount
 * whose medium IS the document's subject declares `alwaysInteractive` and
 * skips that toggle); `pickLock` is stored only (B4 consumes it in the pick
 * walk). A layer that throws on mount degrades to its A1
 * `BoundaryAuthoringAdapter` error node (#18) via `mount-failure-report.ts` —
 * never a blank editor; every OTHER world (and the focused three world in
 * particular) keeps working regardless.
 *
 * On a successful mount, the world's initial Boundary adapter is REPLACED in
 * the composite by the adapter its mount minted
 * (`CompositeAuthoringAdapter.replaceChild`, B1).
 *
 * `dom` and `canvas` children are candidates for these hosts. The manifest's
 * sole three content root renders through `the world root's stage`'s own
 * `<canvas>` instead, so this module never mounts a competing Three document.
 *
 * WHAT THIS MODULE NO LONGER KNOWS (2026-09-18, WORK.md §The open-source
 * launch item 12): how either medium mounts. It dispatched them in one
 * expression — `candidate.kind === 'canvas' ? mountCanvasLayer : mountReactLayer`
 * — against a `LayerMountResult` contract whose own docblock said the
 * failure/teardown/play lifecycle was "the SAME for both media", and it
 * hard-coded each medium's staleness rule besides (canvas remounted on a
 * storage write, dom re-projected on a story publish). The contract is the
 * seam; `@vgai/dom` and `@vgai/canvas` register against it now, and the play
 * handoff below tears every layer down and restores its Boundary node the
 * instant play starts exactly as it always did — which is why the LIFECYCLE
 * stays here rather than moving with either mount.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { stackOrder } from '@volter/editor-project/adapter/root-stacking';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { getCurrentProject } from '@volter/editor-sdk/kit/project-manager';
import { subscribeToolContributions } from '../tool-loader';
import { BoundaryAuthoringAdapter, type BoundaryRootInfo } from '@volter/editor-sdk/kit/authoring/boundary-authoring-adapter';
import type { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import {
  type DesignTimeMount,
  type DesignTimeMountContext,
  type DesignTimeRootDescriptor,
  designTimeMountFor,
  designTimeMounts,
  type LayerMountResult,
  subscribeDesignTimeMounts,
} from '@volter/editor-sdk/kit/authoring/design-time-mount-registry';

export type { DesignTimeRootDescriptor, LayerMountResult };
import { queueEditModeRebuild } from '@volter/editor-sdk/kit/authoring/edit-mode-authoring';
import {
  addMountFailureReport,
  clearMountFailureReport,
  formatMountFailureMessage,
} from '@volter/editor-sdk/kit/mount-failure-report';
import {
  getRootCanvasViewport,
  resetRootCanvasViewport,
  setRootCanvasViewport,
  subscribeRootCanvasViewport,
} from '@volter/editor-sdk/kit/world-canvas-viewport-state';
import {
  getRootPan,
  panTransformValue,
  type RootViewController,
  resetRootPan,
  subscribeRootPan,
} from '@volter/editor-sdk/kit/world-pan-state';
import { isRootHidden, isRootInteractive } from '@volter/editor-sdk/kit/authoring/world-session-state';
import type { ShellStore } from '@volter/editor-sdk/kit/shell-store';

/** D20: Play tears the design-time adapter down, so the selected CSF state
 * must live one level above that adapter to survive Stop's rebuild. Keyed by
 * project + root so equal root ids in different projects never bleed.
 *
 * IT IS STILL HERE, and it is the one lane word this module has left: the
 * board's mount lives in `@vgai/dom` now, but `components/world-documents.tsx`
 * reads the remembered frame for the UI board document's `presentation()`
 * round-trip, and the host may not import a package. Closing it is the
 * world-documents unit's, which is where the rest of that file's `dom`/
 * `canvas` vocabulary lives too. */
const selectedPortableStoryByRoot = new Map<string, string>();

function portableStorySelectionKey(projectRoot: string, rootId: string): string {
  return `${projectRoot}\0${rootId}`;
}

/** The story a board ROOT last applied (undefined before any selection) —
 *  the view-address door reads this so a presented workspace document can
 *  say which frame it is on (`EditorViewDocument`'s workspace `story`). */
export function rememberedPortableStory(projectRoot: string, rootId: string): string | undefined {
  return selectedPortableStoryByRoot.get(portableStorySelectionKey(projectRoot, rootId));
}

/** The write half, for the registered mount that owns the board: it applies
 *  the story, so it is what knows which frame the root is on. */
export function rememberPortableStory(projectRoot: string, rootId: string, storyId: string): void {
  selectedPortableStoryByRoot.set(portableStorySelectionKey(projectRoot, rootId), storyId);
}

/** Bottom-to-top layer z-index base — strictly below the selection overlay's
 *  z50 and `ToolStrip`+`ViewportOverlay`'s z1000, so canvas-local editing
 *  chrome is never occluded by a design-time layer. */
const BASE_Z_INDEX = 1;

/** One candidate world for a design-time layer — read entirely off its
 *  existing `BoundaryAuthoringAdapter` (kind/path/zOrder/pausable are already
 *  exposed there, independent of whether the composite has a writable manifest
 *  manifest surface — see that adapter's own inspector). */

function readCandidates(composite: CompositeAuthoringAdapter): DesignTimeRootDescriptor[] {
  const out: DesignTimeRootDescriptor[] = [];
  for (const { worldId, adapter } of composite.childAdapters()) {
    if (!(adapter instanceof BoundaryAuthoringAdapter)) continue; // the focused (live) world
    const kind = adapter.inspector.get(worldId, 'kind') as string;
    if (kind !== 'dom' && kind !== 'canvas') continue;
    const reason = adapter.inspector.get(worldId, 'reason');
    if (reason !== undefined) continue; // already an error node — nothing new to attempt
    // An `{ ingest }` root belongs to the ingest routes (`ingest/mount-ingest-root.ts`'s
    // `tryManifestIngestRoute*`), which run the game's OWN code and capture
    // what it renders. A design-time layer mounts a first-party document
    // instead, so pointing it at an ingested game is a category error. A
    // `{ module }` canvas root is the same case: its truth is the game's own
    // imperative source, which this lane does not mount.
    const declaredAdapter = adapter.inspector.get(worldId, 'adapter') as string | undefined;
    if (declaredAdapter?.startsWith('ingest') || declaredAdapter?.startsWith('module')) continue;
    out.push({
      worldId,
      kind,
      path: adapter.inspector.get(worldId, 'path') as string | undefined,
      zOrder: Number(adapter.inspector.get(worldId, 'zOrder') ?? 0),
      pausable: adapter.inspector.get(worldId, 'pausable') !== false,
    });
  }
  return out;
}

/** Snapshot the non-Three roots that can own an edit-time document. Capture
 * this before any root mounts: a successful React mount upgrades its
 * Boundary adapter in-place, while the document still needs the manifest
 * path and stacking metadata that Boundary disclosed. */
export function designTimeRootDescriptors(
  composite: CompositeAuthoringAdapter,
): readonly DesignTimeRootDescriptor[] {
  return readCandidates(composite);
}

/**
 * The id the project's UI board mounts under when the project has NO dom root
 * to own it — a project whose UI components live inside an ingested game, say,
 * whose stories are ordinary discovered CSF but whose manifest declares no
 * `dom` root at all.
 *
 * Board presence keys on STORIES, not roots (owner ruling, 2026-08-15), so
 * this case is not exotic: it is simply the board without a root underneath
 * it. The layer mount needs SOME id — it keys pan state, the remembered story
 * selection and the story overlay — and this is that id.
 *
 * No colon, deliberately. `ReactRootAuthoringAdapter` spells `worldId` into a
 * history `displayName` that `history/resource-registry.ts` validates as a
 * project-relative PATH, and a leading `foo:` reads as a URI scheme and throws
 * out of the constructor (measured on the ingest dom surface, whose
 * `<world>:dom-ui` ids hit exactly that).
 */
export const PROJECT_STORY_BOARD_ROOT_ID = 'ui-components-board';

/** Whether a descriptor names an existing child of the composite — the
 *  question `replaceChild` answers with a loud warn, asked BEFORE calling it so
 *  a rootless board (which by construction has no child) never trips it. */
function isCompositeChild(composite: CompositeAuthoringAdapter, worldId: string): boolean {
  return composite.childAdapters().some((child) => child.worldId === worldId);
}

/** The rootless UI board's descriptor — no `path`, because there is no root
 *  entry to derive a default story from; the board opens on its first story
 *  the same way it does for a root whose entry names no story. */
export function projectStoryBoardDescriptor(): DesignTimeRootDescriptor {
  return {
    worldId: PROJECT_STORY_BOARD_ROOT_ID,
    kind: 'dom',
    path: undefined,
    zOrder: 0,
    pausable: true,
  };
}

/** Re-applies session-local layer CSS (eye + interactive) — cheap, called on
 *  every store notification, never triggers a remount. */
function applySessionStyle(
  layer: HTMLElement,
  worldId: string,
  kind: DesignTimeRootDescriptor['kind'] = 'dom',
): void {
  const display = isRootHidden(worldId) ? 'none' : 'block';
  layer.style.display = display;
  // A mount whose content IS the document's subject declares itself always
  // interactive (a click on it is how you select in it). The `interactive`
  // toggle exists for the other case, where design-time hover/press testing
  // of real UI is opt-in because it competes with authoring gestures. Which
  // medium is which is the mount's statement, not this module's.
  layer.style.pointerEvents =
    designTimeMountFor(kind)?.alwaysInteractive || isRootInteractive(worldId) ? 'auto' : 'none';
  // React story labels live in editor chrome above the full-cover selection
  // overlay so they remain clickable. Mirror the owning world's eye state
  // onto that synchronized sibling.
  for (const child of Array.from(layer.parentElement?.children ?? [])) {
    if (child instanceof HTMLElement && child.dataset['vgaiStoryBoardChromeFor'] === worldId) {
      child.style.display = display;
    }
  }
}

function createLayerElement(
  container: HTMLElement,
  candidate: DesignTimeRootDescriptor,
  zIndex: number,
  canvasScene: boolean,
): HTMLElement {
  const { worldId } = candidate;
  const layer = document.createElement('div');
  layer.dataset['worldId'] = worldId;
  layer.dataset['vgaiRootSurface'] = 'true';
  if (canvasScene) layer.dataset['vgaiCanvasScene'] = 'true';
  layer.style.position = 'absolute';
  layer.style.top = '0';
  layer.style.left = '0';
  layer.style.width = '100%';
  layer.style.height = '100%';
  layer.style.zIndex = String(zIndex);
  // Same containment as the runtime's per-world surfaces (create-runtime.ts,
  // world-surface cssText): make this layer the containing block for
  // `position:fixed` descendants and clip to the world's rectangle, so a
  // game's full-screen UI (`fixed; inset:0` — the natural idiom) renders
  // inside the viewport instead of floating over the editor chrome. Also
  // makes behavior pan-invariant: without it, space-pan's transform (below)
  // suddenly captured `fixed` children that were page-anchored un-panned.
  layer.style.contain = 'layout paint';
  // A project's root renders as it ships: its inherited text properties start from a page's
  // defaults, not the editor's own typography, which would otherwise inherit into it.
  layer.style.cssText +=
    'font: initial; color: initial; letter-spacing: normal; word-spacing: normal;' +
    ' text-align: start; text-indent: 0; text-transform: none; white-space: normal; direction: ltr;';
  applySessionStyle(layer, worldId, candidate.kind);
  // D4 (spec27 §8 "space-pan" row) — seed this layer with whatever pan is
  // currently in effect (normally none — `mountDesignTimeLayers` resets pan
  // on every fresh install, see its own doc comment — but re-applying here
  // too keeps this function correct standalone). See `world-pan-state.ts`'s
  // doc comment for the full lockstep-translate soundness argument: THIS
  // element is exactly `this.root`/`hostRect()` in
  // `react-world-authoring-adapter.ts`, i.e. the host `RectProvider.rect(id)`
  // subtracts — panning it is what keeps `rect(id)` pan-invariant.
  applyPanTransform(layer);
  container.appendChild(layer);
  return layer;
}

/** Re-applies the current shared world-pan transform to one layer element —
 *  called at creation and by `mountDesignTimeLayers`' pan subscription on
 *  every subsequent pan change (see `world-pan-state.ts`). */
function applyPanTransform(layer: HTMLElement): void {
  // A native Canvas Scene renders through its own editor-camera matrix inside
  // a viewport-sized Pixi surface. CSS-transforming that surface would turn
  // it back into the fixed artboard the Scene document is replacing.
  if (layer.dataset['vgaiCanvasScene'] === 'true') {
    layer.style.transform = '';
    layer.style.width = '100%';
    layer.style.height = '100%';
    return;
  }
  layer.style.transform = panTransformValue(getRootPan()) ?? '';
  layer.style.transformOrigin = '0 0';
  // A React story board owns a canvas larger than the visible document and
  // sizes the layer to its complete grid. Responsive viewport changes resize
  // each frame through `react-story-board.ts`; do not collapse that board back
  // to the single-runtime-surface dimensions used by React/Pixi roots.
  if (layer.dataset['vgaiReactStoryBoard'] === 'true') return;
  const viewport = getRootCanvasViewport();
  layer.style.width = viewport.width === null ? '100%' : `${viewport.width}px`;
  layer.style.height = viewport.height === null ? '100%' : `${viewport.height}px`;
}

/**
 * THE CONTRACT every design-time mount answers, whatever its medium — the
 * one this module's own docblock already called "the SAME for both media",
 * exported since the mounts moved into their surface packages
 * (`design-time-mount-registry.ts`).
 */

/**
 * Mount design-time React worlds declared by `composite` into a caller's
 * authoring `container`. `descriptors` narrows the mount to one world for the
 * per-world document model; omission preserves the original multi-layer
 * primitive for bounded callers and integration tests. Returns a disposer
 * that must run before the owning composite is released.
 *
 * A no-op (returns a no-op disposer) when there are no layer candidates or no
 * resolvable current project.
 *
 * Play-mode handoff: the editor's Scene and Game tabs are BOTH always
 * mounted (only one is `display`-visible at a time — the Game tab hosts
 * `play-mode.ts`'s OWN, entirely separate composite/mount over a REAL,
 * ticking `Game`). The instant play starts, this module tears its
 * design-time layers down for the rest of THIS edit session: two
 * independent DOM trees for the SAME react world (this inert stand-in,
 * play-mode's live one) would otherwise carry the SAME `data-testid`s
 * (whatever the entry's own JSX declares, e.g. tri-world's `hud-count`)
 * simultaneously in one document — not just visually confusing, but a
 * genuine test/automation hazard (two elements answering to one testid).
 * Stop symmetrically rebuilds edit-mode authoring and restores the selected
 * portable CSF preview. Play and edit roots never coexist, but neither does
 * Play permanently destroy the authoring surface.
 */
export function mountDesignTimeLayers(
  container: HTMLElement,
  composite: CompositeAuthoringAdapter,
  store: ShellStore,
  descriptors?: readonly DesignTimeRootDescriptor[],
  /**
   * Reports the adapter a descriptor's layer minted, or `null` when its layer
   * goes away. Only a descriptor that names an EXISTING composite child is
   * published INTO the composite (`replaceChild` is an in-place swap; it
   * cannot grow the array, by design) — so a rootless UI board or the Dev
   * component board has no child to upgrade, and this is how its document
   * reaches its adapter for Hierarchy/Inspector routing.
   */
  onAdapter?: (worldId: string, adapter: AuthoringAdapter | null) => void,
  presentation?: {
    /** Native Canvas Scene: independent editor camera and viewport renderer,
     * not the DOM/story-board artboard presentation. */
    readonly canvasSceneView: RootViewController;
  },
  /** When set, first-mount work writes named segments onto this document's
   *  activation clock (`viewport-activation-timings`). */
  activationDocumentId?: string,
): () => void {
  // D4 (spec27 §8 "space-pan" row) — a fresh layer stack starts un-panned:
  // every call here is a "world switch" (initial edit-mode install, or an
  // acknowledged edit-mode re-install — see `world-root-stage.ts`'s
  // `installAll`), so a stale pan offset from a PREVIOUS layer stack must
  // never carry over onto a different one.
  if (presentation) presentation.canvasSceneView.reset();
  else resetRootPan();
  resetRootCanvasViewport();
  // A declared project resolution seeds DOM component preview frames from the
  // same logical screen Play/standalone use. It deliberately does NOT size a
  // native Canvas Scene: that document is an unbounded world view and receives
  // the separate presentation branch above. A responsive preset may still
  // override DOM previews live through ReactCanvasControls.
  const activeProject = getCurrentProject();
  if (!presentation && activeProject?.config.resolution) {
    setRootCanvasViewport(
      activeProject.config.resolution.width,
      activeProject.config.resolution.height,
    );
  }
  // ONE-WAY PLAY HANDOFF, ENTRY HALF. The exit half — the `store.subscribe`
  // listener at the bottom of this function, which flips `playTeardownDone`
  // and calls `suspendForPlay()` when play STARTS — covers "layers were
  // already mounted, then the user hit Play". But it is a TRANSITION
  // listener, so it does nothing at all when play is ALREADY running by the
  // time this function is first called.
  //
  // That ordering is reachable. `the world root's stage`'s `installAll()` (the only
  // caller) runs at the tail of an async chain that fetches
  // `vgai.project.json` on the way here, so a Play issued the moment the
  // editor shell is interactive wins the race on a slow or contended host and
  // `store.playState` is already `'playing'` on arrival. Without this guard we
  // mount a design-time react layer anyway — rendering the project's REAL
  // entry component against `createDesignTimeGame()`'s INERT `Game`, whose
  // `roots` array is `[]` forever and whose loop never ticks (see that
  // function's doc comment). A HUD listing worlds therefore renders an empty
  // list from a Game that never registers one — and, because no further
  // playState TRANSITION ever arrives, `suspendForPlay()` never fires and the
  // layer is never torn down. It also carries the duplicate-`data-testid`
  // hazard this module's own doc comment calls out for the transition case.
  //
  // Play mode owns the react world outright while it runs (it mounts its own
  // live tree over a REAL, ticking Game). So the correct behavior when play
  // is already up is the same one `suspendForPlay()` produces: mount NOTHING.
  // Stop requests a clean edit-mode rebuild below; this entry guard therefore
  // needs to listen for Stop even though it mounted no layers itself.
  if (store.playState !== 'stopped') {
    let disposed = false;
    let rebuildRequested = false;
    const unsubscribe = store.subscribe(() => {
      if (disposed || rebuildRequested || store.playState !== 'stopped') return;
      rebuildRequested = true;
      if (!disposed) queueEditModeRebuild();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }
  const projectRoot = activeProject?.rootPath;
  const candidates = descriptors ? [...descriptors] : readCandidates(composite);
  // C3 — the scene-UI child (at most one, the Three world's): already a
  // LIVE `UIAuthoringAdapter` at composite-install time (`edit-mode-
  // authoring.ts` — no Boundary-to-live upgrade dance needed here, unlike
  // react/pixi), so it's a mount candidate in its own right rather than one
  // of `readCandidates`'s Boundary-only entries.
  if (candidates.length === 0 || !projectRoot) {
    return () => {};
  }
  // Narrowed once: `mountCandidate` below is a function declaration, where
  // the guard's control-flow narrowing does not reach.
  const projectRootPath: string = projectRoot;

  // Bottom-to-top paint order — mirrors `create-runtime.ts`'s own stacking
  // pass, over exactly the roots this module lays out (react/pixi
  // candidates only; the Three world keeps its untouched canvas
  // slot below all of these — see the module doc comment).
  const sorted = stackOrder(candidates.map((c) => ({ id: c.worldId, zOrder: c.zOrder })));
  const orderedCandidates = sorted.map((s) => candidates.find((c) => c.worldId === s.id)!);

  const candidateByRoot = new Map(orderedCandidates.map((c) => [c.worldId, c]));
  const layers = new Map<string, HTMLElement>();
  const disposersByWorld = new Map<string, () => void>();
  /** Per-world mount generation — a remount supersedes any in-flight mount. */
  const mountEpochs = new Map<string, number>();
  // Worlds whose Boundary child we upgraded to a LIVE design-time adapter
  // (successful react mounts). Tracked so the one-way play handoff can put an
  // HONEST disclosure node back in the composite instead of leaving a live
  // adapter over torn-down DOM (which renders silently empty — a #18 violation).
  const upgraded = new Set<string>();
  /** Worlds whose medium has no registered mount YET — see `mountCandidate`. */
  const awaitingMount = new Set<string>();
  /** Worlds already told, in their Boundary node, that no package registered
   *  a mount for their medium. Said once per stack, never twice. */
  const refusedMount = new Set<string>();
  let torndown = false; // the whole-module disposer (the world root's stage unmount) ran
  let playTeardownDone = false; // the one-way play-mode handoff (see doc comment) ran
  let rebuildRequested = false;

  function disposeEverything(): void {
    for (const dispose of disposersByWorld.values()) {
      try {
        dispose();
      } catch (err) {
        editorConsole.error(`[design-time-layers] dispose failed: ${err}`, 'authoring');
      }
    }
    disposersByWorld.clear();
    for (const layer of layers.values()) layer.remove();
    layers.clear();
    // A reported adapter now points at torn-down DOM. Retract it in the same
    // gesture that freed it — the composite half of this (`suspendForPlay`'s
    // Boundary swap) exists for exactly the same reason.
    for (const candidate of orderedCandidates) onAdapter?.(candidate.worldId, null);
  }

  /**
   * Play handoff: dispose the design-time layers AND revert every
   * upgraded world back to a `BoundaryAuthoringAdapter` disclosure node
   * (#18 — never silently empty). Not called on the whole-module disposer
   * (`torndown`, the world root's stage unmount), where the composite is going away
   * anyway. Stop dispatches one edit-mode rebuild after the live runtime has
   * torn down, restoring the CSF-backed design surface. The scene-UI layer's DOM is
   * torn down the same way (play mode renders scene-UI through the real
   * engine's HUD mount instead — two live DOM trees for the same testids
   * would be the same hazard `design-time-layers.ts`'s own doc comment
   * already calls out for react roots); its adapter is left alone (still
   * live, just without a mounted layer) since there is no Boundary form of it.
   */
  function suspendForPlay(): void {
    disposeEverything();
    for (const worldId of upgraded) {
      const c = candidateByRoot.get(worldId);
      if (!c) continue;
      const info: BoundaryRootInfo = {
        id: c.worldId,
        kind: c.kind,
        entryOrScenePath: c.path,
        zOrder: c.zOrder,
        pausable: c.pausable,
      };
      composite.replaceChild(
        worldId,
        new BoundaryAuthoringAdapter(
          store,
          info,
          'Design-time layer suspended by play mode — Stop restores it.',
        ),
      );
    }
    upgraded.clear();
    store.notifyIngestEdit();
  }

  function mountCandidate(
    candidate: DesignTimeRootDescriptor,
    i: number,
    /** Runs once this mount has settled (mounted or failed) — the hook a
     *  re-projection uses to take the PREVIOUS layer down only then. */
    onSettled?: () => void,
  ): void {
    const registered = designTimeMountFor(candidate.kind);
    // NO REGISTERED MOUNT IS NOT A FAILURE, and specifically not YET a
    // failure: contributions load asynchronously (the inventory pass waits
    // for the first viewport frame), so a layer stack installed at project
    // open routinely runs before the package that owns this medium has
    // registered. Wait, silently, with no layer and no console line — the
    // world's own Boundary node is already standing in the composite, which
    // is the disclosure. `awaitingMount` is what the registration
    // subscription below mounts once the package arrives, and what the
    // contribution pass turns into a NAMED refusal if it never does.
    if (!registered) {
      awaitingMount.add(candidate.worldId);
      return;
    }
    awaitingMount.delete(candidate.worldId);
    const epoch = (mountEpochs.get(candidate.worldId) ?? 0) + 1;
    mountEpochs.set(candidate.worldId, epoch);
    const layer = createLayerElement(container, candidate, BASE_Z_INDEX + i, !!presentation);
    layers.set(candidate.worldId, layer);

    const context: DesignTimeMountContext = {
      projectRootPath,
      store: store,
      ...(presentation ? { view: presentation.canvasSceneView } : {}),
      ...(activationDocumentId ? { activationDocumentId } : {}),
    };

    // Wrapped so a mount that throws SYNCHRONOUSLY (an implementation that
    // is not itself `async`) still lands in the boundary path below rather
    // than escaping this call.
    const mountPromise: Promise<LayerMountResult> = (async () =>
      registered.mount(candidate, layer, context))();

    mountPromise
      .then((result) => {
        if (torndown || playTeardownDone || mountEpochs.get(candidate.worldId) !== epoch) {
          result.dispose();
          return;
        }
        if (result.adapter) {
          // A descriptor with no composite child of its own (rootless UI or
          // the Dev component board) is reported below and nowhere else:
          // `replaceChild` would only warn and ignore, which is the right
          // refusal for a real mis-routing and pure noise for a board that
          // never had a child. For a real child, replace FIRST: publishing the
          // mounted adapter into React before the composite owns its ids gives
          // one render where selection belongs to neither surface. Besides a
          // false unowned-id refusal, logging that refusal during render makes
          // the console tray update while RootSelectionOverlay is rendering.
          if (isCompositeChild(composite, candidate.worldId)) {
            composite.replaceChild(candidate.worldId, result.adapter);
            upgraded.add(candidate.worldId);
          }
          onAdapter?.(candidate.worldId, result.adapter);
        } else if (result.pick) {
          // Opaque/foreign Pixi roots can expose a stage pick without a
          // source-authoring adapter. Re-wrap their Boundary with the pick and
          // track it in `upgraded`: `suspendForPlay` must remove a pick that
          // closes over a disposed Pixi stage.
          const info: BoundaryRootInfo = {
            id: candidate.worldId,
            kind: candidate.kind,
            entryOrScenePath: candidate.path,
            zOrder: candidate.zOrder,
            pausable: candidate.pausable,
          };
          composite.replaceChild(
            candidate.worldId,
            new BoundaryAuthoringAdapter(store, info, undefined, result.pick),
          );
          upgraded.add(candidate.worldId);
        }
        disposersByWorld.set(candidate.worldId, result.dispose);
        // PD-1: this root is mounted — retract any failure recorded for it by
        // an earlier attempt (per-world, never the whole list: a sibling root
        // that is still down keeps its own report).
        clearMountFailureReport(candidate.worldId);
        store.notifyIngestEdit();
        onSettled?.();
      })
      .catch((err: unknown) => {
        if (mountEpochs.get(candidate.worldId) !== epoch) return;
        onSettled?.();
        layer.remove();
        if (layers.get(candidate.worldId) === layer) layers.delete(candidate.worldId);
        if (torndown || playTeardownDone) return;
        const message = formatMountFailureMessage(err);
        editorConsole.error(
          `[design-time-layers] world "${candidate.worldId}" (${candidate.kind}) failed to ` +
            `mount: ${message}`,
          'authoring',
        );
        const info: BoundaryRootInfo = {
          id: candidate.worldId,
          kind: candidate.kind,
          entryOrScenePath: candidate.path,
          zOrder: candidate.zOrder,
          pausable: candidate.pausable,
        };
        onAdapter?.(candidate.worldId, null);
        if (isCompositeChild(composite, candidate.worldId)) {
          composite.replaceChild(
            candidate.worldId,
            new BoundaryAuthoringAdapter(store, info, message),
          );
        }
        addMountFailureReport({
          worldId: candidate.worldId,
          kind: candidate.kind,
          identity: registered.identity,
          message,
        });
        store.notifyIngestEdit();
      });
  }
  orderedCandidates.forEach((candidate, i) => {
    mountCandidate(candidate, i);
  });

  /**
   * Dispose one world's mount and mount it again from CURRENT source —
   * the canvas lane's absorb-by-remount unit (storage watch below).
   */
  /**
   * A remount that keeps the OLD layer on screen until the new one has
   * settled. `remountCandidate` tears the layer down first, so every
   * re-projection was a visible flash — "it flickers like a reload, then the
   * change is applied" (runhuman pass 144). The new layer is created on top;
   * when its mount settles the previous one is disposed and removed.
   */
  function reprojectCandidate(candidate: DesignTimeRootDescriptor, i: number): void {
    const prevDispose = disposersByWorld.get(candidate.worldId);
    disposersByWorld.delete(candidate.worldId);
    const prevLayer = layers.get(candidate.worldId);
    layers.delete(candidate.worldId);
    mountCandidate(candidate, i, () => {
      // The new layer mounted hidden — its frames fill in over a second and
      // an empty board on top of the old one IS the flash (runhuman pass
      // 146 still saw it with the old layer kept). Show it only now.
      const next = layers.get(candidate.worldId);
      if (next) next.style.visibility = '';
      if (prevDispose) {
        try {
          prevDispose();
        } catch (err) {
          editorConsole.error(
            `[design-time-layers] re-projection dispose failed: ${err}`,
            'authoring',
          );
        }
      }
      prevLayer?.remove();
    });
    const next = layers.get(candidate.worldId);
    if (next && next !== prevLayer) next.style.visibility = 'hidden';
  }

  function remountCandidate(candidate: DesignTimeRootDescriptor, i: number): void {
    const prev = disposersByWorld.get(candidate.worldId);
    disposersByWorld.delete(candidate.worldId);
    if (prev) {
      try {
        prev();
      } catch (err) {
        editorConsole.error(`[design-time-layers] remount dispose failed: ${err}`, 'authoring');
      }
    }
    const oldLayer = layers.get(candidate.worldId);
    if (oldLayer) {
      oldLayer.remove();
      layers.delete(candidate.worldId);
    }
    mountCandidate(candidate, i);
  }

  // WHEN A MOUNTED LAYER GOES STALE IS THE MOUNT'S STATEMENT, NOT THIS
  // MODULE'S. Two rules used to be hard-coded here, each bought with a
  // measured screen. A canvas layer REMOUNTS when a write lands with no HMR
  // channel to re-execute it: without that a structural write landed in
  // source while the live board kept showing the old world until F5 (runhuman
  // pass 61: "when I duplicated, nothing happened... when you refresh, now it
  // shows"). A dom board RE-PROJECTS when its story registry publishes: same absence of
  // HMR, and a dragged crosshair stayed where the live preview left it while
  // an UNDO changed nothing on screen until F5 — "Ctrl+Z just blinked" for
  // every Windows tester and, measured on the instrument, for macOS too
  // (runhuman passes 135–142; screen read 2026-09-03). Both are facts about a
  // MEDIUM, so both travel with the mount now.
  //
  // WHAT STAYS HERE is the pair of ACTIONS and the one question this module
  // can answer — whether a stale layer may be replaced right now (not while
  // play is running, not after teardown). REMOUNT tears the old layer down
  // first; RE-PROJECT mounts the new one on top and disposes the previous
  // only once it has settled, because an empty board over the old one IS the
  // flash (runhuman pass 146). A mount asks for the one its medium affords.
  // The three world is neither: it runs its own design session with its own
  // absorb protocol (`r3f-design-session.ts`).
  const invalidationStops = new Map<DesignTimeMount, () => void>();
  function bindInvalidations(): void {
    for (const [mount, stop] of invalidationStops) {
      if (designTimeMountFor(mount.kind) === mount) continue;
      // Replaced (an HMR re-evaluation) or removed: its hooks are stale.
      stop();
      invalidationStops.delete(mount);
    }
    for (const mount of designTimeMounts()) {
      if (invalidationStops.has(mount)) continue;
      if (designTimeMountFor(mount.kind) !== mount) continue;
      if (!orderedCandidates.some((c) => c.kind === mount.kind)) continue;
      const stops: Array<() => void> = [];
      const invalidate =
        (apply: (candidate: DesignTimeRootDescriptor, index: number) => void) => (): void => {
          if (torndown || playTeardownDone || store.playState !== 'stopped') return;
          orderedCandidates.forEach((candidate, index) => {
            if (candidate.kind === mount.kind) apply(candidate, index);
          });
        };
      if (mount.remountWhen) stops.push(mount.remountWhen(invalidate(remountCandidate)));
      if (mount.reprojectWhen) stops.push(mount.reprojectWhen(invalidate(reprojectCandidate)));
      invalidationStops.set(mount, () => {
        for (const stop of stops) stop();
      });
    }
  }
  bindInvalidations();

  // A PACKAGE THAT ARRIVES LATE STILL GETS ITS LAYER. The contribution pass
  // that loads the surface packages is deferred behind the first viewport
  // frame (`project-tool-discovery.ts`), so on a cold open this stack is
  // routinely installed before any of them has registered. Every candidate it
  // could not mount is waiting in `awaitingMount`; a registration is the
  // moment to mount it, and the moment to bind that medium's staleness hooks.
  const unsubMounts = subscribeDesignTimeMounts(() => {
    if (torndown || playTeardownDone || store.playState !== 'stopped') return;
    orderedCandidates.forEach((candidate, index) => {
      if (!awaitingMount.has(candidate.worldId)) return;
      if (!designTimeMountFor(candidate.kind)) return;
      refusedMount.delete(candidate.worldId);
      clearMountFailureReport(candidate.worldId);
      mountCandidate(candidate, index);
    });
    bindInvalidations();
  });

  // ...AND A MEDIUM NO PACKAGE OWNS SAYS SO. Once a contribution pass has
  // installed, "nothing registered" has stopped being "not yet" and become
  // the answer — the honest emptiness a build whose package list carries no
  // mount for this medium gives. It is a Boundary disclosure, deliberately
  // NOT an `editorConsole.error` and not a mount-failure report: a build
  // shipping no such package is a configuration fact, not a failure, and a
  // later registration above still upgrades it.
  const unsubContributions = subscribeToolContributions(() => {
    if (torndown || playTeardownDone) return;
    let refused = false;
    for (const candidate of orderedCandidates) {
      if (!awaitingMount.has(candidate.worldId)) continue;
      if (refusedMount.has(candidate.worldId)) continue;
      if (designTimeMountFor(candidate.kind)) continue;
      refusedMount.add(candidate.worldId);
      if (!isCompositeChild(composite, candidate.worldId)) continue;
      const info: BoundaryRootInfo = {
        id: candidate.worldId,
        kind: candidate.kind,
        entryOrScenePath: candidate.path,
        zOrder: candidate.zOrder,
        pausable: candidate.pausable,
      };
      composite.replaceChild(
        candidate.worldId,
        new BoundaryAuthoringAdapter(
          store,
          info,
          `No package in this editor registered a design-time mount for a "${candidate.kind}" ` +
            'world, so there is nothing here to author it with. A build ships the packages its ' +
            'own entry in `builds/` lists.',
        ),
      );
      refused = true;
    }
    if (refused) store.notifyIngestEdit();
  });

  // D4 (spec27 §8 "space-pan" row) — the lockstep half of the pan feature:
  // re-apply the current shared transform to every currently-mounted layer
  // the instant it changes (`RootSelectionOverlay`'s own outer wrapper binds
  // the SAME `subscribeRootPan`/`panTransformValue` pair independently — see
  // `world-pan-state.ts`'s doc comment for why applying the identical value
  // at both mount points is what keeps `rect(id)` pan-invariant). A cheap
  // style write, never a remount.
  const unsubPan = subscribeRootPan(() => {
    for (const layer of layers.values()) applyPanTransform(layer);
  });
  const unsubViewport = subscribeRootCanvasViewport(() => {
    for (const layer of layers.values()) applyPanTransform(layer);
  });

  const unsubStore = store.subscribe(() => {
    if (!playTeardownDone && store.playState !== 'stopped') {
      playTeardownDone = true;
      suspendForPlay();
      return;
    }
    if (playTeardownDone && !rebuildRequested && store.playState === 'stopped' && !torndown) {
      rebuildRequested = true;
      // Reuse the world root's stage's one authoritative reinstall path. The event
      // causes this mount's disposer to run before the replacement composite
      // and layers are installed, so no React root or adapter survives across
      // the Play -> Stop boundary.
      if (!torndown) queueEditModeRebuild();
      return;
    }
    // Session toggles (eye/interactive) change via `store.notifyIngestEdit()`
    // (`GameHierarchy.tsx`'s row affordances) — this is a cheap style
    // re-apply, never a remount.
    if (!playTeardownDone) {
      for (const [worldId, layer] of layers) {
        applySessionStyle(layer, worldId, candidateByRoot.get(worldId)?.kind ?? 'dom');
      }
    }
  });

  return () => {
    torndown = true;
    for (const stop of invalidationStops.values()) stop();
    invalidationStops.clear();
    unsubMounts();
    unsubContributions();
    unsubStore();
    unsubPan();
    unsubViewport();
    disposeEverything();
  };
}
