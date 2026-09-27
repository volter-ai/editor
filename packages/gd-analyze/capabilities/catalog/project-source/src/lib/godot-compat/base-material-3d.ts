/**
 * @godot-class BaseMaterial3D
 * @role BINDING
 *
 * Godot 4.7's `BaseMaterial3D` (`scene/resources/material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three material. Its parameters are
 * Godot's (the setters store them; the getters read them back); the three material they draw with
 * is the Compatibility scene shader's reading of them (`drivers/gles3/shaders/scene.glsl`):
 * unshaded is three's `MeshBasicMaterial`, shaded its `MeshStandardMaterial`; albedo and the
 * emission (already multiplied by its energy, `material.cpp:1038`) are converted to linear by the
 * shader's own polynomial approximation of sRGB (`scene.glsl:2398`, `tonemap_inc.glsl:22`), and
 * three receives that linear color as it is. What the shaded lighting looks like beside Godot's is
 * judged visually.
 *
 * Of the material's textures the albedo texture is drawn: three's `map`, decoded from sRGB by the
 * GPU as Godot's `source_color` sampler is, sampled with the filter the material's `texture_filter`
 * selects in the Compatibility renderer (`drivers/gles3/storage/texture_storage.h:255`, the
 * default `use_nearest_mipmap_filter` off; anisotropy is not bound) and wrapped by its
 * `FLAG_USE_TEXTURE_REPEAT`. The other texture slots are stored and not drawn.
 */

import {
  AdditiveBlending,
  BackSide,
  type Blending,
  DoubleSide,
  ClampToEdgeWrapping,
  FrontSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NearestMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  Material,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MultiplyBlending,
  NoColorSpace,
  LinearSRGBColorSpace,
  Color as ThreeColor,
  NormalBlending,
  SubtractiveBlending,
} from 'three';
import { construct as color, type Color } from './color';
import { get_image, godot_texture_2d_image } from './texture-2d';

const f32 = Math.fround;

/** `BaseMaterial3D::Flags` (`material.h:255`): `FLAG_USE_TEXTURE_REPEAT` is 16, of 25. */
const FLAG_USE_TEXTURE_REPEAT = 16;
const FLAG_MAX = 25;
/** `BaseMaterial3D::TextureParam` (`material.h:147`): 19 slots, the albedo's first. */
const TEXTURE_ALBEDO = 0;
const TEXTURE_MAX = 19;

/** `BaseMaterial3D::Feature` (`material.h:209`): `FEATURE_EMISSION` is 0, `FEATURE_ANISOTROPY` 4, of 13. */
const FEATURE_EMISSION = 0;
const FEATURE_ANISOTROPY = 4;
const FEATURE_MAX = 13;

export interface BaseMaterial3D {
  albedo: Color;
  metallic: number;
  roughness: number;
  emission: Color;
  emission_energy_multiplier: number;
  features: boolean[];
  transparency: number;
  blend_mode: number;
  shading_mode: number;
  flags: boolean[];
  textures: (Texture | null)[];
  texture_filter: number;
  anisotropy: number;
  /** Drawn on three's own geometry (a scene's material): its maps' UV origin is three's. */
  sceneUv?: boolean;
}

const THREE_MATERIAL = new WeakMap<BaseMaterial3D, Material>();

/**
 * A material's parameters at `BaseMaterial3D`'s initial values (`material.cpp:3908`).
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.cpp:3908
 */
export function godot_base_material_3d_initial(): BaseMaterial3D {
  return {
    albedo: color(1, 1, 1, 1),
    metallic: 0,
    roughness: 1,
    emission: color(0, 0, 0),
    emission_energy_multiplier: 1,
    features: new Array<boolean>(FEATURE_MAX).fill(false),
    transparency: 0,
    blend_mode: 0,
    shading_mode: 1,
    // `flags[FLAG_USE_TEXTURE_REPEAT] = true` (`material.cpp:3977`).
    flags: Array.from({ length: FLAG_MAX }, (_, flag) => flag === FLAG_USE_TEXTURE_REPEAT),
    textures: new Array<Texture | null>(TEXTURE_MAX).fill(null),
    // `TEXTURE_FILTER_LINEAR_WITH_MIPMAPS` (`material.h:572`).
    texture_filter: 3,
    anisotropy: 0,
  };
}

/** `BaseMaterial3D::BlendMode` (`material.h:226`) to three's blending. */
function blending(mode: number): Blending {
  if (mode === 1) return AdditiveBlending;
  if (mode === 2) return SubtractiveBlending;
  if (mode === 3) return MultiplyBlending;
  return NormalBlending;
}

/**
 * The Compatibility shader's `srgb_to_linear` (`drivers/gles3/shaders/tonemap_inc.glsl:22`), a
 * polynomial approximation, in the GPU's single precision.
 */
function srgbToLinear(value: number): number {
  return f32(value * f32(f32(value * f32(f32(value * 0.305306011) + 0.682171111)) + 0.012522878));
}

const MAPS = new WeakMap<Texture, Map<string, Texture>>();
/** A sampled variant's texture resource. */
const VARIANT_OF = new WeakMap<Texture, Texture>();

/**
 * The albedo texture as the material samples it: one three texture per sampler state over the
 * same image (`gl_set_filter`, `gl_set_repeat`; mipmaps only when the image has them).
 */
function sampledMap(texture: Texture, filter: number, repeat: boolean, flipY = false, srgb = true): Texture {
  const key = `${String(filter)}:${String(repeat)}:${String(flipY)}:${String(srgb)}`;
  let variants = MAPS.get(texture);
  if (variants === undefined) {
    variants = new Map();
    MAPS.set(texture, variants);
  }
  let map = variants.get(key);
  if (map === undefined) {
    map = texture.clone();
    map.source = texture.source;
    variants.set(key, map);
    VARIANT_OF.set(map, texture);
    // The variant is the same texture resource: its image is the texture's.
    godot_texture_2d_image(map, () => get_image(texture));
  }
  map.flipY = flipY;
  const mipmapped = texture.mipmaps !== undefined && texture.mipmaps.length > 1;
  const nearest = filter === 0 || filter === 2 || filter === 4;
  map.magFilter = nearest ? NearestFilter : LinearFilter;
  map.minFilter = filter <= 1 || !mipmapped ? map.magFilter : nearest ? NearestMipmapLinearFilter : LinearMipmapLinearFilter;
  map.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  map.wrapT = map.wrapS;
  map.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  return map;
}

/**
 * A texture sampled as a material of the scene samples it (its `texture_filter` and
 * `FLAG_USE_TEXTURE_REPEAT`), for three's own geometry: three's UVs put their origin at the image's
 * bottom row where Godot's put it at the top, so the image is uploaded flipped. A colour texture
 * (`source_color`, the albedo) is decoded from sRGB; a data texture (roughness) is not.
 *
 * @godot BaseMaterial3D (protocol)
 * @source drivers/gles3/storage/texture_storage.h:255
 */
export function godot_base_material_3d_scene_map(texture: Texture, filter: number, repeat: boolean, srgb = true): Texture {
  return sampledMap(texture, filter, repeat, true, srgb);
}

/** The parameters onto a three material of the class the shading mode selects. */
function apply(self: BaseMaterial3D, target: Material): void {
  const shaded = target as MeshStandardMaterial;
  if (!((shaded.color as unknown) instanceof ThreeColor)) shaded.color = new ThreeColor();
  shaded.color.setRGB(
    srgbToLinear(self.albedo.r),
    srgbToLinear(self.albedo.g),
    srgbToLinear(self.albedo.b),
    LinearSRGBColorSpace,
  );
  target.transparent = self.transparency !== 0;
  target.opacity = self.transparency !== 0 ? self.albedo.a : 1;
  target.alphaTest = self.transparency === 2 ? 0.5 : 0;
  target.blending = blending(self.blend_mode);
  applyExtra(self, target);
  const albedo = self.textures[TEXTURE_ALBEDO] ?? null;
  (target as MeshStandardMaterial).map =
    albedo === null ? null : sampledMap(albedo, self.texture_filter, self.flags[FLAG_USE_TEXTURE_REPEAT] === true, self.sceneUv === true);
  if (target instanceof MeshStandardMaterial) {
    if (!((target.emissive as unknown) instanceof ThreeColor)) target.emissive = new ThreeColor();
    target.metalness = self.metallic;
    target.roughness = self.roughness;
    if (self.features[FEATURE_EMISSION] === true) {
      const energy = self.emission_energy_multiplier;
      target.emissive.setRGB(
        srgbToLinear(f32(self.emission.r * energy)),
        srgbToLinear(f32(self.emission.g * energy)),
        srgbToLinear(f32(self.emission.b * energy)),
        LinearSRGBColorSpace,
      );
    } else {
      target.emissive.setRGB(0, 0, 0);
    }
    target.emissiveIntensity = 1;
  }
  if (target instanceof MeshPhysicalMaterial) {
    const { anisotropy, rotation } = anisotropyOf(self);
    target.anisotropy = anisotropy;
    target.anisotropyRotation = rotation;
  }
  target.needsUpdate = true;
}

const OF_THREE = new WeakMap<Material, BaseMaterial3D>();

/** A colour prop as three holds it (in Node, R3F may leave the literal it was given). */
function threeColor(value: unknown): ThreeColor {
  if (value instanceof ThreeColor) return value;
  if (Array.isArray(value)) return new ThreeColor(value[0] as number, value[1] as number, value[2] as number);
  if (typeof value === 'string') return new ThreeColor(value);
  const c = value as { readonly r: number; readonly g: number; readonly b: number };
  return new ThreeColor(c.r, c.g, c.b);
}

/**
 * The material a scene's three material is (`<meshStandardMaterial>`, `<meshBasicMaterial>`): one
 * Godot material per three material, so every node that shares it shares the Godot resource, its
 * parameters read back from what the scene states (the albedo from the colour, the albedo texture
 * from the map with its sampler, transparency, blending, shading, metallic, roughness, emission),
 * its setters drawing onto that same three material.
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.cpp:3908
 */
export function godot_base_material_3d_of(target: Material): BaseMaterial3D {
  const existing = OF_THREE.get(target);
  if (existing !== undefined) return existing;
  const self = godot_base_material_3d_initial();
  const shaded = target as MeshStandardMaterial;
  const srgb = threeColor(shaded.color).clone().convertLinearToSRGB();
  self.transparency = target.transparent ? (target.alphaTest > 0 ? 2 : 1) : 0;
  self.albedo = color(f32(srgb.r), f32(srgb.g), f32(srgb.b), self.transparency === 0 ? 1 : f32(target.opacity));
  self.blend_mode = target.blending === AdditiveBlending ? 1 : target.blending === SubtractiveBlending ? 2 : target.blending === MultiplyBlending ? 3 : 0;
  self.shading_mode = target instanceof MeshBasicMaterial || target.type === 'MeshBasicMaterial' ? 0 : 1;
  if (self.shading_mode === 1) {
    self.metallic = f32(shaded.metalness);
    self.roughness = f32(shaded.roughness);
    const emissive = threeColor(shaded.emissive);
    if (emissive.r !== 0 || emissive.g !== 0 || emissive.b !== 0) {
      const e = emissive.clone().convertLinearToSRGB();
      self.features[FEATURE_EMISSION] = true;
      self.emission = color(f32(e.r), f32(e.g), f32(e.b), 1);
    }
  }
  const map = shaded.map ?? null;
  if (map !== null) {
    self.textures[TEXTURE_ALBEDO] = VARIANT_OF.get(map) ?? map;
    const nearest = map.magFilter === NearestFilter;
    const mipmapped = map.minFilter !== map.magFilter;
    self.texture_filter = (nearest ? 0 : 1) + (mipmapped || (map.mipmaps?.length ?? 0) <= 1 ? 2 : 0);
    self.flags[FLAG_USE_TEXTURE_REPEAT] = map.wrapS === RepeatWrapping;
  }
  const extra = extraOf(self);
  extra.cull_mode = target.side === BackSide ? 1 : target.side === DoubleSide ? 2 : 0;
  const data = target.userData as Readonly<Record<string, unknown>>;
  if (typeof data['billboard_mode'] === 'number') extra.billboard_mode = data['billboard_mode'];
  if (data['billboard_keep_scale'] === true) self.flags[FLAG_BILLBOARD_KEEP_SCALE] = true;
  if (data['vertex_color_use_as_albedo'] === true) self.flags[FLAG_ALBEDO_FROM_VERTEX_COLOR] = true;
  if (data['vertex_color_is_srgb'] === true) self.flags[FLAG_SRGB_VERTEX_COLOR] = true;
  if (data['proximity_fade_enabled'] === true) extra.proximity_fade_enabled = true;
  if (typeof data['proximity_fade_distance'] === 'number') extra.proximity_fade_distance = f32(data['proximity_fade_distance']);
  if (target instanceof MeshPhysicalMaterial || target.type === 'MeshPhysicalMaterial') {
    const physical = target as MeshPhysicalMaterial;
    self.features[FEATURE_ANISOTROPY] = true;
    self.anisotropy = f32(physical.anisotropyRotation === 0 ? physical.anisotropy : -physical.anisotropy);
  }
  self.sceneUv = true;
  THREE_MATERIAL.set(self, target);
  OF_THREE.set(target, self);
  return self;
}

/**
 * The three material the Compatibility renderer's scene shader draws this material as, kept in
 * step with its parameters.
 *
 * @godot BaseMaterial3D (protocol)
 * @source drivers/gles3/shaders/scene.glsl:2398
 */
export function godot_base_material_3d_three(self: BaseMaterial3D): Material {
  let target = THREE_MATERIAL.get(self);
  const unshaded = self.shading_mode === 0;
  const physical = !unshaded && self.features[FEATURE_ANISOTROPY] === true;
  if (target === undefined || (target instanceof MeshBasicMaterial) !== unshaded || (target instanceof MeshPhysicalMaterial) !== physical) {
    target = unshaded ? new MeshBasicMaterial() : physical ? new MeshPhysicalMaterial() : new MeshStandardMaterial();
    THREE_MATERIAL.set(self, target);
  }
  apply(self, target);
  return target;
}

function changed(self: BaseMaterial3D): void {
  const target = THREE_MATERIAL.get(self);
  if (target !== undefined) apply(self, target);
}

/**
 * @godot BaseMaterial3D.set_albedo
 * @source scene/resources/material.cpp:2122
 */
export function set_albedo(self: BaseMaterial3D, albedo: Color): void {
  self.albedo = albedo;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_albedo
 * @source scene/resources/material.cpp:2127
 */
export function get_albedo(self: BaseMaterial3D): Color {
  return self.albedo;
}

/**
 * @godot BaseMaterial3D.set_roughness
 * @source scene/resources/material.cpp:2140
 */
export function set_roughness(self: BaseMaterial3D, roughness: number): void {
  self.roughness = f32(roughness);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_roughness
 * @source scene/resources/material.cpp:2145
 */
export function get_roughness(self: BaseMaterial3D): number {
  return self.roughness;
}

/**
 * @godot BaseMaterial3D.set_metallic
 * @source scene/resources/material.cpp:2149
 */
export function set_metallic(self: BaseMaterial3D, metallic: number): void {
  self.metallic = f32(metallic);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_metallic
 * @source scene/resources/material.cpp:2154
 */
export function get_metallic(self: BaseMaterial3D): number {
  return self.metallic;
}

/**
 * @godot BaseMaterial3D.set_emission
 * @source scene/resources/material.cpp:2158
 */
export function set_emission(self: BaseMaterial3D, emission: Color): void {
  self.emission = emission;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_emission
 * @source scene/resources/material.cpp:2163
 */
export function get_emission(self: BaseMaterial3D): Color {
  return self.emission;
}

/**
 * With physical light units off (the default), the shader's energy is the multiplier itself.
 *
 * @godot BaseMaterial3D.set_emission_energy_multiplier
 * @source scene/resources/material.cpp:2167
 */
export function set_emission_energy_multiplier(self: BaseMaterial3D, multiplier: number): void {
  self.emission_energy_multiplier = f32(multiplier);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_emission_energy_multiplier
 * @source scene/resources/material.cpp:2177
 */
export function get_emission_energy_multiplier(self: BaseMaterial3D): number {
  return self.emission_energy_multiplier;
}

/**
 * An index outside `Feature` fails and leaves the features.
 *
 * @godot BaseMaterial3D.set_feature
 * @source scene/resources/material.cpp:2493
 */
export function set_feature(self: BaseMaterial3D, feature: number, enabled: boolean): void {
  if (feature < 0 || feature >= FEATURE_MAX) return;
  self.features[feature] = enabled;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_feature
 * @source scene/resources/material.cpp:2503
 */
export function get_feature(self: BaseMaterial3D, feature: number): boolean {
  if (feature < 0 || feature >= FEATURE_MAX) return false;
  return self.features[feature] === true;
}

/**
 * @godot BaseMaterial3D.set_transparency
 * @source scene/resources/material.cpp:2352
 */
export function set_transparency(self: BaseMaterial3D, transparency: number): void {
  self.transparency = transparency;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_transparency
 * @source scene/resources/material.cpp:2362
 */
export function get_transparency(self: BaseMaterial3D): number {
  return self.transparency;
}

/**
 * @godot BaseMaterial3D.set_blend_mode
 * @source scene/resources/material.cpp:2330
 */
export function set_blend_mode(self: BaseMaterial3D, mode: number): void {
  self.blend_mode = mode;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_blend_mode
 * @source scene/resources/material.cpp:2339
 */
export function get_blend_mode(self: BaseMaterial3D): number {
  return self.blend_mode;
}

/**
 * @godot BaseMaterial3D.set_shading_mode
 * @source scene/resources/material.cpp:2380
 */
export function set_shading_mode(self: BaseMaterial3D, mode: number): void {
  self.shading_mode = mode;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_shading_mode
 * @source scene/resources/material.cpp:2390
 */
export function get_shading_mode(self: BaseMaterial3D): number {
  return self.shading_mode;
}

/**
 * @godot BaseMaterial3D.set_flag
 * @source scene/resources/material.cpp:2459
 */
export function set_flag(self: BaseMaterial3D, flag: number, enabled: boolean): void {
  if (flag < 0 || flag >= FLAG_MAX) return;
  self.flags[flag] = enabled;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_flag
 * @source scene/resources/material.cpp:2488
 */
export function get_flag(self: BaseMaterial3D, flag: number): boolean {
  return flag >= 0 && flag < FLAG_MAX ? self.flags[flag] === true : false;
}

/**
 * @godot BaseMaterial3D.set_texture
 * @source scene/resources/material.cpp:2508
 */
export function set_texture(self: BaseMaterial3D, param: number, texture: Texture | null): void {
  if (param < 0 || param >= TEXTURE_MAX) return;
  self.textures[param] = texture;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_texture
 * @source scene/resources/material.cpp:2523
 */
export function get_texture(self: BaseMaterial3D, param: number): Texture | null {
  return param >= 0 && param < TEXTURE_MAX ? (self.textures[param] ?? null) : null;
}

/**
 * @godot BaseMaterial3D.set_texture_filter
 * @source scene/resources/material.cpp:2538
 */
export function set_texture_filter(self: BaseMaterial3D, filter: number): void {
  self.texture_filter = filter;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_texture_filter
 * @source scene/resources/material.cpp:2543
 */
export function get_texture_filter(self: BaseMaterial3D): number {
  return self.texture_filter;
}

// --- Culling, billboards, vertex colour and proximity fade.

/** `BaseMaterial3D::Flags` (`material.h:255`) this section reads. */
const FLAG_ALBEDO_FROM_VERTEX_COLOR = 1;
const FLAG_SRGB_VERTEX_COLOR = 2;
const FLAG_BILLBOARD_KEEP_SCALE = 5;

/** The parameters beyond the shared ones (`material.h`), at their initial values (`material.cpp:3938`). */
interface Extra {
  cull_mode: number;
  billboard_mode: number;
  particles_anim_h_frames: number;
  particles_anim_v_frames: number;
  particles_anim_loop: boolean;
  proximity_fade_enabled: boolean;
  proximity_fade_distance: number;
}

const EXTRA = new WeakMap<BaseMaterial3D, Extra>();

function extraOf(self: BaseMaterial3D): Extra {
  let extra = EXTRA.get(self);
  if (extra === undefined) {
    extra = {
      cull_mode: 0,
      billboard_mode: 0,
      particles_anim_h_frames: 1,
      particles_anim_v_frames: 1,
      particles_anim_loop: false,
      proximity_fade_enabled: false,
      proximity_fade_distance: 1,
    };
    EXTRA.set(self, extra);
  }
  return extra;
}

/** `CULL_BACK`, `CULL_FRONT`, `CULL_DISABLED` (`material.h:296`) as three's side drawn. */
const SIDES = [FrontSide, BackSide, DoubleSide] as const;

/**
 * The parameters beyond the shared ones onto the three material: the side the cull mode draws, the
 * Godot-only ones in its `userData` (what a particle system reads of vertex colour), and the
 * billboard (`godot_base_material_3d_scene_shader`). Proximity fade draws through the alpha pass
 * (`material.cpp:1807`), three's `transparent`; its fade, which samples the scene's depth, is not
 * drawn (`proximity-fade`, a named deviation: three gives a material no depth texture of the scene).
 */
function applyExtra(self: BaseMaterial3D, target: Material): void {
  const extra = extraOf(self);
  target.side = SIDES[extra.cull_mode] ?? FrontSide;
  if (extra.proximity_fade_enabled) target.transparent = true;
  Object.assign(target.userData, {
    billboard_mode: extra.billboard_mode,
    billboard_keep_scale: self.flags[FLAG_BILLBOARD_KEEP_SCALE] === true,
    vertex_color_use_as_albedo: self.flags[FLAG_ALBEDO_FROM_VERTEX_COLOR] === true,
    vertex_color_is_srgb: self.flags[FLAG_SRGB_VERTEX_COLOR] === true,
    proximity_fade_enabled: extra.proximity_fade_enabled,
    proximity_fade_distance: extra.proximity_fade_distance,
  });
  godot_base_material_3d_scene_shader(target);
}

/**
 * The billboard modes' vertex code (`BaseMaterial3D::_update_shader`, `material.cpp:1231`) in three's
 * `project_vertex` chunk: the model-view matrix faces the camera (`MAIN_CAM_INV_VIEW_MATRIX`'s basis
 * at the model's origin; a particle billboard normalized and turned by the particle's angle,
 * `INSTANCE_CUSTOM.x`, a particle system's `godotInstanceCustom`), keeping the model's scale when
 * the flag is set. The normal matrix is not replaced (`billboard-normals`, a named deviation: a lit
 * billboard shades with its unturned normals; the platformer's billboards are unshaded).
 */
function billboardChunk(mode: number, keepScale: boolean): string {
  const model = [
    'mat4 godotModel = modelMatrix;',
    '#ifdef USE_INSTANCING',
    '\tgodotModel = modelMatrix * instanceMatrix;',
    '#endif',
    'mat4 godotInvView = inverse( viewMatrix );',
  ];
  const facing =
    mode === 3
      ? [
          'mat4 godotWorld = mat4( normalize( godotInvView[ 0 ] ), normalize( godotInvView[ 1 ] ), normalize( godotInvView[ 2 ] ), godotModel[ 3 ] );',
          'godotWorld = godotWorld * mat4( vec4( cos( godotInstanceCustom.x ), -sin( godotInstanceCustom.x ), 0.0, 0.0 ), vec4( sin( godotInstanceCustom.x ), cos( godotInstanceCustom.x ), 0.0, 0.0 ), vec4( 0.0, 0.0, 1.0, 0.0 ), vec4( 0.0, 0.0, 0.0, 1.0 ) );',
          'mat4 godotModelView = viewMatrix * godotWorld;',
        ]
      : mode === 2
        ? [
            'mat4 godotModelView = viewMatrix * mat4( vec4( normalize( cross( vec3( 0.0, 1.0, 0.0 ), godotInvView[ 2 ].xyz ) ), 0.0 ), vec4( 0.0, 1.0, 0.0, 0.0 ), vec4( normalize( cross( godotInvView[ 0 ].xyz, vec3( 0.0, 1.0, 0.0 ) ) ), 0.0 ), godotModel[ 3 ] );',
          ]
        : ['mat4 godotModelView = viewMatrix * mat4( godotInvView[ 0 ], godotInvView[ 1 ], godotInvView[ 2 ], godotModel[ 3 ] );'];
  const scale = keepScale
    ? ['godotModelView = godotModelView * mat4( vec4( length( godotModel[ 0 ].xyz ), 0.0, 0.0, 0.0 ), vec4( 0.0, length( godotModel[ 1 ].xyz ), 0.0, 0.0 ), vec4( 0.0, 0.0, length( godotModel[ 2 ].xyz ), 0.0 ), vec4( 0.0, 0.0, 0.0, 1.0 ) );']
    : [];
  return [...model, ...facing, ...scale, 'vec4 mvPosition = godotModelView * vec4( transformed, 1.0 );', 'gl_Position = projectionMatrix * mvPosition;'].join('\n');
}

/**
 * The material drawn as Godot's scene shader draws its billboard and vertex colour: three's
 * `project_vertex` replaced by the billboard mode's model-view matrix (`material.cpp:1231`), and an
 * instanced draw's `godotInstanceColor` (a particle's `COLOR`) multiplying the albedo and its alpha
 * where the material takes vertex colour as albedo (`albedo_tex *= COLOR`, `material.cpp:1643`).
 * The Compatibility shader converts the product to linear (`SHADER_IS_SRGB`, `scene.glsl:2398`);
 * three's colour is already linear, so the vertex colour is converted by the same polynomial and
 * multiplied (`vertex-colour-linearization`, a named deviation: a product of conversions for the
 * conversion of a product, equal for a white colour and its alpha). Particle animation frames
 * other than one by one are not drawn (the platformer's are one by one). Returns the material.
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.cpp:1231
 */
export function godot_base_material_3d_scene_shader<M extends Material>(target: M): M {
  const data = target.userData as Readonly<Record<string, unknown>>;
  const mode = typeof data['billboard_mode'] === 'number' ? data['billboard_mode'] : 0;
  const keepScale = data['billboard_keep_scale'] === true;
  const coloured = data['vertex_color_use_as_albedo'] === true;
  const key = `godot-scene:${String(mode)}:${String(keepScale)}:${String(coloured)}`;
  const plain = mode === 0 && !coloured;
  if (target.customProgramCacheKey() === key || (plain && target.onBeforeCompile === Material.prototype.onBeforeCompile)) return target;
  if (plain) {
    target.onBeforeCompile = Material.prototype.onBeforeCompile;
    target.customProgramCacheKey = Material.prototype.customProgramCacheKey;
  } else {
    target.onBeforeCompile = (shader) => {
      let vertex = shader.vertexShader;
      let fragment = shader.fragmentShader;
      if (mode !== 0) vertex = `attribute vec4 godotInstanceCustom;\n${vertex.replace('#include <project_vertex>', billboardChunk(mode, keepScale))}`;
      if (coloured) {
        vertex = `attribute vec4 godotInstanceColor;\nvarying vec4 vGodotColor;\n${vertex.replace('#include <color_vertex>', '#include <color_vertex>\nvGodotColor = vec4( 1.0 );\n#ifdef USE_INSTANCING\n\tvGodotColor = godotInstanceColor;\n#endif')}`;
        fragment = `varying vec4 vGodotColor;\n${fragment.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor *= vec4( vGodotColor.rgb * ( vGodotColor.rgb * ( vGodotColor.rgb * 0.305306011 + 0.682171111 ) + 0.012522878 ), vGodotColor.a );',
        )}`;
      }
      shader.vertexShader = vertex;
      shader.fragmentShader = fragment;
    };
    target.customProgramCacheKey = () => key;
  }
  target.needsUpdate = true;
  return target;
}

/**
 * @godot BaseMaterial3D.set_cull_mode
 * @source scene/resources/material.cpp:2420
 */
export function set_cull_mode(self: BaseMaterial3D, mode: number): void {
  extraOf(self).cull_mode = mode;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_cull_mode
 * @source scene/resources/material.cpp:2429
 */
export function get_cull_mode(self: BaseMaterial3D): number {
  return extraOf(self).cull_mode;
}

/**
 * @godot BaseMaterial3D.set_billboard_mode
 * @source scene/resources/material.cpp:2793
 */
export function set_billboard_mode(self: BaseMaterial3D, mode: number): void {
  extraOf(self).billboard_mode = mode;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_billboard_mode
 * @source scene/resources/material.cpp:2799
 */
export function get_billboard_mode(self: BaseMaterial3D): number {
  return extraOf(self).billboard_mode;
}

/**
 * @godot BaseMaterial3D.set_particles_anim_h_frames
 * @source scene/resources/material.cpp:2803
 */
export function set_particles_anim_h_frames(self: BaseMaterial3D, frames: number): void {
  extraOf(self).particles_anim_h_frames = frames;
}

/**
 * @godot BaseMaterial3D.get_particles_anim_h_frames
 * @source scene/resources/material.cpp:2808
 */
export function get_particles_anim_h_frames(self: BaseMaterial3D): number {
  return extraOf(self).particles_anim_h_frames;
}

/**
 * @godot BaseMaterial3D.set_particles_anim_v_frames
 * @source scene/resources/material.cpp:2812
 */
export function set_particles_anim_v_frames(self: BaseMaterial3D, frames: number): void {
  extraOf(self).particles_anim_v_frames = frames;
}

/**
 * @godot BaseMaterial3D.get_particles_anim_v_frames
 * @source scene/resources/material.cpp:2817
 */
export function get_particles_anim_v_frames(self: BaseMaterial3D): number {
  return extraOf(self).particles_anim_v_frames;
}

/**
 * @godot BaseMaterial3D.set_particles_anim_loop
 * @source scene/resources/material.cpp:2821
 */
export function set_particles_anim_loop(self: BaseMaterial3D, loop: boolean): void {
  extraOf(self).particles_anim_loop = loop;
}

/**
 * @godot BaseMaterial3D.get_particles_anim_loop
 * @source scene/resources/material.cpp:2826
 */
export function get_particles_anim_loop(self: BaseMaterial3D): boolean {
  return extraOf(self).particles_anim_loop;
}

/**
 * @godot BaseMaterial3D.set_proximity_fade_enabled
 * @source scene/resources/material.cpp:3047
 */
export function set_proximity_fade_enabled(self: BaseMaterial3D, enabled: boolean): void {
  extraOf(self).proximity_fade_enabled = enabled;
  changed(self);
}

/**
 * @godot BaseMaterial3D.is_proximity_fade_enabled
 * @source scene/resources/material.cpp:3053
 */
export function is_proximity_fade_enabled(self: BaseMaterial3D): boolean {
  return extraOf(self).proximity_fade_enabled;
}

/**
 * At least 0.01.
 *
 * @godot BaseMaterial3D.set_proximity_fade_distance
 * @source scene/resources/material.cpp:3057
 */
export function set_proximity_fade_distance(self: BaseMaterial3D, distance: number): void {
  extraOf(self).proximity_fade_distance = f32(Math.max(f32(distance), f32(0.01)));
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_proximity_fade_distance
 * @source scene/resources/material.cpp:3062
 */
export function get_proximity_fade_distance(self: BaseMaterial3D): number {
  return extraOf(self).proximity_fade_distance;
}

// --- Anisotropy.

/**
 * The scene shader's anisotropy (`material.cpp:1894`): `ANISOTROPY = anisotropy_ratio *
 * flowmap.a`, its direction `flowmap.rg * 2 - 1`, the flowmap Godot's default anisotropy texture
 * (`Color(1, 0.5, 1, 1)`, `texture_storage.cpp:176`) where none is set: the tangent's direction at
 * full strength. Three's physical material takes a strength and a rotation from the tangent: a
 * positive ratio is that strength along the tangent; a negative one stretches the highlight across
 * it (`aspect = sqrt(1 - anisotropy * 0.9)`, `scene.glsl:1686`, greater than one), the rotation a
 * quarter turn. Three's anisotropic GGX is the glTF extension's (roughness along the tangent
 * mixed toward one) where Godot divides and multiplies by the aspect (`anisotropy-model`, a named
 * deviation: the same stretched highlight, a different profile).
 */
function anisotropyOf(self: BaseMaterial3D): { readonly anisotropy: number; readonly rotation: number } {
  const ratio = self.anisotropy;
  return { anisotropy: Math.abs(ratio), rotation: ratio < 0 ? Math.PI / 2 : 0 };
}

/**
 * Three's anisotropy for a material's parameters (`anisotropyOf`), as a scene states it.
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.cpp:1894
 */
export function godot_base_material_3d_anisotropy(ratio: number): { readonly anisotropy: number; readonly rotation: number } {
  const self = godot_base_material_3d_initial();
  self.anisotropy = f32(ratio);
  return anisotropyOf(self);
}

/**
 * @godot BaseMaterial3D.set_anisotropy
 * @source scene/resources/material.cpp:2245
 */
export function set_anisotropy(self: BaseMaterial3D, anisotropy: number): void {
  self.anisotropy = f32(anisotropy);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_anisotropy
 * @source scene/resources/material.cpp:2250
 */
export function get_anisotropy(self: BaseMaterial3D): number {
  return self.anisotropy;
}
