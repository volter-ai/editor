import {
  availableWorkspaceDocuments,
  openAvailableWorkspaceDocument,
} from '@volter/editor-sdk/kit/workspace-available-documents';
import { activateWorkspaceDocument } from '@volter/editor-sdk/kit/workspace-document-registry';

const _documentIdByRoot = new Map<string, string>();

export function registerRootDocumentRoute(worldId: string, documentId: string): () => void {
  _documentIdByRoot.set(worldId, documentId);
  return () => {
    if (_documentIdByRoot.get(worldId) === documentId) _documentIdByRoot.delete(worldId);
  };
}

/** The edit-time document that owns a manifest world, or `null` when the
 *  session installed none. Read by the Edit tab row, whose `root-mount` scene
 *  entries NAME a standing document rather than adding one
 *  (`components/scene-documents.tsx`). */
export function rootDocumentId(worldId: string): string | null {
  return (
    _documentIdByRoot.get(worldId) ??
    availableWorkspaceDocuments().find((document) => document.rootId === worldId)?.descriptor.id ??
    null
  );
}

/** Activate the edit-time document that owns a manifest world. */
export function activateRootDocument(worldId: string): boolean {
  const documentId = rootDocumentId(worldId);
  return documentId
    ? openAvailableWorkspaceDocument(documentId) || activateWorkspaceDocument(documentId)
    : false;
}

const _gapByRoot = new Map<string, () => string | null>();

/**
 * Register the reason a root has NO document to activate — the DECIDED half of
 * {@link activateRootDocument}'s `false`.
 *
 * A root's document is installed asynchronously, so `false` from
 * `activateRootDocument` means one of two opposite things: "not yet" (boot in
 * flight) or "never" (this session has settled that this root has no design
 * surface of its own). Callers cannot tell them apart, so every caller waits
 * out the full registration window even for an answer that was decided in the
 * first second — long enough that the asking side has usually given up before
 * the refusal is spoken.
 *
 * The `reason` is a THUNK, evaluated live at each ask, precisely so it can keep
 * answering `null` while the document may still arrive and only speak once the
 * question is settled. It is registered by whoever OWNS the decision — the
 * presenter must never infer why a document is absent.
 */
export function registerRootDocumentGap(worldId: string, reason: () => string | null): () => void {
  _gapByRoot.set(worldId, reason);
  return () => {
    if (_gapByRoot.get(worldId) === reason) _gapByRoot.delete(worldId);
  };
}

/** Why this root has no document to activate, when that is decided; `null`
 *  while one may still arrive. */
export function rootDocumentGap(worldId: string): string | null {
  return _gapByRoot.get(worldId)?.() ?? null;
}

const _workspaceGaps = new Set<(documentId: string) => string | null>();

/**
 * The same DECIDED half, for a workspace document asked for by id.
 *
 * `activateWorkspaceDocument` returns `false` with the identical ambiguity
 * {@link registerRootDocumentGap} describes — "not yet" and "never" are one
 * answer — and a workspace document has the further case a root cannot have:
 * the id may name nothing at all. Both are the same question ("why is this
 * document not here?"), so they share this mechanism rather than growing a
 * second one; the arms differ only in their KEY, because a root is asked for
 * by manifest id and a workspace document by document id.
 *
 * The resolver takes the requested id rather than being registered per id,
 * because the ids that will never exist cannot be enumerated in advance — the
 * owner answers for the whole namespace it installs into. Same thunk contract:
 * `null` means "no verdict" (boot in flight, or not this owner's question),
 * and the first owner to speak wins.
 */
export function registerWorkspaceDocumentGap(
  reason: (documentId: string) => string | null,
): () => void {
  _workspaceGaps.add(reason);
  return () => {
    _workspaceGaps.delete(reason);
  };
}

/** Why this workspace document is not here, when that is decided; `null` while
 *  one may still arrive. */
export function workspaceDocumentGap(documentId: string): string | null {
  for (const reason of _workspaceGaps) {
    const answer = reason(documentId);
    if (answer !== null) return answer;
  }
  return null;
}
