/** Godot Animation/AnimationLibrary resource APIs over native Three AnimationClip/KeyframeTrack. */
import {
  AnimationClip,
  BooleanKeyframeTrack,
  InterpolateDiscrete,
  InterpolateLinear,
  InterpolateSmooth,
  KeyframeTrack,
  NumberKeyframeTrack,
  QuaternionKeyframeTrack,
  StringKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { registerGodotObjectIdentity } from './object';
import { packedInt32Array, packedStringArray, type PackedArrayValue } from './packed-array';

export const GODOT_ANIMATION_TRACK = {
  VALUE: 0,
  POSITION_3D: 1,
  ROTATION_3D: 2,
  SCALE_3D: 3,
  BLEND_SHAPE: 4,
  METHOD: 5,
  BEZIER: 6,
  AUDIO: 7,
  ANIMATION: 8,
} as const;

export const GODOT3_ANIMATION_TRACK = {
  VALUE: 0,
  TRANSFORM: 1,
  METHOD: 2,
  BEZIER: 3,
  AUDIO: 4,
  ANIMATION: 5,
} as const;

export const GODOT_ANIMATION_INTERPOLATION = {
  NEAREST: 0,
  LINEAR: 1,
  CUBIC: 2,
  LINEAR_ANGLE: 3,
  CUBIC_ANGLE: 4,
} as const;

interface AnimationTrackState {
  type: number;
  path: string;
  enabled: boolean;
  imported: boolean;
  interpolation: number;
  loopWrap: boolean;
  updateMode: number;
  keys: Array<{ time: number; value: unknown; transition: number }>;
  bezierHandles: Array<{ inHandle: readonly [number, number]; outHandle: readonly [number, number]; mode: number }>;
  native?: readonly KeyframeTrack[];
}

interface AnimationState {
  readonly major: 3 | 4;
  readonly tracks: AnimationTrackState[];
  loopMode: number;
  step: number;
}

const ANIMATIONS = new WeakMap<AnimationClip, AnimationState>();

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`godot-compat: Animation.${member} must be finite`);
  }
  return value;
}

function integer(value: unknown, member: string): number {
  const result = finite(value, member);
  if (!Number.isInteger(result)) throw new TypeError(`godot-compat: Animation.${member} must be an integer`);
  return result;
}

function name(value: unknown, member: string): string {
  if (typeof value !== 'string') throw new TypeError(`godot-compat: ${member} must be StringName/NodePath-compatible`);
  return value;
}

function copyVariant(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyVariant);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copyVariant(child)]));
  }
  return value;
}

function trackValue(state: AnimationState, track: AnimationTrackState, value: unknown): unknown {
  if (state.major === 4 && (track.type === GODOT_ANIMATION_TRACK.POSITION_3D ||
    track.type === GODOT_ANIMATION_TRACK.SCALE_3D)) {
    if (typeof value !== 'object' || value === null) throw new TypeError('godot-compat: Animation Vector3 track requires Vector3');
    return [
      finite(Reflect.get(value, 'x'), 'track value.x'),
      finite(Reflect.get(value, 'y'), 'track value.y'),
      finite(Reflect.get(value, 'z'), 'track value.z'),
    ];
  }
  if (state.major === 4 && track.type === GODOT_ANIMATION_TRACK.ROTATION_3D) {
    if (typeof value !== 'object' || value === null) throw new TypeError('godot-compat: Animation rotation track requires Quaternion');
    return [
      finite(Reflect.get(value, 'x'), 'track value.x'),
      finite(Reflect.get(value, 'y'), 'track value.y'),
      finite(Reflect.get(value, 'z'), 'track value.z'),
      finite(Reflect.get(value, 'w'), 'track value.w'),
    ];
  }
  if (state.major === 3 && track.type === GODOT3_ANIMATION_TRACK.TRANSFORM) {
    throw new Error('godot-compat: mutating a compound Godot 3 Transform animation key is unsupported by split native Three tracks.');
  }
  return copyVariant(value);
}

function exposedTrackValue(state: AnimationState, track: AnimationTrackState, value: unknown): unknown {
  if (state.major === 4 && Array.isArray(value)) {
    if (track.type === GODOT_ANIMATION_TRACK.ROTATION_3D) {
      return { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0, w: value[3] ?? 1 };
    }
    if (track.type === GODOT_ANIMATION_TRACK.POSITION_3D || track.type === GODOT_ANIMATION_TRACK.SCALE_3D) {
      return { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0 };
    }
  }
  return copyVariant(value);
}

function method(target: object, member: string, value: (...args: unknown[]) => unknown): void {
  Object.defineProperty(target, member, { configurable: true, enumerable: false, value });
}

function property(target: object, member: string, get: () => unknown, set: (value: unknown) => void): void {
  Object.defineProperty(target, member, { configurable: true, enumerable: false, get, set });
}

function trackAt(state: AnimationState, value: unknown, member: string): AnimationTrackState {
  const index = integer(value, member);
  const track = state.tracks[index];
  if (track === undefined) throw new RangeError(`godot-compat: Animation.${member} track ${index} is out of range`);
  return track;
}

function keyAt(track: AnimationTrackState, value: unknown, member: string): number {
  const index = integer(value, member);
  if (index < 0 || index >= track.keys.length) {
    throw new RangeError(`godot-compat: Animation.${member} key ${index} is out of range`);
  }
  return index;
}

function unpackNativeTrack(track: KeyframeTrack, type: number): AnimationTrackState {
  const valueSize = track.getValueSize();
  const keys = Array.from(track.times, (time, index) => {
    const values = Array.from(track.values.slice(index * valueSize, (index + 1) * valueSize));
    return {
      time,
      value: valueSize === 1 ? values[0] : values,
      transition: 1,
    };
  });
  return {
    type,
    path: track.name,
    enabled: true,
    imported: false,
    interpolation: track.getInterpolation() === InterpolateDiscrete
      ? GODOT_ANIMATION_INTERPOLATION.NEAREST
      : track.getInterpolation() === InterpolateSmooth
        ? GODOT_ANIMATION_INTERPOLATION.CUBIC
        : GODOT_ANIMATION_INTERPOLATION.LINEAR,
    loopWrap: true,
    updateMode: 0,
    keys,
    bezierHandles: keys.map(() => ({ inHandle: [-0.25, 0], outHandle: [0.25, 0], mode: 0 })),
    native: [track],
  };
}

function nativeTracks(track: AnimationTrackState): readonly KeyframeTrack[] {
  return track.native ?? [];
}

function sampleNativeTrack(track: KeyframeTrack, time: number): ArrayLike<number> {
  const result = new Float32Array(track.getValueSize());
  const interpolation = track.getInterpolation();
  const interpolant = interpolation === InterpolateDiscrete
    ? track.InterpolantFactoryMethodDiscrete(result)
    : interpolation === InterpolateSmooth
      ? track.InterpolantFactoryMethodSmooth(result)
      : track.InterpolantFactoryMethodLinear(result);
  return interpolant.evaluate(time);
}

function numericVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((component) => typeof component === 'number');
}

function enabledNativeTracks(state: AnimationState): KeyframeTrack[] {
  return state.tracks.flatMap((track) => track.enabled ? nativeTracks(track) : []);
}

function unpackGodot3Tracks(tracks: readonly KeyframeTrack[]): AnimationTrackState[] {
  const result: AnimationTrackState[] = [];
  const transformGroups = new Map<string, KeyframeTrack[]>();
  for (const track of tracks) {
    const match = /^(.*)\.(position|quaternion|scale)$/.exec(track.name);
    if (match?.[1] === undefined) {
      result.push(unpackNativeTrack(track, GODOT3_ANIMATION_TRACK.VALUE));
      continue;
    }
    const group = transformGroups.get(match[1]) ?? [];
    group.push(track);
    transformGroups.set(match[1], group);
  }
  for (const [path, group] of transformGroups) {
    const times = [...new Set(group.flatMap((track) => Array.from(track.times)))].sort((a, b) => a - b);
    const component = (suffix: string, time: number, fallback: readonly number[]): readonly number[] => {
      const track = group.find((candidate) => candidate.name.endsWith(`.${suffix}`));
      if (track === undefined) return fallback;
      const valueSize = track.getValueSize();
      let index = Array.from(track.times).findIndex((candidate) => Math.abs(candidate - time) <= 0.00001);
      if (index < 0) {
        index = 0;
        for (let candidate = track.times.length - 1; candidate >= 0; candidate -= 1) {
          if (track.times[candidate]! <= time) {
            index = candidate;
            break;
          }
        }
      }
      return Array.from(track.values.slice(index * valueSize, (index + 1) * valueSize));
    };
    result.push({
      type: GODOT3_ANIMATION_TRACK.TRANSFORM,
      path,
      enabled: true,
      imported: false,
      interpolation: GODOT_ANIMATION_INTERPOLATION.LINEAR,
      loopWrap: true,
      updateMode: 0,
      keys: times.map((time) => ({
        time,
        value: {
          origin: component('position', time, [0, 0, 0]),
          rotation: component('quaternion', time, [0, 0, 0, 1]),
          scale: component('scale', time, [1, 1, 1]),
        },
        transition: 1,
      })),
      bezierHandles: times.map(() => ({ inHandle: [-0.25, 0], outHandle: [0.25, 0], mode: 0 })),
      native: group,
    });
  }
  return result;
}

function inferredType(track: KeyframeTrack, major: 3 | 4): number {
  if (major === 3 && (track instanceof QuaternionKeyframeTrack || track instanceof VectorKeyframeTrack)) {
    return GODOT3_ANIMATION_TRACK.TRANSFORM;
  }
  if (track instanceof QuaternionKeyframeTrack) return GODOT_ANIMATION_TRACK.ROTATION_3D;
  if (track instanceof VectorKeyframeTrack) {
    return track.name.endsWith('.scale') ? GODOT_ANIMATION_TRACK.SCALE_3D : GODOT_ANIMATION_TRACK.POSITION_3D;
  }
  return GODOT_ANIMATION_TRACK.VALUE;
}

type FlattenedTrackValues =
  | { readonly kind: 'number'; readonly values: number[]; readonly valueSize: number }
  | { readonly kind: 'string'; readonly values: string[]; readonly valueSize: 1 }
  | { readonly kind: 'boolean'; readonly values: boolean[]; readonly valueSize: 1 };

function flattened(values: readonly unknown[]): FlattenedTrackValues {
  const first = values[0];
  if (Array.isArray(first)) {
    const valueSize = first.length;
    const result: number[] = [];
    for (const value of values) {
      if (!Array.isArray(value) || value.length !== valueSize) {
        throw new TypeError('godot-compat: Animation track values must keep one numeric vector width');
      }
      for (const component of value) {
        if (typeof component !== 'number') {
          throw new TypeError('godot-compat: Animation track values must keep one numeric vector width');
        }
        result.push(component);
      }
    }
    return { kind: 'number', values: result, valueSize };
  }
  const numbers: number[] = [];
  const strings: string[] = [];
  const booleans: boolean[] = [];
  for (const value of values) {
    if (typeof value === 'number') numbers.push(value);
    else if (typeof value === 'string') strings.push(value);
    else if (typeof value === 'boolean') booleans.push(value);
    else throw new TypeError('godot-compat: Animation track contains values with incompatible native types');
  }
  if (numbers.length === values.length) return { kind: 'number', values: numbers, valueSize: 1 };
  if (strings.length === values.length) return { kind: 'string', values: strings, valueSize: 1 };
  if (booleans.length === values.length) return { kind: 'boolean', values: booleans, valueSize: 1 };
  throw new TypeError('godot-compat: Animation track contains values with incompatible native types');
}

function rebuildNative(clip: AnimationClip, state: AnimationState, track: AnimationTrackState): void {
  const metadataOnly = state.major === 3
    ? track.type === GODOT3_ANIMATION_TRACK.METHOD || track.type === GODOT3_ANIMATION_TRACK.AUDIO ||
      track.type === GODOT3_ANIMATION_TRACK.ANIMATION || track.type === GODOT3_ANIMATION_TRACK.BEZIER
    : track.type === GODOT_ANIMATION_TRACK.METHOD || track.type === GODOT_ANIMATION_TRACK.AUDIO ||
      track.type === GODOT_ANIMATION_TRACK.ANIMATION || track.type === GODOT_ANIMATION_TRACK.BEZIER;
  if (metadataOnly || track.keys.length === 0) {
    delete track.native;
    clip.tracks = enabledNativeTracks(state);
    return;
  }
  if (state.major === 3 && track.type === GODOT3_ANIMATION_TRACK.TRANSFORM) {
    throw new Error(
      'godot-compat: Godot 3 Animation TYPE_TRANSFORM mutation stores one Transform key with ' +
        'position, quaternion and scale; a single Three KeyframeTrack cannot preserve that compound value.',
    );
  }
  const times = track.keys.map((key) => key.time);
  const sourceValues = track.keys.map((key) => key.value);
  const data = flattened(sourceValues);
  let native: KeyframeTrack;
  if (track.type === GODOT_ANIMATION_TRACK.ROTATION_3D) {
    if (data.kind !== 'number' || data.valueSize !== 4) throw new TypeError('godot-compat: rotation track values must be Quaternion-like arrays');
    native = new QuaternionKeyframeTrack(track.path, times, data.values);
  } else if (track.type === GODOT_ANIMATION_TRACK.POSITION_3D || track.type === GODOT_ANIMATION_TRACK.SCALE_3D) {
    if (data.kind !== 'number' || data.valueSize !== 3) throw new TypeError('godot-compat: position/scale track values must be Vector3-like arrays');
    native = new VectorKeyframeTrack(track.path, times, data.values);
  } else if (data.kind === 'boolean') {
    native = new BooleanKeyframeTrack(track.path, times, data.values);
  } else if (data.kind === 'string') {
    native = new StringKeyframeTrack(track.path, times, data.values);
  } else if (data.valueSize === 1) {
    native = new NumberKeyframeTrack(track.path, times, data.values);
  } else {
    native = new VectorKeyframeTrack(track.path, times, data.values);
  }
  native.setInterpolation(track.interpolation === GODOT_ANIMATION_INTERPOLATION.NEAREST
    ? InterpolateDiscrete
    : track.interpolation === GODOT_ANIMATION_INTERPOLATION.LINEAR
      ? InterpolateLinear
      : InterpolateSmooth);
  track.native = [native];
  clip.tracks = enabledNativeTracks(state);
}

function bindAnimationMethods(clip: AnimationClip, state: AnimationState): void {
  registerGodotObjectIdentity(clip, 'Animation');
  property(clip, 'length', () => clip.duration, (value) => { clip.duration = Math.max(0, finite(value, 'length')); });
  property(clip, 'step', () => state.step, (value) => { state.step = Math.max(0, finite(value, 'step')); });
  const setLoopMode = (value: unknown): void => {
    const mode = integer(value, 'loop_mode');
    if (mode < 0 || mode > 2) throw new RangeError('godot-compat: Animation.loop_mode must be 0..2');
    state.loopMode = mode;
  };
  property(clip, 'loop_mode', () => state.loopMode, setLoopMode);
  property(clip, 'loop', () => state.loopMode !== 0, (value) => {
    if (typeof value !== 'boolean') throw new TypeError('godot-compat: Animation.loop requires bool');
    state.loopMode = value ? 1 : 0;
  });
  method(clip, 'set_length', (value) => { clip.duration = Math.max(0, finite(value, 'length')); });
  method(clip, 'get_length', () => clip.duration);
  method(clip, 'set_step', (value) => { state.step = Math.max(0, finite(value, 'step')); });
  method(clip, 'get_step', () => state.step);
  method(clip, 'set_loop_mode', setLoopMode);
  method(clip, 'get_loop_mode', () => state.loopMode);
  method(clip, 'set_loop', (value) => {
    if (typeof value !== 'boolean') throw new TypeError('godot-compat: Animation.loop requires bool');
    state.loopMode = value ? 1 : 0;
  });
  method(clip, 'has_loop', () => state.loopMode !== 0);
  method(clip, 'add_track', (typeValue, atPosition = -1) => {
    const type = integer(typeValue, 'add_track type');
    const maximum = state.major === 3 ? GODOT3_ANIMATION_TRACK.ANIMATION : GODOT_ANIMATION_TRACK.ANIMATION;
    if (type < 0 || type > maximum) throw new RangeError(`godot-compat: Animation track type must be 0..${maximum}`);
    const requested = integer(atPosition, 'add_track at_position');
    const at = requested < 0 || requested > state.tracks.length ? state.tracks.length : requested;
    state.tracks.splice(at, 0, {
      type, path: '', enabled: true, imported: false, interpolation: 1, loopWrap: true,
      updateMode: 0, keys: [], bezierHandles: [],
    });
    return at;
  });
  method(clip, 'remove_track', (index) => {
    const track = trackAt(state, index, 'remove_track');
    const at = state.tracks.indexOf(track);
    state.tracks.splice(at, 1);
    clip.tracks = enabledNativeTracks(state);
  });
  method(clip, 'get_track_count', () => state.tracks.length);
  method(clip, 'clear', () => {
    state.tracks.length = 0;
    clip.tracks = [];
  });
  method(clip, 'track_move_up', (index) => {
    const track = trackAt(state, index, 'track_move_up');
    const at = state.tracks.indexOf(track);
    if (at <= 0) return;
    state.tracks.splice(at, 1);
    state.tracks.splice(at - 1, 0, track);
  });
  method(clip, 'track_move_down', (index) => {
    const track = trackAt(state, index, 'track_move_down');
    const at = state.tracks.indexOf(track);
    if (at < 0 || at + 1 >= state.tracks.length) return;
    state.tracks.splice(at, 1);
    state.tracks.splice(at + 1, 0, track);
  });
  method(clip, 'track_swap', (firstValue, secondValue) => {
    const first = trackAt(state, firstValue, 'track_swap');
    const second = trackAt(state, secondValue, 'track_swap');
    const firstIndex = state.tracks.indexOf(first);
    const secondIndex = state.tracks.indexOf(second);
    state.tracks[firstIndex] = second;
    state.tracks[secondIndex] = first;
  });
  method(clip, 'track_get_type', (index) => trackAt(state, index, 'track_get_type').type);
  method(clip, 'track_set_path', (index, path) => {
    const track = trackAt(state, index, 'track_set_path');
    track.path = name(path, 'Animation.track_set_path');
    if (state.major === 3 && track.type === GODOT3_ANIMATION_TRACK.TRANSFORM) {
      for (const native of nativeTracks(track)) {
        const suffix = native.name.slice(native.name.lastIndexOf('.'));
        native.name = `${track.path}${suffix}`;
      }
    } else if (track.keys.length > 0) rebuildNative(clip, state, track);
  });
  method(clip, 'track_get_path', (index) => trackAt(state, index, 'track_get_path').path);
  method(clip, 'find_track', (path, type = -1) => {
    const sought = name(path, 'Animation.find_track path');
    const soughtType = integer(type, 'find_track type');
    return state.tracks.findIndex((track) => track.path === sought && (soughtType < 0 || track.type === soughtType));
  });
  method(clip, 'track_set_enabled', (index, enabled) => {
    if (typeof enabled !== 'boolean') throw new TypeError('godot-compat: Animation.track_set_enabled requires bool');
    const track = trackAt(state, index, 'track_set_enabled');
    track.enabled = enabled;
    clip.tracks = enabledNativeTracks(state);
  });
  method(clip, 'track_is_enabled', (index) => trackAt(state, index, 'track_is_enabled').enabled);
  method(clip, 'track_set_imported', (index, imported) => {
    if (typeof imported !== 'boolean') throw new TypeError('godot-compat: Animation.track_set_imported requires bool');
    trackAt(state, index, 'track_set_imported').imported = imported;
  });
  method(clip, 'track_is_imported', (index) => trackAt(state, index, 'track_is_imported').imported);
  method(clip, 'track_set_interpolation_type', (index, interpolation) => {
    const track = trackAt(state, index, 'track_set_interpolation_type');
    const value = integer(interpolation, 'track_set_interpolation_type');
    const maximum = state.major === 3 ? 2 : 4;
    if (value < 0 || value > maximum) throw new RangeError(`godot-compat: interpolation type must be 0..${maximum}`);
    if (value === 3 || value === 4) {
      throw new Error('godot-compat: Animation angular interpolation needs Godot angle wrapping unavailable in Three KeyframeTrack.');
    }
    track.interpolation = value;
    if (state.major === 3 && track.type === GODOT3_ANIMATION_TRACK.TRANSFORM) {
      const nativeInterpolation = value === 0 ? InterpolateDiscrete : value === 1 ? InterpolateLinear : InterpolateSmooth;
      for (const native of nativeTracks(track)) native.setInterpolation(nativeInterpolation);
    } else if (track.keys.length > 0) rebuildNative(clip, state, track);
  });
  method(clip, 'track_get_interpolation_type', (index) => trackAt(state, index, 'track_get_interpolation_type').interpolation);
  method(clip, 'track_set_interpolation_loop_wrap', (index, enabled) => {
    if (typeof enabled !== 'boolean') throw new TypeError('godot-compat: loop_wrap requires bool');
    trackAt(state, index, 'track_set_interpolation_loop_wrap').loopWrap = enabled;
  });
  method(clip, 'track_get_interpolation_loop_wrap', (index) => trackAt(state, index, 'track_get_interpolation_loop_wrap').loopWrap);
  method(clip, 'track_get_key_count', (index) => trackAt(state, index, 'track_get_key_count').keys.length);
  method(clip, 'track_get_key_time', (index, key) => {
    const track = trackAt(state, index, 'track_get_key_time');
    return track.keys[keyAt(track, key, 'track_get_key_time')]!.time;
  });
  method(clip, 'track_get_key_value', (index, key) => {
    const track = trackAt(state, index, 'track_get_key_value');
    const value = track.keys[keyAt(track, key, 'track_get_key_value')]!.value;
    return exposedTrackValue(state, track, value);
  });
  method(clip, 'track_set_key_value', (index, key, value) => {
    const track = trackAt(state, index, 'track_set_key_value');
    track.keys[keyAt(track, key, 'track_set_key_value')]!.value = trackValue(state, track, value);
    rebuildNative(clip, state, track);
  });
  method(clip, 'track_get_key_transition', (index, key) => {
    const track = trackAt(state, index, 'track_get_key_transition');
    return track.keys[keyAt(track, key, 'track_get_key_transition')]!.transition;
  });
  method(clip, 'track_set_key_transition', (index, key, transition) => {
    const track = trackAt(state, index, 'track_set_key_transition');
    const value = finite(transition, 'track_set_key_transition');
    if (value !== 1) {
      throw new Error('godot-compat: per-key Animation transition easing has no exact Three KeyframeTrack representation');
    }
    track.keys[keyAt(track, key, 'track_set_key_transition')]!.transition = value;
  });
  method(clip, 'track_insert_key', (index, time, value, transition = 1) => {
    const track = trackAt(state, index, 'track_insert_key');
    const atTime = finite(time, 'track_insert_key time');
    const existing = track.keys.findIndex((key) => Math.abs(key.time - atTime) <= 0.00001);
    const transitionValue = finite(transition, 'track_insert_key transition');
    if (transitionValue !== 1) {
      throw new Error('godot-compat: per-key Animation transition easing has no exact Three KeyframeTrack representation');
    }
    const next = { time: atTime, value: trackValue(state, track, value), transition: transitionValue };
    if (existing >= 0) track.keys[existing] = next;
    else track.keys.splice(track.keys.findIndex((key) => key.time > atTime) >>> 0, 0, next);
    track.keys.sort((a, b) => a.time - b.time);
    rebuildNative(clip, state, track);
    return track.keys.indexOf(next);
  });
  method(clip, 'track_remove_key', (index, key) => {
    const track = trackAt(state, index, 'track_remove_key');
    track.keys.splice(keyAt(track, key, 'track_remove_key'), 1);
    rebuildNative(clip, state, track);
  });
  method(clip, 'track_remove_key_at_time', (index, time) => {
    const track = trackAt(state, index, 'track_remove_key_at_time');
    const at = track.keys.findIndex((key) => Math.abs(key.time - finite(time, 'track_remove_key_at_time')) <= 0.00001);
    if (at >= 0) { track.keys.splice(at, 1); rebuildNative(clip, state, track); }
  });
  method(clip, 'track_set_key_time', (index, key, time) => {
    const track = trackAt(state, index, 'track_set_key_time');
    const at = keyAt(track, key, 'track_set_key_time');
    track.keys[at]!.time = finite(time, 'track_set_key_time time');
    track.keys.sort((a, b) => a.time - b.time);
    rebuildNative(clip, state, track);
  });
  method(clip, 'track_get_key_duration', (index, key) => {
    const track = trackAt(state, index, 'track_get_key_duration');
    keyAt(track, key, 'track_get_key_duration');
    if (track.type !== (state.major === 3 ? GODOT3_ANIMATION_TRACK.AUDIO : GODOT_ANIMATION_TRACK.AUDIO)) return 0;
    throw new Error('godot-compat: audio track key duration requires a decoded AudioStream resource.');
  });
  method(clip, 'track_is_compressed', () => false);
  method(clip, 'track_find_key', (index, time, findMode = 0, limit = false, backward = false) => {
    const track = trackAt(state, index, 'track_find_key');
    const atTime = finite(time, 'track_find_key');
    if (typeof limit !== 'boolean' || typeof backward !== 'boolean') {
      throw new TypeError('godot-compat: Animation.track_find_key limit/backward must be bool');
    }
    const mode = state.major === 3
      ? (findMode === true ? 2 : findMode === false || findMode === undefined ? 0 : integer(findMode, 'track_find_key find_mode'))
      : integer(findMode, 'track_find_key find_mode');
    if (mode < 0 || mode > 2) throw new RangeError('godot-compat: Animation FindMode must be 0..2');
    if (track.keys.length === 0) return -1;
    let found = -1;
    if (backward) {
      for (let key = 0; key < track.keys.length; key += 1) {
        if (track.keys[key]!.time >= atTime) { found = key; break; }
      }
    } else {
      for (let key = track.keys.length - 1; key >= 0; key -= 1) {
        if (track.keys[key]!.time <= atTime) { found = key; break; }
      }
    }
    if (found < 0) return -1;
    const foundTime = track.keys[found]!.time;
    if (limit && (foundTime < 0 || foundTime > clip.duration)) return -1;
    if (mode === 2 && foundTime !== atTime) return -1;
    if (mode === 1) {
      const tolerance = 0.00001 * Math.max(1, Math.abs(foundTime), Math.abs(atTime));
      if (Math.abs(foundTime - atTime) > tolerance) return -1;
    }
    return found;
  });
  method(clip, 'track_get_key_indices_in_range', (index, time, delta) => {
    const track = trackAt(state, index, 'track_get_key_indices_in_range');
    const start = finite(time, 'track_get_key_indices_in_range time');
    const end = start + finite(delta, 'track_get_key_indices_in_range delta');
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const indices = track.keys.flatMap((key, keyIndex) => key.time > low && key.time <= high ? [keyIndex] : []);
    return state.major === 3 ? indices : packedInt32Array(indices);
  });
  method(clip, 'value_track_set_update_mode', (index, mode) => {
    const track = trackAt(state, index, 'value_track_set_update_mode');
    if (track.type !== GODOT_ANIMATION_TRACK.VALUE) throw new TypeError('godot-compat: value_track_set_update_mode requires a value track');
    const value = integer(mode, 'value_track_set_update_mode');
    if (value < 0 || value > 4) throw new RangeError('godot-compat: value update mode must be 0..4');
    track.updateMode = value;
  });
  method(clip, 'value_track_get_update_mode', (index) => {
    const track = trackAt(state, index, 'value_track_get_update_mode');
    if (track.type !== GODOT_ANIMATION_TRACK.VALUE) throw new TypeError('godot-compat: value_track_get_update_mode requires a value track');
    return track.updateMode;
  });
  method(clip, 'value_track_interpolate', (index, time) => {
    const track = trackAt(state, index, 'value_track_interpolate');
    const at = finite(time, 'value_track_interpolate time');
    if (track.keys.length === 0) return null;
    const native = nativeTracks(track)[0];
    if (native !== undefined && !(native instanceof BooleanKeyframeTrack) && !(native instanceof StringKeyframeTrack)) {
      const valueSize = native.getValueSize();
      const sampled = sampleNativeTrack(native, at);
      return valueSize === 1 ? sampled[0] : Array.from(sampled);
    }
    const exact = track.keys.find((key) => Math.abs(key.time - at) <= 0.00001);
    if (exact !== undefined) return Array.isArray(exact.value) ? [...exact.value] : exact.value;
    let right = track.keys.findIndex((key) => key.time > at);
    if (right < 0) right = track.keys.length - 1;
    if (right === 0 || track.interpolation === GODOT_ANIMATION_INTERPOLATION.NEAREST) {
      const value = track.keys[Math.max(0, right - (right > 0 ? 1 : 0))]!.value;
      return Array.isArray(value) ? [...value] : value;
    }
    const left = right - 1;
    const a = track.keys[left]!;
    const b = track.keys[right]!;
    const ratio = (at - a.time) / Math.max(Number.EPSILON, b.time - a.time);
    const leftValue = a.value;
    const rightValue = b.value;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') return leftValue + (rightValue - leftValue) * ratio;
    if (numericVector(leftValue) && numericVector(rightValue) && leftValue.length === rightValue.length) {
      return leftValue.map((one, component) => one + (rightValue[component]! - one) * ratio);
    }
    return leftValue;
  });
  const typedInterpolate = (index: unknown, time: unknown, expectedType: number, member: string): unknown => {
    const track = trackAt(state, index, member);
    if (state.major !== 4 || track.type !== expectedType) {
      throw new TypeError(`godot-compat: Animation.${member} requires its matching Godot 4 track type`);
    }
    const native = nativeTracks(track)[0];
    if (native === undefined) return null;
    const value = Array.from(sampleNativeTrack(native, finite(time, `${member} time`)));
    if (expectedType === GODOT_ANIMATION_TRACK.BLEND_SHAPE) return value;
    if (!Array.isArray(value)) return value;
    return expectedType === GODOT_ANIMATION_TRACK.ROTATION_3D
      ? { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0, w: value[3] ?? 1 }
      : { x: value[0] ?? 0, y: value[1] ?? 0, z: value[2] ?? 0 };
  };
  method(clip, 'position_track_interpolate', (index, time) =>
    typedInterpolate(index, time, GODOT_ANIMATION_TRACK.POSITION_3D, 'position_track_interpolate'));
  method(clip, 'rotation_track_interpolate', (index, time) =>
    typedInterpolate(index, time, GODOT_ANIMATION_TRACK.ROTATION_3D, 'rotation_track_interpolate'));
  method(clip, 'scale_track_interpolate', (index, time) =>
    typedInterpolate(index, time, GODOT_ANIMATION_TRACK.SCALE_3D, 'scale_track_interpolate'));
  method(clip, 'blend_shape_track_interpolate', (index, time) =>
    typedInterpolate(index, time, GODOT_ANIMATION_TRACK.BLEND_SHAPE, 'blend_shape_track_interpolate'));
  method(clip, 'transform_track_interpolate', () => {
    throw new Error(
      'godot-compat: Godot 3 transform_track_interpolate returns one Transform with coupled ' +
        'position/quaternion/scale interpolation; the native Three clip retains three tracks and ' +
        'cannot expose that compound source value without a second interpolator.',
    );
  });
  method(clip, 'method_track_get_name', (index, key) => {
    const track = trackAt(state, index, 'method_track_get_name');
    const value = track.keys[keyAt(track, key, 'method_track_get_name')]!.value;
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'method') === 'string'
      ? Reflect.get(value, 'method') : '';
  });
  method(clip, 'method_track_get_params', (index, key) => {
    const track = trackAt(state, index, 'method_track_get_params');
    const value = track.keys[keyAt(track, key, 'method_track_get_params')]!.value;
    const args = typeof value === 'object' && value !== null ? Reflect.get(value, 'args') : undefined;
    return Array.isArray(args) ? [...args] : [];
  });
  method(clip, 'bezier_track_insert_key', (index, time, value, inHandle = [-0.25, 0], outHandle = [0.25, 0]) => {
    const track = trackAt(state, index, 'bezier_track_insert_key');
    if (track.type !== GODOT_ANIMATION_TRACK.BEZIER) throw new TypeError('godot-compat: bezier_track_insert_key requires a bezier track');
    const atTime = finite(time, 'bezier_track_insert_key time');
    const next = { time: atTime, value: finite(value, 'bezier_track_insert_key value'), transition: 1 };
    track.keys.push(next);
    track.keys.sort((a, b) => a.time - b.time);
    const at = track.keys.indexOf(next);
    const handle = (input: unknown, member: string): readonly [number, number] => {
      if (Array.isArray(input) && input.length >= 2) {
        return [finite(input[0], `${member}.x`), finite(input[1], `${member}.y`)];
      }
      if (typeof input === 'object' && input !== null) {
        return [finite(Reflect.get(input, 'x'), `${member}.x`), finite(Reflect.get(input, 'y'), `${member}.y`)];
      }
      throw new TypeError(`godot-compat: ${member} must be Vector2-like`);
    };
    track.bezierHandles.splice(at, 0, { inHandle: handle(inHandle, 'in_handle'), outHandle: handle(outHandle, 'out_handle'), mode: 0 });
    return at;
  });
  method(clip, 'bezier_track_get_key_value', (index, key) => {
    const track = trackAt(state, index, 'bezier_track_get_key_value');
    return track.keys[keyAt(track, key, 'bezier_track_get_key_value')]!.value;
  });
  method(clip, 'bezier_track_set_key_value', (index, key, value) => {
    const track = trackAt(state, index, 'bezier_track_set_key_value');
    track.keys[keyAt(track, key, 'bezier_track_set_key_value')]!.value = finite(value, 'bezier_track_set_key_value');
  });
  for (const [member, side] of [['bezier_track_get_key_in_handle', 'inHandle'], ['bezier_track_get_key_out_handle', 'outHandle']] as const) {
    method(clip, member, (index, key) => {
      const track = trackAt(state, index, member);
      const value = track.bezierHandles[keyAt(track, key, member)]?.[side] ?? [0, 0];
      return { x: value[0], y: value[1] };
    });
  }
  for (const [member, side] of [['bezier_track_set_key_in_handle', 'inHandle'], ['bezier_track_set_key_out_handle', 'outHandle']] as const) {
    method(clip, member, (index, key, value) => {
      const track = trackAt(state, index, member);
      const at = keyAt(track, key, member);
      if (typeof value !== 'object' || value === null) throw new TypeError(`godot-compat: ${member} requires Vector2`);
      const next: readonly [number, number] = [finite(Reflect.get(value, 'x'), `${member}.x`), finite(Reflect.get(value, 'y'), `${member}.y`)];
      const current: AnimationTrackState['bezierHandles'][number] = track.bezierHandles[at] ?? {
        inHandle: [0, 0],
        outHandle: [0, 0],
        mode: 0,
      };
      track.bezierHandles[at] = { ...current, [side]: next };
    });
  }
  method(clip, 'bezier_track_interpolate', (index, time) => {
    const track = trackAt(state, index, 'bezier_track_interpolate');
    if (track.type !== (state.major === 3 ? GODOT3_ANIMATION_TRACK.BEZIER : GODOT_ANIMATION_TRACK.BEZIER)) {
      throw new TypeError('godot-compat: bezier_track_interpolate requires a bezier track');
    }
    const at = finite(time, 'bezier_track_interpolate time');
    if (track.keys.length === 0) return 0;
    if (at <= track.keys[0]!.time) return track.keys[0]!.value;
    const last = track.keys[track.keys.length - 1]!;
    if (at >= last.time) return last.value;
    const right = track.keys.findIndex((key) => key.time >= at);
    const left = right - 1;
    const a = track.keys[left]!;
    const b = track.keys[right]!;
    const aHandle = track.bezierHandles[left]?.outHandle ?? [0, 0];
    const bHandle = track.bezierHandles[right]?.inHandle ?? [0, 0];
    const cubic = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
      const inverse = 1 - t;
      return inverse * inverse * inverse * p0 + 3 * inverse * inverse * t * p1 +
        3 * inverse * t * t * p2 + t * t * t * p3;
    };
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 24; iteration += 1) {
      const middle = (low + high) * 0.5;
      const sampledTime = cubic(a.time, a.time + aHandle[0], b.time + bHandle[0], b.time, middle);
      if (sampledTime < at) low = middle;
      else high = middle;
    }
    const parameter = (low + high) * 0.5;
    return cubic(
      Number(a.value), Number(a.value) + aHandle[1],
      Number(b.value) + bHandle[1], Number(b.value), parameter,
    );
  });
  method(clip, 'animation_track_insert_key', (index, time, animationName) => {
    const insert = Reflect.get(clip, 'track_insert_key');
    if (typeof insert !== 'function') {
      throw new TypeError('godot-compat: Animation.track_insert_key is unavailable on this retained Animation');
    }
    return Reflect.apply(insert, clip, [index, time, name(animationName, 'animation_track_insert_key')]);
  });
  method(clip, 'animation_track_get_key_animation', (index, key) => {
    const track = trackAt(state, index, 'animation_track_get_key_animation');
    const value = track.keys[keyAt(track, key, 'animation_track_get_key_animation')]!.value;
    return typeof value === 'string' ? value : '';
  });
  method(clip, 'audio_track_insert_key', (index, time, stream, startOffset = 0, endOffset = 0) => {
    const track = trackAt(state, index, 'audio_track_insert_key');
    const audioType = state.major === 3 ? GODOT3_ANIMATION_TRACK.AUDIO : GODOT_ANIMATION_TRACK.AUDIO;
    if (track.type !== audioType) throw new TypeError('godot-compat: audio_track_insert_key requires an audio track');
    const next = {
      time: finite(time, 'audio_track_insert_key time'),
      value: {
        stream,
        startOffset: Math.max(0, finite(startOffset, 'audio_track_insert_key start_offset')),
        endOffset: Math.max(0, finite(endOffset, 'audio_track_insert_key end_offset')),
      },
      transition: 1,
    };
    track.keys.push(next);
    track.keys.sort((a, b) => a.time - b.time);
    return track.keys.indexOf(next);
  });
  const audioValue = (index: unknown, key: unknown, member: string): object => {
    const track = trackAt(state, index, member);
    const value = track.keys[keyAt(track, key, member)]!.value;
    if (typeof value !== 'object' || value === null || !('stream' in value)) {
      throw new TypeError(`godot-compat: Animation.${member} requires an audio key`);
    }
    return value;
  };
  method(clip, 'audio_track_get_key_stream', (index, key) =>
    Reflect.get(audioValue(index, key, 'audio_track_get_key_stream'), 'stream') ?? null);
  method(clip, 'audio_track_get_key_start_offset', (index, key) =>
    Reflect.get(audioValue(index, key, 'audio_track_get_key_start_offset'), 'startOffset') ?? 0);
  method(clip, 'audio_track_get_key_end_offset', (index, key) =>
    Reflect.get(audioValue(index, key, 'audio_track_get_key_end_offset'), 'endOffset') ?? 0);
  method(clip, 'audio_track_set_key_stream', (index, key, stream) => {
    Reflect.set(audioValue(index, key, 'audio_track_set_key_stream'), 'stream', stream);
  });
  method(clip, 'audio_track_set_key_start_offset', (index, key, offset) => {
    Reflect.set(
      audioValue(index, key, 'audio_track_set_key_start_offset'),
      'startOffset',
      Math.max(0, finite(offset, 'audio start offset')),
    );
  });
  method(clip, 'audio_track_set_key_end_offset', (index, key, offset) => {
    Reflect.set(
      audioValue(index, key, 'audio_track_set_key_end_offset'),
      'endOffset',
      Math.max(0, finite(offset, 'audio end offset')),
    );
  });
  method(clip, 'optimize', () => {
    for (const track of clip.tracks) track.optimize();
  });
  method(clip, 'compress', () => {
    throw new Error('godot-compat: Animation.compress is an engine storage optimization with no native Three equivalent.');
  });
}

export function bindGodotAnimation(
  clip: AnimationClip,
  major: 3 | 4,
  initialLoop?: boolean,
): AnimationClip {
  if (ANIMATIONS.has(clip)) return clip;
  const tracks = major === 3
    ? unpackGodot3Tracks(clip.tracks)
    : clip.tracks.map((track) => unpackNativeTrack(track, inferredType(track, major)));
  const state: AnimationState = { major, tracks, loopMode: initialLoop === true ? 1 : 0, step: 0.1 };
  ANIMATIONS.set(clip, state);
  bindAnimationMethods(clip, state);
  return clip;
}

export function createGodotAnimation(major: 3 | 4): AnimationClip {
  return bindGodotAnimation(new AnimationClip('', 1, []), major);
}

export interface GodotAnimationLibrary {
  add_animation(name: string, animation: AnimationClip): number;
  remove_animation(name: string): void;
  rename_animation(name: string, newName: string): void;
  has_animation(name: string): boolean;
  get_animation(name: string): AnimationClip | null;
  get_animation_list(): PackedArrayValue<string>;
  get_animation_list_size(): number;
}

const LIBRARIES = new WeakMap<GodotAnimationLibrary, Map<string, AnimationClip>>();
export type AnimationLibraryChange =
  | { readonly type: 'add'; readonly name: string }
  | { readonly type: 'remove'; readonly name: string }
  | { readonly type: 'rename'; readonly from: string; readonly to: string };
const LIBRARY_WATCHERS = new WeakMap<GodotAnimationLibrary, Set<(change: AnimationLibraryChange) => void>>();

export function watchAnimationLibrary(
  library: GodotAnimationLibrary,
  listener: (change: AnimationLibraryChange) => void,
): () => void {
  animationLibraryEntries(library);
  const listeners = LIBRARY_WATCHERS.get(library) ?? new Set();
  listeners.add(listener);
  LIBRARY_WATCHERS.set(library, listeners);
  return () => { listeners.delete(listener); };
}

export function animationLibraryEntries(
  library: GodotAnimationLibrary,
): ReadonlyMap<string, AnimationClip> {
  const animations = LIBRARIES.get(library);
  if (animations === undefined) throw new TypeError('godot-compat: value is not an AnimationLibrary');
  return animations;
}

export function createGodotAnimationLibrary(major: 3 | 4): GodotAnimationLibrary {
  const animations = new Map<string, AnimationClip>();
  let library!: GodotAnimationLibrary;
  const changed = (change: AnimationLibraryChange): void => {
    for (const listener of LIBRARY_WATCHERS.get(library) ?? []) listener(change);
  };
  library = {
    add_animation(animationName, animation) {
      const key = name(animationName, 'AnimationLibrary.add_animation name');
      if (!(animation instanceof AnimationClip)) throw new TypeError('godot-compat: AnimationLibrary requires native AnimationClip');
      if (animations.has(key)) return 31;
      animations.set(key, bindGodotAnimation(animation, major));
      changed({ type: 'add', name: key });
      return 0;
    },
    remove_animation(animationName) {
      const key = name(animationName, 'AnimationLibrary.remove_animation');
      if (animations.delete(key)) changed({ type: 'remove', name: key });
    },
    rename_animation(animationName, replacementName) {
      const current = name(animationName, 'AnimationLibrary.rename_animation');
      const replacement = name(replacementName, 'AnimationLibrary.rename_animation new_name');
      const animation = animations.get(current);
      if (animation === undefined || animations.has(replacement)) return;
      animations.delete(current);
      animations.set(replacement, animation);
      changed({ type: 'rename', from: current, to: replacement });
    },
    has_animation: (animationName) => animations.has(name(animationName, 'AnimationLibrary.has_animation')),
    get_animation: (animationName) => animations.get(name(animationName, 'AnimationLibrary.get_animation')) ?? null,
    get_animation_list: () => packedStringArray([...animations.keys()].sort()),
    get_animation_list_size: () => animations.size,
  };
  LIBRARIES.set(library, animations);
  registerGodotObjectIdentity(library, 'AnimationLibrary');
  return library;
}
