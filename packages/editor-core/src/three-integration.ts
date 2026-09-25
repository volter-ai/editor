/**
 * THE THREE INTEGRATION, INSTALLED — every registration the kit's Three viewport answers
 * through: the Object3D surfaces contributions mount, the viewport's relay verbs, its Asset Lab
 * viewers, the inspector's node media, model and story thumbnails, the viewport status facet,
 * canvas captures, the gizmo viewport's authoring policy, and the view state each session store's
 * Three half saves. The kit constructs none of it; the integration installs it once, and every
 * Three surface asks for it before it mounts (`ensureThreeIntegration`).
 */
import { registerContributedCommands } from './command-registry';
import { saveThumbnail } from '@volter/editor-sdk/kit/editor-api';
import { registerObject3DSurfaces } from '@volter/editor-sdk/kit/object3d-surfaces';
import { lazy } from 'react';
import { SHELL_VIEWPORT_AUTHORING_POLICY } from './authoring/shell-viewport-policy';
import { registerThreeAssetViewers } from './components/asset-viewers/three-asset-viewers';
import type { EditorStatePersistence } from './editor-shell-store';
import { registerModelThumbnails } from './model-thumbnail';
import { writeProjectLocalSection } from './project-local-state';
import { onShellStore } from './shell-store-door';
import { registerThreeStoryCapture } from './stories/three-story-captures';
import { registerThreeCanvasRender } from './three-canvas-render';
import { registerThreeInspectionMedia } from './inspection/compose';
import { threeStateOf } from './three-state';
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
    registerThreeStoryCapture(),
    reportViewportStatus(),
    registerThreeCanvasRender(),
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
