/**
 * Workspace history bridge (W3) — the session `HistoryService` handed to
 * workspace-document content modules (`build-documents.tsx`) WITHOUT them
 * importing `EditorContext`.
 *
 * Why not `useOptionalHistoryService()`: `EditorContext`'s import graph
 * pulls the whole editor boot (initial-scene → engine renderer stack), which
 * document-content modules must not drag into their own graph, and the
 * headless jsdom tests that mount document content rely on the light graph.
 * `DefaultEditorLayout` (which already lives on the heavy side) sets the
 * live service here; content reads it at commit time. Null (e.g. in tests,
 * or before the layout mounts) degrades to the raw POST/save write paths —
 * the same degrade the old prop-less mounts had.
 */

import type { HistoryService } from '../history/history-service';

let _history: HistoryService | null = null;

/** Set (or clear) the live session history service. Returns a cleanup that
 *  clears it only if it is still this service. */
export function setWorkspaceHistoryService(history: HistoryService | null): () => void {
  _history = history;
  return () => {
    if (_history === history) _history = null;
  };
}

/** The live session history service, or `null`. */
export function workspaceHistoryService(): HistoryService | null {
  return _history;
}
