/**
 * Lazy document boundary for the shared Object3D authoring surface.
 *
 * Registries and open-document planners need to be able to name this surface
 * during editor boot, but the implementation carries Asset Lab's animation,
 * capture, model-inspection, and source-authoring graph. Importing that graph
 * merely to register unopened document kinds put it on Scene's cold path.
 * Keep the public component shape here and evaluate the implementation only
 * when React actually renders an Object3D document.
 */

import { lazy, Suspense, useEffect } from 'react';
import { announceObject3DDocumentStage } from '../authoring/object3d-document-session-registry';
import type { Object3DDocumentViewportProps } from './StageHost';
import { OBJECT3D_SURFACE_BUILDING, ViewportSurfaceStatus } from '@volter/editor-sdk/kit/viewport-surface-status';

const LazyObject3DDocumentViewport = lazy(async () => {
  const module = await import('./StageHost');
  return { default: module.Object3DDocumentViewport };
});

export function Object3DDocumentViewport(props: Object3DDocumentViewportProps) {
  // ANNOUNCE BEFORE THE CHUNK RESOLVES. An opener's `ready` asks whether this
  // document is mounting a stage at a moment when the implementation import is
  // still in flight, and this boundary is the only thing rendered by then —
  // announcing from inside `StageHost` would answer "no stage" for exactly the
  // window the wait exists to cover.
  useAnnouncedObject3DDocumentStage(props.documentId, props.chromeless);
  return (
    <Suspense
      fallback={
        <ViewportSurfaceStatus testId="object3d-document-loading">
          {OBJECT3D_SURFACE_BUILDING}
        </ViewportSurfaceStatus>
      }
    >
      <LazyObject3DDocumentViewport {...props} />
    </Suspense>
  );
}

/**
 * The announcement, spelled here and again at `StageHost.tsx`'s own
 * `Object3DDocumentViewport` — deliberately NOT a shared hook, because
 * importing one across these two files is the static edge that would put this
 * boundary inside the implementation's own pinned closure and defeat the
 * laziness the boundary exists for.
 *
 * A CHROMELESS mount announces nothing, for the same reason it registers no
 * session (`StageHost.tsx:2235`): it is a thumbnail of a document, several can
 * be alive for one id at once, and an opener waiting on one would wait forever.
 */
function useAnnouncedObject3DDocumentStage(documentId: string, chromeless = false): void {
  useEffect(() => {
    if (chromeless) return;
    return announceObject3DDocumentStage(documentId);
  }, [documentId, chromeless]);
}
