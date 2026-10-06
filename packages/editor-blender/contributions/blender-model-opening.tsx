import type { ModelDocumentPreview } from '../src/model-document-preview';
import { modelOpeningErrorMessage } from '../src/model-opening-error';
import { Button, StateSurface, fontSizeVar, spaceVar, themeVars } from '@volter/editor-sdk/widgets';

/** A loading/error surface has no authoring stage and publishes no model. */
export function BlenderModelOpening({ path, error, preview, retry, returnToPreview, preparingView = false }: {
  readonly path: string;
  readonly error: string | null;
  readonly preview: ModelDocumentPreview | null;
  readonly retry: () => void;
  readonly returnToPreview: () => void;
  readonly preparingView?: boolean;
}) {
  return (
    <div data-testid="blender-model-opening" aria-busy={!error}
      style={{ position: 'absolute', inset: 0, overflow: 'auto', background: themeVars.surface.panel, color: themeVars.content.primary }}>
      {preview && <img src={preview.image} alt={`Last view of ${preview.path}`} draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />}
      <div style={{ position: 'relative', minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: preview ? 'flex-end' : 'center', alignItems: preview ? 'flex-start' : 'center', boxSizing: 'border-box', padding: spaceVar[8], gap: spaceVar[4] }}>
        {preview && <div style={{ padding: `${spaceVar[2]} ${spaceVar[4]}`, background: themeVars.surface.chrome, border: `1px solid ${themeVars.boundary.default}`, borderRadius: themeVars.shape.small, maxWidth: '100%', overflowWrap: 'anywhere' }}>
          Previous model: {preview.path} · Preview only
        </div>}
        <StateSurface tone={error ? 'error' : 'loading'}
          style={{ width: 'min(100%, 32rem)', background: themeVars.surface.chrome, border: `1px solid ${themeVars.boundary.default}`, borderRadius: themeVars.shape.small, overflowWrap: 'anywhere' }}
          title={<span style={{ fontSize: fontSizeVar.lg }}>{error ? 'Could not open model' : preparingView ? 'Preparing model view' : 'Opening model'}</span>}
          description={<>
            <div style={{ color: themeVars.content.primary, marginBottom: spaceVar[3] }}>{path}</div>
            {error ? modelOpeningErrorMessage(error) : preparingView ? 'The file is open. Preparing its viewport.' : preview ? 'The previous model stays visible while this file opens.' : 'Preparing Blender and opening this file. The model will appear here when it is ready.'}
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
