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
 * The body's shapes keep GodotPhysics3D's server order (`GodotCollisionObject3D::shapes`,
 * `modules/godot_physics_3d/godot_collision_object_3d.cpp`), which query results index: a shape
 * is appended when its CollisionShape3D gets it, removed (the later ones moving down) when it loses
 * it, and a disabled shape keeps its place. Whether a shape is in the broad phase follows the same
 * file: a removed shape and every shape after it, and a disabled shape, leave it at once; added or
 * re-enabled shapes join it at the next shape update (a static body's move, the space's step), or
 * at once when the body enters the space.
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
import { godot_physics_material_computed, type PhysicsMaterial } from './physics-material';
import { godot_shape_3d_collider } from './shape-3d';
import { construct as basis } from './basis';
import { affine_inverse, construct as transform3d, type Transform3D } from './transform-3d';
import { construct as vector3, op_divide, op_subtract, type Vector3 } from './vector3';

const f32 = Math.fround;

export type CollisionObjectKind = 'static' | 'character' | 'rigid' | 'area';

/** One server shape of a collision object: Godot's shape, local transform and Rapier collider. */
export interface CollisionShapeEntry {
  readonly shapeNode: object;
  readonly shape: object;
  /** The shape's transform in the body, and its `affine_inverse` (`godot_collision_object_3d.cpp:66`). */
  local: Transform3D;
  localInverse: Transform3D;
  disabled: boolean;
  /** In the broad phase (`Shape::bpid != 0`): queries see it. */
  inBroadphase: boolean;
  collider: Collider | undefined;
  key: string;
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
  /**
   * Its transform, shapes, layer or mask changed since the last step (an area in the space's
   * moved list, `GodotArea3D::_shapes_changed`, `godot_area_3d.cpp:58`).
   */
  moved: boolean;
  /** A kinematic body that moved in this step (in the space's active list, `godot_body_3d.cpp:705`). */
  active: boolean;
  /** A kinematic body's velocity: its last step's motion over the step (`godot_body_3d.cpp:616`). */
  linearVelocity: Vector3;
  /** A rigid body's node transform as its last sync left it: a different one is the node moved. */
  nodeTransform: Transform3D | undefined;
  /** The body's `physics_material_override`, or none (friction 1, bounce 0). */
  material: PhysicsMaterial | null;
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
    moved: false,
    active: false,
    linearVelocity: vector3(),
    nodeTransform: undefined,
    material: null,
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
      readonly moved: boolean;
      readonly active: boolean;
      readonly linearVelocity: Vector3;
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

function sameTransform(a: Transform3D, b: Transform3D): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function dropCollider(world: World, entry: CollisionShapeEntry): void {
  if (entry.collider === undefined) return;
  ENTITY_OF_COLLIDER.delete(entry.collider.handle);
  world.removeCollider(entry.collider, false);
  entry.collider = undefined;
}

/** `GodotCollisionObject3D::_update_shapes`: every enabled shape joins the broad phase (`:155`). */
function updateShapes(state: ObjectState): void {
  for (const entry of state.colliders) if (!entry.disabled) entry.inBroadphase = true;
}

/**
 * A new layer or mask reaches the server as `_shape_changed` (`godot_collision_object_3d.h:155`):
 * shapes updated at once, and an area put in the moved list.
 */
function shapeChanged(state: ObjectState): void {
  if (state.body === undefined) return;
  updateShapes(state);
  state.moved = true;
}

function removeBody(world: World, state: ObjectState): void {
  for (const entry of state.colliders) {
    if (entry.collider !== undefined) ENTITY_OF_COLLIDER.delete(entry.collider.handle);
  }
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
  state.moved = true;
  // A static body's or area's new transform updates its shapes at once (`_set_transform`,
  // `godot_collision_object_3d.h:86`).
  if (state.kind === 'static' || state.kind === 'area') updateShapes(state);
  state.body.setTranslation({ x: global.origin.x, y: global.origin.y, z: global.origin.z }, false);
  state.body.setRotation(rotationOf(global), false);
}

/**
 * The server shape list brought up to the CollisionShape3D children, as their calls reach the
 * server (`scene/3d/physics/collision_object_3d.cpp`, `shape_owner_*`): a child that left or whose
 * shape changed has its shape removed (`remove_shape`, `godot_collision_object_3d.cpp:112`), then
 * each child's new shape is appended (`add_shape`, `:35`); `disabled` and the local transform are
 * set in place (`set_shape_disabled`, `:72`; `set_shape_transform`, `:60`).
 */
function syncShapes(world: World, entity: object, state: ObjectState): void {
  const children = (entity as Object3D).children;
  const current = (entry: CollisionShapeEntry): boolean =>
    (entry.shapeNode as Object3D).parent === entity && !godot_node_is_freed(entry.shapeNode) && godot_collision_shape_3d_of(entry.shapeNode)?.shape === entry.shape;
  for (let index = 0; index < state.colliders.length; index += 1) {
    const entry = state.colliders[index] as CollisionShapeEntry;
    if (current(entry)) continue;
    for (const later of state.colliders.slice(index)) later.inBroadphase = false;
    state.moved = true;
    dropCollider(world, entry);
    state.colliders.splice(index, 1);
    index -= 1;
  }
  for (const child of children) {
    const shapeState = godot_collision_shape_3d_of(child);
    if (shapeState === undefined || shapeState.shape === null) continue;
    let entry = state.colliders.find((candidate) => candidate.shapeNode === child);
    if (entry === undefined) {
      const local = get_transform(child);
      entry = { shapeNode: child, shape: shapeState.shape, local, localInverse: affine_inverse(local), disabled: shapeState.disabled, inBroadphase: false, collider: undefined, key: '' };
      state.colliders.push(entry);
      state.moved = true;
    }
    if (entry.disabled !== shapeState.disabled) {
      entry.disabled = shapeState.disabled;
      state.moved = true;
      if (entry.disabled) entry.inBroadphase = false;
    }
    const local = get_transform(child);
    if (JSON.stringify(local) !== JSON.stringify(entry.local)) {
      entry.local = local;
      entry.localInverse = affine_inverse(local);
      state.moved = true;
    }
    const described = godot_shape_3d_collider(entry.shape);
    const key = `${described.key}|${JSON.stringify(entry.local)}|${state.kind}`;
    if (entry.disabled || described.desc === null) {
      dropCollider(world, entry);
      continue;
    }
    if (entry.collider !== undefined && entry.key === key) continue;
    if (entry.collider !== undefined) state.moved = true;
    dropCollider(world, entry);
    described.desc
      .setTranslation(entry.local.origin.x, entry.local.origin.y, entry.local.origin.z)
      .setRotation(rotationOf(entry.local))
      .setSensor(state.kind === 'area');
    entry.collider = world.createCollider(described.desc, state.body);
    entry.key = key;
    ENTITY_OF_COLLIDER.set(entry.collider.handle, entity);
  }
  applyMaterial(state);
}

/**
 * The body's friction and bounce on its colliders (`_reload_physics_characteristics`,
 * `scene/3d/physics/static_body_3d.cpp:93`), combined as GodotPhysics3D combines them: friction
 * the smaller (`combine_friction`, `godot_body_pair_3d.cpp:259`), bounce the larger, which is the
 * sum `combine_bounce` takes (`:255`) whenever one side has none. Rough and absorbent materials
 * (negative values) are not transcribed.
 */
function applyMaterial(state: ObjectState): void {
  const computed = state.material === null ? { friction: 1, bounce: 0 } : godot_physics_material_computed(state.material);
  for (const entry of state.colliders) {
    if (entry.collider === undefined) continue;
    entry.collider.setFriction(Math.abs(computed.friction));
    entry.collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
    entry.collider.setRestitution(Math.max(0, Math.min(1, computed.bounce)));
    entry.collider.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);
  }
}

/**
 * A body's `physics_material_override` (`StaticBody3D`, `RigidBody3D`), read at each sync.
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/static_body_3d.cpp:56
 */
export function godot_collision_object_material(entity: object, material: PhysicsMaterial | null): void {
  stateOf(entity, 'set_physics_material_override').material = material;
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
    const entering = state.body === undefined;
    if (entering) {
      // Entering the world sends the transform at once (`_notification`, ENTER_WORLD), and the
      // space registers every shape (`GodotCollisionObject3D::_set_space`).
      state.body = world.createRigidBody(bodyDesc(state.kind));
      godot_collision_object_place(entity);
      state.moved = true;
    }
    syncShapes(world, entity, state);
    if (entering) updateShapes(state);
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
    const global = get_global_transform(entity as Object3D);
    if (state.kind === 'rigid') {
      if (state.nodeTransform !== undefined && sameTransform(global, state.nodeTransform)) continue;
      state.nodeTransform = global;
      godot_collision_object_place(entity, global);
      continue;
    }
    if (sameTransform(global, state.pending ?? state.transform)) continue;
    if (state.kind === 'static' || state.kind === 'area') godot_collision_object_place(entity, global);
    else if (state.kind === 'character') state.pending = global;

  }
}

/**
 * The space's step, first half: pending shapes join the broad phase (`GodotPhysicsServer3D::step`
 * runs `_update_shapes`, `modules/godot_physics_3d/godot_physics_server_3d.cpp:1679`), and each
 * kinematic body with a held transform is active, its velocity the motion over the step
 * (`GodotBody3D::integrate_forces`, `godot_body_3d.cpp:616`). Its transform stays until
 * `godot_collision_objects_integrate`: pairs are set up before it moves.
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_physics_server_3d.cpp:1679
 */
export function godot_collision_objects_step(world: World, delta: number): void {
  void world;
  for (const state of OBJECT.values()) updateShapes(state);
  const step = Math.fround(delta);
  for (const state of OBJECT.values()) {
    state.active = state.pending !== undefined;
    if (state.kind === 'character') {
      const target = state.pending ?? state.transform;
      state.linearVelocity = op_divide(op_subtract(target.origin, state.transform.origin), step);
    }
  }
}

/**
 * The space's step, second half: a kinematic body's held transform becomes its transform
 * (`GodotBody3D::integrate_velocities`, `godot_body_3d.cpp:701`), after the pairs were set up.
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_body_3d.cpp:701
 */
export function godot_collision_objects_integrate(world: World): void {
  for (const [entity, state] of OBJECT) {
    if (state.pending === undefined) continue;
    godot_collision_object_place(entity, state.pending);
    state.pending = undefined;
  }
  world.propagateModifiedBodyPositionsToColliders();
}

/** `Basis::set_quaternion` (`core/math/basis.cpp:829`): a Rapier rotation as Godot's basis. */
function basisOf(q: { x: number; y: number; z: number; w: number }): Transform3D['basis'] {
  const x = f32(q.x);
  const y = f32(q.y);
  const z = f32(q.z);
  const w = f32(q.w);
  const d = f32(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z)) + f32(w * w));
  const s = f32(2 / d);
  const xs = f32(x * s);
  const ys = f32(y * s);
  const zs = f32(z * s);
  const wx = f32(w * xs);
  const wy = f32(w * ys);
  const wz = f32(w * zs);
  const xx = f32(x * xs);
  const xy = f32(x * ys);
  const xz = f32(x * zs);
  const yy = f32(y * ys);
  const yz = f32(y * zs);
  const zz = f32(z * zs);
  // Rows (1 - (yy + zz), xy - wz, xz + wy), ...; the record holds columns.
  return basis(
    vector3(f32(1 - f32(yy + zz)), f32(xy + wz), f32(xz - wy)),
    vector3(f32(xy - wz), f32(1 - f32(xx + zz)), f32(yz + wx)),
    vector3(f32(xz + wy), f32(yz - wx), f32(1 - f32(xx + yy))),
  );
}

/**
 * A rigid body's transform is Rapier's after the step (`GodotBody3D::integrate_velocities`,
 * `godot_body_3d.cpp:708`), read back as Godot's transform.
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_body_3d.cpp:708
 */
export function godot_collision_objects_read_rigid(): void {
  for (const state of OBJECT.values()) {
    if (state.kind !== 'rigid' || state.body === undefined) continue;
    const t = state.body.translation();
    const next = transform3d(basisOf(state.body.rotation()), vector3(t.x, t.y, t.z));
    state.transform = next;
    state.inverse = affine_inverse(next);
  }
}

/**
 * The space's moved list is emptied once its areas' pairs are set up (`godot_step_3d.cpp:258`).
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_step_3d.cpp:258
 */
export function godot_collision_objects_settle(): void {
  for (const state of OBJECT.values()) state.moved = false;
}

/**
 * The server's pending shapes join the broad phase (`GodotPhysicsServer3D::_update_shapes`, which
 * `body_test_motion` runs first, `godot_physics_server_3d.cpp:946`).
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_physics_server_3d.cpp:946
 */
export function godot_collision_objects_update_shapes(): void {
  for (const state of OBJECT.values()) updateShapes(state);
}

/**
 * A Godot transform as a Rapier pose: its origin and the quaternion of its (orthonormal) basis.
 *
 * @godot CollisionObject3D (protocol)
 * @source core/math/basis.cpp:780
 */
export function godot_collision_object_pose(transform: Transform3D): {
  readonly translation: { x: number; y: number; z: number };
  readonly rotation: { x: number; y: number; z: number; w: number };
} {
  return { translation: { x: transform.origin.x, y: transform.origin.y, z: transform.origin.z }, rotation: rotationOf(transform) };
}

/**
 * A body's collision exceptions (`GodotBody3D::exceptions`, `godot_body_3d.h:132`), which
 * `add_collision_exception_with` fills.
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_body_3d.h:132
 */
export function godot_collision_object_exceptions(entity: object): Set<object> {
  return stateOf(entity, 'add_collision_exception_with').exceptions;
}

/**
 * A rigid body's server transform set by the space's own integration (free flight,
 * `GodotBody3D::integrate_velocities`, `godot_body_3d.cpp:708`), and its Rapier body placed there.
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_body_3d.cpp:708
 */
export function godot_collision_object_moved(entity: object, transform: Transform3D): void {
  const state = OBJECT.get(entity);
  if (state?.body === undefined) return;
  state.transform = transform;
  state.inverse = affine_inverse(transform);
  state.body.setTranslation({ x: transform.origin.x, y: transform.origin.y, z: transform.origin.z }, false);
  state.body.setRotation(rotationOf(transform), false);
}

/**
 * Records the node transform a rigid body's sync gave its node (`set_ignore_transform_notification`
 * around it, `scene/3d/physics/rigid_body_3d.cpp:152`): not a move of the node. A node moved
 * otherwise sets the body's transform (`BODY_STATE_TRANSFORM`, `godot_body_3d.cpp:370`).
 *
 * @godot CollisionObject3D (protocol)
 * @source scene/3d/physics/rigid_body_3d.cpp:152
 */
export function godot_collision_object_synced(entity: object, transform: Transform3D): void {
  const state = OBJECT.get(entity);
  if (state !== undefined) state.nodeTransform = transform;
}

/**
 * Puts an area in the space's moved list (`set_monitor_callback`, `godot_area_3d.cpp:103`).
 *
 * @godot CollisionObject3D (protocol)
 * @source modules/godot_physics_3d/godot_area_3d.cpp:103
 */
export function godot_collision_object_touch(entity: object): void {
  const state = OBJECT.get(godot_node_entity(entity));
  if (state !== undefined) state.moved = true;
}

/**
 * The value is truncated to 32 bits, as the `uint32_t` parameter holds it.
 *
 * @godot CollisionObject3D.set_collision_layer
 * @source scene/3d/physics/collision_object_3d.cpp:145
 */
export function set_collision_layer(self: object, layer: number): void {
  const state = stateOf(self, 'set_collision_layer');
  state.layer = layer >>> 0;
  shapeChanged(state);
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
  const state = stateOf(self, 'set_collision_mask');
  state.mask = mask >>> 0;
  shapeChanged(state);
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
  shapeChanged(state);
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
  shapeChanged(state);
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
