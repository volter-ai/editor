/**
 * @godot-class Shape3D
 * @role BINDING
 *
 * Godot 4.7's `Shape3D` resources (`scene/resources/3d/shape_3d.h`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) as Rapier collider shapes. A shape is a mutable record
 * of its Godot properties, shared by reference as a Resource is. Each concrete shape module gives
 * its records the Rapier description of their current properties (the shape data the physics
 * server receives, `shape_set_data`), so a body builds a collider from any shape without naming
 * its class. Rapier answers every geometric question about it.
 */

import type { ColliderDesc, Shape } from '@dimforge/rapier3d-compat';

/** What a concrete shape module gives its records. */
export interface ShapeGeometry<T> {
  /** The Rapier collider description of the shape's current properties. */
  readonly collider: (shape: T) => ColliderDesc | null;
  /**
   * For a shape that is a core swept by a radius (a sphere is its centre, a capsule its
   * segment): that core as a Rapier shape, and the radius, so a contact query asks Rapier about
   * the core, whose separation Rapier measures without its penetration solver.
   */
  readonly core?: (shape: T) => { readonly shape: Shape; readonly radius: number };
  /** A concave shape's `backface_collision`. */
  readonly backface?: (shape: T) => boolean;
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
 * The shape's core and radius, when it is a core swept by a radius.
 *
 * @godot Shape3D (protocol)
 * @source scene/resources/3d/shape_3d.cpp:142
 */
export function godot_shape_3d_core(shape: object): { readonly shape: Shape; readonly radius: number } | undefined {
  return geometryOf(shape).core?.(shape);
}

/**
 * Whether a concave shape collides with the backs of its faces (false for any other shape).
 *
 * @godot Shape3D (protocol)
 * @source scene/resources/3d/concave_polygon_shape_3d.cpp:110
 */
export function godot_shape_3d_backface(shape: object): boolean {
  return geometryOf(shape).backface?.(shape) ?? false;
}
