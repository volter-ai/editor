import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import type { ShellStore } from '../shell-store';
import { adapterOnlyToolOwner, type ViewportToolOwner } from '../viewport-authoring-policy';
import { CompositeAuthoringAdapter } from './composite-authoring-adapter';
import { resolveThreeViewportRootId } from './world-hidden-viewport';
import { isRootHidden } from './world-session-state';

/**
 * The one native root whose viewport tools may claim the current selection.
 *
 * A composed game can contain several native surfaces at once, but editing
 * chrome needs one unambiguous coordinate system and capability owner. Empty,
 * organizational, and cross-root selections therefore resolve to `null`.
 */
export interface ViewportToolContext extends ViewportToolOwner {
  readonly adapter: AuthoringAdapter;
}

function compositeContext(
  composite: CompositeAuthoringAdapter,
  selectedIds: readonly string[],
): ViewportToolContext | null {
  const children = composite.childAdapters();
  let owner: (typeof children)[number] | null = null;

  for (const id of selectedIds) {
    const child =
      children.find((candidate) => composite.groupNodeId(candidate.worldId) === id) ??
      children.find((candidate) => composite.ownerOf(id) === candidate.worldId);
    // Kind/projection folders and stale ids do not claim native-world tools.
    if (!child) return null;
    // A heterogeneous selection has no single native editing context.
    if (owner && owner.worldId !== child.worldId) return null;
    owner = child;
  }

  return owner ? { worldId: owner.worldId, kind: owner.kind, adapter: owner.adapter } : null;
}

/**
 * Resolve viewport-tool ownership from selection, never from which roots
 * merely exist or happen to be visible.
 */
export function resolveViewportToolContext(
  adapter: AuthoringAdapter,
  selectedIds: Iterable<string>,
): ViewportToolContext | null {
  const ids = [...selectedIds];
  if (ids.length === 0) return null;
  if (adapter instanceof CompositeAuthoringAdapter) return compositeContext(adapter, ids);

  // Legacy/single-adapter sessions have no manifest kind metadata, and that
  // fallback is `adapterOnlyToolOwner` — it speaks only the adapter contract,
  // so it lives below the shell (`viewport-authoring-policy.ts`) as the gizmo
  // viewport's own default. One copy, read from both sides.
  const owner = adapterOnlyToolOwner(adapter, ids);
  return owner ? { ...owner, adapter } : null;
}

/**
 * Whether the selected owner is actually painted in this viewport. DOM
 * layers follow their world eye; the manifest's sole Three root owns the 3D
 * viewport chrome only while that root is visible.
 */
export function isViewportToolContextVisible(
  store: ShellStore,
  context: ViewportToolOwner | null,
): boolean {
  if (!context) return false;
  if (context.worldId !== null && isRootHidden(context.worldId)) return false;
  if (context.kind !== 'three' || context.worldId === null) return true;
  return resolveThreeViewportRootId(store) === context.worldId;
}
