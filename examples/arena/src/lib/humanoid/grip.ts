/**
 * HELD-ITEM GRIP — the rig's grip convention, as first-class sockets.
 *
 * Three shipped builds hand-rolled hand-attachment math (FPS enemy rifle,
 * TPS player rifle, a cold-build staff) and all three got it wrong in the
 * same way — item parented at the WRIST bone origin with a guessed Euler,
 * because the rig defined no grip convention. This module makes the
 * convention part of the rig itself:
 *
 * THIS FILE IS THE RUNTIME HALF ONLY, and that is the whole shape of the
 * module now (2026-09-19, WORK.md §The mesh kit retires, M2): the SOCKET
 * DERIVATION — `computeGripFrame`, `createGripSockets`, `respecGripSockets`
 * and the `GRIP_PALM_T`/`GRIP_PALM_CLEARANCE_M`/`GRIP_BUSINESS_PITCH_RAD`
 * calibration constants they were tuned with — was deleted with the
 * parametric body engine it was typed against (`rig: HumanoidRig`). A
 * character is a `.blend` now, and its sockets are AUTHORED GEOMETRY in that
 * document, exported into the GLB like any other node. The derivation is at
 * the tag `archive/humanoid-engine-2026-09-19` if a generator ever needs it
 * again.
 *
 * SOCKETS — a plain NON-bone node under each hand bone: `GripSocket_L` under
 * `mixamorigLeftHand`, `GripSocket_R` under `mixamorigRightHand`. They are
 * not skeleton joints (never in `skeleton.bones`, untouched by clip
 * retargeting) and they survive the GLB round trip: the exporter writes them
 * as child nodes of the hand joints, and GLTFLoader re-parents them under the
 * hand bones on load. `getGripSocket` is how you find one.
 *
 * THE CANONICAL SOCKET FRAME — what a character `.blend` must place, and
 * what every function below assumes:
 *
 *   origin — the closed fist's GRIP-CHANNEL CENTER (under the knuckle line,
 *            one shaft-radius proud of the palm plane) — NOT the wrist;
 *   +Z     — the held item's BUSINESS AXIS (barrel/blade/beam direction —
 *            glTF forward). Points out of the fist past the index finger,
 *            raked ~18° from the wrist→knuckle line toward the palm (a
 *            closed fist rakes a held tool);
 *   +Y     — UP out of the closed grip on the THUMB side: the axis of the
 *            palm "channel" a gripped cylinder lies in, pointing out the
 *            thumb/index end of the fist (a sword pommel is at -Y, the
 *            blade-side of the hilt at +Y);
 *   +X     — completes the right-handed frame (`X = Y x Z`).
 *
 * The LEFT socket is the right's mirrored twin, and is itself right-handed —
 * an item attaches to either hand with the same identity transform.
 *
 * SOCKET SPACE IS WORLD-METRES AT REST: the socket's bone-local transform
 * bakes out the armature's internal scale, so an item authored in metres
 * parents under a socket with scale 1 and renders true size. This is
 * deliberate — a rifle is a fixed physical size regardless of the
 * character's stature.
 *
 * THE ITEM CONVENTION: a held prop models its grip at its ORIGIN with +Z
 * along its business axis (glTF forward), true metres. Such an item attaches
 * with `attachToGrip(root, item, side)` — a pure parent + identity. Imported
 * assets whose origin can't be re-authored declare where their grip actually
 * is via `opts.itemGrip`, and `attachToGrip` compensates with the inverse
 * transform.
 *
 * GRIP FINGER POSES: `GRIP_FINGER_POSES` is pure DATA — per-finger-bone
 * local rotations forming a named pose (`wrap`, the closed fist). While an
 * item is held, apply the pose each frame AFTER clip sampling (the examples'
 * procedural-aim idiom — animation phase, after `mixer.update`/binding
 * tick): `attachment.applyPose()`. Releasing the item and simply not calling
 * `applyPose` reverts the fingers to the clip-sampled pose on the next
 * sample. Per-item-diameter auto-fit is out of scope by design — `wrap` is
 * tuned against a ~3 cm shaft and reads correctly for the common
 * staff/rifle-grip range.
 *
 * TWO-HANDED ITEMS: author the off-hand contact point ON the item as a
 * child node named `Foregrip` (its +Z following the item's business axis),
 * then drive the off-hand there with the animation-assets capability's IK
 * (`IKChain`, src/lib/ik/ik-chain.ts — CCD over
 * the arm chain, preRender phase). `getForegrip` finds the node.
 */

import * as THREE from 'three';

const M = 'mixamorig';

export type GripSide = 'Left' | 'Right';

/** The rig-level socket node names (`getObjectByName` keys, stable across
 *  bake round-trips). */
export const GRIP_SOCKET_NAMES: Readonly<Record<GripSide, string>> = {
  Left: 'GripSocket_L',
  Right: 'GripSocket_R',
};

/** The item-side foregrip node name (the two-handed off-hand contact). */
export const FOREGRIP_NODE_NAME = 'Foregrip';

/** Find a rig's grip socket by name — works on a live `HumanoidRig.root`
 *  AND on a baked GLB's loaded scene (the bake preserves the nodes). Loud
 *  when absent: a rig without sockets predates this convention and must be
 *  re-baked. */
export function getGripSocket(root: THREE.Object3D, side: GripSide): THREE.Object3D {
  const socket = root.getObjectByName(GRIP_SOCKET_NAMES[side]);
  if (!socket) {
    throw new Error(
      `humanoid: no ${GRIP_SOCKET_NAMES[side]} under '${root.name || '(unnamed root)'}' — ` +
        'author the sockets in the character .blend (see this module header for the canonical frame) and re-export',
    );
  }
  return socket;
}

/** Find a held item's authored foregrip node (`Foregrip`), if any. */
export function getForegrip(item: THREE.Object3D): THREE.Object3D | null {
  return item.getObjectByName(FOREGRIP_NODE_NAME) ?? null;
}

// --- Grip finger poses (data) ------------------------------------------------

export type GripPoseName = 'wrap';

/** Local XYZ Euler rotations (radians) per finger bone, authored for the
 *  RIGHT hand; the left hand applies the z-mirror (−x, −y, z) — the two
 *  hands' bone frames are mirrored twins across their local XY plane.
 *  Keys are bone-name suffixes after `mixamorig<Side>`.
 *
 *  `wrap` — the closed fist around a ~3 cm shaft (staff, rifle grip, tool
 *  handle): fingers curl palm-ward about local +Z (proximal < middle joints,
 *  distal relaxes), pinky slightly deeper than index, thumb folded over the
 *  channel. Tuned against the staff fixture via bake + renders. */
export const GRIP_FINGER_POSES: Readonly<
  Record<GripPoseName, Readonly<Record<string, readonly [number, number, number]>>>
> = {
  wrap: {
    HandIndex1: [0, 0, 1.15],
    HandIndex2: [0, 0, 1.35],
    HandIndex3: [0, 0, 0.7],
    HandMiddle1: [0, 0, 1.2],
    HandMiddle2: [0, 0, 1.3],
    HandMiddle3: [0, 0, 0.7],
    HandRing1: [0, 0, 1.1],
    HandRing2: [0, 0, 1.25],
    HandRing3: [0, 0, 0.65],
    HandPinky1: [0, 0, 1.1],
    HandPinky2: [0, 0, 1.1],
    HandPinky3: [0, 0, 0.65],
    HandThumb1: [-1.5, 0.3, -0.55],
    HandThumb2: [-0.4, 0, 0.8],
    HandThumb3: [0, 0, 0.8],
  },
};

/** Set one hand's finger bones to a named grip pose — ABSOLUTE local
 *  rotations (the standard rig's finger rest rotations are identity), meant
 *  to run each frame after clip sampling while the item is held. Missing
 *  bones are skipped (partial stub rigs); returns how many bones were
 *  posed. On release call `resetGripPose` (or `GripAttachment.detach`,
 *  which does): a clip whose finger values are CONSTANT will not rewrite an
 *  externally-posed bone (three's PropertyMixer skips unchanged values), so
 *  simply stopping the per-frame apply is only enough under clips with
 *  animated fingers. */
export function applyGripPose(
  root: THREE.Object3D,
  side: GripSide,
  pose: GripPoseName,
  boneCache?: Map<string, THREE.Object3D | null>,
): number {
  const table = GRIP_FINGER_POSES[pose];
  const mirror = side === 'Left';
  let applied = 0;
  for (const [suffix, [x, y, z]] of Object.entries(table)) {
    const name = `${M}${side}${suffix}`;
    let bone = boneCache?.get(name);
    if (bone === undefined) {
      bone = root.getObjectByName(name) ?? null;
      boneCache?.set(name, bone);
    }
    if (!bone) continue;
    bone.rotation.set(mirror ? -x : x, mirror ? -y : y, z, 'XYZ');
    applied++;
  }
  return applied;
}

/** Return one hand's finger bones to the rig's rest (identity local
 *  rotation) — the release counterpart of `applyGripPose` (see its note on
 *  constant-valued clip tracks). Returns how many bones were reset. */
export function resetGripPose(
  root: THREE.Object3D,
  side: GripSide,
  boneCache?: Map<string, THREE.Object3D | null>,
): number {
  let reset = 0;
  for (const suffix of Object.keys(GRIP_FINGER_POSES.wrap)) {
    const name = `${M}${side}${suffix}`;
    let bone = boneCache?.get(name);
    if (bone === undefined) {
      bone = root.getObjectByName(name) ?? null;
      boneCache?.set(name, bone);
    }
    if (!bone) continue;
    bone.rotation.set(0, 0, 0, 'XYZ');
    reset++;
  }
  return reset;
}

// --- Attachment --------------------------------------------------------------

/** Where an imported item's grip actually is, in the ITEM's own space — the
 *  escape hatch for assets whose origin can't be re-authored to the item
 *  convention. `attachToGrip` applies the INVERSE so this declared frame
 *  lands exactly on the socket. `scale` is item-units per metre (e.g. a
 *  model authored 1/0.35 of true size declares `scale: 1 / 0.35`). */
export interface ItemGripTransform {
  position?: readonly [number, number, number];
  rotationDeg?: readonly [number, number, number];
  scale?: number;
}

export interface AttachToGripOptions {
  /** The item's own grip frame (imported-asset override). Omit for items
   *  authored to the convention (grip at origin, +Z business axis). */
  itemGrip?: ItemGripTransform;
  /** Which finger pose to hold while attached (default `'wrap'`;
   *  `'none'` leaves the fingers to the animation clips). */
  grip?: GripPoseName | 'none';
}

/** The CARRY hold for shaft items (staff, torch, sword at rest): the shaft
 *  — the item's +Z business axis — lies IN the fist channel, business end
 *  up out of the thumb side (socket +Y). The canonical identity attach is
 *  the POINTING hold (business axis out past the index finger — guns,
 *  wands, a thrusting spear); carrying a shaft is the same item held 90°
 *  around, which is exactly an `itemGrip` orientation:
 *  `attachToGrip(root, staff, side, { itemGrip: CARRY_SHAFT_ITEM_GRIP })`. */
export const CARRY_SHAFT_ITEM_GRIP: ItemGripTransform = { rotationDeg: [90, 0, 0] };

/** A live grip attachment (returned by `attachToGrip`). */
export interface GripAttachment {
  socket: THREE.Object3D;
  item: THREE.Object3D;
  side: GripSide;
  grip: GripPoseName | 'none';
  /** Re-assert the item's attach-time local transform — call before any
   *  per-frame aim correction that rotated the item last frame. */
  resetItemTransform(): void;
  /** Apply the selected finger pose (no-op for `'none'`). Call each frame
   *  after clip sampling. Returns the number of bones posed. */
  applyPose(): number;
  /** Restore the item to its pre-attach parent and local transform. */
  detach(): void;
}

/**
 * Attach a held item to a hand's grip socket — purely mechanical: parent
 * under the socket at identity (or at the inverse of `opts.itemGrip` for
 * imported assets). The item then inherits everything the hand does — clips,
 * additive layers, procedural posing — with no per-frame code.
 */
export function attachToGrip(
  root: THREE.Object3D,
  item: THREE.Object3D,
  side: GripSide,
  opts: AttachToGripOptions = {},
): GripAttachment {
  const socket = getGripSocket(root, side);
  const previousParent = item.parent;
  const previous = {
    position: item.position.clone(),
    quaternion: item.quaternion.clone(),
    scale: item.scale.clone(),
  };

  const local = new THREE.Matrix4();
  const g = opts.itemGrip;
  if (g) {
    const d = Math.PI / 180;
    const [rx, ry, rz] = g.rotationDeg ?? [0, 0, 0];
    const [px, py, pz] = g.position ?? [0, 0, 0];
    const s = g.scale ?? 1;
    local
      .compose(
        new THREE.Vector3(px, py, pz),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * d, ry * d, rz * d, 'XYZ')),
        new THREE.Vector3(s, s, s),
      )
      .invert();
  }
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  local.decompose(position, quaternion, scale);

  socket.add(item);
  const resetItemTransform = (): void => {
    item.position.copy(position);
    item.quaternion.copy(quaternion);
    item.scale.copy(scale);
  };
  resetItemTransform();

  const grip = opts.grip ?? 'wrap';
  const boneCache = new Map<string, THREE.Object3D | null>();
  return {
    socket,
    item,
    side,
    grip,
    resetItemTransform,
    applyPose(): number {
      if (grip === 'none') return 0;
      return applyGripPose(root, side, grip, boneCache);
    },
    detach(): void {
      if (grip !== 'none') resetGripPose(root, side, boneCache);
      if (previousParent) previousParent.add(item);
      else item.removeFromParent();
      item.position.copy(previous.position);
      item.quaternion.copy(previous.quaternion);
      item.scale.copy(previous.scale);
    },
  };
}
