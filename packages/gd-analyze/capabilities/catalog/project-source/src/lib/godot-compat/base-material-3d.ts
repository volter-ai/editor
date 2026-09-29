/**
 * @godot-class BaseMaterial3D
 * @role BINDING
 *
 * Godot 4.7's `BaseMaterial3D` (`scene/resources/material.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto a three material. Its parameters are
 * Godot's (the setters store them; the getters read them back); the three material they draw with
 * is what a three.js developer would pick for them (`godot_base_material_3d_three`): unshaded is
 * three's `MeshBasicMaterial`, the toon diffuse mode its `MeshToonMaterial`, a material whose
 * specular three's standard material cannot state (an amount other than 0.5, specular disabled) or
 * that is anisotropic its `MeshPhysicalMaterial`, any other its `MeshStandardMaterial`; albedo and the
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
 *
 * Each setting maps to three's own idiom where three has one: transparency to `transparent`
 * (alpha, depth pre-pass), `alphaTest` (scissor) or `alphaHash` (hash), with the albedo's alpha as
 * `opacity`; the blend mode to `blending`; the cull mode to `side`; the specular amount to the
 * physical material's `reflectivity` (three's reflectivity is Godot's specular: both make the
 * dielectric F0 `0.16 * specular^2`), specular disabled to its `specularIntensity` 0; the depth draw
 * mode to `depthWrite` (`godot_base_material_3d_depth_write`). Three's lighting draws every lit
 * material: nothing patches its shader chunks. Proximity fade is three's soft particles: the
 * material fades by how far in front of the scene's depth it is
 * (`godot_base_material_3d_scene_shader`). Distance fade is the albedo's alpha faded over the view
 * distance, `transparent` for pixel alpha and three's hashed alpha (`alphaHash`) for the dithers,
 * which dither by three's hash, not Godot's interleaved gradient noise. Where three has no idiom
 * (the Lambert, Lambert wrap and Burley diffuse modes beside three's own Lambert, toon specular,
 * rim, backlight, grow, not receiving shadows) the value is stored, read back by its getter, and draws nothing. The
 * stencil effect parameters are stored: they draw only through `stencil_mode` (outline or x-ray,
 * `material.cpp:3151`), which is not bound, so a material's stencil is always disabled and draws
 * nothing (`material.cpp:887`).
 *
 * Reflection probes: in a project that places one, a scene's lit material is the game editor's
 * reflections volume material (the plan's, `scene-material-idioms.ts`; `reflection-probe.ts` says
 * how it draws a probe), and this module reads and sets it as any three standard material. A
 * material this module makes itself is three's own class and does not reflect the probes, since
 * compat imports no other capability; one it replaces is disposed.
 */

import {
  AdditiveBlending,
  type BufferGeometry,
  BackSide,
  type Blending,
  type Camera,
  DepthTexture,
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
  MeshDepthMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  MultiplyBlending,
  NoColorSpace,
  LinearSRGBColorSpace,
  Color as ThreeColor,
  NormalBlending,
  type Object3D,
  type Scene,
  SubtractiveBlending,
  UnsignedIntType,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { construct as color, type Color } from './color';
import { get_image, godot_texture_2d_image } from './texture-2d';
import { construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;

/** `BaseMaterial3D::Flags` (`material.h:255`): `FLAG_USE_TEXTURE_REPEAT` is 16, of 25. */
const FLAG_USE_TEXTURE_REPEAT = 16;
const FLAG_MAX = 25;
/** `BaseMaterial3D::TextureParam` (`material.h:147`): 19 slots, the albedo's first. */
const TEXTURE_ALBEDO = 0;
const TEXTURE_MAX = 19;

/**
 * `BaseMaterial3D::Feature` (`material.h:209`): `FEATURE_EMISSION` is 0, `FEATURE_RIM` 2,
 * `FEATURE_ANISOTROPY` 4, `FEATURE_BACKLIGHT` 9, of 13.
 */
const FEATURE_EMISSION = 0;
const FEATURE_RIM = 2;
const FEATURE_ANISOTROPY = 4;
const FEATURE_BACKLIGHT = 9;
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
}

const THREE_MATERIAL = new WeakMap<BaseMaterial3D, Material>();
/** The material as it draws on an imported model's surface, where one has been asked for. */
const MODEL_MATERIAL = new WeakMap<BaseMaterial3D, Material>();

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
 * A texture as a material samples it: one three texture per sampler state over the same image (its
 * `texture_filter`, `FLAG_USE_TEXTURE_REPEAT` and `gl_set_filter`/`gl_set_repeat`; mipmaps only when
 * the image has them), uploaded with `flipY` as the geometry's UVs need.
 */
function sampledMap(texture: Texture, filter: number, repeat: boolean, flipY: boolean, srgb: boolean): Texture {
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
 * `FLAG_USE_TEXTURE_REPEAT`), on three's own geometry: three's primitives, an ArrayMesh's data and a
 * script's primitive mesh, whose UVs are three's (the origin at the image's bottom row), so the
 * image is uploaded as three uploads any image (`flipY`). A colour texture (`source_color`, the
 * albedo) is decoded from sRGB; a data texture (roughness) is not.
 *
 * @godot BaseMaterial3D (protocol)
 * @source drivers/gles3/storage/texture_storage.h:255
 */
export function godot_base_material_3d_scene_map(texture: Texture, filter: number, repeat: boolean, srgb = true): Texture {
  return sampledMap(texture, filter, repeat, true, srgb);
}

/**
 * A texture sampled as an imported model's material samples it (the `texture_filter` and
 * `FLAG_USE_TEXTURE_REPEAT` the importer set from the glTF sampler), on the model's own geometry,
 * whose UVs are glTF's (the origin at the image's top row), so the image is uploaded unflipped, as
 * three's GLTFLoader uploads a model's. With `view`, the loader's own view of the image in a model's
 * material (a second UV set, a texture transform) is kept.
 *
 * @godot BaseMaterial3D (protocol)
 * @source modules/gltf/gltf_document.cpp:3056
 */
export function godot_base_material_3d_model_map(texture: Texture, filter: number, repeat: boolean, srgb = true, view?: Texture): Texture {
  const map = sampledMap(texture, filter, repeat, false, srgb);
  // A second UV set or a texture transform is the slot's own: its own view of the same image.
  if (view === undefined || (view.channel === 0 && view.offset.x === 0 && view.offset.y === 0 && view.rotation === 0 && view.repeat.x === 1 && view.repeat.y === 1)) return map;
  const own = map.clone();
  own.source = map.source;
  own.channel = view.channel;
  own.offset.copy(view.offset);
  own.repeat.copy(view.repeat);
  own.rotation = view.rotation;
  own.center.copy(view.center);
  VARIANT_OF.set(own, texture);
  godot_texture_2d_image(own, () => get_image(texture));
  return own;
}

/**
 * The texture resource a material's three map samples (the map itself when it is not a sampled
 * variant).
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.cpp:2523
 */
export function godot_base_material_3d_map_texture(map: Texture): Texture {
  return VARIANT_OF.get(map) ?? map;
}

/** The parameters onto a three material of the class the shading mode selects, for a model's surface or three's geometry. */
function apply(self: BaseMaterial3D, target: Material, model: boolean): void {
  const shaded = target as MeshStandardMaterial;
  if (!((shaded.color as unknown) instanceof ThreeColor)) shaded.color = new ThreeColor();
  shaded.color.setRGB(
    srgbToLinear(self.albedo.r),
    srgbToLinear(self.albedo.g),
    srgbToLinear(self.albedo.b),
    LinearSRGBColorSpace,
  );
  // `Transparency` (`material.h:198`): alpha and depth pre-pass are three's `transparent`, scissor
  // its `alphaTest` at the default threshold, hash its `alphaHash`.
  // Proximity fade reads the scene's depth, which draws the material in the alpha pass, its albedo's
  // alpha applied (`material.cpp:1807`).
  // Distance fade: pixel alpha draws in the alpha pass; the dithers are three's hashed alpha.
  const proximity = extraOf(self).proximity_fade_enabled;
  const fade = extraOf(self).distance_fade;
  target.transparent = self.transparency === TRANSPARENCY_ALPHA || self.transparency === TRANSPARENCY_DEPTH_PRE_PASS || proximity || fade === DISTANCE_FADE_PIXEL_ALPHA;
  target.alphaTest = self.transparency === TRANSPARENCY_ALPHA_SCISSOR ? 0.5 : 0;
  target.alphaHash = self.transparency === TRANSPARENCY_ALPHA_HASH || fade === DISTANCE_FADE_PIXEL_DITHER || fade === DISTANCE_FADE_OBJECT_DITHER;
  target.opacity = self.transparency !== 0 || proximity || fade === DISTANCE_FADE_PIXEL_ALPHA ? self.albedo.a : 1;
  target.blending = blending(self.blend_mode);
  applyExtra(self, target);
  const albedo = self.textures[TEXTURE_ALBEDO] ?? null;
  (target as MeshStandardMaterial).map =
    albedo === null
      ? null
      : (model ? godot_base_material_3d_model_map : godot_base_material_3d_scene_map)(albedo, self.texture_filter, self.flags[FLAG_USE_TEXTURE_REPEAT] === true);
  if (target instanceof MeshStandardMaterial) {
    target.metalness = self.metallic;
    target.roughness = self.roughness;
  }
  if (target instanceof MeshStandardMaterial || target instanceof MeshToonMaterial) {
    if (!((target.emissive as unknown) instanceof ThreeColor)) target.emissive = new ThreeColor();
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
    const extra = extraOf(self);
    // Three's reflectivity is Godot's specular amount; specular disabled reflects no light.
    target.reflectivity = extra.specular;
    target.specularIntensity = extra.specular_mode === SPECULAR_DISABLED ? 0 : 1;
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
 * its setters drawing onto that same three material. `model` when the scene draws it on an
 * imported model's surface (`godot_base_material_3d_on_model`).
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.cpp:3908
 */
export function godot_base_material_3d_of(target: Material, model = false): BaseMaterial3D {
  const existing = OF_THREE.get(target);
  if (existing !== undefined) return existing;
  const self = godot_base_material_3d_initial();
  const shaded = target as MeshStandardMaterial;
  const srgb = threeColor(shaded.color).clone().convertLinearToSRGB();
  self.transparency = target.alphaHash ? TRANSPARENCY_ALPHA_HASH : target.alphaTest > 0 ? TRANSPARENCY_ALPHA_SCISSOR : target.transparent ? TRANSPARENCY_ALPHA : 0;
  self.albedo = color(f32(srgb.r), f32(srgb.g), f32(srgb.b), self.transparency === 0 ? 1 : f32(target.opacity));
  self.blend_mode = target.blending === AdditiveBlending ? 1 : target.blending === SubtractiveBlending ? 2 : target.blending === MultiplyBlending ? 3 : 0;
  self.shading_mode = target instanceof MeshBasicMaterial || target.type === 'MeshBasicMaterial' ? 0 : 1;
  if (self.shading_mode === 1) {
    if (typeof shaded.metalness === 'number') self.metallic = f32(shaded.metalness);
    if (typeof shaded.roughness === 'number') self.roughness = f32(shaded.roughness);
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
  if (data['dont_receive_shadows'] === true) self.flags[FLAG_DONT_RECEIVE_SHADOWS] = true;
  if (data['uv1_triplanar'] === true) self.flags[FLAG_UV1_USE_TRIPLANAR] = true;
  if (data['uv1_world_triplanar'] === true) self.flags[FLAG_UV1_USE_WORLD_TRIPLANAR] = true;
  if (Array.isArray(data['uv1_scale'])) extra.uv1_scale = vector3(...(data['uv1_scale'] as [number, number, number]));
  if (Array.isArray(data['uv1_offset'])) extra.uv1_offset = vector3(...(data['uv1_offset'] as [number, number, number]));
  if (typeof data['uv1_triplanar_sharpness'] === 'number') extra.uv1_triplanar_sharpness = f32(data['uv1_triplanar_sharpness']);
  if (data['proximity_fade_enabled'] === true) extra.proximity_fade_enabled = true;
  if (typeof data['proximity_fade_distance'] === 'number') extra.proximity_fade_distance = f32(data['proximity_fade_distance']);
  if (typeof data['depth_draw_mode'] === 'number') extra.depth_draw_mode = data['depth_draw_mode'];
  if (typeof data['diffuse_mode'] === 'number') extra.diffuse_mode = data['diffuse_mode'];
  if (target instanceof MeshToonMaterial || target.type === 'MeshToonMaterial') extra.diffuse_mode = DIFFUSE_TOON;
  if (typeof data['specular_mode'] === 'number') extra.specular_mode = data['specular_mode'];
  if (typeof data['grow'] === 'number') {
    extra.grow_enabled = true;
    extra.grow = f32(data['grow']);
  }
  if (typeof data['distance_fade_mode'] === 'number') extra.distance_fade = data['distance_fade_mode'];
  if (typeof data['distance_fade_min'] === 'number') extra.distance_fade_min = f32(data['distance_fade_min']);
  if (typeof data['distance_fade_max'] === 'number') extra.distance_fade_max = f32(data['distance_fade_max']);
  if (Array.isArray(data['rim'])) {
    self.features[FEATURE_RIM] = true;
    extra.rim = f32(data['rim'][0] as number);
    extra.rim_tint = f32(data['rim'][1] as number);
  }
  if (Array.isArray(data['backlight'])) {
    self.features[FEATURE_BACKLIGHT] = true;
    extra.backlight = color(f32(data['backlight'][0] as number), f32(data['backlight'][1] as number), f32(data['backlight'][2] as number), 1);
  }
  if (target instanceof MeshPhysicalMaterial || target.type === 'MeshPhysicalMaterial') {
    const physical = target as MeshPhysicalMaterial;
    if (physical.anisotropy !== 0) {
      self.features[FEATURE_ANISOTROPY] = true;
      self.anisotropy = f32(physical.anisotropyRotation === 0 ? physical.anisotropy : -physical.anisotropy);
    }
    extra.specular = f32(physical.reflectivity);
    if (physical.specularIntensity === 0) extra.specular_mode = SPECULAR_DISABLED;
  }
  (model ? MODEL_MATERIAL : THREE_MATERIAL).set(self, target);
  OF_THREE.set(target, self);
  return self;
}

/** The three material class a material's settings pick (the module's header). */
function threeClassOf(self: BaseMaterial3D): typeof MeshBasicMaterial | typeof MeshToonMaterial | typeof MeshPhysicalMaterial | typeof MeshStandardMaterial {
  if (self.shading_mode === 0) return MeshBasicMaterial;
  const extra = extraOf(self);
  if (extra.diffuse_mode === DIFFUSE_TOON) return MeshToonMaterial;
  if (self.features[FEATURE_ANISOTROPY] === true || extra.specular !== 0.5 || extra.specular_mode === SPECULAR_DISABLED) return MeshPhysicalMaterial;
  return MeshStandardMaterial;
}

/**
 * The three material this material draws as, kept in step with its parameters: on three's own
 * geometry, or with `model` on an imported model's surface, whose UVs put the image the other way
 * up, so there it is a second three material whose textures are the model's
 * (`godot_base_material_3d_model_map`).
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.cpp:3908
 */
export function godot_base_material_3d_three(self: BaseMaterial3D, model = false): Material {
  const held = model ? MODEL_MATERIAL : THREE_MATERIAL;
  let target = held.get(self);
  const Class = threeClassOf(self);
  if (target === undefined || target.constructor !== Class) {
    // The material it replaces is let go of as three's are (a reflections volume material lets go
    // of the probes with it).
    target?.dispose();
    target = new Class();
    held.set(self, target);
  }
  apply(self, target, model);
  return target;
}

function changed(self: BaseMaterial3D): void {
  const target = THREE_MATERIAL.get(self);
  if (target !== undefined) apply(self, target, false);
  const onModel = MODEL_MATERIAL.get(self);
  if (onModel !== undefined) apply(self, onModel, true);
}

/** The geometries an imported model's loader made, whose UVs are glTF's. */
const MODEL_GEOMETRY = new WeakSet<BufferGeometry>();

/**
 * Marks the geometries of a loaded model (`GodotImportedScene`): their UVs are glTF's, so a
 * material drawn on them samples its textures as the model's own images are.
 *
 * @godot BaseMaterial3D (protocol)
 * @source modules/gltf/gltf_document.cpp:3056
 */
export function godot_base_material_3d_model_geometry(geometry: BufferGeometry): void {
  MODEL_GEOMETRY.add(geometry);
}

/**
 * Whether a geometry is an imported model's (`godot_base_material_3d_model_geometry`), so a
 * material drawn on it is its model variant (`godot_base_material_3d_three`).
 *
 * @godot BaseMaterial3D (protocol)
 * @source modules/gltf/gltf_document.cpp:3056
 */
export function godot_base_material_3d_on_model(geometry: BufferGeometry): boolean {
  return MODEL_GEOMETRY.has(geometry);
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
const FLAG_DONT_RECEIVE_SHADOWS = 13;
const FLAG_UV1_USE_TRIPLANAR = 6;
const FLAG_UV1_USE_WORLD_TRIPLANAR = 8;

/** The parameters beyond the shared ones (`material.h`), at their initial values (`material.cpp:3938`). */
interface Extra {
  cull_mode: number;
  billboard_mode: number;
  particles_anim_h_frames: number;
  particles_anim_v_frames: number;
  particles_anim_loop: boolean;
  proximity_fade_enabled: boolean;
  proximity_fade_distance: number;
  depth_draw_mode: number;
  diffuse_mode: number;
  specular_mode: number;
  specular: number;
  rim: number;
  rim_tint: number;
  backlight: Color;
  grow_enabled: boolean;
  grow: number;
  distance_fade: number;
  distance_fade_min: number;
  distance_fade_max: number;
  stencil_flags: number;
  stencil_effect_color: Color;
  stencil_effect_outline_thickness: number;
  uv1_scale: Vector3;
  uv1_offset: Vector3;
  uv1_triplanar_sharpness: number;
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
      depth_draw_mode: 0,
      diffuse_mode: 0,
      specular_mode: 0,
      specular: 0.5,
      rim: 1,
      rim_tint: 0.5,
      backlight: color(0, 0, 0, 1),
      grow_enabled: false,
      grow: 0,
      distance_fade: 0,
      distance_fade_min: 0,
      distance_fade_max: 10,
      stencil_flags: 0,
      stencil_effect_color: color(0, 0, 0, 1),
      stencil_effect_outline_thickness: f32(0.01),
      uv1_scale: vector3(1, 1, 1),
      uv1_offset: vector3(0, 0, 0),
      uv1_triplanar_sharpness: 1,
    };
    EXTRA.set(self, extra);
  }
  return extra;
}

/** `CULL_BACK`, `CULL_FRONT`, `CULL_DISABLED` (`material.h:296`) as three's side drawn. */
const SIDES = [FrontSide, BackSide, DoubleSide] as const;

/**
 * The parameters beyond the shared ones onto the three material: the side the cull mode draws, the
 * depth draw mode as `depthWrite`, and in its `userData` what the draw and a particle system read
 * back (the billboard, vertex colour; `godot_base_material_3d_scene_shader`).
 */
function applyExtra(self: BaseMaterial3D, target: Material): void {
  const extra = extraOf(self);
  target.side = SIDES[extra.cull_mode] ?? FrontSide;
  target.depthWrite = godot_base_material_3d_depth_write(extra.depth_draw_mode, target.transparent);
  Object.assign(target.userData, {
    billboard_mode: extra.billboard_mode,
    billboard_keep_scale: self.flags[FLAG_BILLBOARD_KEEP_SCALE] === true,
    vertex_color_use_as_albedo: self.flags[FLAG_ALBEDO_FROM_VERTEX_COLOR] === true,
    vertex_color_is_srgb: self.flags[FLAG_SRGB_VERTEX_COLOR] === true,
    proximity_fade_enabled: extra.proximity_fade_enabled,
    proximity_fade_distance: extra.proximity_fade_distance,
    distance_fade_mode: extra.distance_fade,
    distance_fade_min: extra.distance_fade_min,
    distance_fade_max: extra.distance_fade_max,
    distance_fade_opaque: self.transparency === 0 && !extra.proximity_fade_enabled,
    uv1_triplanar: self.flags[FLAG_UV1_USE_TRIPLANAR] === true,
    uv1_world_triplanar: self.flags[FLAG_UV1_USE_WORLD_TRIPLANAR] === true,
    uv1_scale: [extra.uv1_scale.x, extra.uv1_scale.y, extra.uv1_scale.z],
    uv1_offset: [extra.uv1_offset.x, extra.uv1_offset.y, extra.uv1_offset.z],
    uv1_triplanar_sharpness: extra.uv1_triplanar_sharpness,
  });
  godot_base_material_3d_scene_shader(target);
}

/** `BaseMaterial3D::Transparency` (`material.h:198`). */
const TRANSPARENCY_ALPHA = 1;
const TRANSPARENCY_ALPHA_SCISSOR = 2;
const TRANSPARENCY_ALPHA_HASH = 3;
const TRANSPARENCY_DEPTH_PRE_PASS = 4;
/** `BaseMaterial3D::DistanceFadeMode` (`material.h:322`). */
const DISTANCE_FADE_PIXEL_ALPHA = 1;
const DISTANCE_FADE_PIXEL_DITHER = 2;
const DISTANCE_FADE_OBJECT_DITHER = 3;
/** `BaseMaterial3D::DepthDrawMode` (`material.h:235`), `DiffuseMode` (`:244`), `SpecularMode` (`:252`) values read here. */
const DEPTH_DRAW_ALWAYS = 1;
const DEPTH_DRAW_DISABLED = 2;
const DIFFUSE_TOON = 3;
const SPECULAR_DISABLED = 2;

/**
 * The depth draw mode as three's `depthWrite`: `ALWAYS` writes depth, `DISABLED` never does, and
 * `OPAQUE_ONLY` (the default) is three's usual pairing, a transparent material writing none.
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.h:235
 */
export function godot_base_material_3d_depth_write(mode: number, transparent: boolean): boolean {
  if (mode === DEPTH_DRAW_ALWAYS) return true;
  if (mode === DEPTH_DRAW_DISABLED) return false;
  return !transparent;
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

/** What the scene draw varies for one material, read from its `userData`. */
interface SceneShading {
  readonly billboard: number;
  readonly keepScale: boolean;
  readonly coloured: boolean;
  readonly proximity: boolean;
  /** `DistanceFadeMode`, and whether a dither's material is otherwise opaque; undefined when disabled. */
  readonly fade: readonly [mode: number, opaque: boolean] | undefined;
  /** UV1 triplanar mapping: world or local, the scale, offset and blend sharpness; undefined when off. */
  readonly triplanar: { readonly world: boolean; readonly scale: readonly number[]; readonly offset: readonly number[]; readonly sharpness: number } | undefined;
}

function shadingOf(data: Readonly<Record<string, unknown>>): SceneShading {
  const mode = typeof data['distance_fade_mode'] === 'number' ? data['distance_fade_mode'] : 0;
  return {
    billboard: typeof data['billboard_mode'] === 'number' ? data['billboard_mode'] : 0,
    keepScale: data['billboard_keep_scale'] === true,
    coloured: data['vertex_color_use_as_albedo'] === true,
    proximity: data['proximity_fade_enabled'] === true,
    fade: mode === 0 ? undefined : [mode, data['distance_fade_opaque'] === true],
    triplanar:
      data['uv1_triplanar'] === true
        ? {
            world: data['uv1_world_triplanar'] === true,
            scale: Array.isArray(data['uv1_scale']) ? (data['uv1_scale'] as number[]) : [1, 1, 1],
            offset: Array.isArray(data['uv1_offset']) ? (data['uv1_offset'] as number[]) : [0, 0, 0],
            sharpness: typeof data['uv1_triplanar_sharpness'] === 'number' ? data['uv1_triplanar_sharpness'] : 1,
          }
        : undefined,
  };
}

/** The scene's depth one renderer drew last, for the soft materials drawn after it. */
interface SceneDepth {
  readonly target: WebGLRenderTarget;
  readonly material: MeshDepthMaterial;
  frame: number;
  camera: Camera | null;
  drawing: boolean;
}

/**
 * One depth target per renderer. It lives as long as the renderer does: the entry goes when the
 * renderer is collected, and its GPU memory with the renderer's context.
 */
const SCENE_DEPTH = new WeakMap<WebGLRenderer, SceneDepth>();
const depthSize = new Vector2();

/**
 * Whether a drawn material writes depth in the depth pass: what three draws into depth, an opaque
 * material that writes depth. A transparent one, a soft one among them, never does. Godot's depth
 * copy also holds a depth-pre-pass surface, which here is transparent and so left out: smoke through
 * such foliage is not softened against it.
 */
function writesDepth(object: Object3D, group: unknown): boolean {
  const own = (object as Object3D & { readonly material?: Material | Material[] }).material;
  // A multi-material mesh draws each geometry group (`{ start, count, materialIndex }`) with its material.
  const material = Array.isArray(own) ? own[(group as { readonly materialIndex?: number } | null)?.materialIndex ?? 0] : own;
  return material instanceof Material && material.visible && material.depthWrite && !material.transparent;
}

/**
 * The scene's depth as `camera` sees it, for soft particles as three.js draws them: a depth-only
 * pass (`scene.overrideMaterial` a `MeshDepthMaterial` writing no colour) into a `DepthTexture`, once
 * per frame, when the first soft material is about to draw, from that material's `onBeforeRender`
 * as three's `Reflector` and `Refractor` draw their views (the target cleared with depth writes
 * on, shadows and XR held, the render target, cube face and mip level restored). Each drawn object
 * writes depth only where three draws depth: an opaque material that writes depth, never a
 * transparent or a soft one. The depth material draws front faces of the mesh as posed: a
 * double-sided or back-faced mesh seen from behind, an alpha-scissor cutout's cut-away part and a
 * billboard's camera-facing turn are not what it writes, so smoke beside them fades against the
 * mesh as posed. Null while the pass is drawing, so a soft material
 * never samples the texture being written.
 */
function sceneDepth(renderer: WebGLRenderer, scene: Scene, camera: Camera): DepthTexture | null {
  let depth = SCENE_DEPTH.get(renderer);
  if (depth === undefined) {
    const material = new MeshDepthMaterial();
    material.colorWrite = false;
    material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object, group) => {
      material.depthWrite = writesDepth(object, group);
    };
    const texture = new DepthTexture(1, 1, UnsignedIntType);
    depth = { target: new WebGLRenderTarget(1, 1, { depthTexture: texture, depthBuffer: true }), material, frame: -1, camera: null, drawing: false };
    SCENE_DEPTH.set(renderer, depth);
  }
  if (depth.drawing) return null;
  if (depth.frame !== renderer.info.render.frame || depth.camera !== camera) {
    renderer.getDrawingBufferSize(depthSize);
    if (depth.target.width !== depthSize.x || depth.target.height !== depthSize.y) depth.target.setSize(depthSize.x, depthSize.y);
    const current = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    const shadows = renderer.shadowMap.autoUpdate;
    const xr = renderer.xr.enabled;
    const override = scene.overrideMaterial;
    renderer.shadowMap.autoUpdate = false;
    renderer.xr.enabled = false;
    scene.overrideMaterial = depth.material;
    depth.drawing = true;
    try {
      renderer.setRenderTarget(depth.target);
      // Cleared whatever `autoClear` says, with depth writes and tests on first: a transparent draw
      // earlier in the frame can leave the depth mask off, and `clear` clears depth only through it
      // (three's own clear turns it on the same way, WebGLBackground).
      renderer.state.buffers.depth.setTest(true);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, camera);
    } finally {
      depth.drawing = false;
      scene.overrideMaterial = override;
      renderer.setRenderTarget(current, face, level);
      renderer.shadowMap.autoUpdate = shadows;
      renderer.xr.enabled = xr;
    }
    depth.frame = renderer.info.render.frame;
    depth.camera = camera;
  }
  return depth.target.depthTexture;
}

/** A soft material's uniforms: the scene's depth, the draw's size, the camera's range, the fade distance. */
interface ProximityUniforms {
  readonly godotProximityDepth: { value: DepthTexture | null };
  readonly godotProximityResolution: { value: Vector2 };
  readonly godotProximityNear: { value: number };
  readonly godotProximityFar: { value: number };
  readonly godotProximityDistance: { value: number };
}

const PROXIMITY = new WeakMap<Material, ProximityUniforms>();

/** Each faded material's distances, which its program reads (`godotFadeMin`, `godotFadeSpan`). */
const FADE = new WeakMap<Material, { readonly godotFadeMin: { value: number }; readonly godotFadeSpan: { value: number } }>();

function fadeOf(target: Material): { readonly godotFadeMin: { value: number }; readonly godotFadeSpan: { value: number } } {
  let uniforms = FADE.get(target);
  if (uniforms === undefined) {
    uniforms = { godotFadeMin: { value: 0 }, godotFadeSpan: { value: 10 } };
    FADE.set(target, uniforms);
  }
  return uniforms;
}

function proximityOf(target: Material): ProximityUniforms {
  let uniforms = PROXIMITY.get(target);
  if (uniforms === undefined) {
    uniforms = {
      godotProximityDepth: { value: null },
      godotProximityResolution: { value: new Vector2(1, 1) },
      godotProximityNear: { value: 0.1 },
      godotProximityFar: { value: 1000 },
      godotProximityDistance: { value: 1 },
    };
    PROXIMITY.set(target, uniforms);
  }
  return uniforms;
}

/** A number as a GLSL float literal. */
function glslNumber(value: number): string {
  const text = String(value);
  return /[.eE]/u.test(text) ? text : `${text}.0`;
}

/** The scene draw's code in the program three compiles for a material (see below). */
function sceneShade(shader: Parameters<Material['onBeforeCompile']>[0], { billboard: mode, keepScale, coloured, proximity, fade, triplanar }: SceneShading, target: Material): void {
  let vertex = shader.vertexShader;
  let fragment = shader.fragmentShader;
  if (triplanar !== undefined) {
    // `uv1_power_normal` and `uv1_triplanar_pos` (`material.cpp:1412`), then `triplanar_texture` of
    // the albedo (`:1488`) in place of three's UV sampling of the map.
    const v3 = (values: readonly number[]) => `vec3(${values.map((value) => glslNumber(value)).join(', ')})`;
    const position = triplanar.world ? '(modelMatrix * vec4(transformed, 1.0)).xyz' : 'transformed';
    const normal = triplanar.world ? 'normalize(mat3(modelMatrix) * objectNormal)' : 'objectNormal';
    vertex = `varying vec3 vGodotTriplanarPos;\nvarying vec3 vGodotTriplanarWeight;\n${vertex.replace(
      '#include <project_vertex>',
      `vGodotTriplanarWeight = pow(abs(${normal}), vec3(${glslNumber(triplanar.sharpness)}));\nvGodotTriplanarWeight /= dot(vGodotTriplanarWeight, vec3(1.0));\nvGodotTriplanarPos = (${position} * ${v3(triplanar.scale)} + ${v3(triplanar.offset)}) * vec3(1.0, -1.0, 1.0);\n#include <project_vertex>`,
    )}`;
    fragment = `varying vec3 vGodotTriplanarPos;\nvarying vec3 vGodotTriplanarWeight;\n${fragment.replace(
      '#include <map_fragment>',
      '#ifdef USE_MAP\n\tdiffuseColor *= texture2D( map, vGodotTriplanarPos.xy ) * vGodotTriplanarWeight.z + texture2D( map, vGodotTriplanarPos.xz ) * vGodotTriplanarWeight.y + texture2D( map, vGodotTriplanarPos.zy * vec2( -1.0, 1.0 ) ) * vGodotTriplanarWeight.x;\n#endif',
    )}`;
  }
  if (mode !== 0) vertex = `attribute vec4 godotInstanceCustom;\n${vertex.replace('#include <project_vertex>', billboardChunk(mode, keepScale))}`;
  if (coloured) {
    vertex = `attribute vec4 godotInstanceColor;\nvarying vec4 vGodotColor;\n${vertex.replace('#include <color_vertex>', '#include <color_vertex>\nvGodotColor = vec4( 1.0 );\n#ifdef USE_INSTANCING\n\tvGodotColor = godotInstanceColor;\n#endif')}`;
    fragment = `varying vec4 vGodotColor;\n${fragment.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor *= vec4( vGodotColor.rgb * ( vGodotColor.rgb * ( vGodotColor.rgb * 0.305306011 + 0.682171111 ) + 0.012522878 ), vGodotColor.a );',
    )}`;
  }
  if (proximity) {
    // Soft particles as three.js writes them: the scene's view depth under this fragment
    // (`perspectiveDepthToViewZ`, or `orthographicDepthToViewZ` for an orthographic camera, from
    // three's `packing` chunk) against the fragment's own, faded over the distance.
    Object.assign(shader.uniforms, proximityOf(target));
    vertex = `varying float vGodotViewZ;\n${vertex.replace('#include <fog_vertex>', 'vGodotViewZ = mvPosition.z;\n#include <fog_vertex>')}`;
    const declarations = [
      ...(fragment.includes('#include <packing>') ? [] : ['#include <packing>']),
      'uniform sampler2D godotProximityDepth;',
      'uniform vec2 godotProximityResolution;',
      'uniform float godotProximityNear;',
      'uniform float godotProximityFar;',
      'uniform float godotProximityDistance;',
      'varying float vGodotViewZ;',
    ];
    fragment = `${declarations.join('\n')}\n${fragment.replace(
      '#include <alphatest_fragment>',
      [
        'float godotSceneDepth = texture2D( godotProximityDepth, gl_FragCoord.xy / godotProximityResolution ).x;',
        'float godotSceneZ = isOrthographic ? orthographicDepthToViewZ( godotSceneDepth, godotProximityNear, godotProximityFar ) : perspectiveDepthToViewZ( godotSceneDepth, godotProximityNear, godotProximityFar );',
        'diffuseColor.a *= smoothstep( 0.0, 1.0, ( vGodotViewZ - godotSceneZ ) / godotProximityDistance );',
        '#include <alphatest_fragment>',
      ].join('\n'),
    )}`;
  }
  if (fade !== undefined) {
    // Distance fade over the view distance (`material.cpp:1834`): the fragment's own for the pixel
    // modes, the object's origin for object dither (a multimesh instance fades by its mesh's
    // origin). Pixel alpha fades the alpha; a dither of an otherwise opaque material is the fade
    // alone, which three's hashed alpha then dithers, the material's own alpha ignored as Godot's
    // dither ignores it. A dither beside a transparency mode fades that alpha (Godot discards by the
    // fade alone and blends the unfaded alpha).
    const [fadeMode, opaque] = fade;
    Object.assign(shader.uniforms, fadeOf(target));
    const origin = fadeMode === 3 ? '( modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz' : 'mvPosition.xyz';
    vertex = `varying vec3 vGodotFadeView;\n${vertex.replace('#include <fog_vertex>', `vGodotFadeView = ${origin};\n#include <fog_vertex>`)}`;
    fragment = `uniform float godotFadeMin;\nuniform float godotFadeSpan;\nvarying vec3 vGodotFadeView;\n${fragment.replace(
      '#include <alphatest_fragment>',
      [
        'float godotFade = clamp( ( length( vGodotFadeView ) - godotFadeMin ) / godotFadeSpan, 0.0, 1.0 );',
        'godotFade = godotFade * godotFade * ( 3.0 - 2.0 * godotFade );',
        fadeMode !== 1 && opaque ? 'diffuseColor.a = godotFade;' : 'diffuseColor.a *= godotFade;',
        '#include <alphatest_fragment>',
      ].join('\n'),
    )}`;
  }
  shader.vertexShader = vertex;
  shader.fragmentShader = fragment;
}

/** The scene draw each material's program was last asked for (its cache key's part), once its hook is on. */
const SCENE_SHADED = new WeakMap<Material, string>();

/**
 * The material drawn where three's own material does not draw what the scene needs of it:
 * - its billboard: three's `project_vertex` replaced by the billboard mode's model-view matrix
 *   (`material.cpp:1231`);
 * - vertex colour: an instanced draw's `godotInstanceColor` (a particle's `COLOR`) multiplying the
 *   albedo and its alpha where the material takes vertex colour as albedo (`albedo_tex *= COLOR`,
 *   `material.cpp:1643`), converted to linear as three's colours are. Particle animation frames
 *   other than one by one are not drawn;
 * - proximity fade: soft particles. The alpha fades to nothing where the fragment comes within the
 *   fade distance of the scene behind it (`material.cpp:1827`), read from a depth texture of the
 *   scene drawn once per frame from the material's `onBeforeRender` (`sceneDepth`), as three's
 *   `Reflector` draws its view.
 * The material's own program, never three's shared chunks. The hook goes on once, over whatever
 * the material already compiles with, and reads the draw from the material's `userData` when three
 * compiles it; over a reflections volume material it wraps the material's own hook, which splices
 * the probe lighting when this one calls it, so each keeps the other; a change of the draw only
 * recompiles. A material that never needs it keeps three's own program. Returns the material.
 *
 * @godot BaseMaterial3D (protocol)
 * @source scene/resources/material.cpp:1231
 */
export function godot_base_material_3d_scene_shader<M extends Material>(target: M): M {
  const shading = shadingOf(target.userData as Readonly<Record<string, unknown>>);
  const key = `godot-scene:${JSON.stringify(shading)}`;
  const shaded = SCENE_SHADED.get(target);
  if (shaded === key) return target;
  if (shaded === undefined) {
    if (shading.billboard === 0 && !shading.coloured && !shading.proximity && shading.fade === undefined && shading.triplanar === undefined) return target;
    const ownCompile = target.onBeforeCompile;
    const ownKey = target.customProgramCacheKey;
    const ownRender = target.onBeforeRender;
    const read = (): SceneShading => shadingOf(target.userData as Readonly<Record<string, unknown>>);
    target.onBeforeCompile = (shader, renderer) => {
      ownCompile.call(target, shader, renderer);
      sceneShade(shader, read(), target);
    };
    target.customProgramCacheKey = () => `${ownKey.call(target)}|godot-scene:${JSON.stringify(read())}`;
    target.onBeforeRender = (renderer, scene, camera, geometry, object, group) => {
      ownRender.call(target, renderer, scene, camera, geometry, object, group);
      const data = target.userData as Readonly<Record<string, unknown>>;
      if (typeof data['distance_fade_mode'] === 'number' && data['distance_fade_mode'] !== 0) {
        const min = typeof data['distance_fade_min'] === 'number' ? data['distance_fade_min'] : 0;
        const max = typeof data['distance_fade_max'] === 'number' ? data['distance_fade_max'] : 10;
        const uniforms = fadeOf(target);
        uniforms.godotFadeMin.value = min;
        uniforms.godotFadeSpan.value = Math.abs(max - min) < 1e-6 ? 1e-6 : max - min;
      }
      if (data['proximity_fade_enabled'] !== true) return;
      const uniforms = proximityOf(target);
      uniforms.godotProximityDepth.value = sceneDepth(renderer, scene, camera);
      const drawing = renderer.getRenderTarget();
      if (drawing === null) renderer.getDrawingBufferSize(uniforms.godotProximityResolution.value);
      else uniforms.godotProximityResolution.value.set(drawing.width, drawing.height);
      const lens = camera as Camera & { readonly near?: number; readonly far?: number };
      uniforms.godotProximityNear.value = lens.near ?? 0.1;
      uniforms.godotProximityFar.value = lens.far ?? 1000;
      uniforms.godotProximityDistance.value = typeof data['proximity_fade_distance'] === 'number' ? data['proximity_fade_distance'] : 1;
    };
  }
  SCENE_SHADED.set(target, key);
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

// --- Depth draw, the shading modes, specular amount, rim, backlight, grow and distance fade: stored
// where three has no idiom (the module's header).

/**
 * @godot BaseMaterial3D.set_depth_draw_mode
 * @source scene/resources/material.cpp:2394
 */
export function set_depth_draw_mode(self: BaseMaterial3D, mode: number): void {
  extraOf(self).depth_draw_mode = mode;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_depth_draw_mode
 * @source scene/resources/material.cpp:2403
 */
export function get_depth_draw_mode(self: BaseMaterial3D): number {
  return extraOf(self).depth_draw_mode;
}

/**
 * @godot BaseMaterial3D.set_diffuse_mode
 * @source scene/resources/material.cpp:2433
 */
export function set_diffuse_mode(self: BaseMaterial3D, mode: number): void {
  extraOf(self).diffuse_mode = mode;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_diffuse_mode
 * @source scene/resources/material.cpp:2442
 */
export function get_diffuse_mode(self: BaseMaterial3D): number {
  return extraOf(self).diffuse_mode;
}

/**
 * @godot BaseMaterial3D.set_specular_mode
 * @source scene/resources/material.cpp:2446
 */
export function set_specular_mode(self: BaseMaterial3D, mode: number): void {
  extraOf(self).specular_mode = mode;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_specular_mode
 * @source scene/resources/material.cpp:2455
 */
export function get_specular_mode(self: BaseMaterial3D): number {
  return extraOf(self).specular_mode;
}

/**
 * @godot BaseMaterial3D.set_specular
 * @source scene/resources/material.cpp:2131
 */
export function set_specular(self: BaseMaterial3D, specular: number): void {
  extraOf(self).specular = f32(specular);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_specular
 * @source scene/resources/material.cpp:2136
 */
export function get_specular(self: BaseMaterial3D): number {
  return extraOf(self).specular;
}

/**
 * @godot BaseMaterial3D.set_uv1_scale
 * @source scene/resources/material.cpp:2758
 */
export function set_uv1_scale(self: BaseMaterial3D, scale: Vector3): void {
  extraOf(self).uv1_scale = vector3(scale.x, scale.y, scale.z);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_uv1_scale
 * @source scene/resources/material.cpp:2763
 */
export function get_uv1_scale(self: BaseMaterial3D): Vector3 {
  return extraOf(self).uv1_scale;
}

/**
 * @godot BaseMaterial3D.set_uv1_offset
 * @source scene/resources/material.cpp:2767
 */
export function set_uv1_offset(self: BaseMaterial3D, offset: Vector3): void {
  extraOf(self).uv1_offset = vector3(offset.x, offset.y, offset.z);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_uv1_offset
 * @source scene/resources/material.cpp:2772
 */
export function get_uv1_offset(self: BaseMaterial3D): Vector3 {
  return extraOf(self).uv1_offset;
}

/**
 * @godot BaseMaterial3D.set_uv1_triplanar_blend_sharpness
 * @source scene/resources/material.cpp:2776
 */
export function set_uv1_triplanar_blend_sharpness(self: BaseMaterial3D, sharpness: number): void {
  extraOf(self).uv1_triplanar_sharpness = f32(sharpness);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_uv1_triplanar_blend_sharpness
 * @source scene/resources/material.cpp:2782
 */
export function get_uv1_triplanar_blend_sharpness(self: BaseMaterial3D): number {
  return extraOf(self).uv1_triplanar_sharpness;
}

/**
 * @godot BaseMaterial3D.set_rim
 * @source scene/resources/material.cpp:2200
 */
export function set_rim(self: BaseMaterial3D, rim: number): void {
  extraOf(self).rim = f32(rim);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_rim
 * @source scene/resources/material.cpp:2205
 */
export function get_rim(self: BaseMaterial3D): number {
  return extraOf(self).rim;
}

/**
 * @godot BaseMaterial3D.set_rim_tint
 * @source scene/resources/material.cpp:2209
 */
export function set_rim_tint(self: BaseMaterial3D, rim_tint: number): void {
  extraOf(self).rim_tint = f32(rim_tint);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_rim_tint
 * @source scene/resources/material.cpp:2214
 */
export function get_rim_tint(self: BaseMaterial3D): number {
  return extraOf(self).rim_tint;
}

/**
 * @godot BaseMaterial3D.set_backlight
 * @source scene/resources/material.cpp:2299
 */
export function set_backlight(self: BaseMaterial3D, backlight: Color): void {
  extraOf(self).backlight = backlight;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_backlight
 * @source scene/resources/material.cpp:2304
 */
export function get_backlight(self: BaseMaterial3D): Color {
  return extraOf(self).backlight;
}

/**
 * @godot BaseMaterial3D.set_grow_enabled
 * @source scene/resources/material.cpp:2876
 */
export function set_grow_enabled(self: BaseMaterial3D, enable: boolean): void {
  extraOf(self).grow_enabled = enable;
  changed(self);
}

/**
 * @godot BaseMaterial3D.is_grow_enabled
 * @source scene/resources/material.cpp:2882
 */
export function is_grow_enabled(self: BaseMaterial3D): boolean {
  return extraOf(self).grow_enabled;
}

/**
 * @godot BaseMaterial3D.set_grow
 * @source scene/resources/material.cpp:2913
 */
export function set_grow(self: BaseMaterial3D, amount: number): void {
  extraOf(self).grow = f32(amount);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_grow
 * @source scene/resources/material.cpp:2918
 */
export function get_grow(self: BaseMaterial3D): number {
  return extraOf(self).grow;
}

/**
 * @godot BaseMaterial3D.set_distance_fade
 * @source scene/resources/material.cpp:3084
 */
export function set_distance_fade(self: BaseMaterial3D, mode: number): void {
  extraOf(self).distance_fade = mode;
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_distance_fade
 * @source scene/resources/material.cpp:3090
 */
export function get_distance_fade(self: BaseMaterial3D): number {
  return extraOf(self).distance_fade;
}

/**
 * @godot BaseMaterial3D.set_distance_fade_max_distance
 * @source scene/resources/material.cpp:3094
 */
export function set_distance_fade_max_distance(self: BaseMaterial3D, distance: number): void {
  extraOf(self).distance_fade_max = f32(distance);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_distance_fade_max_distance
 * @source scene/resources/material.cpp:3099
 */
export function get_distance_fade_max_distance(self: BaseMaterial3D): number {
  return extraOf(self).distance_fade_max;
}

/**
 * @godot BaseMaterial3D.set_distance_fade_min_distance
 * @source scene/resources/material.cpp:3103
 */
export function set_distance_fade_min_distance(self: BaseMaterial3D, distance: number): void {
  extraOf(self).distance_fade_min = f32(distance);
  changed(self);
}

/**
 * @godot BaseMaterial3D.get_distance_fade_min_distance
 * @source scene/resources/material.cpp:3108
 */
export function get_distance_fade_min_distance(self: BaseMaterial3D): number {
  return extraOf(self).distance_fade_min;
}

// --- The stencil effect, stored: it draws only through `stencil_mode`, which is not bound.

/** `BaseMaterial3D::StencilFlags` (`material.h:338`): read 1, write 2, write on depth fail 4. */
const STENCIL_FLAG_READ = 1;
const STENCIL_FLAG_WRITES = 2 | 4;

/**
 * Reading and writing exclude each other, as the setter enforces them (`material.cpp:3227`).
 *
 * @godot BaseMaterial3D.set_stencil_flags
 * @source scene/resources/material.cpp:3222
 */
export function set_stencil_flags(self: BaseMaterial3D, flags: number): void {
  const extra = extraOf(self);
  let next = flags;
  if (next === extra.stencil_flags) return;
  if ((next & STENCIL_FLAG_READ) !== 0 && (extra.stencil_flags & STENCIL_FLAG_WRITES) !== 0) next &= STENCIL_FLAG_READ;
  if ((next & STENCIL_FLAG_WRITES) !== 0 && (extra.stencil_flags & STENCIL_FLAG_READ) !== 0) next &= STENCIL_FLAG_WRITES;
  if ((next & STENCIL_FLAG_READ) !== 0 && (next & STENCIL_FLAG_WRITES) !== 0) next &= STENCIL_FLAG_READ;
  extra.stencil_flags = next;
}

/**
 * @godot BaseMaterial3D.get_stencil_flags
 * @source scene/resources/material.cpp:3246
 */
export function get_stencil_flags(self: BaseMaterial3D): number {
  return extraOf(self).stencil_flags;
}

/**
 * @godot BaseMaterial3D.set_stencil_effect_color
 * @source scene/resources/material.cpp:3281
 */
export function set_stencil_effect_color(self: BaseMaterial3D, value: Color): void {
  extraOf(self).stencil_effect_color = value;
}

/**
 * @godot BaseMaterial3D.get_stencil_effect_color
 * @source scene/resources/material.cpp:3294
 */
export function get_stencil_effect_color(self: BaseMaterial3D): Color {
  return extraOf(self).stencil_effect_color;
}

/**
 * @godot BaseMaterial3D.set_stencil_effect_outline_thickness
 * @source scene/resources/material.cpp:3298
 */
export function set_stencil_effect_outline_thickness(self: BaseMaterial3D, thickness: number): void {
  extraOf(self).stencil_effect_outline_thickness = f32(thickness);
}

/**
 * @godot BaseMaterial3D.get_stencil_effect_outline_thickness
 * @source scene/resources/material.cpp:3311
 */
export function get_stencil_effect_outline_thickness(self: BaseMaterial3D): number {
  return extraOf(self).stencil_effect_outline_thickness;
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
