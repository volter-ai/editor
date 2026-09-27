/**
 * Props for ordinary React components registered at editor contribution
 * points. There is deliberately no extension class or lifecycle: package
 * metadata names a module and the editor renders its default export.
 */

import type { GenerationAccountProjection } from '@volter/editor-sdk/account';
import type { GenerationJob } from '@volter/editor-sdk/generations';
import type { EditorClient } from './client.js';
import type { ProjectToolCatalogEntry } from './types.js';

/** Stable, format-neutral selection data available to inspector contributions. */
export interface ToolContributionNode {
  readonly id: string;
  readonly label: string;
  readonly role?: string;
  readonly secondaryLabel?: string;
  readonly kind: string;
  readonly parentId: string | null;
  readonly childIds: string[];
}

/** Format-neutral identity for a project-owned Asset Lab document.
 *
 * This surface deliberately accepts no React children. Project tools may run
 * a different React major than the editor, so their native UI stays in their
 * own runtime while this editor-owned subject publishes the standard Asset
 * Lab context, selection floor, and Inspector identity row beside it.
 */
export interface ToolAssetDocumentProps {
  /** Stable id of the open workspace document. */
  readonly documentId: string;
  /** Subject name shown by the Inspector. */
  readonly title: string;
  /** Ecosystem-neutral asset kind shown by the Inspector. */
  readonly type: string;
  /** Optional provenance or concise state shown with the identity row. */
  readonly status?: string;
  /** Whether this is the active center document. */
  readonly active?: boolean;
}

/**
 * Editor-owned native surfaces available to ordinary project React tools. A medium's
 * integration adds its own to this interface from its public API (Three's Object3D surfaces are
 * `@volter/editor-threejs/object3d-contributions`), and registers what renders them.
 */
export interface ToolContributionSurfaces {
  readonly AssetDocument: import('react').ComponentType<ToolAssetDocumentProps>;
}

/** One bounded visual-history sample from the live Play recording. */
export interface ToolContributionRecordingFrame {
  /** Monotonic within this recording, including after older frames are evicted. */
  readonly sequence: number;
  /** Position on the recording clock, measured from `startedAt`. */
  readonly mediaTimeMs: number;
  /** Wall-clock capture time, for correlating project-owned event streams. */
  readonly capturedAt: string;
  /** Borrowed object URL. It remains valid until this frame is evicted or Play ends. */
  readonly src: string;
  readonly width: number;
  readonly height: number;
}

/** Stable snapshot returned by the live recording transport. */
export interface ToolContributionRecordingSnapshot {
  readonly startedAt: string;
  readonly width: number;
  readonly height: number;
  /** Latest sampled position on the live recording clock. */
  readonly liveEdgeMs: number;
  readonly sampleFps: number;
  readonly retentionMs: number;
  readonly frames: readonly ToolContributionRecordingFrame[];
  /** A preview failure never stops the full WebM recording. */
  readonly previewError: string | null;
}

/**
 * Read-only visual history for the current Play recording.
 *
 * `getSnapshot` is referentially stable between notifications, so it can be
 * passed directly to React's `useSyncExternalStore`. A `null` snapshot means
 * Play is not currently recording (for example, a human-started Play session
 * that did not explicitly start recording).
 */
export interface ToolContributionRecording {
  readonly getSnapshot: () => ToolContributionRecordingSnapshot | null;
  readonly subscribe: (listener: () => void) => () => void;
}

/** One structured row from a Gameplay Session's durable JSONL record. */
export interface ToolGameplaySessionEntry {
  readonly t?: number;
  readonly level?: string;
  readonly source?: string;
  readonly sub?: string;
  readonly msg?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly tick?: number;
  readonly simT?: number;
  readonly world?: string;
  readonly simSpeed?: number;
  readonly [field: string]: unknown;
}

export interface ToolGameplaySessionRecording {
  readonly format: 'composite-webm' | 'canvas-dom';
  readonly replay: string | null;
  readonly file: string;
  readonly url: string;
  readonly startedAt: number | null;
  readonly finalized: boolean;
  readonly bytes: number | null;
}

/** One Play interval, durable after Stop and editor reload. */
export interface ToolGameplaySession {
  readonly id: string;
  readonly run: string | null;
  readonly status: 'live' | 'completed';
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** Real elapsed wall time. Simulation time remains an entry field. */
  readonly durationMs: number;
  readonly logFile: string;
  readonly entries: readonly ToolGameplaySessionEntry[];
  readonly recording: ToolGameplaySessionRecording | null;
}

export interface ToolGameplaySessionsSnapshot {
  readonly sessions: readonly ToolGameplaySession[];
  readonly selectedSessionId: string | null;
  readonly selectedSession: ToolGameplaySession | null;
  /** Shared analytics cursor, measured in real milliseconds from Play start. */
  readonly cursorMs: number;
  readonly liveEdgeMs: number;
  readonly loading: boolean;
  readonly error: string | null;
}

/** Stable external store supplied to the built-in Analytics contribution. */
export interface ToolGameplaySessions {
  readonly getSnapshot: () => ToolGameplaySessionsSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly select: (sessionId: string) => void;
  readonly seek: (realTimeMs: number) => void;
  readonly refresh: () => Promise<void>;
}

/**
 * The live game a contribution is looking at, or `null` when nothing is
 * playing.
 *
 * A dev-GUI contribution's whole subject is the RUNNING game — its stats,
 * cheats, tuning handles and event stream all hang off the live `Game`, and
 * there is no other door to it from a contribution (the editor's own state is
 * not the game's). It is `unknown` deliberately: `@vgai/game-runtime`'s `Game` is
 * the project's dependency, not this package's, so a contribution narrows it
 * with its own import rather than making every consumer of this SDK carry the
 * engine's types.
 *
 * `instanceId` is the mount id the editor's runtime instruments are pointed
 * at (the Inspect selector). With several seats live that is the ONLY thing
 * distinguishing two mounts of the same project, so a contribution that
 * caches per-game state keys it on this and re-reads when it changes.
 */
export interface ToolContributionPlay {
  readonly game: unknown;
  readonly instanceId: string;
  /** The editor-owned recording transport shared by every project tool. */
  readonly recording: ToolContributionRecording;
}

/**
 * THE DOCUMENT HEADER REGION, as a project contribution sees it.
 *
 * A `workspace.document` module may `export const Toolbar` beside its default
 * component. The editor renders it in the host-owned header strip above the
 * document — the same strip the Game and Story documents use — with the SAME
 * props the content receives, so a header and its body read one state. The
 * host draws the strip identically for every document (height, divider,
 * island treatment over a backdrop document); the contribution supplies
 * only what goes in it. A document that hand-draws a bar inside its own body
 * instead is a document whose header no skin, preset or region rule can
 * reach — which is the whole reason the strip is the host's.
 */
export type ToolDocumentToolbar = import('react').ComponentType<ToolContributionProps>;

/**
 * THE DOCUMENT SHELF REGION — Blender's tool shelf — as a project sees it:
 * `export const Shelf` on a `workspace.document` module. The editor draws it
 * as a vertical rail over the leading edge of the document's content box,
 * with the same props as the body. Same contract as {@link ToolDocumentToolbar}.
 */
export type ToolDocumentShelf = import('react').ComponentType<ToolContributionProps>;

/**
 * A document the adapter's table lists — a model, a page — as handed to the
 * editor registered for its kind (ARCHITECTURE-CORE §The project model,
 * "Documents, not scenes"). A `workspace.document` contribution declares the
 * kind it edits with `export const documentKind = 'model'`; the host then
 * opens every table entry of that kind as its OWN document — titled by the
 * entry's label, one per entry, restored across reloads by the entry's id —
 * and mounts the contribution with the entry here. Nothing else is looked
 * up: the entry names the module (`source`) and the contribution does the
 * rest through `importProjectModule`.
 */
export interface ToolDocumentEntry {
  /** The table entry's id (`model:src/models/cage.ts`). */
  readonly id: string;
  readonly kind: string;
  /** The entry's display label — the document's title (`cage`). */
  readonly label: string;
  /** The module that IS the document, when the entry has one. */
  readonly source?: { readonly path: string; readonly export?: string };
}

export interface ToolContributionProps {
  /** The exact registered callable this contribution presents. */
  readonly tool: ProjectToolCatalogEntry;
  /** Present when mounted as the editor of a table document of the kind this
   *  contribution declared (`export const documentKind`). */
  readonly document?: ToolDocumentEntry;
  /** Stable id of this presentation within the registered callable. */
  readonly contributionId?: string;
  /** Direct editor SDK client; invoke with `client.runProjectTool(tool.name, ...)`. */
  readonly client: EditorClient;
  /** Generic editor-owned presentation surfaces; project source remains native. */
  readonly surfaces: ToolContributionSurfaces;
  /** Sanitized product-account projection. Never contains an access token. */
  readonly account: GenerationAccountProjection;
  /** The inspected play instance, or `null` while nothing is playing. */
  readonly play: ToolContributionPlay | null;
  /** Present when mounted as a workspace document contribution. */
  readonly documentId?: string;
  /** Whether that workspace document is the active center subject. */
  readonly active?: boolean;
  /**
   * Present with `documentId`. Hand the host the ONE object this document
   * edits through — its live session — and `editor.document.run(ctx => …)`
   * (`vgai eval`) runs a step against it in Edit mode, without play: the
   * agent's REPL over the document. Re-publish whenever that object changes
   * (a reload that swaps a session); the return value unpublishes.
   */
  readonly publishContext?: (context: unknown) => () => void;
  /**
   * Raise a card on the editor's bottom-right notification stack — the ONE
   * shape an event takes (ARCHITECTURE-CORE §Editor chrome, "Notices take
   * VS Code's shape"): a refusal, a failed write, a no-op the user should
   * hear about. Never paint these into a document's own chrome. Plain
   * `info` hides itself; warnings and errors stay until dismissed. The
   * return value dismisses the card early.
   */
  readonly notify?: (notice: ToolNotice) => () => void;
  /**
   * Tell the host what this contribution is about to do on the page's main
   * thread — `work('building src/models/x.ts')` before running a module's
   * `build()`, `work(null)` after. A command that times out meanwhile is
   * refused naming that work instead of "the page never answered".
   */
  readonly work?: (label: string | null) => void;
}

/** A card for {@link ToolContributionProps.notify}. */
export interface ToolNotice {
  readonly tone: 'info' | 'warning' | 'error';
  /** One line, bold — what happened. */
  readonly title: string;
  /** The rest, plain — what it means, what to do. */
  readonly detail?: string;
}

/**
 * A `workspace.utility`'s props — the shared shape, except that `tool` may be
 * absent.
 *
 * It is its own type rather than a relaxation of {@link ToolContributionProps}
 * because only the two PRESENTING points earn the relaxation (this one and
 * {@link ToolInspectorContributionProps}): a record-reading drawer panel (a
 * log, a run timeline) presents what HAPPENED rather than one callable's
 * output, so there is no honest name to put there and the loader stopped
 * demanding a false one. Widening the shared props instead would hand every
 * RUNNING contribution a `tool` it must now null-check while its own point
 * still guarantees one.
 */
export interface ToolUtilityContributionProps extends Omit<ToolContributionProps, 'tool'> {
  /** The callable this utility declared, when it declared one at all. */
  readonly tool?: ProjectToolCatalogEntry;
}

/**
 * A game's analytics body. The editor owns session selection, real-time
 * transport, and optional video preview; this component owns only the charts
 * and readouts that give the selected session meaning for this game.
 *
 * `play` is intentionally absent. Historical analysis consumes the durable
 * Gameplay Session record, so the type itself prevents an Analytics surface
 * from accidentally depending on a live module graph.
 */
export interface ToolAnalyticsContributionProps
  extends Omit<ToolContributionProps, 'tool' | 'play'> {
  readonly tool?: ProjectToolCatalogEntry;
  readonly gameplaySessions: ToolGameplaySessions;
}

/**
 * A `selection.inspector`'s props. `tool` is OPTIONAL here for the same reason
 * it is on a utility: a section may present state the editor already has —
 * readings, verbs a game registered as debug commands — and drive no single
 * registered callable at all. A section that DOES commit through one still
 * declares it and still gets the resolved entry.
 *
 * A module may also `export const icon = '<glyph name>'` — the NAME of the
 * glyph that stands for this section wherever the Inspector shows one (the
 * Properties tab rail, the section-icon strip). A name, never an icon
 * object: the active icon set paints it, and a set may give that name its
 * own category ink (`IconSetContribution` `tone`). Give a section that
 * means something its OWN name (`properties-data`), the way the Outliner's
 * rows do, because a tone is keyed by name and a shared name would tint
 * every section that borrowed it. Omitted, the host draws its generic tool
 * glyph.
 */
export interface ToolInspectorContributionProps extends Omit<ToolContributionProps, 'tool'> {
  /** The callable this section declared, when it declared one at all. */
  readonly tool?: ProjectToolCatalogEntry;
  readonly node: ToolContributionNode | null;
  readonly nodeId: string | null;
  /** The matched adapter — the same value `match` was handed. Adapter-native
   *  API; import its concrete type when a section reads more than the node
   *  (a model section reads the document's source path and root). */
  readonly adapter: unknown;
}

/** Stable editor projection of one selected project or external-library asset. */
export interface ToolContributionAsset {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly origin: 'project' | 'library';
  readonly sourcePath?: string;
}

/** An `asset.inspector`'s props — the same relaxation as the two other
 *  PRESENTING points ({@link ToolUtilityContributionProps},
 *  {@link ToolInspectorContributionProps}): it presents what an ASSET is, not
 *  one callable's output, so `tool` may be absent. */
/**
 * A verb an `asset.inspector` contribution offers for the asset it is
 * showing — the SAME thing a built-in Inspector button is: it appears in the
 * panel's identity row, `editor.inspect().quickActions` lists it, and
 * `editor.runAction(id)` runs exactly this `run`. A section publishes its
 * verbs with {@link ToolAssetInspectorContributionProps.setActions} when it
 * knows them, which is what gives a project's own Inspector door a place in
 * the control API instead of a mouse only.
 */
export interface ToolAssetInspectorAction {
  /** Stable id, unique within the contribution (`shot.open`). */
  readonly id: string;
  /** Accessible name and tooltip. */
  readonly title: string;
  /** Visible button text. */
  readonly label?: string;
  readonly disabled?: boolean;
  readonly run: () => void | Promise<void>;
}

export interface ToolAssetInspectorContributionProps extends Omit<ToolContributionProps, 'tool'> {
  readonly tool?: ProjectToolCatalogEntry;
  readonly asset: ToolContributionAsset | null;
  /**
   * Publish the verbs this section offers for the asset it is showing — see
   * {@link ToolAssetInspectorAction}. Call it with the list when the answer
   * is known (a section that probes asynchronously calls it from the effect
   * that resolves), and with `[]` when the answer is no. The editor renders
   * them in the identity row and serves them to
   * `editor.inspect().quickActions` / `editor.runAction(id)`, so the panel
   * and the control API always show one list. Not calling it means "no
   * verbs", which is what a section that only displays should do.
   */
  readonly setActions: (actions: readonly ToolAssetInspectorAction[]) => void;
}

/** Optional named export required by `asset.inspector` contributions. */
export type ToolAssetInspectorContributionMatch = (asset: ToolContributionAsset | null) => boolean;

/**
 * Provider-owned presentation mounted inside the editor-owned generation
 * result document. The host owns job state, billing, and acceptance; this
 * component only interprets the native poll result.
 */
export interface ToolGenerationResultContributionProps extends ToolContributionProps {
  readonly job: GenerationJob;
  readonly result: unknown;
}

/**
 * Required named export for `generation.result` contributions. A single poll
 * callable may serve many native operations, so presentation selection is
 * based on the durable job and the provider's unmodified poll result rather
 * than registration order or a host-owned media taxonomy.
 */
export type ToolGenerationResultContributionMatch = (
  job: GenerationJob,
  result: unknown,
) => boolean;

/**
 * What the inspector is showing AROUND the node a `selection.inspector`
 * contribution is being matched against.
 *
 * It exists for one question a `node`/`adapter` pair cannot answer: with
 * NOTHING selected, `node` is `null` on every surface alike — an open Asset
 * Lab document's empty state and the play surface's Game subject are the same
 * two arguments. A contribution that matches `node === null` therefore matched
 * BOTH, and the empty-state subject of whatever document happened to be open
 * grew sections belonging to another surface entirely.
 *
 * `nullSubjectId` is the id of the empty-state subject actually being composed
 * (`inspection/null-subject.ts`), so a contribution scopes itself POSITIVELY —
 * `ctx.nullSubjectId === 'game'` — rather than by guessing from the adapter.
 * It is `null` whenever a node IS selected, which is the honest answer: there
 * is no empty-state subject in that composition.
 */
export interface ToolInspectorContributionMatchContext {
  readonly nullSubjectId: string | null;
}

/** Optional named export required by `selection.inspector` contributions. */
export type ToolInspectorContributionMatch = (
  node: ToolContributionNode | null,
  /** Adapter-native API. Import its concrete type when a contribution needs it. */
  adapter: unknown,
  context: ToolInspectorContributionMatchContext,
) => boolean;

// ---------------------------------------------------------------------------
// Project modules, through the host's own door
// ---------------------------------------------------------------------------

/**
 * How THIS HOST loads a project module for a contribution: the dev/packaged
 * host serves it through its own Vite (`/@fs/…`, with a URL a live re-import
 * can stamp). The host registers one loader per project (`tool-loader.ts`); a
 * contribution that needs a project module — a model's Edit Mesh door
 * importing `build()` — asks {@link importProjectModule} and never spells a
 * tier's mechanics itself.
 */
export interface ProjectModuleLoader {
  readonly import: (path: string) => Promise<Record<string, unknown>>;
  /** The module's servable URL, or `null` on a tier that serves none. */
  readonly url: (path: string) => URL | null;
  /** The module's SOURCE TEXT as it is on disk (or in storage) right now —
   *  what a contribution that writes the module back (a model's mesh
   *  editor appending a line) patches. */
  readonly source: (path: string) => Promise<string>;
}

/** ONE loader across every copy of this module — see `host.ts` for why the
 *  packaged runtime holds two SDK instances, and `layouts.tsx` for the
 *  `Symbol.for` precedent. */
const LOADER_KEY = Symbol.for('vgai.editor.project-module-loader');
const loaders = globalThis as typeof globalThis & {
  [LOADER_KEY]?: ProjectModuleLoader | null;
};

/** Host side: install (or clear) the active project's module loader. */
export function registerProjectModuleLoader(loader: ProjectModuleLoader | null): void {
  loaders[LOADER_KEY] = loader;
}

/** Contribution side: a project module (`src/models/cage.ts`), loaded the
 *  way this tier loads project modules. Refuses by name with no host. */
export function importProjectModule(path: string): Promise<Record<string, unknown>> {
  if (!loaders[LOADER_KEY]) {
    return Promise.reject(
      new Error(`importProjectModule(${path}): no host has registered a project module loader`),
    );
  }
  return loaders[LOADER_KEY].import(path);
}

/** The module's servable URL on this host, or `null` when it has none. */
export function projectModuleUrl(path: string): URL | null {
  return loaders[LOADER_KEY]?.url(path) ?? null;
}

/** Contribution side: the module's current source text. Refuses by name with no host. */
export function readProjectModuleSource(path: string): Promise<string> {
  if (!loaders[LOADER_KEY]) {
    return Promise.reject(
      new Error(`readProjectModuleSource(${path}): no host has registered a project module loader`),
    );
  }
  return loaders[LOADER_KEY].source(path);
}

// ---------------------------------------------------------------------------
// The transform a stage transforms through
// ---------------------------------------------------------------------------

/**
 * THE MODAL TRANSFORM A STAGE OWNS — the door the host's transform tools drive
 * on a stage that is not the editor viewport's own.
 *
 * WHY IT EXISTS, measured rather than argued (2026-09-19, cold `--template
 * models` scaffold): the host's `ToolStrip` draws Move / Rotate / Scale /
 * Transform over every stage that paints a three surface, and on a Model
 * document all four lit and nothing happened — `Transform` lit at boot,
 * offering a tool that could never act. Eight controls in the two places a
 * person looks first, one of them lit.
 *
 * TWO SEPARATE CAUSES, and only the second one is this door's:
 *  1 THE TOOLS WROTE THE WRONG STORE. Every stage owns an `EditorShellStore`
 *    (`stage-store-registry.ts`); the strip wrote the SHELL's, which no
 *    document stage reads. That is fixed in the host (`ToolStrip`'s own note
 *    carries the prefab-story measurement) and it is why a session-painted
 *    stage now takes the ordinary GIZMO arm.
 *  2 A MESH MODULE DOES NOT TRANSFORM THROUGH A GIZMO AT ALL. Blender's Edit
 *    Mode Move/Rotate/Scale act on the element selection and are its
 *    `G`/`R`/`S`; ours already do, through `MeshEditSession.beginTransform`
 *    from the Mesh menu and the keys, while the document's own adapter is a
 *    read-only projection of the datablock that a gizmo could not write. So
 *    the stage DECLARES how it transforms and the host's three single-channel
 *    tools run that, instead of the host guessing from the document's kind.
 *
 * THERE IS NO `combined` KIND, and that is the tool shelf's own rule applied
 * to the fourth button: Blender's all-handles Transform IS a gizmo, and a
 * modal transform has no twin for it, so the host does not draw it over a
 * door (the same reason ten of Blender's twenty-one tools are absent; the
 * 21-row table that said which lived in the deleted Edit Mesh document and is
 * in git — `packages/mesh/contributions/mesh-edit-document.tsx` before
 * 2026-09-19).
 *
 * NEITHER ARE THE HEADER'S TRANSFORM WELLS (orientation, pivot/anchor, snap,
 * options) over a door. Every one of them configures a GIZMO — measured
 * 2026-09-19: `transformSpace`'s only functional reader is the viewport's
 * `controls.setSpace`, and `pivotMode`/`gizmoAnchor`/`snapEnabled` are read
 * only by that viewport and the 2D canvas overlay. A modal door has no
 * orientation, no pivot choice and no snapping to configure (the mesh kit
 * transforms about the selection's median on global axes, always), so the host
 * draws no wells over one. Wiring a well here means giving the door a
 * parameter first.
 */
export type StageTransformKind = 'translate' | 'rotate' | 'scale';

export interface StageTransformDoor {
  /** Arm this stage's own modal transform. The stage narrates its own refusal
   *  (nothing selected, another gesture running); the host never paraphrases
   *  it. */
  readonly begin: (kind: StageTransformKind) => void;
  /** The kind armed right now, or `null`. This is what LIGHTS a tool: these
   *  are modal operators, not persistent tool modes, so between gestures
   *  nothing is lit. */
  readonly armed: () => StageTransformKind | null;
  /** `useSyncExternalStore` pair with {@link armed}. */
  readonly subscribe: (listener: () => void) => () => void;
}

interface StageTransformRegistry {
  readonly doors: Map<string, StageTransformDoor>;
  version: number;
  readonly listeners: Set<() => void>;
}

/** ONE registry across every copy of this module, for the same reason
 *  {@link registerProjectModuleLoader} needs one — see its note. */
const STAGE_TRANSFORM_KEY = Symbol.for('vgai.editor.stage-transform-doors');
const stageTransforms = globalThis as typeof globalThis & {
  [STAGE_TRANSFORM_KEY]?: StageTransformRegistry;
};

function stageTransformRegistry(): StageTransformRegistry {
  const existing = stageTransforms[STAGE_TRANSFORM_KEY];
  if (existing) return existing;
  const created: StageTransformRegistry = { doors: new Map(), version: 0, listeners: new Set() };
  stageTransforms[STAGE_TRANSFORM_KEY] = created;
  return created;
}

function notifyStageTransforms(registry: StageTransformRegistry): void {
  registry.version++;
  for (const listener of [...registry.listeners]) listener();
}

/** A mounted stage declares the transform it transforms through — the shape
 *  `stage-store-registry.ts` uses for the store a stage runs on. Re-registering
 *  the same document replaces it; the returned unregister drops it. */
export function registerStageTransform(documentId: string, door: StageTransformDoor): () => void {
  const registry = stageTransformRegistry();
  registry.doors.set(documentId, door);
  notifyStageTransforms(registry);
  return () => {
    if (registry.doors.get(documentId) !== door) return;
    registry.doors.delete(documentId);
    notifyStageTransforms(registry);
  };
}

/** The transform that document's stage owns, or `null` when it declares none
 *  (every stage whose transform is the editor viewport's own gizmo). */
export function stageTransformDoor(documentId: string | null): StageTransformDoor | null {
  return documentId === null ? null : (stageTransformRegistry().doors.get(documentId) ?? null);
}

/** `useSyncExternalStore` shape — a stage declaring or dropping its door
 *  changes what the shelf and the header draw. */
export function subscribeStageTransforms(listener: () => void): () => void {
  const registry = stageTransformRegistry();
  registry.listeners.add(listener);
  return () => {
    registry.listeners.delete(listener);
  };
}

export function stageTransformsVersion(): number {
  return stageTransformRegistry().version;
}
