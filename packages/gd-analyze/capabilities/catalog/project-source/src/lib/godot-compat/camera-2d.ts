/**
 * @godot-class Camera2D
 * @role BINDING
 *
 * Godot 4.7's `Camera2D` (`scene/2d/camera_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): the enabled camera the viewport's canvas is seen
 * through. Each frame (`_update_scroll`, `camera_2d.cpp:66`) its screen centre follows its global
 * position (smoothed at `position_smoothing_speed` when that is on), moved by `offset`, kept inside
 * its limits, and the canvas transform scales by `zoom` and puts that centre at the viewport's
 * centre (`ANCHOR_MODE_DRAG_CENTER`) or its top-left (`ANCHOR_MODE_FIXED_TOP_LEFT`). Rotation is
 * ignored (`ignore_rotation`, on by default); drag margins are not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { get_viewport_rect, godot_canvas_item_set_canvas_transform } from './canvas-item';
import { get_global_position, godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt, godot_node_entity, godot_node_set_internal_process, is_inside_tree } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as transform2d } from './transform-2d';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['Camera2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];
const ANCHOR_FIXED_TOP_LEFT = 0;
const LIMIT = 10000000;

interface CameraState {
  enabled: boolean;
  offset: Vector2;
  zoom: Vector2;
  anchorMode: number;
  /** Left, top, right, bottom. */
  limits: [number, number, number, number];
  smoothing: boolean;
  smoothingSpeed: number;
  smoothed: Vector2 | undefined;
  screenCenter: Vector2;
}

const CAMERAS = new WeakMap<object, CameraState>();
let current: Object3D | undefined;

function stateOf(self: object, member: string): CameraState {
  const state = CAMERAS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a Camera2D`);
  return state;
}

/** `_update_scroll`: the camera's view as the viewport's canvas transform. */
function update(entity: Object3D, state: CameraState, delta: number): void {
  if (!state.enabled || !is_inside_tree(entity)) return;
  if (current === undefined || !is_inside_tree(current)) current = entity;
  if (current !== entity) return;
  const target = get_global_position(entity);
  let center = target;
  if (state.smoothing && state.smoothed !== undefined) {
    const weight = Math.min(state.smoothingSpeed * delta, 1);
    center = vector2(state.smoothed.x + (target.x - state.smoothed.x) * weight, state.smoothed.y + (target.y - state.smoothed.y) * weight);
  }
  state.smoothed = center;
  const view = get_viewport_rect(entity).size;
  const halfW = view.x / 2 / state.zoom.x;
  const halfH = view.y / 2 / state.zoom.y;
  let cx = center.x + state.offset.x;
  let cy = center.y + state.offset.y;
  const [left, top, right, bottom] = state.limits;
  if (state.anchorMode === ANCHOR_FIXED_TOP_LEFT) {
    cx = Math.min(Math.max(cx, left), right - halfW * 2) + halfW;
    cy = Math.min(Math.max(cy, top), bottom - halfH * 2) + halfH;
  } else {
    cx = right - left < halfW * 2 ? (left + right) / 2 : Math.min(Math.max(cx, left + halfW), right - halfW);
    cy = bottom - top < halfH * 2 ? (top + bottom) / 2 : Math.min(Math.max(cy, top + halfH), bottom - halfH);
  }
  state.screenCenter = vector2(cx, cy);
  godot_canvas_item_set_canvas_transform(transform2d(0, vector2(state.zoom.x, state.zoom.y), 0, vector2(view.x / 2 - cx * state.zoom.x, view.y / 2 - cy * state.zoom.y)));
}

/**
 * @godot Camera2D (protocol)
 * @source scene/2d/camera_2d.cpp:1030
 */
export function godot_camera_2d_mount(entity: Object3D): void {
  const state: CameraState = {
    enabled: true,
    offset: vector2(),
    zoom: vector2(1, 1),
    anchorMode: 1,
    limits: [-LIMIT, -LIMIT, LIMIT, LIMIT],
    smoothing: false,
    smoothingSpeed: 5,
    smoothed: undefined,
    screenCenter: vector2(),
  };
  CAMERAS.set(entity, state);
  godot_node_2d_mount(entity, CLASSES);
  godot_node_set_internal_process(entity, (delta) => update(entity, state, delta));
}

/**
 * @godot Camera2D.Camera2D
 * @source scene/2d/camera_2d.cpp:1030
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_camera_2d_mount(entity);
  return entity;
}

/**
 * @godot Camera2D.set_offset
 * @source scene/2d/camera_2d.cpp:303
 */
export function set_offset(self: object, offset: Vector2): void {
  stateOf(self, 'set_offset').offset = offset;
}

/**
 * @godot Camera2D.get_offset
 * @source scene/2d/camera_2d.cpp:309
 */
export function get_offset(self: object): Vector2 {
  return stateOf(self, 'get_offset').offset;
}

/**
 * @godot Camera2D.set_zoom
 * @source scene/2d/camera_2d.cpp:823
 */
export function set_zoom(self: object, zoom: Vector2): void {
  if (zoom.x === 0 || zoom.y === 0) return;
  stateOf(self, 'set_zoom').zoom = zoom;
}

/**
 * @godot Camera2D.get_zoom
 * @source scene/2d/camera_2d.cpp:832
 */
export function get_zoom(self: object): Vector2 {
  return stateOf(self, 'get_zoom').zoom;
}

/**
 * @godot Camera2D.set_anchor_mode
 * @source scene/2d/camera_2d.cpp:313
 */
export function set_anchor_mode(self: object, mode: number): void {
  stateOf(self, 'set_anchor_mode').anchorMode = mode;
}

/**
 * @godot Camera2D.set_enabled
 * @source scene/2d/camera_2d.cpp:473
 */
export function set_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_enabled').enabled = enabled;
}

/**
 * @godot Camera2D.is_enabled
 * @source scene/2d/camera_2d.cpp:482
 */
export function is_enabled(self: object): boolean {
  return stateOf(self, 'is_enabled').enabled;
}

/**
 * The viewport's camera now (`Viewport::_camera_2d_set`).
 *
 * @godot Camera2D.make_current
 * @source scene/2d/camera_2d.cpp:486
 */
export function make_current(self: object): void {
  current = godot_node_entity(self) as Object3D;
}

/**
 * @godot Camera2D.is_current
 * @source scene/2d/camera_2d.cpp:531
 */
export function is_current(self: object): boolean {
  return current === godot_node_entity(self);
}

/**
 * A limit by `Side` (left 0, top 1, right 2, bottom 3).
 *
 * @godot Camera2D.set_limit
 * @source scene/2d/camera_2d.cpp:542
 */
export function set_limit(self: object, margin: number, limit: number): void {
  const state = stateOf(self, 'set_limit');
  if (margin >= 0 && margin < 4) state.limits[margin] = limit;
}

/**
 * @godot Camera2D.get_limit
 * @source scene/2d/camera_2d.cpp:556
 */
export function get_limit(self: object, margin: number): number {
  return stateOf(self, 'get_limit').limits[margin] ?? 0;
}

/**
 * @godot Camera2D.set_position_smoothing_enabled
 * @source scene/2d/camera_2d.cpp:691
 */
export function set_position_smoothing_enabled(self: object, enabled: boolean): void {
  stateOf(self, 'set_position_smoothing_enabled').smoothing = enabled;
}

/**
 * @godot Camera2D.set_position_smoothing_speed
 * @source scene/2d/camera_2d.cpp:647
 */
export function set_position_smoothing_speed(self: object, speed: number): void {
  stateOf(self, 'set_position_smoothing_speed').smoothingSpeed = speed;
}

/**
 * @godot Camera2D.get_screen_center_position
 * @source scene/2d/camera_2d.cpp:600
 */
export function get_screen_center_position(self: object): Vector2 {
  return stateOf(self, 'get_screen_center_position').screenCenter;
}

/**
 * The camera jumps to its target at once (`reset_smoothing`).
 *
 * @godot Camera2D.reset_smoothing
 * @source scene/2d/camera_2d.cpp:720
 */
export function reset_smoothing(self: object): void {
  stateOf(self, 'reset_smoothing').smoothed = undefined;
}

const CAMERA_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_camera_2d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['offset', (entity, value: readonly [number, number]) => set_offset(entity, vector2(...value))],
    ['zoom', (entity, value: readonly [number, number]) => set_zoom(entity, vector2(...value))],
    ['anchorMode', (entity, value: number) => set_anchor_mode(entity, value)],
    ['enabled', (entity, value: boolean) => set_enabled(entity, value)],
    ['limitLeft', (entity, value: number) => set_limit(entity, 0, value)],
    ['limitTop', (entity, value: number) => set_limit(entity, 1, value)],
    ['limitRight', (entity, value: number) => set_limit(entity, 2, value)],
    ['limitBottom', (entity, value: number) => set_limit(entity, 3, value)],
    ['positionSmoothingEnabled', (entity, value: boolean) => set_position_smoothing_enabled(entity, value)],
    ['positionSmoothingSpeed', (entity, value: number) => set_position_smoothing_speed(entity, value)],
    ['ignoreRotation', () => undefined],
    ['processCallback', () => undefined],
    ['dragHorizontalEnabled', () => undefined],
    ['dragVerticalEnabled', () => undefined],
    ['limitSmoothed', () => undefined],
    ['editorDrawLimits', () => undefined],
    ['editorDrawDragMargin', () => undefined],
    ['editorDrawScreen', () => undefined],
  ]),
};

/**
 * A Camera2D as a scene writes it: `<GodotCamera2D zoom={[2, 2]} />`.
 *
 * @godot Camera2D (protocol)
 * @source scene/2d/camera_2d.cpp:1030
 */
export function GodotCamera2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(CAMERA_2D, props);
}
