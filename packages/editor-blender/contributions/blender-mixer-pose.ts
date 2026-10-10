/**
 * ANIMATION ON THREE.JS'S OWN MIXER. Blender holds the animation and samples it; three.js plays it.
 *
 * - A CLIP is an action as Blender evaluates it, sampled once by Blender itself (`session.py`'s
 *   `_three_bones`: every channel through `FCurve.evaluate`, composed into each bone's local
 *   transform at every integer frame), and played as a `THREE.AnimationClip` of position,
 *   quaternion and scale tracks. Keys, handles, easing, extrapolation and modifiers are therefore
 *   Blender's at every frame; between frames three.js interpolates (linear, slerp).
 * - A POSE is the layers the stack asks for (the NLA's strips and the active action, or what a
 *   game set), each an `AnimationAction` bound to the armature's rig on the scene's one
 *   `AnimationMixer` (`blender-scene-mixer.ts`) at the frame and influence the stack names. The
 *   mixer blends them, with every other armature's and the movie's, in one evaluation: `place`
 *   sets the actions, the scene evaluates, `settle` turns the constraints and reads the pose.
 * - What the mixer does not do on its own is filled in here:
 *   - REPLACE OVER REPLACE. A layer replaces what is under it only for the bones it animates, at
 *     its influence: a bone's lower layer is weighted by `1 - influence` of every higher layer that
 *     animates that bone. So each layer plays as groups of its tracks, one per set of higher layers
 *     covering them (an upper-body action over a run covers the arms, not the legs).
 *   - ADD and COMBINE play additively over what is under them, relative to the bone's rest.
 *   - DAMPED TRACK turns a bone, after the mixer, by the smallest rotation that points its track
 *     axis at the target, taken by the constraint's influence.
 *   SUBTRACT and MULTIPLY blends, other constraints, drivers and non-default parenting are named
 *   (`unsupported`), not played.
 */
import * as THREE from 'three';
import type { BlenderActionClip, BlenderClipColumn } from '@volter/blender-engine/browser/rna';
import type { BlenderArmature, BlenderArmatureBone } from '@volter/blender-engine/browser/three/blender-runtime-armature';
import type { ArmatureRig } from '@volter/blender-engine/browser/three/blender-runtime-skeleton';

function float32Of(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);
}

/** One bone of a clip: its sampled local transform, and the frames it is keyed on. */
interface ClipBone {
  readonly keys: readonly number[];
  readonly position: Float32Array;
  readonly quaternion: Float32Array;
  readonly scale: Float32Array;
}

/** One action as three.js plays it, for any armature with the bones it names. */
export interface MixerClip {
  readonly action: string;
  readonly start: number;
  readonly end: number;
  readonly fps: number;
  /** Where Blender holds the active action over NLA strips; infinite where Cycles repeats it. */
  readonly keysStart: number;
  readonly keysEnd: number;
  readonly cyclic: boolean;
  /** Its bones by name. */
  readonly bones: ReadonlyMap<string, ClipBone>;
  /** What its curves do in Blender that is not played. */
  readonly unsupported: readonly string[];
}

/** The clip door's sampled bones as a clip, or null when it holds nothing a pose can take. */
export function mixerClip(clip: BlenderActionClip): MixerClip | null {
  if (!clip.action || clip.clipStart === undefined || clip.clipEnd === undefined || !clip.bones?.length) return null;
  const column = (c: BlenderClipColumn): Float32Array => float32Of(c.base64);
  const bones = new Map<string, ClipBone>(clip.bones.map((bone) => [bone.bone, {
    keys: bone.keys, position: column(bone.position), quaternion: column(bone.quaternion), scale: column(bone.scale),
  }]));
  const unsupported = new Set<string>();
  for (const track of clip.tracks) for (const thing of track.unsupported ?? []) unsupported.add(`${clip.action}'s ${thing}`);
  for (const thing of clip.unsupported ?? []) unsupported.add(`${clip.action}'s ${thing}`);
  return {
    action: clip.action, start: clip.clipStart, end: clip.clipEnd, fps: clip.fps || 24,
    keysStart: clip.keysStart === null ? -Infinity : clip.keysStart ?? clip.clipStart,
    keysEnd: clip.keysEnd === null ? Infinity : clip.keysEnd ?? clip.clipEnd,
    cyclic: clip.cyclic ?? false, bones, unsupported: [...unsupported],
  };
}

/** One layer of the stack: an action at a frame of its own, an influence, a blend type. */
export interface MixerLayer {
  readonly clip: MixerClip;
  readonly frame: number;
  readonly influence: number;
  readonly blend: string;
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

const ADDITIVE = new Set(['ADD', 'COMBINE']);
const PLAYED_BLENDS = new Set(['REPLACE', 'ADD', 'COMBINE']);
const TRACK_VECTORS: Record<string, readonly [number, number, number]> = {
  TRACK_X: [1, 0, 0], TRACK_Y: [0, 1, 0], TRACK_Z: [0, 0, 1],
  TRACK_NEGATIVE_X: [-1, 0, 0], TRACK_NEGATIVE_Y: [0, -1, 0], TRACK_NEGATIVE_Z: [0, 0, -1],
};

const matrixOf = (rows: readonly (readonly number[])[]): THREE.Matrix4 =>
  new THREE.Matrix4().set(...(rows.flat() as Parameters<THREE.Matrix4['set']>));

/** A bone's channels as its basis matrix (location, rotation by its mode, scale). */
function basisOf(channels: NonNullable<BlenderArmatureBone['channels']> | undefined): THREE.Matrix4 {
  if (!channels) return new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  if (channels.mode === 'QUATERNION') {
    const [w, x, y, z] = channels.rotation_quaternion;
    rotation.set(x!, y!, z!, w!).normalize();
  } else if (channels.mode === 'AXIS_ANGLE') {
    const [angle, x, y, z] = channels.rotation_axis_angle;
    const axis = new THREE.Vector3(x, y, z);
    rotation.setFromAxisAngle(axis.lengthSq() > 0 ? axis.normalize() : new THREE.Vector3(0, 1, 0), angle!);
  } else {
    // Blender's `XYZ` turns about X first; three names an order by its matrix product, reversed.
    const [x, y, z] = channels.rotation_euler;
    rotation.setFromEuler(new THREE.Euler(x, y, z, channels.mode.split('').reverse().join('') as THREE.EulerOrder));
  }
  return new THREE.Matrix4().compose(new THREE.Vector3(...channels.location), rotation, new THREE.Vector3(...channels.scale));
}

const label = (type: string): string =>
  type.toLowerCase().split('_').map((word) => (word === 'ik' ? 'IK' : word[0]!.toUpperCase() + word.slice(1))).join(' ');

/** One armature's bones, posed by the stack: its actions on the scene's mixer, bound to its rig. */
export class MixerPose {
  readonly mixer: THREE.AnimationMixer;
  /** Whether the mixer is the scene's (shared with the other armatures and the movie) or its own. */
  readonly #shared: boolean;
  #armature: BlenderArmature | null = null;
  #bones: readonly BlenderArmatureBone[] = [];
  /** Each bone's local transform with no action on it: its rest, then its own channels. */
  #still = new Map<string, THREE.Matrix4>();
  /** Each bone's local rest (basis identity): what an additive layer adds to. */
  #rest = new Map<string, THREE.Matrix4>();
  /** Clip pieces by clip, then by the bones they hold (a key of sorted names). */
  #pieces = new WeakMap<MixerClip, Map<string, THREE.AnimationClip>>();
  #actions = new Map<THREE.AnimationClip, THREE.AnimationAction>();
  #warned = new Set<string>();
  readonly warnings: string[] = [];

  /** `mixer`: the scene's (`sceneMixer(view).mixer`); absent, the armature gets one of its own. */
  constructor(readonly rig: ArmatureRig, mixer?: THREE.AnimationMixer) {
    this.mixer = mixer ?? new THREE.AnimationMixer(rig.object);
    this.#shared = !!mixer;
  }

  /** Take the frame's facts for this armature (its bones' rest, channels and constraints). */
  facts(armature: BlenderArmature): void {
    if (armature === this.#armature) return;
    const first = this.#armature === null;
    this.#armature = armature;
    this.#bones = armature.bones;
    const rest = new Map(armature.bones.map((bone) => [bone.name, matrixOf(bone.rest ?? bone.matrix)]));
    this.#rest = new Map(armature.bones.map((bone) => {
      const own = rest.get(bone.name)!;
      const parent = bone.parent === null ? undefined : rest.get(bone.parent);
      return [bone.name, parent ? parent.clone().invert().multiply(own) : own.clone()];
    }));
    this.#still = new Map(armature.bones.map((bone) => [bone.name, this.#rest.get(bone.name)!.clone().multiply(basisOf(bone.channels))]));
    // THE MIXER'S ORIGINAL STATE is the still pose: a binding saves the bone's value when it is
    // first played, and blends back to it where the layers' weights fall short of one.
    if (first) this.#placeStill();
  }

  get armature(): BlenderArmature | null {
    return this.#armature;
  }

  #placeStill(): void {
    for (const [name, matrix] of this.#still) {
      const bone = this.rig.bones.get(name);
      if (bone) matrix.decompose(bone.position, bone.quaternion, bone.scale);
    }
  }

  /** What this armature does in Blender that a game does not play, each named once. */
  unsupported(): string[] {
    const out: string[] = [];
    for (const bone of this.#bones) {
      for (const constraint of bone.constraints ?? [])
        if (constraint.enabled && constraint.type !== 'DAMPED_TRACK') out.push(`the ${label(constraint.type)} constraint "${constraint.name}" on bone "${bone.name}"`);
      if (bone.inherit?.length) out.push(`bone "${bone.name}"'s parenting (${bone.inherit.join(', ')})`);
    }
    for (const bone of this.#armature?.animation?.drivers ?? []) out.push(`the drivers on bone "${bone}"`);
    if (this.#armature?.animation?.tweak) out.push('the NLA in tweak mode (leave it with Tab in the NLA editor)');
    for (const track of this.#armature?.animation?.tracks ?? [])
      for (const strip of track.strips)
        if (!strip.mute && strip.animatedTime) out.push(`the animated strip time of "${strip.name}"`);
    return out;
  }

  /** A piece of a clip holding only `bones`, as a three.js clip on this rig's bones. */
  #piece(clip: MixerClip, bones: readonly string[], additive: boolean): THREE.AnimationClip {
    let byKey = this.#pieces.get(clip);
    if (!byKey) this.#pieces.set(clip, byKey = new Map());
    const key = `${additive ? '+' : '='}${bones.join('\u0000')}`;
    const found = byKey.get(key);
    if (found) return found;
    const frames = Math.max(1, Math.round(clip.end - clip.start) + 1);
    const times = Float32Array.from({ length: frames }, (_, i) => i / clip.fps);
    const tracks: THREE.KeyframeTrack[] = [];
    for (const name of bones) {
      const sampled = clip.bones.get(name);
      const bone = this.rig.bones.get(name);
      if (!sampled || !bone) continue;
      const column = (values: Float32Array, stride: number): { times: Float32Array; values: Float32Array } =>
        values.length === stride ? { times: new Float32Array([0]), values } : { times: times.slice(0, values.length / stride), values };
      const p = column(sampled.position, 3);
      const q = column(sampled.quaternion, 4);
      const s = column(sampled.scale, 3);
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.uuid}.position`, p.times, p.values));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, q.times, q.values));
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.uuid}.scale`, s.times, s.values));
    }
    let made = new THREE.AnimationClip(`${clip.action}${key}`, (frames - 1) / clip.fps, tracks);
    if (additive) {
      // ADDED TO THE BONE'S REST: the reference is each bone at its rest (basis identity).
      const reference: THREE.KeyframeTrack[] = [];
      const [p, q, s] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
      for (const name of bones) {
        const bone = this.rig.bones.get(name);
        const rest = this.#rest.get(name);
        if (!bone || !rest || !clip.bones.has(name)) continue;
        rest.decompose(p, q, s);
        reference.push(new THREE.VectorKeyframeTrack(`${bone.uuid}.position`, [0], p.toArray()));
        reference.push(new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, [0], q.toArray()));
        reference.push(new THREE.VectorKeyframeTrack(`${bone.uuid}.scale`, [0], s.toArray()));
      }
      made = THREE.AnimationUtils.makeClipAdditive(made, 0, new THREE.AnimationClip('rest', 0, reference));
    }
    byKey.set(key, made);
    return made;
  }

  #action(clip: THREE.AnimationClip, additive: boolean): THREE.AnimationAction {
    let action = this.#actions.get(clip);
    if (!action) {
      action = this.mixer.clipAction(clip, this.rig.object, additive ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = 0;
      this.#actions.set(clip, action);
    }
    return action;
  }

  /**
   * Pose the bones from these layers (bottom to top) and the constraints, at once: `place`, the
   * mixer's evaluation, `settle`. Answers each bone's pose in the armature's space. On the scene's
   * mixer, place every armature first and evaluate once (`blender-scene-mixer.ts`).
   */
  apply(layers: readonly MixerLayer[], world: ConstraintWorld): Map<string, THREE.Matrix4> {
    this.place(layers);
    this.mixer.update(0);
    return this.settle(world);
  }

  /** SET THE ACTIONS for these layers (bottom to top): their times and weights; nothing moves until
   *  the mixer evaluates. The actions no layer uses now stop. */
  place(layers: readonly MixerLayer[]): void {
    const used = new Set<THREE.AnimationAction>();
    layers.forEach((layer, index) => {
      const influence = Math.max(0, Math.min(1, layer.influence));
      if (influence <= 0) return;
      if (!PLAYED_BLENDS.has(layer.blend)) {
        const said = `the ${layer.blend.toLowerCase()} blend of "${layer.clip.action}" (played as Replace)`;
        if (!this.#warned.has(said)) { this.#warned.add(said); this.warnings.push(said); }
      }
      const additive = ADDITIVE.has(layer.blend);
      const time = Math.max(0, Math.min(layer.clip.end, layer.frame) - layer.clip.start) / layer.clip.fps;
      // EACH BONE'S WEIGHT under the replacing layers above it that animate that bone.
      const groups = new Map<string, { bones: string[]; weight: number }>();
      for (const bone of layer.clip.bones.keys()) {
        let weight = influence;
        let key = '';
        if (!additive) {
          for (let above = index + 1; above < layers.length; above++) {
            const upper = layers[above]!;
            if (ADDITIVE.has(upper.blend) || !upper.clip.bones.has(bone)) continue;
            weight *= 1 - Math.max(0, Math.min(1, upper.influence));
            key += `${above},`;
          }
        }
        const group = groups.get(key);
        if (group) group.bones.push(bone);
        else groups.set(key, { bones: [bone], weight });
      }
      for (const group of groups.values()) {
        if (group.weight <= 0) continue;
        const action = this.#action(this.#piece(layer.clip, group.bones, additive), additive);
        if (!action.isRunning()) action.play();
        action.paused = false;
        action.time = time;
        action.setEffectiveWeight(group.weight);
        used.add(action);
      }
    });
    for (const action of this.#actions.values()) if (!used.has(action) && action.isScheduled()) action.stop();
  }

  /** AFTER THE MIXER: the constraints, then each bone's pose in the armature's space. */
  settle(world: ConstraintWorld): Map<string, THREE.Matrix4> {
    this.rig.object.updateMatrixWorld(true);
    this.#constraints(world);
    return this.#poses();
  }

  /** DAMPED TRACK, after the mixer, parents first: the bone turned by the smallest rotation that
   *  points its track axis at the target, at the constraint's influence. */
  #constraints(world: ConstraintWorld): void {
    const [position, rotation, size] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
    for (const declared of this.#bones) {
      for (const constraint of declared.constraints ?? []) {
        if (!constraint.enabled || constraint.type !== 'DAMPED_TRACK') continue;
        const change = world.override?.(declared.name, constraint.name);
        const influence = change?.influence ?? constraint.influence;
        const bone = this.rig.bones.get(declared.name);
        if (influence <= 0 || !bone) continue;
        const target = this.#target(constraint, change, world);
        if (!target) continue;
        bone.matrixWorld.decompose(position, rotation, size);
        const axis = new THREE.Vector3(...(TRACK_VECTORS[constraint.trackAxis ?? 'TRACK_Y'] ?? TRACK_VECTORS['TRACK_Y']!)).applyQuaternion(rotation).normalize();
        const toward = target.clone().sub(position);
        if (toward.lengthSq() === 0) continue;
        const turn = new THREE.Quaternion().setFromUnitVectors(axis, toward.normalize());
        const taken = new THREE.Quaternion().slerp(turn, Math.min(1, influence));
        const turnedWorld = new THREE.Matrix4().compose(position, taken.multiply(rotation), size);
        const parentWorld = bone.parent ? bone.parent.matrixWorld : new THREE.Matrix4();
        parentWorld.clone().invert().multiply(turnedWorld).decompose(bone.position, bone.quaternion, bone.scale);
        bone.updateMatrixWorld(true);
      }
    }
  }

  /** A constraint's target point in world space: an object's origin, or a point along a bone. */
  #target(constraint: NonNullable<BlenderArmatureBone['constraints']>[number], change: ConstraintOverride | undefined,
    world: ConstraintWorld): THREE.Vector3 | null {
    if (change?.target) {
      change.target.updateWorldMatrix(true, false);
      return new THREE.Vector3().setFromMatrixPosition(change.target.matrixWorld);
    }
    if (change?.target === null || !constraint.target) return null;
    if (constraint.subtarget && constraint.target === this.rig.armature) {
      const bone = this.rig.bones.get(constraint.subtarget);
      const declared = this.#bones.find((one) => one.name === constraint.subtarget);
      if (!bone || !declared) return null;
      return new THREE.Vector3(0, declared.length * (constraint.headTail ?? 0), 0).applyMatrix4(bone.matrixWorld);
    }
    const object = world.object(constraint.target);
    if (!object) return null;
    object.updateWorldMatrix(true, false);
    const presented = constraint.subtarget ? object.getObjectByName(constraint.subtarget) : object;
    return presented ? new THREE.Vector3().setFromMatrixPosition(presented.matrixWorld) : null;
  }

  /** Each bone's pose in the armature object's space. */
  #poses(): Map<string, THREE.Matrix4> {
    const toArmature = this.rig.object.matrixWorld.clone().invert();
    const poses = new Map<string, THREE.Matrix4>();
    for (const [name, bone] of this.rig.bones) poses.set(name, toArmature.clone().multiply(bone.matrixWorld));
    return poses;
  }

  /** Its actions off the mixer (only its own: on the scene's, the others play on). */
  dispose(): void {
    for (const [clip, action] of this.#actions) {
      action.stop();
      this.mixer.uncacheAction(clip, this.rig.object);
      this.mixer.uncacheClip(clip);
    }
    if (!this.#shared) this.mixer.stopAllAction();
    this.#actions.clear();
  }
}

/**
 * THE FIDELITY CHECK: how far a played pose is from Blender's own at the same frame (the frame's
 * `PoseBone.matrix`). Answers the bone that is furthest off, or null when every bone is within a
 * degree and a hundredth of its length (three.js interpolates between Blender's frames).
 */
export function poseDivergence(played: ReadonlyMap<string, THREE.Matrix4>, armature: BlenderArmature):
  { bone: string; degrees: number; offset: number } | null {
  let worst: { bone: string; degrees: number; offset: number; score: number } | null = null;
  const [p0, q0, s0, p1, q1, s1] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
  for (const bone of armature.bones) {
    const ours = played.get(bone.name);
    if (!ours) continue;
    ours.decompose(p0, q0, s0);
    matrixOf(bone.matrix).decompose(p1, q1, s1);
    const degrees = THREE.MathUtils.radToDeg(q0.angleTo(q1));
    const offset = p0.distanceTo(p1) / Math.max(bone.length, 0.1);
    const score = Math.max(degrees / 1, offset / 1e-2);
    if (score > 1 && (!worst || score > worst.score)) worst = { bone: bone.name, degrees, offset, score };
  }
  return worst && { bone: worst.bone, degrees: worst.degrees, offset: worst.offset };
}
