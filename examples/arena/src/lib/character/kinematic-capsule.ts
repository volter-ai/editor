/**
 * One kinematic capsule, solved by Rapier — the step primitive.
 *
 * This is the arena hook both shipped shooters carried
 * (`examples/{first,third}-person/src/hooks/use-kinematic-capsule.ts`, 111
 * lines each, byte-identical apart from three comments naming their own
 * levels), moved rather than rewritten. The player and every hostile stand on
 * the same colliders, climb the same ramps and are stopped by the same cover,
 * so they are solved by the same code — and the six tuning constants that used
 * to be copied per character are PARAMETERS here, because two games that share
 * a step primitive still legitimately disagree about step height.
 *
 * What this is not: a character system. There is no input here, no camera, no
 * frame loop and no component that owns one. `advanceCapsule` is a function you
 * call from your own `useFrame`; `useKinematicCapsule` (in
 * `use-kinematic-capsule.ts`) is the thin R3F wiring around it.
 *
 * Resource ownership: `createCapsuleController` hands back Rapier's own
 * controller and gets out of the way. A character controller is a Rapier-side
 * allocation, not a JS object — the world holds it until it is handed back —
 * so whoever creates one calls `world.removeCharacterController(it)`. The hook
 * does exactly that on unmount; a caller that creates one by hand owns the
 * same obligation.
 */

import {
  type CapsuleController,
  EXCLUDE_SENSORS,
  type RapierCollider,
  type RapierRigidBody,
  type RapierWorld,
} from './rapier';
import { warnOnThinFootholds } from './thin-foothold';

/** A position this module is allowed to move. `THREE.Vector3` is one. */
export interface MutableVector3 {
  x: number;
  y: number;
  z: number;
}

/** Planar (XZ) velocity in metres per second. Y is gravity's business. */
export interface PlanarVelocity {
  readonly x: number;
  readonly z: number;
}

export interface CapsuleStep {
  /** Did the solver end this frame standing on something? */
  readonly grounded: boolean;
  /** Vertical velocity after gravity — and after a landing zeroed it. */
  readonly verticalVelocity: number;
}

/**
 * Everything the shipped examples hard-coded, as parameters.
 *
 * The defaults ARE the examples' values, so a game that passes nothing gets
 * the behaviour those two games ship with.
 */
export interface CapsuleTuning {
  /**
   * Should the capsule shove dynamic bodies it walks into?
   *
   * Genuinely contested: both examples chose `false` (a player cannot bowl the
   * props around), the starter template chose `true` (a player can). Neither
   * is the right default for the other, so it is a parameter and the default
   * is the examples'.
   */
  readonly applyImpulsesToDynamicBodies: boolean;
  /** Should a dynamic body count as a step to climb? */
  readonly autostepDynamicBodies: boolean;
  /** Step-up: a 0.55 m rise is climbed when 0.22 m of landing follows it. */
  readonly autostepHeight: number;
  readonly autostepMinWidth: number;
  /** Past ~50° a surface is a wall you slide off, in radians. */
  readonly maxSlopeClimbAngle: number;
  readonly minSlopeSlideAngle: number;
  /** Rapier skin width — the gap the solver keeps between capsule and collider. */
  readonly offset: number;
  /** Without this a walk DOWN a ramp becomes a series of small falls. */
  readonly snapToGround: number;
}

export const CAPSULE_TUNING: CapsuleTuning = {
  applyImpulsesToDynamicBodies: false,
  autostepDynamicBodies: true,
  autostepHeight: 0.55,
  autostepMinWidth: 0.22,
  maxSlopeClimbAngle: 0.87,
  minSlopeSlideAngle: 0.7,
  offset: 0.02,
  snapToGround: 0.45,
};

/**
 * Rapier's own `KinematicCharacterController`, configured from `tuning`.
 *
 * The caller owns it: `world.removeCharacterController(controller)` when the
 * character goes away, or the world leaks one per mount.
 */
export function createCapsuleController(
  world: RapierWorld,
  tuning: Partial<CapsuleTuning> = {},
): CapsuleController {
  const settings = { ...CAPSULE_TUNING, ...tuning };
  const made = world.createCharacterController(settings.offset);
  made.enableAutostep(
    settings.autostepHeight,
    settings.autostepMinWidth,
    settings.autostepDynamicBodies,
  );
  made.enableSnapToGround(settings.snapToGround);
  made.setMaxSlopeClimbAngle(settings.maxSlopeClimbAngle);
  made.setMinSlopeSlideAngle(settings.minSlopeSlideAngle);
  made.setApplyImpulsesToDynamicBodies(settings.applyImpulsesToDynamicBodies);
  return made;
}

export interface CapsuleAdvance {
  /** The character's own collider — `rigidBody.collider(0)` for a lone capsule. */
  readonly collider: RapierCollider;
  readonly controller: CapsuleController;
  readonly dt: number;
  /**
   * Signed vertical acceleration, m/s² — `world.gravity.y`, not a constant in
   * here. `<Physics gravity={…}>` is an authored literal the inspector can
   * edit, and a character that falls at a private 19.5 that merely happens to
   * agree with it is a character the inspector cannot tune.
   */
  readonly gravity: number;
  readonly planarVelocity: PlanarVelocity;
  /**
   * The caller's own mirror of where its capsule is — MUTATED in place, which
   * is what lets the rest of that character's frame read the new position
   * without waiting for the physics step to publish a transform.
   */
  readonly position: MutableVector3;
  readonly rigidBody: RapierRigidBody;
  /** Re-armed each frame; defaults to `CAPSULE_TUNING.snapToGround`. */
  readonly snapToGround?: number;
  /** What the last step handed back — gravity is applied to it here. */
  readonly verticalVelocity: number;
}

/**
 * Apply gravity, ask Rapier to slide the capsule along the level, write the
 * solved pose to the body, and hand back the two things a character has to
 * carry into the next frame.
 *
 * Pure in the sense that matters for prediction and replay: given the same
 * world, the same controller and the same four inputs it produces the same
 * step, so a netcode layer can re-run it from an acknowledged state.
 */
export function advanceCapsule(step: CapsuleAdvance): CapsuleStep {
  const { collider, controller, dt, gravity, planarVelocity, position, rigidBody } = step;
  const snapDistance = step.snapToGround ?? CAPSULE_TUNING.snapToGround;
  let vertical = step.verticalVelocity + gravity * dt;

  // Snap-to-ground drags the capsule back down onto the floor it is leaving,
  // so while it is RISING it has to be off — otherwise a jump started next to
  // the ground is cancelled by the snap on the very frame it begins.
  if (vertical > 0) controller.disableSnapToGround();
  else controller.enableSnapToGround(snapDistance);

  controller.computeColliderMovement(
    collider,
    {
      x: planarVelocity.x * dt,
      y: vertical * dt,
      z: planarVelocity.z * dt,
    },
    // Sensors are triggers, not walls. Without this the solver treats a
    // checkpoint or a kill zone as solid — the capsule stops at its edge and
    // never enters it, so the intersection the trigger exists for never fires.
    // The physics step still reports that intersection, which is why excluding
    // them here costs a trigger nothing. See `EXCLUDE_SENSORS` in `rapier.ts`.
    EXCLUDE_SENSORS,
  );
  // A foothold thinner than `offset + snapToGround` is reached straight
  // through, and every symptom of that points somewhere else — see
  // `thin-foothold.ts`. Once per collider, never per frame.
  warnOnThinFootholds(controller, snapDistance);

  const solved = controller.computedMovement();
  position.x += solved.x;
  position.y += solved.y;
  position.z += solved.z;
  rigidBody.setNextKinematicTranslation(position);

  // There is no second ground probe: grounding is what the solve above already
  // decided, so it inherits that call's filter — which is the answer we want
  // anyway. Standing on a pickup is not standing.
  const grounded = controller.computedGrounded();
  // Falling stops the instant the solver says we are standing; rising does
  // not, or a jump would be cancelled while the capsule still touches the
  // floor it is leaving.
  if (grounded && vertical < 0) vertical = 0;
  return { grounded, verticalVelocity: vertical };
}

/** The per-frame call the hook hands back, and the shape netcode re-runs. */
export type AdvanceCapsule = (
  position: MutableVector3,
  planarVelocity: PlanarVelocity,
  verticalVelocity: number,
  dt: number,
) => CapsuleStep | null;
