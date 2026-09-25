/**
 * THE GAME'S WORLD-ROOT BINDING for the kit's stage host
 * (`@volter/editor-core/components/world-root-binding`): the world's surface,
 * its stage, and the overlays the stage shows only over a world.
 *
 * `Overlays` is the world-root half of vgai's `stage-overlay-set.tsx` — every
 * part it rendered only when `worldRoot` held (the root selection layer, the
 * camera-authoring pin, the scene's
 * surface-state card). The rest of that overlay set is the kit's
 * `StageOverlays`, which the host renders beside this.
 */
import { EDITOR_LAYER } from '@volter/editor-threejs/viewport/editor-layers';
import { activeAuthoringVersion, subscribeActiveAuthoring } from '@volter/editor-core/authoring/active-adapter';
import {
  getMountFailureReports,
  subscribeToMountFailures,
} from '@volter/editor-sdk/kit/mount-failure-report';
import {
  object3DDocumentSessionsVersion,
  subscribeObject3DDocumentSessions,
} from '@volter/editor-core/authoring/object3d-document-session-registry';
import { RootSelectionOverlay } from '@volter/editor-core/components/RootSelectionOverlay';
import { SurfaceStateOverlay } from '@volter/editor-core/components/SurfaceStateOverlay';
import type {
  WorldRootOverlayProps,
  WorldRootStageBinding,
} from '@volter/editor-core/components/world-root-binding';
import type { EditorShellStore } from '@volter/editor-core/editor-shell-store';
import { readinessFacet, subscribeRootReadiness } from '@volter/editor-sdk/kit/readiness';
import { documentStageContext } from '@volter/editor-core/stage-context';
import { explainSurface } from '@volter/editor-sdk/kit/surface-state';
import {
  subscribeWorkspaceDocuments,
  workspaceDocumentRegistryVersion,
} from '@volter/editor-sdk/kit/workspace-document-registry';
import { useMemo, useSyncExternalStore } from 'react';
import type * as THREE from 'three';
import { threeSceneHasRenderableContent } from '../surface-content';
import { CameraAuthoringOverlay } from './CameraAuthoringOverlay';
import { installWorldRootStage, mountWorldRootSurface } from './world-root-stage';

/**
 * The scene-status overlay is the sole viewport child whose truth can change
 * from object-map membership alone (an empty live scene may gain its first
 * renderable object). Keep that exact broad subscription here so runtime
 * structure does not rerender the canvas, chrome, or collaboration surface.
 */
function SceneViewportStateOverlay({
  store,
  rootIds,
  mountStatus,
}: {
  store: EditorShellStore;
  rootIds: readonly string[];
  mountStatus: 'mounting' | 'ready';
}) {
  useSyncExternalStore(store.shell.subscribe, store.shell.getSnapshot);
  const rootReadiness = useSyncExternalStore(subscribeRootReadiness, readinessFacet);
  const mountFailures = useSyncExternalStore(subscribeToMountFailures, getMountFailureReports);
  const sceneBackground = store.scene?.background as THREE.Color | null | undefined;
  const sceneBackgroundIsAuthored =
    sceneBackground !== null &&
    !(sceneBackground?.isColor === true && sceneBackground.getHex() === 0xaaaaaa);
  const sceneHasRenderableObjects = useMemo(
    () =>
      Boolean(
        store.scene &&
          threeSceneHasRenderableContent(store.scene, {
            includeBackground: false,
            ignoredLayer: EDITOR_LAYER,
          }),
      ),
    [store.scene, store.shell.contentVersion],
  );
  const sceneHasContent = Boolean(
    store.scene && (sceneBackgroundIsAuthored || sceneHasRenderableObjects),
  );
  const explanation = explainSurface({
    surface: 'Scene',
    rootIds,
    phase: mountStatus === 'mounting' ? 'loading' : 'ready',
    content: sceneHasContent ? 'present' : mountStatus === 'mounting' ? 'unknown' : 'empty',
    readiness: rootReadiness,
    failures: mountFailures,
  });
  return <SurfaceStateOverlay explanation={explanation} testId="scene-viewport-status" />;
}

function WorldRootOverlays({
  store,
  documentId,
  cameraPreviewRef,
  mountStatus,
  rootIds,
}: WorldRootOverlayProps) {
  useSyncExternalStore(store.shell.subscribe, store.shell.getShellSnapshot ?? store.shell.getSnapshot);
  useSyncExternalStore(subscribeActiveAuthoring, activeAuthoringVersion);
  useSyncExternalStore(subscribeObject3DDocumentSessions, object3DDocumentSessionsVersion);
  useSyncExternalStore(subscribeWorkspaceDocuments, workspaceDocumentRegistryVersion);
  // The world root's stage is the Scene document's: the kit's overlay props
  // carry no document id, and the Scene document is the one world-root stage.
  const ctx = documentStageContext(store, documentId, 'document');
  return (
    <>
      {/* Three-scene selection overlay. React/Pixi documents mount their own
          co-located overlay beside the isolated world host, and the worlds it
          draws over are the manifest's — so its condition is the stage showing
          them, the same fact the surface-state card reads. */}
      {ctx.surface !== null ? <RootSelectionOverlay /> : null}
      {/* A pinned camera preview survives deselection. The camera-authoring
          host is installed by the world root's own binding
          (`world-root-stage.ts`), so the pin belongs to the stage that
          installed it. */}
      {ctx.surface === 'three' ? <CameraAuthoringOverlay previewRef={cameraPreviewRef} /> : null}
      <SceneViewportStateOverlay store={store} rootIds={rootIds} mountStatus={mountStatus} />
    </>
  );
}

export const worldRootStageBinding: WorldRootStageBinding = {
  mountWorldRootSurface,
  installWorldRootStage,
  Overlays: WorldRootOverlays,
};
