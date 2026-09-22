/**
 * BLENDER'S PHYSICS TAB, as a Properties section (WORK.md §Blender in the tab
 * is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS SEVEN FILES, not one: `properties_physics_common.py`
 * carries the tab's own header block, and `properties_physics_rigidbody.py`,
 * `_rigidbody_constraint.py`, `_cloth.py`, `_softbody.py`, `_field.py`
 * (Force Fields AND Collision), `_fluid.py` and `_dynamicpaint.py` each carry
 * one simulation. Each panel below cites its file and line. Blender's UI
 * layer is never run, ported or recorded.
 *
 * THE "ENABLE BUTTONS" ROW IS NOT DRAWN, AND WHAT IT SAYS STILL IS.
 * `PHYSICS_PT_add` (`properties_physics_common.py:55`) is a grid of
 * `object.modifier_add` / `rigidbody.object_add` OPERATORS — editing, not
 * inspection (ARCHITECTURE-CORE §Blender north star), and this view draws
 * properties. What that row COMMUNICATES is which simulations the object has,
 * and that is exactly which panels stand here: the context door resolves a
 * path per simulation the way `physics_add`/`physics_add_special` test for
 * one — the data for `obj.rigid_body`, `obj.rigid_body_constraint`,
 * `obj.soft_body`, `obj.collision` and `obj.field`, and a MODIFIER of the
 * right type for cloth, fluid and dynamic paint (Blender's `context.cloth` is
 * the ClothModifier, and the panels read its `settings` structs). An absent
 * simulation is an absent path and its panels do not draw.
 *
 * FLUID AND DYNAMIC PAINT STOP AT THEIR TYPE. Both are a modifier whose whole
 * panel set is per-`fluid_type` / per-`ui_type` — domain, flow and effector
 * are three different property surfaces, and dynamic paint's canvas splits
 * again per surface. What stands here is the modifier's type row and the
 * pointer to the settings struct the type selects, which drills into the
 * generic view; transcribing three or four alternative panel sets each is the
 * machinery the generic view exists to make unnecessary. Stated, not
 * silently partial.
 *
 * It stands when: `buttons_context_path_object` — Physics shares Object's
 * path, so the engine grants it whenever it grants Object. It is
 * context-gated rather than standing because the Properties editor follows
 * the ACTIVE OBJECT, not the row that was clicked.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // PHYSICS_PT_rigid_body, properties_physics_rigidbody.py:22.
    title: 'Rigid Body',
    from: 'Rigid Body',
    properties: ['type'],
    sub: [
      // PHYSICS_PT_rigid_body_settings, :60.
      { title: 'Settings', from: 'Rigid Body', properties: ['mass', 'kinematic', 'enabled'] },
      {
        // PHYSICS_PT_rigid_body_collisions, :96.
        title: 'Collisions',
        from: 'Rigid Body',
        properties: ['collision_shape', 'mesh_source', 'use_deform'],
        sub: [
          // PHYSICS_PT_rigid_body_collisions_surface, :149.
          {
            title: 'Surface Response',
            closed: true,
            from: 'Rigid Body',
            properties: ['friction', 'restitution'],
          },
          // PHYSICS_PT_rigid_body_collisions_sensitivity, :181.
          {
            title: 'Sensitivity',
            closed: true,
            from: 'Rigid Body',
            properties: ['use_margin', 'collision_margin'],
          },
          // PHYSICS_PT_rigid_body_collisions_collections, :222.
          {
            title: 'Collections',
            closed: true,
            from: 'Rigid Body',
            properties: ['collision_collections'],
          },
        ],
      },
      {
        // PHYSICS_PT_rigid_body_dynamics, :248 — `obj.rigid_body.type ==
        // 'ACTIVE'` is in its poll (:277).
        title: 'Dynamics',
        closed: true,
        from: 'Rigid Body',
        when: [{ from: 'Rigid Body', property: 'type', is: ['ACTIVE'] }],
        properties: ['linear_damping', 'angular_damping'],
        sub: [
          // PHYSICS_PT_rigid_body_dynamics_deactivation, :287.
          {
            title: 'Deactivation',
            closed: true,
            from: 'Rigid Body',
            properties: [
              'use_deactivation',
              'use_start_deactivated',
              'deactivate_linear_velocity',
              'deactivate_angular_velocity',
            ],
          },
        ],
      },
    ],
  },
  {
    // PHYSICS_PT_rigid_body_constraint,
    // properties_physics_rigidbody_constraint.py:16.
    title: 'Rigid Body Constraint',
    from: 'Rigid Body Constraint',
    properties: ['type'],
    sub: [
      // _settings, :39.
      {
        title: 'Settings',
        from: 'Rigid Body Constraint',
        properties: ['enabled', 'disable_collisions', 'use_breaking', 'breaking_threshold'],
      },
      // _objects, :74.
      {
        title: 'Objects',
        from: 'Rigid Body Constraint',
        properties: ['object1', 'object2'],
      },
      // _override_iterations, :99.
      {
        title: 'Override Iterations',
        closed: true,
        from: 'Rigid Body Constraint',
        properties: ['use_override_solver_iterations', 'solver_iterations'],
      },
      {
        // _limits, :129 — an empty body with a Linear (:152) and an Angular
        // (:215) child.
        title: 'Limits',
        closed: true,
        from: 'Rigid Body Constraint',
        properties: [],
        sub: [
          {
            title: 'Linear',
            from: 'Rigid Body Constraint',
            properties: [
              'use_limit_lin_x',
              'limit_lin_x_lower',
              'limit_lin_x_upper',
              'use_limit_lin_y',
              'limit_lin_y_lower',
              'limit_lin_y_upper',
              'use_limit_lin_z',
              'limit_lin_z_lower',
              'limit_lin_z_upper',
            ],
          },
          {
            title: 'Angular',
            from: 'Rigid Body Constraint',
            properties: [
              'use_limit_ang_x',
              'limit_ang_x_lower',
              'limit_ang_x_upper',
              'use_limit_ang_y',
              'limit_ang_y_lower',
              'limit_ang_y_upper',
              'use_limit_ang_z',
              'limit_ang_z_lower',
              'limit_ang_z_upper',
            ],
          },
        ],
      },
      {
        // _motor, :287, with its Linear (:354) and Angular (:310) children.
        title: 'Motor',
        closed: true,
        from: 'Rigid Body Constraint',
        properties: [],
        sub: [
          {
            title: 'Linear',
            from: 'Rigid Body Constraint',
            properties: ['use_motor_lin', 'motor_lin_target_velocity', 'motor_lin_max_impulse'],
          },
          {
            title: 'Angular',
            from: 'Rigid Body Constraint',
            properties: ['use_motor_ang', 'motor_ang_target_velocity', 'motor_ang_max_impulse'],
          },
        ],
      },
      {
        // _springs, :396 — the per-axis stiffness/damping rows are its two
        // children and stay in the generic view beneath.
        title: 'Springs',
        closed: true,
        from: 'Rigid Body Constraint',
        properties: ['spring_type'],
      },
    ],
  },
  {
    // PHYSICS_PT_cloth, properties_physics_cloth.py:38 — `cloth =
    // md.settings` (:58), which the door names as this path.
    title: 'Cloth',
    from: 'Cloth',
    properties: ['quality', 'time_scale'],
    sub: [
      {
        // _physical_properties, :66.
        title: 'Physical Properties',
        from: 'Cloth',
        properties: ['mass', 'air_damping', 'bending_model'],
        sub: [
          // _stiffness, :94.
          {
            title: 'Stiffness',
            from: 'Cloth',
            properties: [
              'tension_stiffness',
              'compression_stiffness',
              'shear_stiffness',
              'bending_stiffness',
            ],
          },
          // _damping, :129.
          {
            title: 'Damping',
            from: 'Cloth',
            properties: [
              'tension_damping',
              'compression_damping',
              'shear_damping',
              'bending_damping',
            ],
          },
          // _internal_springs, :164 — `use_internal_springs` is the header.
          {
            title: 'Internal Springs',
            closed: true,
            from: 'Cloth',
            properties: [
              'use_internal_springs',
              'internal_spring_max_length',
              'internal_spring_max_diversion',
              'internal_spring_normal_check',
              'internal_tension_stiffness',
              'internal_compression_stiffness',
              'internal_tension_stiffness_max',
              'internal_compression_stiffness_max',
              'vertex_group_intern',
            ],
          },
          // _pressure, :210 — `use_pressure` is the header.
          {
            title: 'Pressure',
            closed: true,
            from: 'Cloth',
            properties: [
              'use_pressure',
              'uniform_pressure_force',
              'use_pressure_volume',
              'target_volume',
              'pressure_factor',
              'fluid_density',
              'vertex_group_pressure',
            ],
          },
        ],
      },
      // _cache, :257 — `point_cache_ui(self, md.point_cache, …)`, and the
      // point cache is the MODIFIER's, not the settings'.
      { title: 'Cache', closed: true, from: 'Cloth Modifier', properties: ['point_cache'] },
      // _shape, :272.
      {
        title: 'Shape',
        closed: true,
        from: 'Cloth',
        properties: [
          'vertex_group_mass',
          'pin_stiffness',
          'use_sewing_springs',
          'sewing_force_max',
          'shrink_min',
          'use_dynamic_mesh',
          'rest_shape_key',
        ],
      },
      {
        // _collision, :326 — `collision_quality` is the cloth SETTINGS', the
        // two children read `md.collision_settings`.
        title: 'Collisions',
        closed: true,
        from: 'Cloth',
        properties: ['collision_quality'],
        sub: [
          // _object_collision, :351.
          {
            title: 'Object Collisions',
            from: 'Cloth Collisions',
            properties: [
              'use_collision',
              'distance_min',
              'impulse_clamp',
              'vertex_group_object_collisions',
              'collection',
            ],
          },
          // _self_collision, :391.
          {
            title: 'Self Collisions',
            from: 'Cloth Collisions',
            properties: [
              'use_self_collision',
              'self_friction',
              'self_distance_min',
              'self_impulse_clamp',
            ],
          },
        ],
      },
      // _field_weights, :489 — `effector_weights_ui` over the settings' own.
      {
        title: 'Field Weights',
        closed: true,
        from: 'Cloth',
        properties: ['effector_weights'],
      },
    ],
  },
  {
    // PHYSICS_PT_softbody, properties_physics_softbody.py:31 — `softbody =
    // md.settings`, which is `obj.soft_body`.
    title: 'Soft Body',
    from: 'Soft Body',
    properties: ['collision_collection'],
    sub: [
      // _object, :49.
      {
        title: 'Object',
        closed: true,
        from: 'Soft Body',
        properties: ['friction', 'mass', 'vertex_group_mass'],
      },
      // _simulation, :81.
      { title: 'Simulation', closed: true, from: 'Soft Body', properties: ['speed'] },
      // _goal, :118 — `use_goal` is the header checkbox.
      {
        title: 'Goal',
        closed: true,
        from: 'Soft Body',
        properties: ['use_goal', 'vertex_group_goal'],
        sub: [
          // _goal_strengths, :147.
          {
            title: 'Strengths',
            closed: true,
            from: 'Soft Body',
            properties: ['goal_default', 'goal_min', 'goal_max'],
          },
          // _goal_settings, :177.
          {
            title: 'Settings',
            closed: true,
            from: 'Soft Body',
            properties: ['goal_spring', 'goal_friction'],
          },
        ],
      },
      // _edge, :204 — `use_edges` is the header checkbox.
      {
        title: 'Edges',
        closed: true,
        from: 'Soft Body',
        properties: [
          'use_edges',
          'vertex_group_spring',
          'pull',
          'push',
          'damping',
          'plastic',
          'bend',
          'spring_length',
          'use_edge_collision',
          'use_face_collision',
        ],
        sub: [
          // _edge_aerodynamics, :259.
          {
            title: 'Aerodynamics',
            closed: true,
            from: 'Soft Body',
            properties: ['aerodynamics_type', 'aero'],
          },
          // _edge_stiffness, :286.
          {
            title: 'Stiffness',
            closed: true,
            from: 'Soft Body',
            properties: ['use_stiff_quads', 'shear'],
          },
        ],
      },
      // _collision, :314 — `use_self_collision` is the header checkbox.
      {
        title: 'Self Collision',
        closed: true,
        from: 'Soft Body',
        properties: [
          'use_self_collision',
          'collision_type',
          'ball_size',
          'ball_stiff',
          'ball_damp',
        ],
      },
      {
        // _solver, :353.
        title: 'Solver',
        closed: true,
        from: 'Soft Body',
        properties: ['step_min', 'step_max', 'use_auto_step', 'error_threshold'],
        sub: [
          // _solver_diagnostics, :382.
          {
            title: 'Diagnostics',
            closed: true,
            from: 'Soft Body',
            properties: ['use_diagnose', 'use_estimate_matrix'],
          },
          // _solver_helpers, :405.
          {
            title: 'Helpers',
            closed: true,
            from: 'Soft Body',
            properties: ['choke', 'fuzzy'],
          },
        ],
      },
      // _field_weights, :432.
      {
        title: 'Field Weights',
        closed: true,
        from: 'Soft Body',
        properties: ['effector_weights'],
      },
      // _cache, :103 — the modifier's, as Cloth's is.
      { title: 'Cache', closed: true, from: 'Soft Body Modifier', properties: ['point_cache'] },
    ],
  },
  {
    // PHYSICS_PT_field, properties_physics_field.py:33.
    title: 'Force Fields',
    from: 'Force Field',
    properties: ['type'],
    sub: [
      {
        // _field_settings, :58 — one draw function for every field type; the
        // rows a type does not carry are simply not on its RNA.
        title: 'Settings',
        from: 'Force Field',
        properties: [
          'shape',
          'strength',
          'flow',
          'apply_to_location',
          'apply_to_rotation',
          'source_object',
          'use_smoke_density',
          'falloff_power',
          'use_max_distance',
          'distance_max',
          'texture_mode',
          'texture_nabla',
          'use_object_coords',
          'use_2d_force',
          'guide_free',
          'use_guide_path_add',
          'use_guide_path_weight',
          'guide_clump_amount',
          'guide_clump_shape',
          'guide_minimum',
        ],
        sub: [
          {
            // _field_settings_kink, :149 — `ob.field.type == 'GUIDE'` (:157).
            title: 'Kink',
            from: 'Force Field',
            when: [{ from: 'Force Field', property: 'type', is: ['GUIDE'] }],
            properties: [
              'guide_kink_type',
              'guide_kink_axis',
              'guide_kink_frequency',
              'guide_kink_shape',
              'guide_kink_amplitude',
            ],
          },
          {
            // _field_settings_texture_select, :187 — `type == 'TEXTURE'`.
            title: 'Texture',
            from: 'Force Field',
            when: [{ from: 'Force Field', property: 'type', is: ['TEXTURE'] }],
            properties: ['texture'],
          },
        ],
      },
      {
        // _field_falloff, :213 — `type not in {'NONE', 'GUIDE'}` (:221).
        title: 'Falloff',
        from: 'Force Field',
        when: [{ from: 'Force Field', property: 'type', isNot: ['NONE', 'GUIDE'] }],
        properties: ['falloff_type'],
        sub: [
          {
            // _field_falloff_angular, :242 — `falloff_type == 'CONE'`.
            title: 'Angular',
            from: 'Force Field',
            when: [{ from: 'Force Field', property: 'falloff_type', is: ['CONE'] }],
            properties: [
              'radial_falloff',
              'use_radial_min',
              'radial_min',
              'use_radial_max',
              'radial_max',
            ],
          },
          {
            // _field_falloff_radial, :285 — `falloff_type == 'TUBE'`.
            title: 'Radial',
            from: 'Force Field',
            when: [{ from: 'Force Field', property: 'falloff_type', is: ['TUBE'] }],
            properties: [
              'radial_falloff',
              'use_radial_min',
              'radial_min',
              'use_radial_max',
              'radial_max',
            ],
          },
        ],
      },
    ],
  },
  {
    // PHYSICS_PT_collision, properties_physics_field.py:334 — `settings =
    // md.settings`, which is `obj.collision`. `use` is the header checkbox
    // drawn by `PHYSICS_PT_add` (`properties_physics_common.py:81`).
    title: 'Collision',
    from: 'Collision',
    properties: ['use', 'absorption'],
    sub: [
      // _collision_particle, :368.
      {
        title: 'Particle',
        from: 'Collision',
        properties: [
          'permeability',
          'stickiness',
          'use_particle_kill',
          'damping_factor',
          'damping_random',
          'friction_factor',
          'friction_random',
        ],
      },
      // _collision_softbody, :418.
      {
        title: 'Softbody & Cloth',
        from: 'Collision',
        properties: [
          'damping',
          'thickness_outer',
          'thickness_inner',
          'cloth_friction',
          'use_culling',
          'use_normal',
        ],
      },
    ],
  },
  {
    // properties_physics_fluid.py — see the header for why this stops at the
    // type and the settings pointer.
    title: 'Fluid',
    from: 'Fluid',
    properties: ['fluid_type', 'domain_settings', 'flow_settings', 'effector_settings'],
  },
  {
    // properties_physics_dynamicpaint.py, same reading.
    title: 'Dynamic Paint',
    from: 'Dynamic Paint',
    properties: ['ui_type', 'canvas_settings', 'brush_settings'],
  },
];

const TAB = { id: 'physics', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Physics';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-physics';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 100;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'object';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
