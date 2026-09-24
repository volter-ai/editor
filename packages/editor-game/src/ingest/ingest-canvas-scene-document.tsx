/**
 * THE Scene tab for a canvas ingest.
 *
 * First-party canvas worlds get `workspace:canvas-scene` from
 * `installRootDocuments`, which reads design-time layer candidates. An
 * `{ ingest }` root is excluded from that list on purpose — remounting the
 * game as a first-party `@pixi/react` world is a category error. The result
 * was a workspace with only `workspace:game`: the live tree existed, and
 * nothing presented it as a Scene.
 *
 * This module is the ingest half of that document. It opens the same pinned
 * Scene id, shows the already-mounted game through the Scene chrome (editor
 * camera backdrop + selection), and reparents the realm host into the Scene
 * pane while that tab is in front. Game keeps the host the rest of the time.
 */

import {
  getMountFailureReports,
  subscribeToMountFailures,
} from '@volter/editor-sdk/kit/mount-failure-report';
import { installCanvasSceneNavigation } from '@volter/editor-core/authoring/react-canvas-navigation';
import { createRootViewController } from '@volter/editor-sdk/kit/world-pan-state';
import {
  CANVAS_SCENE_BACKGROUND,
  CanvasSceneBackdrop,
  CanvasSceneControls,
} from '@volter/editor-core/components/CanvasSceneViewport';
import { RootSelectionOverlay } from '@volter/editor-core/components/RootSelectionOverlay';
import { SurfaceStateOverlay } from '@volter/editor-core/components/SurfaceStateOverlay';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { liveDocumentContainer } from '@volter/editor-sdk/kit/live-document';
import { projectAdapterFacet } from '@volter/editor-core/project-adapter';
import { readinessFacet, subscribeRootReadiness } from '@volter/editor-sdk/kit/readiness';
import { explainSurface } from '@volter/editor-sdk/kit/surface-state';
import {
  registerWorkspaceDocumentSelection,
  type WorkspaceDocumentContentProps,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { activeIngest } from './active-ingest';
import { activeContractScenes } from './active-scene-navigation';
import { installIngestCanvasSceneDocument } from './ingest-canvas-scene';

/** The boot screen's contract id: the live `list()` entry whose label is the
 *  table default's own class name (`TitleScreen` → `title`). */
function defaultContractSceneId(): string | undefined {
  const table = projectAdapterFacet()?.scenes;
  if (!table?.default) return undefined;
  const def = table.entries.find((entry) => entry.id === table.default);
  const name = def?.source?.export ?? def?.id;
  if (!name) return undefined;
  const listed = activeContractScenes()?.storiesFor('') ?? [];
  return listed.find((scene) => scene.label === name || scene.id === name)?.id;
}

export function IngestCanvasSceneContent({
  active,
  adapter,
  documentId,
  store,
  worldId,
  contractSceneId,
}: WorkspaceDocumentContentProps & {
  adapter: AuthoringAdapter;
  store: EditorShellStore;
  worldId: string;
  /** When set, activating this tab navigates the held ingest to that screen. */
  contractSceneId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(createRootViewController());
  const view = viewRef.current;
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const rootReadiness = useSyncExternalStore(subscribeRootReadiness, readinessFacet);
  const mountFailures = useSyncExternalStore(subscribeToMountFailures, getMountFailureReports);
  const live = activeIngest();
  const roots = adapter.hierarchy.roots();
  const emptyRootIds = new Set(adapter.rects?.emptyContainers?.().map((entry) => entry.id) ?? []);
  const hasRenderableContent = roots.some((root) => !emptyRootIds.has(root.id));
  const surfaceExplanation = explainSurface({
    surface: 'Ingest scene',
    rootIds: [worldId],
    phase:
      live?.kind === 'canvas' && live.worldId === worldId && live.session.hostEl
        ? 'ready'
        : 'loading',
    content:
      live?.kind !== 'canvas' || live.worldId !== worldId || !live.session.hostEl
        ? 'unknown'
        : hasRenderableContent
          ? 'present'
          : 'empty',
    readiness: rootReadiness,
    failures: mountFailures,
  });

  useEffect(() => {
    return registerWorkspaceDocumentSelection(documentId, () => ({
      adapter,
      nodeId: [...store.selectedEntityIds].find((id) => adapter.hierarchy.node(id)) ?? null,
    }));
  }, [adapter, documentId, store]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return installCanvasSceneNavigation(container, view);
  }, [view]);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const live = activeIngest();
    const hostEl = live?.kind === 'canvas' ? live.session.hostEl : undefined;
    if (!container || !hostEl) return;
    container.appendChild(hostEl);
    return () => {
      const gameContainer = liveDocumentContainer();
      if (gameContainer && hostEl.parentElement === container) {
        gameContainer.appendChild(hostEl);
      }
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const sceneId = contractSceneId ?? defaultContractSceneId();
    if (!sceneId) return;
    const scenes = activeContractScenes();
    if (!scenes) return;
    void scenes.goToScene(sceneId);
  }, [active, contractSceneId]);

  return (
    <div
      ref={containerRef}
      data-testid="world-document:ingest-canvas-scene"
      data-vgai-backdrop-color={active ? CANVAS_SCENE_BACKGROUND : undefined}
      data-vgai-backdrop-policy={active ? 'dark-frost' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'auto',
        backgroundColor: CANVAS_SCENE_BACKGROUND,
        touchAction: 'none',
      }}
    >
      <CanvasSceneBackdrop view={view} />
      <RootSelectionOverlay adapter={adapter} view={view} transformModeAware />
      <SurfaceStateOverlay
        explanation={surfaceExplanation}
        testId="ingest-canvas-surface-status"
        style={{ zIndex: 20 }}
      />
      <CanvasSceneControls
        active={active}
        adapter={adapter}
        containerRef={containerRef}
        view={view}
      />
    </div>
  );
}

/** Open the pinned Scene tab over the live canvas ingest, or no-op. */
export function installIngestCanvasScene(store: EditorShellStore): () => void {
  const live = activeIngest();
  if (live?.kind !== 'canvas' || !live.session.adapter) return () => {};
  const adapter = live.session.adapter;
  const worldId = live.worldId;
  const Content = (props: WorkspaceDocumentContentProps) => (
    <IngestCanvasSceneContent {...props} adapter={adapter} store={store} worldId={worldId} />
  );
  return installIngestCanvasSceneDocument(store, Content);
}
