/**
 * read/godot-types.ts — the S0 reader's OUTPUT shape: a static, in-memory model of a Godot
 * project, parsed from `project.godot` plus every text-format file it can reach.
 *
 * This mirrors the role `rbx-analyze/src/read/datamodel-types.ts` plays for Rojo, and diverges
 * from it exactly where the two engines do:
 *
 * **There is no single project tree.** Roblox's DataModel is one rooted graph; a Godot project is
 * a SET of scene documents that reference each other. Once every document is parsed, readable
 * decoded PackedScenes are stamped into each owning document's effective tree so overrides bind
 * to real descendants. Source glTF model hosts, placeholders, cycles, and missing/opaque targets
 * retain their `instanceOf` boundary and a loud diagnostic; no absent tree is invented.
 *
 * **Scripts are absent here.** The official bound frontend owns their declarations, diagnostics,
 * symbols and operations; the read product cannot carry an alternate script representation.
 */
import type { GodotValue, ResourceId } from './godot-value';
import type { ImportSidecar } from './import-sidecar';
import type { ResolvedSetting } from './known-settings';
import type { ResourceKind } from './res-path';

/** A per-item problem. Never fatal: one unreadable resource must not cost the other 322. */
export interface Diagnostic {
  readonly severity: 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  /** Where the problem is — a `res://` path, optionally with `:<line>` or `#<node path>`. */
  readonly at: string;
}

/** An `[ext_resource]` line: another file this document depends on. */
export interface ExtResourceRef {
  /** Numeric on Godot 3, an opaque quoted token on Godot 4 — see {@link ResourceId}. */
  readonly id: ResourceId;
  /** Canonical logical `res://` path after exact relative/UID/import resolution. */
  readonly resPath: string;
  /** Godot 4's stable UID when the external-reference row carries one beside the path. */
  readonly uid?: string;
  /** Godot's own declared type for the reference (`PackedScene`, `Script`, `Texture`, …). */
  readonly type: string;
  /** What the reader can do with its backing bytes; importer remaps may make an opaque source
   * path readable as an exact binary document. */
  readonly kind: ResourceKind;
  /** True when the file exists in the tree being read. An `opaque` reference may legitimately be
   *  absent; a `text`/`script`/`binary` one may not. */
  readonly present: boolean;
}

/** A `[sub_resource]` block: a resource defined inline in the document. */
export interface SubResource {
  /** Numeric on Godot 3, an opaque quoted token on Godot 4 — see {@link ResourceId}. */
  readonly id: ResourceId;
  readonly type: string;
  readonly properties: Readonly<Record<string, GodotValue>>;
}

/** A GDScript authored inline as a scene `[sub_resource type="GDScript"]`.
 *
 * Godot gives this source no filesystem path, while every language/semantic/emit stage identifies
 * scripts by `res://` path. The reader therefore gives it a deterministic scene-local `.gd`
 * identity; it is provenance for the authored subresource, never a claim that a file exists. */
export interface InlineScriptResource {
  readonly resPath: string;
  readonly text: string;
}

/** One authored node of a scene's own tree. */
export interface SceneNode {
  readonly name: string;
  /** Godot's own node path spelling, relative to the scene root: `.` for the root, then
   *  `Sprites/Root/Body`. This is the key `[connection]` and `[editable]` use. */
  readonly path: string;
  /** Additional serialized path spellings proved by an imported/instanced source root. Godot may
   * address the same mounted node with or without that source root segment; expansion retains
   * both only when the opened source document proves the alias. Ambiguous aliases resolve to no
   * node rather than selecting by name. */
  readonly authoredPathAliases?: readonly string[];
  /**
   * The declared class, when the node declares one. A node that only OVERRIDES properties of a
   * node inside an instanced scene declares neither `type` nor `instance` — its class lives in
   * the scene it came from, and reporting a guess here would be fabrication.
   */
  readonly type?: string;
  /**
   * Renderer-local hierarchy seat synthesized while projecting a mixed-surface PackedScene.
   *
   * This is deliberately not a Godot class claim: the authored foreign-surface node and its
   * ScriptInstance live in the sibling projection. The selected renderer still needs one of its
   * own native entities at this path so retained descendants keep their authored parentage and
   * display identity.
   */
  readonly projectionCarrier?: 'canvas' | 'three';
  /** The `res://` path of the scene this node instantiates (`instance=ExtResource( n )`). */
  readonly instanceOf?: string;
  /**
   * Exact source node this typeless inherited/instanced declaration overrides.
   *
   * Unlike {@link instanceOf}, this is provenance only: readable-scene expansion consumes the
   * runtime instance edge after stamping the base tree, while this identity survives so class and
   * property lookup can continue through each derived scene without mounting the base again.
   */
  readonly inheritedNode?: InstancedParentOrigin;
  /** `instance_placeholder="res://…"`; never expanded because the packed tree is intentionally absent. */
  readonly instancePlaceholder?: string;
  /** Node.owner path: explicit when serialized, `.` when this PackedScene line implies the default. */
  readonly ownerPath?: string;
  /** Authored `[node]` order within the document, used to retain sibling order while splicing. */
  readonly sourceOrder?: number;
  /** Explicit Godot sibling `index=`, when authored. */
  readonly siblingIndex?: number;
  /** The external path or deterministic scene-local identity of the attached script resource. */
  readonly scriptPath?: string;
  readonly groups: readonly string[];
  /**
   * The `node_paths=PackedStringArray("target", …)` header attribute — Godot 4's list of THIS
   * node's exported properties whose authored `NodePath(…)` value the engine RESOLVES TO A NODE
   * when the scene is instantiated.
   *
   * It is the discriminator, not a hint: `@export var target: Node` and `@export var target:
   * NodePath` serialize the same `target = NodePath("../Player")` line, and only this header says
   * which of the two the running game holds. Godot 3 has no such feature and writes no such
   * attribute, so this is empty on every `format=2` document — which is why reading it can only
   * ADD attribution on Godot 4 and can never move a Godot 3 answer.
   *
   * Empty for a node whose header omits it, and for every node of a BINARY `.scn` (the binary
   * bundle's own `node_paths` table is the packed-scene parent/name index — a different fact with
   * the same spelling, read in `read/binary-document.ts`).
   */
  readonly nodePathProperties: readonly string[];
  readonly properties: Readonly<Record<string, GodotValue>>;
  readonly children: readonly SceneNode[];
}

/**
 * A `[node]` line this document could not place in its own tree, because the parent path it names
 * belongs to a scene it INSTANCED rather than to a node it authors. Recorded rather than
 * synthesized — see `scene.ts`'s header for why the reader refuses to invent the missing node.
 */
export interface UnplacedNode {
  readonly name: string;
  readonly parentPath: string;
  /** Exact location of this line/record's provisional parent diagnostic. Consumers may use it
   * only to retire that diagnostic after later project-level composition proves and places the
   * parent; it is not node identity and never participates in path resolution. */
  readonly sourceDiagnosticAt?: string;
  /** The `res://` scene the nearest instancing ancestor mounts, when there is one. Absent means
   *  nothing on the path explains the node, which is the genuinely broken case. */
  readonly instancedScene?: string;
  /**
   * The exact node in an opened source scene that owns this line's runtime parent.
   *
   * Filled only by the project-level ancestry join, after every PackedScene/imported-model
   * document has been read. A missing value is deliberately not a partial answer: the associated
   * `node-parent-instanced` diagnostic names whether the chain was missing, cyclic, or ambiguous.
   */
  readonly inheritedParent?: InstancedParentOrigin;
  /** Exact inherited node this typeless override patches. Distinct from inheritedParent because
   *  imported node-name sanitization/uniquification can change the final child segment. */
  readonly inheritedNode?: InstancedParentOrigin;
  /** A scene this unplaced node itself instances. Distinct from `instancedScene`, which describes
   *  the missing parent's nearest instancing ancestor. */
  readonly instanceOf?: string;
  readonly instancePlaceholder?: string;
  readonly ownerPath?: string;
  readonly sourceOrder?: number;
  readonly siblingIndex?: number;
  /**
   * The facts the `[node]` LINE itself states, carried verbatim.
   *
   * Recording them is not the synthesis this record exists to refuse: the reader still declines to
   * invent the missing PARENT, and this node is still absent from the tree. What the document says
   * about the node it could not place is authored fact, and dropping it loses a real one — Godot's
   * `%UniqueName` table is keyed on the OWNER document, so a `unique_name_in_owner = true` node
   * parented into an unopened `.glb` subtree is unplaced AND uniquely addressable at the same time
   * (`platformer-3d-godot4`'s `%CoinCount`). `SceneNavigator.resolveNodePath` reads them.
   */
  readonly type?: string;
  /** The external path or deterministic scene-local identity of the attached script, if any. */
  readonly scriptPath?: string;
  /** Groups authored on this exact line, retained even when its parent belongs to another scene. */
  readonly groups: readonly string[];
  /** Exported properties the engine resolves from NodePath values into live node references. */
  readonly nodePathProperties: readonly string[];
  readonly properties: Readonly<Record<string, GodotValue>>;
}

/** Source-owned identity reached by following authored `instance=` edges. */
export interface InstancedParentOrigin {
  readonly documentPath: string;
  readonly nodePath: string;
  /** Present when {@link documentPath} is an imported glTF/GLB scene. */
  readonly gltfNodeIndex?: number;
  /** Raw `nodes[i].name`, retained for ecosystem-native runtime graph addressing. */
  readonly gltfName?: string;
}

/**
 * What a `.glb` document's nodes are in the glTF FILE, rather than in Godot's tree.
 *
 * Only `read/gltf-godot-scene.ts`'s `glbSceneDocument` sets it; a `.tscn` leaves it absent. It
 * exists because Godot's node NAME is not the file's: the importer's uniquifier renames a node
 * whenever the synthesized root claimed its name first (`cloud.glb`'s one mesh is `cloud` in the
 * file and `cloud2` in Godot's tree), so the Godot path is not a key any other reader of the same
 * file can look a node up by. The raw glTF name is, and it is the only name a `.tscn` override and
 * a runtime glTF loader can both be resolved against.
 */
export interface GltfSceneOrigin {
  /** Godot node path → exact glTF `nodes[]` index. Unlike a name, this cannot collide. */
  readonly nodeIndexByPath: ReadonlyMap<string, number>;
  /**
   * Godot node path → the RAW `nodes[i].name`. A path absent from this map is a node Godot
   * SYNTHESIZED (the root, the `AnimationPlayer`, a per-skin `Skeleton3D`) or a glTF node the file
   * leaves unnamed — neither is a node the file names.
   */
  readonly nameByPath: ReadonlyMap<string, string>;
  /** The Godot paths of the glTF's own `scenes[<default>].nodes` — see `GlbScene.sceneRootPaths`. */
  readonly sceneRootPaths: readonly string[];
  /** File-backed `images[].uri` values resolved beside this model by the native loader. */
  readonly externalImageUris: readonly string[];
  /** Exact source material identity used to plan native-loader transparency. */
  readonly sourceMaterials: readonly {
    readonly name?: string;
    readonly alphaMode?: string;
  }[];
  /**
   * Godot node path → the SURFACE COUNT of the `MeshInstance3D` there. A path absent from this map
   * is a node with no mesh, so it has no surface to override.
   *
   * A Godot surface IS a glTF primitive (`read/gltf-godot-scene.ts` builds one
   * {@link GlbMeshSurface} per `mesh.primitives[i]`), and it is what a `.tscn`'s
   * `surface_material_override/<s>` line indexes. It is recorded here for the same reason
   * {@link nameByPath} is: the emitter must say WHICH loaded object a Godot line names, and for a
   * per-surface override that object is one primitive mesh inside the node, not the node.
   */
  readonly surfaceCountByPath: ReadonlyMap<string, number>;
  /** Importer-synthesized Skeleton3D path → ordered bone names. */
  readonly boneNamesByPath: ReadonlyMap<string, readonly string[]>;
  /**
   * The `AnimationPlayer` Godot's importer SYNTHESIZES when the file carries animations — absent
   * for a `.glb` with none, which is 14 of `starter-kit-3d-platformer`'s 15 models.
   *
   * It is here rather than on the node because it is the one synthesized node whose CONTENT a
   * consumer needs: {@link nameByPath} exists to say which loaded object a Godot path names, and
   * this says which loaded `THREE.AnimationClip` a Godot CLIP NAME names — the same question one
   * level along, and the same answer shape (the file's own string, which both importers keep).
   */
  readonly animationPlayer?: GltfAnimationPlayerOrigin;
}

/** One clip of {@link GltfAnimationPlayerOrigin}: the name Godot's importer gave it, and the file's
 *  own name/index that identify the same animation to any other glTF loader. */
export interface GltfOriginClip {
  /** Godot's clip name — the string a script's `play("…")`/`current_animation` uses. */
  readonly name: string;
  /** `animations[i].name` verbatim (empty when the file leaves it unnamed) and `i`. */
  readonly gltfName: string;
  readonly gltfIndex: number;
  /** Godot `Animation.loop_mode !== 0` — what decides a three action's `LoopRepeat`/`LoopOnce`. */
  readonly loop: boolean;
  readonly length: number;
}

/** The importer-synthesized `AnimationPlayer` of one `.glb`: where it sits in Godot's tree, and the
 *  clips it holds. */
export interface GltfAnimationPlayerOrigin {
  /** Its node path in Godot's tree — `AnimationPlayer` in every measured file, but read rather than
   *  assumed, because the importer uniquifies that name against the file's own node names. */
  readonly path: string;
  /** `AnimationPlayer::root_node`, which the importer never changes from `..`. */
  readonly rootNode: string;
  /** Sorted by {@link GltfOriginClip.name}, the order `get_animation_list` returns. */
  readonly clips: readonly GltfOriginClip[];
}

/** A `[connection]` line: a signal wired from one node to a method on another. */
export interface SignalConnection {
  readonly signal: string;
  readonly from: string;
  readonly to: string;
  readonly method: string;
  /** Godot 3 `[connection binds=[…]]` values appended after the emitted signal tuple. */
  readonly binds?: readonly GodotValue[];
  /** Godot 4 Callable.unbind count serialized on the connection. It removes arguments from the
   * end of the emitted signal tuple before invoking the method. Absent in Godot 3 documents. */
  readonly unbinds?: number;
}

/** One `.tscn`. */
export interface SceneDocument {
  readonly resPath: string;
  /**
   * Godot 4's stable id for this file — the `[gd_scene uid="uid://…"]` header attribute, or the
   * binary container's UID word. Absent on Godot 3, which had no such thing. It is what
   * `read/uid-index.ts` keys on, and the reason a `run/main_scene` written as a bare `uid://` is
   * still an entry point this lane can find.
   */
  readonly uid?: string;
  /** Godot's text-scene format version (`2` for Godot 3.x, `3` for Godot 4). */
  readonly format?: number;
  /** The root node, or `undefined` for a scene whose `[node]` sections did not resolve to one. */
  readonly root?: SceneNode;
  /** Effective nodes after readable text-scene stamping, plus any still-unplaced authored lines. */
  readonly nodeCount: number;
  readonly unplacedNodes: readonly UnplacedNode[];
  readonly extResources: readonly ExtResourceRef[];
  readonly subResources: readonly SubResource[];
  /** Inline GDScript sources owned by this scene, under deterministic scene-local identities. */
  readonly inlineScripts?: readonly InlineScriptResource[];
  readonly connections: readonly SignalConnection[];
  /** `[editable path="…"]` — instanced children whose own subtree this scene may override. */
  readonly editablePaths: readonly string[];
  /** Present only for a document read from a `.glb` — see {@link GltfSceneOrigin}. */
  readonly gltfOrigin?: GltfSceneOrigin;
}

/** One `.tres`/`.gdns` — a standalone resource document. */
export interface ResourceDocument {
  readonly resPath: string;
  /** Godot 4's stable ResourceUID from the text or binary resource header. */
  readonly uid?: string;
  /** The `[gd_resource type="…"]` declaration. */
  readonly type: string;
  readonly properties: Readonly<Record<string, GodotValue>>;
  readonly extResources: readonly ExtResourceRef[];
  readonly subResources: readonly SubResource[];
}

/** One script resource attachment decoded from a scene; script meaning remains official-bound. */
export interface ScriptAttachment {
  readonly documentPath: string;
  readonly nodePath?: string;
}

/** An `[autoload]` entry — Godot's singleton mechanism. */
export interface Autoload {
  readonly name: string;
  readonly resPath: string;
  readonly singleton: boolean;
  readonly kind: ResourceKind;
  readonly present: boolean;
}

/**
 * One `[input]` binding, as Godot wrote it.
 *
 * The event CLASS and its own numbers, carried verbatim and DECODED BY NOBODY here: an
 * `InputEventKey`'s `scancode` is a Godot keycode, and mapping one onto a DOM `KeyboardEvent.code`
 * is a translate-time decision with a real table behind it (`translate/data/input-map.ts`), not
 * something a reader should guess. Reading the numbers is not the same as interpreting them, and
 * without them the translate stage would have to re-parse `project.godot` itself.
 */
export interface InputEventBinding {
  /** `InputEventKey`, `InputEventJoypadButton`, `InputEventJoypadMotion`, … */
  readonly eventClass: string;
  /** Every `"key":value` field Godot wrote on the event, numbers and booleans only. */
  readonly fields: Readonly<Record<string, number | boolean>>;
}

/** An `[input]` action and its bindings. */
export interface InputAction {
  readonly name: string;
  readonly deadzone?: number;
  readonly eventCount: number;
  readonly eventTypes: readonly string[];
  readonly events: readonly InputEventBinding[];
}

/** A `class_name` registration, from `project.godot`'s `_global_script_classes`. */
export interface GlobalClass {
  readonly className: string;
  readonly base: string;
  readonly language: string;
  readonly resPath: string;
}

export interface EngineVersion {
  /** `project.godot`'s `config_version` — 4 for Godot 3.x, 5 for Godot 4.x. */
  readonly configVersion?: number;
  /** The major version that `configVersion` implies, or `undefined` when it implies nothing. */
  readonly major?: number;
  /** `[application] config/features` — a Godot 4 key. Empty on a Godot 3 project, which is
   *  itself evidence; see `vendor/extension-api/UPSTREAM.md`. */
  readonly features: readonly string[];
}

/** A project-owned path Godot's player loads without a scene or script asking for it. */
export interface ProjectRuntimeRoot {
  readonly mechanism:
    | 'boot-splash'
    | 'application-icon'
    | 'macos-native-icon'
    | 'windows-native-icon'
    | 'custom-cursor'
    | 'custom-theme'
    | 'custom-font'
    | 'project-translation'
    | 'translation-remap-source'
    | 'translation-remap-target'
    | 'tls-certificate-bundle'
    | 'default-audio-bus-layout'
    | 'openxr-action-map';
  /** The spelling in `project.godot`; a Godot 4 `uid://` remains visible until resolved. */
  readonly resPath: string;
}

/** A dependency encoded inside an otherwise opaque source file and loaded by Godot at runtime. */
export interface RuntimeFileDependency {
  readonly from: string;
  readonly to: string;
  readonly mechanism: 'shader-include';
  readonly line: number;
}

/**
 * `[rendering]` — the renderer the project declares, which is what its authored colours mean.
 *
 * Only the keys with a translation are read; the rest of the section stays in the parsed document,
 * unread, for the reason `project-settings.ts`'s header gives.
 */
export interface RenderingSettings {
  /** Effective Godot 4 rendering method; absent for Godot 3. */
  readonly renderingMethod?: string;
  /** `quality/driver/driver_name` — `GLES2`/`GLES3` on Godot 3. Absent means the project never
   *  declared one, which is Godot's own default (`GLES3` on 3.x) rather than a hole. */
  readonly driverName?: string;
  /** `quality/filters/msaa` — Godot's INDEX (0=off, 1=2x, 2=4x, 3=8x, 4=16x), not a sample count. */
  readonly msaa?: number;
  /**
   * `quality/filters/anisotropic_filter_level` — the anisotropy applied to every texture whose
   * `.import` sidecar sets `flags/anisotropic`. A PROJECT setting, not a per-texture one: the
   * sidecar only says whether a texture opts in, and this says how far. Absent means the project
   * never declared one; the translation then carries no anisotropy rather than inventing a level.
   */
  readonly anisotropicFilterLevel?: number;
  /**
   * `environment/default_clear_color`, as a CSS hex string.
   *
   * Absent means the project never declared one, which is Godot 3's own default of
   * `Color(0.3, 0.3, 0.3, 1)` rather than a hole. This setting is load-bearing TWICE over, and the
   * second one is the surprise: it is the colour a frame is cleared to, AND — with no
   * `Environment` — the colour of the scene's global AMBIENT LIGHT. See
   * `translate/rendering.ts`'s header for the two Godot 3.6 runs that measured it.
   */
  readonly defaultClearColor?: string;
  /**
   * `environment/default_environment` (Godot 4: `environment/defaults/default_environment`) — the
   * `res://` path of an `Environment` resource that lights the game when NO node supplies one.
   *
   * This is a RUNTIME setting, not an editor convenience, and that is the whole reason it is read:
   * `SceneTree::SceneTree()` loads it and calls `root->get_world()->set_fallback_environment(env)`
   * (Godot 3.6-stable, `scene/main/scene_tree.cpp:2373-2390`) — in the game, not behind an
   * `is_editor_hint()` branch; the editor branch there only CLEARS the setting when the file is
   * missing. So a project that declares one and authors no `WorldEnvironment` still renders with
   * that Environment's background, ambient and tonemapper, and a translation that reads only the
   * scene graph drops the entire look in silence. `kaykit-hexagons` is that project.
   *
   * Godot 4 kept the mechanism and moved the key: `scene/main/scene_tree.cpp:1854-1868` (4.3-stable)
   * reads `rendering/environment/defaults/default_environment` and installs it with the same
   * `World3D::set_fallback_environment`, after the same `strip_edges()`. No fixture on this shelf
   * declares the Godot 4 spelling, so that half is read and not yet exercised.
   *
   * Absent means the project declared none, which is Godot's own default (`""` — no fallback
   * environment) rather than a hole.
   */
  readonly defaultEnvironment?: string;
  /** `quality/directional_shadow/size` — one edge of the directional shadow map, in texels.
   *  Absent means Godot 3.6's own default, which is 4096 (measured, see `translate/data/shadow.ts`). */
  readonly directionalShadowSize?: number;
  /** Godot 4 positional-light shadow atlas edge. Engine default is 4096 desktop. */
  readonly positionalShadowAtlasSize?: number;
  /** Godot 4 root Viewport positional atlas quadrant subdivision enum indices. */
  readonly positionalShadowAtlasQuadrants?: readonly [number, number, number, number];
  /** Godot 4 positional soft-shadow quality enum. Engine default is SOFT_LOW (2). */
  readonly positionalShadowFilterQuality?: number;
  /** `quality/shadows/filter_mode` — Godot 3's shadow filter INDEX (0=Disabled, 1=PCF5, 2=PCF13).
   *  Absent means Godot 3.6's own default, 1 (PCF5). See `translate/rendering.ts`. */
  readonly shadowFilterMode?: number;
  /** Godot 4's physical-light unit path changes directional energy and requires light intensity. */
  readonly physicalLightUnits?: boolean;
  /** Godot 4's global DOF bokeh kernel (0 BOX, 1 HEXAGON, 2 CIRCLE). */
  readonly dofBokehShape?: number;
  /** Godot 4's global DOF quality (0 VERY_LOW, 1 LOW, 2 MEDIUM, 3 HIGH). */
  readonly dofBokehQuality?: number;
  /** The compute renderer's DOF sample jitter switch; the raster path leaves it disabled. */
  readonly dofUseJitter?: boolean;
  /** Godot 4's global SSAO quality preset (0 VERY_LOW through 4 ULTRA). */
  readonly ssaoQuality?: number;
  readonly ssaoHalfSize?: boolean;
  readonly ssaoAdaptiveTarget?: number;
  readonly ssaoBlurPasses?: number;
  readonly ssaoFadeoutFrom?: number;
  readonly ssaoFadeoutTo?: number;
  /**
   * `misc/mesh_storage/split_stream` — where an `ArrayMesh` surface's positions sit relative to
   * its other attributes.
   *
   * Lifted out of `[rendering]` for one reason: it is the ONLY thing that decides how an inline
   * mesh's `array_data` bytes are laid out, and the surface itself records nothing about it —
   * both layouts serialize at the same byte length under the same `format`. So a decoder cannot
   * infer it and a project that turns it on would otherwise be read as geometry nobody authored.
   * Absent means Godot's own default, `false`. See `read/array-mesh.ts`.
   */
  readonly meshSplitStream?: boolean;
}

/** The whole read: what `readGodotProject` returns. */
export interface GodotProject {
  readonly projectDir: string;
  /** Exact source/native claims whose live identities authorized this decoded project. */
  readonly readEvidence: {
    readonly claimIds: readonly string[];
    readonly registryDigest: string;
  };
  /** Stable complete `res://` inventory read from the project tree, excluding skipped caches. */
  readonly sourceFiles: readonly string[];
  /** `[application] config/name`, falling back to the directory name. */
  readonly projectName: string;
  readonly engine: EngineVersion;
  /** `[application] run/main_scene`. */
  readonly mainScene?: string;
  /** `[application] run/main_loop_type`; `SceneTree` when the project relies on Godot's default. */
  readonly mainLoopType: string;
  /** Source-proved player startup roots outside the ordinary scene/resource graph. */
  readonly runtimeRoots: readonly ProjectRuntimeRoot[];
  /** Exact saved UID → res:// table carried into ResourceUID's runtime singleton. */
  readonly resourceUidPaths?: readonly Readonly<{ uid: string; path: string }>[];
  /**
   * `[audio] buses/default_bus_layout` after uid resolution. Absent means the project relies on
   * Godot's conventional `res://default_bus_layout.tres` lookup rather than configuring a path.
   */
  readonly authoredAudioBusLayout?: string;
  /** `.gdextension` descriptors auto-discovered by Godot's editor and loaded by the player. */
  readonly nativeExtensions: readonly string[];
  readonly runtimeFileDependencies: readonly RuntimeFileDependency[];
  /** `[display] window/size` — the 2D coordinate space every authored position is expressed in. */
  readonly window?: { readonly width: number; readonly height: number };
  /**
   * `[physics] common/physics_fps` (G3) / `common/physics_ticks_per_second` (G4) — the FIXED rate
   * Godot steps `_physics_process` at. Absent when the project declares neither; the world emitter
   * defaults it to 60.
   */
  readonly physicsFps?: number;
  /** `[physics] common/physics_interpolation`; absent means Godot's default `false`. */
  readonly physicsInterpolation?: boolean;
  /** `[physics] 2d/default_gravity` * `2d/default_gravity_vector`. Always present; Godot's own
   *  defaults apply when the project declares neither key. */
  readonly gravity2D: { readonly x: number; readonly y: number };
  /** `[physics] 3d/default_gravity` * `3d/default_gravity_vector` — see
   *  `ProjectSettings.gravity3D`. ALWAYS present; Godot's own engine default applies when the
   *  project declares neither key. */
  readonly gravity3D: { readonly x: number; readonly y: number; readonly z: number };
  /** `[physics] 3d/default_linear_damp` / `3d/default_angular_damp` — see
   *  `ProjectSettings.damping3D`. ALWAYS present; Godot's own registered `0.1` applies when the
   *  project declares neither key, and Rapier's own default is `0`, so it must be carried. */
  readonly damping3D: { readonly linear: number; readonly angular: number };
  /** `[rendering]` — the pipeline the game's colours were authored against. */
  readonly rendering: RenderingSettings;
  /**
   * The whitelisted `ProjectSettings.get_setting` keys resolved to their TYPED value (declared, or
   * Godot's registered default) — `read/known-settings.ts`. The emitter inlines a `get_setting`
   * from here; a key absent is one this lane has not measured and refuses by name.
   */
  readonly resolvedSettings: ReadonlyMap<string, ResolvedSetting>;
  /** Complete parsed project.godot setting membership plus pinned registered defaults. */
  readonly projectSettings: ReadonlyMap<string, GodotValue>;
  readonly autoloads: readonly Autoload[];
  readonly inputActions: readonly InputAction[];
  readonly globalClasses: readonly GlobalClass[];
  readonly scenes: readonly SceneDocument[];
  readonly resources: readonly ResourceDocument[];
  /**
   * Every `<file>.import` sidecar in the tree — Godot's own record of how it imported the asset
   * beside it. Read because ONE of those settings decides which materials the game renders; see
   * `read/import-sidecar.ts` for the 3.6 run that measured it.
   */
  readonly imports: readonly ImportSidecar[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Depth-first walk of a scene's own authored nodes. */
export function walkSceneNodes(node: SceneNode, visit: (node: SceneNode) => void): void {
  visit(node);
  for (const child of node.children) walkSceneNodes(child, visit);
}

/**
 * Every scene transitively reachable from `entries` through `instance=` edges, the entries
 * included. Cycle-safe (a scene may instance a scene that instances it back). This is a
 * MEASUREMENT over the recorded edges, not a splice — see this module's header for why the reader
 * never merges one scene's tree into another's.
 *
 * `entries` is Godot's BOOT SET: `run/main_scene` plus every autoloaded scene, because an autoload
 * is mounted before the main scene and is as real an entry point as it is. What this deliberately
 * does NOT follow is `preload("res://…")` / `load()` / `change_scene()` — those are GDScript
 * expressions, and reading them is S1. On a script-navigated game that gap is the whole
 * difference between the boot set and the project, which is exactly the number the report prints.
 *
 * The returned set contains SCENE DOCUMENTS ONLY. An `instance=` edge can target a `PackedScene`
 * this reader does not open — an imported `.glb`/`.dae` model is instanced exactly that way, and a
 * 3D project does it for every character — but the caller counts this set against `scenes.length`
 * and prints "N of M reachable", so one non-document member turns that line into a false claim.
 * The edge is followed (a document behind one would still be reached) and it is not lost: the read
 * already reports the reference as `ext-resource-opaque`, the format-level statement that this
 * reader does not open that file.
 */
export function reachableScenes(
  scenes: readonly SceneDocument[],
  entries: readonly string[],
): ReadonlySet<string> {
  const byPath = new Map(scenes.map((scene) => [scene.resPath, scene]));
  /** Cycle guard — every path the walk has already considered, document or not. */
  const visited = new Set<string>();
  /** The answer — the subset of `visited` that is a scene document this reader parsed. */
  const reached = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const at = queue.pop() as string;
    if (visited.has(at)) continue;
    visited.add(at);
    const scene = byPath.get(at);
    if (scene === undefined) continue;
    reached.add(at);
    if (scene.root === undefined) continue;
    walkSceneNodes(scene.root, (node) => {
      if (node.instanceOf !== undefined && !visited.has(node.instanceOf))
        queue.push(node.instanceOf);
    });
  }
  return reached;
}
