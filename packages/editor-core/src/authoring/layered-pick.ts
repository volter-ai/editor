/**
 * Layered viewport picking (B4, D12) — "click anything you can see; topmost
 * visible layer wins." Shell POLICY over the composite's public seams, kept a
 * separate module (rather than living inline in `editor-viewport.ts`) so it
 * stays lean AND unit-testable with plain fake adapters — no real DOM/canvas
 * needed.
 *
 * This module speaks ONLY the public contract: `CompositeAuthoringAdapter
 * .childAdapters()` (T0), the `AuthoringAdapter.pickable` provider (D12,
 * `@volter/editor-project/adapter`), and `world-session-state.ts`'s session toggles. It never
 * reaches into any one child adapter's own private, format-specific model (no
 * concrete-world-shape vocabulary of any kind here) — `instanceof
 * CompositeAuthoringAdapter` is the ONE sanctioned type check (that class's
 * own doc comment blesses exactly this use, mirroring
 * `authoring/first-party-inspector/is-first-party-selection.ts`'s identical
 * precedent).
 *
 * Walk order: the composite's NON-threejs children (react/pixi design-time
 * layers), topmost-first by (install-time) manifest zOrder — `stackOrder`
 * sorts bottom-to-top, so `.reverse()` gives topmost-first while preserving
 * its own tie-break rule. The Three world is appended LAST
 * (canvas-bottom) regardless of its manifest zOrder — it always renders
 * beneath every positioned design-time layer (`design-time-layers.ts`'s own
 * doc comment: "the three canvas keeps its existing slot"), so it is
 * correct for it to lose every pick to a layer that also claims the point.
 *
 * A layer that is eye-hidden or pick-locked (`world-session-state.ts`, B1) is
 * skipped ENTIRELY — its `pickable.pick` is never even called. This is a
 * SEPARATE mechanism from a layer's `interactive` toggle: an interactive
 * layer's DOM has `pointer-events: auto`, so a real pointer event lands on the
 * layer's own element and this walk (triggered only by the CANVAS's own
 * `pointerup` listener) never runs at all for that event — mutually exclusive
 * by construction, no code needed here for it.
 *
 * When the active adapter is NOT a composite (single-world project, or a
 * non-composite override), this degrades to that one adapter's own
 * `pickable.pick` (or `null` if it doesn't have one) — today's single-world
 * behavior, unchanged.
 */

import type { AuthoringAdapter } from '@volter/editor-project/adapter';
import { stackOrder } from '@volter/editor-project/adapter/root-stacking';
import type { EditorShellStore } from '../editor-shell-store';
import { SCENE_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import { activeWorkspaceDocumentId } from '@volter/editor-sdk/kit/workspace-document-registry';
import { getActiveAuthoring } from './active-adapter';
import { CompositeAuthoringAdapter } from './composite-authoring-adapter';
import { currentSelectionScopeId } from './selection-scope';
import { isRootHidden, isRootPickLocked } from './world-session-state';

export function resolveAdapterPick(
  adapter: AuthoringAdapter,
  clientX: number,
  clientY: number,
  intent: 'normal' | 'deep',
): string | null {
  const raw = adapter.pickable?.pick(clientX, clientY) ?? null;
  if (!raw) return null;
  return (
    adapter.selection?.resolve?.(raw, {
      intent,
      scopeId: currentSelectionScopeId(),
    })?.id ?? raw
  );
}

function resolveAdapterCandidates(
  adapter: AuthoringAdapter,
  clientX: number,
  clientY: number,
  intent: 'normal' | 'deep',
): string[] {
  const raw = adapter.pickable?.candidates?.(clientX, clientY) ?? [];
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const id of raw) {
    const candidate =
      adapter.selection?.resolve?.(id, {
        intent,
        scopeId: currentSelectionScopeId(),
      })?.id ?? id;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      resolved.push(candidate);
    }
  }
  return resolved;
}

/** Topmost-first pick across every visible, pick-unlocked layer of the active
 *  (possibly composite) authoring adapter. Returns the winning node id, or
 *  `null` when nothing under `(clientX, clientY)` claims the point. */
export function pickTopmost(
  store: EditorShellStore,
  clientX: number,
  clientY: number,
  options: { intent?: 'normal' | 'deep' } = {},
): string | null {
  const intent = options.intent ?? 'normal';
  const active = getActiveAuthoring(store);
  if (!(active instanceof CompositeAuthoringAdapter)) {
    return resolveAdapterPick(active, clientX, clientY, intent);
  }

  const children = active.childAdapters();
  // The Game document stays mounted warm while Scene is active. Its DOM rects
  // therefore still exist even though it is not painted. Document ownership,
  // not mount lifetime, decides which layers may claim the pointer.
  const sceneDocumentActive = activeWorkspaceDocumentId() === SCENE_DOCUMENT_ID;
  const layered = sceneDocumentActive ? [] : children.filter((c) => c.kind !== 'three');
  const three = children.filter((c) => c.kind === 'three');

  // `stackOrder` wants `{id, zOrder}` (`ClaimEntry`) — reuse `worldId` as its
  // `id` (this walk has no separate id vocabulary of its own).
  const layeredClaims = layered.map((c) => ({
    id: c.worldId,
    zOrder: c.zOrder,
    worldId: c.worldId,
    adapter: c.adapter,
  }));

  // Topmost-first: `stackOrder` is bottom-to-top (ascending zOrder, ties by
  // original array order) — `.reverse()` flips it without disturbing its own
  // tie-break rule (a later-declared same-zOrder layer still wins the tie,
  // now by being checked FIRST instead of sorting last).
  const order: Array<{ worldId: string; adapter: AuthoringAdapter }> = [
    ...stackOrder(layeredClaims).reverse(),
    // The Three world paints/picks LAST — canvas-bottom, regardless
    // of its own manifest zOrder (see module doc comment).
    ...three,
  ];

  for (const { worldId, adapter } of order) {
    if (isRootHidden(worldId) || isRootPickLocked(worldId)) continue;
    const hit = resolveAdapterPick(adapter, clientX, clientY, intent);
    if (hit) return hit;
  }
  return null;
}

/** Ordered overlap stack across the same visible layers as {@link pickTopmost}. */
export function pickCandidates(
  store: EditorShellStore,
  clientX: number,
  clientY: number,
  options: { intent?: 'normal' | 'deep'; adapter?: AuthoringAdapter } = {},
): string[] {
  const intent = options.intent ?? 'normal';
  const active = options.adapter ?? getActiveAuthoring(store);
  if (!(active instanceof CompositeAuthoringAdapter)) {
    const candidates = resolveAdapterCandidates(active, clientX, clientY, intent);
    const fallback = resolveAdapterPick(active, clientX, clientY, intent);
    return candidates.length > 0 ? candidates : fallback ? [fallback] : [];
  }

  const children = active.childAdapters();
  const sceneDocumentActive = activeWorkspaceDocumentId() === SCENE_DOCUMENT_ID;
  const layered = sceneDocumentActive ? [] : children.filter((child) => child.kind !== 'three');
  const three = children.filter((child) => child.kind === 'three');
  const layeredClaims = layered.map((child) => ({
    id: child.worldId,
    zOrder: child.zOrder,
    worldId: child.worldId,
    adapter: child.adapter,
  }));
  const order: Array<{ worldId: string; adapter: AuthoringAdapter }> = [
    ...stackOrder(layeredClaims).reverse(),
    ...three,
  ];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const { worldId, adapter } of order) {
    if (isRootHidden(worldId) || isRootPickLocked(worldId)) continue;
    const candidates = resolveAdapterCandidates(adapter, clientX, clientY, intent);
    const fallback = resolveAdapterPick(adapter, clientX, clientY, intent);
    for (const id of candidates.length > 0 ? candidates : fallback ? [fallback] : []) {
      if (seen.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
