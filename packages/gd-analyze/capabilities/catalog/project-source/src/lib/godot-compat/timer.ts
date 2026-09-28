/**
 * @godot-class Timer
 * @role BINDING
 *
 * Godot 4.7's `Timer` node (`scene/main/timer.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a countdown its own internal processing runs, in the
 * frame or the physics step as its `process_callback` says. At or below zero it emits `timeout`,
 * and starts again unless it is one-shot. `autostart` starts it when it is ready.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_node_adopt, godot_node_entity, godot_node_set_internal_physics, godot_node_set_internal_process, is_inside_tree, ready } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

/** `Timer::TimerProcessCallback` (`timer.h:43`). */
const PROCESS_PHYSICS = 0;

interface TimerState {
  readonly entity: object;
  waitTime: number;
  oneShot: boolean;
  autostart: boolean;
  paused: boolean;
  ignoreTimeScale: boolean;
  processCallback: number;
  timeLeft: number;
  processing: boolean;
  readonly timeout: SignalHandle<[]>;
}

const TIMERS = new WeakMap<object, TimerState>();

function stateOf(self: object, member: string): TimerState {
  const state = TIMERS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Timer`);
  return state;
}

/** `NOTIFICATION_INTERNAL_PROCESS` / `_PHYSICS_PROCESS` (`timer.cpp:44`). */
function tick(state: TimerState, delta: number): void {
  if (!state.processing) return;
  state.timeLeft -= delta;
  if (state.timeLeft < 0) {
    if (!state.oneShot) state.timeLeft += state.waitTime;
    else stopTimer(state);
    state.timeout.emit();
  }
}

/** `_set_process` (`timer.cpp:188`): the internal processing of its callback, off while paused. */
function setProcess(state: TimerState, process: boolean): void {
  const run = process && !state.paused;
  const step = (delta: number) => tick(state, delta);
  godot_node_set_internal_physics(state.entity, run && state.processCallback === PROCESS_PHYSICS ? step : undefined);
  godot_node_set_internal_process(state.entity, run && state.processCallback !== PROCESS_PHYSICS ? step : undefined);
  state.processing = process;
}

function stopTimer(state: TimerState): void {
  state.timeLeft = -1;
  setProcess(state, false);
  state.autostart = false;
}

/**
 * Makes `entity` a Timer; `autostart` starts it when it is ready (`NOTIFICATION_READY`, `:37`).
 *
 * @godot Timer (protocol)
 * @source scene/main/timer.cpp:37
 */
export function godot_timer_mount(entity: Object3D): void {
  const state: TimerState = {
    entity,
    waitTime: 1,
    oneShot: false,
    autostart: false,
    paused: false,
    ignoreTimeScale: false,
    processCallback: 1,
    timeLeft: -1,
    processing: false,
    timeout: createSignal<[]>(),
  };
  TIMERS.set(entity, state);
  ready(entity).connect(() => {
    if (state.autostart) {
      start(entity);
      state.autostart = false;
    }
  });
}

/**
 * A new Timer (`Timer.new()`).
 *
 * @godot Timer.Timer
 * @source scene/main/timer.cpp:250
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: ['Timer', 'Node', 'Object'] });
  godot_timer_mount(entity);
  return entity;
}

/**
 * @godot Timer.timeout
 * @source scene/main/timer.cpp:243
 */
export function timeout(self: object): GodotSignal<[]> {
  return stateOf(self, 'timeout').timeout.signal;
}

/**
 * A time of 0 or less fails.
 *
 * @godot Timer.set_wait_time
 * @source scene/main/timer.cpp:79
 */
export function set_wait_time(self: object, time_sec: number): void {
  if (time_sec <= 0) return;
  stateOf(self, 'set_wait_time').waitTime = time_sec;
}

/**
 * @godot Timer.get_wait_time
 * @source scene/main/timer.cpp:85
 */
export function get_wait_time(self: object): number {
  return stateOf(self, 'get_wait_time').waitTime;
}

/**
 * @godot Timer.set_one_shot
 * @source scene/main/timer.cpp:89
 */
export function set_one_shot(self: object, enable: boolean): void {
  stateOf(self, 'set_one_shot').oneShot = enable;
}

/**
 * @godot Timer.is_one_shot
 * @source scene/main/timer.cpp:93
 */
export function is_one_shot(self: object): boolean {
  return stateOf(self, 'is_one_shot').oneShot;
}

/**
 * @godot Timer.set_autostart
 * @source scene/main/timer.cpp:97
 */
export function set_autostart(self: object, enable: boolean): void {
  stateOf(self, 'set_autostart').autostart = enable;
}

/**
 * @godot Timer.has_autostart
 * @source scene/main/timer.cpp:101
 */
export function has_autostart(self: object): boolean {
  return stateOf(self, 'has_autostart').autostart;
}

/**
 * Starts the countdown from `time_sec` (the wait time when it is 0 or less); outside the tree it fails.
 *
 * @godot Timer.start
 * @source scene/main/timer.cpp:105
 */
export function start(self: object, time_sec = -1): void {
  const state = stateOf(self, 'start');
  if (!is_inside_tree(state.entity)) return;
  if (time_sec > 0) state.waitTime = time_sec;
  state.timeLeft = state.waitTime;
  setProcess(state, true);
}

/**
 * @godot Timer.stop
 * @source scene/main/timer.cpp:114
 */
export function stop(self: object): void {
  stopTimer(stateOf(self, 'stop'));
}

/**
 * @godot Timer.set_paused
 * @source scene/main/timer.cpp:120
 */
export function set_paused(self: object, paused: boolean): void {
  const state = stateOf(self, 'set_paused');
  if (state.paused === paused) return;
  state.paused = paused;
  setProcess(state, state.processing);
}

/**
 * @godot Timer.is_paused
 * @source scene/main/timer.cpp:129
 */
export function is_paused(self: object): boolean {
  return stateOf(self, 'is_paused').paused;
}

/**
 * @godot Timer.set_ignore_time_scale
 * @source scene/main/timer.cpp:133
 */
export function set_ignore_time_scale(self: object, ignore: boolean): void {
  stateOf(self, 'set_ignore_time_scale').ignoreTimeScale = ignore;
}

/**
 * @godot Timer.is_ignoring_time_scale
 * @source scene/main/timer.cpp:137
 */
export function is_ignoring_time_scale(self: object): boolean {
  return stateOf(self, 'is_ignoring_time_scale').ignoreTimeScale;
}

/**
 * @godot Timer.is_stopped
 * @source scene/main/timer.cpp:141
 */
export function is_stopped(self: object): boolean {
  return get_time_left(self) <= 0;
}

/**
 * @godot Timer.get_time_left
 * @source scene/main/timer.cpp:145
 */
export function get_time_left(self: object): number {
  const timeLeft = stateOf(self, 'get_time_left').timeLeft;
  return timeLeft > 0 ? timeLeft : 0;
}

/**
 * @godot Timer.set_timer_process_callback
 * @source scene/main/timer.cpp:149
 */
export function set_timer_process_callback(self: object, callback: number): void {
  const state = stateOf(self, 'set_timer_process_callback');
  if (state.processCallback === callback) return;
  state.processCallback = callback;
  setProcess(state, state.processing);
}

/**
 * @godot Timer.get_timer_process_callback
 * @source scene/main/timer.cpp:184
 */
export function get_timer_process_callback(self: object): number {
  return stateOf(self, 'get_timer_process_callback').processCallback;
}

const TIMER_ELEMENT = {
  create: () => new Group(),
  classes: ['Timer', 'Node', 'Object'],
  spatial: false,
  mount: godot_timer_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ['waitTime', (entity, value: number) => set_wait_time(entity, value)],
    ['oneShot', (entity, value: boolean) => set_one_shot(entity, value)],
    ['autostart', (entity, value: boolean) => set_autostart(entity, value)],
    ['paused', (entity, value: boolean) => set_paused(entity, value)],
    ['ignoreTimeScale', (entity, value: boolean) => set_ignore_time_scale(entity, value)],
    ['processCallback', (entity, value: number) => set_timer_process_callback(entity, value)],
  ]),
};

/**
 * A Timer as a scene writes it: `<GodotTimer waitTime={2} autostart />`.
 *
 * @godot Timer (protocol)
 * @source scene/main/timer.cpp:222
 */
export function GodotTimer(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(TIMER_ELEMENT, props);
}
