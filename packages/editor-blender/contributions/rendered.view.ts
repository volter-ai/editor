/**
 * BLENDER'S RENDERED SHADING: the scene lit by its own lights and its World, drawn behind the
 * model, in AgX — the lighting the document's render photographs with, held on the viewport
 * (`blender-runtime.document.tsx`, `BlenderRuntimeView.holdRendered`). It is the same
 * rasterized approximation of the scene's engine that a render here produces, not a path
 * tracer: the viewport and a render agree because they are one drawing.
 * A named view (`@volter/editor-sdk/kit/viewport-presentation` `ViewPreset`).
 */
import type { ViewPreset } from '@volter/editor-sdk/kit/viewport-presentation';

export const point = 'workspace.view';
export const view: ViewPreset = {
  id: 'blender-rendered',
  title: 'Rendered',
  layer: {
    all: {
      lighting: {
        source: 'scene',
        auto: null,
        tone: { mapper: 'agx', exposure: 1 },
      },
      backdrop: { source: 'scene' },
    },
  },
};
