/**
 * @godot-class CharacterBody2D
 * @role BINDING
 *
 * Godot 4.7's `CharacterBody2D` (`scene/2d/physics/character_body_2d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): `move_and_slide` moves the body by its velocity over
 * the physics step, and at each collision (up to `max_slides`) slides along the contact, the
 * velocity into it removed; a contact's normal within `floor_max_angle` of `up_direction` is the
 * floor, within it of down the ceiling, else a wall. On the floor, the body snaps down by
 * `floor_snap_length` to stay on it. Moving platforms and the grounded motion mode's slope
 * constants are not bound.
 */

import type { ReactElement } from 'react';
import { Group, type Object3D } from 'three';
import { godot_collision_object_2d_mount, set_collision_layer, set_collision_mask } from './collision-object-2d';
import { godot_kinematic_collision_2d_new, type KinematicCollision2D } from './kinematic-collision-2d';
import { get_global_position, godot_node_2d_mount, godot_node_2d_props } from './node-2d';
import { get_physics_process_delta_time, godot_node_adopt, godot_node_entity } from './node';
import { godot_physics_body_2d_move } from './physics-body-2d';
import { type GodotElementProp, type GodotElementProps, useGodotElement } from './react-lifecycle';
import { construct as vector2, type Vector2 } from './vector2';

const CLASSES = ['CharacterBody2D', 'PhysicsBody2D', 'CollisionObject2D', 'Node2D', 'CanvasItem', 'Node', 'Object'];

interface CharacterState {
  velocity: Vector2;
  upDirection: Vector2;
  floorMaxAngle: number;
  floorSnapLength: number;
  maxSlides: number;
  onFloor: boolean;
  onWall: boolean;
  onCeiling: boolean;
  floorNormal: Vector2;
  wallNormal: Vector2;
  realVelocity: Vector2;
  positionDelta: Vector2;
  collisions: KinematicCollision2D[];
}

const CHARACTERS = new WeakMap<object, CharacterState>();

function stateOf(self: object, member: string): CharacterState {
  const state = CHARACTERS.get(godot_node_entity(self));
  if (state === undefined) throw new Error(`godot-compat: ${member} on an object that is not a CharacterBody2D`);
  return state;
}

/**
 * @godot CharacterBody2D (protocol)
 * @source scene/2d/physics/character_body_2d.cpp:700
 */
export function godot_character_body_2d_mount(entity: Object3D): void {
  CHARACTERS.set(entity, {
    velocity: vector2(),
    upDirection: vector2(0, -1),
    floorMaxAngle: (45 * Math.PI) / 180,
    floorSnapLength: 1,
    maxSlides: 4,
    onFloor: false,
    onWall: false,
    onCeiling: false,
    floorNormal: vector2(),
    wallNormal: vector2(),
    realVelocity: vector2(),
    positionDelta: vector2(),
    collisions: [],
  });
  godot_node_2d_mount(entity, CLASSES);
  godot_collision_object_2d_mount(entity, 'character', false);
}

/**
 * @godot CharacterBody2D.CharacterBody2D
 * @source scene/2d/physics/character_body_2d.cpp:700
 */
export function construct(): Group {
  const entity = new Group();
  godot_node_adopt(entity, { kind: 'node', classes: CLASSES });
  godot_character_body_2d_mount(entity);
  return entity;
}

function classify(state: CharacterState, normal: Vector2): void {
  const up = state.upDirection;
  const dot = normal.x * up.x + normal.y * up.y;
  const angle = Math.acos(Math.min(Math.max(dot, -1), 1));
  if (angle <= state.floorMaxAngle + 0.01) {
    state.onFloor = true;
    state.floorNormal = normal;
  } else if (Math.PI - angle <= state.floorMaxAngle + 0.01) state.onCeiling = true;
  else {
    state.onWall = true;
    state.wallNormal = normal;
  }
}

/**
 * Moves by the velocity over the physics step, sliding along what it hits (`move_and_slide`,
 * `character_body_2d.cpp:41`, `_move_and_slide_grounded`); whether it collided.
 *
 * @godot CharacterBody2D.move_and_slide
 * @source scene/2d/physics/character_body_2d.cpp:41
 */
export function move_and_slide(self: object): boolean {
  const entity = godot_node_entity(self) as Object3D;
  const state = stateOf(self, 'move_and_slide');
  const delta = get_physics_process_delta_time(entity);
  const start = get_global_position(entity);
  const wasOnFloor = state.onFloor;
  state.onFloor = false;
  state.onWall = false;
  state.onCeiling = false;
  state.collisions = [];
  let motion = vector2(state.velocity.x * delta, state.velocity.y * delta);
  let velocity = state.velocity;
  for (let slide = 0; slide < state.maxSlides; slide += 1) {
    const collision = godot_physics_body_2d_move(entity, motion);
    if (collision === null) break;
    state.collisions.push(collision);
    classify(state, collision.normal);
    const n = collision.normal;
    const into = velocity.x * n.x + velocity.y * n.y;
    if (into < 0) velocity = vector2(velocity.x - into * n.x, velocity.y - into * n.y);
    const left = collision.remainder;
    const along = left.x * n.x + left.y * n.y;
    motion = vector2(left.x - along * n.x, left.y - along * n.y);
    if (Math.hypot(motion.x, motion.y) < 1e-4) break;
  }
  // Snapping: on the floor last step and not moving away from it, stay on it.
  const up = state.upDirection;
  if (wasOnFloor && !state.onFloor && velocity.x * up.x + velocity.y * up.y <= 0 && state.floorSnapLength > 0) {
    const snap = godot_physics_body_2d_move(entity, vector2(-up.x * state.floorSnapLength, -up.y * state.floorSnapLength), true);
    if (snap !== null && Math.acos(Math.min(Math.max(snap.normal.x * up.x + snap.normal.y * up.y, -1), 1)) <= state.floorMaxAngle + 0.01) {
      godot_physics_body_2d_move(entity, snap.travel);
      state.onFloor = true;
      state.floorNormal = snap.normal;
    }
  }
  state.velocity = velocity;
  const end = get_global_position(entity);
  state.positionDelta = vector2(end.x - start.x, end.y - start.y);
  state.realVelocity = delta > 0 ? vector2(state.positionDelta.x / delta, state.positionDelta.y / delta) : vector2();
  return state.collisions.length > 0;
}

/**
 * @godot CharacterBody2D.set_velocity
 * @source scene/2d/physics/character_body_2d.cpp:590
 */
export function set_velocity(self: object, velocity: Vector2): void {
  stateOf(self, 'set_velocity').velocity = velocity;
}

/**
 * @godot CharacterBody2D.get_velocity
 * @source scene/2d/physics/character_body_2d.cpp:594
 */
export function get_velocity(self: object): Vector2 {
  return stateOf(self, 'get_velocity').velocity;
}

/**
 * @godot CharacterBody2D.is_on_floor
 * @source scene/2d/physics/character_body_2d.cpp:530
 */
export function is_on_floor(self: object): boolean {
  return stateOf(self, 'is_on_floor').onFloor;
}

/**
 * @godot CharacterBody2D.is_on_floor_only
 * @source scene/2d/physics/character_body_2d.cpp:534
 */
export function is_on_floor_only(self: object): boolean {
  const state = stateOf(self, 'is_on_floor_only');
  return state.onFloor && !state.onWall && !state.onCeiling;
}

/**
 * @godot CharacterBody2D.is_on_wall
 * @source scene/2d/physics/character_body_2d.cpp:538
 */
export function is_on_wall(self: object): boolean {
  return stateOf(self, 'is_on_wall').onWall;
}

/**
 * @godot CharacterBody2D.is_on_wall_only
 * @source scene/2d/physics/character_body_2d.cpp:542
 */
export function is_on_wall_only(self: object): boolean {
  const state = stateOf(self, 'is_on_wall_only');
  return state.onWall && !state.onFloor && !state.onCeiling;
}

/**
 * @godot CharacterBody2D.is_on_ceiling
 * @source scene/2d/physics/character_body_2d.cpp:546
 */
export function is_on_ceiling(self: object): boolean {
  return stateOf(self, 'is_on_ceiling').onCeiling;
}

/**
 * @godot CharacterBody2D.get_floor_normal
 * @source scene/2d/physics/character_body_2d.cpp:554
 */
export function get_floor_normal(self: object): Vector2 {
  return stateOf(self, 'get_floor_normal').floorNormal;
}

/**
 * @godot CharacterBody2D.get_wall_normal
 * @source scene/2d/physics/character_body_2d.cpp:558
 */
export function get_wall_normal(self: object): Vector2 {
  return stateOf(self, 'get_wall_normal').wallNormal;
}

/**
 * @godot CharacterBody2D.get_real_velocity
 * @source scene/2d/physics/character_body_2d.cpp:574
 */
export function get_real_velocity(self: object): Vector2 {
  return stateOf(self, 'get_real_velocity').realVelocity;
}

/**
 * @godot CharacterBody2D.get_position_delta
 * @source scene/2d/physics/character_body_2d.cpp:570
 */
export function get_position_delta(self: object): Vector2 {
  return stateOf(self, 'get_position_delta').positionDelta;
}

/**
 * @godot CharacterBody2D.get_slide_collision_count
 * @source scene/2d/physics/character_body_2d.cpp:602
 */
export function get_slide_collision_count(self: object): number {
  return stateOf(self, 'get_slide_collision_count').collisions.length;
}

/**
 * @godot CharacterBody2D.get_slide_collision
 * @source scene/2d/physics/character_body_2d.cpp:606
 */
export function get_slide_collision(self: object, slide_idx: number): KinematicCollision2D | null {
  return stateOf(self, 'get_slide_collision').collisions[slide_idx] ?? null;
}

/**
 * @godot CharacterBody2D.get_last_slide_collision
 * @source scene/2d/physics/character_body_2d.cpp:620
 */
export function get_last_slide_collision(self: object): KinematicCollision2D | null {
  return stateOf(self, 'get_last_slide_collision').collisions.at(-1) ?? null;
}

/**
 * @godot CharacterBody2D.set_up_direction
 * @source scene/2d/physics/character_body_2d.cpp:668
 */
export function set_up_direction(self: object, up: Vector2): void {
  const length = Math.hypot(up.x, up.y);
  if (length === 0) return;
  stateOf(self, 'set_up_direction').upDirection = vector2(up.x / length, up.y / length);
}

/**
 * @godot CharacterBody2D.get_up_direction
 * @source scene/2d/physics/character_body_2d.cpp:674
 */
export function get_up_direction(self: object): Vector2 {
  return stateOf(self, 'get_up_direction').upDirection;
}

/**
 * @godot CharacterBody2D.set_floor_max_angle
 * @source scene/2d/physics/character_body_2d.cpp:644
 */
export function set_floor_max_angle(self: object, radians: number): void {
  stateOf(self, 'set_floor_max_angle').floorMaxAngle = radians;
}

/**
 * @godot CharacterBody2D.set_floor_snap_length
 * @source scene/2d/physics/character_body_2d.cpp:652
 */
export function set_floor_snap_length(self: object, length: number): void {
  if (length >= 0) stateOf(self, 'set_floor_snap_length').floorSnapLength = length;
}

/**
 * @godot CharacterBody2D.set_max_slides
 * @source scene/2d/physics/character_body_2d.cpp:636
 */
export function set_max_slides(self: object, max: number): void {
  if (max >= 1) stateOf(self, 'set_max_slides').maxSlides = max;
}

const CHARACTER_BODY_2D = {
  create: () => new Group(),
  classes: CLASSES,
  spatial: false,
  mount: godot_character_body_2d_mount,
  props: new Map<string, GodotElementProp<Object3D>>([
    ...godot_node_2d_props(),
    ['collisionLayer', (entity, value: number) => set_collision_layer(entity, value)],
    ['collisionMask', (entity, value: number) => set_collision_mask(entity, value)],
    ['velocity', (entity, value: readonly [number, number]) => set_velocity(entity, vector2(...value))],
    ['upDirection', (entity, value: readonly [number, number]) => set_up_direction(entity, vector2(...value))],
    ['floorMaxAngle', (entity, value: number) => set_floor_max_angle(entity, value)],
    ['floorSnapLength', (entity, value: number) => set_floor_snap_length(entity, value)],
    ['maxSlides', (entity, value: number) => set_max_slides(entity, value)],
    ['motionMode', () => undefined],
    ['safeMargin', () => undefined],
  ]),
};

/**
 * A CharacterBody2D as a scene writes it: `<GodotCharacterBody2D collisionMask={2} />`.
 *
 * @godot CharacterBody2D (protocol)
 * @source scene/2d/physics/character_body_2d.cpp:700
 */
export function GodotCharacterBody2D(props: GodotElementProps<Group>): ReactElement {
  return useGodotElement(CHARACTER_BODY_2D, props);
}
