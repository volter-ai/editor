/**
 * THE THREE VIEWPORT'S PALETTE ENTRIES — tool and space modes, grid, helpers,
 * stats, snap, shading, the view presets, Frame and the camera verbs. They are
 * the active three stage's, published as a palette contribution while that
 * stage is bound (`components/stage-keyboard.tsx`), and they act on that
 * stage's own store: the same stage its keys drive (`viewport-hotkeys.ts`).
 */
import type { ActionContribution, ContributedAction } from '@volter/editor-sdk/chrome';
import {
  alignCameraToViewport,
  cameraAuthoringPresentation,
  currentCameraAuthoringSubject,
  leaveCameraView,
  pilotCamera,
  subscribeCameraAuthoring,
  toggleCameraPreviewPin,
  viewThroughCamera,
} from './camera-authoring';
import { registerContributedActions } from './chrome-registry';
import type { EditorShellStore } from './editor-shell-store';
import { requestTransformMode } from './transform-mode-request';
import { activeWorkspaceDocumentId } from '@volter/editor-sdk/kit/workspace-document-registry';
import { setViewGridVisible, viewGridVisible } from '@volter/editor-sdk/kit/viewport-presentation';

function cameraActions(): ContributedAction[] {
  const presentation = cameraAuthoringPresentation();
  if (presentation.view) {
    return [{ id: 'camera.exitView', label: 'Exit Camera View', execute: leaveCameraView }];
  }
  const subject = currentCameraAuthoringSubject();
  if (!subject) return [];
  return [
    {
      id: 'camera.viewThrough',
      label: `View Through ${subject.name}`,
      execute: () => viewThroughCamera(subject),
    },
    ...(subject.canAuthorPose
      ? [
          { id: 'camera.pilot', label: `Pilot ${subject.name}`, execute: () => pilotCamera(subject) },
          {
            id: 'camera.alignToView',
            label: `Align ${subject.name} to Current View`,
            execute: () => alignCameraToViewport(subject),
          },
        ]
      : []),
    {
      id: 'camera.pinPreview',
      label: presentation.previewPinned ? 'Unpin Camera Preview' : 'Pin Camera Preview',
      execute: toggleCameraPreviewPin,
    },
  ];
}

export function registerViewportActions(store: EditorShellStore): () => void {
  const fixed: ContributedAction[] = [
    { id: 'mode.select', label: 'Select Tool (no gizmo)', shortcut: 'transform.select', execute: () => requestTransformMode(store, 'select') },
    { id: 'mode.combined', label: 'Transform Mode (all handles)', shortcut: 'transform.combined', execute: () => requestTransformMode(store, 'combined') },
    { id: 'mode.translate', label: 'Translate Mode', shortcut: 'transform.translate', execute: () => requestTransformMode(store, 'translate') },
    { id: 'mode.rotate', label: 'Rotate Mode', shortcut: 'transform.rotate', execute: () => requestTransformMode(store, 'rotate') },
    { id: 'mode.scale', label: 'Scale Mode', shortcut: 'transform.scale', execute: () => requestTransformMode(store, 'scale') },
    { id: 'mode.world', label: 'World Space', execute: () => store.setTransformSpace('world') },
    { id: 'mode.local', label: 'Local Space', execute: () => store.setTransformSpace('local') },
    {
      id: 'toggle.grid',
      label: 'Toggle Grid',
      execute: () => {
        // The ACTIVE view's grid switch, one per view (`kit/viewport-presentation`).
        const viewId = activeWorkspaceDocumentId();
        if (viewId) setViewGridVisible(viewId, !viewGridVisible(viewId));
      },
    },
    { id: 'toggle.helpers', label: 'Toggle Helpers', execute: () => store.toggleHelpers() },
    { id: 'toggle.stats', label: 'Toggle Stats Overlay', execute: () => store.toggleStats() },
    { id: 'toggle.snap', label: 'Toggle Snap', shortcut: 'viewport.toggleSnap', execute: () => store.toggleSnap() },
    { id: 'toggle.surface-snap', label: 'Toggle Surface Snap', execute: () => store.toggleSnapToSurface() },
    { id: 'shading.solid', label: 'Material Shading', execute: () => store.setShadingMode('solid') },
    { id: 'shading.clay', label: 'Solid Shading', execute: () => store.setShadingMode('clay') },
    { id: 'shading.wireframe', label: 'Wireframe Shading', execute: () => store.setShadingMode('wireframe') },
    { id: 'shading.unlit', label: 'Unlit Shading', execute: () => store.setShadingMode('unlit') },
    { id: 'shading.normals', label: 'Normal Shading', execute: () => store.setShadingMode('normals') },
    { id: 'shading.overdraw', label: 'Overdraw Shading', execute: () => store.setShadingMode('overdraw') },
    { id: 'view.top', label: 'Top View', shortcut: 'view.top', execute: () => store.setViewPreset('top') },
    { id: 'view.front', label: 'Front View', shortcut: 'view.front', execute: () => store.setViewPreset('front') },
    { id: 'view.right', label: 'Right View', shortcut: 'view.right', execute: () => store.setViewPreset('right') },
    { id: 'view.perspective', label: 'Perspective View', shortcut: 'view.perspective', execute: () => store.setViewPreset('perspective') },
    { id: 'focus.selected', label: 'Focus Selected', shortcut: 'viewport.frameSelection', execute: () => store.focusOnSelection() },
  ];
  const contribution: ActionContribution = {
    actions: () => [...fixed, ...cameraActions()],
    subscribe: subscribeCameraAuthoring,
  };
  return registerContributedActions(contribution);
}
