/**
 * `Node` over a three scene graph — the 3D half of `node.ts`.
 *
 * Same rule, same shape, different tree: **there is no `Node` class here.** A
 * `THREE.Object3D` already has a name, a parent, children and a transform, so
 * these are functions that take the `Object3D` and hand the `Object3D` back.
 * The transform members live in `spatial.ts`, because Godot declares them on
 * `Spatial` and a touch id is keyed by its DECLARING class.
 *
 * Only the members that genuinely differ between the two trees are here:
 *
 * | Godot | three | what compat actually does |
 * |---|---|---|
 * | `node.name` | `object.name` | nothing — a rename, both ways |
 * | `node.add_child(c)` | `object.add(c)` | nothing — same operation |
 * | `node.get_node(path)` | — | real: Godot walks a PATH over DIRECT children; three has no such lookup |
 * | `node.queue_free()` | — | real: end-of-frame detach, through `deferred.ts` |
 *
 * `visible`/`hide()`/`show()` and `Label.text` are NOT duplicated here: they
 * are one boolean and one string spelled identically on both surfaces, so
 * `node.ts` types them structurally and a three node satisfies those signatures
 * as it stands. Duplicating them would be two implementations of a member that
 * needs none.
 *
 * ## Lookup is STRICT, and it is not three's
 *
 * `Object3D.getObjectByName` searches the whole SUBTREE, recursively. Godot's
 * `$Path` walks DIRECT children, one segment at a time, and is not recursive —
 * so using three's method for a translated `$Pivot/Character` would resolve
 * paths Godot never would, silently, and only in the scenes where a name
 * happens to repeat deeper down. {@link getNode3D} is Godot's walk, and a
 * segment that does not resolve THROWS naming the full path, the failing
 * segment and the names that were available.
 *
 * ## `queue_free` detaches and does not dispose, on purpose
 *
 * Godot's `queue_free()` destroys the node and its resources. Detaching is the
 * unambiguous half and it is what this does. Disposing is NOT, and the
 * difference matters: a three geometry or material is routinely SHARED between
 * objects (every mob cloned from one template), so disposing on free would blank
 * out the siblings of whatever was freed — a rendering corruption three call
 * sites away from the free that caused it. A port that knows its resources are
 * exclusive passes `{ dispose: true }` and gets Godot's whole behaviour; the
 * default trades a leak a port can fix for a corruption it cannot debug. (Pixi's
 * `destroy` draws the same line at shared textures.)
 */

import { Object3D } from 'three';
import { uniqueNodeName } from './node-name';
import type { GodotNodePath } from './node-path';
import {
  godotObjectIsClass,
  godotObjectNative,
  godotObjectScriptValue,
  registerGodotObjectIdentity,
  registerGodotObjectNativeRelease,
  releaseGodotObjectNativeBindings,
} from './object';
import { markGodotObjectFreed } from './object-liveness';
import type { SceneTree } from './scene-tree';

/** Register native state owned by a retained Three node; scene detach and queue_free share this seam. */
export function registerGodotThreeNodeRelease(node: Object3D, release: () => void): () => void {
  return registerGodotObjectNativeRelease(node, release);
}

export function releaseGodotThreeNodeBindings(root: Object3D): void {
  const nodes: Object3D[] = [];
  root.traverse((node) => nodes.push(node));
  for (const node of nodes.reverse()) {
    releaseGodotObjectNativeBindings(node);
  }
}

function createObject3DIdentity(godotClass: string): Object3D {
  const node = new Object3D();
  registerGodotObjectIdentity(node, godotClass);
  return node;
}

/** Runtime nonvisual `Node.new()` retained as an identity-transform Object3D tree node. */
export function createGodotThreeNode(): Object3D {
  return createObject3DIdentity('Node');
}

/** Runtime Godot 3 `Spatial.new()` / Godot 4 `Node3D.new()`. */
export function createGodotThreeNode3D(major: 3 | 4): Object3D {
  return createObject3DIdentity(major === 3 ? 'Spatial' : 'Node3D');
}

/** Runtime Godot 3 `StaticBody.new()` retained as the native scene-tree identity. */
export function createGodotStaticBody3DNode(): Object3D {
  return createObject3DIdentity('StaticBody');
}

/** Runtime `Position3D.new()` / `Marker3D.new()`, both invisible spatial markers. */
export function createGodotThreeMarker3D(major: 3 | 4): Object3D {
  return createObject3DIdentity(major === 3 ? 'Position3D' : 'Marker3D');
}

/** `node.name`. Godot's node name is three's `name`, under the same name. */
export function getName3D(node: Object3D): string {
  return node.name;
}

/** `node.name = "…"`. */
export function setName3D(node: Object3D, name: string, tree?: SceneTree<Object3D>): void {
  const previous = node.name;
  const next = uniqueNodeName(
    name,
    node.parent?.children.filter((sibling) => sibling !== node).map((sibling) => sibling.name) ??
      [],
  );
  if (next === previous) return;
  node.name = next;
  tree?.notifyNodeRenamed(node);
}

const INTERNAL_THREE_CHILDREN = new WeakSet<Object3D>();

export function isInternalThreeChild(node: object): boolean {
  return INTERNAL_THREE_CHILDREN.has(node as Object3D);
}

/**
 * `node.get_parent()`. `null` at the root, matching Godot.
 *
 * Plain `.parent`, including for a `set_as_toplevel(true)` node: Godot's flag
 * detaches transform inheritance and NEVER the tree, and this lane carries it
 * with three's `matrixWorldAutoUpdate = false` (`spatial.ts`), which likewise
 * leaves the node parented exactly where the `.tscn` authored it.
 */
export function getParent3D(node: Object3D): Object3D | null {
  return node.parent;
}

/**
 * Godot 3 `Spatial.get_parent_spatial()` checks only the immediate scene-tree parent and returns
 * null when that parent is a non-Spatial Node. Three gives every adopted node an Object3D carrier,
 * so `.parent` alone cannot preserve that native ClassDB distinction.
 */
export function getParentSpatial3D(node: Object3D): Object3D | null {
  const parent = node.parent;
  return parent !== null && godotObjectIsClass(parent, 'Spatial', 3) ? parent : null;
}

/** `node.add_child(child)` — `Main.gd:30`, `add_child(mob)`. */
export function addChild3D(parent: unknown, child: unknown, tree?: SceneTree<Object3D>): void {
  const nativeParent = godotObjectNative(parent);
  const nativeChild = godotObjectNative(child);
  if (!(nativeParent instanceof Object3D) || !(nativeChild instanceof Object3D)) {
    throw new TypeError('godot-compat: Node.add_child requires retained Three Object3D identities.');
  }
  nativeParent.add(nativeChild);
  if (tree?.isInsideTree(nativeParent) === true) tree.enteredNode(nativeChild);
}

/** Godot 3 Node.add_child(child, legible_unique_name=false) over the native Object3D tree. */
export function addChild3DGodot3(
  parent: Object3D,
  child: Object3D,
  legibleUniqueName = false,
  tree?: SceneTree<Object3D>,
): void {
  if (typeof legibleUniqueName !== 'boolean') {
    throw new TypeError('godot-compat: Node.add_child legible_unique_name requires bool.');
  }
  if (legibleUniqueName && child.name.length === 0) {
    child.name = uniqueNodeName(child.type || 'Node', parent.children.map((sibling) => sibling.name));
  }
  addChild3D(parent, child, tree);
  if (tree !== undefined && !tree.isInsideTree(parent)) tree.notifyChildOrderChanged(parent);
}

/** Godot 4 Node.add_child with the exact readable-name and internal-seat arguments. */
export function addChild3DGodot4(
  parent: Object3D,
  child: Object3D,
  forceReadableName = false,
  internalMode = 0,
  tree?: SceneTree<Object3D>,
): void {
  if (typeof forceReadableName !== 'boolean') {
    throw new TypeError('godot-compat: Node.add_child force_readable_name requires bool.');
  }
  if (!Number.isSafeInteger(internalMode) || internalMode < 0 || internalMode > 2) {
    throw new RangeError('godot-compat: Node.add_child internal requires INTERNAL_MODE_DISABLED/FRONT/BACK.');
  }
  if (forceReadableName && child.name.length === 0) {
    child.name = uniqueNodeName(child.type || 'Node', parent.children.map((sibling) => sibling.name));
  }
  if (internalMode !== 0) INTERNAL_THREE_CHILDREN.add(child);
  parent.add(child);
  if (internalMode === 1) {
    parent.children.splice(parent.children.indexOf(child), 1);
    parent.children.unshift(child);
  }
  if (tree?.isInsideTree(parent) === true) tree.enteredNode(child);
  else tree?.notifyChildOrderChanged(parent);
}

/** Godot 3 `add_child_below_node`: add after the named retained sibling. */
export function addChildBelowNode3D(
  parent: Object3D,
  sibling: Object3D,
  child: Object3D,
  _legibleUniqueName = false,
  tree?: SceneTree<Object3D>,
): void {
  if (typeof _legibleUniqueName !== 'boolean') {
    throw new TypeError('godot-compat: add_child_below_node legible_unique_name requires bool.');
  }
  const siblingIndex = parent.children.indexOf(sibling);
  if (siblingIndex < 0) {
    throw new Error('godot-compat: add_child_below_node reference is not a child of this node.');
  }
  parent.add(child);
  moveChild3D(parent, child, siblingIndex + 1);
  if (_legibleUniqueName) setName3D(child, child.name);
  if (tree?.isInsideTree(parent) === true) tree.enteredNode(child);
}

/**
 * `Node.duplicate()` — `stage.gd:11` duplicates an authored DirectionalLight3D.
 *
 * three's `Object3D.clone(true)` deep-copies the live subtree (name, transform,
 * light parameters, children). Godot's default flags also copy groups/signals/
 * scripts; a light with none of those is exactly this clone. A node whose
 * script instance is the port's scene class is not re-stamped this way — that
 * is `PackedScene.instantiate`.
 */
export function duplicateNode3D<T extends Object3D>(node: T): T {
  return node.clone(true) as T;
}

/** `node.get_children()` — a copy of the direct children, as Godot returns a new Array. */
export function getChildren3D(node: Object3D): object[] {
  return node.children
    .filter((child) => !INTERNAL_THREE_CHILDREN.has(child))
    .map((child) => godotObjectScriptValue(child) as object);
}

/** `node.get_child(index, include_internal = false)`. The emitted three tree has no internal
 * editor children, so the authored array is the exact answer for either flag. */
export function getChild3D(
  node: Object3D,
  index: number,
  _includeInternal = false,
): object | null {
  const children = _includeInternal ? node.children : node.children.filter((child) => !INTERNAL_THREE_CHILDREN.has(child));
  const resolved = index < 0 ? children.length + index : index;
  const child = children[resolved];
  return child === undefined ? null : godotObjectScriptValue(child) as object;
}

/** `node.get_child_count(include_internal = false)` over the authored three children. */
export function getChildCount3D(node: Object3D, _includeInternal = false): number {
  return _includeInternal ? node.children.length : node.children.filter((child) => !INTERNAL_THREE_CHILDREN.has(child)).length;
}

/** `node.is_inside_tree()` — membership in the port-owned three scene tree. */
export function isInsideTree3D(tree: SceneTree<Object3D>, node: Object3D): boolean {
  return tree.isInsideTree(node);
}

/** `node.has_node(path)` — the non-throwing Godot path walk, including `/root/Scene`. */
export function hasNode3D(
  tree: SceneTree<Object3D>,
  node: Object3D,
  path: GodotNodePath | string,
): boolean {
  return tree.hasNode(node, path);
}

/** `node.get_path()` — an absolute Godot NodePath value. */
export function getPath3D(tree: SceneTree<Object3D>, node: Object3D): GodotNodePath {
  return tree.getNodePath(node);
}

/** Receiver-aware `get_node`, including `/root`, script autoloads and `%UniqueName`. */
export function getNodeInTree3D(
  tree: SceneTree<Object3D>,
  from: Object3D | object,
  path: GodotNodePath | string,
): object {
  return godotObjectScriptValue(tree.getNode(from, path)) as object;
}

/** Receiver-aware nullable lookup; no exception or fabricated authored-field fallback on a miss. */
export function getNodeOrNullInTree3D(
  tree: SceneTree<Object3D>,
  from: Object3D | object,
  path: GodotNodePath | string,
): object | null {
  const node = tree.getNodeOrNull(from, path);
  return node === null ? null : godotObjectScriptValue(node) as object;
}

/** `node.remove_child(child)` — detaches, does not dispose. */
export function removeChild3D(
  parent: unknown,
  child: unknown,
  tree?: SceneTree<Object3D>,
): void {
  const nativeParent = godotObjectNative(parent);
  const nativeChild = godotObjectNative(child);
  if (!(nativeParent instanceof Object3D) || !(nativeChild instanceof Object3D)) {
    throw new TypeError('godot-compat: Node.remove_child requires retained Three Object3D identities.');
  }
  tree?.detachingNode(nativeChild);
  nativeParent.remove(nativeChild);
  tree?.detachedNode(nativeChild);
}

/** `parent.move_child(child, index)` in the renderer's traversal order. */
export function moveChild3D(parent: Object3D, child: Object3D, index: number, tree?: SceneTree<Object3D>): void {
  if (child.parent !== parent) {
    throw new Error('godot-compat: move_child target is not a child of this node.');
  }
  const resolved = index < 0 ? parent.children.length + index : index;
  if (resolved < 0 || resolved > parent.children.length) {
    throw new Error(`godot-compat: move_child index ${index} is outside the child array.`);
  }
  const from = parent.children.indexOf(child);
  const to = Math.min(resolved, parent.children.length - 1);
  if (from === to) return;
  parent.children.splice(from, 1);
  parent.children.splice(to, 0, child);
  tree?.notifyChildOrderChanged(parent);
}

/** Godot 3 `Node.raise()` moves the retained Object3D to the end of its sibling order. */
export function raiseNode3D(node: Object3D): void {
  const parent = node.parent;
  if (parent === null) throw new Error('godot-compat: Node.raise requires a parent.');
  moveChild3D(parent, node, -1);
}

/** `node.add_sibling(sibling)`, immediately after the receiver in tree order. */
export function addSibling3D(
  node: Object3D,
  sibling: Object3D,
  _forceReadableName = false,
  tree?: SceneTree<Object3D>,
): void {
  const parent = node.parent;
  if (parent === null) throw new Error('godot-compat: add_sibling requires a parent.');
  parent.add(sibling);
  moveChild3D(parent, sibling, parent.children.indexOf(node) + 1);
  if (tree?.isInsideTree(parent) === true) tree.enteredNode(sibling);
}

/** `node.reparent(parent, keep_global_transform = true)` over three's native `attach`. */
export function reparentNode3D(
  tree: SceneTree<Object3D>,
  node: Object3D,
  parent: Object3D,
  keepGlobalTransform = true,
): void {
  if (node.parent === null) throw new Error('godot-compat: reparent requires an existing parent.');
  tree.reparentNode(node, parent, () => {
    if (keepGlobalTransform) parent.attach(node);
    else parent.add(node);
  });
}

/**
 * `node.find_children(pattern, type, recursive, owned)` — Godot 4, `player.gd:267`.
 *
 * Walks descendants (not the node itself), matching each child's `name` with Godot's
 * `String.matchn` (`*` / `?`, case-insensitive) and an optional engine-class filter.
 * The 4.7 dump declares `find_children(pattern, type = "", recursive = true, owned = true)
 * -> typedarray::Node`. `owned` is ignored: a cloned `.glb` has no Godot owner table,
 * and every three child is one `add_child` put there. An unmapped `type` THROWS naming
 * itself rather than returning an empty list a caller would treat as "no meshes".
 *
 * `MeshInstance3D` / `MeshInstance` is the one mapped class — `isMesh`, not
 * `instanceof Mesh`, because a port can load two copies of three and `instanceof`
 * then misses every mesh.
 */
export function findChildren3D(
  root: Object3D,
  pattern: string,
  type = '',
  recursive = true,
  _owned = true,
): Object3D[] {
  const out: Object3D[] = [];
  const visit = (node: Object3D, isRoot: boolean): void => {
    if (!isRoot && godotMatchn(node.name, pattern) && godotFindTypeMatches(node, type)) {
      out.push(node);
    }
    if (isRoot || recursive) {
      for (const child of node.children) visit(child, false);
    }
  };
  visit(root, true);
  return out;
}

function godotMatchn(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

function godotFindTypeMatches(node: Object3D, type: string): boolean {
  if (type === '') return true;
  if (type === 'MeshInstance3D' || type === 'MeshInstance') {
    return (node as { isMesh?: boolean }).isMesh === true;
  }
  throw new Error(
    `Node.find_children type "${type}" has no three counterpart this backend maps. ` +
      '`MeshInstance3D` / `MeshInstance` match `isMesh`; any other class is a remainder.',
  );
}

/**
 * `VisualInstance3D.layers` / `VisualInstance.layers` — the 32-bit render-layer mask.
 *
 * three's `Object3D.layers.mask` is the same primitive `scene-module-3d.ts` authors as
 * `layers-mask={N}`. A WRITE of `layers = 2` is `mask = 2`, not a replacement of the
 * `Layers` object (which is what a raw `.layers =` on a cloned mesh does, and then
 * three's renderer calls `.test` on a number).
 */
export function getVisualInstanceLayers(node: Object3D): number {
  return node.layers.mask;
}

/** `node.layers = mask`. */
export function setVisualInstanceLayers(node: Object3D, mask: number): void {
  node.layers.mask = mask;
}

/**
 * `node.get_node(path)` / `$Path` — `Main.gd:22`,
 * `get_node("SpawnPath/SpawnLocation")`.
 *
 * Segments are separated by `/`; `.` is this node and `..` is the parent, as in
 * Godot. An absolute path (`/root/…`) is deliberately NOT supported: Godot's
 * `/root` is its `Viewport`, which has no three counterpart, and no measured
 * fixture writes one. Passing one throws saying so rather than guessing at a
 * root.
 *
 * @throws if any segment does not resolve — see this module's header.
 */
export function getNode3D(from: Object3D, path: string): object {
  if (path.startsWith('/')) {
    throw new Error(
      `godot-compat: get_node("${path}") is an ABSOLUTE path. Godot's /root is its Viewport, ` +
        'which has no three counterpart — resolve from a node you hold, or from tree.root.',
    );
  }
  let current: Object3D = from;
  for (const segment of path.split('/').filter((s) => s.length > 0)) {
    if (segment === '.') continue;
    if (segment === '..') {
      const parent = current.parent;
      if (parent === null) {
        throw new Error(
          `godot-compat: get_node("${path}") walked past the top of the tree at ".." — ` +
            `"${current.name}" has no parent.`,
        );
      }
      current = parent;
      continue;
    }
    const child = current.children.find((candidate) => candidate.name === segment);
    if (child === undefined) {
      const available = current.children.map((c) => c.name).filter((n) => n.length > 0);
      throw new Error(
        `godot-compat: get_node("${path}") found no child "${segment}" under ` +
          `"${current.name || '(unnamed)'}". Available: ` +
          `${available.length === 0 ? '(none)' : available.join(', ')}. Godot's $Path walks ` +
          'DIRECT children per segment and is not recursive, which is why this is not ' +
          'three.getObjectByName.',
      );
    }
    current = child;
  }
  return godotObjectScriptValue(current) as object;
}

/** What {@link queueFree3D} may do beyond detaching. */
export interface QueueFree3DOptions {
  /** Dispose every geometry and material under the freed node. OFF by default;
   *  see this module's header for the sharing hazard that decides it. */
  readonly dispose?: boolean;
}

/**
 * `node.queue_free()` — `Mob.gd:34`, `:38`; `Player.gd:68`.
 *
 * Detaches at the END of the frame, in `tree.tick`, never immediately: the
 * measured fixture calls it from inside a `screen_exited` signal dispatched on
 * the node being freed. Queueing the same node twice frees it once.
 */
export function queueFree3D(
  tree: SceneTree<Object3D>,
  node: Object3D,
  options?: QueueFree3DOptions,
): void {
  tree.deferred.queueFree(node, () => {
    tree.detachingNode(node);
    releaseGodotThreeNodeBindings(node);
    node.removeFromParent();
    tree.detachedNode(node);
    node.traverse((child) => { markGodotObjectFreed(child); });
    if (options?.dispose !== true) return;
    node.traverse((child) => {
      const disposable = child as {
        geometry?: { dispose(): void };
        material?: unknown;
      };
      disposable.geometry?.dispose();
      const material = disposable.material;
      for (const one of Array.isArray(material) ? material : [material]) {
        (one as { dispose?: () => void } | undefined)?.dispose?.();
      }
    });
  });
}

/** `node.is_queued_for_deletion()`. */
export function isQueuedForDeletion3D(tree: SceneTree<Object3D>, node: Object3D): boolean {
  return tree.deferred.isQueuedForDeletion(node);
}
