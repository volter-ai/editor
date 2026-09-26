/**
 * The scene tree IS the Pixi display tree — `Node`, `CanvasItem`, `Node2D` and
 * `Label`, as functions over `Container`.
 *
 * **There is no `Node` class here, and there must never be one.** The world
 * node IS the entity (CLAUDE.md): a `Container` already has a name, a parent,
 * children, a transform and a visibility flag, so a compat `Node` wrapper would
 * be a second identity for every object in the scene — the mirror/sync layer
 * this repo deleted. These are functions that take the `Container` and hand the
 * `Container` back.
 *
 * The members differ a lot in how much adapting they need, and saying so is the
 * point of this file:
 *
 * | Godot | Pixi | what compat actually does |
 * |---|---|---|
 * | `node.name` | `container.label` | nothing — a rename, both ways |
 * | `node.visible` / `hide()` / `show()` | `container.visible` | nothing — two method names over one flag |
 * | `node2d.position` | `container.position` | real: Godot's is a VALUE, Pixi's is a live handle |
 * | `node2d.rotation` | `container.rotation` | nothing — both are radians, both Y-down |
 * | `label.text` | `text.text` | nothing — identical |
 * | `node.add_child(c)` | `container.addChild(c)` | nothing — same operation |
 * | `node.get_node(path)` | `getChildByLabel` per segment | real: Godot walks a PATH, `..`/`.` included |
 * | `node.queue_free()` | — | real: end-of-frame, through `deferred.ts` |
 * | `canvas_item.get_viewport_rect()` | `app.screen` | real: a `Rect2`, from a caller-fed size |
 *
 * The pass-through cases are declared as aliases anyway, and kept for ONE
 * reason: an emitter that writes `node.label` for `node.name` and
 * `setPosition(node, v)` for `node.position` produces code where two
 * identical-looking GDScript reads compile to two unrelated shapes. One
 * vocabulary is worth a few lines. (`roblox-compat`'s `getName`/`setName`
 * records the same trade.)
 *
 * ## What a Godot tree has that a Pixi tree does not
 *
 * Godot's tree holds `Timer`s, `AudioStreamPlayer`s and `Position2D`s — objects
 * with no display counterpart. A Pixi tree holds display objects only. So
 * `$MobTimer` and `$Music` resolve at EMISSION time to the emitted class's own
 * fields, while {@link getNode} covers the display tree, where the pilot's one
 * runtime lookup lives (`Main.gd:34`, `get_node("MobPath/MobSpawnLocation")`).
 * That split is a structural fact of the two trees, not a limitation to work
 * around — a compat that put non-display objects into the Pixi tree would be
 * putting things in a render list that must never be rendered.
 *
 * ## Lookup is STRICT, and loud
 *
 * Godot's `$Path` walks direct children by name, one segment at a time, and is
 * not recursive. {@link getNode} is exactly that (Pixi's own
 * `getChildByLabel(label)` with `deep` left false), and a segment that does not
 * resolve THROWS naming the full path, the segment that failed and the labels
 * that were available. Godot returns `null` and lets the next line fail
 * somewhere else; this repo's rule is to degrade loudly, and a null node in a
 * port surfaces three call sites away from the typo that caused it.
 */

import {
  CanvasTextMetrics,
  ColorMatrixFilter,
  Container,
  Graphics,
  Matrix,
  Rectangle,
  type PointData,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { dbToLinear } from '@volter/game-runtime/audio/bus-mixer';
import type { GodotAudioGraph } from './audio-graph';
import { bindCanvasBaseButton, bindCanvasToolButton, type GodotCanvasBaseButton } from './canvas-button';
import {
  bindCanvasControl,
  getCanvasControlSize,
  reflowCanvasControl,
  setCanvasContainerLayout,
  type CanvasControlInitialState,
} from './canvas-control-state';
import { bindGodotCanvasContainerApi, releaseGodotCanvasContainerApi } from './canvas-container';
import { bindGodotCanvasControlInteractionApi } from './canvas-control-interaction-api';
import { bindGodotCanvasControlDragApi } from './canvas-control-drag-api';
import { bindGodotCanvasControlAccessibilityApi } from './canvas-control-accessibility-api';
import { bindGodotCanvasControlPolicyApi } from './canvas-control-policy-api';
import { bindGodotCanvasControlTransformApi } from './canvas-control-transform-api';
import { bindGodotCanvasControlSignalApi } from './canvas-control-signal-api';
import { bindGodotCanvasControlThemeApi } from './canvas-control-theme-api';
import { bindCanvasPanelTheme, redrawCanvasPanelTheme, releaseCanvasPanelTheme } from './canvas-panel';
import { bindCanvasBoxContainer, bindCanvasGridContainer, type GodotCanvasGridContainer } from './canvas-control-containers';
import { optionalControlBinding, retainedControlGlobalTransform } from './control-state';
import {
  getCanvasItemSourceTexture,
  syncCanvasItemTextureFilter,
} from './canvas-item-texture-filter';
import {
  forceUpdateCanvasItemTransform,
  getCanvasItemClipChildrenMode,
  getCanvasItemGlobalTransform as getRuntimeCanvasItemGlobalTransform,
  getCanvasItemLightMask,
  getCanvasItemRect,
  getCanvasItemScreenTransform as getRuntimeCanvasItemScreenTransform,
  getCanvasItemTransform as getRuntimeCanvasItemTransform,
  getCanvasItemViewportTransform as getRuntimeCanvasItemViewportTransform,
  getCanvasItemVisibilityLayer,
  getCanvasItemVisibilityLayerBit,
  getCanvasItemVisibilityParent,
  isCanvasItemLocalTransformNotificationEnabled,
  isCanvasItemShowingBehindParent,
  isCanvasItemTransformNotificationEnabled,
  isCanvasItemUsingParentMaterial,
  makeCanvasPositionGlobal,
  makeCanvasPositionLocal,
  moveCanvasItemToFront,
  setCanvasItemClipChildrenMode,
  setCanvasItemLightMask,
  setCanvasItemNotifyLocalTransform,
  setCanvasItemNotifyTransform,
  setCanvasItemShowBehindParent,
  setCanvasItemUseParentMaterial,
  setCanvasItemVisibilityLayer,
  setCanvasItemVisibilityLayerBit,
  setCanvasItemVisibilityParent,
} from './canvas-item-state';
import {
  godotObjectGetClass,
  godotObjectNative,
  godotObjectScriptValue,
  registerGodotObjectIdentity,
} from './object';
import { markGodotObjectFreed } from './object-liveness';
import { createTextureRect, type GodotTextureRect } from './pixi-drawables-2d';
import { uniqueNodeName } from './node-name';
import type { GodotNodePath } from './node-path';
import type { SceneTree } from './scene-tree';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import {
  createLabelTextStyle,
  isGodotLabelSettings,
  type GodotLabelSettings,
} from './label-settings';
import { loadGodotFont } from './font';
import { godotResourceChangedSignal } from './resource-io';
import type { GodotConnection } from './signal';
import {
  type ColorValue,
  type Rect2,
  rect2,
  type Transform2D,
  transform2DFromOrigin,
} from './variant';

const NODE_SOURCE_PATH = new WeakMap<object, string>();

/** Godot 3 Node.filename: the PackedScene path retained on each instantiated scene root. */
export function getNodeFilename(node: object): string {
  return NODE_SOURCE_PATH.get(node) ?? '';
}

export function setNodeFilename(node: object, value: unknown): void {
  if (typeof value !== 'string') throw new TypeError('Node.filename requires a string.');
  NODE_SOURCE_PATH.set(node, value);
}

/** Godot 4 renamed Node.filename to scene_file_path without changing its retained scene-root data. */
export const getNodeSceneFilePath = getNodeFilename;

export function setNodeSceneFilePath(node: object, value: unknown): void {
  if (typeof value !== 'string') throw new TypeError('Node.scene_file_path requires a String.');
  NODE_SOURCE_PATH.set(node, value);
}
import { copyVector2, VECTOR2_ZERO, type Vector2, vec2 } from './vector2';
import type { GodotTransform2D } from './transform-2d';

// --- Node ----------------------------------------------------------------------------------------

/**
 * A source-owned canvas subtree constructor installed by the scene emitter.
 *
 * Godot duplicates storage properties and authored children, not a renderer snapshot. Pixi's
 * `Container.clone()` cannot express that distinction (and would also clone renderer-owned
 * particle sprites), so emission serializes the one fact it uniquely knows: how to construct the
 * authored node subtree again. The factory itself lives with the runtime node and all duplication
 * semantics remain in copied compat.
 */
export type CanvasNodeDuplicateFactory<T extends Container = Container> = (
  flags: number,
) => T;

interface CanvasDuplicateBinding {
  readonly factory: CanvasNodeDuplicateFactory;
}

const CANVAS_DUPLICATE_FACTORIES = new WeakMap<Container, CanvasDuplicateBinding>();
const CANVAS_NODE_RELEASES = new WeakMap<Container, () => void>();
const INTERNAL_CANVAS_CHILDREN = new WeakSet<Container>();

interface CanvasTopLevelState {
  readonly desiredGlobal: Matrix;
  readonly appliedLocal: Matrix;
  readonly previousOnRender: Container['onRender'];
}

const CANVAS_TOP_LEVEL = new WeakMap<Container, CanvasTopLevelState>();

function matrixEquals(a: Matrix, b: Matrix): boolean {
  return a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.tx === b.tx && a.ty === b.ty;
}

function refreshCanvasTransformSubtree(node: Container): void {
  node.updateLocalTransform();
  if (node.parent !== null && !node.parent.renderGroup) {
    node.relativeGroupTransform.appendFrom(node.localTransform, node.parent.relativeGroupTransform);
  } else {
    node.relativeGroupTransform.copyFrom(node.localTransform);
  }
  // Force the lazy native world matrix to observe the corrected relative transform this frame.
  node.worldTransform;
  for (const child of node.children) refreshCanvasTransformSubtree(child);
}

function applyCanvasTopLevel(node: Container, state: CanvasTopLevelState): void {
  if (!matrixEquals(node.localTransform, state.appliedLocal)) {
    state.desiredGlobal.copyFrom(node.localTransform);
  }
  const parentWorld = node.parent?.getGlobalTransform();
  const local = parentWorld === undefined
    ? state.desiredGlobal.clone()
    : parentWorld.clone().invert().append(state.desiredGlobal);
  node.setFromMatrix(local);
  refreshCanvasTransformSubtree(node);
  state.appliedLocal.copyFrom(node.localTransform);
}

/**
 * CanvasItem.set_as_top_level: keep logical tree ownership while making the native Pixi basis
 * independent of every ancestor transform. Writes to the item's transform become canvas-global,
 * and the local projection is refreshed before each native render as ancestors move.
 */
export function setCanvasItemAsTopLevel(node: Container, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('CanvasItem.set_as_top_level requires bool.');
  const current = CANVAS_TOP_LEVEL.get(node);
  if (enabled === (current !== undefined)) return;
  if (enabled) {
    const desiredGlobal = node.getGlobalTransform();
    const state: CanvasTopLevelState = {
      desiredGlobal,
      appliedLocal: node.localTransform.clone(),
      previousOnRender: node.onRender,
    };
    CANVAS_TOP_LEVEL.set(node, state);
    node.onRender = (renderer) => {
      state.previousOnRender?.call(node, renderer);
      applyCanvasTopLevel(node, state);
    };
    applyCanvasTopLevel(node, state);
    return;
  }
  if (current === undefined) return;
  const desiredGlobal = current.desiredGlobal.clone();
  node.onRender = current.previousOnRender;
  CANVAS_TOP_LEVEL.delete(node);
  const local = node.parent === null
    ? desiredGlobal
    : node.parent.getGlobalTransform().invert().append(desiredGlobal);
  node.setFromMatrix(local);
  refreshCanvasTransformSubtree(node);
}

export function isCanvasItemSetAsTopLevel(node: Container): boolean {
  return CANVAS_TOP_LEVEL.has(node);
}

/** Mark a renderer-owned child which must not enter Godot's authored child order/path space. */
export function markInternalCanvasChild<T extends Container>(child: T): T {
  INTERNAL_CANVAS_CHILDREN.add(child);
  return child;
}

export function isInternalCanvasChild(child: object): boolean {
  return INTERNAL_CANVAS_CHILDREN.has(child as Container);
}

/** The authored children Godot APIs see; renderer implementation nodes remain native Pixi children. */
export function authoredCanvasChildren(node: Container): Container[] {
  return node.children.filter((child) => !INTERNAL_CANVAS_CHILDREN.has(child));
}

/** Godot 3's script-visible default also preserves instanced-scene provenance. */
export const GODOT_DUPLICATE_SCRIPTS = 4;
export const GODOT_DUPLICATE_USE_INSTANCING = 8;
export const GODOT_3_DUPLICATE_DEFAULT =
  1 | 2 | GODOT_DUPLICATE_SCRIPTS | GODOT_DUPLICATE_USE_INSTANCING;
/** Godot 4 spells the same bit `DUPLICATE_USE_INSTANTIATION`. */
export const GODOT_4_DUPLICATE_DEFAULT = GODOT_3_DUPLICATE_DEFAULT;

/** Install the exact source-subtree constructor on the retained Pixi identity. */
export function registerCanvasNodeDuplicateFactory<T extends Container>(
  node: T,
  factory: CanvasNodeDuplicateFactory<T>,
): () => void {
  if (CANVAS_DUPLICATE_FACTORIES.has(node)) {
    throw new Error(`Node.duplicate factory is already registered for ${node.label || '<unnamed>'}`);
  }
  CANVAS_DUPLICATE_FACTORIES.set(node, { factory });
  return () => CANVAS_DUPLICATE_FACTORIES.delete(node);
}

/** Register native compat state cleanup independently of whether Node.duplicate is admitted. */
export function registerCanvasNodeRelease(node: Container, release: () => void): () => void {
  if (CANVAS_NODE_RELEASES.has(node)) {
    throw new Error(`Canvas node release is already registered for ${node.label || '<unnamed>'}`);
  }
  CANVAS_NODE_RELEASES.set(node, release);
  return () => CANVAS_NODE_RELEASES.delete(node);
}

/** Release copied compat state for any retained canvas node, duplicate-capable or not. */
export function releaseCanvasNodeBinding(node: Container): void {
  releaseGodotVideoStreamPlayer(node);
  releaseGodotCanvasContainerApi(node);
  releaseCanvasPanelTheme(node);
  const release = CANVAS_NODE_RELEASES.get(node);
  release?.();
  CANVAS_NODE_RELEASES.delete(node);
  CANVAS_DUPLICATE_FACTORIES.delete(node);
}

/**
 * `Node.duplicate(flags)` for a canvas node whose source emitter installed an exact factory.
 *
 * A generic Pixi deep clone would silently copy implementation children and lose Godot resource
 * duplication rules. Missing registration is therefore a named refusal, never a best-effort clone.
 */
export function duplicateNode2D<T extends Container>(
  node: T,
  flags = GODOT_3_DUPLICATE_DEFAULT,
): T {
  const factory = CANVAS_DUPLICATE_FACTORIES.get(node);
  if (factory === undefined) {
    throw new Error(
      `Node.duplicate refused for ${node.label || '<unnamed>'}: its emitted canvas class has no ` +
        'source-owned duplicate factory, so Pixi implementation children cannot be distinguished ' +
        'from authored Godot children.',
    );
  }
  return factory.factory(flags) as T;
}

/** Validate the source-engine duplicate flag set before a source-owned factory constructs anything. */
export function requireCanvasNodeDuplicateFlags(flags: number, godotMajor: 3 | 4): void {
  if (!Number.isSafeInteger(flags)) throw new TypeError('Node.duplicate flags must be an integer bit mask.');
  const supported = godotMajor === 3 ? GODOT_3_DUPLICATE_DEFAULT : GODOT_4_DUPLICATE_DEFAULT;
  if (flags !== supported) {
    throw new Error(
      `Node.duplicate(${String(flags)}) refused: this canvas subtree factory carries exactly ` +
        `Godot ${String(godotMajor)}'s default duplicate flags (${String(supported)}).`,
    );
  }
}

/** Rebuild the current authored child order through each child's own source factory. */
export function duplicateAuthoredCanvasChildren(
  source: Container,
  duplicate: Container,
  flags: number,
): void {
  for (const child of authoredCanvasChildren(source)) {
    duplicate.addChild(duplicateNode2D(child, flags));
  }
}

/** `node.name`. Godot's node name is Pixi's `label`. */
export function getName(node: Container): string {
  return node.label;
}

/** `node.name = "…"`. */
export function setName(node: Container, name: string, tree?: SceneTree): void {
  const previous = node.label;
  const next = uniqueNodeName(
    name,
    node.parent === null
      ? []
      : authoredCanvasChildren(node.parent)
          .filter((sibling) => sibling !== node)
          .map((sibling) => sibling.label),
  );
  if (next === previous) return;
  node.label = next;
  tree?.notifyNodeRenamed(node);
}

/** `node.get_parent()`. `null` at the root, matching Godot. */
export function getParent(node: Container): Container | null {
  return node.parent;
}

function retainedCanvasNode(value: unknown, member: string): Container {
  const native = godotObjectNative(value);
  if (!(native instanceof Container)) {
    throw new TypeError(`godot-compat: Node.${member} requires retained canvas Node identities.`);
  }
  return native;
}

/** `node.add_child(child)` — ScriptInstances resolve to their one retained native owner. */
export function addChild(parent: unknown, child: unknown, tree?: SceneTree): void {
  const nativeParent = retainedCanvasNode(parent, 'add_child');
  const nativeChild = retainedCanvasNode(child, 'add_child');
  nativeParent.addChild(nativeChild);
  syncNode2DZ(nativeChild);
  if (tree?.isInsideTree(nativeParent) === true) tree.enteredNode(nativeChild);
}

/** Godot 3 Node.add_child(child, legible_unique_name=false). */
export function addChildGodot3(
  parent: unknown,
  child: unknown,
  legibleUniqueName = false,
  tree?: SceneTree,
): void {
  if (typeof legibleUniqueName !== 'boolean') {
    throw new TypeError('godot-compat: Node.add_child legible_unique_name requires bool.');
  }
  const nativeParent = retainedCanvasNode(parent, 'add_child');
  const nativeChild = retainedCanvasNode(child, 'add_child');
  if (legibleUniqueName && nativeChild.label.length === 0) {
    nativeChild.label = uniqueNodeName(nativeChild.constructor.name || 'Node', authoredCanvasChildren(nativeParent).map((sibling) => sibling.label));
  }
  addChild(nativeParent, nativeChild, tree);
  if (tree !== undefined && !tree.isInsideTree(nativeParent)) tree.notifyChildOrderChanged(nativeParent);
}

/** Godot 4 Node.add_child(child, force_readable_name=false, internal=INTERNAL_MODE_DISABLED). */
export function addChildGodot4(
  parent: unknown,
  child: unknown,
  forceReadableName = false,
  internalMode = 0,
  tree?: SceneTree,
): void {
  if (typeof forceReadableName !== 'boolean') {
    throw new TypeError('godot-compat: Node.add_child force_readable_name requires bool.');
  }
  if (!Number.isSafeInteger(internalMode) || internalMode < 0 || internalMode > 2) {
    throw new RangeError('godot-compat: Node.add_child internal requires INTERNAL_MODE_DISABLED/FRONT/BACK.');
  }
  const nativeParent = retainedCanvasNode(parent, 'add_child');
  const nativeChild = retainedCanvasNode(child, 'add_child');
  if (forceReadableName && nativeChild.label.length === 0) {
    nativeChild.label = uniqueNodeName(nativeChild.constructor.name || 'Node', authoredCanvasChildren(nativeParent).map((sibling) => sibling.label));
  }
  if (internalMode !== 0) INTERNAL_CANVAS_CHILDREN.add(nativeChild);
  nativeParent.addChild(nativeChild);
  if (internalMode === 1) nativeParent.setChildIndex(nativeChild, 0);
  syncNode2DZ(nativeChild);
  if (tree?.isInsideTree(nativeParent) === true) tree.enteredNode(nativeChild);
  else tree?.notifyChildOrderChanged(nativeParent);
}

/** Godot 3 `add_child_below_node`: add after the named authored sibling. */
export function addChildBelowNode(
  parent: Container,
  sibling: Container,
  child: Container,
  _legibleUniqueName = false,
  tree?: SceneTree,
): void {
  if (typeof _legibleUniqueName !== 'boolean') {
    throw new TypeError('godot-compat: add_child_below_node legible_unique_name requires bool.');
  }
  const siblings = authoredCanvasChildren(parent);
  const siblingIndex = siblings.indexOf(sibling);
  if (siblingIndex < 0) {
    throw new Error('godot-compat: add_child_below_node reference is not an authored child of this node.');
  }
  const next = siblings[siblingIndex + 1];
  parent.addChildAt(child, next === undefined ? parent.children.length : parent.children.indexOf(next));
  if (_legibleUniqueName) setName(child, child.label);
  syncNode2DZ(child);
  if (tree?.isInsideTree(parent) === true) tree.enteredNode(child);
}

/** Exported Player builds have no editor warning dock to invalidate. */
export function updateNodeConfigurationWarnings(): void {
  // This is the exact runtime branch of Node::update_configuration_warnings outside editor hint.
}

/** `node.get_children()` — a copy of the direct children, exposing attached scripts as Godot objects. */
export function getChildren(node: Container): object[] {
  return authoredCanvasChildren(node).map((child) => godotObjectScriptValue(child) as object);
}

/** `node.get_child(index, include_internal = false)`; Pixi implementation children stay hidden. */
export function getChild(
  node: Container,
  index: number,
  _includeInternal = false,
): object | null {
  const children = authoredCanvasChildren(node);
  const resolved = index < 0 ? children.length + index : index;
  const child = children[resolved];
  return child === undefined ? null : godotObjectScriptValue(child) as object;
}

/** `node.get_child_count(include_internal = false)`. */
export function getChildCount(node: Container, _includeInternal = false): number {
  return authoredCanvasChildren(node).length;
}

/** `node.is_inside_tree()` — membership in the port-owned Pixi scene tree. */
export function isInsideTree(tree: SceneTree, node: Container): boolean {
  return tree.isInsideTree(node);
}

/** `node.has_node(path)` — the non-throwing Godot path walk, including `/root/Scene`. */
export function hasNode(tree: SceneTree, node: Container, path: GodotNodePath | string): boolean {
  return tree.hasNode(node, path);
}

/** `node.get_path()` — an absolute Godot NodePath value. */
export function getPath(tree: SceneTree, node: Container): GodotNodePath {
  return tree.getNodePath(node);
}

/** Receiver-aware `get_node`, including `/root`, script autoloads and `%UniqueName`. */
export function getNodeInTree(
  tree: SceneTree,
  from: Container | object,
  path: GodotNodePath | string,
): object {
  return godotObjectScriptValue(tree.getNode(from, path)) as object;
}

/** Receiver-aware nullable lookup; no exception or fabricated authored-field fallback on a miss. */
export function getNodeOrNullInTree(
  tree: SceneTree,
  from: Container | object,
  path: GodotNodePath | string,
): object | null {
  const node = tree.getNodeOrNull(from, path);
  return node === null ? null : godotObjectScriptValue(node) as object;
}

/** `node.remove_child(child)` — detaches, does not destroy. */
export function removeChild(
  parent: Container,
  child: Container,
  tree?: SceneTree,
): void {
  tree?.detachingNode(child);
  parent.removeChild(child);
  syncNode2DZ(child);
  tree?.detachedNode(child);
}

/** `parent.move_child(child, index)`, including Godot's negative-index and one-past-end rules. */
export function moveChild(parent: Container, child: Container, index: number, tree?: SceneTree): void {
  if (child.parent !== parent) {
    throw new Error('godot-compat: move_child target is not a child of this node.');
  }
  const authored = authoredCanvasChildren(parent);
  if (!authored.includes(child)) {
    throw new Error('godot-compat: move_child cannot address a renderer-internal child.');
  }
  const resolved = index < 0 ? authored.length + index : index;
  if (resolved < 0 || resolved > authored.length) {
    throw new Error(`godot-compat: move_child index ${index} is outside the child array.`);
  }
  const without = authored.filter((candidate) => candidate !== child);
  const before = without[Math.min(resolved, without.length)];
  parent.removeChild(child);
  if (before === undefined) parent.addChild(child);
  else parent.addChildAt(child, parent.children.indexOf(before));
  tree?.notifyChildOrderChanged(parent);
}

/** Godot 3 `Node.raise()` moves the retained node to the end of its authored sibling order. */
export function raiseNode(node: Container): void {
  const parent = node.parent;
  if (parent === null) throw new Error('godot-compat: Node.raise requires a parent.');
  moveChild(parent, node, -1);
}

/** `node.add_sibling(sibling)`, immediately after the receiver in its parent's order. */
export function addSibling(
  node: Container,
  sibling: Container,
  _forceReadableName = false,
  tree?: SceneTree,
): void {
  const parent = node.parent;
  if (parent === null) throw new Error('godot-compat: add_sibling requires a parent.');
  const authored = authoredCanvasChildren(parent);
  const nextAuthored = authored[authored.indexOf(node) + 1];
  parent.addChildAt(
    sibling,
    nextAuthored === undefined ? parent.children.length : parent.children.indexOf(nextAuthored),
  );
  syncNode2DZ(sibling);
  if (tree?.isInsideTree(parent) === true) tree.enteredNode(sibling);
}

/** `node.reparent(parent, keep_global_transform = true)` over Pixi's native world-preserving API. */
export function reparentNode(
  tree: SceneTree,
  node: Container,
  parent: Container,
  keepGlobalTransform = true,
): void {
  if (node.parent === null) throw new Error('godot-compat: reparent requires an existing parent.');
  tree.reparentNode(node, parent, () => {
    if (keepGlobalTransform) parent.reparentChild(node);
    else parent.addChild(node);
  });
  syncNode2DZ(node);
}

/**
 * `node.get_node(path)` / `$Path`.
 *
 * Segments are separated by `/`; `.` is this node and `..` is the parent, as in
 * Godot. An absolute path (`/root/…`) is deliberately NOT supported: Godot's
 * `/root` is its `Viewport`, which has no Pixi counterpart, and the pilot never
 * writes one. Passing one throws saying so rather than guessing at a root.
 *
 * @throws if any segment does not resolve — see this module's header.
 */
export function getNode(from: Container, path: string): Container {
  if (path.startsWith('/')) {
    throw new Error(
      `godot-compat: get_node("${path}") is an ABSOLUTE path. Godot's /root is its Viewport, ` +
        'which has no Pixi counterpart — resolve from a node you hold, or from tree.root.',
    );
  }
  let current: Container = from;
  const segments = path.split('/').filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') {
      const parent = current.parent;
      if (parent === null) {
        throw new Error(
          `godot-compat: get_node("${path}") walked past the top of the tree at ".." — ` +
            `"${current.label}" has no parent.`,
        );
      }
      current = parent;
      continue;
    }
    const child = authoredCanvasChildren(current).find((candidate) => candidate.label === segment);
    if (child === undefined) {
      const available = authoredCanvasChildren(current)
        .map((c) => c.label)
        .filter((l) => l.length > 0);
      throw new Error(
        `godot-compat: get_node("${path}") found no child "${segment}" under ` +
          `"${current.label || '(unlabelled)'}". Available: ` +
          `${available.length === 0 ? '(none)' : available.join(', ')}. Godot's $Path walks ` +
          'DIRECT children per segment and is not recursive.',
      );
    }
    current = child;
  }
  return current;
}

/**
 * `node.queue_free()` — `Mob.gd:11`, and the method `call_group("mobs",
 * "queue_free")` invokes.
 *
 * Detaches and destroys at the END of the frame, in `tree.tick`, never
 * immediately: the pilot calls it from inside a `screen_exited` signal
 * dispatched on the node being freed. Queueing the same node twice frees it
 * once. See `deferred.ts` for the whole ordering story.
 */
export function queueFree(tree: SceneTree, node: Container): void {
  tree.deferred.queueFree(node, () => {
    tree.detachingNode(node);
    node.removeFromParent();
    tree.detachedNode(node);
    // Compat state belongs to authored Godot nodes, not Pixi's renderer implementation children.
    // Release the authored subtree depth-first before Pixi recursively destroys its display tree;
    // otherwise freeing an ordinary Container parent would strand bound Particles2D/RayCast2D
    // descendants in their scene registries. Per-node releases are idempotent for scene teardown.
    const releaseAuthoredSubtree = (current: Container): void => {
      for (const child of authoredCanvasChildren(current)) releaseAuthoredSubtree(child);
      releaseCanvasNodeBinding(current);
      markGodotObjectFreed(current);
    };
    releaseAuthoredSubtree(node);
    node.destroy({ children: true });
  });
}

/** `node.is_queued_for_deletion()`. */
export function isQueuedForDeletion(tree: SceneTree, node: Container): boolean {
  return tree.deferred.isQueuedForDeletion(node);
}

// --- CanvasItem ----------------------------------------------------------------------------------

/**
 * A node with a visibility flag — Pixi's `Container`, three's `Object3D`, and
 * anything a port wraps a DOM element in.
 *
 * Godot's `visible` is one boolean on the node and every renderer here spells
 * it the same way, so the functions below are the one place in this file
 * that adapts nothing at all. Typing them structurally is what makes that true
 * rather than merely likely: a Godot game's `hide()` is the same call whether
 * the node became a sprite or a mesh, and a `Container`-typed signature would
 * have quietly made this the 2D lane's property.
 *
 * The local flag stays on the native entity. The only compat state is a lazily-created signal
 * handle for a node whose translated script actually observes `visibility_changed`; Pixi/Three
 * parentage remains the visibility hierarchy and their inherited rendering remains native.
 */
export interface VisibleNode {
  visible: boolean;
  readonly parent?: object | null;
  readonly children?: readonly object[];
}

interface VisibilitySignalState {
  readonly tree: Pick<SceneTree, 'isInsideTree'>;
  readonly handle: SignalHandle<[]>;
}

const VISIBILITY_SIGNALS = new WeakMap<VisibleNode, VisibilitySignalState>();
const HIDDEN_SIGNALS = new WeakMap<VisibleNode, VisibilitySignalState>();
const VISIBILITY_OBSERVERS = new WeakMap<VisibleNode, Set<(visible: boolean) => void>>();

/** Observe writes through the one CanvasItem/Node3D visibility owner. */
export function observeGodotVisibility(node: VisibleNode, observer: (visible: boolean) => void): () => void {
  let observers = VISIBILITY_OBSERVERS.get(node);
  if (observers === undefined) {
    observers = new Set();
    VISIBILITY_OBSERVERS.set(node, observers);
  }
  observers.add(observer);
  return () => {
    observers?.delete(observer);
    if (observers?.size === 0) VISIBILITY_OBSERVERS.delete(node);
  };
}

function visibleAncestors(node: VisibleNode): boolean {
  let current: object | null | undefined = node;
  while (current !== null && current !== undefined) {
    if ('visible' in current && (current as VisibleNode).visible === false) return false;
    current = (current as { readonly parent?: object | null }).parent;
  }
  return true;
}

/** Local `visible`, independent of parent state. */
export function isVisible(node: VisibleNode): boolean {
  return node.visible;
}

/**
 * CanvasItem effective visibility requires tree membership and the complete retained canvas
 * ancestor chain. CanvasLayer is a retained Pixi Container in that same chain, so its local
 * `visible` flag gates every CanvasItem in the layer subtree without a parallel layer registry.
 */
export function isCanvasItemVisibleInTree(node: VisibleNode): boolean;
export function isCanvasItemVisibleInTree(tree: Pick<SceneTree, 'isInsideTree'>, node: VisibleNode): boolean;
export function isCanvasItemVisibleInTree(
  treeOrNode: Pick<SceneTree, 'isInsideTree'> | VisibleNode,
  node?: VisibleNode,
): boolean {
  if (node === undefined) return visibleAncestors(treeOrNode as VisibleNode);
  return (treeOrNode as Pick<SceneTree, 'isInsideTree'>).isInsideTree(node) && visibleAncestors(node);
}

/**
 * Spatial/Node3D differs from CanvasItem: pinned 3.6/4.7 source walks spatial ancestors but does
 * not require `is_inside_tree()`, so a detached visible Node3D is still visible-in-tree by this
 * API's historical name.
 */
export function isSpatialVisibleInTree(node: VisibleNode): boolean {
  return visibleAncestors(node);
}

/** The native `visibility_changed` signal attached to the retained renderer entity. */
export function visibilityChangedSignal(
  tree: Pick<SceneTree, 'isInsideTree'>,
  node: VisibleNode,
): GodotSignal<[]> {
  const prior = VISIBILITY_SIGNALS.get(node);
  if (prior !== undefined) {
    if (prior.tree !== tree) {
      throw new Error('godot-compat: one visible node cannot belong to two SceneTrees.');
    }
    return prior.handle.signal;
  }
  const handle = createSignal<[]>();
  VISIBILITY_SIGNALS.set(node, { tree, handle });
  return handle.signal;
}

/** Native CanvasItem `hidden` signal, emitted when effective tree visibility becomes false. */
export function hiddenSignal(
  tree: Pick<SceneTree, 'isInsideTree'>,
  node: VisibleNode,
): GodotSignal<[]> {
  const prior = HIDDEN_SIGNALS.get(node);
  if (prior !== undefined) {
    if (prior.tree !== tree) throw new Error('godot-compat: one visible node cannot belong to two SceneTrees.');
    return prior.handle.signal;
  }
  const handle = createSignal<[]>();
  HIDDEN_SIGNALS.set(node, { tree, handle });
  return handle.signal;
}

function effectivelyVisibleHiddenObservers(node: VisibleNode): VisibilitySignalState[] {
  const observed: VisibilitySignalState[] = [];
  const visit = (candidate: VisibleNode): void => {
    const state = HIDDEN_SIGNALS.get(candidate);
    if (state !== undefined && state.tree.isInsideTree(candidate) && visibleAncestors(candidate)) observed.push(state);
    for (const child of candidate.children ?? []) visit(child as VisibleNode);
  };
  visit(node);
  return observed;
}

function observedVisibilitySubtree(node: VisibleNode): VisibleNode[] {
  const observed: VisibleNode[] = [];
  const visit = (candidate: VisibleNode, changedNode: boolean): void => {
    const state = VISIBILITY_SIGNALS.get(candidate);
    if (state !== undefined && state.tree.isInsideTree(candidate)) observed.push(candidate);
    for (const child of candidate.children ?? []) {
      const visibleChild = child as VisibleNode;
      // CanvasItem::_propagate_visibility_changed and Node3D::_propagate_visibility_changed stop
      // at locally hidden descendants. The node whose local flag changed is notified regardless
      // of an invisible ancestor, hence the root is visited unconditionally.
      if (changedNode || candidate.visible) {
        if (visibleChild.visible) visit(visibleChild, false);
      }
    }
  };
  visit(node, true);
  return observed;
}

/** `canvas_item.hide()` — `Player.gd:11`, `:51`; `HUD.gd:26`, `:31`. */
export function hide(node: VisibleNode): void {
  setVisible(node, false);
}

/** `canvas_item.show()` — `Player.gd:46`; `HUD.gd:8`, `:16`, `:18`. */
export function show(node: VisibleNode): void {
  setVisible(node, true);
}

/** `canvas_item.visible = v`. */
export function setVisible(node: VisibleNode, value: boolean): void {
  if (typeof value !== 'boolean') {
    throw new TypeError(`Godot CanvasItem/Node3D.visible requires bool; got ${typeof value}.`);
  }
  if (node.visible === value) return;
  const hiddenObservers = value ? [] : effectivelyVisibleHiddenObservers(node);
  node.visible = value;
  for (const candidate of observedVisibilitySubtree(node)) {
    for (const observer of VISIBILITY_OBSERVERS.get(candidate) ?? []) observer(visibleAncestors(candidate));
    const state = VISIBILITY_SIGNALS.get(candidate);
    state?.handle.emit();
  }
  for (const state of hiddenObservers) state.handle.emit();
}

/**
 * `canvas_item.get_viewport_rect()` — `Player.gd:10`,
 * `screen_size = get_viewport_rect().size`.
 *
 * The size is the PORT'S, passed in: Pixi's `app.screen` (a `Rectangle`) and
 * the engine's own canvas size both satisfy `{ width, height }` structurally,
 * so nothing here needs a `pixi.js` `Application` import for one read. Godot's
 * viewport rect always starts at the origin for the default viewport, which is
 * the only one a `CanvasItem` in this position can be in.
 */
export function getViewportRect(screen: {
  readonly width: number;
  readonly height: number;
}): Rect2 {
  return rect2(0, 0, screen.width, screen.height);
}

/** `CanvasItem.get_local_mouse_position()` — convert the viewport pointer through Pixi's own live
 * world transform, including every translated parent position, scale and rotation. */
export function getLocalMousePosition(
  node: Container,
  input: { readonly getMousePosition?: () => Vector2 },
): Vector2 {
  const global = input.getMousePosition?.() ?? VECTOR2_ZERO;
  const local = node.toLocal(global);
  return vec2(local.x, local.y);
}

// --- Node2D --------------------------------------------------------------------------------------

/**
 * `node2d.position` — as a `Vector2` VALUE.
 *
 * Pixi's `container.position` is an `ObservablePoint`: a live handle whose
 * writes move the node. Godot's `position` read produces a copy, so
 * `var pos = $StartPosition.position` must not keep tracking `StartPosition`
 * afterwards. Copying is what makes `Main.gd:41`'s
 * `mob.position = mob_spawn_location.position` mean what it means.
 */
export function getPosition(node: Container): Vector2 {
  return vec2(node.position.x, node.position.y);
}

/** `node2d.position = v` — `Player.gd:45`, `Main.gd:41`. Accepts any
 *  `PointData`, so a `Vector2` from `vector2.ts` and a live Pixi point both go
 *  in without a conversion at the call site. */
export function setPosition(node: Container, value: unknown): void {
  if (
    typeof value !== 'object' || value === null ||
    !('x' in value) || !('y' in value) ||
    typeof value.x !== 'number' || typeof value.y !== 'number' ||
    !Number.isFinite(value.x) || !Number.isFinite(value.y)
  ) {
    throw new TypeError('Godot Node2D.position requires a finite Vector2.');
  }
  node.position.set(value.x, value.y);
}

/** `node2d.rotation` — RADIANS, in both engines. */
export function getRotation(node: Container): number {
  return node.rotation;
}

/** `node2d.rotation = r` — `Main.gd:45`. */
export function setRotation(node: Container, radians: number): void {
  if (!Number.isFinite(radians)) {
    throw new TypeError(`Godot Node2D.rotation requires a finite number; received ${String(radians)}.`);
  }
  node.rotation = radians;
}

/** `Node2D.rotate(radians)` applies one local rotation delta. */
export function rotateNode2D(node: Container, radians: number): void {
  if (!Number.isFinite(radians)) {
    throw new TypeError(`Godot Node2D.rotate requires a finite number; received ${String(radians)}.`);
  }
  node.rotation += radians;
}

export function translateNode2D(node: Container, offset: PointData): void {
  if (typeof offset !== 'object' || offset === null || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) throw new TypeError('Godot Node2D.translate requires a finite Vector2.');
  node.position.set(node.position.x + offset.x, node.position.y + offset.y);
}

export function applyScaleNode2D(node: Container, ratio: PointData): void {
  if (typeof ratio !== 'object' || ratio === null || !Number.isFinite(ratio.x) || !Number.isFinite(ratio.y)) throw new TypeError('Godot Node2D.apply_scale requires a finite Vector2.');
  node.scale.set(node.scale.x * ratio.x, node.scale.y * ratio.y);
}

export function moveLocalXNode2D(node: Container, delta: number, scaled = false): void {
  if (!Number.isFinite(delta) || typeof scaled !== 'boolean') throw new TypeError('Godot Node2D.move_local_x requires finite delta and bool scaled.');
  const distance = scaled ? delta * node.scale.x : delta;
  node.position.set(node.position.x + Math.cos(node.rotation) * distance, node.position.y + Math.sin(node.rotation) * distance);
}

export function moveLocalYNode2D(node: Container, delta: number, scaled = false): void {
  if (!Number.isFinite(delta) || typeof scaled !== 'boolean') throw new TypeError('Godot Node2D.move_local_y requires finite delta and bool scaled.');
  const distance = scaled ? delta * node.scale.y : delta;
  node.position.set(node.position.x - Math.sin(node.rotation) * distance, node.position.y + Math.cos(node.rotation) * distance);
}

export function getAngleToNode2D(node: Container, target: PointData): number {
  if (typeof target !== 'object' || target === null || !Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new TypeError('Godot Node2D.get_angle_to requires finite Vector2.');
  const global = node.getGlobalPosition();
  const globalRotation = Math.atan2(node.worldTransform.b, node.worldTransform.a);
  let angle = Math.atan2(target.y - global.y, target.x - global.x) - globalRotation;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export function getGlobalPositionNode2D(node: Container): Vector2 {
  const value = node.getGlobalPosition();
  return vec2(value.x, value.y);
}

export function setGlobalPositionNode2D(node: Container, value: PointData): void {
  if (typeof value !== 'object' || value === null || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError('Godot Node2D.global_position requires finite Vector2.');
  const local = node.parent instanceof Container ? node.parent.toLocal(value) : value;
  node.position.set(local.x, local.y);
}

export function getGlobalRotationNode2D(node: Container): number {
  node.getGlobalPosition();
  return Math.atan2(node.worldTransform.b, node.worldTransform.a);
}

/** Legacy public helper spelling retained by the package root export. */
export const getGlobalRotation = getGlobalRotationNode2D;

export function setGlobalRotationNode2D(node: Container, radians: number): void {
  if (!Number.isFinite(radians)) throw new TypeError('Godot Node2D.global_rotation requires finite radians.');
  const parentRotation = node.parent instanceof Container ? getGlobalRotationNode2D(node.parent) : 0;
  node.rotation = radians - parentRotation;
}

export function getGlobalRotationDegreesNode2D(node: Container): number {
  return getGlobalRotationNode2D(node) * RADIANS_TO_DEGREES;
}

export function setGlobalRotationDegreesNode2D(node: Container, degrees: number): void {
  if (!Number.isFinite(degrees)) throw new TypeError('Godot Node2D.global_rotation_degrees requires finite degrees.');
  setGlobalRotationNode2D(node, degrees * DEGREES_TO_RADIANS);
}

export function getGlobalScaleNode2D(node: Container): Vector2 {
  node.getGlobalPosition();
  const matrix = node.worldTransform;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  return vec2(Math.hypot(matrix.a, matrix.b), Math.sign(determinant || 1) * Math.hypot(matrix.c, matrix.d));
}

export function setGlobalScaleNode2D(node: Container, value: PointData): void {
  if (typeof value !== 'object' || value === null || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError('Godot Node2D.global_scale requires finite Vector2.');
  const parentScale = node.parent instanceof Container ? getGlobalScaleNode2D(node.parent) : vec2(1, 1);
  setScale(node, vec2(parentScale.x === 0 ? value.x : value.x / parentScale.x, parentScale.y === 0 ? value.y : value.y / parentScale.y));
}

export function lookAtNode2D(node: Container, target: PointData): void {
  if (typeof target !== 'object' || target === null || !Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new TypeError('Godot Node2D.look_at requires finite Vector2.');
  const position = node.getGlobalPosition();
  setGlobalRotationNode2D(node, Math.atan2(target.y - position.y, target.x - position.x));
}

export function toLocalNode2D(node: Container, globalPoint: PointData): Vector2 {
  if (typeof globalPoint !== 'object' || globalPoint === null || !Number.isFinite(globalPoint.x) || !Number.isFinite(globalPoint.y)) throw new TypeError('Godot Node2D.to_local requires finite Vector2.');
  const local = node.toLocal(globalPoint);
  return vec2(local.x, local.y);
}

export function toGlobalNode2D(node: Container, localPoint: PointData): Vector2 {
  if (typeof localPoint !== 'object' || localPoint === null || !Number.isFinite(localPoint.x) || !Number.isFinite(localPoint.y)) throw new TypeError('Godot Node2D.to_global requires finite Vector2.');
  const global = node.toGlobal(localPoint);
  return vec2(global.x, global.y);
}
export function getSkewNode2D(node: Container): number { return node.skew.x; }
export function setSkewNode2D(node: Container, radians: number): void {
  if (!Number.isFinite(radians)) throw new TypeError('Godot Node2D.skew requires finite radians.');
  node.skew.x = radians;
}
export function getSkewDegreesNode2D(node: Container): number { return getSkewNode2D(node) * RADIANS_TO_DEGREES; }
export function setSkewDegreesNode2D(node: Container, degrees: number): void {
  if (!Number.isFinite(degrees)) throw new TypeError('Godot Node2D.skew_degrees requires finite degrees.');
  setSkewNode2D(node, degrees * DEGREES_TO_RADIANS);
}

const RADIANS_TO_DEGREES = 180 / Math.PI;
const DEGREES_TO_RADIANS = Math.PI / 180;

/** `Node2D.rotation_degrees` is the local rotation stored by Pixi, converted as a value. */
export function getRotationDegrees(node: Container): number {
  return node.rotation * RADIANS_TO_DEGREES;
}

export function setRotationDegrees(node: Container, degrees: number): void {
  if (!Number.isFinite(degrees)) {
    throw new TypeError(
      `Godot Node2D.rotation_degrees requires a finite number; received ${String(degrees)}.`,
    );
  }
  node.rotation = degrees * DEGREES_TO_RADIANS;
}

/** `Node2D.z_index`, backed by Pixi's native sibling sorting field. */
export function getZIndex(node: Container): number {
  return zState(node).local;
}

export function setZIndex(node: Container, value: number): void {
  // CanvasItem's RenderingServer range in both pinned engines.
  if (!Number.isInteger(value) || value < -4096 || value > 4096) {
    throw new RangeError(
      `Godot Node2D.z_index requires an integer from -4096 through 4096; received ${String(value)}.`,
    );
  }
  const state = zState(node);
  if (state.local === value) return;
  state.local = value;
  syncNode2DZ(node);
}

interface Node2DZState {
  local: number;
  relative: boolean;
}

const NODE_2D_Z = new WeakMap<Container, Node2DZState>();
const CANVAS_Y_SORT = new WeakMap<Container, {
  readonly originalSortableChildren: boolean;
  readonly originalSortChildren: Container['sortChildren'];
  nextOrder: number;
  readonly order: WeakMap<Container, number>;
  attached: Set<Container>;
}>();

function captureCanvasChildInsertionOrder(parent: Container): void {
  const state = CANVAS_Y_SORT.get(parent);
  if (state === undefined) return;
  const attached = new Set(parent.children);
  for (const child of parent.children) {
    if (!state.attached.has(child)) {
      state.order.set(child, state.nextOrder);
      state.nextOrder += 1;
    }
  }
  state.attached = attached;
}

function sortCanvasChildrenByY(parent: Container): void {
  const state = CANVAS_Y_SORT.get(parent);
  if (state === undefined) return;
  captureCanvasChildInsertionOrder(parent);
  parent.children.sort((left, right) =>
    left.zIndex - right.zIndex ||
    left.position.y - right.position.y ||
    (state.order.get(left) ?? 0) - (state.order.get(right) ?? 0));
}

/** Godot CanvasItem.y_sort_enabled over Pixi's retained child list, refreshed every render. */
export function setCanvasYSortEnabled(node: Container, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('CanvasItem.y_sort_enabled requires bool.');
  const existing = CANVAS_Y_SORT.get(node);
  if (!value) {
    if (existing === undefined) return;
    captureCanvasChildInsertionOrder(node);
    node.children.sort((left, right) =>
      left.zIndex - right.zIndex ||
      (existing.order.get(left) ?? 0) - (existing.order.get(right) ?? 0));
    node.sortChildren = existing.originalSortChildren;
    node.sortableChildren = existing.originalSortableChildren;
    CANVAS_Y_SORT.delete(node);
    return;
  }
  if (existing !== undefined) return;
  const order = new WeakMap<Container, number>();
  node.children.forEach((child, index) => order.set(child, index));
  const state = {
      originalSortableChildren: node.sortableChildren,
      originalSortChildren: node.sortChildren,
      nextOrder: 0,
      order,
      attached: new Set(node.children),
  };
  state.nextOrder = node.children.length;
  CANVAS_Y_SORT.set(node, state);
  // Pixi invokes sortChildren before traversing child renderables whenever sortableChildren is
  // enabled. Replacing that one native comparator seam makes moving children reorder in the same
  // frame; an onRender callback would run after Pixi had already chosen traversal order.
  node.sortChildren = () => sortCanvasChildrenByY(node);
  node.sortableChildren = true;
  node.sortChildren();
}

export function isCanvasYSortEnabled(node: Container): boolean {
  return CANVAS_Y_SORT.has(node);
}

function zState(node: Container): Node2DZState {
  let state = NODE_2D_Z.get(node);
  if (state === undefined) {
    state = { local: node.zIndex, relative: true };
    NODE_2D_Z.set(node, state);
  }
  return state;
}

function effectiveNode2DZ(node: Container): number {
  const state = zState(node);
  if (!state.relative || node.parent === null) return state.local;
  return state.local + effectiveNode2DZ(node.parent);
}

/** Apply cumulative Godot Z to Pixi's native sort field and every relative descendant. */
export function syncNode2DZ(node: Container): void {
  node.zIndex = effectiveNode2DZ(node);
  if (node.parent !== null) {
    node.parent.sortableChildren = true;
    node.parent.sortChildren();
  }
  for (const child of authoredCanvasChildren(node)) {
    if (getZAsRelative(child)) syncNode2DZ(child);
  }
}

/** Godot's default is relative Z; Pixi keeps the authored local zIndex on the retained node. */
export function getZAsRelative(node: Container): boolean {
  return zState(node).relative;
}

export function setZAsRelative(node: Container, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Node2D.z_as_relative requires a boolean.');
  const state = zState(node);
  if (state.relative === value) return;
  state.relative = value;
  syncNode2DZ(node);
}

/** `node2d.scale` — as a `Vector2` VALUE, never Pixi's live ObservablePoint. */
export function getScale(node: Container): Vector2 {
  const spriteScale = node instanceof Sprite ? SPRITE_LOGICAL_SCALE.get(node) : undefined;
  return spriteScale === undefined ? vec2(node.scale.x, node.scale.y) : vec2(spriteScale.x, spriteScale.y);
}

/** `node2d.scale = v` — preserve Godot's value semantics at the Pixi boundary. */
export function setScale(node: Container, value: PointData): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError('Node2D.scale requires a finite Vector2.');
  }
  if (node instanceof Sprite) {
    SPRITE_LOGICAL_SCALE.set(node, { x: value.x, y: value.y });
    node.scale.set((SPRITE_FLIP_H.get(node) ?? false) ? -value.x : value.x, value.y);
    return;
  }
  node.scale.set(value.x, value.y);
}

/** `Node2D.transform` as a Godot Transform2D VALUE, never Pixi's mutable internal Transform. */
export function getNode2DTransform(node: Container): GodotTransform2D {
  node.updateLocalTransform();
  const value = node.localTransform;
  return {
    x: vec2(value.a, value.b),
    y: vec2(value.c, value.d),
    origin: vec2(value.tx, value.ty),
  };
}

export function getNode2DGlobalTransform(node: Container): GodotTransform2D {
  node.getGlobalPosition();
  const value = node.worldTransform;
  return {
    x: vec2(value.a, value.b),
    y: vec2(value.c, value.d),
    origin: vec2(value.tx, value.ty),
  };
}

export function setNode2DGlobalTransform(node: Container, value: GodotTransform2D): void {
  const global = new Matrix(value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y);
  if (!(node.parent instanceof Container)) {
    node.setFromMatrix(global);
    return;
  }
  node.parent.getGlobalPosition();
  const parent = node.parent.worldTransform;
  const determinant = parent.a * parent.d - parent.b * parent.c;
  if (Math.abs(determinant) <= Number.EPSILON) {
    throw new RangeError('Godot Node2D.global_transform cannot be assigned below a singular parent transform.');
  }
  const inverseA = parent.d / determinant;
  const inverseB = -parent.b / determinant;
  const inverseC = -parent.c / determinant;
  const inverseD = parent.a / determinant;
  node.setFromMatrix(new Matrix(
    inverseA * global.a + inverseC * global.b,
    inverseB * global.a + inverseD * global.b,
    inverseA * global.c + inverseC * global.d,
    inverseB * global.c + inverseD * global.d,
    inverseA * (global.tx - parent.tx) + inverseC * (global.ty - parent.ty),
    inverseB * (global.tx - parent.tx) + inverseD * (global.ty - parent.ty),
  ));
}

export function getRelativeTransformToParentNode2D(node: Container, parent: Container): GodotTransform2D {
  if (parent === node) return getNode2DTransform(node);
  const global = getNode2DGlobalTransform(node);
  parent.getGlobalPosition();
  const matrix = parent.worldTransform;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) <= Number.EPSILON) {
    throw new RangeError('Godot Node2D relative transform parent is singular.');
  }
  const inverseA = matrix.d / determinant;
  const inverseB = -matrix.b / determinant;
  const inverseC = -matrix.c / determinant;
  const inverseD = matrix.a / determinant;
  return {
    x: vec2(inverseA * global.x.x + inverseC * global.x.y, inverseB * global.x.x + inverseD * global.x.y),
    y: vec2(inverseA * global.y.x + inverseC * global.y.y, inverseB * global.y.x + inverseD * global.y.y),
    origin: vec2(
      inverseA * (global.origin.x - matrix.tx) + inverseC * (global.origin.y - matrix.ty),
      inverseB * (global.origin.x - matrix.tx) + inverseD * (global.origin.y - matrix.ty),
    ),
  };
}

/** Replace the retained entity's complete local basis + origin through Pixi's native matrix
 * decomposition. This preserves skew/reflection instead of pretending transform is position only. */
export function setNode2DTransform(node: Container, value: GodotTransform2D): void {
  const numbers = [
    value?.x?.x,
    value?.x?.y,
    value?.y?.x,
    value?.y?.y,
    value?.origin?.x,
    value?.origin?.y,
  ];
  if (numbers.some((component) => typeof component !== 'number' || !Number.isFinite(component))) {
    throw new Error(
      'godot-compat: Node2D.transform requires a finite Transform2D value with x, y and origin ' +
        'Vector2 fields; the assigned value did not have that shape.',
    );
  }
  node.setFromMatrix(
    new Matrix(value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y),
  );
}

/** `sprite_2d.texture` — Pixi's own native texture object. */
export function getSpriteTexture(node: Sprite): Texture {
  return SPRITE_REGION_STATE.get(node)?.source ?? getCanvasItemSourceTexture(node, node.texture);
}

/** `sprite_2d.texture = texture` — the emitted world already loaded the resource. */
export function setSpriteTexture(node: Sprite, texture: Texture | string): void {
  const resolved =
    typeof texture === 'string'
      ? Texture.from(texture.startsWith('res://') ? `/${texture.slice('res://'.length)}` : texture)
      : texture;
  const state = SPRITE_REGION_STATE.get(node);
  if (state === undefined) {
    node.texture = resolved;
    syncSpriteLayout(node);
  }
  else {
    state.source = resolved;
    syncSpriteRegion(node, state);
  }
  syncCanvasItemTextureFilter(node);
}

interface SpriteRegionState {
  source: Texture;
  enabled: boolean;
  rect: Rect2;
  hframes: number;
  vframes: number;
  frame: number;
  derived: Texture | undefined;
}

const SPRITE_REGION_STATE = new WeakMap<Sprite, SpriteRegionState>();

function copyRect(value: Rect2): Rect2 {
  return rect2(value.position.x, value.position.y, value.size.x, value.size.y);
}

function validatedRegion(value: Rect2): Rect2 {
  const numbers = [value?.position?.x, value?.position?.y, value?.size?.x, value?.size?.y];
  if (numbers.some((part) => typeof part !== 'number' || !Number.isFinite(part))) {
    throw new TypeError('Sprite.region_rect requires a finite Rect2.');
  }
  if (value.size.x < 0 || value.size.y < 0) throw new RangeError('Sprite.region_rect size must be non-negative.');
  return copyRect(value);
}

function syncSpriteRegion(node: Sprite, state: SpriteRegionState): void {
  const prior = state.derived;
  if (!state.enabled && state.hframes === 1 && state.vframes === 1) {
    node.texture = state.source;
    state.derived = undefined;
    prior?.destroy(false);
    syncSpriteLayout(node);
    syncCanvasItemTextureFilter(node);
    return;
  }
  const sourceFrame = state.source.frame;
  const regionX = state.enabled ? state.rect.position.x : 0;
  const regionY = state.enabled ? state.rect.position.y : 0;
  const regionWidth = state.enabled ? state.rect.size.x : sourceFrame.width;
  const regionHeight = state.enabled ? state.rect.size.y : sourceFrame.height;
  const frameWidth = Math.floor(regionWidth / state.hframes);
  const frameHeight = Math.floor(regionHeight / state.vframes);
  const column = state.frame % state.hframes;
  const row = Math.floor(state.frame / state.hframes);
  const derived = new Texture({
    source: state.source.source,
    frame: new Rectangle(
      sourceFrame.x + regionX + column * frameWidth,
      sourceFrame.y + regionY + row * frameHeight,
      frameWidth,
      frameHeight,
    ),
  });
  state.derived = derived;
  node.texture = derived;
  prior?.destroy(false);
  syncSpriteLayout(node);
  syncCanvasItemTextureFilter(node);
}

interface SpriteLayoutState {
  centered: boolean;
  offset: PointData;
}
const SPRITE_LAYOUT_STATE = new WeakMap<Sprite, SpriteLayoutState>();

function finiteSpriteOffset(value: PointData): PointData {
  if (
    typeof value !== 'object' || value === null ||
    typeof value.x !== 'number' || !Number.isFinite(value.x) ||
    typeof value.y !== 'number' || !Number.isFinite(value.y)
  ) {
    throw new TypeError('Sprite.offset requires a finite Vector2.');
  }
  return { x: value.x, y: value.y };
}

function spriteLayoutState(node: Sprite): SpriteLayoutState {
  const existing = SPRITE_LAYOUT_STATE.get(node);
  if (existing !== undefined) return existing;
  const state = {
    centered: Math.abs(node.anchor.x - 0.5) < 1e-9 && Math.abs(node.anchor.y - 0.5) < 1e-9,
    offset: { x: 0, y: 0 },
  };
  SPRITE_LAYOUT_STATE.set(node, state);
  return state;
}

function syncSpriteLayout(node: Sprite): void {
  const state = SPRITE_LAYOUT_STATE.get(node);
  if (state === undefined) return;
  const width = Math.max(1, node.texture.orig.width);
  const height = Math.max(1, node.texture.orig.height);
  node.anchor.set(
    (state.centered ? 0.5 : 0) - state.offset.x / width,
    (state.centered ? 0.5 : 0) - state.offset.y / height,
  );
}

export function bindSpriteLayout(node: Sprite, centered: boolean, offset: PointData): void {
  if (typeof centered !== 'boolean') throw new TypeError('Sprite.centered requires bool.');
  SPRITE_LAYOUT_STATE.set(node, { centered, offset: finiteSpriteOffset(offset) });
  syncSpriteLayout(node);
}

export function isSpriteCentered(node: Sprite): boolean { return spriteLayoutState(node).centered; }
export function setSpriteCentered(node: Sprite, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Sprite.centered requires bool.');
  spriteLayoutState(node).centered = value;
  syncSpriteLayout(node);
}
export function getSpriteOffset(node: Sprite): PointData { return { ...spriteLayoutState(node).offset }; }
export function setSpriteOffset(node: Sprite, value: PointData): void {
  spriteLayoutState(node).offset = finiteSpriteOffset(value);
  syncSpriteLayout(node);
}

export function bindSpriteRegion(node: Sprite, enabled: boolean, value: Rect2): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Sprite.region_enabled requires bool.');
  const state: SpriteRegionState = {
    source: node.texture,
    enabled,
    rect: validatedRegion(value),
    hframes: 1,
    vframes: 1,
    frame: 0,
    derived: undefined,
  };
  SPRITE_REGION_STATE.set(node, state);
  syncSpriteRegion(node, state);
}

function positiveFrameCount(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${member} must be a positive integer.`);
  }
  return value;
}
function spriteRegionState(node: Sprite): SpriteRegionState {
  const existing = SPRITE_REGION_STATE.get(node);
  if (existing !== undefined) return existing;
  const state: SpriteRegionState = {
    source: node.texture,
    enabled: false,
    rect: rect2(0, 0, 0, 0),
    hframes: 1,
    vframes: 1,
    frame: 0,
    derived: undefined,
  };
  SPRITE_REGION_STATE.set(node, state);
  return state;
}

/** Seat authored Sprite sheet dimensions and initial frame on the retained Pixi texture. */
export function bindSpriteSheet(node: Sprite, hframes: number, vframes: number, frame: number): void {
  const state = spriteRegionState(node);
  state.hframes = positiveFrameCount(hframes, 'Sprite.hframes');
  state.vframes = positiveFrameCount(vframes, 'Sprite.vframes');
  setSpriteFrame(node, frame);
}

export function getSpriteHframes(node: Sprite): number {
  return SPRITE_REGION_STATE.get(node)?.hframes ?? 1;
}

export function setSpriteHframes(node: Sprite, value: number): void {
  const state = spriteRegionState(node);
  state.hframes = positiveFrameCount(value, 'Sprite.hframes');
  if (state.frame >= state.hframes * state.vframes) state.frame = 0;
  syncSpriteRegion(node, state);
}

export function getSpriteVframes(node: Sprite): number {
  return SPRITE_REGION_STATE.get(node)?.vframes ?? 1;
}

export function setSpriteVframes(node: Sprite, value: number): void {
  const state = spriteRegionState(node);
  state.vframes = positiveFrameCount(value, 'Sprite.vframes');
  if (state.frame >= state.hframes * state.vframes) state.frame = 0;
  syncSpriteRegion(node, state);
}

export function isSpriteRegionEnabled(node: Sprite): boolean {
  return SPRITE_REGION_STATE.get(node)?.enabled ?? false;
}

export function setSpriteRegionEnabled(node: Sprite, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Sprite.region_enabled requires bool.');
  const state = spriteRegionState(node);
  if (state.enabled === value) return;
  state.enabled = value;
  syncSpriteRegion(node, state);
}

export function getSpriteFrame(node: Sprite): number {
  return SPRITE_REGION_STATE.get(node)?.frame ?? 0;
}

export function setSpriteFrame(node: Sprite, frame: number): void {
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new RangeError('Sprite.frame must be a non-negative integer.');
  }
  const state = spriteRegionState(node);
  const frameCount = state.hframes * state.vframes;
  if (frame >= frameCount) {
    throw new RangeError(`Sprite.frame ${String(frame)} exceeds the ${String(frameCount)}-frame sheet.`);
  }
  state.frame = frame;
  syncSpriteRegion(node, state);
}

export function getSpriteFrameCoords(node: Sprite): PointData {
  const state = spriteRegionState(node);
  return { x: state.frame % state.hframes, y: Math.floor(state.frame / state.hframes) };
}

export function setSpriteFrameCoords(node: Sprite, value: PointData): void {
  const state = spriteRegionState(node);
  if (
    typeof value !== 'object' || value === null ||
    !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y) ||
    value.x < 0 || value.x >= state.hframes || value.y < 0 || value.y >= state.vframes
  ) {
    throw new RangeError(
      `Sprite.frame_coords must be inside the ${String(state.hframes)}x${String(state.vframes)} frame grid.`,
    );
  }
  setSpriteFrame(node, value.y * state.hframes + value.x);
}

const SPRITE_FLIP_H = new WeakMap<Sprite, boolean>();
const SPRITE_FLIP_V = new WeakMap<Sprite, boolean>();
const SPRITE_LOGICAL_SCALE = new WeakMap<Sprite, PointData>();
const SPRITE_REGION_FILTER_CLIP = new WeakMap<Sprite, boolean>();

export function getSpriteFlipH(node: Sprite): boolean {
  return SPRITE_FLIP_H.get(node) ?? false;
}

export function setSpriteFlipH(node: Sprite, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Sprite.flip_h requires bool.');
  const previousFlip = SPRITE_FLIP_H.get(node) ?? false;
  const logical = SPRITE_LOGICAL_SCALE.get(node) ?? {
    x: previousFlip ? -node.scale.x : node.scale.x,
    y: (SPRITE_FLIP_V.get(node) ?? false) ? -node.scale.y : node.scale.y,
  };
  SPRITE_LOGICAL_SCALE.set(node, logical);
  SPRITE_FLIP_H.set(node, value);
  node.scale.set(value ? -logical.x : logical.x, (SPRITE_FLIP_V.get(node) ?? false) ? -logical.y : logical.y);
}

export function getSpriteFlipV(node: Sprite): boolean {
  return SPRITE_FLIP_V.get(node) ?? false;
}

export function setSpriteFlipV(node: Sprite, value: boolean): void {
  if (typeof value !== 'boolean') throw new TypeError('Sprite.flip_v requires bool.');
  const previousFlip = SPRITE_FLIP_V.get(node) ?? false;
  const logical = SPRITE_LOGICAL_SCALE.get(node) ?? {
    x: (SPRITE_FLIP_H.get(node) ?? false) ? -node.scale.x : node.scale.x,
    y: previousFlip ? -node.scale.y : node.scale.y,
  };
  SPRITE_LOGICAL_SCALE.set(node, logical);
  SPRITE_FLIP_V.set(node, value);
  node.scale.set((SPRITE_FLIP_H.get(node) ?? false) ? -logical.x : logical.x, value ? -logical.y : logical.y);
}
export function getSpriteRegionRect(node: Sprite): Rect2 {
  return copyRect(SPRITE_REGION_STATE.get(node)?.rect ?? rect2(0, 0, 0, 0));
}

export function setSpriteRegionRect(node: Sprite, value: Rect2): void {
  const state = SPRITE_REGION_STATE.get(node);
  if (state === undefined) {
    bindSpriteRegion(node, false, value);
    return;
  }
  state.rect = validatedRegion(value);
  syncSpriteRegion(node, state);
}

export function getSpriteRect(node: Sprite): Rect2 {
  const bounds = node.getLocalBounds();
  return rect2(bounds.x, bounds.y, bounds.width, bounds.height);
}

export function isSpriteRegionFilterClipEnabled(node: Sprite): boolean {
  return SPRITE_REGION_FILTER_CLIP.get(node) ?? false;
}

export function setSpriteRegionFilterClipEnabled(node: Sprite, value: boolean): void {
  if (typeof value !== 'boolean') {
    throw new TypeError('Sprite2D.region_filter_clip_enabled requires bool.');
  }
  SPRITE_REGION_FILTER_CLIP.set(node, value);
}

/** Native Godot Sprite/Sprite2D surface installed directly on the retained Pixi Sprite. */
export type GodotCanvasSprite = Sprite & GodotCanvasNode2D & {
  centered: boolean;
  offset: PointData;
  flip_h: boolean;
  flip_v: boolean;
  hframes: number;
  vframes: number;
  frame: number;
  frame_coords: PointData;
  region_enabled: boolean;
  region_rect: Rect2;
  region_filter_clip_enabled: boolean;
  get_texture(): Texture;
  set_texture(value: Texture | string): void;
  is_centered(): boolean;
  set_centered(value: boolean): void;
  get_offset(): PointData;
  set_offset(value: PointData): void;
  is_flipped_h(): boolean;
  set_flip_h(value: boolean): void;
  is_flipped_v(): boolean;
  set_flip_v(value: boolean): void;
  get_hframes(): number;
  set_hframes(value: number): void;
  get_vframes(): number;
  set_vframes(value: number): void;
  get_frame(): number;
  set_frame(value: number): void;
  get_frame_coords(): PointData;
  set_frame_coords(value: PointData): void;
  is_region_enabled(): boolean;
  set_region_enabled(value: boolean): void;
  get_region_rect(): Rect2;
  set_region_rect(value: Rect2): void;
  is_region_filter_clip_enabled(): boolean;
  set_region_filter_clip_enabled(value: boolean): void;
  get_rect(): Rect2;
};

export function bindGodotCanvasSpriteApi<T extends Sprite & GodotCanvasNode2D>(
  source: T,
  godotClass: 'Sprite' | 'Sprite2D',
): T & GodotCanvasSprite {
  const sprite = source as T & GodotCanvasSprite;
  Object.defineProperties(sprite, {
    centered: { configurable: true, enumerable: true, get: () => isSpriteCentered(sprite), set: (value: boolean) => setSpriteCentered(sprite, value) },
    offset: { configurable: true, enumerable: true, get: () => getSpriteOffset(sprite), set: (value: PointData) => setSpriteOffset(sprite, value) },
    flip_h: { configurable: true, enumerable: true, get: () => getSpriteFlipH(sprite), set: (value: boolean) => setSpriteFlipH(sprite, value) },
    flip_v: { configurable: true, enumerable: true, get: () => getSpriteFlipV(sprite), set: (value: boolean) => setSpriteFlipV(sprite, value) },
    hframes: { configurable: true, enumerable: true, get: () => getSpriteHframes(sprite), set: (value: number) => setSpriteHframes(sprite, value) },
    vframes: { configurable: true, enumerable: true, get: () => getSpriteVframes(sprite), set: (value: number) => setSpriteVframes(sprite, value) },
    frame: { configurable: true, enumerable: true, get: () => getSpriteFrame(sprite), set: (value: number) => setSpriteFrame(sprite, value) },
    frame_coords: { configurable: true, enumerable: true, get: () => getSpriteFrameCoords(sprite), set: (value: PointData) => setSpriteFrameCoords(sprite, value) },
    region_enabled: { configurable: true, enumerable: true, get: () => isSpriteRegionEnabled(sprite), set: (value: boolean) => setSpriteRegionEnabled(sprite, value) },
    region_rect: { configurable: true, enumerable: true, get: () => getSpriteRegionRect(sprite), set: (value: Rect2) => setSpriteRegionRect(sprite, value) },
    region_filter_clip_enabled: { configurable: true, enumerable: true, get: () => isSpriteRegionFilterClipEnabled(sprite), set: (value: boolean) => setSpriteRegionFilterClipEnabled(sprite, value) },
  });
  Object.assign(sprite, {
    get_texture: (): Texture => getSpriteTexture(sprite),
    set_texture: (value: Texture | string): void => setSpriteTexture(sprite, value),
    is_centered: (): boolean => isSpriteCentered(sprite),
    set_centered: (value: boolean): void => setSpriteCentered(sprite, value),
    get_offset: (): PointData => getSpriteOffset(sprite),
    set_offset: (value: PointData): void => setSpriteOffset(sprite, value),
    is_flipped_h: (): boolean => getSpriteFlipH(sprite),
    set_flip_h: (value: boolean): void => setSpriteFlipH(sprite, value),
    is_flipped_v: (): boolean => getSpriteFlipV(sprite),
    set_flip_v: (value: boolean): void => setSpriteFlipV(sprite, value),
    get_hframes: (): number => getSpriteHframes(sprite),
    set_hframes: (value: number): void => setSpriteHframes(sprite, value),
    get_vframes: (): number => getSpriteVframes(sprite),
    set_vframes: (value: number): void => setSpriteVframes(sprite, value),
    get_frame: (): number => getSpriteFrame(sprite),
    set_frame: (value: number): void => setSpriteFrame(sprite, value),
    get_frame_coords: (): PointData => getSpriteFrameCoords(sprite),
    set_frame_coords: (value: PointData): void => setSpriteFrameCoords(sprite, value),
    is_region_enabled: (): boolean => isSpriteRegionEnabled(sprite),
    set_region_enabled: (value: boolean): void => setSpriteRegionEnabled(sprite, value),
    get_region_rect: (): Rect2 => getSpriteRegionRect(sprite),
    set_region_rect: (value: Rect2): void => setSpriteRegionRect(sprite, value),
    is_region_filter_clip_enabled: (): boolean => isSpriteRegionFilterClipEnabled(sprite),
    set_region_filter_clip_enabled: (value: boolean): void => setSpriteRegionFilterClipEnabled(sprite, value),
    get_rect: (): Rect2 => getSpriteRect(sprite),
  });
  registerGodotObjectIdentity(sprite, godotClass);
  return sprite;
}

type ModulatedSprite = Sprite & { modulate: ColorValue };
type ModulatedCanvasItem = Container & { modulate: ColorValue };
const MODULATE_FILTERS = new WeakMap<Container, ColorMatrixFilter>();
const MODULATE_VALUES = new WeakMap<Container, ColorValue>();

function isNativeModulate(value: ColorValue): boolean {
  return value.r >= 0 && value.r <= 1 && value.g >= 0 && value.g <= 1 &&
    value.b >= 0 && value.b <= 1 && value.a >= 0 && value.a <= 1;
}

function modulateTint(value: ColorValue): number {
  const channel = (part: number): number => Math.round(part * 255);
  return (channel(value.r) << 16) | (channel(value.g) << 8) | channel(value.b);
}

/** Install CanvasItem.modulate on any retained native Pixi entity.
 *
 * Pixi applies a Container filter to the flattened subtree. That is the same ownership rule as
 * Godot's inherited CanvasItem modulation: the authored value multiplies this item's draw and
 * every descendant draw without changing any descendant's own local modulation value.
 */
export function installCanvasItemModulate(
  node: Container,
): asserts node is ModulatedCanvasItem {
  if (MODULATE_VALUES.has(node)) return;
  const initial = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
  MODULATE_VALUES.set(node, initial);
  Object.defineProperty(node, 'modulate', {
    configurable: true,
    get: () => MODULATE_VALUES.get(node) ?? initial,
    set: (value: ColorValue) => {
      MODULATE_VALUES.set(node, value);
      const existingFilter = MODULATE_FILTERS.get(node);
      if (isNativeModulate(value)) {
        if (existingFilter !== undefined) {
          const remainingFilters = (node.filters ?? []).filter(
            (candidate) => candidate !== existingFilter,
          );
          node.filters = remainingFilters.length > 0 ? remainingFilters : null;
          existingFilter.destroy();
          MODULATE_FILTERS.delete(node);
        }
        node.tint = modulateTint(value);
        node.alpha = value.a;
        return;
      }

      // The default white value must remain filter-free. A Pixi Container filter renders its
      // complete subtree through an offscreen framebuffer, so eagerly nesting no-op filters turns
      // an ordinary Godot scene into many redundant full-scene render passes.
      const filter = existingFilter ?? new ColorMatrixFilter();
      if (existingFilter === undefined) {
        MODULATE_FILTERS.set(node, filter);
        node.filters = [...(node.filters ?? []), filter];
      }
      node.tint = 0xffffff;
      node.alpha = 1;
      filter.matrix = [
        value.r, 0, 0, 0, 0,
        0, value.g, 0, 0, 0,
        0, 0, value.b, 0, 0,
        0, 0, 0, value.a, 0,
      ];
    },
  });
}

/**
 * Install Godot's `CanvasItem.modulate` directly on the native Pixi Sprite a translated scene
 * owns. A ColorMatrixFilter preserves HDR components such as Match-3's hover `Color(1.2, …)`;
 * `tint` would clamp them to white and silently erase the authored highlight.
 */
export function installSpriteModulate(node: Sprite): asserts node is ModulatedSprite {
  installCanvasItemModulate(node);
}

interface MutableCanvasColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface SelfModulateState {
  readonly targets: readonly Container[];
  filters: ColorMatrixFilter[];
  readonly color: MutableCanvasColor;
  values: [number, number, number, number];
}

const SELF_MODULATES = new WeakMap<Container, SelfModulateState>();

function finiteColorChannel(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${member} requires a finite color channel.`);
  return value;
}

function applySelfModulate(state: SelfModulateState): void {
  const [r, g, b, a] = state.values;
  if (r === 1 && g === 1 && b === 1 && a === 1) {
    for (let index = 0; index < state.filters.length; index += 1) {
      const filter = state.filters[index]!;
      const target = state.targets[index]!;
      const remainingFilters = (target.filters ?? []).filter((candidate) => candidate !== filter);
      target.filters = remainingFilters.length > 0 ? remainingFilters : null;
      filter.destroy();
    }
    state.filters = [];
    return;
  }
  if (state.filters.length === 0) {
    state.filters = state.targets.map((target) => {
      const filter = new ColorMatrixFilter();
      target.filters = [...(target.filters ?? []), filter];
      return filter;
    });
  }
  for (const filter of state.filters) {
    filter.matrix = [
      r, 0, 0, 0, 0,
      0, g, 0, 0, 0,
      0, 0, b, 0, 0,
      0, 0, 0, a, 0,
    ];
  }
}

function selfModulateState(node: Container): SelfModulateState {
  let state = SELF_MODULATES.get(node);
  if (state !== undefined) return state;
  // Godot self_modulate affects this CanvasItem's own draw commands, never its authored children.
  // A retained plain Pixi Container has no draw commands of its own, so it only retains the Color
  // value. Composite controls seat their own drawing in renderer-internal children; filter those
  // seats individually while leaving authored children untouched. A native leaf is its own seat.
  const targets = node.children.length === 0
    ? [node]
    : node.children.filter((child) => INTERNAL_CANVAS_CHILDREN.has(child));
  const values: [number, number, number, number] = [1, 1, 1, 1];
  const color = {} as MutableCanvasColor;
  const stateValue: SelfModulateState = { targets, filters: [], color, values };
  for (const [index, channel] of ['r', 'g', 'b', 'a'].entries()) {
    Object.defineProperty(color, channel, {
      enumerable: true,
      get: () => stateValue.values[index] as number,
      set: (value: number) => {
        stateValue.values[index] = finiteColorChannel(value, `CanvasItem.self_modulate.${channel}`);
        applySelfModulate(stateValue);
      },
    });
  }
  SELF_MODULATES.set(node, stateValue);
  return stateValue;
}

/** Godot's draw-only modulation on the retained Pixi CanvasItem. The returned color is live so
 * `item.self_modulate.a = value` updates the native filter without replacing the Color value. */
export function getSelfModulate(node: Container): MutableCanvasColor {
  return selfModulateState(node).color;
}

export function setSelfModulate(node: Container, value: ColorValue): void {
  const state = selfModulateState(node);
  state.values = [
    finiteColorChannel(value.r, 'CanvasItem.self_modulate.r'),
    finiteColorChannel(value.g, 'CanvasItem.self_modulate.g'),
    finiteColorChannel(value.b, 'CanvasItem.self_modulate.b'),
    finiteColorChannel(value.a, 'CanvasItem.self_modulate.a'),
  ];
  applySelfModulate(state);
}

/** Flush Pixi's retained local/ancestor matrices now, matching CanvasItem.force_update_transform. */
export function forceUpdateCanvasTransform(node: Container): void {
  node.getGlobalTransform(new Matrix());
}

// --- Label ---------------------------------------------------------------------------------------

/**
 * A node with text on it — Pixi's `Text`, and whatever a port's UI layer uses
 * where the Godot game authored a `Label`.
 *
 * Structural for the reason {@link VisibleNode} is: `text` is one string
 * property under the same name everywhere, and a `Label` in a 3D Godot game
 * (`squash-the-creeps`' `ScoreLabel`) is a UI node, not a mesh — so binding
 * this signature to Pixi would have made the 3D lane's score display a gap it
 * is not.
 */
export interface TextNode {
  text: string;
}

interface LabelVisibleState {
  fullText: string;
  visibleCharacters: number;
}

const labelVisibleState = new WeakMap<TextNode, LabelVisibleState>();
const labelMaxLinesState = new WeakMap<object, { value: number; mask: Graphics | null; unregister: () => void }>();
const LABEL_CLIP_TEXT = new WeakMap<object, boolean>();
const LABEL_TEXT_OVERRUN = new WeakMap<object, number>();
const LABEL_OVERRUN_RESIZE_BOUND = new WeakSet<object>();

function syncLabelMaxLines(label: TextNode): void {
  const state = labelMaxLinesState.get(label);
  if (state === undefined) return;
  const binding = optionalControlBinding(label);
  binding?.state.write(binding.id, { labelMaxLinesVisible: state.value });
  if (!(label instanceof Text)) return;
  const clipText = LABEL_CLIP_TEXT.get(label) ?? false;
  if (state.value < 0 && !clipText) {
    if (label.mask === state.mask) label.mask = null;
    state.mask?.removeFromParent();
    state.mask?.destroy();
    state.mask = null;
    return;
  }
  const bounds = label.getLocalBounds();
  const authoredLineHeight = label.style.lineHeight;
  const fontSize = typeof label.style.fontSize === 'number' ? label.style.fontSize : Number(label.style.fontSize);
  const lineHeight = typeof authoredLineHeight === 'number' && authoredLineHeight > 0
    ? authoredLineHeight
    : Math.max(0, Number.isFinite(fontSize) ? fontSize * 1.2 : bounds.height);
  const mask = state.mask ?? markInternalCanvasChild(new Graphics());
  if (state.mask === null) label.addChild(mask);
  const controlSize = binding?.state.read(binding.id).size ?? binding?.state.authored(binding.id)?.size;
  const width = clipText && controlSize !== undefined ? controlSize.x : bounds.width;
  const lineLimit = state.value < 0 ? Number.POSITIVE_INFINITY : lineHeight * state.value;
  const height = clipText && controlSize !== undefined
    ? Math.min(controlSize.y, lineLimit)
    : lineLimit;
  mask.clear().rect(bounds.x, bounds.y, Math.max(0, width), Math.max(0, height)).fill(0xffffff);
  label.mask = mask;
  state.mask = mask;
}

function visibleLabelText(text: string, count: number): string {
  return count < 0 ? text : [...text].slice(0, count).join('');
}

function labelLineWidth(label: Text, value: string): number {
  return CanvasTextMetrics.measureText(value, label.style).width;
}

function trimLabelLine(label: Text, line: string, width: number, behavior: number): string {
  const word = behavior === 2 || behavior === 4 || behavior === 6;
  const ellipsis = behavior >= 3;
  const force = behavior === 5 || behavior === 6;
  if (!force && labelLineWidth(label, line) <= width) return line;
  const suffix = ellipsis ? '…' : '';
  if (suffix !== '' && labelLineWidth(label, suffix) > width) return '';
  const characters = [...line];
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (labelLineWidth(label, characters.slice(0, middle).join('') + suffix) <= width) low = middle;
    else high = middle - 1;
  }
  let body = characters.slice(0, low).join('');
  if (word && low < characters.length) {
    const boundary = body.search(/\s+\S*$/u);
    body = boundary >= 0 ? body.slice(0, boundary) : '';
    body = body.trimEnd();
  }
  return body + suffix;
}

function applyLabelTextOverrun(label: Text, value: string): string {
  const behavior = LABEL_TEXT_OVERRUN.get(label) ?? 0;
  if (behavior === 0 || (LABEL_AUTOWRAP_MODE.get(label) ?? 0) !== 0) return value;
  const binding = optionalControlBinding(label);
  const size = binding?.state.read(binding.id).size ?? binding?.state.authored(binding.id)?.size;
  if (size === undefined) return value;
  return value.split('\n').map((line) => trimLabelLine(label, line, Math.max(0, size.x), behavior)).join('\n');
}

/** `label.text` — `HUD.gd:7`, `:15`, `:22`. Pixi's `Text.text` is the same
 *  property under the same name; this exists so an emitter has one spelling for
 *  every Godot property read (see this module's header). */
export function getText(label: TextNode): string {
  return labelVisibleState.get(label)?.fullText ?? label.text;
}

/** `label.text = "…"`. */
export function setText(label: TextNode, value: string): void {
  if (typeof value !== 'string') throw new TypeError('Godot Label.text requires a String.');
  const state = retainedLabelVisibleState(label);
  state.fullText = value;
  syncLabelVisibleText(label);
}

const LABEL_VERTICAL_ALIGNMENT = new WeakMap<object, number>();
const LABEL_AUTOWRAP_MODE = new WeakMap<object, number>();
const LABEL_UPPERCASE = new WeakMap<object, boolean>();
const LABEL_LINES_SKIPPED = new WeakMap<object, number>();
const LABEL_TEXT_DIRECTION = new WeakMap<object, number>();
const LABEL_LANGUAGE = new WeakMap<object, string>();
const LABEL_STRUCTURED_TEXT_PARSER = new WeakMap<object, number>();
const LABEL_STRUCTURED_TEXT_OPTIONS = new WeakMap<object, readonly unknown[]>();
const LABEL_JUSTIFICATION_FLAGS = new WeakMap<object, number>();
const LABEL_TAB_STOPS = new WeakMap<object, readonly number[]>();
const LABEL_VISIBLE_BEHAVIOR = new WeakMap<object, number>();
const LABEL_MINIMUM_LINES = new WeakMap<object, number>();
interface RetainedLabelSettingsBinding {
  settings: GodotLabelSettings | null;
  readonly originalStyle: Text['style'];
  connection: GodotConnection | null;
  fontConnection: GodotConnection | null;
  font: object | null;
  unregister: () => void;
}
const LABEL_SETTINGS = new WeakMap<Text, RetainedLabelSettingsBinding>();

function retainedLabelVisibleState(label: TextNode): LabelVisibleState {
  let state = labelVisibleState.get(label);
  if (state === undefined) {
    state = { fullText: label.text, visibleCharacters: -1 };
    labelVisibleState.set(label, state);
  }
  return state;
}

function syncLabelVisibleText(label: TextNode): void {
  const state = retainedLabelVisibleState(label);
  let visible = visibleLabelText(state.fullText, state.visibleCharacters);
  if (LABEL_UPPERCASE.get(label) === true) visible = visible.toUpperCase();
  const skipped = LABEL_LINES_SKIPPED.get(label) ?? 0;
  if (skipped > 0 && label instanceof Text) {
    visible = CanvasTextMetrics.measureText(visible, label.style).lines.slice(skipped).join('\n');
  }
  if (label instanceof Text) visible = applyLabelTextOverrun(label, visible);
  label.text = visible;
  syncLabelMaxLines(label);
}

export function getLabelHorizontalAlignment(label: object): number {
  const align = (label as Text).style?.align;
  if (align !== undefined) return align === 'center' ? 1 : align === 'right' ? 2 : align === 'justify' ? 3 : 0;
  const binding = optionalControlBinding(label);
  if (binding !== undefined) {
    return binding.state.read(binding.id).labelHorizontalAlignment ??
      binding.state.authored(binding.id)?.labelHorizontalAlignment ?? 0;
  }
  throw new Error('Label alignment requires a retained DOM/Pixi text entity.');
}
export function setLabelHorizontalAlignment(label: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Label.horizontal_alignment must be in [0, 3].');
  const binding = optionalControlBinding(label);
  if (binding !== undefined) {
    const text = label as Text;
    if (text.style === undefined) {
      binding.state.write(binding.id, { labelHorizontalAlignment: value });
      return;
    }
  }
  const text = label as Text;
  if (text.style === undefined) throw new Error('Label alignment requires a retained DOM/Pixi text entity.');
  text.style.align = value === 1 ? 'center' : value === 2 ? 'right' : value === 3 ? 'justify' : 'left';
}

/** Godot 3 `align` is the same horizontal alignment enum retained by Godot 4 Label. */
export const getLabelAlign = getLabelHorizontalAlignment;
export const setLabelAlign = setLabelHorizontalAlignment;

/** Read the renderer's actual wrapped line partition rather than counting newline bytes. */
export function getLabelLineCount(label: object): number {
  if (label instanceof Text) return CanvasTextMetrics.measureText(getText(label), label.style).lines.length;
  throw new Error('Label.get_line_count requires retained native text layout metrics.');
}
export function getLabelVerticalAlignment(label: object): number { return LABEL_VERTICAL_ALIGNMENT.get(label) ?? 0; }
export function setLabelVerticalAlignment(label: Text, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Label.vertical_alignment must be in [0, 3].');
  LABEL_VERTICAL_ALIGNMENT.set(label, value);
  label.anchor.y = value === 1 ? 0.5 : value === 2 ? 1 : 0;
}
export function getLabelAutowrapMode(label: object): number { return LABEL_AUTOWRAP_MODE.get(label) ?? 0; }
export function setLabelAutowrapMode(label: Text, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Label.autowrap_mode must be in [0, 3].');
  LABEL_AUTOWRAP_MODE.set(label, value);
  label.style.wordWrap = value !== 0;
  syncLabelVisibleText(label);
}

export function getLabelTextOverrunBehavior(label: object): number {
  return LABEL_TEXT_OVERRUN.get(label) ?? 0;
}

export function setLabelTextOverrunBehavior(label: TextNode, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 6) {
    throw new RangeError('Label.text_overrun_behavior must be a TextServer.OverrunBehavior value in [0, 6].');
  }
  LABEL_TEXT_OVERRUN.set(label, value);
  const binding = optionalControlBinding(label);
  if (binding !== undefined && !LABEL_OVERRUN_RESIZE_BOUND.has(label)) {
    const prior = binding.state.read(binding.id).onControlResized;
    binding.state.write(binding.id, {
      onControlResized: () => {
        prior?.();
        syncLabelVisibleText(label);
      },
    });
    LABEL_OVERRUN_RESIZE_BOUND.add(label);
  }
  syncLabelVisibleText(label);
}

export function getLabelVisibleCharacters(label: TextNode): number {
  return labelVisibleState.get(label)?.visibleCharacters ?? -1;
}

export function setLabelVisibleCharacters(label: TextNode, value: number): void {
  if (!Number.isSafeInteger(value) || value < -1) {
    throw new RangeError(`Godot Label.visible_characters must be an integer >= -1; received ${String(value)}.`);
  }
  const state = retainedLabelVisibleState(label);
  state.visibleCharacters = value;
  syncLabelVisibleText(label);
}

export function getLabelVisibleRatio(label: TextNode): number {
  const total = Math.max(1, [...retainedLabelVisibleState(label).fullText].length);
  const visible = getLabelVisibleCharacters(label);
  return visible < 0 ? 1 : Math.max(0, Math.min(1, visible / total));
}

export function setLabelVisibleRatio(label: TextNode, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Label.visible_ratio must be in [0, 1].');
  const total = [...retainedLabelVisibleState(label).fullText].length;
  setLabelVisibleCharacters(label, value >= 1 ? -1 : Math.floor(total * value));
}

export function getLabelVisibleCharactersBehavior(label: object): number { return LABEL_VISIBLE_BEHAVIOR.get(label) ?? 0; }
export function setLabelVisibleCharactersBehavior(label: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 4) throw new RangeError('Label.visible_characters_behavior must be in [0, 4].');
  LABEL_VISIBLE_BEHAVIOR.set(label, value);
}

export function getLabelTextDirection(label: object): number { return LABEL_TEXT_DIRECTION.get(label) ?? 0; }
export function setLabelTextDirection(label: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new RangeError('Label.text_direction must be in [0, 3].');
  LABEL_TEXT_DIRECTION.set(label, value);
  const binding = optionalControlBinding(label); binding?.state.write(binding.id, { labelTextDirection: value });
}

export function getLabelLanguage(label: object): string { return LABEL_LANGUAGE.get(label) ?? '' }
export function setLabelLanguage(label: object, value: string): void {
  if (typeof value !== 'string') throw new TypeError('Label.language requires String.');
  LABEL_LANGUAGE.set(label, value);
  const binding = optionalControlBinding(label); binding?.state.write(binding.id, { labelLanguage: value });
}

export function getLabelStructuredTextBidiOverride(label: object): number { return LABEL_STRUCTURED_TEXT_PARSER.get(label) ?? 0; }
export function setLabelStructuredTextBidiOverride(label: object, value: number): void {
  if (!Number.isSafeInteger(value)) throw new TypeError('Label.structured_text_bidi_override requires int.');
  LABEL_STRUCTURED_TEXT_PARSER.set(label, value);
}

export function getLabelStructuredTextBidiOverrideOptions(label: object): readonly unknown[] { return [...(LABEL_STRUCTURED_TEXT_OPTIONS.get(label) ?? [])]; }
export function setLabelStructuredTextBidiOverrideOptions(label: object, value: readonly unknown[]): void {
  if (!Array.isArray(value)) throw new TypeError('Label.structured_text_bidi_override_options requires Array.');
  LABEL_STRUCTURED_TEXT_OPTIONS.set(label, [...value]);
}

export function getLabelJustificationFlags(label: object): number { return LABEL_JUSTIFICATION_FLAGS.get(label) ?? 163; }
export function setLabelJustificationFlags(label: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Label.justification_flags requires non-negative bitfield.');
  LABEL_JUSTIFICATION_FLAGS.set(label, value);
}

export function getLabelTabStops(label: object): readonly number[] { return [...(LABEL_TAB_STOPS.get(label) ?? [])]; }
export function setLabelTabStops(label: object, value: readonly number[]): void {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0)) throw new TypeError('Label.tab_stops requires a PackedFloat32Array of non-negative offsets.');
  LABEL_TAB_STOPS.set(label, [...value]);
}

export function getLabelMinimumLines(label: object): number { return LABEL_MINIMUM_LINES.get(label) ?? 1; }
export function setLabelMinimumLines(label: object, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Label.minimum_character_width/lines requires a positive integer.');
  LABEL_MINIMUM_LINES.set(label, value);
  const binding = optionalControlBinding(label); binding?.state.write(binding.id, { labelMinimumLines: value });
}

export function isLabelUppercase(label: object): boolean {
  return LABEL_UPPERCASE.get(label) ?? false;
}

export function setLabelUppercase(label: TextNode, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Label.uppercase requires bool.');
  LABEL_UPPERCASE.set(label, enabled);
  syncLabelVisibleText(label);
}

export function getLabelVisibleLineCount(label: object): number {
  if (!(label instanceof Text)) {
    throw new Error('Label.get_visible_line_count requires retained native text layout metrics.');
  }
  const measured = CanvasTextMetrics.measureText(label.text, label.style).lines.length;
  const maximum = getLabelMaxLinesVisible(label);
  return maximum < 0 ? measured : Math.min(measured, maximum);
}

export function getLabelLinesSkipped(label: object): number {
  return LABEL_LINES_SKIPPED.get(label) ?? 0;
}

export function setLabelLinesSkipped(label: TextNode, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('Label.lines_skipped requires a non-negative integer.');
  }
  LABEL_LINES_SKIPPED.set(label, value);
  syncLabelVisibleText(label);
}

export function isLabelClipTextEnabled(label: object): boolean {
  return LABEL_CLIP_TEXT.get(label) ?? false;
}

export function setLabelClipText(label: TextNode, enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('Label.clip_text requires bool.');
  LABEL_CLIP_TEXT.set(label, enabled);
  if (!labelMaxLinesState.has(label)) setLabelMaxLinesVisible(label, getLabelMaxLinesVisible(label));
  syncLabelMaxLines(label);
}

export function getLabelSettings(label: Text): GodotLabelSettings | null {
  return LABEL_SETTINGS.get(label)?.settings ?? null;
}

export function setLabelSettings(label: Text, settings: GodotLabelSettings | null): void {
  if (settings !== null && !isGodotLabelSettings(settings)) {
    throw new TypeError('Label.label_settings requires a LabelSettings Resource or null.');
  }
  let binding = LABEL_SETTINGS.get(label);
  if (binding?.settings === settings) return;
  if (binding === undefined) {
    binding = {
      settings: null,
      originalStyle: label.style,
      connection: null,
      fontConnection: null,
      font: null,
      unregister: () => {},
    };
    LABEL_SETTINGS.set(label, binding);
    binding.unregister = registerCanvasNodeRelease(label, () => {
      binding!.connection?.disconnect();
      binding!.fontConnection?.disconnect();
      LABEL_SETTINGS.delete(label);
    });
  }
  binding.connection?.disconnect();
  binding.settings = settings;
  const refresh = (): void => {
    if (binding!.settings === null) {
      label.style = binding!.originalStyle;
    } else {
      const align = label.style.align;
      const wordWrap = label.style.wordWrap;
      const wordWrapWidth = label.style.wordWrapWidth;
      label.style = createLabelTextStyle(binding!.settings);
      label.style.align = align;
      label.style.wordWrap = wordWrap;
      label.style.wordWrapWidth = wordWrapWidth;
    }
    syncLabelVisibleText(label);
  };
  const apply = (): void => {
    const font = binding!.settings?.font ?? null;
    if (binding!.font !== font) {
      binding!.fontConnection?.disconnect();
      binding!.font = font;
      binding!.fontConnection = font === null ? null : godotResourceChangedSignal(font).connect(refresh);
      if (font !== null) {
        void loadGodotFont(font).then(() => {
          if (LABEL_SETTINGS.get(label)?.settings?.font === font) refresh();
        });
      }
    }
    refresh();
  };
  binding.connection = settings === null ? null : godotResourceChangedSignal(settings).connect(apply);
  apply();
}

export function getLabelMaxLinesVisible(label: object): number {
  const retained = labelMaxLinesState.get(label)?.value;
  if (retained !== undefined) return retained;
  const binding = optionalControlBinding(label);
  return binding?.state.read(binding.id).labelMaxLinesVisible ??
    binding?.state.authored(binding.id)?.labelMaxLinesVisible ?? -1;
}

export function setLabelMaxLinesVisible(label: TextNode, value: number): void {
  if (!Number.isSafeInteger(value) || value < -1) {
    throw new RangeError('Label.max_lines_visible must be -1 or a non-negative integer.');
  }
  let state = labelMaxLinesState.get(label);
  if (state === undefined) {
    state = { value: -1, mask: null, unregister: () => {} };
    labelMaxLinesState.set(label, state);
    if (label instanceof Text) {
      state.unregister = registerCanvasNodeRelease(label, () => releaseLabelMaxLinesVisible(label));
    }
  }
  state.value = value;
  syncLabelMaxLines(label);
}

function releaseLabelMaxLinesVisible(label: TextNode): void {
  const state = labelMaxLinesState.get(label);
  if (state === undefined) return;
  state.unregister();
  if (label instanceof Text && label.mask === state.mask) label.mask = null;
  state.mask?.removeFromParent();
  state.mask?.destroy();
  labelMaxLinesState.delete(label);
}

/** Label character count follows Godot's Unicode code-point count over the untruncated text. */
export function getLabelTotalCharacterCount(label: TextNode): number {
  return [...getText(label)].length;
}

export type GodotCanvasLabel = Text & GodotCanvasItem & {
  horizontal_alignment: number;
  vertical_alignment: number;
  autowrap_mode: number;
  clip_text: boolean;
  text_overrun_behavior: number;
  visible_characters: number;
  visible_ratio: number;
  visible_characters_behavior: number;
  text_direction: number;
  language: string;
  structured_text_bidi_override: number;
  structured_text_bidi_override_options: readonly unknown[];
  justification_flags: number;
  tab_stops: readonly number[];
  uppercase: boolean;
  lines_skipped: number;
  max_lines_visible: number;
  label_settings: GodotLabelSettings | null;
  set_text(value: string): void;
  get_text(): string;
  set_horizontal_alignment(value: number): void;
  get_horizontal_alignment(): number;
  set_vertical_alignment(value: number): void;
  get_vertical_alignment(): number;
  set_autowrap_mode(value: number): void;
  get_autowrap_mode(): number;
  set_clip_text(value: boolean): void;
  is_clipping_text(): boolean;
  set_text_overrun_behavior(value: number): void;
  get_text_overrun_behavior(): number;
  set_visible_characters(value: number): void;
  get_visible_characters(): number;
  set_visible_ratio(value: number): void;
  get_visible_ratio(): number;
  set_visible_characters_behavior(value: number): void;
  get_visible_characters_behavior(): number;
  set_text_direction(value: number): void;
  get_text_direction(): number;
  set_language(value: string): void;
  get_language(): string;
  set_structured_text_bidi_override(value: number): void;
  get_structured_text_bidi_override(): number;
  set_structured_text_bidi_override_options(value: readonly unknown[]): void;
  get_structured_text_bidi_override_options(): readonly unknown[];
  set_justification_flags(value: number): void;
  get_justification_flags(): number;
  set_tab_stops(value: readonly number[]): void;
  get_tab_stops(): readonly number[];
  set_uppercase(value: boolean): void;
  is_uppercase(): boolean;
  set_lines_skipped(value: number): void;
  get_lines_skipped(): number;
  set_max_lines_visible(value: number): void;
  get_max_lines_visible(): number;
  set_label_settings(value: GodotLabelSettings | null): void;
  get_label_settings(): GodotLabelSettings | null;
  get_line_count(): number;
  get_visible_line_count(): number;
  get_total_character_count(): number;
};

function bindGodotCanvasLabelApi(source: Text): GodotCanvasLabel {
  const label = source as GodotCanvasLabel;
  Object.defineProperties(label, {
    horizontal_alignment: { configurable: true, enumerable: true, get: () => getLabelHorizontalAlignment(label), set: (value: number) => setLabelHorizontalAlignment(label, value) },
    vertical_alignment: { configurable: true, enumerable: true, get: () => getLabelVerticalAlignment(label), set: (value: number) => setLabelVerticalAlignment(label, value) },
    autowrap_mode: { configurable: true, enumerable: true, get: () => getLabelAutowrapMode(label), set: (value: number) => setLabelAutowrapMode(label, value) },
    clip_text: { configurable: true, enumerable: true, get: () => isLabelClipTextEnabled(label), set: (value: boolean) => setLabelClipText(label, value) },
    text_overrun_behavior: { configurable: true, enumerable: true, get: () => getLabelTextOverrunBehavior(label), set: (value: number) => setLabelTextOverrunBehavior(label, value) },
    visible_characters: { configurable: true, enumerable: true, get: () => getLabelVisibleCharacters(label), set: (value: number) => setLabelVisibleCharacters(label, value) },
    visible_ratio: { configurable: true, enumerable: true, get: () => getLabelVisibleRatio(label), set: (value: number) => setLabelVisibleRatio(label, value) },
    visible_characters_behavior: { configurable: true, enumerable: true, get: () => getLabelVisibleCharactersBehavior(label), set: (value: number) => setLabelVisibleCharactersBehavior(label, value) },
    text_direction: { configurable: true, enumerable: true, get: () => getLabelTextDirection(label), set: (value: number) => setLabelTextDirection(label, value) },
    language: { configurable: true, enumerable: true, get: () => getLabelLanguage(label), set: (value: string) => setLabelLanguage(label, value) },
    structured_text_bidi_override: { configurable: true, enumerable: true, get: () => getLabelStructuredTextBidiOverride(label), set: (value: number) => setLabelStructuredTextBidiOverride(label, value) },
    structured_text_bidi_override_options: { configurable: true, enumerable: true, get: () => getLabelStructuredTextBidiOverrideOptions(label), set: (value: readonly unknown[]) => setLabelStructuredTextBidiOverrideOptions(label, value) },
    justification_flags: { configurable: true, enumerable: true, get: () => getLabelJustificationFlags(label), set: (value: number) => setLabelJustificationFlags(label, value) },
    tab_stops: { configurable: true, enumerable: true, get: () => getLabelTabStops(label), set: (value: readonly number[]) => setLabelTabStops(label, value) },
    uppercase: { configurable: true, enumerable: true, get: () => isLabelUppercase(label), set: (value: boolean) => setLabelUppercase(label, value) },
    lines_skipped: { configurable: true, enumerable: true, get: () => getLabelLinesSkipped(label), set: (value: number) => setLabelLinesSkipped(label, value) },
    max_lines_visible: { configurable: true, enumerable: true, get: () => getLabelMaxLinesVisible(label), set: (value: number) => setLabelMaxLinesVisible(label, value) },
    label_settings: { configurable: true, enumerable: true, get: () => getLabelSettings(label), set: (value: GodotLabelSettings | null) => setLabelSettings(label, value) },
  });
  Object.assign(label, {
    set_text: (value: string): void => setText(label, value),
    get_text: (): string => getText(label),
    set_horizontal_alignment: (value: number): void => setLabelHorizontalAlignment(label, value),
    get_horizontal_alignment: (): number => getLabelHorizontalAlignment(label),
    set_vertical_alignment: (value: number): void => setLabelVerticalAlignment(label, value),
    get_vertical_alignment: (): number => getLabelVerticalAlignment(label),
    set_autowrap_mode: (value: number): void => setLabelAutowrapMode(label, value),
    get_autowrap_mode: (): number => getLabelAutowrapMode(label),
    set_clip_text: (value: boolean): void => setLabelClipText(label, value),
    is_clipping_text: (): boolean => isLabelClipTextEnabled(label),
    set_text_overrun_behavior: (value: number): void => setLabelTextOverrunBehavior(label, value),
    get_text_overrun_behavior: (): number => getLabelTextOverrunBehavior(label),
    set_visible_characters: (value: number): void => setLabelVisibleCharacters(label, value),
    get_visible_characters: (): number => getLabelVisibleCharacters(label),
    set_visible_ratio: (value: number): void => setLabelVisibleRatio(label, value),
    get_visible_ratio: (): number => getLabelVisibleRatio(label),
    set_visible_characters_behavior: (value: number): void => setLabelVisibleCharactersBehavior(label, value),
    get_visible_characters_behavior: (): number => getLabelVisibleCharactersBehavior(label),
    set_text_direction: (value: number): void => setLabelTextDirection(label, value),
    get_text_direction: (): number => getLabelTextDirection(label),
    set_language: (value: string): void => setLabelLanguage(label, value),
    get_language: (): string => getLabelLanguage(label),
    set_structured_text_bidi_override: (value: number): void => setLabelStructuredTextBidiOverride(label, value),
    get_structured_text_bidi_override: (): number => getLabelStructuredTextBidiOverride(label),
    set_structured_text_bidi_override_options: (value: readonly unknown[]): void => setLabelStructuredTextBidiOverrideOptions(label, value),
    get_structured_text_bidi_override_options: (): readonly unknown[] => getLabelStructuredTextBidiOverrideOptions(label),
    set_justification_flags: (value: number): void => setLabelJustificationFlags(label, value),
    get_justification_flags: (): number => getLabelJustificationFlags(label),
    set_tab_stops: (value: readonly number[]): void => setLabelTabStops(label, value),
    get_tab_stops: (): readonly number[] => getLabelTabStops(label),
    set_uppercase: (value: boolean): void => setLabelUppercase(label, value),
    is_uppercase: (): boolean => isLabelUppercase(label),
    set_lines_skipped: (value: number): void => setLabelLinesSkipped(label, value),
    get_lines_skipped: (): number => getLabelLinesSkipped(label),
    set_max_lines_visible: (value: number): void => setLabelMaxLinesVisible(label, value),
    get_max_lines_visible: (): number => getLabelMaxLinesVisible(label),
    set_label_settings: (value: GodotLabelSettings | null): void => setLabelSettings(label, value),
    get_label_settings: (): GodotLabelSettings | null => getLabelSettings(label),
    get_line_count: (): number => getLabelLineCount(label),
    get_visible_line_count: (): number => getLabelVisibleLineCount(label),
    get_total_character_count: (): number => getLabelTotalCharacterCount(label),
  });
  return label;
}

export function bindRuntimeCanvasControl<T extends Container>(
  node: T,
  options: {
    readonly nativeSize?: boolean;
    readonly useLocalBoundsMinimum?: boolean;
    readonly containerLayout?: CanvasControlInitialState['containerLayout'];
    readonly applySize?: (size: PointData) => void;
  } = {},
): T {
  bindCanvasControl(node, {
    position: { x: 0, y: 0 },
    size: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    customMinimumSize: { x: 0, y: 0 },
    sizeFlagsHorizontal: 1,
    sizeFlagsVertical: 1,
    mouseFilter: 0,
    nativeSize: options.nativeSize ?? false,
    ...(options.containerLayout === undefined ? {} : { containerLayout: options.containerLayout }),
    ...(options.useLocalBoundsMinimum === undefined
      ? {}
      : { useLocalBoundsMinimum: options.useLocalBoundsMinimum }),
    ...(options.applySize === undefined ? {} : { applySize: options.applySize }),
  });
  bindGodotCanvasItemApi(node);
  bindGodotCanvasControlThemeApi(node);
  bindGodotCanvasControlInteractionApi(node);
  bindGodotCanvasControlDragApi(node);
  bindGodotCanvasControlAccessibilityApi(node);
  bindGodotCanvasControlPolicyApi(node);
  bindGodotCanvasControlTransformApi(node);
  return bindGodotCanvasControlSignalApi(node);
}

export type GodotCanvasItem = Container & {
  visibility_layer: number;
  show_behind_parent: boolean;
  clip_children: number;
  use_parent_material: boolean;
  light_mask: number;
  notify_local_transform: boolean;
  notify_transform: boolean;
  modulate: ColorValue;
  self_modulate: ColorValue;
  set_visibility_layer(value: number): void;
  get_visibility_layer(): number;
  set_visibility_layer_bit(layer: number, enabled: boolean): void;
  get_visibility_layer_bit(layer: number): boolean;
  set_show_behind_parent(enabled: boolean): void;
  is_showing_behind_parent(): boolean;
  set_clip_children_mode(mode: number): void;
  get_clip_children_mode(): number;
  set_use_parent_material(enabled: boolean): void;
  is_using_parent_material(): boolean;
  set_light_mask(mask: number): void;
  get_light_mask(): number;
  set_notify_local_transform(enabled: boolean): void;
  is_local_transform_notification_enabled(): boolean;
  set_notify_transform(enabled: boolean): void;
  is_transform_notification_enabled(): boolean;
  set_visibility_parent(parent: Container | null): void;
  get_visibility_parent(): Container | null;
  set_modulate(color: ColorValue): void;
  get_modulate(): ColorValue;
  set_self_modulate(color: ColorValue): void;
  get_self_modulate(): ColorValue;
  get_transform(): GodotTransform2D;
  get_global_transform(): GodotTransform2D;
  get_screen_transform(): GodotTransform2D;
  get_viewport_transform(): GodotTransform2D;
  get_rect(): Rect2;
  make_canvas_position_local(position: PointData): PointData;
  make_canvas_position_global(position: PointData): PointData;
  move_to_front(): void;
  force_update_transform(): void;
  set_visible(value: boolean): void;
  show(): void;
  hide(): void;
  is_visible(): boolean;
};

/** Install CanvasItem state and methods directly on any retained Pixi display entity. */
export function bindGodotCanvasItemApi<T extends Container>(source: T): T & GodotCanvasItem {
  const node = source as T & GodotCanvasItem;
  installCanvasItemModulate(node);
  Object.defineProperties(node, {
    visibility_layer: { configurable: true, enumerable: true, get: () => getCanvasItemVisibilityLayer(node), set: (value: number) => setCanvasItemVisibilityLayer(node, value) },
    show_behind_parent: { configurable: true, enumerable: true, get: () => isCanvasItemShowingBehindParent(node), set: (value: boolean) => setCanvasItemShowBehindParent(node, value) },
    clip_children: { configurable: true, enumerable: true, get: () => getCanvasItemClipChildrenMode(node), set: (value: number) => setCanvasItemClipChildrenMode(node, value) },
    use_parent_material: { configurable: true, enumerable: true, get: () => isCanvasItemUsingParentMaterial(node), set: (value: boolean) => setCanvasItemUseParentMaterial(node, value) },
    light_mask: { configurable: true, enumerable: true, get: () => getCanvasItemLightMask(node), set: (value: number) => setCanvasItemLightMask(node, value) },
    notify_local_transform: { configurable: true, enumerable: true, get: () => isCanvasItemLocalTransformNotificationEnabled(node), set: (value: boolean) => setCanvasItemNotifyLocalTransform(node, value) },
    notify_transform: { configurable: true, enumerable: true, get: () => isCanvasItemTransformNotificationEnabled(node), set: (value: boolean) => setCanvasItemNotifyTransform(node, value) },
    self_modulate: { configurable: true, enumerable: true, get: () => getSelfModulate(node), set: (value: ColorValue) => setSelfModulate(node, value) },
  });
  Object.assign(node, {
    set_visibility_layer: (value: number): void => setCanvasItemVisibilityLayer(node, value),
    get_visibility_layer: (): number => getCanvasItemVisibilityLayer(node),
    set_visibility_layer_bit: (layer: number, enabled: boolean): void => setCanvasItemVisibilityLayerBit(node, layer, enabled),
    get_visibility_layer_bit: (layer: number): boolean => getCanvasItemVisibilityLayerBit(node, layer),
    set_show_behind_parent: (enabled: boolean): void => setCanvasItemShowBehindParent(node, enabled),
    is_showing_behind_parent: (): boolean => isCanvasItemShowingBehindParent(node),
    set_clip_children_mode: (mode: number): void => setCanvasItemClipChildrenMode(node, mode),
    get_clip_children_mode: (): number => getCanvasItemClipChildrenMode(node),
    set_use_parent_material: (enabled: boolean): void => setCanvasItemUseParentMaterial(node, enabled),
    is_using_parent_material: (): boolean => isCanvasItemUsingParentMaterial(node),
    set_light_mask: (mask: number): void => setCanvasItemLightMask(node, mask),
    get_light_mask: (): number => getCanvasItemLightMask(node),
    set_notify_local_transform: (enabled: boolean): void => setCanvasItemNotifyLocalTransform(node, enabled),
    is_local_transform_notification_enabled: (): boolean => isCanvasItemLocalTransformNotificationEnabled(node),
    set_notify_transform: (enabled: boolean): void => setCanvasItemNotifyTransform(node, enabled),
    is_transform_notification_enabled: (): boolean => isCanvasItemTransformNotificationEnabled(node),
    set_visibility_parent: (parent: Container | null): void => setCanvasItemVisibilityParent(node, parent),
    get_visibility_parent: (): Container | null => getCanvasItemVisibilityParent(node),
    set_modulate: (value: ColorValue): void => setModulate(node, value),
    get_modulate: (): ColorValue => getModulate(node),
    set_self_modulate: (value: ColorValue): void => setSelfModulate(node, value),
    get_self_modulate: (): ColorValue => getSelfModulate(node),
    get_transform: (): GodotTransform2D => getRuntimeCanvasItemTransform(node),
    get_global_transform: (): GodotTransform2D => getRuntimeCanvasItemGlobalTransform(node),
    get_screen_transform: (): GodotTransform2D => getRuntimeCanvasItemScreenTransform(node),
    get_viewport_transform: (): GodotTransform2D => getRuntimeCanvasItemViewportTransform(node),
    get_rect: (): Rect2 => {
      const value = getCanvasItemRect(node);
      return rect2(value.position.x, value.position.y, value.size.x, value.size.y);
    },
    make_canvas_position_local: (value: PointData): PointData => makeCanvasPositionLocal(node, value),
    make_canvas_position_global: (value: PointData): PointData => makeCanvasPositionGlobal(node, value),
    move_to_front: (): void => moveCanvasItemToFront(node),
    force_update_transform: (): void => forceUpdateCanvasItemTransform(node),
    set_visible: (value: boolean): void => setVisible(node, value),
    show: (): void => show(node),
    hide: (): void => hide(node),
    is_visible: (): boolean => isVisible(node),
  });
  return node;
}

function createCanvasContainerIdentity(godotClass: string): Container {
  const node = new Container();
  registerGodotObjectIdentity(node, godotClass);
  return node;
}

export type GodotCanvasNode2D = GodotCanvasItem & {
  rotation_degrees: number;
  global_position: Vector2;
  global_rotation: number;
  global_rotation_degrees: number;
  global_scale: Vector2;
  global_transform: GodotTransform2D;
  transform: GodotTransform2D;
  skew_degrees: number;
  z_index: number;
  z_as_relative: boolean;
  y_sort_enabled: boolean;
  top_level: boolean;
  rotate(radians: number): void;
  translate(offset: PointData): void;
  apply_scale(ratio: PointData): void;
  move_local_x(delta: number, scaled?: boolean): void;
  move_local_y(delta: number, scaled?: boolean): void;
  get_angle_to(target: PointData): number;
  look_at(target: PointData): void;
  to_local(point: PointData): Vector2;
  to_global(point: PointData): Vector2;
  get_position(): Vector2;
  set_position(value: PointData): void;
  get_rotation(): number;
  set_rotation(value: number): void;
  get_rotation_degrees(): number;
  set_rotation_degrees(value: number): void;
  get_scale(): Vector2;
  set_scale(value: PointData): void;
  get_skew(): number;
  set_skew(value: number): void;
  get_global_position(): Vector2;
  set_global_position(value: PointData): void;
  get_global_rotation(): number;
  set_global_rotation(value: number): void;
  get_global_rotation_degrees(): number;
  set_global_rotation_degrees(value: number): void;
  get_global_scale(): Vector2;
  set_global_scale(value: PointData): void;
  get_transform(): GodotTransform2D;
  set_transform(value: GodotTransform2D): void;
  get_global_transform(): GodotTransform2D;
  set_global_transform(value: GodotTransform2D): void;
  get_relative_transform_to_parent(parent: Container): GodotTransform2D;
  set_z_index(value: number): void;
  get_z_index(): number;
  set_z_as_relative(value: boolean): void;
  is_z_relative(): boolean;
  set_y_sort_enabled(value: boolean): void;
  is_y_sort_enabled(): boolean;
  set_as_top_level(value: boolean): void;
  is_set_as_top_level(): boolean;
  hide(): void;
  show(): void;
  set_visible(value: boolean): void;
  is_visible(): boolean;
  is_visible_in_tree(): boolean;
};

export function bindGodotCanvasNode2DApi<T extends Container>(source: T): T & GodotCanvasNode2D {
  const node = bindGodotCanvasItemApi(source) as unknown as T & GodotCanvasNode2D;
  Object.defineProperties(node, {
    rotation_degrees: { configurable: true, enumerable: true, get: () => getRotationDegrees(node), set: (value: number) => setRotationDegrees(node, value) },
    global_position: { configurable: true, enumerable: true, get: () => getGlobalPositionNode2D(node), set: (value: PointData) => setGlobalPositionNode2D(node, value) },
    global_rotation: { configurable: true, enumerable: true, get: () => getGlobalRotationNode2D(node), set: (value: number) => setGlobalRotationNode2D(node, value) },
    global_rotation_degrees: { configurable: true, enumerable: true, get: () => getGlobalRotationDegreesNode2D(node), set: (value: number) => setGlobalRotationDegreesNode2D(node, value) },
    global_scale: { configurable: true, enumerable: true, get: () => getGlobalScaleNode2D(node), set: (value: PointData) => setGlobalScaleNode2D(node, value) },
    global_transform: { configurable: true, enumerable: true, get: () => getNode2DGlobalTransform(node), set: (value: GodotTransform2D) => setNode2DGlobalTransform(node, value) },
    transform: { configurable: true, enumerable: true, get: () => getNode2DTransform(node), set: (value: GodotTransform2D) => setNode2DTransform(node, value) },
    skew_degrees: { configurable: true, enumerable: true, get: () => getSkewDegreesNode2D(node), set: (value: number) => setSkewDegreesNode2D(node, value) },
    z_index: { configurable: true, enumerable: true, get: () => getZIndex(node), set: (value: number) => setZIndex(node, value) },
    z_as_relative: { configurable: true, enumerable: true, get: () => getZAsRelative(node), set: (value: boolean) => setZAsRelative(node, value) },
    y_sort_enabled: { configurable: true, enumerable: true, get: () => isCanvasYSortEnabled(node), set: (value: boolean) => setCanvasYSortEnabled(node, value) },
    top_level: { configurable: true, enumerable: true, get: () => isCanvasItemSetAsTopLevel(node), set: (value: boolean) => setCanvasItemAsTopLevel(node, value) },
  });
  Object.assign(node, {
    rotate: (value: number): void => rotateNode2D(node, value),
    translate: (value: PointData): void => translateNode2D(node, value),
    apply_scale: (value: PointData): void => applyScaleNode2D(node, value),
    move_local_x: (value: number, scaled = false): void => moveLocalXNode2D(node, value, scaled),
    move_local_y: (value: number, scaled = false): void => moveLocalYNode2D(node, value, scaled),
    get_angle_to: (value: PointData): number => getAngleToNode2D(node, value),
    look_at: (value: PointData): void => lookAtNode2D(node, value),
    to_local: (value: PointData): Vector2 => toLocalNode2D(node, value),
    to_global: (value: PointData): Vector2 => toGlobalNode2D(node, value),
    get_position: (): Vector2 => getPosition(node),
    set_position: (value: PointData): void => setPosition(node, value),
    get_rotation: (): number => getRotation(node),
    set_rotation: (value: number): void => setRotation(node, value),
    get_rotation_degrees: (): number => getRotationDegrees(node),
    set_rotation_degrees: (value: number): void => setRotationDegrees(node, value),
    get_scale: (): Vector2 => getScale(node),
    set_scale: (value: PointData): void => setScale(node, value),
    get_skew: (): number => getSkewNode2D(node),
    set_skew: (value: number): void => setSkewNode2D(node, value),
    get_global_position: (): Vector2 => getGlobalPositionNode2D(node),
    set_global_position: (value: PointData): void => setGlobalPositionNode2D(node, value),
    get_global_rotation: (): number => getGlobalRotationNode2D(node),
    set_global_rotation: (value: number): void => setGlobalRotationNode2D(node, value),
    get_global_rotation_degrees: (): number => getGlobalRotationDegreesNode2D(node),
    set_global_rotation_degrees: (value: number): void => setGlobalRotationDegreesNode2D(node, value),
    get_global_scale: (): Vector2 => getGlobalScaleNode2D(node),
    set_global_scale: (value: PointData): void => setGlobalScaleNode2D(node, value),
    get_transform: (): GodotTransform2D => getNode2DTransform(node),
    set_transform: (value: GodotTransform2D): void => setNode2DTransform(node, value),
    get_global_transform: (): GodotTransform2D => getNode2DGlobalTransform(node),
    set_global_transform: (value: GodotTransform2D): void => setNode2DGlobalTransform(node, value),
    get_relative_transform_to_parent: (parent: Container): GodotTransform2D => getRelativeTransformToParentNode2D(node, parent),
    set_z_index: (value: number): void => setZIndex(node, value),
    get_z_index: (): number => getZIndex(node),
    set_z_as_relative: (value: boolean): void => setZAsRelative(node, value),
    is_z_relative: (): boolean => getZAsRelative(node),
    set_y_sort_enabled: (value: boolean): void => setCanvasYSortEnabled(node, value),
    is_y_sort_enabled: (): boolean => isCanvasYSortEnabled(node),
    set_as_top_level: (value: boolean): void => setCanvasItemAsTopLevel(node, value),
    is_set_as_top_level: (): boolean => isCanvasItemSetAsTopLevel(node),
    hide: (): void => hide(node),
    show: (): void => show(node),
    is_visible_in_tree: (): boolean => isCanvasItemVisibleInTree(node),
  });
  return node;
}

/** Runtime `Node.new()`; an identity-transform Pixi Container is the retained tree entity. */
export function createGodotCanvasNode(): Container {
  return createCanvasContainerIdentity('Node');
}

/** Runtime abstract CanvasItem.new() identity for scripts that instantiate the canvas base class. */
export function createGodotCanvasItem(): GodotCanvasItem {
  return bindGodotCanvasItemApi(createCanvasContainerIdentity('CanvasItem'));
}

/** Runtime Godot 3 `Node2D.new()` / Godot 4 `Node2D.new()`. */
export function createGodotCanvasNode2D(): GodotCanvasNode2D {
  return bindGodotCanvasNode2DApi(createCanvasContainerIdentity('Node2D'));
}

/** Runtime `Position2D.new()` / `Marker2D.new()`; both are invisible Node2D markers. */
export function createGodotCanvasMarker2D(major: 3 | 4): Container {
  return bindGodotCanvasNode2DApi(createCanvasContainerIdentity(major === 3 ? 'Position2D' : 'Marker2D'));
}

/** Runtime Godot 3 YSort node. Godot 4 folds the same behavior into Node2D.y_sort_enabled. */
export function createGodotCanvasYSort(): GodotCanvasNode2D {
  const node = bindGodotCanvasNode2DApi(createCanvasContainerIdentity('YSort'));
  setCanvasYSortEnabled(node, true);
  return node;
}

/** Runtime base `Control.new()` with the shared retained layout/input state. */
export function createGodotCanvasControl(): Container {
  const control = bindRuntimeCanvasControl(new Container());
  registerGodotObjectIdentity(control, 'Control');
  return control;
}

/** Runtime base `Container.new()`; layout remains inert until a concrete container owns a solver. */
export function createGodotCanvasContainer(): Container {
  const container = bindGodotCanvasContainerApi(bindRuntimeCanvasControl(new Container()));
  registerGodotObjectIdentity(container, 'Container');
  return container;
}

function createGodotCanvasNamedContainer(
  godotClass: 'MarginContainer' | 'CenterContainer' | 'GridContainer',
  containerLayout?: 'grid',
): Container {
  const container = bindGodotCanvasContainerApi(bindRuntimeCanvasControl(new Container(), {
    ...(containerLayout === undefined ? {} : { containerLayout }),
  }));
  registerGodotObjectIdentity(container, godotClass);
  return container;
}

/** Runtime layout containers keep one native Pixi Container as the Godot node identity. */
export function createGodotCanvasMarginContainer(): Container {
  return createGodotCanvasNamedContainer('MarginContainer');
}

export type GodotCanvasCenterContainer = Container & {
  use_top_left: boolean;
  set_use_top_left(enabled: boolean): void;
  is_using_top_left(): boolean;
  sort_children(): void;
};

export function createGodotCanvasCenterContainer(): GodotCanvasCenterContainer {
  const center = createGodotCanvasNamedContainer('CenterContainer') as GodotCanvasCenterContainer;
  let useTopLeft = false;
  const layout = (): void => {
    const size = getCanvasControlSize(center);
    for (const child of center.children) {
      if (!(child instanceof Container)) continue;
      const childSize = (() => { try { return getCanvasControlSize(child); } catch { return { x: child.width, y: child.height }; } })();
      child.position.set(
        useTopLeft ? Math.max(0, (size.x - childSize.x) / 2) : (size.x - childSize.x) / 2,
        useTopLeft ? Math.max(0, (size.y - childSize.y) / 2) : (size.y - childSize.y) / 2,
      );
    }
  };
  Object.defineProperty(center, 'use_top_left', {
    enumerable: true,
    configurable: true,
    get: () => useTopLeft,
    set: (value: boolean) => {
      if (typeof value !== 'boolean') throw new TypeError('CenterContainer.use_top_left requires bool.');
      useTopLeft = value;
      layout();
    },
  });
  center.set_use_top_left = (value): void => { center.use_top_left = value; };
  center.is_using_top_left = (): boolean => useTopLeft;
  center.sort_children = layout;
  return center;
}

export function createGodotCanvasGridContainer(): GodotCanvasGridContainer {
  const grid = bindCanvasGridContainer(bindRuntimeCanvasControl(new Container()), {
    columns: 1,
    horizontalSeparation: 4,
    verticalSeparation: 4,
  });
  bindGodotCanvasContainerApi(grid);
  registerGodotObjectIdentity(grid, 'GridContainer');
  return grid;
}

/** Runtime separator constructors use the same retained Graphics carrier as authored separators. */
export function createGodotCanvasSeparator(
  godotClass: 'HSeparator' | 'VSeparator',
): Graphics {
  const graphics = new Graphics();
  const separator = bindRuntimeCanvasControl(graphics, {
    applySize: () => redrawCanvasPanelTheme(graphics),
  });
  registerGodotObjectIdentity(separator, godotClass);
  bindCanvasPanelTheme({ owner: graphics, graphics, themeType: godotClass, styleName: 'separator' });
  return separator;
}

/** Runtime Panel is a retained Pixi Graphics Control, ready for Theme/StyleBox drawing. */
export function createGodotCanvasPanel(): Graphics {
  const panel = new Graphics();
  bindRuntimeCanvasControl(panel, {
    applySize: () => redrawCanvasPanelTheme(panel),
  });
  registerGodotObjectIdentity(panel, 'Panel');
  bindCanvasPanelTheme({ owner: panel, graphics: panel, themeType: 'Panel' });
  return panel;
}

/** Runtime `Label.new()` on the canvas surface: the retained Pixi Text is the node identity. */
export function createGodotCanvasLabel(): GodotCanvasLabel {
  const label = bindGodotCanvasLabelApi(
    bindRuntimeCanvasControl(new Text({ text: '' }), { useLocalBoundsMinimum: true }),
  );
  registerGodotObjectIdentity(label, 'Label');
  return label;
}

/** Runtime `Button.new()` over the existing retained Pixi button/input implementation. */
export function createGodotCanvasButton(): GodotCanvasBaseButton {
  const button = bindCanvasBaseButton(
    bindRuntimeCanvasControl(new Text({ text: '' }), { useLocalBoundsMinimum: true }),
  );
  registerGodotObjectIdentity(button, 'Button');
  return button;
}

/** Godot 3 ToolButton is the same retained native button protocol with its exact class identity. */
export function createGodotCanvasToolButton(): GodotCanvasBaseButton {
  const button = bindCanvasToolButton(
    bindRuntimeCanvasControl(new Text({ text: '' }), { useLocalBoundsMinimum: true }),
  );
  registerGodotObjectIdentity(button, 'ToolButton');
  return button;
}

function createCanvasCheckControl(
  godotClass: 'CheckBox' | 'CheckButton',
  presentation: 'check-box' | 'check-button',
): GodotCanvasBaseButton {
  const button = bindCanvasBaseButton(
    bindRuntimeCanvasControl(new Text({ text: '' }), { useLocalBoundsMinimum: true }),
    { toggleMode: true, presentation },
  );
  registerGodotObjectIdentity(button, godotClass);
  return button;
}

/** Runtime `CheckBox.new()` retaining the native Pixi button and toggle signals. */
export function createGodotCanvasCheckBox(): GodotCanvasBaseButton {
  return createCanvasCheckControl('CheckBox', 'check-box');
}

/** Runtime `CheckButton.new()` retaining the native Pixi button and toggle signals. */
export function createGodotCanvasCheckButton(): GodotCanvasBaseButton {
  return createCanvasCheckControl('CheckButton', 'check-button');
}

/** Runtime `VBoxContainer.new()` using the same BoxContainer solver as authored controls. */
export function createGodotCanvasVBoxContainer(): Container {
  const container = bindCanvasBoxContainer(
    bindRuntimeCanvasControl(new Container(), { containerLayout: 'vertical' }),
    { vertical: true, separation: 4 },
  );
  bindGodotCanvasContainerApi(container);
  registerGodotObjectIdentity(container, 'VBoxContainer');
  return container;
}

/** Runtime `HBoxContainer.new()` using the shared BoxContainer solver. */
export function createGodotCanvasHBoxContainer(): Container {
  const container = bindCanvasBoxContainer(
    bindRuntimeCanvasControl(new Container(), { containerLayout: 'horizontal' }),
    { vertical: false, separation: 4 },
  );
  bindGodotCanvasContainerApi(container);
  registerGodotObjectIdentity(container, 'HBoxContainer');
  return container;
}

/** Runtime base `BoxContainer.new()`: Godot's default constructor is horizontal. */
export function createGodotCanvasBoxContainer(): Container {
  const container = bindCanvasBoxContainer(
    bindRuntimeCanvasControl(new Container(), { containerLayout: 'horizontal' }),
    { vertical: false, separation: 4 },
  );
  bindGodotCanvasContainerApi(container);
  registerGodotObjectIdentity(container, 'BoxContainer');
  return container;
}

export function createGodotCanvasPanelContainer(): Container {
  const container = new Container();
  const background = markInternalCanvasChild(new Graphics());
  container.addChild(background);
  bindRuntimeCanvasControl(container, {
    containerLayout: 'panel',
    applySize: () => redrawCanvasPanelTheme(container),
  });
  bindGodotCanvasContainerApi(container);
  registerGodotObjectIdentity(container, 'PanelContainer');
  bindCanvasPanelTheme({ owner: container, graphics: background, themeType: 'PanelContainer' });
  return container;
}

export type GodotCanvasColorRect = Graphics & { color: ColorValue };

interface CanvasColorRectState {
  color: ColorValue;
  size: PointData;
}

const CANVAS_COLOR_RECTS = new WeakMap<Graphics, CanvasColorRectState>();

function requireColorRectColor(value: ColorValue): ColorValue {
  if (
    typeof value !== 'object' ||
    value === null ||
    ![value.r, value.g, value.b, value.a].every(
      (channel) => typeof channel === 'number' && Number.isFinite(channel),
    )
  ) {
    throw new TypeError('Godot ColorRect.color requires a finite Color.');
  }
  return { r: value.r, g: value.g, b: value.b, a: value.a };
}

function requireColorRectSize(value: PointData): PointData {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof value.x !== 'number' ||
    !Number.isFinite(value.x) ||
    typeof value.y !== 'number' ||
    !Number.isFinite(value.y) ||
    value.x < 0 ||
    value.y < 0
  ) {
    throw new TypeError('Godot ColorRect size requires a finite non-negative Vector2.');
  }
  return { x: value.x, y: value.y };
}

function redrawCanvasColorRect(rect: Graphics, state: CanvasColorRectState): void {
  const channel = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * 255);
  rect.clear();
  rect.rect(0, 0, state.size.x, state.size.y).fill({
    color:
      channel(state.color.r) * 0x10000 +
      channel(state.color.g) * 0x100 +
      channel(state.color.b),
    alpha: Math.max(0, Math.min(1, state.color.a)),
  });
}

/** Seat live ColorRect state on the same retained Pixi Graphics used by scene and runtime nodes. */
export function bindGodotCanvasColorRect(
  rect: Graphics,
  value: ColorValue = { r: 1, g: 1, b: 1, a: 1 },
  size: PointData = { x: 0, y: 0 },
): GodotCanvasColorRect {
  if (CANVAS_COLOR_RECTS.has(rect)) {
    throw new Error('Godot ColorRect Pixi Graphics is already bound.');
  }
  const state: CanvasColorRectState = {
    color: requireColorRectColor(value),
    size: requireColorRectSize(size),
  };
  CANVAS_COLOR_RECTS.set(rect, state);
  Object.defineProperty(rect, 'color', {
    enumerable: true,
    configurable: true,
    get: () => ({ ...state.color }),
    set: (next: ColorValue) => {
      state.color = requireColorRectColor(next);
      redrawCanvasColorRect(rect, state);
    },
  });
  redrawCanvasColorRect(rect, state);
  return rect as GodotCanvasColorRect;
}

export function resizeGodotCanvasColorRect(
  rect: GodotCanvasColorRect,
  width: number,
  height: number,
): void {
  const state = CANVAS_COLOR_RECTS.get(rect);
  if (state === undefined) throw new TypeError('Expected a retained Godot ColorRect.');
  state.size = requireColorRectSize({ x: width, y: height });
  redrawCanvasColorRect(rect, state);
}

export function releaseGodotCanvasColorRect(rect: GodotCanvasColorRect): void {
  CANVAS_COLOR_RECTS.delete(rect);
}

/** Runtime `ColorRect.new()` with one retained Graphics identity and live authored color. */
export function createGodotCanvasColorRect(): GodotCanvasColorRect {
  const rect = bindGodotCanvasColorRect(new Graphics());
  bindRuntimeCanvasControl(rect, {
    applySize: (next) => resizeGodotCanvasColorRect(rect, next.x, next.y),
  });
  registerGodotObjectIdentity(rect, 'ColorRect');
  return rect;
}

/** Runtime Godot 3 `Sprite.new()` / Godot 4 `Sprite2D.new()` over retained Pixi Sprite. */
export function createGodotCanvasSprite(major: 3 | 4): GodotCanvasSprite {
  const sprite = bindGodotCanvasSpriteApi(
    bindGodotCanvasNode2DApi(new Sprite({ texture: Texture.EMPTY })),
    major === 3 ? 'Sprite' : 'Sprite2D',
  );
  return sprite;
}

/** Runtime `TextureRect.new()` using the same retained Sprite/Control projection as authored nodes. */
export function createGodotCanvasTextureRect(): GodotTextureRect {
  const rect = createTextureRect({ width: 0, height: 0, texture: Texture.EMPTY });
  bindRuntimeCanvasControl(rect, {
    nativeSize: true,
    applySize: (size) => {
      rect.width = size.x;
      rect.height = size.y;
    },
  });
  registerGodotObjectIdentity(rect, 'TextureRect');
  return rect;
}

// --- TextureRect ---------------------------------------------------------------------------------

/**
 * A node with a drawn texture — the overlay store's `texture` URL on a
 * translated `TextureRect`.
 *
 * Structural for the same reason {@link TextNode} is: `texture` is one string
 * (the URL the port ships the Godot Texture2D at) and the 3D HUD is a DOM
 * `<img>`, not a three material. starter-kit-fps `player.gd:273` is
 * `crosshair.texture = weapon.crosshair`.
 */
export interface TextureNode {
  texture: string;
}

/** `texture_rect.texture` — the URL the overlay `<img>` reads. */
export function getTexture(node: TextureNode): string {
  return node.texture;
}

/** `texture_rect.texture = tex` — `player.gd:273`. */
export function setTexture(node: TextureNode, value: string): void {
  node.texture = value;
}

type VideoStreamNode = object;
interface VideoStreamState {
  readonly element: HTMLVideoElement;
  readonly finished: SignalHandle<readonly []>;
  readonly releaseMediaEvents: () => void;
  audioGraph: GodotAudioGraph | undefined;
  audioSource: MediaElementAudioSourceNode | undefined;
  audioGain: GainNode | undefined;
  busName: string;
  volume: number;
  videoTexture: Texture | undefined;
  audioTrack: number;
  pausedByUser: boolean;
  asyncState: 'idle' | 'pending' | 'ready' | 'error';
  lastAsyncError: unknown | null;
  stream: unknown | null;
  streamChangedConnection: GodotConnection | undefined;
}
const VIDEO_STREAM_STATES = new WeakMap<object, VideoStreamState>();

/** Reject a known container format immediately when this browser advertises no decoder. */
export function assertGodotVideoCodec(element: HTMLVideoElement, url: string): void {
  const path = url.split(/[?#]/u, 1)[0]?.toLowerCase() ?? '';
  const mime = path.endsWith('.ogv') || path.endsWith('.ogg')
    ? 'video/ogg'
    : path.endsWith('.webm')
      ? 'video/webm'
      : path.endsWith('.mp4') || path.endsWith('.m4v')
        ? 'video/mp4'
        : undefined;
  if (mime !== undefined && element.canPlayType(mime) === '') {
    throw new Error(`VideoStreamPlayer cannot decode ${mime} on this browser (${url}).`);
  }
}

function installVideoStreamState(node: object, element: HTMLVideoElement): VideoStreamState {
  const prior = VIDEO_STREAM_STATES.get(node);
  if (prior?.element === element) return prior;
  const retained = prior === undefined ? undefined : {
    busName: prior.busName,
    volume: prior.volume,
    audioTrack: prior.audioTrack,
    pausedByUser: prior.pausedByUser,
    autoplay: prior.element.autoplay,
    loop: prior.element.loop,
    playbackRate: prior.element.playbackRate,
    currentTime: prior.element.currentTime,
    stream: prior.stream,
    audioGraph: prior.audioGraph,
    finished: prior.finished,
  };
  if (prior !== undefined) releaseGodotVideoStreamPlayer(node);
  const finished = retained?.finished ?? createSignal<readonly []>();
  const emitFinished = (): void => finished.emit();
  let state: VideoStreamState;
  const retainMediaError = (): void => {
    state.asyncState = 'error';
    state.lastAsyncError = element.error ?? new Error('VideoStreamPlayer native media decode failed.');
  };
  element.addEventListener('ended', emitFinished);
  element.addEventListener('error', retainMediaError);
  const dataStream = Object.getOwnPropertyDescriptor(node, 'stream');
  state = {
    element,
    finished,
    releaseMediaEvents: () => {
      element.removeEventListener('ended', emitFinished);
      element.removeEventListener('error', retainMediaError);
    },
    busName: retained?.busName ?? 'Master',
    volume: retained?.volume ?? element.volume,
    audioTrack: retained?.audioTrack ?? 0,
    audioGraph: undefined,
    audioSource: undefined,
    audioGain: undefined,
    videoTexture: undefined,
    pausedByUser: retained?.pausedByUser ?? false,
    asyncState: 'idle',
    lastAsyncError: null,
    stream: retained?.stream ?? (dataStream !== undefined && 'value' in dataStream ? dataStream.value : null),
    streamChangedConnection: undefined,
  };
  if (retained !== undefined) {
    element.autoplay = retained.autoplay;
    element.loop = retained.loop;
    element.playbackRate = retained.playbackRate;
    element.volume = Math.max(0, Math.min(1, retained.volume));
    if (Number.isFinite(retained.currentTime) && retained.currentTime > 0) {
      try { element.currentTime = retained.currentTime; }
      catch { /* Metadata may not be loaded on the newly mounted presentation yet. */ }
    }
  }
  VIDEO_STREAM_STATES.set(node, state);
  if (retained?.audioGraph !== undefined) {
    const source = retained.audioGraph.context.createMediaElementSource(element);
    const gain = retained.audioGraph.context.createGain();
    source.connect(gain);
    gain.connect(retained.audioGraph.busInput(state.busName));
    gain.gain.value = state.volume;
    element.volume = 1;
    state.audioGraph = retained.audioGraph;
    state.audioSource = source;
    state.audioGain = gain;
  }
  return state;
}

/** Keep browser autoplay/decode failures local to the retained player instead of leaking an
 * unhandled rejection into the game console. */
function retainVideoStreamPromise(state: VideoStreamState, operation: Promise<void>): void {
  state.asyncState = 'pending';
  operation.then(
    () => {
      state.asyncState = 'ready';
      state.lastAsyncError = null;
    },
    (error: unknown) => {
      state.asyncState = 'error';
      state.lastAsyncError = error;
    },
  );
}

/**
 * Seat the media element on the translated game's real AudioServer graph. A media element may be
 * wrapped by exactly one MediaElementAudioSourceNode for its lifetime, so graph identity is fixed
 * on the first routed audio operation and later attempts to cross AudioContexts fail loudly.
 */
function videoStreamAudioState(node: VideoStreamNode, graph: GodotAudioGraph): VideoStreamState {
  const state = videoStreamState(node);
  if (state.audioGraph !== undefined && state.audioGraph !== graph) {
    throw new Error('VideoStreamPlayer cannot move its retained HTMLVideoElement between AudioServer graphs.');
  }
  if (state.audioSource === undefined || state.audioGain === undefined) {
    const source = graph.context.createMediaElementSource(state.element);
    const gain = graph.context.createGain();
    source.connect(gain);
    gain.connect(graph.busInput(state.busName));
    gain.gain.value = state.volume;
    // Once routed through Web Audio, the element's own volume must stay at unity: the retained
    // GainNode is the one value that supports Godot's positive dB range and AudioServer buses.
    state.element.volume = 1;
    state.audioGraph = graph;
    state.audioSource = source;
    state.audioGain = gain;
  }
  return state;
}

function authoredVideoUrl(source: unknown): string {
  const url = typeof source === 'string'
    ? source
    : typeof source === 'object' && source !== null
      ? typeof (source as { browser_url?: unknown }).browser_url === 'string' && (source as { browser_url: string }).browser_url !== ''
        ? (source as { browser_url: string }).browser_url
        : typeof (source as { file?: unknown }).file === 'string' && (source as { file: string }).file !== ''
        ? (source as { file: string }).file
        : typeof (source as { resource_path?: unknown }).resource_path === 'string'
          ? (source as { resource_path: string }).resource_path
          : ''
      : '';
  if (url === '') throw new Error('VideoStreamPlayer requires an authored VideoStream resource.');
  if (url.startsWith('res://')) {
    throw new Error(`VideoStreamPlayer cannot fetch unresolved project URI ${url}; emission must supply the shipped browser asset URL.`);
  }
  return url;
}

function bindVideoStreamSource(state: VideoStreamState): void {
  state.streamChangedConnection?.disconnect();
  state.streamChangedConnection = undefined;
  const stream = state.stream;
  if (stream === null) return;
  const apply = (): void => {
    const url = authoredVideoUrl(stream);
    assertGodotVideoCodec(state.element, url);
    state.element.src = url;
    state.element.load();
  };
  apply();
  state.streamChangedConnection = godotResourceChangedSignal(stream).connect(apply);
}

function videoStreamState(node: VideoStreamNode): VideoStreamState {
  const retained = VIDEO_STREAM_STATES.get(node);
  if (retained !== undefined) return retained;
  if (typeof document === 'undefined') throw new Error('VideoStreamPlayer requires a browser Document.');
  const element = document.createElement('video');
  element.preload = 'auto';
  element.playsInline = true;
  const state = installVideoStreamState(node, element);
  if (state.stream !== null) bindVideoStreamSource(state);
  return state;
}

/** Associates an emitted VideoStreamPlayer node with its retained browser video carrier. */
export function bindGodotVideoStreamPlayer(node: object, element: HTMLVideoElement): void {
  if (typeof HTMLVideoElement === 'undefined' || !(element instanceof HTMLVideoElement)) {
    throw new TypeError('VideoStreamPlayer requires a native HTMLVideoElement carrier.');
  }
  element.preload = 'auto';
  element.playsInline = true;
  const state = installVideoStreamState(node, element);
  if (state.stream !== null) bindVideoStreamSource(state);
}

/** Starts the retained native browser video through its promise-owning media seam. */
export function playGodotVideoStreamPlayer(node: VideoStreamNode): void {
  const state = videoStreamState(node);
  state.pausedByUser = false;
  if (state.stream === null) return;
  retainVideoStreamPromise(state, state.element.play());
}

export function stopGodotVideoStreamPlayer(node: VideoStreamNode): void {
  const state = videoStreamState(node);
  const element = state.element;
  state.pausedByUser = false;
  element.pause();
  if (element.readyState === HTMLMediaElement.HAVE_NOTHING || element.seekable.length === 0) return;
  try {
    element.currentTime = 0;
  } catch (error: unknown) {
    state.asyncState = 'error';
    state.lastAsyncError = error;
  }
}

export function isGodotVideoStreamPlayerPlaying(node: VideoStreamNode): boolean {
  const element = videoStreamState(node).element;
  return !element.paused && !element.ended;
}

export function getGodotVideoStreamPlayerPaused(node: VideoStreamNode): boolean {
  return videoStreamState(node).pausedByUser;
}

export function setGodotVideoStreamPlayerPaused(node: VideoStreamNode, paused: boolean): void {
  if (typeof paused !== 'boolean') throw new TypeError('VideoStreamPlayer.paused requires bool.');
  const state = videoStreamState(node);
  if (paused === state.pausedByUser) return;
  state.pausedByUser = paused;
  if (paused) state.element.pause();
  else if (state.stream !== null) {
    retainVideoStreamPromise(state, state.element.play());
  }
}

export function getGodotVideoStreamPlayerPosition(node: VideoStreamNode): number {
  return videoStreamState(node).element.currentTime;
}

export function setGodotVideoStreamPlayerPosition(node: VideoStreamNode, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('VideoStreamPlayer.stream_position requires finite non-negative seconds.');
  videoStreamState(node).element.currentTime = seconds;
}

export function getGodotVideoStreamPlayerVolumeDb(node: VideoStreamNode): number {
  const volume = videoStreamState(node).volume;
  return volume === 0 ? -80 : 20 * Math.log10(volume);
}

export function setGodotVideoStreamPlayerVolumeDb(
  node: VideoStreamNode,
  decibels: number,
  graph: GodotAudioGraph,
): void {
  if (!Number.isFinite(decibels)) {
    throw new TypeError('VideoStreamPlayer.volume_db requires a finite number.');
  }
  setGodotVideoStreamPlayerVolume(node, decibels < -79 ? 0 : dbToLinear(decibels), graph);
}

export function getGodotVideoStreamPlayerVolume(node: VideoStreamNode): number {
  return videoStreamState(node).volume;
}

export function setGodotVideoStreamPlayerVolume(
  node: VideoStreamNode,
  volume: number,
  graph: GodotAudioGraph,
): void {
  if (!Number.isFinite(volume)) {
    throw new RangeError('VideoStreamPlayer.volume requires a finite linear gain.');
  }
  const state = videoStreamAudioState(node, graph);
  state.volume = volume;
  state.audioGain!.gain.value = volume;
}

export function getGodotVideoStreamPlayerBus(node: VideoStreamNode): string {
  const state = videoStreamState(node);
  return state.audioGraph !== undefined && state.audioGraph.busIndex(state.busName) < 0
    ? 'Master'
    : state.busName;
}

export function setGodotVideoStreamPlayerBus(
  node: VideoStreamNode,
  busName: unknown,
  graph: GodotAudioGraph,
): void {
  if (typeof busName !== 'string') throw new TypeError('VideoStreamPlayer.bus requires a StringName.');
  const state = videoStreamAudioState(node, graph);
  state.busName = busName;
  state.audioGain!.disconnect();
  state.audioGain!.connect(graph.busInput(busName));
}

export function godotVideoStreamPlayerFinishedSignal(node: VideoStreamNode): GodotSignal<readonly []> {
  return videoStreamState(node).finished.signal;
}

export function getGodotVideoStreamPlayerStream(node: VideoStreamNode): unknown {
  return videoStreamState(node).stream;
}

/** Swap the retained media source; Godot stops playback before replacing its VideoStream. */
export function setGodotVideoStreamPlayerStream(node: VideoStreamNode, stream: unknown): void {
  if (stream !== null && stream !== undefined) {
    const streamClass = godotObjectGetClass(stream);
    if (streamClass !== 'VideoStream' && streamClass !== 'VideoStreamTheora') {
      throw new TypeError(`VideoStreamPlayer.stream requires VideoStream; received ${streamClass}.`);
    }
  }
  const state = videoStreamState(node);
  state.pausedByUser = false;
  state.element.pause();
  if (state.element.readyState !== HTMLMediaElement.HAVE_NOTHING && state.element.seekable.length > 0) {
    try {
      state.element.currentTime = 0;
    } catch (error: unknown) {
      state.asyncState = 'error';
      state.lastAsyncError = error;
    }
  }
  state.stream = stream ?? null;
  if (stream === null || stream === undefined) {
    state.streamChangedConnection?.disconnect();
    state.streamChangedConnection = undefined;
    state.element.removeAttribute('src');
    state.element.load();
    return;
  }
  bindVideoStreamSource(state);
}

export function getGodotVideoStreamPlayerLoop(node: VideoStreamNode): boolean {
  return videoStreamState(node).element.loop;
}

export function setGodotVideoStreamPlayerLoop(node: VideoStreamNode, enabled: unknown): void {
  if (typeof enabled !== 'boolean') throw new TypeError('VideoStreamPlayer.loop requires bool.');
  videoStreamState(node).element.loop = enabled;
}

export function getGodotVideoStreamPlayerSpeedScale(node: VideoStreamNode): number {
  return videoStreamState(node).element.playbackRate;
}

export function setGodotVideoStreamPlayerSpeedScale(node: VideoStreamNode, speed: number): void {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError('VideoStreamPlayer.speed_scale requires a finite positive playback rate.');
  }
  try {
    videoStreamState(node).element.playbackRate = speed;
  } catch (cause: unknown) {
    throw new Error(`VideoStreamPlayer.speed_scale=${String(speed)} is unsupported by this browser.`, { cause });
  }
}

export function getGodotVideoStreamPlayerAutoplay(node: VideoStreamNode): boolean {
  return videoStreamState(node).element.autoplay;
}

export function setGodotVideoStreamPlayerAutoplay(node: VideoStreamNode, enabled: unknown): void {
  if (typeof enabled !== 'boolean') throw new TypeError('VideoStreamPlayer.autoplay requires bool.');
  videoStreamState(node).element.autoplay = enabled;
}

/** Browser media metadata is zero until loaded, matching Godot's null/unopened stream result. */
export function getGodotVideoStreamPlayerStreamLength(node: VideoStreamNode): number {
  const duration = videoStreamState(node).element.duration;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

export function getGodotVideoStreamPlayerStreamName(node: VideoStreamNode): string {
  const stream = videoStreamState(node).stream;
  if (stream === null) return '<No Stream>';
  if (typeof stream === 'object' && stream !== null) {
    const resourceName = (stream as { readonly resource_name?: unknown }).resource_name;
    if (typeof resourceName === 'string') return resourceName;
  }
  return '';
}

/** One Pixi Texture identity follows the retained HTMLVideoElement across stream changes. */
export function getGodotVideoStreamPlayerTexture(node: VideoStreamNode): Texture | null {
  const state = videoStreamState(node);
  if (state.stream === null) return null;
  state.videoTexture ??= Texture.from(state.element);
  return state.videoTexture;
}

interface BrowserAudioTrack {
  enabled: boolean;
}

interface BrowserAudioTrackList {
  readonly length: number;
  readonly [index: number]: BrowserAudioTrack | undefined;
}

function browserAudioTracks(element: HTMLVideoElement): BrowserAudioTrackList | undefined {
  return (element as HTMLVideoElement & { readonly audioTracks?: BrowserAudioTrackList }).audioTracks;
}

export function getGodotVideoStreamPlayerAudioTrack(node: VideoStreamNode): number {
  return videoStreamState(node).audioTrack;
}

/** Select a native media audio track when the browser exposes AudioTrackList. */
export function setGodotVideoStreamPlayerAudioTrack(node: VideoStreamNode, track: number): void {
  if (!Number.isSafeInteger(track) || track < 0) {
    throw new RangeError('VideoStreamPlayer.audio_track requires a non-negative integer.');
  }
  const state = videoStreamState(node);
  const tracks = browserAudioTracks(state.element);
  if (tracks === undefined) {
    if (track === 0) {
      state.audioTrack = 0;
      return;
    }
    throw new Error('VideoStreamPlayer.audio_track is unavailable because this browser exposes no AudioTrackList.');
  }
  if (track >= tracks.length) {
    throw new RangeError(`VideoStreamPlayer audio track ${String(track)} is outside [0, ${String(tracks.length)}).`);
  }
  for (let index = 0; index < tracks.length; index += 1) {
    const candidate = tracks[index];
    if (candidate !== undefined) candidate.enabled = index === track;
  }
  state.audioTrack = track;
}

/** Release the video carrier's listeners and Web Audio nodes with its retained scene identity. */
export function releaseGodotVideoStreamPlayer(node: object): void {
  const state = VIDEO_STREAM_STATES.get(node);
  if (state === undefined) return;
  state.element.pause();
  state.releaseMediaEvents();
  state.audioSource?.disconnect();
  state.audioGain?.disconnect();
  state.audioSource = undefined;
  state.audioGain = undefined;
  state.audioGraph = undefined;
  state.videoTexture?.destroy();
  state.videoTexture = undefined;
  state.streamChangedConnection?.disconnect();
  state.streamChangedConnection = undefined;
  VIDEO_STREAM_STATES.delete(node);
}

// --- CanvasItem.modulate / Control rect (overlay handle + installed Pixi sprite) -----------------

/**
 * A node that carries Godot's `CanvasItem.modulate` as one Color. The overlay
 * `controlHandle` presents it as a field; `installSpriteModulate` installs it
 * on a Pixi Sprite. Structural so both surfaces share one getter/setter.
 */
export interface ModulateNode {
  modulate: ColorValue;
}

/** `canvas_item.modulate` — `virtual_joystick.gd:62`/`:85`/`:168`. */
export function getModulate(node: ModulateNode): ColorValue {
  return node.modulate;
}

/** `canvas_item.modulate = color`. */
export function setModulate(node: ModulateNode, value: ColorValue): void {
  node.modulate = value;
}

/**
 * A translated `Control`'s live rect, in the project's design pixels. The
 * overlay handle satisfies this; `Node2D.position` is a different member in a
 * different space and is not this type.
 */
export interface ControlRectNode {
  position: Vector2;
  global_position: Vector2;
  size: Vector2;
  custom_minimum_size: Vector2;
  size_flags_horizontal: number;
  size_flags_vertical: number;
  mouse_filter: number;
  pivot_offset: Vector2;
  scale: Vector2;
}

/** `Control.position` — origin inside the parent rect. */
export function getControlPosition(node: ControlRectNode): Vector2 {
  return copyVector2(node.position);
}

/** `Control.position = v`. */
export function setControlPosition(node: ControlRectNode, value: Vector2): void {
  node.position = copyVector2(value);
}

/** `Control.global_position` — design-pixel origin in the overlay root. */
export function getControlGlobalPosition(node: ControlRectNode): Vector2 {
  return copyVector2(node.global_position);
}

/** `Control.global_position = v`. */
export function setControlGlobalPosition(node: ControlRectNode, value: Vector2): void {
  node.global_position = copyVector2(value);
}

export function getControlScale(node: ControlRectNode): Vector2 {
  return copyVector2(node.scale);
}

export function setControlScale(node: ControlRectNode, value: Vector2): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError('Godot Control.rect_scale requires a finite Vector2.');
  }
  node.scale = copyVector2(value);
}

export function getControlRotation(node: object): number {
  if (node instanceof Container) return node.rotation;
  const binding = optionalControlBinding(node);
  if (binding === undefined) throw new Error('Control.rotation requires a retained DOM/Pixi Control.');
  const record = binding.state.read(binding.id);
  const authored = binding.state.authored(binding.id);
  return (record.rotationDegrees ?? authored?.rotationDegrees ?? 0) * DEGREES_TO_RADIANS;
}

export function setControlRotation(node: object, radians: number): void {
  if (!Number.isFinite(radians)) throw new TypeError('Control.rotation requires a finite number.');
  if (node instanceof Container) {
    node.rotation = radians;
    return;
  }
  const binding = optionalControlBinding(node);
  if (binding === undefined) throw new Error('Control.rotation requires a retained DOM/Pixi Control.');
  binding.state.write(binding.id, { rotationDegrees: radians * RADIANS_TO_DEGREES });
}

/** `Control.size`. */
export function getControlSize(node: ControlRectNode): Vector2 {
  return copyVector2(node.size);
}

/** `Control.size = v`. */
export function setControlSize(node: ControlRectNode, value: Vector2): void {
  node.size = copyVector2(value);
}

/** Godot 3 `rect_min_size` / Godot 4 `custom_minimum_size`. */
export function getControlCustomMinimumSize(node: ControlRectNode): Vector2 {
  return copyVector2(node.custom_minimum_size);
}

/** Set the user-authored minimum; native layout reads the same retained Control state. */
export function setControlCustomMinimumSize(node: ControlRectNode, value: Vector2): void {
  node.custom_minimum_size = copyVector2(value);
}

function assertControlSizeFlags(value: number): number {
  if (!Number.isInteger(value) || value < 0 || (value & ~0xf) !== 0) {
    throw new Error(`Godot Control size flags contain an unknown bit: ${String(value)}.`);
  }
  return value;
}

export function getControlHorizontalSizeFlags(node: ControlRectNode): number {
  return node.size_flags_horizontal;
}

export function setControlHorizontalSizeFlags(node: ControlRectNode, value: number): void {
  node.size_flags_horizontal = assertControlSizeFlags(value);
}

export function getControlVerticalSizeFlags(node: ControlRectNode): number {
  return node.size_flags_vertical;
}

export function setControlVerticalSizeFlags(node: ControlRectNode, value: number): void {
  node.size_flags_vertical = assertControlSizeFlags(value);
}

export function getControlMouseFilter(node: ControlRectNode): number {
  return node.mouse_filter;
}

export function setControlMouseFilter(node: ControlRectNode, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 2) {
    throw new Error(`Godot Control mouse_filter must be 0, 1, or 2; received ${String(value)}.`);
  }
  node.mouse_filter = value;
}

/** `Control.pivot_offset`. */
export function getControlPivotOffset(node: ControlRectNode): Vector2 {
  return copyVector2(node.pivot_offset);
}

/** `Control.pivot_offset = v`. */
export function setControlPivotOffset(node: ControlRectNode, value: Vector2): void {
  node.pivot_offset = copyVector2(value);
}

/**
 * `CanvasItem.get_global_transform_with_canvas()` — overlay Controls live in
 * design pixels, and touch positions are mapped into that same space, so the
 * canvas scale is identity. Translation is the control's global origin.
 */
export function getGlobalTransformWithCanvas(node: ControlRectNode): Transform2D {
  if (node instanceof Container) return getNode2DGlobalTransform(node);
  return optionalControlBinding(node) === undefined
    ? transform2DFromOrigin(node.global_position)
    : retainedControlGlobalTransform(node);
}
