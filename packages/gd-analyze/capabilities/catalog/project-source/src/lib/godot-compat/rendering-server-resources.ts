import type { Camera, Light, Material, Object3D, Texture } from 'three';
import { allocateGodotRid, godotRidGetId, type GodotRid } from './gdscript-builtins';

export type GodotRenderingResourceKind =
  | 'camera'
  | 'canvas'
  | 'canvas_item'
  | 'environment'
  | 'instance'
  | 'light'
  | 'material'
  | 'mesh'
  | 'multimesh'
  | 'particles'
  | 'scenario'
  | 'shader'
  | 'sky'
  | 'texture'
  | 'viewport';

export interface GodotRenderingServerResource {
  readonly rid: GodotRid;
  readonly kind: GodotRenderingResourceKind;
  native: object | null;
  properties: Map<string, unknown>;
  dependencies: Map<string, GodotRid | null>;
  freed: boolean;
}

export interface GodotRenderingServerResourceSnapshot {
  readonly rid: GodotRid;
  readonly kind: GodotRenderingResourceKind;
  readonly native: object | null;
  readonly properties: ReadonlyMap<string, unknown>;
  readonly dependencies: ReadonlyMap<string, GodotRid | null>;
}

export interface GodotRenderingServerResourceBinding {
  create(resource: GodotRenderingServerResourceSnapshot): object | null;
  update(resource: GodotRenderingServerResourceSnapshot, member: string, value: unknown): void;
  free(resource: GodotRenderingServerResourceSnapshot): void;
}

const RESOURCES = new Map<bigint, GodotRenderingServerResource>();
let binding: GodotRenderingServerResourceBinding | null = null;
const listeners = new Set<(resource: GodotRenderingServerResourceSnapshot, member: string) => void>();

function snapshot(resource: GodotRenderingServerResource): GodotRenderingServerResourceSnapshot {
  return Object.freeze({
    rid: resource.rid,
    kind: resource.kind,
    native: resource.native,
    properties: new Map(resource.properties),
    dependencies: new Map(resource.dependencies),
  });
}

function resourceOf(rid: GodotRid, member: string, kind?: GodotRenderingResourceKind): GodotRenderingServerResource {
  const resource = RESOURCES.get(godotRidGetId(rid));
  if (resource === undefined || resource.freed) {
    throw new Error(`godot-compat: RenderingServer.${member} requires a live rendering RID.`);
  }
  if (kind !== undefined && resource.kind !== kind) {
    throw new TypeError(`godot-compat: RenderingServer.${member} requires a ${kind} RID, received ${resource.kind}.`);
  }
  return resource;
}

function create(kind: GodotRenderingResourceKind): GodotRid {
  const rid = allocateGodotRid();
  const resource: GodotRenderingServerResource = {
    rid,
    kind,
    native: null,
    properties: new Map(),
    dependencies: new Map(),
    freed: false,
  };
  RESOURCES.set(godotRidGetId(rid), resource);
  resource.native = binding?.create(snapshot(resource)) ?? null;
  return rid;
}

function update(resource: GodotRenderingServerResource, member: string, value: unknown): void {
  resource.properties.set(member, value);
  const valueSnapshot = snapshot(resource);
  binding?.update(valueSnapshot, member, value);
  for (const listener of listeners) listener(valueSnapshot, member);
}

function dependency(resource: GodotRenderingServerResource, member: string, rid: GodotRid | null): void {
  if (rid !== null) resourceOf(rid, member);
  resource.dependencies.set(member, rid);
  update(resource, member, rid);
}

function finite(
  value: unknown,
  member: string,
  minimum = -Infinity,
  maximum = Infinity,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `godot-compat: RenderingServer.${member} requires a finite value in [${minimum}, ${maximum}].`,
    );
  }
  return value;
}

function integer(value: unknown, member: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  const number = finite(value, member, minimum);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw new RangeError(`godot-compat: RenderingServer.${member} requires an integer in [${minimum}, ${maximum}].`);
  }
  return number;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`godot-compat: RenderingServer.${member} requires bool.`);
  return value;
}

export function bindGodotRenderingServerResources(next: GodotRenderingServerResourceBinding | null): () => void {
  binding = next;
  if (next !== null) {
    for (const resource of RESOURCES.values()) {
      if (!resource.freed && resource.native === null) resource.native = next.create(snapshot(resource));
    }
  }
  return () => { if (binding === next) binding = null; };
}

export function watchGodotRenderingServerResources(
  listener: (resource: GodotRenderingServerResourceSnapshot, member: string) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function godotRenderingServerGetResource(rid: GodotRid): GodotRenderingServerResourceSnapshot {
  return snapshot(resourceOf(rid, 'get_resource'));
}

export function godotRenderingServerBindNative(rid: GodotRid, native: object | null): void {
  const resource = resourceOf(rid, 'bind_native');
  resource.native = native;
  update(resource, 'native', native);
}

export function godotRenderingServerGetNative<T extends object>(rid: GodotRid, kind?: GodotRenderingResourceKind): T | null {
  return resourceOf(rid, 'get_native', kind).native as T | null;
}

export function godotRenderingServerCameraCreate(): GodotRid { return create('camera'); }
export function godotRenderingServerEnvironmentCreate(): GodotRid { return create('environment'); }
export function godotRenderingServerInstanceCreate(): GodotRid { return create('instance'); }
export function godotRenderingServerLightCreate(): GodotRid { return create('light'); }
export function godotRenderingServerMaterialCreate(): GodotRid { return create('material'); }
export function godotRenderingServerMeshCreate(): GodotRid { return create('mesh'); }
export function godotRenderingServerMultimeshCreate(): GodotRid { return create('multimesh'); }
export function godotRenderingServerParticlesCreate(): GodotRid { return create('particles'); }
export function godotRenderingServerScenarioCreate(): GodotRid { return create('scenario'); }
export function godotRenderingServerShaderCreate(): GodotRid { return create('shader'); }
export function godotRenderingServerSkyCreate(): GodotRid { return create('sky'); }
export function godotRenderingServerTextureCreate(): GodotRid { return create('texture'); }
export function godotRenderingServerViewportCreate(): GodotRid { return create('viewport'); }

export function godotRenderingServerFreeRid(rid: GodotRid): void {
  const resource = resourceOf(rid, 'free_rid');
  const valueSnapshot = snapshot(resource);
  binding?.free(valueSnapshot);
  const native = resource.native as { dispose?: () => void; removeFromParent?: () => void } | null;
  native?.removeFromParent?.();
  native?.dispose?.();
  resource.freed = true;
  resource.native = null;
  resource.properties.clear();
  resource.dependencies.clear();
  RESOURCES.delete(godotRidGetId(rid));
}

export function godotRenderingServerCameraSetTransform(rid: GodotRid, transform: unknown): void {
  update(resourceOf(rid, 'camera_set_transform', 'camera'), 'transform', transform);
}
export function godotRenderingServerCameraSetPerspective(rid: GodotRid, fov: unknown, near: unknown, far: unknown): void {
  const resource = resourceOf(rid, 'camera_set_perspective', 'camera');
  update(resource, 'projection', 0); update(resource, 'fov', finite(fov, 'camera_set_perspective.fov', 1));
  update(resource, 'near', finite(near, 'camera_set_perspective.near', 0.0001)); update(resource, 'far', finite(far, 'camera_set_perspective.far', 0.0001));
}
export function godotRenderingServerCameraSetOrthogonal(rid: GodotRid, size: unknown, near: unknown, far: unknown): void {
  const resource = resourceOf(rid, 'camera_set_orthogonal', 'camera');
  update(resource, 'projection', 1); update(resource, 'size', finite(size, 'camera_set_orthogonal.size', 0.0001));
  update(resource, 'near', finite(near, 'camera_set_orthogonal.near', 0.0001)); update(resource, 'far', finite(far, 'camera_set_orthogonal.far', 0.0001));
}
export function godotRenderingServerCameraSetCullMask(rid: GodotRid, mask: unknown): void {
  update(resourceOf(rid, 'camera_set_cull_mask', 'camera'), 'cull_mask', integer(mask, 'camera_set_cull_mask', 0, 0xffff_ffff));
}
export function godotRenderingServerCameraSetEnvironment(rid: GodotRid, environment: GodotRid | null): void {
  dependency(resourceOf(rid, 'camera_set_environment', 'camera'), 'environment', environment);
}
export function godotRenderingServerCameraSetCompositor(rid: GodotRid, compositor: GodotRid | null): void {
  dependency(resourceOf(rid, 'camera_set_compositor', 'camera'), 'compositor', compositor);
}

export function godotRenderingServerMaterialSetShader(rid: GodotRid, shader: GodotRid | null): void {
  dependency(resourceOf(rid, 'material_set_shader', 'material'), 'shader', shader);
}
export function godotRenderingServerMaterialSetParam(rid: GodotRid, name: unknown, value: unknown): void {
  if (typeof name !== 'string') throw new TypeError('godot-compat: RenderingServer.material_set_param requires StringName.');
  update(resourceOf(rid, 'material_set_param', 'material'), `parameter:${name}`, value);
}
export function godotRenderingServerMaterialGetParam(rid: GodotRid, name: unknown): unknown {
  if (typeof name !== 'string') throw new TypeError('godot-compat: RenderingServer.material_get_param requires StringName.');
  return resourceOf(rid, 'material_get_param', 'material').properties.get(`parameter:${name}`) ?? null;
}
export function godotRenderingServerMaterialSetRenderPriority(rid: GodotRid, priority: unknown): void {
  update(resourceOf(rid, 'material_set_render_priority', 'material'), 'render_priority', integer(priority, 'material_set_render_priority', -128, 127));
}
export function godotRenderingServerMaterialSetNextPass(rid: GodotRid, next: GodotRid | null): void {
  dependency(resourceOf(rid, 'material_set_next_pass', 'material'), 'next_pass', next);
}

export function godotRenderingServerShaderSetCode(rid: GodotRid, code: unknown): void {
  if (typeof code !== 'string') throw new TypeError('godot-compat: RenderingServer.shader_set_code requires String.');
  update(resourceOf(rid, 'shader_set_code', 'shader'), 'code', code);
}
export function godotRenderingServerShaderGetCode(rid: GodotRid): string {
  return String(resourceOf(rid, 'shader_get_code', 'shader').properties.get('code') ?? '');
}
export function godotRenderingServerShaderSetDefaultTextureParameter(rid: GodotRid, name: unknown, textureRid: GodotRid | null, index = 0): void {
  if (typeof name !== 'string') throw new TypeError('godot-compat: shader texture parameter requires StringName.');
  if (textureRid !== null) resourceOf(textureRid, 'shader_set_default_texture_parameter', 'texture');
  dependency(resourceOf(rid, 'shader_set_default_texture_parameter', 'shader'), `texture:${name}:${integer(index, 'shader_texture_index')}`, textureRid);
}

export function godotRenderingServerMeshSetCustomAabb(rid: GodotRid, aabb: unknown): void {
  update(resourceOf(rid, 'mesh_set_custom_aabb', 'mesh'), 'custom_aabb', aabb);
}
export function godotRenderingServerMeshGetCustomAabb(rid: GodotRid): unknown {
  return resourceOf(rid, 'mesh_get_custom_aabb', 'mesh').properties.get('custom_aabb') ?? null;
}
export function godotRenderingServerMeshSetBlendShapeMode(rid: GodotRid, mode: unknown): void {
  update(resourceOf(rid, 'mesh_set_blend_shape_mode', 'mesh'), 'blend_shape_mode', integer(mode, 'mesh_set_blend_shape_mode', 0, 1));
}

export function godotRenderingServerInstanceSetBase(rid: GodotRid, base: GodotRid | null): void { dependency(resourceOf(rid, 'instance_set_base', 'instance'), 'base', base); }
export function godotRenderingServerInstanceSetScenario(rid: GodotRid, scenario: GodotRid | null): void { dependency(resourceOf(rid, 'instance_set_scenario', 'instance'), 'scenario', scenario); }
export function godotRenderingServerInstanceSetTransform(rid: GodotRid, transform: unknown): void { update(resourceOf(rid, 'instance_set_transform', 'instance'), 'transform', transform); }
export function godotRenderingServerInstanceSetVisible(rid: GodotRid, visible: unknown): void { update(resourceOf(rid, 'instance_set_visible', 'instance'), 'visible', bool(visible, 'instance_set_visible')); }
export function godotRenderingServerInstanceSetLayerMask(rid: GodotRid, mask: unknown): void { update(resourceOf(rid, 'instance_set_layer_mask', 'instance'), 'layer_mask', integer(mask, 'instance_set_layer_mask', 0, 0xffff_ffff)); }
export function godotRenderingServerInstanceSetMaterialOverride(rid: GodotRid, material: GodotRid | null): void { dependency(resourceOf(rid, 'instance_geometry_set_material_override', 'instance'), 'material_override', material); }
export function godotRenderingServerInstanceSetCastShadowsSetting(rid: GodotRid, setting: unknown): void { update(resourceOf(rid, 'instance_geometry_set_cast_shadows_setting', 'instance'), 'cast_shadows', integer(setting, 'instance_geometry_set_cast_shadows_setting', 0, 3)); }

export function godotRenderingServerViewportSetSize(rid: GodotRid, width: unknown, height: unknown): void {
  const resource = resourceOf(rid, 'viewport_set_size', 'viewport');
  update(resource, 'width', integer(width, 'viewport_set_size.width', 1)); update(resource, 'height', integer(height, 'viewport_set_size.height', 1));
}
export function godotRenderingServerViewportSetActive(rid: GodotRid, active: unknown): void { update(resourceOf(rid, 'viewport_set_active', 'viewport'), 'active', bool(active, 'viewport_set_active')); }
export function godotRenderingServerViewportSetScenario(rid: GodotRid, scenario: GodotRid | null): void { dependency(resourceOf(rid, 'viewport_set_scenario', 'viewport'), 'scenario', scenario); }
export function godotRenderingServerViewportSetCamera(rid: GodotRid, camera: GodotRid | null): void { dependency(resourceOf(rid, 'viewport_attach_camera', 'viewport'), 'camera', camera); }
export function godotRenderingServerViewportSetTransparentBackground(rid: GodotRid, transparent: unknown): void { update(resourceOf(rid, 'viewport_set_transparent_background', 'viewport'), 'transparent_background', bool(transparent, 'viewport_set_transparent_background')); }
export function godotRenderingServerViewportSetUpdateMode(rid: GodotRid, mode: unknown): void { update(resourceOf(rid, 'viewport_set_update_mode', 'viewport'), 'update_mode', integer(mode, 'viewport_set_update_mode', 0, 4)); }

export function godotRenderingServerParticlesSetAmount(rid: GodotRid, amount: unknown): void { update(resourceOf(rid, 'particles_set_amount', 'particles'), 'amount', integer(amount, 'particles_set_amount', 1)); }
export function godotRenderingServerParticlesSetLifetime(rid: GodotRid, lifetime: unknown): void { update(resourceOf(rid, 'particles_set_lifetime', 'particles'), 'lifetime', finite(lifetime, 'particles_set_lifetime', 0.001)); }
export function godotRenderingServerParticlesSetOneShot(rid: GodotRid, oneShot: unknown): void { update(resourceOf(rid, 'particles_set_one_shot', 'particles'), 'one_shot', bool(oneShot, 'particles_set_one_shot')); }
export function godotRenderingServerParticlesSetEmitting(rid: GodotRid, emitting: unknown): void { update(resourceOf(rid, 'particles_set_emitting', 'particles'), 'emitting', bool(emitting, 'particles_set_emitting')); }
export function godotRenderingServerParticlesSetProcessMaterial(rid: GodotRid, material: GodotRid | null): void { dependency(resourceOf(rid, 'particles_set_process_material', 'particles'), 'process_material', material); }
export function godotRenderingServerParticlesSetSpeedScale(rid: GodotRid, scale: unknown): void { update(resourceOf(rid, 'particles_set_speed_scale', 'particles'), 'speed_scale', finite(scale, 'particles_set_speed_scale', 0)); }
export function godotRenderingServerParticlesRestart(rid: GodotRid): void { update(resourceOf(rid, 'particles_restart', 'particles'), 'restart_serial', Date.now()); }

export function godotRenderingServerLightSetColor(rid: GodotRid, color: unknown): void {
  update(resourceOf(rid, 'light_set_color', 'light'), 'color', color);
}
export function godotRenderingServerLightSetParam(rid: GodotRid, parameter: unknown, value: unknown): void {
  const index = integer(parameter, 'light_set_param.parameter', 0, 32);
  update(resourceOf(rid, 'light_set_param', 'light'), `parameter:${index}`, finite(value, 'light_set_param.value'));
}
export function godotRenderingServerLightSetShadow(rid: GodotRid, enabled: unknown): void {
  update(resourceOf(rid, 'light_set_shadow', 'light'), 'shadow_enabled', bool(enabled, 'light_set_shadow'));
}
export function godotRenderingServerLightSetProjector(rid: GodotRid, texture: GodotRid | null): void {
  dependency(resourceOf(rid, 'light_set_projector', 'light'), 'projector', texture);
}
export function godotRenderingServerLightSetNegative(rid: GodotRid, enabled: unknown): void {
  update(resourceOf(rid, 'light_set_negative', 'light'), 'negative', bool(enabled, 'light_set_negative'));
}
export function godotRenderingServerLightSetCullMask(rid: GodotRid, mask: unknown): void {
  update(resourceOf(rid, 'light_set_cull_mask', 'light'), 'cull_mask', integer(mask, 'light_set_cull_mask', 0, 0xffff_ffff));
}
export function godotRenderingServerLightSetReverseCullFaceMode(rid: GodotRid, enabled: unknown): void {
  update(resourceOf(rid, 'light_set_reverse_cull_face_mode', 'light'), 'reverse_cull_face', bool(enabled, 'light_set_reverse_cull_face_mode'));
}
export function godotRenderingServerLightSetBakeMode(rid: GodotRid, mode: unknown): void {
  update(resourceOf(rid, 'light_set_bake_mode', 'light'), 'bake_mode', integer(mode, 'light_set_bake_mode', 0, 2));
}
export function godotRenderingServerLightSetMaxSdfgiCascade(rid: GodotRid, cascade: unknown): void {
  update(resourceOf(rid, 'light_set_max_sdfgi_cascade', 'light'), 'max_sdfgi_cascade', integer(cascade, 'light_set_max_sdfgi_cascade', 0, 8));
}

export function godotRenderingServerEnvironmentSetBackground(rid: GodotRid, mode: unknown): void {
  update(resourceOf(rid, 'environment_set_background', 'environment'), 'background_mode', integer(mode, 'environment_set_background', 0, 6));
}
export function godotRenderingServerEnvironmentSetSky(rid: GodotRid, sky: GodotRid | null): void {
  dependency(resourceOf(rid, 'environment_set_sky', 'environment'), 'sky', sky);
}
export function godotRenderingServerEnvironmentSetSkyCustomFov(rid: GodotRid, fov: unknown): void {
  update(resourceOf(rid, 'environment_set_sky_custom_fov', 'environment'), 'sky_custom_fov', finite(fov, 'environment_set_sky_custom_fov', 0));
}
export function godotRenderingServerEnvironmentSetSkyOrientation(rid: GodotRid, orientation: unknown): void {
  update(resourceOf(rid, 'environment_set_sky_orientation', 'environment'), 'sky_orientation', orientation);
}
export function godotRenderingServerEnvironmentSetBgColor(rid: GodotRid, color: unknown): void {
  update(resourceOf(rid, 'environment_set_bg_color', 'environment'), 'background_color', color);
}
export function godotRenderingServerEnvironmentSetBgEnergy(rid: GodotRid, multiplier: unknown, intensity?: unknown): void {
  const resource = resourceOf(rid, 'environment_set_bg_energy', 'environment');
  update(resource, 'background_energy_multiplier', finite(multiplier, 'environment_set_bg_energy.multiplier', 0));
  if (intensity !== undefined) update(resource, 'background_intensity', finite(intensity, 'environment_set_bg_energy.intensity', 0));
}
export function godotRenderingServerEnvironmentSetCanvasMaxLayer(rid: GodotRid, layer: unknown): void {
  update(resourceOf(rid, 'environment_set_canvas_max_layer', 'environment'), 'canvas_max_layer', integer(layer, 'environment_set_canvas_max_layer', -0x8000_0000, 0x7fff_ffff));
}
export function godotRenderingServerEnvironmentSetAmbientLight(
  rid: GodotRid, color: unknown, source: unknown, energy: unknown, skyContribution: unknown, reflectionSource: unknown,
): void {
  const resource = resourceOf(rid, 'environment_set_ambient_light', 'environment');
  update(resource, 'ambient_light_color', color);
  update(resource, 'ambient_light_source', integer(source, 'environment_set_ambient_light.source', 0, 3));
  update(resource, 'ambient_light_energy', finite(energy, 'environment_set_ambient_light.energy', 0));
  update(resource, 'ambient_light_sky_contribution', finite(skyContribution, 'environment_set_ambient_light.sky_contribution', 0, 1));
  update(resource, 'reflected_light_source', integer(reflectionSource, 'environment_set_ambient_light.reflection_source', 0, 2));
}
export function godotRenderingServerEnvironmentSetTonemap(
  rid: GodotRid, mode: unknown, exposure: unknown, white: unknown,
): void {
  const resource = resourceOf(rid, 'environment_set_tonemap', 'environment');
  update(resource, 'tonemap_mode', integer(mode, 'environment_set_tonemap.mode', 0, 4));
  update(resource, 'tonemap_exposure', finite(exposure, 'environment_set_tonemap.exposure', 0));
  update(resource, 'tonemap_white', finite(white, 'environment_set_tonemap.white', 0));
}
export function godotRenderingServerEnvironmentSetGlow(
  rid: GodotRid, enabled: unknown, levels: unknown, intensity: unknown, strength: unknown,
  mix: unknown, bloomThreshold: unknown, blendMode: unknown, hdrBleedThreshold: unknown,
  hdrBleedScale: unknown, hdrLuminanceCap: unknown, mapStrength: unknown, map: GodotRid | null,
): void {
  const resource = resourceOf(rid, 'environment_set_glow', 'environment');
  update(resource, 'glow_enabled', bool(enabled, 'environment_set_glow.enabled'));
  update(resource, 'glow_levels', levels); update(resource, 'glow_intensity', finite(intensity, 'environment_set_glow.intensity', 0));
  update(resource, 'glow_strength', finite(strength, 'environment_set_glow.strength', 0));
  update(resource, 'glow_mix', finite(mix, 'environment_set_glow.mix', 0, 1));
  update(resource, 'glow_bloom_threshold', finite(bloomThreshold, 'environment_set_glow.bloom_threshold', 0));
  update(resource, 'glow_blend_mode', integer(blendMode, 'environment_set_glow.blend_mode', 0, 4));
  update(resource, 'glow_hdr_bleed_threshold', finite(hdrBleedThreshold, 'environment_set_glow.hdr_bleed_threshold', 0));
  update(resource, 'glow_hdr_bleed_scale', finite(hdrBleedScale, 'environment_set_glow.hdr_bleed_scale', 0));
  update(resource, 'glow_hdr_luminance_cap', finite(hdrLuminanceCap, 'environment_set_glow.hdr_luminance_cap', 0));
  update(resource, 'glow_map_strength', finite(mapStrength, 'environment_set_glow.map_strength', 0));
  dependency(resource, 'glow_map', map);
}
export function godotRenderingServerEnvironmentSetFog(
  rid: GodotRid, enabled: unknown, lightColor: unknown, lightEnergy: unknown,
  sunScatter: unknown, density: unknown, height: unknown, heightDensity: unknown,
  aerialPerspective: unknown, skyAffect: unknown,
): void {
  const resource = resourceOf(rid, 'environment_set_fog', 'environment');
  update(resource, 'fog_enabled', bool(enabled, 'environment_set_fog.enabled'));
  update(resource, 'fog_light_color', lightColor);
  update(resource, 'fog_light_energy', finite(lightEnergy, 'environment_set_fog.light_energy', 0));
  update(resource, 'fog_sun_scatter', finite(sunScatter, 'environment_set_fog.sun_scatter', 0));
  update(resource, 'fog_density', finite(density, 'environment_set_fog.density', 0));
  update(resource, 'fog_height', finite(height, 'environment_set_fog.height'));
  update(resource, 'fog_height_density', finite(heightDensity, 'environment_set_fog.height_density', 0));
  update(resource, 'fog_aerial_perspective', finite(aerialPerspective, 'environment_set_fog.aerial_perspective', 0, 1));
  update(resource, 'fog_sky_affect', finite(skyAffect, 'environment_set_fog.sky_affect', 0, 1));
}
export function godotRenderingServerEnvironmentSetVolumetricFog(
  rid: GodotRid, enabled: unknown, density: unknown, albedo: unknown, emission: unknown,
  emissionEnergy: unknown, length: unknown, detailSpread: unknown, giInject: unknown,
  temporalReprojection: unknown, temporalReprojectionAmount: unknown, ambientInject: unknown,
): void {
  const resource = resourceOf(rid, 'environment_set_volumetric_fog', 'environment');
  update(resource, 'volumetric_fog_enabled', bool(enabled, 'environment_set_volumetric_fog.enabled'));
  update(resource, 'volumetric_fog_density', finite(density, 'environment_set_volumetric_fog.density', 0));
  update(resource, 'volumetric_fog_albedo', albedo); update(resource, 'volumetric_fog_emission', emission);
  update(resource, 'volumetric_fog_emission_energy', finite(emissionEnergy, 'environment_set_volumetric_fog.emission_energy', 0));
  update(resource, 'volumetric_fog_length', finite(length, 'environment_set_volumetric_fog.length', 0));
  update(resource, 'volumetric_fog_detail_spread', finite(detailSpread, 'environment_set_volumetric_fog.detail_spread', 0));
  update(resource, 'volumetric_fog_gi_inject', finite(giInject, 'environment_set_volumetric_fog.gi_inject', 0));
  update(resource, 'volumetric_fog_temporal_reprojection', bool(temporalReprojection, 'environment_set_volumetric_fog.temporal_reprojection'));
  update(resource, 'volumetric_fog_temporal_reprojection_amount', finite(temporalReprojectionAmount, 'environment_set_volumetric_fog.temporal_reprojection_amount', 0, 1));
  update(resource, 'volumetric_fog_ambient_inject', finite(ambientInject, 'environment_set_volumetric_fog.ambient_inject', 0, 1));
}

export function godotRenderingServerSkySetRadianceSize(rid: GodotRid, size: unknown): void {
  update(resourceOf(rid, 'sky_set_radiance_size', 'sky'), 'radiance_size', integer(size, 'sky_set_radiance_size', 32, 2048));
}
export function godotRenderingServerSkySetMode(rid: GodotRid, mode: unknown): void {
  update(resourceOf(rid, 'sky_set_mode', 'sky'), 'process_mode', integer(mode, 'sky_set_mode', 0, 3));
}
export function godotRenderingServerSkySetMaterial(rid: GodotRid, material: GodotRid | null): void {
  dependency(resourceOf(rid, 'sky_set_material', 'sky'), 'material', material);
}

export function godotRenderingServerMultimeshAllocateData(
  rid: GodotRid, instances: unknown, transformFormat: unknown, useColors: unknown, useCustomData: unknown,
): void {
  const resource = resourceOf(rid, 'multimesh_allocate_data', 'multimesh');
  update(resource, 'instance_count', integer(instances, 'multimesh_allocate_data.instances'));
  update(resource, 'transform_format', integer(transformFormat, 'multimesh_allocate_data.transform_format', 0, 1));
  update(resource, 'use_colors', bool(useColors, 'multimesh_allocate_data.use_colors'));
  update(resource, 'use_custom_data', bool(useCustomData, 'multimesh_allocate_data.use_custom_data'));
}
export function godotRenderingServerMultimeshSetMesh(rid: GodotRid, mesh: GodotRid | null): void {
  dependency(resourceOf(rid, 'multimesh_set_mesh', 'multimesh'), 'mesh', mesh);
}
export function godotRenderingServerMultimeshSetBuffer(rid: GodotRid, buffer: unknown): void {
  if (!Array.isArray(buffer) && !ArrayBuffer.isView(buffer)) throw new TypeError('godot-compat: multimesh_set_buffer requires PackedFloat32Array.');
  update(resourceOf(rid, 'multimesh_set_buffer', 'multimesh'), 'buffer', Array.from(buffer as ArrayLike<number>));
}
export function godotRenderingServerMultimeshGetBuffer(rid: GodotRid): unknown[] {
  return [...(resourceOf(rid, 'multimesh_get_buffer', 'multimesh').properties.get('buffer') as unknown[] | undefined ?? [])];
}
export function godotRenderingServerMultimeshSetVisibleInstances(rid: GodotRid, count: unknown): void {
  update(resourceOf(rid, 'multimesh_set_visible_instances', 'multimesh'), 'visible_instances', integer(count, 'multimesh_set_visible_instances', -1));
}
export function godotRenderingServerMultimeshSetCustomAabb(rid: GodotRid, aabb: unknown): void {
  update(resourceOf(rid, 'multimesh_set_custom_aabb', 'multimesh'), 'custom_aabb', aabb);
}

export function godotRenderingServerTexture2dUpdate(rid: GodotRid, image: unknown, layer = 0): void {
  const resource = resourceOf(rid, 'texture_2d_update', 'texture');
  update(resource, `image:${integer(layer, 'texture_2d_update.layer')}`, image);
}
export function godotRenderingServerTextureGetData(rid: GodotRid, layer = 0): unknown {
  return resourceOf(rid, 'texture_2d_get', 'texture').properties.get(`image:${integer(layer, 'texture_2d_get.layer')}`) ?? null;
}
export function godotRenderingServerTextureSetPath(rid: GodotRid, path: unknown): void {
  if (typeof path !== 'string') throw new TypeError('godot-compat: texture_set_path requires String.');
  update(resourceOf(rid, 'texture_set_path', 'texture'), 'path', path);
}
export function godotRenderingServerTextureGetPath(rid: GodotRid): string {
  return String(resourceOf(rid, 'texture_get_path', 'texture').properties.get('path') ?? '');
}

export type GodotRenderingServerNative = Camera | Light | Material | Object3D | Texture;
