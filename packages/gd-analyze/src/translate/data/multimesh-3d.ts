/** Pure authored MultiMesh extraction for native Three InstancedMesh emission. */

import type { SubResource } from '../../read/godot-types';
import type { GodotValue } from '../../read/godot-value';
import { subResourceOf, type ResourceRefScope } from './resource-ref';
import { TranslateError } from './model';

export interface MultiMeshTransform3DSpec {
  readonly values: readonly [number, number, number, number, number, number, number, number, number, number, number, number];
}

export interface MultiMeshColorSpec {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface MultiMesh3DSpec {
  readonly mesh: SubResource;
  readonly instanceCount: number;
  readonly visibleInstanceCount: number;
  readonly colorFormat: 0 | 1 | 2;
  readonly customDataFormat: 0 | 1 | 2;
  readonly transforms: readonly MultiMeshTransform3DSpec[];
  readonly colors: readonly MultiMeshColorSpec[];
  readonly customData: readonly MultiMeshColorSpec[];
}

function numberOf(value: GodotValue | undefined, fallback: number, at: string, name: string): number {
  if (value === undefined) return fallback;
  if (value.kind !== 'number') throw new TranslateError(at, `MultiMesh.${name} must be numeric.`);
  return value.value;
}

function packed(value: GodotValue | undefined, at: string, name: string): number[] {
  if (value === undefined) return [];
  const items = value.kind === 'array' ? value.items : value.kind === 'ctor' ? value.args : undefined;
  if (items === undefined) throw new TranslateError(at, `MultiMesh.${name} must be a packed array.`);
  const result: number[] = [];
  for (const [index, item] of items.entries()) {
    if (item.kind === 'number') result.push(item.value);
    else if (item.kind === 'ctor' && item.name === 'Color' && item.args.every((one) => one.kind === 'number')) {
      result.push(...item.args.map((one) => (one as { readonly kind: 'number'; readonly value: number }).value));
    } else throw new TranslateError(at, `MultiMesh.${name}[${index}] is not numeric.`);
  }
  return result;
}

function colorsOf(value: GodotValue | undefined, count: number, at: string, name: string): MultiMeshColorSpec[] {
  const values = packed(value, at, name);
  if (values.length !== 0 && values.length !== count * 4) {
    throw new TranslateError(at, `MultiMesh.${name} has ${values.length} scalars for ${count} instances.`);
  }
  const colors: MultiMeshColorSpec[] = [];
  for (let index = 0; index < values.length; index += 4) {
    colors.push({ r: values[index]!, g: values[index + 1]!, b: values[index + 2]!, a: values[index + 3]! });
  }
  return colors;
}

export function readMultiMesh3DSpec(
  resource: SubResource,
  scope: ResourceRefScope,
  at: string,
  major: 3 | 4,
): MultiMesh3DSpec {
  if (resource.type !== 'MultiMesh') throw new TranslateError(at, `multimesh is ${resource.type}, not MultiMesh.`);
  const transformFormat = numberOf(resource.properties['transform_format'], 0, at, 'transform_format');
  if (transformFormat !== 1) throw new TranslateError(at, 'MultiMeshInstance3D requires TRANSFORM_3D.');
  const mesh = subResourceOf(resource.properties['mesh'], scope);
  if (mesh === undefined) throw new TranslateError(at, 'MultiMesh.mesh must name an inline Mesh SubResource.');
  const instanceCount = numberOf(resource.properties['instance_count'], 0, at, 'instance_count');
  const visibleInstanceCount = numberOf(resource.properties['visible_instance_count'], -1, at, 'visible_instance_count');
  if (!Number.isSafeInteger(instanceCount) || instanceCount < 0) throw new TranslateError(at, 'MultiMesh.instance_count must be a nonnegative integer.');
  if (!Number.isSafeInteger(visibleInstanceCount) || visibleInstanceCount < -1 || (major === 4 && visibleInstanceCount > instanceCount)) {
    throw new TranslateError(at, `MultiMesh.visible_instance_count ${visibleInstanceCount} is invalid for ${instanceCount} instances.`);
  }
  const colorFormat = numberOf(resource.properties['color_format'],
    resource.properties['use_colors']?.kind === 'bool' && resource.properties['use_colors'].value ? 2 : 0,
    at, 'color_format');
  const customDataFormat = numberOf(resource.properties['custom_data_format'],
    resource.properties['use_custom_data']?.kind === 'bool' && resource.properties['use_custom_data'].value ? 2 : 0,
    at, 'custom_data_format');
  if (![0, 1, 2].includes(colorFormat) || ![0, 1, 2].includes(customDataFormat)) {
    throw new TranslateError(at, 'MultiMesh color/custom data format is outside the engine enum.');
  }
  if (customDataFormat !== 0) {
    throw new TranslateError(at, 'MultiMeshInstance3D authors INSTANCE_CUSTOM data, but no translated Three material consumes that shader input.');
  }
  const values = packed(resource.properties['transform_array'], at, 'transform_array');
  if (values.length !== 0 && values.length !== instanceCount * 12) {
    throw new TranslateError(at, `MultiMesh.transform_array has ${values.length} scalars for ${instanceCount} instances.`);
  }
  const transforms: MultiMeshTransform3DSpec[] = [];
  for (let index = 0; index < values.length; index += 12) {
    transforms.push({ values: values.slice(index, index + 12) as unknown as MultiMeshTransform3DSpec['values'] });
  }
  return {
    mesh,
    instanceCount,
    visibleInstanceCount,
    colorFormat: colorFormat as 0 | 1 | 2,
    customDataFormat: customDataFormat as 0 | 1 | 2,
    transforms,
    colors: colorsOf(resource.properties['color_array'], instanceCount, at, 'color_array'),
    customData: colorsOf(resource.properties['custom_data_array'], instanceCount, at, 'custom_data_array'),
  };
}
