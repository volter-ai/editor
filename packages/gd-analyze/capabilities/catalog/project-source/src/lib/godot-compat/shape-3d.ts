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

import type { ColliderDesc, Shape } from '@dimforge/rapier3d-compat';
import type { Transform3D } from './transform-3d';
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
  /**
   * A shape that is a core swept by a radius (a sphere is its centre, a capsule its segment), as
   * GodotPhysics3D's collision solver treats it: contacts are measured from the core, whose
   * distance queries are exact where a rounded shape's penetration queries are not.
   */
  readonly core?: (shape: T) => { readonly shape: Shape; readonly radius: number };
  /**
   * The outward normal, in local space, of the one face a surface point lies on (the separating
   * axis GodotCollisionSolver3D reports for a contact on that face), or undefined at an edge or
   * a vertex.
   */
  readonly faceNormal?: (shape: T, point: Vector3) => Vector3 | undefined;
  /**
   * `GodotShape3D::get_supports` in local space: the shape's extreme feature along a unit
   * direction, as a point (type 0), an edge (1) or a face (2).
   */
  readonly supports?: (shape: T, direction: Vector3) => ShapeSupports;
  /** `GodotShape3D::get_support`: the shape's farthest point along a local unit direction. */
  readonly support?: (shape: T, direction: Vector3) => Vector3;
  /**
   * GodotCollisionSolver3D's analytic contact of a sphere (world centre, radius, margins) against
   * this shape placed by `xform`: the sphere's point, this shape's point and the normal the solver
   * reports, or undefined when apart (`godot_collision_solver_3d_sat.cpp:774`).
   */
  readonly sphereContact?: (
    shape: T,
    xform: Transform3D,
    center: Vector3,
    radius: number,
    sphereMargin: number,
    shapeMargin: number,
  ) => readonly [Vector3, Vector3, Vector3] | undefined;
  /**
   * `GodotShape3D::project_range`: the shape placed by `xform` projected on a world axis
   * (`godot_shape_3d.h:80`).
   */
  readonly projectRange?: (shape: T, axis: Vector3, xform: Transform3D) => readonly [number, number];
  /**
   * Which of GodotCollisionSolver3D's separating-axis tests covers the shape (`box`, `capsule`),
   * for the pairs transcribed in `physics-server-3d.ts`.
   */
  readonly satKind?: 'box' | 'capsule';
  /** A concave shape's triangles, each a `GodotFaceShape3D` (`godot_shape_3d.h`), and whether their backs collide. */
  readonly triangles?: (shape: T) => ShapeTriangles;
}

/** A concave shape's triangles in local space and its `backface_collision`. */
export interface ShapeTriangles {
  readonly faces: readonly (readonly [Vector3, Vector3, Vector3])[];
  readonly backface: boolean;
}

/** The support feature of a shape: its points and `FeatureType` (point 0, edge 1, face 2). */
export interface ShapeSupports {
  readonly points: readonly Vector3[];
  readonly type: 0 | 1 | 2;
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

/**
 * The shape's core and radius, when it is a core swept by a radius.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_collision_solver_3d_sat.cpp:826
 */
export function godot_shape_3d_core(shape: object): { readonly shape: Shape; readonly radius: number } | undefined {
  return geometryOf(shape).core?.(shape);
}

/**
 * The local outward normal of the face a local surface point lies on, or undefined.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_collision_solver_3d_sat.cpp:618
 */
export function godot_shape_3d_face_normal(shape: object, point: Vector3): Vector3 | undefined {
  return geometryOf(shape).faceNormal?.(shape, point);
}

/**
 * `GodotShape3D::get_supports` of the shape's current properties along a local unit direction.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_shape_3d.h:79
 */
export function godot_shape_3d_supports(shape: object, direction: Vector3): ShapeSupports | undefined {
  return geometryOf(shape).supports?.(shape, direction);
}

/**
 * A concave shape's triangles in local space.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_shape_3d.cpp:1597
 */
export function godot_shape_3d_triangles(shape: object): ShapeTriangles | undefined {
  return geometryOf(shape).triangles?.(shape);
}

/**
 * `GodotShape3D::get_support` of the shape's current properties along a local unit direction.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_shape_3d.h:78
 */
export function godot_shape_3d_support(shape: object, direction: Vector3): Vector3 | undefined {
  return geometryOf(shape).support?.(shape, direction);
}

/**
 * The analytic contact of a sphere against the shape, when GodotCollisionSolver3D has one.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_collision_solver_3d_sat.cpp:774
 */
export function godot_shape_3d_sphere_contact(
  shape: object,
  xform: Transform3D,
  center: Vector3,
  radius: number,
  sphereMargin: number,
  shapeMargin: number,
): readonly [Vector3, Vector3, Vector3] | undefined | null {
  const contact = geometryOf(shape).sphereContact;
  return contact === undefined ? null : contact(shape, xform, center, radius, sphereMargin, shapeMargin);
}

/**
 * `GodotShape3D::project_range` of the shape placed by `xform` on a world axis.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_shape_3d.h:80
 */
export function godot_shape_3d_project_range(shape: object, axis: Vector3, xform: Transform3D): readonly [number, number] | undefined {
  return geometryOf(shape).projectRange?.(shape, axis, xform);
}

/**
 * The separating-axis test family of the shape, when transcribed.
 *
 * @godot Shape3D (protocol)
 * @source modules/godot_physics_3d/godot_collision_solver_3d_sat.cpp:2294
 */
export function godot_shape_3d_sat_kind(shape: object): 'box' | 'capsule' | undefined {
  return geometryOf(shape).satKind;
}
