/**
 * @godot-class AnimationNodeStateMachinePlayback
 * @role BINDING
 *
 * Godot 4.7's `AnimationNodeStateMachinePlayback` (`scene/animation/animation_node_state_machine.cpp`,
 * revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a state machine's playing state in one
 * AnimationTree, its `playback` parameter. A script's `travel`, `start`, `next` and `stop` are
 * requests the tree's next process answers (`AnimationNodeStateMachinePlayback::_process`, run by
 * `animation-tree.ts`); the current state, the state it fades from and the travel path are what the
 * last process left.
 */

import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/** `AnimationNode::NodeTimeInfo` (`animation_tree.h:66`). */
export interface GodotNodeTimeInfo {
  length: number;
  position: number;
  delta: number;
  loopMode: number;
  willEnd: boolean;
  /** A state machine's unpredictable end (`is_infinity`). */
  infinity: boolean;
}

export interface AnimationNodeStateMachinePlayback {
  current: string;
  fadingFrom: string;
  fadingTime: number;
  fadingPos: number;
  path: string[];
  playing: boolean;
  travelRequest: string;
  startRequest: string;
  stopRequest: boolean;
  nextRequest: boolean;
  resetRequest: boolean;
  teleportRequest: boolean;
  resetRequestOnTeleport: boolean;
  resetRequestForFadingFrom: boolean;
  currentNti: GodotNodeTimeInfo;
  fadingFromNti: GodotNodeTimeInfo;
  readonly stateStarted: SignalHandle<[string]>;
  readonly stateFinished: SignalHandle<[string]>;
}

/**
 * A NodeTimeInfo of nothing played.
 *
 * @godot AnimationNodeStateMachinePlayback (protocol)
 * @source scene/animation/animation_tree.h:66
 */
export function godot_node_time_info(): GodotNodeTimeInfo {
  return { length: 0, position: 0, delta: 0, loopMode: 0, willEnd: false, infinity: false };
}

/**
 * A playback not playing (`AnimationNodeStateMachinePlayback::AnimationNodeStateMachinePlayback`).
 *
 * @godot AnimationNodeStateMachinePlayback.AnimationNodeStateMachinePlayback
 * @source scene/animation/animation_node_state_machine.cpp:1228
 */
export function construct(): AnimationNodeStateMachinePlayback {
  return {
    current: '',
    fadingFrom: '',
    fadingTime: 0,
    fadingPos: 0,
    path: [],
    playing: false,
    travelRequest: '',
    startRequest: '',
    stopRequest: false,
    nextRequest: false,
    resetRequest: false,
    teleportRequest: false,
    resetRequestOnTeleport: false,
    resetRequestForFadingFrom: false,
    currentNti: godot_node_time_info(),
    fadingFromNti: godot_node_time_info(),
    stateStarted: createSignal<[string]>(),
    stateFinished: createSignal<[string]>(),
  };
}

/**
 * Travels to a state by the transitions between (`_travel_main`), or teleports there where none
 * lead.
 *
 * @godot AnimationNodeStateMachinePlayback.travel
 * @source scene/animation/animation_node_state_machine.cpp:261
 */
export function travel(self: AnimationNodeStateMachinePlayback, to_node: string, reset_on_teleport = true): void {
  self.travelRequest = String(to_node);
  self.resetRequestOnTeleport = reset_on_teleport;
  self.stopRequest = false;
}

/**
 * @godot AnimationNodeStateMachinePlayback.start
 * @source scene/animation/animation_node_state_machine.cpp:267
 */
export function start(self: AnimationNodeStateMachinePlayback, node: string, reset = true): void {
  self.travelRequest = '';
  self.path = [];
  self.resetRequest = reset;
  self.startRequest = String(node);
  self.stopRequest = false;
}

/**
 * @godot AnimationNodeStateMachinePlayback.next
 * @source scene/animation/animation_node_state_machine.cpp:273
 */
export function next(self: AnimationNodeStateMachinePlayback): void {
  self.nextRequest = true;
}

/**
 * @godot AnimationNodeStateMachinePlayback.stop
 * @source scene/animation/animation_node_state_machine.cpp:278
 */
export function stop(self: AnimationNodeStateMachinePlayback): void {
  self.stopRequest = true;
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
  return self.currentNti.position;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_current_length
 * @source scene/animation/animation_node_state_machine.cpp:333
 */
export function get_current_length(self: AnimationNodeStateMachinePlayback): number {
  return self.currentNti.length;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_from_play_position
 * @source scene/animation/animation_node_state_machine.cpp:337
 */
export function get_fading_from_play_position(self: AnimationNodeStateMachinePlayback): number {
  return self.fadingFromNti.position;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_from_length
 * @source scene/animation/animation_node_state_machine.cpp:341
 */
export function get_fading_from_length(self: AnimationNodeStateMachinePlayback): number {
  return self.fadingFromNti.length;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_position
 * @source scene/animation/animation_node_state_machine.cpp:349
 */
export function get_fading_position(self: AnimationNodeStateMachinePlayback): number {
  return self.fadingPos;
}

/**
 * @godot AnimationNodeStateMachinePlayback.get_fading_length
 * @source scene/animation/animation_node_state_machine.cpp:345
 */
export function get_fading_length(self: AnimationNodeStateMachinePlayback): number {
  return self.fadingTime;
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

/**
 * Whether the playback rests at `End` with nothing fading (`is_end`).
 *
 * @godot AnimationNodeStateMachinePlayback (protocol)
 * @source scene/animation/animation_node_state_machine.cpp:309
 */
export function godot_state_machine_playback_is_end(self: AnimationNodeStateMachinePlayback): boolean {
  return self.current === 'End' && self.fadingFrom === '';
}
