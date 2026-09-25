/**
 * THE DOM MEDIUM'S DESIGN-TIME MOUNT (`@editor/authoring/design-time-mount-registry`).
 * A dom world's design-time surface is its project's portable-CSF BOARD: every
 * composed story of the project laid out as an isolated, labeled frame, with
 * the root entry's own story (derived, never labeled — the story whose CSF
 * `meta.component` is the entry's default export) as the frame it opens on.
 * A project with no stories falls back to mounting the entry once against an
 * inert Game.
 *
 * ## Why this is a package and not the host's
 *
 * It was the `mountReactLayer` half of `@editor/authoring/design-time-layers.ts`,
 * chosen by one literal in one expression — `candidate.kind === 'canvas' ?
 * mountCanvasLayer(…) : mountReactLayer(…)` — against a `LayerMountResult`
 * contract whose own docblock already said the failure/teardown/play lifecycle
 * is "the SAME for both media". Behind that literal the host knew what
 * portable CSF is, imported the story registry and Storybook's preview API
 * with it, and hard-coded this medium's staleness rule besides. The host keeps
 * the layer STACK (epochs, z-order, the eye, the pan transform, the play
 * handoff and Stop's rebuild, the Boundary disclosure a failed mount degrades
 * to) and asks the registry how a medium mounts (WORK.md §The open-source
 * launch item 12, §Stories leave the host edge 9).
 *
 * ## The seam, which is not a new one for this package
 *
 * `@volter/editor-game` already contributes the React/DOM Inspector through the host's
 * own inspector-section registry; this is the second contribution and the
 * fifth registry of the same family (see the registry module's own note for
 * the four it transcribes). The package REGISTERS; the host names no medium.
 *
 * ## What has NOT moved with it, and why — each blocked by a HOST importer
 *
 *  - `react-world-authoring-adapter.ts` (the adapter this mint returns) DID
 *    move, in the same unit: once this mount left, its only host importer
 *    was `dom-authoring-adapter.ts:70`
 *    (`cssColorToHex`/`mapBoxEditPatchKey`/`styleProp`), which had no host
 *    importer of its own, so the pair moved together. `@volter/editor-game` reaches
 *    them as `@volter/editor-game/react/…` and declares the dependency.
 *  - `@editor/authoring/react-story-board.ts` (the board geometry) —
 *    `@editor/components/RootSelectionOverlay.tsx:98`,
 *    `@editor/components/ReactCanvasControls.tsx:15` and
 *    `@editor/canvas-board/CanvasBoardDocument.tsx:57` read its frame
 *    placements. Host chrome drawn OVER the board, which is a different
 *    question from how the board mounts.
 *  - `rememberedPortableStory` / `projectStoryBoardDescriptor` — still the
 *    host's, because `@editor/components/world-documents.tsx:542,570` reads
 *    both, and the host may not import a package. The write half is a door
 *    (`rememberPortableStory`).
 *  - the story-registry modules under `@editor/stories/` — as of 2026-09-19
 *    the only host files left importing them are the THREE-surface board
 *    (`three-board/board-scene.ts`, `three-board/ThreeBoardDocument.tsx`) and
 *    the canvas board (`canvas-board/canvas-board-model.ts`,
 *    `canvas-board/CanvasBoardDocument.tsx`). Neither is this lane's, and
 *    neither is the host's either, which is what the measurement says about
 *    unit 11's unmet half: it waits on those two surfaces, not on this one.
 */

import type {
  DesignTimeRootDescriptor,
  LayerMountResult,
} from '@volter/editor-core/authoring/design-time-layers';
import {
  rememberedPortableStory,
  rememberPortableStory,
} from '@volter/editor-core/authoring/design-time-layers';
import type { DesignTimeMountContext } from '@volter/editor-core/authoring/design-time-mount-registry';
import { formatMountFailureMessage } from '@volter/editor-sdk/kit/mount-failure-report';
import type { ReactStoryBoardSelectionIntent } from '@volter/editor-core/authoring/react-story-board';
import { createReactStoryBoard } from '@volter/editor-core/authoring/react-story-board';
import {
  getRootCanvasViewport,
  setRootCanvasViewport,
} from '@volter/editor-sdk/kit/world-canvas-viewport-state';
import { recordAuthoringConsumerUse } from '@volter/editor-sdk/kit/authoring-seam-evidence';
import { CrashNullBoundary } from '@volter/editor-sdk/kit/crash-null-boundary';
import { readProjectTextFile } from '@volter/editor-sdk/kit/editor-api';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import {
  resolveReactRootMountRuntime,
  resolveWorldProviderForProject,
} from '../host/react-mount-runtime';
import { activeRealmServices } from '../host/realm-services';
import { resolveReactAdapterRootComponent } from '../host/roots/react-root';
import { scopedGameStylesState } from '@volter/editor-core/scoped-game-css';
import { componentIdentityName } from '@volter/editor-core/stories/compose-project-stories';
import { mountIsolatedStory } from '@volter/editor-core/stories/StoryPreviewMount';
import {
  createStoryPresentationIndex,
  storyBoardPresentation,
} from '@volter/editor-core/stories/story-presentation';
import {
  getComponentPreviewStory,
  getProjectPreviewStories,
  getProjectStoryModules,
  type ProjectPreviewStory,
  projectStoriesReady,
  refreshProjectStories,
  subscribeProjectStoryModules,
} from '@volter/editor-core/stories/story-registry';
import { domStoryBoardMembers } from '@volter/editor-threejs/kit/stories/three-story-model';
import { getDesignTokens } from '@volter/editor-core/ui-source/inspect';
import { tierSourceWriteBackend } from '@volter/editor-core/ui-source/tier-source-write-backend';
import { recordViewportFirstFrame } from '@volter/editor-sdk/kit/viewport-activation-timings';
import { createAssetCache } from '@volter/threejs-runtime/assets';
import { createGameLoop } from '@volter/game-runtime/core/game-loop';
import type { ResolvedAdapterRoot } from '@volter/editor-project/manifest/load';
import { createGame, type GameInternal } from '@volter/game-runtime/runtime/game';
import { beginProjectMountEpoch } from '@volter/editor-sdk/session/project-module-url';
import type { ComponentType } from 'react';
import { type OidElementLike, ReactRootAuthoringAdapter } from './react-world-authoring-adapter';
import { paintedContentBounds } from './story-paint-bounds';

/** Set by the DOM re-projection right before it remounts a
 *  DOM candidate: the registry just published, so the mount reads it as is. */
let skipStoryRefreshForRemount = false;

/** Board chrome is also document navigation: apply the story and make its
 * structural row the store selection so global editor surfaces route back to
 * this React adapter rather than the previously selected world. */
function selectPortableStory(adapter: ReactRootAuthoringAdapter | null, storyId: string): void {
  if (!adapter) return;
  recordAuthoringConsumerUse({
    adapter,
    seam: 'editor.stories.apply',
    stage: 'effect',
    detail: `the design board applied portable story ${storyId}`,
    run: () => adapter.stories.apply(storyId, storyId),
  });
  const selection = adapter.selection;
  if (selection) {
    recordAuthoringConsumerUse({
      adapter,
      seam: 'editor.selection.set',
      stage: 'effect',
      detail: `the design board selected portable story ${storyId}`,
      run: () => selection.set([storyId]),
    });
  }
}

/**
 * Seed the session's dom-story mount box from the project's DECLARED
 * resolution, once — the same rung the story CAPTURE lane reads: the screen a
 * UI story's anchors resolve against is a manifest declaration, not a magic
 * "Fill". Seeded only while the session viewport is still untouched, so a
 * size (or Fill) the user picked afterwards always stands, and a project
 * declaring nothing keeps Fill.
 */
let rootViewportSeeded = false;
async function seedRootViewportFromManifest(): Promise<void> {
  if (rootViewportSeeded) return;
  rootViewportSeeded = true;
  const current = getRootCanvasViewport();
  if (current.width !== null || current.height !== null) return;
  try {
    const text = await readProjectTextFile('vgai.project.json');
    if (!text) return;
    const manifest = JSON.parse(text) as {
      resolution?: { width?: unknown; height?: unknown };
    };
    const width = manifest.resolution?.width;
    const height = manifest.resolution?.height;
    if (typeof width !== 'number' || typeof height !== 'number') return;
    if (width < 64 || height < 64 || width > 4096 || height > 4096) return;
    setRootCanvasViewport(width, height);
  } catch {
    // An unreadable manifest declares nothing; Fill stands.
  }
}
/**
 * The inert design-time Game stand-in (B1's one genuine design
 * decision). A REAL `Game` — never a hand-typed duck-typed literal, mirroring
 * this repo's own test convention (`packages/editor/test/adapter-conformance-kit.ts`'s
 * `headlessGame()`) — built with a loop that is constructed but NEVER
 * started/ticked, and with NO roots ever registered. This satisfies
 * `useGame`/`useWorldState` (`@volter/game-runtime/react/world-state`, and any project's own
 * re-export of it) without throwing, genuinely inertly:
 *  - `state.subscribe` never fires — nothing ever calls
 *    `GameStateBridgeInternal.bump()` (only `GameInternal.runFrame` does, and
 *    this Game's loop never runs a frame);
 *  - `state.frameVersion` stays `0` forever;
 *  - `queryByComponent`/`world()`/`roots` are empty/`null` because `roots`
 *    stays `[]` (nothing ever calls `registerRoot`).
 * `defaultRoot`/`components`/`input`/`audio` throw descriptively if touched
 * (same as any fresh `createGame()` before a world registers) — a HUD that
 * reaches for those is out of scope for a design-time stand-in and SHOULD
 * throw loudly, caught by the crash-null boundary below, degrading to the
 * #18 error node rather than silently faking a value.
 *
 * B2 swaps this stand-in's DATA for story-sourced data (a `data`/services
 * seam) — this function is the seam B2 replaces/extends, not a permanent
 * fixture; it never constructs a live Game/sockets.
 */
function createDesignTimeGame(): GameInternal {
  const loop = createGameLoop({ fixedTimestep: 1 / 60, maxSubSteps: 8, update: () => {} });
  return createGame({ loop, assets: createAssetCache() });
}

/**
 * A minimal `ResolvedAdapterRoot` satisfying `resolveReactAdapterRootComponent`
 * (`../binding-resolver.ts`, which reads only `id`/`kind`/`entry` off
 * it) — the fields below it (`adapter`/`capabilities`/`loop`/`description`)
 * are unused by that function but required by the type; filled with the
 * honest "this is a native default-react world" values.
 *
 * `loop: 'gated'` here is the MANIFEST's declared-intent vocabulary
 * (`ResolvedAdapterRoot.loop`, `@volter/editor-project/manifest/load`), and specifically the
 * schema's own `.default('gated')` — not a verdict about anything. It is safe as
 * a declaration precisely because nothing projects it: the only consumer of this
 * stub is `resolveEntryComponent` below, the stub never reaches
 * `resolveAllRoots` (so it mints no `RootMountSpec`), and the measured loop
 * vocabulary that status and coverage speak is a different type entirely
 * (`ingest/same-realm-loop-gate.ts`'s `MeasuredLoop`, which cannot be spelled
 * without a probe's evidence).
 */
function buildResolvedAdapterRootStub(worldId: string, entry: string): ResolvedAdapterRoot {
  return {
    id: worldId,
    surface: 'dom',
    description: undefined,
    adapter: { type: 'builtin', identity: 'dom', surface: 'dom' },
    entry,
    zOrder: 0,
    pausable: true,
    loop: 'gated',
  };
}

type EntryResolution = { ok: true; Entry: ComponentType } | { ok: false; error: unknown };

/**
 * Load a React root's entry component ONCE per layer mount, without throwing.
 * Both of this layer's paths need it: the derived default story is joined
 * against this component's identity, and the inert-Game fallback renders it.
 * A failure is carried rather than thrown so the story board can still open
 * over a project whose entry is broken; only the fallback (which has nothing
 * else to render) rethrows it.
 */
async function resolveEntryComponent(
  worldStub: ResolvedAdapterRoot,
  projectRoot: string,
): Promise<EntryResolution> {
  try {
    // Design-time preview layer: its own mount, therefore its own epoch —
    // and therefore its own realm value over that epoch.
    const realm = await activeRealmServices(projectRoot, beginProjectMountEpoch());
    const Entry = await resolveReactAdapterRootComponent(worldStub, realm);
    return { ok: true, Entry };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * React design-time mount — the entry
 * via the EXISTING #31 loader (`resolveReactAdapterRootComponent`, reused
 * verbatim), wrapped in the canonical engine `WorldProvider`
 * (`resolveWorldProviderForProject`) around the inert
 * `createDesignTimeGame()` stand-in and a React error boundary.
 * `flushSync` forces the initial render/commit/error-boundary-recovery to
 * finish before this call returns (mirrors `ingest-siblings.ts`'s
 * `mountDefaultReactSibling`), so a throwing entry is caught HERE —
 * synchronously — rather than discovered later on react's own schedule.
 *
 * Portable CSF stories take the board path above. This branch is only the
 * explicit no-story fallback and mounts the entry once against the inert Game.
 * On success, it mints the world's live `ReactRootAuthoringAdapter` over this
 * layer's now-mounted DOM — the adapter reflects
 * an already-mounted root, it never mounts one itself; this function is the
 * design-time mount and the adapter class itself is reused.
 *
 * MEASURED while moving it (the brief asked): BOTH `ReactRootAuthoringAdapter`
 * constructions in this file are ADOPTIONS, not mounts. The board branch's
 * (`focusedDomRoot`) reflects a board whose frames `mountIsolatedStory`
 * already mounted, through a facade over the ACTIVE frame's live children;
 * the fallback branch's reflects the layer `root.render`/`flushSync` has
 * already committed into. Neither constructor mounts anything — which is why
 * the adapter class is shared with Play's React branch and the ingest DOM
 * surface, and why the mount is what moved here rather than the adapter.
 */
export async function mountReactDesignLayer(
  candidate: DesignTimeRootDescriptor,
  layer: HTMLElement,
  context: DesignTimeMountContext,
): Promise<LayerMountResult> {
  const { projectRootPath: projectRoot, store, activationDocumentId } = context;
  // NOTE the ORDER: the entry is not required to reach the story board, so the
  // "no entry" refusal below happens AFTER discovery, not before it. A board
  // descriptor may have no entry by construction (the rootless UI board). A
  // board's whole subject is its assigned project stories — an entry only ever
  // picks which UI frame opens first. Refusing up front is what made a board
  // impossible without a root, which is precisely what board presence no
  // longer keys on.

  // D20 — portable Storybook CSF is React's canonical design-time state.
  // Discovery feeds the first-class hierarchy documents below this world.
  // Edit mode lays EVERY composed story of the project out as an isolated,
  // labeled frame on one editor-only board — board membership is
  // project-global, the project's own component gallery. Play still tears
  // this entire surface down and mounts only the manifest entry against the
  // real Game.
  //
  // A remount that the registry's own publish requested already has fresh
  // stories: refreshing again would reload every story module in parallel —
  // the storm the content-write refresh was built to avoid.
  if (skipStoryRefreshForRemount) skipStoryRefreshForRemount = false;
  else await refreshProjectStories({ rootPath: projectRoot });
  // …every story DECLARED as DOM. The registry is project-global and
  // deliberately unfiltered, so THIS board filters its own membership the
  // way the `3D` board filters its own — otherwise a
  // three story is handed to `react-dom`, which renders `<group>`/`<primitive>`
  // as unknown tags into an empty frame.
  const previewStories = getProjectPreviewStories();
  const portableStories = domStoryBoardMembers(previewStories);

  // The root's composed default preview is DERIVED, never labeled: it is the
  // story whose CSF `meta.component` is this root entry's default-exported
  // component. Resolve that component first (the same loader the inert-Game
  // fallback below reuses), then ask the registry for its story.
  //
  // The join is by component NAME, not function identity, and that is
  // measured rather than assumed: a story module is imported at its own
  // `/@fs/<path>?t=<now>` url (`story-discovery.ts`) while a root entry is
  // imported at the mount epoch's `?vgai-mount=<n>` url
  // (`project-module-url.ts`), and browser ES-module identity is per-url — so
  // the component object a story's meta holds is never the object the entry
  // loader returns. `pickComponentPreviewStory` (`story-registry.ts`) is the
  // join this repo already ships for `three` prefab thumbnails: component
  // name, preferring a story module in the component's own source directory.
  const entryPath = candidate.path;
  const entry: EntryResolution = entryPath
    ? await resolveEntryComponent(
        buildResolvedAdapterRootStub(candidate.worldId, entryPath),
        projectRoot,
      )
    : {
        ok: false,
        error: new Error(
          `design-time react layer "${candidate.worldId}": no \`entry\` declared — nothing to mount.`,
        ),
      };
  const entryComponentName = entry.ok ? componentIdentityName(entry.Entry) : undefined;
  const derivedDefaultPortableStory = entryComponentName
    ? getComponentPreviewStory(entryComponentName, candidate.path)
    : null;
  const defaultPortableStory =
    portableStories.find((story) => story.id === derivedDefaultPortableStory?.id) ?? null;
  // The board exists because the PROJECT has stories, never because the
  // derivation matched: an entry that fails to import, or a project whose
  // stories name other components, still gets its whole gallery (the entry
  // is only what picks the INITIAL frame). Without this the derivation would
  // silently gate the entire design surface — a broken entry would take every
  // story down with it.
  if (portableStories.length > 0) {
    const rememberedStoryId = rememberedPortableStory(projectRoot, candidate.worldId);
    // Remembered choice, else the derived default, else discovery order —
    // the same "no explicit default falls back to first" rule the registry
    // has always used.
    const initialPortableStory =
      portableStories.find((story) => story.id === rememberedStoryId) ??
      defaultPortableStory ??
      portableStories[0]!;
    // Only a board that HAS an entry can be missing a story for it. A rootless
    // board (`projectStoryBoardDescriptor`) has no `path` BY CONSTRUCTION — the
    // project declares no `dom` root, so there is no entry component and
    // "give a *.stories.tsx a `meta.component` of this root's entry component"
    // names an action that cannot be taken. Opening on the first story is that
    // board's documented behaviour, not a degraded one. Measured on the
    // repo-vendored `racing-game` ingest, whose manifest declares one ingest
    // root and no dom root: a permanent unresolvable warning on every `vgai`
    // command, for a board that was working exactly as designed.
    if (candidate.path && !defaultPortableStory) {
      editorConsole.warn(
        `[design-time-layers] React root "${candidate.worldId}" has no story naming its entry ` +
          `component${entryComponentName ? ` "${entryComponentName}"` : ''} — the board opens on ` +
          `"${initialPortableStory.label}". Give a *.stories.tsx a \`meta.component\` of this ` +
          "root's entry component to choose its default preview.",
        'authoring',
      );
    }
    let disposed = false;
    let adapter: ReactRootAuthoringAdapter | null = null;
    // A story apply can originate from either hierarchy navigation or board
    // interaction. Hierarchy has no pending board intent and therefore
    // recenters; board clicks explicitly choose highlight-only or zoom.
    let pendingBoardSelectionIntent: ReactStoryBoardSelectionIntent | null = null;
    const mountedByStory = new Map<
      string,
      NonNullable<Awaited<ReturnType<typeof mountIsolatedStory>>>
    >();
    const storyPresentationIndex = createStoryPresentationIndex(portableStories);
    await seedRootViewportFromManifest();
    const board = createReactStoryBoard(
      layer,
      portableStories.map((story) => ({
        id: story.id,
        label: story.label,
        modulePath: story.modulePath,
        ...(story.title ? { title: story.title } : {}),
        parameters: story.parameters,
        ...(story.globals ? { globals: story.globals } : {}),
        ...(story.viewportLocked !== undefined ? { viewportLocked: story.viewportLocked } : {}),
      })),
      initialPortableStory.id,
      (storyId, intent) => {
        pendingBoardSelectionIntent = intent;
        selectPortableStory(adapter, storyId);
      },
      // The board never reaches for the CSF implementation itself
      // (`@editor/authoring/story-board-presentation.ts`): this lane hands it
      // one, reusing the index the React adapter is also constructed against.
      storyBoardPresentation(portableStories, storyPresentationIndex),
    );

    /**
     * Frame the subject: after a story commits, measure its painted union and
     * hand the board the content rectangle to present as the cell — the same
     * decision the canvas board makes from `stage.getBounds()`, made from the
     * DOM. A `fullscreen` story presents its whole declared viewport, and so
     * does a story whose painted union effectively spans it (a full-bleed
     * screen needs no crop even when it forgot to declare). Measured twice —
     * one settle turn after commit, and once more a second later — because a
     * lazy()/Suspense screen commits its wrapper before its chunk lands.
     */
    const measureContent = (story: ProjectPreviewStory): void => {
      if (disposed) return;
      const frame = board.frames.get(story.id);
      if (!frame) return;
      const layout = (story.parameters as { layout?: unknown } | undefined)?.layout;
      if (layout === 'fullscreen') {
        board.setMeasuredFrame(story.id, null);
        return;
      }
      const mount = { width: frame.content.offsetWidth, height: frame.content.offsetHeight };
      const bounds = mount.width > 0 ? paintedContentBounds(frame.content) : null;
      if (!bounds) {
        board.setMeasuredFrame(story.id, null);
        return;
      }
      const PAD = 8;
      const MIN = 48;
      let x0 = Math.max(0, bounds.x - PAD);
      let y0 = Math.max(0, bounds.y - PAD);
      let x1 = Math.min(mount.width, bounds.x + bounds.width + PAD);
      let y1 = Math.min(mount.height, bounds.y + bounds.height + PAD);
      if (x1 - x0 < MIN) {
        const grow = (MIN - (x1 - x0)) / 2;
        x0 = Math.max(0, x0 - grow);
        x1 = Math.min(mount.width, x0 + MIN);
      }
      if (y1 - y0 < MIN) {
        const grow = (MIN - (y1 - y0)) / 2;
        y0 = Math.max(0, y0 - grow);
        y1 = Math.min(mount.height, y0 + MIN);
      }
      if (x1 - x0 >= mount.width * 0.9 && y1 - y0 >= mount.height * 0.9) {
        board.setMeasuredFrame(story.id, null);
        return;
      }
      board.setMeasuredFrame(story.id, {
        frame: { width: Math.round(x1 - x0), height: Math.round(y1 - y0) },
        mount,
        offset: { x: Math.round(x0), y: Math.round(y0) },
      });
    };
    const scheduleContentMeasure = (story: ProjectPreviewStory): void => {
      setTimeout(() => measureContent(story), 0);
      setTimeout(() => measureContent(story), 1_000);
    };

    const mountPortable = async (
      story: ProjectPreviewStory,
      args: Record<string, unknown> = story.args,
    ): Promise<void> => {
      const content = board.frames.get(story.id)?.content;
      if (!content) return;
      try {
        const next = await mountIsolatedStory(
          content,
          story.modulePath,
          story.name,
          story.Component,
          args,
        );
        // A newer args update may claim this story's frame while its loader is
        // still in flight. The portable mount reports that supersession as
        // null; keep the newer handle intact.
        if (!next) return;
        if (disposed) {
          next.unmount();
          return;
        }
        mountedByStory.set(story.id, next);
        board.clearError(story.id);
        scheduleContentMeasure(story);
      } catch (error) {
        const message = formatMountFailureMessage(error);
        board.setError(story.id, message);
        editorConsole.error(
          `[design-time-layers] React root "${candidate.worldId}" failed mounting portable ` +
            `story "${story.name}": ${message}`,
          'authoring',
        );
      }
      store.notifyIngestEdit();
    };

    // Each story owns its own React root and failure boundary. One broken
    // loader therefore marks only its frame instead of blanking the board.
    await Promise.all(portableStories.map((story) => mountPortable(story)));
    // …and the board says so when the project's game CSS could not be applied.
    // `mountIsolatedStory` has already resolved that state by now (it awaits
    // the same per-project install before its first render), so this reads it
    // rather than racing it. A first-party project reports nothing: `note` is
    // non-null only where the host has EVIDENCE of missing page-level styling
    // (`scoped-game-css.ts`).
    board.setNote(scopedGameStylesState().note);
    // A root document opened because the user clicked a hierarchy story must
    // arrive focused on that remembered frame. A first visit with no prior
    // choice keeps the board's fit-all overview.
    if (rememberedStoryId) board.activate(initialPortableStory.id, true);

    const byId = new Map(portableStories.map((story) => [story.id, story]));
    // The adapter deliberately walks only the focused story's live DOM. All
    // frames stay rendered, but Inspector/OID selection has one unambiguous
    // source tree—the same source-global editing semantics as before.
    const focusedDomRoot: OidElementLike = {
      tagName: 'DIV',
      get children() {
        return board.activeContent().children as unknown as ArrayLike<OidElementLike>;
      },
      getAttribute: (name) => layer.getAttribute(name),
      getBoundingClientRect: () => layer.getBoundingClientRect(),
      get style() {
        return layer.style;
      },
      get textContent() {
        return board.activeContent().textContent;
      },
    };
    // The recorder is decided by the ROUTE this host serves, never by how the
    // shell bundle was built — see `tier-source-write-backend.ts` for the
    // packaged-editor bug `import.meta.env.DEV` carried here.
    const boardWriteBackend = await tierSourceWriteBackend();
    adapter = new ReactRootAuthoringAdapter(focusedDomRoot, store, {
      ...(boardWriteBackend ? { writeBackend: boardWriteBackend } : {}),
      // The facade root above is a plain object, so the adapter's own
      // scope-root token lookup cannot run — resolve tokens from the ACTIVE
      // frame's real element instead (its game-CSS scope root carries the
      // project's custom properties; the editor page root never does).
      designTokens: () => {
        const content = board.activeContent();
        const scopeElement =
          content.closest?.('[data-vgai-game-styles]') ??
          content.querySelector?.('[data-vgai-game-styles]') ??
          content;
        return getDesignTokens(
          getComputedStyle(scopeElement) as unknown as Parameters<typeof getDesignTokens>[0],
        );
      },
      assetRoot: layer as unknown as OidElementLike,
      portableStories: portableStories.map((story) => ({
        id: story.id,
        label: story.label,
        args: story.args,
        name: story.name,
        modulePath: story.modulePath,
      })),
      portableHierarchy: storyPresentationIndex,
      activePortableStoryId: initialPortableStory.id,
      onPortableStoryApplied: (storyId) => {
        const story = (storyId ? byId.get(storyId) : null) ?? initialPortableStory;
        rememberPortableStory(projectRoot, candidate.worldId, story.id);
        const intent = pendingBoardSelectionIntent;
        pendingBoardSelectionIntent = null;
        // Direct provider calls come from hierarchy navigation and retain
        // auto-center. A board single-click only changes active/selection;
        // its double-click is the explicit zoom gesture.
        board.activate(story.id, intent === null || intent === 'zoom');
      },
      onPortableStoryArgsChanged: (storyId, args) => {
        const story = byId.get(storyId);
        if (!story) return;
        void mountPortable(story, args).catch((error: unknown) => {
          editorConsole.error(
            `[design-time-layers] React root "${candidate.worldId}" failed updating portable ` +
              `story "${story.name}" args: ${formatMountFailureMessage(error)}`,
            'authoring',
          );
        });
      },
    });
    if (activationDocumentId) {
      requestAnimationFrame(() => recordViewportFirstFrame(activationDocumentId));
    }

    return {
      adapter,
      dispose: () => {
        disposed = true;
        adapter.disposeReactRootAdapter();
        for (const mounted of mountedByStory.values()) mounted.unmount();
        mountedByStory.clear();
        board.dispose();
      },
    };
  }

  // This board has no assigned stories, so an ordinary UI root's entry is the
  // only thing left to show and a failure to load it is this layer's failure
  // (the caller degrades it to a #18 disclosure node).
  if (!entry.ok) throw entry.error instanceof Error ? entry.error : new Error(String(entry.error));

  editorConsole.warn(
    `[design-time-layers] React root "${candidate.worldId}" has no portable CSF preview — the ` +
      'project declares no UI stories. Add a *.stories.tsx; give it a `meta.component` of ' +
      `this root's entry component${entryComponentName ? ` (${entryComponentName}, ${candidate.path})` : ''} ` +
      'to make it this root’s default preview. Falling back to the inert-Game preview.',
    'authoring',
  );

  const Entry = entry.Entry;
  const WorldProvider = await resolveWorldProviderForProject();
  // C1 (phase-b/c1-react-mount): this layer's own react-world mount is a
  // SECOND call site with the identical packaged-runtime dual-React-instance
  // exposure `binding-resolver.ts`'s `ReactRootAdapter.mount()` has — under
  // the packaged runtime, `createElement`/`createRoot`/`flushSync` must come
  // from the PROJECT's own react, not this module's (removed) static
  // imports. See `resolveReactRootMountRuntime`'s doc comment.
  const { createElement, createRoot, flushSync } = await resolveReactRootMountRuntime();
  const game = createDesignTimeGame();
  const root = createRoot(layer);
  const render = (onCaught: (error: unknown) => void): void => {
    root.render(
      createElement(CrashNullBoundary, {
        key: '__entry__',
        onCaught,
        children: createElement(WorldProvider, { game }, createElement(Entry)),
      }),
    );
  };

  let caught: unknown = null;
  flushSync(() => {
    render((error: unknown) => {
      caught = error;
    });
  });
  if (caught !== null) {
    root.unmount();
    throw caught instanceof Error ? caught : new Error(String(caught));
  }

  // Same route-decided recorder as the board branch above.
  const writeBackend = await tierSourceWriteBackend();
  const adapter = new ReactRootAuthoringAdapter(layer, store, {
    ...(writeBackend ? { writeBackend } : {}),
  });
  if (activationDocumentId) {
    requestAnimationFrame(() => recordViewportFirstFrame(activationDocumentId));
  }
  return {
    adapter,
    dispose: () => {
      // A4 (spec 27 §3) — release the adapter's `vite:afterUpdate` echo-reconcile
      // subscription before dropping its DOM, so listeners don't accumulate across
      // layer remounts (a leaked one is harmless — it early-returns on an empty echo —
      // but this keeps teardown clean).
      adapter.disposeReactRootAdapter();
      root.unmount();
      game.dispose();
    },
  };
}

/** A cheap identity for the project's current story MEMBERSHIP — which
 *  stories exist, not their content. An unreadable module counts as its own
 *  member, so a `.stories.tsx` that starts and stops parsing still moves the
 *  signature. */
function storyMembershipSignature(): string {
  return getProjectStoryModules()
    .map((module_) =>
      module_.ok ? module_.stories.map((story) => story.id).join(',') : `!${module_.modulePath}`,
    )
    .join('|');
}

/**
 * THIS MEDIUM'S STALENESS RULE (`DesignTimeMount.reprojectWhen`), moved here
 * with the mount it is about.
 *
 * Story frames re-render through react-refresh; a host with no HMR channel at
 * all kept showing the module the board mounted with after a source write — a dragged
 * crosshair stayed where the live preview left it, and an UNDO (source back
 * to `left: '50%'`) changed nothing on screen until F5. "Ctrl+Z just blinked"
 * for every Windows tester and, measured on the instrument, for macOS too
 * (runhuman passes 135-142; screen read 2026-09-03).
 *
 * The registry's publish after a content write is the moment the fresh module
 * EXISTS, so that is the signal. The module set is compared because the
 * registry notifies at the START of a refresh too (not ready, old modules):
 * acting on the start notification remounted the board with the stale module
 * and then dropped the real publish as "the mount's own" — the crosshair
 * snapped back to its pre-drag spot with the source already at the new one
 * (preview build 68, screen read).
 *
 * RE-PROJECT rather than remount: the host keeps the old layer up until the
 * new one settles, because an empty board on top of the old one IS the flash
 * (runhuman pass 146).
 *
 * ## THE SECOND RULE THIS CARRIES, arrived 2026-09-19 (WORK.md §The
 * open-source launch item 18a)
 *
 * Story MEMBERSHIP — which stories exist, not what is in them — changing
 * while the board is mounted is the other reason its frames go stale: a story
 * saved from the editor's own header, or a hand-edited `.stories.tsx`, was
 * invisible anywhere until a full reload (blind-walk beat 9). That rule lived
 * in `@editor/components/world-documents.tsx`'s `RootDocumentContent`, which
 * mounts the dom board AND the canvas Scene, so a canvas world's whole
 * `<Application>` was being torn down and rebuilt every time an unrelated dom
 * story was saved. It is a statement about a MEDIUM's mounted layers, so it
 * belongs on that medium's mount, which is what `DesignTimeMount.reprojectWhen`
 * is; the stack binds it per medium and applies it only to that medium's
 * candidates (`design-time-layers.ts:717-742`).
 *
 * The two rules differ by TIER and by SIGNAL, which is why one hook carries
 * both rather than two firing on the same publish: the content rule is
 * the MEMBERSHIP of the story set: nothing adds a frame to a mounted board by
 * itself, so a board re-projects when which stories exist changes. A CONTENT
 * change does not re-project — the session's frames re-render through
 * react-refresh.
 */
export function reprojectWhenStoriesRepublish(invalidate: () => void): () => void {
  // The module set the board was last mounted from, and — separately — the
  // MEMBERSHIP of that set (which stories exist, not their content).
  let mountedModules: readonly unknown[] | null = projectStoriesReady()
    ? getProjectStoryModules()
    : null;
  let mountedMembership = mountedModules === null ? null : storyMembershipSignature();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = subscribeProjectStoryModules(() => {
    if (!projectStoriesReady()) return;
    const modules = getProjectStoryModules();
    const membership = storyMembershipSignature();
    if (mountedModules === null) {
      // The mount's own publish: remember it, re-project nothing.
      mountedModules = modules;
      mountedMembership = membership;
      return;
    }
    const membershipChanged = membership !== mountedMembership;
    mountedModules = modules;
    mountedMembership = membership;
    if (!membershipChanged) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // The registry just published, so the mount about to run must not
      // refresh it again: reloading every story module in parallel is the
      // storm the content-write refresh was built to avoid. The host's
      // re-projection runs `mountReactDesignLayer` synchronously enough for
      // the flag to still be set when it reads it (it reads before its first
      // `await`), and the clear is a macrotask behind that.
      skipStoryRefreshForRemount = true;
      invalidate();
      setTimeout(() => {
        skipStoryRefreshForRemount = false;
      }, 0);
    }, 250);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    stop();
  };
}
