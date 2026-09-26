import type { GodotRid } from './gdscript-builtins';

export type GodotRenderingRID = GodotRid;

export interface GodotRenderingServerBackend {
  invoke(method: string, args: readonly unknown[]): unknown;
}

interface ServerResource {
  kind: string;
  properties: Map<string, unknown>;
  arrays: Map<string, unknown[]>;
}

export class GodotRenderingServer {
  private nextRid = 1n;
  private readonly resources = new Map<bigint, ServerResource>();
  private readonly changedCallbacks = new Set<() => void>();

  constructor(private readonly backend: GodotRenderingServerBackend | null = null) {}

  private allocate(kind: string): GodotRenderingRID {
    const rid = Object.freeze({ id: this.nextRid++ }); this.resources.set(rid.id, { kind, properties: new Map(), arrays: new Map() }); this.notify('create', [kind, rid]); return rid;
  }
  private entry(rid: GodotRenderingRID, kind?: string): ServerResource {
    const value = this.resources.get(rid.id); if (!value) throw new Error(`RenderingServer RID ${rid.id} is invalid.`);
    if (kind && value.kind !== kind) throw new TypeError(`RenderingServer RID ${rid.id} is ${value.kind}, expected ${kind}.`); return value;
  }
  private set(rid: GodotRenderingRID, key: string, value: unknown): void { this.entry(rid).properties.set(key, value); this.notify(key, [rid, value]); }
  private get<T>(rid: GodotRenderingRID, key: string, fallback: T): T { return (this.entry(rid).properties.get(key) as T | undefined) ?? fallback; }
  private array(rid: GodotRenderingRID, key: string): unknown[] { const entry = this.entry(rid); let value = entry.arrays.get(key); if (!value) { value = []; entry.arrays.set(key, value); } return value; }
  private notify(method: string, args: readonly unknown[]): unknown { const result = this.backend?.invoke(method, args); for (const callback of this.changedCallbacks) callback(); return result; }

  connect_changed(callback: () => void): () => void { this.changedCallbacks.add(callback); return () => this.changedCallbacks.delete(callback); }
  force_sync(): void { this.notify('force_sync', []); }
  force_draw(swapBuffers = true, frameStep = 0): void { this.notify('force_draw', [swapBuffers, frameStep]); }
  get_rendering_info(info: number): number { return Number(this.notify('get_rendering_info', [info]) ?? 0); }
  get_video_adapter_name(): string { return String(this.notify('get_video_adapter_name', []) ?? 'WebGL'); }
  get_video_adapter_vendor(): string { return String(this.notify('get_video_adapter_vendor', []) ?? 'Browser'); }
  get_video_adapter_type(): number { return Number(this.notify('get_video_adapter_type', []) ?? 0); }

  texture_2d_create(image: unknown): GodotRenderingRID { const rid = this.allocate('texture'); this.set(rid, 'image', image); return rid; }
  texture_2d_layered_create(layers: readonly unknown[], layeredType: number): GodotRenderingRID { const rid = this.allocate('texture'); this.set(rid, 'layers', [...layers]); this.set(rid, 'layered_type', layeredType); return rid; }
  texture_3d_create(format: number, width: number, height: number, depth: number, mipmaps: boolean, data: readonly unknown[]): GodotRenderingRID { const rid = this.allocate('texture'); this.set(rid, 'format', format); this.set(rid, 'size', { x: width, y: height, z: depth }); this.set(rid, 'mipmaps', mipmaps); this.set(rid, 'data', [...data]); return rid; }
  texture_proxy_create(base: GodotRenderingRID): GodotRenderingRID { this.entry(base, 'texture'); const rid = this.allocate('texture'); this.set(rid, 'proxy', base); return rid; }
  texture_2d_placeholder_create(): GodotRenderingRID { return this.allocate('texture'); }
  texture_2d_layered_placeholder_create(layeredType: number): GodotRenderingRID { const rid = this.allocate('texture'); this.set(rid, 'layered_type', layeredType); return rid; }
  texture_3d_placeholder_create(): GodotRenderingRID { return this.allocate('texture'); }
  texture_2d_update(texture: GodotRenderingRID, image: unknown, layer = 0): void { this.entry(texture, 'texture'); this.set(texture, `image:${layer}`, image); }
  texture_3d_update(texture: GodotRenderingRID, data: readonly unknown[]): void { this.entry(texture, 'texture'); this.set(texture, 'data', [...data]); }
  texture_proxy_update(texture: GodotRenderingRID, proxyTo: GodotRenderingRID): void { this.entry(proxyTo, 'texture'); this.set(texture, 'proxy', proxyTo); }
  texture_2d_get(texture: GodotRenderingRID): unknown { return this.get(texture, 'image', null); }
  texture_2d_layer_get(texture: GodotRenderingRID, layer: number): unknown { return this.get(texture, `image:${layer}`, null); }
  texture_3d_get(texture: GodotRenderingRID): unknown[] { return this.get(texture, 'data', []); }
  texture_replace(texture: GodotRenderingRID, byTexture: GodotRenderingRID): void { const target = this.entry(texture, 'texture'); const source = this.entry(byTexture, 'texture'); target.properties = new Map(source.properties); target.arrays = new Map(source.arrays); }
  texture_set_size_override(texture: GodotRenderingRID, width: number, height: number): void { this.set(texture, 'size_override', { x: width, y: height }); }
  texture_set_path(texture: GodotRenderingRID, path: string): void { this.set(texture, 'path', path); }
  texture_get_path(texture: GodotRenderingRID): string { return this.get(texture, 'path', ''); }

  shader_create(): GodotRenderingRID { return this.allocate('shader'); }
  shader_set_code(shader: GodotRenderingRID, code: string): void { this.entry(shader, 'shader'); this.set(shader, 'code', code); }
  shader_get_code(shader: GodotRenderingRID): string { return this.get(shader, 'code', ''); }
  shader_set_path_hint(shader: GodotRenderingRID, path: string): void { this.set(shader, 'path_hint', path); }
  shader_get_parameter_list(shader: GodotRenderingRID): unknown[] { return this.get(shader, 'parameters', []); }
  shader_get_parameter_default(shader: GodotRenderingRID, name: string): unknown { return this.get(shader, `default:${name}`, null); }
  shader_set_default_texture_parameter(shader: GodotRenderingRID, name: string, texture: GodotRenderingRID, index = 0): void { this.set(shader, `default_texture:${name}:${index}`, texture); }

  material_create(): GodotRenderingRID { return this.allocate('material'); }
  material_set_shader(material: GodotRenderingRID, shader: GodotRenderingRID): void { this.entry(shader, 'shader'); this.set(material, 'shader', shader); }
  material_set_param(material: GodotRenderingRID, parameter: string, value: unknown): void { this.set(material, `param:${parameter}`, value); }
  material_get_param(material: GodotRenderingRID, parameter: string): unknown { return this.get(material, `param:${parameter}`, null); }
  material_set_render_priority(material: GodotRenderingRID, priority: number): void { this.set(material, 'render_priority', priority); }
  material_set_next_pass(material: GodotRenderingRID, nextMaterial: GodotRenderingRID): void { this.entry(nextMaterial, 'material'); this.set(material, 'next_pass', nextMaterial); }

  mesh_create(): GodotRenderingRID { return this.allocate('mesh'); }
  mesh_add_surface_from_arrays(mesh: GodotRenderingRID, primitive: number, arrays: unknown, blendShapes: readonly unknown[] = [], lods: Readonly<Record<string, unknown>> = {}, compressFormat = 0): void { this.array(mesh, 'surfaces').push({ primitive, arrays, blendShapes: [...blendShapes], lods: { ...lods }, compressFormat, material: null }); this.notify('mesh_add_surface_from_arrays', [mesh]); }
  mesh_get_surface_count(mesh: GodotRenderingRID): number { return this.array(mesh, 'surfaces').length; }
  mesh_clear(mesh: GodotRenderingRID): void { this.array(mesh, 'surfaces').length = 0; this.notify('mesh_clear', [mesh]); }
  mesh_surface_get(mesh: GodotRenderingRID, surface: number): unknown { return this.array(mesh, 'surfaces')[surface] ?? null; }
  mesh_surface_set_material(mesh: GodotRenderingRID, surface: number, material: GodotRenderingRID): void { const value = this.array(mesh, 'surfaces')[surface] as { material?: unknown } | undefined; if (value) value.material = material; }
  mesh_surface_get_material(mesh: GodotRenderingRID, surface: number): unknown { const value = this.array(mesh, 'surfaces')[surface] as { material?: unknown } | undefined; return value?.material ?? null; }
  mesh_set_blend_shape_count(mesh: GodotRenderingRID, count: number): void { this.set(mesh, 'blend_shape_count', Math.max(0, Math.trunc(count))); }
  mesh_get_blend_shape_count(mesh: GodotRenderingRID): number { return this.get(mesh, 'blend_shape_count', 0); }
  mesh_set_blend_shape_mode(mesh: GodotRenderingRID, mode: number): void { this.set(mesh, 'blend_shape_mode', mode); }
  mesh_set_custom_aabb(mesh: GodotRenderingRID, aabb: unknown): void { this.set(mesh, 'custom_aabb', aabb); }
  mesh_get_custom_aabb(mesh: GodotRenderingRID): unknown { return this.get(mesh, 'custom_aabb', null); }
  mesh_set_shadow_mesh(mesh: GodotRenderingRID, shadowMesh: GodotRenderingRID): void { this.set(mesh, 'shadow_mesh', shadowMesh); }

  multimesh_create(): GodotRenderingRID { return this.allocate('multimesh'); }
  multimesh_allocate_data(multimesh: GodotRenderingRID, instances: number, transformFormat: number, useColors = false, useCustomData = false): void { this.set(multimesh, 'allocation', { instances, transformFormat, useColors, useCustomData }); this.set(multimesh, 'transforms', new Array(Math.max(0, instances)).fill(null)); }
  multimesh_get_instance_count(multimesh: GodotRenderingRID): number { return (this.get<{ instances: number } | null>(multimesh, 'allocation', null))?.instances ?? 0; }
  multimesh_set_mesh(multimesh: GodotRenderingRID, mesh: GodotRenderingRID): void { this.set(multimesh, 'mesh', mesh); }
  multimesh_instance_set_transform(multimesh: GodotRenderingRID, index: number, transform: unknown): void { const values = this.get<unknown[]>(multimesh, 'transforms', []); values[index] = transform; }
  multimesh_instance_get_transform(multimesh: GodotRenderingRID, index: number): unknown { return this.get<unknown[]>(multimesh, 'transforms', [])[index] ?? null; }
  multimesh_set_visible_instances(multimesh: GodotRenderingRID, visible: number): void { this.set(multimesh, 'visible_instances', visible); }

  particles_create(): GodotRenderingRID { return this.allocate('particles'); }
  particles_set_emitting(particles: GodotRenderingRID, emitting: boolean): void { this.set(particles, 'emitting', emitting); }
  particles_get_emitting(particles: GodotRenderingRID): boolean { return this.get(particles, 'emitting', false); }
  particles_set_amount(particles: GodotRenderingRID, amount: number): void { this.set(particles, 'amount', Math.max(1, Math.trunc(amount))); }
  particles_set_lifetime(particles: GodotRenderingRID, lifetime: number): void { this.set(particles, 'lifetime', Math.max(0.01, lifetime)); }
  particles_set_process_material(particles: GodotRenderingRID, material: GodotRenderingRID): void { this.set(particles, 'process_material', material); }
  particles_set_draw_passes(particles: GodotRenderingRID, count: number): void { this.set(particles, 'draw_passes', Math.max(0, Math.trunc(count))); }
  particles_set_draw_pass_mesh(particles: GodotRenderingRID, pass: number, mesh: GodotRenderingRID): void { this.set(particles, `draw_pass:${pass}`, mesh); }
  particles_restart(particles: GodotRenderingRID): void { this.set(particles, 'restart_generation', this.get(particles, 'restart_generation', 0) + 1); }
  particles_request_process(particles: GodotRenderingRID): void { this.notify('particles_request_process', [particles]); }

  camera_create(): GodotRenderingRID { return this.allocate('camera'); }
  camera_set_perspective(camera: GodotRenderingRID, fovy: number, zNear: number, zFar: number): void { this.set(camera, 'projection', { mode: 'perspective', fovy, zNear, zFar }); }
  camera_set_orthogonal(camera: GodotRenderingRID, size: number, zNear: number, zFar: number): void { this.set(camera, 'projection', { mode: 'orthogonal', size, zNear, zFar }); }
  camera_set_frustum(camera: GodotRenderingRID, size: number, offset: unknown, zNear: number, zFar: number): void { this.set(camera, 'projection', { mode: 'frustum', size, offset, zNear, zFar }); }
  camera_set_transform(camera: GodotRenderingRID, transform: unknown): void { this.set(camera, 'transform', transform); }
  camera_set_cull_mask(camera: GodotRenderingRID, layers: number): void { this.set(camera, 'cull_mask', layers >>> 0); }
  camera_set_environment(camera: GodotRenderingRID, environment: GodotRenderingRID): void { this.set(camera, 'environment', environment); }

  viewport_create(): GodotRenderingRID { return this.allocate('viewport'); }
  viewport_set_size(viewport: GodotRenderingRID, width: number, height: number): void { this.set(viewport, 'size', { x: width, y: height }); }
  viewport_set_active(viewport: GodotRenderingRID, active: boolean): void { this.set(viewport, 'active', active); }
  viewport_set_parent_viewport(viewport: GodotRenderingRID, parent: GodotRenderingRID): void { this.set(viewport, 'parent', parent); }
  viewport_set_update_mode(viewport: GodotRenderingRID, mode: number): void { this.set(viewport, 'update_mode', mode); }
  viewport_set_clear_mode(viewport: GodotRenderingRID, mode: number): void { this.set(viewport, 'clear_mode', mode); }
  viewport_set_scenario(viewport: GodotRenderingRID, scenario: GodotRenderingRID): void { this.set(viewport, 'scenario', scenario); }
  viewport_attach_camera(viewport: GodotRenderingRID, camera: GodotRenderingRID): void { this.set(viewport, 'camera', camera); }
  viewport_get_texture(viewport: GodotRenderingRID): GodotRenderingRID { let texture = this.get<GodotRenderingRID | null>(viewport, 'texture', null); if (!texture) { texture = this.allocate('texture'); this.set(viewport, 'texture', texture); } return texture; }

  environment_create(): GodotRenderingRID { return this.allocate('environment'); }
  environment_set_background(environment: GodotRenderingRID, mode: number): void { this.set(environment, 'background_mode', mode); }
  environment_set_sky(environment: GodotRenderingRID, sky: GodotRenderingRID): void { this.set(environment, 'sky', sky); }
  environment_set_bg_color(environment: GodotRenderingRID, color: unknown): void { this.set(environment, 'bg_color', color); }
  environment_set_bg_energy(environment: GodotRenderingRID, multiplier: number): void { this.set(environment, 'bg_energy', multiplier); }
  scenario_create(): GodotRenderingRID { return this.allocate('scenario'); }
  scenario_set_environment(scenario: GodotRenderingRID, environment: GodotRenderingRID): void { this.set(scenario, 'environment', environment); }
  scenario_set_camera_attributes(scenario: GodotRenderingRID, attributes: GodotRenderingRID): void { this.set(scenario, 'camera_attributes', attributes); }

  instance_create(): GodotRenderingRID { return this.allocate('instance'); }
  instance_set_base(instance: GodotRenderingRID, base: GodotRenderingRID): void { this.set(instance, 'base', base); }
  instance_set_scenario(instance: GodotRenderingRID, scenario: GodotRenderingRID): void { this.set(instance, 'scenario', scenario); }
  instance_set_layer_mask(instance: GodotRenderingRID, mask: number): void { this.set(instance, 'layer_mask', mask >>> 0); }
  instance_set_transform(instance: GodotRenderingRID, transform: unknown): void { this.set(instance, 'transform', transform); }
  instance_set_visible(instance: GodotRenderingRID, visible: boolean): void { this.set(instance, 'visible', visible); }
  instance_set_custom_aabb(instance: GodotRenderingRID, aabb: unknown): void { this.set(instance, 'custom_aabb', aabb); }
  instance_set_material_override(instance: GodotRenderingRID, material: GodotRenderingRID): void { this.set(instance, 'material_override', material); }
  instance_geometry_set_cast_shadows_setting(instance: GodotRenderingRID, setting: number): void { this.set(instance, 'cast_shadows', setting); }

  free_rid(rid: GodotRenderingRID): void { if (this.resources.delete(rid.id)) this.notify('free_rid', [rid]); }
  has_rid(rid: GodotRenderingRID): boolean { return this.resources.has(rid.id); }
}

export function createGodotRenderingServer(backend: GodotRenderingServerBackend | null = null): GodotRenderingServer { return new GodotRenderingServer(backend); }
