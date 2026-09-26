/**
 * UNITY'S DEFAULT SCENE VIEW: its procedural sky with a narrow horizon band (colours fitted to
 * `NewEmptyScene_01.png`, not transcribed), the grid, no axis lines, the outline alone, the Move
 * tool without a free-move centre.
 * A named view (`@volter/editor-sdk/kit/viewport-presentation` `ViewPreset`): what the view does
 * and how it is lit, never its look — pair it with the Unity style for the whole target.
 */
import type { ViewPreset } from '@volter/editor-sdk/kit/viewport-presentation';

export const point = 'workspace.view';
export const view: ViewPreset = {
  id: 'unity',
  title: 'Unity',
  layer: {
    // Unity's Scene camera: `kDefaultPerspectiveFov` 60, vertical when the view is wider than tall
    // and horizontal otherwise (`SceneView.GetVerticalFOV`) — on its smaller side.
    camera: { fov: { degrees: 60, axis: 'smaller' } },
    all: {
      lighting: {
        source: 'preview',
        preview: {
          sun: {
            enabled: true,
            color: '#fff4d6',
            energy: 1,
            altitude: 50,
            azimuth: 150,
            shadowDistance: 100,
          },
          environment: {
            enabled: true,
            sky: {
              top: '#4a84c2',
              horizon: '#f0ffff',
              ground: '#68615c',
              topCurve: 0.04,
              groundCurve: 0.003,
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
      grid: {
        visible: true,
        majorEvery: 10,
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
        freeMove: false,
      },
    },
  },
};
