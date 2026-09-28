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

import { godot_input_event_classes } from './input-event';
import type { Object3D } from 'three';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { create_tween as treeCreateTween, get_root, godot_tree, godot_tree_process_delta, godot_tree_set_root, queue_delete, type SceneTree } from './scene-tree';
import { bind_node, type Tween } from './tween';

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
  readonly shortcutInput?: boolean;
  readonly unhandledInput?: boolean;
  readonly unhandledKeyInput?: boolean;
}

/** The input callbacks, as `Viewport::push_input` calls them (`scene/main/scene_tree.cpp:1475`). */
export type GodotInputKind = 'input' | 'shortcutInput' | 'unhandledInput' | 'unhandledKeyInput';

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
  readonly input?: (event: unknown) => void;
  readonly shortcutInput?: (event: unknown) => void;
  readonly unhandledInput?: (event: unknown) => void;
  readonly unhandledKeyInput?: (event: unknown) => void;
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
  /** Queued for deletion, itself or an ancestor: it takes no further part until it is freed. */
  leaving: boolean;
  freed: boolean;
  process: boolean;
  physicsProcess: boolean;
  input: boolean;
  shortcutInput: boolean;
  unhandledInput: boolean;
  unhandledKeyInput: boolean;
  /** A node class's own `input()` (and the like) after the script's, as a native class overrides them. */
  internalInput: Partial<Record<GodotInputKind, (event: unknown) => void>>;
  processMode: number;
  processPriority: number;
  physicsProcessPriority: number;
  ready: SignalHandle<[]>;
  treeEntered: SignalHandle<[]>;
  treeExiting: SignalHandle<[]>;
  internalPhysics: ((delta: number) => void) | undefined;
  internalProcess: ((delta: number) => void) | undefined;
  /** The node's Godot class and its native ancestors, nearest first, as the scene records it. */
  classes: readonly string[] | undefined;
  /** The scene root that owns the node (`Node::data.owner`), when a scene placed it. */
  owner: object | undefined;
  /** The nodes this node owns with `unique_name_in_owner`, by name (`owned_unique_nodes`). */
  uniqueNodes: Map<string, object>;
  /** A scene root's: the scenes scripts add under its nodes, as the state of its scene component. */
  addedScenes: GodotAddedScenes | undefined;
}

const NODE = new WeakMap<object, NodeState>();
const NATIVE_OF_OWNER = new WeakMap<object, object>();
/** An instantiated scene root's stand-in node, and the node React mounted for it. */
const STANDS_FOR = new WeakMap<object, object>();

/** The node an object is: a script instance's node, a stand-in's mounted node, or itself. */
function entityOf(object: object): object {
  const entity = NATIVE_OF_OWNER.get(object) ?? object;
  return STANDS_FOR.get(entity) ?? entity;
}
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
  return entityOf(node as object);
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
    leaving: false,
    freed: false,
    process: false,
    physicsProcess: false,
    input: false,
    shortcutInput: false,
    unhandledInput: false,
    unhandledKeyInput: false,
    internalInput: {},
    processMode: PROCESS_MODE_INHERIT,
    processPriority: 0,
    physicsProcessPriority: 0,
    ready: createSignal<[]>(),
    treeEntered: createSignal<[]>(),
    treeExiting: createSignal<[]>(),
    classes: undefined,
    owner: undefined,
    uniqueNodes: new Map(),
    addedScenes: undefined,
    internalPhysics: undefined,
    internalProcess: undefined,
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

/**
 * The native children that are Godot nodes. A Godot node always has a name, so a nameless object
 * the Node protocol has not met is a container the JSX did not author as a node (drei's camera
 * renders an empty one beside the camera; a holder group wraps a mounted scene): it is not a node,
 * and its children stand in its place.
 */
function childEntities(entity: object): readonly object[] {
  return ((entity as Object3D).children ?? []).flatMap((child) =>
    FOREIGN.has(child) ? [] : NODE.has(child) || nameOf(child) !== '' ? [child] : childEntities(child),
  );
}

/** Objects a library made that are not Godot nodes, whatever their names (a model's bones). */
const FOREIGN = new WeakSet<object>();

/**
 * Marks an object a library made as not a Godot node (with what it holds): an imported model's
 * joints and per-surface meshes, which Godot's importer makes bones and surfaces, not nodes.
 *
 * @godot Node (protocol)
 * @source editor/import/3d/resource_importer_scene.cpp:3174
 */
export function godot_node_foreign(object: object): void {
  FOREIGN.add(object);
}

function nameOf(entity: object): string {
  return (entity as { name?: string }).name ?? '';
}

// --- Protocol: the composition site's entry points.

/**
 * The editor's callsite address for an element (`__volterOid`, which its source transform stamps on
 * every component callsite in a served scene): set on the element's native root object, the
 * editor's convention for a component it cannot instrument (drei's cameras forward it the same
 * way), so the editor selects the element at its callsite. Its `__volterLabel` carries nothing a
 * Godot node holds; neither is ever a Godot property.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:4092
 */
export function godot_element_callsite(object: object, callsite: unknown): void {
  if (typeof callsite === 'string' && callsite !== '') (object as { __volterOid?: string }).__volterOid = callsite;
}


/** How a scene root's component adds and removes the scenes scripts add under its nodes. */
export interface GodotAddedScenes {
  readonly add: (scene: object) => void;
  readonly remove: (scene: object) => void;
}

/**
 * The added scenes of the scene holding `node`: those of the nearest scene root at or above it.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:1711
 */
export function godot_node_added_scenes(node: object): GodotAddedScenes | undefined {
  for (let current: object | null = node; current !== null; current = parentEntity(current)) {
    const found = NODE.get(current)?.addedScenes;
    if (found !== undefined) return found;
  }
  return undefined;
}

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
    /** The node's Godot class and its native ancestors, nearest first (`ClassDB` inheritance). */
    readonly classes?: readonly string[];
    /** The scene root that owns the node; with `unique`, the owner finds it as `%Name`. */
    readonly owner?: object;
    readonly unique?: boolean;
    /** A scene root's added scenes (`packed-scene-instance.tsx`); null ends them. */
    readonly addedScenes?: GodotAddedScenes | null;
  } = {},
): object {
  const state = stateOf(entity);
  if (options.addedScenes !== undefined) state.addedScenes = options.addedScenes ?? undefined;
  if (options.owner !== undefined) {
    state.owner = options.owner;
    if (options.unique === true) stateOf(options.owner).uniqueNodes.set(nameOf(entity), entity);
  }
  if (options.kind !== undefined) state.kind = options.kind;
  if (options.classes !== undefined) state.classes = Object.freeze([...options.classes]);
  if (options.authority !== undefined) state.authority = options.authority;
  if (options.binding !== undefined) {
    const owner = options.binding.owner as Record<string, unknown>;
    // The tree notifications the script answers, its own or a base script's methods. A script error
    // aborts only that callback: it is reported and the tree carries on (GODOT.md §Order of work).
    const virtual = (method: string): (() => void) | undefined =>
      typeof owner[method] === 'function'
        ? () => {
            try {
              (owner[method] as () => void).call(owner);
            } catch (error) {
              console.error(error);
            }
          }
        : undefined;
    const enterTree = virtual('_enter_tree');
    const ready = virtual('_ready');
    const exitTree = virtual('_exit_tree');
    const binding: GodotScriptLifecycleBinding = {
      ...(enterTree === undefined ? {} : { enterTree }),
      ...(ready === undefined ? {} : { ready }),
      ...(exitTree === undefined ? {} : { exitTree }),
      ...options.binding,
      native: entity,
    };
    state.binding = binding;
    // The virtuals the script defines, its own or a base script's (`GDVIRTUAL_IS_OVERRIDDEN`).
    const defines = (callback: unknown, method: string): boolean =>
      callback !== undefined || typeof owner[method] === 'function';
    state.methods = Object.freeze({
      process: defines(binding.process, '_process'),
      physicsProcess: defines(binding.physicsProcess, '_physics_process'),
      input: defines(binding.input, '_input'),
      shortcutInput: defines(binding.shortcutInput, '_shortcut_input'),
      unhandledInput: defines(binding.unhandledInput, '_unhandled_input'),
      unhandledKeyInput: defines(binding.unhandledKeyInput, '_unhandled_key_input'),
    });
    NATIVE_OF_OWNER.set(binding.owner, entity);
    // A script attached after its node readied still turns on what it defines.
    if (state.readyNotified) initializeProcessing(entity, state);
  }
  return objectOf(entity);
}

/** The object a type test reads, or null; a freed object is an error, as in Godot. */
function testedObject(value: unknown, test: string): object | null {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return null;
  const entity = entityOf(value as object);
  if (NODE.get(entity)?.freed === true) {
    throw new Error(`godot-compat: Left operand of '${test}' is a previously freed instance.`);
  }
  return value as object;
}

/**
 * `value is ScriptClass`: the object's script instance is the script or derives from it
 * (`OPCODE_TYPE_TEST_SCRIPT`, which walks `get_base_script()`); the generated classes extend
 * their base scripts' classes, so that is `instanceof`.
 *
 * @godot Node (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:954
 */
export function godot_is_script<Script>(value: unknown, script: abstract new (...args: never[]) => Script): value is Script {
  const object = testedObject(value, 'is');
  return object !== null && objectOf(object) instanceof script;
}

/**
 * A call the analysis could only narrow to the project scripts that declare the method: the first
 * of them the object's script is (or derives from) runs it, as `Object::callp` runs the script's
 * function; any other object is Godot's error (`Invalid call. Nonexistent function … in base
 * '<class>'`, `gdscript_vm.cpp:2108`; for an object with another script Godot adds the script's
 * name, which this does not), and null or a freed object the null-instance error (`:184`).
 *
 * @godot Node (protocol)
 * @source core/object/object.cpp:768
 */
export function godot_script_call(value: unknown, method: string, scripts: readonly (abstract new (...args: never[]) => unknown)[], args: readonly unknown[]): unknown {
  if (value === null || value === undefined) {
    throw new Error(`Attempt to call function '${method}' in base 'null instance' on a null instance.`);
  }
  if (typeof value === 'object' && NODE.get(entityOf(value))?.freed === true) {
    throw new Error(`Attempt to call function '${method}' in base 'previously freed' on a null instance.`);
  }
  const owner = objectOf(value as object);
  for (const script of scripts) {
    if (owner instanceof script) return (Reflect.get(owner, method) as (...values: unknown[]) => unknown).apply(owner, [...args]);
  }
  const classes = nodeClasses(entityOf(value as object));
  throw new Error(`Invalid call. Nonexistent function '${method}' in base '${classes?.[0] ?? 'Object'}'.`);
}

/**
 * `value as ScriptClass`: the object when its script is the script or derives from it, else null
 * (`OPCODE_CAST_TO_SCRIPT`).
 *
 * @godot Node (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:1687
 */
export function godot_as_script<Script>(value: unknown, script: abstract new (...args: never[]) => Script): Script | null {
  const object = testedObject(value, 'as');
  return object !== null && objectOf(object) instanceof script ? (value as Script) : null;
}

const CLASS_READERS: ((entity: object) => readonly string[] | undefined)[] = [];
/** The roots of the scenes the JSX mounts (`useGodotScene`): each owns the nodes its component writes. */
const SCENE_ROOTS = new WeakSet<object>();
const SEEDED = new WeakSet<object>();

/**
 * Registers the root of a scene the JSX mounts: it owns the nodes below it up to the next scene
 * root, which its instancing scene's root owns in turn (`Node::data.owner`, set as
 * `SceneState::instantiate` makes each node, `packed_scene.cpp:318`).
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:318
 */
export function godot_node_scene_root(entity: object): void {
  SCENE_ROOTS.add(entity);
}

/**
 * The Godot-only state a node the JSX declares seeds from its `userData`, as it first enters the
 * tree: its groups, in authored order (added as the scene instantiates, `packed_scene.cpp:511`),
 * and, owned by the nearest scene root above it, whether its owner finds it as `%Name`
 * (`unique_name_in_owner`). A node the composition recorded keeps what it recorded.
 */
function seedDeclared(entity: object): void {
  const state = stateOf(entity);
  if (SEEDED.has(entity)) return;
  SEEDED.add(entity);
  if (state.owner === undefined) {
    for (let parent = parentEntity(entity); parent !== null; parent = parentEntity(parent)) {
      if (!SCENE_ROOTS.has(parent)) continue;
      state.owner = parent;
      break;
    }
  }
  const data = ((entity as Object3D).userData ?? {}) as Readonly<Record<string, unknown>>;
  for (const group of (data['groups'] ?? []) as readonly string[]) if (!state.groups.includes(group)) state.groups.push(group);
  // An explicit sibling position (`index`): the scene moves the node there once added, when that is
  // before where it was added (`SceneState::instantiate`, packed_scene.cpp:545).
  const index = data['index'];
  if (typeof index === 'number') moveToIndex(entity as Object3D, index);
  if (data['unique_name_in_owner'] === true) {
    if (state.owner === undefined) throw new Error(`godot-compat: %${nameOf(entity)} has no scene root to own it.`);
    stateOf(state.owner).uniqueNodes.set(nameOf(entity), entity);
  }
}
/**
 * `parent->move_child(node, index)` when `index < parent->get_child_count() - 1` as the node is
 * added: the Godot children before it are the ones added earlier, so it moves only to a position
 * before its own. Three's children hold objects that are not nodes (a model's surfaces) too: the
 * node goes before the node now at `index`.
 */
function moveToIndex(entity: Object3D, index: number): void {
  const parent = entity.parent;
  if (parent === null) return;
  const siblings = parent.children.filter((child) => !FOREIGN.has(child) && (NODE.has(child) || nameOf(child) !== ''));
  const position = siblings.indexOf(entity);
  if (index < 0 || index >= position) return;
  const before = siblings[index] as Object3D;
  parent.children.splice(parent.children.indexOf(entity), 1);
  parent.children.splice(parent.children.indexOf(before), 0, entity);
}

/**
 * Registers a module's reading of the Godot class (with its ancestry) of a node the scene's JSX
 * declares without recording one: the physics bodies and colliders `@react-three/rapier` mounts.
 *
 * @godot Node (protocol)
 * @source core/object/class_db.cpp:307
 */
export function godot_node_class_reader(reader: (entity: object) => readonly string[] | undefined): void {
  if (!CLASS_READERS.includes(reader)) CLASS_READERS.push(reader);
}

const CAMERA_3D = Object.freeze(['Camera3D', 'Node3D', 'Node', 'Object']);
const DIRECTIONAL_LIGHT_3D = Object.freeze(['DirectionalLight3D', 'Light3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object']);
const MESH_INSTANCE_3D = Object.freeze(['MeshInstance3D', 'GeometryInstance3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object']);
const NODE_3D = Object.freeze(['Node3D', 'Node', 'Object']);

/**
 * A node's Godot classes: the ones its composition recorded, else the ones its JSX states, read
 * from the three object it mounts (a named camera, directional light or mesh, else a Node3D) or
 * from a module's reader.
 */
function nodeClasses(entity: object): readonly string[] | undefined {
  const recorded = NODE.get(entity)?.classes ?? godot_input_event_classes(entity);
  if (recorded !== undefined) return recorded;
  for (const reader of CLASS_READERS) {
    const read = reader(entity);
    if (read !== undefined) return read;
  }
  const three = entity as { readonly isObject3D?: boolean; readonly isCamera?: boolean; readonly isDirectionalLight?: boolean; readonly isMesh?: boolean };
  if (three.isObject3D !== true || nameOf(entity) === '') return undefined;
  if (three.isCamera === true) return CAMERA_3D;
  if (three.isDirectionalLight === true) return DIRECTIONAL_LIGHT_3D;
  if (three.isMesh === true) return MESH_INSTANCE_3D;
  return NODE_3D;
}

/** The Godot classes of an object's native entity; one with none is an error. */
function classesOf(object: object, test: string): readonly string[] {
  const entity = entityOf(object);
  const classes = nodeClasses(entity);
  if (classes === undefined) {
    throw new Error(`godot-compat: '${test}' needs the Godot class of an object the scene did not record.`);
  }
  return classes;
}

/**
 * `value is NativeClass`: `ClassDB::is_parent_class` of the object's class
 * (`OPCODE_TYPE_TEST_NATIVE`), read from the class and ancestry the composition recorded.
 *
 * @godot Node (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:932
 */
export function godot_is_native(value: unknown, className: string): boolean {
  const object = testedObject(value, 'is');
  return object !== null && classesOf(object, 'is').includes(className);
}

/**
 * `value as NativeClass`: the object when its class is the class or derives from it, else null
 * (`OPCODE_CAST_TO_NATIVE`); null stays null.
 *
 * @godot Node (protocol)
 * @source modules/gdscript/gdscript_vm.cpp:1656
 */
export function godot_as_native(value: unknown, className: string): unknown {
  const object = testedObject(value, 'as');
  return object === null || classesOf(object, 'as').includes(className) ? value : null;
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
  readonly internalPhysics: ((delta: number) => void) | undefined;
  readonly internalProcess: ((delta: number) => void) | undefined;
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
    internalPhysics: state.internalPhysics,
    internalProcess: state.internalProcess,
  };
}

/**
 * Sets (or clears) a node class's internal physics processing (`NOTIFICATION_INTERNAL_PHYSICS_PROCESS`,
 * `scene/main/scene_tree.cpp:1219`), which the node's own component runs from the host's physics
 * step (`useGodotAdvance`).
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1219
 */
export function godot_node_set_internal_physics(entity: object, process: ((delta: number) => void) | undefined): void {
  stateOf(entity).internalPhysics = process;
}

/**
 * Sets (or clears) a node class's internal processing (`NOTIFICATION_INTERNAL_PROCESS`,
 * `scene/main/scene_tree.cpp:1219`), which the node's own component runs from the host's frame
 * (`useGodotAdvance`).
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1219
 */
export function godot_node_set_internal_process(entity: object, process: ((delta: number) => void) | undefined): void {
  stateOf(entity).internalProcess = process;
}

/**
 * Runs a node's own internal processing for one host frame or physics step, when it is inside the
 * tree and its process mode lets it run. Called by the node's component, never by a list.
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1219
 */
export function godot_node_advance(entity: object, physics: boolean, delta: number): void {
  const state = NODE.get(entity);
  if (state === undefined || !state.insideTree || state.leaving || !processModeAllows(entity, state, false)) return;
  (physics ? state.internalPhysics : state.internalProcess)?.(delta);
}

/**
 * The Godot object of an entity: its script instance when one is bound, else the entity.
 *
 * @godot Node (protocol)
 * @source core/object/object.h:813
 */
export function godot_node_object(entity: object): object {
  return objectOf(entity);
}

/** A Godot object's native entity type: a script instance's `$native`, else the value itself. */
export type GodotNativeOf<Value> = Value extends { readonly $native: infer Native } ? Native : Exclude<Value, null | undefined>;

/**
 * The native entity of a Godot object (a script instance or the entity itself).
 *
 * @godot Node (protocol)
 * @source core/object/object.h:813
 */

export function godot_node_entity<Value>(object: Value): GodotNativeOf<Value> {
  // A node a script reached through an untyped path (`get_node` returns Variant): a null one is
  // Godot's call on a null instance.
  if (object === null || typeof object !== 'object') throw new TypeError('godot-compat: a node method was called on a null instance.');
  return (entityOf(object)) as GodotNativeOf<Value>;
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
  for (const observer of TREE_OBSERVERS) observer(entity);
}

/**
 * Whether a node (by entity or script instance) has been freed: a deferred call to it is dropped
 * (`CallQueue::flush`, `core/object/message_queue.cpp:264`).
 *
 * @godot Node (protocol)
 * @source core/object/message_queue.cpp:264
 */
export function godot_node_is_freed(object: object): boolean {
  return NODE.get(entityOf(object))?.freed ?? false;
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

const TREE_OBSERVERS: ((entity: object) => void)[] = [];

/**
 * Registers a view of each node entering the tree, leaving it, or being freed (the
 * `NOTIFICATION_ENTER_TREE`, `NOTIFICATION_EXIT_TREE` and `NOTIFICATION_PREDELETE` a server-facing
 * node answers, `node.cpp:128`).
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:128
 */
export function godot_node_observe_tree(observer: (entity: object) => void): void {
  if (!TREE_OBSERVERS.includes(observer)) TREE_OBSERVERS.push(observer);
}

/**
 * The order children were added in, where `move_child` made it differ from their order: Godot keeps
 * children in a HashMap by insertion, which entering, readying and exiting walk
 * (`_propagate_enter_tree`, `node.cpp:370`), and a separate cache in child order.
 */
const INSERTION = new WeakMap<object, object[]>();

/** The children in the order they were added (their child order unless `move_child` reordered them). */
function insertionOrder(entity: object): object[] {
  const children = [...childEntities(entity)];
  const added = INSERTION.get(entity);
  if (added === undefined) return children;
  const rank = (child: object): number => {
    const index = added.indexOf(child);
    return index < 0 ? added.length + children.indexOf(child) : index;
  };
  return children.sort((a, b) => rank(a) - rank(b));
}

/** `_propagate_enter_tree` (`scene/main/node.cpp:341`): self, then children. */
function propagateEnterTree(entity: object): void {
  const state = stateOf(entity);
  state.insideTree = true;
  for (const observer of TREE_OBSERVERS) observer(entity);
  state.binding?.enterTree?.();
  state.treeEntered.emit();
  for (const child of insertionOrder(entity)) {
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
  for (const child of insertionOrder(entity)) propagateReady(child);
  if (state.readyFirst) {
    state.readyFirst = false;
    initializeProcessing(entity, state);
    state.binding?.ready?.();
    state.ready.emit();
  }
}

/** `_propagate_exit_tree` (`scene/main/node.cpp:410`): children in reverse first, then self. */
function propagateExitTree(entity: object): void {
  const children = insertionOrder(entity);
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index] as object;
    if (NODE.get(child)?.insideTree ?? false) propagateExitTree(child);
  }
  const state = stateOf(entity);
  state.binding?.exitTree?.();
  state.treeExiting.emit();
  state.readyNotified = false;
  state.insideTree = false;
  for (const observer of TREE_OBSERVERS) observer(entity);
}

function initializeProcessing(entity: object, state: NodeState): void {
  if (state.methods.input === true) state.input = true;
  if (state.methods.shortcutInput === true) state.shortcutInput = true;
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
  const added = INSERTION.get(parent);
  if (added !== undefined && added.includes(child)) added.splice(added.indexOf(child), 1);
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

/** `Node::DuplicateFlags` (`scene/main/node.h`). */
const DUPLICATE_GROUPS = 2;
const DUPLICATE_SCRIPTS = 4;

/**
 * Each class's stored-property copy for `duplicate` (`Node::_duplicate_properties` walks the
 * class's `PROPERTY_USAGE_STORAGE` properties): a module holding a class's per-node state registers
 * how that state is copied. Object and Node keep theirs here.
 */
const DUPLICATE_COPIERS: ((from: object, to: object) => void)[] = [];

/**
 * Registers how `duplicate` copies a module's per-node state from the original to the copy (the
 * class's stored properties, `node.cpp:3071`): the module copies whatever it holds for the
 * original, which is what its class stores.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:3071
 */
export function godot_node_duplicate_state(copy: (from: object, to: object) => void): void {
  if (!DUPLICATE_COPIERS.includes(copy)) DUPLICATE_COPIERS.push(copy);
}

/**
 * `Node::_duplicate` then `_duplicate_properties` (`node.cpp:2777`, `:3071`): a node of the same
 * class (the entity's three copy, which carries its three-side values), its name, its groups with
 * `DUPLICATE_GROUPS`, each class's stored state, and its children duplicated in order. Three
 * objects the node renders with that are not nodes come along as three copies.
 */
function duplicateEntity(source: object, flags: number): object {
  const state = NODE.get(source);
  const classes = nodeClasses(source);
  if (state === undefined || classes === undefined) {
    throw new Error('godot-compat: Node.duplicate needs the Godot class of a node the scene did not record.');
  }
  if (state.binding !== undefined && (flags & DUPLICATE_SCRIPTS) !== 0) {
    throw new Error('godot-compat: Node.duplicate of a node with a script is not transcribed.');
  }
  // Some three classes' `copy` recurses whatever it is asked (a light's): the copy's children are
  // rebuilt here.
  const copy = (source as Object3D).clone(false).clear();
  for (const child of childEntities(source)) {
    if (!NODE.has(child)) copy.add((child as Object3D).clone(true));
  }
  const copied = stateOf(copy);
  copied.kind = state.kind;
  copied.classes = classes;
  copied.processMode = state.processMode;
  copied.processPriority = state.processPriority;
  copied.physicsProcessPriority = state.physicsProcessPriority;
  if ((flags & DUPLICATE_GROUPS) !== 0) copied.groups = [...state.groups];
  for (const copier of DUPLICATE_COPIERS) copier(source, copy);
  for (const child of childEntities(source)) {
    if (NODE.has(child)) add_child(copy, duplicateEntity(child, flags));
  }
  return copy;
}

/**
 * The default flags duplicate signals, groups and scripts and use instantiation
 * (`DUPLICATE_SIGNALS | DUPLICATE_GROUPS | DUPLICATE_SCRIPTS | DUPLICATE_USE_INSTANTIATION`).
 * Scripted nodes and signal connections are not transcribed: a scripted node throws, and the
 * copy has no connections (`DUPLICATE_SIGNALS` copies only a scene's persistent ones).
 *
 * @godot Node.duplicate
 * @source scene/main/node.cpp:2929
 */
export function duplicate(self: object, flags = 15): unknown {
  return objectOf(duplicateEntity(native(self, 'duplicate'), flags));
}

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
  // A parent that is not a node (the group an instantiated scene waits in) is no Godot parent.
  const current = parentEntity(child);
  if (child === parent || (current !== null && NODE.has(current))) return;
  validateChildName(parent, child);
  // An instantiated scene React has not mounted: React mounts it under the parent (a state update
  // its scene's component renders), then it enters.
  const mounted = addUnmounted?.(parent, child);
  if (mounted !== undefined) {
    INSERTION.get(parent)?.push(mounted);
    if (stateOf(parent).insideTree && !stateOf(mounted).insideTree) enterTree(mounted, parent);
    return;
  }
  attach(parent, child);
  INSERTION.get(parent)?.push(child);
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

const CHILD_ORDER_OBSERVERS: ((parent: object, child: object) => void)[] = [];

/**
 * Registers a view of a parent whose children changed order (`NOTIFICATION_CHILD_ORDER_CHANGED` and
 * `move_child_notify`, `node.cpp:580`): a Container sorts again.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:580
 */
export function godot_node_observe_child_order(observer: (parent: object, child: object) => void): void {
  if (!CHILD_ORDER_OBSERVERS.includes(observer)) CHILD_ORDER_OBSERVERS.push(observer);
}

/**
 * Moves a child to `to_index` among its parent's children, a negative index counting from the end
 * and one past the last meaning the last (`_move_child`, `node.cpp:531`); an index out of range, or
 * a node that is not a child, leaves the order as it is (Godot's error). The tree changed (its
 * process lists are not sorted again until a node joins them, `scene_tree.cpp:1189`). Internal
 * children are not transcribed; three's children holding the node's siblings under other
 * containers are not either.
 *
 * @godot Node.move_child
 * @source scene/main/node.cpp:503
 */
export function move_child(self: object, child_node: object, to_index: number): void {
  const parent = native(self, 'move_child');
  const child = native(child_node, 'move_child');
  if (parentEntity(child) !== parent) return;
  const children = childEntities(parent).filter((entry) => NODE.has(entry));
  let index = to_index < 0 ? to_index + children.length : to_index;
  if (index < 0 || index > children.length) return;
  if (index === children.length) index -= 1;
  const from = children.indexOf(child);
  if (from === index) return;
  if (!INSERTION.has(parent)) INSERTION.set(parent, childEntities(parent).filter((entry) => NODE.has(entry)));
  children.splice(from, 1);
  children.splice(index, 0, child);
  const next = children[index + 1] as Object3D | undefined;
  const previous = children[index - 1] as Object3D | undefined;
  const own = (child as Object3D).parent as Object3D;
  const anchor = next !== undefined ? next : previous;
  if (anchor === undefined || anchor.parent !== own) {
    throw new Error('godot-compat: Node.move_child among siblings in different three containers is not transcribed.');
  }
  own.children.splice(own.children.indexOf(child as Object3D), 1);
  const at = own.children.indexOf(anchor);
  own.children.splice(next !== undefined ? at : at + 1, 0, child as Object3D);
  if (stateOf(parent).insideTree) for (const observer of TREE_OBSERVERS) observer(child);
  for (const observer of CHILD_ORDER_OBSERVERS) observer(parent, child);
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
 * `NodePath` names over the native links: `.`, `..`, child names, `%Unique` names (the node's or
 * its owner's unique nodes); an absolute path starts at the root's name. Subnames (`:property`) are
 * not transcribed.
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
      // The node's own unique nodes, else its owner's (`scene/main/node.cpp:1943`).
      const unique = name.slice(1);
      const owner = stateOf(current).owner;
      next = stateOf(current).uniqueNodes.get(unique) ?? (owner === undefined ? undefined : stateOf(owner).uniqueNodes.get(unique)) ?? null;
      if (next === null) return null;
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
 * Queues the node for deletion (`SceneTree::queue_delete`, `scene/main/scene_tree.cpp:1638`): it
 * takes no further part at once and is freed once the current work is done (`scene-tree.ts`).
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
  stateOf(entityOf(object)).queued = true;
}

/**
 * A node queued for deletion and its subtree take no further part until they are freed: no more
 * callbacks or advancing (`godot_node_processes`, `godot_node_advance`), as Godot, which frees
 * the node at the end of the physics step or process frame it was queued in
 * (`scene/main/scene_tree.cpp:660`, `:725`), never calls them again. Returns the subtree's nodes.
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:660
 */
export function godot_node_leave(object: object): readonly object[] {
  const left: object[] = [];
  const visit = (entity: object): void => {
    const state = NODE.get(entity);
    if (state !== undefined) {
      state.leaving = true;
      left.push(entity);
    }
    for (const child of (entity as Object3D).children ?? []) visit(child);
  };
  visit(entityOf(object));
  return left;
}

/**
 * Whether a node is queued for deletion (`_is_queued_for_deletion`).
 *
 * @godot Node (protocol)
 * @source core/object/object.h:813
 */
export function godot_node_is_queued(object: object): boolean {
  return NODE.get(entityOf(object))?.queued ?? false;
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
 * A tween bound to the node: it runs while the node is inside the tree and can process, and dies
 * when the node is freed. It is owned by the script that makes it (`creator`), whose component
 * steps it (`scene-tree.ts`, `godot_owned_step`).
 *
 * @godot Node.create_tween
 * @source scene/main/node.cpp:2619
 */
export function create_tween(self: object, creator: object): Tween {
  return bind_node(treeCreateTween(godot_tree(), creator), native(self, 'create_tween'));
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

/** Each node's `physics_interpolation_mode`, `PHYSICS_INTERPOLATION_MODE_INHERIT` (0) until set. */
const INTERPOLATION_MODE = new WeakMap<NodeState, number>();

/**
 * Stored in the 2-bit `data.physics_interpolation_mode` field (`scene/main/node.h:247`), so an
 * out-of-range mode keeps its low two bits. The host draws each node where its last frame left it:
 * nothing is interpolated between physics ticks, which is what the mode `OFF` (2) asks for and
 * what `physics/common/physics_interpolation` off (the project default) does for every node.
 *
 * @godot Node.set_physics_interpolation_mode
 * @source scene/main/node.cpp:940
 */
export function set_physics_interpolation_mode(self: object, mode: number): void {
  INTERPOLATION_MODE.set(nodeState(self, 'set_physics_interpolation_mode'), mode & 3);
}

/**
 * @godot Node.get_physics_interpolation_mode
 * @source scene/main/node.h:764
 */
export function get_physics_interpolation_mode(self: object): number {
  return INTERPOLATION_MODE.get(nodeState(self, 'get_physics_interpolation_mode')) ?? 0;
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
  const entity = native(self, 'set_process');
  const state = stateOf(entity);
  if (state.process === Boolean(enabled)) return;
  state.process = Boolean(enabled);
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
  const entity = native(self, 'set_physics_process');
  const state = stateOf(entity);
  if (state.physicsProcess === Boolean(enabled)) return;
  state.physicsProcess = Boolean(enabled);
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
 * Whether a script's node runs its `_process` (`process`) or `_physics_process` (`physics`) this frame: it is
 * inside the tree, processing (`set_process`, on at ready when the script defines the callback) and
 * its process mode allows it, as `SceneTree::_process_group` asks each node
 * (`scene/main/scene_tree.cpp:1177`). The script component's frame hooks ask it.
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1177
 */
export function godot_node_processes(script: object | null, kind: 'process' | 'physics'): boolean {
  const own = script === null ? undefined : NATIVE_OF_OWNER.get(script);
  const entity = own === undefined ? undefined : entityOf(own);
  const state = entity === undefined ? undefined : NODE.get(entity);
  if (entity === undefined || state === undefined || !state.insideTree || state.leaving) return false;
  return (kind === 'process' ? state.process : state.physicsProcess) && processModeAllows(entity, state, false);
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
  const entity = native(self, 'set_process_priority');
  const state = stateOf(entity);
  if (state.processPriority === priority) return;
  state.processPriority = priority;
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

/**
 * The built-in `tree_entered` (after `_enter_tree`, before the children enter) and `tree_exiting`
 * (after the children and `_exit_tree`, before the node leaves) signals of the node.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:364
 */
export function godot_node_tree_signal(self: object, name: 'tree_entered' | 'tree_exiting'): GodotSignal<[]> {
  const state = nodeState(self, name);
  return (name === 'tree_entered' ? state.treeEntered : state.treeExiting).signal;
}

// --- The mounted scene forest.

/**
 * Seats generated script attachments on a mounted native tree without entering it: each node's
 * class is recorded and each script binding adopted, as `SceneState::instantiate` makes the nodes
 * and sets their scripts before anything enters the tree (`scene/resources/packed_scene.cpp:318`).
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:318
 */
export function seatGodotScriptForest(roots: readonly object[], bindings: readonly GodotScriptLifecycleBinding[]): void {
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
    seedDeclared(node);
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
}

/** Exits, children in reverse first, the roots still inside the tree, last root first. */
function exitRoots(roots: readonly object[]): void {
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const root = roots[index] as object;
    if (stateOf(root).insideTree) propagateExitTree(root);
  }
}

/** Each instantiated scene's deferred node-path properties, set once its nodes all exist. */
const DEFERRED_NODE_PATHS: (() => void)[] = [];

/**
 * Defers setting a node-path property until the scenes React mounted in this commit all exist
 * (their scripts attached): `SceneState::instantiate` sets a property stored as a NodePath to the
 * node at that path once every node of the scene is made (`packed_scene.cpp:597`). They are set
 * before those scenes enter the tree (`godot_node_seat`).
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:597
 */
export function godot_node_defer_node_path(set: () => void): void {
  DEFERRED_NODE_PATHS.push(set);
}

/**
 * When `root` is not yet inside the tree but hangs below a node that is: the highest node between
 * them (a container that is not a node is passed over) and that node.
 */
function enteringTop(root: object): { readonly top: object; readonly parent: object } | undefined {
  if (NODE.get(root)?.insideTree === true) return undefined;
  let top = root;
  for (let parent = parentEntity(root); parent !== null; parent = parentEntity(parent)) {
    if (NODE.get(parent)?.insideTree === true) return { top, parent };
    if (!FOREIGN.has(parent) && (NODE.has(parent) || nameOf(parent) !== '')) top = parent;
  }
  return undefined;
}

/**
 * Seats a scene React committed: its nodes' classes recorded and its deferred node-path fields set,
 * as `SceneState::instantiate` finishes the scene before anything enters the tree
 * (`packed_scene.cpp:597`). Called from the scene component's last effect, once its scripts are
 * attached.
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:597
 */
export function godot_node_seat(root: object): void {
  seatGodotScriptForest([root], []);
  for (const set of DEFERRED_NODE_PATHS.splice(0)) set();
}

/**
 * A seated scene enters the tree when its parent is inside it, as `add_child` enters a child
 * (`scene/main/node.cpp:341-362`): parent first, running its scripts' `_enter_tree`, then readying
 * children first under a ready parent, running their `_ready`. A scene whose parent is not yet
 * inside the tree does not enter: the enclosing scene, entering later, takes it with the rest.
 * The tree's root is the three scene the nodes hang from, entered the first time a scene reaches
 * it. It runs once React's commit is done, so a `_ready` that adds a scene can mount it at once.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:341
 */
export function godot_node_enter(root: object): void {
  let top = root as { readonly parent?: object | null; readonly isScene?: boolean };
  while (top.parent !== undefined && top.parent !== null) top = top.parent as typeof top;
  if (top.isScene === true && NODE.get(top)?.insideTree !== true) godot_tree_set_root(top);
  const entering = enteringTop(root);
  if (entering !== undefined && entering.top === root) enterTree(root, entering.parent);
}

/**
 * A scene React unmounts exits what of it is still inside the tree, children first, running its
 * scripts' `_exit_tree`.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:410
 */
export function godot_node_exit(root: object): void {
  exitRoots([root]);
}

/** How a scene not yet mounted is added: it mounts under the parent and its mounted root is returned. */
let addUnmounted: ((parent: object, child: object) => object | undefined) | undefined;

/**
 * Registers how `add_child` adds an instantiated scene React has not mounted (`PackedScene`): the
 * handler mounts it under the parent and returns its mounted root, or returns undefined for any
 * other node.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:1711
 */
export function godot_node_add_unmounted(handler: (parent: object, child: object) => object | undefined): void {
  addUnmounted = handler;
}

/**
 * The node React mounted for an instantiated scene's root stands for the stand-in the script
 * held until then: every call through either reaches the mounted node.
 *
 * @godot Node (protocol)
 * @source scene/resources/packed_scene.cpp:318
 */
export function godot_node_stand_in(standIn: object, mounted: object): void {
  STANDS_FOR.set(standIn, mounted);
}

// --- Input processing.

/**
 * @godot Node.set_process_input
 * @source scene/main/node.cpp:1255
 */
export function set_process_input(self: object, enable: boolean): void {
  nodeState(self, 'set_process_input').input = Boolean(enable);
}

/**
 * @godot Node.is_processing_input
 * @source scene/main/node.cpp:1273
 */
export function is_processing_input(self: object): boolean {
  return nodeState(self, 'is_processing_input').input;
}

/**
 * @godot Node.set_process_shortcut_input
 * @source scene/main/node.cpp:1277
 */
export function set_process_shortcut_input(self: object, enable: boolean): void {
  nodeState(self, 'set_process_shortcut_input').shortcutInput = Boolean(enable);
}

/**
 * @godot Node.is_processing_shortcut_input
 * @source scene/main/node.cpp:1294
 */
export function is_processing_shortcut_input(self: object): boolean {
  return nodeState(self, 'is_processing_shortcut_input').shortcutInput;
}

/**
 * @godot Node.set_process_unhandled_input
 * @source scene/main/node.cpp:1298
 */
export function set_process_unhandled_input(self: object, enable: boolean): void {
  nodeState(self, 'set_process_unhandled_input').unhandledInput = Boolean(enable);
}

/**
 * @godot Node.is_processing_unhandled_input
 * @source scene/main/node.cpp:1315
 */
export function is_processing_unhandled_input(self: object): boolean {
  return nodeState(self, 'is_processing_unhandled_input').unhandledInput;
}

/**
 * @godot Node.set_process_unhandled_key_input
 * @source scene/main/node.cpp:1319
 */
export function set_process_unhandled_key_input(self: object, enable: boolean): void {
  nodeState(self, 'set_process_unhandled_key_input').unhandledKeyInput = Boolean(enable);
}

/**
 * @godot Node.is_processing_unhandled_key_input
 * @source scene/main/node.cpp:1336
 */
export function is_processing_unhandled_key_input(self: object): boolean {
  return nodeState(self, 'is_processing_unhandled_key_input').unhandledKeyInput;
}

/**
 * Sets a node class's own input handler of `kind` (the `input()` a native class overrides), run
 * after the script's while the event is unhandled.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:3564
 */
export function godot_node_set_internal_input(entity: object, kind: GodotInputKind, handler: ((event: unknown) => void) | undefined): void {
  const internal = stateOf(entity).internalInput;
  if (handler === undefined) delete internal[kind];
  else internal[kind] = handler;
}

/**
 * The nodes under `root` whose `kind` processing is on, in the order `SceneTree::_call_input_pause`
 * calls them: the group's tree order, from the last (`scene/main/scene_tree.cpp:1461`).
 *
 * @godot Node (protocol)
 * @source scene/main/scene_tree.cpp:1430
 */
export function godot_node_input_receivers(root: object, kind: GodotInputKind): object[] {
  const found: object[] = [];
  const visit = (entity: object): void => {
    const state = NODE.get(entity);
    if (state !== undefined && state.insideTree && state[kind]) found.push(entity);
    for (const child of childEntities(entity)) visit(child);
  };
  visit(root);
  return found.reverse();
}

/**
 * A script's input callback for one stage (`_input`, `_unhandled_input`, ...), which the viewport
 * calls in Godot's order as it delivers events (`Node::_call_input`, `node.cpp:3474`); the returned
 * call removes it. The node's component adds it from its own effect.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:3474
 */
export function godot_node_listen_input(entity: object, kind: GodotInputKind, listener: (event: unknown) => void): () => void {
  const state = stateOf(entity);
  state.binding = { ...(state.binding ?? { owner: entity }), [kind]: listener } as GodotScriptLifecycleBinding;
  return () => {
    if (state.binding?.[kind] !== listener) return;
    state.binding = { ...state.binding, [kind]: undefined } as GodotScriptLifecycleBinding;
  };
}

/**
 * `Node::_call_input` and its siblings (`scene/main/node.cpp:3564`): a node that can process gets
 * the script's callback, then, while the event is unhandled and the node inside the tree, the
 * class's own. `handled` reads the viewport's state.
 *
 * @godot Node (protocol)
 * @source scene/main/node.cpp:3564
 */
export function godot_node_call_input(entity: object, kind: GodotInputKind, event: unknown, handled: () => boolean): void {
  const state = NODE.get(entity);
  if (state === undefined || !state.insideTree || !state[kind] || !processModeAllows(entity, state, false)) return;
  state.binding?.[kind]?.(event);
  if (!state.insideTree || handled()) return;
  state.internalInput[kind]?.(event);
}
