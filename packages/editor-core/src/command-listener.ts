import { commandLine } from '@volter/editor-sdk/kit/product-command';
import { isGameplayExportActive } from './gameplay-export-state';

/**
 * Command listener — receives commands from the editor server via SSE
 * and dispatches them to the EditorShellStore and play-mode functions.
 *
 * The server broadcasts `editor-command` events sent by the SDK/CLI.
 * This module translates them into store method calls.
 */

import type {
  CaptureDimensions,
  DocumentProbeStep,
  EditorView,
  InspectedHierarchy,
  InspectedInspection,
  InspectedWriteDestination,
  HelperVisibility as SdkHelperVisibility,
} from '@volter/editor-sdk';
import { inspectorPreviewRendererCounts } from '@volter/editor-threejs/viewport/preview-renderer';
import { liveHostRendererCount } from '@volter/editor-threejs/viewport/renderer-ownership';
import type { ViewportShadingMode } from '@volter/editor-threejs/render/viewport-shading';
import { captureEntityComparePreview, captureModelComparePreview } from './asset-compare';
import { parseForwardVector } from './asset-compare-core';
import {
  type AssetPreviewBackground,
  captureGlbBytesAssetPreview,
  captureModelAssetPreview,
  captureObjectAssetPreview,
  captureSceneStageAssetPreview,
  captureShotSetAssetPreview,
  captureShotSetGlbBytesPreview,
  captureShotSetModelPreview,
  captureSourceReviewShotSetAssetPreview,
  captureSourceReviewShotSetModelPreview,
  parseShotSetDefinition,
} from './asset-preview';
import { type AssetKind, setSelectedAsset } from './asset-selection';
import { assetCapabilities, assetDocumentKind } from '@volter/editor-sdk/kit/asset-capabilities';
import { systemsForInstance } from './authoring/active-systems';
import { getMountFailureReports } from '@volter/editor-sdk/kit/mount-failure-report';
import { object3DDocumentSession } from './authoring/object3d-document-session-registry';
import {
  activeDocumentAuthoring,
  activeHierarchyRows,
  activeSaveDestination,
  activeSaveState,
  activeSelectionCreationSite,
  activeSelectionIds,
  activeSelectionWriteAnchorKind,
} from './authoring/shell-document-ops';
import { parseCameraChoice, parsePoseChoice } from './capture-camera-pose';
import { noteCommandDispatched } from './command-dispatch';
import { resolveContributedCommand, contributedCommandDerivedRefresh } from './command-registry';
import {
  isAssetDocumentId,
  openAssetDocument,
  waitForAssetDocumentInspector,
} from './components/asset-documents';
import { openSceneTableEntryWhenListed } from './components/scene-documents';
import { systemAdapterEpoch } from '@volter/editor-sdk/kit/system-seam-evidence';
import {
  connectEvents,
  reportCommandListener,
  reportCommandReceived,
  reportCommandResult,
  reportEditorState,
  reportPlayBootPhase,
} from './editor-api';
import { captureEditorChrome } from './editor-chrome-capture';
import type { ConsoleEntry } from '@volter/editor-sdk/kit/editor-console';
import { editorConsole } from '@volter/editor-sdk/kit/editor-console';
import { currentEditorView } from './editor-current-view';
import { editorIsPlaying } from '@volter/editor-sdk/kit/editor-session-mode';
import type { EditorShellStore, HelperVisibility } from './editor-shell-store';
import { collectEditorStateFacets, reusableFacetKeys } from '@volter/editor-sdk/kit/editor-state-facets';
import { entityObject3D } from './entity-object';
import {
  hierarchyPanelSnapshot,
  nextHierarchyPanelSnapshot,
  serializeHierarchyPanel,
} from './hierarchy-panel-view';
import type { HistoryCommands } from './history/history-commands';
import {
  anyLiveSessionMounted,
  anyLiveSessionPlaying,
  dispatchLiveCommand,
  liveRunWindow,
  liveScenes,
  remountLiveSelection,
  subscribeLiveSessions,
} from '@volter/editor-sdk/kit/live-session-registry';
import { setPlayBootPhaseReporter } from './play-boot-phase';
import { projectAdapterFacet, subscribeProjectAdapter } from './project-adapter';
import { getProjectModuleSplitReports } from '@volter/editor-sdk/kit/project-module-split';
import { onSessionEndedChange, sessionEndedRefusal, sessionEndedState } from './session-tombstone';
import { prepareSessionClose } from './session-close';
import { focusedStageStore } from './stage-context';
import { scheduleDeferredFullReport } from './state-report-deferral';
import { interactiveViewportRendererCounts } from './three-viewport/interactive-renderer';
import {
  subscribeViewportActivationTimings,
  viewportActivationTimings,
} from '@volter/editor-sdk/kit/viewport-activation-timings';

type AssertSameKeys<P, Q> = [keyof P] extends [keyof Q]
  ? [keyof Q] extends [keyof P]
    ? true
    : false
  : false;
type RequireTrue<T extends true> = T;
/**
 * Compile-time drift guard (W3a N1) — its consumer is `tsc` itself. The SDK
 * republishes `HelperVisibility` for control-API clients, and the
 * `{ ...store.helperVisibility }` spread in `collectState` below typechecks
 * happily even when the SDK mirror is MISSING keys (spreads skip excess
 * property checks) — exactly how `joints`/`lod` drifted out of the SDK
 * pre-W3a. This alias fails `npm run typecheck` the moment either side gains
 * a key the other lacks.
 */
export type HelperVisibilityMirrorInSync = RequireTrue<
  AssertSameKeys<HelperVisibility, SdkHelperVisibility>
>;

import {
  type CommandResult,
  isRelayCommandType,
  type RelayCommandDerivedRefresh,
  type RelayCommandType,
  relayCommandDerivedRefresh,
} from '@volter/editor-sdk/session/command-table';
import { editorMaterials, isEditorMaterialId } from '@volter/editor-sdk/widgets';
import {
  copyAuthoringNodes,
  createAuthoringNode,
  cutAuthoringNodes,
  duplicateAuthoringNode,
  duplicateManyAuthoringNodes,
  groupAuthoringNodes,
  pasteAuthoringNodes,
  removeAuthoringNode,
  removeManyAuthoringNodes,
  reorderAuthoringNode,
  reparentAuthoringNode,
  ungroupAuthoringNode,
  unwrapAuthoringNode,
  wrapAuthoringNode,
} from './authoring/consumer-actions';
import { resolvePanelAuthoring } from './authoring/panel-authoring';
import { ontologyInvariantFacet } from './coverage/session-vitals';
import { documentContextFor, waitForDocumentContext } from './document-context-registry';
import { executeCommand, openCommandPalette } from './editor-commands';
import { runDocumentProbe } from './editor-document-probe';
import {
  captureActiveEditorDocument,
  presentEditorView,
  revealStaticPanel,
} from './editor-view-presentation';
import { toolGameplaySessions } from './gameplay-sessions';
import {
  InspectionRemovalUnavailableError,
  inspectActiveSubject,
  removeActiveInspectionField,
  runActiveInspectionAction,
  setActiveInspectionField,
} from './inspection/active-subject';
import { measuredReadinessWarning, readinessFacet } from '@volter/editor-sdk/kit/readiness';
import { deriveReportedPlayState } from './reported-play-state';
import { openLiveSceneEntry } from './scene-live-open';
import { editorMaterialSnapshot, setEditorMaterialPreference } from './theme-preference';
import { GAME_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activateWorkspaceDocument,
  activeWorkspaceDocumentId,
  closeWorkspaceDocument,
  openWorkspaceDocuments,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { availableWorkspaceDocuments } from './workspace-available-documents';
import { activeWorkspaceUtility } from './workspace-host-commands';
import {
  activeEditorWorkspace,
  editorWorkspaceIds,
  isEditorWorkspaceId,
  setEditorWorkspace,
  whenEditorWorkspaceApplied,
} from './workspace-presets';
import { activeWorkspaceStyleId, applyWorkspaceStyle, workspaceStyles } from './workspace-style';
import { documentContributionForKind } from './tool-loader';
import { toggleConsoleUtility } from './workspace-utility-commands';
import { worldAdoptionFacet } from './world-adoption';

export interface EditorCommand {
  type: string;
  _requestId?: string;
  [key: string]: unknown;
}

/** Browser-listener scheduling seam. The live relay holds presentation until
 * its acknowledgement settles; direct callers fall back to the next task. */
export interface CommandHandlingOptions {
  deferPresentation?: ((present: () => void) => void) | undefined;
  /** The session's own undo/redo queue — see {@link connectCommandListener}'s
   *  `history` parameter for why the verbs go through it rather than through
   *  `store.projectHistory` directly. */
  history?: HistoryCommands | undefined;
}

const REPEATED_DEBUG_READS = new Set([
  'state',
  'stateAll',
  'providers',
  'commands',
  'events',
  'snapshot',
]);

/**
 * The coverage proof a read-only debug call can add to the current adapter epoch.
 *
 * The first successful read still earns a full status derivation so coverage immediately reflects
 * the operation. Repeating that same proof cannot change any derived facet: forcing another full
 * 4,000-node hierarchy/coverage walk on every `waitSimTime` clock poll only stalls the game being
 * measured. A provider name is part of a `state` proof because each declared provider is graded
 * independently; adapter epoch keeps a remount's first read from reusing the retired mount's proof.
 */
function repeatedDebugReadProofKeys(command: EditorCommand): readonly string[] {
  if (command['type'] !== 'bridge-call') return [];
  const method = command['method'];
  if (typeof method !== 'string' || !REPEATED_DEBUG_READS.has(method)) return [];
  const instance = command['instance'] as string | undefined;
  try {
    const debug = systemsForInstance(instance).debug;
    if (debug === undefined) return [];
    const prefix = [systemAdapterEpoch(debug), instance ?? ''].join(':');
    const key = (member: string, provider = '') => [prefix, member, provider].join(':');
    if (method === 'snapshot') {
      // `snapshot` dispatches these three reads in one batch; the next lightweight `state(time)`
      // poll is therefore already the same current-epoch proof, not a second first use.
      return [key('snapshot'), key('state', 'time'), key('stateAll'), key('events')];
    }
    const provider = method === 'state' ? String((command['callArgs'] as unknown[])?.[0]) : '';
    return [key(method, provider)];
  } catch {
    // An unresolved instance is a real command failure. Keep the conservative full refresh so its
    // status/error facets cannot be hidden behind the optimization for successful repeated reads.
    return [];
  }
}

interface CompletedCommandRefresh {
  readonly derived: RelayCommandDerivedRefresh;
  /** A successful, explicit game read or command may have changed the mounted
   *  scene. During Play it earns one settled full report; ordinary input,
   *  presence and repeated reads do not. */
  readonly playFullReport: 'none' | 'explicit' | 'if-content-changed';
}

function completedCommandDerivedRefresh(
  command: EditorCommand,
  succeeded: boolean,
  reportedProofs: Set<string>,
): CompletedCommandRefresh {
  const proofKeys = repeatedDebugReadProofKeys(command);
  const repeated =
    succeeded && proofKeys.length > 0 && proofKeys.every((key) => reportedProofs.has(key));
  if (succeeded) {
    for (const key of proofKeys) reportedProofs.add(key);
  }
  return {
    derived: repeated
      ? 'none'
      : succeeded && proofKeys.length > 0
        ? 'always'
        : (contributedCommandDerivedRefresh(command['type']) ??
          relayCommandDerivedRefresh(command['type'])),
    playFullReport:
      succeeded && !repeated && proofKeys.length > 0
        ? 'explicit'
        : succeeded && command['type'] === 'bridge-call' && command['method'] === 'invoke'
          ? 'if-content-changed'
          : 'none',
  };
}

function playCommandOwesDerivedRefresh(
  derivedRefresh: RelayCommandDerivedRefresh,
  playFullReport: CompletedCommandRefresh['playFullReport'],
  contentVersion: number,
  lastFullContentVersion: number,
): boolean {
  if (derivedRefresh === 'none') return false;
  return !(
    derivedRefresh === 'if-content-changed' &&
    playFullReport === 'none' &&
    contentVersion === lastFullContentVersion
  );
}

/**
 * The refusal for `editor.select(id)` on an id no authoring surface owns, or
 * `null` when the id resolves.
 *
 * The resolvers are the ones a selection's own CONSUMERS use, and both of them,
 * for the reason `entity-object.ts` records: the active adapter's
 * `hierarchy.node` (what the hierarchy panel and the inspector resolve against)
 * and `entityObject3D` (what the gizmo and the selection brackets resolve
 * against). Neither is a superset of the other, so checking only one would
 * refuse ids the editor can genuinely select.
 *
 * It used to consult neither: `editor.select('Player')` wrote the string
 * straight into the store's selection set, and the inspector then composed a
 * SUBJECT for it (measured 2026-08-14 on the translated platformer: `id:
 * "Player"`, a blank title and an `R3F source` kind label for an entity that has
 * never existed; through a composite the same id reached `children[0]` and drew
 * a full transform section reading all zeros). A selection is a claim about an
 * entity, so an id nothing owns is refused by name here rather than fabricated
 * downstream.
 */
function unresolvedSelectionRefusal(store: EditorShellStore, id: string): string | null {
  // Resolve through the same document-scoped binding as Hierarchy and
  // Inspector. Asset Lab documents publish their own adapter while the scene
  // adapter remains globally active; asking the latter would reject the exact
  // ids editor.hierarchy() just reported for the open asset/story.
  const adapter = activeDocumentAuthoring(store);
  if (adapter.hierarchy.node(id) !== null) return null;
  if (entityObject3D(adapter, store.objectMap, id) !== null) return null;
  return (
    `select: no entity with id "${id}" — neither the active authoring adapter's ` +
    `hierarchy nor the live object index owns it, so there is nothing to select. ` +
    `Read the ids that exist with editor.hierarchy() (the rows the panel is ` +
    `rendering) or editor.status().entities.`
  );
}

function applyControlSelection(
  store: EditorShellStore,
  ids: readonly string[],
  options: CommandHandlingOptions | undefined,
): void {
  // Object3D documents own selection outside the scene store. This is also
  // the route used by human hierarchy clicks and present-view, and is what
  // lets semantic Asset Lab subjects (bones, physics bodies, joints) update
  // their native highlight and Inspector state.
  const documentSession = activeObject3DDocumentSession();
  if (documentSession) {
    documentSession.select(ids);
    return;
  }
  const present = store.applySelectionBeforePresentation(ids);
  if (options?.deferPresentation) options.deferPresentation(present);
  else setTimeout(present, 0);
}

/** Live viewport camera pose of the FOCUSED stage — undefined when nothing has
 *  bound a camera yet (see `EditorShellStore.cameraPose`'s doc comment).
 *  A camera is a per-stage fact, so the reader follows focus the way the
 *  panels do (`focusedStageStore`, ARCHITECTURE-CORE §One stage unit 4):
 *  before this, `vgai status` reported the world's camera while the person
 *  was looking through a model document's. */
function collectCamera(store: EditorShellStore):
  | {
      position: { x: number; y: number; z: number };
      target: { x: number; y: number; z: number };
      fov: number;
    }
  | undefined {
  const pose = focusedStageStore(store).cameraPose;
  if (!pose) return undefined;
  return {
    position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    target: { x: pose.target.x, y: pose.target.y, z: pose.target.z },
    fov: pose.fov,
  };
}

/** #145 — what the human's tab is actually showing right now: page
 *  visibility + window focus. `null` outside a real browser (the relay's
 *  node-side tests). The agent reads this to know whether the user is
 *  LOOKING at the shared session before deciding how to narrate/verify;
 *  `connectCommandListener` re-reports state on visibilitychange/focus/blur
 *  so the server's `/__editor/state` snapshot stays current between
 *  commands.
 *
 *  P21 — `reportedAt` is stamped HERE, at read time, and it is the field that
 *  makes the other two honest. A CLI banner that says "the tab is hidden" is
 *  reading a snapshot with no age on it; the owner was told that repeatedly
 *  while looking straight at the foregrounded tab. With an age attached, the
 *  reader can see the difference between a reading taken 40ms ago and one
 *  taken 40 seconds ago, and no downstream surface has to invent a story to
 *  fill the gap. */
function collectPresence(): {
  visibility: DocumentVisibilityState;
  focused: boolean;
  reportedAt: number;
} | null {
  if (typeof document === 'undefined') return null;
  return {
    visibility: document.visibilityState,
    focused: document.hasFocus(),
    reportedAt: Date.now(),
  };
}

/**
 * The facets `collectState` will REUSE from a previous snapshot when it is
 * given one — the hierarchy walk and the capability GRADING families. They are
 * the whole measured cost of a collect (see `state-report-deferral.ts`), and
 * none of them can change without a mount or an edit, which the deferred full
 * collect that always follows a reusing one picks up.
 *
 * Everything NOT named here is derived fresh on every single report, including
 * the fields a reader needs the instant they change: play state, loop
 * liveness, selection, active document, save state, presence, and every error
 * and warning channel.
 *
 * THE HOST'S HALF ONLY. The four capability-GRADING families
 * (`rootCoverage`, `systemCoverage`, `projectCoverage`, `authoringCoverage`)
 * used to be listed here; they are `@vgai/game`'s now
 * (`contributions/coverage.service.ts`) and declare their own reusable keys
 * on `session.reportFacet`, which {@link reusableFacetKeys} reads back. Both
 * blockers P5b measured against that move are gone: the facet registry
 * carries reusable key names and hands the collect its `reuse` snapshot, and
 * the vitals' union call is now a subscription to the SAME five-second sample
 * (`coverage/session-vitals.ts`'s `onSessionSample`) rather than a second
 * timer. What is left in the host is the question the grade was asked ABOUT —
 * `authoring/mounted-root-subjects.ts` — which was never a grade.
 */
export const REUSABLE_DERIVED_FACETS = ['entities', 'entityCount', 'ontologyInvariants'] as const;

/** The immediate interaction report is a PATCH over the last full state. The
 * server already owns that full snapshot; resending these unchanged,
 * tree-scale facets on every runtime structure/store notification turns a
 * large Play world into megabytes of duplicate control traffic per frame.
 *
 * A contributed facet's own reusable keys are stripped the same way — read
 * live, because a contribution pass adds and removes facets while the session
 * runs. */
function currentStatePatch(state: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...state };
  for (const facet of REUSABLE_DERIVED_FACETS) delete patch[facet];
  for (const facet of reusableFacetKeys()) delete patch[facet];
  return { ...patch, _statePatch: true };
}

export function collectState(
  store: EditorShellStore,
  /**
   * A previous full snapshot whose {@link REUSABLE_DERIVED_FACETS} this collect
   * may copy instead of re-deriving, or `null`/omitted for a full collect.
   *
   * This is the interaction path's escape from a 76ms-to-1.3s synchronous
   * derivation on every store notification. It is deliberately a caller's
   * choice rather than an internal cache: only the caller knows whether it is
   * on a user's critical path, and only the caller can promise the deferred
   * full collect that makes the reused halves current again.
   */
  reuse: Record<string, unknown> | null = null,
): Record<string, unknown> {
  // S-1 (the SimCity ledger's false-alive ingest status): `store.playState` is
  // editor UI STATE — ingest and module mode both write 'playing' into it
  // without ever owning the `play-mode.ts` session the whole debug seam gates
  // on, and ingest writes it BEFORE its mount is even attempted. Reporting it
  // verbatim is how a session printed `playState: "playing"` in the same breath
  // as `game.state()` refusing with "not in play mode", and how a mount that
  // threw still reported itself alive. Derive it from what is actually running.
  const mountFailures = getMountFailureReports();
  const activeDocumentId = activeWorkspaceDocumentId();
  const documentPresentation = activeDocumentId
    ? object3DDocumentSession(activeDocumentId)?.presentation()
    : undefined;
  const selectedIds = activeSelectionIds(store);
  const gameplaySessions = toolGameplaySessions.getSnapshot();
  // ONE walk, read by both `entityCount` and `entities` below. It used to be
  // called once for each, and the walk is the expensive half of this whole
  // function (23ms of a 76ms collect at 251 nodes, measured 2026-08-19) — two
  // identical breadth-first traversals of the same tree in the same tick.
  const hierarchyRows =
    (reuse?.['entities'] as ReturnType<typeof activeHierarchyRows> | undefined) ??
    activeHierarchyRows(store);
  return {
    playState: deriveReportedPlayState({
      storePlayState: store.playState,
      liveMounted: anyLiveSessionMounted(),
      livePlaying: anyLiveSessionPlaying(),
      mountFailures,
    }),
    // Every world whose mount FAILED, with the error that killed it. `[]` on a
    // healthy session; non-empty with `ingest: null` is what a dead game looks
    // like from the control API, instead of a silent "playing". (`ingest` and
    // `ingestCaptureWait` are the ingest lane's own facets, registered by it.)
    mountFailures: mountFailures.map((r) => ({ ...r })),
    // PD-3 — every project module that was evaluated more than once during
    // the current mount, i.e. every module whose module-level state the roots
    // no longer share. `[]` on a healthy mount. A split does not fail the
    // mount (both copies run), so this is the ONLY machine-readable signal
    // that it happened at all.
    moduleSplits: getProjectModuleSplitReports().map((s) => ({ path: s.path, urls: [...s.urls] })),
    // The project's own ADAPTER, resolved (project-adapter.ts): which module
    // supplied the binding table (`vgai.adapter.ts`, or the declared native
    // default), the regions derived for it, and its scene table. `null` means
    // NOBODY HAS LOOKED YET — deliberately distinct from a loaded adapter with
    // an empty table, which is a real (and gradable) answer.
    adapter: projectAdapterFacet(),
    // DECLARED READINESS, per root (`readiness.ts`). One row per mounted root
    // saying WHO answers "is this ready" — the host's own completed mount, the
    // game's `window.vgaiGame.ready`, or a host-side measured wait. `[]` means
    // nothing has mounted, which is not "nothing is ready".
    readiness: readinessFacet().map((entry) => ({ ...entry })),
    // The ONE sentence for a project whose readiness is entirely measured. It
    // is the visibility half of the declared-vs-measured rule: an undeclared
    // game still works, it just stops being silent about it. `null` when
    // nothing is mounted or at least one root declared.
    readinessWarning: measuredReadinessWarning(),
    // WHICH WORLD the capture adopted for a self-booting root and how
    // (`declared` from the game's contract, or the trap's measured
    // first-non-host-render), plus every DISTINCT world that rendered
    // afterwards. The adoption itself is unchanged; this is the reader that
    // used to not exist for a permanent, silent choice.
    worldAdoption: worldAdoptionFacet().map((entry) => ({ ...entry })),
    presence: collectPresence(),
    // Target-blaster friction #3 (#146 ledger): the play-verify loop's error
    // channel — the same current-run-fenced uncaught-error list the relay
    // snapshot carries (see collectPlayRunPageErrors), so `vgai status` answers
    // "did anything go wrong since play started" without a second command.
    // [] while stopped or when nothing threw.
    pageErrors: collectPlayRunPageErrors(),
    // The OTHER half of the same question, and the half that was missing: an
    // otherwise-HEALTHY run that logged errors. `pageErrors` above is the
    // 'runtime' slice (uncaught error/unhandledrejection) and is rendered only
    // by the play-FAILED path, so a game that threw five `console.error`s
    // during a fine-looking play run said nothing to any CLI reader — the same
    // "already in the JSON and invisible in practice" failure PD-13 describes.
    // Disjoint from `pageErrors` by construction (see collectConsoleErrors), so
    // the two counts sum.
    consoleErrors: collectConsoleErrors(),
    // The SESSION-lifetime half — everything the two play-fenced facets above
    // do not claim, which before `installEditorConsoleCapture()` was
    // everything an editor frame logged while play was stopped and reached no
    // reader at all (see `collectSessionErrors`). Disjoint from both by
    // construction, so all three counts sum.
    sessionErrors: collectSessionErrors(),
    // Warnings had NO CLI-facing facet whatsoever until this one.
    sessionWarnings: collectSessionWarnings(),
    // GPU ownership is measured independently from DOM canvas attachment.
    // These live counters make context-budget regressions observable without
    // waiting for the browser to evict the oldest viewport.
    rendererResources: {
      hostLive: liveHostRendererCount(),
      interactive: interactiveViewportRendererCounts(),
      inspectorPreview: inspectorPreviewRendererCounts(),
    },
    // The ontology's LIVE invariants, re-derived on read. Every row is present
    // every time — including the ones this session cannot measure, which say so
    // rather than vanishing (`coverage/ontology-invariants.ts`).
    ontologyInvariants:
      reuse?.['ontologyInvariants'] ?? ontologyInvariantFacet().map((row) => ({ ...row })),
    // What only a running lane knows — its loop's time scale and liveness,
    // its seed, a pending restart, and the four capability-GRADING families
    // (`editor-state-facets.ts`). `reuse` rides through: a facet that declared
    // reusable keys serves them from the snapshot instead of re-deriving.
    ...collectEditorStateFacets(reuse),
    selectedEntityId: selectedIds[0] ?? null,
    selectedEntityIds: selectedIds,
    // The machine door onto the creation-site index: the source
    // location that constructed the SELECTED object, or the named reason there
    // isn't one. `null` only when nothing is selected or the active adapter
    // indexes no creation sites.
    selectedCreationSite: activeSelectionCreationSite(store),
    // The WRITE-side half of the same answer: which lane an edit to the
    // selection would take (`WriteAnchorKind`). A sweep needs it to find one
    // representative subject per lane — the anchor above cannot distinguish a
    // JSX prop from a construction literal, nor either from a body-placed
    // spawn, and those have different correctness contracts.
    selectedWriteAnchorKind: activeSelectionWriteAnchorKind(store),
    activeViewportTab: store.activeViewportTab,
    activeDocumentId,
    activeUtilityId: activeWorkspaceUtility(),
    gameplaySession: {
      selectedSessionId: gameplaySessions.selectedSessionId,
      latestSessionId: gameplaySessions.sessions[0]?.id ?? null,
      selectedStatus: gameplaySessions.selectedSession?.status ?? null,
      cursorMs: gameplaySessions.cursorMs,
      liveEdgeMs: gameplaySessions.liveEdgeMs,
    },
    // The registry is the authority for which center subjects EXIST. Doctor
    // uses this to photograph the project's actual component boards instead
    // of spending long activation windows guessing every medium-specific id.
    openDocumentIds: openWorkspaceDocuments().map((document) => document.descriptor.id),
    availableDocuments: availableWorkspaceDocuments().map((entry) => ({
      id: entry.descriptor.id,
      category: entry.category,
      default: entry.default,
    })),
    // W2: asset viewers are center workspace documents now; this facet keeps
    // its legacy key vocabulary for control-API consumers — the active ASSET
    // document's key, or the '__inspector__' sentinel. The sentinel does NOT
    // imply a visible Inspector: that surface is selection-owned.
    activeTabKey: (() => {
      const activeId = activeWorkspaceDocumentId();
      return activeId && isAssetDocumentId(activeId) ? activeId : '__inspector__';
    })(),
    showGrid: documentPresentation?.grid ?? store.showGrid,
    // Per-STAGE view options, reported for the stage the person is looking at
    // — the same store the `set-helpers`/`set-stats` verbs write and the
    // focused stage's own viewport reads (ARCHITECTURE-CORE §One stage unit 4).
    showHelpers: focusedStageStore(store).showHelpers,
    showStats: focusedStageStore(store).showStats,
    shadingMode: documentPresentation?.mode ?? store.shadingMode,
    helperVisibility: {
      ...focusedStageStore(store).helperVisibility,
      ...(documentPresentation
        ? {
            bounds: documentPresentation.bounds,
            skeletons: documentPresentation.skeleton,
          }
        : {}),
    },
    // THE ARMED TOOL IS THE ACTIVE DOCUMENT'S STAGE'S, the same door
    // `showHelpers`/`showStats` above already read. Every stage owns an
    // `EditorShellStore` (`stage-store-registry.ts`) and the shelf's four
    // tools write the one the person is looking at; reading the SHELL's here
    // reported `combined` for every tool on any document with a stage of its
    // own — measured on the Model document at WALK 5 row 4b, where the shelf
    // was lit on Select Box and this line said `combined`. The world root's
    // stage runs on the shell store itself, so the Scene document's answer is
    // unchanged.
    transformMode: focusedStageStore(store).transformMode,
    transformSpace: store.transformSpace,
    snapEnabled: store.snapEnabled,
    entityCount: hierarchyRows.length,
    // Persistence truth comes from the ACTIVE adapter's PersistenceProvider —
    // never a per-format store field.
    savePath: activeSaveDestination(store),
    // SDK clients need the same persistence truth the editor UI exposes.
    saveState: activeSaveState(store),
    // Camera facet (B3-followup): real pose when a viewport is bound, absent
    // otherwise — never a fabricated value (see EditorShellStore.cameraPose).
    camera: collectCamera(store),
    // Hierarchy facet (B3-followup): the real node tree, flattened to
    // id/name/childIds rows (same shape editor.hierarchy.inspect declares),
    // read from the ACTIVE authoring adapter.
    entities: hierarchyRows,
    // Design-surface first-frame stamps. Doctor `--timings` subtracts these
    // from its `active-tab` ack so a tab flip is a measured wait, not a
    // blank canvas with no number.
    viewportActivationTimings: viewportActivationTimings(),
  };
}

/**
 * The answer a caller gets when a command HANDLER threw instead of returning.
 *
 * Two things must happen and neither used to: the caller is told what killed
 * its command (rather than timing out against a message about the tab), and
 * the failure is logged so it reaches `editorConsole` — which is what
 * `collectSessionErrors` reads, and therefore what `vgai status` prints. The
 * browser's own `unhandledrejection` path did the second job only for the
 * FIRST occurrence, because the console capture dedupes an identical message.
 */
export function commandThrewResult(cmd: EditorCommand, error: unknown): CommandResult {
  const message = error instanceof Error ? error.message : String(error);
  const text = `editor command "${String(cmd['type'])}" threw: ${message}`;
  // biome-ignore lint/suspicious/noConsole: this IS the loud leg — editorConsole is fed by the console, and it is what `vgai status` prints.
  console.error(text, error);
  return { ok: false, error: text };
}

/**
 * The dimensions a capture verb was asked for, or the refusal that names the
 * value it was handed.
 *
 * SQUARE IS THE DEFAULT and `size` is how you ask for one. `width`+`height`
 * together ask for a SHAPED frame — a video-aspect look that needs no crop
 * afterwards — and are bounded per side and in TOTAL by the same relay budget
 * the square ceiling comes from. Mixing the two forms is refused rather than
 * silently resolved: a caller who sent both does not know which one they meant.
 *
 * `cmd` is WIRE INPUT — a JSON object from another process — so `cmd['size']`
 * had never been anything but a cast (`as number | undefined`). A caller that
 * sent a non-number got that value multiplied by 2 deep inside
 * `_renderViewportImage` and `createImageData(NaN, NaN)` threw
 * `TypeError: Value is not of type 'long'` from the middle of the render path;
 * because the dispatcher's `.then()` had no rejection leg, the throw answered
 * nobody and the caller waited out its whole budget for
 * "the tab is present … and did not respond" — a message about the TAB for a
 * defect in the argument. Measured on a racing-game ingest mount, 2026-08-15.
 */
export function captureSizeFromCommand(
  cmd: EditorCommand,
): { size?: CaptureDimensions } | { error: string } {
  const raw = cmd['size'];
  const rawWidth = cmd['width'];
  const rawHeight = cmd['height'];
  const shaped = rawWidth !== undefined || rawHeight !== undefined;
  if (shaped) {
    if (raw !== undefined && raw !== null) {
      return {
        error:
          `${String(cmd['type'])}: pass "size" (a square) OR "width"+"height" (a shaped frame), ` +
          'never both.',
      };
    }
    const dimension = (name: string, value: unknown): number | string => {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return (
          `${String(cmd['type'])}: "${name}" must be a whole number — got ` +
          `${typeof value} ${JSON.stringify(value) ?? String(value)}.`
        );
      }
      if (value < MIN_CAPTURE_DIMENSION || value > MAX_CAPTURE_DIMENSION) {
        return `${String(cmd['type'])}: "${name}" must be ${MIN_CAPTURE_DIMENSION}-${MAX_CAPTURE_DIMENSION} — ${CAPTURE_BUDGET_REASON}`;
      }
      return value;
    };
    const width = dimension('width', rawWidth);
    if (typeof width === 'string') return { error: width };
    const height = dimension('height', rawHeight);
    if (typeof height === 'string') return { error: height };
    if (width * height > MAX_CAPTURE_DIMENSION * MAX_CAPTURE_DIMENSION) {
      return {
        error:
          `${String(cmd['type'])}: ${width}x${height} is ${width * height} pixels, past the ` +
          `${MAX_CAPTURE_DIMENSION}x${MAX_CAPTURE_DIMENSION} total — ${CAPTURE_BUDGET_REASON}`,
      };
    }
    return { size: { width, height } };
  }
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
    return {
      error:
        `${String(cmd['type'])}: "size" must be a finite number >= 1 — got ` +
        `${typeof raw} ${JSON.stringify(raw) ?? String(raw)}.`,
    };
  }
  return { size: raw };
}

/**
 * The editor's own capture ceiling, and WHY it is this number.
 *
 * 64..1024 per side is `asset-preview.ts`'s `MIN_SIZE`/`MAX_SIZE`: the pixels
 * cross the editor relay as base64 JSON, and 1024 is where even incompressible
 * RGBA still fits its 50 MB request limit. A shaped frame is held to the same
 * BUDGET rather than a laxer one — its total may not exceed a 1024 square —
 * because the budget is about bytes on the wire, not about shape.
 */
const MIN_CAPTURE_DIMENSION = 64;
const MAX_CAPTURE_DIMENSION = 1024;
const CAPTURE_BUDGET_REASON =
  "the editor's own ceiling: the pixels cross the relay as base64 JSON, and 1024 is where even " +
  'incompressible RGBA still fits its 50 MB request limit. For more picture, take more views, ' +
  'not bigger ones.';

function activeObject3DDocumentSession() {
  const documentId = activeWorkspaceDocumentId();
  return documentId ? object3DDocumentSession(documentId) : null;
}

/** THE ONE PLAY-RUN FENCE all four error facets below split on: `true` when a
 *  console entry logged at `timestamp` belongs to the most recent play run.
 *
 *  Closed at BOTH ends (the live registry's newest run window), which is
 *  what makes the play facets and the session facets a genuine partition of the
 *  session's error entries — every entry belongs to exactly one side, so the
 *  counts sum with nothing double-counted and nothing dropped. With an
 *  open-ended window a single play run captured the rest of the session: every
 *  later editor error read as "during the play run" and was reported only by a
 *  banner that renders while play is live. */
function inPlayRun(timestamp: number): boolean {
  const window = liveRunWindow();
  if (!window || timestamp < window.startedAt) return false;
  return window.endedAt === null || timestamp <= window.endedAt;
}

/** #146 — uncaught page errors from the CURRENT play run, for `vgai status`
 *  and for `@vgai/game`'s `bridge-call` snapshot, which imports it from here
 *  (the two must report the same set; the facet moves when Play does).
 *  Reads the editor console's 'runtime'-source error entries
 *  (fed by `installEditorConsoleCapture`'s window error/unhandledrejection
 *  capture — the same events, same message format as `window.__vgai`'s own
 *  pageErrors ring buffer), fenced to the play run. Same 100-cap as the bridge
 *  (`PAGE_ERROR_CAP`), keeping the most recent. */
export function collectPlayRunPageErrors(): string[] {
  return editorConsole
    .getEntries()
    .filter((e) => e.level === 'error' && e.source === 'runtime' && inPlayRun(e.timestamp))
    .slice(-100)
    .map((e) => (e.count > 1 ? `${e.message} (×${e.count})` : e.message));
}

/** How many of the newest console-error messages the summary carries, and how
 *  far each is truncated. A banner that reprints every message on a noisy run
 *  stops being readable, which is the failure mode this exists to fix (same
 *  reasoning as `authoringWarningsWarning`'s per-file summary in the CLI); the
 *  full text is in the editor console and the run's `logs/play-*.jsonl`. */
const CONSOLE_ERROR_SAMPLE = 3;
const CONSOLE_ERROR_MESSAGE_CAP = 200;

/** Error-level editor-console entries from the CURRENT play run that
 *  `collectPlayRunPageErrors` above does NOT already report — i.e. everything except
 *  the 'runtime' source. That exclusion is what makes the two facets disjoint,
 *  so a reader can add the counts without double-counting one error.
 *
 *  The dominant member is source 'game': `play-mode.ts`'s console patch funnels
 *  the running game's own `console.error` here, and that channel reached no CLI
 *  reader at all. `count` totals OCCURRENCES (the console store collapses
 *  identical consecutive messages into one entry with a `count`), so a loop
 *  erroring every frame reports the real number rather than 1. Fenced to
 *  the live run window exactly like `collectPlayRunPageErrors`, and `{count: 0,
 *  recent: []}` while stopped. */
function collectConsoleErrors(): { count: number; recent: string[] } {
  return summarizeEntries(
    editorConsole
      .getEntries()
      .filter((e) => e.level === 'error' && e.source !== 'runtime' && inPlayRun(e.timestamp)),
  );
}

/** The shared `{count, recent}` shape: `count` totals OCCURRENCES (the console
 *  store collapses identical consecutive messages into one entry carrying a
 *  `count`), `recent` is the newest few, source-tagged and truncated. */
function summarizeEntries(entries: readonly ConsoleEntry[]): { count: number; recent: string[] } {
  const count = entries.reduce((sum, e) => sum + e.count, 0);
  const recent = entries.slice(-CONSOLE_ERROR_SAMPLE).map((e) => {
    const source = e.source ? `[${e.source}] ` : '';
    const repeats = e.count > 1 ? ` (×${e.count})` : '';
    const message =
      e.message.length > CONSOLE_ERROR_MESSAGE_CAP
        ? `${e.message.slice(0, CONSOLE_ERROR_MESSAGE_CAP)}…`
        : e.message;
    return `${source}${message}${repeats}`;
  });
  return { count, recent };
}

/** Error-level entries from the whole EDITOR SESSION that the two play-fenced
 *  facets above do NOT report — i.e. everything logged outside the most recent
 *  play run's window (`inPlayRun`). That exclusion is what keeps all three
 *  disjoint, exactly as `collectConsoleErrors` excludes source 'runtime'.
 *
 *  Measured defect this closes: a human watching the editor's browser console
 *  saw real errors — Content-tab story previews throwing `useRapier must be
 *  used within <Physics>` — while `vgai status` reported `consoleErrors:
 *  {count: 0}` and `pageErrors: []`. Nothing was wrong with either facet: both
 *  are fenced to a play run, and the ONLY funnel from a raw `console.error`
 *  into the store was play-mode's patch, installed at play start and removed at
 *  play stop. Outside play, an editor-frame error existed in the browser
 *  console and nowhere else. `installEditorConsoleCapture()` (editor boot) now
 *  feeds the store for the whole session, and this is the facet that reports
 *  it — including uncaught page errors ('runtime') thrown outside a play run,
 *  which `collectPlayRunPageErrors` deliberately still does not claim.
 *
 *  Fence: since editor page load (the store starts empty at boot), NOT since
 *  play start. */
function collectSessionErrors(): { count: number; recent: string[] } {
  return summarizeEntries(
    editorConsole.getEntries().filter((e) => e.level === 'error' && !inPlayRun(e.timestamp)),
  );
}

/** Warn-level entries from the whole editor session. No play-fenced facet
 *  reports warnings at ALL — `console.warn` had no CLI-facing channel of any
 *  kind — so this one is not narrowed to outside-play: narrowing it would
 *  simply re-hide every warning a play run emits. Same `{count, recent}`
 *  discipline as the error facets; the `[source]` tag on each sample is what
 *  tells a reader whether a warning came from the game, the editor, or the
 *  server. */
function collectSessionWarnings(): { count: number; recent: string[] } {
  return summarizeEntries(editorConsole.getEntries().filter((e) => e.level === 'warn'));
}

/**
 * `document-script` relay op — `editor.document.run(ctx => …)`. The same
 * wire contract as `page-script` (a step's own source, reconstructed here;
 * closures do not survive), bound not to a page shim but to the object the
 * ACTIVE document published as its context. Refuses by name when no document
 * is active or the active one published nothing, so an agent is never told
 * a step ran against a document that has no session to run it on.
 */
async function handleDocumentScript(cmd: EditorCommand): Promise<CommandResult> {
  const src = cmd['src'];
  if (typeof src !== 'string') {
    return { ok: false, error: 'document-script requires a string "src" (the step\'s toString())' };
  }
  const documentId = activeWorkspaceDocumentId();
  if (!documentId) {
    return {
      ok: false,
      error: 'document-script: no document is active',
      data: { code: 'DOCUMENT_SCRIPT_UNAVAILABLE' },
    };
  }
  await waitForDocumentContext(documentId);
  const context = documentContextFor(documentId);
  if (activeWorkspaceDocumentId() !== documentId) {
    return {
      ok: false,
      error: 'document-script: the active document changed while its context was loading',
      data: { code: 'DOCUMENT_SCRIPT_UNAVAILABLE', documentId },
    };
  }
  if (context === undefined) {
    return {
      ok: false,
      error:
        `document-script: the active document (${documentId}) publishes no context to run ` +
        'against — a document opts in through its `publishContext` prop (the mesh document ' +
        'publishes its session).',
      data: { code: 'DOCUMENT_SCRIPT_UNAVAILABLE', documentId },
    };
  }
  let step: (ctx: unknown, info: { documentId: string }) => unknown;
  try {
    step = new Function('ctx', 'info', `return (${src})(ctx, info)`) as typeof step;
  } catch (err) {
    return {
      ok: false,
      error: `document-script: failed to reconstruct the step function from source — ${
        err instanceof Error ? err.message : String(err)
      }`,
      data: { code: 'DOCUMENT_SCRIPT_ERROR' },
    };
  }
  try {
    const result = await step(context, { documentId });
    return { ok: true, data: { result: result === undefined ? null : result } };
  } catch (err) {
    return {
      ok: false,
      error: `document-script: step threw — ${err instanceof Error ? err.message : String(err)}`,
      data: { code: 'DOCUMENT_SCRIPT_ERROR' },
    };
  }
}

async function handleAssetPreviewCommand(
  store: EditorShellStore,
  cmd: EditorCommand,
): Promise<CommandResult> {
  const assetPath = cmd['assetPath'];
  const entityId = cmd['entityId'];
  // The THIRD source: a GLB that travels IN the command rather than being
  // fetched or looked up — the module-look lane (`project.bake.preview`)
  // builds an Object3D in Node, where there is no GPU, and hands the editor
  // the exported bytes. Counted rather than XOR-ed because there are now more
  // than two sources and "exactly one" has to stay exactly one.
  const glbBase64 = cmd['glbBase64'];
  const sourceCount =
    Number(typeof assetPath === 'string') +
    Number(typeof entityId === 'string') +
    Number(typeof glbBase64 === 'string');
  if (sourceCount !== 1) {
    return {
      ok: false,
      error: 'capture-asset-preview requires exactly one of assetPath, entityId or glbBase64.',
    };
  }
  const width = cmd['width'];
  const height = cmd['height'];
  const background = cmd['background'];
  const shots = cmd['shots'];
  const shotSet = cmd['shotSet'];
  const forward = cmd['forward'];
  const compare = cmd['compare'];
  const stage = cmd['stage'];
  const camera = cmd['camera'];
  const pose = cmd['pose'];
  if (
    (width !== undefined && typeof width !== 'number') ||
    (height !== undefined && typeof height !== 'number') ||
    (background !== undefined && background !== 'neutral' && background !== 'transparent') ||
    (shots !== undefined && shots !== 'source')
  ) {
    return { ok: false, error: 'Invalid asset preview dimensions, background, or shots mode.' };
  }
  if (stage !== undefined && stage !== 'lab' && stage !== 'scene') {
    return {
      ok: false,
      error: `capture-asset-preview stage must be "lab" or "scene", got ${String(stage)}.`,
    };
  }
  if (shotSet !== undefined && shots !== undefined) {
    return {
      ok: false,
      error: 'capture-asset-preview cannot combine a shotSet definition with a shots mode.',
    };
  }
  // The free capture camera and clip pose (`--azimuth/--elevation/--distance`,
  // `--clip/--time`) belong to the plain Asset Lab legs: a shot set / source
  // review / compare each stage their own cameras and poses, and the scene
  // stage photographs an entity where it stands. Refused by name, never
  // silently ignored.
  const cameraChoice = parseCameraChoice('capture-asset-preview', camera);
  if (typeof cameraChoice === 'string') return { ok: false, error: cameraChoice };
  const posedClip = parsePoseChoice('capture-asset-preview', pose);
  if (typeof posedClip === 'string') return { ok: false, error: posedClip };
  if (
    (cameraChoice || posedClip) &&
    (shots !== undefined || shotSet !== undefined || compare !== undefined || stage === 'scene')
  ) {
    return {
      ok: false,
      error:
        'capture-asset-preview cannot combine camera/pose with a shots mode, a shotSet ' +
        'definition, compare, or stage "scene" — those legs stage their own cameras and poses.',
    };
  }
  // A project-defined labeled shot set travels WITH the command (the CLI
  // resolves `--shots <set>` through the registered
  // `project.<set>.previewShots` tool); validate the untrusted
  // definition at the relay boundary so a malformed contribution fails with
  // a named reason instead of a deep three.js error.
  let shotSetDefinition: ReturnType<typeof parseShotSetDefinition> | undefined;
  if (shotSet !== undefined) {
    try {
      shotSetDefinition = parseShotSetDefinition(shotSet);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  const parsedForward = parseForwardVector(forward);
  if (shots === 'source' && parsedForward === null) {
    return {
      ok: false,
      error: 'capture-asset-preview --shots source requires a non-degenerate forward [x,y,z].',
    };
  }
  if (compare !== undefined) {
    // B8.4 — the compare mode (`vgai screenshot <model.glb> --compare <ref.glb>`).
    // Validated here at the relay boundary so a malformed payload fails with
    // a named reason instead of a deep three.js error.
    if (shots !== undefined || shotSetDefinition !== undefined) {
      return { ok: false, error: 'capture-asset-preview cannot combine compare with shots.' };
    }
    if (
      typeof compare !== 'object' ||
      compare === null ||
      typeof (compare as Record<string, unknown>)['glbBase64'] !== 'string' ||
      ((compare as Record<string, unknown>)['forward'] !== undefined &&
        parseForwardVector((compare as Record<string, unknown>)['forward']) === null)
    ) {
      return {
        ok: false,
        error:
          'capture-asset-preview compare requires { glbBase64: string, forward?: [x, y, z] } ' +
          'with a non-degenerate ground-plane forward.',
      };
    }
  }
  // Wire-carried GLB bytes stand NOWHERE, so they take no scene stage and no
  // compare (whose reference is named some other way). An explicit `shotSet`
  // definition is a different matter and is served: a shot set stages the
  // subject itself, which is what lets `vgai screenshot <module> --orbit <n>`
  // circle a model that only ever existed as bytes. `shots: 'source'` stays
  // out — it is the asset-path review set, keyed to a stored forward vector.
  if (typeof glbBase64 === 'string') {
    if (shots !== undefined || compare !== undefined) {
      return {
        ok: false,
        error: 'capture-asset-preview cannot combine glbBase64 with a named shots mode or compare.',
      };
    }
    if (stage === 'scene') {
      return {
        ok: false,
        error:
          'capture-asset-preview stage "scene" photographs a live scene entity — glbBase64 bytes stand nowhere in the scene.',
      };
    }
  }
  // `stage: 'scene'` photographs a LIVE entity in the live scene (see
  // `captureSceneStageAssetPreview`), so it is meaningful only for the plain
  // four-view entity capture: a model loaded from `assetPath` stands nowhere,
  // and the shot-set/source/compare modes each stage their own subject.
  // Refused by name at this boundary rather than silently downgraded to the
  // lab stage — a caller who asked for the scene and got the studio would
  // never know.
  const liveScene = stage === 'scene' ? store.scene : null;
  if (stage === 'scene') {
    if (typeof entityId !== 'string') {
      return {
        ok: false,
        error:
          'capture-asset-preview stage "scene" photographs a live scene entity — pass entityId, not assetPath.',
      };
    }
    if (shots !== undefined || shotSetDefinition !== undefined || compare !== undefined) {
      return {
        ok: false,
        error:
          'capture-asset-preview cannot combine stage "scene" with a shots mode, a shotSet definition or compare.',
      };
    }
    if (!liveScene) {
      return {
        ok: false,
        error:
          'capture-asset-preview stage "scene" requires a bound viewport scene; none is bound yet.',
      };
    }
  }
  // Resolve the screenshot subject through the SAME active-document adapter
  // that produced `status.entities`, drives Hierarchy/Inspector selection and
  // answers `frame-entity`. An adopted Play scene can own a stable OID in its
  // projection without publishing that object through the shell's edit-mode
  // `objectMap`; checking the map alone made the final door reject an id every
  // preceding door had just accepted.
  const entityObject =
    typeof entityId === 'string'
      ? entityObject3D(activeDocumentAuthoring(store), store.objectMap, entityId)
      : null;
  if (typeof entityId === 'string' && !entityObject) {
    return { ok: false, error: `Entity not found: ${entityId}` };
  }
  try {
    const options = {
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
      ...(background ? { background: background as AssetPreviewBackground } : {}),
      ...(cameraChoice ? { camera: cameraChoice } : {}),
      ...(posedClip ? { pose: posedClip } : {}),
    };
    if (compare !== undefined) {
      const compareRecord = compare as { glbBase64: string; forward?: unknown };
      const refForward = parseForwardVector(compareRecord.forward);
      const compareOptions = {
        ...(typeof width === 'number' ? { width } : {}),
        ...(typeof height === 'number' ? { height } : {}),
        ...(refForward ? { refForward } : {}),
      };
      const capture =
        typeof assetPath === 'string'
          ? await captureModelComparePreview(assetPath, compareRecord.glbBase64, compareOptions)
          : await captureEntityComparePreview(
              entityObject!,
              compareRecord.glbBase64,
              compareOptions,
            );
      return { ok: true, data: { ...capture } };
    }
    if (shotSetDefinition !== undefined) {
      const capture =
        typeof glbBase64 === 'string'
          ? await captureShotSetGlbBytesPreview(glbBase64, shotSetDefinition, options)
          : typeof assetPath === 'string'
            ? await captureShotSetModelPreview(assetPath, shotSetDefinition, options)
            : captureShotSetAssetPreview(entityObject!, shotSetDefinition, options);
      return { ok: true, data: { ...capture } };
    }
    if (shots === 'source') {
      const capture =
        typeof assetPath === 'string'
          ? await captureSourceReviewShotSetModelPreview(assetPath, parsedForward!, options)
          : captureSourceReviewShotSetAssetPreview(entityObject!, parsedForward!, options);
      return { ok: true, data: { ...capture } };
    }
    if (liveScene) {
      const capture = captureSceneStageAssetPreview(entityObject!, liveScene, options);
      return { ok: true, data: { ...capture } };
    }
    if (typeof glbBase64 === 'string') {
      const capture = await captureGlbBytesAssetPreview(glbBase64, options);
      return { ok: true, data: { ...capture } };
    }
    const capture =
      typeof assetPath === 'string'
        ? await captureModelAssetPreview(assetPath, options)
        : captureObjectAssetPreview(entityObject!, options);
    return { ok: true, data: { ...capture } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Exported (alongside `collectState` above) so unit tests can dispatch
 * commands directly against a headless `EditorShellStore`, with no SSE/server
 * round-trip — see `packages/editor/test/command-listener.test.ts`, notably
 * the false-ack regression test: an unrecognized command must return
 * `{ok:false}`, never fall through to a fabricated `{ok:true}`.
 */
export async function handleCommand(
  store: EditorShellStore,
  cmd: EditorCommand,
  options?: CommandHandlingOptions,
): Promise<CommandResult> {
  // EVERY relayed command is observed (`command-dispatch.ts`): Play's idle
  // watchdog reads it, and a stamp filed per-case would quietly exclude
  // whichever case someone forgot.
  noteCommandDispatched(cmd['type'] as string);
  // A video export OWNS the paused run it is stepping frame by frame, so no
  // other command may touch it mid-export. `stop` is the one exception and
  // falls THROUGH: the export's cancel handle lives with the verb that
  // started it (`@vgai/game`'s `play.command.ts`), and its `stop` handler
  // aborts the controller before tearing the run down. The FLAG stays host
  // state (`gameplay-export-state.ts`) because two surfaces outside that verb
  // read it — this prologue and the PlayBar's transport ownership.
  if (isGameplayExportActive() && cmd['type'] !== 'stop') {
    return {
      ok: false,
      error: 'Video export owns this paused run. Stop it to cancel before another command.',
    };
  }
  // A running lane answers its own play verbs first (`LiveSession.command`,
  // the live registry): an ingested game owns its mount, so the first-party
  // boot must never be handed its container.
  const answered = dispatchLiveCommand(cmd as { type: string });
  if (answered) return answered;
  if (cmd['type'] === 'play' || cmd['type'] === 'restart') {
    // NO live ingest, but a mount FAILED — refuse with the failure instead of
    // letting `enterPlayMode` boot a first-party composition over an ingest
    // manifest. It cannot: `resolveRootBinding` throws for every ingest
    // identity by construction, and the sentence it throws is about
    // `ThreeHostContext` not carrying an `EditorStore` — true, internal, and
    // about a mechanism the reader was never using. MEASURED on the
    // bubbo-bubbo canvas ingest: the real cause was a capture window spent on
    // a hidden tab, and `vgai play` reported the resolver's contract note,
    // naming neither the game nor the reason. A failed mount is the answer to
    // "why can't I play this", whichever lane failed.
    const failures = getMountFailureReports();
    if (failures.length > 0) {
      return {
        ok: false,
        error:
          `this project's ${failures.length === 1 ? 'root' : 'roots'} did not mount, so there ` +
          `is nothing to ${cmd['type'] === 'play' ? 'play' : 'restart'}: ` +
          failures.map((f) => `"${f.worldId}" (${f.identity}) — ${f.message}`).join('; '),
      };
    }
  }
  // The dispatch keys off the TABLE's union, not off a raw string. Two things
  // follow, and they are the whole point of `command-table.ts`: a `case` whose
  // label is not a row does not compile, and a row with no `case` fails the
  // exhaustiveness check in the `default` below. The runtime guard in front of
  // it is what makes the narrowing honest — an unknown string from an older
  // CLI still reaches the "unknown command type" answer.
  // A PACKAGE'S verb (`@volter/editor-sdk/commands`, `command-registry.ts`):
  // answered by its own handler, through the same relay, ack and derivation
  // as the host's table below. Asked first so a contributed verb never
  // reads as "editor page predates this CLI".
  const contributed = await resolveContributedCommand(cmd['type']);
  if (contributed) {
    try {
      const answer = await contributed.handle(cmd);
      return {
        ok: answer.ok,
        ...(answer.error !== undefined ? { error: answer.error } : {}),
        ...(answer.data !== undefined ? { data: answer.data } : {}),
      };
    } catch (error) {
      return commandThrewResult(cmd, error);
    }
  }
  if (!isRelayCommandType(cmd['type'])) {
    return {
      ok: false,
      error:
        `unknown command type "${cmd['type']}" — not one of the editor's own, and no package this ` +
        'project declares contributes it (or the editor page predates this CLI)',
      data: { code: 'UNKNOWN_COMMAND_TYPE' },
    };
  }
  const commandType: RelayCommandType = cmd['type'];
  switch (commandType) {
    case 'session-prepare-close':
      await prepareSessionClose();
      return { ok: true };
    // Selection
    case 'select': {
      const id = (cmd['id'] as string | null) ?? null;
      if (id !== null) {
        const refusal = unresolvedSelectionRefusal(store, id);
        if (refusal) return { ok: false, error: refusal };
      }
      applyControlSelection(store, id ? [id] : [], options);
      break;
    }
    case 'select-multiple': {
      const ids = cmd['ids'] as string[];
      // All-or-nothing: a partial selection silently dropping the id the caller
      // cared about is the same fabrication in a quieter form.
      for (const id of ids) {
        const refusal = unresolvedSelectionRefusal(store, id);
        if (refusal) return { ok: false, error: refusal };
      }
      applyControlSelection(store, ids, options);
      break;
    }
    case 'select-all': {
      applyControlSelection(
        store,
        activeHierarchyRows(store).map((row) => row.id),
        options,
      );
      break;
    }

    // Viewport
    case 'focus-entity':
      if (!activeObject3DDocumentSession()?.frameIds([cmd['id'] as string])) {
        store.focusOnEntity(cmd['id'] as string);
      }
      break;
    // The STRICT entity-targeted sibling of `focus-entity`: the same edit
    // viewport framing, but an id nothing in the scene answers to is a named
    // refusal rather than the silent no-op `focus-entity` keeps (its viewport
    // action simply finds no object in `objectMap` and does nothing —
    // world-root-stage.ts). That matters for a scripted flow that frames an
    // entity and then photographs it: framing that quietly did nothing hands
    // back a confident picture of whatever the camera happened to be on.
    case 'frame-entity': {
      const id = cmd['id'];
      if (typeof id !== 'string' || id.length === 0) {
        return { ok: false, error: 'frame-entity requires a string "id" (the entity to frame).' };
      }
      const documentSession = activeObject3DDocumentSession();
      if (documentSession) {
        if (!documentSession.frameIds([id])) {
          return {
            ok: false,
            error: `Entity not found: ${id}`,
            data: { code: 'ENTITY_NOT_FOUND' },
          };
        }
        break;
      }
      // A Canvas Scene has no Object3D by design. Its native framing answer is
      // the adapter-owned screen rect consumed by CanvasSceneControls. The
      // provider may temporarily return null while Pixi is between layouts;
      // strict existence is therefore the owned hierarchy node + the rect
      // capability, not one timing-sensitive measurement.
      // Resolve against the active document just like Hierarchy/Inspector do.
      // The global edit-mode composite intentionally does not merge 2D rect
      // providers; the open Canvas Scene publishes its own native adapter.
      const activeAdapter = activeDocumentAuthoring(store);
      if (activeAdapter.hierarchy.node(id) !== null && activeAdapter.rects) {
        store.focusOnEntity(id);
        break;
      }
      // The SAME resolver the framing itself uses (`entity-object.ts`). Gating
      // on `store.objectMap` alone refused every entity of a running game: an
      // adopted play scene's nodes are the adapter's, not the shell map's.
      if (!entityObject3D(activeAdapter, store.objectMap, id)) {
        return { ok: false, error: `Entity not found: ${id}`, data: { code: 'ENTITY_NOT_FOUND' } };
      }
      store.focusOnEntity(id);
      break;
    }
    case 'focus-selection':
      if (!activeObject3DDocumentSession()?.frameSelection()) store.focusOnSelection();
      break;
    case 'view-preset': {
      // The cast below is the ONLY thing between the relay and a raw table
      // lookup, so an absent or unknown preset has to be refused BY NAME here.
      // Unguarded it reached `cameraPresetDirection` and threw
      // `directions[preset] is not iterable (cannot read property undefined)`
      // into the session console — a TypeError that names neither the command
      // nor the vocabulary (measured live, 2026-09-18, driving `editor.view`
      // through `vgai eval` on a game project). Same shape as `set-camera`
      // below: state what is required, list what is accepted.
      const requested = cmd['preset'];
      const presets = ['top', 'front', 'right', 'perspective'] as const;
      if (typeof requested !== 'string' || !(presets as readonly string[]).includes(requested)) {
        return {
          ok: false,
          error: `view-preset requires one of ${presets.join(', ')}, got ${
            requested === undefined ? 'nothing' : JSON.stringify(requested)
          }.`,
        };
      }
      const preset = requested as (typeof presets)[number];
      const documentSession = activeObject3DDocumentSession();
      if (documentSession) {
        documentSession.setViewPreset(preset === 'perspective' ? 'isometric' : preset);
      } else store.setViewPreset(preset);
      break;
    }
    case 'set-camera': {
      const position = cmd['position'] as { x: number; y: number; z: number } | undefined;
      const target = cmd['target'] as { x: number; y: number; z: number } | undefined;
      const fov = cmd['fov'] as number | undefined;
      if (
        !position ||
        !target ||
        typeof position.x !== 'number' ||
        typeof position.y !== 'number' ||
        typeof position.z !== 'number' ||
        typeof target.x !== 'number' ||
        typeof target.y !== 'number' ||
        typeof target.z !== 'number'
      ) {
        return { ok: false, error: 'set-camera requires numeric {x,y,z} position and target.' };
      }
      const documentSession = activeObject3DDocumentSession();
      if (documentSession) documentSession.setCameraPose(position, target, fov);
      else store.setCameraPose(position, target, fov);
      break;
    }

    // THE AGENT'S LOOKING, AS A WATCHABLE ACT. These three drive the OPEN
    // Object3D document's own camera — the one the human is looking through —
    // and orbit/turntable ack only when the animated move ends, so a scripted
    // "walk around the model" is something a person sees happen rather than a
    // jump cut between two poses. They are document verbs by construction:
    // there is no Scene fallback, because the Scene viewport's camera answers
    // to `view-preset`/`set-camera` and has no framed subject to circle.
    case 'document-orbit':
    case 'document-turntable': {
      const documentSession = activeObject3DDocumentSession();
      if (!documentSession) {
        return {
          ok: false,
          error:
            `${cmd['type']} needs an Object3D document open and active (a model, a live ` +
            'module, an entity model). Open one with `editor.openAsset(<path>)` first.',
          data: { code: 'NO_ACTIVE_OBJECT3D_DOCUMENT' },
        };
      }
      const seconds = cmd['type'] === 'document-orbit' ? cmd['duration'] : cmd['seconds'];
      if (
        seconds !== undefined &&
        (typeof seconds !== 'number' || !(seconds >= 0 && seconds <= 60))
      ) {
        return {
          ok: false,
          error: `${cmd['type']}: the move's length must be a number of seconds in 0..60.`,
        };
      }
      const outcome =
        cmd['type'] === 'document-orbit'
          ? await documentSession.orbit({
              ...(typeof cmd['azimuth'] === 'number' ? { azimuth: cmd['azimuth'] } : {}),
              ...(typeof cmd['elevation'] === 'number' ? { elevation: cmd['elevation'] } : {}),
              ...(typeof seconds === 'number' ? { duration: seconds } : {}),
            })
          : await documentSession.turntable({
              ...(typeof seconds === 'number' ? { seconds } : {}),
              ...(typeof cmd['revolutions'] === 'number'
                ? { revolutions: cmd['revolutions'] }
                : {}),
            });
      return { ok: true, data: { ...outcome } };
    }
    case 'document-frame': {
      const documentSession = activeObject3DDocumentSession();
      if (!documentSession) {
        return {
          ok: false,
          error:
            'document-frame needs an Object3D document open and active. For the Scene ' +
            'viewport use `frame-entity`/`focus-selection`.',
          data: { code: 'NO_ACTIVE_OBJECT3D_DOCUMENT' },
        };
      }
      const fit = cmd['fit'];
      if (fit !== undefined && (typeof fit !== 'number' || !(fit >= 0.1 && fit <= 10))) {
        return { ok: false, error: 'document-frame: "fit" must be a number in 0.1..10.' };
      }
      if (!documentSession.frame(typeof fit === 'number' ? fit : 1)) {
        return {
          ok: false,
          error: 'Nothing to frame: the document subject has no measurable bounds.',
          data: { code: 'EMPTY_FRAME_BOUNDS' },
        };
      }
      return { ok: true, data: { ...documentSession.cameraPose() } };
    }

    // Panels
    case 'viewport-tab': {
      // The tab is which document has focus: `play` is the Game document, `edit` any other.
      // Asking for one activates that document; the workspace owns focus.
      const tab = cmd['tab'];
      if (tab !== 'edit' && tab !== 'play') {
        return { ok: false, error: `viewport-tab requires "edit" or "play", got ${String(tab)}.` };
      }
      const open = openWorkspaceDocuments().map((document) => document.descriptor.id);
      const target =
        tab === 'play'
          ? open.find((id) => id === GAME_DOCUMENT_ID)
          : (open.find((id) => id === 'workspace:scene') ?? open.find((id) => id !== GAME_DOCUMENT_ID));
      if (!target || !activateWorkspaceDocument(target)) {
        return {
          ok: false,
          error:
            tab === 'play'
              ? 'viewport-tab play: no Game document is open. Start Play first.'
              : 'viewport-tab edit: no document other than Game is open.',
        };
      }
      break;
    }
    // FOCUS A PANEL. The vocabulary is the static-panel REGISTRY, resolved by
    // `revealStaticPanel` at call time — the same resolution and the same
    // refusal a view's `panel` gets, and the same reveal the Window menu's own
    // items use. This handler recognises no panel by name.
    case 'show-panel': {
      try {
        const panel = cmd['panel'];
        if (typeof panel !== 'string' || panel.trim() === '') {
          return { ok: false, error: 'show-panel requires a non-empty "panel".' };
        }
        return { ok: true, data: { panel: await revealStaticPanel(panel) } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    // W2: the legacy right-rail tab commands keep their key vocabulary but
    // now drive the CENTER workspace documents (`asset-documents.tsx`).
    // '__inspector__' ("show the Inspector") is a no-op now: the Inspector is
    // selection-owned, so a command cannot force it open without a subject.
    case 'active-tab': {
      const key = cmd['key'] as string;
      // The ack must MEAN the document is in front. This handler used to
      // discard `activateWorkspaceDocument`'s boolean, so asking for a
      // document that does not exist acked `ok` while the workspace kept
      // showing whatever tab was already there — and every caller that
      // photographs, inspects or drives "the active document" then read a
      // surface it never asked for and had no way to notice (doctor's walk
      // photographed the UI board and filed it as the Scene). The refusal
      // lists what IS open, because a wrong id is nearly always a stale or
      // misspelled one and the registry already knows the real set.
      if (key !== '__inspector__' && !activateWorkspaceDocument(key)) {
        const open = openWorkspaceDocuments().map((d) => d.descriptor.id);
        return {
          ok: false,
          error:
            `No open workspace document with id "${key}" — nothing was activated. ` +
            (open.length > 0
              ? `Open documents: ${open.join(', ')}.`
              : 'No documents are open in this workspace.'),
        };
      }
      break;
    }
    case 'select-asset': {
      // The OTHER half of the browser's selection-vs-open contract
      // (`asset-selection.ts`): a single click SELECTS an asset and fills the
      // Inspector; a double click OPENS its document. Only `open` had a verb,
      // so every `asset.inspector` contribution — a project's own Inspector
      // door — was reachable by mouse alone.
      const path = cmd['path'];
      if (typeof path !== 'string' || path.trim() === '') {
        return { ok: false, error: 'select-asset requires a non-empty "path".' };
      }
      // No existence check, for the same reason `open-asset-tab` has none:
      // the sections that match report their own failures (the Edit Mesh
      // door says "exports no build()"), and a second file-exists door here
      // would answer for a tier it cannot see (a hosted project's source has
      // no `public/` listing). An unknown path selects and the Inspector
      // shows nothing matched, which is the same answer the browser gives.
      const clean = path.replace(/^\/+/, '');
      const name = clean.split('/').pop() ?? clean;
      const capability = assetCapabilities(name);
      setSelectedAsset({
        path,
        name,
        kind: assetDocumentKind(capability) ?? 'unknown',
        capabilities: capability,
        origin: 'project',
      });
      break;
    }
    case 'open-asset-tab': {
      const kind = cmd['kind'] as AssetKind;
      const documentId = openAssetDocument(cmd['path'] as string, kind);
      if (!(await waitForAssetDocumentInspector(documentId, kind))) {
        return {
          ok: false,
          error: `Asset document did not finish mounting its Inspector: ${documentId}`,
        };
      }
      break;
    }
    case 'close-asset-tab': {
      // Legacy key vocabulary: the deleted store-era `closeAssetTab` only
      // ever acted on asset tabs and no-op'd for anything else (scene/game/
      // story keys included). `closeWorkspaceDocument` itself has no such
      // guard — it closes ANY registered id, pinned or not (`closeable:
      // false` is only a UI-affordance rule, not a registry invariant; see
      // workspace-document-registry.ts) — so this command must keep the
      // no-op itself. `isAssetDocumentId` is exactly the legacy asset key
      // vocabulary check (project asset path / `asset-editor:entity:<id>` /
      // `online:<source>:<id>` — see asset-documents.tsx), so gating on it
      // blocks the pinned `workspace:scene`/`workspace:game` ids (and any
      // story `story:<path>#<name>` id) while preserving the real behavior
      // for actual asset tabs.
      const key = cmd['key'] as string;
      if (isAssetDocumentId(key)) closeWorkspaceDocument(key);
      break;
    }
    case 'toggle-command-palette':
      // The palette is the workbench's; the frame hands over the opener that
      // shows it (`editor-commands.ts`).
      openCommandPalette();
      break;
    case 'toggle-console':
      toggleConsoleUtility();
      break;
    // RELOAD THIS PAGE — `@vgai/live`'s `page.reload()` and P20's prescribed
    // recovery. Deliberately NOT routed through `page-script`: that verb is
    // gated on a mounted game surface, and the one thing a reload has to fix —
    // a page whose module-scope loaders and page-lifetime asset caches hold
    // bytes that have since changed on disk — is just as real with play
    // stopped, and just as real in a product that has no game at all.
    //
    // It is the HOST's for that last reason. It was a `@vgai/game` command
    // contribution until walk 5, so `page.reload()` answered `unknown command
    // type "page-reload"` in the model editor, which declares no `@vgai/game`.
    //
    // Scheduled for the NEXT task rather than run inline, so this handler can
    // return and the caller's ack can travel before the navigation tears the
    // channel down: the client acks the ORDER here and waits for the new page
    // load on the server's own tab table.
    case 'page-reload':
      setTimeout(() => {
        window.location.reload();
      }, 0);
      return { ok: true, data: { scheduled: true } };
    // NAMED WORKSPACES (ARCHITECTURE-CORE §Editor chrome) — the session
    // operation `editor.workspace(id)`, the third of the ruling's three
    // switching doors beside `Window → Workspace` and the registered actions.
    // A wrong id refuses and NAMES the vocabulary: this is a fixed registry,
    // so the refusal can be complete.
    case 'set-workspace': {
      const id = cmd['workspace'];
      if (!isEditorWorkspaceId(id)) {
        return {
          ok: false,
          error: `set-workspace requires one of ${editorWorkspaceIds().join(', ')}, got ${String(id)}.`,
        };
      }
      if (activeEditorWorkspace() === id)
        return { ok: true, data: { workspace: id, applied: true } };
      // Registered BEFORE the store flip — the dock's rebuild is what resolves
      // it, and that can land before this handler's next await point. Bounded,
      // because the store flip is real whether or not a dock is mounted to
      // follow it: a hung wait would otherwise be reported as "the editor did
      // not respond", which names the wrong thing.
      const rebuilt = whenEditorWorkspaceApplied().then(() => true);
      setEditorWorkspace(id);
      const applied = await Promise.race([
        rebuilt,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      // NOTHING REVEALS A DRAWER UTILITY HERE ANY MORE. `drawerUtility` was
      // this line's reason and it is retired: a Blender editor AREA is an
      // EDITOR GROUP, not a drawer view (orchestrator ruling 2026-09-19), so
      // the node editor and the UV editor are `workspace.document`
      // contributions the workspace opens into `vgai:area:<id>`
      // (`workspace-areas.ts`) and the drawer keeps only the utilities that
      // are not Blender areas.
      return { ok: true, data: { workspace: id, applied } };
    }
    case 'set-style': {
      const id = cmd['style'];
      const ids = workspaceStyles().map((bundle) => bundle.id);
      if (typeof id !== 'string' || !ids.includes(id)) {
        return {
          ok: false,
          error: `set-style requires one of ${ids.join(', ')}, got ${String(id)}.`,
        };
      }
      applyWorkspaceStyle(id);
      // Reported from the axes, not echoed: a bundle applies through the
      // settings layer that DECLARES each axis (`updatePreferenceSettings`),
      // so what the chrome wears is what this answers.
      const applied = activeWorkspaceStyleId();
      if (applied !== id) {
        return {
          ok: false,
          error: `set-style applied "${id}" but the editor is wearing ${applied === null ? 'a custom mix of axes' : `"${applied}"`}.`,
          data: { style: applied },
        };
      }
      return { ok: true, data: { style: id } };
    }
    case 'set-appearance': {
      // The MATERIAL apart from the bundle that usually carries it.
      // Appearance is palette × material by ruling (ARCHITECTURE-CORE
      // §Editor chrome), so nothing through the session could otherwise ask
      // "is it the blur or the palette?" about a stall a style switch
      // produces. This is the door that measures the axes apart; it applies
      // through the same preference writer the menu uses, so what the chrome
      // wears afterwards is what it answers.
      const material = cmd['material'];
      if (material === undefined) {
        return { ok: false, error: 'set-appearance needs a `material` to set.' };
      }
      if (!isEditorMaterialId(material)) {
        const ids = editorMaterials().map((choice) => choice.id);
        return {
          ok: false,
          error: `set-appearance material must be one of ${ids.join(', ')}, got ${String(material)}.`,
        };
      }
      setEditorMaterialPreference(material);
      return {
        ok: true,
        data: { material: editorMaterialSnapshot(), style: activeWorkspaceStyleId() },
      };
    }
    case 'present-view': {
      try {
        const presented = await presentEditorView(store, cmd['view'] as EditorView);
        return { ok: true, data: { ...presented } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'current-view':
      return { ok: true, data: { view: currentEditorView(store) } };
    case 'inspect': {
      // `editor.inspect` — the SERIALIZED projection of the inspection model
      // (`inspection/serialize.ts`), composed from the same live state, by the
      // same composer, as the column and the compact card
      // (`inspection/active-subject.ts`). The `InspectedInspection` annotation
      // is the drift check: the SDK's wire mirror and the editor's own
      // serialized shape are structurally compared by `tsc` on every build —
      // including its `{none:true}` arm, which is what a human seeing no
      // inspector at all serializes to.
      const subject: InspectedInspection = inspectActiveSubject(store);
      return { ok: true, data: { subject } };
    }
    case 'run-inspection-action': {
      try {
        const actionId = cmd['actionId'];
        if (typeof actionId !== 'string' || actionId.trim() === '') {
          throw new Error('run-inspection-action requires a non-empty actionId.');
        }
        const subject: InspectedInspection = await runActiveInspectionAction(store, actionId);
        return { ok: true, data: { subject } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'run-command': {
      // `editor.command(id, args)` — the ONE door to a command by id (U8's
      // ruling 1: "so `vgai eval` reaches it through the frame's command
      // service"). Under the frame that IS `ICommandService`; standalone it is
      // the views registry, and `editor-commands.ts` owns both arms plus
      // the refusal that names the id shape that would have worked.
      try {
        const commandId = cmd['commandId'];
        if (typeof commandId !== 'string' || commandId.trim() === '') {
          throw new Error('run-command requires a non-empty commandId.');
        }
        const result = await executeCommand(commandId, cmd['args']);
        // The command's own answer, as far as it survives the wire: a view
        // verb answers with its state, a workbench command usually with
        // nothing. `undefined` is not JSON, so it is reported as null rather
        // than dropping the key and making "ran, said nothing" look like a
        // malformed reply.
        return { ok: true, data: { result: result === undefined ? null : result } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'hierarchy': {
      // `editor.hierarchy` — the hierarchy panel's OWN rendered row tree,
      // serialized. Not a fresh walk of the adapter: the panel publishes the
      // rows and predicates it rendered with and this serializes those, so the
      // door cannot report a tree the human is not looking at
      // (`hierarchy-panel-view.ts` header). `editor.status().entities` answers a
      // deliberately DIFFERENT question — the raw adapter tree, unprojected.
      const snapshot = hierarchyPanelSnapshot();
      if (snapshot === null) {
        return {
          ok: false,
          error:
            'the hierarchy panel (GameHierarchy) is not mounted — no row tree is rendered, so there is nothing to report. Open the Hierarchy panel in the workspace dock and retry.',
        };
      }
      const hierarchy: InspectedHierarchy = serializeHierarchyPanel(snapshot, {
        playState: store.playState,
        activeViewportTab: store.activeViewportTab,
      });
      return { ok: true, data: { hierarchy } };
    }
    // EXPAND/COLLAPSE ALL, and they ship as a pair for a reason. The machine
    // door uses the panel's own mutations. Reading the raw adapter hierarchy
    // here would fabricate rows the panel has not rendered and would make
    // collapsed-branch certification meaningless; and expanding without a way
    // back is a ONE-WAY door — the fold is written to this project's persisted
    // preference, and a chevron's own click is not drivable through the
    // control API (`editor.document.click` refuses editor chrome by name), so
    // for as long as `expand-hierarchy-all` stood alone, no reader that used
    // it could ever see the tree's REST STATE again. Both call the toolbar's
    // own actions, so the human and machine paths cannot diverge. The ack
    // resolves on the panel's NEXT PUBLISHED SNAPSHOT, so a `hierarchy()` in
    // the same breath reads the mutated tree rather than the one before it.
    case 'expand-hierarchy-all':
    case 'collapse-hierarchy-all': {
      const expanding = cmd['type'] === 'expand-hierarchy-all';
      const snapshot = hierarchyPanelSnapshot();
      if (snapshot === null) {
        return {
          ok: false,
          error: `the hierarchy panel (GameHierarchy) is not mounted — no row tree is rendered, so there is nothing to ${expanding ? 'expand' : 'collapse'}. Open the Hierarchy panel in the workspace dock and retry.`,
        };
      }
      const committed = nextHierarchyPanelSnapshot();
      if (expanding) snapshot.expandAll();
      else snapshot.collapseAll();
      try {
        await committed;
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      return { ok: true, data: {} };
    }
    // UNDO/REDO over the control API. The keyboard shortcut and the command
    // palette have always had this; an agent authoring through the editor did
    // not — and for an ingest root, whose only authoring surface IS the editor,
    // that left an edit with no way back. Same queue, same guards, same
    // per-transaction semantics as the key press.
    case 'undo':
    case 'redo': {
      const history = options?.history;
      if (!history) {
        return {
          ok: false,
          error: `${String(cmd['type'])}: this editor has no history session attached, so there is nothing to undo.`,
        };
      }
      const moved = cmd['type'] === 'undo' ? await history.undo() : await history.redo();
      const snapshot = history.getSnapshot();
      return {
        ok: true,
        data: {
          moved,
          canUndo: snapshot.canUndo,
          canRedo: snapshot.canRedo,
          undoLabel: snapshot.undoLabel,
          redoLabel: snapshot.redoLabel,
        },
      };
    }
    case 'set-inspection-field': {
      try {
        const path = cmd['path'];
        if (typeof path !== 'string' || path.trim() === '') {
          throw new Error('set-inspection-field requires a non-empty field path.');
        }
        // THE ACK NAMES ITS DESTINATION. A write with no persistence route
        // still ACKs `ok` — it lands on the live object — so without `write`
        // the caller cannot tell a persisted edit from a vanished one, and
        // `scripts/doctor-walk.ts` graded a healthy consent-off session as a
        // silent no-op on exactly that ambiguity.
        const written: { subject: InspectedInspection; write: InspectedWriteDestination } =
          await setActiveInspectionField(store, path, cmd['value']);
        return { ok: true, data: { subject: written.subject, write: written.write } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    // THE OTHER HALF OF THE WRITE DOOR, and the only one that can express
    // byte-ABSENCE. `set-inspection-field` writes a VALUE, so reverting a prop
    // an authoring gesture APPENDED leaves an explicit `[0, 0, 0]` where the
    // source carried nothing — the file ends one attribute heavier than it
    // started and no byte-level round trip can close. The human revert arrow
    // has reached `io.remove` since it shipped; the control API had no door at
    // all, which made every agent-driven edit/revert unverifiable at byte
    // level on lanes that were in fact healthy.
    //
    // Same io, same persistence pipe, same awaited per-edit ack as `set`.
    case 'remove-inspection-field': {
      try {
        const path = cmd['path'];
        if (typeof path !== 'string' || path.trim() === '') {
          throw new Error('remove-inspection-field requires a non-empty field path.');
        }
        const removed: { subject: InspectedInspection; write: InspectedWriteDestination } =
          await removeActiveInspectionField(store, path);
        return { ok: true, data: { subject: removed.subject, write: removed.write } };
      } catch (error) {
        // A LANE WITH NO REMOVAL DOOR IS NOT A FAILED REMOVAL, and the caller
        // has to be able to tell them apart without matching prose: an
        // instrument grades the first UNVERIFIABLE (an unreached seam) and the
        // second FAILED (a removal that ran and left the bytes changed).
        if (error instanceof InspectionRemovalUnavailableError) {
          return { ok: false, error: error.message, data: { code: 'REMOVAL_UNAVAILABLE' } };
        }
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    // THE STRUCTURE OPS over the control API — the same operations the
    // hierarchy row's context menu performs, on the same
    // `authoring/consumer-actions.ts` helpers, so there is one implementation
    // and not a second that can disagree with the menu.
    //
    // A COMMAND VERB rather than inspector `quickActions` deliberately:
    // `inspect().quickActions` reports the verbs a human sees on the
    // inspector's identity row, and a dozen structure icons there would be
    // either a UI redesign or a list of actions nobody can see — both worse
    // than transcribing what the component verbs already established for
    // exactly this gap (`@vgai/game/contributions/component-verbs.command.ts`,
    // which is where `extract-component`/`fork-component` live now).
    //
    // `id`/`ids` default to the current selection, the menu's own subject. An
    // op the active adapter does not provide answers `ok: false` naming it,
    // never a silent no-op.
    case 'structure-op': {
      try {
        const op = String(cmd['op'] ?? '');
        // THE ACTIVE DOCUMENT'S ADAPTER AND ITS SELECTION, which is the pair
        // every other consumer of this seam already reads (`editor-hotkeys.ts`'s
        // `actionSelectionIds`, the hierarchy panel, `editor.status()`). This
        // case read `getActiveAuthoring` + the SHELL store instead, so on a
        // document whose adapter owns its own selection — the Blender Model
        // document, whose Outliner publishes Blender row ids — it refused with
        // "the active authoring adapter exposes no structure provider" while
        // the document's own adapter had one and the panel was drawing its
        // selection (measured 2026-09-21: `editor.structure('duplicate')` on a
        // selected Torus, B6's last named leftover).
        const adapter = resolvePanelAuthoring(store).adapter;
        const selected = activeSelectionIds(store);
        const ids = Array.isArray(cmd['ids'])
          ? (cmd['ids'] as unknown[]).filter((v): v is string => typeof v === 'string')
          : typeof cmd['id'] === 'string' && cmd['id'].trim() !== ''
            ? [cmd['id']]
            : selected;
        const first = ids[0];
        const needsId = (): string => {
          if (!first) throw new Error(`structure-op "${op}" needs an id or a selected row.`);
          return first;
        };
        const optional = (key: string): string | undefined =>
          typeof cmd[key] === 'string' && (cmd[key] as string).trim() !== ''
            ? (cmd[key] as string)
            : undefined;
        const structure = adapter.structure;
        if (!structure) {
          return {
            ok: false,
            error: 'structure-op: the active authoring adapter exposes no structure provider.',
          };
        }
        switch (op) {
          case 'create': {
            const kind = optional('kind');
            if (!kind) return { ok: false, error: 'structure-op "create" needs a `kind`.' };
            const created = createAuthoringNode(adapter, kind, optional('parentId'));
            return { ok: true, data: { id: created.id, write: await created.ack } };
          }
          case 'delete': {
            const write =
              ids.length > 1 && structure.removeMany
                ? await removeManyAuthoringNodes(adapter, ids)
                : await removeAuthoringNode(adapter, needsId());
            return { ok: true, data: { write } };
          }
          case 'duplicate': {
            if (ids.length > 1 && structure.duplicateMany) {
              const write = await duplicateManyAuthoringNodes(adapter, ids);
              return { ok: true, data: { write } };
            }
            const copy = duplicateAuthoringNode(adapter, needsId());
            return { ok: true, data: { id: copy.id, write: await copy.ack } };
          }
          case 'reparent': {
            const parentId = optional('parentId') ?? null;
            return {
              ok: true,
              data: { write: await reparentAuthoringNode(adapter, needsId(), parentId) },
            };
          }
          case 'reorder': {
            if (!structure.reorder) {
              return { ok: false, error: 'structure-op: this adapter has no `reorder`.' };
            }
            const before = optional('beforeSiblingId') ?? null;
            return {
              ok: true,
              data: { write: await reorderAuthoringNode(adapter, needsId(), before) },
            };
          }
          case 'wrap': {
            if (!structure.wrap) {
              return { ok: false, error: 'structure-op: this adapter has no `wrap`.' };
            }
            return {
              ok: true,
              data: { write: await wrapAuthoringNode(adapter, needsId(), optional('tag')) },
            };
          }
          case 'unwrap': {
            if (!structure.unwrap) {
              return { ok: false, error: 'structure-op: this adapter has no `unwrap`.' };
            }
            return { ok: true, data: { write: await unwrapAuthoringNode(adapter, needsId()) } };
          }
          case 'group': {
            if (!structure.group) {
              return { ok: false, error: 'structure-op: this adapter has no `group`.' };
            }
            const grouped = groupAuthoringNodes(adapter, ids);
            return { ok: true, data: { id: grouped.id, write: await grouped.ack } };
          }
          case 'ungroup': {
            if (!structure.ungroup) {
              return { ok: false, error: 'structure-op: this adapter has no `ungroup`.' };
            }
            const ungrouped = ungroupAuthoringNode(adapter, needsId());
            return { ok: true, data: { ids: ungrouped.ids, write: await ungrouped.ack } };
          }
          case 'copy': {
            if (!structure.copy) {
              return { ok: false, error: 'structure-op: this adapter has no `copy`.' };
            }
            return { ok: true, data: { copied: await copyAuthoringNodes(adapter, ids) } };
          }
          case 'cut': {
            if (!structure.cut) {
              return { ok: false, error: 'structure-op: this adapter has no `cut`.' };
            }
            const outcome = await cutAuthoringNodes(adapter, ids);
            return outcome === false
              ? { ok: false, error: 'structure-op "cut" was refused by the adapter.' }
              : { ok: true, data: { write: outcome } };
          }
          case 'paste': {
            if (!structure.paste) {
              return { ok: false, error: 'structure-op: this adapter has no `paste`.' };
            }
            const parentId =
              optional('parentId') ??
              (first ? (adapter.hierarchy.node(first)?.parentId ?? null) : null);
            const outcome = await pasteAuthoringNodes(adapter, parentId);
            return outcome === false
              ? { ok: false, error: 'structure-op "paste" was refused by the adapter.' }
              : { ok: true, data: { write: outcome } };
          }
          default:
            return {
              ok: false,
              error:
                `structure-op: unknown op ${JSON.stringify(op)}. Known ops: create, delete, ` +
                'duplicate, reparent, reorder, wrap, unwrap, group, ungroup, copy, cut, paste.',
            };
        }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'document-probe': {
      // `editor.document.*` — the scoped editor-chrome door. Every refusal
      // (no active document, unmounted surface, target outside the scope)
      // comes back as the step's own honest error text, because the scope
      // NAME is the useful half of the answer
      // (`editor-document-probe.ts`'s header).
      try {
        const result = await runDocumentProbe(cmd['step'] as DocumentProbeStep);
        return { ok: true, data: { ...result } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'capture-active-document': {
      const requested = captureSizeFromCommand(cmd);
      if ('error' in requested) return { ok: false, error: requested.error };
      try {
        if (cmd['view']) await presentEditorView(store, cmd['view'] as EditorView);
        const capture = await captureActiveEditorDocument(store, requested.size);
        return { ok: true, data: { ...capture } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'capture-editor-chrome': {
      // The editor PAGE itself — see `editor-chrome-capture.ts`. The page is
      // photographed at its own LAYOUT; `scale` chooses only how many output
      // pixels one CSS pixel becomes, defaulting to the display's own ratio.
      // A stroke weight compared against a 2x reference needs `scale: 2`.
      const scale = cmd['scale'];
      if (scale !== undefined && (typeof scale !== 'number' || !(scale > 0) || scale > 4)) {
        return {
          ok: false,
          error:
            'capture-editor-chrome: "scale" must be a number greater than 0 and no more than 4 ' +
            '(output pixels per CSS pixel; the frame crosses the relay as base64 PNG). ' +
            "It defaults to the page's own devicePixelRatio.",
        };
      }
      try {
        const capture = await captureEditorChrome(
          store,
          scale === undefined ? undefined : { scale },
        );
        return { ok: true, data: { ...capture } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case 'capture-viewport': {
      // Fresh, unthrottled on-demand capture (see EditorShellStore.captureViewportImage's
      // doc comment) — distinct from the periodic autosave thumbnail the
      // project-thumbnail snapshot path serves. `size` is optional; defaults
      // to the store's standard thumbnail size.
      const requested = captureSizeFromCommand(cmd);
      if ('error' in requested) return { ok: false, error: requested.error };
      // AN ADOPTED SCENE IS PRESENTED BY ITS ADOPTER. The store's renderer and camera
      // are its own viewport's; re-rendering a scene another document adopted through
      // them came back white. What the person sees is that document's own frame.
      if (store.hasAdoptedScene) {
        try {
          const capture = await captureActiveEditorDocument(store, requested.size);
          return { ok: true, data: { base64: capture.base64, mimeType: capture.mimeType } };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
      const dataUrl = store.captureViewportImage(requested.size);
      if (!dataUrl) {
        // The refusal names the MECHANISM and the door that does answer.
        // "Viewport is not bound yet" alone was true and useless over a live
        // canvas or ingest session: this door photographs the editor's own
        // THREE viewport, which a canvas-surface world never binds — so the
        // reader waited for a binding that was never coming instead of
        // reaching for the capture that was already available.
        return {
          ok: false,
          error:
            "This door photographs the editor's own three.js Scene viewport, and nothing has bound one " +
            '(no renderer/scene/camera). A canvas-surface world (a first-party canvas root, or a ' +
            'PixiJS/Phaser/Babylon ingest) never binds it — it draws on its own canvas in the Game ' +
            'document. Capture that through `capture-active-document` (`editor.captureActiveDocument()`) ' +
            `or the running game through \`bridge-screenshot\` (${commandLine('screenshot')}).`,
        };
      }
      const comma = dataUrl.indexOf(',');
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      return { ok: true, data: { base64, mimeType: 'image/png' } };
    }
    case 'capture-asset-preview':
      return handleAssetPreviewCommand(store, cmd);
    /**
     * OPEN one piece of the adapter's scene table by id — the table's ONE
     * `open` verb (ARCHITECTURE-CORE §Editor). One verb for a scene, a prefab,
     * or a story state, because the table makes them siblings: they differ only
     * in instance site.
     *
     * TWO CLIENTS, one verb. With a game LIVE in this session the live half
     * answers first (`scene-live-open.ts`): the running game IS the surface, so
     * a `game-contract` scene is opened by asking the game to navigate and a
     * `root-mount` scene by showing the document it draws into. It answers
     * `null` for the reaches that are the Edit workspace's
     * (`components/scene-documents.tsx`), which then runs unchanged.
     *
     * Both halves answer from the SAME declared field — the live half switches
     * on `entry.reach.kind`, and the Edit half's `liveReach` is derived from
     * `entry.reach` alone (`scene-document-plan.ts`'s `liveReachOf`).
     * `authorable` decides the Edit DOCUMENT and nothing else — it is not asked
     * here, because whether a running game can be sent to one of its own screens
     * is the game's contract to answer, not the host's opinion of whether that
     * screen is authorable.
     *
     * The two halves agree about every reach the live half REACHES:
     * `liveReach` is `'game-contract' | 'root-mount' | 'entrypoint-selection'`,
     * exactly the set that ends `ok: true` there when the session can honour
     * it, so with nothing running both refuse as
     * `SCENE_NAVIGATION_NOT_RUNNING` rather than as a dead end.
     * A session with no remount seam still refuses `entrypoint-selection`
     * as `SCENE_NOT_OPENABLE_LIVE` — that is a session fact, not a reach
     * fact.
     *
     * Every refusal is CODED, because the classes are graded differently and
     * prose cannot separate them: `SCENE_NOT_FOUND` names the ids that DO
     * exist, `SCENE_NOT_OPENABLE` quotes the adapter's own declared reason
     * verbatim rather than paraphrasing a claim about someone else's game, and
     * `SCENE_NAVIGATION_NOT_RUNNING` says the scene is live-only rather than
     * unreachable.
     */
    // The document table the host resolved (ARCHITECTURE-CORE §The project
    // model, "Documents, not scenes"), as the wire projection `getState`
    // already carries. A COMMAND rather than a state read so a standing
    // document that lists the table (a production's Shots bin) is driven the
    // same way every other surface is.
    case 'document-table': {
      const facet = projectAdapterFacet();
      if (!facet) {
        return {
          ok: false,
          error: 'The project adapter has not resolved yet — no document table to list.',
          data: { code: 'SCENE_TABLE_UNAVAILABLE' },
        };
      }
      return {
        ok: true,
        data: {
          default: facet.scenes.default ?? null,
          entries: facet.scenes.entries,
          pending: facet.documentsPending === true,
        },
      };
    }

    case 'open': {
      const id = cmd['id'];
      if (typeof id !== 'string' || id.trim() === '') {
        return { ok: false, error: 'open requires a non-empty scene-table entry id.' };
      }
      // Play's `open()` is live navigation. Edit's `open()` is the tab row —
      // an ingest mount is not Play (ARCHITECTURE-CORE: every authorable scene
      // is an Edit document). Routing ingest through the live half is how
      // opening GameScreen put the Play document up.
      // A deferred ingest run is a real Play SESSION even though it does not
      // allocate `play-mode.ts`'s first-party session object. Use the shared
      // mode predicate so opening an adapter scene reaches that running game's
      // contract instead of silently falling back to its Edit document.
      const liveGame = editorIsPlaying();
      // An entry whose KIND has its own document editor (a model, a machine, a page) opens in
      // that editor during Play too; only the rest navigate the running game.
      const entry = liveGame
        ? projectAdapterFacet()?.scenes.entries.find(
            (candidate) => candidate.id === id && documentContributionForKind(candidate.kind) === undefined,
          )
        : undefined;
      // The running lane's own remount (Play), asked of the live
      // registry so this verb names no lane.
      const remountSelection = liveGame
        ? async (args: { selection: string; key: string; regionId: string }) =>
            (await remountLiveSelection(args)) ?? {
              ok: false as const,
              error: 'No running lane can remount with a selection.',
            }
        : undefined;
      const live = entry
        ? await openLiveSceneEntry(entry, {
            scenes: liveScenes,
            activateGameDocument: () => activateWorkspaceDocument(GAME_DOCUMENT_ID),
            gameDocumentId: GAME_DOCUMENT_ID,
            ...(remountSelection ? { remountSelection } : {}),
          })
        : null;
      const opened = live ?? (await openSceneTableEntryWhenListed(id));
      return opened.ok
        ? {
            ok: true,
            data: {
              documentId: opened.documentId,
              title: opened.title,
              ...('scene' in opened && opened.scene ? { scene: opened.scene } : {}),
              ...('restart' in opened && opened.restart ? { restart: true } : {}),
            },
          }
        : {
            ok: false,
            error: opened.error,
            data: {
              code: opened.code,
              ...(opened.known === undefined ? {} : { known: [...opened.known] }),
            },
          };
    }

    // Display — set semantics (only toggle when value differs)
    case 'set-grid': {
      const documentSession = activeObject3DDocumentSession();
      if (documentSession) documentSession.setGrid(cmd['enabled'] as boolean);
      else if (store.showGrid !== (cmd['enabled'] as boolean)) store.toggleGrid();
      break;
    }
    // Helpers and the stats tile are per-STAGE view options, read by the
    // focused stage's own viewport and its overlay set (ARCHITECTURE-CORE
    // §One stage unit 4) — the same reason `set-grid` above already asks the
    // active document's session. A verb that wrote the shell's copy while the
    // person was looking at a model document would toggle nothing they can see.
    case 'set-helpers': {
      const stage = focusedStageStore(store);
      if (stage.showHelpers !== (cmd['enabled'] as boolean)) stage.toggleHelpers();
      break;
    }
    case 'set-stats': {
      const stage = focusedStageStore(store);
      if (stage.showStats !== (cmd['enabled'] as boolean)) stage.toggleStats();
      break;
    }
    case 'set-shading-mode':
      if (activeObject3DDocumentSession()) {
        activeObject3DDocumentSession()?.setMode(cmd['mode'] as ViewportShadingMode);
      } else {
        store.setShadingMode(cmd['mode'] as ViewportShadingMode);
      }
      break;
    case 'set-helper-type': {
      const stage = focusedStageStore(store);
      const helperType = cmd['helperType'] as keyof HelperVisibility;
      const documentSession = activeObject3DDocumentSession();
      if (documentSession && helperType === 'bounds') {
        documentSession.setBounds(cmd['enabled'] as boolean);
        break;
      }
      if (documentSession && helperType === 'skeletons') {
        documentSession.setSkeleton(cmd['enabled'] as boolean);
        break;
      }
      if (stage.helperVisibility[helperType] !== (cmd['enabled'] as boolean)) {
        stage.toggleHelperType(helperType);
      }
      break;
    }

    // Transform tools — set semantics
    case 'set-transform-mode':
      store.setTransformMode(cmd['mode'] as 'combined' | 'translate' | 'rotate' | 'scale');
      break;
    case 'set-transform-space':
      store.setTransformSpace(cmd['space'] as 'world' | 'local');
      break;
    case 'set-snap':
      if (store.snapEnabled !== (cmd['enabled'] as boolean)) store.toggleSnap();
      break;

    // The REPL door over the ACTIVE document's published context — Edit mode,
    // no play gate (`document-context-registry.ts`).
    case 'document-script':
      return handleDocumentScript(cmd);

    // Version-skew honesty (the false-ack fix):
    // every unrecognized command type used to fall through to `return {ok:
    // true}` below — a silent lie: the browser did NOTHING, but the SDK/CLI
    // caller was told it succeeded. Reporting a structured failure must hold
    // for ANY unrecognized `type`, not just the ones known about today. The
    // `data.code` marker is what the SDK maps to its `*_UNSUPPORTED` codes;
    // the prose is for humans only.
    default: {
      // Unreachable: `isRelayCommandType` above already answered for anything
      // outside the table. This assignment is the EXHAUSTIVENESS CHECK — it
      // compiles only while every row of `RELAY_COMMANDS` has a case here.
      const unhandled: never = commandType;
      return {
        ok: false,
        error: `unknown command type "${String(unhandled)}" — editor page predates this CLI`,
        data: { code: 'UNKNOWN_COMMAND_TYPE' },
      };
    }
  }

  return { ok: true };
}

/**
 * Connect the command listener to the editor server's SSE stream.
 * Dispatches incoming commands to the store and play-mode functions.
 * Reports state after each command and on initial connect.
 */
export function connectCommandListener(
  store: EditorShellStore,
  /**
   * The session's own undo/redo queue — the SAME object the keyboard shortcut
   * and the command palette drive, so a relayed undo is the user's undo and not
   * a second path into history. Omitted by the isolated component tests that
   * only need the listener's transport half; the verbs then refuse by name
   * rather than reaching for `store.projectHistory` behind the queue's back.
   */
  history?: HistoryCommands,
): () => void {
  // Browser mode (Phase A2): the `vgai` CLI control channel is server-only (it
  // is an SSE command stream + state POSTs to `/__editor/*`, which do not exist
  // without a Node server). Skip it — otherwise the EventSource retry-loops
  // against a 404 and every `reportEditorState` POSTs into the void.
  const source = connectEvents();

  // The last FULL snapshot this page sent. Every report on a user's critical
  // path reuses its derived facets rather than re-deriving them — see
  // `state-report-deferral.ts` for the measurement that bought this.
  let lastFullState: Record<string, unknown> | null = null;
  /**
   * The store's `contentVersion` at the moment `lastFullState` was collected.
   *
   * The facets `collectState` is allowed to REUSE are the tree-scale ones — the
   * hierarchy rows and the capability grading. When the store notifies with
   * nothing but a selection change, `contentVersion` holds still, and every
   * reused facet in `lastFullState` is therefore already current: scheduling a
   * full re-derivation to "make it current again" re-derives an answer it
   * already has. Measured at N=20000 on the canvas lane as a 54-70ms
   * `IdleRequestCallback @ command-listener.ts` block after EVERY click.
   */
  let lastFullContentVersion = -1;
  // One entry per read-only debug proof in the CURRENT adapter epoch. The epoch is in the key, so
  // remounts naturally pay for (and publish) their own first proof while repeated clock/snapshot
  // polls reuse the full report that already contains the identical verdict.
  const reportedDebugReadProofs = new Set<string>();
  /**
   * A Play scene transition is a burst, not one store notification. The
   * translated FPS measured 4,523 hierarchy objects and several asynchronous
   * React commits between `unity.load_scene.MainScene` returning and the tree
   * becoming quiescent. Re-deriving on every notification caused 325-430ms
   * main-thread blocks and eventually starved the command relay; deriving on
   * the command's first notification left the cached hierarchy at IntroMenu.
   *
   * Arm exactly one refresh for the burst and move it behind a short quiet
   * window. Once it lands, ordinary runtime structure, input, state polling,
   * presence and store reports cannot arm another one. A later explicit game
   * command/read or Play boundary can arm the next transition honestly.
   */
  let playFullReportArmed = false;
  let playSettleTimer: ReturnType<typeof setTimeout> | null = null;
  let playCommandContentVersion: number | null = null;
  let playCommandContentTimer: ReturnType<typeof setTimeout> | null = null;
  // A tombstone stops POSTing snapshots too. `vgai status` reads the server's
  // last snapshot, so a corpse that kept reporting would keep MINTING
  // fresh-looking state for a session that no longer exists — the exact
  // impersonation the tombstone latch exists to end.
  const reportLatestState = () => {
    if (sessionEndedState() !== null) return;
    lastFullState = collectState(store);
    lastFullContentVersion = store.contentVersion;
    void reportEditorState(lastFullState);
  };
  let cancelDeferredFullReport: (() => void) | null = null;
  const cancelPlaySettledFullReport = () => {
    if (playSettleTimer !== null) {
      clearTimeout(playSettleTimer);
      playSettleTimer = null;
    }
    cancelDeferredFullReport?.();
    cancelDeferredFullReport = null;
  };
  const clearPlayCommandContentCandidate = () => {
    playCommandContentVersion = null;
    if (playCommandContentTimer !== null) clearTimeout(playCommandContentTimer);
    playCommandContentTimer = null;
  };
  const schedulePlaySettledFullReport = () => {
    clearPlayCommandContentCandidate();
    playFullReportArmed = true;
    cancelPlaySettledFullReport();
    playSettleTimer = setTimeout(() => {
      playSettleTimer = null;
      cancelDeferredFullReport = scheduleDeferredFullReport(() => {
        cancelDeferredFullReport = null;
        playFullReportArmed = false;
        reportLatestState();
      });
    }, 250);
  };
  const armPlayCommandContentCandidate = (baseline: number) => {
    if (store.contentVersion !== baseline) {
      schedulePlaySettledFullReport();
      return;
    }
    clearPlayCommandContentCandidate();
    playCommandContentVersion = baseline;
    playCommandContentTimer = setTimeout(clearPlayCommandContentCandidate, 1_000);
  };
  const editorIsActivelyPlaying = () => editorIsPlaying() && store.playState === 'playing';
  const settleUnscopedPlayCommandRefresh = (commandStartContentVersion: number | null) => {
    if (commandStartContentVersion !== null) {
      // A successful relayed command whose declared policy still owes a
      // derived refresh must not disappear merely because it does not carry
      // one of the special debug-invoke transition scopes above. Read commands
      // reach here only when contentVersion moved; `always` mutation/boundary
      // commands reach here by declaration. Ordinary store notifications have
      // no command baseline and remain cheap during Play.
      schedulePlaySettledFullReport();
    } else if (
      playCommandContentVersion !== null &&
      store.contentVersion !== playCommandContentVersion
    ) {
      schedulePlaySettledFullReport();
    } else if (playFullReportArmed && store.contentVersion !== lastFullContentVersion) {
      // A transition already earned one refresh. Keep moving that ONE
      // refresh behind the mount burst; this does not arm periodic work.
      schedulePlaySettledFullReport();
    }
  };
  const handledByPlayReportGate = (
    playFullReport: CompletedCommandRefresh['playFullReport'],
    commandStartContentVersion: number | null,
    derivedRefresh: RelayCommandDerivedRefresh,
  ): boolean => {
    if (!editorIsActivelyPlaying()) return false;
    if (
      !playCommandOwesDerivedRefresh(
        derivedRefresh,
        playFullReport,
        store.contentVersion,
        lastFullContentVersion,
      )
    )
      return true;
    if (playFullReport === 'explicit') {
      schedulePlaySettledFullReport();
    } else if (playFullReport === 'if-content-changed') {
      armPlayCommandContentCandidate(commandStartContentVersion ?? store.contentVersion);
    } else settleUnscopedPlayCommandRefresh(commandStartContentVersion);
    return true;
  };
  /**
   * Report NOW with everything cheap fresh, and make the expensive halves
   * current in the background.
   *
   * This is the path every interaction takes. The immediate POST is what keeps
   * the "UI Play/Stop is visible to `vgai status` immediately" contract and
   * every other same-tick freshness promise in this file — playState, loop
   * liveness, selection, save state, presence and the error channels are all
   * derived fresh here. What it does NOT do is re-walk the hierarchy and
   * re-grade every capability on the frame the user clicked; a single deferred
   * full collect does that once, however many changes arrived in the burst.
   */
  const reportCurrentState = (
    /**
     * `'if-content-changed'` skips the deferred full re-derivation when the
     * store's `contentVersion` has not moved since the last full collect —
     * see `lastFullContentVersion`. ONLY the store-notification path may ask
     * for it: every other trigger here (restart-required, the ingest capture
     * wait, the adapter load, focus/blur, a completed command) can change a
     * reused facet WITHOUT any store notification at all, and the store's
     * version knows nothing about them.
     */
    derivedRefresh: RelayCommandDerivedRefresh = 'always',
    playFullReport: CompletedCommandRefresh['playFullReport'] = 'none',
    commandStartContentVersion: number | null = null,
  ) => {
    if (sessionEndedState() !== null) return;
    if (lastFullState === null) {
      // Nothing to reuse yet — the honest floor is to pay for a real collect
      // rather than report a fabricated or empty derivation.
      reportLatestState();
      return;
    }
    const state = collectState(store, lastFullState);
    lastFullState = state;
    void reportEditorState(currentStatePatch(state));
    if (derivedRefresh === 'none') return;
    if (handledByPlayReportGate(playFullReport, commandStartContentVersion, derivedRefresh)) return;
    // Pause/stop leave a complete, stable surface and must publish it. Any
    // pending Play refresh is superseded by this non-presenting full report.
    cancelPlaySettledFullReport();
    clearPlayCommandContentCandidate();
    playFullReportArmed = false;
    if (
      derivedRefresh === 'if-content-changed' &&
      store.contentVersion === lastFullContentVersion
    ) {
      return;
    }
    if (cancelDeferredFullReport !== null) return;
    cancelDeferredFullReport = scheduleDeferredFullReport(() => {
      cancelDeferredFullReport = null;
      reportLatestState();
    });
  };
  let storeReportScheduled = false;
  /** A burst that included any trigger OTHER than a store notify takes the
   *  deferred full refresh unconditionally — see `reportCurrentState`'s
   *  `derivedRefresh` argument for why the store's version cannot speak for
   *  those. Widening, never narrowing: one such trigger in a burst is enough. */
  let storeReportNeedsFullRefresh = false;
  let reportedStorePlayState = store.playState;
  const scheduleStateReport = (needsFullRefresh: boolean) => {
    // One editor action commonly emits several store notifications. Collapse
    // that synchronous burst into one current snapshot without delaying it a
    // frame — UI Play/Stop must be visible to `vgai status` immediately even
    // though no relayed command caused the transition.
    if (needsFullRefresh) storeReportNeedsFullRefresh = true;
    if (storeReportScheduled) return;
    storeReportScheduled = true;
    queueMicrotask(() => {
      storeReportScheduled = false;
      const forceRefresh = storeReportNeedsFullRefresh;
      storeReportNeedsFullRefresh = false;
      const playBoundary = reportedStorePlayState !== store.playState;
      reportedStorePlayState = store.playState;
      reportCurrentState(
        forceRefresh ? 'always' : 'if-content-changed',
        playBoundary && store.playState === 'playing' ? 'explicit' : 'none',
      );
    });
  };
  const reportStoreChange = () => scheduleStateReport(false);
  const reportExternalChange = () => scheduleStateReport(true);
  const unsubscribeStoreReport = store.subscribe(reportStoreChange);
  // R1 — restart-required transitions don't flow through the store (they
  // have their own listener set in play-mode.ts), but `vgai status` readers
  // need `restartRequired` fresh even when NO editor command caused the
  // change (an external agent editing an R3F entry mid-play is exactly the
  // silent-staleness case R1 closes). Re-POST state on every transition.
  const unsubscribeRestartReport = subscribeLiveSessions(reportExternalChange);
  // Same reason, for the ingest capture wait: it starts and ends outside any
  // store notification (a mount awaiting its game's first frame), and on a
  // hidden tab it can hold for as long as the human is away. Without this the
  // server's snapshot would predate the wait entirely, so `vgai status` would
  // answer "nothing is ingested" for a mount that is very much in flight. The
  // wait's OTHER transition — parked↔running as the tab hides and shows —
  // already re-POSTs through `reportPresence`'s `visibilitychange` listener.
  // Same reason again, for the project's ADAPTER: it loads asynchronously at
  // editor init and on project switches, outside any store notification. The
  // adapter facet is the proof that a project's `vgai.adapter.ts` (or the
  // declared native default) loaded at all, so a snapshot that predates the
  // load would answer "no adapter" for one that is loaded and live.
  const unsubscribeAdapterReport = subscribeProjectAdapter(reportExternalChange);
  // A viewport's first completed frame also lands outside the store. Report
  // it proactively so remote readers can poll the server-held state instead
  // of injecting no-op `active-tab` commands while a large board is rendering.
  const unsubscribeViewportActivationReport =
    subscribeViewportActivationTimings(reportExternalChange);

  // Report initial state
  reportLatestState();
  // …and the standing fact the state snapshot cannot carry: this page is now
  // running a command listener. Before this, a page that beat but never got
  // here was indistinguishable from a healthy one until somebody sent a
  // command and watched it hang. See `reportCommandListener`.
  void reportCommandListener(true);
  // The other standing fact of that shape: which step of a play boot this page
  // is inside. Wired HERE because this is the module that owns "facts this page
  // reports upstream", and because a phase is only useful to a reader who can
  // also see the command it explains. See `play-boot-phase.ts`.
  setPlayBootPhaseReporter(reportPlayBootPhase);

  // And again on every RE-open. The server drops a tab's health snapshot
  // when its connection goes, and a tab with no health is deliberately never
  // chosen as the command controller (`editor-sse.ts`'s `selectedController`:
  // an identified tab that has not reported yet is connected but not
  // command-ready). Without this, a reconnect — the control socket's backoff
  // after any blip — left the tab uncontrollable until the next store
  // change, presence event, or command happened to fire.
  source.addEventListener('open', () => {
    // A reconnect is transport state, not a project mutation. In Play, a full
    // reconnect collect was enough to stall a large world and provoke another
    // disconnect; reuse the last honest derived facets and publish the cheap
    // liveness/presence fields immediately.
    reportCurrentState('if-content-changed');
    // Listener readiness belongs to the PAGE, but the server deliberately
    // drops its cached proof when this page has no connection left. Re-prove
    // it on the successor connection instead of leaving status at
    // `not attached` until some unrelated state transition happens.
    void reportCommandListener(sessionEndedState() === null);
  });

  // A page whose session has ENDED must leave the bijection's account of live
  // tabs rather than sit in it answering probes. Reporting the listener
  // detached is exactly the fact `server/server-utils.ts`'s
  // `commandListenerHealth` already prints per tab (`not attached`), so the
  // server's own tab table names the corpse without a second liveness notion
  // beside it. The `resume` branch of the lease's recovery re-attaches.
  const unsubscribeTombstone = onSessionEndedChange((state) => {
    void reportCommandListener(state === null);
  });

  source.addEventListener('editor-command', (e: MessageEvent) => {
    try {
      const cmd = JSON.parse(e.data as string) as EditorCommand;
      const requestId = cmd._requestId;
      const commandStartContentVersion = store.contentVersion;
      // A tombstone answers, and what it answers is a REFUSAL naming its state.
      // Silence here would be worse than the defect: the caller would wait out
      // its whole budget and then be told the tab did not respond — a sentence
      // about a healthy tab, for a page that is dead.
      const tombstone = sessionEndedState();
      if (tombstone !== null) {
        const error = sessionEndedRefusal(tombstone, String(cmd['type']));
        if (requestId) void reportCommandResult(requestId, false, error);
        return;
      }
      // Receipt FIRST, before any work: it answers "this tab's command
      // listener is running", which is the one thing the relay cannot observe
      // and the thing a long-budget command (`play`'s 120s) otherwise spends
      // its whole budget failing to learn. Not awaited — the work must not
      // queue behind it. See `server/server-utils.ts`'s `RELAY_DELIVERY_ACK_MS`.
      if (requestId) void reportCommandReceived(requestId);
      let present: (() => void) | undefined;
      handleCommand(store, cmd, {
        deferPresentation: (effect) => {
          present = effect;
        },
        ...(history ? { history } : {}),
      })
        // A handler that THROWS must still answer its caller. Without this leg
        // the rejection reached only the browser's `unhandledrejection`
        // channel: the relay's caller got nothing and timed out into
        // "the tab is present … and did not respond" — which blames the tab
        // for a defect in the command — and the console capture DEDUPES a
        // repeated message, so the SECOND occurrence of the same failure left
        // the session journal completely silent. Measured 2026-08-15 on a
        // racing-game ingest mount (`capture-viewport` with a non-number
        // `size`; see `captureSizeFromCommand`).
        .catch((error: unknown) => commandThrewResult(cmd, error))
        .then((result) => {
          // Report command result back to server (so SDK/CLI gets the response)
          if (requestId) {
            const ack = reportCommandResult(
              requestId,
              result.ok,
              result.error,
              result.data,
              present !== undefined,
            );
            if (present) {
              // Do not merely queue behind the result send in the same task: wait until the original
              // caller's response has finished. Only then may a 500-row hierarchy reveal or inspector
              // preview monopolize the page's main thread. Presentation still runs after the bounded
              // receipt wait if the server vanished.
              const schedule = () => window.setTimeout(present!, 0);
              void ack.then(schedule, schedule);
            }
          } else if (present) {
            window.setTimeout(present, 0);
          }
          // The selection SET is already current even when its React presentation is deferred, so
          // this snapshot reports the applied truth without waiting for hierarchy/Inspector work
          // — nor, now, for a re-walk and re-grade of the whole project (`reportCurrentState`).
          const refresh = completedCommandDerivedRefresh(cmd, result.ok, reportedDebugReadProofs);
          reportCurrentState(refresh.derived, refresh.playFullReport, commandStartContentVersion);
        });
    } catch {
      /* ignore malformed events */
    }
  });

  // When the server switches projects, reload to pick up the new project's files
  source.addEventListener('project-changed', () => {
    window.location.reload();
  });

  // #145 — presence freshness: the state snapshot the server holds is only
  // re-POSTed after commands, so visibility/focus changes between commands
  // would go stale. Report on the three events that change presence.
  //
  // Through `reportCurrentState`, never a full collect: a focus/blur used to
  // re-derive the entire status surface on the event's own frame, which was
  // measured at 1221ms (`DOMWindow.onfocus`) and 1306ms (`DOMWindow.onblur`)
  // of main-thread block on a game-heavy project. Tabbing into the editor
  // froze it for over a second, every time, and nothing a focus changes is in
  // the expensive half.
  // Wrapped, never passed directly: this is an EVENT listener, and handing the
  // browser's `Event` straight into `reportCurrentState`'s argument would make
  // the refresh policy depend on an accident of the DOM signature.
  const reportPresence = (): void => reportCurrentState();
  document.addEventListener('visibilitychange', reportPresence);
  window.addEventListener('focus', reportPresence);
  window.addEventListener('blur', reportPresence);

  // pageErrors freshness (target-blaster friction #3): a runtime error
  // between commands must reach the server snapshot too, or `vgai status`
  // reads stale-clean. Deferred a tick so the boot-installed error-capture
  // listener (`installEditorConsoleCapture`, which feeds editorConsole — the
  // list collectPlayRunPageErrors/collectSessionErrors read) runs FIRST regardless of
  // registration order.
  const reportAfterError = () => setTimeout(reportPresence, 0);
  window.addEventListener('error', reportAfterError);
  window.addEventListener('unhandledrejection', reportAfterError);

  return () => {
    // Reported BEFORE the socket closes, so it still has a channel to travel
    // on. A teardown that also loses the connection is reported by the
    // server's own `close` handler; this is the case where the page keeps its
    // channel and stops listening.
    void reportCommandListener(false);
    cancelDeferredFullReport?.();
    cancelDeferredFullReport = null;
    if (playSettleTimer !== null) clearTimeout(playSettleTimer);
    playSettleTimer = null;
    clearPlayCommandContentCandidate();
    unsubscribeTombstone();
    unsubscribeStoreReport();
    unsubscribeRestartReport();
    unsubscribeAdapterReport();
    unsubscribeViewportActivationReport();
    document.removeEventListener('visibilitychange', reportPresence);
    window.removeEventListener('focus', reportPresence);
    window.removeEventListener('blur', reportPresence);
    window.removeEventListener('error', reportAfterError);
    window.removeEventListener('unhandledrejection', reportAfterError);
    source.close();
  };
}
