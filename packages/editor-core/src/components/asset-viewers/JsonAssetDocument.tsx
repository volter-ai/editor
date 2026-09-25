import { themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useState } from 'react';
import type { InspectionSection } from '@volter/editor-sdk/kit/inspection-model';
import { AssetEditorShell } from '@volter/editor-sdk/kit/components/AssetEditorShell';
import { GenericJsonViewer } from './GenericJsonViewer';
import { type JsonContentViewer, useJsonContentViewers } from '@volter/editor-sdk/kit/asset-viewers';

type JsonRoute =
  | { readonly kind: 'loading' }
  | { readonly kind: 'generic' }
  | { readonly kind: 'content'; readonly viewer: JsonContentViewer; readonly content: unknown }
  | { readonly kind: 'error'; readonly message: string };

/** Content-routed JSON document. A format with no extension of its own (a
 * three.quarks particle system is plain Object3D JSON) is recognized by the
 * medium that renders it (`@volter/editor-sdk/kit/asset-viewers`), which is more
 * honest than inventing a vgai filename convention. */
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
  const viewers = useJsonContentViewers();

  useEffect(() => {
    if (!active) {
      setRoute({ kind: 'loading' });
      return;
    }
    const controller = new AbortController();
    setRoute({ kind: 'loading' });
    const recognize = async (): Promise<JsonRoute> => {
      for (const viewer of viewers) {
        const content = await viewer.recognize(assetPath, controller.signal);
        if (content !== null) return { kind: 'content', viewer, content };
      }
      return { kind: 'generic' };
    };
    void recognize().then(
      (next) => {
        if (!controller.signal.aborted) setRoute(next);
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
  }, [active, assetPath, viewers]);

  if (route.kind === 'content') {
    const { Viewer } = route.viewer;
    return (
      <Viewer
        documentId={documentId}
        assetPath={assetPath}
        displayName={displayName}
        active={active}
        content={route.content}
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
