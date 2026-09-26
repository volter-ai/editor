/**
 * Godot's PER-KEY easing (`keys.transitions`) on a native three `KeyframeTrack`.
 *
 * A Godot `Animation` stores one easing exponent per SOURCE key. `animation.cpp`'s `_interpolate`
 * reads it from `p_keys[idx]` — the key the segment LEAVES — and remaps that segment's
 * interpolation factor through `Math::ease(c, transition)` before doing the ordinary
 * lerp/slerp. It is a third axis, orthogonal to the track's `interp` (NEAREST/LINEAR/CUBIC) and to
 * a value track's update mode.
 *
 * three has no serialized counterpart and its interpolation is per TRACK, which is why every clip
 * builder here refused a non-`1` transition at first. But a `KeyframeTrack` deliberately owns an
 * INTERPOLANT FACTORY (`createInterpolant`), and that is the seam: replace the factory with a
 * `LinearInterpolant`/`QuaternionLinearInterpolant` subclass that only remaps the factor and then
 * delegates the actual vector lerp / quaternion slerp to three's own implementation. The result is
 * still a real `THREE.AnimationClip` sampled by a real `THREE.AnimationMixer` — no second
 * animation system, no playhead, no runtime of its own.
 *
 * `gltf-model.ts` shipped this first, for a `.glb` instance's own transform clip; it lives here so
 * `skeletal-animation.ts` (bone transform tracks) and `value-track-animation.ts` (node property
 * tracks) carry the SAME authored data through the SAME mechanism. Three clip builders reading one
 * Godot field must not disagree about whether it is expressible.
 *
 * ## Where it applies, and where Godot itself does not ease
 *
 * Only a LINEARLY interpolated track eases. Godot's `_interpolate` for a NEAREST track, and for a
 * value track whose update mode is `DISCRETE`, returns the key's value outright — the transition
 * never reaches an interpolation factor, so it is inert in Godot too and skipping it here is the
 * faithful reading, not a shortcut. {@link withGodotTransitions} is therefore attached by callers
 * only on their linear path, and only when {@link isGodotEased} says an exponent actually differs
 * from `1` (at `1` the remap is the identity, so leaving three's own interpolant in place is both
 * cheaper and exactly equal).
 *
 * ## Resource ownership
 *
 * **Owns:** nothing with a lifetime. {@link withGodotTransitions} mutates the caller's track in
 * place (installing the factory) and hands the same track back; the interpolant instances are
 * three's own, minted by three's own mixer when it binds the track. **Does not own:** the track,
 * the clip, the mixer. **Teardown:** none.
 */

import {
  type KeyframeTrack,
  LinearInterpolant,
  QuaternionLinearInterpolant,
  type TypedArray,
} from 'three';

/**
 * Godot 3.6 `core/math/math_funcs.cpp`'s `Math::ease`, applied to a normalized segment position.
 *
 * Note the `curve === 0` branch: Godot's comment calls it "no ease (raw)" but the function returns
 * `0`, which HOLDS the segment at its start key and jumps at the end. That is transcribed as
 * written — reading the comment instead of the code would produce a linear segment Godot never
 * draws.
 */
export function godotEase(position: number, curve: number): number {
  const x = Math.max(0, Math.min(1, position));
  if (curve > 0) {
    return curve < 1 ? 1 - (1 - x) ** (1 / curve) : x ** curve;
  }
  if (curve < 0) {
    return x < 0.5 ? (x * 2) ** -curve * 0.5 : (1 - (1 - (x - 0.5) * 2) ** -curve) * 0.5 + 0.5;
  }
  return 0;
}

/** Whether any authored exponent actually eases. `1` is the identity remap, and every measured
 *  Godot key so far is `1` — so the common case keeps three's own interpolant untouched. */
export function isGodotEased(transitions: readonly number[]): boolean {
  return transitions.some((transition) => transition !== 1);
}

/** A vector interpolant with Godot's source-key transition applied before three's native lerp. */
class GodotLinearInterpolant extends LinearInterpolant {
  constructor(
    parameterPositions: TypedArray,
    sampleValues: TypedArray,
    sampleSize: number,
    private readonly transitions: readonly number[],
    resultBuffer?: TypedArray | null,
  ) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
  }

  override interpolate_(i1: number, t0: number, t: number, t1: number): TypedArray {
    const eased = godotEase((t - t0) / (t1 - t0), this.transitions[i1 - 1] ?? 1);
    return super.interpolate_(i1, t0, t0 + eased * (t1 - t0), t1) as TypedArray;
  }
}

/** A quaternion interpolant with the same remap before three's native quaternion slerp. */
class GodotQuaternionInterpolant extends QuaternionLinearInterpolant {
  constructor(
    parameterPositions: TypedArray,
    sampleValues: TypedArray,
    sampleSize: number,
    private readonly transitions: readonly number[],
    resultBuffer?: TypedArray | null,
  ) {
    super(parameterPositions, sampleValues, sampleSize, resultBuffer);
  }

  override interpolate_(i1: number, t0: number, t: number, t1: number): TypedArray {
    const eased = godotEase((t - t0) / (t1 - t0), this.transitions[i1 - 1] ?? 1);
    return super.interpolate_(i1, t0, t0 + eased * (t1 - t0), t1) as TypedArray;
  }
}

type TrackWithInterpolantFactory = KeyframeTrack & {
  createInterpolant(result?: TypedArray | null): LinearInterpolant | QuaternionLinearInterpolant;
};

/**
 * Attach Godot's transition-aware factory to a native three keyframe track, returning that same
 * track. `transitions` is one exponent per key of the track AS BUILT (a caller that added boundary
 * keys for a wrapped loop, or resampled, passes the array matching its final key list).
 *
 * `animation.cpp`'s `_interpolate` reads the transition from `p_keys[idx]` — the key the segment
 * leaves — hence the `i1 - 1` index in both interpolants: three names the segment by its END key.
 *
 * `quaternion` selects the slerping interpolant. It is a parameter rather than an instanceof check
 * because a `QuaternionKeyframeTrack` is the only track whose values are not componentwise-lerpable,
 * and the caller always knows which it built.
 */
export function withGodotTransitions<T extends KeyframeTrack>(
  track: T,
  transitions: readonly number[],
  quaternion: boolean,
): T {
  (track as unknown as TrackWithInterpolantFactory).createInterpolant = (
    result?: TypedArray | null,
  ) =>
    quaternion
      ? new GodotQuaternionInterpolant(
          track.times,
          track.values,
          track.getValueSize(),
          transitions,
          result,
        )
      : new GodotLinearInterpolant(
          track.times,
          track.values,
          track.getValueSize(),
          transitions,
          result,
        );
  return track;
}
