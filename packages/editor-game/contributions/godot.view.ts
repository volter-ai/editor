/**
 * GODOT'S DEFAULT 3D VIEWPORT: its preview sun and procedural sky (the kit's sky, which is
 * Godot's own `ProceduralSkyMaterial` default) under its Filmic curve, the sky as backdrop, an
 * 8-cell grid, all three axis lines with Y vertical, the full selection box, and its Select
 * gizmo's arrows and rings without the extra handles. Judged against `tuto_3d3.png`/`tuto_3d5.png`.
 * A named view (`@volter/editor-sdk/kit/viewport-presentation` `ViewPreset`): what the view does
 * and how it is lit, never its look — pair it with the Godot style for the whole target.
 */
import type { ViewPreset } from '@volter/editor-sdk/kit/viewport-presentation';

export const point = 'workspace.view';
export const view: ViewPreset = {
  id: 'godot',
  title: 'Godot',
  layer: {
    // Godot's editor camera: `editors/3d/default_fov` 70 (`editor_settings.cpp`), vertical — the
    // editor's Camera3D keeps its height.
    camera: { fov: { degrees: 70, axis: 'vertical' } },
    all: {
      lighting: {
        source: 'preview',
        preview: {
          sun: {
            enabled: true,
            color: '#ffffff',
            energy: 1,
            altitude: 60,
            azimuth: 150,
            shadowDistance: 100,
          },
          environment: {
            enabled: true,
            energy: 1,
            rotation: 0,
          },
        },
        tone: {
          mapper: 'filmic',
          exposure: 1,
        },
      },
      backdrop: {
        source: 'environment',
        opacity: 1,
        blur: 0,
      },
    },
    overlays: {
      // No zoom and pan buttons under the gizmo and no camera readout: the engine draws neither.
      navigationControls: false,
      cameraReadout: false,
      grid: {
        visible: true,
        majorEvery: 8,
      },
      selection: {
        outline: false,
        wire: false,
        box: true,
      },
      axes: {
        x: true,
        y: true,
        z: true,
      },
    },
    interaction: {
      transformHandles: {
        scale: false,
        viewRotate: false,
        freeMove: false,
      },
    },
  },
};
