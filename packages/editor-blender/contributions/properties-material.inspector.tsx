/**
 * BLENDER'S MATERIAL TAB, as a Properties section (WORK.md §Blender in the tab
 * is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_material.py` at the
 * engine's pin — its `classes` tuple is the panel order, `bl_label` the
 * title, each `layout.prop(mat, "x")` an entry. Blender's UI layer is never
 * run, ported or recorded.
 *
 * THE SLOTS LIST IS FIRST, and it is `MATERIAL_UL_matslots` over
 * `ob.material_slots` (`:76`, `EEVEE_MATERIAL_PT_context_material`, whose
 * `bl_label` is empty because in Blender it is the tab's header block rather
 * than a panel). The context door hands it to this tab as its own path, with
 * the ACTIVE slot named separately (`buttons_context_path_material`:
 * `BKE_object_material_get(ob, ob->actcol)`), so the list marks it.
 *
 * SURFACE IS A NODE TREE, AND THIS IS NOT THE NODE VIEW. Blender's Surface
 * panel (`:164`) calls `panel_node_draw`, which walks the material output
 * node's `Surface` input back to the shader that feeds it and draws THAT
 * node's inputs by name. Showing those values as a flat list needs the node
 * tree walked, which is I5's read-only node view (§Inspection parity, I5) —
 * and a half version of it here would be a second, worse implementation of
 * the same walk. What stands in this panel instead is what the MATERIAL
 * itself holds: `use_nodes` and the `node_tree` pointer, which drills into
 * the generic view, plus the settings Blender's own EEVEE panels read off the
 * material datablock directly.
 *
 * It stands when: `buttons_context_path_material` — the object's data holds a
 * `materials` collection (the tab stands even when the active slot is empty).
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_material.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // EEVEE_MATERIAL_PT_context_material, :76 — the slot list. `link` is the
    // slot's own Object/Data toggle, `material` the pointer it holds.
    title: 'Material Slots',
    from: 'Material Slots',
    collection: true,
    active: 'activeMaterial',
    properties: ['name', 'material', 'link', 'slot_index'],
  },
  {
    // EEVEE_MATERIAL_PT_surface, :164 — see the header for why this is the
    // material's own two node properties rather than the shader's inputs.
    title: 'Surface',
    from: 'Material',
    properties: ['use_nodes', 'node_tree', 'surface_render_method', 'use_backface_culling'],
  },
  {
    // EEVEE_MATERIAL_PT_volume (:178) and _displacement (:201) / _thickness
    // (:223), all three of them node-tree panels like Surface; what the
    // material holds for them is its own.
    title: 'Volume',
    closed: true,
    from: 'Material',
    properties: ['volume_intersection_method', 'displacement_method', 'max_vertex_displacement'],
  },
  {
    // EEVEE_MATERIAL_PT_settings (:297) and its two children (:322, :338).
    title: 'Settings',
    closed: true,
    from: 'Material',
    properties: [
      'pass_index',
      'use_backface_culling_shadow',
      'use_backface_culling_lightprobe_volume',
      'use_transparent_shadow',
      'use_transparency_overlap',
      'use_raytrace_refraction',
      'thickness_mode',
      'use_thickness_from_shadow',
    ],
  },
  {
    // MATERIAL_PT_lineart, :377 — reads `mat.lineart`, a sub-struct, so its
    // pointer row stands and the values are one drill down.
    title: 'Line Art',
    closed: true,
    from: 'Material',
    properties: ['lineart'],
  },
  {
    // MATERIAL_PT_viewport, :354 — the three values the solid viewport
    // shades with, which is what our own three.js presenter reads.
    title: 'Viewport Display',
    from: 'Material',
    properties: ['diffuse_color', 'metallic', 'roughness'],
  },
  {
    // MATERIAL_PT_animation, :390-ish (after Line Art in the `classes` tuple).
    title: 'Animation',
    closed: true,
    from: 'Material',
    properties: ['animation_data'],
  },
];

const TAB = { id: 'material', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Material';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-material';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 160;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
