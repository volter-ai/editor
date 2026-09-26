import { Object3D, Quaternion, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';
import { GodotSkeletonModifier3D } from './skeleton-modifiers';
import type { GodotBoneMap } from './skeleton-profile';

export interface GodotRetargetModifierCarrier {
  resolveSourceBone(profileBone: string): Object3D | null;
  resolveTargetBone(skeletonBone: string): Object3D | null;
}

export class GodotRetargetModifier3D extends GodotSkeletonModifier3D {
  private boneMapValue: GodotBoneMap | null = null;
  private sourceSkeletonPathValue = '';
  private useGlobalPoseValue = false;
  private retargetCarrier: GodotRetargetModifierCarrier | null = null;

  constructor() { super('RetargetModifier3D'); }
  set_bone_map(value: GodotBoneMap | null): void { this.boneMapValue = value; }
  get_bone_map(): GodotBoneMap | null { return this.boneMapValue; }
  set_source_skeleton_path(value: string): void {
    if (typeof value !== 'string') throw new TypeError('RetargetModifier3D.source_skeleton_path requires NodePath.');
    this.sourceSkeletonPathValue = value;
  }
  get_source_skeleton_path(): string { return this.sourceSkeletonPathValue; }
  set_use_global_pose(value: boolean): void { this.useGlobalPoseValue = value; }
  is_using_global_pose(): boolean { return this.useGlobalPoseValue; }
  bind_retarget_carrier(value: GodotRetargetModifierCarrier | null): void { this.retargetCarrier = value; }

  protected override applyModifier(delta: number): boolean {
    void delta;
    const map = this.boneMapValue;
    const carrier = this.retargetCarrier;
    if (map === null || carrier === null) return false;
    let changed = false;
    for (const profileBone of map.get_profile_bone_names()) {
      const skeletonBone = map.get_skeleton_bone_name(profileBone);
      const source = carrier.resolveSourceBone(profileBone);
      const target = carrier.resolveTargetBone(skeletonBone);
      if (source === null || target === null) continue;
      if (this.useGlobalPoseValue) {
        source.updateWorldMatrix(true, false);
        const position = source.getWorldPosition(new Vector3());
        const rotation = source.getWorldQuaternion(new Quaternion());
        const scale = source.getWorldScale(new Vector3());
        const parent = target.parent;
        if (parent !== null) {
          parent.updateWorldMatrix(true, false);
          target.position.copy(parent.worldToLocal(position));
          const parentRotation = parent.getWorldQuaternion(new Quaternion()).invert();
          target.quaternion.copy(parentRotation.multiply(rotation));
          const parentScale = parent.getWorldScale(new Vector3());
          target.scale.set(
            parentScale.x === 0 ? 0 : scale.x / parentScale.x,
            parentScale.y === 0 ? 0 : scale.y / parentScale.y,
            parentScale.z === 0 ? 0 : scale.z / parentScale.z,
          );
        } else {
          target.position.copy(position); target.quaternion.copy(rotation); target.scale.copy(scale);
        }
      } else {
        target.position.lerp(source.position, this.get_influence());
        target.quaternion.slerp(source.quaternion, this.get_influence());
        target.scale.lerp(source.scale, this.get_influence());
      }
      changed = true;
    }
    return changed;
  }
}

export interface GodotPhysicalBoneSimulatorCarrier {
  startSimulation(bones: readonly string[]): void;
  stopSimulation(): void;
  isSimulating(): boolean;
  process(delta: number, influence: number): void;
}

export class GodotPhysicalBoneSimulator3D extends GodotSkeletonModifier3D {
  private simulatedBones: string[] = [];
  private simulationActiveValue = false;
  private simulatorCarrier: GodotPhysicalBoneSimulatorCarrier | null = null;

  constructor() { super('PhysicalBoneSimulator3D'); }
  bind_simulator_carrier(value: GodotPhysicalBoneSimulatorCarrier | null): void {
    if (this.simulationActiveValue) this.simulatorCarrier?.stopSimulation();
    this.simulatorCarrier = value;
    if (this.simulationActiveValue) value?.startSimulation(this.simulatedBones);
  }
  physical_bones_start(bones: readonly string[] = []): void {
    if (!Array.isArray(bones) || bones.some((bone) => typeof bone !== 'string')) {
      throw new TypeError('PhysicalBoneSimulator3D.physical_bones_start requires PackedStringArray.');
    }
    this.simulatedBones = [...bones];
    this.simulationActiveValue = true;
    this.simulatorCarrier?.startSimulation(this.simulatedBones);
  }
  physical_bones_stop(): void {
    this.simulationActiveValue = false;
    this.simulatorCarrier?.stopSimulation();
  }
  physical_bones_add_collision_exception(exception: object): void { void exception; }
  physical_bones_remove_collision_exception(exception: object): void { void exception; }
  is_simulating_physics(): boolean { return this.simulatorCarrier?.isSimulating() ?? this.simulationActiveValue; }
  get_simulated_bones(): string[] { return [...this.simulatedBones]; }
  protected override applyModifier(delta: number): boolean {
    if (!this.simulationActiveValue) return false;
    this.simulatorCarrier?.process(delta, this.get_influence());
    return this.simulatorCarrier !== null;
  }
}

export const GodotPhysicalBoneJointType = {
  JOINT_TYPE_NONE: 0,
  JOINT_TYPE_PIN: 1,
  JOINT_TYPE_CONE: 2,
  JOINT_TYPE_HINGE: 3,
  JOINT_TYPE_SLIDER: 4,
  JOINT_TYPE_6DOF: 5,
} as const;

function finite(member: string, value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`${member} requires a finite number.`);
  return value;
}

export class GodotPhysicalBone3D extends Object3D {
  private boneNameValue = '';
  private boneIndexValue = -1;
  private jointTypeValue: number = GodotPhysicalBoneJointType.JOINT_TYPE_NONE;
  private bodyOffsetValue = new Vector3();
  private jointOffsetValue = new Vector3();
  private massValue = 1;
  private frictionValue = 1;
  private bounceValue = 0;
  private gravityScaleValue = 1;
  private linearDampValue = 0;
  private angularDampValue = 0;
  private canSleepValue = true;
  private simulatePhysicsValue = false;
  private staticBodyValue = false;

  constructor() { super(); registerGodotObjectIdentity(this, 'PhysicalBone3D'); }
  set_bone_name(value: string): void { this.boneNameValue = value; }
  get_bone_name(): string { return this.boneNameValue; }
  set_bone_id(value: number): void { if (!Number.isInteger(value) || value < -1) throw new RangeError('PhysicalBone3D.bone_id requires index >= -1.'); this.boneIndexValue = value; }
  get_bone_id(): number { return this.boneIndexValue; }
  set_joint_type(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 5) throw new RangeError('PhysicalBone3D.joint_type is invalid.');
    this.jointTypeValue = value;
  }
  get_joint_type(): number { return this.jointTypeValue; }
  set_body_offset(value: Vector3): void { this.bodyOffsetValue = value.clone(); }
  get_body_offset(): Vector3 { return this.bodyOffsetValue.clone(); }
  set_joint_offset(value: Vector3): void { this.jointOffsetValue = value.clone(); }
  get_joint_offset(): Vector3 { return this.jointOffsetValue.clone(); }
  set_mass(value: number): void { this.massValue = Math.max(0.001, finite('PhysicalBone3D.mass', value)); }
  get_mass(): number { return this.massValue; }
  set_friction(value: number): void { this.frictionValue = Math.max(0, finite('PhysicalBone3D.friction', value)); }
  get_friction(): number { return this.frictionValue; }
  set_bounce(value: number): void { this.bounceValue = Math.max(0, Math.min(1, finite('PhysicalBone3D.bounce', value))); }
  get_bounce(): number { return this.bounceValue; }
  set_gravity_scale(value: number): void { this.gravityScaleValue = finite('PhysicalBone3D.gravity_scale', value); }
  get_gravity_scale(): number { return this.gravityScaleValue; }
  set_linear_damp(value: number): void { this.linearDampValue = Math.max(0, finite('PhysicalBone3D.linear_damp', value)); }
  get_linear_damp(): number { return this.linearDampValue; }
  set_angular_damp(value: number): void { this.angularDampValue = Math.max(0, finite('PhysicalBone3D.angular_damp', value)); }
  get_angular_damp(): number { return this.angularDampValue; }
  set_can_sleep(value: boolean): void { this.canSleepValue = value; }
  is_able_to_sleep(): boolean { return this.canSleepValue; }
  set_simulate_physics(value: boolean): void { this.simulatePhysicsValue = value; }
  get_simulate_physics(): boolean { return this.simulatePhysicsValue; }
  set_static_body(value: boolean): void { this.staticBodyValue = value; }
  is_static_body(): boolean { return this.staticBodyValue; }
  apply_central_impulse(impulse: Vector3): void { this.position.add(impulse.clone().multiplyScalar(1 / this.massValue)); }
  apply_impulse(impulse: Vector3, position = new Vector3()): void { void position; this.apply_central_impulse(impulse); }
}

export const createGodotRetargetModifier3D = (): GodotRetargetModifier3D => new GodotRetargetModifier3D();
export const createGodotPhysicalBoneSimulator3D = (): GodotPhysicalBoneSimulator3D => new GodotPhysicalBoneSimulator3D();
export const createGodotPhysicalBone3D = (): GodotPhysicalBone3D => new GodotPhysicalBone3D();
