/**
 * @godot-class RayCast3D
 * @role BINDING
 *
 * Godot 4.7's `RayCast3D` (`scene/3d/physics/ray_cast_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node3D (an Object3D) whose internal physics
 * processing casts `intersect_ray` from its global origin to its global transform of
 * `target_position`, before its script's `_physics_process`. Its parameters and last result live in
 * `RAY`, keyed by the entity. Three has no ray node, so a scene declares one as the
 * `<GodotRayCast3D>` element, a group with the ray's settings as props.
 */

import type { ThreeElements } from '@react-three/fiber';
import { createElement, type Ref, useLayoutEffect, useRef } from 'react';
import type { Group, Object3D } from 'three';
import { godot_collision_object_state } from './collision-object-3d';
import { godot_node_class_reader, godot_node_entity, godot_node_set_internal_physics, is_inside_tree } from './node';
import { get_global_transform } from './node-3d';
import { intersect_ray } from './physics-direct-space-state-3d';
import { godot_ray_query_new } from './physics-ray-query-parameters-3d';
import { op_multiply as transform } from './transform-3d';
import { construct as vector3, type Vector3 } from './vector3';
import { godot_world_3d, godot_world_3d_direct_state } from './world-3d';

interface RayState {
  enabled: boolean;
  target: Vector3;
  mask: number;
  excludeParent: boolean;
  exceptions: Set<object>;
  collideWithAreas: boolean;
  collideWithBodies: boolean;
  hitFromInside: boolean;
  hitBackFaces: boolean;
  collided: boolean;
  against: object | null;
  againstRid: object | null;
  shape: number;
  point: Vector3;
  normal: Vector3;
  face: number;
}

const RAY = new WeakMap<object, RayState>();
const RAY_CAST_3D = Object.freeze(['RayCast3D', 'Node3D', 'Node', 'Object']);
godot_node_class_reader((entity) => (RAY.has(entity) ? RAY_CAST_3D : undefined));

function stateOf(object: object): RayState {
  const entity = godot_node_entity(object);
  const state = RAY.get(entity);
  if (state === undefined) throw new TypeError('godot-compat: RayCast3D members require a RayCast3D.');
  return state;
}

function update(entity: object, state: RayState): void {
  const global = get_global_transform(entity as Object3D);
  const to = state.target.x === 0 && state.target.y === 0 && state.target.z === 0 ? vector3(0, 0.01, 0) : state.target;
  const query = godot_ray_query_new();
  query.from = global.origin;
  query.to = transform(global, to);
  const exclude = new Set(state.exceptions);
  const parent = (entity as Object3D).parent;
  if (state.excludeParent && parent !== null && godot_collision_object_state(parent) !== undefined) exclude.add(parent);
  query.exclude = [...exclude];
  query.collision_mask = state.mask;
  query.collide_with_bodies = state.collideWithBodies;
  query.collide_with_areas = state.collideWithAreas;
  query.hit_from_inside = state.hitFromInside;
  query.hit_back_faces = state.hitBackFaces;
  const hit = intersect_ray(godot_world_3d_direct_state(godot_world_3d().space), query);
  if (hit.size > 0) {
    state.collided = true;
    state.against = hit.get('collider') as object;
    state.againstRid = hit.get('rid') as object;
    state.point = hit.get('position') as Vector3;
    state.normal = hit.get('normal') as Vector3;
    state.face = hit.get('face_index') as number;
    state.shape = hit.get('shape') as number;
  } else {
    state.collided = false;
    state.against = null;
    state.againstRid = null;
    state.shape = 0;
  }
}

/**
 * Registers a node as a RayCast3D with Godot's defaults (`scene/3d/physics/ray_cast_3d.h:42`):
 * enabled, target (0, -1, 0), mask 1, excluding its parent body, bodies only, back faces hit.
 *
 * @godot RayCast3D (protocol)
 * @source scene/3d/physics/ray_cast_3d.h:42
 */
export function godot_ray_cast_3d_adopt(entity: object): void {
  const state: RayState = {
    enabled: true,
    target: vector3(0, -1, 0),
    mask: 1,
    excludeParent: true,
    exceptions: new Set(),
    collideWithAreas: false,
    collideWithBodies: true,
    hitFromInside: false,
    hitBackFaces: true,
    collided: false,
    against: null,
    againstRid: null,
    shape: 0,
    point: vector3(),
    normal: vector3(),
    face: -1,
  };
  RAY.set(entity, state);
  godot_node_set_internal_physics(entity, () => {
    if (state.enabled) update(entity, state);
  });
}

/**
 * @godot RayCast3D.is_colliding
 * @source scene/3d/physics/ray_cast_3d.cpp:83
 */
export function is_colliding(self: object): boolean {
  return stateOf(self).collided;
}

/**
 * @godot RayCast3D.get_collider
 * @source scene/3d/physics/ray_cast_3d.cpp:87
 */
export function get_collider(self: object): object | null {
  return stateOf(self).against;
}

/**
 * @godot RayCast3D.get_collider_shape
 * @source scene/3d/physics/ray_cast_3d.cpp:99
 */
export function get_collider_shape(self: object): number {
  return stateOf(self).shape;
}

/**
 * @godot RayCast3D.get_collision_point
 * @source scene/3d/physics/ray_cast_3d.cpp:103
 */
export function get_collision_point(self: object): Vector3 {
  return stateOf(self).point;
}

/**
 * @godot RayCast3D.get_collision_normal
 * @source scene/3d/physics/ray_cast_3d.cpp:107
 */
export function get_collision_normal(self: object): Vector3 {
  return stateOf(self).normal;
}

/**
 * @godot RayCast3D.set_target_position
 * @source scene/3d/physics/ray_cast_3d.cpp:40
 */
export function set_target_position(self: object, point: Vector3): void {
  stateOf(self).target = vector3(point);
}

/**
 * @godot RayCast3D.get_target_position
 * @source scene/3d/physics/ray_cast_3d.cpp:53
 */
export function get_target_position(self: object): Vector3 {
  return stateOf(self).target;
}

/**
 * @godot RayCast3D.set_collision_mask
 * @source scene/3d/physics/ray_cast_3d.cpp:57
 */
export function set_collision_mask(self: object, mask: number): void {
  stateOf(self).mask = mask >>> 0;
}

/**
 * @godot RayCast3D.get_collision_mask
 * @source scene/3d/physics/ray_cast_3d.cpp:61
 */
export function get_collision_mask(self: object): number {
  return stateOf(self).mask;
}

/**
 * Disabling clears the collision.
 *
 * @godot RayCast3D.set_enabled
 * @source scene/3d/physics/ray_cast_3d.cpp:115
 */
export function set_enabled(self: object, enabled: boolean): void {
  const state = stateOf(self);
  state.enabled = enabled;
  if (!enabled) state.collided = false;
}

/**
 * @godot RayCast3D.set_collide_with_areas
 * @source scene/3d/physics/ray_cast_3d.cpp:297
 */
export function set_collide_with_areas(self: object, enabled: boolean): void {
  stateOf(self).collideWithAreas = enabled;
}

/**
 * @godot RayCast3D.set_exclude_parent_body
 * @source scene/3d/physics/ray_cast_3d.cpp:139
 */
export function set_exclude_parent_body(self: object, exclude: boolean): void {
  stateOf(self).excludeParent = exclude;
}

/**
 * @godot RayCast3D.add_exception
 * @source scene/3d/physics/ray_cast_3d.cpp:272
 */
export function add_exception(self: object, node: object): void {
  stateOf(self).exceptions.add(godot_node_entity(node));
}

/**
 * Casts now, inside or outside the physics step.
 *
 * @godot RayCast3D.force_raycast_update
 * @source scene/3d/physics/ray_cast_3d.cpp:264
 */
export function force_raycast_update(self: object): void {
  const entity = godot_node_entity(self);
  if (is_inside_tree(entity)) update(entity, stateOf(entity));
}

/** A `<GodotRayCast3D>`'s props: a group's, and the ray's settings by their Godot names in camelCase. */
export type GodotRayCast3DProps = Omit<ThreeElements['group'], 'ref'> & {
  readonly ref?: Ref<Group>;
  readonly enabled?: boolean;
  readonly targetPosition?: readonly [number, number, number];
  readonly collisionMask?: number;
  readonly excludeParent?: boolean;
  readonly collideWithAreas?: boolean;
  readonly collideWithBodies?: boolean;
  readonly hitFromInside?: boolean;
  readonly hitBackFaces?: boolean;
};

/**
 * A RayCast3D as a scene declares it: a group registered as the ray, its settings the element's.
 *
 * @godot RayCast3D (protocol)
 * @source scene/3d/physics/ray_cast_3d.cpp:564
 */
export function GodotRayCast3D({
  ref,
  enabled,
  targetPosition,
  collisionMask,
  excludeParent,
  collideWithAreas,
  collideWithBodies,
  hitFromInside,
  hitBackFaces,
  ...group
}: GodotRayCast3DProps) {
  const own = useRef<Group>(null);
  useLayoutEffect(() => {
    const entity = own.current as Group;
    if (!RAY.has(entity)) godot_ray_cast_3d_adopt(entity);
    const state = RAY.get(entity) as RayState;
    if (enabled !== undefined) set_enabled(entity, enabled);
    if (targetPosition !== undefined) set_target_position(entity, vector3(...targetPosition));
    if (collisionMask !== undefined) set_collision_mask(entity, collisionMask);
    if (excludeParent !== undefined) set_exclude_parent_body(entity, excludeParent);
    if (collideWithAreas !== undefined) set_collide_with_areas(entity, collideWithAreas);
    if (collideWithBodies !== undefined) state.collideWithBodies = collideWithBodies;
    if (hitFromInside !== undefined) state.hitFromInside = hitFromInside;
    if (hitBackFaces !== undefined) state.hitBackFaces = hitBackFaces;
  }, []);
  const refs = (value: Group | null) => {
    own.current = value;
    if (typeof ref === 'function') ref(value);
    else if (ref !== undefined && ref !== null) (ref as { current: Group | null }).current = value;
  };
  return createElement('group', { ...group, ref: refs });
}
