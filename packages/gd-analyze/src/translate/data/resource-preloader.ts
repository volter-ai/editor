/** Exact text-resource decoding for ResourcePreloader's versioned serialized table. */

import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export interface AuthoredPreloadedResource {
  readonly name: string;
  readonly value: GodotValue;
}

function namesOf(value: GodotValue | undefined, at: string): readonly string[] {
  const items = value?.kind === 'array' ? value.items : value?.kind === 'ctor' ? value.args : undefined;
  if (items === undefined || items.some((item) => item.kind !== 'string')) {
    throw new TranslateError(at, 'ResourcePreloader name table must be a PackedStringArray.');
  }
  return items.map((item) => item.kind === 'string' ? item.value : '');
}

/**
 * Godot 3/4 store this property as `[PackedStringArray(names), [resources]]`; some importers and
 * runtime assignments expose the equivalent Dictionary spelling. Normalize both without
 * constructing resources in the translator.
 */
export function readResourcePreloaderEntries(
  value: GodotValue | undefined,
  at: string,
): readonly AuthoredPreloadedResource[] {
  if (value === undefined) return [];
  if (value.kind === 'dict') {
    return value.entries.map((entry) => ({ name: entry.key, value: entry.value }));
  }
  if (value.kind !== 'array' || value.items.length !== 2) {
    throw new TranslateError(at, 'ResourcePreloader.resources must be its serialized name/resource pair.');
  }
  const names = namesOf(value.items[0], at);
  const resources = value.items[1];
  if (resources?.kind !== 'array' || resources.items.length !== names.length) {
    throw new TranslateError(at, 'ResourcePreloader name and resource tables must have equal lengths.');
  }
  return names.map((name, index) => ({ name, value: resources.items[index] as GodotValue }));
}
