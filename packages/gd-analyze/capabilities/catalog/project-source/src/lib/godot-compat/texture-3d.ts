/**
 * The three ways a Godot 3 texture is sampled differently from a bare three texture: the V-AXIS
 * ORIGIN its UVs are measured from, the IMPORTER's sampler flags, and a `SpatialMaterial`'s per-map
 * CHANNEL selector.
 *
 * All three are pure configuration over three's own objects — {@link configureGodotTexture} takes a
 * `THREE.Texture` and hands the same texture back, and {@link godotChannelMaps} hands back the two
 * `Material` properties three already exposes for this. Nothing here wraps three: every later call
 * is three's own API.
 *
 * ## 0. `flipY` — Godot's UV origin, and why it is the DEFAULT here rather than a flag
 *
 * Godot measures V from the image's TOP edge, so a Godot UV of `(u, 0)` is the image's first row.
 * three's `Texture.flipY` defaults to `true`, which mirrors the image during upload so that a UV of
 * `(u, 0)` is the image's LAST row. Feed Godot's own UVs to a three texture on three's default and
 * every one of them samples the vertically mirrored row of the image.
 *
 * That is not a per-texture question a `.import` sidecar answers — Godot NEVER flips, so the answer
 * is the same for every image a Godot project references. So `configureGodotTexture` sets
 * `flipY = false` with no flag to turn it off, and a caller that passes no config at all still gets
 * it. three already ships this exact behaviour for the other top-left-origin format it reads:
 * `GLTFLoader` sets `texture.flipY = false` on every texture it loads, for the same reason.
 *
 * The ONE slot where this does not apply is an EQUIRECTANGULAR panorama, and it does not apply
 * because that slot does not address the image by UV at all — see {@link GodotTextureConfig.sampling}.
 *
 * ## 1. `configureGodotTexture` — the `.import` sidecar's sampler
 *
 * A `.png` in a Godot project is not rendered as loaded. Godot imports it, and the `<file>.import`
 * beside it records the sampler state baked into the `.stex` the game draws. three's defaults are a
 * DIFFERENT sampler — `ClampToEdgeWrapping`, anisotropy 1 — so a texture the project authored as
 * repeating smears its edge texel across every UV outside [0,1], and one that opted into the
 * project's anisotropic level turns to mush at grazing angles.
 *
 * The authored anisotropy is passed straight through and NOT clamped here: three's own
 * `WebGLTextures` uploads `Math.min(texture.anisotropy, capabilities.getMaxAnisotropy())`, so the
 * renderer's real capability is what binds and a second clamp would have no effect.
 *
 * `needsUpdate` is set only when a value actually CHANGES. These textures are shared — one loader
 * cache entry per URL, bound by many materials — and a translated scene reconfigures on every
 * render, so an unconditional `needsUpdate = true` would re-upload the atlas every frame.
 *
 * ## 2. `godotChannelMaps` — which channel a metallic/roughness/AO map is read from
 *
 * Godot SELECTS the channel a metallic/roughness/AO texture is sampled from. Three fixes those
 * reads to B/G/R respectively. The two agree without routing only for an authored ORM image or a
 * greyscale image.
 *
 * The remap is a one-token edit of Three's own map chunks, which is why the NORMAL path uses
 * `onBeforeCompile` rather than reading pixels back to the CPU: exact, and no extra texture upload
 * or startup stall.
 *
 * **`customProgramCacheKey` is not optional here.** three's default cache key is
 * `this.onBeforeCompile.toString()` (`Material.customProgramCacheKey`), and two calls to this
 * factory with DIFFERENT channels produce closures with the SAME source text — so without a key
 * naming the channels, the second material would silently reuse the first's compiled program and
 * read the wrong channel. Both properties are returned together for that reason; apply them as a
 * pair.
 *
 * One returned property object is cached here per distinct channel pair. Generated scene source
 * carries only the authored channel numbers and calls this function inline; repeated calls return
 * the same hook identities, so R3F does not recompile the material on every render.
 */

import type { Texture, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapNearestFilter,
  NoColorSpace,
  RepeatWrapping,
} from 'three';

/** Godot 3's `flags/repeat`, as the three wrapping mode it means. */
export type GodotTextureRepeat = 'clamp' | 'repeat' | 'mirror';

/**
 * One texture's `.import` sampler settings, plus how the consuming slot addresses the image.
 *
 * An absent SAMPLER field leaves three's own default alone. `sampling` is the one field with a
 * meaning of its own when absent, because Godot's V origin is a project-wide fact rather than a
 * per-texture one — see the header.
 */
export interface GodotTextureConfig {
  /**
   * How the consuming SLOT addresses this image, which is what decides `flipY`.
   *
   * `'uv'` (the default) is every material map: the mesh hands the shader Godot's own UVs, whose V
   * runs down from the image's top, so the texture must upload unflipped (`flipY = false`).
   *
   * `'equirect'` is a panorama bound to `Scene.background`/`Scene.environment` with
   * `EquirectangularReflectionMapping`. three does not read the mesh's UVs there — it derives V
   * from the view DIRECTION (`equirectUv`: `v = asin(dir.y)/PI + 0.5`, so `v = 1` is straight up)
   * and samples with `flipY` still applied, which puts the image's FIRST row at the zenith. Godot's
   * `PanoramaSky` derives V the same way and reaches the same place (`st.y = acos(normal.y)/PI`,
   * so V = 0 — its own top row — is straight up). The two conventions already AGREE for this slot,
   * and `flipY = false` would turn the sky upside down, so this value keeps three's `true`.
   */
  readonly sampling?: 'uv' | 'equirect';
  /** `flags/repeat` — applied to both `wrapS` and `wrapT`, which is Godot's own single flag. */
  readonly repeat?: GodotTextureRepeat;
  /** `flags/filter` — `true` in Godot is linear, `false` is nearest. */
  readonly filter?: 'linear' | 'nearest';
  /** `flags/mipmaps` — `generateMipmaps`, and whether `minFilter` uses the mip chain. */
  readonly mipmaps?: boolean;
  /** `flags/anisotropic` × the project's `quality/filters/anisotropic_filter_level`. */
  readonly anisotropy?: number;
}

const WRAP = {
  clamp: ClampToEdgeWrapping,
  repeat: RepeatWrapping,
  mirror: MirroredRepeatWrapping,
} as const;

/**
 * `minFilter` is the one place Godot's two flags MEET — its filter flag chooses linear vs nearest
 * and its mipmaps flag chooses whether the mip chain is sampled at all — and three spells the four
 * combinations as four constants. Written as a table because the nested conditional form of the
 * same fact reads as a puzzle. (`magFilter` has no mip half; it is the `filter` axis alone.)
 */
const MIN_FILTER = {
  'linear/mips': LinearMipmapLinearFilter,
  'linear/no-mips': LinearFilter,
  'nearest/mips': NearestMipmapNearestFilter,
  'nearest/no-mips': NearestFilter,
} as const;

/**
 * Apply Godot's V origin — and one texture import's sampler state, when the sidecar authored any —
 * to a loaded texture, and hand the SAME texture back so the call site keeps programming against
 * three.
 *
 * The config is OPTIONAL because the V origin is not optional: a texture whose `.import` authored
 * nothing three's defaults do not already do still has to come through this door, or its Godot UVs
 * sample the mirrored image.
 */
export function configureGodotTexture<T extends Texture>(
  texture: T,
  config: GodotTextureConfig = {},
): T {
  const target: Texture = texture;
  let changed = false;
  const set = <K extends keyof Texture>(key: K, value: Texture[K]): void => {
    if (target[key] === value) return;
    target[key] = value;
    changed = true;
  };

  // Both branches are stated rather than one leaning on three's default: these textures are SHARED
  // (one loader cache entry per URL), so a value left unwritten here would be whatever the previous
  // consumer of the same image happened to leave behind.
  set('flipY', config.sampling === 'equirect');

  if (config.repeat !== undefined) {
    set('wrapS', WRAP[config.repeat]);
    set('wrapT', WRAP[config.repeat]);
  }

  if (config.filter !== undefined || config.mipmaps !== undefined) {
    // An unstated axis takes three's own default, which is linear and mipmapped — the same value
    // `set` would then find already in place and skip.
    const filter = config.filter ?? 'linear';
    const mips = config.mipmaps === false ? 'no-mips' : 'mips';
    if (config.filter !== undefined) {
      set('magFilter', filter === 'linear' ? LinearFilter : NearestFilter);
    }
    set('minFilter', MIN_FILTER[`${filter}/${mips}`]);
  }
  if (config.mipmaps !== undefined) set('generateMipmaps', config.mipmaps);
  if (config.anisotropy !== undefined) set('anisotropy', config.anisotropy);

  if (changed) target.needsUpdate = true;
  return texture;
}

/** Godot's `BaseMaterial3D::TextureChannel` — the channel a map's value is read from. */
export const GODOT_TEXTURE_CHANNEL = {
  red: 0,
  green: 1,
  blue: 2,
  alpha: 3,
  grayscale: 4,
} as const;

/** One of {@link GODOT_TEXTURE_CHANNEL}'s values. Grayscale is an exact one-third RGB dot product. */
export type GodotTextureChannel = 0 | 1 | 2 | 3 | 4;

const SWIZZLE: Readonly<Record<Exclude<GodotTextureChannel, 4>, string>> = {
  0: 'r',
  1: 'g',
  2: 'b',
  3: 'a',
};

const MATERIAL_TEXTURES = new WeakMap<Texture, Map<string, Texture>>();

export interface GodotMaterialTextureConfig {
  /** 0 is UV1, 1 is UV2; Three's `Texture.channel` selects the matching geometry attribute. */
  readonly uvSet?: 0 | 1;
  readonly offset?: readonly [number, number];
  readonly scale?: readonly [number, number];
  /** Godot 4 BaseMaterial3D.TextureFilter (0..5). */
  readonly filter?: 0 | 1 | 2 | 3 | 4 | 5;
  readonly repeat?: boolean;
  /** Project-owned anisotropic sample count for Godot's two anisotropic filter modes. */
  readonly anisotropy?: number;
  /** Numeric PBR/normal data must bypass sRGB decoding even when the same image is an albedo map. */
  readonly data?: boolean;
}

/**
 * Clone a real Three texture only when one material needs slot-local UV/sampler state.
 *
 * Godot stores these values on BaseMaterial3D, while Three stores them on Texture. Reusing the
 * loader's shared texture would let the last material mutate every earlier material, so the clone
 * is the native ownership boundary. Image/source storage remains shared by Three's own clone.
 */
export function godotMaterialTexture(
  source: Texture,
  config: GodotMaterialTextureConfig = {},
): Texture {
  const uvSet = config.uvSet ?? 0;
  const offset = config.offset ?? [0, 0];
  const scale = config.scale ?? [1, 1];
  const filter = config.filter;
  const repeat = config.repeat;
  const anisotropy = config.anisotropy;
  const data = config.data === true;
  if (uvSet !== 0 && uvSet !== 1) throw new Error(`Godot material UV set ${uvSet} is unsupported`);
  if (
    ![...offset, ...scale].every(Number.isFinite) ||
    (filter !== undefined && (!Number.isInteger(filter) || filter < 0 || filter > 5)) ||
    (anisotropy !== undefined && (!Number.isFinite(anisotropy) || anisotropy < 1))
  ) {
    throw new Error('Godot material texture transform/filter contains an invalid value');
  }
  const key = `${uvSet}:${offset.join(',')}:${scale.join(',')}:${String(filter)}:${String(repeat)}:${String(anisotropy)}:${String(data)}`;
  let cache = MATERIAL_TEXTURES.get(source);
  if (cache === undefined) {
    cache = new Map();
    MATERIAL_TEXTURES.set(source, cache);
  }
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const texture = source.clone();
  texture.channel = uvSet;
  texture.offset.set(offset[0], offset[1]);
  texture.repeat.set(scale[0], scale[1]);
  if (repeat !== undefined) {
    texture.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
    texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  }
  if (filter !== undefined) {
    const linear = filter === 1 || filter === 3 || filter === 5;
    const mipmaps = filter >= 2;
    texture.magFilter = linear ? LinearFilter : NearestFilter;
    texture.minFilter = MIN_FILTER[`${linear ? 'linear' : 'nearest'}/${mipmaps ? 'mips' : 'no-mips'}`];
    texture.generateMipmaps = mipmaps;
  }
  if (anisotropy !== undefined) texture.anisotropy = anisotropy;
  if (data) texture.colorSpace = NoColorSpace;
  texture.needsUpdate = true;
  cache.set(key, texture);
  const release = (): void => {
    for (const owned of cache?.values() ?? []) owned.dispose();
    cache?.clear();
    MATERIAL_TEXTURES.delete(source);
    source.removeEventListener('dispose', release);
  };
  if (cache.size === 1) source.addEventListener('dispose', release);
  return texture;
}

/** three's own default channel for each map, as spelled in its shader chunks. */
const THREE_METALNESS_READ = 'texelMetalness.b';
const THREE_ROUGHNESS_READ = 'texelRoughness.g';
const THREE_AO_READ = 'texture2D( aoMap, vAoMapUv ).r';

function shaderChannel(texel: string, channel: GodotTextureChannel): string {
  return channel === 4
    ? `dot(${texel}.rgb, vec3(0.3333333333333333))`
    : `${texel}.${SWIZZLE[channel]}`;
}

function replaceShaderRead(
  fragment: string,
  source: string,
  replacement: string,
  slot: string,
): string {
  if (!fragment.includes(source)) {
    throw new Error(
      `Godot ${slot} channel routing cannot find Three's pinned native shader read \`${source}\``,
    );
  }
  return fragment.replace(source, replacement);
}

/** The two `Material` properties {@link godotChannelMaps} produces. Apply them as a PAIR — see the
 *  header on why the cache key is not optional. */
export interface GodotChannelMapProperties {
  readonly onBeforeCompile: (
    parameters: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer,
  ) => void;
  readonly customProgramCacheKey: () => string;
}

const CHANNEL_MAP_PROPERTIES = new Map<string, GodotChannelMapProperties>();

/**
 * Read a `MeshStandardMaterial`'s metalness/roughness/AO maps from the channels Godot authored
 * instead of Three's fixed blue/green/red.
 *
 * An absent channel leaves that map on three's own default, so a material that carries only one of
 * the two maps names only that one.
 */
export function godotChannelMaps(channels: {
  readonly metalness?: GodotTextureChannel;
  readonly roughness?: GodotTextureChannel;
  readonly ao?: GodotTextureChannel;
}): GodotChannelMapProperties {
  for (const [slot, channel] of Object.entries(channels)) {
    if (channel === undefined) continue;
    if (!Number.isInteger(channel) || channel < 0 || channel > 4) {
      throw new Error(`Godot ${slot} texture channel ${String(channel)} is outside 0..4`);
    }
  }
  const key =
    `godot-channels:${String(channels.metalness ?? '-')}:` +
    `${String(channels.roughness ?? '-')}:${String(channels.ao ?? '-')}`;
  const existing = CHANNEL_MAP_PROPERTIES.get(key);
  if (existing !== undefined) return existing;
  const properties: GodotChannelMapProperties = {
    onBeforeCompile: (parameters) => {
      let fragment = parameters.fragmentShader;
      if (channels.metalness !== undefined) {
        fragment = replaceShaderRead(
          fragment,
          THREE_METALNESS_READ,
          shaderChannel('texelMetalness', channels.metalness),
          'metalness',
        );
      }
      if (channels.roughness !== undefined) {
        fragment = replaceShaderRead(
          fragment,
          THREE_ROUGHNESS_READ,
          shaderChannel('texelRoughness', channels.roughness),
          'roughness',
        );
      }
      if (channels.ao !== undefined) {
        fragment = replaceShaderRead(
          fragment,
          THREE_AO_READ,
          shaderChannel('texture2D( aoMap, vAoMapUv )', channels.ao),
          'AO',
        );
      }
      parameters.fragmentShader = fragment;
    },
    customProgramCacheKey: () => key,
  };
  CHANNEL_MAP_PROPERTIES.set(key, properties);
  return properties;
}

export interface GodotTriplanarMaterialConfig {
  readonly world: boolean;
  readonly scale: readonly [number, number, number];
  readonly offset: readonly [number, number, number];
  readonly sharpness: number;
  readonly channels?: {
    readonly metalness?: GodotTextureChannel;
    readonly roughness?: GodotTextureChannel;
    readonly ao?: GodotTextureChannel;
  };
}

const TRIPLANAR_PROPERTIES = new Map<string, GodotChannelMapProperties>();

function glslFloat(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Godot triplanar material requires finite shader parameters.');
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

function requireShaderSource(source: string, needle: string, replacement: string, stage: string): string {
  if (!source.includes(needle)) throw new Error(`Godot triplanar material cannot find Three r180 ${stage} seam ${JSON.stringify(needle)}.`);
  return source.replace(needle, replacement);
}

/**
 * Replace native Three map UV reads with Godot BaseMaterial3D's exact three-axis projection.
 * The returned values are Three's own `onBeforeCompile`/program-key seam; textures and material
 * identities remain the renderer's native objects.
 */
export function godotTriplanarMaterial(config: GodotTriplanarMaterialConfig): GodotChannelMapProperties {
  if (typeof config.world !== 'boolean' || ![...config.scale, ...config.offset].every(Number.isFinite)) {
    throw new Error('Godot triplanar material requires bool world mode and finite Vector3 scale/offset.');
  }
  if (!Number.isFinite(config.sharpness) || config.sharpness < 0 || config.sharpness > 150) {
    throw new Error('Godot triplanar sharpness must be finite and within Godot\'s clamped 0..150 range.');
  }
  const channels: NonNullable<GodotTriplanarMaterialConfig['channels']> = config.channels ?? {};
  for (const [slot, channel] of Object.entries(channels)) {
    if (channel !== undefined && (!Number.isInteger(channel) || channel < 0 || channel > 4)) {
      throw new Error(`Godot ${slot} texture channel ${String(channel)} is outside 0..4`);
    }
  }
  const key = `godot-triplanar:${String(config.world)}:${config.scale.join(',')}:${config.offset.join(',')}:${String(config.sharpness)}:${String(channels.metalness ?? '-')}:${String(channels.roughness ?? '-')}:${String(channels.ao ?? '-')}`;
  const retained = TRIPLANAR_PROPERTIES.get(key);
  if (retained !== undefined) return retained;
  const scale = `vec3(${config.scale.map(glslFloat).join(', ')})`;
  const offset = `vec3(${config.offset.map(glslFloat).join(', ')})`;
  const sharpness = glslFloat(config.sharpness);
  const declarations = `#include <common>
varying vec3 vGodotTriplanarPosition;
varying vec3 vGodotTriplanarWeights;
varying vec3 vGodotTriplanarTangent;
varying vec3 vGodotTriplanarBinormal;`;
  const vertexProjection = `${config.world ? `
vec4 godotTriplanarVertex = vec4( transformed, 1.0 );
vec3 godotTriplanarNormal = objectNormal;
#ifdef USE_BATCHING
  godotTriplanarVertex = batchingMatrix * godotTriplanarVertex;
  godotTriplanarNormal = transpose( inverse( mat3( batchingMatrix ) ) ) * godotTriplanarNormal;
#endif
#ifdef USE_INSTANCING
  godotTriplanarVertex = instanceMatrix * godotTriplanarVertex;
  godotTriplanarNormal = transpose( inverse( mat3( instanceMatrix ) ) ) * godotTriplanarNormal;
#endif
godotTriplanarNormal = normalize( transpose( inverse( mat3( modelMatrix ) ) ) * godotTriplanarNormal );
vGodotTriplanarPosition = ( modelMatrix * godotTriplanarVertex ).xyz * ${scale} + ${offset};
vec3 godotTriplanarTangent = normalize( vec3( 0.0, 0.0, -1.0 ) * abs( godotTriplanarNormal.x ) + vec3( 1.0, 0.0, 0.0 ) * ( abs( godotTriplanarNormal.y ) + abs( godotTriplanarNormal.z ) ) );
vec3 godotTriplanarBinormal = normalize( vec3( 0.0, 1.0, 0.0 ) * ( abs( godotTriplanarNormal.x ) + abs( godotTriplanarNormal.z ) ) + vec3( 0.0, 0.0, -1.0 ) * abs( godotTriplanarNormal.y ) );
vGodotTriplanarTangent = normalize( mat3( viewMatrix ) * godotTriplanarTangent );
vGodotTriplanarBinormal = normalize( mat3( viewMatrix ) * godotTriplanarBinormal );` : `
vec3 godotTriplanarNormal = normalize( objectNormal );
vGodotTriplanarPosition = transformed * ${scale} + ${offset};
vec3 godotTriplanarTangent = normalize( vec3( 0.0, 0.0, -1.0 ) * abs( godotTriplanarNormal.x ) + vec3( 1.0, 0.0, 0.0 ) * ( abs( godotTriplanarNormal.y ) + abs( godotTriplanarNormal.z ) ) );
vec3 godotTriplanarBinormal = normalize( vec3( 0.0, 1.0, 0.0 ) * ( abs( godotTriplanarNormal.x ) + abs( godotTriplanarNormal.z ) ) + vec3( 0.0, 0.0, -1.0 ) * abs( godotTriplanarNormal.y ) );
vGodotTriplanarTangent = normalize( normalMatrix * godotTriplanarTangent );
vGodotTriplanarBinormal = normalize( normalMatrix * godotTriplanarBinormal );`}
vGodotTriplanarWeights = pow( abs( godotTriplanarNormal ), vec3( ${sharpness} ) );
vGodotTriplanarWeights /= dot( vGodotTriplanarWeights, vec3( 1.0 ) );
vGodotTriplanarPosition *= vec3( 1.0, -1.0, 1.0 );
#include <project_vertex>`;
  const fragmentDeclarations = `#include <common>
varying vec3 vGodotTriplanarPosition;
varying vec3 vGodotTriplanarWeights;
varying vec3 vGodotTriplanarTangent;
varying vec3 vGodotTriplanarBinormal;
vec4 godotTriplanarTexture( sampler2D sourceTexture ) {
  vec4 sampleValue = vec4( 0.0 );
  sampleValue += texture2D( sourceTexture, vGodotTriplanarPosition.xy ) * vGodotTriplanarWeights.z;
  sampleValue += texture2D( sourceTexture, vGodotTriplanarPosition.xz ) * vGodotTriplanarWeights.y;
  sampleValue += texture2D( sourceTexture, vGodotTriplanarPosition.zy * vec2( -1.0, 1.0 ) ) * vGodotTriplanarWeights.x;
  return sampleValue;
}`;
  const properties: GodotChannelMapProperties = {
    onBeforeCompile(parameters) {
      let vertex = requireShaderSource(parameters.vertexShader, '#include <common>', declarations, 'vertex declarations');
      vertex = requireShaderSource(vertex, '#include <project_vertex>', vertexProjection, 'vertex projection');
      let fragment = requireShaderSource(parameters.fragmentShader, '#include <common>', fragmentDeclarations, 'fragment declarations');
      fragment = fragment
        .replace('texture2D( map, vMapUv )', 'godotTriplanarTexture( map )')
        .replace('texture2D( metalnessMap, vMetalnessMapUv )', 'godotTriplanarTexture( metalnessMap )')
        .replace('texture2D( roughnessMap, vRoughnessMapUv )', 'godotTriplanarTexture( roughnessMap )')
        .replace('texture2D( normalMap, vNormalMapUv )', 'godotTriplanarTexture( normalMap )')
        .replace('texture2D( emissiveMap, vEmissiveMapUv )', 'godotTriplanarTexture( emissiveMap )')
        .replace('texture2D( aoMap, vAoMapUv )', 'godotTriplanarTexture( aoMap )')
        .replace('normal = normalize( tbn * mapN );', 'normal = normalize( mat3( vGodotTriplanarTangent, vGodotTriplanarBinormal, normal ) * mapN );');
      if (channels.metalness !== undefined) fragment = replaceShaderRead(fragment, THREE_METALNESS_READ, shaderChannel('texelMetalness', channels.metalness), 'metalness');
      if (channels.roughness !== undefined) fragment = replaceShaderRead(fragment, THREE_ROUGHNESS_READ, shaderChannel('texelRoughness', channels.roughness), 'roughness');
      if (channels.ao !== undefined) fragment = replaceShaderRead(fragment, 'godotTriplanarTexture( aoMap ).r', shaderChannel('godotTriplanarTexture( aoMap )', channels.ao), 'AO');
      parameters.vertexShader = vertex;
      parameters.fragmentShader = fragment;
    },
    customProgramCacheKey: () => key,
  };
  TRIPLANAR_PROPERTIES.set(key, properties);
  return properties;
}
