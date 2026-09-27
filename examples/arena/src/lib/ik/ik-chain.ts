/**
 * IKChain — skeletal inverse kinematics over a bone chain.
 *
 * Wraps three's own `CCDIKSolver` (three/addons — "use the library
 * directly") over a skinned mesh's skeleton. Bends a named bone chain so
 * the chain tip (effector) reaches a world-space target each frame,
 * refining the pose animation produced.
 *
 * Provided by the `ik` standard capability (`vgai add ik`; general skeletal
 * animation — not humanoid-specific; any bone chain works). This copied source
 * is project-owned and may be extended for the game's actual rig.
 *
 * Set `node` to the subtree holding the skinned mesh, configure the chain,
 * call `init()` once, then call `update()` from the owner's `useFrame` —
 * strictly AFTER that frame's clip sampling and procedural posing, so the
 * solve refines the pose animation produced. `getWorldTarget` may return
 * `null` to SKIP solving that frame (a two-handed grip releases the off hand
 * when the item is holstered/dead).
 *
 * Worked use (the shooter examples): it drives the off-hand FOREGRIP
 * CONTACT of the two-handed grip convention (the humanoid capability's
 * src/lib/humanoid/grip.ts): the target is the held item's authored
 * `Foregrip` node, so the left hand rides the rifle wherever the right
 * hand and the procedural aim take it.
 */

import {
  type ConstraintMark,
  clearConstraintMark,
  setConstraintMark,
} from '@volter/threejs-runtime/adapter/constraint';
import { markBuiltInternal } from '@volter/threejs-runtime/adapter/hierarchy-marks';
import * as THREE from 'three';
import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';

export class IKChain {
  /** The subtree holding the skinned mesh this chain bends. */
  node!: THREE.Object3D;
  /** Optional semantic constraint row that receives the live editor mark. */
  markObject: THREE.Object3D | null = null;

  /** Bone names from chain root → effector (the tip that reaches the target). */
  boneNames: string[] = [];
  /** Name of the skeleton bone used as the IK goal (created if absent). */
  targetBoneName = 'IKTarget';
  /** World-space target position when no live target is provided. */
  targetOffset: number[] = [0, 0, 0];
  /** CCDIK iterations solved per frame. */
  iterations = 20;
  /** Inspector identity and evaluation metadata. */
  constraintId = 'ik-chain';
  label = 'CCD IK';
  readonly constraintType: 'ccd-ik' | 'two-bone-ik' = 'ccd-ik';
  enabled = true;
  weight = 1;
  order = 0;

  /** Optional live world-space target (set from code to track a moving
   *  object). Return `null` to skip solving this frame — the chain then
   *  keeps whatever pose animation gave it. */
  getWorldTarget: (() => THREE.Vector3 | null) | null = null;
  /** The ordinary hierarchy object used as the goal, when one exists. */
  targetObject: THREE.Object3D | null = null;
  /** Resolve a moving/conditional goal object for editor linking and solving. */
  getTargetObject: (() => THREE.Object3D | null) | null = null;
  /** Ordinary hierarchy pole control (Two Bone IK only). */
  poleObject: THREE.Object3D | null = null;
  getWorldPole: (() => THREE.Vector3 | null) | null = null;

  private solver: CCDIKSolver | null = null;
  private mesh: THREE.SkinnedMesh | null = null;
  private targetBone: THREE.Bone | null = null;
  private bones: THREE.Object3D[] = [];
  private status: 'ready' | 'disabled' | 'unresolved' | 'error' = 'unresolved';
  private message: string | undefined;
  private solveError: number | null = null;
  private mark: ConstraintMark | null = null;
  private markedObject: THREE.Object3D | null = null;
  private readonly _wt = new THREE.Vector3();
  private readonly _wp = new THREE.Vector3();

  init(): void {
    this.dispose();
    const owner = this;
    this.mark = {
      get config() {
        return {
          id: owner.constraintId,
          type: owner.constraintType,
          label: owner.label,
          enabled: owner.enabled,
          weight: THREE.MathUtils.clamp(owner.weight, 0, 1),
          order: owner.order,
        };
      },
      getSnapshot: () => ({
        status: this.status,
        ...(this.message ? { message: this.message } : {}),
        chain: this.bones,
        constrained: this.bones.at(-1) ?? null,
        target: this.resolveTargetObject() ?? this.targetBone,
        pole: this.poleObject,
        error:
          this.solveError === null ? null : { value: this.solveError, unit: 'metres' as const },
      }),
    };
    this.markedObject = this.markObject ?? this.node;
    setConstraintMark(this.markedObject, this.mark);

    const mesh = this.findSkinnedMesh(this.node);
    if (!mesh) this.fail(`IK owner '${this.node.name || this.node.type}' has no SkinnedMesh`);
    this.mesh = mesh;
    const skel = mesh.skeleton;
    const indexOf = (name: string) => skel.bones.findIndex((b) => b.name === name);

    const chain = this.boneNames.map(indexOf);
    if (chain.length < 2) this.fail('IK chain requires at least a root and an effector');
    const missing = this.boneNames.filter((_, index) => chain[index]! < 0);
    if (missing.length > 0) this.fail(`IK chain is missing bones: ${missing.join(', ')}`);
    this.bones = chain.map((index) => skel.bones[index]!);
    const effector = chain[chain.length - 1]!;
    // Links run effector-ward → root-ward, excluding the effector itself.
    const links = chain
      .slice(0, -1)
      .reverse()
      .map((index) => ({ index }));

    let tIdx = indexOf(this.targetBoneName);
    if (tIdx < 0) tIdx = this.appendTargetBone(mesh);
    this.targetBone = skel.bones[tIdx] ?? null;

    this.solver = new CCDIKSolver(mesh, [
      { target: tIdx, effector, links, iteration: this.iterations },
    ]);
    this.status = 'ready';
    this.message = undefined;
  }

  update(): void {
    if (!this.enabled || this.weight <= 0) {
      this.status = 'disabled';
      this.solveError = null;
      return;
    }
    if (!this.solver || !this.targetBone || !this.mesh) return;
    if (!this.resolveWorldTarget()) return;
    const blend = THREE.MathUtils.clamp(this.weight, 0, 1);
    const before = blend < 1 ? this.bones.map((bone) => bone.quaternion.clone()) : [];
    // Target bone is a child of the mesh — convert the world goal to mesh-local.
    this.mesh.updateWorldMatrix(true, false);
    this.mesh.worldToLocal(this._wt);
    this.targetBone.position.copy(this._wt);
    this.mesh.updateMatrixWorld(true);
    this.solver.update();
    this.applyPole();
    if (blend < 1) {
      for (let index = 0; index < this.bones.length; index++) {
        const bone = this.bones[index]!;
        const solved = bone.quaternion.clone();
        bone.quaternion.copy(before[index]!).slerp(solved, blend);
      }
      this.mesh.updateMatrixWorld(true);
    }
    const target = this.targetBone.getWorldPosition(new THREE.Vector3());
    const effector = this.bones.at(-1)?.getWorldPosition(new THREE.Vector3());
    this.solveError = effector ? effector.distanceTo(target) : null;
    this.status = 'ready';
    this.message = undefined;
  }

  dispose(): void {
    if (this.mark && this.markedObject) clearConstraintMark(this.markedObject, this.constraintId);
    this.mark = null;
    this.markedObject = null;
    this.solver = null;
    this.mesh = null;
    this.targetBone = null;
    this.bones = [];
    this.solveError = null;
  }

  private resolveTargetObject(): THREE.Object3D | null {
    return this.getTargetObject?.() ?? this.targetObject;
  }

  private resolveWorldTarget(): boolean {
    const supplied = this.getWorldTarget?.();
    if (this.getWorldTarget && !supplied) {
      this.status = 'disabled';
      this.solveError = null;
      return false;
    }
    if (supplied) this._wt.copy(supplied);
    else {
      const object = this.resolveTargetObject();
      if (object) object.getWorldPosition(this._wt);
      else this._wt.set(this.targetOffset[0]!, this.targetOffset[1]!, this.targetOffset[2]!);
    }
    return true;
  }

  /** Rotate the solved chain around root→tip so the middle joint faces the pole. */
  private applyPole(): void {
    if (this.constraintType !== 'two-bone-ik' || this.bones.length !== 3) return;
    const pole = this.getWorldPole?.() ?? this.poleObject?.getWorldPosition(this._wp) ?? null;
    if (!pole) return;
    const [root, middle, tip] = this.bones as [THREE.Object3D, THREE.Object3D, THREE.Object3D];
    const rootPosition = root.getWorldPosition(new THREE.Vector3());
    const axis = tip.getWorldPosition(new THREE.Vector3()).sub(rootPosition);
    if (axis.lengthSq() < 1e-10) return;
    axis.normalize();
    const current = middle.getWorldPosition(new THREE.Vector3()).sub(rootPosition);
    current.addScaledVector(axis, -current.dot(axis));
    const desired = pole.clone().sub(rootPosition);
    desired.addScaledVector(axis, -desired.dot(axis));
    if (current.lengthSq() < 1e-10 || desired.lengthSq() < 1e-10) return;
    current.normalize();
    desired.normalize();
    const angle = Math.atan2(axis.dot(current.clone().cross(desired)), current.dot(desired));
    const delta = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const world = delta.multiply(root.getWorldQuaternion(new THREE.Quaternion()));
    const parentInverse = root.parent
      ? root.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
      : new THREE.Quaternion();
    root.quaternion.copy(parentInverse.multiply(world));
    root.updateWorldMatrix(false, true);
  }

  private fail(message: string): never {
    this.status = 'error';
    this.message = message;
    throw new Error(message);
  }

  private findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
    let found: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
    });
    return found;
  }

  /**
   * Append a target bone to the skeleton + grow the skin's bone buffers.
   *
   * `boneInverses` is COPIED before it grows, and that copy is load-bearing.
   * three's `Skeleton` constructor does `this.bones = bones.slice(0)` but
   * `this.boneInverses = boneInverses` — by reference — and
   * `SkeletonUtils.clone()` builds every clone with
   * `sourceMesh.skeleton.clone()`, i.e. `new Skeleton(bones, boneInverses)`.
   * So a cached GLTF and EVERY clone taken from it share one inverses array.
   * Pushing into it in place leaves each of those skeletons with more inverses
   * than bones, and three's `Skeleton.init()` reacts to that mismatch by
   * warning and replacing every inverse with an IDENTITY matrix — which
   * collapses the skinned mesh to a sliver. Symptom when it bites: bodies
   * vanish while their held props and their shadows still render.
   *
   * It stays latent until the editor's design session mounts and appends too,
   * at which point the play session's clones are born broken.
   */
  private appendTargetBone(mesh: THREE.SkinnedMesh): number {
    const skel = mesh.skeleton;
    const bone = new THREE.Bone();
    bone.name = this.targetBoneName;
    // CCDIKSolver requires a bone index for its goal, but this generated bone
    // is solver machinery rather than an authored target. Keep the ordinary
    // targetObject selectable while folding this implementation row behind
    // Reveal Internals like other rig internals.
    markBuiltInternal(bone);
    mesh.add(bone);
    skel.bones.push(bone);
    skel.boneInverses = [...skel.boneInverses, new THREE.Matrix4()];
    skel.boneMatrices = new Float32Array(skel.bones.length * 16);
    if (skel.boneTexture) {
      skel.boneTexture.dispose();
      (skel as unknown as { boneTexture: THREE.DataTexture | null }).boneTexture = null;
    }
    skel.computeBoneTexture();
    return skel.bones.length - 1;
  }
}

/** Standard root/mid/tip constraint with an optional pole control. */
export class TwoBoneIKConstraint extends IKChain {
  override label = 'Two Bone IK';
  override readonly constraintType = 'two-bone-ik' as const;

  override init(): void {
    if (this.boneNames.length !== 3) {
      throw new Error(
        `Two Bone IK requires exactly root, mid and tip bone names; received ${this.boneNames.length}`,
      );
    }
    super.init();
  }
}
