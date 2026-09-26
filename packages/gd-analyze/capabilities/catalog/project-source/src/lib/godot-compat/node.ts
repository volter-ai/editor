/**
 * @godot-class Node
 * @role PROTOCOL
 *
 * Godot 4.7's `Node`: tree membership, names, groups, the enter/ready/exit propagation, processing
 * flags and modes, and the members that read and change the tree, transcribed from
 * `scene/main/node.cpp` at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`.
 *
 * A node is its native entity: a `THREE.Object3D` (a plain `Node` is a `Group` compat marks
 * non-spatial, so Node3D's parent rule skips it). Its parent and children are three's own links
 * and its name is the Object3D's `name`; everything else Godot keeps on a Node lives in `NODE`,
 * keyed by the entity: the script binding (the generated script instance and its callbacks),
 * groups, tree membership, ready state, processing flags, process mode and priority, and the
 * hierarchy authority that owns the entity's attachment.
 *
 * A scripted node's Godot object is its script instance: members accept the instance or the
 * entity, and members that return a node (`get_parent`, `get_children`, `get_node`) return the
 * instance when one is bound, else the entity.
 *
 * Tree changes go through the entity's hierarchy authority when it has one (an instanced scene's
 * nodes, which the composition site renders), else attach imperatively (a node made with
 * `Class.new()`). The authority must attach and detach synchronously, as Godot's `add_child` does.
 */

import type { Object3D } from 'three';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { get_root, godot_tree, godot_tree_process_delta, queue_delete, type SceneTree } from './scene-tree';

/** The native entity's hierarchy operations for nodes the composition site renders. */
export interface NativeHierarchyAuthority {
  create(kind: string): object;
  attach(parent: object, child: object): void;
  detach(parent: object, child: object): void;
  destroy(entity: object): void;
}

export interface GodotNodeProcessMethods {
  readonly process?: boolean;
  readonly physicsProcess?: boolean;
  readonly input?: boolean;
  readonly unhandledInput?: boolean;
  readonly unhandledKeyInput?: boolean;
}

/**
 * One generated script attachment seated on its native entity: the script instance (`owner`) and
 * the Godot virtuals it overrides.
 */
export interface GodotScriptLifecycleBinding {
  readonly native: object;
  readonly owner: object;
  readonly enterTree?: () => void;
  readonly ready?: () => void;
  readonly exitTree?: () => void;
  readonly process?: (delta: number) => void;
  readonly physicsProcess?: (delta: number) => void;
}

interface NodeState {
  binding: GodotScriptLifecycleBinding | undefined;
  methods: GodotNodeProcessMethods;
  kind: 'node' | 'spatial';
  authority: NativeHierarchyAuthority | undefined;
  groups: string[];
  insideTree: boolean;
  readyFirst: boolean;
  readyNotified: boolean;
  queued: boolean;
  freed: boolean;
  process: boolean;
  physicsProcess: boolean;
  input: boolean;
  unhandledInput: boolean;
  unhandledKeyInput: boolean;
  processMode: number;
  processPriority: number;
  physicsProcessPriority: number;
  ready: SignalHandle<[]>;
}

const NODE = new WeakMap<object, NodeState>();
const NATIVE_OF_OWNER = new WeakMap<object, object>();
let serial = 1;

/** Godot 4's Node.ProcessMode namespace. */
const PROCESS_MODE_INHERIT = 0;
const PROCESS_MODE_PAUSABLE = 1;
const PROCESS_MODE_WHEN_PAUSED = 2;
const PROCESS_MODE_ALWAYS = 3;
const PROCESS_MODE_DISABLED = 4;

function native(node: unknown, member: string): object {
  if ((typeof node !== 'object' || node === null) && typeof node !== 'function') {
    throw new TypeError(`godot-compat: Node.${member} requires a Node receiver.`);
  }
  return NATIVE_OF_OWNER.get(node as object) ?? (node as object);
}

function fresh(): NodeState {
  return {
    binding: undefined,
    methods: {},
    kind: 'spatial',
    authority: undefined,
    groups: [],
    insideTree: false,
    readyFirst: true,
    readyNotified: false,
    queued: false,
    freed: false,
    process: false,
    physicsProcess: false,
    input: false,
    unhandledInput: false,
    unhandledKeyInput: false,
    processMode: PROCESS_MODE_INHERIT,
    processPriority: 0,
    physicsProcessPriority: 0,
    ready: createSignal<[]>(),
  };
}

function stateOf(entity: object): NodeState {
  let state = NODE.get(entity);
  if (state === undefined) {
    state = fresh();
    NODE.set(entity, state);
  }
  return state;
}

function nodeState(node: unknown, member: string): NodeState {
  return stateOf(native(node, member));
}

/** The Godot object of an entity: its script instance when one is bound. */
function objectOf(entity: object): object {
  return NODE.get(entity)?.binding?.owner ?? entity;
}

function parentEntity(entity: object): object | null {
  return (entity as Object3D).parent ?? null;
}

function childEntities(entity: object): readonly object[] {
  return (entity as Object3D).children ?? [];
}

function nameOf(entity: object): string {
  return (entity as { name?: string }).name ?? '';
}

// --- Protocol: the composition site's entry points.

/**
 * Registers an entity as a Godot node: `kind` `node` marks a plain Node (non-spatial), the
 * optional binding seats its script, and the optional authority owns its attachment.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:4092
 */
export function godot_node_adopt(
  entity: object,
  options: {
    readonly kind?: 'node' | 'spatial';
    readonly binding?: Omit<GodotScriptLifecycleBinding, 'native'>;
    readonly authority?: NativeHierarchyAuthority;
  } = {},
): object {
  const state = stateOf(entity);
  if (options.kind !== undefined) state.kind = options.kind;
  if (options.authority !== undefined) state.authority = options.authority;
  if (options.binding !== undefined) {
    const binding = { ...options.binding, native: entity };
    state.binding = binding;
    state.methods = Object.freeze({
      process: binding.process !== undefined,
      physicsProcess: binding.physicsProcess !== undefined,
    });
    NATIVE_OF_OWNER.set(binding.owner, entity);
  }
  return objectOf(entity);
}

/**
 * Whether an entity is a plain Node (not a Node3D): Node3D's parent rule reads it.
 *
 * @godot Node (protocol)
 * @source scene/3d/node_3d.cpp:157
 */
export function godot_node_is_spatial(entity: object): boolean {
  return NODE.get(entity)?.kind !== 'node';
}

/**
 * Marks the tree root inside the tree (`SceneTree::initialize`, `scene/main/scene_tree.cpp:590`).
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:590
 */
export function godot_node_enter_root(root: object): void {
  const state = stateOf(root);
  state.kind = 'node';
  state.insideTree = true;
  state.readyNotified = true;
  state.readyFirst = false;
}

/**
 * The entity's script binding, and whether it is inside the tree: SceneTree's processing reads them.
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1177
 */
export function godot_node_processing(entity: object): {
  readonly binding: GodotScriptLifecycleBinding | undefined;
  readonly insideTree: boolean;
  readonly process: boolean;
  readonly physicsProcess: boolean;
  readonly canProcess: boolean;
  readonly processPriority: number;
  readonly physicsProcessPriority: number;
} | undefined {
  const state = NODE.get(entity);
  if (state === undefined) return undefined;
  return {
    binding: state.binding,
    insideTree: state.insideTree,
    process: state.process,
    physicsProcess: state.physicsProcess,
    canProcess: processModeAllows(entity, state, false),
    processPriority: state.processPriority,
    physicsProcessPriority: state.physicsProcessPriority,
  };
}

/**
 * Frees a queued node: removed from its parent (its subtree exits the tree), then its children
 * freed from the last (`NOTIFICATION_PREDELETE`, `scene/main/node.cpp:298`).
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:298
 */
export function godot_node_free(entity: object): void {
  const state = NODE.get(entity);
  const parent = parentEntity(entity);
  if (parent !== null && NODE.has(parent)) removeChild(parent, entity);
  else if (parent !== null) detach(parent, entity);
  const children = [...childEntities(entity)];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index] as object;
    if (NODE.has(child)) godot_node_free(child);
  }
  state?.authority?.destroy(entity);
  if (state !== undefined) {
    state.queued = false;
    state.freed = true;
  }
}

/**
 * Whether a node (by entity or script instance) has been freed: a deferred call to it is dropped
 * (`CallQueue::flush`, `core/object/message_queue.cpp:264`).
 *
 * @godot Node (protocol)
 * @source core/object/message_queue.cpp:264
 */
export function godot_node_is_freed(object: object): boolean {
  return NODE.get(NATIVE_OF_OWNER.get(object) ?? object)?.freed ?? false;
}

// --- Propagation.

function attach(parent: object, child: object): void {
  const authority = NODE.get(child)?.authority;
  if (authority !== undefined) authority.attach(parent, child);
  else (parent as Object3D).add(child as Object3D);
}

function detach(parent: object, child: object): void {
  const authority = NODE.get(child)?.authority;
  if (authority !== undefined) authority.detach(parent, child);
  else (parent as Object3D).remove(child as Object3D);
}

/** `_propagate_enter_tree` (`scene/main/node.cpp:341`): self, then children. */
function propagateEnterTree(entity: object): void {
  const state = stateOf(entity);
  state.insideTree = true;
  state.binding?.enterTree?.();
  for (const child of [...childEntities(entity)]) {
    if (!(NODE.get(child)?.insideTree ?? false)) propagateEnterTree(child);
  }
}

/**
 * `_propagate_ready` (`scene/main/node.cpp:323`): children first; a node's first ready enables
 * the callbacks its script overrides (`NOTIFICATION_READY`, `:255`), calls `_ready`, then emits
 * `ready`.
 */
function propagateReady(entity: object): void {
  const state = stateOf(entity);
  state.readyNotified = true;
  for (const child of [...childEntities(entity)]) propagateReady(child);
  if (state.readyFirst) {
    state.readyFirst = false;
    initializeProcessing(state);
    state.binding?.ready?.();
    state.ready.emit();
  }
}

/** `_propagate_exit_tree` (`scene/main/node.cpp:410`): children in reverse first, then self. */
function propagateExitTree(entity: object): void {
  const children = [...childEntities(entity)];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index] as object;
    if (NODE.get(child)?.insideTree ?? false) propagateExitTree(child);
  }
  const state = stateOf(entity);
  state.binding?.exitTree?.();
  state.readyNotified = false;
  state.insideTree = false;
}

function initializeProcessing(state: NodeState): void {
  if (state.methods.input === true) state.input = true;
  if (state.methods.unhandledInput === true) state.unhandledInput = true;
  if (state.methods.unhandledKeyInput === true) state.unhandledKeyInput = true;
  if (state.methods.process === true) state.process = true;
  if (state.methods.physicsProcess === true) state.physicsProcess = true;
}

/** `Node::_set_tree` entering (`scene/main/node.cpp:3354`). */
function enterTree(child: object, parent: object): void {
  propagateEnterTree(child);
  if (stateOf(parent).readyNotified) propagateReady(child);
}

function removeChild(parent: object, child: object): void {
  if (stateOf(child).insideTree) propagateExitTree(child);
  detach(parent, child);
}

/** `_validate_child_name` (`scene/main/node.cpp:1527`): an empty or taken name becomes `@Class@n`. */
function validateChildName(parent: object, child: object): void {
  const name = nameOf(child);
  const taken = childEntities(parent).some((sibling) => sibling !== child && nameOf(sibling) === name);
  if (name === '' || taken) {
    const className = stateOf(child).kind === 'node' ? 'Node' : 'Node3D';
    (child as { name: string }).name = `@${className}@${String((serial += 1))}`;
  }
}

// --- Node members.

/**
 * Fails when the child already has a parent or is the node itself; otherwise names it uniquely,
 * attaches it, and when the parent is inside the tree enters it (and readies it when the parent is
 * ready).
 *
 * @godot Node.add_child
 * @source scene/main/node.cpp:1711
 */
export function add_child(self: object, node: object): void {
  const parent = native(self, 'add_child');
  const child = native(node, 'add_child');
  if (child === parent || parentEntity(child) !== null) return;
  validateChildName(parent, child);
  attach(parent, child);
  if (stateOf(parent).insideTree) enterTree(child, parent);
}

/**
 * The child's subtree exits the tree (children in reverse first), then it is detached.
 *
 * @godot Node.remove_child
 * @source scene/main/node.cpp:1747
 */
export function remove_child(self: object, node: object): void {
  const parent = native(self, 'remove_child');
  const child = native(node, 'remove_child');
  if (parentEntity(child) !== parent) return;
  removeChild(parent, child);
}

/**
 * The children in order, as Godot objects.
 *
 * @godot Node.get_children
 * @source scene/main/node.cpp:1867
 */
export function get_children(self: object): unknown[] {
  return childEntities(native(self, 'get_children'))
    .filter((child) => NODE.has(child))
    .map(objectOf);
}

/**
 * @godot Node.get_parent
 * @source scene/main/node.cpp:2100
 */
export function get_parent(self: object): object | null {
  const parent = parentEntity(native(self, 'get_parent'));
  return parent === null || !NODE.has(parent) ? null : objectOf(parent);
}

/**
 * `NodePath` names over the native links: `.`, `..`, child names; an absolute path starts at the
 * root's name. Subnames (`:property`) and `%Unique` names are not transcribed.
 *
 * @godot Node.get_node_or_null
 * @source scene/main/node.cpp:1904
 */
export function get_node_or_null(self: object, path: string): unknown {
  const start = native(self, 'get_node_or_null');
  if (path === '') return null;
  const absolute = path.startsWith('/');
  const names = path.split(':')[0]?.split('/').filter((part) => part !== '') ?? [];
  let current: object | null = absolute ? null : start;
  let root: object = start;
  if (absolute) {
    if (!stateOf(start).insideTree) return null;
    while (parentEntity(root) !== null && NODE.has(parentEntity(root) as object)) root = parentEntity(root) as object;
  }
  for (const name of names) {
    let next: object | null = null;
    if (name === '.') {
      next = current;
    } else if (name === '..') {
      if (current === null || parentEntity(current) === null || !NODE.has(parentEntity(current) as object)) return null;
      next = parentEntity(current);
    } else if (current === null) {
      if (name === nameOf(root)) next = root;
    } else if (name.startsWith('%')) {
      return null;
    } else {
      next = childEntities(current).find((child) => NODE.has(child) && nameOf(child) === name) ?? null;
      if (next === null) return null;
    }
    current = next;
  }
  return current === null ? null : objectOf(current);
}

/**
 * `get_node_or_null`, which reports an error when the node is missing and returns null.
 *
 * @godot Node.get_node
 * @source scene/main/node.cpp:1966
 */
export function get_node(self: object, path: string): unknown {
  return get_node_or_null(self, path);
}

/**
 * @godot Node.get_name
 * @source scene/main/node.cpp:1431
 */
export function get_name(self: object): string {
  return nameOf(native(self, 'get_name'));
}

/**
 * An empty name fails; a name taken by a sibling becomes unique (`@Class@n`).
 *
 * @godot Node.set_name
 * @source scene/main/node.cpp:1439
 */
export function set_name(self: object, name: string): void {
  const entity = native(self, 'set_name');
  if (name === '') return;
  (entity as { name: string }).name = name;
  const parent = parentEntity(entity);
  if (parent !== null && NODE.has(parent)) validateChildName(parent, entity);
}

/**
 * @godot Node.is_in_group
 * @source scene/main/node.cpp:2453
 */
export function is_in_group(self: object, group: string): boolean {
  return nodeState(self, 'is_in_group').groups.includes(group);
}

/**
 * @godot Node.add_to_group
 * @source scene/main/node.cpp:2458
 */
export function add_to_group(self: object, group: string): void {
  const state = nodeState(self, 'add_to_group');
  if (!state.groups.includes(group)) state.groups.push(group);
}

/**
 * @godot Node.remove_from_group
 * @source scene/main/node.cpp:2482
 */
export function remove_from_group(self: object, group: string): void {
  const state = nodeState(self, 'remove_from_group');
  state.groups = state.groups.filter((entry) => entry !== group);
}

/**
 * Queues the node on its tree's deletion queue, freed at the end of the current physics step or
 * process frame (`SceneTree::queue_delete`, `scene/main/scene_tree.cpp:1638`).
 *
 * @godot Node.queue_free
 * @source scene/main/node.cpp:3461
 */
export function queue_free(self: object): void {
  queue_delete(godot_tree(), native(self, 'queue_free'));
}

/**
 * Marks a node (by entity or script instance) queued for deletion, as `SceneTree::queue_delete`
 * does; `Object.is_queued_for_deletion` reads it.
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1641
 */
export function godot_node_set_queued(object: object): void {
  stateOf(NATIVE_OF_OWNER.get(object) ?? object).queued = true;
}

/**
 * Whether a node is queued for deletion (`_is_queued_for_deletion`).
 *
 * @godot Node (protocol)
 * @source core/object/object.h:813
 */
export function godot_node_is_queued(object: object): boolean {
  return NODE.get(NATIVE_OF_OWNER.get(object) ?? object)?.queued ?? false;
}

/**
 * The tree record when the node is inside the tree; outside it Godot reports an error and returns
 * null.
 *
 * @godot Node.get_tree
 * @source scene/main/node.h:558
 */
export function get_tree(self: object): SceneTree | null {
  return nodeState(self, 'get_tree').insideTree ? godot_tree() : null;
}

/**
 * @godot Node.is_inside_tree
 * @source scene/main/node.h:563
 */
export function is_inside_tree(self: object): boolean {
  return nodeState(self, 'is_inside_tree').insideTree;
}

/**
 * The tree's root when the node is inside the tree, else null (a Node's `get_viewport` inside the
 * main tree is the root Window).
 *
 * @godot Node.get_viewport
 * @source scene/main/node.h:796
 */
export function get_viewport(self: object): object | null {
  return nodeState(self, 'get_viewport').insideTree ? objectOf(get_root()) : null;
}

/**
 * `data.tree ? tree->get_physics_process_time() : 0`.
 *
 * @godot Node.get_physics_process_delta_time
 * @source scene/main/node.cpp:1009
 */
export function get_physics_process_delta_time(self: object): number {
  return nodeState(self, 'get_physics_process_delta_time').insideTree ? godot_tree_process_delta(true) : 0;
}

/**
 * @godot Node.get_process_delta_time
 * @source scene/main/node.cpp:1017
 */
export function get_process_delta_time(self: object): number {
  return nodeState(self, 'get_process_delta_time').insideTree ? godot_tree_process_delta(false) : 0;
}

/**
 * Only acts when physics interpolation is enabled, which the project default is not
 * (`physics/common/physics_interpolation`); then it does nothing.
 *
 * @godot Node.reset_physics_interpolation
 * @source scene/main/node.cpp:976
 */
export function reset_physics_interpolation(self: object): void {
  nodeState(self, 'reset_physics_interpolation');
}

// --- Processing flags and modes.

function effectiveProcessMode(entity: object, state: NodeState): number {
  if (state.processMode !== PROCESS_MODE_INHERIT) return state.processMode;
  let parent = parentEntity(entity);
  while (parent !== null) {
    const inherited = NODE.get(parent)?.processMode ?? PROCESS_MODE_INHERIT;
    if (inherited !== PROCESS_MODE_INHERIT) return inherited;
    parent = parentEntity(parent);
  }
  return 1;
}

function processModeAllows(entity: object, state: NodeState, paused: boolean): boolean {
  const mode = effectiveProcessMode(entity, state);
  if (mode === PROCESS_MODE_DISABLED) return false;
  if (mode === PROCESS_MODE_ALWAYS) return true;
  // `Node::_can_process` (`scene/main/node.cpp:911`): otherwise only PAUSABLE runs unpaused.
  return paused ? mode === PROCESS_MODE_WHEN_PAUSED : mode === PROCESS_MODE_PAUSABLE;
}

/**
 * @godot Node.set_process
 * @source scene/main/node.cpp:1025
 */
export function set_process(self: object, enabled: boolean): void {
  nodeState(self, 'set_process').process = Boolean(enabled);
}

/**
 * @godot Node.is_processing
 * @source scene/main/node.cpp:1047
 */
export function is_processing(self: object): boolean {
  const entity = native(self, 'is_processing');
  const state = stateOf(entity);
  return state.process;
}

/**
 * @godot Node.set_physics_process
 * @source scene/main/node.cpp:617
 */
export function set_physics_process(self: object, enabled: boolean): void {
  nodeState(self, 'set_physics_process').physicsProcess = Boolean(enabled);
}

/**
 * @godot Node.is_physics_processing
 * @source scene/main/node.cpp:639
 */
export function is_physics_processing(self: object): boolean {
  return nodeState(self, 'is_physics_processing').physicsProcess;
}

/**
 * The effective process mode allows processing while the tree is not paused.
 *
 * @godot Node.can_process
 * @source scene/main/node.cpp:907
 */
export function can_process(self: object): boolean {
  const entity = native(self, 'can_process');
  const state = stateOf(entity);
  return state.insideTree && processModeAllows(entity, state, false);
}

/**
 * Stored in the 3-bit `data.process_mode` field (`scene/main/node.h:246`), so an out-of-range
 * mode keeps its low three bits (9 reads back as 1, -1 as 7), as the binary shows.
 *
 * @godot Node.set_process_mode
 * @source scene/main/node.cpp:669
 */
export function set_process_mode(self: object, mode: number): void {
  nodeState(self, 'set_process_mode').processMode = mode & 7;
}

/**
 * @godot Node.get_process_mode
 * @source scene/main/node.cpp:754
 */
export function get_process_mode(self: object): number {
  return nodeState(self, 'get_process_mode').processMode;
}

/**
 * @godot Node.set_process_priority
 * @source scene/main/node.cpp:1151
 */
export function set_process_priority(self: object, priority: number): void {
  nodeState(self, 'set_process_priority').processPriority = priority;
}

/**
 * @godot Node.get_process_priority
 * @source scene/main/node.cpp:1173
 */
export function get_process_priority(self: object): number {
  return nodeState(self, 'get_process_priority').processPriority;
}

/**
 * @godot Node.is_node_ready
 * @source scene/main/node.cpp:3555
 */
export function is_node_ready(self: object): boolean {
  return !nodeState(self, 'is_node_ready').readyFirst;
}

/**
 * The next time the node enters the tree it is readied again.
 *
 * @godot Node.request_ready
 * @source scene/main/node.cpp:3559
 */
export function request_ready(self: object): void {
  nodeState(self, 'request_ready').readyFirst = true;
}

/**
 * The built-in `ready` signal of the node.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:337
 */
export function godot_node_ready_signal(self: object): GodotSignal<[]> {
  return nodeState(self, 'ready').ready.signal;
}

// --- The mounted scene forest.

/**
 * Seats generated script attachments on a mounted native tree and enters it: every root and its
 * subtree enter parent-first, then every root readies children-first, in the order given (autoloads,
 * then the main scene, as `Main::start` adds them to the root, `main/main.cpp:4495-4560`). The
 * release exits them in reverse.
 *
 * @godot Node (protocol)
 * @source main/main.cpp:4495
 */
export function mountGodotScriptForest(
  roots: readonly object[],
  bindings: readonly GodotScriptLifecycleBinding[],
): () => void {
  const owners = new Set<object>();
  const natives = new Set<object>();
  for (const binding of bindings) {
    if (natives.has(binding.native)) throw new Error('godot-compat: a native node has two generated script attachments.');
    if (owners.has(binding.owner)) throw new Error('godot-compat: a generated script instance is attached to two native nodes.');
    natives.add(binding.native);
    owners.add(binding.owner);
  }
  const visited = new Set<object>();
  const collect = (node: object): void => {
    if (visited.has(node)) throw new Error('godot-compat: a native node appears beneath two mounted roots.');
    visited.add(node);
    stateOf(node);
    for (const child of childEntities(node)) collect(child);
  };
  for (const root of roots) collect(root);
  for (const binding of bindings) {
    if (!visited.has(binding.native)) {
      throw new Error('godot-compat: a generated script attachment is outside its mounted native root.');
    }
    const { native: entity, ...rest } = binding;
    godot_node_adopt(entity, { binding: rest });
  }
  for (const root of roots) propagateEnterTree(root);
  for (const root of roots) propagateReady(root);
  let mounted = true;
  return () => {
    if (!mounted) return;
    mounted = false;
    for (let index = roots.length - 1; index >= 0; index -= 1) {
      const root = roots[index] as object;
      if (stateOf(root).insideTree) propagateExitTree(root);
    }
  };
}

/**
 * One mounted scene root and its attachments: `mountGodotScriptForest` of one root.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:3354
 */
export function mountGodotScriptTree(root: object, bindings: readonly GodotScriptLifecycleBinding[]): () => void {
  return mountGodotScriptForest([root], bindings);
}
