/**
 * @godot-class CollisionObject3D
 * @role BINDING
 *
 * Godot 4.7's `CollisionObject3D` (`scene/3d/physics/collision_object_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as @react-three/rapier's bodies. Each `<RigidBody>`
 * a scene declares is a collision object: its three object is the node, its Rapier body and
 * colliders are read from the `<Physics>` context the world hands compat
 * (`godot_physics_attach`), when a member asks. Nothing is listed, synced or stepped here: Rapier
 * owns the bodies and steps them. The body's kind is its Rapier type: fixed (a StaticBody3D, or an
 * Area3D when its colliders are sensors), kinematic (a CharacterBody3D), dynamic (a RigidBody3D).
 *
 * Collision layers and masks keep Godot's 32 bits per node; their low 16 bits are the colliders'
 * Rapier collision groups (membership, filter). A bit above 16 is kept and read back but does not
 * filter contacts (Rapier's groups are 16 bits: a named limit).
 */

import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import RAPIER from '@dimforge/rapier3d-compat';
import { type Object3D, Quaternion, Vector3 as ThreeVector3 } from 'three';
import { godot_node_entity } from './node';
import { godot_node_3d_observe_local } from './node-3d';

export type CollisionObjectKind = 'static' | 'character' | 'rigid' | 'area';

/** What compat reads from `<Physics>`'s context (`useRapier()`). */
export interface GodotPhysicsContext {
  readonly world: World;
  readonly rigidBodyStates: ReadonlyMap<number, { readonly object: object; readonly rigidBody: RigidBody }>;
  readonly colliderStates: ReadonlyMap<number, { readonly collider: Collider; readonly object: object; readonly worldParent?: object }>;
}

let context: GodotPhysicsContext | undefined;

/**
 * Hands compat the `<Physics>` context of the world the game renders; the returned call releases it.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/resources/3d/world_3d.cpp:52
 */
export function godot_physics_attach(attached: GodotPhysicsContext): () => void {
  context = attached;
  return () => {
    if (context === attached) context = undefined;
  };
}

/**
 * The Rapier world of the attached `<Physics>`.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/resources/3d/world_3d.cpp:52
 */
export function godot_physics_world(): World | undefined {
  return context?.world;
}

/** A body standing for a node that is not its object (a GridMap's cells), by body handle. */
const STAND_IN = new Map<number, object>();
/** Each node's last known body handle. */
const HANDLE = new WeakMap<object, number>();

/**
 * The Rapier body of a node: its `<RigidBody>`'s, or the body standing in for it.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:96
 */
export function godot_collision_object_body(object: object): RigidBody | undefined {
  if (context === undefined) return undefined;
  const entity = godot_node_entity(object);
  const known = HANDLE.get(entity);
  if (known !== undefined) {
    const state = context.rigidBodyStates.get(known);
    if (state !== undefined && (state.object === entity || STAND_IN.get(known) === entity)) return state.rigidBody;
  }
  for (const [handle, state] of context.rigidBodyStates) {
    if (state.object === entity || STAND_IN.get(handle) === entity) {
      HANDLE.set(entity, handle);
      return state.rigidBody;
    }
  }
  return undefined;
}

/**
 * The node a Rapier body belongs to (a `<RigidBody>`'s ref holds the body).
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:96
 */
export function godot_collision_object_node(body: object): object | undefined {
  const handle = (body as { readonly handle?: unknown }).handle;
  if (typeof handle !== 'number') return undefined;
  return STAND_IN.get(handle) ?? context?.rigidBodyStates.get(handle)?.object;
}

/**
 * The node a collider belongs to: the object of its body, or the node its body stands in for.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:96
 */
export function godot_collision_object_of_collider(collider: Collider): object | undefined {
  const body = collider.parent();
  if (body !== null) {
    const standIn = STAND_IN.get(body.handle);
    if (standIn !== undefined) return standIn;
    const state = context?.rigidBodyStates.get(body.handle);
    if (state !== undefined) return state.object;
  }
  return context?.colliderStates.get(collider.handle)?.worldParent;
}

/** Each collider element's node and the collider it rendered, rebuilt when colliders come or go. */
let colliderOfNode = new WeakMap<object, Collider>();
let indexed: { readonly states: GodotPhysicsContext['colliderStates']; readonly size: number } | undefined;

/**
 * The Rapier collider a collider element (`<CuboidCollider>`) rendered as the node, a
 * CollisionShape3D; undefined for any other node, or before the collider is created.
 *
 * @godot CollisionShape3D (protocol)
 * @source scene/3d/physics/collision_shape_3d.cpp:46
 */
export function godot_collision_object_collider_of_node(entity: object): Collider | undefined {
  if (context === undefined) return undefined;
  const states = context.colliderStates;
  if (indexed?.states !== states || indexed.size !== states.size) {
    colliderOfNode = new WeakMap();
    for (const state of states.values()) colliderOfNode.set(state.object, state.collider);
    indexed = { states, size: states.size };
  }
  const known = colliderOfNode.get(entity);
  return known !== undefined && states.get(known.handle)?.object === entity ? known : undefined;
}

/**
 * Makes the node the one a body its JSX declares stands for (a GridMap's cells); the returned call
 * ends it, as the body unmounts.
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/gridmap/grid_map.cpp:420
 */
export function godot_collision_object_stand_in(body: RigidBody, entity: object): () => void {
  STAND_IN.set(body.handle, entity);
  return () => {
    if (STAND_IN.get(body.handle) === entity) STAND_IN.delete(body.handle);
  };
}

/**
 * The colliders of a node's body: the shapes its shape owners added to it.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:616
 */
export function godot_collision_object_colliders(object: object): readonly Collider[] {
  const body = godot_collision_object_body(object);
  if (body === undefined) return [];
  return Array.from({ length: body.numColliders() }, (_, index) => body.collider(index));
}


/**
 * The node's kind, from its Rapier body's type.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:718
 */
export function godot_collision_object_kind(object: object): CollisionObjectKind | undefined {
  const body = godot_collision_object_body(object);
  if (body === undefined) return undefined;
  const type = body.bodyType();
  if (type === RAPIER.RigidBodyType.Dynamic) return 'rigid';
  if (type === RAPIER.RigidBodyType.Fixed) return godot_collision_object_colliders(object).some((collider) => collider.isSensor()) ? 'area' : 'static';
  return 'character';
}

const position = new ThreeVector3();
const rotation = new Quaternion();
const scale = new ThreeVector3();

// A script that places a node with a body places its body: a dynamic body is teleported
// (`rigid_body_3d.cpp:170`), a kinematic one (a CharacterBody3D, an AnimatableBody3D) moves there
// over the next step, keeping the velocity that carries what rests on it (`GodotBody3D::set_state`,
// godot_body_3d.cpp:354).
godot_node_3d_observe_local((object) => {
  const body = context === undefined ? undefined : godot_collision_object_body(object);
  if (body === undefined) return;
  object.updateWorldMatrix(true, false);
  object.matrixWorld.decompose(position, rotation, scale);
  if (body.isKinematic()) {
    body.setNextKinematicTranslation(position);
    body.setNextKinematicRotation(rotation);
    return;
  }
  body.setTranslation(position, true);
  body.setRotation(rotation, true);
});

interface Layers {
  layer: number;
  mask: number;
  rayPickable: boolean;
}

const LAYERS = new WeakMap<object, Layers>();

/** A node's layers: seeded from its `userData` (`collision_layer`, `collision_mask`), else Godot's 1 and 1. */
function layersOf(object: object): Layers {
  const entity = godot_node_entity(object);
  let layers = LAYERS.get(entity);
  if (layers === undefined) {
    const data = ((entity as Object3D).userData ?? {}) as Readonly<Record<string, unknown>>;
    layers = {
      layer: data['collision_layer'] === undefined ? 1 : Number(data['collision_layer']) >>> 0,
      mask: data['collision_mask'] === undefined ? 1 : Number(data['collision_mask']) >>> 0,
      rayPickable: data['input_ray_pickable'] === undefined ? true : Boolean(data['input_ray_pickable']),
    };
    LAYERS.set(entity, layers);
  }
  return layers;
}

/** The low 16 bits of the layer and mask as the colliders' Rapier collision groups. */
function applyGroups(object: object): void {
  const layers = layersOf(object);
  const groups = (((layers.layer & 0xffff) << 16) | (layers.mask & 0xffff)) >>> 0;
  for (const collider of godot_collision_object_colliders(object)) collider.setCollisionGroups(groups);
}

/**
 * The node's collision layer and mask, as queries and areas filter by them.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/collision_object_3d.cpp:154
 */
export function godot_collision_object_layers(object: object): { readonly layer: number; readonly mask: number } {
  return layersOf(object);
}

/**
 * @godot CollisionObject3D.set_collision_layer
 * @source scene/3d/physics/collision_object_3d.cpp:154
 */
export function set_collision_layer(self: object, layer: number): void {
  layersOf(self).layer = layer >>> 0;
  applyGroups(self);
}

/**
 * @godot CollisionObject3D.get_collision_layer
 * @source scene/3d/physics/collision_object_3d.cpp:158
 */
export function get_collision_layer(self: object): number {
  return layersOf(self).layer;
}

/**
 * @godot CollisionObject3D.set_collision_mask
 * @source scene/3d/physics/collision_object_3d.cpp:167
 */
export function set_collision_mask(self: object, mask: number): void {
  layersOf(self).mask = mask >>> 0;
  applyGroups(self);
}

/**
 * @godot CollisionObject3D.get_collision_mask
 * @source scene/3d/physics/collision_object_3d.cpp:171
 */
export function get_collision_mask(self: object): number {
  return layersOf(self).mask;
}

/**
 * @godot CollisionObject3D.set_collision_layer_value
 * @source scene/3d/physics/collision_object_3d.cpp:183
 */
export function set_collision_layer_value(self: object, layer_number: number, value: boolean): void {
  const bit = 1 << (layer_number - 1);
  set_collision_layer(self, value ? get_collision_layer(self) | bit : get_collision_layer(self) & ~bit);
}

/**
 * @godot CollisionObject3D.get_collision_layer_value
 * @source scene/3d/physics/collision_object_3d.cpp:189
 */
export function get_collision_layer_value(self: object, layer_number: number): boolean {
  return (get_collision_layer(self) & (1 << (layer_number - 1))) !== 0;
}

/**
 * @godot CollisionObject3D.set_collision_mask_value
 * @source scene/3d/physics/collision_object_3d.cpp:201
 */
export function set_collision_mask_value(self: object, layer_number: number, value: boolean): void {
  const bit = 1 << (layer_number - 1);
  set_collision_mask(self, value ? get_collision_mask(self) | bit : get_collision_mask(self) & ~bit);
}

/**
 * @godot CollisionObject3D.get_collision_mask_value
 * @source scene/3d/physics/collision_object_3d.h:177
 */
export function get_collision_mask_value(self: object, layer_number: number): boolean {
  return (get_collision_mask(self) & (1 << (layer_number - 1))) !== 0;
}

/**
 * The node's RID: the node itself stands for it.
 *
 * @godot CollisionObject3D.get_rid
 * @source core/object/object.h:813
 */
export function get_rid(self: object): object {
  return godot_node_entity(self);
}

/**
 * @godot CollisionObject3D.set_ray_pickable
 * @source scene/3d/physics/collision_object_3d.cpp:457
 */
export function set_ray_pickable(self: object, ray_pickable: boolean): void {
  layersOf(self).rayPickable = ray_pickable;
}

/**
 * @godot CollisionObject3D.is_ray_pickable
 * @source scene/3d/physics/collision_object_3d.cpp:462
 */
export function is_ray_pickable(self: object): boolean {
  return layersOf(self).rayPickable;
}
