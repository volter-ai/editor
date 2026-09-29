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
 * `mouse_exited` and `mouse_entered`. The shapes are tested directly, not through a physics space.
 */

import type { Object3D } from 'three';
import { get_global_transform_with_canvas, is_visible_in_tree } from './canvas-item';
import { godot_circle_shape_2d_has_point } from './circle-shape-2d';
import type { InputEventRecord } from './input-event';
import { godot_node_entity, godot_node_object, is_inside_tree } from './node';
import { godot_rectangle_shape_2d_has_point } from './rectangle-shape-2d';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { affine_inverse, op_multiply } from './transform-2d';
import type { Vector2 } from './vector2';

interface PickState {
  pickable: boolean;
  readonly signals: {
    readonly mouse_entered: SignalHandle<[]>;
    readonly mouse_exited: SignalHandle<[]>;
    readonly input_event: SignalHandle<[object, InputEventRecord, number]>;
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
export function godot_collision_object_2d_mount(entity: Object3D, pickable: boolean): void {
  OBJECTS.set(entity, {
    pickable,
    signals: { mouse_entered: createSignal<[]>(), mouse_exited: createSignal<[]>(), input_event: createSignal<[object, InputEventRecord, number]>() },
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
      if (godot_rectangle_shape_2d_has_point(record.shape, local) ?? godot_circle_shape_2d_has_point(record.shape, local) ?? false) return index;
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
  const under = new Map<Object3D, number>();
  for (const [object, state] of OBJECTS) {
    if (!state.pickable || !is_inside_tree(object)) continue;
    const shape = shapeUnder(object, event.position);
    if (shape >= 0) under.set(object, shape);
  }
  for (const [object, shape] of under) {
    const state = OBJECTS.get(object) as PickState;
    const script = godot_node_object(object) as { readonly _input_event?: (viewport: object, event: InputEventRecord, shape: number) => void };
    if (typeof script._input_event === 'function') script._input_event(viewport, event, shape);
    state.signals.input_event.emit(viewport, event, shape);
  }
  if (event.type !== 'mouse_motion') return;
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
