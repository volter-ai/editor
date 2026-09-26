/** BoneAttachment2D follows a retained Bone2D without creating a mirror hierarchy. */

import { Container, Matrix } from 'pixi.js';
import { registerGodotObjectIdentity } from './object';
import { createSignal, type GodotSignal } from './signal';
import type { GodotBone2D } from './skeleton-2d';
import type { GodotTransform2D } from './transform-2d';

export interface GodotBoneAttachment2DResolver {
  resolveBone(path: string, attachment: GodotBoneAttachment2D): GodotBone2D | null;
}

function pathValue(value: string): string {
  if (typeof value !== 'string') throw new TypeError('BoneAttachment2D.bone2d_nodepath requires NodePath.');
  return value;
}

function transformMatrix(value: GodotTransform2D): Matrix {
  if (value === null || typeof value !== 'object') throw new TypeError('BoneAttachment2D override pose requires Transform2D.');
  const channels = [value.x.x, value.x.y, value.y.x, value.y.y, value.origin.x, value.origin.y];
  if (!channels.every(Number.isFinite)) throw new TypeError('BoneAttachment2D override pose requires finite Transform2D components.');
  return new Matrix(...channels as [number, number, number, number, number, number]);
}

function copyMatrix(matrix: Matrix): Matrix {
  return new Matrix(matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty);
}

export class GodotBoneAttachment2D extends Container {
  private readonly boneBoundHandle = createSignal<readonly [GodotBone2D]>();
  private readonly boneUnboundHandle = createSignal<readonly []>();
  readonly bone_bound: GodotSignal<readonly [GodotBone2D]> = this.boneBoundHandle.signal;
  readonly bone_unbound: GodotSignal<readonly []> = this.boneUnboundHandle.signal;

  private boneNodePathValue = '';
  private boneValue: GodotBone2D | null = null;
  private overridePoseValue = false;
  private overrideTransformValue = new Matrix();
  private followingValue = true;
  private rebindRequired = false;

  constructor(private readonly resolver: GodotBoneAttachment2DResolver | null = null) {
    super();
    registerGodotObjectIdentity(this, 'BoneAttachment2D');
  }

  set_bone2d_nodepath(value: string): void {
    const path = pathValue(value);
    if (path === this.boneNodePathValue && !this.rebindRequired) return;
    this.boneNodePathValue = path;
    this.rebindRequired = true;
    this.rebind();
  }

  get_bone2d_nodepath(): string { return this.boneNodePathValue; }

  set_bone2d_node(bone: GodotBone2D | null): void {
    if (bone !== null && !(bone instanceof Container)) throw new TypeError('BoneAttachment2D requires Bone2D.');
    if (bone === this.boneValue) {
      this.rebindRequired = false;
      return;
    }
    if (this.boneValue !== null) this.boneUnboundHandle.emit();
    this.boneValue = bone;
    this.rebindRequired = false;
    if (bone !== null) {
      this.boneBoundHandle.emit(bone);
      this.update_attachment_transform();
    }
  }

  get_bone2d_node(): GodotBone2D | null { return this.boneValue; }

  notify_rebind_required(): void {
    this.rebindRequired = true;
  }

  rebind(): boolean {
    if (!this.rebindRequired) return this.boneValue !== null;
    if (this.resolver === null || this.boneNodePathValue === '') {
      this.set_bone2d_node(null);
      return false;
    }
    this.set_bone2d_node(this.resolver.resolveBone(this.boneNodePathValue, this));
    return this.boneValue !== null;
  }

  set_override_pose(enable: boolean): void {
    if (typeof enable !== 'boolean') throw new TypeError('BoneAttachment2D.override_pose requires bool.');
    if (enable === this.overridePoseValue) return;
    this.overridePoseValue = enable;
    if (enable) this.overrideTransformValue = copyMatrix(this.localTransform);
    this.update_attachment_transform();
  }

  get_override_pose(): boolean { return this.overridePoseValue; }

  set_override_transform(transform: GodotTransform2D): void {
    this.overrideTransformValue = transformMatrix(transform);
    if (this.overridePoseValue) this.update_attachment_transform();
  }

  get_override_transform(): GodotTransform2D {
    const matrix = this.overrideTransformValue;
    return {
      x: { x: matrix.a, y: matrix.b },
      y: { x: matrix.c, y: matrix.d },
      origin: { x: matrix.tx, y: matrix.ty },
    };
  }

  set_follow_bone(enable: boolean): void {
    if (typeof enable !== 'boolean') throw new TypeError('BoneAttachment2D.follow_bone requires bool.');
    this.followingValue = enable;
    if (enable) this.update_attachment_transform();
  }

  is_following_bone(): boolean { return this.followingValue; }

  update_attachment_transform(): void {
    if (!this.followingValue) return;
    if (this.rebindRequired) this.rebind();
    const bone = this.boneValue;
    if (bone === null) return;
    const transform = this.overridePoseValue
      ? copyMatrix(bone.localTransform).append(this.overrideTransformValue)
      : copyMatrix(bone.localTransform);
    this.setFromMatrix(transform);
  }

  apply_attachment_pose_to_bone(): void {
    if (!this.overridePoseValue || this.boneValue === null) return;
    this.boneValue.setFromMatrix(copyMatrix(this.localTransform));
  }

  detach_bone(): void {
    this.set_bone2d_node(null);
  }
}

export function createGodotBoneAttachment2D(
  resolver: GodotBoneAttachment2DResolver | null = null,
): GodotBoneAttachment2D {
  return new GodotBoneAttachment2D(resolver);
}
