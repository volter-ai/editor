/**
 * UNREAL'S DEFAULT LEVEL VIEWPORT: a preview sky standing in for the level's own, no grid, the
 * outline, the Move tool with its free-move centre, a Z-up LEFT-handed world, and the axis
 * triad as an indicator. Read from `default-interface.png` (no clouds yet).
 * A named view (`@volter/editor-sdk/kit/viewport-presentation` `ViewPreset`): what the view does
 * and how it is lit, never its look — pair it with the Unreal style for the whole target.
 */
import type { ViewPreset } from '@volter/editor-sdk/kit/viewport-presentation';

export const point = 'workspace.view';
export const view: ViewPreset = {
  id: 'unreal',
  title: 'Unreal',
  layer: {
    all: {
      lighting: {
        source: 'preview',
        preview: {
          sun: {
            enabled: true,
            color: '#ffffff',
            energy: 2.5,
            altitude: 45,
            azimuth: 300,
            shadowDistance: 100,
          },
          environment: {
            enabled: true,
            sky: {
              top: '#7488a3',
              horizon: '#8ea6c0',
              ground: '#28313d',
              topCurve: 0.1,
              groundCurve: 0.12,
            },
            energy: 1,
            rotation: 0,
          },
        },
        tone: {
          mapper: 'none',
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
      navigation: 'indicator',
      grid: {
        visible: false,
      },
      selection: {
        outline: true,
        wire: false,
        box: false,
      },
      axes: {
        x: false,
        y: false,
        z: false,
      },
    },
    interaction: {
      bootTool: 'move',
      transformHandles: {
        scale: false,
        viewRotate: false,
        freeMove: true,
      },
    },
    world: {
      upAxis: 'z',
      handedness: 'left',
    },
  },
};
