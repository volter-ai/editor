/**
 * The SHADING workspace — Blender's own: the 3D viewport over the Shader
 * Editor, with the Outliner above the Properties editor on the right.
 *
 * THE PROPORTIONS ARE BLENDER'S, MEASURED THROUGH bpy on the engine in the
 * tab (2026-09-19), not eyeballed from a screenshot:
 * `bpy.data.workspaces['Shading'].screens[0].areas` answers, in a 1920-wide
 * window, PROPERTIES `x1579 y23 w339 h839`, OUTLINER `x1579 y865 w339 h189`,
 * VIEW_3D `x294 y540 w1282 h514`, NODE_EDITOR `x294 y23 w1282 h514`,
 * FILE_BROWSER `x2 y540 w289 h514` and IMAGE_EDITOR `x2 y23 w289 h514`.
 *
 * AND THE ARRANGEMENT IS A LIVE CAPTURE, not a hand-derived one
 * (`workspace-preset-layouts.ts`: "Shipped defaults are authored by arranging
 * live and snapshotting `toJSON`" — never hand-written JSON). Hand-deriving it
 * from Model's cost exactly what that rule exists to prevent: sizes authored
 * against Model's 928-px grid were applied to an 824-px container, the dock
 * measured `grid 1920×802 in a 1920×824 container` and warned that it was
 * "forcing one relayout" (measured live, 2026-09-19 — and measured again on
 * three Model/Sculpt switches with no Shading in them, which raised nothing,
 * so the warning was this arrangement's own). What ships is the settled grid,
 * with two sizes set back to the measurement: the vertical split to an exact
 * 50/50 of the grid's own height, and the right column to Model's 306/173/755,
 * which is the same column and already carries Blender's 0.177/0.184.
 *
 * Two readings out of that, and both are in `shading-arrangement.json`:
 * the right column is 339/1920 = 0.177 of the window with the Outliner taking
 * 189/1028 = 0.184 of it — the SAME column the Modeling workspace has, which
 * is why this arrangement is Model's with one change; and the centre column is
 * split EXACTLY 50/50, 514 over 514 of the 1031 px between the top bar and the
 * status bar. On the captured 928-px grid that is 464/464, which is the size
 * `vgai:bottom-center` was already carrying at `"visible": false`.
 *
 * WHICH AREA THE SHADER EDITOR IS, AND WHAT IT IS MADE OF. Blender's node
 * editor is the area BELOW the viewport — and an AREA IS AN EDITOR GROUP
 * (orchestrator ruling 2026-09-19), not the bottom utility drawer. So Shading
 * declares it as an `areas` entry holding the `blender-node-editor.document`
 * contribution, the dock puts it in `vgai:area:shader` below the centre at
 * Blender's own 50/50, and the frame's layout host puts the same document in
 * a second VS Code editor group. The drawer is `hidden` here, as it is in
 * Model: Blender's Shading screen has no utility strip.
 *
 * WHAT IS NOT REPRODUCED, named rather than silently dropped: Blender's
 * Shading workspace also carries a File Browser over an Image Editor in a
 * 289-px LEFT column (15.0 % of the window). Neither editor exists here yet —
 * the image/texture view is I5's Texture Paint unit and the asset browser is
 * a different surface — and §Editor chrome's rule is that a reserved panel
 * ships WITH its capability, never as empty chrome. The column arrives with
 * the editors that fill it.
 *
 * THE STRIP GROWS ONLY AS A VIEW LANDS (§Editor chrome; WORK.md I5). Shading
 * appears in the workspace strip because this contribution exists, and this
 * contribution exists because the node view does.
 */

import type { WorkspaceLayoutContribution } from '@volter/editor-sdk/looks';

export const point = 'workspace.layout';
export const layout: WorkspaceLayoutContribution = {
  id: 'shading',
  title: 'Shading',
  description: "Blender-shaped shading: the viewport over the material's node tree, read-only.",
  requires: { documentKind: 'model' },
  // `tabs` unstated, for the reason `model.layout.ts` records: the workspace
  // layer wins over the style bundle, so restating the host default would
  // silently shadow `blender.style.ts`'s `tabs: 'hidden'` and paint a tab row
  // Blender does not have.
  regions: {
    header: 'shown',
    shelf: 'shown',
    inspector: 'properties',
    // THE SAME AS MODEL: no drawer. Blender's Shading screen has no fourth
    // area beyond the viewport, the node editor and the right column, and the
    // node editor is not a drawer utility — it is an AREA, which is an EDITOR
    // GROUP (the ruling below). Leaving the drawer `shown` would paint an
    // empty utility strip Blender's own screen does not have.
    drawer: 'hidden',
  },
  // THE NODE EDITOR IS AN EDITOR GROUP BELOW THE MODEL DOCUMENT.
  //
  // RULED 2026-09-19 (orchestrator): "A Blender editor AREA is an editor
  // group; the drawer holds utilities." Blender's Shading screen splits the
  // centre TOP AND BOTTOM — VIEW_3D `x294 y540 w1282 h514` over NODE_EDITOR
  // `x294 y23 w1282 h514`, measured through bpy on the engine — and both the
  // dock and the Code-OSS frame have exactly that shape in editor groups. So
  // the Shader Editor is a `workspace.document` this workspace opens into
  // `vgai:area:shader`, not a `workspace.utility` in the drawer.
  //
  // AND THAT IS WHAT RETIRED THE DRAWER RACE BY CONSTRUCTION. Switching to UV
  // Editing kept opening the Shader Editor — and the cause was NOT the dock
  // ordering the previous landing named: `uv-editing-arrangement.json`'s
  // mechanical substitution had missed two of the seven occurrences (the
  // panel record's `params.utilityId` and its `title`), so the leaf carrying
  // the UV panel's id rendered the NODE editor and called itself "Shader
  // Editor". A view that is not in the drawer cannot have that defect at all.
  //
  // THE RATIO IS BLENDER'S OWN: 514 of the 1028 px the centre column spans,
  // an exact 0.5 to within the 1-px splitter.
  areas: [{ id: 'shader', document: 'blender-node-editor.document', place: 'below', ratio: 0.5 }],
};
