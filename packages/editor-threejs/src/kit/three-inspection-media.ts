/**
 * THE THREE.JS ANSWER TO "what does this node look like"
 * (`@volter/editor-sdk/kit/inspection-node-media`): a selected node the shell's
 * Three store resolves to a live `Object3D` is previewed as an isolated live
 * view of that object, a camera has no Preview section (its view is the
 * viewport's), an instanced mesh names its units, and a node in the object map
 * has an Asset Editor document to jump to. The kit's composer
 * (`compose-subject.ts`) builds the sections from this answer.
 */
import {
  type InspectionNodeMedia,
  registerInspectionNodeMedia,
} from '@volter/editor-sdk/kit/inspection-node-media';
import { contentWorldBounds } from '@volter/editor-threejs/viewport/content-bounds';
import { createElement, lazy } from 'react';
import type * as THREE from 'three';
import { openRegisteredDocument } from '@volter/editor-sdk/kit/document-open-registry';
import { InspectorPreviewBody } from '@volter/editor-sdk/kit/components/inspector-preview-section';
import { entityObject3D } from './entity-object';
import { describeInstancedPresentation } from './instanced-presentation';
import { threeStoreForHost } from './three-state';


// The heavy render stack stays behind `lazy()`, so a headless composer
// (`editor.inspect`, which never renders) pays nothing for it.
const InspectorObjectPreview = lazy(() =>
  import('./components/InspectorObjectPreview').then((m) => ({ default: m.InspectorObjectPreview })),
);

function objectMedia(
  object: THREE.Object3D,
  assetDocument: InspectionNodeMedia['assetDocument'],
): InspectionNodeMedia {
  return {
    preview: (object as THREE.Camera).isCamera
      ? null
      : ({ displayName, previewKey, actions }) =>
          (mode) =>
            createElement(InspectorPreviewBody, {
              picture: () =>
                createElement(InspectorObjectPreview, { previewKey, object, displayName, fill: true }),
              previewKey,
              actions,
              ...(mode ? { mode } : {}),
            }),
    // `contentWorldBounds` resolves instance matrices live — three's own cached
    // object box would answer for whatever pose was first asked about.
    instanced: describeInstancedPresentation(object, contentWorldBounds(object)),
    assetDocument,
  };
}

export function registerThreeInspectionMedia(): () => void {
  return registerInspectionNodeMedia((adapter, nodeId) => {
    const store = threeStoreForHost();
    if (!store) return null;
    const object = entityObject3D(adapter, store.objectMap, nodeId);
    if (!object) return null;
    return objectMedia(
      object,
      store.objectMap.has(nodeId)
        ? {
            // The live `Object3D.name` is the only name there is.
            open: () =>
              openRegisteredDocument('asset-editor:entity', store.shell, {
                entityId: nodeId,
                title: object.name || nodeId,
              }),
          }
        : null,
    );
  });
}
