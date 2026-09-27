/**
 * Character — the kinematic step primitive, and the polish around it.
 *
 * This capability is a set of FUNCTIONS. It is deliberately not a character
 * system, not a controller component, and not a thing your game is programmed
 * against: it never reads input, never touches a camera, and never owns a
 * frame loop. You keep your `useFrame`; these are the parts of it that every
 * 3D character re-derives.
 *
 * The core is `advanceCapsule` — apply gravity, ask Rapier's
 * `KinematicCharacterController` to slide the capsule along the level, and
 * hand back `{ grounded, verticalVelocity }`. It was two byte-identical copies
 * of the same hook in the shipped shooters; every tuning constant they baked
 * in is a parameter here, defaulted to their values.
 *
 * Two lines inside it are the whole reason a hand-rolled character controller
 * feels broken, and both are load-bearing:
 *
 *  - snap-to-ground is DISABLED while vertical velocity is positive, or the
 *    snap cancels a jump started next to the floor;
 *  - vertical velocity is zeroed only when `grounded && vertical < 0`, never
 *    on `grounded` alone, or the jump dies on the frame the capsule is still
 *    touching the floor it is leaving.
 *
 * One constraint the level has to hold up its end of: every foothold needs a
 * solid collider at least `offset + snapToGround` thick — 0.47 m with the
 * defaults below — because the solver probes that far through anything it
 * stands on, and a thinner slab is reached straight through (ground contact
 * flickers, then the capsule falls through). The visual stays whatever size it
 * was authored; only the collider has to be solid. `advanceCapsule` warns once
 * per offending collider rather than leaving you to find it — see
 * `thin-foothold.ts`.
 *
 * Around that: `resolveLaunch` (jump + jump-pad decision), `pullInBoom` (camera
 * occlusion), `shake`/`stepShake`/`shakeOffset`, and `frameAim`/`stepAimBlend`
 * (hip↔aim framing). All pure, all constants-as-parameters. Coyote time and
 * jump buffering were designed alongside these and CUT — see `jump.ts` for
 * why: unwired polish does not ship.
 *
 * Copied in, yours to edit. The game composes these functions in its own
 * character prefab; this capability deliberately supplies no rival controller
 * component or frame owner.
 */

export {
  BOOM_PADDING,
  type BoomInputs,
  type CameraFraming,
  frameAim,
  type Point3,
  pullInBoom,
  SHAKE_IDLE,
  SHAKE_OFFSET,
  type ShakeOffsetOptions,
  type ShakeState,
  shake,
  shakeOffset,
  stepAimBlend,
  stepShake,
} from './camera';
export {
  JUMP_PAD_RADIUS,
  type JumpPad,
  type Launch,
  type LaunchInputs,
  resolveLaunch,
} from './jump';
export {
  type AdvanceCapsule,
  advanceCapsule,
  CAPSULE_TUNING,
  type CapsuleAdvance,
  type CapsuleStep,
  type CapsuleTuning,
  createCapsuleController,
  type MutableVector3,
  type PlanarVelocity,
} from './kinematic-capsule';
export {
  depenetrateKinematicSpawn,
  type DepenetrateKinematicSpawnOptions,
  type KinematicSpawnBody,
  type KinematicSpawnWorld,
  type SpawnRotation,
  type SpawnVector3,
} from './spawn-depenetration';
export {
  type CapsuleController,
  // Exported because a game that adds its OWN scene query — a ledge probe, a
  // "what am I looking at" ray — owes it the same decision every query in here
  // makes, and should not have to re-derive the bit.
  EXCLUDE_SENSORS,
  type QueryFilterFlags,
  type RapierCollider,
  type RapierRigidBody,
  type RapierWorld,
  type RayFactory,
} from './rapier';
export { MEASURED_SHAPE_TYPES, warnOnThinFootholds } from './thin-foothold';
export { useKinematicCapsule } from './use-kinematic-capsule';
