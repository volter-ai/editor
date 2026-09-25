/**
 * BLENDER'S MATERIAL PREVIEW: the scene lit by a world studio light alone, Forest at strength 1
 * and rotation 0, fixed in the world, drawn over the viewport's own colour, in AgX. Read from
 * Blender 5.2's factory View3DShading: `studio_light` Default (forest.exr),
 * `studiolight_intensity` 1, `studiolight_rotate_z` 0, `studiolight_background_alpha` 0,
 * `use_studiolight_view_rotation` (World Space Lighting) on, `use_scene_lights` off.
 * Measured against Blender 5.2's own EEVEE render of the default cube under the same world
 * with its lamp removed.
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
          sceneLights: false,
          sun: { enabled: false },
          environment: { enabled: true, image: 'blender:forest', energy: 1, rotation: 0 },
        },
        tone: { mapper: 'agx', exposure: 1 },
      },
      backdrop: { source: 'fill' },
    },
  },
};
