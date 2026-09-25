/**
 * BLENDER'S RENDERED SHADING, as a named view: the Rendered shading cell. Its lighting is the
 * Blender stage's own for that mode (`src/presentation.ts`, `modes.rendered`) — the scene's own
 * lights and World, held on the viewport by `blender-runtime.document.tsx` — so the view only
 * chooses the mode, as the cell does.
 * A named view (`@volter/editor-sdk/kit/viewport-presentation` `ViewPreset`).
 */
import type { ViewPreset } from '@volter/editor-sdk/kit/viewport-presentation';

export const point = 'workspace.view';
export const view: ViewPreset = {
  id: 'blender-rendered',
  title: 'Rendered',
  layer: { drawMode: 'rendered' },
};
