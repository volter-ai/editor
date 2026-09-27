import { announceDocumentStage } from '@volter/editor-sdk/kit/document-viewports';
import { lazy, Suspense, useEffect } from 'react';
import type { ToolObject3DAuthoringProps, ToolObject3DPreviewProps } from '../../object3d-contributions';

/**
 * The Object3D surfaces a contribution mounts from its `surfaces` prop, as the Three integration
 * registers them. Each loads its viewport on first use, so installing the integration pulls no
 * WebGL modules until a document asks for one.
 */
const Preview = lazy(async () => ({ default: (await import('./ToolObject3DPreview')).ToolObject3DPreview }));
const Authoring = lazy(async () => ({ default: (await import('./StageHost')).ToolObject3DAuthoring }));

export function Object3DPreviewSurface(props: ToolObject3DPreviewProps) {
  return (
    <Suspense fallback={<div style={{ minHeight: 240 }}>Loading 3D preview…</div>}>
      <Preview {...props} />
    </Suspense>
  );
}

export function Object3DAuthoringSurface(props: ToolObject3DAuthoringProps) {
  // A CONTRIBUTED DOCUMENT'S STAGE ANNOUNCES ITSELF HERE, the moment the contribution renders it —
  // long before the lazy implementation resolves and registers a session. This is what lets the
  // `tool` and `document` addresses declare a readiness without the host knowing which
  // contributions mount a stage: the capability catalog's Builder documents do and other
  // `workspace.document` contributions do not, and which is which belongs to the PROJECT.
  useEffect(() => announceDocumentStage(props.documentId), [props.documentId]);
  return (
    <Suspense fallback={<div style={{ minHeight: 240 }}>Loading 3D authoring surface…</div>}>
      <Authoring {...props} />
    </Suspense>
  );
}
