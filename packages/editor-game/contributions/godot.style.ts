/**
 * THE GODOT LOOK — Godot 4.4's default editor theme and its 3D viewport's
 * colours, made only of values (`docs/VIEWPORT-STAGE.md`, the Godot column).
 *
 * The viewport group transcribes `editor_settings.cpp`: axis X (0.96, 0.20,
 * 0.32), Z (0.16, 0.55, 0.96) — our floor's second axis — and the selection
 * box (1.0, 0.5, 0). The fill is Godot's `default_clear_color` (0.3, 0.3, 0.3),
 * what shows with the preview environment off. The grid's minor and major
 * levels are the primary/secondary grid colours at alpha 0.5, fitted by eye
 * against `engine-reference/godot/tuto_3d3.png` over the preview sky's ground.
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
    density: {
      viewport: {
        // `manipulator_gizmo_size` 80.
        gizmoSize: 80,
        // `manipulator_gizmo_opacity` 0.9; the highlight is the axis colour at a quarter of its
        // saturation and full value (`node_3d_editor_plugin.cpp`).
        gizmoOpacity: 0.9,
        gizmoHighlightSaturation: 0.25,
        gizmoHighlightValue: 1,
        // Godot's grid lines are hairlines at both levels.
        gridLineWidth: 1,
        gridMajorWidth: 1,
        gridMajorContrast: 1.3,
        // Godot's selection is the whole AABB, a hairline.
        selectionBox: 'edges',
        selectionBoxWidth: 1,
      },
    },
  },
  palette,
};
