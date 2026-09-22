/**
 * BLENDER'S MODIFIERS TAB, as a Properties section (WORK.md §Blender in the
 * tab is Blender, "Inspection parity", I2): the STACK, each modifier its own
 * panel with its own settings, with the generic view beneath under "All
 * properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_data_modifier.py` at
 * the engine's pin, and reading it is what decided the shape here. That file
 * is barely a panel list at all: `DATA_PT_modifiers.draw` is `Add Modifier`
 * plus `layout.template_modifiers()`, and the per-modifier panels are built in
 * C from each type's own RNA (`MOD_*.cc`'s `panel_draw`). There is no Python
 * table of sixty modifier types to transcribe — and transcribing one would be
 * a COPY of Blender's layout, which the ruling forbids, and would go stale the
 * first time a modifier gained a property.
 *
 * So the stack is derived instead: each member of `ob.modifiers` is a panel
 * headed by the four toggles every modifier has (`ModifierData`'s own
 * `show_viewport` / `show_render` / `show_in_editmode` / `show_on_cage`,
 * which is the header row `template_modifiers` draws), followed by every
 * property THIS MODIFIER'S OWN struct declares — `andDeclared`, which reads
 * `BlenderRnaRow.group`, RNA's own answer to "which struct declares this".
 * For a Subdivision modifier that is exactly `SubsurfModifier`'s levels,
 * render_levels, quality, uv_smooth and the rest, in RNA's order.
 *
 * The ACTIVE modifier (`buttons_context_path_modifier`, which the door reports
 * as `activeModifier`) is marked, the way Blender outlines the active panel.
 *
 * It stands when: the object's type is in `buttons_context.cc`'s modifier set.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

const CURATED: readonly BlenderCuratedPanel[] = [
  {
    title: 'Modifiers',
    from: 'Modifiers',
    collection: true,
    active: 'activeModifier',
    // `ModifierData`'s own, in the order `template_modifiers` heads a panel
    // with them; everything after these is the type's own (see the header).
    properties: [
      'name',
      'type',
      'show_viewport',
      'show_render',
      'show_in_editmode',
      'show_on_cage',
      'use_pin_to_last',
      'is_active',
    ],
    andDeclared: true,
  },
];

const TAB = { id: 'modifier', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Modifiers';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-modifiers';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 80;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
