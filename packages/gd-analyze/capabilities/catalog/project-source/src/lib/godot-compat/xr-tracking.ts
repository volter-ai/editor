/** Godot XR hand/body/face tracker Resources and native Three modifier bindings. */
import { Matrix4, Object3D, SkinnedMesh, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';
import { packedFloat32Array, type PackedFloat32Array } from './packed-array';
import {
  GodotXRPositionalTracker,
  GodotXRTracker,
  XRServer,
  XR_TRACKER_BODY,
  XR_TRACKER_FACE,
  XR_TRACKER_HAND,
} from './xr-runtime';

export const XR_HAND_TRACKING_SOURCE_UNKNOWN = 0;
export const XR_HAND_TRACKING_SOURCE_UNOBSTRUCTED = 1;
export const XR_HAND_TRACKING_SOURCE_CONTROLLER = 2;
export const XR_HAND_TRACKING_SOURCE_NOT_TRACKED = 3;
export const XR_HAND_TRACKING_SOURCE_MAX = 4;
export const XR_HAND_JOINT_MAX = 26;
export const XR_BODY_JOINT_MAX = 87;
export const XR_FACE_BLEND_SHAPE_MAX = 143;
export const XR_JOINT_ORIENTATION_VALID = 1;
export const XR_JOINT_ORIENTATION_TRACKED = 2;
export const XR_JOINT_POSITION_VALID = 4;
export const XR_JOINT_POSITION_TRACKED = 8;
export const XR_HAND_JOINT_LINEAR_VELOCITY_VALID = 16;
export const XR_HAND_JOINT_ANGULAR_VELOCITY_VALID = 32;
export const XR_BODY_FLAG_UPPER_BODY_SUPPORTED = 1;
export const XR_BODY_FLAG_LOWER_BODY_SUPPORTED = 2;
export const XR_BODY_FLAG_HANDS_SUPPORTED = 4;
export const XR_BODY_UPDATE_UPPER_BODY = 1;
export const XR_BODY_UPDATE_LOWER_BODY = 2;
export const XR_BODY_UPDATE_HANDS = 4;
export const XR_BONE_UPDATE_FULL = 0;
export const XR_BONE_UPDATE_ROTATION_ONLY = 1;

const HAND_JOINT_NAMES = [
  'palm', 'wrist',
  'thumb_metacarpal', 'thumb_phalanx_proximal', 'thumb_phalanx_distal', 'thumb_tip',
  'index_finger_metacarpal', 'index_finger_phalanx_proximal',
  'index_finger_phalanx_intermediate', 'index_finger_phalanx_distal', 'index_finger_tip',
  'middle_finger_metacarpal', 'middle_finger_phalanx_proximal',
  'middle_finger_phalanx_intermediate', 'middle_finger_phalanx_distal', 'middle_finger_tip',
  'ring_finger_metacarpal', 'ring_finger_phalanx_proximal',
  'ring_finger_phalanx_intermediate', 'ring_finger_phalanx_distal', 'ring_finger_tip',
  'pinky_finger_metacarpal', 'pinky_finger_phalanx_proximal',
  'pinky_finger_phalanx_intermediate', 'pinky_finger_phalanx_distal', 'pinky_finger_tip',
] as const;

const BODY_JOINT_NAMES = [
  'root', 'hips', 'spine', 'chest', 'upper_chest', 'neck', 'head', 'head_tip',
  'left_shoulder', 'left_upper_arm', 'left_lower_arm',
  'right_shoulder', 'right_upper_arm', 'right_lower_arm',
  'left_upper_leg', 'left_lower_leg', 'left_foot', 'left_toes',
  'right_upper_leg', 'right_lower_leg', 'right_foot', 'right_toes',
  'left_hand', 'left_palm', 'left_wrist',
  'left_thumb_metacarpal', 'left_thumb_phalanx_proximal', 'left_thumb_phalanx_distal',
  'left_thumb_tip', 'left_index_finger_metacarpal', 'left_index_finger_phalanx_proximal',
  'left_index_finger_phalanx_intermediate', 'left_index_finger_phalanx_distal',
  'left_index_finger_tip', 'left_middle_finger_metacarpal',
  'left_middle_finger_phalanx_proximal', 'left_middle_finger_phalanx_intermediate',
  'left_middle_finger_phalanx_distal', 'left_middle_finger_tip', 'left_ring_finger_metacarpal',
  'left_ring_finger_phalanx_proximal', 'left_ring_finger_phalanx_intermediate',
  'left_ring_finger_phalanx_distal', 'left_ring_finger_tip', 'left_pinky_finger_metacarpal',
  'left_pinky_finger_phalanx_proximal', 'left_pinky_finger_phalanx_intermediate',
  'left_pinky_finger_phalanx_distal', 'left_pinky_finger_tip',
  'right_hand', 'right_palm', 'right_wrist',
  'right_thumb_metacarpal', 'right_thumb_phalanx_proximal', 'right_thumb_phalanx_distal',
  'right_thumb_tip', 'right_index_finger_metacarpal', 'right_index_finger_phalanx_proximal',
  'right_index_finger_phalanx_intermediate', 'right_index_finger_phalanx_distal',
  'right_index_finger_tip', 'right_middle_finger_metacarpal',
  'right_middle_finger_phalanx_proximal', 'right_middle_finger_phalanx_intermediate',
  'right_middle_finger_phalanx_distal', 'right_middle_finger_tip', 'right_ring_finger_metacarpal',
  'right_ring_finger_phalanx_proximal', 'right_ring_finger_phalanx_intermediate',
  'right_ring_finger_phalanx_distal', 'right_ring_finger_tip', 'right_pinky_finger_metacarpal',
  'right_pinky_finger_phalanx_proximal', 'right_pinky_finger_phalanx_intermediate',
  'right_pinky_finger_phalanx_distal', 'right_pinky_finger_tip',
  'lower_chest', 'left_scapula', 'left_wrist_twist', 'right_scapula', 'right_wrist_twist',
  'left_foot_twist', 'left_heel', 'left_middle_foot', 'right_foot_twist', 'right_heel',
  'right_middle_foot',
] as const;

function joint(index: number, count: number, owner: string): number {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new RangeError(`${owner} joint must be in 0..${count - 1}.`);
  }
  return index;
}

function jointFlags(flags: number, mask: number, owner: string): number {
  if (!Number.isInteger(flags) || flags < 0 || (flags & ~mask) !== 0) {
    throw new RangeError(`${owner} received invalid joint flags ${String(flags)}.`);
  }
  return flags;
}

function transform(value: Matrix4, owner: string): Matrix4 {
  if (!(value instanceof Matrix4)) throw new TypeError(`${owner} requires Transform3D.`);
  return value.clone();
}

function vector(value: Vector3, owner: string): Vector3 {
  if (!(value instanceof Vector3)) throw new TypeError(`${owner} requires Vector3.`);
  return value.clone();
}

export class GodotXRHandTracker extends GodotXRPositionalTracker {
  private trackingData = false;
  private trackingSource = XR_HAND_TRACKING_SOURCE_UNKNOWN;
  private readonly flags = new Uint8Array(XR_HAND_JOINT_MAX);
  private readonly transforms = Array.from({ length: XR_HAND_JOINT_MAX }, () => new Matrix4());
  private readonly radii = new Float32Array(XR_HAND_JOINT_MAX);
  private readonly linearVelocities = Array.from({ length: XR_HAND_JOINT_MAX }, () => new Vector3());
  private readonly angularVelocities = Array.from({ length: XR_HAND_JOINT_MAX }, () => new Vector3());

  constructor() {
    super('XRHandTracker');
    this.set_tracker_type(XR_TRACKER_HAND);
  }

  set_has_tracking_data(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('XRHandTracker.has_tracking_data requires bool.');
    this.trackingData = value;
  }
  get_has_tracking_data(): boolean { return this.trackingData; }
  set_hand_tracking_source(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value >= XR_HAND_TRACKING_SOURCE_MAX) {
      throw new RangeError('XRHandTracker.hand_tracking_source received an invalid source.');
    }
    this.trackingSource = value;
  }
  get_hand_tracking_source(): number { return this.trackingSource; }
  set_hand_joint_flags(index: number, value: number): void {
    this.flags[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')] =
      jointFlags(value, 63, 'XRHandTracker.set_hand_joint_flags');
  }
  get_hand_joint_flags(index: number): number {
    return this.flags[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')] ?? 0;
  }
  set_hand_joint_transform(index: number, value: Matrix4): void {
    this.transforms[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')]
      ?.copy(transform(value, 'XRHandTracker.set_hand_joint_transform'));
  }
  get_hand_joint_transform(index: number): Matrix4 {
    return this.transforms[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')]!.clone();
  }
  set_hand_joint_radius(index: number, value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('XRHandTracker joint radius must be non-negative.');
    this.radii[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')] = value;
  }
  get_hand_joint_radius(index: number): number {
    return this.radii[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')] ?? 0;
  }
  set_hand_joint_linear_velocity(index: number, value: Vector3): void {
    this.linearVelocities[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')]
      ?.copy(vector(value, 'XRHandTracker.set_hand_joint_linear_velocity'));
  }
  get_hand_joint_linear_velocity(index: number): Vector3 {
    return this.linearVelocities[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')]!.clone();
  }
  set_hand_joint_angular_velocity(index: number, value: Vector3): void {
    this.angularVelocities[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')]
      ?.copy(vector(value, 'XRHandTracker.set_hand_joint_angular_velocity'));
  }
  get_hand_joint_angular_velocity(index: number): Vector3 {
    return this.angularVelocities[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')]!.clone();
  }
}

export function createGodotXRHandTracker(): GodotXRHandTracker { return new GodotXRHandTracker(); }

export class GodotXRBodyTracker extends GodotXRTracker {
  private trackingData = false;
  private bodyFlags = 0;
  private readonly flags = new Uint8Array(XR_BODY_JOINT_MAX);
  private readonly transforms = Array.from({ length: XR_BODY_JOINT_MAX }, () => new Matrix4());

  constructor() {
    super('XRBodyTracker');
    this.set_tracker_type(XR_TRACKER_BODY);
  }

  set_has_tracking_data(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('XRBodyTracker.has_tracking_data requires bool.');
    this.trackingData = value;
  }
  get_has_tracking_data(): boolean { return this.trackingData; }
  set_body_flags(value: number): void {
    if (!Number.isInteger(value) || value < 0 || (value & ~7) !== 0) {
      throw new RangeError('XRBodyTracker.body_flags requires a BodyFlags mask.');
    }
    this.bodyFlags = value;
  }
  get_body_flags(): number { return this.bodyFlags; }
  set_joint_flags(index: number, value: number): void {
    this.flags[joint(index, XR_BODY_JOINT_MAX, 'XRBodyTracker')] =
      jointFlags(value, 15, 'XRBodyTracker.set_joint_flags');
  }
  get_joint_flags(index: number): number {
    return this.flags[joint(index, XR_BODY_JOINT_MAX, 'XRBodyTracker')] ?? 0;
  }
  set_joint_transform(index: number, value: Matrix4): void {
    this.transforms[joint(index, XR_BODY_JOINT_MAX, 'XRBodyTracker')]
      ?.copy(transform(value, 'XRBodyTracker.set_joint_transform'));
  }
  get_joint_transform(index: number): Matrix4 {
    return this.transforms[joint(index, XR_BODY_JOINT_MAX, 'XRBodyTracker')]!.clone();
  }
}

export function createGodotXRBodyTracker(): GodotXRBodyTracker { return new GodotXRBodyTracker(); }

export class GodotXRFaceTracker extends GodotXRTracker {
  private weights = new Float32Array(XR_FACE_BLEND_SHAPE_MAX);

  constructor() {
    super('XRFaceTracker');
    this.set_tracker_type(XR_TRACKER_FACE);
  }

  get_blend_shape(index: number): number {
    return this.weights[joint(index, XR_FACE_BLEND_SHAPE_MAX, 'XRFaceTracker')] ?? 0;
  }
  set_blend_shape(index: number, weight: number): void {
    if (!Number.isFinite(weight)) throw new TypeError('XRFaceTracker blend-shape weight must be finite.');
    this.weights[joint(index, XR_FACE_BLEND_SHAPE_MAX, 'XRFaceTracker')] = weight;
  }
  get_blend_shapes(): PackedFloat32Array { return packedFloat32Array(this.weights); }
  set_blend_shapes(weights: Iterable<number>): void {
    const values = [...weights];
    if (values.length !== XR_FACE_BLEND_SHAPE_MAX) {
      throw new RangeError(`XRFaceTracker.blend_shapes requires exactly ${XR_FACE_BLEND_SHAPE_MAX} weights.`);
    }
    if (values.some((value) => !Number.isFinite(value))) {
      throw new TypeError('XRFaceTracker.blend_shapes requires finite weights.');
    }
    this.weights = Float32Array.from(values);
  }
}

export function createGodotXRFaceTracker(): GodotXRFaceTracker { return new GodotXRFaceTracker(); }

interface HandModifierState {
  tracker: string;
  boneUpdate: number;
  readonly bones: ReadonlyMap<number, Object3D>;
}

const handModifiers = new WeakMap<Object3D, HandModifierState>();

export function createGodotXRHandModifier3D(
  bones: ReadonlyMap<number, Object3D> = new Map(),
): Object3D {
  const node = new Object3D();
  bindGodotXRHandModifier3D(node, bones);
  return node;
}

export function bindGodotXRHandModifier3D(
  node: Object3D,
  bones: ReadonlyMap<number, Object3D>,
  tracker = '/user/hand_left',
): void {
  handModifiers.set(node, { tracker, boneUpdate: XR_BONE_UPDATE_FULL, bones });
  registerGodotObjectIdentity(node, 'XRHandModifier3D');
}
export function setGodotXRHandModifierTracker(node: Object3D, value: string): void {
  const state = requireHandModifier(node);
  state.tracker = String(value);
}
export function getGodotXRHandModifierTracker(node: Object3D): string {
  return requireHandModifier(node).tracker;
}
export function setGodotXRHandModifierBoneUpdate(node: Object3D, value: number): void {
  if (value !== 0 && value !== 1) throw new RangeError('XRHandModifier3D.bone_update requires FULL or ROTATION_ONLY.');
  requireHandModifier(node).boneUpdate = value;
}
export function getGodotXRHandModifierBoneUpdate(node: Object3D): number {
  return requireHandModifier(node).boneUpdate;
}
export function updateGodotXRHandModifier3D(node: Object3D): void {
  const state = requireHandModifier(node);
  const tracker = XRServer.get_tracker(state.tracker);
  if (!(tracker instanceof GodotXRHandTracker) || !tracker.get_has_tracking_data()) return;
  for (const [index, bone] of state.bones) {
    const flags = tracker.get_hand_joint_flags(index);
    if ((flags & XR_JOINT_ORIENTATION_VALID) === 0) continue;
    const pose = tracker.get_hand_joint_transform(index);
    if (state.boneUpdate === XR_BONE_UPDATE_ROTATION_ONLY) {
      pose.decompose(new Vector3(), bone.quaternion, new Vector3());
    } else {
      pose.decompose(bone.position, bone.quaternion, bone.scale);
    }
    bone.updateMatrix();
    bone.matrixWorldNeedsUpdate = true;
  }
}
function requireHandModifier(node: Object3D): HandModifierState {
  const state = handModifiers.get(node);
  if (state === undefined) throw new Error('XRHandModifier3D requires bindGodotXRHandModifier3D first.');
  return state;
}

interface BodyModifierState {
  tracker: string;
  bodyUpdate: number;
  boneUpdate: number;
  readonly bones: ReadonlyMap<number, Object3D>;
}
const bodyModifiers = new WeakMap<Object3D, BodyModifierState>();

export function createGodotXRBodyModifier3D(
  bones: ReadonlyMap<number, Object3D> = new Map(),
): Object3D {
  const node = new Object3D();
  bindGodotXRBodyModifier3D(node, bones);
  return node;
}

export function bindGodotXRBodyModifier3D(
  node: Object3D,
  bones: ReadonlyMap<number, Object3D>,
  tracker = '/user/body_tracker',
): void {
  bodyModifiers.set(node, {
    tracker, bodyUpdate: XR_BODY_UPDATE_UPPER_BODY | XR_BODY_UPDATE_LOWER_BODY | XR_BODY_UPDATE_HANDS,
    boneUpdate: XR_BONE_UPDATE_FULL, bones,
  });
  registerGodotObjectIdentity(node, 'XRBodyModifier3D');
}
export function setGodotXRBodyModifierTracker(node: Object3D, value: string): void {
  requireBodyModifier(node).tracker = String(value);
}
export function getGodotXRBodyModifierTracker(node: Object3D): string {
  return requireBodyModifier(node).tracker;
}
export function setGodotXRBodyModifierBodyUpdate(node: Object3D, value: number): void {
  if (!Number.isInteger(value) || value < 0 || (value & ~7) !== 0) {
    throw new RangeError('XRBodyModifier3D.body_update requires a BodyUpdate mask.');
  }
  requireBodyModifier(node).bodyUpdate = value;
}
export function getGodotXRBodyModifierBodyUpdate(node: Object3D): number {
  return requireBodyModifier(node).bodyUpdate;
}
export function setGodotXRBodyModifierBoneUpdate(node: Object3D, value: number): void {
  if (value !== 0 && value !== 1) throw new RangeError('XRBodyModifier3D.bone_update requires FULL or ROTATION_ONLY.');
  requireBodyModifier(node).boneUpdate = value;
}
export function getGodotXRBodyModifierBoneUpdate(node: Object3D): number {
  return requireBodyModifier(node).boneUpdate;
}
export function updateGodotXRBodyModifier3D(node: Object3D): void {
  const state = requireBodyModifier(node);
  const tracker = XRServer.get_tracker(state.tracker);
  if (!(tracker instanceof GodotXRBodyTracker) || !tracker.get_has_tracking_data()) return;
  for (const [index, bone] of state.bones) {
    if (!bodyUpdateIncludes(index, state.bodyUpdate)) continue;
    const flags = tracker.get_joint_flags(index);
    if ((flags & XR_JOINT_ORIENTATION_VALID) === 0) continue;
    const pose = tracker.get_joint_transform(index);
    if (state.boneUpdate === XR_BONE_UPDATE_ROTATION_ONLY) {
      pose.decompose(new Vector3(), bone.quaternion, new Vector3());
    } else {
      pose.decompose(bone.position, bone.quaternion, bone.scale);
    }
    bone.updateMatrix();
    bone.matrixWorldNeedsUpdate = true;
  }
}
function bodyUpdateIncludes(index: number, mask: number): boolean {
  const name = BODY_JOINT_NAMES[index] ?? '';
  if (name.includes('hand') || name.includes('wrist') || name.includes('finger') || name.includes('thumb')) {
    return (mask & XR_BODY_UPDATE_HANDS) !== 0;
  }
  if (name.includes('leg') || name.includes('foot') || name.includes('heel') || name === 'hips' || name === 'root') {
    return (mask & XR_BODY_UPDATE_LOWER_BODY) !== 0;
  }
  return (mask & XR_BODY_UPDATE_UPPER_BODY) !== 0;
}
function requireBodyModifier(node: Object3D): BodyModifierState {
  const state = bodyModifiers.get(node);
  if (state === undefined) throw new Error('XRBodyModifier3D requires bindGodotXRBodyModifier3D first.');
  return state;
}

interface FaceModifierState {
  tracker: string;
  target: string;
  readonly meshes: readonly SkinnedMesh[];
  readonly blendShapeNames: readonly string[];
}
const faceModifiers = new WeakMap<Object3D, FaceModifierState>();

export function createGodotXRFaceModifier3D(
  meshes: readonly SkinnedMesh[] = [],
  blendShapeNames: readonly string[] = [],
): Object3D {
  const node = new Object3D();
  bindGodotXRFaceModifier3D(node, meshes, blendShapeNames);
  return node;
}

export function bindGodotXRFaceModifier3D(
  node: Object3D,
  meshes: readonly SkinnedMesh[],
  blendShapeNames: readonly string[],
  tracker = '/user/face_tracker',
): void {
  faceModifiers.set(node, { tracker, target: '', meshes, blendShapeNames });
  registerGodotObjectIdentity(node, 'XRFaceModifier3D');
}
export function setGodotXRFaceModifierTracker(node: Object3D, value: string): void {
  requireFaceModifier(node).tracker = String(value);
}
export function getGodotXRFaceModifierTracker(node: Object3D): string {
  return requireFaceModifier(node).tracker;
}
export function setGodotXRFaceModifierTarget(node: Object3D, value: string): void {
  requireFaceModifier(node).target = String(value);
}
export function getGodotXRFaceModifierTarget(node: Object3D): string {
  return requireFaceModifier(node).target;
}
export function updateGodotXRFaceModifier3D(node: Object3D): void {
  const state = requireFaceModifier(node);
  const tracker = XRServer.get_tracker(state.tracker);
  if (!(tracker instanceof GodotXRFaceTracker)) return;
  for (const mesh of state.meshes) {
    if (state.target.length > 0 && mesh.name !== state.target) continue;
    const influences = mesh.morphTargetInfluences;
    const dictionary = mesh.morphTargetDictionary;
    if (influences === undefined || dictionary === undefined) continue;
    state.blendShapeNames.forEach((name, sourceIndex) => {
      const targetIndex = dictionary[name];
      if (targetIndex !== undefined) influences[targetIndex] = tracker.get_blend_shape(sourceIndex);
    });
  }
}
function requireFaceModifier(node: Object3D): FaceModifierState {
  const state = faceModifiers.get(node);
  if (state === undefined) throw new Error('XRFaceModifier3D requires bindGodotXRFaceModifier3D first.');
  return state;
}

export function godotXRHandJointName(index: number): string {
  return HAND_JOINT_NAMES[joint(index, XR_HAND_JOINT_MAX, 'XRHandTracker')] ?? '';
}
export function godotXRBodyJointName(index: number): string {
  return BODY_JOINT_NAMES[joint(index, XR_BODY_JOINT_MAX, 'XRBodyTracker')] ?? '';
}
