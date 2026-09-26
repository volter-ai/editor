/** Discoverable documents are independent of open tabs. Closing a tab keeps its
 * project-owned descriptor available to Content and to session restoration. */

import {
  closeWorkspaceDocument,
  openWorkspaceDocument,
  WORKSPACE_DOCUMENT_KINDS,
  type WorkspaceDocumentDescriptor,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { registerWorkspaceDocumentRestorer } from '@volter/editor-sdk/kit/workspace-document-restore';

export interface AvailableWorkspaceDocument {
  readonly descriptor: WorkspaceDocumentDescriptor;
  readonly category: string;
  /** Set only when this is the root's own document, never an isolated scene. */
  readonly rootId?: string | undefined;
  readonly default: boolean;
}
let documents: readonly AvailableWorkspaceDocument[] = [];
const listeners = new Set<() => void>();
const pending = new Map<string, boolean>();
let sessionStarted = false;
let hasDocumentsRestoring = false;
let defaultOpened = false;
export function requestAvailableWorkspaceDocument(id: string, active = true): void {
  pending.set(id, active);
  restoreAvailableDocuments();
}
const notify = () => {
  for (const listener of listeners) listener();
};
export const availableWorkspaceDocuments = () => documents;
export function subscribeAvailableWorkspaceDocuments(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openAvailableWorkspaceDocument(id: string, activate = true): boolean {
  const entry = documents.find((item) => item.descriptor.id === id);
  if (!entry) return false;
  openWorkspaceDocument(
    { ...entry.descriptor, closeable: true, persist: () => ({ availableDocumentId: id }) },
    { activate },
  );
  return true;
}

function restoreAvailableDocuments(): void {
  for (const [id, active] of pending) {
    if (openAvailableWorkspaceDocument(id, active)) pending.delete(id);
  }
  if (sessionStarted && !hasDocumentsRestoring && !defaultOpened) {
    const entry = documents.find((item) => item.default);
    if (entry) {
      defaultOpened = true;
      openAvailableWorkspaceDocument(entry.descriptor.id);
    }
  }
}

export function registerAvailableWorkspaceDocument(
  descriptor: WorkspaceDocumentDescriptor,
  options: { category: string; default?: boolean; rootId?: string | undefined },
): string {
  const previous = documents.find((item) => item.descriptor.id === descriptor.id);
  if (
    previous?.descriptor.Content === descriptor.Content &&
    previous?.descriptor.title === descriptor.title &&
    previous.descriptor.provenance?.sourcePath === descriptor.provenance?.sourcePath &&
    previous.descriptor.provenance?.rootId === descriptor.provenance?.rootId &&
    previous.descriptor.Toolbar === descriptor.Toolbar &&
    previous.descriptor.Shelf === descriptor.Shelf &&
    previous.descriptor.preview === descriptor.preview &&
    previous.default === (options.default ?? false) &&
    previous.category === options.category &&
    previous.rootId === options.rootId
  )
    return descriptor.id;
  const entry = {
    descriptor,
    category: options.category,
    default: options.default ?? false,
    rootId: options.rootId,
  };
  documents = previous
    ? documents.map((item) => (item.descriptor.id === descriptor.id ? entry : item))
    : [...documents, entry];
  notify();
  restoreAvailableDocuments();
  return descriptor.id;
}

export function unregisterAvailableWorkspaceDocument(id: string): void {
  if (!documents.some((item) => item.descriptor.id === id)) return;
  documents = documents.filter((item) => item.descriptor.id !== id);
  closeWorkspaceDocument(id, { discardDirty: true });
  notify();
}

for (const kind of WORKSPACE_DOCUMENT_KINDS) {
  registerWorkspaceDocumentRestorer({
    kind,
    owner: 'workspace-available-documents',
    restore: ({ state, active }) => {
      const id = (state as { availableDocumentId?: unknown } | null)?.availableDocumentId;
      if (typeof id !== 'string') return false;
      pending.set(id, active);
      restoreAvailableDocuments();
      return true;
    },
    beginRestore: ({ hasDocumentsToRestore }) => {
      sessionStarted = true;
      hasDocumentsRestoring = hasDocumentsToRestore;
      restoreAvailableDocuments();
    },
  });
}
export function resetAvailableWorkspaceDocuments(): void {
  documents = [];
  pending.clear();
  sessionStarted = false;
  hasDocumentsRestoring = false;
  defaultOpened = false;
  notify();
}
