/**
 * @godot-class NavigationAgent3D
 * @role BINDING
 *
 * Godot 4.7's `NavigationAgent3D` (`scene/3d/navigation/navigation_agent_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a path from its parent to its target over the world's
 * navigation regions (`navigation-region-3d.ts`), asked for when the target is set, when there is
 * none, or once the parent strays `path_max_distance` from it. A waypoint is passed once the parent
 * is within `path_desired_distance` of it (less `path_height_offset` in height), the target reached
 * within `target_desired_distance` of it. Avoidance is not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D, Vector3 as ThreeVector3 } from 'three';
import { godot_navigation_path } from './navigation-region-3d';
import { godot_node_entity, is_inside_tree } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector3, type Vector3 } from './vector3';

interface AgentState {
  target: Vector3;
  submitted: boolean;
  path: Vector3[];
  index: number;
  reached: boolean;
  finished: boolean;
  lastWaypoint: boolean;
  pathDesiredDistance: number;
  targetDesiredDistance: number;
  pathHeightOffset: number;
  pathMaxDistance: number;
}

const AGENTS = new WeakMap<object, AgentState>();

/** An agent as Godot starts one (`navigation_agent_3d.h:59`). */
function stateOf(self: object): AgentState {
  const entity = godot_node_entity(self);
  let state = AGENTS.get(entity);
  if (state === undefined) {
    state = {
      target: vector3(0, 0, 0),
      submitted: false,
      path: [],
      index: 0,
      reached: false,
      finished: false,
      lastWaypoint: false,
      pathDesiredDistance: 1,
      targetDesiredDistance: 1,
      pathHeightOffset: 0,
      pathMaxDistance: 5,
    };
    AGENTS.set(entity, state);
  }
  return state;
}

const point = new ThreeVector3();
const a = new ThreeVector3();
const b = new ThreeVector3();

const distance = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

/** A waypoint as the agent reads it: lowered by the height offset. */
function waypoint(state: AgentState, index: number): Vector3 {
  const at = state.path[index] as Vector3;
  return vector3(at.x, at.y - state.pathHeightOffset, at.z);
}

/** Where the agent's parent stands. */
function originOf(entity: Object3D): Vector3 | undefined {
  const parent = entity.parent;
  if (parent === null) return undefined;
  parent.getWorldPosition(point);
  return vector3(point.x, point.y, point.z);
}

/** The path brought up to where the parent stands (`_update_navigation`, `navigation_agent_3d.cpp:799`). */
function update(self: object): AgentState {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(entity);
  const origin = originOf(entity);
  if (origin === undefined || !is_inside_tree(entity) || !state.submitted) return state;
  let reload = state.path.length === 0;
  if (!reload && state.index > 0) {
    // Too far from the segment it follows.
    const from = waypoint(state, state.index - 1);
    const to = waypoint(state, state.index);
    a.set(from.x, from.y, from.z);
    b.set(to.x, to.y, to.z);
    const closest = b.clone().sub(a);
    const length = closest.lengthSq();
    const t = length === 0 ? 0 : Math.min(Math.max(new ThreeVector3(origin.x, origin.y, origin.z).sub(a).dot(closest) / length, 0), 1);
    const on = a.clone().addScaledVector(closest, t);
    if (distance(origin, on) >= state.pathMaxDistance) reload = true;
  }
  if (reload) {
    state.path = godot_navigation_path(origin, state.target);
    state.index = 0;
    state.finished = false;
    state.lastWaypoint = false;
  }
  if (state.path.length === 0 || state.finished) return state;
  const advance = () => {
    while (!state.lastWaypoint && distance(origin, waypoint(state, state.index)) < state.pathDesiredDistance) {
      if (state.index === state.path.length - 1) state.lastWaypoint = true;
      else state.index += 1;
    }
  };
  if (distance(origin, state.target) < state.targetDesiredDistance) {
    advance();
    state.reached = true;
    state.finished = true;
  } else {
    advance();
    if (state.lastWaypoint && state.targetDesiredDistance < distance(waypoint(state, state.path.length - 1), state.target)) state.finished = true;
  }
  return state;
}

/**
 * @godot NavigationAgent3D.set_target_position
 * @source scene/3d/navigation/navigation_agent_3d.cpp:705
 */
export function set_target_position(self: object, position: Vector3): void {
  const state = stateOf(self);
  state.target = vector3(position.x, position.y, position.z);
  state.submitted = true;
  // `_request_repath`: the path is asked for again.
  state.path = [];
  state.reached = false;
  state.finished = false;
  state.lastWaypoint = false;
}

/**
 * @godot NavigationAgent3D.get_target_position
 * @source scene/3d/navigation/navigation_agent_3d.cpp:715
 */
export function get_target_position(self: object): Vector3 {
  return stateOf(self).target;
}

/**
 * The waypoint to head for; the parent's own place where there is no path.
 *
 * @godot NavigationAgent3D.get_next_path_position
 * @source scene/3d/navigation/navigation_agent_3d.cpp:719
 */
export function get_next_path_position(self: object): Vector3 {
  const state = update(self);
  if (state.path.length === 0) return originOf(godot_node_entity(self) as Object3D) ?? vector3(0, 0, 0);
  return waypoint(state, state.index);
}

/**
 * @godot NavigationAgent3D.distance_to_target
 * @source scene/3d/navigation/navigation_agent_3d.cpp:731
 */
export function distance_to_target(self: object): number {
  const origin = originOf(godot_node_entity(self) as Object3D);
  return origin === undefined ? 0 : distance(origin, stateOf(self).target);
}

/**
 * @godot NavigationAgent3D.is_target_reached
 * @source scene/3d/navigation/navigation_agent_3d.cpp:736
 */
export function is_target_reached(self: object): boolean {
  return stateOf(self).reached;
}

/**
 * @godot NavigationAgent3D.is_target_reachable
 * @source scene/3d/navigation/navigation_agent_3d.cpp:740
 */
export function is_target_reachable(self: object): boolean {
  const state = update(self);
  return state.path.length > 0 && state.targetDesiredDistance >= distance(waypoint(state, state.path.length - 1), state.target);
}

/**
 * @godot NavigationAgent3D.is_navigation_finished
 * @source scene/3d/navigation/navigation_agent_3d.cpp:749
 */
export function is_navigation_finished(self: object): boolean {
  return update(self).finished;
}

/**
 * @godot NavigationAgent3D.get_final_position
 * @source scene/3d/navigation/navigation_agent_3d.cpp:754
 */
export function get_final_position(self: object): Vector3 {
  const state = update(self);
  return state.path.length === 0 ? vector3(0, 0, 0) : waypoint(state, state.path.length - 1);
}

/**
 * @godot NavigationAgent3D.set_path_desired_distance
 * @source scene/3d/navigation/navigation_agent_3d.cpp:591
 */
export function set_path_desired_distance(self: object, desired_distance: number): void {
  stateOf(self).pathDesiredDistance = desired_distance;
}

/**
 * @godot NavigationAgent3D.get_path_desired_distance
 * @source scene/3d/navigation/navigation_agent_3d.h:167
 */
export function get_path_desired_distance(self: object): number {
  return stateOf(self).pathDesiredDistance;
}

/**
 * @godot NavigationAgent3D.set_target_desired_distance
 * @source scene/3d/navigation/navigation_agent_3d.cpp:599
 */
export function set_target_desired_distance(self: object, desired_distance: number): void {
  stateOf(self).targetDesiredDistance = desired_distance;
}

/**
 * @godot NavigationAgent3D.get_target_desired_distance
 * @source scene/3d/navigation/navigation_agent_3d.h:170
 */
export function get_target_desired_distance(self: object): number {
  return stateOf(self).targetDesiredDistance;
}

/**
 * @godot NavigationAgent3D.set_path_height_offset
 * @source scene/3d/navigation/navigation_agent_3d.cpp:626
 */
export function set_path_height_offset(self: object, path_height_offset: number): void {
  stateOf(self).pathHeightOffset = path_height_offset;
}

/**
 * @godot NavigationAgent3D.get_path_height_offset
 * @source scene/3d/navigation/navigation_agent_3d.h:179
 */
export function get_path_height_offset(self: object): number {
  return stateOf(self).pathHeightOffset;
}

/**
 * @godot NavigationAgent3D.set_path_max_distance
 * @source scene/3d/navigation/navigation_agent_3d.cpp:693
 */
export function set_path_max_distance(self: object, max_speed: number): void {
  stateOf(self).pathMaxDistance = max_speed;
}

/**
 * @godot NavigationAgent3D.get_path_max_distance
 * @source scene/3d/navigation/navigation_agent_3d.cpp:701
 */
export function get_path_max_distance(self: object): number {
  return stateOf(self).pathMaxDistance;
}

const NAVIGATION_AGENT_3D = {
  create: () => new Group(),
  spatial: false,
  mount: (entity: Object3D) => void stateOf(entity),
  props: new Map<string, GodotElementProp<Object3D>>([
    ['pathDesiredDistance', (entity, value: number) => set_path_desired_distance(entity, value)],
    ['targetDesiredDistance', (entity, value: number) => set_target_desired_distance(entity, value)],
    ['pathHeightOffset', (entity, value: number) => set_path_height_offset(entity, value)],
    ['pathMaxDistance', (entity, value: number) => set_path_max_distance(entity, value)],
  ]),
};

/**
 * A NavigationAgent3D as a scene writes it: `<GodotNavigationAgent3D targetDesiredDistance={0.1} />`.
 *
 * @godot NavigationAgent3D (protocol)
 * @source scene/3d/navigation/navigation_agent_3d.cpp:353
 */
export function GodotNavigationAgent3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(NAVIGATION_AGENT_3D, props);
}
