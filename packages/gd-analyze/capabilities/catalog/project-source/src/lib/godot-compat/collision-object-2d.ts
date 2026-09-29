/**
 * @godot-class CollisionObject2D
 * @role BINDING
 *
 * Godot 4.7's `CollisionObject2D` input picking (`scene/2d/physics/collision_object_2d.cpp`,
 * `Viewport::_process_picking`, `scene/main/viewport.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a mouse event no GUI or script handled is picked
 * against the pickable objects' shapes (their CollisionShape2D children), in viewport coordinates.
 * Each object under the pointer gets `_input_event(viewport, event, shape_idx)` and its
 * `input_event` signal; a mouse motion updates which objects the pointer is over, emitting
 * `mouse_exited` and `mouse_entered`, as does each frame at the pointer's last position. The shapes
 * are tested directly, not through a physics space.
 */

import type { Object3D } from 'three';
import { get_global_transform, get_global_transform_with_canvas, is_visible_in_tree } from './canvas-item';
import { godot_capsule_shape_2d_has_point, godot_capsule_shape_2d_outline } from './capsule-shape-2d';
import { godot_circle_shape_2d_has_point, godot_circle_shape_2d_outline } from './circle-shape-2d';
import type { InputEventRecord } from './input-event';
import { godot_node_entity, godot_node_object, is_inside_tree } from './node';
import { godot_rectangle_shape_2d_has_point, godot_rectangle_shape_2d_outline } from './rectangle-shape-2d';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { affine_inverse, op_multiply } from './transform-2d';
import type { Vector2 } from './vector2';

/** What a collision object is to the 2D physics: an area, or a body of a mode. */
export type GodotPhysics2DKind = 'area' | 'static' | 'rigid' | 'character' | 'kinematic';

interface PickState {
  readonly kind: GodotPhysics2DKind;
  pickable: boolean;
  layer: number;
  mask: number;
  /** An area's: whether it watches overlaps, and whether others see it. */
  monitoring: boolean;
  monitorable: boolean;
  /** The bodies and areas an area overlaps (as of its last step), and a body's contacts. */
  readonly overlaps: Set<Object3D>;
  readonly signals: {
    readonly mouse_entered: SignalHandle<[]>;
    readonly mouse_exited: SignalHandle<[]>;
    readonly input_event: SignalHandle<[object, InputEventRecord, number]>;
    readonly body_entered: SignalHandle<[object]>;
    readonly body_exited: SignalHandle<[object]>;
    readonly area_entered: SignalHandle<[object]>;
    readonly area_exited: SignalHandle<[object]>;
  };
}

const OBJECTS = new Map<Object3D, PickState>();
/** Each CollisionShape2D's shape resource and whether it is disabled. */
const SHAPES = new WeakMap<Object3D, { shape: object | null; disabled: boolean }>();
const HOVERED = new Set<Object3D>();

function stateOf(self: object, member: string): PickState {
  const state = OBJECTS.get(godot_node_entity(self) as Object3D);
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a CollisionObject2D`);
  return state;
}

/**
 * Makes `entity` a CollisionObject2D, pickable (`input_pickable`, true by default for an Area2D).
 *
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/collision_object_2d.cpp:622
 */
export function godot_collision_object_2d_mount(entity: Object3D, kind: GodotPhysics2DKind, pickable: boolean): void {
  OBJECTS.set(entity, {
    kind,
    pickable,
    layer: 1,
    mask: 1,
    monitoring: true,
    monitorable: true,
    overlaps: new Set(),
    signals: {
      mouse_entered: createSignal<[]>(),
      mouse_exited: createSignal<[]>(),
      input_event: createSignal<[object, InputEventRecord, number]>(),
      body_entered: createSignal<[object]>(),
      body_exited: createSignal<[object]>(),
      area_entered: createSignal<[object]>(),
      area_exited: createSignal<[object]>(),
    },
  });
}

/**
 * Makes `entity` a CollisionShape2D, its shape the one its parent object is picked by.
 *
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/collision_shape_2d.cpp:40
 */
export function godot_collision_object_2d_shape_mount(entity: Object3D): void {
  SHAPES.set(entity, { shape: null, disabled: false });
}

/**
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/collision_shape_2d.cpp:150
 */
export function godot_collision_object_2d_set_shape(entity: object, shape: object | null): void {
  const record = SHAPES.get(godot_node_entity(entity) as Object3D);
  if (record !== undefined) record.shape = shape;
}

/**
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/collision_shape_2d.cpp:180
 */
export function godot_collision_object_2d_shape_of(entity: object): object | null {
  return SHAPES.get(godot_node_entity(entity) as Object3D)?.shape ?? null;
}

/**
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/collision_shape_2d.cpp:195
 */
export function godot_collision_object_2d_set_disabled(entity: object, disabled: boolean): void {
  const record = SHAPES.get(godot_node_entity(entity) as Object3D);
  if (record !== undefined) record.disabled = disabled;
}

/** The index of the object's first shape under the point, or -1. */
function shapeUnder(object: Object3D, point: Vector2): number {
  let index = 0;
  for (const child of object.children) {
    const record = SHAPES.get(child);
    if (record === undefined) continue;
    if (!record.disabled && record.shape !== null && is_visible_in_tree(child) !== false) {
      const local = op_multiply(affine_inverse(get_global_transform_with_canvas(child)), point);
      if (godot_rectangle_shape_2d_has_point(record.shape, local) ?? godot_circle_shape_2d_has_point(record.shape, local) ?? godot_capsule_shape_2d_has_point(record.shape, local) ?? false) return index;
    }
    index += 1;
  }
  return -1;
}

/**
 * Picks a mouse event the viewport left unhandled (`Viewport::_process_picking`, `viewport.cpp:670`).
 *
 * @godot CollisionObject2D (protocol)
 * @source scene/main/viewport.cpp:670
 */
export function godot_collision_object_2d_pick(viewport: object, event: InputEventRecord): void {
  if (event.type !== 'mouse_button' && event.type !== 'mouse_motion') return;
  const under = objectsUnder(event.position);
  for (const [object, shape] of under) {
    const state = OBJECTS.get(object) as PickState;
    const script = godot_node_object(object) as { readonly _input_event?: (viewport: object, event: InputEventRecord, shape: number) => void };
    if (typeof script._input_event === 'function') script._input_event(viewport, event, shape);
    state.signals.input_event.emit(viewport, event, shape);
  }
  if (event.type !== 'mouse_motion') return;
  lastPoint = event.position;
  hover(under);
}

/** The pointer's last position in the viewport, once it has moved there. */
let lastPoint: Vector2 | undefined;

/** Which pickable objects are under the pointer at `point`, by their first shape there. */
function objectsUnder(point: Vector2): Map<Object3D, number> {
  const under = new Map<Object3D, number>();
  for (const [object, state] of OBJECTS) {
    if (!state.pickable || !is_inside_tree(object)) continue;
    const shape = shapeUnder(object, point);
    if (shape >= 0) under.set(object, shape);
  }
  return under;
}

/** `mouse_exited` for the objects the pointer left, then `mouse_entered` for those it is now over. */
function hover(under: ReadonlyMap<Object3D, number>): void {
  for (const object of [...HOVERED]) {
    if (under.has(object) && is_inside_tree(object)) continue;
    HOVERED.delete(object);
    OBJECTS.get(object)?.signals.mouse_exited.emit();
  }
  for (const object of under.keys()) {
    if (HOVERED.has(object)) continue;
    HOVERED.add(object);
    OBJECTS.get(object)?.signals.mouse_entered.emit();
  }
}

/**
 * Picks again at the pointer's last position once a frame, so an object moving under a still
 * pointer enters or leaves it (`_process_picking` with the last mouse position,
 * `viewport.cpp:683`).
 *
 * @godot CollisionObject2D (protocol)
 * @source scene/main/viewport.cpp:683
 */
export function godot_collision_object_2d_repick(): void {
  if (lastPoint === undefined || OBJECTS.size === 0) return;
  hover(objectsUnder(lastPoint));
}

/**
 * @godot CollisionObject2D.set_pickable
 * @source scene/2d/physics/collision_object_2d.cpp:333
 */
export function set_pickable(self: object, enabled: boolean): void {
  stateOf(self, 'set_pickable').pickable = enabled;
}

/**
 * @godot CollisionObject2D.is_pickable
 * @source scene/2d/physics/collision_object_2d.cpp:343
 */
export function is_pickable(self: object): boolean {
  return stateOf(self, 'is_pickable').pickable;
}

/**
 * @godot CollisionObject2D.mouse_entered
 * @source scene/2d/physics/collision_object_2d.cpp:631
 */
export function mouse_entered(self: object): GodotSignal<[]> {
  return stateOf(self, 'mouse_entered').signals.mouse_entered.signal;
}

/**
 * @godot CollisionObject2D.mouse_exited
 * @source scene/2d/physics/collision_object_2d.cpp:632
 */
export function mouse_exited(self: object): GodotSignal<[]> {
  return stateOf(self, 'mouse_exited').signals.mouse_exited.signal;
}

/**
 * @godot CollisionObject2D.input_event
 * @source scene/2d/physics/collision_object_2d.cpp:630
 */
export function input_event(self: object): GodotSignal<[object, InputEventRecord, number]> {
  return stateOf(self, 'input_event').signals.input_event.signal;
}

// --- The 2D physics: overlaps of the objects' shapes, as `GodotSpace2D` tests them.

/** A shape in global coordinates: a convex outline's points, rounded by a radius. */
interface Hull {
  readonly points: readonly (readonly [number, number])[];
  readonly radius: number;
}

/** Objects whose shapes their class gives in its own space (a TileMapLayer's tiles' polygons). */
const PROVIDED = new WeakMap<Object3D, () => readonly { readonly points: readonly (readonly [number, number])[]; readonly radius: number }[]>();

/**
 * Gives an object shapes of its class's own, in its local space, beside its CollisionShape2D
 * children (a TileMapLayer's tiles' collision polygons).
 *
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/tile_map_layer.cpp:760
 */
export function godot_collision_object_2d_shapes(entity: Object3D, provide: () => readonly { readonly points: readonly (readonly [number, number])[]; readonly radius: number }[]): void {
  PROVIDED.set(entity, provide);
}

/** The object's enabled shapes, each in global coordinates. */
function hullsOf(object: Object3D): Hull[] {
  const hulls: Hull[] = [];
  const provide = PROVIDED.get(object);
  if (provide !== undefined) {
    const t = get_global_transform(object);
    for (const outline of provide()) {
      hulls.push({ points: outline.points.map(([x, y]) => [t.x.x * x + t.y.x * y + t.origin.x, t.x.y * x + t.y.y * y + t.origin.y] as const), radius: outline.radius });
    }
  }
  for (const child of object.children) {
    const record = SHAPES.get(child);
    if (record === undefined || record.disabled || record.shape === null) continue;
    const outline = godot_rectangle_shape_2d_outline(record.shape) ?? godot_circle_shape_2d_outline(record.shape) ?? godot_capsule_shape_2d_outline(record.shape);
    if (outline === undefined) continue;
    const t = get_global_transform(child);
    const scale = (Math.hypot(t.x.x, t.x.y) + Math.hypot(t.y.x, t.y.y)) / 2;
    hulls.push({
      points: outline.points.map(([x, y]) => [t.x.x * x + t.y.x * y + t.origin.x, t.x.y * x + t.y.y * y + t.origin.y] as const),
      radius: outline.radius * scale,
    });
  }
  return hulls;
}

/**
 * The penetration of hull `a` into `b`, if they overlap: the least push along an axis that
 * separates them (separating axis test over both outlines' edge normals and their points' pairs),
 * `normal` pointing from `b` to `a`.
 */
function penetration(a: Hull, b: Hull): { readonly normal: readonly [number, number]; readonly depth: number } | undefined {
  const axes: (readonly [number, number])[] = [];
  const edges = (hull: Hull) => {
    const n = hull.points.length;
    if (n < 2) return;
    for (let i = 0; i < n; i += 1) {
      const [x0, y0] = hull.points[i] as readonly [number, number];
      const [x1, y1] = hull.points[(i + 1) % n] as readonly [number, number];
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (length > 0) axes.push([-(y1 - y0) / length, (x1 - x0) / length]);
    }
  };
  edges(a);
  edges(b);
  for (const [ax, ay] of a.points) {
    for (const [bx, by] of b.points) {
      const length = Math.hypot(ax - bx, ay - by);
      if (length > 1e-9) axes.push([(ax - bx) / length, (ay - by) / length]);
    }
  }
  if (axes.length === 0) axes.push([0, 1]);
  let best: { normal: readonly [number, number]; depth: number } | undefined;
  for (const [nx, ny] of axes) {
    const project = (hull: Hull): readonly [number, number] => {
      let low = Infinity;
      let high = -Infinity;
      for (const [x, y] of hull.points) {
        const d = x * nx + y * ny;
        low = Math.min(low, d);
        high = Math.max(high, d);
      }
      return [low - hull.radius, high + hull.radius];
    };
    const [aLow, aHigh] = project(a);
    const [bLow, bHigh] = project(b);
    const overlap = Math.min(aHigh - bLow, bHigh - aLow);
    if (overlap <= 0) return undefined;
    if (best === undefined || overlap < best.depth) {
      // Point the normal from b toward a.
      const centre = (hull: Hull) => hull.points.reduce((sum, [x, y]) => sum + x * nx + y * ny, 0) / hull.points.length;
      best = { normal: centre(a) >= centre(b) ? [nx, ny] : [-nx, -ny], depth: overlap };
    }
  }
  return best;
}

/** The deepest penetration of one object's shapes into another's. */
function objectPenetration(a: Object3D, b: Object3D): { readonly normal: readonly [number, number]; readonly depth: number } | undefined {
  let deepest: { normal: readonly [number, number]; depth: number } | undefined;
  for (const ha of hullsOf(a)) {
    for (const hb of hullsOf(b)) {
      const found = penetration(ha, hb);
      if (found !== undefined && (deepest === undefined || found.depth > deepest.depth)) deepest = found;
    }
  }
  return deepest;
}

function inside(object: Object3D): boolean {
  return is_inside_tree(object);
}

/**
 * The bodies an object collides with: those of the other kinds whose layer its mask meets.
 *
 * @godot CollisionObject2D (protocol)
 * @source servers/physics_2d/godot_space_2d.cpp:538
 */
export function godot_physics_2d_contacts(entity: Object3D): { readonly other: Object3D; readonly normal: readonly [number, number]; readonly depth: number }[] {
  const state = OBJECTS.get(entity);
  if (state === undefined) return [];
  const contacts: { readonly other: Object3D; readonly normal: readonly [number, number]; readonly depth: number }[] = [];
  for (const [other, otherState] of OBJECTS) {
    if (other === entity || otherState.kind === 'area' || (state.mask & otherState.layer) === 0 || !inside(other)) continue;
    const found = objectPenetration(entity, other);
    if (found !== undefined) contacts.push({ other, ...found });
  }
  return contacts;
}

/**
 * One physics step of an area (`GodotArea2D::call_queries`, `godot_area_2d.cpp:236`): the bodies
 * and monitorable areas its mask meets that overlap it now, `*_entered` for the new and
 * `*_exited` for the gone.
 *
 * @godot Area2D (protocol)
 * @source servers/physics_2d/godot_area_2d.cpp:236
 */
export function godot_physics_2d_area_step(entity: Object3D): void {
  const state = OBJECTS.get(entity);
  if (state === undefined) return;
  const now = new Set<Object3D>();
  if (state.monitoring && inside(entity)) {
    for (const [other, otherState] of OBJECTS) {
      if (other === entity || (state.mask & otherState.layer) === 0 || !inside(other)) continue;
      if (otherState.kind === 'area' && !otherState.monitorable) continue;
      if (objectPenetration(entity, other) !== undefined) now.add(other);
    }
  }
  for (const other of [...state.overlaps]) {
    if (now.has(other)) continue;
    state.overlaps.delete(other);
    const signal = OBJECTS.get(other)?.kind === 'area' ? state.signals.area_exited : state.signals.body_exited;
    signal.emit(godot_node_object(other));
  }
  for (const other of now) {
    if (state.overlaps.has(other)) continue;
    state.overlaps.add(other);
    const signal = OBJECTS.get(other)?.kind === 'area' ? state.signals.area_entered : state.signals.body_entered;
    signal.emit(godot_node_object(other));
  }
}

/**
 * The objects an area overlaps, of one kind (`get_overlapping_bodies`, `get_overlapping_areas`).
 *
 * @godot Area2D (protocol)
 * @source scene/2d/physics/area_2d.cpp:420
 */
export function godot_physics_2d_overlapping(entity: object, areas: boolean): object[] {
  const state = stateOf(entity, 'get_overlapping');
  return [...state.overlaps].filter((other) => (OBJECTS.get(other)?.kind === 'area') === areas && inside(other)).map((other) => godot_node_object(other));
}

/**
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/collision_object_2d.cpp:212
 */
export function godot_physics_2d_kind(entity: object): GodotPhysics2DKind | undefined {
  return OBJECTS.get(godot_node_entity(entity) as Object3D)?.kind;
}

/**
 * @godot CollisionObject2D.set_collision_layer
 * @source scene/2d/physics/collision_object_2d.cpp:150
 */
export function set_collision_layer(self: object, layer: number): void {
  stateOf(self, 'set_collision_layer').layer = layer >>> 0;
}

/**
 * @godot CollisionObject2D.get_collision_layer
 * @source scene/2d/physics/collision_object_2d.cpp:160
 */
export function get_collision_layer(self: object): number {
  return stateOf(self, 'get_collision_layer').layer;
}

/**
 * @godot CollisionObject2D.set_collision_mask
 * @source scene/2d/physics/collision_object_2d.cpp:164
 */
export function set_collision_mask(self: object, mask: number): void {
  stateOf(self, 'set_collision_mask').mask = mask >>> 0;
}

/**
 * @godot CollisionObject2D.get_collision_mask
 * @source scene/2d/physics/collision_object_2d.cpp:174
 */
export function get_collision_mask(self: object): number {
  return stateOf(self, 'get_collision_mask').mask;
}

/**
 * @godot CollisionObject2D.set_collision_layer_value
 * @source scene/2d/physics/collision_object_2d.cpp:178
 */
export function set_collision_layer_value(self: object, layer_number: number, value: boolean): void {
  const state = stateOf(self, 'set_collision_layer_value');
  const bit = 1 << (layer_number - 1);
  state.layer = (value ? state.layer | bit : state.layer & ~bit) >>> 0;
}

/**
 * @godot CollisionObject2D.get_collision_layer_value
 * @source scene/2d/physics/collision_object_2d.cpp:190
 */
export function get_collision_layer_value(self: object, layer_number: number): boolean {
  return (stateOf(self, 'get_collision_layer_value').layer & (1 << (layer_number - 1))) !== 0;
}

/**
 * @godot CollisionObject2D.set_collision_mask_value
 * @source scene/2d/physics/collision_object_2d.cpp:196
 */
export function set_collision_mask_value(self: object, layer_number: number, value: boolean): void {
  const state = stateOf(self, 'set_collision_mask_value');
  const bit = 1 << (layer_number - 1);
  state.mask = (value ? state.mask | bit : state.mask & ~bit) >>> 0;
}

/**
 * @godot CollisionObject2D.get_collision_mask_value
 * @source scene/2d/physics/collision_object_2d.cpp:208
 */
export function get_collision_mask_value(self: object, layer_number: number): boolean {
  return (stateOf(self, 'get_collision_mask_value').mask & (1 << (layer_number - 1))) !== 0;
}

/**
 * An area's monitoring (`Area2D::set_monitoring`); off, it leaves what it overlapped.
 *
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/area_2d.cpp:376
 */
export function godot_physics_2d_set_monitoring(self: object, enable: boolean): void {
  stateOf(self, 'set_monitoring').monitoring = enable;
}

/**
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/area_2d.cpp:386
 */
export function godot_physics_2d_monitoring(self: object): boolean {
  return stateOf(self, 'is_monitoring').monitoring;
}

/**
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/area_2d.cpp:398
 */
export function godot_physics_2d_set_monitorable(self: object, enable: boolean): void {
  stateOf(self, 'set_monitorable').monitorable = enable;
}

/**
 * An area's or a body's overlap signal (`body_entered`, `area_exited`, …).
 *
 * @godot CollisionObject2D (protocol)
 * @source scene/2d/physics/area_2d.cpp:590
 */
export function godot_physics_2d_signal(self: object, name: 'body_entered' | 'body_exited' | 'area_entered' | 'area_exited'): GodotSignal<[object]> {
  return stateOf(self, name).signals[name].signal;
}
