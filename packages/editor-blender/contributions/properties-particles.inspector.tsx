/**
 * BLENDER'S PARTICLES TAB, as a Properties section (WORK.md §Blender in the
 * tab is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_particle.py` at the
 * engine's pin — `classes` (`:2248-2302`) is the panel order, `bl_label` the
 * title, each `layout.prop(part, "x")` an entry. Blender's UI layer is never
 * run, ported or recorded.
 *
 * NEARLY EVERY PANEL DRAWS `psys.settings`, NOT THE SYSTEM. `part` in these
 * draw functions is `particle_get_settings(context)` (`:40-46`), which is the
 * active system's ParticleSettings — a datablock of its own. The system
 * itself carries only a handful (`seed`, `parent`, `child_seed`, the
 * vertex-group names, `use_hair_dynamics`). The context door names both, plus
 * the hair-dynamics cloth settings, as this tab's paths, and each row says
 * which it comes from.
 *
 * THE TYPE POLLS ARE READ, and this tab is why `when` exists. Blender gates
 * these panels on values rather than on structure: `settings.type == 'HAIR'`
 * (Hair Dynamics `:362`, Hair Shape `:2205`), `settings.physics_type` in
 * NEWTON/FLUID or == BOIDS (`:1161`, `:1195`, `:1222`, `:934`),
 * `settings.render_type` (`:1449`, `:1507`, `:1536`), `settings.child_type`
 * (`:1743`, `:1778`), `settings.is_fluid` (`:272`). Every one of those
 * properties is on the same struct under every mode, so RNA cannot answer the
 * poll and the condition is read from the ENGINE's live value instead — a copy
 * of Blender's test, never of its branching.
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS:
 *  - `PARTICLE_PT_context_particles` (`:156`, `bl_label = ""`) — the systems
 *    list plus the settings ID template. The list itself is the first panel
 *    here, as a collection with the active system marked; the `template_ID`
 *    row is an editing widget.
 *  - the Boids panels (`:931`-`:1045`) and the fluid-spring panels
 *    (`:835`-`:928`): both read sub-structs of the settings (`part.boids`,
 *    `part.fluid`), which stand as POINTER rows in the Physics panel and
 *    drill. Naming a fourth and fifth datablock on this tab to reach a mode
 *    almost nothing uses is the machinery the generic view exists to avoid.
 *  - `PARTICLE_PT_boidbrain` (`:1254`) — a rules list with per-rule operators.
 *  - `template_curve_mapping` (the clump and roughness curves) — a curve
 *    widget this view does not draw.
 *  - `PARTICLE_PT_custom_props` (`:2243`), IDProperties rather than RNA.
 *
 * It stands when: `buttons_context_path_particle` — `ob->type == OB_MESH`.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

/** `settings.type == 'HAIR'` — the poll Hair Dynamics and Hair Shape share. */
const HAIR = [{ from: 'Settings', property: 'type', is: ['HAIR'] }] as const;

/** `properties_particle.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // PARTICLE_UL_particle_systems, :131, drawn by
    // PARTICLE_PT_context_particles' `template_list` (:183).
    title: 'Particle Systems',
    from: 'Particle Systems',
    collection: true,
    active: 'activeParticleSystem',
    properties: ['name', 'settings'],
  },
  {
    // PARTICLE_PT_emission, :256. `psys.seed` (:293) is the SYSTEM's.
    title: 'Emission',
    from: 'Settings',
    when: [{ from: 'Settings', property: 'is_fluid', is: [false] }],
    properties: [
      'count',
      { from: 'Active', property: 'seed' },
      'hair_length',
      'hair_step',
      'frame_start',
      'frame_end',
      'lifetime',
      'lifetime_random',
    ],
    sub: [
      {
        // PARTICLE_PT_emission_source, :311.
        title: 'Source',
        closed: true,
        from: 'Settings',
        properties: [
          'emit_from',
          'use_modifier_stack',
          'distribution',
          'use_emit_random',
          'invert_grid',
          'hexagonal_grid',
          'use_even_distribution',
          'userjit',
          'jitter_factor',
          'grid_resolution',
          'grid_random',
        ],
      },
    ],
  },
  {
    // PARTICLE_PT_hair_dynamics, :353 — `psys.use_hair_dynamics` is the header
    // checkbox (:374) and the body is `psys.cloth.settings` (:390).
    title: 'Hair Dynamics',
    closed: true,
    from: 'Hair Dynamics',
    when: HAIR,
    properties: [{ from: 'Active', property: 'use_hair_dynamics' }, 'quality', 'pin_stiffness'],
    sub: [
      {
        // PARTICLE_PT_hair_dynamics_collision, :445 —
        // `psys.cloth.collision_settings` (:463).
        title: 'Collisions',
        closed: true,
        from: 'Hair Collisions',
        properties: ['collision_quality', 'distance_min', 'impulse_clamp', 'collection'],
      },
      {
        // PARTICLE_PT_hair_dynamics_structure, :481 — `bending_random` is the
        // SETTINGS', the rest the cloth's.
        title: 'Structure',
        closed: true,
        from: 'Hair Dynamics',
        properties: [
          'mass',
          'bending_stiffness',
          { from: 'Settings', property: 'bending_random' },
          'bending_damping',
        ],
      },
      {
        // PARTICLE_PT_hair_dynamics_volume, :516.
        title: 'Volume',
        closed: true,
        from: 'Hair Dynamics',
        properties: [
          'air_damping',
          'internal_friction',
          'voxel_cell_size',
          'density_target',
          'density_strength',
        ],
      },
    ],
  },
  {
    // PARTICLE_PT_cache, :552 — `point_cache_ui(self, psys.point_cache, …)`,
    // so the panel is that sub-struct and its pointer row stands.
    title: 'Cache',
    closed: true,
    from: 'Active',
    when: [{ from: 'Settings', property: 'physics_type', isNot: ['NO', 'KEYED'] }],
    properties: ['point_cache'],
  },
  {
    // PARTICLE_PT_velocity, :589.
    title: 'Velocity',
    closed: true,
    from: 'Settings',
    when: [{ from: 'Settings', property: 'physics_type', isNot: ['BOIDS'] }],
    properties: [
      'normal_factor',
      'tangent_factor',
      'tangent_phase',
      'object_align_factor',
      'particle_factor',
      'object_factor',
      'factor_random',
    ],
  },
  {
    // PARTICLE_PT_rotation, :642 — `use_rotations` is the header checkbox.
    title: 'Rotation',
    closed: true,
    from: 'Settings',
    when: [{ from: 'Settings', property: 'physics_type', isNot: ['BOIDS'] }],
    properties: [
      'use_rotations',
      'rotation_mode',
      'rotation_factor_random',
      'phase_factor',
      'phase_factor_random',
      'use_dynamic_rotation',
    ],
    sub: [
      {
        // PARTICLE_PT_rotation_angular_velocity, :700.
        title: 'Angular Velocity',
        closed: true,
        from: 'Settings',
        properties: ['angular_velocity_mode', 'angular_velocity_factor'],
      },
    ],
  },
  {
    // PARTICLE_PT_physics, :730. `boids` and `fluid` are the two mode
    // sub-structs whose own panels are one drill away (see the header).
    title: 'Physics',
    closed: true,
    from: 'Settings',
    properties: [
      'physics_type',
      'mass',
      'use_multiply_size_mass',
      'keyed_loops',
      { from: 'Active', property: 'use_keyed_timing' },
      'fluid',
      'boids',
    ],
    sub: [
      {
        // PARTICLE_PT_physics_forces, :1187.
        title: 'Forces',
        from: 'Settings',
        when: [{ from: 'Settings', property: 'physics_type', is: ['NEWTON', 'FLUID'] }],
        properties: ['brownian_factor', 'drag_factor', 'damping'],
      },
      {
        // PARTICLE_PT_physics_deflection, :1156.
        title: 'Deflection',
        closed: true,
        from: 'Settings',
        when: [{ from: 'Settings', property: 'physics_type', is: ['NEWTON', 'FLUID'] }],
        properties: ['use_size_deflect', 'use_die_on_collision', 'collision_collection'],
      },
      {
        // PARTICLE_PT_physics_integration, :1217.
        title: 'Integration',
        closed: true,
        from: 'Settings',
        when: [{ from: 'Settings', property: 'physics_type', is: ['NEWTON', 'FLUID'] }],
        properties: [
          'integrator',
          'timestep',
          'subframes',
          'use_adaptive_subframes',
          'courant_target',
        ],
      },
    ],
  },
  {
    // PARTICLE_PT_render, :1362 — `psys.parent` (:1407) is the SYSTEM's.
    title: 'Render',
    closed: true,
    from: 'Settings',
    properties: [
      'render_type',
      'particle_size',
      'size_random',
      'material_slot',
      { from: 'Active', property: 'parent' },
    ],
    sub: [
      {
        // PARTICLE_PT_render_path, :1443.
        title: 'Path',
        from: 'Settings',
        when: [{ from: 'Settings', property: 'render_type', is: ['PATH'] }],
        properties: ['use_hair_bspline', 'render_step'],
        sub: [
          {
            // PARTICLE_PT_render_path_timing, :1468.
            title: 'Timing',
            closed: true,
            from: 'Settings',
            properties: ['use_absolute_path_time', 'path_start', 'path_end', 'length_random'],
          },
        ],
      },
      {
        // PARTICLE_PT_render_object, :1501.
        title: 'Object',
        from: 'Settings',
        when: [{ from: 'Settings', property: 'render_type', is: ['OBJECT'] }],
        properties: [
          'instance_object',
          'use_global_instance',
          'use_rotation_instance',
          'use_scale_instance',
        ],
      },
      {
        // PARTICLE_PT_render_collection, :1530, with its Use Count child
        // (:1563) over `part.instance_weights`.
        title: 'Collection',
        from: 'Settings',
        when: [{ from: 'Settings', property: 'render_type', is: ['COLLECTION'] }],
        properties: [
          'instance_collection',
          'use_whole_collection',
          'use_collection_pick_random',
          'use_global_instance',
          'use_rotation_instance',
          'use_scale_instance',
        ],
        sub: [
          {
            title: 'Use Count',
            closed: true,
            from: 'Settings',
            properties: ['use_collection_count', 'instance_weights'],
          },
        ],
      },
      {
        // PARTICLE_PT_render_extra, :1414.
        title: 'Extra',
        closed: true,
        from: 'Settings',
        when: [{ from: 'Settings', property: 'render_type', isNot: ['NONE'] }],
        properties: ['use_parent_particles', 'show_unborn', 'use_dead'],
      },
    ],
  },
  {
    // PARTICLE_PT_draw, :1618.
    title: 'Viewport Display',
    closed: true,
    from: 'Settings',
    properties: [
      'display_method',
      'display_color',
      'color_maximum',
      'display_percentage',
      'display_step',
      'display_size',
    ],
  },
  {
    // PARTICLE_PT_children, :1680 — `psys.child_seed` (:1718) is the SYSTEM's.
    title: 'Children',
    closed: true,
    from: 'Settings',
    properties: [
      'child_type',
      'child_percent',
      'rendered_child_count',
      'child_length',
      'child_length_threshold',
      { from: 'Active', property: 'child_seed' },
      'virtual_parents',
      'create_long_hair_children',
      'child_size',
      'child_size_random',
      'child_radius',
      'child_roundness',
    ],
    sub: [
      {
        // PARTICLE_PT_children_parting, :1737.
        title: 'Parting',
        closed: true,
        from: 'Settings',
        when: [{ from: 'Settings', property: 'child_type', is: ['INTERPOLATED'] }],
        properties: ['child_parting_factor', 'child_parting_min', 'child_parting_max'],
      },
      {
        // PARTICLE_PT_children_clumping, :1772, with Clump Noise (:1812).
        title: 'Clumping',
        closed: true,
        from: 'Settings',
        when: [{ from: 'Settings', property: 'child_type', isNot: ['NONE'] }],
        properties: ['use_clump_curve', 'clump_factor', 'clump_shape', 'twist', 'use_twist_curve'],
        sub: [
          {
            title: 'Clump Noise',
            closed: true,
            from: 'Settings',
            properties: ['use_clump_noise', 'clump_noise_size'],
          },
        ],
      },
      {
        // PARTICLE_PT_children_roughness, :1839.
        title: 'Roughness',
        closed: true,
        from: 'Settings',
        when: [{ from: 'Settings', property: 'child_type', isNot: ['NONE'] }],
        properties: [
          'use_roughness_curve',
          'roughness_1',
          'roughness_1_size',
          'roughness_endpoint',
          'roughness_end_shape',
          'roughness_2',
          'roughness_2_size',
          'roughness_2_threshold',
        ],
      },
      {
        // PARTICLE_PT_children_kink, :1885.
        title: 'Kink',
        closed: true,
        from: 'Settings',
        when: [{ from: 'Settings', property: 'child_type', isNot: ['NONE'] }],
        properties: [
          'kink',
          'kink_amplitude',
          'kink_amplitude_random',
          'kink_amplitude_clump',
          'kink_axis',
          'kink_axis_random',
          'kink_frequency',
          'kink_shape',
          'kink_extra_steps',
          'kink_flat',
        ],
      },
    ],
  },
  {
    // PARTICLE_PT_hair_shape, :2196.
    title: 'Hair Shape',
    closed: true,
    from: 'Settings',
    when: HAIR,
    properties: ['shape', 'root_radius', 'tip_radius', 'radius_scale', 'use_close_tip'],
  },
  {
    // PARTICLE_PT_field_weights, :1940 — `effector_weights_ui` over
    // `part.effector_weights`, plus two of the settings' own.
    title: 'Field Weights',
    closed: true,
    from: 'Settings',
    properties: ['effector_weights', 'apply_effector_to_children', 'effect_hair'],
  },
  {
    // PARTICLE_PT_force_fields, :1965, and its two type children (:1985,
    // :2006), which draw `part.force_field_1` / `_2`.
    title: 'Force Field Settings',
    closed: true,
    from: 'Settings',
    properties: ['use_self_effect', 'effector_amount', 'force_field_1', 'force_field_2'],
  },
  {
    // PARTICLE_PT_vertexgroups, :2067 — every row is the SYSTEM's.
    title: 'Vertex Groups',
    closed: true,
    from: 'Active',
    properties: [
      'vertex_group_density',
      'invert_vertex_group_density',
      'vertex_group_length',
      'invert_vertex_group_length',
      'vertex_group_clump',
      'invert_vertex_group_clump',
      'vertex_group_kink',
      'invert_vertex_group_kink',
      'vertex_group_roughness_1',
      'invert_vertex_group_roughness_1',
      'vertex_group_roughness_2',
      'invert_vertex_group_roughness_2',
      'vertex_group_roughness_end',
      'invert_vertex_group_roughness_end',
      'vertex_group_twist',
      'invert_vertex_group_twist',
    ],
  },
  {
    // PARTICLE_PT_textures, :2160 — `template_list` over `part.texture_slots`.
    title: 'Textures',
    closed: true,
    from: 'Settings',
    properties: ['texture_slots', 'active_texture'],
  },
  {
    // PARTICLE_PT_animation, :2230.
    title: 'Animation',
    closed: true,
    from: 'Settings',
    properties: ['animation_data'],
  },
];

const TAB = { id: 'particle', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Particles';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-particles';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 90;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
