import { themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useState } from 'react';
import type { InspectionSection } from '@volter/editor-sdk/kit/inspection-model';
import { AssetEditorShell } from '../AssetEditorShell';
import { GenericJsonViewer } from './GenericJsonViewer';
import {
  loadNativeQuarksJsonSource,
  type NativeQuarksJsonSource,
  QuarksAssetDocument,
} from './QuarksAssetDocument';

type JsonRoute =
  | { readonly kind: 'loading' }
  | { readonly kind: 'generic' }
  | { readonly kind: 'quarks'; readonly source: NativeQuarksJsonSource }
  | { readonly kind: 'error'; readonly message: string };

/** Content-routed JSON document. three.quarks uses ordinary Three Object3D
 * JSON and defines no special extension, so recognizing the native structure
 * is more honest than inventing a vgai filename convention. */
export function JsonAssetDocument({
  documentId,
  assetPath,
  displayName,
  active,
  sections,
  status,
}: {
  readonly documentId: string;
  readonly assetPath: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly sections: readonly InspectionSection[];
  readonly status: string;
}) {
  const [route, setRoute] = useState<JsonRoute>({ kind: 'loading' });

  useEffect(() => {
    if (!active) {
      setRoute({ kind: 'loading' });
      return;
    }
    const controller = new AbortController();
    setRoute({ kind: 'loading' });
    void loadNativeQuarksJsonSource(assetPath, controller.signal).then(
      (source) => {
        if (!controller.signal.aborted)
          setRoute(source ? { kind: 'quarks', source } : { kind: 'generic' });
      },
      (cause) => {
        if (!controller.signal.aborted) {
          setRoute({
            kind: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          });
        }
      },
    );
    return () => controller.abort();
  }, [active, assetPath]);

  if (route.kind === 'quarks') {
    return (
      <QuarksAssetDocument
        documentId={documentId}
        assetPath={assetPath}
        displayName={displayName}
        active={active}
        source={route.source}
      />
    );
  }
  return (
    <AssetEditorShell
      documentId={documentId}
      active={active}
      type="json"
      title={displayName}
      sections={sections}
      status={status}
    >
      {route.kind === 'loading' ? (
        <div style={{ padding: 20, color: themeVars.content.muted }}>Inspecting {displayName}…</div>
      ) : route.kind === 'error' ? (
        <div role="alert" style={{ padding: 20, color: themeVars.semantic.danger }}>
          {route.message}
        </div>
      ) : (
        <GenericJsonViewer assetPath={assetPath} />
      )}
    </AssetEditorShell>
  );
}
