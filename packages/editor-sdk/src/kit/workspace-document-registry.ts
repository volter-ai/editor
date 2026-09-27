/**
 * Workspace DOCUMENT registry (W0 — the shell-contract slice of §9 W0). The
 * missing central-document concept: every authored subject (Three scene, Game
 * preview, React story, asset preview, data asset, Build Profiles — the real
 * first-party implementers §7.1 names) becomes an OPEN DOCUMENT here, and the
 * center workspace (W1) renders the open set as tabs. Live-observation
 * instruments such as Profiler and Network stay in the Debugger; an XState
 * machine is a document because the machine in its source is the subject
 * being edited, with its running actors shown on it.
 *
 * `frame/bridge.tsx` consumes this registry and maps open subjects
 * to editor panes with always-mounted content.
 * `components/CenterDocuments.tsx` opens the first two document implementers
 * (active Three scene, Game preview) and bridges open/activate to the store's
 * `activeViewportTab` (the T6.3 input-gate predicate). W2/W3 migrate the
 * remaining surfaces.
 *
 * Idioms mirror `inspector-section-registry.ts` one-for-one: module-scope
 * state, `useSyncExternalStore`-shaped subscribe + monotonic version,
 * `__resetForTest`, pure-logic headless tests (no jsdom — `Content` /
 * `Toolbar` are never rendered by the registry itself). The shell must not
 * switch on implementation technology for placement (§7.3 / CLAUDE.md):
 * `kind` here is SEMANTIC metadata (what the document is to the author, per
 * §8's naming rules), never a technology dispatch key — kind-specific
 * behavior lives inside each descriptor's own `Content`/`Toolbar`.
 */

import type { EditorViewDocument } from '../index';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type { ComponentType } from 'react';
import type { DocumentPreviewSource } from '@volter/editor-sdk/kit/document-preview-source';
import { noteViewportActivationGesture } from '@volter/editor-sdk/kit/viewport-activation-timings';

/**
 * Semantic document kinds — §7.1 "title, semantic kind, and optional
 * source/provenance metadata". One entry per real first-party implementer
 * §7.1 enumerates, plus distinct generic project-tool runners and optional
 * project-authored tool surfaces. Extend the union when a new document kind genuinely ships;
 * the registry itself never branches on it.
 */
export const WORKSPACE_DOCUMENT_KINDS = [
  'scene', // the standing Edit workspace document; produced by CenterDocuments
  'game', // the live player-facing Game preview (§8)
  'world', // one manifest root's isolated edit-time authoring surface
  'story', // React CSF story document (§4.2)
  'asset', // model/image/audio/input-map/data-file viewer or editor (§5.1)
  'behavior', // live inspect-only behavior/statechart document
  'generation', // one durable external-generation job and its native result
  'content-browser', // optional thumbnail-heavy browser (§5)
  'project-tool', // registered callable using the generic runner
  'tool-contribution', // optional React presentation for a registered project tool
  'document', // an adapter-table document (a model, a page) in the editor registered for its kind
] as const;

export type WorkspaceDocumentKind = (typeof WORKSPACE_DOCUMENT_KINDS)[number];

/** Where a document came from — §7.1 "optional source/provenance metadata".
 *  All fields optional: a Game preview has none; a source-backed document has a `sourcePath`;
 *  a live XState graph may have only an `origin`. */
export interface WorkspaceDocumentProvenance {
  /** Project-relative source file (e.g. `src/scenes/MainScene.tsx`). */
  readonly sourcePath?: string;
  /** Owning adapter root id (D20). */
  readonly rootId?: string;
  /** Free-form origin for non-file documents (e.g. a live machine id). */
  readonly origin?: string;
}

/** Props the W1 host will pass to a document's `Content`/`Toolbar`. */
export interface WorkspaceDocumentContentProps {
  /** Native editor occurrence, independent of document and group identity. */
  readonly viewId?: string;
  /** The open document's stable id (== its descriptor's `id`). */
  readonly documentId: string;
  /** Whether this document is the active center tab. Hosts keep inactive
   *  documents MOUNTED where lifecycle requires it (W1 proof bar) — content
   *  uses this to gate work, not to exist. */
  readonly active: boolean;
}

/** §7.1 "optional selection/Inspector context": what the Inspector should
 *  treat as selected while this document is active. Shape matches
 *  `inspector-section-registry.ts`'s `InspectorSectionProps` inputs. */
export interface WorkspaceDocumentSelection {
  /** The adapter the picked node belongs to. `null` when the document has no
   *  authoring of its own — an image, an audio file, a JSON blob. Such a
   *  document still registers a context, because registering one is how it
   *  states that IT is the subject: without it the Inspector falls back to
   *  whatever was selected in the scene before the document was opened, which
   *  is not what the human is looking at. */
  readonly adapter: AuthoringAdapter | null;
  /** Selected node id; `null` for the document/environment state. */
  readonly nodeId: string | null;
}

/**
 * Semantic workspace role, deliberately independent from rendering technology.
 * Every descriptor must choose one so a new page cannot silently inherit the
 * placement of an authored asset.
 */
export type WorkspaceDocumentRole = 'authored-subject' | 'workspace-reference' | 'workspace-task';

/** What {@link WorkspaceDocumentDescriptor.persist} is handed: the
 *  registry-owned RUNTIME facts a descriptor's own closure cannot see,
 *  because they can change while the document is open. */
export interface WorkspaceDocumentPersistContext {
  readonly id: string;
  /** The LIVE tab text (see {@link OpenWorkspaceDocument.title}), which a
   *  document whose opener names it by a rule it cannot re-derive must write
   *  down to restore the same tab. */
  readonly title: string;
}

/**
 * The §7.1 document contract. Descriptors are definitions (immutable by
 * convention); per-open-document RUNTIME state (dirty) lives on
 * {@link OpenWorkspaceDocument} and is mutated through the registry.
 */
export interface WorkspaceDocumentDescriptor {
  /** Stable identity scoped to project/session (§7.1) — dedupe key: opening
   *  an id that is already open activates the existing document. */
  readonly id: string;
  /** Source-owned display title (§8 — `MainScene`, `Playing`, never a
   *  technology bucket like `Viewport`). */
  readonly title: string;
  readonly kind: WorkspaceDocumentKind;
  /**
   * Authored subjects and workspace references remain center documents in
   * every style. Workspace tasks become centered overlays in Glass + Floating
   * while retaining ordinary center tabs in Classic/Docked. Placement is a
   * host policy; descriptors state semantics, never inspect appearance stores.
   */
  readonly workspaceRole: WorkspaceDocumentRole;
  /**
   * THE WORKSPACE AREA this document fills instead of the centre tab strip —
   * a Blender editor AREA, which is an editor GROUP (orchestrator ruling
   * 2026-09-19, WORK.md I5; `WorkspaceAreaContribution`).
   *
   * Set only by the workspace that opens the document, from its own `areas`
   * list; a document opened by the session, a finder or the user never has
   * one and stays a centre tab. The dock reads it in
   * `workspaceDocumentPlacement` and puts the panel in `vgai:area:<id>`
   * rather than `vgai:center`.
   */
  readonly area?: string;
  readonly provenance?: WorkspaceDocumentProvenance;
  /** React content host (§7.1). Never rendered by the registry itself. */
  readonly Content: ComponentType<WorkspaceDocumentContentProps>;
  /** Optional document-local toolbar contribution (§7.1; §4.1 "Document tabs
   *  and their local toolbar occupy only the center workspace"). */
  readonly Toolbar?: ComponentType<WorkspaceDocumentContentProps>;
  /** The document's SHELF — the host's vertical tool rail over the content
   *  box's leading edge (`DocumentShelfRail`). Same contract as `Toolbar`. */
  readonly Shelf?: ComponentType<WorkspaceDocumentContentProps>;
  /** Chrome-free preview supplied by the document's rendering owner. */
  readonly preview?: DocumentPreviewSource;
  /** `false` pins the document (Scene/Game in W1). Default `true`. */
  readonly closeable?: boolean;
  /** Optional read-only state (§7.1). */
  readonly readOnly?: boolean;
  /** Optional inspect-only state (§7.1) for read-only authored resources. */
  readonly inspectOnly?: boolean;
  /** Optional selection/Inspector context while this document is active. */
  readonly selection?: () => WorkspaceDocumentSelection | null;
  /** Durable identity used by Copy View Link and agent presentation. The
   * document owns this mapping because its rendering technology is not a
   * semantic route. */
  readonly presentation?: () => EditorViewDocument | null;
  /**
   * SERIALIZE THIS DOCUMENT'S OWN RESTORABLE STATE. A contributed document
   * kind owns its persisted state: the workspace stores whatever this
   * returns as an OPAQUE blob under the document's {@link kind} and
   * {@link id}, never reading inside it, and hands it straight back to the
   * kind's registered restorer (`workspace-document-restore.ts`) on the next
   * boot. Return `undefined`/`null` for a document that cannot truthfully
   * reopen from a cold start (a live entity, an unresolved remote view, a
   * document something else re-derives at boot) — that is the whole opt-out,
   * and the host has no list of exceptions to consult.
   */
  readonly persist?: (context: WorkspaceDocumentPersistContext) => unknown;
  /** Called when this document becomes the active document. */
  readonly onActivate?: (documentId: string) => void;
  /** Called when this document stops being the active document. */
  readonly onDeactivate?: (documentId: string) => void;
  /** Called when this document is removed from the workspace (close /
   *  close-all) — release adapters, mounts, subscriptions here. */
  readonly onDispose?: (documentId: string) => void;
}

/** One open document: its immutable descriptor + registry-owned state. */
export interface OpenWorkspaceDocument {
  readonly descriptor: WorkspaceDocumentDescriptor;
  /** §7.1 optional dirty state — set via {@link setWorkspaceDocumentDirty}. */
  readonly dirty: boolean;
  /** Live display title — initialized from `descriptor.title`, updated via
   *  {@link setWorkspaceDocumentTitle}. Registry-owned RUNTIME state (like
   *  `dirty`), because a document's source-owned name can change while it is
   *  open. */
  readonly title: string;
}

/** A mounted document editor's live save callback. `true` means the write
 * completed; `false` means validation/persistence rejected it and the caller
 * must keep the document open. */
export type WorkspaceDocumentSaveHandler = () => boolean | Promise<boolean>;

// --- Module-scope state (mirrors inspector-section-registry.ts) -----------

let _open: OpenWorkspaceDocument[] = [];
// At most one automatically followed document. Explicit opening or editing
// keeps it; discovery may replace only the untouched automatic preview.
let _previewId: string | null = null;
let _activeId: string | null = null;
let _activeViewId: string | null = null;
// A pinned document can be restored before its async project authoring pass
// has registered the descriptor. Keep that semantic activation request until
// the matching stable document opens; ordinary unknown ids still reject.
let _pendingRestoredActiveId: string | null = null;

function settlePendingRestoredActivation(id: string): void {
  queueMicrotask(() => {
    if (_pendingRestoredActiveId !== id) return;
    if (!_open.some((document) => document.descriptor.id === id)) return;
    _pendingRestoredActiveId = null;
    // A project document installer may synchronously restore its own prior
    // fallback after opening the requested board. The persisted request wins
    // once that registration batch has returned.
    activateWorkspaceDocument(id);
  });
}
let _version = 0;
const _listeners = new Set<() => void>();
/** Ids currently mid-close (between the neighbor `setActive` and the
 *  filter+`onDispose` below) — see {@link closeWorkspaceDocument}'s
 *  re-entrancy guard. */
const _closingIds = new Set<string>();
const _saveHandlers = new Map<string, WorkspaceDocumentSaveHandler>();
const _selectionProviders = new Map<string, () => WorkspaceDocumentSelection | null>();

function notifyChanged(): void {
  _version++;
  for (const fn of _listeners) fn();
}

/** Subscribe to any open/activate/close/dirty change. Returns unsubscribe. */
export function subscribeWorkspaceDocuments(fn: () => void): () => void {
  _listeners.add(fn);
  return () => {
    _listeners.delete(fn);
  };
}

/** Monotonic change counter — the `getSnapshot` for `useSyncExternalStore`. */
export function workspaceDocumentRegistryVersion(): number {
  return _version;
}

/** The open documents, in open order (stable reference between changes). */
export function openWorkspaceDocuments(): readonly OpenWorkspaceDocument[] {
  return _open;
}

/** The active document's id, or `null` when no document is open. */
export function activeWorkspaceDocumentId(): string | null {
  return _activeId;
}

/** Native occurrence selected by the workbench, never a document/group alias. */
export function activeWorkspaceDocumentViewId(): string | null {
  return _activeViewId;
}

export function setActiveWorkspaceDocumentView(id: string, viewId: string): void {
  if (!activateWorkspaceDocument(id)) return;
  if (_activeViewId === viewId) return;
  _activeViewId = viewId;
  notifyChanged();
}

/** The active open document, or `null`. */
export function activeWorkspaceDocument(): OpenWorkspaceDocument | null {
  return _open.find((d) => d.descriptor.id === _activeId) ?? null;
}

function setActive(nextId: string | null): void {
  if (nextId === _activeId) return;
  if (nextId) noteViewportActivationGesture(nextId);
  const prev = _open.find((d) => d.descriptor.id === _activeId);
  _activeId = nextId;
  _activeViewId = null;
  prev?.descriptor.onDeactivate?.(prev.descriptor.id);
  const next = _open.find((d) => d.descriptor.id === nextId);
  next?.descriptor.onActivate?.(next.descriptor.id);
}

/** Options for {@link openWorkspaceDocument}. */
export interface OpenWorkspaceDocumentOptions {
  /** Replace the previous clean automatic preview instead of accumulating tabs.
   * Explicit opens and dirty documents are retained. */
  readonly preview?: boolean;
  /**
   * `false` opens the document WITHOUT making it active — the tab appears,
   * the user's current document keeps focus. This is what an automatically
   * present standing tab needs: it is offered, never imposed. It cannot leave
   * the workspace with no active document, so it still activates when nothing
   * else is active (the "there is always an active center document"
   * invariant `syncCenterDocuments` also asserts). Default `true`.
   */
  readonly activate?: boolean;
}

function updateAutomaticPreview(
  id: string,
  existing: boolean,
  preview: boolean,
  activate: boolean,
): void {
  if (existing) {
    if (!preview && activate && _previewId === id) _previewId = null;
    return;
  }
  if (!preview) return;
  if (_previewId) closeWorkspaceDocument(_previewId);
  _previewId = id;
}

/**
 * Open a document (§7.1 open semantics): appends it to the open set and
 * makes it active. If `descriptor.id` is ALREADY open, the existing document
 * is activated and its original descriptor kept (stable identity — a
 * re-open never silently swaps content). Returns the id.
 */
export function openWorkspaceDocument(
  descriptor: WorkspaceDocumentDescriptor,
  options: OpenWorkspaceDocumentOptions = {},
): string {
  const restoresPendingActivation = _pendingRestoredActiveId === descriptor.id;
  const activate = restoresPendingActivation || options.activate !== false;
  const existing = _open.find((d) => d.descriptor.id === descriptor.id);
  updateAutomaticPreview(descriptor.id, !!existing, options.preview === true, activate);
  if (!existing) {
    _open = [..._open, { descriptor, dirty: false, title: descriptor.title }];
    // AN AREA DOCUMENT IS NEVER THE ACTIVE ONE. It is not a tab in the centre
    // strip at all — it is the workspace's second editor group — so the
    // "there is always an active center document" fallback must not reach for
    // it: activating it would point the inspector, the hotkey scope and the
    // header strip at the UV editor while the model is the subject on screen.
    // The workspace opens it with `activate: false`; this is the fallback's
    // half of the same statement.
    if (!descriptor.area && (activate || _activeId === null)) setActive(descriptor.id);
    if (restoresPendingActivation) settlePendingRestoredActivation(descriptor.id);
    notifyChanged();
    return descriptor.id;
  }
  // Already open: activate (or no-op if already active) — same guard as
  // `activateWorkspaceDocument` — AND take the descriptor's SLOTS afresh. A
  // tool document's module is re-evaluated on every save (`tool-loader.ts`),
  // so a `Toolbar` the module gained after the document first opened arrived
  // on a descriptor this registry then threw away: measured 2026-09-03, the
  // mesh document's header export was served and never rendered until the
  // tab was reloaded. Content and Toolbar are the two mount slots; the rest
  // of the descriptor (id, title, provenance, presentation) is identity and
  // stays with the open entry.
  let changed = false;
  if (
    existing.descriptor.Toolbar !== descriptor.Toolbar ||
    existing.descriptor.Shelf !== descriptor.Shelf ||
    existing.descriptor.Content !== descriptor.Content
  ) {
    _open = _open.map((d) => {
      if (d !== existing) return d;
      const { Toolbar: _toolbar, Shelf: _shelf, ...rest } = d.descriptor;
      return {
        ...d,
        descriptor: {
          ...rest,
          Content: descriptor.Content,
          ...(descriptor.Toolbar ? { Toolbar: descriptor.Toolbar } : {}),
          ...(descriptor.Shelf ? { Shelf: descriptor.Shelf } : {}),
        },
      };
    });
    changed = true;
  }
  if (activate && _activeId !== descriptor.id) {
    setActive(descriptor.id);
    changed = true;
  }
  if (changed) notifyChanged();
  if (restoresPendingActivation) settlePendingRestoredActivation(descriptor.id);
  return descriptor.id;
}

/** Activate an open document. Returns `false` (no-op) for unknown ids. */
export function activateWorkspaceDocument(id: string): boolean {
  if (!_open.some((d) => d.descriptor.id === id)) return false;
  if (_activeId !== id) {
    setActive(id);
    notifyChanged();
  }
  return true;
}

/**
 * Drop a restored activation still waiting for its document to register. A
 * deliberate act that brings another document forward (entering Play brings
 * the Game) is newer than the session's remembered focus, which must not land
 * on top of it when the remembered document registers (measured on `arena`: a
 * session reopened on the Scene and played at once kept the Scene in front,
 * because the Scene registered after Play had activated the Game).
 */
export function supersedeRestoredActivation(): void {
  _pendingRestoredActiveId = null;
}

/**
 * Restore activation for a stable pinned document that project discovery may
 * register later. Unlike {@link activateWorkspaceDocument}, this intentionally
 * remembers an unknown id; callers must restrict it to identities the editor
 * itself owns, never arbitrary persisted tool/asset ids.
 */
export function restorePinnedWorkspaceDocumentActivation(id: string): void {
  if (activateWorkspaceDocument(id)) {
    _pendingRestoredActiveId = null;
    return;
  }
  _pendingRestoredActiveId = id;
}

/**
 * Close an open document: removes it (calling `onDeactivate` if it was
 * active, then `onDispose`) and, when it was active, activates its left
 * neighbor (else the right one, else none) — the standard tabbed-editor
 * fallback. Returns `false` (no-op) for unknown ids. `closeable: false` is
 * a HOST affordance rule (no × on the tab), not a registry invariant —
 * programmatic close (project switch, W1 host teardown) must always work.
 *
 * Re-entrancy guard: the neighbor's `onActivate` (fired inside `setActive`
 * below, while `closing` is still in `_open`) can synchronously bounce back
 * into a close of the SAME id it is still closing — e.g. a store-notify
 * subscriber re-derives its open set from `_open`, sees `closing` still
 * present (the filter hasn't run yet), and calls `closeWorkspaceDocument`
 * again for it. Without a guard that inner call would run the full close
 * body a second time and fire `onDispose` twice for one close. `_closingIds`
 * marks `id` in-flight for the duration of this call so the re-entrant call
 * is a no-op (returns `false` immediately) — the outer call is the only one
 * that ever filters `_open` / fires `onDispose`, and the pinned lifecycle
 * order (onDeactivate → neighbor onActivate → onDispose) is unchanged.
 */
export function closeWorkspaceDocument(
  id: string,
  options: { discardDirty?: boolean } = {},
): boolean {
  if (_closingIds.has(id)) return false;
  const idx = _open.findIndex((d) => d.descriptor.id === id);
  if (idx < 0) return false;
  const closing = _open[idx] as OpenWorkspaceDocument;
  // A close gesture is not authorization to destroy an authored draft. The
  // The tab presents Save / Discard / Cancel and calls back with the
  // explicit discard flag only after the user chooses it. Project teardown
  // uses closeAllWorkspaceDocuments(), whose lifecycle semantics are separate.
  if (closing.dirty && !options.discardDirty) return false;
  _closingIds.add(id);
  try {
    const wasActive = _activeId === id;
    if (wasActive) {
      // Left neighbor, else right, else none — computed on the PRE-removal
      // array so the indices are the real tab neighbors.
      const neighbor = idx > 0 ? _open[idx - 1] : (_open[idx + 1] ?? null);
      // `closing` must still be in `_open` here: `setActive`'s `prev` lookup
      // finds it by `_activeId` and fires its `onDeactivate` before the
      // neighbor's `onActivate` — firing this AFTER filtering `_open` (the
      // former bug) made the lookup miss and silently skip onDeactivate.
      setActive(neighbor ? neighbor.descriptor.id : null);
    }
    _open = _open.filter((d) => d.descriptor.id !== id);
    if (_previewId === id) _previewId = null;
    _saveHandlers.delete(id);
    _selectionProviders.delete(id);
    closing.descriptor.onDispose?.(id);
    notifyChanged();
    return true;
  } finally {
    _closingIds.delete(id);
  }
}

/** Close every open document (project switch / host teardown): each gets its
 *  `onDeactivate` (active one only) + `onDispose`, in open order. */
export function closeAllWorkspaceDocuments(): void {
  if (_open.length === 0 && _activeId === null) return;
  const closing = _open;
  // Fire onDeactivate for the active document WHILE it is still in `_open`
  // (setActive's `prev` lookup needs to find it) — clearing `_open` first
  // (the former bug) made the lookup miss and silently skip onDeactivate.
  setActive(null);
  _open = [];
  _activeViewId = null;
  _previewId = null;
  _saveHandlers.clear();
  _selectionProviders.clear();
  _pendingRestoredActiveId = null;
  for (const doc of closing) doc.descriptor.onDispose?.(doc.descriptor.id);
  notifyChanged();
}

/** Install the save capability supplied by a mounted document editor. The
 * returned cleanup cannot remove a newer handler installed for the same id. */
export function registerWorkspaceDocumentSaveHandler(
  id: string,
  handler: WorkspaceDocumentSaveHandler,
): () => void {
  if (!_open.some((document) => document.descriptor.id === id)) return () => {};
  _saveHandlers.set(id, handler);
  return () => {
    if (_saveHandlers.get(id) === handler) _saveHandlers.delete(id);
  };
}

/**
 * Install the live authoring context supplied by a mounted document surface.
 *
 * Descriptors describe a document before its React content mounts. Native
 * source documents, however, only obtain their live adapter after project
 * code has instantiated its graph. This runtime registration completes the
 * existing descriptor-level `selection` hook without introducing a parallel
 * hierarchy/Inspector context. The returned cleanup cannot remove a newer
 * provider installed for the same document (HMR/StrictMode safe).
 */
export function registerWorkspaceDocumentSelection(
  id: string,
  provider: () => WorkspaceDocumentSelection | null,
): () => void {
  if (!_open.some((document) => document.descriptor.id === id)) return () => {};
  _selectionProviders.set(id, provider);
  notifyChanged();
  return () => {
    if (_selectionProviders.get(id) !== provider) return;
    _selectionProviders.delete(id);
    notifyChanged();
  };
}

/**
 * Report that an already-registered document selection provider now resolves
 * to a different live subject. Providers are deliberately stable closures so
 * a document can finish constructing its adapter after the shell mounts; the
 * shared Hierarchy and Inspector still need one explicit invalidation when
 * that late-bound value changes.
 */
export function notifyWorkspaceDocumentSelectionChanged(id: string): void {
  if (!_selectionProviders.has(id)) return;
  notifyChanged();
}

/** Save one open document. `null` means that document has no document-local
 * save capability, so callers may preserve a legacy/fallback save path. */
export async function saveWorkspaceDocument(id: string): Promise<boolean | null> {
  if (!_open.some((document) => document.descriptor.id === id)) return null;
  const handler = _saveHandlers.get(id);
  if (!handler) return null;
  try {
    return await handler();
  } catch {
    return false;
  }
}

/** Save the active authored subject, or `null` when it has no local saver. */
export function saveActiveWorkspaceDocument(): Promise<boolean | null> {
  return _activeId ? saveWorkspaceDocument(_activeId) : Promise.resolve(null);
}

/** Set a document's dirty flag (§7.1 optional dirty state). Unknown ids and
 *  no-op transitions are ignored without notification. */
export function setWorkspaceDocumentDirty(id: string, dirty: boolean): void {
  if (dirty && _previewId === id) _previewId = null;
  const idx = _open.findIndex((d) => d.descriptor.id === id);
  if (idx < 0) return;
  const doc = _open[idx] as OpenWorkspaceDocument;
  if (doc.dirty === dirty) return;
  _open = _open.map((d) => (d.descriptor.id === id ? { ...d, dirty } : d));
  notifyChanged();
}

/** Set a document's live display title (see {@link OpenWorkspaceDocument}).
 *  Unknown ids and no-op transitions are ignored without notification. */
export function setWorkspaceDocumentTitle(id: string, title: string): void {
  const doc = _open.find((d) => d.descriptor.id === id);
  if (!doc || doc.title === title) return;
  _open = _open.map((d) => (d.descriptor.id === id ? { ...d, title } : d));
  notifyChanged();
}

/** A document's selection/Inspector context (guarded: a throwing `selection`
 *  is treated as "no context" — same failure physics as tool-loader's match
 *  guard; the shell must never crash on a contribution). */
export function workspaceDocumentSelection(id: string): WorkspaceDocumentSelection | null {
  const doc = _open.find((d) => d.descriptor.id === id);
  const selection = _selectionProviders.get(id) ?? doc?.descriptor.selection;
  if (!selection) return null;
  try {
    return selection();
  } catch {
    return null;
  }
}

/** The active center document's live authoring context, when it owns one. */
export function activeWorkspaceDocumentSelection(): WorkspaceDocumentSelection | null {
  return _activeId ? workspaceDocumentSelection(_activeId) : null;
}

/** Test-only reset (mirrors `__resetInspectorSectionRegistryForTest`) —
 *  drops all state WITHOUT firing lifecycle hooks. */
export function __resetWorkspaceDocumentRegistryForTest(): void {
  _open = [];
  _activeViewId = null;
  _previewId = null;
  _activeId = null;
  _saveHandlers.clear();
  _selectionProviders.clear();
  notifyChanged();
}
