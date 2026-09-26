/**
 * `Skeleton` — a Godot `Skeleton` node's authored bone table, as a `THREE.Skeleton`.
 *
 * A Godot `Skeleton` authors its rig inline: `bones/N/name`, `bones/N/parent`
 * (an index into the same table, `-1` for a root) and `bones/N/rest` (the
 * bone's LOCAL bind transform). This builds the three counterpart — one
 * `THREE.Bone` per entry, parented per `parent`, each at its `rest`, and the
 * `THREE.Skeleton` a `SkinnedMesh` binds to.
 *
 * ## It hands back three's own objects
 *
 * Like the rest of `godot-compat`'s 3D half, this is the return-path helper the
 * no-wrappers rule allows: every field of {@link GodotSkeleton} is a real
 * `THREE.Bone`/`THREE.Skeleton`, and a caller drives them with three's own API
 * from there (`skeleton.calculateInverses()`, `mesh.bind(skeleton)`). It owns no
 * clock and animates nothing — the bones sit at their bind-pose rest, and the
 * lane that MOVES them (the `AnimationTree`/skeletal clips) is a separate one.
 *
 * ## The transform convention is the one every node transform uses
 *
 * A `bones/N/rest` is a Godot `Transform`, whose {@link Transform.basis} is its
 * three COLUMN vectors (`variant-3d.ts`/`spatial.ts`). The bone's local matrix
 * is those columns plus the origin — the exact matrix `spatial.ts`'s
 * `setTransform` builds — decomposed onto the bone's position/quaternion/scale,
 * because three drives a `Bone` (an `Object3D`) from those and would overwrite a
 * matrix written directly on the next `updateMatrix()`.
 *
 * ## Bind pose is identity
 *
 * `new Skeleton(bones)` computes each bone's inverse bind matrix from the bone's
 * world matrix as built here, so binding a mesh whose bones have not moved
 * renders it exactly as its authored geometry — the correctness bar for a rig
 * with no animation applied. A caller that re-parents the bones under a
 * transformed ancestor re-derives the inverses (`skeleton.calculateInverses()`)
 * after the world matrices are current; the identity holds because the mesh's
 * bind matrix and the bones' inverses cancel in the same space.
 */
import { markBuiltInternal } from '@volter/threejs-runtime/adapter/hierarchy-marks';
import { Bone, Matrix4, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three';
import type { Object3D } from 'three';
import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';
import { registerGodotThreeNodeRelease } from './node-3d';
import { godotNodePathNew, type GodotNodePath } from './node-path';
import type { Transform } from './variant-3d';

/** One row of a Godot `Skeleton`'s bone table: `bones/N/{name,parent,rest}`. */
export interface GodotBoneRest {
  /** `bones/N/name`. */
  readonly name: string;
  /** `bones/N/parent` — an index into the SAME table, or `-1` for a root bone. */
  readonly parent: number;
  /** `bones/N/rest` — the bone's LOCAL bind transform (basis columns + origin). */
  readonly rest: Transform;
}

/** A built rig: three's own objects, in the table's own index order. */
export interface GodotSkeleton {
  /** The bones in `bones/N` order, so a `skinIndex` addresses this array directly. */
  readonly bones: Bone[];
  /** The bones whose `parent` is `-1` — the roots to add to the scene graph. */
  readonly roots: Bone[];
  /** The `THREE.Skeleton` a `SkinnedMesh` binds to. */
  readonly skeleton: Skeleton;
  /** Native meshes currently bound to this rig. SkeletonIK solves through the first binding. */
  readonly meshes: Set<SkinnedMesh>;
}

/** Retain the native mesh binding used by SkeletonIK's direct Three solver. */
export function registerGodotSkeletonMesh(rig: GodotSkeleton, mesh: SkinnedMesh): void {
  rig.meshes.add(mesh);
  registerGodotThreeNodeRelease(mesh, () => rig.meshes.delete(mesh));
}

interface BoneAttachmentState {
  readonly rig: GodotSkeleton | null;
  boneName: string;
}

const BONE_ATTACHMENTS = new WeakMap<Object3D, BoneAttachmentState>();
const ATTACHMENT_LOCAL = new Matrix4();
const ATTACHMENT_PARENT_INVERSE = new Matrix4();

function attachmentBone(state: BoneAttachmentState): Bone | null {
  if (state.rig === null || state.boneName.length === 0) return null;
  return state.rig.bones.find((bone) => bone.name === state.boneName) ?? null;
}

/**
 * Retain Godot 3 `BoneAttachment` against its direct parent Skeleton rig when it has one.
 *
 * Godot overwrites the attachment's transform from the selected bone pose. The Three object stays
 * in the authored Node hierarchy (rather than being reparented below the built Bone), and
 * {@link syncGodotBoneAttachment3D} converts that bone's world pose back into the attachment
 * parent's local space. That preserves both Godot's logical parent and its rendered pose. An
 * orphan attachment or an unknown/empty bone name remains unbound, matching `_check_bind()`.
 */
export function bindGodotBoneAttachment3D(
  attachment: Object3D,
  rig: GodotSkeleton | null,
  boneName = '',
): Object3D {
  const state: BoneAttachmentState = { rig, boneName };
  BONE_ATTACHMENTS.set(attachment, state);
  registerGodotThreeNodeRelease(attachment, () => BONE_ATTACHMENTS.delete(attachment));
  syncGodotBoneAttachment3D(attachment);
  return attachment;
}

export function getGodotBoneAttachmentName3D(attachment: Object3D): string {
  const state = BONE_ATTACHMENTS.get(attachment);
  if (state === undefined) throw new Error('BoneAttachment is not bound to a retained Skeleton rig.');
  return state.boneName;
}

export function setGodotBoneAttachmentName3D(attachment: Object3D, boneName: string): void {
  const state = BONE_ATTACHMENTS.get(attachment);
  if (state === undefined) throw new Error('BoneAttachment is not bound to a retained Skeleton rig.');
  state.boneName = String(boneName);
  syncGodotBoneAttachment3D(attachment);
}

/** Copy the selected bone's current pose onto the retained attachment Object3D. */
export function syncGodotBoneAttachment3D(attachment: Object3D): void {
  const state = BONE_ATTACHMENTS.get(attachment);
  if (state === undefined) throw new Error('BoneAttachment is not bound to a retained Skeleton rig.');
  const bone = attachmentBone(state);
  if (bone === null) return;
  bone.updateWorldMatrix(true, false);
  if (attachment.parent === null) {
    ATTACHMENT_LOCAL.copy(bone.matrixWorld);
  } else {
    attachment.parent.updateWorldMatrix(true, false);
    if (attachment.parent.matrixWorld.determinant() === 0) {
      throw new Error('BoneAttachment cannot derive a local pose beneath a singular parent transform.');
    }
    ATTACHMENT_PARENT_INVERSE.copy(attachment.parent.matrixWorld).invert();
    ATTACHMENT_LOCAL.multiplyMatrices(ATTACHMENT_PARENT_INVERSE, bone.matrixWorld);
  }
  ATTACHMENT_LOCAL.decompose(attachment.position, attachment.quaternion, attachment.scale);
  attachment.updateMatrix();
  attachment.updateMatrixWorld(true);
}

/**
 * Build a `THREE.Skeleton` from a Godot `Skeleton`'s authored bone table.
 *
 * The bones are created up front so a `parent` may reference any index
 * regardless of table order, then parented and posed. Roots' world matrices are
 * updated before the `Skeleton` is constructed, so its inverse bind matrices are
 * the bind pose.
 */
export function buildSkeleton(rests: readonly GodotBoneRest[]): GodotSkeleton {
  const bones = rests.map(() => new Bone());
  const roots: Bone[] = [];
  const matrix = new Matrix4();
  for (let i = 0; i < rests.length; i++) {
    const spec = rests[i] as GodotBoneRest;
    const bone = bones[i] as Bone;
    bone.name = spec.name;
    const [x, y, z] = spec.rest.basis;
    // The matrix whose COLUMNS are the basis vectors and the origin — `spatial.ts`'s `setTransform`
    // builds the same one. `Matrix4.set` takes rows, so the columns read down.
    matrix.set(
      x.x, y.x, z.x, spec.rest.origin.x,
      x.y, y.y, z.y, spec.rest.origin.y,
      x.z, y.z, z.z, spec.rest.origin.z,
      0, 0, 0, 1,
    );
    matrix.decompose(bone.position, bone.quaternion, bone.scale);
    if (spec.parent < 0) {
      roots.push(bone);
    } else {
      (bones[spec.parent] as Bone).add(bone);
    }
  }
  for (const root of roots) root.updateMatrixWorld(true);
  return { bones, roots, skeleton: new Skeleton(bones), meshes: new Set() };
}

export interface GodotSkeletonIKOptions {
  readonly rootBone: string;
  readonly tipBone: string;
  readonly targetNode?: GodotNodePath | string;
  readonly interpolation?: number;
  readonly overrideTipBasis?: boolean;
  readonly useMagnet?: boolean;
  readonly magnet?: { readonly x: number; readonly y: number; readonly z: number };
  readonly minDistance?: number;
  readonly maxIterations?: number;
  readonly resolve: (path: GodotNodePath | string) => Object3D | null;
}

interface SkeletonIKState {
  readonly node: Object3D;
  readonly rig: GodotSkeleton;
  readonly resolve: GodotSkeletonIKOptions['resolve'];
  rootBone: string;
  tipBone: string;
  targetNode: GodotNodePath;
  interpolation: number;
  overrideTipBasis: boolean;
  useMagnet: boolean;
  magnet: Vector3;
  minDistance: number;
  maxIterations: number;
  running: boolean;
  solver: CCDIKSolver | null;
  mesh: SkinnedMesh | null;
  targetBone: Bone | null;
  chain: Bone[];
}

const SKELETON_IKS = new WeakMap<Object3D, SkeletonIKState>();
const SKELETON_RIG_IKS = new WeakMap<GodotSkeleton, Set<SkeletonIKState>>();
const IK_WORLD_TARGET = new Vector3();
const IK_TARGET_WORLD_ROTATION = new Quaternion();
const IK_WORLD_MAGNET = new Vector3();
const IK_ROOT_WORLD = new Vector3();
const IK_MIDDLE_WORLD = new Vector3();
const IK_TIP_WORLD = new Vector3();
const IK_AXIS = new Vector3();
const IK_CURRENT = new Vector3();
const IK_DESIRED = new Vector3();
const IK_DELTA = new Quaternion();
const IK_WORLD_ROTATION = new Quaternion();
const IK_PARENT_INVERSE = new Quaternion();

function skeletonIKState(node: Object3D): SkeletonIKState {
  const state = SKELETON_IKS.get(node);
  if (state === undefined) throw new Error('SkeletonIK is not bound to a retained Skeleton rig.');
  return state;
}

function repackSkeleton(rig: GodotSkeleton): void {
  rig.skeleton.boneMatrices = new Float32Array(rig.skeleton.bones.length * 16);
  if (rig.skeleton.boneTexture !== null) {
    rig.skeleton.boneTexture.dispose();
    rig.skeleton.boneTexture = null;
  }
  rig.skeleton.computeBoneTexture();
}

function releaseSkeletonIKTarget(state: SkeletonIKState): void {
  const target = state.targetBone;
  state.solver = null;
  state.mesh = null;
  state.chain = [];
  if (target === null) return;
  state.targetBone = null;
  target.removeFromParent();
  const index = state.rig.skeleton.bones.indexOf(target);
  if (index >= 0) {
    state.rig.skeleton.bones.splice(index, 1);
    state.rig.skeleton.boneInverses.splice(index, 1);
    repackSkeleton(state.rig);
    // Removing an appended target changes the indices consumed by every later solver on this rig.
    // Leave their target identity retained so their own next rebuild can remove it exactly.
    for (const sibling of SKELETON_RIG_IKS.get(state.rig) ?? []) {
      if (sibling !== state) {
        sibling.solver = null;
        sibling.mesh = null;
        sibling.chain = [];
      }
    }
  }
}

function rebuildSkeletonIK(state: SkeletonIKState): void {
  releaseSkeletonIKTarget(state);
  const mesh = state.rig.meshes.values().next().value as SkinnedMesh | undefined;
  if (mesh === undefined) return;
  const bones = state.rig.skeleton.bones;
  const root = bones.findIndex((bone) => bone.name === state.rootBone);
  const tip = bones.findIndex((bone) => bone.name === state.tipBone);
  if (root < 0 || tip < 0) return;
  const reverse: number[] = [];
  let bone: Object3D | null = bones[tip] as Bone;
  while (bone instanceof Bone) {
    const index = bones.indexOf(bone);
    if (index < 0) break;
    reverse.push(index);
    if (index === root) break;
    bone = bone.parent;
  }
  if (reverse.at(-1) !== root || reverse.length < 2) return;
  const chain = reverse.reverse();
  const targetBone = new Bone();
  targetBone.name = `@SkeletonIK:${state.node.name}`;
  markBuiltInternal(targetBone);
  mesh.add(targetBone);
  bones.push(targetBone);
  state.rig.skeleton.boneInverses = [
    ...state.rig.skeleton.boneInverses,
    new Matrix4(),
  ];
  repackSkeleton(state.rig);
  const target = bones.length - 1;
  state.solver = new CCDIKSolver(mesh, [{
    target,
    effector: tip,
    links: chain.slice(0, -1).reverse().map((index) => ({ index })),
    iteration: 1,
    minAngle: 0,
  }]);
  state.mesh = mesh;
  state.targetBone = targetBone;
  state.chain = chain.map((index) => bones[index] as Bone);
}

function applySkeletonIKMagnet(state: SkeletonIKState): void {
  if (!state.useMagnet || state.chain.length < 3) return;
  const root = state.chain[0] as Bone;
  const middle = state.chain[Math.floor((state.chain.length - 1) / 2)] as Bone;
  const tip = state.chain.at(-1) as Bone;
  root.getWorldPosition(IK_ROOT_WORLD);
  middle.getWorldPosition(IK_MIDDLE_WORLD);
  tip.getWorldPosition(IK_TIP_WORLD);
  IK_AXIS.copy(IK_TIP_WORLD).sub(IK_ROOT_WORLD);
  if (IK_AXIS.lengthSq() < 1e-12) return;
  IK_AXIS.normalize();
  IK_CURRENT.copy(IK_MIDDLE_WORLD).sub(IK_ROOT_WORLD);
  IK_CURRENT.addScaledVector(IK_AXIS, -IK_CURRENT.dot(IK_AXIS));
  state.node.parent?.localToWorld(IK_WORLD_MAGNET.copy(state.magnet));
  IK_DESIRED.copy(IK_WORLD_MAGNET).sub(IK_ROOT_WORLD);
  IK_DESIRED.addScaledVector(IK_AXIS, -IK_DESIRED.dot(IK_AXIS));
  if (IK_CURRENT.lengthSq() < 1e-12 || IK_DESIRED.lengthSq() < 1e-12) return;
  IK_CURRENT.normalize();
  IK_DESIRED.normalize();
  const angle = Math.atan2(
    IK_AXIS.dot(IK_CURRENT.clone().cross(IK_DESIRED)),
    IK_CURRENT.dot(IK_DESIRED),
  );
  IK_DELTA.setFromAxisAngle(IK_AXIS, angle);
  root.getWorldQuaternion(IK_WORLD_ROTATION);
  IK_WORLD_ROTATION.premultiply(IK_DELTA);
  if (root.parent !== null) {
    root.parent.getWorldQuaternion(IK_PARENT_INVERSE).invert();
    IK_WORLD_ROTATION.premultiply(IK_PARENT_INVERSE);
  }
  root.quaternion.copy(IK_WORLD_ROTATION);
  root.updateWorldMatrix(false, true);
}

/** Bind an authored Godot 3 SkeletonIK node to its direct parent Skeleton and native mesh. */
export function bindGodotSkeletonIK3D(
  node: Object3D,
  rig: GodotSkeleton,
  options: GodotSkeletonIKOptions,
): Object3D {
  if (options.overrideTipBasis === false) {
    throw new Error(
      'SkeletonIK.override_tip_basis=false is not implemented by the native Three solver.',
    );
  }
  const state: SkeletonIKState = {
    node,
    rig,
    resolve: options.resolve,
    rootBone: options.rootBone,
    tipBone: options.tipBone,
    targetNode: godotNodePathNew(options.targetNode ?? ''),
    interpolation: options.interpolation ?? 1,
    overrideTipBasis: options.overrideTipBasis ?? true,
    useMagnet: options.useMagnet ?? false,
    magnet: new Vector3(options.magnet?.x ?? 0, options.magnet?.y ?? 0, options.magnet?.z ?? 0),
    minDistance: options.minDistance ?? 0.01,
    maxIterations: options.maxIterations ?? 10,
    running: false,
    solver: null,
    mesh: null,
    targetBone: null,
    chain: [],
  };
  SKELETON_IKS.set(node, state);
  const rigStates = SKELETON_RIG_IKS.get(rig) ?? new Set<SkeletonIKState>();
  rigStates.add(state);
  SKELETON_RIG_IKS.set(rig, rigStates);
  registerGodotThreeNodeRelease(node, () => {
    releaseSkeletonIKTarget(state);
    rigStates.delete(state);
    if (rigStates.size === 0) SKELETON_RIG_IKS.delete(rig);
    SKELETON_IKS.delete(node);
  });
  return node;
}

export function setGodotSkeletonIKTargetNode3D(
  node: Object3D,
  path: GodotNodePath | string,
): void {
  skeletonIKState(node).targetNode = godotNodePathNew(path);
}

/** Godot start(false) enables every-frame solving; start(true) solves once immediately. */
export function startGodotSkeletonIK3D(node: Object3D, oneTime = false): void {
  if (typeof oneTime !== 'boolean') throw new TypeError('SkeletonIK.start one_time requires bool.');
  const state = skeletonIKState(node);
  state.running = !oneTime;
  if (oneTime) solveGodotSkeletonIK3D(state);
}

function setWorldQuaternion(bone: Bone, world: Quaternion): void {
  if (bone.parent === null) {
    bone.quaternion.copy(world);
    return;
  }
  bone.parent.getWorldQuaternion(IK_PARENT_INVERSE).invert();
  bone.quaternion.copy(IK_PARENT_INVERSE).multiply(world);
}

function solveGodotSkeletonIK3D(state: SkeletonIKState): void {
  if (state.mesh !== null && !state.rig.meshes.has(state.mesh)) releaseSkeletonIKTarget(state);
  if (state.solver === null) rebuildSkeletonIK(state);
  if (state.solver === null || state.mesh === null || state.targetBone === null) return;
  const hasTargetNode = state.targetNode.names.length > 0 || state.targetNode.absolute;
  const target = hasTargetNode ? state.resolve(state.targetNode) : null;
  if (hasTargetNode && target === null) return;
  if (target === null) {
    IK_WORLD_TARGET.set(0, 0, 0);
    IK_TARGET_WORLD_ROTATION.identity();
  } else {
    target.getWorldPosition(IK_WORLD_TARGET);
    target.getWorldQuaternion(IK_TARGET_WORLD_ROTATION);
  }
  const targetWorld = IK_WORLD_TARGET.clone();
  state.mesh.updateWorldMatrix(true, false);
  state.mesh.worldToLocal(IK_WORLD_TARGET);
  state.targetBone.position.copy(IK_WORLD_TARGET);
  state.mesh.updateMatrixWorld(true);
  const before = state.interpolation < 0.99
    ? state.chain.map((bone) => bone.quaternion.clone())
    : [];
  const tip = state.chain.at(-1) as Bone;
  for (let iteration = 0; iteration < Math.max(0, Math.trunc(state.maxIterations)); iteration++) {
    tip.getWorldPosition(IK_TIP_WORLD);
    if (IK_TIP_WORLD.distanceTo(targetWorld) <= state.minDistance) break;
    state.solver.update();
  }
  applySkeletonIKMagnet(state);
  if (before.length > 0) {
    const blend = Math.max(0, Math.min(1, state.interpolation));
    state.chain.forEach((bone, index) => bone.quaternion.copy(before[index] as Quaternion).slerp(bone.quaternion, blend));
    state.mesh.updateMatrixWorld(true);
  }
  if (state.overrideTipBasis) {
    tip.getWorldQuaternion(IK_WORLD_ROTATION);
    IK_WORLD_ROTATION.slerp(IK_TARGET_WORLD_ROTATION, Math.max(0, Math.min(1, state.interpolation)));
    setWorldQuaternion(tip, IK_WORLD_ROTATION);
    tip.updateWorldMatrix(false, true);
  }
  state.rig.skeleton.update();
}

/** Update the actual Three bones after animation sampling, only while start(false) is active. */
export function updateGodotSkeletonIK3D(node: Object3D): void {
  const state = skeletonIKState(node);
  if (!state.running) return;
  solveGodotSkeletonIK3D(state);
}
