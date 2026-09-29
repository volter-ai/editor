/**
 * @godot-class AnimationNodeStateMachinePlayback
 * @role BINDING
 *
 * Godot 4.7's `AnimationNodeStateMachinePlayback` (`scene/animation/animation_node_state_machine.cpp`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a state machine's playing state in one
 * AnimationTree, its `playback` parameter: the state it plays, the one it fades from, and the path a
 * `travel` takes. A travel's route is the cheapest by the transitions not disabled, each costing
 * the distance between its states' graph positions times its priority, found by graphology's
 * Dijkstra; where none leads, the playback teleports. The tree's walk over the model's clips
 * (`animation-tree.ts`) moves it from state to state and weighs the states' clips by its fade.
 */

import { DirectedGraph } from 'graphology';
import { bidirectional } from 'graphology-shortest-path/dijkstra';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/** What a travel reads of its machine: its states' graph positions and its transitions. */
export interface GodotStateMachineGraph {
  readonly states: ReadonlyMap<string, { readonly position: readonly [number, number] }>;
  readonly transitions: readonly { readonly from: string; readonly to: string; readonly transition: { readonly advanceMode: number; readonly priority: number } }[];
  readonly allowTransitionToSelf: boolean;
}

export interface AnimationNodeStateMachinePlayback {
  readonly machine: GodotStateMachineGraph;
  playing: boolean;
  current: string;
  /** Seconds since the current state began, its length and whether it loops, as its clips give them. */
  position: number;
  length: number;
  looping: boolean;
  fadingFrom: string;
  fadingFromPosition: number;
  fadingFromLength: number;
  fadeTime: number;
  fadeElapsed: number;
  path: string[];
  /** A script's `next()`, which the walk answers by taking the next transition at once. */
  nextRequested: boolean;
  /** The states whose clips start again as the walk next reaches them, at the time each starts from. */
  readonly restart: Map<string, number>;
  readonly stateStarted: SignalHandle<[string]>;
  readonly stateFinished: SignalHandle<[string]>;
}

/** `ADVANCE_MODE_DISABLED` (`animation_node_state_machine.h:48`). */
const ADVANCE_MODE_DISABLED = 0;

/**
 * A playback of a machine, not playing (`AnimationNodeStateMachinePlayback::AnimationNodeStateMachinePlayback`).
 *
 * @godot AnimationNodeStateMachinePlayback (protocol)
 * @source scene/animation/animation_node_state_machine.cpp:1228
 */
export function godot_state_machine_playback_new(machine: GodotStateMachineGraph): AnimationNodeStateMachinePlayback {
  return {
    machine,
    playing: false,
    current: '',
    position: 0,
    length: 0,
    looping: false,
    fadingFrom: '',
    fadingFromPosition: 0,
    fadingFromLength: 0,
    fadeTime: 0,
    fadeElapsed: 0,
    path: [],
    nextRequested: false,
    restart: new Map(),
    stateStarted: createSignal<[string]>(),
    stateFinished: createSignal<[string]>(),
  };
}

/**
 * Makes `state` the one the playback plays (a cut ends any fade): its clips start again at
 * `restartAt` seconds, or play on from where they are.
 *
 * @godot AnimationNodeStateMachinePlayback (protocol)
 * @source scene/animation/animation_node_state_machine.cpp:195
 */
export function godot_state_machine_playback_enter(self: AnimationNodeStateMachinePlayback, state: string, restartAt: number | undefined, from: 'fade' | 'cut'): void {
  if (from === 'cut') godot_state_machine_playback_end_fade(self);
  self.current = state;
  if (restartAt !== undefined) {
    self.position = restartAt;
    self.restart.set(state, restartAt);
  }
  self.stateStarted.emit(state);
}

/**
 * Ends the fade from the previous state (`_clear_fading`).
 *
 * @godot AnimationNodeStateMachinePlayback (protocol)
 * @source scene/animation/animation_node_state_machine.cpp:357
 */
export function godot_state_machine_playback_end_fade(self: AnimationNodeStateMachinePlayback): void {
  if (self.fadingFrom !== '') self.stateFinished.emit(self.fadingFrom);
  self.fadingFrom = '';
  self.fadeTime = 0;
  self.fadeElapsed = 0;
}

/** Plays from `state` (`Start` when none is named): `_start`. */
function begin(self: AnimationNodeStateMachinePlayback, state: string, reset: boolean): void {
  self.playing = true;
  self.path = [];
  godot_state_machine_playback_enter(self, state, reset ? 0 : undefined, 'cut');
}

/**
 * The cheapest route from the current state to `to` by the transitions not disabled, the states
 * after the current one; undefined where none leads.
 */
function route(self: AnimationNodeStateMachinePlayback, to: string): string[] | undefined {
  const graph = new DirectedGraph<Record<string, never>, { readonly cost: number }>();
  for (const name of self.machine.states.keys()) graph.addNode(name);
  const at = (name: string) => self.machine.states.get(name)?.position ?? ([0, 0] as const);
  for (const { from, to: target, transition } of self.machine.transitions) {
    if (transition.advanceMode === ADVANCE_MODE_DISABLED || graph.hasEdge(from, target)) continue;
    const [x0, y0] = at(from);
    const [x1, y1] = at(target);
    graph.addDirectedEdge(from, target, { cost: Math.hypot(x1 - x0, y1 - y0) * transition.priority });
  }
  if (!graph.hasNode(self.current) || !graph.hasNode(to)) return undefined;
  const found = bidirectional(graph, self.current, to, 'cost');
  return found === null || found === undefined || found.length < 2 ? undefined : found.slice(1);
}

/**
 * Travels to a state by the cheapest route of transitions, or teleports there where none leads;
 * the current state again restarts only where the machine allows a transition to itself.
 *
 * @godot AnimationNodeStateMachinePlayback.travel
 * @source scene/animation/animation_node_state_machine.cpp:261
 */
export function travel(self: AnimationNodeStateMachinePlayback, to_node: string, reset_on_teleport = true): void {
  const target = String(to_node);
  if (!self.machine.states.has(target)) return;
  if (!self.playing) begin(self, 'Start', true);
  if (target === self.current) {
    if (self.machine.allowTransitionToSelf) begin(self, target, reset_on_teleport);
    return;
  }
  const path = route(self, target);
  if (path !== undefined) {
    self.path = path;
    return;
  }
  begin(self, target, reset_on_teleport);
}

/**
 * @godot AnimationNodeStateMachinePlayback.start
 * @source scene/animation/animation_node_state_machine.cpp:267
 */
export function start(self: AnimationNodeStateMachinePlayback, node: string, reset = true): void {
  if (self.machine.states.has(String(node))) begin(self, String(node), reset);
}

/**
 * @godot AnimationNodeStateMachinePlayback.next
 * @source scene/animation/animation_node_state_machine.cpp:273
 */
export function next(self: AnimationNodeStateMachinePlayback): void {
  self.nextRequested = true;
}

/**
 * @godot AnimationNodeStateMachinePlayback.stop
 * @source scene/animation/animation_node_state_machine.cpp:278
 */
export function stop(self: AnimationNodeStateMachinePlayback): void {
  self.playing = false;
  self.path = [];
}

/**
 * @godot AnimationNodeStateMachinePlayback.is_playing
 * @source scene/animation/animation_node_state_machine.cpp:305
 */
export function is_playing(self: AnimationNodeStateMachinePlayback): boolean {
  return self.playing;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_current_node
 * @source scene/animation/animation_node_state_machine.cpp:313
 */
export function get_current_node(self: AnimationNodeStateMachinePlayback): string {
  return self.current;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_from_node
 * @source scene/animation/animation_node_state_machine.cpp:317
 */
export function get_fading_from_node(self: AnimationNodeStateMachinePlayback): string {
  return self.fadingFrom;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_travel_path
 * @source scene/animation/animation_node_state_machine.cpp:325
 */
export function get_travel_path(self: AnimationNodeStateMachinePlayback): string[] {
  return [...self.path];
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_current_play_position
 * @source scene/animation/animation_node_state_machine.cpp:329
 */
export function get_current_play_position(self: AnimationNodeStateMachinePlayback): number {
  return self.position;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_current_length
 * @source scene/animation/animation_node_state_machine.cpp:333
 */
export function get_current_length(self: AnimationNodeStateMachinePlayback): number {
  return self.length;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_from_play_position
 * @source scene/animation/animation_node_state_machine.cpp:337
 */
export function get_fading_from_play_position(self: AnimationNodeStateMachinePlayback): number {
  return self.fadingFromPosition;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_from_length
 * @source scene/animation/animation_node_state_machine.cpp:341
 */
export function get_fading_from_length(self: AnimationNodeStateMachinePlayback): number {
  return self.fadingFromLength;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_position
 * @source scene/animation/animation_node_state_machine.cpp:349
 */
export function get_fading_position(self: AnimationNodeStateMachinePlayback): number {
  return self.fadeElapsed;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_length
 * @source scene/animation/animation_node_state_machine.cpp:345
 */
export function get_fading_length(self: AnimationNodeStateMachinePlayback): number {
  return self.fadeTime;
}

/**
 * @godot AnimationNodeStateMachinePlayback.state_started
 * @source scene/animation/animation_node_state_machine.cpp:1224
 */
export function state_started(self: AnimationNodeStateMachinePlayback): GodotSignal<[string]> {
  return self.stateStarted.signal;
}

/**
 * @godot AnimationNodeStateMachinePlayback.state_finished
 * @source scene/animation/animation_node_state_machine.cpp:1225
 */
export function state_finished(self: AnimationNodeStateMachinePlayback): GodotSignal<[string]> {
  return self.stateFinished.signal;
}
