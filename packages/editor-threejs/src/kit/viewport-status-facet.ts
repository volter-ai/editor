/**
 * THE VIEWPORT'S STATUS KEYS, reported by the Three set as a status facet
 * (`host.session.reportFacet`): grid, helpers, stats, shading, helper visibility,
 * the armed transform tool, space and snap, and the camera — each for the stage
 * the person is looking at (`focusedStageStore`, ARCHITECTURE-CORE §One stage
 * unit 4), with an Object3D document's own presentation where it has one.
 */
import { editorHost } from '@volter/editor-sdk/host';
import { activeWorkspaceDocumentId } from '@volter/editor-sdk/kit/workspace-document-registry';
import { object3DDocumentSession } from './authoring/object3d-document-session-registry';
import { focusedStageStore } from '@volter/editor-sdk/kit/stage-context';
import { viewGridVisible } from '@volter/editor-sdk/kit/viewport-presentation';
import { threeStoreForHost } from './three-state';
import { threeStateOf } from './three-state';

export function reportViewportStatus(): () => void {
  return editorHost().session.reportFacet(() => {
    const store = threeStoreForHost();
    if (!store) return {};
    const stage = focusedStageStore(store.shell);
    const activeDocumentId = activeWorkspaceDocumentId();
    const presentation = activeDocumentId
      ? object3DDocumentSession(activeDocumentId)?.presentation()
      : undefined;
    // A camera is a per-stage fact: the pose of the stage the person is looking
    // through, absent until one is bound — never a fabricated value.
    const pose = threeStateOf(stage).cameraPose;
    return {
      showGrid: activeDocumentId ? viewGridVisible(activeDocumentId) : true,
      showHelpers: stage.showHelpers,
      showStats: threeStateOf(stage).showStats,
      shadingMode: presentation?.mode ?? store.shadingMode,
      helperVisibility: {
        ...stage.helperVisibility,
        ...(presentation ? { bounds: presentation.bounds, skeletons: presentation.skeleton } : {}),
      },
      // The armed tool is the ACTIVE document's stage's: every stage owns a store
      // and the shelf's tools write the one the person is looking at.
      transformMode: stage.transformMode,
      transformSpace: store.shell.transformSpace,
      snapEnabled: store.shell.snapEnabled,
      ...(pose
        ? {
            camera: {
              position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
              target: { x: pose.target.x, y: pose.target.y, z: pose.target.z },
              fov: pose.fov,
            },
          }
        : {}),
    };
  });
}
