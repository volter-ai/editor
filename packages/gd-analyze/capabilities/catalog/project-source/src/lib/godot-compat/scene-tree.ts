/**
 * `SceneTree` — `get_tree()`, its group registry, `call_group`, `create_timer`,
 * and the one place per frame where deferred work drains.
 *
 * The pilot touches two members (`SceneTree.call_group` at `Main.gd:20`,
 * `SceneTree.create_timer` at `HUD.gd:17`) and depends on a third thing the
 * member table cannot name: the `mobs` GROUP, authored on `Mob.tscn`'s root as
 * `groups=["mobs"]`, which `call_group` is the only reader of.
 *
 * ## Groups are a caller-fed registry, and `call_group` needs a method table
 *
 * `get_tree().call_group("mobs", "queue_free")` calls a method NAMED BY STRING
 * on every node in a group. GDScript can do that because every Godot object
 * carries a runtime method table; a Pixi `Container` does not, and inventing
 * one — a `Map<string, Function>` bolted onto every node, kept in sync by
 * somebody — is exactly the emulation kernel this capability exists without.
 *
 * So membership is DECLARED with the callable set that makes it meaningful:
 *
 * ```ts
 * addToGroup(tree, 'mobs', mob, { queue_free: () => queueFree(tree, mob) });
 * callGroup(tree, 'mobs', 'queue_free');
 * ```
 *
 * The emitted project already knows both halves — the group comes from the
 * `.tscn`, the methods from the class it just emitted — so this costs the
 * translation one argument and costs the runtime no registry it has to guess
 * at. A member of the group with no such method THROWS naming the group, the
 * method and how many members were reached first: Godot silently skips it, and
 * a silent skip in a port reads as "the mobs did not despawn" with nothing to
 * grep for.
 *
 * ## The tree is the PORT'S tree, plus the things Godot puts in a tree that
 * neither renderer does
 *
 * `root` is whatever the port mounted — a Pixi `Container` for a 2D port (the
 * default, so every 2D call site reads exactly as it always did) and a
 * `THREE.Object3D` for a 3D one. Nothing in this file touches a node except as
 * a Map key and a group member, so it is the SAME tree on both surfaces;
 * lookup, parenting and freeing are the surface's own (`node.ts` /
 * `node-3d.ts`). A Godot game is 2D or 3D, not both, so a port picks one node
 * type and the generic never mixes them.
 *
 * But Godot's tree also holds `Timer`s, and neither renderer's tree holds
 * anything but drawables — so a `Timer` is not a node here, it is an object
 * the tree STEPS. Two consequences, both stated rather than papered over:
 * `$MobTimer` resolves at emission time to the emitted class's own field (not
 * through `getNode`), and a timer must be handed to {@link SceneTree.addTimer}
 * to advance at all.
 *
 * ## `tick(dt)` is the whole frame contract
 *
 * One call, in this order: step every registered timer, then every registered
 * tween, then flush the deferred queue. Timers and tweens share the same
 * seconds (the sim clock `create_timer` already measures); a `tween_callback`
 * that `queue_free`s must still land in the same frame's flush, the way a
 * `timeout` listener does. The port calls it once per frame from time it
 * already has, and compat subscribes to nothing. Both emitted lanes hand it
 * SIM time, never the wall clock — which is the whole point of owning no clock:
 *
 * ```ts
 * // canvas (2D) port — `translate/emit/world.ts`. `@pixi/react`'s ticker is the
 * // one `@vgai/engine/canvas-react` pins to game time and advances by hand
 * // (`mountedApp.ticker.update(elapsedMs)`), so `deltaMS` is the host's dt.
 * useTick(({ deltaMS }) => { ctx.tree.tick(deltaMS / 1000); … });
 *
 * // three (3D) port — `translate/emit/world3d.ts`. The R3F root runs
 * // `frameloop: 'never'` and is advanced from the host's `update(dt)`
 * // (`@vgai/engine/world3d-react/r3f-adapter`), so `delta` is the host's dt too.
 * useFrame((_state, delta) => { ctx.tree.tick(delta); … }, -1);
 * ```
 *
 * A raw `app.ticker.add(…)` on a Pixi `Application` this repo did NOT pin would
 * be display-rate wall clock and is not what any port wires — a paused world
 * would keep spawning mobs and a hidden tab would skip.
 *
 * ## Resource ownership
 *
 * **Owns:** the group registry, the timer step set, the tween step set, and one
 * `DeferredQueue`.
 * **Shares:** the root `Container` (the port's stage) and every node in a
 * group, by reference. **Teardown:** `addTimer` hands back a remover and
 * `removeFromGroup` is the group's; a finished tween drops itself from the
 * step set. Beyond that, dropping the tree drops everything, because it
 * registered nothing anywhere else.
 */

import type { Container } from 'pixi.js';
import { bindGodotClassDb, type GodotClassDb } from './class-db';
import { createDeferredQueue, type DeferredQueue } from './deferred';

const RETAINED_SCENE_TREES = new WeakSet<object>();

/** Exact identity guard for the SceneTree object created and owned by this compat runtime. */
export function isRetainedGodotSceneTree(value: unknown): value is SceneTree<object> {
  return typeof value === 'object' && value !== null && RETAINED_SCENE_TREES.has(value);
}

import {
  GodotMultiplayerAPI,
  type GodotMultiplayerPeer,
  GodotOfflineMultiplayerPeer,
  GodotSceneMultiplayer,
} from './multiplayer-api';
import { isInternalCanvasChild } from './node';
import { isInternalThreeChild } from './node-3d';
import { type GodotNodePath, godotNodePathNew, godotNodePathString } from './node-path';
import { isNodeReady } from './node-process';
import {
  hasNodePath,
  isNodeInsideTree,
  type NodeTreeAccess,
  nodePathInTree,
  resolveNodeOrNull,
} from './node-tree';
import { godotObjectCall, godotObjectIsClass } from './object';
import { createGodotProjectSettings, type GodotProjectSettingSeed } from './project-settings';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { createTimer, type GodotTimer } from './timer';
import { createTween, type GodotTween } from './tween';

/**
 * The methods a node exposes to `call_group`, supplied when it joins the group.
 *
 * A plain record of thunks. It is not a general dispatch table and must not
 * grow into one: only names a `call_group` call actually uses belong here.
 */
export type GroupMethods = Readonly<Record<string, (...args: never[]) => void>>;

const TREE_EXITING = new WeakMap<object, SignalHandle<[]>>();
const TREE_EXITED = new WeakMap<object, SignalHandle<[]>>();
const TREE_ENTERED = new WeakMap<object, SignalHandle<[]>>();
const CHILD_ENTERED_TREE = new WeakMap<object, SignalHandle<readonly [object]>>();
const CHILD_EXITING_TREE = new WeakMap<object, SignalHandle<readonly [object]>>();
const CHILD_ORDER_CHANGED = new WeakMap<object, SignalHandle<[]>>();
const NODE_RENAMED = new WeakMap<object, SignalHandle<[]>>();
const NODE_EXIT_CALLBACKS = new WeakMap<object, () => void>();
const TREE_INSIDE = new WeakSet<object>();
const EXITING_EMITTED = new WeakSet<object>();

function lifecycleSignalOf(
  slots: WeakMap<object, SignalHandle<[]>>,
  node: object,
): SignalHandle<[]> {
  let slot = slots.get(node);
  if (slot === undefined) {
    slot = createSignal<[]>();
    slots.set(node, slot);
  }
  return slot;
}

export function getNodeTreeExitingSignal(node: object): GodotSignal<[]> {
  return lifecycleSignalOf(TREE_EXITING, node).signal;
}

/** Retain one ScriptInstance `_exit_tree` callback on its native Node identity. */
export function bindNodeExitCallback(node: object, callback: () => void): () => void {
  if (NODE_EXIT_CALLBACKS.has(node)) {
    throw new Error('godot-compat: a retained Node cannot own two _exit_tree callbacks.');
  }
  NODE_EXIT_CALLBACKS.set(node, callback);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (NODE_EXIT_CALLBACKS.get(node) === callback) NODE_EXIT_CALLBACKS.delete(node);
  };
}

export function getNodeTreeExitedSignal(node: object): GodotSignal<[]> {
  return lifecycleSignalOf(TREE_EXITED, node).signal;
}

/** Open/base Node signal access stays on registered ClassDB identity, never structural JS. */
export function getOpenNodeTreeExitedSignal(node: unknown, major: 3 | 4): GodotSignal<[]> {
  if (!godotObjectIsClass(node, 'Node', major)) {
    throw new TypeError(
      'godot-compat: open Node.tree_exited requires a retained native Node identity.',
    );
  }
  return getNodeTreeExitedSignal(node as object);
}

export function getNodeTreeEnteredSignal(node: object): GodotSignal<[]> {
  return lifecycleSignalOf(TREE_ENTERED, node).signal;
}

export function getNodeChildEnteredTreeSignal(node: object): GodotSignal<readonly [object]> {
  let slot = CHILD_ENTERED_TREE.get(node);
  if (slot === undefined) {
    slot = createSignal<readonly [object]>();
    CHILD_ENTERED_TREE.set(node, slot);
  }
  return slot.signal;
}

function childSignalOf(
  slots: WeakMap<object, SignalHandle<readonly [object]>>,
  node: object,
): SignalHandle<readonly [object]> {
  let slot = slots.get(node);
  if (slot === undefined) {
    slot = createSignal<readonly [object]>();
    slots.set(node, slot);
  }
  return slot;
}

/** Node.child_exiting_tree, retained on the real renderer parent identity. */
export function getNodeChildExitingTreeSignal(node: object): GodotSignal<readonly [object]> {
  return childSignalOf(CHILD_EXITING_TREE, node).signal;
}

/** Node.child_order_changed for authored and registered non-display children. */
export function getNodeChildOrderChangedSignal(node: object): GodotSignal<[]> {
  return lifecycleSignalOf(CHILD_ORDER_CHANGED, node).signal;
}

/** Node.renamed, separate from SceneTree.node_renamed but emitted by the same mutation. */
export function getNodeRenamedSignal(node: object): GodotSignal<[]> {
  return lifecycleSignalOf(NODE_RENAMED, node).signal;
}

/**
 * Godot's `SceneTree`, narrowed to the measured surface.
 *
 * `TNode` is the port's node type — a Pixi `Container` by default, a
 * `THREE.Object3D` for a 3D port. See this module's header.
 */
export interface SceneTree<TNode extends object = Container> {
  /** The port's outer renderer root — Godot's root Window identity (`/root`). */
  readonly root: TNode;
  /** One mutable ProjectSettings singleton, seeded from exact project.godot membership/defaults. */
  readonly projectSettings: Map<string, unknown>;
  /** Where `set_deferred` and `queue_free` queue their work. */
  readonly deferred: DeferredQueue;
  /** `SceneTree.quit`'s main-loop flag. The host page remains mounted; player work stops. */
  readonly hasQuit: boolean;
  /** The process exit code supplied to `quit`, defaulting to zero. */
  readonly exitCode: number;
  /** The running scene root, or `null` while no scene is mounted. */
  currentScene: TNode | null;
  /** Whether pausable Node processing is suspended. Rendering and process-frame signals continue. */
  paused: boolean;
  /** Emitted immediately before the idle `_process` traversal. */
  readonly processFrame: GodotSignal<[]>;
  /** Emitted immediately before each fixed `_physics_process` traversal. */
  readonly physicsFrame: GodotSignal<[]>;
  /** Emitted once for every Node as it enters this tree, after its own `tree_entered`. */
  readonly nodeAdded: GodotSignal<readonly [object]>;
  readonly nodeRemoved: GodotSignal<readonly [object]>;
  readonly treeChanged: GodotSignal<[]>;
  readonly sceneChanged: GodotSignal<[]>;
  readonly treeProcessModeChanged: GodotSignal<[]>;
  readonly nodeRenamed: GodotSignal<readonly [object]>;
  readonly nodeConfigurationWarningChanged: GodotSignal<readonly [object]>;
  /** Whether an OS quit request is accepted automatically. Explicit `quit()` is unaffected. */
  autoAcceptQuit: boolean;
  setAutoAcceptQuit(enabled: boolean): void;
  isAutoAcceptQuit(): boolean;
  quitOnGoBack: boolean;
  debugCollisionsHint: boolean;
  debugPathsHint: boolean;
  debugNavigationHint: boolean;
  physicsInterpolation: boolean;
  isAccessibilitySupported(): boolean;
  isAccessibilityEnabled(): boolean;
  /** Runtime builds have no edited scene; the editor-only setter remains deliberately absent. */
  readonly editedSceneRoot: null;
  /** One tree-owned high-level multiplayer state; the default carrier is Godot's local offline peer. */
  readonly multiplayer: GodotSceneMultiplayer;
  setMultiplayer(multiplayer: GodotMultiplayerAPI, rootPath?: GodotNodePath | string): void;
  getMultiplayer(forPath?: GodotNodePath | string): GodotMultiplayerAPI;
  multiplayerPoll: boolean;
  setMultiplayerPollEnabled(enabled: boolean): void;
  isMultiplayerPollEnabled(): boolean;
  setNetworkPeer(peer: GodotMultiplayerPeer | null): void;
  getNetworkPeer(): GodotMultiplayerPeer | null;

  /** Register the bare Node Godot creates for a SCRIPT autoload as a direct `/root` child. */
  registerRootChild(name: string, node: object): () => void;
  /** Register one scene-owned `%UniqueName`; renderer parenting remains the renderer's own. */
  registerUniqueNode(owner: object, name: string, node: object): () => void;
  /** Runtime `Node.unique_name_in_owner`, backed by the same `%Name` index as authored scenes. */
  isUniqueNameInOwner(node: object): boolean;
  setUniqueNameInOwner(node: object, enabled: boolean): void;
  /** Godot's nullable path walk over renderer children plus registered non-display root children. */
  getNodeOrNull(from: object, path: GodotNodePath | string): object | null;
  /** Godot's strict `get_node`; throws at the call site when the nullable walk misses. */
  getNode(from: object, path: GodotNodePath | string): object;
  /** `Node.has_node`, including absolute `/root/Autoload` and `%UniqueName`. */
  hasNode(from: object, path: GodotNodePath | string): boolean;
  /** `Node.is_inside_tree()` including non-display autoload nodes. */
  isInsideTree(node: object): boolean;
  /** `Node.get_path()` with the host renderer root omitted from the Godot path. */
  getNodePath(node: object): GodotNodePath;
  /** Direct authored children, including registered non-render Nodes such as Timer. */
  getChildren(node: object): readonly object[];
  getChild(node: object, index: number): object | null;
  getChildCount(node: object): number;
  /** `Node.find_child`, in depth-first tree order with Godot's case-sensitive wildcard match. */
  findChild(from: object, pattern: string, recursive?: boolean, owned?: boolean): object | null;
  /** `Node.find_parent`, nearest matching ancestor first. */
  findParent(from: object, pattern: string): object | null;
  /** `Node.get_index(include_internal = false)`. Emitted trees have no internal children. */
  getIndex(node: object): number;
  /** `Node.get_path_to`, including the optional `%UniqueName` shortening. */
  getPathTo(from: object, target: object, useUniquePath?: boolean): GodotNodePath;
  /** `Node.is_ancestor_of`. */
  isAncestorOf(node: object, candidate: object): boolean;
  /** `Node.is_greater_than` comparison in live depth-first SceneTree order. */
  isGreaterThan(node: object, other: object): boolean;
  /** `Node.owner` / `get_owner`; `null` for a runtime node that was never scene-owned. */
  getOwner(node: object): object | null;
  /** `Node.owner = value` / `set_owner`, enforcing Godot's ancestor invariant. */
  setOwner(node: object, owner: object | null): void;
  /** Run one renderer-owned reparent while preserving every still-valid owner in the subtree. */
  reparentNode(node: object, parent: object, apply: () => void): void;
  /** Clear owners invalidated by an explicit `remove_child`. */
  enteredNode(node: object): void;
  /** Retain a Script.new()-constructed Node's executable ScriptInstance on its native owner. */
  bindRuntimeNodeScript(
    node: object,
    script: {
      readyTree(): void;
      physicsTree(delta: number): void;
      processTree(delta: number): void;
      dispose?(): void;
    },
  ): () => void;
  detachingNode(node: object): void;
  detachedNode(node: object): void;

  /** `node.add_to_group("mobs")`, with the methods `call_group` may invoke. */
  addToGroup(group: string, node: TNode, methods?: GroupMethods, persistent?: boolean): void;
  /** `node.remove_from_group("mobs")`. A freed node leaves its groups
   *  automatically — see {@link SceneTree.tick}. */
  removeFromGroup(group: string, node: TNode): void;
  /** `node.get_groups()` returns a detached StringName array in group insertion order. */
  getGroups(node: TNode): readonly string[];
  /** `node.is_in_group("mob")` — `Player.gd:56` in `squash-the-creeps`, whose
   *  only reader of the `mob` group this is. */
  isInGroup(group: string, node: TNode): boolean;
  /** `get_tree().get_nodes_in_group("mobs")`, in join order. */
  getNodesInGroup(group: string): readonly TNode[];
  /** Whether a non-empty group currently has at least one live member. */
  hasGroup(group: string): boolean;
  /** Godot 4's first group member in SceneTree traversal order. */
  getFirstNodeInGroup(group: string): TNode | null;
  /** Number of live Nodes currently entered under the root Window, including the root. */
  getNodeCount(): number;
  getNodeCountInGroup(group: string): number;
  getFrame(): number;
  unloadCurrentScene(): void;
  notifyNodeRenamed(node: object): void;
  notifyChildOrderChanged(parent: object): void;
  notifyNodeConfigurationWarningChanged(node: object): void;
  notifyTreeProcessModeChanged(): void;
  /** Debug representation of the receiver subtree using authored Node names. */
  getTreeString(node: object, pretty?: boolean): string;
  /** Print the same deterministic subtree representation to the browser console. */
  printTree(node: object, pretty?: boolean): void;
  /**
   * `get_tree().call_group("mobs", "queue_free")`.
   *
   * Returns how many members were called, so a port can assert on it. Throws
   * if a member does not expose `method`; see this module's header.
   */
  callGroup(group: string, method: string, ...args: never[]): number;

  /** Emit `process_frame` on the world-owned render clock. */
  emitProcessFrame(): void;
  /** Seat the authoritative fixed delta and emit `physics_frame`. */
  emitPhysicsFrame(dt: number): void;
  /** Register retained native state that advances on the same authoritative process delta. */
  addFrameStepper(step: (dt: number) => void): () => void;
  /** Most recent host fixed step after Engine.time_scale, in seconds. */
  getPhysicsProcessDeltaTime(): number;
  /** Most recent host process step after Engine.time_scale, in seconds. */
  getProcessDeltaTime(): number;
  /** Godot 3 `SceneTree.set_input_as_handled()` for the event currently being delivered. */
  setInputAsHandled(): void;

  /**
   * Declare how this tree's running scene is re-mounted, which is the one
   * thing {@link SceneTree.reloadCurrentScene} cannot know.
   *
   * Godot's `SceneTree` owns a `current_scene` node it can free and re-stamp
   * from the `PackedScene` it came from. A translated port has no such object:
   * a `.tscn` became a CLASS, and what mounted it is the port's own world
   * setup. So the port hands over the thunk that redoes that — typically a
   * `queue_free` of what it built plus one `instanceScene()` and one
   * `addChild` — and this tree owns only the WHEN.
   */
  setSceneReloader(reload: () => void): void;
  /** Declare the world-owned mount-slot switch used by Godot 3 `change_scene(path)`. */
  setSceneChanger(change: (resPath: string) => void): void;
  /** Defer replacing the running scene with the translated PackedScene at `resPath`. */
  changeScene(resPath: string): number;
  /**
   * `get_tree().reload_current_scene()` — `squash-the-creeps` `Main.gd:14`,
   * the retry that restarts the run.
   *
   * Deferred to the end of the frame, which is Godot's own behaviour: the call
   * site is inside `_unhandled_input`, i.e. inside the frame whose scene is
   * about to be torn down, and tearing it down underneath its own input handler
   * is the hazard `deferred.ts` exists for.
   *
   * @throws if no reloader was declared. Godot returns an error code nobody
   * checks and leaves the game running, which reads as "the retry button does
   * nothing".
   */
  reloadCurrentScene(): void;

  /** `get_tree().quit(exit_code = 0)` — stop the translated player after this frame. */
  quit(exitCode?: number): void;

  /** `get_tree().create_timer(sec)` — a one-shot timer, already registered, that
   *  unregisters itself after it emits. */
  createTimer(
    seconds: number,
    processAlways?: boolean,
    processInPhysics?: boolean,
    ignoreTimeScale?: boolean,
  ): GodotTimer;
  /** Step `timer` on every `tick`. Returns the remover. */
  addTimer(timer: GodotTimer): () => void;
  /** Retain one non-render child in the real Godot tree topology. */
  registerNonDisplayChild(parent: object, child: object, siblingIndex?: number): () => void;
  /** Override renderer parenting with the exact authored Godot parent for a retained display node. */
  registerDisplayChild(parent: object, child: object, siblingIndex?: number): () => void;
  /** Deferred `Timer.queue_free()`. */
  queueFreeTimer(timer: GodotTimer): void;

  /**
   * `get_tree().create_tween()` — a Tween already registered, that unregisters
   * itself when its last tweener finishes. starter-kit-fps `player.gd:242`.
   */
  createTween(): GodotTween;
  getProcessedTweens(): readonly GodotTween[];
  /** Seat a Godot 3 Tween node in this tree's simulation-time stepping set. */
  addTween(tween: GodotTween): () => void;

  /** One frame: step timers, tweens, retained native frame state, then deferred calls and frees. */
  tick(dt: number, rawDt?: number): void;
  /**
   * Drain deferred calls and frees NOW, without stepping timers or tweens — the world calls
   * this at the END of its frame, which is where Godot's own `call_deferred` queue drains.
   * `tick` runs at the frame's TOP (timers before physics), so without this a
   * `reload_current_scene` requested during physics waited a whole extra tick before the
   * remount even began — measured on the starter kit's respawn: the fresh scene started one
   * tick later than the source engine's. Draining at frame end gives React's async commit the
   * whole inter-tick gap to land, so the fresh world processes the very next tick, as Godot's
   * does. Idempotent against `tick`'s own drain — an empty queue is a no-op.
   */
  flushDeferred(): void;
}

interface SceneTreeNavigationIndex {
  getNodesInGroup(group: string): readonly object[];
}

const NODE_SCENE_TREE = new WeakMap<object, SceneTreeNavigationIndex>();

/** The live SceneTree index used by NavigationMesh group-based source collection. */
export function godotSceneTreeNavigationIndex(node: object): SceneTreeNavigationIndex | undefined {
  return NODE_SCENE_TREE.get(node);
}

/** What {@link createSceneTree} needs from the port. */
export interface CreateSceneTreeOptions<TNode extends object = Container> {
  /** The stage every node path is resolved against. */
  readonly root: TNode;
  /** The mounted input system owns the current-event handled bit. */
  readonly setInputAsHandled?: () => void;
  /** Project-selected pinned runtime ClassDB metadata, present only when source queries ClassDB. */
  readonly classDb?: GodotClassDb;
  /** Exact parsed project.godot membership plus carried registered defaults. */
  readonly projectSettings?: GodotProjectSettingSeed;
}

/** Build the tree. One per mounted game. `TNode` is inferred from `root`, so a
 *  2D port writes `createSceneTree({ root: app.stage })` exactly as before and
 *  a 3D one writes `createSceneTree({ root: scene })`. */
export function createSceneTree<TNode extends object = Container>(
  options: CreateSceneTreeOptions<TNode>,
): SceneTree<TNode> {
  const deferred = createDeferredQueue();
  const groups = new Map<string, Map<TNode, GroupMethods | undefined>>();
  const runtimeNodeScripts = new Map<
    object,
    {
      readyTree(): void;
      physicsTree(delta: number): void;
      processTree(delta: number): void;
      dispose?(): void;
    }
  >();
  const rootChildren = new Map<string, object>();
  const registeredParents = new Map<object, object>();
  const registeredChildren = new Map<
    object,
    { readonly child: object; readonly siblingIndex?: number }[]
  >();
  const registeredNames = new Map<object, string>();
  const uniqueNodes = new Map<object, Map<string, object>>();
  const uniqueNameEnabled = new WeakSet<object>();
  const owners = new WeakMap<object, object>();
  const timers = new Set<GodotTimer>();
  const tweens = new Set<GodotTween>();
  const frameSteppers = new Set<(dt: number) => void>();
  const processFrame = createSignal<[]>();
  const physicsFrame = createSignal<[]>();
  const nodeAdded = createSignal<readonly [object]>();
  const nodeRemoved = createSignal<readonly [object]>();
  const treeChanged = createSignal<[]>();
  const sceneChanged = createSignal<[]>();
  const treeProcessModeChanged = createSignal<[]>();
  const nodeRenamed = createSignal<readonly [object]>();
  const nodeConfigurationWarningChanged = createSignal<readonly [object]>();
  const multiplayer = new GodotSceneMultiplayer();
  const offlineMultiplayerPeer = new GodotOfflineMultiplayerPeer();
  multiplayer.set_multiplayer_peer(offlineMultiplayerPeer);
  const multiplayerRoots = new Map<string, GodotMultiplayerAPI>([['/root', multiplayer]]);
  let multiplayerPoll = true;
  const multiplayerPath = (value: GodotNodePath | string): string =>
    typeof value === 'string' ? value || '/root' : godotNodePathString(value) || '/root';
  let reloader: (() => void) | undefined;
  let sceneChanger: ((resPath: string) => void) | undefined;
  let hasQuit = false;
  let exitCode = 0;
  let currentScene: TNode | null = null;
  let paused = false;
  let autoAcceptQuit = true;
  let quitOnGoBack = true;
  let debugCollisionsHint = false;
  let debugPathsHint = false;
  let debugNavigationHint = false;
  let physicsInterpolation = true;
  let frame = 0;
  let processDeltaTime = 0;
  let physicsProcessDeltaTime = 0;
  let unnamedNodeSerial = 0;

  const rendererParent = (node: object): object | null =>
    (node as { readonly parent?: object | null }).parent ?? null;
  const rendererChildren = (node: object): readonly object[] =>
    ((node as { readonly children?: readonly object[] }).children ?? []).filter(
      (child) => !isInternalCanvasChild(child) && !isInternalThreeChild(child),
    );
  const rendererName = (node: object): string => {
    const candidate = node as {
      readonly label?: unknown;
      readonly name?: unknown;
    };
    if (typeof candidate.label === 'string' && candidate.label.length > 0) return candidate.label;
    return typeof candidate.name === 'string' ? candidate.name : '';
  };
  const parentOf = (node: object): object | null => {
    if (node === options.root) return null;
    return registeredParents.get(node) ?? rendererParent(node);
  };
  const childrenOf = (node: object): readonly object[] => {
    const renderer = rendererChildren(node).filter((child) => {
      const authoredParent = registeredParents.get(child);
      return authoredParent === undefined || authoredParent === node;
    });
    const roots = node === options.root ? [...rootChildren.values()] : [];
    const registered = registeredChildren.get(node) ?? [];
    if (roots.length === 0 && registered.length === 0) return renderer;
    const merged = [...roots, ...renderer.filter((child) => !roots.includes(child))];
    for (const entry of registered) {
      const index = entry.siblingIndex ?? merged.length;
      merged.splice(Math.min(index, merged.length), 0, entry.child);
    }
    return merged;
  };
  const nameOf = (node: object): string => registeredNames.get(node) ?? rendererName(node);
  const uniqueNodeOf = (from: object, name: string): object | null => {
    // The nearest registered scene root in the receiver's ancestry is its owner document. This
    // preserves nested PackedScene ownership: the child scene's `%Name` table wins over its
    // instancing parent's table.
    let current: object | null = from;
    while (current !== null) {
      const candidate = uniqueNodes.get(current)?.get(name);
      if (candidate !== undefined) return candidate;
      current = parentOf(current);
    }
    return null;
  };
  const nodeAccess: NodeTreeAccess<object> = {
    parentOf,
    childrenOf,
    nameOf,
    uniqueNodeOf,
  };
  const nullableNode = (from: object, path: GodotNodePath | string): object | null =>
    resolveNodeOrNull(options.root, from, path, nameOf, nodeAccess);

  const isAncestorOf = (node: object, candidate: object): boolean => {
    let current = parentOf(candidate);
    while (current !== null) {
      if (current === node) return true;
      current = parentOf(current);
    }
    return false;
  };

  const ownerEntries = (node: object): Array<readonly [object, object]> => {
    const entries: Array<readonly [object, object]> = [];
    const visit = (current: object): void => {
      const owner = owners.get(current);
      if (owner !== undefined) entries.push([current, owner]);
      for (const child of childrenOf(current)) visit(child);
    };
    visit(node);
    return entries;
  };

  const clearInvalidOwners = (node: object): void => {
    for (const [owned, owner] of ownerEntries(node)) {
      if (!isAncestorOf(owner, owned)) {
        releaseUniqueName(owned);
        owners.delete(owned);
      }
    }
  };

  const match = (value: string, pattern: string): boolean => {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'u').test(value);
  };

  const uniqueNameOf = (owner: object | null, node: object): string | null => {
    if (owner === null) return null;
    for (const [name, candidate] of uniqueNodes.get(owner) ?? []) {
      if (candidate === node) return name;
    }
    return null;
  };

  const releaseUniqueName = (node: object): void => {
    for (const [owner, names] of uniqueNodes) {
      for (const [name, candidate] of names) {
        if (candidate === node) names.delete(name);
      }
      if (names.size === 0) uniqueNodes.delete(owner);
    }
  };

  const acquireUniqueName = (node: object): void => {
    if (!uniqueNameEnabled.has(node)) return;
    const owner = owners.get(node);
    if (owner === undefined) return;
    const name = nameOf(node);
    const names = uniqueNodes.get(owner) ?? new Map<string, object>();
    const claimed = names.get(name);
    if (claimed !== undefined && claimed !== node) {
      uniqueNameEnabled.delete(node);
      return;
    }
    names.set(name, node);
    uniqueNodes.set(owner, names);
  };

  const stepTweens = (dt: number, rawDt: number): void => {
    // Same seconds, same snapshot: a tween_callback may mint another tween.
    for (const tween of [...tweens]) {
      if (!tween.tick(dt, paused, rawDt)) tweens.delete(tween);
    }
  };

  const flushDeferredAndSweepGroups = (): void => {
    deferred.flush();
    // A freed node must not stay in a group: `call_group` would then call a
    // method closing over a destroyed node. Godot removes a freed node from
    // its groups as part of deletion; this is the same sweep, and it runs
    // after the flush that did the freeing. The queue is asked rather than
    // the node, because "am I destroyed" is a Pixi question and a three node
    // has no answer to it.
    for (const members of groups.values()) {
      for (const node of [...members.keys()]) {
        if (deferred.wasFreed(node)) members.delete(node);
      }
    }
  };

  const groupName = (value: unknown, member: string): string => {
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`godot-compat: ${member} requires a non-empty StringName group.`);
    }
    return value;
  };

  const groupMembersInTreeOrder = (
    members: ReadonlyMap<TNode, GroupMethods | undefined>,
  ): TNode[] => {
    const ordered: TNode[] = [];
    const visit = (node: TNode): void => {
      if (members.has(node)) ordered.push(node);
      for (const child of childrenOf(node) as readonly TNode[]) visit(child);
    };
    visit(options.root);
    return ordered;
  };

  const tree: SceneTree<TNode> = {
    root: options.root,
    projectSettings: createGodotProjectSettings(options.projectSettings ?? []),
    deferred,
    multiplayer,
    setMultiplayer(api, rootPath = '/root'): void {
      if (!(api instanceof GodotMultiplayerAPI)) {
        throw new TypeError('godot-compat: SceneTree.set_multiplayer requires MultiplayerAPI.');
      }
      const path = multiplayerPath(rootPath);
      if (path !== '/root' && !path.startsWith('/root/')) {
        throw new Error(
          'godot-compat: SceneTree multiplayer root_path must be /root or one of its descendants.',
        );
      }
      multiplayerRoots.set(path, api);
    },
    getMultiplayer(forPath = '/root'): GodotMultiplayerAPI {
      const path = multiplayerPath(forPath);
      let winner: GodotMultiplayerAPI | undefined;
      let winnerLength = -1;
      for (const [rootPath, api] of multiplayerRoots) {
        if (path !== rootPath && !path.startsWith(`${rootPath}/`)) continue;
        if (rootPath.length <= winnerLength) continue;
        winner = api;
        winnerLength = rootPath.length;
      }
      if (winner === undefined)
        throw new Error(`godot-compat: no MultiplayerAPI owns SceneTree path ${path}.`);
      return winner;
    },
    get multiplayerPoll(): boolean {
      return multiplayerPoll;
    },
    set multiplayerPoll(enabled: boolean) {
      if (typeof enabled !== 'boolean')
        throw new TypeError('godot-compat: SceneTree.multiplayer_poll requires bool.');
      multiplayerPoll = enabled;
    },
    setMultiplayerPollEnabled(enabled): void {
      this.multiplayerPoll = enabled;
    },
    isMultiplayerPollEnabled(): boolean {
      return this.multiplayerPoll;
    },
    setNetworkPeer(peer): void {
      multiplayer.set_multiplayer_peer(peer ?? offlineMultiplayerPeer);
    },
    getNetworkPeer(): GodotMultiplayerPeer | null {
      const peer = multiplayer.get_multiplayer_peer();
      return peer === offlineMultiplayerPeer ? null : peer;
    },
    get hasQuit(): boolean {
      return hasQuit;
    },
    get exitCode(): number {
      return exitCode;
    },
    get currentScene(): TNode | null {
      return currentScene;
    },
    set currentScene(scene: TNode | null) {
      if (scene !== null && parentOf(scene) !== options.root) {
        throw new Error(
          'godot-compat: SceneTree.current_scene must be null or a direct child of the root Window.',
        );
      }
      currentScene = scene;
      sceneChanged.emit();
    },
    get paused(): boolean {
      return paused;
    },
    set paused(value: boolean) {
      if (typeof value !== 'boolean')
        throw new TypeError('godot-compat: SceneTree.paused requires a boolean.');
      paused = value;
    },
    processFrame: processFrame.signal,
    physicsFrame: physicsFrame.signal,
    nodeAdded: nodeAdded.signal,
    nodeRemoved: nodeRemoved.signal,
    treeChanged: treeChanged.signal,
    sceneChanged: sceneChanged.signal,
    treeProcessModeChanged: treeProcessModeChanged.signal,
    nodeRenamed: nodeRenamed.signal,
    nodeConfigurationWarningChanged: nodeConfigurationWarningChanged.signal,
    get autoAcceptQuit(): boolean {
      return autoAcceptQuit;
    },
    set autoAcceptQuit(enabled: boolean) {
      if (typeof enabled !== 'boolean') {
        throw new TypeError('godot-compat: SceneTree.auto_accept_quit requires bool.');
      }
      autoAcceptQuit = enabled;
    },
    setAutoAcceptQuit(enabled): void {
      this.autoAcceptQuit = enabled;
    },
    isAutoAcceptQuit(): boolean {
      return autoAcceptQuit;
    },
    get quitOnGoBack(): boolean {
      return quitOnGoBack;
    },
    set quitOnGoBack(enabled: boolean) {
      if (typeof enabled !== 'boolean')
        throw new TypeError('godot-compat: SceneTree.quit_on_go_back requires bool.');
      quitOnGoBack = enabled;
    },
    get debugCollisionsHint(): boolean {
      return debugCollisionsHint;
    },
    set debugCollisionsHint(enabled: boolean) {
      if (typeof enabled !== 'boolean')
        throw new TypeError('godot-compat: SceneTree.debug_collisions_hint requires bool.');
      debugCollisionsHint = enabled;
    },
    get debugPathsHint(): boolean {
      return debugPathsHint;
    },
    set debugPathsHint(enabled: boolean) {
      if (typeof enabled !== 'boolean')
        throw new TypeError('godot-compat: SceneTree.debug_paths_hint requires bool.');
      debugPathsHint = enabled;
    },
    get debugNavigationHint(): boolean {
      return debugNavigationHint;
    },
    set debugNavigationHint(enabled: boolean) {
      if (typeof enabled !== 'boolean')
        throw new TypeError('godot-compat: SceneTree.debug_navigation_hint requires bool.');
      debugNavigationHint = enabled;
    },
    get physicsInterpolation(): boolean {
      return physicsInterpolation;
    },
    set physicsInterpolation(enabled: boolean) {
      if (typeof enabled !== 'boolean')
        throw new TypeError('godot-compat: SceneTree.physics_interpolation requires bool.');
      physicsInterpolation = enabled;
    },
    isAccessibilitySupported(): boolean {
      return false;
    },
    isAccessibilityEnabled(): boolean {
      return false;
    },
    get editedSceneRoot(): null {
      return null;
    },

    registerRootChild(name, node): () => void {
      const prior = rootChildren.get(name);
      if (prior !== undefined && prior !== node) {
        throw new Error(
          `godot-compat: /root already has a child named "${name}"; an autoload cannot replace it.`,
        );
      }
      rootChildren.set(name, node);
      registeredParents.set(node, options.root);
      registeredNames.set(node, name);
      this.enteredNode(node);
      return () => {
        if (TREE_INSIDE.has(node)) {
          this.detachingNode(node);
          this.detachedNode(node);
        }
        if (rootChildren.get(name) === node) rootChildren.delete(name);
        registeredParents.delete(node);
        registeredNames.delete(node);
      };
    },

    registerUniqueNode(owner, name, node): () => void {
      const owned = uniqueNodes.get(owner) ?? new Map<string, object>();
      const prior = owned.get(name);
      if (prior !== undefined && prior !== node) {
        throw new Error(
          `godot-compat: scene owner registered two nodes as %${name}; Godot requires one.`,
        );
      }
      owned.set(name, node);
      uniqueNodes.set(owner, owned);
      uniqueNameEnabled.add(node);
      return () => {
        if (owned.get(name) === node) owned.delete(name);
        if (owned.size === 0) uniqueNodes.delete(owner);
        uniqueNameEnabled.delete(node);
      };
    },

    isUniqueNameInOwner(node): boolean {
      return uniqueNameEnabled.has(node);
    },

    setUniqueNameInOwner(node, enabled): void {
      if (typeof enabled !== 'boolean') {
        throw new TypeError('godot-compat: Node.unique_name_in_owner requires bool.');
      }
      releaseUniqueName(node);
      if (!enabled) {
        uniqueNameEnabled.delete(node);
        return;
      }
      uniqueNameEnabled.add(node);
      acquireUniqueName(node);
    },

    getNodeOrNull(from, path): object | null {
      return nullableNode(from, path);
    },

    getNode(from, path): object {
      const node = nullableNode(from, path);
      if (node !== null) return node;
      throw new Error(`godot-compat: get_node(${JSON.stringify(String(path))}) found no node.`);
    },

    hasNode(from, path): boolean {
      return hasNodePath(options.root, from, path, nameOf, nodeAccess);
    },

    isInsideTree(node): boolean {
      return isNodeInsideTree(options.root, node, parentOf);
    },

    getNodePath(node): GodotNodePath {
      return nodePathInTree(options.root, node, nameOf, parentOf);
    },

    getChildren(node): readonly object[] {
      return [...childrenOf(node)];
    },

    getChild(node, index): object | null {
      const children = childrenOf(node);
      const resolved = index < 0 ? children.length + index : index;
      return children[resolved] ?? null;
    },

    getChildCount(node): number {
      return childrenOf(node).length;
    },

    findChild(from, pattern, recursive = true, owned = true): object | null {
      if (pattern.length === 0) return null;
      for (const child of childrenOf(from)) {
        // node.cpp continues immediately for an unowned child, so `owned=true` excludes that
        // child's whole subtree as well as the child itself.
        if (owned && !owners.has(child)) continue;
        if (match(nameOf(child), pattern)) return child;
        if (recursive) {
          const nested = this.findChild(child, pattern, true, owned);
          if (nested !== null) return nested;
        }
      }
      return null;
    },

    findParent(from, pattern): object | null {
      let current = parentOf(from);
      while (current !== null) {
        if (match(nameOf(current), pattern)) return current;
        current = parentOf(current);
      }
      return null;
    },

    getIndex(node): number {
      const parent = parentOf(node);
      return parent === null ? -1 : childrenOf(parent).indexOf(node);
    },

    getPathTo(from, target, useUniquePath = false): GodotNodePath {
      if (from === target) return godotNodePathNew('.');
      const fromAncestors = new Set<object>();
      for (let current: object | null = from; current !== null; current = parentOf(current)) {
        fromAncestors.add(current);
      }
      let common: object | null = target;
      while (common !== null && !fromAncestors.has(common)) common = parentOf(common);
      if (common === null) return godotNodePathNew();

      const path: string[] = [];
      if (useUniquePath) {
        const fromOwner = owners.get(from) ?? null;
        let current: object | null = target;
        let detected = false;
        while (current !== null && current !== common) {
          const unique = uniqueNameOf(owners.get(current) ?? null, current);
          if (unique !== null && owners.get(current) === fromOwner) {
            path.push(`%${unique}`);
            detected = true;
            break;
          }
          path.push(nameOf(current));
          current = parentOf(current);
        }
        if (!detected) {
          current = from;
          let detectedName: string | null = null;
          let upCount = 0;
          while (current !== null && current !== common) {
            const unique = uniqueNameOf(owners.get(current) ?? null, current);
            if (unique !== null && owners.get(current) === fromOwner) {
              detectedName = unique;
              upCount = 0;
            }
            upCount++;
            current = parentOf(current);
          }
          for (let index = 0; index < upCount; index++) path.push('..');
          if (detectedName !== null) path.push(`%${detectedName}`);
        }
      } else {
        for (
          let current: object | null = target;
          current !== null && current !== common;
          current = parentOf(current)
        ) {
          path.push(nameOf(current));
        }
        for (
          let current: object | null = from;
          current !== null && current !== common;
          current = parentOf(current)
        ) {
          path.push('..');
        }
      }
      path.reverse();
      return godotNodePathNew(path.join('/'));
    },

    isAncestorOf,

    isGreaterThan(node, other): boolean {
      const order: object[] = [];
      const visit = (current: object): void => {
        order.push(current);
        for (const child of childrenOf(current)) visit(child);
      };
      visit(options.root);
      const left = order.indexOf(node);
      const right = order.indexOf(other);
      if (left < 0 || right < 0) {
        throw new Error(
          'godot-compat: Node.is_greater_than requires both Nodes to be inside this SceneTree.',
        );
      }
      return left > right;
    },

    getOwner(node): object | null {
      return owners.get(node) ?? null;
    },

    setOwner(node, owner): void {
      releaseUniqueName(node);
      owners.delete(node);
      if (owner === null) return;
      if (owner === node || !isAncestorOf(owner, node)) {
        throw new Error('godot-compat: Node owner must be an ancestor in the tree.');
      }
      owners.set(node, owner);
      acquireUniqueName(node);
    },

    reparentNode(node, parent, apply): void {
      const priorOwners = ownerEntries(node);
      apply();
      clearInvalidOwners(node);
      for (const [owned, owner] of priorOwners) {
        if (owner === parent || isAncestorOf(owner, parent)) owners.set(owned, owner);
      }
    },

    enteredNode(node): void {
      if (!this.isInsideTree(node)) {
        throw new Error(
          'godot-compat: tree_entered requires a Node attached beneath this SceneTree root.',
        );
      }
      if (TREE_INSIDE.has(node)) return;
      TREE_INSIDE.add(node);
      NODE_SCENE_TREE.set(node, this);
      lifecycleSignalOf(TREE_ENTERED, node).emit();
      nodeAdded.emit(node);
      treeChanged.emit();
      const parent = parentOf(node);
      if (parent !== null && TREE_INSIDE.has(parent)) {
        let childEntered = CHILD_ENTERED_TREE.get(parent);
        if (childEntered === undefined) {
          childEntered = createSignal<readonly [object]>();
          CHILD_ENTERED_TREE.set(parent, childEntered);
        }
        childEntered.emit(node);
        lifecycleSignalOf(CHILD_ORDER_CHANGED, parent).emit();
      }
      for (const child of [...childrenOf(node)]) this.enteredNode(child);
      const runtimeScript = runtimeNodeScripts.get(node);
      if (runtimeScript !== undefined && !isNodeReady(node)) runtimeScript.readyTree();
    },

    bindRuntimeNodeScript(node, script): () => void {
      const existing = runtimeNodeScripts.get(node);
      if (existing !== undefined && existing !== script) {
        throw new Error('godot-compat: one native Node cannot own two runtime ScriptInstances.');
      }
      runtimeNodeScripts.set(node, script);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (runtimeNodeScripts.get(node) === script) runtimeNodeScripts.delete(node);
      };
    },

    detachingNode(node): void {
      // Node::_propagate_exit_tree marks one exit transition and walks children back-to-front
      // before this node's tree_exiting signal. Mark first so a signal callback which removes the
      // same node cannot recursively emit tree_exiting a second time.
      if (!TREE_INSIDE.has(node) || EXITING_EMITTED.has(node)) return;
      EXITING_EMITTED.add(node);
      const children = [...childrenOf(node)];
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child !== undefined) this.detachingNode(child);
      }
      NODE_EXIT_CALLBACKS.get(node)?.();
      lifecycleSignalOf(TREE_EXITING, node).emit();
      const parent = parentOf(node);
      if (parent !== null && TREE_INSIDE.has(parent))
        childSignalOf(CHILD_EXITING_TREE, parent).emit(node);
    },

    detachedNode(node): void {
      if (!EXITING_EMITTED.has(node)) this.detachingNode(node);
      for (const child of [...childrenOf(node)]) {
        this.detachedNode(child);
        (child as { exitTree?: () => void }).exitTree?.();
      }
      clearInvalidOwners(node);
      lifecycleSignalOf(TREE_EXITED, node).emit();
      nodeRemoved.emit(node);
      treeChanged.emit();
      TREE_INSIDE.delete(node);
      NODE_SCENE_TREE.delete(node);
      EXITING_EMITTED.delete(node);
      const parent = parentOf(node);
      if (parent !== null && TREE_INSIDE.has(parent))
        lifecycleSignalOf(CHILD_ORDER_CHANGED, parent).emit();
    },

    addToGroup(group, node, methods, persistent = false): void {
      const name = groupName(group, 'Node.add_to_group');
      if (typeof persistent !== 'boolean') {
        throw new TypeError(
          `godot-compat: Node.add_to_group persistent requires bool; got ${typeof persistent}.`,
        );
      }
      const members = groups.get(name) ?? new Map<TNode, GroupMethods | undefined>();
      // Godot's groups are sets. Re-adding an existing member is a no-op; in particular, a
      // runtime `add_to_group` must not erase the source-emitted method table used by call_group.
      if (!members.has(node) || methods !== undefined) members.set(node, methods);
      groups.set(name, members);
    },

    removeFromGroup(group, node): void {
      groups.get(groupName(group, 'Node.remove_from_group'))?.delete(node);
    },

    getGroups(node): readonly string[] {
      const result: string[] = [];
      for (const [name, members] of groups) {
        if (members.has(node)) result.push(name);
      }
      return result;
    },

    isInGroup(group, node): boolean {
      if (typeof group !== 'string') {
        throw new TypeError('godot-compat: Node.is_in_group requires a StringName group.');
      }
      // Node::is_in_group performs a membership lookup without add_to_group's non-empty guard;
      // the empty StringName therefore simply has no membership.
      if (group.length === 0) return false;
      return groups.get(group)?.has(node) ?? false;
    },

    getNodesInGroup(group): readonly TNode[] {
      const members = groups.get(groupName(group, 'SceneTree.get_nodes_in_group'));
      return members === undefined ? [] : groupMembersInTreeOrder(members);
    },

    hasGroup(group): boolean {
      const members = groups.get(groupName(group, 'SceneTree.has_group'));
      return members !== undefined && members.size > 0;
    },

    getFirstNodeInGroup(group): TNode | null {
      const members = groups.get(groupName(group, 'SceneTree.get_first_node_in_group'));
      if (members === undefined) return null;
      return groupMembersInTreeOrder(members)[0] ?? null;
    },

    getNodeCount(): number {
      let count = 0;
      const visit = (node: object): void => {
        count += 1;
        for (const child of childrenOf(node)) visit(child);
      };
      visit(options.root);
      return count;
    },

    getNodeCountInGroup(group): number {
      return this.getNodesInGroup(group).length;
    },

    getFrame(): number {
      return frame;
    },

    unloadCurrentScene(): void {
      const outgoing = currentScene;
      if (outgoing === null) return;
      deferred.setDeferred(() => {
        if (currentScene === outgoing) currentScene = null;
        sceneChanged.emit();
      });
    },

    notifyNodeRenamed(node): void {
      releaseUniqueName(node);
      acquireUniqueName(node);
      lifecycleSignalOf(NODE_RENAMED, node).emit();
      nodeRenamed.emit(node);
      treeChanged.emit();
    },

    notifyChildOrderChanged(parent): void {
      lifecycleSignalOf(CHILD_ORDER_CHANGED, parent).emit();
      treeChanged.emit();
    },

    notifyNodeConfigurationWarningChanged(node): void {
      nodeConfigurationWarningChanged.emit(node);
    },

    notifyTreeProcessModeChanged(): void {
      treeProcessModeChanged.emit();
    },

    getTreeString(node, pretty = false): string {
      if (typeof pretty !== 'boolean') {
        throw new TypeError('godot-compat: Node.get_tree_string pretty requires a bool.');
      }
      if (!pretty) {
        const lines: string[] = [];
        const visit = (current: object, path: string): void => {
          lines.push(path);
          for (const child of childrenOf(current)) visit(child, `${path}/${nameOf(child)}`);
        };
        visit(node, nameOf(node));
        return lines.join('\n');
      }
      const lines: string[] = [`┖╴${nameOf(node)}`];
      const visit = (current: object, prefix: string): void => {
        const children = childrenOf(current);
        children.forEach((child, index) => {
          const last = index === children.length - 1;
          lines.push(`${prefix}${last ? '┖' : '┠'}╴${nameOf(child)}`);
          visit(child, `${prefix}${last ? '  ' : '┃ '}`);
        });
      };
      visit(node, '  ');
      return lines.join('\n');
    },

    printTree(node, pretty = false): void {
      console.log(this.getTreeString(node, pretty));
    },

    callGroup(group, method, ...args): number {
      const members = groups.get(group);
      if (members === undefined) return 0;
      let called = 0;
      // Snapshot: `queue_free` is the pilot's own call and it mutates the
      // group through the freed-node sweep in `tick`. Iterating the live map
      // while it changes is how a "some mobs survived" bug is built.
      for (const [node, methods] of [...members]) {
        const fn = methods?.[method];
        if (fn === undefined && methods !== undefined) {
          throw new Error(
            `godot-compat: call_group("${group}", "${method}") reached a member with no ` +
              `"${method}" method (${called} member(s) called first). A node joins a group with ` +
              'the methods the group may call — pass it in addToGroup(tree, group, node, ' +
              '{ [method]: … }). Godot skips such a member silently; a port that does the same ' +
              'looks like the group is empty.',
          );
        }
        if (fn === undefined) godotObjectCall(node, [method, ...args]);
        else fn(...args);
        called++;
      }
      return called;
    },

    emitProcessFrame(): void {
      processFrame.emit();
    },

    emitPhysicsFrame(dt): void {
      if (!Number.isFinite(dt) || dt < 0) {
        throw new RangeError(
          `godot-compat: SceneTree physics delta must be finite and non-negative; received ${String(dt)}.`,
        );
      }
      physicsProcessDeltaTime = dt;
      for (const timer of [...timers]) timer.tick(dt, dt, 'physics', paused);
      for (const [node, script] of [...runtimeNodeScripts]) {
        if (TREE_INSIDE.has(node)) script.physicsTree(dt);
      }
      physicsFrame.emit();
    },

    getPhysicsProcessDeltaTime(): number {
      return physicsProcessDeltaTime;
    },

    getProcessDeltaTime(): number {
      return processDeltaTime;
    },
    setInputAsHandled(): void {
      if (options.setInputAsHandled === undefined) {
        throw new Error(
          'godot-compat: SceneTree.set_input_as_handled requires the mounted Godot input owner.',
        );
      }
      options.setInputAsHandled();
    },

    setSceneReloader(reload): void {
      reloader = reload;
    },

    setSceneChanger(change): void {
      sceneChanger = change;
    },

    changeScene(resPath): number {
      if (
        typeof resPath !== 'string' ||
        !resPath.startsWith('res://') ||
        !resPath.endsWith('.tscn')
      ) {
        throw new TypeError('godot-compat: SceneTree.change_scene requires a res://*.tscn path.');
      }
      const change = sceneChanger;
      if (change === undefined) {
        throw new Error(
          'godot-compat: change_scene() has no world-owned translated scene mount slot.',
        );
      }
      deferred.setDeferred(() => change(resPath));
      return 0;
    },

    reloadCurrentScene(): void {
      const reload = reloader;
      if (reload === undefined) {
        throw new Error(
          'godot-compat: reload_current_scene() has no reloader. A translated .tscn is a CLASS, ' +
            'not a PackedScene this tree can re-stamp, so the port declares how its world is ' +
            're-mounted with tree.setSceneReloader(() => …). Godot fails this silently.',
        );
      }
      deferred.setDeferred(reload);
    },

    quit(code = 0): void {
      exitCode = code;
      hasQuit = true;
    },

    createTimer(
      seconds,
      processAlways = true,
      processInPhysics = false,
      ignoreTimeScale = false,
    ): GodotTimer {
      if (typeof processAlways !== 'boolean') {
        throw new TypeError('godot-compat: SceneTree.create_timer process_always requires bool.');
      }
      if (typeof processInPhysics !== 'boolean') {
        throw new TypeError(
          'godot-compat: SceneTree.create_timer process_in_physics requires bool.',
        );
      }
      if (typeof ignoreTimeScale !== 'boolean') {
        throw new TypeError(
          'godot-compat: SceneTree.create_timer ignore_time_scale requires bool.',
        );
      }
      const timer = createTimer({
        waitTime: seconds,
        oneShot: true,
        autostart: true,
        processAlways,
        processInPhysics,
        ignoreTimeScale,
      });
      timers.add(timer);
      timer.enterTree(this, options.root, () => timers.delete(timer));
      // Godot's SceneTreeTimer frees itself after it emits. Nothing else holds
      // it, so dropping it from the step set is the whole of that.
      timer.timeout.connect(() => timer.exitTree(), { oneShot: true });
      return timer;
    },

    addTimer(timer): () => void {
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },

    registerNonDisplayChild(parent, child, siblingIndex): () => void {
      if (registeredParents.has(child)) {
        throw new Error('godot-compat: a non-display Node cannot have two parents.');
      }
      if (siblingIndex !== undefined && (!Number.isSafeInteger(siblingIndex) || siblingIndex < 0)) {
        throw new RangeError(
          `godot-compat: non-display sibling index must be a non-negative safe integer; got ${String(siblingIndex)}.`,
        );
      }
      const children = registeredChildren.get(parent) ?? [];
      const named = child as { name?: string };
      if (named.name === '') named.name = `@Timer@${++unnamedNodeSerial}`;
      const entry: { readonly child: object; readonly siblingIndex?: number } =
        siblingIndex === undefined ? { child } : { child, siblingIndex };
      children.push(entry);
      children.sort(
        (a, b) =>
          (a.siblingIndex ?? Number.MAX_SAFE_INTEGER) - (b.siblingIndex ?? Number.MAX_SAFE_INTEGER),
      );
      registeredChildren.set(parent, children);
      registeredParents.set(child, parent);
      // Topology reachability is not lifecycle entry: a renderer parent may already be mounted
      // beneath the stage while its owning PackedScene is still propagating ENTER_TREE. Godot
      // enters the child only after the exact parent has entered.
      if (TREE_INSIDE.has(parent)) this.enteredNode(child);
      return () => {
        if (TREE_INSIDE.has(child)) {
          this.detachingNode(child);
          this.detachedNode(child);
        }
        registeredParents.delete(child);
        const index = children.indexOf(entry);
        if (index >= 0) children.splice(index, 1);
        if (children.length === 0) registeredChildren.delete(parent);
      };
    },

    registerDisplayChild(parent, child, siblingIndex): () => void {
      if (registeredParents.has(child)) {
        throw new Error('godot-compat: an authored display Node cannot have two parents.');
      }
      if (siblingIndex !== undefined && (!Number.isSafeInteger(siblingIndex) || siblingIndex < 0)) {
        throw new RangeError(
          `godot-compat: authored display sibling index must be a non-negative safe integer; got ${String(siblingIndex)}.`,
        );
      }
      const children = registeredChildren.get(parent) ?? [];
      const entry: { readonly child: object; readonly siblingIndex?: number } =
        siblingIndex === undefined ? { child } : { child, siblingIndex };
      children.push(entry);
      children.sort(
        (a, b) =>
          (a.siblingIndex ?? Number.MAX_SAFE_INTEGER) - (b.siblingIndex ?? Number.MAX_SAFE_INTEGER),
      );
      registeredChildren.set(parent, children);
      registeredParents.set(child, parent);
      if (TREE_INSIDE.has(parent)) this.enteredNode(child);
      return () => {
        if (TREE_INSIDE.has(child)) {
          this.detachingNode(child);
          this.detachedNode(child);
        }
        registeredParents.delete(child);
        const index = children.indexOf(entry);
        if (index >= 0) children.splice(index, 1);
        if (children.length === 0) registeredChildren.delete(parent);
      };
    },

    queueFreeTimer(timer): void {
      deferred.queueFree(timer, () => timer.exitTree());
    },

    createTween(): GodotTween {
      const tween = createTween();
      this.addTween(tween);
      return tween;
    },

    getProcessedTweens(): readonly GodotTween[] {
      return [...tweens];
    },

    addTween(tween): () => void {
      tweens.add(tween);
      return () => tweens.delete(tween);
    },

    addFrameStepper(step): () => void {
      frameSteppers.add(step);
      return () => frameSteppers.delete(step);
    },

    flushDeferred(): void {
      flushDeferredAndSweepGroups();
    },

    tick(dt, rawDt = dt): void {
      frame += 1;
      if (multiplayerPoll) {
        for (const api of new Set(multiplayerRoots.values())) {
          if (api.has_multiplayer_peer()) api.poll();
        }
      }
      if (!Number.isFinite(dt) || dt < 0) {
        throw new RangeError(
          `godot-compat: SceneTree process delta must be finite and non-negative; received ${String(dt)}.`,
        );
      }
      if (!Number.isFinite(rawDt) || rawDt < 0) {
        throw new RangeError(
          `godot-compat: SceneTree raw process delta must be finite and non-negative; received ${String(rawDt)}.`,
        );
      }
      processDeltaTime = dt;
      // Snapshot: a `timeout` listener may add or remove a timer, and
      // `createTimer`'s self-removal does exactly that mid-iteration.
      for (const timer of [...timers]) timer.tick(dt, rawDt, 'idle', paused);
      stepTweens(dt, rawDt);
      for (const step of [...frameSteppers]) step(dt);
      for (const [node, script] of [...runtimeNodeScripts]) {
        if (TREE_INSIDE.has(node)) script.processTree(dt);
      }
      flushDeferredAndSweepGroups();
    },
  };
  RETAINED_SCENE_TREES.add(tree);
  if (options.classDb !== undefined) bindGodotClassDb(tree, options.classDb);
  return tree;
}
