/**
 * REST-RELATIVE CLIP AUTHORING + the clip self-checks, for any rigged asset:
 * `assertClipRestBoundaries` (does it return to REST — what an additive layer
 * needs) and `assertClipLoops` (does it return to WHERE IT STARTED — what a
 * cyclic clip needs), plus `sampleAnimatedDeformedBounds`.
 *
 * Skeleton-agnostic by construction — it speaks `THREE.Bone`, `THREE.Object3D`
 * and `THREE.AnimationClip` and knows nothing about humanoids — so it lives
 * here in `lib/bake`, the procedural-asset family's shared home, beside
 * `clip-layering.ts`. `lib/humanoid/rest-relative-animation.ts` re-exports it
 * verbatim, so every import path that ever worked still does.
 *
 * REMOVAL LINE: delete this file and its humanoid re-export. You lose the
 * ability to AUTHOR clips as pose deltas and the loud checks; retargeted
 * clips and baking are unaffected.
 */

import * as THREE from 'three';

export type EulerDelta = readonly [x: number, y: number, z: number];

function createTrackInterpolant(track: THREE.KeyframeTrack): {
  evaluate(time: number): ArrayLike<number>;
} {
  // Three assigns this native factory at runtime, but its r180 declarations
  // omit the property. Keep the runtime factory so custom track interpolation
  // remains intact.
  const factory = (
    track as THREE.KeyframeTrack & {
      createInterpolant?: () => { evaluate(time: number): ArrayLike<number> };
    }
  ).createInterpolant;
  if (!factory) throw new Error(`Animation track ${track.name} has no interpolant factory.`);
  return factory.call(track);
}

/** Build an absolute quaternion track from local deltas without erasing rest orientation. */
export function createRestRelativeQuaternionTrack(
  bone: THREE.Bone,
  times: readonly number[],
  deltas: readonly EulerDelta[],
): THREE.QuaternionKeyframeTrack {
  if (times.length !== deltas.length || times.length === 0) {
    throw new Error(
      `Rest-relative track for ${bone.name} needs one delta per time (${times.length} times, ${deltas.length} deltas).`,
    );
  }
  const rest = bone.quaternion.clone().normalize();
  const values: number[] = [];
  let previous: THREE.Quaternion | undefined;
  for (const [x, y, z] of deltas) {
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    const value = rest.clone().multiply(delta).normalize();
    if (previous && previous.dot(value) < 0) value.set(-value.x, -value.y, -value.z, -value.w);
    values.push(value.x, value.y, value.z, value.w);
    previous = value;
  }
  return new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [...times], values);
}

/** Assert that a clip intentionally authored to return to rest actually does so. */
export function assertClipRestBoundaries(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  sampleTimes: readonly number[] = [0, clip.duration],
  toleranceRadians = 1e-4,
): void {
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion')) continue;
    const nodeName = track.name.slice(0, -'.quaternion'.length);
    const node = root.getObjectByName(nodeName);
    if (!node) throw new Error(`Clip '${clip.name}' targets missing node '${nodeName}'.`);
    const rest = node.quaternion.clone().normalize();
    const interpolant = createTrackInterpolant(track);
    for (const time of sampleTimes) {
      const sample = interpolant.evaluate(time);
      const value = new THREE.Quaternion(sample[0], sample[1], sample[2], sample[3]).normalize();
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(rest.dot(value)), -1, 1));
      if (!Number.isFinite(angle) || angle > toleranceRadians) {
        throw new Error(
          `Clip '${clip.name}' erases the rest orientation of '${nodeName}' at t=${time.toFixed(3)} (error ${angle.toFixed(6)} rad).`,
        );
      }
    }
  }
}

/**
 * Assert that a clip authored to LOOP actually does: every track's first and
 * last keyframe values agree within `tolerance`, over a positive duration.
 *
 * The cyclic sibling of {@link assertClipRestBoundaries}, and deliberately a
 * different check. That one asks "does the clip return to REST" — the property
 * an additive layer needs, measured against the skeleton. This one asks "does
 * the clip return to WHERE IT STARTED", which is what a looping clip needs and
 * is a strictly weaker, skeleton-free property: a walk cycle, a wingbeat or an
 * idle breath holds a pose that is nowhere near rest and must still meet
 * itself seamlessly. Reaching for the rest check on a cyclic clip fails every
 * honest loop; reaching for neither is how a one-frame pop ships, because the
 * seam is exactly the frame nobody scrubs to.
 *
 * Works on the raw track VALUES rather than an interpolant, so it is exact and
 * says nothing about the interpolation between the ends: what it catches is
 * the authoring mistake — a phase gradient that does not close, a sine sampled
 * over an open interval, a keyed track whose last value was never brought back
 * — not a curve's shape.
 *
 * Throws naming the failing track and its drift; returns nothing when clean.
 */
export function assertClipLoops(clip: THREE.AnimationClip, tolerance = 1e-4): void {
  if (!(clip.duration > 0)) {
    throw new Error(
      `Clip '${clip.name}' cannot loop: its duration is ${clip.duration} — a cycle with no length.`,
    );
  }
  for (const track of clip.tracks) {
    const stride = track.getValueSize();
    const { values } = track;
    if (values.length < stride) {
      throw new Error(`Clip '${clip.name}' track '${track.name}' has no keyframe values.`);
    }
    let drift = 0;
    for (let i = 0; i < stride; i += 1) {
      drift = Math.max(
        drift,
        Math.abs((values[i] as number) - (values[values.length - stride + i] as number)),
      );
    }
    if (!Number.isFinite(drift) || drift > tolerance) {
      throw new Error(
        `Clip '${clip.name}' does not loop: track '${track.name}' drifts by ${drift.toFixed(5)} ` +
          `between t=0 and t=${clip.duration} (tolerance ${tolerance}).`,
      );
    }
  }
}

export interface AnimatedBoundsSample {
  bindDiagonal: number;
  maximumDiagonal: number;
  maximumExpansionRatio: number;
  samples: number;
}

/** Sample precise SkinnedMesh bounds across a clip, restoring the source pose afterward. */
export function sampleAnimatedDeformedBounds(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  sampleCount = 20,
  allowedExpansionRatio = 3,
): AnimatedBoundsSample {
  if (sampleCount < 1) throw new Error('Animated bounds sampling needs at least one interval.');
  const saved = new Map<
    THREE.Object3D,
    { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }
  >();
  root.traverse((object) => {
    saved.set(object, {
      position: object.position.clone(),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
  });
  const preciseBounds = () => {
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
        const skinned = mesh as THREE.SkinnedMesh;
        skinned.computeBoundingBox();
        if (skinned.boundingBox) {
          bounds.union(skinned.boundingBox.clone().applyMatrix4(skinned.matrixWorld));
        }
      } else {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) {
          bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
        }
      }
    });
    if (bounds.isEmpty()) throw new Error('Animated bounds sampling found no mesh bounds.');
    const diagonal = bounds.getSize(new THREE.Vector3()).length();
    if (!Number.isFinite(diagonal) || diagonal <= 0) {
      throw new Error(`Animated bounds produced invalid diagonal ${diagonal}.`);
    }
    return diagonal;
  };

  const bindDiagonal = preciseBounds();
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  let maximumDiagonal = bindDiagonal;
  try {
    for (let index = 0; index <= sampleCount; index += 1) {
      mixer.setTime((clip.duration * index) / sampleCount);
      maximumDiagonal = Math.max(maximumDiagonal, preciseBounds());
    }
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const [object, transform] of saved) {
      object.position.copy(transform.position);
      object.quaternion.copy(transform.quaternion);
      object.scale.copy(transform.scale);
    }
    root.updateMatrixWorld(true);
  }
  const maximumExpansionRatio = maximumDiagonal / bindDiagonal;
  if (!Number.isFinite(maximumExpansionRatio) || maximumExpansionRatio > allowedExpansionRatio) {
    throw new Error(
      `Clip '${clip.name}' expands deformed bounds by ${maximumExpansionRatio.toFixed(3)}× (limit ${allowedExpansionRatio}×).`,
    );
  }
  return { bindDiagonal, maximumDiagonal, maximumExpansionRatio, samples: sampleCount + 1 };
}
