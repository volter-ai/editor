/**
 * Godot 3.6/4.7 Skeleton2D + Bone2D over retained Pixi Containers.
 *
 * The source algorithm is `scene/2d/skeleton_2d.cpp`: bones are ordered by tree order,
 * each bind inverse is the inverse accumulated REST transform, and every live skin matrix is
 * accumulated local pose * bind inverse. Polygon2D consumes those matrices at its own retained
 * Pixi Mesh render boundary; this module owns no clock or mirror tree.
 */

import { Container, Matrix, type PointData } from 'pixi.js';
import { createSignal, type GodotSignal, type SignalHandle } from './signal';
import { godotTransform2DCall, godotTransform2DNew, type GodotTransform2D } from './transform-2d';
import { registerGodotObjectIdentity } from './object';
import { bindGodotCanvasNode2DApi, registerCanvasNodeRelease } from './node';

export interface Bone2DOptions {
  readonly major: 3 | 4;
  readonly rest?: GodotTransform2D;
  readonly length?: number;
  readonly boneAngle?: number;
  readonly autocalculateLengthAndAngle?: boolean;
}

interface Bone2DState {
  readonly major: 3 | 4;
  rest: GodotTransform2D;
  length: number;
  boneAngle: number;
  autocalculate: boolean;
  skeleton: GodotSkeleton2D | undefined;
  index: number;
}

interface SkeletonBone {
  readonly node: GodotBone2D;
  readonly parent: number;
  restInverse: GodotTransform2D;
  accumulated: GodotTransform2D;
  final: GodotTransform2D;
}

interface Skeleton2DState {
  readonly major: 3 | 4;
  bones: SkeletonBone[];
  dirtySetup: boolean;
  dirtyTransforms: boolean;
  readonly boneSetupChanged: SignalHandle<readonly []>;
  listened: Container[];
  readonly onChildAdded: () => void;
  readonly onChildRemoved: () => void;
}

export interface GodotBone2DApi {
  rest: GodotTransform2D;
  length: number;
  bone_angle: number;
  autocalculate_length_and_angle: boolean;
  set_rest(value: GodotTransform2D): void;
  get_rest(): GodotTransform2D;
  apply_rest(): void;
  get_skeleton_rest(): GodotTransform2D;
  get_index_in_skeleton(): number;
  set_length(value: number): void;
  get_length(): number;
  set_bone_angle(value: number): void;
  get_bone_angle(): number;
  set_autocalculate_length_and_angle(value: boolean): void;
  get_autocalculate_length_and_angle(): boolean;
  calculate_length_and_rotation(): void;
}

export interface GodotSkeleton2DApi {
  readonly bone_setup_changed: GodotSignal<readonly []>;
  get_bone_count(): number;
  get_bone(index: number): GodotBone2D | null;
}

export type GodotBone2D = Container & GodotBone2DApi;
export type GodotSkeleton2D = Container & GodotSkeleton2DApi;

const BONES = new WeakMap<GodotBone2D, Bone2DState>();
const SKELETONS = new WeakMap<GodotSkeleton2D, Skeleton2DState>();

function finite(value: unknown, member: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${member} requires a finite float.`);
  return value;
}

function bool(value: unknown, member: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${member} requires bool.`);
  return value;
}

function copyTransform(value: GodotTransform2D): GodotTransform2D {
  return godotTransform2DNew(value.x, value.y, value.origin);
}

function boneState(bone: GodotBone2D, member: string): Bone2DState {
  const state = BONES.get(bone);
  if (state === undefined) throw new Error(`${member} requires a retained Bone2D binding.`);
  return state;
}

function skeletonState(skeleton: GodotSkeleton2D, member: string): Skeleton2DState {
  const state = SKELETONS.get(skeleton);
  if (state === undefined) throw new Error(`${member} requires a retained Skeleton2D binding.`);
  return state;
}

function matrixTransform(matrix: Matrix): GodotTransform2D {
  return godotTransform2DNew(
    { x: matrix.a, y: matrix.b },
    { x: matrix.c, y: matrix.d },
    { x: matrix.tx, y: matrix.ty },
  );
}

function localTransform(node: Container): GodotTransform2D {
  return matrixTransform(node.localTransform);
}

function multiply(a: GodotTransform2D, b: GodotTransform2D): GodotTransform2D {
  return godotTransform2DNew(
    {
      x: a.x.x * b.x.x + a.y.x * b.x.y,
      y: a.x.y * b.x.x + a.y.y * b.x.y,
    },
    {
      x: a.x.x * b.y.x + a.y.x * b.y.y,
      y: a.x.y * b.y.x + a.y.y * b.y.y,
    },
    {
      x: a.x.x * b.origin.x + a.y.x * b.origin.y + a.origin.x,
      y: a.x.y * b.origin.x + a.y.y * b.origin.y + a.origin.y,
    },
  );
}

function inverse(value: GodotTransform2D): GodotTransform2D {
  return godotTransform2DCall<GodotTransform2D>(value, 'affine_inverse', []);
}

export function bindGodotBone2D(bone: GodotBone2D, options: Bone2DOptions): GodotBone2D {
  BONES.set(bone, {
    major: options.major,
    rest: copyTransform(options.rest ?? godotTransform2DNew()),
    length: finite(options.length ?? 16, 'Bone2D.length'),
    boneAngle: finite(options.boneAngle ?? 0, 'Bone2D.bone_angle'),
    autocalculate: bool(options.autocalculateLengthAndAngle ?? true, 'Bone2D.autocalculate_length_and_angle'),
    skeleton: undefined,
    index: -1,
  });
  Object.defineProperties(bone, {
    rest: { configurable: true, enumerable: true, get: () => getBone2DRest(bone), set: (value: GodotTransform2D) => setBone2DRest(bone, value) },
    length: { configurable: true, enumerable: true, get: () => getBone2DLength(bone), set: (value: number) => setBone2DLength(bone, value) },
    bone_angle: { configurable: true, enumerable: true, get: () => getBone2DAngle(bone), set: (value: number) => setBone2DAngle(bone, value) },
    autocalculate_length_and_angle: { configurable: true, enumerable: true, get: () => isBone2DAutocalculating(bone), set: (value: boolean) => setBone2DAutocalculate(bone, value) },
  });
  Object.assign(bone, {
    set_rest: (value: GodotTransform2D): void => setBone2DRest(bone, value),
    get_rest: (): GodotTransform2D => getBone2DRest(bone),
    apply_rest: (): void => applyBone2DRest(bone),
    get_skeleton_rest: (): GodotTransform2D => getBone2DSkeletonRest(bone),
    get_index_in_skeleton: (): number => getBone2DIndex(bone),
    set_length: (value: number): void => setBone2DLength(bone, value),
    get_length: (): number => getBone2DLength(bone),
    set_bone_angle: (value: number): void => setBone2DAngle(bone, value),
    get_bone_angle: (): number => getBone2DAngle(bone),
    set_autocalculate_length_and_angle: (value: boolean): void => setBone2DAutocalculate(bone, value),
    get_autocalculate_length_and_angle: (): boolean => isBone2DAutocalculating(bone),
    calculate_length_and_rotation: (): void => calculateBone2DLengthAndAngle(bone),
  } satisfies Partial<GodotBone2DApi>);
  return bone;
}

export function bindGodotSkeleton2D(skeleton: GodotSkeleton2D, major: 3 | 4): GodotSkeleton2D {
  const state: Skeleton2DState = {
    major,
    bones: [],
    dirtySetup: true,
    dirtyTransforms: true,
    boneSetupChanged: createSignal(),
    listened: [],
    onChildAdded: () => { state.dirtySetup = true; },
    onChildRemoved: () => { state.dirtySetup = true; },
  };
  SKELETONS.set(skeleton, state);
  skeleton.on('childAdded', state.onChildAdded);
  skeleton.on('childRemoved', state.onChildRemoved);
  state.listened.push(skeleton);
  Object.defineProperty(skeleton, 'bone_setup_changed', {
    configurable: true,
    enumerable: true,
    get: () => state.boneSetupChanged.signal,
  });
  Object.assign(skeleton, {
    get_bone_count: (): number => getSkeleton2DBoneCount(skeleton),
    get_bone: (index: number): GodotBone2D | null => getSkeleton2DBone(skeleton, index),
  } satisfies Partial<GodotSkeleton2DApi>);
  return skeleton;
}

export function createGodotBone2D(major: 3 | 4): GodotBone2D {
  const bone = bindGodotBone2D(bindGodotCanvasNode2DApi(new Container()) as unknown as GodotBone2D, { major });
  registerGodotObjectIdentity(bone, 'Bone2D');
  registerCanvasNodeRelease(bone, () => releaseGodotBone2D(bone));
  return bone;
}

export function createGodotSkeleton2D(major: 3 | 4): GodotSkeleton2D {
  const skeleton = bindGodotSkeleton2D(bindGodotCanvasNode2DApi(new Container()) as unknown as GodotSkeleton2D, major);
  registerGodotObjectIdentity(skeleton, 'Skeleton2D');
  registerCanvasNodeRelease(skeleton, () => releaseGodotSkeleton2D(skeleton));
  return skeleton;
}

function collectBones(parent: Container, out: Array<{ node: GodotBone2D; parent: number }>, parentIndex: number): void {
  for (const child of parent.children) {
    if (!(child instanceof Container)) continue;
    const bone = child as unknown as GodotBone2D;
    const state = BONES.get(bone);
    if (state === undefined) continue;
    const index = out.length;
    out.push({ node: bone, parent: parentIndex });
    collectBones(bone, out, index);
  }
}

export function refreshGodotSkeleton2D(skeleton: GodotSkeleton2D): void {
  const state = skeletonState(skeleton, 'Skeleton2D.refresh');
  for (const listened of state.listened) {
    listened.off('childAdded', state.onChildAdded);
    listened.off('childRemoved', state.onChildRemoved);
  }
  state.listened = [skeleton];
  skeleton.on('childAdded', state.onChildAdded);
  skeleton.on('childRemoved', state.onChildRemoved);
  const collected: Array<{ node: GodotBone2D; parent: number }> = [];
  collectBones(skeleton, collected, -1);
  for (const old of state.bones) {
    const oldState = BONES.get(old.node);
    if (oldState !== undefined) { oldState.skeleton = undefined; oldState.index = -1; }
  }
  const rests: GodotTransform2D[] = [];
  state.bones = collected.map(({ node, parent }, index) => {
    const bone = boneState(node, 'Skeleton2D bone setup');
    bone.skeleton = skeleton;
    bone.index = index;
    const accumulatedRest = parent < 0 ? copyTransform(bone.rest) : multiply(rests[parent] as GodotTransform2D, bone.rest);
    rests.push(accumulatedRest);
    return {
      node,
      parent,
      restInverse: inverse(accumulatedRest),
      accumulated: godotTransform2DNew(),
      final: godotTransform2DNew(),
    };
  });
  for (const bone of state.bones) {
    bone.node.on('childAdded', state.onChildAdded);
    bone.node.on('childRemoved', state.onChildRemoved);
    state.listened.push(bone.node);
  }
  state.dirtySetup = false;
  state.dirtyTransforms = true;
  updateGodotSkeleton2D(skeleton);
  state.boneSetupChanged.emit();
}

export function updateGodotSkeleton2D(skeleton: GodotSkeleton2D): void {
  const state = skeletonState(skeleton, 'Skeleton2D.update');
  if (state.dirtySetup) { refreshGodotSkeleton2D(skeleton); return; }
  for (let index = 0; index < state.bones.length; index += 1) {
    const bone = state.bones[index] as SkeletonBone;
    const pose = localTransform(bone.node);
    bone.accumulated = bone.parent < 0 ? pose : multiply((state.bones[bone.parent] as SkeletonBone).accumulated, pose);
    bone.final = multiply(bone.accumulated, bone.restInverse);
  }
  state.dirtyTransforms = false;
}

export function markGodotSkeleton2DDirty(bone: GodotBone2D): void {
  const state = boneState(bone, 'Bone2D transform changed');
  if (state.skeleton !== undefined) skeletonState(state.skeleton, 'Bone2D transform changed').dirtyTransforms = true;
}

export function setBone2DRest(bone: GodotBone2D, value: GodotTransform2D): void {
  const state = boneState(bone, 'Bone2D.set_rest');
  state.rest = copyTransform(value);
  if (state.skeleton !== undefined) skeletonState(state.skeleton, 'Bone2D.set_rest').dirtySetup = true;
}

export function getBone2DRest(bone: GodotBone2D): GodotTransform2D { return copyTransform(boneState(bone, 'Bone2D.get_rest').rest); }

export function applyBone2DRest(bone: GodotBone2D): void {
  const rest = boneState(bone, 'Bone2D.apply_rest').rest;
  bone.setFromMatrix(new Matrix(rest.x.x, rest.x.y, rest.y.x, rest.y.y, rest.origin.x, rest.origin.y));
  markGodotSkeleton2DDirty(bone);
}

export function getBone2DSkeletonRest(bone: GodotBone2D): GodotTransform2D {
  const state = boneState(bone, 'Bone2D.get_skeleton_rest');
  const parent = bone.parent;
  if (parent instanceof Container) {
    const parentBone = parent as unknown as GodotBone2D;
    if (BONES.has(parentBone)) return multiply(getBone2DSkeletonRest(parentBone), state.rest);
  }
  return copyTransform(state.rest);
}

export function getBone2DIndex(bone: GodotBone2D): number {
  const state = boneState(bone, 'Bone2D.get_index_in_skeleton');
  if (state.skeleton === undefined) return -1;
  const skeleton = skeletonState(state.skeleton, 'Bone2D.get_index_in_skeleton');
  if (skeleton.dirtySetup) refreshGodotSkeleton2D(state.skeleton);
  return state.index;
}

export function setBone2DLength(bone: GodotBone2D, value: number): void { boneState(bone, 'Bone2D.set_length').length = finite(value, 'Bone2D.length'); }
export function getBone2DLength(bone: GodotBone2D): number { return boneState(bone, 'Bone2D.get_length').length; }
export function setBone2DAngle(bone: GodotBone2D, value: number): void { boneState(bone, 'Bone2D.set_bone_angle').boneAngle = finite(value, 'Bone2D.bone_angle'); }
export function getBone2DAngle(bone: GodotBone2D): number { return boneState(bone, 'Bone2D.get_bone_angle').boneAngle; }

export function calculateBone2DLengthAndAngle(bone: GodotBone2D): void {
  const state = boneState(bone, 'Bone2D.calculate_length_and_rotation');
  const child = bone.children.find((candidate) => candidate instanceof Container && BONES.has(candidate as unknown as GodotBone2D));
  if (!(child instanceof Container)) {
    state.boneAngle = bone.rotation;
    return;
  }
  const point = bone.worldTransform.applyInverse(child.worldTransform.apply({ x: 0, y: 0 }), { x: 0, y: 0 });
  state.length = Math.hypot(point.x, point.y);
  state.boneAngle = Math.atan2(point.y, point.x);
}

export function setBone2DAutocalculate(bone: GodotBone2D, value: boolean): void {
  const state = boneState(bone, 'Bone2D.set_autocalculate_length_and_angle');
  state.autocalculate = bool(value, 'Bone2D.autocalculate_length_and_angle');
  if (state.autocalculate) calculateBone2DLengthAndAngle(bone);
}
export function isBone2DAutocalculating(bone: GodotBone2D): boolean { return boneState(bone, 'Bone2D.get_autocalculate_length_and_angle').autocalculate; }

export function getSkeleton2DBoneCount(skeleton: GodotSkeleton2D): number {
  const state = skeletonState(skeleton, 'Skeleton2D.get_bone_count');
  if (state.dirtySetup) refreshGodotSkeleton2D(skeleton);
  return state.bones.length;
}

export function getSkeleton2DBone(skeleton: GodotSkeleton2D, index: number): GodotBone2D | null {
  if (!Number.isSafeInteger(index)) throw new TypeError('Skeleton2D.get_bone index requires int.');
  const state = skeletonState(skeleton, 'Skeleton2D.get_bone');
  if (state.dirtySetup) refreshGodotSkeleton2D(skeleton);
  return state.bones[index]?.node ?? null;
}

export function skeleton2DBoneSetupChanged(skeleton: GodotSkeleton2D): GodotSignal<readonly []> {
  return skeletonState(skeleton, 'Skeleton2D.bone_setup_changed').boneSetupChanged.signal;
}

export function isGodotSkeleton2D(value: unknown): value is GodotSkeleton2D {
  return value instanceof Container && SKELETONS.has(value as unknown as GodotSkeleton2D);
}

export function skeleton2DFinalTransforms(skeleton: GodotSkeleton2D): readonly GodotTransform2D[] {
  const state = skeletonState(skeleton, 'Skeleton2D skinning');
  if (state.dirtySetup) refreshGodotSkeleton2D(skeleton);
  updateGodotSkeleton2D(skeleton);
  return state.bones.map((bone) => bone.final);
}

export function resolveSkeleton2DBone(skeleton: GodotSkeleton2D, path: string): GodotBone2D | undefined {
  const state = skeletonState(skeleton, 'Skeleton2D bone path');
  if (state.dirtySetup) refreshGodotSkeleton2D(skeleton);
  const parts = path.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.some((part) => part === '..')) throw new Error(`Polygon2D bone path ${path} escapes its Skeleton2D.`);
  let current: Container = skeleton;
  for (const part of parts) {
    const child = current.children.find((candidate) => candidate.name === part);
    if (!(child instanceof Container)) return undefined;
    current = child;
  }
  const bone = current as unknown as GodotBone2D;
  return BONES.has(bone) ? bone : undefined;
}

export function releaseGodotBone2D(bone: GodotBone2D): void {
  const state = BONES.get(bone);
  if (state?.skeleton !== undefined) skeletonState(state.skeleton, 'Bone2D.release').dirtySetup = true;
  BONES.delete(bone);
}

export function releaseGodotSkeleton2D(skeleton: GodotSkeleton2D): void {
  const state = SKELETONS.get(skeleton);
  if (state === undefined) return;
  for (const bone of state.bones) {
    const boneBinding = BONES.get(bone.node);
    if (boneBinding !== undefined) { boneBinding.skeleton = undefined; boneBinding.index = -1; }
  }
  for (const listened of state.listened) {
    listened.off('childAdded', state.onChildAdded);
    listened.off('childRemoved', state.onChildRemoved);
  }
  SKELETONS.delete(skeleton);
}

export function transform2DPoint(value: GodotTransform2D, point: Readonly<PointData>): PointData {
  return {
    x: value.x.x * point.x + value.y.x * point.y + value.origin.x,
    y: value.x.y * point.x + value.y.y * point.y + value.origin.y,
  };
}
