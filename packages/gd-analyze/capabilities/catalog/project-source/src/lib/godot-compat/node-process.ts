import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/**
 * Godot Node processing flags, kept on the translated node that owns them.
 *
 * Godot constructs every flag disabled, auto-enables the callbacks a script overrides immediately
 * before `_ready`, then lets `set_process*` change the corresponding SceneTree membership at
 * runtime. An overridden callback's auto-enable supersedes an earlier false; for a callback the
 * script does not override, an earlier setter is preserved. The renderer/scheduler remains native:
 * generated lifecycle walks consult these flags at the callback sites they already own.
 */

export interface GodotNodeProcessMethods {
  readonly process?: boolean;
  readonly physicsProcess?: boolean;
  readonly input?: boolean;
  readonly unhandledInput?: boolean;
  readonly unhandledKeyInput?: boolean;
}

/**
 * One generated script attachment seated on its retained native node.
 *
 * This is a PROTOCOL input, not another node model: `native` is the actual Three/Pixi entity and
 * the callbacks close over the one generated script instance owned by the scene component.
 */
export interface GodotScriptLifecycleBinding {
  readonly native: object;
  readonly owner: object;
  readonly enterTree?: () => void;
  readonly ready?: () => void;
  readonly exitTree?: () => void;
}

interface NativeHierarchyNode {
  readonly children?: readonly object[];
}

interface NodeProcessState {
  methods: GodotNodeProcessMethods;
  readyInitialized: boolean;
  process: boolean;
  physicsProcess: boolean;
  input: boolean;
  unhandledInput: boolean;
  unhandledKeyInput: boolean;
  processMode: number;
  processPriority: number;
  ready: SignalHandle<[]>;
}

const PROCESS_BY_NODE = new WeakMap<object, NodeProcessState>();

/** Godot 4's Node.ProcessMode namespace as an immutable script-visible enum value. */
export const GODOT_NODE_PROCESS_MODE = Object.freeze({
  PROCESS_MODE_INHERIT: 0,
  PROCESS_MODE_PAUSABLE: 1,
  PROCESS_MODE_WHEN_PAUSED: 2,
  PROCESS_MODE_ALWAYS: 3,
  PROCESS_MODE_DISABLED: 4,
});

function requireObject(node: unknown, member: string): object {
  if ((typeof node !== 'object' || node === null) && typeof node !== 'function') {
    throw new TypeError(`godot-compat: Node.${member} requires a translated Node receiver.`);
  }
  return node as object;
}

function fresh(methods: GodotNodeProcessMethods = {}): NodeProcessState {
  return {
    methods,
    readyInitialized: false,
    process: false,
    physicsProcess: false,
    input: false,
    unhandledInput: false,
    unhandledKeyInput: false,
    processMode: 0,
    processPriority: 0,
    ready: createSignal<[]>(),
  };
}

function stateOf(node: unknown, member: string): NodeProcessState {
  const key = requireObject(node, member);
  let state = PROCESS_BY_NODE.get(key);
  if (state === undefined) {
    state = fresh();
    PROCESS_BY_NODE.set(key, state);
  }
  return state;
}

/** Bind a script owner and its retained renderer node to one Godot Node processing record. */
export function bindNodeProcessing(
  owner: object,
  node: object,
  methods: GodotNodeProcessMethods,
): () => void {
  const existingOwner = PROCESS_BY_NODE.get(owner);
  const existingNode = PROCESS_BY_NODE.get(node);
  if (existingOwner !== undefined && existingNode !== undefined && existingOwner !== existingNode) {
    throw new Error('godot-compat: a translated Node was bound to two processing owners.');
  }
  const state = existingOwner ?? existingNode ?? fresh();
  state.methods = Object.freeze({ ...methods });
  PROCESS_BY_NODE.set(owner, state);
  PROCESS_BY_NODE.set(node, state);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (PROCESS_BY_NODE.get(owner) === state) PROCESS_BY_NODE.delete(owner);
    if (PROCESS_BY_NODE.get(node) === state) PROCESS_BY_NODE.delete(node);
  };
}

/**
 * Mount generated script attachments by walking the retained native hierarchy itself.
 *
 * Godot 4.7's pinned `Node::_propagate_enter_tree` calls `_enter_tree` parent-first while
 * `_propagate_ready` calls `_ready` child-first in authored sibling order; teardown walks siblings
 * in reverse and calls `_exit_tree` child-first (`scene/main/node.cpp:323-455`, revision
 * 5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88). The transient map below only associates generated
 * callbacks with native identities for this mount. It neither owns nor mirrors hierarchy.
 */
export function mountGodotScriptTree(
  root: object,
  bindings: readonly GodotScriptLifecycleBinding[],
): () => void {
  return mountGodotScriptForest([root], bindings);
}

/**
 * Mount the ordered native roots present at Godot project startup as one lifecycle transaction.
 *
 * Godot 4.7 constructs every autoload first, adds each to SceneTree root, adds the main scene, and
 * only then propagates ready from that root (`main/main.cpp:4493-4560`). The roots here are the
 * actual renderer objects in that same order. This function owns only Godot notification policy;
 * it neither creates nor retains a second hierarchy.
 */
export function mountGodotScriptForest(
  roots: readonly object[],
  bindings: readonly GodotScriptLifecycleBinding[],
): () => void {
  const byNative = new Map<object, GodotScriptLifecycleBinding>();
  const owners = new Set<object>();
  for (const binding of bindings) {
    if (byNative.has(binding.native)) {
      throw new Error('godot-compat: a native node has two generated script attachments.');
    }
    if (owners.has(binding.owner)) {
      throw new Error('godot-compat: a generated script instance is attached to two native nodes.');
    }
    byNative.set(binding.native, binding);
    owners.add(binding.owner);
  }

  const visited = new Set<object>();
  const collect = (node: object): void => {
    if (visited.has(node)) {
      throw new Error('godot-compat: a native node appears beneath two mounted roots.');
    }
    visited.add(node);
    for (const child of (node as NativeHierarchyNode).children ?? []) collect(child);
  };
  for (const root of roots) collect(root);
  for (const binding of bindings) {
    if (!visited.has(binding.native)) {
      throw new Error(
        'godot-compat: a generated script attachment is outside its mounted native root.',
      );
    }
  }

  const releases = bindings.map((binding) => bindNodeProcessing(binding.owner, binding.native, {}));
  const enter = (node: object): void => {
    byNative.get(node)?.enterTree?.();
    for (const child of (node as NativeHierarchyNode).children ?? []) enter(child);
  };
  for (const root of roots) enter(root);
  const ready = (node: object): void => {
    for (const child of (node as NativeHierarchyNode).children ?? []) ready(child);
    const binding = byNative.get(node);
    if (binding === undefined) return;
    initializeNodeProcessingForReady(binding.owner);
    binding.ready?.();
    markNodeReady(binding.owner);
  };
  for (const root of roots) ready(root);

  let mounted = true;
  return () => {
    if (!mounted) return;
    mounted = false;
    const exit = (node: object): void => {
      const children = (node as NativeHierarchyNode).children ?? [];
      for (let index = children.length - 1; index >= 0; index -= 1) exit(children[index]!);
      byNative.get(node)?.exitTree?.();
    };
    for (let index = roots.length - 1; index >= 0; index -= 1) exit(roots[index]!);
    for (let index = releases.length - 1; index >= 0; index -= 1) releases[index]!();
  };
}

/** Apply constructor-time flags set by a native Godot node class before script ready dispatch. */
export function seedNodeProcessing(node: object, enabled: GodotNodeProcessMethods): void {
  const state = stateOf(node, 'seed native processing');
  if (enabled.process === true) state.process = true;
  if (enabled.physicsProcess === true) state.physicsProcess = true;
  if (enabled.input === true) state.input = true;
  if (enabled.unhandledInput === true) state.unhandledInput = true;
  if (enabled.unhandledKeyInput === true) state.unhandledKeyInput = true;
}

/**
 * Godot's `Node::_notification(NOTIFICATION_READY)` auto-enables every overridden callback before
 * invoking `_ready` (`scene/main/node.cpp`, pinned 3.6-stable). For an overridden callback this
 * supersedes an earlier false from `_init`; a non-overridden flag is untouched, and a setter inside
 * `_ready` runs afterward and therefore wins.
 */
export function initializeNodeProcessingForReady(node: object): void {
  const state = stateOf(node, 'initialize processing');
  if (state.readyInitialized) return;
  state.readyInitialized = true;
  if (state.methods.process === true) state.process = true;
  if (state.methods.physicsProcess === true) state.physicsProcess = true;
  if (state.methods.input === true) state.input = true;
  if (state.methods.unhandledInput === true) state.unhandledInput = true;
  if (state.methods.unhandledKeyInput === true) state.unhandledKeyInput = true;
}

/** Whether the node has completed its most recent SceneTree ready notification. */
export function isNodeReady(node: object): boolean {
  return stateOf(node, 'is_node_ready').readyInitialized;
}

/** The built-in Node.ready signal belonging to the retained node identity. */
export function getNodeReadySignal(node: object): GodotSignal<[]> {
  return stateOf(node, 'ready').ready.signal;
}

/** Complete ready after the node's own `_ready` callback, then emit the built-in signal. */
export function markNodeReady(node: object): void {
  const state = stateOf(node, 'ready');
  if (!state.readyInitialized) {
    throw new Error('godot-compat: Node.ready cannot emit before ready initialization.');
  }
  state.ready.emit();
}

/** Schedule the node to receive ready again the next time it enters a SceneTree. */
export function requestNodeReady(node: object): void {
  stateOf(node, 'request_ready').readyInitialized = false;
}

export function setNodeProcess(node: object, enabled: boolean): void {
  stateOf(node, 'set_process').process = Boolean(enabled);
}

function effectiveProcessMode(node: object, state: NodeProcessState): number {
  if (state.processMode !== 0) return state.processMode;
  let parent = (node as { readonly parent?: object | null }).parent ?? null;
  while (parent !== null) {
    const inherited = PROCESS_BY_NODE.get(parent)?.processMode ?? 0;
    if (inherited !== 0) return inherited;
    parent = (parent as { readonly parent?: object | null }).parent ?? null;
  }
  return 1;
}

function processModeAllows(node: object, state: NodeProcessState, paused: boolean): boolean {
  const mode = effectiveProcessMode(node, state);
  if (mode === 4) return false;
  if (mode === 3) return true;
  if (mode === 2) return paused;
  return !paused;
}

/** `Node.can_process()` is the effective pause/process-mode decision independent of callback flags. */
export function canNodeProcess(node: object, paused = false): boolean {
  const state = stateOf(node, 'can_process');
  return processModeAllows(node, state, paused);
}

export function isNodeProcessing(node: object, paused = false): boolean {
  const state = stateOf(node, 'is_processing');
  return state.process && processModeAllows(node, state, paused);
}

export function setNodePhysicsProcess(node: object, enabled: boolean): void {
  stateOf(node, 'set_physics_process').physicsProcess = Boolean(enabled);
}

export function isNodePhysicsProcessing(node: object, paused = false): boolean {
  const state = stateOf(node, 'is_physics_processing');
  return state.physicsProcess && processModeAllows(node, state, paused);
}

/** Godot 4 Node.process_mode. The current exported host has no paused SceneTree state, so
 * PROCESS_MODE_WHEN_PAUSED is inactive and PROCESS_MODE_DISABLED is always inactive. */
export function setNodeProcessMode(node: object, mode: number): void {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 4) {
    throw new RangeError('godot-compat: Node.process_mode requires integer 0..4.');
  }
  stateOf(node, 'set_process_mode').processMode = mode;
}

export function getNodeProcessMode(node: object): number {
  return stateOf(node, 'get_process_mode').processMode;
}

/** Godot 3 Node.pause_mode mapped onto the same effective processing policy. */
export function setNodePauseMode(node: object, mode: unknown): void {
  if (!Number.isSafeInteger(mode) || Number(mode) < 0 || Number(mode) > 2) {
    throw new RangeError('godot-compat: Node.pause_mode requires integer 0..2.');
  }
  // INHERIT=0, STOP=1 (pausable), PROCESS=2 (always).
  stateOf(node, 'set pause_mode').processMode = mode === 2 ? 3 : Number(mode);
}

export function getNodePauseMode(node: object): number {
  const mode = stateOf(node, 'get pause_mode').processMode;
  // Godot 3 has only INHERIT, STOP, PROCESS. States set through this dialect therefore map
  // losslessly; defensive mapping keeps a Godot 4-only pause policy from leaking a bogus enum.
  if (mode === 0) return 0;
  if (mode === 3) return 2;
  return 1;
}

export function setNodeProcessPriority(node: object, priority: unknown): void {
  if (!Number.isSafeInteger(priority) || Number(priority) < -4096 || Number(priority) > 4096) {
    throw new RangeError('godot-compat: Node.process_priority requires integer -4096..4096.');
  }
  stateOf(node, 'set process_priority').processPriority = Number(priority);
}

export function getNodeProcessPriority(node: object): number {
  return stateOf(node, 'get process_priority').processPriority;
}

export function setNodeProcessInput(node: object, enabled: boolean): void {
  stateOf(node, 'set_process_input').input = Boolean(enabled);
}

export function isNodeProcessingInput(node: object, paused = false): boolean {
  const state = stateOf(node, 'is_processing_input');
  return state.input && processModeAllows(node, state, paused);
}

export function setNodeProcessUnhandledInput(node: object, enabled: boolean): void {
  stateOf(node, 'set_process_unhandled_input').unhandledInput = Boolean(enabled);
}

export function isNodeProcessingUnhandledInput(node: object, paused = false): boolean {
  const state = stateOf(node, 'is_processing_unhandled_input');
  return state.unhandledInput && processModeAllows(node, state, paused);
}

export function setNodeProcessUnhandledKeyInput(node: object, enabled: boolean): void {
  stateOf(node, 'set_process_unhandled_key_input').unhandledKeyInput = Boolean(enabled);
}

export function isNodeProcessingUnhandledKeyInput(node: object, paused = false): boolean {
  const state = stateOf(node, 'is_processing_unhandled_key_input');
  return state.unhandledKeyInput && processModeAllows(node, state, paused);
}
