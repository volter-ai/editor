/** Godot 3 KinematicBody2D motion over Rapier 2D's native character controller. */

import RAPIER, { QueryFilterFlags } from '@dimforge/rapier2d-compat';
import type { Container, PointData } from 'pixi.js';
import type { CollisionExceptions } from './collision-exceptions';
import { type CollisionLayers, godotCanCollideWith } from './collision-layers';
import type { GodotTransform2D } from './transform-2d';
import { type Vector2, vec2 } from './vector2';
import type { GodotRid } from './gdscript-builtins';
import { godotObjectInstanceId } from './object';
import { physicsRid2DOf, physicsVelocityAtPoint2D } from './physics-query-2d';

const DEFAULT_SAFE_MARGIN = 0.08;
const DEFAULT_MAX_SLIDES = 4;
const DEFAULT_FLOOR_MAX_ANGLE = 0.785398;

export interface KinematicCollision2D {
  readonly collider: unknown;
  readonly colliderId: bigint;
  readonly colliderRid: GodotRid;
  readonly colliderShape: number;
  readonly localShape: number;
  readonly colliderVelocity: Vector2;
  readonly colliderAngularVelocity: number;
  readonly depth: number;
  readonly normal: Vector2;
  readonly position: Vector2;
  readonly travel: Vector2;
  readonly remainder: Vector2;
}

export interface KinematicBody2D {
  velocity: Vector2;
  upDirection: Vector2;
  floorStopOnSlope: boolean;
  maxSlides: number;
  floorMaxAngle: number;
  motionMode: number;
  safeMargin: number;
  floorSnapLength: number;
  release(): void;
  testMove(from: GodotTransform2D, motion: Readonly<PointData>, infiniteInertia?: boolean): boolean;
  moveAndCollide(
    motion: Readonly<PointData>,
    infiniteInertia?: boolean,
    excludeRaycastShapes?: boolean,
    testOnly?: boolean,
  ): KinematicCollision2D | null;
  moveAndSlide(
    velocity: Readonly<PointData>,
    dt: number,
    upDirection?: Readonly<PointData>,
    stopOnSlope?: boolean,
    maxSlides?: number,
    floorMaxAngle?: number,
    infiniteInertia?: boolean,
  ): Vector2;
  moveAndSlideWithSnap(
    velocity: Readonly<PointData>,
    snap: Readonly<PointData>,
    dt: number,
    upDirection?: Readonly<PointData>,
    stopOnSlope?: boolean,
    maxSlides?: number,
    floorMaxAngle?: number,
    infiniteInertia?: boolean,
  ): Vector2;
  getSlideCount(): number;
  getSlideCollision(index: number): KinematicCollision2D;
  isOnFloor(): boolean;
  isOnWall(): boolean;
  isOnCeiling(): boolean;
  moveAndSlide4(dt: number): boolean;
  moveAndCollide4(
    motion: Readonly<PointData>,
    testOnly?: boolean,
    safeMargin?: number,
    recoveryAsCollision?: boolean,
  ): KinematicCollision2D | null;
  getLastMotion(): Vector2;
  getPositionDelta(): Vector2;
  getRealVelocity(): Vector2;
  getLastSlideCollision(): KinematicCollision2D | null;
  getFloorNormal(): Vector2;
  getWallNormal(): Vector2;
  getPlatformVelocity(): Vector2;
  getPlatformAngularVelocity(): number;
  getGravity(): Vector2;
  applyFloorSnap(): void;
  getFloorAngle(up?: Readonly<Vector2>): number;
  isOnFloorOnly(): boolean;
  isOnWallOnly(): boolean;
  isOnCeilingOnly(): boolean;
}

export interface CreateKinematicBody2DOptions {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  /** Legacy single-shape spelling. New callers should pass every enabled solid shape in authored order. */
  readonly collider?: RAPIER.Collider;
  readonly mask?: number;
  readonly colliders?: readonly {
    readonly collider: RAPIER.Collider;
    readonly mask: number;
    /** Godot CollisionObject2D body-shape index, including gaps left by disabled siblings. */
    readonly localShape: number;
  }[];
  readonly node: Container;
  readonly layers: CollisionLayers;
  readonly resolveCollider: (collider: RAPIER.Collider) => unknown;
  readonly exceptions?: CollisionExceptions;
  readonly safeMargin?: number;
  readonly upDirection?: Readonly<Vector2>;
  readonly floorStopOnSlope?: boolean;
  readonly maxSlides?: number;
  readonly floorMaxAngle?: number;
  readonly motionMode?: number;
  readonly velocity?: Readonly<Vector2>;
  readonly floorSnapLength?: number;
}

export function createKinematicBody2D(options: CreateKinematicBody2DOptions): KinematicBody2D {
  const { world, body, node, layers, resolveCollider, exceptions } = options;
  const shapes: readonly {
    readonly collider: RAPIER.Collider;
    readonly mask: number;
    readonly localShape: number;
  }[] = options.colliders ?? (
    options.collider === undefined || options.mask === undefined
      ? []
      : [{ collider: options.collider, mask: options.mask, localShape: 0 }]
  );
  if (shapes.length === 0) {
    throw new Error('godot-compat: KinematicBody2D requires at least one enabled solid collider.');
  }
  const handles = new Set<number>();
  const localShapes = new Set<number>();
  for (const shape of shapes) {
    if (handles.has(shape.collider.handle)) {
      throw new Error('godot-compat: KinematicBody2D colliders must be unique retained shapes.');
    }
    handles.add(shape.collider.handle);
    if (shape.collider.parent()?.handle !== body.handle) {
      throw new Error('godot-compat: every KinematicBody2D collider must belong to its one retained body.');
    }
    if (!shape.collider.isEnabled() || shape.collider.isSensor()) {
      throw new Error('godot-compat: KinematicBody2D motion accepts only enabled solid colliders.');
    }
    if (!Number.isSafeInteger(shape.localShape) || shape.localShape < 0) {
      throw new Error('godot-compat: KinematicBody2D local-shape indices must be non-negative integers.');
    }
    if (localShapes.has(shape.localShape)) {
      throw new Error('godot-compat: KinematicBody2D local-shape indices must retain unique authored owner identity.');
    }
    localShapes.add(shape.localShape);
  }
  let safeMargin = options.safeMargin ?? DEFAULT_SAFE_MARGIN;
  if (!Number.isFinite(safeMargin) || safeMargin < 0) {
    throw new Error(
      `godot-compat: KinematicBody2D collision/safe_margin must be finite and non-negative; got ${safeMargin}.`,
    );
  }
  const controllers = shapes.map(() => world.createCharacterController(safeMargin));
  const forControllers = (apply: (controller: RAPIER.KinematicCharacterController) => void): void => {
    for (const controller of controllers) apply(controller);
  };
  forControllers((controller) => {
    controller.disableAutostep();
    controller.disableSnapToGround();
    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle(DEFAULT_FLOOR_MAX_ANGLE);
    controller.setMinSlopeSlideAngle(DEFAULT_FLOOR_MAX_ANGLE);
  });
  let slides: KinematicCollision2D[] = [];
  let onFloor = false;
  let onWall = false;
  let onCeiling = false;
  let floorNormal = vec2(0, 0);
  let wallNormal = vec2(0, 0);
  let platformVelocity = vec2(0, 0);
  let platformAngularVelocity = 0;
  const initialVelocity = options.velocity ?? vec2(0, 0);
  assertFiniteVector(initialVelocity, 'CharacterBody2D.velocity');
  let velocity = vec2(initialVelocity.x, initialVelocity.y);
  let upDirection = finiteCharacterUp(options.upDirection ?? vec2(0, -1));
  let floorStopOnSlope = options.floorStopOnSlope ?? true;
  let maxSlides = characterMaxSlides(options.maxSlides ?? DEFAULT_MAX_SLIDES);
  let floorMaxAngle = characterFloorMaxAngle(options.floorMaxAngle ?? DEFAULT_FLOOR_MAX_ANGLE);
  let motionMode = characterMotionMode(options.motionMode ?? 0);
  let floorSnapLength = characterNonNegative(options.floorSnapLength ?? 0, 'floor_snap_length');
  if (floorSnapLength > 0) forControllers((controller) => controller.enableSnapToGround(floorSnapLength));
  let lastMotion = vec2(0, 0);
  let positionDelta = vec2(0, 0);
  let realVelocity = vec2(0, 0);
  let released = false;
  const assertLive = (): void => {
    if (released) {
      throw new Error('godot-compat: KinematicBody2D motion was called after its scene released the Rapier controller.');
    }
  };

  const predicate = (infiniteInertia: boolean, mask: number) => (candidate: RAPIER.Collider): boolean => {
    const owner = candidate.parent();
    if (owner === null) return godotCanCollideWith(layers, candidate, mask);
    if (owner.handle === body.handle) return false;
    if (exceptions?.has(body.handle, owner.handle) === true) return false;
    if (infiniteInertia && owner.isDynamic()) return false;
    return godotCanCollideWith(layers, candidate, mask);
  };

  const solve = (
    motion: Readonly<PointData>,
    infiniteInertia: boolean,
    slide: boolean,
    suppressCompleted: boolean,
  ): { movement: Vector2; collisions: KinematicCollision2D[] } => {
    assertLive();
    assertFiniteVector(motion, 'motion');
    type ShapeResult = { readonly movement: Vector2; readonly collisions: KinematicCollision2D[] };
    const queryShape = (
      shapeIndex: number,
      requested: Readonly<PointData>,
    ): ShapeResult => {
      const shape = shapes[shapeIndex]!;
      const controller = controllers[shapeIndex]!;
      controller.setSlideEnabled(slide);
      controller.computeColliderMovement(
        shape.collider,
        requested,
        QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        predicate(infiniteInertia, shape.mask),
      );
      const movement = controller.computedMovement();
      const collisions: KinematicCollision2D[] = [];
      for (let i = 0; i < controller.numComputedCollisions(); i += 1) {
        const hit = controller.computedCollision(i);
        if (hit === null || hit.collider === null) continue;
        const colliderObject = resolveCollider(hit.collider);
        if ((typeof colliderObject !== 'object' || colliderObject === null) && typeof colliderObject !== 'function') {
          throw new Error('godot-compat: KinematicBody2D collider resolver returned no registered Godot Object.');
        }
        const hitBody = hit.collider.parent();
        let hitShape = 0;
        if (hitBody !== null) {
          for (let index = 0; index < hitBody.numColliders(); index += 1) {
            if (hitBody.collider(index).handle === hit.collider.handle) { hitShape = index; break; }
          }
        }
        const point = vec2(hit.witness1.x, hit.witness1.y);
        collisions.push(Object.freeze({
          collider: colliderObject,
          colliderId: godotObjectInstanceId(colliderObject),
          colliderRid: physicsRid2DOf(hit.collider),
          colliderShape: hitShape,
          localShape: shape.localShape,
          colliderVelocity: physicsVelocityAtPoint2D(hit.collider, point),
          colliderAngularVelocity: hitBody?.angvel() ?? 0,
          depth: 0,
          normal: vec2(hit.normal1.x, hit.normal1.y),
          position: point,
          travel: vec2(hit.translationDeltaApplied.x, hit.translationDeltaApplied.y),
          remainder: vec2(hit.translationDeltaRemaining.x, hit.translationDeltaRemaining.y),
        }));
      }
      return { movement: vec2(movement.x, movement.y), collisions };
    };
    const desiredLengthSquared = motion.x * motion.x + motion.y * motion.y;
    // Rapier's character controller accepts one collider. Narrow the candidate motion through
    // every authored body shape repeatedly until a complete pass leaves it unchanged. This is the
    // compound-body constraint: orthogonal blockers constrain both axes instead of one equal-dot
    // result winning by array order. The stable pass also retains every equal limiting contact.
    let movement = vec2(motion.x, motion.y);
    let collisions: KinematicCollision2D[] = [];
    const retainedConstraints = new Map<number, KinematicCollision2D[]>();
    const maximumPasses = Math.max(4, shapes.length * 8);
    let stable = false;
    for (let pass = 0; pass < maximumPasses; pass += 1) {
      let changed = false;
      const passCollisions: KinematicCollision2D[] = [];
      for (let shapeIndex = 0; shapeIndex < shapes.length; shapeIndex += 1) {
        const result = queryShape(shapeIndex, movement);
        passCollisions.push(...result.collisions);
        if (result.collisions.length > 0) {
          retainedConstraints.set(shapes[shapeIndex]!.localShape, result.collisions);
        }
        if (
          Math.abs(result.movement.x - movement.x) > 1e-7 ||
          Math.abs(result.movement.y - movement.y) > 1e-7
        ) {
          movement = result.movement;
          changed = true;
        }
      }
      if (!changed) {
        const unique = new Map<string, KinematicCollision2D>();
        for (const collision of [...retainedConstraints.values()].flat().concat(passCollisions)) {
          const key = `${collision.localShape}:${collision.colliderRid.id}:${collision.colliderShape}:` +
            `${collision.position.x}:${collision.position.y}:${collision.normal.x}:${collision.normal.y}`;
          if (!unique.has(key)) unique.set(key, collision);
        }
        collisions = [...unique.values()];
        stable = true;
        break;
      }
    }
    if (!stable) {
      throw new Error(
        'godot-compat: multi-shape KinematicBody2D motion did not converge to one compound-safe translation.',
      );
    }
    if (suppressCompleted && desiredLengthSquared === 0 && collisions.length > 0) {
      throw new Error(
        'godot-compat: a zero-motion KinematicBody2D query produced only Rapier recovery ' +
          'contacts. Godot exposes collision_safe_fraction for this edge and Rapier does not; ' +
          'the query refuses rather than reporting a recovery contact as blocked motion.',
      );
    }
    // Godot suppresses the collision object when collision_safe_fraction == 1: the whole requested
    // motion completed even if recovery/manifold bookkeeping saw a contact. Rapier exposes the
    // applied translation, so its projection on the requested motion is the same fraction.
    const completedFraction =
      desiredLengthSquared === 0
        ? 1
        : (movement.x * motion.x + movement.y * motion.y) / desiredLengthSquared;
    return {
      movement,
      collisions: suppressCompleted && completedFraction >= 1 - 1e-6 ? [] : collisions,
    };
  };

  const applyMovement = (movement: Readonly<PointData>): void => {
    const at = body.translation();
    const target = { x: at.x + movement.x, y: at.y + movement.y };
    // Godot applies motion immediately. Keeping Rapier's current pose current matters when one
    // `_physics_process` issues multiple move calls: the second sweep must start at the first
    // call's result, not at the position from the previous world step.
    body.setTranslation(target, false);
    body.setNextKinematicTranslation(target);
    // Godot mutates the CanvasItem transform inside the motion call; Rapier's next translation
    // lands at world.step, so the retained Pixi entity must be current for the following statement.
    const local = node.parent?.toLocal(target) ?? target;
    node.position.set(local.x, local.y);
  };

  const classify = (up: Readonly<PointData> | undefined, floorAngle: number): void => {
    onFloor = false;
    onWall = false;
    onCeiling = false;
    floorNormal = vec2(0, 0);
    wallNormal = vec2(0, 0);
    platformVelocity = vec2(0, 0);
    platformAngularVelocity = 0;
    const length = up === undefined ? 0 : Math.hypot(up.x, up.y);
    if (length === 0) {
      onWall = slides.length > 0;
      const wall = slides[0];
      if (wall !== undefined) wallNormal = vec2(wall.normal.x, wall.normal.y);
      return;
    }
    const ux = (up as PointData).x / length;
    const uy = (up as PointData).y / length;
    const floorDot = Math.cos(floorAngle);
    for (const hit of slides) {
      const nLength = Math.hypot(hit.normal.x, hit.normal.y);
      if (nLength === 0) continue;
      const dot = (hit.normal.x * ux + hit.normal.y * uy) / nLength;
      if (dot >= floorDot) {
        onFloor = true;
        floorNormal = vec2(hit.normal.x, hit.normal.y);
        platformVelocity = vec2(hit.colliderVelocity.x, hit.colliderVelocity.y);
        platformAngularVelocity = hit.colliderAngularVelocity;
      }
      else if (dot <= -floorDot) onCeiling = true;
      else { onWall = true; wallNormal = vec2(hit.normal.x, hit.normal.y); }
    }
  };

  const api: KinematicBody2D = {
    get velocity() { return vec2(velocity.x, velocity.y); },
    set velocity(next: Vector2) { assertFiniteVector(next, 'velocity'); velocity = vec2(next.x, next.y); },
    get upDirection() { return vec2(upDirection.x, upDirection.y); },
    set upDirection(next: Vector2) {
      upDirection = finiteCharacterUp(next);
    },
    get floorStopOnSlope() { return floorStopOnSlope; },
    set floorStopOnSlope(next: boolean) { floorStopOnSlope = next; },
    get maxSlides() { return maxSlides; },
    set maxSlides(next: number) {
      maxSlides = characterMaxSlides(next);
    },
    get floorMaxAngle() { return floorMaxAngle; },
    set floorMaxAngle(next: number) {
      floorMaxAngle = characterFloorMaxAngle(next);
    },
    get motionMode() { return motionMode; },
    set motionMode(next: number) {
      motionMode = characterMotionMode(next);
    },
    get safeMargin() { return safeMargin; },
    set safeMargin(next: number) {
      safeMargin = characterNonNegative(next, 'safe_margin');
      forControllers((controller) => controller.setOffset(safeMargin));
    },
    get floorSnapLength() { return floorSnapLength; },
    set floorSnapLength(next: number) {
      floorSnapLength = characterNonNegative(next, 'floor_snap_length');
      if (floorSnapLength === 0) forControllers((controller) => controller.disableSnapToGround());
      else forControllers((controller) => controller.enableSnapToGround(floorSnapLength));
    },
    release(): void {
      if (released) return;
      released = true;
      for (const controller of controllers) world.removeCharacterController(controller);
    },
    testMove(from, motion, infiniteInertia = true): boolean {
      assertLive();
      assertRigidTestTransform(from);
      const oldTranslation = body.translation();
      const oldRotation = body.rotation();
      const oldNextTranslation = body.nextTranslation();
      const oldNextRotation = body.nextRotation();
      body.setTranslation(from.origin, false);
      body.setRotation(Math.atan2(from.x.y, from.x.x), false);
      try {
        return solve(motion, infiniteInertia, false, true).collisions.length > 0;
      } finally {
        body.setTranslation(oldTranslation, false);
        body.setRotation(oldRotation, false);
        body.setNextKinematicTranslation(oldNextTranslation);
        body.setNextKinematicRotation(oldNextRotation);
      }
    },

    moveAndCollide(motion, infiniteInertia = true, excludeRaycastShapes = true, testOnly = false) {
      assertLive();
      if (!excludeRaycastShapes) {
        throw new Error(
          'godot-compat: KinematicBody2D.move_and_collide(exclude_raycast_shapes=false) is not ' +
            'representable: Rapier 2D has no raycast-only collision-shape category.',
        );
      }
      const result = solve(motion, infiniteInertia, false, true);
      if (!testOnly) applyMovement(result.movement);
      return result.collisions[0] ?? null;
    },

    moveAndSlide(
      velocity,
      dt,
      upDirection,
      stopOnSlope = false,
      maxSlides = DEFAULT_MAX_SLIDES,
      floorMaxAngle = DEFAULT_FLOOR_MAX_ANGLE,
      infiniteInertia = true,
    ): Vector2 {
      assertLive();
      if (!Number.isFinite(dt) || dt < 0) {
        throw new Error(`godot-compat: KinematicBody2D.move_and_slide delta must be finite and non-negative; got ${dt}.`);
      }
      assertFiniteVector(velocity, 'linear_velocity');
      if (upDirection !== undefined) assertFiniteVector(upDirection, 'up_direction');
      if (!Number.isFinite(floorMaxAngle) || floorMaxAngle < 0 || floorMaxAngle > Math.PI / 2) {
        throw new Error(
          `godot-compat: KinematicBody2D.move_and_slide floor_max_angle must be finite in [0, PI/2] ` +
            `for Rapier's slope controller; got ${floorMaxAngle}. Godot accepts steeper values, ` +
            'which this backend cannot represent exactly.',
        );
      }
      if (maxSlides !== DEFAULT_MAX_SLIDES) {
        throw new Error(
          `godot-compat: KinematicBody2D.move_and_slide(max_slides=${maxSlides}) is not ` +
            'representable: Rapier KinematicCharacterController exposes no iteration cap.',
        );
      }
      const upLength =
        upDirection === undefined ? 0 : Math.hypot(upDirection.x, upDirection.y);
      if (upLength === 0) {
        // Rapier normalizes `up`, so Vector2.ZERO is invalid. Godot's zero-up mode classifies every
        // contact as wall and performs ordinary slide; a nonzero internal axis with all slope
        // thresholds opened keeps Rapier's solver out of floor-specific decisions.
        forControllers((controller) => controller.setUp({ x: 0, y: -1 }));
        // A zero climb angle prevents the arbitrary internal axis from making any wall climbable;
        // PI/2 is Rapier's declared upper slope domain and disables automatic slope descent. The
        // controller's ordinary contact slide remains enabled independently below.
        forControllers((controller) => {
          controller.setMaxSlopeClimbAngle(0);
          controller.setMinSlopeSlideAngle(Math.PI / 2);
        });
      } else {
        forControllers((controller) => {
          controller.setUp(upDirection as PointData);
          controller.setMaxSlopeClimbAngle(floorMaxAngle);
          controller.setMinSlopeSlideAngle(floorMaxAngle);
        });
      }
      const result = solve(
        { x: velocity.x * dt, y: velocity.y * dt },
        infiniteInertia,
        true,
        false,
      );
      slides = result.collisions;
      classify(upDirection, floorMaxAngle);
      applyMovement(result.movement);
      positionDelta = vec2(result.movement.x, result.movement.y);
      lastMotion = slides.length > 0
        ? vec2(slides[slides.length - 1]!.travel.x, slides[slides.length - 1]!.travel.y)
        : vec2(result.movement.x, result.movement.y);
      realVelocity = dt === 0 ? vec2(0, 0) : vec2(result.movement.x / dt, result.movement.y / dt);
      let slid = vec2(velocity.x, velocity.y);
      for (const hit of slides) {
        const into = slid.x * hit.normal.x + slid.y * hit.normal.y;
        if (into < 0) slid = vec2(slid.x - hit.normal.x * into, slid.y - hit.normal.y * into);
      }
      if (stopOnSlope && onFloor && upLength > 0 && upDirection !== undefined) {
        const ux = upDirection.x / upLength;
        const uy = upDirection.y / upLength;
        const floorDot = Math.cos(floorMaxAngle);
        for (const hit of slides) {
          const normalLength = Math.hypot(hit.normal.x, hit.normal.y);
          if (normalLength === 0) continue;
          const nx = hit.normal.x / normalLength;
          const ny = hit.normal.y / normalLength;
          if (nx * ux + ny * uy < floorDot) continue;
          let tx = -ny;
          let ty = nx;
          if (tx * ux + ty * uy > 0) { tx = -tx; ty = -ty; }
          const downhill = slid.x * tx + slid.y * ty;
          if (downhill > 0) slid = vec2(slid.x - tx * downhill, slid.y - ty * downhill);
        }
      }
      return slid;
    },

    moveAndSlideWithSnap(
      requestedVelocity,
      snap,
      dt,
      requestedUp = vec2(0, -1),
      stopOnSlope = false,
      requestedMaxSlides = DEFAULT_MAX_SLIDES,
      requestedFloorMaxAngle = DEFAULT_FLOOR_MAX_ANGLE,
      infiniteInertia = true,
    ): Vector2 {
      assertFiniteVector(snap, 'snap');
      assertFiniteVector(requestedUp, 'up_direction');
      const snapLength = Math.hypot(snap.x, snap.y);
      const upLength = Math.hypot(requestedUp.x, requestedUp.y);
      if (snapLength > 0 && upLength === 0) {
        throw new Error('godot-compat: KinematicBody2D.move_and_slide_with_snap needs a nonzero up_direction when snap is nonzero.');
      }
      if (snapLength > 0) {
        const alignment =
          (snap.x * requestedUp.x + snap.y * requestedUp.y) / (snapLength * upLength);
        if (Math.abs(alignment + 1) > 1e-5) {
          throw new Error(
            'godot-compat: KinematicBody2D.move_and_slide_with_snap requires snap opposite ' +
              "up_direction because Rapier's native snap-to-ground follows the controller up axis.",
          );
        }
      }
      const retainedSnap = floorSnapLength;
      try {
        floorSnapLength = snapLength;
        if (snapLength === 0) forControllers((controller) => controller.disableSnapToGround());
        else forControllers((controller) => controller.enableSnapToGround(snapLength));
        return api.moveAndSlide(
          requestedVelocity,
          dt,
          requestedUp,
          stopOnSlope,
          requestedMaxSlides,
          requestedFloorMaxAngle,
          infiniteInertia,
        );
      } finally {
        floorSnapLength = retainedSnap;
        if (retainedSnap === 0) forControllers((controller) => controller.disableSnapToGround());
        else forControllers((controller) => controller.enableSnapToGround(retainedSnap));
      }
    },

    getSlideCount: () => {
      assertLive();
      return slides.length;
    },
    getSlideCollision(index): KinematicCollision2D {
      assertLive();
      const hit = slides[index];
      if (hit === undefined) {
        throw new Error(
          `godot-compat: get_slide_collision(${index}) is outside the last motion's ${slides.length} collision(s).`,
        );
      }
      return hit;
    },
    isOnFloor: () => {
      assertLive();
      return onFloor;
    },
    isOnWall: () => {
      assertLive();
      return onWall;
    },
    isOnCeiling: () => {
      assertLive();
      return onCeiling;
    },
    moveAndSlide4(dt): boolean {
      if (maxSlides !== DEFAULT_MAX_SLIDES) {
        throw new Error(`godot-compat: CharacterBody2D.max_slides=${maxSlides} is not representable because Rapier exposes no iteration cap.`);
      }
      velocity = api.moveAndSlide(
        velocity,
        dt,
        motionMode === 0 ? upDirection : undefined,
        motionMode === 0 && floorStopOnSlope,
        maxSlides,
        floorMaxAngle,
        false,
      );
      return slides.length > 0;
    },
    moveAndCollide4(motion, testOnly = false, requestedMargin = safeMargin, recoveryAsCollision = false) {
      if (requestedMargin !== safeMargin) {
        throw new Error(`godot-compat: CharacterBody2D.move_and_collide safe_margin=${requestedMargin} cannot change Rapier's retained controller offset ${safeMargin} for one call.`);
      }
      const result = solve(motion, false, false, !recoveryAsCollision);
      if (!testOnly) applyMovement(result.movement);
      positionDelta = vec2(result.movement.x, result.movement.y);
      lastMotion = vec2(result.movement.x, result.movement.y);
      return result.collisions[0] ?? null;
    },
    getLastMotion: () => vec2(lastMotion.x, lastMotion.y),
    getPositionDelta: () => vec2(positionDelta.x, positionDelta.y),
    getRealVelocity: () => vec2(realVelocity.x, realVelocity.y),
    getLastSlideCollision: () => slides[slides.length - 1] ?? null,
    getFloorNormal: () => vec2(floorNormal.x, floorNormal.y),
    getWallNormal: () => vec2(wallNormal.x, wallNormal.y),
    getPlatformVelocity: () => vec2(platformVelocity.x, platformVelocity.y),
    getPlatformAngularVelocity: () => platformAngularVelocity,
    getGravity: () => vec2(world.gravity.x, world.gravity.y),
    applyFloorSnap(): void {
      assertLive();
      if (floorSnapLength === 0 || motionMode !== 0) return;
      const upLength = Math.hypot(upDirection.x, upDirection.y);
      if (upLength === 0) return;
      forControllers((controller) => {
        controller.setUp(upDirection);
        controller.enableSnapToGround(floorSnapLength);
      });
      const result = solve(vec2(0, 0), false, true, false);
      slides = result.collisions;
      classify(upDirection, floorMaxAngle);
      if (!onFloor) return;
      applyMovement(result.movement);
      positionDelta = vec2(result.movement.x, result.movement.y);
      lastMotion = vec2(result.movement.x, result.movement.y);
    },
    getFloorAngle(requestedUp = upDirection): number {
      const upLength = Math.hypot(requestedUp.x, requestedUp.y);
      const normalLength = Math.hypot(floorNormal.x, floorNormal.y);
      if (upLength === 0 || normalLength === 0) return 0;
      const cosine = (requestedUp.x * floorNormal.x + requestedUp.y * floorNormal.y) / (upLength * normalLength);
      return Math.acos(Math.max(-1, Math.min(1, cosine)));
    },
    isOnFloorOnly: () => onFloor && !onWall && !onCeiling,
    isOnWallOnly: () => onWall && !onFloor && !onCeiling,
    isOnCeilingOnly: () => onCeiling && !onFloor && !onWall,
  };
  return api;
}

function assertRigidTestTransform(value: GodotTransform2D): void {
  assertFiniteVector(value.x, 'test_move(from).x');
  assertFiniteVector(value.y, 'test_move(from).y');
  const sx = Math.hypot(value.x.x, value.x.y);
  const sy = Math.hypot(value.y.x, value.y.y);
  const orthogonal = Math.abs(value.x.x * value.y.x + value.x.y * value.y.y) <= 1e-6;
  const determinant = value.x.x * value.y.y - value.x.y * value.y.x;
  if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6 || !orthogonal || determinant <= 0) {
    throw new Error(
      'godot-compat: KinematicBody2D.test_move(from) received a scaled/skewed/reflected Transform2D; ' +
        'Rapier character motion cannot change the collider shape for one query.',
    );
  }
  assertFiniteVector(value.origin, 'test_move(from).origin');
}

function assertFiniteVector(value: Readonly<PointData>, name: string): void {
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new Error(
      `godot-compat: KinematicBody2D ${name} must contain finite coordinates; got (${value.x}, ${value.y}).`,
    );
  }
}

function finiteCharacterUp(value: Readonly<Vector2>): Vector2 {
  assertFiniteVector(value, 'up_direction');
  if (Math.hypot(value.x, value.y) === 0) throw new Error('godot-compat: CharacterBody2D.up_direction cannot be Vector2.ZERO.');
  return vec2(value.x, value.y);
}

function characterMaxSlides(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error('godot-compat: CharacterBody2D.max_slides must be at least 1.');
  return value;
}

function characterFloorMaxAngle(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Math.PI / 2) throw new Error('godot-compat: CharacterBody2D.floor_max_angle must be in [0, PI/2].');
  return value;
}

function characterMotionMode(value: number): number {
  if (!Number.isInteger(value) || (value !== 0 && value !== 1)) throw new Error('godot-compat: CharacterBody2D.motion_mode must be grounded (0) or floating (1).');
  return value;
}

function characterNonNegative(value: number, member: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`godot-compat: CharacterBody2D.${member} must be finite and non-negative.`);
  return value;
}
