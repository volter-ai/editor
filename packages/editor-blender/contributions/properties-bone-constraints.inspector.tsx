/**
 * BLENDER'S BONE CONSTRAINTS TAB, as a Properties section (WORK.md §Blender in
 * the tab is Blender, "Inspection parity", I2): the active POSE BONE's
 * constraint stack, with the generic view beneath under "All properties".
 *
 * It is the Object Constraints tab over a different datablock, and Blender
 * says so itself: `properties_constraint.py` registers
 * `BONE_PT_constraints` beside `OBJECT_PT_constraints` with the same
 * `template_constraints()` body, differing only in reading
 * `context.pose_bone.constraints`. So it shares the header list that module
 * exports rather than restating it — a second copy is a second thing to keep
 * in step.
 *
 * It stands when: `buttons_context_path_pose_bone` — a pose channel for the
 * active bone, and never in Edit mode.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';
import { CONSTRAINT_HEADER } from './properties-constraints.inspector';

const CURATED: readonly BlenderCuratedPanel[] = [
  {
    title: 'Bone Constraints',
    from: 'Constraints',
    collection: true,
    properties: CONSTRAINT_HEADER,
    andDeclared: true,
  },
];

const TAB = { id: 'bone_constraint', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Bone Constraints';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-bone-constraints';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 140;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
