/**
 * read/import-sidecar.ts — a `<file>.import` sidecar, the record of what Godot's IMPORTER did.
 *
 * ## Why a reader that "does not open binaries" reads this file
 *
 * A `.glb` in a Godot project is not rendered as authored. Godot imports it, and the import is
 * configurable: the `<file>.import` beside it is the settings Godot used, written in the SAME text
 * serialization every other file in this package is (`[remap]`/`[deps]`/`[params]` sections with
 * `key=value` bodies), so nothing new is parsed — `text-format.ts` already reads it.
 *
 * One of those settings changes WHICH MATERIALS THE GAME RENDERS, and getting it wrong is not
 * subtle. `squash-the-creeps`'s two models both declare `materials/storage=2`: Godot extracted
 * every material the `.glb` embedded into a standalone `.tres` beside it and the game renders
 * THOSE. Measured on Godot 3.6.stable (`de2f0f147`, headless, `MatProbe.gd`), instancing
 * `res://art/mob.glb` and reading each surface back:
 *
 * | surface | `mesh.surface_get_material(i).resource_path` | albedo |
 * | --- | --- | --- |
 * | 0 | `res://art/mob_eye.tres` | `0.760784, 0.113725, 0.188235` |
 * | 1 | `res://art/mob_body.tres` | `0.058823, 0.266667, 0.490196` |
 * | 2 | `res://art/pupil.tres` | `0, 0, 0` |
 *
 * The `.glb`'s own embedded `mob_body` carries a baseColorFactor about a third as bright, which is
 * why a port that loads the `.glb` and stops there renders navy mobs where the native game renders
 * vivid blue, and renders no glowing eye ring at all (`mob_eye.tres` authors a real `emission`).
 *
 * ## The TEXTURE importer's sampler flags, which the same file records
 *
 * The other importer whose settings change what the frame contains is `texture`. A `.png` in a
 * Godot project is not sampled the way a bare image loader samples it: the sidecar's `flags/*`
 * are the sampler state Godot baked into the `.stex` it renders, and three's own defaults are a
 * DIFFERENT sampler (`ClampToEdgeWrapping`, anisotropy 1). The gap is not cosmetic where the two
 * disagree — a `flags/repeat` texture drawn clamped smears its edge texel across every UV past
 * 1.0, and `flags/anisotropic` off at a grazing angle is the difference between a readable tile
 * floor and mush.
 *
 * {@link GodotTextureImportFlags} is that half. `flags/repeat` is read as either spelling Godot
 * has written it in: 3.0 wrote a BOOL, 3.1+ writes the `Disabled,Enabled,Mirrored` enum, and the
 * vendored `platformer-3d` demo carries BOTH in one project (`stage/texture.png.import` says `1`,
 * `stage/texturemr.png.import` says `true`) because it was imported across the change. Godot's own
 * `int()` conversion of a bool Variant is what resolves it — `true` is 1 (Enabled), `false` is 0.
 *
 * ## What this module reads, and what it deliberately does not
 *
 * It reads the `[remap] importer` and resulting resource `type`, the `[deps] source_file`, the
 * three `[params]` keys the material translation gates on, the texture importer's sampler flags,
 * and — for a `scene` importer — the tree-shaping params `readSceneImportParams` already consumed at glb-open
 * ({@link GodotSceneImportParams}, stored on {@link ImportSidecar.sceneParams}). It does NOT model
 * the other ~90 params — an importer's whole option set is not a thing anything downstream
 * consumes, and a field with no reader is exactly what this repo forbids.
 *
 * An ABSENT key is absent, never defaulted here. Godot writes every option into every `.import` it
 * generates, so a missing one means a hand-written or partial file, and inventing the importer's
 * default for it would state a sampler the project never authored.
 *
 * Two params that LOOK load-bearing and are not, stated here so nobody re-derives them:
 *
 *  - **`materials/keep_on_reimport`** decides whether re-importing the source OVERWRITES the
 *    extracted `.tres`. It says nothing about what the running game renders — the `.tres` on disk
 *    is what renders either way — so gating on it would refuse a correct translation.
 *  - **`materials/location`** chooses whether the extracted material is assigned as the
 *    `MeshInstance`'s own `material/0` override (0, "Node") or baked onto the mesh SURFACE
 *    (1, "Mesh"). Measured on the fixture (`location=1`): `get_surface_material(i)` is null and
 *    `mesh.surface_get_material(i)` is the `.tres`. Both routes end at the same rendered material,
 *    and the translation applies overrides by MATERIAL NAME over the loaded three graph, so the
 *    distinction has no consequence here.
 */
import type { GodotValue } from './godot-value';
import { asNumber, asString } from './godot-value';
import type { GodotTextFile } from './text-format';

/**
 * Godot 3's `materials/storage` value this translation has MEASURED: every material the source
 * embedded was extracted to a standalone `.tres` beside it, and the game renders those. See the
 * header for the 3.6 run.
 */
export const MATERIALS_STORAGE_EXTERNAL_TRES = 2;

/**
 * Godot 3's `materials/storage` value for "leave the materials inside the imported scene". Nothing
 * is extracted, so a port that loads the source file already has what the game renders.
 */
export const MATERIALS_STORAGE_BUILT_IN = 0;

/**
 * Godot 3's `flags/repeat` — the `Disabled,Enabled,Mirrored` enum, which is also what its older
 * BOOL spelling converts to. See the header for the project that carries both.
 */
export const TEXTURE_REPEAT = { disabled: 0, enabled: 1, mirrored: 2 } as const;

/**
 * The `texture` importer's sampler settings, as authored. Every field is OPTIONAL and absent means
 * the sidecar did not write it — see the header on why nothing is defaulted here.
 */
export interface GodotTextureImportFlags {
  /** `flags/repeat` — see {@link TEXTURE_REPEAT}. A bool is read as Godot's own `int()` of it. */
  readonly repeat?: number;
  /** `flags/filter` — Godot's linear-vs-nearest magnification/minification filter. */
  readonly filter?: boolean;
  /** `flags/mipmaps` — whether the imported texture carries a mip chain at all. */
  readonly mipmaps?: boolean;
  /** `flags/anisotropic` — whether this texture opts INTO the project's anisotropic filter level
   *  (`[rendering] quality/filters/anisotropic_filter_level`); the level itself is not per-texture. */
  readonly anisotropic?: boolean;
  /** `flags/srgb` — `0` Disable, `1` Enable, `2` Detect. Decides whether the sampled texel is
   *  sRGB-decoded, which is three's `Texture.colorSpace`. */
  readonly srgb?: number;
  /** `process/premult_alpha` — Godot pre-multiplied RGB by A into the IMPORTED bytes. */
  readonly premultAlpha?: boolean;
}

/** One `<file>.import` — what Godot's importer recorded about one source asset. */
export interface ImportSidecar {
  /** The sidecar itself: `res://art/mob.glb.import`. */
  readonly resPath: string;
  /** Godot 4's `[remap] uid`, which is how project settings may name this source asset. */
  readonly uid?: string;
  /** `[remap] importer` — `scene`, `texture`, `ogg_vorbis`, … */
  readonly importer?: string;
  /** `[remap] type` — the exact runtime Resource class produced by this import. */
  readonly resourceType?: string;
  /** `[deps] source_file` — the asset this sidecar describes, e.g. `res://art/mob.glb`. */
  readonly sourceFile?: string;
  /** `[params] materials/storage`. See {@link MATERIALS_STORAGE_EXTERNAL_TRES}. */
  readonly materialsStorage?: number;
  /**
   * Godot 4 scene-importer material overrides from
   * `_subresources.materials.<name>.use_external/*`.
   *
   * Unlike Godot 3's directory-wide `materials/storage = 2`, this is an explicit, per-material
   * name -> resource path map. The semantic frontend binds it before translation; emitters never
   * inspect the importer's dictionary shape.
   */
  readonly externalMaterials?: Readonly<Record<string, string>>;
  /** `[params] external_files/store_in_subdir` — where extracted files were written. */
  readonly storeInSubdir?: boolean;
  /** The `texture` importer's sampler settings. Absent for every other importer, and for a
   *  `texture` sidecar that authored none of them. */
  readonly textureFlags?: GodotTextureImportFlags;
  /** `cubemap_texture`'s `slices/arrangement` enum: 0=1x6, 1=2x3, 2=3x2, 3=6x1. */
  readonly cubemapArrangement?: number;
  /** Alpha cutoff used by Godot's `bitmap` importer when converting the source image. */
  readonly bitmapThreshold?: number;
  /** Godot bitmap importer source channel: 0 luminance, 1 alpha. */
  readonly bitmapCreateFrom?: number;
  /** Imported AudioStream loop flag (OGG/MP3), retained on the Resource identity. */
  readonly audioLoop?: boolean;
  /** Imported AudioStream loop start in seconds (OGG/MP3). */
  readonly audioLoopOffset?: number;
  /**
   * The `scene` importer's tree-shaping params. Present only when `[remap] importer` is `scene`.
   * Same struct `readGlbAsGodotScene` is handed — stored here so a Godot→IR→Godot cycle can emit
   * the values the glb-open path consumed, instead of dropping them.
   */
  readonly sceneParams?: GodotSceneImportParams;
  /** `wavefront_obj`'s closed importer record. Kept typed so no emitter reads serialized
   * `[params]` dictionaries or mistakes a sidecar for the imported Mesh bytes. */
  readonly objParams?: GodotObjImportParams;
  /** Godot 4's `texture` importer options (`editor/import/resource_importer_texture.cpp:230`). */
  readonly textureImport?: GodotTextureImportParams;
}

/**
 * The Godot 4 `texture` importer's `[params]` that decide the imported image
 * (`ResourceImporterTexture::import`, `resource_importer_texture.cpp:700`): compression, mipmaps,
 * channel remap and processing. Absent keys stay absent.
 */
export interface GodotTextureImportParams {
  readonly compressMode?: number;
  readonly mipmapsGenerate?: boolean;
  readonly mipmapsLimit?: number;
  readonly normalMap?: number;
  readonly roughnessMode?: number;
  readonly channelRemap?: readonly [number, number, number, number];
  readonly fixAlphaBorder?: boolean;
  readonly premultAlpha?: boolean;
  readonly normalMapInvertY?: boolean;
  readonly hdrAsSrgb?: boolean;
  readonly hdrClampExposure?: boolean;
  readonly sizeLimit?: number;
}

function readTextureImportParams(properties: Readonly<Record<string, GodotValue>> | undefined): GodotTextureImportParams | undefined {
  if (properties === undefined) return undefined;
  const remap = ['red', 'green', 'blue', 'alpha'].map((channel) => asNumber(properties[`process/channel_remap/${channel}`]));
  return {
    ...withKey('compressMode', asNumber(properties['compress/mode'])),
    ...withKey('mipmapsGenerate', boolOf(properties['mipmaps/generate'])),
    ...withKey('mipmapsLimit', asNumber(properties['mipmaps/limit'])),
    ...withKey('normalMap', asNumber(properties['compress/normal_map'])),
    ...withKey('roughnessMode', asNumber(properties['roughness/mode'])),
    ...(remap.every((entry): entry is number => entry !== undefined)
      ? { channelRemap: [remap[0]!, remap[1]!, remap[2]!, remap[3]!] as const }
      : {}),
    ...withKey('fixAlphaBorder', boolOf(properties['process/fix_alpha_border'])),
    ...withKey('premultAlpha', boolOf(properties['process/premult_alpha'])),
    ...withKey('normalMapInvertY', boolOf(properties['process/normal_map_invert_y'])),
    ...withKey('hdrAsSrgb', boolOf(properties['process/hdr_as_srgb'])),
    ...withKey('hdrClampExposure', boolOf(properties['process/hdr_clamp_exposure'])),
    ...withKey('sizeLimit', asNumber(properties['process/size_limit'])),
  };
}

export interface GodotObjImportParams {
  readonly importerVersion?: number;
  readonly resourceType?: string;
  readonly generateTangents?: boolean;
  readonly scaleMesh?: readonly [number, number, number];
  readonly offsetMesh?: readonly [number, number, number];
  /** Godot 4.3-era sidecars retained this retired option; pinned 4.7 ignores it. */
  readonly optimizeMesh?: boolean;
  readonly forceDisableMeshCompression?: boolean;
  /** Exact authored `[params]` keys. The source binder applies the engine-major option table. */
  readonly authoredOptions: readonly string[];
}

function vector3Tuple(value: GodotValue | undefined): readonly [number, number, number] | undefined {
  if (value?.kind !== 'ctor' || value.name !== 'Vector3' || value.args.length !== 3) return undefined;
  const values = value.args.map(asNumber);
  return values.every((entry): entry is number => entry !== undefined && Number.isFinite(entry))
    ? [values[0]!, values[1]!, values[2]!]
    : undefined;
}

function readObjImportParams(
  remap: Readonly<Record<string, GodotValue>>,
  params: Readonly<Record<string, GodotValue>>,
): GodotObjImportParams {
  const bool = (key: string): boolean | undefined =>
    params[key]?.kind === 'bool' ? params[key].value : undefined;
  const importerVersion = asNumber(remap['importer_version']);
  const resourceType = asString(remap['type']);
  const generateTangents = bool('generate_tangents');
  const scaleMesh = vector3Tuple(params['scale_mesh']);
  const offsetMesh = vector3Tuple(params['offset_mesh']);
  const optimizeMesh = bool('optimize_mesh');
  const forceDisableMeshCompression = bool('force_disable_mesh_compression');
  return {
    ...(importerVersion === undefined ? {} : { importerVersion }),
    ...(resourceType === undefined ? {} : { resourceType }),
    ...(generateTangents === undefined ? {} : { generateTangents }),
    ...(scaleMesh === undefined ? {} : { scaleMesh }),
    ...(offsetMesh === undefined ? {} : { offsetMesh }),
    ...(optimizeMesh === undefined ? {} : { optimizeMesh }),
    ...(forceDisableMeshCompression === undefined ? {} : { forceDisableMeshCompression }),
    authoredOptions: Object.keys(params).sort(),
  };
}

function readExternalMaterials(
  subresources: GodotValue | undefined,
): Readonly<Record<string, string>> | undefined {
  if (subresources?.kind !== 'dict') return undefined;
  const materials = subresources.entries.find((entry) => entry.key === 'materials')?.value;
  if (materials?.kind !== 'dict') return undefined;
  const result: Record<string, string> = {};
  for (const material of materials.entries) {
    if (material.value.kind !== 'dict') continue;
    const enabled = material.value.entries.find(
      (entry) => entry.key === 'use_external/enabled',
    )?.value;
    if (enabled?.kind !== 'bool' || !enabled.value) continue;
    const fallback = asString(
      material.value.entries.find((entry) => entry.key === 'use_external/fallback_path')?.value,
    );
    if (fallback !== undefined && fallback !== '') result[material.key] = fallback;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

/** `flags/repeat` in either spelling Godot has used — see the header. */
function readRepeat(value: GodotValue | undefined): number | undefined {
  if (value?.kind === 'bool') return value.value ? TEXTURE_REPEAT.enabled : TEXTURE_REPEAT.disabled;
  return asNumber(value);
}

const boolOf = (value: GodotValue | undefined): boolean | undefined =>
  value?.kind === 'bool' ? value.value : undefined;

/** The `[params]` half of a `texture` sidecar, or `undefined` when it authored none of them. */
function readTextureFlags(
  properties: Readonly<Record<string, GodotValue>> | undefined,
): GodotTextureImportFlags | undefined {
  if (properties === undefined) return undefined;
  const flags: GodotTextureImportFlags = {
    ...withKey('repeat', readRepeat(properties['flags/repeat'])),
    ...withKey('filter', boolOf(properties['flags/filter'])),
    ...withKey('mipmaps', boolOf(properties['flags/mipmaps'])),
    ...withKey('anisotropic', boolOf(properties['flags/anisotropic'])),
    ...withKey('srgb', asNumber(properties['flags/srgb'])),
    ...withKey('premultAlpha', boolOf(properties['process/premult_alpha'])),
  };
  return Object.keys(flags).length === 0 ? undefined : flags;
}

/** `{ k: v }` when `v` is defined and `{}` when it is not — the exactOptionalPropertyTypes spread
 *  every reader in this package uses, written once here because six fields need it. */
function withKey<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * The `scene` importer's params that change the NODE TREE Godot builds from a `.glb`.
 *
 * These are read here rather than defaulted in `gltf-godot-scene.ts` because Godot writes every
 * option into every `.import` it generates (the header's absent-is-absent rule), and because at
 * least one of them — `gltf/naming_version` — changes every name in the tree while varying
 * per-file inside a single project: `starter-kit-3d-platformer` ships three `.glb` models at
 * version 2, one at 1, and eleven at 0, so a reader that assumed one value would be wrong for four
 * of fifteen models. Defaults here are Godot's own registered defaults
 * (`resource_importer_scene.cpp:2596-2619`, `editor_scene_importer_gltf.cpp:93`) and apply only to
 * a key the sidecar genuinely omits.
 *
 * The ~90 other params are still deliberately unread — see the header. What earns a field here is
 * a measured effect on the tree, and `materials/extract` (which decides where a material RESOURCE
 * is stored, not what the tree looks like) is the boundary on the other side.
 */
export interface GodotSceneImportParams {
  /** `gltf/naming_version` — 0 (Godot 4.0/4.1), 1 (4.2–4.4), 2 (4.5+). */
  readonly gltfNamingVersion: number;
  /** `nodes/root_type` — a class to replace the synthesized root with; `""` means keep `Node3D`.
   *  `"Spatial"` is the same keep: it is Node3D's Godot 3 name (`translate/data/dialect.ts`
   *  `GODOT_4_CLASS_RENAMES.Node3D`), not a different class. See {@link isUnchangedGlbRootType}. */
  readonly rootType: string;
  /** `nodes/root_name` — a name for the root. `"Scene Root"` is Godot's own legacy placeholder and
   *  means NO override (`resource_importer_scene.cpp:3320`, comment included). */
  readonly rootName: string;
  /** `nodes/use_name_suffixes` — whether `-col`/`-noimp`/… hints in node names are honoured. */
  readonly useNameSuffixes: boolean;
  /** `nodes/use_node_type_suffixes` — the second half of the same, for the node-type hints. */
  readonly useNodeTypeSuffixes: boolean;
  readonly applyRootScale: boolean;
  readonly rootScale: number;
  /** `nodes/import_as_skeleton_bones` — turns the whole document into one skeleton's bones. */
  readonly importAsSkeletonBones: boolean;
  /** `animation/import` — off means no `AnimationPlayer` is synthesized at all. */
  readonly animationImport: boolean;
  /** `animation/fps` — the resample rate, and therefore each clip's `step` (`1 / fps`). */
  readonly animationFps: number;
  readonly animationTrimming: boolean;
  readonly animationRemoveImmutableTracks: boolean;
  /**
   * `_subresources.animations.<clip>.settings/loop_mode` — a per-clip override the glTF cannot
   * express. `character.glb`'s `idle`/`jump`/`walk` loop ONLY because the sidecar says so.
   */
  readonly animationLoopModes: Readonly<Record<string, number>>;
}

/**
 * `nodes/root_type` values that leave the importer's synthesized root alone.
 *
 * `readGlbAsGodotScene` always synthesizes a `Node3D`. `""` and `"Node3D"` are Godot 4's "keep
 * it" spellings. `"Spatial"` is the same class under Godot 3's name — a documented pure rename
 * (`translate/data/dialect.ts` `GODOT_4_CLASS_RENAMES.Node3D === 'Spatial'`), not a replacement.
 * Any other class (`CharacterBody3D`, `KinematicBody`, `StaticBody`, …) replaces the root while
 * preserving the imported child tree; `gltf-godot-scene.ts` captures that authored class identity.
 *
 * The map is not inverted wholesale: `KinematicBody` is CharacterBody3D's rename and WOULD
 * replace the root. Only the synthesized root's own pair is a no-op.
 */
export function isUnchangedGlbRootType(rootType: string): boolean {
  return rootType === '' || rootType === 'Node3D' || rootType === 'Spatial';
}

const numberOr = (value: GodotValue | undefined, fallback: number): number =>
  asNumber(value) ?? fallback;
const boolOr = (value: GodotValue | undefined, fallback: boolean): boolean =>
  value?.kind === 'bool' ? value.value : fallback;
const stringOr = (value: GodotValue | undefined, fallback: string): string =>
  asString(value) ?? fallback;

function readAnimationLoopModes(
  subresources: GodotValue | undefined,
): Readonly<Record<string, number>> {
  if (subresources?.kind !== 'dict') return {};
  const animations = subresources.entries.find((entry) => entry.key === 'animations')?.value;
  if (animations?.kind !== 'dict') return {};
  const modes: Record<string, number> = {};
  for (const clip of animations.entries) {
    if (clip.value.kind !== 'dict') continue;
    const mode = clip.value.entries.find((entry) => entry.key === 'settings/loop_mode')?.value;
    const numeric = asNumber(mode);
    if (numeric !== undefined) modes[clip.key] = numeric;
  }
  return modes;
}

/** The `[params]` of a `scene` sidecar. Pure; the caller owns the filesystem. */
export function readSceneImportParams(file: GodotTextFile): GodotSceneImportParams {
  const params = file.sections.find((one) => one.kind === 'params')?.properties ?? {};
  return {
    gltfNamingVersion: numberOr(params['gltf/naming_version'], 2),
    rootType: stringOr(params['nodes/root_type'], ''),
    rootName: stringOr(params['nodes/root_name'], ''),
    useNameSuffixes: boolOr(params['nodes/use_name_suffixes'], true),
    useNodeTypeSuffixes: boolOr(params['nodes/use_node_type_suffixes'], true),
    applyRootScale: boolOr(params['nodes/apply_root_scale'], true),
    rootScale: numberOr(params['nodes/root_scale'], 1),
    importAsSkeletonBones: boolOr(params['nodes/import_as_skeleton_bones'], false),
    animationImport: boolOr(params['animation/import'], true),
    animationFps: numberOr(params['animation/fps'], 30),
    animationTrimming: boolOr(params['animation/trimming'], false),
    animationRemoveImmutableTracks: boolOr(params['animation/remove_immutable_tracks'], true),
    animationLoopModes: readAnimationLoopModes(params['_subresources']),
  };
}

/** Parse one already-tokenized `.import` file. Pure; the caller owns the filesystem. */
export function readImportSidecar(file: GodotTextFile): ImportSidecar {
  const remap = file.sections.find((one) => one.kind === 'remap');
  const deps = file.sections.find((one) => one.kind === 'deps');
  const params = file.sections.find((one) => one.kind === 'params');
  const importer = asString(remap?.properties['importer']);
  const resourceType = asString(remap?.properties['type']);
  const uid = asString(remap?.properties['uid']);
  const sourceFile = asString(deps?.properties['source_file']);
  const materialsStorage = asNumber(params?.properties['materials/storage']);
  const externalMaterials = readExternalMaterials(params?.properties['_subresources']);
  const cubemapArrangement = asNumber(params?.properties['slices/arrangement']);
  const bitmapThreshold = importer === 'bitmap' ? asNumber(params?.properties['threshold']) : undefined;
  const bitmapCreateFrom = importer === 'bitmap' ? asNumber(params?.properties['create_from']) : undefined;
  const audioLoopValue = importer === 'ogg_vorbis' || importer === 'mp3'
    ? params?.properties['loop']
    : undefined;
  const audioLoop = audioLoopValue?.kind === 'bool' ? audioLoopValue.value : undefined;
  const audioLoopOffset = importer === 'ogg_vorbis' || importer === 'mp3'
    ? asNumber(params?.properties['loop_offset'])
    : undefined;
  const storeInSubdirValue = params?.properties['external_files/store_in_subdir'];
  const textureFlags = readTextureFlags(params?.properties);
  const textureImport = importer === 'texture' ? readTextureImportParams(params?.properties) : undefined;
  const objParams = importer === 'wavefront_obj'
    ? readObjImportParams(remap?.properties ?? {}, params?.properties ?? {})
    : undefined;
  return {
    resPath: file.resPath,
    ...(uid === undefined ? {} : { uid }),
    ...(importer === undefined ? {} : { importer }),
    ...(resourceType === undefined ? {} : { resourceType }),
    ...(sourceFile === undefined ? {} : { sourceFile }),
    ...(materialsStorage === undefined ? {} : { materialsStorage }),
    ...(externalMaterials === undefined ? {} : { externalMaterials }),
    ...(storeInSubdirValue?.kind === 'bool' ? { storeInSubdir: storeInSubdirValue.value } : {}),
    ...(textureFlags === undefined ? {} : { textureFlags }),
    ...(textureImport === undefined ? {} : { textureImport }),
    ...(cubemapArrangement === undefined ? {} : { cubemapArrangement }),
    ...(bitmapThreshold === undefined ? {} : { bitmapThreshold }),
    ...(bitmapCreateFrom === undefined ? {} : { bitmapCreateFrom }),
    ...(audioLoop === undefined ? {} : { audioLoop }),
    ...(audioLoopOffset === undefined ? {} : { audioLoopOffset }),
    ...(importer === 'scene' ? { sceneParams: readSceneImportParams(file) } : {}),
    ...(objParams === undefined ? {} : { objParams }),
  };
}
