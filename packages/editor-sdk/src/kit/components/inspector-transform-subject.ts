import type { AuthoringAdapter } from '@volter/editor-project/adapter';

/** Resolve whether a selected node owns a transform and which vocabulary to show. */
export function transformDimensionsFor(adapter: AuthoringAdapter, id: string): '2d' | '3d' | null {
  if (!adapter.transforms) return null;
  const declared = adapter.transforms.dimensions?.(id);
  if (declared !== undefined) return declared;
  return adapter.hierarchy.object3D === undefined || adapter.hierarchy.object3D(id) !== null
    ? '3d'
    : null;
}
