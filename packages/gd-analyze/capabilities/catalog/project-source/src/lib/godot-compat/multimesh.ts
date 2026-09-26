/**
 * Retained Godot 3/4 MultiMesh Resource state shared by native 2D and 3D views.
 *
 * The allocation and packed-buffer rules follow Godot's MultiMesh resource/rendering-server
 * contract: changing instance_count reallocates instance data, formats are immutable while data is
 * allocated, 2D transforms occupy two padded vec4 rows and 3D transforms occupy three. A view is
 * an observer of this Resource; assigning the same MultiMesh to another node never copies it.
 */

import { Box3, BufferGeometry, Matrix4, Vector3 } from 'three';
import { aabb, type GodotAabb } from './aabb';
import type { GodotTransform2D } from './transform-2d';
import type { ColorValue } from './variant';
import type { Transform } from './variant-3d';
import { registerGodotObjectIdentity } from './object';
import {
  bindGodotResourceProtocol,
  duplicateGodotSubresource,
  godotResourceEmitChanged,
} from './resource-io';

export const MULTIMESH_TRANSFORM_2D = 0;
export const MULTIMESH_TRANSFORM_3D = 1;
export const MULTIMESH_FORMAT_NONE = 0;
export const MULTIMESH_FORMAT_8BIT = 1;
export const MULTIMESH_FORMAT_FLOAT = 2;
export const MULTIMESH_INTERP_QUALITY_FAST = 0;
export const MULTIMESH_INTERP_QUALITY_HIGH = 1;

export type MultiMeshChange =
  | { readonly kind: 'allocation' }
  | { readonly kind: 'mesh' }
  | { readonly kind: 'visible' }
  | { readonly kind: 'transform'; readonly index: number }
  | { readonly kind: 'color'; readonly index: number }
  | { readonly kind: 'custom-data'; readonly index: number }
  | { readonly kind: 'buffer' };

export interface GodotMultiMeshOptions {
  readonly major?: 3 | 4;
  readonly mesh?: unknown | null;
  readonly transformFormat?: number;
  readonly colorFormat?: number;
  readonly customDataFormat?: number;
  readonly useColors?: boolean;
  readonly useCustomData?: boolean;
  readonly instanceCount?: number;
  readonly visibleInstanceCount?: number;
}

const WHITE: ColorValue = Object.freeze({ r: 1, g: 1, b: 1, a: 1 });
const ZERO: ColorValue = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

function integer(value: number, member: string): number {
  if (!Number.isSafeInteger(value)) throw new TypeError(`MultiMesh.${member} must be an integer.`);
  return value;
}

function format(value: number, member: string): number {
  value = integer(value, member);
  if (value < MULTIMESH_FORMAT_NONE || value > MULTIMESH_FORMAT_FLOAT) {
    throw new RangeError(`MultiMesh.${member} has unknown format ${value}.`);
  }
  return value;
}

function transformFormat(value: number): number {
  value = integer(value, 'transform_format');
  if (value !== MULTIMESH_TRANSFORM_2D && value !== MULTIMESH_TRANSFORM_3D) {
    throw new RangeError(`MultiMesh.transform_format has unknown format ${value}.`);
  }
  return value;
}

function identity2D(): GodotTransform2D {
  return { x: { x: 1, y: 0 }, y: { x: 0, y: 1 }, origin: { x: 0, y: 0 } };
}

function identity3D(): Transform {
  return {
    basis: [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    origin: { x: 0, y: 0, z: 0 },
  };
}

function copy2D(value: GodotTransform2D): GodotTransform2D {
  return { x: { ...value.x }, y: { ...value.y }, origin: { ...value.origin } };
}

function copy3D(value: Transform): Transform {
  return {
    basis: [
      { ...value.basis[0] }, { ...value.basis[1] }, { ...value.basis[2] },
    ],
    origin: { ...value.origin },
  };
}

function copyColor(value: ColorValue): ColorValue { return { ...value }; }

function matrix3D(value: Transform): Matrix4 {
  return new Matrix4().set(
    value.basis[0].x, value.basis[1].x, value.basis[2].x, value.origin.x,
    value.basis[0].y, value.basis[1].y, value.basis[2].y, value.origin.y,
    value.basis[0].z, value.basis[1].z, value.basis[2].z, value.origin.z,
    0, 0, 0, 1,
  );
}

function matrix2D(value: GodotTransform2D): Matrix4 {
  return new Matrix4().set(
    value.x.x, value.y.x, 0, value.origin.x,
    value.x.y, value.y.y, 0, value.origin.y,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
}

export class GodotMultiMesh {
  private readonly majorValue: 3 | 4;
  private meshValue: unknown | null;
  private transformFormatValue: number;
  private colorFormatValue: number;
  private customDataFormatValue: number;
  private useColorsValue: boolean;
  private useCustomDataValue: boolean;
  private visibleCountValue: number;
  private transforms2D: GodotTransform2D[] = [];
  private transforms3D: Transform[] = [];
  private colors: ColorValue[] = [];
  private customData: ColorValue[] = [];
  private previousTransforms2D: GodotTransform2D[] = [];
  private previousTransforms3D: Transform[] = [];
  private interpolationQualityValue = MULTIMESH_INTERP_QUALITY_FAST;
  private customAabbValue: GodotAabb | null = null;
  private readonly listeners = new Set<(change: MultiMeshChange) => void>();

  public constructor(options: GodotMultiMeshOptions = {}) {
    this.majorValue = options.major ?? 4;
    this.meshValue = options.mesh ?? null;
    this.transformFormatValue = transformFormat(options.transformFormat ?? MULTIMESH_TRANSFORM_2D);
    this.colorFormatValue = this.majorValue === 3
      ? format(options.colorFormat ?? MULTIMESH_FORMAT_NONE, 'color_format')
      : (options.useColors === true ? MULTIMESH_FORMAT_FLOAT : MULTIMESH_FORMAT_NONE);
    this.customDataFormatValue = this.majorValue === 3
      ? format(options.customDataFormat ?? MULTIMESH_FORMAT_NONE, 'custom_data_format')
      : (options.useCustomData === true ? MULTIMESH_FORMAT_FLOAT : MULTIMESH_FORMAT_NONE);
    this.useColorsValue = this.majorValue === 4 ? options.useColors === true : this.colorFormatValue !== 0;
    this.useCustomDataValue = this.majorValue === 4 ? options.useCustomData === true : this.customDataFormatValue !== 0;
    this.visibleCountValue = -1;
    registerGodotObjectIdentity(this, 'MultiMesh');
    bindGodotResourceProtocol<GodotMultiMesh>(this, {
      createDuplicate: (source, deep, memo) => {
        const duplicate = new GodotMultiMesh({
          major: source.majorValue,
          mesh: deep && source.meshValue !== null
            ? duplicateGodotSubresource(source.meshValue, memo)
            : source.meshValue,
          transformFormat: source.transformFormatValue,
          colorFormat: source.colorFormatValue,
          customDataFormat: source.customDataFormatValue,
          useColors: source.useColorsValue,
          useCustomData: source.useCustomDataValue,
        });
        duplicate.allocate(source.instance_count);
        duplicate.visibleCountValue = source.visibleCountValue;
        duplicate.transforms2D = source.transforms2D.map(copy2D);
        duplicate.transforms3D = source.transforms3D.map(copy3D);
        duplicate.colors = source.colors.map(copyColor);
        duplicate.customData = source.customData.map(copyColor);
        duplicate.previousTransforms2D = source.previousTransforms2D.map(copy2D);
        duplicate.previousTransforms3D = source.previousTransforms3D.map(copy3D);
        duplicate.interpolationQualityValue = source.interpolationQualityValue;
        duplicate.customAabbValue = source.customAabbValue === null
          ? null
          : aabb(source.customAabbValue.position, source.customAabbValue.size);
        return duplicate;
      },
    });
    this.allocate(options.instanceCount ?? 0);
    this.set_visible_instance_count(options.visibleInstanceCount ?? -1);
  }

  public get mesh(): unknown | null { return this.meshValue; }
  public set mesh(value: unknown | null) { this.set_mesh(value); }
  public get instance_count(): number { return this.transforms2D.length; }
  public set instance_count(value: number) { this.set_instance_count(value); }
  public get visible_instance_count(): number { return this.visibleCountValue; }
  public set visible_instance_count(value: number) { this.set_visible_instance_count(value); }
  public get transform_format(): number { return this.transformFormatValue; }
  public set transform_format(value: number) { this.set_transform_format(value); }
  public get color_format(): number { return this.colorFormatValue; }
  public set color_format(value: number) { this.set_color_format(value); }
  public get custom_data_format(): number { return this.customDataFormatValue; }
  public set custom_data_format(value: number) { this.set_custom_data_format(value); }
  public get use_colors(): boolean { return this.useColorsValue; }
  public set use_colors(value: boolean) { this.set_use_colors(value); }
  public get use_custom_data(): boolean { return this.useCustomDataValue; }
  public set use_custom_data(value: boolean) { this.set_use_custom_data(value); }
  public get buffer(): Float32Array { return this.get_buffer(); }
  public set buffer(value: ArrayLike<number>) { this.set_buffer(value); }
  public get physics_interpolation_quality(): number { return this.get_physics_interpolation_quality(); }
  public set physics_interpolation_quality(value: number) { this.set_physics_interpolation_quality(value); }
  public get custom_aabb(): GodotAabb { return this.get_custom_aabb(); }
  public set custom_aabb(value: GodotAabb) { this.set_custom_aabb(value); }

  public set_mesh(value: unknown | null): void {
    if (this.meshValue === value) return;
    this.meshValue = value;
    this.changed({ kind: 'mesh' });
  }
  public get_mesh(): unknown | null { return this.meshValue; }

  public set_instance_count(value: number): void { this.allocate(value); }
  public get_instance_count(): number { return this.instance_count; }

  public set_visible_instance_count(value: number): void {
    value = integer(value, 'visible_instance_count');
    if (value < -1 || (this.majorValue === 4 && value > this.instance_count)) {
      throw new RangeError(this.majorValue === 4
        ? 'MultiMesh.visible_instance_count must be -1 through instance_count.'
        : 'MultiMesh.visible_instance_count must be -1 or greater.');
    }
    if (this.visibleCountValue === value) return;
    this.visibleCountValue = value;
    this.changed({ kind: 'visible' });
  }
  public get_visible_instance_count(): number { return this.visibleCountValue; }

  public set_transform_format(value: number): void {
    this.assertUnallocated('transform_format');
    value = transformFormat(value);
    if (value === this.transformFormatValue) return;
    this.transformFormatValue = value;
    this.changed({ kind: 'allocation' });
  }
  public get_transform_format(): number { return this.transformFormatValue; }

  public set_color_format(value: number): void {
    if (this.majorValue !== 3) throw new Error('MultiMesh.color_format is a Godot 3 property; use use_colors in Godot 4.');
    this.assertUnallocated('color_format');
    value = format(value, 'color_format');
    if (value === this.colorFormatValue) return;
    this.colorFormatValue = value;
    this.useColorsValue = value !== MULTIMESH_FORMAT_NONE;
    this.changed({ kind: 'allocation' });
  }
  public get_color_format(): number { return this.colorFormatValue; }

  public set_custom_data_format(value: number): void {
    if (this.majorValue !== 3) throw new Error('MultiMesh.custom_data_format is a Godot 3 property; use use_custom_data in Godot 4.');
    this.assertUnallocated('custom_data_format');
    value = format(value, 'custom_data_format');
    if (value === this.customDataFormatValue) return;
    this.customDataFormatValue = value;
    this.useCustomDataValue = value !== MULTIMESH_FORMAT_NONE;
    this.changed({ kind: 'allocation' });
  }
  public get_custom_data_format(): number { return this.customDataFormatValue; }

  public set_use_colors(value: boolean): void {
    if (this.majorValue !== 4) {
      this.set_color_format(value ? MULTIMESH_FORMAT_FLOAT : MULTIMESH_FORMAT_NONE);
      return;
    }
    this.assertUnallocated('use_colors');
    if (this.useColorsValue === value) return;
    this.useColorsValue = value;
    this.colorFormatValue = value ? MULTIMESH_FORMAT_FLOAT : MULTIMESH_FORMAT_NONE;
    this.changed({ kind: 'allocation' });
  }
  public is_using_colors(): boolean { return this.useColorsValue; }

  public set_use_custom_data(value: boolean): void {
    if (this.majorValue !== 4) {
      this.set_custom_data_format(value ? MULTIMESH_FORMAT_FLOAT : MULTIMESH_FORMAT_NONE);
      return;
    }
    this.assertUnallocated('use_custom_data');
    if (this.useCustomDataValue === value) return;
    this.useCustomDataValue = value;
    this.customDataFormatValue = value ? MULTIMESH_FORMAT_FLOAT : MULTIMESH_FORMAT_NONE;
    this.changed({ kind: 'allocation' });
  }
  public is_using_custom_data(): boolean { return this.useCustomDataValue; }

  public set_instance_transform(index: number, value: Transform): void {
    if (this.transformFormatValue !== MULTIMESH_TRANSFORM_3D) throw new Error('MultiMesh transform_format is not TRANSFORM_3D.');
    index = this.index(index);
    this.transforms3D[index] = copy3D(value);
    this.changed({ kind: 'transform', index });
  }
  public get_instance_transform(index: number): Transform {
    if (this.transformFormatValue !== MULTIMESH_TRANSFORM_3D) throw new Error('MultiMesh transform_format is not TRANSFORM_3D.');
    return copy3D(this.transforms3D[this.index(index)] as Transform);
  }

  public set_instance_transform_2d(index: number, value: GodotTransform2D): void {
    if (this.transformFormatValue !== MULTIMESH_TRANSFORM_2D) throw new Error('MultiMesh transform_format is not TRANSFORM_2D.');
    index = this.index(index);
    this.transforms2D[index] = copy2D(value);
    this.changed({ kind: 'transform', index });
  }
  public get_instance_transform_2d(index: number): GodotTransform2D {
    if (this.transformFormatValue !== MULTIMESH_TRANSFORM_2D) throw new Error('MultiMesh transform_format is not TRANSFORM_2D.');
    return copy2D(this.transforms2D[this.index(index)] as GodotTransform2D);
  }

  public set_instance_color(index: number, value: ColorValue): void {
    if (!this.useColorsValue) throw new Error('MultiMesh per-instance colors are not enabled.');
    index = this.index(index);
    this.colors[index] = copyColor(value);
    this.changed({ kind: 'color', index });
  }
  public get_instance_color(index: number): ColorValue {
    if (!this.useColorsValue) throw new Error('MultiMesh per-instance colors are not enabled.');
    return copyColor(this.colors[this.index(index)] as ColorValue);
  }

  public set_instance_custom_data(index: number, value: ColorValue): void {
    if (!this.useCustomDataValue) throw new Error('MultiMesh per-instance custom data is not enabled.');
    index = this.index(index);
    this.customData[index] = copyColor(value);
    this.changed({ kind: 'custom-data', index });
  }
  public get_instance_custom_data(index: number): ColorValue {
    if (!this.useCustomDataValue) throw new Error('MultiMesh per-instance custom data is not enabled.');
    return copyColor(this.customData[this.index(index)] as ColorValue);
  }

  public get_buffer(): Float32Array {
    const stride = this.stride();
    const result = new Float32Array(this.instance_count * stride);
    for (let index = 0; index < this.instance_count; index += 1) this.writeInstance(result, index, stride);
    return result;
  }

  public set_buffer(value: ArrayLike<number>): void {
    const stride = this.stride();
    if (value.length !== this.instance_count * stride) {
      throw new RangeError('MultiMesh.buffer length does not match instance_count and enabled formats.');
    }
    for (let index = 0; index < this.instance_count; index += 1) this.readInstance(value, index, stride);
    this.changed({ kind: 'buffer' });
  }

  public set_buffer_interpolated(
    current: ArrayLike<number>,
    previous: ArrayLike<number>,
  ): void {
    const stride = this.stride();
    if (current.length !== this.instance_count * stride || previous.length !== current.length) {
      throw new RangeError(
        'MultiMesh.set_buffer_interpolated requires matching current/previous buffers for instance_count.',
      );
    }
    this.previousTransforms2D = this.transforms2D.map(copy2D);
    this.previousTransforms3D = this.transforms3D.map(copy3D);
    for (let index = 0; index < this.instance_count; index += 1) {
      this.readInstance(previous, index, stride);
    }
    this.previousTransforms2D = this.transforms2D.map(copy2D);
    this.previousTransforms3D = this.transforms3D.map(copy3D);
    for (let index = 0; index < this.instance_count; index += 1) {
      this.readInstance(current, index, stride);
    }
    this.changed({ kind: 'buffer' });
  }

  public reset_instance_physics_interpolation(index: number): void {
    index = this.index(index);
    this.previousTransforms2D[index] = copy2D(this.transforms2D[index] as GodotTransform2D);
    this.previousTransforms3D[index] = copy3D(this.transforms3D[index] as Transform);
  }

  public reset_instances_physics_interpolation(): void {
    this.previousTransforms2D = this.transforms2D.map(copy2D);
    this.previousTransforms3D = this.transforms3D.map(copy3D);
  }

  public set_physics_interpolation_quality(value: number): void {
    value = integer(value, 'physics_interpolation_quality');
    if (value !== MULTIMESH_INTERP_QUALITY_FAST && value !== MULTIMESH_INTERP_QUALITY_HIGH) {
      throw new RangeError('MultiMesh.physics_interpolation_quality requires FAST or HIGH.');
    }
    if (value === this.interpolationQualityValue) return;
    this.interpolationQualityValue = value;
    this.changed({ kind: 'buffer' });
  }

  public get_physics_interpolation_quality(): number { return this.interpolationQualityValue; }

  public set_custom_aabb(value: GodotAabb): void {
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('MultiMesh.custom_aabb requires AABB.');
    }
    const next = aabb(value.position, value.size);
    this.customAabbValue = next.size.x === 0 && next.size.y === 0 && next.size.z === 0 ? null : next;
    this.changed({ kind: 'allocation' });
  }

  public get_custom_aabb(): GodotAabb {
    const retained = this.customAabbValue;
    return retained === null ? aabb() : aabb(retained.position, retained.size);
  }

  public get_aabb(): GodotAabb {
    if (this.customAabbValue !== null) {
      return aabb(this.customAabbValue.position, this.customAabbValue.size);
    }
    if (!(this.meshValue instanceof BufferGeometry)) return aabb();
    if (this.meshValue.boundingBox === null) this.meshValue.computeBoundingBox();
    const base = this.meshValue.boundingBox;
    if (base === null || base.isEmpty()) return aabb();
    const result = new Box3().makeEmpty();
    const count = this.visibleCountValue < 0 ? this.instance_count : this.visibleCountValue;
    for (let index = 0; index < count; index += 1) {
      const matrix = this.transformFormatValue === MULTIMESH_TRANSFORM_3D
        ? matrix3D(this.transforms3D[index] as Transform)
        : matrix2D(this.transforms2D[index] as GodotTransform2D);
      result.union(base.clone().applyMatrix4(matrix));
    }
    if (result.isEmpty()) return aabb();
    return aabb(result.min, result.getSize(new Vector3()));
  }

  public observe(listener: (change: MultiMeshChange) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private assertUnallocated(member: string): void {
    if (this.instance_count !== 0) throw new Error(`MultiMesh.${member} can only change when instance_count is 0.`);
  }

  private index(value: number): number {
    value = integer(value, 'instance index');
    if (value < 0 || value >= this.instance_count) throw new RangeError('MultiMesh instance index is outside instance_count.');
    return value;
  }

  private allocate(value: number): void {
    value = integer(value, 'instance_count');
    if (value < 0) throw new RangeError('MultiMesh.instance_count cannot be negative.');
    if (value === this.instance_count) return;
    this.transforms2D = Array.from({ length: value }, identity2D);
    this.transforms3D = Array.from({ length: value }, identity3D);
    this.previousTransforms2D = Array.from({ length: value }, identity2D);
    this.previousTransforms3D = Array.from({ length: value }, identity3D);
    this.colors = Array.from({ length: value }, () => copyColor(WHITE));
    this.customData = Array.from({ length: value }, () => copyColor(ZERO));
    if (this.majorValue === 4 && this.visibleCountValue >= 0) {
      this.visibleCountValue = Math.min(this.visibleCountValue, value);
    }
    this.changed({ kind: 'allocation' });
  }

  private stride(): number {
    if (this.majorValue === 3 && (this.colorFormatValue === MULTIMESH_FORMAT_8BIT || this.customDataFormatValue === MULTIMESH_FORMAT_8BIT)) {
      throw new Error('MultiMesh FORMAT_8BIT packed buffers use RenderingServer uint32 bit reinterpretation; use per-instance accessors.');
    }
    return (this.transformFormatValue === MULTIMESH_TRANSFORM_3D ? 12 : 8)
      + (this.useColorsValue ? 4 : 0) + (this.useCustomDataValue ? 4 : 0);
  }

  private writeInstance(out: Float32Array, index: number, stride: number): void {
    const offset = index * stride;
    let cursor: number;
    if (this.transformFormatValue === MULTIMESH_TRANSFORM_3D) {
      const value = this.transforms3D[index] as Transform;
      out.set([
        value.basis[0].x, value.basis[1].x, value.basis[2].x, value.origin.x,
        value.basis[0].y, value.basis[1].y, value.basis[2].y, value.origin.y,
        value.basis[0].z, value.basis[1].z, value.basis[2].z, value.origin.z,
      ], offset);
      cursor = offset + 12;
    } else {
      const value = this.transforms2D[index] as GodotTransform2D;
      out.set([value.x.x, value.y.x, 0, value.origin.x, value.x.y, value.y.y, 0, value.origin.y], offset);
      cursor = offset + 8;
    }
    if (this.useColorsValue) { const c = this.colors[index] as ColorValue; out.set([c.r, c.g, c.b, c.a], cursor); cursor += 4; }
    if (this.useCustomDataValue) { const c = this.customData[index] as ColorValue; out.set([c.r, c.g, c.b, c.a], cursor); }
  }

  private readInstance(input: ArrayLike<number>, index: number, stride: number): void {
    const offset = index * stride;
    let cursor: number;
    if (this.transformFormatValue === MULTIMESH_TRANSFORM_3D) {
      this.transforms3D[index] = {
        basis: [
          { x: Number(input[offset]), y: Number(input[offset + 4]), z: Number(input[offset + 8]) },
          { x: Number(input[offset + 1]), y: Number(input[offset + 5]), z: Number(input[offset + 9]) },
          { x: Number(input[offset + 2]), y: Number(input[offset + 6]), z: Number(input[offset + 10]) },
        ],
        origin: { x: Number(input[offset + 3]), y: Number(input[offset + 7]), z: Number(input[offset + 11]) },
      };
      cursor = offset + 12;
    } else {
      this.transforms2D[index] = {
        x: { x: Number(input[offset]), y: Number(input[offset + 4]) },
        y: { x: Number(input[offset + 1]), y: Number(input[offset + 5]) },
        origin: { x: Number(input[offset + 3]), y: Number(input[offset + 7]) },
      };
      cursor = offset + 8;
    }
    if (this.useColorsValue) { this.colors[index] = { r: Number(input[cursor]), g: Number(input[cursor + 1]), b: Number(input[cursor + 2]), a: Number(input[cursor + 3]) }; cursor += 4; }
    if (this.useCustomDataValue) this.customData[index] = { r: Number(input[cursor]), g: Number(input[cursor + 1]), b: Number(input[cursor + 2]), a: Number(input[cursor + 3]) };
  }

  private changed(change: MultiMeshChange): void {
    godotResourceEmitChanged(this);
    for (const listener of this.listeners) listener(change);
  }
}

export function createGodotMultiMesh(major: 3 | 4 = 4): GodotMultiMesh {
  return new GodotMultiMesh({ major });
}
