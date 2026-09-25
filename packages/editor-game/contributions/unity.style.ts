/**
 * THE UNITY LOOK — Unity 6's dark editor skin and its Scene view's colours,
 * made only of values (`docs/VIEWPORT-STAGE.md`, the Unity column).
 *
 * The viewport group transcribes UnityCsReference: the fill is the Scene
 * view's flat colour with the skybox off (0.278, 0.278, 0.278); selection is
 * `Handles.selectedColor`'s outline `#ff6600`. The grid (0.5, 0.5, 0.5, 0.4)
 * is fitted against `engine-reference/unity/NewEmptyScene_01.png`: its lines
 * sit about 10 levels over the skybox ground (104, 97, 92). The axis colours, named by the world's axes, are
 * `Handles.xAxisColor`, `yAxisColor` and `zAxisColor`; Unity's floor draws no axis
 * lines, which is its view's presentation (`overlays.axes` all off), not this look's.
 * Light, skybox and overlays are the VIEW's presentation, not this look's.
 */
import type { StyleContribution } from '@volter/editor-sdk/looks';
import palette from './unity.palette.json';

export const point = 'workspace.style';
export const style: StyleContribution = {
  id: 'unity',
  title: 'Unity',
  paletteId: 'unity',
  materialId: 'unity',
  material: {
    id: 'unity',
    title: 'Unity',
    description: 'Flat grey panels, three-pixel control corners, a shadow under popups.',
    shape: { small: '3px', medium: '3px', large: '4px', full: '9999px' },
    elevation: {
      small: 'none',
      medium: '0 2px 8px rgba(0,0,0,0.5)',
      large: '0 6px 18px rgba(0,0,0,0.55)',
    },
    density: {
      viewport: {
        // `HandleUtility.GetHandleSize` keeps a handle a constant size on screen; the stage's
        // px per gizmo unit is fitted, not transcribed: at 128 the move arrows reach ~95 px on
        // a 1x capture, as in `engine-reference/unity/PrimitiveCube.png`.
        gizmoSize: 128,
        // Unity's move arrow is a thin shaft ending at the rotate ring, with a long cone head
        // (`TransformGizmo35.png`, `game-objects-transform-modes.png`).
        gizmoArrowLength: 1.1,
        gizmoArrowHead: 1.2,
        // The axis colours' alpha (`Handles.cs`); hover and drag are fixed colours (the palette).
        gizmoOpacity: 0.93,
        // `SceneViewGrid`: one-pixel lines at both levels, the ten-cell level a little stronger.
        gridLineWidth: 1,
        gridMajorWidth: 1,
        gridMajorContrast: 1.25,
        // Unity's selection outline is a hard orange line about two pixels wide at 1x, around
        // the whole silhouette, occluded parts included (`game-objects-transform-modes.png`,
        // `SceneVisExVisible.png`, where it crosses the rock in front of the structure); at 3
        // device px the crisp line measures one full and one partial pixel on a 1x capture, as there.
        outlineStyle: 'crisp',
        outlineWidth: 3,
        outlineHidden: true,
        // The Selection Wire's alpha: `(94, 119, 155, 64)` (the palette holds its colour).
        wireOpacity: 0.25,
      },
    },
  },
  palette,
};
