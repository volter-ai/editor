import type { EditorView, PresentedEditorView } from '@volter/editor-sdk';

export interface EditorPresentationNotice {
  readonly presented: PresentedEditorView;
  readonly previousView: EditorView;
}

let notice: EditorPresentationNotice | null = null;
let version = 0;
const listeners = new Set<() => void>();

function publish(next: EditorPresentationNotice | null): void {
  if (notice === next) return;
  notice = next;
  version++;
  for (const listener of listeners) listener();
}

export function editorPresentationNotice(): EditorPresentationNotice | null {
  return notice;
}

export function showEditorPresentationNotice(next: EditorPresentationNotice): void {
  publish(next);
}

export function clearEditorPresentationNotice(): void {
  publish(null);
}

export function subscribeEditorPresentationNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function editorPresentationNoticeVersion(): number {
  return version;
}

export function __resetEditorPresentationNoticeForTest(): void {
  publish(null);
}
