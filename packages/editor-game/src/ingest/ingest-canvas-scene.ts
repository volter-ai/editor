/**
 * Open/close the pinned canvas Scene document for a live canvas ingest.
 * The React body lives in `ingest-canvas-scene-document.tsx` so this
 * installer can be unit-tested without pulling Pixi/Three into jsdom.
 */

import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { projectAdapterFacet } from '@volter/editor-core/project-adapter';
import { isolationTabsReplaceGenericScene } from '@volter/editor-core/scene-document-plan';
import { CANVAS_SCENE_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activateWorkspaceDocument,
  closeWorkspaceDocument,
  openWorkspaceDocument,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-core/workspace-document-registry';
import { registerRootDocumentRoute } from '@volter/editor-core/world-document-routing';
import type { ReactNode } from 'react';
import { activeIngest } from './active-ingest';

export function installIngestCanvasSceneDocument(
  store: EditorShellStore,
  Content: (props: WorkspaceDocumentContentProps) => ReactNode,
): () => void {
  const live = activeIngest();
  if (live?.kind !== 'canvas' || !live.session.adapter) return () => {};
  const table = projectAdapterFacet()?.scenes;
  // Isolation tabs ARE Edit. The live host is Play's Game document.
  if (table && isolationTabsReplaceGenericScene(table)) return () => {};
  const worldId = live.worldId;

  openWorkspaceDocument({
    id: CANVAS_SCENE_DOCUMENT_ID,
    title: 'Scene',
    kind: 'world',
    workspaceRole: 'authored-subject',
    provenance: { rootId: worldId },
    Content,
    closeable: false,
    presentation: () => ({ kind: 'world', id: worldId }),
    onActivate: () => store.setActiveViewportTab('edit'),
  });
  activateWorkspaceDocument(CANVAS_SCENE_DOCUMENT_ID);
  const unregisterRoute = registerRootDocumentRoute(worldId, CANVAS_SCENE_DOCUMENT_ID);

  return () => {
    unregisterRoute();
    closeWorkspaceDocument(CANVAS_SCENE_DOCUMENT_ID, { discardDirty: true });
  };
}
