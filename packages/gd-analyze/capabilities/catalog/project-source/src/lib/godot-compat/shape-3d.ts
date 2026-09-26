/**
 * @godot-class Shape3D
 * @role BINDING
 *
 * Godot 4.7's `Shape3D` resources (`scene/resources/3d/shape_3d.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as Rapier collider shapes. A shape is a mutable record
 * of its Godot properties, shared by reference as a Resource is. Each concrete shape module gives
 * its records their geometry under `GEOMETRY`, as GodotPhysics3D's shape classes override their
 * virtual methods (`modules/godot_physics_3d/godot_shape_3d.h`): the Rapier collider of their
 * current properties, and Godot's own segment and point tests. A body builds a collider, and a
 * query tests a shape, without naming its class.
 */

import type { ColliderDesc } from '@dimforge/rapier3d-compat';
import type { Vector3 } from './vector3';

/** A segment's hit on a shape, in the shape's local space. */
export interface ShapeSegmentHit {
  readonly point: Vector3;
  readonly normal: Vector3;
  readonly face: number;
}

/** What a concrete shape module gives its records. */
export interface ShapeGeometry<T> {
  /** The Rapier collider description of the shape's current properties. */
  readonly collider: (shape: T) => ColliderDesc | null;
  /** `GodotShape3D::intersect_segment` in the shape's local space. */
  readonly intersectSegment: (shape: T, begin: Vector3, end: Vector3, hitBackFaces: boolean) => ShapeSegmentHit | undefined;
  /** `GodotShape3D::intersect_point` in the shape's local space. */
  readonly intersectPoint: (shape: T, point: Vector3) => boolean;
}

/** Where a shape record keeps its geometry. */
const GEOMETRY: unique symbol = Symbol('godot-compat Shape3D geometry');

function geometryOf(shape: object): ShapeGeometry<object> {
  const geometry = (shape as { [GEOMETRY]?: ShapeGeometry<object> })[GEOMETRY];
  if (geometry === undefined) throw new TypeError('godot-compat: not a Shape3D.');
  return geometry;
}

/**
 * Gives a new shape record its geometry (`shape_create` and `shape_set_data` on the physics
 * server, `scene/resources/3d/shape_3d.cpp`).
 *
 * @godot Shape3D (protocol)
 * @source scene/resources/3d/shape_3d.cpp:142
 */
export function godot_shape_3d_describe<T extends object>(shape: T, geometry: ShapeGeometry<T>): T {
  Object.defineProperty(shape, GEOMETRY, { value: geometry, enumerable: false });
  return shape;
}

/**
 * The Rapier collider description of a shape's current properties, with a key that changes when
 * they do.
 *
 * @godot Shape3D (protocol)
 * @source scene/resources/3d/shape_3d.cpp:142
 */
export function godot_shape_3d_collider(shape: object): { readonly desc: ColliderDesc | null; readonly key: string } {
  return { desc: geometryOf(shape).collider(shape), key: JSON.stringify(shape) };
}

/**
 * `GodotShape3D::intersect_segment` of the shape's current properties, in its local space.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_shape_3d.h:87
 */
export function godot_shape_3d_intersect_segment(
  shape: object,
  begin: Vector3,
  end: Vector3,
  hitBackFaces: boolean,
): ShapeSegmentHit | undefined {
  return geometryOf(shape).intersectSegment(shape, begin, end, hitBackFaces);
}

/**
 * `GodotShape3D::intersect_point` of the shape's current properties, in its local space.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_shape_3d.h:88
 */
export function godot_shape_3d_intersect_point(shape: object, point: Vector3): boolean {
  return geometryOf(shape).intersectPoint(shape, point);
}
