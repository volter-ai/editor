/**
 * BLENDER'S SCENE TAB, as a Properties section (WORK.md §Blender in the tab
 * is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_scene.py` at the
 * engine's pin — its `classes` tuple (`:471-488`) is the panel order,
 * `bl_label` the title, each `layout.prop(scene, "x")` an entry in the order
 * the draw function lists it, `bl_options = {'DEFAULT_CLOSED'}` a `closed`
 * and `bl_parent_id` a `sub`. Blender's UI layer is never run, ported or
 * recorded.
 *
 * SEVERAL OF THESE PANELS DRAW A SUB-STRUCT RATHER THAN THE SCENE: Units is
 * `scene.unit_settings`, Rigid Body World is `scene.rigidbody_world`, Light
 * Probes is `scene.eevee`. The context door names each of those beside the
 * scene as one of this tab's own datablocks (`session.py::rna_context`), the
 * way it already named the Output tab's `image_settings`, and each panel says
 * which it reads with `from`. An absent one — a file with no rigid body world
 * — is an absent path, and the panel does not draw: the same answer
 * `RigidBodySubPanel.poll` gives (`:361-367`), from the door rather than from
 * a copy of its condition.
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS:
 *  - `SCENE_PT_context_scene` (`:37`, `bl_label = ""`) — the scene ID
 *    template, which is the host's identity row here.
 *  - the operator rows: `rigidbody.world_add`/`_remove` (`:357-359`), the
 *    keying-set list's add/remove, `object.lightprobe_cache_bake` (`:447`).
 *    Inspection parity, not editing parity (ARCHITECTURE-CORE §Blender north
 *    star) — an operator is not a property and this view draws properties.
 *  - `SCENE_PT_custom_props` (`:467`). Custom properties are IDProperties;
 *    they are not in `bl_rna.properties` and the door answers RNA. Same
 *    reading as the Object tab's.
 *
 * It stands when: `buttons_context_path_scene` — a scene always resolves.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `properties_scene.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // SCENE_PT_scene, :49.
    title: 'Scene',
    properties: ['camera', 'background_set', 'active_clip'],
  },
  {
    // SCENE_PT_unit, :64 — `unit = scene.unit_settings` (:74).
    title: 'Units',
    closed: true,
    from: 'Units',
    properties: [
      'system',
      'scale_length',
      'use_separate',
      'system_rotation',
      'length_unit',
      'mass_unit',
      'time_unit',
      'temperature_unit',
    ],
  },
  {
    // SCENE_PT_physics, :302 — `use_gravity` is the panel's HEADER checkbox
    // (`draw_header`, :307) and `gravity` its one row.
    title: 'Gravity',
    closed: true,
    properties: ['use_gravity', 'gravity'],
  },
  {
    // SCENE_PT_simulation, :320.
    title: 'Simulation',
    closed: true,
    properties: ['use_custom_simulation_range', 'simulation_frame_start', 'simulation_frame_end'],
  },
  {
    // SCENE_PT_keying_sets, :144 — a `template_list` over `scene.keying_sets`
    // (:156). The collection row lists them by name and drills into one; the
    // sub-panels SCENE_PT_keying_set_paths (:213) and
    // SCENE_PT_keyframing_settings (:177) are the ACTIVE set's own, and the
    // context door carries no active keying set, so they are one drill down
    // rather than a second addressing scheme.
    title: 'Keying Sets',
    closed: true,
    properties: ['keying_sets'],
  },
  {
    // SCENE_PT_audio, :275.
    title: 'Audio',
    closed: true,
    properties: [
      'audio_volume',
      'audio_distance_model',
      'audio_doppler_speed',
      'audio_doppler_factor',
    ],
  },
  {
    // SCENE_PT_rigid_body_world, :338 — `enabled` is its header checkbox
    // (:346); the body is two operators, which are not ours to draw.
    title: 'Rigid Body World',
    closed: true,
    from: 'Rigid Body World',
    properties: ['enabled'],
    sub: [
      {
        // SCENE_PT_rigid_body_world_settings, :370.
        title: 'Settings',
        from: 'Rigid Body World',
        properties: [
          'collection',
          'constraints',
          'time_scale',
          'use_split_impulse',
          'substeps_per_frame',
          'solver_iterations',
        ],
      },
      {
        // SCENE_PT_rigid_body_cache, :402 — `point_cache_ui(self,
        // rbw.point_cache, …)`, so the panel is that sub-struct; its pointer
        // row stands and the values are one drill down.
        title: 'Cache',
        closed: true,
        from: 'Rigid Body World',
        properties: ['point_cache'],
      },
      {
        // SCENE_PT_rigid_body_field_weights, :413 —
        // `effector_weights_ui(self, rbw.effector_weights, …)`.
        title: 'Field Weights',
        closed: true,
        from: 'Rigid Body World',
        properties: ['effector_weights'],
      },
    ],
  },
  {
    // SCENE_PT_eevee_light_probes, :425 — `props = scene.eevee` (:440), and
    // COMPAT_ENGINES is `{'BLENDER_EEVEE'}` (:429). The engine gate is read
    // from `rna_context`'s own `engine`; see `BlenderCuratedPanel.engine`.
    title: 'Light Probes',
    closed: true,
    from: 'EEVEE',
    engine: ['BLENDER_EEVEE'],
    properties: ['gi_cubemap_resolution'],
  },
  {
    // SCENE_PT_animation, :452.
    title: 'Animation',
    closed: true,
    properties: ['animation_data'],
  },
];

const TAB = { id: 'scene', standing: 'any', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Scene';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-scene';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 40;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'scene';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
