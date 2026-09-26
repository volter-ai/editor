import { registerGodotObjectIdentity } from './object';
import { godotResourceEmitChanged } from './resource-io';

export const GODOT_SKELETON_TAIL_DIRECTION_AVERAGE_CHILDREN = 0;
export const GODOT_SKELETON_TAIL_DIRECTION_SPECIFIC_CHILD = 1;
export const GODOT_SKELETON_TAIL_DIRECTION_END = 2;

export interface GodotSkeletonProfileBone {
  name: string;
  parent: string;
  tailDirection: number;
  tail: string;
  referencePose: unknown;
  handleOffset: Readonly<{ x: number; y: number }>;
  group: string;
  required: boolean;
}

export interface GodotSkeletonProfileGroup {
  name: string;
  texture: unknown;
}

function emptyBone(): GodotSkeletonProfileBone {
  return { name: '', parent: '', tailDirection: GODOT_SKELETON_TAIL_DIRECTION_AVERAGE_CHILDREN, tail: '', referencePose: null, handleOffset: { x: 0, y: 0 }, group: '', required: false };
}

export class GodotSkeletonProfile {
  private rootBone = '';
  private scaleBaseBone = '';
  private groups: GodotSkeletonProfileGroup[] = [];
  private bones: GodotSkeletonProfileBone[] = [];

  constructor(className = 'SkeletonProfile') { registerGodotObjectIdentity(this, className); }
  set_root_bone(value: string): void { this.rootBone = value; godotResourceEmitChanged(this); }
  get_root_bone(): string { return this.rootBone; }
  set_scale_base_bone(value: string): void { this.scaleBaseBone = value; godotResourceEmitChanged(this); }
  get_scale_base_bone(): string { return this.scaleBaseBone; }
  set_group_size(size: number): void { const count = Math.max(0, Math.trunc(size)); while (this.groups.length < count) this.groups.push({ name: '', texture: null }); this.groups.length = count; godotResourceEmitChanged(this); }
  get_group_size(): number { return this.groups.length; }
  set_bone_size(size: number): void { const count = Math.max(0, Math.trunc(size)); while (this.bones.length < count) this.bones.push(emptyBone()); this.bones.length = count; godotResourceEmitChanged(this); }
  get_bone_size(): number { return this.bones.length; }
  find_bone(name: string): number { return this.bones.findIndex((bone) => bone.name === name); }
  get_bone_name(index: number): string { return this.bones[index]?.name ?? ''; }
  set_bone_name(index: number, value: string): void { const bone = this.bones[index]; if (bone) { bone.name = value; godotResourceEmitChanged(this); } }
  get_bone_parent(index: number): string { return this.bones[index]?.parent ?? ''; }
  set_bone_parent(index: number, value: string): void { const bone = this.bones[index]; if (bone) { bone.parent = value; godotResourceEmitChanged(this); } }
  get_tail_direction(index: number): number { return this.bones[index]?.tailDirection ?? GODOT_SKELETON_TAIL_DIRECTION_AVERAGE_CHILDREN; }
  set_tail_direction(index: number, value: number): void { const bone = this.bones[index]; if (bone) { bone.tailDirection = value; godotResourceEmitChanged(this); } }
  get_bone_tail(index: number): string { return this.bones[index]?.tail ?? ''; }
  set_bone_tail(index: number, value: string): void { const bone = this.bones[index]; if (bone) { bone.tail = value; godotResourceEmitChanged(this); } }
  get_reference_pose(index: number): unknown { return this.bones[index]?.referencePose ?? null; }
  set_reference_pose(index: number, value: unknown): void { const bone = this.bones[index]; if (bone) { bone.referencePose = value; godotResourceEmitChanged(this); } }
  get_handle_offset(index: number): Readonly<{ x: number; y: number }> { return { ...(this.bones[index]?.handleOffset ?? { x: 0, y: 0 }) }; }
  set_handle_offset(index: number, value: Readonly<{ x: number; y: number }>): void { const bone = this.bones[index]; if (bone) { bone.handleOffset = { ...value }; godotResourceEmitChanged(this); } }
  get_group(index: number): string { return this.bones[index]?.group ?? ''; }
  set_group(index: number, value: string): void { const bone = this.bones[index]; if (bone) { bone.group = value; godotResourceEmitChanged(this); } }
  is_required(index: number): boolean { return this.bones[index]?.required ?? false; }
  set_required(index: number, value: boolean): void { const bone = this.bones[index]; if (bone) { bone.required = value; godotResourceEmitChanged(this); } }
  get_group_name(index: number): string { return this.groups[index]?.name ?? ''; }
  set_group_name(index: number, value: string): void { const group = this.groups[index]; if (group) { group.name = value; godotResourceEmitChanged(this); } }
  get_texture(index: number): unknown { return this.groups[index]?.texture ?? null; }
  set_texture(index: number, value: unknown): void { const group = this.groups[index]; if (group) { group.texture = value; godotResourceEmitChanged(this); } }
  get_bones(): readonly GodotSkeletonProfileBone[] { return this.bones.map((bone) => ({ ...bone, handleOffset: { ...bone.handleOffset } })); }
}

export interface GodotBoneMapValidation {
  valid: boolean;
  missingRequired: string[];
  duplicateSkeletonBones: string[];
  unknownProfileBones: string[];
}

export class GodotBoneMap {
  private profile: GodotSkeletonProfile | null = null;
  private readonly mappings = new Map<string, string>();
  constructor() { registerGodotObjectIdentity(this, 'BoneMap'); }
  set_profile(profile: GodotSkeletonProfile | null): void { this.profile = profile; this.prune(); godotResourceEmitChanged(this); }
  get_profile(): GodotSkeletonProfile | null { return this.profile; }
  set_skeleton_bone_name(profileBone: string, skeletonBone: string): void {
    if (skeletonBone === '') this.mappings.delete(profileBone); else this.mappings.set(profileBone, skeletonBone);
    godotResourceEmitChanged(this);
  }
  get_skeleton_bone_name(profileBone: string): string { return this.mappings.get(profileBone) ?? ''; }
  find_profile_bone_name(skeletonBone: string): string { for (const [profile, skeleton] of this.mappings) if (skeleton === skeletonBone) return profile; return ''; }
  get_profile_bone_names(): string[] { return [...this.mappings.keys()]; }
  clear(): void { this.mappings.clear(); godotResourceEmitChanged(this); }
  private prune(): void {
    if (!this.profile) { this.mappings.clear(); return; }
    for (const name of this.mappings.keys()) if (this.profile.find_bone(name) < 0) this.mappings.delete(name);
  }
  validate(): GodotBoneMapValidation {
    const missingRequired: string[] = []; const unknownProfileBones: string[] = []; const counts = new Map<string, number>();
    if (this.profile) {
      for (const bone of this.profile.get_bones()) if (bone.required && !this.mappings.get(bone.name)) missingRequired.push(bone.name);
      for (const name of this.mappings.keys()) if (this.profile.find_bone(name) < 0) unknownProfileBones.push(name);
    }
    for (const skeleton of this.mappings.values()) counts.set(skeleton, (counts.get(skeleton) ?? 0) + 1);
    const duplicateSkeletonBones = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
    return { valid: missingRequired.length === 0 && duplicateSkeletonBones.length === 0 && unknownProfileBones.length === 0, missingRequired, duplicateSkeletonBones, unknownProfileBones };
  }
}

const HUMANOID_BONES: readonly [string, string, string, boolean][] = [
  ['Root', '', 'Body', true], ['Hips', 'Root', 'Body', true], ['Spine', 'Hips', 'Body', true], ['Chest', 'Spine', 'Body', true], ['UpperChest', 'Chest', 'Body', false],
  ['Neck', 'UpperChest', 'Body', true], ['Head', 'Neck', 'Body', true], ['LeftEye', 'Head', 'Face', false], ['RightEye', 'Head', 'Face', false], ['Jaw', 'Head', 'Face', false],
  ['LeftShoulder', 'UpperChest', 'LeftArm', true], ['LeftUpperArm', 'LeftShoulder', 'LeftArm', true], ['LeftLowerArm', 'LeftUpperArm', 'LeftArm', true], ['LeftHand', 'LeftLowerArm', 'LeftArm', true],
  ['RightShoulder', 'UpperChest', 'RightArm', true], ['RightUpperArm', 'RightShoulder', 'RightArm', true], ['RightLowerArm', 'RightUpperArm', 'RightArm', true], ['RightHand', 'RightLowerArm', 'RightArm', true],
  ['LeftUpperLeg', 'Hips', 'LeftLeg', true], ['LeftLowerLeg', 'LeftUpperLeg', 'LeftLeg', true], ['LeftFoot', 'LeftLowerLeg', 'LeftLeg', true], ['LeftToes', 'LeftFoot', 'LeftLeg', false],
  ['RightUpperLeg', 'Hips', 'RightLeg', true], ['RightLowerLeg', 'RightUpperLeg', 'RightLeg', true], ['RightFoot', 'RightLowerLeg', 'RightLeg', true], ['RightToes', 'RightFoot', 'RightLeg', false],
];

export class GodotSkeletonProfileHumanoid extends GodotSkeletonProfile {
  constructor() {
    super('SkeletonProfileHumanoid');
    const groups = ['Body', 'Face', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg']; this.set_group_size(groups.length); groups.forEach((group, index) => this.set_group_name(index, group));
    this.set_bone_size(HUMANOID_BONES.length);
    HUMANOID_BONES.forEach(([name, parent, group, required], index) => { this.set_bone_name(index, name); this.set_bone_parent(index, parent); this.set_group(index, group); this.set_required(index, required); });
    this.set_root_bone('Root'); this.set_scale_base_bone('Hips');
  }
}

export const createGodotSkeletonProfile = (): GodotSkeletonProfile => new GodotSkeletonProfile();
export const createGodotSkeletonProfileHumanoid = (): GodotSkeletonProfileHumanoid => new GodotSkeletonProfileHumanoid();
export const createGodotBoneMap = (): GodotBoneMap => new GodotBoneMap();
