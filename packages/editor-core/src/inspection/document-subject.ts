/**
 * An open asset document's own SUBJECT, published for the one composer.
 *
 * ## What an asset document is, in the model
 *
 * "What is an asset in three.js but a hierarchical group of other three.js
 * assets" (owner, 2026-08-07). An asset document is the three paradigm scoped
 * to a SUBTREE — Unity's prefab-isolation mode: the same viewport, the same
 * hierarchy, the same inspector box, with only the root changed. So it gets
 * the ordinary inspector over it, in the ordinary place, and clicking a part
 * inside it composes that part's subject exactly as clicking a node in the
 * scene composes that node's.
 *
 * What is left for a document to say is what IT is when you have not pointed
 * at one of its parts: its name, what kind of document it is, its provenance,
 * and its own identified sections. It describes that as a SUBJECT and
 * publishes it here; `authoring/null-inspection-subjects.tsx` hands it to the
 * ONE composer as the `asset-lab` surface's `describeSubject(null)` answer, so
 * a document's identity floor and a scene's empty state travel the same road.
 *
 * The shape this replaces published loose `InspectionSection[]` and let the
 * document render them directly — sections reaching a renderer without ever
 * being a subject's sections, which is exactly the side channel the model
 * exists to remove.
 *
 * ## A latest-value holder that says when it changed
 *
 * The value is still written by the document that is RENDERING and read on
 * demand — there is no state here the publisher does not already hold. What it
 * also does is notify, because a publisher whose subject changes WITHOUT the
 * inspector re-rendering for some other reason is otherwise invisible: the 2D
 * components board publishes the picked frame's identity, nothing else about
 * that pick reaches the inspector, and a human clicked frame after frame
 * against an empty panel (runhuman pass 92). `use-active-inspection.ts`
 * subscribes, per its own rule that everything the resolution reads is
 * subscribed there once.
 *
 * The token discipline mirrors `activateAssetEditorContext`: a disposer only
 * clears the exact publication it created, so an older document's unmount
 * cannot erase a newer one's subject.
 */

import type { NullInspectionSubject } from './null-subject';

/** What a document says it IS — the same shape any surface's
 *  `describeSubject(null)` answer takes, so the composer needs no special
 *  case for an asset document. */
export type DocumentInspectionSubject = NullInspectionSubject;

interface Published {
  readonly documentId: string;
  /** Read at consumption time so a mounted document can keep its section
   * closures current without publishing again merely because React rendered
   * it again. */
  readonly readSubject: () => DocumentInspectionSubject;
  readonly token: symbol;
}

let published: Published | null = null;
let version = 0;
const listeners = new Set<() => void>();

function notifyChanged(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeDocumentInspectionSubject(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function documentInspectionSubjectVersion(): number {
  return version;
}

/** Publish the subject the open document describes. Returns a disposer that
 *  clears exactly this publication. */
export function publishDocumentInspectionSubject(
  documentId: string,
  readSubject: () => DocumentInspectionSubject,
): () => void {
  const token = Symbol(documentId);
  published = { documentId, readSubject, token };
  notifyChanged();
  return () => {
    if (published?.token !== token) return;
    published = null;
    notifyChanged();
  };
}

/** The subject the open document describes, or `null` when no document is
 *  publishing one. */
export function documentInspectionSubject(): {
  readonly documentId: string;
  readonly subject: DocumentInspectionSubject;
} | null {
  return published === null
    ? null
    : { documentId: published.documentId, subject: published.readSubject() };
}

export function __resetDocumentInspectionSubjectForTest(): void {
  published = null;
  notifyChanged();
}
