/** PhysicalBone2D retained node state over a project-owned 2D physics carrier. */

import { Container, Matrix } from 'pixi.js';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';
import type { GodotBone2D } from './skeleton-2d';
import type { GodotTransform2D } from './transform-2d';

export interface GodotPhysicalBone2DCarrier {
  setSimulationEnabled(node: GodotPhysicalBone2D, enabled: boolean): void;
  setJointTransform(node: GodotPhysicalBone2D, offset: { readonly x: number; readonly y: number }, rotation: number): void;
  setBodyTransform(node: GodotPhysicalBone2D, transform: GodotTransform2D): void;
  getBodyTransform(node: GodotPhysicalBone2D): GodotTransform2D | null;
  setBone?(node: GodotPhysicalBone2D, bone: GodotBone2D | null): void;
}

interface Vector2Value { readonly x: number; readonly y: number }

function finite(value: number, member: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`PhysicalBone2D.${member} requires a finite number.`);
  return value;
}

function finiteVector(value: Vector2Value, member: string): Vector2Value {
  if (value === null || typeof value !== 'object') throw new TypeError(`PhysicalBone2D.${member} requires Vector2.`);
  return Object.freeze({ x: finite(Number(value.x), `${member}.x`), y: finite(Number(value.y), `${member}.y`) });
}

function transformMatrix(value: GodotTransform2D): Matrix {
  return new Matrix(value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y);
}

export class GodotPhysicalBone2D extends Container {
  private readonly simulationStartedHandle = createSignal<readonly []>();
  private readonly simulationStoppedHandle = createSignal<readonly []>();
  readonly simulation_started: GodotSignal<readonly []> = this.simulationStartedHandle.signal;
  readonly simulation_stopped: GodotSignal<readonly []> = this.simulationStoppedHandle.signal;

  private jointOffsetValue: Vector2Value = Object.freeze({ x: 0, y: 0 });
  private jointRotationValue = 0;
  private boneNodePathValue = '';
  private followBoneWhenSimulatingValue = false;
  private simulatePhysicsValue = false;
  private boneValue: GodotBone2D | null = null;

  constructor(private readonly carrier: GodotPhysicalBone2DCarrier) {
    super();
    if (carrier === null || typeof carrier !== 'object') throw new TypeError('PhysicalBone2D requires a physics carrier.');
    registerGodotObjectIdentity(this, 'PhysicalBone2D');
  }

  set_joint_offset(value: Vector2Value): void {
    const offset = finiteVector(value, 'joint_offset');
    if (offset.x === this.jointOffsetValue.x && offset.y === this.jointOffsetValue.y) return;
    this.jointOffsetValue = offset;
    this.syncJoint();
  }

  get_joint_offset(): Vector2Value {
    return { x: this.jointOffsetValue.x, y: this.jointOffsetValue.y };
  }

  set_joint_rotation(value: number): void {
    const rotation = finite(value, 'joint_rotation');
    if (rotation === this.jointRotationValue) return;
    this.jointRotationValue = rotation;
    this.syncJoint();
  }

  get_joint_rotation(): number { return this.jointRotationValue; }

  set_bone2d_nodepath(value: string): void {
    if (typeof value !== 'string') throw new TypeError('PhysicalBone2D.bone2d_nodepath requires NodePath.');
    this.boneNodePathValue = value;
  }

  get_bone2d_nodepath(): string { return this.boneNodePathValue; }

  set_follow_bone_when_simulating(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('PhysicalBone2D.follow_bone_when_simulating requires bool.');
    this.followBoneWhenSimulatingValue = value;
    if (value && this.simulatePhysicsValue) this.pushBoneTransform();
  }

  get_follow_bone_when_simulating(): boolean { return this.followBoneWhenSimulatingValue; }

  set_simulate_physics(value: boolean): void {
    if (typeof value !== 'boolean') throw new TypeError('PhysicalBone2D.simulate_physics requires bool.');
    if (value === this.simulatePhysicsValue) return;
    if (value) this.pushBoneTransform();
    this.simulatePhysicsValue = value;
    this.carrier.setSimulationEnabled(this, value);
    if (value) this.simulationStartedHandle.emit();
    else {
      this.pullBodyTransform();
      this.simulationStoppedHandle.emit();
    }
  }

  get_simulate_physics(): boolean { return this.simulatePhysicsValue; }
  is_simulating_physics(): boolean { return this.simulatePhysicsValue; }

  set_bone2d_node(bone: GodotBone2D | null): void {
    if (bone !== null && !(bone instanceof Container)) throw new TypeError('PhysicalBone2D bone requires Bone2D.');
    if (bone === this.boneValue) return;
    this.boneValue = bone;
    this.carrier.setBone?.(this, bone);
    if (bone !== null && (!this.simulatePhysicsValue || this.followBoneWhenSimulatingValue)) this.pushBoneTransform();
  }

  get_bone2d_node(): GodotBone2D | null { return this.boneValue; }

  process_physics_transform(): void {
    if (!this.simulatePhysicsValue) {
      this.pushBoneTransform();
      return;
    }
    if (this.followBoneWhenSimulatingValue) this.pushBoneTransform();
    else this.pullBodyTransform();
  }

  reset_to_bone_transform(): void {
    this.pushBoneTransform();
  }

  apply_body_transform_to_bone(): void {
    this.pullBodyTransform();
  }

  private syncJoint(): void {
    this.carrier.setJointTransform(this, this.jointOffsetValue, this.jointRotationValue);
  }

  private pushBoneTransform(): void {
    const bone = this.boneValue;
    if (bone === null) return;
    const matrix = bone.localTransform;
    this.carrier.setBodyTransform(this, {
      x: { x: matrix.a, y: matrix.b },
      y: { x: matrix.c, y: matrix.d },
      origin: { x: matrix.tx, y: matrix.ty },
    });
  }

  private pullBodyTransform(): void {
    const transform = this.carrier.getBodyTransform(this);
    if (transform === null) return;
    this.setFromMatrix(transformMatrix(transform));
    if (this.boneValue !== null) this.boneValue.setFromMatrix(transformMatrix(transform));
  }
}

export function createGodotPhysicalBone2D(carrier: GodotPhysicalBone2DCarrier): GodotPhysicalBone2D {
  return new GodotPhysicalBone2D(carrier);
}
