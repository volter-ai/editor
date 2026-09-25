import {
  openAvailableWorkspaceDocument,
  requestAvailableWorkspaceDocument,
} from './workspace-available-documents';
/**
 * PERSISTED WORKSPACE STATE: which named workspace the project was left in,
 * which documents were open, which one was in front, and each kind's own
 * session cell. Restored on boot, written through (debounced) on every change.
 * Manual hierarchy openness is NOT here - it persists in its own store
 * (`hierarchy-expansion-state.ts`), same key discipline.
 *
 * NO GEOMETRY LIVES HERE, and that is the whole shape of this module. Where a
 * document is DRAWN - groups, sizes, tab order, split geometry - is the
 * workbench's own editor-group state, which VS Code persists itself. This
 * module records the SET and nothing about its arrangement; a reload reopens
 * the same documents into whatever grid the workbench restored. Geometry that
 * two owners both record is geometry they can disagree about, and the
 * workbench is the one that draws it.
 *
 * STORAGE DECISION (owner ruling, 2026-09-04 - ARCHITECTURE-CORE §Editor
 * chrome, "Settings have four layers with named homes"): the `workspace`
 * SECTION of the project-local document (`project-local-state.ts`), which is
 * `.vgai/editor-state.json` - git-ignored by the scaffold, written by the
 * editor server locally, keyed by the folder itself.
 *
 * DOCUMENTS: THIS MODULE NAMES NONE OF THEM. It stores, per open document, an
 * OPAQUE blob under that document's KIND and ID - whatever the descriptor's
 * own `persist` returns - and on the next boot hands each blob back to the
 * kind's registered restorer (`workspace-document-restore.ts`). The rule
 * "persist+restore only documents that can truthfully reopen - verify on
 * restore, drop silently if gone" is unchanged; every kind owns its own
 * answer:
 *
 *  - a document that nothing at boot re-derives, and whose subject is a
 *    stable addressable state, declares `persist` and verifies itself on the
 *    way back (`restore` answering `false` is the whole drop mechanism);
 *  - a document something else reopens unconditionally, and one whose subject
 *    is a live session or an unresolved remote view, declares no `persist` at
 *    all, and simply does not come back.
 *
 * A kind with NO restorer registered - a module that is gone, a package this
 * project no longer depends on, a record another build wrote - restores
 * nothing, silently. That is the entire compatibility rule for a document's
 * blob. The RECORD around it carries one number,
 * {@link WORKSPACE_STATE_VERSION}, and a record written in any other shape is
 * read as no record at all: no migration, no dual-read, no compat branch.
 *
 * CONTRIBUTIONS LOAD FIRST, AND BEFORE THE CLOCK STARTS. A restorer usually
 * belongs to the module that opens the kind, and that module can be a
 * package's - whose code loads on the contribution pass, which
 * `project-tool-discovery.ts` defers behind the opening viewport frame. So a
 * record with any open document awaits ONE contribution pass first, which is
 * that module's header's sanctioned exception to its own deferral. It cannot
 * deadlock: the deferral lives in the discovery LIFECYCLE, not in
 * `refreshProjectToolContributions` itself. Without it the host would drop a
 * package's documents on every boot and silently call it a verification
 * failure. That load is NOT inside `RESTORE_TIMEOUT_MS`: it is a known startup
 * cost (9s on a cold `full` scaffold, measured 2026-09-18), not the hung fetch
 * the bound guards, and counting it made the bound fire on every boot.
 *
 * Write-through is debounced (300ms trailing) and flushed on `pagehide`, so
 * an immediate reload still captures the last change. Subscriptions install
 * only AFTER the async restore finishes - a half-restored open-set must
 * never overwrite the stored one. That wait is BOUNDED (`RESTORE_TIMEOUT_MS`):
 * a hung verification fetch (e.g. a stalled asset-existence probe) must never
 * block write-through + pagehide-flush installation for the whole session -
 * open-tab state is convenience state, not project truth, so availability
 * beats completeness here. If the restore itself keeps running past the
 * timeout, its later document-opens still land normally; only the
 * subscription install is time-boxed, not the restore itself.
 */

import { editorViewFromUrl } from '@volter/editor-sdk';
import { projectAdapterFacet, waitForProjectAdapter } from './project-adapter';
import {
  preloadProjectLocalState,
  projectLocalSection,
  projectLocalStateReady,
  writeProjectLocalSection,
} from './project-local-state';
import { getCurrentProject } from './project-manager';
import { refreshProjectToolContributions } from './tool-loader';
import { PINNED_ASYNC_DOCUMENT_IDS } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activateWorkspaceDocument,
  activeWorkspaceDocumentId,
  type OpenWorkspaceDocument,
  openWorkspaceDocuments,
  restorePinnedWorkspaceDocumentActivation,
  subscribeWorkspaceDocuments,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import {
  type WorkspaceStateStore,
  workspaceDocumentRestorerEntries,
  workspaceDocumentRestorers,
} from './workspace-document-restore';
import { isWorkspacePersistenceSuppressed } from './workspace-persistence-gate';
import {
  activeEditorWorkspace,
  defaultEditorWorkspace,
  offerRestoredEditorWorkspace,
  type EditorWorkspaceId,
  isEditorWorkspaceId,
  setEditorWorkspace,
  workspaceApplies,
} from './workspace-presets';

interface WorkspaceRestoreEpoch {
  readonly generation: number;
  readonly promise: Promise<void>;
  active: boolean;
}

let workspaceRestoreGeneration = 0;
let currentWorkspaceRestore: WorkspaceRestoreEpoch | null = null;
const workspaceRestoreWaiters = new Set<(epoch: WorkspaceRestoreEpoch) => void>();

function publishWorkspaceRestore(promise: Promise<void>): WorkspaceRestoreEpoch {
  const epoch: WorkspaceRestoreEpoch = {
    generation: ++workspaceRestoreGeneration,
    promise,
    active: true,
  };
  currentWorkspaceRestore = epoch;
  for (const resolve of workspaceRestoreWaiters) resolve(epoch);
  workspaceRestoreWaiters.clear();
  return epoch;
}

function nextWorkspaceRestore(): Promise<WorkspaceRestoreEpoch> {
  const current = currentWorkspaceRestore;
  if (current?.active) return Promise.resolve(current);
  return new Promise((resolve) => workspaceRestoreWaiters.add(resolve));
}

/** URL presentation waits for local convenience state so the explicit link wins. */
export async function waitForWorkspaceStateRestore(): Promise<void> {
  // The workspace installs persistence when it mounts. A generation gate,
  // rather than an elapsed-time poll, makes a remount deterministic: a waiter
  // that observes a disposed epoch follows the next install, and a newer epoch
  // that appeared while it awaited is also joined. This is what prevents URL
  // presentation from racing a stale generation on a fast reload.
  for (;;) {
    const epoch = await nextWorkspaceRestore();
    await epoch.promise;
    if (currentWorkspaceRestore === epoch && epoch.active) return;
  }
}

/**
 * THE SHAPE of the record this module writes, as ONE number. A record whose
 * `version` is not exactly this is read as absent: the project opens on its
 * default document and the next write-through replaces it. An open set is
 * convenience state, so a shape change memory-holes it — no migration, no
 * dual-read, no compat branch (ARCHITECTURE-CORE §Removal doctrine, §Editor
 * chrome "memory-holed, never migrated").
 *
 * The shape this number names: `{ version, workspace?, documents?: { open:
 * { kind, id, state }[], activeId, kinds? } }`. Change any
 * of it — a key's name, a nesting, what a value means — and bump this in the
 * same commit, because nothing else lets the reader tell a stale record from a
 * current one.
 */
const WORKSPACE_STATE_VERSION = 15;
const WRITE_DEBOUNCE_MS = 300;
/** Bound on the document-restore verification before write-through installs
 *  anyway (module header's "wait is BOUNDED" rule). */
const RESTORE_TIMEOUT_MS = 10_000;

/**
 * One persisted, restorable document: the KIND that owns it, its id, and that
 * kind's own opaque blob. This module never looks inside `state`.
 */
export interface PersistedDocument {
  readonly kind: string;
  readonly id: string;
  readonly state: unknown;
}

/** The section of the project-local document this module owns. */
const WORKSPACE_SECTION = 'workspace';

export interface PersistedWorkspaceState {
  /** {@link WORKSPACE_STATE_VERSION} as of the write. Any other value — including
   *  a record written before this field existed — is read as no record at all. */
  readonly version: number;
  // A `chat` field lived here until phase 1 unit 21 — one optional static
  // panel's collapsed/surface choice, which made this module import
  // `harness-chat-layout.ts` by name to save it. A static panel's OWNER keeps
  // its own state now, in its own section of the same project-local document
  // (`project-local-state.ts`), and the host persists only the workspace.
  /** The active NAMED WORKSPACE, restored BEFORE layout restore: it selects
   *  which `workspaces` entry the layout restore reads. */
  readonly workspace?: EditorWorkspaceId;
  readonly documents?: {
    open: PersistedDocument[];
    activeId: string | null;
    /** Per-KIND session state (`persistKindState`) — what belongs to a kind
     *  rather than to one open document, such as a discovery baseline that
     *  must survive a full reload. One cell per kind, opaque here. */
    kinds?: Record<string, unknown>;
  };
}

/** This project's persisted workspace state — the `workspace` section of the
 *  project-local document (`project-local-state.ts`), or `null` when the
 *  project has never arranged anything AND when what it arranged was written in
 *  another shape ({@link WORKSPACE_STATE_VERSION}). Exported for tests. */
export function readPersistedWorkspaceState(): PersistedWorkspaceState | null {
  const section = projectLocalSection<PersistedWorkspaceState>(WORKSPACE_SECTION);
  if (!section || section.version !== WORKSPACE_STATE_VERSION) return null;
  return section;
}

function writePersistedWorkspaceState(state: PersistedWorkspaceState): void {
  writeProjectLocalSection(WORKSPACE_SECTION, state);
}

/**
 * Serialize the restorable half of one open document through the kind's own
 * `persist` door, or `null` when this document does not persist. A throwing
 * contribution is treated as "does not persist" — the shell must never crash
 * on one. Exported for tests.
 */
export function persistableDocument(doc: OpenWorkspaceDocument): PersistedDocument | null {
  const { descriptor } = doc;
  if (!descriptor.persist) return null;
  let state: unknown;
  try {
    state = descriptor.persist({ id: descriptor.id, title: doc.title });
  } catch {
    return null;
  }
  if (state === undefined || state === null) return null;
  return { kind: descriptor.kind, id: descriptor.id, state };
}

/** Every registered kind's own session state, keyed by kind. Two restorers
 *  sharing one kind share the cell, in registration order — a kind is one
 *  subject, so its session state is one value. */
function persistedKindStates(): Record<string, unknown> | undefined {
  const states: Record<string, unknown> = {};
  let any = false;
  for (const restorer of workspaceDocumentRestorerEntries()) {
    if (!restorer.persistKindState) continue;
    let value: unknown;
    try {
      value = restorer.persistKindState();
    } catch {
      continue;
    }
    if (value === undefined || value === null) continue;
    states[restorer.kind] = value;
    any = true;
  }
  return any ? states : undefined;
}

/**
 * Snapshot the CURRENT session state: which named workspace is active, which
 * documents are open, which one is in front, and each kind's own session cell.
 *
 * NO GEOMETRY. Where each document is DRAWN is the workbench's editor-group
 * state, which VS Code persists itself; this module records only the SET, and
 * that is what makes a reload reopen the same documents in whatever grid the
 * workbench restored.
 */
export function snapshotWorkspaceState(): PersistedWorkspaceState {
  const open: PersistedDocument[] = [];
  for (const doc of openWorkspaceDocuments()) {
    const persisted = persistableDocument(doc);
    if (persisted) open.push(persisted);
  }
  const kinds = persistedKindStates();
  return {
    version: WORKSPACE_STATE_VERSION,
    workspace: activeEditorWorkspace(),
    documents: {
      open,
      activeId: activeWorkspaceDocumentId(),
      ...(kinds ? { kinds } : {}),
    },
  };
}

/**
 * Reopen ONE persisted document through its kind's registered restorers, in
 * registration order, until one answers that it could. Returns whether any
 * CLAIMED it — a claim is not the same as being open, because a kind may
 * reopen asynchronously (it activates itself in that case; see
 * `WorkspaceDocumentRestoreContext.active`).
 *
 * An unknown kind has no restorers and is dropped silently, which is also
 * what a record written before this shape existed gets.
 */
async function restoreOneDocument(
  store: WorkspaceStateStore,
  doc: PersistedDocument,
  activeId: string | null,
): Promise<boolean> {
  for (const restorer of workspaceDocumentRestorers(doc.kind)) {
    try {
      const claimed = await restorer.restore({
        id: doc.id,
        state: doc.state,
        active: doc.id === activeId,
        store,
      });
      if (claimed) return true;
    } catch {
      // Drop silently — a document that cannot truthfully reopen is gone.
    }
  }
  return false;
}

/** Restore an active id now, or hand a stable async board id to the document
 * registry so its later project-owned registration completes the request. */
function restoreActiveDocument(id: string | null): boolean {
  if (!id) return false;
  if (openAvailableWorkspaceDocument(id)) return true;
  if (PINNED_ASYNC_DOCUMENT_IDS.has(id)) {
    requestAvailableWorkspaceDocument(id);
    restorePinnedWorkspaceDocumentActivation(id);
    return true;
  }
  return activateWorkspaceDocument(id);
}

/** Tell every registered kind the session is beginning, with its own session
 *  state and whether there is any persisted document to bring back. A throwing
 *  contribution must never take the workspace down with it. */
function beginKindRestores(
  store: WorkspaceStateStore,
  docs: PersistedWorkspaceState['documents'],
): void {
  const kinds = docs?.kinds ?? {};
  // NOT `docs !== undefined`. A record that lists NO open document is the same
  // fact as no record at all for every kind that reads this: nothing is coming
  // back, so the project's own default document is what the workspace opens on
  // (see `WorkspaceDocumentKindRestoreContext.hasDocumentsToRestore`).
  const hasDocumentsToRestore = (docs?.open.length ?? 0) > 0;
  for (const restorer of workspaceDocumentRestorerEntries()) {
    if (!restorer.beginRestore) continue;
    try {
      restorer.beginRestore({
        state: kinds[restorer.kind],
        hasDocumentsToRestore,
        documentsToRestore: (docs?.open ?? []).map((doc) => ({ kind: doc.kind, state: doc.state })),
        store,
      });
    } catch {
      // Same failure physics as every other contribution call here.
    }
  }
}

/** Settle the sources every present kind verifies against, ONCE — deduped by
 *  function identity, so two kinds reading one registry refresh it once (a
 *  second concurrent refresh would abort the first). */
function settleKindSources(open: readonly PersistedDocument[]): Promise<unknown> {
  const prepares = new Set<() => Promise<void>>();
  for (const doc of open) {
    for (const restorer of workspaceDocumentRestorers(doc.kind)) {
      if (restorer.prepare) prepares.add(restorer.prepare);
    }
  }
  return Promise.all([...prepares].map((prepare) => prepare().catch(() => {})));
}

/**
 * Restore the persisted open documents + active document (exported for
 * tests). Every registered kind first hears the session begin — with its own
 * session state and whether this project has a record at all — then the kinds
 * actually present settle their sources ONCE (`prepare`, deduped by function
 * identity so two kinds reading one registry refresh it once), and finally
 * each document reopens in the original tab order against a settled store.
 */
export async function restoreWorkspaceDocuments(
  store: WorkspaceStateStore,
  persisted: PersistedWorkspaceState | null,
): Promise<void> {
  const docs = persisted?.documents;
  beginKindRestores(store, docs);
  if (!docs || docs.open.length === 0) {
    // Project-owned pinned boards register after async authoring bootstrap.
    // Preserve their requested activation until that stable descriptor opens;
    // arbitrary missing ids still reject rather than becoming latent state.
    restoreActiveDocument(docs?.activeId ?? null);
    return;
  }
  await settleKindSources(docs.open);
  for (const doc of docs.open) {
    await restoreOneDocument(store, doc, docs.activeId);
  }
  // Restore the saved active tab when available. Otherwise retain the
  // registry's selection from opening the surviving documents (or no active
  // document when none opened). A restorer that claimed the active document
  // asynchronously activates it when ready; no particular document is required.
  restoreActiveDocument(docs.activeId);
}

/**
 * Install workspace-state persistence for this session:
 *  1. apply the named workspace the project was left in;
 *  2. restore its open documents (async, verified - module header rules);
 *  3. subscribe write-through (debounced 300ms, flushed on pagehide).
 * Returns a teardown (unsubscribes; flushes a pending write).
 */
export function installWorkspaceStatePersistence(store: WorkspaceStateStore): () => void {
  // The project-local document is loaded when the project became active; on a
  // boot where the workspace mounts first, the restore epoch published here
  // spans the load, so `waitForWorkspaceStateRestore` still waits for what is
  // actually on disk.
  if (!projectLocalStateReady() || (getCurrentProject() && !projectAdapterFacet())) {
    let disposed = false;
    let inner: (() => void) | null = null;
    let settle: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const epoch = publishWorkspaceRestore(gate);
    void Promise.all([preloadProjectLocalState(), waitForProjectAdapter()]).then(() => {
      if (disposed) {
        settle();
        return;
      }
      inner = installWorkspaceStatePersistence(store);
      // The inner install published its own epoch; this outer one steps
      // aside and settles once that one does.
      epoch.active = false;
      void waitForWorkspaceStateRestore().finally(settle);
    });
    return () => {
      disposed = true;
      inner?.();
    };
  }
  const persisted = readPersistedWorkspaceState();
  // The named workspace is applied FIRST: it decides which documents the
  // workspace's own areas open beside the restored set. This is one of the
  // explicit acts allowed to move the workspace (module header of
  // `workspace-presets.ts`) - restoring the session boundary the user left.
  if (
    persisted?.workspace &&
    isEditorWorkspaceId(persisted.workspace) &&
    workspaceApplies(persisted.workspace)
  ) {
    setEditorWorkspace(persisted.workspace);
  } else {
    // Nothing recorded for THIS checkout, or a record whose contribution or
    // shape has not arrived yet: the record stays a candidate the provisional
    // default takes when it can; until then the project's declaration, the
    // product's workspace, else the first workspace its shape meets.
    if (persisted?.workspace) offerRestoredEditorWorkspace(persisted.workspace);
    setEditorWorkspace(defaultEditorWorkspace(), { provisional: true });
  }

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribers: Array<() => void> = [];

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // Immersive play-mode chrome hide (`live-transition.ts`) suppresses writes
    // for that play session - a play-time open set is transient presentation,
    // never user intent. The gate also covers the pagehide flush and the
    // teardown flush below. Belt-and-suspenders: also refuse while the store
    // reports play active, so a transient rebuild that desynchronizes the
    // suppression flag mid-play still cannot persist it.
    if (
      isWorkspacePersistenceSuppressed() ||
      (store.playState !== undefined && store.playState !== 'stopped')
    )
      return;
    writePersistedWorkspaceState(snapshotWorkspaceState());
  };
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, WRITE_DEBOUNCE_MS);
  };
  const onPageHide = () => flush();

  // Subscriptions install only after restore settles (module header: a
  // half-restored open-set must never overwrite the stored one). A teardown
  // racing the restore is honored via `disposed`. Bounded by
  // `RESTORE_TIMEOUT_MS`: a hung verification fetch (a stalled asset-existence
  // probe, a network partition on a kind's own `prepare` refresh) must never
  // leave the WHOLE session with no write-through and no pagehide flush -
  // open-tab state is convenience state, availability beats completeness.
  // Whichever settles first wins; if the restore is still running when the
  // timeout fires, its later document-opens still land normally.
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  // A share URL is explicit presentation intent: do not reopen locally
  // persisted subjects that could race and overwrite it.
  const hasSharedView =
    typeof window !== 'undefined' && editorViewFromUrl(window.location.href) !== null;
  // A checkout with no record at all still goes through the documents
  // restore: that is where a never-recorded project opens on its default
  // document.
  // THE CONTRIBUTION PASS IS NOT PART OF THE VERIFICATION BOUND. A package
  // owns its documents' restorers as well as their code, so the kinds a
  // record names exist only once contributions have loaded - but that load is
  // a known startup cost (measured 9s on a cold `full` scaffold), not the
  // hung fetch `RESTORE_TIMEOUT_MS` guards against. Counting it against that
  // bound made the bound fire on EVERY boot, which is a mis-set bound rather
  // than a safety net. So: load first, then start the clock.
  const contributionsLoaded =
    hasSharedView || !(persisted?.documents?.open.length ?? 0)
      ? Promise.resolve()
      : refreshProjectToolContributions().catch(() => {});
  const restoreSettled = contributionsLoaded
    .then(() => (hasSharedView ? undefined : restoreWorkspaceDocuments(store, persisted)))
    .catch(() => {});
  const restoreTimedOut = new Promise<void>((resolve) => {
    void contributionsLoaded.then(() => {
      if (disposed) return;
      restoreTimer = setTimeout(() => {
        resolve();
      }, RESTORE_TIMEOUT_MS);
    });
  });
  const restorePromise = Promise.race([restoreSettled, restoreTimedOut]).then(() => {
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    if (disposed) return;
    unsubscribers.push(subscribeWorkspaceDocuments(schedule));
    window.addEventListener('pagehide', onPageHide);
  });
  const restoreEpoch = publishWorkspaceRestore(restorePromise);
  void restorePromise;

  return () => {
    disposed = true;
    restoreEpoch.active = false;
    if (currentWorkspaceRestore === restoreEpoch) currentWorkspaceRestore = null;
    if (restoreTimer !== null) clearTimeout(restoreTimer);
    for (const unsub of unsubscribers) unsub();
    window.removeEventListener('pagehide', onPageHide);
    if (timer !== null) flush();
  };
}
