/**
 * @godot-class AnimationTree
 * @role PROTOCOL
 *
 * Godot 4.7's `AnimationTree` (`scene/animation/animation_tree.cpp`) and the nodes the corpus uses
 * (`scene/animation/animation_blend_tree.cpp`: `AnimationNodeBlendTree`, `AnimationNodeAnimation`,
 * `AnimationNodeBlend2`, `AnimationNodeAdd2`, `AnimationNodeTimeScale`, `AnimationNodeOneShot`,
 * `AnimationNodeOutput`; `scene/animation/animation_node_state_machine.cpp`: a root or nested
 * `AnimationNodeStateMachine` and its playback), revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`,
 * over compat's AnimationMixer: the tree takes its AnimationPlayer's libraries and root node, keeps
 * each node's parameters under `parameters/<path>/<name>`, and each process walks the root node
 * down to its animation nodes, which make the mixer's animation instances with per-track weights.
 * Deterministic, discrete tracks forced continuous (`AnimationTree::AnimationTree`). Over a glTF's
 * clips (a model's AnimationPlayer, `animation-clips.ts`) the same walk sets each clip's action: its
 * time where the walk put it, its weight the track weights the walk gave it, split into parts where
 * filters weigh its tracks apart; three's mixer averages where Godot's adds, so an Add2 over tracks
 * its first input also animates is averaged in. Not transcribed (they throw): grouped state machines,
 * advance expressions, blend spaces, transition nodes, sub nodes, custom timelines, ping-pong loops,
 * root motion, and fade and cross-fade curves.
 */

import { godot_animation_clips_drive, godot_animation_clips_list, godot_animation_clips_loop, godot_animation_clips_of } from './animation-clips';
import { AnimationClip, type AnimationAction, type AnimationMixer as ThreeAnimationMixer, Group, type KeyframeTrack, type Object3D } from 'three';
import type { ReactElement } from 'react';
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
import {
  type AnimationNodeStateMachinePlayback,
  construct as playback_new,
  godot_node_time_info,
  type GodotNodeTimeInfo,
  godot_state_machine_playback_is_end,
} from './animation-node-state-machine-playback';
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
export interface AnimationNodeOneShot extends AnimationNodeBase {
  readonly kind: 'one-shot';
  /** `MixMode` (`animation_blend_tree.h:131`): blend 0, add 1. */
  mixMode: number;
  fadeIn: number;
  fadeOut: number;
  sync: boolean;
  breakLoopAtEnd: boolean;
  abortOnReset: boolean;
  autoRestart: boolean;
  autoRestartDelay: number;
  autoRestartRandomDelay: number;
}
export interface AnimationNodeOutput extends AnimationNodeBase {
  readonly kind: 'output-node';
}
export interface AnimationNodeAdd2 extends AnimationNodeBase {
  readonly kind: 'add2';
  sync: boolean;
}
export interface AnimationNodeBlendTree extends AnimationNodeBase {
  readonly kind: 'blend-tree';
  /** Nodes by name (`output` first), each with its inputs' connected node names. */
  readonly nodes: Map<string, { readonly node: AnimationNode; readonly connections: string[] }>;
}
/** A state machine's `Start` and `End` (`AnimationNodeStartState`, `AnimationNodeEndState`), which play nothing. */
export interface AnimationNodeEndpoint extends AnimationNodeBase {
  readonly kind: 'start-state' | 'end-state';
}
/** `AnimationNodeStateMachineTransition` (`animation_node_state_machine.h:37`). */
export interface AnimationNodeStateMachineTransition {
  /** `SwitchMode`: immediate 0, sync 1, at end 2. */
  switchMode: number;
  /** `AdvanceMode`: disabled 0, enabled 1, auto 2. */
  advanceMode: number;
  /** `conditions/<name>`, or empty (`advance_condition_name`). */
  advanceConditionName: string;
  xfadeTime: number;
  breakLoopAtEnd: boolean;
  reset: boolean;
  priority: number;
}
export interface AnimationNodeStateMachine extends AnimationNodeBase {
  readonly kind: 'state-machine';
  /** States by name, `Start` and `End` among them, with their graph positions (the travel's costs). */
  readonly states: Map<string, { readonly node: AnimationNode; readonly position: readonly [number, number] }>;
  readonly transitions: { readonly from: string; readonly to: string; readonly transition: AnimationNodeStateMachineTransition }[];
  /** `StateMachineType`: root 0, nested 1. */
  type: number;
  allowTransitionToSelf: boolean;
  resetEnds: boolean;
}
export type AnimationNode =
  | AnimationNodeAnimation
  | AnimationNodeBlend2
  | AnimationNodeAdd2
  | AnimationNodeTimeScale
  | AnimationNodeOneShot
  | AnimationNodeOutput
  | AnimationNodeBlendTree
  | AnimationNodeStateMachine
  | AnimationNodeEndpoint;

/** A parameter's value: a number, a flag, or a state machine's playback. */
export type GodotAnimationTreeValue = number | boolean | AnimationNodeStateMachinePlayback;

/** A node as the translation's data file writes it. */
export type GodotAnimationNodeData =
  | { readonly type: 'animation'; readonly animation: string; readonly playMode?: number; readonly advanceOnStart?: boolean }
  | { readonly type: 'blend2'; readonly sync?: boolean; readonly filterEnabled?: boolean; readonly filters?: readonly string[] }
  | { readonly type: 'time-scale' }
  | {
      readonly type: 'one-shot';
      readonly mixMode?: number;
      readonly fadeIn?: number;
      readonly fadeOut?: number;
      readonly sync?: boolean;
      readonly breakLoopAtEnd?: boolean;
      readonly abortOnReset?: boolean;
      readonly autoRestart?: boolean;
      readonly autoRestartDelay?: number;
      readonly autoRestartRandomDelay?: number;
      readonly filterEnabled?: boolean;
      readonly filters?: readonly string[];
    }
  | { readonly type: 'add2'; readonly sync?: boolean; readonly filterEnabled?: boolean; readonly filters?: readonly string[] }
  | {
      readonly type: 'blend-tree';
      readonly nodes: readonly { readonly name: string; readonly node: GodotAnimationNodeData }[];
      /** `node_connections`: input node, input index, output node. */
      readonly connections: readonly (readonly [string, number, string])[];
    }
  | {
      readonly type: 'state-machine';
      readonly states: readonly { readonly name: string; readonly node: GodotAnimationNodeData; readonly position?: readonly [number, number] }[];
      /** `Start` and `End`'s positions, where the file moves them. */
      readonly endpoints?: { readonly Start?: readonly [number, number]; readonly End?: readonly [number, number] };
      readonly transitions: readonly {
        readonly from: string;
        readonly to: string;
        readonly switchMode?: number;
        readonly advanceMode?: number;
        readonly advanceCondition?: string;
        readonly xfadeTime?: number;
        readonly breakLoopAtEnd?: boolean;
        readonly reset?: boolean;
        readonly priority?: number;
      }[];
      readonly stateMachineType?: number;
      readonly allowTransitionToSelf?: boolean;
      readonly resetEnds?: boolean;
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
    case 'add2': {
      // `AnimationNodeAdd2::AnimationNodeAdd2` (`animation_blend_tree.cpp:829`): inputs `in` and `add`.
      const node: AnimationNodeAdd2 = { kind: 'add2', ...base(['in', 'add']), sync: data.sync ?? false };
      node.filterEnabled = data.filterEnabled ?? false;
      for (const path of data.filters ?? []) node.filters.add(path);
      return node;
    }
    case 'state-machine': {
      // `AnimationNodeStateMachine::AnimationNodeStateMachine` (`animation_node_state_machine.cpp:1887`):
      // `Start` at (200, 100) and `End` at (900, 100), then the file's states and transitions (`_set`, `:1658`).
      const machine: AnimationNodeStateMachine = {
        kind: 'state-machine',
        ...base([]),
        states: new Map([
          ['Start', { node: { kind: 'start-state', ...base([]) }, position: data.endpoints?.Start ?? [200, 100] }],
          ['End', { node: { kind: 'end-state', ...base([]) }, position: data.endpoints?.End ?? [900, 100] }],
        ]),
        transitions: [],
        type: data.stateMachineType ?? 0,
        allowTransitionToSelf: data.allowTransitionToSelf ?? false,
        resetEnds: data.resetEnds ?? false,
      };
      if (machine.type === 2) throw new Error('godot-compat: a grouped AnimationNodeStateMachine is not transcribed.');
      for (const { name, node, position } of data.states) machine.states.set(name, { node: godot_animation_node_load(node), position: position ?? [0, 0] });
      for (const { from, to, ...rest } of data.transitions) {
        // `AnimationNodeStateMachine::add_transition` (`:1548`): both ends must be states, one transition per pair.
        if (!machine.states.has(from) || !machine.states.has(to) || machine.transitions.some((entry) => entry.from === from && entry.to === to)) continue;
        machine.transitions.push({
          from,
          to,
          transition: {
            switchMode: rest.switchMode ?? 0,
            advanceMode: rest.advanceMode ?? 1,
            advanceConditionName: rest.advanceCondition === undefined || rest.advanceCondition === '' ? '' : `conditions/${rest.advanceCondition}`,
            xfadeTime: rest.xfadeTime ?? 0,
            breakLoopAtEnd: rest.breakLoopAtEnd ?? false,
            reset: rest.reset ?? true,
            priority: rest.priority ?? 1,
          },
        });
      }
      return machine;
    }
    case 'one-shot': {
      // `AnimationNodeOneShot::AnimationNodeOneShot` (`animation_blend_tree.cpp:600`): inputs `in` and `shot`.
      const node: AnimationNodeOneShot = {
        kind: 'one-shot',
        ...base(['in', 'shot']),
        mixMode: data.mixMode ?? 0,
        fadeIn: data.fadeIn ?? 0,
        fadeOut: data.fadeOut ?? 0,
        sync: data.sync ?? false,
        breakLoopAtEnd: data.breakLoopAtEnd ?? false,
        abortOnReset: data.abortOnReset ?? false,
        autoRestart: data.autoRestart ?? false,
        autoRestartDelay: data.autoRestartDelay ?? 1,
        autoRestartRandomDelay: data.autoRestartRandomDelay ?? 0,
      };
      node.filterEnabled = data.filterEnabled ?? false;
      for (const path of data.filters ?? []) node.filters.add(path);
      return node;
    }
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
function parametersOf(node: AnimationNode): [string, GodotAnimationTreeValue][] {
  const core: [string, GodotAnimationTreeValue][] = [['current_length', 0], ['current_position', 0], ['current_delta', 0]];
  if (node.kind === 'animation') return [...core, ['backward', false]];
  if (node.kind === 'blend2') return [...core, ['blend_amount', 0]];
  if (node.kind === 'add2') return [...core, ['add_amount', 0]];
  // `AnimationNodeStateMachine::get_parameter_list` (`animation_node_state_machine.cpp:1239`): its
  // playback, then its transitions' advance conditions, sorted.
  if (node.kind === 'state-machine') {
    const conditions = [...new Set(node.transitions.map((entry) => entry.transition.advanceConditionName).filter((name) => name !== ''))].sort();
    return [...core, ['playback', playback_new()], ...conditions.map((name): [string, GodotAnimationTreeValue] => [name, false])];
  }
  if (node.kind === 'time-scale') return [...core, ['scale', 1]];
  // `AnimationNodeOneShot::get_parameter_list` (`animation_blend_tree.cpp:423`).
  if (node.kind === 'one-shot') return [...core, ['request', 0], ['active', false], ['internal_active', false], ['fade_in_remaining', 0], ['fade_out_remaining', 0], ['time_to_restart', -1]];
  return core;
}

// --- The tree's per-node state (`AnimationNodeInstance`, `animation_tree.h:258`).

interface Instance {
  readonly path: string;
  readonly node: AnimationNode;
  readonly parameters: Map<string, { value: GodotAnimationTreeValue; readonly readOnly: boolean }>;
  readonly children: Map<string, Instance>;
  connections: (Instance | undefined)[];
  trackWeights: number[];
  blended: boolean;
  /** An animation node's animation, found once (`_update_animation_cache`, `animation_blend_tree.cpp:417`): a resource's, or a glTF clip's. */
  cachedAnimation: { readonly length: number; readonly loop_mode: number; readonly clip: boolean } | undefined;
}

type NodeTimeInfo = GodotNodeTimeInfo;
const noTime = godot_node_time_info;

interface ProcessState {
  valid: boolean;
  trackMap: ReadonlyMap<string, number>;
}

interface TreeState {
  readonly entity: object;
  root: AnimationNode | null;
  animationPlayer: string;
  /** `property_map`: every node's parameters by full name (`parameters/run/blend_amount`). */
  readonly properties: Map<string, { value: GodotAnimationTreeValue; readonly readOnly: boolean }>;
  readonly instances: Map<string, Instance>;
  propertiesDirty: boolean;
  started: boolean;
  readonly animationPlayerChanged: SignalHandle<[]>;
  playerHooked: object | undefined;
  /** The glTF clips the tree drives, where its player is a model's (`driveClips`). */
  clips: ClipDrive | undefined;
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
    const parameters = new Map<string, { value: GodotAnimationTreeValue; readonly readOnly: boolean }>();
    for (const [name, initial] of parametersOf(node)) {
      const key = `${path}${name}`;
      let entry = state.properties.get(key);
      if (entry === undefined) {
        entry = { value: initial, readOnly: name.startsWith('current_') || name === 'active' || name === 'internal_active' || name === 'playback' };
        state.properties.set(key, entry);
      }
      parameters.set(name, entry);
    }
    const instance: Instance = { path, node, parameters, children: new Map(), connections: [], trackWeights: [], blended: false, cachedAnimation: undefined };
    state.instances.set(path, instance);
    if (node.kind === 'blend-tree') {
      for (const [name, entry] of node.nodes) instance.children.set(name, visit(`${path}${name}/`, entry.node));
    }
    if (node.kind === 'state-machine') {
      for (const [name, entry] of node.states) instance.children.set(name, visit(`${path}${name}/`, entry.node));
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

const parameter = (instance: Instance, name: string): number | boolean => {
  const value = instance.parameters.get(name)?.value ?? 0;
  return typeof value === 'object' ? 0 : value;
};
const setParameter = (instance: Instance, name: string, value: GodotAnimationTreeValue, testOnly: boolean): void => {
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
  if ((node.kind === 'blend2' || node.kind === 'add2' || node.kind === 'one-shot') && node.filterEnabled && filter !== FILTER_IGNORE) {
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
    case 'add2': {
      // `AnimationNodeAdd2::_process` (`animation_blend_tree.cpp:817`).
      const amount = parameter(instance, 'add_amount') as number;
      const nti = blendInput(state, ps, instance, 0, { ...info, weight: 1 }, FILTER_IGNORE, node.sync, testOnly);
      blendInput(state, ps, instance, 1, { ...info, weight: amount }, FILTER_PASS, node.sync, testOnly);
      return nti;
    }
    case 'one-shot':
      return processOneShot(state, ps, instance, node, info, testOnly);
    case 'animation':
      return processAnimation(state, ps, instance, node, info, testOnly);
    case 'state-machine':
      return processStateMachine(state, ps, instance, node, info, testOnly);
    // `AnimationNode::_process`: a node that plays nothing.
    case 'start-state':
    case 'end-state':
      return noTime();
  }
}

/**
 * `NodeTimeInfo::get_remain` (`animation_tree.h:82`): a looping input never ends unless the loop
 * breaks, nor does a state machine whose end is not predicted.
 */
function remainOf(nti: NodeTimeInfo, breakLoop: boolean): number {
  const looping = nti.loopMode !== LOOP_NONE;
  if ((looping && !breakLoop) || nti.infinity) return 31540000;
  if (looping && breakLoop && nti.willEnd) return 0;
  const remain = nti.length - nti.position;
  return isZeroApprox(remain) ? 0 : remain;
}

/** `OneShotRequest` (`animation_blend_tree.h:112`). */
const ONE_SHOT_REQUEST_FIRE = 1;
const ONE_SHOT_REQUEST_ABORT = 2;
const ONE_SHOT_REQUEST_FADE_OUT = 3;

/** `AnimationNodeOneShot::_process` (`animation_blend_tree.cpp:437`), without fade curves. */
function processOneShot(state: TreeState, ps: ProcessState, instance: Instance, node: AnimationNodeOneShot, info: GodotAnimationPlaybackInfo, testOnly: boolean): NodeTimeInfo {
  const request = parameter(instance, 'request') as number;
  const curActive = parameter(instance, 'active') === true;
  let curInternalActive = parameter(instance, 'internal_active') === true;
  const curNti: NodeTimeInfo = { ...noTime(), length: parameter(instance, 'current_length') as number, position: parameter(instance, 'current_position') as number };
  let curTimeToRestart = parameter(instance, 'time_to_restart') as number;
  let curFadeInRemaining = parameter(instance, 'fade_in_remaining') as number;
  let curFadeOutRemaining = parameter(instance, 'fade_out_remaining') as number;
  setParameter(instance, 'request', 0, testOnly);
  let isShooting = true;
  let isFadingOut = curActive && !curInternalActive;
  const absDelta = Math.abs(info.delta);
  const seek = info.seeked;
  let doStart = request === ONE_SHOT_REQUEST_FIRE;
  const isReset = isZeroApprox(info.time) && seek && !info.isExternalSeeking;
  if (isReset && curInternalActive) doStart = true;
  let isAbort = request === ONE_SHOT_REQUEST_ABORT;
  if (isReset && !doStart && (isFadingOut || (node.abortOnReset && curActive))) isAbort = true;
  if (isAbort) {
    setParameter(instance, 'internal_active', false, testOnly);
    setParameter(instance, 'active', false, testOnly);
    setParameter(instance, 'time_to_restart', -1, testOnly);
    setParameter(instance, 'fade_out_remaining', 0, testOnly);
    curFadeOutRemaining = 0;
    isFadingOut = false;
    isShooting = false;
  } else if (request === ONE_SHOT_REQUEST_FADE_OUT && !isFadingOut) {
    if (curActive) {
      isFadingOut = true;
      curFadeOutRemaining = node.fadeOut;
      curFadeInRemaining = 0;
    } else {
      isShooting = false;
    }
    setParameter(instance, 'internal_active', false, testOnly);
    setParameter(instance, 'time_to_restart', -1, testOnly);
  } else if (!doStart && !curActive) {
    if (greaterOrEqual(curTimeToRestart, 0) && !seek) {
      curTimeToRestart -= absDelta;
      if (less(curTimeToRestart, 0)) doStart = true;
      setParameter(instance, 'time_to_restart', curTimeToRestart, testOnly);
    }
    if (!doStart) isShooting = false;
  }
  let osSeek = seek;
  if (!isShooting) return blendInput(state, ps, instance, 0, { ...info, weight: 1 }, FILTER_IGNORE, node.sync, testOnly);
  if (doStart) {
    osSeek = true;
    if (!curInternalActive) curFadeInRemaining = node.fadeIn;
    curInternalActive = true;
    setParameter(instance, 'request', 0, testOnly);
    setParameter(instance, 'internal_active', true, testOnly);
    setParameter(instance, 'active', true, testOnly);
  }
  let blend = 1;
  let useBlend = node.sync;
  if (greater(curFadeInRemaining, 0)) {
    if (greater(node.fadeIn, 0)) {
      useBlend = true;
      blend = (node.fadeIn - curFadeInRemaining) / node.fadeIn;
    } else {
      blend = 0;
    }
  }
  if (isFadingOut) {
    useBlend = true;
    blend = greater(node.fadeOut, 0) ? curFadeOutRemaining / node.fadeOut : 0;
  }
  const mainNti =
    node.mixMode === 1
      ? blendInput(state, ps, instance, 0, { ...info, weight: 1 }, FILTER_IGNORE, node.sync, testOnly)
      : blendInput(state, ps, instance, 0, { ...info, seeked: info.seeked && useBlend, weight: 1 - blend }, FILTER_BLEND, node.sync, testOnly);
  const shotInfo: GodotAnimationPlaybackInfo = {
    ...info,
    time: doStart ? 0 : osSeek ? curNti.position : info.time,
    seeked: osSeek,
    weight: isZeroApprox(blend) ? CMP_EPSILON : blend,
  };
  const osNti = blendInput(state, ps, instance, 1, shotInfo, FILTER_PASS, true, testOnly);
  if (lessOrEqual(curFadeInRemaining, 0) && !doStart && !isFadingOut) {
    const absOsDelta = Math.abs(osNti.delta);
    const tscl = isZeroApprox(absDelta) || isZeroApprox(absOsDelta) || isEqualApprox(absDelta, absOsDelta) ? 1 : absDelta / absOsDelta;
    const osRem = remainOf(osNti, node.breakLoopAtEnd) * tscl;
    if (lessOrEqual(osRem, node.fadeOut)) {
      isFadingOut = true;
      curFadeOutRemaining = osRem + absDelta;
      curFadeInRemaining = 0;
      setParameter(instance, 'internal_active', false, testOnly);
    }
  }
  if (!seek) {
    if (lessOrEqual(remainOf(osNti, node.breakLoopAtEnd), 0) || (isFadingOut && lessOrEqual(curFadeOutRemaining, 0))) {
      setParameter(instance, 'internal_active', false, testOnly);
      setParameter(instance, 'active', false, testOnly);
      if (node.autoRestart) setParameter(instance, 'time_to_restart', node.autoRestartDelay + Math.random() * node.autoRestartRandomDelay, testOnly);
    }
    if (!doStart) curFadeInRemaining = Math.max(0, curFadeInRemaining - absDelta);
    curFadeOutRemaining = Math.max(0, curFadeOutRemaining - absDelta);
  }
  setParameter(instance, 'fade_in_remaining', curFadeInRemaining, testOnly);
  setParameter(instance, 'fade_out_remaining', curFadeOutRemaining, testOnly);
  return curInternalActive ? osNti : mainNti;
}

/** `SwitchMode`, `AdvanceMode` (`animation_node_state_machine.h:41`) and `STATE_MACHINE_TYPE_NESTED`. */
const SWITCH_MODE_SYNC = 1;
const SWITCH_MODE_AT_END = 2;
const ADVANCE_MODE_DISABLED = 0;
const ADVANCE_MODE_AUTO = 2;
const STATE_MACHINE_TYPE_NESTED = 1;

/** `NextInfo` (`animation_node_state_machine.h:208`). */
interface NextInfo {
  node: string;
  xfade: number;
  switchMode: number;
  isReset: boolean;
  breakLoopAtEnd: boolean;
}

/**
 * `AnimationNodeStateMachine::_process` (`animation_node_state_machine.cpp:1638`) and its playback's
 * `process` (`:708`): a test-only pass runs on a copy of the playback.
 */
function processStateMachine(state: TreeState, ps: ProcessState, instance: Instance, machine: AnimationNodeStateMachine, info: GodotAnimationPlaybackInfo, testOnly: boolean): NodeTimeInfo {
  const held = instance.parameters.get('playback')?.value;
  if (typeof held !== 'object') return noTime();
  const playback: AnimationNodeStateMachinePlayback = testOnly
    ? { ...held, path: [...held.path], currentNti: { ...held.currentNti }, fadingFromNti: { ...held.fadingFromNti }, stateStarted: createSignal<[string]>(), stateFinished: createSignal<[string]>() }
    : held;
  const nti = playbackProcess(state, ps, instance, machine, playback, info, testOnly);
  playback.startRequest = '';
  playback.nextRequest = false;
  playback.stopRequest = false;
  playback.resetRequestOnTeleport = false;
  return nti;
}

/** The playback's run of one process (`AnimationNodeStateMachinePlayback::_process`, `animation_node_state_machine.cpp:717`), for a root or nested machine. */
function playbackProcess(
  state: TreeState,
  ps: ProcessState,
  instance: Instance,
  machine: AnimationNodeStateMachine,
  pb: AnimationNodeStateMachinePlayback,
  info: GodotAnimationPlaybackInfo,
  testOnly: boolean,
): NodeTimeInfo {
  const states = machine.states;
  // `blend_node` of a state under the machine (`AnimationNode::blend_node`, `animation_tree.cpp:160`).
  const blendState = (name: string, pi: GodotAnimationPlaybackInfo, onlyTest: boolean): NodeTimeInfo => {
    const child = instance.children.get(name);
    return child === undefined ? noTime() : blendNode(state, ps, instance, child, pi, FILTER_IGNORE, true, onlyTest);
  };
  // `_set_current` (`:195`) and `_clear_fading` (`:357`), with their `state_started` and `state_finished`.
  const setCurrent = (name: string): void => {
    pb.current = name;
    if (name !== '') pb.stateStarted.emit(name);
  };
  const clearFading = (name: string): void => {
    if (name !== '') pb.stateFinished.emit(name);
    pb.fadingFrom = '';
    pb.fadingFromNti = noTime();
  };
  // `_start` (`:514`).
  const startMachine = (): void => {
    pb.playing = true;
    setCurrent(pb.startRequest !== '' ? pb.startRequest : 'Start');
    pb.teleportRequest = true;
    pb.stopRequest = false;
    pb.startRequest = '';
  };
  // `_make_travel_path` (`:544`): A* over the transitions not disabled, each costing the distance
  // between its states' graph positions times its priority.
  const makeTravelPath = (allowSelf: boolean): { readonly ok: boolean; readonly path: string[] } => {
    const travelTo = pb.travelRequest;
    pb.travelRequest = '';
    if (!pb.playing) startMachine();
    const at = (name: string) => states.get(name)?.position ?? ([0, 0] as const);
    const distance = (a: readonly [number, number], b: readonly [number, number]) => f32(Math.hypot(a[0] - b[0], a[1] - b[1]));
    if (!states.has(travelTo) || !states.has(pb.current)) return { ok: false, path: [] };
    if (pb.current === travelTo) return { ok: !allowSelf, path: [] };
    const currentPos = at(pb.current);
    const targetPos = at(travelTo);
    const transitions = machine.transitions;
    let found = false;
    const cost = new Map<string, { prev: string; distance: number }>();
    const open: number[] = [];
    for (let i = 0; i < transitions.length; i += 1) {
      const t = transitions[i] as (typeof transitions)[number];
      if (t.transition.advanceMode === ADVANCE_MODE_DISABLED || t.from !== pb.current) continue;
      open.push(i);
      cost.set(t.to, { prev: pb.current, distance: f32(distance(at(t.to), currentPos) * t.transition.priority) });
      if (t.to === travelTo) {
        found = true;
        break;
      }
    }
    while (!found && open.length > 0) {
      let least = -1;
      let leastCost = 1e20;
      open.forEach((index, at_) => {
        const to = (transitions[index] as (typeof transitions)[number]).to;
        const total = f32((cost.get(to)?.distance ?? 0) + distance(at(to), targetPos));
        if (total < leastCost) {
          least = at_;
          leastCost = total;
        }
      });
      if (least < 0) break;
      const chosen = transitions[open[least] as number] as (typeof transitions)[number];
      for (const t of transitions) {
        if (t.transition.advanceMode === ADVANCE_MODE_DISABLED) continue;
        if (t.from !== chosen.to || t.to === chosen.from) continue;
        const through = f32(f32(distance(at(t.from), at(t.to)) * t.transition.priority) + (cost.get(t.from)?.distance ?? 0));
        const known = cost.get(t.to);
        if (known !== undefined) {
          if (through < known.distance) {
            known.distance = through;
            known.prev = t.from;
          }
        } else {
          cost.set(t.to, { prev: t.from, distance: through });
          open.push(transitions.indexOf(t));
          if (t.to === travelTo) {
            found = true;
            break;
          }
        }
      }
      if (found) break;
      open.splice(least, 1);
    }
    if (!found) return { ok: false, path: [] };
    const path: string[] = [];
    for (let step = travelTo; step !== pb.current; step = cost.get(step)?.prev ?? pb.current) path.push(step);
    return { ok: true, path: path.reverse() };
  };
  // `_check_advance_condition` (`:1119`): an auto transition whose condition, if it has one, holds.
  const advances = (transition: AnimationNodeStateMachineTransition): boolean =>
    transition.advanceMode === ADVANCE_MODE_AUTO && (transition.advanceConditionName === '' || parameter(instance, transition.advanceConditionName) === true);
  // `_find_next` (`:1066`): the path's next state, else the best-priority auto transition.
  const findNext = (): NextInfo => {
    const next: NextInfo = { node: '', xfade: 0, switchMode: 0, isReset: false, breakLoopAtEnd: false };
    const take = (to: string, t: AnimationNodeStateMachineTransition) => {
      next.node = to;
      next.xfade = t.xfadeTime;
      next.switchMode = t.switchMode;
      next.isReset = t.reset;
      next.breakLoopAtEnd = t.breakLoopAtEnd;
    };
    if (pb.path.length > 0) {
      for (const t of machine.transitions) {
        if (t.transition.advanceMode === ADVANCE_MODE_DISABLED) continue;
        if (t.from === pb.current && t.to === pb.path[0]) take(t.to, t.transition);
      }
      return next;
    }
    let best: (typeof machine.transitions)[number] | undefined;
    let priorityBest = 1e20;
    for (const t of machine.transitions) {
      if (t.transition.advanceMode === ADVANCE_MODE_DISABLED) continue;
      if (t.from === pb.current && advances(t.transition) && t.transition.priority <= priorityBest) {
        priorityBest = t.transition.priority;
        best = t;
      }
    }
    if (best !== undefined) take(best.to, best.transition);
    return next;
  };
  // `_can_transition_to_next` (`:1006`).
  const canTransitionToNext = (next: NextInfo): boolean => {
    if (next.node === '') return false;
    if (pb.nextRequest) {
      pb.nextRequest = false;
      return true;
    }
    if (pb.fadingFrom !== '') return false;
    if (pb.current !== 'Start' && next.switchMode === SWITCH_MODE_AT_END) return lessOrEqual(remainOf(pb.currentNti, next.breakLoopAtEnd), next.xfade);
    return true;
  };
  // `_transition_to_next_recursive` (`:922`): follows transitions until one fades.
  const transitionToNext = (delta: number): boolean => {
    pb.resetRequestForFadingFrom = false;
    let pi: GodotAnimationPlaybackInfo = { time: 0, delta, start: 0, end: 0, seeked: false, isExternalSeeking: false, loopedFlag: LOOPED_FLAG_NONE, weight: 0 };
    let next: NextInfo = { node: '', xfade: 0, switchMode: 0, isReset: false, breakLoopAtEnd: false };
    const visited = [pb.current];
    for (;;) {
      next = findNext();
      if (!canTransitionToNext(next)) break;
      // A loop of transitions within one frame stops.
      if (visited.includes(next.node)) break;
      visited.push(next.node);
      if (next.xfade) {
        pb.fadingFrom = pb.current;
        pb.fadingTime = next.xfade;
        pb.fadingPos = 0;
      } else {
        if (pb.resetRequest) {
          pi = { ...pi, time: 0, seeked: true, isExternalSeeking: false, weight: 0 };
          blendState(pb.current, pi, testOnly);
        }
        clearFading(pb.current);
        pb.fadingTime = 0;
        pb.fadingPos = 0;
      }
      if (pb.path.length > 0) pb.path.shift();
      setCurrent(next.node);
      if (pb.current === 'End') break;
      pb.resetRequestForFadingFrom = pb.resetRequest;
      pb.resetRequest = next.isReset;
      pb.fadingFromNti = { ...pb.currentNti };
      if (next.switchMode === SWITCH_MODE_SYNC) {
        pi = { ...pi, time: pb.currentNti.position, seeked: true, isExternalSeeking: false, weight: 0 };
        blendState(pb.current, pi, testOnly);
      }
      // Only the next state's length, to find the one after it.
      pi = { ...pi, time: 0, isExternalSeeking: false, weight: 0, seeked: next.isReset };
      pb.currentNti = blendState(pb.current, pi, true);
      if (pb.fadingTime) break;
    }
    return next.node === 'End';
  };

  const seek = info.seeked;
  // A seek to 0 by the parent restarts the machine (a nested one resets its current state).
  if (isZeroApprox(info.time) && seek && !info.isExternalSeeking) {
    if (machine.type !== STATE_MACHINE_TYPE_NESTED || godot_state_machine_playback_is_end(pb) || !pb.playing) {
      pb.path = [];
      startMachine();
      pb.resetRequest = true;
    } else {
      pb.resetRequest = true;
      pb.teleportRequest = true;
    }
  }
  if (pb.stopRequest) {
    pb.startRequest = '';
    pb.travelRequest = '';
    pb.path = [];
    pb.playing = false;
    return noTime();
  }
  if (!pb.playing && pb.startRequest !== '' && pb.travelRequest !== '') return noTime();
  if (pb.startRequest !== '') {
    pb.path = [];
    pb.startRequest = pb.startRequest.split('/')[0] as string;
    // `No such node` (`:776`): the request stands and nothing plays.
    if (!states.has(pb.startRequest)) return noTime();
    startMachine();
  }
  if (pb.travelRequest !== '') {
    const parts = pb.travelRequest.split('/');
    pb.travelRequest = parts[0] as string;
    const target = pb.travelRequest;
    const made = makeTravelPath(parts.length <= 1 ? machine.allowTransitionToSelf : false);
    if (made.ok) {
      pb.path = made.path;
    } else {
      // No route: teleport.
      if (!states.has(target)) return noTime();
      pb.path = [];
      if (pb.current !== target || pb.resetRequestOnTeleport) {
        setCurrent(target);
        pb.resetRequest = pb.resetRequestOnTeleport;
        pb.teleportRequest = true;
      }
    }
  }
  if (pb.teleportRequest) {
    pb.teleportRequest = false;
    pb.fadingFrom = '';
    pb.fadingFromNti = noTime();
    pb.fadingPos = 0;
    pb.currentNti = blendState(pb.current, { ...info, time: 0, seeked: true, isExternalSeeking: false, weight: 0 }, true);
    transitionToNext(info.delta);
  }
  if (!states.has(pb.current)) {
    pb.playing = false;
    setCurrent('');
    return noTime();
  }
  // `Start` and `End` weigh nothing unless the machine resets its ends.
  const startOfGroup = !machine.resetEnds && pb.fadingFrom === 'Start';
  const endOfGroup = !machine.resetEnds && pb.current === 'End';
  // The cross-fade's blend.
  let fadeBlend = 1;
  if (pb.fadingTime && pb.fadingFrom !== '') {
    if (!states.has(pb.fadingFrom)) {
      pb.fadingFrom = '';
    } else {
      if (!seek) pb.fadingPos += Math.abs(info.delta);
      fadeBlend = f32(Math.min(1, pb.fadingPos / pb.fadingTime));
    }
  }
  fadeBlend = isZeroApproxF(fadeBlend) ? CMP_EPSILON : fadeBlend;
  if (startOfGroup) fadeBlend = 1;
  else if (endOfGroup) fadeBlend = 0;
  let pi: GodotAnimationPlaybackInfo = { ...info, weight: fadeBlend };
  if (pb.resetRequest) {
    pb.resetRequest = false;
    pi = { ...pi, time: 0, seeked: true };
  }
  pb.currentNti = blendState(pb.current, pi, testOnly);
  if (pb.fadingFrom !== '') {
    let inverse = 1 - fadeBlend;
    inverse = isZeroApprox(inverse) ? CMP_EPSILON : inverse;
    if (startOfGroup) inverse = 0;
    else if (endOfGroup) inverse = 1;
    pi = { ...info, weight: inverse };
    if (pb.resetRequestForFadingFrom) {
      pb.resetRequestForFadingFrom = false;
      pi = { ...pi, time: 0, seeked: true };
    }
    pb.fadingFromNti = blendState(pb.fadingFrom, pi, testOnly);
    if (greaterOrEqual(pb.fadingPos, pb.fadingTime)) clearFading(pb.fadingFrom);
  }
  const willEnd = transitionToNext(info.delta) || pb.current === 'End';
  if (willEnd || (machine.type === STATE_MACHINE_TYPE_NESTED && !machine.transitions.some((t) => t.from === pb.current))) {
    if (pb.fadingFrom !== '') return greater(remainOf(pb.currentNti, false), remainOf(pb.fadingFromNti, false)) ? pb.currentNti : pb.fadingFromNti;
    return pb.currentNti;
  }
  if (!godot_state_machine_playback_is_end(pb)) pb.currentNti.infinity = true;
  return pb.currentNti;
}

/** `AnimationNodeAnimation::_process` (`animation_blend_tree.cpp:102`), forward play, no custom timeline. */
function processAnimation(state: TreeState, ps: ProcessState, instance: Instance, node: AnimationNodeAnimation, info: GodotAnimationPlaybackInfo, testOnly: boolean): NodeTimeInfo {
  // The instance keeps the animation it found until the node's animation changes, whatever the
  // tree's libraries do since.
  if (instance.cachedAnimation === undefined) {
    const clip = state.clips?.clip(node.animation);
    const animation = clip === undefined ? godot_animation_mixer_animation(state.entity, node.animation) : undefined;
    instance.cachedAnimation =
      clip !== undefined ? { length: clip.clip.duration, loop_mode: clip.loopMode, clip: true } : animation === undefined ? undefined : { length: animation.length, loop_mode: animation.loop_mode, clip: false };
  }
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
  const nti: NodeTimeInfo = { length: curLen, position: curTime, delta: curDelta, loopMode, willEnd, infinity: false };
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
  if (!testOnly && anim.clip) {
    // A glTF clip's action takes the time and the track weights (`applyClips`).
    const frame = (state.clips as ClipDrive).frame;
    frame.set(node.animation, [...(frame.get(node.animation) ?? []), { time: curPlayback, trackWeights: [...instance.trackWeights] }]);
    setParameter(instance, 'backward', backward, false);
  } else if (!testOnly) {
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
  // A model's player of its glTF's clips: the tree drives the clips on the player's own mixer.
  if (player !== null && player !== undefined && godot_animation_clips_of(godot_node_entity(player as object))) {
    godot_animation_mixer_set_process(entity, false);
    driveClips(state, godot_node_entity(player as object));
    return;
  }
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

/** A glTF clip player a tree drives: its mixer and clips, and each frame's instances of them. */
interface ClipDrive {
  readonly mixer: ThreeAnimationMixer;
  readonly clip: (name: string) => { readonly clip: AnimationClip; readonly loopMode: number } | undefined;
  /** This frame's instances of each clip: where the walk put it, and its track weights. */
  readonly frame: Map<string, { readonly time: number; readonly trackWeights: readonly number[] }[]>;
  /** Each clip part's action, by clip, filter signature and instance. */
  readonly actions: Map<string, AnimationAction>;
  /** The tree the track map and parts were read from, and them. */
  layout: { readonly root: AnimationNode; readonly trackMap: ReadonlyMap<string, number>; readonly trackCount: number; readonly filters: readonly ReadonlySet<string>[] } | undefined;
  readonly parts: Map<string, readonly { readonly key: string; readonly tracks: KeyframeTrack[]; readonly index: number }[]>;
}

/** The clip player each tree drives (`driveClips`). */
const DRIVEN = new WeakMap<TreeState, object>();

/** The node a track animates: a bone's (`Skeleton3D:bone`) or a node's name, before the property. */
function trackNode(track: string): string {
  return track.slice(0, track.indexOf('.') < 0 ? track.length : track.indexOf('.'));
}

/** The node a filter names: the bone after `:`, else the path's last node. */
function filterNode(path: string): string {
  const colon = path.lastIndexOf(':');
  return colon >= 0 ? path.slice(colon + 1) : path.slice(path.lastIndexOf('/') + 1);
}

/**
 * The clips' track map: a track per animated node across the player's clips, and each filter path
 * of the tree to its node's track; and the tree's filters, whose memberships split a clip's tracks
 * into parts one weight moves.
 */
function clipLayout(drive: ClipDrive, root: AnimationNode, clipNames: readonly string[]): NonNullable<ClipDrive['layout']> {
  const trackMap = new Map<string, number>();
  for (const name of clipNames) {
    for (const track of drive.clip(name)?.clip.tracks ?? []) {
      const node = trackNode(track.name);
      if (!trackMap.has(node)) trackMap.set(node, trackMap.size);
    }
  }
  const trackCount = trackMap.size;
  const filters: ReadonlySet<string>[] = [];
  const visit = (node: AnimationNode): void => {
    if ((node.kind === 'blend2' || node.kind === 'add2' || node.kind === 'one-shot') && node.filterEnabled) {
      filters.push(new Set([...node.filters].map(filterNode)));
      for (const path of node.filters) {
        const index = trackMap.get(filterNode(path));
        if (index !== undefined) trackMap.set(path, index);
      }
    }
    if (node.kind === 'blend-tree') for (const entry of node.nodes.values()) visit(entry.node);
    if (node.kind === 'state-machine') for (const entry of node.states.values()) visit(entry.node);
  };
  visit(root);
  drive.parts.clear();
  return { root, trackMap, trackCount, filters };
}

/**
 * Sets the clips' actions from this frame's instances: each clip split into the parts of its tracks
 * the tree's filters weigh alike, each part's action at the instance's time (three's mixer does not
 * advance it) and weighted as its tracks are; an action no instance reached weighs nothing.
 */
function applyClips(drive: ClipDrive): void {
  const layout = drive.layout;
  const used = new Set<AnimationAction>();
  for (const [name, instances] of drive.frame) {
    const clip = drive.clip(name);
    if (clip === undefined || layout === undefined) continue;
    let parts = drive.parts.get(name);
    if (parts === undefined) {
      const groups = new Map<string, KeyframeTrack[]>();
      for (const track of clip.clip.tracks) {
        const key = layout.filters.map((filter) => (filter.has(trackNode(track.name)) ? '1' : '0')).join('');
        groups.set(key, [...(groups.get(key) ?? []), track]);
      }
      parts = [...groups].map(([key, tracks]) => ({ key, tracks, index: layout.trackMap.get(trackNode((tracks[0] as KeyframeTrack).name)) ?? 0 }));
      drive.parts.set(name, parts);
    }
    instances.forEach((instance, occurrence) => {
      for (const part of parts) {
        const id = `${name}#${part.key}#${String(occurrence)}`;
        let action = drive.actions.get(id);
        if (action === undefined) {
          const whole = part.tracks.length === clip.clip.tracks.length && occurrence === 0;
          action = drive.mixer.clipAction(whole ? clip.clip : new AnimationClip(id, clip.clip.duration, part.tracks));
          action.setLoop(godot_animation_clips_loop(clip.loopMode), Infinity);
          action.play();
          action.setEffectiveTimeScale(0);
          drive.actions.set(id, action);
        }
        action.time = instance.time;
        action.setEffectiveWeight(instance.trackWeights[part.index] ?? 0);
        used.add(action);
      }
    });
  }
  for (const action of drive.actions.values()) if (!used.has(action)) action.setEffectiveWeight(0);
}

/**
 * The tree over a player's glTF clips (`animation-clips.ts`): each frame, before the player's mixer
 * advances, the tree processes as it does over a mixer (`_blend_pre_process`) with the clips as its
 * animations, and its instances set the clips' actions (`applyClips`).
 */
function driveClips(state: TreeState, player: object): void {
  // The tree drives a player once, however often its setup runs.
  if (DRIVEN.get(state) === player) return;
  DRIVEN.set(state, player);
  const drive: ClipDrive = {
    ...godot_animation_clips_drive(player, (delta) => {
      drive.frame.clear();
      if (state.root !== null && is_active(state.entity)) {
        const layout = drive.layout?.root === state.root ? drive.layout : (drive.layout = clipLayout(drive, state.root, godot_animation_clips_list(player)));
        blendPreProcess(state, delta, layout.trackCount, layout.trackMap);
      }
      applyClips(drive);
    }),
    frame: new Map(),
    actions: new Map(),
    layout: undefined,
    parts: new Map(),
  };
  state.clips = drive;
  for (const instance of state.instances.values()) instance.cachedAnimation = undefined;
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
    clips: undefined,
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
  // A playback is the tree's own object, never replaced by a number.
  if (entry === undefined || typeof entry.value === 'object') return false;
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
export function godot_animation_tree_get(self: object, name: string): GodotAnimationTreeValue | undefined {
  const state = stateOf(self, 'get');
  updateProperties(state);
  return state.properties.get(String(name))?.value;
}

/**
 * `tree[path]` in a script (`Object::get`, answered by `AnimationTree::_get`): a path that is not a
 * parameter is GDScript's invalid access (`gdscript_vm.cpp:1167`).
 *
 * @godot AnimationTree (protocol)
 * @source scene/animation/animation_tree.cpp:1090
 */
export function godot_animation_tree_parameter(self: object, path: string): number | boolean {
  const value = godot_animation_tree_get(self, path);
  if (value === undefined || typeof value === 'object') throw new Error(`Invalid access to property or key '${path}' on a base object of type 'AnimationTree'.`);
  return value;
}

/**
 * `tree[".../playback"]` in a script: a state machine's playback, the object its `travel` and
 * `start` requests go to (`AnimationNodeStateMachine::get_parameter_list`, `animation_node_state_machine.cpp:1239`).
 *
 * @godot AnimationTree (protocol)
 * @source scene/animation/animation_tree.cpp:1090
 */
export function godot_animation_tree_playback(self: object, path: string): AnimationNodeStateMachinePlayback {
  const value = godot_animation_tree_get(self, path);
  if (typeof value !== 'object') throw new Error(`Invalid access to property or key '${path}' on a base object of type 'AnimationTree'.`);
  return value;
}

/**
 * `tree[path] = value` in a script (`Object::set`, answered by `AnimationTree::_set`): a path the
 * tree does not set (not a parameter, or read-only inside the tree) is GDScript's invalid
 * assignment (`gdscript_vm.cpp:1059`).
 *
 * @godot AnimationTree (protocol)
 * @source scene/animation/animation_tree.cpp:1057
 */
export function godot_animation_tree_set_parameter(self: object, path: string, value: number | boolean): void {
  if (!godot_animation_tree_set(self, path, value)) {
    throw new Error(`Invalid assignment of property or key '${path}' with value of type '${typeof value === 'boolean' ? 'bool' : 'float'}' on a base object of type 'AnimationTree'.`);
  }
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
  advances: true,
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
