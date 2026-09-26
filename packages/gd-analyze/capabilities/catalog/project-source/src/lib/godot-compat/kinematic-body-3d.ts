/**
 * `KinematicBody.move_and_slide` and the slide-collision list it produces —
 * over Rapier 3D's own `KinematicCharacterController`.
 *
 * This is the biggest single member in the 3D requisition and the one with the
 * most room to be faked, so the mapping is stated call for call:
 *
 * | Godot | Rapier 3D | what compat does |
 * |---|---|---|
 * | `move_and_slide(v, up)` | `computeColliderMovement` + `computedMovement()` | multiplies by `dt`, applies the corrected translation, returns the INPUT velocity slid against every contact normal — see the measurement below |
 * | an `Area` is not a body and never blocks motion | sensors are swept like anything else | {@link EXCLUDE_SENSORS} on every sweep |
 * | `infinite_inertia = true` (the default) hides DYNAMIC bodies from the motion test | Rapier sweeps every collider | {@link CreateKinematicBodyOptions.sweepFilter}'s predicate — see the measurement below |
 * | `add_collision_exception_with` is honoured by the motion test, not just the solver | Rapier's `filterContactPair` hook runs at `step`, never at a query | the same predicate, over the port's `CollisionExceptions` |
 * | the motion test culls by the MOVER's `collision_mask` alone (`godot_space_3d.cpp`:632) | `InteractionGroups`, an AND of two directions | the same predicate again, over the world's layer registry (`collision-layers.ts`) |
 * | `is_on_floor()` | `computedGrounded()` | nothing — Rapier's ground detection IS the same question |
 * | `is_on_ceiling()` | last `computedCollision` normals | the same list `get_slide_collision` walks; a ceiling is a normal within `floor_max_angle` of `-up` |
 * | `get_slide_count()` | `numComputedCollisions()` | nothing |
 * | `get_slide_collision(i)` | `computedCollision(i)` | a `KinematicCollision` view: the port's node for `collider`, `normal1` for `normal` |
 *
 * ## `move_and_slide` returns the INPUT velocity SLID, not the velocity achieved (measured)
 *
 * This file used to claim the opposite — that the achieved velocity IS what Godot returns — and it
 * was wrong. Ground truth, traced in the real Godot 3.6.stable.official.de2f0f147 macOS binary on a
 * KinematicBody with a 0.5-extent box driven into a StaticBody wall (probe prints the input, the
 * return value, and `(position after - position before) / delta` on the SAME frame):
 *
 * ```
 * diagonal into a wall, contact PART-WAY through the frame:
 *   in=(10.00000,0.00000,10.00000) ret=(-0.00006,0.00007,9.99994) ach=(2.93997,0.00004,9.99996)
 *   n0=(-1.00000,0.00001,-0.00001) travel=(0.04900,0,0.09000) remainder=(0.07667,0,0.07667)
 * head-on into the same wall:
 *   in=(10.00000,0.00000,0.00000) ret=(0.00000,0.00000,0.00000) ach=(2.93999,0.00000,0.00000)
 * the LANDING frame, running in +z with gravity:
 *   in=(0.00000,-2.56667,6.00000) ret=(0.00001,-0.00009,6.00004) ach=(0.00000,-2.10667,6.00001)
 *   n0=(0.00000,1.00000,0.00001)
 * ```
 *
 * `ret` is `in` slid against the contact normal (`v - n * v.dot(n)`) EXACTLY — the blocked component
 * is scrubbed to zero and the free component keeps its full input magnitude. `ach` is a different
 * number on every frame that touches anything, because the character spends part of the frame
 * travelling INTO the obstacle before the remainder is projected: 2.94 u/s of into-wall velocity, and
 * 2.11 u/s of downward velocity on the landing frame, that Godot has already zeroed.
 *
 * That gap is not cosmetic, because `Player.gd:47` is `velocity = move_and_slide(velocity, …)`. A
 * character standing on the floor under `[physics] 3d/default_gravity = 14` gets `velocity.y = 0`
 * from Godot every frame and re-accelerates from rest; the achieved-velocity port handed back
 * −2.11 and then added another −0.23 on top of it, so the port's grounded character carries a fall
 * speed the real engine resets on contact. Godot 3.6's `KinematicBody::move_and_slide` is the
 * matching source: `body_velocity` starts as `p_linear_velocity` and every iteration does
 * `body_velocity = body_velocity.slide(collision.normal)`, then `return body_velocity` — the achieved
 * translation never enters it.
 *
 * So the slide is reproduced here over Rapier's reported contact normals rather than divided out of
 * `computedMovement()`. Godot slides against the normals of the collisions ITS loop processed
 * (`max_slides`, default 4, refused at any other value below); this slides against every normal
 * Rapier's controller reports, which is the same set for the same reason — a normal is reported
 * exactly when the sweep was stopped by it — and sliding twice against one normal is idempotent.
 *
 * ## The sensor row is the load-bearing one, and it is the same fact `physics-space-3d.ts` records
 *
 * Godot's `Area` is a MONITORING volume: it has no body in the physics solver, and a
 * `KinematicBody`'s motion test — `body_test_motion`, which is all `move_and_slide` is — asks the
 * space about BODIES. Walking through an `Area` is the entire point of one. Rapier draws no such
 * line: an `Area`'s translated collider is a Rapier SENSOR, and a query with the default filter
 * sweeps sensors exactly like walls. `physics-space-3d.ts` already records this for `intersect_ray`
 * (`collide_with_areas` defaults FALSE, and without its predicate a follow camera slams onto the
 * player every time a coin crosses its sight line); this is the same class fact on the sweep.
 *
 * What it costs when it is missed is not "the character brushes an invisible wall" — it is total,
 * permanent inertia, because Rapier's controller does not merely stop at a sensor face, it FAILS TO
 * CONVERGE against one. Measured on `platformer-3d`, whose `stage.tscn` authors three reverb zones
 * as `Area`s (`SoundArea1` is a 11.128 x 10.0961 x 18.0951 box with `reverb_bus_enable = true`, and
 * the player SPAWNS inside it): a character standing against a real GridMap wall INSIDE that zone
 * gets a sweep whose 20 reported collisions alternate between the wall trimesh and the sensor face
 * with opposing normals, every one at `toi = 0`, the controller's per-iteration normal nudge flips
 * the remaining translation by +-1e-4 forever, and `computedMovement()` comes back EXACTLY `(0,0,0)`
 * — including the components nothing obstructs (the same pose, swept downward alone, falls its full
 * desired distance with zero collisions). The script then assigns that zero back to its own
 * `velocity`, so the next step re-accelerates from rest by one `ACCEL * delta` and is zeroed again:
 * the character stops walking, stops falling and never recovers. With the flag the same sweep at the
 * same pose returns the whole desired translation and reports zero collisions.
 *
 * ## `infinite_inertia = true` hides DYNAMIC bodies from the sweep, and it is the DEFAULT (measured)
 *
 * `move_and_slide`'s fourth argument defaults to `true`, and Godot's `SpaceSW::test_body_motion`
 * reads it by SKIPPING every intersecting body in `BODY_MODE_RIGID`/`BODY_MODE_CHARACTER` — the
 * character does not collide with a dynamic body at all, it walks through where the body is and the
 * SOLVER shoves the body out on its own step. Measured in the same binary: a 0.5-extent
 * KinematicBody driven at `(6, 0, 0)` into a `RigidBody` box sitting squarely in its path —
 *
 * ```
 * f=1 ret=(6.0000,-0.0000,-0.0000) slides=1 charX=0.1500 mobX=1.0000   n0=(0,1,0) StaticBody
 * f=2 ret=(6.0000, 0.0000, 0.0000) slides=0 charX=0.2500 mobX=1.0600
 * ...
 * f=11 ret=(6.0000, 0.0000, 0.0000) slides=0 charX=1.1500 mobX=2.0388
 * ```
 *
 * — the character never slows (0.1 units per frame throughout, exactly `6 * 1/60`), the RigidBody is
 * NEVER in the slide list, and it is pushed from x=1.0 to x=2.04. Rapier's controller draws no such
 * line: without a predicate it stops the character dead on the dynamic body, so a ported game's
 * enemies read as walls.
 *
 * Collision EXCEPTIONS are the same class of fact on the same query. `physics-body-3d.ts`'s
 * `addCollisionExceptionWith` arms Rapier's `filterContactPair` hook, which runs at `world.step` and
 * is NEVER consulted by a shape query — so `player.gd:121`'s `bullet.add_collision_exception_with(self)`
 * suppresses the bullet↔shooter CONTACT while leaving the shooter's own next sweep blocked by its own
 * bullet for the frame before the bullet clears the muzzle.
 *
 * Both are one `filterPredicate` on the sweep ({@link CreateKinematicBodyOptions.sweepFilter}) —
 * Rapier's own `computeColliderMovement` parameter, which the port already had and nothing passed.
 *
 * ## Why the port supplies the objects, and the node behind a collider
 *
 * Godot's `KinematicBody` is ONE object that is simultaneously a node in the
 * scene tree, a body in the physics world and a collision shape. Here those are
 * three objects with two owners — the `Object3D` in the scene, the rigid body
 * and collider in the Rapier world — and there is no link from one to the other
 * to follow. `physics-2d.ts` records the same refusal for `RigidBody2D`, and it
 * is the same refusal here for the same reason: a registry mapping colliders to
 * nodes, kept in sync by somebody, is the machinery this capability exists
 * without.
 *
 * That bites hardest on `collision.collider`. `Player.gd:56` reads
 * `collision.collider.is_in_group("mob")` and `:59` calls `mob.squash()` — both
 * of which want the GAME's object, not a Rapier handle. So the port passes
 * {@link CreateKinematicBodyOptions.resolveCollider}, which it can write
 * trivially (its own spawn code created both halves) and compat could only
 * guess at.
 *
 * ## `dt` is an argument because compat owns no clock
 *
 * Godot's `move_and_slide` takes a velocity in units per SECOND and multiplies
 * by the physics delta internally. Rapier's controller takes a TRANSLATION. So
 * the frame's `dt` has to come from somewhere, and this capability's standing
 * answer is that the caller drives time (`tree.tick(dt)`,
 * `advanceAnimation(sprite, dt)`): a `move_and_slide` that reached for a clock
 * of its own would put a ported game on a second, undeterministic timeline.
 *
 * ## Godot's other four arguments are Rapier CONTROLLER configuration
 *
 * `stop_on_slope`, `max_slides`, `floor_max_angle` and `infinite_inertia` are
 * per-call in Godot and per-controller in Rapier (`setSlideEnabled`,
 * `setMaxSlopeClimbAngle`, …), and `max_slides` has no Rapier counterpart at
 * all — its solver iterates internally and does not expose a cap. A non-default
 * value therefore THROWS naming the Rapier call to make instead of being
 * silently absorbed, which is the difference between a refusal and a lookalike.
 * The measured fixture passes neither: `Player.gd:47` is
 * `move_and_slide(velocity, Vector3.UP)` and `Mob.gd:16` is
 * `move_and_slide(velocity)`.
 *
 * ## Resource ownership
 *
 * **Owns:** nothing but the three references the port handed it. **Shares:** the
 * controller, the body and the collider, all the port's. **Teardown:** none —
 * nothing is registered and nothing is subscribed.
 */

import { QueryFilterFlags, RigidBodyDesc, type Collider } from '@dimforge/rapier3d-compat';
import type { Vector3Like } from 'three';
import {
  depenetrateKinematicSpawn,
  type KinematicSpawnWorld,
} from '../character/spawn-depenetration';
import { type AreaMonitoring3D, isMonitoring3D } from './area-3d';
import { type CollisionLayers, godotCanCollideWith } from './collision-layers';
import type { GodotColliderLookup, GodotColliderOwner } from './collider-registry';
import { VECTOR3_ZERO, type Vector3, vec3 } from './variant-3d';

/**
 * `QueryFilterFlags.EXCLUDE_SENSORS` — Rapier's own enum member, not a transcribed number. Every
 * query this module poses is a Godot BODY motion test, and a Godot `Area` is not a body — see this
 * module's header for the measurement.
 *
 * This file already imports `@dimforge/rapier3d-compat` as a VALUE (`RigidBodyDesc`, above), and
 * the catalog entry declares that dependency, so reading the flag off the library costs no extra
 * module load and cannot drift from it. `collision-layers.ts` inlines its bit instead because that
 * file compiles for BOTH the 2D and the 3D surface and may name neither package.
 */
const EXCLUDE_SENSORS = QueryFilterFlags.EXCLUDE_SENSORS;

/** The half of a Rapier 3D `CharacterCollision` this file reads. Rapier's own
 *  class satisfies it. */
export interface CharacterCollisionLike {
  /** The obstacle's collider, or `null` if it has left the world. */
  readonly collider: Collider | null;
  /** World-space outward contact normal ON THE OBSTACLE — which is what Godot's
   *  `KinematicCollision.normal` means, so nothing is flipped. */
  readonly normal1: Vector3Like;
}

interface RetainedCharacterCollision extends CharacterCollisionLike {
  readonly collider: Collider | null;
  readonly normal1: Vector3;
}

/** The half of a Rapier 3D `KinematicCharacterController` this file drives.
 *  Rapier's own class satisfies it — `filterGroups` is Rapier's own
 *  `computeColliderMovement` parameter, widened in so a caller can carry
 *  Godot's `collision_mask` onto the sweep (see {@link CreateKinematicBodyOptions.filterGroups}). */
export interface CharacterControllerLike {
  setUp(vector: Vector3Like): void;
  computeColliderMovement(
    collider: object,
    desiredTranslationDelta: Vector3Like,
    filterFlags?: number,
    filterGroups?: number,
    filterPredicate?: (collider: SweptColliderLike) => boolean,
  ): void;
  computedMovement(): Vector3Like;
  computedGrounded(): boolean;
  numComputedCollisions(): number;
  computedCollision(index: number): CharacterCollisionLike | null;
}

/** The half of a Rapier 3D `RigidBody` the sweep predicate INTERROGATES about an obstacle — is it a
 *  dynamic body (invisible to a Godot motion test under `infinite_inertia`), and is it excepted from
 *  this character? Rapier's own `RigidBody` satisfies it, and it is deliberately the same `handle`
 *  `collision-exceptions.ts`'s {@link CollisionExceptions} is keyed by. */
export interface SweptBodyLike {
  readonly handle: number;
  isDynamic(): boolean;
}

/** The half of a Rapier 3D `Collider` the sweep predicate reads — the body it belongs to, or `null`
 *  for a collider with no parent body. Rapier's own `Collider` satisfies it. */
export interface SweptColliderLike {
  parent(): SweptBodyLike | null;
}

/** The half of a Rapier 3D `Collider` {@link floorSnapDrop} casts — its shape and where it is.
 *  Rapier's own `Collider` satisfies it. */
export interface SnapProbeColliderLike {
  readonly shape: object;
  translation(): Vector3Like;
  rotation(): { x: number; y: number; z: number; w: number };
}

/** The half of a Rapier 3D `World` {@link floorSnapDrop} queries — one shape cast, the library's
 *  own. Rapier's own `World` satisfies it. */
export interface SnapProbeWorldLike {
  castShape(
    shapePos: Vector3Like,
    shapeRot: { x: number; y: number; z: number; w: number },
    shapeVel: Vector3Like,
    shape: object,
    targetDistance: number,
    maxToi: number,
    stopAtPenetration: boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: object,
    filterExcludeRigidBody?: object,
    filterPredicate?: (collider: SweptColliderLike) => boolean,
  ): { readonly time_of_impact: number; readonly normal1: Vector3Like } | null;
  /**
   * Rapier's own `castRayAndGetNormal` — the FACE-normal probe {@link createKinematicBody}'s
   * slide correction uses (see the comment at its call site). Optional and structural: Rapier's
   * `World` satisfies it (its implementation reads `ray.origin`/`ray.dir` as plain vectors), and
   * a test fake without it simply degrades to the controller's reported contact normal.
   */
  castRayAndGetNormal?(
    ray: { readonly origin: Vector3Like; readonly dir: Vector3Like },
    maxToi: number,
    solid: boolean,
    filterFlags?: number,
    filterGroups?: number,
    filterExcludeCollider?: object,
    filterExcludeRigidBody?: object,
    filterPredicate?: (collider: SweptColliderLike) => boolean,
  ): { readonly normal: Vector3Like } | null;
}

/** The half of a Rapier 3D kinematic `RigidBody` this file moves. Rapier's own
 *  class satisfies it. */
export interface KinematicRigidBodyLike {
  translation(): Vector3Like;
  setNextKinematicTranslation(translation: Vector3Like): void;
  /** Godot's `body()` seeding this backend does not — see {@link seedKinematicBody} — place the
   *  body OUTRIGHT rather than moving it kinematically over time. */
  setTranslation(translation: Vector3Like, wakeUp: boolean): void;
}

/** `KinematicCollision` — one entry of the slide list, as a VALUE. */
export interface KinematicCollision {
  /**
   * `collision.collider` — the GAME's object for the thing that was hit, as
   * {@link CreateKinematicBodyOptions.resolveCollider} named it.
   */
  readonly collider: unknown;
  /** `collision.normal` — `Player.gd:58`,
   *  `Vector3.UP.dot(collision.normal) > 0.1`. */
  readonly normal: Vector3;
}

/** Godot's remaining `move_and_slide` arguments, accepted only at their Godot
 *  defaults — see this module's header. */
export interface MoveAndSlideOptions {
  readonly stopOnSlope?: boolean;
  readonly maxSlides?: number;
  readonly floorMaxAngle?: number;
  readonly infiniteInertia?: boolean;
  /** Internal carrier for Godot 3 move_and_slide_with_snap's explicit snap vector. */
  readonly snap?: Vector3Like;
}

/** What {@link createKinematicBody} needs from the port. */
export interface CreateKinematicBodyOptions {
  /** The port's own `KinematicCharacterController`. */
  readonly controller: ConfigurableCharacterController;
  /** The kinematic rigid body this character moves. */
  readonly body: KinematicRigidBodyLike;
  /** The collider the controller sweeps. */
  readonly collider: Collider;
  /**
   * A Rapier collider -> the game object a script expects on
   * `collision.collider`. The port already holds both halves; see this
   * module's header.
   */
  readonly resolveCollider: (collider: Collider) => unknown;
  /**
   * Godot's own `collision_mask` for this body, as the plain number the `.tscn`
   * declares (Godot's default is `1`).
   *
   * Every `computeColliderMovement` sweep is filtered by it the way Godot's own
   * motion test is — `GodotSpace3D::_cull_aabb_for_body` keeps a body only when
   * `p_body->collides_with(other)`, i.e. THIS body's mask against the other's
   * layer, one direction (`modules/godot_physics_3d/godot_space_3d.cpp`:632 @
   * 4.4-stable). The test itself is `collision-layers.ts`'s
   * {@link godotCanCollideWith}, over {@link layers}.
   */
  readonly mask: number;
  /** The world's `collision_layer`/`collision_mask` registry — what {@link mask} is tested
   *  against, and the same one the world's contact filter reads. */
  readonly layers: CollisionLayers;
  /**
   * What Godot's `infinite_inertia = true` and its per-body collision-exception list mean ON THE
   * SWEEP — see this module's header for both measurements.
   *
   * Absent means the sweep sees dynamic bodies as walls and ignores exceptions, which is what a
   * translated Godot game never wants, so a port with a shared physics world should always pass it:
   * `{ selfHandle: <this character's rapier body>.handle, exceptions: ctx.exceptions }`.
   * `exceptions` is optional on its own — a project where no script calls
   * `add_collision_exception_with` builds no set — and the dynamic-body half applies either way.
   */
  readonly sweepFilter?: {
    /** This character's OWN Rapier body handle, the left half of every exception pair it is in. */
    readonly selfHandle: number;
    /** The world's exception set (`collision-exceptions.ts`'s `createCollisionExceptions`), when the
     *  project has one. */
    readonly exceptions?: { has(a: number, b: number): boolean };
  };
  /**
   * Godot 4's `CharacterBody3D.floor_snap_length` — the distance `apply_floor_snap` probes DOWN
   * when a body that WAS on the floor comes off it without moving up. Absent for a Godot 3
   * `KinematicBody`, whose plain `move_and_slide` has no snap at all (snapping was the separate
   * `move_and_slide_with_snap`, taking an explicit vector the script had to supply).
   *
   * ## The defect this closes, measured
   *
   * Rapier's controller answers `computedGrounded()` from the contacts of THIS call's motion, and
   * a call asked to move NOWHERE finds none. `starter-kit-3d-platformer`'s `player.gd` is the
   * measured case and it is a two-frame limit cycle, because the answer feeds the next question:
   * `handle_gravity` zeroes `gravity` while `is_on_floor()`, so the next `move_and_slide` is handed
   * `velocity.y = 0`; that call sweeps zero distance, reports `n=0 grounded=false`, so gravity
   * accumulates again and the call after it sweeps down 0.0069 and reports `n=1 grounded=true`.
   * Traced on the standing character, alternating every single frame:
   *
   * ```
   * want=(0,-0.00694,0) got=(0, 0.00009,0) n=1 grounded=true
   * want=(0, 0.00000,0) got=(0, 0.00000,0) n=0 grounded=false
   * ```
   *
   * `handle_effects` reads that same flag to choose a clip, so the idle character's animation
   * alternated `idle`/`jump` every frame — visible as the pose "constantly flapping" while
   * standing still.
   *
   * Godot has no such cycle, and `floor_snap_length` is exactly why:
   * `CharacterBody3D::_snap_on_floor` fires when `was_on_floor && !collision_state.floor &&
   * !vel_dir_facing_up`, and `apply_floor_snap` motion-tests `-up_direction * MAX(floor_snap_length,
   * margin)` and sets `collision_state.floor = true` on a hit within `floor_max_angle`
   * (docs.godotengine.org, class_characterbody3d: "Sets a snapping distance. When set to a value
   * different from 0.0, the body is kept attached to slopes when calling move_and_slide()…
   * Snapping is not applied if the body moves along up_direction"). {@link floorSnapDrop}
   * reproduces that test.
   *
   * Rapier's OWN `enableSnapToGround` is NOT the same mechanism and was measured not to fire here:
   * its snap runs inside the movement solve, which a zero-distance move never enters.
   */
  readonly floorSnapLength?: number;
  /** The shared Rapier world {@link floorSnapLength}'s probe casts into. Required with it, unused
   *  without it — the probe is the only query this object poses that the controller cannot. */
  readonly world?: SnapProbeWorldLike;
  /**
   * Called at the end of every `moveAndSlide` with the body's post-move translation (snap drop
   * included). Godot's `move_and_slide` writes the node's own transform INSIDE the call — a
   * script statement after it reads THIS tick's position — while Rapier's
   * `setNextKinematicTranslation` only lands at `world.step`. The node lives with the emitted
   * scene, not here, so the scene passes the write (`setGlobalTransform3D(node, moved)`).
   * Measured cost of omitting it: the starter kit's `position.y < -10` respawn check read the
   * previous tick's y and reloaded one tick after the source engine did.
   */
  readonly onMoved?: (moved: Vector3Like) => void;
  /** Godot 4's retained CharacterBody3D.up_direction; defaults to its registered Vector3.UP. */
  readonly upDirection?: Vector3Like;
}

/** Godot's `KinematicBody`, narrowed to the measured surface. */
export interface KinematicBody {
  /**
   * `CharacterBody3D.velocity` — Godot 4 only, and the one piece of STATE this
   * object holds.
   *
   * Godot 4 moved the character's velocity ONTO THE NODE. In 3.x it was the
   * script's own `var linear_velocity`, handed to `move_and_slide(v, up)` and
   * assigned back from its return; in 4.x `move_and_slide()` takes nothing,
   * reads this field and writes the slid result back into it
   * (`platformer-3d-godot4` `player.gd:56`/`:145`/`:150`/`:178` read and write
   * it around one bare `move_and_slide()`). So a translated 4.x character needs
   * the field to exist somewhere, and the faithful somewhere is the object that
   * stands for the node — the same reason Godot moved it.
   *
   * The backend for a pure STATE property is a slot, and it is a real backend
   * for the reason `Node.get_tree`'s is: without it there is nothing for the
   * emitted `velocity += gravity * delta` to be. The MOTION half is unchanged
   * and is {@link moveAndSlide} — Godot renamed the class, not the maths — so
   * the 4.x call is `body.velocity = body.moveAndSlide(body.velocity, up, dt)`,
   * one emitted line around this field, selected through compat's executable
   * `CharacterBody3D.move_and_slide` binding.
   *
   * A VALUE, like every other `Vector3` here: reading it hands back the frozen
   * record, and writing it replaces it. Starts at `Vector3.ZERO`, which is
   * Godot's own default for a freshly entered `CharacterBody3D`.
   */
  velocity: Vector3;
  /** Live CharacterBody3D motion-state direction used by the next bare move_and_slide(). */
  upDirection: Vector3;
  /** `CharacterBody3D.apply_floor_snap()` — force the retained character's native downward snap query now. */
  applyFloorSnap(): void;
  /**
   * `move_and_slide(linear_velocity, up_direction)` — `Player.gd:47`,
   * `Mob.gd:16`.
   *
   * Returns the INPUT velocity SLID against every contact normal the sweep
   * reported (`v - n * v.dot(n)`, in report order), which is what Godot returns
   * and what `Player.gd:47` assigns straight back to `velocity` — traced in the
   * real binary, see this module's header. NOT the velocity achieved: those two
   * differ on every frame that touches anything, and the achieved one leaves a
   * grounded character carrying the fall speed Godot zeroes on contact.
   *
   * @throws if `options` carries a non-default Godot argument — see this
   * module's header.
   */
  moveAndSlide(
    velocity: Vector3Like,
    up: Vector3Like | undefined,
    dt: number,
    options?: MoveAndSlideOptions,
  ): Vector3;
  moveAndSlideWithSnap(
    velocity: Vector3Like,
    snap: Vector3Like,
    up: Vector3Like | undefined,
    dt: number,
    options?: MoveAndSlideOptions,
  ): Vector3;
  moveAndCollide(
    motion: Vector3Like,
    infiniteInertia?: boolean,
    excludeRaycastShapes?: boolean,
    testOnly?: boolean,
  ): KinematicCollision | null;
  /** `is_on_floor()` — reads the LAST `move_and_slide`, as Godot's does. */
  isOnFloor(): boolean;
  /** `is_on_ceiling()` — reads the LAST `move_and_slide`, as Godot's does. */
  isOnCeiling(): boolean;
  /** `get_floor_normal()` — the floor contact normal from the last slide/snap. */
  getFloorNormal(): Vector3;
  /** `get_slide_count()` — how many collisions the last slide produced. */
  getSlideCount(): number;
  /**
   * `get_slide_collision(i)` — `Player.gd:55`.
   *
   * @throws on an out-of-range index. Godot returns `null` and the next line
   * fails on a member of nothing, three call sites from the mistake.
   */
  getSlideCollision(index: number): KinematicCollision;
}

/** The half of a Rapier 3D `World` {@link createKinematicRigidBody} calls. */
export interface KinematicRigidBodyWorld<TBody = object> {
  createRigidBody(desc: RigidBodyDesc): TBody;
}

/**
 * The RAW Rapier kinematic body a translated `KinematicBody` hangs its colliders on.
 * `createKinematicBody` wraps this body (plus its controller) as the `move_and_slide` surface.
 */
export function createKinematicRigidBody<TBody>(world: KinematicRigidBodyWorld<TBody>): TBody {
  return world.createRigidBody(RigidBodyDesc.kinematicPositionBased());
}

/**
 * The half of Rapier's `KinematicCharacterController` the Godot 3 `KinematicBody` contract
 * configures. Rapier's own class satisfies it.
 */
export interface ConfigurableCharacterController extends CharacterControllerLike {
  setMaxSlopeClimbAngle(angle: number): void;
  setMinSlopeSlideAngle(angle: number): void;
  disableAutostep(): void;
  disableSnapToGround(): void;
  setSlideEnabled(enabled: boolean): void;
  setApplyImpulsesToDynamicBodies(enabled: boolean): void;
}

/** The half of a Rapier 3D `World` {@link createCharacterController} calls. */
export interface CharacterControllerWorld<
  T extends ConfigurableCharacterController = ConfigurableCharacterController,
> {
  createCharacterController(offset: number): T;
}

/**
 * Rapier's character controller, configured to the Godot 3 `KinematicBody` contract.
 *
 * EVERY knob is stated, including the ones whose Rapier default already matches Godot. A
 * controller configured by omission is one whose behaviour is a library default nobody chose:
 *
 *  - offset 0.001 — Godot's own `body_test_motion` safe margin, and MEASURED: at 0.01 the
 *    capsule rode ~1 cm higher than Godot everywhere, which pushed a rim's roll-off threshold
 *    outward and held the port on a ledge the source engine leaves
 *  - max slope CLIMB angle = `floor_max_angle` (default 45°)
 *  - min slope SLIDE angle = the same 45° (Godot 3 applies no downhill slide of its own)
 *  - autostep OFF — Godot's `move_and_slide` has no step-up
 *  - snap-to-ground OFF — Godot 3 snapping is `move_and_slide_with_snap`, a different method
 *  - slide ON — Godot's `move_and_slide` is named for it
 *  - impulses to dynamic bodies OFF — `infinite_inertia = true` already takes them out of the sweep
 *
 * Returns the world's own controller type so a port field typed `RAPIER.KinematicCharacterController`
 * stays assignable.
 */
export function createCharacterController<T extends ConfigurableCharacterController>(
  world: CharacterControllerWorld<T>,
): T {
  const controller = world.createCharacterController(CONTROLLER_OFFSET);
  controller.setMaxSlopeClimbAngle(Math.PI / 4);
  controller.setMinSlopeSlideAngle(Math.PI / 4);
  controller.disableAutostep();
  controller.disableSnapToGround();
  controller.setSlideEnabled(true);
  controller.setApplyImpulsesToDynamicBodies(false);
  return controller;
}

/** Build the character. One per translated `KinematicBody` node. */
export function createKinematicBody(options: CreateKinematicBodyOptions): KinematicBody {
  const { controller, body, collider, resolveCollider, mask, layers, sweepFilter } = options;
  const { floorSnapLength, world, onMoved } = options;
  const sweepPredicate = motionTestFilter({ layers, mask, exclude: sweepFilter });
  if (floorSnapLength !== undefined && floorSnapLength > 0 && world === undefined) {
    throw new Error(
      'godot-compat: createKinematicBody was given `floorSnapLength` and no `world`. Godot 4`s ' +
        '`apply_floor_snap` is a motion test, and the shape cast that reproduces it needs the ' +
        'shared Rapier world — pass `world: ctx.world` beside it.',
    );
  }

  /** `is_on_floor()`, as the LAST `move_and_slide` left it — including its snap. */
  let onFloor = false;
  /** `is_on_ceiling()`, as the LAST `move_and_slide` left it. */
  let onCeiling = false;
  /** `get_floor_normal()`, as the LAST `move_and_slide` or successful snap left it. */
  let floorNormal = VECTOR3_ZERO;
  /** A controller solve is reused by move_and_collide, so slide collisions must be retained by value. */
  let slideCollisions: RetainedCharacterCollision[] = [];

  const retainControllerCollisions = (): RetainedCharacterCollision[] => {
    const retained: RetainedCharacterCollision[] = [];
    const count = controller.numComputedCollisions();
    for (let i = 0; i < count; i += 1) {
      const collision = controller.computedCollision(i);
      if (collision === null) continue;
      retained.push({
        collider: collision.collider,
        normal1: vec3(collision.normal1.x, collision.normal1.y, collision.normal1.z),
      });
    }
    return retained;
  };

  const collisionValue = (collision: CharacterCollisionLike): KinematicCollision => Object.freeze({
    collider: collision.collider === null ? null : resolveCollider(collision.collider),
    normal: vec3(collision.normal1.x, collision.normal1.y, collision.normal1.z),
  });

  return {
    velocity: VECTOR3_ZERO,
    upDirection: vec3(
      options.upDirection?.x ?? 0,
      options.upDirection?.y ?? 1,
      options.upDirection?.z ?? 0,
    ),

    applyFloorSnap(): void {
      if (onFloor) return;
      const up = this.upDirection;
      const drop = floorSnapDrop({
        wasOnFloor: true,
        force: true,
        up,
        velocity: VECTOR3_ZERO,
        movement: VECTOR3_ZERO,
        collider,
        world,
        floorSnapLength,
        floorMaxAngle: FLOOR_MAX_ANGLE,
        sweepPredicate,
      });
      if (drop === null) return;
      onFloor = true;
      floorNormal = drop.normal;
      if (drop.distance <= 0) return;
      const at = body.translation();
      const target = {
        x: at.x + drop.translation.x,
        y: at.y + drop.translation.y,
        z: at.z + drop.translation.z,
      };
      body.setNextKinematicTranslation(target);
      onMoved?.(target);
    },

    moveAndSlide(velocity, up, dt, moveOptions): Vector3 {
      assertGodotDefaults(moveOptions);
      slideCollisions = [];
      floorNormal = VECTOR3_ZERO;
      onFloor = false;
      onCeiling = false;
      controller.disableAutostep();
      controller.disableSnapToGround();
      controller.setSlideEnabled(true);
      controller.setApplyImpulsesToDynamicBodies(false);
      // Godot's default up_direction is Vector3.ZERO, which turns floor
      // detection off entirely. Rapier's controller needs an up vector to
      // answer `computedGrounded()` at all, so the two agree only if a caller
      // that passed no up gets no floor — which is exactly what `Mob.gd:16`
      // (`move_and_slide(velocity)`) means and never asks about.
      controller.setUp(up ?? VECTOR3_ZERO);
      controller.computeColliderMovement(
        collider,
        { x: velocity.x * dt, y: velocity.y * dt, z: velocity.z * dt },
        EXCLUDE_SENSORS,
        undefined,
        sweepPredicate,
      );

      const movement = controller.computedMovement();
      const at = body.translation();
      const target = { x: at.x + movement.x, y: at.y + movement.y, z: at.z + movement.z };

      // Godot 4's `_snap_on_floor`, in the one place `is_on_floor()` is decided. See
      // `CreateKinematicBodyOptions.floorSnapLength` for the measurement and the citation; a Godot
      // 3 character passes no length and this is the plain controller answer it always was.
      const wasOnFloor = onFloor;
      // Godot 4 `_set_collision_direction`: FLOOR is a collision whose normal is within
      // `floor_max_angle` (+ Godot's own FLOOR_ANGLE_THRESHOLD, 0.01 rad) of `up`. Rapier's
      // `computedGrounded()` answers a DIFFERENT question by its own source
      // (`is_grounded_at_contact_manifold`, rapier src/control/character_controller.rs): any
      // contact whose normal is within acos(1e-3) ~= 89.94 degrees of up, at up to
      // `offset + 0.05` away — so a capsule overhanging a platform rim, whose contact normal
      // has tilted past 45 degrees, stays "grounded" for Rapier ticks after Godot breaks into
      // free fall (the fidelity instrument's last open trajectory event: the source departed
      // the final rim 2-3 ticks before the port, which edge-rolled further). The tilt itself is
      // Godot's own SAT minimum-depth axis beating the face normal
      // (`godot_collision_solver_3d_sat.cpp` `_collision_capsule_face`: face axis tested
      // first, strict-`<` switch — ties keep the face; a genuine overhang wins strictly), so it
      // is exactly the signal that must be allowed to un-floor.
      //
      // The angle test therefore runs over the movement solve's reported collisions — but ONLY
      // when an up-facing one exists. Godot's floor state also comes from RECOVERY contacts
      // (depenetration inside the safe margin), which Rapier's collision list omits while its
      // grounded bit still sees them through the manifold prediction; judging quiet-rest ticks
      // by the (empty or wall-only) collision list alone un-floored them and measured worse.
      // So: among collisions facing up at all (cosine >= 1e-3, Rapier's own grounded
      // threshold), at least one must qualify as floor; with none reported, the grounded bit
      // stands. Measured on the starter-kit fidelity pair: the port's last-rim departure
      // residual fell from 4.3 to 1.3 units of accrued fall at the next sample; the remaining
      // ~1-2 tick departure offset is the two engines' quasi-static contact texture at the lip
      // (which side's cast still grazes the edge on a given tick), recorded in the runbook.
      const grounded = controller.computedGrounded();
      let anyUpFacing = false;
      let anyFloorContact = false;
      if (up !== undefined) {
        const upLen = Math.hypot(up.x, up.y, up.z);
        if (upLen > 0) {
          const floorLimit = Math.cos(
            (moveOptions?.floorMaxAngle ?? FLOOR_MAX_ANGLE) + FLOOR_ANGLE_THRESHOLD,
          );
          const solveCollisions = controller.numComputedCollisions();
          for (let i = 0; i < solveCollisions; i += 1) {
            const normal = controller.computedCollision(i)?.normal1;
            if (normal === undefined) continue;
            const nLen = Math.hypot(normal.x, normal.y, normal.z);
            if (nLen === 0) continue;
            const cosine =
              (normal.x * up.x + normal.y * up.y + normal.z * up.z) / (nLen * upLen);
            if (cosine >= 1.0e-3) anyUpFacing = true;
            if (cosine >= floorLimit) anyFloorContact = true;
          }
        }
      }
      const floorByCollisions = anyUpFacing ? anyFloorContact : grounded;
      const snapDrop = floorByCollisions
        ? null
        : floorSnapDrop({
            wasOnFloor,
            up,
            velocity,
            movement,
            collider,
            world,
            floorSnapLength,
            floorMaxAngle: moveOptions?.floorMaxAngle ?? FLOOR_MAX_ANGLE,
            ...(moveOptions?.snap === undefined ? {} : { snap: moveOptions.snap }),
            sweepPredicate,
          });
      onFloor = floorByCollisions || snapDrop !== null;
      floorNormal = VECTOR3_ZERO;
      // The snap's TRANSLATION half (see floorSnapDrop's doc): follow the ground the body just
      // re-attached to. `up` is non-null whenever snapDrop is (the probe requires it).
      if (snapDrop !== null) floorNormal = snapDrop.normal;
      if (snapDrop !== null && snapDrop.distance > 0) {
        target.x += snapDrop.translation.x;
        target.y += snapDrop.translation.y;
        target.z += snapDrop.translation.z;
      }
      body.setNextKinematicTranslation(target);
      // Godot's `move_and_slide` writes the node's own transform INSIDE the call, so a script
      // statement after it (`if position.y < -10: reload`) reads THIS tick's position. Rapier's
      // kinematic translation only lands at `world.step`, so the caller's node write cannot wait
      // for the post-step sync — measured: without this, the starter kit's respawn check read the
      // previous tick's y and fired one tick late.
      onMoved?.(target);

      // Godot's own return: the INPUT velocity, slid against each contact
      // normal in turn (`KinematicBody::move_and_slide`'s `body_velocity =
      // body_velocity.slide(collision.normal)` per iteration). See this
      // module's header for the traced numbers this replaced. There is no `dt`
      // in it at all, so a paused frame carries momentum through rather than
      // needing a divide-by-zero guard — which is also what Godot does with a
      // zero delta (no motion, no collision, the input velocity back).
      // FLOOR-CONTACT NORMAL CORRECTION. Rapier's reported contact normal tilts when the
      // capsule's curved bottom meets a triangle EDGE of a FLAT floor — measured on the
      // starter-kit spawn platform's coplanar top: a landing contact reported
      // (0.23, 0.90, 0.37), 26° off vertical, where Godot's solver reports the face normal
      // (0, 1, 0) (this module's header carries Godot's own landing trace). Sliding the
      // returned velocity against the spurious normal converts VERTICAL motion into LATERAL
      // velocity, which the game's `velocity = move_and_slide(...)` feedback then carries: an
      // idle player slid (0.014, 0.023) off its spawn before settling, and every walking tick
      // across an internal edge collected a small mesh-anchored kick (the fidelity
      // instrument's compounding-drift finding). A ray straight down reads the floor's actual
      // FACE normal, so a floor-qualifying contact normal is replaced by it for the slide —
      // the identity substitution on a real ramp, where contact and face normals agree.
      // (`TriMeshFlags.FIX_INTERNAL_EDGES` is NOT the fix: measured, its ORIENTED
      // pseudo-normals presume consistent winding the baked platform soups do not have, and
      // the drift grew an order of magnitude.)
      const upLengthForSlide = up === undefined ? 0 : Math.hypot(up.x, up.y, up.z);
      const floorDot = Math.cos(moveOptions?.floorMaxAngle ?? FLOOR_MAX_ANGLE);
      /** `undefined` = not probed yet; `null` = probed, no usable face normal. */
      let floorFaceNormal: Vector3Like | null | undefined;
      const probeFloorFaceNormal = (): Vector3Like | null => {
        if (up === undefined || upLengthForSlide === 0 || world?.castRayAndGetNormal === undefined)
          return null;
        const from = (collider as SnapProbeColliderLike).translation();
        const hit = world.castRayAndGetNormal(
          {
            origin: { x: from.x + movement.x, y: from.y + movement.y, z: from.z + movement.z },
            dir: {
              x: -up.x / upLengthForSlide,
              y: -up.y / upLengthForSlide,
              z: -up.z / upLengthForSlide,
            },
          },
          FLOOR_NORMAL_PROBE_DISTANCE,
          true,
          EXCLUDE_SENSORS,
          undefined,
          collider,
          undefined,
          sweepPredicate,
        );
        if (hit === null) return null;
        const length = Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z);
        if (length === 0) return null;
        const cosine =
          (hit.normal.x * up.x + hit.normal.y * up.y + hit.normal.z * up.z) /
          (length * upLengthForSlide);
        // The ray's face must itself be FLOOR — a rim side-face is no substitute.
        return cosine >= floorDot ? hit.normal : null;
      };

      let slid = vec3(velocity.x, velocity.y, velocity.z);
      const collisions = controller.numComputedCollisions();
      for (let i = 0; i < collisions; i += 1) {
        let normal = controller.computedCollision(i)?.normal1;
        if (normal === undefined) continue;
        if (up !== undefined && upLengthForSlide > 0) {
          const normalLength = Math.hypot(normal.x, normal.y, normal.z);
          const cosine =
            normalLength === 0
              ? -1
              : (normal.x * up.x + normal.y * up.y + normal.z * up.z) /
                (normalLength * upLengthForSlide);
          if (cosine >= floorDot) {
            if (floorFaceNormal === undefined) floorFaceNormal = probeFloorFaceNormal();
            if (floorFaceNormal !== null) normal = floorFaceNormal;
            floorNormal = vec3(normal.x, normal.y, normal.z);
          }
        }
        const into = slid.x * normal.x + slid.y * normal.y + slid.z * normal.z;
        // Only a contact the velocity is going INTO is one of Godot's, and that is the whole of the
        // difference between the two engines' collision LISTS. Godot's loop slides against
        // `collision.normal` for collisions `move_and_collide` REPORTED, and a cast only reports a
        // surface it was actually stopped by — so a surface the motion is leaving is never in the
        // list. Rapier's controller reports the ground it is standing on regardless, and without
        // this gate `v.slide(n)` would subtract velocity Godot keeps. Measured on the JUMP frame in
        // the real binary — a grounded box handed `(0, 12, 0)`:
        //   f=2 in=(0,-0.2333,0) ret=(0,0,0)  slides=1 n0=(0,1,0) floor=True
        //   f=3 in=(0,12.0000,0) ret=(0,12,0) slides=0          floor=False
        // — the floor it was resting on the frame before is NOT in the jump frame's list and the
        // whole jump survives. Ungated, the port zeroed `velocity.y` on the take-off frame and the
        // character could not leave the ground at all.
        if (into >= 0) continue;
        slid = vec3(slid.x - normal.x * into, slid.y - normal.y * into, slid.z - normal.z * into);
      }
      if (onFloor && floorNormal === VECTOR3_ZERO) {
        if (floorFaceNormal === undefined) floorFaceNormal = probeFloorFaceNormal();
        if (floorFaceNormal !== null) {
          floorNormal = vec3(floorFaceNormal.x, floorFaceNormal.y, floorFaceNormal.z);
        }
      }

      // Godot 4 CharacterBody3D::_set_collision_direction: a collision is a
      // ceiling when the angle from `up` to its normal is >= π − floor_max_angle,
      // i.e. n·up <= −cos(floor_max_angle). The same list get_slide_collision
      // walks; starter-kit-fps player.gd:158 zeroes gravity on a head-bonk.
      onCeiling = false;
      if (up !== undefined) {
        const upLength = Math.hypot(up.x, up.y, up.z);
        if (upLength > 0) {
          const ux = up.x / upLength;
          const uy = up.y / upLength;
          const uz = up.z / upLength;
          const ceilingDot = -Math.cos(
            (moveOptions?.floorMaxAngle ?? FLOOR_MAX_ANGLE) + FLOOR_ANGLE_THRESHOLD,
          );
          for (let i = 0; i < collisions; i += 1) {
            const normal = controller.computedCollision(i)?.normal1;
            if (normal === undefined) continue;
            const nLen = Math.hypot(normal.x, normal.y, normal.z);
            if (nLen === 0) continue;
            if ((normal.x * ux + normal.y * uy + normal.z * uz) / nLen <= ceilingDot) {
              onCeiling = true;
              break;
            }
          }
        }
      }

      slideCollisions = retainControllerCollisions();

      return slid;
    },

    moveAndSlideWithSnap(velocity, snap, up, dt, moveOptions): Vector3 {
      if (![snap.x, snap.y, snap.z].every(Number.isFinite)) {
        throw new TypeError('KinematicBody.move_and_slide_with_snap snap requires a finite Vector3.');
      }
      if (world === undefined && Math.hypot(snap.x, snap.y, snap.z) > 0) {
        throw new Error('KinematicBody.move_and_slide_with_snap requires the retained native Rapier world for its snap motion test.');
      }
      return this.moveAndSlide(velocity, up, dt, { ...moveOptions, snap });
    },

    moveAndCollide(motion, infiniteInertia = true, excludeRaycastShapes = true, testOnly = false) {
      if (![motion.x, motion.y, motion.z].every(Number.isFinite)) {
        throw new TypeError('KinematicBody.move_and_collide motion requires a finite Vector3.');
      }
      if (!infiniteInertia) {
        throw new Error('KinematicBody.move_and_collide(infinite_inertia=false) requires a measured two-way dynamic-body impulse exchange.');
      }
      if (!excludeRaycastShapes) {
        throw new Error('KinematicBody.move_and_collide(exclude_raycast_shapes=false) is unavailable because Rapier has no raycast-only collision-shape category.');
      }
      if (typeof testOnly !== 'boolean') throw new TypeError('KinematicBody.move_and_collide test_only requires bool.');
      controller.disableAutostep();
      controller.disableSnapToGround();
      controller.setSlideEnabled(false);
      try {
        controller.computeColliderMovement(collider, motion, EXCLUDE_SENSORS, undefined, sweepPredicate);
      } finally {
        controller.setSlideEnabled(true);
      }
      const movement = controller.computedMovement();
      if (!testOnly) {
        const at = body.translation();
        const target = { x: at.x + movement.x, y: at.y + movement.y, z: at.z + movement.z };
        body.setNextKinematicTranslation(target);
        onMoved?.(target);
      }
      const collision = controller.computedCollision(0);
      return collision === null ? null : collisionValue(collision);
    },

    isOnFloor(): boolean {
      return onFloor;
    },

    isOnCeiling(): boolean {
      return onCeiling;
    },

    getFloorNormal(): Vector3 {
      return vec3(floorNormal.x, floorNormal.y, floorNormal.z);
    },

    getSlideCount(): number {
      return slideCollisions.length;
    },

    getSlideCollision(index): KinematicCollision {
      const count = slideCollisions.length;
      const collision = slideCollisions[index];
      if (collision === undefined) {
        throw new Error(
          `godot-compat: get_slide_collision(${index}) is out of range — the last ` +
            `move_and_slide() produced ${count} collision(s). Godot returns null here and the ` +
            'next property read fails somewhere else entirely.',
        );
      }
      return collisionValue(collision);
    },
  };
}

/** `CharacterBody3D.floor_max_angle`'s own default, 45° in radians — the angle up to which a
 *  surface is still floor (docs.godotengine.org, class_characterbody3d). The same number the port
 *  hands the controller as `setMaxSlopeClimbAngle`. */
const FLOOR_MAX_ANGLE = Math.PI / 4;

/** Godot's own `FLOOR_ANGLE_THRESHOLD` (physics_body_3d.h, 0.01 rad) — the slack
 *  `_set_collision_direction` adds to `floor_max_angle` when classifying a collision as floor,
 *  so an exactly-45° ramp read through float noise still floors. */
const FLOOR_ANGLE_THRESHOLD = 0.01;

/** The gap Rapier's controller keeps from every surface (`createCharacterController`'s argument)
 *  — Godot's own safe-margin default, and measured to matter at exactly this size: at 0.01 the
 *  capsule rested ~1 cm above Godot's height on every floor, and on a platform's rim that
 *  height held the port glued to an edge the source engine rolls off. The snap translation
 *  subtracts it so a snapped body comes to rest exactly where the controller's own contact
 *  resolution would hold it — see {@link floorSnapDrop}. */
const CONTROLLER_OFFSET = 0.001;

/** How far below the collider's center the floor-face-normal ray reaches. Only consulted when a
 *  contact ALREADY qualifies as floor, so the touched ground is within the shape's own extent of
 *  the center — this only needs to be comfortably larger than any character's half height. */
const FLOOR_NORMAL_PROBE_DISTANCE = 5;

/**
 * Godot 4's `CharacterBody3D::_snap_on_floor` + `apply_floor_snap`: is this character STILL on
 * the floor after a `move_and_slide` whose own sweep found no ground — and if so, how far DOWN
 * must it move to stay attached? Returns that drop (>= 0), or `null` when the body is not
 * snapped.
 *
 * Godot's guard is `if (collision_state.floor || !p_was_on_floor || p_vel_dir_facing_up) return;`
 * and its test is `parameters.motion = -up_direction * MAX(floor_snap_length, margin)` accepted
 * when `result.get_angle(-up_direction) <= floor_max_angle`. Every clause is below, over Rapier's
 * own `castShape` against the same colliders the movement sweep was filtered to.
 *
 * ## Both halves of Godot's snap, and the offset
 *
 * Godot's snap also MOVES the body onto the contact — that translation is load-bearing on any
 * descending surface: walking over a platform's rounded lip, Godot follows the curve down tick
 * by tick, while a state-only snap leaves the body sliding LEVEL over the shoulder until the
 * probe finally misses, so it falls later and from further out (measured on the starter-kit
 * fidelity pair: the source began descending at x≈0.94, the port not until x≈1.14). The drop
 * returned here is the cast's own `time_of_impact` MINUS the controller's surface `offset`
 * ({@link CONTROLLER_OFFSET}), clamped at zero: on flat rest the cast reports the offset-sized
 * gap and the drop is zero — no translation, none of the 1 cm push-back oscillation translating
 * ONTO the contact would cause — while on a curving lip the drop is exactly the extra distance
 * the surface fell away, leaving the body at the controller's own rest gap.
 */
interface FloorSnapHit {
  readonly distance: number;
  readonly translation: Vector3;
  readonly normal: Vector3;
}

function floorSnapDrop(probe: {
  readonly wasOnFloor: boolean;
  /** Explicit `apply_floor_snap()` supplies both internal booleans that bypass history/upward-motion guards. */
  readonly force?: boolean;
  readonly up: Vector3Like | undefined;
  readonly velocity: Vector3Like;
  readonly movement: Vector3Like;
  readonly collider: object;
  readonly world: SnapProbeWorldLike | undefined;
  readonly floorSnapLength: number | undefined;
  /** Godot 3 move_and_slide_with_snap's authored direction and distance. */
  readonly snap?: Vector3Like;
  readonly floorMaxAngle: number;
  readonly sweepPredicate: (collider: SweptColliderLike) => boolean;
}): FloorSnapHit | null {
  const { up, floorSnapLength, world } = probe;
  // A Godot 3 `KinematicBody` (no length) never snapped, and a 4.x body that authored `0.0` turned
  // it off by hand — both are Godot's `floor_snap_length == 0` and both stop here.
  if ((floorSnapLength === undefined && probe.snap === undefined) || world === undefined) return null;
  const authoredSnapLength = probe.snap === undefined
    ? (floorSnapLength ?? 0)
    : Math.hypot(probe.snap.x, probe.snap.y, probe.snap.z);
  const snapLength = probe.force
    ? Math.max(authoredSnapLength, CONTROLLER_OFFSET)
    : authoredSnapLength;
  if (snapLength <= 0) return null;
  // `!p_was_on_floor`: Godot snaps a body back ONTO ground it was already on; it never grabs
  // ground it is arriving at, which is what makes a fall land rather than stick early.
  if (!probe.force && !probe.wasOnFloor) return null;
  // Godot 3's `up_direction` default is `Vector3.ZERO`, which turns floor detection off entirely.
  if (up === undefined) return null;
  const upLength = Math.hypot(up.x, up.y, up.z);
  if (upLength === 0) return null;
  const ux = up.x / upLength;
  const uy = up.y / upLength;
  const uz = up.z / upLength;
  const direction = probe.snap === undefined || probe.force
    ? { x: -ux, y: -uy, z: -uz }
    : {
        x: probe.snap.x / snapLength,
        y: probe.snap.y / snapLength,
        z: probe.snap.z / snapLength,
      };
  // `p_vel_dir_facing_up`: a jump must be able to leave the ground.
  if (!probe.force && probe.velocity.x * ux + probe.velocity.y * uy + probe.velocity.z * uz > 0) return null;

  const collider = probe.collider as SnapProbeColliderLike;
  const at = collider.translation();
  const movement = probe.movement;
  const hit = world.castShape(
    // The shape starts where the movement just put it — Godot tests from the post-motion pose too.
    { x: at.x + movement.x, y: at.y + movement.y, z: at.z + movement.z },
    collider.rotation(),
    direction,
    collider.shape,
    0,
    snapLength,
    true,
    EXCLUDE_SENSORS,
    undefined,
    // The cast starts ON this character's own collider, so without excluding it every probe
    // returns a penetrating self-hit at t=0 and never sees the ground half a centimetre below.
    collider,
    undefined,
    probe.sweepPredicate,
  );
  if (hit === null) return null;
  // `result.get_angle(-up_direction) <= floor_max_angle`: the surface has to be FLOOR, not the wall
  // a character is sliding along or the ceiling it is under.
  const normal = hit.normal1;
  const normalLength = Math.hypot(normal.x, normal.y, normal.z);
  if (normalLength === 0) return null;
  const cosine = (normal.x * ux + normal.y * uy + normal.z * uz) / normalLength;
  if (Math.acos(Math.min(1, Math.max(-1, cosine))) > probe.floorMaxAngle) return null;
  // The translation half of Godot's snap, offset-preserving — see the doc above.
  const distance = Math.max(0, hit.time_of_impact - CONTROLLER_OFFSET);
  return {
    distance,
    translation: vec3(direction.x * distance, direction.y * distance, direction.z * distance),
    normal: vec3(normal.x, normal.y, normal.z),
  };
}

/**
 * Godot's motion test, as Rapier's `filterPredicate` — TRUE keeps a collider in the sweep.
 *
 * Three rejections. The first is the layer rule and applies to every sweep; the other two are
 * measured in the real binary (see this module's header):
 *  - a collider this character's own `collision_mask` does not name. Godot's motion test culls with
 *    `p_body->collides_with(other)` — the MOVER's mask against the other's `collision_layer`, one
 *    direction (`modules/godot_physics_3d/godot_space_3d.cpp`:632 @ 4.4-stable), the same rule every
 *    space query uses and NOT the two-directional rule the solver's body pairs use;
 *  - a collider whose parent body is DYNAMIC, because `infinite_inertia` defaults to `true` and
 *    Godot's `test_body_motion` skips every `BODY_MODE_RIGID`/`BODY_MODE_CHARACTER` body outright;
 *  - a collider whose parent body is in a collision EXCEPTION with this character, because Godot's
 *    exception list is consulted by the motion test and Rapier's `filterContactPair` hook is not.
 *
 * A collider with no parent body is kept (subject to the layer rule): it is a raw fixed collider (a
 * GridMap cell trimesh hangs on one), which is a wall in both engines.
 */
function motionTestFilter(filter: {
  readonly layers: CollisionLayers;
  readonly mask: number;
  readonly exclude:
    | {
        readonly selfHandle: number;
        readonly exceptions?: { has(a: number, b: number): boolean };
      }
    | undefined;
}): (collider: SweptColliderLike) => boolean {
  return (collider) => {
    if (!godotCanCollideWith(filter.layers, collider, filter.mask)) return false;
    const exclude = filter.exclude;
    if (exclude === undefined) return true;
    const parent = collider.parent();
    if (parent === null) return true;
    if (parent.isDynamic()) return false;
    return exclude.exceptions?.has(exclude.selfHandle, parent.handle) !== true;
  };
}

/** Godot's four extra `move_and_slide` arguments, at their defaults or not at
 *  all. See this module's header for why a non-default value refuses. */
function assertGodotDefaults(options: MoveAndSlideOptions | undefined): void {
  if (options === undefined) return;
  const refusals: string[] = [];
  if (options.stopOnSlope === true) {
    refusals.push('stop_on_slope=true — configure controller.enableSnapToGround(distance)');
  }
  if (options.maxSlides !== undefined && options.maxSlides !== 4) {
    refusals.push(
      `max_slides=${options.maxSlides} — Rapier's controller has no slide cap; its solver ` +
        'iterates internally and exposes no counterpart',
    );
  }
  if (options.floorMaxAngle !== undefined && options.floorMaxAngle !== Math.PI / 4) {
    refusals.push(
      `floor_max_angle=${options.floorMaxAngle} — configure ` +
        'controller.setMaxSlopeClimbAngle(radians) once, not per call',
    );
  }
  if (options.infiniteInertia === false) {
    refusals.push(
      'infinite_inertia=false — the sweep would have to STOP on dynamic bodies (drop the ' +
        "dynamic-body rejection in this module's `motionTestFilter`) and Rapier would then have to " +
        'push them back through `setApplyImpulsesToDynamicBodies`, a two-way exchange this lane has ' +
        'not measured against the real engine',
    );
  }
  if (refusals.length > 0) {
    throw new Error(
      `godot-compat: move_and_slide() was given ${refusals.length} argument(s) this backend ` +
        `cannot honour: ${refusals.join('; ')}. These are per-call in Godot and per-controller ` +
        'in Rapier; refusing is deliberate, because absorbing them silently would make the ' +
        'character behave differently from the game being ported.',
    );
  }
}

// --- an `Area`'s `body_entered` monitoring, as a shape query over the shared world ----------------

/** The half of a Rapier 3D `Collider` {@link godotAreaOverlappingBodies} poses its query at — an
 *  `Area`'s own SENSOR collider, which the scene built for the `CollisionShape` under the `Area`.
 *  Rapier's own `Collider` satisfies it. */
export interface SensorColliderLike {
  translation(): Vector3Like;
  rotation(): { x: number; y: number; z: number; w: number };
  readonly shape: object;
  /** Rapier's own `Collider.isSensor` — Areas are sensors; physics bodies are not. */
  isSensor?(): boolean;
}

/**
 * Godot `Area` monitoring — EVERY distinct body on `mask` overlapping the Area's own sensor shape
 * this frame, in no particular order.
 *
 * Godot's `Area` monitoring is ONE-DIRECTIONAL and it is the AREA's mask that decides:
 * `GodotAreaPair3D::setup` reports the pair only when `area->collides_with(body)`, i.e.
 * `body.collision_layer & area.collision_mask` (`modules/godot_physics_3d/godot_area_pair_3d.cpp`
 * :34-36 @ 4.4-stable) — the body's own mask has no say, and the two-directional `interacts_with`
 * that gates the broad-phase pairing above it adds nothing, because this test implies it. Rapier's
 * narrow phase does not answer that question, so this poses the sensor's own shape into the shared
 * world with `intersectionsWithShape` and applies the same rule as its query predicate, over the
 * world's layer registry. Each overlapping collider is resolved
 * through the SAME `colliders` registry every native scene populates as it builds its own colliders
 * (the scene->collider link Godot fuses and this engine keeps separate), so the values returned are
 * the game objects a `body_entered` handler expects — the translated scenes those bodies belong to.
 * A scene with several colliders (an enemy's four spheres and a box) appears once.
 *
 * Sensors (Areas) are skipped even when they are in that registry. An Area must be registered so a
 * `RayCast3D` with `collide_with_areas` can resolve `get_collider()` to the Area — starter-kit-fps
 * `player.gd:204` is `collider.has_method("damage")` on that result. Godot's `body_entered` still
 * reports physics bodies only (`area_entered` is the Area-Area signal), so a sensor that stayed
 * in this query would fire `body_entered` on itself.
 *
 * ## Why the whole SET and not the first one
 *
 * `body_entered` is per BODY: Godot fires it once for each body that enters, and a handler is
 * written knowing that — `coin.gd` is `if not taken and body is preload(".../player.gd")`, which
 * only makes sense because bodies it does not care about enter too. The caller holds the set that
 * was inside last frame and fires on the ENTER EDGE per body; reporting only one overlap made that
 * impossible and cost this exactly: on `platformer-3d` the GridMap's own cell colliders are bodies
 * on the same layer, so a coin whose 0.31-radius sphere clipped the ledge it hangs over reported
 * the LEVEL on its first frame, a one-shot guard latched on it, and that coin could never be taken
 * again — measured with the walker at 0.16 units of planar separation from a coin for 720 sim
 * seconds without collecting it.
 *
 * ## `monitoring`
 *
 * Godot's `Area3D.monitoring` is implemented in the physics server by CLEARING the area's monitor
 * callback, so the server stops handing this area its overlap pairs. This query IS that callback on
 * this port, so `monitoring` is honoured here: an area whose {@link AreaMonitoring3D} is off reports
 * NOTHING, and the caller's own inside-set goes empty on the next step — which is the other half of
 * what Godot does (it drops the pairs it was holding). See `area-3d.ts`. The parameter is OPTIONAL
 * because an `Area` whose game never writes the flag has no monitor record to pass and monitors
 * unconditionally, exactly as every port did before the flag existed.
 */
/** Godot's `body_entered` reports physics bodies, never Areas. A registered sensor must stay
 *  visible to a `collide_with_areas` ray and invisible to this query. */
function isSensorCollider(collider: object): boolean {
  return (
    typeof (collider as { isSensor?: unknown }).isSensor === 'function' &&
    (collider as { isSensor: () => boolean }).isSensor()
  );
}

export function godotAreaOverlappingBodies(
  world: OverlapWorldLike,
  sensor: SensorColliderLike,
  mask: number,
  colliders: GodotColliderLookup<Collider, GodotColliderOwner>,
  layers: CollisionLayers,
  monitoring?: AreaMonitoring3D,
): GodotColliderOwner[] {
  if (monitoring !== undefined && !isMonitoring3D(monitoring)) return [];
  const owners: GodotColliderOwner[] = [];
  world.intersectionsWithShape(
    sensor.translation(),
    sensor.rotation(),
    sensor.shape,
    (other) => {
      const found = colliders.get(other);
      if (found !== undefined && !owners.includes(found)) owners.push(found);
      return true;
    },
    undefined,
    undefined,
    undefined,
    undefined,
    (other) => !isSensorCollider(other) && godotCanCollideWith(layers, other, mask),
  );
  return owners;
}

// --- spawning a kinematic character clear of whatever it was placed inside -----------------------

/** The half of a Rapier 3D `World` {@link seedKinematicBody} drives. Rapier's own `World`
 *  satisfies it. */
export interface OverlapWorldLike extends KinematicSpawnWorld<Collider> {}

/** What {@link seedKinematicBody} needs. */
export interface SeedKinematicBodyOptions {
  readonly world: OverlapWorldLike;
  readonly body: KinematicRigidBodyLike;
  /** The character's own collider SHAPE — what {@link SeedKinematicBodyOptions.world}'s overlap
   *  check sweeps, and what the lift loop below re-tests after every step. Rapier's own
   *  `collider.shape` satisfies it. */
  readonly shape: object;
  /** The body itself, as the overlap check's own exclusion argument — Rapier's `RigidBody`
   *  satisfies both this and {@link SeedKinematicBodyOptions.body}. */
  readonly excludeBody: object;
  /** The collider's own LOCAL offset within `body`, exactly the `<Node>_shape.at` an emitted scene
   *  already carries — needed because the overlap check poses the shape itself, not the body. */
  readonly at: Vector3Like;
  /** The mover's own `collision_mask`, as the plain number the `.tscn` declares. */
  readonly mask: number;
  /** The world's layer registry — what {@link mask} is tested against. */
  readonly layers: CollisionLayers;
  /** The WORLD-SPACE position to seed the body at — a scene's own `node.getWorldPosition(...)`. */
  readonly position: Vector3Like;
}

/**
 * Place a freshly-mounted kinematic character at its authored/spawned position, and lift it clear
 * of anything it was placed INSIDE.
 *
 * This is the one thing Godot's `move_and_slide` does for free that Rapier's
 * `KinematicCharacterController` does not: a spawn that starts penetrating an obstacle never
 * recovers on its own (its downward shape-cast begins inside the obstacle, finds no time-of-impact,
 * and hands back the whole desired motion — the character sinks a little further every frame and is
 * in free fall within a second). Godot's own solver depenetrates on the first physics frame instead.
 *
 * So this runs once, at the moment a scene seeds its own body from the node position its script (or
 * its authored JSX transform) placed it at — a bounded lift in small steps until the shape is
 * clear, plus one more step of margin so the controller starts outside its own offset rather than
 * exactly on it.
 *
 * @throws if the character cannot be freed within the budget. Silently leaving it inside would
 * reproduce exactly the free-fall this function exists to prevent.
 */
export function seedKinematicBody(options: SeedKinematicBodyOptions): void {
  const { world, body, shape, excludeBody, at, mask, layers, position } = options;
  depenetrateKinematicSpawn({
    world,
    body,
    shape,
    excludeBody,
    shapeOffset: at,
    position,
    filterFlags: EXCLUDE_SENSORS,
    // Same row as the movement sweep: a Godot Area is a sensor, not a body, and the mover's
    // collision_mask is tested one-way against the candidate's collision_layer.
    filterPredicate: (other) => godotCanCollideWith(layers, other, mask),
  });
}
