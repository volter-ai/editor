/**
 * A REAL cross-topology retargeter: Quaternius UAL1 (Universal Animation
 * Library 1, "Standard" mannequin — Unreal/Godot-style skeleton, CC0-1.0)
 * onto the generated humanoid's Mixamo-named skeleton (`skeleton.ts`).
 *
 * This is deliberately NOT `clips.ts`'s `retargetClipToHumanoid`: that
 * function requires the source to be `assertExactHumanoidSkeletonCompatibility`
 * — the exact same hierarchy AND local rest transforms as
 * `MIXAMO_SKELETON_DEF` — and copies local quaternions verbatim. UAL1 fails
 * that proof (different bone names, different per-bone local axis
 * conventions, a different rest pose), so raw quaternion copy would produce
 * twisted limbs / sideways locomotion. This module instead does WORLD-SPACE
 * DELTA retargeting, the standard technique for two rigs that share bone-for-
 * bone hierarchy correspondence but not local conventions:
 *
 *   1. For each source (UAL1) bone, compute its WORLD rest orientation and
 *      its WORLD orientation at time t (forward-kinematics, composing local
 *      quaternions root-to-leaf — translations never affect orientation).
 *   2. The bone's motion is the WORLD delta between those two:
 *      `delta = worldAtT * worldRest^-1`.
 *   3. Apply the SAME delta on top of the TARGET bone's own world rest
 *      orientation: `targetWorldAtT = delta * targetWorldRest`.
 *   4. Convert back to the target's LOCAL rotation using the target
 *      PARENT's (already-retargeted) world orientation at t.
 *
 * This is robust to differing local bone axes and differing rest poses
 * (UAL1 ships a near-A-pose, `MIXAMO_SKELETON_DEF` a T-pose) because neither
 * matters to a WORLD-space delta — only the anatomical correspondence and a
 * shared "up/forward" convention do, and both hold here: `UAL1_SKELETON_DEF`
 * bone[0] ('root') carries the exact same -90 deg X rotation
 * `ARMATURE_ROTATION_X` applies externally for the Mixamo-shaped rig (see the
 * provenance comment on `UAL1_SKELETON_DEF`), and every other UAL1 joint maps
 * 1:1 onto a `MIXAMO_SKELETON_DEF` bone (`UAL1_TO_MIXAMO_BONE_MAP`) — a
 * coincidence of both rigs sharing the same 65-joint Fullbody+fingers layout,
 * confirmed by inspecting UAL1_Standard.glb directly (67 nodes, skin.joints
 * length 65, 'root' plus 64 anatomical joints), not assumed.
 *
 * SHOULDER PASS-THROUGH (measured, not theoretical): `mixamorigLeftShoulder`/
 * `mixamorigRightShoulder`'s own rest LOCAL rotation in `MIXAMO_SKELETON_DEF`
 * is a near-180 deg flip (`[R2, R2, 0, 0]` / `[0, 0, R2, R2], w` near 0) — a
 * known quirk of the Mixamo/FBX-derived reference rig, not a bug in this
 * file. Retargeting UAL1's `clavicle_l`/`clavicle_r` onto that bone produces
 * a WORLD-correct but visually wrong result: verified by driving the
 * retargeted 'Idle' clip through a real `AnimationMixer` and comparing
 * `mixamorigLeftHand`'s world position against the known-good Mixamo-family
 * retarget (`clips.ts`) on the SAME generated rig — with the shoulder
 * mapped, the hand landed ~0.75 m above the known-good position (overhead
 * instead of at the hip); with the shoulder EXCLUDED from
 * `UAL1_TO_MIXAMO_BONE_MAP` (mapped bones ending at `mixamorigLeftArm`/
 * `mixamorigRightArm`, which have IDENTITY rest rotations — no such quirk),
 * the hand lands within ~10 cm of the known-good height. The chain
 * `worldRest(shoulder) = worldRest(spine2) * [R2,R2,0,0]` is not itself
 * wrong — the REST-only round-trip test proves it reproduces
 * `MIXAMO_SKELETON_DEF` exactly when every source delta is identity — but
 * composing UAL1's ordinary clavicle sway through that near-180 deg local
 * frame amplifies into a large, visually wrong swing once a REAL delta is
 * applied. So the shoulder bones stay at their own rest pose (a fixed,
 * correct clavicle position) and `mixamorigLeftArm`/`mixamorigRightArm`
 * alone carry the visible shoulder-swing motion — the standard "shoulder
 * pass-through" simplification, and the one this rig pair specifically
 * needs.
 *
 * Hips POSITION is retargeted too (the vertical bob a good walk/run cycle
 * needs): UAL1's `pelvis.translation` and Mixamo's `mixamorigHips.translation`
 * are both expressed in the SAME "immediately after the shared -90 deg X
 * rotation" local frame (root/Armature apply that identically), differing by
 * unit scale (UAL1 ships real-world METRES; `MIXAMO_SKELETON_DEF`'s table
 * uses the source rig's native CENTIMETRES) AND by body proportions (the two
 * mannequins' hips rest 0.9167 m vs 1.0613 m off the ground). So the track is
 * retargeted REST-RELATIVELY — the target's own hips rest plus the source's
 * motion about ITS rest, scaled by `UAL1_TO_REFERENCE_HIPS_SCALE` (the
 * source->reference proportion bridge, x100 folded in) and then by
 * `target.hipsPositionScale` (the reference->body-type bridge `clips.ts`
 * already owns; root owns segment lengths, hips is the one bone whose
 * absolute position — height/bob — a body-type-rescaled target must
 * reproduce). Bare `x100 * hipsPositionScale` was WRONG on the second count:
 * it left the shipped default character's feet 12-17 cm underground.
 */

import * as THREE from 'three';
import type { HumanoidClipTarget } from './clips';
import {
  ARMATURE_ROTATION_X,
  type BoneDef,
  HUMANOID_HIPS_BONE,
  MIXAMO_SKELETON_DEF,
} from './skeleton';

// Extracted from UAL1_Standard.glb (Quaternius Universal Animation Library 1,
// Standard mannequin) via examples/top-down-strategy's materialized copy at
// public/asset-library/local/ual1-standard-a7c52883/UAL1_Standard.glb (key
// local:a7c5288306d9e98cb7dbdbd2, sha256 in .vgai/assets.json). 65 joints,
// topologically ordered (parent row precedes child), by walking skins[0].joints
// from its root. Translation is METRES (glTF native), rotation is the local
// rest quaternion [x,y,z,w] — both already Blender-exported (Khronos glTF
// Blender I/O v4.5.48), i.e. the SAME convention MIXAMO_SKELETON_DEF's own
// translations use before ARMATURE_SCALE/ARMATURE_ROTATION_X: bone[0]
// ('root') carries the exact -90 deg X armature-alignment rotation as an
// actual joint (Mixamo applies the equivalent transform externally via
// createArmatureGroup instead).
export const UAL1_SKELETON_DEF: readonly BoneDef[] = [
  ['root', -1, [0.0, 0.0, 0.0], [-0.70710677, 0.0, 0.0, 0.70710677]],
  ['pelvis', 0, [0.0, 0.050100029, 0.91670001], [0.79046851, 0.0, 0.0, 0.6125027]],
  ['spine_01', 1, [0.0, 0.13817634, -1.2107193e-8], [-0.064702623, 0.0, 0.0, 0.9979046]],
  ['spine_02', 2, [0.0, 0.12403485, 3.4924597e-10], [-0.077279843, 0.0, 0.0, 0.99700946]],
  ['spine_03', 3, [0.0, 0.14127187, 5.5879354e-9], [-0.00026859157, 0.0, 0.0, 1.0]],
  ['neck_01', 4, [0.0, 0.17289078, -1.8626451e-9], [0.11098591, 0.0, 0.0, 0.99382198]],
  ['Head', 5, [0.0, 0.08258678, -1.3969839e-9], [-0.078674227, 0.0, 0.0, 0.99690038]],
  [
    'clavicle_l',
    4,
    [0.0188, 0.14055358, 0.080895036],
    [-0.6040206, -0.34510303, -0.35671768, 0.62355077],
  ],
  [
    'upperarm_l',
    7,
    [-0.030072337, 0.21858175, -0.016968455],
    [0.18026958, 0.68385005, -0.17983641, 0.68374771],
  ],
  [
    'lowerarm_l',
    8,
    [2.1565143e-8, 0.27444026, -1.2878445e-9],
    [0.017182291, -0.000020353053, 3.6708832e-7, 0.99985242],
  ],
  [
    'hand_l',
    9,
    [1.2729826e-8, 0.27264056, -1.8102071e-9],
    [-0.0086196829, -4.1722387e-7, 2.1919726e-9, 0.99996287],
  ],
  [
    'index_01_l',
    10,
    [0.0019998318, 0.11989992, 0.030899998],
    [-4.8541157e-8, 0.70710957, -4.8541541e-8, 0.70710397],
  ],
  [
    'index_02_l',
    11,
    [-5.128199e-10, 0.040700018, 1.1360872e-8],
    [-4.4818607e-14, -9.671453e-9, -2.7004171e-10, 1.0],
  ],
  [
    'index_03_l',
    12,
    [9.7224984e-10, 0.034800053, 1.0693611e-8],
    [7.3487586e-18, 1.1368684e-13, -1.3279149e-16, 1.0],
  ],
  [
    'index_04_leaf_l',
    13,
    [4.6975401e-9, 0.030100105, 1.0693611e-8],
    [4.1180931e-16, 1.0, 1.4787951e-17, 0.0000036517765],
  ],
  [
    'middle_01_l',
    10,
    [-0.00040022601, 0.12159991, 0.0052000005],
    [-0.01670246, 0.70691228, -0.0167026, 0.70690674],
  ],
  [
    'middle_02_l',
    15,
    [3.6379788e-10, 0.042347249, 2.0186121e-8],
    [-1.1900032e-8, -9.9100346e-9, 0.0015135602, 0.99999887],
  ],
  [
    'middle_03_l',
    16,
    [-2.7830538e-10, 0.033933148, 1.6051382e-7],
    [8.1562943e-9, -3.5669271e-12, -0.0011296597, 0.99999934],
  ],
  [
    'middle_04_leaf_l',
    17,
    [-5.8662408e-9, 0.034437183, 2.5992932e-8],
    [9.3132275e-9, 1.0, -5.5467012e-15, 0.0000036517761],
  ],
  [
    'pinky_01_l',
    10,
    [0.0015997173, 0.10769992, -0.040800001],
    [-0.023706039, 0.70671207, -0.0237062, 0.70670652],
  ],
  [
    'pinky_02_l',
    19,
    [3.3469405e-9, 0.040290572, -1.4873649e-9],
    [5.8821228e-9, -1.0178269e-8, -0.0008342716, 0.99999964],
  ],
  [
    'pinky_03_l',
    20,
    [-3.5843186e-9, 0.027665334, 2.2544884e-7],
    [-4.4004613e-9, 4.1868744e-12, 0.00060952286, 0.99999982],
  ],
  [
    'pinky_04_leaf_l',
    21,
    [-3.5834091e-9, 0.028164202, 1.1433525e-7],
    [2.421439e-8, 1.0, 1.6284097e-14, 0.0000036517768],
  ],
  [
    'ring_01_l',
    10,
    [-0.0001001912, 0.1190999, -0.017100004],
    [-0.012588736, 0.70699751, -0.01258882, 0.70699197],
  ],
  [
    'ring_02_l',
    23,
    [-7.8307494e-10, 0.039324984, -1.0246477e-7],
    [-8.6603369e-10, -9.6275183e-9, 0.000012190081, 1.0],
  ],
  [
    'ring_03_l',
    24,
    [-6.1763785e-9, 0.030919554, -1.0190598e-7],
    [7.7049451e-9, -2.098989e-12, -0.0010670634, 0.9999994],
  ],
  [
    'ring_04_leaf_l',
    25,
    [1.2751116e-9, 0.031822596, -1.16248e-7],
    [1.8626451e-9, 1.0, 5.0179028e-14, 0.0000036517768],
  ],
  [
    'thumb_01_l',
    10,
    [0.022799829, 0.027299935, 0.033599995],
    [0.24741302, 0.94579452, 0.20344116, 0.053584054],
  ],
  [
    'thumb_02_l',
    27,
    [5.9044396e-9, 0.043029793, 4.2840838e-8],
    [-0.0001357142, -0.000074107171, 0.000047934565, 1.0],
  ],
  [
    'thumb_03_l',
    28,
    [-1.2301234e-7, 0.049077947, -2.514571e-8],
    [0.00024788463, 0.000080919184, -0.00053533528, 0.99999982],
  ],
  [
    'thumb_04_leaf_l',
    29,
    [-2.0787411e-7, 0.040862311, -1.8626451e-8],
    [2.3757428e-8, 0.5061779, 2.7236675e-7, 0.86242908],
  ],
  [
    'clavicle_r',
    4,
    [-0.0188, 0.14055358, 0.080895036],
    [-0.6040206, 0.34510303, 0.35671768, 0.62355077],
  ],
  [
    'upperarm_r',
    31,
    [0.030072337, 0.21858175, -0.016968455],
    [0.18026958, -0.68385005, 0.17983641, 0.68374771],
  ],
  [
    'lowerarm_r',
    32,
    [-1.4812335e-7, 0.27444023, -7.9417077e-9],
    [0.017182305, 0.000020353053, -3.6919505e-7, 0.99985242],
  ],
  [
    'hand_r',
    33,
    [-2.2043341e-8, 0.27264047, 1.7249704e-9],
    [-0.0086196829, 5.3642873e-7, -2.1920292e-9, 0.99996287],
  ],
  [
    'index_01_r',
    34,
    [-0.0019998278, 0.11989996, 0.0309],
    [-4.8541143e-8, -0.70710963, 4.8541533e-8, 0.70710391],
  ],
  [
    'index_02_r',
    35,
    [-5.3552527e-9, 0.040700108, -1.078484e-7],
    [-5.2394443e-14, -3.8240842e-9, 2.7004843e-10, 1.0],
  ],
  [
    'index_03_r',
    36,
    [-4.6966306e-9, 0.034800023, -1.0758447e-7],
    [-1.1838302e-16, -1.1368684e-13, -4.1818745e-16, 1.0],
  ],
  [
    'index_04_leaf_r',
    37,
    [-9.7134034e-10, 0.03009996, 1.162482e-8],
    [1.7660198e-16, -1.0, 2.3683242e-16, 0.0000036517765],
  ],
  [
    'middle_01_r',
    34,
    [0.0004002332, 0.12159993, 0.0052000023],
    [-0.01670246, -0.70691234, 0.016702566, 0.70690668],
  ],
  [
    'middle_02_r',
    39,
    [6.3118932e-10, 0.042347282, -9.737596e-8],
    [-1.1009926e-8, -3.383724e-9, -0.0015135611, 0.99999887],
  ],
  [
    'middle_03_r',
    40,
    [2.14186e-9, 0.033933181, 4.1895845e-8],
    [8.1862987e-9, 2.2575291e-11, 0.0011296588, 0.99999934],
  ],
  [
    'middle_04_leaf_r',
    41,
    [4.0035957e-9, 0.034437217, 2.6527175e-8],
    [9.3132257e-9, -1.0, -4.3415382e-14, 0.0000036517763],
  ],
  [
    'pinky_01_r',
    34,
    [-0.0015997047, 0.10769995, -0.040800001],
    [-0.023706039, -0.70671213, 0.023706198, 0.70670646],
  ],
  [
    'pinky_02_r',
    43,
    [8.576535e-10, 0.040290538, -1.9636559e-9],
    [5.6239808e-9, -2.9140144e-9, 0.00083426427, 0.99999964],
  ],
  [
    'pinky_03_r',
    44,
    [3.5843186e-9, 0.027665364, -1.1715912e-8],
    [-4.4164201e-9, -1.6191496e-11, -0.00060952094, 0.99999982],
  ],
  [
    'pinky_04_leaf_r',
    45,
    [3.5824996e-9, 0.028164171, -1.2279904e-7],
    [2.6077032e-8, -1.0, -3.1884909e-14, 0.0000036517765],
  ],
  [
    'ring_01_r',
    34,
    [0.00010020104, 0.11909994, -0.017100003],
    [-0.012588738, -0.70699751, 0.012588818, 0.70699197],
  ],
  [
    'ring_02_r',
    47,
    [-2.5420377e-9, 0.039325017, -2.1878903e-7],
    [7.3714312e-10, -3.4386891e-9, -0.000012191013, 1.0],
  ],
  [
    'ring_03_r',
    48,
    [2.4510882e-9, 0.030919585, -1.0054916e-7],
    [7.7328286e-9, 2.1304748e-11, 0.0010670634, 0.9999994],
  ],
  [
    'ring_04_leaf_r',
    49,
    [-1.2760211e-9, 0.031822629, 4.2641943e-9],
    [3.7252907e-9, -1.0, -6.0526679e-15, 0.0000036517763],
  ],
  [
    'thumb_01_r',
    34,
    [-0.022799823, 0.027299969, 0.033599995],
    [0.24741305, -0.94579446, -0.2034411, 0.053584058],
  ],
  [
    'thumb_02_r',
    51,
    [-7.1722752e-9, 0.04302986, -1.6763806e-8],
    [-0.0001356695, 0.000074015756, -0.000047864316, 1.0],
  ],
  [
    'thumb_03_r',
    52,
    [-5.5804321e-8, 0.049077883, 5.5879354e-9],
    [0.00024785104, -0.000080999358, 0.00053531677, 0.99999988],
  ],
  [
    'thumb_04_leaf_r',
    53,
    [-6.4444976e-8, 0.0408623, 1.4901161e-8],
    [1.9437893e-8, -0.50617778, -2.737419e-7, 0.86242914],
  ],
  ['thigh_l', 1, [0.089000002, 0.027770841, 0.046023797], [0.99248445, 0.0, 0.0, 0.12237062]],
  [
    'calf_l',
    55,
    [7.4505806e-9, 0.40030977, -2.3283064e-10],
    [0.036585908, -0.00013117322, -0.0000048023071, 0.99933052],
  ],
  [
    'foot_l',
    56,
    [-7.2191142e-9, 0.4294799, 2.408342e-9],
    [-0.52907175, -0.00032809316, 0.00034345294, 0.84857702],
  ],
  [
    'ball_l',
    57,
    [3.9199222e-9, 0.17330109, -8.578354e-9],
    [0.00013712791, -0.96430677, 0.26478711, 0.00049943442],
  ],
  [
    'ball_leaf_l',
    58,
    [6.8294805e-9, 0.078900032, -5.3680171e-11],
    [-1.4901159e-8, -2.0430893e-8, -3.0444405e-16, 1.0],
  ],
  ['thigh_r', 1, [-0.089000002, 0.027770841, 0.046023797], [0.99248445, 0.0, 0.0, 0.12237062]],
  [
    'calf_r',
    60,
    [-7.4505806e-9, 0.40030977, -2.3283064e-10],
    [0.036585908, -0.00013117322, -0.0000048023071, 0.99933052],
  ],
  [
    'foot_r',
    61,
    [7.682047e-9, 0.42947984, 1.3169483e-9],
    [-0.52907175, -0.00032809316, 0.00034345294, 0.84857702],
  ],
  [
    'ball_r',
    62,
    [-3.5306584e-9, 0.17330109, -8.1854523e-9],
    [0.00013712791, -0.96430677, 0.26478711, 0.00049943442],
  ],
  [
    'ball_leaf_r',
    63,
    [-8.0716811e-9, 0.078900032, -2.2050139e-10],
    [-1.4901159e-8, -2.0430893e-8, -3.0444405e-16, 1.0],
  ],
];

/**
 * UAL1 joint name -> canonical `mixamorig*` name. 62 of UAL1's 65 joints map
 * 1:1 ('root' is the coordinate-alignment joint, the UAL1-internal analogue
 * of `ARMATURE_ROTATION_X` — it has no anatomical counterpart and is used
 * only as the base of the source forward-kinematics chain, never emitted;
 * `clavicle_l`/`clavicle_r` are deliberately excluded — see the header
 * comment's "SHOULDER PASS-THROUGH" note). The one `MIXAMO_SKELETON_DEF`
 * bone with no UAL1 source (besides the two shoulder bones, which stay at
 * rest on purpose) is `mixamorigHeadTop_End` (a head-top socket point, not
 * an animated joint in any Quaternius pack) — it simply stays at its rest
 * pose too, which is correct: nothing in this contract reads it during
 * Idle/Walk/Run.
 */
export const UAL1_TO_MIXAMO_BONE_MAP: ReadonlyMap<string, string> = new Map([
  ['pelvis', 'mixamorigHips'],
  ['spine_01', 'mixamorigSpine'],
  ['spine_02', 'mixamorigSpine1'],
  ['spine_03', 'mixamorigSpine2'],
  ['neck_01', 'mixamorigNeck'],
  ['Head', 'mixamorigHead'],
  // 'clavicle_l' is deliberately NOT mapped to 'mixamorigLeftShoulder' — see
  // the header comment's "shoulder pass-through" note. The shoulder stays at
  // its own rest pose; upperarm_l's delta (below) does the real swinging.
  ['upperarm_l', 'mixamorigLeftArm'],
  ['lowerarm_l', 'mixamorigLeftForeArm'],
  ['hand_l', 'mixamorigLeftHand'],
  ['index_01_l', 'mixamorigLeftHandIndex1'],
  ['index_02_l', 'mixamorigLeftHandIndex2'],
  ['index_03_l', 'mixamorigLeftHandIndex3'],
  ['index_04_leaf_l', 'mixamorigLeftHandIndex4'],
  ['middle_01_l', 'mixamorigLeftHandMiddle1'],
  ['middle_02_l', 'mixamorigLeftHandMiddle2'],
  ['middle_03_l', 'mixamorigLeftHandMiddle3'],
  ['middle_04_leaf_l', 'mixamorigLeftHandMiddle4'],
  ['pinky_01_l', 'mixamorigLeftHandPinky1'],
  ['pinky_02_l', 'mixamorigLeftHandPinky2'],
  ['pinky_03_l', 'mixamorigLeftHandPinky3'],
  ['pinky_04_leaf_l', 'mixamorigLeftHandPinky4'],
  ['ring_01_l', 'mixamorigLeftHandRing1'],
  ['ring_02_l', 'mixamorigLeftHandRing2'],
  ['ring_03_l', 'mixamorigLeftHandRing3'],
  ['ring_04_leaf_l', 'mixamorigLeftHandRing4'],
  ['thumb_01_l', 'mixamorigLeftHandThumb1'],
  ['thumb_02_l', 'mixamorigLeftHandThumb2'],
  ['thumb_03_l', 'mixamorigLeftHandThumb3'],
  ['thumb_04_leaf_l', 'mixamorigLeftHandThumb4'],
  // 'clavicle_r' likewise not mapped — see 'clavicle_l' above.
  ['upperarm_r', 'mixamorigRightArm'],
  ['lowerarm_r', 'mixamorigRightForeArm'],
  ['hand_r', 'mixamorigRightHand'],
  ['index_01_r', 'mixamorigRightHandIndex1'],
  ['index_02_r', 'mixamorigRightHandIndex2'],
  ['index_03_r', 'mixamorigRightHandIndex3'],
  ['index_04_leaf_r', 'mixamorigRightHandIndex4'],
  ['middle_01_r', 'mixamorigRightHandMiddle1'],
  ['middle_02_r', 'mixamorigRightHandMiddle2'],
  ['middle_03_r', 'mixamorigRightHandMiddle3'],
  ['middle_04_leaf_r', 'mixamorigRightHandMiddle4'],
  ['pinky_01_r', 'mixamorigRightHandPinky1'],
  ['pinky_02_r', 'mixamorigRightHandPinky2'],
  ['pinky_03_r', 'mixamorigRightHandPinky3'],
  ['pinky_04_leaf_r', 'mixamorigRightHandPinky4'],
  ['ring_01_r', 'mixamorigRightHandRing1'],
  ['ring_02_r', 'mixamorigRightHandRing2'],
  ['ring_03_r', 'mixamorigRightHandRing3'],
  ['ring_04_leaf_r', 'mixamorigRightHandRing4'],
  ['thumb_01_r', 'mixamorigRightHandThumb1'],
  ['thumb_02_r', 'mixamorigRightHandThumb2'],
  ['thumb_03_r', 'mixamorigRightHandThumb3'],
  ['thumb_04_leaf_r', 'mixamorigRightHandThumb4'],
  ['thigh_l', 'mixamorigLeftUpLeg'],
  ['calf_l', 'mixamorigLeftLeg'],
  ['foot_l', 'mixamorigLeftFoot'],
  ['ball_l', 'mixamorigLeftToeBase'],
  ['ball_leaf_l', 'mixamorigLeftToe_End'],
  ['thigh_r', 'mixamorigRightUpLeg'],
  ['calf_r', 'mixamorigRightLeg'],
  ['foot_r', 'mixamorigRightFoot'],
  ['ball_r', 'mixamorigRightToeBase'],
  ['ball_leaf_r', 'mixamorigRightToe_End'],
]);

const UAL1_INDEX_BY_NAME = new Map(UAL1_SKELETON_DEF.map(([name], i) => [name, i]));
const TARGET_PARENT_NAME_BY_NAME = new Map(
  MIXAMO_SKELETON_DEF.map(([name, parentIndex]) => [
    name,
    parentIndex >= 0 ? MIXAMO_SKELETON_DEF[parentIndex]![0] : null,
  ]),
);

/** WORLD-space rest orientation of every row in a topologically-ordered
 *  BoneDef table (parent row precedes child) — rotation-only forward
 *  kinematics; translations never affect orientation. `baseQuat` is the
 *  orientation of row 0's implicit parent (identity for UAL1, whose 'root'
 *  bone already IS the alignment rotation; the armature quaternion for
 *  `MIXAMO_SKELETON_DEF`, whose 'hips' row has no such bone above it). */
function composeWorldRestQuaternions(
  defs: readonly BoneDef[],
  baseQuat: THREE.Quaternion,
): THREE.Quaternion[] {
  const world: THREE.Quaternion[] = [];
  defs.forEach(([, parentIndex, , rotation], i) => {
    const local = new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]);
    const parentWorld = parentIndex >= 0 ? world[parentIndex]! : baseQuat;
    world[i] = parentWorld.clone().multiply(local);
  });
  return world;
}

const TARGET_ARMATURE_QUAT = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  ARMATURE_ROTATION_X,
);
const UAL1_WORLD_REST = composeWorldRestQuaternions(UAL1_SKELETON_DEF, new THREE.Quaternion());
const MIXAMO_WORLD_REST_ROWS = composeWorldRestQuaternions(
  MIXAMO_SKELETON_DEF,
  TARGET_ARMATURE_QUAT,
);
const TARGET_WORLD_REST = new Map(
  MIXAMO_SKELETON_DEF.map(([name], i) => [name, MIXAMO_WORLD_REST_ROWS[i]!]),
);

/** UAL1's `pelvis` rest translation, METRES, in the shared
 *  "immediately after the -90 deg X alignment" frame (see the header). */
const UAL1_PELVIS_REST = UAL1_SKELETON_DEF[UAL1_INDEX_BY_NAME.get('pelvis')!]![2];
/** `mixamorigHips`' rest translation in the REFERENCE (unrescaled) target
 *  table, the same frame, in that table's native cm-like unit. */
const REFERENCE_HIPS_REST = MIXAMO_SKELETON_DEF[0]![2];
/**
 * BODY-PROPORTION bridge for the hips position track, source -> reference
 * TARGET (measured off both rest tables above, not assumed).
 *
 * Both tables are Z-up in this frame, so index 2 is hip HEIGHT: UAL1's
 * mannequin rests its pelvis at 0.9167 m, the reference generated rig at
 * 106.130768 cm = 1.0613 m. That factor is ~1.1577, and nothing else in the
 * pipeline supplies it: `target.hipsPositionScale` bridges REFERENCE -> this
 * rig's body type (its own doc comment in `skeleton.ts` says so — "root
 * motion authored for the reference rig lands at this rig's hip height"), and
 * UAL1 is not the reference rig. Omitting it stood the starter's default
 * character 19 cm low — toes 12-17 cm INSIDE the ground plane for every
 * frame of Idle/Walk/Run, since `Player.tsx`'s capsule grounds the rig origin
 * at the floor and nothing downstream adds an offset (review, 2026-07-30).
 *
 * One uniform factor for all three axes, deliberately: stride length scales
 * with leg length exactly as the vertical bob does.
 */
const UAL1_TO_REFERENCE_HIPS_SCALE = REFERENCE_HIPS_REST[2] / (UAL1_PELVIS_REST[2] * 100);

/**
 * Per-mapped-bone REST-ALIGNMENT correction (measured, not assumed). A first
 * version of this module applied the raw source-to-source delta directly
 * onto the target's rest (`targetWorldAtT = delta * targetWorldRest`,
 * implicitly assuming the two rigs' rests already agree) — verified WRONG by
 * comparing the retargeted Walk clip's hand-height trajectory against the
 * known-good Mixamo-family retarget (`clips.ts` on the same generated rig):
 * the hand stayed pinned near/above shoulder height for the whole cycle
 * instead of swinging near the hip.
 *
 * The fix: precompute a constant per-bone rotation `C = targetWorldRest *
 * sourceWorldRest^-1` and apply it to the source's RAW world orientation at
 * time t (not to a delta): `targetWorldAtT = C * sourceWorldAtT`. This
 * collapses to `targetWorldAtT = targetWorldRest` at t=rest by construction,
 * while correctly reproducing UAL1's own swing magnitude/direction expressed
 * in the target's frame.
 *
 * MIRROR CORRECTION (also measured, not assumed): computing C independently
 * per bone from `MIXAMO_SKELETON_DEF`'s own rest values still produced a
 * LEFT/RIGHT asymmetric result — verified by driving the retargeted Walk
 * clip and comparing both hands' height trajectories: the right hand swung
 * correctly (~0.83-0.88 m, below the ~1.3 m shoulder), the left stayed wrong
 * (~1.65-1.74 m, above it) — using the EXACT same formula, only the bone
 * names differing. Root cause, confirmed by inspecting
 * `MIXAMO_SKELETON_DEF`'s own data: `mixamorigLeftArm`'s and
 * `mixamorigRightArm`'s rest rotations are NOT a clean mirror of each other
 * as quaternions (`mixamorigLeftShoulder` rest ~90 deg about world Z vs
 * `mixamorigRightShoulder` rest ~180 deg about a diagonal XY axis) — a known
 * Mixamo/FBX authoring quirk (confirmed harmless for `clips.ts`'s exact-copy
 * retarget, which never computes a WORLD-space correction and so never
 * exposes the inconsistency). `mixamorigLeftUpLeg`/`RightUpLeg` and
 * `LeftFoot`/`RightFoot`, by contrast, have IDENTICAL rest quaternions on
 * both sides (their y/z components are already zero) — which is exactly why
 * the leg chain never showed this bug: for a bone whose rest is invariant
 * under the mirror below, computing its correction directly or by mirroring
 * its counterpart give the same answer.
 *
 * The fix: mirror quaternions are a verified ring homomorphism under
 * quaternion multiplication for reflection across the character's sagittal
 * (X=0) plane — `mirrorAcrossX(A).multiply(mirrorAcrossX(B))` measured
 * equal to `mirrorAcrossX(A.multiply(B))` to float precision, and mirroring
 * twice round-trips to the original. So every LEFT-side bone's correction is
 * derived from its RIGHT counterpart's independently-computed (and verified
 * correct) one — `C_left = mirrorAcrossX(C_right)` — rather than trusted
 * from `MIXAMO_SKELETON_DEF`'s own left-side rest data, which does not agree
 * with the mirror (see MIRROR-FRAME UNTWIST below).
 * Bones with no left/right counterpart (spine, neck, head, hips) keep their
 * own directly-computed correction.
 *
 * MIRROR-FRAME UNTWIST (the missing half of the mirror correction; added
 * after review found the whole left arm chain emitted 180 deg twisted).
 * `C * sourceWorldAtT` expands to `targetWorldRest * D`, where
 * `D = sourceWorldRest^-1 * sourceWorldAtT` is the source's motion expressed
 * in the SOURCE BONE's own rest frame. That is the standard local-frame
 * delta transport, and it is only correct when the two rigs' bone frames
 * point the same anatomical way. With `C_left = mirrorAcrossX(C_right)` the
 * frame `D` is transported through is `mirrorAcrossX(targetWorldRest_right)`,
 * NOT the target's actual left rest — and those two differ, measured over
 * `MIXAMO_SKELETON_DEF` itself, by EXACTLY 180 deg of pure twist about the
 * bone axis (swing component 0.000 deg) for `LeftShoulder`/`LeftArm`/
 * `LeftForeArm`/`LeftHand` and every left finger bone. (The leg chain
 * differs by 0.000 deg, which is why only the arms were ever affected, and
 * why substituting the mirror there is a no-op.)
 *
 * Writing that constant as `F = targetWorldRest_left^-1 *
 * mirrorAcrossX(targetWorldRest_right)`, the mirrored correction emits
 * `targetWorldRest_left * F * D` — the swing DIRECTION is right (that is
 * what the mirror bought, and the hand-height trajectories that verified it
 * still hold: `F` is a twist about the bone axis, so it moves no joint that
 * sits on that axis) but every emitted orientation is a constant `F` away
 * from bind, at every frame including rest. Orientation-sensitive consumers
 * see it immediately: `GripSocket_L` renders left-held items flipped, and a
 * detailed skinned character (the capability's advertised restyling path)
 * shows a rolled forearm and a palm facing the wrong way.
 *
 * A rotation changes basis by CONJUGATION, not by pre-multiplication, so the
 * complete correction transports `D` through the mirrored frame and lands on
 * the TRUE rest: `targetWorldAtT = targetWorldRest_left * (F * D * F^-1)`,
 * which is the already-computed `C_left * sourceWorldAtT` RIGHT-multiplied
 * by `F^-1`. Hence the second, POST-multiplied map below — identity for
 * every right-side and centre bone, `F^-1` for each left-side one. It
 * collapses to exactly `targetWorldRest_left` at t=rest, leaves every joint
 * position (and therefore the verified swing) untouched, and is a constant,
 * not a re-derivation.
 */
const reflectAcrossX = new THREE.Matrix4().makeScale(-1, 1, 1);
function mirrorAcrossX(q: THREE.Quaternion): THREE.Quaternion {
  const rotation = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const mirrored = reflectAcrossX.clone().multiply(rotation).multiply(reflectAcrossX);
  return new THREE.Quaternion().setFromRotationMatrix(mirrored);
}

/** 'mixamorigLeftArm' -> 'mixamorigRightArm'; null for bones with no
 *  left/right counterpart (spine, neck, head, hips, ...). */
function rightCounterpartName(mixamoName: string): string | null {
  return mixamoName.includes('Left') ? mixamoName.replace('Left', 'Right') : null;
}

function computeDirectCorrection(ual1Name: string, mixamoName: string): THREE.Quaternion {
  const sourceRest = UAL1_WORLD_REST[UAL1_INDEX_BY_NAME.get(ual1Name)!]!;
  const targetRest = TARGET_WORLD_REST.get(mixamoName)!;
  return targetRest.clone().multiply(sourceRest.clone().invert());
}

const REST_ALIGNMENT_CORRECTION = new Map<string, THREE.Quaternion>();
/** The POST-multiplied half of the mirror correction — `F^-1`, undoing the
 *  bone-axis twist between the target's real left rest and the mirror of its
 *  right one (see MIRROR-FRAME UNTWIST in the comment above). Only left-side
 *  bones have an entry; everything else needs none. */
const MIRROR_FRAME_UNTWIST = new Map<string, THREE.Quaternion>();
for (const [ual1Name, mixamoName] of UAL1_TO_MIXAMO_BONE_MAP) {
  if (mixamoName.includes('Left')) continue; // filled in the mirror pass below
  REST_ALIGNMENT_CORRECTION.set(mixamoName, computeDirectCorrection(ual1Name, mixamoName));
}
for (const [ual1Name, mixamoName] of UAL1_TO_MIXAMO_BONE_MAP) {
  if (!mixamoName.includes('Left')) continue;
  const rightName = rightCounterpartName(mixamoName)!;
  const rightUal1Name = ual1Name.replace(/_l$/, '_r');
  const rightCorrection =
    REST_ALIGNMENT_CORRECTION.get(rightName) ?? computeDirectCorrection(rightUal1Name, rightName);
  REST_ALIGNMENT_CORRECTION.set(mixamoName, mirrorAcrossX(rightCorrection));
  // F = trueLeftRest^-1 * mirrorAcrossX(rightRest) — the frame the mirrored
  // correction actually transports the source delta through, relative to the
  // frame the rig is really bound in. Stored inverted, to post-multiply.
  const mirroredLeftRest = mirrorAcrossX(TARGET_WORLD_REST.get(rightName)!);
  const frameTwist = TARGET_WORLD_REST.get(mixamoName)!.clone().invert().multiply(mirroredLeftRest);
  MIRROR_FRAME_UNTWIST.set(mixamoName, frameTwist.invert());
}

/** Flip consecutive keyframe quaternions onto the same hemisphere so linear
 *  interpolation at playback takes the short way round (mirrors `clips.ts`'s
 *  `preserveQuaternionHemisphere`, operating on a plain values buffer here
 *  since these values are computed, not copied from an existing track). */
function fixQuaternionHemisphereContinuity(values: Float32Array): void {
  for (let offset = 4; offset < values.length; offset += 4) {
    const dot =
      values[offset - 4]! * values[offset]! +
      values[offset - 3]! * values[offset + 1]! +
      values[offset - 2]! * values[offset + 2]! +
      values[offset - 1]! * values[offset + 3]!;
    if (dot >= 0) continue;
    values[offset] = -values[offset]!;
    values[offset + 1] = -values[offset + 1]!;
    values[offset + 2] = -values[offset + 2]!;
    values[offset + 3] = -values[offset + 3]!;
  }
}

/**
 * Retarget one UAL1 clip (e.g. `Idle_Loop`) onto a generated humanoid rig via
 * the world-space-delta method described in this module's header. Throws
 * (listing every offender) if a track doesn't resolve to a known UAL1 bone,
 * or if the clip has no `pelvis.quaternion` track (nothing to retarget from).
 *
 * `outputName` lets the caller rename the clip (`locomotion-controller.ts`
 * binds 'Idle'/'Walk'/'Run', not UAL1's own `Idle_Loop`/`Walk_Loop`/
 * `Jog_Fwd_Loop` names) — defaults to the source clip's own name.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the retarget proof deliberately keeps track collection, FK, and emission in one reviewable pass.
export function retargetUal1ClipToHumanoid(
  clip: THREE.AnimationClip,
  target: HumanoidClipTarget,
  outputName: string = clip.name,
): THREE.AnimationClip {
  const quatTrackByBone = new Map<string, THREE.QuaternionKeyframeTrack>();
  let pelvisPositionTrack: THREE.VectorKeyframeTrack | null = null;
  const unresolved: string[] = [];

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    const boneName = dot > 0 ? track.name.slice(0, dot) : null;
    const property = dot > 0 ? track.name.slice(dot + 1) : null;
    if (!boneName || !UAL1_INDEX_BY_NAME.has(boneName)) {
      unresolved.push(track.name);
      continue;
    }
    if (property === 'quaternion') {
      quatTrackByBone.set(boneName, track as THREE.QuaternionKeyframeTrack);
    } else if (property === 'position' && boneName === 'pelvis') {
      pelvisPositionTrack = track as THREE.VectorKeyframeTrack;
    }
    // 'scale' and every other property: dropped by policy (rest scale is
    // always 1; only the hips position track carries meaningful motion).
  }
  if (unresolved.length > 0) {
    throw new Error(
      `humanoid: UAL1 clip '${clip.name}' has ${unresolved.length} track(s) that do not resolve ` +
        `to a known UAL1 skeleton bone: ${unresolved.slice(0, 12).join(', ')}`,
    );
  }
  if (!quatTrackByBone.has('pelvis')) {
    throw new Error(
      `humanoid: UAL1 clip '${clip.name}' has no 'pelvis.quaternion' track — nothing to retarget from`,
    );
  }

  // Canonical sample grid: the union of every quaternion track's own times
  // (in practice UAL1's baked clips sample every joint uniformly, so this is
  // just that one shared array — the union guards the general case).
  const timeSet = new Set<number>();
  for (const track of quatTrackByBone.values()) for (const t of track.times) timeSet.add(t);
  const times = Float32Array.from([...timeSet].sort((a, b) => a - b));

  const sourceLocal = UAL1_SKELETON_DEF.map(([, , , rest]) => new THREE.Quaternion(...rest));
  const interpolants = new Map(
    [...quatTrackByBone.entries()].map(([bone, track]) => [
      bone,
      track.InterpolantFactoryMethodLinear(),
    ]),
  );

  // Accumulate output values per emitted target bone (one Quaternion per
  // canonical time, flattened to xyzw on write-out).
  const outputValues = new Map<string, Float32Array>();
  for (const boneName of quatTrackByBone.keys()) {
    const targetName = UAL1_TO_MIXAMO_BONE_MAP.get(boneName);
    if (targetName) outputValues.set(targetName, new Float32Array(times.length * 4));
  }

  for (let frame = 0; frame < times.length; frame++) {
    const t = times[frame]!;

    // 1. Source FK: world orientation of every UAL1 joint at time t.
    const sourceWorld: THREE.Quaternion[] = [];
    UAL1_SKELETON_DEF.forEach(([name, parentIndex], i) => {
      const interpolant = interpolants.get(name);
      let local: THREE.Quaternion;
      if (interpolant) {
        const sample = interpolant.evaluate(t) as ArrayLike<number>;
        local = new THREE.Quaternion(sample[0], sample[1], sample[2], sample[3]);
      } else {
        local = sourceLocal[i]!;
      }
      const parentWorld = parentIndex >= 0 ? sourceWorld[parentIndex]! : new THREE.Quaternion();
      sourceWorld[i] = parentWorld.clone().multiply(local);
    });

    // 2. Retarget every eligible bone: the source's RAW world orientation at
    //    time t, mapped into the target's frame by its precomputed constant
    //    rest-alignment correction (see REST_ALIGNMENT_CORRECTION's
    //    header) — NOT a delta reapplied to target rest, which was proven
    //    wrong (see the same header) when the two rigs' rest poses don't
    //    share an absolute orientation. Left-side bones then get the
    //    post-multiplied MIRROR_FRAME_UNTWIST, which completes the mirror
    //    correction into a proper change of basis (same header).
    const targetWorldAtT = new Map<string, THREE.Quaternion>();
    for (const [boneName, targetName] of UAL1_TO_MIXAMO_BONE_MAP) {
      if (!outputValues.has(targetName)) continue; // not animated in this clip
      const i = UAL1_INDEX_BY_NAME.get(boneName)!;
      const correction = REST_ALIGNMENT_CORRECTION.get(targetName)!;
      const worldAtT = correction.clone().multiply(sourceWorld[i]!);
      const untwist = MIRROR_FRAME_UNTWIST.get(targetName);
      if (untwist) worldAtT.multiply(untwist);
      targetWorldAtT.set(targetName, worldAtT);
    }
    for (const [targetName, worldAtT] of targetWorldAtT) {
      const parentName = TARGET_PARENT_NAME_BY_NAME.get(targetName)!;
      // Three cases: (1) no parent name at all — only `mixamorigHips` (row 0,
      // parentIndex -1) — its true parent-in-world is the constant armature
      // rotation; (2) the parent WAS retargeted this frame — use its
      // just-computed world value; (3) the parent exists but was excluded
      // from animation (the shoulder pass-through) — it stays at its OWN
      // rest world orientation, NOT the armature constant. Collapsing (3)
      // into the (1) fallback was the bug this comment replaced: it skipped
      // every intermediate bone between the armature and the excluded
      // parent (spine/shoulder), landing the arm ~0.4 m too high throughout
      // an entire walk cycle — caught by comparing the retargeted Walk
      // clip's hand-height trajectory against shoulder height (a correct
      // walk swings the hand mostly BELOW the shoulder; this bug held it
      // consistently above).
      const parentWorldAtT = !parentName
        ? TARGET_ARMATURE_QUAT
        : (targetWorldAtT.get(parentName) ?? TARGET_WORLD_REST.get(parentName)!);
      const local = parentWorldAtT.clone().invert().multiply(worldAtT);
      const out = outputValues.get(targetName)!;
      out[frame * 4] = local.x;
      out[frame * 4 + 1] = local.y;
      out[frame * 4 + 2] = local.z;
      out[frame * 4 + 3] = local.w;
    }
  }

  const tracks: THREE.KeyframeTrack[] = [];
  for (const [targetName, values] of outputValues) {
    fixQuaternionHemisphereContinuity(values);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${targetName}.quaternion`, times, values));
  }
  if (pelvisPositionTrack) {
    // Rest-relative, NOT a bare unit conversion: keep the source's hips
    // MOTION (root translation + vertical bob) scaled by the two rigs' hip
    // heights, and pin it to the TARGET's own hips rest. See
    // UAL1_TO_REFERENCE_HIPS_SCALE.
    const restScale = target.hipsPositionScale;
    const motionScale = 100 * UAL1_TO_REFERENCE_HIPS_SCALE * target.hipsPositionScale;
    const values = Float32Array.from(pelvisPositionTrack.values, (v, i) => {
      const axis = i % 3;
      return REFERENCE_HIPS_REST[axis]! * restScale + (v - UAL1_PELVIS_REST[axis]!) * motionScale;
    });
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${HUMANOID_HIPS_BONE}.position`,
        pelvisPositionTrack.times,
        values,
      ),
    );
  }

  return new THREE.AnimationClip(outputName, clip.duration, tracks, clip.blendMode);
}
