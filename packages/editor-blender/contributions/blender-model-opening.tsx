import type { ModelDocumentPreview } from '../src/model-document-preview';
import { modelOpeningErrorMessage } from '../src/model-opening-error';
import { Button, StateSurface, fontMono, fontSizeVar, spaceVar, themeVars } from '@volter/editor-sdk/widgets';
import type { AuthoringAdapter, EditorNode } from '@volter/editor-project/adapter';
import { AssetEditorSubject } from '@volter/editor-sdk/kit/components/AssetEditorShell';
import { useMemo } from 'react';

/** A loading/error surface has no authoring stage and publishes no model. */
export function BlenderModelOpening({ documentId, path, error, preview, retry, returnToPreview, preparingView = false, note = null }: {
  readonly documentId: string;
  readonly path: string;
  readonly error: string | null;
  readonly preview: ModelDocumentPreview | null;
  readonly retry: () => void;
  readonly returnToPreview: () => void;
  readonly preparingView?: boolean;
  /** What a slow open is waiting on — progress beside the spinner, not an error. */
  readonly note?: string | null;
}) {
  const title = error ? 'Could not open model' : preparingView ? 'Preparing model view' : 'Opening model';
  // This document has not published an authoring stage yet. Its panels still
  // belong to it, rather than the empty project's "Declare a root" fallback.
  // A boundary row is informational; no old model objects remain editable.
  const adapter = useMemo<AuthoringAdapter>(() => {
    const node: EditorNode = { id: `opening:${documentId}`, label: title, secondaryLabel: path,
      role: 'boundary', kind: 'object', parentId: null, childIds: [] };
    return { capabilities: { transform: false, inspectorFields: false, persist: false },
      hierarchy: { roots: () => [node], node: id => id === node.id ? node : null },
      subscribe: () => () => {} };
  }, [documentId, path, title]);
  return (
    <div data-testid="blender-model-opening" aria-busy={!error}
      style={{ position: 'absolute', inset: 0, overflow: 'auto', background: themeVars.surface.panel, color: themeVars.content.primary }}>
      {!preparingView && <AssetEditorSubject key={title} documentId={documentId} type="Model" title={path}
        status={error ? modelOpeningErrorMessage(error) : title}
        selection={() => ({ adapter, nodeId: null })} />}
      {preview && <img src={preview.image} alt={`Last view of ${preview.path}`} draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />}
      <div style={{ position: 'relative', minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: preview ? 'flex-end' : 'center', alignItems: preview ? 'flex-start' : 'center', boxSizing: 'border-box', padding: spaceVar[8], gap: spaceVar[4] }}>
        {preview && <div style={{ padding: `${spaceVar[2]} ${spaceVar[4]}`, background: themeVars.surface.chrome, border: `1px solid ${themeVars.boundary.default}`, borderRadius: themeVars.shape.small, maxWidth: '100%', overflowWrap: 'anywhere' }}>
          Previous model: {preview.path} · Preview only
        </div>}
        <StateSurface tone={error ? 'error' : 'loading'}
          style={{ width: 'min(100%, 32rem)', background: themeVars.surface.chrome, border: `1px solid ${themeVars.boundary.default}`, borderRadius: themeVars.shape.small, overflowWrap: 'anywhere' }}
          title={<span style={{ fontSize: fontSizeVar.lg }}>{title}</span>}
          description={<>
            <div style={{ color: themeVars.content.primary, marginBottom: spaceVar[3] }}>{path}</div>
            {error ? modelOpeningErrorMessage(error) : preparingView ? 'The file is open. Preparing its viewport.' : preview ? 'The previous model stays visible while this file opens.' : 'Preparing Blender and opening this file. The model will appear here when it is ready.'}
            {/* THE CAUSE, VERBATIM, where the person is looking: the sentence above is a
                category, and "details are available in the console" sent people to a console
                they could not see (2026-10-06 audit). Selectable, so it can be copied. */}
            {!error && note && <div data-testid="blender-model-opening-note" style={{ marginTop: spaceVar[3], color: themeVars.content.muted, userSelect: 'text' }}>{note}</div>}
            {error && <div data-testid="blender-model-opening-detail"
              style={{ marginTop: spaceVar[3], fontFamily: fontMono, fontSize: fontSizeVar.sm, color: themeVars.content.muted, whiteSpace: 'pre-wrap', userSelect: 'text', textAlign: 'left' }}>
              {error}
            </div>}
          </>}
          action={error ? <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: spaceVar[3] }}>
            {preview && <Button onClick={returnToPreview}>Return to previous model</Button>}
            <Button variant="secondary" onClick={retry}>Retry opening</Button>
          </div> : <progress aria-label={`Opening ${path}`} style={{ width: 'min(100%, 18rem)', accentColor: themeVars.accent.default }} />}
        />
      </div>
    </div>
  );
}
