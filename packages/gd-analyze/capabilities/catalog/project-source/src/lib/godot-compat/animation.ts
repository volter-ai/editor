/**
 * @godot-class Animation
 * @role PROTOCOL
 *
 * Godot 4.7's `Animation` resource (`scene/resources/animation.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`): tracks of timed keys and their sampling, which no
 * library supplies with Godot's semantics (key search with `is_equal_approx`, per-key easing
 * transitions, loop wrapping, method keys in a time range). Transcribed for the track types the
 * corpus uses: value, method, and 3D position/rotation/scale tracks; nearest and linear
 * interpolation. Cubic and angle interpolation, bezier/audio/animation/blend-shape tracks,
 * compressed tracks and markers are not transcribed (they throw).
 *
 * Times are `double`; a key's transition and the interpolation weight are `real_t` (float32).
 * A value key's Variant type is its JS type: a boolean is a `bool`, a number a `float` (an `int`
 * key is not representable), a record with `x, y, z` a `Vector3`, with `x, y, z, w` a `Quaternion`.
 * The Variant arithmetic the mixer blends with (`cast_to_blendwise`, `subtract_variant`,
 * `blend_variant`, `interpolate_variant`, `interpolate_via_rest`, `animation.cpp:5674-6300`) is
 * here as protocol for those types.
 */

import { construct as quaternion, inverse, normalized, op_multiply as quaternionMultiply, type Quaternion, slerp } from './quaternion';
import { lerp as vector3Lerp, construct as vector3, type Vector3 } from './vector3';

const f32 = Math.fround;
/** `CMP_EPSILON` (`core/math/math_defs.h:50`). */
const CMP_EPSILON = 0.00001;

/** `Animation::TrackType` (`animation.h:48`). */
const TYPE_VALUE = 0;
const TYPE_POSITION_3D = 1;
const TYPE_ROTATION_3D = 2;
const TYPE_SCALE_3D = 3;
const TYPE_METHOD = 5;
/** `Animation::InterpolationType` (`animation.h:60`). */
const INTERPOLATION_NEAREST = 0;
const INTERPOLATION_LINEAR = 1;
/** `Animation::UpdateMode` (`animation.h:68`). */
const UPDATE_DISCRETE = 1;
const UPDATE_CAPTURE = 2;
/** `Animation::LoopMode` (`animation.h:74`). */
const LOOP_NONE = 0;
const LOOP_LINEAR = 1;
/** `Animation::FindMode` (`animation.h:87`). */
const FIND_MODE_APPROX = 1;
const FIND_MODE_EXACT = 2;
/** `Animation::LoopedFlag` (`animation.h:81`). */
const LOOPED_FLAG_NONE = 0;

export interface AnimationKey {
  time: number;
  transition: number;
  value: unknown;
}

export interface AnimationTrack {
  readonly type: number;
  path: string;
  interpolation: number;
  loop_wrap: boolean;
  imported: boolean;
  enabled: boolean;
  update_mode: number;
  readonly keys: AnimationKey[];
}

export interface Animation {
  length: number;
  loop_mode: number;
  step: number;
  readonly tracks: AnimationTrack[];
}

const SUPPORTED_TYPES = new Set([TYPE_VALUE, TYPE_POSITION_3D, TYPE_ROTATION_3D, TYPE_SCALE_3D, TYPE_METHOD]);

function trackAt(self: Animation, track: number): AnimationTrack | undefined {
  return Number.isInteger(track) && track >= 0 ? self.tracks[track] : undefined;
}

// --- Math (`core/math/math_funcs.{h,cpp}`).

/** `Math::is_equal_approx(double, double)` (`math_funcs.h:528`). */
function isEqualApprox(a: number, b: number): boolean {
  if (a === b) return true;
  let tolerance = CMP_EPSILON * Math.abs(a);
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(a - b) < tolerance;
}

/** `Math::fposmod(double, double)` (`math_funcs.h:278`). */
function fposmod(x: number, y: number): number {
  let value = x % y;
  if ((value < 0 && y > 0) || (value > 0 && y < 0)) value += y;
  return value + 0;
}

/** `Math::ease` (`math_funcs.cpp:96`). */
function ease(x: number, c: number): number {
  const p = x < 0 ? 0 : x > 1 ? 1 : x;
  if (c > 0) return c < 1 ? 1 - Math.pow(1 - p, 1 / c) : Math.pow(p, c);
  if (c < 0) return p < 0.5 ? Math.pow(p * 2, -c) * 0.5 : (1 - Math.pow(1 - (p - 0.5) * 2, -c)) * 0.5 + 0.5;
  return 0;
}

// --- Variant arithmetic for the transcribed key types.

type Kind = 'nil' | 'bool' | 'float' | 'Vector3' | 'Quaternion';

function kindOf(value: unknown): Kind {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return 'float';
  if (typeof value === 'object' && 'x' in value && 'y' in value && 'z' in value) return 'w' in value ? 'Quaternion' : 'Vector3';
  throw new Error('godot-compat: an Animation value of this Variant type is not transcribed.');
}

/**
 * `Variant::zero` of the value's type (`variant.cpp`): what a value track's initial value is
 * before a RESET animation overrides it (`animation_mixer.cpp:742`).
 *
 * @godot Animation (protocol)
 * @source core/variant/variant.cpp:1306
 */
export function godot_animation_zero(value: unknown): unknown {
  switch (kindOf(value)) {
    case 'bool':
      return false;
    case 'float':
      return 0;
    case 'Vector3':
      return vector3();
    case 'Quaternion':
      return quaternion(0, 0, 0, 1);
    default:
      return null;
  }
}

/**
 * A bool becomes a double (`animation.cpp:5735`); other transcribed types are unchanged.
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:5735
 */
export function godot_animation_cast_to_blendwise(value: unknown): unknown {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value;
}

/**
 * Back to the initial value's type: a bool is `real_t(value) >= 0.5` (`animation.cpp:5769`).
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:5769
 */
export function godot_animation_cast_from_blendwise(value: unknown, like: unknown): unknown {
  return typeof like === 'boolean' ? f32(value as number) >= 0.5 : value;
}

function vectorOp(a: Vector3, b: Vector3, op: (x: number, y: number) => number): Vector3 {
  return vector3(f32(op(a.x, b.x)), f32(op(a.y, b.y)), f32(op(a.z, b.z)));
}

/**
 * `a - b` for blending (`animation.cpp:5937`): a Quaternion is `b.inverse() * a`; a mismatch of
 * types keeps `a`.
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:5937
 */
export function godot_animation_subtract_variant(a: unknown, b: unknown): unknown {
  const kind = kindOf(a);
  if (kind !== kindOf(b)) return a;
  switch (kind) {
    case 'nil':
      return null;
    case 'float':
      return (a as number) - (b as number);
    case 'bool':
      return a;
    case 'Quaternion':
      return quaternionMultiply(inverse(b as Quaternion), a as Quaternion);
    default:
      return vectorOp(a as Vector3, b as Vector3, (x, y) => x - y);
  }
}

/**
 * `a + b * c` for blending (`animation.cpp:5993`): a Quaternion is `a * Quaternion().slerp(b, c)`;
 * a bool blends as a double and converts back.
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:5993
 */
export function godot_animation_blend_variant(a: unknown, b: unknown, c: number): unknown {
  const weight = f32(c);
  const kind = kindOf(a);
  if (kind !== kindOf(b)) {
    if ((kind === 'bool' || kind === 'float') && (kindOf(b) === 'bool' || kindOf(b) === 'float')) {
      return godot_animation_blend_variant(godot_animation_cast_to_blendwise(a), godot_animation_cast_to_blendwise(b), weight);
    }
    return a;
  }
  switch (kind) {
    case 'nil':
      return null;
    case 'float':
      return (a as number) + (b as number) * weight;
    case 'bool':
      return godot_animation_cast_from_blendwise(
        godot_animation_blend_variant(godot_animation_cast_to_blendwise(a), godot_animation_cast_to_blendwise(b), weight),
        a,
      );
    case 'Quaternion':
      return quaternionMultiply(a as Quaternion, slerp(quaternion(0, 0, 0, 1), b as Quaternion, weight));
    default: {
      const u = a as Vector3;
      const v = b as Vector3;
      return vector3(f32(u.x + f32(v.x * weight)), f32(u.y + f32(v.y * weight)), f32(u.z + f32(v.z * weight)));
    }
  }
}

/**
 * Linear interpolation of two values (`animation.cpp:6212`): a float in double, a Vector3 by
 * `lerp`, a Quaternion by `slerp`, a bool as a double converted back.
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:6212
 */
export function godot_animation_interpolate_variant(a: unknown, b: unknown, c: number): unknown {
  const weight = f32(c);
  const kind = kindOf(a);
  if (kind !== kindOf(b)) {
    if ((kind === 'bool' || kind === 'float') && (kindOf(b) === 'bool' || kindOf(b) === 'float')) {
      return godot_animation_interpolate_variant(godot_animation_cast_to_blendwise(a), godot_animation_cast_to_blendwise(b), weight);
    }
    return a;
  }
  switch (kind) {
    case 'nil':
      return null;
    case 'float':
      return (a as number) + ((b as number) - (a as number)) * weight;
    case 'bool':
      return godot_animation_cast_from_blendwise(
        godot_animation_interpolate_variant(godot_animation_cast_to_blendwise(a), godot_animation_cast_to_blendwise(b), weight),
        a,
      );
    case 'Quaternion':
      return slerp(a as Quaternion, b as Quaternion, weight);
    default:
      return vector3Lerp(a as Vector3, b as Vector3, weight);
  }
}

/**
 * `(from * Quaternion().slerp(rest.inverse() * to, weight)).normalized()` (`animation.cpp:5688`).
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:5688
 */
export function godot_animation_interpolate_via_rest(from: Quaternion, to: Quaternion, weight: number, rest: Quaternion): Quaternion {
  return normalized(quaternionMultiply(from, slerp(quaternion(0, 0, 0, 1), quaternionMultiply(inverse(rest), to), f32(weight))));
}

// --- Keys.

/** `Animation::_find` (`animation.cpp:2399`): the key at or before `time` (after, backward). */
function find(self: Animation, keys: readonly AnimationKey[], time: number, backward = false, limit = false): number {
  const len = keys.length;
  if (len === 0) return -2;
  let low = 0;
  let high = len - 1;
  let middle = 0;
  while (low <= high) {
    middle = Math.trunc((low + high) / 2);
    const at = (keys[middle] as AnimationKey).time;
    if (isEqualApprox(time, at)) return middle;
    if (time < at) high = middle - 1;
    else low = middle + 1;
  }
  const at = (keys[middle] as AnimationKey).time;
  if (!backward) {
    if (at > time) middle -= 1;
  } else if (at < time) {
    middle += 1;
  }
  if (limit && middle > -1 && middle < len) {
    const keyTime = (keys[middle] as AnimationKey).time;
    const diff = self.length - keyTime;
    if ((keyTime < 0 && Math.abs(keyTime) >= CMP_EPSILON) || (diff < 0 && Math.abs(diff) >= CMP_EPSILON)) return -1;
  }
  return middle;
}

/**
 * `Animation::_insert` (`animation.cpp:1093`): replaces a key at an approximately equal time,
 * keeping the replaced key's transition.
 */
function insert(keys: AnimationKey[], key: AnimationKey): number {
  let idx = keys.length;
  for (;;) {
    const previous = keys[idx - 1];
    if (idx > 0 && previous !== undefined && isEqualApprox(previous.time, key.time)) {
      keys[idx - 1] = { ...key, transition: previous.transition };
      return idx - 1;
    }
    if (idx === 0 || (previous as AnimationKey).time < key.time) {
      keys.splice(idx, 0, key);
      return idx;
    }
    idx -= 1;
  }
}

/** `Animation::_interpolate` (`animation.cpp:2519`), for nearest and linear interpolation. */
function interpolate(self: Animation, track: AnimationTrack, time: number, interp: number, backward: boolean): { ok: boolean; value: unknown } {
  const keys = track.keys;
  const len = find(self, keys, self.length) + 1;
  if (len <= 0) return { ok: false, value: undefined };
  if (len === 1) return { ok: true, value: (keys[0] as AnimationKey).value };
  let idx = find(self, keys, time, backward);
  const maxi = len - 1;
  const isStartEdge = backward ? idx >= len : idx === -1;
  const isEndEdge = backward ? idx === 0 : idx >= maxi;
  let delta = 0;
  let from = 0;
  let next: number;
  const at = (i: number) => (keys[i] as AnimationKey).time;
  if (!track.loop_wrap || self.loop_mode === LOOP_NONE) {
    if (isStartEdge) idx = backward ? maxi : 0;
    next = Math.min(Math.max(idx + (backward ? -1 : 1), 0), maxi);
  } else if (self.loop_mode === LOOP_LINEAR) {
    if (isStartEdge) idx = backward ? 0 : maxi;
    next = (((idx + (backward ? -1 : 1)) % len) + len) % len;
    if (isStartEdge) {
      if (!backward) {
        let endtime = f32(self.length - at(idx));
        if (endtime < 0) endtime = 0;
        delta = f32(endtime + at(next));
        from = f32(endtime + time);
      } else {
        let endtime = f32(at(idx));
        if (endtime > self.length) endtime = f32(self.length);
        delta = f32(endtime + self.length - at(next));
        from = f32(endtime + self.length - time);
      }
    } else if (isEndEdge) {
      if (!backward) {
        delta = f32(self.length - at(idx) + at(next));
        from = f32(time - at(idx));
      } else {
        delta = f32(at(idx) + (self.length - at(next)));
        from = f32(self.length - time - (self.length - at(idx)));
      }
    }
  } else {
    throw new Error('godot-compat: ping-pong key wrapping is not transcribed.');
  }
  if (!isStartEdge && !isEndEdge) {
    if (!backward) {
      delta = f32(at(next) - at(idx));
      from = f32(time - at(idx));
    } else {
      delta = f32(self.length - at(next) - (self.length - at(idx)));
      from = f32(self.length - time - (self.length - at(idx)));
    }
  }
  let c = Math.abs(delta) < f32(CMP_EPSILON) ? 0 : f32(from / delta);
  const key = keys[idx] as AnimationKey;
  const tr = key.transition;
  if (tr === 0) return { ok: true, value: key.value };
  if (tr !== 1) c = f32(ease(c, tr));
  if (interp === INTERPOLATION_NEAREST) return { ok: true, value: key.value };
  if (interp !== INTERPOLATION_LINEAR) throw new Error('godot-compat: cubic and angle interpolation are not transcribed.');
  return { ok: true, value: godot_animation_interpolate_variant(key.value, (keys[next] as AnimationKey).value, c) };
}

/**
 * A 3D track's value at `time`, or undefined when it has no key in range (`try_*_interpolate`,
 * `animation.cpp:1183`, `:1263`, `:1343`).
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:1183
 */
export function godot_animation_try_interpolate(self: Animation, track: number, time: number, backward = false): unknown {
  const t = trackAt(self, track);
  if (t === undefined) return undefined;
  const result = interpolate(self, t, time, t.interpolation, backward);
  return result.ok ? result.value : undefined;
}

/**
 * The keys crossed moving by `delta` to `time` within `[start, end]` (`animation.cpp:2816`), for
 * no loop and linear loop, forward and backward.
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:2816
 */
export function godot_animation_key_indices_in_range(
  self: Animation,
  track: number,
  time: number,
  delta: number,
  startTime: number,
  endTime: number,
  loopedFlag: number,
): number[] {
  const indices: number[] = [];
  const t = trackAt(self, track);
  if (t === undefined || delta === 0) return indices;
  let fromTime = time - delta;
  let toTime = time;
  const start = startTime < 0 ? 0 : startTime;
  const end = endTime > self.length ? self.length : endTime;
  let isBackward = false;
  if (fromTime > toTime) {
    isBackward = true;
    [fromTime, toTime] = [toTime, fromTime];
  }
  const range = (from: number, to: number, backward: boolean) => rangeIndices(t.keys, from, to, backward, indices);
  if (self.loop_mode === LOOP_NONE) {
    fromTime = Math.min(Math.max(fromTime, 0), end);
    toTime = Math.min(Math.max(toTime, 0), end);
  } else if (self.loop_mode === LOOP_LINEAR) {
    if (fromTime > end || fromTime < start) fromTime = fposmod(fromTime, end);
    if (toTime > end || toTime < start) toTime = fposmod(toTime, end);
    if (fromTime > toTime) {
      const animEnd = end + CMP_EPSILON;
      const animStart = start - CMP_EPSILON;
      if (!isBackward) {
        range(fromTime, animEnd, false);
        range(animStart, toTime, false);
      } else {
        range(animStart, toTime, true);
        range(fromTime, animEnd, true);
      }
      return indices;
    }
    if (loopedFlag !== LOOPED_FLAG_NONE) {
      if (!isBackward && isEqualApprox(fromTime, start)) {
        const edge = track_find_key(self, track, start, FIND_MODE_EXACT);
        if (edge >= 0) indices.push(edge);
      } else if (isBackward && isEqualApprox(toTime, end)) {
        const edge = track_find_key(self, track, end, FIND_MODE_EXACT);
        if (edge >= 0) indices.push(edge);
      }
    }
  } else {
    throw new Error('godot-compat: ping-pong key ranges are not transcribed.');
  }
  range(fromTime, toTime, isBackward);
  return indices;
}

/** `Animation::_track_get_key_indices_in_range` (`animation.cpp:2763`). */
function rangeIndices(keys: readonly AnimationKey[], fromTime: number, toTime: number, backward: boolean, out: number[]): void {
  const len = keys.length;
  if (len === 0) return;
  let from = 0;
  let to = len - 1;
  const at = (i: number) => (keys[i] as AnimationKey).time;
  if (!backward) {
    while (at(from) < fromTime || isEqualApprox(at(from), fromTime)) {
      from += 1;
      if (to < from) return;
    }
    while (at(to) > toTime && !isEqualApprox(at(to), toTime)) {
      to -= 1;
      if (to < from) return;
    }
  } else {
    while (at(from) < fromTime && !isEqualApprox(at(from), fromTime)) {
      from += 1;
      if (to < from) return;
    }
    while (at(to) > toTime || isEqualApprox(at(to), toTime)) {
      to -= 1;
      if (to < from) return;
    }
  }
  if (!backward) for (let i = from; i <= to; i += 1) out.push(i);
  else for (let i = to; i >= from; i -= 1) out.push(i);
}

// --- The `changed` signal and the resource as its file states it.

const CHANGED = new WeakMap<Animation, Set<() => void>>();

/** `Resource::emit_changed`, which every mutator below calls as Godot's does. */
function emitChanged(self: Animation): void {
  for (const listener of [...(CHANGED.get(self) ?? [])]) listener();
}

/**
 * Listens for the animation's `changed` signal (an AnimationLibrary relays it to its mixers).
 *
 * @godot Animation (protocol)
 * @source core/io/resource.cpp:217
 */
export function godot_animation_connect_changed(self: Animation, listener: () => void): () => void {
  let listeners = CHANGED.get(self);
  if (listeners === undefined) {
    listeners = new Set();
    CHANGED.set(self, listeners);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether a value track captures (`UPDATE_CAPTURE`, `animation.cpp:163`); capture playback is not
 * transcribed.
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:163
 */
export function godot_animation_capture_included(self: Animation): boolean {
  return self.tracks.some((t) => t.type === TYPE_VALUE && t.update_mode === UPDATE_CAPTURE);
}

/** A key's value as a data file writes it: a number, a bool, a `Vector3`/`Quaternion`, or a method call. */
export type GodotAnimationKeyData =
  | number
  | boolean
  | { readonly Vector3: readonly [number, number, number] }
  | { readonly Quaternion: readonly [number, number, number, number] }
  | { readonly method: string; readonly args: readonly unknown[] };

/** An animation as the translation's data file writes it (`data/scene-families.ts`). */
export interface GodotAnimationData {
  readonly length: number;
  readonly loopMode: number;
  readonly step: number;
  readonly tracks: readonly {
    readonly type: 'value' | 'position_3d' | 'rotation_3d' | 'scale_3d' | 'method';
    readonly path: string;
    readonly interp: number;
    readonly loopWrap: boolean;
    readonly enabled: boolean;
    readonly imported: boolean;
    readonly update: number;
    /** Time, transition and value per key, in the order the file writes them. */
    readonly keys: readonly (readonly [number, number, GodotAnimationKeyData])[];
  }[];
}

const TRACK_TYPE = { value: TYPE_VALUE, position_3d: TYPE_POSITION_3D, rotation_3d: TYPE_ROTATION_3D, scale_3d: TYPE_SCALE_3D, method: TYPE_METHOD } as const;

function keyValue(value: GodotAnimationKeyData): unknown {
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if ('Vector3' in value) return vector3(...value.Vector3);
  if ('Quaternion' in value) return quaternion(...value.Quaternion);
  return { method: value.method, args: [...value.args] };
}

/**
 * An animation as its file states it (`Animation::_set`, `animation.cpp:59`): `length`,
 * `loop_mode`, `step`, then each track's type, path, interpolation, loop wrap, imported and enabled
 * flags and keys. A value track's keys are set as written, their times and transitions `real_t`
 * (`:252`), unsorted; a 3D track's are its packed `real_t`s; a method track's are inserted in time
 * order, then given the written transitions by index (`:313`).
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.cpp:59
 */
export function godot_animation_from_data(data: GodotAnimationData): Animation {
  const self = construct();
  self.length = Math.max(data.length, 0.001);
  self.loop_mode = data.loopMode;
  self.step = f32(data.step);
  for (const track of data.tracks) {
    const keys: AnimationKey[] = [];
    if (track.type === 'method') {
      // Inserted as `track_insert_key` does, then each transition set by index (`:329`).
      for (const [time, , value] of track.keys) insert(keys, { time: f32(time), transition: 1, value: keyValue(value) });
      track.keys.forEach(([, transition], index) => {
        const key = keys[index];
        if (key !== undefined) key.transition = f32(transition);
      });
    } else {
      for (const [time, transition, value] of track.keys) keys.push({ time: f32(time), transition: f32(transition), value: keyValue(value) });
    }
    self.tracks.push({
      type: TRACK_TYPE[track.type],
      path: track.path,
      interpolation: track.interp,
      loop_wrap: track.loopWrap,
      imported: track.imported,
      enabled: track.enabled,
      update_mode: track.update,
      keys,
    });
  }
  return self;
}

// --- ClassDB members.

/**
 * An empty animation one second long, not looping, stepping by `1 / 30` (`animation.h:291`).
 *
 * @godot Animation (protocol)
 * @source scene/resources/animation.h:291
 */
export function construct(): Animation {
  return { length: 1, loop_mode: LOOP_NONE, step: f32(1 / 30), tracks: [] };
}

/**
 * @godot Animation.add_track
 * @source scene/resources/animation.cpp:896
 */
export function add_track(self: Animation, type: number, at_position = -1): number {
  if (!SUPPORTED_TYPES.has(type)) throw new Error(`godot-compat: Animation track type ${type} is not transcribed.`);
  const at = at_position < 0 || at_position >= self.tracks.length ? self.tracks.length : at_position;
  self.tracks.splice(at, 0, { type, path: '', interpolation: INTERPOLATION_LINEAR, loop_wrap: true, imported: false, enabled: true, update_mode: 0, keys: [] });
  emitChanged(self);
  return at;
}

/**
 * @godot Animation.get_track_count
 * @source scene/resources/animation.cpp:1025
 */
export function get_track_count(self: Animation): number {
  return self.tracks.length;
}

/**
 * @godot Animation.track_get_type
 * @source scene/resources/animation.cpp:1029
 */
export function track_get_type(self: Animation, track: number): number {
  return trackAt(self, track)?.type ?? TYPE_VALUE;
}

/**
 * The path as its text (`NodePath`'s string).
 *
 * @godot Animation.track_set_path
 * @source scene/resources/animation.cpp:1034
 */
export function track_set_path(self: Animation, track: number, path: string): void {
  const t = trackAt(self, track);
  if (t === undefined) return;
  t.path = String(path);
  emitChanged(self);
}

/**
 * @godot Animation.track_get_path
 * @source scene/resources/animation.cpp:1041
 */
export function track_get_path(self: Animation, track: number): string {
  return trackAt(self, track)?.path ?? '';
}

/**
 * The first track of the type at the path, or -1.
 *
 * @godot Animation.find_track
 * @source scene/resources/animation.cpp:1046
 */
export function find_track(self: Animation, path: string, type: number): number {
  return self.tracks.findIndex((t) => t.path === String(path) && t.type === type);
}

/**
 * @godot Animation.track_set_interpolation_type
 * @source scene/resources/animation.cpp:1070
 */
export function track_set_interpolation_type(self: Animation, track: number, interpolation: number): void {
  const t = trackAt(self, track);
  if (t === undefined) return;
  t.interpolation = interpolation;
  emitChanged(self);
}

/**
 * @godot Animation.track_get_interpolation_type
 * @source scene/resources/animation.cpp:1076
 */
export function track_get_interpolation_type(self: Animation, track: number): number {
  return trackAt(self, track)?.interpolation ?? INTERPOLATION_NEAREST;
}

/**
 * @godot Animation.track_set_interpolation_loop_wrap
 * @source scene/resources/animation.cpp:1081
 */
export function track_set_interpolation_loop_wrap(self: Animation, track: number, interpolation: boolean): void {
  const t = trackAt(self, track);
  if (t === undefined) return;
  t.loop_wrap = interpolation;
  emitChanged(self);
}

/**
 * @godot Animation.track_get_interpolation_loop_wrap
 * @source scene/resources/animation.cpp:1087
 */
export function track_get_interpolation_loop_wrap(self: Animation, track: number): boolean {
  return trackAt(self, track)?.loop_wrap ?? false;
}

/**
 * @godot Animation.value_track_set_update_mode
 * @source scene/resources/animation.cpp:2740
 */
export function value_track_set_update_mode(self: Animation, track: number, mode: number): void {
  const t = trackAt(self, track);
  if (t === undefined || t.type !== TYPE_VALUE) return;
  t.update_mode = mode;
  emitChanged(self);
}

/**
 * @godot Animation.value_track_get_update_mode
 * @source scene/resources/animation.cpp:2753
 */
export function value_track_get_update_mode(self: Animation, track: number): number {
  const t = trackAt(self, track);
  return t !== undefined && t.type === TYPE_VALUE ? t.update_mode : 0;
}

/**
 * @godot Animation.track_set_enabled
 * @source scene/resources/animation.cpp:3874
 */
export function track_set_enabled(self: Animation, track: number, enabled: boolean): void {
  const t = trackAt(self, track);
  if (t === undefined) return;
  t.enabled = enabled;
  emitChanged(self);
}

/**
 * @godot Animation.track_is_enabled
 * @source scene/resources/animation.cpp:3880
 */
export function track_is_enabled(self: Animation, track: number): boolean {
  return trackAt(self, track)?.enabled ?? false;
}

/**
 * @godot Animation.track_set_imported
 * @source scene/resources/animation.cpp:3864
 */
export function track_set_imported(self: Animation, track: number, imported: boolean): void {
  const t = trackAt(self, track);
  if (t !== undefined) t.imported = imported;
}

/**
 * @godot Animation.track_is_imported
 * @source scene/resources/animation.cpp:3869
 */
export function track_is_imported(self: Animation, track: number): boolean {
  return trackAt(self, track)?.imported ?? false;
}

/**
 * A key at `time` (`double`) with the transition (`real_t`); a value or method key replacing one
 * keeps the replaced key's transition, a 3D key (a Vector3 or a Quaternion) then takes the given
 * one; a method key is a Dictionary of `method` and `args`, stored as `{ method, args }`.
 *
 * @godot Animation.track_insert_key
 * @source scene/resources/animation.cpp:1719
 */
export function track_insert_key(self: Animation, track: number, time: number, key: unknown, transition = 1): number {
  const t = trackAt(self, track);
  if (t === undefined) return -1;
  if (t.type === TYPE_METHOD) {
    const d = key as ReadonlyMap<unknown, unknown>;
    if (!(d instanceof Map) || typeof d.get('method') !== 'string' || !Array.isArray(d.get('args'))) return -1;
    const at = insert(t.keys, { time, transition: f32(transition), value: { method: d.get('method') as string, args: d.get('args') as unknown[] } });
    emitChanged(self);
    return at;
  }
  if (t.type === TYPE_VALUE) {
    const at = insert(t.keys, { time, transition: f32(transition), value: key });
    emitChanged(self);
    return at;
  }
  const wanted = t.type === TYPE_ROTATION_3D ? 'Quaternion' : 'Vector3';
  if (kindOf(key) !== wanted) return -1;
  const at = insert(t.keys, { time, transition: 1, value: key });
  (t.keys[at] as AnimationKey).transition = f32(transition);
  emitChanged(self);
  return at;
}

/**
 * @godot Animation.track_get_key_count
 * @source scene/resources/animation.cpp:1836
 */
export function track_get_key_count(self: Animation, track: number): number {
  return trackAt(self, track)?.keys.length ?? -1;
}

/**
 * @godot Animation.track_get_key_time
 * @source scene/resources/animation.cpp:1972
 */
export function track_get_key_time(self: Animation, track: number, key_idx: number): number {
  return trackAt(self, track)?.keys[key_idx]?.time ?? -1;
}

/**
 * @godot Animation.track_get_key_transition
 * @source scene/resources/animation.cpp:2155
 */
export function track_get_key_transition(self: Animation, track: number, key_idx: number): number {
  return trackAt(self, track)?.keys[key_idx]?.transition ?? -1;
}

/**
 * A method key's value is the Dictionary `{ method, args }`.
 *
 * @godot Animation.track_get_key_value
 * @source scene/resources/animation.cpp:1895
 */
export function track_get_key_value(self: Animation, track: number, key_idx: number): unknown {
  const t = trackAt(self, track);
  const key = t?.keys[key_idx];
  if (t === undefined || key === undefined) return null;
  if (t.type === TYPE_METHOD) {
    const k = key.value as { method: string; args: unknown[] };
    return new Map<unknown, unknown>([['method', k.method], ['args', k.args]]);
  }
  return key.value;
}

/**
 * @godot Animation.track_find_key
 * @source scene/resources/animation.cpp:1541
 */
export function track_find_key(self: Animation, track: number, time: number, find_mode = 0, limit = false, backward = false): number {
  const t = trackAt(self, track);
  if (t === undefined) return -1;
  const k = find(self, t.keys, time, backward, limit);
  if (k < 0 || k >= t.keys.length) return -1;
  const at = (t.keys[k] as AnimationKey).time;
  if ((find_mode === FIND_MODE_APPROX && !isEqualApprox(at, time)) || (find_mode === FIND_MODE_EXACT && at !== time)) return -1;
  return k;
}

/**
 * A discrete track is sampled nearest (`animation.cpp:2723`).
 *
 * @godot Animation.value_track_interpolate
 * @source scene/resources/animation.cpp:2723
 */
export function value_track_interpolate(self: Animation, track: number, time: number, backward = false): unknown {
  const t = trackAt(self, track);
  if (t === undefined || t.type !== TYPE_VALUE) return null;
  const result = interpolate(self, t, time, t.update_mode === UPDATE_DISCRETE ? INTERPOLATION_NEAREST : t.interpolation, backward);
  return result.ok ? result.value : null;
}

/**
 * `(0, 0, 0)` when unavailable.
 *
 * @godot Animation.position_track_interpolate
 * @source scene/resources/animation.cpp:1209
 */
export function position_track_interpolate(self: Animation, track: number, time: number, backward = false): Vector3 {
  const t = trackAt(self, track);
  if (t === undefined || t.type !== TYPE_POSITION_3D) return vector3();
  return (godot_animation_try_interpolate(self, track, time, backward) as Vector3 | undefined) ?? vector3();
}

/**
 * The identity when unavailable.
 *
 * @godot Animation.rotation_track_interpolate
 * @source scene/resources/animation.cpp:1289
 */
export function rotation_track_interpolate(self: Animation, track: number, time: number, backward = false): Quaternion {
  const t = trackAt(self, track);
  if (t === undefined || t.type !== TYPE_ROTATION_3D) return quaternion();
  return (godot_animation_try_interpolate(self, track, time, backward) as Quaternion | undefined) ?? quaternion();
}

/**
 * `(1, 1, 1)` when unavailable.
 *
 * @godot Animation.scale_track_interpolate
 * @source scene/resources/animation.cpp:1369
 */
export function scale_track_interpolate(self: Animation, track: number, time: number, backward = false): Vector3 {
  const t = trackAt(self, track);
  if (t === undefined || t.type !== TYPE_SCALE_3D) return vector3(1, 1, 1);
  return (godot_animation_try_interpolate(self, track, time, backward) as Vector3 | undefined) ?? vector3(1, 1, 1);
}

/**
 * @godot Animation.method_track_get_name
 * @source scene/resources/animation.cpp:3315
 */
export function method_track_get_name(self: Animation, track: number, key_idx: number): string {
  const t = trackAt(self, track);
  if (t === undefined || t.type !== TYPE_METHOD) return '';
  return (t.keys[key_idx]?.value as { method: string } | undefined)?.method ?? '';
}

/**
 * @godot Animation.method_track_get_params
 * @source scene/resources/animation.cpp:3301
 */
export function method_track_get_params(self: Animation, track: number, key_idx: number): unknown[] {
  const t = trackAt(self, track);
  if (t === undefined || t.type !== TYPE_METHOD) return [];
  return [...((t.keys[key_idx]?.value as { args: unknown[] } | undefined)?.args ?? [])];
}

/**
 * The length is at least `ANIM_MIN_LENGTH` (`animation.cpp:3851`).
 *
 * @godot Animation.set_length
 * @source scene/resources/animation.cpp:3851
 */
export function set_length(self: Animation, time_sec: number): void {
  self.length = Math.max(time_sec, 0.001);
  emitChanged(self);
}

/**
 * @godot Animation.get_length
 * @source scene/resources/animation.h:291
 */
export function get_length(self: Animation): number {
  return self.length;
}

/**
 * @godot Animation.set_loop_mode
 * @source scene/resources/animation.cpp:3859
 */
export function set_loop_mode(self: Animation, loop_mode: number): void {
  self.loop_mode = loop_mode;
  emitChanged(self);
}

/**
 * @godot Animation.get_loop_mode
 * @source scene/resources/animation.h:293
 */
export function get_loop_mode(self: Animation): number {
  return self.loop_mode;
}

/**
 * @godot Animation.set_step
 * @source scene/resources/animation.cpp:3927
 */
export function set_step(self: Animation, size_sec: number): void {
  self.step = f32(size_sec);
  emitChanged(self);
}

/**
 * @godot Animation.get_step
 * @source scene/resources/animation.cpp:3932
 */
export function get_step(self: Animation): number {
  return self.step;
}
