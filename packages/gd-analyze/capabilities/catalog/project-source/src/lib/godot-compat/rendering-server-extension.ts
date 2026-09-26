import { registerGodotObjectIdentity } from './object';

export type GodotRenderingRID = object;
export interface GodotRenderingVector2 { readonly x: number; readonly y: number }
export interface GodotRenderingVector3 { readonly x: number; readonly y: number; readonly z: number }
export interface GodotRenderingColor { readonly r: number; readonly g: number; readonly b: number; readonly a: number }
export type GodotRenderingServerExtensionHooks = Readonly<Record<string, (...args: readonly unknown[]) => unknown>>;

export class GodotRenderingServerExtension {
  constructor(private readonly hooks: GodotRenderingServerExtensionHooks) {
    registerGodotObjectIdentity(this, 'RenderingServerExtension');
  }

  private call(name: string, ...args: readonly unknown[]): unknown {
    const hook = this.hooks[name];
    if (hook === undefined) throw new Error(`${name} is not implemented by this rendering server extension.`);
    return hook(...args);
  }

  private rid(name: string, ...args: readonly unknown[]): GodotRenderingRID {
    const value = this.call(name, ...args);
    if (value === null || typeof value !== 'object') throw new TypeError(`${name} must return RID.`);
    return value;
  }

  private number(name: string, ...args: readonly unknown[]): number {
    const value = this.call(name, ...args);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must return a finite number.`);
    return value;
  }

  private boolean(name: string, ...args: readonly unknown[]): boolean { return Boolean(this.call(name, ...args)); }
  private array<T>(name: string, ...args: readonly unknown[]): T[] {
    const value = this.call(name, ...args);
    if (!Array.isArray(value)) throw new TypeError(`${name} must return Array.`);
    return value as T[];
  }

  _texture_2d_create(image: unknown): GodotRenderingRID { return this.rid('_texture_2d_create', image); }
  _texture_2d_layered_create(layers: readonly unknown[], layeredType: number): GodotRenderingRID { return this.rid('_texture_2d_layered_create', layers, layeredType); }
  _texture_3d_create(format: number, width: number, height: number, depth: number, mipmaps: boolean, data: readonly unknown[]): GodotRenderingRID { return this.rid('_texture_3d_create', format, width, height, depth, mipmaps, data); }
  _texture_proxy_create(base: GodotRenderingRID): GodotRenderingRID { return this.rid('_texture_proxy_create', base); }
  _texture_2d_update(texture: GodotRenderingRID, image: unknown, layer = 0): void { this.call('_texture_2d_update', texture, image, layer); }
  _texture_3d_update(texture: GodotRenderingRID, data: readonly unknown[]): void { this.call('_texture_3d_update', texture, data); }
  _texture_proxy_update(texture: GodotRenderingRID, proxyTo: GodotRenderingRID): void { this.call('_texture_proxy_update', texture, proxyTo); }
  _texture_2d_placeholder_create(): GodotRenderingRID { return this.rid('_texture_2d_placeholder_create'); }
  _texture_2d_layered_placeholder_create(layeredType: number): GodotRenderingRID { return this.rid('_texture_2d_layered_placeholder_create', layeredType); }
  _texture_3d_placeholder_create(): GodotRenderingRID { return this.rid('_texture_3d_placeholder_create'); }
  _texture_2d_get(texture: GodotRenderingRID): unknown { return this.call('_texture_2d_get', texture); }
  _texture_2d_layer_get(texture: GodotRenderingRID, layer: number): unknown { return this.call('_texture_2d_layer_get', texture, layer); }
  _texture_3d_get(texture: GodotRenderingRID): unknown[] { return this.array('_texture_3d_get', texture); }
  _texture_replace(texture: GodotRenderingRID, byTexture: GodotRenderingRID): void { this.call('_texture_replace', texture, byTexture); }
  _texture_set_size_override(texture: GodotRenderingRID, width: number, height: number): void { this.call('_texture_set_size_override', texture, width, height); }
  _texture_set_path(texture: GodotRenderingRID, path: string): void { this.call('_texture_set_path', texture, path); }
  _texture_get_path(texture: GodotRenderingRID): string { return String(this.call('_texture_get_path', texture)); }
  _texture_get_format(texture: GodotRenderingRID): number { return this.number('_texture_get_format', texture); }
  _texture_get_native_handle(texture: GodotRenderingRID, srgb = false): number { return this.number('_texture_get_native_handle', texture, srgb); }
  _texture_get_width(texture: GodotRenderingRID): number { return this.number('_texture_get_width', texture); }
  _texture_get_height(texture: GodotRenderingRID): number { return this.number('_texture_get_height', texture); }
  _texture_get_depth(texture: GodotRenderingRID): number { return this.number('_texture_get_depth', texture); }
  _texture_set_detect_3d_callback(texture: GodotRenderingRID, callback: unknown): void { this.call('_texture_set_detect_3d_callback', texture, callback); }
  _texture_set_detect_normal_callback(texture: GodotRenderingRID, callback: unknown): void { this.call('_texture_set_detect_normal_callback', texture, callback); }
  _texture_set_detect_roughness_callback(texture: GodotRenderingRID, callback: unknown): void { this.call('_texture_set_detect_roughness_callback', texture, callback); }
  _texture_debug_usage(): unknown[] { return this.array('_texture_debug_usage'); }
  _texture_set_proxy(texture: GodotRenderingRID, proxy: GodotRenderingRID | null): void { this.call('_texture_set_proxy', texture, proxy); }
  _texture_set_force_redraw_if_visible(texture: GodotRenderingRID, enable: boolean): void { this.call('_texture_set_force_redraw_if_visible', texture, enable); }

  _shader_create(): GodotRenderingRID { return this.rid('_shader_create'); }
  _shader_set_code(shader: GodotRenderingRID, code: string): void { this.call('_shader_set_code', shader, code); }
  _shader_set_path_hint(shader: GodotRenderingRID, path: string): void { this.call('_shader_set_path_hint', shader, path); }
  _shader_get_code(shader: GodotRenderingRID): string { return String(this.call('_shader_get_code', shader)); }
  _shader_get_parameter_list(shader: GodotRenderingRID): unknown[] { return this.array('_shader_get_parameter_list', shader); }
  _shader_get_parameter_default(shader: GodotRenderingRID, name: string): unknown { return this.call('_shader_get_parameter_default', shader, name); }
  _shader_set_default_texture_parameter(shader: GodotRenderingRID, name: string, texture: GodotRenderingRID, index = 0): void { this.call('_shader_set_default_texture_parameter', shader, name, texture, index); }
  _shader_get_default_texture_parameter(shader: GodotRenderingRID, name: string, index = 0): GodotRenderingRID { return this.rid('_shader_get_default_texture_parameter', shader, name, index); }

  _material_create(): GodotRenderingRID { return this.rid('_material_create'); }
  _material_set_shader(material: GodotRenderingRID, shader: GodotRenderingRID | null): void { this.call('_material_set_shader', material, shader); }
  _material_set_param(material: GodotRenderingRID, parameter: string, value: unknown): void { this.call('_material_set_param', material, parameter, value); }
  _material_get_param(material: GodotRenderingRID, parameter: string): unknown { return this.call('_material_get_param', material, parameter); }
  _material_set_render_priority(material: GodotRenderingRID, priority: number): void { this.call('_material_set_render_priority', material, priority); }
  _material_set_next_pass(material: GodotRenderingRID, nextMaterial: GodotRenderingRID | null): void { this.call('_material_set_next_pass', material, nextMaterial); }

  _mesh_create_from_surfaces(surfaces: readonly unknown[], blendShapeCount = 0): GodotRenderingRID { return this.rid('_mesh_create_from_surfaces', surfaces, blendShapeCount); }
  _mesh_create(): GodotRenderingRID { return this.rid('_mesh_create'); }
  _mesh_set_blend_shape_count(mesh: GodotRenderingRID, count: number): void { this.call('_mesh_set_blend_shape_count', mesh, count); }
  _mesh_add_surface(mesh: GodotRenderingRID, surface: unknown): void { this.call('_mesh_add_surface', mesh, surface); }
  _mesh_surface_get_format(mesh: GodotRenderingRID, surface: number): number { return this.number('_mesh_surface_get_format', mesh, surface); }
  _mesh_surface_get_primitive_type(mesh: GodotRenderingRID, surface: number): number { return this.number('_mesh_surface_get_primitive_type', mesh, surface); }
  _mesh_surface_get_array(mesh: GodotRenderingRID, surface: number): Uint8Array { const value = this.call('_mesh_surface_get_array', mesh, surface); return value instanceof Uint8Array ? Uint8Array.from(value) : Uint8Array.from(value as ArrayLike<number>); }
  _mesh_surface_get_attribute_array(mesh: GodotRenderingRID, surface: number): Uint8Array { const value = this.call('_mesh_surface_get_attribute_array', mesh, surface); return value instanceof Uint8Array ? Uint8Array.from(value) : Uint8Array.from(value as ArrayLike<number>); }
  _mesh_surface_get_skin_array(mesh: GodotRenderingRID, surface: number): Uint8Array { const value = this.call('_mesh_surface_get_skin_array', mesh, surface); return value instanceof Uint8Array ? Uint8Array.from(value) : Uint8Array.from(value as ArrayLike<number>); }
  _mesh_surface_get_index_array(mesh: GodotRenderingRID, surface: number): Uint8Array { const value = this.call('_mesh_surface_get_index_array', mesh, surface); return value instanceof Uint8Array ? Uint8Array.from(value) : Uint8Array.from(value as ArrayLike<number>); }
  _mesh_surface_get_aabb(mesh: GodotRenderingRID, surface: number): unknown { return this.call('_mesh_surface_get_aabb', mesh, surface); }
  _mesh_surface_get_blend_shape_aabbs(mesh: GodotRenderingRID, surface: number): unknown[] { return this.array('_mesh_surface_get_blend_shape_aabbs', mesh, surface); }
  _mesh_surface_get_lods(mesh: GodotRenderingRID, surface: number): Readonly<Record<string, unknown>> { return this.call('_mesh_surface_get_lods', mesh, surface) as Readonly<Record<string, unknown>>; }
  _mesh_surface_set_material(mesh: GodotRenderingRID, surface: number, material: GodotRenderingRID | null): void { this.call('_mesh_surface_set_material', mesh, surface, material); }
  _mesh_surface_get_material(mesh: GodotRenderingRID, surface: number): GodotRenderingRID { return this.rid('_mesh_surface_get_material', mesh, surface); }
  _mesh_get_blend_shape_count(mesh: GodotRenderingRID): number { return this.number('_mesh_get_blend_shape_count', mesh); }
  _mesh_set_blend_shape_mode(mesh: GodotRenderingRID, mode: number): void { this.call('_mesh_set_blend_shape_mode', mesh, mode); }
  _mesh_get_blend_shape_mode(mesh: GodotRenderingRID): number { return this.number('_mesh_get_blend_shape_mode', mesh); }
  _mesh_surface_update_vertex_region(mesh: GodotRenderingRID, surface: number, offset: number, data: Uint8Array): void { this.call('_mesh_surface_update_vertex_region', mesh, surface, offset, data); }
  _mesh_surface_update_attribute_region(mesh: GodotRenderingRID, surface: number, offset: number, data: Uint8Array): void { this.call('_mesh_surface_update_attribute_region', mesh, surface, offset, data); }
  _mesh_surface_update_skin_region(mesh: GodotRenderingRID, surface: number, offset: number, data: Uint8Array): void { this.call('_mesh_surface_update_skin_region', mesh, surface, offset, data); }
  _mesh_surface_get_array_len(mesh: GodotRenderingRID, surface: number): number { return this.number('_mesh_surface_get_array_len', mesh, surface); }
  _mesh_surface_get_array_index_len(mesh: GodotRenderingRID, surface: number): number { return this.number('_mesh_surface_get_array_index_len', mesh, surface); }
  _mesh_surface_get_arrays(mesh: GodotRenderingRID, surface: number): unknown[] { return this.array('_mesh_surface_get_arrays', mesh, surface); }
  _mesh_surface_get_blend_shape_arrays(mesh: GodotRenderingRID, surface: number): unknown[] { return this.array('_mesh_surface_get_blend_shape_arrays', mesh, surface); }
  _mesh_get_surface_count(mesh: GodotRenderingRID): number { return this.number('_mesh_get_surface_count', mesh); }
  _mesh_set_custom_aabb(mesh: GodotRenderingRID, aabb: unknown): void { this.call('_mesh_set_custom_aabb', mesh, aabb); }
  _mesh_get_custom_aabb(mesh: GodotRenderingRID): unknown { return this.call('_mesh_get_custom_aabb', mesh); }
  _mesh_remove_surface(mesh: GodotRenderingRID, surface: number): void { this.call('_mesh_remove_surface', mesh, surface); }
  _mesh_set_path(mesh: GodotRenderingRID, path: string): void { this.call('_mesh_set_path', mesh, path); }
  _mesh_get_path(mesh: GodotRenderingRID): string { return String(this.call('_mesh_get_path', mesh)); }
  _mesh_set_shadow_mesh(mesh: GodotRenderingRID, shadowMesh: GodotRenderingRID | null): void { this.call('_mesh_set_shadow_mesh', mesh, shadowMesh); }
  _mesh_clear(mesh: GodotRenderingRID): void { this.call('_mesh_clear', mesh); }

  _multimesh_create(): GodotRenderingRID { return this.rid('_multimesh_create'); }
  _multimesh_allocate_data(multimesh: GodotRenderingRID, instances: number, transformFormat: number, useColors: boolean, useCustomData: boolean): void { this.call('_multimesh_allocate_data', multimesh, instances, transformFormat, useColors, useCustomData); }
  _multimesh_get_instance_count(multimesh: GodotRenderingRID): number { return this.number('_multimesh_get_instance_count', multimesh); }
  _multimesh_set_mesh(multimesh: GodotRenderingRID, mesh: GodotRenderingRID | null): void { this.call('_multimesh_set_mesh', multimesh, mesh); }
  _multimesh_get_mesh(multimesh: GodotRenderingRID): GodotRenderingRID { return this.rid('_multimesh_get_mesh', multimesh); }
  _multimesh_instance_set_transform(multimesh: GodotRenderingRID, index: number, transform: unknown): void { this.call('_multimesh_instance_set_transform', multimesh, index, transform); }
  _multimesh_instance_get_transform(multimesh: GodotRenderingRID, index: number): unknown { return this.call('_multimesh_instance_get_transform', multimesh, index); }
  _multimesh_instance_set_transform_2d(multimesh: GodotRenderingRID, index: number, transform: unknown): void { this.call('_multimesh_instance_set_transform_2d', multimesh, index, transform); }
  _multimesh_instance_get_transform_2d(multimesh: GodotRenderingRID, index: number): unknown { return this.call('_multimesh_instance_get_transform_2d', multimesh, index); }
  _multimesh_instance_set_color(multimesh: GodotRenderingRID, index: number, color: GodotRenderingColor): void { this.call('_multimesh_instance_set_color', multimesh, index, color); }
  _multimesh_instance_get_color(multimesh: GodotRenderingRID, index: number): GodotRenderingColor { return this.call('_multimesh_instance_get_color', multimesh, index) as GodotRenderingColor; }
  _multimesh_instance_set_custom_data(multimesh: GodotRenderingRID, index: number, data: GodotRenderingColor): void { this.call('_multimesh_instance_set_custom_data', multimesh, index, data); }
  _multimesh_instance_get_custom_data(multimesh: GodotRenderingRID, index: number): GodotRenderingColor { return this.call('_multimesh_instance_get_custom_data', multimesh, index) as GodotRenderingColor; }
  _multimesh_set_visible_instances(multimesh: GodotRenderingRID, count: number): void { this.call('_multimesh_set_visible_instances', multimesh, count); }
  _multimesh_get_visible_instances(multimesh: GodotRenderingRID): number { return this.number('_multimesh_get_visible_instances', multimesh); }
  _multimesh_set_buffer(multimesh: GodotRenderingRID, buffer: Float32Array): void { this.call('_multimesh_set_buffer', multimesh, buffer); }
  _multimesh_get_buffer(multimesh: GodotRenderingRID): Float32Array { const value = this.call('_multimesh_get_buffer', multimesh); return value instanceof Float32Array ? Float32Array.from(value) : Float32Array.from(value as ArrayLike<number>); }

  _skeleton_create(): GodotRenderingRID { return this.rid('_skeleton_create'); }
  _skeleton_allocate_data(skeleton: GodotRenderingRID, bones: number, is2d = false): void { this.call('_skeleton_allocate_data', skeleton, bones, is2d); }
  _skeleton_get_bone_count(skeleton: GodotRenderingRID): number { return this.number('_skeleton_get_bone_count', skeleton); }
  _skeleton_bone_set_transform(skeleton: GodotRenderingRID, bone: number, transform: unknown): void { this.call('_skeleton_bone_set_transform', skeleton, bone, transform); }
  _skeleton_bone_get_transform(skeleton: GodotRenderingRID, bone: number): unknown { return this.call('_skeleton_bone_get_transform', skeleton, bone); }
  _skeleton_bone_set_transform_2d(skeleton: GodotRenderingRID, bone: number, transform: unknown): void { this.call('_skeleton_bone_set_transform_2d', skeleton, bone, transform); }
  _skeleton_bone_get_transform_2d(skeleton: GodotRenderingRID, bone: number): unknown { return this.call('_skeleton_bone_get_transform_2d', skeleton, bone); }
  _skeleton_set_base_transform_2d(skeleton: GodotRenderingRID, transform: unknown): void { this.call('_skeleton_set_base_transform_2d', skeleton, transform); }
  _skeleton_get_base_transform_2d(skeleton: GodotRenderingRID): unknown { return this.call('_skeleton_get_base_transform_2d', skeleton); }

  _directional_light_create(): GodotRenderingRID { return this.rid('_directional_light_create'); }
  _omni_light_create(): GodotRenderingRID { return this.rid('_omni_light_create'); }
  _spot_light_create(): GodotRenderingRID { return this.rid('_spot_light_create'); }
  _light_set_color(light: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_light_set_color', light, color); }
  _light_set_param(light: GodotRenderingRID, param: number, value: number): void { this.call('_light_set_param', light, param, value); }
  _light_set_shadow(light: GodotRenderingRID, enabled: boolean): void { this.call('_light_set_shadow', light, enabled); }
  _light_set_projector(light: GodotRenderingRID, texture: GodotRenderingRID | null): void { this.call('_light_set_projector', light, texture); }
  _light_set_negative(light: GodotRenderingRID, enabled: boolean): void { this.call('_light_set_negative', light, enabled); }
  _light_set_cull_mask(light: GodotRenderingRID, mask: number): void { this.call('_light_set_cull_mask', light, mask); }
  _light_set_distance_fade(light: GodotRenderingRID, enabled: boolean, begin: number, shadow: number, length: number): void { this.call('_light_set_distance_fade', light, enabled, begin, shadow, length); }
  _light_set_reverse_cull_face_mode(light: GodotRenderingRID, enabled: boolean): void { this.call('_light_set_reverse_cull_face_mode', light, enabled); }
  _light_set_bake_mode(light: GodotRenderingRID, bakeMode: number): void { this.call('_light_set_bake_mode', light, bakeMode); }
  _light_set_shadow_color(light: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_light_set_shadow_color', light, color); }
  _light_set_shadow_caster_mask(light: GodotRenderingRID, mask: number): void { this.call('_light_set_shadow_caster_mask', light, mask); }
  _light_omni_set_shadow_mode(light: GodotRenderingRID, mode: number): void { this.call('_light_omni_set_shadow_mode', light, mode); }
  _light_directional_set_shadow_mode(light: GodotRenderingRID, mode: number): void { this.call('_light_directional_set_shadow_mode', light, mode); }
  _light_directional_set_blend_splits(light: GodotRenderingRID, enabled: boolean): void { this.call('_light_directional_set_blend_splits', light, enabled); }
  _light_directional_set_sky_mode(light: GodotRenderingRID, mode: number): void { this.call('_light_directional_set_sky_mode', light, mode); }
  _light_set_max_sdfgi_cascade(light: GodotRenderingRID, cascade: number): void { this.call('_light_set_max_sdfgi_cascade', light, cascade); }
  _lightmap_create(): GodotRenderingRID { return this.rid('_lightmap_create'); }
  _lightmap_set_textures(lightmap: GodotRenderingRID, light: GodotRenderingRID, usesSphericalHarmonics: boolean): void { this.call('_lightmap_set_textures', lightmap, light, usesSphericalHarmonics); }

  _camera_create(): GodotRenderingRID { return this.rid('_camera_create'); }
  _camera_set_perspective(camera: GodotRenderingRID, fovYDegrees: number, zNear: number, zFar: number): void { this.call('_camera_set_perspective', camera, fovYDegrees, zNear, zFar); }
  _camera_set_orthogonal(camera: GodotRenderingRID, size: number, zNear: number, zFar: number): void { this.call('_camera_set_orthogonal', camera, size, zNear, zFar); }
  _camera_set_frustum(camera: GodotRenderingRID, size: number, offset: GodotRenderingVector2, zNear: number, zFar: number): void { this.call('_camera_set_frustum', camera, size, offset, zNear, zFar); }
  _camera_set_transform(camera: GodotRenderingRID, transform: unknown): void { this.call('_camera_set_transform', camera, transform); }
  _camera_set_cull_mask(camera: GodotRenderingRID, layers: number): void { this.call('_camera_set_cull_mask', camera, layers); }
  _camera_set_environment(camera: GodotRenderingRID, environment: GodotRenderingRID | null): void { this.call('_camera_set_environment', camera, environment); }
  _camera_set_camera_attributes(camera: GodotRenderingRID, attributes: GodotRenderingRID | null): void { this.call('_camera_set_camera_attributes', camera, attributes); }
  _camera_set_compositor(camera: GodotRenderingRID, compositor: GodotRenderingRID | null): void { this.call('_camera_set_compositor', camera, compositor); }
  _camera_set_use_vertical_aspect(camera: GodotRenderingRID, enable: boolean): void { this.call('_camera_set_use_vertical_aspect', camera, enable); }

  _camera_attributes_create(): GodotRenderingRID { return this.rid('_camera_attributes_create'); }
  _camera_attributes_set_dof_blur_quality(quality: number, useJitter: boolean): void { this.call('_camera_attributes_set_dof_blur_quality', quality, useJitter); }
  _camera_attributes_set_dof_blur_bokeh_shape(shape: number): void { this.call('_camera_attributes_set_dof_blur_bokeh_shape', shape); }
  _camera_attributes_set_dof_blur(cameraAttributes: GodotRenderingRID, farEnabled: boolean, farDistance: number, farTransition: number, nearEnabled: boolean, nearDistance: number, nearTransition: number, amount: number): void { this.call('_camera_attributes_set_dof_blur', cameraAttributes, farEnabled, farDistance, farTransition, nearEnabled, nearDistance, nearTransition, amount); }
  _camera_attributes_set_exposure(cameraAttributes: GodotRenderingRID, multiplier: number, normalization: number): void { this.call('_camera_attributes_set_exposure', cameraAttributes, multiplier, normalization); }
  _camera_attributes_set_auto_exposure(cameraAttributes: GodotRenderingRID, enabled: boolean, minSensitivity: number, maxSensitivity: number, speed: number, scale: number): void { this.call('_camera_attributes_set_auto_exposure', cameraAttributes, enabled, minSensitivity, maxSensitivity, speed, scale); }

  _compositor_create(): GodotRenderingRID { return this.rid('_compositor_create'); }
  _compositor_set_compositor_effects(compositor: GodotRenderingRID, effects: readonly GodotRenderingRID[]): void { this.call('_compositor_set_compositor_effects', compositor, effects); }

  _viewport_create(): GodotRenderingRID { return this.rid('_viewport_create'); }
  _viewport_set_use_xr(viewport: GodotRenderingRID, useXr: boolean): void { this.call('_viewport_set_use_xr', viewport, useXr); }
  _viewport_set_size(viewport: GodotRenderingRID, width: number, height: number): void { this.call('_viewport_set_size', viewport, width, height); }
  _viewport_set_active(viewport: GodotRenderingRID, active: boolean): void { this.call('_viewport_set_active', viewport, active); }
  _viewport_set_parent_viewport(viewport: GodotRenderingRID, parent: GodotRenderingRID | null): void { this.call('_viewport_set_parent_viewport', viewport, parent); }
  _viewport_attach_to_screen(viewport: GodotRenderingRID, rect: unknown, screen = 0): void { this.call('_viewport_attach_to_screen', viewport, rect, screen); }
  _viewport_set_disable_3d(viewport: GodotRenderingRID, disable: boolean): void { this.call('_viewport_set_disable_3d', viewport, disable); }
  _viewport_set_disable_2d(viewport: GodotRenderingRID, disable: boolean): void { this.call('_viewport_set_disable_2d', viewport, disable); }
  _viewport_set_environment_mode(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_environment_mode', viewport, mode); }
  _viewport_attach_camera(viewport: GodotRenderingRID, camera: GodotRenderingRID | null): void { this.call('_viewport_attach_camera', viewport, camera); }
  _viewport_set_scenario(viewport: GodotRenderingRID, scenario: GodotRenderingRID | null): void { this.call('_viewport_set_scenario', viewport, scenario); }
  _viewport_attach_canvas(viewport: GodotRenderingRID, canvas: GodotRenderingRID): void { this.call('_viewport_attach_canvas', viewport, canvas); }
  _viewport_remove_canvas(viewport: GodotRenderingRID, canvas: GodotRenderingRID): void { this.call('_viewport_remove_canvas', viewport, canvas); }
  _viewport_set_canvas_transform(viewport: GodotRenderingRID, canvas: GodotRenderingRID, transform: unknown): void { this.call('_viewport_set_canvas_transform', viewport, canvas, transform); }
  _viewport_set_transparent_background(viewport: GodotRenderingRID, enabled: boolean): void { this.call('_viewport_set_transparent_background', viewport, enabled); }
  _viewport_set_global_canvas_transform(viewport: GodotRenderingRID, transform: unknown): void { this.call('_viewport_set_global_canvas_transform', viewport, transform); }
  _viewport_set_canvas_stacking(viewport: GodotRenderingRID, canvas: GodotRenderingRID, layer: number, sublayer: number): void { this.call('_viewport_set_canvas_stacking', viewport, canvas, layer, sublayer); }
  _viewport_set_positional_shadow_atlas_size(viewport: GodotRenderingRID, size: number, use16Bits: boolean): void { this.call('_viewport_set_positional_shadow_atlas_size', viewport, size, use16Bits); }
  _viewport_set_positional_shadow_atlas_quadrant_subdivision(viewport: GodotRenderingRID, quadrant: number, subdivision: number): void { this.call('_viewport_set_positional_shadow_atlas_quadrant_subdivision', viewport, quadrant, subdivision); }
  _viewport_set_render_direct_to_screen(viewport: GodotRenderingRID, enabled: boolean): void { this.call('_viewport_set_render_direct_to_screen', viewport, enabled); }
  _viewport_set_canvas_cull_mask(viewport: GodotRenderingRID, mask: number): void { this.call('_viewport_set_canvas_cull_mask', viewport, mask); }
  _viewport_set_scaling_3d_mode(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_scaling_3d_mode', viewport, mode); }
  _viewport_set_scaling_3d_scale(viewport: GodotRenderingRID, scale: number): void { this.call('_viewport_set_scaling_3d_scale', viewport, scale); }
  _viewport_set_fsr_sharpness(viewport: GodotRenderingRID, sharpness: number): void { this.call('_viewport_set_fsr_sharpness', viewport, sharpness); }
  _viewport_set_texture_mipmap_bias(viewport: GodotRenderingRID, bias: number): void { this.call('_viewport_set_texture_mipmap_bias', viewport, bias); }
  _viewport_set_update_mode(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_update_mode', viewport, mode); }
  _viewport_set_clear_mode(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_clear_mode', viewport, mode); }
  _viewport_set_msaa_2d(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_msaa_2d', viewport, mode); }
  _viewport_set_msaa_3d(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_msaa_3d', viewport, mode); }
  _viewport_set_screen_space_aa(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_screen_space_aa', viewport, mode); }
  _viewport_set_use_taa(viewport: GodotRenderingRID, enabled: boolean): void { this.call('_viewport_set_use_taa', viewport, enabled); }
  _viewport_set_use_debanding(viewport: GodotRenderingRID, enabled: boolean): void { this.call('_viewport_set_use_debanding', viewport, enabled); }
  _viewport_set_use_occlusion_culling(viewport: GodotRenderingRID, enabled: boolean): void { this.call('_viewport_set_use_occlusion_culling', viewport, enabled); }
  _viewport_set_occlusion_rays_per_thread(rays: number): void { this.call('_viewport_set_occlusion_rays_per_thread', rays); }
  _viewport_set_occlusion_culling_build_quality(quality: number): void { this.call('_viewport_set_occlusion_culling_build_quality', quality); }
  _viewport_set_mesh_lod_threshold(viewport: GodotRenderingRID, pixels: number): void { this.call('_viewport_set_mesh_lod_threshold', viewport, pixels); }
  _viewport_set_snap_2d_transforms_to_pixel(viewport: GodotRenderingRID, enabled: boolean): void { this.call('_viewport_set_snap_2d_transforms_to_pixel', viewport, enabled); }
  _viewport_set_snap_2d_vertices_to_pixel(viewport: GodotRenderingRID, enabled: boolean): void { this.call('_viewport_set_snap_2d_vertices_to_pixel', viewport, enabled); }
  _viewport_set_sdf_oversize_and_scale(viewport: GodotRenderingRID, oversize: number, scale: number): void { this.call('_viewport_set_sdf_oversize_and_scale', viewport, oversize, scale); }
  _viewport_set_vrs_mode(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_vrs_mode', viewport, mode); }
  _viewport_set_vrs_update_mode(viewport: GodotRenderingRID, mode: number): void { this.call('_viewport_set_vrs_update_mode', viewport, mode); }
  _viewport_set_vrs_texture(viewport: GodotRenderingRID, texture: GodotRenderingRID | null): void { this.call('_viewport_set_vrs_texture', viewport, texture); }
  _viewport_set_measure_render_time(viewport: GodotRenderingRID, enable: boolean): void { this.call('_viewport_set_measure_render_time', viewport, enable); }
  _viewport_get_measured_render_time_cpu(viewport: GodotRenderingRID): number { return this.number('_viewport_get_measured_render_time_cpu', viewport); }
  _viewport_get_measured_render_time_gpu(viewport: GodotRenderingRID): number { return this.number('_viewport_get_measured_render_time_gpu', viewport); }
  _viewport_get_render_target(viewport: GodotRenderingRID): GodotRenderingRID { return this.rid('_viewport_get_render_target', viewport); }
  _viewport_get_texture(viewport: GodotRenderingRID): GodotRenderingRID { return this.rid('_viewport_get_texture', viewport); }
  _viewport_get_render_info(viewport: GodotRenderingRID, type: number, info: number): number { return this.number('_viewport_get_render_info', viewport, type, info); }
  _viewport_set_debug_draw(viewport: GodotRenderingRID, draw: number): void { this.call('_viewport_set_debug_draw', viewport, draw); }

  _environment_create(): GodotRenderingRID { return this.rid('_environment_create'); }
  _environment_set_background(environment: GodotRenderingRID, mode: number): void { this.call('_environment_set_background', environment, mode); }
  _environment_set_sky(environment: GodotRenderingRID, sky: GodotRenderingRID | null): void { this.call('_environment_set_sky', environment, sky); }
  _environment_set_sky_custom_fov(environment: GodotRenderingRID, scale: number): void { this.call('_environment_set_sky_custom_fov', environment, scale); }
  _environment_set_bg_color(environment: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_environment_set_bg_color', environment, color); }
  _environment_set_bg_energy(environment: GodotRenderingRID, multiplier: number, exposure: number): void { this.call('_environment_set_bg_energy', environment, multiplier, exposure); }
  _environment_set_canvas_max_layer(environment: GodotRenderingRID, layer: number): void { this.call('_environment_set_canvas_max_layer', environment, layer); }
  _environment_set_ambient_light(environment: GodotRenderingRID, color: GodotRenderingColor, source: number, energy: number, skyContribution: number, reflectionSource: number): void { this.call('_environment_set_ambient_light', environment, color, source, energy, skyContribution, reflectionSource); }
  _environment_set_camera_feed_id(environment: GodotRenderingRID, id: number): void { this.call('_environment_set_camera_feed_id', environment, id); }
  _environment_set_ssr(environment: GodotRenderingRID, enabled: boolean, maxSteps: number, fadeIn: number, fadeOut: number, depthTolerance: number): void { this.call('_environment_set_ssr', environment, enabled, maxSteps, fadeIn, fadeOut, depthTolerance); }
  _environment_set_ssr_roughness_quality(quality: number): void { this.call('_environment_set_ssr_roughness_quality', quality); }
  _environment_set_ssao(environment: GodotRenderingRID, enabled: boolean, radius: number, intensity: number, power: number, detail: number, horizon: number, sharpness: number, lightAffect: number, aoChannelAffect: number): void { this.call('_environment_set_ssao', environment, enabled, radius, intensity, power, detail, horizon, sharpness, lightAffect, aoChannelAffect); }
  _environment_set_ssao_quality(quality: number, halfSize: boolean, adaptiveTarget: number, blurPasses: number, fadeoutFrom: number, fadeoutTo: number): void { this.call('_environment_set_ssao_quality', quality, halfSize, adaptiveTarget, blurPasses, fadeoutFrom, fadeoutTo); }
  _environment_set_ssil(environment: GodotRenderingRID, enabled: boolean, radius: number, intensity: number, sharpness: number, normalRejection: number): void { this.call('_environment_set_ssil', environment, enabled, radius, intensity, sharpness, normalRejection); }
  _environment_set_ssil_quality(quality: number, halfSize: boolean, adaptiveTarget: number, blurPasses: number, fadeoutFrom: number, fadeoutTo: number): void { this.call('_environment_set_ssil_quality', quality, halfSize, adaptiveTarget, blurPasses, fadeoutFrom, fadeoutTo); }
  _environment_set_sdfgi(environment: GodotRenderingRID, enabled: boolean, cascades: number, minCellSize: number, yScale: number, useOcclusion: boolean, bounceFeedback: number, readSky: boolean, energy: number, normalBias: number, probeBias: number): void { this.call('_environment_set_sdfgi', environment, enabled, cascades, minCellSize, yScale, useOcclusion, bounceFeedback, readSky, energy, normalBias, probeBias); }
  _environment_set_sdfgi_ray_count(rayCount: number): void { this.call('_environment_set_sdfgi_ray_count', rayCount); }
  _environment_set_sdfgi_frames_to_converge(frames: number): void { this.call('_environment_set_sdfgi_frames_to_converge', frames); }
  _environment_set_sdfgi_frames_to_update_light(frames: number): void { this.call('_environment_set_sdfgi_frames_to_update_light', frames); }
  _environment_set_fog(environment: GodotRenderingRID, enabled: boolean, lightColor: GodotRenderingColor, lightEnergy: number, sunScatter: number, density: number, height: number, heightDensity: number, aerialPerspective: number, skyAffect: number, fogMode: number): void { this.call('_environment_set_fog', environment, enabled, lightColor, lightEnergy, sunScatter, density, height, heightDensity, aerialPerspective, skyAffect, fogMode); }
  _environment_set_fog_depth(environment: GodotRenderingRID, curve: number, begin: number, end: number): void { this.call('_environment_set_fog_depth', environment, curve, begin, end); }
  _environment_set_volumetric_fog(environment: GodotRenderingRID, enabled: boolean, density: number, albedo: GodotRenderingColor, emission: GodotRenderingColor, emissionEnergy: number, length: number, detailSpread: number, giInject: number, temporalReprojection: boolean, temporalReprojectionAmount: number, ambientInject: number, skyAffect: number): void { this.call('_environment_set_volumetric_fog', environment, enabled, density, albedo, emission, emissionEnergy, length, detailSpread, giInject, temporalReprojection, temporalReprojectionAmount, ambientInject, skyAffect); }
  _environment_set_volumetric_fog_volume_size(size: number, depth: number): void { this.call('_environment_set_volumetric_fog_volume_size', size, depth); }
  _environment_set_volumetric_fog_filter_active(active: boolean): void { this.call('_environment_set_volumetric_fog_filter_active', active); }
  _environment_set_glow(environment: GodotRenderingRID, enabled: boolean, levels: readonly number[], intensity: number, strength: number, mix: number, bloomThreshold: number, blendMode: number, hdrBleedThreshold: number, hdrBleedScale: number, hdrLuminanceCap: number, mapStrength: number, map: GodotRenderingRID | null): void { this.call('_environment_set_glow', environment, enabled, levels, intensity, strength, mix, bloomThreshold, blendMode, hdrBleedThreshold, hdrBleedScale, hdrLuminanceCap, mapStrength, map); }
  _environment_glow_set_use_bicubic_upscale(enable: boolean): void { this.call('_environment_glow_set_use_bicubic_upscale', enable); }
  _environment_glow_set_use_high_quality(enable: boolean): void { this.call('_environment_glow_set_use_high_quality', enable); }
  _environment_set_tonemap(environment: GodotRenderingRID, toneMapper: number, exposure: number, white: number): void { this.call('_environment_set_tonemap', environment, toneMapper, exposure, white); }
  _environment_set_adjustment(environment: GodotRenderingRID, enabled: boolean, brightness: number, contrast: number, saturation: number, colorCorrection: GodotRenderingRID | null): void { this.call('_environment_set_adjustment', environment, enabled, brightness, contrast, saturation, colorCorrection); }

  _scenario_create(): GodotRenderingRID { return this.rid('_scenario_create'); }
  _scenario_set_environment(scenario: GodotRenderingRID, environment: GodotRenderingRID | null): void { this.call('_scenario_set_environment', scenario, environment); }
  _scenario_set_fallback_environment(scenario: GodotRenderingRID, environment: GodotRenderingRID | null): void { this.call('_scenario_set_fallback_environment', scenario, environment); }
  _scenario_set_camera_attributes(scenario: GodotRenderingRID, attributes: GodotRenderingRID | null): void { this.call('_scenario_set_camera_attributes', scenario, attributes); }

  _voxel_gi_create(): GodotRenderingRID { return this.rid('_voxel_gi_create'); }
  _voxel_gi_allocate_data(voxelGi: GodotRenderingRID, toCellXform: unknown, aabb: unknown, octreeSize: GodotRenderingVector3, octreeCells: Uint8Array, dataCells: Uint8Array, distanceField: Uint8Array, levelCounts: readonly number[]): void { this.call('_voxel_gi_allocate_data', voxelGi, toCellXform, aabb, octreeSize, octreeCells, dataCells, distanceField, levelCounts); }
  _voxel_gi_get_octree_size(voxelGi: GodotRenderingRID): GodotRenderingVector3 { return this.call('_voxel_gi_get_octree_size', voxelGi) as GodotRenderingVector3; }
  _voxel_gi_get_octree_cells(voxelGi: GodotRenderingRID): Uint8Array { const value = this.call('_voxel_gi_get_octree_cells', voxelGi); return value instanceof Uint8Array ? Uint8Array.from(value) : Uint8Array.from(value as ArrayLike<number>); }
  _voxel_gi_get_data_cells(voxelGi: GodotRenderingRID): Uint8Array { const value = this.call('_voxel_gi_get_data_cells', voxelGi); return value instanceof Uint8Array ? Uint8Array.from(value) : Uint8Array.from(value as ArrayLike<number>); }
  _voxel_gi_get_distance_field(voxelGi: GodotRenderingRID): Uint8Array { const value = this.call('_voxel_gi_get_distance_field', voxelGi); return value instanceof Uint8Array ? Uint8Array.from(value) : Uint8Array.from(value as ArrayLike<number>); }
  _voxel_gi_get_level_counts(voxelGi: GodotRenderingRID): number[] { return this.array('_voxel_gi_get_level_counts', voxelGi); }
  _voxel_gi_get_to_cell_xform(voxelGi: GodotRenderingRID): unknown { return this.call('_voxel_gi_get_to_cell_xform', voxelGi); }
  _voxel_gi_set_dynamic_range(voxelGi: GodotRenderingRID, range: number): void { this.call('_voxel_gi_set_dynamic_range', voxelGi, range); }
  _voxel_gi_set_propagation(voxelGi: GodotRenderingRID, amount: number): void { this.call('_voxel_gi_set_propagation', voxelGi, amount); }
  _voxel_gi_set_energy(voxelGi: GodotRenderingRID, energy: number): void { this.call('_voxel_gi_set_energy', voxelGi, energy); }
  _voxel_gi_set_baked_exposure_normalization(voxelGi: GodotRenderingRID, bakedExposure: number): void { this.call('_voxel_gi_set_baked_exposure_normalization', voxelGi, bakedExposure); }
  _voxel_gi_set_bias(voxelGi: GodotRenderingRID, bias: number): void { this.call('_voxel_gi_set_bias', voxelGi, bias); }
  _voxel_gi_set_normal_bias(voxelGi: GodotRenderingRID, bias: number): void { this.call('_voxel_gi_set_normal_bias', voxelGi, bias); }
  _voxel_gi_set_interior(voxelGi: GodotRenderingRID, interior: boolean): void { this.call('_voxel_gi_set_interior', voxelGi, interior); }
  _voxel_gi_set_use_two_bounces(voxelGi: GodotRenderingRID, enable: boolean): void { this.call('_voxel_gi_set_use_two_bounces', voxelGi, enable); }
  _voxel_gi_set_quality(quality: number): void { this.call('_voxel_gi_set_quality', quality); }

  _lightmap_set_probe_bounds(lightmap: GodotRenderingRID, bounds: unknown): void { this.call('_lightmap_set_probe_bounds', lightmap, bounds); }
  _lightmap_set_probe_interior(lightmap: GodotRenderingRID, interior: boolean): void { this.call('_lightmap_set_probe_interior', lightmap, interior); }
  _lightmap_set_probe_capture_data(lightmap: GodotRenderingRID, points: readonly GodotRenderingVector3[], pointSh: readonly GodotRenderingColor[], tetrahedra: readonly number[], bspTree: readonly number[]): void { this.call('_lightmap_set_probe_capture_data', lightmap, points, pointSh, tetrahedra, bspTree); }
  _lightmap_get_probe_capture_points(lightmap: GodotRenderingRID): GodotRenderingVector3[] { return this.array('_lightmap_get_probe_capture_points', lightmap); }
  _lightmap_get_probe_capture_sh(lightmap: GodotRenderingRID): GodotRenderingColor[] { return this.array('_lightmap_get_probe_capture_sh', lightmap); }
  _lightmap_get_probe_capture_tetrahedra(lightmap: GodotRenderingRID): number[] { return this.array('_lightmap_get_probe_capture_tetrahedra', lightmap); }
  _lightmap_get_probe_capture_bsp_tree(lightmap: GodotRenderingRID): number[] { return this.array('_lightmap_get_probe_capture_bsp_tree', lightmap); }
  _instance_create(): GodotRenderingRID { return this.rid('_instance_create'); }
  _instance_create2(base: GodotRenderingRID, scenario: GodotRenderingRID): GodotRenderingRID { return this.rid('_instance_create2', base, scenario); }
  _instance_set_base(instance: GodotRenderingRID, base: GodotRenderingRID | null): void { this.call('_instance_set_base', instance, base); }
  _instance_set_scenario(instance: GodotRenderingRID, scenario: GodotRenderingRID | null): void { this.call('_instance_set_scenario', instance, scenario); }
  _instance_set_layer_mask(instance: GodotRenderingRID, mask: number): void { this.call('_instance_set_layer_mask', instance, mask); }
  _instance_set_pivot_data(instance: GodotRenderingRID, sortingOffset: number, useAabbCenter: boolean): void { this.call('_instance_set_pivot_data', instance, sortingOffset, useAabbCenter); }
  _instance_set_transform(instance: GodotRenderingRID, transform: unknown): void { this.call('_instance_set_transform', instance, transform); }
  _instance_attach_object_instance_id(instance: GodotRenderingRID, id: number): void { this.call('_instance_attach_object_instance_id', instance, id); }
  _instance_set_blend_shape_weight(instance: GodotRenderingRID, shape: number, weight: number): void { this.call('_instance_set_blend_shape_weight', instance, shape, weight); }
  _instance_set_surface_override_material(instance: GodotRenderingRID, surface: number, material: GodotRenderingRID | null): void { this.call('_instance_set_surface_override_material', instance, surface, material); }
  _instance_set_visible(instance: GodotRenderingRID, visible: boolean): void { this.call('_instance_set_visible', instance, visible); }
  _instance_set_custom_aabb(instance: GodotRenderingRID, aabb: unknown): void { this.call('_instance_set_custom_aabb', instance, aabb); }
  _instance_attach_skeleton(instance: GodotRenderingRID, skeleton: GodotRenderingRID | null): void { this.call('_instance_attach_skeleton', instance, skeleton); }
  _instance_set_extra_visibility_margin(instance: GodotRenderingRID, margin: number): void { this.call('_instance_set_extra_visibility_margin', instance, margin); }
  _instance_set_visibility_parent(instance: GodotRenderingRID, parent: GodotRenderingRID | null): void { this.call('_instance_set_visibility_parent', instance, parent); }
  _instance_set_ignore_culling(instance: GodotRenderingRID, enabled: boolean): void { this.call('_instance_set_ignore_culling', instance, enabled); }
  _instance_set_interpolated(instance: GodotRenderingRID, interpolated: boolean): void { this.call('_instance_set_interpolated', instance, interpolated); }
  _instance_reset_physics_interpolation(instance: GodotRenderingRID): void { this.call('_instance_reset_physics_interpolation', instance); }
  _instance_transform_physics_interpolation(instance: GodotRenderingRID, transform: unknown): void { this.call('_instance_transform_physics_interpolation', instance, transform); }
  _instance_geometry_set_transparency(instance: GodotRenderingRID, transparency: number): void { this.call('_instance_geometry_set_transparency', instance, transparency); }
  _instance_geometry_set_cast_shadows_setting(instance: GodotRenderingRID, setting: number): void { this.call('_instance_geometry_set_cast_shadows_setting', instance, setting); }
  _instance_geometry_set_material_override(instance: GodotRenderingRID, material: GodotRenderingRID | null): void { this.call('_instance_geometry_set_material_override', instance, material); }
  _instance_geometry_set_material_overlay(instance: GodotRenderingRID, material: GodotRenderingRID | null): void { this.call('_instance_geometry_set_material_overlay', instance, material); }
  _instance_geometry_set_flag(instance: GodotRenderingRID, flag: number, enabled: boolean): void { this.call('_instance_geometry_set_flag', instance, flag, enabled); }
  _instance_geometry_set_lod_bias(instance: GodotRenderingRID, bias: number): void { this.call('_instance_geometry_set_lod_bias', instance, bias); }
  _instance_geometry_set_visibility_range(instance: GodotRenderingRID, min: number, max: number, minMargin: number, maxMargin: number, fadeMode: number): void { this.call('_instance_geometry_set_visibility_range', instance, min, max, minMargin, maxMargin, fadeMode); }
  _instance_geometry_set_lightmap(instance: GodotRenderingRID, lightmap: GodotRenderingRID | null, lightmapUvScale: unknown, lightmapSlice: number): void { this.call('_instance_geometry_set_lightmap', instance, lightmap, lightmapUvScale, lightmapSlice); }
  _instance_geometry_set_shader_parameter(instance: GodotRenderingRID, name: string, value: unknown): void { this.call('_instance_geometry_set_shader_parameter', instance, name, value); }
  _instance_geometry_get_shader_parameter(instance: GodotRenderingRID, name: string): unknown { return this.call('_instance_geometry_get_shader_parameter', instance, name); }
  _instance_geometry_get_shader_parameter_default_value(instance: GodotRenderingRID, name: string): unknown { return this.call('_instance_geometry_get_shader_parameter_default_value', instance, name); }
  _instance_geometry_get_shader_parameter_list(instance: GodotRenderingRID): unknown[] { return this.array('_instance_geometry_get_shader_parameter_list', instance); }
  _instance_geometry_set_as_instance_lod(instance: GodotRenderingRID, lodInstance: GodotRenderingRID | null): void { this.call('_instance_geometry_set_as_instance_lod', instance, lodInstance); }
  _instance_geometry_set_ignore_occlusion_culling(instance: GodotRenderingRID, ignore: boolean): void { this.call('_instance_geometry_set_ignore_occlusion_culling', instance, ignore); }
  _instance_geometry_set_visibility_range_fade_mode(instance: GodotRenderingRID, fadeMode: number): void { this.call('_instance_geometry_set_visibility_range_fade_mode', instance, fadeMode); }
  _instances_cull_aabb(aabb: unknown, scenario: GodotRenderingRID): number[] { return this.array('_instances_cull_aabb', aabb, scenario); }
  _instances_cull_ray(from: GodotRenderingVector3, to: GodotRenderingVector3, scenario: GodotRenderingRID): number[] { return this.array('_instances_cull_ray', from, to, scenario); }
  _instances_cull_convex(planes: readonly unknown[], scenario: GodotRenderingRID): number[] { return this.array('_instances_cull_convex', planes, scenario); }

  _sky_create(): GodotRenderingRID { return this.rid('_sky_create'); }
  _sky_set_radiance_size(sky: GodotRenderingRID, radianceSize: number): void { this.call('_sky_set_radiance_size', sky, radianceSize); }
  _sky_set_mode(sky: GodotRenderingRID, mode: number): void { this.call('_sky_set_mode', sky, mode); }
  _sky_set_material(sky: GodotRenderingRID, material: GodotRenderingRID | null): void { this.call('_sky_set_material', sky, material); }
  _sky_bake_panorama(sky: GodotRenderingRID, energy: number, bakeIrradiance: boolean, size: GodotRenderingVector2): unknown { return this.call('_sky_bake_panorama', sky, energy, bakeIrradiance, size); }

  _particles_create(): GodotRenderingRID { return this.rid('_particles_create'); }
  _particles_set_mode(particles: GodotRenderingRID, mode: number): void { this.call('_particles_set_mode', particles, mode); }
  _particles_set_emitting(particles: GodotRenderingRID, emitting: boolean): void { this.call('_particles_set_emitting', particles, emitting); }
  _particles_get_emitting(particles: GodotRenderingRID): boolean { return this.boolean('_particles_get_emitting', particles); }
  _particles_set_amount(particles: GodotRenderingRID, amount: number): void { this.call('_particles_set_amount', particles, amount); }
  _particles_set_amount_ratio(particles: GodotRenderingRID, ratio: number): void { this.call('_particles_set_amount_ratio', particles, ratio); }
  _particles_set_lifetime(particles: GodotRenderingRID, lifetime: number): void { this.call('_particles_set_lifetime', particles, lifetime); }
  _particles_set_one_shot(particles: GodotRenderingRID, oneShot: boolean): void { this.call('_particles_set_one_shot', particles, oneShot); }
  _particles_set_pre_process_time(particles: GodotRenderingRID, time: number): void { this.call('_particles_set_pre_process_time', particles, time); }
  _particles_set_explosiveness_ratio(particles: GodotRenderingRID, ratio: number): void { this.call('_particles_set_explosiveness_ratio', particles, ratio); }
  _particles_set_randomness_ratio(particles: GodotRenderingRID, ratio: number): void { this.call('_particles_set_randomness_ratio', particles, ratio); }
  _particles_set_interp_to_end(particles: GodotRenderingRID, factor: number): void { this.call('_particles_set_interp_to_end', particles, factor); }
  _particles_set_emitter_velocity(particles: GodotRenderingRID, velocity: GodotRenderingVector3): void { this.call('_particles_set_emitter_velocity', particles, velocity); }
  _particles_set_custom_aabb(particles: GodotRenderingRID, aabb: unknown): void { this.call('_particles_set_custom_aabb', particles, aabb); }
  _particles_set_speed_scale(particles: GodotRenderingRID, scale: number): void { this.call('_particles_set_speed_scale', particles, scale); }
  _particles_set_use_local_coordinates(particles: GodotRenderingRID, enable: boolean): void { this.call('_particles_set_use_local_coordinates', particles, enable); }
  _particles_set_process_material(particles: GodotRenderingRID, material: GodotRenderingRID | null): void { this.call('_particles_set_process_material', particles, material); }
  _particles_set_fixed_fps(particles: GodotRenderingRID, fps: number): void { this.call('_particles_set_fixed_fps', particles, fps); }
  _particles_set_interpolate(particles: GodotRenderingRID, enable: boolean): void { this.call('_particles_set_interpolate', particles, enable); }
  _particles_set_fractional_delta(particles: GodotRenderingRID, enable: boolean): void { this.call('_particles_set_fractional_delta', particles, enable); }
  _particles_set_collision_base_size(particles: GodotRenderingRID, size: number): void { this.call('_particles_set_collision_base_size', particles, size); }
  _particles_set_transform_align(particles: GodotRenderingRID, align: number): void { this.call('_particles_set_transform_align', particles, align); }
  _particles_set_trails(particles: GodotRenderingRID, enable: boolean, lifetime: number): void { this.call('_particles_set_trails', particles, enable, lifetime); }
  _particles_set_trail_bind_poses(particles: GodotRenderingRID, bindPoses: readonly unknown[]): void { this.call('_particles_set_trail_bind_poses', particles, bindPoses); }
  _particles_is_inactive(particles: GodotRenderingRID): boolean { return this.boolean('_particles_is_inactive', particles); }
  _particles_request_process(particles: GodotRenderingRID): void { this.call('_particles_request_process', particles); }
  _particles_restart(particles: GodotRenderingRID): void { this.call('_particles_restart', particles); }
  _particles_set_draw_order(particles: GodotRenderingRID, order: number): void { this.call('_particles_set_draw_order', particles, order); }
  _particles_set_draw_passes(particles: GodotRenderingRID, count: number): void { this.call('_particles_set_draw_passes', particles, count); }
  _particles_set_draw_pass_mesh(particles: GodotRenderingRID, pass: number, mesh: GodotRenderingRID | null): void { this.call('_particles_set_draw_pass_mesh', particles, pass, mesh); }
  _particles_get_current_aabb(particles: GodotRenderingRID): unknown { return this.call('_particles_get_current_aabb', particles); }
  _particles_set_emission_transform(particles: GodotRenderingRID, transform: unknown): void { this.call('_particles_set_emission_transform', particles, transform); }
  _particles_emit(particles: GodotRenderingRID, transform: unknown, velocity: GodotRenderingVector3, color: GodotRenderingColor, custom: GodotRenderingColor, emitFlags: number): void { this.call('_particles_emit', particles, transform, velocity, color, custom, emitFlags); }

  _particles_collision_create(): GodotRenderingRID { return this.rid('_particles_collision_create'); }
  _particles_collision_set_collision_type(collision: GodotRenderingRID, type: number): void { this.call('_particles_collision_set_collision_type', collision, type); }
  _particles_collision_set_cull_mask(collision: GodotRenderingRID, mask: number): void { this.call('_particles_collision_set_cull_mask', collision, mask); }
  _particles_collision_set_sphere_radius(collision: GodotRenderingRID, radius: number): void { this.call('_particles_collision_set_sphere_radius', collision, radius); }
  _particles_collision_set_box_extents(collision: GodotRenderingRID, extents: GodotRenderingVector3): void { this.call('_particles_collision_set_box_extents', collision, extents); }
  _particles_collision_set_attractor_strength(collision: GodotRenderingRID, strength: number): void { this.call('_particles_collision_set_attractor_strength', collision, strength); }
  _particles_collision_set_attractor_directionality(collision: GodotRenderingRID, amount: number): void { this.call('_particles_collision_set_attractor_directionality', collision, amount); }
  _particles_collision_set_attractor_attenuation(collision: GodotRenderingRID, curve: number): void { this.call('_particles_collision_set_attractor_attenuation', collision, curve); }
  _particles_collision_set_field_texture(collision: GodotRenderingRID, texture: GodotRenderingRID | null): void { this.call('_particles_collision_set_field_texture', collision, texture); }
  _particles_collision_height_field_update(collision: GodotRenderingRID): void { this.call('_particles_collision_height_field_update', collision); }

  _canvas_create(): GodotRenderingRID { return this.rid('_canvas_create'); }
  _canvas_set_item_mirroring(canvas: GodotRenderingRID, item: GodotRenderingRID, mirroring: GodotRenderingVector2): void { this.call('_canvas_set_item_mirroring', canvas, item, mirroring); }
  _canvas_set_modulate(canvas: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_canvas_set_modulate', canvas, color); }
  _canvas_set_parent(canvas: GodotRenderingRID, parent: GodotRenderingRID | null, scale: number): void { this.call('_canvas_set_parent', canvas, parent, scale); }
  _canvas_set_disable_scale(disable: boolean): void { this.call('_canvas_set_disable_scale', disable); }
  _canvas_texture_create(): GodotRenderingRID { return this.rid('_canvas_texture_create'); }
  _canvas_texture_set_channel(canvasTexture: GodotRenderingRID, channel: number, texture: GodotRenderingRID | null): void { this.call('_canvas_texture_set_channel', canvasTexture, channel, texture); }
  _canvas_texture_set_shading_parameters(canvasTexture: GodotRenderingRID, baseColor: GodotRenderingColor, shininess: number): void { this.call('_canvas_texture_set_shading_parameters', canvasTexture, baseColor, shininess); }
  _canvas_texture_set_texture_filter(canvasTexture: GodotRenderingRID, filter: number): void { this.call('_canvas_texture_set_texture_filter', canvasTexture, filter); }
  _canvas_texture_set_texture_repeat(canvasTexture: GodotRenderingRID, repeat: number): void { this.call('_canvas_texture_set_texture_repeat', canvasTexture, repeat); }

  _canvas_item_create(): GodotRenderingRID { return this.rid('_canvas_item_create'); }
  _canvas_item_set_parent(item: GodotRenderingRID, parent: GodotRenderingRID | null): void { this.call('_canvas_item_set_parent', item, parent); }
  _canvas_item_set_default_texture_filter(item: GodotRenderingRID, filter: number): void { this.call('_canvas_item_set_default_texture_filter', item, filter); }
  _canvas_item_set_default_texture_repeat(item: GodotRenderingRID, repeat: number): void { this.call('_canvas_item_set_default_texture_repeat', item, repeat); }
  _canvas_item_set_visible(item: GodotRenderingRID, visible: boolean): void { this.call('_canvas_item_set_visible', item, visible); }
  _canvas_item_set_light_mask(item: GodotRenderingRID, mask: number): void { this.call('_canvas_item_set_light_mask', item, mask); }
  _canvas_item_set_visibility_layer(item: GodotRenderingRID, layer: number): void { this.call('_canvas_item_set_visibility_layer', item, layer); }
  _canvas_item_set_transform(item: GodotRenderingRID, transform: unknown): void { this.call('_canvas_item_set_transform', item, transform); }
  _canvas_item_set_clip(item: GodotRenderingRID, clip: boolean): void { this.call('_canvas_item_set_clip', item, clip); }
  _canvas_item_set_distance_field_mode(item: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_item_set_distance_field_mode', item, enabled); }
  _canvas_item_set_custom_rect(item: GodotRenderingRID, useCustomRect: boolean, rect: unknown): void { this.call('_canvas_item_set_custom_rect', item, useCustomRect, rect); }
  _canvas_item_set_modulate(item: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_canvas_item_set_modulate', item, color); }
  _canvas_item_set_self_modulate(item: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_canvas_item_set_self_modulate', item, color); }
  _canvas_item_set_draw_behind_parent(item: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_item_set_draw_behind_parent', item, enabled); }
  _canvas_item_set_interpolated(item: GodotRenderingRID, interpolated: boolean): void { this.call('_canvas_item_set_interpolated', item, interpolated); }
  _canvas_item_reset_physics_interpolation(item: GodotRenderingRID): void { this.call('_canvas_item_reset_physics_interpolation', item); }
  _canvas_item_transform_physics_interpolation(item: GodotRenderingRID, transform: unknown): void { this.call('_canvas_item_transform_physics_interpolation', item, transform); }
  _canvas_item_set_update_when_visible(item: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_item_set_update_when_visible', item, enabled); }
  _canvas_item_set_material(item: GodotRenderingRID, material: GodotRenderingRID | null): void { this.call('_canvas_item_set_material', item, material); }
  _canvas_item_set_use_parent_material(item: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_item_set_use_parent_material', item, enabled); }
  _canvas_item_set_visibility_notifier(item: GodotRenderingRID, enable: boolean, area: unknown, enterCallable: unknown, exitCallable: unknown): void { this.call('_canvas_item_set_visibility_notifier', item, enable, area, enterCallable, exitCallable); }
  _canvas_item_set_canvas_group_mode(item: GodotRenderingRID, mode: number, fitEmpty: number, fitMargin: number, blurMipmaps: boolean): void { this.call('_canvas_item_set_canvas_group_mode', item, mode, fitEmpty, fitMargin, blurMipmaps); }
  _canvas_item_set_debug_redraw(item: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_item_set_debug_redraw', item, enabled); }
  _canvas_item_clear(item: GodotRenderingRID): void { this.call('_canvas_item_clear', item); }
  _canvas_item_set_draw_index(item: GodotRenderingRID, index: number): void { this.call('_canvas_item_set_draw_index', item, index); }
  _canvas_item_set_z_index(item: GodotRenderingRID, index: number): void { this.call('_canvas_item_set_z_index', item, index); }
  _canvas_item_set_z_as_relative_to_parent(item: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_item_set_z_as_relative_to_parent', item, enabled); }
  _canvas_item_set_copy_to_backbuffer(item: GodotRenderingRID, enabled: boolean, rect: unknown): void { this.call('_canvas_item_set_copy_to_backbuffer', item, enabled, rect); }
  _canvas_item_add_line(item: GodotRenderingRID, from: GodotRenderingVector2, to: GodotRenderingVector2, color: GodotRenderingColor, width = -1, antialiased = false): void { this.call('_canvas_item_add_line', item, from, to, color, width, antialiased); }
  _canvas_item_add_polyline(item: GodotRenderingRID, points: readonly GodotRenderingVector2[], colors: readonly GodotRenderingColor[], width = -1, antialiased = false): void { this.call('_canvas_item_add_polyline', item, points, colors, width, antialiased); }
  _canvas_item_add_multiline(item: GodotRenderingRID, points: readonly GodotRenderingVector2[], colors: readonly GodotRenderingColor[], width = -1, antialiased = false): void { this.call('_canvas_item_add_multiline', item, points, colors, width, antialiased); }
  _canvas_item_add_rect(item: GodotRenderingRID, rect: unknown, color: GodotRenderingColor, antialiased = false): void { this.call('_canvas_item_add_rect', item, rect, color, antialiased); }
  _canvas_item_add_circle(item: GodotRenderingRID, position: GodotRenderingVector2, radius: number, color: GodotRenderingColor, antialiased = false): void { this.call('_canvas_item_add_circle', item, position, radius, color, antialiased); }
  _canvas_item_add_texture_rect(item: GodotRenderingRID, rect: unknown, texture: GodotRenderingRID, tile: boolean, modulate: GodotRenderingColor, transpose = false): void { this.call('_canvas_item_add_texture_rect', item, rect, texture, tile, modulate, transpose); }
  _canvas_item_add_msdf_texture_rect_region(item: GodotRenderingRID, rect: unknown, texture: GodotRenderingRID, srcRect: unknown, modulate: GodotRenderingColor, outlineSize: number, pxRange: number, scale: number): void { this.call('_canvas_item_add_msdf_texture_rect_region', item, rect, texture, srcRect, modulate, outlineSize, pxRange, scale); }
  _canvas_item_add_lcd_texture_rect_region(item: GodotRenderingRID, rect: unknown, texture: GodotRenderingRID, srcRect: unknown, modulate: GodotRenderingColor): void { this.call('_canvas_item_add_lcd_texture_rect_region', item, rect, texture, srcRect, modulate); }
  _canvas_item_add_texture_rect_region(item: GodotRenderingRID, rect: unknown, texture: GodotRenderingRID, srcRect: unknown, modulate: GodotRenderingColor, transpose = false, clipUv = true): void { this.call('_canvas_item_add_texture_rect_region', item, rect, texture, srcRect, modulate, transpose, clipUv); }
  _canvas_item_add_nine_patch(item: GodotRenderingRID, rect: unknown, srcRect: unknown, texture: GodotRenderingRID, topleft: GodotRenderingVector2, bottomright: GodotRenderingVector2, xAxisMode: number, yAxisMode: number, drawCenter: boolean, modulate: GodotRenderingColor): void { this.call('_canvas_item_add_nine_patch', item, rect, srcRect, texture, topleft, bottomright, xAxisMode, yAxisMode, drawCenter, modulate); }
  _canvas_item_add_primitive(item: GodotRenderingRID, points: readonly GodotRenderingVector2[], colors: readonly GodotRenderingColor[], uvs: readonly GodotRenderingVector2[], texture: GodotRenderingRID | null): void { this.call('_canvas_item_add_primitive', item, points, colors, uvs, texture); }
  _canvas_item_add_polygon(item: GodotRenderingRID, points: readonly GodotRenderingVector2[], colors: readonly GodotRenderingColor[], uvs: readonly GodotRenderingVector2[], texture: GodotRenderingRID | null): void { this.call('_canvas_item_add_polygon', item, points, colors, uvs, texture); }
  _canvas_item_add_triangle_array(item: GodotRenderingRID, indices: readonly number[], points: readonly GodotRenderingVector2[], colors: readonly GodotRenderingColor[], uvs: readonly GodotRenderingVector2[], bones: readonly number[], weights: readonly number[], texture: GodotRenderingRID | null, count = -1): void { this.call('_canvas_item_add_triangle_array', item, indices, points, colors, uvs, bones, weights, texture, count); }
  _canvas_item_add_mesh(item: GodotRenderingRID, mesh: GodotRenderingRID, transform: unknown, modulate: GodotRenderingColor, texture: GodotRenderingRID | null): void { this.call('_canvas_item_add_mesh', item, mesh, transform, modulate, texture); }
  _canvas_item_add_multimesh(item: GodotRenderingRID, mesh: GodotRenderingRID, texture: GodotRenderingRID | null): void { this.call('_canvas_item_add_multimesh', item, mesh, texture); }
  _canvas_item_add_particles(item: GodotRenderingRID, particles: GodotRenderingRID, texture: GodotRenderingRID | null): void { this.call('_canvas_item_add_particles', item, particles, texture); }
  _canvas_item_add_set_transform(item: GodotRenderingRID, transform: unknown): void { this.call('_canvas_item_add_set_transform', item, transform); }
  _canvas_item_add_clip_ignore(item: GodotRenderingRID, ignore: boolean): void { this.call('_canvas_item_add_clip_ignore', item, ignore); }
  _canvas_item_add_animation_slice(item: GodotRenderingRID, animationLength: number, sliceBegin: number, sliceEnd: number, offset = 0): void { this.call('_canvas_item_add_animation_slice', item, animationLength, sliceBegin, sliceEnd, offset); }

  _canvas_light_create(): GodotRenderingRID { return this.rid('_canvas_light_create'); }
  _canvas_light_attach_to_canvas(light: GodotRenderingRID, canvas: GodotRenderingRID | null): void { this.call('_canvas_light_attach_to_canvas', light, canvas); }
  _canvas_light_set_enabled(light: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_light_set_enabled', light, enabled); }
  _canvas_light_set_texture_scale(light: GodotRenderingRID, scale: number): void { this.call('_canvas_light_set_texture_scale', light, scale); }
  _canvas_light_set_transform(light: GodotRenderingRID, transform: unknown): void { this.call('_canvas_light_set_transform', light, transform); }
  _canvas_light_set_texture(light: GodotRenderingRID, texture: GodotRenderingRID | null): void { this.call('_canvas_light_set_texture', light, texture); }
  _canvas_light_set_texture_offset(light: GodotRenderingRID, offset: GodotRenderingVector2): void { this.call('_canvas_light_set_texture_offset', light, offset); }
  _canvas_light_set_color(light: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_canvas_light_set_color', light, color); }
  _canvas_light_set_height(light: GodotRenderingRID, height: number): void { this.call('_canvas_light_set_height', light, height); }
  _canvas_light_set_energy(light: GodotRenderingRID, energy: number): void { this.call('_canvas_light_set_energy', light, energy); }
  _canvas_light_set_z_range(light: GodotRenderingRID, minZ: number, maxZ: number): void { this.call('_canvas_light_set_z_range', light, minZ, maxZ); }
  _canvas_light_set_layer_range(light: GodotRenderingRID, minLayer: number, maxLayer: number): void { this.call('_canvas_light_set_layer_range', light, minLayer, maxLayer); }
  _canvas_light_set_item_cull_mask(light: GodotRenderingRID, mask: number): void { this.call('_canvas_light_set_item_cull_mask', light, mask); }
  _canvas_light_set_item_shadow_cull_mask(light: GodotRenderingRID, mask: number): void { this.call('_canvas_light_set_item_shadow_cull_mask', light, mask); }
  _canvas_light_set_mode(light: GodotRenderingRID, mode: number): void { this.call('_canvas_light_set_mode', light, mode); }
  _canvas_light_set_shadow_enabled(light: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_light_set_shadow_enabled', light, enabled); }
  _canvas_light_set_shadow_filter(light: GodotRenderingRID, filter: number): void { this.call('_canvas_light_set_shadow_filter', light, filter); }
  _canvas_light_set_shadow_color(light: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_canvas_light_set_shadow_color', light, color); }
  _canvas_light_set_shadow_smooth(light: GodotRenderingRID, smooth: number): void { this.call('_canvas_light_set_shadow_smooth', light, smooth); }
  _canvas_light_set_blend_mode(light: GodotRenderingRID, mode: number): void { this.call('_canvas_light_set_blend_mode', light, mode); }

  _canvas_light_occluder_create(): GodotRenderingRID { return this.rid('_canvas_light_occluder_create'); }
  _canvas_light_occluder_attach_to_canvas(occluder: GodotRenderingRID, canvas: GodotRenderingRID | null): void { this.call('_canvas_light_occluder_attach_to_canvas', occluder, canvas); }
  _canvas_light_occluder_set_enabled(occluder: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_light_occluder_set_enabled', occluder, enabled); }
  _canvas_light_occluder_set_polygon(occluder: GodotRenderingRID, polygon: GodotRenderingRID | null): void { this.call('_canvas_light_occluder_set_polygon', occluder, polygon); }
  _canvas_light_occluder_set_as_sdf_collision(occluder: GodotRenderingRID, enabled: boolean): void { this.call('_canvas_light_occluder_set_as_sdf_collision', occluder, enabled); }
  _canvas_light_occluder_set_transform(occluder: GodotRenderingRID, transform: unknown): void { this.call('_canvas_light_occluder_set_transform', occluder, transform); }
  _canvas_light_occluder_set_light_mask(occluder: GodotRenderingRID, mask: number): void { this.call('_canvas_light_occluder_set_light_mask', occluder, mask); }

  _canvas_occluder_polygon_create(): GodotRenderingRID { return this.rid('_canvas_occluder_polygon_create'); }
  _canvas_occluder_polygon_set_shape(polygon: GodotRenderingRID, shape: readonly GodotRenderingVector2[], closed: boolean): void { this.call('_canvas_occluder_polygon_set_shape', polygon, shape, closed); }
  _canvas_occluder_polygon_set_cull_mode(polygon: GodotRenderingRID, mode: number): void { this.call('_canvas_occluder_polygon_set_cull_mode', polygon, mode); }

  _decal_create(): GodotRenderingRID { return this.rid('_decal_create'); }
  _decal_set_size(decal: GodotRenderingRID, size: GodotRenderingVector3): void { this.call('_decal_set_size', decal, size); }
  _decal_set_texture(decal: GodotRenderingRID, type: number, texture: GodotRenderingRID | null): void { this.call('_decal_set_texture', decal, type, texture); }
  _decal_set_emission_energy(decal: GodotRenderingRID, energy: number): void { this.call('_decal_set_emission_energy', decal, energy); }
  _decal_set_albedo_mix(decal: GodotRenderingRID, mix: number): void { this.call('_decal_set_albedo_mix', decal, mix); }
  _decal_set_modulate(decal: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_decal_set_modulate', decal, color); }
  _decal_set_cull_mask(decal: GodotRenderingRID, mask: number): void { this.call('_decal_set_cull_mask', decal, mask); }
  _decal_set_distance_fade(decal: GodotRenderingRID, enabled: boolean, begin: number, length: number): void { this.call('_decal_set_distance_fade', decal, enabled, begin, length); }
  _decal_set_fade(decal: GodotRenderingRID, above: number, below: number): void { this.call('_decal_set_fade', decal, above, below); }
  _decal_set_normal_fade(decal: GodotRenderingRID, fade: number): void { this.call('_decal_set_normal_fade', decal, fade); }

  _reflection_probe_create(): GodotRenderingRID { return this.rid('_reflection_probe_create'); }
  _reflection_probe_set_update_mode(probe: GodotRenderingRID, mode: number): void { this.call('_reflection_probe_set_update_mode', probe, mode); }
  _reflection_probe_set_intensity(probe: GodotRenderingRID, intensity: number): void { this.call('_reflection_probe_set_intensity', probe, intensity); }
  _reflection_probe_set_ambient_mode(probe: GodotRenderingRID, mode: number): void { this.call('_reflection_probe_set_ambient_mode', probe, mode); }
  _reflection_probe_set_ambient_color(probe: GodotRenderingRID, color: GodotRenderingColor): void { this.call('_reflection_probe_set_ambient_color', probe, color); }
  _reflection_probe_set_ambient_energy(probe: GodotRenderingRID, energy: number): void { this.call('_reflection_probe_set_ambient_energy', probe, energy); }
  _reflection_probe_set_max_distance(probe: GodotRenderingRID, distance: number): void { this.call('_reflection_probe_set_max_distance', probe, distance); }
  _reflection_probe_set_size(probe: GodotRenderingRID, size: GodotRenderingVector3): void { this.call('_reflection_probe_set_size', probe, size); }
  _reflection_probe_set_origin_offset(probe: GodotRenderingRID, offset: GodotRenderingVector3): void { this.call('_reflection_probe_set_origin_offset', probe, offset); }
  _reflection_probe_set_as_interior(probe: GodotRenderingRID, enable: boolean): void { this.call('_reflection_probe_set_as_interior', probe, enable); }
  _reflection_probe_set_enable_box_projection(probe: GodotRenderingRID, enable: boolean): void { this.call('_reflection_probe_set_enable_box_projection', probe, enable); }
  _reflection_probe_set_enable_shadows(probe: GodotRenderingRID, enable: boolean): void { this.call('_reflection_probe_set_enable_shadows', probe, enable); }
  _reflection_probe_set_cull_mask(probe: GodotRenderingRID, mask: number): void { this.call('_reflection_probe_set_cull_mask', probe, mask); }
  _reflection_probe_set_mesh_lod_threshold(probe: GodotRenderingRID, pixels: number): void { this.call('_reflection_probe_set_mesh_lod_threshold', probe, pixels); }

  _fog_volume_create(): GodotRenderingRID { return this.rid('_fog_volume_create'); }
  _fog_volume_set_shape(volume: GodotRenderingRID, shape: number): void { this.call('_fog_volume_set_shape', volume, shape); }
  _fog_volume_set_size(volume: GodotRenderingRID, size: GodotRenderingVector3): void { this.call('_fog_volume_set_size', volume, size); }
  _fog_volume_set_material(volume: GodotRenderingRID, material: GodotRenderingRID | null): void { this.call('_fog_volume_set_material', volume, material); }

  _visibility_notifier_create(): GodotRenderingRID { return this.rid('_visibility_notifier_create'); }
  _visibility_notifier_set_aabb(notifier: GodotRenderingRID, aabb: unknown): void { this.call('_visibility_notifier_set_aabb', notifier, aabb); }
  _visibility_notifier_set_callbacks(notifier: GodotRenderingRID, enterCallable: unknown, exitCallable: unknown): void { this.call('_visibility_notifier_set_callbacks', notifier, enterCallable, exitCallable); }

  _global_shader_parameter_add(name: string, type: number, defaultValue: unknown): void { this.call('_global_shader_parameter_add', name, type, defaultValue); }
  _global_shader_parameter_remove(name: string): void { this.call('_global_shader_parameter_remove', name); }
  _global_shader_parameter_get_list(): string[] { return this.array('_global_shader_parameter_get_list'); }
  _global_shader_parameter_set(name: string, value: unknown): void { this.call('_global_shader_parameter_set', name, value); }
  _global_shader_parameter_set_override(name: string, value: unknown): void { this.call('_global_shader_parameter_set_override', name, value); }
  _global_shader_parameter_get(name: string): unknown { return this.call('_global_shader_parameter_get', name); }
  _global_shader_parameter_get_type(name: string): number { return this.number('_global_shader_parameter_get_type', name); }

  _set_boot_image(image: unknown, color: GodotRenderingColor, scale: boolean, useFilter = true): void { this.call('_set_boot_image', image, color, scale, useFilter); }
  _set_default_clear_color(color: GodotRenderingColor): void { this.call('_set_default_clear_color', color); }
  _get_default_clear_color(): GodotRenderingColor { return this.call('_get_default_clear_color') as GodotRenderingColor; }
  _draw(swapBuffers: boolean, frameStep: number): void { this.call('_draw', swapBuffers, frameStep); }
  _sync(): void { this.call('_sync'); }

  _free_rid(rid: GodotRenderingRID): void { this.call('_free_rid', rid); }
  _request_frame_drawn_callback(callback: unknown): void { this.call('_request_frame_drawn_callback', callback); }
  _has_changed(): boolean { return this.boolean('_has_changed'); }
  _get_rendering_info(info: number): number { return this.number('_get_rendering_info', info); }
  _get_video_adapter_name(): string { return String(this.call('_get_video_adapter_name')); }
  _get_video_adapter_vendor(): string { return String(this.call('_get_video_adapter_vendor')); }
  _get_video_adapter_type(): number { return this.number('_get_video_adapter_type'); }
  _get_video_adapter_api_version(): string { return String(this.call('_get_video_adapter_api_version')); }
  _get_video_adapter_driver_info(): string[] { return this.array('_get_video_adapter_driver_info'); }
  _get_current_rendering_driver_name(): string { return String(this.call('_get_current_rendering_driver_name')); }
  _get_current_rendering_method(): string { return String(this.call('_get_current_rendering_method')); }
  _get_current_rendering_method_name(): string { return String(this.call('_get_current_rendering_method_name')); }
  _get_shader_parameter_list(shader: GodotRenderingRID): unknown[] { return this.array('_get_shader_parameter_list', shader); }
  _get_test_cube(): GodotRenderingRID { return this.rid('_get_test_cube'); }
  _get_test_texture(): GodotRenderingRID { return this.rid('_get_test_texture'); }
  _get_white_texture(): GodotRenderingRID { return this.rid('_get_white_texture'); }
  _make_sphere_mesh(latitudes: number, longitudes: number, radius: number): GodotRenderingRID { return this.rid('_make_sphere_mesh', latitudes, longitudes, radius); }
  _mesh_create_from_surface_data(surface: unknown): GodotRenderingRID { return this.rid('_mesh_create_from_surface_data', surface); }
  _capture_timestamp(name: string): void { this.call('_capture_timestamp', name); }
  _get_captured_timestamps_count(): number { return this.number('_get_captured_timestamps_count'); }
  _get_captured_timestamps_frame(): number { return this.number('_get_captured_timestamps_frame'); }
  _get_captured_timestamp_gpu_time(index: number): number { return this.number('_get_captured_timestamp_gpu_time', index); }
  _get_captured_timestamp_cpu_time(index: number): number { return this.number('_get_captured_timestamp_cpu_time', index); }
  _get_captured_timestamp_name(index: number): string { return String(this.call('_get_captured_timestamp_name', index)); }
  _get_rendering_device(): unknown { return this.call('_get_rendering_device'); }
  _create_local_rendering_device(): unknown { return this.call('_create_local_rendering_device'); }
  _set_debug_generate_wireframes(generate: boolean): void { this.call('_set_debug_generate_wireframes', generate); }
}

export function createGodotRenderingServerExtension(hooks: GodotRenderingServerExtensionHooks): GodotRenderingServerExtension {
  return new GodotRenderingServerExtension(hooks);
}
