/**
 * read/gltf-godot-scene.ts — GODOT'S IMPORTER TRANSFORM: the node tree Godot 4 builds out of a
 * `.glb`, so a `.tscn` that instances one can have its overrides resolved.
 *
 * ## The problem this exists for
 *
 * A `.tscn` whose root instances an imported model addresses nodes INSIDE it —
 * `[node name="Robot" parent="Player/Skeleton/Skeleton3D"]`, `[node name="RayFloor"
 * parent="Enemy/Skeleton"]`, `[node name="leg-left" parent="character/root"]`. `scene.ts` cannot
 * place those, because the document does not author their parents, so it records them as
 * `unplacedNodes` with a `node-parent-instanced` warning. Two of this package's fixtures are mostly
 * that warning: `starter-kit-3d-platformer`'s character is an imported `.glb` and 17 of its 18
 * unresolved script touches trace to it.
 *
 * The missing knowledge is not in the `.tscn` and it is not, quite, in the `.glb` either. It is in
 * what GODOT'S IMPORTER DOES to the glTF document, and that transform is substantial:
 *
 *  - a `Skeleton3D` is SYNTHESIZED per skin — a node the glTF does not contain — and every glTF
 *    joint stops being a node and becomes a BONE of it;
 *  - the skinned `MeshInstance3D` is REPARENTED under that skeleton, so
 *    `Player/Skeleton/Skeleton3D/Robot` is a path no reading of the glTF's node list produces;
 *  - an `AnimationPlayer` is SYNTHESIZED as a root child holding every glTF animation, with track
 *    paths rewritten to Godot node paths and `Skeleton3D:<bone>` subnames;
 *  - a Node3D ROOT is synthesized above the glTF's own root nodes, named by a rule that depends on
 *    the `.import` sidecar's `gltf/naming_version`;
 *  - every node name goes through a uniquifier whose STATE is shared with the scene name, the bone
 *    names and the mesh resource names, so the answer for one name depends on the others.
 *
 * ## Ground truth: measured, not inferred
 *
 * Every rule here is cited to `godotengine/godot` at tag `4.7-stable` AND checked against a dump of
 * what a real Godot 4.7 produced for this package's own fixtures
 * (`test/ground-truth/probe-glb-scene.gd`, `godot47-glb-scene-*.json`,
 * the generated native scene). The two together are the bar, because either alone is
 * insufficient: the C++ describes intent and has version-keyed branches whose live value is not
 * visible in it, and a dump alone cannot tell a rule from a coincidence.
 *
 * The naming rule is the worked example of why. Three of the 15 `.glb` files in
 * `starter-kit-3d-platformer` import with root `X2` above a child `X`, and the other twelve with
 * root `X` above a child `X2` — same shape of document, same import params but one. A DEDICATED
 * EXPERIMENT (every sidecar's `gltf/naming_version` forced to 0, then 1, then 2, both fixtures
 * reimported and re-dumped) showed the split is exactly that param and nothing else, which then
 * matched `_parse_scenes` (:551, uniquifies the scene name FIRST when the version is 0),
 * `_assign_node_names` (:4075, uniquifies every non-joint node name) and `_generate_scene_node_tree`
 * (:7074, uniquifies the scene name LAST otherwise). Reading only the source would have produced a
 * plausible reader that is wrong for four of the fixture's files.
 *
 * ## What is modelled, and what is refused BY NAME
 *
 * Modelled: the node tree (names, classes, paths, transforms, visibility, ownership), the
 * synthesized `Skeleton3D` and its ORDERED bone list with parents and rest transforms, skinned-mesh
 * reparenting with the skeleton `NodePath` and skin bind count, mesh surface counts with each
 * surface's material class and name, and the `AnimationPlayer` with each clip's name, loop mode,
 * step, length and ordered track list.
 *
 * Refused by name (each raises `GltfParseError` naming the construct, never a silent partial read):
 * every glTF extension outside `HANDLED_EXTENSIONS`, morph targets, non-FLOAT animation accessor
 * components, compressed animation buffer layouts, and the Blender/Collada name HINTS
 * (`-col`, `-noimp`, `-rigid`, …) which restructure the
 * tree, a `root_scale` other than 1, and `import_as_skeleton_bones`.
 *
 * NOT modelled, stated here so nothing reads their absence as an oversight — both are outputs of
 * Godot's animation COMPRESSOR rather than of the import transform:
 *
 *  - **per-track key counts.** `_import_animation` (:5760) RESAMPLES every track at
 *    `animation/fps` and `_optimize_animations` (:2126) then runs `Animation::optimize(0.01, 0.01,
 *    3)` over the result. The count is what that error-bounded curve fitter left behind; nothing
 *    downstream reads it, and reproducing it means reimplementing the compressor.
 *  - **material `resource_path`.** Godot mints `res://…glb::StandardMaterial3D_rjwis` — a
 *    per-import random sub-resource id. It is an identity, not information.
 */
import { GltfParseError, readGlbContainer } from './glb-container';
import type { GltfDocument, GltfNode, Transform3D } from './gltf-document';
import {
  basisRotationQuaternion,
  basisScale,
  IDENTITY_TRANSFORM,
  readGltfDocument,
} from './gltf-document';
import type { GltfAnimationPlayerOrigin, SceneDocument, SceneNode } from './godot-types';
import type { GodotValue } from './godot-value';
import { type GodotSceneImportParams, isUnchangedGlbRootType } from './import-sidecar';

export interface GlbMeshSurface {
  readonly index: number;
  /** Always `StandardMaterial3D`: `_parse_materials` (:2954) instantiates exactly that class. */
  readonly materialClass: string | undefined;
  readonly materialName: string | undefined;
}

export interface GlbMeshInfo {
  /** `ArrayMesh` — what `ImporterMesh` becomes once `_post_fix_node` bakes it. */
  readonly meshClass: string;
  readonly resourceName: string;
  readonly surfaces: readonly GlbMeshSurface[];
}

export interface GlbBone {
  readonly index: number;
  readonly name: string;
  /** Bone index of the parent, or -1 for a skeleton root. */
  readonly parent: number;
  readonly rest: Transform3D;
  /** The glTF `nodes[]` index (a skin joint) the bone came from. */
  readonly gltfNodeIndex: number;
  /**
   * The pose the importer gives the bone (`SkinTool::_create_skeletons`, skin_tool.cpp:636): the
   * joint transform's origin, `get_rotation_quaternion()` and `get_scale()`.
   */
  readonly pose: GlbBonePose;
}

export interface GlbBonePose {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
}

export interface GlbAnimationTrack {
  /** Godot `Animation::TrackType`: 1 `POSITION_3D`, 2 `ROTATION_3D`, 3 `SCALE_3D`. */
  readonly type: 1 | 2 | 3;
  /** The exact `NodePath` string, `Skeleton3D:<bone>` subname included. */
  readonly path: string;
}

export interface GlbAnimationClip {
  readonly name: string;
  /** Godot `Animation::LoopMode`: 0 none, 1 linear. */
  readonly loopMode: number;
  readonly step: number;
  readonly length: number;
  readonly tracks: readonly GlbAnimationTrack[];
  /**
   * The RAW `animations[i].name` the FILE spells, before {@link genUniqueName} ran over it — the
   * same relationship {@link GlbSceneNode.gltfName} has to {@link GlbSceneNode.name}, and empty
   * when the file leaves the animation unnamed.
   *
   * {@link name} is GODOT's answer and it is not three's: Godot sanitizes through
   * `validate_node_name` and uniquifies with `2`, `3`, …, while three's `GLTFLoader` keeps
   * `animationDef.name` verbatim and applies neither
   * (`three/examples/jsm/loaders/GLTFLoader.js:4141`, version 0.180.0 as vendored:
   * `const animationName = animationDef.name ? animationDef.name : 'animation_' + animationIndex;`).
   * So a script's `play("<godot name>")` and the `THREE.AnimationClip` it must reach are two
   * different strings in general, and this field plus {@link gltfIndex} is what maps one to the
   * other.
   */
  readonly gltfName: string;
  /** The `animations[]` index this clip came from — the other half of three's naming rule above,
   *  which falls back to `animation_<index>` for an unnamed animation. */
  readonly gltfIndex: number;
}

export interface GlbSceneNode {
  readonly name: string;
  /** `Node3D` | `MeshInstance3D` | `Skeleton3D` | `AnimationPlayer`. */
  readonly nodeClass: string;
  /** Relative to the instantiated root; `.` for the root itself, `A/B` beneath it. */
  readonly path: string;
  readonly transform: Transform3D;
  readonly visible: boolean;
  readonly mesh?: GlbMeshInfo;
  /** `MeshInstance3D.skeleton`: `..` for a skinned mesh reparented under its skeleton, else ``. */
  readonly skeletonPath?: string;
  /** The `Skin`'s bind count, or -1 when the mesh instance has no skin. */
  readonly skinBindCount?: number;
  readonly bones?: readonly GlbBone[];
  readonly animationRootNode?: string;
  readonly animations?: readonly GlbAnimationClip[];
  /**
   * The glTF `nodes[]` index this node came from. ABSENT for a node Godot SYNTHESIZED — the root,
   * the `AnimationPlayer`, a per-skin `Skeleton3D` — none of which any glTF node backs.
   */
  readonly gltfNodeIndex?: number;
  /**
   * The RAW `nodes[i].name` the FILE spells, before {@link genUniqueName} ran over it.
   *
   * {@link GlbSceneNode.name} is Godot's answer and it is not the file's: `cloud.glb`'s one mesh is
   * named `cloud` in the glTF and `cloud2` in Godot's tree, because the synthesized root took
   * `cloud` first. Absent when the glTF leaves the node unnamed (Godot then names it `Node`/`Mesh`,
   * a name the file does not contain).
   */
  readonly gltfName?: string;
}

export interface GlbScene {
  readonly resPath: string;
  /** Depth-first, the order `Node::get_children` walks — the same order the oracle records. */
  readonly nodes: readonly GlbSceneNode[];
  /**
   * The node paths of the glTF's OWN root list, `scenes[<default>].nodes`.
   *
   * Godot IGNORES that list below `gltf/naming_version = 2` (`_compute_node_heights`:653 — "every
   * parentless node is a root, in index order", which its own comment calls incorrect but
   * required for compatibility), so Godot's depth-1 children are a SUPERSET of it in general.
   * Recorded because the difference is the one place the two trees disagree about what exists at
   * all, rather than about a name.
   */
  readonly sceneRootPaths: readonly string[];
  /** File-backed images the native glTF loader resolves beside this model. */
  readonly externalImageUris: readonly string[];
  /** Exact source material identities and alpha modes needed by renderer planning. */
  readonly sourceMaterials: readonly {
    readonly name?: string;
    readonly alphaMode?: string;
  }[];
}

/**
 * The imported tree as a {@link SceneDocument}, so every consumer that already navigates scenes
 * navigates this one too.
 *
 * This is the whole integration, and it is deliberately a CONVERSION rather than a second code
 * path: `project-index.ts`'s navigator resolves `$"Player/Skeleton"` by looking the instanced
 * `res://` path up in the project's scene map and descending, and it says
 * "`res://player/player.glb` is not a scene this reader opened" only because that map had no entry.
 * Giving it one resolves the touch through the code that was already there.
 *
 * A glb has no `[connection]`s, no `[editable]`s, no sub-resources and no unplaced nodes — the
 * importer's output is a complete tree by construction — so those are empty rather than absent, and
 * `nodeCount` is the real node count.
 */
/**
 * The two per-node facts a `.tscn` line reaching INTO this model is adjudicated against: the RAW
 * glTF name of the object it addresses, and — for a `surface_material_override/<s>` — how many
 * surfaces the mesh there has. Both are keyed by Godot node path and both are partial: a
 * synthesized node has no glTF name, and a node with no mesh has no surface count.
 */
function gltfOriginIndex(nodes: readonly GlbSceneNode[]): {
  nodeIndexByPath: Map<string, number>;
  nameByPath: Map<string, string>;
  surfaceCountByPath: Map<string, number>;
  boneNamesByPath: Map<string, readonly string[]>;
  bonesByPath: Map<string, readonly { readonly name: string; readonly gltfNode: number; readonly pose: GlbBonePose }[]>;
} {
  const nodeIndexByPath = new Map<string, number>();
  const nameByPath = new Map<string, string>();
  const surfaceCountByPath = new Map<string, number>();
  const boneNamesByPath = new Map<string, readonly string[]>();
  const bonesByPath = new Map<string, readonly { readonly name: string; readonly gltfNode: number; readonly pose: GlbBonePose }[]>();
  for (const node of nodes) {
    if (node.gltfNodeIndex !== undefined) nodeIndexByPath.set(node.path, node.gltfNodeIndex);
    if (node.gltfName !== undefined) nameByPath.set(node.path, node.gltfName);
    if (node.mesh !== undefined) surfaceCountByPath.set(node.path, node.mesh.surfaces.length);
    if (node.bones !== undefined) boneNamesByPath.set(node.path, node.bones.map((bone) => bone.name));
    if (node.bones !== undefined) {
      bonesByPath.set(node.path, node.bones.map((bone) => ({ name: bone.name, gltfNode: bone.gltfNodeIndex, pose: bone.pose })));
    }
  }
  return { nodeIndexByPath, nameByPath, surfaceCountByPath, boneNamesByPath, bonesByPath };
}

export function glbSceneDocument(scene: GlbScene): SceneDocument {
  const byPath = new Map<string, { node: GlbSceneNode; children: SceneNode[] }>();
  for (const node of scene.nodes) byPath.set(node.path, { node, children: [] });
  for (const node of scene.nodes) {
    if (node.path === '.') continue;
    const slash = node.path.lastIndexOf('/');
    const parentPath = slash === -1 ? '.' : node.path.slice(0, slash);
    byPath.get(parentPath)?.children.push(asSceneNode(node, byPath));
  }
  const root = byPath.get('.');
  const { nodeIndexByPath, nameByPath, surfaceCountByPath, boneNamesByPath, bonesByPath } =
    gltfOriginIndex(scene.nodes);
  const player = scene.nodes.find((node) => node.animations !== undefined);
  const playerClips = player?.animations ?? [];
  const animationPlayer: GltfAnimationPlayerOrigin | undefined =
    player === undefined || playerClips.length === 0
      ? undefined
      : {
          path: player.path,
          rootNode: player.animationRootNode ?? '..',
          clips: playerClips.map((clip) => ({
            name: clip.name,
            gltfName: clip.gltfName,
            gltfIndex: clip.gltfIndex,
            loop: clip.loopMode !== 0,
            length: clip.length,
          })),
        };
  return {
    resPath: scene.resPath,
    ...(root === undefined ? {} : { root: asSceneNode(root.node, byPath) }),
    nodeCount: scene.nodes.length,
    unplacedNodes: [],
    extResources: [],
    subResources: [],
    inlineScripts: [],
    connections: [],
    editablePaths: [],
    gltfOrigin: {
      nodeIndexByPath,
      nameByPath,
      surfaceCountByPath,
      boneNamesByPath,
      bonesByPath,
      sceneRootPaths: scene.sceneRootPaths,
      externalImageUris: scene.externalImageUris,
      sourceMaterials: scene.sourceMaterials,
      ...(animationPlayer === undefined ? {} : { animationPlayer }),
    },
  };
}

/**
 * The properties the imported node holds as Godot instantiates it: its `transform` (the
 * `Transform3D` text order, basis rows then origin, as a `.tscn` spells it) for every node below
 * the root, and `visible` when the importer hid it.
 */
function importedProperties(node: GlbSceneNode): Readonly<Record<string, GodotValue>> {
  if (node.path === '.') return {};
  const { basisX, basisY, basisZ, origin } = node.transform;
  const number = (value: number): GodotValue => ({ kind: 'number', value, variantType: 'float' });
  const rows = [0, 1, 2].flatMap((row) => [basisX[row], basisY[row], basisZ[row]] as number[]);
  return {
    transform: { kind: 'ctor', name: 'Transform3D', args: [...rows, ...origin].map(number), fields: [] },
    ...(node.visible ? {} : { visible: { kind: 'bool', value: false } }),
  };
}

function asSceneNode(
  node: GlbSceneNode,
  byPath: ReadonlyMap<string, { node: GlbSceneNode; children: SceneNode[] }>,
): SceneNode {
  return {
    name: node.name,
    path: node.path,
    type: node.nodeClass,
    groups: [],
    nodePathProperties: [],
    properties: importedProperties(node),
    children: byPath.get(node.path)?.children ?? [],
  };
}

/**
 * Godot `String::validate_node_name` — `Node::invalid_character` is `. : @ / " %`, each replaced
 * with `_`. This replacement is source identity: an override authored against an imported glTF
 * spells `foo.bar` as `foo_bar`, and removing the punctuation instead resolves a different path.
 * Every generated node name goes through it (`_gen_unique_name`, gltf_document.cpp:462).
 */
function validateNodeName(name: string): string {
  return name.replace(/[.:@/"%]/g, '_');
}

/** `_gen_unique_name_static`: sanitize, then append `2`, `3`, … until unused. */
function genUniqueName(used: Set<string>, name: string): string {
  const base = validateNodeName(name);
  let index = 1;
  for (;;) {
    const candidate = index > 1 ? `${base}${index}` : base;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    index++;
  }
}

/** `SkinTool::_gen_unique_bone_name`: `:` and `/` become `_`, then `_2`, `_3`, … — a DIFFERENT
 * sanitizer and a DIFFERENT suffix from the node one, which is why they are two functions. */
function genUniqueBoneName(used: Set<string>, name: string): string {
  const base = name.replace(/[:/]/g, '_') || 'bone';
  let index = 1;
  for (;;) {
    const candidate = index > 1 ? `${base}_${index}` : base;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    index++;
  }
}

/**
 * `resource_importer_scene.cpp:429` `_teststr` — the Blender/Collada name HINTS. Every one of these
 * makes the importer restructure the tree (delete the node, wrap it in a `StaticBody3D` with a
 * generated `CollisionShape3D`, turn it into a `VehicleBody3D`, …), so a document using one is
 * REFUSED rather than read as if the name were ordinary. `_teststr` first strips trailing digits,
 * underscores and whitespace (Blender's `.001` duplicates), then matches `$hint` anywhere or
 * `-hint`/`_hint` at the end, case-insensitively.
 */
const NAME_HINTS: readonly string[] = [
  'noimp',
  'colonly',
  'convcolonly',
  'rigid',
  'col',
  'convcol',
  'navmesh',
  'occ',
  'occonly',
  'vehicle',
  'wheel',
];

function firstNameHint(name: string): string | undefined {
  let what = name;
  while (what.length > 0) {
    const last = what.charCodeAt(what.length - 1);
    const isTrailing = (last >= 48 && last <= 57) || last <= 32 || last === 95;
    if (!isTrailing) break;
    what = what.slice(0, -1);
  }
  const lower = what.toLowerCase();
  return NAME_HINTS.find(
    (hint) =>
      lower.includes(`$${hint}`) || lower.endsWith(`-${hint}`) || lower.endsWith(`_${hint}`),
  );
}

/** Godot `Math::is_equal_approx` with `CMP_EPSILON` 1e-5, scaled by magnitude. */
function isEqualApprox(a: number, b: number): boolean {
  if (a === b) return true;
  const tolerance = Math.max(1e-5, 1e-5 * Math.abs(a));
  return Math.abs(a - b) < tolerance;
}

function vectorEqualApprox(a: readonly number[], b: readonly number[]): boolean {
  return a.every((value, i) => isEqualApprox(value, b[i] as number));
}

function normalizedQuaternion(q: readonly number[]): number[] {
  const length = Math.hypot(q[0] as number, q[1] as number, q[2] as number, q[3] as number);
  return length === 0 ? [0, 0, 0, 1] : q.map((c) => c / length);
}

/** One skeleton Godot synthesizes: which glTF nodes became its bones, in ITS bone order. */
interface SynthesizedSkeleton {
  /** glTF node index per bone index. */
  readonly boneNodes: number[];
  readonly bones: GlbBone[];
  /** The glTF node index whose generation puts the `Skeleton3D` into the tree. */
  parentGltfNode: number;
}

/**
 * `SkinTool::_determine_skeletons` (skin_tool.cpp:298) + `_determine_skeleton_roots` (:506) +
 * `_create_skeletons` (:562), for the case every measured fixture is in: skins whose joints form
 * whole subtrees.
 *
 * The grouping is a disjoint set over each skin's joints unioned with their parents, which for one
 * skin is simply "the joints, grouped by connectivity". The BONE ORDER is the load-bearing part and
 * it is not the glTF's joint order: roots ascending by node index, then depth-first with each
 * node's children visited in ASCENDING NODE INDEX (`bones.sort()` then `child_nodes.sort()` at
 * :594/:610). `enemy.glb` proves the distinction — its skin lists 11 joints and Godot's bone list is
 * a different permutation of them.
 *
 * REFUSED: a skin whose joint set has a non-joint node between two joints. Godot's
 * `_expand_skin`/`_reparent_non_joint_skeleton_subtrees` turn those into bones too, restructuring
 * the tree; no fixture exercises it and a guess there is silently plausible.
 */
function determineSkeletons(doc: GltfDocument, at: string): SynthesizedSkeleton[] {
  if (doc.skins.length === 0) return [];
  const jointOf = new Map<number, number>(); // gltf node -> skeleton index
  const groups: number[][] = [];
  for (const skin of doc.skins) {
    // Which existing group does this skin touch? Skins sharing any joint are ONE skeleton.
    let target = groups.findIndex((_, index) =>
      skin.joints.some((joint) => jointOf.get(joint) === index),
    );
    if (target < 0) {
      target = groups.length;
      groups.push([]);
    }
    for (const joint of skin.joints) {
      if (jointOf.has(joint)) continue;
      jointOf.set(joint, target);
      (groups[target] as number[]).push(joint);
    }
  }
  for (const [joint, group] of jointOf) {
    for (const child of doc.nodes[joint]?.children ?? []) {
      const childGroup = jointOf.get(child);
      if (childGroup !== undefined && childGroup !== group) {
        throw new GltfParseError(
          `${at}: nodes ${joint} and ${child} are joints of different skins in one subtree; Godot merges those skeletons and this reader has not measured that case`,
        );
      }
    }
  }

  return groups.map((joints, index) => {
    const inGroup = new Set(joints);
    const roots = joints
      .filter((joint) => !inGroup.has(doc.parents[joint] as number))
      .sort((a, b) => a - b);
    // Every non-root joint's parent must itself be a joint of this group, or Godot would have
    // reparented a non-joint subtree into the skeleton.
    for (const joint of joints) {
      const parent = doc.parents[joint] as number;
      if (parent >= 0 && !inGroup.has(parent) && !roots.includes(joint)) {
        throw new GltfParseError(
          `${at}: joint node ${joint} has a non-joint parent inside skin ${index}`,
        );
      }
    }
    const boneNodes: number[] = [];
    const stack = [...roots];
    while (stack.length > 0) {
      const nodeIndex = stack.shift() as number;
      boneNodes.push(nodeIndex);
      const children = (doc.nodes[nodeIndex]?.children ?? [])
        .filter((child) => inGroup.has(child))
        .sort((a, b) => a - b);
      stack.unshift(...children);
    }
    const firstRoot = roots[0] as number;
    return {
      boneNodes,
      bones: [],
      parentGltfNode: doc.parents[firstRoot] as number,
    };
  });
}

interface MutableSceneNode {
  name: string;
  nodeClass: string;
  transform: Transform3D;
  visible: boolean;
  mesh?: GlbMeshInfo;
  skeletonPath?: string;
  skinBindCount?: number;
  bones?: GlbBone[];
  animationRootNode?: string;
  animations?: GlbAnimationClip[];
  gltfNodeIndex?: number;
  gltfName?: string;
  readonly children: MutableSceneNode[];
}

/** `Node::add_child(child, force_readable_name=true)` — uniquify against SIBLINGS only. */
function addChild(parent: MutableSceneNode, child: MutableSceneNode): void {
  const taken = new Set(parent.children.map((sibling) => sibling.name));
  let index = 1;
  let candidate = child.name;
  while (taken.has(candidate)) {
    index++;
    candidate = `${child.name}${index}`;
  }
  child.name = candidate;
  parent.children.push(child);
}

/**
 * Read a `.glb` as the scene Godot's importer builds from it.
 *
 * `importParams` is the `[params]` block of the `<file>.glb.import` sidecar beside it
 * (`import-sidecar.ts`). It is REQUIRED rather than defaulted: `gltf/naming_version` alone changes
 * every node name in the tree, and a reader that guessed it would be wrong for four of the fifteen
 * models in one shipped fixture.
 */
export function readGlbAsGodotScene(
  bytes: Uint8Array,
  resPath: string,
  importParams: GodotSceneImportParams,
  engineMajor: 3 | 4 = 4,
): GlbScene {
  const container = readGlbContainer(bytes, resPath);
  return readGltfAsGodotScene(
    container.json,
    container.binary,
    resPath,
    importParams,
    engineMajor,
    false,
  );
}

/** Read a JSON `.gltf` plus its exact external buffer through the same Godot importer model. */
export function readGltfAsGodotScene(
  json: unknown,
  binary: Uint8Array,
  resPath: string,
  importParams: GodotSceneImportParams,
  engineMajor: 3 | 4 = 4,
  externalBuffer = true,
): GlbScene {
  const doc = readGltfDocument(json, binary, resPath, externalBuffer);
  const namingVersion = importParams.gltfNamingVersion;
  const node3DClass = engineMajor === 3 ? 'Spatial' : 'Node3D';
  const meshInstanceClass = engineMajor === 3 ? 'MeshInstance' : 'MeshInstance3D';
  const skeletonClass = engineMajor === 3 ? 'Skeleton' : 'Skeleton3D';
  const standardMaterialClass = engineMajor === 3 ? 'SpatialMaterial' : 'StandardMaterial3D';
  const cameraClass = engineMajor === 3 ? 'Camera' : 'Camera3D';
  const lightClassOf = (node: GltfNode): string | undefined => {
    if (node.punctualLight === undefined) return undefined;
    const type = doc.punctualLights[node.punctualLight]?.type;
    if (type === 'directional') return engineMajor === 3 ? 'DirectionalLight' : 'DirectionalLight3D';
    if (type === 'point') return engineMajor === 3 ? 'OmniLight' : 'OmniLight3D';
    if (type === 'spot') return engineMajor === 3 ? 'SpotLight' : 'SpotLight3D';
    throw new GltfParseError(
      `${resPath}: nodes[${node.index}] points at missing punctual light ${node.punctualLight}`,
    );
  };
  const importedClassOf = (node: GltfNode): string =>
    node.mesh !== undefined
      ? meshInstanceClass
      : node.camera !== undefined
        ? cameraClass
        : lightClassOf(node) ?? node3DClass;

  if (importParams.importAsSkeletonBones) {
    throw new GltfParseError(
      `${resPath}: nodes/import_as_skeleton_bones is on; that turns every root node into a bone of one synthesized skeleton and this reader has not measured it`,
    );
  }

  const uniqueNames = new Set<string>([skeletonClass]); // `_parse_scenes`:524 reserves it.
  const fileName = (resPath.split('/').pop() ?? resPath).replace(/\.[^.]*$/, '');
  // `_parse_scenes`:549 — a scene named "Scene…" is Blender's default and is treated as unnamed.
  let sceneName =
    doc.sceneName !== undefined && doc.sceneName !== '' && !doc.sceneName.startsWith('Scene')
      ? doc.sceneName
      : fileName;
  if (namingVersion === 0) sceneName = genUniqueName(uniqueNames, sceneName);

  // `_compute_node_heights`:653 — before naming version 2 the document's own `scenes[].nodes` is
  // IGNORED and every parentless node is a root, in index order. Godot calls this "incorrect, but
  // required for compatibility".
  const rootNodes =
    namingVersion < 2
      ? doc.nodes.filter((node) => doc.parents[node.index] === -1).map((node) => node.index)
      : doc.sceneRootNodes;

  const skeletons = determineSkeletons(doc, resPath);
  const skeletonOfNode = new Map<number, number>();
  skeletons.forEach((skeleton, index) => {
    for (const node of skeleton.boneNodes) skeletonOfNode.set(node, index);
  });

  // `_assign_node_names`:4048 — every NON-JOINT node, in node-index order. Joints are named later,
  // by the skeleton, against a different set. This ordering is what decides whether the synthesized
  // root or the glTF root node wins the shared name.
  const nodeNames = new Map<number, string>();
  for (const node of doc.nodes) {
    if (skeletonOfNode.has(node.index)) continue;
    const hint = importParams.useNameSuffixes ? firstNameHint(node.name) : undefined;
    if (hint !== undefined) {
      throw new GltfParseError(
        `${resPath}: nodes[${node.index}] is named "${node.name}", whose "-${hint}" hint makes Godot's importer restructure the tree; this reader refuses rather than read it as an ordinary name`,
      );
    }
    const importedClass = importedClassOf(node);
    const fallback =
      node.mesh !== undefined
        ? 'Mesh'
        : node.camera !== undefined
          ? cameraClass
          : node.punctualLight !== undefined
            ? importedClass
            : 'Node';
    nodeNames.set(node.index, genUniqueName(uniqueNames, node.name === '' ? fallback : node.name));
  }

  // `SkinTool::_create_skeletons`:562 — bone names are unique within the skeleton AND against scene
  // node names, but may repeat between skeletons (a `skel_unique_names` copy per skeleton).
  for (const skeleton of skeletons) {
    const skeletonNames = new Set(uniqueNames);
    skeleton.boneNodes.forEach((nodeIndex, boneIndex) => {
      const node = doc.nodes[nodeIndex] as GltfNode;
      const boneName =
        namingVersion < 2
          ? genUniqueBoneName(uniqueNames, node.name)
          : genUniqueBoneName(skeletonNames, node.name);
      if (namingVersion >= 2) uniqueNames.add(boneName);
      const parentNode = doc.parents[nodeIndex] as number;
      skeleton.bones.push({
        index: boneIndex,
        name: boneName,
        parent: skeleton.boneNodes.indexOf(parentNode),
        // `_parse_nodes`:595 stores `GODOT_rest_transform` as the node's own parsed transform.
        rest: node.transform,
        gltfNodeIndex: nodeIndex,
        pose: { position: node.transform.origin, rotation: basisRotationQuaternion(node.transform), scale: basisScale(node.transform) },
      });
      nodeNames.set(nodeIndex, boneName);
    });
  }

  // `_parse_meshes`:1427 — the ImporterMesh's resource name, `<scene name>_<glTF mesh name>`,
  // drawn from the SAME uniquifier and therefore after every node name.
  const meshResourceNames = doc.meshes.map((mesh) =>
    genUniqueName(uniqueNames, `${sceneName}_${mesh.name === '' ? 'mesh' : mesh.name}`),
  );

  // ---- generate the tree -------------------------------------------------------------------
  const root: MutableSceneNode = {
    name: '',
    nodeClass: node3DClass,
    transform: IDENTITY_TRANSFORM,
    visible: true,
    children: [],
  };
  /** glTF node index -> the Godot node it became (a Skeleton3D, for a joint). */
  const sceneNodes = new Map<number, MutableSceneNode>();
  const skeletonNodes = new Map<number, MutableSceneNode>();

  const meshInfoFor = (node: GltfNode): GlbMeshInfo => {
    const mesh = doc.meshes[node.mesh as number];
    if (mesh === undefined) {
      throw new GltfParseError(
        `${resPath}: nodes[${node.index}] names mesh ${node.mesh}, which does not exist`,
      );
    }
    return {
      meshClass: 'ArrayMesh',
      resourceName: meshResourceNames[node.mesh as number] as string,
      surfaces: mesh.primitives.map((primitive, index) => {
        const material =
          primitive.material === undefined ? undefined : doc.materials[primitive.material];
        return {
          index,
          materialClass: material === undefined ? undefined : standardMaterialClass,
          materialName:
            material === undefined
              ? undefined
              : material.name === ''
                ? `material_${primitive.material}`
                : material.name,
        };
      }),
    };
  };

  const generate = (nodeIndex: number, parent: MutableSceneNode): void => {
    const node = doc.nodes[nodeIndex] as GltfNode;
    const skeletonIndex = skeletonOfNode.get(nodeIndex);
    if (skeletonIndex !== undefined) {
      // `_generate_skeleton_bone_node`:4677 — the FIRST joint reached puts the Skeleton3D into the
      // tree under whatever scene parent that joint had; every joint then contributes only a bone.
      const skeleton = skeletons[skeletonIndex] as SynthesizedSkeleton;
      let skeletonNode = skeletonNodes.get(skeletonIndex);
      if (skeletonNode === undefined) {
        skeletonNode = {
          name: skeletonClass,
          nodeClass: skeletonClass,
          transform: IDENTITY_TRANSFORM,
          visible: true,
          bones: skeleton.bones,
          children: [],
        };
        skeletonNodes.set(skeletonIndex, skeletonNode);
        addChild(parent, skeletonNode);
      }
      sceneNodes.set(nodeIndex, skeletonNode);
      for (const child of node.children) generate(child, skeletonNode);
      return;
    }

    if (node.skin !== undefined && node.mesh !== undefined) {
      // `_attach_node_to_skeleton`:4705 — a SKINNED mesh is added directly to its skeleton, with no
      // BoneAttachment3D and with its glTF node transform DISCARDED (glTF 2.0 §3.8: a skinned
      // mesh's node transform is ignored, the skeleton drives it).
      const skinSkeleton = doc.skins[node.skin]?.joints[0];
      const skeletonIndexForSkin =
        skinSkeleton === undefined ? undefined : skeletonOfNode.get(skinSkeleton);
      if (skeletonIndexForSkin === undefined) {
        throw new GltfParseError(
          `${resPath}: nodes[${node.index}] uses skin ${node.skin}, whose joints did not become a skeleton`,
        );
      }
      if (node.children.length > 0) {
        throw new GltfParseError(
          `${resPath}: nodes[${node.index}] is a skinned mesh WITH children; Godot inserts a placeholder Node3D there (_does_skinned_mesh_require_placeholder_node, :4569) and this reader has not measured that case`,
        );
      }
      // Godot generates the skinned mesh's SIBLINGS first only if they come first in `children`;
      // the skeleton must already be in the tree, which `_generate_scene_node` guarantees by
      // reaching the joint subtree from the same parent. Reproduce by generating the joints first.
      let skeletonNode = skeletonNodes.get(skeletonIndexForSkin);
      if (skeletonNode === undefined) {
        const skeleton = skeletons[skeletonIndexForSkin] as SynthesizedSkeleton;
        skeletonNode = {
          name: skeletonClass,
          nodeClass: skeletonClass,
          transform: IDENTITY_TRANSFORM,
          visible: true,
          bones: skeleton.bones,
          children: [],
        };
        skeletonNodes.set(skeletonIndexForSkin, skeletonNode);
        addChild(parent, skeletonNode);
      }
      const meshNode: MutableSceneNode = {
        name: nodeNames.get(nodeIndex) as string,
        nodeClass: meshInstanceClass,
        transform: IDENTITY_TRANSFORM,
        visible: true,
        mesh: meshInfoFor(node),
        skeletonPath: '..',
        skinBindCount: doc.skins[node.skin]?.joints.length ?? -1,
        gltfNodeIndex: nodeIndex,
        ...(node.name === '' ? {} : { gltfName: node.name }),
        children: [],
      };
      addChild(skeletonNode, meshNode);
      sceneNodes.set(nodeIndex, meshNode);
      return;
    }

    const generated: MutableSceneNode = {
      name: nodeNames.get(nodeIndex) as string,
      nodeClass: importedClassOf(node),
      transform: node.transform,
      visible: true,
      ...(node.mesh === undefined
        ? {}
        : { mesh: meshInfoFor(node), skeletonPath: '', skinBindCount: -1 }),
      gltfNodeIndex: nodeIndex,
      ...(node.name === '' ? {} : { gltfName: node.name }),
      children: [],
    };
    addChild(parent, generated);
    sceneNodes.set(nodeIndex, generated);
    for (const child of node.children) generate(child, generated);
  };

  for (const rootNode of rootNodes) generate(rootNode, root);

  // `_generate_scene_node_tree`:7072 — the synthesized root takes the scene name, uniquified only
  // when the naming version did not already uniquify it in `_parse_scenes`.
  root.name = namingVersion === 0 ? sceneName : genUniqueName(uniqueNames, sceneName);

  // `_replace_node_with_type_and_script`:1395 replaces only the synthesized root object when
  // `nodes/root_type` names another class. The generated child tree is reparented unchanged. Keep
  // that exact authored class identity: Mossling.glb uses CharacterBody3D while Godot 3 imports
  // commonly use KinematicBody/Spatial. The analyzer has no invented storage defaults to transfer;
  // importer-authored properties remain the transform/name handled below.
  if (!isUnchangedGlbRootType(importParams.rootType)) root.nodeClass = importParams.rootType;
  // `resource_importer_scene.cpp:3319` — and its own comment: "Scene Root" is a legacy placeholder
  // that means NO override, which is why 12 of `starter-kit-3d-platformer`'s sidecars carry it and
  // none of their roots is called that.
  if (importParams.rootName !== '' && importParams.rootName !== 'Scene Root') {
    root.name = importParams.rootName;
  }

  // ---- the AnimationPlayer -----------------------------------------------------------------
  if (importParams.animationImport && doc.animations.length > 0) {
    const player: MutableSceneNode = {
      name: 'AnimationPlayer',
      nodeClass: 'AnimationPlayer',
      transform: IDENTITY_TRANSFORM,
      visible: true,
      // `AnimationPlayer::root_node` defaults to `..`, and `generate_scene` never changes it.
      animationRootNode: '..',
      animations: buildAnimations(
        doc,
        resPath,
        importParams,
        sceneNodes,
        skeletons,
        skeletonNodes,
        root,
      ),
      children: [],
    };
    addChild(root, player);
  }

  // `resource_importer_scene.cpp:3261` — `nodes/root_scale`, applied one of two ways and neither
  // of them "set the root's scale property and be done". With `apply_root_scale` ON (the default)
  // the scale is BAKED PERMANENTLY into descendants: every `Node3D`'s POSITION is multiplied
  // (basis untouched), every `Skeleton3D` bone rest's origin with it, and the mesh, skin and
  // animation RESOURCES are rescaled (`_apply_scale_to_scalable_node_collection`:599). With it OFF
  // the root node's own basis is scaled (`Node3D::scale`). `brick.glb` in
  // `starter-kit-3d-platformer` is the case that made this measurable — `root_scale=0.75` with the
  // flag on, and the dumped tree's transforms are all IDENTITY, because at that document's shape
  // the whole 0.75 went into vertex data this reader does not read.
  if (importParams.rootScale !== 1) {
    const s = importParams.rootScale;
    if (importParams.applyRootScale) {
      const scaleOrigins = (node: MutableSceneNode): void => {
        node.transform = {
          basisX: node.transform.basisX,
          basisY: node.transform.basisY,
          basisZ: node.transform.basisZ,
          origin: [
            node.transform.origin[0] * s,
            node.transform.origin[1] * s,
            node.transform.origin[2] * s,
          ],
        };
        if (node.bones !== undefined) {
          node.bones = node.bones.map((bone) => ({
            ...bone,
            rest: {
              ...bone.rest,
              origin: [bone.rest.origin[0] * s, bone.rest.origin[1] * s, bone.rest.origin[2] * s],
            },
          }));
        }
        for (const child of node.children) scaleOrigins(child);
      };
      scaleOrigins(root);
    } else {
      root.transform = {
        basisX: root.transform.basisX.map((c) => c * s) as unknown as readonly [
          number,
          number,
          number,
        ],
        basisY: root.transform.basisY.map((c) => c * s) as unknown as readonly [
          number,
          number,
          number,
        ],
        basisZ: root.transform.basisZ.map((c) => c * s) as unknown as readonly [
          number,
          number,
          number,
        ],
        origin: root.transform.origin,
      };
    }
  }

  const nodes: GlbSceneNode[] = [];
  const walk = (node: MutableSceneNode, path: string): void => {
    nodes.push({
      name: node.name,
      nodeClass: node.nodeClass,
      path,
      transform: node.transform,
      visible: node.visible,
      ...(node.mesh === undefined ? {} : { mesh: node.mesh }),
      ...(node.skeletonPath === undefined ? {} : { skeletonPath: node.skeletonPath }),
      ...(node.skinBindCount === undefined ? {} : { skinBindCount: node.skinBindCount }),
      ...(node.bones === undefined ? {} : { bones: node.bones }),
      ...(node.animationRootNode === undefined
        ? {}
        : { animationRootNode: node.animationRootNode }),
      ...(node.animations === undefined ? {} : { animations: node.animations }),
      ...(node.gltfNodeIndex === undefined ? {} : { gltfNodeIndex: node.gltfNodeIndex }),
      ...(node.gltfName === undefined ? {} : { gltfName: node.gltfName }),
    });
    for (const child of node.children) {
      walk(child, path === '.' ? child.name : `${path}/${child.name}`);
    }
  };
  walk(root, '.');
  const inScene = new Set(doc.sceneRootNodes);
  const sceneRootPaths = nodes
    .filter((node) => node.gltfNodeIndex !== undefined && inScene.has(node.gltfNodeIndex))
    .map((node) => node.path);
  return {
    resPath,
    nodes,
    sceneRootPaths,
    externalImageUris: doc.externalImageUris,
    sourceMaterials: doc.materials.map((material) => ({
      ...(material.sourceName === undefined ? {} : { name: material.sourceName }),
      ...(material.alphaMode === undefined ? {} : { alphaMode: material.alphaMode }),
    })),
  };
}

/**
 * The `AnimationPlayer`'s clips: which tracks each one carries, and in what order.
 *
 * Three engine passes produce this, and the interesting one is not where you would look:
 *
 *  1. `_import_animation` (gltf_document.cpp:5578) turns each glTF animation into an `Animation`,
 *     one track per PRESENT channel, nodes in the order the channels first mention them and
 *     position/rotation/scale within each node. It takes a `remove_immutable_tracks` argument —
 *     **and the editor's importer passes it a hardcoded `false`**
 *     (`editor_scene_importer_gltf.cpp:82`, `generate_scene(state, fps, trimming, false)`). Reading
 *     the parameter's name and assuming the sidecar's `animation/remove_immutable_tracks` reaches
 *     it is the trap: it does not, and a reader built on that assumption drops tracks the engine
 *     keeps.
 *  2. `_optimize_track_usage` (resource_importer_scene.cpp:2915), from `_pre_fix_animations`,
 *     implements `import_tracks/*` = "If Present for All": every (node, channel) pair ANY clip
 *     carries is added to EVERY clip. This is why all four of `character.glb`'s clips carry ten
 *     tracks while none of them animates ten channels, and — measured with the sidecar's flag
 *     forced off, which leaves this pass as the only one running — why every clip then carries the
 *     full node × {position, rotation, scale} grid.
 *  3. `_post_fix_animations` (:1128) is where the sidecar's `animation/remove_immutable_tracks`
 *     actually lands. It drops a (node, channel) pair when, across EVERY clip, no key differs from
 *     the node's own rest value — a bone's rest transform for a `Skeleton3D:<bone>` path, the
 *     node's position/rotation/scale otherwise (:1196-1216). Because the verdict is taken over all
 *     clips at once, the surviving set is the same for every clip; only the ORDER differs.
 *
 * ## The ordering rule, and why it is cited to the dump rather than to the source
 *
 * The measured order is: the clip's OWN nodes first, in that clip's glTF first-mention order, then
 * the nodes only other clips mention; within each node, position, rotation, scale. Every one of the
 * eight clips across the two fixtures matches it exactly, including the four `character.glb` clips
 * whose node orders are four different permutations of the same seven nodes.
 *
 * That is NOT what a straight reading of pass 2 predicts — `Animation::add_track`
 * (animation.cpp:896) appends, and pass 3's only reordering is a `track_swap` compaction that
 * preserves relative order — so the grouping is recorded here as an observation of the engine's
 * output rather than as a derivation. The observation is the stronger claim of the two: the dump is
 * what the engine did.
 *
 * `length` is `anim_end - anim_start` (:5903), the greatest key time with trimming off, floored by
 * `Animation::set_length`'s own 0.001 minimum. `step` is `1 / animation/fps`. Loop mode comes from
 * the sidecar's per-clip `settings/loop_mode`, or from a clip whose name begins or ends with
 * `loop`/`cycle` (`_parse_animations`:3832).
 */
function buildAnimations(
  doc: GltfDocument,
  resPath: string,
  importParams: GodotSceneImportParams,
  sceneNodes: ReadonlyMap<number, MutableSceneNode>,
  skeletons: readonly SynthesizedSkeleton[],
  skeletonNodes: ReadonlyMap<number, MutableSceneNode>,
  root: MutableSceneNode,
): GlbAnimationClip[] {
  const pathOf = new Map<MutableSceneNode, string>();
  const walkPaths = (node: MutableSceneNode, path: string): void => {
    pathOf.set(node, path);
    for (const child of node.children) {
      walkPaths(child, path === '' ? child.name : `${path}/${child.name}`);
    }
  };
  walkPaths(root, '');

  const boneOfNode = new Map<number, { readonly skeleton: number; readonly bone: GlbBone }>();
  skeletons.forEach((skeleton, index) => {
    skeleton.boneNodes.forEach((nodeIndex, boneIndex) => {
      boneOfNode.set(nodeIndex, { skeleton: index, bone: skeleton.bones[boneIndex] as GlbBone });
    });
  });

  const trackPathOf = (nodeIndex: number): string => {
    const bone = boneOfNode.get(nodeIndex);
    if (bone !== undefined) {
      const skeletonNode = skeletonNodes.get(bone.skeleton);
      if (skeletonNode === undefined) {
        throw new GltfParseError(`${resPath}: an animated joint's skeleton never entered the tree`);
      }
      return `${pathOf.get(skeletonNode) as string}:${bone.bone.name}`;
    }
    const node = sceneNodes.get(nodeIndex);
    if (node === undefined) {
      throw new GltfParseError(
        `${resPath}: animation targets glTF node ${nodeIndex}, which produced no Godot node`,
      );
    }
    return pathOf.get(node) as string;
  };

  const CHANNEL_TYPES = [
    { key: 'translation', type: 1 },
    { key: 'rotation', type: 2 },
    { key: 'scale', type: 3 },
  ] as const;

  const animationNames = new Set<string>();
  interface ParsedClip {
    readonly name: string;
    /** `animations[i].name` verbatim, and `i` — see {@link GlbAnimationClip.gltfName}. */
    readonly gltfName: string;
    readonly gltfIndex: number;
    readonly loopMode: number;
    readonly length: number;
    /** glTF node indices in this clip's own first-mention order. */
    readonly nodeOrder: readonly number[];
    /** `"<node>:<channel type>"` -> does at least one key differ from the node's rest value? */
    readonly moves: ReadonlyMap<string, boolean>;
  }

  const clips: ParsedClip[] = doc.animations.map((animation, gltfIndex) => {
    const name = genUniqueName(
      animationNames,
      animation.name === '' ? 'Animation' : animation.name,
    );
    const lower = name.toLowerCase();
    const nameLoops =
      lower.startsWith('loop') ||
      lower.endsWith('loop') ||
      lower.startsWith('cycle') ||
      lower.endsWith('cycle');
    const sidecarLoop = importParams.animationLoopModes[name];

    const nodeOrder: number[] = [];
    const moves = new Map<string, boolean>();
    let end = 0;
    for (const channel of animation.channels) {
      if (!nodeOrder.includes(channel.node)) nodeOrder.push(channel.node);
      for (const time of channel.times) end = Math.max(end, time);
      const node = doc.nodes[channel.node];
      if (node === undefined) continue;
      const type = (
        CHANNEL_TYPES.find((entry) => entry.key === channel.path) as { type: 1 | 2 | 3 }
      ).type;
      // `_post_fix_animations`:1196-1216 reads the REST TRANSFORM, not the glTF TRS: a bone's
      // `bone_rest`, a node's own transform, then `origin` / `get_rotation_quaternion()` /
      // `get_scale()` off it. For rotation that round trip is what makes two of `player.glb`'s
      // near-180° tracks survive — see `basisRotationQuaternion`.
      const quaternion = channel.path === 'rotation';
      const base = quaternion
        ? basisRotationQuaternion(node.transform)
        : channel.path === 'scale'
          ? basisScale(node.transform)
          : node.transform.origin;
      const differs = channel.values.some(
        (value) => !vectorEqualApprox(quaternion ? normalizedQuaternion(value) : value, base),
      );
      moves.set(`${channel.node}:${type}`, differs);
    }
    return {
      name,
      gltfName: animation.name,
      gltfIndex,
      loopMode: sidecarLoop ?? (nameLoops ? 1 : 0),
      length: Math.max(0.001, end),
      nodeOrder,
      moves,
    };
  });

  // `AnimationPlayer::get_animation_list` returns the library's names SORTED, and every pass below
  // iterates in that order — which is what fixes the order of the nodes a clip does not itself
  // mention.
  clips.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Pass 2 + pass 3, as one set: a (node, channel) pair is in every clip when SOME clip animates it
  // and, under `animation/remove_immutable_tracks`, some clip's keys for it differ from rest.
  const kept = new Set<string>();
  const unionNodeOrder: number[] = [];
  for (const clip of clips) {
    for (const node of clip.nodeOrder)
      if (!unionNodeOrder.includes(node)) unionNodeOrder.push(node);
    for (const [key, differs] of clip.moves) {
      if (!importParams.animationRemoveImmutableTracks || differs) kept.add(key);
    }
  }

  return clips.map((clip) => {
    const nodes = [
      ...clip.nodeOrder,
      ...unionNodeOrder.filter((node) => !clip.nodeOrder.includes(node)),
    ];
    const tracks: GlbAnimationTrack[] = [];
    for (const nodeIndex of nodes) {
      const path = trackPathOf(nodeIndex);
      for (const { type } of CHANNEL_TYPES) {
        if (kept.has(`${nodeIndex}:${type}`)) tracks.push({ type, path });
      }
    }
    return {
      name: clip.name,
      loopMode: clip.loopMode,
      step: 1 / importParams.animationFps,
      length: clip.length,
      tracks,
      gltfName: clip.gltfName,
      gltfIndex: clip.gltfIndex,
    };
  });
}
