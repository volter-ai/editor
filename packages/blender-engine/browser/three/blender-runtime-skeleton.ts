/**
 * THE SKELETONS A FRAME DESCRIBES, and the skinned meshes bound to them.
 *
 * WHERE THE SKIN COMES FROM: the export door itself (`bpy_web_export.cc`, `write_skin`). Every mesh
 * an Armature modifier deforms arrives with a `skin` block: the armature's name, the mesh's vertex
 * group names and, per EXPORTED vertex, its four strongest groups and their normalized weights. The
 * frame's `armatures` already name every bone with its parent and its pose matrix
 * (`PoseBone.matrix`, armature space). So one frame holds everything a skin needs, from one
 * evaluation, and nothing here reads the engine or guesses whether what it holds is stale: a weight
 * edit, a modifier added or removed, a new pose, each re-exports the mesh under a new revision (the
 * door's skin digest moves it) and the skin is rebuilt with the geometry.
 *
 * THE BIND IS THE EXPORTED POSE. The exported vertices are already deformed, at the pose the frame
 * names, so each bone's inverse is that pose's inverse: at Blender's own pose the skinning is an
 * identity and the picture is exactly the one Blender evaluated. A clip played on the bones
 * (`AnimationMixer` over `rig().bones`) moves the mesh from there. The inverses come from the
 * frame's matrices, never from the bones' current transforms, so a bind taken while a clip is
 * playing is still right.
 *
 * AN UNWEIGHTED VERTEX stays where it is, as in Blender: the door gives it the index one past the
 * groups with weight 1, and that index is a bone at the armature's origin that never moves. A group
 * no bone is named for weights nothing (it is that same still bone), as it deforms nothing in Blender.
 */
import * as THREE from 'three';
import type { BlenderArmature } from './blender-runtime-armature';

/** The `skin` block of an exported mesh, as the door writes it (typed arrays by the worker). */
export interface FrameSkin {
  readonly armature: string;
  readonly groups: readonly string[];
  readonly columns: { readonly joints: Uint16Array; readonly weights: Float32Array };
}

export interface ArmatureRig {
  /** The armature this rig belongs to, by Blender object name. */
  readonly armature: string;
  /** The armature's presented object, which the bones hang under. */
  readonly object: THREE.Object3D;
  /** Every bone by Blender's own bone name (unsanitized: a game finds them by those names). */
  readonly bones: ReadonlyMap<string, THREE.Bone>;
  /** The action the file assigns this armature (`animation_data.action`), if any. */
  readonly action: string | null;
}

interface Rig extends ArmatureRig {
  readonly root: THREE.Group;
  readonly still: THREE.Bone;
  /** Bone names and parents: a change rebuilds the bones. */
  readonly structure: string;
  /** The pose matrices last applied, armature space, by bone name. */
  pose: Map<string, THREE.Matrix4>;
  poseKey: string;
  action: string | null;
}

const matrixOf = (rows: readonly (readonly number[])[]): THREE.Matrix4 =>
  new THREE.Matrix4().set(...(rows.flat() as Parameters<THREE.Matrix4['set']>));

/** Expand an exported mesh's per-vertex skin onto its DRAWN vertices (`blenderVertex`, the draw's
 *  map back to Blender's vertices), as the geometry's `skinIndex` and `skinWeight`. */
export function skinGeometry(geometry: THREE.BufferGeometry, skin: FrameSkin): void {
  const source = geometry.getAttribute('blenderVertex');
  if (!source) throw new Error(`A skinned mesh of ${skin.armature} was drawn without its vertex map`);
  const drawn = source.count;
  const indices = new Uint16Array(drawn * 4);
  const weights = new Float32Array(drawn * 4);
  for (let i = 0; i < drawn; i++) {
    const vertex = source.getX(i);
    indices.set(skin.columns.joints.subarray(vertex * 4, vertex * 4 + 4), i * 4);
    weights.set(skin.columns.weights.subarray(vertex * 4, vertex * 4 + 4), i * 4);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.userData['blenderSkin'] = { armature: skin.armature, groups: [...skin.groups] };
}

export class RuntimeSkeletons {
  #rigs = new Map<string, Rig>();

  /** The rig of one armature, or null when the frame names none by that name. */
  rig(armature: string): ArmatureRig | null {
    return this.#rigs.get(armature) ?? null;
  }

  rigs(): readonly ArmatureRig[] {
    return [...this.#rigs.values()];
  }

  /**
   * Bring the rigs to this frame: build an armature's bones when it is new or its bones changed,
   * and pose them as Blender posed them WHEN THAT POSE CHANGED, so a clip a reader is playing is
   * not reset by a frame that says nothing new about the pose.
   */
  apply(armatures: Readonly<Record<string, BlenderArmature>>,
    objectFor: (name: string) => THREE.Object3D | null): void {
    for (const [name, rig] of [...this.#rigs]) {
      const armature = armatures[name];
      const object = objectFor(name);
      if (!armature || !object || object !== rig.object) {
        rig.root.removeFromParent();
        this.#rigs.delete(name);
      }
    }
    for (const [name, armature] of Object.entries(armatures)) {
      const object = objectFor(name);
      if (!object) continue;
      const structure = armature.bones.map((bone) => `${bone.name}\u0000${bone.parent ?? ''}`).join('\u0001');
      let rig = this.#rigs.get(name);
      if (rig && rig.structure !== structure) {
        rig.root.removeFromParent();
        rig = undefined;
      }
      if (!rig) {
        const root = new THREE.Group();
        root.name = `${name}:bones`;
        const still = new THREE.Bone();
        still.name = `${name}:still`;
        root.add(still);
        const bones = new Map<string, THREE.Bone>();
        for (const declared of armature.bones) {
          const bone = new THREE.Bone();
          bone.name = declared.name;
          bones.set(declared.name, bone);
        }
        for (const declared of armature.bones) {
          const parent = declared.parent === null ? undefined : bones.get(declared.parent);
          (parent ?? root).add(bones.get(declared.name)!);
        }
        object.add(root);
        rig = { armature: name, object, root, still, bones, structure, pose: new Map(), poseKey: '', action: null };
        this.#rigs.set(name, rig);
      }
      rig.action = armature.action ?? null;
      const poseKey = armature.bones.map((bone) => bone.matrix.flat().join(',')).join(';');
      if (poseKey !== rig.poseKey) {
        rig.poseKey = poseKey;
        rig.pose = new Map(armature.bones.map((bone) => [bone.name, matrixOf(bone.matrix)]));
        RuntimeSkeletons.#pose(rig, armature);
      }
    }
  }

  /** Set every bone's local transform from the frame's armature-space pose matrices. */
  static #pose(rig: Rig, armature: BlenderArmature): void {
    for (const declared of armature.bones) {
      const own = rig.pose.get(declared.name)!;
      const parent = declared.parent === null ? undefined : rig.pose.get(declared.parent);
      const local = parent ? parent.clone().invert().multiply(own) : own.clone();
      const bone = rig.bones.get(declared.name)!;
      local.decompose(bone.position, bone.quaternion, bone.scale);
    }
  }

  /** Put Blender's pose back on an armature's bones, after a reader that played a clip lets go. */
  restorePose(armature: string): void {
    const rig = this.#rigs.get(armature);
    if (!rig) return;
    for (const [name, own] of rig.pose) {
      const bone = rig.bones.get(name)!;
      const parentBone = bone.parent instanceof THREE.Bone && bone.parent !== rig.still ? bone.parent : null;
      const parent = parentBone ? rig.pose.get(parentBone.name) : undefined;
      const local = parent ? parent.clone().invert().multiply(own) : own.clone();
      local.decompose(bone.position, bone.quaternion, bone.scale);
    }
  }

  /**
   * A mesh object's skinned form: a `THREE.SkinnedMesh` over its geometry, bound to its armature's
   * rig at the pose the frame was exported in. Null when its geometry carries no skin or its
   * armature is not in the frame (it then draws as the plain, exported mesh: Blender's own pose).
   * The world matrices must be current (`root.updateMatrixWorld(true)`) before this is called.
   */
  bind(mesh: THREE.SkinnedMesh | THREE.Mesh): THREE.SkinnedMesh | null {
    const skin = mesh.geometry.userData['blenderSkin'] as { armature: string; groups: string[] } | undefined;
    const rig = skin ? this.#rigs.get(skin.armature) : undefined;
    if (!skin || !rig) return null;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? mesh as THREE.SkinnedMesh
      : new THREE.SkinnedMesh(mesh.geometry, mesh.material);
    if (skinned !== mesh) {
      skinned.name = mesh.name;
      skinned.matrixAutoUpdate = mesh.matrixAutoUpdate;
      skinned.matrix.copy(mesh.matrix);
      skinned.matrix.decompose(skinned.position, skinned.quaternion, skinned.scale);
      skinned.userData = mesh.userData;
      // A skin moves past its bind bounds: three computes them from the bind pose.
      skinned.frustumCulled = false;
    }
    const armatureWorld = rig.object.matrixWorld;
    const bones = [...skin.groups.map((group) => rig.bones.get(group) ?? rig.still), rig.still];
    const inverses = bones.map((bone) => {
      const pose = bone === rig.still ? undefined : rig.pose.get(bone.name);
      const world = pose ? armatureWorld.clone().multiply(pose) : armatureWorld.clone();
      return world.invert();
    });
    mesh.updateWorldMatrix(true, false);
    // A re-export rebinds the same mesh: its old skeleton's bone texture goes with it.
    (skinned.skeleton as THREE.Skeleton | undefined)?.dispose();
    skinned.bind(new THREE.Skeleton(bones, inverses), mesh.matrixWorld.clone());
    return skinned;
  }

  dispose(): void {
    for (const rig of this.#rigs.values()) rig.root.removeFromParent();
    this.#rigs.clear();
  }
}
