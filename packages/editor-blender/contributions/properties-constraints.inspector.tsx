/**
 * BLENDER'S OBJECT CONSTRAINTS TAB, as a Properties section (WORK.md §Blender
 * in the tab is Blender, "Inspection parity", I2): the STACK, each constraint
 * its own panel with its own settings, the generic view beneath under "All
 * properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_constraint.py`, and
 * it has the same shape `properties_data_modifier.py` does: `draw` is
 * `layout.template_constraints()` and the per-type panels are built in C from
 * each constraint's RNA. So the stack is derived the same way — the shared
 * `Constraint` header properties named, then everything THIS constraint's own
 * struct declares (`andDeclared`, which reads `BlenderRnaRow.group`). A Copy
 * Location constraint gets `CopyLocationConstraint`'s target, subtarget, use_x
 * / use_y / use_z, invert flags and offset, in RNA's order.
 *
 * The ACTIVE constraint (`buttons_context_path_constraint`, reported as
 * `activeConstraint`) is marked.
 *
 * It stands when: `buttons_context_path_object` — Constraints shares Object's
 * path, so the engine grants it whenever it grants Object.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** The shared header every constraint panel carries — `Constraint`'s own
 *  properties, in the order `template_constraints` heads a panel with them. */
export const CONSTRAINT_HEADER: readonly string[] = [
  'name',
  'type',
  'enabled',
  'mute',
  'influence',
  'error_location',
  'error_rotation',
  'is_valid',
  'is_override_data',
];

const CURATED: readonly BlenderCuratedPanel[] = [
  {
    title: 'Constraints',
    from: 'Constraints',
    collection: true,
    active: 'activeConstraint',
    properties: CONSTRAINT_HEADER,
    andDeclared: true,
  },
];

const TAB = { id: 'constraint', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Object Constraints';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-constraints';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 110;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
