/**
 * The UV EDITING workspace — Blender's own: the UV editor BESIDE the 3D
 * viewport, with the Outliner over the Properties editor on the right.
 *
 * THE PROPORTIONS ARE BLENDER'S, MEASURED THROUGH bpy on the engine in the tab
 * (2026-09-19), not eyeballed from a screenshot:
 * `bpy.data.workspaces['UV Editing'].screens[0].areas` answers, in a 1920-wide
 * window, PROPERTIES `x1579 y23 w339 h839`, OUTLINER `x1579 y865 w339 h189`,
 * IMAGE_EDITOR `x2 y23 w786 h1031` with `SpaceImage.mode == 'UV'`, and VIEW_3D
 * `x791 y23 w785 h1031`.
 *
 * Three readings out of that:
 *  - the right column is the SAME column Modeling and Shading have — 339/1920
 *    = 0.177 of the window, the Outliner taking 189/1028 = 0.184 of it — which
 *    is why this arrangement is Model's with one change;
 *  - the centre is split SIDE BY SIDE, not top-and-bottom: 786 and 785 of the
 *    1571 px left of the right column, an exact 50/50 to within the 1-px
 *    splitter. This is the FIRST I5 workspace whose editor is not Blender's
 *    bottom area — Shading's node editor is (`workspace-regions.ts` says so
 *    where it explains why Model hides the bottom strip), and the UV editor is
 *    a left half of the centre;
 *  - the UV editor opens in UV mode, which is what makes its title "UV Editor"
 *    rather than "Image Editor".
 *
 * WHICH REGION THE UV EDITOR IS — and the deviation this file used to record
 * is GONE, because the ruling removed its cause. It said: this host has ONE
 * utility region, the bottom area, so a utility could not claim a leaf beside
 * the centre and the UV editor took the bottom at the height Blender gives
 * its width. **RULED 2026-09-19 (orchestrator): a Blender editor AREA is an
 * editor group; the drawer holds utilities.** The UV editor is not a utility
 * at all now — it is a `workspace.document` this workspace opens into
 * `vgai:area:uv`, LEFT of the model document at Blender's own 786/1571, and
 * under the frame the layout host puts the same document in a second VS Code
 * editor group. Nothing is deviating and nothing is owed to U10 here.
 *
 * WHAT IS NOT REPRODUCED, also named: Blender's UV editor shows the IMAGE
 * behind the tile. Measured on both probe files — `arena-weapons.blend` has
 * four materials, all `use_nodes`, and NOT ONE image texture node; the whole
 * file has zero images, as does `arena-vanguard.blend` — so there is nothing
 * for a backdrop to show and the view says so in its own warning rather than
 * implying an empty tile is a drawn one.
 *
 * THE STRIP GROWS ONLY AS A VIEW LANDS (§Editor chrome; WORK.md I5). UV
 * Editing appears in the workspace strip because this contribution exists, and
 * this contribution exists because the UV view does.
 */

import type { WorkspaceLayoutContribution } from '@volter/editor-sdk/looks';

export const point = 'workspace.layout';
export const layout: WorkspaceLayoutContribution = {
  id: 'uv-editing',
  title: 'UV Editing',
  description: "Blender-shaped UV editing: the viewport beside the mesh's UV layout, read-only.",
  requires: { documentKind: 'model' },
  // `tabs` unstated, for the reason `model.layout.ts` records: the workspace
  // layer wins over the style bundle, so restating the host default would
  // silently shadow `blender.style.ts`'s `tabs: 'hidden'` and paint a tab row
  // Blender does not have.
  regions: {
    header: 'shown',
    shelf: 'shown',
    inspector: 'properties',
    // No drawer: Blender's UV Editing screen is four areas and none of them
    // is a utility strip. The UV editor is an AREA — an editor GROUP — below.
    drawer: 'hidden',
  },
  // THE UV EDITOR IS AN EDITOR GROUP TO THE LEFT OF THE MODEL DOCUMENT.
  //
  // RULED 2026-09-19 (orchestrator): "A Blender editor AREA is an editor
  // group; the drawer holds utilities." Blender's UV Editing screen splits the
  // centre SIDE BY SIDE, with the image editor on the LEFT: IMAGE_EDITOR
  // `x2 y23 w786 h1031` (mode `UV`) and VIEW_3D `x791 y23 w785 h1031`,
  // measured through bpy on the engine in a 1920-wide window.
  //
  // THE RATIO IS 786 of the 1571 px left of the 339-px right column — 0.5003,
  // an exact half to within the 1-px splitter. It is stated to four places
  // because it is a measurement, not a preference; the dock uses it once, to
  // size the group the first time this workspace stands up, and a capture of
  // the settled grid wins afterwards.
  areas: [{ id: 'uv', document: 'blender-uv-editor.document', place: 'left', ratio: 0.5003 }],
  // THE ARRANGEMENT IS A LIVE CAPTURE, re-taken 2026-09-19 after the areas
  // ruling. The one it replaced was Shading's capture with the node view's
  // utility id substituted by hand — and that substitution MISSED TWO of the
  // seven occurrences: the panel record's `params.utilityId` and its `title`
  // both still said `blender-node-editor.utility` / "Shader Editor", so the
  // leaf keyed by the UV panel's id rendered the NODE editor. That is the
  // whole of the "switching to UV Editing opens the Shader Editor" defect the
  // previous landing recorded as a dock ordering race; it was a bad derived
  // blob, which is exactly what `workspace-preset-layouts.ts` forbids
  // ("shipped defaults are authored by arranging live and snapshotting
  // `toJSON` — never hand-written JSON"). This one is captured.
};
