import { themeVars } from '@volter/editor-sdk/widgets';
import { liveMixerFor } from '@volter/editor-threejs/animation/live-mixers';
import { useCallback, useSyncExternalStore } from 'react';
import type * as THREE from 'three';
import {
  assetPreviewSubject,
  createAssetPreviewSnapshot,
  disposeAssetPreviewSnapshot,
} from '../../asset-preview';
import { useEditorStore } from '../../editor-runtime';
import { Object3DDocumentViewport } from '../StageHost';

function entityClips(source: THREE.Object3D): THREE.AnimationClip[] {
  const discovered = new Set<THREE.AnimationClip>();
  source.traverse((object) => {
    const live = liveMixerFor(object);
    if (live) for (const clip of live.clips.values()) discovered.add(clip);
    for (const clip of object.animations) discovered.add(clip);
  });
  return [...discovered];
}

/**
 * Isolated native projection of a live `Object3D`; the source graph is never
 * reparented (`createAssetPreviewSnapshot` copies it).
 *
 * The object comes in already resolved, so this component has no way to fail
 * for a thing that is on screen — it is the honest shared body of both the
 * Asset Lab's entity document ({@link EntityModelDocument}, which resolves the
 * scene entity and owns the "no longer available" case) and the inspector's
 * preview section (`components/InspectorObjectPreview.tsx`), whose subject the
 * composer has already proved previewable.
 */
export function Object3DSnapshotDocument({
  documentId,
  source,
  sourcePath,
  displayName,
  active,
  chromeless = false,
  revision = 0,
  modelSource,
}: {
  readonly documentId: string;
  readonly source: THREE.Object3D;
  /** Human-readable provenance line for the viewport's own chrome. */
  readonly sourcePath?: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly chromeless?: boolean;
  /** Bump to rebuild the snapshot when the source graph mutated in place. */
  readonly revision?: number;
  readonly modelSource?: { readonly kind: 'entity'; readonly entityId: string };
}) {
  const build = useCallback(() => {
    // The mesh under the click, or the skeleton root that owns its bones.
    const root = createAssetPreviewSnapshot(assetPreviewSubject(source));
    const animations = entityClips(source);
    root.animations = [...animations];
    return {
      root,
      animations,
      dispose() {
        disposeAssetPreviewSnapshot(root);
      },
    };
  }, [source, revision]);
  return (
    <Object3DDocumentViewport
      documentId={documentId}
      sourcePath={sourcePath ?? displayName}
      displayName={displayName}
      build={build}
      active={active}
      chromeless={chromeless}
      // The chromeless host is the inspector's preview, which remounts on
      // every selection — it draws through the shared renderer instead of
      // building one per click (`inspector-preview-renderer.ts`). A full
      // document lives as long as its panel and keeps its own.
      rendererLane={chromeless ? 'inspector-preview' : 'own'}
      assetType="entity"
      {...(modelSource ? { modelSource } : {})}
    />
  );
}

/** The Asset Lab document for one live scene entity. */
export function EntityModelDocument({
  documentId,
  entityId,
  displayName,
  active,
}: {
  readonly documentId: string;
  readonly entityId: string;
  readonly displayName: string;
  readonly active: boolean;
}) {
  const store = useEditorStore();
  const storeVersion = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const source = store.objectMap.get(entityId);

  if (!source)
    return (
      <div role="alert" style={{ padding: 20, color: themeVars.semantic.danger }}>
        Scene entity {entityId} is no longer available.
      </div>
    );
  return (
    <Object3DSnapshotDocument
      documentId={documentId}
      source={source}
      sourcePath={`Entity ${entityId}`}
      displayName={displayName}
      active={active}
      revision={storeVersion}
      modelSource={{ kind: 'entity', entityId }}
    />
  );
}
