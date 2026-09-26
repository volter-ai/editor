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
    stage: {
      // THE SCENE VIEW'S OWN CHROME (`NewEmptyScene_01.png`, `PrimitiveCube.png`): the Scene
      // view's toolbar is a flush band with the draw mode first ("Shaded"); the tools are
      // Unity's Tools overlay at the view's left; the view's name is the label under the scene
      // gizmo ("Persp"), which toggles the projection.
      chrome: { bar: 'strip', viewName: 'gizmo', tools: 'shelf', display: 'bar-start' },
      // A handle is 80 points on screen whatever the distance (`HandleUtility.GetHandleSize`,
      // `k_KHandleSize`), the radius of the rotate disc; the stage's ring radius is this many
      // CSS px. The documentation's frames are small Scene views at about half scale, so their
      // arrows look long beside the object; on screen they are these points.
      gizmoSize: 80,
      // Unity's scene gizmo: cones round a grey cube (`Editor-SceneGizmo.png`).
      navigationGizmo: 'cones',
      // `Handles.ArrowHandleCap`: a shaft to 0.9 of the handle and a cone centred at 1.0, scaled
      // 0.2 of it. The cone mesh's own proportions are the editor's resource, so they are read
      // off `TransformGizmo35.png` at 1x: a tip at about 1.1 handles and a cone about 0.25 of
      // the handle long, 1.25 of three's head.
      gizmoArrowLength: 1.1,
      gizmoArrowHead: 1.25,
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
  palette,
};
