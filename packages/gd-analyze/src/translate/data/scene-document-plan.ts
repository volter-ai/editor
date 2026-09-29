import { type GodotSceneLightPlan, godotSceneLightPlan } from './scene-light-idioms';
import path from 'node:path';
import type {
  BoundGodotProject,
  BoundGodotResourceData,
  BoundGodotImportedBone,
  BoundGodotSceneDocument,
  BoundGodotSceneNode,
  BoundGodotSoundDocument,
  BoundGodotTextureDocument,
  BoundGodotCubemapDocument,
} from '../../analyze/bound-project';
import type { GodotValue } from '../../read/godot-value';
import type { GodotBoundShader } from '../../godot-frontend/bound-shader';
import { lowerGodotShader } from '../emit/shader-glsl';
import { GODOT_SKY_SHADER_BUILTINS } from '../emit/sky-shader';
import { ARRAY_MESH_PRIMITIVE } from '../../read/array-mesh';
import { readGodot4Surfaces } from '../../read/godot4-surfaces';
import { GridMapReadError, readGridMapCells } from '../../read/grid-map';
import { isImportedResourceId } from '../../read/instance-expansion';
import type { ImportedClip } from '../../read/gltf-animation-import';
import {
  godotMeshLibraryShapeClass,
  godotArrayMeshRefusal,
  godotFamilyCarriesNode,
  godotFamilyCarriesResource,
  godotFamilyRefusal,
} from './scene-families';
import {
  type GodotAnimationNodeData,
  type TargetGodotAnimationBindingsPlan,
  type TargetGodotAnimationLibraryPlan,
  godotAnimationData,
  godotAnimationNodeData,
  godotResolveNodePath,
  godotTrackPath,
} from './scene-animation';
import { type SceneSetterLookup, type TargetSceneValue, targetSceneValue } from './scene-setters';
import { GODOT_4_7_SCRIPT_SIGNAL_RULE } from './authority/godot-4.7-scene-nodes';
import {
  type GodotCompatExport,
  type GodotSceneNodeAuthority,
  GodotSceneNodeAuthorityResolver,
  type GodotSceneStructureRuleId,
  type SerializedScenePropertyIdentity,
  type TargetScenePropertyKind,
} from './scene-node-authority';
import { godotModelMaterialIdiom } from './scene-material-idioms';
import { type GodotSceneNodeIdiom, godotSceneNodeIdiom } from './scene-node-idioms';
import { type GodotSceneResourceIdiom, godotSceneResourceIdiom } from './scene-resource-idioms';

export const GODOT_SCENE_DOCUMENT_PLAN_VERSION = 2 as const;

/** One planned node: a native entity, or an instanced scene's generated component. */
export interface TargetGodotSceneNodePlan {
  readonly nodePath: string;
  readonly parentNodePath?: string;
  readonly name: string;
  /**
   * A native node's library idiom (`scene-node-idioms.ts`), which emit writes. A node without one
   * mounts `instance`'s generated component, or an imported model's tree (`model`).
   */
  readonly idiom?: GodotSceneNodeIdiom;
  /** A light node's three light and its props (`scene-light-idioms.ts`), which emit prints. */
  readonly light?: GodotSceneLightPlan;
  /** The directional lights of the scene a WorldEnvironment's sky reads (`scene-sky-lights.ts`), which emit prints as refs. */
  readonly skyLights?: readonly { readonly nodePath: string; readonly name: string }[];
  /** For an imported model: the importer's tree over the model file, and this scene's edits in it. */
  readonly model?: TargetGodotImportedModelPlan;
  /** A node this scene places under a node of an imported model: that instance and the path. */
  readonly portal?: { readonly instanceNodePath: string; readonly at: string };
  /** For an imported model: the nodes this scene places under its model's nodes. */
  readonly placements?: readonly { readonly at: string; readonly node: TargetGodotSceneNodePlan }[];
  /** The instanced scene, for a node that instances one (`scene-instance`). */
  readonly instance?: { readonly sourceResPath: string };
  readonly scriptResPath?: string;
  /** Authored values (for an instance, its root overrides), each through a property rule. */
  readonly properties: readonly TargetGodotScenePropertyPlan[];
  /** Groups the Node protocol receives at mount, in authored order. */
  readonly groups: readonly string[];
  /**
   * The node's Godot class and native ancestors, nearest first, which the Node protocol records at
   * mount (type tests read it); empty for an instance, whose component records its own root.
   */
  readonly classes: readonly string[];
  /** `unique_name_in_owner`: the scene root finds the node as `%Name`. */
  readonly unique?: true;
  /**
   * Its script's exported fields whose authored values are not plain (resources, records,
   * containers): each value planned as the scene's resources are, handed with the field plan's.
   */
  readonly fieldValues?: readonly { readonly field: string; readonly value: TargetGodotSceneValue }[];
  /**
   * The sibling position the scene authors (`index`), which moves the node there once added when
   * that is before where it was added (`SceneState::instantiate`, packed_scene.cpp:545).
   */
  readonly siblingIndex?: number;
  /** Authored properties without a JSX rule: their setters' calls on the entity at mount, in order. */
  readonly setters: readonly TargetGodotSceneSetterPlan[];
  /** An AnimationPlayer's tracks resolved against the scene: the bindings its mixer receives. */
  readonly animation?: TargetGodotAnimationBindingsPlan;
  readonly children: readonly TargetGodotSceneNodePlan[];
}

/** One node of an imported model's tree (`GodotImportedSceneNode` in compat's packed-scene). */
export interface TargetGodotImportedModelNode {
  readonly path: string;
  readonly name: string;
  readonly classes: readonly string[];
  readonly nonSpatial?: true;
  /** The importer's AnimationPlayer, which plays the model's clips. */
  readonly animationPlayer?: true;
  /** A GeometryInstance3D (a mesh): it casts and receives shadows as Godot makes it. */
  readonly geometryInstance?: true;
  readonly gltfNode?: number;
  readonly matrix: readonly number[];
  /** A Skeleton3D's bones in Godot's order: names, the glTF joints they bind to, imported poses. */
  readonly bones?: readonly BoundGodotImportedBone[];
}

/** An instanced imported model: the file, Godot's tree over it, and this scene's overrides in it. */
export interface TargetGodotImportedModelPlan {
  readonly sourceResPath: string;
  readonly rootClasses: readonly string[];
  readonly nodes: readonly TargetGodotImportedModelNode[];
  /** The file's external images (`images[index].uri`): each the project's imported texture. */
  readonly images?: readonly { readonly index: number; readonly load: TargetGodotImportedLoad }[];
  /**
   * The importer's external materials (`_subresources.materials.<name>.use_external/path` in the
   * file's `.import`): each of the file's materials by its glTF name, drawn as the project's
   * material resource (planned as the scene's own) in its place.
   */
  readonly materials?: readonly { readonly name: string; readonly key: string }[];
  /** The importer's AnimationPlayer library (its clips as the importer keys them), with its RESET. */
  readonly animations?: TargetGodotAnimationLibraryPlan;
  /**
   * The model's AnimationPlayers that play the glTF's own clips on three's mixer, by path in the
   * model (`scene-surface-idioms.ts`): ones no AnimationTree drives and the scene adds nothing to.
   */
  readonly clipPlayers?: readonly string[];
  /** The importer's root scale baked into the model's meshes, when not 1. */
  readonly meshScale?: number;
  /** Authored properties of the model's own nodes, by their setters on the node's entity. */
  readonly overrides: readonly {
    readonly at: string;
    readonly setters: readonly TargetGodotSceneSetterPlan[];
    /** An AnimationPlayer of the model: its tracks resolved against the model and the scene. */
    readonly animation?: TargetGodotAnimationBindingsPlan;
  }[];
}

/** A value a setter receives: a target value, or a resource this document's plan constructs. */
export type TargetGodotSceneValue =
  | Exclude<TargetSceneValue, { readonly kind: 'resource' | 'Variant-array' | 'Variant-dictionary' }>
  | { readonly kind: 'resource'; readonly key: string }
  | { readonly kind: 'Variant-array'; readonly items: readonly TargetGodotSceneValue[] }
  | { readonly kind: 'Variant-dictionary'; readonly entries: readonly (readonly [TargetGodotSceneValue, TargetGodotSceneValue])[] };

/** One authored property as its setter's bound call. */
export interface TargetGodotSceneSetterPlan {
  readonly propertyName: string;
  readonly setter: { readonly module: string; readonly exportName: string; readonly localName: string };
  readonly index?: number | string;
  readonly value: TargetGodotSceneValue;
  /**
   * `'cells-file'`: the value is written to the node's cells data file (a GridMap's `data`,
   * `scene-families.ts`), and the element's prop is that file's import.
   */
  readonly written?: 'cells-file';
  /** The part it plays apart from the element's own props (`scene-surface-idioms.ts`). */
  readonly role?:
    | { readonly kind: 'visible' }
    | { readonly kind: 'transparency' }
    | { readonly kind: 'visibility-range'; readonly prop: string }
    | { readonly kind: 'current' };
  /** The one prop of its element or resource it joins with the others of its kind (`scene-surface-idioms.ts`). */
  readonly collect?: 'libraries' | 'parameters' | 'meta' | 'shader' | 'shader-parameter' | 'theme';
  /** On an imported model's own node: the part of the model's element it sets (`MODEL_OVERRIDE_SLOTS`). */
  readonly modelSlot?: GodotModelOverrideSlot;
}

/** What an authored property of an imported model's own node sets on the model's element. */
export type GodotModelOverrideSlot =
  | { readonly kind: 'bone-pose'; readonly component: 'position' | 'rotation' | 'scale' }
  | { readonly kind: 'layers' }
  | { readonly kind: 'transform' }
  | { readonly kind: 'surface-material' }
  | { readonly kind: 'player' };

/** A resource the scene constructs once, then sets its authored properties on. */
export interface TargetGodotSceneResourcePlan {
  /** Document-unique: `sub:<id>`, or `ext:<res path>` and its own `ext:<res path>#sub:<id>`. */
  readonly key: string;
  readonly className: string;
  /** The library idiom it is written as (`scene-resource-idioms.ts`), unless it is constructed. */
  readonly idiom?: GodotSceneResourceIdiom;
  readonly construct: GodotCompatExport;
  /** An imported file the constructor loads: its copied URL and the importer options it applies. */
  readonly load?: TargetGodotImportedLoad;
  /** An `ArrayMesh`'s surfaces, decoded from its `_surfaces` (`read/godot4-surfaces.ts`). */
  readonly mesh?: TargetGodotArrayMeshPlan;
  /** A primitive mesh's three geometry args, and a cylinder's open top (`scene-surface-idioms.ts`). */
  readonly primitive?: { readonly args: readonly number[]; readonly open?: true };
  /** As a mesh draws it, its own material per surface, by resource key (`scene-surface-idioms.ts`). */
  readonly surfaceMaterials?: readonly (string | undefined)[];
  /** A `MeshLibrary`'s items (`item/N/…`, `MeshLibrary::_set`), their meshes and shapes planned. */
  readonly library?: TargetGodotMeshLibraryPlan;
  /** An `AnimationLibrary`'s animations (`_data`, `AnimationLibrary::_set_data`) as data. */
  readonly animations?: TargetGodotAnimationLibraryPlan;
  /** An `AnimationNodeBlendTree`'s graph (its nodes and connections) as data. */
  readonly animationTree?: GodotAnimationNodeData;
  /** A `.gdshader` as the pinned Godot's shader frontend read it, lowered to GLSL (`shader-glsl.ts`). */
  readonly shader?: TargetGodotLoweredShader;
  /**
   * An engine material's generated shaders (`sky_material.cpp` `_update_shader`), each a planned
   * `Shader` resource's key, by the name its binding selects it with.
   */
  readonly engineShaders?: Readonly<Record<string, string>>;
  /**
   * A PackedScene (an `ExtResource` of a `.tscn`, or of an imported model): the scene whose
   * component `instantiate()` mounts, and its root's script class, which it makes first.
   */
  readonly packedScene?: {
    readonly resPath: string;
    readonly rootScript?: string;
    /** An imported model's: its tree's data file and its outside images, which its SceneState reads. */
    readonly model?: { readonly images: readonly { readonly index: number; readonly load: TargetGodotImportedLoad }[] };
  };
  /**
   * A resource whose class keeps its properties by names it makes up (a TileSet's `sources/N`, a
   * TileSetAtlasSource's `x:y/alt/…`): every authored property's value by its name, handed to its
   * constructor as a Map (`_set`, `tile_set.cpp:1240`).
   */
  readonly rawProperties?: readonly { readonly name: string; readonly value: TargetGodotSceneValue }[];
  /** A resource of a script's class (`script = ExtResource(…)`): its script and its properties' values. */
  readonly scriptResource?: {
    readonly scriptResPath: string;
    readonly fields: readonly { readonly name: string; readonly value: TargetGodotSceneValue }[];
    /** The `.tres` it was loaded from (`resource_path`), for one in a file of its own. */
    readonly path?: string;
  };
  readonly setters: readonly TargetGodotSceneSetterPlan[];
}

/** A MeshLibrary's items by id, each mesh and shape a planned resource's key. */
export interface TargetGodotMeshLibraryPlan {
  readonly items: readonly {
    readonly id: number;
    readonly name: string;
    readonly mesh?: string;
    /** `Transform3D(...)` arguments as written: the basis's rows, then the origin. */
    readonly meshTransform: readonly number[];
    readonly castShadow: number;
    readonly shapes: readonly { readonly shape: string; readonly transform: readonly number[] }[];
  }[];
  /** The items' editor thumbnails (`preview`), files the library names and nothing draws. */
  readonly previews: readonly string[];
}

/** An `ArrayMesh` as `godot_array_mesh_new` receives it: each surface's arrays and material. */
export interface TargetGodotArrayMeshPlan {
  readonly resourceName: string;
  readonly surfaces: readonly {
    readonly primitive: number;
    readonly arrays: Readonly<Record<'vertex' | 'normal' | 'tangent' | 'color' | 'tex_uv' | 'tex_uv2' | 'index', readonly number[] | undefined>>;
    /** The planned material resource's key, when the surface names one. */
    readonly material?: string;
  }[];
}

/** An imported file as its class's load receives it: the copied file and the importer's options. */
export interface TargetGodotImportedLoad {
  readonly sourceResPath: string;
  readonly options: Readonly<Record<string, boolean | number>>;
}

/**
 * The `wav` importer's options as `AudioStreamWAV`'s load applies them; an absent option is the
 * importer's default (`resource_importer_wav.cpp:76`). The rate limit is not applied.
 */
function soundLoad(sound: BoundGodotSoundDocument): TargetGodotImportedLoad | string {
  const params = sound.importParams;
  if (params.forceMaxRate === true) return 'force/max_rate is not applied';
  return {
    sourceResPath: sound.resPath,
    options: {
      force8Bit: params.force8Bit ?? false,
      forceMono: params.forceMono ?? false,
      forceMaxRate: false,
      maxRateHz: params.maxRateHz ?? 44100,
      trim: params.trim ?? false,
      normalize: params.normalize ?? false,
      loopMode: params.loopMode ?? 0,
      loopBegin: params.loopBegin ?? 0,
      loopEnd: params.loopEnd ?? -1,
      compressMode: params.compressMode ?? 0,
    },
  };
}

/**
 * The importer options of an imported image this translation applies on the page, or why it does
 * not: only compression the source image stands for (`SOURCE_IMAGE_COMPRESS_MODES`), the identity
 * channel map, no normal-map, HDR or size processing.
 * An absent option is the importer's default (`resource_importer_texture.cpp:230`).
 */
/** A shader's lowered code, as compat's `godot_shader_new` receives it. */
export interface TargetGodotLoweredShader {
  readonly mode: string;
  /** The `render_mode`s it states that the sky pass acts on (`use_debanding`). */
  readonly renderModes: readonly string[];
  readonly uniforms: readonly { readonly name: string; readonly glsl: string; readonly type: string; readonly default: readonly number[] | null }[];
  readonly functions: string;
  readonly entry: string;
}

/**
 * A `.gdshader` the official shader frontend read, lowered for its mode (sky only: the corpus
 * draws no other shader mode), or why it is not.
 */
function shaderPlan(shader: GodotBoundShader): TargetGodotLoweredShader | string {
  if (!shader.ok) return `the official shader frontend refused it (${shader.stage}: ${shader.message})`;
  if (shader.shaderType !== 'sky') return `shader_type ${shader.shaderType} is not lowered`;
  const lowered = lowerGodotShader(shader, GODOT_SKY_SHADER_BUILTINS, 'sky');
  if (typeof lowered === 'string') return lowered;
  // The sky render modes (`material_storage.cpp:1562`): debanding is drawn; `disable_fog` changes
  // nothing, since the fog is never drawn on the sky (`world-environment.ts`); the half- and
  // quarter-resolution passes are not.
  const unsupported = shader.tree.renderModes.find((mode) => mode !== 'use_debanding' && mode !== 'disable_fog');
  if (unsupported !== undefined) return `render_mode ${unsupported} is not drawn`;
  return {
    mode: shader.shaderType,
    renderModes: shader.tree.renderModes.filter((mode) => mode === 'use_debanding'),
    uniforms: lowered.uniforms.map(({ name, glsl, uniform }) => {
      if (uniform.hint !== 0 && !['source_color', 'filter_linear', 'hint_range', 'hint_default_black', 'hint_default_white'].some((hint) => uniform.hintName.includes(hint))) {
        return { name, glsl, type: uniform.type.name, default: null };
      }
      const values = uniform.default.map((value) => ('float' in value ? value.float : 'int' in value ? value.int : 'uint' in value ? value.uint : value.bool ? 1 : 0));
      return { name, glsl, type: uniform.type.name, default: values.length === 0 ? null : values };
    }),
    functions: lowered.functions,
    entry: lowered.entry,
  };
}

/**
 * How each engine material binding names the shader a variant's properties select
 * (`panorama-sky-material.ts`); a class with no entry has no binding.
 */
const ENGINE_SHADER_SELECTORS: Readonly<Record<string, (variant: Readonly<Record<string, boolean>>) => string>> = {
  PanoramaSkyMaterial: (variant) => (variant['filter'] === true ? 'filterOn' : 'filterOff'),
  ProceduralSkyMaterial: (variant) => `debanding${variant['use_debanding'] === true ? 1 : 0}Cover${variant['sky_cover'] === true ? 1 : 0}`,
  PhysicalSkyMaterial: (variant) => `debanding${variant['use_debanding'] === true ? 1 : 0}Night${variant['night_sky'] === true ? 1 : 0}`,
};

/**
 * The importer's `compress/mode` values (`resource_importer_texture.h:45`) the page draws from the
 * source image: lossless (0) keeps its pixels; VRAM compressed (2) is a block compression of the
 * same pixels the GPU decodes (S3TC/BPTC or ETC2/ASTC, `resource_importer_texture.cpp:888`), which
 * the web shows as the image itself, and the page, which has no block encoder, uploads the source
 * as the lossless path does; VRAM uncompressed (3) is the pixels unchanged. Lossy (1, WebP) and
 * Basis Universal (4) are the source degraded by an encoder at the quality the import states; the
 * page draws the source itself, which differs from Godot's only by that encoder's loss.
 */
const SOURCE_IMAGE_COMPRESS_MODES: ReadonlySet<number> = new Set([0, 1, 2, 3, 4]);

/** The `cubemap_texture` importer's options as `useGodotCubemap` applies them, or why they are not. */
function cubemapLoad(cubemap: BoundGodotCubemapDocument): TargetGodotImportedLoad | string {
  const params = cubemap.importParams;
  if (!SOURCE_IMAGE_COMPRESS_MODES.has(params.compressMode)) return `compress/mode=${String(params.compressMode)} is not drawn from the source image`;
  if (params.mipmaps) return 'cubemap mipmaps are not generated';
  return { sourceResPath: cubemap.resPath, options: { arrangement: params.arrangement } };
}

/**
 * An external image's project path as Godot's importer resolves it: the URI file-decoded
 * (`String::uri_file_decode`, `%XX` only), joined to the model's directory and simplified; one
 * outside the project is none.
 */
function externalImagePath(modelResPath: string, uri: string): string | undefined {
  const decoded = uri.replace(/(?:%[0-9a-fA-F]{2})+/gu, (run) =>
    new TextDecoder().decode(Uint8Array.from(run.slice(1).split('%'), (hex) => Number.parseInt(hex, 16))),
  );
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(modelResPath.slice('res://'.length)), decoded.replace(/\\/gu, '/')));
  if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) return undefined;
  return `res://${relative}`;
}

function textureLoad(texture: BoundGodotTextureDocument): TargetGodotImportedLoad | string {
  const params = texture.importParams;
  if (!SOURCE_IMAGE_COMPRESS_MODES.has(params.compressMode ?? 0)) return `compress/mode=${String(params.compressMode)} is not drawn from the source image`;
  if (params.channelRemap !== undefined && params.channelRemap.join() !== '0,1,2,3') return 'a channel remap is not applied';
  if (params.normalMapInvertY === true || params.normalMap === 1) return 'normal-map processing is not applied';
  if (params.hdrClampExposure === true) return 'HDR exposure clamping is not applied';
  if ((params.sizeLimit ?? 0) !== 0) return 'a size limit is not applied';
  if (params.mipmapsGenerate === true && (params.roughnessMode ?? 0) > 1) return 'roughness mipmaps are not generated';
  return {
    sourceResPath: texture.resPath,
    options: {
      fixAlphaBorder: params.fixAlphaBorder ?? true,
      premultAlpha: params.premultAlpha ?? false,
      mipmaps: params.mipmapsGenerate ?? false,
    },
  };
}

export interface TargetGodotScenePropertyPlan {
  readonly propertyName: string;
  readonly targetKind: TargetScenePropertyKind;
  readonly value: readonly number[];
}

/**
 * An authored `[connection]`: when the scene mounts, `fromNodePath`'s signal (through its compat
 * accessor) calls `method` on `toNodePath`'s script instance with the signal's arguments.
 */
export interface TargetGodotSceneConnectionPlan {
  readonly signal: string;
  readonly fromNodePath: string;
  readonly toNodePath: string;
  readonly method: string;
  readonly accessor: { readonly module: string; readonly exportName: string; readonly named: boolean };
  /** The signal's argument count, each passed on to the method. */
  readonly arguments: number;
  /**
   * Who connects the method as a callback (`scene-signal-delivery.ts`): the script's own
   * `useGodotScript` (`script-connections`) or the instance's `connections` prop (`instance-prop`);
   * else a connection to the signal (`useGodotConnection`).
   */
  readonly delivery?: 'script-connections' | 'instance-prop';
  /** For a delivered connection: the method's parameters, which its callback takes and passes on. */
  readonly methodParameters?: number;
}

export interface TargetGodotSceneDocumentPlan {
  readonly sourceResPath: string;
  readonly sourceDigest: string;
  readonly targetPath: string;
  readonly exportName: string;
  readonly root: TargetGodotSceneNodePlan;
  /** Resources the scene's setters pass, dependencies before the resources that use them. */
  readonly resources: readonly TargetGodotSceneResourcePlan[];
  /** Authored connections, in document order (the order `SceneState::instantiate` connects). */
  readonly connections: readonly TargetGodotSceneConnectionPlan[];
}

export interface GodotSceneDocumentPlan {
  readonly version: typeof GODOT_SCENE_DOCUMENT_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly sourceRevision: string;
  readonly scenes: readonly TargetGodotSceneDocumentPlan[];
}

/**
 * Why a scene does not plan. `structure` is a scene-structure rule this plan has not got;
 * `node-family` a node class without a scene-node rule (`subject` names the class); `property` a
 * node property without a property rule (`Class.property`); `resource` a property whose value is a
 * resource; `signal` a signal connection; `editable-children` an override or node authored inside
 * an instanced scene below its root.
 */
export type GodotSceneRefusalCategory =
  | 'structure'
  | 'node-family'
  | 'property'
  | 'resource'
  | 'signal'
  | 'editable-children';

export interface GodotSceneDocumentDiagnostic {
  readonly at: string;
  readonly message: string;
  readonly category?: GodotSceneRefusalCategory;
  readonly subject?: string;
}

export type GodotSceneDocumentResult =
  | { readonly kind: 'accepted-scene-documents'; readonly plan: GodotSceneDocumentPlan }
  | {
      readonly kind: 'refused-scene-documents';
      readonly diagnostics: readonly GodotSceneDocumentDiagnostic[];
    };

function targetPath(resPath: string): string {
  const relative = resPath.slice('res://'.length).replace(/\.(?:t)?scn$/u, '');
  return `src/scenes/${relative}.tsx`;
}

export function godotSceneExportName(resPath: string): string {
  const basename = resPath.slice(resPath.lastIndexOf('/') + 1).replace(/\.(?:t)?scn$/u, '');
  const words = basename.split(/[^A-Za-z0-9]+/u).filter((word) => word.length > 0);
  const joined = words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');
  return /^[A-Za-z_]/u.test(joined) ? `${joined}Scene` : `Scene${joined}`;
}

/**
 * A scene node's own nodes one level down: the nodes the scene places into an imported model
 * (`placements`, Godot children of the model's nodes, which come before the nodes the scene adds
 * at the model's root in tree order), then its children. Every walk over a scene plan's nodes
 * goes through this, so a placed node's script, unique name, connections and cameras count.
 */
export function godotSceneSubnodes<Node extends { readonly children: readonly Node[]; readonly placements?: readonly { readonly node: Node }[] }>(
  node: Node,
): readonly Node[] {
  return [...(node.placements ?? []).map((placed) => placed.node), ...node.children];
}

/** A node of a scene a ref can hold: a node the scene renders, or one of a model's own. */
export type GodotSceneHeldNode<Node> = { readonly kind: 'node'; readonly node: Node } | { readonly kind: 'model'; readonly holder: string; readonly at: string };

/**
 * The nodes of a scene a ref can hold, by path: its own tree and what it places under a model's
 * nodes (not a collision shape, which is its body's collider), and each imported model's own nodes,
 * which the model's element hands over by their path in the model (`GodotImportedScene`'s `refs`).
 */
export function godotSceneHeldNodes<
  Node extends {
    readonly nodePath: string;
    readonly children: readonly Node[];
    readonly placements?: readonly { readonly node: Node }[];
    readonly model?: { readonly nodes: readonly { readonly path: string }[] };
    readonly idiom?: { readonly form: { readonly kind: string } };
  },
>(root: Node): ReadonlyMap<string, GodotSceneHeldNode<Node>> {
  const held = new Map<string, GodotSceneHeldNode<Node>>();
  // A path a model's node and a placed node both claim is held by neither: which one `get_node`
  // finds depends on the order the tree mounts them.
  const claimed = new Set<string>();
  const claim = (path: string, entry: GodotSceneHeldNode<Node> | undefined): void => {
    if (claimed.has(path)) held.delete(path);
    else if (entry !== undefined) held.set(path, entry);
    claimed.add(path);
  };
  const collect = (node: Node): void => {
    claim(node.nodePath, node.idiom?.form.kind === 'collider' ? undefined : { kind: 'node', node });
    for (const inner of node.model?.nodes ?? []) {
      claim(node.nodePath === '.' ? inner.path : `${node.nodePath}/${inner.path}`, { kind: 'model', holder: node.nodePath, at: inner.path });
    }
    for (const child of godotSceneSubnodes(node)) collect(child);
  };
  collect(root);
  return held;
}

export function godotSceneTargetPath(resPath: string): string {
  return targetPath(resPath);
}

/**
 * Whether a value on a node this document copied from an instanced scene is the instanced node's
 * own value: equal, with a resource reference on the copy naming the instanced document's resource
 * under the id instance expansion gave it.
 */
function sameValue(copy: GodotValue | undefined, origin: GodotValue | undefined): boolean {
  if (copy === undefined || origin === undefined) return copy === origin;
  if (
    copy.kind === 'ctor' &&
    origin.kind === 'ctor' &&
    copy.name === origin.name &&
    (copy.name === 'ExtResource' || copy.name === 'SubResource')
  ) {
    const [copyId] = copy.args;
    const [originId] = origin.args;
    if (copyId?.kind === 'string' && originId?.kind === 'string' && isImportedResourceId(copyId.value, originId.value)) {
      return true;
    }
  }
  return JSON.stringify(copy) === JSON.stringify(origin);
}

function sameProperties(
  copy: Readonly<Record<string, GodotValue>>,
  origin: Readonly<Record<string, GodotValue>>,
): boolean {
  const names = new Set([...Object.keys(copy), ...Object.keys(origin)]);
  return [...names].every((name) => sameValue(copy[name], origin[name]));
}

const f32 = Math.fround;

function numbers(args: readonly GodotValue[]): readonly number[] | undefined {
  const values = args.map((arg) => (arg.kind === 'number' ? arg.value : undefined));
  return values.every((value): value is number => value !== undefined) ? values : undefined;
}

/**
 * A serialized value as its target value. `Transform3D(xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy,
 * oz)` is written row by row (`VariantWriter`, core/variant/variant_parser.cpp:2111) and parsed as
 * `real_t`s into `Basis(rows)` (:894); the Object3D matrix is column-major, so element (r, c) is
 * `e[c * 4 + r]`, each component rounded to float as Godot stores it.
 */
function serializedValue(
  value: GodotValue,
): { readonly identity: SerializedScenePropertyIdentity; readonly value: readonly number[] } | undefined {
  if (value.kind === 'number') return { identity: 'number', value: [f32(value.value)] };
  if (value.kind !== 'ctor') return undefined;
  const args = numbers(value.args);
  if (args === undefined) return undefined;
  if (value.name === 'Vector3' && args.length === 3) {
    return { identity: 'ctor:Vector3(number,number,number)', value: args };
  }
  if ((value.name === 'Transform3D' || value.name === 'Transform') && args.length === 12) {
    const [xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz] = args.map(f32) as number[];
    return {
      identity: 'ctor:Transform3D(number*12)',
      value: [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, ox, oy, oz, 1] as number[],
    };
  }
  return undefined;
}

function isResourceValue(value: GodotValue): boolean {
  if (value.kind === 'ctor') {
    return (
      value.name === 'ExtResource' ||
      value.name === 'SubResource' ||
      value.args.some((arg) => isResourceValue(arg))
    );
  }
  if (value.kind === 'array') return value.items.some(isResourceValue);
  return false;
}

/** The resources of the document being planned, and those its setters have planned so far. */
interface DocumentResources {
  readonly scene: BoundGodotSceneDocument;
  /** Whether the project's scenes place a reflection probe (`PlanContext.reflected`). */
  readonly reflected: boolean;
  readonly planned: Map<string, TargetGodotSceneResourcePlan | null>;
  readonly order: TargetGodotSceneResourcePlan[];
}

interface PlanContext {
  /** The setter an authored property calls, when the code authority binds it. */
  readonly setters?: SceneSetterLookup;
  readonly project?: BoundGodotProject;
  document?: DocumentResources;
  /** Exported fields a script (and its script ancestors) declares: set by the field plan. */
  readonly scriptFields: (resPath: string) => ReadonlySet<string>;
  /** Functions a script (and its script ancestors) declares. */
  readonly scriptMethods: (resPath: string) => ReadonlySet<string>;
  /** Signals a script (and its script ancestors) declares, by name: each one's parameter count. */
  readonly scriptSignals: (resPath: string) => ReadonlyMap<string, number>;
  readonly authority: GodotSceneNodeAuthorityResolver;
  readonly scenes: ReadonlyMap<string, BoundGodotSceneDocument>;
  /** The imported models a scene's value names as a PackedScene: each gets a scene component of its own. */
  readonly modelScenes?: Set<string>;
  /**
   * Whether any of the project's scenes places a node written as a reflection probe: its lit
   * materials are then the reflections capability's (`scene-material-idioms.ts`), since a probe
   * lights every geometry inside its box, whichever scene the geometry comes from. The scenes are
   * the ones the game can reach: the read phase leaves out every scene nothing loads
   * (`read/reachability.ts`), over-approximating, so a probe in a scene only a path spelled in a
   * script reaches still counts, and one in a scene nothing names does not.
   */
  readonly reflected: boolean;
  readonly diagnostics: GodotSceneDocumentDiagnostic[];
}

function refuse(
  context: PlanContext,
  at: string,
  message: string,
  category: GodotSceneRefusalCategory,
  subject?: string,
): void {
  context.diagnostics.push({ at, message, category, ...(subject === undefined ? {} : { subject }) });
}

function structure(
  context: PlanContext,
  at: string,
  id: GodotSceneStructureRuleId,
): boolean {
  const rule = context.authority.structureRule(id);
  if (rule === undefined) {
    refuse(context, at, `no scene-structure rule for ${id}`, 'structure');
    return false;
  }
  return true;
}

/**
 * An authored value as the value its setter receives; a resource reference plans that resource
 * (constructed once per document, its own properties set by their setters).
 */
function setterValue(
  context: PlanContext,
  at: string,
  subject: string,
  value: GodotValue,
  scope: string,
): TargetGodotSceneValue | undefined {
  const target = targetSceneValue(value);
  if (target === undefined) {
    refuse(context, at, `a ${value.kind} value is not passed to a setter`, 'property', subject);
    return undefined;
  }
  return planSceneValue(context, at, target, scope);
}

/** A value with the resources it holds (at any depth) planned, each by its key. */
function planSceneValue(context: PlanContext, at: string, target: TargetSceneValue, scope: string): TargetGodotSceneValue | undefined {
  switch (target.kind) {
    case 'resource': {
      const key = planResource(context, at, target.reference, target.id, scope);
      return key === undefined ? undefined : { kind: 'resource', key };
    }
    case 'Variant-array': {
      const items = target.items.map((item) => planSceneValue(context, at, item, scope));
      return items.every((item): item is TargetGodotSceneValue => item !== undefined) ? { kind: 'Variant-array', items } : undefined;
    }
    case 'Variant-dictionary': {
      const entries: (readonly [TargetGodotSceneValue, TargetGodotSceneValue])[] = [];
      for (const [key, item] of target.entries) {
        const plannedKey = planSceneValue(context, at, key, scope);
        const plannedItem = planSceneValue(context, at, item, scope);
        if (plannedKey === undefined || plannedItem === undefined) return undefined;
        entries.push([plannedKey, plannedItem]);
      }
      return { kind: 'Variant-dictionary', entries };
    }
    default:
      return target;
  }
}

/**
 * Plans the resource a `SubResource`/`ExtResource` names: a sub-resource of the scene (or of the
 * `.tres` whose scope it is in), or a `.tres` resource document. Its class needs a resource rule
 * and each authored property a bound setter; its key, or undefined when it does not plan.
 */
function planResource(
  context: PlanContext,
  at: string,
  reference: 'sub' | 'ext',
  id: string,
  scope: string,
): string | undefined {
  const document = context.document;
  if (document === undefined) return undefined;
  let key: string;
  let data: BoundGodotResourceData | undefined;
  let nestedScope = scope;
  if (scope === '') {
    if (reference === 'sub') {
      key = `sub:${id}`;
      data = document.scene.subResources.find((entry) => String(entry.id) === id);
    } else {
      const ext = document.scene.extResources.find((entry) => String(entry.id) === id);
      key = `ext:${ext?.resPath ?? id}`;
      const resource = context.project?.documents.resources.find((entry) => entry.resPath === ext?.resPath);
      data = resource?.resource;
      nestedScope = ext?.resPath ?? '';
    }
  } else {
    const resource = context.project?.documents.resources.find((entry) => entry.resPath === scope);
    if (reference === 'sub') {
      key = `ext:${scope}#sub:${id}`;
      data = resource?.subResources.find((entry) => String(entry.id) === id);
    } else {
      const ext = resource?.extResources.find((entry) => String(entry.id) === id);
      key = `ext:${ext?.resPath ?? id}`;
      data = context.project?.documents.resources.find((entry) => entry.resPath === ext?.resPath)?.resource;
      nestedScope = ext?.resPath ?? '';
    }
  }
  return planResolvedResource(context, at, key, data, nestedScope);
}

/** Plans the `.tres` resource document at `resPath` (a resource no `ExtResource` names, such as an
 * imported model's external material), keyed as an `ExtResource` naming it is. */
function planResourceAt(context: PlanContext, at: string, resPath: string): string | undefined {
  const data = context.project?.documents.resources.find((entry) => entry.resPath === resPath)?.resource;
  return planResolvedResource(context, at, `ext:${resPath}`, data, resPath);
}

/** Plans a resource resolved to its key, its data (none for an imported file) and its own scope. */
/** The resource classes kept by their raw properties (`rawProperties`). */
const RAW_PROPERTY_CLASSES: ReadonlySet<string> = new Set(['TileSet', 'TileSetAtlasSource', 'TileSetScenesCollectionSource']);

function planResolvedResource(
  context: PlanContext,
  at: string,
  key: string,
  data: BoundGodotResourceData | undefined,
  nestedScope: string,
): string | undefined {
  const document = context.document;
  if (document === undefined) return undefined;
  if (document.planned.has(key)) return document.planned.get(key) === null ? undefined : key;
  document.planned.set(key, null);
  // An image the texture importer imports: a `CompressedTexture2D` loaded from its copied file.
  const texture = data === undefined ? context.project?.documents.textures.find((entry) => `ext:${entry.resPath}` === key) : undefined;
  // A sound the wav importer imports: an `AudioStreamWAV` loaded from its copied file.
  const sound = data === undefined && texture === undefined ? context.project?.documents.sounds.find((entry) => `ext:${entry.resPath}` === key) : undefined;
  // A cubemap the `cubemap_texture` importer imports: a `CompressedCubemap` sliced from its copy.
  const cubemap = data === undefined && texture === undefined && sound === undefined ? context.project?.documents.cubemaps.find((entry) => `ext:${entry.resPath}` === key) : undefined;
  // A sound the ogg_vorbis importer imports: an `AudioStreamOggVorbis` the browser decodes from its copy.
  const ogg = data === undefined ? context.project?.documents.oggVorbis.find((entry) => `ext:${entry.resPath}` === key) : undefined;
  // A font the `font_data_dynamic` importer imports: a `FontFile` of its copied file's bytes.
  const font = data === undefined ? context.project?.documents.fonts.find((entry) => `ext:${entry.resPath}` === key) : undefined;
  const imported =
    texture !== undefined
      ? { className: 'CompressedTexture2D', load: textureLoad(texture) }
      : sound !== undefined
        ? { className: 'AudioStreamWAV', load: soundLoad(sound) }
        : cubemap !== undefined
          ? { className: 'CompressedCubemap', load: cubemapLoad(cubemap) }
          : ogg !== undefined
            ? { className: 'AudioStreamOggVorbis', load: { sourceResPath: ogg.resPath, options: { loop: ogg.loop, loopOffset: ogg.loopOffset } } }
            : font !== undefined
              ? { className: 'FontFile', load: { sourceResPath: font.resPath, options: {} } }
              : undefined;
  // A `.gdshader`: the official shader frontend's tree, lowered.
  const boundShader = data === undefined && imported === undefined ? context.project?.documents.shaders.find((entry) => `ext:${entry.path}` === key) : undefined;
  if (boundShader !== undefined) {
    const lowered = shaderPlan(boundShader);
    const rule = context.authority.resourceRule('Shader');
    if (typeof lowered === 'string' || rule === undefined) {
      refuse(context, at, typeof lowered === 'string' ? `${key}: ${lowered}` : 'no resource rule constructs Shader', 'resource', 'Shader');
      return undefined;
    }
    const planned = { key, className: 'Shader', construct: rule.construct, shader: lowered, setters: [] };
    recordResource(document, key, planned);
    return key;
  }
  if (imported !== undefined) {
    const { className, load } = imported;
    const rule = context.authority.resourceRule(className);
    if (typeof load === 'string' || rule === undefined) {
      refuse(context, at, typeof load === 'string' ? `${key}: ${load}` : `no resource rule constructs ${className}`, 'resource', className);
      return undefined;
    }
    const planned = { key, className, construct: rule.construct, load, setters: [] };
    recordResource(document, key, planned);
    return key;
  }
  // A scene: a `.tscn`, or an imported model, which `instantiate()` mounts as its component.
  const scene = data === undefined && imported === undefined && key.startsWith('ext:') ? context.scenes.get(key.slice('ext:'.length)) : undefined;
  if (scene !== undefined) {
    let model: { readonly images: readonly { readonly index: number; readonly load: TargetGodotImportedLoad }[] } | undefined;
    if (scene.sourceKind === 'imported-gltf') {
      context.modelScenes?.add(scene.resPath);
      const images = modelImages(context, at, scene.resPath, scene.model?.externalImages ?? []);
      if (images === undefined) return undefined;
      model = { images };
    }
    const rootScript = scene.nodes.find((node) => node.nodePath === '.')?.scriptResPath;
    const planned = {
      key,
      className: 'PackedScene',
      construct: { module: 'lib/godot-compat/packed-scene-instance', exportName: 'godot_packed_scene_preload' },
      packedScene: { resPath: scene.resPath, ...(rootScript === undefined ? {} : { rootScript }), ...(model === undefined ? {} : { model }) },
      setters: [],
    };
    recordResource(document, key, planned);
    return key;
  }
  if (data === undefined) {
    refuse(context, at, `${key} is not a resource this scene or a .tres declares`, 'resource', 'external resource');
    return undefined;
  }
  // A resource keeping its properties by names it makes up: each value by its name.
  if (RAW_PROPERTY_CLASSES.has(data.type)) {
    const rawRule = context.authority.resourceRule(data.type);
    if (rawRule === undefined) {
      refuse(context, at, `no resource rule constructs ${data.type}`, 'resource', data.type);
      return undefined;
    }
    const rawProperties: { readonly name: string; readonly value: TargetGodotSceneValue }[] = [];
    for (const [name, value] of Object.entries(data.properties)) {
      if (name === 'resource_name' || name === 'script') continue;
      const planned = setterValue(context, `${at}(${key}).${name}`, `${data.type}.${name}`, value, nestedScope);
      if (planned === undefined) return undefined;
      rawProperties.push({ name, value: planned });
    }
    const planned = { key, className: data.type, construct: rawRule.construct, rawProperties, setters: [] };
    recordResource(document, key, planned);
    return key;
  }
  // A resource of a script's class: its script's instance, its properties the script's fields.
  const scriptReference = referenceOf(data.properties['script']);
  if (scriptReference !== undefined) {
    const extResources = nestedScope === '' ? document.scene.extResources : (context.project?.documents.resources.find((entry) => entry.resPath === nestedScope)?.extResources ?? []);
    const scriptResPath = scriptReference.reference === 'ext' ? extResources.find((entry) => String(entry.id) === scriptReference.id)?.resPath : undefined;
    if (scriptResPath === undefined || !scriptResPath.endsWith('.gd')) {
      refuse(context, at, `${key}: its script is not a project script file`, 'resource', data.type);
      return undefined;
    }
    const fields: { readonly name: string; readonly value: TargetGodotSceneValue }[] = [];
    for (const [name, value] of Object.entries(data.properties)) {
      if (name === 'script' || name === 'resource_name' || name.startsWith('metadata/')) continue;
      const planned = setterValue(context, `${at}(${key}).${name}`, `${data.type}.${name}`, value, nestedScope);
      if (planned === undefined) return undefined;
      fields.push({ name, value: planned });
    }
    const planned = {
      key,
      className: data.type,
      construct: { module: 'lib/godot-compat/resource', exportName: 'godot_script_resource_new' },
      scriptResource: { scriptResPath, fields, ...(key.startsWith('ext:') && !key.includes('#') ? { path: key.slice('ext:'.length) } : {}) },
      setters: [],
    };
    recordResource(document, key, planned);
    return key;
  }
  // An engine material: every shader its class generates, captured from the pinned Godot and
  // lowered as a `.gdshader` is, each planned as a `Shader` its binding selects between.
  const generated = (context.project?.documents.engineShaders ?? []).filter((entry) => entry.materialClass === data.type);
  let engineShaders: Record<string, string> | undefined;
  if (generated.length > 0) {
    const lowerings = generated.map((shader) => ({ shader, lowered: shaderPlan(shader) }));
    const unlowered = lowerings.find((entry) => typeof entry.lowered === 'string');
    if (unlowered !== undefined) {
      refuse(context, `${at}(${key})`, `${data.type}'s generated shader ${unlowered.shader.path}: ${String(unlowered.lowered)}`, 'resource', data.type);
      return undefined;
    }
    const select = ENGINE_SHADER_SELECTORS[data.type];
    const shaderRule = context.authority.resourceRule('Shader');
    if (select === undefined || shaderRule === undefined) {
      refuse(context, `${at}(${key})`, select === undefined ? `no binding selects ${data.type}'s generated shaders` : 'no resource rule constructs Shader', 'resource', data.type);
      return undefined;
    }
    engineShaders = {};
    for (const { shader, lowered } of lowerings) {
      const shaderKey = `${key}#${shader.path}`;
      const planned = { key: shaderKey, className: 'Shader', construct: shaderRule.construct, shader: lowered as TargetGodotLoweredShader, setters: [] };
      recordResource(document, shaderKey, planned);
      engineShaders[select(shader.variant)] = shaderKey;
    }
  }
  const rule = context.authority.resourceRule(data.type);
  if (rule === undefined) {
    refuse(context, at, `no resource rule constructs ${data.type}`, 'resource', data.type);
    return undefined;
  }
  if (data.type === 'ArrayMesh') {
    const mesh = arrayMeshPlan(context, `${at}(${key})`, data, nestedScope);
    if (mesh === undefined) return undefined;
    const unjoined = godotArrayMeshRefusal(mesh);
    if (unjoined !== undefined) {
      refuse(context, `${at}(${key})`, `${unjoined} has no three geometry`, 'resource', 'ArrayMesh');
      return undefined;
    }
    const planned = { key, className: data.type, construct: rule.construct, mesh, setters: [] };
    recordResource(document, key, planned);
    return key;
  }
  if (data.type === 'AnimationNodeBlendTree') {
    const resources = nestedScope === '' ? document.scene.subResources : context.project?.documents.resources.find((entry) => entry.resPath === nestedScope)?.subResources;
    const graph = godotAnimationNodeData(data, (value) => {
      const reference = referenceOf(value);
      return reference?.reference === 'sub' ? resources?.find((entry) => String(entry.id) === reference.id) : undefined;
    });
    if (typeof graph === 'string') {
      refuse(context, `${at}(${key})`, graph, 'resource', 'AnimationNodeBlendTree');
      return undefined;
    }
    const planned = { key, className: data.type, construct: rule.construct, animationTree: graph, setters: [] };
    recordResource(document, key, planned);
    return key;
  }
  if (data.type === 'AnimationLibrary') {
    const animations = animationLibraryPlan(context, `${at}(${key})`, data, nestedScope);
    if (animations === undefined) return undefined;
    const planned = { key, className: data.type, construct: rule.construct, animations, setters: [] };
    recordResource(document, key, planned);
    return key;
  }
  if (data.type === 'MeshLibrary') {
    const library = meshLibraryPlan(context, `${at}(${key})`, data, nestedScope);
    if (library === undefined) return undefined;
    const unshaped = library.items.flatMap((item) => item.shapes).map((entry) => document.planned.get(entry.shape)?.className ?? '').find((className) => !godotMeshLibraryShapeClass(className));
    if (unshaped !== undefined) {
      refuse(context, `${at}(${key})`, `a ${unshaped} item shape has no collider`, 'resource', unshaped);
      return undefined;
    }
    const planned = { key, className: data.type, construct: rule.construct, library, setters: [] };
    recordResource(document, key, planned);
    return key;
  }
  const setters: TargetGodotSceneSetterPlan[] = [];
  let ok = true;
  for (const [propertyName, value] of Object.entries(data.properties)) {
    // A binary resource stores its null script (`resource_format_binary.cpp` writes every property).
    if (propertyName === 'script' && value.kind === 'null') continue;
    // A resource's name (`Resource::set_name`, `resource.cpp:189`) is the editor's label for it;
    // nothing draws or plays it, as an ArrayMesh's or an animation's is not carried either.
    if (propertyName === 'resource_name') continue;
    const setter = setterPlan(context, `${at}(${key}).${propertyName}`, data.type, propertyName, value, nestedScope);
    if (setter === undefined) ok = false;
    else setters.push(setter);
  }
  if (!ok) return undefined;
  const unstated = godotFamilyRefusal(data.type, 'resource', setters);
  if (unstated !== undefined) {
    refuse(context, `${at}(${key})`, unstated, 'property', `${data.type}.${unstated.split(' ')[0] ?? ''}`);
    return undefined;
  }
  const planned = { key, className: data.type, construct: rule.construct, ...(engineShaders === undefined ? {} : { engineShaders }), setters };
  recordResource(document, key, planned);
  return key;
}

/** A resource reference's `sub`/`ext` and id, as a text or binary document writes it. */
function referenceOf(value: GodotValue | undefined): { readonly reference: 'sub' | 'ext'; readonly id: string } | undefined {
  if (value?.kind !== 'ctor' || (value.name !== 'SubResource' && value.name !== 'ExtResource')) return undefined;
  const [id] = value.args;
  if (id === undefined || (id.kind !== 'string' && id.kind !== 'number')) return undefined;
  return { reference: value.name === 'SubResource' ? 'sub' : 'ext', id: id.kind === 'string' ? id.value : String(id.value) };
}

function transformArgs(value: GodotValue | undefined): readonly number[] | undefined {
  if (value?.kind !== 'ctor' || (value.name !== 'Transform3D' && value.name !== 'Transform') || value.args.length !== 12) return undefined;
  const args = numbers(value.args);
  return args?.map(f32);
}

/**
 * An `AnimationLibrary` as data (`AnimationLibrary::_set_data`, `animation_library.cpp:148`): its
 * `_data` names each animation, a resource of the same document, read as its data file writes it.
 */
function animationLibraryPlan(context: PlanContext, at: string, data: BoundGodotResourceData, scope: string): TargetGodotAnimationLibraryPlan | undefined {
  for (const [name, value] of Object.entries(data.properties)) {
    if (name === '_data' || name === 'resource_name' || (name === 'script' && value.kind === 'null')) continue;
    refuse(context, `${at}.${name}`, `AnimationLibrary.${name} is not translated`, 'property', `AnimationLibrary.${name}`);
    return undefined;
  }
  const entries = data.properties['_data'];
  if (entries !== undefined && entries.kind !== 'dict') {
    refuse(context, at, 'AnimationLibrary._data is not a dictionary', 'resource', 'AnimationLibrary');
    return undefined;
  }
  const animations: { name: string; animation: ReturnType<typeof godotAnimationData> & object }[] = [];
  for (const item of entries?.entries ?? []) {
    const reference = referenceOf(item.value);
    const document = context.document;
    const resources = scope === '' ? document?.scene.subResources : context.project?.documents.resources.find((entry) => entry.resPath === scope)?.subResources;
    const resource = reference?.reference === 'sub' ? resources?.find((entry) => String(entry.id) === reference.id) : undefined;
    if (resource === undefined || resource.type !== 'Animation') {
      refuse(context, `${at}/${item.key}`, 'an animation that is not a sub-resource of its document', 'resource', 'Animation');
      return undefined;
    }
    const animation = godotAnimationData(resource);
    if (typeof animation === 'string') {
      refuse(context, `${at}/${item.key}`, animation, 'resource', 'Animation');
      return undefined;
    }
    animations.push({ name: item.key, animation });
  }
  return { animations };
}

/**
 * A mixer's tracks resolved against this scene (`AnimationMixer::_update_caches`,
 * `animation_mixer.cpp:651`): from the root node (`..`, the mixer's parent), each value track's
 * node and property (a script's field, else the class's setter) and each method track's node and
 * the native methods its keys call (a script's own function is called by name); a 3D track names a
 * Node3D. Null when a track does not resolve.
 */
/** A node a track may name: its class and ancestry, and its script. */
interface AnimationTarget {
  readonly className: string;
  readonly ancestry: readonly string[];
  readonly scriptResPath?: string;
}

/** The document's own nodes as animation targets, by their path in the document. */
function documentTargets(context: PlanContext): (path: string) => AnimationTarget | undefined {
  const scene = context.document?.scene;
  return (path) => {
    const node = scene?.nodes.find((candidate) => candidate.nodePath === path);
    return node === undefined
      ? undefined
      : { className: node.class.nativeName, ancestry: node.class.nativeAncestry, ...(node.scriptResPath === undefined ? {} : { scriptResPath: node.scriptResPath }) };
  };
}

function animationBindings(
  context: PlanContext,
  at: string,
  mixerPath: string,
  setters: readonly TargetGodotSceneSetterPlan[],
  targets: (path: string) => AnimationTarget | undefined = documentTargets(context),
): TargetGodotAnimationBindingsPlan | undefined | null {
  const lookup = context.setters;
  if (lookup?.method === undefined) {
    refuse(context, at, 'no binding lookup for animation tracks', 'property', 'AnimationMixer tracks');
    return null;
  }
  const base = godotResolveNodePath(mixerPath, '..');
  const values = new Map<string, TargetGodotAnimationBindingsPlan['values'][number]['binding']>();
  const methods = new Map<string, TargetGodotAnimationBindingsPlan['methods'][number]>();
  let ok = true;
  const fail = (where: string, message: string, subject: string): void => {
    refuse(context, where, message, 'property', subject);
    ok = false;
  };
  for (const setter of setters) {
    if (setter.setter.exportName !== 'godot_animation_mixer_set_library' || setter.value.kind !== 'resource') continue;
    const library = context.document?.planned.get(setter.value.key)?.animations;
    for (const { name, animation } of library?.animations ?? []) {
      for (const track of animation.tracks) {
        if (!track.enabled) continue;
        const where = `${at}(${name}:${track.path})`;
        const { node: nodePath, subnames } = godotTrackPath(track.path);
        const targetPath = base === undefined ? undefined : godotResolveNodePath(base, nodePath === '' ? '.' : nodePath);
        const target = targetPath === undefined ? undefined : targets(targetPath);
        if (target === undefined) {
          fail(where, 'a track path that names no node of this scene', 'AnimationMixer track path');
          continue;
        }
        const className = target.className;
        if (track.type === 'value') {
          if (subnames.length !== 1) {
            fail(where, 'a value track without one property subname', 'AnimationMixer track path');
            continue;
          }
          const property = subnames[0] as string;
          if (values.has(track.path)) continue;
          if (target.scriptResPath !== undefined && context.scriptFields(target.scriptResPath).has(property)) {
            values.set(track.path, { field: property });
            continue;
          }
          const found = lookup(className, property);
          if (typeof found === 'string') {
            fail(where, found, `${className}.${property}`);
            continue;
          }
          values.set(track.path, {
            setter: { module: found.module, exportName: found.exportName, localName: found.localName },
            ...(found.index === undefined ? {} : { index: found.index }),
          });
        } else if (track.type === 'method') {
          if (subnames.length > 0) {
            fail(where, 'a method track on a resource', 'AnimationMixer track path');
            continue;
          }
          for (const [, , key] of track.keys) {
            const method = (key as { readonly method: string }).method;
            const id = `${track.path}\0${method}`;
            if (methods.has(id)) continue;
            // `Object::callp` tries the script instance first (`object.cpp:760`).
            if (target.scriptResPath !== undefined && context.scriptMethods(target.scriptResPath).has(method)) continue;
            const found = lookup.method(className, method);
            if (typeof found === 'string') {
              fail(where, found, `${className}.${method}`);
              continue;
            }
            methods.set(id, { path: track.path, method, binding: { module: found.module, exportName: found.exportName, localName: found.localName } });
          }
        } else if (!target.ancestry.includes('Node3D')) {
          fail(where, 'a transform track on a node that is not a Node3D', 'AnimationMixer track path');
        } else if (subnames.length > 1 || (subnames.length === 1 && !target.ancestry.includes('Skeleton3D'))) {
          fail(where, 'a transform track through a resource is not translated', 'AnimationMixer track path');
        }
      }
    }
  }
  if (!ok) return null;
  return { values: [...values].map(([path, binding]) => ({ path, binding })), methods: [...methods.values()] };
}

/** An AnimationTree's NodePath properties: the compat setter each is. */
const TREE_NODE_PATHS: Readonly<Record<string, { readonly module: string; readonly exportName: string }>> = {
  root_node: { module: 'lib/godot-compat/animation-mixer', exportName: 'set_root_node' },
  anim_player: { module: 'lib/godot-compat/animation-tree', exportName: 'set_animation_player' },
};

/**
 * An AnimationTree's own property: `parameters/<path>` (`AnimationTree::_set`, `:1057`, compat's
 * `godot_animation_tree_set`) or a NodePath (`root_node`, `anim_player`) as its setter's text; null
 * for another property.
 */
function treeProperty(context: PlanContext, at: string, propertyName: string, value: GodotValue): TargetGodotSceneSetterPlan | undefined | null {
  const parameter = /^parameters\/(.+)$/u.exec(propertyName);
  const path = TREE_NODE_PATHS[propertyName];
  if (parameter === null && path === undefined) return null;
  if (godotSceneNodeIdiom('AnimationTree') === undefined) {
    refuse(context, at, 'no scene-node rule writes AnimationTree', 'node-family', 'AnimationTree');
    return undefined;
  }
  if (parameter !== null) {
    if (value.kind !== 'number' && value.kind !== 'bool') {
      refuse(context, at, `a ${value.kind} tree parameter is not translated`, 'property', 'AnimationTree.parameters');
      return undefined;
    }
    return {
      propertyName,
      setter: { module: 'lib/godot-compat/animation-tree', exportName: 'godot_animation_tree_set', localName: 'godot_animation_tree_set' },
      index: parameter[1] as string,
      value: value.kind === 'number' ? { kind: 'number', value: value.value } : { kind: 'bool', value: value.value },
    };
  }
  const text = value.kind === 'ctor' && value.name === 'NodePath' && value.args[0]?.kind === 'string' ? value.args[0].value : value.kind === 'string' ? value.value : undefined;
  if (text === undefined || path === undefined) {
    refuse(context, at, 'a NodePath that is not text', 'property', `AnimationTree.${propertyName}`);
    return undefined;
  }
  return {
    propertyName,
    setter: { module: path.module, exportName: path.exportName, localName: path.exportName },
    value: { kind: 'string', value: text },
  };
}

/**
 * A mixer's `libraries/NAME` (`AnimationMixer::_set`, `animation_mixer.cpp:84`): the library under
 * that name, which compat's `godot_animation_mixer_set_library` sets.
 */
function mixerLibrary(context: PlanContext, at: string, name: string, value: GodotValue): TargetGodotSceneSetterPlan | undefined {
  if (godotSceneNodeIdiom('AnimationPlayer') === undefined) {
    refuse(context, at, 'no scene-node rule writes AnimationPlayer', 'node-family', 'AnimationPlayer');
    return undefined;
  }
  const target = setterValue(context, at, 'AnimationMixer.libraries', value, '');
  if (target === undefined) return undefined;
  if (target.kind !== 'resource' || context.document?.planned.get(target.key)?.className !== 'AnimationLibrary') {
    refuse(context, at, 'a library that is not an AnimationLibrary', 'resource', 'AnimationMixer.libraries');
    return undefined;
  }
  return {
    propertyName: `libraries/${name}`,
    setter: { module: 'lib/godot-compat/animation-mixer', exportName: 'godot_animation_mixer_set_library', localName: 'godot_animation_mixer_set_library' },
    index: name,
    value: target,
  };
}

/**
 * A `MeshLibrary` as data (`MeshLibrary::_set`, `mesh_library.cpp:41`): `item/N/name`, `mesh` (a
 * planned mesh resource), `mesh_transform`, `mesh_cast_shadow` and `shapes` (shape resources and
 * their transforms, alternating). An item's editor `preview` has no runtime drawer and its
 * `navigation_mesh_transform`/`navigation_layers` no navigation mesh to place; a navigation mesh
 * refuses, as does any other key.
 */
function meshLibraryPlan(context: PlanContext, at: string, data: BoundGodotResourceData, scope: string): TargetGodotMeshLibraryPlan | undefined {
  const items = new Map<number, { id: number; name: string; mesh?: string; meshTransform: readonly number[]; castShadow: number; shapes: { shape: string; transform: readonly number[] }[] }>();
  const previews: string[] = [];
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  for (const [name, value] of Object.entries(data.properties)) {
    if (name === 'resource_name' || (name === 'script' && value.kind === 'null')) continue;
    const match = /^item\/(\d+)\/(.+)$/u.exec(name);
    if (match === null) {
      refuse(context, `${at}.${name}`, `MeshLibrary.${name} is not translated`, 'property', `MeshLibrary.${name}`);
      return undefined;
    }
    const id = Number(match[1]);
    const field = match[2] as string;
    const item = items.get(id) ?? { id, name: '', meshTransform: identity, castShadow: 1, shapes: [] };
    items.set(id, item);
    const here = `${at}.${name}`;
    switch (field) {
      case 'name':
        item.name = value.kind === 'string' ? value.value : '';
        break;
      case 'mesh': {
        if (value.kind === 'null') break;
        const reference = referenceOf(value);
        const key = reference === undefined ? undefined : planResource(context, here, reference.reference, reference.id, scope);
        if (key === undefined) {
          if (reference === undefined) refuse(context, here, 'an item mesh that is not a resource', 'resource', 'MeshLibrary');
          return undefined;
        }
        item.mesh = key;
        break;
      }
      case 'mesh_transform': {
        const transform = transformArgs(value);
        if (transform === undefined) {
          refuse(context, here, 'an item mesh transform that is not a Transform3D', 'property', 'MeshLibrary.mesh_transform');
          return undefined;
        }
        item.meshTransform = transform;
        break;
      }
      case 'mesh_cast_shadow':
        item.castShadow = value.kind === 'number' ? value.value : 1;
        break;
      case 'shapes': {
        const entries = value.kind === 'array' ? value.items : [];
        if (value.kind !== 'array' || entries.length % 2 !== 0) {
          refuse(context, here, 'item shapes that are not shape and transform pairs', 'property', 'MeshLibrary.shapes');
          return undefined;
        }
        for (let index = 0; index < entries.length; index += 2) {
          const reference = referenceOf(entries[index]);
          const transform = transformArgs(entries[index + 1]);
          const shape = reference === undefined ? undefined : planResource(context, here, reference.reference, reference.id, scope);
          if (shape === undefined || transform === undefined) {
            if (reference === undefined || transform === undefined) refuse(context, here, 'an item shape that is not a shape resource and a Transform3D', 'property', 'MeshLibrary.shapes');
            return undefined;
          }
          item.shapes.push({ shape, transform });
        }
        break;
      }
      // The editor's thumbnail: the file it names is the library's, drawn by nothing.
      case 'preview': {
        const reference = referenceOf(value);
        if (reference?.reference === 'ext') {
          const owner = context.project?.documents.resources.find((entry) => entry.resPath === scope);
          const path = owner?.extResources.find((entry) => String(entry.id) === reference.id)?.resPath;
          if (path !== undefined) previews.push(path);
        }
        break;
      }
      // Navigation placement, with no navigation mesh to place.
      case 'navigation_mesh_transform':
      case 'navigation_layers':
        break;
      default:
        refuse(context, here, `MeshLibrary item ${field} is not translated`, 'property', `MeshLibrary.${field}`);
        return undefined;
    }
  }
  return { items: [...items.values()].sort((left, right) => left.id - right.id), previews };
}

/** `ARRAY_MESH_PRIMITIVE` (Godot 3's numbering, `read/array-mesh.ts`) to Godot 4's `PrimitiveType`. */
const GODOT4_PRIMITIVE: Readonly<Record<number, number>> = {
  [ARRAY_MESH_PRIMITIVE.POINTS]: 0,
  [ARRAY_MESH_PRIMITIVE.LINES]: 1,
  [ARRAY_MESH_PRIMITIVE.LINE_STRIP]: 2,
  [ARRAY_MESH_PRIMITIVE.TRIANGLES]: 3,
  [ARRAY_MESH_PRIMITIVE.TRIANGLE_STRIP]: 4,
};

/**
 * An `ArrayMesh` resource as data: its `_surfaces` decoded by the reader's transcription of
 * `RenderingServer::_get_array_from_surface`, each surface's material planned as a resource. Its
 * other stored properties are its name, the blend-shape mode (no surface carries blend shapes), its
 * shadow mesh (not drawn: three's shadow pass draws the mesh) and a null script; anything else
 * refuses.
 */
function arrayMeshPlan(context: PlanContext, at: string, data: BoundGodotResourceData, scope: string): TargetGodotArrayMeshPlan | undefined {
  for (const [name, value] of Object.entries(data.properties)) {
    if (name === '_surfaces' || name === 'resource_name' || name === 'blend_shape_mode') continue;
    // The shadow mesh (`ArrayMesh::set_shadow_mesh`, `mesh.cpp:2281`) is a cheaper copy of the same
    // surfaces the Compatibility renderer draws into the shadow map instead of the mesh
    // (`rasterizer_scene_gles3.cpp:287`); three's shadow pass draws the mesh itself, the same shape.
    if (name === 'shadow_mesh') continue;
    if (name === 'script' && value.kind === 'null') continue;
    refuse(context, `${at}.${name}`, `ArrayMesh.${name} is not translated`, 'property', name);
    return undefined;
  }
  let decoded: ReturnType<typeof readGodot4Surfaces>;
  try {
    decoded = readGodot4Surfaces(data.properties, at);
  } catch (error) {
    refuse(context, at, error instanceof Error ? error.message : String(error), 'resource', 'ArrayMesh');
    return undefined;
  }
  const surfaces: TargetGodotArrayMeshPlan['surfaces'][number][] = [];
  for (const surface of decoded) {
    if (surface.blendShapeCount > 0 || surface.bones !== undefined || surface.weights !== undefined) {
      refuse(context, `${at}#_surfaces/${String(surface.index)}`, 'a skinned or blend-shape surface is not translated', 'resource', 'ArrayMesh');
      return undefined;
    }
    let material: string | undefined;
    const ref = surface.materialRef;
    if (ref !== undefined && ref.kind !== 'null') {
      // A binary resource names its resources by index (`ExtResource(0)`), a text one by string id.
      const [id] = ref.kind === 'ctor' ? ref.args : [];
      const reference = ref.kind === 'ctor' && (ref.name === 'SubResource' || ref.name === 'ExtResource') && id !== undefined && (id.kind === 'string' || id.kind === 'number')
        ? { reference: ref.name === 'SubResource' ? ('sub' as const) : ('ext' as const), id: id.kind === 'string' ? id.value : String(id.value) }
        : undefined;
      if (reference === undefined) {
        refuse(context, at, 'a surface material that is not a resource reference', 'resource', 'ArrayMesh');
        return undefined;
      }
      material = planResource(context, at, reference.reference, reference.id, scope);
      if (material === undefined) return undefined;
    }
    const flat = (values: ArrayLike<number> | undefined): readonly number[] | undefined => (values === undefined ? undefined : Array.from(values));
    // The reader numbers primitives as Godot 3 did; Godot 4's `PrimitiveType` (`rendering_server_enums.h:208`).
    const primitive = GODOT4_PRIMITIVE[surface.primitive];
    if (primitive === undefined) {
      refuse(context, at, `a surface of primitive ${String(surface.primitive)} is not translated`, 'resource', 'ArrayMesh');
      return undefined;
    }
    surfaces.push({
      primitive,
      arrays: {
        vertex: flat(surface.positions),
        normal: flat(surface.normals),
        tangent: flat(surface.tangents),
        color: flat(surface.colors),
        tex_uv: flat(surface.uvs),
        tex_uv2: flat(surface.uv2s),
        index: flat(surface.indices),
      },
      ...(material === undefined ? {} : { material }),
    });
  }
  const name = data.properties['resource_name'];
  return { resourceName: name?.kind === 'string' ? name.value : '', surfaces };
}

/** One authored property of `className` (a node's or a resource's) as its setter's call. */
function setterPlan(
  context: PlanContext,
  at: string,
  className: string,
  propertyName: string,
  value: GodotValue,
  scope: string,
): TargetGodotSceneSetterPlan | undefined {
  const subject = `${className}.${propertyName}`;
  const found = context.setters?.(className, propertyName);
  if (found === undefined || typeof found === 'string') {
    refuse(context, at, found ?? `no setter lookup for ${propertyName}`, 'property', subject);
    return undefined;
  }
  if (!structure(context, at, 'property-setter')) return undefined;
  const target = setterValue(context, at, subject, value, scope);
  if (target === undefined) return undefined;
  return {
    propertyName,
    setter: { module: found.module, exportName: found.exportName, localName: found.localName },
    ...(found.index === undefined ? {} : { index: found.index }),
    value: target,
  };
}

function planProperties(
  context: PlanContext,
  node: BoundGodotSceneNode,
  properties: Readonly<Record<string, GodotValue>>,
  setters?: TargetGodotSceneSetterPlan[],
): readonly TargetGodotScenePropertyPlan[] | undefined {
  const result: TargetGodotScenePropertyPlan[] = [];
  let refused = false;
  for (const [propertyName, value] of Object.entries(properties)) {
    const at = `${node.documentPath}#${node.nodePath}.${propertyName}`;
    // An AnimationTree's parameters (`AnimationTree::_set`, animation_tree.cpp:1057) and paths.
    if (node.class.nativeAncestry.includes('AnimationTree') && setters !== undefined) {
      const treeSetter = treeProperty(context, at, propertyName, value);
      if (treeSetter !== null) {
        if (treeSetter === undefined) refused = true;
        else setters.push(treeSetter);
        continue;
      }
    }
    // A mixer's `libraries/NAME` (`AnimationMixer::_set`, animation_mixer.cpp:84): a library, no setter's.
    const library = /^libraries\/(.*)$/u.exec(propertyName);
    if (library !== null && node.class.nativeAncestry.includes('AnimationMixer') && setters !== undefined) {
      const planned = mixerLibrary(context, at, library[1] as string, value);
      if (planned === undefined) refused = true;
      else setters.push(planned);
      continue;
    }
    // A GridMap's `data` (`GridMap::_set`, grid_map.cpp:64): its cells, no setter's.
    if (propertyName === 'data' && node.class.nativeAncestry.includes('GridMap') && setters !== undefined) {
      const cells = gridMapData(context, at, value);
      if (cells === undefined) refused = true;
      else setters.push(cells);
      continue;
    }
    if (isResourceValue(value) && setters === undefined) {
      refuse(context, at, `${propertyName} is a resource value`, 'resource', `${node.class.nativeName}.${propertyName}`);
      refused = true;
      continue;
    }
    const serialized = isResourceValue(value) ? undefined : serializedValue(value);
    // A property belongs to the class in the ancestry that declares it (ClassDB::set).
    const rule =
      serialized === undefined
        ? undefined
        : node.class.nativeAncestry
            .map((className) =>
              context.authority.propertyRule(
                `${node.class.nativeCanonicalIdentity.slice(0, node.class.nativeCanonicalIdentity.lastIndexOf('\0'))}\0${className}`,
                propertyName,
                serialized.identity,
              ),
            )
            .find((candidate) => candidate !== undefined);
    if ((rule === undefined || serialized === undefined) && setters !== undefined) {
      // No JSX rule: the property's setter, called on the entity at mount.
      const setter = setterPlan(context, at, node.class.nativeName, propertyName, value, '');
      if (setter === undefined) refused = true;
      else setters.push(setter);
      continue;
    }
    if (rule === undefined || serialized === undefined) {
      refuse(
        context,
        at,
        serialized === undefined
          ? `serialized ${value.kind} value has no scene-property identity`
          : `no scene-property rule for ${propertyName} receiving ${serialized.identity}`,
        'property',
        `${node.class.nativeName}.${propertyName}`,
      );
      refused = true;
      continue;
    }
    result.push({
      propertyName,
      targetKind: rule.targetKind,
      value: serialized.value,
    });
  }
  return refused ? undefined : result;
}

function placement(
  context: PlanContext,
  node: BoundGodotSceneNode,
): { readonly parentNodePath?: string } | undefined {
  if (node.placement.kind !== 'child') return {};
  const rule = context.authority.placementRule('child');
  if (rule === undefined) {
    refuse(context, `${node.documentPath}#${node.nodePath}`, 'no scene placement rule for a child node', 'structure');
    return undefined;
  }
  return { parentNodePath: node.placement.parentNodePath };
}

function groupsOf(context: PlanContext, node: BoundGodotSceneNode): readonly string[] | undefined {
  if (node.groups.length === 0) return [];
  return structure(context, `${node.documentPath}#${node.nodePath}`, 'node-groups') ? node.groups : undefined;
}

/**
 * A GridMap's `data` as the cells compat reads (`godot_grid_map_set_data`): the packed ints as
 * written, once the reader's transcription of `GridMap::_set` accepts them.
 */
function gridMapData(context: PlanContext, at: string, value: GodotValue): TargetGodotSceneSetterPlan | undefined {
  if (godotSceneNodeIdiom('GridMap') === undefined) {
    refuse(context, at, 'no scene-node rule writes GridMap', 'node-family', 'GridMap');
    return undefined;
  }
  try {
    readGridMapCells(value, at);
  } catch (error) {
    refuse(context, at, error instanceof GridMapReadError ? error.message : String(error), 'property', 'GridMap.data');
    return undefined;
  }
  const cells = value.kind === 'dict' ? value.entries.find((entry) => entry.key === 'cells')?.value : undefined;
  const ints = cells?.kind === 'ctor' ? cells.args.map((arg) => (arg.kind === 'number' ? arg.value : 0)) : [];
  return {
    propertyName: 'data',
    setter: { module: 'lib/godot-compat/grid-map', exportName: 'godot_grid_map_set_data', localName: 'godot_grid_map_set_data' },
    value: { kind: 'PackedInt32Array', components: ints },
    written: 'cells-file',
  };
}

/** A node the document authors itself: a native entity of its class. */
/** Whether an authored field value is plain, the field plan's to hand (a number, text, a node path). */
function plainFieldValue(value: GodotValue): boolean {
  return value.kind === 'number' || value.kind === 'bool' || value.kind === 'string' || (value.kind === 'ctor' && value.name === 'NodePath');
}

/**
 * A node's script fields whose authored values are not plain, each planned (`fieldValues`): the
 * values its scene authors for the fields of the script chain attached there.
 */
function planFieldValues(
  context: PlanContext,
  node: BoundGodotSceneNode,
): readonly { readonly field: string; readonly value: TargetGodotSceneValue }[] | undefined {
  const planned: { readonly field: string; readonly value: TargetGodotSceneValue }[] = [];
  const seen = new Set<string>();
  for (const script of context.project?.scripts ?? []) {
    for (const field of script.fields) {
      if (seen.has(field.name)) continue;
      const attachment = field.attachmentValues.find(
        (entry) => entry.documentPath === node.documentPath && entry.nodePath === node.nodePath && entry.source === 'authored-value' && entry.valueKind === 'value',
      );
      const value = attachment?.authoredValue;
      if (value === undefined || plainFieldValue(value)) continue;
      seen.add(field.name);
      const target = setterValue(context, `${node.documentPath}#${node.nodePath}.${field.name}`, field.name, value, '');
      if (target === undefined) return undefined;
      planned.push({ field: field.name, value: target });
    }
  }
  return planned;
}

function planNativeNode(context: PlanContext, node: BoundGodotSceneNode): TargetGodotSceneNodePlan | undefined {
  const at = `${node.documentPath}#${node.nodePath}`;
  let ok = true;
  // An AnimationTree's `root_node` and `anim_player` are its setters' paths (`treeNodePath`).
  const tree = node.class.nativeAncestry.includes('AnimationTree');
  // A script field's node path is the field plan's (`useGodotNodeReferences`).
  const scriptFields = node.scriptResPath === undefined ? new Set<string>() : context.scriptFields(node.scriptResPath);
  if (node.nodePathProperties.some((name) => !(tree && TREE_NODE_PATHS[name] !== undefined) && !scriptFields.has(name))) {
    refuse(context, at, 'authored NodePath properties are not planned', 'structure');
    ok = false;
  }
  if (node.instancePlaceholderResPath !== undefined) {
    refuse(context, at, 'instance placeholder is not planned', 'structure');
    ok = false;
  }
  // The idiom table is the one table of node classes the lane writes (`scene-node-idioms.ts`).
  const idiom = godotSceneNodeIdiom(node.class.nativeName);
  if (idiom === undefined) {
    refuse(context, at, `no scene-node rule writes ${node.class.nativeName}`, 'node-family', node.class.nativeName);
    ok = false;
  }
  const fields = node.scriptResPath === undefined ? new Set<string>() : context.scriptFields(node.scriptResPath);
  const setters: TargetGodotSceneSetterPlan[] = [];
  // `unique_name_in_owner` registers the node with its owner (`Node::set_unique_name_in_owner`).
  const uniqueValue = node.authoredProperties['unique_name_in_owner'];
  const unique = uniqueValue?.kind === 'bool' && uniqueValue.value;
  if (uniqueValue !== undefined && !structure(context, at, 'unique-name')) ok = false;
  const properties = planProperties(
    context,
    node,
    Object.fromEntries(
      Object.entries(node.authoredProperties).filter(([name]) => !fields.has(name) && name !== 'unique_name_in_owner'),
    ),
    setters,
  );
  const groups = groupsOf(context, node);
  const placed = placement(context, node);
  const fieldValues = planFieldValues(context, node);
  if (!ok || idiom === undefined || properties === undefined || groups === undefined || placed === undefined || fieldValues === undefined) {
    return undefined;
  }
  const unstated = godotFamilyRefusal(node.class.nativeName, 'node', setters);
  if (unstated !== undefined) {
    refuse(context, at, unstated, 'property', `${node.class.nativeName}.${unstated.split(' ')[0] ?? ''}`);
    return undefined;
  }
  const animation = node.class.nativeAncestry.includes('AnimationMixer') ? animationBindings(context, at, node.nodePath, setters) : undefined;
  if (animation === null) return undefined;
  return {
    nodePath: node.nodePath,
    ...(placed.parentNodePath === undefined ? {} : { parentNodePath: placed.parentNodePath }),
    name: node.name,
    idiom,
    ...(idiom.form.kind === 'light' ? { light: godotSceneLightPlan(setters, idiom.form.directional) } : {}),
    ...(node.scriptResPath === undefined ? {} : { scriptResPath: node.scriptResPath }),
    properties,
    groups,
    classes: node.class.nativeAncestry,
    ...(unique ? { unique: true as const } : {}),
    ...(fieldValues.length === 0 ? {} : { fieldValues }),
    setters,
    ...(animation === undefined ? {} : { animation }),
    children: [],
  };
}

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

/**
 * The importer's clips as an AnimationLibrary's data, in the importer's (glTF) order; the reader
 * already baked the root scale into their position keys.
 */
function importedLibrary(clips: readonly ImportedClip[]): TargetGodotAnimationLibraryPlan {
  const TYPES = { 1: 'position_3d', 2: 'rotation_3d', 3: 'scale_3d' } as const;
  return {
    animations: [...clips].sort((a, b) => a.gltfIndex - b.gltfIndex).map((clip) => ({
      name: clip.name,
      animation: {
        length: clip.length,
        loopMode: clip.loopMode,
        step: clip.step,
        tracks: clip.tracks.map((track) => ({
          type: TYPES[track.type],
          path: track.path,
          interp: track.interp,
          loopWrap: true,
          enabled: true,
          imported: true,
          update: 0,
          keys: track.keys.map(([time, transition, value]) => {
            if (value.length !== 3) return [time, transition, { Quaternion: value }] as const;
            return [time, transition, { Vector3: value }] as const;
          }),
        })),
      },
    })),
  };
}

/**
 * An instanced imported model (`.glb`): Godot's importer tree over the file (`imported-scene`), the
 * instance root's authored values as props, and room for this scene's edits inside it.
 */
/**
 * A model's images outside its file: each the project's imported texture at its path
 * (`GLTFDocument::_parse_images`, `gltf_document.cpp:2362`); one the project does not import as a
 * texture Godot reads as bytes instead, which is not transcribed.
 */
function modelImages(
  context: PlanContext,
  at: string,
  resPath: string,
  external: NonNullable<BoundGodotSceneDocument['model']>['externalImages'],
): { readonly index: number; readonly load: TargetGodotImportedLoad }[] | undefined {
  const images: { readonly index: number; readonly load: TargetGodotImportedLoad }[] = [];
  for (const image of external) {
    const resolved = externalImagePath(resPath, image.uri);
    const texture = resolved === undefined ? undefined : context.project?.documents.textures.find((entry) => entry.resPath === resolved);
    if (texture === undefined) {
      refuse(context, at, `${resPath}: images[${String(image.index)}] (${image.uri}) is not a texture the project imports`, 'resource', 'imported .glb');
      return undefined;
    }
    const load = textureLoad(texture);
    if (typeof load === 'string') {
      refuse(context, at, `${texture.resPath}: ${load}`, 'resource', 'CompressedTexture2D');
      return undefined;
    }
    images.push({ index: image.index, load });
  }
  return images;
}

function planImportedInstance(
  context: PlanContext,
  node: BoundGodotSceneNode,
  imported: BoundGodotSceneDocument,
): TargetGodotSceneNodePlan | undefined {
  const at = `${node.documentPath}#${node.nodePath}`;
  if (!structure(context, at, 'imported-scene')) return undefined;
  const model = imported.model;
  const root = imported.nodes.find((candidate) => candidate.nodePath === '.');
  if (model === undefined || root === undefined) {
    refuse(context, at, `${imported.resPath} has no imported model source`, 'node-family', 'imported .glb');
    return undefined;
  }
  const images = modelImages(context, at, imported.resPath, model.externalImages);
  if (images === undefined) return undefined;
  // The importer's external materials: the project's `.tres` in place of the file's own material
  // of that name, as the scene importer swaps it in (`resource_importer_scene.cpp`, `use_external`).
  const materials: { readonly name: string; readonly key: string }[] = [];
  for (const [materialName, resPath] of Object.entries(model.externalMaterials ?? {})) {
    const key = planResourceAt(context, `${at}(${imported.resPath} materials/${materialName})`, resPath);
    if (key === undefined) return undefined;
    materials.push({ name: materialName, key: planModelMaterial(context, key) });
  }
  const nodes: TargetGodotImportedModelNode[] = [];
  for (const member of imported.nodes) {
    if (member.nodePath === '.') continue;
    if (member.authoredProperties['visible'] !== undefined) {
      // A node the importer hid needs Node3D visibility, which compat does not bind yet.
      refuse(context, at, `${imported.resPath}: ${member.nodePath} is hidden by the importer`, 'property', 'Node3D.visible');
      return undefined;
    }
    const transform = member.authoredProperties['transform'];
    const matrix = transform === undefined ? undefined : serializedValue(transform)?.value;
    const gltfNode = model.nodeIndexByPath[member.nodePath];
    const bones = model.bonesByPath[member.nodePath];
    nodes.push({
      path: member.nodePath,
      name: member.name,
      classes: member.class.nativeAncestry,
      ...(member.class.nativeAncestry.includes('Node3D') ? {} : { nonSpatial: true as const }),
      ...(member.class.nativeAncestry.includes('AnimationPlayer') ? { animationPlayer: true as const } : {}),
      ...(member.class.nativeAncestry.includes('GeometryInstance3D') ? { geometryInstance: true as const } : {}),
      ...(gltfNode === undefined ? {} : { gltfNode }),
      matrix: matrix ?? IDENTITY_MATRIX,
      ...(bones === undefined ? {} : { bones }),
    });
  }
  // The importer's AnimationPlayer clips (`read/gltf-animation-import.ts`): a model whose clips
  // are not modelled refuses, its player (and any RESET the importer posed it with) unknown.
  const keys = model.animationKeys;
  if (typeof keys === 'string') {
    refuse(context, at, `${imported.resPath}: ${keys}`, 'resource', 'imported animations');
    return undefined;
  }
  const animations = Array.isArray(keys) ? importedLibrary(keys as readonly ImportedClip[]) : undefined;
  // The importer bakes its root scale into the nodes, bones, meshes, skins and animations
  // (`_apply_scale_to_scalable_node_collection`, `resource_importer_scene.cpp:599`). The reader
  // scales the nodes' positions and the bones' rest origins, the meshes are scaled as the file
  // loads and the position tracks' keys above; the skins' inverse bind matrices and the bones'
  // poses are the file's, unscaled, so a model with a skeleton and a root scale refuses.
  if (model.meshScale !== undefined && Object.keys(model.bonesByPath).length > 0) {
    refuse(context, at, `${imported.resPath}: the root scale of a model with a skeleton is not baked into its skins and bone poses`, 'resource', 'imported .glb');
    return undefined;
  }
  const properties = planProperties(context, node, node.authoredProperties);
  const placed = placement(context, node);
  if (properties === undefined || placed === undefined) return undefined;
  return {
    nodePath: node.nodePath,
    ...(placed.parentNodePath === undefined ? {} : { parentNodePath: placed.parentNodePath }),
    name: node.name,
    // A script on the model's root (an imported model's root has none of its own).
    ...(node.scriptResPath === undefined ? {} : { scriptResPath: node.scriptResPath }),
    model: {
      sourceResPath: imported.resPath,
      rootClasses: root.class.nativeAncestry,
      nodes,
      ...(images.length === 0 ? {} : { images }),
      ...(materials.length === 0 ? {} : { materials }),
      ...(animations === undefined ? {} : { animations }),
      ...(model.meshScale === undefined ? {} : { meshScale: model.meshScale }),
      overrides: [],
    },
    properties,
    groups: [],
    classes: [],
    setters: [],
    children: [],
  };
}

/**
 * The root of an instanced scene: that scene's generated component, the values this document
 * authors on it beyond the instanced root's own as its props (Godot applies them over the
 * instantiated root, packed_scene.cpp:400), and its name.
 */
function planInstanceRoot(
  context: PlanContext,
  node: BoundGodotSceneNode,
  instanced: BoundGodotSceneDocument,
): TargetGodotSceneNodePlan | undefined {
  const at = `${node.documentPath}#${node.nodePath}`;
  if (!structure(context, at, 'scene-instance')) return undefined;
  const origin = instanced.nodes.find((candidate) => candidate.nodePath === '.');
  if (origin === undefined) {
    refuse(context, at, `${instanced.resPath} has no root`, 'structure');
    return undefined;
  }
  let ok = true;
  const overrides = Object.fromEntries(
    Object.entries(node.authoredProperties).filter(
      ([name, value]) => !sameValue(value, origin.authoredProperties[name]),
    ),
  );
  // The root script's fields the instance overrides are the field plan's (its component's
  // `exports`); the rest are the root node's own properties.
  const fields = origin.scriptResPath === undefined ? new Set<string>() : context.scriptFields(origin.scriptResPath);
  for (const name of Object.keys(overrides)) if (fields.has(name)) delete overrides[name];
  if (Object.keys(overrides).length > 0 && !structure(context, at, 'instance-root-override')) ok = false;
  // A script on an instance whose root has none attaches to the component's root (its ref); one
  // replacing the root's own script is not planned.
  if (node.scriptResPath !== origin.scriptResPath && origin.scriptResPath !== undefined) {
    refuse(context, at, 'an instance root with its own script is not planned', 'structure');
    ok = false;
  }
  // Groups authored on the instance join its scene root's (`SceneState::instantiate` adds them to
  // the instantiated root, packed_scene.cpp:511).
  const groups = groupsOf(context, { ...node, groups: node.groups.filter((group) => !origin.groups.includes(group)) });
  if (groups === undefined) ok = false;
  if (node.nodePathProperties.some((name) => !origin.nodePathProperties.includes(name) && !fields.has(name))) {
    refuse(context, at, 'authored NodePath properties are not planned', 'structure');
    ok = false;
  }
  // Overrides without a JSX rule (a resource, say) are the instance root's setters.
  const setters: TargetGodotSceneSetterPlan[] = [];
  const properties = planProperties(context, node, overrides, setters);
  const placed = placement(context, node);
  const fieldValues = planFieldValues(context, node);
  if (!ok || properties === undefined || placed === undefined || fieldValues === undefined) return undefined;
  return {
    nodePath: node.nodePath,
    ...(placed.parentNodePath === undefined ? {} : { parentNodePath: placed.parentNodePath }),
    name: node.name,
    instance: { sourceResPath: instanced.resPath },
    // Its own script, where the base's root has none (the component's root carries it).
    ...(node.scriptResPath !== undefined && origin.scriptResPath === undefined ? { scriptResPath: node.scriptResPath } : {}),
    ...(fieldValues.length === 0 ? {} : { fieldValues }),
    properties,
    groups: groups ?? [],
    classes: [],
    setters,
    children: [],
  };
}

function isInside(path: string, root: string): boolean {
  return root === '.' ? path !== '.' : path.startsWith(`${root}/`);
}

/** `path` below `root` (both scene paths, `root` possibly the scene root `.`). */
function relativeTo(path: string, root: string): string {
  return root === '.' ? path : path.slice(root.length + 1);
}

function planScene(context: PlanContext, scene: BoundGodotSceneDocument): TargetGodotSceneDocumentPlan | undefined {
  context.document = { scene, reflected: context.reflected, planned: new Map(), order: [] };
  if (scene.sourceKind !== 'packed-scene') return undefined;
  if (!structure(context, scene.resPath, 'authored-order')) return undefined;
  // Instance roots: a node this document copied from another scene's root.
  const instanceRoots = new Map<string, BoundGodotSceneDocument>();
  const importedPlans = new Map<
    string,
    {
      readonly rootClasses: readonly string[];
      readonly nodes: readonly TargetGodotImportedModelNode[];
      readonly animated: boolean;
      readonly overrides: { at: string; setters: readonly TargetGodotSceneSetterPlan[]; animation?: TargetGodotAnimationBindingsPlan }[];
      readonly placedAt: Map<string, number>;
    }
  >();
  // Nodes this document placed under an imported model's nodes: their own children are ordinary.
  const placedUnderModels = new Set<string>();
  // Instance roots that refused: the edits inside them are that refusal's, not new ones.
  const refusedRoots = new Set<string>();
  const planned: TargetGodotSceneNodePlan[] = [];
  let refused = false;
  for (const authoredNode of scene.nodes) {
    // A node under a node this document placed in a model: the binder, which does not model the
    // imported tree, leaves its parent unresolved; the parent is that placed node.
    const node: BoundGodotSceneNode =
      authoredNode.placement.kind === 'unresolved-parent' &&
      placedUnderModels.has(authoredNode.placement.authoredParentPath)
        ? { ...authoredNode, placement: { kind: 'child', parentNodePath: authoredNode.placement.authoredParentPath } }
        : authoredNode;
    const at = `${scene.resPath}#${node.nodePath}`;
    const enclosing = [...instanceRoots.keys()].find((root) => isInside(node.nodePath, root));
    const importedEnclosing = enclosing === undefined ? undefined : importedPlans.get(enclosing);
    if (enclosing !== undefined && refusedRoots.has(enclosing)) {
      refused = true;
      continue;
    }
    const underPlaced = [...placedUnderModels].some((placedPath) => isInside(node.nodePath, placedPath));
    if (enclosing !== undefined && importedEnclosing !== undefined && !underPlaced) {
      // Inside an imported model: an override of one of its nodes is that node's setters, a node
      // placed under one of its nodes a portal into it. A scene instanced there (its root copied
      // from another scene's `.`) is neither.
      const relative = relativeTo(node.nodePath, enclosing);
      const origin =
        node.inheritedNode === undefined || node.inheritedNode.nodePath === '.'
          ? undefined
          : context.scenes
              .get(node.inheritedNode.documentPath)
              ?.nodes.find((candidate) => candidate.nodePath === node.inheritedNode?.nodePath);
      if (origin !== undefined) {
        const setters: TargetGodotSceneSetterPlan[] = [];
        let ok = structure(context, at, 'imported-scene-edits');
        const mixer = node.class.nativeAncestry.includes('AnimationMixer');
        for (const [propertyName, value] of Object.entries(node.authoredProperties)) {
          if (sameValue(value, origin.authoredProperties[propertyName])) continue;
          // A mixer's `libraries/NAME` (`AnimationMixer::_set`): a library, no setter's.
          const library = mixer ? /^libraries\/(.*)$/u.exec(propertyName) : null;
          const setter =
            library !== null
              ? mixerLibrary(context, `${at}.${propertyName}`, library[1] as string, value)
              : setterPlan(context, `${at}.${propertyName}`, node.class.nativeName, propertyName, value, '');
          if (setter === undefined) ok = false;
          else setters.push(setter);
        }
        // Its tracks name the model's nodes (by their path under the instance) and the scene's own.
        const model = importedEnclosing;
        const inModel = (path: string): AnimationTarget | undefined => {
          if (path === enclosing) {
            const own = scene.nodes.find((candidate) => candidate.nodePath === path);
            return { className: model.rootClasses[0] ?? 'Node3D', ancestry: model.rootClasses, ...(own?.scriptResPath === undefined ? {} : { scriptResPath: own.scriptResPath }) };
          }
          if (isInside(path, enclosing)) {
            const member = model.nodes.find((candidate) => candidate.path === relativeTo(path, enclosing));
            return member === undefined ? undefined : { className: member.classes[0] ?? 'Node', ancestry: member.classes };
          }
          return documentTargets(context)(path);
        };
        const animation = mixer ? animationBindings(context, at, node.nodePath, setters, inModel) : undefined;
        if (animation === null) ok = false;
        if (!ok) refused = true;
        else if (setters.length > 0) importedEnclosing.overrides.push({ at: relative, setters: setters.map((setter) => modelOverride(context, setter)), ...(animation === undefined || animation === null ? {} : { animation }) });
        continue;
      }
      const authoredParent =
        node.placement.kind === 'child'
          ? node.placement.parentNodePath
          : node.placement.kind === 'unresolved-parent'
            ? node.placement.authoredParentPath
            : undefined;
      if (authoredParent !== undefined && authoredParent !== enclosing && isInside(authoredParent, enclosing)) {
        const target = relativeTo(authoredParent, enclosing);
        const modelChildren = importedEnclosing.nodes.filter(
          (member) => member.path.lastIndexOf('/') >= 0 && member.path.slice(0, member.path.lastIndexOf('/')) === target,
        ).length;
        const placedBefore = importedEnclosing.placedAt.get(target) ?? 0;
        // Placed after the model's own children, in authored order, unless its index moves it
        // before them (`siblingIndex`).
        const moved = node.siblingIndex !== undefined && node.siblingIndex !== modelChildren + placedBefore ? node.siblingIndex : undefined;
        if (!importedEnclosing.nodes.some((member) => member.path === target)) {
          refuse(context, at, `${target} is not a node of the imported model`, 'editable-children');
          refused = true;
          continue;
        }
        // It takes its sibling index, and its children are this document's nodes under it,
        // whether or not it plans.
        importedEnclosing.placedAt.set(target, placedBefore + 1);
        placedUnderModels.add(node.nodePath);
        if (!structure(context, at, 'imported-scene-edits')) {
          refused = true;
          continue;
        }
        const { siblingIndex: _siblingIndex, ...unindexed } = node;
        const plannedNode = planNativeNode(context, { ...unindexed, placement: { kind: 'root' } });
        if (plannedNode === undefined) {
          refused = true;
          continue;
        }
        planned.push({ ...plannedNode, portal: { instanceNodePath: enclosing, at: target }, ...(moved === undefined ? {} : { siblingIndex: moved }) });
        continue;
      }
      // A node this document adds under the model's root is the root's child, and its own children
      // are ordinary (Godot adds them after instantiating the model, packed_scene.cpp:540).
      if (authoredParent === enclosing && node.inheritedNode === undefined) placedUnderModels.add(node.nodePath);
    }
    if (enclosing !== undefined && importedEnclosing === undefined && !underPlaced) {
      // Inside an instanced scene: its component renders the copied nodes; what this document
      // changes or adds there, below the instance root, is an editable-children edit.
      const instanced = instanceRoots.get(enclosing) as BoundGodotSceneDocument;
      const origin =
        node.inheritedNode === undefined
          ? undefined
          : context.scenes
              .get(node.inheritedNode.documentPath)
              ?.nodes.find((candidate) => candidate.nodePath === node.inheritedNode?.nodePath);
      if (origin !== undefined) {
        const changed =
          !sameProperties(node.authoredProperties, origin.authoredProperties) ||
          JSON.stringify(node.groups) !== JSON.stringify(origin.groups) ||
          node.scriptResPath !== origin.scriptResPath;
        if (changed) {
          refuse(context, at, `an override inside instanced ${instanced.resPath} is not planned`, 'editable-children');
          refused = true;
        }
        continue;
      }
      const parent = node.placement.kind === 'child' ? node.placement.parentNodePath : undefined;
      if (parent !== enclosing) {
        refuse(context, at, `a node placed inside instanced ${instanced.resPath} is not planned`, 'editable-children');
        refused = true;
        continue;
      }
      if (!structure(context, at, 'instance-children')) {
        refused = true;
        continue;
      }
    }
    if (node.placement.kind === 'unresolved-parent') {
      refuse(context, at, 'a node placed inside an instanced scene is not planned', 'editable-children');
      refused = true;
      continue;
    }
    // An explicit sibling position moves the node once added (`siblingIndex`, compat's `index`),
    // unless it is where the node was added: Godot moves it only to an index before its parent's
    // last child (packed_scene.cpp:545), and under a node this document authors itself, the
    // children before it are the ones planned before it.
    const parentPath = node.placement.kind === 'child' ? node.placement.parentNodePath : undefined;
    const ownParent = parentPath !== undefined && !instanceRoots.has(parentPath) && planned.some((entry) => entry.nodePath === parentPath && entry.instance === undefined && entry.model === undefined);
    const addedAt = planned.filter((entry) => entry.parentNodePath === parentPath && entry.portal === undefined).length;
    const place = <Planned extends TargetGodotSceneNodePlan>(plannedNode: Planned): Planned =>
      node.siblingIndex === undefined || (ownParent && node.siblingIndex >= addedAt) ? plannedNode : { ...plannedNode, siblingIndex: node.siblingIndex };
    const origin = node.inheritedNode;
    if (origin !== undefined && origin.nodePath === '.') {
      const instanced = context.scenes.get(origin.documentPath);
      // A scene inheriting its base (`[node ... instance=...]` at its root) is that base's
      // instance: its component with this scene's overrides and additions, never a copy.
      if (instanced?.sourceKind === 'imported-gltf') {
        instanceRoots.set(node.nodePath, instanced);
        const plannedRoot = planImportedInstance(context, node, instanced);
        if (plannedRoot === undefined || plannedRoot.model === undefined) {
          refused = true;
          refusedRoots.add(node.nodePath);
        } else {
          const overrides: { at: string; setters: readonly TargetGodotSceneSetterPlan[]; animation?: TargetGodotAnimationBindingsPlan }[] = [];
          importedPlans.set(node.nodePath, { rootClasses: plannedRoot.model.rootClasses, nodes: plannedRoot.model.nodes, animated: plannedRoot.model.animations !== undefined, overrides, placedAt: new Map() });
          planned.push(place({ ...plannedRoot, model: { ...plannedRoot.model, overrides } }));
        }
        continue;
      }
      if (instanced === undefined || instanced.sourceKind !== 'packed-scene') {
        instanceRoots.set(node.nodePath, instanced ?? scene);
        refuse(
          context,
          at,
          `an instanced ${instanced?.sourceKind ?? 'unread'} scene (${origin.documentPath}) has no scene-node rule`,
          'node-family',
          'instanced scene',
        );
        refused = true;
        continue;
      }
      instanceRoots.set(node.nodePath, instanced);
      const plannedRoot = planInstanceRoot(context, node, instanced);
      if (plannedRoot === undefined) {
        refused = true;
        refusedRoots.add(node.nodePath);
      }
      else planned.push(place(plannedRoot));
      continue;
    }
    if (origin !== undefined) {
      refuse(context, at, 'a node copied from an instanced scene outside it is not planned', 'structure');
      refused = true;
      continue;
    }
    const plannedNode = planNativeNode(context, node);
    if (plannedNode === undefined) refused = true;
    else planned.push(place(plannedNode));
  }
  // An AnimationTree blends its AnimationPlayer's libraries from the player's root node: its tracks
  // bind as the player's do (`AnimationTree::_setup_animation_player`, animation_tree.cpp:996).
  for (let index = 0; index < planned.length; index += 1) {
    const node = planned[index] as TargetGodotSceneNodePlan;
    if (!node.classes.includes('AnimationTree')) continue;
    const player = node.setters.find((entry) => entry.setter.exportName === 'set_animation_player');
    const playerPath = player?.value.kind === 'string' ? godotResolveNodePath(node.nodePath, player.value.value) : undefined;
    if (playerPath === undefined) continue;
    const own = planned.find((candidate) => candidate.nodePath === playerPath);
    const enclosing = [...importedPlans.keys()].find((root) => isInside(playerPath, root));
    const override = enclosing === undefined ? undefined : importedPlans.get(enclosing)?.overrides.find((entry) => entry.at === relativeTo(playerPath, enclosing));
    // An imported model's own clips (the importer's, `read/gltf-animation-import.ts`) are transform
    // tracks, which need no binding.
    if (enclosing !== undefined && importedPlans.get(enclosing)?.animated !== true && override?.setters.some((entry) => entry.setter.exportName === 'godot_animation_mixer_set_library' && entry.index === '') !== true) {
      refuse(context, `${scene.resPath}#${node.nodePath}`, `the animations of ${playerPath}, imported with its model, are not translated`, 'resource', 'imported animations');
      refused = true;
      continue;
    }
    const animation = own?.animation ?? override?.animation;
    if (animation !== undefined) planned[index] = { ...node, animation };
  }
  const connections = planConnections(context, scene, planned, instanceRoots);
  if (refused || connections === undefined) return undefined;
  const root = assembleSceneTree(context, scene, planned);
  if (root === undefined) return undefined;
  const document = {
    sourceResPath: scene.resPath,
    sourceDigest: scene.sourceDigest,
    targetPath: targetPath(scene.resPath),
    exportName: godotSceneExportName(scene.resPath),
    root,
    resources: context.document.order,
    connections,
  };
  // A Camera3D states `current` as the scene's default camera, which the camera first in tree order
  // is anyway (`Camera3D::_notification`, camera_3d.cpp:195, makes the first to enter current); a
  // later camera authored current has no element to say so.
  const cameras: TargetGodotSceneNodePlan[] = [];
  const findCameras = (node: TargetGodotSceneNodePlan): void => {
    if (node.classes[0] === 'Camera3D') cameras.push(node);
    for (const child of godotSceneSubnodes(node)) findCameras(child);
  };
  findCameras(root);
  const laterCurrent = cameras.slice(1).find((camera) =>
    camera.setters.some((entry) => entry.setter.exportName === 'set_current' && entry.value.kind === 'bool' && entry.value.value),
  );
  if (laterCurrent !== undefined) {
    refuse(context, `${scene.resPath}#${laterCurrent.nodePath}.current`, 'a Camera3D current after the first in tree order', 'property', 'Camera3D.current');
    return undefined;
  }
  // Every scene is written as idiomatic React Three Fiber (GODOT.md, "The output is idiomatic
  // three.js"); an instance's overrides are checked once its scene's root class is known.
  const refusal = idiomaticRefusal(document, () => PENDING_INSTANCE);
  if (refusal !== undefined) {
    refuse(context, scene.resPath, `the scene has no idiomatic form: ${refusal}`, 'node-family', refusal);
    return undefined;
  }
  if (!structure(context, scene.resPath, 'idiomatic-scene')) return undefined;
  return document;
}

const COLLISION_OBJECT_SETTERS = ['set_collision_layer', 'set_collision_mask', 'set_ray_pickable'];
const AXIS_LOCKS = [1, 2, 4, 8, 16, 32].map((axis) => `set_axis_lock:${String(axis)}`);

/**
 * The families the idiomatic scene writes (GODOT.md, "The output is idiomatic three.js"): each node
 * class's setters with a three, `@react-three/rapier` or Godot-only (`userData`) form, and each
 * resource class's.
 */
export const IDIOMATIC_NODE_SETTERS: Readonly<Record<string, readonly string[]>> = {
  Node: [],
  // A Node3D's `visible` is three's own (`node_3d.cpp:1120`); a body's has no Rapier prop, and a
  // collision shape mounts no object to hide.
  Node3D: ['set_visible'],
  StaticBody3D: [...COLLISION_OBJECT_SETTERS, 'set_physics_material_override'],
  RigidBody3D: [
    ...COLLISION_OBJECT_SETTERS,
    ...AXIS_LOCKS,
    'set_mass',
    'set_gravity_scale',
    'set_linear_damp',
    'set_angular_damp',
    'set_linear_damp_mode',
    'set_angular_damp_mode',
    'set_use_continuous_collision_detection',
    'set_lock_rotation_enabled',
    'set_use_custom_integrator',
    'set_contact_monitor',
    'set_max_contacts_reported',
    'set_physics_material_override',
  ],
  CharacterBody3D: [
    ...COLLISION_OBJECT_SETTERS,
    'set_velocity',
    'set_safe_margin',
    'set_floor_stop_on_slope_enabled',
    'set_floor_constant_speed_enabled',
    'set_floor_block_on_wall_enabled',
    'set_slide_on_ceiling_enabled',
    'set_motion_mode',
    'set_max_slides',
    'set_floor_max_angle',
    'set_floor_snap_length',
    'set_wall_min_slide_angle',
    'set_up_direction',
  ],
  Area3D: [...COLLISION_OBJECT_SETTERS, 'set_monitoring', 'set_monitorable'],
  CollisionShape3D: ['set_shape', 'set_disabled'],
  RayCast3D: [
    'set_visible',
    'set_enabled',
    'set_target_position',
    'set_collision_mask',
    'set_exclude_parent_body',
    'set_collide_with_areas',
    'set_collide_with_bodies',
    'set_hit_from_inside',
    'set_hit_back_faces',
    'set_debug_shape_custom_color',
  ],
  Marker3D: ['set_visible', 'set_gizmo_extents'],
};
const IDIOMATIC_RESOURCE_SETTERS: Readonly<Record<string, readonly string[]>> = {
  BoxShape3D: ['set_size'],
  SphereShape3D: ['set_radius'],
  CapsuleShape3D: ['set_radius', 'set_height'],
  ConvexPolygonShape3D: ['set_points'],
  ConcavePolygonShape3D: ['set_faces', 'set_backface_collision_enabled'],
  PhysicsMaterial: ['set_friction', 'set_bounce', 'set_rough', 'set_absorbent'],
};
const BODY_CLASSES = new Set(['StaticBody3D', 'RigidBody3D', 'CharacterBody3D', 'Area3D']);

/** The properties an imported model's element sets on the model's own nodes, and where each goes. */
const MODEL_OVERRIDE_SLOTS: Readonly<Record<string, GodotModelOverrideSlot>> = {
  // A mesh of the model's render layers (compat's `set_layer_mask`).
  set_layer_mask: { kind: 'layers' },
  // A mesh of the model's surface materials (compat's imported-scene overrides).
  set_surface_override_material: { kind: 'surface-material' },
  set_bone_pose_position: { kind: 'bone-pose', component: 'position' },
  set_bone_pose_rotation: { kind: 'bone-pose', component: 'rotation' },
  set_bone_pose_scale: { kind: 'bone-pose', component: 'scale' },
  // A Node3D of the model moved (compat's imported-scene `transform` override).
  set_transform: { kind: 'transform' },
  // An imported AnimationPlayer's (`<GodotImportedScene overrides>`, compat's player props).
  godot_animation_mixer_set_library: { kind: 'player' },
  set_autoplay: { kind: 'player' },
  set_active: { kind: 'player' },
  set_deterministic: { kind: 'player' },
  set_callback_mode_process: { kind: 'player' },
  set_callback_mode_method: { kind: 'player' },
  set_callback_mode_discrete: { kind: 'player' },
  set_speed_scale: { kind: 'player' },
  set_default_blend_time: { kind: 'player' },
  set_auto_capture: { kind: 'player' },
};

/** A spatial node's transform, as its matrix or as position, YXZ rotation and scale. */
const TRANSFORM_PROPERTIES = new Set(['transform', 'position', 'rotation', 'scale']);

/** An instance whose scene's root class is not known yet. */
const PENDING_INSTANCE = '(instanced scene)';

/**
 * The native class of a scene's root: its own, or for a scene inheriting its base (its root an
 * instance), the base's root class; an imported model's root class.
 */
export function godotSceneRootClass(
  scenes: ReadonlyMap<string, { readonly root: Pick<TargetGodotSceneNodePlan, 'classes' | 'instance' | 'model'> }>,
  resPath: string,
): string | undefined {
  const root = scenes.get(resPath)?.root;
  if (root === undefined) return undefined;
  if (root.instance !== undefined) return godotSceneRootClass(scenes, root.instance.sourceResPath);
  if (root.model !== undefined) return root.model.rootClasses[0];
  return root.classes[0];
}

/**
 * A setter on an imported model's own node, with the part of the model's element it sets; a surface
 * material there draws on the model's geometry (`planModelMaterial`).
 */
function modelOverride(context: PlanContext, setter: TargetGodotSceneSetterPlan): TargetGodotSceneSetterPlan {
  const modelSlot = MODEL_OVERRIDE_SLOTS[setter.setter.exportName];
  if (modelSlot === undefined) return setter;
  const value = modelSlot.kind === 'surface-material' && setter.value.kind === 'resource' ? { ...setter.value, key: planModelMaterial(context, setter.value.key) } : setter.value;
  return { ...setter, value, modelSlot };
}

/**
 * The planned material at `key` as it draws on an imported model's own geometry, whose UVs are
 * glTF's: its textures sampled as the model's own images are (`godotModelMaterialIdiom`), planned
 * once beside it as `<key>\0model`, so a Godot material drawn on both a model and three's own
 * geometry is two three materials. The material itself when it samples no texture or is not a
 * three material.
 */
function planModelMaterial(context: PlanContext, key: string): string {
  const document = context.document;
  const planned = document?.planned.get(key);
  if (document === undefined || planned === undefined || planned === null || planned.idiom?.kind !== 'material') return key;
  const idiom = godotModelMaterialIdiom(planned.idiom);
  if (idiom === planned.idiom) return key;
  const modelKey = `${key}\0model`;
  if (!document.planned.has(modelKey)) {
    const variant = { ...planned, key: modelKey, idiom };
    document.planned.set(modelKey, variant);
    document.order.push(variant);
  }
  return modelKey;
}

/** Records a planned resource with its library idiom. */
function recordResource(
  document: DocumentResources,
  key: string,
  resource: TargetGodotSceneResourcePlan,
): void {
  const idiom = godotSceneResourceIdiom(resource.className, resource.setters, document.reflected);
  const planned = idiom === undefined ? resource : { ...resource, idiom };
  document.planned.set(key, planned);
  document.order.push(planned);
}

/** The idiom of a scene's root node, through inherited scenes to the root they instance (or its model's root). */
export function godotSceneRootIdiom(
  scenes: ReadonlyMap<string, { readonly root: Pick<TargetGodotSceneNodePlan, 'idiom' | 'instance' | 'model'> }>,
  resPath: string,
): GodotSceneNodeIdiom | undefined {
  const root = scenes.get(resPath)?.root;
  if (root === undefined) return undefined;
  if (root.instance !== undefined) return godotSceneRootIdiom(scenes, root.instance.sourceResPath);
  if (root.model !== undefined) return godotSceneNodeIdiom(root.model.rootClasses[0] ?? '');
  return root.idiom;
}

/** A setter as the idiomatic tables name it: `set_axis_lock:8` for an indexed one. */
function setterName(entry: TargetGodotSceneSetterPlan): readonly string[] {
  return [entry.setter.exportName, `${entry.setter.exportName}:${String(entry.index)}`];
}

/**
 * Why a scene is not (yet) written idiomatically, or undefined when it is. `instanced` gives an
 * instanced scene's root class when that scene is idiomatic (its root's props are the instance's
 * overrides), else undefined.
 */
export function idiomaticRefusal(
  plan: Omit<TargetGodotSceneDocumentPlan, 'idiomatic'>,
  instanced: (resPath: string) => string | undefined,
): string | undefined {
  for (const resource of plan.resources) {
    // A carried family's resource plans only with the properties its element states.
    if (godotFamilyCarriesResource(resource.className)) continue;
    const allowed = IDIOMATIC_RESOURCE_SETTERS[resource.className];
    if (allowed === undefined) return `resource ${resource.className}`;
    const setter = resource.setters.find((entry) => !allowed.includes(entry.setter.exportName));
    if (setter !== undefined) return `${resource.className}.${setter.propertyName}`;
  }
  const walk = (node: TargetGodotSceneNodePlan, parentClass: string | undefined): string | undefined => {
    if (node.model !== undefined) {
      // An imported model: its root takes the transform only; the model's own nodes take the bone
      // poses its element states; the nodes placed under them are written as the scene's own.
      if (node.setters.length > 0 || node.properties.some((entry) => !TRANSFORM_PROPERTIES.has(entry.propertyName))) return `overrides on the imported model ${node.nodePath}`;
      const override = node.model.overrides.flatMap((entry) => entry.setters).find((entry) => entry.modelSlot === undefined);
      if (override !== undefined) return `the imported model's ${override.propertyName}`;
      if (node.groups.length > 0 || node.unique === true) return `groups or a unique name on the imported model ${node.nodePath}`;
      for (const placed of node.placements ?? []) {
        const refused = walk(placed.node, undefined);
        if (refused !== undefined) return refused;
      }
      for (const child of node.children) {
        const refused = walk(child, node.model.rootClasses[0]);
        if (refused !== undefined) return refused;
      }
      return undefined;
    }
    let className = node.classes[0];
    if (node.instance !== undefined) {
      className = instanced(node.instance.sourceResPath);
      if (className === undefined) return `${node.nodePath}: instanced ${node.instance.sourceResPath} is not idiomatic`;
    }
    if (className === undefined) return `node ${node.nodePath}`;
    // A carried family's node plans only with the properties its element states; before every
    // scene has planned, an instance's overrides are checked once its root's class is known.
    const carried = godotFamilyCarriesNode(className);
    const allowed =
      carried || className === PENDING_INSTANCE ? node.setters.map((entry) => setterName(entry)[0] as string) : IDIOMATIC_NODE_SETTERS[className];
    if (allowed === undefined) return `class ${className}`;
    if (className === 'CollisionShape3D' && (parentClass === undefined || !(BODY_CLASSES.has(parentClass) || parentClass === PENDING_INSTANCE))) {
      return 'a collision shape outside a body';
    }
    const property = carried ? undefined : node.properties.find((entry) => !TRANSFORM_PROPERTIES.has(entry.propertyName));
    if (property !== undefined) return `${className}.${property.propertyName}`;
    const setter = node.setters.find((entry) => !setterName(entry).some((name) => allowed.includes(name)));
    if (setter !== undefined) return `${className}.${setter.propertyName}`;
    for (const child of node.children) {
      const refused = walk(child, className);
      if (refused !== undefined) return refused;
    }
    return undefined;
  };
  const refused = walk(plan.root, undefined);
  if (refused !== undefined) return refused;
  // A connection is made between nodes the scene itself mounts (its refs), to a scripted target.
  const own = new Map<string, TargetGodotSceneNodePlan>();
  const collect = (node: TargetGodotSceneNodePlan): void => {
    own.set(node.nodePath, node);
    if (node.instance === undefined) for (const child of godotSceneSubnodes(node)) collect(child);
  };
  collect(plan.root);
  for (const connection of plan.connections) {
    if (!own.has(connection.fromNodePath)) return `a connection from ${connection.fromNodePath}, inside an instance`;
    if (own.get(connection.toNodePath)?.scriptResPath === undefined) return `a connection to ${connection.toNodePath}, which has no script here`;
  }
  return undefined;
}

/**
 * The instances' overrides, once every scene has planned: each is a prop of its scene's root,
 * whose class the instanced scene states.
 */
function checkInstanceOverrides(context: PlanContext, scenes: readonly TargetGodotSceneDocumentPlan[]): void {
  const byPath = new Map(scenes.map((scene) => [scene.sourceResPath, scene] as const));
  const rootClass = (resPath: string): string | undefined => godotSceneRootClass(byPath, resPath);
  for (const scene of scenes) {
    const refusal = idiomaticRefusal(scene, rootClass);
    if (refusal !== undefined) refuse(context, scene.sourceResPath, `the scene has no idiomatic form: ${refusal}`, 'node-family', refusal);
  }
}

/**
 * The document's connections (`SceneState::instantiate`, packed_scene.cpp:651): each between two
 * native nodes this scene mounts, to a function of the target's script, from a signal whose class
 * has a connection rule, with no binds, unbinds or flags beyond `CONNECT_PERSIST`.
 */
/** Whether a connection is one an instanced scene authors, copied into this document with it. */
function representedByInstance(
  connection: BoundGodotSceneDocument['connections'][number],
  instanceRoots: ReadonlyMap<string, BoundGodotSceneDocument>,
): boolean {
  const relative = (nodePath: string, root: string): string | undefined =>
    nodePath === root ? '.' : nodePath.startsWith(`${root}/`) ? nodePath.slice(root.length + 1) : undefined;
  for (const [root, instanced] of instanceRoots) {
    const from = relative(connection.from, root);
    const to = relative(connection.to, root);
    if (from === undefined || to === undefined) continue;
    return instanced.connections.some(
      (own) =>
        own.signal === connection.signal &&
        own.method === connection.method &&
        own.from === from &&
        own.to === to &&
        own.flags === connection.flags &&
        own.bindCount === connection.bindCount &&
        own.unbinds === connection.unbinds,
    );
  }
  return false;
}

function planConnections(
  context: PlanContext,
  scene: BoundGodotSceneDocument,
  planned: readonly TargetGodotSceneNodePlan[],
  instanceRoots: ReadonlyMap<string, BoundGodotSceneDocument>,
): readonly TargetGodotSceneConnectionPlan[] | undefined {
  // Either end may be an instanced scene's root: the ref its component forwards is that root.
  const mounted = new Map(planned.map((node) => [node.nodePath, node] as const));
  const bound = new Map(scene.nodes.map((node) => [node.nodePath, node] as const));
  let ok = true;
  const result: TargetGodotSceneConnectionPlan[] = [];
  for (const connection of scene.connections) {
    // The instanced scene's component makes its own connections.
    if (representedByInstance(connection, instanceRoots)) continue;
    const at = `${scene.resPath}#${connection.from}:${connection.signal}`;
    const from = mounted.get(connection.from);
    const to = mounted.get(connection.to);
    const fromClass = bound.get(connection.from)?.class;
    if (connection.flags !== 0 || connection.bindCount > 0 || connection.unbinds > 0) {
      refuse(context, at, 'connection flags, binds or unbinds are not planned', 'signal', 'connection options');
      ok = false;
      continue;
    }
    if (from === undefined || to === undefined || fromClass === undefined) {
      refuse(context, at, 'a connection with an end this scene does not mount natively is not planned', 'signal', 'connection end');
      ok = false;
      continue;
    }
    // An instance's script is its scene root's, which the bound node carries.
    const toScript = bound.get(connection.to)?.scriptResPath ?? to.scriptResPath;
    if (toScript === undefined || !context.scriptMethods(toScript).has(connection.method)) {
      refuse(context, at, `the target has no script function ${connection.method}`, 'signal', 'connection target');
      ok = false;
      continue;
    }
    const fromScript = bound.get(connection.from)?.scriptResPath;
    const scripted = fromScript === undefined ? undefined : context.scriptSignals(fromScript).get(connection.signal);
    const rule =
      context.authority.signalRule(fromClass.nativeAncestry, connection.signal) ??
      (scripted === undefined || context.authority.sourceRevision !== GODOT_4_7_SCRIPT_SIGNAL_RULE.sourceRevision ? undefined : { accessor: GODOT_4_7_SCRIPT_SIGNAL_RULE.accessor, arguments: scripted });
    if (rule === undefined) {
      refuse(
        context,
        at,
        `${fromClass.nativeName}.${connection.signal} has no connection rule`,
        'signal',
        `${fromClass.nativeName}.${connection.signal}`,
      );
      ok = false;
      continue;
    }
    result.push({
      signal: connection.signal,
      fromNodePath: connection.from,
      toNodePath: connection.to,
      method: connection.method,
      accessor: rule.accessor,
      arguments: rule.arguments,
    });
  }
  return ok ? result : undefined;
}

function assembleSceneTree(
  context: PlanContext,
  scene: BoundGodotSceneDocument,
  plannedNodes: readonly TargetGodotSceneNodePlan[],
): TargetGodotSceneNodePlan | undefined {
  const roots = plannedNodes.filter((node) => node.parentNodePath === undefined && node.portal === undefined);
  const portals = new Map<string, TargetGodotSceneNodePlan[]>();
  for (const node of plannedNodes) {
    if (node.portal === undefined) continue;
    const list = portals.get(node.portal.instanceNodePath) ?? [];
    list.push(node);
    portals.set(node.portal.instanceNodePath, list);
  }
  const root = roots[0];
  if (roots.length !== 1 || root === undefined) {
    refuse(context, scene.resPath, roots.length === 0 ? 'scene has no planned root' : 'scene has two roots', 'structure');
    return undefined;
  }
  // Children in document order, the order SceneState::instantiate adds them.
  const children = new Map<string, TargetGodotSceneNodePlan[]>();
  for (const node of plannedNodes) {
    if (node.parentNodePath === undefined) continue;
    const siblings = children.get(node.parentNodePath) ?? [];
    siblings.push(node);
    children.set(node.parentNodePath, siblings);
  }
  const reachable = new Set<string>();
  const attach = (node: TargetGodotSceneNodePlan): TargetGodotSceneNodePlan => {
    reachable.add(node.nodePath);
    const placements = (portals.get(node.nodePath) ?? []).map((placed) => ({
      at: (placed.portal as { readonly at: string }).at,
      node: attach(placed),
    }));
    return {
      ...node,
      children: (children.get(node.nodePath) ?? []).map(attach),
      ...(placements.length === 0 ? {} : { placements }),
    };
  };
  const result = attach(root);
  for (const node of plannedNodes) {
    if (!reachable.has(node.nodePath)) {
      refuse(context, `${scene.resPath}#${node.nodePath}`, 'planned parent is absent', 'structure');
    }
  }
  return reachable.size === plannedNodes.length ? result : undefined;
}

/** Pure scene translation from normalized bound facts; no source read, syntax, or emission. */
export function planGodotSceneDocuments(
  project: BoundGodotProject,
  sourceAuthority: GodotSceneNodeAuthority,
  setters?: SceneSetterLookup,
): GodotSceneDocumentResult {
  const authority = new GodotSceneNodeAuthorityResolver(sourceAuthority);
  if (authority.sourceRevision !== project.authority.revision) {
    throw new Error('bound Godot project and scene-node authority use different revisions');
  }
  const byScript = new Map(project.scripts.map((script) => [script.resPath, script] as const));
  const context: PlanContext = {
    ...(setters === undefined ? {} : { setters }),
    project,
    scriptFields: (resPath) => {
      const script = byScript.get(resPath);
      const names = new Set<string>();
      for (const scriptPath of [resPath, ...(script?.inheritance.scriptAncestors ?? [])]) {
        for (const field of byScript.get(scriptPath)?.fields ?? []) names.add(field.name);
      }
      return names;
    },
    scriptMethods: (resPath) => {
      const script = byScript.get(resPath);
      const names = new Set<string>();
      for (const scriptPath of [resPath, ...(script?.inheritance.scriptAncestors ?? [])]) {
        for (const method of byScript.get(scriptPath)?.class.methods ?? []) names.add(method.name);
      }
      return names;
    },
    scriptSignals: (resPath) => {
      const script = byScript.get(resPath);
      const signals = new Map<string, number>();
      for (const scriptPath of [resPath, ...(script?.inheritance.scriptAncestors ?? [])]) {
        for (const signal of byScript.get(scriptPath)?.class.signals ?? []) if (!signals.has(signal.name)) signals.set(signal.name, signal.parameters);
      }
      return signals;
    },
    authority,
    scenes: new Map(project.documents.scenes.map((scene) => [scene.resPath, scene] as const)),
    // `project.documents.scenes` are the reachable scenes (`read/reachability.ts`).
    reflected: project.documents.scenes.some((scene) => scene.nodes.some((node) => godotSceneNodeIdiom(node.class.nativeName)?.form.kind === 'reflection-probe')),
    modelScenes: new Set(),
    diagnostics: [],
  };
  const scenes = project.documents.scenes.flatMap((scene) => {
    const planned = planScene(context, scene);
    return planned === undefined ? [] : [planned];
  });
  // An imported model a value names as a PackedScene (`instantiate()`): a scene of its own whose
  // root instances the model, as a scene inheriting from the file is.
  const modelsPlanned = new Set<string>();
  for (let pending = [...(context.modelScenes ?? [])]; pending.length > 0; pending = [...(context.modelScenes ?? [])].filter((resPath) => !modelsPlanned.has(resPath))) {
    for (const resPath of pending) {
      modelsPlanned.add(resPath);
      const imported = context.scenes.get(resPath);
      const root = imported?.nodes.find((node) => node.nodePath === '.');
      if (imported === undefined || root === undefined) continue;
      const { scriptResPath: _script, ...rootNode } = root;
      const planned = planScene(context, {
        ...imported,
        sourceKind: 'packed-scene',
        nodes: [{ ...rootNode, documentPath: resPath, nodePath: '.', authoredProperties: {}, nodePathProperties: [], groups: [], instanceSceneResPath: resPath, inheritedNode: { documentPath: resPath, nodePath: '.' } }],
        subResources: [],
        extResources: [],
        connections: [],
        connectionCount: 0,
        subResourceCount: 0,
        editablePaths: [],
      });
      if (planned !== undefined) scenes.push(planned);
    }
  }
  const plannedPaths = new Set(scenes.map((scene) => scene.sourceResPath));
  // An instance of a scene that did not plan cannot mount its component.
  const missing = (node: TargetGodotSceneNodePlan): string[] => [
    ...(node.instance !== undefined && !plannedPaths.has(node.instance.sourceResPath)
      ? [node.instance.sourceResPath]
      : []),
    ...godotSceneSubnodes(node).flatMap(missing),
  ];
  for (const scene of scenes) {
    for (const resPath of missing(scene.root)) {
      refuse(context, scene.sourceResPath, `instanced ${resPath} did not plan`, 'structure', resPath);
    }
  }
  checkInstanceOverrides(context, scenes.filter((scene) => missing(scene.root).length === 0));
  const targetPaths = new Set<string>();
  for (const scene of scenes) {
    if (targetPaths.has(scene.targetPath)) {
      refuse(context, scene.sourceResPath, `duplicate target path ${scene.targetPath}`, 'structure');
    }
    targetPaths.add(scene.targetPath);
  }
  if (context.diagnostics.length > 0) {
    return { kind: 'refused-scene-documents', diagnostics: context.diagnostics };
  }
  return {
    kind: 'accepted-scene-documents',
    plan: {
      version: GODOT_SCENE_DOCUMENT_PLAN_VERSION,
      snapshotDigest: project.snapshotDigest,
      sourceRevision: project.authority.revision,
      scenes,
    },
  };
}

/** An imported model's data file: the importer's tree (`src/models/<path>.json`). */
export function godotImportedModelDataPath(resPath: string): string {
  return `src/models/${resPath.slice('res://'.length).replace(/[^A-Za-z0-9._/-]+/gu, '_')}.ts`;
}
