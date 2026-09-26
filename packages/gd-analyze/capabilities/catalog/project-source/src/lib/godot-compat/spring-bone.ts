import { Object3D, Quaternion, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';
import { GodotSkeletonModifier3D } from './skeleton-modifiers';

export const GodotSpringBoneRotationAxis = {
  ALL: 0,
  X: 1,
  Y: 2,
  Z: 3,
} as const;

export const GodotSpringBoneCenterFrom = {
  WORLD_ORIGIN: 0,
  NODE: 1,
  BONE: 2,
} as const;

export interface GodotSpringBoneJoint {
  boneName: string;
  boneIndex: number;
  rotationAxis: number;
  radius: number;
  stiffness: number;
  drag: number;
  gravity: number;
  gravityDirection: Vector3;
}

export interface GodotSpringBoneSimulatorCarrier {
  processSpringBones(
    simulator: GodotSpringBoneSimulator3D,
    delta: number,
    joints: readonly GodotSpringBoneJoint[],
    collisions: readonly string[],
  ): boolean;
  reset?(): void;
}

function finite(member: string, value: number, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function index(member: string, value: number, length: number): number {
  if (!Number.isInteger(value) || value < 0 || value >= length) throw new RangeError(`${member} index ${value} is out of range.`);
  return value;
}

function jointDefaults(): GodotSpringBoneJoint {
  return { boneName: '', boneIndex: -1, rotationAxis: 0, radius: 0.02, stiffness: 1, drag: 0.4, gravity: 0, gravityDirection: new Vector3(0, -1, 0) };
}

export class GodotSpringBoneSimulator3D extends GodotSkeletonModifier3D {
  private rootBoneNameValue = '';
  private endBoneNameValue = '';
  private extendEndBoneValue = false;
  private endBoneDirectionValue = new Vector3(0, 1, 0);
  private endBoneLengthValue = 0.1;
  private individualConfigValue = false;
  private centerFromValue: number = GodotSpringBoneCenterFrom.WORLD_ORIGIN;
  private centerNodeValue = '';
  private centerBoneNameValue = '';
  private externalForceValue = new Vector3();
  private readonly joints: GodotSpringBoneJoint[] = [];
  private readonly collisionPaths: string[] = [];
  private springCarrier: GodotSpringBoneSimulatorCarrier | null = null;

  constructor() { super('SpringBoneSimulator3D'); }
  set_root_bone_name(value: string): void { this.rootBoneNameValue = value; }
  get_root_bone_name(): string { return this.rootBoneNameValue; }
  set_end_bone_name(value: string): void { this.endBoneNameValue = value; }
  get_end_bone_name(): string { return this.endBoneNameValue; }
  set_extend_end_bone(value: boolean): void { this.extendEndBoneValue = value; }
  is_end_bone_extended(): boolean { return this.extendEndBoneValue; }
  set_end_bone_direction(value: Vector3): void { this.endBoneDirectionValue = value.clone(); }
  get_end_bone_direction(): Vector3 { return this.endBoneDirectionValue.clone(); }
  set_end_bone_length(value: number): void { this.endBoneLengthValue = finite('SpringBoneSimulator3D.end_bone_length', value, 0); }
  get_end_bone_length(): number { return this.endBoneLengthValue; }
  set_individual_config(value: boolean): void { this.individualConfigValue = value; }
  is_config_individual(): boolean { return this.individualConfigValue; }
  set_center_from(value: number): void {
    if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('SpringBoneSimulator3D.center_from is invalid.');
    this.centerFromValue = value;
  }
  get_center_from(): number { return this.centerFromValue; }
  set_center_node(value: string): void { this.centerNodeValue = value; }
  get_center_node(): string { return this.centerNodeValue; }
  set_center_bone_name(value: string): void { this.centerBoneNameValue = value; }
  get_center_bone_name(): string { return this.centerBoneNameValue; }
  set_external_force(value: Vector3): void { this.externalForceValue = value.clone(); }
  get_external_force(): Vector3 { return this.externalForceValue.clone(); }
  add_external_force(value: Vector3): void { this.externalForceValue.add(value); }
  clear_external_force(): void { this.externalForceValue.set(0, 0, 0); }

  set_joint_count(value: number): void {
    if (!Number.isInteger(value) || value < 0) throw new RangeError('SpringBoneSimulator3D.joint_count requires nonnegative integer.');
    while (this.joints.length < value) this.joints.push(jointDefaults());
    this.joints.length = value;
  }
  get_joint_count(): number { return this.joints.length; }
  set_joint_bone_name(joint: number, value: string): void { this.joints[index('SpringBone joint', joint, this.joints.length)]!.boneName = value; }
  get_joint_bone_name(joint: number): string { return this.joints[index('SpringBone joint', joint, this.joints.length)]!.boneName; }
  set_joint_bone(joint: number, value: number): void {
    if (!Number.isInteger(value) || value < -1) throw new RangeError('SpringBone joint bone requires index >= -1.');
    this.joints[index('SpringBone joint', joint, this.joints.length)]!.boneIndex = value;
  }
  get_joint_bone(joint: number): number { return this.joints[index('SpringBone joint', joint, this.joints.length)]!.boneIndex; }
  set_joint_rotation_axis(joint: number, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 3) throw new RangeError('SpringBone joint rotation axis is invalid.');
    this.joints[index('SpringBone joint', joint, this.joints.length)]!.rotationAxis = value;
  }
  get_joint_rotation_axis(joint: number): number { return this.joints[index('SpringBone joint', joint, this.joints.length)]!.rotationAxis; }
  set_joint_radius(joint: number, value: number): void { this.joints[index('SpringBone joint', joint, this.joints.length)]!.radius = finite('SpringBone joint radius', value, 0); }
  get_joint_radius(joint: number): number { return this.joints[index('SpringBone joint', joint, this.joints.length)]!.radius; }
  set_joint_stiffness(joint: number, value: number): void { this.joints[index('SpringBone joint', joint, this.joints.length)]!.stiffness = finite('SpringBone joint stiffness', value, 0); }
  get_joint_stiffness(joint: number): number { return this.joints[index('SpringBone joint', joint, this.joints.length)]!.stiffness; }
  set_joint_drag(joint: number, value: number): void { this.joints[index('SpringBone joint', joint, this.joints.length)]!.drag = finite('SpringBone joint drag', value, 0, 1); }
  get_joint_drag(joint: number): number { return this.joints[index('SpringBone joint', joint, this.joints.length)]!.drag; }
  set_joint_gravity(joint: number, value: number): void { this.joints[index('SpringBone joint', joint, this.joints.length)]!.gravity = finite('SpringBone joint gravity', value); }
  get_joint_gravity(joint: number): number { return this.joints[index('SpringBone joint', joint, this.joints.length)]!.gravity; }
  set_joint_gravity_direction(joint: number, value: Vector3): void { this.joints[index('SpringBone joint', joint, this.joints.length)]!.gravityDirection = value.clone(); }
  get_joint_gravity_direction(joint: number): Vector3 { return this.joints[index('SpringBone joint', joint, this.joints.length)]!.gravityDirection.clone(); }

  add_collision_path(value: string): void { if (!this.collisionPaths.includes(value)) this.collisionPaths.push(value); }
  remove_collision_path(value: string): void { const found = this.collisionPaths.indexOf(value); if (found >= 0) this.collisionPaths.splice(found, 1); }
  set_collision_path(indexValue: number, value: string): void { this.collisionPaths[index('SpringBone collision path', indexValue, this.collisionPaths.length)] = value; }
  get_collision_path(indexValue: number): string { return this.collisionPaths[index('SpringBone collision path', indexValue, this.collisionPaths.length)]!; }
  get_collision_path_count(): number { return this.collisionPaths.length; }
  clear_collision_paths(): void { this.collisionPaths.length = 0; }
  bind_spring_carrier(value: GodotSpringBoneSimulatorCarrier | null): void { this.springCarrier = value; }
  reset(): void { this.springCarrier?.reset?.(); this.clear_external_force(); }

  protected override applyModifier(delta: number): boolean {
    return this.springCarrier?.processSpringBones(this, delta, this.joints, this.collisionPaths) ?? false;
  }
}

export class GodotSpringBoneCollision3D extends Object3D {
  private boneNameValue = '';
  private boneIndexValue = -1;
  private positionOffsetValue = new Vector3();
  private rotationOffsetValue = new Quaternion();
  constructor(godotClass = 'SpringBoneCollision3D') { super(); registerGodotObjectIdentity(this, godotClass); }
  set_bone_name(value: string): void { this.boneNameValue = value; }
  get_bone_name(): string { return this.boneNameValue; }
  set_bone(value: number): void { if (!Number.isInteger(value) || value < -1) throw new RangeError('SpringBoneCollision3D.bone requires index >= -1.'); this.boneIndexValue = value; }
  get_bone(): number { return this.boneIndexValue; }
  set_position_offset(value: Vector3): void { this.positionOffsetValue = value.clone(); }
  get_position_offset(): Vector3 { return this.positionOffsetValue.clone(); }
  set_rotation_offset(value: Quaternion): void { this.rotationOffsetValue = value.clone().normalize(); }
  get_rotation_offset(): Quaternion { return this.rotationOffsetValue.clone(); }
  get_center(): Vector3 { return this.localToWorld(this.positionOffsetValue.clone()); }
}

export class GodotSpringBoneCollisionSphere3D extends GodotSpringBoneCollision3D {
  private radiusValue = 0.1;
  private insideValue = false;
  constructor() { super('SpringBoneCollisionSphere3D'); }
  set_radius(value: number): void { this.radiusValue = finite('SpringBoneCollisionSphere3D.radius', value, 0); }
  get_radius(): number { return this.radiusValue; }
  set_inside(value: boolean): void { this.insideValue = value; }
  is_inside(): boolean { return this.insideValue; }
}

export class GodotSpringBoneCollisionCapsule3D extends GodotSpringBoneCollision3D {
  private radiusValue = 0.1;
  private heightValue = 0.5;
  private insideValue = false;
  constructor() { super('SpringBoneCollisionCapsule3D'); }
  set_radius(value: number): void { this.radiusValue = finite('SpringBoneCollisionCapsule3D.radius', value, 0); }
  get_radius(): number { return this.radiusValue; }
  set_height(value: number): void { this.heightValue = finite('SpringBoneCollisionCapsule3D.height', value, 0); }
  get_height(): number { return this.heightValue; }
  set_inside(value: boolean): void { this.insideValue = value; }
  is_inside(): boolean { return this.insideValue; }
}

export class GodotSpringBoneCollisionPlane3D extends GodotSpringBoneCollision3D {
  constructor() { super('SpringBoneCollisionPlane3D'); }
  get_normal(): Vector3 { return new Vector3(0, 1, 0).applyQuaternion(this.getWorldQuaternion(new Quaternion())); }
}

export const createGodotSpringBoneSimulator3D = (): GodotSpringBoneSimulator3D => new GodotSpringBoneSimulator3D();
export const createGodotSpringBoneCollisionSphere3D = (): GodotSpringBoneCollisionSphere3D => new GodotSpringBoneCollisionSphere3D();
export const createGodotSpringBoneCollisionCapsule3D = (): GodotSpringBoneCollisionCapsule3D => new GodotSpringBoneCollisionCapsule3D();
export const createGodotSpringBoneCollisionPlane3D = (): GodotSpringBoneCollisionPlane3D => new GodotSpringBoneCollisionPlane3D();
