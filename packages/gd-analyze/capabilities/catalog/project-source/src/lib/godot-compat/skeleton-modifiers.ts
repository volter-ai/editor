import { Object3D, Quaternion, Vector3 } from 'three';
import { registerGodotObjectIdentity } from './object';

export const GodotSkeletonModifierCallbackMode = {
  PROCESS_PHYSICS: 0,
  PROCESS_IDLE: 1,
} as const;

export const GodotLookAtModifierForwardAxis = {
  FORWARD_AXIS_X: 0,
  FORWARD_AXIS_Y: 1,
  FORWARD_AXIS_Z: 2,
  FORWARD_AXIS_NEGATIVE_X: 3,
  FORWARD_AXIS_NEGATIVE_Y: 4,
  FORWARD_AXIS_NEGATIVE_Z: 5,
} as const;

export const GodotLookAtModifierPrimaryRotationAxis = {
  ROTATION_AXIS_X: 0,
  ROTATION_AXIS_Y: 1,
  ROTATION_AXIS_Z: 2,
} as const;

export interface GodotSkeletonModifierCarrier {
  resolveBone(name: string, index: number): Object3D | null;
  resolveNode(path: string): Object3D | null;
  processLookAt?(modifier: GodotLookAtModifier3D, delta: number): boolean;
  processTwoBoneIK?(modifier: GodotTwoBoneIK3D, delta: number): boolean;
}

function finite(member: string, value: number, minimum = -Infinity, maximum = Infinity): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${member} requires a finite value in [${minimum}, ${maximum}].`);
  }
  return value;
}

function path(member: string, value: string): string {
  if (typeof value !== 'string') throw new TypeError(`${member} requires NodePath/StringName.`);
  return value;
}

export class GodotSkeletonModifier3D extends Object3D {
  private activeValue = true;
  private influenceValue = 1;
  private skeletonPathValue = '..';
  private callbackModeValue: number = GodotSkeletonModifierCallbackMode.PROCESS_IDLE;
  protected carrier: GodotSkeletonModifierCarrier | null = null;

  constructor(godotClass = 'SkeletonModifier3D') {
    super();
    registerGodotObjectIdentity(this, godotClass);
  }

  set_active(value: boolean): void { this.activeValue = value; }
  is_active(): boolean { return this.activeValue; }
  set_influence(value: number): void { this.influenceValue = finite('SkeletonModifier3D.influence', value, 0, 1); }
  get_influence(): number { return this.influenceValue; }
  set_skeleton_path(value: string): void { this.skeletonPathValue = path('SkeletonModifier3D.skeleton_path', value); }
  get_skeleton_path(): string { return this.skeletonPathValue; }
  set_callback_mode_process(value: number): void {
    if (value !== 0 && value !== 1) throw new RangeError('SkeletonModifier3D.callback_mode_process requires PHYSICS or IDLE.');
    this.callbackModeValue = value;
  }
  get_callback_mode_process(): number { return this.callbackModeValue; }
  bind_carrier(value: GodotSkeletonModifierCarrier | null): void { this.carrier = value; }
  get_carrier(): GodotSkeletonModifierCarrier | null { return this.carrier; }
  process_modification(delta: number): boolean {
    if (!this.activeValue || this.influenceValue <= 0) return false;
    return this.applyModifier(finite('SkeletonModifier3D delta', delta, 0));
  }
  protected applyModifier(delta: number): boolean { void delta; return false; }
}

export class GodotLookAtModifier3D extends GodotSkeletonModifier3D {
  private targetNodeValue = '';
  private boneNameValue = '';
  private boneIndexValue = -1;
  private forwardAxisValue: number = GodotLookAtModifierForwardAxis.FORWARD_AXIS_NEGATIVE_Z;
  private primaryRotationAxisValue: number = GodotLookAtModifierPrimaryRotationAxis.ROTATION_AXIS_Y;
  private useAngleLimitationValue = false;
  private symmetryLimitationValue = false;
  private primaryLimitAngleValue = Math.PI / 2;
  private primaryDampThresholdValue = 1;
  private secondaryLimitAngleValue = Math.PI / 2;
  private secondaryDampThresholdValue = 1;
  private durationValue = 0;
  private transitionTypeValue = 0;
  private easeTypeValue = 0;

  constructor() { super('LookAtModifier3D'); }
  set_target_node(value: string): void { this.targetNodeValue = path('LookAtModifier3D.target_node', value); }
  get_target_node(): string { return this.targetNodeValue; }
  set_bone_name(value: string): void { this.boneNameValue = path('LookAtModifier3D.bone_name', value); }
  get_bone_name(): string { return this.boneNameValue; }
  set_bone(value: number): void {
    if (!Number.isInteger(value) || value < -1) throw new RangeError('LookAtModifier3D.bone requires an index >= -1.');
    this.boneIndexValue = value;
  }
  get_bone(): number { return this.boneIndexValue; }
  set_forward_axis(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 5) throw new RangeError('LookAtModifier3D.forward_axis is invalid.');
    this.forwardAxisValue = value;
  }
  get_forward_axis(): number { return this.forwardAxisValue; }
  set_primary_rotation_axis(value: number): void {
    if (value !== 0 && value !== 1 && value !== 2) throw new RangeError('LookAtModifier3D.primary_rotation_axis is invalid.');
    this.primaryRotationAxisValue = value;
  }
  get_primary_rotation_axis(): number { return this.primaryRotationAxisValue; }
  set_use_angle_limitation(value: boolean): void { this.useAngleLimitationValue = value; }
  is_using_angle_limitation(): boolean { return this.useAngleLimitationValue; }
  set_symmetry_limitation(value: boolean): void { this.symmetryLimitationValue = value; }
  is_limitation_using_symmetry(): boolean { return this.symmetryLimitationValue; }
  set_primary_limit_angle(value: number): void { this.primaryLimitAngleValue = finite('LookAtModifier3D.primary_limit_angle', value, 0, Math.PI); }
  get_primary_limit_angle(): number { return this.primaryLimitAngleValue; }
  set_primary_damp_threshold(value: number): void { this.primaryDampThresholdValue = finite('LookAtModifier3D.primary_damp_threshold', value, 0, 1); }
  get_primary_damp_threshold(): number { return this.primaryDampThresholdValue; }
  set_secondary_limit_angle(value: number): void { this.secondaryLimitAngleValue = finite('LookAtModifier3D.secondary_limit_angle', value, 0, Math.PI); }
  get_secondary_limit_angle(): number { return this.secondaryLimitAngleValue; }
  set_secondary_damp_threshold(value: number): void { this.secondaryDampThresholdValue = finite('LookAtModifier3D.secondary_damp_threshold', value, 0, 1); }
  get_secondary_damp_threshold(): number { return this.secondaryDampThresholdValue; }
  set_duration(value: number): void { this.durationValue = finite('LookAtModifier3D.duration', value, 0); }
  get_duration(): number { return this.durationValue; }
  set_transition_type(value: number): void { this.transitionTypeValue = Math.trunc(finite('LookAtModifier3D.transition_type', value, 0)); }
  get_transition_type(): number { return this.transitionTypeValue; }
  set_ease_type(value: number): void { this.easeTypeValue = Math.trunc(finite('LookAtModifier3D.ease_type', value, 0)); }
  get_ease_type(): number { return this.easeTypeValue; }

  protected override applyModifier(delta: number): boolean {
    if (this.carrier?.processLookAt?.(this, delta) === true) return true;
    const bone = this.carrier?.resolveBone(this.boneNameValue, this.boneIndexValue) ?? null;
    const target = this.carrier?.resolveNode(this.targetNodeValue) ?? null;
    if (bone === null || target === null) return false;
    const targetPosition = target.getWorldPosition(new Vector3());
    const previous = bone.quaternion.clone();
    bone.lookAt(targetPosition);
    const desired = bone.quaternion.clone();
    bone.quaternion.copy(previous).slerp(desired, this.get_influence());
    return true;
  }
}

export class GodotTwoBoneIK3D extends GodotSkeletonModifier3D {
  private rootBoneNameValue = '';
  private tipBoneNameValue = '';
  private targetNodeValue = '';
  private poleNodeValue = '';
  private targetPositionValue = new Vector3();
  private targetRotationValue = new Quaternion();
  private useTargetRotationValue = false;
  private useMagnetValue = false;
  private magnetPositionValue = new Vector3();

  constructor() { super('TwoBoneIK3D'); }
  set_root_bone_name(value: string): void { this.rootBoneNameValue = path('TwoBoneIK3D.root_bone_name', value); }
  get_root_bone_name(): string { return this.rootBoneNameValue; }
  set_tip_bone_name(value: string): void { this.tipBoneNameValue = path('TwoBoneIK3D.tip_bone_name', value); }
  get_tip_bone_name(): string { return this.tipBoneNameValue; }
  set_target_node(value: string): void { this.targetNodeValue = path('TwoBoneIK3D.target_node', value); }
  get_target_node(): string { return this.targetNodeValue; }
  set_pole_node(value: string): void { this.poleNodeValue = path('TwoBoneIK3D.pole_node', value); }
  get_pole_node(): string { return this.poleNodeValue; }
  set_target_position(value: Vector3): void { this.targetPositionValue = value.clone(); }
  get_target_position(): Vector3 { return this.targetPositionValue.clone(); }
  set_target_rotation(value: Quaternion): void { this.targetRotationValue = value.clone().normalize(); }
  get_target_rotation(): Quaternion { return this.targetRotationValue.clone(); }
  set_use_target_rotation(value: boolean): void { this.useTargetRotationValue = value; }
  is_using_target_rotation(): boolean { return this.useTargetRotationValue; }
  set_use_magnet(value: boolean): void { this.useMagnetValue = value; }
  is_using_magnet(): boolean { return this.useMagnetValue; }
  set_magnet_position(value: Vector3): void { this.magnetPositionValue = value.clone(); }
  get_magnet_position(): Vector3 { return this.magnetPositionValue.clone(); }

  protected override applyModifier(delta: number): boolean {
    if (this.carrier?.processTwoBoneIK?.(this, delta) === true) return true;
    const root = this.carrier?.resolveBone(this.rootBoneNameValue, -1) ?? null;
    const tip = this.carrier?.resolveBone(this.tipBoneNameValue, -1) ?? null;
    const targetNode = this.carrier?.resolveNode(this.targetNodeValue) ?? null;
    if (root === null || tip === null) return false;
    const target = targetNode?.getWorldPosition(new Vector3()) ?? this.targetPositionValue.clone();
    const rootPrevious = root.quaternion.clone(); root.lookAt(target);
    const rootDesired = root.quaternion.clone();
    root.quaternion.copy(rootPrevious).slerp(rootDesired, this.get_influence());
    if (this.useTargetRotationValue) tip.quaternion.slerp(this.targetRotationValue, this.get_influence());
    return true;
  }
}

export class GodotModifierBoneTarget3D extends Object3D {
  private boneNameValue = '';
  private boneIndexValue = -1;
  constructor() { super(); registerGodotObjectIdentity(this, 'ModifierBoneTarget3D'); }
  set_bone_name(value: string): void { this.boneNameValue = path('ModifierBoneTarget3D.bone_name', value); }
  get_bone_name(): string { return this.boneNameValue; }
  set_bone(value: number): void { if (!Number.isInteger(value) || value < -1) throw new RangeError('ModifierBoneTarget3D.bone requires index >= -1.'); this.boneIndexValue = value; }
  get_bone(): number { return this.boneIndexValue; }
}

export const createGodotLookAtModifier3D = (): GodotLookAtModifier3D => new GodotLookAtModifier3D();
export const createGodotTwoBoneIK3D = (): GodotTwoBoneIK3D => new GodotTwoBoneIK3D();
export const createGodotModifierBoneTarget3D = (): GodotModifierBoneTarget3D => new GodotModifierBoneTarget3D();
