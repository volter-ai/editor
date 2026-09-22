/**
 * Cross-world drop validity for the hierarchy shell (spec 29 §3): edge
 * semantics belong to the kind, so `CompositeAuthoringAdapter`'s structure
 * provider REFUSES cross-world reparents (loud warn + no-op) and cross-world
 * reorder anchors. A drop the adapter will refuse must never LOOK valid in the
 * panel — chrome advertising an operation that will be refused is a false
 * claim — so `GameHierarchy`'s dragover path gates the drop indicator on this
 * predicate instead of letting the drop fall through to the adapter's refusal.
 *
 * Rule zero: roots are resolved by ASKING the composite (`groupNodeId`/
 * `ownerOf`), never by decoding adapter-minted id strings here.
 */
import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { CompositeAuthoringAdapter } from './authoring/composite-authoring-adapter';

/** The world that owns `nodeId` for drop purposes: the owning child's
 *  `worldId` for an ordinary row, the world itself for its synthetic
 *  `world:<id>` group row (dropping INTO a world's own group row is
 *  "become a root of my world" — valid), `null` for an organizational or
 *  unrecognized id
 *  no child recognizes. */
function dropRootOf(composite: CompositeAuthoringAdapter, nodeId: string): string | null {
  for (const child of composite.childAdapters()) {
    if (composite.groupNodeId(child.worldId) === nodeId) return child.worldId;
  }
  return composite.ownerOf(nodeId);
}

/**
 * True when reparenting/reordering `dragIds` at row `targetId` will be
 * accepted by the active adapter's structure provider: the adapter is not a
 * composite (a bare adapter is single-world by construction), or EVERY
 * dragged id and the target row live in the same world. A mixed-world
 * multi-select fails as a whole — the alternative is a drop that half-applies
 * (same-world ids move, foreign ids warn), which is worse than refusing the
 * affordance outright. Group-row / organizational drag ids fail the same way
 * (`ownerOf` → null): roots are reordered through their zOrder, not by
 * dragging one into another's subtree.
 */
export function isSameRootDrop(
  adapter: AuthoringAdapter,
  dragIds: string[],
  targetId: string,
): boolean {
  if (!(adapter instanceof CompositeAuthoringAdapter)) return true;
  const targetWorld = dropRootOf(adapter, targetId);
  if (targetWorld === null) return false;
  return dragIds.every((id) => adapter.ownerOf(id) === targetWorld);
}

// ------------------------------------------------------- refusal, by name

/**
 * A DEAD DRAG IS A BUG. Everything above answers "may the indicator show"; the
 * two predicates below answer the question the owner actually hit on a
 * translated port — *the row let me drag it, the drop did nothing, and nothing
 * said why*. A refusal the panel cannot explain is indistinguishable from a
 * broken editor, so every path that suppresses the indicator now carries the
 * sentence that goes with it.
 *
 * The sentences are STRUCTURAL, not per-world prose: each names a fact about
 * the row or the adapter that is true for every game in that state. Where an
 * adapter has its own sentence for a refusal (`TransformProvider.editability`'s
 * `reason`), that one is canonical and this module never paraphrases it — these
 * two cases have no adapter-side reason to forward, because the capability is
 * absent rather than declined.
 */
export const NO_STRUCTURE_WRITE_REFUSAL =
  "This world's structure comes from its own source, which the editor can't rewrite here — reparenting is not wired for it.";

export const INTERNAL_TARGET_REFUSAL =
  "That row is part of a component instance's own output, not authored content. Drop onto the instance itself to place relative to it.";

/**
 * Why this drop will do nothing, or `null` when it will work.
 *
 * Order matters and is the honest one: an adapter that cannot reparent AT ALL
 * refuses first, because "expand the instance instead" would be advice that
 * also fails. Pure — the caller resolves both facts from the adapter and the
 * reveal projection it already has.
 */
export function hierarchyDropRefusal(input: {
  /** The active adapter exposes a `structure` provider (reparent/reorder). */
  readonly hasStructureWritePath: boolean;
  /** The hovered row exists only because a component's internals were revealed. */
  readonly targetIsInternal: boolean;
}): string | null {
  if (!input.hasStructureWritePath) return NO_STRUCTURE_WRITE_REFUSAL;
  if (input.targetIsInternal) return INTERNAL_TARGET_REFUSAL;
  return null;
}
