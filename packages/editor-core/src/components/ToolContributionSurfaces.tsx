import type {
  ToolAssetDocumentProps,
  ToolContributionSurfaces,
  ToolObject3DAuthoringProps,
  ToolObject3DPreviewProps,
} from '@volter/editor-sdk/contributions';
import { lazy, Suspense, useEffect } from 'react';
import { announceDocumentStage } from '@volter/editor-sdk/kit/document-viewports';
import { AssetEditorSubject } from './AssetEditorShell';

const LazyToolObject3DPreview = lazy(async () => {
  const module = await import('./ToolObject3DPreview');
  return { default: module.ToolObject3DPreview };
});

const LazyToolObject3DAuthoring = lazy(async () => {
  const module = await import('./StageHost');
  return { default: module.ToolObject3DAuthoring };
});

/**
 * Lightweight contribution boundary: importing ToolHost must not eagerly pull
 * WebGL, postprocessing, or browser-only Model Asset modules into Node tools
 * and tests that never render a 3D preview.
 */
export function ToolObject3DPreviewSurface(props: ToolObject3DPreviewProps) {
  return (
    <Suspense fallback={<div style={{ minHeight: 240 }}>Loading 3D preview…</div>}>
      <LazyToolObject3DPreview {...props} />
    </Suspense>
  );
}

export function ToolObject3DAuthoringSurface(props: ToolObject3DAuthoringProps) {
  // A CONTRIBUTED DOCUMENT'S STAGE ANNOUNCES ITSELF HERE, in the host's own
  // surface, the moment the contribution renders it — long before the lazy
  // implementation resolves and registers a session. This is what lets the
  // `tool` and `document` addresses declare a readiness without the host
  // knowing which contributions mount a stage: three Builder documents in the
  // capability catalog do (`builder-document.tsx:66`) and nine other
  // `workspace.document` contributions do not, and which is which belongs to
  // the PROJECT, never to a list here.
  useEffect(() => announceDocumentStage(props.documentId), [props.documentId]);
  return (
    <Suspense fallback={<div style={{ minHeight: 240 }}>Loading 3D authoring surface…</div>}>
      <LazyToolObject3DAuthoring {...props} />
    </Suspense>
  );
}

/**
 * Registers the ordinary Asset Lab subject for a project-owned document. The
 * surface is intentionally childless: it registers a subject and draws nothing
 * of the document's own, which the document keeps rendering itself.
 */
export function ToolAssetDocumentSurface(props: ToolAssetDocumentProps) {
  return <AssetEditorSubject {...props} />;
}

/** Stable dependency-injection value shared by every contribution mount. */
export const toolContributionSurfaces: ToolContributionSurfaces = Object.freeze({
  AssetDocument: ToolAssetDocumentSurface,
  Object3DPreview: ToolObject3DPreviewSurface,
  Object3DAuthoring: ToolObject3DAuthoringSurface,
});
