/**
 * @godot-class VisibleOnScreenNotifier2D
 * @role BINDING
 *
 * Godot 4.7's `VisibleOnScreenNotifier2D` (`scene/2d/visible_on_screen_notifier_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): its `rect`, through its transform with the canvas,
 * tested against the viewport's visible rect each frame (the rendering server's culling pass);
 * `screen_entered` and `screen_exited` when that changes.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { get_global_transform_with_canvas, get_viewport_rect } from './canvas-item';
import { godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { godot_node_adopt, godot_node_entity, godot_node_set_internal_process, is_inside_tree } from './node';
import { construct as rect2, type Rect2 } from './rect2';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';

const CLASSES = ['VisibleOnScreenNotifier2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

interface NotifierState {
  rect: Rect2;
  onScreen: boolean;
  readonly entered: SignalHandle<[]>;
  readonly exited: SignalHandle<[]>;
}

const NOTIFIERS = new WeakMap<object, NotifierState>();

function stateOf(self: object, member: string): NotifierState {
  const state = NOTIFIERS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a VisibleOnScreenNotifier2D`);
  return state;
}

/** Whether the rect, placed in the viewport, meets its visible rect. */
function onScreen(entity: Object3D, rect: Rect2): boolean {
  if (!is_inside_tree(entity)) return false;
  const t = get_global_transform_with_canvas(entity);
  const corners = [
    [rect.position.x, rect.position.y],
    [rect.position.x + rect.size.x, rect.position.y],
    [rect.position.x, rect.position.y + rect.size.y],
    [rect.position.x + rect.size.x, rect.position.y + rect.size.y],
  ].map(([x, y]) => [t.x.x * (x as number) + t.y.x * (y as number) + t.origin.x, t.x.y * (x as number) + t.y.y * (y as number) + t.origin.y] as const);
  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);
  const view = get_viewport_rect(entity);
  return Math.max(...xs) >= view.position.x && Math.min(...xs) <= view.position.x + view.size.x && Math.max(...ys) >= view.position.y && Math.min(...ys) <= view.position.y + view.size.y;
}

/**
 * Makes `entity` a notifier of a 20×20 rect around its origin, checked each frame.
 *
 * @godot VisibleOnScreenNotifier2D (protocol)
 * @source scene/2d/visible_on_screen_notifier_2d.cpp:190
 */
export function godot_visible_on_screen_notifier_2d_mount(entity: Object3D): void {
  const state: NotifierState = { rect: rect2(-10, -10, 20, 20), onScreen: false, entered: createSignal<[]>(), exited: createSignal<[]>() };
  NOTIFIERS.set(entity, state);
  godot_node_2d_mount(entity, CLASSES);
  godot_node_set_internal_process(entity, () => {
    const now = onScreen(entity, state.rect);
    if (now === state.onScreen) return;
    state.onScreen = now;
    (now ? state.entered : state.exited).emit();
  });
}

/**
 * @godot VisibleOnScreenNotifier2D.VisibleOnScreenNotifier2D
 * @source scene/2d/visible_on_screen_notifier_2d.cpp:190
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_visible_on_screen_notifier_2d_mount(entity);
  return entity;
}

/**
 * @godot VisibleOnScreenNotifier2D.set_rect
 * @source scene/2d/visible_on_screen_notifier_2d.cpp:57
 */
export function set_rect(self: object, rect: Rect2): void {
  stateOf(self, 'set_rect').rect = rect;
}

/**
 * @godot VisibleOnScreenNotifier2D.get_rect
 * @source scene/2d/visible_on_screen_notifier_2d.cpp:64
 */
export function get_rect(self: object): Rect2 {
  return stateOf(self, 'get_rect').rect;
}

/**
 * @godot VisibleOnScreenNotifier2D.is_on_screen
 * @source scene/2d/visible_on_screen_notifier_2d.cpp:52
 */
export function is_on_screen(self: object): boolean {
  return stateOf(self, 'is_on_screen').onScreen;
}

/**
 * @godot VisibleOnScreenNotifier2D.screen_entered
 * @source scene/2d/visible_on_screen_notifier_2d.cpp:185
 */
export function screen_entered(self: object): GodotSignal<[]> {
  return stateOf(self, 'screen_entered').entered.signal;
}

/**
 * @godot VisibleOnScreenNotifier2D.screen_exited
 * @source scene/2d/visible_on_screen_notifier_2d.cpp:186
 */
export function screen_exited(self: object): GodotSignal<[]> {
  return stateOf(self, 'screen_exited').exited.signal;
}

const NOTIFIER_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_visible_on_screen_notifier_2d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([...godot_node_2d_props(), ['rect', (entity, value: readonly [number, number, number, number]) => set_rect(entity, rect2(...value))]]),
};

/**
 * A VisibleOnScreenNotifier2D as a scene writes it: `<GodotVisibleOnScreenNotifier2D rect={[-10, -10, 20, 20]} />`.
 *
 * @godot VisibleOnScreenNotifier2D (protocol)
 * @source scene/2d/visible_on_screen_notifier_2d.cpp:190
 */
export function GodotVisibleOnScreenNotifier2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(NOTIFIER_2D, props);
}
