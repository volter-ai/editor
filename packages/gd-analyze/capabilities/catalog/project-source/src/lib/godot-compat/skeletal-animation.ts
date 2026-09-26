/**
 * `Animation` (skeletal) — a Godot `Animation`'s per-bone TRANSFORM tracks, as a
 * `THREE.AnimationClip` that drives the `Skeleton` {@link buildSkeleton} built.
 *
 * `player.tscn` authors eight `Animation` sub-resources (`default`, `walk-cycle`,
 * `falling-cycle`, …). Each holds ~27 `type = "transform"` tracks, one per bone,
 * whose `NodePath` is `Armature/Skeleton:<bone>` and whose `keys` are a flat
 * `PoolRealArray` of TWELVE floats per keyframe:
 *
 * ```
 * time, transition, loc.x, loc.y, loc.z, quat.x, quat.y, quat.z, quat.w, scale.x, scale.y, scale.z
 * ```
 *
 * This turns that into three's own animation system: a `QuaternionKeyframeTrack`
 * and two `VectorKeyframeTrack`s (position, scale) per bone, packed into one
 * `AnimationClip`. It hands back three's `AnimationClip` and nothing of its own —
 * the caller drives it with a `THREE.AnimationMixer` (`mixer.clipAction(clip)`),
 * the same return-path split `skeleton.ts`/`animation-player.ts` keep.
 *
 * ## rest * pose — the one conversion that matters
 *
 * A Godot skeletal transform track does NOT store a bone's absolute local
 * transform; it stores its POSE, which Godot composes onto the bone's rest:
 * `Skeleton::_notification(UPDATE_SKELETON)` builds each bone's local as
 * `rest * pose` (`scene/3d/skeleton.cpp`), and `AnimationPlayer` feeds the track
 * value in as that pose (`set_bone_pose`). A `THREE.Bone` is an `Object3D` whose
 * local matrix IS the full local transform — there is no separate rest slot — so
 * the keyframe VALUES three needs are `rest * pose`, composed here per keyframe
 * from the rig's own rest (which {@link buildSkeleton} posed the bones at). This
 * is why the `default` clip — every pose ≈ identity — renders the bone AT its
 * rest (`rest * I == rest`), i.e. the bind pose, and why a moving clip like
 * `falling-cycle` swings the bone away from it.
 *
 * There is no axis change: Godot and three are both right-handed, Y-up, with the
 * same `(x, y, z, w)` quaternion convention, so a pose quaternion means the same
 * rotation in each — the exact reason `skeleton.ts` copies `bones/N/rest` across
 * without flipping an axis.
 *
 * ## Interpolation matches Godot's, for the case the fixtures use
 *
 * Every measured track is `interp = 1` (LINEAR). Godot interpolates a LINEAR
 * transform track by `loc.linear_interpolate`, `rot.slerp` (shortest path), and
 * `scale.linear_interpolate` (`scene/animation/animation.cpp`); three's linear
 * `VectorKeyframeTrack` and its linear `QuaternionKeyframeTrack` (which slerps,
 * shortest-path via `Quaternion.slerpFlat`) are exactly those. Composing
 * `rest * pose` at each keyframe and letting three slerp BETWEEN them reproduces
 * Godot's `rest * slerp(pose₀, pose₁, c)` because slerp is left-invariant under a
 * unit rotation (`qᵣ · slerp(a, b, c) == slerp(qᵣa, qᵣb, c)`) — for a rest whose
 * basis is a rotation, which every authored bone rest is. `interp = 0` (NEAREST)
 * maps to three's `InterpolateDiscrete`, its exact counterpart. `interp = 2`
 * (CUBIC) is REFUSED by name: Godot's cubic is a Catmull-Rom-style hermite with
 * wrap-aware tangents that three's `InterpolateSmooth` does not reproduce, and no
 * measured track uses it, so a plausible-wrong curve is refused rather than shipped.
 *
 * ## Two authored spellings, ONE builder
 *
 * Godot 4 split that single `transform` track into three — `position_3d`, `rotation_3d`,
 * `scale_3d` — each with its own key times, its own `interp`, and its own key width
 * (`scene/resources/animation.cpp`: `POSITION_TRACK_SIZE 5`, `ROTATION_TRACK_SIZE 6`,
 * `SCALE_TRACK_SIZE 5`, each row `time, transition` then the component). Those arrive here as
 * {@link GodotSkeletalAnimation.componentTracks} and go through the SAME clip assembly: same
 * bone-presence refusal, same `interp` map, same transition factory, same `AnimationClip`. There
 * is no second builder and no second refusal vocabulary — only the key DECODE differs, which is
 * what "two spellings, one builder" means.
 *
 * **The one thing the two families do not share is the rest.** Godot 4's `Skeleton3D` made the
 * bone POSE the bone's LOCAL transform outright, initialised to rest — `reset_bone_pose` writes
 * `rest.origin`, `rest.basis.get_rotation_quaternion()` and `rest.basis.get_scale()` straight into
 * `pose_position`/`pose_rotation`/`pose_scale`, and `force_update_bone_children_transforms`
 * composes the bone's local from those three alone. So a Godot 4 key IS the value a `THREE.Bone`
 * wants, and composing `rest *` onto it would apply the rest twice. The `.tscn` proves it
 * independently: an imported Godot 4 rig serialises `bones/N/position`/`bones/N/rotation` on the
 * `Skeleton3D` node with the SAME numbers its generated `RESET` clip keys, which is only true if
 * the track value and the bone's local transform are the same quantity. Godot 3 keys a pose that
 * is composed onto rest; Godot 4 keys the local. Which family a track is in is therefore the whole
 * statement of which convention it carries — that is why they are two fields and not one field
 * plus a flag.
 *
 * The per-KEY transition exponent (float 1 of each 12-float key) is CARRIED, through the
 * interpolant factory `animation-transition.ts` owns. It used to be refused here on the grounds
 * that three interpolates per TRACK — true of the built-in interpolation MODE, but three's
 * `KeyframeTrack` also owns a replaceable interpolant factory, and `gltf-model.ts` was already
 * carrying the identical Godot field through it for a `.glb`'s own transform clip. One authored
 * field cannot be expressible on one clip builder and inexpressible on its sibling, so the factory
 * moved out of `gltf-model.ts` and all three builders share it. The eased factory is attached only
 * on the LINEAR path and only when an exponent differs from `1`: a NEAREST track holds its key
 * value, so Godot never reaches an interpolation factor to ease there either.
 * (The AnimationTree BLEND that mixes these clips is measured separately in
 * `packages/gd-analyze/test/ground-truth/godot36-animation.json` and carried in
 * `animation-tree.ts`; this file is the clips it blends.)
 *
 * ## Resource ownership
 *
 * **Owns:** nothing with a lifetime — {@link buildSkeletalClip} is pure, reading
 * the rig's rest and returning a fresh `AnimationClip`. **Does not own:** the
 * `AnimationMixer`, the `AnimationAction`s, or the `Skeleton` (the caller
 * built them). **Teardown:** none; the caller disposes the mixer it owns.
 */

import {
  AnimationClip,
  InterpolateDiscrete,
  type InterpolationModes,
  type KeyframeTrack,
  Matrix4,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { isGodotEased, withGodotTransitions } from './animation-transition';
import type { GodotSkeleton } from './skeleton';

/** Floats per keyframe in a Godot 3 `type="transform"` track's `PoolRealArray`:
 *  time, transition, loc(3), quat(4), scale(3). */
const FLOATS_PER_KEY = 12;

/** Floats per keyframe in each Godot 4 split 3D track — Godot's own `POSITION_TRACK_SIZE`,
 *  `ROTATION_TRACK_SIZE` and `SCALE_TRACK_SIZE` (`scene/resources/animation.cpp`). Every row is
 *  `time, transition` then the component: a `Vector3`, or a `Quaternion(x, y, z, w)`. */
const COMPONENT_FLOATS_PER_KEY: Readonly<Record<GodotBoneComponent, number>> = {
  position: 5,
  rotation: 6,
  scale: 5,
};

/** Which `THREE.Bone` property a Godot 4 component track drives. */
const COMPONENT_PROPERTY: Readonly<Record<GodotBoneComponent, string>> = {
  position: 'position',
  rotation: 'quaternion',
  scale: 'scale',
};

/** Godot's `Animation.INTERPOLATION_*` (`scene/resources/animation.h`). */
const GODOT_INTERP_NEAREST = 0;
const GODOT_INTERP_LINEAR = 1;
const GODOT_INTERP_CUBIC = 2;

/**
 * One `type = "transform"` track of a Godot `Animation`, as DATA the emitter lifts from
 * the `.tscn`. `boneName` is the bone the track's `NodePath` (`…Skeleton:<bone>`)
 * names, and `keys` is the raw `PoolRealArray` — {@link FLOATS_PER_KEY} floats per
 * keyframe.
 */
export interface GodotTransformTrack {
  /** The `<bone>` of the track's `NodePath("Armature/Skeleton:<bone>")`. */
  readonly boneName: string;
  /** `tracks/N/interp` — `0` NEAREST, `1` LINEAR, `2` CUBIC. */
  readonly interp: number;
  /** `tracks/N/keys` — the flat `PoolRealArray`, {@link FLOATS_PER_KEY} per key. */
  readonly keys: readonly number[];
}

/** The bone component ONE Godot 4 split track drives. */
export type GodotBoneComponent = 'position' | 'rotation' | 'scale';

/**
 * One Godot 4 `position_3d`/`rotation_3d`/`scale_3d` track, as DATA the emitter lifts from the
 * `.tscn`. Same shape as {@link GodotTransformTrack} except that `keys` holds only ONE component
 * per row, at that component's own width, and the value is the bone's LOCAL transform rather than
 * a pose composed onto rest — see this file's header.
 */
export interface GodotBoneComponentTrack {
  /** The `<bone>` of the track's `NodePath("Skeleton/Skeleton3D:<bone>")`. */
  readonly boneName: string;
  /** Which of the bone's three components this track drives. */
  readonly component: GodotBoneComponent;
  /** `tracks/N/interp` — `0` NEAREST, `1` LINEAR, `2` CUBIC. Per COMPONENT in Godot 4. */
  readonly interp: number;
  /** `tracks/N/keys` — the flat `PackedFloat32Array`, 5 floats per key for position/scale and 6
   *  for rotation. */
  readonly keys: readonly number[];
}

/**
 * One Godot `Animation` sub-resource: its `resource_name`, `length`, `loop`, and
 * the tracks that drive skeleton bones — in exactly one of the two authored spellings.
 */
export interface GodotSkeletalAnimation {
  /** `resource_name` — the clip's name (`AnimationPlayer`'s `anims/<name>` key on Godot 3, its
   *  `libraries/<lib>` entry key on Godot 4). */
  readonly name: string;
  /** `length`, in seconds. */
  readonly length: number;
  /** `loop` (Godot 3) / `loop_mode` (Godot 4). */
  readonly loop: boolean;
  /** Godot 3's `type = "transform"` tracks, one per driven bone. Poses, composed onto the bone's
   *  rest. */
  readonly tracks: readonly GodotTransformTrack[];
  /** Godot 4's split `position_3d`/`rotation_3d`/`scale_3d` tracks — up to three per driven bone,
   *  each on its own key times, each holding the bone's LOCAL value outright. A clip carries one
   *  family or the other, never both. */
  readonly componentTracks?: readonly GodotBoneComponentTrack[];
}

/** Each bone's LOCAL rest matrix, snapshotted from the rig the clip will drive. */
function restMatrices(rig: GodotSkeleton): Map<string, Matrix4> {
  const rests = new Map<string, Matrix4>();
  for (const bone of rig.bones) {
    bone.updateMatrix();
    rests.set(bone.name, bone.matrix.clone());
  }
  return rests;
}

/** Snapshot the local rest of each uniquely named bone under a runtime-loaded opaque model. */
function modelRestMatrices(model: Object3D): Map<string, Matrix4> {
  const rests = new Map<string, Matrix4>();
  const duplicates = new Set<string>();
  model.traverse((node) => {
    if (node.type !== 'Bone') return;
    if (rests.has(node.name)) duplicates.add(node.name);
    node.updateMatrix();
    rests.set(node.name, node.matrix.clone());
  });
  if (duplicates.size > 0) {
    throw new Error(
      `godot-compat: opaque model has duplicate bone name(s): ${[...duplicates].sort().join(', ')}. ` +
        "three binds an AnimationClip by bone name, so this model's target is ambiguous.",
    );
  }
  return rests;
}

/** three's interpolation for a Godot `interp` value; CUBIC refuses by name. */
function interpolation(interp: number, clip: string, bone: string): InterpolationModes | undefined {
  switch (interp) {
    case GODOT_INTERP_LINEAR:
      return undefined; // three's default: linear Vector, shortest-path slerp Quaternion.
    case GODOT_INTERP_NEAREST:
      return InterpolateDiscrete;
    case GODOT_INTERP_CUBIC:
      throw new Error(
        `godot-compat: Animation "${clip}" track for bone "${bone}" is CUBIC (interp=2). Godot's ` +
          "cubic is a wrap-aware hermite three's InterpolateSmooth does not reproduce; no measured " +
          'track is cubic, so this backend refuses rather than shipping a plausible-wrong curve.',
      );
    default:
      throw new Error(
        `godot-compat: Animation "${clip}" track for bone "${bone}" has interp=${interp}, which is ` +
          "not one of Godot's NEAREST(0)/LINEAR(1)/CUBIC(2).",
      );
  }
}

/**
 * Build a `THREE.AnimationClip` from a Godot `Animation`'s transform tracks,
 * composing each keyframe's `rest * pose` against the rig this clip will drive.
 *
 * `rig` is the {@link buildSkeleton} rig whose bones the tracks name; its bones
 * must be at their bind-pose rest (they are, until a mixer moves them — build
 * clips right after the rig). A track naming a bone the rig does not carry refuses
 * by name, because a clip silently missing a bone is the plausible-and-wrong outcome.
 */
export function buildSkeletalClip(
  animation: GodotSkeletalAnimation,
  rig: GodotSkeleton,
): AnimationClip {
  return buildSkeletalClipFromRests(animation, restMatrices(rig), 'rig');
}

/**
 * Build the same native clip against bones discovered in a runtime-loaded opaque GLB. The emitter
 * can read every authored transform key from the `.tscn`, while only the loaded model can supply the
 * bone rest transforms; this joins those two facts after the model has been cloned. Nothing is
 * inferred: a missing or duplicate bone refuses by name.
 */
export function buildOpaqueModelSkeletalClip(
  animation: GodotSkeletalAnimation,
  model: Object3D,
): AnimationClip {
  return buildSkeletalClipFromRests(animation, modelRestMatrices(model), 'opaque model');
}

function buildSkeletalClipFromRests(
  animation: GodotSkeletalAnimation,
  rests: ReadonlyMap<string, Matrix4>,
  source: string,
): AnimationClip {
  const tracks: KeyframeTrack[] = [];
  const rest = new Matrix4();
  const pose = new Matrix4();
  const final = new Matrix4();
  const loc = new Vector3();
  const quat = new Quaternion();
  const scale = new Vector3();
  const outPos = new Vector3();
  const outQuat = new Quaternion();
  const outScale = new Vector3();

  for (const track of animation.tracks) {
    const restMatrix = rests.get(track.boneName);
    if (restMatrix === undefined) {
      throw new Error(
        `godot-compat: Animation "${animation.name}" drives bone "${track.boneName}", which the ${source} ` +
          'does not carry. Every transform track must resolve to one real bone.',
      );
    }
    if (track.keys.length % FLOATS_PER_KEY !== 0) {
      throw new Error(
        `godot-compat: Animation "${animation.name}" track for bone "${track.boneName}" has ` +
          `${track.keys.length} floats, not a multiple of ${FLOATS_PER_KEY} (time, transition, ` +
          'loc×3, quat×4, scale×3 per key).',
      );
    }
    const interp = interpolation(track.interp, animation.name, track.boneName);
    rest.copy(restMatrix);

    const times: number[] = [];
    const posValues: number[] = [];
    const quatValues: number[] = [];
    const scaleValues: number[] = [];
    // key[k+1] is the key's TRANSITION exponent: Godot eases the segment leaving this key by
    // `Math::ease(c, transition)` (`animation.cpp` `_interpolate`), which at 1 is the plain
    // linear/slerp three does. Collected per key and handed to the shared interpolant factory
    // below; every measured key is 1, in which case the factory is not installed at all.
    const transitions: number[] = [];
    for (let k = 0; k < track.keys.length; k += FLOATS_PER_KEY) {
      const time = track.keys[k] as number;
      transitions.push(track.keys[k + 1] as number);
      loc.set(
        track.keys[k + 2] as number,
        track.keys[k + 3] as number,
        track.keys[k + 4] as number,
      );
      quat.set(
        track.keys[k + 5] as number,
        track.keys[k + 6] as number,
        track.keys[k + 7] as number,
        track.keys[k + 8] as number,
      );
      scale.set(
        track.keys[k + 9] as number,
        track.keys[k + 10] as number,
        track.keys[k + 11] as number,
      );
      pose.compose(loc, quat, scale);
      final.multiplyMatrices(rest, pose).decompose(outPos, outQuat, outScale);
      times.push(time);
      posValues.push(outPos.x, outPos.y, outPos.z);
      quatValues.push(outQuat.x, outQuat.y, outQuat.z, outQuat.w);
      scaleValues.push(outScale.x, outScale.y, outScale.z);
    }

    const posTrack = new VectorKeyframeTrack(`${track.boneName}.position`, times, posValues);
    const quatTrack = new QuaternionKeyframeTrack(
      `${track.boneName}.quaternion`,
      times,
      quatValues,
    );
    const scaleTrack = new VectorKeyframeTrack(`${track.boneName}.scale`, times, scaleValues);
    if (interp !== undefined) {
      posTrack.setInterpolation(interp);
      quatTrack.setInterpolation(interp);
      scaleTrack.setInterpolation(interp);
    }
    // All three tracks share the ONE key list, so they share its transitions. Installed only on the
    // linear path: `interp === undefined` IS three's linear default, and a DISCRETE (Godot NEAREST)
    // track holds its key value in both engines, so there is no factor for Godot to ease.
    if (interp === undefined && isGodotEased(transitions)) {
      withGodotTransitions(posTrack, transitions, false);
      withGodotTransitions(quatTrack, transitions, true);
      withGodotTransitions(scaleTrack, transitions, false);
    }
    tracks.push(posTrack, quatTrack, scaleTrack);
  }

  for (const track of animation.componentTracks ?? []) {
    if (!rests.has(track.boneName)) {
      throw new Error(
        `godot-compat: Animation "${animation.name}" drives bone "${track.boneName}", which the ${source} ` +
          'does not carry. Every transform track must resolve to one real bone.',
      );
    }
    const width = COMPONENT_FLOATS_PER_KEY[track.component];
    if (track.keys.length === 0 || track.keys.length % width !== 0) {
      throw new Error(
        `godot-compat: Animation "${animation.name}" ${track.component}_3d track for bone ` +
          `"${track.boneName}" has ${track.keys.length} floats, not a non-zero multiple of ` +
          `${width} (time, transition, ${track.component === 'rotation' ? 'quat×4' : 'vec×3'} per key).`,
      );
    }
    const interp = interpolation(track.interp, animation.name, track.boneName);
    const times: number[] = [];
    const values: number[] = [];
    const transitions: number[] = [];
    for (let k = 0; k < track.keys.length; k += width) {
      times.push(track.keys[k] as number);
      transitions.push(track.keys[k + 1] as number);
      // Godot 4's pose IS the bone's local transform, so the authored component goes through
      // unchanged — no `rest *`, which would apply the rest a second time (see the header).
      for (let c = 2; c < width; c += 1) values.push(track.keys[k + c] as number);
    }
    const rotation = track.component === 'rotation';
    const path = `${track.boneName}.${COMPONENT_PROPERTY[track.component]}`;
    const built = rotation
      ? new QuaternionKeyframeTrack(path, times, values)
      : new VectorKeyframeTrack(path, times, values);
    if (interp !== undefined) built.setInterpolation(interp);
    if (interp === undefined && isGodotEased(transitions)) {
      withGodotTransitions(built, transitions, rotation);
    }
    tracks.push(built);
  }

  // three's AnimationClip length defaults to the max track time; Godot's `length` can exceed that
  // (a clip padded past its last key). Pass it through so a padded clip's period is Godot's.
  return new AnimationClip(animation.name, animation.length, tracks);
}
