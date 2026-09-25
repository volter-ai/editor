import type { AuthoringAdapter } from '@volter/editor-project/adapter';

/**
 * The native root whose viewport tools may claim the current selection, as far
 * as the viewport cares: its KIND (only `three` lets the 3D chrome claim the
 * surface) and its manifest root id (`null` for a single-adapter session).
 *
 * `authoring/viewport-tool-context.ts`'s `ViewportToolContext` is this plus the
 * adapter, and is structurally assignable to it.
 */
export interface ViewportToolOwner {
  readonly worldId: string | null;
  readonly kind: string;
}

/**
 * Viewport-tool ownership for a SINGLE adapter — no composite, no manifest kind
 * metadata to read.
 *
 * Structural and conservative, unchanged from where it was written
 * (`authoring/viewport-tool-context.ts`, which now imports it): a rect-capable
 * selection is DOM; a selection whose every node resolves to an `Object3D` is
 * three; anything else advertises no kind-specific chrome rather than guessing.
 * It speaks only the adapter contract, which is why it can be the default here.
 */
export function adapterOnlyToolOwner(
  adapter: AuthoringAdapter,
  selectedIds: Iterable<string>,
): ViewportToolOwner | null {
  const ids = [...selectedIds];
  if (ids.length === 0) return null;
  if (ids.some((id) => adapter.hierarchy.node(id) === null)) return null;
  if (adapter.rects) return { worldId: null, kind: 'dom' };
  if (ids.every((id) => adapter.hierarchy.object3D?.(id) != null)) {
    return { worldId: null, kind: 'three' };
  }
  return null;
}
