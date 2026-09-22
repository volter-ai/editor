/**
 * BLENDER'S BONE TAB, as a Properties section (WORK.md §Blender in the tab is
 * Blender, "Inspection parity", I2). Blender's own panels over the RNA door,
 * with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_data_bone.py` at the
 * engine's pin: its `classes` tuple is the panel order, `bl_label` the title,
 * each `layout.prop(bone, "x")` an entry. Blender's UI layer is never run,
 * ported or recorded.
 *
 * TWO DATABLOCKS, AND THAT IS THE WHOLE STRUCTURE OF THIS TAB. Blender's panels
 * read `bone` (the armature's `Bone`, or the `EditBone` in Edit mode) for the
 * rest pose — head, tail, roll, envelope, collections, display — and `pchan`
 * (the `PoseBone`) for the POSE: its location/rotation/scale and its inverse
 * kinematics. `buttons_context_path_bone` and `_pose_bone` build both, and the
 * door hands this tab both as "Bone" and "Pose Bone", so each panel names the
 * one Blender's draw function reads. That is why Transform below is split in
 * two the way `BONE_PT_transform` (:39) is: its first half is `pchan`, its
 * second `bone`.
 *
 * It stands when: `buttons_context_path_bone` — an armature with an ACTIVE bone
 * (the edit bone in Edit mode).
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_data_bone.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // BONE_PT_transform, :39, pose half (:63-99) — drawn in Pose mode.
    title: 'Transform (Pose)',
    from: 'Pose Bone',
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
    // BONE_PT_transform, :39, rest half (:104-110) — the bone's own geometry.
    // NO MATRICES. The first cut named `matrix` and `matrix_local` beside them
    // and the live read showed why Blender does not: a 3x3 and a 4x4 draw as
    // twenty-five numbered rows, which buries the five values the panel is
    // about. They are still in "All properties" beneath, where a matrix is
    // something you go looking for. (`roll` is an EditBone property, so it
    // draws in Edit mode and not in Object mode — the datablock's answer, not
    // a condition of ours.)
    title: 'Transform',
    from: 'Bone',
    properties: ['head', 'tail', 'roll', 'length', 'lock'],
  },
  {
    // BONE_PT_curved, :114 — "Bendy Bones".
    title: 'Bendy Bones',
    closed: true,
    from: 'Bone',
    properties: [
      'bbone_segments',
      'bbone_x',
      'bbone_z',
      'bbone_mapping_mode',
      'use_endroll_as_inroll',
      'use_scale_easing',
      'bbone_handle_type_start',
      'bbone_handle_use_scale_start',
      'bbone_handle_use_ease_start',
      'bbone_handle_type_end',
      'bbone_handle_use_scale_end',
      'bbone_handle_use_ease_end',
    ],
  },
  {
    // BONE_PT_relations, :213.
    title: 'Relations',
    from: 'Bone',
    properties: [
      'parent',
      'children',
      'use_relative_parent',
      'use_connect',
      'use_local_location',
      'use_inherit_rotation',
      'inherit_scale',
    ],
  },
  {
    // BONE_PT_collections, :252 — the collections this bone is in.
    title: 'Bone Collections',
    closed: true,
    from: 'Bone',
    properties: ['collections'],
  },
  {
    // BONE_PT_inverse_kinematics, :430 — every one of these is on the POSE
    // channel, not the bone.
    title: 'Inverse Kinematics',
    closed: true,
    from: 'Pose Bone',
    properties: [
      'ik_stretch',
      'lock_ik_x',
      'lock_ik_y',
      'lock_ik_z',
      'ik_stiffness_x',
      'ik_stiffness_y',
      'ik_stiffness_z',
      'use_ik_limit_x',
      'ik_min_x',
      'ik_max_x',
      'use_ik_limit_y',
      'ik_min_y',
      'ik_max_y',
      'use_ik_limit_z',
      'ik_min_z',
      'ik_max_z',
      'use_ik_rotation_control',
    ],
  },
  {
    // BONE_PT_deform, :535 — `use_deform` is the panel's own header checkbox.
    title: 'Deform',
    closed: true,
    from: 'Bone',
    properties: [
      'use_deform',
      'envelope_distance',
      'envelope_weight',
      'use_envelope_multiply',
      'head_radius',
      'tail_radius',
    ],
  },
  {
    // BONE_PT_display, :304, and BONE_PT_display_custom_shape (:388), whose
    // properties are all on the pose channel.
    title: 'Viewport Display',
    closed: true,
    from: 'Bone',
    properties: ['hide', 'hide_select', 'display_type', 'color', 'show_wire'],
    sub: [
      {
        title: 'Custom Shape',
        closed: true,
        from: 'Pose Bone',
        properties: [
          'custom_shape',
          'custom_shape_translation',
          'custom_shape_rotation_euler',
          'custom_shape_scale_xyz',
          'use_custom_shape_bone_size',
          'custom_shape_transform',
        ],
      },
    ],
  },
];

const TAB = { id: 'bone', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Bone';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-bone';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 130;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
