/**
 * THE GODOT LOOK — Godot 4.4's default editor theme and its 3D viewport's
 * colours, made only of values (`docs/VIEWPORT-STAGE.md`, the Godot column).
 *
 * The viewport group transcribes Godot's axis colours (`theme_modern.cpp`): X (0.96, 0.20,
 * 0.32), Y (0.53, 0.84, 0.01) and Z (0.16, 0.55, 0.96), named by the world's axes; and the selection
 * box (1.0, 0.5, 0). The fill is Godot's `default_clear_color` (0.3, 0.3, 0.3),
 * what shows with the preview environment off. The grid's minor and major
 * levels are the primary/secondary grid colours at alpha 0.5, fitted against
 * `engine-reference/godot/tuto_3d3.png` over the preview sky's ground: a line
 * there peaks near (95, 91, 87) over a (62, 51, 40) floor.
 * Light, sky and overlays are the VIEW's presentation, not this look's.
 */
import type { StyleContribution } from '@volter/editor-sdk/looks';
import palette from './godot.palette.json';

export const point = 'workspace.style';
export const style: StyleContribution = {
  id: 'godot',
  title: 'Godot',
  paletteId: 'godot',
  materialId: 'godot',
  material: {
    id: 'godot',
    title: 'Godot',
    description: 'Flat blue-grey panels, three-pixel corners, a soft shadow under popups.',
    shape: { small: '3px', medium: '3px', large: '4px', full: '9999px' },
    elevation: {
      small: 'none',
      medium: '0 3px 10px rgba(0,0,0,0.45)',
      large: '0 6px 18px rgba(0,0,0,0.5)',
    },
    stage: {
      // Godot's `manipulator_gizmo_size` is 80, but its unit is not ours: the stage's px per
      // gizmo unit is fitted, not transcribed. At 128 the rotation rings measure ~80 px in
      // radius on a 1x capture, against ~85 px in `engine-reference/godot/tuto_3d5.png`.
      gizmoSize: 128,
      // The move arrows reach 1.6 ring radii with a head about half again three's
      // (`tuto_3d5.png`: a 142 px tip against a 90 px ring, a 25 px head).
      gizmoArrowLength: 1.6,
      gizmoArrowHead: 1.5,
      // Its rotation rings are about twice three's thickness (`tuto_3d5.png`).
      gizmoRingWidth: 2,
      // `manipulator_gizmo_opacity` 0.9; the highlight is the axis colour at a quarter of its
      // saturation and full value (`node_3d_editor_plugin.cpp`).
      gizmoOpacity: 0.9,
      // Its orientation gizmo is its own (`ViewportRotationControl::_draw_axis`): opacity by
      // depth, darkened negatives, no mix toward the viewport (the editor's `godot` form).
      navigationGizmo: 'godot',
      gizmoHighlightSaturation: 0.25,
      gizmoHighlightValue: 1,
      // Godot's grid lines are hairlines at both levels.
      gridLineWidth: 1,
      gridMajorWidth: 1,
      gridMajorContrast: 1.3,
      // Godot's selection is the whole AABB. Its edge is one solid pixel at 1x
      // (`tuto_3d5.png`); our screen-space line needs 2 to cover one captured pixel.
      selectionBox: 'edges',
      // Godot's box turns with the object: its AABB in the object's own frame.
      selectionBoxFrame: 'object',
      selectionBoxWidth: 2,
    },
  },
  palette,
};
