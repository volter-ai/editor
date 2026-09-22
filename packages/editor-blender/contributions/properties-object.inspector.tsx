/**
 * BLENDER'S OBJECT TAB, as a Properties section (WORK.md §Blender in the tab
 * is Blender, "Inspection parity", I2). The body is Blender's own panels, in
 * Blender's own order, over the RNA door; the generic view of every property
 * the object has stays beneath them under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_object.py`, read at
 * the engine's pin. Its `classes` tuple at the foot of the file is the panel
 * ORDER, each class's `bl_label` the title, each `layout.prop(ob, "x")` an
 * entry below in the order the draw function lists it, and `bl_options =
 * {'DEFAULT_CLOSED'}` a `closed: true`. Blender's UI layer is never run,
 * ported or recorded — the Python is read as a statement of WHICH properties
 * this tab shows, and our widgets draw them from the door's rows.
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS:
 *  - the `poll`/`if` branches. `show_all_edges` is mesh-only in Python; here
 *    it is simply not on a Camera's RNA, so it does not draw. Same outcome,
 *    from the datablock rather than from a copy of Blender's conditions.
 *  - `OBJECT_PT_context_object` (`bl_label = ""`) — the breadcrumb row, which
 *    is the host's identity row here.
 *  - the four panels whose datablock is NOT the object: Motion Paths reads
 *    `ob.animation_visualization` and `ob.motion_path`, Light/Shadow Linking
 *    their collections. The context door names the object, so those are
 *    reached by drilling their POINTER row in the generic view beneath — a
 *    curated panel addresses one of the TAB's own datablocks, and inventing a
 *    second addressing scheme to reach a sub-struct is the kind of machinery
 *    the generic view exists to make unnecessary.
 *
 * It stands when: `buttons_context_path_object` — there is an active object.
 */

import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_object.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // OBJECT_PT_transform, :36. Blender draws the rotation channel that
    // `rotation_mode` selects; all three are listed, and the two the object is
    // not in are still real RNA, so all three draw. That is MORE than Blender
    // shows and it is the honest reading: the door reports what the object
    // holds, and a quaternion object's euler is not a fiction.
    title: 'Transform',
    properties: [
      'location',
      'lock_location',
      'rotation_quaternion',
      'rotation_axis_angle',
      'rotation_euler',
      'lock_rotation_w',
      'lock_rotation',
      'rotation_mode',
      'scale',
      'lock_scale',
    ],
  },
  {
    // OBJECT_PT_delta_transform, :86.
    title: 'Delta Transform',
    closed: true,
    properties: [
      'delta_location',
      'delta_rotation_quaternion',
      'delta_rotation_euler',
      'delta_scale',
    ],
  },
  {
    // OBJECT_PT_relations, :132.
    title: 'Relations',
    closed: true,
    properties: [
      'parent',
      'parent_type',
      'parent_bone',
      'parent_bone_head_tail_factor',
      'parent_vertices',
      'use_parent_final_indices',
      'use_camera_lock_parent',
      'track_axis',
      'up_axis',
      'pass_index',
    ],
  },
  {
    // OBJECT_PT_collections, :185 — a UIList of the collections this object is
    // in. `users_collection` is the RNA behind it.
    title: 'Collections',
    closed: true,
    properties: ['users_collection'],
  },
  {
    // OBJECT_PT_instancing, :284, with OBJECT_PT_instancing_size (:317) as its
    // `bl_parent_id` child.
    title: 'Instancing',
    closed: true,
    properties: [
      'instance_type',
      'use_instance_vertices_rotation',
      'instance_collection',
      'show_instancer_for_viewport',
      'show_instancer_for_render',
    ],
    sub: [
      {
        title: 'Scale by Face Size',
        closed: true,
        properties: ['use_instance_faces_scale', 'instance_faces_scale'],
      },
    ],
  },
  {
    // OBJECT_PT_display, :218.
    title: 'Viewport Display',
    closed: true,
    properties: [
      'show_name',
      'show_axis',
      'show_wire',
      'show_all_edges',
      'show_texture_space',
      'show_in_front',
      'display_type',
      'color',
      'show_bounds',
      'display_bounds_type',
      'display',
    ],
  },
  {
    // OBJECT_PT_shadow_terminator, :602.
    title: 'Shadow Terminator',
    closed: true,
    properties: [
      'shadow_terminator_normal_offset',
      'shadow_terminator_geometry_offset',
      'shadow_terminator_shading_offset',
    ],
  },
  {
    // OBJECT_PT_visibility, :412. Blender draws four of these INVERTED
    // (`invert_checkbox=True`, so "Selectable" is `not hide_select`); the
    // checkbox here is the RNA's own value and its label is the RNA's own
    // name, because inverting a value in the presentation is exactly the
    // fabrication the anti-shim rule forbids.
    title: 'Visibility',
    closed: true,
    properties: [
      'hide_select',
      'hide_surface_pick',
      'hide_viewport',
      'hide_render',
      'visible_camera',
      'visible_shadow',
      'visible_raycast',
      'visible_diffuse',
      'visible_glossy',
      'visible_transmission',
      'visible_volume_scatter',
      'hide_probe_volume',
      'hide_probe_sphere',
      'hide_probe_plane',
      'use_grease_pencil_lights',
      'is_holdout',
    ],
  },
  {
    // OBJECT_PT_lineart, :340 — the panel reads `ob.lineart`, a sub-struct, so
    // what stands here is its POINTER row; the values are one drill down.
    title: 'Line Art',
    closed: true,
    properties: ['lineart'],
  },
  {
    // OBJECT_PT_animation (:631) and OBJECT_PT_custom_props (:635).
    title: 'Animation',
    closed: true,
    properties: ['animation_data'],
  },
];

const TAB = { id: 'object', standing: 'object', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Object';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-object';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 70;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
/** THE TAB THE RAIL OPENS ON. Blender's Properties editor stores its context
 *  per screen in the startup file, and at factory settings the Layout
 *  workspace's is OBJECT:
 *
 *    bpy.data.screens['Layout'].areas[PROPERTIES].spaces[0].context -> 'OBJECT'
 *
 *  (measured against Blender 5.2.0 LTS at `--factory-startup`, walk 5 parity
 *  row 3; the other screens read OBJECT, MODIFIER, WORLD, DATA, TOOL, OUTPUT
 *  and RENDER, so a per-workspace default is the next fidelity step and this
 *  one declaration is the Layout/Model answer). Without it the rail opened on
 *  Render — the first tab in `ED_buttons_tabs_list`'s order — and a person
 *  selecting the cube got Sampling and Light Paths where Blender shows
 *  Transform. */
export const railDefault = true;
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
