/**
 * @godot-class PhysicsServer3D
 * @role BINDING
 *
 * Godot 4.7's `PhysicsServer3D` public members this lane uses, bound onto the Rapier world as the
 * web platform's physics (`modules/godot_physics_3d/godot_physics_server_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`). A singleton: no receiver. The Rapier world
 * `world-3d.ts` holds is the space; Rapier answers every geometric question.
 *
 * `body_test_motion` keeps `GodotSpace3D::test_body_motion`'s protocol
 * (`modules/godot_physics_3d/godot_space_3d.cpp:652`): up to four recovery passes pushing the body
 * out of contacts deeper than `margin * 0.05` by 0.4 of each depth, a cast of eight bisection probes
 * keeping the safe and unsafe fractions, and the rest contacts at the unsafe position, in single
 * precision. Its geometry is Rapier's queries: a pair's contact is Rapier's `contactShape` between
 * the body's shape (its core, for a sphere or capsule) grown by the margin and the other; a probe
 * collides when Rapier's `castShape` of the motion to that fraction hits and `contactShape` finds
 * the shapes touching at its time of impact, or `contactShape` finds them touching where the
 * motion ends (Rapier's cast misses some grazing approaches and reports impacts early in proportion
 * to the other shape's size); being stuck is Rapier's `intersectsShape`.
 *
 * Bounded deviation (`rapier-geometry`): contact points, normals and depths are Rapier's single
 * deepest contact, where GodotCollisionSolver3D's SAT gives a manifold and its GJK decides the
 * probes; recovery, safe fractions and the positions and normals that follow differ by Rapier's
 * tolerances (measured per claim). Candidates are the shapes `_cull_aabb_for_body` would admit (not
 * the body, not an area, layer against mask, no collision exception either way) in the reverse of
 * the order the objects entered the world, the order Godot's BVH returned them in the measured
 * scenes (its order also depends on its history).
 */

import type { Shape } from '@dimforge/rapier3d-compat';
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
import { godot_shape_3d_core } from './shape-3d';
import { op_multiply as transform, type Transform3D } from './transform-3d';
import { construct as vector3, dot, length, normalized, op_add, op_equal, op_multiply, op_subtract, type Vector3 } from './vector3';
import { godot_world_3d_direct_state, type PhysicsDirectSpaceState3D, type PhysicsSpace3D } from './world-3d';

const f32 = Math.fround;
/** `(real_t)CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = f32(0.00001);
/** `godot_space_3d.cpp:40`. */
const TEST_MOTION_MARGIN_MIN_VALUE = f32(0.0001);
const TEST_MOTION_MIN_CONTACT_DEPTH_FACTOR = f32(0.05);
/** Rapier's cast returns nothing for a grazing approach at target distance 0; a small one keeps it. */
const CAST_TARGET_DISTANCE = 1e-6;

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
  readonly transform: Transform3D;
}

interface BodyShape {
  readonly shape: Shape;
  readonly record: object;
}

interface Contact {
  readonly a: Vector3;
  readonly b: Vector3;
  readonly normal: Vector3;
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
    other.colliders.forEach((entry: CollisionShapeEntry, index) => {
      if (!entry.inBroadphase || entry.collider === undefined) return;
      found.push({ entity, index, shape: entry.collider.shape, transform: transform(other.transform, entry.local) });
    });
  }
  return found;
}

function toVector(v: { x: number; y: number; z: number }): Vector3 {
  return vector3(v.x, v.y, v.z);
}

/**
 * `solve_static` with the body's shape grown by `margin`, as Rapier's `contactShape` answers it:
 * the point on the grown shape `a`, the point on the other `b`, and the other's normal toward the
 * body. A sphere or capsule is asked about by its core, grown by its radius as well.
 */
function contact(body: BodyShape, xformA: Transform3D, other: Candidate, margin: number): Contact | undefined {
  const poseA = godot_collision_object_pose(xformA);
  const poseB = godot_collision_object_pose(other.transform);
  const core = godot_shape_3d_core(body.record);
  let grow = margin;
  let found = null;
  if (core !== undefined) {
    found = core.shape.contactShape(poseA.translation, poseA.rotation, other.shape, poseB.translation, poseB.rotation, core.radius + margin);
    grow = f32(core.radius + margin);
    // A core already inside the other falls back to the whole shape.
    if (found !== null && found.distance < 0) found = null;
  }
  if (found === null) {
    grow = margin;
    found = body.shape.contactShape(poseA.translation, poseA.rotation, other.shape, poseB.translation, poseB.rotation, margin);
  }
  if (found === null || !(found.distance < grow)) return undefined;
  const normal = toVector(found.normal2);
  return { a: op_subtract(toVector(found.point1), op_multiply(normal, grow)), b: toVector(found.point2), normal };
}

/**
 * Whether the body's shape moved by `motion * fraction` meets the other, `solve_distance` of the
 * motion shape failing (`godot_space_3d.cpp:877`), as Rapier's queries answer it: `castShape` over
 * the motion, its time of impact confirmed by `contactShape` touching (within `CMP_EPSILON`) at
 * that pose, else `contactShape` touching where the motion ends. Rapier's cast misses some grazing
 * approaches and reports impacts early in proportion to the other shape's size (measured over 500
 * drops onto a cuboid: a 0.4 ball up to 0.0065 early at half-extent 20, 0.00015 at half-extent 0.5).
 */
function collides(body: BodyShape, xformA: Transform3D, motion: Vector3, fraction: number, other: Candidate): boolean {
  const poseA = godot_collision_object_pose(xformA);
  const poseB = godot_collision_object_pose(other.transform);
  const step = op_multiply(motion, fraction);
  const cast = body.shape.castShape(
    poseA.translation,
    poseA.rotation,
    { x: step.x, y: step.y, z: step.z },
    other.shape,
    poseB.translation,
    poseB.rotation,
    { x: 0, y: 0, z: 0 },
    CAST_TARGET_DISTANCE,
    1,
    true,
  );
  const touching = (at: Vector3): boolean => {
    const pose = godot_collision_object_pose({ basis: xformA.basis, origin: op_add(xformA.origin, at) });
    const there = body.shape.contactShape(pose.translation, pose.rotation, other.shape, poseB.translation, poseB.rotation, CMP_EPSILON);
    return there !== null && there.distance <= CMP_EPSILON;
  };
  return (cast !== null && touching(op_multiply(step, cast.time_of_impact))) || touching(step);
}

/** Stuck where it stands: Rapier's `intersectsShape`. */
function overlaps(body: BodyShape, xformA: Transform3D, other: Candidate): boolean {
  const poseA = godot_collision_object_pose(xformA);
  const poseB = godot_collision_object_pose(other.transform);
  return body.shape.intersectsShape(poseA.translation, poseA.rotation, other.shape, poseB.translation, poseB.rotation);
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
    const shape = entry.disabled ? undefined : entry.collider?.shape;
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
      for (const other of others) {
        const pair = contact(bodyShape, xform, other, margin);
        if (pair !== undefined) found.push(pair);
      }
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
    for (const other of others) {
      // Does it collide if going all the way?
      if (!collides(bodyShape, xform, motion, 1, other)) continue;
      if (overlaps(bodyShape, xform, other)) {
        stuck = true;
        break;
      }
      let low = 0;
      let hi = 1;
      let fraction_coeff = 0.5;
      for (let k = 0; k < 8; k += 1) {
        const fraction = f32(low + f32(f32(hi - low) * fraction_coeff));
        if (collides(bodyShape, xform, motion, fraction, other)) {
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
        const pair = contact(bodyShape, xform, other, margin);
        if (pair !== undefined) restCallback(rest, pair.a, pair.b, pair.normal, { entity: other.entity, shape: other.index, local_shape: index });
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

