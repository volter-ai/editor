/**
 * What a three stage adds to its document's viewport
 * (`@volter/editor-sdk/kit/document-viewports`): the transform-tool driver, read
 * synchronously, and the shelf strip and header wells behind `lazy()`, so a
 * bounded host that mounts a stage never loads the editor's toolbar.
 */
import { lazy } from 'react';
import { threeStoreForHost } from '../shell-store-door';
import { documentStageContext, type StageTransformDriver, stageTransformDriver } from '../stage-context';

/** What the host's transform tools drive on this document's stage. */
export function threeStageTransformDriver(documentId: string): StageTransformDriver {
  const store = threeStoreForHost();
  return store ? stageTransformDriver(documentStageContext(store, documentId)) : 'none';
}

const TransformTools = lazy(() =>
  import('./stage-transform-tools').then((m) => ({ default: m.ThreeStageTransformTools })),
);
const TransformControls = lazy(() =>
  import('./stage-transform-tools').then((m) => ({ default: m.ThreeStageTransformControls })),
);

export function threeStageTransformChrome(documentId: string) {
  return {
    transformTools: () => threeStageTransformDriver(documentId),
    TransformTools,
    TransformControls,
  } as const;
}
