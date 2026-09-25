/**
 * THE THREE.JS ASSET LAB VIEWERS, registered by route
 * (`@volter/editor-sdk/kit/asset-viewers`): a glTF model, an environment map, a
 * LUT, a shader, a live modeling module and a live entity's model. Each loads on
 * first use, so a document that never opens one never pays for three.js.
 */
import {
  type AssetViewerProps,
  type AssetViewerRoute,
  registerAssetViewer,
} from '@volter/editor-sdk/kit/asset-viewers';
import { type ComponentType, lazy } from 'react';

const viewers: Readonly<Record<AssetViewerRoute, ComponentType<AssetViewerProps>>> = {
  model: lazy(async () => {
    const { ModelAssetDocument } = await import('./ModelAssetDocument');
    return {
      default: (props: AssetViewerProps) => (
        <ModelAssetDocument
          documentId={props.documentId}
          assetPath={props.assetPath}
          displayName={props.displayName}
          active={props.active}
        />
      ),
    };
  }),
  'entity-model': lazy(async () => {
    const { EntityModelDocument } = await import('./EntityModelDocument');
    return {
      default: (props: AssetViewerProps) => (
        <EntityModelDocument
          documentId={props.documentId}
          entityId={props.entityId ?? ''}
          displayName={props.displayName}
          active={props.active}
        />
      ),
    };
  }),
  environment: lazy(async () => {
    const { EnvironmentAssetDocument } = await import('./EnvironmentAssetDocument');
    return {
      default: (props: AssetViewerProps) => (
        <EnvironmentAssetDocument documentId={props.documentId} assetPath={props.assetPath} active={props.active} />
      ),
    };
  }),
  lut: lazy(async () => {
    const { LutAssetDocument } = await import('./LutAssetDocument');
    return {
      default: (props: AssetViewerProps) => (
        <LutAssetDocument documentId={props.documentId} assetPath={props.assetPath} active={props.active} />
      ),
    };
  }),
  shader: lazy(async () => {
    const { ShaderAssetDocument } = await import('./ShaderAssetDocument');
    return {
      default: (props: AssetViewerProps) => (
        <ShaderAssetDocument documentId={props.documentId} assetPath={props.assetPath} active={props.active} />
      ),
    };
  }),
  // A project script that BUILDS an Object3D opens as the live modeling
  // document; anything else keeps the text preview it is handed as `fallback`.
  module: lazy(async () => {
    const { LiveModuleDocument } = await import('./LiveModuleDocument');
    return {
      default: (props: AssetViewerProps) =>
        props.projectRoot ? (
          <LiveModuleDocument
            documentId={props.documentId}
            projectRoot={props.projectRoot}
            modulePath={(props.assetPath.split(/[?#]/, 1)[0] ?? props.assetPath).replace(/^\//, '')}
            displayName={props.displayName}
            active={props.active}
            fallback={props.fallback}
          />
        ) : (
          props.fallback
        ),
    };
  }),
};

export function registerThreeAssetViewers(): () => void {
  const removals = (Object.keys(viewers) as AssetViewerRoute[]).map((route) =>
    registerAssetViewer(route, viewers[route]),
  );
  return () => {
    for (const remove of removals) remove();
  };
}
