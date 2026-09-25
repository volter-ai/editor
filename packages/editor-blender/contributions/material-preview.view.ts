/**
 * BLENDER'S MATERIAL PREVIEW: the scene lit by a world studio light, Forest at strength 1 and
 * rotation 0, drawn over the viewport's own colour (World Opacity 0), in AgX
 * (`DNA_view3d_defaults.h`: `studiolight` forest.exr, `studiolight_intensity` 1,
 * `studiolight_background` 0). Judged against Blender 5.2's own EEVEE render of the default cube
 * with the same world. Not yet: Blender turns this light with the view (World Space Lighting is
 * off by default); here it stays fixed in the world.
 * A named view (`@volter/editor-sdk/kit/viewport-presentation` `ViewPreset`); the images are
 * `blender.environment.ts`'s.
 */
import type { ViewPreset } from '@volter/editor-sdk/kit/viewport-presentation';

export const point = 'workspace.view';
export const view: ViewPreset = {
  id: 'blender-material-preview',
  title: 'Material Preview',
  layer: {
    all: {
      lighting: {
        source: 'preview',
        preview: {
          sun: { enabled: false },
          environment: { enabled: true, image: 'blender:forest', energy: 1, rotation: 0 },
        },
        tone: { mapper: 'agx', exposure: 1 },
      },
      backdrop: { source: 'fill' },
    },
  },
};
