import * as THREE from 'three';
import {
  createRestRelativeQuaternionTrack,
  type EulerDelta,
} from './lib/humanoid/rest-relative-animation';

/**
 * AUTHORED combat clips for the baked Redline enemies (Mixamo-family
 * skeleton). The vendored clip source carries only Idle/Run/TPose/Walk —
 * there is no Mixamo-family aim stance, fire, or hit reaction in-repo, and
 * the old UAL1 combat set (Pistol_Idle/Aim/Shoot, Hit_Chest) cannot
 * retarget onto this rig (Unreal/Godot skeleton — the humanoid retarget
 * contract rejects it by design). So the game authors its own as plain
 * AnimationClip DATA, the same doctrine as the player's 'Fire' loop
 * (src/player-fire-clip.ts) and the third-person example's combat clips:
 *
 * - `AimStance` — the UPPER-body combat stance the machine plays on the
 *   `upper` layer while a bot has line of sight: torso leaned into the
 *   rifle, LEFT arm raised to a bracing hold. Rest-relative and static
 *   (both keys identical), so the state-machine crossfade does the raise
 *   and the pose holds cleanly under the additive reactions.
 * - `Recoil` / `Flinch` — short ADDITIVE reactions on the `upper-action`
 *   layer (identity-delta tracks: `makeClipAdditive` subtracts frame 0, so
 *   the authored keys ARE the deltas).
 *
 * Every track deliberately avoids the RIGHT-arm chain: while aiming, the
 * right arm is procedurally posed at the player every frame after the
 * mixer samples (src/enemy-animation.ts), which would overwrite any clip
 * on those bones.
 */

const X = new THREE.Vector3(1, 0, 0);

function deltaTrack(
  bone: string,
  axis: THREE.Vector3,
  keys: readonly (readonly [timeSeconds: number, radians: number])[],
): THREE.QuaternionKeyframeTrack {
  const times: number[] = [];
  const values: number[] = [];
  const q = new THREE.Quaternion();
  for (const [time, angle] of keys) {
    times.push(time);
    q.setFromAxisAngle(axis, angle);
    values.push(q.x, q.y, q.z, q.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values);
}

export const AIM_STANCE_CLIP_NAME = 'AimStance';
const AIM_STANCE_DURATION = 1;
const AIM_TIMES = [0, AIM_STANCE_DURATION] as const;

/** Static held pose: both keys identical (loop-seamless by construction).
 *  Axis conventions probed for the player's fire clip (character faces −Z):
 *  LeftArm −x swings forward, +z lowers; ForeArms hinge with the arm's sign. */
function hold(pose: EulerDelta): readonly EulerDelta[] {
  return [pose, pose];
}

/** Build the upper-body aim stance against the loaded baked rig's rest pose
 *  (bones are read at init, before any mixer runs, so locals are still rest). */
export function buildAimStanceClip(root: THREE.Object3D): THREE.AnimationClip {
  const bone = (name: string): THREE.Bone => {
    const found = root.getObjectByName(name);
    if (!(found instanceof THREE.Bone))
      throw new Error(`enemy aim stance requires bone '${name}' on the baked model`);
    return found;
  };
  const track = (name: string, pose: EulerDelta) =>
    createRestRelativeQuaternionTrack(bone(name), AIM_TIMES, hold(pose));

  return new THREE.AnimationClip(AIM_STANCE_CLIP_NAME, AIM_STANCE_DURATION, [
    // Torso leans into the rifle line.
    track('mixamorigSpine1', [0.09, 0, 0]),
    track('mixamorigSpine2', [0.07, 0, 0]),
    // Left arm raised forward into a bracing hold under the rifle.
    track('mixamorigLeftArm', [-1.02, 0, 0.24]),
    track('mixamorigLeftForeArm', [-0.62, 0, 0]),
  ]);
}

/** Rifle fire: a sharp upper-body jolt — chest rocks back then settles.
 *  Duration matches the machine's firing window (0.42 s). */
export function buildRecoilClip(): THREE.AnimationClip {
  return new THREE.AnimationClip('Recoil', 0.42, [
    deltaTrack('mixamorigSpine1', X, [
      [0, 0],
      [0.05, -0.06],
      [0.16, -0.02],
      [0.42, 0],
    ]),
    deltaTrack('mixamorigSpine2', X, [
      [0, 0],
      [0.05, -0.09],
      [0.18, -0.025],
      [0.42, 0],
    ]),
    deltaTrack('mixamorigHead', X, [
      [0, 0],
      [0.06, -0.05],
      [0.2, 0],
      [0.42, 0],
    ]),
  ]);
}

/** Taking damage: a chest flinch — fold forward briefly, head dips.
 *  Duration matches the machine's hit window (0.34 s). */
export function buildFlinchClip(): THREE.AnimationClip {
  return new THREE.AnimationClip('Flinch', 0.34, [
    deltaTrack('mixamorigSpine1', X, [
      [0, 0],
      [0.07, 0.14],
      [0.22, 0.05],
      [0.34, 0],
    ]),
    deltaTrack('mixamorigSpine2', X, [
      [0, 0],
      [0.07, 0.1],
      [0.22, 0.03],
      [0.34, 0],
    ]),
    deltaTrack('mixamorigHead', X, [
      [0, 0],
      [0.08, 0.12],
      [0.24, 0.03],
      [0.34, 0],
    ]),
  ]);
}
