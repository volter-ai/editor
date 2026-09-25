/*---------------------------------------------------------------------------------------------
 *  A VIEW'S SURFACE COLOUR IS ITS OWN THEME COLOUR — WORK.md §The core is Code-OSS U8,
 *  ruling (2), 2026-09-19.
 *
 *  I5 left this open, and named the exact symptom: the node editor's area fill is `#1a1a1a`
 *  (Blender's `TH_BACK`) while the dock group around it is `surface.panel` `#303030`, and the
 *  node editor could not have its own — `EDITOR_REGION_NAMES` carries `outliner` and
 *  `properties` and no `node`, and a UTILITY cannot claim a region the way a static panel can.
 *
 *  The ruling retired the question rather than widening the region table: regions go with the
 *  dock at U10, a view container is where a view lives, and a view's BACKDROP is a
 *  `registerColor` theme colour the theme extension sets per look. So there is no region claim
 *  to make — there is a colour id, and `extensions/theme-blender` gives it Blender's traced
 *  value while Classic leaves it unset and our panels' own stylesheet paints, which is exactly
 *  what "Classic's reference frame is our panels with no look declared" means.
 *
 *  WHY THE DEFAULTS ARE NULL. A `registerColor` default of `null` resolves to no colour at all,
 *  so an unthemed workbench applies NOTHING and the pane keeps whatever our stylesheet gives
 *  it. A default of, say, `#303030` here would make Classic wear a Blender value under a
 *  different name — the "host default versus skew" rule read backwards.
 *
 *  WHY THE TABLE IS FILLED AT LOAD. `registerColor` is a load-time registry (a colour has to
 *  exist before a theme can name it), while which utilities exist is a runtime fact. So the
 *  ids are a small fixed set registered at load — the KIT's generic one here, a product's own
 *  in the product's contribution — and a view without an entry falls back to the generic one;
 *  adding a view's own backdrop is adding a row, which is also what makes it a reviewable
 *  claim ("this surface reads differently from a panel") rather than a per-view free-for-all.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../../../base/common/color.js';
import { localize } from '../../../../nls.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { IColorTheme } from '../../../../platform/theme/common/themeService.js';

/** Every vgai view's body, unless its own id below overrides it. */
export const vgaiViewBackground = registerColor('vgai.view.background',
	{ dark: null, light: null, hcDark: null, hcLight: null },
	localize('vgaiViewBackground', "The backdrop of a vgai view's body (Outliner, Properties, and every drawer utility without its own colour). Unset by default, so an unthemed workbench leaves the panel's own stylesheet to paint it."));

/**
 * WHICH VIEW GETS WHICH COLOUR, by the utility's own id. A row here is a CLAIM that the
 * surface reads differently from a panel, made once and reviewable; everything else resolves
 * to {@link vgaiViewBackground}.
 *
 * THE ROWS ARE THE PRODUCT'S, because the utility and the colour both are: the one row that
 * ever existed is the Blender node editor's `#1a1a1a` inside a `#303030` panel, contributed by
 * `@vgai/blender` and themed by the model editor's own `theme-blender`. A product registers
 * its colour id and its row at LOAD, which is when `registerColor` accepts one — the product's
 * contribution is imported above the kit's for exactly this kind of reason.
 */
const VIEW_COLORS = new Map<string, string>();

/** Claim a distinct backdrop for one view, by the utility's own id. */
export function registerViewBackground(utilityId: string, colorId: string): void {
	VIEW_COLORS.set(utilityId, colorId);
}

/**
 * The colour a view's body should wear, or `undefined` when the active theme sets neither its
 * own nor the generic one — which is the Classic case and means "paint nothing".
 */
export function viewBackgroundFor(theme: IColorTheme, utilityId: string): Color | undefined {
	const own = VIEW_COLORS.get(utilityId);
	return (own ? theme.getColor(own) : undefined) ?? theme.getColor(vgaiViewBackground) ?? undefined;
}

/*---------------------------------------------------------------------------------------------
 *  THE 3D VIEWPORT'S COLOURS ARE THEME COLOURS TOO — U8's ruling (2) carried to the stage.
 *
 *  A look's palette names them (`color.viewport`, `color.gizmo`, `@volter/editor-sdk`'s
 *  `EditorTheme`), and the editor hands them to the frame as colour customizations
 *  (`vgaiSettings.ts`, the look's own layer); the workbench emits each as `--vscode-<id>` and
 *  the stage reads that first (`native-selection-style.ts`). So a person's own
 *  `workbench.colorCustomizations` reach the viewport the way they reach any canvas Code-OSS
 *  draws (the terminal's ANSI colours are the precedent), and a colour theme a build ships can
 *  set them. NULL defaults, as above: an unthemed workbench sets nothing and the stage keeps
 *  its own. The ids are the palette's own names, one to one.
 *--------------------------------------------------------------------------------------------*/
registerColor('vgai.viewport.background', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiViewportBackground', "The 3D viewport's backdrop."));
registerColor('vgai.viewport.grid', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiViewportGrid', "The 3D viewport's floor grid."));
registerColor('vgai.viewport.axisX', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiViewportAxisX', "The world's X axis line."));
registerColor('vgai.viewport.axisY', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiViewportAxisY', "The world's Y axis line."));
registerColor('vgai.viewport.axisZ', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiViewportAxisZ', "The world's Z axis line."));
registerColor('vgai.viewport.selection', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiViewportSelection', "A selected object's outline and marks."));
registerColor('vgai.viewport.active', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiViewportActive', "The active object's outline."));
registerColor('vgai.viewport.wire', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiViewportWire', "A selected object's wire."));
registerColor('vgai.gizmo.x', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiGizmoX', "The gizmos' X axis."));
registerColor('vgai.gizmo.y', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiGizmoY', "The gizmos' Y axis."));
registerColor('vgai.gizmo.z', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiGizmoZ', "The gizmos' Z axis."));
registerColor('vgai.gizmo.navigationX', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiGizmoNavigationX', "The navigation gizmo's X, where it differs from the gizmos'."));
registerColor('vgai.gizmo.navigationY', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiGizmoNavigationY', "The navigation gizmo's Y, where it differs from the gizmos'."));
registerColor('vgai.gizmo.navigationZ', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiGizmoNavigationZ', "The navigation gizmo's Z, where it differs from the gizmos'."));
registerColor('vgai.gizmo.hover', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiGizmoHover', "A gizmo handle under the pointer, where the look names a fixed colour."));
registerColor('vgai.gizmo.drag', { dark: null, light: null, hcDark: null, hcLight: null }, localize('vgaiGizmoDrag', "A gizmo handle being dragged, where the look names a fixed colour."));
