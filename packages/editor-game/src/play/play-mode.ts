import { onAssetReload } from '@volter/editor-sdk/kit/project-asset-refresh';
import { evictDreiCaches } from '../three/drei-asset-caches';
import { editorHost } from '@volter/editor-sdk/host';

/**
 * Play-mode orchestrator.
 *
 * Editor and game are fully isolated — separate canvas, renderer, and scene.
 * Play mode creates a new game canvas, launches a standalone game session,
 * and tears it all down on stop. The editor scene is never touched.
 *
 * Flow:
 *   enterPlayMode → create canvas → createGameRuntime() → game loop
 *   exitPlayMode  → game stop → remove canvas → re-enable editor
 */

import { installAdapterRuntimeBindings } from '../host/adapter-runtime-bindings';
import { getAuthoringOverride, setActiveAuthoring } from '@volter/editor-core/authoring/active-adapter';
import {
  getActiveNetworking,
  inspectedInstanceId,
  setActiveSystems,
  setInspectedInstance,
  updateInstanceSystems,
} from '@volter/editor-sdk/kit/authoring/active-systems';
import { BoundaryAuthoringAdapter } from '@volter/editor-core/authoring/boundary-authoring-adapter';
import {
  CompositeAuthoringAdapter,
  type CompositeChild,
} from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';
import { createEphemeralPersistence } from '../host/authoring/ephemeral-persistence';
import {
  EPHEMERAL_DESTINATION,
  resolvesLiveOnly,
  runWritePipe,
  type WriteAck,
} from '@volter/editor-sdk/kit/write-pipe';
import { resolveAllRootEntries } from '../host/binding-resolver';
import type { LogEntry } from '@volter/editor-sdk/kit/editor-api';
import { endLogSession, flushLogEntries, startLogSession } from '@volter/editor-sdk/kit/editor-api';
import type { ConsoleEntry } from '@volter/editor-sdk/kit/editor-console';
import {
  editorConsole,
  formatConsoleArgs,
  resumeEditorConsoleCapture,
  suspendEditorConsoleCapture,
} from '@volter/editor-sdk/kit/editor-console';
import { EDITOR_PARTICIPANT_ID, sendControl } from '@volter/editor-sdk/kit/editor-presence';
import {
  isEditorPresentationActive,
  subscribeEditorPresentationActivity,
} from '@volter/editor-sdk/kit/editor-presentation-activity';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { GAME_SURFACE_CONTAINMENT_CSS } from '../host/game-realm-page';
import { reclaimGameRealm } from '../host/game-realm-reclaim';
import { toolContributionRecording } from '@volter/editor-core/gameplay-sessions';
import {
  clearGameSurface,
  currentGameRealmMountId,
  installGatedGameGlobals,
  setGameInputGate,
  setGameSurface,
} from '../host/gated-globals';
import { hierarchyProjectionFromProjectConfig } from '@volter/editor-sdk/kit/hierarchy-projection';
import { type JournalSubject, playJournal } from '../host/history/json-history-resource';
import { isEditableTarget, setActiveScope } from '@volter/editor-sdk/kit/hotkeys';
import { projectBootstrapSettled } from '@volter/editor-core/initial-project';
import { registerGameNullSubject } from '@volter/editor-core/inspection/game-subject';
import { fetchGameManifest } from '@volter/editor-core/manifest-project';
import { registerPerformanceSource } from '@volter/editor-sdk/kit/performance-sources';
import {
  beginPlayBoot,
  endPlayBoot,
  markPlayBootPhase,
  type PlayBootPhase,
} from '@volter/editor-core/play-boot-phase';
import { presentationSurface } from '@volter/editor-sdk/kit/presentation-surface';
import { getCurrentProject } from '@volter/editor-core/project-manager';
import {
  beginProjectModuleSplitWatch,
  clearProjectModuleSplitReports,
  endProjectModuleSplitWatch,
  formatProjectModuleSplitMessage,
} from '@volter/editor-sdk/kit/project-module-split';
import { clearRootReadiness, recordRootReadiness } from '@volter/editor-sdk/kit/readiness';
import { onThreeStore } from '@volter/editor-core/shell-store-door';
import { mountedStoryHasPixiContent } from '@volter/editor-core/stories/pixi-story-model';
import { domHasRenderableContent, threeSceneHasRenderableContent } from '../host/surface-content';
import { subscribeSurfaceKeyboard, surfaceHoldsKeyboard } from '@volter/editor-sdk/kit/surface-keyboard';
import { publishToolContributionPlay } from '@volter/editor-core/tool-contribution-play';
import { liveWorldId, presentThreeRoots } from '../host/viewport-root-presentation';
import {
  cancelPendingWorkspacePlayUtilities,
  revealWorkspacePlayUtilities,
} from '@volter/editor-core/workspace-play-utilities';
import { markGameCssScope } from '@volter/editor-sdk/session/game-css-scope';
import type { EntrypointSelectionOverride } from '@volter/editor-sdk/session/project-module-url';
import { isEditorLanePath } from '@volter/editor-sdk/session/tool-contribution-convention';
import { getSeededRandom, type SeededRandom } from '@volter/game-runtime/core/seeded-random';
import { _engineLogActive } from '@volter/game-runtime/dev/logger';
import type { PerformanceProfiler } from '@volter/game-runtime/dev/performance-profiler';
import type { GameSession } from '@volter/game-runtime/runtime/create-runtime';
import {
  type DebugVirtualInputTarget,
  getDebugRegistry,
  type RunTicksOptions,
} from '@volter/game-runtime/runtime/debug-registry';
import type { GameLoop, RootInstance } from '@volter/game-runtime/runtime/game';
import type { PlaytestContext } from '@volter/game-runtime/runtime/playtest';
import { runTicksWhenSettled } from '@volter/game-runtime/runtime/run-ticks-settled';
import {
  type AuthoringAdapter,
  type InspectorProvider,
  nodeKeyedPhysics,
  type TransformProvider,
} from '@volter/editor-project/adapter';
import { assertNever } from '@volter/editor-project/adapter/adapter-surface';
import { declaredRoots, rootById } from '@volter/editor-project/adapter/manifest-interpreter';
import { readOidSourceAnchors } from '../three/authoring/oid-source-persistence';
import { oidThree, structuralThree } from '../three/authoring/three-authoring-adapter';
import type * as THREE from 'three';
import { deviceEmulatedPixelRatio } from '../game-document/device-preview';
import { exitDeferredIngestPlay, mountDeferredIngestForPlay } from '../ingest/deferred-ingest-play';
import { getIngestPlayControl } from '../ingest/ingest-play-control';
import { withPlayBootStallGuard } from './play-boot-stall';
import { debugEventsToLogEntries } from './play-log-events';
import { bindPlayRecordingStop, endPlayRecording } from './play-recording';
import { createReactPlayAuthoringAdapter } from './react-play-live-authoring';

/** Context needed by the orchestrator (passed from the world root's stage). */
export interface PlayModeContext {
  store: EditorShellStore;
  /** Container for the game canvas (the Game tab panel). */
  gameContainer: HTMLElement;
}

/**
 * THE MOUNTED INSTANCE of this project — the thing that used to be a scatter
 * of module-level `let`s all silently meaning "the one game".
 *
 * This layer knows about mounts, and about nothing a game means by them. An
 * instance is one mount: its own module graph, realm, renderer and session.
 * Two of them is how a multiplayer game gets verified, but equally how you A/B
 * two seeds or watch one scene from two camera rigs — so the vocabulary is the
 * one the rest of the codebase already uses (`active-systems.ts`'s
 * `_byInstance`/`systemsForInstance`), and naming this after any single
 * application of it would hardcode that application into a layer that has no
 * such concept in it.
 *
 * ITS IDENTITY IS THE MOUNT ID, and there is only ever one id for it.
 * `resolveAllRootEntries` opens a mount epoch; every project module of this
 * instance is served under it as `?vgai-mount=<id>`; browser module identity
 * is per-url, so that id IS the module-graph boundary; and `gated-globals.ts`
 * resolves this instance's realm and input gate by reading the same id back
 * off the url. Registering it under any second name would be two identities
 * for one thing, and they would drift.
 *
 * WHAT IS NOT HERE IS THE POINT. Console patching, the log session and its
 * flush chain, the Escape listener, the enter queue, `playState` and the play
 * epoch stay module-scope, because they belong to the play SESSION and not to
 * an instance in it. Moving the log machinery in here would give N instances N
 * interleaved log streams and read, later, as a game bug.
 */
interface PlayInstance {
  /** The mount id — see above. What `?vgai-mount=` carries, what the realm and
   *  input gate are keyed by, what `setActiveSystems` registers under and what
   *  the session wire addresses. Empty until a composition has resolved. */
  /** The element this instance mounted into (the primary's is the live
   *  document's — `live-document.ts` owns it; read it there). */
  container: HTMLElement | null;
  id: string;
  /** A human-readable label for this instance — a HINT, never the mechanism.
   *  Defaults to "Instance 1"/"Instance 2"/… so a split view and its drivers read
   *  legibly; the ADDRESS is still the opaque mount id. A multiplayer game may
   *  choose to read it (e.g. as its own display name when it joins a room), but
   *  nothing here couples the instance to any player/network concept. */
  name: string;
  /** Container for this instance's root surfaces (the Game tab panel today). */
  session: GameSession | null;
  /** Native authored-subject presentation owned by the viewport host. */
  presentation: { readonly worldId: string; dispose(): void } | null;
  unregisterPerformanceSource: (() => void) | null;
  unsubscribeSystemAdapters: (() => void) | null;
  /** D15/T-D15.6 — whether this instance's manifest declares
   *  `determinism.seededRandom`. */
  determinismDeclared: boolean;
  resizeObserver: ResizeObserver | null;
  /** Per-world adapters built for this instance, retained so teardown can
   *  detach their history resources. */
  rootResources: AuthoringAdapter[];
  /**
   * THIS RUN's journal session — the id every adapter below journals into, and
   * the one thing `exitPlayRootAuthoring` is allowed to expire.
   *
   * Play OWNS this session (`history/json-history-resource.ts`'s ownership
   * block): a play-time edit is session-local by architecture, so pressing ■
   * must leave nothing undoable in the edit-mode stack. Edit-mode's held
   * surfaces own a DIFFERENT session (`AUTHORING_SESSION`) that no mount ends,
   * which is what lets their undo survive a remount. Empty while not playing.
   */
  journalSession: string;
}

function createPlayInstance(): PlayInstance {
  return {
    id: '',
    journalSession: '',
    name: '',
    container: null,
    session: null,
    presentation: null,
    unregisterPerformanceSource: null,
    unsubscribeSystemAdapters: null,
    determinismDeclared: false,
    resizeObserver: null,
    rootResources: [],
  };
}

/**
 * Editor play mounts one instance. Everything this file exports means THIS
 * one, which is why nothing above it has to know an instance has a name at
 * all — editor focus and addressed-instance stay different questions
 * (`active-systems.ts`).
 */
const _instance: PlayInstance = createPlayInstance();

/**
 * ADDITIONAL instances mounted beside the primary one.
 *
 * The primary (`_instance`) owns everything singular about a play session —
 * the store scene it adopts, the authoring composite, the console patch, the
 * camera transition, editor focus. An additional instance owns none of that:
 * it is a second full mount of the SAME project (its own mount id, module
 * graph, renderer and session) rendering into its own container, registered
 * under its id so the session wire can address it (`systemsForInstance(id)`),
 * and touching no singular focus state. That is what makes N instances a
 * property of the MOUNT and not of the game — two seats of a multiplayer
 * match, or one scene A/B'd under two seeds, are the same mechanism. Torn
 * down with the session by `exitPlayMode`.
 */
const _additional: PlayInstance[] = [];

/** Root ids THIS play run recorded host-mount readiness for (`readiness.ts`),
 *  so its teardown drops exactly those and never a sibling's. Empty while
 *  stopped. */
let _hostMountedReadyRootIds: readonly string[] = [];

// KEYBOARD FOCUS across split-screen instances. With one editor keyboard only
// ONE instance can be driven at a time; this is which. `null` (and any stale
// id) resolves to the primary, so the default — and the single-instance case —
// is "the primary has the keyboard", exactly as before split screen existed.
// A click on an instance's viewport routes the keyboard to it
// (`setFocusedInstance`); the input gate + InputManager for every instance read
// this, so exactly the focused one is live and the rest are inert.
let _focusedInstanceId: string | null = null;
const focusListeners = new Set<() => void>();

/** The instance the shared keyboard currently drives — the focused id when it
 *  names a LIVE instance, else the primary (an unset focus, or one whose
 *  instance was torn down, falls back so the keyboard is never orphaned). */
export function focusedInstanceId(): string {
  if (
    _focusedInstanceId &&
    (_focusedInstanceId === _instance.id ||
      _additional.some((inst) => inst.id === _focusedInstanceId))
  ) {
    return _focusedInstanceId;
  }
  return _instance.id;
}

/** The PRIMARY instance's mount id — the click target for focusing the primary
 *  viewport (`''` before a composition has resolved). */
export function primaryInstanceId(): string {
  return _instance.id;
}

export function subscribeFocusedInstance(listener: () => void): () => void {
  focusListeners.add(listener);
  return () => focusListeners.delete(listener);
}

function notifyFocusedInstance(): void {
  for (const listener of focusListeners) listener();
}

/** Route the shared editor keyboard to instance `id` (the primary or any
 * additional), and follow the ordinary engine convention that clicking a
 * viewport also makes its runtime the one shown by diagnostic instruments.
 * Re-gates every instance so only the focused one takes input. */
export function setFocusedInstance(id: string): void {
  setInspectedInstance(id);
  if (focusedInstanceId() === id) return;
  _focusedInstanceId = id;
  resyncInstanceInputs();
  notifyFocusedInstance();
}

/** Whether instance `id` should receive input right now: play is running, the
 *  Game tab is active, this instance holds keyboard focus, AND our surface
 *  holds the keyboard.
 *
 *  The fourth term is U2's, and it exists for the engine's `InputManager`
 *  specifically. `gated-globals.ts` already ANDs the same predicate into every
 *  raw `window`/`document` listener a PROJECT module registers, but
 *  `InputManager` is `@volter/game-runtime`'s — a dependency, not a project module, so
 *  the dev server's lexical shadow never covers it and it attaches to the real
 *  `window`. Under the Code-OSS frame that window also carries Monaco, so
 *  without this a keystroke meant for the source file beside the running game
 *  moves the game too. Standalone it is a constant true and nothing changes.
 *  See `@editor/surface-keyboard`. */
function instanceInputActive(id: string): boolean {
  if (!_ctx) return false;
  const { store } = _ctx;
  return (
    store.shell.playState === 'playing' &&
    store.shell.activeViewportTab === 'play' &&
    focusedInstanceId() === id &&
    surfaceHoldsKeyboard()
  );
}

/** The first-party `InputManager` for an instance, or `undefined` — a session's
 *  game handle may lack one (an ingest mount, a partial double), so resolve it
 *  defensively. */
function instanceInput(inst: PlayInstance): { setEnabled(on: boolean): void } | undefined {
  try {
    return inst.session?.game?.input;
  } catch {
    return undefined;
  }
}

/** Re-apply the enabled/disabled state of every live instance's InputManager
 *  from the current play/tab/focus predicate. Called whenever any of those
 *  change (store subscription, focus switch, an instance mounting). The raw
 *  window/document gates are closures over `instanceInputActive`, so they need
 *  no re-registration — they re-read focus on every event. */
function resyncInstanceInputs(): void {
  if (_instance.id) instanceInput(_instance)?.setEnabled(instanceInputActive(_instance.id));
  for (const inst of _additional) instanceInput(inst)?.setEnabled(instanceInputActive(inst.id));
}

/**
 * THE SURFACE TERM'S OWN EDGE. The store subscription re-gates on play/tab
 * changes and `setFocusedInstance` on focus changes, but the fourth term above
 * moves on neither: a person clicks into Monaco and nothing in the editor's own
 * state has changed. `InputManager` is a LATCHED `setEnabled`, so unlike the
 * raw gates (closures re-read per event) it has to be told. Module scope and
 * never unsubscribed on purpose — the notification is a no-op with no instances
 * mounted, and a lane-scoped subscription would have to be rebuilt on every
 * mount for a predicate that is process-wide.
 */
subscribeSurfaceKeyboard(resyncInstanceInputs);

let _ctx: PlayModeContext | null = null;
const playModeBindingWaiters = new Set<() => void>();

/** The command listener can attach before the layout binds Play. */
function waitForPlayModeBinding(): Promise<void> {
  if (_ctx) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const bound = () => {
      clearTimeout(timer);
      playModeBindingWaiters.delete(bound);
      resolve();
    };
    const timer = setTimeout(() => {
      playModeBindingWaiters.delete(bound);
      reject(
        new Error('Play mode failed to start: the editor shell did not bind within 15 seconds.'),
      );
    }, 15_000);
    playModeBindingWaiters.add(bound);
  });
}
const sessionListeners = new Set<() => void>();
const restartRequiredListeners = new Set<() => void>();
let restartRequiredReason: string | null = null;

export function getRestartRequiredReason(): string | null {
  return restartRequiredReason;
}

export function subscribeRestartRequired(listener: () => void): () => void {
  restartRequiredListeners.add(listener);
  return () => restartRequiredListeners.delete(listener);
}

export function markRestartRequired(reason: string): void {
  restartRequiredReason = reason;
  for (const listener of restartRequiredListeners) listener();
  editorHost().live.notifyChanged();
}

/**
 * The exact `[play-mode] Restart required: …` warnings this session raised.
 *
 * They are kept because the unresolved-console ledger names conditions BY
 * THEIR TEXT, and a remount is the event that resolves them: measured
 * 2026-08-29, `vgai restart` reported "↻ Restarted — session ready" while its
 * own named warning stayed in `vgai console` forever, because the ledger's
 * automatic clearing rule is a PAGE LOAD and a remount is not one — only
 * `game.reloadPage()` could silence a warning the named verb had already
 * fixed. `clearRestartRequired` now reports them resolved (ledger clearing
 * rule (c), `server/console-ledger.ts`), so the verb clears its own condition.
 */
const restartRequiredWarnings = new Set<string>();

/** Warn that a restart is required AND remember the sentence, so the restart
 *  that resolves it can retire exactly this condition. */
function warnRestartRequired(message: string): void {
  restartRequiredWarnings.add(message);
  editorConsole.warn(message, 'play-mode');
}

function clearRestartRequired(): void {
  if (restartRequiredWarnings.size > 0) {
    // The bare sentence, exactly as `editorConsole.warn` reported it — the
    // `[play-mode]` the CLI prints is rendered from `source`, not stored text.
    const conditions = [...restartRequiredWarnings].map((message) => ({
      severity: 'warn' as const,
      message,
    }));
    restartRequiredWarnings.clear();
    void sendControl('console-resolved', { conditions, by: 'play-mode' });
  }
  if (restartRequiredReason === null) return;
  restartRequiredReason = null;
  for (const listener of restartRequiredListeners) listener();
  editorHost().live.notifyChanged();
}

function notifySessionListeners(): void {
  syncPlayPresentationActivity();
  for (const listener of sessionListeners) listener();
}

export function subscribeGameSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function getGameProfiler(): PerformanceProfiler | null {
  return _instance.session?.game.profiler ?? null;
}

/**
 * Play-mode generation counter. Bumped on every enterPlayMode and every
 * exitPlayMode. enterPlayMode captures the value before its async boot and
 * re-checks it around `createGameRuntime` — if exitPlayMode (Stop/Escape) ran
 * while the runtime was still booting, the freshly-created session belongs to
 * an already-exited play and must be stopped and abandoned, NOT adopted.
 * Without this, a stop-during-boot left the store swapped onto the orphaned
 * live game scene (empty hierarchy in edit mode) with the session leaked
 * (RAF loop, Rapier world, WebGL context never released).
 */
let _playEpoch = 0;
// #146 — when the MOST RECENT play run began (ms epoch), or null before any
// run. The relay snapshot's `pageErrors` uses this as its freshness fence.
//
// PD-1: this used to be nulled by `exitPlayMode()`, which meant the errors of
// a run that FAILED became invisible the instant the failed run rolled back —
// `vgai status` reported `pageErrors: []` for a play that had just thrown, the
// exact "every diagnostic says healthy" symptom. The fence's job is to exclude
// a PREVIOUS run's noise, and the next `enterPlayMode` re-stamping it does
// that; dropping it on exit only ever hid the evidence of the last run.
let _playStartedAtMs: number | null = null;
// The CLOSING half of the same fence: when the most recent run's teardown
// finished, or null while a run is live (and before the first run).
//
// Why an end and not just a start: with an open-ended window every editor error
// logged AFTER a run stopped still counted as "during the play run", so it fell
// into the play-fenced `consoleErrors` facet — which `vgai status` renders only
// while play is live. One play run, and every later editor-frame error went
// invisible again, which is the exact defect the session-lifetime facets exist
// to close. Stamped at the END of `exitPlayMode`, so a FAILED run's errors (all
// logged before its rollback completes) stay inside the window and PD-1 above
// still holds.
let _playEndedAtMs: number | null = null;

// T6.3: install the gated window/document proxies once so the dev server's/
// browser-transpile's GAME_GLOBALS_PRELUDE (prepended to project modules) has
// something to resolve to. No-op outside a browser (headless unit tests).
installGatedGameGlobals();

/**
 * The warm-restart HMR bracket's pause/resume wrapper (§7.1 item 1 /
 * probe3-warm-restart-unpauses: the bracket used to call
 * `_instance.session.pause(); await hotReload(...); _instance.session.resume();`
 * unconditionally, so it silently un-paused a user-paused game — the UI kept
 * saying "paused" while the simulation resumed running). Fix: capture
 * whether the game was ALREADY paused from the SAME source of truth
 * `pause()`/`resume()` drive (`session.game.play.paused`, `game.ts:713`)
 * BEFORE unconditionally pausing for the reload, and only resume afterward
 * if it was not already paused — `pause()`/`resume()` are idempotent, so an
 * unconditional `pause()` up front is always safe. try/finally so a throw
 * mid-`reload()` still restores the correct pre-bracket state (a throw must
 * never leave a previously-RUNNING game stuck paused). Exported for direct
 * unit testing without any `import.meta.hot`/Vite HMR event machinery — see
 * `packages/editor/test/play-mode-warm-restart-pause.test.ts`.
 */
export async function runWarmRestartPauseBracket(
  session: GameSession,
  reload: () => Promise<void>,
): Promise<void> {
  const wasPaused = session.game.play.paused;
  session.pause();
  try {
    await reload();
  } finally {
    if (!wasPaused) session.resume();
  }
}
let _unsubStore: (() => void) | null = null;
/** Browser-mode component-source watch (Phase A2); null in server mode / stopped. */
/**
 * The authoring override that was active before THIS play session installed its
 * own (normally `null` — nothing else authors while playing today, but this
 * restores whatever was there rather than assuming null. `undefined` ⇒ this play
 * session never installed one (e.g. it bailed before adopting the scene) — exit
 * must then leave the authoring override untouched.
 */
let _priorAuthoringOverride: AuthoringAdapter | null | undefined;

/**
 * Replace an adapter's persistence surface without changing its live authoring
 * providers. Play changes are session-local for every world count (D19).
 *
 * EPHEMERAL IS A PIPE DESTINATION, not a parallel stack: the wrapped providers
 * still perform their live writes, and each one then runs the SAME
 * `resolve → write → record` pipe every other lane runs — resolving to the
 * ephemeral destination, which has no writer arm. So "discarded on stop" is an
 * ack of exactly the shape "written to src/world.tsx" is, produced the same
 * way. Letting the underlying adapter's own ack through would name a file this
 * session's edits are structurally barred from reaching.
 */
function withEphemeralPersistence(base: AuthoringAdapter): AuthoringAdapter {
  const capabilities = { ...base.capabilities, persist: false };
  const persistence = createEphemeralPersistence();
  // No `report`: a play session refusing to persist is the architecture, not a
  // surprise, and saying so on every edit would be noise. No `record` either —
  // the base adapter already closed the gesture, and a play session's history
  // is its own.
  const ephemeralAck = (): Promise<WriteAck> =>
    runWritePipe({
      resolve: () =>
        resolvesLiveOnly('play edits are session-local by architecture', EPHEMERAL_DESTINATION),
      record: () => undefined,
    });
  const baseTransforms = base.transforms;
  const transforms: TransformProvider | undefined = baseTransforms && {
    ...baseTransforms,
    get: (id) => baseTransforms.get(id),
    beginEdit: (id) => baseTransforms.beginEdit(id),
    apply: (id, t) => baseTransforms.apply(id, t),
    endEdit: (id) => {
      baseTransforms.endEdit(id);
      return ephemeralAck();
    },
    // A REMOVAL IS A WRITE, and a play session's writes are session-local by
    // architecture — so the base's door is shadowed rather than spread through.
    // Inherited unchanged, `{...baseTransforms}` would hand the running game's
    // revert straight to the source lane's attribute deleter, and a play-mode
    // gesture would delete a line of the game's own TSX. There is nothing to
    // apply live either: the value in force once a channel is absent is the
    // one the component declares, which only a remount can report.
    ...(baseTransforms.remove ? { remove: () => ephemeralAck() } : {}),
  };
  const baseInspector = base.inspector;
  const inspector: InspectorProvider | undefined = baseInspector && {
    ...baseInspector,
    properties: (id) => baseInspector.properties(id),
    get: (id, path) => baseInspector.get(id, path),
    set: (id, path, value) => {
      baseInspector.set(id, path, value);
      return ephemeralAck();
    },
    // Same reason as `transforms.remove` above: spread unchanged, the base's
    // revert arrow would delete a JSX attribute from the game's source while
    // the game is PLAYING.
    ...(baseInspector.remove ? { remove: () => ephemeralAck() } : {}),
  };
  return new Proxy(base, {
    get(target, property) {
      if (property === 'capabilities') return capabilities;
      if (property === 'persistence') return persistence;
      if (property === 'transforms' && transforms) return transforms;
      if (property === 'inspector' && inspector) return inspector;
      const value = Reflect.get(target, property, target) as unknown;
      // Preserve the original class receiver for prototype methods while the
      // Proxy itself preserves `instanceof` identity for inspector routing.
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Restore whatever authoring override (if any) was active before play started. */
function restorePriorAuthoring(): void {
  if (_priorAuthoringOverride === undefined) return;
  setActiveAuthoring(_priorAuthoringOverride);
  _priorAuthoringOverride = undefined;
}

/**
 * D19's one play authoring path for N >= 1. Every mounted root is dispatched
 * by its native surface tag to its direct live adapter. The viewport host may
 * separately present one of those native subjects; presentation never decides
 * whether the other roots exist or remain authorable. Ordinary child edits
 * stay in the LIVE world — a dom root included (`react-play-live-authoring.ts`).
 * A presented OID Three child may additionally expose the explicit
 * `transforms.sourceCommit` verb; that one user gesture is the only route from
 * this Play adapter back to source.
 *
 * THIS FUNCTION AWAITS (the canvas branch dynamic-imports five modules), and
 * `exitPlayMode` is synchronous — so a Stop landing mid-await runs the whole
 * play teardown, INCLUDING `restorePriorAuthoring` (which consumes
 * `_priorAuthoringOverride`), and then this function resumes and installs play
 * authoring over the just-restored edit authoring, with nothing left able to
 * undo it. `isCurrentGeneration` is the guard: it is re-read after the awaits
 * and before anything is committed, and the adapters built so far are disposed
 * on the abort path rather than stranded.
 */
async function installPlayRootAuthoring(
  store: EditorShellStore,
  roots: readonly RootInstance[],
  manifest: Awaited<ReturnType<typeof fetchGameManifest>>,
  presentedWorldId: string | null,
  isCurrentGeneration: () => boolean,
): Promise<void> {
  _priorAuthoringOverride = getAuthoringOverride();
  const children: CompositeChild[] = [];
  const resources: AuthoringAdapter[] = [];
  /** Drop everything built so far — this play is over, so these adapters have
   *  no session to belong to and no teardown path that would ever reach them
   *  (`exitPlayRootAuthoring` walks `_instance.rootResources`, which this run
   *  never gets to assign). */
  const abandon = (): void => {
    for (const adapter of resources) {
      if ('dispose' in adapter && typeof adapter.dispose === 'function') adapter.dispose();
    }
  };
  for (const world of roots) {
    const declaration = manifest ? rootById(manifest, world.id) : undefined;
    const composition = declaration
      ? {
          zOrder: declaration.zOrder,
          pausable: declaration.pausable,
          ...(declaration.entry ? { content: `Entry · ${declaration.entry}` } : {}),
        }
      : {};
    // D-N4/D-N8: an ingested React game's DOM is disclosed as a read-only
    // boundary. Normalizing composition must never silently grant JSX/DOM
    // authoring to vendored source; the universal tree and write authority
    // are independent concerns.
    if (declaration?.adapter.identity === 'ingest-react') {
      children.push({
        worldId: world.id,
        kind: world.kind,
        adapter: new BoundaryAuthoringAdapter(store.shell, {
          id: world.id,
          kind: world.kind,
          adapter: declaration.adapter.identity,
          entryOrScenePath: declaration.entry,
          zOrder: declaration.zOrder,
          pausable: declaration.pausable,
        }),
        ...composition,
      });
      continue;
    }
    const mounted = world.mounted;
    if (mounted.kind === 'three') {
      // The presented subject uses OID identity so Edit→Play selection stays
      // continuous. A headless or non-Three host can omit presentation; its
      // mounted tree still gets an honest structural live projection.
      // `frameControl: 'host'` on the structural branch follows from the same
      // tick-ownership fact: play's own loop drives the root and this adapter
      // holds no handle that can stop it for a gesture.
      const isPresentedSubject = world.id === presentedWorldId && mounted.scene === store.scene;
      const sourceAnchor = isPresentedSubject ? await readOidSourceAnchors() : undefined;
      if (!isCurrentGeneration()) {
        abandon();
        return;
      }
      const adapter = isPresentedSubject
        ? oidThree(store, mounted.scene, liveWorldId(world.id), playRunJournal(world.id), {
            explicitSourceCommit: true,
            sourceAnchor,
          })
        : structuralThree(store, mounted.scene, {
            frameControl: 'host',
            journal: playRunJournal(world.id),
          });
      resources.push(adapter);
      children.push({
        worldId: world.id,
        kind: world.kind,
        adapter: withEphemeralPersistence(adapter),
        ...composition,
      });
    } else if (mounted.kind === 'canvas') {
      if (mounted.substrate.name === 'babylon') {
        const { BabylonAuthoringAdapter } = await import(
          '../host/authoring/babylon-authoring-adapter'
        );
        if (!isCurrentGeneration()) {
          abandon();
          return;
        }
        const adapter = new BabylonAuthoringAdapter(
          mounted.substrate
            .root as import('../host/authoring/babylon-authoring-adapter').BabylonEngineLike,
          store,
          {
            canvas: mounted.canvas,
            api: mounted.substrate.api as never,
            provenance: {
              source: 'live',
              label: 'live',
              detail: 'Native Babylon.js play scene; ordinary Play edits are ephemeral.',
            },
          },
        );
        resources.push(adapter);
        children.push({
          worldId: world.id,
          kind: world.kind,
          adapter: withEphemeralPersistence(adapter),
          ...composition,
        });
        continue;
      }
      if (mounted.substrate.name !== 'pixi') {
        const adapter = new BoundaryAuthoringAdapter(
          store.shell,
          {
            id: world.id,
            kind: world.kind,
            adapter: mounted.substrate.name,
            entryOrScenePath: declaration?.entry,
            zOrder: declaration?.zOrder ?? 0,
            pausable: declaration?.pausable ?? true,
          },
          `No authoring adapter is registered for canvas substrate "${mounted.substrate.name}".`,
        );
        resources.push(adapter);
        children.push({ worldId: world.id, kind: world.kind, adapter, ...composition });
        continue;
      }
      const stage = mounted.substrate.root as import('pixi.js').Container;
      const [physicsRegistry, physicsAdapters, pixiAuthoring, pixiWriteTarget, canvasRuntime] =
        await Promise.all([
          import('@volter/game-runtime/pixi/physics-registry'),
          import('@volter/game-runtime/pixi/system-adapters'),
          import('../host/authoring/pixi-authoring-adapter'),
          import('../host/authoring/pixi-live-write-target'),
          import('../host/canvas-entry-runtime'),
        ]);
      // Stop landed while those imports were in flight — see this function's
      // doc comment. Bail before building (and before the `await` below).
      if (!isCurrentGeneration()) {
        abandon();
        return;
      }
      const { createPhysics2DRegistry } = physicsRegistry;
      const { createPhysicsAdapter2D } = physicsAdapters;
      const { PixiAuthoringAdapter } = pixiAuthoring;
      const { createLiveCanvasWriteTarget } = pixiWriteTarget;
      const physics = createPhysicsAdapter2D(world.physics2d ?? createPhysics2DRegistry());
      const adapter = new PixiAuthoringAdapter(stage, store, {
        // A played canvas world mounts through the SAME adjudicator Edit uses
        // (`resolveCanvasEntryAdapterForEditor`), so its stage is the project
        // graph's under the packaged runtime and this adapter's namespace has
        // to be too — see `../vite-plugin-module-doorways.ts`.
        pixi: await canvasRuntime.resolveCanvasPixiForEditor(),
        target: createLiveCanvasWriteTarget({ physics }),
        journal: playRunJournal(world.id),
        // Every root surface fills the game container exactly, so the
        // container's own rect IS this world's canvas rect.
        surface: getGameContainer,
      });
      resources.push(adapter);
      children.push({
        worldId: world.id,
        kind: world.kind,
        adapter: withEphemeralPersistence(adapter),
        ...composition,
      });
    } else if (mounted.kind === 'dom') {
      // Same regime as the three/pixi children above: edits apply to the LIVE
      // world and die with the session. The adapter is Edit mode's (so OID node
      // identity — and Edit→Play selection continuity — is unchanged); only its
      // write DESTINATION is swapped to the running DOM. See
      // `authoring/react-play-live-authoring.ts`.
      const adapter = createReactPlayAuthoringAdapter(mounted.container, store);
      resources.push(adapter);
      children.push({
        worldId: world.id,
        kind: world.kind,
        adapter: withEphemeralPersistence(adapter),
        ...composition,
      });
    } else {
      // Exhaustiveness guard (§7.4-2): the pre-existing if/else-if chain over
      // `RootInstance.kind` had no trailing else — a hypothetical 4th kind
      // would silently get NO authoring child (no error, just missing
      // authoring for that world) rather than failing loudly/at compile time.
      assertNever(mounted, 'installPlayRootAuthoring');
    }
  }
  // THE COMMIT GATE. Everything below writes editor-wide state that only a live
  // play run may own — the instance's resource list, the active authoring
  // override, the dev handle. Re-read the generation here, after every await
  // above, so a Stop that landed mid-install cannot have its restored edit
  // authoring overwritten by this resumed one.
  if (!isCurrentGeneration()) {
    abandon();
    return;
  }
  _instance.rootResources = resources;
  const projection = hierarchyProjectionFromProjectConfig(getCurrentProject()?.config);
  const composite = new CompositeAuthoringAdapter(children, undefined, projection);
  setActiveAuthoring(composite);
  // `setActiveAuthoring` is a plain module-level variable, not React state —
  // the left hierarchy panel only re-checks `hasAuthoringOverride()` when the
  // store notifies (same reason `ingest/mount-ingest-root.ts` calls this right after
  // installing its own override).
  store.shell.notifyIngestEdit();

  // Dev/e2e diagnostic handle — the SAME pattern `ingest/mount-ingest-root.ts`'s
  // `window.__vgaiIngest`/`window.__vgaiIngest2D` use:
  // `store.saveNow()` (Ctrl/Cmd+S) and `_autoSave()` are both structurally
  // guarded OFF while ANY authoring override is active (`hasAuthoringOverride()`
  // / the play-state check) — the adapter's OWN `persistence.save()` is the
  // only way an override session's edits reach disk, so tests/tooling need a
  // handle to call it directly, exactly as the ingest sessions expose.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['__vgaiMultiRoot'] = {
      adapter: composite,
      worldIds: children.map((c) => c.worldId),
      store,
    };
  }
}

/** This run's journal for one world — see {@link PlayInstance.journalSession}. */
function playRunJournal(worldId: string): JournalSubject {
  return playJournal(_instance.id, worldId);
}

/**
 * Teardown every per-world authoring resource owned by the play session, and
 * END THE RUN'S JOURNAL.
 *
 * This is the ONE teardown path allowed to expire a journal session
 * (`history/json-history-resource.ts`'s ownership block), and it may expire
 * only the session play itself minted. An adapter's own `dispose()` merely
 * detaches: it is a SHARER of whatever session it was handed, and a sharer that
 * could end a session is how a held surface's undo stack came to be emptied by
 * every remount.
 */
function exitPlayRootAuthoring(store: EditorShellStore): void {
  for (const adapter of _instance.rootResources) {
    if ('dispose' in adapter && typeof adapter.dispose === 'function') adapter.dispose();
  }
  _instance.rootResources = [];
  // Play edits are session-local by architecture: nothing this run journaled
  // may still be undoable once the run is over.
  if (_instance.journalSession) {
    store.shell.projectHistory?.expireSession(_instance.journalSession);
    _instance.journalSession = '';
  }
  if (import.meta.env.DEV) {
    delete (window as unknown as Record<string, unknown>)['__vgaiMultiRoot'];
  }
}
/**
 * W5: decides whether a keydown Escape should stop play mode. Escape-to-stop
 * is an EDITOR command (unlike other play input, it must fire regardless of
 * `activeViewportTab` — Escape from the Scene tab is expected to stop play
 * too), so it is gated separately from the game-input predicate. Escape
 * consumed by an overlay (menu/dialog/popover called preventDefault) or
 * aimed at a text edit (input/textarea/select/contenteditable — the user
 * means "cancel this edit", not "stop play") must not stop play.
 * Exported for unit testing with synthetic KeyboardEvents.
 */
export function shouldEscapeStopPlay(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return false;
  if (isEditableTarget(e.target)) return false;
  return true;
}

let _escapeListener: ((e: KeyboardEvent) => void) | null = null;
let _originalConsoleLog: typeof console.log | null = null;
let _originalConsoleInfo: typeof console.info | null = null;
let _originalConsoleWarn: typeof console.warn | null = null;
let _originalConsoleError: typeof console.error | null = null;
let _logFlushChain: Promise<unknown> = Promise.resolve();
let _flushInterval: ReturnType<typeof setInterval> | null = null;
let _pendingEntries: LogEntry[] = [];
let _lastPersistedDebugEventSeq = 0;

/**
 * The per-entry half of a play log's identity (`@volter/editor-sdk`'s
 * `play/log-format.ts` owns the format; the run's session/project/name/start
 * are a header line the server writes once, and are deliberately NOT repeated
 * here).
 *
 * Both fields are stamped ONLY when this writer genuinely knows them, and
 * absence is a real answer:
 *  - `simSpeed` is the live loop's `timeScale` — an instrument can change it
 *    mid-run, so it is a genuine per-entry fact. Absent before the game exists.
 *  - `world` is the world the run PRESENTS (the adopted three root), or the
 *    game's single root when it has exactly one and attribution is therefore
 *    unambiguous. A multi-root run with no presented world gets nothing rather
 *    than a guess — the anti-shim rule applies to evidence too.
 */
function playLogRunStamp(): { world?: string; simSpeed?: number } {
  const game = _instance.session?.game;
  if (!game) return {};
  const roots = game.roots;
  const world = _instance.presentation?.worldId ?? (roots.length === 1 ? roots[0]?.id : undefined);
  const timeScale = game.loop.timeScale;
  return {
    ...(world !== undefined ? { world } : {}),
    ...(typeof timeScale === 'number' ? { simSpeed: timeScale } : {}),
  };
}

function drainDebugEventsToPlayLog(): void {
  const debug = _instance.session?.game?.systemAdapters?.debug;
  if (!debug) return;
  try {
    const converted = debugEventsToLogEntries(
      debug.events(_lastPersistedDebugEventSeq),
      _lastPersistedDebugEventSeq,
    );
    _lastPersistedDebugEventSeq = converted.lastSeq;
    const stamp = playLogRunStamp();
    for (const entry of converted.entries) _pendingEntries.push({ ...entry, ...stamp });
  } catch {
    // Logging is evidence, never a reason to break the game loop.
  }
}

// Asset bytes have changed, but a running game retains its own instances.
const stopAssetReload = onAssetReload((paths) => {
  // Cleared whether or not a run is live, so the next run loads the new bytes.
  void evictDreiCaches(paths);
  if (!_instance.session) return;
  markRestartRequired(
    'Project assets changed — restart play to load the revised models or textures.',
  );
});
if (import.meta.hot) import.meta.hot.dispose(stopAssetReload);

// --- Script HMR ---
if (import.meta.hot) {
  import.meta.hot.on('vgai:restart-required', (data: { file: string }) => {
    if (!_instance.session) return;
    const file = data.file.split('/').pop() ?? data.file;
    markRestartRequired(`${file} changed and cannot be applied safely while the game is running.`);
    warnRestartRequired(`Restart required: ${file} changed.`);
  });
  // An R3F-dialect entry file changed while the game is RUNNING. Play mode
  // deliberately does NOT full-reload for `r3f-entry` files (the
  // dev server swallows them from stock HMR and fires this custom event; the
  // design session that normally absorbs it is suspended during play) — but
  // stale must never be SILENT. Mark the session restart-required: the
  // PlayBar's Restart button lights up (variant 'primary') carrying this
  // reason, and ONE click remounts every root from fresh source and
  // re-enters play (`enterPlayMode` re-imports the entry with a
  // cache-busting query — see `loadProjectScripts`). `vgai status` reports
  // the same pending-restart state via `collectState().restartRequired`, so
  // agents get the signal humans get. EDIT-mode behavior is unchanged
  // (`_instance.session` is null there; absorb-by-remount stays as landed — see
  // r3f-design-session.ts).
  import.meta.hot.on('vgai:r3f-entry-update', (data: { file: string }) => {
    if (!_instance.session) return;
    const file = data.file.split('/').pop() ?? data.file;
    markRestartRequired(
      `${file} changed while playing — the running R3F world is stale until play restarts.`,
    );
    warnRestartRequired(`Restart required: ${file} changed while playing.`);
  });
  import.meta.hot.on('vgai:script-update', async (data: { file: string }) => {
    // Project-tool source belongs to editor chrome. The tool contribution
    // store re-imports and remounts it; no game root can become stale from an
    // editor-only document changing.
    if (isEditorLanePath(data.file)) return;
    const project = getCurrentProject();
    if (!project) return;
    if (!_instance.session || !_ctx) return;
    markRestartRequired(
      `${data.file.split('/').pop() ?? data.file} changed and requires remounting all roots.`,
    );
  });
}

/** The live document's container element (`live-document.ts` owns it). */
export function getGameContainer(): HTMLElement | null {
  return editorHost().workspace.liveDocument.container();
}

/** Move keyboard focus and the hotkey scope onto the live game pane. */
function focusGameSurface(): void {
  const take = (): void => {
    const pane = editorHost().workspace.liveDocument.container();
    if (!pane) return;
    // The transport button keeps focus through a plain `pane.focus()` when
    // the pane is not yet focusable or the state flip re-renders it —
    // measured on preview build 72: activeElement stayed BUTTON[play-control]
    // and Space still stopped play. Drop the button's focus explicitly, make
    // the pane focusable, then focus it.
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active instanceof HTMLElement && active !== pane && active.tagName === 'BUTTON') {
      active.blur();
    }
    if (!pane.hasAttribute('tabindex')) pane.tabIndex = -1;
    try {
      pane.focus({ preventScroll: true });
    } catch {
      // a detached pane cannot take focus; the scope hand-off below still stands
    }
    setActiveScope('viewport');
  };
  take();
  // The play-state flip re-renders the Game document; the pane the first
  // attempt focused may be replaced by the commit. Take it again after it.
  setTimeout(take, 150);
  setTimeout(take, 600);
}

/** Bind the play-mode orchestrator to editor context. Call once at init. */
/**
 * Play binds to the shell store on its arrival (`shell-store-door.ts`), so no
 * workspace panel names Play to hand it the store; the authored viewport is
 * read through `viewport-door.ts` when a session presents its roots.
 */
onThreeStore((store) => bindPlayMode(store));

export function bindPlayMode(store: EditorShellStore): void {
  _ctx = { store, gameContainer: null! }; // set dynamically from the live document's container
  // THE BARE-KEY YIELD IS THE FRAME'S. While Play runs the game's keys are the
  // game's, and what decides is the workbench: our stage actions carry a
  // `when` clause over `vgai.stage.focused`/`vgai.play`, so a bare key reaches
  // the game rather than a shell binding, and a ⌘-chord stays the workbench's.
  // The engine's own `InputManager` gate tracks the same predicate
  // independently (`gated-globals.ts` and `surface-keyboard.ts`), which is what
  // keeps a game's raw `window.addEventListener('keydown')` gated too.
  // The idle auto-stop needs a way to end play without `play-recording.ts`
  // importing the play lifecycle it is driven BY. Handed over here rather than
  // at module scope so the two directions of the edge stay one-way.
  bindPlayRecordingStop(exitPlayMode);
  for (const bound of playModeBindingWaiters) bound();
}

/** True if play mode is currently active (playing or paused). */
export function isPlayModeActive(): boolean {
  return _instance.session !== null;
}

/**
 * Narrow relay accessor — the live play session's `InputManager`(s)
 * and the Game root's loop, for `command-listener.ts`'s
 * `inject-input`/`set-time-scale`/`set-seed` cases. This is exactly the
 * accessor the vgai-sdk honest-gap jsdocs prescribed
 * (`play/input-operations.ts`, `play/control-operations.ts`): `_instance.session` is
 * module-private, so the relay needs this one exported read. Everything else
 * the relay reads (state providers, debug commands) flows through
 * `setActiveSystems`/`getActiveSystems` instead.
 *
 * `getInputTarget(worldId?)` (D15/T-D15.5 — review objection 2's fix)
 * REPLACES what used to be a plain `input: Game['input'] | null` field —
 * `Game.input` always resolves to the DEFAULT world's `InputManager` only,
 * while the debug bridge's `window.__vgai.input.*` reached whichever world's
 * `InputManager` last called `DebugRegistry.setVirtualInputTarget` (a
 * SEPARATE, last-writer-wins slot). In a multi-world project those two could
 * name DIFFERENT roots — the exact closed-PR review objection. Now both
 * doors call the SAME `getDebugRegistry(game).getVirtualInputTarget(worldId)`
 * — one resolution function (`debug-registry.ts`'s `resolveInputRootId`),
 * so `inject-input` (this accessor) and `window.__vgai.input.*`
 * (`debug-bridge.ts`) can never disagree about which world an unqualified
 * actuation targets again. `null` when nothing is registered for the
 * resolved id (or no `Game` is running at all); throws the registry's own
 * `DEBUG_INPUT_WORLD_NOT_FOUND` for an explicit, unregistered `worldId`.
 *
 * `runTicks` (D15/T-D15.4) is added the SAME way: reached via
 * `getDebugRegistry(game).getRunTicksTarget()` — the identical accessor
 * `runtime/debug-bridge.ts`'s `window.__vgai.runTicks` (door a) goes
 * through, so the editor relay's `run-ticks` case (door b, → `play.runTicks`)
 * calls byte-identical behavior (D17). `null` only when no `Game` is running
 * at all (`_instance.session` is `null`) — a live `Game` always wires a run-ticks
 * target immediately at construction (`createGame`, `runtime/game.ts`), so
 * `runTicks` is non-null whenever `_instance.session` is non-null. `runTicks` itself
 * is game-global (one shared tick loop across every world by design), so —
 * unlike the input target — it never needed per-world routing.
 *
 * `random`/`determinismDeclared` (D15/T-D15.6) back the `set-seed` relay
 * case and `collectState`'s `seed`/`deterministic` fields: `random` is
 * `getSeededRandom(game)` — the SAME game-scoped `SeededRandom` every
 * world's `ctx.random` reads, non-null for every real `createGame` call
 * (see `seeded-random.ts`) — and `determinismDeclared` is
 * `_instance.determinismDeclared`, set from the CURRENT session's manifest in
 * `enterPlayMode`.
 */
export function getPlayRuntimeAccess(): {
  getInputTarget(worldId?: string): DebugVirtualInputTarget | null;
  loop: GameLoop;
  runTicks: ((n: number, opts?: RunTicksOptions) => void) | null;
  /** The SETTLED-AWARE driver over the same target (`runtime/run-ticks-settled.ts`) — the
   *  relay's `run-ticks` case awaits this so a tick never races a scene remount's async
   *  commit, byte-identical with the bridge's `runTicksSettled` door (D17). */
  runTicksSettled: ((n: number, opts?: RunTicksOptions) => Promise<void>) | null;
  random: SeededRandom | null;
  determinismDeclared: boolean;
} | null {
  const game = _instance.session?.game;
  if (!game) return null;
  const registry = getDebugRegistry(game);
  const runTicksTarget = registry?.getRunTicksTarget() ?? null;
  return {
    getInputTarget: (worldId?: string) => registry?.getVirtualInputTarget(worldId) ?? null,
    loop: game.loop,
    runTicks: runTicksTarget ? runTicksTarget.runTicks.bind(runTicksTarget) : null,
    runTicksSettled:
      registry && runTicksTarget ? (n, opts) => runTicksWhenSettled(registry, n, opts) : null,
    random: getSeededRandom(game),
    determinismDeclared: _instance.determinismDeclared,
  };
}

/** Get the running game's scene (for editor Scene tab rendering). */
export function getGameScene(): THREE.Scene | null {
  const mounted = _instance.session?.game.defaultRoot.mounted;
  return mounted?.kind === 'three' ? mounted.scene : null;
}

export interface GameRootSurfaceFact {
  readonly rootId: string;
  readonly kind: 'three' | 'canvas' | 'dom';
  readonly hasRenderableContent: boolean;
}

/** Exact mounted-root content facts for the Game document's empty-state UI. */
export function gameRootSurfaceFacts(): readonly GameRootSurfaceFact[] {
  const roots = _instance.session?.game?.roots;
  if (!roots) return [];
  return roots.map((root) => {
    const mounted = root.mounted;
    let hasRenderableContent = false;
    if (mounted.kind === 'three') {
      hasRenderableContent = threeSceneHasRenderableContent(mounted.scene);
    } else if (mounted.kind === 'canvas') {
      try {
        hasRenderableContent =
          mounted.substrate.name === 'pixi'
            ? mountedStoryHasPixiContent(mounted.substrate.root as import('pixi.js').Container)
            : mounted.substrate.name === 'babylon'
              ? (
                  (mounted.substrate.root as { scenes?: Array<{ rootNodes?: unknown[] }> })
                    .scenes ?? []
                ).some((scene) => (scene.rootNodes?.length ?? 0) > 0)
              : false;
      } catch {
        hasRenderableContent = false;
      }
    } else {
      hasRenderableContent = domHasRenderableContent(mounted.container);
    }
    return { rootId: root.id, kind: mounted.kind, hasRenderableContent };
  });
}

/**
 * #140 — the live play-mode game canvas, for `command-listener.ts`'s
 * `bridge-screenshot` relay op (`RelayTransport.screenshot` in `@volter/editor-live`).
 * The universal host mounts its root surfaces into `editorHost().workspace.liveDocument.container()`;
 * querying it for the bottom canvas avoids a surface-specific session alias.
 * `null` when not in play mode or no canvas surface is mounted.
 */
export function getPlayCanvas(): HTMLCanvasElement | null {
  if (!_instance.session) return null;
  // DECLARATION FIRST (ARCHITECTURE-CORE §The editor protocol, zero
  // inference). The roots path stamps each surface with the root it presents
  // (`create-runtime.ts`), and a self-booting game may name its own canvas on
  // its contract — so `presentationSurface` READS which canvas is the game's
  // picture. "Bottom-most `<canvas>` in DOM order" survives as its measured
  // fallback, unchanged, for a container carrying neither declaration.
  return presentationSurface(editorHost().workspace.liveDocument.container()).canvas;
}

/** The game container for a SPECIFIC instance — the primary when `id` is omitted
 *  (or names it), else the addressed additional seat. This is what per-instance
 *  screenshot capture targets, so `game.instance(id).screenshot()` grabs THAT
 *  seat's game stack and a plain screenshot can capture every seat in turn. */
export function getInstanceContainer(id?: string): HTMLElement | null {
  if (!id || id === _instance.id) return editorHost().workspace.liveDocument.container();
  return _additional.find((inst) => inst.id === id)?.container ?? null;
}

/** The canvas for a SPECIFIC instance — the fallback capture leg when the
 *  composite path is unavailable. Primary when `id` is omitted/names it. */
export function getInstanceCanvas(id?: string): HTMLCanvasElement | null {
  if (!id || id === _instance.id) return getPlayCanvas();
  const inst = _additional.find((i) => i.id === id);
  if (!inst?.session) return null;
  // Same declaration-first read as the primary seat's — an addressed seat is a
  // second mount of the SAME project, so it carries the same stamps.
  return presentationSurface(inst.container).canvas;
}

/** #146 — when the most recent play run began (ms epoch), or `null` before
 *  any run in this page. `command-listener.ts`'s relay `snapshot` uses this to
 *  fence `pageErrors` to errors from that run (the editor console accumulates
 *  across runs; a session client reading "what went wrong during my run" must not
 *  see an OLDER session's stale failures). PD-1: it deliberately survives
 *  `exitPlayMode()` — a failed run's errors must still be readable after the
 *  failure tears the run down, which is the only moment anyone asks. */
export function getPlayStartedAt(): number | null {
  return _playStartedAtMs;
}

/** When the most recent play run's teardown finished (ms epoch), or `null`
 *  while a run is live / before the first run. Together with
 *  `getPlayStartedAt()` this is the CLOSED window `command-listener.ts` uses to
 *  split "this run's errors" (`pageErrors`/`consoleErrors`) from "the rest of
 *  the session's" (`sessionErrors`/`sessionWarnings`) — see `_playEndedAtMs`. */
export function getPlayEndedAt(): number | null {
  return _playEndedAtMs;
}

/** Every live instance (primary first). Lifecycle operations that act on "the
 *  running game" — resize, pause, resume, step — must cover the WHOLE split, or
 *  the extra seats keep running while the primary freezes, ignore resizes, and
 *  so on. Single-instance play is just the one-element case. */
function allLiveInstances(): PlayInstance[] {
  return [_instance, ..._additional].filter((inst) => inst.session);
}

// Suspending presentation parks the RAF, not the session or its user-selected
// Play/Pause state. Resume only loops this gate stopped, with start() resetting
// the frame clock so hidden time never becomes a simulation catch-up burst.
const presentationSuspendedLoops = new Set<GameLoop>();
function syncPlayPresentationActivity(): void {
  const liveLoops = new Set(allLiveInstances().map((inst) => inst.session!.game.loop));
  for (const loop of presentationSuspendedLoops) {
    if (!liveLoops.has(loop)) presentationSuspendedLoops.delete(loop);
  }
  for (const loop of liveLoops) {
    if (isEditorPresentationActive()) {
      if (presentationSuspendedLoops.delete(loop)) loop.start();
    } else if (loop.liveness !== 'stopped') {
      presentationSuspendedLoops.add(loop);
      loop.stop();
    }
  }
}
const unsubscribePlayPresentation = subscribeEditorPresentationActivity(
  syncPlayPresentationActivity,
);
import.meta.hot?.dispose(unsubscribePlayPresentation);

/**
 * The seat the editor's RUNTIME INSTRUMENTS are pointed at — the Inspect
 * selector's answer (`active-systems.ts`), never editor authoring focus and
 * never the addressed-instance wire. A stale/unset selection falls back to the
 * first live seat, mirroring `resolvedInspectedInstanceId`, so the instruments
 * are never orphaned.
 */
function inspectedInstance(): PlayInstance | null {
  const live = allLiveInstances();
  const id = inspectedInstanceId();
  return live.find((inst) => inst.id === id) ?? live[0] ?? null;
}

/**
 * The two things play publishes for the LIFETIME OF ONE SESSION: the play
 * surface's inspection subject (`inspection/game-subject.ts`), and the live
 * game every project contribution's props carry
 * (`tool-contribution-play.ts`).
 *
 * RESOURCE OWNERSHIP: play owns both outright. They are created by the one
 * `enterPlayMode` that adopts a session and dropped by the one `exitPlayMode`
 * that ends it — additional seats never publish their own, because the subject
 * is THE game and which seat it reads is resolved LIVE from the inspected
 * instance, on every read.
 *
 * Both are published as READERS rather than values for that reason: switching
 * the Inspect selector must move the subject and the contribution props
 * together, without a republish.
 */
let _gameSubjectRegistration: (() => void) | null = null;

function publishPlaySessionReaders(): void {
  _gameSubjectRegistration?.();
  _gameSubjectRegistration = registerGameNullSubject(() => ({
    projectName: getCurrentProject()?.config.name ?? null,
    // Only when a split makes "which of these games?" a real question.
    instanceName: allLiveInstances().length > 1 ? (inspectedInstance()?.name ?? null) : null,
  }));
  publishToolContributionPlay(() => {
    const inst = inspectedInstance();
    return inst?.session
      ? { game: inst.session.game, instanceId: inst.id, recording: toolContributionRecording }
      : null;
  });
}

function dropPlaySessionReaders(): void {
  _gameSubjectRegistration?.();
  _gameSubjectRegistration = null;
  publishToolContributionPlay(null);
}

/** Resize the running game to a specific resolution. `pixelRatio` (W2c
 *  device preview) optionally re-pins the renderers' DPR in the same pass.
 *  Applies to EVERY seat — under an even split every viewport is the same slot
 *  size, so the extra canvases resize with the primary instead of staying
 *  pinned at their mount size. */
export function resizeGame(width: number, height: number, pixelRatio?: number): void {
  for (const inst of allLiveInstances()) inst.session?.resize(width, height, pixelRatio);
}

/**
 * Serializes every `enterPlayMode()` invocation (the ghost-runtime bug:
 * `vgai play` on an already-playing/still-booting session left the
 * PREVIOUS runtime alive, ticking and rendering alongside the new one).
 *
 * Root cause: `enterPlayModeInner`'s own `if (_instance.session) exitPlayMode()`
 * guard (below) only protects the case where a PRIOR play has already fully
 * finished booting and assigned `_instance.session`. While a call is still mid-boot
 * (between this function being entered and `_instance.session` being assigned —
 * awaiting script loads / manifest resolution / asset loads / mount),
 * `_instance.session` reads as `null`, so a SECOND `enterPlayMode()` call landing in
 * that window sees no session to tear down and proceeds to run its own
 * entire prologue (`patchConsole()`, `startLogSession()`, canvas creation,
 * script loading, mount) CONCURRENTLY with the first call's. Both calls
 * mutate shared module-level/global state with no reentrancy guard —
 * `patchConsole()`/`unpatchConsole()` are the sharpest example (proven by a
 * red-before-green regression test: two overlapping calls double-wrap
 * `console.log` and the inner wrapper recurses into itself via the shared
 * `_originalConsoleLog` variable, a real `RangeError: Maximum call stack
 * size exceeded` — not a hypothetical). In the field this window is entered
 * whenever a caller re-issues `play` before the browser has acked the first
 * (a slow scene boot outliving the relay's/SDK's own `play.start` timeout is
 * the documented trigger — `packages/vgai-sdk/src/play/transport.ts`'s
 * `PLAY_START_TIMEOUT_MS`/`editor-server.ts`'s `PLAY_COMMAND_TIMEOUT_MS` —
 * and `play.start`'s own contract is explicitly "start (or restart)", so a
 * caller retrying after a timeout is using the API as documented, not
 * misusing it), or whenever the SSE `editor-command` listener
 * (`command-listener.ts`) dispatches a burst of commands without awaiting
 * the previous `handleCommand()` to settle.
 *
 * The existing `_playEpoch` generation guard decides, AFTER THE FACT, which
 * of two overlapping boots gets adopted into `_instance.session` and stops the loser
 * — but it does nothing to stop both boots from RUNNING (and their
 * prologues from clobbering each other) in the first place. Epoch-checking
 * is an adjudication mechanism, not a mutex.
 *
 * The fix is a FIFO queue, not a smarter epoch check: every call chains onto
 * the tail of `_enterQueue`, so a second call's ENTIRE body — prologue
 * included — never starts until the first call's entire invocation (success
 * or failure, including any self-teardown it performs) has fully settled.
 * This makes "play again while already playing/booting" a genuine, clean,
 * awaited restart for every caller (CLI, SDK, UI Play button, HMR's warm
 * restart) with no code path capable of leaving a booted session
 * unreferenced ("orphaned") — by the time any enterPlayMode() body runs,
 * it is provably the only one running.
 */
let _enterQueue: Promise<void> = Promise.resolve();
let _activePlaytest: PlaytestContext | null = null;

/** Host remount of a native swap-slot scene — the entrypoint's selection
 *  const is rewritten at serve time for THIS play run only. */
export type PlaySelectionOverride = EntrypointSelectionOverride & {
  readonly regionId: string;
};

let _playSelectionOverride: PlaySelectionOverride | null = null;

export function activePlaytest(): PlaytestContext | null {
  return _activePlaytest;
}

function privatePlaytest(): PlaytestContext {
  const id = globalThis.crypto?.randomUUID?.() ?? `private-${Date.now()}`;
  return {
    mode: 'private',
    id,
    roomKey: `private:${id}`,
    revision: null,
    participantId: EDITOR_PARTICIPANT_ID,
  };
}

export function enterPlayMode(
  explicitSeed?: number,
  playtest: PlaytestContext = privatePlaytest(),
  runName?: string | null,
  selectionOverride?: PlaySelectionOverride | null,
): Promise<void> {
  const override = selectionOverride ?? null;
  const run = _enterQueue.then(() => {
    // Publish the boot's phases for as long as it runs, and clear them on
    // EVERY exit — success, throw, and the early returns that hand the run to
    // ingest/module mode. A phase left standing after a boot finished would
    // make the next stuck command blame a step that ended minutes ago.
    beginPlayBoot();
    return enterPlayModeInner(explicitSeed, playtest, runName ?? null, override).finally(() => {
      endPlayBoot();
    });
  });
  // Advance the queue unconditionally so one caller's rejection can never
  // wedge every subsequent play attempt — each caller still observes its
  // OWN failure via the `run` promise this function returns.
  _enterQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Let the editor's one auto-launch coordinator finish before generic Play
 * chooses a runtime. Returns true when that coordinator already owns the run.
 */
async function startAutoLaunchedAdapterPlay(store: EditorShellStore): Promise<boolean> {
  const { autoLaunchIngest } = await import('../ingest/mount-ingest-root');
  await autoLaunchIngest(store);
  const bootIngest = getIngestPlayControl();
  if (bootIngest) {
    bootIngest.play();
    return true;
  }
  // `autoLaunchIngest` also owns the standalone `{ module }` route. If that
  // route claimed the project, its live module session is already the run.
  const { isModuleModeActive } = await import('../ingest/module-mode');
  return isModuleModeActive();
}

/**
 * Enter play mode: create a game canvas, start game, disable editor controls.
 *
 * `explicitSeed` (D15/T-D15.6, objection-4 fix — `vgai play --seed <n>`)
 * — the CLI's `play` command relays it through as `cmd['seed']`
 * (`command-listener.ts`'s `'play'` case); it is the "explicit config"
 * leg of `resolveDeterminismSeed`'s precedence (highest — beats
 * `manifest.determinism.defaultSeed`/`?vgai-seed=` on the editor's own
 * page URL), threaded into whichever mount path this play resolves to
 * below, exactly like `mountManifestRoots`'s own `opts.seed` already is
 * for a standalone boot.
 *
 * `runName` (optional — `vgai play --name <text>`) is FINDABILITY and nothing
 * else: the server slugifies it into this run's `logs/play-*.jsonl` filename
 * and its session-journal line, so "the run where I tested the boss fight" is
 * a grep instead of timestamp archaeology. No registry, no uniqueness check —
 * two runs sharing a name are two files with different stamps.
 *
 * Not exported directly — always call {@link enterPlayMode}, which
 * serializes invocations of this function so overlapping callers can never
 * run concurrently. See that wrapper's doc comment for why.
 */
/**
 * Every network-shaped step of the boot below runs through this. See
 * `play-boot-stall.ts` for the measurement it exists for: on a BACKGROUNDED
 * tab these fetches are deprioritized by the browser and can sit for minutes,
 * which the relay could only report as a generic 120s "editor connected but
 * did not respond". The runtime MOUNT deliberately does not go through here —
 * an abandoned mount would leak a live session, and it is not the starved step.
 */
function playBootStep<T>(step: PlayBootPhase, work: Promise<T>): Promise<T> {
  // Publish the phase BEFORE the work — the whole point is that a step which
  // never returns is still named. See `play-boot-phase.ts`.
  markPlayBootPhase(step);
  return withPlayBootStallGuard(step, work, {
    isHidden: () => typeof document !== 'undefined' && document.hidden,
    editorUrl: typeof window !== 'undefined' ? window.location.href : undefined,
  });
}

async function enterPlayModeInner(
  explicitSeed: number | undefined,
  playtest: PlaytestContext,
  runName: string | null,
  selectionOverride: PlaySelectionOverride | null,
): Promise<void> {
  // PD-1 — degrade loudly: every path out of this function that did NOT start
  // play now THROWS. A silent `return` resolved the caller's promise, so the
  // command relay answered `{ ok: true }` for a play that never started and
  // the CLI fell back to a generic "check logs/play-*.jsonl" that named no
  // cause. The three genuine-failure gates (no editor shell, no game
  // container, no project) throw here; the epoch checks below throw a
  // distinct "cancelled" message, because "someone stopped it" is also a real
  // answer and is not the same answer as "it broke".
  if (!_ctx) {
    const bindingEpoch = _playEpoch;
    markPlayBootPhase('waiting for the editor to bind Play');
    await waitForPlayModeBinding();
    if (_playEpoch !== bindingEpoch) {
      throw new Error('Play start cancelled while waiting for the editor to bind.');
    }
  }
  if (!_ctx) throw new Error('Play mode failed to start: the editor shell is not bound.');
  // EVERY step below publishes itself before it runs (`play-boot-phase.ts`).
  // A play boot that stops answering is otherwise indistinguishable from a
  // healthy tab — measured at N=20000, three consecutive silent timeouts.
  // `enterPlayMode` owns the begin/end pair; this function owns the marks.
  // Play must never start while the boot-time project bootstrap is still in
  // flight. Resolves immediately when no bootstrap is pending; gating HERE
  // rather than in the Play button covers every caller — UI, `vgai play` relay,
  // SDK.
  markPlayBootPhase('waiting for the project bootstrap to settle');
  await projectBootstrapSettled();
  // The play button is only shown while stopped, so a non-null _instance.session here is
  // stale — a previous play that didn't fully tear down (e.g. a re-entry race).
  // Clean it up so re-entering play mode always works.
  if (_instance.session) exitPlayMode();
  // After the stale-session cleanup: exitPlayMode clears the override, and
  // THIS run's override must survive that. A later Play button (no override)
  // remounts the source-declared key.
  _playSelectionOverride = selectionOverride;
  // Project detection settling is not the same thing as the editor's
  // authoring/ingest bootstrap settling: the latter waits for document/story
  // installation and can arrive seconds later. Reuse its deduplicated promise
  // here so a fast ▶ cannot enter generic first-party Play while the actual
  // ingest root is still mounting, then have that late boot mount steal and
  // pause the session. This call is a no-op for a project with no ingest route.
  if (await startAutoLaunchedAdapterPlay(_ctx.store)) return;
  // An ingest root that already has Edit pieces (a named world component, or
  // isolation-document scene tabs) holds its live mount back until here
  // (`ingest/deferred-ingest-play.ts`): Edit shows the constructs, and PLAY
  // is what constructs and runs the game. It mounts through the ordinary
  // ingest routes and owns the whole run, so this returns instead of also
  // booting a first-party composition.
  if (await mountDeferredIngestForPlay(_ctx.store)) return;
  // Capture this play's generation AFTER the stale-session cleanup (which
  // bumps the epoch via exitPlayMode). Any exitPlayMode — or a newer
  // enterPlayMode — during the async boot below invalidates this generation.
  const epoch = ++_playEpoch;
  _activePlaytest = playtest;
  // #146 — fence for the relay snapshot's `pageErrors` (see
  // `getPlayStartedAt`): errors logged before THIS play run are stale noise
  // to a probe reading "what went wrong during my run".
  _playStartedAtMs = Date.now();
  // A new run re-opens the window the previous exit closed.
  _playEndedAtMs = null;
  const { store } = _ctx;

  // Nothing is pre-validated here: a TSX world root has no schema to check
  // against, so its failures surface as module/mount errors.

  // Patch console → editorConsole tagged [game]
  patchConsole();

  // Start log session and register sink for JSONL persistence. Start, every
  // flush, and end share ONE permanent promise tail. `exitPlayMode()` stays
  // synchronous for UI callers, but a restart's start is queued after the
  // prior run's final flush/end; otherwise that late end closes the NEW
  // server session and every later 200ms flush receives a 409. Keeping start
  // on the tail also handles Stop arriving while start itself is in flight:
  // Stop's end queues behind it, then the epoch check below prevents the
  // cancelled run from installing a sink/interval after Stop.
  const logSessionStart = _logFlushChain.then(() => startLogSession(runName));
  _logFlushChain = logSessionStart;
  await playBootStep('starting the play log session', logSessionStart);
  if (epoch !== _playEpoch) return;
  _pendingEntries = [];
  _lastPersistedDebugEventSeq = 0;
  editorConsole.setSink((entry: ConsoleEntry) => {
    // Play-log half: stamp {tick, simT} from the live
    // session's built-in `time` provider so log entries correlate
    // frame-exactly with `ctx.debug.emit` events. Best-effort — entries
    // logged before the session finishes booting (or after stop) carry no
    // stamp, and a throwing read must never break logging.
    let stamp: { tick: number; simT: number } | undefined;
    try {
      const time = _instance.session?.game?.systemAdapters.debug?.state('time') as
        | { tick?: number; simSeconds?: number }
        | undefined;
      if (typeof time?.tick === 'number' && typeof time.simSeconds === 'number') {
        stamp = { tick: time.tick, simT: time.simSeconds };
      }
    } catch {
      /* unstampable — keep the entry */
    }
    _pendingEntries.push({
      t: entry.timestamp,
      level: entry.level,
      msg: entry.message,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.subsystem ? { sub: entry.subsystem } : {}),
      ...(entry.metadata ? { meta: entry.metadata } : {}),
      ...(stamp ?? {}),
      // The run's world/time-scale, when this writer genuinely knows them.
      ...playLogRunStamp(),
    });
  });
  _flushInterval = setInterval(() => {
    drainDebugEventsToPlayLog();
    if (_pendingEntries.length > 0) {
      const batch = _pendingEntries.splice(0);
      _logFlushChain = _logFlushChain.then(() => flushLogEntries(batch));
    }
  }, 200);

  // Register Escape → stop play mode
  _escapeListener = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && shouldEscapeStopPlay(e)) exitPlayMode();
  };
  // Bubble phase (default, no `capture`) is load-bearing: it lets overlay
  // handlers (menus/dialogs/popovers) run first and preventDefault() the
  // event before shouldEscapeStopPlay sees it.
  window.addEventListener('keydown', _escapeListener);

  // Create game canvas inside the dedicated game container. While the game is
  // not running there IS no game viewport, so the document that owns that
  // container is installed here — the first thing this play does that the
  // author can see — and this waits for its panel to commit.
  markPlayBootPhase('opening the Game document');
  await editorHost().workspace.liveDocument.acquire();
  if (epoch !== _playEpoch) return;
  const gameContainer = editorHost().workspace.liveDocument.container();
  if (!gameContainer) {
    const msg = 'Play mode failed to start: the game container is not mounted in the workspace.';
    editorConsole.error(msg, 'play-mode');
    // Tear down the console patch + flush interval + escape listener set up
    // above, same as the other failure paths (ED8).
    exitPlayMode();
    // PD-1: throw, don't return — a bare return resolved the caller's promise
    // and the relay acked a play that never started.
    throw new Error(msg);
  }
  const w = gameContainer.clientWidth;
  const h = gameContainer.clientHeight;
  // First-party play is the same page-shaped problem ingest already solved:
  // a canvas game that does `document.body.appendChild(overlay)` with
  // `position:fixed;inset:0` (floor-sim's F1 dock, its html/body sheet)
  // would cover the editor. Hand it this pane as its page before any
  // project module evaluates — `game-realm-page.ts` reasons 1 and 2.
  if (!gameContainer.style.contain) {
    gameContainer.style.cssText += GAME_SURFACE_CONTAINMENT_CSS;
  }
  markGameCssScope(gameContainer);
  setGameSurface(gameContainer);

  // The host's live transition (chrome dissolve, camera flight) — before the
  // play state flips; every exit path funnels through endPlayTransition.
  editorHost().viewport.transition.begin();

  // setPlayState auto-switches to Game tab
  store.shell.setPlayState('playing');
  // THE GAME TAKES THE KEYBOARD AS PLAY STARTS. Until the player clicks the
  // pane, focus stays on the transport button they pressed and the hotkey
  // scope on the workspace — so the next Enter or Space activates that
  // button and STOPS play, and a redeploy Enter "does nothing" (runhuman
  // pass 145; traced on production build 70: keydown target BUTTON, play
  // ends). Focus the pane and hand the scope to the viewport now, the same
  // state a click into the game produces.
  focusGameSurface();
  editorConsole.log('Play mode started', 'play-mode');
  // Apply the project's adapter-declared utilities after transient Play chrome settles.
  editorHost().viewport.transition.onSettled(() => {
    if (epoch === _playEpoch && store.shell.playState === 'playing') revealWorkspacePlayUtilities();
  });

  // WHAT THIS BOOT CREATED, BEFORE ANYTHING ELSE CAN REACH IT. `_instance.id`
  // and `_instance.session` are assigned only once the mount AND the bindings
  // after it have all succeeded, so a failure anywhere earlier leaves
  // `exitPlayMode` holding an EMPTY id — and an empty id is exactly what
  // `disposeInstanceRealm` early-returns on, while a bare `clearGameSurface()`
  // resets the DEFAULT realm's page instead of this mount's. These two locals
  // are the handles the catch below needs to reclaim a half-built play.
  let bootMountId: string | null = null;
  let bootedSession: GameSession | null = null;
  try {
    const project = getCurrentProject();

    if (!project) {
      // PD-1: throw (the catch below logs + rolls back exactly as it does for
      // every other boot failure) instead of returning — a bare return let the
      // relay ack a play that never started.
      throw new Error('No project open — open or create a project first');
    }

    const manifest = await playBootStep('fetching the project manifest', fetchGameManifest());
    // Publish the exact roots BEFORE entry resolution/mounting. The Game
    // document is already visible at this point; without a waiting fact its
    // empty area cannot say which declared roots it is waiting for.
    _hostMountedReadyRootIds = declaredRoots(manifest).map((root) => root.id);
    for (const rootId of _hostMountedReadyRootIds) {
      recordRootReadiness({
        rootId,
        mechanism: 'host-mount',
        source: 'declared',
        state: 'waiting',
      });
    }
    // Every project mounts through the same manifest composer.
    // Cardinality never selects a runtime, hierarchy, or persistence model.
    // Every root resolves from its own adapter-owned content.
    let session: GameSession;
    // PD-3 — open the cross-root module-split window BEFORE any root imports
    // its entry, and close it after every root has MOUNTED (a root that
    // imports lazily inside `mount()` has to be inside the window too). See
    // `project-module-split.ts` for why a mount-scoped window is the sound
    // way to count module instances.
    beginProjectModuleSplitWatch();
    const { entries, mountId } = await playBootStep(
      "resolving the project's root entries",
      resolveAllRootEntries(manifest, project.rootPath, {
        selectionOverride: selectionOverride ?? undefined,
      }),
    );
    editorConsole.log(
      `Resolved manifest composition (${declaredRoots(manifest).length} world${declaredRoots(manifest).length === 1 ? '' : 's'}): ` +
        declaredRoots(manifest)
          .map((w) => `${w.id} (${w.surface})`)
          .join(', '),
      'play-mode',
    );
    // Play may have been exited while resolving — don't boot a runtime for
    // a play that is already over.
    if (epoch !== _playEpoch) return;
    // Re-read the container's real size instead of the `w`/`h` captured
    // BEFORE `store.setPlayState('playing')` above (that capture can race
    // the Game-tab layout switch and read 0x0). This still matters for the
    // INITIAL render-buffer resolution (`mountManifestRoots`'s own
    // `width`/`height` default otherwise falls back to the manifest's
    // `resolution`) even though it is no longer the ONLY thing standing
    // between a 0x0 mount and a correctly-laid-out canvas: the roots-path
    // canvas's on-screen SIZE is now fully CSS-container-driven
    // (`create-runtime.ts`'s `mountOneThreeRoot`, E4.R1 reopen fix), not
    // pinned to whatever it mounted at.
    const rw = gameContainer.clientWidth || w;
    const rh = gameContainer.clientHeight || h;
    setGameSurface(gameContainer, mountId);
    // The realm under `mountId` exists from here on (this call created its
    // page, and every project module served under this id resolves through
    // it). Record it so a failure below can reclaim it — see the catch.
    bootMountId = mountId;
    // NOT a `playBootStep`: an abandoned mount would leak a live session, so
    // this step has no stall guard — which is exactly why it needs a phase.
    // MEASURED at N=20000: the block that ate three command budgets started
    // here and ran for 199.5s with nothing anywhere able to name it.
    markPlayBootPhase('mounting the runtime roots');
    const { mountManifestRoots } = await import('@volter/game-runtime/runtime/mount-manifest');
    session = await mountManifestRoots({
      manifest,
      container: gameContainer,
      entries,
      width: rw,
      height: rh,
      // D15/T-D15.6 — `vgai play --seed`'s explicit config leg; `undefined`
      // (the overwhelmingly common case) leaves `mountManifestRoots`'s own
      // manifest/`?vgai-seed=` precedence untouched.
      seed: explicitSeed,
      playtest,
    });
    bootedSession = session;

    // Play was exited (Stop/Escape) — or re-entered — while the runtime was
    // booting. This session belongs to a play that is already over: stop it
    // and bail WITHOUT adopting its scene into the store. Adopting here left
    // the editor showing an empty hierarchy in edit mode and leaked the
    // session (RAF loop, Rapier world, WebGL context).
    if (epoch !== _playEpoch) {
      session.stop();
      disposeInstanceRealmAfterStop(session, mountId, 'Cancelled instance');
      return;
    }
    // PD-3 — close the window and report LOUDLY. A split does not stop the
    // game (both copies run; they just disagree), so this is an error-level
    // report rather than a throw: the failure mode being fixed is SILENCE,
    // not a crash. `collectState` carries the same reports to `vgai status`,
    // and `editorConsole.error` reaches the editor console panel and the
    // play-log sink the CLI reads back.
    for (const split of endProjectModuleSplitWatch(project.rootPath)) {
      editorConsole.error(formatProjectModuleSplitMessage(split), 'play-mode');
    }
    // READINESS, ANSWERED BY THE HOST. A host-mounted (exported-composition)
    // root needs no game code to state when it is ready: the host RAN the
    // mount, and `mountManifestRoots` resolving IS that answer — including the
    // roots' own async setup, which it awaits. So every one of these roots
    // reports `declared`, and no measured wait stands anywhere behind them
    // (`readiness.ts`; published as `vgai status`'s `readiness` facet).
    for (const rootId of _hostMountedReadyRootIds) {
      recordRootReadiness({ rootId, mechanism: 'host-mount', source: 'declared', state: 'ready' });
    }
    // The game has mounted its ordinary native roots. Only now does the
    // boundary project app-owned reads, commands and input onto the session
    // protocol; no component participated in host registration.
    installAdapterRuntimeBindings(session.game);
    _instance.session = session;
    _instance.id = mountId;
    _instance.journalSession = playJournal(mountId, '').session;
    _instance.name = instanceNameAt(0);
    _instance.unregisterPerformanceSource?.();
    _instance.unregisterPerformanceSource = registerPerformanceSource({
      id: 'workspace:game',
      label: 'Game runtime',
      kind: 'game',
      instanceId: mountId,
      profiler: session.game.profiler,
    });
    clearRestartRequired();
    _instance.determinismDeclared = manifest.determinism?.seededRandom === true;
    // D16 parity with the standalone mount path (`mount-manifest.ts`'s
    // `setRoomDeclared` wiring): a project whose manifest declares a Colyseus
    // room must declare `locus: 'client' | 'server'` on every debug command
    // it registers — in editor play mode exactly like on the standalone
    // page. Idempotent for the manifest composer (`mountManifestRoots`
    // already set it).
    if (manifest.configurations.some((c) => c.kind === 'process')) {
      getDebugRegistry(session.game)?.setRoomDeclared(true);
    }
    notifySessionListeners();
    // D19: play edits are session-local regardless of world count.
    store.shell.setPlayEditRegime('ephemeral');

    // Swap store to game scene so hierarchy/inspector show game entities.
    // liveHierarchy: first-party play mode is the ONLY adoption path that may
    // synthesize descriptors for untagged runtime objects (anti-shim rule —
    // ingest/module mounts adopt foreign scenes and must never fabricate).
    // With no stage bound to present them (no Scene tab open: the Game tab and a model document
    // are the whole layout), Play still adopts its roots, so the hierarchy door and every
    // inspector reach the live objects exactly as they do beside a Scene tab.
    _instance.presentation =
      editorHost().viewport.presentRoots(session.game.roots) ??
      presentThreeRoots(store, session.game.roots);
    markPlayBootPhase('installing play authoring for each root');
    await installPlayRootAuthoring(
      store,
      session.game.roots,
      manifest,
      _instance.presentation?.worldId ?? null,
      () => epoch === _playEpoch,
    );
    // Stop/Escape can land while the authoring install above is in flight, and
    // `exitPlayMode` is synchronous: by the time this resumes it has already
    // stopped this session and run its whole teardown. Everything below binds
    // the editor TO that session — instrument addressing, the play-session
    // readers, the input gate, the store subscription — so without this guard a
    // Stop during boot re-installs all of it onto a game that no longer exists.
    // The Game inspection subject is the visible half: its whole lifetime
    // contract is "no runtime, no subject", and a registration published here
    // has no exit left to drop it. Same check the two boot awaits above make.
    // The install itself takes the same generation guard (it awaits too, and
    // used to overwrite the just-restored edit authoring on the way out), so
    // by the time this line runs there is genuinely nothing left to undo.
    if (epoch !== _playEpoch) return;

    // Wire physics sync THROUGH the first-party `RapierPhysicsAdapter`:
    // the gizmo path freezes a Rapier-owned body on beginEdit, commits the edited
    // pose each frame (the callback below), and unfreezes on release — so the
    // postPhysics writer doesn't snap the gizmo edit back. The editor speaks only
    // the `PhysicsAdapter` interface, never Rapier directly.
    // Install the GAME-scoped System-adapter aggregate (§7.1-3, probe1) — every
    // world's `mounted.systems` merged (first registration wins per key), NOT
    // just the default world's own copy (`firstParty(session).systems`, the
    // pre-fix read) — so a networking/etc. adapter registered from ANY world's
    // setup is visible to the editor's gizmo path + inspector panels.
    markPlayBootPhase('binding the editor to the running game');
    const systems = session.game.systemAdapters;
    // Register UNDER THIS MOUNT'S ID. Until now every mount registered as the
    // anonymous solo instance, so `systemsForInstance` had exactly one thing
    // it could ever resolve and the id it resolves BY was never produced —
    // the addressing layer was a switchboard with nothing plugged in.
    setActiveSystems(systems, mountId);
    setInspectedInstance(mountId);
    publishPlaySessionReaders();
    _instance.unsubscribeSystemAdapters?.();
    _instance.unsubscribeSystemAdapters =
      session.game.subscribeSystemAdapters?.(() => {
        updateInstanceSystems(session.game.systemAdapters, mountId);
      }) ?? null;

    // T6.3: gate game input (raw `window`/`document` listeners in game code via
    // gated-globals, AND the default world's first-party InputManager) to only
    // fire while play is actually running AND the Game tab is the focused
    // viewport — so keystrokes typed into the editor (Scene tab, inspector
    // fields) don't leak into the running game.
    // The gate is FOCUS-AWARE (`instanceInputActive`): input flows only while
    // play runs, the Game tab is active, AND this instance holds keyboard focus.
    // For a single instance focus is always the primary, so this is identical to
    // the pre-split behaviour; with a split, exactly the focused seat is live.
    // Same id, and that is the point: the realm this mount's project modules
    // resolve their gated `window`/`document` through is keyed by the mount id
    // baked into their own urls, so the gate has to be registered under it or
    // the modules find the default realm's gate instead of their own.
    setGameInputGate(() => instanceInputActive(mountId), mountId);
    // THE DEFAULT REALM follows the focused instance too. Module-lifetime code
    // that no mount id reaches lives there — a game's own `InputManager`
    // (`@volter/game-runtime`'s input, served through the realm shadow) — and
    // the stop path leaves it open, so a key aimed at a Model document while
    // the game played still reached it.
    setGameInputGate(() => instanceInputActive(focusedInstanceId()));
    // Sync EVERY live instance's first-party InputManager from the play/tab/
    // focus predicate whenever the store changes (a tab switch flips the active
    // viewport for all of them). `resyncInstanceInputs` resolves each
    // instance's `game.input` defensively — a session whose game handle has no
    // first-party InputManager (an ingest mount, a partial double) has only the
    // raw window/document gate above.
    resyncInstanceInputs();
    _unsubStore = store.shell.subscribe(resyncInstanceInputs);

    // Node-id keyed only: `setEcsSyncTransform` hands this an editor node id
    // and a THREE `Transform`, which a display-keyed carrier has no values for.
    const physics = nodeKeyedPhysics(systems.physics);
    store.setEcsSyncTransform((id, obj) => {
      // `commit` refuses an id this adapter cannot resolve rather than
      // returning as if the write landed — so ask before driving it.
      if (!physics || physics.ownerOf(id) === 'unresolved') return;
      physics.commit(id, {
        position: obj.position.toArray() as [number, number, number],
        rotation: obj.quaternion.toArray() as [number, number, number, number],
        scale: obj.scale.toArray() as [number, number, number],
      });
    });

    // Container may have been display:none when w/h were read above.
    // Now that the session exists, do one resize with the actual dimensions.
    // W2c: a device preset chosen BEFORE play must land its emulated DPR on
    // the fresh session too (mount pins `min(devicePixelRatio, 2)`), so an
    // active preset forces this resize even at an unchanged size.
    const emulatedDpr = deviceEmulatedPixelRatio();
    const actualW = gameContainer.clientWidth;
    const actualH = gameContainer.clientHeight;
    if (actualW > 0 && actualH > 0 && (actualW !== w || actualH !== h || emulatedDpr !== null)) {
      session.resize(actualW, actualH, emulatedDpr ?? undefined);
    }

    // Game is fully up: let the entry transition cross-fade once the camera
    // flight lands. The live-camera getter makes the flight converge on the
    // game's ACTUAL render camera (follow rigs / CameraDescriptor components may
    // have moved it during boot), so the hand-off is pixel-continuous.
    editorHost().viewport.transition.ready(() => {
      const game = _instance.session?.game;
      if (!game) return null;
      for (const world of game.roots) {
        if (world.mounted.kind === 'three') return world.mounted.camera;
      }
      return null;
    });
  } catch (err) {
    const msg = `Play mode failed to start: ${err}`;
    editorConsole.error(msg, 'play-mode');
    // Reclaim what THIS boot built but never handed over. `_instance.id` is
    // still `''` for every failure before the hand-off, so `exitPlayMode`'s own
    // teardown cannot see this mount at all: its `disposeInstanceRealm('')`
    // early-returns and its `clearGameSurface()` resets the DEFAULT realm.
    // Unconditional on the epoch — this realm and this session belong to THIS
    // boot and to nothing else, so a Stop that landed mid-boot (which skips the
    // `exitPlayMode` below) must not strand them either.
    if (bootMountId !== null && _instance.id !== bootMountId) {
      if (bootedSession) {
        try {
          bootedSession.stop();
        } catch (stopErr) {
          editorConsole.error(`Error stopping the failed play session: ${stopErr}`, 'play-mode');
        }
        disposeInstanceRealmAfterStop(bootedSession, bootMountId, 'Failed instance');
      } else {
        disposeInstanceRealm(bootMountId, 'Failed instance');
      }
    }
    // Roll back only if THIS play is still the live generation — if it was
    // already exited during boot (epoch moved on), a second exitPlayMode here
    // could tear down a newer play that started in the meantime.
    if (epoch === _playEpoch) exitPlayMode();
    throw new Error(msg);
  }
}

/**
 * Mount an ADDITIONAL instance of this project beside the primary one — the
 * cardinality half of multiplayer authoring (see the `_additional` doc).
 *
 * Valid only while the primary is playing. The returned id is the instance's
 * mount id (what `?vgai-mount=` carries and what `game.instance(id)`
 * addresses). This does the INSTANCE subset of `enterPlayModeInner` and none
 * of its session/focus work: it resolves its own mount epoch, mounts the roots
 * into `container`, registers a performance source and its System adapters
 * under the mount id, and leaves editor focus, the store scene, authoring, the
 * console patch and the camera transition entirely to the primary.
 */
export async function mountAdditionalInstance(
  container: HTMLElement,
  name?: string,
): Promise<string> {
  if (!_ctx) throw new Error('Cannot mount an additional instance: play mode is not bound.');
  if (!_instance.session) {
    throw new Error('Cannot mount an additional instance: no primary play session is running.');
  }
  // This function AWAITS (manifest fetch, entry resolution, the runtime mount);
  // play can STOP mid-flight (exitPlayMode bumps `_playEpoch` and nulls
  // `_instance.session`). The start guard above is stale by the time the awaits
  // finish, so capture the epoch and re-check it after mounting — otherwise
  // wiring this instance dereferences the torn-down primary (`_instance.session`
  // is null → "Cannot read properties of null (reading 'game')").
  const epoch = _playEpoch;
  const project = getCurrentProject();
  if (!project) throw new Error('Cannot mount an additional instance: no project is open.');
  const manifest = await fetchGameManifest();

  // Its OWN mount epoch → its own id and its own per-url module graph. No
  // `editorPreview`: an additional instance is not the focused editor
  // viewport, so it resolves without the viewport-camera injection the primary
  // threads in. The split watch is mount-scoped and these mounts are
  // sequential, so opening one around this mount cannot overlap the primary's.
  beginProjectModuleSplitWatch();
  const { entries, mountId } = await resolveAllRootEntries(manifest, project.rootPath, {
    selectionOverride: _playSelectionOverride ?? undefined,
  });
  if (!container.style.contain) {
    container.style.cssText += GAME_SURFACE_CONTAINMENT_CSS;
  }
  markGameCssScope(container);
  setGameSurface(container, mountId);
  const { mountManifestRoots } = await import('@volter/game-runtime/runtime/mount-manifest');
  const session = await mountManifestRoots({
    manifest,
    container,
    entries,
    width: container.clientWidth,
    height: container.clientHeight,
    playtest: _activePlaytest,
  });
  for (const split of endProjectModuleSplitWatch(project.rootPath)) {
    editorConsole.error(formatProjectModuleSplitMessage(split), 'play-mode');
  }

  // Play stopped (or restarted) while we were mounting: the primary this
  // instance would attach beside is gone. Abandon the freshly-mounted session
  // cleanly rather than wiring it against a null primary. Returning the id (not
  // throwing) keeps the caller's teardown a no-op — the instance was never
  // pushed to `_additional`, so its per-viewport unmount finds nothing.
  if (epoch !== _playEpoch || !_instance.session) {
    try {
      session.stop();
    } catch {
      // Best-effort teardown of an instance nothing will ever address.
    }
    disposeInstanceRealmAfterStop(session, mountId, name?.trim() || 'Cancelled instance');
    return mountId;
  }

  installAdapterRuntimeBindings(session.game);

  const inst = createPlayInstance();
  inst.id = mountId;
  // Its label: the caller's name, else the "Instance N" default for its position.
  inst.name = name?.trim() || instanceNameAt(_additional.length + 1);
  inst.container = container;
  inst.session = session;
  inst.unregisterPerformanceSource = registerPerformanceSource({
    id: `workspace:game:${mountId}`,
    label: `Game runtime (instance ${mountId})`,
    kind: 'game',
    instanceId: mountId,
    profiler: session.game.profiler,
  });
  const systems = session.game.systemAdapters;
  setActiveSystems(systems, mountId);
  inst.unsubscribeSystemAdapters =
    session.game.subscribeSystemAdapters?.(() => {
      updateInstanceSystems(session.game.systemAdapters, mountId);
    }) ?? null;
  // FOCUS-AWARE input, exactly like the primary: this instance takes the shared
  // keyboard only while it holds focus. It mounts UNFOCUSED (the primary keeps
  // focus), so its gate is closed and its InputManager is disabled until a click
  // on its viewport routes focus here (`setFocusedInstance`). This is what stops
  // the pre-focus bug where every seat took the same keystroke, AND what lets
  // you drive a chosen seat manually rather than only via autoplay.
  setGameInputGate(() => instanceInputActive(mountId), mountId);
  _additional.push(inst);
  // Now that it is in `_additional`, sync its (and every) InputManager to the
  // current focus — disabled here, since the primary is focused.
  resyncInstanceInputs();

  // `setActiveSystems` moved editor focus (`getActiveSystems`) onto the newer
  // mount. The user is still authoring the PRIMARY, so restore its focus
  // without disturbing either instance's addressed registration.
  const primarySystems = _instance.session.game.systemAdapters;
  setActiveSystems(primarySystems, _instance.id);

  notifySessionListeners();
  return mountId;
}

/** Live additional-instance ids, in mount order — for the Game view and tests. */
export function additionalInstanceIds(): string[] {
  return _additional.map((inst) => inst.id);
}

/** Every live instance as `{ id, name }`, primary first — what `list-instances`
 *  surfaces so a driver/HUD can show which mount is "Instance 2" without the
 *  instance layer learning a game-specific role. Only genuinely-mounted
 *  instances (a real id) are included. */
export function instanceEntries(): { id: string; name: string }[] {
  const entries: { id: string; name: string }[] = [];
  if (_instance.id) entries.push({ id: _instance.id, name: _instance.name });
  for (const inst of _additional) if (inst.id) entries.push({ id: inst.id, name: inst.name });
  return entries;
}

function instanceNameForId(id: string): string | undefined {
  if (_instance.id === id) return _instance.name;
  return _additional.find((instance) => instance.id === id)?.name;
}

function disposeInstanceRealm(id: string, name: string): void {
  // An empty id means this run never resolved a composition, so it never
  // created a realm of its own. (A failed boot that DID get that far reclaims
  // its realm through `bootMountId` in `enterPlayModeInner`'s catch, which is
  // why this guard can stay.)
  if (!id) return;
  clearGameSurface(id);
  reclaimGameRealm(id, name);
}

/** A native React reconciler may finish component effect cleanup after the
 * synchronous stop() call returns. Audit the game realm only once every root
 * says that cleanup has landed; otherwise the editor races the owner, reclaims
 * listeners itself, and files a false leak warning. */
function disposeInstanceRealmAfterStop(session: GameSession, id: string, name: string): void {
  void session.stopComplete.then(() => disposeInstanceRealm(id, name));
}

/** Tear down ONE additional instance by its mount id. Idempotent: a no-op if
 *  the id is not (or no longer) a live additional instance, so the Game view's
 *  per-viewport unmount and `exitPlayMode`'s bulk teardown can both fire for
 *  the same instance without a double stop. */
export function unmountAdditionalInstance(id: string): void {
  const idx = _additional.findIndex((inst) => inst.id === id);
  if (idx < 0) return;
  const [inst] = _additional.splice(idx, 1);
  if (!inst) return;
  inst.unsubscribeSystemAdapters?.();
  inst.unsubscribeSystemAdapters = null;
  const stoppingSession = inst.session;
  try {
    stoppingSession?.stop();
  } catch (err) {
    editorConsole.error(`Error stopping additional instance ${inst.id}: ${err}`, 'play-mode');
  }
  inst.unregisterPerformanceSource?.();
  setActiveSystems(null, inst.id);
  if (stoppingSession) disposeInstanceRealmAfterStop(stoppingSession, inst.id, inst.name);
  else disposeInstanceRealm(inst.id, inst.name);
  inst.container = null;
  inst.session = null;
  // If the removed instance held keyboard focus, focus falls back to the primary
  // (`focusedInstanceId` already resolves a stale id to it); re-sync so the
  // primary's InputManager re-enables, and notify the viewport highlight.
  if (_focusedInstanceId === id) {
    _focusedInstanceId = null;
    resyncInstanceInputs();
    notifyFocusedInstance();
  }
  notifySessionListeners();
}

/** Tear down every additional instance. Called by `exitPlayMode`; each stops
 *  its session and stops being addressable, symmetrically with the primary. */
function unmountAdditionalInstances(): void {
  // Snapshot ids first — `unmountAdditionalInstance` mutates `_additional`.
  for (const id of additionalInstanceIds()) unmountAdditionalInstance(id);
}

/**
 * The desired split-screen layout, as the LABELS of the instances to show
 * (index 0 is the primary). This is the single source of truth for both how
 * many viewports the Game view renders and what each is named — a name is a
 * hint (see `PlayInstance.name`), never the mechanism. `[]` means no split
 * (one instance, no badges). Driven by `set-instance-count` /
 * `editor.instances(n | names[])`; reset on exit so a fresh play starts single.
 */
let _instanceNames: string[] = [];
const extraInstanceListeners = new Set<() => void>();

/** The default label for the instance at `index` (0 = primary). When the
 *  game's RUNTIME `NetworkingAdapter` exposes `getPlayerIdentity` (an OPTIONAL
 *  capability a game implements only if it has a real, game-defined identity —
 *  the editor never fabricates one), the PRIMARY instance reads that name off
 *  the adapter instead of the generic default. The editor reads the adapter,
 *  never infers: no adapter, no identity member, or a non-multiplayer game all
 *  fall back to "Instance N". The edit-time adapter deliberately provides no
 *  identity, so before Play every mount is "Instance N" unless a running game
 *  supplies one. Only the primary (index 0) maps to the identity; the extras
 *  are additional local seats and keep the numbered default. */
function defaultInstanceName(index: number): string {
  if (index === 0) {
    const authored = getActiveNetworking()?.getPlayerIdentity?.()?.name?.trim();
    if (authored) return authored;
  }
  return `Instance ${index + 1}`;
}

/** How many instances BESIDE the primary the Game view should show. */
export function desiredExtraInstances(): number {
  return _instanceNames.length === 0 ? 0 : _instanceNames.length - 1;
}

/** The label for the instance at `index` (0 = primary) — the explicit name if
 *  one was given, else the "Instance N" default. */
export function instanceNameAt(index: number): string {
  return _instanceNames[index] ?? defaultInstanceName(index);
}

export function subscribeExtraInstances(listener: () => void): () => void {
  extraInstanceListeners.add(listener);
  return () => extraInstanceListeners.delete(listener);
}

function notifyExtraInstances(): void {
  for (const listener of extraInstanceListeners) listener();
}

/** Set how many EXTRA instances (beyond the primary) the Game view shows, with
 *  default "Instance N" labels. Clamped at 0; the view reconciles to match. */
export function setDesiredExtraInstances(count: number): void {
  const extra = Math.max(0, Math.floor(count));
  setDesiredInstanceNames(
    extra === 0 ? [] : Array.from({ length: extra + 1 }, (_v, i) => defaultInstanceName(i)),
  );
}

/** Set the split layout by explicit labels (index 0 = primary). `names.length`
 *  is the TOTAL instance count; `[]` or a single name collapses to no split. */
export function setDesiredInstanceNames(names: string[]): void {
  const next =
    names.length <= 1 ? [] : names.map((n, i) => (n?.trim() ? n.trim() : defaultInstanceName(i)));
  if (next.length === _instanceNames.length && next.every((n, i) => n === _instanceNames[i]))
    return;
  _instanceNames = next;
  notifyExtraInstances();
}

/**
 * Exit play mode: stop game, remove canvas, re-enable editor.
 */
export function exitPlayMode(): void {
  // Cancel an in-flight boot even if the editor has not bound Play yet.
  _playEpoch++;
  cancelPendingWorkspacePlayUtilities();
  if (!_ctx) return;
  // The SAFETY NET for this run's recording, not its normal close.
  //
  // The relayed `stop` awaits `endPlayRecording('stop')` before calling this
  // (`command-listener.ts`), which is the ordered close. What reaches here
  // unclosed is every OTHER exit — the Play bar's Stop button, Escape, a boot
  // failure's rollback — and this function is synchronous, so the finalize can
  // only be fired, not awaited. It is idempotent and a no-op when the ordered
  // close already ran.
  void endPlayRecording('teardown');
  // No runtime, no Game subject and no `play` props — unconditionally, and
  // before the ingest early-return below, so no exit path can leave the play
  // surface's empty state (or a contribution) holding a game that has stopped.
  dropPlaySessionReaders();
  _playSelectionOverride = null;
  // A play run this editor handed to the ingest routes is theirs to end —
  // there is no first-party session, adopted scene or root authoring here to
  // tear down, and running the rest of this function over one would clear
  // state the ingest teardown owns. Returns false for every other run.
  if (exitDeferredIngestPlay(_ctx.store)) return;
  _activePlaytest = null;
  // Keyboard focus resets so the next play starts with the primary focused.
  _focusedInstanceId = null;
  notifyFocusedInstance();
  // PD-1: `_playStartedAtMs` is NOT cleared here — see its declaration. The
  // next enterPlayMode re-stamps it; clearing it on exit blinded every
  // `pageErrors` reader to the failure that caused the exit.
  const { store } = _ctx;
  // Drain while the session/debug registry still exists. Stopping disposes
  // it, and the last pickup/win event is often emitted inside the final 200ms
  // interval before Stop.
  drainDebugEventsToPlayLog();

  // Additional instances stop WITH the session — the primary owns the play
  // lifecycle, so its exit ends every instance mounted beside it. Before the
  // primary teardown so their sessions/registrations are gone first. Reset the
  // desired split too, so the next play starts single-view.
  setDesiredExtraInstances(0);
  unmountAdditionalInstances();

  // Reverse the entry transition first: restore the pre-play editor camera,
  // re-materialize the dock chrome, re-enable layout persistence. Idempotent
  // and safe on every exit path (Stop, Escape, boot failure, restart).
  editorHost().viewport.transition.end();

  // Restore the viewport host's prior authored subject before stopping (the
  // runtime owns the presented native tree and may dispose it during stop).
  store.setEcsSyncTransform(null);
  // Unregister everything this mount registered under ITS id, so a stopped
  // instance stops being addressable instead of lingering as a bag that still
  // answers commands. Captured before anything clears it, because the gate is
  // released further down. `''` when play never got as far as resolving a
  // composition — which is exactly the id such a run would have used, if any.
  const mountId = _instance.id;
  const instanceName = _instance.name || 'Game instance';
  _instance.id = '';
  _instance.unsubscribeSystemAdapters?.();
  _instance.unsubscribeSystemAdapters = null;
  setActiveSystems(null, mountId);
  _instance.presentation?.dispose();
  _instance.presentation = null;
  exitPlayRootAuthoring(store);
  restorePriorAuthoring();
  // Readout-only — clear the regime the moment play is no longer active.
  store.shell.setPlayEditRegime(null);

  // Always null _instance.session even if stop() throws — otherwise enterPlayMode's
  // `if (_instance.session) return` guard would permanently block re-entering play mode.
  const stoppingSession = _instance.session;
  if (stoppingSession) {
    try {
      stoppingSession.stop();
    } catch (err) {
      editorConsole.error(`Error stopping play session: ${err}`, 'play-mode');
    } finally {
      _instance.unregisterPerformanceSource?.();
      _instance.unregisterPerformanceSource = null;
      _instance.session = null;
      _instance.determinismDeclared = false;
      notifySessionListeners();
    }
  }
  if (stoppingSession) disposeInstanceRealmAfterStop(stoppingSession, mountId, instanceName);
  else disposeInstanceRealm(mountId, instanceName);

  // RESOURCE OWNERSHIP: exactly the roots THIS play run recorded, dropped by
  // this run's one teardown. Per-id rather than a blanket clear, because a
  // deferred ingest root mounted beside this session records its own readiness
  // through its own lifecycle and its answer is still true.
  for (const rootId of _hostMountedReadyRootIds) clearRootReadiness(rootId);
  _hostMountedReadyRootIds = [];

  // Cleanup subscriptions
  _unsubStore?.();
  _unsubStore = null;

  // T6.3: no game running — game input (raw window/document listeners AND the
  // InputManager sync above) should never be suppressed again until the next
  // play session re-gates it. The mount's own gate is DROPPED rather than set
  // to always-true: its id is never reused, so overwriting would retain one
  // dead closure per play run.
  setGameInputGate(() => true);
  clearGameSurface();

  _instance.resizeObserver?.disconnect();
  _instance.resizeObserver = null;

  if (_escapeListener) {
    window.removeEventListener('keydown', _escapeListener);
    _escapeListener = null;
  }

  // Log before clearing sink so this message gets persisted
  editorConsole.log('Play mode stopped', 'play-mode');

  // PD-3 — a stopped session has no live roots to disagree, so its split
  // reports must not outlive it (the PD-1 lesson: a diagnostic that cannot
  // go back to healthy is worse than none).
  clearProjectModuleSplitReports();

  // Flush remaining log entries and end session
  if (_flushInterval) {
    clearInterval(_flushInterval);
    _flushInterval = null;
  }
  // The interval is only the steady-state drain. Stop is a boundary of its
  // own: debug events emitted after the last 200ms turn are still evidence and
  // must join the same awaited queue before the server closes the session.
  drainDebugEventsToPlayLog();
  editorConsole.setSink(null);
  if (_pendingEntries.length > 0) {
    const batch = _pendingEntries.splice(0);
    _logFlushChain = _logFlushChain.then(() => flushLogEntries(batch));
  }
  // The server has one active log file. End it only after every queued batch
  // has reached the append endpoint, otherwise Stop can race the final fetch
  // and silently discard the most useful end-of-run evidence.
  _logFlushChain = _logFlushChain.then(() => endLogSession());

  unpatchConsole();

  // setPlayState('stopped') auto-switches back to the Edit tab, and its
  // live → stopped edge is what normally closes the Game document. A play
  // that FAILED before ever flipping the store to 'playing' never produces
  // that edge, so release directly too — `releaseGameDocument` is the one
  // idempotent teardown path either way (`game-document.ts`).
  store.shell.setPlayState('stopped');
  editorHost().workspace.liveDocument.release();
  // LAST — the run's error window closes only once teardown is done, so every
  // error this teardown itself logged still belongs to the run that caused it
  // (PD-1). Errors after this instant are the SESSION's, and the
  // `sessionErrors` facet is what reports them.
  //
  // Guarded on the window actually being OPEN: this function is idempotent and
  // callers invoke it unconditionally (the `stop` command relays here even when
  // nothing is playing, and the lease-void teardown can fire while stopped). An
  // unconditional stamp would move a CLOSED window's end forward on every
  // redundant stop, silently reclassifying the session errors logged since the
  // real end back into the play-fenced facets — which the CLI only prints while
  // play is live. That is the exact hiding this window exists to end.
  if (_playStartedAtMs !== null && _playEndedAtMs === null) _playEndedAtMs = Date.now();
}

/**
 * Pause play mode: freeze game, allow editor inspection.
 */
export function pausePlayMode(): void {
  if (!_instance.session || !_ctx) return;
  // Freeze EVERY seat, not just the primary — a paused split with the extras
  // still ticking is not paused.
  for (const inst of allLiveInstances()) inst.session?.pause();
  _ctx.store.shell.setPlayState('paused');

  editorConsole.log('Play mode paused', 'play-mode');
}

/**
 * Resume play mode from pause.
 */
export function resumePlayMode(): void {
  if (!_instance.session || !_ctx) return;

  for (const inst of allLiveInstances()) inst.session?.resume();
  _ctx.store.shell.setPlayState('playing');

  editorConsole.log('Play mode resumed', 'play-mode');
}

/**
 * Step one fixed-timestep frame while paused.
 */
export function stepPlayMode(): void {
  if (!_instance.session) return;
  for (const inst of allLiveInstances()) inst.session?.step();
}

// --- Console patching ---

function patchConsole(): void {
  // LAYERING (the full note lives on `installEditorConsoleCapture` in
  // `editor-console.ts` — read the two together). The session-lifetime capture
  // installed at editor boot is what `console.error`/`console.warn` currently
  // ARE, so the wrappers below sit OUTSIDE it and call through to it. While
  // this run is live THIS patch owns the funnel and tags entries 'game' — the
  // more specific answer — so the boot capture must not also push the same
  // message as 'editor'. Suspend it for exactly the lifetime of this patch.
  suspendEditorConsoleCapture();
  _originalConsoleLog = console.log;
  _originalConsoleInfo = console.info;
  _originalConsoleWarn = console.warn;
  _originalConsoleError = console.error;

  const capture = (level: ConsoleEntry['level'], args: readonly unknown[]) => {
    if (_engineLogActive) return;
    const instanceId = currentGameRealmMountId();
    editorConsole.logStructured(
      level,
      formatConsoleArgs(args),
      'game',
      undefined,
      instanceId
        ? { instanceId, instanceName: instanceNameForId(instanceId) ?? `Instance ${instanceId}` }
        : undefined,
    );
  };

  console.log = (...args: unknown[]) => {
    _originalConsoleLog?.apply(console, args);
    capture('info', args);
  };
  console.info = (...args: unknown[]) => {
    _originalConsoleInfo?.apply(console, args);
    capture('info', args);
  };
  console.warn = (...args: unknown[]) => {
    _originalConsoleWarn?.apply(console, args);
    capture('warn', args);
  };
  console.error = (...args: unknown[]) => {
    _originalConsoleError?.apply(console, args);
    capture('error', args);
  };
}

function unpatchConsole(): void {
  // Hand the funnel back to the boot-installed session-lifetime capture
  // (`editor-console.ts`) — restoring the saved originals below re-exposes its
  // wrappers, and this is what lets them push to the store again.
  resumeEditorConsoleCapture();
  if (_originalConsoleLog) console.log = _originalConsoleLog;
  if (_originalConsoleInfo) console.info = _originalConsoleInfo;
  if (_originalConsoleWarn) console.warn = _originalConsoleWarn;
  if (_originalConsoleError) console.error = _originalConsoleError;
  _originalConsoleLog = null;
  _originalConsoleInfo = null;
  _originalConsoleWarn = null;
  _originalConsoleError = null;
}

// THE PLAY LANE, as the host sees it: the host stops asking this module by
// name and asks its live-session registry instead. Registered at the module's
// LOAD, which the contribution loader performs for every module this package
// declares — so the lane exists from the moment a project that depends on
// `@volter/editor-game` opens, long before anything asks to play.
editorHost().live.register({
  id: 'play',
  priority: 0,
  mounted: isPlayModeActive,
  playing: isPlayModeActive,
  stop: exitPlayMode,
  instanceContainer: (id) => getInstanceContainer(id),
  startedAt: getPlayStartedAt,
  endedAt: getPlayEndedAt,
  restartRequired: getRestartRequiredReason,
  restart: () => void enterPlayMode(),
  // The live remount `open-scene` asks for: a scene entry opened while Play
  // runs re-serves the realm rather than restarting the session.
  remount: async (args) => {
    try {
      await enterPlayMode(undefined, undefined, undefined, args);
      if (!isPlayModeActive()) {
        return {
          ok: false,
          error: 'Play did not start: the remount was superseded before it finished booting.',
        };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});

// What only Play knows of the state report (`host.session.reportFacet`):
// `vgai status --json` spreads these beside the host's own fields.
editorHost().session.reportFacet(() => ({
  // The live loop's time-scale, so `play.status` reports the real applied
  // value after a `set-time-scale` instead of an honest-gap null.
  timeScale: getPlayRuntimeAccess()?.loop.timeScale ?? null,
  // Issue #175 — the REAL loop liveness (`GameLoop.liveness`), NOT the
  // store's playState: that stays 'playing' even while the host loop reports
  // `loop-starved` (no recent rAF progress — see game-loop.ts). Reading only
  // playState is exactly the gap that let a frozen game report as healthy
  // (measured: playState "playing", sim speed 0.00x over 32.9s wall). `null`
  // outside play mode — there is no loop to report on.
  loopLiveness: getPlayRuntimeAccess()?.loop.liveness ?? null,
  // The pending-restart reason the PlayBar's Restart button is currently
  // surfacing (source changed while the game is running — e.g. an R3F entry
  // write-back, a registry.ts edit), or null when the running session is
  // fresh. Agents need the same "your running game is stale, restart play"
  // signal humans get.
  restartRequired: getRestartRequiredReason(),
  // D15/T-D15.6: the live session's ctx.random root seed (real — reflects the
  // boot seed or the last successful play.seed.set), and whether the running
  // project declares determinism.seededRandom at all. Both null/false when no
  // first-party Game is running.
  seed: getPlayRuntimeAccess()?.random?.seed ?? null,
  deterministic: getPlayRuntimeAccess()?.determinismDeclared ?? false,
}));
