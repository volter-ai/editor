/**
 * Which open documents run a stage session of their own, and what that session has selected —
 * the part of a media integration's document session the kit's stage context reads. The Three
 * integration registers each Object3D document session here as it registers it for itself; the
 * kit names no viewport.
 */
export interface DocumentStageSession {
  readonly documentId: string;
  /** The session's own selection, read straight off its authoring adapter. */
  selection(): readonly string[];
}

const sessions = new Map<string, DocumentStageSession>();

/** Register a document's stage session. Returns the teardown. */
export function registerDocumentStageSession(session: DocumentStageSession): () => void {
  sessions.set(session.documentId, session);
  return () => {
    if (sessions.get(session.documentId) === session) sessions.delete(session.documentId);
  };
}

/** The document's stage session, or null when it runs none (a table, a report, the world). */
export function documentStageSession(documentId: string): DocumentStageSession | null {
  return sessions.get(documentId) ?? null;
}
