/**
 * @godot-class AnimationTree
 * @role PROTOCOL
 *
 * Godot 4.7's `AnimationTree` (`scene/animation/animation_tree.cpp`) and the blend-tree nodes the
 * corpus uses (`scene/animation/animation_blend_tree.cpp`: `AnimationNodeBlendTree`,
 * `AnimationNodeAnimation`, `AnimationNodeBlend2`, `AnimationNodeTimeScale`,
 * `AnimationNodeOutput`), revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`, over compat's
 * AnimationMixer: the tree takes its AnimationPlayer's libraries and root node, keeps each node's
 * parameters under `parameters/<path>/<name>`, and each process walks the root node down to its
 * animation nodes, which make the mixer's animation instances with per-track weights. Deterministic,
 * discrete tracks forced continuous (`AnimationTree::AnimationTree`). Not transcribed (they throw):
 * state machines, blend spaces, one-shots, transitions, add/sub nodes, custom timelines, ping-pong
 * loops and root motion.
 */

import { Group, type Object3D } from 'three';
import type { ReactElement } from 'react';
import type { Animation } from './animation';
import {
  type GodotAnimationPlaybackInfo,
  add_animation_library,
  clear_caches,
  get_animation_library,
  get_animation_library_list,
  get_root_node,
  godot_animation_mixer_adopt,
  godot_animation_mixer_animation,
  godot_animation_mixer_bind,
  godot_animation_mixer_emit,
  godot_animation_mixer_make_instance,
  godot_animation_mixer_set_process,
  godot_animation_mixer_signal,
  is_active,
  remove_animation_library,
  set_active,
  set_callback_mode_discrete,
  set_callback_mode_method,
  set_callback_mode_process,
  set_deterministic,
  set_root_node,
  type GodotAnimationBindings,
} from './animation-mixer';
import { get_name, get_node_or_null, get_parent, godot_is_native, godot_node_entity, godot_node_tree_signal, is_inside_tree } from './node';
import { godot_message_queue_push } from './object';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type SignalHandle } from './signal';

const f32 = Math.fround;
const CMP_EPSILON = 0.00001;
/** `AnimationNode::FilterAction` (`animation_tree.h:52`). */
const FILTER_IGNORE = 0;
const FILTER_PASS = 1;
const FILTER_BLEND = 3;
/** `Animation::LoopMode` / `LoopedFlag` (`animation.h:74`, `:81`). */
const LOOP_NONE = 0;
const LOOP_LINEAR = 1;
const LOOPED_FLAG_NONE = 0;
const LOOPED_FLAG_END = 1;
const LOOPED_FLAG_START = 2;
/** `Animation::PARAMETERS_BASE_PATH` (`animation.h:40`). */
const BASE = 'parameters/';

/** `Math::is_equal_approx(double, double)` (`math_funcs.h:528`). */
function isEqualApprox(a: number, b: number): boolean {
  if (a === b) return true;
  let tolerance = CMP_EPSILON * Math.abs(a);
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(a - b) < tolerance;
}
const less = (a: number, b: number) => a < b && !isEqualApprox(a, b);
const lessOrEqual = (a: number, b: number) => a < b || isEqualApprox(a, b);
const greater = (a: number, b: number) => a > b && !isEqualApprox(a, b);
const greaterOrEqual = (a: number, b: number) => a > b || isEqualApprox(a, b);
const isZeroApprox = (value: number) => Math.abs(value) < CMP_EPSILON;
/** `Math::is_zero_approx(float)`. */
const isZeroApproxF = (value: number) => Math.abs(value) < f32(CMP_EPSILON);
function fposmod(x: number, y: number): number {
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return value + 0;
}

// --- Nodes (resources).

export interface AnimationNodeBase {
  readonly inputs: string[];
  filterEnabled: boolean;
  readonly filters: Set<string>;
}
export interface AnimationNodeAnimation extends AnimationNodeBase {
  readonly kind: 'animation';
  animation: string;
  playMode: number;
  advanceOnStart: boolean;
}
export interface AnimationNodeBlend2 extends AnimationNodeBase {
  readonly kind: 'blend2';
  sync: boolean;
}
export interface AnimationNodeTimeScale extends AnimationNodeBase {
  readonly kind: 'time-scale';
}
export interface AnimationNodeOutput extends AnimationNodeBase {
  readonly kind: 'output-node';
}
export interface AnimationNodeBlendTree extends AnimationNodeBase {
  readonly kind: 'blend-tree';
  /** Nodes by name (`output` first), each with its inputs' connected node names. */
  readonly nodes: Map<string, { readonly node: AnimationNode; readonly connections: string[] }>;
}
export type AnimationNode = AnimationNodeAnimation | AnimationNodeBlend2 | AnimationNodeTimeScale | AnimationNodeOutput | AnimationNodeBlendTree;

/** A node as the translation's data file writes it. */
export type GodotAnimationNodeData =
  | { readonly type: 'animation'; readonly animation: string; readonly playMode?: number; readonly advanceOnStart?: boolean }
  | { readonly type: 'blend2'; readonly sync?: boolean; readonly filterEnabled?: boolean; readonly filters?: readonly string[] }
  | { readonly type: 'time-scale' }
  | {
      readonly type: 'blend-tree';
      readonly nodes: readonly { readonly name: string; readonly node: GodotAnimationNodeData }[];
      /** `node_connections`: input node, input index, output node. */
      readonly connections: readonly (readonly [string, number, string])[];
    };

const base = (inputs: string[]): AnimationNodeBase => ({ inputs, filterEnabled: false, filters: new Set() });

/**
 * A node as its file states it (the classes' `_set` and constructors, `animation_blend_tree.cpp`):
 * a blend tree's `output`, then its nodes and their `node_connections`.
 *
 * @godot AnimationNodeBlendTree (protocol)
 * @source scene/animation/animation_blend_tree.cpp:1740
 */
export function godot_animation_node_load(data: GodotAnimationNodeData): AnimationNode {
  switch (data.type) {
    case 'animation':
      return { kind: 'animation', ...base([]), animation: data.animation, playMode: data.playMode ?? 0, advanceOnStart: data.advanceOnStart ?? false };
    case 'blend2': {
      const node: AnimationNodeBlend2 = { kind: 'blend2', ...base(['in', 'blend']), sync: data.sync ?? false };
      node.filterEnabled = data.filterEnabled ?? false;
      for (const path of data.filters ?? []) node.filters.add(path);
      return node;
    }
    case 'time-scale':
      return { kind: 'time-scale', ...base(['in']) };
    case 'blend-tree': {
      const tree: AnimationNodeBlendTree = { kind: 'blend-tree', ...base([]), nodes: new Map() };
      tree.nodes.set('output', { node: { kind: 'output-node', ...base(['output']) }, connections: [''] });
      for (const { name, node } of data.nodes) {
        const made = godot_animation_node_load(node);
        tree.nodes.set(name, { node: made, connections: made.inputs.map(() => '') });
      }
      for (const [input, index, output] of data.connections) {
        const entry = tree.nodes.get(input);
        if (entry !== undefined && tree.nodes.has(output) && index >= 0 && index < entry.connections.length) entry.connections[index] = output;
      }
      return tree;
    }
  }
}

/** A node's parameters and their defaults (`get_parameter_list`, `get_parameter_default_value`). */
function parametersOf(node: AnimationNode): [string, number | boolean][] {
  const core: [string, number | boolean][] = [['current_length', 0], ['current_position', 0], ['current_delta', 0]];
  if (node.kind === 'animation') return [...core, ['backward', false]];
  if (node.kind === 'blend2') return [...core, ['blend_amount', 0]];
  if (node.kind === 'time-scale') return [...core, ['scale', 1]];
  return core;
}

// --- The tree's per-node state (`AnimationNodeInstance`, `animation_tree.h:258`).

interface Instance {
  readonly path: string;
  readonly node: AnimationNode;
  readonly parameters: Map<string, { value: number | boolean; readonly readOnly: boolean }>;
  readonly children: Map<string, Instance>;
  connections: (Instance | undefined)[];
  trackWeights: number[];
  blended: boolean;
  /** An animation node's animation, found once (`_update_animation_cache`, `animation_blend_tree.cpp:417`). */
  cachedAnimation: Animation | undefined;
}

interface NodeTimeInfo {
  length: number;
  position: number;
  delta: number;
  loopMode: number;
  willEnd: boolean;
}
const noTime = (): NodeTimeInfo => ({ length: 0, position: 0, delta: 0, loopMode: LOOP_NONE, willEnd: false });

interface ProcessState {
  valid: boolean;
  trackMap: ReadonlyMap<string, number>;
}

interface TreeState {
  readonly entity: object;
  root: AnimationNode | null;
  animationPlayer: string;
  /** `property_map`: every node's parameters by full name (`parameters/run/blend_amount`). */
  readonly properties: Map<string, { value: number | boolean; readonly readOnly: boolean }>;
  readonly instances: Map<string, Instance>;
  propertiesDirty: boolean;
  started: boolean;
  readonly animationPlayerChanged: SignalHandle<[]>;
  playerHooked: object | undefined;
}

const TREES = new WeakMap<object, TreeState>();

function stateOf(self: object, member: string): TreeState {
  const state = TREES.get(godot_node_entity(self));
  if (state === undefined) throw new TypeError(`godot-compat: AnimationTree.${member} requires an AnimationTree receiver.`);
  return state;
}

/** `_update_properties` (`animation_tree.cpp:868`), with `_update_connections` (`:920`). */
function updateProperties(state: TreeState): void {
  if (!state.propertiesDirty) return;
  state.instances.clear();
  const visit = (path: string, node: AnimationNode): Instance => {
    const parameters = new Map<string, { value: number | boolean; readonly readOnly: boolean }>();
    for (const [name, initial] of parametersOf(node)) {
      const key = `${path}${name}`;
      let entry = state.properties.get(key);
      if (entry === undefined) {
        entry = { value: initial, readOnly: name.startsWith('current_') };
        state.properties.set(key, entry);
      }
      parameters.set(name, entry);
    }
    const instance: Instance = { path, node, parameters, children: new Map(), connections: [], trackWeights: [], blended: false, cachedAnimation: undefined };
    state.instances.set(path, instance);
    if (node.kind === 'blend-tree') {
      for (const [name, entry] of node.nodes) instance.children.set(name, visit(`${path}${name}/`, entry.node));
    }
    return instance;
  };
  if (state.root !== null) visit(BASE, state.root);
  for (const instance of state.instances.values()) {
    if (instance.node.kind !== 'blend-tree') continue;
    const tree = instance.node;
    instance.connections = [instance.children.get(tree.nodes.get('output')?.connections[0] ?? '')];
    for (const [name, child] of instance.children) {
      child.connections = (tree.nodes.get(name)?.connections ?? []).map((connected) => instance.children.get(connected));
    }
  }
  state.propertiesDirty = false;
}

const parameter = (instance: Instance, name: string): number | boolean => instance.parameters.get(name)?.value ?? 0;
const setParameter = (instance: Instance, name: string, value: number | boolean, testOnly: boolean): void => {
  if (testOnly) return;
  const entry = instance.parameters.get(name);
  if (entry !== undefined) entry.value = value;
};

/** `_blend_node` (`animation_tree.cpp:171`). */
function blendNode(state: TreeState, ps: ProcessState, instance: Instance, other: Instance, info: GodotAnimationPlaybackInfo, filter: number, sync: boolean, testOnly: boolean): NodeTimeInfo {
  const count = instance.trackWeights.length;
  if (other.trackWeights.length !== count) other.trackWeights.length = count;
  const w = other.trackWeights;
  const r = instance.trackWeights;
  const weight = f32(info.weight);
  let anyValid = false;
  const node = instance.node;
  if (node.kind === 'blend2' && node.filterEnabled && filter !== FILTER_IGNORE) {
    for (let i = 0; i < count; i += 1) w[i] = 0;
    for (const path of node.filters) {
      const index = ps.trackMap.get(path);
      if (index !== undefined) w[index] = 1;
    }
    for (let i = 0; i < count; i += 1) {
      if (filter === FILTER_PASS) {
        if (w[i] === 0) continue;
        w[i] = f32((r[i] as number) * weight);
      } else if (filter === FILTER_BLEND) {
        w[i] = w[i] === 1 ? f32((r[i] as number) * weight) : (r[i] as number);
      } else {
        if ((w[i] as number) > 0) continue;
        w[i] = f32((r[i] as number) * weight);
      }
      if (!isZeroApproxF(w[i] as number)) anyValid = true;
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      w[i] = f32((r[i] as number) * weight);
      if (!isZeroApproxF(w[i] as number)) anyValid = true;
    }
  }
  const passed = !info.seeked && !sync && !anyValid ? { ...info, delta: 0 } : info;
  other.blended = anyValid;
  return process(state, ps, other, passed, testOnly);
}

/** `blend_input` (`animation_tree.cpp:139`). */
function blendInput(state: TreeState, ps: ProcessState, instance: Instance, input: number, info: GodotAnimationPlaybackInfo, filter: number, sync: boolean, testOnly: boolean): NodeTimeInfo {
  const other = instance.connections[input];
  if (other === undefined) {
    if (!testOnly && instance.blended) ps.valid = false;
    return noTime();
  }
  return blendNode(state, ps, instance, other, info, filter, sync, testOnly);
}

/** `AnimationNode::process` (`animation_tree.cpp:320`). */
function process(state: TreeState, ps: ProcessState, instance: Instance, info: GodotAnimationPlaybackInfo, testOnly: boolean): NodeTimeInfo {
  const position = parameter(instance, 'current_position') as number;
  let pi: GodotAnimationPlaybackInfo = info;
  if (info.seeked) {
    if (info.isExternalSeeking) pi = { ...info, delta: position - info.time };
  } else {
    const delta = instance.node.kind === 'animation' && parameter(instance, 'backward') === true ? -info.delta : info.delta;
    pi = { ...info, time: position + delta };
  }
  const nti = processNode(state, ps, instance, pi, testOnly);
  if (!testOnly) {
    setParameter(instance, 'current_length', nti.length, false);
    setParameter(instance, 'current_position', nti.position, false);
    setParameter(instance, 'current_delta', nti.delta, false);
  }
  return nti;
}

function processNode(state: TreeState, ps: ProcessState, instance: Instance, info: GodotAnimationPlaybackInfo, testOnly: boolean): NodeTimeInfo {
  const node = instance.node;
  switch (node.kind) {
    case 'blend-tree': {
      const output = instance.children.get('output');
      if (output === undefined) return noTime();
      return blendNode(state, ps, instance, output, { ...info, weight: 1 }, FILTER_IGNORE, true, testOnly);
    }
    case 'output-node':
      return blendInput(state, ps, instance, 0, { ...info, weight: 1 }, FILTER_IGNORE, true, testOnly);
    case 'time-scale': {
      const scale = parameter(instance, 'scale') as number;
      return blendInput(state, ps, instance, 0, { ...info, weight: 1, delta: info.seeked ? info.delta : info.delta * scale }, FILTER_IGNORE, true, testOnly);
    }
    case 'blend2': {
      const amount = parameter(instance, 'blend_amount') as number;
      const nti0 = blendInput(state, ps, instance, 0, { ...info, weight: 1 - amount }, FILTER_BLEND, node.sync, testOnly);
      const nti1 = blendInput(state, ps, instance, 1, { ...info, weight: amount }, FILTER_PASS, node.sync, testOnly);
      return amount > 0.5 ? nti1 : nti0;
    }
    case 'animation':
      return processAnimation(state, ps, instance, node, info, testOnly);
  }
}

/** `AnimationNodeAnimation::_process` (`animation_blend_tree.cpp:102`), forward play, no custom timeline. */
function processAnimation(state: TreeState, ps: ProcessState, instance: Instance, node: AnimationNodeAnimation, info: GodotAnimationPlaybackInfo, testOnly: boolean): NodeTimeInfo {
  // The instance keeps the animation it found until the node's animation changes, whatever the
  // tree's libraries do since.
  if (instance.cachedAnimation === undefined) instance.cachedAnimation = godot_animation_mixer_animation(state.entity, node.animation);
  const anim = instance.cachedAnimation;
  if (anim === undefined) {
    if (!testOnly && instance.blended) ps.valid = false;
    return noTime();
  }
  if (node.playMode !== 0) throw new Error('godot-compat: AnimationNodeAnimation backward play is not transcribed.');
  const animSize = anim.length;
  const curLen = animSize;
  const loopMode = anim.loop_mode;
  if (loopMode !== LOOP_NONE && loopMode !== LOOP_LINEAR) throw new Error('godot-compat: ping-pong animation nodes are not transcribed.');
  let curTime = info.time;
  let curDelta = info.delta;
  let backward = parameter(instance, 'backward') === true;
  const prevTime = parameter(instance, 'current_position') as number;
  let loopedFlag = LOOPED_FLAG_NONE;
  const seek = info.seeked;
  const external = info.isExternalSeeking;
  const willEnd = greaterOrEqual(curTime + curDelta, curLen);
  const isStarted = seek && !external && isZeroApprox(curTime);
  const immediately = isStarted && node.advanceOnStart;
  if (immediately) curTime = curDelta;
  if (loopMode === LOOP_LINEAR) {
    if (!isZeroApprox(curLen)) curTime = fposmod(curTime, curLen);
    backward = false;
  } else {
    if (less(curTime, 0)) {
      curDelta += curTime;
      curTime = 0;
    } else if (greater(curTime, curLen)) {
      curDelta += curTime - curLen;
      curTime = curLen;
    }
    backward = false;
    if (!isZeroApprox(curDelta) && greaterOrEqual(prevTime, curLen)) curDelta = 0;
  }
  const nti: NodeTimeInfo = { length: curLen, position: curTime, delta: curDelta, loopMode, willEnd };
  let prevPlayback = prevTime;
  let curPlayback = curTime;
  if (loopMode === LOOP_LINEAR) {
    if (!isZeroApprox(animSize)) {
      prevPlayback = fposmod(prevPlayback, animSize);
      curPlayback = fposmod(curPlayback, animSize);
      if (greaterOrEqual(prevPlayback, 0) && less(curPlayback, 0)) loopedFlag = LOOPED_FLAG_START;
      if (lessOrEqual(prevPlayback, animSize) && greater(curPlayback, animSize)) loopedFlag = LOOPED_FLAG_END;
    }
  } else {
    if (less(curPlayback, 0)) curPlayback = 0;
    else if (greater(curPlayback, animSize)) curPlayback = animSize;
    if (!testOnly) {
      const entity = state.entity;
      if (isStarted) godot_message_queue_push(entity, () => godot_animation_mixer_emit(entity, 'animation_started', node.animation));
      if (less(prevPlayback, animSize) && greaterOrEqual(curPlayback, animSize)) {
        curPlayback = animSize;
        godot_message_queue_push(entity, () => godot_animation_mixer_emit(entity, 'animation_finished', node.animation));
      }
    }
  }
  if (!testOnly) {
    if (immediately) {
      godot_animation_mixer_make_instance(state.entity, node.animation, { ...info, start: 0, end: animSize, time: 0, delta: 0, weight: f32(CMP_EPSILON), trackWeights: instance.trackWeights });
    }
    godot_animation_mixer_make_instance(state.entity, node.animation, {
      ...info,
      start: 0,
      end: animSize,
      time: curPlayback,
      delta: backward ? -curDelta : curDelta,
      weight: 1,
      loopedFlag,
      trackWeights: instance.trackWeights,
    });
    setParameter(instance, 'backward', backward, false);
  }
  return nti;
}

/** `AnimationTree::_blend_pre_process` (`animation_tree.cpp:660`). */
function blendPreProcess(state: TreeState, delta: number, trackCount: number, trackMap: ReadonlyMap<string, number>): boolean {
  updateProperties(state);
  if (state.root === null) return false;
  const instance = state.instances.get(BASE) as Instance;
  instance.trackWeights.length = trackCount;
  instance.trackWeights.fill(1);
  instance.blended = true;
  const ps: ProcessState = { valid: true, trackMap };
  const seeked = state.started;
  state.started = false;
  process(state, ps, instance, { time: 0, delta, start: 0, end: 0, seeked, isExternalSeeking: false, loopedFlag: LOOPED_FLAG_NONE, weight: 0 }, false);
  return ps.valid;
}

/** A relative NodePath from `from` to `to` (`Node::get_path_to`, `node.cpp:2295`). */
function pathTo(from: object, to: object): string {
  const chain = (node: object): object[] => {
    const out: object[] = [];
    for (let current: object | null = node; current !== null; current = get_parent(current) as object | null) out.push(godot_node_entity(current));
    return out;
  };
  const up = chain(from);
  const down = chain(to);
  const common = up.find((node) => down.includes(node));
  if (common === undefined) return '';
  const ups = up.indexOf(common);
  const names = down.slice(0, down.indexOf(common)).reverse().map((node) => get_name(node));
  const parts = [...Array.from({ length: ups }, () => '..'), ...names];
  return parts.length === 0 ? '.' : parts.join('/');
}

/** `_setup_animation_player` (`animation_tree.cpp:996`). */
function setupAnimationPlayer(state: TreeState): void {
  const entity = state.entity;
  if (!is_inside_tree(entity)) return;
  if (state.animationPlayer === '') {
    clear_caches(entity);
    return;
  }
  const player = get_node_or_null(entity, state.animationPlayer);
  if (player !== null && player !== undefined && godot_is_native(player, 'AnimationPlayer')) {
    const playerEntity = godot_node_entity(player as object);
    if (state.playerHooked !== playerEntity) {
      state.playerHooked = playerEntity;
      // Connected deferred (`CONNECT_DEFERRED`), once.
      const again = () => godot_message_queue_push(entity, () => setupAnimationPlayer(state));
      godot_animation_mixer_signal(playerEntity, 'caches_cleared').connect(again);
      godot_animation_mixer_signal(playerEntity, 'animation_list_changed').connect(again);
    }
    const root = get_node_or_null(playerEntity, get_root_node(playerEntity));
    if (root !== null && root !== undefined) set_root_node(entity, pathTo(entity, root as object));
    for (const name of get_animation_library_list(entity)) remove_animation_library(entity, name);
    for (const name of get_animation_library_list(playerEntity)) {
      const library = get_animation_library(playerEntity, name);
      if (library !== null) add_animation_library(entity, name, library);
    }
  }
  clear_caches(entity);
}

/**
 * Makes an entity an AnimationTree: an AnimationMixer, deterministic with discrete tracks forced
 * continuous (`AnimationTree::AnimationTree`, `animation_tree.cpp:1160`), which takes its
 * AnimationPlayer's libraries and starts processing as it enters the tree (`:968`).
 *
 * @godot AnimationTree (protocol)
 * @source scene/animation/animation_tree.cpp:1160
 */
export function godot_animation_tree_mount(entity: object): void {
  const state: TreeState = {
    entity,
    root: null,
    animationPlayer: '',
    properties: new Map(),
    instances: new Map(),
    propertiesDirty: true,
    started: true,
    animationPlayerChanged: createSignal<[]>(),
    playerHooked: undefined,
  };
  TREES.set(entity, state);
  godot_animation_mixer_adopt(entity, {
    preProcess: (delta, trackCount, trackMap) => blendPreProcess(state, delta, trackCount, trackMap),
    setActive: (active) => {
      godot_animation_mixer_set_process(entity, active);
      state.started = active;
    },
  });
  set_deterministic(entity, true);
  set_callback_mode_discrete(entity, 2);
  godot_node_tree_signal(entity, 'tree_entered').connect(() => {
    setupAnimationPlayer(state);
    if (is_active(entity)) godot_animation_mixer_set_process(entity, true);
  });
}

/**
 * @godot AnimationTree.set_tree_root
 * @source scene/animation/animation_tree.cpp:634
 */
export function set_tree_root(self: object, animation_node: AnimationNode | null): void {
  const state = stateOf(self, 'set_tree_root');
  state.root = animation_node;
  state.propertiesDirty = true;
}

/**
 * @godot AnimationTree.get_tree_root
 * @source scene/animation/animation_tree.cpp:656
 */
export function get_tree_root(self: object): AnimationNode | null {
  return stateOf(self, 'get_tree_root').root;
}

/**
 * An empty path gives the tree its own root node (`..`) and no libraries.
 *
 * @godot AnimationTree.set_animation_player
 * @source scene/animation/animation_tree.cpp:979
 */
export function set_animation_player(self: object, path: string): void {
  const state = stateOf(self, 'set_animation_player');
  state.animationPlayer = String(path);
  if (state.animationPlayer === '') {
    set_root_node(state.entity, '..');
    for (const name of get_animation_library_list(state.entity)) remove_animation_library(state.entity, name);
  }
  state.animationPlayerChanged.emit();
  setupAnimationPlayer(state);
}

/**
 * @godot AnimationTree.get_animation_player
 * @source scene/animation/animation_tree.cpp:992
 */
export function get_animation_player(self: object): string {
  return stateOf(self, 'get_animation_player').animationPlayer;
}

/**
 * `AnimationTree::_set` (`animation_tree.cpp:1057`): a parameter by its full name; a read-only one
 * (`current_*`) inside the tree, or a name the tree has not, is not set (false).
 *
 * @godot AnimationTree (protocol)
 * @source scene/animation/animation_tree.cpp:1057
 */
export function godot_animation_tree_set(self: object, name: string, value: number | boolean): boolean {
  const state = stateOf(self, 'set');
  updateProperties(state);
  const entry = state.properties.get(String(name));
  if (entry === undefined) return false;
  if (is_inside_tree(state.entity) && entry.readOnly) return false;
  entry.value = typeof entry.value === 'boolean' ? Boolean(value) : Number(value);
  return true;
}

/**
 * `AnimationTree::_get` (`animation_tree.cpp:1090`): a parameter by its full name, or undefined.
 *
 * @godot AnimationTree (protocol)
 * @source scene/animation/animation_tree.cpp:1090
 */
export function godot_animation_tree_get(self: object, name: string): number | boolean | undefined {
  const state = stateOf(self, 'get');
  updateProperties(state);
  return state.properties.get(String(name))?.value;
}

// --- The scene's element.

const PROPS = new Map<string, GodotElementProp<Object3D>>([
  ['bindings', (entity, value: GodotAnimationBindings) => godot_animation_mixer_bind(entity, value)],
  ['active', (entity, value: boolean) => set_active(entity, value)],
  ['deterministic', (entity, value: boolean) => set_deterministic(entity, value)],
  ['callbackModeProcess', (entity, value: number) => set_callback_mode_process(entity, value)],
  ['callbackModeMethod', (entity, value: number) => set_callback_mode_method(entity, value)],
  ['callbackModeDiscrete', (entity, value: number) => set_callback_mode_discrete(entity, value)],
  ['rootNode', (entity, value: string) => set_root_node(entity, value)],
  ['treeRoot', (entity, value: AnimationNode) => set_tree_root(entity, value)],
  ['animPlayer', (entity, value: string) => set_animation_player(entity, value)],
  [
    'parameters',
    (entity, value: Readonly<Record<string, number | boolean>>) => {
      for (const [name, entry] of Object.entries(value)) godot_animation_tree_set(entity, `${BASE}${name}`, entry);
    },
  ],
]);

const ANIMATION_TREE = {
  create: () => new Group(),
  classes: ['AnimationTree', 'AnimationMixer', 'Node', 'Object'],
  spatial: false,
  mount: godot_animation_tree_mount,
  props: PROPS,
};

/**
 * An AnimationTree as a scene writes it: `<GodotAnimationTree bindings={…} treeRoot={tree}
 * animPlayer="../Player/AnimationPlayer" parameters={{ 'scale/scale': 1.5 }} />`.
 *
 * @godot AnimationTree (protocol)
 * @source scene/animation/animation_tree.cpp:1160
 */
export function GodotAnimationTree(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(ANIMATION_TREE, props);
}
