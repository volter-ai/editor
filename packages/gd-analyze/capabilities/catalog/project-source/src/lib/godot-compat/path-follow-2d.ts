/**
 * @godot-class PathFollow2D
 * @role BINDING
 *
 * Godot 4.7's `PathFollow2D` (`scene/2d/path_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node2D placed at `progress` along its parent
 * Path2D's curve (`progress_ratio` of its length), offset by `h_offset`/`v_offset`, rotated to the
 * curve's direction when `rotates`, the progress wrapped when it `loop`s (`_update_transform`,
 * `path_2d.cpp:231`).
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { get_baked_length, godot_curve_2d_sample } from './curve-2d';
import { godot_node_2d_mount, godot_node_2d_props, set_position, set_rotation } from './node-2d';
import { godot_path_2d_curve } from './path-2d';
import { godot_node_adopt, godot_node_entity } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector2 } from './vector2';

const CLASSES = ['PathFollow2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

interface FollowState {
  progress: number;
  hOffset: number;
  vOffset: number;
  rotates: boolean;
  loop: boolean;
}

const FOLLOWS = new WeakMap<object, FollowState>();

function stateOf(self: object, member: string): FollowState {
  const state = FOLLOWS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a PathFollow2D`);
  return state;
}

function lengthOf(entity: Object3D): number {
  const curve = entity.parent === null ? undefined : godot_path_2d_curve(entity.parent);
  return curve === null || curve === undefined ? 0 : get_baked_length(curve);
}

/** `_update_transform` (`path_2d.cpp:231`). */
function place(entity: Object3D, state: FollowState): void {
  const curve = entity.parent === null ? undefined : godot_path_2d_curve(entity.parent);
  if (curve === null || curve === undefined) return;
  const length = get_baked_length(curve);
  if (length === 0) return;
  const { position, direction } = godot_curve_2d_sample(curve, state.progress);
  // The v offset is along the curve's normal (its direction turned a quarter).
  set_position(entity, vector2(position.x + direction.x * state.hOffset - direction.y * state.vOffset, position.y + direction.y * state.hOffset + direction.x * state.vOffset));
  if (state.rotates) set_rotation(entity, Math.atan2(direction.y, direction.x));
}

/**
 * @godot PathFollow2D (protocol)
 * @source scene/2d/path_2d.cpp:470
 */
export function godot_path_follow_2d_mount(entity: Object3D): void {
  FOLLOWS.set(entity, { progress: 0, hOffset: 0, vOffset: 0, rotates: true, loop: true });
  godot_node_2d_mount(entity, CLASSES);
}

/**
 * @godot PathFollow2D.PathFollow2D
 * @source scene/2d/path_2d.cpp:470
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_path_follow_2d_mount(entity);
  return entity;
}

/**
 * Sets the progress, wrapped into the curve's length when looping, else clamped to it.
 *
 * @godot PathFollow2D.set_progress
 * @source scene/2d/path_2d.cpp:380
 */
export function set_progress(self: object, progress: number): void {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(self, 'set_progress');
  const length = lengthOf(entity);
  let value = progress;
  if (length > 0) {
    if (state.loop) {
      value %= length;
      if (value < 0) value += length;
    } else value = Math.min(Math.max(value, 0), length);
  }
  state.progress = value;
  place(entity, state);
}

/**
 * @godot PathFollow2D.get_progress
 * @source scene/2d/path_2d.cpp:405
 */
export function get_progress(self: object): number {
  return stateOf(self, 'get_progress').progress;
}

/**
 * @godot PathFollow2D.set_progress_ratio
 * @source scene/2d/path_2d.cpp:409
 */
export function set_progress_ratio(self: object, ratio: number): void {
  set_progress(self, ratio * lengthOf(godot_node_entity(self) as Object3D));
}

/**
 * @godot PathFollow2D.get_progress_ratio
 * @source scene/2d/path_2d.cpp:417
 */
export function get_progress_ratio(self: object): number {
  const length = lengthOf(godot_node_entity(self) as Object3D);
  return length > 0 ? get_progress(self) / length : 0;
}

/**
 * @godot PathFollow2D.set_h_offset
 * @source scene/2d/path_2d.cpp:340
 */
export function set_h_offset(self: object, offset: number): void {
  stateOf(self, 'set_h_offset').hOffset = offset;
}

/**
 * @godot PathFollow2D.set_v_offset
 * @source scene/2d/path_2d.cpp:352
 */
export function set_v_offset(self: object, offset: number): void {
  stateOf(self, 'set_v_offset').vOffset = offset;
}

/**
 * @godot PathFollow2D.set_rotates
 * @source scene/2d/path_2d.cpp:425
 */
export function set_rotates(self: object, enabled: boolean): void {
  stateOf(self, 'set_rotates').rotates = enabled;
}

/**
 * @godot PathFollow2D.set_loop
 * @source scene/2d/path_2d.cpp:445
 */
export function set_loop(self: object, loop: boolean): void {
  stateOf(self, 'set_loop').loop = loop;
}

const PATH_FOLLOW_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_path_follow_2d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['progress', (entity, value: number) => set_progress(entity, value)],
    ['progressRatio', (entity, value: number) => set_progress_ratio(entity, value)],
    ['hOffset', (entity, value: number) => set_h_offset(entity, value)],
    ['vOffset', (entity, value: number) => set_v_offset(entity, value)],
    ['rotates', (entity, value: boolean) => set_rotates(entity, value)],
    ['loop', (entity, value: boolean) => set_loop(entity, value)],
    ['cubicInterp', () => undefined],
  ]),
};

/**
 * A PathFollow2D as a scene writes it: `<GodotPathFollow2D progressRatio={0.5} />`.
 *
 * @godot PathFollow2D (protocol)
 * @source scene/2d/path_2d.cpp:470
 */
export function GodotPathFollow2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(PATH_FOLLOW_2D, props);
}
