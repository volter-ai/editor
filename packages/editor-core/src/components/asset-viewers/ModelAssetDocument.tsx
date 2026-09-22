import { themeVars } from '@volter/editor-sdk/widgets';
import { useCallback, useEffect, useState } from 'react';
import type * as THREE from 'three';
import {
  disposeProjectAssetModel,
  loadProjectAssetModelSource,
  type ProjectAssetModelSource,
} from '../../asset-preview';
import {
  createModelPreviewSource,
  loadModelThumbnailObject,
  modelThumbnailFormat,
} from '../../model-thumbnail';
import { Object3DDocumentViewport } from '../StageHost';

/**
 * File-backed models use the same native Object3D document host as source
 * factories. Asset-specific diagnostics and provenance live in Inspector
 * contributions; this center document owns only loading and native lifetime.
 *
 * A GLB that carries clips also gets a WRITER: the surgical clip persistence
 * appends accessors to the file's own BIN chunk, so editing a key in the
 * animation workspace saves back into the asset instead of being read-only.
 * When that binding refuses, its reason — not a generic one — is what the
 * workspace shows.
 */
export function ModelAssetDocument({
  documentId,
  assetPath,
  displayName,
  active,
}: {
  readonly documentId: string;
  readonly assetPath: string;
  readonly displayName: string;
  readonly active: boolean;
}) {
  const [source, setSource] = useState<ProjectAssetModelSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setSource(null);
      return;
    }
    const controller = new AbortController();
    let owned: THREE.Object3D | null = null;
    setSource(null);
    setError(null);
    const format = modelThumbnailFormat(assetPath);
    const loading: Promise<ProjectAssetModelSource> =
      format === 'glb' || format === 'gltf' || format === 'spz'
        ? loadProjectAssetModelSource(assetPath, controller.signal)
        : format
          ? loadModelThumbnailObject({ url: assetPath, format })
              .then(createModelPreviewSource)
              .then((root) => ({ root, sourceBytes: null }))
          : Promise.reject(new Error(`No native Three.js model loader supports ${assetPath}.`));
    void loading.then(
      (loaded) => {
        if (controller.signal.aborted) {
          disposeProjectAssetModel(loaded.root);
          return;
        }
        owned = loaded.root;
        setSource(loaded);
      },
      (cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      controller.abort();
      if (owned) disposeProjectAssetModel(owned);
    };
  }, [active, assetPath]);

  const model = source?.root ?? null;
  const build = useCallback(() => {
    if (!model) throw new Error(`Model asset ${assetPath} is not loaded.`);
    return { root: model, animations: model.animations, dispose() {} };
  }, [assetPath, model]);
  if (error)
    return (
      <div role="alert" style={{ padding: 20, color: themeVars.semantic.danger }}>
        {error}
      </div>
    );
  if (!model)
    return (
      <div style={{ padding: 20, color: themeVars.content.muted }}>Loading {displayName}…</div>
    );
  return (
    <Object3DDocumentViewport
      documentId={documentId}
      sourcePath={assetPath}
      displayName={displayName}
      build={build}
      active={active}
      assetType="model"
      modelSource={{ kind: 'project-file', path: assetPath }}
    />
  );
}
