/**
 * Pure authored MultiMesh/ArrayMesh extraction for the retained Pixi runtime.
 * Property defaults and dialect differences come from Godot 3.6/4.7's own multimesh.h/cpp.
 */

import { ARRAY_MESH_PRIMITIVE } from '../../read/array-mesh';
import type { SubResource } from '../../read/godot-types';
import type { GodotValue } from '../../read/godot-value';
import { readMeshSurfaces } from '../../read/mesh-surfaces';
import { subResourceOf, type ResourceRefScope } from './resource-ref';
import { TranslateError } from './model';

export interface MultiMesh2DTransformSpec {
  readonly xx: number;
  readonly xy: number;
  readonly yx: number;
  readonly yy: number;
  readonly ox: number;
  readonly oy: number;
}

export interface MultiMesh2DSpec {
  readonly positions: Float32Array;
  readonly uvs?: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly instanceCount: number;
  readonly visibleInstanceCount: number;
  readonly transformFormat: 0;
  readonly colorFormat: 0 | 1 | 2;
  readonly customDataFormat: 0;
  readonly transforms: readonly MultiMesh2DTransformSpec[];
  readonly colors: readonly { readonly r: number; readonly g: number; readonly b: number; readonly a: number }[];
}

function packedColors(value: GodotValue | undefined, count: number, at: string): MultiMesh2DSpec['colors'] {
  if (value === undefined) return [];
  const items = value.kind === 'array' ? value.items : value.kind === 'ctor' ? value.args : undefined;
  if (items === undefined) throw new TranslateError(at, 'MultiMesh.color_array is not a packed Color array.');
  const values: number[] = [];
  for (const [index, item] of items.entries()) {
    if (item.kind === 'number') values.push(item.value);
    else if (item.kind === 'ctor' && item.name === 'Color' && item.args.every((one) => one.kind === 'number')) {
      values.push(...item.args.map((one) => (one as { readonly kind: 'number'; readonly value: number }).value));
    } else throw new TranslateError(at, `MultiMesh.color_array[${index}] is not a Color component.`);
  }
  if (values.length !== 0 && values.length !== count * 4) {
    throw new TranslateError(at, `MultiMesh.color_array has ${values.length} scalars for ${count} instances.`);
  }
  return Array.from({ length: values.length / 4 }, (_, index) => ({
    r: values[index * 4]!, g: values[index * 4 + 1]!, b: values[index * 4 + 2]!, a: values[index * 4 + 3]!,
  }));
}

function numberOf(value: GodotValue | undefined, fallback: number, at: string, name: string): number {
  if (value === undefined) return fallback;
  if (value.kind !== 'number') throw new TranslateError(at, `MultiMesh.${name} is not numeric.`);
  return value.value;
}

function packedNumbers(value: GodotValue | undefined, at: string, name: string): number[] {
  if (value === undefined) return [];
  const values = value.kind === 'array' ? value.items : value.kind === 'ctor' ? value.args : undefined;
  if (values === undefined) throw new TranslateError(at, `MultiMesh.${name} is not a packed numeric array.`);
  return values.map((item, index) => {
    if (item.kind !== 'number') throw new TranslateError(at, `MultiMesh.${name}[${index}] is not numeric.`);
    return item.value;
  });
}

function meshOf(multimesh: SubResource, scope: ResourceRefScope, at: string): SubResource {
  const mesh = subResourceOf(multimesh.properties['mesh'], scope);
  if (mesh === undefined) throw new TranslateError(at, 'MultiMesh.mesh must name an inline ArrayMesh resource.');
  if (mesh.type !== 'ArrayMesh') throw new TranslateError(at, `MultiMesh.mesh is ${mesh.type}; Pixi MultiMesh2D requires ArrayMesh geometry.`);
  return mesh;
}

/**
 * Read only engine-independent numbers. Mesh construction and mutable MultiMesh behavior remain in
 * copied godot-compat; this function has no runtime policy.
 */
export function readMultiMesh2DSpec(multimesh: SubResource, scope: ResourceRefScope, at: string, major: 3 | 4): MultiMesh2DSpec {
  if (multimesh.type !== 'MultiMesh') throw new TranslateError(at, `multimesh is ${multimesh.type}, not MultiMesh.`);
  const transformFormat = numberOf(multimesh.properties['transform_format'], 0, at, 'transform_format');
  if (transformFormat !== 0) throw new TranslateError(at, 'MultiMeshInstance2D cannot preserve TRANSFORM_3D in Pixi.');

  // Godot 3 has enum formats; Godot 4 replaces them with use_colors/use_custom_data booleans.
  const colorFormat = numberOf(multimesh.properties['color_format'],
    multimesh.properties['use_colors']?.kind === 'bool' && multimesh.properties['use_colors'].value ? 2 : 0,
    at, 'color_format');
  if (colorFormat !== 0 && colorFormat !== 1 && colorFormat !== 2) throw new TranslateError(at, `MultiMesh color_format ${colorFormat} is unknown.`);
  const customDataFormat = numberOf(multimesh.properties['custom_data_format'],
    multimesh.properties['use_custom_data']?.kind === 'bool' && multimesh.properties['use_custom_data'].value ? 2 : 0,
    at, 'custom_data_format');
  if (customDataFormat !== 0) throw new TranslateError(at, 'MultiMesh custom data requires Godot INSTANCE_CUSTOM shader input, which Pixi Mesh does not expose.');

  const mesh = meshOf(multimesh, scope, at);
  const surfaces = readMeshSurfaces(mesh.properties, `${at}#${String(mesh.id)}`);
  if (surfaces.length !== 1) throw new TranslateError(at, `MultiMesh ArrayMesh has ${surfaces.length} surfaces; retained Pixi instances require exactly one.`);
  const surface = surfaces[0];
  if (surface === undefined || surface.primitive !== ARRAY_MESH_PRIMITIVE.TRIANGLES) {
    throw new TranslateError(at, 'MultiMesh ArrayMesh must use triangle primitives.');
  }
  if (surface.normals !== undefined || surface.tangents !== undefined || surface.bones !== undefined || surface.weights !== undefined) {
    throw new TranslateError(at, 'MultiMesh ArrayMesh carries 3D lighting or skin attributes unavailable to Pixi Mesh.');
  }
  if (surface.uv2s !== undefined) throw new TranslateError(at, 'MultiMesh ArrayMesh UV2 has no Pixi Mesh default-shader input.');
  if (surface.colors !== undefined) {
    const nonWhite = [...surface.colors].some((component) => Math.abs(component - 1) > 1e-6);
    if (nonWhite) throw new TranslateError(at, 'MultiMesh ArrayMesh carries non-white vertex colors unavailable to Pixi Mesh default shader.');
  }
  const positions = new Float32Array(surface.vertexCount * 2);
  for (let index = 0; index < surface.vertexCount; index += 1) {
    positions[index * 2] = surface.positions[index * 3] as number;
    positions[index * 2 + 1] = surface.positions[index * 3 + 1] as number;
    if (Math.abs(surface.positions[index * 3 + 2] as number) > 1e-6) {
      throw new TranslateError(at, 'MultiMeshInstance2D ArrayMesh contains non-zero Z positions.');
    }
  }
  const rawIndices = surface.indices ?? Uint32Array.from({ length: surface.vertexCount }, (_, index) => index);
  if (rawIndices.length % 3 !== 0) throw new TranslateError(at, 'MultiMesh ArrayMesh triangle index count is not divisible by three.');
  const indices = surface.vertexCount < 65_536 ? Uint16Array.from(rawIndices) : Uint32Array.from(rawIndices);

  const instanceCount = numberOf(multimesh.properties['instance_count'], 0, at, 'instance_count');
  const visibleInstanceCount = numberOf(multimesh.properties['visible_instance_count'], -1, at, 'visible_instance_count');
  if (!Number.isSafeInteger(instanceCount) || instanceCount < 0) throw new TranslateError(at, 'MultiMesh.instance_count must be a nonnegative integer.');
  if (!Number.isSafeInteger(visibleInstanceCount) || visibleInstanceCount < -1 || (major === 4 && visibleInstanceCount > instanceCount)) {
    throw new TranslateError(at, `MultiMesh.visible_instance_count ${visibleInstanceCount} is invalid for ${instanceCount} instances in Godot ${major}.`);
  }
  const packedTransforms = packedNumbers(multimesh.properties['transform_2d_array'], at, 'transform_2d_array');
  if (packedTransforms.length !== 0 && packedTransforms.length !== instanceCount * 6) {
    throw new TranslateError(at, `MultiMesh.transform_2d_array has ${packedTransforms.length} scalars for ${instanceCount} instances.`);
  }
  const transforms: MultiMesh2DTransformSpec[] = [];
  for (let index = 0; index < packedTransforms.length; index += 6) {
    transforms.push({
      xx: packedTransforms[index] as number,
      xy: packedTransforms[index + 1] as number,
      yx: packedTransforms[index + 2] as number,
      yy: packedTransforms[index + 3] as number,
      ox: packedTransforms[index + 4] as number,
      oy: packedTransforms[index + 5] as number,
    });
  }
  return {
    positions,
    ...(surface.uvs === undefined ? {} : { uvs: surface.uvs }),
    indices,
    instanceCount,
    visibleInstanceCount,
    transformFormat: 0,
    colorFormat,
    customDataFormat: 0,
    transforms,
    colors: packedColors(multimesh.properties['color_array'], instanceCount, at),
  };
}
