/**
 * BLENDER'S COLLECTION TAB, as a Properties section (WORK.md §Blender in the
 * tab is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_collection.py` at the
 * engine's pin — `classes` (`:146-155`) is the panel order and `bl_label` the
 * title. Blender's UI layer is never run, ported or recorded.
 *
 * THE FIRST PANEL IS CALLED "VISIBILITY" AT THIS PIN, not "Restrictions":
 * `COLLECTION_PT_collection_flags.bl_label` is `"Visibility"` (`:32`). Its
 * child View Layer (`:47`) does not read the collection at all — it reads
 * `view_layer.active_layer_collection` (`:56`), a different datablock, which
 * the context door now names beside the collection as this tab's second path.
 *
 * TWO CHECKBOXES BLENDER DRAWS INVERTED. `hide_select` is labelled
 * "Selectable" with `invert_checkbox=True` (`:41`) and `exclude` is labelled
 * "Include" the same way (`:60`). What stands here is the RNA's own value
 * under the RNA's own name, because inverting a value in the presentation is
 * exactly the fabrication the anti-shim rule forbids — the same reading the
 * Object tab's Visibility panel already made.
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS: `COLLECTION_PT_importer`
 * (`:65`), whose poll is a PREFERENCE (`prefs.experimental.use_collection_
 * importer`) and whose body is `template_collection_importer()` — an operator
 * template. Exporters (`:80`) is the same widget over `collection.exporters`,
 * and the collection itself is real RNA (`rna_collection.cc:954`), so its row
 * stands. `COLLECTION_PT_collection_custom_props` (`:143`) is IDProperties
 * rather than RNA.
 *
 * It stands when: `buttons_context_path_collection` — the view layer's ACTIVE
 * collection, and never the scene's master collection, which only the engine
 * knows.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_collection.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // COLLECTION_PT_collection_flags, :31.
    title: 'Visibility',
    properties: ['hide_select', 'hide_render'],
    sub: [
      {
        // COLLECTION_PT_viewlayer_flags, :47 — the LayerCollection's.
        title: 'View Layer',
        from: 'View Layer Collection',
        properties: ['exclude', 'holdout', 'indirect_only'],
      },
    ],
  },
  {
    // COLLECTION_PT_instancing, :99.
    title: 'Instancing',
    properties: ['instance_offset'],
  },
  {
    // COLLECTION_PT_lineart_collection, :113 — the mask is drawn as eight
    // indexed toggles (:130); the array row carries all eight.
    title: 'Line Art',
    properties: [
      'lineart_usage',
      'lineart_use_intersection_mask',
      'lineart_intersection_mask',
      'use_lineart_intersection_priority',
      'lineart_intersection_priority',
    ],
  },
  {
    // COLLECTION_PT_exporters, :80.
    title: 'Exporters',
    properties: ['exporters'],
  },
];

const TAB = { id: 'collection', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Collection';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-collection';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 60;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'collection';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
