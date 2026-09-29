/**
 * @godot-class Area3D
 * @role BINDING
 *
 * Godot 4.7's `Area3D` (`scene/3d/physics/area_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) over Rapier's sensors. The area's JSX body is a fixed
 * `<RigidBody sensor>`; Rapier reports each collider pair that starts or stops intersecting it,
 * and its `onIntersectionEnter` / `onIntersectionExit` hand the event here
 * (`godot_area_3d_intersection`). A body whose layer the area's mask takes is counted by the
 * collider pairs it overlaps (Godot's `_body_inout` reference count, `area_3d.cpp:224`): the
 * first pair emits `body_entered`, the last to leave `body_exited`; a body leaving the tree while
 * inside is exited at once and entered again if it comes back (`_body_exit_tree`, `:210`). Rapier
 * reports an overlap from its step, a step after Godot's `flush_queries` would, and reports
 * changes only: a body already inside when monitoring turns back on enters when it next starts
 * overlapping.
 */

import type { Collider } from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import { godot_collision_object_kind, godot_collision_object_layers, godot_collision_object_of_collider } from './collision-object-3d';
import { godot_node_entity, godot_node_object, godot_node_tree_signal, is_inside_tree } from './node';
import { createSignal, type GodotConnection, type GodotSignal, type SignalHandle } from './signal';

interface BodyEntry {
  rc: number;
  inTree: boolean;
  readonly connections: GodotConnection[];
}

interface AreaState {
  monitoring: boolean;
  monitorable: boolean;
  /** `Area3D::body_map`, in the order bodies entered. */
  readonly bodies: Map<object, BodyEntry>;
  locked: boolean;
  readonly bodyEntered: SignalHandle<[object]>;
  readonly bodyExited: SignalHandle<[object]>;
}

const AREA = new Map<object, AreaState>();

/**
 * An area's body signals, made when a scene first connects one or when the area is registered,
 * whichever is first: a scene connects while it instantiates (`packed_scene.cpp:682`), before the
 * physics protocol meets a body its JSX declares.
 */
const SIGNALS = new WeakMap<object, { readonly bodyEntered: SignalHandle<[object]>; readonly bodyExited: SignalHandle<[object]> }>();

function signalsOf(entity: object): { readonly bodyEntered: SignalHandle<[object]>; readonly bodyExited: SignalHandle<[object]> } {
  let signals = SIGNALS.get(entity);
  if (signals === undefined) {
    signals = { bodyEntered: createSignal<[object]>(), bodyExited: createSignal<[object]>() };
    SIGNALS.set(entity, signals);
  }
  return signals;
}
/** An area's state, made the first time it is asked for, with `monitoring` its `userData`'s. */
function stateOf(object: object, _member: string): AreaState {
  const entity = godot_node_entity(object);
  godot_area_3d_adopt(entity);
  return AREA.get(entity) as AreaState;
}

/** `add_body_to_query` / `remove_body_from_query` (`godot_area_3d.cpp:195`). */
/** `Area3D::_body_inout` (`area_3d.cpp:224`). */
function bodyInout(area: AreaState, added: boolean, body: object): void {
  const entry = area.bodies.get(body);
  if (!added && entry === undefined) return;
  area.locked = true;
  if (added) {
    if (entry === undefined) {
      const created: BodyEntry = { rc: 0, inTree: is_inside_tree(body), connections: [] };
      area.bodies.set(body, created);
      created.connections.push(
        godot_node_tree_signal(body, 'tree_entered').connect(() => {
          created.inTree = true;
          area.bodyEntered.emit(godot_node_object(body));
        }),
        godot_node_tree_signal(body, 'tree_exiting').connect(() => {
          created.inTree = false;
          area.bodyExited.emit(godot_node_object(body));
        }),
      );
      if (created.inTree) area.bodyEntered.emit(godot_node_object(body));
      created.rc += 1;
    } else entry.rc += 1;
  } else if (entry !== undefined) {
    entry.rc -= 1;
    if (entry.rc === 0) {
      area.bodies.delete(body);
      for (const connection of entry.connections) connection.disconnect();
      if (entry.inTree) area.bodyExited.emit(godot_node_object(body));
    }
  }
  area.locked = false;
}


/**
 * A Rapier intersection event on the area's sensor (`onIntersectionEnter` / `onIntersectionExit`
 * of its `<RigidBody>`, whose `target` is the area's collider): the other collider's body enters or
 * leaves the area, if the area is monitoring and its mask takes the body's layer.
 *
 * @godot Area3D (protocol)
 * @source scene/3d/physics/area_3d.cpp:224
 */
export function godot_area_3d_intersection(
  event: { readonly target: { readonly collider: Collider }; readonly other: { readonly collider: Collider } },
  entered: boolean,
): void {
  const entity = godot_collision_object_of_collider(event.target.collider);
  const body = godot_collision_object_of_collider(event.other.collider);
  if (entity === undefined || body === undefined) return;
  const state = stateOf(entity, 'body_entered');
  if (!state.monitoring || godot_collision_object_kind(body) === 'area') return;
  if ((godot_collision_object_layers(entity).mask & godot_collision_object_layers(body).layer) === 0) return;
  bodyInout(state, entered, body);
}

/**
 * Registers a node as an Area3D: monitoring and monitorable (`area_3d.cpp:818`).
 *
 * @godot Area3D (protocol)
 * @source scene/3d/physics/area_3d.cpp:818
 */
export function godot_area_3d_adopt(entity: object): void {
  if (AREA.has(entity)) return;
  const data = ((entity as Object3D).userData ?? {}) as Readonly<Record<string, unknown>>;
  AREA.set(entity, {
    monitoring: data['monitoring'] === undefined ? true : Boolean(data['monitoring']),
    monitorable: data['monitorable'] === undefined ? true : Boolean(data['monitorable']),
    bodies: new Map(),
    locked: false,
    ...signalsOf(entity),
  });
}

/**
 * The area's `body_entered` or `body_exited` signal, whose argument is the body node.
 *
 * @godot Area3D (protocol)
 * @source scene/3d/physics/area_3d.cpp:265
 */
export function godot_area_3d_signal(self: object, name: 'body_entered' | 'body_exited'): GodotSignal<[object]> {
  const signals = signalsOf(godot_node_entity(self));
  return (name === 'body_entered' ? signals.bodyEntered : signals.bodyExited).signal;
}

/**
 * The area's `body_entered` signal, whose argument is the body node.
 *
 * @godot Area3D.body_entered
 * @source scene/3d/physics/area_3d.cpp:265
 */
export function body_entered(self: object): GodotSignal<[object]> {
  return godot_area_3d_signal(self, 'body_entered');
}

/**
 * The area's `body_exited` signal, whose argument is the body node.
 *
 * @godot Area3D.body_exited
 * @source scene/3d/physics/area_3d.cpp:265
 */
export function body_exited(self: object): GodotSignal<[object]> {
  return godot_area_3d_signal(self, 'body_exited');
}

/**
 * Turning monitoring off exits every body in the tree at once (`_clear_monitoring`,
 * `area_3d.cpp:305`) and drops the server's pending counts; turning it on re-tests every pair, so
 * bodies already inside enter again at the next flush (`GodotArea3D::set_monitor_callback`,
 * `godot_area_3d.cpp:93`). Blocked inside an in/out signal.
 *
 * @godot Area3D.set_monitoring
 * @source scene/3d/physics/area_3d.cpp:381
 */
export function set_monitoring(self: object, enable: boolean): void {
  const state = stateOf(self, 'set_monitoring');
  if (state.locked || enable === state.monitoring) return;
  state.monitoring = enable;
  if (enable) return;
  const bodies = [...state.bodies];
  state.bodies.clear();
  for (const [body, entry] of bodies) {
    for (const connection of entry.connections) connection.disconnect();
    if (entry.inTree) state.bodyExited.emit(godot_node_object(body));
  }
}

/**
 * Whether other areas see this one (`Area3D::set_monitorable`); stored with the area's state.
 *
 * @godot Area3D.set_monitorable
 * @source scene/3d/physics/area_3d.cpp:530
 */
export function set_monitorable(self: object, enable: boolean): void {
  stateOf(self, 'set_monitorable').monitorable = enable;
}

/**
 * @godot Area3D.is_monitorable
 * @source scene/3d/physics/area_3d.cpp:544
 */
export function is_monitorable(self: object): boolean {
  return stateOf(self, 'is_monitorable').monitorable;
}

/**
 * @godot Area3D.is_monitoring
 * @source scene/3d/physics/area_3d.cpp:511
 */
export function is_monitoring(self: object): boolean {
  return stateOf(self, 'is_monitoring').monitoring;
}

/**
 * The bodies in the area's body map, in the order they entered; empty with monitoring off.
 *
 * @godot Area3D.get_overlapping_bodies
 * @source scene/3d/physics/area_3d.cpp:515
 */
export function get_overlapping_bodies(self: object): object[] {
  const state = stateOf(self, 'get_overlapping_bodies');
  if (!state.monitoring) return [];
  return [...state.bodies.keys()].map((body) => godot_node_object(body));
}

/**
 * @godot Area3D.has_overlapping_bodies
 * @source scene/3d/physics/area_3d.cpp:532
 */
export function has_overlapping_bodies(self: object): boolean {
  const state = stateOf(self, 'has_overlapping_bodies');
  return state.monitoring && state.bodies.size > 0;
}

/**
 * @godot Area3D.overlaps_body
 * @source scene/3d/physics/area_3d.cpp:583
 */
export function overlaps_body(self: object, body: object): boolean {
  return stateOf(self, 'overlaps_body').bodies.get(godot_node_entity(body))?.inTree ?? false;
}
