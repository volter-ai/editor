/**
 * THE THREE INTEGRATION, INSTALLED — every registration the kit's Three viewport answers
 * through: the Object3D surfaces contributions mount, the viewport's relay verbs, its Asset Lab
 * viewers, the inspector's node media, model thumbnails, the viewport status facet,
 * canvas captures, the gizmo viewport's authoring policy, and the view state each session store's
 * Three half saves. The kit constructs none of it; the integration installs it once, and every
 * Three surface asks for it before it mounts (`ensureThreeIntegration`).
 */
import { registerContributedCommands } from '@volter/editor-sdk/kit/command-registry';
import { saveThumbnail } from '@volter/editor-sdk/kit/editor-api';
import { registerHostHierarchyObjects } from '../host-hierarchy-objects';
import { registerObject3DSurfaces } from '@volter/editor-sdk/kit/object3d-surfaces';
import { registerRendererResourceCounts } from '@volter/editor-sdk/kit/renderer-resource-counts';
import { interactiveViewportRendererCounts } from './three-viewport/interactive-renderer';
import { inspectorPreviewRendererCounts } from '../viewport/preview-renderer';
import { liveHostRendererCount } from '../viewport/renderer-ownership';
import { lazy } from 'react';
import type * as THREE from 'three';
import { SHELL_VIEWPORT_AUTHORING_POLICY } from './authoring/shell-viewport-policy';
import { registerThreeAssetViewers } from './components/asset-viewers/three-asset-viewers';
import type { EditorStatePersistence } from './editor-shell-store';
import { registerModelThumbnails } from './model-thumbnail';
import { writeProjectLocalSection } from '@volter/editor-sdk/kit/project-local-state';
import { onShellStore } from '@volter/editor-sdk/kit/shell-store-door';
import { registerThreeCanvasRender } from './three-canvas-render';
import { registerThreeHierarchyRowMedia } from './three-hierarchy-row-media';
import { registerThreePlayCameraFlight } from './play-camera-flight';
import { registerThreeInspectionMedia } from './three-inspection-media';
import { threeStateOf, threeStoreForHost } from './three-state';
import { installViewportAuthoringPolicy } from './viewport-authoring-policy';
import { viewportCommands } from './viewport-commands';
import { reportViewportStatus } from './viewport-status-facet';

/**
 * The session's view state (tools, helpers, shading, camera) and its thumbnails, saved to the
 * project's own `view` section. ONE object across a Fast Refresh of this module, because
 * `attachStatePersistence` keeps one owner and a re-evaluated module constant is a new one.
 */
const hotData = (import.meta as ImportMeta & { hot?: { data: Record<string, unknown> } }).hot?.data;
const VIEW_STATE_PERSISTENCE: EditorStatePersistence = (hotData?.['viewStatePersistence'] as
  | EditorStatePersistence
  | undefined) ?? {
  save: (state) => writeProjectLocalSection('view', state),
  saveThumbnail,
};
if (hotData) hotData['viewStatePersistence'] = VIEW_STATE_PERSISTENCE;

const Preview = lazy(async () => ({ default: (await import('./components/ToolObject3DPreview')).ToolObject3DPreview }));
const Authoring = lazy(async () => ({ default: (await import('./components/StageHost')).ToolObject3DAuthoring }));

const NO_OBJECTS: ReadonlyMap<string, THREE.Object3D> = new Map();

let installed: (() => void) | null = null;

/** Install the integration; idempotent. Returns the teardown of the first install. */
export function ensureThreeIntegration(): () => void {
  if (installed) return installed;
  const stops = [
    registerObject3DSurfaces({ Preview, Authoring }),
    registerContributedCommands('three-viewport', viewportCommands),
    registerThreeAssetViewers(),
    registerThreeInspectionMedia(),
    registerModelThumbnails(),
    reportViewportStatus(),
    registerThreeCanvasRender(),
    registerThreeHierarchyRowMedia(),
    registerThreePlayCameraFlight(),
    registerHostHierarchyObjects({
      object: (id) => threeStoreForHost()?.objectMap.get(id) ?? null,
      objects: () => threeStoreForHost()?.objectMap ?? NO_OBJECTS,
    }),
    registerRendererResourceCounts('hostLive', liveHostRendererCount),
    registerRendererResourceCounts('interactive', interactiveViewportRendererCounts),
    registerRendererResourceCounts('inspectorPreview', inspectorPreviewRendererCounts),
    // The session store's Three half saves its view state; attached once per store.
    onShellStore((store) => threeStateOf(store).attachStatePersistence(VIEW_STATE_PERSISTENCE)),
  ];
  // The gizmo viewport's questions (which adapter is active, what is under the pointer, which
  // root is world-hidden) are answered before any viewport mounts.
  installViewportAuthoringPolicy(SHELL_VIEWPORT_AUTHORING_POLICY);
  installed = () => {
    for (const stop of stops.reverse()) stop();
    installed = null;
  };
  return installed;
}
