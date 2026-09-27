/**
 * The removable reference humanoid's Mixamo-compatible skeleton and rest pose,
 * built ENTIRELY from `THREE.Bone` (no imported mesh, no loader). Promoted
 * from the accepted Phase-1 feasibility PoC
 * (`packages/engine/e2e/humanoid-skin-proof/`), which proved that a skeleton
 * with these names and this rest pose plays standard Mixamo-named clips.
 *
 * Naming standard: **Mixamo** (`mixamorigHips`, `mixamorigSpine`, …) — the
 * de-facto interchange standard for free humanoid clip libraries, and the
 * naming of the repo's vendored clip source
 * (`examples/rts/public/models/Soldier.glb`). Names are the
 * post-`PropertyBinding.sanitizeNodeName` form (`mixamorig:Hips` →
 * `mixamorigHips`), i.e. the names GLTFLoader gives clip tracks;
 * `humanoid/clips.ts` maps the other spellings (`mixamorig:` / `mixamorig_` /
 * bare) onto these. The three FACE joints at the end of the table are the one
 * deliberate exception — see the comment there.
 *
 * Rest pose: the reference rig's own T-pose. The table below is pure DATA —
 * per-bone local translation (cm, the rig's native Mixamo unit) + local rest
 * quaternion — extracted ONCE from Soldier.glb's node hierarchy (see the
 * provenance note above the table). At runtime nothing is loaded:
 * `buildHumanoidSkeleton` composes plain `THREE.Bone`s from this table.
 *
 * Body-type parameterization: `scaleSkeletonDef` rescales the table's
 * translations (never the rest rotations) from authored `HumanoidParams` —
 * per-segment length multipliers, lateral width multipliers, and a final
 * uniform height normalization — then re-grounds the hips so the feet keep
 * the reference rig's ground clearance. See that function's comment for the
 * exact clip-compatibility contract this preserves.
 */

import * as THREE from 'three';
import { threeBoneName } from './armature-bones';
import { HUMANOID_BONE_ROLES, HUMANOID_ROLE_BONES, type HumanoidBoneRole } from './bone-roles';
import type { ResolvedHumanoidParams } from './schema';

/**
 * Crown padding: how far the body's highest point (the hair cap's crown)
 * rests above the `mixamorigHeadTop_End` joint at reference scale, per unit
 * of headSize. `generate.ts` feeds this (× headSize) to the skeleton height
 * normalization so a requested `height` lands exactly on the visual crown.
 * Measured from the built SMOOTH default (via generateHumanoid at headSize
 * 0.8/1.0/1.5 — exactly linear): crown − headTopY = 0.00405 × headSize (the
 * smooth hair cap pole sits the smooth spec's `headScalp.scalp` top + 5.5 mm
 * offset above the skull, projected onto world Y). This used to be exported
 * as `HEAD_CAPSULE_RADIUS`, a name inherited from the retired capsule body
 * whose head radius played this role — the value never was a radius, so the
 * name was renamed to what it measures.
 */
export const CROWN_PADDING_M = 0.00405;

/** One bone: sanitized Mixamo name, parent row index (-1 = root), local
 *  rest translation [x,y,z] in the rig's native cm units, local rest
 *  quaternion [x,y,z,w]. */
export type BoneDef = readonly [
  name: string,
  parentIndex: number,
  translation: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
];

/**
 * Provenance: generated from `examples/rts/public/models/Soldier.glb`
 * (the three.js example Mixamo soldier vendored by the RTS example) by
 * parsing the GLB JSON chunk and walking `skins[0].joints[0]`'s node
 * subtree — 65 bones, covering all 52 nodes the GLB's Idle/Run/TPose/Walk
 * clips animate. (The table's last three rows are NOT from that extraction —
 * they are this lib's own face joints; see the comment above them.)
 * Extraction (node):
 *
 *   const json = JSON.parse(glb.slice(20, 20 + glb.readUInt32LE(12)));
 *   walk(hipsNode, n => [name(n).replace(/[\[\]\.:\/]/g, ''), parentRow,
 *                        n.translation ?? [0,0,0], n.rotation ?? [0,0,0,1]]);
 */
// The rig's ±90° rest rotations serialize as ~0.7071 in the GLB; Math.SQRT1_2
// is the exact intent.
const R2 = Math.SQRT1_2;

export const MIXAMO_SKELETON_DEF: readonly BoneDef[] = [
  ['mixamorigHips', -1, [-0.1602, 1.147488, 106.130768], [0, R2, R2, 0]],
  ['mixamorigSpine', 0, [-0.038121, 9.490517, -1.392063], [0, 0, 0, 1]],
  ['mixamorigSpine1', 1, [-0.044231, 11.072289, -1.624071], [0, 0, 0, 1]],
  ['mixamorigSpine2', 2, [-0.050549, 12.654045, -1.856082], [0, 0, 0, 1]],
  ['mixamorigNeck', 3, [-0.056868, 14.235764, -2.088092], [0, 0, 0, 1]],
  ['mixamorigHead', 4, [0, 3.280212, 0.313332], [0, 0, 0, 1]],
  ['mixamorigHeadTop_End', 5, [0, 25.653503, 2.450463], [0, 0, 0, 1]],
  ['mixamorigLeftShoulder', 3, [6.728773, 11.756622, -2.05846], [R2, R2, 0, 0]],
  // Arm socket moved to the anatomical site (owner-caught, quaternius PoC):
  // the source rig hung the arm 3.9 cm too high and 1.7 cm too far outboard
  // vs the UAL1 reference at matched head height (measured: ours y 1.479
  // |x| 0.209 vs reference y 1.441 |x| 0.192). Local frame: x runs down the
  // spine, y runs lateral along the clavicle.
  ['mixamorigLeftArm', 7, [-7.028758, 12.394679, -0.059263], [0, 0, 0, 1]],
  ['mixamorigLeftForeArm', 8, [0.000015, 23.160294, 0], [0, 0, 0, 1]],
  ['mixamorigLeftHand', 9, [0.000036, 24.07176, 0.000015], [0, 0, 0, 1]],
  ['mixamorigLeftHandThumb1', 10, [-1.925056, 4.173385, -1.510903], [0, 0, 0, 1]],
  ['mixamorigLeftHandThumb2', 11, [-1.730873, 2.998001, -1.730855], [0, 0, 0, 1]],
  ['mixamorigLeftHandThumb3', 12, [-2.106666, 3.648872, -2.106638], [0, 0, 0, 1]],
  ['mixamorigLeftHandThumb4', 13, [-1.712988, 2.967014, -1.712967], [0, 0, 0, 1]],
  ['mixamorigLeftHandIndex1', 10, [-0.395972, 14.669356, -2.855875], [0, 0, 0, 1]],
  ['mixamorigLeftHandIndex2', 15, [-0.000021, 3.24861, -0.000036], [0, 0, 0, 1]],
  ['mixamorigLeftHandIndex3', 16, [0.000013, 2.659588, -0.000042], [0, 0, 0, 1]],
  ['mixamorigLeftHandIndex4', 17, [0.000012, 3.633183, -0.00002], [0, 0, 0, 1]],
  ['mixamorigLeftHandMiddle1', 10, [0.000009, 14.409812, -0.000004], [0, 0, 0, 1]],
  ['mixamorigLeftHandMiddle2', 19, [-0.000006, 3.25907, -0.000035], [0, 0, 0, 1]],
  ['mixamorigLeftHandMiddle3', 20, [-0.000003, 2.639858, -0.000025], [0, 0, 0, 1]],
  ['mixamorigLeftHandMiddle4', 21, [-0.000006, 3.673858, -0.000035], [0, 0, 0, 1]],
  ['mixamorigLeftHandRing1', 10, [0.318856, 13.191451, 3.305259], [0, 0, 0, 1]],
  ['mixamorigLeftHandRing2', 23, [-0.000007, 2.717635, -0.000018], [0, 0, 0, 1]],
  ['mixamorigLeftHandRing3', 24, [0.000012, 2.134457, 0.000041], [0, 0, 0, 1]],
  ['mixamorigLeftHandRing4', 25, [0, 2.786875, -0.000016], [0, 0, 0, 1]],
  ['mixamorigLeftHandPinky1', 10, [-0.521934, 11.636352, 5.613723], [0, 0, 0, 1]],
  ['mixamorigLeftHandPinky2', 27, [-0.000007, 1.559371, 0], [0.000002, -0.000002, 0, 1]],
  ['mixamorigLeftHandPinky3', 28, [0.000001, 1.540605, -0.000013], [-0.000002, 0.000002, 0, 1]],
  ['mixamorigLeftHandPinky4', 29, [-0.000003, 1.668713, 0], [-0.000002, 0.000002, 0.000005, 1]],
  ['mixamorigRightShoulder', 3, [-6.823778, 11.756622, -2.117723], [0, 0, R2, R2]],
  // Mirrored arm-socket move — see the LeftArm note above.
  ['mixamorigRightArm', 31, [-7.033563, 12.357526, -0.05926], [0, 0, 0, 1]],
  ['mixamorigRightForeArm', 32, [0, 23.1602, 0], [0, 0, 0, 1]],
  ['mixamorigRightHand', 33, [-0.000015, 24.14341, -0.000017], [0, 0, 0, 1]],
  ['mixamorigRightHandThumb1', 34, [-2.027328, 4.192596, 1.472372], [0, 0, 0, 1]],
  ['mixamorigRightHandThumb2', 35, [-1.747421, 3.026642, 1.747453], [0, 0, 0, 1]],
  ['mixamorigRightHandThumb3', 36, [-2.123373, 3.677785, 2.1234], [0, 0, 0, 1]],
  ['mixamorigRightHandThumb4', 37, [-1.693868, 2.933862, 1.693906], [0, 0, 0, 1]],
  ['mixamorigRightHandIndex1', 34, [-0.40802, 14.636856, 3.083014], [0, 0, 0, 1]],
  ['mixamorigRightHandIndex2', 39, [0, 3.21624, 0.000026], [0, 0, 0, 1]],
  ['mixamorigRightHandIndex3', 40, [0.000015, 2.638268, 0.000045], [0, 0, 0, 1]],
  ['mixamorigRightHandIndex4', 41, [0, 3.65332, 0.000027], [0, 0, 0, 1]],
  ['mixamorigRightHandMiddle1', 34, [0.000031, 14.530449, -0.000024], [0, 0, 0, 1]],
  ['mixamorigRightHandMiddle2', 43, [0, 3.12674, 0], [0, 0, 0, 1]],
  ['mixamorigRightHandMiddle3', 44, [0.000008, 2.672478, 0.000014], [0, 0, 0, 1]],
  ['mixamorigRightHandMiddle4', 45, [-0.042618, 3.130852, 0.057592], [0, 0, 0, 1]],
  ['mixamorigRightHandRing1', 34, [0.19577, 12.771111, -2.96601], [0, 0, 0, 1]],
  ['mixamorigRightHandRing2', 47, [0.000015, 2.512802, -0.000039], [0, 0, 0, 1]],
  ['mixamorigRightHandRing3', 48, [-0.000015, 2.197067, 0.000041], [0, 0, 0, 1]],
  ['mixamorigRightHandRing4', 49, [0, 3.068436, 0], [0, 0, 0, 1]],
  ['mixamorigRightHandPinky1', 34, [-0.461517, 11.750786, -5.650592], [0, 0, 0, 1]],
  ['mixamorigRightHandPinky2', 51, [-0.000015, 1.67952, 0.000027], [0, 0, 0, 1]],
  ['mixamorigRightHandPinky3', 52, [0, 1.364082, 0.000023], [0, 0, 0, 1]],
  ['mixamorigRightHandPinky4', 53, [0, 1.668221, 0.000039], [0, 0, 0, 1]],
  ['mixamorigLeftUpLeg', 0, [9.618273, -5.272293, -1.010886], [1, 0, 0, 0]],
  ['mixamorigLeftLeg', 55, [0.116409, 43.344528, -1.323286], [0, 0, 0, 1]],
  ['mixamorigLeftFoot', 56, [-0.102314, 44.292152, 4.219776], [-R2, 0, 0, R2]],
  ['mixamorigLeftToeBase', 57, [2.599463, 15.813891, 11.814322], [0, 0, 0, 1]],
  ['mixamorigLeftToe_End', 58, [1.22305, 7.973637, -0.044495], [0, 0, 0, 1]],
  ['mixamorigRightUpLeg', 0, [-9.940967, -5.27272, -1.211655], [1, 0, 0, 0]],
  ['mixamorigRightLeg', 60, [-0.103974, 43.304852, -2.031704], [0, 0, 0, 1]],
  ['mixamorigRightFoot', 61, [0.117103, 44.331413, 4.727186], [-R2, 0, 0, R2]],
  ['mixamorigRightToeBase', 62, [-2.599469, 15.99981, 11.814546], [0, 0, 0, 1]],
  ['mixamorigRightToe_End', 63, [-1.223054, 7.92706, -0.044394], [0, 0, 0, 1]],
  // --- The FACE joints: VRM's optional set, and NOT Mixamo bones ------------
  // Deliberately plain names, not `mixamorigJaw`/`mixamorigLeftEye`/
  // `mixamorigRightEye`: pretending they are Mixamo would invite retargeters
  // and external tools to treat them as interchange bones, which they are not
  // (no Mixamo clip animates them, and both retargeters here map source→target
  // BY NAME and simply never write an unmapped target bone). Semantic lookup
  // goes through the role map (`bone-roles.ts`), never a string match.
  //
  // They are APPENDED, not interleaved, on purpose: row order defines
  // skinIndex, so appending leaves every existing weight untouched.
  //
  // Rest placement, in the Head bone's own frame (local +Y up the body, +Z
  // toward the FACE, +X toward the character's LEFT — the head's frame is
  // mirrored vs model X): the jaw hinge sits 9.5 cm up the head axis and
  // 1 cm in front of it (the temporomandibular joint, ~40% back through the
  // sculpt's skull); the eyes sit on the eye line the brow bands mark
  // (station d 0.126) at the sculpt's own eye offset (±3.15 cm lateral),
  // recessed 1 cm behind the 13.7 cm face plane so unit 3's eyeballs sit in
  // sockets rather than proud of the face. Nothing is skinned to the eyes.
  ['jaw', 5, [0, 9.456954, 1.903343], [0, 0, 0, 1]],
  ['leftEye', 5, [3.15, 12.542907, 13.898118], [0, 0, 0, 1]],
  ['rightEye', 5, [-3.15, 12.542907, 13.898118], [0, 0, 0, 1]],
];

/** The hierarchy root bone's canonical name. */
export const HUMANOID_HIPS_BONE = 'mixamorigHips';

// --- The derived skeleton contract -------------------------------------------
//
// Everything anyone else needs to know about this skeleton is DERIVED from
// the def table above, so adding or renaming a bone chain is a ONE-SITE edit.
// Never restate a bone count, a bone-name list or a role's bone anywhere
// else in production code: import these instead.

/** How many bones the def table declares. Derived — never hardcode the count.
 *  (`humanoid-skeleton.test.ts` deliberately keeps a literal beside a
 *  comparison against the table: that literal is a TRIPWIRE for an accidental
 *  change to the shipped rig, not a second source of truth.) */
export const HUMANOID_BONE_COUNT = MIXAMO_SKELETON_DEF.length;

/** Every bone name, in def-table (skinIndex) order. Derived. */
export const HUMANOID_BONE_NAMES: readonly string[] = MIXAMO_SKELETON_DEF.map(([name]) => name);

const BONE_NAME_SET = new Set(HUMANOID_BONE_NAMES);

/** Does this skeleton declare a bone by that exact (sanitized Mixamo) name? */
export function hasHumanoidBone(name: string): boolean {
  return BONE_NAME_SET.has(name);
}

/**
 * The bone a semantic role resolves to on THIS skeleton (see
 * `bone-roles.ts`), or `null` for a role this rig has no joint for (`root`).
 * Throws when the role map names a bone the def table does not declare —
 * i.e. when someone renamed a bone in one place and not the other.
 */
export function humanoidRoleBone(role: HumanoidBoneRole): string | null {
  const bone = HUMANOID_ROLE_BONES[role];
  if (bone !== null && !BONE_NAME_SET.has(bone)) {
    throw new Error(
      `humanoid: bone role '${role}' maps to '${bone}', which MIXAMO_SKELETON_DEF does not ` +
        'declare — reconcile bone-roles.ts with skeleton.ts',
    );
  }
  return bone;
}

/** Prove the whole semantic role map resolves against the def table. Cheap
 *  and callable from anywhere; deliberately NOT run at import time, so a fork
 *  mid-edit still boots and sees the failure where it looks for it. */
export function assertHumanoidRoleMap(): void {
  for (const role of HUMANOID_BONE_ROLES) humanoidRoleBone(role);
}

/**
 * Replace shipped rest-pose LOCAL TRANSLATIONS with a spec's own proportion
 * table (`HumanoidBodySpec.restTranslations`) — the PROPORTION seam the
 * low-poly/chibi lane rides. Same bones, same hierarchy, same rest
 * ROTATIONS — which is exactly what keeps every retargeted clip valid:
 * rotation tracks are rest-frame-relative, and the frames don't move — only
 * the joint STATIONS do. Values are in the def table's native Z-up cm.
 *
 * The stylization range this exists for is real: the shipped low-poly table
 * (`body-spec-lowpoly.ts`) puts the hips at 17.5% of standing height where
 * the reference rig has 58% — far outside what `HumanoidParams`' per-group
 * multipliers were scoped for, and per-JOINT (a chibi skull pivot must sit
 * at the chibi head base, not at a scaled-reference station).
 *
 * A key naming no table bone is a loud throw (a typo'd bone must never
 * silently keep reference proportions). NEUTRALITY: undefined/empty returns
 * `base` ITSELF — byte-identical to a world without this seam.
 */
export function applyRestTranslations(
  overrides: Readonly<Record<string, readonly [number, number, number]>> | undefined,
  base: readonly BoneDef[] = MIXAMO_SKELETON_DEF,
): readonly BoneDef[] {
  if (overrides === undefined || Object.keys(overrides).length === 0) return base;
  const names = new Set(base.map(([name]) => name));
  for (const key of Object.keys(overrides)) {
    if (!names.has(key)) {
      throw new Error(
        `humanoid: restTranslations names bone '${key}', which the skeleton def table does ` +
          'not declare — proportion overrides move existing joints, never invent bones ' +
          '(extraBones is the new-bone seam)',
      );
    }
  }
  return base.map(([name, parent, t, r]) => {
    const o = overrides[name];
    return o
      ? ([name, parent, [o[0], o[1], o[2]], r] as BoneDef)
      : ([name, parent, t, r] as BoneDef);
  });
}

/**
 * Append a spec's own bone chain (`HumanoidBodySpec.extraBones` — a tail, long
 * ears, an extra arm) to the shipped def table.
 *
 * The FORK recipe stays "edit the def table in your copy": that is right when
 * every character in your game has the chain. This is the SPEC path, for when
 * ONE character does — the same relationship `customParts` has to the shipped
 * part builders, and it appends for the same reason the face joints do (row
 * order defines skinIndex, so appending leaves every existing weight on its
 * bone; interleaving would silently re-point them).
 *
 * A row's `parentIndex` may reference a base row or an EARLIER extra row —
 * `buildHumanoidSkeleton` walks the table once and requires parents to
 * precede children, so a forward or out-of-range reference is a loud throw
 * here rather than a `bones[parent]` crash later. A name already on the table
 * is equally loud: `byName` would silently keep the last one, and every
 * name-keyed lookup in the lib (roles, retargeting, sockets) would resolve to
 * a bone the author did not mean.
 *
 * NEUTRALITY: no extras returns the shipped table ITSELF, so a spec without
 * `extraBones` builds byte-for-byte what it built before this seam existed.
 */
export function appendExtraBones(
  extra: readonly BoneDef[] | undefined,
  base: readonly BoneDef[] = MIXAMO_SKELETON_DEF,
): readonly BoneDef[] {
  if (extra === undefined || extra.length === 0) return base;
  const defs: BoneDef[] = [...base];
  const names = new Set(base.map(([name]) => name));
  for (const row of extra) {
    const [name, parentIndex] = row;
    if (names.has(name)) {
      throw new Error(
        `humanoid: extraBones row '${name}' collides with a bone the skeleton already ` +
          'declares — extra bones must have new names (lookups are by name)',
      );
    }
    if (!Number.isInteger(parentIndex) || parentIndex < 0 || parentIndex >= defs.length) {
      throw new Error(
        `humanoid: extraBones row '${name}' has parent index ${parentIndex}, which is not a ` +
          `row that precedes it (valid: 0..${defs.length - 1} — base rows, then earlier extras)`,
      );
    }
    names.add(name);
    defs.push(row);
  }
  return defs;
}

/** The source rig's armature transform ("Character" node in Soldier.glb):
 *  Mixamo exports Z-up centimetres; this maps the rig into the scene's
 *  Y-up metres. Applied to the Group the root bone is parented under. */
export const ARMATURE_ROTATION_X = -Math.PI / 2;
export const ARMATURE_SCALE = 0.01;

export interface BuiltSkeleton {
  /** `mixamorigHips` — the hierarchy root. */
  root: THREE.Bone;
  /** All bones in `MIXAMO_SKELETON_DEF` row order (this order defines skinIndex values). */
  bones: THREE.Bone[];
  /** Bones by name — under the THREE spelling every bone carries, and
   *  additionally under the armature-document spelling whenever the two
   *  differ (a Blender-named `Arm.L` becomes the bone `Arm_L`, and BOTH
   *  strings resolve here). See `threeBoneName` for the boundary and why it
   *  is one-way. */
  byName: Map<string, THREE.Bone>;
}

/**
 * Build the standard humanoid bone hierarchy from the pure-data table —
 * plain `THREE.Bone`s wired parent→child with the source rest pose.
 *
 * THIS IS THE NAME BOUNDARY (see `threeBoneName`): a row's name is the
 * ARMATURE DOCUMENT's, which for a Blender-authored rig may carry `.L`/`.R`
 * or a `.001` disambiguator, and a `THREE.Bone` named with a dot silently
 * loses it through `PropertyBinding.sanitizeNodeName` on the next GLB round
 * trip. So the BONE is named `threeBoneName(row)` and `byName` also keeps
 * the row's own spelling, which is what lets a pose session, a retarget map
 * or a socket table go on saying `'Arm.L'`. Rows with no dot — the shipped
 * Mixamo table, and any rig authored in the `_L`/`_R` spelling — are
 * untouched, so nothing that worked before this boundary existed moves.
 */
export function buildHumanoidSkeleton(
  defs: readonly BoneDef[] = MIXAMO_SKELETON_DEF,
): BuiltSkeleton {
  const bones: THREE.Bone[] = [];
  const byName = new Map<string, THREE.Bone>();
  for (const [name, parentIndex, t, r] of defs) {
    const bone = new THREE.Bone();
    const threeName = threeBoneName(name);
    if (threeName !== name && byName.has(threeName)) {
      throw new Error(
        `humanoid: bone '${name}' becomes '${threeName}' on the three side (see ` +
          `threeBoneName), which another row already claims. Two Blender names that differ ` +
          'only by `.` vs `_` cannot both be exported — rename one in the armature document.',
      );
    }
    bone.name = threeName;
    bone.position.set(t[0], t[1], t[2]);
    bone.quaternion.set(r[0], r[1], r[2], r[3]);
    bones.push(bone);
    byName.set(threeName, bone);
    // The document spelling stays addressable — see `BuiltSkeleton.byName`.
    if (threeName !== name) byName.set(name, bone);
    // Non-null: the table is topologically ordered (parents precede children).
    if (parentIndex >= 0) bones[parentIndex]!.add(bone);
  }
  return { root: bones[0]!, bones, byName };
}

/** Wrap a built bone hierarchy in the standard armature group (the Z-up-cm →
 *  Y-up-m transform every def-table translation is authored against). */
export function createArmatureGroup(rig: BuiltSkeleton): THREE.Group {
  const armature = new THREE.Group();
  armature.name = 'Armature';
  armature.rotation.x = ARMATURE_ROTATION_X;
  armature.scale.setScalar(ARMATURE_SCALE);
  armature.add(rig.root);
  return armature;
}

// --- Body-type scaling -----------------------------------------------------

/** Segment-length groups: each named bone's LOCAL TRANSLATION (= the length of
 *  the segment ending at that bone) scales by the group's multiplier. Rest
 *  rotations are never touched — clips own rotations at play time. */
const TORSO_LENGTH_BONES = new Set([
  'mixamorigSpine',
  'mixamorigSpine1',
  'mixamorigSpine2',
  'mixamorigNeck',
  'mixamorigHead',
]);
// The face joints live INSIDE the skull, so they scale with it exactly as the
// head-top marker does — otherwise a big-headed character's jaw hinge stays at
// the reference skull's station.
const HEAD_LENGTH_BONES = new Set(['mixamorigHeadTop_End', 'jaw', 'leftEye', 'rightEye']);
const ARM_LENGTH_BONES = new Set([
  'mixamorigLeftForeArm',
  'mixamorigLeftHand',
  'mixamorigRightForeArm',
  'mixamorigRightHand',
]);
const LEG_LENGTH_BONES = new Set([
  'mixamorigLeftLeg',
  'mixamorigLeftFoot',
  'mixamorigRightLeg',
  'mixamorigRightFoot',
]);
/** Clavicles (Shoulder→Arm): mostly lateral in the T-pose — whole-vector
 *  scaled by shoulderWidth. */
const CLAVICLE_BONES = new Set(['mixamorigLeftArm', 'mixamorigRightArm']);
/** Shoulder roots off Spine2: X is lateral in the spine frame. */
const SHOULDER_X_BONES = new Set(['mixamorigLeftShoulder', 'mixamorigRightShoulder']);
/** Upper-leg roots off Hips: X is lateral in the hips frame. */
const HIP_X_BONES = new Set(['mixamorigLeftUpLeg', 'mixamorigRightUpLeg']);

/** Joints whose lowest world-Y point defines the rig's ground clearance. */
const GROUND_JOINTS = [
  'mixamorigLeftFoot',
  'mixamorigRightFoot',
  'mixamorigLeftToeBase',
  'mixamorigRightToeBase',
  'mixamorigLeftToe_End',
  'mixamorigRightToe_End',
];

interface SkeletonMeasure {
  /** Lowest ground-joint world Y (metres). */
  minFootY: number;
  /** `mixamorigHeadTop_End` world Y (metres). */
  headTopY: number;
}

/** Build the defs under a throwaway armature and read rest-pose world heights. */
function measureSkeleton(defs: readonly BoneDef[]): SkeletonMeasure {
  const rig = buildHumanoidSkeleton(defs);
  const armature = createArmatureGroup(rig);
  armature.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  let minFootY = Number.POSITIVE_INFINITY;
  for (const name of GROUND_JOINTS) {
    const bone = rig.byName.get(name);
    if (!bone) throw new Error(`humanoid: skeleton def is missing ground joint '${name}'`);
    p.setFromMatrixPosition(bone.matrixWorld);
    if (p.y < minFootY) minFootY = p.y;
  }
  const headTop = rig.byName.get('mixamorigHeadTop_End');
  if (!headTop) throw new Error("humanoid: skeleton def is missing 'mixamorigHeadTop_End'");
  p.setFromMatrixPosition(headTop.matrixWorld);
  return { minFootY, headTopY: p.y };
}

export interface ScaledSkeletonDef {
  /** The rescaled bone table — feed to `buildHumanoidSkeleton`. */
  defs: readonly BoneDef[];
  /** The uniform factor applied to EVERY dimension at the end (1 when
   *  `params.height` is omitted). Body geometry radii must scale by this
   *  so proportions survive the height normalization. */
  heightFactor: number;
  /** Realized standing height, metres, measured to the head-top joint plus
   *  `crownPadding` (how far the body's crown sits above that joint — see
   *  {@link CROWN_PADDING_M}). */
  height: number;
  /** |scaled hips rest translation| / |reference hips rest translation| —
   *  the factor `clips.ts` multiplies hips `.position` tracks by, so root
   *  motion authored for the reference rig lands at this rig's hip height. */
  hipsPositionScale: number;
}

/**
 * Rescale the reference skeleton table for a body type.
 *
 * Order of operations (all in the table's native Z-up cm space):
 *   1. Per-group segment-length / lateral-width multipliers (never the hips
 *      row, never any rest rotation).
 *   2. Re-ground: shift the hips rest translation so the lowest foot joint
 *      keeps the REFERENCE rig's ground clearance (longer legs raise the
 *      pelvis, shorter legs lower it — feet never float or sink).
 *   3. Height normalization: if `params.height` is set, uniformly scale every
 *      translation so head-top + `crownPadding` lands exactly on it.
 *
 * With all-default params every step is an exact no-op (multiplies by 1.0,
 * adds 0.0), so the default rig is bit-identical to the reference table —
 * that is what keeps the Phase-1 PoC fixture's committed render valid.
 *
 * `defs` defaults to the shipped table; a spec with its own chain passes
 * `appendExtraBones(spec.extraBones)`. An appended row matches none of the
 * segment-length groups below (they are keyed by the shipped bones' names), so
 * it scales by 1 in step 1 and rides its parent — a tail follows the hips —
 * and then by `heightFactor` in step 3 like everything else. Extras take no
 * part in the measurement (`GROUND_JOINTS` / `HeadTop_End`), so adding a chain
 * cannot move the character's realized height.
 *
 * CLIP COMPATIBILITY (the reviewer-flagged trap): animation clips carry
 * per-bone `.position` tracks baked for the SOURCE rig's segment lengths.
 * Played raw on a rescaled skeleton they would snap limbs back to source
 * proportions. The contract here is split with `clips.ts`: this function
 * only rescales REST translations and reports `hipsPositionScale`;
 * `retargetClipToHumanoid` drops every non-hips translation track (bones
 * keep these rest translations) and remaps the hips track by that factor —
 * the standard humanoid-retarget policy.
 */
export function scaleSkeletonDef(
  params: ResolvedHumanoidParams,
  crownPadding: number,
  defs: readonly BoneDef[] = MIXAMO_SKELETON_DEF,
): ScaledSkeletonDef {
  const base = defs;

  const groupFactor = (name: string): number => {
    if (TORSO_LENGTH_BONES.has(name)) return params.torsoLength;
    if (HEAD_LENGTH_BONES.has(name)) return params.headSize;
    if (ARM_LENGTH_BONES.has(name)) return params.armLength;
    if (LEG_LENGTH_BONES.has(name)) return params.legLength;
    if (CLAVICLE_BONES.has(name)) return params.shoulderWidth;
    return 1;
  };

  const scaled: BoneDef[] = base.map(([name, parent, t, r]) => {
    const k = groupFactor(name);
    let [x, y, z] = [t[0] * k, t[1] * k, t[2] * k];
    if (SHOULDER_X_BONES.has(name)) x = t[0] * params.shoulderWidth;
    if (HIP_X_BONES.has(name)) x = t[0] * params.hipWidth;
    return [name, parent, [x, y, z], r];
  });

  // 2. Re-ground the hips against the reference clearance.
  const reference = measureSkeleton(base);
  const current = measureSkeleton(scaled);
  const groundDeltaM = reference.minFootY - current.minFootY;
  const hips = scaled[0]!;
  const hipsT: [number, number, number] = [
    hips[2][0],
    hips[2][1],
    hips[2][2] + groundDeltaM / ARMATURE_SCALE,
  ];
  scaled[0] = [hips[0], hips[1], hipsT, hips[3]];

  // 3. Height normalization.
  const naturalHeight = current.headTopY + groundDeltaM + crownPadding;
  const heightFactor = params.height !== undefined ? params.height / naturalHeight : 1;
  const finalDefs: BoneDef[] =
    heightFactor === 1
      ? scaled
      : scaled.map(([name, parent, t, r]) => [
          name,
          parent,
          [t[0] * heightFactor, t[1] * heightFactor, t[2] * heightFactor],
          r,
        ]);

  // vs the SHIPPED reference hips, never `base`: clips are authored against
  // the reference rig, so a proportion-variant table (restTranslations) must
  // still report its hips height relative to the rig those hips tracks were
  // made for — with `base` here, a chibi rig would keep reference-height
  // root bob and hover mid-air.
  const referenceHips = MIXAMO_SKELETON_DEF[0]![2];
  const finalHips = finalDefs[0]![2];
  const hipsPositionScale =
    Math.hypot(finalHips[0], finalHips[1], finalHips[2]) /
    Math.hypot(referenceHips[0], referenceHips[1], referenceHips[2]);

  return {
    defs: finalDefs,
    heightFactor,
    height: naturalHeight * heightFactor,
    hipsPositionScale,
  };
}
