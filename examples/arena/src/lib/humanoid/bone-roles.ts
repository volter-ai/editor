/**
 * FORK SEAM 1 of 5 — the SEMANTIC BONE-ROLE MAP.
 *
 * The rig's bones are named in the Mixamo interchange vocabulary
 * (`mixamorigLeftForeArm`), which is a great INTERCHANGE key and a poor
 * GAMEPLAY key: game code that wants "the left hand" should not have to know
 * that Mixamo calls the elbow joint `ForeArm`. This module is the one place
 * the two vocabularies meet:
 *
 *   role   ('leftLowerArm')  — what your game, your saves and your rig
 *                              validators talk about;
 *   bone   ('mixamorigLeftForeArm') — what the skeleton table, the clips and
 *                              every GLTF exporter talk about.
 *
 * FOR A FORK: this is the file to edit when you rename, add or retarget a
 * bone. `skeleton.ts`'s `MIXAMO_SKELETON_DEF` stays the single source of
 * truth for what bones EXIST (and their rest pose); this file is the semantic
 * overlay on top of it, and `assertHumanoidRoleMap()` (skeleton.ts) proves
 * the two agree. Adding a bone chain is therefore: one row per bone in the
 * def table, plus a role entry here if the new chain is something game code
 * or a rig validator must be able to name. Everything else — the rig-quality
 * validator's role list, its expected hierarchy, its centerline and its
 * per-limb containment rules — is DERIVED from this file.
 *
 * REMOVAL LINE: nothing in the render/animation path reads this module —
 * delete it (and the `bone-roles` imports in `skeleton.ts` and
 * `rig-quality.mjs`) and the body still generates, skins, bakes and plays
 * clips. You lose the semantic vocabulary, not the character.
 *
 * DELIBERATELY DEPENDENCY-FREE: `rig-quality.mjs` imports this module
 * directly (`./bone-roles.ts`), and that validator runs under a plain
 * TypeScript-aware Node runner (the rig-review step script), not a bundler.
 * Keep this file to data and pure functions — no `three`, no project
 * aliases — so importing it never drags a bundler-only graph into that
 * script.
 */

/** The semantic roles this rig names. Ordered head-down, left before right —
 *  the order role-keyed reports are emitted in. */
export const HUMANOID_BONE_ROLES = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToe',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToe',
  'jaw',
  'leftEye',
  'rightEye',
] as const;

/** One semantic role of the humanoid rig. */
export type HumanoidBoneRole = (typeof HUMANOID_BONE_ROLES)[number];

/**
 * Roles a valid humanoid rig may simply NOT HAVE — VRM's optional face set,
 * and the reason `rig-quality.mjs` does not demand a mapping for them: most
 * downloaded rigs (Mixamo's own included) carry no jaw or eye joints, and a
 * reviewer must not have to invent one. THIS rig does declare all three
 * (`skeleton.ts`), so `HUMANOID_ROLE_BONES` names them below.
 *
 * Every other role stays required: a humanoid without a hand is not a rig
 * this lib's clips can drive.
 */
export const HUMANOID_OPTIONAL_BONE_ROLES: readonly HumanoidBoneRole[] = [
  'jaw',
  'leftEye',
  'rightEye',
];

/**
 * role → this rig's bone name. Every non-null value must exist in
 * `MIXAMO_SKELETON_DEF` (proven by `assertHumanoidRoleMap`, skeleton.ts).
 *
 * `root` is `null` on purpose: the Mixamo layout has no separate armature
 * root JOINT — `mixamorigHips` is the hierarchy root, and the node above it
 * is the plain `Armature` group `createArmatureGroup` makes. The role still
 * exists because rig validators run against EXTERNAL rigs that do carry one.
 *
 * `spine`/`chest` map to `Spine`/`Spine2`, skipping `Spine1`: a role map is a
 * gameplay vocabulary, not a complete bone census, and `Spine2` is the
 * vertebra the clavicles actually hang off — the one a chest socket, a
 * torso IK target or a "lean" layer wants.
 */
export const HUMANOID_ROLE_BONES: Readonly<Record<HumanoidBoneRole, string | null>> = {
  root: null,
  hips: 'mixamorigHips',
  spine: 'mixamorigSpine',
  chest: 'mixamorigSpine2',
  neck: 'mixamorigNeck',
  head: 'mixamorigHead',
  leftUpperArm: 'mixamorigLeftArm',
  leftLowerArm: 'mixamorigLeftForeArm',
  leftHand: 'mixamorigLeftHand',
  rightUpperArm: 'mixamorigRightArm',
  rightLowerArm: 'mixamorigRightForeArm',
  rightHand: 'mixamorigRightHand',
  leftUpperLeg: 'mixamorigLeftUpLeg',
  leftLowerLeg: 'mixamorigLeftLeg',
  leftFoot: 'mixamorigLeftFoot',
  leftToe: 'mixamorigLeftToeBase',
  rightUpperLeg: 'mixamorigRightUpLeg',
  rightLowerLeg: 'mixamorigRightLeg',
  rightFoot: 'mixamorigRightFoot',
  rightToe: 'mixamorigRightToeBase',
  // The face joints are NOT Mixamo-named (skeleton.ts explains why) — which
  // is exactly the case this map exists for: game code asks for the role.
  jaw: 'jaw',
  leftEye: 'leftEye',
  rightEye: 'rightEye',
};

/**
 * role → the role whose node must be an ANCESTOR of it — the semantic
 * hierarchy a rig has to satisfy to be drivable by this lib's clips,
 * expressed once instead of as a hand-kept chain table inside the validator.
 *
 * `null` means "no ancestor is asserted here". Three roles take it: `root`
 * (it IS the top) and the two upper legs, whose pelvis attachment is checked
 * by a dedicated, deliberately more permissive rule in `rig-quality.mjs` (a
 * valid rig may hang the legs off the armature root rather than off the hips
 * joint, as long as nothing else semantic sits in between).
 */
export const HUMANOID_ROLE_CHAIN_PARENTS: Readonly<
  Record<HumanoidBoneRole, HumanoidBoneRole | null>
> = {
  root: null,
  hips: 'root',
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  leftUpperArm: 'chest',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightUpperArm: 'chest',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: null,
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToe: 'leftFoot',
  rightUpperLeg: null,
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToe: 'rightFoot',
  jaw: 'head',
  leftEye: 'head',
  rightEye: 'head',
};

/** The side prefix a role carries, or `null` for a centerline role. Derived
 *  from the role NAME, so a new sided chain needs no second list. */
export function humanoidRoleSide(role: HumanoidBoneRole): 'left' | 'right' | null {
  if (role.startsWith('left')) return 'left';
  if (role.startsWith('right')) return 'right';
  return null;
}

/** Every role reachable from `ancestor` through `HUMANOID_ROLE_CHAIN_PARENTS`
 *  (the roles a validator should expect to find UNDER it, and no others). */
export function humanoidRoleDescendants(ancestor: HumanoidBoneRole): HumanoidBoneRole[] {
  return HUMANOID_BONE_ROLES.filter((role) => {
    let cursor: HumanoidBoneRole | null = HUMANOID_ROLE_CHAIN_PARENTS[role];
    while (cursor) {
      if (cursor === ancestor) return true;
      cursor = HUMANOID_ROLE_CHAIN_PARENTS[cursor];
    }
    return false;
  });
}
