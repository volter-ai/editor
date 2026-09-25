/**
 * The MODEL workspace — Blender-shaped modeling: a dominant document, outliner
 * above properties (`@volter/editor-sdk/looks`, a `workspace.layout`
 * contribution). Its arrangement carries Blender 5.2's own MODELING-workspace
 * proportions; `../src/layouts.tsx` states the measurement and the host's
 * fixed-pane clamp that bounds it.
 */

import type { WorkspaceLayoutContribution } from '@volter/editor-sdk/looks';
import { BLENDER_REGIONS } from '../src/regions';

export const point = 'workspace.layout';
export const layout: WorkspaceLayoutContribution = {
  id: 'model',
  title: 'Model',
  description: 'Blender-shaped modeling: a dominant document, outliner above properties.',
  // No `tabs` here: the workspace layer sits above the person's own choice
  // (`workspace-regions.ts`), so a stated region shadows it. Leave a region
  // unstated unless this workspace genuinely needs it different from the host
  // default.
  // Blender's areas beneath this workspace's own (`../src/regions.ts`).
  regions: {
    ...BLENDER_REGIONS,
    header: 'shown',
    shelf: 'shown',
    inspector: 'properties',
    drawer: 'hidden',
  },
  // THE TIMELINE IS THE BOTTOM AREA (owner, 2026-09-20: "doesn't blender have
  // a timeline at the bottom?"). It does — and the workspace this Model
  // document stands in is Blender's LAYOUT screen for us, not its Modeling
  // one: Layout is the four-area screen with the Timeline, and Modeling is the
  // same screen WITHOUT it (measured below).
  //
  // THE PROPORTION IS BLENDER'S OWN, measured through bpy on the installed
  // Blender 5.2.1 at factory settings in a 1920-wide window
  // (`bpy.data.workspaces['Layout'].screens[0].areas`):
  //
  //   PROPERTIES        x1579 y23  w339  h839
  //   OUTLINER          x1579 y865 w339  h189
  //   DOPESHEET_EDITOR  x2    y23  w1574 h74    ui_type TIMELINE  ← this area
  //   VIEW_3D           x2    y100 w1574 h954
  //
  // and the same screen at a 1600×929 window gives the Timeline 63 of an
  // 880-px centre column. Both are the same ratio to three places: 74/1029 =
  // 0.0719 and 63/880 = 0.0716. The Modeling screen's own reading, for the
  // contrast: VIEW_3D `x2 y23 w1574 h1031` and no DOPESHEET area at all.
  //
  // It is stated to four places because it is a measurement, not a preference;
  // the dock uses it once, to size the group the first time this workspace
  // stands up, and a capture of the settled grid wins afterwards.
  areas: [{ id: 'timeline', document: 'blender-timeline.document', place: 'below', ratio: 0.0719 }],
};
