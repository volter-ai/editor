/**
 * THE UNREAL LOOK — Unreal Engine 5's dark editor skin and its Level Editor viewport's
 * colours, made only of values (`docs/VIEWPORT-STAGE.md`, the Unreal column).
 *
 * Unreal is not installed here and its documentation states none of these numbers, so every
 * value is READ from the documentation's frames (`engine-reference/unreal/level-editor.png`,
 * 1920 x 1020), not transcribed from source. The chrome: panels #242424 on a #151515 shell,
 * #0f0f0f fields, the #0f6ece armed-tool blue, #40576f selected rows. The viewport: the
 * selection outline's core #eaa112, about three pixels wide; the Move widget's axes, their
 * brightest unshaded pixels (#c02800, #66a600, #2e75df); the corner triad's pure #ff0000,
 * #00ff00, #0000ff. The fill is black, what an Unreal level with no sky shows.
 * Light, sky and overlays are the VIEW's presentation, not this look's.
 */
import type { StyleContribution } from '@volter/editor-sdk/looks';
import palette from './unreal.palette.json';

export const point = 'workspace.style';
export const style: StyleContribution = {
  id: 'unreal',
  title: 'Unreal',
  paletteId: 'unreal',
  materialId: 'unreal',
  material: {
    id: 'unreal',
    title: 'Unreal',
    description: 'Near-black flat panels, four-pixel corners, pill-shaped viewport toolbar buttons.',
    shape: { small: '4px', medium: '4px', large: '6px', full: '9999px' },
    elevation: {
      small: 'none',
      medium: '0 2px 8px rgba(0,0,0,0.55)',
      large: '0 6px 18px rgba(0,0,0,0.6)',
    },
    stage: {
      // Unreal keeps its widget a constant size on screen; in `level-editor.png` the Move
      // arrows reach 85 to 100 px from the centre sphere. Fitted, not transcribed: the stage's
      // ring radius is this many CSS px, so the 0.85 tip below stands at 94 px.
      gizmoSize: 110,
      // The axis triad in the viewport's bottom-left corner (`level-editor.png`).
      navigationGizmo: 'triad',
      navigationCorner: 'bottom-left',
      navigationSize: 1.3,
      // Unreal's arrows end in slim cones about 14 px long on ~85 px shafts (`level-editor.png`),
      // fitted side by side at 1x.
      gizmoArrowLength: 0.85,
      gizmoArrowHead: 0.8,
      // A hard yellow-orange line about three pixels wide around the whole silhouette; the
      // parts other objects hide are drawn too (dotted in Unreal, behind the table). Widths
      // over 4 widen the blur kernel and the band goes pale and soft (measured: 5 peaks at
      // #dfad6b over the sky), so 3 is the widest solid band the crisp form draws.
      outlineStyle: 'crisp',
      outlineWidth: 3,
      outlineHidden: true,
      gridLineWidth: 1,
      gridMajorWidth: 1,
      gridMajorContrast: 1.3,
    },
  },
  palette,
};
