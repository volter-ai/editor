/**
 * A DOCUMENT KIND OWNS HOW IT OPENS — the forward half of the seam whose
 * backward half is `workspace-document-restore.ts` (docs/WORKBENCH.md §host
 * versus package).
 *
 * THE RULE. The host ADDRESSES a document (a story on a module, an asset at a
 * path); it does not construct one. A module that can open a kind registers an
 * opener under a named id, and every host call site — the palette, the
 * hierarchy's double-click, the Edit tab row, the layout restore, the view
 * protocol, the SDK's `host.workspace` door — asks for that id instead of
 * importing the document module. When nothing has registered the id (a build
 * whose package list does not carry that kind, a contribution that has not
 * loaded yet) the answer is `null`, and the caller does what it already did
 * for a document it could not open.
 *
 * WHY IT EXISTS. `workspace-document-restore.ts` fixed the PERSISTENCE half:
 * the host no longer names a document module to reopen one. The opening half
 * was still `import { openThreeStoryDocument } from './components/…'` in ten
 * host files, which is the same serialization defect one rung earlier — a
 * document cannot leave for a package while the shell calls its constructor by
 * name. Measured 2026-09-18 (WORK.md §The open-source launch, phase 1 unit 4).
 *
 * WHAT AN ID IS. A string in the host's own vocabulary, declared beside the
 * kind's other host-side contracts (`stories/story-document-openers.ts` is the
 * first), with a request type declared in the SAME place so both sides of the
 * seam are typed against one declaration rather than against each other.
 * Several modules may register one id; they are tried in registration order
 * until one returns a document id.
 */

import type { WorkspaceStateStore } from './workspace-document-restore';

export interface DocumentOpener<Request> {
  /** The opener id — the address vocabulary, not a module name. */
  readonly id: string;
  /** Which module registered it. Re-registering the same owner+id REPLACES,
   *  so an HMR re-evaluation leaves one opener, not two. */
  readonly owner: string;
  /**
   * Open (or activate) the document this request addresses, and answer its
   * document id. `null` = this opener cannot serve THIS request (an
   * undeclared medium, a story that is no longer exported); the next
   * registered opener is tried.
   *
   * THROWING is the third answer, and it is different from `null`: "this
   * address is MINE and it is broken" — a table that lists no such entry, a
   * contribution whose module threw on import. The throw reaches the caller
   * with the kind's own sentence instead of the host's generic "nothing can
   * open this", which is the only way a reader learns which of the two
   * happened. Only an opener that OWNS the id may throw; one of several
   * openers sharing an id answers `null` so its siblings still get their turn.
   */
  readonly open: (store: WorkspaceStateStore, request: Request) => string | null;
  /**
   * The kind's own async settling step, awaited by
   * {@link openRegisteredDocumentAsync} ONLY after a first synchronous attempt
   * answered `null` — refresh the ledger this kind opens documents out of, then
   * the attempt is made once more.
   *
   * It mirrors `WorkspaceDocumentRestorer.prepare` deliberately: a kind is the
   * only thing that knows what "I might be able to open this once I have looked
   * again" means, and the host must not hold that knowledge to address a
   * document. Absent means one attempt is the whole answer.
   *
   * IT RECEIVES THE REQUEST, because settling is per-address: waiting for THIS
   * table entry, loading THIS module, refreshing the contribution that would
   * carry THIS id. `stories/story-opener.ts:92` is the evidence —
   * it keeps two module-level `unsettled*` sets whose only job is to carry the
   * failed request across to a settle that could not see it. (Existing openers
   * that ignore the argument are unaffected; the dedupe below is by function
   * identity, so one settle still runs once per attempt.) Like `open`, it may
   * THROW to refuse the address with the kind's own sentence.
   */
  readonly settle?: (request: Request) => Promise<void>;
  /**
   * The kind's own POST-open readiness — `settle`'s mirror on the other side of
   * the answer, awaited by {@link openRegisteredDocumentAsync} once an opener
   * has produced a document id, before the caller is told the view is present.
   *
   * It exists because "opened" and "ready to be driven" are different instants
   * for some kinds and the host cannot know which: an asset document answers
   * its id the moment the tab is registered, while an immediate
   * inspect/setField against it needs the Inspector mounted and (for a model)
   * its live adapter installed — `waitForAssetDocumentInspector`, which the
   * presenter used to await by hand because it knew the asset family's rule.
   * Absent means the id IS the whole answer. May THROW to refuse.
   *
   * A synchronous caller ({@link openRegisteredDocument}) cannot await it, the
   * same way it cannot settle — it gets the id and the kind's own doors are
   * what it waits on.
   */
  readonly ready?: (documentId: string, request: Request) => Promise<void>;
}

// The registry is heterogeneous by construction — one id, one request type,
// checked at both ends by the shared declaration the id comes from.
// biome-ignore lint/suspicious/noExplicitAny: the map is keyed by id, not by type.
const _openers = new Map<string, DocumentOpener<any>[]>();

/** Install an opener. Returns the teardown. */
export function registerDocumentOpener<Request>(opener: DocumentOpener<Request>): () => void {
  const existing = _openers.get(opener.id) ?? [];
  const next = existing.filter((item) => item.owner !== opener.owner);
  next.push(opener);
  _openers.set(opener.id, next);
  return () => {
    const current = _openers.get(opener.id);
    if (!current) return;
    const remaining = current.filter((item) => item !== opener);
    if (remaining.length === 0) _openers.delete(opener.id);
    else _openers.set(opener.id, remaining);
  };
}

/** Whether anything can open this id in THIS session — what a palette asks
 *  before offering an action that would otherwise do nothing. */
export function hasDocumentOpener(id: string): boolean {
  return (_openers.get(id)?.length ?? 0) > 0;
}

/**
 * Every address this session can open, sorted. The generic answer to "what
 * DOES this editor open?", which is what a refusal owes its reader: a build
 * whose package list carries no opener for the kind is a configuration fact,
 * and naming the addresses that ARE registered is the difference between
 * "this is broken" and "this editor is not that editor".
 */
export function registeredDocumentOpenerIds(): readonly string[] {
  return [..._openers.keys()].sort();
}

/**
 * Open the document this request addresses, through whichever registered
 * opener claims it. `null` = nothing here can open it, which is the same
 * answer the host already gives for a story with no declared medium.
 */
export function openRegisteredDocument<Request>(
  id: string,
  store: WorkspaceStateStore,
  request: Request,
): string | null {
  for (const opener of _openers.get(id) ?? []) {
    const opened = opener.open(store, request);
    if (opened !== null) return opened;
  }
  return null;
}

/**
 * The same question, asked where the caller can wait: try the registered
 * openers once; if none claimed the request, let each kind SETTLE (refresh the
 * ledger it opens out of) and try once more. Used by the VIEW PROTOCOL, which
 * is already async and is the one caller that addresses a document by a name a
 * person or an agent typed — the subject may simply not have been fetched yet.
 */
export async function openRegisteredDocumentAsync<Request>(
  id: string,
  store: WorkspaceStateStore,
  request: Request,
): Promise<string | null> {
  const openers = _openers.get(id) ?? [];
  const direct = claim(openers, store, request);
  if (direct) return settleReady(direct, request);
  if (openers.length === 0) return null;
  const settled = new Set<(request: Request) => Promise<void>>();
  for (const opener of openers) if (opener.settle) settled.add(opener.settle);
  for (const settle of settled) await settle(request);
  if (settled.size === 0) return null;
  const retried = claim(openers, store, request);
  return retried === null ? null : settleReady(retried, request);
}

/** The first opener that answers a document id, and WHICH one — the async door
 *  needs the identity because `ready` belongs to the opener that claimed, not
 *  to every opener sharing the address. */
function claim<Request>(
  // biome-ignore lint/suspicious/noExplicitAny: the map is keyed by id, not by type.
  openers: readonly DocumentOpener<any>[],
  store: WorkspaceStateStore,
  request: Request,
): { opener: DocumentOpener<Request>; documentId: string } | null {
  for (const opener of openers) {
    const documentId = opener.open(store, request);
    if (documentId !== null) return { opener, documentId };
  }
  return null;
}

async function settleReady<Request>(
  claimed: { opener: DocumentOpener<Request>; documentId: string },
  request: Request,
): Promise<string> {
  await claimed.opener.ready?.(claimed.documentId, request);
  return claimed.documentId;
}

/** Test-only reset (mirrors the restore registry's own). */
export function __resetDocumentOpenersForTest(): void {
  _openers.clear();
}
