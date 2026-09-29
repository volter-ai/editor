/**
 * @godot-class VisibleOnScreenNotifier3D
 * @role BINDING
 *
 * Godot 4.7's `VisibleOnScreenNotifier3D` (`scene/3d/visible_on_screen_notifier_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): whether its `aabb` is in a camera's view, as the
 * rendering server's culling finds it. On the page, three's own frustum culling decides: an
 * invisible box of the aabb is drawn only when it is in view, and a frame it was drawn in is a
 * frame it was on screen; `screen_entered` and `screen_exited` when that changes.
 */

import type { ReactElement } from 'react';
import { BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { godot_node_adopt, godot_node_entity, godot_node_set_internal_process, is_inside_tree } from './node';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { construct as vector3, type Vector3 } from './vector3';

interface AABB {
  readonly position: Vector3;
  readonly size: Vector3;
}

const aabb = (position: Vector3, size: Vector3): AABB => Object.freeze({ position, size });

const CLASSES = ['VisibleOnScreenNotifier3D', 'VisualInstance3D', 'Node3D', 'Node', 'Object'];

interface NotifierState {
  box: AABB;
  drawn: boolean;
  onScreen: boolean;
  readonly probe: Mesh;
  readonly entered: SignalHandle<[]>;
  readonly exited: SignalHandle<[]>;
}

const NOTIFIERS = new WeakMap<object, NotifierState>();

function stateOf(self: object, member: string): NotifierState {
  const state = NOTIFIERS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a VisibleOnScreenNotifier3D`);
  return state;
}

function shape(state: NotifierState): void {
  const { position, size } = state.box;
  state.probe.geometry.dispose();
  state.probe.geometry = new BoxGeometry(Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3));
  state.probe.position.set(position.x + size.x / 2, position.y + size.y / 2, position.z + size.z / 2);
}

/**
 * Makes `entity` a notifier of the 2×2×2 box around its origin (`visible_on_screen_notifier_3d.h:40`).
 *
 * @godot VisibleOnScreenNotifier3D (protocol)
 * @source scene/3d/visible_on_screen_notifier_3d.cpp:107
 */
export function godot_visible_on_screen_notifier_3d_mount(entity: Object3D): void {
  const probe = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }));
  probe.frustumCulled = true;
  probe.renderOrder = -1000;
  const state: NotifierState = { box: aabb(vector3(-1, -1, -1), vector3(2, 2, 2)), drawn: false, onScreen: false, probe, entered: createSignal<[]>(), exited: createSignal<[]>() };
  probe.onBeforeRender = () => {
    state.drawn = true;
  };
  entity.add(probe);
  NOTIFIERS.set(entity, state);
  godot_node_set_internal_process(entity, () => {
    const now = state.drawn && is_inside_tree(entity);
    state.drawn = false;
    if (now === state.onScreen) return;
    state.onScreen = now;
    (now ? state.entered : state.exited).emit();
  });
}

/**
 * @godot VisibleOnScreenNotifier3D.set_aabb
 * @source scene/3d/visible_on_screen_notifier_3d.cpp:50
 */
export function set_aabb(self: object, box: AABB): void {
  const state = stateOf(self, 'set_aabb');
  state.box = box;
  shape(state);
}

/**
 * @godot VisibleOnScreenNotifier3D.get_aabb
 * @source scene/3d/visible_on_screen_notifier_3d.cpp:62
 */
export function get_aabb(self: object): AABB {
  return stateOf(self, 'get_aabb').box;
}

/**
 * @godot VisibleOnScreenNotifier3D.is_on_screen
 * @source scene/3d/visible_on_screen_notifier_3d.cpp:66
 */
export function is_on_screen(self: object): boolean {
  return stateOf(self, 'is_on_screen').onScreen;
}

/**
 * @godot VisibleOnScreenNotifier3D.screen_entered
 * @source scene/3d/visible_on_screen_notifier_3d.cpp:101
 */
export function screen_entered(self: object): GodotSignal<[]> {
  return stateOf(self, 'screen_entered').entered.signal;
}

/**
 * @godot VisibleOnScreenNotifier3D.screen_exited
 * @source scene/3d/visible_on_screen_notifier_3d.cpp:102
 */
export function screen_exited(self: object): GodotSignal<[]> {
  return stateOf(self, 'screen_exited').exited.signal;
}

const NOTIFIER_3D = {
  create: () => new Mesh(),
  classes: CLASSES,
  spatial: true,
  mount: godot_visible_on_screen_notifier_3d_mount,
  advances: true,
  props: new Map<string, GodotElementProp<Object3D>>([
    ['aabb', (entity, value: readonly [number, number, number, number, number, number]) => set_aabb(entity, aabb(vector3(value[0], value[1], value[2]), vector3(value[3], value[4], value[5])))],
  ]),
};

/**
 * A VisibleOnScreenNotifier3D as a scene writes it: `<GodotVisibleOnScreenNotifier3D aabb={[-1, -1, -1, 2, 2, 2]} />`.
 *
 * @godot VisibleOnScreenNotifier3D (protocol)
 * @source scene/3d/visible_on_screen_notifier_3d.cpp:107
 */
export function GodotVisibleOnScreenNotifier3D(props: GodotElementProps<Mesh>): ReactElement {
  return useGodotElement(NOTIFIER_3D, props);
}
