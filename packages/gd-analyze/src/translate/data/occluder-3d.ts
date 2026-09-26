/** Pure authored ArrayOccluder3D extraction. Native depth participation lives in godot-compat. */

import type { GodotValue } from '../../read/godot-value';
import type { ResourceDocument, SubResource } from '../../read/godot-types';
import { TranslateError } from './model';

export interface ArrayOccluder3DSpec {
  readonly vertices: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }[];
  readonly indices: readonly number[];
}

const items = (value: GodotValue | undefined): readonly GodotValue[] =>
  value?.kind === 'array' ? value.items : value?.kind === 'ctor' ? value.args : [];

function verticesOf(value: GodotValue | undefined, at: string): ArrayOccluder3DSpec['vertices'] {
  const raw = items(value);
  if (raw.every((item) => item.kind === 'ctor' && item.name === 'Vector3')) {
    return raw.map((item, index) => {
      if (item.kind !== 'ctor') throw new Error('unreachable');
      const [x, y, z] = item.args;
      if (x?.kind !== 'number' || y?.kind !== 'number' || z?.kind !== 'number') {
        throw new TranslateError(at, `ArrayOccluder3D.vertices Vector3 ${index} is malformed.`);
      }
      return { x: x.value, y: y.value, z: z.value };
    });
  }
  const numbers = raw.map((item, index) => {
    if (item.kind !== 'number' || !Number.isFinite(item.value)) {
      throw new TranslateError(at, `ArrayOccluder3D.vertices item ${index} is not finite numeric data.`);
    }
    return item.value;
  });
  if (numbers.length % 3 !== 0) {
    throw new TranslateError(at, 'ArrayOccluder3D.vertices must contain Vector3 triples.');
  }
  const vertices: { x: number; y: number; z: number }[] = [];
  for (let index = 0; index < numbers.length; index += 3) {
    vertices.push({ x: numbers[index]!, y: numbers[index + 1]!, z: numbers[index + 2]! });
  }
  return vertices;
}

function indicesOf(value: GodotValue | undefined, vertexCount: number, at: string): number[] {
  const indices = items(value).map((item, index) => {
    if (item.kind !== 'number' || !Number.isSafeInteger(item.value)) {
      throw new TranslateError(at, `ArrayOccluder3D.indices item ${index} is not an integer.`);
    }
    if (item.value < 0 || item.value >= vertexCount) {
      throw new TranslateError(
        at,
        `ArrayOccluder3D index ${item.value} is outside ${vertexCount} vertices.`,
      );
    }
    return item.value;
  });
  if (indices.length % 3 !== 0) {
    throw new TranslateError(at, 'ArrayOccluder3D.indices must contain complete triangles.');
  }
  return indices;
}

export function readArrayOccluder3D(
  resource: SubResource | ResourceDocument,
  at: string,
): ArrayOccluder3DSpec {
  if (resource.type !== 'ArrayOccluder3D') {
    throw new TranslateError(
      at,
      `OccluderInstance3D currently carries ArrayOccluder3D; ${resource.type} refuses loudly.`,
    );
  }
  const unknown = Object.keys(resource.properties).filter(
    (name) => name !== 'vertices' && name !== 'indices' && !name.startsWith('resource_'),
  );
  if (unknown.length > 0) {
    throw new TranslateError(
      at,
      `ArrayOccluder3D authored unsupported properties: ${unknown.sort().join(', ')}.`,
    );
  }
  const vertices = verticesOf(resource.properties['vertices'], at);
  const indices = indicesOf(resource.properties['indices'], vertices.length, at);
  return { vertices, indices };
}

export function arrayOccluder3DExpression(spec: ArrayOccluder3DSpec): string {
  const vertices = spec.vertices
    .map((point) => `{ x: ${point.x}, y: ${point.y}, z: ${point.z} }`)
    .join(', ');
  return (
    `createArrayOccluder3D(packedVector3Array([${vertices}]), ` +
    `packedInt32Array([${spec.indices.join(', ')}]))`
  );
}
