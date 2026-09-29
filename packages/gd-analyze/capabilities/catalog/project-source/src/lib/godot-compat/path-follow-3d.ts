/**
 * @godot-class PathFollow3D
 * @role BINDING
 *
 * Godot 4.7's `PathFollow3D` (`scene/3d/path_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node3D placed at `progress` along its parent
 * Path3D's curve (`progress_ratio` of its length), offset by `h_offset`/`v_offset`, turned to face
 * along the curve by its rotation mode (none, about Y, or fully), the progress wrapped when it
 * `loop`s (`_update_transform`, `path_3d.cpp:263`). Tilts are not applied.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { get_baked_length, godot_curve_3d_sample } from './curve-3d';
import { godot_node_adopt, godot_node_entity } from './node';
import { set_position, set_rotation } from './node-3d';
import { godot_path_3d_curve } from './path-3d';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector3 } from './vector3';

const CLASSES = ['PathFollow3D', 'Node3D', 'Node', 'Object'];
const ROTATION_NONE = 0;
const ROTATION_Y = 1;

interface FollowState {
  progress: number;
  hOffset: number;
  vOffset: number;
  rotationMode: number;
  loop: boolean;
}

const FOLLOWS = new WeakMap<object, FollowState>();

function stateOf(self: object, member: string): FollowState {
  const state = FOLLOWS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a PathFollow3D`);
  return state;
}

function lengthOf(entity: Object3D): number {
  const curve = entity.parent === null ? undefined : godot_path_3d_curve(entity.parent);
  return curve === null || curve === undefined ? 0 : get_baked_length(curve);
}

/** `_update_transform` (`path_3d.cpp:263`). */
function place(entity: Object3D, state: FollowState): void {
  const curve = entity.parent === null ? undefined : godot_path_3d_curve(entity.parent);
  if (curve === null || curve === undefined || get_baked_length(curve) === 0) return;
  const { position, direction } = godot_curve_3d_sample(curve, state.progress);
  set_position(entity, vector3(position.x + direction.z * state.hOffset, position.y + state.vOffset, position.z - direction.x * state.hOffset));
  if (state.rotationMode === ROTATION_NONE) return;
  // Facing along the curve: the node's -Z to the direction (about Y only for `ROTATION_Y`).
  const yaw = Math.atan2(-direction.x, -direction.z);
  const pitch = state.rotationMode === ROTATION_Y ? 0 : Math.asin(Math.max(-1, Math.min(1, direction.y)));
  set_rotation(entity, vector3(pitch, yaw, 0));
}

/**
 * @godot PathFollow3D (protocol)
 * @source scene/3d/path_3d.cpp:520
 */
export function godot_path_follow_3d_mount(entity: Object3D): void {
  FOLLOWS.set(entity, { progress: 0, hOffset: 0, vOffset: 0, rotationMode: 3, loop: true });
}

/**
 * @godot PathFollow3D.PathFollow3D
 * @source scene/3d/path_3d.cpp:520
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'spatial', classes: CLASSES });
  godot_path_follow_3d_mount(entity);
  return entity;
}

/**
 * @godot PathFollow3D.set_progress
 * @source scene/3d/path_3d.cpp:437
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
 * @godot PathFollow3D.get_progress
 * @source scene/3d/path_3d.cpp:462
 */
export function get_progress(self: object): number {
  return stateOf(self, 'get_progress').progress;
}

/**
 * @godot PathFollow3D.set_progress_ratio
 * @source scene/3d/path_3d.cpp:466
 */
export function set_progress_ratio(self: object, ratio: number): void {
  set_progress(self, ratio * lengthOf(godot_node_entity(self) as Object3D));
}

/**
 * @godot PathFollow3D.get_progress_ratio
 * @source scene/3d/path_3d.cpp:474
 */
export function get_progress_ratio(self: object): number {
  const length = lengthOf(godot_node_entity(self) as Object3D);
  return length > 0 ? get_progress(self) / length : 0;
}

/**
 * @godot PathFollow3D.set_h_offset
 * @source scene/3d/path_3d.cpp:407
 */
export function set_h_offset(self: object, offset: number): void {
  stateOf(self, 'set_h_offset').hOffset = offset;
}

/**
 * @godot PathFollow3D.set_v_offset
 * @source scene/3d/path_3d.cpp:422
 */
export function set_v_offset(self: object, offset: number): void {
  stateOf(self, 'set_v_offset').vOffset = offset;
}

/**
 * @godot PathFollow3D.set_rotation_mode
 * @source scene/3d/path_3d.cpp:482
 */
export function set_rotation_mode(self: object, mode: number): void {
  stateOf(self, 'set_rotation_mode').rotationMode = mode;
}

/**
 * @godot PathFollow3D.set_loop
 * @source scene/3d/path_3d.cpp:497
 */
export function set_loop(self: object, loop: boolean): void {
  stateOf(self, 'set_loop').loop = loop;
}

const PATH_FOLLOW_3D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: true,
  mount: godot_path_follow_3d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ['progress', (entity, value: number) => set_progress(entity, value)],
    ['progressRatio', (entity, value: number) => set_progress_ratio(entity, value)],
    ['hOffset', (entity, value: number) => set_h_offset(entity, value)],
    ['vOffset', (entity, value: number) => set_v_offset(entity, value)],
    ['rotationMode', (entity, value: number) => set_rotation_mode(entity, value)],
    ['loop', (entity, value: boolean) => set_loop(entity, value)],
    ['cubicInterp', () => undefined],
    ['tiltEnabled', () => undefined],
    ['useModelFront', () => undefined],
  ]),
};

/**
 * A PathFollow3D as a scene writes it: `<GodotPathFollow3D progressRatio={0.5} />`.
 *
 * @godot PathFollow3D (protocol)
 * @source scene/3d/path_3d.cpp:520
 */
export function GodotPathFollow3D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(PATH_FOLLOW_3D, props);
}
