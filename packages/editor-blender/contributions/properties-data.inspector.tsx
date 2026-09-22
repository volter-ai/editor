/**
 * BLENDER'S OBJECT DATA TAB, as a Properties section (WORK.md §Blender in the
 * tab is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view of the whole datablock beneath under "All
 * properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_data_mesh.py`, read
 * at the engine's pin: its `classes` tuple is the panel ORDER, each class's
 * `bl_label` the title, each `layout.prop(me, "x")` an entry in the order the
 * draw function lists it, `bl_options = {'DEFAULT_CLOSED'}` a `closed`, and a
 * `template_list` a `collection` panel. Blender's UI layer is never run,
 * ported or recorded.
 *
 * ONE TAB, MANY DATA TYPES, ONE LIST. `buttons_context_path_data` builds this
 * tab for whatever the object's data IS, so the same section draws a Mesh, an
 * Armature, a Camera or a Light — and the panels for all of them live in one
 * list here, because a panel draws only where its properties exist. A Camera's
 * data carries no `remesh_mode`, so the Remesh panel finds nothing and renders
 * nothing; an Armature's carries no `uv_layers` and every mesh panel stands
 * down for it. That is the same answer `MeshButtonsPanel.poll` /
 * `ArmatureButtonsPanel.poll` give, from the datablock rather than from a copy
 * of their conditions — which is why there is no per-type branch in this file
 * and no second module per data type.
 *
 * NO "NORMALS" PANEL: the brief expected one and 5.2 does not have it. The
 * mesh's `DATA_PT_normals` was folded away before this pin — `has_custom_normals`
 * survives as the Geometry Data panel's operator condition (`:456`), and the
 * shading-per-face data now lives on the Attributes list. Stated rather than
 * invented.
 *
 * It stands when: `buttons_context_path_data` — the object HAS data (an Empty
 * usually has none).
 */
import type { ToolContributionNode } from '@volter/editor-sdk/contributions';
import { blenderPropertiesState, resolveBlenderSubject } from './blender-properties-model';
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_data_mesh.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // DATA_PT_vertex_groups, :198 — `template_list` over `ob.vertex_groups`,
    // then the active group's name and lock (`MESH_UL_vgroups.draw_item`,
    // :127). The door hands this tab the object's collection as its own path
    // because a vertex group lives on the OBJECT, not on the mesh.
    title: 'Vertex Groups',
    from: 'Vertex Groups',
    collection: true,
    active: 'activeVertexGroup',
    properties: ['name', 'index', 'lock_weight'],
  },
  {
    // DATA_PT_shape_keys, :300 — `template_list` over `key.key_blocks`, with
    // each key's value and slider range (:282-294). The door names the Key
    // datablock; its `key_blocks` is the list.
    title: 'Shape Keys',
    from: 'Shape Keys',
    properties: ['key_blocks', 'use_relative', 'eval_time', 'reference_key'],
  },
  {
    // DATA_PT_uv_texture, :377 — `template_list` over `mesh.uv_layers`
    // (`MESH_UL_uvmaps.draw_item`, :135: the name and `active_render`).
    title: 'UV Maps',
    properties: ['uv_layers'],
  },
  {
    // DATA_PT_vertex_colors, :683 — `mesh.color_attributes`.
    title: 'Color Attributes',
    properties: ['color_attributes'],
  },
  {
    // DATA_PT_mesh_attributes, :545 — `mesh.attributes`.
    title: 'Attributes',
    properties: ['attributes'],
  },
  {
    // DATA_PT_texture_space, :173.
    title: 'Texture Space',
    closed: true,
    properties: ['texture_mesh', 'use_auto_texspace', 'texspace_location', 'texspace_size'],
  },
  {
    // DATA_PT_remesh, :403.
    title: 'Remesh',
    closed: true,
    properties: [
      'remesh_mode',
      'remesh_voxel_size',
      'remesh_voxel_adaptivity',
      'use_remesh_fix_poles',
      'use_remesh_preserve_volume',
      'use_remesh_preserve_attributes',
    ],
  },
  {
    // DATA_PT_customdata, :435, titled "Geometry Data". Its body is FIVE
    // OPERATORS and one condition (`has_custom_normals`, :456) — no
    // properties at all. Inspection parity is not editing parity
    // (ARCHITECTURE-CORE §Blender north star), so what stands here is the
    // condition the operators branch on, which is the only thing in the panel
    // a reader can learn something from.
    title: 'Geometry Data',
    closed: true,
    properties: ['has_custom_normals', 'total_vert_sel', 'total_edge_sel', 'total_face_sel'],
  },
  {
    // DATA_PT_mesh_animation, :461 — and DATA_PT_armature_animation, the same
    // panel on an armature.
    title: 'Animation',
    closed: true,
    properties: ['animation_data'],
  },

  // ---- `properties_data_armature.py`, for an ARMATURE's data. Same tab,
  // same path, and each of these finds nothing on a mesh.
  {
    // DATA_PT_pose, :44 — Rest Position / Pose Position.
    title: 'Pose',
    properties: ['pose_position'],
  },
  {
    // DATA_PT_bone_collections, :101 — `template_list` over
    // `arm.collections_all`. The door also hands this tab the armature's BONES
    // as a path of its own, which the next panel lists.
    title: 'Bone Collections',
    closed: true,
    properties: ['collections_all', 'collections'],
  },
  {
    // The armature's bones, which `buttons_context_path_data` puts on this
    // tab's path list (`session.py::rna_context`) because Blender's Object
    // Data tab is where an armature's skeleton is read. Blender itself draws
    // them in the Outliner and the viewport rather than as a Properties list;
    // this is the one panel here that is OURS, and it is named so.
    title: 'Bones',
    from: 'Bones',
    collection: true,
    active: 'activeBone',
    properties: ['name', 'parent', 'use_connect', 'use_deform', 'head', 'tail', 'length'],
  },
  {
    // DATA_PT_display, :55 (armature).
    title: 'Viewport Display',
    closed: true,
    properties: [
      'display_type',
      'show_names',
      'show_bone_custom_shapes',
      'show_bone_colors',
      'show_axes',
      'axes_position',
      'relation_line_position',
    ],
  },
  {
    // DATA_PT_iksolver_itasc, :192.
    title: 'Inverse Kinematics',
    closed: true,
    properties: ['pose'],
  },
];

const TAB = { id: 'data', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Object Data';

/**
 * THE DATA TAB'S GLYPH IS PER OBJECT TYPE, and it is the one tab in the rail
 * that is. `buttons_context_items` gives it `ICON_NONE`
 * (`makesrna/intern/rna_space.cc:595`) because `buttons_context_compute`
 * fills it in at read time: `sbuts->dataicon = RNA_struct_ui_icon(ptr->type)`
 * over the data on the context path, with Light special-cased to
 * `ICON_OUTLINER_DATA_LIGHT` (`space_buttons/buttons_context.cc:795-810`).
 * So a mesh's tab is the MESH_DATA triangle, an armature's the ARMATURE_DATA
 * figure, a camera's the camera body.
 *
 * Each key below is the RNA STRUCT's own `bl_rna.identifier` — which is what
 * `rna_context` reports as `active.dataType` — and each value is the glyph
 * traced from the icon that struct's `RNA_def_struct_ui_icon` call names.
 */
const DATA_GLYPHS: Readonly<Record<string, string>> = {
  Mesh: 'properties-data-mesh', // rna_mesh.cc:2916      ICON_MESH_DATA
  Armature: 'properties-data-armature', // rna_armature.cc:2191  ICON_ARMATURE_DATA
  Curve: 'properties-data-curve', // rna_curve.cc:1685     ICON_CURVE_DATA
  SurfaceCurve: 'properties-data-surface', // ICON_SURFACE_DATA
  MetaBall: 'properties-data-meta', // rna_meta.cc:331       ICON_META_DATA
  TextCurve: 'properties-data-font', // ICON_FONT_DATA
  Lattice: 'properties-data-lattice', // rna_lattice.cc:337    ICON_LATTICE_DATA
  Camera: 'properties-data-camera', // rna_camera.cc:741     ICON_CAMERA_DATA
  Light: 'properties-data-light', // special-cased above   ICON_OUTLINER_DATA_LIGHT
  Speaker: 'properties-data-speaker', // rna_speaker.cc:40     ICON_SPEAKER
  PointCloud: 'properties-data-pointcloud', // rna_pointcloud.cc:174 ICON_POINTCLOUD_DATA
  Volume: 'properties-data-volume', // rna_volume.cc:278     ICON_VOLUME_DATA
};

/**
 * The host reads either a NAME or a function of the subject
 * (`tool-loader.ts`'s `LoadedToolContributionBase.icon`). The type comes from
 * the context the door last answered for this subject — the same read every
 * tab's `match()` drives — so no extra engine call happens to paint a glyph,
 * and before the first answer lands the tab draws the mesh mark, which is what
 * Blender shows for the starter cube.
 */
export const icon = (node: ToolContributionNode | null, adapter: unknown): string => {
  const subject = resolveBlenderSubject(node, adapter);
  if (subject === null || subject.kind !== 'object') return 'properties-data';
  const state = blenderPropertiesState();
  if (state.object !== subject.name) return 'properties-data';
  const type = state.context?.active?.dataType;
  // An object with no data at all draws Blender's EMPTY_DATA — though the tab
  // itself does not stand for one (`buttons_context_path_data` fails), so this
  // arm is what a type this table has no row for falls back to rather than a
  // state the rail normally shows.
  if (type === null || type === undefined) return 'properties-data-empty';
  return DATA_GLYPHS[type] ?? 'properties-data';
};

/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 120;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
