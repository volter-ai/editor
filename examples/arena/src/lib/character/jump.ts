/**
 * Jumping: what launches the capsule.
 *
 * `resolveLaunch` is an EXTRACTION. Both shipped shooters carried the same
 * block verbatim (`examples/first-person/src/prefabs/Player.tsx`,
 * `examples/third-person/src/prefabs/Player.tsx`): a manual jump when
 * grounded, then a sweep of the level's jump pads, both funnelled through one
 * `launch()` that set the vertical velocity and cleared `grounded`. The
 * decision is what was duplicated; the sound it plays and the event it emits
 * were never the same between the two games, so this returns the launch and
 * lets the caller keep its own tone and telemetry.
 *
 * This module also carried `stepJumpTiming` — coyote time and jump buffering —
 * as NEW DESIGN, on the condition that the adoption wave wire it into a shipped
 * example. It could not be: both shooters land a jump the frame the button goes
 * down and only while grounded, and granting a ~7-frame grace after leaving a
 * ledge (or before touching down) changes when a jump fires, which is a feel
 * change neither game asked for. Unwired polish does not ship, so it was cut in
 * the adoption PR rather than left here as a function nobody calls.
 */

/** A pad's position on the ground plane. Height is the level's business. */
export interface JumpPad {
  readonly x: number;
  readonly z: number;
}

export interface Launch {
  readonly source: 'jump-pad' | 'manual';
  readonly verticalVelocity: number;
}

export interface LaunchInputs {
  /** The capsule's grounded state from the last `advanceCapsule`. */
  readonly grounded: boolean;
  /** The jump button's JUST-PRESSED edge, not its held state. */
  readonly jumpPressed: boolean;
  readonly jumpVelocity: number;
  /** How close the capsule's centre must be to a pad, metres. */
  readonly padRadius?: number;
  readonly padVelocity?: number;
  readonly pads?: readonly JumpPad[];
  readonly position: { readonly x: number; readonly z: number };
}

/** Both examples used this radius; it stays the default so neither changes. */
export const JUMP_PAD_RADIUS = 1.55;

/**
 * The launch this frame, or `null` for no launch.
 *
 * A manual jump wins over a pad the capsule happens to be standing on, which
 * is what the original ordering did — the pad sweep re-read `grounded` after
 * the manual launch had already cleared it. Apply the result yourself:
 *
 *     const launch = resolveLaunch({ …, position: here.current });
 *     if (launch) {
 *       motion.current.verticalVelocity = launch.verticalVelocity;
 *       motion.current.grounded = false;
 *       tone(launch.source === 'jump-pad' ? 390 : 190, …);
 *     }
 */
export function resolveLaunch(inputs: LaunchInputs): Launch | null {
  if (!inputs.grounded) return null;
  if (inputs.jumpPressed) return { source: 'manual', verticalVelocity: inputs.jumpVelocity };

  const padVelocity = inputs.padVelocity;
  if (padVelocity === undefined) return null;
  const radius = inputs.padRadius ?? JUMP_PAD_RADIUS;
  for (const pad of inputs.pads ?? []) {
    if (Math.hypot(inputs.position.x - pad.x, inputs.position.z - pad.z) < radius) {
      return { source: 'jump-pad', verticalVelocity: padVelocity };
    }
  }
  return null;
}
