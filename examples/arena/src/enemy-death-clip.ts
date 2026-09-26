import * as THREE from 'three';

/**
 * AUTHORED full-body death for the Redline enemies (baked humanoid,
 * Mixamo-family skeleton). The vendored clip source has no death clip and
 * the old UAL1 `Death01` cannot retarget onto this rig (Unreal/Godot
 * skeleton — rejected by the compatibility proof by design), so the death
 * is plain AnimationClip DATA like the combat reactions
 * (src/enemy-combat-clips.ts) but ABSOLUTE rather than additive: it owns
 * the whole body on the `full` layer while dead.
 *
 * Built from the LIVE rig's rest pose at init: the baked armature nodes
 * carry a cm-unit scale, so the hips position keys derive from the rest
 * values (fractions of standing hip height), never hardcoded units.
 *
 * Choreography: a short impact arch, then a straight backward topple — the
 * humanoid faces -Z, so "backward" is +Z and the topple is a NEGATIVE pitch
 * (the same sign convention the additive Flinch uses: positive X folds
 * forward). Ends clamped on the settled frame (`loop: false` →
 * `clampWhenFinished` in the binding).
 */

const X = new THREE.Vector3(1, 0, 0);

function pitchTrack(
  bone: THREE.Object3D,
  keys: readonly (readonly [timeSeconds: number, radians: number])[],
): THREE.QuaternionKeyframeTrack {
  const times: number[] = [];
  const values: number[] = [];
  const delta = new THREE.Quaternion();
  const composed = new THREE.Quaternion();
  for (const [time, angle] of keys) {
    times.push(time);
    delta.setFromAxisAngle(X, angle);
    composed.copy(bone.quaternion).multiply(delta); // bone-local pitch over rest
    values.push(composed.x, composed.y, composed.z, composed.w);
  }
  return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values);
}

export function buildEnemyDeathClip(root: THREE.Object3D): THREE.AnimationClip {
  const bone = (name: string): THREE.Object3D => {
    const found = root.getObjectByName(name);
    if (!found) throw new Error(`enemy death clip: rig is missing bone '${name}'`);
    return found;
  };
  const hips = bone('mixamorigHips');
  const spine1 = bone('mixamorigSpine1');
  const head = bone('mixamorigHead');
  const leftLeg = bone('mixamorigLeftLeg');
  const rightLeg = bone('mixamorigRightLeg');

  const p0 = hips.position.clone();
  const h = p0.y; // standing hip height in the armature's own units

  const positionTrack = new THREE.VectorKeyframeTrack(
    `${hips.name}.position`,
    [0, 0.14, 0.55, 0.72, 0.82, 1.1],
    [
      ...[p0.x, p0.y, p0.z],
      ...[p0.x, p0.y * 1.02, p0.z - h * 0.02], // impact: a slight rise, chest driven back
      ...[p0.x, p0.y * 0.52, p0.z + h * 0.2],
      ...[p0.x, p0.y * 0.16, p0.z + h * 0.36], // pelvis lands
      ...[p0.x, p0.y * 0.2, p0.z + h * 0.38], // small bounce
      ...[p0.x, p0.y * 0.15, p0.z + h * 0.38],
    ],
  );

  return new THREE.AnimationClip('Death', 1.1, [
    positionTrack,
    pitchTrack(hips, [
      [0, 0],
      [0.14, 0.1], // impact arch forward…
      [0.55, -1.05], // …then topple backward
      [0.72, -1.62],
      [0.82, -1.5],
      [1.1, -1.55],
    ]),
    // The torso keeps a slight curl so the corpse doesn't read as a plank.
    pitchTrack(spine1, [
      [0, 0],
      [0.14, 0.18],
      [0.6, 0.26],
      [1.1, 0.22],
    ]),
    pitchTrack(head, [
      [0, 0],
      [0.14, 0.22],
      [0.65, -0.35], // head lolls back with the fall
      [1.1, -0.28],
    ]),
    // Knees give way so the legs fold instead of levering the body.
    pitchTrack(leftLeg, [
      [0, 0],
      [0.5, 0.85],
      [1.1, 0.7],
    ]),
    pitchTrack(rightLeg, [
      [0, 0],
      [0.5, 0.65],
      [1.1, 0.55],
    ]),
  ]);
}
