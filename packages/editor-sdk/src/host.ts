/**
 * THE HOST DOOR — what a PACKAGE's contribution may read of the running
 * editor (ARCHITECTURE-CORE §The workbench, "direction": a package imports
 * only other packages' exports, never the host's internals).
 *
 * The editor registers this at boot as MODULE STATE, the same door shape as
 * `registerProjectModuleLoader` in `contributions.ts`: the SDK is one
 * identity in the editor's program (Vite dedupes it), so a contribution
 * served from a package sees the editor's registration. The surface is
 * deliberately small and grows one member per contribution that needs it;
 * a member nobody reads is cut.
 *
 * Reading it outside a host — in a test, or a package's own tooling — throws
 * by name rather than answering with an empty session: an inspector that
 * silently reads "no adapter" is a measurement nobody made.
 */

import type {
  AudioAdapter,
  MountedRoot,
  NetworkingAdapter,
  StoriesProvider,
  SystemAdapters,
} from '@volter/editor-project/adapter';
import type { ComponentType } from 'react';
import type { DocumentEntry } from '@volter/editor-project/adapter/adapter-module';
import { useSyncExternalStore } from 'react';
import type * as THREE from 'three';
import type { StageTransportHandle } from './transport';

/**
 * THE STORY RUNTIME'S DOORWAY — the URL a package dynamic-imports to reach
 * Storybook's `composeStories`/`setProjectAnnotations` and React DOM's
 * `createRoot`/`flushSync` FROM THE PROJECT'S OWN MODULE GRAPH, rather than
 * from the shell's copy.
 *
 * It is here because it is the host's statement about what it serves, and a
 * package may not reach into the host's build tier to read it: the address
 * lived in `packages/editor/vite-plugin-module-doorways.ts`, which serves it,
 * and the story runtime imported it back out through a specifier that stepped
 * out of the editor's `src/` entirely. The plugin still OWNS the
 * doorway — what it serves, and why the mount would otherwise get a second
 * React (its doc comment carries the measured failure) — and now spells the
 * address by importing this constant, so there is one spelling and the package
 * reads it through the published door like any other host fact.
 */
export const STORY_RUNTIME_PATH = '/__vgai-story-runtime';
/** Project-owned React/Three namespace shared by preview consumers and the server. */
export const R3F_RUNTIME_PATH = '/__vgai-r3f-runtime';
/** The game runtime's R3F entry resolver, served from the project's graph. */
export const R3F_ENTRY_RUNTIME_PATH = '/__vgai-r3f-entry-runtime';
/** The project's React and world-state provider for a React world mount. */
export const REACT_WORLD_RUNTIME_PATH = '/__vgai-react-world-runtime';
/** The project's Pixi and canvas entry resolver for a canvas root mount. */
export const CANVAS_RUNTIME_PATH = '/__vgai-canvas-runtime';
/** The project's three.js and post-processing for an ingested three root. */
export const THREE_INGEST_RUNTIME_PATH = '/__vgai-three-ingest-runtime';

/** The live session's system adapters, as the editor inspects them: the
 *  instance under inspection when several run, the solo one otherwise. */
export interface EditorHostSystems {
  /** Every adapter the inspected session registered, as one object. */
  inspected(): SystemAdapters;
  /** Fires when the inspected instance or its adapters change. */
  subscribe(listener: () => void): () => void;
  inspectedNetworking(): NetworkingAdapter | null;
  /** Fires when the inspected networking adapter appears, changes or leaves. */
  subscribeNetworking(listener: () => void): () => void;
  inspectedAudio(): AudioAdapter | null;
  /** Fires when the inspected audio adapter appears, changes or leaves. */
  subscribeAudio(listener: () => void): () => void;
  /** Monotonic counter behind {@link subscribeAudio}, for `useSyncExternalStore`. */
  audioVersion(): number;
}

/** The editor's ONE shared availability heartbeat (250ms, refcounted): the
 *  signal for out-of-band changes a live session makes without notifying a
 *  store — an adapter's connection state, a reader appearing. */
export interface EditorHostAvailability {
  subscribe(listener: () => void): () => void;
  version(): number;
}

export interface EditorHostWorkspace {
  /** Reveal a bottom-drawer utility by its registered id (`tool:<id>` for a
   *  contributed one). */
  showUtility(id: string): void;
  /** Open a contributed `workspace.document` by its contribution id
   *  (`my-tool.document`); false when no such document is registered. */
  openContributedDocument(id: string): boolean;
  /**
   * Open a document by ADDRESS — `{ kind, …the kind's own fields }` — through
   * the host's document-open registry. The SDK names NO document kind: the
   * caller spells the address its own package registered (or that another
   * package in the build did), the host routes it, and a kind with no
   * registered opener answers `false` instead of pretending.
   *
   * It is the async form on purpose. A kind may need to SETTLE — re-read the
   * ledger it opens documents out of — before it can answer, which is exactly
   * what a package that just WROTE the subject needs (a generated story,
   * addressed `{ kind: 'story', modulePath, storyName }` the moment the file
   * exists).
   */
  open(address: { readonly kind: string } & Record<string, unknown>): Promise<boolean>;
  readonly liveDocument: EditorHostLiveDocument;
}

export interface LiveDocumentContentProps {
  readonly documentId: string;
  /** Whether the document is the active center tab. */
  readonly active: boolean;
}

/** What a lane renders inside the live document: the panel a runtime mounts
 *  into, and its document-local toolbar. */
export interface LiveDocumentContent {
  readonly Content: ComponentType<LiveDocumentContentProps>;
  readonly Toolbar?: ComponentType<LiveDocumentContentProps>;
}

/**
 * THE LIVE DOCUMENT — the host's one center document for running content
 * (id `workspace:game`, title `Game`). It exists exactly as long as a
 * runtime does: a lane `acquire`s it before mounting (open + activate, then
 * wait for the panel's container to commit) and the host closes it on the
 * playing → stopped edge, handing focus back. The panel's element is the
 * live CONTAINER every lane mounts into; the content that draws the panel
 * is registered by the package that runs things.
 */
export interface EditorHostLiveDocument {
  readonly id: string;
  register(content: LiveDocumentContent): () => void;
  /** Resolves false when the panel did not commit in time (report it as
   *  the lane's own start failure — never mount into nothing). */
  acquire(timeoutMs?: number): Promise<boolean>;
  release(): void;
  open(): boolean;
  container(): HTMLElement | null;
  /** The panel's attach/detach halves — detach is keyed by the element so a
   *  stale panel's cleanup never empties a newer panel's slot. */
  setContainer(el: HTMLElement): void;
  releaseContainer(el: HTMLElement): void;
}

/** The open documents, as a contribution may read them. */
export interface EditorHostDocuments {
  activeId(): string | null;
  /** The active document's kind (`'workspace'`, `'tool-contribution'`, …)
   *  and title, or null with none open. */
  active(): { readonly id: string; readonly kind: string; readonly title: string } | null;
  subscribe(listener: () => void): () => void;
  version(): number;
  /**
   * THE DOCUMENT'S OWN PUBLISHED CONTEXT — the one object a document hands the
   * host to be driven through (`editor.document.run(ctx => …)`, the REPL
   * door), or `undefined` when that document published none.
   *
   * NEW (2026-09-19) because the document a package DRIVES is not always the
   * document it opened: `@vgai/blender` presents every Blender frame into the
   * Model document, which `@vgai/blender` contributes and publishes — so the two
   * packages meet at this registry and neither may reach the host's
   * `@editor/document-context-registry` to find it. The value is `unknown` on
   * purpose: what a document publishes is an agreement between the package
   * that renders it and the package that drives it, and the host is not a
   * party to it — the caller narrows, and refuses by name when the shape is
   * not the one it needs.
   */
  context(documentId: string): unknown;
  /**
   * The same read, where the caller can WAIT. Opening a document activates its
   * tab before an async model import can publish a context, so a driver that
   * read once would mistake a loading document for an unsupported one.
   * Resolves `undefined` when the window elapses.
   */
  waitForContext(documentId: string, timeoutMs?: number): Promise<unknown>;
  /**
   * THE PUBLISHED CONTEXT HAS MOVED — said by the package that DRIVES this
   * document, which is not always the package that published it.
   *
   * NEW (2026-09-19, WORK.md §Blender in the tab is Blender, "Inspection
   * parity", I1) because a context object is a LIVE HANDLE: `@vgai/blender`
   * reads the engine through its RNA door, and that answer decides which
   * Properties tabs exist for the selected datablock — an armature has a Bone
   * tab, a cube does not. Nothing in the host's own stores moves when the
   * engine answers, so the inspector had no reason to re-compose and the rail
   * stayed at whatever the first render could see. Calling this re-derives the
   * whole inspection, matches included.
   *
   * It is a notification, not a publication: the context object itself is
   * unchanged, and a document that published none is a no-op.
   */
  contextChanged(documentId: string): void;
}

/**
 * The project's editor-local state document (`.vgai/editor-state.json`):
 * per-project preferences a contribution keeps — pins, collapsed sections —
 * that are neither the game's data nor a person's global settings. One
 * section per contribution, named by it.
 */
export interface EditorHostProjectLocalState {
  ready(): boolean;
  read<T>(section: string): T | undefined;
  write(section: string, value: unknown): void;
  /** The open project's root path, or null on a tier with none. */
  projectRootPath(): string | null;
}

/**
 * A LANE that mounts something in the tab — Play, an ingested game, a module
 * world — as the host sees it. A package registers its lane and the host asks
 * only these questions; it never names the lane.
 */
export interface LiveSession {
  readonly id: string;
  /** `stop` order among lanes, low first (Play before ingest). */
  readonly priority?: number;
  /** A real game owns a canvas right now. */
  mounted(): boolean;
  /** Somebody asked the host to RUN content; a held mount is not playing. */
  playing(): boolean;
  /** Idempotent; a no-op when the lane runs nothing. */
  stop(): void;
  /** The element holding a live instance (the primary when `id` is omitted). */
  instanceContainer(id?: string): HTMLElement | null;
  /** When this lane's most recent run began / ended (ms epoch); the host
   *  fences per-run diagnostics on the newest window across lanes. */
  startedAt?(): number | null;
  endedAt?(): number | null;
  /** Why the running content is stale (a source edit the run cannot absorb),
   *  or null while it is fresh; `restart` is the lane's own re-entry. */
  restartRequired?(): string | null;
  restart?(): void;
  /** Re-mount with an authored selection while running; absent when the lane
   *  cannot. */
  remount?(args: LiveRemountArgs): Promise<{ ok: true } | { ok: false; error: string }>;
  /** The canvas this lane's own render pass draws, when its pixels can only
   *  be read from inside that pass (no `preserveDrawingBuffer`); the host's
   *  frame capture asks `snapshotFrame` for it. */
  frameCanvas?(): HTMLCanvasElement | null;
  snapshotFrame?(): Promise<CanvasImageSource | null>;
  /** Why authoring is OFF for this lane's content (an ingested native-React
   *  game has no scene graph to introspect), or null when it is on; the
   *  inspector prints it in place of its sections. */
  authoringRefusal?(): string | null;
  /** A relayed command this lane answers ITSELF, ahead of every handler —
   *  an ingested game owns its mount, so `play`/`stop`/`pause`/`resume`/
   *  `step` drive its own loop rather than boot a first-party session over
   *  it. Null declines; the host then dispatches as usual. */
  command?(cmd: LiveCommand): LiveCommandResult | null;
  /** The scene entries the running content navigates (a contract game's
   *  scene table), for `open-scene` on a running lane. */
  scenes?(): LiveSceneTable | null;
  /** The native surface the running content draws on, when the lane knows
   *  it (an ingested game's declared surface); the host's coverage grades
   *  a root against it. */
  surface?(): 'three' | 'canvas' | 'dom' | null;
  /** The lane's OWN coverage of the running content's contracts (an
   *  ingested game's), shown by the inspector on the live document and
   *  standing in for the host's native-system grading while it runs. */
  coverage?(): LiveCoverageReport | null;
}

/**
 * What the running content answered about a switch it ACCEPTED — read off its
 * own current scene once the switch settled. `error` is the content's own
 * failure (a refused asset load, a throw), reported rather than swallowed; the
 * scene it is actually in is still reported beside it, because that is the
 * question the caller has next.
 */
export interface LiveSceneSwitchSettled {
  readonly requested: string;
  readonly current: string | null;
  readonly error?: string;
}

/**
 * A scene switch, split at the seam where the answer stops being immediate:
 * MEMBERSHIP is decided synchronously against the content's own scene list,
 * and only an accepted switch has a `settled` promise to await.
 *
 * The split is what lets the caller act on the refusal without waiting, and —
 * for the host's held-mount repaint — start drawing frames the instant a
 * switch is accepted rather than after it lands.
 */
export type LiveSceneSwitch =
  | { readonly ok: true; readonly settled: Promise<LiveSceneSwitchSettled> }
  | { readonly ok: false; readonly error: string; readonly known: readonly string[] };

/**
 * A running game's own scene table: its stories, plus the switch the host
 * awaits to open one.
 *
 * `goToScene`'s RESULT is stated here rather than left `unknown` for the
 * editor to narrow (as it was until 2026-09-18). The narrowing lived in a lane
 * module — the ingest lane's scenes projection — so the host's `open` verb had
 * to import that lane by name to know what a switch answers, which is how the
 * ingest contract reached the host's live registry. A contract states its own
 * result; a lane implements it.
 */
export interface LiveSceneTable extends StoriesProvider {
  goToScene(sceneId: string): LiveSceneSwitch;
}

/** One seam's verdict in a lane's own coverage report — the doctrine's row
 *  (ARCHITECTURE-CORE §Adapters never fabricate first-party data: a gap
 *  names the mechanism that fills it). */
export interface LiveCoverageRow {
  readonly seam: string;
  readonly status: 'ok' | 'gap' | 'na' | 'info';
  readonly detail: string;
  readonly missing?: string;
  readonly fix?: string;
  readonly attestedBy?: 'game' | 'host';
}

export interface LiveCoverageReport {
  readonly summary: {
    readonly worldId: string;
    readonly rows: number;
    readonly gaps: number;
    readonly ok: number;
    readonly na: number;
    readonly info: number;
  };
  readonly rows: readonly LiveCoverageRow[];
}

export interface LiveCommand {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface LiveCommandResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: Record<string, unknown>;
}

export interface LiveRunWindow {
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export interface EditorHostLive {
  register(session: LiveSession): () => void;
  mounted(): boolean;
  playing(): boolean;
  /** The newest run across lanes, or null before any ran. */
  runWindow(): LiveRunWindow | null;
  restartRequired(): string | null;
  /** Re-enter whichever lane reports a restart is required (or is running). */
  restart(): void;
  /** Fires on registration and whenever a lane says its state moved
   *  (`notifyChanged`). */
  subscribe(listener: () => void): () => void;
  version(): number;
  /** A lane's own state moved (restart-required, run window). */
  notifyChanged(): void;
  /** The mounted lane whose render pass owns `canvas`, asked for its pixels. */
  snapshotFrame(canvas: HTMLCanvasElement): Promise<CanvasImageSource | null> | null;
  frameCanvas(): HTMLCanvasElement | null;
  authoringRefusal(): string | null;
  /** The first mounted lane's own answer to `cmd`, or null when none claims it. */
  dispatch(cmd: LiveCommand): LiveCommandResult | null;
  /** The running lane's scene entries, or null. */
  scenes(): LiveSceneTable | null;
  surface(): 'three' | 'canvas' | 'dom' | null;
  coverage(): LiveCoverageReport | null;
}

/** A live instance's roots, presented as the authored viewport's subject. */
export interface ViewportPresentation {
  /** The root whose native subject the viewport shows. */
  readonly worldId: string;
  /** Restores the viewport's prior subject; idempotent. */
  dispose(): void;
}

/** The authored viewport's camera rig, while a viewport is mounted. */
export interface ViewportRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: { readonly target: THREE.Vector3; enabled: boolean; update(): void };
  /** The editor's own scene (helpers live on its editor layer). */
  readonly scene: THREE.Scene;
}

/**
 * ONE MOUNTED 3D STAGE, named by the document it draws. Every 3D document
 * mounts a stage of its own (ARCHITECTURE-CORE §One stage); this is the door
 * to a particular one, where {@link EditorHostViewport}'s singular members
 * are the door to whichever is primary.
 */
export interface EditorHostStage {
  /** The workspace document this stage draws. */
  readonly documentId: string;
  rig(): ViewportRig;
  /** As {@link EditorHostViewport.setHelper}, on this stage alone. */
  setHelper(kind: string, object: THREE.Object3D | null): void;
  /** Runs after THIS stage's own per-frame update; the return unsubscribes. */
  onFrame(fn: (dtSeconds: number) => void): () => void;
}

/**
 * THE AUTHORED VIEWPORT, as a lane that mounts something reaches it: the rig
 * a camera flight drives, the frame loop it rides, and the one verb that
 * swaps the viewport's subject for a live instance's roots (Play's adoption
 * of the running scene). Which native surface the viewport renders is the
 * host's; a lane that finds no rig (a headless tab, a project with no Three
 * root) mounts without one.
 *
 * THE SINGULAR MEMBERS ARE THE PRIMARY STAGE — the stage presenting live
 * roots if one is, else the FOCUSED stage, else the first bound. A camera
 * flight and Play's adoption want exactly that one, which is why they read
 * here and never enumerate.
 *
 * {@link stages} is EVERY mounted 3D stage. A helper is an `Object3D` and an
 * `Object3D` has one parent, so there is no "set it once for all stages": a
 * helper wanted on every stage is set on each stage through `stages()`, and
 * `onStages` is how a lane keeps up with stages that mount and unmount after
 * it made that pass.
 */
/** A mounted adapter surface offered to the viewport. Execution, input and
 * ticking stay with the caller; presentation requires only identity and mount.
 * A game's richer root instance can satisfy this interface directly.
 */
export interface ViewportRoot {
  readonly id: string;
  readonly mounted: MountedRoot;
}

export interface EditorHostViewport {
  rig(): ViewportRig | null;
  /** Null when the viewport has no subject among `roots` (no Three root). */
  presentRoots(roots: readonly ViewportRoot[]): ViewportPresentation | null;
  /** Runs after the viewport's own per-frame update; the return unsubscribes. */
  onFrame(fn: (dtSeconds: number) => void): () => void;
  /**
   * Show an editor-only helper object of `kind` in the authored viewport (a
   * baked navmesh's debug mesh), replacing the previous one of that kind;
   * null clears it. Visibility follows the host's Helpers menu: a kind the
   * menu lists (`navmesh`) toggles on its own, any other follows the master
   * toggle. Kept across viewport remounts.
   */
  setHelper(kind: string, object: THREE.Object3D | null): void;
  /** Every mounted 3D stage, in bind order. */
  stages(): readonly EditorHostStage[];
  /** Fires whenever a stage mounts or unmounts; the return unsubscribes. */
  onStages(fn: (stages: readonly EditorHostStage[]) => void): () => void;
  readonly transition: EditorHostLiveTransition;
}

/**
 * THE LIVE TRANSITION — the host's hand-off from authoring chrome to a
 * running lane: under the immersive presentation the dock dissolves, the
 * authored viewport's camera flies to the authored game camera, and when the
 * lane reports ready the Scene document cross-fades into the live one. The
 * host decides whether the presentation is immersive and resolves the flight
 * target itself; a lane only says when it starts, when it is ready, and when
 * it ends. Every path out of a run must reach `end()`.
 */
export interface EditorHostLiveTransition {
  /** Call BEFORE flipping the session to playing: the flight target is read
   *  from the authored scene, which Play's own adoption then replaces. */
  begin(): void;
  /** The lane finished its async boot; `getLiveCamera` is the render camera
   *  the flight converges on so the cross-fade is pixel-continuous. */
  ready(getLiveCamera?: () => THREE.Object3D | null): void;
  end(): void;
  /** Once the entry settles (cross-fade done, or torn down early) — at once
   *  when none is in flight. One-shot; re-check session state inside. */
  onSettled(fn: () => void): void;
  phase(): 'idle' | 'entering' | 'holding' | 'crossfade' | 'playing';
}

/** A lane's answer to the host's "re-mount with this selection" (an authored
 *  scene entry opened while the lane runs). */
export interface LiveRemountArgs {
  readonly selection: string;
  readonly key: string;
  readonly regionId: string;
}

/**
 * THE LIVE OBJECTS BY NODE ID — the world node IS the entity (CLAUDE.md), so
 * a contribution inspecting a live behavior (an XState machine on an
 * object's userData) resolves the hierarchy's node id to the object itself.
 * The map is the authored viewport's in Edit and the adopted live scene's
 * in Play; a reader must not hold an object across `subscribe` firings.
 */
export interface EditorHostHierarchy {
  object(id: string): THREE.Object3D | null;
  objects(): ReadonlyMap<string, THREE.Object3D>;
  /** Fires on any shell-store change (membership included). */
  subscribe(listener: () => void): () => void;
  version(): number;
}

/** The editor's own session state a contribution may read. */
export interface EditorHostSession {
  /** Announce work BEFORE entering it, on the existing heartbeat/phase channel.
   * Returns an idempotent end call; use finally, including on refusal.
   * Labels describe operations only, never scripts, model data or credentials.
   * Diagnostics only: this neither cancels work nor changes its deadline. */
  beginWork(label: string): () => void;
  /**
   * Contribute fields to the editor's state report (`vgai status`, the SDK's
   * `editor.state`): the collect runs on every report and its keys are
   * spread in. A lane reports what only it knows — its loop's time scale and
   * liveness, its seed — where the host reports the session. Returns the
   * unregister.
   *
   * EVERY registered collect runs on EVERY report, including the interaction
   * path's reusing one — so a facet whose derivation is expensive declares its
   * `reusableKeys` and reads them back off the `reuse` snapshot it is handed.
   * That is what let the COVERAGE REPORT families (`rootCoverage`,
   * `systemCoverage`, `projectCoverage`, `authoringCoverage`) stop being host
   * fields: their 76ms-to-1.3s derivation is exactly what
   * `command-listener.ts`'s `REUSABLE_DERIVED_FACETS` exists to keep off a
   * store notification, and the host's own docblock says the choice is the
   * CALLER's — "only the caller knows whether it is on a user's critical
   * path" — so no facet-side cache could have been the same answer. The
   * declared keys join that set: the host strips them from an interaction
   * PATCH by name (`currentStatePatch`), and the deferred full collect that
   * always follows makes them current again.
   */
  reportFacet(
    collect: (reuse: Record<string, unknown> | null) => Record<string, unknown>,
    options?: { readonly reusableKeys?: readonly string[] },
  ): () => void;
  /**
   * THE SESSION'S PERIODIC SAMPLE — the host's own five-second vitals tick
   * (`coverage/session-vitals.ts`), which a lane may hang a periodic
   * derivation of its own on. Returns the unsubscribe.
   *
   * A lane that wants "every few seconds, look at the session and say
   * something" subscribes HERE rather than starting a second interval: the
   * vitals sampler already owns the cadence, already runs on every realm, and
   * a package-owned timer beside it would sample the same session at a
   * different instant and report two answers for one moment. Listeners run
   * before the host's own reveal failsafe and invariant report, which is the
   * order the coverage union held when it was a host call on this tick.
   */
  onSample(fn: () => void): () => void;
  /** Every relayed command, by type, as it is dispatched — the signal an
   *  idle watchdog reads ("an agent still driving through `vgai eval` is
   *  not idle"). Returns the unsubscribe. */
  onCommandDispatched(fn: (type: string) => void): () => void;
  playState(): 'stopped' | 'playing' | 'paused';
  /** `'ephemeral'` while Play holds edits that will not persist; null otherwise. */
  playEditRegime(): 'ephemeral' | null;
  /** Fires on any shell-store change; select what you read. */
  subscribe(listener: () => void): () => void;
  version(): number;
  /**
   * Whether a PROJECT SESSION is open at all — the editor has a project and the
   * shell that edits it, so a document can be opened and something can be
   * presented into it.
   *
   * NEW (2026-09-19). `@vgai/blender` refuses every verb but its own status
   * read without one, so that a call arriving at a session-less page answers at
   * once instead of booting a Blender worker (gigabytes) into a page with
   * nowhere to show it. It took the same answer from the host's
   * `@editor/shell-store-door`; this is the question, without the store.
   */
  open(): boolean;
  /**
   * THIS PAGE'S SESSION ENDED — the tombstone every end goes through, graceful
   * (`vgai close`) or not (the server died, another session took the port).
   * Returns the unsubscribe.
   *
   * NEW (2026-09-19), and it is a RELEASE hook: a page told `tab-close` keeps
   * running (Chrome refuses `window.close()` for a tab a person opened), so a
   * package holding something the page cannot pay for holds it forever. The
   * measurement that bought it: two orphaned editor tabs held 13 GB and 7 GB of
   * resident Blender worker between them and put the box into a swap storm.
   * A lane that owns a worker, a socket or a device ends it here.
   */
  onEnded(fn: () => void): () => void;
  /** Save before an explicit session close, while HTTP and the relay are live.
   * Rejection cancels close; onEnded remains forced resource teardown. */
  onBeforeClose(fn: () => Promise<void>): () => void;
  /**
   * PUBLISH (or retract, with null) THIS LANE'S OUT-OF-PROCESS WORKER METER, so
   * the tab census carries it out on the heartbeat — the one channel that still
   * beats through a blocked main thread, which is why `reportFacet` above
   * cannot answer this: a wedged tab is exactly the tab whose state report
   * never arrives.
   *
   * A READ rather than a snapshot: an outstanding call's age has to be computed
   * at the instant it is reported, and the package is the side that has the
   * clock (a blocked worker cannot report on itself, and the side that POSTED
   * the call still knows when it did).
   *
   * The HOST owns the rest of the measurement — the main thread's own long
   * tasks, and which of them overlapped the call — and starts measuring when
   * the first meter arrives; the page's stalls are never a lane's to observe.
   *
   * `lane` is the name the census carries the meter under and `vgai status`
   * prints (`Blender`). One meter per name: publishing again under the same
   * name replaces it.
   */
  reportWorkerCallMeter(lane: string, read: (() => EditorHostWorkerCallMetrics) | null): void;
}

/**
 * A LANE'S WORKER CALLS, as numbers — what the tab census carries so that
 * `vgai status` can say a tab stopped answering and why.
 *
 * Times are milliseconds on `performance.now()`; counters are monotonic since
 * the lane's runtime was constructed. MEASUREMENT ONLY: nothing here cancels,
 * kills or budgets a call.
 */
export interface EditorHostWorkerCallMetrics {
  /** Age of the OLDEST outstanding call, or null when the worker is idle — the
   *  only field with a number during a wedge. */
  readonly inFlightMs: number | null;
  /** Duration of the newest completed call; null before the first one. */
  readonly lastCallMs: number | null;
  /** The longest call yet, counting an outstanding one at its current age. */
  readonly maxCallMs: number | null;
  /** Calls past 5s, and past 30s, since the runtime was constructed. */
  readonly callsOver5s: number;
  readonly callsOver30s: number;
  /** The newest call's window (`end` null while it is outstanding); the host
   *  intersects its own long tasks with it. */
  readonly lastCallWindow: { readonly start: number; readonly end: number | null } | null;
  /** The lane's own out-of-process memory in MB (a wasm module's linear
   *  memory), or null when it has none to report. */
  readonly wasmMemoryMB: number | null;
}

/** The open project's declared SHAPE, as a contribution may gate on it. */
export interface EditorHostProject {
  /** The declared document table after its contributed finders have settled.
   * A package starting a document before its UI mounts must resolve the real
   * project entries, not guess an id from an uninitialized view. */
  documentTable(): Promise<{ readonly entries: readonly DocumentEntry[]; readonly default: string | null }>;
  /** Whether the project declares at least one root that plays. */
  mounts(): boolean;
  /**
   * The engine version the OPEN project is pinned to
   * (`vgai.project.json`'s `engine.version`), or null when no project is
   * open — the same one source `ProjectHeader.tsx` renders, so a package's
   * version readout can never disagree with the host's.
   *
   * A primitive rather than the project object on purpose: `ActiveProject`
   * is a host internal, and the SDK's door grows one member per
   * contribution that needs it (`@vgai/blender`'s `workspace.status` version
   * item is the reader). Paired with {@link subscribe}, this is the whole
   * "current project + change" the door owes a contribution — and it is
   * stable enough for `useSyncExternalStore` without a snapshot cache.
   */
  engineVersion(): string | null;
  subscribe(listener: () => void): () => void;
  /**
   * Runs once the open project's authoring surfaces are READY — its scene
   * loaded and the edit-mode composite installed — the moment a lane may
   * auto-launch what the manifest declares (an ingest root). Listeners run
   * in registration order, each awaited; a project opened later fires it
   * again. Returns the unsubscribe.
   */
  onReady(fn: () => void | Promise<void>): () => void;
}

export interface EditorHostNotification {
  /** A stable id replaces an earlier notification with the same id. */
  readonly id?: string;
  readonly tone: 'info' | 'warning' | 'error';
  /** One line, bold — what happened. */
  readonly title: string;
  /** The rest, plain — what it means, what to do. */
  readonly detail?: string;
  readonly actions?: readonly {
    readonly label: string;
    readonly run: () => void;
    readonly primary?: boolean;
  }[];
}

/** The editor's console — the session-held set `vgai console` prints. A
 *  contribution's diagnostics go here, never to `console.*`, so they reach
 *  every door whether or not anyone looks at the tab. */
export interface EditorHostConsole {
  log(message: string, source: string): void;
  warn(message: string, source: string): void;
  error(message: string, source: string): void;
}

/**
 * THE SETTINGS DOOR — one dotted `vgai.*` key at a time, with the LAYER each
 * value came from, and the one write that lands where it wins.
 *
 * ARCHITECTURE-CORE §The core is Code-OSS: *"the settings layers and settings
 * UI → the configuration service (the ADAPTER layer between user and
 * workspace … is the one addition)"*. The same two-owner shape as
 * {@link EditorHostKeyboard}, {@link EditorHostHistory} and
 * {@link EditorHostFiles}: `'host'` is standalone `vgai edit`, where
 * `settings-store.ts`'s three layers ARE the settings; `'frame'` is the
 * Code-OSS frame, where `IConfigurationService` is.
 *
 * ## The keys are `vgai.*`, and the prefix is part of the key
 *
 * `vgai.appearance.palette`, `vgai.keymap`, `vgai.devicePreview.preset` — the
 * flat dotted names `@volter/editor-project/settings/keys` derives from the settings
 * schema, which is also what the fork's `contributes.configuration` is
 * generated from. One spelling in this door, in `.vscode/settings.json`, in
 * VS Code's Settings editor and in what `vgai eval` prints, because the moment
 * there are two a reader has to know which side of which seam they are on to
 * know which to type.
 *
 * ## The adapter layer, and why `inspect` names it
 *
 * "Project over ADAPTER over user" (§Adapters and contributions are code) is
 * the one thing the configuration service does not already have, and under the
 * frame it is the service's own MEMORY target — the top layer — written by the
 * fork when the project's adapter loads and cleared the moment `inspect` shows
 * a workspace or folder value for that key. So `inspect(key)` answers with the
 * FOUR layers a person can act on, and a caller that wants to know whether a
 * gesture will stick asks it rather than guessing from the effective value.
 */
export interface EditorHostSettings {
  /**
   * Install VS Code's configuration service as the settings. The frame calls
   * this once its own services exist, which is AFTER the editor mounts (a
   * `ServicesAccessor` is valid only for the synchronous part of an
   * invocation). Until it does, the door falls back to the editor's own layers
   * rather than refusing: the editor paints in that window, and a palette read
   * there is a real read with nowhere else to go.
   */
  setProvider(provider: EditorHostSettingsProvider): void;
  /** The EFFECTIVE value — project over adapter over user over default — or
   *  `undefined` when no layer carries it. */
  get(key: string): unknown;
  /**
   * Write one key.
   *
   * With no `target`, the write goes WHERE IT WINS: the project when this
   * project's adapter or its own settings already declare the key, the user
   * layer otherwise. That is the whole of `updatePreferenceSettings`'s rule,
   * and it is here rather than in each caller because writing `appearance` to
   * the user layer in a project whose adapter declares a style is a gesture
   * that silently does nothing.
   */
  set(key: string, value: unknown, target?: EditorHostSettingsTarget): void;
  /** Every layer's own value for this key, plus the effective one. A layer
   *  that is silent about the key answers `undefined` — never the value from
   *  the layer under it. */
  inspect(key: string): EditorHostSettingsInspection;
  subscribe(listener: () => void): () => void;
}

/** The two layers a person's gesture can land in. The adapter layer is the
 *  project's own CODE and the default layer is the build's, so neither is a
 *  write target. */
export type EditorHostSettingsTarget = 'user' | 'project';

export interface EditorHostSettingsInspection {
  /** The built-in value, when the layer that declares the key carries one.
   *  The standalone layers carry none, so this is `undefined` there. */
  readonly default: unknown;
  /** `~/.vgai/settings.json` standalone; the USER target under the frame. */
  readonly user: unknown;
  /** What `vgai.adapter.ts` DECLARES (`editor: { style, keymap }`); the
   *  MEMORY target under the frame. */
  readonly adapter: unknown;
  /** `<project>/.vgai/settings.json` standalone; the WORKSPACE (and folder)
   *  target under the frame. */
  readonly project: unknown;
  /** Project over adapter over user over default. */
  readonly effective: unknown;
}

/**
 * THE FRAME'S HALF — what the Code-OSS bridge installs, backed by
 * `IConfigurationService`. Keys are the same `vgai.*` names the door takes.
 *
 * There is no `owner`/`setOwner` here and no optional member: unlike
 * {@link EditorHostFileProvider}, a configuration service can answer every one
 * of these for every key, so a member the frame "cannot answer" would be a
 * defect rather than a shape.
 */
export interface EditorHostSettingsProvider {
  get(key: string): unknown;
  inspect(key: string): EditorHostSettingsInspection;
  set(key: string, value: unknown, target: EditorHostSettingsTarget): void;
  /** Fires when any `vgai.*` value changes in any layer. Returns the
   *  unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/**
 * THE KEYBOARD DOOR — who owns the keyboard, and the chord-independent table
 * of what the editor's keyboard actions DO.
 *
 * ARCHITECTURE-CORE §The core is Code-OSS rule 3: *"Keyboard ownership is VS
 * Code's. One keybinding system … Two listeners cannot both own the
 * keyboard."* Under the Code-OSS frame the workbench's keybinding service is
 * the one keyboard: the fork's contribution registers one `vgai.<action id>`
 * command per entry of `actions()`, gives each the chords `keymaps()` reports
 * under a `when` clause over its own context keys, and dispatches through
 * `invoke`. The editor installs no `keydown` listener of its own at all.
 */
export interface EditorHostKeyboard {
  /**
   * Every action the editor has a live handler for right now, with the scope
   * its chord belongs to — `'stage'` (the focused stage alone), `'panel'`
   * (any of the editor's own parts) or `'global'`. The viewport set appears
   * only while a three stage is mounted, so this is a live list, not a
   * catalogue; `subscribe`/`version` report when it moves.
   */
  actions(): readonly { readonly id: string; readonly scope: 'stage' | 'panel' | 'global' }[];
  /**
   * Every registered keymap and the chords it assigns each action — the
   * editor's own `vgai` table and whatever a project's packages contribute
   * (Blender's G/R/S). A keymap is a SET of keybinding rules to the frame:
   * the same commands, different chords, gated on `activeKeymap()`.
   */
  keymaps(): readonly {
    readonly id: string;
    readonly title: string;
    readonly chords: Readonly<
      Record<
        string,
        readonly {
          readonly key: string;
          readonly code?: string;
          readonly mod?: boolean;
          readonly shift?: boolean;
          readonly alt?: boolean;
        }[]
      >
    >;
  }[];
  /** The keymap the PROJECT selected (its adapter's `editor.keymap`, its own
   *  settings over it). The frame publishes it as a context key and never
   *  keeps a second setting of its own. */
  activeKeymap(): string;
  /** Run one action by id. `false` when nothing handles it now, or its own
   *  gate refused — never silent. */
  invoke(id: string): boolean;
  subscribe(listener: () => void): () => void;
  version(): number;
  /**
   * WHAT THE FOCUSED STAGE IS SHOWING, for the frame's context keys. It is
   * here rather than beside `viewport` because it exists for exactly one
   * reader: the `when` clauses that decide which keyboard action a chord
   * reaches. `surface` is the stage's (`stage-context.ts`); `mode` is the
   * document's own interaction mode when it reports one (Blender's
   * object/edit/sculpt) and `null` when nothing does.
   */
  stage(): {
    readonly surface: 'three' | 'canvas' | 'dom' | null;
    readonly mode: string | null;
  };
}

/**
 * ONE RECORDED EDIT, as whoever owns undo sees it — the SDK's spelling of
 * `packages/editor/src/history/history-delegate.ts`'s `HistoryElement`.
 *
 * It is deliberately an `IResourceUndoRedoElement` (one file) or an
 * `IWorkspaceUndoRedoElement` (several) without naming either: the frame does
 * that translation, so no editor module imports VS Code and no file under the
 * fork's `src/vs/` imports an editor module.
 */
export interface EditorHostHistoryElement {
  readonly id: string;
  /** User-presentable, already trimmed ("Transform Selection"). This is what
   *  the frame's Edit menu shows after "Undo". */
  readonly label: string;
  /**
   * The PROJECT-RELATIVE files this edit changed, in the order the
   * transaction declared them — `src/prefabs/Crate.tsx`, not a URI and not an
   * opaque key, because only the frame knows the workspace folder they
   * resolve against, and resolving them there is what puts a gizmo drag and a
   * keystroke in the same file's text editor on ONE resource's stack.
   *
   * EMPTY for a session-scoped edit (a live journal on a held canvas surface,
   * a play run), which has no file at all. Placing such an element is the
   * frame's decision, named there — never silently attached to whatever
   * document happened to be open.
   */
  readonly resources: readonly string[];
  /**
   * THE WORKSPACE DOCUMENT THIS EDIT WAS MADE IN, at the moment it was
   * recorded — the id, or null when nothing was active.
   *
   * MEASURED (2026-09-19, the game template inside the frame): a three root's
   * document is NOT one file. Its adapter's own source path is the root entry
   * `src/world.tsx`, while a gizmo drag on the scene's HeroBox instance writes
   * `src/scenes/MainScene.tsx` — so "the document's resource" is a SET that
   * grows with what the person edits, and asking the undo service about the
   * entry file alone would find nothing to undo. The document id is the stable
   * thing; WHICH file its next undo acts on is the newest element recorded in
   * it. It is also what keeps a component view's stack apart from the main
   * scene's.
   */
  readonly document: string | null;
  /** Revert this one entry. `false` when the editor refused (a conflict, an
   *  expired resource, blocked history) — never a silent no-op. */
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
}

/**
 * UNDO, for the Code-OSS frame (ARCHITECTURE-CORE §The core is Code-OSS:
 * *"history-service.ts → IUndoRedoService … there is one Cmd+Z"*).
 *
 * The same two halves as {@link EditorHostKeyboard}, for the same reason: the
 * STANDALONE `vgai edit` shape fills this with the editor's own
 * `history-service.ts` cursor, and the FRAME takes ownership before the editor
 * mounts and pushes every {@link EditorHostHistoryElement} into VS Code's
 * `IUndoRedoService` instead. Nothing here caps anything by bytes — snapshot
 * size stays the adapter's concern, stated where the snapshot is taken.
 */
/** The frame's own undo, for every editor affordance that is not a chord. */
export interface EditorHostHistoryDelegate {
  undo(): void | boolean | Promise<void | boolean>;
  redo(): void | boolean | Promise<void | boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel?(): string | null;
  redoLabel?(): string | null;
}

export interface EditorHostHistory {
  /** Record a native document edit in the workbench's existing history.
   * The document owns restoration; the frame owns ordering and shortcuts. */
  record(element: EditorHostHistoryElement): void;
  /**
   * Install the frame's own undo as the one stack. Called once its service
   * exists, which is AFTER the editor mounts.
   *
   * The delegate is the OTHER direction of this door: the editor has undo
   * affordances that are not the keyboard — its Edit menu's "Undo <label>",
   * the command palette, `vgai eval`'s undo verb — and every one of them must
   * reach the ONE stack. Without it the Edit menu still names the step (the
   * label comes from the last recorded entry) while the click refuses, which
   * is worse than no menu item at all.
   */
  setDelegate(delegate: EditorHostHistoryDelegate): void;
  /**
   * Every entry as it is recorded, once a delegate is installed. Returns the
   * removal. Pair it with {@link elements}: the bridge mounts after edits are
   * already possible, so it pushes what it missed first, in order.
   */
  onElement(listener: (element: EditorHostHistoryElement) => void): () => void;
  /** Discard history for replaced/closed native documents, never ordinary edits. */
  invalidate(resources: readonly string[]): void;
  onInvalidated(listener: (resources: readonly string[]) => void): () => void;
  /** The workbench finished moving its own stack (including keyboard commands). */
  changed(): void;
  /** Everything recorded so far, oldest first. */
  elements(): readonly EditorHostHistoryElement[];
  /**
   * THE FOCUSED DOCUMENT'S OWN FILE, project-relative — the first resource a
   * ⌘Z with focus on a vgai stage tries, and the one a refusal names. `null`
   * when nothing is open and the active adapter writes nowhere.
   *
   * It is deliberately NOT the whole answer, because a three root's document
   * spans several files (see {@link EditorHostHistoryElement.document}); the
   * frame falls back to the newest element recorded IN THAT DOCUMENT, which is
   * what keeps a component view's ⌘Z off the main scene's stack — the whole
   * of "Component-view Ctrl+Z acts on the MAIN scene's history" (WORK.md
   * §The core is Code-OSS, U4's absorb list).
   */
  focusedResource(): string | null;
  /** The HOST shape's undo/redo — the editor's own cursor. Under frame
   *  ownership these refuse by name; the frame drives elements instead. */
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  /** What the next undo/redo would be called, for a menu that shows it. */
  undoLabel(): string | null;
  redoLabel(): string | null;
  subscribe(listener: () => void): () => void;
}

/**
 * THE FILE DOOR — reading and writing the OPEN PROJECT'S OWN FILES, over
 * project-relative paths, with the same two-owner shape as
 * {@link EditorHostKeyboard} and {@link EditorHostHistory}.
 *
 * ARCHITECTURE-CORE §The core is Code-OSS: *"the storage backends → file
 * system providers, the dev server as one provider"* — and the rule above it
 * that governs HOW: **everything VS Code already does is USED, not rebuilt.**
 *
 * ## Why this is a CALL and not a file-system provider (U5, measured)
 *
 * Both product shapes already have a real file service over the project:
 * DESKTOP opens the project folder as the workspace folder on Electron's own
 * disk provider, and WEB + SERVER (the REH) serves the same folder over
 * `vscode-remote://`. A `vgai-session:` provider mounting the session's
 * `/__editor/*` routes would be a SECOND path to bytes the workbench can
 * already reach — more code, a second cache, and two notions of when a file
 * changed. So under the frame this door CALLS `IFileService` (and
 * `ITextFileService` for text), and the session's file routes stay exactly
 * what the STANDALONE shape speaks.
 *
 * ## Why the frame's write is the point (U4's open, closed here)
 *
 * A vgai element's REDO used to be lost while a text model for that file was
 * open: the editor's undo wrote the file through its own transport, which is
 * an EXTERNAL change to the workbench, so Monaco reloaded and
 * `modelService.updateModel` pushed a fresh text element — and `pushElement`
 * destroys the redo future. A write made THROUGH the workbench is the
 * workbench's own: the open model is updated in place and no reload fires, so
 * the future survives. That is the reason this door exists rather than a
 * fourth storage backend.
 *
 * ## Paths
 *
 * PROJECT-RELATIVE, `/`-separated, no leading slash — `src/scenes/Main.tsx`,
 * `public/models/hero.glb` — exactly the spelling
 * {@link EditorHostHistoryElement.resources} uses, and for the same reason:
 * only the frame knows the workspace folder they resolve against
 * (`URI.joinPath(workspaceFolder.uri, path)`), and resolving them there is
 * what lands a write on the same URI Monaco holds for that file.
 *
 * This is deliberately NOT `StorageBackend`'s spelling, which means two
 * different things by tier — measured 2026-09-19: `HttpStorage` is rooted at
 * `<project>/public/` while a project-rooted backend is rooted at the
 * PROJECT ROOT, which is why the session grew four separate purpose-scoped
 * project-root routes beside it (`/__editor/vgai-file`,
 * `/__editor/project-resource`, `/__editor/data-file`,
 * `/__editor/source-files`). One spelling, here.
 */
export interface EditorHostFiles {
  /**
   * Install the workbench's file service as the project's files. Called once
   * its own services exist, which is AFTER the editor mounts — a
   * `ServicesAccessor` is valid only for the synchronous part of an
   * invocation, so the provider cannot be built before the mount it is handed
   * to (docs/CODE-OSS.md records that trap). Until it lands the door falls
   * back to the session's transports rather than refusing: a write in that
   * window is a real write with nowhere else to go.
   */
  setProvider(provider: EditorHostFileProvider): void;
  /** Read a UTF-8 text file. Rejects BY NAME if it is missing or a
   *  directory. */
  read(path: string): Promise<string>;
  /** Read raw bytes. */
  readBytes(path: string): Promise<Uint8Array>;
  /**
   * Write a file, creating parent directories as needed.
   *
   * Under the frame this is the workbench's own write: when a text model is
   * open for the file it is updated IN PLACE and saved, so no external-change
   * reload fires and no text undo element lands on top of ours.
   */
  write(path: string, data: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Shallow directory listing. */
  list(dir: string): Promise<readonly EditorHostFileEntry[]>;
  /** Change events for the project's files. Returns the unsubscribe. */
  watch(listener: (event: EditorHostFileEvent) => void): () => void;
}

export interface EditorHostFileEntry {
  /** Base name, no slashes. */
  readonly name: string;
  /** Project-relative path. */
  readonly path: string;
  readonly type: 'file' | 'dir';
}

export interface EditorHostFileEvent {
  readonly type: 'create' | 'update' | 'remove';
  /** Project-relative path. */
  readonly path: string;
}

/**
 * THE FRAME'S HALF — what the Code-OSS bridge installs, backed by
 * `IFileService`/`ITextFileService`. Every member takes the same
 * project-relative paths the door does; the frame joins them onto the
 * workspace folder.
 *
 * A member the frame cannot answer is ABSENT rather than faked, and the door
 * falls back to the host transport for it — the anti-shim rule applied to a
 * file API, because a fabricated listing reads exactly like a real empty
 * folder.
 */
export interface EditorHostFileProvider {
  read(path: string): Promise<string>;
  readBytes?(path: string): Promise<Uint8Array>;
  write(path: string, data: string | Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  list?(dir: string): Promise<readonly EditorHostFileEntry[]>;
  watch?(listener: (event: EditorHostFileEvent) => void): () => void;
}

/**
 * THE STAGE TRANSPORT DOOR — reach the transport of the stage a document runs
 * on, holding only that document's id.
 *
 * Shaped like `documents` beside it: a lookup plus a subscription, because a
 * stage mounting or unmounting changes what `for` answers and a look drawn
 * over it must re-render when it does. `null` for a document with no stage of
 * its own (a tool tab, a text document).
 */
export interface EditorHostTransport {
  for(documentId: string): StageTransportHandle | null;
  subscribe(listener: () => void): () => void;
}

/**
 * The transport vocabulary, re-exported through the host door so a skew
 * package reaches it without importing the editor's source or an engine
 * value. See `./transport.ts` for what each member means.
 */
export type {
  StageTransportHandle,
  StageTransportSnapshot,
  TransportPlaybackState,
  TransportSubject,
} from './transport';

/** Text logs and source diagnostics rendered by the native workbench. */
export interface EditorHostOutputDiagnostic {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

export interface EditorHostOutput {
  /** Replace a named channel's text and its current diagnostics. Paths are project-relative. */
  write(
    id: string,
    label: string,
    text: string,
    diagnostics: readonly EditorHostOutputDiagnostic[],
  ): void;
  show(id: string): void;
}

export interface EditorHost {
  readonly output: EditorHostOutput;
  readonly console: EditorHostConsole;
  readonly live: EditorHostLive;
  readonly viewport: EditorHostViewport;
  readonly hierarchy: EditorHostHierarchy;
  readonly systems: EditorHostSystems;
  readonly session: EditorHostSession;
  readonly project: EditorHostProject;
  /** Raise a notification in the editor's own tray. Returns the dismiss. */
  notify(notification: EditorHostNotification): () => void;
  readonly availability: EditorHostAvailability;
  readonly workspace: EditorHostWorkspace;
  readonly documents: EditorHostDocuments;
  readonly projectLocalState: EditorHostProjectLocalState;
  readonly keyboard: EditorHostKeyboard;
  readonly history: EditorHostHistory;
  readonly files: EditorHostFiles;
  readonly settings: EditorHostSettings;
  readonly transport: EditorHostTransport;
}

/**
 * ONE registration across every copy of this module. Under the packaged
 * runtime the editor shell is a prebuilt bundle with this SDK inlined, while
 * a package's contribution is served from the project's own installed SDK —
 * two module instances, so plain module state would be an empty registry on
 * the contribution's side (measured 2026-09-17: "No editor host is
 * registered" from `@vgai/game`'s connection pill on a registry install).
 * The layout host (`layouts.tsx`) solved the same split with a `Symbol.for`
 * key on `globalThis`; this door does the same.
 */
const HOST_KEY = Symbol.for('vgai.editor.host');
const hosts = globalThis as typeof globalThis & { [HOST_KEY]?: EditorHost | null };

/** The editor's boot registers itself; `null` unregisters (tests). */
export function registerEditorHost(next: EditorHost | null): void {
  hosts[HOST_KEY] = next;
}

export function editorHost(): EditorHost {
  const host = hosts[HOST_KEY];
  if (!host)
    throw new Error(
      'No editor host is registered: this contribution is running outside the editor ' +
        '(`registerEditorHost` from `@volter/editor-sdk/host` is called by the editor at boot).',
    );
  return host;
}

/**
 * Re-render only when `select()`'s value changes, sampled on the host's
 * availability tick — the shape every session-state gate in the editor uses,
 * so a package's status item costs the same as a built-in one.
 */
export function useHostAvailabilitySelector<T>(select: () => T): T {
  const { availability } = editorHost();
  return useSyncExternalStore(availability.subscribe, select, select);
}
