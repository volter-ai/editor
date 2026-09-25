/**
 * UNREAL'S DEFAULT LEVEL VIEWPORT: a preview sky standing in for the level's own, no grid, the
 * outline, the Move tool with its free-move centre, a Z-up LEFT-handed world, and the axis
 * triad as an indicator, and a preview floor taking the sun's shadow. The view's behaviour (tool,
 * handles, axes, world, grid off) is read from `default-interface.png`; the sky, cloud and floor
 * values are FITTED to `level-editor.png` (sampled pixel colours and a side-by-side), not
 * transcribed from Unreal's own BP_Sky_Sphere or floor material.
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
              top: '#566b8c',
              horizon: '#8ea6bf',
              ground: '#2b323b',
              topCurve: 0.1,
              groundCurve: 0.12,
              clouds: { cover: 0.55, opacity: 0.9, scale: 16 },
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
      floor: {
        visible: true,
        color: '#0a1428',
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
