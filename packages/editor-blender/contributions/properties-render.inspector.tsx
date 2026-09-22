/**
 * BLENDER'S RENDER TAB, as a Properties section (WORK.md §Blender in the tab
 * is Blender, "Inspection parity", I2). Blender's own panels over the RNA
 * door, with the generic view beneath under "All properties".
 *
 * THE SPECIFICATION IS `scripts/startup/bl_ui/properties_render.py` at the
 * engine's pin — `classes` (`:1186-1236`) is the panel order, `bl_label` the
 * title, each `layout.prop(…)` an entry, `bl_parent_id` a `sub`. Blender's UI
 * layer is never run, ported or recorded.
 *
 * THIS TAB IS WHERE THE ENGINE POLLS BECOME REAL, and it is the ONE `poll`
 * this transcription reads. Every other condition is dropped because RNA
 * already answers it — a property a datablock does not carry does not draw.
 * `COMPAT_ENGINES` is different in kind: `scene.eevee` and `scene.display`
 * exist under every engine, so nothing about the datablock says whether
 * Blender would draw the panel. Each panel below carries Blender's own LIST
 * (`COMPAT_ENGINES`, once per class) and it is checked against the ENGINE's
 * live answer — `rna_context`'s `engine`, which is `scene.render.engine`,
 * which is what `context.engine` is. The three ids a script can name here are
 * CYCLES, BLENDER_EEVEE and BLENDER_WORKBENCH (`session.py::_register_engine`);
 * the factory engine is BLENDER_EEVEE (`wasm/BUNDLE.json`), so the EEVEE
 * panels are what a fresh file draws. Cycles' own panels are the add-on's, not
 * `bl_ui`'s, and are therefore not in this file's specification.
 *
 * SEVERAL PANELS DRAW TWO DATABLOCKS IN ONE LIST — `RENDER_PT_eevee_film`
 * (`:757`) takes `filter_size` and `film_transparent` off `scene.render` and
 * `use_overscan`/`overscan_size` off `scene.eevee`, in that order. The
 * qualified property form keeps the row in Blender's position while naming
 * the datablock it comes from (`BlenderCuratedProperty`); the context door
 * names every one of them as this tab's own paths.
 *
 * WHAT THE TRANSCRIPTION DELIBERATELY DROPS:
 *  - every operator and preset menu: `RENDER_PT_format_presets`,
 *    `RENDER_PT_eevee_raytracing_presets` (`:380`), the light-probe bake
 *    buttons. Inspection parity, not editing parity.
 *  - `template_curve_mapping` (the motion-blur shutter curve `:283`, the
 *    colour-management curves `:185`) and `template_colormanaged_view_settings`
 *    — curve widgets, which this view does not draw; the datablock is one
 *    drill away in the generic view beneath.
 *  - `RENDER_PT_hydra_debug` (`:1165`): its engine is HYDRA_STORM, which this
 *    build does not register, and its poll also wants a developer-UI
 *    preference.
 *
 * It stands when: `buttons_context_path_scene` — a scene always resolves.
 */
import { blenderPropertiesTabMatch, blenderPropertiesTabSection } from './blender-properties-tab';
import type { BlenderCuratedPanel } from './blender-properties-view';

const EEVEE = ['BLENDER_EEVEE'] as const;
const WORKBENCH = ['BLENDER_WORKBENCH'] as const;

/** `properties_render.py`, panel by panel. Line numbers are that file's. */
const CURATED: readonly BlenderCuratedPanel[] = [
  {
    // RENDER_PT_context, :28 — `bl_label = ""` and HIDE_HEADER: in Blender it
    // is the bare engine row above the panels. Our panels always carry a
    // header, so it is named for what it holds.
    title: 'Render Engine',
    properties: ['engine'],
  },
  {
    // RENDER_PT_eevee_sampling, :675 — an empty body; the four children carry
    // the properties. `props = scene.eevee`.
    title: 'Sampling',
    engine: EEVEE,
    from: 'EEVEE',
    properties: [],
    sub: [
      // RENDER_PT_eevee_sampling_viewport, :687.
      {
        title: 'Viewport',
        from: 'EEVEE',
        properties: ['taa_samples', 'use_taa_reprojection', 'use_shadow_jitter_viewport'],
      },
      // RENDER_PT_eevee_sampling_render, :712.
      { title: 'Render', from: 'EEVEE', properties: ['taa_render_samples'] },
      // RENDER_PT_eevee_sampling_shadows, :635.
      {
        title: 'Shadows',
        closed: true,
        from: 'EEVEE',
        properties: [
          'use_shadows',
          'shadow_ray_count',
          'shadow_step_count',
          'use_volumetric_shadows',
          'volumetric_shadow_samples',
          'shadow_resolution_scale',
        ],
      },
      // RENDER_PT_eevee_sampling_advanced, :735.
      { title: 'Advanced', closed: true, from: 'EEVEE', properties: ['light_threshold'] },
    ],
  },
  {
    // RENDER_PT_eevee_light_paths, :546 — empty body, three descendants.
    title: 'Light Paths',
    closed: true,
    engine: EEVEE,
    from: 'EEVEE',
    properties: [],
    sub: [
      {
        // RENDER_PT_eevee_clamping, :559, itself empty.
        title: 'Clamping',
        from: 'EEVEE',
        properties: [],
        sub: [
          // RENDER_PT_eevee_clamping_surface, :572.
          {
            title: 'Surface',
            from: 'EEVEE',
            properties: ['clamp_surface_direct', 'clamp_surface_indirect'],
          },
          // RENDER_PT_eevee_clamping_volume, :593.
          {
            title: 'Volume',
            from: 'EEVEE',
            properties: ['clamp_volume_direct', 'clamp_volume_indirect'],
          },
        ],
      },
      // RENDER_PT_eevee_light_paths_intensity, :614.
      {
        title: 'Intensity',
        from: 'EEVEE',
        properties: ['direct_light_intensity', 'indirect_light_intensity'],
      },
    ],
  },
  {
    // RENDER_PT_eevee_raytracing, :387 — `props = scene.eevee` and
    // `options = scene.eevee.ray_tracing_options` (:415), one list.
    title: 'Raytracing',
    closed: true,
    engine: EEVEE,
    from: 'EEVEE',
    properties: [
      'use_raytracing',
      'ray_tracing_method',
      { from: 'Raytracing', property: 'resolution_scale' },
    ],
    sub: [
      // RENDER_PT_eevee_screen_trace, :420 — `props` is the OPTIONS struct
      // here (:439), which is why every row names it.
      {
        title: 'Screen Tracing',
        closed: true,
        from: 'Raytracing',
        properties: [
          'screen_trace_quality',
          'screen_trace_thickness',
          'use_backface_hit',
          'backface_radiance_scale',
        ],
      },
      // RENDER_PT_eevee_denoise, :506 — `props = scene.eevee.ray_tracing_options`.
      {
        title: 'Denoising',
        closed: true,
        from: 'Raytracing',
        properties: ['use_denoise', 'denoise_spatial', 'denoise_temporal', 'denoise_bilateral'],
      },
      // RENDER_PT_eevee_gi_approximation, :459 — `props = scene.eevee` (:476)
      // with `options.trace_max_roughness` (:485) among them.
      {
        title: 'Fast GI Approximation',
        closed: true,
        from: 'EEVEE',
        properties: [
          'use_fast_gi',
          { from: 'Raytracing', property: 'trace_max_roughness' },
          'fast_gi_method',
          'fast_gi_resolution',
          'fast_gi_ray_count',
          'fast_gi_step_count',
          'fast_gi_quality',
          'fast_gi_distance',
          'fast_gi_thickness_near',
          'fast_gi_bias',
        ],
      },
    ],
  },
  {
    // RENDER_PT_eevee_volumes, :325.
    title: 'Volumes',
    closed: true,
    engine: EEVEE,
    from: 'EEVEE',
    properties: [
      'volumetric_tile_size',
      'volumetric_samples',
      'volumetric_sample_distribution',
      'volumetric_ray_depth',
    ],
    sub: [
      // RENDER_PT_eevee_volumes_range, :351.
      {
        title: 'Custom Range',
        closed: true,
        from: 'EEVEE',
        properties: ['use_volume_custom_range', 'volumetric_start', 'volumetric_end'],
      },
    ],
  },
  {
    // RENDER_PT_eevee_depth_of_field, :295.
    title: 'Depth of Field',
    closed: true,
    engine: EEVEE,
    from: 'EEVEE',
    properties: [
      'bokeh_max_size',
      'bokeh_threshold',
      'bokeh_neighbor_max',
      'use_bokeh_jittered',
      'bokeh_overblur',
    ],
  },
  {
    // RENDER_PT_eevee_motion_blur, :235 — `props = scene.render` (:253) and
    // `eevee_props = scene.eevee` (:254). The shutter-curve child (:266) is a
    // curve widget and is not drawn here.
    title: 'Motion Blur',
    closed: true,
    engine: EEVEE,
    properties: [
      'use_motion_blur',
      'motion_blur_position',
      'motion_blur_shutter',
      { from: 'EEVEE', property: 'motion_blur_depth_scale' },
      { from: 'EEVEE', property: 'motion_blur_max' },
      { from: 'EEVEE', property: 'motion_blur_steps' },
    ],
  },
  {
    // RENDER_PT_eevee_film, :757 — `rd = scene.render` and `props = scene.eevee`.
    title: 'Film',
    closed: true,
    engine: EEVEE,
    properties: [
      'filter_size',
      'film_transparent',
      { from: 'EEVEE', property: 'use_overscan' },
      { from: 'EEVEE', property: 'overscan_size' },
    ],
  },
  {
    // RENDER_PT_eevee_performance, :812 — `rd = scene.render` (:827).
    title: 'Performance',
    closed: true,
    engine: EEVEE,
    properties: ['use_high_quality_normals', 'anisotropic_filter'],
    sub: [
      // CompositorPerformanceButtonsPanel, :836, which
      // RENDER_PT_eevee_performance_compositor (:872) is.
      {
        title: 'Compositor',
        closed: true,
        properties: ['compositor_device', 'compositor_precision'],
        sub: [
          // CompositorDenoisePerformanceButtonsPanel, :854.
          {
            title: 'Denoise Nodes',
            closed: true,
            properties: [
              'compositor_denoise_device',
              'compositor_denoise_preview_quality',
              'compositor_denoise_final_quality',
            ],
          },
        ],
      },
      // RENDER_PT_eevee_performance_memory, :892 — `props = scene.eevee`.
      {
        title: 'Memory',
        closed: true,
        from: 'EEVEE',
        properties: ['shadow_pool_size', 'gi_irradiance_pool_size'],
      },
      // RENDER_PT_eevee_performance_viewport, :914 — `rd = scene.render`.
      { title: 'Viewport', closed: true, properties: ['preview_pixel_size'] },
    ],
  },
  {
    // RENDER_PT_opengl_sampling, :1004 — `props = scene.display`.
    title: 'Sampling',
    engine: WORKBENCH,
    from: 'Workbench',
    properties: ['render_aa', 'viewport_aa'],
  },
  {
    // RENDER_PT_opengl_lighting, :1039 — delegates to
    // `VIEW3D_PT_shading_lighting.draw` (`space_view3d.py:6635`), which draws
    // `scene.display.shading`.
    title: 'Lighting',
    engine: WORKBENCH,
    from: 'Workbench Shading',
    properties: ['light', 'studio_light', 'use_world_space_lighting', 'studiolight_rotate_z'],
  },
  {
    // RENDER_PT_opengl_color, :1051 — `VIEW3D_PT_shading_color._draw_color_type`
    // (`space_view3d.py:6757`).
    title: 'Object Color',
    engine: WORKBENCH,
    from: 'Workbench Shading',
    properties: ['color_type', 'single_color'],
  },
  {
    // RENDER_PT_opengl_options, :1063 — `VIEW3D_PT_shading_options.draw`
    // (`space_view3d.py:6797`) then the cavity block (`:6896`).
    title: 'Options',
    engine: WORKBENCH,
    from: 'Workbench Shading',
    properties: [
      'show_backface_culling',
      'show_object_outline',
      'object_outline_color',
      'show_specular_highlight',
      'show_xray',
      'xray_alpha',
      'show_shadows',
      'shadow_intensity',
      'use_dof',
      'show_cavity',
      'cavity_type',
      'cavity_ridge_factor',
      'cavity_valley_factor',
      'curvature_ridge_factor',
      'curvature_valley_factor',
    ],
  },
  {
    // RENDER_PT_opengl_film, :1025 — `rd = scene.render`.
    title: 'Film',
    closed: true,
    engine: WORKBENCH,
    properties: ['film_transparent'],
  },
  {
    // RENDER_PT_gpencil, :937 — `props = scene.grease_pencil_settings`.
    title: 'Grease Pencil',
    closed: true,
    from: 'Grease Pencil',
    properties: [],
    sub: [
      // RENDER_PT_grease_pencil_viewport, :955.
      {
        title: 'Viewport',
        closed: true,
        from: 'Grease Pencil',
        properties: ['antialias_threshold'],
      },
      // RENDER_PT_grease_pencil_render, :977.
      {
        title: 'Render',
        closed: true,
        from: 'Grease Pencil',
        properties: ['antialias_threshold_render', 'aa_samples', 'motion_blur_steps'],
      },
    ],
  },
  {
    // RENDER_PT_simplify, :1079 — `rd.use_simplify` is the header checkbox.
    title: 'Simplify',
    closed: true,
    properties: ['use_simplify'],
    sub: [
      // RENDER_PT_simplify_viewport, :1096.
      {
        title: 'Viewport',
        properties: [
          'simplify_subdivision',
          'simplify_child_particles',
          'simplify_volumes',
          'use_simplify_normals',
        ],
      },
      // RENDER_PT_simplify_render, :1128.
      {
        title: 'Render',
        properties: ['simplify_subdivision_render', 'simplify_child_particles_render'],
      },
    ],
  },
  {
    // RENDER_PT_color_management, :51 — `scene.display_settings.display_device`
    // (:74) then `view = scene.view_settings` (:69).
    title: 'Color Management',
    closed: true,
    from: 'View Settings',
    properties: [
      { from: 'Display Device', property: 'display_device' },
      'view_transform',
      'look',
      'exposure',
      'gamma',
    ],
    sub: [
      // RENDER_PT_color_management_white_balance, :195.
      {
        title: 'White Balance',
        closed: true,
        from: 'View Settings',
        properties: ['use_white_balance', 'white_balance_temperature', 'white_balance_tint'],
      },
      // RENDER_PT_color_management_curves, :157 — the curve widget itself is
      // not drawn here; its toggle and the mapping pointer are.
      {
        title: 'Curves',
        closed: true,
        from: 'View Settings',
        properties: ['use_curve_mapping', 'curve_mapping'],
      },
      // RENDER_PT_color_management_advanced, :135.
      {
        title: 'Advanced',
        closed: true,
        from: 'Display Device',
        properties: ['emulation'],
      },
    ],
  },
];

const TAB = { id: 'render', standing: 'any', curated: CURATED } as const;

export const point = 'selection.inspector';
export const title = 'Render';
/** `blender.icons.json` — Blender's own mark, TRACED from
 *  `release/datafiles/icons_svg/` at the engine's pin (the icon this tab draws
 *  is named in `buttons_context_items`, `makesrna/intern/rna_space.cc:579`),
 *  and tinted by the group `UI_icons.hh` declares it in. */
export const icon = 'properties-render';
/** `ED_buttons_tabs_list` (`space_buttons.cc:218-252`) is the rail's order;
 *  these are that order, spaced so a tab can be inserted between two. */
export const order = 10;
/** THE RAIL'S GROUPS, from `ED_buttons_tabs_list`'s own `add_spacer()` calls
 *  (`space_buttons/space_buttons.cc:201-255`): the tool tab, then the scene
 *  group (Render, Output, View Layer, Scene, World), then Collection, then the
 *  object group (Object … Material), then Texture. The presentation draws a
 *  separator wherever this changes. */
export const railGroup = 'scene';
export const match = blenderPropertiesTabMatch(TAB);
export default blenderPropertiesTabSection(TAB);
