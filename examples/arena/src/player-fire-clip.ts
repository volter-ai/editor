/**
 * PROJECT-AUTHORED 'Fire' clip for the Arena Vanguard player body.
 *
 * No Mixamo-family attack/fire clip exists in-repo (the vendored soldier
 * fixture carries Idle/Run/TPose/Walk only), so the game composes its own —
 * the same doctrine as the capability's BreathingWave demo clip: rest-relative
 * project data over the rig, no engine edits, no capability-file edits (the
 * bake tool stays clip-source-only; this clip is built at runtime against
 * the LOADED baked rig's rest pose and appended to the clip map).
 *
 * Pose language (bone-local euler deltas, probed against the generated
 * skeleton — see the axis table below): a two-handed aim with both arms
 * raised forward at chest height, looping a sharp recoil kick (arms pulse
 * up, elbows compress, a small spine snap). Loop-seamless: first and last
 * keys are the identical aim pose, so sustained rifle fire reads as
 * repeated kicks and the state-machine crossfade handles entry/exit blends.
 *
 * Probed axis conventions (character faces −Z, T-pose rest):
 *   RightArm  +x swings the arm forward; +z lowers it.
 *   LeftArm   −x swings the arm forward; +z lowers it.
 *   ForeArms  hinge forward with the same sign as their arm's swing.
 */

import * as THREE from 'three';
import {
  createRestRelativeQuaternionTrack,
  type EulerDelta,
} from './lib/humanoid/rest-relative-animation';

export const FIRE_CLIP_NAME = 'Fire';
const FIRE_CLIP_DURATION = 0.36;
const TIMES = [0, 0.05, 0.16, FIRE_CLIP_DURATION] as const;

/** aim → kick → aim → aim (t0 == tEnd for a seamless loop). */
function cycle(aim: EulerDelta, kick: EulerDelta): readonly EulerDelta[] {
  return [aim, kick, aim, aim];
}

/** Build the fire clip against the loaded baked model's rest pose. Bones are
 *  read BEFORE any mixer runs, so their local transforms are still rest. */
export function createVanguardFireClip(root: THREE.Object3D): THREE.AnimationClip {
  const bone = (name: string): THREE.Bone => {
    const found = root.getObjectByName(name);
    if (!(found instanceof THREE.Bone))
      throw new Error(`Vanguard fire clip requires bone '${name}' on the baked player model.`);
    return found;
  };
  const track = (name: string, aim: EulerDelta, kick: EulerDelta) =>
    createRestRelativeQuaternionTrack(bone(name), TIMES, cycle(aim, kick));

  return new THREE.AnimationClip(FIRE_CLIP_NAME, FIRE_CLIP_DURATION, [
    track('mixamorigRightArm', [1.32, 0, 0.1], [1.36, 0, -0.08]),
    track('mixamorigLeftArm', [-1.32, 0, 0.1], [-1.36, 0, -0.08]),
    track('mixamorigRightForeArm', [0.35, 0, 0], [0.55, 0, 0]),
    track('mixamorigLeftForeArm', [-0.35, 0, 0], [-0.55, 0, 0]),
    track('mixamorigSpine1', [0, 0, 0], [0.07, 0, 0]),
  ]);
}
