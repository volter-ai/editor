/**
 * A CONTRIBUTED DOCUMENT KIND OWNS ITS OWN PERSISTED STATE — the other half
 * of `WorkspaceDocumentDescriptor.persist` (docs/WORKBENCH.md §host versus
 * package).
 *
 * THE RULE. `workspace-state-persistence.ts` stores, per open document, an
 * OPAQUE blob under that document's kind and id. It never reads inside the
 * blob and it names no document module: on the next boot it looks the kind up
 * here and hands the blob back. A kind with no restorer registered — a module
 * that is gone, a package this project no longer depends on, a record written
 * by another build — restores NOTHING, silently. That is the entire
 * compatibility story for a blob: it carries no version field of its own and
 * no migration.
 *
 * WHY IT EXISTS. Before this, the host switched on every document kind by
 * name (the story documents and their registry, the adapter-table documents,
 * the tool documents, the asset documents), so moving ANY of them into a
 * package meant editing that one host file — which serialized every
 * extraction against every other, and reverted one of them rather than land
 * a half-move (measured 2026-09-18).
 *
 * WHAT A RESTORER IS FOR. `restore` reopens ONE document from its own blob
 * and answers whether it could: `false` is the honest answer for a module
 * that no longer loads, a story that is no longer exported, a file that is
 * gone. Verification belongs HERE, not in the host, because only the kind
 * knows what "still true" means for its subject. `prepare` is the kind's own
 * async settling step (refresh the registry this kind reads), awaited ONCE
 * before its documents restore and only when at least one is present.
 * `persistKindState`/`beginRestore` carry the state that belongs to the KIND
 * rather than to one open document — a discovery baseline, a "what opens when
 * this project has never recorded anything" rule.
 */


/** The narrow store surface every document open function declares (the T6.3
 *  input-gate hand-off). Defined here, beside the restore seam, so a document
 *  module can accept it without importing the persistence host. */
export interface WorkspaceStateStore {
  /** Live play state — the write-through gate reads it so no layout write can
   *  land while a game is playing/paused, even if the play-transition
   *  suppression flag is momentarily out of phase during a chaotic teardown
   *  (a transient-renderer error-boundary rebuild that tears play down and
   *  re-enters). Optional so unit-test fakes need not supply it (treated as
   *  'stopped'). */
  readonly playState?: 'stopped' | 'playing' | 'paused';
}

/** What {@link WorkspaceDocumentRestorer.restore} is handed for one document. */
export interface WorkspaceDocumentRestoreContext {
  /** The document id that was open — the same id `persist` was called under. */
  readonly id: string;
  /** Exactly what this document's `persist` returned last session. Opaque to
   *  the host, so a restorer must treat it as untrusted input. */
  readonly state: unknown;
  /** Whether this document was the ACTIVE tab. A kind that opens
   *  asynchronously must activate itself, because the host has already asked
   *  for the stored active id by the time a late open lands. */
  readonly active: boolean;
  readonly store: WorkspaceStateStore;
}

/** What {@link WorkspaceDocumentRestorer.beginRestore} is handed, once per
 *  session, for every registered kind. */
export interface WorkspaceDocumentKindRestoreContext {
  /** Whatever `persistKindState` returned last session, or `undefined`. */
  readonly state: unknown;
  /**
   * Whether this session has any persisted document to BRING BACK. `false` is
   * the moment a kind may open the project's own default document.
   *
   * It used to ask a narrower question — "does this project have a documents
   * record at all" — and the two decorrelate in the one case that hurts: a
   * record that EXISTS and lists nothing. Closing the last document writes
   * exactly that (`{"open":[],"activeId":"tool:blender-timeline.document"}`,
   * measured on a `model-editor create` scaffold, walk 5 beat 0), and from
   * then on every boot of that project restored nothing, opened no default,
   * and left the workspace with no document a person is in — which on the
   * model editor is the product's cover waiting out its whole 90 s budget and
   * then blaming Blender for a model nobody ever asked it to open. A closed
   * tab is not a standing instruction across page loads; "nothing to restore"
   * is one fact however the record spells it.
   */
  readonly hasDocumentsToRestore: boolean;
  readonly store: WorkspaceStateStore;
}

export interface WorkspaceDocumentRestorer {
  /** The `WorkspaceDocumentDescriptor.kind` this restores. Several modules
   *  may share one kind (a `world` is a three story here and a manifest root
   *  there); each registers its own restorer and the host tries them in
   *  registration order until one answers `true`. */
  readonly kind: string;
  /** Which module owns it. Re-registering the same owner+kind REPLACES, so a
   *  module re-evaluated by HMR leaves one restorer, not two. */
  readonly owner: string;
  /** Awaited once before this kind's documents restore, and only when the
   *  record holds at least one. Restorers that share a settling step share
   *  the FUNCTION (the host dedupes by identity), so one refresh runs once. */
  readonly prepare?: () => Promise<void>;
  /** Reopen one persisted document. `false` = it cannot truthfully reopen,
   *  and the stale entry is reconciled away. */
  readonly restore: (context: WorkspaceDocumentRestoreContext) => boolean | Promise<boolean>;
  /** This kind's own session state, persisted beside the open set under the
   *  kind key. Read on every write-through, so keep it cheap. */
  readonly persistKindState?: () => unknown;
  /** Called once per session for EVERY registered kind, before the persisted
   *  documents reopen — whether or not this kind has any. */
  readonly beginRestore?: (context: WorkspaceDocumentKindRestoreContext) => void;
}

const _restorers = new Map<string, WorkspaceDocumentRestorer[]>();

/** Install a kind's restorer. Returns the teardown. */
export function registerWorkspaceDocumentRestorer(restorer: WorkspaceDocumentRestorer): () => void {
  const existing = _restorers.get(restorer.kind) ?? [];
  const next = existing.filter((item) => item.owner !== restorer.owner);
  next.push(restorer);
  _restorers.set(restorer.kind, next);
  return () => {
    const current = _restorers.get(restorer.kind);
    if (!current) return;
    const remaining = current.filter((item) => item !== restorer);
    if (remaining.length === 0) _restorers.delete(restorer.kind);
    else _restorers.set(restorer.kind, remaining);
  };
}

/** Every restorer registered for `kind`, in registration order. */
export function workspaceDocumentRestorers(kind: string): readonly WorkspaceDocumentRestorer[] {
  return _restorers.get(kind) ?? [];
}

/** Every registered restorer, in kind registration order. */
export function workspaceDocumentRestorerEntries(): readonly WorkspaceDocumentRestorer[] {
  const all: WorkspaceDocumentRestorer[] = [];
  for (const list of _restorers.values()) all.push(...list);
  return all;
}

/** Test-only reset (mirrors the document registry's own). */
export function __resetWorkspaceDocumentRestorersForTest(): void {
  _restorers.clear();
}
