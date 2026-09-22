/**
 * BLENDER'S WORLD TAB, as a Properties section (WORK.md §Blender in the tab
 * is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_world.py` at the
 * engine's pin — `classes` (`:266-278`) is the panel order, `bl_label` the
 * title, each `layout.prop(world, "x")` an entry. Blender's UI layer is never
 * run, ported or recorded.
 *
 * SURFACE AND VOLUME ARE A NODE TREE, AND THIS IS NOT THE NODE VIEW.
 * `EEVEE_WORLD_PT_surface` (`:109`) asks the world's node tree for its EEVEE
 * output node and draws that node's `Surface` input with
 * `template_node_view`; Volume (`:140`) is the same call on the `Volume`
 * input. Reading those values as a flat list means walking the tree back
 * through its links, which is I5's read-only node view (§Inspection parity,
 * I5) — half of it here would be a second, worse implementation of the same
 * walk. Exactly the reading the Material tab already made for its own Surface
 * panel. What stands in these two panels is what the WORLD datablock itself
 * holds: `use_nodes` and the `node_tree` pointer, which drills into the
 * generic view, plus the volume flag Blender's own panel reads off the world
 * (`use_eevee_finite_volume`, `:159`).
 *
 * THE TAB'S TONE IS THE SHADING RED. `UI_icons.hh:193` declares WORLD under
 * `DEF_ICON_SHADING`, the same group as Material — corrected from a guess
 * during I2's first landing, and the reason the scene group is four tabs
 * rather than six.
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS: `WORLD_PT_context_world`
 * (`:24`, `bl_label = ""`) — the world ID template, the host's identity row
 * here; the `world.convert_volume_to_mesh` operator (`:165`); and
 * `WORLD_PT_custom_props` (`:99`), IDProperties rather than RNA.
 *
 * It stands when: `buttons_context_path_world` returns true from the scene
 * alone, so the tab stands even when the scene holds no world — and then
 * every panel here finds no datablock and none of them draw.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_world.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // EEVEE_WORLD_PT_surface, :109 — see the header for why this is the
    // world's own node properties rather than the shader's inputs.
    title: 'Surface',
    engine: ['BLENDER_EEVEE'],
    properties: ['use_nodes', 'node_tree'],
  },
  {
    // EEVEE_WORLD_PT_volume, :140.
    title: 'Volume',
    closed: true,
    engine: ['BLENDER_EEVEE'],
    properties: ['use_eevee_finite_volume'],
  },
  {
    // EEVEE_WORLD_PT_mist, :50 — `world.mist_settings` (:63), which the
    // context door names as this tab's second datablock.
    title: 'Mist Pass',
    closed: true,
    from: 'Mist',
    engine: ['BLENDER_EEVEE'],
    properties: ['start', 'depth', 'falloff'],
  },
  {
    // EEVEE_WORLD_PT_settings, :174 — an empty body whose three children
    // carry the properties (`bl_parent_id`).
    title: 'Settings',
    closed: true,
    engine: ['BLENDER_EEVEE'],
    properties: [],
    sub: [
      // EEVEE_WORLD_PT_lightprobe, :189.
      { title: 'Light Probe', properties: ['probe_resolution'] },
      {
        // EEVEE_WORLD_PT_sun, :203, and its child Shadow (:218).
        title: 'Sun',
        properties: ['sun_threshold', 'sun_angle'],
        sub: [
          {
            title: 'Shadow',
            closed: true,
            properties: [
              'use_sun_shadow',
              'use_sun_shadow_jitter',
              'sun_shadow_jitter_overblur',
              'sun_shadow_filter_radius',
              'sun_shadow_maximum_resolution',
            ],
          },
        ],
      },
    ],
  },
  {
    // WORLD_PT_viewport_display, :249 — the one colour the solid viewport
    // shades the world with, which is what our own three.js presenter reads.
    title: 'Viewport Display',
    closed: true,
    properties: ['color'],
  },
  {
    // WORLD_PT_animation, :74.
    title: 'Animation',
    closed: true,
    properties: ['animation_data'],
  },
];

const TAB = { id: 'world', standing: 'any', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'World';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-world';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 50;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'scene';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
