/**
 * THE NLA'S TIMING: which strip of each track a scene frame falls on, the action frame that strip
 * shows, its influence, and where the active action is placed over the tracks. One answer, used by
 * the Timeline (`blender-runtime-skin.ts`) and by a game (`blender-play-skin.ts`), and both follow
 * what Blender itself does:
 *
 * - THE STACK is `BKE_animsys_evaluate_animdata`'s: the NLA tracks bottom to top (mute and solo as
 *   Blender reads them), then the active action over them. A strip's time is
 *   `nlastrip_get_frame_actionclip`'s (scale, repeat, reverse), its influence its blend in and out
 *   or its keyed `influence` (that one F-Curve evaluated as `fcurve_eval_keyframes` does), and
 *   outside it the track holds as its extrapolation says.
 *
 * The layers it answers are played by three.js (`blender-mixer-pose.ts`): Blender samples each
 * action, and an `AnimationMixer` blends them.
 *
 * LICENCE. This file follows Blender's source (the functions named above), so it is a derivative
 * work of Blender and is GPL-3.0-or-later, not the AGPL the package's own code carries
 * (`../LICENSE`). Blender, Copyright (C) Blender Authors, GPL-2.0-or-later. It must not be
 * copied into an Apache-2.0 or MIT package.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import type { BlenderClipCurve } from '@volter/blender-engine/browser/rna';
import type { BlenderArmatureAnimation, BlenderNlaStrip } from '@volter/blender-engine/browser/three/blender-runtime-armature';
import type { MixerClip, MixerLayer } from './blender-mixer-pose';

function float32Of(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

/** One F-Curve, as Blender evaluates it. */
interface PoseCurve {
  readonly extrapolation: string;
  readonly interpolation: readonly number[];
  /** Six per key: `co`, `handle_left`, `handle_right`. */
  readonly keys: Float32Array;
  readonly cycles: readonly [number, number, number, number] | null;
}

function poseCurve(curve: Pick<BlenderClipCurve, 'extrapolation' | 'interpolation' | 'keysBase64'> & { readonly cycles?: BlenderClipCurve['cycles'] | undefined }): PoseCurve {
  return { extrapolation: curve.extrapolation, interpolation: curve.interpolation, keys: float32Of(curve.keysBase64), cycles: curve.cycles ?? null };
}

/** `BKE_fcurve_correct_bezpart`: shorten handles that overlap in time, so the curve is a function. */
function correctBezpart(v1: number[], v2: number[], v3: number[], v4: number[]): void {
  const h1 = [v1[0]! - v2[0]!, v1[1]! - v2[1]!];
  const h2 = [v4[0]! - v3[0]!, v4[1]! - v3[1]!];
  const length = v4[0]! - v1[0]!;
  const len1 = Math.abs(h1[0]!);
  const len2 = Math.abs(h2[0]!);
  if (len1 + len2 === 0) return;
  if (len1 + len2 > length) {
    const fac = length / (len1 + len2);
    v2[0] = v1[0]! - fac * h1[0]!;
    v2[1] = v1[1]! - fac * h1[1]!;
    v3[0] = v4[0]! - fac * h2[0]!;
    v3[1] = v4[1]! - fac * h2[1]!;
  }
}

/** The Bezier segment's value at `x` (`findzero` then `berekeny`): x(t) is monotonic once
 *  corrected, so its one root in [0, 1] is found by Newton steps kept inside a bisection. */
function bezierAt(x: number, v1: readonly number[], v2: readonly number[], v3: readonly number[], v4: readonly number[]): number {
  const cubic = (a: number, b: number, c: number, d: number, t: number): number => {
    const u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  };
  let lo = 0;
  let hi = 1;
  let t = (x - v1[0]!) / ((v4[0]! - v1[0]!) || 1);
  for (let i = 0; i < 60; i++) {
    const at = cubic(v1[0]!, v2[0]!, v3[0]!, v4[0]!, t) - x;
    if (Math.abs(at) < 1e-9) break;
    if (at < 0) lo = t;
    else hi = t;
    const u = 1 - t;
    const slope = 3 * u * u * (v2[0]! - v1[0]!) + 6 * u * t * (v3[0]! - v2[0]!) + 3 * t * t * (v4[0]! - v3[0]!);
    const next = slope !== 0 ? t - at / slope : (lo + hi) / 2;
    t = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  return cubic(v1[1]!, v2[1]!, v3[1]!, v4[1]!, t);
}

/** `fcurve_eval_keyframes`: the curve's own value at a frame, extrapolated past its keys. */
function keyframesAt(curve: PoseCurve, frame: number): number {
  const k = curve.keys;
  const count = k.length / 6;
  if (count === 0) return 0;
  const x = (i: number): number => k[i * 6]!;
  const y = (i: number): number => k[i * 6 + 1]!;
  if (count === 1) return y(0);
  const last = count - 1;
  // PAST AN END, a Linear curve leaves along the end key's own interpolation: its handle when it is
  // a Bezier key, the segment beside it when Linear, and not at all when Constant.
  if (frame <= x(0)) {
    if (curve.extrapolation !== 'LINEAR' || frame === x(0) || curve.interpolation[0] === 0) return y(0);
    const dx = x(0) - frame;
    if (curve.interpolation[0] === 2) {
      const fac = x(0) - k[2]!;
      return fac !== 0 ? y(0) - ((y(0) - k[3]!) / fac) * dx : y(0);
    }
    const fac = x(1) - x(0);
    return fac !== 0 ? y(0) - ((y(1) - y(0)) / fac) * dx : y(0);
  }
  if (frame >= x(last)) {
    if (curve.extrapolation !== 'LINEAR' || frame === x(last) || curve.interpolation[last] === 0) return y(last);
    const dx = frame - x(last);
    if (curve.interpolation[last] === 2) {
      const fac = k[last * 6 + 4]! - x(last);
      return fac !== 0 ? y(last) + ((k[last * 6 + 5]! - y(last)) / fac) * dx : y(last);
    }
    const fac = x(last) - x(last - 1);
    return fac !== 0 ? y(last) + ((y(last) - y(last - 1)) / fac) * dx : y(last);
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x(mid) <= frame) lo = mid;
    else hi = mid;
  }
  if (frame === x(lo)) return y(lo);
  const mode = curve.interpolation[lo] ?? 1;
  if (mode === 0) return y(lo);
  if (mode === 1) return y(lo) + ((y(hi) - y(lo)) * (frame - x(lo))) / (x(hi) - x(lo));
  const v1 = [x(lo), y(lo)];
  const v2 = [k[lo * 6 + 4]!, k[lo * 6 + 5]!];
  const v3 = [k[hi * 6 + 2]!, k[hi * 6 + 3]!];
  const v4 = [x(hi), y(hi)];
  const flat = 1.1920929e-7;
  if (Math.abs(v1[1]! - v4[1]!) < flat && Math.abs(v2[1]! - v3[1]!) < flat && Math.abs(v3[1]! - v4[1]!) < flat) return v1[1]!;
  correctBezpart(v1, v2, v3, v4);
  return bezierAt(frame, v1, v2, v3, v4);
}

/** The curve at a frame, through its Cycles modifier as `fcm_cycles_time` maps it. */
export function curveAt(curve: PoseCurve, frame: number): number {
  const cycles = curve.cycles;
  const k = curve.keys;
  const count = k.length / 6;
  if (!cycles || count < 2) return keyframesAt(curve, frame);
  const firstX = k[0]!;
  const firstY = k[1]!;
  const lastX = k[(count - 1) * 6]!;
  const lastY = k[(count - 1) * 6 + 1]!;
  let side = 0;
  let mode = 0;
  let limit = 0;
  let ofs = 0;
  if (frame < firstX && cycles[0]) { side = -1; mode = cycles[0]; limit = cycles[1]; ofs = firstX; }
  else if (frame > lastX && cycles[2]) { side = 1; mode = cycles[2]; limit = cycles[3]; ofs = lastX; }
  if (side === 0 || mode === 0) return keyframesAt(curve, frame);
  const cycdx = lastX - firstX;
  const cycdy = lastY - firstY;
  if (cycdx === 0) return keyframesAt(curve, frame);
  const cycle = (side * (frame - ofs)) / cycdx;
  if (limit && cycle >= limit) {
    // Past its count the curve holds where its last cycle ends.
    const odd = mode === 3 && limit % 2 === 1;
    const time = side === 1 ? (odd ? firstX : lastX) : (odd ? lastX : firstX);
    return keyframesAt(curve, time) + (mode === 2 ? cycdy * limit * side : 0);
  }
  const cyct = (frame - ofs) % cycdx;
  const offset = mode === 2 ? (side < 0 ? Math.floor((frame - ofs) / cycdx) : Math.ceil((frame - ofs) / cycdx)) * cycdy : 0;
  let time: number;
  if (cyct === 0) {
    time = side === 1 ? lastX : firstX;
    if (mode === 3 && Math.trunc(cycle) % 2) time = side === 1 ? firstX : lastX;
  } else if (mode === 3 && Math.trunc(cycle + 1) % 2) {
    time = side < 0 ? firstX - cyct : lastX - cyct;
  } else {
    time = (side < 0 ? lastX : firstX) + cyct;
  }
  if (time < firstX) time += cycdx;
  return keyframesAt(curve, time) + offset;
}

/**
 * THE ACTIVE ACTION'S LAYER at a scene frame, placed as `animsys_calculate_nla` places it: a soloed
 * track leaves it out; when no enabled track has strips (or the NLA is off) it is evaluated alone,
 * whole, at full influence; otherwise it is one more strip spanning its own range, at its influence
 * and blend type, holding or not past that range as its extrapolation says.
 */
export function actionLayer(animation: BlenderArmatureAnimation | undefined, clip: MixerClip, frame: number,
  stripsEvaluated: boolean): PoseLayer | null {
  const nla = animation?.useNla ?? true;
  if (nla && animation!.tracks.some((track) => track.solo)) return null;
  if (!nla || !stripsEvaluated) return { clip, frame, influence: 1, blend: 'REPLACE' };
  const extrapolation = animation!.extrapolation;
  let at = frame;
  if (frame < clip.keysStart) {
    if (extrapolation !== 'HOLD') return null;
    at = clip.keysStart;
  } else if (frame > clip.keysEnd) {
    if (extrapolation === 'NOTHING') return null;
    at = clip.keysEnd;
  }
  return { clip, frame: at, influence: animation!.influence, blend: animation!.blendType };
}

/** One layer of the stack: an action at a frame of its own, an influence, a blend type. */
export type PoseLayer = MixerLayer;

/** A clip by action name: the clip, `undefined` while it is being baked, null when it has none. */
export type ClipSource = (action: string) => MixerClip | null | undefined;

/** The strip a track plays at `frame`, and the time it plays it at (`nlastrips_ctime_get_strip`). */
function stripAt(strips: readonly BlenderNlaStrip[], frame: number): { strip: BlenderNlaStrip; time: number } | null {
  const live = strips.filter((strip) => !strip.mute).sort((a, b) => a.start - b.start);
  for (const strip of live) if (frame >= strip.start && frame <= strip.end) return { strip, time: frame };
  const first = live[0];
  if (!first) return null;
  if (frame < first.start) return first.extrapolation === 'HOLD' ? { strip: first, time: first.start } : null;
  let before: BlenderNlaStrip | null = null;
  for (const strip of live) if (strip.end < frame) before = strip;
  if (before && (before.extrapolation === 'HOLD' || before.extrapolation === 'HOLD_FORWARD')) return { strip: before, time: before.end };
  return null;
}

/** The action frame a strip shows at `time` (`nlastrip_get_frame_actionclip`, evaluation). */
function stripFrame(strip: BlenderNlaStrip, time: number): number {
  const length = strip.actionEnd - strip.actionStart || 1;
  const scale = Math.abs(strip.scale) || 1;
  const atWholeEnd = Math.abs(strip.repeat % 1) < 1e-6 && Math.abs(time - strip.end) < 1e-6;
  const into = ((time - strip.start) % (length * scale)) / scale;
  if (strip.reversed) return atWholeEnd ? strip.actionStart : strip.actionEnd - into;
  return atWholeEnd ? strip.actionEnd : strip.actionStart + into;
}

const influenceCurves = new WeakMap<object, PoseCurve>();

/** A strip's influence at `time`: its keyed curve when it is animated (`nlastrip_evaluate_controls`),
 *  else from its blend in and out (`nlastrip_get_influence`). */
function stripInfluence(strip: BlenderNlaStrip, time: number): number {
  if (strip.animatedInfluence) {
    const keyed = strip.influenceCurve;
    if (!keyed) return strip.influence;
    let curve = influenceCurves.get(keyed);
    if (!curve) influenceCurves.set(keyed, curve = poseCurve(keyed));
    return Math.max(0, Math.min(1, curveAt(curve, time)));
  }
  if (strip.blendIn > 0 && time >= strip.start && time <= strip.start + strip.blendIn) return (time - strip.start) / strip.blendIn;
  if (strip.blendOut > 0 && time >= strip.end - strip.blendOut && time <= strip.end) return (strip.end - time) / strip.blendOut;
  return 1;
}

/**
 * The NLA's layers at a scene frame, bottom to top, as Blender evaluates them. `waiting` says a
 * clip it needs is still being baked; `skipped` names what plays in Blender and not here;
 * `evaluated` says an enabled track has strips (what places the active action over the NLA).
 */
export function nlaLayers(animation: BlenderArmatureAnimation | undefined, frame: number, clips: ClipSource,
  tracks?: (name: string) => boolean): { layers: PoseLayer[]; waiting: boolean; skipped: string[]; evaluated: boolean } {
  const layers: PoseLayer[] = [];
  const skipped: string[] = [];
  let waiting = false;
  let evaluated = false;
  if (!animation || !animation.useNla) return { layers, waiting, skipped, evaluated };
  const solo = animation.tracks.some((track) => track.solo);
  for (const track of animation.tracks) {
    // ENABLED as `BKE_nlatrack_is_enabled` says: under a solo only the soloed track, muted or not.
    if ((solo ? !track.solo : track.mute) || (tracks && !tracks(track.name))) continue;
    // AN ENABLED TRACK WITH STRIPS places the active action over the NLA, whether or not the frame
    // falls on one of them (`animsys_evaluate_nla_for_flush`'s `has_strips`; measured in 5.2).
    if (track.strips.length) evaluated = true;
    const hit = stripAt(track.strips, frame);
    if (!hit) continue;
    const influence = stripInfluence(hit.strip, hit.time);
    if (hit.strip.type !== 'CLIP' || !hit.strip.action) {
      skipped.push(`the ${hit.strip.type.toLowerCase()} strip "${hit.strip.name}" on track "${track.name}"`);
      continue;
    }
    const clip = clips(hit.strip.action);
    if (clip === undefined) waiting = true;
    if (!clip) continue;
    layers.push({ clip, frame: stripFrame(hit.strip, hit.time), influence, blend: hit.strip.blendType });
  }
  return { layers, waiting, skipped, evaluated };
}
