/**
 * Seam-level provenance resolution (spec 29 §5): which {@link
 * AuthoringProvenance} governs a given hierarchy node. Provenance is declared
 * once per adapter and rendered at the seam (world group row / panel header);
 * affordance code also reads it for the REASON string on a disabled operation
 * ("the subject is present but the operation isn't" — the complement of spec
 * 28's hide-when-absent rule).
 *
 * Rule zero: roots are resolved by ASKING the composite (`groupNodeId` /
 * `ownerOf`), never by decoding adapter-minted id strings here.
 */
import type { AuthoringAdapter, AuthoringProvenance } from '@volter/editor-project/adapter';
import { CompositeAuthoringAdapter } from '@volter/editor-sdk/kit/authoring/composite-authoring-adapter';

/** Resolve the concrete adapter that owns a real hierarchy node. Synthetic
 * composite rows and unknown ids have no owner. */
export function authoringAdapterForNode(
  adapter: AuthoringAdapter,
  nodeId: string,
): AuthoringAdapter | null {
  if (!(adapter instanceof CompositeAuthoringAdapter)) return adapter;
  const worldId = adapter.ownerOf(nodeId);
  if (worldId === null) return null;
  return adapter.childAdapters().find((child) => child.worldId === worldId)?.adapter ?? null;
}

/**
 * The adapter GOVERNING `nodeId` under the ACTIVE adapter — the one entitled to
 * answer questions *about that node*: the owning child inside a composite, the
 * world's own child for a `world:<id>` GROUP row, the adapter itself when it
 * isn't a composite. `null` when the composite recognizes no owner (a synthetic
 * organization row, an unknown id).
 *
 * Use this — not the active adapter — for any PER-NODE capability check inside
 * a composite. `CompositeAuthoringAdapter`'s provider fields are unconditional
 * routing objects: reading presence off the composite is `true` for every node
 * in every multi-root project, including nodes whose owner exposes no such
 * provider at all and nodes nobody owns (where `route()` falls back to the
 * FIRST child). That has the editor assert a capability claim on a child's
 * behalf — exactly the fabrication the anti-shim rule forbids. Ask the
 * governing adapter instead, and treat "no governing adapter" as "nobody
 * declared anything".
 *
 * Distinct from {@link authoringAdapterForNode}, which resolves REAL hierarchy
 * nodes only and is deliberately `null` for a group row.
 */
export function governingAdapterForNode(
  adapter: AuthoringAdapter,
  nodeId: string,
): AuthoringAdapter | null {
  if (!(adapter instanceof CompositeAuthoringAdapter)) return adapter;
  for (const child of adapter.childAdapters()) {
    if (adapter.groupNodeId(child.worldId) === nodeId) return child.adapter;
  }
  return authoringAdapterForNode(adapter, nodeId);
}

/**
 * The provenance governing `nodeId` under the ACTIVE adapter: the owning
 * child's declaration inside a composite (a `world:<id>` group row resolves
 * to that world's own child), the adapter's own declaration otherwise.
 * `null` when nothing was declared (the shell shows no badge and falls back
 * to a generic reason — never fabricates a claim).
 */
export function provenanceForNode(
  adapter: AuthoringAdapter,
  nodeId: string,
): AuthoringProvenance | null {
  return governingAdapterForNode(adapter, nodeId)?.provenance ?? null;
}

/** The reason string for an affordance that is present but unavailable —
 *  the adapter's own explanation when it declared one, a plain honest
 *  fallback when it didn't. */
export function unavailableReason(provenance: AuthoringProvenance | null): string {
  return provenance?.detail ?? "Not supported by this world's adapter.";
}
/**
 * WHERE this adapter's truth is written, as one human-readable string.
 *
 * One owner, because two surfaces read it and they must agree: the Hierarchy
 * panel publishes it as its scene name (`components/GameHierarchy.tsx`), and
 * the Inspector's identity row PRINTS it as the datablock line
 * (`inspection/model.ts`'s `InspectionDocumentLine`) now that the tree's own
 * breadcrumb row is gone. When the two were computed separately the
 * Inspector's half silently showed nothing for every adapter that answers
 * through its document root instead of a persistence provider — which is the
 * ordinary three-source case.
 *
 * `null` for a session with no single destination (a composite, whose worlds'
 * destinations differ) — the same silence its `provenance` keeps.
 */
export function authoringDestination(adapter: AuthoringAdapter): string | null {
  const persisted = adapter.persistence?.destination;
  if (persisted) return persisted;
  const roots = adapter.hierarchy.roots();
  const documentRoot = roots.length === 1 && roots[0]?.role === 'document' ? roots[0] : null;
  return documentRoot?.secondaryLabel ?? documentRoot?.label ?? null;
}
