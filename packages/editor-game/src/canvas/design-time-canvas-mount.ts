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
import { connectSourceFileEvents } from '@volter/editor-sdk/kit/asset-events';
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

/**
 * ABSORB-BY-REMOUNT (`DesignTimeMount.remountWhen`): a canvas world is re-executed from its source
 * whenever a project source module changes, whoever wrote it. Nothing else re-runs it: the design
 * layer's entry is imported once per mount, the packaged editor has no Vite client to deliver Fast
 * Refresh, and an external edit to the world left the scene (and every value the Inspector and a
 * gesture read from it) on the old source until the document was reopened. The server's source
 * watcher reports every `src/` module change as `source-files-changed` (a hosted project with no
 * path reports `''`, which still means something changed).
 *
 * REMOUNT, not re-project: a canvas layer's content is one native `<Application>` the disposer must
 * tear down before a second one draws into the same box.
 */
export function remountWhenSourceIsWritten(invalidate: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unwatch = connectSourceFileEvents((path) => {
    if (path !== '' && !/^src\/.+\.(?:[cm]?tsx?|jsx?)$/.test(path)) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      invalidate();
    }, 150);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    unwatch();
  };
}
