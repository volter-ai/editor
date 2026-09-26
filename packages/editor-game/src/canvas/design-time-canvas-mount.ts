/**
 * THE CANVAS MEDIUM'S DESIGN-TIME MOUNT, as the SDK's design-time mount
 * registry asks for it — the layer-shaped wrapper around
 * `canvas-design-mount.ts`, registered by
 * `contributions/canvas/design-time-mount.service.ts`. The design-time layer
 * stack (`@volter/editor-sdk/kit/authoring/design-time-layers`) owns the
 * failure, teardown and Play lifecycle for every medium.
 */

import type {
  DesignTimeRootDescriptor,
  LayerMountResult,
} from '@volter/editor-sdk/kit/authoring/design-time-layers';
import type { DesignTimeMountContext } from '@volter/editor-sdk/kit/authoring/design-time-mount-registry';
import { recordViewportFirstFrame } from '@volter/editor-sdk/kit/viewport-activation-timings';
import { threeStoreForHost } from '@volter/editor-threejs/kit/three-state';

/**
 * A canvas world mounts its own `@pixi/react` `<Application>` (or its
 * Babylon equivalent) into this layer and is never ticked — see
 * `canvas-design-mount.ts` for the paused clock and the disabled input.
 *
 * `canvas-design-mount.ts` is imported dynamically so `pixi.js`/`@pixi/react`
 * enter a bundle only for a project that actually declares a canvas root. It
 * has been that way since the dispatch was a ternary in the host, and it is
 * the reason the contribution module beside this one stays a handful of lines.
 */
export async function mountCanvasDesignTimeLayer(
  candidate: DesignTimeRootDescriptor,
  layer: HTMLElement,
  context: DesignTimeMountContext,
): Promise<LayerMountResult> {
  const { mountCanvasDesignLayer } = await import('./canvas-design-mount');
  const { projectRootPath, view, activationDocumentId } = context;
  // The Pixi authoring adapter edits through the Three store's selection and
  // history, the same store Play's canvas adapter is handed.
  const store = threeStoreForHost();
  if (!store) throw new Error(`canvas root "${candidate.worldId}": the editor store is not bound yet.`);
  const mounted = await mountCanvasDesignLayer(
    candidate.worldId,
    candidate.path,
    layer,
    projectRootPath,
    store,
    view,
    activationDocumentId ? () => recordViewportFirstFrame(activationDocumentId) : undefined,
  );
  return { adapter: mounted.adapter, dispose: () => mounted.dispose() };
}
