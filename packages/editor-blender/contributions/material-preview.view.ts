/**
 * BLENDER'S MATERIAL PREVIEW, as a named view: the Material shading cell. Its lighting is the
 * Blender stage's own for that mode (`src/presentation.ts`, `modes.preview`), so the view only
 * chooses the mode, as the cell does.
 * A named view (`@volter/editor-sdk/kit/viewport-presentation` `ViewPreset`).
 */
import type { ViewPreset } from '@volter/editor-sdk/kit/viewport-presentation';

export const point = 'workspace.view';
export const view: ViewPreset = {
  id: 'blender-material-preview',
  title: 'Material Preview',
  layer: { drawMode: 'preview' },
};
