/**
 * @godot-class CollisionObject3D
 * @role BINDING
 *
 * Godot 4.7's `CollisionObject3D` (`scene/3d/physics/collision_object_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto Rapier: each collision object inside the
 * tree is one Rapier rigid body in the world `world-3d.ts` holds, and each enabled
 * `CollisionShape3D` child with a shape is one collider on it, placed at the child's local
 * transform. The body kind is the node class's: fixed for a StaticBody3D, kinematic for a
 * CharacterBody3D, dynamic for a RigidBody3D, fixed with sensor colliders for an Area3D.
 *
 * Godot's 32-bit collision layer and mask, which Rapier's 16-bit groups cannot hold, live in
 * `OBJECT` with the body and colliders, keyed by the node's entity; queries and contacts filter
 * through them. The RID of a collision object is represented by its entity. Scale in a body's
 * global transform is not transcribed (Rapier bodies are rigid).
 */

import RAPIER, { type Collider, type RigidBody, type World } from '@dimforge/rapier3d-compat';
import type { Object3D } from 'three';
import { godot_collision_shape_3d_of } from './collision-shape-3d';
import { godot_node_entity, godot_node_is_freed, godot_node_object, is_inside_tree } from './node';
import { get_global_transform, get_transform } from './node-3d';
import { godot_shape_3d_collider } from './shape-3d';
import { affine_inverse, construct as transform3d, type Transform3D } from './transform-3d';

export type CollisionObjectKind = 'static' | 'character' | 'rigid' | 'area';

/** One shape of a collision object: its Rapier collider and Godot's shape and local transform. */
export interface CollisionShapeEntry {
  readonly collider: Collider;
  readonly key: string;
  readonly shapeNode: object;
  readonly shape: object;
  /** The shape's transform in the body, and its `affine_inverse` (`godot_collision_object_3d.cpp:66`). */
  readonly local: Transform3D;
  readonly localInverse: Transform3D;
}

interface ObjectState {
  readonly kind: CollisionObjectKind;
  layer: number;
  mask: number;
  body: RigidBody | undefined;
  colliders: CollisionShapeEntry[];
  /** The body's transform on the physics server, and its inverse. */
  transform: Transform3D;
  inverse: Transform3D;
  /** A kinematic body's transform set since the last step, applied when the space steps. */
  pending: Transform3D | undefined;
  readonly exceptions: Set<object>;
}

const OBJECT = new Map<object, ObjectState>();
const ENTITY_OF_COLLIDER = new Map<number, object>();

function stateOf(object: object, member: string): ObjectState {
  const state = OBJECT.get(godot_node_entity(object));
  if (state === undefined) throw new TypeError(`godot-compat: CollisionObject3D.${member} requires a collision object.`);
  return state;
}

/**
 * Registers a node as a collision object of the given kind (its class's constructor gives it a
 * physics server body, `scene/3d/physics/collision_object_3d.cpp:718`).
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:718
 */
export function godot_collision_object_adopt(entity: object, kind: CollisionObjectKind): void {
  if (OBJECT.has(entity)) return;
  OBJECT.set(entity, {
    kind,
    layer: 1,
    mask: 1,
    body: undefined,
    colliders: [],
    transform: transform3d(),
    inverse: transform3d(),
    pending: undefined,
    exceptions: new Set(),
  });
}

/**
 * Forgets every collision object and its Rapier body: a new world starts empty.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:718
 */
export function godot_collision_objects_reset(): void {
  OBJECT.clear();
  ENTITY_OF_COLLIDER.clear();
}

/**
 * The collision object's kind, Rapier body, and layer/mask, for the physics modules.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.h:177
 */
export function godot_collision_object_state(entity: object):
  | {
      readonly kind: CollisionObjectKind;
      readonly body: RigidBody | undefined;
      readonly layer: number;
      readonly mask: number;
      readonly exceptions: ReadonlySet<object>;
      readonly colliders: readonly CollisionShapeEntry[];
      readonly transform: Transform3D;
      readonly inverse: Transform3D;
    }
  | undefined {
  return OBJECT.get(godot_node_entity(entity));
}

/**
 * The collision object (entity) a Rapier collider belongs to.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.h:177
 */
export function godot_collision_object_of_collider(collider: Collider): object | undefined {
  return ENTITY_OF_COLLIDER.get(collider.handle);
}

/**
 * Every registered collision object inside the tree, with its state.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:96
 */
export function godot_collision_objects(): readonly (readonly [object, ReturnType<typeof godot_collision_object_state> & object])[] {
  return [...OBJECT.entries()].filter(([entity, state]) => state.body !== undefined && is_inside_tree(entity));
}

/** Godot's `Basis::get_quaternion` of an orthonormal basis, as Rapier's rotation. */
function rotationOf(transform: Transform3D): { x: number; y: number; z: number; w: number } {
  const b = transform.basis;
  const m00 = b.x.x;
  const m11 = b.y.y;
  const m22 = b.z.z;
  const trace = m00 + m11 + m22;
  // rows[i][j] is column j's component i.
  const r = (i: number, j: number): number => {
    const column = j === 0 ? b.x : j === 1 ? b.y : b.z;
    return i === 0 ? column.x : i === 1 ? column.y : column.z;
  };
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return { w: 0.25 * s, x: (r(2, 1) - r(1, 2)) / s, y: (r(0, 2) - r(2, 0)) / s, z: (r(1, 0) - r(0, 1)) / s };
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return { w: (r(2, 1) - r(1, 2)) / s, x: 0.25 * s, y: (r(0, 1) + r(1, 0)) / s, z: (r(0, 2) + r(2, 0)) / s };
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return { w: (r(0, 2) - r(2, 0)) / s, x: (r(0, 1) + r(1, 0)) / s, y: 0.25 * s, z: (r(1, 2) + r(2, 1)) / s };
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return { w: (r(1, 0) - r(0, 1)) / s, x: (r(0, 2) + r(2, 0)) / s, y: (r(1, 2) + r(2, 1)) / s, z: 0.25 * s };
}

function bodyDesc(kind: CollisionObjectKind): RAPIER.RigidBodyDesc {
  if (kind === 'rigid') return RAPIER.RigidBodyDesc.dynamic();
  if (kind === 'character') return RAPIER.RigidBodyDesc.kinematicPositionBased();
  return RAPIER.RigidBodyDesc.fixed();
}

function removeBody(world: World, state: ObjectState): void {
  for (const entry of state.colliders) ENTITY_OF_COLLIDER.delete(entry.collider.handle);
  state.colliders = [];
  if (state.body !== undefined) world.removeRigidBody(state.body);
  state.body = undefined;
}

/**
 * Places a body at its node's global transform (`NOTIFICATION_TRANSFORM_CHANGED` sends it to the
 * physics server, `scene/3d/physics/collision_object_3d.cpp:96`).
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:96
 */
export function godot_collision_object_place(entity: object, global: Transform3D = get_global_transform(entity as Object3D)): void {
  const state = OBJECT.get(entity);
  if (state?.body === undefined) return;
  state.transform = global;
  state.inverse = affine_inverse(global);
  state.body.setTranslation({ x: global.origin.x, y: global.origin.y, z: global.origin.z }, false);
  state.body.setRotation(rotationOf(global), false);
}

/**
 * Brings the Rapier world up to the tree: bodies for collision objects inside the tree, removed
 * for those out of it, poses from the nodes (a dynamic body keeps the pose the solver gives it),
 * and one collider per enabled shape child, rebuilt when its shape or local transform changes.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:96
 */
export function godot_collision_objects_sync(world: World): void {
  for (const [entity, state] of OBJECT) {
    if (godot_node_is_freed(entity) || !is_inside_tree(entity)) {
      removeBody(world, state);
      if (godot_node_is_freed(entity)) OBJECT.delete(entity);
      continue;
    }
    if (state.body === undefined) {
      // Entering the world sends the transform at once (`_notification`, ENTER_WORLD).
      state.body = world.createRigidBody(bodyDesc(state.kind));
      godot_collision_object_place(entity);
    }
    const wanted: { shapeNode: object; shape: object; local: Transform3D; key: string; desc: RAPIER.ColliderDesc }[] = [];
    for (const child of (entity as Object3D).children) {
      const shapeState = godot_collision_shape_3d_of(child);
      if (shapeState === undefined || shapeState.disabled || shapeState.shape === null) continue;
      const described = godot_shape_3d_collider(shapeState.shape);
      if (described.desc === null) continue;
      const local = get_transform(child);
      const rotation = rotationOf(local);
      described.desc
        .setTranslation(local.origin.x, local.origin.y, local.origin.z)
        .setRotation(rotation)
        .setSensor(state.kind === 'area');
      wanted.push({ shapeNode: child, shape: shapeState.shape, local, key: `${described.key}|${JSON.stringify(local)}|${state.kind}`, desc: described.desc });
    }
    const same =
      wanted.length === state.colliders.length &&
      wanted.every((entry, index) => state.colliders[index]?.key === entry.key && state.colliders[index]?.shapeNode === entry.shapeNode);
    if (!same) {
      for (const entry of state.colliders) {
        ENTITY_OF_COLLIDER.delete(entry.collider.handle);
        world.removeCollider(entry.collider, false);
      }
      state.colliders = wanted.map((entry) => {
        const collider = world.createCollider(entry.desc, state.body);
        ENTITY_OF_COLLIDER.set(collider.handle, entity);
        return {
          collider,
          key: entry.key,
          shapeNode: entry.shapeNode,
          shape: entry.shape,
          local: entry.local,
          localInverse: affine_inverse(entry.local),
        };
      });
    }
  }
  world.propagateModifiedBodyPositionsToColliders();
  world.updateSceneQueries();
}

/**
 * A moved collision object's deferred `NOTIFICATION_TRANSFORM_CHANGED` sends its global transform
 * to the server (`scene/3d/physics/collision_object_3d.cpp:96`): a static body or area takes it at
 * once; a kinematic body holds it until the space steps (`GodotBody3D::set_state`,
 * `modules/godot_physics_3d/godot_body_3d.cpp:352`).
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:96
 */
export function godot_collision_objects_transforms_changed(): void {
  for (const [entity, state] of OBJECT) {
    if (state.body === undefined || godot_node_is_freed(entity) || !is_inside_tree(entity)) continue;
    if (state.kind === 'static' || state.kind === 'area') godot_collision_object_place(entity);
    else if (state.kind === 'character') state.pending = get_global_transform(entity as Object3D);
  }
}

/**
 * A kinematic body's held transform becomes its transform as the space steps
 * (`GodotBody3D::integrate_forces`, `modules/godot_physics_3d/godot_body_3d.cpp:701`).
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_body_3d.cpp:701
 */
export function godot_collision_objects_integrate_kinematic(): void {
  for (const [entity, state] of OBJECT) {
    if (state.pending === undefined) continue;
    godot_collision_object_place(entity, state.pending);
    state.pending = undefined;
  }
}

/**
 * The value is truncated to 32 bits, as the `uint32_t` parameter holds it.
 *
 * @godot CollisionObject3D.set_collision_layer
 * @source scene/3d/physics/collision_object_3d.cpp:145
 */
export function set_collision_layer(self: object, layer: number): void {
  stateOf(self, 'set_collision_layer').layer = layer >>> 0;
}

/**
 * @godot CollisionObject3D.get_collision_layer
 * @source scene/3d/physics/collision_object_3d.cpp:154
 */
export function get_collision_layer(self: object): number {
  return stateOf(self, 'get_collision_layer').layer;
}

/**
 * @godot CollisionObject3D.set_collision_mask
 * @source scene/3d/physics/collision_object_3d.cpp:158
 */
export function set_collision_mask(self: object, mask: number): void {
  stateOf(self, 'set_collision_mask').mask = mask >>> 0;
}

/**
 * @godot CollisionObject3D.get_collision_mask
 * @source scene/3d/physics/collision_object_3d.cpp:167
 */
export function get_collision_mask(self: object): number {
  return stateOf(self, 'get_collision_mask').mask;
}

/**
 * Layer numbers outside 1..32 fail.
 *
 * @godot CollisionObject3D.set_collision_layer_value
 * @source scene/3d/physics/collision_object_3d.cpp:171
 */
export function set_collision_layer_value(self: object, layer_number: number, value: boolean): void {
  if (layer_number < 1 || layer_number > 32) return;
  const state = stateOf(self, 'set_collision_layer_value');
  const bit = (1 << (layer_number - 1)) >>> 0;
  state.layer = (value ? state.layer | bit : state.layer & ~bit) >>> 0;
}

/**
 * @godot CollisionObject3D.get_collision_layer_value
 * @source scene/3d/physics/collision_object_3d.cpp:183
 */
export function get_collision_layer_value(self: object, layer_number: number): boolean {
  if (layer_number < 1 || layer_number > 32) return false;
  return (stateOf(self, 'get_collision_layer_value').layer & (1 << (layer_number - 1))) !== 0;
}

/**
 * Layer numbers outside 1..32 fail.
 *
 * @godot CollisionObject3D.set_collision_mask_value
 * @source scene/3d/physics/collision_object_3d.cpp:189
 */
export function set_collision_mask_value(self: object, layer_number: number, value: boolean): void {
  if (layer_number < 1 || layer_number > 32) return;
  const state = stateOf(self, 'set_collision_mask_value');
  const bit = (1 << (layer_number - 1)) >>> 0;
  state.mask = (value ? state.mask | bit : state.mask & ~bit) >>> 0;
}

/**
 * @godot CollisionObject3D.get_collision_mask_value
 * @source scene/3d/physics/collision_object_3d.cpp:201
 */
export function get_collision_mask_value(self: object, layer_number: number): boolean {
  if (layer_number < 1 || layer_number > 32) return false;
  return (stateOf(self, 'get_collision_mask_value').mask & (1 << (layer_number - 1))) !== 0;
}

/**
 * The object's RID: its entity.
 *
 * @godot CollisionObject3D.get_rid
 * @source scene/3d/physics/collision_object_3d.h:177
 */
export function get_rid(self: object): object {
  stateOf(self, 'get_rid');
  return godot_node_entity(self);
}

/**
 * The Godot object a RID names.
 *
 * @godot CollisionObject3D (protocol)
 * @source core/object/object.h:813
 */
export function godot_collision_object_object(rid: object): object {
  return godot_node_object(rid);
}
