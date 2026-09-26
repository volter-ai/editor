/**
 * @godot-class Skeleton3D
 * @role BINDING
 *
 * Godot 4.7's `Skeleton3D` bones (`scene/3d/skeleton_3d.cpp`, revision
 * `5b4e0cb0fd279832bbdd69fed5354d4e5ad26f88`) bound onto three bones: bone `i` of a skeleton is a
 * three object whose local position, rotation and scale are the bone's pose, so three's skinning
 * draws the pose. An imported model's skeleton binds the loader's joint objects in Godot's bone
 * order (`packed-scene.tsx`, the importer's order from `read/gltf-godot-scene.ts`); a bone added at
 * run time is a new three `Bone` under the skeleton. The poses themselves (`real_t` values) live in
 * `SKELETON`, keyed by the skeleton's entity. Bone rests, parents set at run time, global poses and
 * modifiers are not transcribed.
 */

import { Bone, type Object3D } from 'three';
import { construct as quaternion, type Quaternion } from './quaternion';
import { construct as vector3, type Vector3 } from './vector3';
import './node-3d';

interface BoneState {
  readonly object: Object3D;
  readonly name: string;
  position: Vector3;
  rotation: Quaternion;
  scale: Vector3;
}

const SKELETON = new WeakMap<Object3D, BoneState[]>();

function bonesOf(self: Object3D): BoneState[] {
  let bones = SKELETON.get(self);
  if (bones === undefined) {
    bones = [];
    SKELETON.set(self, bones);
  }
  return bones;
}

function boneAt(self: Object3D, bone: number): BoneState | undefined {
  return Number.isInteger(bone) ? bonesOf(self)[bone] : undefined;
}

/** The pose onto the three object: position, rotation and scale as three composes them. */
function draw(state: BoneState): void {
  state.object.position.set(state.position.x, state.position.y, state.position.z);
  state.object.quaternion.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
  state.object.scale.set(state.scale.x, state.scale.y, state.scale.z);
}

/**
 * Binds an imported skeleton's bones, in Godot's bone order, to the three objects the loader made
 * for their joints, each at the pose the importer gives it (the joint transform's origin, rotation
 * quaternion and scale, `SkinTool::_create_skeletons`), drawn onto its joint.
 *
 * @godot Skeleton3D (protocol)
 * @source modules/gltf/skin_tool.cpp:636
 */
export function godot_skeleton_3d_bind(
  self: Object3D,
  bones: readonly {
    readonly object: Object3D;
    readonly name: string;
    readonly pose: {
      readonly position: readonly [number, number, number];
      readonly rotation: readonly [number, number, number, number];
      readonly scale: readonly [number, number, number];
    };
  }[],
): void {
  const states = bones.map(({ object, name, pose }) => ({
    object,
    name,
    position: vector3(...pose.position),
    rotation: quaternion(...pose.rotation),
    scale: vector3(...pose.scale),
  }));
  SKELETON.set(self, states);
  for (const state of states) draw(state);
}

/**
 * The three object bone `bone` is drawn by, or undefined out of range.
 *
 * @godot Skeleton3D (protocol)
 * @source scene/3d/skeleton_3d.cpp:901
 */
export function godot_skeleton_3d_bone_object(self: Object3D, bone: number): Object3D | undefined {
  return boneAt(self, bone)?.object;
}

/**
 * Appends a bone with no parent, an identity rest and pose; an empty name, one with `:` or `/`,
 * or a taken one fails with -1.
 *
 * @godot Skeleton3D.add_bone
 * @source scene/3d/skeleton_3d.cpp:607
 */
export function add_bone(self: Object3D, name: string): number {
  const bones = bonesOf(self);
  if (name === '' || name.includes(':') || name.includes('/') || bones.some((bone) => bone.name === name)) return -1;
  const object = new Bone();
  object.name = name;
  self.add(object);
  const state: BoneState = { object, name, position: vector3(), rotation: quaternion(), scale: vector3(1, 1, 1) };
  bones.push(state);
  draw(state);
  return bones.length - 1;
}

/**
 * @godot Skeleton3D.find_bone
 * @source scene/3d/skeleton_3d.cpp:624
 */
export function find_bone(self: Object3D, name: string): number {
  return bonesOf(self).findIndex((bone) => bone.name === name);
}

/**
 * @godot Skeleton3D.get_bone_name
 * @source scene/3d/skeleton_3d.cpp:629
 */
export function get_bone_name(self: Object3D, bone: number): string {
  return boneAt(self, bone)?.name ?? '';
}

/**
 * @godot Skeleton3D.get_bone_count
 * @source scene/3d/skeleton_3d.cpp:717
 */
export function get_bone_count(self: Object3D): number {
  return bonesOf(self).length;
}

/**
 * An index out of range is an error and changes nothing.
 *
 * @godot Skeleton3D.set_bone_pose_position
 * @source scene/3d/skeleton_3d.cpp:861
 */
export function set_bone_pose_position(self: Object3D, bone: number, position: Vector3): void {
  const state = boneAt(self, bone);
  if (state === undefined) return;
  state.position = vector3(position);
  draw(state);
}

/**
 * @godot Skeleton3D.set_bone_pose_rotation
 * @source scene/3d/skeleton_3d.cpp:874
 */
export function set_bone_pose_rotation(self: Object3D, bone: number, rotation: Quaternion): void {
  const state = boneAt(self, bone);
  if (state === undefined) return;
  state.rotation = quaternion(rotation);
  draw(state);
}

/**
 * @godot Skeleton3D.set_bone_pose_scale
 * @source scene/3d/skeleton_3d.cpp:887
 */
export function set_bone_pose_scale(self: Object3D, bone: number, scale: Vector3): void {
  const state = boneAt(self, bone);
  if (state === undefined) return;
  state.scale = vector3(scale);
  draw(state);
}

/**
 * Out of range: `Vector3()`.
 *
 * @godot Skeleton3D.get_bone_pose_position
 * @source scene/3d/skeleton_3d.cpp:901
 */
export function get_bone_pose_position(self: Object3D, bone: number): Vector3 {
  return boneAt(self, bone)?.position ?? vector3();
}

/**
 * Out of range: `Quaternion()`.
 *
 * @godot Skeleton3D.get_bone_pose_rotation
 * @source scene/3d/skeleton_3d.cpp:907
 */
export function get_bone_pose_rotation(self: Object3D, bone: number): Quaternion {
  return boneAt(self, bone)?.rotation ?? quaternion();
}

/**
 * Out of range: `Vector3()`.
 *
 * @godot Skeleton3D.get_bone_pose_scale
 * @source scene/3d/skeleton_3d.cpp:913
 */
export function get_bone_pose_scale(self: Object3D, bone: number): Vector3 {
  return boneAt(self, bone)?.scale ?? vector3();
}
