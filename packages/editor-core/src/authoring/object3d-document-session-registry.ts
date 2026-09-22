/**
 * Lightweight registry for live Object3D document sessions.
 *
 * State/control readers only need to find a session that some document has
 * already constructed. Keeping this map beside the implementation made every
 * reader load the implementation's postprocessing, skeleton, outline and
 * diagnostic-rendering graph during a plain Scene boot. The class remains the
 * native session type; this module owns only its live identities.
 */
import type { Object3DDocumentSession } from './object3d-document-session';

const sessions = new Map<string, Object3DDocumentSession>();
const announcedStages = new Map<string, number>();
const preparations = new Map<string, () => Promise<void>>();
let registryVersion = 0;
const registryListeners = new Set<() => void>();

function notifyRegistry(): void {
  registryVersion++;
  for (const listener of registryListeners) listener();
}

export function registerObject3DDocumentSession(session: Object3DDocumentSession): () => void {
  sessions.set(session.documentId, session);
  notifyRegistry();
  return () => {
    if (sessions.get(session.documentId) !== session) return;
    sessions.delete(session.documentId);
    notifyRegistry();
  };
}

export function object3DDocumentSession(documentId: string): Object3DDocumentSession | null {
  return sessions.get(documentId) ?? null;
}

/** Async source-backed documents refresh their graph before a requested view
 * is presented. The callback owns its build and failure semantics. */
export function registerObject3DDocumentPreparation(
  documentId: string,
  prepare: () => Promise<void>,
): () => void {
  preparations.set(documentId, prepare);
  return () => {
    if (preparations.get(documentId) === prepare) preparations.delete(documentId);
  };
}

export async function prepareObject3DDocument(documentId: string): Promise<void> {
  await preparations.get(documentId)?.();
}

/**
 * A DOCUMENT'S STAGE ANNOUNCES ITSELF AS IT RENDERS, before the session it
 * will register exists — the fact an opener's `ready` needs and cannot get
 * from anywhere else.
 *
 * MEASURED 2026-09-19 (phase 1 unit 16): whether a document mounts an Object3D
 * session is a fact of its MOUNT, never of its address. Three `bird`/`humanoid`/
 * `walking-castle` Builder documents open through the `tool` address and mount
 * one (`catalog/project-source/src/contributions/builder-document.tsx:66`)
 * while `data`, `asset-budget` and nine other `workspace.document`
 * contributions at the same address do not; a `source` asset mounts one only
 * when its module is a model builder (`asset-viewers/SourceAssetViewer.tsx:256`)
 * and a `json` asset only when its content is a three.quarks system
 * (`asset-viewers/JsonAssetDocument.tsx:64`). A host that waited by ADDRESS
 * would hang the whole `DOCUMENT_REGISTRATION_TIMEOUT_MS` on every flat
 * document at that address and then refuse a document that was never wrong —
 * which is why the readiness rule the presenter held could not simply be
 * copied kind-side. The announcement is made by the ONE host component every
 * chromed stage goes through, so no lane is recognised by name.
 *
 * Announcing is idempotent and counted: several mounts for one document id
 * (a revision swap keyed on `viewerKey`) overlap, and the last release is the
 * one that clears it.
 */
export function announceObject3DDocumentStage(documentId: string): () => void {
  announcedStages.set(documentId, (announcedStages.get(documentId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const open = (announcedStages.get(documentId) ?? 0) - 1;
    if (open > 0) announcedStages.set(documentId, open);
    else announcedStages.delete(documentId);
  };
}

/** Whether a stage for this document has begun mounting. The WAIT that reads
 *  it is `document-context-registry.ts`'s, deliberately not here: this module
 *  sits on `StageHost.tsx`'s own pinned closure, and a poll helper's import
 *  edge grew that pin by one (measured). */
export function object3DDocumentStageAnnounced(documentId: string): boolean {
  return (announcedStages.get(documentId) ?? 0) > 0;
}

/** Every live CHROMED document session — the ones that own a toolbar, an
 *  inspector context and a performance source. This is a presentation registry,
 *  not the Edit-static one: whether a surface's CONTENT time is held is asked of
 *  `coverage/design-time-surfaces.ts`, which every mount publishes into
 *  (chromeless preview cards included). */
export function allObject3DDocumentSessions(): readonly Object3DDocumentSession[] {
  return [...sessions.values()];
}

export function subscribeObject3DDocumentSessions(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => registryListeners.delete(listener);
}

export function object3DDocumentSessionsVersion(): number {
  return registryVersion;
}

export function __resetObject3DDocumentSessionsForTest(): void {
  sessions.clear();
  preparations.clear();
  announcedStages.clear();
  notifyRegistry();
}
