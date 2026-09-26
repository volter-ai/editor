/**
 * translate/data/resource-ref.ts — a `SubResource(…)` / `ExtResource(…)` value as the document
 * entry it cites.
 *
 * Godot 4 writes an opaque quoted token where Godot 3 writes a number; `read/godot-value`'s
 * `resourceRefId` is the one lookup that answers both. Emit used to call that reader itself —
 * moving the lookup here is what lets `emit/scene-module-3d.ts` type-only-import `read/`.
 */
import type { ExtResourceRef, SubResource } from '../../read/godot-types';
import { type GodotValue, type ResourceId, resourceRefId } from '../../read/godot-value';

/** The document (or MeshLibrary `.tres`) a reference is resolved against. */
export interface ResourceRefScope {
  readonly subResources: readonly SubResource[];
  readonly extResources: readonly (
    Pick<ExtResourceRef, 'id' | 'resPath'> & Partial<Pick<ExtResourceRef, 'type' | 'present'>>
  )[];
}

export function subResourceOf(
  value: GodotValue | undefined,
  scope: ResourceRefScope,
): SubResource | undefined {
  const id = resourceRefId(value, 'SubResource');
  if (id === undefined) return undefined;
  return scope.subResources.find((resource) => resource.id === id);
}

export function extResourcePathOf(
  value: GodotValue | undefined,
  scope: ResourceRefScope,
): string | undefined {
  const id = resourceRefId(value, 'ExtResource');
  if (id === undefined) return undefined;
  return scope.extResources.find((resource) => resource.id === id)?.resPath;
}

export type { ResourceId };
