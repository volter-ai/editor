import { useSyncExternalStore } from 'react';
import { documentContextVersion, documentLoadFor, subscribeDocumentContexts } from '../document-context-registry';
import { activeWorkspaceDocumentId, subscribeWorkspaceDocuments, workspaceDocumentRegistryVersion } from '../workspace-document-registry';
import './document-loading-status.css';

/** Indeterminate work belongs to the status band; the document and Inspector
 * stay quiet until they have real content. No fabricated fraction or ETA. */
export function DocumentLoadingStatus() {
  useSyncExternalStore(subscribeWorkspaceDocuments, workspaceDocumentRegistryVersion, workspaceDocumentRegistryVersion);
  useSyncExternalStore(subscribeDocumentContexts, documentContextVersion, documentContextVersion);
  const load = documentLoadFor(activeWorkspaceDocumentId());
  if (!load || load.failed) return null;
  const label = `Opening ${load.label}…`;
  return (
    <span className="volter-document-loading-status" data-testid="status-document-loading" role="status" aria-live="polite" title={label}>
      <progress className="volter-document-loading-progress" aria-label={label} />
      <span className="volter-document-loading-label">{label}</span>
    </span>
  );
}
