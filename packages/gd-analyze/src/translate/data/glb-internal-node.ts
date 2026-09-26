/**
 * translate/glb-internal-node.ts — the address of a node INSIDE an instanced `.glb`, as the
 * emitted runtime can reach it.
 *
 * ## The problem
 *
 * A `.tscn` that instances an imported model PATCHES nodes inside it, two spellings of one thing:
 *
 * ```
 * [node name="character" instance=ExtResource("1_vn7w5")]      # the root IS the model
 * [node name="torso" parent="character/root" index="2"]        # a path the document never authors
 * transform = Transform3D(…)
 * ```
 * ```
 * [node name="cube" instance=ExtResource("1_pjiy0")]           # cloud.tscn
 * [node name="cloud2" parent="." index="0"]                    # a child with no class of its own
 * surface_material_override/0 = SubResource("StandardMaterial3D_m5bs8")
 * ```
 *
 * The emitted scene contributes the model as ONE object — `cloneGodotModel(ctx.models, …)`, a
 * `SkeletonUtils.clone` of what three's `GLTFLoader` built — so carrying either line means reaching
 * a specific `Object3D` inside that clone. This module is the ONE place that says which one.
 *
 * ## Why the Godot node path is not the answer, MEASURED
 *
 * Godot's importer and three's `GLTFLoader` both rename glTF nodes, by DIFFERENT rules, and the
 * difference is not a suffix convention — the two engines resolve the same collision on DIFFERENT
 * objects. Measured on `starter-kit-3d-platformer`'s own models (Godot 4.7-stable's tree from
 * `test/ground-truth/godot47-glb-scene-starter-kit.json`; three 0.180.0 by loading the same bytes
 * through `GLTFLoader.parseAsync`):
 *
 * | `.glb` | glTF file | Godot node path | three `Object3D.name` | three `userData.name` |
 * | --- | --- | --- | --- | --- |
 * | `cloud.glb` | scene `cloud`, node `cloud` | `.` = `cloud`, child `cloud2` | `cloud`, child `cloud_1` | — , `cloud` |
 * | `character.glb` | scene `character`, node `character` | `.` = `character2`, child `character` | `character`, child `character_1` | — , `character` |
 *
 * Both files name their scene and their one root node the same string; Godot gave the `2` suffix to
 * the SYNTHESIZED ROOT in one file and to the glTF node in the other (`gltf/naming_version` decides
 * — `read/gltf-godot-scene.ts`'s header), while three gave `_1` to the glTF node in both. So the
 * Godot path segment (`cloud2`, `character`) and three's `Object3D.name` (`cloud_1`,
 * `character_1`) are two different strings for the same object, and neither is a function of the
 * other without re-running both uniquifiers.
 *
 * The sanitizers differ too, and in both directions. Godot's `validate_node_name` strips
 * `. : @ / " %` and appends `2`, `3`, … (`_gen_unique_name`, gltf_document.cpp:462, transcribed in
 * `read/gltf-godot-scene.ts`); three's `PropertyBinding.sanitizeNodeName` replaces `\s` with `_`,
 * strips `[ ] . : /`, and `GLTFParser.createUniqueName` appends `_1`, `_2`, … over a counter SHARED
 * with mesh, camera, light and scene names (`three/src/animation/PropertyBinding.js:184-188`,
 * `three/examples/jsm/loaders/GLTFLoader.js:3779-3794`, version 0.180.0 as vendored). Simulating
 * three's counter would mean reproducing its promise-scheduling order, which is exactly the kind of
 * plausible-and-silently-wrong the lane refuses.
 *
 * ## The ONE name both engines agree on
 *
 * `nodeDef.name` — the raw string in the glTF file. three keeps it verbatim, unsanitized and
 * un-uniquified, on `Object3D.userData.name` (`GLTFLoader.js:4415-4419`,
 * `node.userData.name = nodeDef.name`), and `SkeletonUtils.clone` carries `userData` onto the clone
 * (measured on `character.glb`: every one of its eight glTF nodes keeps it). Godot's reader records the
 * same string per node (`GlbSceneNode.gltfName` → `SceneDocument.gltfOrigin.nameByPath`). So the
 * address is a chain of RAW glTF names, and the runtime descends by `userData.name`
 * (`godot-compat/gltf-model.ts`'s `godotModelNode`).
 *
 * That choice also disposes of the multi-primitive mesh for free: three splits a glTF mesh with N
 * primitives into a `Group` of N `Mesh` children (`GLTFLoader.js:4390-4400`) which Godot keeps as
 * one `MeshInstance3D` with N surfaces, and those extra children carry no `userData.name` — so a
 * name descent walks past them where an ordinal descent would have to count them.
 *
 * ## …and the ONE line that has to count them anyway: a per-SURFACE material override
 *
 * `surface_material_override/<s>` does not address a node; it addresses one SURFACE of the mesh at
 * that node, and in three a surface is its own object. {@link glbInternalSurfaceCount} is the fact
 * the emitter needs to say which one, and it is the mesh's surface count — because the mapping
 * from a Godot surface index to a three object is decided entirely by whether that count is one:
 *
 *  - **A Godot surface IS a glTF primitive.** `read/gltf-godot-scene.ts` builds one
 *    `GlbMeshSurface` per `mesh.primitives[i]`, index and all. Cross-checked against the engine in
 *    `translate/data/external-materials.ts`'s live Godot 3.6 run: `res://art/mob.glb`'s surfaces 0/1/2
 *    hold `mob_eye`/`mob_body`/`pupil`, and the file's own primitive order is
 *    `[mob_eye, mob_body, pupil]`.
 *  - **A three primitive mesh IS a glTF primitive, in the same order.** `GLTFParser.loadMesh`
 *    pushes one `Mesh` per primitive and records `associations.set( meshes[ i ], { meshes:
 *    meshIndex, primitives: i } )`; with ONE primitive it returns `meshes[ 0 ]` and with several it
 *    builds `const group = new Group();` and `group.add( meshes[ i ] )` over the same loop
 *    (`three/examples/jsm/loaders/GLTFLoader.js`, 0.180.0 as vendored). `_loadNodeShallow` then
 *    makes that value the NODE itself (`objects.length === 1` → `node = objects[ 0 ]`), and
 *    `loadNode` adds the node's glTF CHILDREN only afterwards — its own comment says so: "child
 *    glTF nodes have not been added to this node yet".
 *
 * So a one-surface node is a `Mesh` and its surface 0 is that mesh; an N-surface node is a `Group`
 * whose first N children are the surfaces in order. Measured on the real bytes as well as read:
 * `cloud.glb`'s `cloud2` loads as a `Mesh` (one primitive), and `mob.glb`'s `Sphere` loads as a
 * `Group` over `Sphere_1`/`Sphere_2`/`Sphere_3` carrying exactly those three materials.
 * `godot-compat`'s `godotModelSurface` is the runtime half and asserts the shape it was told.
 *
 * ## What is refused, and never approximated
 *
 * Every case below throws a `TranslateError` naming the construct. There is deliberately no
 * best-effort branch: a patch that silently lands on the wrong object is the outcome the whole
 * refusal this replaces existed to prevent.
 */
import type { SceneDocument, SceneNode } from '../../read/godot-types';
import { TranslateError } from './model';

/** Where a `.tscn`'s `[node]` patch lands inside a loaded `.glb`. */
export interface GlbInternalAddress {
  /**
   * RAW glTF node names, outermost first, from the loaded `gltf.scene` down. Never empty — the
   * model ROOT is the clone itself and needs no address.
   */
  readonly gltfNames: readonly string[];
}

/** Every node of a document by its Godot path, plus the parent path of each. */
function indexNodes(document: SceneDocument): {
  byPath: Map<string, SceneNode>;
  parentOf: Map<string, string>;
} {
  const byPath = new Map<string, SceneNode>();
  const parentOf = new Map<string, string>();
  const walk = (node: SceneNode, parent: string | undefined): void => {
    byPath.set(node.path, node);
    if (parent !== undefined) parentOf.set(node.path, parent);
    for (const child of node.children) walk(child, node.path);
  };
  if (document.root !== undefined) walk(document.root, undefined);
  return { byPath, parentOf };
}

/** Every fact one step of the walk is adjudicated against, gathered once so the step can read. */
interface ModelIndex {
  readonly document: SceneDocument;
  readonly origin: NonNullable<SceneDocument['gltfOrigin']>;
  readonly byPath: ReadonlyMap<string, SceneNode>;
  readonly parentOf: ReadonlyMap<string, string>;
}

/** ONE segment of the walk: the raw glTF name at `path`, or the refusal that stops the address. */
function gltfNameAt(index: ModelIndex, path: string, isRoot: boolean, at: string): string {
  const { document, origin, byPath, parentOf } = index;
  const node = byPath.get(path);
  if (node === undefined) {
    throw new TranslateError(
      at,
      `\`${document.resPath}\` has no node \`${path}\`, so it addresses nothing in the model this ` +
        'scene instances.',
    );
  }
  const gltfName = origin.nameByPath.get(path);
  if (gltfName === undefined) {
    throw new TranslateError(
      at,
      `\`${path}\` (a \`${node.type ?? '?'}\`) inside \`${document.resPath}\` is a node GODOT'S ` +
        'IMPORTER made, not one the glTF file contains — a synthesized `Skeleton3D` or ' +
        "`AnimationPlayer`, or a node the file leaves unnamed. three's loader builds no object " +
        'carrying that name, so there is nothing in the loaded model to reach.',
    );
  }
  if (isRoot && !origin.sceneRootPaths.includes(path)) {
    throw new TranslateError(
      at,
      `\`${path}\` is a root of the tree GODOT builds from \`${document.resPath}\` but is not ` +
        "in the glTF's own `scenes[].nodes`, which is what three builds `gltf.scene` from " +
        '(Godot ignores that list below `gltf/naming_version = 2`). The loaded model does not ' +
        'contain it.',
    );
  }
  const parentPath = parentOf.get(path);
  const siblings = parentPath === undefined ? [] : (byPath.get(parentPath)?.children ?? []);
  const sharing = siblings.filter((one) => origin.nameByPath.get(one.path) === gltfName);
  if (sharing.length > 1) {
    throw new TranslateError(
      at,
      `\`${path}\` inside \`${document.resPath}\` shares its glTF name \`${gltfName}\` with ` +
        `${sharing.length - 1} sibling(s) (${sharing.map((one) => `\`${one.path}\``).join(', ')}). ` +
        'Godot told them apart with its own uniquifier and three told them apart with a ' +
        "different one, so the file's name no longer names one object.",
    );
  }
  return gltfName;
}

/**
 * The three address of `insidePath` within the imported model `document`, or a `TranslateError`
 * naming exactly what stopped it.
 *
 * `insidePath` is Godot's own spelling relative to the model's root — `character/root/torso`,
 * `cloud2` — and never `.`.
 */
export function glbInternalAddress(
  document: SceneDocument,
  insidePath: string,
  at: string,
): GlbInternalAddress {
  const origin = document.gltfOrigin;
  if (origin === undefined) {
    throw new TranslateError(
      at,
      `\`${document.resPath}\` is not a model this reader opened as a glTF, so nothing states ` +
        `which object inside it \`${insidePath}\` is. Only a \`.glb\` read by ` +
        "read/gltf-godot-scene.ts carries the file's own node names.",
    );
  }
  if (insidePath === '.') {
    throw new TranslateError(
      at,
      `\`${document.resPath}\`'s ROOT is the loaded model itself, not a node inside it; a patch ` +
        "on it is the instancing line's own properties and does not belong here.",
    );
  }
  const index: ModelIndex = { document, origin, ...indexNodes(document) };
  const segments = insidePath.split('/');
  const names: string[] = [];
  for (let i = 1; i <= segments.length; i += 1) {
    const path = segments.slice(0, i).join('/');
    // Godot inserts Skeleton3D between the glTF armature node and its skinned mesh. three keeps
    // the file's hierarchy, so that importer-only segment contributes no runtime name; the next
    // file-authored node is still addressed by its own recorded glTF name.
    if (origin.boneNamesByPath.has(path)) continue;
    names.push(gltfNameAt(index, path, names.length === 0, at));
  }
  return { gltfNames: names };
}

/**
 * How many SURFACES the mesh at `insidePath` inside `document` has — the fact a per-surface
 * material override is addressed against, and the shape the emitted runtime asserts.
 *
 * A node with no mesh refuses: `surface_material_override/<s>` is a `MeshInstance3D` property
 * (Godot's own `_get_property_list` writes one entry per `mesh->get_surface_count()`), so a line
 * carrying one on a node that draws nothing is a document this reader cannot make sense of rather
 * than an override to drop.
 */
export function glbInternalSurfaceCount(
  document: SceneDocument,
  insidePath: string,
  at: string,
): number {
  const count = document.gltfOrigin?.surfaceCountByPath.get(insidePath);
  if (count === undefined) {
    throw new TranslateError(
      at,
      `\`${insidePath}\` inside \`${document.resPath}\` draws no mesh, so it has no surface for a ` +
        'per-surface material override to name. Godot exposes one ' +
        '`surface_material_override/<s>` slot per mesh surface and none at all without a mesh.',
    );
  }
  return count;
}

export function requireOpenedInstancedScene<T>(
  at: string,
  resPath: string,
  document: T | undefined,
  kind: 'static-body' | 'added-node' | 'patch',
): T {
  if (document !== undefined) return document;
  if (kind === 'static-body') {
    throw new TranslateError(
      at,
      `adds a StaticBody inside \`${resPath}\`, which this project did not open as a scene.`,
    );
  }
  if (kind === 'added-node') {
    throw new TranslateError(
      at,
      `adds a node inside \`${resPath}\`, which this project did not open as a scene.`,
    );
  }
  throw new TranslateError(
    at,
    `patches into \`${resPath}\`, which this project did not open as a scene — so ` +
      'nothing states which object inside the loaded model the line names.',
  );
}

export function refuseAddedGlbClass(at: string, declaredType: string, resPath: string): never {
  throw new TranslateError(
    at,
    `declares its own class \`${declaredType}\`, so it ADDS a node inside the instanced ` +
      `\`${resPath}\` rather than patching one the model already contains. Building a ` +
      'node and parenting it into a loaded model is a different carry from overriding one, ' +
      'and this emitter has only the second. StaticBody + CollisionShape (the FPS ' +
      'platform/wall collision) and RayCast (added inside an instanced model) are the ' +
      'added-node carries.',
  );
}

export function refuseUncarriedGlbPatch(
  at: string,
  insidePath: string,
  resPath: string,
  uncarried: readonly string[],
): void {
  if (uncarried.length === 0) return;
  throw new TranslateError(
    at,
    `patches \`${insidePath}\` inside the instanced \`${resPath}\` with ` +
      `${uncarried.length} authored propert${uncarried.length === 1 ? 'y' : 'ies'} this ` +
      `carry does not reach: ${uncarried.join(', ')}. Reaching a node inside a loaded model ` +
      'carries `transform`, `visible` and a per-surface material override; anything else ' +
      'would be dropped with nothing in the output saying so, which is the whole reason this ' +
      'line refuses instead.',
  );
}

export function refuseMissingGlbSurface(
  at: string,
  key: string,
  insidePath: string,
  resPath: string,
  surfaceCount: number,
): void {
  throw new TranslateError(
    at,
    `authors \`${key}\`, but \`${insidePath}\` inside \`${resPath}\` draws ` +
      `${String(surfaceCount)} surface(s). Godot exposes one override slot per surface, so ` +
      'this line names a surface the model does not have.',
  );
}

export function requireGlbAnimationPlayerNode<T>(
  at: string,
  resPath: string,
  node: T | undefined,
): T {
  if (node !== undefined) return node;
  throw new TranslateError(
    at,
    `patches the \`AnimationPlayer\` inside \`${resPath}\` through a parent this document ` +
      'never places, so the emitter has no node to hang the player on. The importer parents it ' +
      "at the model's own root and every measured `.tscn` patches it there.",
  );
}

export function requireGlbPlayerRootNode(at: string, resPath: string, rootNode: string): void {
  if (rootNode === '..') return;
  throw new TranslateError(
    at,
    `the \`AnimationPlayer\` inside \`${resPath}\` has \`root_node = ` +
      `"${rootNode}"\`, not \`".."\`. Its tracks would resolve against a different node ` +
      'than the model this scene clones, and the mixer here is rooted at the clone — so the ' +
      'poses would land on the wrong objects.',
  );
}

export function refuseUncarriedGlbPlayerProperties(
  at: string,
  resPath: string,
  uncarried: readonly string[],
  carried: readonly string[],
): void {
  if (uncarried.length === 0) return;
  throw new TranslateError(
    at,
    `patches the \`AnimationPlayer\` inside the instanced \`${resPath}\` with ` +
      `${uncarried.length} authored propert${uncarried.length === 1 ? 'y' : 'ies'} this carry ` +
      `does not reach: ${uncarried.join(', ')}. The carried set is ` +
      `${carried.join(', ')}; ` +
      'anything else would be dropped with nothing in the output saying so.',
  );
}

export function refuseGlbAnimationNameCollisions(
  at: string,
  resPath: string,
  collisions: readonly (readonly [string, readonly string[]])[],
): void {
  if (collisions.length === 0) return;
  throw new TranslateError(
    at,
    `\`${resPath}\` has ${collisions.length} animation name(s) that three's loader would ` +
      `build more than one clip for: ${collisions
        .map(([key, names]) => `\`${key}\` (Godot: ${names.join(', ')})`)
        .join(
          '; ',
        )}. Godot told them apart with its own uniquifier and three keeps the file's ` +
      'name verbatim, so the file name no longer names one clip.',
  );
}
