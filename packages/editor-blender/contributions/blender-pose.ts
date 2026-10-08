/**
 * BLENDER'S POSE, EVALUATED ON THE PRESENTER'S BONES. One evaluator, used by the Timeline
 * (`blender-runtime-skin.ts`) and by a game (`blender-play-skin.ts`), so the two can never disagree
 * with each other, and both follow what Blender itself does:
 *
 * - THE STACK is `BKE_animsys_evaluate_animdata`'s: the NLA tracks bottom to top (mute and solo as
 *   Blender reads them), then the active action over them. A strip's time is
 *   `nlastrip_get_frame_actionclip`'s (scale, repeat, reverse), its influence its blend in and out
 *   or its own `influence`, and outside it the track holds as its extrapolation says.
 * - EACH CHANNEL blends as `nla_blend_value` / `nla_combine_*` blend it: per component, Replace,
 *   Combine, Add, Subtract or Multiply at the layer's influence. A component no layer animates
 *   keeps the bone's own value; one that is animated starts from the property's default. So an
 *   action that keys only the upper body layers over one that keys the legs, with no masks.
 * - THE MATRIX is `BKE_pchan_to_mat4` then `BKE_armature_mat_bone_to_pose`: rotation by the
 *   bone's own mode, and `parent @ rest @ basis` down the hierarchy.
 * - CONSTRAINTS run per bone after its parent, in stack order, blended by their influence as
 *   `BKE_constraints_solve` blends them. Damped Track is evaluated (`damptrack_do_transform`).
 *   Any other type is not, and is named (`unsupported`): its effect is Blender's alone.
 *
 * A clip holds Blender's own channel values per integer frame (`session.py`'s `rna_action_clip`),
 * so between whole frames the values are linear: exact at every frame, linear in between.
 */
import type { BlenderActionClip } from '@volter/blender-engine/browser/rna';
import type {
  BlenderArmature,
  BlenderArmatureAnimation,
  BlenderArmatureBone,
  BlenderNlaStrip,
} from '@volter/blender-engine/browser/three/blender-runtime-armature';
import type { ArmatureRig } from '@volter/blender-engine/browser/three/blender-runtime-skeleton';
import * as THREE from 'three';

type Channel = 'location' | 'rotation_quaternion' | 'rotation_euler' | 'rotation_axis_angle' | 'scale';
const CHANNELS: readonly Channel[] = ['location', 'rotation_quaternion', 'rotation_euler', 'rotation_axis_angle', 'scale'];
const DEFAULTS: Record<Channel, readonly number[]> = {
  location: [0, 0, 0],
  rotation_quaternion: [1, 0, 0, 0],
  rotation_euler: [0, 0, 0],
  rotation_axis_angle: [0, 0, 1, 0],
  scale: [1, 1, 1],
};

function float32Of(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

/** One action baked for one armature: its channels' values per integer frame. */
export interface PoseClip {
  readonly action: string;
  readonly start: number;
  readonly end: number;
  readonly cyclic: boolean;
  readonly channels: readonly {
    readonly bone: string;
    readonly channel: Channel;
    readonly mask: number;
    readonly stride: number;
    readonly frames: Float32Array;
    readonly values: Float32Array;
  }[];
}

/** The clip door's bake as a clip, or null when it holds nothing a pose can take. */
export function poseClip(clip: BlenderActionClip): PoseClip | null {
  if (!clip.action || clip.clipStart === undefined || clip.clipEnd === undefined || !clip.tracks.length) return null;
  return {
    action: clip.action,
    start: clip.clipStart,
    end: clip.clipEnd,
    cyclic: clip.cyclic ?? false,
    channels: clip.tracks.map((track) => ({
      bone: track.bone,
      channel: track.property,
      mask: track.mask,
      stride: track.stride,
      frames: float32Of(track.timeBase64),
      values: float32Of(track.valueBase64),
    })),
  };
}

/** A frame of the action as Blender plays it past its range: repeated when cyclic, else held. */
export function clipFrame(clip: PoseClip, frame: number): number {
  const length = clip.end - clip.start;
  if (clip.cyclic && length > 0) return clip.start + ((((frame - clip.start) % length) + length) % length);
  return Math.min(clip.end, Math.max(clip.start, frame));
}

/** One layer of the stack: an action at a frame of its own, an influence, a blend type. */
export interface PoseLayer {
  readonly clip: PoseClip;
  readonly frame: number;
  readonly influence: number;
  readonly blend: string;
}

/** A clip by action name: the clip, `undefined` while it is being baked, null when it has none. */
export type ClipSource = (action: string) => PoseClip | null | undefined;

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

/** A strip's influence at `time` (`nlastrip_get_influence`, or its own when it is animated). */
function stripInfluence(strip: BlenderNlaStrip, time: number): number {
  if (strip.animatedInfluence) return strip.influence;
  if (strip.blendIn > 0 && time >= strip.start && time <= strip.start + strip.blendIn) return (time - strip.start) / strip.blendIn;
  if (strip.blendOut > 0 && time >= strip.end - strip.blendOut && time <= strip.end) return (strip.end - time) / strip.blendOut;
  return 1;
}

/**
 * The NLA's layers at a scene frame, bottom to top, as Blender evaluates them. `waiting` says a
 * clip it needs is still being baked; `skipped` names what plays in Blender and not here.
 */
export function nlaLayers(animation: BlenderArmatureAnimation | undefined, frame: number, clips: ClipSource,
  tracks?: (name: string) => boolean): { layers: PoseLayer[]; waiting: boolean; skipped: string[] } {
  const layers: PoseLayer[] = [];
  const skipped: string[] = [];
  let waiting = false;
  if (!animation || !animation.useNla) return { layers, waiting, skipped };
  const solo = animation.tracks.some((track) => track.solo);
  for (const track of animation.tracks) {
    if (track.mute || (solo && !track.solo) || (tracks && !tracks(track.name))) continue;
    const hit = stripAt(track.strips, frame);
    if (!hit) continue;
    if (hit.strip.type !== 'CLIP' || !hit.strip.action) {
      skipped.push(`the ${hit.strip.type.toLowerCase()} strip "${hit.strip.name}" on track "${track.name}"`);
      continue;
    }
    const clip = clips(hit.strip.action);
    if (clip === undefined) waiting = true;
    if (!clip) continue;
    layers.push({ clip, frame: stripFrame(hit.strip, hit.time), influence: stripInfluence(hit.strip, hit.time), blend: hit.strip.blendType });
  }
  return { layers, waiting, skipped };
}

type Values = Record<Channel, number[]>;

const quatMul = (a: readonly number[], b: readonly number[]): number[] => [
  a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]! - a[3]! * b[3]!,
  a[0]! * b[1]! + a[1]! * b[0]! + a[2]! * b[3]! - a[3]! * b[2]!,
  a[0]! * b[2]! + a[2]! * b[0]! + a[3]! * b[1]! - a[1]! * b[3]!,
  a[0]! * b[3]! + a[3]! * b[0]! + a[1]! * b[2]! - a[2]! * b[1]!,
];
const quatNormal = (q: readonly number[]): number[] => {
  const length = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
  return length > 0 ? q.map((v) => v / length) : [1, 0, 0, 0];
};
/** `pow_qt_fl_normalized`. */
const quatPow = (q: readonly number[], k: number): number[] => {
  const angle = k * Math.acos(Math.max(-1, Math.min(1, q[0]!)));
  const length = Math.hypot(q[1]!, q[2]!, q[3]!);
  const s = Math.sin(angle);
  return length > 0 ? [Math.cos(angle), (q[1]! / length) * s, (q[2]! / length) * s, (q[3]! / length) * s] : [Math.cos(angle), 0, 0, 0];
};
const axisAngleToQuat = (v: readonly number[]): number[] => {
  const length = Math.hypot(v[1]!, v[2]!, v[3]!) || 1;
  const half = v[0]! / 2;
  const s = Math.sin(half);
  return [Math.cos(half), (v[1]! / length) * s, (v[2]! / length) * s, (v[3]! / length) * s];
};
const quatToAxisAngle = (q: readonly number[]): number[] => {
  const n = quatNormal(q);
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, n[0]!)));
  const s = Math.hypot(n[1]!, n[2]!, n[3]!);
  return s > 1e-9 ? [angle, n[1]! / s, n[2]! / s, n[3]! / s] : [0, 0, 1, 0];
};

/** One layer blended into the values (`nla_blend_value`, `nla_combine_value`, `nla_combine_quaternion`). */
function blendLayer(values: Map<string, Values>, touched: Map<string, Record<Channel, number>>, layer: PoseLayer): void {
  const k = Math.max(0, Math.min(1, layer.influence));
  if (k === 0) return;
  const frame = clipFrame(layer.clip, layer.frame);
  for (const channel of layer.clip.channels) {
    const bone = values.get(channel.bone);
    if (!bone) continue;
    const marks = touched.get(channel.bone)!;
    const out = bone[channel.channel];
    // A COMPONENT AN ACTION ANIMATES starts from the property's default, as Blender's NLA does.
    for (let i = 0; i < channel.stride; i++) if (channel.mask & (1 << i) && !(marks[channel.channel] & (1 << i))) out[i] = DEFAULTS[channel.channel][i]!;
    marks[channel.channel] |= channel.mask;
    const sample = sampleChannel(channel, frame);
    if (layer.blend === 'COMBINE' && (channel.channel === 'rotation_quaternion' || channel.channel === 'rotation_axis_angle')) {
      const quaternion = channel.channel === 'rotation_quaternion';
      const lower = quaternion ? quatNormal(out) : axisAngleToQuat(out);
      const upper = quaternion ? quatNormal(sample) : axisAngleToQuat(sample);
      const result = quatMul(lower, quatPow(upper, k));
      const written = quaternion ? result : quatToAxisAngle(result);
      for (let i = 0; i < channel.stride; i++) if (channel.mask & (1 << i)) out[i] = written[i]!;
      continue;
    }
    for (let i = 0; i < channel.stride; i++) {
      if (!(channel.mask & (1 << i))) continue;
      const lower = out[i]!;
      const upper = sample[i]!;
      switch (layer.blend) {
        case 'ADD': out[i] = lower + upper * k; break;
        case 'SUBTRACT': out[i] = lower - upper * k; break;
        case 'MULTIPLY': out[i] = k * (lower * upper) + (1 - k) * lower; break;
        case 'COMBINE':
          out[i] = channel.channel === 'scale' ? lower * Math.pow(upper, k) : lower + (upper - DEFAULTS[channel.channel][i]!) * k;
          break;
        default: out[i] = lower * (1 - k) + upper * k;
      }
    }
  }
}

function sampleChannel(channel: PoseClip['channels'][number], frame: number): number[] {
  const { frames, values, stride } = channel;
  const last = frames.length - 1;
  let i = 0;
  if (frame <= frames[0]!) i = 0;
  else if (frame >= frames[last]!) i = last;
  else while (i < last && frames[i + 1]! <= frame) i++;
  const out: number[] = [];
  if (i >= last || frame <= frames[0]!) {
    for (let c = 0; c < stride; c++) out.push(values[i * stride + c]!);
    return out;
  }
  const t = (frame - frames[i]!) / (frames[i + 1]! - frames[i]!);
  for (let c = 0; c < stride; c++) out.push(values[i * stride + c]! * (1 - t) + values[(i + 1) * stride + c]! * t);
  return out;
}

/** `BKE_pchan_to_mat4`: the channels as the bone's basis matrix, rotation by its own mode. */
function basisMatrix(mode: string, values: Values): THREE.Matrix4 {
  const rotation = new THREE.Quaternion();
  if (mode === 'QUATERNION') {
    const q = quatNormal(values.rotation_quaternion);
    rotation.set(q[1]!, q[2]!, q[3]!, q[0]!);
  } else if (mode === 'AXIS_ANGLE') {
    const v = values.rotation_axis_angle;
    rotation.setFromAxisAngle(new THREE.Vector3(v[1], v[2], v[3]).normalize(), v[0]!);
  } else {
    // Blender's `XYZ` applies X first; three's Euler order names the matrix product, so it reads
    // the same rotation reversed.
    const e = values.rotation_euler;
    rotation.setFromEuler(new THREE.Euler(e[0], e[1], e[2], mode.split('').reverse().join('') as THREE.EulerOrder));
  }
  const [x, y, z] = values.location;
  const [sx, sy, sz] = values.scale;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(sx, sy, sz));
}

const TRACK_AXES = ['TRACK_X', 'TRACK_Y', 'TRACK_Z', 'TRACK_NEGATIVE_X', 'TRACK_NEGATIVE_Y', 'TRACK_NEGATIVE_Z'];
const TRACK_VECTORS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]] as const;

/** `damptrack_do_transform`: the smallest rotation that points the owner's axis at the target. */
function dampedTrack(owner: THREE.Matrix4, target: THREE.Vector3, axis: string): THREE.Matrix4 {
  const flag = Math.max(0, TRACK_AXES.indexOf(axis));
  const basis = new THREE.Matrix3().setFromMatrix4(owner);
  const obvec = new THREE.Vector3(...TRACK_VECTORS[flag]!).applyMatrix3(basis);
  if (obvec.lengthSq() === 0) return owner.clone();
  obvec.normalize();
  const obloc = new THREE.Vector3().setFromMatrixPosition(owner);
  const tarvec = target.clone().sub(obloc);
  if (tarvec.lengthSq() === 0) tarvec.copy(obvec);
  else tarvec.normalize();
  const raxis = new THREE.Vector3().crossVectors(obvec, tarvec);
  let rangle = Math.acos(Math.max(-1, Math.min(1, obvec.dot(tarvec))));
  const norm = raxis.length();
  if (norm < 1.1920929e-7) {
    if (Math.abs(rangle) < Math.PI - 0.01) return owner.clone();
    rangle = Math.PI;
    const other = new THREE.Vector3(...TRACK_VECTORS[(flag + 1) % 6]!).applyMatrix3(basis);
    raxis.crossVectors(obvec, other);
    if (raxis.lengthSq() === 0) return owner.clone();
  } else if (norm < 0.1) {
    rangle = rangle > Math.PI / 2 ? Math.PI - Math.asin(norm) : Math.asin(norm);
  }
  const turned = new THREE.Matrix4().makeRotationAxis(raxis.normalize(), rangle).multiply(owner);
  return turned.setPosition(obloc);
}

/** `interp_m4_m4m4`: a constraint's result taken by its influence. */
function blendMatrix(before: THREE.Matrix4, after: THREE.Matrix4, k: number): THREE.Matrix4 {
  if (k >= 1) return after;
  const [p0, q0, s0] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
  const [p1, q1, s1] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
  before.decompose(p0, q0, s0);
  after.decompose(p1, q1, s1);
  return new THREE.Matrix4().compose(p0.lerp(p1, k), q0.slerp(q1, k), s0.lerp(s1, k));
}

/** What a game changes on a constraint while it runs. */
export interface ConstraintOverride {
  readonly influence?: number;
  /** The object it aims at instead of the file's target. */
  readonly target?: THREE.Object3D | null;
}

/** Where a constraint's targets are, in the scene the bones are in. */
export interface ConstraintWorld {
  /** An object by its Blender name (its presented copy). */
  object(name: string): THREE.Object3D | null;
  /** A game's change to one constraint of one bone, if it made one. */
  override?(bone: string, constraint: string): ConstraintOverride | undefined;
}

/** One armature's bones, posed by the stack: Blender's evaluation, on the presenter's skeleton. */
export class ArmaturePose {
  #bones: readonly BlenderArmatureBone[] = [];
  #restRelative = new Map<string, THREE.Matrix4>();
  #armature: BlenderArmature | null = null;

  constructor(readonly rig: ArmatureRig) {}

  /** Take the frame's facts for this armature (its bones' rest, channels and constraints). */
  facts(armature: BlenderArmature): void {
    if (armature === this.#armature) return;
    this.#armature = armature;
    this.#bones = armature.bones;
    const rest = new Map(armature.bones.map((bone) => [bone.name, matrixOf(bone.rest ?? bone.matrix)]));
    this.#restRelative = new Map(armature.bones.map((bone) => {
      const own = rest.get(bone.name)!;
      const parent = bone.parent === null ? undefined : rest.get(bone.parent);
      return [bone.name, parent ? parent.clone().invert().multiply(own) : own.clone()];
    }));
  }

  get armature(): BlenderArmature | null {
    return this.#armature;
  }

  /** What this armature does in Blender that the evaluator does not: each named once. */
  unsupported(): string[] {
    const out: string[] = [];
    for (const bone of this.#bones) {
      for (const constraint of bone.constraints ?? []) {
        if (constraint.enabled && constraint.type !== 'DAMPED_TRACK') out.push(`the ${constraintLabel(constraint.type)} constraint "${constraint.name}" on bone "${bone.name}"`);
      }
      if (bone.inherit?.length) out.push(`bone "${bone.name}"'s parenting (${bone.inherit.join(', ')})`);
    }
    for (const bone of this.#armature?.animation?.drivers ?? []) out.push(`the drivers on bone "${bone}"`);
    for (const track of this.#armature?.animation?.tracks ?? [])
      for (const strip of track.strips)
        if (!strip.mute && strip.animatedTime) out.push(`the animated strip time of "${strip.name}"`);
    return out;
  }

  /** Pose the bones from these layers and constraints; answers each bone's armature-space pose.
   *  `write: false` only answers it, leaving the bones as they are (the fidelity check). */
  apply(layers: readonly PoseLayer[], world: ConstraintWorld, write = true): Map<string, THREE.Matrix4> {
    const values = new Map<string, Values>();
    const touched = new Map<string, Record<Channel, number>>();
    for (const bone of this.#bones) {
      const own = bone.channels;
      values.set(bone.name, Object.fromEntries(CHANNELS.map((channel) => [channel, [...(own?.[channel] ?? DEFAULTS[channel])]])) as Values);
      touched.set(bone.name, { location: 0, rotation_quaternion: 0, rotation_euler: 0, rotation_axis_angle: 0, scale: 0 });
    }
    for (const layer of layers) blendLayer(values, touched, layer);

    this.rig.object.updateWorldMatrix(true, false);
    const armatureWorld = this.rig.object.matrixWorld;
    const toArmature = armatureWorld.clone().invert();
    const poses = new Map<string, THREE.Matrix4>();
    for (const bone of this.#bones) {
      const parent = bone.parent === null ? null : poses.get(bone.parent) ?? null;
      const basis = basisMatrix(bone.channels?.mode ?? 'QUATERNION', values.get(bone.name)!);
      let pose = (parent ? parent.clone() : new THREE.Matrix4()).multiply(this.#restRelative.get(bone.name)!).multiply(basis);
      for (const constraint of bone.constraints ?? []) {
        if (!constraint.enabled || constraint.type !== 'DAMPED_TRACK') continue;
        const change = world.override?.(bone.name, constraint.name);
        const influence = change?.influence ?? constraint.influence;
        if (influence <= 0) continue;
        const target = this.#target(constraint, change, poses, world);
        if (!target) continue;
        const owner = armatureWorld.clone().multiply(pose);
        const solved = dampedTrack(owner, target, constraint.trackAxis ?? 'TRACK_Y');
        pose = toArmature.clone().multiply(blendMatrix(owner, solved, influence));
      }
      poses.set(bone.name, pose);
    }
    if (!write) return poses;
    for (const bone of this.#bones) {
      const own = poses.get(bone.name)!;
      const parent = bone.parent === null ? undefined : poses.get(bone.parent);
      const local = parent ? parent.clone().invert().multiply(own) : own;
      const presented = this.rig.bones.get(bone.name);
      if (presented) local.decompose(presented.position, presented.quaternion, presented.scale);
    }
    this.rig.object.updateMatrixWorld(true);
    return poses;
  }

  /** A constraint's target point in world space: an object's origin, or a point along a bone. */
  #target(constraint: NonNullable<BlenderArmatureBone['constraints']>[number], change: ConstraintOverride | undefined,
    poses: ReadonlyMap<string, THREE.Matrix4>, world: ConstraintWorld): THREE.Vector3 | null {
    if (change?.target) {
      change.target.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(change.target.matrixWorld);
    }
    if (change?.target === null || !constraint.target) return null;
    const object = world.object(constraint.target);
    if (!object) return null;
    object.updateWorldMatrix(true, false);
    if (!constraint.subtarget) return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
    const own = constraint.target === this.rig.armature;
    const pose = own ? poses.get(constraint.subtarget) : undefined;
    const bone = this.#bones.find((one) => one.name === constraint.subtarget);
    if (own && pose && bone) {
      const along = new THREE.Vector3(0, bone.length * (constraint.headTail ?? 0), 0).applyMatrix4(pose);
      return along.applyMatrix4(this.rig.object.matrixWorld);
    }
    const presented = object.getObjectByName(constraint.subtarget);
    return presented ? new THREE.Vector3().setFromMatrixPosition(presented.matrixWorld) : null;
  }
}

const matrixOf = (rows: readonly (readonly number[])[]): THREE.Matrix4 =>
  new THREE.Matrix4().set(...(rows.flat() as Parameters<THREE.Matrix4['set']>));

const constraintLabel = (type: string): string =>
  type.toLowerCase().split('_').map((word) => (word === 'ik' ? 'IK' : word[0]!.toUpperCase() + word.slice(1))).join(' ');

/**
 * THE FIDELITY CHECK: how far an evaluated pose is from Blender's own at the same frame (the
 * frame's `PoseBone.matrix`). Answers the bone that is furthest off, or null when every bone is
 * within a tenth of a degree and a thousandth of its length.
 */
export function poseDivergence(evaluated: ReadonlyMap<string, THREE.Matrix4>, armature: BlenderArmature):
  { bone: string; degrees: number; offset: number } | null {
  let worst: { bone: string; degrees: number; offset: number; score: number } | null = null;
  const [p0, q0, s0, p1, q1, s1] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
  for (const bone of armature.bones) {
    const ours = evaluated.get(bone.name);
    if (!ours) continue;
    ours.decompose(p0, q0, s0);
    matrixOf(bone.matrix).decompose(p1, q1, s1);
    const degrees = THREE.MathUtils.radToDeg(q0.angleTo(q1));
    const offset = p0.distanceTo(p1) / Math.max(bone.length, 1e-3);
    const score = Math.max(degrees / 0.1, offset / 1e-3);
    if (score > 1 && (!worst || score > worst.score)) worst = { bone: bone.name, degrees, offset, score };
  }
  return worst && { bone: worst.bone, degrees: worst.degrees, offset: worst.offset };
}
