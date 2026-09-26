/**
 * read/gltf-animation-import.ts — the KEYS of the animations Godot 4.7's scene importer makes from a
 * glTF (`read/gltf-godot-scene.ts` models which tracks each clip carries and in what order; this
 * models what is in them), at revision `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`:
 *
 *  1. `GLTFDocument::_import_animation` (gltf_document.cpp:5578) RESAMPLES each channel at the
 *     sidecar's `animation/fps`: from the clip's start, a key every `1 / fps` seconds (a double
 *     accumulating) until the greatest key time seen so far in the clip, and a last key exactly
 *     there, each the channel's value at that time as `_interpolate_track` (:5000) computes it —
 *     the time narrowed to a float, a Vector3 `a + (b - a) * c`, a Quaternion
 *     `a.slerp(b, c).normalized()`, a cubic spline's Hermite curve (a Quaternion's slerp between
 *     the values);
 *  2. `_optimize_track_usage` (resource_importer_scene.cpp:2915) gives a clip a track it lacks with
 *     one key at 0: the bone's pose (or the node's own position, rotation, scale);
 *  3. `_post_fix_animations` removes the immutable tracks (the reader decides which);
 *  4. `Animation::optimize(0.01, 0.01, 3)` (animation.cpp:4507), the importer's default optimizer,
 *     removes each key its neighbours' line explains;
 *  5. the imported scene is saved and loaded, which packs each 3D key's time into a float.
 *
 * A quaternion's slerp and `acos` go through the platform's `acosf`/`sinf`/`acos`, which the
 * native import computes with the platform C library: a rotation key may differ from it by one
 * float32 ulp (`quaternion.ts`). Animation trimming, per-clip import settings and CATMULLROMSPLINE
 * are refused.
 */
import { GltfParseError } from './glb-container';
import type { GltfAnimationChannel, GltfDocument } from './gltf-document';
import { basisRotationQuaternion, basisScale } from './gltf-document';
import type { GlbScene } from './gltf-godot-scene';
import {
  construct as quaternion,
  dot,
  inverse,
  is_normalized,
  length,
  normalized,
  op_multiply,
  type Quaternion,
  slerp,
} from '../../capabilities/catalog/project-source/src/lib/godot-compat/quaternion';

const f = Math.fround;
const CMP_EPSILON = 0.00001;

type V3 = readonly [number, number, number];
type Q = readonly [number, number, number, number];

/** A key: time (double), transition (1), value. */
export type ImportedKey = readonly [number, number, V3 | Q];

export interface ImportedTrack {
  readonly type: 1 | 2 | 3;
  readonly path: string;
  /** `Animation::InterpolationType`: 0 nearest (a STEP sampler), 1 linear. */
  readonly interp: number;
  readonly keys: readonly ImportedKey[];
}

export interface ImportedClip {
  readonly name: string;
  /** The glTF `animations[]` index: the library's order (`_import_animation` per index). */
  readonly gltfIndex: number;
  readonly length: number;
  readonly loopMode: number;
  readonly step: number;
  readonly tracks: readonly ImportedTrack[];
}

// --- Math (float32 where `real_t` is, as the engine computes).

function isEqualApprox(a: number, b: number): boolean {
  if (a === b) return true;
  let tolerance = CMP_EPSILON * Math.abs(a);
  if (tolerance < CMP_EPSILON) tolerance = CMP_EPSILON;
  return Math.abs(a - b) < tolerance;
}
const sub3 = (a: V3, b: V3): V3 => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
const add3 = (a: V3, b: V3): V3 => [f(a[0] + b[0]), f(a[1] + b[1]), f(a[2] + b[2])];
const mul3 = (a: V3, s: number): V3 => [f(a[0] * s), f(a[1] * s), f(a[2] * s)];
const len3 = (a: V3): number => f(Math.sqrt(f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]))));
const dot3 = (a: V3, b: V3): number => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
function normalized3(a: V3): V3 {
  const l = f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]));
  if (l === 0) return [0, 0, 0];
  const s = f(Math.sqrt(l));
  return [f(a[0] / s), f(a[1] / s), f(a[2] / s)];
}

const toQ = (q: Q): Quaternion => quaternion(q[0], q[1], q[2], q[3]);
const fromQ = (q: Quaternion): Q => [q.x, q.y, q.z, q.w];
const dotQ = (a: Q, b: Q): number => dot(toQ(a), toQ(b));
const isNormalizedQ = (a: Q): boolean => is_normalized(toQ(a));
const normalizedQ = (a: Q): Q => fromQ(normalized(toQ(a)));
const slerpQ = (a: Q, b: Q, weight: number): Q => fromQ(slerp(toQ(a), toQ(b), weight));
const mulQ = (a: Q, b: Q): Q => fromQ(op_multiply(toQ(a), toQ(b)));
const inverseQ = (a: Q): Q => fromQ(inverse(toQ(a)));
const lengthQ = (a: Q): number => length(toQ(a));
/** `Quaternion::get_axis` (`core/math/quaternion.cpp:196`). */
function axisQ(q: Q): V3 {
  if (Math.abs(q[3]) > f(1 - CMP_EPSILON)) return [q[0], q[1], q[2]];
  const r = f(1 / f(Math.sqrt(f(1 - f(q[3] * q[3])))));
  return [f(q[0] * r), f(q[1] * r), f(q[2] * r)];
}

// --- 1. Resampling (`_import_animation`, `_interpolate_track`).

function valueAt(channel: GltfAnimationChannel, index: number): readonly number[] {
  const value = channel.outputs[index] as readonly number[];
  return channel.path === 'rotation' ? normalizedQ(value as unknown as Q) : value;
}

/** `_interpolate_track` (`gltf_document.cpp:5000`) at the float `time`. */
function interpolate(channel: GltfAnimationChannel, time: number): V3 | Q {
  const times = channel.times;
  const rotation = channel.path === 'rotation';
  let idx = -1;
  for (let i = 0; i < times.length; i += 1) {
    if ((times[i] as number) > time) break;
    idx += 1;
  }
  const cubic = channel.interpolation === 'CUBICSPLINE';
  const at = (i: number) => valueAt(channel, cubic ? i * 3 + 1 : i) as V3 | Q;
  if (idx === -1) return at(0);
  if (idx >= times.length - 1) return at(times.length - 1);
  if (channel.interpolation === 'STEP') return at(idx);
  const t0 = times[idx] as number;
  const t1 = times[idx + 1] as number;
  if (channel.interpolation === 'LINEAR') {
    const c = f((time - t0) / (t1 - t0));
    if (rotation) {
      const a = at(idx) as Q;
      const b = at(idx + 1) as Q;
      if (!isNormalizedQ(a) || !isNormalizedQ(b)) return [0, 0, 0, 1];
      return normalizedQ(slerpQ(a, b, c));
    }
    const a = at(idx) as V3;
    return add3(a, mul3(sub3(at(idx + 1) as V3, a), c));
  }
  // CUBICSPLINE: the glTF Hermite curve over the value and the tangents scaled by the key span.
  const td = f(t1 - t0);
  const c = f((time - t0) / (t1 - t0));
  if (rotation) {
    const from = at(idx) as Q;
    const to = at(idx + 1) as Q;
    if (!isNormalizedQ(from) || !isNormalizedQ(to)) return [0, 0, 0, 1];
    return normalizedQ(slerpQ(from, to, c));
  }
  const from = at(idx) as V3;
  const to = at(idx + 1) as V3;
  const tanFrom = mul3(channel.outputs[idx * 3 + 2] as unknown as V3, td);
  const tanTo = mul3(channel.outputs[idx * 3 + 3] as unknown as V3, td);
  const t2 = f(c * c);
  const t3 = f(t2 * c);
  // The weights in double (`2.0 * t3 - 3.0 * t2 + 1.0`), each stored as a `real_t`.
  const h00 = f(2 * t3 - 3 * t2 + 1);
  const h10 = f(t3 - 2 * t2 + c);
  const h01 = f(-2 * t3 + 3 * t2);
  const h11 = f(t3 - t2);
  return add3(add3(add3(mul3(from, h00), mul3(tanFrom, h10)), mul3(to, h01)), mul3(tanTo, h11));
}

/** `Animation::_insert` (`animation.cpp:1093`): a key at an approximately equal time replaces it. */
function insertKey(keys: [number, number, V3 | Q][], time: number, value: V3 | Q): void {
  let idx = keys.length;
  for (;;) {
    const previous = keys[idx - 1];
    if (idx > 0 && previous !== undefined && isEqualApprox(previous[0], time)) {
      keys[idx - 1] = [time, previous[1], value];
      return;
    }
    if (idx === 0 || (previous as [number, number, V3 | Q])[0] < time) {
      keys.splice(idx, 0, [time, 1, value]);
      return;
    }
    idx -= 1;
  }
}

// --- 4. `Animation::optimize` (`animation.cpp:4189-4525`).

function vector3KeyRemovable(t0: ImportedKey, t1: ImportedKey, t2: ImportedKey, velocityError: number, angularError: number, precision: number, nearest: boolean): boolean {
  if (isEqualApprox(t0[0], t1[0]) || isEqualApprox(t1[0], t2[0])) return true;
  const v0v = t0[2] as V3;
  const v1v = t1[2] as V3;
  const v2v = t2[2] as V3;
  if (len3(sub3(v0v, v1v)) < precision && len3(sub3(v1v, v2v)) < precision) return true;
  if (nearest) return false;
  // `Vector3 / real_t` divides each component.
  const div3 = (a: V3, s: number): V3 => [f(a[0] / s), f(a[1] / s), f(a[2] / s)];
  const vc0 = div3(sub3(v1v, v0v), f(t1[0] - t0[0]));
  const vc1 = div3(sub3(v2v, v1v), f(t2[0] - t1[0]));
  let v0 = len3(vc0);
  let v1 = len3(vc1);
  if (Math.abs(v0 - v1) < precision) return true;
  if (Math.abs(v0) < precision || Math.abs(v1) < precision) return false;
  if (dot3(normalized3(vc0), normalized3(vc1)) >= 1 - angularError * 2) {
    v0 = Math.abs(v0);
    v1 = Math.abs(v1);
    const ratio = v0 < v1 ? v0 / v1 : v1 / v0;
    if (ratio >= 1 - velocityError) return true;
  }
  return false;
}

function quaternionKeyRemovable(t0: ImportedKey, t1: ImportedKey, t2: ImportedKey, velocityError: number, angularError: number, precision: number, nearest: boolean): boolean {
  if (isEqualApprox(t0[0], t1[0]) || isEqualApprox(t1[0], t2[0])) return true;
  const a = t0[2] as Q;
  const b = t1[2] as Q;
  const c = t2[2] as Q;
  const diff = (x: Q, y: Q) => lengthQ([f(x[0] - y[0]), f(x[1] - y[1]), f(x[2] - y[2]), f(x[3] - y[3])]);
  if (diff(a, b) < precision && diff(b, c) < precision) return true;
  if (nearest) return false;
  const q0 = mulQ(mulQ(a, b), inverseQ(a));
  const q1 = mulQ(mulQ(b, c), inverseQ(b));
  if (dot3(axisQ(q0), axisQ(q1)) >= 1 - angularError * 2) {
    // `Math::acos(float)`, the platform's `acosf`.
    const a0 = f(Math.acos(dotQ(a, b)));
    const a1 = f(Math.acos(dotQ(b, c)));
    if (a0 + a1 >= Math.PI / 2) return false;
    const v0 = a0 / (t1[0] - t0[0]);
    const v1 = a1 / (t2[0] - t1[0]);
    if (Math.abs(v0 - v1) < precision) return true;
    if (Math.abs(v0) < precision || Math.abs(v1) < precision) return false;
    const ratio = v0 < v1 ? v0 / v1 : v1 / v0;
    if (ratio >= 1 - velocityError) return true;
  }
  return false;
}

function optimizeTrack(track: ImportedTrack, velocityError: number, angularError: number, precision: number): ImportedTrack {
  if (track.interp !== 0 && track.interp !== 1) return track;
  const nearest = track.interp === 0;
  const keys = [...track.keys];
  const removable = track.type === 2 ? quaternionKeyRemovable : vector3KeyRemovable;
  let i = 0;
  while (i < keys.length - 2) {
    if (removable(keys[i] as ImportedKey, keys[i + 1] as ImportedKey, keys[i + 2] as ImportedKey, velocityError, angularError, precision, nearest)) keys.splice(i + 1, 1);
    else i += 1;
  }
  if (keys.length === 2) {
    const a = (keys[0] as ImportedKey)[2];
    const b = (keys[1] as ImportedKey)[2];
    const difference = track.type === 2 ? lengthQ(a.map((v, k) => f(v - (b[k] as number))) as unknown as Q) : len3(sub3(a as V3, b as V3));
    if (difference < precision) keys.splice(1, 1);
  }
  return { ...track, keys };
}

/**
 * Each clip of the importer's AnimationPlayer, keyed as Godot's scene importer leaves it, in the
 * reader's clip and track order (`GlbScene`'s AnimationPlayer).
 */
export function importGltfAnimations(doc: GltfDocument, scene: GlbScene, fps: number, trimming: boolean): readonly ImportedClip[] {
  if (trimming) throw new GltfParseError(`${scene.resPath}: animation trimming is not translated`);
  const player = scene.nodes.find((node) => node.animations !== undefined);
  if (player === undefined) return [];
  // Each track path's glTF node, and what the importer's scene holds there for pass 2.
  const channelNode = new Map<string, { readonly node: number; readonly position: V3; readonly rotation: Q; readonly scale: V3 }>();
  for (const node of scene.nodes) {
    if (node.gltfNodeIndex !== undefined && node.nodeClass !== 'Skeleton3D') {
      const gltf = doc.nodes[node.gltfNodeIndex];
      if (gltf !== undefined) {
        channelNode.set(node.path === '.' ? '.' : node.path, {
          node: node.gltfNodeIndex,
          position: [gltf.transform.origin[0], gltf.transform.origin[1], gltf.transform.origin[2]] as unknown as V3,
          rotation: basisRotationQuaternion(gltf.transform),
          scale: basisScale(gltf.transform) as unknown as V3,
        });
      }
    }
    for (const bone of node.bones ?? []) {
      channelNode.set(`${node.path}:${bone.name}`, { node: bone.gltfNodeIndex, position: bone.pose.position, rotation: bone.pose.rotation, scale: bone.pose.scale });
    }
  }
  const increment = 1 / fps;
  // `real_t precision = Math::pow(0.1, 3)`; the importer's errors are its `float` options.
  const precision = f(Math.pow(0.1, 3));
  return (player.animations ?? []).map((clip) => {
    const animation = doc.animations[clip.gltfIndex];
    if (animation === undefined) throw new GltfParseError(`${scene.resPath}: the clip ${clip.name} has no glTF animation`);
    // 1. The clip's own channels resampled, node by node in first-mention order; the end grows as
    // each node's channels are read (`_import_animation`).
    const resampled = new Map<string, ImportedKey[]>();
    let animEnd = 0;
    const nodeOrder: number[] = [];
    for (const channel of animation.channels) if (!nodeOrder.includes(channel.node)) nodeOrder.push(channel.node);
    for (const nodeIndex of nodeOrder) {
      const channels = animation.channels.filter((channel) => channel.node === nodeIndex);
      for (const channel of channels) for (const time of channel.times) animEnd = Math.max(animEnd, time);
      const path = [...channelNode].find(([, entry]) => entry.node === nodeIndex)?.[0];
      if (path === undefined) continue;
      for (const channel of channels) {
        const type = channel.path === 'translation' ? 1 : channel.path === 'rotation' ? 2 : 3;
        const keys: [number, number, V3 | Q][] = [];
        let time = 0;
        let last = false;
        for (;;) {
          insertKey(keys, time, interpolate(channel, f(time)));
          if (last) break;
          time += increment;
          if (time >= animEnd) {
            last = true;
            time = animEnd;
          }
        }
        resampled.set(`${path}\0${String(type)}`, keys);
      }
    }
    // 2 and 3: the reader's track list; a track the clip lacks is one key at 0 of the node's value.
    const tracks = clip.tracks.map((track) => {
      const own = resampled.get(`${track.path}\0${String(track.type)}`);
      const channel = animation.channels.find((entry) => channelNode.get(track.path)?.node === entry.node && (entry.path === 'translation' ? 1 : entry.path === 'rotation' ? 2 : 3) === track.type);
      const interp = channel?.interpolation === 'STEP' ? 0 : 1;
      if (own !== undefined) return { type: track.type, path: track.path, interp, keys: own };
      const held = channelNode.get(track.path);
      if (held === undefined) throw new GltfParseError(`${scene.resPath}: the track ${track.path} names no imported node`);
      const value = track.type === 1 ? held.position : track.type === 2 ? held.rotation : held.scale;
      return { type: track.type, path: track.path, interp: 1, keys: [[0, 1, value] as ImportedKey] };
    });
    // 4. The optimizer.
    return {
      name: clip.name,
      gltfIndex: clip.gltfIndex,
      length: Math.max(animEnd, 0.001),
      loopMode: clip.loopMode,
      step: f(clip.step),
      // The imported scene is saved and loaded: a 3D track's keys are packed `real_t`s
      // (`Animation::_get`, animation.cpp:382), so each time is a float from here on.
      tracks: tracks.map((track) => {
        const optimized = optimizeTrack(track, f(0.01), f(0.01), precision);
        return { ...optimized, keys: optimized.keys.map(([time, transition, value]) => [f(time), f(transition), value] as ImportedKey) };
      }),
    };
  });
}
