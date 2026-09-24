/**
 * THE one answer to "which profiler is the UI showing right now?".
 *
 * Subscribes to the three registries the answer depends on (workspace
 * documents, performance sources, the inspected instance) and resolves the
 * `workspace:game` → per-instance → per-document ladder. The header
 * telemetry and the Performance panel both render THIS — two copies of the
 * ladder is how the header and the panel silently disagree about which
 * document's profiler they show.
 */

import { useSyncExternalStore } from 'react';
import {
  inspectedInstanceId,
  inspectedInstanceVersion,
  subscribeInspectedInstance,
} from '@volter/editor-core/authoring/active-systems';
import {
  type EditorPerformanceSource,
  performanceSourceForDocument,
  performanceSourceForGameInstance,
  performanceSourcesVersion,
  subscribePerformanceSources,
} from '@volter/editor-core/performance-sources';
import {
  activeWorkspaceDocumentId,
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';

export function useActivePerformanceSource(): EditorPerformanceSource | null {
  useSyncExternalStore(
    subscribeWorkspaceDocuments,
    workspaceDocumentRegistryVersion,
    workspaceDocumentRegistryVersion,
  );
  useSyncExternalStore(
    subscribePerformanceSources,
    performanceSourcesVersion,
    performanceSourcesVersion,
  );
  useSyncExternalStore(
    subscribeInspectedInstance,
    inspectedInstanceVersion,
    inspectedInstanceVersion,
  );
  const documentId = activeWorkspaceDocumentId();
  return (
    (documentId === 'workspace:game'
      ? performanceSourceForGameInstance(inspectedInstanceId())
      : null) ?? performanceSourceForDocument(documentId)
  );
}
