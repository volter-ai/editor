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

const CANVAS_ITEM = ['set_meta:*', 'set_visible', 'set_modulate', 'set_self_modulate', 'set_as_top_level', 'set_z_index', 'set_z_as_relative'];
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
];
// `GeometryInstance3D`'s visibility range: `<GodotVisibilityRange>` around the node's element.
const VISIBILITY_RANGE = [
  'set_visibility_range_begin',
  'set_visibility_range_begin_margin',
  'set_visibility_range_end',
  'set_visibility_range_end_margin',
  'set_visibility_range_fade_mode',
];
const AUDIO_PLAYER = ['set_meta:*', 'set_stream', 'set_volume_db', 'set_pitch_scale', 'set_autoplay', 'set_max_polyphony', 'set_bus'];

/** The setters (`name`, or `name:index` for one index of an indexed property) each family states. */
const NODE_SETTERS: Readonly<Record<string, readonly string[]>> = {
  MeshInstance3D: ['set_mesh', 'set_surface_override_material:*', 'set_layer_mask', 'set_cast_shadows_setting', 'set_skeleton_path', ...VISIBILITY_RANGE],
  // Shadow max distance (9), fade start (13), normal bias (14), bias (15), blur (18): `shadow-mapping`.
  DirectionalLight3D: ['set_color', 'set_param:0', 'set_shadow', 'set_sky_mode', 'set_param:9', 'set_param:13', 'set_param:14', 'set_param:15', 'set_param:18', 'set_shadow_mode'],
  OmniLight3D: ['set_color', 'set_param:0', 'set_param:4', 'set_param:6', 'set_shadow', 'set_param:15', 'set_param:18'],
  // The lens (`fov`, `near`, `far`) is the node's JSX property rules; `current` is the default camera.
  Camera3D: ['set_current'],
  // Compat elements (`useGodotElement`): the props their classes' tables declare.
  CanvasLayer: ['set_meta:*', 'set_layer', 'set_visible', 'set_offset', 'set_rotation', 'set_scale'],
  Control: CONTROL,
  HBoxContainer: [...CONTROL, 'set_alignment'],
  Label: [...CONTROL, 'set_text', 'set_label_settings', 'set_horizontal_alignment', 'set_vertical_alignment', 'set_autowrap_mode'],
  TextureRect: [...CONTROL, 'set_texture', 'set_expand_mode', 'set_stretch_mode', 'set_flip_h', 'set_flip_v'],
  Node2D: NODE_2D,
  Sprite2D: [...NODE_2D, 'set_texture', 'set_centered', 'set_offset', 'set_flip_h', 'set_flip_v', 'set_hframes', 'set_vframes', 'set_frame'],
  TouchScreenButton: [...NODE_2D, 'set_texture_normal', 'set_texture_pressed', 'set_passby_press', 'set_action', 'set_visibility_mode'],
  Label3D: [
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
    'set_param_min:*',
    'set_param_max:*',
    'set_param_curve:*',
    'set_particle_flag:*',
    'set_cast_shadows_setting',
    ...VISIBILITY_RANGE,
  ],
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
  AudioStreamPlayer: AUDIO_PLAYER,
  // The cells are `data`; `cell_scale` has no collider scale and refuses.
  GridMap: [
    'set_meta:*',
    'set_mesh_library',
    'set_cell_size',
    'set_octant_size',
    'set_center_x',
    'set_center_y',
    'set_center_z',
    'set_collision_layer',
    'set_collision_mask',
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
  AudioStreamPlayer3D: [
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
  CylinderMesh: ['set_top_radius', 'set_bottom_radius', 'set_height', 'set_radial_segments', 'set_rings', 'set_cap_top', 'set_cap_bottom', 'set_material'],
  StandardMaterial3D: [
    'set_albedo',
    'set_metallic',
    'set_roughness',
    'set_feature:0',
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
  ],
  ArrayMesh: [],
  CompressedTexture2D: [],
  MeshLibrary: [],
  AnimationLibrary: [],
  LabelSettings: [
    'set_line_spacing',
    'set_paragraph_spacing',
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
 * bottom (three's; Godot's is the top, so `v` becomes `1 - v`, and a tangent's handedness flips with
 * it), the surfaces' arrays joined and a group per surface drawing its material.
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
  const tangent = joined('tangent', (values) => values.map((value, i) => (i % 4 === 3 ? -value : value)));
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
  return godotArrayMeshDataPath(sceneTargetPath, key).replace(/(\.mesh)?\.json$/u, '.library.json');
}

/** Where a GridMap's cells data file is written: beside its scene, by the node's path. */
export function godotGridMapDataPath(sceneTargetPath: string, nodePath: string): string {
  return `${sceneTargetPath.replace(/\.tsx$/u, '')}.${nodePath === '.' ? 'root' : nodePath.replace(/[^A-Za-z0-9_-]+/gu, '_')}.cells.json`;
}
