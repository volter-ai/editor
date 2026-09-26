/**
 * @godot-class PhysicsServer3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsServer3D` public members this lane uses, bound onto the Rapier world as the
 * web platform's physics (`modules/godot_physics_3d/godot_physics_server_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). A singleton: no receiver. The Rapier world
 * `world-3d.ts` holds is the space: its bodies, colliders, broad phase and dynamics.
 *
 * `body_test_motion` transcribes `GodotSpace3D::test_body_motion`
 * (`modules/godot_physics_3d/godot_space_3d.cpp:652`), the query every CharacterBody3D motion
 * runs, in Godot's single precision: the recovery loop (four attempts pushing the body out of
 * contacts deeper than `margin * 0.05`, by 0.4 of each depth), the cast (eight bisection probes of
 * the swept shape against each shape), and the rest information at the unsafe position. Its
 * geometric questions are answered as GodotCollisionSolver3D answers them, because the motion's
 * result is decided by them to the last bit:
 * - Whether two shapes touch (`solve_distance`, each bisection probe) runs GodotPhysics3D's GJK
 *   (`gjk_epa.cpp`) over the shapes' `get_support`, transcribed: its termination tolerances decide
 *   where a grazing motion stops.
 * - A pair's contacts (`solve_static` with the margin) take the separating axis from Rapier's
 *   distance query between the body's core (or whole shape) and the other shape, exactly the face
 *   normal when the contact lies on one face of the other, then build the contact points as
 *   `SeparatorAxisTest::generate_contacts` does from both shapes' support features; a sphere pair
 *   uses the solver's analytic contact. Bounded deviation: at an edge or vertex contact the axis is
 *   Rapier's closest-point direction, where the SAT picks the axis of least overlap among those it
 *   tests.
 * Candidate shapes are every shape in the broad phase that `_cull_aabb_for_body` would admit (not
 * the body, not an area, layer against mask, no collision exception either way), without the AABB
 * cull, in the reverse of the order the collision objects entered the world: the order Godot's BVH
 * returned them in the measured scenes (a measurement, not a derivation: the BVH's order also
 * depends on its history, so a multi-contact recovery can resolve differently natively; see the
 * `safe-margin` comparator).
 */

import { type Shape, ShapeType, Triangle } from '@dimforge/rapier3d-compat';
import {
  type CollisionShapeEntry,
  godot_collision_object_object,
  godot_collision_object_pose,
  godot_collision_object_state,
  godot_collision_objects,
  godot_collision_objects_update_shapes,
} from './collision-object-3d';
import type { PhysicsTestMotionParameters3D } from './physics-test-motion-parameters-3d';
import type { MotionCollision, PhysicsTestMotionResult3D } from './physics-test-motion-result-3d';
import { op_multiply as basisMultiply } from './basis';
import { construct as plane } from './plane';
import {
  godot_shape_3d_core,
  godot_shape_3d_face_normal,
  godot_shape_3d_project_range,
  godot_shape_3d_sat_kind,
  godot_shape_3d_sphere_contact,
  godot_shape_3d_support,
  godot_shape_3d_supports,
  godot_shape_3d_triangles,
  type ShapeSupports,
} from './shape-3d';
import { affine_inverse, construct as transform3d, op_multiply as transform, type Transform3D } from './transform-3d';
import {
  construct as vector3,
  cross,
  dot,
  length,
  length_squared,
  normalized,
  op_add,
  op_divide,
  op_equal,
  op_multiply,
  op_negate,
  op_subtract,
  type Vector3,
} from './vector3';
import { godot_world_3d_direct_state, type PhysicsDirectSpaceState3D, type PhysicsSpace3D } from './world-3d';

const f32 = Math.fround;
/** `(real_t)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);
/** `godot_space_3d.cpp:40`. */
const TEST_MOTION_MARGIN_MIN_VALUE = f32(0.0001);
const TEST_MOTION_MIN_CONTACT_DEPTH_FACTOR = f32(0.05);

/**
 * @godot PhysicsServer3D.space_get_direct_state
 * @source modules/godot_physics_3d/godot_physics_server_3d.cpp:191
 */
export function space_get_direct_state(space: PhysicsSpace3D): PhysicsDirectSpaceState3D {
  return godot_world_3d_direct_state(space);
}

interface Candidate {
  readonly entity: object;
  readonly index: number;
  readonly shape: Shape;
  /** The Godot shape record. */
  readonly record: object;
  readonly transform: Transform3D;
  readonly inverse: Transform3D;
}

interface Contact {
  readonly a: Vector3;
  readonly b: Vector3;
  readonly normal: Vector3;
}

function rapierShape(entry: CollisionShapeEntry): Shape | undefined {
  return entry.collider?.shape;
}

/** One of the moving body's shapes: its Rapier shape and Godot record. */
interface BodyShape {
  readonly shape: Shape;
  readonly record: object;
}

/** `_cull_aabb_for_body` (`godot_space_3d.cpp:620`) without the AABB, and the motion's exclusions. */
function candidates(body: object, parameters: PhysicsTestMotionParameters3D): Candidate[] {
  const self = godot_collision_object_state(body);
  if (self === undefined) return [];
  const found: Candidate[] = [];
  for (const [entity, other] of [...godot_collision_objects()].reverse()) {
    if (entity === body || other.kind === 'area') continue;
    if ((self.mask & other.layer) === 0) continue;
    if (other.exceptions.has(body) || self.exceptions.has(entity)) continue;
    if (parameters.exclude_bodies.includes(entity)) continue;
    if (parameters.exclude_objects.includes(godot_collision_object_object(entity))) continue;
    other.colliders.forEach((entry, index) => {
      const shape = entry.inBroadphase ? rapierShape(entry) : undefined;
      if (shape === undefined) return;
      const xform = transform(other.transform, entry.local);
      found.push({ entity, index, shape, record: entry.shape, transform: xform, inverse: affine_inverse(xform) });
    });
  }
  return found;
}

function toVector(v: { x: number; y: number; z: number }): Vector3 {
  return vector3(v.x, v.y, v.z);
}

/** `Basis::xform_inv`: the columns dotted with the vector (`core/math/basis.h:343`). */
function basisXformInv(basis: Transform3D['basis'], v: Vector3): Vector3 {
  return vector3(dot(basis.x, v), dot(basis.y, v), dot(basis.z, v));
}

/** The other side of a contact: a convex shape, or one triangle of a concave one. */
interface Other {
  readonly shape: Shape;
  readonly pose: ReturnType<typeof godot_collision_object_pose>;
  readonly xform: Transform3D;
  readonly supports: (direction: Vector3) => ShapeSupports | undefined;
  /** The world normal of the one face a world point lies on, or undefined. */
  readonly face: (point: Vector3) => Vector3 | undefined;
  /** Whether a contact along this separating axis (toward the body) counts. */
  readonly accepts: (axis: Vector3) => boolean;
  /** The Godot shape record, when the other is a whole shape. */
  readonly record?: object;
  /** The world vertices and backface flag, when the other is a concave shape's triangle. */
  readonly triangle?: { readonly vertices: readonly [Vector3, Vector3, Vector3]; readonly backface: boolean };
}

/** `edge_support_threshold_lower` and `face_support_threshold` (`godot_shape_3d.cpp:55`), doubles. */
const EDGE_SUPPORT_THRESHOLD_LOWER = Math.sqrt(1 - 0.99999998 * 0.99999998);
const FACE_SUPPORT_THRESHOLD = 0.9998;
const BACKFACE_NORMAL_THRESHOLD = -0.0002;
const IDENTITY = transform3d();

function convexOther(candidate: Candidate): Other {
  return {
    accepts: () => true,
    record: candidate.record,
    shape: candidate.shape,
    pose: godot_collision_object_pose(candidate.transform),
    xform: candidate.transform,
    supports: (direction) => godot_shape_3d_supports(candidate.record, direction),
    face: (point) => {
      const local = godot_shape_3d_face_normal(candidate.record, transform(candidate.inverse, point));
      return local === undefined ? undefined : normalized(basisMultiply(candidate.transform.basis, local));
    },
  };
}

/** A concave shape's triangle as `GodotFaceShape3D` (`godot_shape_3d.cpp:1188`), in world space. */
function triangleOther(a: Vector3, b: Vector3, c: Vector3, backface: boolean): Other {
  const normal = plane(a, b, c).normal;
  return {
    triangle: { vertices: [a, b, c], backface },
    // Without backface collision, a contact from behind the face is ignored (`_BACKFACE_NORMAL_THRESHOLD`, `godot_collision_solver_3d_sat.cpp:39`).
    accepts: (axis) => backface || dot(axis, normal) >= BACKFACE_NORMAL_THRESHOLD,
    shape: new Triangle(a, b, c),
    pose: godot_collision_object_pose(IDENTITY),
    xform: IDENTITY,
    supports: (n) => {
      if (Math.abs(dot(normal, n)) > FACE_SUPPORT_THRESHOLD) return { points: [a, b, c], type: 2 };
      const vertex = [a, b, c];
      let best = 0;
      let max = dot(n, a);
      for (let i = 1; i < 3; i += 1) {
        const d = dot(n, vertex[i] as Vector3);
        if (d > max) {
          max = d;
          best = i;
        }
      }
      for (let i = 0; i < 3; i += 1) {
        const next = (i + 1) % 3;
        if (i !== best && next !== best) continue;
        if (Math.abs(dot(normalized(op_subtract(vertex[i] as Vector3, vertex[next] as Vector3)), n)) < EDGE_SUPPORT_THRESHOLD_LOWER) {
          return { points: [vertex[i] as Vector3, vertex[next] as Vector3], type: 1 };
        }
      }
      return { points: [vertex[best] as Vector3], type: 0 };
    },
    face: (point) => {
      const p = plane(a, b, c);
      if (Math.abs(f32(dot(p.normal, point) - p.d)) > 1e-4) return undefined;
      const inside = (sign: number): boolean =>
        [
          [a, b],
          [b, c],
          [c, a],
        ].every(([u, v]) => sign * dot(cross(op_subtract(point, u as Vector3), op_subtract(v as Vector3, u as Vector3)), p.normal) > 1e-4);
      return inside(1) || inside(-1) ? p.normal : undefined;
    },
  };
}

/** `Geometry3D::get_closest_point_to_segment_uncapped` (`core/math/geometry_3d.h:66`). */
function closestUncapped(point: Vector3, s0: Vector3, s1: Vector3): Vector3 {
  const p = op_subtract(point, s0);
  const n = op_subtract(s1, s0);
  const l2 = length_squared(n);
  if (l2 < 1e-20) return s0;
  return op_add(s0, op_multiply(n, f32(dot(n, p) / l2)));
}

/** `_CollectorCallback` (`godot_collision_solver_3d_sat.cpp:71`) gathering (A point, B point, normal). */
class Collector {
  swap = false;
  normal: Vector3 = vector3();
  readonly found: Contact[] = [];
  call(pA: Vector3, pB: Vector3, n: Vector3): void {
    let normal = n;
    if (dot(normal, op_subtract(pB, pA)) < 0) normal = op_negate(normal);
    if (this.swap) this.found.push({ a: pB, b: pA, normal: op_negate(normal) });
    else this.found.push({ a: pA, b: pB, normal });
  }
}

/** `_generate_contacts_face_face` (`godot_collision_solver_3d_sat.cpp:285`), also for an edge. */
function contactsFaceFace(pointsA: readonly Vector3[], pointsB: readonly Vector3[], collector: Collector): void {
  let clip: Vector3[] = [...pointsA];
  const planeB = plane(pointsB[0] as Vector3, pointsB[1] as Vector3, pointsB[2] as Vector3);
  for (let i = 0; i < pointsB.length; i += 1) {
    const edge0 = pointsB[i] as Vector3;
    const edge1 = pointsB[(i + 1) % pointsB.length] as Vector3;
    const clipNormal = normalized(cross(op_subtract(edge0, edge1), planeB.normal));
    const clipPlane = plane(clipNormal, edge0);
    const next: Vector3[] = [];
    const edge = clip.length === 2;
    for (let j = 0; j < clip.length; j += 1) {
      const a0 = clip[j] as Vector3;
      const a1 = clip[(j + 1) % clip.length] as Vector3;
      const dist0 = f32(dot(clipPlane.normal, a0) - clipPlane.d);
      const dist1 = f32(dot(clipPlane.normal, a1) - clipPlane.d);
      if (dist0 <= 0) next.push(a0);
      if (f32(dist0 * dist1) < 0 && !(edge && j > 0)) {
        const rel = op_subtract(a1, a0);
        const den = dot(clipPlane.normal, rel);
        const dist = f32(-f32(dot(clipPlane.normal, a0) - clipPlane.d) / den);
        next.push(op_add(a0, op_multiply(rel, dist)));
      }
    }
    clip = next;
  }
  for (const point of clip) {
    const d = f32(dot(planeB.normal, point) - planeB.d);
    const closest = op_subtract(point, op_multiply(planeB.normal, d));
    if (dot(collector.normal, point) >= dot(collector.normal, closest)) continue;
    collector.call(point, closest, planeB.normal);
  }
}

/** `_generate_contacts_edge_edge` (`godot_collision_solver_3d_sat.cpp:133`). */
function contactsEdgeEdge(pointsA: readonly Vector3[], pointsB: readonly Vector3[], collector: Collector): void {
  const a0 = pointsA[0] as Vector3;
  const b0 = pointsB[0] as Vector3;
  const relA = op_subtract(pointsA[1] as Vector3, a0);
  const relB = op_subtract(pointsB[1] as Vector3, b0);
  const c = cross(cross(relA, relB), relB);
  if (Math.abs(dot(relA, c)) < CMP_EPSILON) {
    const axis = normalized(relA);
    const baseA = op_subtract(a0, op_multiply(axis, dot(axis, a0)));
    const baseB = op_subtract(b0, op_multiply(axis, dot(axis, b0)));
    const dvec = [dot(axis, a0), dot(axis, pointsA[1] as Vector3), dot(axis, b0), dot(axis, pointsB[1] as Vector3)].sort((x, y) => x - y);
    collector.call(op_add(baseA, op_multiply(axis, dvec[1] as number)), op_add(baseB, op_multiply(axis, dvec[1] as number)), collector.normal);
    collector.call(op_add(baseA, op_multiply(axis, dvec[2] as number)), op_add(baseB, op_multiply(axis, dvec[2] as number)), collector.normal);
    return;
  }
  let d = f32(f32(dot(c, b0) - dot(a0, c)) / dot(relA, c));
  if (d < 0) d = 0;
  else if (d > 1) d = 1;
  const closestA = op_add(a0, op_multiply(relA, d));
  const closestB = closestUncapped(closestA, b0, pointsB[1] as Vector3);
  let normal = cross(relA, relB);
  const normalLength = length(normal);
  normal = normalLength > 1e-3 ? op_divide(normal, normalLength) : collector.normal;
  collector.call(closestA, closestB, normal);
}

/** `_generate_contacts_from_supports` (`godot_collision_solver_3d_sat.cpp:552`) for point, edge and face features. */
function contactsFromSupports(supportsA: ShapeSupports, supportsB: ShapeSupports, collector: Collector): void {
  let a = supportsA;
  let b = supportsB;
  if (a.type > b.type) {
    collector.swap = !collector.swap;
    collector.normal = op_negate(collector.normal);
    [a, b] = [b, a];
  }
  const pa = a.points;
  const pb = b.points;
  if (a.type === 0 && b.type === 0) collector.call(pa[0] as Vector3, pb[0] as Vector3, collector.normal);
  else if (a.type === 0 && b.type === 1) collector.call(pa[0] as Vector3, closestUncapped(pa[0] as Vector3, pb[0] as Vector3, pb[1] as Vector3), collector.normal);
  else if (a.type === 0) {
    const face = plane(pb[0] as Vector3, pb[1] as Vector3, pb[2] as Vector3);
    const point = pa[0] as Vector3;
    collector.call(point, op_subtract(point, op_multiply(face.normal, f32(dot(face.normal, point) - face.d))), face.normal);
  } else if (a.type === 1 && b.type === 1) contactsEdgeEdge(pa, pb, collector);
  else contactsFaceFace(pa, pb, collector);
}

/** A shape as a separating-axis test sees it: its projection, supports, and margin. */
interface SatShape {
  readonly project: (axis: Vector3) => readonly [number, number];
  readonly supports: (direction: Vector3) => ShapeSupports | undefined;
  readonly xform: Transform3D;
  readonly margin: number;
}

/** `SeparatorAxisTest` (`godot_collision_solver_3d_sat.cpp:618`) with its margins. */
class SeparatorAxisTest {
  best_depth = f32(1e15);
  best_axis: Vector3 = vector3();
  constructor(
    readonly a: SatShape,
    readonly b: SatShape,
  ) {}

  /** `test_axis` (`:640`): false when the axis separates the two. */
  test_axis(p_axis: Vector3): boolean {
    let axis = p_axis;
    if (Math.abs(axis.x) < CMP_EPSILON && Math.abs(axis.y) < CMP_EPSILON && Math.abs(axis.z) < CMP_EPSILON) axis = vector3(0, 1, 0);
    let [min_A, max_A] = this.a.project(axis);
    let [min_B, max_B] = this.b.project(axis);
    min_A = f32(min_A - this.a.margin);
    max_A = f32(max_A + this.a.margin);
    min_B = f32(min_B - this.b.margin);
    max_B = f32(max_B + this.b.margin);
    const halfA = f32(f32(max_A - min_A) * 0.5);
    min_B = f32(min_B - halfA);
    max_B = f32(max_B + halfA);
    const centerA = f32(f32(min_A + max_A) * 0.5);
    min_B = f32(min_B - centerA);
    max_B = f32(max_B - centerA);
    if (min_B > 0 || max_B < 0) return false;
    if (min_B < 0) min_B = -min_B;
    if (max_B < min_B) {
      if (max_B < this.best_depth) {
        this.best_depth = max_B;
        this.best_axis = axis;
      }
    } else if (min_B < this.best_depth) {
      this.best_depth = min_B;
      this.best_axis = op_negate(axis);
    }
    return true;
  }

  /** `generate_contacts` (`:703`). */
  generate_contacts(collector: Collector): void {
    if (op_equal(this.best_axis, vector3())) return;
    const axis = this.best_axis;
    const supportsA = this.a.supports(normalized(basisXformInv(this.a.xform.basis, op_negate(axis))));
    const supportsB = this.b.supports(normalized(basisXformInv(this.b.xform.basis, axis)));
    if (supportsA === undefined || supportsB === undefined) return;
    const worldA: ShapeSupports = {
      type: supportsA.type,
      points: supportsA.points.map((p) => op_add(transform(this.a.xform, p), op_multiply(op_negate(axis), this.a.margin))),
    };
    const worldB: ShapeSupports = {
      type: supportsB.type,
      points: supportsB.points.map((p) => op_add(transform(this.b.xform, p), op_multiply(axis, this.b.margin))),
    };
    collector.normal = axis;
    contactsFromSupports(worldA, worldB, collector);
  }
}

function satShape(record: object, xform: Transform3D, margin: number): SatShape {
  return {
    project: (axis) => godot_shape_3d_project_range(record, axis, xform) ?? [0, 0],
    supports: (direction) => godot_shape_3d_supports(record, direction),
    xform,
    margin,
  };
}

/** `_collision_box_capsule` (`godot_collision_solver_3d_sat.cpp:1172`). */
function boxCapsule(box: object, boxXform: Transform3D, boxMargin: number, capsule: object, capsuleXform: Transform3D, capsuleMargin: number, collector: Collector): void {
  const separator = new SeparatorAxisTest(satShape(box, boxXform, boxMargin), satShape(capsule, capsuleXform, capsuleMargin));
  const columns = [boxXform.basis.x, boxXform.basis.y, boxXform.basis.z];
  for (const column of columns) if (!separator.test_axis(normalized(column))) return;
  const cyl_axis = normalized(capsuleXform.basis.y);
  for (const column of columns) {
    const axis = cross(column, cyl_axis);
    if (Math.abs(length_squared(axis)) < CMP_EPSILON) continue;
    if (!separator.test_axis(normalized(axis))) return;
  }
  const he = godot_shape_3d_support(box, vector3(1, 1, 1)) ?? vector3();
  const cylPlane = plane(cyl_axis, 0);
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      for (let k = 0; k < 2; k += 1) {
        const signed = [f32(he.x * (i * 2 - 1)), f32(he.y * (j * 2 - 1)), f32(he.z * (k * 2 - 1))];
        let point = boxXform.origin;
        for (let l = 0; l < 3; l += 1) point = op_add(point, op_multiply(columns[l] as Vector3, signed[l] as number));
        // `Plane(cyl_axis).project(point)`: the point less its component along the axis.
        const projected = op_subtract(point, op_multiply(cylPlane.normal, f32(dot(cylPlane.normal, point) - cylPlane.d)));
        if (!separator.test_axis(normalized(projected))) return;
      }
    }
  }
  const capsuleRecord = capsule as { readonly height: number; readonly radius: number };
  for (let i = 0; i < 2; i += 1) {
    const capsule_axis = op_multiply(capsuleXform.basis.y, f32(capsuleRecord.height * 0.5 - capsuleRecord.radius));
    const sphere_pos = op_add(capsuleXform.origin, i === 0 ? capsule_axis : op_negate(capsule_axis));
    const cnormal = transformXformInv(boxXform, sphere_pos);
    const cpoint = transform(boxXform, vector3(cnormal.x < 0 ? -he.x : he.x, cnormal.y < 0 ? -he.y : he.y, cnormal.z < 0 ? -he.z : he.z));
    const point_axis = normalized(op_subtract(sphere_pos, cpoint));
    if (!separator.test_axis(point_axis)) return;
    for (const column of columns) {
      if (!separator.test_axis(normalized(cross(cross(point_axis, column), column)))) return;
    }
  }
  separator.generate_contacts(collector);
}

/** `_collision_capsule_face` (`godot_collision_solver_3d_sat.cpp:1759`), in world space. */
function capsuleFace(
  capsule: object,
  capsuleXform: Transform3D,
  capsuleMargin: number,
  vertex: readonly [Vector3, Vector3, Vector3],
  backface: boolean,
  collector: Collector,
): void {
  const face: SatShape = {
    project: (axis) => {
      let min = 0;
      let max = 0;
      vertex.forEach((v, i) => {
        const d = dot(axis, v);
        if (i === 0 || d > max) max = d;
        if (i === 0 || d < min) min = d;
      });
      return [min, max];
    },
    supports: (n) => triangleOther(vertex[0], vertex[1], vertex[2], backface).supports(n),
    xform: IDENTITY,
    margin: 0,
  };
  const separator = new SeparatorAxisTest(satShape(capsule, capsuleXform, capsuleMargin), face);
  const normal = normalized(cross(op_subtract(vertex[0], vertex[2]), op_subtract(vertex[0], vertex[1])));
  if (!separator.test_axis(normal)) return;
  const capsuleRecord = capsule as { readonly height: number; readonly radius: number };
  const capsule_axis = op_multiply(capsuleXform.basis.y, f32(capsuleRecord.height * 0.5 - capsuleRecord.radius));
  for (let i = 0; i < 3; i += 1) {
    const edge_axis = op_subtract(vertex[i] as Vector3, vertex[(i + 1) % 3] as Vector3);
    let axis = normalized(cross(edge_axis, capsule_axis));
    if (dot(axis, normal) < 0) axis = op_multiply(axis, -1);
    if (!separator.test_axis(axis)) return;
    let dir_axis = normalized(cross(cross(op_subtract(capsuleXform.origin, vertex[i] as Vector3), capsule_axis), capsule_axis));
    if (dot(dir_axis, normal) < 0) dir_axis = op_multiply(dir_axis, -1);
    if (!separator.test_axis(dir_axis)) return;
    for (let j = 0; j < 2; j += 1) {
      const sphere_pos = op_add(capsuleXform.origin, j === 0 ? capsule_axis : op_negate(capsule_axis));
      let n1 = op_subtract(sphere_pos, vertex[i] as Vector3);
      if (dot(n1, normal) < 0) n1 = op_multiply(n1, -1);
      if (!separator.test_axis(normalized(n1))) return;
      let edge = cross(cross(n1, edge_axis), edge_axis);
      if (dot(edge, normal) < 0) edge = op_multiply(edge, -1);
      if (!separator.test_axis(normalized(edge))) return;
    }
  }
  if (!backface && dot(separator.best_axis, normal) < BACKFACE_NORMAL_THRESHOLD) return;
  separator.generate_contacts(collector);
}

/** `Transform3D::xform_inv` (`core/math/transform_3d.h:184`). */
function transformXformInv(xform: Transform3D, v: Vector3): Vector3 {
  return basisXformInv(xform.basis, op_subtract(v, xform.origin));
}

/**
 * The capsule pairs whose separating-axis test is transcribed (a capsule against a box or a
 * concave shape's triangle), or undefined for any other pair.
 */
function satContacts(body: BodyShape, xformA: Transform3D, other: Other, margin: number): Contact[] | undefined {
  const bodyKind = godot_shape_3d_sat_kind(body.record);
  const collector = new Collector();
  if (other.triangle !== undefined) {
    if (bodyKind !== 'capsule') return undefined;
    capsuleFace(body.record, xformA, margin, other.triangle.vertices, other.triangle.backface, collector);
    return collector.found;
  }
  if (other.record === undefined) return undefined;
  const otherKind = godot_shape_3d_sat_kind(other.record);
  if (bodyKind === 'capsule' && otherKind === 'box') {
    collector.swap = true;
    boxCapsule(other.record, other.xform, 0, body.record, xformA, margin, collector);
    return collector.found;
  }
  if (bodyKind === 'box' && otherKind === 'capsule') {
    boxCapsule(body.record, xformA, margin, other.record, other.xform, 0, collector);
    return collector.found;
  }
  return undefined;
}

/** The radius of a sphere (a shape whose core is a point), scaled as the solver scales it. */
function sphereRadius(record: object, xform: Transform3D): number | undefined {
  const core = godot_shape_3d_core(record);
  if (core === undefined || core.shape.type !== ShapeType.Ball) return undefined;
  return f32(core.radius * length(vector3(xform.basis.x.x, xform.basis.y.x, xform.basis.z.x)));
}

/**
 * A pair with a sphere, which GodotCollisionSolver3D solves analytically (sphere against sphere,
 * box or capsule, `godot_collision_solver_3d_sat.cpp:826`), the sphere as its first shape (the
 * lower shape type): the body's sphere against the other, or the other's sphere against the body
 * with the result swapped back.
 */
function sphereContacts(body: BodyShape, xformA: Transform3D, other: Other, margin: number): Contact[] | undefined {
  if (other.record === undefined) return undefined;
  const collector = new Collector();
  const bodyRadius = sphereRadius(body.record, xformA);
  if (bodyRadius !== undefined) {
    const found = godot_shape_3d_sphere_contact(other.record, other.xform, xformA.origin, bodyRadius, margin, 0);
    if (found === null) return undefined;
    if (found !== undefined) collector.call(found[0], found[1], found[2]);
    return collector.found;
  }
  const otherRadius = sphereRadius(other.record, other.xform);
  if (otherRadius === undefined) return undefined;
  const found = godot_shape_3d_sphere_contact(body.record, xformA, other.xform.origin, otherRadius, 0, margin);
  if (found === null) return undefined;
  collector.swap = true;
  if (found !== undefined) collector.call(found[0], found[1], found[2]);
  return collector.found;
}

/**
 * The contacts of the body's shape grown by `margin` against one other shape, as
 * `SeparatorAxisTest::generate_contacts` builds them (`godot_collision_solver_3d_sat.cpp:703`):
 * each shape's support feature along the separating axis, then the contact points between the
 * two features. The separating axis is Rapier's (the distance query's normal between the body's
 * core, or the whole shape, and the other), taken exactly as the face normal when the contact lies
 * on one face of the other shape, the axis Godot's SAT finds there.
 */
function pairContacts(body: BodyShape, xformA: Transform3D, other: Other, margin: number): Contact[] {
  const analytic = sphereContacts(body, xformA, other, margin) ?? satContacts(body, xformA, other, margin);
  if (analytic !== undefined) return analytic;
  const poseA = godot_collision_object_pose(xformA);
  const core = godot_shape_3d_core(body.record);
  let found = core === undefined ? null : core.shape.contactShape(poseA.translation, poseA.rotation, other.shape, other.pose.translation, other.pose.rotation, f32(core.radius + margin));
  let distance = found === null || core === undefined ? Number.NaN : found.distance - core.radius;
  if (found === null || !(found.distance >= 0)) {
    found = body.shape.contactShape(poseA.translation, poseA.rotation, other.shape, other.pose.translation, other.pose.rotation, margin);
    distance = found === null ? Number.NaN : found.distance;
  }
  if (found === null || !(distance < margin)) return [];
  const rapierAxis = toVector(found.normal2);
  const face = other.face(toVector(found.point2));
  const axis = face === undefined ? rapierAxis : dot(face, rapierAxis) < 0 ? op_negate(face) : face;
  if (!other.accepts(axis)) return [];
  const supportsA = godot_shape_3d_supports(body.record, normalized(basisXformInv(xformA.basis, op_negate(axis))));
  const supportsB = other.supports(normalized(basisXformInv(other.xform.basis, axis)));
  if (supportsA === undefined || supportsB === undefined || supportsA.points.length === 0 || supportsB.points.length === 0) {
    const a = op_subtract(toVector(found.point1), op_multiply(axis, core === undefined ? margin : f32(core.radius + margin)));
    return [{ a, b: toVector(found.point2), normal: axis }];
  }
  const collector = new Collector();
  collector.normal = axis;
  const worldA: ShapeSupports = {
    type: supportsA.type,
    points: supportsA.points.map((p) => op_add(transform(xformA, p), op_multiply(op_negate(axis), margin))),
  };
  const worldB: ShapeSupports = { type: supportsB.type, points: supportsB.points.map((p) => transform(other.xform, p)) };
  contactsFromSupports(worldA, worldB, collector);
  return collector.found;
}

/** `GodotCollisionSolver3D::solve_static` of the grown body shape against a candidate: its contacts. */
function contacts(body: BodyShape, xformA: Transform3D, candidate: Candidate, margin: number): Contact[] {
  const triangles = godot_shape_3d_triangles(candidate.record);
  if (triangles === undefined) return pairContacts(body, xformA, convexOther(candidate), margin);
  const found: Contact[] = [];
  for (const [a, b, c] of triangles.faces) {
    const other = triangleOther(transform(candidate.transform, a), transform(candidate.transform, b), transform(candidate.transform, c), triangles.backface);
    found.push(...pairContacts(body, xformA, other, margin));
  }
  return found;
}

/** `GJK_*` (`modules/godot_physics_3d/gjk_epa.cpp:66`). */
const GJK_MAX_ITERATIONS = 128;
const GJK_ACCURACY = f32(0.0001);
const GJK_MIN_DISTANCE = f32(0.0001);
const GJK_DUPLICATED_EPS = f32(0.0001);

interface SupportVertex {
  readonly d: Vector3;
  readonly w: Vector3;
}

interface Simplex {
  c: SupportVertex[];
  p: number[];
}

/** `GJK::det` (`gjk_epa.cpp:430`). */
function det3(a: Vector3, b: Vector3, c: Vector3): number {
  const t1 = f32(f32(a.y * b.z) * c.x);
  const t2 = f32(f32(a.z * b.x) * c.y);
  const t3 = f32(f32(a.x * b.z) * c.y);
  const t4 = f32(f32(a.y * b.x) * c.z);
  const t5 = f32(f32(a.x * b.y) * c.z);
  const t6 = f32(f32(a.z * b.y) * c.x);
  return f32(f32(f32(f32(f32(t1 + t2) - t3) - t4) + t5) - t6);
}

/** `GJK::projectorigin` of a segment (`gjk_epa.cpp:437`). */
function project2(a: Vector3, b: Vector3, w: number[], m: { v: number }): number {
  const d = op_subtract(b, a);
  const l = length_squared(d);
  if (l > 0) {
    const t = l > 0 ? f32(-dot(a, d) / l) : 0;
    if (t >= 1) {
      w[0] = 0;
      w[1] = 1;
      m.v = 2;
      return length_squared(b);
    }
    if (t <= 0) {
      w[0] = 1;
      w[1] = 0;
      m.v = 1;
      return length_squared(a);
    }
    w[1] = t;
    w[0] = f32(1 - t);
    m.v = 3;
    return length_squared(op_add(a, op_multiply(d, t)));
  }
  return -1;
}

/** `GJK::projectorigin` of a triangle (`gjk_epa.cpp:450`). */
function project3(a: Vector3, b: Vector3, c: Vector3, w: number[], m: { v: number }): number {
  const imd3 = [1, 2, 0];
  const vt = [a, b, c];
  const dl = [op_subtract(a, b), op_subtract(b, c), op_subtract(c, a)];
  const n = cross(dl[0] as Vector3, dl[1] as Vector3);
  const l = length_squared(n);
  if (l > 0) {
    let mindist = -1;
    const subw = [0, 0];
    const subm = { v: 0 };
    for (let i = 0; i < 3; i += 1) {
      if (dot(vt[i] as Vector3, cross(dl[i] as Vector3, n)) > 0) {
        const j = imd3[i] as number;
        const subd = project2(vt[i] as Vector3, vt[j] as Vector3, subw, subm);
        if (mindist < 0 || subd < mindist) {
          mindist = subd;
          m.v = (subm.v & 1 ? 1 << i : 0) + (subm.v & 2 ? 1 << j : 0);
          w[i] = subw[0] as number;
          w[j] = subw[1] as number;
          w[imd3[j] as number] = 0;
        }
      }
    }
    if (mindist < 0) {
      const d = dot(a, n);
      const s = f32(Math.sqrt(l));
      const p = op_multiply(n, f32(d / l));
      mindist = length_squared(p);
      m.v = 7;
      w[0] = f32(length(cross(dl[1] as Vector3, op_subtract(b, p))) / s);
      w[1] = f32(length(cross(dl[2] as Vector3, op_subtract(c, p))) / s);
      w[2] = f32(1 - f32((w[0] as number) + (w[1] as number)));
    }
    return mindist;
  }
  return -1;
}

/** `GJK::projectorigin` of a tetrahedron (`gjk_epa.cpp:491`). */
function project4(a: Vector3, b: Vector3, c: Vector3, d: Vector3, w: number[], m: { v: number }): number {
  const imd3 = [1, 2, 0];
  const vt = [a, b, c, d];
  const dl = [op_subtract(a, d), op_subtract(b, d), op_subtract(c, d)];
  const vl = det3(dl[0] as Vector3, dl[1] as Vector3, dl[2] as Vector3);
  const ng = f32(vl * dot(a, cross(op_subtract(b, c), op_subtract(a, b)))) <= 0;
  if (ng && Math.abs(vl) > 0) {
    let mindist = -1;
    const subw = [0, 0, 0];
    const subm = { v: 0 };
    for (let i = 0; i < 3; i += 1) {
      const j = imd3[i] as number;
      const s = f32(vl * dot(d, cross(dl[i] as Vector3, dl[j] as Vector3)));
      if (s > 0) {
        const subd = project3(vt[i] as Vector3, vt[j] as Vector3, d, subw, subm);
        if (mindist < 0 || subd < mindist) {
          mindist = subd;
          m.v = (subm.v & 1 ? 1 << i : 0) + (subm.v & 2 ? 1 << j : 0) + (subm.v & 4 ? 8 : 0);
          w[i] = subw[0] as number;
          w[j] = subw[1] as number;
          w[imd3[j] as number] = 0;
          w[3] = subw[2] as number;
        }
      }
    }
    if (mindist < 0) {
      mindist = 0;
      m.v = 15;
      w[0] = f32(det3(c, b, d) / vl);
      w[1] = f32(det3(a, c, d) / vl);
      w[2] = f32(det3(b, a, d) / vl);
      w[3] = f32(1 - f32(f32((w[0] as number) + (w[1] as number)) + (w[2] as number)));
    }
    return mindist;
  }
  return -1;
}

/**
 * `GjkEpa2::Distance` (`gjk_epa.cpp:887`) reduced to its answer: whether GJK finds the two shapes
 * separated (`GJK::Evaluate` ends `Valid`, `:225`), over the Minkowski difference `support`.
 */
function gjkSeparated(support: (direction: Vector3) => Vector3, guess: Vector3): boolean {
  const lastw: Vector3[] = [];
  let clastw = 0;
  let alpha = 0;
  let iterations = 0;
  let status: 'valid' | 'inside' | 'failed' = 'valid';
  const getsupport = (d: Vector3): SupportVertex => {
    const dn = op_divide(d, length(d));
    return { d: dn, w: support(dn) };
  };
  const simplices: [Simplex, Simplex] = [
    { c: [], p: [] },
    { c: [], p: [] },
  ];
  let current = 0;
  let ray = guess;
  const sqrl = length_squared(ray);
  simplices[0].c.push(getsupport(sqrl > 0 ? op_negate(ray) : vector3(1, 0, 0)));
  simplices[0].p.push(1);
  ray = (simplices[0].c[0] as SupportVertex).w;
  lastw.push(ray, ray, ray, ray);
  do {
    const next = 1 - current;
    const cs = simplices[current] as Simplex;
    const ns = simplices[next] as Simplex;
    const rl = length(ray);
    if (rl < GJK_MIN_DISTANCE) {
      status = 'inside';
      break;
    }
    cs.c.push(getsupport(op_negate(ray)));
    cs.p.push(0);
    const w = (cs.c[cs.c.length - 1] as SupportVertex).w;
    if (lastw.some((last) => length_squared(op_subtract(w, last)) < GJK_DUPLICATED_EPS)) {
      cs.c.pop();
      cs.p.pop();
      break;
    }
    clastw = (clastw + 1) & 3;
    lastw[clastw] = w;
    const omega = f32(dot(ray, w) / rl);
    alpha = omega > alpha ? omega : alpha;
    if (f32(f32(rl - alpha) - f32(GJK_ACCURACY * rl)) <= 0) {
      cs.c.pop();
      cs.p.pop();
      break;
    }
    const weights = [0, 0, 0, 0];
    const mask = { v: 0 };
    const ws = cs.c.map((vertex) => vertex.w);
    let sqdist = 0;
    if (cs.c.length === 2) sqdist = project2(ws[0] as Vector3, ws[1] as Vector3, weights, mask);
    else if (cs.c.length === 3) sqdist = project3(ws[0] as Vector3, ws[1] as Vector3, ws[2] as Vector3, weights, mask);
    else if (cs.c.length === 4) sqdist = project4(ws[0] as Vector3, ws[1] as Vector3, ws[2] as Vector3, ws[3] as Vector3, weights, mask);
    if (sqdist >= 0) {
      ns.c = [];
      ns.p = [];
      ray = vector3();
      current = next;
      cs.c.forEach((vertex, i) => {
        if (mask.v & (1 << i)) {
          ns.c.push(vertex);
          ns.p.push(weights[i] as number);
          ray = op_add(ray, op_multiply(vertex.w, weights[i] as number));
        }
      });
      if (mask.v === 15) status = 'inside';
    } else {
      cs.c.pop();
      cs.p.pop();
      break;
    }
    iterations += 1;
    if (iterations >= GJK_MAX_ITERATIONS) status = 'failed';
  } while (status === 'valid');
  return status === 'valid';
}

/** A shape's `get_support` placed by a transform, as `MinkowskiDiff::Support0` (`gjk_epa.cpp:136`). */
function placedSupport(support: (direction: Vector3) => Vector3, xform: Transform3D): (direction: Vector3) => Vector3 {
  return (d) => transform(xform, support(normalized(basisXformInv(xform.basis, d))));
}

/**
 * `GodotCollisionSolver3D::solve_distance` (`godot_collision_solver_3d.cpp:518`): false when the
 * body's shape (swept by `motion`, a `GodotMotionShape3D`, when given) touches the candidate;
 * a concave candidate touches when any of its triangles does.
 */
function solveDistance(body: BodyShape, xformA: Transform3D, localMotion: Vector3 | undefined, candidate: Candidate): boolean {
  const shapeSupport = (d: Vector3): Vector3 => godot_shape_3d_support(body.record, d) ?? vector3();
  const moving = localMotion === undefined ? shapeSupport : (d: Vector3): Vector3 => (dot(d, localMotion) > 0 ? op_add(shapeSupport(d), localMotion) : shapeSupport(d));
  const supportA = placedSupport(moving, xformA);
  const triangles = godot_shape_3d_triangles(candidate.record);
  const guess = op_subtract(candidate.transform.origin, xformA.origin);
  if (triangles === undefined) {
    const supportB = placedSupport((d) => godot_shape_3d_support(candidate.record, d) ?? vector3(), candidate.transform);
    return gjkSeparated((d) => op_subtract(supportA(d), supportB(op_negate(d))), guess);
  }
  for (const vertices of triangles.faces) {
    // `GodotFaceShape3D::get_support` (`godot_shape_3d.cpp:1176`).
    const faceSupport = (d: Vector3): Vector3 => {
      let best = 0;
      let max = dot(d, vertices[0]);
      for (let i = 1; i < 3; i += 1) {
        const value = dot(d, vertices[i] as Vector3);
        if (value > max) {
          max = value;
          best = i;
        }
      }
      return vertices[best] as Vector3;
    };
    const supportB = placedSupport(faceSupport, candidate.transform);
    if (!gjkSeparated((d) => op_subtract(supportA(d), supportB(op_negate(d))), guess)) return false;
  }
  return true;
}

interface RestResult {
  len: number;
  contact: Vector3;
  normal: Vector3;
  entity: object;
  shape: number;
  local_shape: number;
}

/** `_rest_cbk_result` (`godot_space_3d.cpp:454`). */
function restCallback(
  rest: { best: RestResult | undefined; others: RestResult[]; count: number; readonly max: number; readonly minDepth: number },
  a: Vector3,
  b: Vector3,
  normal: Vector3,
  source: Omit<RestResult, 'len' | 'contact' | 'normal'>,
): void {
  const len = length(op_subtract(b, a));
  if (len < rest.minDepth) return;
  const bestLen = rest.best?.len ?? 0;
  const isBest = len > bestLen;
  if (rest.max > 1 && rest.count > 0) {
    const previous = rest.count;
    rest.count += 1;
    let index = 0;
    const tested = isBest ? bestLen : len;
    for (; index < previous - 1; index += 1) {
      if (tested > (rest.others[index] as RestResult).len) {
        rest.count -= 1;
        break;
      }
    }
    if (index < rest.max - 1) {
      rest.others[index] = isBest ? (rest.best as RestResult) : { len, contact: b, normal, ...source };
    } else {
      rest.count -= 1;
    }
  } else if (isBest) {
    rest.count = 1;
  }
  if (!isBest) return;
  rest.best = { len, contact: b, normal, ...source };
}

function colliderVelocity(entity: object): Vector3 {
  const state = godot_collision_object_state(entity);
  if (state === undefined) return vector3();
  if (state.kind === 'character') return state.linearVelocity;
  if (state.kind === 'rigid' && state.body !== undefined) {
    const v = state.body.linvel();
    return vector3(v.x, v.y, v.z);
  }
  return vector3();
}

/**
 * Tests moving `body` from `parameters.from` by `parameters.motion`, filling `result`
 * (`GodotPhysicsServer3D::body_test_motion` updates pending shapes first,
 * `godot_physics_server_3d.cpp:946`, then `GodotSpace3D::test_body_motion`).
 *
 * @godot PhysicsServer3D.body_test_motion
 * @source modules/godot_physics_3d/godot_space_3d.cpp:652
 */
export function body_test_motion(body: object, parameters: PhysicsTestMotionParameters3D, result?: PhysicsTestMotionResult3D): boolean {
  godot_collision_objects_update_shapes();
  const state = godot_collision_object_state(body);
  if (result !== undefined) {
    Object.assign(result, { travel: vector3(), remainder: vector3(), collision_depth: 0, collision_safe_fraction: 0, collision_unsafe_fraction: 0, collisions: [], collision_count: 0 });
  }
  const shapes = (state?.colliders ?? []).map((entry, index) => {
    const shape = entry.disabled ? undefined : rapierShape(entry);
    return { entry, index, shape, body: shape === undefined ? undefined : { shape, record: entry.shape } };
  });
  if (!shapes.some((entry) => entry.shape !== undefined)) {
    if (result !== undefined) result.travel = parameters.motion;
    return false;
  }
  const margin = parameters.margin > TEST_MOTION_MARGIN_MIN_VALUE ? parameters.margin : TEST_MOTION_MARGIN_MIN_VALUE;
  const min_contact_depth = f32(margin * TEST_MOTION_MIN_CONTACT_DEPTH_FACTOR);
  const motion = parameters.motion;
  const motion_length = length(motion);
  const others = candidates(body, parameters);
  let body_transform = parameters.from;
  let recovered = false;

  // STEP 1, FREE BODY IF STUCK
  for (let attempts = 4; attempts > 0; attempts -= 1) {
    const found: Contact[] = [];
    for (const { entry, body: bodyShape } of shapes) {
      if (bodyShape === undefined) continue;
      const xform = transform(body_transform, entry.local);
      for (const other of others) found.push(...contacts(bodyShape, xform, other, margin));
    }
    if (found.length === 0) break;
    recovered = true;
    // Every collision priority is 1, so `inv_total_weight` is 1.
    let recover_motion = vector3();
    for (const { a, b } of found) {
      const n = normalized(op_subtract(a, b));
      const d = dot(n, b);
      const depth = f32(dot(n, op_add(a, recover_motion)) - d);
      if (depth > f32(min_contact_depth + CMP_EPSILON)) {
        recover_motion = op_subtract(recover_motion, op_multiply(op_multiply(op_multiply(op_multiply(n, f32(depth - min_contact_depth)), 0.4), 1), 1));
      }
    }
    if (op_equal(recover_motion, vector3())) break;
    body_transform = { basis: body_transform.basis, origin: op_add(body_transform.origin, recover_motion) };
  }

  // STEP 2 ATTEMPT MOTION
  let safe = 1;
  let unsafe = 1;
  let best_shape = -1;
  for (const { entry, index, shape, body: bodyShape } of shapes) {
    if (shape === undefined || bodyShape === undefined) continue;
    const xform = transform(body_transform, entry.local);
    let stuck = false;
    let best_safe = 1;
    let best_unsafe = 1;
    const xform_inv = affine_inverse(xform);
    for (const other of others) {
      // Does it collide if going all the way?
      if (solveDistance(bodyShape, xform, basisMultiply(xform_inv.basis, motion), other)) continue;
      if (!solveDistance(bodyShape, xform, undefined, other)) {
        stuck = true;
        break;
      }
      let low = 0;
      let hi = 1;
      let fraction_coeff = 0.5;
      for (let k = 0; k < 8; k += 1) {
        const fraction = f32(low + f32(f32(hi - low) * fraction_coeff));
        const collided = !solveDistance(bodyShape, xform, basisMultiply(xform_inv.basis, op_multiply(motion, fraction)), other);
        if (collided) {
          hi = fraction;
          fraction_coeff = k === 0 || low > 0 ? 0.5 : 0.25;
        } else {
          low = fraction;
          fraction_coeff = k === 0 || hi < 1 ? 0.5 : 0.75;
        }
      }
      if (low < best_safe) {
        best_safe = low;
        best_unsafe = hi;
      }
    }
    if (stuck) {
      safe = 0;
      unsafe = 0;
      best_shape = index;
      break;
    }
    if (best_safe === 1) continue;
    if (best_safe < safe) {
      safe = best_safe;
      unsafe = best_unsafe;
      best_shape = index;
    }
  }

  let collided = false;
  if ((parameters.recovery_as_collision && recovered) || safe < 1) {
    if (safe >= 1) best_shape = -1;
    const ugt: Transform3D = { basis: body_transform.basis, origin: op_add(body_transform.origin, op_multiply(motion, unsafe)) };
    const rest = {
      best: undefined as RestResult | undefined,
      others: [] as RestResult[],
      count: 0,
      max: parameters.max_collisions,
      minDepth: motion_length < min_contact_depth ? motion_length : min_contact_depth,
    };
    for (const { entry, index, body: bodyShape } of shapes) {
      if (bodyShape === undefined) continue;
      if (best_shape !== -1 && index !== best_shape) continue;
      const xform = transform(ugt, entry.local);
      for (const other of others) {
        for (const pair of contacts(bodyShape, xform, other, margin)) {
          restCallback(rest, pair.a, pair.b, pair.normal, { entity: other.entity, shape: other.index, local_shape: index });
        }
      }
    }
    if (rest.count > 0 && rest.best !== undefined) {
      if (result !== undefined) {
        const collisions: MotionCollision[] = [];
        for (let i = 0; i < rest.count; i += 1) {
          const found = i > 0 ? (rest.others[i - 1] as RestResult) : rest.best;
          collisions.push({
            collider: found.entity,
            collider_id: godot_collision_object_object(found.entity),
            collider_shape: found.shape,
            local_shape: found.local_shape,
            normal: found.normal,
            position: found.contact,
            depth: found.len,
            collider_velocity: colliderVelocity(found.entity),
            collider_angular_velocity: vector3(),
          });
        }
        const travelled = op_multiply(motion, safe);
        result.travel = op_add(travelled, op_subtract(body_transform.origin, parameters.from.origin));
        result.remainder = op_subtract(motion, travelled);
        result.collision_safe_fraction = safe;
        result.collision_unsafe_fraction = unsafe;
        result.collisions = collisions;
        result.collision_count = rest.count;
        result.collision_depth = rest.best.len;
      }
      collided = true;
    }
  }
  if (!collided && result !== undefined) {
    result.travel = op_add(motion, op_subtract(body_transform.origin, parameters.from.origin));
    result.remainder = vector3();
    result.collision_safe_fraction = 1;
    result.collision_unsafe_fraction = 1;
    result.collision_depth = 0;
  }
  return collided;
}

