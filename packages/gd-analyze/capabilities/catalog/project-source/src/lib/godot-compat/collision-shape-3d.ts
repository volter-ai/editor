/**
 * @godot-class CollisionShape3D
 * @role BINDING
 *
 * Godot 4.7's `CollisionShape3D` (`scene/3d/physics/collision_shape_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): a Node3D child of a collision object that gives it a
 * shape at the child's local transform. It is a collider element (`<CuboidCollider>`), and its node
 * the Object3D the element renders: its shape is read from the Rapier collider the first time it is
 * asked for, with the settings Rapier has no form for from its body's `userData.shapes`, and
 * setting its shape or `disabled` changes that collider.
 */

import { type Ball, type Capsule, type Collider, type ConvexPolyhedron, type Cuboid, ShapeType, type TriMesh } from '@dimforge/rapier3d-compat';
import { construct as box, set_size } from './box-shape-3d';
import { construct as capsule, set_height, set_radius as set_capsule_radius } from './capsule-shape-3d';
import { type ConcavePolygonShape3D, construct as concave, set_backface_collision_enabled, set_faces } from './concave-polygon-shape-3d';
import { construct as convex, set_points } from './convex-polygon-shape-3d';
import { construct as sphere, set_radius as set_sphere_radius } from './sphere-shape-3d';
import { godot_collision_object_collider_of_node, godot_collision_object_node } from './collision-object-3d';
import { godot_node_class_reader, godot_node_entity } from './node';
import { godot_shape_3d_collider, godot_shape_3d_observe } from './shape-3d';
import { construct as vector3, type Vector3 } from './vector3';

interface ShapeState {
  shape: object | null;
  disabled: boolean;
  readonly collider: Collider | undefined;
}

const SHAPE = new WeakMap<object, ShapeState>();
/** The colliders each shape resource is the shape of. */
const USERS = new WeakMap<object, Set<Collider>>();

function stateOf(object: object): ShapeState {
  const entity = godot_node_entity(object);
  let state = SHAPE.get(entity);
  if (state === undefined) {
    const collider = godot_collision_object_collider_of_node(entity);
    state = collider === undefined ? { shape: null, disabled: false, collider } : declared(entity, collider);
    SHAPE.set(entity, state);
  }
  return state;
}

const COLLISION_SHAPE_3D = Object.freeze(['CollisionShape3D', 'Node3D', 'Node', 'Object']);
godot_node_class_reader((entity) => (godot_collision_object_collider_of_node(entity) === undefined ? undefined : COLLISION_SHAPE_3D));

/** A Float32Array of xyz triples as Vector3s. */
function points(values: Float32Array, indices?: Uint32Array): Vector3[] {
  const at = (i: number) => vector3(values[i * 3] as number, values[i * 3 + 1] as number, values[i * 3 + 2] as number);
  return indices === undefined ? Array.from({ length: values.length / 3 }, (_, i) => at(i)) : Array.from(indices, (i) => at(i));
}

/**
 * The Godot shape a declared collider holds, the data each shape resource hands the physics
 * server read back: a cuboid is a BoxShape3D of twice its half extents (`box_shape_3d.cpp:37`), a
 * ball a SphereShape3D of its radius, a capsule a CapsuleShape3D whose height spans its caps
 * (`capsule_shape_3d.cpp:100`), a convex hull a ConvexPolygonShape3D of the hull's vertices, a
 * triangle mesh a ConcavePolygonShape3D of its triangles' corners in order.
 */
function shapeOf(collider: Collider): object {
  const held = collider.shape;
  switch (held.type) {
    case ShapeType.Cuboid: {
      const half = (held as Cuboid).halfExtents;
      const shape = box();
      set_size(shape, vector3(half.x * 2, half.y * 2, half.z * 2));
      return shape;
    }
    case ShapeType.Ball: {
      const shape = sphere();
      set_sphere_radius(shape, (held as Ball).radius);
      return shape;
    }
    case ShapeType.Capsule: {
      const { halfHeight, radius } = held as Capsule;
      const shape = capsule();
      set_capsule_radius(shape, radius);
      set_height(shape, (halfHeight + radius) * 2);
      return shape;
    }
    case ShapeType.ConvexPolyhedron: {
      const shape = convex();
      set_points(shape, points((held as ConvexPolyhedron).vertices));
      return shape;
    }
    case ShapeType.TriMesh: {
      const mesh = held as TriMesh;
      const shape = concave();
      set_faces(shape, points(mesh.vertices, mesh.indices));
      return shape;
    }
    default:
      throw new Error(`godot-compat: a declared collider of Rapier shape ${String(held.type)} has no Godot shape.`);
  }
}

/**
 * A collider element's CollisionShape3D state: its shape the Godot shape the collider holds, and
 * the settings Rapier has no form for, by their Godot names, from its body's `userData.shapes`:
 * `disabled`, and a concave shape's `backface_collision`.
 */
function declared(entity: object, collider: Collider): ShapeState {
  const shape = shapeOf(collider);
  const body = collider.parent();
  const owner = body === null ? undefined : (godot_collision_object_node(body) as { readonly userData?: { readonly shapes?: Record<string, Record<string, unknown>> } } | undefined);
  const data = owner?.userData?.shapes?.[(entity as { readonly name?: string }).name ?? ''] ?? {};
  const state: ShapeState = { shape, disabled: false, collider };
  for (const [key, value] of Object.entries(data)) {
    if (key === 'disabled') state.disabled = Boolean(value);
    else if (key === 'backface_collision' && collider.shape.type === ShapeType.TriMesh) set_backface_collision_enabled(shape as ConcavePolygonShape3D, Boolean(value));
    else throw new Error(`godot-compat: CollisionShape3D has no setting ${key} to seed from userData.`);
  }
  use(state);
  return state;
}

/**
 * The collider brought up to the node's shape and `disabled` (`_update_in_shape_owner`,
 * `collision_shape_3d.cpp:46`): no shape or disabled, it takes no part in collisions.
 */
function use(state: ShapeState): void {
  const collider = state.collider;
  if (collider === undefined) return;
  collider.setEnabled(state.shape !== null && !state.disabled);
  if (state.shape === null) return;
  let users = USERS.get(state.shape);
  if (users === undefined) USERS.set(state.shape, (users = new Set()));
  users.add(collider);
}

// A shape resource's properties changed: each collider it is the shape of takes its new geometry.
godot_shape_3d_observe((shape) => {
  const desc = godot_shape_3d_collider(shape).desc;
  for (const collider of USERS.get(shape) ?? []) {
    if (desc !== null && collider.isValid()) collider.setShape(desc.shape);
  }
});

/**
 * @godot CollisionShape3D.set_shape
 * @source scene/3d/physics/collision_shape_3d.cpp:192
 */
export function set_shape(self: object, shape: object | null): void {
  const state = stateOf(self);
  if (state.shape !== null) USERS.get(state.shape)?.delete(state.collider as Collider);
  state.shape = shape;
  const desc = shape === null ? null : godot_shape_3d_collider(shape).desc;
  if (desc !== null) state.collider?.setShape(desc.shape);
  use(state);
}

/**
 * @godot CollisionShape3D.get_shape
 * @source scene/3d/physics/collision_shape_3d.cpp:234
 */
export function get_shape(self: object): object | null {
  return stateOf(self).shape;
}

/**
 * @godot CollisionShape3D.set_disabled
 * @source scene/3d/physics/collision_shape_3d.cpp:238
 */
export function set_disabled(self: object, disabled: boolean): void {
  const state = stateOf(self);
  state.disabled = Boolean(disabled);
  use(state);
}

/**
 * @godot CollisionShape3D.is_disabled
 * @source scene/3d/physics/collision_shape_3d.cpp:246
 */
export function is_disabled(self: object): boolean {
  return stateOf(self).disabled;
}
