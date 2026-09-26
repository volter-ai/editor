/** Authored Godot BitMap resources, kept as packed boolean rasters until emission. */

import type { GodotValue } from '../../read/godot-value';
import type { ResourceDocument, SubResource } from '../../read/godot-types';
import type { ImportSidecar } from '../../read/import-sidecar';
import { resourceRefId } from '../../read/godot-value';
import { TranslateError } from './model';
import { extResourcePathOf, type ResourceRefScope, subResourceOf } from './resource-ref';

export type AuthoredBitMap = {
  readonly kind: 'packed';
  /** Resource identity inside the emitted scene (SubResource id or external path). */
  readonly resourceKey: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: readonly number[];
} | {
  readonly kind: 'image-alpha';
  readonly resourceKey: string;
  readonly resPath: string;
  readonly threshold: number;
};

export interface BitMapImportSpec {
  readonly createFrom?: number;
  readonly threshold: number;
}

/** Bind the exact importer mode the runtime source-image conversion implements. */
export function bitmapImports(imports: readonly ImportSidecar[]): ReadonlyMap<string, BitMapImportSpec> {
  const result = new Map<string, BitMapImportSpec>();
  for (const sidecar of imports) {
    if (sidecar.importer !== 'bitmap' || sidecar.sourceFile === undefined) continue;
    const threshold = sidecar.bitmapThreshold ?? 0.5;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new TranslateError(sidecar.resPath, 'BitMap importer threshold must be finite from 0 through 1.');
    }
    result.set(sidecar.sourceFile, {
      ...(sidecar.bitmapCreateFrom === undefined ? {} : { createFrom: sidecar.bitmapCreateFrom }),
      threshold,
    });
  }
  return result;
}

function finalEntry(value: Extract<GodotValue, { readonly kind: 'dict' }>, key: string): GodotValue | undefined {
  for (let index = value.entries.length - 1; index >= 0; index -= 1) {
    const entry = value.entries[index];
    if (entry?.key === key && (entry.keyValue === undefined || entry.keyValue.kind === 'string')) return entry.value;
  }
  return undefined;
}

function dimension(value: GodotValue | undefined, axis: 'width' | 'height', at: string): number {
  if (value?.kind !== 'number' || !Number.isSafeInteger(value.value) || value.value < 1) {
    throw new TranslateError(at, `BitMap data size ${axis} must be a positive integer.`);
  }
  return value.value;
}

function packedBytes(value: GodotValue | undefined, at: string): readonly number[] {
  if (value?.kind !== 'ctor' || (value.name !== 'PoolByteArray' && value.name !== 'PackedByteArray')) {
    throw new TranslateError(at, 'BitMap data must contain a PoolByteArray (Godot 3) or PackedByteArray (Godot 4).');
  }
  return value.args.map((byte, index) => {
    if (byte.kind !== 'number' || !Number.isSafeInteger(byte.value) || byte.value < 0 || byte.value > 255) {
      throw new TranslateError(at, `BitMap packed byte ${String(index)} must be an integer from 0 through 255.`);
    }
    return byte.value;
  });
}

function decode(
  resource: Pick<SubResource, 'type' | 'properties'> | ResourceDocument,
  resourceKey: string,
  at: string,
): AuthoredBitMap {
  if (resource.type !== 'BitMap') {
    throw new TranslateError(at, `TextureButton click mask resolves to ${resource.type}, not BitMap.`);
  }
  const stored = resource.properties['data'];
  if (stored?.kind !== 'dict') {
    throw new TranslateError(at, 'BitMap resource is missing its stored data Dictionary.');
  }
  const size = finalEntry(stored, 'size');
  if (size?.kind !== 'ctor' || (size.name !== 'Vector2' && size.name !== 'Vector2i') || size.args.length !== 2) {
    throw new TranslateError(at, 'BitMap data size must be Vector2 (Godot 3) or Vector2i (Godot 4).');
  }
  const width = dimension(size.args[0], 'width', at);
  const height = dimension(size.args[1], 'height', at);
  const bytes = packedBytes(finalEntry(stored, 'data'), at);
  const expected = Math.ceil(width * height / 8);
  if (bytes.length !== expected) {
    throw new TranslateError(at, `BitMap ${String(width)}x${String(height)} requires ${String(expected)} packed bytes; resource contains ${String(bytes.length)}.`);
  }
  return { kind: 'packed', resourceKey, width, height, bytes };
}

export function readAuthoredBitMap(
  value: GodotValue | undefined,
  scope: ResourceRefScope,
  resources: ReadonlyMap<string, ResourceDocument>,
  imports: ReadonlyMap<string, BitMapImportSpec> | undefined,
  at: string,
): AuthoredBitMap | null {
  if (value === undefined || value.kind === 'null') return null;
  const inline = subResourceOf(value, scope);
  if (inline !== undefined) return decode(inline, `sub:${String(inline.id)}`, at);
  const path = extResourcePathOf(value, scope);
  if (path === undefined) throw new TranslateError(at, 'TextureButton click mask must be a BitMap SubResource or ExtResource.');
  const external = resources.get(path);
  if (external !== undefined) return decode(external, path, at);
  const id = resourceRefId(value, 'ExtResource');
  const ref = scope.extResources.find((candidate) => candidate.id === id);
  if (ref?.type !== 'BitMap') {
    throw new TranslateError(at, `TextureButton click-mask resource ${path} was not opened as a BitMap.`);
  }
  if (ref.present === false) throw new TranslateError(at, `TextureButton click-mask source image ${path} is absent.`);
  if (!path.toLowerCase().endsWith('.png')) {
    throw new TranslateError(at, `TextureButton imported BitMap source ${path} is not a PNG image.`);
  }
  const imported = imports?.get(path);
  if (imported === undefined) {
    throw new TranslateError(at, `TextureButton imported BitMap source ${path} has no readable bitmap importer metadata.`);
  }
  if (imported.createFrom === undefined) {
    throw new TranslateError(at, `TextureButton imported BitMap source ${path} is missing params/create_from.`);
  }
  if (imported.createFrom !== 1) {
    throw new TranslateError(at, `TextureButton imported BitMap source ${path} uses unsupported create_from=${String(imported.createFrom)}; only alpha mode (1) is retained.`);
  }
  return { kind: 'image-alpha', resourceKey: path, resPath: path, threshold: imported.threshold };
}
