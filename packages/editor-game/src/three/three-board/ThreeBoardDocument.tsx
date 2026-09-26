import { threeObject } from '@volter/editor-threejs/adapter/three-contract';
import { registerAvailableWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-available-documents';
/**
 * The 3D COMPONENTS board — a generated, never-persisted 3D scene laying out
 * every qualifying `three` story's mounted `Object3D` at TRUE SCALE, so a
 * player-sized prop and a building can be compared by eye instead of by two
 * thumbnails cropped to the same box.
 *
 * It is the three-side counterpart of the project's `UI` board
 * (`components/world-documents.tsx`): one pinned center document per project,
 * installed by `installRootDocuments()`, showing everything the project has
 * built and opening ONE of them on demand.
 *
 * It is a workspace document like any other and it reuses the EXISTING Object3D
 * document surface (`components/StageHost.tsx`'s
 * `Object3DDocumentViewport`) — orbit, pick, framing, the document toolbar and
 * the presentation session all come free, and there is deliberately no second
 * viewport class in this repo.
 *
 * ## Opening one story
 *
 * Double-clicking an exhibit opens that story's own turntable document
 * (`THREE_STORY_DOCUMENT_OPENER`), exactly as double-clicking a story
 * node in the hierarchy opens a React story document (`GameHierarchy.tsx` →
 * `openStoryDocumentByStoryId`). Double-click, not single: a single click
 * SELECTS (which is what feeds the Exhibit section below), and opening a tab
 * on every stray click while orbiting would make the board unusable.
 *
 * ## Lifetime — one owner
 *
 * This component owns the built {@link ThreeBoardScene}. Its effect disposes the
 * previous scene whenever the story registry changes and on unmount; the
 * viewport's own `build().dispose` is a no-op precisely so there is exactly ONE
 * teardown path (`ThreeBoardScene.dispose`, whose ownership is stated in
 * `board-scene.ts`). React runs the child viewport's cleanup before this
 * component's, so the graph is out of the render scene before it is freed.
 *
 * ## What is chrome and what is content
 *
 * District, exhibit and ghost-slot LABELS are HTML in the overlay below —
 * projected each frame from the document session's live camera — never
 * in-scene sprites, so the generated content graph contains exhibits and ghost
 * slots and nothing else. The one piece of in-scene furniture (the district
 * floor pads) is built and marked editor-owned by `board-scene.ts`; exhibits
 * themselves stand directly on the floor.
 *
 * ## Ghost slots open SOURCE
 *
 * A ghost slot has no story document to open, so its double-click routes to
 * the component's source through the editor's standing open-source affordance
 * (`instance-source-actions.ts` — copy the `file:line` locator and SAY so;
 * there is no code surface in the workspace, and that module owns the honest
 * degradation). Same sentences, same clipboard path, never a silent no-op.
 */

import { object3DDocumentSession } from '@volter/editor-threejs/kit/authoring/object3d-document-session-registry';
import { Object3DDocumentViewport } from '@volter/editor-threejs/kit/components/Object3DDocumentViewport';
import { STANDARD_COMPONENT_CAMERA_DIRECTION } from '@volter/editor-threejs/kit/components/standard-viewport-dressing';
import { threeBoardBuildingCopy } from '@volter/editor-sdk/kit/viewport-surface-status';
import { openRegisteredDocument } from '@volter/editor-sdk/kit/document-open-registry';
import { listProjectComponents } from '@volter/editor-sdk/kit/editor-api';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { createHmrRegistrationGroup } from '@volter/editor-sdk/kit/hmr-registration-group';
import { CONTRIBUTED_SECTION_ORDER } from '@volter/editor-sdk/kit/inspection-model';
import {
  type InspectorSectionProps,
  registerInspectorSections,
} from '@volter/editor-sdk/kit/inspector-section-registry';
import { type ClipboardWriter, runInstanceSourceAction } from '@volter/editor-sdk/kit/instance-source-actions';
import { getProjectStoryRegions } from '@volter/editor-sdk/kit/stories/project-story-regions';
import { declaredStoryMedium } from '@volter/editor-sdk/kit/stories/story-declared-medium';
import { THREE_STORY_DOCUMENT_OPENER } from '@volter/editor-sdk/kit/story-document-openers';
import {
  getProjectStoryModules,
  type ProjectStoryModule,
  subscribeProjectStoryModules,
  whenProjectStoriesReady,
} from '@volter/editor-core/stories/story-registry';
import { showTransientHint } from '@volter/editor-sdk/kit/transient-hint';
import {
  beginViewportBreakdown,
  cancelViewportBreakdown,
  markViewportBoardReady,
  markViewportReactActive,
  markViewportSegment,
} from '@volter/editor-sdk/kit/viewport-activation-timings';
import { THREE_COMPONENTS_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activeWorkspaceDocument,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import type { WorkspaceStateStore } from '@volter/editor-sdk/kit/workspace-document-restore';
import { faCircleInfo } from '@fortawesome/free-solid-svg-icons';
import { themeVars } from '@volter/editor-sdk/widgets';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import {
  BOARD_GHOST_GROUP_KEY,
  type BoardExhibit,
  type BoardGhostSlot,
  boardComponentKeyForObject,
  boardStoryIdForObject,
  buildThreeBoard,
  disposeThreeBoard,
  summarizeBoardSkips,
  type ThreeBoardScene,
  threeBoardCandidateCount,
} from './board-scene';

/** The board is a project-wide singleton: one generated view of one registry.
 *  Symmetric with `UI_COMPONENTS_DOCUMENT_ID` — a stable project-level id, so
 *  a persisted layout never strands the panel when a root or file is renamed. */
export { THREE_COMPONENTS_DOCUMENT_ID };

/** The tab reads `3D`, the peer of `Scene` and `UI` in the center strip. The
 *  document ID keeps its longer historical spelling because persisted layouts
 *  address panels by id. */
const THREE_COMPONENTS_TITLE = '3D';

/** The narrow store surface the document needs. It is the seam's own
 *  (`workspace-document-restore.ts`), because opening a story document is the
 *  board's click-through — one type, not two identical ones. */
export type ThreeBoardStore = WorkspaceStateStore;

// --- Live scene state, shared with the Inspector section -------------------

let _scene: ThreeBoardScene | null = null;
let _version = 0;
const _listeners = new Set<() => void>();

function notifyChanged(): void {
  _version++;
  for (const listener of _listeners) listener();
}

function subscribeThreeBoard(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function threeBoardVersion(): number {
  return _version;
}

// --- Document ---------------------------------------------------------------

type BuildState =
  | { readonly status: 'idle' }
  | { readonly status: 'building' }
  | { readonly status: 'ready'; readonly scene: ThreeBoardScene }
  | { readonly status: 'error'; readonly message: string };

interface ProjectedLabel {
  readonly key: string;
  readonly text: string;
  readonly detail: string;
  readonly district: boolean;
  /** Ghost-slot styling: dashed border, muted text — the "No story yet" look. */
  readonly ghost: boolean;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

/** Metres, rendered the way a scale readout should read (`0.4 m`, `12 m`). */
function formatMetres(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value >= 10) return `${Math.round(value)} m`;
  if (value >= 1) return `${value.toFixed(1)} m`;
  return `${value.toFixed(2)} m`;
}

/**
 * The board's click-through: resolve a picked object to the exhibit it belongs
 * to and open that story's own document. Exported for the headless test —
 * everything it needs is an object and the built scene, so it never touches a
 * renderer.
 *
 * Returns the opened document's id, or `null` when the pick landed on chrome,
 * on nothing, or on an exhibit the current scene no longer knows.
 */
export function openExhibitStoryDocument(
  store: ThreeBoardStore,
  scene: ThreeBoardScene | null,
  object: THREE.Object3D | null,
): string | null {
  const exhibit = findExhibitIn(scene, object);
  if (!exhibit) return null;
  return openRegisteredDocument(THREE_STORY_DOCUMENT_OPENER, store, {
    modulePath: exhibit.modulePath,
    storyName: exhibit.storyName,
    title: exhibit.label,
  });
}

/**
 * The ghost slot's click-through: a storyless component has no story document,
 * so its double-click routes to the component's SOURCE through the editor's
 * standing open-source affordance (`runInstanceSourceAction` — the same
 * sentences and clipboard path the hierarchy's "Open Component Source" uses;
 * the locator is the component index's own `path:line`). Returns the pending
 * sentence to show, or `null` when the pick was not a ghost slot. Exported for
 * the headless test, which injects its own clipboard writer.
 */
export function openGhostComponentSource(
  scene: ThreeBoardScene | null,
  object: THREE.Object3D | null,
  writeText?: ClipboardWriter,
): Promise<string> | null {
  const ghost = findGhostIn(scene, object);
  if (!ghost) return null;
  const locator = {
    definitionLocation: () => ({ file: ghost.path, line: ghost.line }),
  };
  return writeText
    ? runInstanceSourceAction(locator, ghost.key, 'definition', writeText)
    : runInstanceSourceAction(locator, ghost.key, 'definition');
}

/** Keep the board subscribed only to modules that can contribute a 3D story.
 * The registry publishes declared modules first and its DOM/Dev tail at idle;
 * retaining equal module objects prevents that unrelated tail from rebuilding
 * every already-mounted exhibit. A real HMR refresh creates new module result
 * objects and therefore still rebuilds. */
function useThreeBoardModules(
  modules: readonly ProjectStoryModule[],
): readonly ProjectStoryModule[] {
  const regions = getProjectStoryRegions();
  const selected = modules.filter(
    (module_) =>
      module_.ok &&
      declaredStoryMedium({ modulePath: module_.modulePath, regions }).medium === 'three',
  );
  const retained = useRef<readonly ProjectStoryModule[]>([]);
  const previous = retained.current;
  if (
    previous.length !== selected.length ||
    previous.some((module_, index) => module_ !== selected[index])
  ) {
    retained.current = selected;
  }
  return retained.current;
}

function ThreeBoardContent({
  documentId,
  active,
  store,
}: WorkspaceDocumentContentProps & { readonly store: ThreeBoardStore }) {
  const modules = useSyncExternalStore(subscribeProjectStoryModules, getProjectStoryModules);
  const boardModules = useThreeBoardModules(modules);
  const [state, setState] = useState<BuildState>({ status: 'idle' });
  if (active) markViewportReactActive(documentId);

  // The board is a STANDING tab: its panel is present in every project from
  // boot, and the layout host mounts every panel's content
  // whether or not it is the active tab. So mounting is not the trigger —
  // FIRST ACTIVATION is. Building the board mounts every story off-screen, one
  // at a time, paying each story's loader latency (`board-scene.ts`), and a tab
  // nobody has looked at must cost nothing at boot.
  //
  // It latches: once shown, the board stays live across tab switches, so
  // flipping away does not throw the graph away and rebuild it on return.
  const [revealed, setRevealed] = useState(active);
  useEffect(() => {
    if (active) setRevealed(true);
  }, [active]);

  // Rebuild on reveal and when a THREE module changes; the previous scene's ONE
  // teardown runs here and nowhere else. A later idle publication of DOM/Dev
  // modules must not throw away and remount an already-usable 3D board.
  //
  // Both halves are SEQUENCED by `board-scene.ts`'s mount turn, which is what
  // makes "one mount at a time" true across builds and not merely within one:
  // a registry change mid-build aborts the in-flight build (it stops mounting
  // and frees what it has, inside its own turn) and the replacement build
  // queues behind it, so two builds can never interleave their mounts on the
  // process-global loader state a story's `.load()` may touch. Teardown of a
  // READY scene queues the same way, so its stories' effect cleanups cannot
  // land mid-way through the next build.
  useEffect(() => {
    if (!revealed) return;
    const controller = new AbortController();
    let built: ThreeBoardScene | null = null;
    setState({ status: 'building' });
    beginViewportBreakdown(documentId, { modulesAlreadyLoaded: boardModules.length > 0 });
    // The component index rides along so storyless `three` components get
    // their ghost slots — the Content gallery's own discovery
    // (`listProjectComponents`), never a second scan. An index failure
    // degrades to "no ghosts", not to a failed board.
    const indexStarted = Date.now();
    void listProjectComponents()
      .then((listing) => {
        const wall = Date.now() - indexStarted;
        markViewportSegment('component-index', wall, { busyMs: 0, waitMs: wall });
        // Still "no ghosts, not a failed board" — but SAID OUT LOUD. A failed
        // index and a project with no components produced the same silent
        // empty board, so a missing ghost slot looked like a design decision.
        if (!listing.ok) {
          editorConsole.warn(
            `Component index unavailable, so this board shows no ghost slots: ${listing.reason}`,
            'three-board',
          );
        }
        return buildThreeBoard(boardModules, listing.ok ? listing.entries : [], controller.signal);
      })
      .then(
        (scene) => {
          // A build can RESOLVE in the same microtask turn that unmount aborts
          // it: cleanup then saw `built === null` and disposed nothing, so a
          // success landing after abort must dispose its own scene or it leaks.
          if (controller.signal.aborted) {
            cancelViewportBreakdown(documentId);
            void disposeThreeBoard(scene);
            return;
          }
          built = scene;
          _scene = scene;
          notifyChanged();
          markViewportBoardReady();
          setState({ status: 'ready', scene });
        },
        (error: unknown) => {
          // A superseded build already freed itself in its own turn; the only
          // reportable failures are the ones this build is still current for.
          if (controller.signal.aborted) {
            cancelViewportBreakdown(documentId);
            return;
          }
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    return () => {
      controller.abort();
      if (built) {
        if (_scene === built) _scene = null;
        void disposeThreeBoard(built);
        notifyChanged();
      } else {
        cancelViewportBreakdown(documentId);
      }
    };
  }, [boardModules, revealed, documentId]);

  const scene = state.status === 'ready' ? state.scene : null;
  const build = useCallback(() => {
    if (!scene) throw new Error('The 3D board is still building.');
    return {
      root: scene.root,
      // Deliberately empty: this component owns the scene's lifetime (see the
      // module doc). Two disposers for one graph is how a double-free starts.
      dispose(): void {},
    };
  }, [scene]);

  // The viewport hands back the picked node's own `Object3D`; the story (or
  // ghost-slot component) identity is tagged on the wrapper above it
  // (`board-scene.ts`). Exhibits open their story document; ghost slots route
  // to the component's source and SAY what happened.
  const openPicked = useCallback(
    (object: THREE.Object3D) => {
      if (openExhibitStoryDocument(store, scene, object) !== null) return;
      const pending = openGhostComponentSource(scene, object);
      if (pending) void pending.then(showTransientHint);
    },
    [scene, store],
  );

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, pointerEvents: 'auto' }}>
      {scene ? (
        <>
          <Object3DDocumentViewport
            documentId={documentId}
            sourcePath="Generated from this project’s stories"
            displayName={THREE_COMPONENTS_TITLE}
            build={build}
            active={active}
            onOpenNode={openPicked}
            // Open on one readable exhibit, like a component editor; a shared
            // true-scale overview necessarily makes a ship tiny beside a 30m
            // lighthouse. Frame Selection follows the picked exhibit/node;
            // clearing selection and framing restores the presence-box union.
            // Helpers remain authored and visible at true scale in either view.
            cameraDirection={STANDARD_COMPONENT_CAMERA_DIRECTION}
            frameBounds={scene.frameBounds}
            openingFrameBounds={scene.openingFrameBounds}
            // Standard dressing plus the ground grid: exhibits stand on y=0
            // by design, so the board earns the one opt-IN the contract has.
            dressing={{ grid: true }}
          />
          <ThreeBoardLabels documentId={documentId} scene={scene} active={active} />
          <ThreeBoardStatus scene={scene} />
        </>
      ) : (
        <div
          data-testid="three-board-status"
          style={{ padding: 16, fontSize: 12, color: themeVars.content.muted }}
        >
          {state.status === 'error' && state.message}
          {state.status === 'building' &&
            threeBoardBuildingCopy(threeBoardCandidateCount(boardModules))}
          {state.status === 'idle' && 'Open this tab to lay out every story at true scale.'}
        </div>
      )}
    </div>
  );
}

/** Counts (exhibits, districts, storyless components) + the honest list of
 *  stories that produced no Object3D. Ghost slots and skips are DIFFERENT
 *  facts — a ghost is a component with no story, a skip is a story that
 *  mounted nothing 3D — and the footer states both, hiding neither. */
function ThreeBoardStatus({ scene }: { readonly scene: ThreeBoardScene }) {
  const [open, setOpen] = useState(false);
  const skips = summarizeBoardSkips(scene.skipped);
  const realDistricts = scene.districts.filter(
    (district) => district.groupKey !== BOARD_GHOST_GROUP_KEY,
  ).length;
  return (
    <div
      data-testid="three-board-status"
      style={{
        position: 'absolute',
        left: 8,
        bottom: 8,
        maxWidth: 420,
        padding: '4px 8px',
        borderRadius: themeVars.shape.small,
        background: themeVars.surface.raised,
        border: `1px solid ${themeVars.boundary.default}`,
        fontSize: 10,
        color: themeVars.content.muted,
        pointerEvents: 'auto',
      }}
    >
      {scene.exhibits.length} exhibit{scene.exhibits.length === 1 ? '' : 's'} · {realDistricts}{' '}
      district{realDistricts === 1 ? '' : 's'}
      {scene.helperVolumes.length > 0 && (
        <>
          {' · '}
          {scene.helperVolumes.length} helper volume
          {scene.helperVolumes.length === 1 ? '' : 's'} at true scale, outside the default frame
        </>
      )}
      {scene.ghostSlots.length > 0 && (
        <>
          {' · '}
          {scene.ghostSlots.length} component{scene.ghostSlots.length === 1 ? '' : 's'} without
          stories
        </>
      )}
      {scene.skipped.length > 0 && (
        <>
          {' · '}
          {/* Inline disclosure toggle — the role-annotated span is the
              guard-sanctioned shape for text-link chrome (a raw native
              button trips the product-chrome scan). */}
          <span
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                setOpen((value) => !value);
              }
            }}
            style={{
              cursor: 'pointer',
              color: themeVars.accent.default,
            }}
          >
            {skips.stories} {skips.stories === 1 ? 'story' : 'stories'} in {skips.modules}{' '}
            {skips.modules === 1 ? 'module' : 'modules'} not on this board
          </span>
        </>
      )}
      {open && (
        <div style={{ marginTop: 4, maxHeight: 160, overflow: 'auto' }}>
          {scene.skipped.map((entry) => (
            <div key={entry.id} style={{ padding: '1px 0' }}>
              <code style={{ color: themeVars.content.dim }}>
                {entry.modulePath}#{entry.storyName}
              </code>{' '}
              — {entry.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * District + exhibit labels, projected from the live document camera into HTML.
 * Chrome, not content: the generated graph never learns these exist.
 */
function ThreeBoardLabels({
  documentId,
  scene,
  active,
}: {
  readonly documentId: string;
  readonly scene: ThreeBoardScene;
  readonly active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<readonly ProjectedLabel[]>([]);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let cancelled = false;
    const anchors = labelAnchors(scene);
    const tick = () => {
      if (cancelled) return;
      frame = requestAnimationFrame(tick);
      const host = hostRef.current;
      const session = object3DDocumentSession(documentId);
      if (!host || !session) return;
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      setLabels(projectLabels(anchors, session.camera(), host.clientWidth, host.clientHeight));
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [active, documentId, scene]);

  return (
    <div
      ref={hostRef}
      data-testid="three-board-labels"
      // Matches the viewport host's own `inset: -12`, so projected NDC maps
      // onto the same rectangle the canvas covers.
      style={{ position: 'absolute', inset: -12, pointerEvents: 'none', overflow: 'hidden' }}
    >
      {labels.map((label) => (
        <div
          key={label.key}
          style={{
            position: 'absolute',
            left: label.x,
            top: label.y,
            transform: 'translate(-50%, -100%)',
            whiteSpace: 'nowrap',
            padding: label.district ? '2px 7px' : '1px 5px',
            borderRadius: themeVars.shape.small,
            background: themeVars.surface.raised,
            border: `1px ${label.ghost ? 'dashed' : 'solid'} ${
              label.district && !label.ghost ? themeVars.accent.default : themeVars.boundary.default
            }`,
            color:
              label.district && !label.ghost ? themeVars.content.primary : themeVars.content.muted,
            fontSize: label.district ? 12 : 10,
            fontWeight: label.district ? 600 : 400,
            opacity: label.ghost ? 0.9 : 1,
          }}
        >
          {label.text}
          <span style={{ marginLeft: 6, color: themeVars.content.dim, fontWeight: 400 }}>
            {label.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

/** One reused vector so a 200-exhibit board allocates nothing per frame. */
const scratch = new THREE.Vector3();

interface LabelAnchor {
  readonly key: string;
  readonly text: string;
  readonly detail: string;
  readonly district: boolean;
  readonly ghost: boolean;
  readonly point: readonly [number, number, number];
}

/** A placard's world anchor: the FRONT EDGE of the slot's own patch of floor,
 *  on the ground — where a floor placard sits, so a label reads as belonging to
 *  the thing standing behind it and never floats mid-air over one. */
function placardPoint(placement: {
  readonly anchor: readonly [number, number, number];
  readonly footprint: readonly [number, number];
}): readonly [number, number, number] {
  return [placement.anchor[0], 0, placement.anchor[2] - placement.footprint[1] / 2];
}

/** What the overlay prints and where each label is pinned in world space:
 *  a district's title on its pad's FRONT edge on the ground, an exhibit's (or
 *  ghost slot's) placard on its own slot's front edge, also on the ground. The
 *  exhibit detail is the TRUE height in metres — nothing on this board resizes
 *  or lifts an exhibit, and the placard is what says so. */
function labelAnchors(scene: ThreeBoardScene): LabelAnchor[] {
  return [
    ...scene.districts.map((district) => {
      const ghost = district.groupKey === BOARD_GHOST_GROUP_KEY;
      const count = district.placement.items.length;
      return {
        key: `district:${district.groupKey}`,
        text: district.label,
        detail: ghost
          ? `${count} component${count === 1 ? '' : 's'}`
          : `${count} exhibit${count === 1 ? '' : 's'}`,
        district: true,
        ghost,
        point: district.placement.anchor,
      };
    }),
    ...scene.exhibits.map((exhibit) => ({
      key: `exhibit:${exhibit.id}`,
      text: exhibit.label,
      detail: formatMetres(exhibit.placement.size[1]),
      district: false,
      ghost: false,
      point: placardPoint(exhibit.placement),
    })),
    ...scene.ghostSlots.map((slot) => ({
      key: `ghost:${slot.key}`,
      text: slot.name,
      detail: 'No story yet',
      district: false,
      ghost: true,
      point: placardPoint(slot.placement),
    })),
  ];
}

/** Project every anchor to pixels, dropping what is off the far plane and
 *  sorting far → near so nearer labels paint over further ones. */
function projectLabels(
  anchors: readonly LabelAnchor[],
  camera: THREE.Camera,
  width: number,
  height: number,
): ProjectedLabel[] {
  camera.updateMatrixWorld();
  const projected: ProjectedLabel[] = [];
  for (const anchor of anchors) {
    scratch.set(anchor.point[0], anchor.point[1], anchor.point[2]).project(camera);
    // `project` of a point behind the camera wraps around to a plausible
    // on-screen NDC; the far-plane test is what rejects it.
    if (scratch.z > 1) continue;
    projected.push({
      key: anchor.key,
      text: anchor.text,
      detail: anchor.detail,
      district: anchor.district,
      ghost: anchor.ghost,
      x: (scratch.x * 0.5 + 0.5) * width,
      y: (-scratch.y * 0.5 + 0.5) * height,
      depth: scratch.z,
    });
  }
  return cullOverlappingLabels(projected).sort((a, b) => b.depth - a.depth);
}

/** Approximate on-screen box of one label (the overlay's own font metrics:
 *  ~0.62 em average advance for the UI face, plus padding and the gap the
 *  detail suffix adds). Estimation is fine — the culling below only needs to
 *  agree with the DOM to within a few pixels. */
function labelRect(label: ProjectedLabel): readonly [number, number, number, number] {
  const fontSize = label.district ? 12 : 10;
  const textWidth = (label.text.length + label.detail.length) * fontSize * 0.62 + 24;
  const boxHeight = fontSize + 8;
  return [label.x - textWidth / 2, label.y - boxHeight, label.x + textWidth / 2, label.y];
}

/**
 * LABEL SANITY: at a wide framing, a dense row of placards projects into an
 * unreadable pile. Nearer (and district) labels win; a label whose box would
 * overlap an already-kept one is dropped for this frame — it reappears the
 * moment the camera gives it room. Nothing is abbreviated or nudged: a placard
 * either shows whole and anchored, or not at all.
 */
function cullOverlappingLabels(projected: readonly ProjectedLabel[]): ProjectedLabel[] {
  const byPriority = [...projected].sort(
    (a, b) => (b.district ? 1 : 0) - (a.district ? 1 : 0) || a.depth - b.depth,
  );
  const kept: { label: ProjectedLabel; rect: readonly [number, number, number, number] }[] = [];
  for (const label of byPriority) {
    const rect = labelRect(label);
    const collides = kept.some(
      (entry) =>
        rect[0] < entry.rect[2] &&
        rect[2] > entry.rect[0] &&
        rect[1] < entry.rect[3] &&
        rect[3] > entry.rect[1],
    );
    if (collides) continue;
    kept.push({ label, rect });
  }
  return kept.map((entry) => entry.label);
}

// --- Inspector: the picked exhibit's story identity -------------------------

function findExhibitIn(
  scene: ThreeBoardScene | null,
  object: THREE.Object3D | null,
): BoardExhibit | null {
  if (!scene) return null;
  const storyId = boardStoryIdForObject(object);
  if (!storyId) return null;
  return scene.exhibits.find((exhibit) => exhibit.id === storyId) ?? null;
}

function findGhostIn(
  scene: ThreeBoardScene | null,
  object: THREE.Object3D | null,
): BoardGhostSlot | null {
  if (!scene) return null;
  const componentKey = boardComponentKeyForObject(object);
  if (!componentKey) return null;
  return scene.ghostSlots.find((slot) => slot.key === componentKey) ?? null;
}

/**
 * Registered section: story identity for whatever is picked on the board.
 *
 * The subject is resolved from the shell's `nodeId` AND the adapter's own live
 * selection, because a pick in this document surface reaches the adapter's
 * selection first — reading only the shell's node id showed "pick an exhibit"
 * while the hierarchy already had the picked mesh highlighted.
 */
export function BoardExhibitSection({ adapter, nodeId }: InspectorSectionProps) {
  useSyncExternalStore(subscribeThreeBoard, threeBoardVersion);
  const candidateIds = [...(nodeId ? [nodeId] : []), ...(adapter.selection?.get() ?? [])];
  const exhibit = candidateIds.reduce<BoardExhibit | null>(
    (found, id) => found ?? findExhibitIn(_scene, threeObject(adapter.hierarchy, id)),
    null,
  );
  return (
    <div
      data-testid="inspector-exhibit"
      style={{
        pointerEvents: 'auto',
        padding: 8,
        borderBottom: `1px solid ${themeVars.boundary.default}`,
      }}
    >
      {/* No mini-label of its own: the projection heads this section with its
          title and icon (`components/InspectionProjection.tsx`). */}
      {!exhibit ? (
        <div style={{ fontSize: 11, color: themeVars.content.dim }}>
          Pick an exhibit to read its story.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 3, fontSize: 11 }}>
          <div style={{ color: themeVars.content.primary, fontWeight: 600 }}>{exhibit.label}</div>
          <IdentityRow label="Story" value={exhibit.storyName} />
          <IdentityRow label="Group" value={exhibit.groupPath} />
          <IdentityRow label="Module" value={exhibit.modulePath} />
          <IdentityRow
            label="Size"
            value={exhibit.placement.size.map((value) => formatMetres(value)).join(' × ')}
          />
        </div>
      )}
    </div>
  );
}

function IdentityRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <span style={{ width: 52, flexShrink: 0, color: themeVars.content.muted }}>{label}</span>
      <code
        style={{ color: themeVars.content.primary, overflow: 'hidden', textOverflow: 'ellipsis' }}
        title={value}
      >
        {value}
      </code>
    </div>
  );
}

const registrationGroup = createHmrRegistrationGroup(import.meta.hot, 'three-board-contributions');

/** Idempotent registration of the board's Inspector section. */
export function ensureThreeBoardContributionsRegistered(): void {
  registrationGroup.ensure((track) => {
    track(
      registerInspectorSections({
        match: () => activeWorkspaceDocument()?.descriptor.id === THREE_COMPONENTS_DOCUMENT_ID,
        // The FACET, not the surface that renders it (ARCHITECTURE-CORE
        // §Editor chrome, facet taxonomy): what you picked on the board is an
        // exhibit, and this block reads its story, group, module and size.
        id: 'exhibit',
        title: 'Exhibit',
        // The board's read-only "what am I looking at" block.
        icon: faCircleInfo,
        order: CONTRIBUTED_SECTION_ORDER,
        Section: BoardExhibitSection,
      }),
    );
  });
}

// --- Installation -----------------------------------------------------------

/** Capture the same true-scale composition without activating its document. */
const threeBoardPreview = {
  revision: () => JSON.stringify(getProjectStoryModules().map((module_) => module_.modulePath)),
  subscribe: subscribeProjectStoryModules,
  capture: async (
    request: import('@volter/editor-sdk/kit/document-preview-source').DocumentPreviewCaptureRequest,
  ) => {
    await whenProjectStoriesReady();
    const regions = getProjectStoryRegions();
    const modules = getProjectStoryModules().filter(
      (module_) =>
        module_.ok &&
        declaredStoryMedium({ modulePath: module_.modulePath, regions }).medium === 'three',
    );
    const listing = await listProjectComponents();
    const board = await buildThreeBoard(modules, listing.ok ? listing.entries : []);
    try {
      const { captureAuthoredThreeScenePreview } = await import('../../host/document-preview-three');
      const { createStandardEnvironment } = await import('@volter/editor-threejs/viewport/environment');
      const { applyStandardViewportDressing } = await import(
        '@volter/editor-threejs/kit/components/standard-viewport-dressing'
      );
      const { isEditorOwnedObject } = await import('@volter/editor-threejs/viewport/editor-layers');
      board.root.traverse((object) => {
        if (isEditorOwnedObject(object)) object.visible = false;
      });
      const scene = new THREE.Scene();
      scene.add(board.root);
      const bounds = new THREE.Box3(
        new THREE.Vector3(...board.frameBounds.min),
        new THREE.Vector3(...board.frameBounds.max),
      );
      const target = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
      const radius = bounds.isEmpty()
        ? 1
        : Math.max(0.01, bounds.getBoundingSphere(new THREE.Sphere()).radius);
      const distance = (radius / Math.sin(THREE.MathUtils.degToRad(42 / 2))) * 1.15;
      const position = target
        .clone()
        .addScaledVector(new THREE.Vector3(1, 0.75, 1).normalize(), distance);
      // A board's framing authority is its complete layout, never a camera
      // inside one exhibit (which would photograph only that prefab).
      const framing = { ...request, camera: { position, target, fov: 42 } };
      return captureAuthoredThreeScenePreview(board.root, scene, framing, (renderer) => {
        const dressing = applyStandardViewportDressing(scene, {
          environment: createStandardEnvironment(renderer),
          background: false,
        });
        return () => dressing.dispose();
      });
    } finally {
      await disposeThreeBoard(board);
    }
  },
};

/** Register the project's 3D component canvas for Content and session restore.
 * Its renderer mounts only when the user opens its document tab. */
export function installThreeBoardDocument(store: ThreeBoardStore): string {
  ensureThreeBoardContributionsRegistered();
  return registerAvailableWorkspaceDocument(
    {
      id: THREE_COMPONENTS_DOCUMENT_ID,
      title: THREE_COMPONENTS_TITLE,
      // A generated browse-over-the-project's-content view, not an authored
      // subject: it is regenerated from the story registry, never persisted.
      kind: 'content-browser',
      workspaceRole: 'workspace-reference',
      Content: (props) => <ThreeBoardContent {...props} store={store} />,
      readOnly: true,
      preview: threeBoardPreview,
      presentation: () => ({ kind: 'workspace', id: THREE_COMPONENTS_DOCUMENT_ID }),
    },
    { category: 'canvas' },
  );
}
