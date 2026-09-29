/**
 * The node and resource families a scene writes as idiomatic JSX (GODOT.md, "The output is
 * idiomatic three.js"): which authored properties each family's element states, and the data files
 * an `ArrayMesh` becomes. A carried family has no other scene path: a property its element cannot
 * state refuses the scene, whatever shape the rest of the scene is written in.
 */
import type {
  TargetGodotArrayMeshPlan,
  TargetGodotMeshLibraryPlan,
  TargetGodotSceneResourcePlan,
  TargetGodotSceneSetterPlan,
  TargetGodotSceneValue,
} from './scene-document-plan';

const CANVAS_ITEM = ['set_meta:*', 'set_visible', 'set_modulate', 'set_self_modulate', 'set_as_top_level', 'set_z_index', 'set_z_as_relative', 'set_material', 'set_use_parent_material', 'set_texture_filter', 'set_texture_repeat'];
const NODE_2D = [...CANVAS_ITEM, 'set_position', 'set_rotation', 'set_scale', 'set_skew'];
const CONTROL = [
  ...CANVAS_ITEM,
  'set_custom_minimum_size',
  'set_custom_maximum_size',
  '_set_layout_mode',
  '_set_anchors_layout_preset',
  '_set_anchor:*',
  'set_offset:*',
  'set_h_grow_direction',
  'set_v_grow_direction',
  'set_rotation',
  'set_scale',
  'set_pivot_offset',
  'set_h_size_flags',
  'set_v_size_flags',
  'set_stretch_ratio',
  'set_mouse_filter',
  'set_force_pass_scroll_events',
  'set_theme',
  'set_theme_type_variation',
  // The theme overrides, one `themeOverrides` prop (`theme_override_<kind>/NAME`).
  'add_theme_font_size_override:*',
  'add_theme_font_override:*',
  'add_theme_color_override:*',
  'add_theme_constant_override:*',
  'add_theme_stylebox_override:*',
  'add_theme_icon_override:*',
];
// `GeometryInstance3D`'s visibility range: `<GodotVisibilityRange>` around the node's element.
const VISIBILITY_RANGE = [
  'set_visibility_range_begin',
  'set_visibility_range_begin_margin',
  'set_visibility_range_end',
  'set_visibility_range_end_margin',
  'set_visibility_range_fade_mode',
];
// A Node3D's `visible` (`node_3d.cpp:1120`): three's own `visible`, which hides the subtree as
// Godot's visibility in the tree does.
const NODE_3D = ['set_visible'];
// A GeometryInstance3D's `transparency`: stored, never drawn by the web's renderer (`geometry-instance-3d.ts`).
const GEOMETRY_INSTANCE_3D = [...NODE_3D, 'set_transparency'];
// A Node's `physics_interpolation_mode`, which every compat element takes (`useGodotElement`); stored
// (`node.ts`: nothing is interpolated between physics ticks).
const NODE_ELEMENT = ['set_physics_interpolation_mode'];
// The parameters a particle system's emitter reads (`cpu-particles-3d.ts`), by index, the same in
// `CPUParticles3D::Parameter` and `ParticleProcessMaterial::Parameter`: initial velocity, angular
// velocity, linear acceleration, damping, angle and scale. The rest (orbit, radial and tangential
// acceleration, hue variation, animation) is not emitted and refuses the scene by name.
const EMITTED_PARAMS = [0, 1, 3, 6, 7, 8];
// Its particle flags: align Y to velocity and disable Z (rotate Y is not drawn).
const EMITTED_FLAGS = ['set_particle_flag:0', 'set_particle_flag:2'];
const AUDIO_PLAYER = ['set_meta:*', 'set_stream', 'set_volume_db', 'set_pitch_scale', 'set_autoplay', 'set_max_polyphony', 'set_bus'];

// `<GodotSprite3D>` and `<GodotAnimatedSprite3D>`: SpriteBase3D's props (`sprite-base-3d.ts`).
const SPRITE_BASE_3D = [
  ...GEOMETRY_INSTANCE_3D,
  'set_meta:*',
  'set_centered',
  'set_offset',
  'set_flip_h',
  'set_flip_v',
  'set_modulate',
  'set_pixel_size',
  'set_axis',
  'set_billboard_mode',
  'set_draw_flag:0',
  'set_draw_flag:1',
  'set_draw_flag:2',
  'set_draw_flag:3',
  'set_alpha_cut_mode',
  'set_texture_filter',
  'set_render_priority',
  'set_cast_shadows_setting',
  'set_layer_mask',
];

/** The setters (`name`, or `name:index` for one index of an indexed property) each family states. */
const NODE_SETTERS: Readonly<Record<string, readonly string[]>> = {
  MeshInstance3D: [...GEOMETRY_INSTANCE_3D, 'set_mesh', 'set_surface_override_material:*', 'set_material_override', 'set_as_top_level', 'set_layer_mask', 'set_cast_shadows_setting', 'set_skeleton_path', ...VISIBILITY_RANGE],
  // Shadow max distance (9), fade start (13), normal bias (14), bias (15), opacity (17), blur (18):
  // `shadow-mapping`. Split blending and the pancake size (16) are stored: three's one shadow map has
  // no splits to blend, and its shadow camera spans the whole depth `shadow-mapping` gives it, which
  // leaves no casters behind its near plane for a pancake to flatten (`renderer_scene_cull.cpp:2339`).
  DirectionalLight3D: [...NODE_3D, 'set_color', 'set_param:0', 'set_shadow', 'set_sky_mode', 'set_param:9', 'set_param:13', 'set_param:14', 'set_param:15', 'set_param:16', 'set_param:17', 'set_param:18', 'set_shadow_mode', 'set_blend_splits'],
  OmniLight3D: [...NODE_3D, 'set_color', 'set_param:0', 'set_param:4', 'set_param:6', 'set_shadow', 'set_param:15', 'set_param:17', 'set_param:18'],
  // The lens (`fov`, `near`, `far`) is the node's JSX property rules; `current` is the default camera.
  Camera3D: [...NODE_3D, 'set_current', 'set_environment', 'set_cull_mask', 'set_projection', 'set_size', 'set_attributes'],
  // Compat elements (`useGodotElement`): the props their classes' tables declare.
  CanvasLayer: ['set_meta:*', 'set_layer', 'set_visible', 'set_offset', 'set_rotation', 'set_scale'],
  Control: CONTROL,
  HBoxContainer: [...CONTROL, 'set_alignment'],
  VBoxContainer: [...CONTROL, 'set_alignment'],
  MarginContainer: CONTROL,
  CenterContainer: [...CONTROL, 'set_use_top_left'],
  GridContainer: [...CONTROL, 'set_columns'],
  Label: [...CONTROL, 'set_text', 'set_label_settings', 'set_horizontal_alignment', 'set_vertical_alignment', 'set_autowrap_mode'],
  TextureRect: [...CONTROL, 'set_texture', 'set_expand_mode', 'set_stretch_mode', 'set_flip_h', 'set_flip_v'],
  Node2D: NODE_2D,
  Sprite2D: [...NODE_2D, 'set_texture', 'set_centered', 'set_offset', 'set_flip_h', 'set_flip_v', 'set_hframes', 'set_vframes', 'set_frame'],
  TouchScreenButton: [...NODE_2D, 'set_texture_normal', 'set_texture_pressed', 'set_passby_press', 'set_action', 'set_visibility_mode'],
  Label3D: [
    ...GEOMETRY_INSTANCE_3D,
    'set_meta:*',
    'set_pixel_size',
    'set_offset',
    'set_billboard_mode',
    'set_draw_flag:0',
    'set_draw_flag:1',
    'set_draw_flag:2',
    'set_draw_flag:3',
    'set_modulate',
    'set_outline_modulate',
    'set_text',
    'set_font_size',
    'set_outline_size',
    'set_horizontal_alignment',
    'set_vertical_alignment',
    'set_line_spacing',
    'set_autowrap_mode',
    'set_width',
    ...VISIBILITY_RANGE,
  ],
  CPUParticles3D: [
    ...GEOMETRY_INSTANCE_3D,
    ...NODE_ELEMENT,
    'set_emitting',
    'set_amount',
    'set_lifetime',
    'set_one_shot',
    'set_pre_process_time',
    'set_explosiveness_ratio',
    'set_randomness_ratio',
    'set_lifetime_randomness',
    'set_use_local_coordinates',
    'set_speed_scale',
    'set_fixed_fps',
    'set_fractional_delta',
    'set_visibility_aabb',
    'set_mesh',
    'set_direction',
    'set_spread',
    'set_flatness',
    'set_gravity',
    'set_color',
    'set_color_ramp',
    'set_color_initial_ramp',
    'set_emission_shape',
    'set_emission_sphere_radius',
    'set_emission_box_extents',
    'set_use_fixed_seed',
    'set_seed',
    ...EMITTED_PARAMS.flatMap((param) => [`set_param_min:${String(param)}`, `set_param_max:${String(param)}`, `set_param_curve:${String(param)}`]),
    ...EMITTED_FLAGS,
    'set_cast_shadows_setting',
    'set_material_override',
    ...VISIBILITY_RANGE,
  ],
  // `<GodotGPUParticles3D>`: the three.js particle system reading its process material
  // (`gpu-particles-3d.ts`). What the emitter does not do has no prop: sub-emitters, trails,
  // collision, transform alignment, the amount ratio, interpolation to the end, a skin.
  GPUParticles3D: [
    ...GEOMETRY_INSTANCE_3D,
    ...NODE_ELEMENT,
    'set_emitting',
    'set_amount',
    'set_lifetime',
    'set_one_shot',
    'set_pre_process_time',
    'set_speed_scale',
    'set_explosiveness_ratio',
    'set_randomness_ratio',
    'set_use_fixed_seed',
    'set_seed',
    'set_fixed_fps',
    'set_interpolate',
    'set_fractional_delta',
    'set_visibility_aabb',
    'set_use_local_coordinates',
    'set_draw_order',
    'set_process_material',
    'set_draw_passes',
    'set_draw_pass_mesh:0',
    'set_material_override',
    'set_cast_shadows_setting',
    ...VISIBILITY_RANGE,
  ],
  // `<GodotCSGBox3D>`, a box mesh of its size (`csg-box-3d.ts`).
  CSGBox3D: [...NODE_3D, 'set_size', 'set_material', 'set_use_collision'],
  // `<GodotDecal>`, which draws nothing as the web export's Compatibility renderer (`decal.ts`).
  Decal: [
    ...NODE_3D,
    'set_size',
    'set_texture:*',
    'set_emission_energy',
    'set_modulate',
    'set_albedo_mix',
    'set_normal_fade',
    'set_upper_fade',
    'set_lower_fade',
    'set_enable_distance_fade',
    'set_distance_fade_begin',
    'set_distance_fade_length',
    'set_cull_mask',
  ],
  // `<GodotWorldEnvironment>` (`world-environment.ts`).
  WorldEnvironment: ['set_environment'],
  // The reflections capability's `<ReflectionProbe>` (`reflection-probe.ts`).
  ReflectionProbe: [
    'set_update_mode',
    'set_intensity',
    'set_blend_distance',
    'set_max_distance',
    'set_size',
    'set_origin_offset',
    'set_enable_box_projection',
    'set_as_interior',
    'set_enable_shadows',
    'set_cull_mask',
    'set_reflection_mask',
    'set_mesh_lod_threshold',
    'set_ambient_mode',
    'set_ambient_color',
    'set_ambient_color_energy',
  ],
  Sprite3D: [...SPRITE_BASE_3D, 'set_texture', 'set_hframes', 'set_vframes', 'set_frame', 'set_region_enabled', 'set_region_rect'],
  AnimatedSprite3D: [...SPRITE_BASE_3D, 'set_sprite_frames', 'set_animation', 'set_autoplay', 'set_frame', 'set_frame_progress', 'set_speed_scale'],
  SubViewportContainer: [...CONTROL, 'set_stretch', 'set_stretch_shrink'],
  SubViewport: ['set_meta:*', 'set_size', 'set_update_mode', 'set_transparent_background', 'set_handle_input_locally', 'set_msaa_3d'],
  Area2D: [...NODE_2D, 'set_collision_layer', 'set_collision_mask', 'set_monitoring', 'set_monitorable'],
  CollisionShape2D: [...NODE_2D, 'set_shape', 'set_disabled'],
  GPUParticles2D: [...NODE_2D, 'set_emitting', 'set_amount', 'set_lifetime', 'set_one_shot', 'set_speed_scale', 'set_explosiveness_ratio', 'set_randomness_ratio', 'set_use_local_coordinates', 'set_texture', 'set_process_material'],
  AnimatedSprite2D: [...NODE_2D, 'set_sprite_frames', 'set_animation', 'set_autoplay', 'set_frame', 'set_frame_progress', 'set_speed_scale', 'set_centered', 'set_offset', 'set_flip_h', 'set_flip_v'],
  StaticBody2D: [...NODE_2D, 'set_collision_layer', 'set_collision_mask', 'set_physics_material_override', 'set_constant_linear_velocity', 'set_constant_angular_velocity'],
  RigidBody2D: [...NODE_2D, 'set_collision_layer', 'set_collision_mask', 'set_gravity_scale', 'set_mass', 'set_linear_velocity', 'set_angular_velocity', 'set_linear_damp', 'set_angular_damp', 'set_freeze_enabled', 'set_lock_rotation_enabled', 'set_contact_monitor', 'set_max_contacts_reported', 'set_physics_material_override', 'set_can_sleep'],
  CharacterBody2D: [...NODE_2D, 'set_collision_layer', 'set_collision_mask', 'set_velocity', 'set_up_direction', 'set_floor_max_angle', 'set_floor_snap_length', 'set_max_slides', 'set_motion_mode', 'set_safe_margin'],
  ColorRect: [...CONTROL, 'set_color'],
  Marker2D: [...NODE_2D, 'set_gizmo_extents'],
  VisibleOnScreenNotifier2D: [...NODE_2D, 'set_rect'],
  Path2D: [...NODE_2D, 'set_curve'],
  PathFollow2D: [...NODE_2D, 'set_progress', 'set_progress_ratio', 'set_h_offset', 'set_v_offset', 'set_rotates', 'set_loop', 'set_cubic_interpolation'],
  Camera2D: [...NODE_2D, 'set_offset', 'set_zoom', 'set_anchor_mode', 'set_enabled', 'set_limit:0', 'set_limit:1', 'set_limit:2', 'set_limit:3', 'set_position_smoothing_enabled', 'set_position_smoothing_speed', 'set_ignore_rotation', 'set_process_callback', 'set_drag_horizontal_enabled', 'set_drag_vertical_enabled', 'set_limit_smoothing_enabled', 'set_margin_drawing_enabled', 'set_limit_drawing_enabled', 'set_screen_drawing_enabled'],
  TileMapLayer: [...NODE_2D, 'set_tile_set', 'set_tile_map_data_from_array', 'set_enabled', 'set_collision_enabled', 'set_rendering_quadrant_size', 'set_y_sort_origin', 'set_navigation_enabled', 'set_use_kinematic_bodies', 'set_collision_visibility_mode', 'set_navigation_visibility_mode'],
  Path3D: [...NODE_3D, 'set_meta:*', 'set_curve'],
  PathFollow3D: [...NODE_3D, 'set_meta:*', 'set_progress', 'set_progress_ratio', 'set_h_offset', 'set_v_offset', 'set_rotation_mode', 'set_loop', 'set_cubic_interpolation', 'set_tilt_enabled', 'set_use_model_front'],
  VisibleOnScreenNotifier3D: [...NODE_3D, 'set_meta:*', 'set_aabb'],
  Button: [...CONTROL, 'set_disabled', 'set_toggle_mode', 'set_pressed', 'set_action_mode', 'set_keep_pressed_outside', 'set_shortcut', 'set_button_mask', 'set_shortcut_feedback', 'set_shortcut_in_tooltip', 'set_button_group', 'set_text', 'set_flat', 'set_text_alignment', 'set_clip_text', 'set_button_icon', 'set_expand_icon', 'set_icon_alignment'],
  CheckBox: [...CONTROL, 'set_disabled', 'set_toggle_mode', 'set_pressed', 'set_action_mode', 'set_keep_pressed_outside', 'set_shortcut', 'set_button_mask', 'set_shortcut_feedback', 'set_shortcut_in_tooltip', 'set_button_group', 'set_text', 'set_flat', 'set_text_alignment', 'set_clip_text', 'set_button_icon', 'set_expand_icon', 'set_icon_alignment'],
  HSlider: [...CONTROL, 'set_min', 'set_max', 'set_step', 'set_page', 'set_value', 'set_use_rounded_values', 'set_allow_greater', 'set_allow_lesser', 'set_exp_ratio', 'set_editable'],
  TextureButton: [...CONTROL, 'set_disabled', 'set_toggle_mode', 'set_pressed', 'set_action_mode', 'set_keep_pressed_outside', 'set_shortcut', 'set_button_mask', 'set_shortcut_feedback', 'set_shortcut_in_tooltip', 'set_button_group', 'set_texture_normal', 'set_texture_pressed', 'set_texture_hover', 'set_texture_disabled', 'set_texture_focused', 'set_ignore_texture_size', 'set_stretch_mode', 'set_flip_h', 'set_flip_v'],
  Timer: ['set_meta:*', ...NODE_ELEMENT, 'set_wait_time', 'set_one_shot', 'set_autostart', 'set_paused', 'set_ignore_time_scale', 'set_timer_process_callback'],
  AudioStreamPlayer: AUDIO_PLAYER,
  // The cells are `data`; `cell_scale` has no collider scale and refuses.
  GridMap: [
    ...NODE_3D,
    'set_meta:*',
    'set_mesh_library',
    'set_cell_size',
    'set_octant_size',
    'set_center_x',
    'set_center_y',
    'set_center_z',
    'set_collision_layer',
    'set_collision_mask',
    // The cells' colliders' friction and restitution (`grid-map.ts`).
    'set_physics_material',
    'godot_grid_map_set_data',
  ],
  // The libraries are `libraries/NAME`; the tracks' bindings are resolved at import (`scene-animation.ts`).
  AnimationPlayer: [
    'set_meta:*',
    'godot_animation_mixer_set_library:*',
    'set_active',
    'set_deterministic',
    'set_reset_on_save_enabled',
    'set_callback_mode_process',
    'set_callback_mode_method',
    'set_callback_mode_discrete',
    'set_autoplay',
    'set_auto_capture',
    'set_default_blend_time',
    'set_speed_scale',
  ],
  // The parameters are `parameters/<path>`; the tracks bind as its AnimationPlayer's do.
  AnimationTree: [
    'set_meta:*',
    'set_root_node',
    'set_tree_root',
    'set_animation_player',
    'godot_animation_tree_set:*',
    'set_active',
    'set_deterministic',
    'set_callback_mode_process',
    'set_callback_mode_method',
    'set_callback_mode_discrete',
  ],
  AudioStreamPlayer3D: [
    ...NODE_3D,
    ...AUDIO_PLAYER,
    'set_attenuation_model',
    'set_unit_size',
    'set_max_db',
    'set_max_distance',
    'set_panning_strength',
    'set_doppler_tracking',
  ],
};

const PRIMITIVE_PLANE = ['set_size', 'set_subdivide_width', 'set_subdivide_depth', 'set_orientation', 'set_material'];

const RESOURCE_SETTERS: Readonly<Record<string, readonly string[]>> = {
  PlaneMesh: PRIMITIVE_PLANE,
  QuadMesh: PRIMITIVE_PLANE,
  SphereMesh: ['set_radius', 'set_height', 'set_radial_segments', 'set_rings', 'set_is_hemisphere', 'set_material'],
  BoxMesh: ['set_size', 'set_subdivide_width', 'set_subdivide_height', 'set_subdivide_depth', 'set_material'],
  CylinderMesh: ['set_top_radius', 'set_bottom_radius', 'set_height', 'set_radial_segments', 'set_rings', 'set_cap_top', 'set_cap_bottom', 'set_material'],
  StandardMaterial3D: [
    'set_albedo',
    'set_metallic',
    'set_roughness',
    'set_feature:0',
    'set_feature:4',
    'set_anisotropy',
    'set_emission',
    'set_emission_energy_multiplier',
    'set_transparency',
    'set_blend_mode',
    'set_shading_mode',
    'set_texture:0',
    'set_texture:2',
    'set_texture_filter',
    'set_flag:16',
    // Culling, vertex colour (as albedo, sRGB), the billboard and proximity fade (`base-material-3d.ts`).
    'set_cull_mode',
    'set_flag:1',
    'set_flag:2',
    'set_flag:5',
    'set_billboard_mode',
    'set_particles_anim_h_frames',
    'set_particles_anim_v_frames',
    'set_particles_anim_loop',
    'set_proximity_fade_enabled',
    'set_proximity_fade_distance',
    // Depth draw as three's `depthWrite`; the shading modes, specular amount, rim (feature 2),
    // backlight (feature 9), grow and distance fade as the scene shader (`base-material-3d.ts`).
    'set_depth_draw_mode',
    'set_diffuse_mode',
    'set_specular_mode',
    'set_specular',
    'set_feature:2',
    'set_rim',
    'set_rim_tint',
    'set_feature:9',
    'set_backlight',
    'set_grow_enabled',
    'set_grow',
    'set_distance_fade',
    'set_distance_fade_min_distance',
    'set_distance_fade_max_distance',
    // Shadows not received (`FLAG_DONT_RECEIVE_SHADOWS`), as the scene shader.
    'set_flag:13',
    // UV1 triplanar mapping, its scale, offset and blend sharpness, as the scene shader.
    'set_flag:6',
    'set_flag:8',
    'set_uv1_triplanar_blend_sharpness',
    'set_uv1_scale',
    'set_uv1_offset',
    // Stored: the stencil effect draws only through `stencil_mode`, which has no prop.
    'set_stencil_flags',
    'set_stencil_effect_color',
    'set_stencil_effect_outline_thickness',
  ],
  ArrayMesh: [],
  CompressedTexture2D: [],
  RectangleShape2D: ['set_size'],
  Shortcut: ['set_events'],
  InputEventAction: ['set_action', 'set_pressed', 'set_strength'],
  // Kept by their raw properties (`rawProperties`): no setters.
  TileSet: [],
  TileSetAtlasSource: [],
  TileSetScenesCollectionSource: [],
  CanvasItemMaterial: ['set_blend_mode', 'set_light_mode', 'set_particles_animation'],
  Curve2D: ['_set_data', 'set_bake_interval'],
  Curve3D: ['_set_data', 'set_point_count', 'set_bake_interval', 'set_up_vector_enabled'],
  CapsuleShape2D: ['set_radius', 'set_height'],
  CircleShape2D: ['set_radius'],
  AtlasTexture: ['set_atlas', 'set_region', 'set_margin', 'set_filter_clip'],
  // A scene's component (`packedScene`) and a resource of a script's class (`scriptResource`): no setters.
  PackedScene: [],
  Resource: [],
  SpriteFrames: ['_set_animations'],
  MeshLibrary: [],
  AnimationLibrary: [],
  AnimationNodeBlendTree: [],
  LabelSettings: [
    'set_line_spacing',
    'set_paragraph_spacing',
    'set_font',
    'set_font_size',
    'set_font_color',
    'set_outline_size',
    'set_outline_color',
    'set_shadow_size',
    'set_shadow_color',
    'set_shadow_offset',
  ],
  PlaceholderTexture2D: ['set_size'],
  CanvasTexture: ['set_diffuse_texture'],
  AudioStreamWAV: [],
  AudioStreamOggVorbis: [],
  FontFile: [],
  // An environment's background, ambient light, tone mapping and fog (`environment.ts`, `world-environment.ts`).
  Environment: [
    'set_background',
    'set_bg_color',
    'set_bg_energy_multiplier',
    'set_sky',
    'set_ambient_source',
    'set_ambient_light_color',
    'set_ambient_light_sky_contribution',
    'set_ambient_light_energy',
    'set_reflection_source',
    'set_tonemapper',
    'set_tonemap_exposure',
    'set_tonemap_white',
    'set_tonemap_agx_white',
    'set_tonemap_agx_contrast',
    'set_fog_enabled',
    'set_fog_mode',
    'set_fog_light_color',
    'set_fog_light_energy',
    'set_fog_sun_scatter',
    'set_fog_density',
    'set_fog_sky_affect',
    'set_fog_height',
    'set_fog_height_density',
    // The post pass (`world-environment.ts`: postprocessing's effects).
    'set_glow_enabled',
    'set_glow_intensity',
    'set_glow_bloom',
    'set_glow_hdr_bleed_threshold',
    'set_glow_hdr_bleed_scale',
    'set_glow_hdr_luminance_cap',
    'set_ssao_enabled',
    'set_ssao_radius',
    'set_ssao_intensity',
    'set_adjustment_enabled',
    'set_adjustment_brightness',
    'set_adjustment_contrast',
    'set_adjustment_saturation',
    // Stored, never drawn by the Compatibility renderer (`environment.ts`).
    'set_ssao_power',
    'set_ssao_horizon',
    'set_glow_level:*',
    'set_sdfgi_cascades',
    'set_sdfgi_energy',
    'set_ssil_enabled',
    'set_ssil_radius',
    'set_ssil_intensity',
    'set_glow_strength',
    'set_glow_normalized',
    'set_volumetric_fog_enabled',
    'set_volumetric_fog_density',
    'set_volumetric_fog_albedo',
    'set_volumetric_fog_emission',
  ],
  Sky: ['set_material', 'set_radiance_size', 'set_process_mode'],
  PanoramaSkyMaterial: ['set_panorama', 'set_filtering_enabled', 'set_energy_multiplier'],
  ProceduralSkyMaterial: ['set_sky_top_color', 'set_sky_horizon_color', 'set_sky_curve', 'set_sky_energy_multiplier', 'set_sky_cover', 'set_sky_cover_modulate', 'set_ground_bottom_color', 'set_ground_horizon_color', 'set_ground_curve', 'set_ground_energy_multiplier', 'set_sun_angle_max', 'set_sun_curve', 'set_use_debanding', 'set_energy_multiplier'],
  PhysicalSkyMaterial: ['set_rayleigh_coefficient', 'set_rayleigh_color', 'set_mie_coefficient', 'set_mie_eccentricity', 'set_mie_color', 'set_turbidity', 'set_sun_disk_scale', 'set_ground_color', 'set_energy_multiplier', 'set_use_debanding', 'set_night_sky'],
  ShaderMaterial: ['set_shader', 'set_shader_parameter:*', 'set_render_priority'],
  Shader: [],
  // Its items are raw properties (`Type/colors/name`), the constructor's own (`theme.ts`).
  Theme: [],
  // Its defaults only, which draw nothing (`camera-attributes-practical.ts`).
  CameraAttributesPractical: [],
  CompressedCubemap: [],
  // The parameters a GPUParticles3D's emitter reads (`gpu-particles-3d.ts`); the rest (turbulence,
  // collision, sub-emitters, attractors, 3D scale and rotation, velocity limits, the other
  // parameters, emission curves, textures and offsets, ring axis) is not emitted.
  ParticleProcessMaterial: [
    'set_direction',
    'set_spread',
    'set_flatness',
    ...EMITTED_PARAMS.flatMap((param) => [`set_param_min:${String(param)}`, `set_param_max:${String(param)}`, `set_param_texture:${String(param)}`]),
    'set_color',
    'set_color_ramp',
    'set_color_initial_ramp',
    'set_alpha_curve',
    ...EMITTED_FLAGS,
    'set_emission_shape',
    'set_emission_sphere_radius',
    'set_emission_box_extents',
    'set_gravity',
    'set_lifetime_randomness',
    'set_emission_ring_axis',
    'set_emission_ring_height',
    'set_emission_ring_radius',
    'set_emission_ring_inner_radius',
    'set_emission_ring_cone_angle',
  ],
  CurveTexture: ['set_curve', 'set_width'],
  GradientTexture1D: ['set_gradient', 'set_width'],
  Curve: ['_set_limits', 'set_bake_resolution', '_set_data', 'set_point_count'],
  Gradient: ['set_interpolation_mode', 'set_interpolation_color_space', 'set_offsets', 'set_colors'],
  GradientTexture2D: ['set_gradient', 'set_width', 'set_height', 'set_fill', 'set_fill_from', 'set_fill_to', 'set_repeat'],
  AudioStreamRandomizer: ['set_playback_mode', 'set_random_pitch', 'set_random_volume_offset_db', 'set_streams_count', 'set_stream:*', 'set_stream_probability_weight:*'],
};

/** Whether `className`'s nodes are written by a family's element. */
export function godotFamilyCarriesNode(className: string): boolean {
  return Object.hasOwn(NODE_SETTERS, className);
}

/** Whether `className`'s resources are written by a family's element or loader. */
export function godotFamilyCarriesResource(className: string): boolean {
  return Object.hasOwn(RESOURCE_SETTERS, className);
}

function valueOf(setters: readonly TargetGodotSceneSetterPlan[], exportName: string): TargetGodotSceneValue | undefined {
  return setters.find((entry) => entry.setter.exportName === exportName)?.value;
}

function numberOf(setters: readonly TargetGodotSceneSetterPlan[], exportName: string, initial: number): number {
  const value = valueOf(setters, exportName);
  return value?.kind === 'number' ? value.value : initial;
}

function boolOf(setters: readonly TargetGodotSceneSetterPlan[], exportName: string, initial: boolean): boolean {
  const value = valueOf(setters, exportName);
  return value?.kind === 'bool' ? value.value : initial;
}

function unstated(allowed: readonly string[], setters: readonly TargetGodotSceneSetterPlan[]): TargetGodotSceneSetterPlan | undefined {
  return setters.find(
    (entry) =>
      !allowed.includes(entry.setter.exportName) &&
      !allowed.includes(`${entry.setter.exportName}:*`) &&
      !allowed.includes(`${entry.setter.exportName}:${String(entry.index)}`),
  );
}

const f32 = Math.fround;

/**
 * Why a family's element cannot state these authored properties (the property named), or
 * undefined when it can.
 */
export function godotFamilyRefusal(
  className: string,
  kind: 'node' | 'resource',
  setters: readonly TargetGodotSceneSetterPlan[],
): string | undefined {
  const allowed = (kind === 'node' ? NODE_SETTERS : RESOURCE_SETTERS)[className];
  if (allowed === undefined) return undefined;
  const extra = unstated(allowed, setters);
  if (extra !== undefined) return `${extra.propertyName} has no ${className} element prop`;
  switch (className) {
    case 'SphereMesh': {
      if (boolOf(setters, 'set_is_hemisphere', false)) return 'is_hemisphere has no three sphere';
      const radius = numberOf(setters, 'set_radius', 0.5);
      const height = numberOf(setters, 'set_height', 1);
      return f32(height) === f32(radius * 2) ? undefined : 'a height other than the diameter has no three sphere';
    }
    case 'CylinderMesh':
      return boolOf(setters, 'set_cap_top', true) === boolOf(setters, 'set_cap_bottom', true)
        ? undefined
        : 'one cap without the other has no three cylinder';
    case 'Environment': {
      const background = numberOf(setters, 'set_background', 0);
      if (background !== 1 && background !== 2) return `background_mode=${String(background)} is not drawn`;
      // The fog's settings draw nothing while the fog is off (`rasterizer_scene_gles3.cpp:1646`).
      // Height fog and sun scatter draw as the distance fog alone (`world-environment.ts`).
      const fogOn = boolOf(setters, 'set_fog_enabled', false);
      if (fogOn && numberOf(setters, 'set_fog_mode', 0) !== 0) return 'depth fog is not drawn';
      return undefined;
    }
    case 'GPUParticles3D': {
      if (numberOf(setters, 'set_draw_order', 0) !== 0) return 'draw_order other than by index is not drawn';
      if (numberOf(setters, 'set_draw_passes', 1) !== 1) return 'draw_passes after the first are not drawn';
      return undefined;
    }
    case 'CPUParticles3D':
    case 'ParticleProcessMaterial': {
      // The emitter emits from a point, a sphere, a sphere's surface, a box and (a process
      // material's) a ring; not from `_POINTS` or `_DIRECTED_POINTS`, which need their emission
      // textures (`particle_process_material.h:88`, `cpu_particles_3d.h:75`).
      const shape = numberOf(setters, 'set_emission_shape', 0);
      return shape === 4 || shape === 5 || (shape === 6 && className !== 'ParticleProcessMaterial') ? `emission_shape=${String(shape)} is not emitted from` : undefined;
    }
    case 'StandardMaterial3D': {
      const transparency = numberOf(setters, 'set_transparency', 0);
      if (transparency > 2) return `transparency=${String(transparency)} has no three form`;
      const blend = numberOf(setters, 'set_blend_mode', 0);
      if (blend > 3) return `blend_mode=${String(blend)} has no three form`;
      const shading = numberOf(setters, 'set_shading_mode', 1);
      if (shading > 1) return `shading_mode=${String(shading)} has no three form`;
      if (numberOf(setters, 'set_particles_anim_h_frames', 1) !== 1 || numberOf(setters, 'set_particles_anim_v_frames', 1) !== 1) {
        return 'particle animation frames other than one by one are not drawn';
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

/** An `ArrayMesh` as three reads it: the surfaces joined, a group per surface. */
export interface GodotArrayMeshData {
  readonly position: readonly number[];
  readonly normal?: readonly number[];
  readonly tangent?: readonly number[];
  readonly color?: readonly number[];
  readonly uv?: readonly number[];
  readonly uv1?: readonly number[];
  readonly index: readonly number[];
  readonly groups: readonly { readonly start: number; readonly count: number; readonly materialIndex: number }[];
}

/** Why an `ArrayMesh`'s surfaces have no joined three geometry, or undefined. */
export function godotArrayMeshRefusal(mesh: TargetGodotArrayMeshPlan): string | undefined {
  // `PRIMITIVE_TRIANGLES` (`rendering_server_enums.h:208`).
  if (mesh.surfaces.some((surface) => surface.primitive !== 3)) return 'a surface that is not triangles';
  const present = (surface: TargetGodotArrayMeshPlan['surfaces'][number]) =>
    Object.entries(surface.arrays)
      .filter(([, values]) => values !== undefined)
      .map(([name]) => (name === 'index' ? '' : name))
      .join();
  const first = mesh.surfaces[0];
  if (first !== undefined && mesh.surfaces.some((surface) => present(surface) !== present(first))) {
    return 'surfaces with different arrays';
  }
  return undefined;
}

/**
 * The surfaces converted at import into three's conventions: each triangle's last two indices
 * exchanged (Godot's front faces wind clockwise, `glFrontFace(GL_CW)`), UVs with their origin at the
 * image's bottom row (three's; Godot's is the top row, so `v` becomes `1 - v`, and a material samples
 * the image as three uploads it, compat's `godot_base_material_3d_scene_map`), the surfaces' arrays
 * joined and a group per surface drawing its material.
 *
 * The tangents are Godot's as they are, sign included. Both renderers make the bitangent
 * `cross(normal, tangent) * w` and read a normal map's green channel along it (Godot's `scene.glsl`
 * vertex stage and `normal_map` blend; three's `normal_vertex` and the `tbn` of
 * `normal_fragment_begin`), and both want it pointing up the image: Godot stores mikktspace's
 * bitangent negated (`SurfaceTool::mikktSetTSpaceDefault`), so with its `v` running down the image
 * `w` makes it point up; three's own `computeTangents` makes it point along its `v`, which runs up the
 * image. Flipping `v` changes which way `v` runs, not which way is up on the surface, so `w` keeps its
 * sign. (Where there are no tangents, three derives the bitangent from `v` itself, `getTangentFrame`,
 * and three's `v` running up gives the same direction.)
 */
export function godotArrayMeshData(mesh: TargetGodotArrayMeshPlan): GodotArrayMeshData {
  const joined = (name: keyof TargetGodotArrayMeshPlan['surfaces'][number]['arrays'], map: (values: readonly number[]) => number[] = (values) => [...values]) => {
    if (mesh.surfaces.every((surface) => surface.arrays[name] === undefined)) return undefined;
    return mesh.surfaces.flatMap((surface) => map(surface.arrays[name] as readonly number[]));
  };
  const flipV = (values: readonly number[]) => values.map((value, i) => (i % 2 === 1 ? f32(1 - value) : value));
  const index: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  let base = 0;
  mesh.surfaces.forEach((surface, materialIndex) => {
    const vertices = surface.arrays.vertex?.length ?? 0;
    const own = surface.arrays.index ?? Array.from({ length: vertices / 3 }, (_, i) => i);
    const start = index.length;
    for (let i = 0; i + 2 < own.length; i += 3) {
      index.push((own[i] as number) + base, (own[i + 2] as number) + base, (own[i + 1] as number) + base);
    }
    groups.push({ start, count: index.length - start, materialIndex });
    base += vertices / 3;
  });
  const normal = joined('normal');
  const tangent = joined('tangent');
  const color = joined('color');
  const uv = joined('tex_uv', flipV);
  const uv1 = joined('tex_uv2', flipV);
  return {
    position: joined('vertex') ?? [],
    ...(normal === undefined ? {} : { normal }),
    ...(tangent === undefined ? {} : { tangent }),
    ...(color === undefined ? {} : { color }),
    ...(uv === undefined ? {} : { uv }),
    ...(uv1 === undefined ? {} : { uv1 }),
    index,
    groups: mesh.surfaces.length > 1 ? groups : [],
  };
}

/**
 * Where an `ArrayMesh`'s data file is written: a scene's own sub-resource beside the scene, a
 * resource file's under `src/meshes/` (shared by every scene that uses it).
 */
export function godotArrayMeshDataPath(sceneTargetPath: string, key: string): string {
  const safe = (text: string) => text.replace(/[^A-Za-z0-9._/-]+/gu, '_');
  if (key.startsWith('sub:')) return `${sceneTargetPath.replace(/\.tsx$/u, '')}.${safe(key.slice('sub:'.length))}.mesh.json`;
  const [file, sub] = key.slice('ext:res://'.length).split('#sub:') as [string, string | undefined];
  return `src/meshes/${safe(file)}${sub === undefined ? '' : `.${safe(sub)}`}.json`;
}

/** The shape classes a MeshLibrary item's shapes may be, and the kind its data file names. */
const SHAPE_KIND: Readonly<Record<string, 'box' | 'sphere' | 'capsule' | 'convex' | 'concave'>> = {
  BoxShape3D: 'box',
  SphereShape3D: 'sphere',
  CapsuleShape3D: 'capsule',
  ConvexPolygonShape3D: 'convex',
  ConcavePolygonShape3D: 'concave',
};

/** Whether a MeshLibrary item's shape of this class has a collider. */
export function godotMeshLibraryShapeClass(className: string): boolean {
  return Object.hasOwn(SHAPE_KIND, className);
}

/** A MeshLibrary as its data file (`mesh-library.ts`'s `GodotMeshLibraryData`): items and their shapes' properties. */
export function godotMeshLibraryData(
  library: TargetGodotMeshLibraryPlan,
  resources: ReadonlyMap<string, TargetGodotSceneResourcePlan>,
): unknown {
  const value = (setters: readonly TargetGodotSceneSetterPlan[], name: string) => setters.find((entry) => entry.setter.exportName === name)?.value;
  const components = (setters: readonly TargetGodotSceneSetterPlan[], name: string) => {
    const found = value(setters, name);
    return found !== undefined && 'components' in found ? [...found.components] : undefined;
  };
  const number = (setters: readonly TargetGodotSceneSetterPlan[], name: string) => {
    const found = value(setters, name);
    return found?.kind === 'number' ? found.value : undefined;
  };
  return {
    items: library.items.map((item) => ({
      id: item.id,
      name: item.name,
      meshTransform: item.meshTransform,
      castShadow: item.castShadow,
      shapes: item.shapes.map((entry) => {
        const shape = resources.get(entry.shape) as TargetGodotSceneResourcePlan;
        const set = shape.setters;
        const backface = value(set, 'set_backface_collision_enabled');
        return {
          kind: SHAPE_KIND[shape.className],
          ...(components(set, 'set_size') === undefined ? {} : { size: components(set, 'set_size') }),
          ...(number(set, 'set_radius') === undefined ? {} : { radius: number(set, 'set_radius') }),
          ...(number(set, 'set_height') === undefined ? {} : { height: number(set, 'set_height') }),
          ...(components(set, 'set_points') === undefined ? {} : { points: components(set, 'set_points') }),
          ...(components(set, 'set_faces') === undefined ? {} : { faces: components(set, 'set_faces') }),
          ...(backface?.kind === 'bool' ? { backfaceCollision: backface.value } : {}),
          transform: entry.transform,
        };
      }),
    })),
  };
}

/** Where a MeshLibrary's data file is written, beside its meshes' (`godotArrayMeshDataPath`). */
export function godotMeshLibraryDataPath(sceneTargetPath: string, key: string): string {
  return godotArrayMeshDataPath(sceneTargetPath, key).replace(/(\.mesh)?\.json$/u, '.library.ts');
}

/** Where a GridMap's cells data file is written: beside its scene, by the node's path. */
export function godotGridMapDataPath(sceneTargetPath: string, nodePath: string): string {
  return `${sceneTargetPath.replace(/\.tsx$/u, '')}.${nodePath === '.' ? 'root' : nodePath.replace(/[^A-Za-z0-9_-]+/gu, '_')}.cells.json`;
}
