/**
 * Open/close the pinned canvas Scene document for a live canvas ingest.
 * The React body lives in `ingest-canvas-scene-document.tsx` so this
 * installer can be unit-tested without pulling Pixi/Three into jsdom.
 */

import type { EditorShellStore } from '@editor/editor-shell-store';
import { projectAdapterFacet } from '@editor/project-adapter';
import { isolationTabsReplaceGenericScene } from '@editor/scene-document-plan';
import { CANVAS_SCENE_DOCUMENT_ID } from '@editor/workspace-document-ids';
import {
  activateWorkspaceDocument,
  closeWorkspaceDocument,
  openWorkspaceDocument,
  type WorkspaceDocumentContentProps,
} from '@editor/workspace-document-registry';
import { registerRootDocumentRoute } from '@editor/world-document-routing';
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
