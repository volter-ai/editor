/**
 * @godot-class Area3D
 * @role BINDING
 *
 * Godot 4.7's `Area3D` (`scene/3d/physics/area_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a collision object whose shapes are Rapier sensors
 * (`collision-object-3d.ts`), and GodotPhysics3D's area monitoring over them
 * (`modules/godot_physics_3d/godot_area_3d.cpp`, `godot_area_pair_3d.cpp`).
 *
 * In each space step, once shapes and kinematic bodies are updated and before bodies integrate
 * (`GodotStep3D::step`, `godot_step_3d.cpp:225`), the area-shape/body-shape pairs of an area in
 * the moved list (its transform, shapes, layer, mask or monitoring changed) or of an active body (a
 * kinematic body that moved this step) are tested (`GodotAreaPair3D::setup`: the area's mask
 * against the body's layer, then the two shapes' overlap, which Rapier's shape intersection test
 * decides); a still StaticBody3D never enters an unmoved area. A pair whose overlap changed
 * counts up or down in the area's monitored map, kept in insertion order as Godot's HashMap is. The
 * next `flush_queries` (`GodotArea3D::call_queries`, `godot_area_3d.cpp:235`) hands each nonzero
 * entry to `_body_inout` (`area_3d.cpp:224`), which keeps the node-side body map and emits
 * `body_entered` / `body_exited`; a body leaving the tree while inside is exited at once
 * (`_body_exit_tree`, `area_3d.cpp:210`). The signals are reached through
 * `godot_area_3d_signal` (Godot signals have no evidence symbol kind yet).
 */

import type { Collider } from '@dimforge/rapier3d-compat';
import { godot_collision_object_adopt, godot_collision_object_state, godot_collision_object_touch, godot_collision_objects } from './collision-object-3d';
import { godot_node_entity, godot_node_object, godot_node_tree_signal, is_inside_tree } from './node';
import { createSignal, type GodotConnection, type GodotSignal, type SignalHandle } from './signal';
import { godot_world_3d_physics_callbacks } from './world-3d';

interface Pending {
  readonly body: object;
  readonly bodyShape: number;
  readonly areaShape: number;
  state: number;
}

interface BodyEntry {
  rc: number;
  inTree: boolean;
  readonly connections: GodotConnection[];
}

interface AreaState {
  monitoring: boolean;
  monitorable: boolean;
  /** `GodotAreaPair3D::colliding` of each area-shape/body-shape pair. */
  readonly colliding: Map<string, Pending>;
  /** `GodotArea3D::monitored_bodies`: counts since the last flush, in insertion order. */
  readonly monitored: Map<string, Pending>;
  /** `Area3D::body_map`. */
  readonly bodies: Map<object, BodyEntry>;
  locked: boolean;
  readonly bodyEntered: SignalHandle<[object]>;
  readonly bodyExited: SignalHandle<[object]>;
}

const AREA = new Map<object, AreaState>();
const ids = new WeakMap<object, number>();
let nextId = 0;

function idOf(entity: object): number {
  let id = ids.get(entity);
  if (id === undefined) {
    id = (nextId += 1);
    ids.set(entity, id);
  }
  return id;
}

function stateOf(object: object, member: string): AreaState {
  const state = AREA.get(godot_node_entity(object));
  if (state === undefined) throw new TypeError(`godot-compat: Area3D.${member} requires an Area3D.`);
  return state;
}

function overlap(a: Collider, b: Collider): boolean {
  return a.shape.intersectsShape(a.translation(), a.rotation(), b.shape, b.translation(), b.rotation());
}

/** `add_body_to_query` / `remove_body_from_query` (`godot_area_3d.cpp:195`). */
function count(area: AreaState, key: string, body: object, bodyShape: number, areaShape: number, by: number): void {
  const entry = area.monitored.get(key);
  if (entry === undefined) area.monitored.set(key, { body, bodyShape, areaShape, state: by });
  else entry.state += by;
}

/** The space step's area pairs (`GodotAreaPair3D::setup` and `pre_solve`, `godot_area_pair_3d.cpp:34`). */
function stepAreas(): void {
  const objects = godot_collision_objects();
  for (const [areaEntity, areaObject] of objects) {
    const area = AREA.get(areaEntity);
    if (area === undefined) continue;
    const seen = new Set<string>();
    for (const [bodyEntity, body] of objects) {
      if (body.kind === 'area') continue;
      body.colliders.forEach((bodyEntry, bodyShape) => {
        areaObject.colliders.forEach((areaEntry, areaShape) => {
          if (!bodyEntry.inBroadphase || !areaEntry.inBroadphase) return;
          if (bodyEntry.collider === undefined || areaEntry.collider === undefined) return;
          const key = `${String(idOf(bodyEntity))}|${String(bodyShape)}|${String(areaShape)}`;
          const touching = overlap(areaEntry.collider, bodyEntry.collider);
          const pair = area.colliding.get(key);
          // A pair is set up only for a moved area or an active body (`godot_step_3d.cpp:237`,
          // `:262`); a still static body is neither. A moved static body whose shape left the
          // area's breaks its pair, removing it if it was colliding.
          if (!areaObject.moved && !body.active) {
            if (pair !== undefined && body.moved && !touching) return;
            seen.add(key);
            return;
          }
          seen.add(key);
          const result = (areaObject.mask & body.layer) !== 0 && touching;
          if (result === (pair !== undefined)) return;
          if (result) area.colliding.set(key, { body: bodyEntity, bodyShape, areaShape, state: 1 });
          else area.colliding.delete(key);
          if (area.monitoring) count(area, key, bodyEntity, bodyShape, areaShape, result ? 1 : -1);
        });
      });
    }
    // A pair whose shape left the broad phase is destroyed; a colliding one is removed (`:94`).
    for (const [key, pair] of [...area.colliding]) {
      if (seen.has(key)) continue;
      area.colliding.delete(key);
      if (area.monitoring) count(area, key, pair.body, pair.bodyShape, pair.areaShape, -1);
    }
  }
}

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

/** `GodotArea3D::call_queries` (`godot_area_3d.cpp:235`), from `flush_queries`. */
function flushAreas(): void {
  for (const [entity, area] of [...AREA]) {
    // An area of a world since replaced is forgotten.
    if (godot_collision_object_state(entity) === undefined) {
      AREA.delete(entity);
      continue;
    }
    const pending = [...area.monitored.values()];
    area.monitored.clear();
    if (!area.monitoring) continue;
    for (const entry of pending) {
      if (entry.state === 0) continue;
      bodyInout(area, entry.state > 0, entry.body);
    }
  }
}


/**
 * Registers a node as an Area3D: monitoring and monitorable (`area_3d.cpp:818`).
 *
 * @godot Area3D (protocol)
 * @source scene/3d/physics/area_3d.cpp:818
 */
export function godot_area_3d_adopt(entity: object): void {
  godot_collision_object_adopt(entity, 'area');
  if (AREA.has(entity)) return;
  AREA.set(entity, {
    monitoring: true,
    monitorable: true,
    colliding: new Map(),
    monitored: new Map(),
    bodies: new Map(),
    locked: false,
    bodyEntered: createSignal<[object]>(),
    bodyExited: createSignal<[object]>(),
  });
  godot_world_3d_physics_callbacks(flushAreas, stepAreas);
}

/**
 * The area's `body_entered` or `body_exited` signal, whose argument is the body node.
 *
 * @godot Area3D (protocol)
 * @source scene/3d/physics/area_3d.cpp:265
 */
export function godot_area_3d_signal(self: object, name: 'body_entered' | 'body_exited'): GodotSignal<[object]> {
  const state = stateOf(self, name);
  return (name === 'body_entered' ? state.bodyEntered : state.bodyExited).signal;
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
  state.monitored.clear();
  state.colliding.clear();
  godot_collision_object_touch(self);
  if (enable) return;
  const bodies = [...state.bodies];
  state.bodies.clear();
  for (const [body, entry] of bodies) {
    for (const connection of entry.connections) connection.disconnect();
    if (entry.inTree) state.bodyExited.emit(godot_node_object(body));
  }
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
